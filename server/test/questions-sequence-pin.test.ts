// W3 Task Q3d's characterization pin (D-7028; ARCH-56 (#791), third PR; plan 2026-10-26-consolidation-w3-questions.md,
// Task Q3d Step 1, §What W3 must not change, Review focus 1 and 2). Q3a's lifecycle rows (`questions-pin.test.ts`) run
// unedited beside this file; this file adds ONE SEQUENCE PER D-NUMBER the plan's must-not-change list names (D-5289,
// D-5290, D-5925, D-5491, D-5440, D-2403, D-2172, D-2173). Each sequence runs dialog, hookstate and route events (the
// store CAS a route makes, then the watcher door-in it calls) through ticks and the two sweep halves, and records, after
// every step and in order: every asks and approvals row, each push sent, each feed record and each mail queued. Two of
// them hold two children at once, so the ORDER in which one sweep pushes two lapses is pinned too (the carrier's
// iteration order). Recorded on the base (`fixtures/questions-sequence-pin/expected.json`); the move commits run it
// unedited, and a changed trace is a behaviour change that stops the task. It reads no private field.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { localIO } from '../src/io.js';
import type { PushPayload } from '../src/push.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_786_000_000_000;
const A = 'project-a-quiet-basin';
const B = 'project-a-still-cove';
const PARENT = 'project-a-calm-mesa';
const PROJECT = 'project-a';

const COLOUR = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false,
  options: [{ label: 'Red' }, { label: 'Blue' }] }] };
const SIZE = { questions: [{ question: 'Which size?', header: 'Size', multiSelect: false,
  options: [{ label: 'Small' }, { label: 'Large' }] }] };
const MULTI = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: true,
  options: [{ label: 'Red' }, { label: 'Blue' }] }] };
