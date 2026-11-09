// D-6911: the review cap's words and its one reader (`fleet/reviewCapWords.ts`). TDD red-first.
import { describe, expect, it } from 'vitest';
import type { ReviewCapStatus, RunSummary } from '../../shared/api';
import { capWaiting, coordLiftLine, findingsWords, reviewCapOf } from '../src/fleet/reviewCapWords';
import { run } from './rollupFixture';

const lift = { at: 1_500, by: 'coord-a', reason: 'two major findings, converging', rounds: 3, capBefore: 3, capAfter: 6, count: 1 };
const cap = (over: Partial<ReviewCapStatus> = {}): ReviewCapStatus =>
  ({ rounds: 3, cap: 3, askedAt: 1_000, liftedAt: null, granted: 0, askHandledAt: null, coordLift: null, ...over });
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

describe('capWaiting, a cap its coordinator lifted (D-8125)', () => {
  it('an open ask handled by a coordinator is coordinator, not waiting', () => {
    expect(capWaiting(run(12, 'coord', 'w-12', { reviewCap: cap({ askHandledAt: 1_600, coordLift: lift }) }))).toBe('coordinator');
  });
  it('a lift before any ask was raised is coordinator', () => {
    expect(capWaiting(run(12, 'coord', 'w-12', { reviewCap: cap({ askedAt: null, granted: 3, coordLift: lift }) }))).toBe('coordinator');
  });
  it('a re-raised ask (new askedAt, not handled) is waiting again', () => {
    expect(capWaiting(run(12, 'coord', 'w-12', { reviewCap: cap({ askedAt: 9_000, askHandledAt: null, coordLift: lift }) }))).toBe('waiting');
  });
  it('an operator lift after a coordinator lift reads lifted', () => {
    expect(capWaiting(run(12, 'coord', 'w-12', { reviewCap: cap({ liftedAt: 2_000, askHandledAt: 1_600, coordLift: lift }) }))).toBe('lifted');
  });
  it('a closed run says nothing', () => {
    expect(capWaiting(run(12, 'coord', 'w-12', { state: 'done', reviewCap: cap({ askHandledAt: 1_600, coordLift: lift }) }))).toBeNull();
  });
  it('an older server row (rounds, cap, askedAt, liftedAt only) answers as before', () => {
    const old = { rounds: 3, cap: 3, askedAt: 1_000, liftedAt: null } as ReviewCapStatus;
    expect(capWaiting(run(12, 'coord', 'w-12', { reviewCap: old }))).toBe('waiting');
    expect(capWaiting(run(12, 'coord', 'w-12', { reviewCap: { ...old, liftedAt: 2_000 } }))).toBe('lifted');
    expect(capWaiting(run(12, 'coord', 'w-12', { reviewCap: { ...old, askedAt: null } }))).toBeNull();
  });
});

describe('coordLiftLine', () => {
  it('words the reason as the server sent it', () => {
    expect(coordLiftLine(cap({ coordLift: lift }))).toBe('Cap lifted by its coordinator: two major findings, converging');
  });
  it('is null with no coordinator lift, and for an older row', () => {
    expect(coordLiftLine(cap())).toBeNull();
    expect(coordLiftLine({ rounds: 3, cap: 3, askedAt: 1, liftedAt: null } as ReviewCapStatus)).toBeNull();
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
