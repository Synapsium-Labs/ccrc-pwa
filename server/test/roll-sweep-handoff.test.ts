// The roll lane's hand-off to the renewal lane, through the REAL watcher (Overlord W1a, the renewal hand-offs, Task 5).
// `roll-lane.test.ts` hands `rollPass` its own `continuity` dep; the dep is optional, so a `sweepRoll` that stopped
// passing the store would leave every one of those green while production rolled the long-lived sessions the renewal lane
// owns. This file drives `FleetWatcher.sweepRoll` itself: a fixture HOME, a scripted tmux, the live-state file and the turn
// marker on disk, and a recording ccd runner. The control case (continuity shadow) proves the harness reaches the act.
// The second block drives `rollPass` for the act-time re-read of the row (review 2312 F6).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import type { FleetState } from '../src/fleetstate.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { CONTINUITY_LANE } from '../../shared/lane-arm.js';
import { HIBERNATE_LIVE_MARKER } from '../src/coord/hibernate.js';
import { rollPass, type RollSweepDeps, type RollSweepMemory } from '../src/rollLane.js';
import { CLAUDE_ROLL_TARGETS_DEFAULT } from '../../shared/claudeVersion.js';
import { VIEWER_OPEN_TTL_MS } from '../../shared/api.js';
import type { HibernateMark } from '../src/coord/hibernate.js';
import { withBindingsOf } from './bindingsFake.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';
import type { FleetSession } from '../../shared/api.js';
import type { SessionRecord } from '../src/registry.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const HOUR = 3_600_000;
const ID = 'lane-a-project-a';
const UUID = 'a'.repeat(36);
const PID = 4242;
const VERBS = ['hibernate', 'hibernate-roll', 'ensure', 'actor-flags-v1'];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW - 3 * HOUR);   // the watcher starts here, so presence is not believed by the time of the sweep
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const row = (): FleetSession => ({
  hibernatedAt: null, id: ID, wrapper: 'claude', home: '/home/u', project: 'demo', workdir: '/w/demo', workspace: `${ID}-ws`,
  name: null, title: null, status: 'idle', statusUpdatedAt: NOW - 2 * HOUR, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null,
  archivedBytes: null, hookState: null, askSummary: null, subagents: null, background: null, lastEnd: null, graphQueries: null,
  graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: 'running', stoppedBy: null, swapBlocked: null, stranded: null, limitWait: null, substrate: null, started: true,
  spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, role: 'coordinator',
  releasedFrom: null, withCoordinator: null,
}) as FleetSession;

const record = (): SessionRecord => ({
  hibernatedAt: null, namedByOperator: false, title: null, id: ID, wrapper: 'claude', project: 'demo', projectEvidence: 'measured',
  workdir: '/w/demo', uuid: UUID, started: true, home: null, pool: null, lastswap: null, workspace: `${ID}-ws`, branch: null,
  branchEvidence: 'absent', base: null, prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null,
  held: null, substrate: null, stopped: null, supervisedAt: null, swapBlocked: null, stranded: null, spawn: null, lastEnd: null,
  lifecycleUnmeasured: [], unmeasured: [], route: null, child: { kind: 'none' },
}) as unknown as SessionRecord;

