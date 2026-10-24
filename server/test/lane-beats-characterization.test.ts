// Characterization (D-5862; ARCH-68 #803; spec K11): the four beats `FleetWatcher.tick` fires above and beside the
// registry read (the caps refresh, the catalogue poll, the inventory sweep and the server-caps write), driven through
// `tick` and their own on-demand doors on a fake clock. Green on the hand-rolled `last*` clocks and guards; the move onto
// `runLane` ran these rows unchanged, so a beat that stamped late, stopped joining, lost its one rerun or started to delay the
// tick shows here and not in a fleet. The four beats throttled on the wall clock and now throttle on the monotonic clock
// (OA-C4, ruled (a) on #803): the fixture injects `Deps.monotonicMs` as the fake clock less every wall step (`step`), so
// the fake timers move real time and a `step` moves the wall clock alone. Fixture homes only.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import type { CataloguePoller } from '../src/update/catalogue.js';
import type { NodeRole } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const mocks = vi.hoisted(() => ({
  writeServerCaps: vi.fn(),
  sweepInventory: vi.fn(),
  resolveAndProject: vi.fn(),
}));
vi.mock('../src/update/serverCaps.js', async (orig) => ({ ...(await orig<object>()), writeServerCaps: mocks.writeServerCaps }));
vi.mock('../src/update/inventory.js', async (orig) => ({ ...(await orig<object>()), sweepInventory: mocks.sweepInventory }));
vi.mock('../src/update/project.js', async (orig) => ({ ...(await orig<object>()), resolveAndProject: mocks.resolveAndProject }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.writeServerCaps.mockReset(); mocks.sweepInventory.mockReset(); mocks.resolveAndProject.mockReset();
});

const MIN = 60_000;
const HOUR = 60 * MIN;

/** What every `step` has moved the fake wall clock by, with no real time passing. `Deps.monotonicMs` reads the fake clock less
 *  this, so the throttle sees real time only. */
let stepped = 0;
const monotonicMs = (): number => Date.now() - stepped;
/** A wall-clock step by `ms` (negative: back): the wall clock moves, the monotonic clock does not. */
function step(ms: number): void { vi.setSystemTime(Date.now() + ms); stepped += ms; }

interface Opts { role?: NodeRole; coord?: boolean; catalogue?: CataloguePoller; refreshCaps?: () => Promise<void> }

function fixture(o: Opts = {}) {
  if (mocks.writeServerCaps.getMockImplementation() === undefined) mocks.writeServerCaps.mockResolvedValue({ ok: true });
  const home = mkTmp('ccrc-lane-beats-');
  seedRoster(home);
  const base = testDeps(home);
  stepped = 0;
  mkdirSync(base.cfg.registryDir, { recursive: true });       // LISTABLE: the tick reaches every lane
  const deps = {
    ...base,
    monotonicMs,
    cfg: { ...base.cfg, role: o.role ?? ('server' as NodeRole) },
    ...(o.coord ? { coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))) } : {}),
    ...(o.catalogue ? { catalogue: o.catalogue } : {}),
    ...(o.refreshCaps ? { refreshCaps: o.refreshCaps } : {}),
  };
  const w = new FleetWatcher(deps as never, new Bus(), 10_000, path.join(home, 'state-cache.json'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const said = (needle: string): string[] => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(needle));
  return { w, warn, said };
}

const settle = async (w: FleetWatcher): Promise<void> => { await vi.advanceTimersByTimeAsync(0); await w.settled(); };

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function poller(onPoll: (now: number) => Promise<unknown>): CataloguePoller {
  return {
    poll: async (now: number) => { await onPoll(now); return { lastOkAt: null, lastError: null }; },
    state: () => ({ lastOkAt: null, lastError: null }),
    lastRequestAt: () => null,
  } as CataloguePoller;
}

describe('the caps beat (every 60 s, monotonic clock)', () => {
  it('runs on the first tick, skips inside the cadence, runs once it has elapsed', async () => {
    let calls = 0;
    const h = fixture({ refreshCaps: async () => { calls += 1; } });
    vi.useFakeTimers();
    await h.w.tick(); await h.w.tick(); await h.w.tick();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(MIN - 1);
    await h.w.tick();
    expect(calls, 'ran inside its cadence').toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await h.w.tick();
    expect(calls, 'did not run at its cadence').toBe(2);
  });

  it('a throw is swallowed silently and the next due tick still runs', async () => {
    let calls = 0;
    const h = fixture({ refreshCaps: async () => { calls += 1; throw new Error('agent wedged'); } });
    vi.useFakeTimers();
    await expect(h.w.tick()).resolves.toBeUndefined();
    expect(h.warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MIN);
    await h.w.tick();
    expect(calls).toBe(2);
  });

  // The AFTER row of OA-C4 (#803). BEFORE: a step back held the lane for the hour and a step forward ran it at once.
  it('a wall clock stepped back one hour runs the lane at its cadence; stepped forward it never runs early', async () => {
    let calls = 0;
    const h = fixture({ refreshCaps: async () => { calls += 1; } });
    vi.useFakeTimers();
    await h.w.tick();
    step(-HOUR);
    await vi.advanceTimersByTimeAsync(MIN);
    await h.w.tick();
    expect(calls, 'AFTER: a wall step back, a whole cadence of real time, runs the lane').toBe(2);
    step(2 * HOUR);
    await h.w.tick();
    expect(calls, 'AFTER: a wall step forward ran the lane early').toBe(2);
  });

  it('a refresh that never settles delays neither this tick nor the next', async () => {
    let calls = 0;
    const h = fixture({ refreshCaps: () => { calls += 1; return new Promise<void>(() => {}); } });
    vi.useFakeTimers();
    await h.w.tick();
    await vi.advanceTimersByTimeAsync(MIN);
    await h.w.tick();
    expect(calls).toBe(2);
  });
});

