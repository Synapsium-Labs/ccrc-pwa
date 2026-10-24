// Characterization (D-5862; ARCH-68 #803; spec K11): the nine lanes outside coordination that `FleetWatcher.tick`
// throttles on a wall-clock `last*` field: the task, usage, PR, name, divergence, lifecycle, readiness and the two
// ledger sweeps. Each is driven through its own entry (the method `tick` calls) on a fake wall clock, and what a lane
// did is read off an effect it cannot do without (a registry listing, a sidecar read, a token read, a mirror sweep, an
// allocation read). Pinned per lane: the first call runs, a call inside the cadence skips, a wall clock stepped back
// holds the lane and stepped forward runs it; a second call while a pass that never settles is running does not start
// another (the slot is stamped before the work is awaited); a pass that throws rejects the call, spends the slot and
// leaves the next due call running. Lifecycle is also reached through `tick` (the child-mark kick, a body that never settles
// delays neither tick), and the PR sweep's stuck-run boundary has its own rows. The wall lanes take no
// injected monotonic clock, so none is driven here; the monotonic lanes are pinned in the lane-schedule rows. Fixture
// homes only.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, LC_SWEEP_MS, READINESS_SWEEP_MS } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { Runner } from '../src/exec.js';
import type { SessionRecord } from '../src/registry.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;
const HOUR = 3_600_000;

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const at = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };

/** A watcher on a fixture home whose io counts what each lane reads. */
function rig() {
  const home = mkTmp('ccrc-lane-sweeps-');
  const projectsRoot = mkTmp('ccrc-lane-sweeps-docs-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'mail.token'), 'fixture-token\n');
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: projectsRoot } as never);
  const registryListings: string[] = [];
  const otherListings: string[] = [];
  const fileReads: string[] = [];
  const io: FleetIO = {
    ...localIO,
    readdir: async (p: string) => { (p === cfg.registryDir ? registryListings : otherListings).push(p); return localIO.readdir(p); },
    readFileMeasured: async (p: string) => { fileReads.push(p); return localIO.readFileMeasured(p); },
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const w = new FleetWatcher({ ...testDeps(home), cfg, io, coord } as never, new Bus(), 10_000);
  return { home, cfg, coord, w, registryListings, otherListings, fileReads };
}
type Rig = ReturnType<typeof rig>;
type Any = Record<string, (...a: unknown[]) => Promise<void>>;
const call = (r: Rig, name: string, ...a: unknown[]): Promise<void> => (r.w as unknown as Any)[name]!(...a);

/** Replace the watcher's journal mirror with a stub whose `sweep` is the effect the lifecycle lane is watched by. */
function stubMirror(w: FleetWatcher, mirror: { sweep: () => Promise<void> }): void {
  vi.spyOn(w as unknown as { mirrorFor(): unknown }, 'mirrorFor').mockReturnValue(mirror);
}

const REC = { id: 'demo-quiet-basin', project: 'demo' } as unknown as SessionRecord;

interface Lane {
  key: string;
  cadenceMs: number;
  /** One call of the lane's tick entry. */
  run: (r: Rig) => Promise<void>;
  /** Prepare the rig so the lane's effect is observable (and return a counter of that effect). */
  watch: (r: Rig) => () => number;
}

