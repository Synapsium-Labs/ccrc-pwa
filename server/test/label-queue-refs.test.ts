// Overlord W2, the label queue's refs (the coordinator's ruling on the gap, call 1913): which refs a card's state names, whether
// the state can be drawn (resolved, absent, unmeasured, or a ref kind with no reader), the lane's row facts, which cards hold
// a slot of the ten, and a card's fields rebuilt from its record and the texts the door read. Pure: no store, no clock.
import { describe, expect, it } from 'vitest';
import { DECISION_QUESTIONS as Q } from '../../shared/decisionModel.js';
import { cardFieldsOf, type CardRefText } from '../src/coord/labelCards.js';
import {
  cardHoldsSlot, cardRefNeeds, labelsNeeded, nextCandidate, pickRowFactsOf, stateDrawability, type RefFound,
} from '../src/coord/labelQueue.js';

const found = (entries: Record<string, RefFound>): ReadonlyMap<string, RefFound> => new Map(Object.entries(entries));

describe('cardRefNeeds: the refs a state names', () => {
  it('an inline-only row needs no read', () => {
    expect(cardRefNeeds(Q['relay.method'], {})).toEqual({ kind: 'reads', reads: [] });
  });

  it('message and mail refs are read by id, a list or one', () => {
    expect(cardRefNeeds(Q['readback.omits'], { request: ['3', '41'], readback: '12' })).toEqual({ kind: 'reads', reads: [
      { name: 'request', refKind: 'message', ids: [3, 41] },
      { name: 'readback', refKind: 'mail', ids: [12] },
    ] });
  });

  it('a programme ref is its own text and needs no read', () => {
    expect(cardRefNeeds(Q['programme.pick'], { candidates: ['prog-a', 'prog-b'] })).toEqual({ kind: 'reads', reads: [] });
  });

  it('a goals-version ref has no reader in this build, whatever else the state names', () => {
    expect(cardRefNeeds(Q['scope.widens'], { cited: ['7'], goals: 'anything' })).toEqual({ kind: 'no-reader' });
  });

  it('an id that is not a positive integer, or a name the row does not cite, is malformed', () => {
    for (const bad of ['0', '-1', 'abc', '1.5', '', '01', '99999999999999999999']) {
      expect(cardRefNeeds(Q['readback.omits'], { request: bad, readback: '1' })).toEqual({ kind: 'malformed' });
    }
    expect(cardRefNeeds(Q['readback.omits'], { request: '1', readback: '1', extra: '1' })).toEqual({ kind: 'malformed' });
    expect(cardRefNeeds(Q['relay.method'], { part: '1' })).toEqual({ kind: 'malformed' });
  });
});

describe('stateDrawability: one word, never folded', () => {
  const needs = cardRefNeeds(Q['readback.omits'], { request: ['3', '4'], readback: '12' });
  it('every ref present draws', () => {
    expect(stateDrawability(needs, found({ 'message:3': 'present', 'message:4': 'present', 'mail:12': 'present' }))).toBe('drawable');
  });
  it('one absent ref is absent, even beside an unmeasured one', () => {
    expect(stateDrawability(needs, found({ 'message:3': 'unmeasured', 'message:4': 'absent', 'mail:12': 'present' }))).toBe('absent');
  });
  it('an unmeasured or unasked ref is unmeasured', () => {
    expect(stateDrawability(needs, found({ 'message:3': 'present', 'message:4': 'unmeasured', 'mail:12': 'present' }))).toBe('unmeasured');
    expect(stateDrawability(needs, found({ 'message:3': 'present', 'mail:12': 'present' }))).toBe('unmeasured');
  });
  it('a ref kind with no reader is no-reader, and a malformed ref is absent', () => {
    expect(stateDrawability({ kind: 'no-reader' }, found({}))).toBe('no-reader');
    expect(stateDrawability({ kind: 'malformed' }, found({}))).toBe('absent');
    expect(stateDrawability({ kind: 'reads', reads: [] }, found({}))).toBe('drawable');
  });
});

describe('cardHoldsSlot: what counts as open for the budget (point a)', () => {
  it('a shown card holds a slot unless its state is proven absent or has no reader', () => {
    expect(cardHoldsSlot('shown', 'drawable')).toBe(true);
    expect(cardHoldsSlot('shown', 'unmeasured')).toBe(true);
    expect(cardHoldsSlot('shown', 'absent')).toBe(false);
    expect(cardHoldsSlot('shown', 'no-reader')).toBe(false);
    expect(cardHoldsSlot('hidden', 'drawable')).toBe(false);
  });
});

