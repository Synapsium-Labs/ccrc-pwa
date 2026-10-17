import { describe, expect, it, vi } from 'vitest';
import { stopDonePass, type StopDoneMemory, type StopDoneSweepDeps } from '../src/stopDoneSweep.js';
import { STOP_DONE_DISABLED_MARKER, STOP_DONE_GRACE_MS, STOP_DONE_PER_PASS, STOP_DONE_RETRY_MS } from '../src/stopDone.js';
import { PRESENCE_TTL_MS, type FleetSession } from '../../shared/api.js';
import type { SessionRecord } from '../src/registry.js';
import type { FleetState } from '../src/fleetstate.js';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { buildServer } from '../src/server.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';

// D-5370 (`stop-worker-at-run-done`): the lane. The verdict's holds are pinned in `stop-done-verdict.test.ts`; this
// file pins what the PASS does with them — the kill switch, the serialiser, the per-pass bound, the act-time re-read,
// the declared stop, the one feed row, and the retry memory.

const NOW = 1_800_000_000_000;
const STARTED = NOW - PRESENCE_TTL_MS - 60_000;

const row = (id: string, o: Partial<FleetSession> = {}): FleetSession => ({
  id, child: { kind: 'child', runId: 1 }, archivedAt: null, held: null, stoppedBy: null, unmeasured: [],
  statusUnmeasured: false, dialogPending: false, background: null, subagents: null, stranded: null, swapBlocked: null,
  substrate: null, bucket: 'idle', ...o,
}) as unknown as FleetSession;
const rec = (id: string): SessionRecord => ({ id, uuid: `uuid-${id}` }) as unknown as SessionRecord;

interface Fake {
  deps: StopDoneSweepDeps;
  argv: string[][];
  feed: { sessionId: string; runId: number | null }[];
  serialCalls: number;
  /** Per session: the newest run's state and close time, and whether another open run names it. */
  runs: Map<string, { runId: number; state: string; closedAt: number | null }>;
  openWorkers: Set<string>;
  mailTo: Set<string>;
  ccdOk: boolean;
}

function fake(ids: readonly string[], o: { surface?: boolean; serial?: boolean } = {}): Fake {
  const f: Fake = {
    argv: [], feed: [], serialCalls: 0, runs: new Map(), openWorkers: new Set(), mailTo: new Set(), ccdOk: true,
    deps: undefined as unknown as StopDoneSweepDeps,
  };
  ids.forEach((id, i) => f.runs.set(id, { runId: 10 + i, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS - 1 }));
  let seq = 0;
  f.deps = {
    coord: {
      lastRunBySession: (asked: readonly string[]) => ({
        ok: true as const,
        last: asked.flatMap((sessionId) => {
          const r = f.runs.get(sessionId);
          return r === undefined ? [] : [{ sessionId, ...r, program: 'p', programTitle: null, claimedBy: 'lane-a-project-a' }];
        }),
        openWorkers: asked.filter((id) => f.openWorkers.has(id)),
        openClaimants: ['lane-a-project-a'],
      }),
      activeClaims: () => [],
      outstandingMailFor: (toId: string) => (f.mailTo.has(toId) ? [{}] : []) as never,
      recordFeedEvent: () => undefined,
    },
    runCcd: async (a) => { f.argv.push([...a]); return { ok: f.ccdOk, stdout: '', stderr: f.ccdOk ? '' : 'refused', killed: false, signal: null }; },
    fleetState: { ccdVerbs: o.surface === false ? [] : ['stop-surface'] } as unknown as FleetState,
    presence: { isVisible: () => false },
    notifyLog: {
      epoch: 'e', record: (e: { sessionId: string; runId: number | null }) => { f.feed.push({ sessionId: e.sessionId, runId: e.runId }); return { ...e, seq: ++seq, at: NOW }; },
      flush: async () => undefined,
    } as unknown as StopDoneSweepDeps['notifyLog'],
    liveWord: async () => ({ ok: true, word: 'idle', since: null }),
    turnVerdict: async () => 'idle',
    serial: o.serial === false ? null : async (fn) => { f.serialCalls++; return fn(); },
    queueRun: async (_id, fn) => fn(),
    startedAt: STARTED,
    now: () => NOW,
  };
  return f;
}

const mem = (): StopDoneMemory => ({ retryAt: new Map() });
const ID = 'project-a-quiet-basin';