const LANES: Lane[] = [
  { key: 'tasks', cadenceMs: 10_000, run: (r) => call(r, 'sweepTasks'), watch: (r) => () => r.registryListings.length },
  { key: 'usage', cadenceMs: 60_000, run: (r) => call(r, 'sweepUsage', [REC]),
    watch: (r) => () => r.fileReads.filter((p) => p.includes('demo-quiet-basin')).length },
  { key: 'names', cadenceMs: 10_000, run: (r) => call(r, 'sweepNames'), watch: (r) => () => r.registryListings.length },
  { key: 'divergences', cadenceMs: 60_000, run: (r) => call(r, 'sweepDivergences', [], new Set<string>()),
    watch: (r) => () => r.registryListings.length },
  { key: 'lifecycle', cadenceMs: LC_SWEEP_MS, run: (r) => call(r, 'sweepLifecycle'), watch: (r) => {
    const sweep = vi.fn(async () => {});
    stubMirror(r.w, { sweep });
    return () => sweep.mock.calls.length;
  } },
  { key: 'readiness', cadenceMs: READINESS_SWEEP_MS, run: (r) => call(r, 'sweepReadiness'), watch: (r) => () => r.fileReads.length },
  { key: 'ledgerFloor', cadenceMs: HOUR, run: (r) => call(r, 'sweepLedgerFloor', [REC]),
    watch: (r) => () => r.otherListings.filter((p) => p.includes('demo')).length },
  { key: 'ledgerReconcile', cadenceMs: 900_000, run: (r) => call(r, 'sweepLedgerReconcile'), watch: (r) => {
    const open = vi.spyOn(r.coord, 'openAllocations');
    return () => open.mock.calls.length;
  } },
  { key: 'pr', cadenceMs: 120_000, run: (r) => call(r, 'sweepPr'), watch: (r) => () => r.registryListings.length },
];

describe.each(LANES)('the $key lane (wall clock)', (lane) => {
  it('runs on the first call, skips inside its cadence, runs once the cadence has elapsed', async () => {
    const r = rig(); const ran = lane.watch(r);
    at(NOW);
    await lane.run(r);
    const first = ran();
    expect(first, 'did not run on the first call').toBeGreaterThan(0);
    await lane.run(r);
    expect(ran(), 'ran twice at once').toBe(first);
    at(NOW + lane.cadenceMs - 1);
    await lane.run(r);
    expect(ran(), 'ran inside its cadence').toBe(first);
    at(NOW + lane.cadenceMs);
    await lane.run(r);
    expect(ran(), 'did not run at its cadence').toBeGreaterThan(first);
  });

  it('a wall clock stepped back one hour holds the lane; stepped forward it runs at once', async () => {
    const r = rig(); const ran = lane.watch(r);
    at(NOW);
    await lane.run(r);
    const first = ran();
    at(NOW - HOUR);
    await lane.run(r);
    expect(ran(), 'a step back no longer holds the lane').toBe(first);
    at(NOW + HOUR);
    await lane.run(r);
    expect(ran(), 'a step forward did not run the lane').toBeGreaterThan(first);
  });
});

const PASS: Record<string, string> = {
  tasks: 'tasksPass', usage: 'usagePass', names: 'namesPass', divergences: 'divergencesPass',
  readiness: 'readinessPass', ledgerFloor: 'ledgerFloorPass', ledgerReconcile: 'ledgerReconcilePass', pr: 'prPass',
};
type Body = () => Promise<void>;
/** Make the lane's body `impl` and return a counter of how many times a pass was started. */
function replaceBody(r: Rig, key: string, impl: Body): () => number {
  if (key === 'lifecycle') {
    let n = 0;
    stubMirror(r.w, { sweep: async () => { n += 1; await impl(); } });
    return () => n;
  }
  const spy = vi.spyOn(r.w as unknown as Record<string, Body>, PASS[key]!).mockImplementation(impl);
  return () => spy.mock.calls.length;
}
const settleTurns = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((res) => setImmediate(res)); };

describe.each(LANES)('the $key lane: a second call while a pass runs', (lane) => {
  it('does not start another pass while the first never settles', async () => {
    const r = rig();
    const started = replaceBody(r, lane.key, () => new Promise<void>(() => {}));
    at(NOW);
    void lane.run(r); await settleTurns();
    expect(started(), 'the first call did not start a pass').toBe(1);
    void lane.run(r); await settleTurns();
    expect(started(), 'a second call overlapped a pass still running').toBe(1);
    at(NOW + lane.cadenceMs - 1);
    void lane.run(r); await settleTurns();
    expect(started(), 'a call inside the cadence overlapped a pass still running').toBe(1);
  });
});

