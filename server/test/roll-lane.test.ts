// The automatic coordinator roll's lane, release half (D-7452): the pass and its act. The act is ONE ccd verb,
// `ccd hibernate --roll` (D-7458: the sleep and the in-place resume inside ccd), recorded here through a runner that
// keeps every argv; nothing runs ccd, tmux or a process. `ccd-hibernate-roll.test.ts` pins the verb itself.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { PRESENCE_OPEN_TTL_MS, type FleetSession } from '../../shared/api.js';
import { CLAUDE_ROLL_TARGETS_DEFAULT, type ClaudeRollTargets } from '../../shared/claudeVersion.js';
import { ROLL_HOLD_OFF_MS, rollPass, type ReleaseRead, type RollSweepDeps, type RollSweepMemory } from '../src/rollLane.js';
import type { SleepActPort } from '../src/sleepLane.js';
type RollActPort = SleepActPort<FleetSession>;
import { ROLL_QUIET_MS } from '../src/coord/rollTarget.js';
import { HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER, type HibernateMark } from '../src/coord/hibernate.js';
import type { SessionRecord } from '../src/registry.js';
import type { CcdResult } from '../src/lifecycle.js';
import { UNMEASURED } from '../src/unmeasured.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { withBindingsOf } from './bindingsFake.js';
import { mkTmp } from './tmpHelpers.js';
import type { FleetState } from '../src/fleetstate.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const STARTED = NOW - PRESENCE_OPEN_TTL_MS - MIN;
const INSTALLED = NOW - 2 * HOUR;
const COORD = 'lane-a-project-a';
const COORD2 = 'lane-a-project-b';
const CHILD = 'lane-a-project-a-ws-child';

const row = (id: string, o: Partial<FleetSession> = {}): FleetSession => ({
  id, status: 'idle', archivedAt: null, bucket: 'idle', held: null, unmeasured: [], statusUnmeasured: false,
  dialogPending: false, background: null, subagents: null, stranded: null, swapBlocked: null, substrate: null,
  statusUpdatedAt: NOW - 2 * HOUR, role: 'coordinator', child: { kind: 'none' }, ...o,
}) as unknown as FleetSession;
const childRow = (id: string): FleetSession => row(id, { role: 'child', child: { kind: 'child', runId: 3 } });
const rec = (id: string): SessionRecord => ({ id, uuid: `uuid-${id}`, wrapper: 'lane-a' }) as unknown as SessionRecord;
const mark = (ageMs: number): HibernateMark =>
  ({ ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - ageMs - MIN, stopAt: NOW - ageMs, restartAt: null }) as HibernateMark;

const ok = (stdout = ''): CcdResult => ({ ok: true, stdout, stderr: '' }) as CcdResult;
const refused = (stderr: string): CcdResult => ({ ok: false, stdout: '', stderr, code: 3 }) as unknown as CcdResult;

