// W3's question CLOCK pin (W3 Task Q3c, D-7027; ARCH-56 (#791), second PR; plan
// 2026-10-26-consolidation-w3-questions.md, Review focus 7: two clocks merged). Q3c's characterization commit: green on
// the base, before `sweepQuestions` exists, and run UNEDITED through every move commit after it. The two question
// halves `tick` dispatches keep their own clocks:
//  - the ask half (`sweepAsks`) runs on the `asks` row of `LANE_SCHEDULE` (10 s), behind the `primed` gate, and awaits
//    its fleet read (`FleetWatcher#fleetFor`, agent-WS I/O in remote mode);
//  - the approval half (`sweepApprovals`) runs every tick, ungated, with no await, so its whole body runs inside
//    `tick`'s synchronous turn.
// Neither waits for the other. THE SEAM for the never-resolving fleet read (row c) is `FleetWatcher#fleetFor`, stubbed
// by cast to a promise that never settles for the one call made from inside `sweepAsks` (by its stack): it is the ask
// half's one await before any row, and the read model `tick` hands the half reaches it through that method. Every
// other caller (lanes `tick` awaits) reads through the real method. The fixture is `questions-pin.test.ts`'s, trimmed (a new file, so no
// open PR's lines are touched; slug q3c-clock-pin-file).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const CHILD = 'project-a-quiet-basin';
const PARENT = 'project-a-calm-mesa';
const PROJECT = 'project-a';

const ONE_QUESTION = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false,
  options: [{ label: 'Red' }, { label: 'Blue' }] }] };