describe.each(LANES)('the $key lane: a throw keeps its slot', (lane) => {
  it('rejects the call, spends the slot, and the next due call runs', async () => {
    const r = rig();
    const started = replaceBody(r, lane.key, async () => { throw new Error('pass failed'); });
    at(NOW);
    await expect(lane.run(r)).rejects.toThrow('pass failed');
    await lane.run(r);
    expect(started(), 'a failed pass did not consume its slot').toBe(1);
    at(NOW + lane.cadenceMs);
    await expect(lane.run(r)).rejects.toThrow('pass failed');
    expect(started(), 'the next due call did not run').toBe(2);
  });
});

describe('a lane that throws keeps its slot', () => {
  it('lifecycle: a throw rejects the call, the slot is spent, and the next due call runs', async () => {
    const r = rig();
    let calls = 0;
    stubMirror(r.w, { sweep: async () => { calls += 1; throw new Error('journal unreadable'); } });
    at(NOW);
    await expect(r.w.sweepLifecycle()).rejects.toThrow('journal unreadable');
    await r.w.sweepLifecycle();
    expect(calls, 'a failed sweep did not consume its slot').toBe(1);
    at(NOW + LC_SWEEP_MS);
    await expect(r.w.sweepLifecycle()).rejects.toThrow('journal unreadable');
    expect(calls).toBe(2);
  });

  it('ledger reconcile: a throw rejects the call, the slot is spent, and the next due call runs', async () => {
    const r = rig();
    const open = vi.spyOn(r.coord, 'openAllocations').mockImplementation(() => { throw new Error('db gone'); });
    at(NOW);
    await expect(r.w.sweepLedgerReconcile()).rejects.toThrow('db gone');
    await r.w.sweepLedgerReconcile();
    expect(open.mock.calls.length, 'a failed sweep did not consume its slot').toBe(1);
    at(NOW + 900_000);
    await expect(r.w.sweepLedgerReconcile()).rejects.toThrow('db gone');
    expect(open.mock.calls.length).toBe(2);
  });

  it('ledger floor: the slot is spent even with no coordination database', async () => {
    const home = mkTmp('ccrc-lane-sweeps-');
    seedRoster(home);
    const listed: string[] = [];
    const io: FleetIO = { ...localIO, readdir: async (p: string) => { listed.push(p); return localIO.readdir(p); } };
    const w = new FleetWatcher({ ...testDeps(home), io } as never, new Bus(), 10_000);
    at(NOW);
    await w.sweepLedgerFloor([REC]);
    at(NOW + HOUR);
    await w.sweepLedgerFloor([REC]);
    expect(listed).toEqual([]);   // no store: the body returns before it reads, on both calls
  });
});

describe('the lifecycle lane when no coordination database exists', () => {
  it('does not stamp: it answers before the throttle, every call', async () => {
    const w = new FleetWatcher(testDeps(mkTmp('ccrc-lane-sweeps-')), new Bus(), 10_000);
    at(NOW);
    await expect(w.sweepLifecycle()).resolves.toBeUndefined();
    await expect(w.sweepLifecycle()).resolves.toBeUndefined();
  });
});