interface Fake {
  deps: RollSweepDeps; lines: string[]; calls: string[][]; wakes: string[]; refunds: string[];
  set: { targets: ClaudeRollTargets | null; word: string; age: number; hibernate: (id: string) => CcdResult; wake: boolean };
}
function fake(o: { startedAt?: number | null; release?: ReleaseRead; verbs?: readonly string[] } = {}): Fake {
  const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-roll-'), '.ccrc', 'coord.db')));
  const lines: string[] = [];
  const calls: string[][] = [];
  const wakes: string[] = [];
  const refunds: string[] = [];
  const set: Fake['set'] = { targets: CLAUDE_ROLL_TARGETS_DEFAULT, word: 'idle', age: 2 * HOUR, hibernate: () => ok('hibernated'), wake: true };
  const fleetState = { ccdVerbs: o.verbs ?? ['hibernate', 'hibernate-roll', 'ensure', 'actor-flags-v1'] } as unknown as FleetState;
  const act: RollActPort = {
    runCcd: async (argv: readonly string[]) => {
      calls.push([...argv]);
      return argv[0] === 'hibernate' ? set.hibernate(argv.find((a) => !a.startsWith('-')) ?? '') : ok('ensured');
    },
    fleetState,
    serial: <T>(fn: () => Promise<T>) => fn(),
    queueRun: <T>(_id: string, fn: () => Promise<T>) => fn(),
    rowAtAct: async (r: SessionRecord) => ({ ok: true as const, row: r.id === CHILD ? childRow(r.id) : row(r.id) }),
    listing: async () => [],
    admitWake: (id: string) => { wakes.push(id); return set.wake ? { refund: () => { refunds.push(id); } } : null; },
  } as unknown as RollActPort;
  const deps: RollSweepDeps = {
    coord: withBindingsOf({
      openRunsForSession: (...a: Parameters<CoordStore['openRunsForSession']>) => coord.openRunsForSession(...a),
      activeClaims: () => coord.activeClaims(),
      outstandingMailFor: (id: string, n?: number) => coord.outstandingMailFor(id, n),
    }),
    targets: () => set.targets,
    release: async () => o.release ?? { kind: 'installed', at: INSTALLED },
    viewers: { isOpen: () => false },
    liveWord: async () => ({ ok: true, word: set.word, since: null }),
    mark: async () => mark(set.age),
    processStartedAt: async () => (o.startedAt === undefined ? NOW - 3 * HOUR : o.startedAt),
    readAfterHours: async () => null,
    log: (l) => { lines.push(l); },
    startedAt: STARTED,
    now: () => NOW,
    act,
  };
  return { deps, lines, calls, wakes, refunds, set };
}
const mem = (): RollSweepMemory => ({ lastAt: new Map(), lastWhat: new Map(), heldUntil: new Map() });
const pass = (f: Fake, rows: FleetSession[] = [row(COORD)], names: readonly string[] = [], m = mem()) =>
  rollPass(f.deps, m, rows, rows.map((r) => rec(r.id)), names);

