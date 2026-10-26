// W3's question lifecycle pin (D-TBD-question-census; Task Q3a, ARCH-56 (#791)'s first commit; plan
// 2026-10-26-consolidation-w3-questions.md, §What W3 must not change and Review focus 1 and 2). Both lanes, the ask and
// the approval, through a fixture `FleetWatcher` and its public surface only: `tick`, the two sweep halves `tick`
// dispatches (`sweepAsks`, `sweepApprovals`, public so a test can await them) and the four door-ins the routes call.
// Q3c to Q3f move the hold carrier, the lapse and the door-ins into `coord/questions.ts`: each runs this file
// UNEDITED. It reads no private field, so nothing in it is a named exception.
//
// HOW A ROW READS. A row is a sequence of steps; after each step it records what changed, in order: every asks and
// approvals row (state, release reason, who answered, times relative to the fixture's T0), each push actually sent
// (tag, title, body, actions), each feed record (kind, title, body), and each mail queued (to whom, subject). A held
// question shows as a feed record with no push (D-2172's record-only mint); a lapse as one push of the mint's snapshot.
// The clock is faked (`Date` only); the monotonic clock follows it (`withFakeClock`).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { PushPayload } from '../src/push.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_786_000_000_000;
const CHILD = 'project-a-quiet-basin';
const PARENT = 'project-a-calm-mesa';
const PROJECT = 'project-a';

const ONE_QUESTION = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false,
  options: [{ label: 'Red' }, { label: 'Blue' }] }] };
const OTHER_QUESTION = { questions: [{ question: 'Which shape?', header: 'Shape', multiSelect: false,
  options: [{ label: 'Round' }, { label: 'Square' }] }] };