const COLOUR_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\n  3. Green\nEnter to select\n';
const SIZE_PANE = 'Which size?\n❯ 1. Small\n  2. Large\n  3. Other\nEnter to select\n';
const BARE = 'ready\n❯ \n';
const RULE = '─'.repeat(60);
const PERMISSION_PANE = ['  ⎿  $ rm -rf build', RULE, ' Bash command', '   rm -rf build', '   Remove the build directory',
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
const APPROVAL_ASK = { approval: { tool: 'Bash', summary: 'rm -rf build' } };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const at = (ms: number): void => { vi.setSystemTime(T0 + ms); };

/** Two children of one parent in one project, a real `CoordStore`, a stubbed tmux, captured pushes, and a watcher
 *  factory over ONE `deps` (a restart is a second watcher over the same store and home). */
function fixture() {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  const home = mkTmp('ccrc-questions-seq-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfgDir = path.join(home, '.claude');
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  const pids = new Map<string, number>();
  let pid = 74000;
  for (const id of [A, B, PARENT]) {
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
    ...testDeps(home, runner), coord, notifyLog, io: localIO,
    push: { notify: async (p: PushPayload) => { sent.push(p); } } as never,
  };
  const watcher = (): FleetWatcher => new FleetWatcher(withFakeClock(deps), new Bus(), 10_000);
  const writeHook = (child: string, ask: unknown, state = 'waiting'): void => {
    writeFileSync(path.join(reg, `${child}.hookstate.json`), JSON.stringify({
      v: 1, state, sessionId: `u-${child}`, pid: 1, updatedAt: Date.now(), ask, subagents: [],
    }));
  };
  /** A run claimed by the parent, naming the child, and the child's `.child` mark. */
  const dispatch = (child: string): number => {
    const run = coord.openRun({
      program: `prog-${child}`, title: 'Prog', project: PROJECT, wave: 1, waveOf: null, claimedBy: PARENT, coordProject: PROJECT,
    }) as { id: number };
    coord.setSession(run.id, child);
    writeFileSync(path.join(reg, `${child}.child`), String(run.id));
    return run.id;
  };
  /** A held approvals row for `child`, as the raise mints it, `askAt` now. */
  let nonces = 0;
  const approval = (child: string, agentId = '', windowMs = agentId === '' ? 60_000 : 180_000): number => coord.insertApproval({
    childId: child, parentId: PARENT, runId: null, digest: 'd'.repeat(64), nonce: String(++nonces).padStart(32, 'n'),
    agentId, tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false, class: 'ordinary', askAt: Date.now(),
    notifyAt: Date.now() + windowMs,
  });
  return { coord, sent, panes, unmeasured, gone, watcher, writeHook, dispatch, approval };
}
type Fx = ReturnType<typeof fixture>;

/** What changed since the last call: every row, and the new pushes, feed records and mail, in order. */
function tracer(f: Fx) {
  let pushes = 0;
  let feed = 0;
  let mail = 0;
  const rel = (ms: number | null): number | null => (ms === null ? null : ms - T0);
  return (step: string): Record<string, unknown> => {
    const asks = (f.coord.db.prepare('SELECT id, childId, state, releaseReason, answeredBy, answer, at, askAt FROM asks ORDER BY id').all() as Array<{
      id: number; childId: string; state: string; releaseReason: string | null; answeredBy: string | null; answer: string | null; at: number; askAt: number;
    }>).map((r) => ({ ...r, at: rel(r.at), askAt: rel(r.askAt) }));
    const approvals = f.coord.db.prepare('SELECT id, childId, agentId, state, releaseReason, answeredBy FROM approvals ORDER BY id').all() as Array<Record<string, unknown>>;
    const newPushes = f.sent.slice(pushes).map((p) => ({ session: p.sessionId, tag: p.tag ?? null, title: p.title, body: p.body, actions: p.actions ?? null }));
    pushes = f.sent.length;
    const events = f.coord.feedEvents(10_000);
    const newFeed = events.slice(feed).map((e) => ({ kind: e.kind, session: e.sessionId, title: e.title, body: e.body }));
    feed = events.length;
    const mails = f.coord.db.prepare('SELECT d.toId AS toId, m.subject AS subject FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ORDER BY m.id').all() as Array<{ toId: string; subject: string }>;
    const newMail = mails.slice(mail).map((m) => `${m.toId}: ${m.subject}`);
    mail = mails.length;
    return { step, asks, approvals, pushes: newPushes, feed: newFeed, mail: newMail };
  };
}

const settle = async (): Promise<void> => { for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); };
const tickAt = async (w: FleetWatcher, ms: number): Promise<void> => { at(ms); await w.tick(); await settle(); };
const sweepAsksAt = async (w: FleetWatcher, ms: number): Promise<void> => { at(ms); await w.sweepAsks(); };
const sweepApprovalsAt = async (w: FleetWatcher, ms: number): Promise<void> => { at(ms); await w.sweepApprovals(); };
const askIdOf = (f: Fx, child: string): number =>
  (f.coord.db.prepare('SELECT id FROM asks WHERE childId = ? ORDER BY id DESC LIMIT 1').get(child) as { id: number }).id;

/** Prime, then hold A's question at +1 s and B's at +2 s (A first, so A is the carrier's older entry). */
async function twoHeld(f: Fx, w: FleetWatcher, trace: ReturnType<typeof tracer>, out: unknown[]): Promise<void> {
  f.dispatch(A); f.dispatch(B);
  await tickAt(w, 0); out.push(trace('primed'));
  at(1_000); f.writeHook(A, COLOUR); f.panes.set(A, COLOUR_PANE);
  await tickAt(w, 1_000); out.push(trace('A painted: held'));
  at(2_000); f.writeHook(B, SIZE); f.panes.set(B, SIZE_PANE);
  await tickAt(w, 2_000); out.push(trace('B painted: held'));
}

type Row = readonly [name: string, run: () => Promise<unknown[]>];

const ROWS: Row[] = [
  ['D-2172 and D-5289: two held questions are recorded record-only at the mint; one sweep past both windows pushes both snapshots in hold order; a late answer through the route replaces only its own child\'s lapse', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await twoHeld(f, w, trace, out);
    await sweepAsksAt(w, 200_000); out.push(trace('one sweep past both windows: both released, pushed A then B'));
    const idA = askIdOf(f, A);
    const askAt = (f.coord.db.prepare('SELECT askAt FROM asks WHERE id = ?').get(idA) as { askAt: number }).askAt;
    at(205_000);
    const took = f.coord.takeAskForAnswer(idA, askAt);
    out.push({ step: 'the route takes A\'s released row', took });
    f.coord.settleAsk(idA, PARENT, 'Red', Date.now());
    w.answeredLate(A, idA, PARENT); out.push(trace('A answered late: A\'s lapse replaced, B\'s kept'));
    w.answeredLate(B, idA, PARENT); out.push(trace('A\'s row id against B: nothing'));
    return out;
  }],
  ['D-5290: the settle ticks run out and the menu raises without actions; the envelope then arrives with the parent gone: the amendment asks the hold first, minted released, the answerable push replaces the actionless one', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    f.dispatch(A);
    await tickAt(w, 0); out.push(trace('primed'));
    f.writeHook(A, null, 'working');
    f.panes.set(A, COLOUR_PANE);
    await tickAt(w, 1_000); out.push(trace('settle tick 1'));
    await tickAt(w, 2_000); out.push(trace('settle tick 2'));
    await tickAt(w, 3_000); out.push(trace('settle tick 3: raised without actions'));
    f.gone.add(PARENT);
    at(4_000); f.writeHook(A, COLOUR);
    await tickAt(w, 4_000); out.push(trace('the envelope: the amendment, released at once'));
    await tickAt(w, 5_000); out.push(trace('the next tick: nothing'));
    await sweepAsksAt(w, 200_000); out.push(trace('the window: nothing held'));
    return out;
  }],
  ['D-5925: a restart re-seeds two held questions in different ticks (B at boot, A once its pane is measured); one sweep past both windows pushes them in re-seed order', async () => {
    const f = fixture(); const w1 = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await twoHeld(f, w1, trace, out);
    f.unmeasured.add(A);
    const w2 = f.watcher();
    await tickAt(w2, 20_000); out.push(trace('the boot tick: B re-seeded, A unmeasured'));
    f.unmeasured.delete(A);
    await tickAt(w2, 30_000); out.push(trace('A measured: re-seeded'));
    await sweepAsksAt(w2, 200_000); out.push(trace('one sweep past both windows'));
    await sweepAsksAt(w2, 211_000); out.push(trace('a later sweep: nothing'));
    return out;
  }],
  ['D-5925: a restart re-seeds two held prompts in different ticks; their deferred pushes go out in re-seed order once no row is held', async () => {
    const f = fixture(); const w1 = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await tickAt(w1, 0); out.push(trace('primed'));
    at(1_000); f.approval(A); f.writeHook(A, APPROVAL_ASK); f.panes.set(A, PERMISSION_PANE);
    await tickAt(w1, 1_000); out.push(trace('A\'s prompt: deferred'));
    at(2_000); f.approval(B); f.writeHook(B, APPROVAL_ASK); f.panes.set(B, PERMISSION_PANE);
    await tickAt(w1, 2_000); out.push(trace('B\'s prompt: deferred'));
    f.unmeasured.add(A);
    const w2 = f.watcher();
    await tickAt(w2, 20_000); out.push(trace('the boot tick: B re-seeded, A unmeasured'));
    f.unmeasured.delete(A);
    await tickAt(w2, 30_000); out.push(trace('A measured: re-seeded'));
    await sweepApprovalsAt(w2, 63_000); out.push(trace('both windows over: both pushed'));
    await sweepApprovalsAt(w2, 64_000); out.push(trace('again: nothing'));
    return out;
  }],
  ['D-5491 and D-5440: a main-thread and a subagent row; the subagent\'s ruling replaces nothing; the hand-over of the main row pushes now; the cleared dialog then marks nothing more', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await tickAt(w, 0); out.push(trace('primed'));
    at(1_000);
    const sub = f.approval(A, 'a0000000000000001');
    const main = f.approval(A);
    f.writeHook(A, APPROVAL_ASK); f.panes.set(A, PERMISSION_PANE);
    await tickAt(w, 1_000); out.push(trace('painted: deferred over the main row only'));
    at(3_000);
    expect(f.coord.takeApprovalForRule(sub, { by: PARENT, verdict: 'deny', reason: 'no', ruling: '{}', now: Date.now() }).ok).toBe(true);
    w.approvalRuled(A, 'a0000000000000001', PARENT, 'deny'); out.push(trace('the subagent row ruled: nothing'));
    at(4_000);
    expect(f.coord.declineApproval(main, PARENT, Date.now())).toBe(true);
    w.releaseHeldApproval(A); out.push(trace('the main row handed over: pushed now'));
    f.panes.set(A, BARE);
    await tickAt(w, 5_000); out.push(trace('cleared: nothing marked, nothing pushed'));
    await sweepApprovalsAt(w, 200_000); out.push(trace('later: nothing'));
    return out;
  }],
  ['D-5491: a cleared prompt marks its covered main-thread rows operator in one pass, and only those; the next prompt holds afresh', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    await tickAt(w, 0); out.push(trace('primed'));
    at(1_000);
    f.approval(A); f.approval(A, 'a0000000000000002'); f.approval(A);
    f.writeHook(A, APPROVAL_ASK); f.panes.set(A, PERMISSION_PANE);
    await tickAt(w, 1_000); out.push(trace('painted: deferred over two main rows'));
    f.panes.set(A, BARE);
    await tickAt(w, 2_000); out.push(trace('cleared: the two main rows operator'));
    at(3_000); f.approval(A); f.panes.set(A, PERMISSION_PANE);
    await tickAt(w, 3_000); out.push(trace('painted again: a fresh hold'));
    await sweepApprovalsAt(w, 64_000); out.push(trace('its window: released and pushed'));
    return out;
  }],
  ['D-2403: the same dialog still painted while the hookstate is re-written re-stamps the held row\'s askAt each tick, and a new dialog does not', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    f.dispatch(A);
    await tickAt(w, 0); out.push(trace('primed'));
    at(1_000); f.writeHook(A, COLOUR); f.panes.set(A, COLOUR_PANE);
    await tickAt(w, 1_000); out.push(trace('held'));
    at(5_000); f.writeHook(A, COLOUR);
    await tickAt(w, 5_000); out.push(trace('re-written, same dialog: askAt re-stamped'));
    at(9_000); f.writeHook(A, SIZE);
    await tickAt(w, 9_000); out.push(trace('another question under the same menu: not re-stamped'));
    at(12_000); f.writeHook(A, SIZE); f.panes.set(A, SIZE_PANE);
    await tickAt(w, 12_000); out.push(trace('the new dialog: the old row stale, the new one held'));
    return out;
  }],
  ['D-2173: an ask askActions refuses (a multiSelect) is never held: raised at once without actions, no row, no mail', async () => {
    const f = fixture(); const w = f.watcher(); const trace = tracer(f); const out: unknown[] = [];
    f.dispatch(A);
    await tickAt(w, 0); out.push(trace('primed'));
    at(1_000); f.writeHook(A, MULTI); f.panes.set(A, COLOUR_PANE);
    await tickAt(w, 1_000); out.push(trace('painted: raised, nothing held'));
    await sweepAsksAt(w, 200_000); out.push(trace('the window: nothing'));
    return out;
  }],
];

/** Today's traces, recorded on the base. Never re-recorded to make a change pass (Task Q3d: an output change stops it). */
const EXPECTED = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'questions-sequence-pin', 'expected.json'), 'utf8')) as Record<string, unknown[]>;

describe('the question sequence pin (D-7028)', () => {
  it('every row has an expectation, and every expectation a row', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(ROWS.map(([n]) => n).sort());
  });

  it.each(ROWS)('%s', async (name, run) => {
    expect(await run()).toEqual(EXPECTED[name]);
  });
});
