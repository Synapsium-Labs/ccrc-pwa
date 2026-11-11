import { describe, expect, it } from 'vitest';
import { chance } from './world.js';
import { assertScenario, simSeeds, simulate, type Scenario, type SimContext } from './run.js';
import type { Invariant } from './sequence.js';

type CoinEdge = 'heads' | 'tails';
const MINUTE = 60_000;
const coin: Scenario<CoinEdge> = {
  name: 'coin', startWallMs: 1_786_000_000_000, durationMs: 60 * MINUTE, edges: ['heads', 'tails'],
  setup(ctx: SimContext<CoinEdge>) {
    const beat = (): void => {
      const state: CoinEdge = chance(ctx.entropy, 0.5) ? 'heads' : 'tails';
      ctx.seq.append({ kind: 'coin', id: 'c', state, actor: 'sim' });
      ctx.cover(state);
      ctx.world.envAfter(MINUTE, beat);
    };
    ctx.world.envAfter(MINUTE, beat);
  },
};

const AMBIENT_CALLS: Record<string, () => unknown> = {
  'Date.now': () => Date.now(),
  'performance.now': () => performance.now(),
  'Math.random': () => Math.random(),
  setTimeout: () => globalThis.setTimeout(() => {}, 1),
};

describe('simulate and the seed-replay convention', () => {
  it('the same seed gives the same lines, twice', () => {
    expect(simulate(coin, 7, []).lines).toEqual(simulate(coin, 7, []).lines);
  });
  it('two seeds give different lines', () => {
    expect(simulate(coin, 1, []).lines).not.toEqual(simulate(coin, 2, []).lines);
  });
  it('simSeeds: the defaults, one replayed seed, a soak, and a typo', () => {
    expect(simSeeds([5, 6], {})).toEqual([5, 6]);
    expect(simSeeds([5, 6], { CCRC_SIM_SEED: '17' })).toEqual([17]);
    expect(simSeeds([5], { CCRC_SIM_SEEDS: '3' })).toEqual([1, 2, 3, 5]);
    expect(() => simSeeds([5], { CCRC_SIM_SEED: 'x' })).toThrow(/CCRC_SIM_SEED/);
    expect(() => simSeeds([5], { CCRC_SIM_SEEDS: '0' })).toThrow(/CCRC_SIM_SEEDS/);
    expect(() => simSeeds([5], { CCRC_SIM_SEED: '1', CCRC_SIM_SEEDS: '3' })).toThrow(/CCRC_SIM_SEED/);
  });
  it('a violation names the scenario, seed, invariant, line and replay command', () => {
    const neverTails: Invariant = { name: 'never-tails', says: 'no tails', check: (ls) => {
      const l = ls.find((x) => x.state === 'tails'); return l ? { invariant: 'never-tails', seq: l.seq, message: 'tails' } : null; } };
    expect(() => assertScenario(coin, [neverTails], { seeds: [1], testFile: 'test/sim/run.test.ts', env: {} })).toThrow(
      /scenario coin, seed 1: never-tails: tails \(line \d+\)\nreplay: cd server && CCRC_SIM_SEED=1 \.\/node_modules\/\.bin\/vitest run test\/sim\/run\.test\.ts/);
  });
  it('an edge no seed reaches is red, and names the edge', () => {
    const never = { ...coin, edges: ['heads', 'tails', 'edge'] as const };
    expect(() => assertScenario(never, [], { seeds: [1, 2, 3], testFile: 't', env: {} })).toThrow(/never reached: edge/);
    expect(() => assertScenario(never, [], { seeds: [1], testFile: 't', env: { CCRC_SIM_SEED: '1' } })).not.toThrow();
  });
  it.each(['Date.now', 'performance.now', 'Math.random', 'setTimeout'])('the ambient guard refuses %s', (name) => {
    const bad = { ...coin, setup: () => { AMBIENT_CALLS[name]!(); } };
    expect(() => simulate(bad, 1, [])).toThrow(`ambient ${name} inside the simulator`);
  });
  it('a scheduled call that throws fails the run, not only a warning line', () => {
    const bad = { ...coin, setup: (ctx: SimContext<CoinEdge>) => {
      ctx.world.server.scheduler.after(1, () => { throw new Error('boom'); }); } };
    expect(() => simulate(bad, 1, [])).toThrow('scenario coin, seed 1: ccrc-server: a scheduled call failed: boom');
  });
  it('a timer that re-arms at 0 ms fails the run at the budget, instead of hanging', () => {
    const loop = { ...coin, setup: (ctx: SimContext<CoinEdge>) => {
      const again = (): void => { ctx.world.envAfter(0, again); };
      ctx.world.envAfter(0, again); } };
    expect(() => simulate(loop, 1, [])).toThrow(/scheduled calls/);
  });
  it('the real functions are back after a run, a failed one included', () => {
    const now = Date.now; const bad = { ...coin, setup: () => { throw new Error('boom'); } };
    expect(() => simulate(bad, 1, [])).toThrow('boom');
    expect(Date.now).toBe(now);
  });
});