const MENU_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\n  3. Green\nEnter to select\n';
const BARE = 'ready\n❯ \n';
const RULE = '─'.repeat(60);
const PERMISSION_PANE = ['  ⎿  $ rm -rf build', RULE, ' Bash command', '   rm -rf build', '   Remove the build directory',
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
const APPROVAL_ASK = { approval: { tool: 'Bash', summary: 'rm -rf build' } };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const at = (ms: number): void => { vi.setSystemTime(T0 + ms); };

function fixture() {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  const home = mkTmp('ccrc-questions-clock-pin-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfgDir = path.join(home, '.claude');
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  const pids = new Map<string, number>();
  let pid = 74000;
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
  const runner: Runner = async (_cmd, args) => {
    const id = /^=cc-(.*):$/.exec(args[2] ?? '')?.[1] ?? '';
    if (args[0] === 'list-panes') {
      const p = pids.get(id);
      return { ran: true, code: 0, stdout: p ? `${p}\n` : '', stderr: '' };
    }
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: panes.get(id) ?? BARE, stderr: '' };
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
  const writeHook = (ask: unknown, state = 'waiting'): void => {
    writeFileSync(path.join(reg, `${CHILD}.hookstate.json`), JSON.stringify({
      v: 1, state, sessionId: `u-${CHILD}`, pid: 1, updatedAt: Date.now(), ask, subagents: [],
    }));
  };
  const dispatch = (): void => {
    const run = coord.openRun({
      program: 'prog', title: 'Prog', project: PROJECT, wave: 1, waveOf: null, claimedBy: PARENT, coordProject: PROJECT,
    }) as { id: number };
    coord.setSession(run.id, CHILD);
    writeFileSync(path.join(reg, `${CHILD}.child`), String(run.id));
  };
  const askState = (): string[] => (coord.db.prepare('SELECT state FROM asks ORDER BY id').all() as Array<{ state: string }>).map((r) => r.state);
  const approvalStates = (): string[] => (coord.db.prepare('SELECT state FROM approvals ORDER BY id').all() as Array<{ state: string }>).map((r) => r.state);
  const insertApproval = (o: { agentId?: string; askAt: number; notifyAt: number; nonce: string }): number => coord.insertApproval({
    childId: CHILD, parentId: PARENT, runId: null, digest: 'd'.repeat(64), nonce: o.nonce.repeat(32), agentId: o.agentId ?? '',
    tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false, class: 'ordinary', askAt: o.askAt, notifyAt: o.notifyAt,
  });
  return { coord, sent, panes, watcher, writeHook, dispatch, askState, approvalStates, insertApproval };
}
type Fx = ReturnType<typeof fixture>;

const settle = async (): Promise<void> => { for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); };
const tickAt = async (w: FleetWatcher, ms: number): Promise<void> => { at(ms); await w.tick(); await settle(); };

/** Prime, mint one main-thread approval row (window 60 s), paint the prompt: the push is deferred. */
async function heldPrompt(f: Fx, w: FleetWatcher): Promise<void> {
  await tickAt(w, 0);
  at(1_000);
  f.insertApproval({ askAt: Date.now(), notifyAt: Date.now() + 60_000, nonce: 'a' });
  f.writeHook(APPROVAL_ASK);
  f.panes.set(CHILD, PERMISSION_PANE);
  await tickAt(w, 1_000);
  expect(f.approvalStates()).toEqual(['held']);
  expect(f.sent, 'the prompt is deferred, not pushed').toEqual([]);
}

/** Prime with a dispatched child, paint its question at +1 s: held until askNotifyAt (+181 s). */
async function heldAsk(f: Fx, w: FleetWatcher): Promise<void> {
  f.dispatch();
  await tickAt(w, 0);
  at(1_000);
  f.writeHook(ONE_QUESTION);
  f.panes.set(CHILD, MENU_PANE);
  await tickAt(w, 1_000);
  expect(f.askState()).toEqual(['held']);
  expect(f.sent, 'the question is held, not pushed').toEqual([]);
}

describe('the question clocks (Q3c, Review focus 7)', () => {
  it('an approval lapse is acted on the tick its notifyAt passes, even when the asks row is not due', async () => {
    const f = fixture(); const w = f.watcher();
    await heldPrompt(f, w);
    await tickAt(w, 55_000);                                   // the asks row runs here (last ran at +1 s)
    expect(f.approvalStates()).toEqual(['held']);
    at(61_000);
    expect(w.laneDue('asks'), 'the asks row is not due 6 s after it ran').toBe(false);
    await w.tick(); await settle();
    expect(f.approvalStates(), 'lapsed on the tick notifyAt passed').toEqual(['released']);
    expect(f.sent.map((p) => p.title).length, 'the deferred push is sent').toBe(1);
  });

  it('an ask lapse waits for the asks row', async () => {
    const f = fixture(); const w = f.watcher();
    await heldAsk(f, w);
    await tickAt(w, 175_000);                                  // the asks row runs; the window is still open
    expect(f.askState()).toEqual(['held']);
    at(182_000);
    expect(w.laneDue('asks'), 'the asks row is not due 7 s after it ran').toBe(false);
    await w.tick(); await settle();
    expect(f.askState(), 'past askNotifyAt, but the asks row is not due: still held').toEqual(['held']);
    expect(f.sent, 'nothing pushed before the asks row').toEqual([]);
    await tickAt(w, 185_000);                                  // 10 s after the last run: due
    expect(f.askState()).toEqual(['released']);
    expect(f.sent.length, 'the lapse pushes once, on the asks row').toBe(1);
  });

  it('a never-resolving fleet read does not delay an approval lapse', async () => {
    const f = fixture(); const w = f.watcher();
    await heldPrompt(f, w);
    // A second (subagent) row of the child, past the hook's ceiling (askAt + APPROVAL_HOOK_WAIT_S) and still in its window.
    at(2_000);
    f.insertApproval({ agentId: 'a0000000000000001', askAt: Date.now() - 600_000, notifyAt: Date.now() + 120_000, nonce: 'b' });
    // Only the ask half's read is parked (other lanes `tick` awaits read the same method): the call whose stack is
    // inside `sweepAsks`, which reaches `fleetFor` synchronously, before its first await.
    const target = w as unknown as { fleetFor: (...a: unknown[]) => Promise<unknown> };
    const real = target.fleetFor.bind(w);
    const parked: unknown[] = [];
    const stackOf = (): string => {
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 100;                           // a deep enough stack to see the half, whatever sits between
      try { return new Error().stack ?? ''; } finally { Error.stackTraceLimit = limit; }
    };
    vi.spyOn(target, 'fleetFor').mockImplementation((...a: unknown[]) => {
      if (!stackOf().includes('sweepAsks')) return real(...a);
      parked.push(a[0]);
      return new Promise<never>(() => { /* never settles */ });
    });
    at(61_000);
    expect(w.laneDue('asks'), 'the ask half is due, so it reaches its fleet read').toBe(true);
    await w.tick();                                             // no settle: only what tick's own turn did
    expect(parked.length, 'the ask half is parked on its fleet read').toBe(1);
    expect(f.approvalStates(), 'the main-thread row lapsed; the ceiling marked the subagent row stale').toEqual(['released', 'stale']);
    expect(f.sent.length, 'the deferred push is sent').toBe(1);
  });

  it('before primed, approvals still lapse; asks do not', async () => {
    const f = fixture(); const w1 = f.watcher();
    await heldAsk(f, w1);
    at(2_000);
    f.insertApproval({ agentId: 'a0000000000000001', askAt: Date.now(), notifyAt: Date.now() + 60_000, nonce: 'b' });
    const w2 = f.watcher();                                    // a restart: w2 is not primed
    f.sent.length = 0;
    await tickAt(w2, 200_000);                                 // the priming tick, past both windows
    expect(f.approvalStates(), 'the held approval past notifyAt lapsed on the priming tick').toEqual(['released']);
    expect(f.askState(), 'the held ask past its until is not released before primed').toEqual(['held']);
    expect(f.sent, 'and not pushed').toEqual([]);
    await tickAt(w2, 211_000);                                 // primed now: the ask half runs
    expect(f.askState()).toEqual(['released']);
    expect(f.sent.length, 'the re-seeded ask lapses once primed').toBe(1);
  });
});
