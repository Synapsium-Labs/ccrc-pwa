// The words and the reader for calls made for you (D-8126).
import { describe, expect, it } from 'vitest';
import type { CallView } from '../../shared/api';
import { ApiError } from '../src/lib/api';
import {
  CALLS_GROUP_WORDS, CALL_REFUSAL_TEXT, OVERTURN_WORD, SEEN_WORD, callLine, callRefusalText, callsOf,
} from '../src/ledgers/callWords';
import { MIN, NOW, waitingView } from './ledgersFixture';

const call = (over: Partial<CallView> = {}): CallView => ({
  id: 1, program: 'prog-a', runId: null, madeBy: 'coord', class: 'big', question: 'Which store?', options: ['sql', 'files'],
  chosen: 'sql', why: 'it is already there', reversible: true, wakeOn: null, at: NOW - 5 * MIN, seenAt: null,
  overturnedAt: null, overturnNote: null, ...over,
});

describe('callsOf', () => {
  it('splits one programme\'s calls into open and cleared', () => {
    const view = { ...waitingView(), calls: [call({ id: 1 }), call({ id: 2, program: 'prog-b' })], callsCleared: [call({ id: 3 })] };
    expect(callsOf(view, 'prog-a')).toEqual({ open: [view.calls[0]!], cleared: [view.callsCleared[0]!] });
    expect(callsOf(view, 'prog-b').cleared).toEqual([]);
  });
  it('an older view with no calls reads as none', () => {
    const view = waitingView();
    expect('calls' in view).toBe(false);
    expect(callsOf(view, 'prog-a')).toEqual({ open: [], cleared: [] });
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
  it('each of the three has its sentence', () => {
    for (const code of ['not-coordinator', 'duplicate', 'not-big'] as const) {
      expect(callRefusalText(refused(code))).toBe(CALL_REFUSAL_TEXT[code]);
      expect(CALL_REFUSAL_TEXT[code].length).toBeGreaterThan(10);
    }
  });
  it('a code the table does not own is null', () => {
    expect(callRefusalText(refused('toString'))).toBeNull();
    expect(callRefusalText(new Error('x'))).toBeNull();
  });
});
