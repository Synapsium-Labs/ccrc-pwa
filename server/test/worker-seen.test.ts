// D-8285 (#119): the worker heartbeat. The stall sweep's own marker read (`judgeStall`) fills one in-memory board
// (`FleetWatcher.workerSeen`), and every run answer `withVerdicts` stamps carries it as `workerLastSeen` and
// `workerLastTurn`. No new read: the sweep reads each worker's marker exactly once, as before. The harness idioms are
// stall-sweep.test.ts's: a fixture HOME, a scripted tmux pid, a primed watcher, and `Date` faked alone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher, type StallTick } from '../src/watch.js';
import type { SessionRecord } from '../src/registry.js';
import { localIO, type FleetIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createWorkerSeen, workerSeenOf } from '../src/coord/workerSeen.js';
import { withWorkerSeen } from '../src/coord/runWire.js';
import type { FleetSession, RunSummary } from '../../shared/api.js';
import { buildServer } from '../src/server.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';

const WORKER = 'lane-a-worker';
const COORD = 'lane-a-coordinator';
const UUID = 'a'.repeat(36);
const PID = 4242;
const DISPATCHED_AT = Date.parse('2026-11-11T09:00:00Z');
const STARTED_AT = DISPATCHED_AT - 60_000;
const TURN_AT = Date.parse('2026-11-11T10:00:00Z');
const STOP_AT = Date.parse('2026-11-11T10:20:00Z');
const SWEEP_AT = Date.parse('2026-11-11T10:30:00Z');
const LIVE: readonly string[] = ['stall-watch-live'];

const at = (ms: number): void => { vi.setSystemTime(ms); };

const seedRegistry = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid: UUID, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const seedLiveState = (home: string): void => {
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify({
    pid: PID, sessionId: UUID, cwd: '/w/demo', name: null, nameSource: null,
    status: 'idle', statusUpdatedAt: STOP_AT, version: '2.1.284', startedAt: STARTED_AT,
  }));
};

