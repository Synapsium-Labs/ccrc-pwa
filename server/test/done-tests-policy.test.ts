// The done-test deciders (Overlord W2 done tests A, Task A3): `parseDoneTest` and `targetVerdict`, Table 3 row by row,
// the sweep and the property, over the real module. The same cases run against each mutant in `sim/doneTestSets.ts`.
import { describe, it } from 'vitest';
import * as deciders from '../src/coord/doneTests.js';
import { parseDoneTestCases, targetVerdictCases } from './doneTestCases.js';

describe('parseDoneTest: the one shape check of a done test (Q2, DT9)', () => {
  for (const [name, run] of Object.entries(parseDoneTestCases(deciders))) it(name, run);
});

describe('targetVerdict: Table 3, first match and total', () => {
  for (const [name, run] of Object.entries(targetVerdictCases(deciders))) it(name, run);
});
