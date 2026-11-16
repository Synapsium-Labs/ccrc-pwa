// Overlord W1, portfolio B (plan `w1-portfolio.md` Task 4): the cases of the two deciders, `goalRatification` and
// `itemAnswered`, with the parser and `ratificationOf`, written once over the module so `goals-ratification.test.ts` runs
// them against `shared/ledgers.ts` and `sim/ratificationSets.ts` against each mutated copy of it. Question 1 (operator item
// 328, 2026-11-16): a coordinator's own pin counts, and only the pin (review 2240 F3).
import { expect } from 'vitest';
import type * as Ledgers from '../../shared/ledgers.js';
import type { RatifiedBy } from '../../shared/ledgers.js';

export type RatificationModule = Pick<typeof Ledgers,
  'COORDINATOR_SOURCE_RATIFIES' | 'goalRatification' | 'itemAnswered' | 'modificationSource' | 'parseRatifiedBy' | 'pinSource'
  | 'ratificationOf' | 'ratifiedByText'>;
export interface RatificationCase { name: string; run: (m: RatificationModule) => void }

const NOW = 1_800_000_000_000;
const COORD: RatifiedBy = { kind: 'coordinator' };
const ITEM: RatifiedBy = { kind: 'item' };
const OPERATOR: RatifiedBy = { kind: 'operator' };

export const PARSE_CASES: RatificationCase[] = [
  { name: 'the parser reads every spelling the printer writes back, NULL as unrecorded, and anything else as unreadable', run: (m) => {
    for (const r of [COORD, ITEM, OPERATOR]) expect(m.parseRatifiedBy(m.ratifiedByText(r))).toEqual(r);
    expect(m.parseRatifiedBy(null)).toBe('unrecorded');
    for (const bad of ['item:3', 'request', 'Operator', '', 'toString', '__proto__']) expect(m.parseRatifiedBy(bad), bad).toBe('unreadable');
  } },
];

/** One row per item state (question 3). */
const ANSWERED_ROWS: readonly [string, { state: string; tickedAt: number | null }, boolean][] = [
  ['open, never ticked', { state: 'open', tickedAt: null }, false],
  ['checking after a tick', { state: 'checking', tickedAt: NOW }, true],
  ['done by confirm after a tick', { state: 'done', tickedAt: NOW }, true],
  ['done by settle from checking', { state: 'done', tickedAt: NOW }, true],
  ['done by settle from open, no tickedAt', { state: 'done', tickedAt: null }, false],
  ['done by act, no tickedAt', { state: 'done', tickedAt: null }, false],
  ['open after a return, old tickedAt kept', { state: 'open', tickedAt: NOW }, false],
  ['checking with no tickedAt (a row this build never writes)', { state: 'checking', tickedAt: null }, false],
  ['withdrawn', { state: 'withdrawn', tickedAt: NOW }, false],
  ['dismissed', { state: 'dismissed', tickedAt: NOW }, false],
];
export const ANSWERED_CASES: RatificationCase[] = ANSWERED_ROWS.map(([name, item, want]) => ({
  name: `itemAnswered: ${name}`, run: (m) => { expect(m.itemAnswered(item)).toBe(want); },
}));