describe('stopDonePass (D-5370)', () => {
  it('happy path: one declared stop of the worker, on the serialiser, and one feed row naming its run', async () => {
    const f = fake([ID]);
    const out = await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'stopped', runId: 10 }]);
    expect(f.argv).toEqual([['stop', ID, '--surface', 'agent']]);
    expect(f.serialCalls).toBe(1);
    expect(f.feed).toEqual([{ sessionId: ID, runId: 10 }]);
  });

  it('the kill switch: with stop-done-disabled listed, nothing is read and nothing is stopped', async () => {
    const f = fake([ID]);
    const live = vi.fn(f.deps.liveWord);
    const out = await stopDonePass({ ...f.deps, liveWord: live }, mem(), [row(ID)], [rec(ID)], [STOP_DONE_DISABLED_MARKER]);
    expect(out).toEqual([]);
    expect(f.argv).toEqual([]);
    expect(live).not.toHaveBeenCalled();
  });

  it('the fleet\'s one cleanup switch: with reclaim-paused listed, nothing is stopped', async () => {
    const f = fake([ID]);
    expect(await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], [RECLAIM_PAUSE_MARKER])).toEqual([]);
    expect(f.argv).toEqual([]);
  });

  it('without the coordination serialiser handed over, it stops nothing', async () => {
    const f = fake([ID], { serial: false });
    expect(await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], [])).toEqual([]);
    expect(f.argv).toEqual([]);
  });

  it('the operator\'s own session (no child marker) is never stopped, and is not even measured', async () => {
    const f = fake([ID]);
    const live = vi.fn(f.deps.liveWord);
    await stopDonePass({ ...f.deps, liveWord: live }, mem(), [row(ID, { child: { kind: 'none' } })], [rec(ID)], []);
    expect(f.argv).toEqual([]);
    expect(live).not.toHaveBeenCalled();
  });

  it('a busy worker is not stopped', async () => {
    const f = fake([ID]);
    await stopDonePass({ ...f.deps, turnVerdict: async () => 'busy' }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a worker that another open run names is not stopped (the coordinator re-dispatched it)', async () => {
    const f = fake([ID]);
    f.openWorkers.add(ID);
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a worker holding a live claim is not stopped', async () => {
    const f = fake([ID]);
    const coord = { ...f.deps.coord, activeClaims: () => [{ heldBy: ID }] } as unknown as StopDoneSweepDeps['coord'];
    await stopDonePass({ ...f.deps, coord }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a worker that claims an open run (it coordinates) is not stopped', async () => {
    const f = fake([ID]);
    const base = f.deps.coord.lastRunBySession;
    const coord = { ...f.deps.coord, lastRunBySession: (ids: readonly string[]) => {
      const r = base(ids); return r.ok ? { ...r, openClaimants: [ID] } : r;
    } } as unknown as StopDoneSweepDeps['coord'];
    await stopDonePass({ ...f.deps, coord }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a store read that throws holds every candidate', async () => {
    const f = fake([ID]);
    const coord = { ...f.deps.coord, lastRunBySession: () => { throw new Error('database is locked'); } } as unknown as StopDoneSweepDeps['coord'];
    await stopDonePass({ ...f.deps, coord }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a worker with outstanding mail is not stopped', async () => {
    const f = fake([ID]);
    f.mailTo.add(ID);
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a worker somebody has on screen is not stopped', async () => {
    const f = fake([ID]);
    await stopDonePass({ ...f.deps, presence: { isVisible: (id) => id === ID } }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('straight after a server start nothing is stopped: presence has not been re-established', async () => {
    const f = fake([ID]);
    await stopDonePass({ ...f.deps, startedAt: NOW - 1000 }, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a box whose ccd cannot declare the stop surface is not stopped (never an undeclared stop)', async () => {
    const f = fake([ID], { surface: false });
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('AT THE ACT the store is read again: a run opened onto the worker inside the serialiser holds it', async () => {
    const f = fake([ID]);
    const serial: StopDoneSweepDeps['serial'] = async (fn) => { f.openWorkers.add(ID); return fn(); };
    const out = await stopDonePass({ ...f.deps, serial }, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'held-at-act', verdict: { act: 'hold', reason: 'run-worker' } }]);
    expect(f.argv).toEqual([]);
  });

  it('AT THE ACT the live state is read again: a turn that started holds it', async () => {
    const f = fake([ID]);
    let calls = 0;
    const turnVerdict: StopDoneSweepDeps['turnVerdict'] = async () => (++calls === 1 ? 'idle' : 'busy');
    const out = await stopDonePass({ ...f.deps, turnVerdict }, mem(), [row(ID)], [rec(ID)], []);
    expect(out).toEqual([{ id: ID, kind: 'held-at-act', verdict: { act: 'hold', reason: 'turn' } }]);
    expect(f.argv).toEqual([]);
  });

  it(`at most ${STOP_DONE_PER_PASS} stops a pass, fleet-wide; the next pass takes the rest`, async () => {
    const ids = ['project-a-a', 'project-a-b', 'project-a-c', 'project-a-d', 'project-a-e'];
    const f = fake(ids);
    const m = mem();
    await stopDonePass(f.deps, m, ids.map((i) => row(i)), ids.map(rec), []);
    expect(f.argv.map((a) => a[1])).toEqual(['project-a-a', 'project-a-b', 'project-a-c']);
    const stopped = new Set(f.argv.map((a) => a[1]));
    await stopDonePass(f.deps, m, ids.map((i) => row(i, stopped.has(i) ? { stoppedBy: { at: NOW, surface: 'agent' } } : {})), ids.map(rec), []);
    expect(f.argv.map((a) => a[1])).toEqual(['project-a-a', 'project-a-b', 'project-a-c', 'project-a-d', 'project-a-e']);
  });

  it('idempotent: a row that already carries its stop stamp is not stopped again', async () => {
    const f = fake([ID]);
    await stopDonePass(f.deps, mem(), [row(ID, { stoppedBy: { at: NOW, surface: 'agent' } })], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });

  it('a stop the box refused is not asked again for the retry interval, and no feed row is written', async () => {
    const f = fake([ID]);
    f.ccdOk = false;
    const m = mem();
    expect((await stopDonePass(f.deps, m, [row(ID)], [rec(ID)], []))[0]?.kind).toBe('failed');
    expect(f.feed).toEqual([]);
    await stopDonePass(f.deps, m, [row(ID)], [rec(ID)], []);
    expect(f.argv.length).toBe(1);
    f.ccdOk = true;
    await stopDonePass({ ...f.deps, now: () => NOW + STOP_DONE_RETRY_MS }, m, [row(ID)], [rec(ID)], []);
    expect(f.argv.length).toBe(2);
  });

  it('within the grace after the run closed, the worker is left alone', async () => {
    const f = fake([ID]);
    f.runs.set(ID, { runId: 10, state: 'done', closedAt: NOW - 60_000 });
    await stopDonePass(f.deps, mem(), [row(ID)], [rec(ID)], []);
    expect(f.argv).toEqual([]);
  });
});

describe('wired by buildServer (D-5370)', () => {
  it('the watcher is handed the coordination serialiser, and the lane\'s act runs through it', async () => {
    const home = mkTmp('ccrc-stop-done-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps = { ...testDeps(home, async () => ({ code: 0, stdout: '', stderr: '' })), cfg, coord };
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    const before = (w as unknown as { stopDoneSerial: unknown }).stopDoneSerial;
    const app = await buildServer({ ...deps, mailToken: 'f'.repeat(64) } as never, new Bus(), w);
    try {
      expect(before, 'nothing is handed before buildServer').toBeNull();
      const serial = (w as unknown as { stopDoneSerial: StopDoneSweepDeps['serial'] }).stopDoneSerial;
      expect(serial).not.toBeNull();
      expect(await serial!(async () => 42)).toBe(42);
    } finally {
      await app.close();
      coord.db.close();
    }
  });
});

describe('run by the watcher\'s tick (D-5370)', () => {
  it('the tick runs the lane on its assembled rows and listing, and never on the priming tick', async () => {
    const home = mkTmp('ccrc-stop-done-tick-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    try {
      const deps = { ...testDeps(home, async () => ({ code: 1, stdout: '', stderr: '' })), cfg, coord };
      const w = new FleetWatcher(deps as never, new Bus(), 10_000);
      const spy = vi.spyOn(w, 'sweepStopDone').mockResolvedValue(undefined);
      await w.tick();
      expect(spy, 'the priming tick judges nothing').not.toHaveBeenCalled();
      await w.tick();
      expect(spy).toHaveBeenCalledTimes(1);
      const [sessions, records, names] = spy.mock.calls[0]!;
      expect(Array.isArray(sessions) && Array.isArray(records) && Array.isArray(names)).toBe(true);
    } finally {
      coord.db.close();
    }
  });
});
