import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { nextDialogFrame, SessionStream, type DialogSeen } from '../src/sessionws.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { AskQuestion, Dialog } from '../../shared/api.js';

const ID = 'claude2-MekWarLive';
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);
const WORKDIR = '/data/projects/MekWarLive';
const MUNGED = '-data-projects-MekWarLive';
const PID = 40613;

const userLine = (uuid: string, text: string): string =>
  JSON.stringify({
    uuid,
    parentUuid: null,
    isSidechain: false,
    timestamp: '2026-07-20T21:00:00.000Z',
    type: 'user',
    message: { role: 'user', content: text },
  }) + '\n';

/** Registry entry + live state + transcript A with two user messages. */
const seed = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude2', project: 'MekWarLive', workdir: WORKDIR, uuid: UUID_A, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);

  const sess = path.join(home, '.claude-personal', 'sessions');
  mkdirSync(sess, { recursive: true });
  writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID_A, cwd: WORKDIR, name: 'mekwar-a1',
    status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.210',
  }));

  const tdir = path.join(home, '.claude-personal', 'projects', MUNGED);
  mkdirSync(tdir, { recursive: true });
  writeFileSync(path.join(tdir, `${UUID_A}.jsonl`), userLine('u1', 'one') + userLine('u2', 'two'));
};

