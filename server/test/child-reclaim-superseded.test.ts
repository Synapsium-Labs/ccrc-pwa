// The superseded review report (child reclaim, `review-report-superseded`): an EARLIER review child of a
// reviewed run is finished once a LATER review of the same run has itself closed, even while the reviewed run is
// open. This file pins the verdict's behaviour for a review child of an open reviewed run; the release itself is
// added in its own commit, shadow-first behind `$REG/child-superseded-reclaim-live`.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { CoordStore } from '../src/coord/store.js';
import { openCoordDb } from '../src/coord/db.js';
import { childReclaimReviewedRun } from '../src/coord/childReclaimStale.js';
import { mkTmp } from './tmpHelpers.js';
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

// ── the release ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('review-report-superseded: the verdict', () => {
  const superseded = (live: boolean, over: Partial<ChildReclaimSweepInput> = {}): ChildReclaimSweepInput =>
    reviewChild(DAY, { reviewedRun: { kind: 'run', state: 'working', superseded: { by: 9, live } }, ...over });

  it('armed: an earlier review child whose reviewed run is open is eligible', () => {
    expect(childReclaimSweepVerdict(superseded(true))).toEqual({ eligible: true, runId: 7 });
  });

  it('armed: eligible past the seven-day ceiling too, in place of review-report-stale', () => {
    expect(childReclaimSweepVerdict(reviewChild(REVIEW_CHILD_CEILING_MS + 1,
      { reviewedRun: { kind: 'run', state: 'working', superseded: { by: 9, live: true } } })))
      .toEqual({ eligible: true, runId: 7 });
  });

  it('shadowed: the keep words stand exactly as before', () => {
    expect(childReclaimSweepVerdict(superseded(false))).toEqual({ eligible: false, why: 'review-report-live' });
    expect(childReclaimSweepVerdict(reviewChild(REVIEW_CHILD_CEILING_MS + 1,
      { reviewedRun: { kind: 'run', state: 'working', superseded: { by: 9, live: false } } })))
      .toEqual({ eligible: false, why: 'review-report-stale', runId: 7 });
  });

  it('armed: every other keep still wins (an open sibling, an unreadable sibling list, an unmeasured hold)', () => {
    expect(childReclaimSweepVerdict(superseded(true, { siblings: { ok: true, open: 1 } })))
      .toEqual({ eligible: false, why: 'siblings-open' });
    expect(childReclaimSweepVerdict(superseded(true, { siblings: { ok: false, detail: 'd' } })))
      .toEqual({ eligible: false, why: 'siblings-unreadable' });
    expect(childReclaimSweepVerdict(superseded(true, { held: { kind: 'unmeasured', reason: 'r', detail: 'd' } })))
      .toEqual({ eligible: false, why: 'hold-unmeasured' });
  });
});

// ── the facts it reads ───────────────────────────────────────────────────────────────────────────────────────────

/** A store with one open work run and a way to open and end review runs of it. */
const fixture = () => {
  const dir = mkTmp('ccrc-superseded-');
  const coord = new CoordStore(openCoordDb(path.join(dir, 'coord.db')));
  const open = (kind: 'work' | 'review', reviews: number | null): number => {
    const r = coord.openRun({ program: 'prog-a', title: 'prog-a', project: 'demo', wave: 1, waveOf: null,
      claimedBy: 'demo-coord', kind, reviews });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    return r.id;
  };
  const work = open('work', null);
  /** Open a review of the work run and end it `done` or `failed`. */
  const review = (end: 'done' | 'failed' | 'open'): number => {
    const id = open('review', work);
    if (end === 'open') return id;
    coord.markDispatched(id, `demo-rv${id}`, `demo-rv${id}`, `ws/demo-rv${id}`, false);
    for (const to of end === 'done' ? ['dispatched', 'working', 'done'] as const : ['dispatched', 'failed'] as const) {
      const moved = coord.advance(id, to, 'test');
      if (!moved.ok) throw new Error(`advance refused: ${JSON.stringify(moved)}`);
    }
    return id;
  };
  return { coord, work, review };
};

describe('CoordStore.laterReviewClosedFor', () => {
  it('names the newest later review that closed done, and none for the newest review itself', () => {
    const f = fixture();
    const first = f.review('done');
    expect(f.coord.laterReviewClosedFor(f.work, first), 'the only review has no later one').toBeNull();
    const second = f.review('done');
    expect(f.coord.laterReviewClosedFor(f.work, first)).toBe(second);
    expect(f.coord.laterReviewClosedFor(f.work, second), 'the newest is never superseded').toBeNull();
  });

  it('a later review that is still open, or ended failed, supersedes nothing', () => {
    const f = fixture();
    const first = f.review('done');
    f.review('failed');
    expect(f.coord.laterReviewClosedFor(f.work, first)).toBeNull();
    f.review('open');
    expect(f.coord.laterReviewClosedFor(f.work, first)).toBeNull();
  });

  it('reads reviews of THIS run only', () => {
    const f = fixture();
    const first = f.review('done');
    expect(f.coord.laterReviewClosedFor(f.work + 1000, first)).toBeNull();
  });
});

describe('childReclaimReviewedRun', () => {
  const MARK = ['child-superseded-reclaim-live'];

  it('reads the reviewed run, carries the superseding review, and arms it only with the marker', () => {
    const f = fixture();
    const first = f.review('done');
    const second = f.review('done');
    expect(childReclaimReviewedRun(f.coord, first, f.work, 'working', [])).toEqual({ kind: 'run', state: 'working', superseded: { by: second, live: false } });
    expect(childReclaimReviewedRun(f.coord, first, f.work, 'working', MARK)).toEqual({ kind: 'run', state: 'working', superseded: { by: second, live: true } });
    expect(childReclaimReviewedRun(f.coord, second, f.work, 'working', MARK), 'the newest review child').toEqual({ kind: 'run', state: 'working' });
  });

  it('reads nothing of a terminal reviewed run: it already releases every review child', () => {
    const f = fixture();
    const first = f.review('done');
    f.review('done');
    expect(childReclaimReviewedRun(f.coord, first, f.work, 'done', MARK)).toEqual({ kind: 'run', state: 'done' });
  });
});