describe('rollPass: what is rolled (D-7452)', () => {
  it('an idle coordinator behind on release is rolled after 90 minutes: ONE ccd call, hibernate --roll (D-7458)', async () => {
    const f = fake();
    f.set.age = ROLL_QUIET_MS + MIN;
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'rolled', idleMs: ROLL_QUIET_MS + MIN }]);
    expect(f.calls).toEqual([['hibernate', '--roll', COORD, '--surface', 'agent', '--actor', 'sweep:roll']]);
    expect(f.wakes).toEqual([COORD]);
  });

  it('.no-hibernate does not hold the roll: the act refuses .no-roll, not .no-hibernate (D-7458)', async () => {
    const f = fake();
    expect(await pass(f, [row(COORD)], [`${COORD}.no-hibernate`])).toEqual([{ id: COORD, kind: 'rolled', idleMs: 2 * HOUR }]);
    expect(f.calls.length).toBe(1);
  });

  it('.no-roll holds it and nothing is called', async () => {
    const f = fake();
    expect(await pass(f, [row(COORD)], [`${COORD}.no-roll`])).toEqual([{ id: COORD, kind: 'skipped', reason: 'no-roll' }]);
    expect(f.calls).toEqual([]);
  });

  it('a box whose ccd does not list hibernate-roll rolls nothing (unarmed), and no plain hibernate is sent', async () => {
    const f = fake({ verbs: ['hibernate', 'ensure', 'actor-flags-v1'] });
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'skipped', reason: 'unarmed' }]);
    expect(f.calls).toEqual([]);
  });

  it('before 90 minutes nothing is called', async () => {
    const f = fake();
    f.set.age = ROLL_QUIET_MS - MIN;
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'skipped', reason: 'idle-gate:recent' }]);
    expect(f.calls).toEqual([]);
  });

  it('an idle child is never rolled, and nothing is measured for it', async () => {
    const f = fake();
    let measured = 0;
    const live = f.deps.liveWord;
    const deps = { ...f.deps, liveWord: async (r: SessionRecord) => { measured++; return live(r); } };
    expect(await rollPass(deps, mem(), [childRow(CHILD)], [rec(CHILD)], [])).toEqual([{ id: CHILD, kind: 'skipped', reason: 'not-coordinator' }]);
    expect(f.calls).toEqual([]);
    expect(measured).toBe(0);
  });

  it('a coordinator already on the current release is left alone, with no journal line', async () => {
    const f = fake({ startedAt: INSTALLED + MIN });
    expect(await pass(f)).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(f.lines).toEqual([]);
  });

  it('a busy coordinator is not rolled', async () => {
    const f = fake();
    f.set.word = 'busy';
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'skipped', reason: 'idle-gate:live-word' }]);
    expect(f.calls).toEqual([]);
  });

  it('a drafting coordinator is not rolled: ccd refuses the roll, and nothing else is called', async () => {
    const f = fake();
    f.set.hibernate = () => refused('ccd: session-busy: draft — a message is half-typed in the input box; nothing was touched');
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'skipped', reason: 'ccd:draft' }]);
    expect(f.calls.map((c) => c[0])).toEqual(['hibernate']);
  });

  it('a compacting coordinator is not rolled', async () => {
    const f = fake();
    expect(await pass(f, [row(COORD, { statusUpdatedAt: NOW - 2 * MIN })])).toEqual([{ id: COORD, kind: 'skipped', reason: 'compacting' }]);
    expect(f.calls).toEqual([]);
  });

  it('a coordinator due hibernation within 30 minutes is not rolled', async () => {
    const f = fake();
    f.set.age = 5 * HOUR + 40 * MIN;
    expect(await pass(f, [row(COORD)], [HIBERNATE_LIVE_MARKER])).toEqual([{ id: COORD, kind: 'skipped', reason: 'hibernation-due' }]);
    expect(f.calls).toEqual([]);
  });

  it('one coordinator per pass: the second waits for the next pass', async () => {
    const f = fake();
    expect(await pass(f, [row(COORD), row(COORD2)])).toEqual([
      { id: COORD, kind: 'rolled', idleMs: 2 * HOUR },
      { id: COORD2, kind: 'skipped', reason: 'one-per-pass' },
    ]);
    expect(f.calls.filter((c) => c[0] === 'hibernate').length).toBe(1);
  });

  it('a full wake budget rolls nothing', async () => {
    const f = fake();
    f.set.wake = false;
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'skipped', reason: 'wake-budget' }]);
    expect(f.calls).toEqual([]);
  });

  it('a wake that fails (ccd exit 4, roll-wake-failed) leaves the coordinator hibernated and says so', async () => {
    const f = fake();
    f.set.hibernate = () => ({ ok: false, ran: true, stdout: 'hibernated', stderr: 'ccd: roll-wake-failed — lane-a-project-a was hibernated and its wake exited 5', code: 4 }) as unknown as CcdResult;
    expect((await pass(f))[0]!.kind).toBe('woke-failed');
    expect(f.calls.length, 'the wake is inside the one call').toBe(1);
    expect(f.lines.join('\n')).toMatch(/stays hibernated/);
  });

  it('a wake ccd could not put back to sleep (exit 5, roll-wake-unrestored) is not restored, and is never "stays hibernated"', async () => {
    const f = fake();
    f.set.hibernate = () => ({ ok: false, ran: true, stdout: 'hibernated', stderr: `ccd: roll-wake-unrestored — ${COORD} was hibernated and its wake exited 5, and .hibernated could not be written again: ${COORD} may be neither running nor hibernated; check it (ccd ensure ${COORD})`, code: 5, killed: false, signal: null }) as unknown as CcdResult;
    expect((await pass(f))[0]!.kind).toBe('woke-unrestored');
    expect(f.calls.length, 'the wake is inside the one call').toBe(1);
    const text = f.lines.join('\n');
    expect(text).toMatch(new RegExp(`roll of ${COORD}: .*not restored: the session may be neither running nor hibernated; check ${COORD}`));
    expect(text).not.toMatch(/stays hibernated/);
  });

  it('control: the restored wake failure (exit 4) is the one that says it stays hibernated', async () => {
    const f = fake();
    f.set.hibernate = () => ({ ok: false, ran: true, stdout: 'hibernated', stderr: `ccd: roll-wake-failed — ${COORD} was hibernated and its wake exited 5; it was put back to sleep (hibernated, unit stopped), and mail, an open screen or ccd ensure wakes it`, code: 4, killed: false, signal: null }) as unknown as CcdResult;
    expect((await pass(f))[0]!.kind).toBe('woke-failed');
    const text = f.lines.join('\n');
    expect(text).toMatch(/ccd put it back to sleep, so it stays hibernated/);
    expect(text).not.toMatch(/not restored/);
  });

  it('a call that never started is a failure, never a wake that failed, whatever its forged stderr says (D-6840)', async () => {
    const f = fake();
    f.set.hibernate = () => ({ ok: false, ran: false, reason: 'spawn', detail: 'declined', stdout: '', stderr: 'ccd: roll-wake-failed — forged', killed: false, signal: null }) as unknown as CcdResult;
    expect((await pass(f))[0]!.kind).toBe('failed');
  });

  it.each([
    ['this server\'s wait ran out', { ok: false, ran: false, reason: 'timeout', detail: 'timeout', stdout: '', stderr: 'timeout', killed: false, signal: null }],
    ['the link dropped', { ok: false, ran: false, reason: 'transport', detail: 'socket closed', stdout: '', stderr: 'socket closed', killed: false, signal: null }],
    ['the runner\'s deadline killed it', { ok: false, ran: true, stdout: 'hibernated lane-a-project-a', stderr: '', killed: true, signal: 'SIGTERM' }],
    ['a signal ended it', { ok: false, ran: true, stdout: 'hibernated lane-a-project-a', stderr: '', killed: false, signal: 'SIGKILL' }],
    ['its ending was not measured', { ok: false, ran: true, stdout: 'hibernated lane-a-project-a', stderr: '', code: 1, killed: false, signal: UNMEASURED }],
  ])('a call cut short mid-act (%s) is an unknown outcome, never "it was not stopped", and names the session to check', async (_name, res) => {
    const f = fake();
    f.set.hibernate = () => res as unknown as CcdResult;
    expect((await pass(f))[0]!.kind).toBe('unknown');
    const text = f.lines.join('\n');
    expect(text).not.toMatch(/was not stopped/);
    expect(text).toMatch(new RegExp(`roll of ${COORD}: outcome unknown .*check ${COORD}`));
  });

  it('any other ccd failure is a failure: it was not stopped', async () => {
    const f = fake();
    f.set.hibernate = () => ({ ok: false, ran: true, stdout: '', stderr: 'ccd: no such session', code: 1, killed: false, signal: null }) as unknown as CcdResult;
    expect((await pass(f))[0]!.kind).toBe('failed');
    expect(f.lines.join('\n')).toMatch(/it was not stopped/);
  });
});

