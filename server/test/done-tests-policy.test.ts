// The done-test deciders (Overlord W2 done tests A, Task A3): `parseDoneTest` and `targetVerdict`, Table 3 row by row,
// the sweep and the property, over the real module. The same cases run against each mutant in `sim/doneTestSets.ts`.
import { describe, expect, it } from 'vitest';
import * as deciders from '../src/coord/doneTests.js';
import { parseDoneTestCases, targetVerdictCases } from './doneTestCases.js';

describe('parseDoneTest: the one shape check of a done test (Q2, DT9)', () => {
  for (const [name, run] of Object.entries(parseDoneTestCases(deciders))) it(name, run);
});

describe('targetVerdict: Table 3, first match and total', () => {
  for (const [name, run] of Object.entries(targetVerdictCases(deciders))) it(name, run);
});

describe('DONE_TEST_REFUSALS: the refusal list is exactly the words parseDoneTest gives', () => {
  it('one input reaches each refusal, and together they reach no other word', () => {
    const one = { predicate: 'run-closed' };
    const inputs: unknown[] = [null, [], Array(6).fill(one), [{ predicate: 'nope' }], [one, one], [{ predicate: 'review-passed' }]];
    const got = inputs.map((v) => { const r = deciders.parseDoneTest(v); return r.ok ? 'accepted' : r.why; });
    expect([...got].sort()).toEqual([...deciders.DONE_TEST_REFUSALS].sort());
  });
});
