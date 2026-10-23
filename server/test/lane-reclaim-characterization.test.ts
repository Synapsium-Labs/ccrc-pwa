// Characterization (D-5862; ARCH-68 #803; spec K11, §2.3's clock row): the four lanes that select destructive acts and
// throttle on `CHILD_RECLAIM_SWEEP_MS`: child reclaim and the temp-root collector (on the MONOTONIC clock today), the
// archived-workspace expiry lane and the dead-coordinator lane (on the WALL clock today). Each is driven through the entry
// `tick` calls (`sweepChildReclaim`, `sweepTempRootCollect`, `sweepArchivedExpiry`, `sweepDeadCoordinators`) on an injected
// `Deps.monotonicMs` and a faked `Date.now`, and what a lane did is read off the pass it would run (the gather of child
// reclaim; the pass method of the other three), which a spy replaces so no destructive act is composed.
//
// Pinned per lane: the first call runs, a second inside the cadence skips, one at the cadence runs; the flight (child reclaim
// overlaps and is overtaken by its own pass counter; the other three keep one pass at a time); the wall clock stepped back
// and forward by an hour between two calls (the rows the behaviour commit changes for expiry and the dead-coordinator lane,
// and the rows that must NOT change for the two lanes already on the monotonic clock); a slow gather re-stamps child reclaim
// and the collector from the decision clock; a seal during a dead-coordinator pass waits for it and no pass starts after the
// seal; a fire-and-forget lane whose body never settles delays neither the next tick nor the busy-to-idle push.
// Fixture homes only.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { loadConfig } from '../src/config.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { collectRig } from './collectLaneFixture.js';

const NOW = 1_785_300_000_000;
const HOUR = 3_600_000;
const CAD = CHILD_RECLAIM_SWEEP_MS;

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const wall = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };
const settleTurns = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((res) => setImmediate(res)); };
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((a) => { resolve = a; });
  return { promise, resolve };
}

