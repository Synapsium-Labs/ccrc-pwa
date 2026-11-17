// The restarted arm on the stall sweep's RUN-LESS coordinator path, through the real watcher (Overlord W1a, the renewal
// hand-offs, Task 7). `stall-restarted.test.ts` pins the arm's verdicts at L1, and `stall-sweep.test.ts` drives the run
// worker's two rungs; neither reaches `judgeStallCoordinator`'s array of verdicts, so a sweep that stopped asking the arm
// there would leave both green while a coordinator resumed over lost background tasks was never told. Here the coordinator
// claims an open run (long-lived), its marker records a restart that lost two tasks, and wave 2 is armed: one `restarted:`
// self-mail goes to it, run-less (no run id, no row on the run it claims), and a later sweep sends no second one. Dark, the
// same sweep sends no mail (the arm's markers decide).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import type { Deps } from '../src/server.js';
import { FleetWatcher, STALL_SWEEP_MS, type StallTick } from '../src/watch.js';
import type { SessionRecord } from '../src/registry.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { STALL_RESTARTED_PREFIX } from '../src/coord/stall.js';
import type { FleetSession } from '../../shared/api.js';
import { testDeps, withFakeClock } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';

const COORD = 'lane-a-project-a';
const WORKER = 'lane-a-project-a-ws-child';
const UUID = 'c'.repeat(36);
const PID = 4242;
const RESTART_AT = Date.parse('2026-09-28T22:30:00Z');
const SWEEP_AT = RESTART_AT + 2 * 60_000;   // two minutes after the restart: far short of orphan D's idle wait
const LIVE_W2 = ['stall-watch-live', 'stall-watch-w2-live'];
const DARK = ['stall-watch-live'];

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(RESTART_AT - 7_200_000); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const fleetRow = (id: string): FleetSession => ({
  hibernatedAt: null, id, wrapper: 'claude', home: '/home/u', project: 'demo', workdir: '/w/demo', workspace: `${id}-ws`,
  name: null, title: null, status: 'idle', statusUpdatedAt: RESTART_AT + 60_000, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null,
  archivedBytes: null, hookState: null, askSummary: null, subagents: null, background: null, lastEnd: null, graphQueries: null,
  graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: 'running', stoppedBy: null, swapBlocked: null, stranded: null, limitWait: null, substrate: null, started: true,
  spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, role: 'coordinator',
  releasedFrom: null, withCoordinator: null,
}) as FleetSession;

const regRow = (id: string): SessionRecord => ({
  hibernatedAt: null, namedByOperator: false, title: null, id, wrapper: 'claude', project: 'demo', projectEvidence: 'measured',
  workdir: '/w/demo', uuid: UUID, started: true, home: null, pool: null, lastswap: null, workspace: `${id}-ws`, branch: null,
  branchEvidence: 'absent', base: null, prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null,
  held: null, substrate: null, stopped: null, supervisedAt: null, swapBlocked: null, stranded: null, spawn: null, lastEnd: null,
  lifecycleUnmeasured: [], unmeasured: [], route: null, child: { kind: 'none' },
}) as unknown as SessionRecord;

/** A primed watcher over a fixture HOME with ONE coordinator claiming an open run, whose marker records a restart that lost two tasks. */
async function rig(): Promise<{ w: FleetWatcher; coord: CoordStore; tick: StallTick; sessions: FleetSession[] }> {
  const home = mkTmp('ccrc-stall-restarted-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const run: Runner = async (_cmd, args) => ({ ran: true as const, code: args[0] === 'list-panes' || args[0] === 'has-session' || args[0] === 'capture-pane' ? 0 : 1,
    stdout: args[0] === 'list-panes' ? `${PID}\n` : args[0] === 'capture-pane' ? '❯ \n' : '', stderr: '' });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: Deps = { ...testDeps(home, run), coord };
  const w = quietAtTestEnd(new FleetWatcher(withFakeClock(deps), new Bus(), 2000, path.join(home, 'state-cache.json')));
  await w.tick();                                   // priming, on an empty registry
  const reg = path.join(home, '.cc-sessions');
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: '/w/demo', uuid: UUID, started: '1' })) writeFileSync(path.join(reg, `${COORD}.${k}`), v);
  mkdirSync(path.join(home, '.claude', 'sessions'), { recursive: true });
  writeFileSync(path.join(home, '.claude', 'sessions', `${PID}.json`), JSON.stringify({ pid: PID, sessionId: UUID, cwd: '/w/demo', name: null,
    nameSource: null, status: 'idle', statusUpdatedAt: RESTART_AT + 60_000, version: '2.1.284', startedAt: RESTART_AT - 5_000 }));
  writeFileSync(path.join(reg, `${COORD}.turn.json`), JSON.stringify({ v: 1, sessionId: UUID, state: 'done', event: 'SessionStart', at: RESTART_AT,
    turnAt: RESTART_AT - 900_000, stopAt: RESTART_AT - 600_000, bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: RESTART_AT, lostBg: 2,
    lostKinds: 'workflow,subagent', lostIds: 'wf1,bag2' }));
  // The coordinator claims one dispatched run, so the sweep judges it run-less (`judgeStallCoordinator`).
  const opened = coord.openRun({ program: 'demo-program', title: 'demo-program', project: 'demo', wave: 1, waveOf: 1, claimedBy: COORD });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  coord.markDispatched(opened.id, WORKER, `${WORKER}-ws`, `ws/${WORKER}`, false, RESTART_AT - 3_600_000);
  const adv = coord.advance(opened.id, 'dispatched', 'coordinator');
  if (!adv.ok) throw new Error(`advance refused: ${JSON.stringify(adv)}`);
  const tick: StallTick = { panePids: new Map([[COORD, PID]]), records: [regRow(COORD)], refused: new Set() };
  return { w, coord, tick, sessions: [fleetRow(COORD)] };
}

const restartedMail = (coord: CoordStore): { toId: string; runId: number | null; subject: string }[] =>
  (coord.db.prepare("SELECT toId, runId, subject FROM mail WHERE fromId = 'operator' ORDER BY id").all() as unknown as { toId: string; runId: number | null; subject: string }[])
    .filter((m) => m.subject.startsWith(STALL_RESTARTED_PREFIX));

describe('sweepStalls: the restarted arm reaches a long-lived coordinator run-less', () => {
  it('armed: one restarted: self-mail with no run, and a later sweep sends no second', async () => {
    const { w, coord, tick, sessions } = await rig();
    vi.setSystemTime(SWEEP_AT);
    await w.sweepStalls(sessions, LIVE_W2, tick);
    vi.setSystemTime(SWEEP_AT + STALL_SWEEP_MS);
    await w.sweepStalls(sessions, LIVE_W2, tick);
    expect(restartedMail(coord)).toEqual([expect.objectContaining({ toId: COORD, runId: null })]);
  }, 60_000);

  it('dark (no stall-watch-w2-live): the same sweep sends no mail', async () => {
    const { w, coord, tick, sessions } = await rig();
    vi.setSystemTime(SWEEP_AT);
    await w.sweepStalls(sessions, DARK, tick);
    expect(restartedMail(coord)).toEqual([]);
  }, 60_000);

  it('armed, the designation unreadable: its role is unread, so the arm sends no mail (designation A made it a role fact)', async () => {
    const { w, coord, tick, sessions } = await rig();
    coord.designationRead = () => { throw new Error('fixture'); };
    vi.setSystemTime(SWEEP_AT);
    await w.sweepStalls(sessions, LIVE_W2, tick);
    expect(restartedMail(coord)).toEqual([]);
  }, 60_000);
});
