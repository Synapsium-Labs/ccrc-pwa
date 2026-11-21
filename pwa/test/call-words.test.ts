// The words and the reader for calls made for you (D-8126).
import { describe, expect, it } from 'vitest';
import type { CallView } from '../../shared/api';
import { ApiError } from '../src/lib/api';
import {
  CALLS_GROUP_WORDS, CALL_REFUSAL_TEXT, CALL_TARGET_WORDS, callTargetOf, OVERTURN_WORD, SEEN_WORD, callLine, callRefusalText, callsApartOf, clearedCallsOf, openCallsOf,
} from '../src/ledgers/callWords';
import { MIN, NOW, waitingView } from './ledgersFixture';

const call = (over: Partial<CallView> = {}): CallView => ({
  id: 1, program: 'prog-a', runId: null, madeBy: 'coord', class: 'big', question: 'Which store?', options: ['sql', 'files'],
  chosen: 'sql', why: 'it is already there', reversible: true, wakeOn: null, at: NOW - 5 * MIN, seenAt: null,
  overturnedAt: null, overturnNote: null, ...over,
});

describe('openCallsOf', () => {
  it('one programme\'s calls still to see', () => {
    const view = { ...waitingView(), calls: [call({ id: 1 }), call({ id: 2, program: 'prog-b' })], callsCleared: [call({ id: 3 })] };
    expect(openCallsOf(view, 'prog-a')).toEqual([view.calls[0]!]);
    expect(openCallsOf(view, 'prog-c')).toEqual([]);
  });
  it('an older view with no calls reads as none', () => {
    const view = waitingView();
    expect('calls' in view).toBe(false);
    expect(openCallsOf(view, 'prog-a')).toEqual([]);
    expect(clearedCallsOf(view, { noProgramme: false, programme: null })).toEqual([]);
    expect(callsApartOf(view, [], { noProgramme: false, programme: null })).toEqual([]);
  });
});

// Fix round 1 (review 2792 F7): which programmes draw their calls apart, and which cleared calls a filtered list holds, are
// decided here, not in the screen.
describe('callsApartOf and clearedCallsOf', () => {
  const ALL = { noProgramme: false, programme: null };
  const view = {
    ...waitingView(),
    calls: [call({ id: 1, program: 'prog-b' }), call({ id: 2, program: 'prog-a' }), call({ id: 3, program: 'prog-c' }), call({ id: 4, program: 'prog-b' })],
    callsCleared: [call({ id: 5, program: 'prog-a' }), call({ id: 6, program: 'prog-b' })],
  };
  it('a programme with calls and no rows is apart, once, in the order its first call is listed', () => {
    expect(callsApartOf(view, ['prog-a', null], ALL)).toEqual(['prog-b', 'prog-c']);
  });
  it('under a programme\'s filter only that programme can be apart; under the no-programme filter none is', () => {
    expect(callsApartOf(view, ['prog-a'], { noProgramme: false, programme: 'prog-c' })).toEqual(['prog-c']);
    expect(callsApartOf(view, ['prog-a'], { noProgramme: false, programme: 'prog-a' })).toEqual([]);
    expect(callsApartOf(view, [null], { noProgramme: true, programme: null })).toEqual([]);
  });
  it('the cleared calls follow the filter', () => {
    expect(clearedCallsOf(view, ALL).map((c) => c.id)).toEqual([5, 6]);
    expect(clearedCallsOf(view, { noProgramme: false, programme: 'prog-b' }).map((c) => c.id)).toEqual([6]);
    expect(clearedCallsOf(view, { noProgramme: true, programme: null })).toEqual([]);
  });
});

describe('words', () => {
  it('the heading, and the two actions', () => {
    expect(CALLS_GROUP_WORDS(2)).toBe('Calls made for you (2)');
    expect(OVERTURN_WORD).toBe('Overturn…');
    expect(SEEN_WORD).toBe('Seen');
  });
  it('a call line names the question, the choice, the reason and the age', () => {
    expect(callLine(call(), NOW)).toBe('Which store? · Chose: sql · Because: it is already there · 5m ago');
  });
  it('a call with no question or reason leaves them out', () => {
    expect(callLine(call({ question: null, why: '' }), NOW)).toBe('Chose: sql · 5m ago');
  });
});

describe('call refusals', () => {
  const refused = (error: string): ApiError => new ApiError(409, { error });
  it('each of the four has its sentence', () => {
    for (const code of ['not-coordinator', 'duplicate', 'not-big', 'unknown-call'] as const) {
      expect(callRefusalText(refused(code))).toBe(CALL_REFUSAL_TEXT[code]);
      expect(CALL_REFUSAL_TEXT[code].length).toBeGreaterThan(10);
    }
  });
  it('a code the table does not own is null', () => {
    expect(callRefusalText(refused('toString'))).toBeNull();
    expect(callRefusalText(new Error('x'))).toBeNull();
  });
});

// D-8808, D-8809: a call has an address on the list, `?call=<id>`; what that address names is decided here.
describe('callTargetOf', () => {
  const view = { ...waitingView(), calls: [call({ id: 1 })], callsCleared: [call({ id: 2, seenAt: NOW - MIN })] };
  it('a call still to see is open, a call on the trail is cleared, any other is gone', () => {
    expect(callTargetOf(view, 1)).toEqual({ at: 'open', call: view.calls[0]! });
    expect(callTargetOf(view, 2)).toEqual({ at: 'cleared', call: view.callsCleared[0]! });
    expect(callTargetOf(view, 3)).toEqual({ at: 'gone' });
  });
  it('an older view with no calls fields is gone', () => {
    expect(callTargetOf(waitingView(), 1)).toEqual({ at: 'gone' });
  });
  it('the two notices are pinned', () => {
    expect(CALL_TARGET_WORDS.cleared).toBe('That call has cleared. It is marked below, in Recently cleared.');
    expect(CALL_TARGET_WORDS.gone).toBe('That call has cleared and is no longer on this list.');
  });
});
