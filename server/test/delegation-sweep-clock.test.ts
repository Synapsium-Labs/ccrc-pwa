// D-5862 (ARCH-68 #803; spec K11, §5.1 rule 1b): the delegation lane's cadence. Driven through `sweepDelegation` with a census
// planted, counting how often the lane reads the census: it does so once per call that is neither refused by the single flight nor
// throttled, so the count is the number of passes that started. Fixture home only; no ccd verb runs.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, DELEGATION_SWEEP_MS } from '../src/watch.js';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import type { DelegationCensusPass } from '../src/coord/gitref.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.UTC(2026, 9, 15, 10, 0, 0);
const HOUR = 3_600_000;
/** What every `step` has moved the fake wall clock by, with no real time passing: `Deps.monotonicMs` reads the fake clock less this. */
let stepped = 0;
const watchers: FleetWatcher[] = [];

function world() {
  const home = mkTmp('ccrc-dlane-clock-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  stepped = 0;
  const deps = {
    ...testDeps(home),
    coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))),
    fleetState: { connected: true, downSince: null, ccdVerbs: ['caps'] },
    monotonicMs: () => Date.now() - stepped,
  };
  const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
  watchers.push(watcher);
  let reads = 0;
  let census: DelegationCensusPass | null = null;
  Object.defineProperty(watcher, 'delegationCensus', { get: () => { reads++; return census; }, set: (v: DelegationCensusPass | null) => { census = v; } });
  const plant = (): void => { census = { measuredAt: Date.now(), projects: new Map(), incarnations: new Map() } as DelegationCensusPass; };
  return { watcher, plant, reads: () => reads, call: () => watcher.sweepDelegation([] as never, [] as never) };
}
const at = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };
const wallStep = (ms: number): void => { stepped += ms; at(Date.now() + ms); };

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(watchers.splice(0).map((w) => w.closeDelegation().catch(() => undefined)));
});

describe('the delegation lane\'s cadence (D-5862)', () => {
  it('runs on the first call, skips inside its cadence and runs once the cadence has elapsed', async () => {
    const w = world();
    at(NOW); w.plant();
    await w.call();
    expect(w.reads()).toBe(1);
    at(NOW + DELEGATION_SWEEP_MS - 1);
    await w.call();
    expect(w.reads(), 'inside the cadence').toBe(1);
    at(NOW + DELEGATION_SWEEP_MS);
    await w.call();
    expect(w.reads(), 'at the cadence').toBe(2);
  });

  it('with no census yet it does not spend its cadence: every call asks again until one exists', async () => {
    const w = world();
    at(NOW);
    await w.call();
    await w.call();
    expect(w.reads()).toBe(2);
    w.plant();
    await w.call();
    expect(w.reads(), 'the first call with a census runs').toBe(3);
    await w.call();
    expect(w.reads(), 'and now it is spent').toBe(3);
  });

  it('a call beside a pass still running is refused, and the next one after it ends runs', async () => {
    const w = world();
    at(NOW); w.plant();
    const first = w.call();
    const second = w.call();                                          // refused by the single flight before it reads the census
    await Promise.all([first, second]);
    expect(w.reads()).toBe(1);
    at(NOW + DELEGATION_SWEEP_MS);
    await w.call();
    expect(w.reads()).toBe(2);
  });

  it('WALL (today): a wall clock stepped back by an hour holds the lane for the step, though a whole cadence of real time passed', async () => {
    const w = world();
    at(NOW); w.plant();
    await w.call();
    wallStep(-HOUR);
    at(Date.now() + DELEGATION_SWEEP_MS);                             // a whole cadence of real time passes
    await w.call();
    expect(w.reads()).toBe(1);
  });

  it('WALL (today): a wall clock stepped forward by an hour runs the lane early, with no real time passed', async () => {
    const w = world();
    at(NOW); w.plant();
    await w.call();
    wallStep(HOUR);
    await w.call();
    expect(w.reads()).toBe(2);
  });
});
