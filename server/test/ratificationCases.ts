// Overlord W1, portfolio B (plan `w1-portfolio.md` Task 4): the cases of the two deciders, `goalRatification` and
// `itemAnswered`, with the parser and `ratificationOf`, written once over the module so `goals-ratification.test.ts` runs
// them against `shared/ledgers.ts` and `sim/ratificationSets.ts` against each mutated copy of it. Question 1 (operator item
// 328, 2026-11-16): a coordinator's own pin counts.
import { expect } from 'vitest';
import type * as Ledgers from '../../shared/ledgers.js';
import type { RatifiedBy } from '../../shared/ledgers.js';

export type RatificationModule = Pick<typeof Ledgers,
  'COORDINATOR_SOURCE_RATIFIES' | 'goalRatification' | 'itemAnswered' | 'parseRatifiedBy' | 'ratificationOf' | 'ratifiedByText'>;
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
    expect(m.goalRatification('unrecorded', null, 'prog-a')).toEqual({ ratified: false, why: 'unrecorded', source: null });
    expect(m.goalRatification('unreadable', null, 'prog-a')).toEqual({ ratified: false, why: 'unreadable', source: null });
  } },
  { name: '(question 1) a coordinator\'s own write reads ratified, by the coordinator, because the constant is true', run: (m) => {
    expect(m.COORDINATOR_SOURCE_RATIFIES).toBe(true);
    expect(m.goalRatification(COORD, null, 'prog-a')).toEqual({ ratified: true, source: COORD });
  } },
  { name: 'the item arm: a missing item or another programme\'s is unreadable', run: (m) => {
    expect(m.goalRatification(ITEM, null, 'prog-a')).toEqual({ ratified: false, why: 'unreadable', source: ITEM });
    expect(m.goalRatification(ITEM, { program: 'prog-b', state: 'checking', tickedAt: NOW }, 'prog-a'))
      .toEqual({ ratified: false, why: 'unreadable', source: ITEM });
  } },
  { name: 'the item arm: a returned item is item-not-answered, a ticked one effect-unmeasured, never ratified', run: (m) => {
    expect(m.goalRatification(ITEM, { program: 'prog-a', state: 'open', tickedAt: NOW }, 'prog-a'))
      .toEqual({ ratified: false, why: 'item-not-answered', source: ITEM });
    expect(m.goalRatification(ITEM, { program: 'prog-a', state: 'checking', tickedAt: NOW }, 'prog-a'))
      .toEqual({ ratified: false, why: 'effect-unmeasured', source: ITEM });
    expect(m.goalRatification(ITEM, { program: 'prog-a', state: 'done', tickedAt: NOW }, 'prog-a'))
      .toEqual({ ratified: false, why: 'effect-unmeasured', source: ITEM });
  } },
  { name: 'the operator\'s act ratifies', run: (m) => {
    expect(m.goalRatification(OPERATOR, null, 'prog-a')).toEqual({ ratified: true, source: OPERATOR });
  } },
  { name: 'ratificationOf reads an absent field (an older server) as absent, and passes a present one through', run: (m) => {
    expect(m.ratificationOf(undefined)).toEqual({ ratified: false, why: 'absent', source: null });
    const r = { ratified: true as const, source: OPERATOR };
    expect(m.ratificationOf(r)).toBe(r);
  } },
];

export const ALL_RATIFICATION_CASES: RatificationCase[] = [...PARSE_CASES, ...ANSWERED_CASES, ...DECIDER_CASES];
