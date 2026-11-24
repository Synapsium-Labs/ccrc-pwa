// Overlord W2, the decision model's line admission (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md,
// Task 8): the one-sided 95% Clopper-Pearson bound, against the real module. The cases live in `binomialBoundCases.ts`, which
// the mutation set (`sim/binomialBoundSets.ts`) runs against each mutant too.
import { describe, it } from 'vitest';
import * as binomialBound from '../../shared/binomialBound.js';
import { BINOMIAL_BOUND_CASES } from './binomialBoundCases.js';

describe('binomialBound.ts: upperBound95 (Task 8)', () => {
  it.each(BINOMIAL_BOUND_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => c.run(binomialBound));
});
