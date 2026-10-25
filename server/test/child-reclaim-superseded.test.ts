// The superseded review report (child reclaim, `review-report-superseded`): an EARLIER review child of a
// reviewed run is finished once a LATER review of the same run has itself closed, even while the reviewed run is
// open. This file pins the verdict's behaviour for a review child of an open reviewed run; the release itself is
// added in its own commit, shadow-first behind `$REG/child-superseded-reclaim-live`.
import { describe, it, expect } from 'vitest';
import { childReclaimSweepVerdict, REVIEW_CHILD_CEILING_MS, type ChildReclaimSweepInput } from '../src/childReclaimSweep.js';

const NOW = 1_790_000_000_000;
const DAY = 24 * 3_600_000;

/** A review child on every count eligible but for the run it reviewed, which is open. */
const reviewChild = (closedAgo: number, over: Partial<ChildReclaimSweepInput> = {}): ChildReclaimSweepInput => ({
  sessionId: 'demo-a', child: { kind: 'child', runId: 7 }, identityMeasured: true, generation: { kind: 'absent' },
  workspace: 'demo-a', held: { kind: 'none' }, terminal: false,
  mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: NOW - 9 * DAY,
    openedAt: NOW - 9 * DAY, closedAt: NOW - closedAgo } },
  reviewedRun: { kind: 'run', state: 'working' }, siblings: { ok: true, open: 0 }, coordinatorClaim: undefined,
  childBornAt: NOW - 9 * DAY, skewMs: 120_000, nowMs: NOW, idle: 'unmeasured', holdDigest: null, ...over,
});

describe('characterization: a review child of an open reviewed run', () => {
  it('is kept as review-report-live, and as review-report-stale past the seven-day ceiling', () => {
    expect(childReclaimSweepVerdict(reviewChild(DAY))).toEqual({ eligible: false, why: 'review-report-live' });
    expect(childReclaimSweepVerdict(reviewChild(REVIEW_CHILD_CEILING_MS + 1)))
      .toEqual({ eligible: false, why: 'review-report-stale', runId: 7 });
  });

  it('is eligible once the reviewed run is terminal', () => {
    expect(childReclaimSweepVerdict(reviewChild(DAY, { reviewedRun: { kind: 'run', state: 'done' } })))
      .toEqual({ eligible: true, runId: 7 });
  });
});