describe('rollPass: the setting and the switches (D-7453)', () => {
  it('the setting off rolls nothing and measures nothing', async () => {
    const f = fake();
    f.set.targets = 'off';
    expect(await pass(f, [row(COORD), childRow(CHILD)])).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(f.lines).toEqual(['ccrc-server: roll-skip all: setting-off']);
  });

  it('a setting that could not be read rolls nothing', async () => {
    const f = fake();
    f.set.targets = null;
    expect(await pass(f)).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it('an install time that could not be read rolls nothing, in one line for the pass', async () => {
    const f = fake({ release: { kind: 'unreadable' } });
    expect(await pass(f, [row(COORD), row(COORD2)])).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(f.lines).toEqual([expect.stringMatching(/^ccrc-server: roll-skip all: release-unmeasured/)]);
  });

  it('a node with no completed install has no release to be behind on: nothing is rolled and nothing is written', async () => {
    const f = fake({ release: { kind: 'none' } });
    expect(await pass(f, [row(COORD), row(COORD2)])).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(f.lines).toEqual([]);
  });

  it('hibernate-disabled rolls nothing', async () => {
    const f = fake();
    expect(await pass(f, [row(COORD)], [HIBERNATE_DISABLED_MARKER])).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it('the setting turned off between the pass and the act rolls nothing', async () => {
    const f = fake();
    const rowAtAct = f.deps.act!.rowAtAct;
    (f.deps.act as { rowAtAct: RollActPort['rowAtAct'] }).rowAtAct = async (r) => { f.set.targets = 'off'; return rowAtAct(r); };
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'skipped', reason: 'setting-off' }]);
    expect(f.calls).toEqual([]);
  });

  it('every skip is journalled with its reason, once an hour unless the reason changes', async () => {
    const f = fake();
    f.set.word = 'busy';
    const m = mem();
    await pass(f, [row(COORD)], [], m);
    await pass(f, [row(COORD)], [], m);
    expect(f.lines).toEqual([`ccrc-server: roll-skip ${COORD}: idle-gate:live-word`]);
    f.set.word = 'idle';
    f.set.age = ROLL_QUIET_MS - MIN;
    await pass(f, [row(COORD)], [], m);
    expect(f.lines).toEqual([
      `ccrc-server: roll-skip ${COORD}: idle-gate:live-word`, `ccrc-server: roll-skip ${COORD}: idle-gate:recent`,
    ]);
  });

  it('with no act port nothing is rolled, and that is journalled', async () => {
    const f = fake();
    expect(await rollPass({ ...f.deps, act: null }, mem(), [row(COORD)], [rec(COORD)], [])).toEqual([{ id: COORD, kind: 'skipped', reason: 'unarmed' }]);
  });
});

/** A real coordination serialiser: one holder at a time, FIFO, as `CoordMutex` is. */
function mutex(): { serial: <T>(fn: () => Promise<T>) => Promise<T>; held: () => boolean } {
  let tail: Promise<unknown> = Promise.resolve();
  let held = false;
  return {
    serial: <T>(fn: () => Promise<T>): Promise<T> => {
      const run = tail.then(async () => { held = true; try { return await fn(); } finally { held = false; } });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
    held: () => held,
  };
}
const settle = async (): Promise<void> => { for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r)); };
/** The fake's port with the ccd call held open until the test answers it. */
function inFlight(f: Fake): { answer: (r: CcdResult) => void; heldAtCall: () => boolean | null; m: ReturnType<typeof mutex> } {
  const m = mutex();
  let answer: ((r: CcdResult) => void) | null = null;
  let heldAtCall: boolean | null = null;
  const act = f.deps.act as unknown as { serial: unknown; runCcd: unknown };
  act.serial = m.serial;
  act.runCcd = (argv: readonly string[]) => {
    f.calls.push([...argv]);
    heldAtCall = m.held();
    return new Promise<CcdResult>((r) => { answer = r; });
  };
  return { answer: (r) => { answer!(r); }, heldAtCall: () => heldAtCall, m };
}

