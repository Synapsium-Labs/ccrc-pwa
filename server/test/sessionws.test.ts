import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { SessionStream, foreignConfigDirs, nextDialogFrame, shouldRepoint, type DialogSeen } from '../src/sessionws.js';
import type { TranscriptResolution, TranscriptRung } from '../src/transcript/resolve.js';
import { HOOKSTATE_FRESH_MS } from '../src/hookstate.js';
import { askKey } from '../src/askkey.js';
import { Bus } from '../src/bus.js';
import { configDirFor, loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { AskQuestion, Dialog, SessionStreamMsg } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { degradedReadIO, unreadableField } from './ioDoubles.js';

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

/**
 * `next()` that skips the hook-ask channel — fix round 1 (I1): every fresh
 * connect now sends an explicit `ask_cleared` the moment checkHookAsk first
 * runs (its sentinel starts `undefined`, not `null`, precisely so a
 * possibly-stale client gets told there is truly nothing pending — see that
 * field's own comment in sessionws.ts). These fixtures never seed a
 * hookstate file, so that frame always lands somewhere in the early message
 * sequence; the tests below are about the transcript/backlog channel and
 * would otherwise race it non-deterministically.
 */
const nextIgnoringAsk = async (next: ReturnType<typeof collect>, timeoutMs?: number): Promise<any> => {
  for (;;) {
    const m = await next(timeoutMs);
    if (m.type !== 'ask' && m.type !== 'ask_cleared') return m;
  }
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

// §5.3: an open stream follows the answer when it changes. The re-point rule is
// a pure decision, exported and table-tested here for the same reason
// `nextDialogFrame` and `parseSince` are — the io-bound half (does the tailed
// file still exist?) is the ONE fact the caller measures and passes in.
describe('shouldRepoint (spec §5.3)', () => {
  const found = (rung: TranscriptRung, p: string): TranscriptResolution =>
    ({ kind: 'found', path: p, rung, account: null });

  it('re-points to a strictly better rung even while the tailed file still exists', () => {
    // THE case the uuid-only gate could never see: a swap lands, the exact
    // address starts existing, and the stream must move off the glob answer.
    expect(shouldRepoint(found('uuid-glob', '/a'), found('live-raw', '/b'), true)).toBe(true);
  });

  it('does not re-point to a WORSE rung while the tailed file is still there', () => {
    // Kills the mutant that re-points on any difference: a transient glob
    // answer must not drag a healthy stream off its exact-address transcript.
    expect(shouldRepoint(found('live-raw', '/a'), found('uuid-glob', '/b'), true)).toBe(false);
  });

  it('re-points to a worse rung once the file being tailed is GONE', () => {
    // The other half of the rule: a deleted/reaped transcript is not something
    // to keep tailing just because its rung outranks the alternative.
    expect(shouldRepoint(found('live-raw', '/a'), found('uuid-glob', '/b'), false)).toBe(true);
  });

  it('a same-rung, same-path answer changes nothing — the common case every tick', () => {
    // Kills a mutant that re-points on object identity rather than on the
    // answer: every open socket would resend its backlog every two seconds.
    expect(shouldRepoint(found('live-raw', '/a'), found('live-raw', '/a'), true)).toBe(false);
    expect(shouldRepoint(found('live-raw', '/a'), found('live-raw', '/a'), false)).toBe(false);
  });

  it('a same-rung DIFFERENT-path answer is a sideways move, not an improvement — it follows the same ' +
     '"file gone" rule as a worse rung, never the "strictly better" one', () => {
    // Found by mutation testing `<` -> `<=`: with no test pinning this shape,
    // that mutant survived every other case in this suite. A same-rank glob
    // re-pick (e.g. `pickNewest`'s tiebreak landing on a different candidate
    // between polls) must not churn a healthy stream off a file that is still
    // there — only a strictly BETTER rung, or the tailed file vanishing, earns
    // a re-point.
    expect(shouldRepoint(found('uuid-glob', '/a'), found('uuid-glob', '/b'), true)).toBe(false);
    expect(shouldRepoint(found('uuid-glob', '/a'), found('uuid-glob', '/b'), false)).toBe(true);
  });

  it('a fallback ranks below every rung, and a fallback→fallback flip is not a re-point', () => {
    // `complete` flipping (the fleet host became unreadable) is not a reason to
    // rotate the client's chat.
    const fb = (complete: boolean): TranscriptResolution => ({ kind: 'fallback', path: '/a', complete });
    expect(shouldRepoint(fb(true), found('uuid-glob', '/b'), true)).toBe(true);
    expect(shouldRepoint(fb(true), fb(false), true)).toBe(false);
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
 * Run a SessionStream against a scripted sequence of pane captures and transcript
 * contents — one of each per poll, `null` transcript meaning the file is not
 * there — and collect every frame it sends, plus how many times the transcript
 * was read for an ask. Either sequence may be shorter than the other; its last
 * entry then holds for the remaining polls. It resumes with `since`, so what
 * comes back is the dialog traffic itself rather than a backlog.
 */
const streamWith = async (opts: {
  pane?: string;
  paneSequence?: readonly string[];
  transcript?: string | null;
  transcriptSequence?: readonly (string | null)[];
  hookstate?: unknown | null;
  hookstateSequence?: readonly (unknown | null)[];
}): Promise<{ frames: any[]; askReads: number }> => {
  const home = mkTmp('ccrc-ask-');
  seedRoster(home);
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
  const hookFile = path.join(home, '.cc-sessions', `${ID}.hookstate.json`);
  const putHook = (v: unknown | null): void => {
    if (v === null || v === undefined) { rmSync(hookFile, { force: true }); return; }
    writeFileSync(hookFile, JSON.stringify(v));
  };
  const panes = opts.paneSequence ?? [opts.pane ?? ''];
  let step = 0; // which poll we are on: 0 is start(), then one per tick
  const at = <T,>(xs: readonly T[], i: number): T => xs[Math.min(i, xs.length - 1)]!;
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { code: 0, stdout: at(panes, step), stderr: '' };
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
  const cfg = loadConfig({ CCRC_HOME: home });
  const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io, queue: new KeyedQueue() };
  const seq = opts.transcriptSequence ?? [opts.transcript ?? null];
  const hookSeq = opts.hookstateSequence ?? [opts.hookstate ?? null];
  put(at(seq, 0));
  putHook(at(hookSeq, 0));
  const frames: any[] = [];
  const offset = existsSync(file) ? statSync(file).size : 0;
  // `file` alongside the offset because that is what a CURRENT client sends
  // (§5.3's echo) and this harness's whole premise is a resume: since the
  // final review's follow-up an echo-less `since` past offset 0 is read as a
  // stale build and answered with a backlog — which here would mean a
  // `readFileFrom` that is not an ask read, silently inflating `askReads`.
  const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m), { uuid: UUID_A, offset, file });
  try {
    await stream.start();
    for (step = 1; step < Math.max(seq.length, panes.length, hookSeq.length); step += 1) {
      put(at(seq, step));
      putHook(at(hookSeq, step));
      await pollOnce(stream);
    }
  } finally {
    stream.stop();
    rmSync(home, { recursive: true, force: true });
  }
  return { frames, askReads };
};

/** A complete, valid hookstate body — `session-hook.sh`'s own shape, same
 *  fields as `hookstate.test.ts`'s `base()`. `sessionId` defaults to `UUID_A`
 *  so it passes `readHookState`'s identity gate against the registry's uuid,
 *  and `updatedAt` defaults to "now" so it passes the freshness gate. */
const hookBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1, state: 'waiting', event: 'Notification', sessionId: UUID_A, pid: PID,
  updatedAt: Date.now(), ask: null, subagents: [],
  ...over,
});

const HOOK_ASK_1 = { questions: [{ question: 'Deploy now?', options: [{ label: 'Yes' }, { label: 'No' }] }] };
const HOOK_ASK_2 = { questions: [{ question: 'Deploy now?', options: [{ label: 'Yes' }, { label: 'Cancel' }] }] };

describe('hook ask envelope frames', () => {
  it('delivers an already-waiting ask envelope on connect', async () => {
    const { frames } = await streamWith({ hookstate: hookBody({ ask: HOOK_ASK_1 }) });
    const ask = frames.find((f) => f.type === 'ask');
    expect(ask).toBeDefined();
    expect(ask.ask).toEqual(HOOK_ASK_1);
  });

  // Important 4 (Task 2 review): the wire key was never asserted anywhere —
  // `checkHookAsk` could compute it wrong, or forget it, and every existing
  // frame-shape test above would still pass. Pin both directions: a
  // questions envelope carries the SAME key `askKey` computes standalone
  // (non-null, so `POST .../ask` has something to match against), and an
  // approval envelope — answered through the pane path, never this route —
  // carries `null`.
  it('carries the wire key alongside a questions envelope, and null for an approval one', async () => {
    const { frames: withQuestions } = await streamWith({ hookstate: hookBody({ ask: HOOK_ASK_1 }) });
    const ask = withQuestions.find((f) => f.type === 'ask');
    expect(ask).toBeDefined();
    expect(ask.key).toBe(askKey(HOOK_ASK_1));
    expect(ask.key).not.toBeNull();

    const approval = { approval: { tool: 'Bash', summary: 'rm -rf build/' } };
    const { frames: withApproval } = await streamWith({ hookstate: hookBody({ ask: approval }) });
    const approvalAsk = withApproval.find((f) => f.type === 'ask');
    expect(approvalAsk).toBeDefined();
    expect(approvalAsk.key).toBeNull();
  });

  it('sends a fresh ask frame when the hookstate file\'s ask changes', async () => {
    const { frames } = await streamWith({
      hookstateSequence: [hookBody({ ask: HOOK_ASK_1 }), hookBody({ ask: HOOK_ASK_2 })],
    });
    const asks = frames.filter((f) => f.type === 'ask');
    expect(asks).toHaveLength(2);
    expect(asks[0]!.ask).toEqual(HOOK_ASK_1);
    expect(asks[1]!.ask).toEqual(HOOK_ASK_2);
  });

  it('does not resend when the hookstate file is rewritten with an unchanged ask', async () => {
    const same = hookBody({ ask: HOOK_ASK_1 });
    const { frames } = await streamWith({ hookstateSequence: [same, hookBody({ ask: HOOK_ASK_1 }), same] });
    expect(frames.filter((f) => f.type === 'ask')).toHaveLength(1);
  });

  it('nulling the ask sends ask_cleared, once', async () => {
    const { frames } = await streamWith({
      hookstateSequence: [hookBody({ ask: HOOK_ASK_1 }), hookBody({ ask: null }), hookBody({ ask: null })],
    });
    expect(frames.filter((f) => f.type === 'ask')).toHaveLength(1);
    expect(frames.filter((f) => f.type === 'ask_cleared')).toHaveLength(1);
  });

  it('a hookstate file going stale/missing where the last read was non-null also clears', async () => {
    const { frames } = await streamWith({ hookstateSequence: [hookBody({ ask: HOOK_ASK_1 }), null] });
    expect(frames.filter((f) => f.type === 'ask')).toHaveLength(1);
    expect(frames.filter((f) => f.type === 'ask_cleared')).toHaveLength(1);
  });

  // The stale-but-PRESENT path, distinct from the test above: the file never
  // disappears, but its `updatedAt` ages past readHookState's freshness gate
  // (HOOKSTATE_FRESH_MS) while the client stays connected — e.g. a wedged or
  // killed hook process that never wrote again. readHookState reads this the
  // same as a missing file (null), so the transition is the same ask_cleared.
  // Optional rider carried from Task 6's review.
  it('a hookstate file that stays PRESENT but ages past freshness also clears', async () => {
    const { frames } = await streamWith({
      hookstateSequence: [
        hookBody({ ask: HOOK_ASK_1 }),
        hookBody({ ask: HOOK_ASK_1, updatedAt: Date.now() - HOOKSTATE_FRESH_MS - 1000 }),
      ],
    });
    expect(frames.filter((f) => f.type === 'ask')).toHaveLength(1);
    expect(frames.filter((f) => f.type === 'ask_cleared')).toHaveLength(1);
  }, 30000);

  it('a scraped dialog and a hook ask both flow — neither suppresses the other', async () => {
    const { frames } = await streamWith({
      pane: fixture('ask-2col-chat-about.txt'),
      transcript: fixture('transcript-ask-2col.jsonl'),
      hookstate: hookBody({ ask: HOOK_ASK_1 }),
    });
    const dialog = frames.find((f) => f.type === 'dialog');
    const ask = frames.find((f) => f.type === 'ask');
    expect(dialog).toBeDefined();
    expect(ask).toBeDefined();
    expect(ask.ask).toEqual(HOOK_ASK_1);
  });

  // Fix round 1 (I1): reconnect-with-stale-client-ask. A brand-new connection
  // (every reconnect, automatic or explicit, is a brand-new SessionStream —
  // see start()) whose hookstate is ALREADY absent must still tell the client
  // explicitly that nothing is pending — a possibly-stale client-side `ask`
  // (left over from before the drop; the PWA's own disconnect() now nulls it
  // on an EXPLICIT teardown, but ReconnectingSocket's automatic reconnects
  // never call that) would otherwise never be corrected, since the OLD
  // sentinel (`null`) already "agreed" with a hookstate read of null on the
  // very first check and sent nothing at all.
  it('a brand-new connection with nothing pending still sends an explicit ask_cleared on first check', async () => {
    const { frames } = await streamWith({}); // no hookstate seeded at any step
    expect(frames.filter((f) => f.type === 'ask_cleared')).toHaveLength(1);
    expect(frames.filter((f) => f.type === 'ask')).toHaveLength(0);
  });

  it('does not resend ask_cleared on later ticks once the first check already sent it', async () => {
    const { frames } = await streamWith({ hookstateSequence: [null, null, null] });
    expect(frames.filter((f) => f.type === 'ask_cleared')).toHaveLength(1);
  });
});

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
    // The whole design rests on enrichment riding ALONGSIDE the scraped menu:
    // the keystrokes an answer sends come from the pane and nothing else. `id`
    // cannot witness that — it is sha1'd inside parseDialog, BEFORE the ask is
    // attached, so a post-parse rewrite of every label leaves it byte-identical.
    // Pin the rows themselves, and the cursor that decides which one Enter takes.
    expect(withAsk.frames[0]!.dialog.options).toEqual(without.frames[0]!.dialog.options);
    expect(withAsk.frames[0]!.dialog.selectedIndex).toBe(without.frames[0]!.dialog.selectedIndex);
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

  it('re-enriches a menu that flapped off-screen and came back', async () => {
    // A capture can miss a menu that is still there: tmux returns null, the grab
    // lands mid-redraw, or BUSY_RE matches one stray 'esc to interrupt' anywhere
    // in the pane (pane/dialog.ts:24-28). The read-skip memo has to be forgotten
    // with the menu, or the second appearance is judged against a probe taken for
    // the first — and since the agent is blocked awaiting the answer, the
    // transcript never changes to reopen the read. The menu would come back bare
    // and stay bare for the rest of its life.
    const t = fixture('transcript-ask-2col.jsonl');
    const ask = fixture('ask-2col-chat-about.txt');
    const { frames, askReads } = await streamWith({
      paneSequence: [ask, fixture('busy.txt'), ask, ask],
      transcriptSequence: [t],
    });
    // Fix round 1 (I1): a no-hookstate fixture like this one now also emits a
    // single explicit `ask_cleared` on the first check (checkHookAsk's
    // sentinel starts `undefined`, not `null` — see its own comment). This
    // test is about the DIALOG channel; filter the unrelated hook-ask noise
    // out before pinning its sequence.
    expect(frames.filter((f) => f.type !== 'ask' && f.type !== 'ask_cleared').map((f) => f.type)).toEqual([
      'dialog', 'dialog_cleared', 'dialog',
    ]);
    const dialogs = frames.filter((f) => f.type === 'dialog');
    expect(dialogs[1]!.dialog.ask?.options).toHaveLength(3);
    // Two appearances, two reads — and the fourth poll re-latches, not re-reads.
    expect(askReads).toBe(2);
  });

  it('re-enriches a menu that came back through an unparsed capture', async () => {
    // The other half of the same hazard: a grab mid-redraw can land with the
    // option rows erased and the 'Enter to select' footer still up, so the pane
    // is a menu but fewer than two numbered options survive and parseDialog
    // returns `unparsed` (pane/dialog.ts:94). That is a dialog, not null, so a
    // probe kept for `dialog !== null` outlives the menu it was scoped to — and
    // the parsed menu on the next poll is judged against it and declined,
    // forever, because the blocked agent never touches the transcript again.
    const t = fixture('transcript-ask-2col.jsonl');
    const ask = fixture('ask-2col-chat-about.txt');
    const { frames, askReads } = await streamWith({
      paneSequence: [ask, fixture('ask-2col-partial-redraw.txt'), ask, ask],
      transcriptSequence: [t],
    });
    const dialogs = frames.filter((f) => f.type === 'dialog');
    expect(dialogs).toHaveLength(3);
    expect(dialogs[1]!.dialog.parsed).toBe(false); // the half-drawn capture itself
    expect(dialogs[2]!.dialog.ask?.options).toHaveLength(3);
    // Two parsed appearances, two reads — the unparsed one is never read for.
    expect(askReads).toBe(2);
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

  // Stage 2e Task 3 (D-102). With RC off, a genuinely busy pane renders "esc
  // to interrupt" WHILE a permission/AskUserQuestion dialog is painted below
  // it — a real, expected combined screen (fleet.ts's liveStatus doc: an
  // RC-off pane DOES render the busy marker, unlike a --remote-control one).
  // `checkDialog`'s own gate asks `hasMenu`, not `paneState() === 'menu'` —
  // the send.ts:320 idiom, independent of the busy check for exactly this
  // reason (pane/dialog.ts:33-45). Fix round 1 closed the second half: the
  // plan's own "dialog.ts UNTOUCHED" fence had sat directly on the hazard's
  // real seat (`parseDialog`'s internal `paneState(pane) !== 'menu'` gate,
  // pane/dialog.ts:169) — the fence lifted for that one line, so `parseDialog`
  // now gates on `hasMenu` too and stops vetoing a real menu parse on a busy
  // pane. This is the real behavioral pin the D-102 gap test could not be
  // until both halves were fixed.
  it('D-102: a dialog under a live busy spinner reaches the frame — RC-off panes render both at once', async () => {
    const combo = `${fixture('busy.txt')}\n${fixture('ask-user-question.txt')}`;
    const { frames } = await streamWith({ pane: combo });
    const dialog = frames.find((f) => f.type === 'dialog');
    expect(dialog).toBeDefined();
    expect((dialog as { dialog: Dialog }).dialog.parsed).toBe(true);
    expect((dialog as { dialog: Dialog }).dialog.title).toBe('Which architecture should we go with?');
  });
});

describe('session WS', () => {
  let home: string;
  let app: FastifyInstance | undefined;
  let port: number;
  let fileA: string;
  let fileB: string;

  beforeEach(async () => {
    home = mkTmp('ccrc-sws-');
    seedRoster(home);
    seed(home);
    fileA = path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_A}.jsonl`);
    fileB = path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_B}.jsonl`);

    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() };
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
    const ev = await nextIgnoringAsk(next, 6000);
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

  it('an echo-less `since` PAST the start of a file is a STALE client — backlog, not a silent resume', { timeout: 15_000 }, async () => {
    // The §5.3 compatibility window, closed (final review follow-up). A browser
    // holding a build from before the PWA sent `sinceFile` reconnects with
    // `since=<uuid>:<offset>` and no echo, and `parseSince` collapses "the
    // param was absent" and "this client has no file" into the same
    // `file: null` — so the old rule honoured the offset against whatever the
    // ladder answers NOW, which after a swap is a different file (measured:
    // byte 6620 of the carried copy stitched onto the head of the stranded
    // one). Both moments a client legitimately has no file are at offset 0
    // (the next test), so an offset PAST the start with no file named is a
    // client that had one and cannot say so. It gets the backlog.
    const offset = statSync(fileA).size;
    expect(offset).toBeGreaterThan(0);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}?since=${UUID_A}:${offset}`);
    const next = collect(ws);
    await opened(ws);

    const first = await nextIgnoringAsk(next, 6000);
    expect(first.type).toBe('backlog');
    expect(first.file).toBe(fileA);
    expect(first.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u1', 'u2']);

    ws.close();
  });

  it('an echo-less `since` at offset 0 still resumes — the two moments a client HAS no file', { timeout: 15_000 }, async () => {
    // The other direction, and the reason the guard is keyed on the offset
    // rather than on the echo alone. A current client names no file at exactly
    // two moments (`pwa/src/stores/session.ts`'s `connect()`): before its first
    // backlog, and between a `rotated` and the backlog that follows it — and
    // the store's `offset` is 0 at both (its initial state, and `rotated`'s own
    // reset). Turning THOSE into a backlog would cost a current client a
    // redundant replay on every rotation-window reconnect, so offset 0 keeps
    // today's uuid-only resume exactly.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}?since=${UUID_A}:0`);
    const next = collect(ws);
    await opened(ws);

    // Resumed from 0, so the tailer — not a `backlog` frame — delivers what is
    // already in the file. Asserting the type alone would pass on a build that
    // sent nothing at all.
    const first = await nextIgnoringAsk(next, 6000);
    expect(first.type).toBe('events');
    expect(first.uuid).toBe(UUID_A);
    expect(first.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u1', 'u2']);

    ws.close();
  });

  it('a `since` naming a DIFFERENT file resends the backlog instead of resuming at the offset', { timeout: 15_000 }, async () => {
    // §5.3: one uuid can now resolve to different files, so an offset taken in
    // one file replayed against another renders a transcript from its middle.
    // RED against the old code, which honored any offset on a bare uuid match.
    const offset = statSync(fileA).size;
    const url = `ws://127.0.0.1:${port}/ws/session/${ID}`
      + `?since=${UUID_A}:${offset}&sinceFile=${encodeURIComponent('/some/other/place.jsonl')}`;
    const ws = new WebSocket(url);
    const next = collect(ws);
    await opened(ws);

    const first = await nextIgnoringAsk(next, 6000);
    expect(first.type).toBe('backlog');                    // NOT a silent resume
    expect(first.file).toBe(fileA);
    expect(first.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u1', 'u2']);
    ws.close();
  });

  it('a `since` naming the file it is about to tail resumes with no backlog', { timeout: 15_000 }, async () => {
    // The other direction: the echo MATCHING must not cost a redundant backlog.
    const offset = statSync(fileA).size;
    const url = `ws://127.0.0.1:${port}/ws/session/${ID}`
      + `?since=${UUID_A}:${offset}&sinceFile=${encodeURIComponent(fileA)}`;
    const ws = new WebSocket(url);
    const next = collect(ws);
    await opened(ws);

    appendFileSync(fileA, userLine('u9', 'after resume'));
    const first = await nextIgnoringAsk(next, 6000);
    expect(first.type).toBe('events');
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
    const menuCfg = loadConfig({ CCRC_HOME: home });
    const menuApp = await buildServer({ cfg: menuCfg, runCcd: ccdRunner(menuRun, menuCfg), tmux: new Tmux(menuRun), io: localIO, queue: new KeyedQueue() }, new Bus());
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
    const ev = await nextIgnoringAsk(next, 6000);
    expect(ev.type).toBe('events');
    expect(ev.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u1']);

    ws.close();
  });
});

// Registry ladder (architecture doc, increment 1's second half — Task 2, the
// heal side): `resolve()`'s three-way, off `SingleRead`. Direct
// `SessionStream` instantiation (no HTTP/WS layer) for the `start()`/poll
// assertions below — fast and deterministic, and this file's own `pollOnce`
// already establishes that pattern for `tick()`.

/** A directory listing that always fails — the ordinary transient shape in
 *  remote mode (one dropped agent-WS round trip), same helper shape as
 *  `mail-routes.test.ts`'s `unlistableIO`. */
const unlistableIO: FleetIO = { ...localIO, readdir: async () => null };

const mkLadderDeps = (home: string, io: FleetIO): Deps => {
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const cfg = loadConfig({ CCRC_HOME: home });
  return { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io, queue: new KeyedQueue() };
};

/** Private-field peeks, same discipline as this file's own `pollOnce` (a cast
 *  through `unknown`, not a public API this class needs for production). */
const pollTimer = (s: SessionStream): unknown => (s as unknown as { poll: unknown }).poll;
const streamUuid = (s: SessionStream): string | null => (s as unknown as { uuid: string | null }).uuid;
const streamTailer = (s: SessionStream): unknown => (s as unknown as { tailer: unknown }).tailer;

describe('foreignConfigDirs (spec §5.2)', () => {
  it('lists every OTHER account in roster order, and never the session\'s own', () => {
    // Kills two mutants: one that includes the own account (rung 6 would then
    // shadow rung 5 on a tie) and one that hand-types the account list instead
    // of reading the roster — which is how `claude-dev0`, the account holding
    // the incident's recovered transcript, would silently drop out.
    const home = mkTmp('ccrc-foreign-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home });
    const others = foreignConfigDirs(cfg, 'claude2');
    expect(others.map((o) => o.account)).not.toContain('claude2');
    expect(others.map((o) => o.account)).toContain('claude-dev0');
    expect(others.map((o) => o.account)).toEqual(
      cfg.roster.accounts.map((a) => a.id).filter((id) => id !== 'claude2'));
    expect(others.every((o) => o.configDir === configDirFor(cfg, o.account))).toBe(true);
  });
});

describe('the stream follows a changed answer (spec §5.3)', () => {
  it('re-points and resends backlog when the SAME uuid resolves to a better rung — with NO `rotated` frame', async () => {
    // The transcript starts findable only by the uuid glob (rung 5) — a
    // pre-fix swap's residue, or a session whose file moved inside its own
    // account. When it lands at the exact address the stream must follow it,
    // with a fresh backlog. RED against the old code, whose only re-point
    // trigger was `data.uuid !== this.uuid`.
    //
    // Fix round 1, MY RULING (Important #3): deliberately NOT `rotated` — that
    // frame mints the PWA's "Session context reset" divider (session.ts:168-
    // 174), which is false here: the uuid never changed, nothing was reset,
    // the stream just followed the SAME session's history to its new address.
    // `backlog` alone is self-describing (carries `file`/`offset`) and needs
    // no frame beside it.
    const home = mkTmp('ccrc-repoint-');
    seedRoster(home);
    seed(home);
    const exact = path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_A}.jsonl`);
    const glob = path.join(home, '.claude-personal', 'projects', '-elsewhere', `${UUID_A}.jsonl`);
    rmSync(exact);
    mkdirSync(path.dirname(glob), { recursive: true });
    writeFileSync(glob, userLine('g1', 'stranded'));

    const deps = mkLadderDeps(home, localIO);
    const frames: any[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m));
    try {
      await stream.start();
      const first = frames.find((f) => f.type === 'backlog');
      expect(first.file).toBe(glob);
      expect(first.events.map((e: { uuid: string }) => e.uuid)).toEqual(['g1']);
      frames.length = 0;

      // The carry lands at the address the resumed session actually reads.
      rmSync(glob);
      writeFileSync(exact, userLine('e1', 'carried'));
      await pollOnce(stream);

      expect(frames.filter((f) => f.type === 'rotated')).toEqual([]);   // NOT a rotation — no divider
      const second = frames.find((f) => f.type === 'backlog');
      expect(second.file).toBe(exact);
      expect(second.uuid).toBe(UUID_A);            // same uuid — a re-point, not a rotation
      expect(second.events.map((e: { uuid: string }) => e.uuid)).toEqual(['e1']);
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('follows a SAME-RUNG answer to a different path once the tailed file is gone — the stream never freezes on a ' +
     'deleted transcript (final review, Important #3)', async () => {
    // `repointNeeded`'s pre-filter is the second, untested half of §5.3's
    // rule: dropping its `cur.path === next.path` conjunct passed the FULL
    // suite. `shouldRepoint`'s own table has the same-rung/different-path row
    // (both `tailedExists` values), but the pre-filter runs BEFORE it and
    // short-circuits on rank alone, so that row was guarding a decision the
    // live path never reached — the identical shape as the round-1 finding
    // that made `repointNeeded` delegate in the first place, left one line
    // outside the fix.
    //
    // The mutant's effect, which this fixture reproduces: a rung-5 answer
    // whose file is deleted and re-created under a different project dir (a
    // reap, a re-munge, a carry that landed elsewhere) is a same-rung,
    // different-path answer — so the stream stops re-pointing and keeps
    // tailing a path that no longer exists, for the life of the socket.
    const home = mkTmp('ccrc-repoint-sideways-');
    seedRoster(home);
    seed(home);
    const projects = path.join(home, '.claude-personal', 'projects');
    rmSync(path.join(projects, MUNGED, `${UUID_A}.jsonl`));   // no exact address: rung 5 is the answer
    const globA = path.join(projects, '-elsewhere-a', `${UUID_A}.jsonl`);
    const globB = path.join(projects, '-elsewhere-b', `${UUID_A}.jsonl`);
    mkdirSync(path.dirname(globA), { recursive: true });
    writeFileSync(globA, userLine('a1', 'first address'));

    const deps = mkLadderDeps(home, localIO);
    const frames: any[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m));
    try {
      await stream.start();
      expect(frames.find((f) => f.type === 'backlog').file).toBe(globA);
      frames.length = 0;

      rmSync(globA);
      mkdirSync(path.dirname(globB), { recursive: true });
      writeFileSync(globB, userLine('b1', 'same rung, different address'));
      await pollOnce(stream);

      const second = frames.find((f) => f.type === 'backlog');
      expect(second).toBeDefined();
      expect(second.file).toBe(globB);                      // it followed
      expect(second.events.map((e: { uuid: string }) => e.uuid)).toEqual(['b1']);
      expect(frames.filter((f) => f.type === 'rotated')).toEqual([]);  // still not a rotation
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('an unchanged answer re-points NOTHING — same tailer instance, no frames', async () => {
    // Kills the mutant that re-resolves and re-points unconditionally: this is
    // what every tick of every healthy session does, ~43,000 times a day.
    const home = mkTmp('ccrc-repoint-');
    seedRoster(home);
    seed(home);
    const deps = mkLadderDeps(home, localIO);
    const frames: any[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m));
    try {
      await stream.start();
      const tailerBefore = streamTailer(stream);
      frames.length = 0;
      await pollOnce(stream);
      await pollOnce(stream);
      expect(frames.filter((f) => f.type === 'rotated' || f.type === 'backlog')).toEqual([]);
      expect(streamTailer(stream)).toBe(tailerBefore);   // SAME instance, never rebuilt
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('the backlog frame carries the foreign account and search completeness', async () => {
    // Task 12 renders both. Kills a mutant that drops `foreignAccount` (the
    // banner disappears and another account's frozen history renders as this
    // session's own) or hardcodes `searchComplete: true` (an unreadable fleet
    // host renders as an empty chat).
    const home = mkTmp('ccrc-foreignframe-');
    seedRoster(home);
    seed(home);
    rmSync(path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_A}.jsonl`));
    const held = path.join(home, '.claude-corp', 'projects', '-stranded', `${UUID_A}.jsonl`);
    mkdirSync(path.dirname(held), { recursive: true });
    writeFileSync(held, userLine('f1', 'another account holds this'));

    const deps = mkLadderDeps(home, localIO);
    const frames: any[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m));
    try {
      await stream.start();
      const backlog = frames.find((f) => f.type === 'backlog');
      expect(backlog.file).toBe(held);
      expect(backlog.foreignAccount).toBe('claude-corp');
      expect(backlog.searchComplete).toBe(true);
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }

    // And the unmeasured case: a null readdir must not read as an empty chat.
    // Deliberately NOT the file-scoped `unlistableIO` (readdir -> null for
    // EVERY path): `readSessionRecord` also calls `io.readdir` on the
    // REGISTRY directory (registry.ts:592), so that fixture makes the whole
    // session read `unmeasurable` before transcript resolution is ever
    // reached — a different code path than the one this test targets. This
    // fixture instead breaks only the own account's `projects` root (rung
    // 5/6's readdir) AND the witness stat on the account root itself — the
    // "genuinely unmeasured, flaky remote WS" case `globByUuid`'s own
    // docstring names, which is what makes it `complete: false` rather than
    // the measured-empty case a bare readdir failure would otherwise be.
    const home2 = mkTmp('ccrc-foreignframe-');
    seedRoster(home2);
    seed(home2);
    rmSync(path.join(home2, '.claude-personal', 'projects', MUNGED, `${UUID_A}.jsonl`));
    const cfgDir2 = path.join(home2, '.claude-personal');
    const unmeasurableOwnAccountIO: FleetIO = {
      ...localIO,
      readdir: async (p) => (p === path.join(cfgDir2, 'projects') ? null : localIO.readdir(p)),
      stat: async (p) => (p === cfgDir2 ? null : localIO.stat(p)),
    };
    const frames2: any[] = [];
    const stream2 = new SessionStream(mkLadderDeps(home2, unmeasurableOwnAccountIO), new Bus(), ID, (m) => frames2.push(m));
    try {
      await stream2.start();
      const backlog = frames2.find((f) => f.type === 'backlog');
      expect(backlog).toBeDefined();
      expect(backlog.missing).toBe(true);
      expect(backlog.searchComplete).toBe(false);
    } finally {
      stream2.stop();
      rmSync(home2, { recursive: true, force: true });
    }
  });
});

