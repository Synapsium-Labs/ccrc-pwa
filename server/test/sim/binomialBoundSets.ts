// The binomial bound's mutant set (Overlord W2, plan w2-decision-model.md Task 8 Step 3; the floors rule is D-8217):
// `upperBound95`, run against every case of `../binomialBoundCases.ts` loaded over the mutated copy of shared/binomialBound.ts.
// Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor in mutation-floors.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BINOMIAL_BOUND_CASES, type BinomialBoundModule } from '../binomialBoundCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const BINOMIAL_BOUND_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/binomialBound.ts');

export const BINOMIAL_BOUND_SET: MutantSet<BinomialBoundModule> = {
  modulePath: BINOMIAL_BOUND_TS,
  mutants: [
    { id: 'BB-1 a two-sided 0.025 tail', old: 'const TAIL = 0.05;', new: 'const TAIL = 0.025;' },
    { id: 'BB-2 off by one in n', old: 'binomialCdf(errors, n, mid)', new: 'binomialCdf(errors, n + 1, mid)' },
    { id: 'BB-3 off by one in errors', old: 'binomialCdf(errors, n, mid)', new: 'binomialCdf(errors + 1, n, mid)' },
    { id: 'BB-4 off by one below in errors', old: 'binomialCdf(errors, n, mid)', new: 'binomialCdf(errors - 1, n, mid)' },
    { id: 'BB-5 the CDF stops one term short', old: 'for (let i = 0; i < k; i++) {', new: 'for (let i = 0; i < k - 1; i++) {' },
    { id: 'BB-7 the wrong side of the tail', old: 'if (binomialCdf(errors, n, mid) > TAIL) lo = mid;', new: 'if (binomialCdf(errors, n, mid) < TAIL) lo = mid;' },
    { id: 'BB-8 no cases is 0', old: 'if (n === 0 || errors >= n) return 1;', new: 'if (n === 0) return 0;\n  if (errors >= n) return 1;' },
    { id: 'BB-9 more errors than cases is not 1', old: 'if (n === 0 || errors >= n) return 1;', new: 'if (n === 0 || errors === n) return 1;' },
    { id: 'BB-10 no integer check', old: '!Number.isInteger(errors) || !Number.isInteger(n) || errors < 0 || n < 0', new: 'errors < 0 || n < 0' },
    { id: 'BB-11 negative allowed', old: 'errors < 0 || n < 0', new: 'false' },
    { id: 'BB-12 too few halvings', old: 'const HALVINGS = 60;', new: 'const HALVINGS = 6;' },
    { id: 'BB-13 the sum against no maximum', old: 'sum += Math.exp(t - max);', new: 'sum += Math.exp(t);' },
  ],
  suite(mod): Record<string, SuiteCase> {
    return Object.fromEntries(BINOMIAL_BOUND_CASES.map((c) => [c.name, () => c.run(mod)]));
  },
};

export const BINOMIAL_BOUND_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'shared/binomialBound.ts#upperBound95': BINOMIAL_BOUND_SET as MutantSet<never>,
};