describe('the roll does not hold the coordination serialiser across its ccd call (D-7541)', () => {
  it('a coordination write issued while the roll call is in flight is not blocked by it', async () => {
    const f = fake();
    const t = inFlight(f);
    const p = pass(f);
    await settle();
    expect(f.calls.length, 'the roll call is in flight').toBe(1);
    expect(t.heldAtCall(), 'the serialiser is free while ccd runs').toBe(false);
    const write = await Promise.race([
      t.m.serial(async () => 'written'),
      new Promise((r) => setTimeout(() => r('blocked'), 500)),
    ]);
    expect(write).toBe('written');
    t.answer(ok(`hibernated ${COORD}\nrolled ${COORD}`));
    expect(await p).toEqual([{ id: COORD, kind: 'rolled', idleMs: 2 * HOUR }]);
  });

  it('control: the reads before and after the call run on the serialiser; the re-ask beside the call on the session\'s queue only (D-7552)', async () => {
    const f = fake();
    const t = inFlight(f);
    const heldAt: boolean[] = [];
    const rowAtAct = f.deps.act!.rowAtAct;
    (f.deps.act as { rowAtAct: RollActPort['rowAtAct'] }).rowAtAct = async (r) => { heldAt.push(t.m.held()); return rowAtAct(r); };
    const p = pass(f);
    await settle();
    t.answer(ok(`rolled ${COORD}`));
    await p;
    expect(heldAt, 'read before the call on the serialiser, beside it off it, and after it on it again').toEqual([true, false, true]);
  });

  it('the target is asked again on the serialiser after the call: a setting turned off meanwhile is journalled beside the roll', async () => {
    const f = fake();
    const t = inFlight(f);
    const p = pass(f);
    await settle();
    f.set.targets = 'off';
    t.answer(ok(`rolled ${COORD}`));
    expect(await p).toEqual([{ id: COORD, kind: 'rolled', idleMs: 2 * HOUR, after: 'setting-off' }]);
    expect(f.lines.join('\n')).toMatch(new RegExp(`rolled ${COORD} onto the current release .*; by the time ccd answered it was no longer a roll target \\(setting-off\\)`));
  });

  it('a row that stopped being a coordinator while the call ran is journalled so', async () => {
    const f = fake();
    const t = inFlight(f);
    const p = pass(f);
    await settle();
    (f.deps.act as { rowAtAct: RollActPort['rowAtAct'] }).rowAtAct = async (r) => ({ ok: true as const, row: childRow(r.id) });
    t.answer(ok(`rolled ${COORD}`));
    expect(await p).toEqual([{ id: COORD, kind: 'rolled', idleMs: 2 * HOUR, after: 'not-coordinator' }]);
  });

  it('control: a target still eligible after the call is a plain roll', async () => {
    const f = fake();
    const t = inFlight(f);
    const p = pass(f);
    await settle();
    t.answer(ok(`rolled ${COORD}`));
    expect(await p).toEqual([{ id: COORD, kind: 'rolled', idleMs: 2 * HOUR }]);
    expect(f.lines.join('\n')).not.toMatch(/no longer a roll target/);
  });
});

