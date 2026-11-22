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

// The drift grace's question (Linear hierarchy §7.3, wave 4; the coordinator's ruling on review 2408's fix round 3): is a
// run's PR merged, as its lineage or its session's listing shows. It is asked while the run is still open (merging, no close
// record yet), so it is not `pr-merged`, which reads the run's own close record only; it lives here so that one decider
// reads a run's lineage for "merged".
describe('runPrMergedSeen: whether a run\'s PR is merged, open run or closed', () => {
  const read = (o: { lineage?: unknown; ownBranch?: string | null; listing?: { phase: string | null; branch: string | null } | null }) =>
    ({ run: 'read' as const, lineage: o.lineage ?? [], ownBranch: o.ownBranch ?? null, listing: o.listing ?? null });
  it('a merging run with no close record whose lineage says merged reads merged', () => {
    expect(deciders.runPrMergedSeen(read({ lineage: [{ pr: 5, phase: 'open' }, { pr: 5, phase: 'merged' }] }))).toBe(true);
  });
  it('the run\'s own session\'s listed PR, merged on the run\'s own branch, reads merged', () => {
    expect(deciders.runPrMergedSeen(read({ ownBranch: 'ws/a', listing: { phase: 'merged', branch: 'ws/a' } }))).toBe(true);
  });
  it('anything else is not merged: an open PR, another branch, no branch, no listing, a lineage it cannot read, no run', () => {
    expect(deciders.runPrMergedSeen(read({ lineage: [{ phase: 'open' }] }))).toBe(false);
    expect(deciders.runPrMergedSeen(read({ ownBranch: 'ws/a', listing: { phase: 'merged', branch: 'ws/b' } }))).toBe(false);
    expect(deciders.runPrMergedSeen(read({ ownBranch: 'ws/a', listing: { phase: 'open', branch: 'ws/a' } }))).toBe(false);
    expect(deciders.runPrMergedSeen(read({ ownBranch: null, listing: { phase: 'merged', branch: null } }))).toBe(false);
    expect(deciders.runPrMergedSeen(read({ ownBranch: 'ws/a' }))).toBe(false);
    expect(deciders.runPrMergedSeen(read({ lineage: 'not json' }))).toBe(false);
    expect(deciders.runPrMergedSeen(read({ lineage: [null, 'merged', { phase: 'merged ' }] }))).toBe(false);
    expect(deciders.runPrMergedSeen({ run: 'unreadable' })).toBe(false);
    expect(deciders.runPrMergedSeen({ run: 'absent' })).toBe(false);
  });
});
