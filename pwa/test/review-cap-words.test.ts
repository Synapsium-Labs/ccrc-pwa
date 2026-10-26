// D-6911: the review cap's words and its one reader (`fleet/reviewCapWords.ts`). TDD red-first.
import { describe, expect, it } from 'vitest';
import type { ReviewCapStatus, RunSummary } from '../../shared/api';
import { capWaiting, findingsWords, reviewCapOf } from '../src/fleet/reviewCapWords';
import { run } from './rollupFixture';

const cap = (over: Partial<ReviewCapStatus> = {}): ReviewCapStatus =>
  ({ rounds: 3, cap: 3, askedAt: 1_000, liftedAt: null, ...over });
/** A run as an older server ships it: no `reviewCap` key at all. */
const older = (): RunSummary => {
  const r: Partial<RunSummary> = { ...run(12, 'coord', 'w-12') };
  delete r.reviewCap;
  return r as RunSummary;
};

describe('reviewCapOf, the one reader of RunSummary.reviewCap', () => {
  it('reads an absent field as unmeasured, never as not waiting', () => {
    expect(reviewCapOf(older())).toBe('unmeasured');
  });
  it('reads null as null: a review run has no cap', () => {
    expect(reviewCapOf(run(13, 'coord', 'r-13', { kind: 'review', reviews: 12 }))).toBeNull();
  });
  it('reads a status through', () => {
    expect(reviewCapOf(run(12, 'coord', 'w-12', { reviewCap: cap() }))).toEqual(cap());
  });
});

describe('capWaiting', () => {
  it('a raised ask with no lift is waiting', () => {
    expect(capWaiting(run(12, 'coord', 'w-12', { reviewCap: cap() }))).toBe('waiting');
  });
  it('a raised ask that was lifted is lifted', () => {
    expect(capWaiting(run(12, 'coord', 'w-12', { reviewCap: cap({ liftedAt: 2_000 }) }))).toBe('lifted');
  });
  it('a run whose ask was never raised says nothing, even at the cap', () => {
    expect(capWaiting(run(12, 'coord', 'w-12', { reviewCap: cap({ askedAt: null }) }))).toBeNull();
  });
  it('a closed run with a raised, unlifted ask is never waiting', () => {
    expect(capWaiting(run(12, 'coord', 'w-12', { state: 'done', reviewCap: cap() }))).toBeNull();
    expect(capWaiting(run(12, 'coord', 'w-12', { state: 'failed', reviewCap: cap({ liftedAt: 2_000 }) }))).toBeNull();
  });
  it('an unmeasured cap and a review run say nothing', () => {
    expect(capWaiting(older())).toBeNull();
    expect(capWaiting(run(13, 'coord', 'r-13', { kind: 'review', reviews: 12 }))).toBeNull();
  });
});

describe('findingsWords', () => {
  it('a read report gives its lines', () => {
    expect(findingsWords({ state: 'read', lines: ['F1 x', 'F2 y'] })).toEqual(['F1 x', 'F2 y']);
  });
  it('a read report with no findings says so', () => {
    expect(findingsWords({ state: 'read', lines: [] })).toEqual(['The report lists no open findings.']);
  });
  it('says what became of the report when it was not read', () => {
    expect(findingsWords({ state: 'absent' })).toEqual(['The report file is gone.']);
    expect(findingsWords({ state: 'unreadable' })).toEqual(['The report file could not be read.']);
    expect(findingsWords({ state: 'unnamed' })).toEqual(['No report is on file.']);
  });
});