describe('a roll that woke nothing gives its wake-budget slot back (D-7542)', () => {
  it('ccd refusing the roll (session-busy) refunds the wake', async () => {
    const f = fake();
    f.set.hibernate = () => refused('ccd: session-busy: draft — a message is half-typed in the input box; nothing was touched');
    await pass(f);
    expect(f.wakes).toEqual([COORD]);
    expect(f.refunds).toEqual([COORD]);
  });

  it('a wake that failed and was put back to sleep (exit 4) refunds the wake', async () => {
    const f = fake();
    f.set.hibernate = () => ({ ok: false, ran: true, stdout: 'hibernated', stderr: `ccd: roll-wake-failed — ${COORD} was hibernated and its wake exited 5`, code: 4, killed: false, signal: null }) as unknown as CcdResult;
    await pass(f);
    expect(f.refunds).toEqual([COORD]);
  });

  it('a plain failure before anything stopped refunds the wake, and so does a call that never started', async () => {
    const f = fake();
    f.set.hibernate = () => ({ ok: false, ran: true, stdout: '', stderr: 'ccd: no such session', code: 1, killed: false, signal: null }) as unknown as CcdResult;
    await pass(f);
    expect(f.refunds).toEqual([COORD]);
    const g = fake();
    g.set.hibernate = () => ({ ok: false, ran: false, reason: 'spawn', detail: 'declined', stdout: '', stderr: '', killed: false, signal: null }) as unknown as CcdResult;
    await pass(g);
    expect(g.refunds).toEqual([COORD]);
  });

  it('a pane kill that failed (exit 6) refunds the wake: nothing was woken', async () => {
    const f = fake();
    f.set.hibernate = () => ({ ok: false, ran: true, stdout: '', stderr: `ccd: roll-kill-failed — ${COORD}'s pane could not be killed and is still live, so it was not rolled`, code: 6, killed: false, signal: null }) as unknown as CcdResult;
    await pass(f);
    expect(f.refunds).toEqual([COORD]);
  });

  it('a roll that landed keeps its wake spent; so do an unrestored wake and an unknown ending, which may have spawned', async () => {
    const f = fake();
    await pass(f);
    expect(f.refunds).toEqual([]);
    const g = fake();
    g.set.hibernate = () => ({ ok: false, ran: true, stdout: 'hibernated', stderr: `ccd: roll-wake-unrestored — ${COORD} was hibernated and its wake exited 5`, code: 5, killed: false, signal: null }) as unknown as CcdResult;
    await pass(g);
    expect(g.refunds).toEqual([]);
    const u = fake();
    u.set.hibernate = () => ({ ok: false, ran: false, reason: 'timeout', detail: 'timeout', stdout: '', stderr: 'timeout', killed: false, signal: null }) as unknown as CcdResult;
    await pass(u);
    expect(u.refunds).toEqual([]);
  });
});

