// L1 policy: seeded draws, the clock kernel's one replayable source of chance (Overlord W2, forecasts A; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-forecasts-health.md, Task 1, question 12). Context K. Pure: it imports
// nothing, reads no clock and never calls `Math.random`. A caller that wants chance it cannot replay asks the `Entropy`
// port (`./ports.ts#Entropy`); a caller that must answer the same thing for the same seed (a forecast, replayed from the
// seed its row stores) draws here, from a seed it took from that port once.

/** A stream of draws: `next()` in [0, 1), never 1.0; `below(n)` a uniform integer in [0, n). */
export interface SeededStream {
  next(): number;
  /** Throws RangeError unless n is an integer in [1, 2^32], as `Entropy.below` does (`./rules.ts#ENTROPY_MAX_BOUND`). */
  below(n: number): number;
}

const TWO_32 = 4_294_967_296;

/** mulberry32 over `seed`'s low 32 bits: the same sequence as the tests' reference (`server/test/fakeTime.ts#mulberry32`). */
export function seededDraws(seed: number): SeededStream {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / TWO_32;
  };
  return {
    next,
    below(n: number): number {
      if (!Number.isInteger(n) || n < 1 || n > TWO_32) throw new RangeError(`seededDraws.below: ${n} is not an integer in [1, 2^32]`);
      return Math.floor(next() * n);
    },
  };
}

/** One 32-bit seed for stream `index` of `seed`: the two mixed through murmur3's finaliser, so neighbouring indexes give
 *  unrelated streams and each trial of a forecast draws from its own. */
export function streamFor(seed: number, index: number): number {
  let h = ((seed >>> 0) ^ Math.imul((index >>> 0) + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
