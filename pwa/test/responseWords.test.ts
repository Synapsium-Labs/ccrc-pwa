// The console's "I handled this elsewhere" words and state (Overlord W1, C69), over the read's states.
import { describe, expect, it } from 'vitest';
import { HANDLED_WORDS, handledState, refParam } from '../src/responses/responseWords';
import type { ResponseRowBrief } from '../../shared/responses';

const row = (id: number, handledAt: number | null): ResponseRowBrief =>
  ({ id, kind: 'waiting', label: 'item', state: 'pending', outcome: null, handledAt });

describe('handledState', () => {
  it('is none for no rows', () => expect(handledState([])).toEqual({ kind: 'none' }));
  it('offers the unhandled rows only', () =>
    expect(handledState([row(1, null), row(2, 5), row(3, null)])).toEqual({ kind: 'offer', ids: [1, 3] }));
  it('is handled when every row is', () => expect(handledState([row(1, 4), row(2, 5)])).toEqual({ kind: 'handled' }));
});

describe('the words and the ref query', () => {
  it('says the two sentences the plan names', () => {
    expect(HANDLED_WORDS.button).toBe('I handled this elsewhere');
    expect(HANDLED_WORDS.handled).toBe('Marked handled elsewhere');
  });
  it('spells an item and a digest ref', () => {
    expect(refParam({ kind: 'item', id: 7 })).toBe('item:7');
    expect(refParam({ kind: 'digest', key: '2026-10-18:ask:1' })).toBe('digest:2026-10-18:ask:1');
  });
});
