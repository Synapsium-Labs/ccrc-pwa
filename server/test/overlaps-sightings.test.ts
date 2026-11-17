// Overlord W2, overlaps (plan w2-overlaps.md, Task 1): the pair vocabulary and the two sighting deciders. The cases live
// in `overlapsCases.ts`, so `sim/overlapsSets.ts` judges each mutant by the same list; the time budget below is slow and
// stays out of the mutant suite.
import { describe, it, expect } from 'vitest';
import * as overlaps from '../src/coord/overlaps.js';
import {
  GOAL_CONFLICT_CHOICES, GOAL_CONFLICT_STEPS_MAX, GOAL_CONFLICT_WAITS_MAP, PAIR_CLOSED_MAP, PAIR_KINDS, PAIR_KIND_MAP,
  PAIR_SOURCE_MAP, isGoalConflictChoice, isPairKind, pairKeyOf, parsePairKey,
} from '../../shared/programmeFacts.js';
import { mulberry32 } from './fakeTime.js';
import { GOAL_CASES, HOUR, NOW, OVERLAP_CASES, type OverlapsCase } from './overlapsCases.js';
import type { ClaimHistoryRow } from '../src/coord/overlaps.js';

const suite = (name: string, cases: readonly OverlapsCase[]): void => {
  describe(name, () => { for (const c of cases) it(c.name, () => c.run(overlaps)); });
};

describe('the pair keys', () => {
  it('pairKeyOf orders the slugs by code unit, and parsePairKey reads back every key it makes', () => {
    expect(pairKeyOf('overlap', 'prog-b', 'prog-a')).toBe('overlap:prog-a:prog-b');
    expect(pairKeyOf('goal-conflict', 'prog-a', 'prog-b')).toBe('goal-conflict:prog-a:prog-b');
    expect(pairKeyOf('overlap', 'Prog', 'prog')).toBe('overlap:Prog:prog');
    for (const kind of PAIR_KINDS) {
      for (const [x, y] of [['prog-a', 'prog-b'], ['prog-b', 'prog-a'], ['a_1', 'a-1'], ['x', 'xy']] as const) {
        const key = pairKeyOf(kind, x, y);
        expect(parsePairKey(key)).toEqual({ kind, a: x < y ? x : y, b: x < y ? y : x });
      }
    }
  });
  it('parsePairKey refuses a bad kind, a missing part, an extra part and a >= b', () => {
    for (const bad of ['toString:prog-a:prog-b', 'overlap:prog-a', 'overlap:prog-a:prog-b:prog-c', 'overlap:prog-b:prog-a',
      'overlap:prog-a:prog-a', 'overlap::prog-b', 'overlap:prog-a:', '', 'prog-a:prog-b', ':prog-a:prog-b']) {
      expect(parsePairKey(bad), bad).toBeNull();
    }
  });
});

describe('the vocabulary', () => {
  it('every map\'s keys equal its list, and a guard reads nothing it does not hold', () => {
    expect(PAIR_KINDS).toEqual(Object.keys(PAIR_KIND_MAP));
    expect(PAIR_KINDS).toEqual(['overlap', 'goal-conflict']);
    expect(Object.keys(PAIR_SOURCE_MAP)).toEqual(['claim-collision', 'radar', 'claim-history']);
    expect(Object.keys(PAIR_CLOSED_MAP)).toEqual(['lapsed', 'programme-ended', 'goals-changed']);
    expect(Object.keys(GOAL_CONFLICT_WAITS_MAP)).toEqual(['none', 'a', 'b']);
    for (const v of ['toString', '', 'constructor', null, 3]) { expect(isPairKind(v)).toBe(false); expect(isGoalConflictChoice(v)).toBe(false); }
    expect(isPairKind('overlap')).toBe(true);
    expect(Object.keys(GOAL_CONFLICT_CHOICES)).toEqual(['both-stand', 'a-first', 'b-first']);
  });
  it('every GOAL_CONFLICT_CHOICES row\'s waits is in its map, and its label names {a} or {b} exactly when it waits (question 1)', () => {
    for (const [name, r] of Object.entries(GOAL_CONFLICT_CHOICES)) {
      expect(Object.keys(GOAL_CONFLICT_WAITS_MAP), name).toContain(r.waits);
      const names = r.label.includes('{a}') || r.label.includes('{b}');
      expect(names, name).toBe(r.waits !== 'none');
      if (r.waits === 'a') expect(r.label).toContain('{b}');
      if (r.waits === 'b') expect(r.label).toContain('{a}');
    }
  });
});

suite('overlapSightings: collisions and radar conflicts of two programmes', OVERLAP_CASES);
suite('goalConflictSightings: two triples of the claims history, hot paths set aside, bounded', GOAL_CASES);

describe('goalConflictSightings: the time budget (the review\'s F4)', () => {
  const big = (n: number, programmes: (i: number) => string, paths: (i: number, rnd: () => number) => string[]): ClaimHistoryRow[] => {
    const rnd = mulberry32(0xb16);
    return Array.from({ length: n }, (_, i) => ({
      claimId: i + 1, project: 'project-a', program: programmes(i), createdAt: NOW - (n - 1 - i) * HOUR / 10, paths: paths(i, rnd),
    }));
  };
  it('5,000 rows of two programmes alternating on one path (no path is hot) finish within 2 seconds and answer cut', () => {
    const h = big(5000, (i) => (i % 2 === 0 ? 'prog-a' : 'prog-b'), () => ['server/src/x.ts']);
    const t0 = performance.now();
    const r = overlaps.goalConflictSightings(h, NOW);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.cut).toBe(true);
    expect(GOAL_CONFLICT_STEPS_MAX).toBeGreaterThan(0);
  });
  it('5,000 rows of 40 programmes over 300 paths finish within 2 seconds', () => {
    const paths = Array.from({ length: 300 }, (_, i) => `dir${i % 30}/sub${i % 7}/file${i}.ts`);
    const h = big(5000, (i) => `prog-${i % 40}`, (_i, rnd) => [paths[Math.floor(rnd() * paths.length)]!]);
    const t0 = performance.now();
    overlaps.goalConflictSightings(h, NOW);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  it('5,000 rows of 40 programmes on nested directories, with few hot paths, finish within 2 seconds', () => {
    const h = big(5000, (i) => `prog-${i % 40}`, (i, rnd) => [`area${i % 40}/${Math.floor(rnd() * 3)}/f.ts`, `shared/dir${Math.floor(rnd() * 6)}`]);
    const t0 = performance.now();
    overlaps.goalConflictSightings(h, NOW);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