describe('the catalogue beat (every 30 min, monotonic clock)', () => {
  it('polls on the first tick, skips inside the cadence, polls once it has elapsed', async () => {
    const polls: number[] = [];
    const h = fixture({ catalogue: poller(async (n) => { polls.push(n); }) });
    vi.useFakeTimers();
    await h.w.tick(); await h.w.tick();
    expect(polls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30 * MIN - 1);
    await h.w.tick();
    expect(polls, 'polled inside its cadence').toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await h.w.tick();
    expect(polls, 'did not poll at its cadence').toHaveLength(2);
  });

  it('a rejection is caught with the lane\'s sentence and the next due tick still polls', async () => {
    let n = 0;
    const h = fixture({ catalogue: poller(async () => { n += 1; throw new Error('listing exploded'); }) });
    vi.useFakeTimers();
    await h.w.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.said('the catalogue poller rejected')).toHaveLength(1);
    expect(h.said('the catalogue poller rejected')[0]).toMatch(
      /^ccrc-server: the catalogue poller rejected — this is a bug, poll\(\) should never reject: Error: listing exploded/);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    await h.w.tick();
    expect(n).toBe(2);
  });

  // The AFTER row of OA-C4 (#803). BEFORE: a step back held the lane for the hour and a step forward ran it at once.
  it('a wall clock stepped back one hour runs the lane at its cadence; stepped forward it never runs early', async () => {
    let n = 0;
    const h = fixture({ catalogue: poller(async () => { n += 1; }) });
    vi.useFakeTimers();
    await h.w.tick();
    step(-HOUR);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    await h.w.tick();
    expect(n, 'AFTER: a wall step back, a whole cadence of real time, runs the lane').toBe(2);
    step(2 * HOUR);
    await h.w.tick();
    expect(n, 'AFTER: a wall step forward ran the lane early').toBe(2);
  });
});