function rig() {
  const home = mkTmp('ccrc-lane-reclaim-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'mail.token'), 'fixture-token\n');
  const cfg = loadConfig({ CCRC_HOME: home } as never);
  const t = { mono: 5_000 };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const w = new FleetWatcher({ ...testDeps(home), cfg, coord, monotonicMs: () => t.mono } as never, new Bus(), 10_000);
  return { w, t, coord };
}
type Rig = ReturnType<typeof rig>;
type Priv = Record<string, (...a: unknown[]) => unknown>;

interface Lane {
  key: string;
  clock: 'mono' | 'wall';
  /** One call of the lane's entry, as `tick` makes it. */
  run: (r: Rig) => Promise<void>;
  /** Replaces the lane's pass (or, for child reclaim, its gather) with a counter; `hold` makes it wait on a promise. */
  spy: (r: Rig, hold?: Promise<unknown>) => () => number;
}
const stub = (r: Rig, method: string, hold: Promise<unknown> | undefined, value: unknown): ReturnType<typeof vi.spyOn> =>
  vi.spyOn(r.w as unknown as Priv, method).mockImplementation((() => (hold === undefined ? Promise.resolve(value) : hold.then(() => value))) as never);

const LANES: Lane[] = [
  { key: 'childReclaim', clock: 'mono', run: (r) => r.w.sweepChildReclaim([], []),
    spy: (r, hold) => { const s = stub(r, 'childReclaimGatherGenerations', hold, new Map()); return () => s.mock.calls.length; } },
  { key: 'collect', clock: 'mono', run: (r) => r.w.sweepTempRootCollect([], []),
    spy: (r, hold) => { const s = stub(r, 'collectPass', hold, undefined); return () => s.mock.calls.length; } },
  { key: 'archivedExpiry', clock: 'mono', run: (r) => r.w.sweepArchivedExpiry([], []),
    spy: (r, hold) => { const s = stub(r, 'archivedExpiryPass', hold, undefined); return () => s.mock.calls.length; } },
  { key: 'deadCoordinator', clock: 'mono', run: (r) => r.w.sweepDeadCoordinators([], []),
    spy: (r, hold) => { const s = stub(r, 'deadCoordinatorPass', hold, undefined); return () => s.mock.calls.length; } },
];
const MONO = LANES.filter((l) => l.clock === 'mono');

describe.each(LANES)('the $key lane: the throttle', (lane) => {
  it('runs on the first call, skips inside its cadence, runs once the cadence has elapsed', async () => {
    const r = rig(); const n = lane.spy(r);
    wall(NOW);
    await lane.run(r);
    expect(n(), 'did not run on the first call').toBe(1);
    await lane.run(r);
    expect(n(), 'ran twice at one instant').toBe(1);
    r.t.mono += CAD - 1; wall(NOW + CAD - 1);
    await lane.run(r);
    expect(n(), 'ran inside its cadence').toBe(1);
    r.t.mono += 1; wall(NOW + CAD);
    await lane.run(r);
    expect(n(), 'did not run at its cadence').toBe(2);
  });

  it('a throw in the pass reaches the caller (tick\'s own catch), and the slot is spent', async () => {
    const r = rig();
    const target = lane.key === 'childReclaim' ? 'childReclaimGatherGenerations'
      : lane.key === 'collect' ? 'collectPass' : lane.key === 'archivedExpiry' ? 'archivedExpiryPass' : 'deadCoordinatorPass';
    const pass = vi.spyOn(r.w as unknown as Priv, target).mockImplementation((() => Promise.reject(new Error('pass failed'))) as never);
    wall(NOW);
    await expect(lane.run(r)).rejects.toThrow('pass failed');
    await lane.run(r);
    expect(pass.mock.calls.length, 'a failed pass did not spend its slot').toBe(1);
    r.t.mono += CAD; wall(NOW + CAD);
    await expect(lane.run(r)).rejects.toThrow('pass failed');
    expect(pass.mock.calls.length).toBe(2);
  });
});

describe('the wall clock stepped by an hour between two calls', () => {
  it.each(MONO)('$key (monotonic): neither a step back nor a step forward moves it', async (lane) => {
    const r = rig(); const n = lane.spy(r);
    wall(NOW);
    await lane.run(r);
    wall(NOW - HOUR);
    await lane.run(r);
    expect(n(), 'a wall step back held the lane').toBe(1);
    wall(NOW + HOUR);
    await lane.run(r);
    expect(n(), 'a wall step forward ran the lane early').toBe(1);
    r.t.mono += CAD;
    await lane.run(r);
    expect(n(), 'the monotonic cadence did not run the lane').toBe(2);
  });

  // The AFTER rows of the behaviour commit (spec K11, §5.1 rule 1b), the two rows that changed. BEFORE, these lanes throttled
  // on `Date.now()`: a wall clock stepped back held the lane for up to the step (a whole cadence on the monotonic clock still
  // did not run it), and one stepped forward ran it at once. AFTER, the cadence is real time: the step back runs the lane at its
  // cadence, and the step forward does not run it early.
  it.each(MONO.filter((l) => l.key === 'archivedExpiry' || l.key === 'deadCoordinator'))('$key: after the move, a step back runs the lane at its cadence and a step forward never runs it early', async (lane) => {
    const r = rig(); const n = lane.spy(r);
    wall(NOW);
    await lane.run(r);
    wall(NOW - HOUR);
    r.t.mono += CAD;
    await lane.run(r);
    expect(n(), 'AFTER: a wall step back, a whole cadence on the monotonic clock, runs the lane').toBe(2);
    wall(NOW + HOUR);
    await lane.run(r);
    expect(n(), 'AFTER: a wall step forward runs the lane early').toBe(2);
  });
});

describe('the flight of each lane', () => {
  it('child reclaim has no guard: a due call overlaps a gather still out, and the older pass is overtaken', async () => {
    const r = rig();
    const hold = deferred<Map<string, never>>();
    const gather = vi.spyOn(r.w as unknown as Priv, 'childReclaimGatherGenerations').mockImplementation((() => hold.promise) as never);
    const decided = vi.spyOn(r.w as unknown as Priv, 'childReclaimLaneNow');
    // The decision clock reads of ONE pass that is not overtaken, measured on a rig of its own.
    const solo = rig();
    const soloHold = deferred<Map<string, never>>();
    vi.spyOn(solo.w as unknown as Priv, 'childReclaimGatherGenerations').mockImplementation((() => soloHold.promise) as never);
    const soloReads = vi.spyOn(solo.w as unknown as Priv, 'childReclaimLaneNow');
    const soloRun = solo.w.sweepChildReclaim([], []); await settleTurns();
    const soloBefore = soloReads.mock.calls.length;
    soloHold.resolve(new Map<string, never>()); await soloRun;
    const onePass = soloReads.mock.calls.length - soloBefore;
    wall(NOW);
    void r.w.sweepChildReclaim([], []); await settleTurns();
    expect(gather.mock.calls.length, 'the first call did not gather').toBe(1);
    r.t.mono += CAD;
    void r.w.sweepChildReclaim([], []); await settleTurns();
    expect(gather.mock.calls.length, 'a due call did not overlap the run in flight').toBe(2);
    const readsBefore = decided.mock.calls.length;
    hold.resolve(new Map<string, never>()); await settleTurns();
    // Only the newer pass decides: the older was overtaken while it gathered, so it never read the decision clock.
    expect(decided.mock.calls.length - readsBefore, 'the overtaken pass decided').toBe(onePass);
  });

  it.each(LANES.filter((l) => l.key !== 'childReclaim'))('$key keeps one pass at a time: a pass that never settles keeps a due call out', async (lane) => {
    const r = rig();
    const n = lane.spy(r, new Promise<void>(() => {}));
    wall(NOW);
    void lane.run(r); await settleTurns();
    expect(n(), 'the first pass did not start').toBe(1);
    r.t.mono += CAD; wall(NOW + CAD);
    void lane.run(r); await settleTurns();
    expect(n(), 'a second pass started over the first').toBe(1);
    r.t.mono += 10 * CAD; wall(NOW + 10 * CAD);
    void lane.run(r); await settleTurns();
    expect(n(), 'a second pass started over the first, much later').toBe(1);
  });

  it('deadCoordinator: a direct second call over a pass that never settles returns at once, not on the pass', async () => {
    const r = rig();
    const lane = LANES.find((l) => l.key === 'deadCoordinator')!;
    const n = lane.spy(r, new Promise<void>(() => {}));
    wall(NOW);
    void lane.run(r); await settleTurns();
    expect(n(), 'the first pass did not start').toBe(1);
    r.t.mono += 10 * CAD; wall(NOW + 10 * CAD);
    // Awaited, not `void`: a joining call would hang here, and the suite times out.
    await lane.run(r);
    expect(n(), 'a second pass started over the first').toBe(1);
  });

  it.each(LANES.filter((l) => l.key !== 'childReclaim'))('$key: a pass that settles frees the flight, and the next due call runs', async (lane) => {
    const r = rig(); const n = lane.spy(r);
    wall(NOW);
    await lane.run(r);
    r.t.mono += CAD; wall(NOW + CAD);
    await lane.run(r);
    expect(n()).toBe(2);
  });

  it('a skipped call (a pass in flight) does not spend the cadence: the lane runs at once when the pass settles and the cadence has elapsed', async () => {
    const r = rig();
    const hold = deferred();
    const n = LANES[2]!.spy(r, hold.promise);
    wall(NOW);
    void r.w.sweepArchivedExpiry([], []); await settleTurns();
    r.t.mono += CAD; wall(NOW + CAD);
    void r.w.sweepArchivedExpiry([], []); await settleTurns();
    hold.resolve(); await settleTurns();
    void r.w.sweepArchivedExpiry([], []); await settleTurns();
    expect(n(), 'the skipped call stamped the lane').toBe(2);
  });
});

describe('a gather slower than the cadence re-stamps from the decision clock', () => {
  it('child reclaim: the next call is throttled from the decision, not from the start', async () => {
    const r = rig();
    const hold = deferred<Map<string, never>>();
    const gather = vi.spyOn(r.w as unknown as Priv, 'childReclaimGatherGenerations').mockImplementation((() => hold.promise) as never);
    wall(NOW);
    const first = r.w.sweepChildReclaim([], []); await settleTurns();
    r.t.mono += CAD - 1;                                   // the gather settles just short of an interval after the gate
    hold.resolve(new Map<string, never>()); await first;
    r.t.mono += 1;                                         // an interval after the gate's stamp, 1 ms after the decision
    await r.w.sweepChildReclaim([], []);
    expect(gather.mock.calls.length, 'a slow gather did not re-stamp from the decision').toBe(1);
    r.t.mono += CAD - 2;
    await r.w.sweepChildReclaim([], []);
    expect(gather.mock.calls.length, 'ran inside the interval after the decision').toBe(1);
    r.t.mono += 1;
    await r.w.sweepChildReclaim([], []);
    expect(gather.mock.calls.length, 'did not run an interval after the decision').toBe(2);
  });

  it('collect: the same, and a tick that lands mid-gather is throttled', async () => {
    const f = await collectRig();
    const gate = f.holdGather();
    const first = f.pass();
    await vi.waitFor(() => expect(f.gatherReached()).toBe(1));
    f.advance(CAD - 1);
    gate.release(); await first;
    f.advance(1);
    await f.pass();
    expect(f.gatherReached(), 'a slow gather did not re-stamp from the decision').toBe(1);
    f.advance(CAD - 2); await f.pass();
    expect(f.gatherReached(), 'ran inside the interval after the decision').toBe(1);
    f.advance(1); await f.pass();
    expect(f.gatherReached(), 'did not run an interval after the decision').toBe(2);
  });
});

describe('the dead-coordinator seal', () => {
  it('a seal during a pass waits for that pass, and no pass starts after the seal', async () => {
    const r = rig();
    const hold = deferred();
    const n = LANES[3]!.spy(r, hold.promise);
    wall(NOW);
    void r.w.sweepDeadCoordinators([], []); await settleTurns();
    expect(n()).toBe(1);
    expect(r.w.sealDeadCoordinatorBreakerNow(), 'a synchronous seal over a running pass').toEqual({ sealed: false, reason: 'pass-in-flight' });
    // `sealDeadCoordinatorBreakerNow` already stopped the lane; a bounded seal waits for the pass it found.
    const r2 = rig();
    const hold2 = deferred();
    const n2 = LANES[3]!.spy(r2, hold2.promise);
    wall(NOW);
    void r2.w.sweepDeadCoordinators([], []); await settleTurns();
    let sealed = false;
    const seal = r2.w.sealDeadCoordinatorBreaker(60_000).then((x) => { sealed = true; return x; });
    await settleTurns();
    expect(sealed, 'the seal did not wait for the pass in flight').toBe(false);
    hold2.resolve(); await seal;
    expect(sealed).toBe(true);
    r2.t.mono += 10 * CAD; wall(NOW + 10 * CAD);
    await r2.w.sweepDeadCoordinators([], []);
    expect(n2(), 'a pass started after the seal').toBe(1);
  });

  it('a bounded seal gives up at its bound and writes nothing while the pass still runs', async () => {
    const r = rig();
    LANES[3]!.spy(r, new Promise<void>(() => {}));
    wall(NOW);
    void r.w.sweepDeadCoordinators([], []); await settleTurns();
    await expect(r.w.sealDeadCoordinatorBreaker(5)).resolves.toEqual({ sealed: false, reason: 'pass-in-flight' });
  });
});

describe('tick keeps the call shape of the four fire-and-forget lanes', () => {
  for (const method of ['sweepChildReclaim', 'sweepArchivedExpiry', 'sweepDeadCoordinators', 'sweepTempRootCollect']) {
    it(`${method}: a body that never settles delays neither this tick nor the next`, async () => {
      const r = rig();
      const m = vi.spyOn(r.w as unknown as Record<string, () => Promise<void>>, method).mockImplementation(() => new Promise<void>(() => {}));
      wall(NOW);
      await expect(r.w.tick()).resolves.toBeUndefined();
      wall(NOW + HOUR);
      r.t.mono += HOUR;
      await expect(r.w.tick()).resolves.toBeUndefined();
      expect(m.mock.calls.length).toBeGreaterThan(0);
    });
  }
});