describe('a child mark leaving the listing kicks the lifecycle lane', () => {
  /** A registry the tick can list, holding one record; `child` plants its `.child` marker. */
  function plant(reg: string, id: string, child: boolean): void {
    for (const [f, v] of [['uuid', `u-${id}`], ['wrapper', 'claude'], ['workdir', `/w/${id}`], ['project', 'demo'],
      ['workspace', id.slice('demo-'.length)], ['branch', `ws/${id}`], ['base', 'origin/main'], ['started', '1']]) {
      writeFileSync(path.join(reg, `${id}.${f}`), v!);
    }
    if (child) writeFileSync(path.join(reg, `${id}.child`), '17');
  }
  const unplant = (reg: string, id: string): void => {
    for (const f of ['uuid', 'wrapper', 'workdir', 'project', 'workspace', 'branch', 'base', 'started', 'child']) rmSync(path.join(reg, `${id}.${f}`), { force: true });
  };

  it('a child that left the listing runs the lifecycle lane on the next tick, inside its cadence', async () => {
    const r = rig();
    const sweep = vi.fn(async () => {});
    stubMirror(r.w, { sweep });
    const reg = r.cfg.registryDir;
    plant(reg, 'demo-quiet-basin', true);
    plant(reg, 'demo-still-cove', false);
    at(NOW);
    await r.w.tick();
    await vi.waitFor(() => expect(sweep.mock.calls.length).toBe(1));
    await r.w.tick();
    expect(sweep.mock.calls.length, 'a second tick inside the cadence ran the lane').toBe(1);
    unplant(reg, 'demo-still-cove');                                // not a child: leaves nothing to kick
    await r.w.tick();
    expect(sweep.mock.calls.length, 'a non-child leaving kicked the lane').toBe(1);
    unplant(reg, 'demo-quiet-basin');                               // the child leaves the listing
    await r.w.tick();
    await vi.waitFor(() => expect(sweep.mock.calls.length, 'a child mark leaving the listing runs the lifecycle lane next tick').toBe(2));
  });

  it('a fire-and-forget lane whose body never settles delays neither this tick nor the next', async () => {
    const r = rig();
    let calls = 0;
    stubMirror(r.w, { sweep: () => { calls += 1; return new Promise<void>(() => {}); } });
    at(NOW);
    await expect(r.w.tick()).resolves.toBeUndefined();
    at(NOW + LC_SWEEP_MS);
    await expect(r.w.tick()).resolves.toBeUndefined();
    expect(calls).toBeGreaterThan(0);
  });
});

describe('the PR sweep: single flight that abandons a stuck run', () => {
  const STUCK = 900_000;

  /** A runner that answers `pr-state` with a promise the test settles by hand, one per call. */
  function rigPr() {
    const home = mkTmp('ccrc-lane-sweeps-pr-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [f, v] of [['uuid', 'u-1'], ['wrapper', 'claude'], ['workdir', '/w/demo-quiet-basin'], ['project', 'demo'],
      ['workspace', 'quiet-basin'], ['branch', 'ws/demo-quiet-basin'], ['base', 'origin/main']]) {
      writeFileSync(path.join(reg, `demo-quiet-basin.${f}`), v!);
    }
    const settle: Array<(out: { code: number; stdout: string; stderr: string }) => void> = [];
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'pr-state') return new Promise((res) => { settle.push(res); });
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000);
    const sweep = (): Promise<void> => (w as unknown as Any)['sweepPr']!();
    return { w, settle, sweep };
  }
  const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((res) => setImmediate(res)); };

  it('holds the lane shut one millisecond before the ceiling and reopens at it', async () => {
    const r = rigPr();
    at(NOW);
    void r.sweep(); await flush();
    expect(r.settle).toHaveLength(1);
    at(NOW + STUCK - 1);
    void r.sweep(); await flush();
    expect(r.settle, 'a run younger than the ceiling was abandoned').toHaveLength(1);
    at(NOW + STUCK);
    void r.sweep(); await flush();
    expect(r.settle, 'a stuck run was not abandoned at the ceiling').toHaveLength(2);
  });

  it('an abandoned run settling late does not clear the newer run, and the newer one still holds the lane', async () => {
    const r = rigPr();
    at(NOW);
    void r.sweep(); await flush();
    at(NOW + STUCK);
    void r.sweep(); await flush();
    expect(r.settle).toHaveLength(2);
    r.settle[0]!({ code: 0, stdout: '', stderr: '' }); await flush();      // the abandoned run settles late
    at(NOW + STUCK + 150_000);                                             // past the cadence, short of the newer run's ceiling
    void r.sweep(); await flush();
    expect(r.settle, 'the late run cleared the newer run\'s flight').toHaveLength(2);
  });
});