describe('a pane kill that failed on a live pane is never a roll (exit 6, roll-kill-failed)', () => {
  it('is its own outcome, and its line says it was not rolled and names the session to check', async () => {
    const f = fake();
    f.set.hibernate = () => ({ ok: false, ran: true, stdout: '', stderr: `ccd: roll-kill-failed — ${COORD}'s pane could not be killed and is still live, so it was not rolled`, code: 6, killed: false, signal: null }) as unknown as CcdResult;
    expect((await pass(f))[0]!.kind).toBe('kill-failed');
    const text = f.lines.join('\n');
    expect(text).toMatch(new RegExp(`roll of ${COORD}: its pane could not be killed .*it was not rolled.*check ${COORD}`));
    expect(text).not.toMatch(/rolled lane/);
    expect(text).not.toMatch(/it was not stopped/);
  });
});


describe('the woke-unrestored line is worded from ccd\'s branch, never a cause ccd did not report', () => {
  const unrestored = (why: string): CcdResult => ({ ok: false, ran: true, stdout: 'hibernated', stderr: `ccd: roll-wake-unrestored — ${COORD} was hibernated and its wake exited 5, and ${why}: ${COORD} may be neither running nor hibernated; check it (ccd ensure ${COORD})`, code: 5, killed: false, signal: null }) as unknown as CcdResult;

  it('the unit branch (its unit could not be stopped again) is never said to be a marker that could not be written', async () => {
    const f = fake();
    f.set.hibernate = () => unrestored(`its unit claude-session@${COORD} could not be stopped again`);
    expect((await pass(f))[0]!.kind).toBe('woke-unrestored');
    const text = f.lines.join('\n');
    expect(text).not.toMatch(/ccd could not write its hibernated marker/);
    expect(text).toMatch(new RegExp(`roll of ${COORD}: its wake failed \\(.*\\) and ccd could not put it back to sleep, so it was not restored: the session may be neither running nor hibernated; check ${COORD}`));
  });

  it('control: the marker branch reads the same, and its cause stays in ccd\'s own words in the parentheses', async () => {
    const f = fake();
    f.set.hibernate = () => unrestored(`/reg/${COORD}.hibernated could not be written again`);
    await pass(f);
    const text = f.lines.join('\n');
    expect(text).toMatch(/\.hibernated could not be written again/);
    expect(text).toMatch(/and ccd could not put it back to sleep, so it was not restored/);
  });
});

describe('a throw once ccd has been called is never "it was not stopped"', () => {
  it('the target re-asked after a roll that landed throws (the link dropped): it is still a roll, its re-ask unmeasured, its wake spent', async () => {
    const f = fake();
    const rowAtAct = f.deps.act!.rowAtAct;
    (f.deps.act as { rowAtAct: RollActPort['rowAtAct'] }).rowAtAct = async (r) => {
      if (f.calls.length > 0) throw new Error('link dropped');
      return rowAtAct(r);
    };
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'rolled', idleMs: 2 * HOUR, after: 'row-unmeasured' }]);
    expect(f.calls.length).toBe(1);
    expect(f.refunds).toEqual([]);
    const text = f.lines.join('\n');
    expect(text).not.toMatch(/was not stopped/);
    expect(text).not.toMatch(/no longer a roll target/);
    expect(text).toMatch(new RegExp(`rolled ${COORD} onto the current release .*; once ccd answered, whether it was still a roll target could not be read again \\(row-unmeasured\\)`));
  });

  it('a throw from the call itself is an unknown outcome that names the session to check, and keeps its wake spent', async () => {
    const f = fake();
    f.set.hibernate = () => { throw new Error('link dropped'); };
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'unknown', detail: 'link dropped' }]);
    expect(f.refunds).toEqual([]);
    const text = f.lines.join('\n');
    expect(text).not.toMatch(/was not stopped/);
    expect(text).toMatch(new RegExp(`roll of ${COORD}: outcome unknown .*check ${COORD}`));
  });

  it('control: a throw before the call is a failure that stopped nothing, and refunds the wake', async () => {
    const f = fake();
    (f.deps.act as { listing: RollActPort['listing'] }).listing = async () => { throw new Error('listing failed'); };
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'failed', detail: 'listing failed' }]);
    expect(f.calls).toEqual([]);
  });
});

/** The process's per-session write queue as `KeyedQueue` is: FIFO per id. */
function keyedQueue(): <T>(id: string, fn: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const run = (tails.get(id) ?? Promise.resolve()).then(fn);
    tails.set(id, run.then(() => undefined, () => undefined));
    return run;
  };
}