describe('registry ladder: resolve() three-way, degrade-and-heal vs refuse (Task 2)', () => {
  it('start() sends a DISTINCT notice for unmeasurable (listed, unreadable uuid) — RED against the old ' +
     'code, which sent the identical "unknown session" sentence for both', async () => {
    const home = mkTmp('ccrc-ladder-');
    seedRoster(home);
    seed(home);
    const deps = mkLadderDeps(home, unreadableField(ID, 'uuid'));
    const frames: { type: string; message?: string }[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m as { type: string; message?: string }));
    try {
      await stream.start();
      expect(frames[0]).toEqual({ type: 'notice', message: `session ${ID} is temporarily unreadable — retrying` });
      // degrade-and-heal keeps polling — see the next test for the absent contrast.
      expect(pollTimer(stream)).not.toBeNull();
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('start() also answers unmeasurable, with the SAME retry, when the WHOLE registry directory cannot be ' +
     'listed — the larger cousin of a degraded row, never conflated with a proven absence', async () => {
    const home = mkTmp('ccrc-ladder-');
    seedRoster(home);
    seed(home);
    const deps = mkLadderDeps(home, unlistableIO);
    const frames: { type: string; message?: string }[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m as { type: string; message?: string }));
    try {
      await stream.start();
      expect(frames[0]).toEqual({ type: 'notice', message: `session ${ID} is temporarily unreadable — retrying` });
      expect(pollTimer(stream)).not.toBeNull();
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('start() sends the truthful "unknown session" AND installs NO retry poll for a genuinely absent id — ' +
     'RED against the old code, which always installed the poll regardless', async () => {
    const home = mkTmp('ccrc-ladder-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true }); // listable, but names nobody
    const deps = mkLadderDeps(home, localIO);
    const frames: { type: string; message?: string }[] = [];
    const stream = new SessionStream(deps, new Bus(), 'no-such-session', (m) => frames.push(m as { type: string; message?: string }));
    try {
      await stream.start();
      expect(frames[0]).toEqual({ type: 'notice', message: 'unknown session no-such-session' });
      expect(pollTimer(stream)).toBeNull();
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('an unmeasurable session at CONNECT time still heals through the existing appeared-branch once the ' +
     'registry clears — no spurious "rotated" frame for what is really a first resolve', async () => {
    const home = mkTmp('ccrc-ladder-');
    seedRoster(home);
    seed(home);
    let broken = true;
    const io = degradedReadIO((p) => broken && p.endsWith(`${ID}.uuid`));
    const deps = mkLadderDeps(home, io);
    const frames: { type: string; message?: string; uuid?: string }[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m as { type: string; message?: string; uuid?: string }), { uuid: UUID_A, offset: 0 });
    try {
      await stream.start();
      expect(streamUuid(stream)).toBeNull(); // never resolved yet — the honest starting point
      frames.length = 0;

      broken = false; // heals
      await (stream as unknown as { tick: () => Promise<void> }).tick();

      expect(streamUuid(stream)).toBe(UUID_A);
      // appeared === true (uuid was null at the top of this tick): a plain
      // backlog/tail, never a 'rotated' frame — this is this stream's FIRST
      // real resolve, not a rotation of an already-known session.
      expect(frames.some((f) => f.type === 'rotated')).toBe(false);
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('tick() on an unmeasurable read touches NEITHER uuid NOR the tailer NOR status — a mid-stream blip is ' +
     'invisible to the operator, the open tail is left running exactly as it was', async () => {
    const home = mkTmp('ccrc-ladder-');
    seedRoster(home);
    seed(home);
    let broken = false;
    const io = degradedReadIO((p) => broken && p.endsWith(`${ID}.uuid`));
    const deps = mkLadderDeps(home, io);
    const frames: { type: string }[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m as { type: string }));
    try {
      await stream.start(); // clean resolve — installs the real tailer
      const uuidBefore = streamUuid(stream);
      const tailerBefore = streamTailer(stream);
      expect(uuidBefore).toBe(UUID_A);
      expect(tailerBefore).not.toBeNull();
      frames.length = 0;

      broken = true; // now listed but unreadable
      await (stream as unknown as { tick: () => Promise<void> }).tick();

      expect(streamUuid(stream)).toBe(uuidBefore);       // untouched
      expect(streamTailer(stream)).toBe(tailerBefore);   // SAME instance — never torn down/rebuilt
      expect(frames).toEqual([]);                          // no rotated, no status, nothing guessed
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('registry ladder: a mid-stream degrade never interrupts the open tail (Task 2, end to end)', () => {
  it('events keep arriving over the SAME tail while every registry read degrades — no rotated frame, no ' +
     'notice, the transcript stream is simply unaffected', { timeout: 20_000 }, async () => {
    const home = mkTmp('ccrc-sws-ladder-');
    seedRoster(home);
    seed(home);
    const fileA = path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_A}.jsonl`);
    let degrade = false;
    const io = degradedReadIO((p) => degrade && p.endsWith(`${ID}.uuid`));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io, queue: new KeyedQueue() };
    const app = await buildServer(deps, new Bus());
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
      const next = collect(ws);
      await opened(ws);

      const backlog = await next();
      expect(backlog.type).toBe('backlog');

      degrade = true; // every registry read for this id degrades from here on
      appendFileSync(fileA, userLine('u9', 'during a degrade'));
      const ev = await nextIgnoringAsk(next, 8000);
      expect(ev.type).toBe('events'); // arrived over the SAME open tail
      expect(ev.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u9']);

      ws.close();
    } finally {
      await app.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

/**
 * THE SYMLINK-MUNGE MISMATCH, pinned at the stream level — the exact shape of
 * `claude-corp-data-internal` in production. Claude Code munges its PHYSICAL
 * cwd; the registry keeps the path ccd wrote; when the workdir traverses a
 * symlink and the session is DEAD (no live cwd to paper over it), the chat
 * used to look under the registry munge and render "Can't find this session's
 * transcript" over a transcript that existed the whole time.
 */
describe('session WS — dead session behind a symlinked workdir', () => {
  it('finds the transcript under the physical munge', { timeout: 15_000 }, async () => {
    const home = mkTmp('ccrc-sws-sym-');
    seedRoster(home);
    // The production chain in miniature: <home>/data-link -> <home>/volume,
    // registry workdir through the link, transcript under the physical munge.
    const volumeDir = path.join(home, 'volume', 'projects', 'MekWarLive');
    mkdirSync(volumeDir, { recursive: true });
    symlinkSync(path.join(home, 'volume'), path.join(home, 'data-link'));
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields = {
      wrapper: 'claude2', project: 'MekWarLive',
      workdir: path.join(home, 'data-link', 'projects', 'MekWarLive'),
      uuid: UUID_A, started: '1',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    const physFile = path.join(home, '.claude-personal', 'projects',
      volumeDir.replace(/[/._]/g, '-'), `${UUID_A}.jsonl`);
    mkdirSync(path.dirname(physFile), { recursive: true });
    writeFileSync(physFile, userLine('u1', 'one'));

    // DEAD is the point: has-session answers 1, so no live cwd can rescue the
    // resolution the way it always rescued running sessions.
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() };
    const deadApp = await buildServer(deps, new Bus());
    await deadApp.listen({ host: '127.0.0.1', port: 0 });
    const addr = deadApp.server.address();
    const deadPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${deadPort}/ws/session/${ID}`);
      const next = collect(ws);
      await opened(ws);
      const backlog = await next();
      expect(backlog.type).toBe('backlog');
      expect(backlog.missing).toBe(false);
      expect(backlog.file).toBe(physFile);
      expect(backlog.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u1']);
      ws.close();
    } finally {
      await deadApp.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// Build 7, Task 6: the session's own outstanding mail, pushed the same way
// `tasks` is — read directly off `CoordStore`, never through the box-token
// gated `GET /api/mail?to=` (see `checkMail`'s own docstring in sessionws.ts
// for why that route is not this stream's caller).
describe('outstanding mail push (Build 7 Task 6)', () => {
  let home: string;
  let app: FastifyInstance | undefined;
  let port: number;
  let coord: CoordStore;

  beforeEach(async () => {
    home = mkTmp('ccrc-sws-mail-');
    seedRoster(home);
    seed(home);
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), coord };
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

  /** Queue a mail row + a `queued`-state delivery addressed to `toId`, the
   *  same two-insert shape `POST /api/mail`'s own ingress runs. Returns the
   *  DELIVERY id (`markDelivered`/`markAcked`/`rejectDelivery` all key on it). */
  const queueTo = (toId: string, subject: string): number => {
    const inserted = coord.insertMail({ fromId: 'coordinator', fromUuid: 'coordinator', toId, runId: null,
      kind: 'question', subject, body: 'body text', artifacts: [] });
    return coord.queueDelivery(inserted.id, toId, 'envelope').id;
  };

  it("sends this session's own outstanding (queued/delivered) mail on connect", async () => {
    queueTo(ID, 'rebase before you start?');
    const deliveredId = queueTo(ID, 'wave-brief');
    coord.markDelivered(deliveredId, Date.now());

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next = collect(ws);
    await opened(ws);

    let mailFrame: { type: string; mail: { subject: string; state: string }[] } | undefined;
    for (let i = 0; i < 6 && !mailFrame; i++) {
      const m = await next(6000);
      if (m.type === 'mail') mailFrame = m;
    }
    expect(mailFrame).toBeDefined();
    expect(mailFrame!.mail.map((m) => m.subject).sort()).toEqual(['rebase before you start?', 'wave-brief']);
    expect(mailFrame!.mail.map((m) => m.state).sort()).toEqual(['delivered', 'queued']);
    ws.close();
  });

  // Task 8 fix round 1, finding 1: the test above waits up to 36 s across six
  // messages — plenty of time for the first 2 s poll tick's OWN checkMail()
  // call (`tick()`) to deliver the identical frame, so it cannot actually
  // tell `start()`'s own call site (`if (r.ok) await this.checkMail();`)
  // apart from the tick's. Constructing the stream directly and reading
  // `frames` the instant `start()` resolves — never calling `tick()` at all
  // — pins that call site specifically: deleting it (leaving the tick's call
  // untouched) makes this red while leaving every timing-tolerant test above
  // green.
  it("start()'s own checkMail call puts mail on the wire before any poll tick could", async () => {
    queueTo(ID, 'on connect, not on a tick');
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), coord };
    const frames: SessionStreamMsg[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m));
    try {
      await stream.start(); // no tick() called — real timer never fires inside a sync test
      const mailFrame = frames.find((f) => f.type === 'mail') as { mail: { subject: string }[] } | undefined;
      expect(mailFrame).toBeDefined();
      expect(mailFrame!.mail).toHaveLength(1);
      expect(mailFrame!.mail[0]!.subject).toBe('on connect, not on a tick');
    } finally {
      stream.stop();
    }
  });

  it('excludes acked mail and a run-closed cancellation, includes an abandoned park (review finding 2) — never queues, delivers or acks itself', async () => {
    const ackedId = queueTo(ID, 'acked already');
    coord.markDelivered(ackedId, Date.now());
    coord.markAcked(ackedId, Date.now());
    // A run-closed cancellation is moot by design, not abandonment — stays
    // excluded (`cancelOutstandingDeliveries`'s own shape).
    const runClosedId = queueTo(ID, 'run closed already');
    coord.rejectDelivery(runClosedId, 'undeliverable', 'run closed');
    // A genuine abandonment — the lane gave up before anyone acted on it —
    // stays visible here (fix, review finding 2): never acked, never acted
    // on, so it must not vanish from the strip the moment the lane stops
    // retrying it.
    const abandonedId = queueTo(ID, 'abandoned already');
    coord.rejectDelivery(abandonedId, 'undeliverable', 'replayed without ack past the replay ceiling');
    queueTo(ID, 'still outstanding');

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next = collect(ws);
    await opened(ws);

    let mailFrame: { type: string; mail: { subject: string }[] } | undefined;
    for (let i = 0; i < 6 && !mailFrame; i++) {
      const m = await next(6000);
      if (m.type === 'mail') mailFrame = m;
    }
    expect(mailFrame).toBeDefined();
    const subjects = mailFrame!.mail.map((m) => m.subject).sort();
    expect(subjects).toEqual(['abandoned already', 'still outstanding']);
    ws.close();
  });

  it('carries more than 100 genuinely outstanding deliveries (fix, review finding 25)', async () => {
    // `outstandingMailFor`'s bare default (100) is sized for a route
    // argument nobody controls; this caller is in-process, and every
    // worker's mail resolves to the coordinator session across every wave
    // of a program (store.ts's own docstring) — the run-of-the-mill victim
    // of exactly this cap. `MailStrip.tsx` prints `mail.length` as its
    // headline COUNT, not a page indicator, so a silent 100-row ceiling
    // used to read as a cap wearing the clothes of a fact. 105 queued
    // deliveries, oldest first, must ALL arrive.
    const N = 105;
    for (let i = 0; i < N; i++) queueTo(ID, `mail ${i}`);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next = collect(ws);
    await opened(ws);

    let mailFrame: { type: string; mail: unknown[] } | undefined;
    for (let i = 0; i < 6 && !mailFrame; i++) {
      const m = await next(6000);
      if (m.type === 'mail') mailFrame = m;
    }
    expect(mailFrame).toBeDefined();
    expect(mailFrame!.mail).toHaveLength(N);
    ws.close();
  });

  // Fix round 1 (findings 1/3): this INVERTS what the test used to pin. A
  // fresh connection with nothing outstanding used to be swallowed silently
  // by the same `lastMailJson === null` first-read gate `checkTasks` still
  // has — exactly the bug `lastAskJson`'s `undefined` sentinel exists to
  // rule out for `ask` (see that field's own comment). Every fresh connect
  // must now state the mail truth explicitly, even when it is empty, the
  // same discipline `ask_cleared` already had — a possibly-stale client can
  // only be corrected by an explicit answer, never by silence.
  it('states the mail truth explicitly on every fresh connect, even when it is empty', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next = collect(ws);
    await opened(ws);

    const first = await nextIgnoringAsk(next, 6000);
    expect(first.type).toBe('backlog');
    let mailFrame: { type: string; mail: unknown[] } | undefined;
    for (let i = 0; i < 6 && !mailFrame; i++) {
      const m = await next(6000);
      if (m.type === 'mail') mailFrame = m;
    }
    expect(mailFrame).toBeDefined();
    expect(mailFrame!.mail).toEqual([]);
    ws.close();
  });

  // MEASURED, not inferred (fix round 1, finding 3): a fresh `SessionStream`
  // — literally what every reconnect is, automatic or explicit (`start()`) —
  // must not go on asserting mail the recipient already acked while the
  // socket was down. Before this fix, `lastMailJson` started at `null`, so a
  // fresh connection whose own first read was already `[]` (the delivery
  // had been acked while nobody was listening) matched the swallow and sent
  // NOTHING — the client kept whatever stale list an earlier connection had
  // shown it.
  it('a reconnect after an ack while the socket was down states the truth, not the stale list', { timeout: 15_000 }, async () => {
    const deliveryId = queueTo(ID, 'stale after ack');

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next1 = collect(ws1);
    await opened(ws1);
    let firstMail: { type: string; mail: { subject: string }[] } | undefined;
    for (let i = 0; i < 6 && !firstMail; i++) {
      const m = await next1(6000);
      if (m.type === 'mail') firstMail = m;
    }
    expect(firstMail?.mail).toHaveLength(1);
    expect(firstMail!.mail[0]!.subject).toBe('stale after ack');
    ws1.close();

    // Acked WHILE THE SOCKET IS DOWN — the exact failure scenario: a
    // ReconnectingSocket reconnect never runs the PWA's own disconnect(),
    // and even disconnect() never touched `mail` before this fix round.
    coord.markDelivered(deliveryId, Date.now());
    coord.markAcked(deliveryId, Date.now());

    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next2 = collect(ws2);
    await opened(ws2);
    let secondMail: { type: string; mail: unknown[] } | undefined;
    for (let i = 0; i < 6 && !secondMail; i++) {
      const m = await next2(6000);
      if (m.type === 'mail') secondMail = m;
    }
    expect(secondMail).toBeDefined();
    expect(secondMail!.mail).toEqual([]);
    ws2.close();
  });

  it('pushes freshly queued mail on the next poll tick', { timeout: 15_000 }, async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next = collect(ws);
    await opened(ws);
    await nextIgnoringAsk(next, 6000); // backlog — nothing outstanding yet

    // Drain the initial explicit empty `mail` frame this fix now always
    // sends on first check (finding 3) before asserting on the one the poll
    // tick pushes — otherwise this loop would catch that first empty frame
    // and never see the one `queueTo` below actually produces.
    let initialMail: { type: string; mail: unknown[] } | undefined;
    for (let i = 0; i < 6 && !initialMail; i++) {
      const m = await next(6000);
      if (m.type === 'mail') initialMail = m;
    }
    expect(initialMail?.mail).toEqual([]);

    queueTo(ID, 'fresh mail after connect');
    let mailFrame: { type: string; mail: { subject: string }[] } | undefined;
    for (let i = 0; i < 6 && !mailFrame; i++) {
      const m = await next(6000);
      if (m.type === 'mail') mailFrame = m;
    }
    expect(mailFrame).toBeDefined();
    expect(mailFrame!.mail).toHaveLength(1);
    expect(mailFrame!.mail[0]!.subject).toBe('fresh mail after connect');
    ws.close();
  });

  // Task 8 fix round 1, finding 1: the sibling `ask` gate has exactly this
  // case pinned ('does not resend when the hookstate file is rewritten with
  // an unchanged ask' — hook ask envelope frames, line 295); `checkMail`'s
  // own change gate (`if (json === this.lastMailJson) return;`) never had
  // one. Undetected, deleting that gate would put a `mail` frame on the wire
  // every ~2 s poll tick, for the life of every session socket, whether or
  // not anything changed.
  it('does not resend an unchanged mail list on a later poll tick', { timeout: 15_000 }, async () => {
    queueTo(ID, 'steady state');

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
    const next = collect(ws);
    await opened(ws);
    await nextIgnoringAsk(next, 6000); // backlog

    let mailFrame: { type: string; mail: { subject: string }[] } | undefined;
    for (let i = 0; i < 6 && !mailFrame; i++) {
      const m = await next(6000);
      if (m.type === 'mail') mailFrame = m;
    }
    expect(mailFrame?.mail).toHaveLength(1);

    // The store is untouched from here on — collect everything that arrives
    // over two more real poll ticks (POLL_MS = 2 s in sessionws.ts) and
    // confirm no second `mail` frame is among it. A deleted change gate
    // fails this deterministically (one extra frame per tick), unlike the
    // pre-existing 'pushes freshly queued mail' test, which only proves a
    // CHANGE gets sent and says nothing about an UNCHANGED one.
    const deadline = Date.now() + 5000;
    const extra: { type: string }[] = [];
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        extra.push(await next(remaining));
      } catch {
        break; // timed out waiting — nothing else arrived in the window
      }
    }
    expect(extra.filter((m) => m.type === 'mail')).toHaveLength(0);
    ws.close();
  });

  it('sends no mail frame at all with no coord configured — the same absent-store silence every coord route answers', async () => {
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() };
    const noCoordApp = await buildServer(deps, new Bus());
    await noCoordApp.listen({ host: '127.0.0.1', port: 0 });
    const addr = noCoordApp.server.address();
    const noCoordPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${noCoordPort}/ws/session/${ID}`);
      const next = collect(ws);
      await opened(ws);
      const first = await nextIgnoringAsk(next, 6000);
      expect(first.type).toBe('backlog');
      await expect(nextIgnoringAsk(next, 300)).rejects.toThrow();
      ws.close();
    } finally {
      await noCoordApp.close();
    }
  });
});