// Queue-based collector so no message is dropped between sequential awaits.
const collect = (ws: WebSocket) => {
  const queue: unknown[] = [];
  const waiters: Array<(m: unknown) => void> = [];
  ws.on('message', (d) => {
    const m: unknown = JSON.parse(String(d));
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  return (timeoutMs = 3000): Promise<any> =>
    new Promise((resolve, reject) => {
      if (queue.length > 0) return resolve(queue.shift());
      const t = setTimeout(() => reject(new Error('timed out waiting for ws message')), timeoutMs);
      waiters.push((m) => { clearTimeout(t); resolve(m); });
    });
};

const opened = (ws: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

const ASK: AskQuestion = {
  question: 'Which fill strategy?',
  header: 'Backfill',
  multiSelect: false,
  options: [{ label: 'Forward-fill per class', description: 'per-class carry', preview: '07-01' }],
};

const menu = (over: Partial<Dialog> = {}): Dialog => ({
  id: 'abc123', title: 'Which fill strategy?', options: [
    { index: 1, label: 'Forward-fill per class' },
    { index: 2, label: 'Chat about this' },
  ],
  selectedIndex: 1, parsed: true, raw: 'pane', ...over,
});

const NONE: DialogSeen = { id: null, ask: null };

describe('dialog frame gate', () => {
  it('sends a menu the first time it is seen, and not again unchanged', () => {
    const first = nextDialogFrame(NONE, menu());
    expect(first.msg).toEqual({ type: 'dialog', dialog: menu() });
    expect(nextDialogFrame(first.seen, menu()).msg).toBeNull();
  });

  it('sends again — same id — when the ask only becomes readable on a later read', () => {
    const bare = nextDialogFrame(NONE, menu());
    expect((bare.msg as { dialog: Dialog }).dialog.ask).toBeUndefined();
    const rich = nextDialogFrame(bare.seen, menu({ ask: ASK }));
    expect(rich.msg).not.toBeNull();
    const d = (rich.msg as { dialog: Dialog }).dialog;
    expect(d.ask).toEqual(ASK);
    expect(d.id).toBe('abc123'); // id stays purely pane-derived
    // and the upgrade only fires once
    expect(nextDialogFrame(rich.seen, menu({ ask: ASK })).msg).toBeNull();
  });

  it('never downgrades: a read that lost the ask sends nothing and keeps it latched', () => {
    const rich = nextDialogFrame(NONE, menu({ ask: ASK }));
    const missed = nextDialogFrame(rich.seen, menu());
    expect(missed.msg).toBeNull();
    expect(missed.seen.ask).toEqual(ASK);
  });

  it('a different menu resets the latch', () => {
    const rich = nextDialogFrame(NONE, menu({ ask: ASK }));
    const next = nextDialogFrame(rich.seen, menu({ id: 'def456' }));
    expect((next.msg as { dialog: Dialog }).dialog.ask).toBeUndefined();
    expect(next.seen).toEqual({ id: 'def456', ask: null });
  });

  it('clears once when the menu vanishes, and stays quiet after', () => {
    const rich = nextDialogFrame(NONE, menu({ ask: ASK }));
    const cleared = nextDialogFrame(rich.seen, null);
    expect(cleared.msg).toEqual({ type: 'dialog_cleared' });
    expect(cleared.seen).toEqual(NONE);
    expect(nextDialogFrame(cleared.seen, null).msg).toBeNull();
  });
});

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
/** Pane captures live in fixtures/panes; transcripts sit at the fixtures root. */
const fixture = (name: string): string =>
  readFileSync(path.join(FIXTURES, name.endsWith('.jsonl') ? name : path.join('panes', name)), 'utf8');

/** One poll of a live stream. `tick` is private only to keep it off the class's
 *  public surface; the harness wants exactly what the 2 s interval does, awaited,
 *  so these tests never sleep. */
const pollOnce = (s: SessionStream): Promise<void> =>
  (s as unknown as { tick: () => Promise<void> }).tick();

/**
 * Run a SessionStream against a fixed pane and a scripted sequence of transcript
 * contents — one per poll, `null` meaning the file is not there — and collect
 * every frame it sends, plus how many times the transcript was read for an ask.
 * It resumes with `since`, so what comes back is the dialog traffic itself rather
 * than a backlog.
 */
const streamWith = async (opts: {
  pane: string;
  transcript?: string | null;
  transcriptSequence?: readonly (string | null)[];
}): Promise<{ frames: any[]; askReads: number }> => {
  const home = mkdtempSync(path.join(tmpdir(), 'ccrc-ask-'));
  seed(home);
  const file = path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_A}.jsonl`);
  // Scripted content for one poll. Rewriting identical bytes would bump mtime and
  // read as transcript growth — which is exactly what the read-skip memo keys on —
  // so a step that doesn't change the script is a genuine no-op on disk.
  const put = (t: string | null): void => {
    if (t === null) { rmSync(file, { force: true }); return; }
    if (existsSync(file) && readFileSync(file, 'utf8') === t) return;
    writeFileSync(file, t);
  };
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { code: 0, stdout: opts.pane, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  // The tailer reads through io.tailFile, and `since` skips the backlog, so a
  // readFileFrom on the transcript is an ask read and nothing else.
  let askReads = 0;
  const io: FleetIO = {
    ...localIO,
    readFileFrom: (p, off) => {
      if (p === file) askReads += 1;
      return localIO.readFileFrom(p, off);
    },
  };
  const deps: Deps = { cfg: loadConfig({ CCRC_HOME: home }), run, tmux: new Tmux(run), io };
  const seq = opts.transcriptSequence ?? [opts.transcript ?? null];
  put(seq[0] ?? null);
  const frames: any[] = [];
  const offset = existsSync(file) ? statSync(file).size : 0;
  const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m), { uuid: UUID_A, offset });
  try {
    await stream.start();
    for (const t of seq.slice(1)) {
      put(t);
      await pollOnce(stream);
    }
  } finally {
    stream.stop();
    rmSync(home, { recursive: true, force: true });
  }
  return { frames, askReads };
};

describe('dialog enrichment', () => {
  it('carries the structured ask when the pane and transcript agree', async () => {
    const { frames } = await streamWith({
      pane: fixture('ask-2col-chat-about.txt'),
      transcript: fixture('transcript-ask-2col.jsonl'),
    });
    const d = frames.find((f) => f.type === 'dialog')!.dialog;
    expect(d.ask?.question).toContain('partial-capture hazard');
    expect(d.ask?.options[0]!.description).toBeTruthy();
    expect(d.ask?.options[0]!.preview).toContain('07-01');
    // Enrichment must not disturb the answer path.
    expect(d.options).toHaveLength(4);            // 3 numbered + "Chat about this"
    expect(d.options[3]!.label).toBe('Chat about this');
  });

  it('sends the same dialog id with and without ask', async () => {
    const withAsk = await streamWith({
      pane: fixture('ask-2col-chat-about.txt'), transcript: fixture('transcript-ask-2col.jsonl'),
    });
    const without = await streamWith({ pane: fixture('ask-2col-chat-about.txt'), transcript: null });
    expect(withAsk.frames[0]!.dialog.ask).toBeDefined();
    expect(without.frames[0]!.dialog.ask).toBeUndefined();
    expect(withAsk.frames[0]!.dialog.id).toBe(without.frames[0]!.dialog.id);
  });

  it('delivers an ask that only becomes readable on a later poll', async () => {
    const { frames } = await streamWith({
      pane: fixture('ask-2col-chat-about.txt'),
      transcriptSequence: [null, fixture('transcript-ask-2col.jsonl')],
    });
    const dialogs = frames.filter((f) => f.type === 'dialog');
    expect(dialogs).toHaveLength(2);
    expect(dialogs[0]!.dialog.ask).toBeUndefined();
    expect(dialogs[1]!.dialog.ask).toBeDefined();
  });

  it('does not resend a bare dialog when a later ask read fails', async () => {
    const { frames } = await streamWith({
      pane: fixture('ask-2col-chat-about.txt'),
      transcriptSequence: [fixture('transcript-ask-2col.jsonl'), null, null],
    });
    const dialogs = frames.filter((f) => f.type === 'dialog');
    expect(dialogs).toHaveLength(1);
    // The frame count alone is satisfied by a stream that never enriches at all,
    // so pin what the single frame carried: the ask read on poll 1, still whole
    // after two polls that could not find it.
    expect(dialogs[0]!.dialog.ask?.options).toHaveLength(3);
  });

  it('reads the transcript for a menu once, not once per poll', async () => {
    // The enrichment is a latch: a 256 KB tail read every 2 s for an answer that
    // cannot change the frame (nextDialogFrame would suppress it) is pure cost.
    const t = fixture('transcript-ask-2col.jsonl');
    const { askReads } = await streamWith({
      pane: fixture('ask-2col-chat-about.txt'),
      transcriptSequence: [t, t, t],
    });
    expect(askReads).toBe(1);
  });

  it('stops re-reading the transcript for a menu it cannot explain', async () => {
    // The menus that never latch are the common ones — permission prompts,
    // /model, trust-folder — and they sit on screen until a human answers. An
    // unchanged transcript cannot start explaining one, so re-reading its 256 KB
    // tail every 2 s (over the agent RPC, in remote-fleet mode) buys nothing.
    const t = fixture('transcript-ask-2col.jsonl');
    const { askReads } = await streamWith({
      pane: fixture('model-confirm.txt'),
      transcriptSequence: [t, t, t],
    });
    expect(askReads).toBe(1);
  });

  it('leaves a /model-style confirm unenriched', async () => {
    const { frames, askReads } = await streamWith({
      pane: fixture('model-confirm.txt'), transcript: fixture('transcript-ask-2col.jsonl'),
    });
    const d = frames.find((f) => f.type === 'dialog')!.dialog;
    // It looked and alignAsk declined — not "never looked". Without the read the
    // assertion below holds for any build, enrichment ripped out included.
    expect(askReads).toBe(1);
    expect(d.ask).toBeUndefined();
    expect(d.options.map((o: { label: string }) => o.label)).toEqual(['Yes, switch to Fable 5', 'No, go back']);
  });
});

describe('session WS', () => {
  let home: string;
  let app: FastifyInstance | undefined;
  let port: number;
  let fileA: string;
  let fileB: string;

  beforeEach(async () => {
    home = mkdtempSync(path.join(tmpdir(), 'ccrc-sws-'));
    seed(home);
    fileA = path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_A}.jsonl`);
    fileB = path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_B}.jsonl`);

    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const deps: Deps = { cfg: loadConfig({ CCRC_HOME: home }), run, tmux: new Tmux(run), io: localIO };
    app = await buildServer(deps, new Bus());
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    rmSync(home, { recursive: true, force: true });
  });

  it('sends backlog, streams appended events, and follows uuid rotation', { timeout: 20_000 }, async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next = collect(ws);
    await opened(ws);

    const backlog = await next();
    expect(backlog.type).toBe('backlog');
    expect(backlog.uuid).toBe(UUID_A);
    expect(backlog.missing).toBe(false);
    expect(backlog.file).toBe(fileA);
    expect(backlog.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u1', 'u2']);
    expect(backlog.offset).toBe(statSync(fileA).size);

    appendFileSync(fileA, userLine('u3', 'three'));
    const ev = await next(6000);
    expect(ev.type).toBe('events');
    expect(ev.uuid).toBe(UUID_A);
    expect(ev.events).toHaveLength(1);
    expect(ev.events[0]).toMatchObject({ kind: 'user', uuid: 'u3', text: 'three' });
    expect(ev.offset).toBe(statSync(fileA).size);

    // Rotate: new transcript file, registry uuid flipped (clear/compact/swap).
    writeFileSync(fileB, userLine('r1', 'fresh transcript'));
    writeFileSync(path.join(home, '.cc-sessions', `${ID}.uuid`), UUID_B);

    const rotated = await next(8000);
    expect(rotated).toEqual({ type: 'rotated', uuid: UUID_B });
    const backlog2 = await next(6000);
    expect(backlog2.type).toBe('backlog');
    expect(backlog2.uuid).toBe(UUID_B);
    expect(backlog2.file).toBe(fileB);
    expect(backlog2.events.map((e: { uuid: string }) => e.uuid)).toEqual(['r1']);

    ws.close();
  });

  it('reconnect with ?since=<uuid>:<offset> skips the backlog and resumes from the offset', { timeout: 15_000 }, async () => {
    const offset = statSync(fileA).size;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}?since=${UUID_A}:${offset}`);
    const next = collect(ws);
    await opened(ws);

    appendFileSync(fileA, userLine('u9', 'after resume'));
    const first = await next(6000);
    expect(first.type).toBe('events'); // no backlog on a matching `since` resume
    expect(first.uuid).toBe(UUID_A);
    expect(first.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u9']);

    ws.close();
  });

  it('delivers an ALREADY-pending dialog on connect (menu was up before the client joined)', { timeout: 15_000 }, async () => {
    // A real AskUserQuestion menu: numbered options with descriptions + footer.
    const menuPane =
      'earlier assistant text\n' +
      '❯ 1. Approve as built\n     do it now\n' +
      '  2. Reject\n     revert\n' +
      '  3. Chat about this\n' +
      '\nEnter to select · ↑/↓ to navigate · Esc to cancel\n';
    const menuRun: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: menuPane, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const menuApp = await buildServer({ cfg: loadConfig({ CCRC_HOME: home }), run: menuRun, tmux: new Tmux(menuRun), io: localIO }, new Bus());
    await menuApp.listen({ host: '127.0.0.1', port: 0 });
    const a = menuApp.server.address();
    const p = typeof a === 'object' && a !== null ? a.port : 0;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${p}/ws/session/${ID}`);
      const next = collect(ws);
      await opened(ws);
      // backlog first, then the pending dialog (order not otherwise constrained).
      let dialogMsg: any = null;
      for (let i = 0; i < 4 && !dialogMsg; i++) {
        const m = await next(6000);
        if (m.type === 'dialog') dialogMsg = m;
      }
      expect(dialogMsg).not.toBeNull();
      expect(dialogMsg.dialog.parsed).toBe(true);
      expect(dialogMsg.dialog.options.map((o: { index: number }) => o.index)).toEqual([1, 2, 3]);
      ws.close();
    } finally {
      await menuApp.close();
    }
  });

  it('missing transcript sends backlog with missing:true and streams once the file appears', { timeout: 15_000 }, async () => {
    rmSync(fileA);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next = collect(ws);
    await opened(ws);

    const backlog = await next();
    expect(backlog.type).toBe('backlog');
    expect(backlog.missing).toBe(true);
    expect(backlog.file).toBe(fileA);
    expect(backlog.events).toEqual([]);
    expect(backlog.offset).toBe(0);

    writeFileSync(fileA, userLine('u1', 'file appeared'));
    const ev = await next(6000);
    expect(ev.type).toBe('events');
    expect(ev.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u1']);

    ws.close();
  });
});