describe('the inventory beat (every 60 s, monotonic clock; one run in flight, one rerun)', () => {
  const sweeps = () => mocks.sweepInventory.mock.calls.length;
  const arm = () => { mocks.sweepInventory.mockResolvedValue([]); mocks.resolveAndProject.mockResolvedValue({ projection: { ok: true } }); };

  it('runs on the first tick, skips inside the cadence, runs once it has elapsed', async () => {
    arm();
    const h = fixture({ coord: true });
    vi.useFakeTimers();
    await h.w.tick(); await settle(h.w); await h.w.tick(); await settle(h.w);
    expect(sweeps()).toBe(1);
    await vi.advanceTimersByTimeAsync(MIN - 1);
    await h.w.tick(); await settle(h.w);
    expect(sweeps(), 'ran inside its cadence').toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await h.w.tick(); await settle(h.w);
    expect(sweeps(), 'did not run at its cadence').toBe(2);
  });

  it('an on-demand inventory pushes the beat back', async () => {
    arm();
    const h = fixture({ coord: true });
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(MIN);
    await h.w.inventoryNow();
    expect(sweeps()).toBe(1);
    await h.w.tick(); await settle(h.w);
    expect(sweeps(), 'the tick swept straight after an on-demand run').toBe(1);
  });

  it('a caller during a run joins it', async () => {
    const gate = deferred<unknown[]>();
    mocks.sweepInventory.mockReturnValue(gate.promise);
    mocks.resolveAndProject.mockResolvedValue({ projection: { ok: true } });
    const h = fixture({ coord: true });
    const a = h.w.inventoryNow();
    const b = h.w.inventoryNow();
    expect(b, 'a second caller started a second run').toBe(a);
    gate.resolve([]);
    await a;
    expect(sweeps()).toBe(1);
  });

  it('three triggers during a run in flight cause exactly one rerun', async () => {
    const gates = [deferred<unknown[]>(), deferred<unknown[]>(), deferred<unknown[]>()];
    let i = 0;
    mocks.sweepInventory.mockImplementation(() => gates[i++]!.promise);
    mocks.resolveAndProject.mockResolvedValue({ projection: { ok: true } });
    const h = fixture({ coord: true });
    h.w.triggerInventory();
    await vi.waitFor(() => expect(sweeps()).toBe(1));
    h.w.triggerInventory(); h.w.triggerInventory(); h.w.triggerInventory();
    expect(sweeps(), 'a joiner started a run of its own').toBe(1);
    gates[0]!.resolve([]);
    await vi.waitFor(() => expect(sweeps()).toBe(2));
    gates[1]!.resolve([]);
    await h.w.settled();
    await new Promise((r) => setTimeout(r, 20));
    expect(sweeps(), 'joiners queued more than one rerun').toBe(2);
  });

  it('a throw outside the per-row catch is warned once and the next sweep still runs', async () => {
    mocks.sweepInventory.mockRejectedValueOnce(new Error('plumbing broke')).mockResolvedValue([]);
    mocks.resolveAndProject.mockResolvedValue({ projection: { ok: true } });
    const h = fixture({ coord: true });
    vi.useFakeTimers();
    await h.w.tick(); await settle(h.w);
    expect(h.said('the inventory sweep rejected')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(MIN);
    await h.w.tick(); await settle(h.w);
    expect(sweeps()).toBe(2);
  });

  // The AFTER row of OA-C4 (#803). BEFORE: a step back held the lane for the hour and a step forward ran it at once.
  it('a wall clock stepped back one hour runs the lane at its cadence; stepped forward it never runs early', async () => {
    arm();
    const h = fixture({ coord: true });
    vi.useFakeTimers();
    await h.w.tick(); await settle(h.w);
    step(-HOUR);
    await vi.advanceTimersByTimeAsync(MIN);
    await h.w.tick(); await settle(h.w);
    expect(sweeps(), 'AFTER: a wall step back, a whole cadence of real time, runs the lane').toBe(2);
    step(2 * HOUR);
    await h.w.tick(); await settle(h.w);
    expect(sweeps(), 'AFTER: a wall step forward ran the lane early').toBe(2);
  });

  it('a sweep that never settles delays neither this tick nor its busy to idle push', async () => {
    mocks.sweepInventory.mockReturnValue(new Promise(() => {}));
    const h = fixture({ coord: true });
    vi.useFakeTimers();
    await expect(h.w.tick()).resolves.toBeUndefined();
    expect(sweeps()).toBe(1);
  });
});

describe('the server-caps beat (every 60 s, monotonic clock; one write in flight, joined)', () => {
  const writes = () => mocks.writeServerCaps.mock.calls.length;

  it('writes on the first tick, skips inside the cadence, writes once it has elapsed', async () => {
    mocks.writeServerCaps.mockResolvedValue({ ok: true });
    const h = fixture({ role: 'both' });
    vi.useFakeTimers();
    await h.w.tick(); await settle(h.w); await h.w.tick(); await settle(h.w);
    expect(writes()).toBe(1);
    await vi.advanceTimersByTimeAsync(MIN - 1);
    await h.w.tick(); await settle(h.w);
    expect(writes(), 'wrote inside its cadence').toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await h.w.tick(); await settle(h.w);
    expect(writes(), 'did not write at its cadence').toBe(2);
  });

  it('a second caller joins the run in flight', async () => {
    const gate = deferred<unknown>();
    mocks.writeServerCaps.mockReturnValue(gate.promise);
    const h = fixture({ role: 'server' });
    const a = h.w.serverCapsNow();
    const b = h.w.serverCapsNow();
    expect(b, 'a second caller started a second write').toBe(a);
    gate.resolve({ ok: true });
    await a;
    expect(writes()).toBe(1);
  });

  it('an on-demand write pushes the beat back, and a fleet-role node stamps without writing', async () => {
    mocks.writeServerCaps.mockResolvedValue({ ok: true });
    const h = fixture({ role: 'server' });
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(MIN);
    await h.w.serverCapsNow();
    await h.w.tick(); await settle(h.w);
    expect(writes(), 'the tick wrote straight after an on-demand write').toBe(1);

    const f = fixture({ role: 'fleet' });
    await vi.advanceTimersByTimeAsync(MIN);
    await expect(f.w.serverCapsNow()).resolves.toBeNull();
    await f.w.tick(); await settle(f.w);
    expect(writes(), 'a fleet-role node wrote').toBe(1);
  });

  // The AFTER row of OA-C4 (#803). BEFORE: a step back held the lane for the hour and a step forward ran it at once.
  it('a wall clock stepped back one hour runs the lane at its cadence; stepped forward it never runs early', async () => {
    mocks.writeServerCaps.mockResolvedValue({ ok: true });
    const h = fixture({ role: 'both' });
    vi.useFakeTimers();
    await h.w.tick(); await settle(h.w);
    step(-HOUR);
    await vi.advanceTimersByTimeAsync(MIN);
    await h.w.tick(); await settle(h.w);
    expect(writes(), 'AFTER: a wall step back, a whole cadence of real time, runs the lane').toBe(2);
    step(2 * HOUR);
    await h.w.tick(); await settle(h.w);
    expect(writes(), 'AFTER: a wall step forward ran the lane early').toBe(2);
  });
});
