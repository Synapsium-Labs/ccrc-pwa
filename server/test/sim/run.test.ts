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
  setInterval: () => globalThis.setInterval(() => {}, 1),
  setImmediate: () => globalThis.setImmediate(() => {}),
};

describe('simulate and the seed-replay convention', () => {
  it('the same seed gives the same lines, twice', async () => {
    expect((await simulate(coin, 7, [])).lines).toEqual((await simulate(coin, 7, [])).lines);
  });
  it('two seeds give different lines', async () => {
    expect((await simulate(coin, 1, [])).lines).not.toEqual((await simulate(coin, 2, [])).lines);
  });
  it('simSeeds: the defaults, one replayed seed, a soak, and a typo', () => {
    expect(simSeeds([5, 6], {})).toEqual([5, 6]);
    expect(simSeeds([5, 6], { CCRC_SIM_SEED: '17' })).toEqual([17]);
    expect(simSeeds([5], { CCRC_SIM_SEEDS: '3' })).toEqual([1, 2, 3, 5]);
    expect(() => simSeeds([5], { CCRC_SIM_SEED: 'x' })).toThrow(/CCRC_SIM_SEED/);
    expect(() => simSeeds([5], { CCRC_SIM_SEEDS: '0' })).toThrow(/CCRC_SIM_SEEDS/);
    expect(() => simSeeds([5], { CCRC_SIM_SEED: '1', CCRC_SIM_SEEDS: '3' })).toThrow(/CCRC_SIM_SEED/);
  });
  it('a violation names the scenario, seed, invariant, line and replay command', async () => {
    const neverTails: Invariant = { name: 'never-tails', says: 'no tails', check: (ls) => {
      const l = ls.find((x) => x.state === 'tails'); return l ? { invariant: 'never-tails', seq: l.seq, message: 'tails' } : null; } };
    await expect(assertScenario(coin, [neverTails], { seeds: [1], testFile: 'test/sim/run.test.ts', env: {} })).rejects.toThrow(
      /scenario coin, seed 1: never-tails: tails \(line \d+\)\nreplay: cd server && CCRC_SIM_SEED=1 \.\/node_modules\/\.bin\/vitest run test\/sim\/run\.test\.ts/);
  });
  it('an edge no seed reaches is red, and names the edge', async () => {
    const never = { ...coin, edges: ['heads', 'tails', 'edge'] as const };
    await expect(assertScenario(never, [], { seeds: [1, 2, 3], testFile: 't', env: {} })).rejects.toThrow(/never reached: edge/);
    await expect(assertScenario(never, [], { seeds: [1], testFile: 't', env: { CCRC_SIM_SEED: '1' } })).resolves.toBeUndefined();
  });
  it.each(['Date.now', 'performance.now', 'Math.random', 'setTimeout', 'setInterval', 'setImmediate'])('the ambient guard refuses %s', async (name) => {
    const bad = { ...coin, setup: () => { AMBIENT_CALLS[name]!(); } };
    await expect(simulate(bad, 1, [])).rejects.toThrow(`ambient ${name} inside the simulator`);
  });
  it('a scheduled call that throws fails the run, not only a warning line', async () => {
    const bad = { ...coin, setup: (ctx: SimContext<CoinEdge>) => {
      ctx.world.server.scheduler.after(1, () => { throw new Error('boom'); }); } };
    await expect(simulate(bad, 1, [])).rejects.toThrow('scenario coin, seed 1: ccrc-server: a scheduled call failed: boom');
  });
  it.each([
    ['at once', async (): Promise<void> => { throw new Error('later'); }],
    ['after three awaits', async (): Promise<void> => { await null; await null; await null; throw new Error('later'); }],
  ])('a scheduled call that returns a promise rejecting %s fails the run', async (_when, fn) => {
    const bad = { ...coin, setup: (ctx: SimContext<CoinEdge>) => { ctx.world.server.scheduler.after(1, fn); } };
    await expect(simulate(bad, 1, [])).rejects.toThrow('scenario coin, seed 1: ccrc-server: a scheduled call failed: later');
  });
  it('a scheduled call still pending after the settle bound fails the run, never passes it', async () => {
    const slow = async (): Promise<void> => { for (let i = 0; i < 10_005; i++) await null; throw new Error('later'); };
    const bad = { ...coin, setup: (ctx: SimContext<CoinEdge>) => { ctx.world.server.scheduler.after(1, slow); } };
    await expect(simulate(bad, 1, [])).rejects.toThrow(/1 promise .*still pending after SETTLE_TURNS/);
  });
  it('a timer that re-arms at 0 ms fails the run at the budget, instead of hanging', async () => {
    const loop = { ...coin, setup: (ctx: SimContext<CoinEdge>) => {
      const again = (): void => { ctx.world.envAfter(0, again); };
      ctx.world.envAfter(0, again); } };
    await expect(simulate(loop, 1, [])).rejects.toThrow(/scheduled calls/);
  });
  it('a second simulate while one is in flight is refused, and the real functions are back after both', async () => {
    const saved = { now: Date.now, perf: performance.now, random: Math.random, st: globalThis.setTimeout };
    const both = await Promise.allSettled([simulate(coin, 1, []), simulate(coin, 2, [])]);
    expect(both.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(String((both[1] as PromiseRejectedResult).reason)).toMatch(/already in flight/);
    expect([Date.now, performance.now, Math.random, globalThis.setTimeout]).toEqual([saved.now, saved.perf, saved.random, saved.st]);
  });
  it('the real functions are back after a run, a failed one included', async () => {
    const g = globalThis;
    const saved = { now: Date.now, perf: performance.now, random: Math.random, st: g.setTimeout, si: g.setInterval, sim: g.setImmediate };
    const bad = { ...coin, setup: () => { throw new Error('boom'); } };
    await expect(simulate(bad, 1, [])).rejects.toThrow('boom');
    expect(Date.now).toBe(saved.now);
    expect(performance.now).toBe(saved.perf);
    expect(Math.random).toBe(saved.random);
    expect(g.setTimeout).toBe(saved.st);
    expect(g.setInterval).toBe(saved.si);
    expect(g.setImmediate).toBe(saved.sim);
  });
});
