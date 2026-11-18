// Overlord W2, the decision model's line admission (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md,
// Task 8): the cases over `shared/binomialBound.ts#upperBound95`. `binomial-bound.test.ts` runs them against the real module and
// `sim/binomialBoundSets.ts` against each mutant, so one list of cases is both the suite and the mutation floor's judge.
import { expect } from 'vitest';
import type * as BinomialBound from '../../shared/binomialBound.js';

export type BinomialBoundModule = Pick<typeof BinomialBound, 'upperBound95'>;
export interface BinomialBoundCase { name: string; run: (m: BinomialBoundModule) => void }

/** [errors, n, bound]: the one-sided 95% Clopper-Pearson upper bound, as `scipy.stats.beta.ppf(0.95, k + 1, n - k)` (scipy
 *  1.18.0) gives it, to six decimals. Computed outside this repository, so the table is independent of the bisection. */
export const REFERENCE: readonly (readonly [number, number, number])[] = [
  [0, 1, 0.950000], [0, 10, 0.258866], [0, 28, 0.101466], [0, 29, 0.098145], [0, 58, 0.050339], [0, 59, 0.049508],
  [0, 100, 0.029513], [1, 10, 0.394163], [1, 29, 0.153392], [1, 59, 0.077898], [2, 29, 0.201561], [2, 59, 0.102889],
  [3, 59, 0.126207], [5, 100, 0.102253], [0, 295, 0.010104], [4, 145, 0.062012], [10, 50, 0.315596], [1, 2, 0.974679],
  [7, 200, 0.064733], [12, 20, 0.782931],
];

export const BINOMIAL_BOUND_CASES: BinomialBoundCase[] = [
  { name: 'bound: H6\'s own counts, 29 clean cases pass a 10% target and 28 do not, 59 pass 5% and 58 do not', run: (m) => {
    expect(m.upperBound95(0, 29)).toBeLessThan(0.1);
    expect(m.upperBound95(0, 28)).toBeGreaterThan(0.1);
    expect(m.upperBound95(0, 59)).toBeLessThan(0.05);
    expect(m.upperBound95(0, 58)).toBeGreaterThan(0.05);
  } },
  { name: 'bound: agrees with the reference table to 4 decimals at 20 points', run: (m) => {
    for (const [k, n, want] of REFERENCE) expect(m.upperBound95(k, n), `${k} of ${n}`).toBeCloseTo(want, 4);
  } },
  { name: 'bound: no error is 1 - 0.05^(1/n), the closed form', run: (m) => {
    for (const n of [1, 2, 5, 17, 29, 59, 120, 400]) expect(m.upperBound95(0, n), `0 of ${n}`).toBeCloseTo(1 - 0.05 ** (1 / n), 8);
  } },
  { name: 'bound: no cases is 1, and so is every error rate of 100%', run: (m) => {
    expect(m.upperBound95(0, 0)).toBe(1);
    expect(m.upperBound95(5, 5)).toBe(1);
    expect(m.upperBound95(1, 1)).toBe(1);
    expect(m.upperBound95(7, 5)).toBe(1);
  } },
  { name: 'bound: a negative or non-integer argument throws', run: (m) => {
    for (const [k, n] of [[-1, 10], [0, -1], [0.5, 10], [1, 10.5], [Number.NaN, 10], [1, Number.NaN], [Number.POSITIVE_INFINITY, 10], [1, Number.POSITIVE_INFINITY]] as const) {
      expect(() => m.upperBound95(k, n), `${k} of ${n}`).toThrow();
    }
  } },
  { name: 'bound: rises with the errors and falls with the cases', run: (m) => {
    for (const n of [1, 5, 29, 60, 150]) {
      for (let k = 0; k < n && k < 12; k++) expect(m.upperBound95(k + 1, n), `${k + 1} of ${n} over ${k} of ${n}`).toBeGreaterThan(m.upperBound95(k, n));
    }
    for (const k of [0, 1, 3]) {
      for (let n = k + 1; n < 80; n++) expect(m.upperBound95(k, n + 1), `${k} of ${n + 1} under ${k} of ${n}`).toBeLessThan(m.upperBound95(k, n));
    }
  } },
  { name: 'bound: a large n does not underflow', run: (m) => {
    expect(m.upperBound95(500, 1000)).toBeCloseTo(0.526482, 5);
    expect(m.upperBound95(0, 5000)).toBeCloseTo(1 - 0.05 ** (1 / 5000), 8);
  } },
];
