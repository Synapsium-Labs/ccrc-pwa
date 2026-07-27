import type { Deps } from './server.js';
import type { Bus, Notice } from './bus.js';
import { readRegistry } from './registry.js';
import { liveSessionStatus, readLiveState } from './livestate.js';
import { transcriptPath } from './transcript/resolve.js';
import { readBacklog, TranscriptTailer } from './transcript/tail.js';
import { paneState, parseDialog } from './pane/dialog.js';
import { alignAsk, readPendingAsk } from './transcript/ask.js';
import { readTasks } from './tasks/read.js';
import type { AskQuestion, Dialog, SessionStatus, SessionStreamMsg } from '../../shared/api.js';

const POLL_MS = 2000;
const BACKLOG_N = 50;

interface Resolved {
  uuid: string;
  file: string;
  cfgDir: string;
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
  /** What the client last saw of the pane menu — see nextDialogFrame. */
  private seenDialog: DialogSeen = { id: null, ask: null };
  /** The transcript state that already failed to explain the menu on screen —
   *  see claimAskRead. */
  private askProbe: { file: string; id: string; size: number; mtimeMs: number } | null = null;
  /** Serialized last-sent task list — the change gate for the `tasks` frame. */
  private lastTasksJson: string | null = null;

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
    await this.checkDialog(r?.file ?? null); // deliver an already-pending dialog on connect
    if (this.stopped) return;
    if (r) await this.checkTasks(r.cfgDir, r.uuid); // and the plan as it stands
    if (this.stopped) return;
    this.poll = setInterval(() => { void this.tick(); }, POLL_MS);
    this.poll.unref();
  }

  /** Capture the pane; send `dialog` when a menu appears/changes or first comes
   *  back enriched, and `dialog_cleared` when it vanishes — tracked per stream
   *  so a client that joins after the menu appeared still receives it.
   *
   *  `file` is the transcript being tailed, and WHICH file matters: after an
   *  account swap the same `<uuid>.jsonl` exists under several wrapper config
   *  dirs, and the ask has to come from the one this session is writing.
   *  null (unresolvable session) → the menu still ships, unenriched. */
  private async checkDialog(file: string | null): Promise<void> {
    if (this.stopped) return;
    const pane = await this.deps.tmux.capture(this.id);
    let dialog = pane !== null && paneState(pane) === 'menu' ? parseDialog(pane) : null;
    // Read the transcript only while this menu is still unexplained. Once its ask
    // is latched, re-reading costs a 256 KB tail every 2 s and can buy nothing:
    // nextDialogFrame would suppress the frame anyway. Menus that never latch are
    // held off by claimAskRead instead — they are the majority.
    const latched = dialog !== null && this.seenDialog.id === dialog.id && this.seenDialog.ask !== null;
    if (dialog?.parsed && file !== null && !latched) {
      const st = await this.deps.io.stat(file);
      if (this.stopped) return;
      if (this.claimAskRead(file, dialog.id, st)) {
        const questions = await readPendingAsk(this.deps.io, file);
        if (this.stopped) return;
        const ask = questions === null ? null : alignAsk(dialog.options, questions);
        // Enrichment rides ALONGSIDE the scraped options — it never rewrites them.
        // `id` stays a hash of the pane alone (answerDialog re-parses the pane to
        // check staleness) and the keystrokes an answer sends stay positional.
        if (ask !== null) dialog = { ...dialog, ask };
      }
    }
    // The probe is scoped to the menu on screen, so it dies with it — same
    // lifecycle event that resets `seenDialog` below. A capture can miss a menu
    // that is still there (tmux returns null, a grab mid-redraw, one stray 'esc
    // to interrupt' anywhere in the pane flipping it to busy), and on the way
    // back the ask is unlatched but the transcript is untouched — the agent is
    // blocked awaiting the answer. Keeping the probe would decline the read the
    // reappearance needs, and the menu would come back bare and stay bare.
    if (dialog === null) this.askProbe = null;
    const { seen, msg } = nextDialogFrame(this.seenDialog, dialog);
    this.seenDialog = seen;
    if (msg) this.send(msg);
  }

  /**
   * May we spend a transcript tail read on this menu? Records the state we read
   * at, so the next poll can tell whether anything could have changed.
   *
   * The ask latch above only closes on SUCCESS, and most menus never succeed:
   * permission prompts, /model, trust-folder carry no AskUserQuestion, and they
   * sit on screen until a human answers. Reading is the expensive half —
   * `readPendingAsk` pulls up to 256 KB, over the agent RPC in remote-fleet mode
   * (see transcript/tail.ts:6-11 for what reading whole transcripts once cost
   * us) — while a stat is cheap and settles it: byte-identical bytes cannot have
   * started explaining a menu they did not explain last time. A file that grows
   * (the tool_use line finally flushed) or a different menu re-opens the read.
   *
   * The cost: a read that failed for an IO reason rather than an absent ask is
   * indistinguishable here, so that menu stays unenriched until the transcript
   * next changes. It still ships, and it is still answerable from the raw sheet.
   */
  private claimAskRead(file: string, id: string, st: { size: number; mtimeMs: number } | null): boolean {
    if (st === null) {              // no transcript yet — nothing to read, nothing to remember
      this.askProbe = null;
      return false;
    }
    const p = this.askProbe;
    if (p !== null && p.file === file && p.id === id && p.size === st.size && p.mtimeMs === st.mtimeMs) return false;
    this.askProbe = { file, id, size: st.size, mtimeMs: st.mtimeMs };
    return true;
  }

  /** Read the session's task list and send it when it differs from what this
   *  client last saw. An empty list is a legitimate value — it's how the strip
   *  learns a plan was cleared — but the opening no-tasks read is swallowed by
   *  the initial `lastTasksJson === null` case below, so sessions that never
   *  keep a task list never send a frame at all. */
  private async checkTasks(cfgDir: string, uuid: string): Promise<void> {
    if (this.stopped) return;
    const tasks = await readTasks(this.deps.io, cfgDir, uuid);
    if (this.stopped) return;
    const json = JSON.stringify(tasks);
    if (json === this.lastTasksJson) return;
    if (this.lastTasksJson === null && tasks.length === 0) {
      this.lastTasksJson = json;
      return;
    }
    this.lastTasksJson = json;
    this.send({ type: 'tasks', tasks });
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
          status = liveSessionStatus(live.status);
          statusUpdatedAt = live.statusUpdatedAt;
        }
      }
    }
    return { uuid: rec.uuid, file: transcriptPath(cfgDir, cwd, rec.uuid), cfgDir, status, statusUpdatedAt };
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
      await this.checkDialog(r.file);
      if (this.stopped) return;
      await this.checkTasks(r.cfgDir, r.uuid);
    } finally {
      this.ticking = false;
    }
  }
}

