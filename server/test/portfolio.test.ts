// Overlord W1, portfolio (plan w1-portfolio.md, Task 1): `portfolioOrder`, `itemWaitMs` and `portfolioFor` over hand-built
// facts. The cases live in `portfolioCases.ts` so `sim/portfolioSets.ts` judges each mutant by the same list.
import { describe, it, expect } from 'vitest';
import * as portfolio from '../src/coord/portfolio.js';
import { operatorShownAt } from '../../shared/ledgers.js';
import { SERVICE_CLASSES, isServiceClass } from '../../shared/portfolio.js';
import {
  ASK_CASES, BLOCKING_CASES, CYCLE_CASES, ENDING_CASES, ITEM_CASES, LIST_CASES, ORDER_CASES, PURITY_CASES, W2_CASES, WAVE_CASES,
  type PortfolioCase,
} from './portfolioCases.js';

const suite = (name: string, cases: readonly PortfolioCase[]): void => {
  describe(name, () => { for (const c of cases) it(c.name, () => c.run(portfolio)); });
};

suite('portfolioOrder: classes in band order, then position; unranked at the end of standard', ORDER_CASES);
suite('portfolioFor: which programmes are listed', LIST_CASES);
suite('portfolioFor: the waves, as GET /api/programmes reads them', WAVE_CASES);
suite('portfolioFor: the cycle and the review rounds', CYCLE_CASES);
suite('portfolioFor: endings', ENDING_CASES);
suite('itemWaitMs and the items\' operator wait', ITEM_CASES);
suite('portfolioFor: ask waits (question 10)', ASK_CASES);
suite('portfolioFor: what blocks the programme', BLOCKING_CASES);
suite('portfolioFor: no clock', PURITY_CASES);
suite('portfolioFor: the W2 measures (forecasts B)', W2_CASES);

describe('the class vocabulary', () => {
  it('lists the four classes in band order and reads nothing else as a class', () => {
    expect(SERVICE_CLASSES).toEqual(['expedite', 'fixed-date', 'standard', 'background']);
    for (const c of SERVICE_CLASSES) expect(isServiceClass(c)).toBe(true);
    for (const v of ['urgent', '', 'toString', null, 3]) expect(isServiceClass(v)).toBe(false);
  });
});

describe('operatorShownAt, the hold rule the wait starts from', () => {
  it('is raisedAt unheld, heldUntil when held, and null when closed inside the hold', () => {
    expect(operatorShownAt({ raisedAt: 10, heldUntil: null, closedAt: null })).toBe(10);
    expect(operatorShownAt({ raisedAt: 10, heldUntil: 20, closedAt: null })).toBe(20);
    expect(operatorShownAt({ raisedAt: 10, heldUntil: 20, closedAt: 20 })).toBe(20);
    expect(operatorShownAt({ raisedAt: 10, heldUntil: 20, closedAt: 19 })).toBeNull();
  });
});
