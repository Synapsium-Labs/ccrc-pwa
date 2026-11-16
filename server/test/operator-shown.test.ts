// Overlord W1 portfolio: the item hold rule's characterization (`operatorWasShown`), pinned on `main` before the rule moves to
// `shared/ledgers.ts#operatorShownAt`, so the waiting list and the portfolio agree on when the operator was shown an item.
import { describe, it, expect } from 'vitest';
import { operatorWasShown } from '../src/coord/ledgersStore.js';

const NOW = 1_790_000_000_000;
const MIN = 60_000;
const item = (o: { heldUntil: number | null; closedAt: number | null }) => ({ raisedAt: NOW - 30 * MIN, ...o });

describe('operatorWasShown, the hold rule', () => {
  it('a never-held item is shown', () => {
    expect(operatorWasShown(item({ heldUntil: null, closedAt: null }), NOW)).toBe(true);
    expect(operatorWasShown(item({ heldUntil: null, closedAt: NOW - MIN }), NOW)).toBe(true);
  });

  it('a held item is not shown before heldUntil and is shown at it', () => {
    expect(operatorWasShown(item({ heldUntil: NOW + MIN, closedAt: null }), NOW)).toBe(false);
    expect(operatorWasShown(item({ heldUntil: NOW, closedAt: null }), NOW)).toBe(true);
    expect(operatorWasShown(item({ heldUntil: NOW - MIN, closedAt: null }), NOW)).toBe(true);
  });

  it('an item closed before heldUntil is never shown', () => {
    expect(operatorWasShown(item({ heldUntil: NOW - 5 * MIN, closedAt: NOW - 10 * MIN }), NOW)).toBe(false);
    expect(operatorWasShown(item({ heldUntil: NOW - 5 * MIN, closedAt: NOW - 10 * MIN }), NOW + 60 * MIN)).toBe(false);
  });

  it('an item closed at or after heldUntil is shown', () => {
    expect(operatorWasShown(item({ heldUntil: NOW - 10 * MIN, closedAt: NOW - 10 * MIN }), NOW)).toBe(true);
    expect(operatorWasShown(item({ heldUntil: NOW - 10 * MIN, closedAt: NOW - 5 * MIN }), NOW)).toBe(true);
  });
});