/** What a client has already been told about the pane menu: the dialog id it
 *  last saw, and the enrichment (if any) that rode along with it. */
export interface DialogSeen {
  id: string | null;
  ask: AskQuestion | null;
}

/**
 * The change gate for the `dialog` frame: given what the client last saw and
 * what the pane says now, what (if anything) do we send?
 *
 * It cannot be keyed on `dialog.id` alone. That id is deliberately pane-derived
 * only — `answerDialog` re-parses the pane to check staleness and the sheet keys
 * dismissal off it, so `ask` is excluded from the hash on purpose. But the menu
 * and the transcript that explains it are read by unrelated clocks, so the same
 * menu can be captured bare on one poll and enriched on the next: identical
 * labels, identical title, identical id. An id-only gate calls that a duplicate
 * and drops it, and the client renders scraped labels for the life of the menu.
 *
 * So: send on a new id OR on the first upgrade to an enriched dialog, and never
 * the other way round — a transient read miss must not strip descriptions off a
 * sheet the operator is already reading.
 */
export function nextDialogFrame(
  prev: DialogSeen,
  dialog: Dialog | null,
): { seen: DialogSeen; msg: SessionStreamMsg | null } {
  if (!dialog) {
    if (prev.id === null) return { seen: prev, msg: null };
    return { seen: { id: null, ask: null }, msg: { type: 'dialog_cleared' } };
  }
  const isNew = prev.id !== dialog.id;
  const latched = isNew ? null : prev.ask;       // a new menu forgets the old ask
  const ask = dialog.ask ?? latched;             // and a missed read never downgrades
  const upgraded = ask !== null && latched === null;
  if (!isNew && !upgraded) return { seen: prev, msg: null };
  return {
    seen: { id: dialog.id, ask },
    msg: { type: 'dialog', dialog: ask === null ? dialog : { ...dialog, ask } },
  };
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
