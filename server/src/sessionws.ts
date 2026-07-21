import type { Deps } from './server.js';
import type { Bus, Notice } from './bus.js';
import { readRegistry } from './registry.js';
import { readLiveState } from './livestate.js';
import { transcriptPath } from './transcript/resolve.js';
import { readBacklog, TranscriptTailer } from './transcript/tail.js';
import { paneState, parseDialog } from './pane/dialog.js';
import type { SessionStatus, SessionStreamMsg } from '../../shared/api.js';

const POLL_MS = 2000;
const BACKLOG_N = 50;

interface Resolved {
  uuid: string;
  file: string;
  status: SessionStatus;
  statusUpdatedAt: number | null;
}

/**
 * One per-session websocket connection: sends the transcript backlog (or tails
 * from a `since` offset on resume), streams appended events, follows uuid
 * rotation (clear/compact/swap), reports status flips, and forwards bus
 * notices plus targeted `session:<id>` messages.
 */
export class SessionStream {
  private tailer: TranscriptTailer | null = null;
  private poll: NodeJS.Timeout | null = null;
  private stopped = false;
  private ticking = false;
  private uuid: string | null = null;
  private status: SessionStatus | null = null;
  private lastDialogId: string | null = null;

  private readonly onNotice = (n: Notice): void => this.send({ type: 'notice', message: n.message });
  // This stream detects dialogs itself (start + every tick), so it always
  // delivers a dialog that is ALREADY pending when the client connects — the
  // global watcher only emits on the appear/clear transition, which a
  // late-joining client would miss. Ignore the watcher's dialog bus events here
  // to avoid double-delivery; still forward its notices.
  private readonly onSessionMsg = (m: SessionStreamMsg): void => {
    if (m.type === 'dialog' || m.type === 'dialog_cleared') return;
    this.send(m);
  };

  constructor(
    private readonly deps: Deps,
    private readonly bus: Bus,
    private readonly id: string,
    private readonly send: (m: SessionStreamMsg) => void,
    private readonly since?: { uuid: string; offset: number },
  ) {}

  async start(): Promise<void> {
    this.bus.on('notice', this.onNotice);
    this.bus.on(`session:${this.id}`, this.onSessionMsg);
    const r = await this.resolve();
    if (this.stopped) return;
    if (r) {
      this.uuid = r.uuid;
      this.status = r.status;
      if (this.since && this.since.uuid === r.uuid) {
        this.startTailer(r.file, r.uuid, this.since.offset); // resume — no backlog
      } else {
        await this.sendBacklogAndTail(r);
      }
    } else {
      this.send({ type: 'notice', message: `unknown session ${this.id}` });
    }
    if (this.stopped) return;
    await this.checkDialog(); // deliver an already-pending dialog on connect
    if (this.stopped) return;
    this.poll = setInterval(() => { void this.tick(); }, POLL_MS);
    this.poll.unref();
  }

  /** Capture the pane; send `dialog` when a menu appears/changes and
   *  `dialog_cleared` when it vanishes — tracked per stream so a client that
   *  joins after the menu appeared still receives it. */
  private async checkDialog(): Promise<void> {
    if (this.stopped) return;
    const pane = await this.deps.tmux.capture(this.id);
    const dialog = pane !== null && paneState(pane) === 'menu' ? parseDialog(pane) : null;
    if (dialog) {
      if (this.lastDialogId !== dialog.id) {
        this.lastDialogId = dialog.id;
        this.send({ type: 'dialog', dialog });
      }
    } else if (this.lastDialogId !== null) {
      this.lastDialogId = null;
      this.send({ type: 'dialog_cleared' });
    }
  }

  stop(): void {
    this.stopped = true;
    this.bus.off('notice', this.onNotice);
    this.bus.off(`session:${this.id}`, this.onSessionMsg);
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.tailer?.stop();
    this.tailer = null;
  }

  /** Registry record + live state → current uuid, transcript file, and status. */
  private async resolve(): Promise<Resolved | null> {
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    const rec = records.find((s) => s.id === this.id);
    if (!rec) return null;
    const cfgDir = this.deps.cfg.wrappers[rec.wrapper];
    if (!cfgDir) return null;
    let cwd = rec.workdir;
    let status: SessionStatus = 'dead';
    let statusUpdatedAt: number | null = null;
    if (await this.deps.tmux.hasSession(this.id)) {
      status = 'idle';
      const pid = await this.deps.tmux.panePid(this.id);
      if (pid) {
        const live = await readLiveState(this.deps.io, cfgDir, pid);
        if (live) {
          if (live.cwd) cwd = live.cwd;
          status = live.status === 'busy' ? 'busy' : 'idle';
          statusUpdatedAt = live.statusUpdatedAt;
        }
      }
    }
    return { uuid: rec.uuid, file: transcriptPath(cfgDir, cwd, rec.uuid), status, statusUpdatedAt };
  }

  /**
   * Send the last-N backlog (missing:true when the transcript doesn't exist
   * yet — the stream stays up and the tailer picks the file up on appearance),
   * then tail from the end of what the backlog covered.
   */
  private async sendBacklogAndTail(r: Resolved): Promise<void> {
    const missing = (await this.deps.io.stat(r.file)) === null;
    const { events, offset } = await readBacklog(this.deps.io, r.file, BACKLOG_N);
    if (this.stopped) return;
    this.send({ type: 'backlog', uuid: r.uuid, events, offset, file: r.file, missing });
    this.startTailer(r.file, r.uuid, offset);
  }

  private startTailer(file: string, uuid: string, fromOffset: number): void {
    if (this.stopped) return;
    this.tailer?.stop();
    const t = new TranscriptTailer(this.deps.io, file, fromOffset);
    this.tailer = t;
    t.on('events', (events, newOffset) => {
      this.send({ type: 'events', uuid, events, offset: newOffset });
    });
    t.on('rotated', () => { void this.onFileShrunk(); }); // truncation/rewrite — refetch
    t.start();
  }

  /** The tailed file shrank under us: treat as rotation — re-resolve, resend backlog. */
  private async onFileShrunk(): Promise<void> {
    if (this.stopped) return;
    const r = await this.resolve();
    if (this.stopped || !r) return;
    this.uuid = r.uuid;
    this.send({ type: 'rotated', uuid: r.uuid });
    await this.sendBacklogAndTail(r);
  }

  /** 2 s poll: uuid change → rotated + fresh backlog; status change → status msg. */
  private async tick(): Promise<void> {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      const r = await this.resolve();
      if (this.stopped || !r) return;
      if (r.uuid !== this.uuid) {
        const appeared = this.uuid === null; // record was unknown at start
        this.uuid = r.uuid;
        if (!appeared) this.send({ type: 'rotated', uuid: r.uuid });
        await this.sendBacklogAndTail(r);
      }
      if (this.stopped) return;
      if (r.status !== this.status) {
        this.status = r.status;
        this.send({ type: 'status', status: r.status, statusUpdatedAt: r.statusUpdatedAt });
      }
      if (this.stopped) return;
      await this.checkDialog();
    } finally {
      this.ticking = false;
    }
  }
}

/** Parse the `since=<uuid>:<offset>` query value; malformed → undefined. */
export function parseSince(raw: string | undefined): { uuid: string; offset: number } | undefined {
  if (!raw) return undefined;
  const i = raw.lastIndexOf(':');
  if (i <= 0) return undefined;
  const uuid = raw.slice(0, i);
  const offset = Number(raw.slice(i + 1));
  if (!Number.isFinite(offset) || offset < 0) return undefined;
  return { uuid, offset };
}