const MENU_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\n  3. Green\nEnter to select\n';
const SHAPE_PANE = 'Which shape?\n❯ 1. Round\n  2. Square\n  3. Other\nEnter to select\n';
const BARE = 'ready\n❯ \n';
const RULE = '─'.repeat(60);
const PERMISSION_PANE = ['  ⎿  $ rm -rf build', RULE, ' Bash command', '   rm -rf build', '   Remove the build directory',
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
const APPROVAL_ASK = { approval: { tool: 'Bash', summary: 'rm -rf build' } };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const at = (ms: number): void => { vi.setSystemTime(T0 + ms); };

/** A fixture home: the parent and its child in one project, a real `CoordStore`, a stubbed tmux, captured pushes, and
 *  a watcher factory over ONE `deps` (a "restart" is a second watcher over the same store and home). */
function fixture(o: { io?: (base: FleetIO) => FleetIO } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  const home = mkTmp('ccrc-questions-pin-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfgDir = path.join(home, '.claude');
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  const pids = new Map<string, number>();
  let pid = 73000;
  for (const id of [CHILD, PARENT]) {
    pid += 1;
    pids.set(id, pid);
    for (const [k, v] of Object.entries({ wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1' })) {
      writeFileSync(path.join(reg, `${id}.${k}`), v);
    }
    writeFileSync(path.join(cfgDir, 'sessions', `${pid}.json`), JSON.stringify({
      pid, sessionId: `u-${id}`, cwd: '/d', status: 'busy', statusUpdatedAt: Date.now(), version: '2.1.302',
    }));
  }
  const panes = new Map<string, string>();
  const unmeasured = new Set<string>();
  const gone = new Set<string>();
  const runner: Runner = async (_cmd, args) => {
    const id = /^=cc-(.*):$/.exec(args[2] ?? '')?.[1] ?? '';
    if (args[0] === 'has-session') {
      return gone.has(id) ? { ran: true, code: 1, stdout: '', stderr: `can't find session: cc-${id}` } : { ran: true, code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'list-panes') {
      const p = pids.get(id);
      return { ran: true, code: 0, stdout: p ? `${p}\n` : '', stderr: '' };
    }
    if (args[0] === 'capture-pane') {
      if (unmeasured.has(id)) return { ran: true, code: 1, stdout: '', stderr: 'capture failed' };
      return { ran: true, code: 0, stdout: panes.get(id) ?? BARE, stderr: '' };
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  const sent: PushPayload[] = [];
  const deps = {
    ...testDeps(home, runner), coord, notifyLog, io: o.io ? o.io(localIO) : localIO,
    push: { notify: async (p: PushPayload) => { sent.push(p); } } as never,
  };
  const watcher = (): FleetWatcher => new FleetWatcher(withFakeClock(deps), new Bus(), 10_000);
  const writeHook = (ask: unknown, state = 'waiting'): void => {
    writeFileSync(path.join(reg, `${CHILD}.hookstate.json`), JSON.stringify({
      v: 1, state, sessionId: `u-${CHILD}`, pid: 1, updatedAt: Date.now(), ask, subagents: [],
    }));
  };
  /** A run claimed by the parent, naming the child, and the child's `.child` mark (as `ws-add --child` leaves it). */
  const dispatch = (claimedBy: string | null = PARENT): number => {
    const run = coord.openRun({
      program: 'prog', title: 'Prog', project: PROJECT, wave: 1, waveOf: null, claimedBy: claimedBy ?? 'nobody-yet', coordProject: PROJECT,
    }) as { id: number };
    coord.setSession(run.id, CHILD);
    if (claimedBy === null) coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(run.id);
    writeFileSync(path.join(reg, `${CHILD}.child`), String(run.id));
    return run.id;
  };
  return { home, reg, coord, sent, panes, unmeasured, gone, notifyLog, watcher, writeHook, dispatch };
}
type Fx = ReturnType<typeof fixture>;

/** What changed since the last call, for one row's trace. */
function tracer(f: Fx) {
  let pushes = 0;
  let feed = 0;
  let mail = 0;
  const rel = (ms: number | null): number | null => (ms === null ? null : ms - T0);
  return (step: string): Record<string, unknown> => {
    const asks = (f.coord.db.prepare('SELECT id, state, releaseReason, answeredBy, answer, at, askAt FROM asks ORDER BY id').all() as Array<{
      id: number; state: string; releaseReason: string | null; answeredBy: string | null; answer: string | null; at: number; askAt: number;
    }>).map((r) => ({ ...r, at: rel(r.at), askAt: rel(r.askAt) }));
    const approvals = (f.coord.db.prepare('SELECT id, agentId, state, releaseReason, answeredBy, inputRedacted FROM approvals ORDER BY id').all() as Array<Record<string, unknown>>);
    const question = (f.coord.db.prepare('SELECT id, question FROM asks ORDER BY id').all() as Array<Record<string, unknown>>);
    const newPushes = f.sent.slice(pushes).map((p) => ({ tag: p.tag ?? null, title: p.title, body: p.body, actions: p.actions ?? null }));
    pushes = f.sent.length;
    const events = f.coord.feedEvents(10_000);
    const newFeed = events.slice(feed).map((e) => ({ kind: e.kind, title: e.title, body: e.body }));
    feed = events.length;
    const mails = f.coord.db.prepare('SELECT d.toId AS toId, m.subject AS subject FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ORDER BY m.id').all() as Array<{ toId: string; subject: string }>;
    const newMail = mails.slice(mail).map((m) => `${m.toId}: ${m.subject}`);
    mail = mails.length;
    return { step, asks, approvals, questions: question, pushes: newPushes, feed: newFeed, mail: newMail };
  };
}

/** Let the sweeps `tick` void-dispatched finish before the next step reads anything. */
const settle = async (): Promise<void> => { for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); };
const tickAt = async (w: FleetWatcher, ms: number): Promise<void> => { at(ms); await w.tick(); await settle(); };
const sweepAsksAt = async (w: FleetWatcher, ms: number): Promise<void> => { at(ms); await w.sweepAsks(); };
const sweepApprovalsAt = async (w: FleetWatcher, ms: number): Promise<void> => { at(ms); await w.sweepApprovals(); };

/** Prime, then paint the eligible question with its envelope and tick: the mint edge (held for the live parent). */
async function heldAsk(f: Fx, w: FleetWatcher, trace: ReturnType<typeof tracer>, out: unknown[]): Promise<number> {
  f.dispatch();
  await tickAt(w, 0);
  out.push(trace('primed'));
  at(1_000);
  f.writeHook(ONE_QUESTION);
  f.panes.set(CHILD, MENU_PANE);
  await tickAt(w, 1_000);
  out.push(trace('painted: held for the parent'));
  return (f.coord.db.prepare('SELECT id FROM asks ORDER BY id DESC LIMIT 1').get() as { id: number }).id;
}

/** A main-thread (or subagent) approval row held for the parent, as the raise mints it, `askAt` now. */
const heldApproval = (f: Fx, agentId = '', windowMs = agentId === '' ? 60_000 : 180_000): number => f.coord.insertApproval({
  childId: CHILD, parentId: PARENT, runId: null, digest: 'd'.repeat(64), nonce: `${agentId === '' ? 'a' : 'b'}`.repeat(32),
  agentId, tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false, class: 'ordinary', askAt: Date.now(),
  notifyAt: Date.now() + windowMs,
});

/** Prime, mint the rows, then paint the permission prompt with its envelope and tick (the approval arm of the hold). */
async function heldPrompt(f: Fx, w: FleetWatcher, trace: ReturnType<typeof tracer>, out: unknown[], agents: string[] = ['']): Promise<number[]> {
  await tickAt(w, 0);
  out.push(trace('primed'));
  at(1_000);
  const ids = agents.map((a) => heldApproval(f, a));
  f.writeHook(APPROVAL_ASK);
  f.panes.set(CHILD, PERMISSION_PANE);
  await tickAt(w, 1_000);
  out.push(trace('painted: the push deferred'));
  return ids;
}

type Row = readonly [name: string, run: () => Promise<unknown[]>];

// ── The ask lane ─────────────────────────────────────────────────────────────────────────────────────────────────

const ASK_ROWS: Row[] = [
  ['ask: held for a live claimant (record-only, mail queued, no push), then the lapse at askNotifyAt pushes the snapshot once', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w, trace, out);
    await sweepAsksAt(w, 180_000); out.push(trace('sweep at +179 s: still held'));
    await sweepAsksAt(w, 191_000); out.push(trace('sweep past askNotifyAt: released, pushed'));
    await sweepAsksAt(w, 202_000); out.push(trace('a later sweep: nothing'));
    return out;
  }],
  ['ask: answering under the bound sends nothing; past the bound it pushes and drops', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    const id = await heldAsk(f, w, trace, out);
    const askAt = (f.coord.db.prepare('SELECT askAt FROM asks WHERE id = ?').get(id) as { askAt: number }).askAt;
    expect(f.coord.takeAskForAnswer(id, askAt).ok).toBe(true);
    await sweepAsksAt(w, 191_000); out.push(trace('answering, first sighting: nothing'));
    await sweepAsksAt(w, 240_000); out.push(trace('answering under the bound: nothing'));
    await sweepAsksAt(w, 252_000); out.push(trace('answering past the bound: pushed, dropped'));
    await sweepAsksAt(w, 263_000); out.push(trace('a later sweep: nothing'));
    return out;
  }],
  ...(['answered', 'released', 'declined', 'stale'] as const).map((st): Row => [
    `ask: the release CAS lost to ${st}: dropped, no push`, async () => {
      const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
      const id = await heldAsk(f, w, trace, out);
      f.coord.db.prepare('UPDATE asks SET state = ? WHERE id = ?').run(st, id);
      await sweepAsksAt(w, 191_000); out.push(trace(`row ${st}: the sweep drops the hold`));
      await sweepAsksAt(w, 202_000); out.push(trace('a later sweep: nothing'));
      return out;
    }]),
  ['ask: the release CAS lost while the row still reads held: kept, retried, then released', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w, trace, out);
    vi.spyOn(f.coord, 'releaseAsk').mockReturnValueOnce(false);
    await sweepAsksAt(w, 191_000); out.push(trace('CAS lost, still held: kept, no push'));
    await sweepAsksAt(w, 202_000); out.push(trace('the next sweep releases and pushes'));
    return out;
  }],
  ['ask: the release CAS lost to an unknown state: pushed and dropped', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    const id = await heldAsk(f, w, trace, out);
    f.coord.db.prepare("UPDATE asks SET state = 'from-the-future' WHERE id = ?").run(id);
    await sweepAsksAt(w, 191_000); out.push(trace('unknown state: pushed, dropped'));
    return out;
  }],
  ['ask: the row gone pushes the snapshot', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    const id = await heldAsk(f, w, trace, out);
    f.coord.db.prepare('DELETE FROM asks WHERE id = ?').run(id);
    await sweepAsksAt(w, 191_000); out.push(trace('row gone: pushed, dropped'));
    return out;
  }],
  ['ask: a refused read keeps the hold (and a throw keeps it), then the next sweep resolves', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w, trace, out);
    vi.spyOn(f.coord, 'releaseAsk').mockReturnValue(false);
    const read = vi.spyOn(f.coord, 'askById').mockReturnValueOnce({ ok: false, detail: 'fixture: unreadable' } as never);
    await sweepAsksAt(w, 191_000); out.push(trace('read refused: kept, no push'));
    read.mockImplementationOnce(() => { throw new Error('fixture: disk I/O error'); });
    await sweepAsksAt(w, 202_000); out.push(trace('read threw: kept, no push'));
    vi.mocked(f.coord.releaseAsk).mockRestore();
    await sweepAsksAt(w, 213_000); out.push(trace('the next sweep releases and pushes'));
    return out;
  }],
  ['ask: the release itself throws: kept, retried', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w, trace, out);
    vi.spyOn(f.coord, 'releaseAsk').mockImplementationOnce(() => { throw new Error('fixture: disk I/O error'); });
    await sweepAsksAt(w, 191_000); out.push(trace('release threw: kept, no push'));
    await sweepAsksAt(w, 202_000); out.push(trace('the next sweep releases and pushes'));
    return out;
  }],
  ['ask: the decline door pushes at once (the route declined the row, then called releaseHeldAsk)', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    const id = await heldAsk(f, w, trace, out);
    at(20_000);
    expect(f.coord.declineAsk(id, Date.now())).toBe(true);
    w.releaseHeldAsk(CHILD); out.push(trace('declined: pushed now'));
    await sweepAsksAt(w, 191_000); out.push(trace('the lapse: nothing more'));
    w.releaseHeldAsk(CHILD); out.push(trace('a second decline door-in: nothing'));
    return out;
  }],
  ['ask: a late answer after the lapse replaces it under the same tag, answeredByBody, no actions (D-5289)', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    const id = await heldAsk(f, w, trace, out);
    await sweepAsksAt(w, 191_000); out.push(trace('lapsed: pushed'));
    at(195_000);
    w.answeredLate(CHILD, id + 1, PARENT); out.push(trace('another row\'s late answer: nothing'));
    w.answeredLate(CHILD, id, PARENT); out.push(trace('this row\'s late answer: replaced'));
    w.answeredLate(CHILD, id, PARENT); out.push(trace('again: nothing (once)'));
    return out;
  }],
  ['ask: a late answer after the dialog cleared replaces nothing', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    const id = await heldAsk(f, w, trace, out);
    await sweepAsksAt(w, 191_000); out.push(trace('lapsed: pushed'));
    f.panes.set(CHILD, BARE);
    await tickAt(w, 193_000); out.push(trace('the dialog cleared'));
    w.answeredLate(CHILD, id, PARENT); out.push(trace('the late answer: nothing'));
    return out;
  }],
  ['ask: the dialog cleared while held settles the row stale and pushes nothing', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w, trace, out);
    f.panes.set(CHILD, BARE);
    await tickAt(w, 20_000); out.push(trace('cleared: stale, no push'));
    await sweepAsksAt(w, 191_000); out.push(trace('the lapse: nothing'));
    return out;
  }],
  ['ask: the dialog replaced by another while held settles the old row stale and raises the new one', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w, trace, out);
    at(20_000);
    f.writeHook(OTHER_QUESTION);
    f.panes.set(CHILD, SHAPE_PANE);
    await tickAt(w, 20_000); out.push(trace('replaced: the old row stale, the new one held'));
    await sweepAsksAt(w, 191_000); out.push(trace('the old window: nothing'));
    await sweepAsksAt(w, 211_000); out.push(trace('the new window: the new snapshot pushed'));
    return out;
  }],
  ['ask: the amendment branch (D-5290): the menu before its envelope settles, then the envelope holds it', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    f.dispatch();
    await tickAt(w, 0); out.push(trace('primed'));
    f.writeHook(null, 'working');
    f.panes.set(CHILD, MENU_PANE);
    await tickAt(w, 1_000); out.push(trace('the menu, no envelope yet: settling'));
    at(2_000);
    f.writeHook(ONE_QUESTION);
    await tickAt(w, 2_000); out.push(trace('the envelope arrives: held'));
    await sweepAsksAt(w, 200_000); out.push(trace('the lapse: pushed'));
    return out;
  }],
  ['ask: the amendment branch (D-5290): the settle ticks run out, then the envelope arrives', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    f.dispatch();
    await tickAt(w, 0); out.push(trace('primed'));
    f.writeHook(null, 'working');
    f.panes.set(CHILD, MENU_PANE);
    await tickAt(w, 1_000); out.push(trace('settle tick 1'));
    await tickAt(w, 2_000); out.push(trace('settle tick 2'));
    await tickAt(w, 3_000); out.push(trace('settle tick 3: raised without actions'));
    at(4_000);
    f.writeHook(ONE_QUESTION);
    await tickAt(w, 4_000); out.push(trace('the envelope arrives: the amendment'));
    await sweepAsksAt(w, 200_000); out.push(trace('the lapse'));
    return out;
  }],
  ['ask: the claimant rule releases at the mint (parent not live): minted released, pushed at once, no mail', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    f.dispatch();
    await tickAt(w, 0); out.push(trace('primed'));
    f.gone.add(PARENT);
    at(1_000);
    f.writeHook(ONE_QUESTION);
    f.panes.set(CHILD, MENU_PANE);
    await tickAt(w, 1_000); out.push(trace('painted: minted released, pushed'));
    return out;
  }],
  ['ask: asks-disabled raised: never held, pushed at once', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    f.dispatch();
    writeFileSync(path.join(f.reg, 'asks-disabled'), '');
    await tickAt(w, 0); out.push(trace('primed, the switch on'));
    await sweepAsksAt(w, 11_000);
    at(12_000);
    f.writeHook(ONE_QUESTION);
    f.panes.set(CHILD, MENU_PANE);
    await tickAt(w, 12_000); out.push(trace('painted: pushed, nothing held'));
    return out;
  }],
  ['ask: an unlistable registry reads as disabled: never held, pushed at once', async () => {
    let poisoned = false;
    const f = fixture({ io: (base) => ({ ...base, readdir: async (p: string) => (poisoned && p.endsWith('.cc-sessions') ? null : base.readdir(p)) }) });
    const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    f.dispatch();
    await tickAt(w, 0); out.push(trace('primed'));
    poisoned = true;
    await sweepAsksAt(w, 11_000); out.push(trace('the sweep could not list the registry'));
    poisoned = false;
    at(12_000);
    f.writeHook(ONE_QUESTION);
    f.panes.set(CHILD, MENU_PANE);
    await tickAt(w, 12_000); out.push(trace('painted: pushed, nothing held'));
    return out;
  }],
  ['ask: a half-committed mint (a throw after insertAsk) leaves no held row: staleAsk compensates, pushed at once', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    f.dispatch();
    await tickAt(w, 0); out.push(trace('primed'));
    const real = f.coord.insertAsk.bind(f.coord);
    vi.spyOn(f.coord, 'insertAsk').mockImplementationOnce((a) => { real(a); throw new Error('fixture: the mail insert failed'); });
    at(1_000);
    f.writeHook(ONE_QUESTION);
    f.panes.set(CHILD, MENU_PANE);
    await tickAt(w, 1_000); out.push(trace('painted: the row stale, the push raised'));
    await sweepAsksAt(w, 191_000); out.push(trace('the lapse: nothing'));
    return out;
  }],
  ['ask: restart, the same dialog and key: re-seeded, pushed once at askNotifyAt (D-5925)', async () => {
    const f = fixture(); const w1 = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w1, trace, out);
    const w2 = f.watcher();
    await tickAt(w2, 20_000); out.push(trace('the boot tick: re-seeded'));
    await tickAt(w2, 30_000); out.push(trace('primed'));
    await sweepAsksAt(w2, 170_000); out.push(trace('before the deadline: nothing'));
    await sweepAsksAt(w2, 190_000); out.push(trace('the deadline: pushed once'));
    await sweepAsksAt(w2, 201_000); out.push(trace('a later sweep: nothing'));
    return out;
  }],
  ['ask: restart, a different dialog painted: the row settles stale, nothing pushed', async () => {
    const f = fixture(); const w1 = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w1, trace, out);
    f.panes.set(CHILD, SHAPE_PANE);
    const w2 = f.watcher();
    await tickAt(w2, 20_000); out.push(trace('the boot tick: stale'));
    await tickAt(w2, 30_000);
    await sweepAsksAt(w2, 200_000); out.push(trace('the old deadline: nothing'));
    return out;
  }],
  ['ask: restart, no pane (no dialog painted): the row settles stale, nothing pushed', async () => {
    const f = fixture(); const w1 = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w1, trace, out);
    f.panes.set(CHILD, BARE);
    const w2 = f.watcher();
    await tickAt(w2, 20_000); out.push(trace('the boot tick: stale'));
    return out;
  }],
  ['ask: restart, the pane unmeasured: the row stays held until a later tick measures it', async () => {
    const f = fixture(); const w1 = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w1, trace, out);
    f.unmeasured.add(CHILD);
    const w2 = f.watcher();
    await tickAt(w2, 20_000); out.push(trace('the boot tick: unmeasured, held'));
    f.unmeasured.delete(CHILD);
    await tickAt(w2, 30_000); out.push(trace('measured: re-seeded'));
    await sweepAsksAt(w2, 190_000); out.push(trace('the deadline: pushed'));
    return out;
  }],
  ['ask: restart, the hookstate unreadable at boot: held, then re-seeded once readable', async () => {
    const f = fixture(); const w1 = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w1, trace, out);
    writeFileSync(path.join(f.reg, `${CHILD}.hookstate.json`), '{ not json');
    const w2 = f.watcher();
    await tickAt(w2, 20_000); out.push(trace('the boot tick: hookstate unreadable'));
    at(25_000);
    f.writeHook(ONE_QUESTION);
    await tickAt(w2, 25_000); out.push(trace('readable: re-seeded'));
    await sweepAsksAt(w2, 190_000); out.push(trace('the deadline'));
    return out;
  }],
];