describe('the roll is asked again beside its call, on the session\'s queue', () => {
  it('a task queued on the session while the reads ran (a prompt sent) holds the roll: ccd is not called and the wake is given back', async () => {
    const f = fake();
    const q = keyedQueue();
    (f.deps.act as { queueRun: RollActPort['queueRun'] }).queueRun = q;
    const rowAtAct = f.deps.act!.rowAtAct;
    let first = true;
    (f.deps.act as { rowAtAct: RollActPort['rowAtAct'] }).rowAtAct = async (r) => {
      if (first) { first = false; void q(COORD, async () => { f.set.word = 'busy'; }); }
      return rowAtAct(r);
    };
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'skipped', reason: 'idle-gate:live-word' }]);
    expect(f.calls).toEqual([]);
    expect(f.wakes).toEqual([COORD]);
    expect(f.refunds).toEqual([COORD]);
  });

  it('a kill switch raised while the reads ran holds the roll beside its call', async () => {
    const f = fake();
    const q = keyedQueue();
    (f.deps.act as { queueRun: RollActPort['queueRun'] }).queueRun = q;
    let listed = 0;
    (f.deps.act as { listing: RollActPort['listing'] }).listing = async () => (listed++ === 0 ? [] : [HIBERNATE_DISABLED_MARKER]);
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'skipped', reason: HIBERNATE_DISABLED_MARKER }]);
    expect(f.calls).toEqual([]);
    expect(f.refunds).toEqual([COORD]);
  });

  it('control: with nothing queued meanwhile the roll lands, with one ccd call', async () => {
    const f = fake();
    (f.deps.act as { queueRun: RollActPort['queueRun'] }).queueRun = keyedQueue();
    expect(await pass(f)).toEqual([{ id: COORD, kind: 'rolled', idleMs: 2 * HOUR }]);
    expect(f.calls.length).toBe(1);
  });
});

describe('a coordinator that will not roll does not keep the others from rolling', () => {
  it('the first coordinator\'s ccd always answers session-busy: draft, and the second is rolled within two passes', async () => {
    const f = fake();
    f.set.hibernate = () => (f.calls.at(-1)!.includes(COORD) ? refused('ccd: session-busy: draft — a message is half-typed in the input box; nothing was touched') : ok('rolled'));
    const m = mem();
    const rolled: string[] = [];
    for (let i = 0; i < 2; i++) {
      for (const o of await pass(f, [row(COORD), row(COORD2)], [], m)) if (o.kind === 'rolled') rolled.push(o.id);
    }
    expect(rolled).toEqual([COORD2]);
  });

  it('the same holds when the act re-ask holds the first coordinator (held at the act)', async () => {
    const f = fake();
    const rowAtAct = f.deps.act!.rowAtAct;
    (f.deps.act as { rowAtAct: RollActPort['rowAtAct'] }).rowAtAct = async (r) => (r.id === COORD ? { ok: false as const } : rowAtAct(r));
    const m = mem();
    const rolled: string[] = [];
    for (let i = 0; i < 2; i++) {
      for (const o of await pass(f, [row(COORD), row(COORD2)], [], m)) if (o.kind === 'rolled') rolled.push(o.id);
    }
    expect(rolled).toEqual([COORD2]);
  });

  it('control: the held-off coordinator is asked again once its hold-off ends', async () => {
    const f = fake();
    let busy = true;
    f.set.hibernate = () => (busy ? refused('ccd: session-busy: draft — half-typed') : ok('rolled'));
    const m = mem();
    let now = NOW;
    const deps = { ...f.deps, now: () => now };
    await rollPass(deps, m, [row(COORD)], [rec(COORD)], []);
    busy = false;
    expect(await rollPass(deps, m, [row(COORD)], [rec(COORD)], []), 'held off: not asked').toEqual([]);
    expect(f.calls.length).toBe(1);
    now = NOW + ROLL_HOLD_OFF_MS;
    expect(await rollPass(deps, m, [row(COORD)], [rec(COORD)], [])).toEqual([{ id: COORD, kind: 'rolled', idleMs: 2 * HOUR + ROLL_HOLD_OFF_MS }]);
  });
});