export const DECIDER_CASES: RatificationCase[] = [
  { name: 'unrecorded and unreadable answer themselves, not ratified, with no source', run: (m) => {
    expect(m.goalRatification('unrecorded', null, 'prog-a', 'pin')).toEqual({ ratified: false, why: 'unrecorded', source: null });
    expect(m.goalRatification('unreadable', null, 'prog-a', 'pin')).toEqual({ ratified: false, why: 'unreadable', source: null });
  } },
  { name: '(question 1) a coordinator\'s own pin reads ratified, by the coordinator, because the constant is true', run: (m) => {
    expect(m.COORDINATOR_SOURCE_RATIFIES).toBe(true);
    expect(m.goalRatification(COORD, null, 'prog-a', 'pin')).toEqual({ ratified: true, source: COORD });
  } },
  { name: '(review 2240 F3) a coordinator\'s modification never ratifies: source-does-not-ratify', run: (m) => {
    expect(m.goalRatification(COORD, null, 'prog-a', 'modification')).toEqual({ ratified: false, why: 'source-does-not-ratify', source: COORD });
  } },
  { name: 'the version kind changes only the coordinator arm: the item and operator arms and the two words read the same', run: (m) => {
    const answered = { program: 'prog-a', state: 'checking', tickedAt: NOW };
    for (const of of ['pin', 'modification'] as const) {
      expect(m.goalRatification(ITEM, answered, 'prog-a', of)).toEqual({ ratified: false, why: 'effect-unmeasured', source: ITEM });
      expect(m.goalRatification(OPERATOR, null, 'prog-a', of)).toEqual({ ratified: true, source: OPERATOR });
      expect(m.goalRatification('unrecorded', null, 'prog-a', of)).toEqual({ ratified: false, why: 'unrecorded', source: null });
    }
  } },
  { name: 'the item arm: a missing item or another programme\'s is unreadable', run: (m) => {
    expect(m.goalRatification(ITEM, null, 'prog-a', 'pin')).toEqual({ ratified: false, why: 'unreadable', source: ITEM });
    expect(m.goalRatification(ITEM, { program: 'prog-b', state: 'checking', tickedAt: NOW }, 'prog-a', 'pin'))
      .toEqual({ ratified: false, why: 'unreadable', source: ITEM });
  } },
  { name: 'the item arm: a returned item is item-not-answered, a ticked one effect-unmeasured, never ratified', run: (m) => {
    expect(m.goalRatification(ITEM, { program: 'prog-a', state: 'open', tickedAt: NOW }, 'prog-a', 'pin'))
      .toEqual({ ratified: false, why: 'item-not-answered', source: ITEM });
    expect(m.goalRatification(ITEM, { program: 'prog-a', state: 'checking', tickedAt: NOW }, 'prog-a', 'pin'))
      .toEqual({ ratified: false, why: 'effect-unmeasured', source: ITEM });
    expect(m.goalRatification(ITEM, { program: 'prog-a', state: 'done', tickedAt: NOW }, 'prog-a', 'pin'))
      .toEqual({ ratified: false, why: 'effect-unmeasured', source: ITEM });
  } },
  { name: 'the operator\'s act ratifies', run: (m) => {
    expect(m.goalRatification(OPERATOR, null, 'prog-a', 'pin')).toEqual({ ratified: true, source: OPERATOR });
  } },
  { name: 'ratificationOf reads an absent field (an older server) as absent, and passes a present one through', run: (m) => {
    expect(m.ratificationOf(undefined)).toEqual({ ratified: false, why: 'absent', source: null });
    const r = { ratified: true as const, source: OPERATOR };
    expect(m.ratificationOf(r)).toBe(r);
  } },
];

/** Review 2240 F2 and F6: the pin's source counts only when stamped at or after its text; a modification's source is its own. */
export const SOURCE_CASES: RatificationCase[] = [
  { name: 'pinSource: a source stamped with or after the text counts; an older stamp, or none, reads unrecorded', run: (m) => {
    expect(m.pinSource('coordinator', NOW, NOW)).toEqual(COORD);
    expect(m.pinSource('operator', NOW + 1, NOW)).toEqual(OPERATOR);
    expect(m.pinSource('operator', NOW - 1, NOW)).toBe('unrecorded');
    expect(m.pinSource('operator', null, NOW)).toBe('unrecorded');
    expect(m.pinSource(null, NOW, NOW)).toBe('unrecorded');
    expect(m.pinSource('coordinator', NOW, null)).toBe('unrecorded');
  } },
  { name: 'pinSource: a current stamp over text this build cannot read is unreadable', run: (m) => {
    expect(m.pinSource('request', NOW, NOW)).toBe('unreadable');
    expect(m.pinSource('request', NOW - 1, NOW)).toBe('unrecorded');
  } },
  { name: 'modificationSource: an uncited row is the coordinator\'s, a cited one the item\'s', run: (m) => {
    expect(m.modificationSource(null)).toEqual(COORD);
    expect(m.modificationSource(12)).toEqual(ITEM);
  } },
];

export const ALL_RATIFICATION_CASES: RatificationCase[] = [...PARSE_CASES, ...ANSWERED_CASES, ...DECIDER_CASES, ...SOURCE_CASES];
