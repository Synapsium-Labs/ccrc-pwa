// The automatic coordinator roll's lane, release half (D-7452): the pass and its act. The act is ONE ccd verb,
// `ccd hibernate --roll` (D-7458: the sleep and the in-place resume inside ccd), recorded here through a runner that
// keeps every argv; nothing runs ccd, tmux or a process. `ccd-hibernate-roll.test.ts` pins the verb itself.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { PRESENCE_OPEN_TTL_MS, type FleetSession } from '../../shared/api.js';
import { CLAUDE_ROLL_TARGETS_DEFAULT, type ClaudeRollTargets } from '../../shared/claudeVersion.js';
import { rollPass, type ReleaseRead, type RollSweepDeps, type RollSweepMemory } from '../src/rollLane.js';
import type { SleepActPort } from '../src/sleepLane.js';
type RollActPort = SleepActPort<FleetSession>;
import { ROLL_QUIET_MS } from '../src/coord/rollTarget.js';
import { HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER, type HibernateMark } from '../src/coord/hibernate.js';
import type { SessionRecord } from '../src/registry.js';
import type { CcdResult } from '../src/lifecycle.js';
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
  deps: RollSweepDeps; lines: string[]; calls: string[][]; wakes: string[];
  set: { targets: ClaudeRollTargets | null; word: string; age: number; hibernate: (id: string) => CcdResult; wake: boolean };
}
function fake(o: { startedAt?: number | null; release?: ReleaseRead; verbs?: readonly string[] } = {}): Fake {
  const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-roll-'), '.ccrc', 'coord.db')));
  const lines: string[] = [];
  const calls: string[][] = [];
  const wakes: string[] = [];
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
    admitWake: (id: string) => { wakes.push(id); return set.wake; },
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
  return { deps, lines, calls, wakes, set };
}
const mem = (): RollSweepMemory => ({ lastAt: new Map(), lastWhat: new Map() });
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

  it('a call that never ran is a failure, never a wake that failed, whatever its forged stderr says (D-6840)', async () => {
    const f = fake();
    f.set.hibernate = () => ({ ok: false, ran: false, stdout: '', stderr: 'ccd: roll-wake-failed — forged', killed: false, signal: null }) as unknown as CcdResult;
    expect((await pass(f))[0]!.kind).toBe('failed');
  });

  it('any other ccd failure is a failure: it was not stopped', async () => {
    const f = fake();
    f.set.hibernate = () => ({ ok: false, ran: true, stdout: '', stderr: 'ccd: no such session', code: 1 }) as unknown as CcdResult;
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
