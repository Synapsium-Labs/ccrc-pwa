// The kept reason a child's skip word hides: `review-report-live` and `siblings-open` are classed `ordinary`, so no
// surface names the run that keeps the child. `keptReasonOf` reads the sweep input beside the verdict and says which
// run, and for how long; the body is the feed row's sentence; the limiter paces a row to one per child per day.
import { describe, it, expect } from 'vitest';
import {
  KEPT_REASON_FEED_MS, KeptReasonLimiter, keptReasonBody, keptReasonOf,
} from '../src/coord/keptReason.js';
import { childReclaimSweepVerdict, type ChildReclaimSweepInput } from '../src/childReclaimSweep.js';

const DAY = 24 * 3_600_000;
const NOW = 1_790_000_000_000;
const base = (over: Partial<ChildReclaimSweepInput> = {}): ChildReclaimSweepInput => ({
  sessionId: 'demo-a', child: { kind: 'child', runId: 7 }, identityMeasured: true, generation: { kind: 'absent' },
  workspace: 'demo-a', held: { kind: 'none' }, terminal: false,
  mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: NOW - 40 * DAY,
    openedAt: NOW - 40 * DAY, closedAt: NOW - 39 * DAY } },
  reviewedRun: { kind: 'not-a-review' }, siblings: { ok: true, open: 0 }, coordinatorClaim: undefined,
  childBornAt: NOW - 40 * DAY, skewMs: 120_000, nowMs: NOW, idle: 'unmeasured', holdDigest: null, ...over,
});
/** A review child whose own run closed two days ago, inside the seven-day ceiling. */
const review = (reviewedRun: ChildReclaimSweepInput['reviewedRun']): ChildReclaimSweepInput => base({
  reviewedRun, mintingRun: { ok: true, run: { state: 'done', sessionId: 'demo-a', dispatchStartedAt: NOW - 40 * DAY,
    openedAt: NOW - 40 * DAY, closedAt: NOW - 2 * DAY } } });
const reasonOf = (i: ChildReclaimSweepInput) => keptReasonOf(i, childReclaimSweepVerdict(i));

describe('keptReasonOf', () => {
  it('review-report-live names the reviewed run and how long it has been open', () => {
    const i = review({ kind: 'run', state: 'working', id: 41, openedAt: NOW - 3 * DAY });
    expect(reasonOf(i)).toEqual({ kind: 'review', reviewedRunId: 41, ageMs: 3 * DAY });
  });

  it('review-report-live from a read that carried no id still answers, with no id and no age', () => {
    const i = review({ kind: 'run', state: 'working' });
    expect(reasonOf(i)).toEqual({ kind: 'review', reviewedRunId: null, ageMs: null });
  });

  it('siblings-open names every blocking run with its age', () => {
    const i = base({ siblings: { ok: true, open: 1, blocking: [{ id: 90, openedAt: NOW - 2 * DAY }], stale: [] } });
    expect(reasonOf(i)).toEqual({ kind: 'siblings', blocking: [{ id: 90, ageMs: 2 * DAY }], stale: [] });
  });

  it('a stale sibling beside a blocking one rides the same reason', () => {
    const i = base({ siblings: { ok: true, open: 1, blocking: [{ id: 90, openedAt: NOW - 2 * DAY }],
      stale: [{ id: 83, openedAt: NOW - 40 * DAY }] } });
    expect(reasonOf(i)).toEqual({ kind: 'siblings', blocking: [{ id: 90, ageMs: 2 * DAY }],
      stale: [{ id: 83, ageMs: 40 * DAY }] });
  });

  it('a stale sibling alone is reported even though the child is not kept by it', () => {
    const i = base({ siblings: { ok: true, open: 0, blocking: [], stale: [{ id: 83, openedAt: NOW - 40 * DAY }] } });
    expect(childReclaimSweepVerdict(i)).toMatchObject({ eligible: true });
    expect(reasonOf(i)).toEqual({ kind: 'siblings', blocking: [], stale: [{ id: 83, ageMs: 40 * DAY }] });
  });

  it('a child with nothing to say answers null', () => {
    expect(reasonOf(base())).toBeNull();
    expect(reasonOf(base({ child: { kind: 'none' } }))).toBeNull();
  });
});

describe('keptReasonBody', () => {
  it('the review sentence names the reviewed run and its age, and says how it ends', () => {
    const body = keptReasonBody('demo-a', 7, { kind: 'review', reviewedRunId: 41, ageMs: 3 * DAY });
    expect(body).toContain('demo-a, child of run #7');
    expect(body).toContain('run #41');
    expect(body).toContain('3 days');
  });

  it('the siblings sentence names the blocking run and the stale one, and never says it closes the stale one', () => {
    const body = keptReasonBody('demo-a', 7, { kind: 'siblings', blocking: [{ id: 90, ageMs: 2 * DAY }],
      stale: [{ id: 83, ageMs: 40 * DAY }] });
    expect(body).toContain('run #90');
    expect(body).toContain('2 days');
    expect(body).toContain('stale sibling run #83');
    expect(body).toContain('40 days');
    expect(body).toMatch(/ccrc does not close it/);
  });

  it('an age under a day reads in hours', () => {
    expect(keptReasonBody('demo-a', 7, { kind: 'review', reviewedRunId: 41, ageMs: 5 * 3_600_000 })).toContain('5 hours');
  });
});

describe('KeptReasonLimiter', () => {
  it('lets one row per child, kind and run through per day', () => {
    const l = new KeptReasonLimiter();
    expect(KEPT_REASON_FEED_MS).toBe(DAY);
    expect(l.due('demo-a', 7, 'review', NOW)).toBe(true);
    expect(l.due('demo-a', 7, 'review', NOW + DAY - 1)).toBe(false);
    expect(l.due('demo-a', 7, 'review', NOW + DAY)).toBe(true);
  });

  it('a different kind, run or child has its own day', () => {
    const l = new KeptReasonLimiter();
    expect(l.due('demo-a', 7, 'review', NOW)).toBe(true);
    expect(l.due('demo-a', 7, 'siblings', NOW)).toBe(true);
    expect(l.due('demo-a', 8, 'review', NOW)).toBe(true);
    expect(l.due('demo-b', 7, 'review', NOW)).toBe(true);
  });

  it('forgets a child the registry no longer lists', () => {
    const l = new KeptReasonLimiter();
    l.due('demo-a', 7, 'review', NOW);
    l.due('demo-b', 7, 'review', NOW);
    l.prune(new Set(['demo-b']));
    expect(l.due('demo-a', 7, 'review', NOW + 1)).toBe(true);
    expect(l.due('demo-b', 7, 'review', NOW + 1)).toBe(false);
  });
});