/** A fixture HOME with one idle coordinator whose pane started before the node's install (so it is behind), idle past the quiet window. */
async function rig(): Promise<{ w: FleetWatcher; coord: CoordStore; ccd: string[][]; warns: string[] }> {
  const home = mkTmp('ccrc-roll-sweep-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid: UUID, started: '1' })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
  const live = path.join(home, '.claude', 'sessions');
  mkdirSync(live, { recursive: true });
  writeFileSync(path.join(live, `${PID}.json`), JSON.stringify({ pid: PID, sessionId: UUID, cwd: '/w/demo', name: null, nameSource: null,
    status: 'idle', statusUpdatedAt: NOW - 2 * HOUR, version: '2.1.284', startedAt: NOW - 3 * HOUR + 60_000 }));
  writeFileSync(path.join(reg, `${ID}.turn.json`), JSON.stringify({ v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: NOW - 2 * HOUR,
    turnAt: NOW - 2 * HOUR - 600_000, stopAt: NOW - 2 * HOUR, bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', crons: 0 }));
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  const installed = path.join(home, '.ccrc', 'installed');
  writeFileSync(installed, '{}');
  utimesSync(installed, new Date(NOW - HOUR), new Date(NOW - HOUR));
  const ccd: string[][] = [];
  const run: Runner = async (cmd, args) => {
    if (cmd.endsWith('/ccd')) ccd.push([...args]);
    if (args[0] === 'list-panes') return { ran: true as const, code: 0, stdout: args.includes('-a') ? `cc-${ID} 1 0 ${PID}\n` : `${PID}\n`, stderr: '' };
    if (args[0] === 'has-session') return { ran: true as const, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'capture-pane') return { ran: true as const, code: 0, stdout: '❯ \n', stderr: '' };
    return cmd.endsWith('/ccd') ? { ran: true as const, code: 0, stdout: 'hibernated', stderr: '' } : { ran: true as const, code: 1, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: Deps = { ...testDeps(home, run), coord, fleetState: { ccdVerbs: VERBS } as unknown as FleetState, viewers: { isOpen: () => false } as never };
  const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000, path.join(home, 'state-cache.json')));
  w.useStopDoneSerialiser({ serial: <T>(fn: () => Promise<T>) => fn() } as never);
  const warns: string[] = [];
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warns.push(a.map(String).join(' ')); });
  await w.tick();                       // priming
  vi.setSystemTime(NOW);
  return { w, coord, ccd, warns };
}

const sweep = async (w: FleetWatcher): Promise<void> => {
  await w.sweepRoll([row()], [record()], [HIBERNATE_LIVE_MARKER]);
};
/** A coordinator claiming an open run: long-lived, so the renewal lane owns it while `continuity` is live. */
const claimRun = (coord: CoordStore): void => {
  coord.db.exec("INSERT OR IGNORE INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'P', 1, 'active')");
  coord.db.prepare("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('prog-a', 1, 2, 'project-a', 'working', ?, 1)").run(ID);
};

describe('FleetWatcher.sweepRoll: the hand-off to the renewal lane', () => {
  it('control: with the continuity row in shadow, the long-lived coordinator is rolled (one ccd hibernate --roll)', async () => {
    const { w, coord, ccd } = await rig();
    claimRun(coord);
    await sweep(w);
    expect(ccd.filter((a) => a[0] === 'hibernate')).toEqual([['hibernate', '--roll', ID, '--surface', 'agent', '--actor', 'sweep:roll']]);
  }, 60_000);

  it('continuity live: the same coordinator is skipped renewal-owns and no hibernate is sent', async () => {
    const { w, coord, ccd, warns } = await rig();
    claimRun(coord);
    coord.setLaneArm(CONTINUITY_LANE, 'live', 1);
    await sweep(w);
    expect(ccd.filter((a) => a[0] === 'hibernate')).toEqual([]);
    expect(warns).toContain(`ccrc-server: roll-skip ${ID}: renewal-owns`);
  }, 60_000);
});

describe('rollPass: the act-time re-check reads the continuity row again (review 2312 F6)', () => {
  const MIN = 60_000;
  it('a row that goes live between the pass read and the act holds the session role-unknown, and nothing is hibernated', async () => {
    const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-roll-flip-'), '.ccrc', 'coord.db')));
    const calls: string[][] = [];
    let releases = 0;
    const mark = { ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - 2 * HOUR - MIN, stopAt: NOW - 2 * HOUR, restartAt: null } as HibernateMark;
    const deps: RollSweepDeps = {
      coord: withBindingsOf({ openRunsForSession: (...a: Parameters<CoordStore['openRunsForSession']>) => coord.openRunsForSession(...a),
        activeClaims: () => coord.activeClaims(), outstandingMailFor: (id: string, n?: number) => coord.outstandingMailFor(id, n),
        designationRead: () => coord.designationRead() }),
      continuity: coord,
      targets: () => CLAUDE_ROLL_TARGETS_DEFAULT,
      // The pass reads the node's install once; the act-time re-check reads it again, and the operator arms `continuity` between the two.
      release: async () => { if (++releases === 2) coord.setLaneArm(CONTINUITY_LANE, 'live', 1); return { kind: 'installed', at: NOW - 2 * HOUR }; },
      viewers: { isOpen: () => false },
      liveWord: async () => ({ ok: true, word: 'idle', since: null }),
      mark: async () => mark,
      processStartedAt: async () => NOW - 3 * HOUR,
      readAfterHours: async () => null,
      log: () => { /* the outcome is asserted */ },
      startedAt: NOW - VIEWER_OPEN_TTL_MS - MIN, now: () => NOW,
      act: {
        runCcd: async (argv: readonly string[]) => { calls.push([...argv]); return { ok: true, stdout: 'hibernated', stderr: '' }; },
        fleetState: { ccdVerbs: VERBS } as unknown as FleetState,
        serial: <T>(fn: () => Promise<T>) => fn(), queueRun: <T>(_id: string, fn: () => Promise<T>) => fn(),
        rowAtAct: async () => ({ ok: true as const, row: row() }), listing: async () => [], admitWake: () => ({ refund: () => { /* none */ } }),
      } as never,
    };
    const m: RollSweepMemory = { lastAt: new Map(), lastWhat: new Map(), heldUntil: new Map(), builtFor: new Map(), modelFor: new Map() };
    claimRun(coord);
    const out = await rollPass(deps, m, [row()], [record()], [HIBERNATE_LIVE_MARKER]);
    expect(releases, 'the flip ran between the pass read and the act').toBeGreaterThanOrEqual(2);
    expect(calls).toEqual([]);
    expect(out).toEqual([{ id: ID, kind: 'skipped', reason: 'role-unknown' }]);
  }, 60_000);
});