// ── The approval lane ────────────────────────────────────────────────────────────────────────────────────────────

const APPROVAL_ROWS: Row[] = [
  ['approval: a held row defers the push (recorded, not sent); the lapse at notifyAt releases it and pushes', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldPrompt(f, w, trace, out);
    await sweepApprovalsAt(w, 60_000); out.push(trace('at +59 s: held, nothing'));
    await sweepApprovalsAt(w, 61_000); out.push(trace('at notifyAt: released, pushed'));
    await sweepApprovalsAt(w, 62_000); out.push(trace('the next sweep: nothing'));
    return out;
  }],
  ['approval: the hook\'s ceiling marks a held or released row stale', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldPrompt(f, w, trace, out);
    await sweepApprovalsAt(w, 61_000); out.push(trace('lapsed'));
    await sweepApprovalsAt(w, 540_000); out.push(trace('before the ceiling: released'));
    await sweepApprovalsAt(w, 541_000); out.push(trace('the ceiling: stale'));
    return out;
  }],
  ['approval: every covered row ruled within the grace defers; after the grace, still painted, it pushes', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    const [id] = await heldPrompt(f, w, trace, out);
    at(5_000);
    expect(f.coord.takeApprovalForRule(id!, { by: PARENT, verdict: 'allow', reason: 'fine', ruling: '{}', now: Date.now() }).ok).toBe(true);
    w.approvalRuled(CHILD, '', PARENT, 'allow'); out.push(trace('ruled: the door-in keeps the deferral'));
    await sweepApprovalsAt(w, 14_000); out.push(trace('ruled within the grace: nothing'));
    await sweepApprovalsAt(w, 16_000); out.push(trace('past the grace and still painted: pushed'));
    return out;
  }],
  ['approval: ruled, and the dialog clears within the grace: nothing is ever pushed', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    const [id] = await heldPrompt(f, w, trace, out);
    at(5_000);
    expect(f.coord.takeApprovalForRule(id!, { by: PARENT, verdict: 'deny', reason: 'no', ruling: '{}', now: Date.now() }).ok).toBe(true);
    f.panes.set(CHILD, BARE);
    await tickAt(w, 8_000); out.push(trace('cleared: nothing'));
    await sweepApprovalsAt(w, 100_000); out.push(trace('later: nothing'));
    return out;
  }],
  ['approval: a cleared dialog marks only its covered main-thread rows operator; a subagent\'s row is neither withholding nor marked (D-5491)', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldPrompt(f, w, trace, out, ['a0000000000000001', '']);
    f.panes.set(CHILD, BARE);
    await tickAt(w, 5_000); out.push(trace('cleared: the main-thread row operator, the subagent row held'));
    return out;
  }],
  ['approval: a subagent\'s held row alone does not withhold the painted prompt\'s push (D-5491)', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldPrompt(f, w, trace, out, ['a0000000000000001']);
    return out;
  }],
  ['approval: the hand-over door pushes now while painted; a second door-in does nothing', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    const [id] = await heldPrompt(f, w, trace, out);
    at(5_000);
    expect(f.coord.declineApproval(id!, PARENT, Date.now())).toBe(true);
    w.releaseHeldApproval(CHILD); out.push(trace('handed over: pushed now'));
    w.releaseHeldApproval(CHILD); out.push(trace('again: nothing'));
    await sweepApprovalsAt(w, 61_000); out.push(trace('the window: nothing more'));
    return out;
  }],
  ['approval: the hand-over door while a covered row is still held in its window does nothing', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldPrompt(f, w, trace, out);
    at(5_000);
    w.releaseHeldApproval(CHILD); out.push(trace('still held: nothing'));
    return out;
  }],
  ['approval: approvalRuled for a prompt pushed before the mint replaces that notification, same tag', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await tickAt(w, 0); out.push(trace('primed'));
    f.writeHook(APPROVAL_ASK);
    f.panes.set(CHILD, PERMISSION_PANE);
    await tickAt(w, 1_000); out.push(trace('painted with no row: pushed'));
    at(2_000);
    heldApproval(f);
    w.approvalRuled(CHILD, '', PARENT, 'deny'); out.push(trace('ruled: replaced'));
    w.approvalRuled(CHILD, 'a0000000000000001', PARENT, 'deny'); out.push(trace('a subagent\'s ruling: nothing'));
    return out;
  }],
  ['approval: restart, held rows re-seed and push once no longer held; a released row is not re-seeded', async () => {
    const f = fixture(); const w1 = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldPrompt(f, w1, trace, out);
    const w2 = f.watcher();
    await tickAt(w2, 20_000); out.push(trace('the boot tick: re-seeded'));
    await tickAt(w2, 30_000);
    await sweepApprovalsAt(w2, 61_000); out.push(trace('the window: pushed once'));
    await sweepApprovalsAt(w2, 62_000); out.push(trace('again: nothing'));
    const w3 = f.watcher();
    await tickAt(w3, 70_000); out.push(trace('a second restart: the released row is not re-seeded'));
    await tickAt(w3, 80_000); out.push(trace('nothing pushed'));
    return out;
  }],
];

