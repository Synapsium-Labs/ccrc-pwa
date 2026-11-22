// The console's one reader of the Overlord (Overlord W1 home, Task 2): its cadence, its failure contract and "no Overlord read
// without the word". The store decides nothing; `nextReadState` (L1) is pinned here too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignationView } from '../../shared/overlord-designation';
import type { LadderWire } from '../../shared/overlord-ladder';
import { ApiError, ApiTimeout } from '../src/lib/api';
import { nextReadState } from '../src/overlord/readOutcome';
import type { ReadState } from '../src/overlord/readState';
import { createOverlordStore, OVERLORD_POLL_MS, type OverlordReads } from '../src/stores/overlord';

const AT = 1_700_000_000_000;
const ROW: DesignationView = {
  bound: { sessionId: 'lane-a-overlord', generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'opus',
  accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [],
};
const LADDER = { ok: true, operatorRung: 'chat' } as unknown as LadderWire;

interface Calls { caps: number; designation: number; ladder: number }
function fakeReads(over: Partial<OverlordReads> = {}): { reads: OverlordReads; calls: Calls } {
  const calls: Calls = { caps: 0, designation: 0, ladder: 0 };
  return {
    calls,
    reads: {
      caps: async () => { calls.caps += 1; return over.caps ? over.caps() : { caps: ['overlord-v1'] }; },
      designation: async () => { calls.designation += 1; return over.designation ? over.designation() : { designation: ROW }; },
      ladder: async () => { calls.ladder += 1; return over.ladder ? over.ladder() : LADDER; },
    },
  };
}
const settle = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('nextReadState (the failure contract, ruled F11)', () => {
  const answered: ReadState<number> = { state: 'answered', value: 1, at: AT };
  it('a value is answered at its time; an older server\'s 404 is absent', () => {
    expect(nextReadState({ state: 'loading' }, { kind: 'value', value: 2 }, AT)).toEqual({ state: 'answered', value: 2, at: AT });
    expect(nextReadState(answered, { kind: 'absent' }, AT)).toEqual({ state: 'absent' });
  });
  it('a failure before any answer is unmeasured, after one it is stale with the last value', () => {
    expect(nextReadState({ state: 'loading' }, { kind: 'failed', error: 'HTTP 503' }, AT)).toEqual({ state: 'unmeasured', error: 'HTTP 503' });
    expect(nextReadState({ state: 'absent' }, { kind: 'failed', error: 'x' }, AT)).toEqual({ state: 'unmeasured', error: 'x' });
    expect(nextReadState(answered, { kind: 'failed', error: 'timeout' }, AT + 5)).toEqual({ state: 'stale', value: 1, at: AT, error: 'timeout' });
    expect(nextReadState({ state: 'stale', value: 1, at: AT, error: 'a' }, { kind: 'failed', error: 'b' }, AT + 5))
      .toEqual({ state: 'stale', value: 1, at: AT, error: 'b' });
  });
});

describe('the Overlord store', () => {
  it('reads the caps, then the designation and the ladder, at start', async () => {
    const { reads, calls } = fakeReads();
    const store = createOverlordStore({ reads, now: () => AT });
    const stop = store.getState().start();
    await settle();
    expect(calls).toEqual({ caps: 1, designation: 1, ladder: 1 });
    expect(store.getState().caps).toEqual({ state: 'answered', value: ['overlord-v1'], at: AT });
    expect(store.getState().designation).toEqual({ state: 'answered', value: ROW, at: AT });
    expect(store.getState().ladder).toEqual({ state: 'answered', value: LADDER, at: AT });
    stop();
  });

  it('makes no Overlord read while the caps lack the word', async () => {
    const { reads, calls } = fakeReads({ caps: async () => ({ caps: ['continuity-v1'] }) });
    const store = createOverlordStore({ reads });
    const stop = store.getState().start();
    await settle();
    await vi.advanceTimersByTimeAsync(OVERLORD_POLL_MS * 3);
    await store.getState().refresh();
    expect(calls).toEqual({ caps: 1, designation: 0, ladder: 0 });
    expect(store.getState().designation).toEqual({ state: 'loading' });
    stop();
  });

  it('reads an older server\'s /health with no caps as no word, an answer and not a failure', async () => {
    const { reads, calls } = fakeReads({ caps: async () => ({}) });
    const store = createOverlordStore({ reads, now: () => AT });
    const stop = store.getState().start();
    await settle();
    expect(store.getState().caps).toEqual({ state: 'answered', value: [], at: AT });
    expect(calls.designation).toBe(0);
    stop();
  });

  it('polls the designation and the ladder every 60 s while visible, and not while hidden', async () => {
    const { reads, calls } = fakeReads();
    const store = createOverlordStore({ reads });
    const stop = store.getState().start();
    await settle();
    await vi.advanceTimersByTimeAsync(OVERLORD_POLL_MS);
    expect(calls).toEqual({ caps: 1, designation: 2, ladder: 2 });
    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(OVERLORD_POLL_MS * 2);
    expect(calls).toEqual({ caps: 1, designation: 2, ladder: 2 });
    stop();
  });

  it('re-reads everything, the caps included, when the page comes back to the front', async () => {
    const { reads, calls } = fakeReads();
    const store = createOverlordStore({ reads });
    const stop = store.getState().start();
    await settle();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(calls).toEqual({ caps: 2, designation: 2, ladder: 2 });
    stop();
  });

  it('reads at once after a door (refresh), and stops polling at the last stop', async () => {
    const { reads, calls } = fakeReads();
    const store = createOverlordStore({ reads });
    const a = store.getState().start();
    const b = store.getState().start();
    await settle();
    await store.getState().refresh();
    expect(calls).toEqual({ caps: 1, designation: 2, ladder: 2 });
    a();
    await vi.advanceTimersByTimeAsync(OVERLORD_POLL_MS);
    expect(calls.designation).toBe(3);
    b();
    await vi.advanceTimersByTimeAsync(OVERLORD_POLL_MS * 2);
    expect(calls.designation).toBe(3);
  });

  it('an older server (404, absent) is absent; a 401, a 503, a timeout and a network failure are unmeasured', async () => {
    const absent = fakeReads({ designation: async () => ({ absent: true }), ladder: async () => ({ absent: true }) });
    const s1 = createOverlordStore({ reads: absent.reads });
    const stop1 = s1.getState().start();
    await settle();
    expect(s1.getState().designation).toEqual({ state: 'absent' });
    expect(s1.getState().ladder).toEqual({ state: 'absent' });
    stop1();
    for (const [err, words] of [
      [new ApiError(401, { error: 'unauthenticated' }), 'HTTP 401'],
      [new ApiError(503, { error: 'unavailable' }), 'HTTP 503'],
      [new ApiTimeout('/api/overlord/designation', 20_000), 'timeout'],
      [new TypeError('Failed to fetch'), 'Failed to fetch'],
    ] as const) {
      const failing = fakeReads({ designation: async () => { throw err; } });
      const s = createOverlordStore({ reads: failing.reads });
      const stop = s.getState().start();
      await settle();
      expect(s.getState().designation, words).toEqual({ state: 'unmeasured', error: words });
      stop();
    }
  });

  it('a failure after an answer is stale, with its last value', async () => {
    let fail = false;
    const { reads } = fakeReads({ designation: async () => { if (fail) throw new ApiError(503, {}); return { designation: ROW }; } });
    const store = createOverlordStore({ reads, now: () => AT });
    const stop = store.getState().start();
    await settle();
    fail = true;
    await store.getState().refresh();
    expect(store.getState().designation).toEqual({ state: 'stale', value: ROW, at: AT, error: 'HTTP 503' });
    stop();
  });

  it('a late answer of an earlier call never overwrites a later one', async () => {
    const answers: Array<(v: { designation: DesignationView | null }) => void> = [];
    const { reads } = fakeReads({ designation: () => new Promise((r) => { answers.push(r); }) });
    const store = createOverlordStore({ reads, now: () => AT });
    const stop = store.getState().start();
    await settle();
    void store.getState().refresh();
    await settle();
    answers[1]!({ designation: null });
    await settle();
    answers[0]!({ designation: ROW });
    await settle();
    expect(store.getState().designation).toEqual({ state: 'answered', value: null, at: AT });
    stop();
  });
});
