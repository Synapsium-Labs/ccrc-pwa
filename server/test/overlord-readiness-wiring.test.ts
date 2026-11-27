// Overlord W1 readiness, review 3922 F7: the lane is wired and the watcher calls it. The lane's own cases build a lane and call
// `pass` themselves, so nothing there goes red when the composition root stops assigning it or the watcher stops calling it.
// (a) the watcher's `sweepOverlordReadiness` runs the lane's pass through its `overlordReadiness` lane, once per cadence, with the
// tick it is given; (b) pins, read through the parser (ARCH-06: no literal source pin), on the three call sites no behaviour test
// reaches without a whole tick: `index.ts` assigns `deps.overlordReadiness`, and `watch.ts` calls the sweep once on a failed
// listing and once on a listed tick, and the sweep runs the lane through `runLane('overlordReadiness', …)`.
import { describe, it, expect } from 'vitest';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import type { ReadinessLane, ReadinessTick } from '../src/coord/overlordReadinessLane.js';
import { OVERLORD_READINESS_SWEEP_MS } from '../../shared/overlord-readiness.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { callsIn, parsedFile, symbolOf } from './scan/symbols.js';
import { nameWrites } from './scan/parse.js';

const LISTED: ReadinessTick = { listed: true, sessions: [], records: [], listedIds: new Set(), names: [] };
const FAILED: ReadinessTick = { listed: false };

function build(withLane: boolean) {
  let mono = 1_000_000;
  const passes: ReadinessTick[] = [];
  const reaches: unknown[] = [];
  const lane = { pass: async (tick: ReadinessTick, reach?: unknown) => { passes.push(tick); reaches.push(reach); return null; } } as unknown as ReadinessLane;
  const deps = { ...testDeps(mkTmp('ccrc-readiness-wiring-')), monotonicMs: () => mono, ...(withLane ? { overlordReadiness: lane } : {}) };
  const watcher = quietAtTestEnd(new FleetWatcher(deps as never, new Bus(), 10_000));
  return { watcher, passes, reaches, advance: (ms: number) => { mono += ms; } };
}

describe('the watcher runs the readiness lane (F7)', () => {
  it('sweepOverlordReadiness passes the tick it is given to the lane, on a listed tick and on a failed listing', async () => {
    const f = build(true);
    await f.watcher.sweepOverlordReadiness(LISTED);
    f.advance(OVERLORD_READINESS_SWEEP_MS + 1);
    await f.watcher.sweepOverlordReadiness(FAILED);
    expect(f.passes).toEqual([LISTED, FAILED]);
  });

  it('hands the lane the watcher\'s item reach (R4): a function that builds an item\'s bound write, silent for a soon item', async () => {
    const f = build(true);
    await f.watcher.sweepOverlordReadiness(LISTED);
    const reach = f.reaches[0] as ((item: { title: string; neededBy: 'soon' }) => (id: number) => { due: { due: string; why?: string } }) | undefined;
    expect(typeof reach).toBe('function');
    const bound = reach!({ title: 'An item', neededBy: 'soon' })(7);
    expect(bound.due.due).toBe('silent'); // never `now`: a soon item does not push
  });

  it('with no lane wired it runs nothing and answers null', () => {
    const f = build(false);
    expect(f.watcher.sweepOverlordReadiness(LISTED)).toBeNull();
    expect(f.passes).toEqual([]);
  });
});

describe('the composition and the two tick paths, read through the parser (F7)', () => {
  it('index.ts assigns deps.overlordReadiness from the lane builder', () => {
    const writes = nameWrites(parsedFile('server/src/index.ts')).filter((x) => x.name === 'deps' && x.member === 'overlordReadiness');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.value.startsWith('readinessLaneOver(')).toBe(true);
  });

  it('watch.ts calls the sweep twice: once with listed: false, once with listed: true, through the overlordReadiness lane', () => {
    const sweeps = parsedFile('server/src/watch.ts').calls.filter((c) => c.callee === 'this.sweepOverlordReadiness');
    expect(sweeps).toHaveLength(2);
    const firstArg = sweeps.map((c) => c.args[0]?.text.replace(/\s+/g, ' ') ?? '');
    expect(firstArg.filter((a) => a.startsWith('{ listed: false'))).toHaveLength(1);
    expect(firstArg.filter((a) => a.startsWith('{ listed: true'))).toHaveLength(1);
    const lanes = callsIn(symbolOf('server/src/watch.ts', 'FleetWatcher.sweepOverlordReadiness')).filter((c) => c.callee === 'this.runLane');
    expect(lanes.map((c) => c.args[0]?.text)).toEqual(['overlordReadiness']);
  });
});
