// The words and the reader for calls made for you (D-8126).
import { describe, expect, it } from 'vitest';
import type { CallView } from '../../shared/api';
import { ApiError } from '../src/lib/api';
import {
  CALLS_GROUP_WORDS, CALL_REFUSAL_TEXT, CALL_TARGET_WORDS, callFilterShows, callTargetOf, type CallFilter, OVERTURN_WORD, SEEN_WORD, callLine, callRefusalText, callsApartOf, clearedCallsOf, openCallsOf,
} from '../src/ledgers/callWords';
import { CLEARED_WINDOW_MS } from '../../shared/ledgers';
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

// D-8808, D-8809: a call has an address on the list, `?call=<id>`; what that address names is decided here, over what the
// screen draws (review 3217): the 48-hour window and the filter included.
describe('callTargetOf', () => {
  const ALL: CallFilter = { noProgramme: false, programme: null };
  const at = (over: Partial<{ live: boolean; now: number; filter: CallFilter }> = {}) => ({ live: true, now: NOW, filter: ALL, ...over });
  const view = { ...waitingView(), calls: [call({ id: 1 })], callsCleared: [call({ id: 2, seenAt: NOW - MIN })] };
  it('a call still to see is open, a call on the trail is cleared, any other is gone', () => {
    expect(callTargetOf(view, 1, at())).toEqual({ at: 'open', call: view.calls[0]! });
    expect(callTargetOf(view, 2, at())).toEqual({ at: 'cleared', call: view.callsCleared[0]! });
    expect(callTargetOf(view, 3, at())).toEqual({ at: 'gone' });
  });
  it('a call in neither list on a view that is not the live one is unheard, never gone', () => {
    expect(callTargetOf(view, 3, at({ live: false }))).toEqual({ at: 'unheard' });
    expect(callTargetOf(view, 1, at({ live: false }))).toEqual({ at: 'open', call: view.calls[0]! });
  });
  it('an older view with no calls fields is gone', () => {
    expect(callTargetOf(waitingView(), 1, at())).toEqual({ at: 'gone' });
  });
  it('a call cleared outside the trail\'s 48-hour window is gone, live or not, never cleared (review 3217 F1)', () => {
    const old = { ...waitingView(), callsCleared: [call({ id: 5, seenAt: NOW - CLEARED_WINDOW_MS - MIN })] };
    expect(callTargetOf(old, 5, at())).toEqual({ at: 'gone' });
    expect(callTargetOf(old, 5, at({ live: false }))).toEqual({ at: 'gone' });
    const edge = { ...waitingView(), callsCleared: [call({ id: 6, seenAt: NOW - CLEARED_WINDOW_MS })] };
    expect(callTargetOf(edge, 6, at()).at).toBe('cleared');
  });
  it('a call the filter hides is hidden, open or cleared (review 3217 F3)', () => {
    const v = { ...waitingView(), calls: [call({ id: 1, program: 'prog-b' })], callsCleared: [call({ id: 2, program: 'prog-b', seenAt: NOW - MIN })] };
    const only = at({ filter: { noProgramme: false, programme: 'prog-a' } });
    expect(callTargetOf(v, 1, only)).toEqual({ at: 'hidden' });
    expect(callTargetOf(v, 2, only)).toEqual({ at: 'hidden' });
    expect(callTargetOf(v, 1, at({ filter: { noProgramme: true, programme: null } }))).toEqual({ at: 'hidden' });
    expect(callTargetOf(v, 2, at({ filter: { noProgramme: false, programme: 'prog-b' } })).at).toBe('cleared');
  });
  it('the notices are pinned', () => {
    expect(CALL_TARGET_WORDS.cleared).toBe('That call has cleared. It is marked below, in Recently cleared.');
    expect(CALL_TARGET_WORDS.gone).toBe('That call has cleared and is no longer on this list.');
    expect(CALL_TARGET_WORDS.unheard).toBe('That call is not in the list saved on this device. It shows here once the list is current.');
    expect(CALL_TARGET_WORDS.hidden).toBe('The filter on this list hides that call. Choose All programmes to see it.');
  });
});

describe('callFilterShows', () => {
  it('is the one predicate: no programme shows none, a programme shows its own, none shows all', () => {
    expect(callFilterShows({ noProgramme: true, programme: null }, 'prog-a')).toBe(false);
    expect(callFilterShows({ noProgramme: false, programme: 'prog-a' }, 'prog-a')).toBe(true);
    expect(callFilterShows({ noProgramme: false, programme: 'prog-a' }, 'prog-b')).toBe(false);
    expect(callFilterShows({ noProgramme: false, programme: null }, 'prog-b')).toBe(true);
  });
});