const seedTurnMark = (home: string, id: string, over: Record<string, unknown> = {}): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.turn.json`), JSON.stringify({
    v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: STOP_AT, turnAt: TURN_AT, stopAt: STOP_AT,
    bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', ...over,
  }));
};

const fleetRow = (id: string): FleetSession => ({
  hibernatedAt: null,
  id, wrapper: 'claude', home: '/home/u', project: 'demo', workdir: '/w/demo',
  workspace: `${id}-ws`, name: null, title: null, status: 'idle', statusUpdatedAt: STOP_AT, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, background: null, lastEnd: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: 'running', stoppedBy: null, swapBlocked: null, stranded: null, limitWait: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, role: null, releasedFrom: null, withCoordinator: null,
});

const regRow = (id: string): SessionRecord => ({
  hibernatedAt: null,
  namedByOperator: false, title: null,
  id, wrapper: 'claude', project: 'demo', projectEvidence: 'measured', workdir: '/w/demo', uuid: UUID,
  started: true, home: null, pool: null, lastswap: null,
  workspace: `${id}-ws`, branch: null, branchEvidence: 'absent', base: null,
  prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null,
  substrate: null, stopped: null, supervisedAt: null, swapBlocked: null, stranded: null, spawn: null, lastEnd: null, lifecycleUnmeasured: [],
  unmeasured: [], route: null, child: { kind: 'none' },
});

const tickOf = (): StallTick => ({ panePids: new Map([[WORKER, PID]]), records: [regRow(WORKER)], refused: new Set() });

const countingIO = (sink: string[]): FleetIO => ({
  ...localIO,
  readFileMeasured: async (p, t, s) => { sink.push(p); return localIO.readFileMeasured(p, t, s); },
});

const rig = async (over: Partial<Deps> = {}): Promise<{ home: string; coord: CoordStore; w: FleetWatcher; frames: RunSummary[][] }> => {
  const home = mkTmp('ccrc-worker-seen-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { ran: true as const, code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { ran: true as const, code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { ran: true as const, code: 0, stdout: '❯ \n', stderr: '' };
    return { ran: true as const, code: 1, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  const frames: RunSummary[][] = [];
  bus.on('runs', (runs) => frames.push(runs));
  const deps: Deps = { ...testDeps(home, run), coord, push: { notify: async () => {} } as never, ...over };
  const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), bus, 2000, path.join(home, 'state-cache.json')));
  await w.tick();
  seedRegistry(home, WORKER);
  seedLiveState(home);
  return { home, coord, w, frames };
};

const seedRun = (coord: CoordStore): number => {
  at(DISPATCHED_AT);
  const opened = coord.openRun({ program: 'demo-program', title: 'demo-program', project: 'demo', wave: 1, waveOf: 1, claimedBy: COORD });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  coord.markDispatched(opened.id, WORKER, `${WORKER}-ws`, `ws/${WORKER}`, false, DISPATCHED_AT);
  const adv = coord.advance(opened.id, 'dispatched', 'coordinator');
  if (!adv.ok) throw new Error(`advance refused: ${JSON.stringify(adv)}`);
  return opened.id;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(DISPATCHED_AT - 7_200_000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('workerSeenOf and withWorkerSeen (L1)', () => {
  it('a marker read gives the newest event and the turn; a read with no marker gives nothing', () => {
    const mark = {
      ok: true as const, sessionId: UUID, state: 'working' as const, event: 'UserPromptSubmit', at: TURN_AT, turnAt: TURN_AT,
      stopAt: null, bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [],
      crons: null, graceUntil: null,
    };
    expect(workerSeenOf(mark)).toEqual({ lastSeen: TURN_AT, turn: { state: 'working', startedAt: TURN_AT, endedAt: null } });
    for (const reason of ['absent', 'unmeasured', 'malformed', 'foreign', 'stale'] as const) {
      expect(workerSeenOf({ ok: false, reason }), reason).toBeNull();
    }
  });

  it('stamps the runs the board names and leaves every other run without the fields', () => {
    const board = createWorkerSeen();
    board.replace(new Map([[7, { lastSeen: STOP_AT, turn: { state: 'done' as const, startedAt: TURN_AT, endedAt: STOP_AT } }]]));
    const out = withWorkerSeen(board, [{ id: 7 }, { id: 8 }]);
    expect(out[0]).toEqual({ id: 7, workerLastSeen: STOP_AT, workerLastTurn: { state: 'done', startedAt: TURN_AT, endedAt: STOP_AT } });
    expect(out[1]).toEqual({ id: 8 });
    board.replace(new Map());
    expect(withWorkerSeen(board, [{ id: 7 }])).toEqual([{ id: 7 }]);
  });
});

describe('the stall sweep fills the heartbeat from its own marker read (D-8285)', () => {
  it('an open run carries its worker\'s last marker event and turn, on the board and on the runs frame', async () => {
    const reads: string[] = [];
    const { home, coord, w, frames } = await rig({ io: countingIO(reads) });
    const runId = seedRun(coord);
    seedTurnMark(home, WORKER);
    at(SWEEP_AT);
    reads.length = 0;
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    // The heartbeat costs no read: the sweep still reads the marker exactly once.
    expect(reads.filter((p) => p.endsWith(`${WORKER}.turn.json`))).toHaveLength(1);
    expect(w.workerSeen.of(runId)).toEqual({ lastSeen: STOP_AT, turn: { state: 'done', startedAt: TURN_AT, endedAt: STOP_AT } });
    frames.length = 0;
    await w.tick();
    const run = frames.flat().find((r) => r.id === runId);
    expect(run?.workerLastSeen).toBe(STOP_AT);
    expect(run?.workerLastTurn).toEqual({ state: 'done', startedAt: TURN_AT, endedAt: STOP_AT });
  });

  it('a new turn moves the heartbeat on the next sweep', async () => {
    const { home, coord, w } = await rig();
    const runId = seedRun(coord);
    seedTurnMark(home, WORKER);
    at(SWEEP_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    const next = SWEEP_AT + 60_000;
    seedTurnMark(home, WORKER, { state: 'working', event: 'UserPromptSubmit', at: next - 5_000, turnAt: next - 5_000 });
    at(next);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(w.workerSeen.of(runId)).toEqual({ lastSeen: next - 5_000, turn: { state: 'working', startedAt: next - 5_000, endedAt: STOP_AT } });
  });

  it('a marker that does not read leaves the run without a heartbeat, never a guessed one', async () => {
    const { home, coord, w } = await rig();
    const runId = seedRun(coord);
    writeFileSync(path.join(home, '.cc-sessions', `${WORKER}.turn.json`), '{');
    at(SWEEP_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(w.workerSeen.of(runId)).toBeNull();
  });

  it('a worker gone from the fleet keeps its last heartbeat: the marker on disk still dates it', async () => {
    const { home, coord, w } = await rig();
    const runId = seedRun(coord);
    seedTurnMark(home, WORKER);
    at(SWEEP_AT);
    await w.sweepStalls([], LIVE, tickOf());
    expect(w.workerSeen.of(runId)?.lastSeen).toBe(STOP_AT);
  });

  it('a disabled stall watch clears the board, so a frozen heartbeat never ages into a false quiet', async () => {
    const { home, coord, w } = await rig();
    const runId = seedRun(coord);
    seedTurnMark(home, WORKER);
    at(SWEEP_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(w.workerSeen.of(runId)).not.toBeNull();
    at(SWEEP_AT + 120_000);
    await w.sweepStalls([fleetRow(WORKER)], ['stall-watch-disabled'], tickOf());
    expect(w.workerSeen.of(runId)).toBeNull();
  });
});

describe('the run routes carry the heartbeat as the frame does (D-8285)', () => {
  it('GET /api/runs and GET /api/runs/:id/record stamp workerLastSeen and workerLastTurn from the board', async () => {
    vi.useRealTimers();
    const home = mkTmp('ccrc-worker-seen-route-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const runId = seedRun(coord);
    const deps = { ...testDeps(home), coord };
    const bus = new Bus();
    const w = quietAtTestEnd(new FleetWatcher(deps, bus));
    const turn = { state: 'done' as const, startedAt: TURN_AT, endedAt: STOP_AT };
    w.workerSeen.replace(new Map([[runId, { lastSeen: STOP_AT, turn }]]));
    const app = await buildServer(deps, bus, w);
    try {
      const list = (await app.inject({ method: 'GET', url: '/api/runs' })).json() as { runs: RunSummary[] };
      const row = list.runs.find((r) => r.id === runId);
      expect(row?.workerLastSeen).toBe(STOP_AT);
      expect(row?.workerLastTurn).toEqual(turn);
      const rec = (await app.inject({ method: 'GET', url: `/api/runs/${runId}/record` })).json() as { run: RunSummary };
      expect(rec.run.workerLastSeen).toBe(STOP_AT);
      w.workerSeen.replace(new Map());
      const bare = (await app.inject({ method: 'GET', url: `/api/runs/${runId}/record` })).json() as { run: RunSummary };
      expect('workerLastSeen' in bare.run).toBe(false);
    } finally {
      await app.close();
    }
  });
});