// ── Retention ────────────────────────────────────────────────────────────────────────────────────────────────────

const RETENTION_ROWS: Row[] = [
  ['retention: one approvalPrune pass prunes approval inputs and ask question text past 30 days; a second pass within the day prunes nothing', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await heldAsk(f, w, trace, out);
    at(2_000);
    heldApproval(f);
    out.push(trace('an ask and an approval'));
    await sweepApprovalsAt(w, 31 * 86_400_000); out.push(trace('31 days on: pruned'));
    at(31 * 86_400_000 + 1_000);
    f.coord.insertApproval({
      childId: CHILD, parentId: PARENT, runId: null, digest: 'e'.repeat(64), nonce: 'c'.repeat(32), agentId: '', tool: 'Bash',
      inputRedacted: 'rm -rf old', truncated: false, class: 'ordinary', askAt: T0 + 1_000, notifyAt: T0 + 61_000,
    });
    await sweepApprovalsAt(w, 31 * 86_400_000 + 60_000); out.push(trace('within the day: an old row is not pruned'));
    await sweepApprovalsAt(w, 32 * 86_400_000 + 60_000); out.push(trace('the next day: pruned'));
    return out;
  }],
];

const ALL_ROWS: Row[] = [...ASK_ROWS, ...APPROVAL_ROWS, ...RETENTION_ROWS];

/** Today's traces, recorded on the base (`fixtures/questions-pin/expected.json`, one step per line). A trace is never
 *  re-recorded to make a change pass: a changed trace is a behaviour change, and its PR says so in a commit of its own. */
const EXPECTED = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'questions-pin', 'expected.json'), 'utf8')) as Record<string, unknown[]>;

describe('the question lifecycle pin (D-TBD-question-census)', () => {
  it('every row has an expectation, and every expectation a row', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(ALL_ROWS.map(([n]) => n).sort());
    expect(new Set(ALL_ROWS.map(([n]) => n)).size, 'row names are unique').toBe(ALL_ROWS.length);
  });

  it.each(ALL_ROWS)('%s', async (name, run) => {
    expect(await run()).toEqual(EXPECTED[name]);
  });
});