describe('nextCandidate and pickRowFactsOf', () => {
  it('the next candidate is the first line, strictest first, whose bound is over the target; null when all pass', () => {
    expect(nextCandidate(Q['relay.method'], [])).toBe(0.95);
    const clean = Array.from({ length: 29 }, () => ({ p: 0.99, verdict: 'yes' as const, label: 'yes' as const }));
    // 29 clean at 0.99 pass 0.95 and 0.9; three errors at 0.85 fail it, so 0.85 is next.
    const errs = Array.from({ length: 3 }, () => ({ p: 0.85, verdict: 'yes' as const, label: 'no' as const }));
    expect(nextCandidate(Q['relay.method'], [...clean, ...errs])).toBe(0.85);
    expect(nextCandidate(Q['relay.method'], clean)).toBe(null);
    expect(labelsNeeded(Q['relay.method'], clean)).toBe('none');
  });

  it('marks a waiting case the model marked at the next candidate, keeps only drawable states, and carries the need', () => {
    const f = pickRowFactsOf({
      row: Q['relay.method'], mode: 'shadow', answers: [], lastCardWeekStart: 'never',
      waiting: [
        { stateHash: 'a', recordId: 1, at: 1, verdict: 'yes', p: 0.96, drawability: 'drawable' },
        { stateHash: 'b', recordId: 2, at: 2, verdict: 'yes', p: 0.9, drawability: 'drawable' },
        { stateHash: 'c', recordId: 3, at: 3, verdict: 'no', p: 0.99, drawability: 'drawable' },
        { stateHash: 'd', recordId: 4, at: 4, verdict: null, p: 0.99, drawability: 'drawable' },
        { stateHash: 'e', recordId: 5, at: 5, verdict: 'yes', p: 0.99, drawability: 'absent' },
        { stateHash: 'f', recordId: 6, at: 6, verdict: 'yes', p: 0.99, drawability: 'unmeasured' },
        { stateHash: 'g', recordId: 7, at: 7, verdict: 'yes', p: 0.99, drawability: 'no-reader' },
      ],
    });
    expect(f.needed).toBe(29);
    expect(f.waiting).toEqual([
      { stateHash: 'a', recordId: 1, at: 1, markedAtNext: true },
      { stateHash: 'b', recordId: 2, at: 2, markedAtNext: false },
      { stateHash: 'c', recordId: 3, at: 3, markedAtNext: false },
      { stateHash: 'd', recordId: 4, at: 4, markedAtNext: false },
    ]);
  });

  it('a row with no next candidate marks nothing', () => {
    const cleanAll = Array.from({ length: 29 }, () => ({ p: 0.99, verdict: 'yes' as const, label: 'yes' as const }));
    const f = pickRowFactsOf({ row: Q['relay.method'], mode: 'armed', answers: cleanAll, lastCardWeekStart: 7,
      waiting: [{ stateHash: 'a', recordId: 1, at: 1, verdict: 'yes', p: 0.99, drawability: 'drawable' }] });
    expect(f).toMatchObject({ needed: 'none', mode: 'armed', lastCardWeekStart: 7, waiting: [{ stateHash: 'a', markedAtNext: false }] });
  });
});

describe('cardFieldsOf: a card\'s fields from its record and what the door read', () => {
  const t = (entries: Record<string, CardRefText>): ReadonlyMap<string, CardRefText> => new Map(Object.entries(entries));
  it('an inline row draws its inline fields', () => {
    expect(cardFieldsOf(Q['relay.method'], {}, { part: 'the part' }, t({}))).toEqual({ kind: 'fields', fields: { part: 'the part' } });
  });
  it('message and mail refs draw their texts; a list of ids draws a list', () => {
    expect(cardFieldsOf(Q['readback.omits'], { request: ['3', '4'], readback: '12' }, null, t({
      'message:3': { kind: 'resolved', text: 'first' }, 'message:4': { kind: 'resolved', text: 'second' }, 'mail:12': { kind: 'resolved', text: 'the readback' },
    }))).toEqual({ kind: 'fields', fields: { request: ['first', 'second'], readback: 'the readback' } });
    expect(cardFieldsOf(Q['readback.adds'], { request: '3', readback: '12' }, null, t({
      'message:3': { kind: 'resolved', text: 'first' }, 'mail:12': { kind: 'resolved', text: 'rb' },
    }))).toEqual({ kind: 'fields', fields: { request: 'first', readback: 'rb' } });
  });
  it('a programme ref draws its slug', () => {
    expect(cardFieldsOf(Q['programme.any'], { candidates: ['prog-a'] }, { request: 'r', goals: 'g' }, t({})))
      .toEqual({ kind: 'fields', fields: { candidates: ['prog-a'], request: 'r', goals: 'g' } });
  });
  it('each skip word is its own: absent, unmeasured, no-reader', () => {
    const refs = { request: '3', readback: '12' };
    expect(cardFieldsOf(Q['readback.omits'], refs, null, t({ 'message:3': { kind: 'absent' }, 'mail:12': { kind: 'resolved', text: 'x' } })))
      .toEqual({ kind: 'skip', word: 'absent' });
    expect(cardFieldsOf(Q['readback.omits'], refs, null, t({ 'message:3': { kind: 'unmeasured', why: 'no store' }, 'mail:12': { kind: 'resolved', text: 'x' } })))
      .toEqual({ kind: 'skip', word: 'unmeasured' });
    expect(cardFieldsOf(Q['readback.omits'], refs, null, t({ 'message:3': { kind: 'resolved', text: 'x' } })))
      .toEqual({ kind: 'skip', word: 'unmeasured' });
    expect(cardFieldsOf(Q['scope.widens'], { cited: '7', goals: 'g' }, null, t({}))).toEqual({ kind: 'skip', word: 'no-reader' });
    expect(cardFieldsOf(Q['readback.omits'], { request: 'x', readback: '1' }, null, t({}))).toEqual({ kind: 'skip', word: 'absent' });
  });
});
