// A sibling run that ties a child's workspace down is ignored when it is provably abandoned: planned, never
// dispatched, older than fourteen days, and owned by a coordinator the registry archived or no longer lists. The
// rule is pure (`coord/staleSibling.ts`); the readers and the sweep lane are proved elsewhere in this file's
// neighbours (`child-reclaim-kept-reason-lane.test.ts`).
import { describe, it, expect } from 'vitest';
import {
  STALE_SIBLING_MS, claimantStateOfRead, isStaleSibling, splitSiblings, type ClaimantState, type SiblingFact,
} from '../src/coord/staleSibling.js';

const DAY = 24 * 3_600_000;
const NOW = 1_790_000_000_000;
const fact = (over: Partial<SiblingFact> = {}): SiblingFact => ({
  id: 83, state: 'planned', openedAt: NOW - 40 * DAY, dispatchStartedAt: null, dispatchedAt: null,
  claimedBy: 'coord-a', ...over,
});

describe('isStaleSibling', () => {
  it('the ceiling is fourteen days', () => {
    expect(STALE_SIBLING_MS).toBe(14 * DAY);
  });

  it('planned, undispatched, past the ceiling, claimant archived or gone: stale', () => {
    expect(isStaleSibling(fact(), 'archived-or-gone', NOW)).toBe(true);
  });

  it('exactly at the ceiling is not past it', () => {
    expect(isStaleSibling(fact({ openedAt: NOW - STALE_SIBLING_MS }), 'archived-or-gone', NOW)).toBe(false);
    expect(isStaleSibling(fact({ openedAt: NOW - STALE_SIBLING_MS - 1 }), 'archived-or-gone', NOW)).toBe(true);
  });

  it.each<[string, Partial<SiblingFact>, ClaimantState]>([
    ['a live claimant', {}, 'live'],
    ['an unmeasured claimant', {}, 'unmeasured'],
    ['a dispatched run', { dispatchedAt: NOW - 30 * DAY }, 'archived-or-gone'],
    ['a dispatch that started', { dispatchStartedAt: NOW - 30 * DAY }, 'archived-or-gone'],
    ['a working run', { state: 'working' }, 'archived-or-gone'],
    ['a run opened recently', { openedAt: NOW - 13 * DAY }, 'archived-or-gone'],
    ['a run opened in the future', { openedAt: NOW + DAY }, 'archived-or-gone'],
    ['a run with a non-finite open stamp', { openedAt: Number.NaN }, 'archived-or-gone'],
  ])('%s is never stale', (_why, over, claimant) => {
    expect(isStaleSibling(fact(over), claimant, NOW)).toBe(false);
  });
});

describe('splitSiblings', () => {
  it('separates the live siblings from the stale ones, each with its open stamp, in id order', () => {
    const facts = [fact({ id: 83 }), fact({ id: 90, claimedBy: 'coord-b', openedAt: NOW - 2 * DAY }), fact({ id: 66 })];
    const split = splitSiblings(facts, (c) => (c === 'coord-b' ? 'live' : 'archived-or-gone'), NOW);
    expect(split.live).toEqual([{ id: 90, openedAt: NOW - 2 * DAY }]);
    expect(split.stale).toEqual([{ id: 66, openedAt: NOW - 40 * DAY }, { id: 83, openedAt: NOW - 40 * DAY }]);
  });

  it('an ownerless run is never stale', () => {
    const split = splitSiblings([fact({ claimedBy: null })], () => 'archived-or-gone', NOW);
    expect(split.live).toHaveLength(1);
    expect(split.stale).toEqual([]);
  });
});

describe('claimantStateOfRead', () => {
  it('a proven absence and an archived row are archived-or-gone; a live row is live; every doubt is unmeasured', () => {
    expect(claimantStateOfRead({ kind: 'absent' })).toBe('archived-or-gone');
    expect(claimantStateOfRead({ kind: 'found', record: { archivedAt: 5 } })).toBe('archived-or-gone');
    expect(claimantStateOfRead({ kind: 'found', record: { archivedAt: null } })).toBe('live');
    for (const kind of ['unmeasurable', 'unlistable', 'bad-id'] as const) {
      expect(claimantStateOfRead({ kind })).toBe('unmeasured');
    }
  });
});
