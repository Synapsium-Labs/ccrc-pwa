// The one clock the programme boxes are read against (Task G1d, D-7380; review 1279 F3, F5): `useBoxClock` composes the
// rollup's clock (`useRollupClock`), the runs frame's stall watch quiet time and the coord frame's pause, and holds `boxNow`,
// the time read when the clock's `next` last moved. The project cards (`FleetCards`) and the Status view (`StatusTable`)
// both call it, and nothing else reads those three inputs as the boxes' clock (the coord banner and the start-a-programme
// sheet read the pause for their own words).
//
// Every dependency of `boxNow` but `roll.next` is pinned twice here, on the hook itself and through the real cards; the Status
// view's three cases are status-programmes.test.tsx's (Task G1d). Each case is built so `next` does NOT move at its event,
// because a move of `next` re-reads `boxNow` by itself and would hide a dependency dropped from the memo. The `roll.next` key is
// pinned on the hook and in status-programmes, and through the cards in programme-box-card's boundary cases (six a skin), not in
// this file's FleetCards cases. The pause the hook hands the CLOCK (review 1289 F1) is pinned by the hook's case of that name.
//
// MUTATION TABLE (Task G1d; each mutant RUN on `useBoxClock.ts`, one at a time, over this suite, status-programmes and
// programme-box-card (91 cases), then restored from a saved copy with its sha256 checked; the counts are red cases):
//   `roll.next` dropped from `boxNow`'s keys ........ 14: the boundary cases of every suite (the timer's wake reads no new time)
//   `activeRuns` dropped ............................ 5: the runs case on the hook, through the cards and in status-programmes, and the card's F3 case in both skins
//   `stallQuietMs` dropped .......................... 3: the quiet-time case on the hook, through the cards and in status-programmes
//   `coordPaused` dropped ........................... 5: the pause case on the hook, through the cards and in status-programmes, and the card's F3 case in both skins
//   `boxNow` frozen (keys `[]`) ..................... 28
//   `boxNow` unmemoised (`roll.now`) ................ 1: "holds `boxNow` while `next` and its inputs hold…", on the hook alone
//   the pause read as "not clear" (`!== 'clear'`) .... 32: an unmeasurable pause pauses every box
//   the quiet time a constant 2 h, null kept ....... 6 (`s.stallQuietMs === null ? null : 7_200_000`; the literal constant
//                                                    `store(() => 7_200_000)` is red 10, review 1289 F5)
//   the clock handed `false` for the pause ......... 1 (review 1289's M-A, green over all 91 cases before the case named
//                                                    "hands the clock the pause"; measured red below)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { FleetSession, RunSummary, UpdatesView } from '../../shared/api';
import { FleetCards } from '../src/fleet/FleetCards';
import { useBoxClock } from '../src/fleet/useBoxClock';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { renderFleet } from './fleetHost';
import { withRunBinding } from './runBindingFixture';
import { HOUR, MIN, NOW, run, sess } from './rollupFixture';

const QUIET = 2 * HOUR;
const noop = (): void => {};
const at = (minutesAgo: number): number => NOW - minutesAgo * MIN;
const coordFrame = (pause: 'set' | 'clear' | 'unmeasurable') =>
  ({ coordFrameSeen: true, coord: { pause, mail: 'clear' as const, reclaim: 'clear' as const, childReclaimAttention: [] } });

function newStore(): FleetStore {
  return createFleetStore({
    makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);
  vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useBoxClock', () => {
  const NO_SESSIONS: FleetSession[] = [];
  /** A run of a programme whose box last moved `minutesAgo` minutes before NOW. */
  const runOf = (id: number, minutesAgo: number): RunSummary =>
    run(id, `coord-${id}`, `w${id}`, { program: `prog-${id}`, project: 'project-c', lastMoveAt: at(minutesAgo) });
  const mountHook = (store: FleetStore, runs: readonly RunSummary[]) =>
    renderHook(({ rs }) => useBoxClock(store, NO_SESSIONS, rs), { initialProps: { rs: runs } });

  it('answers the store\'s quiet time and the pause as the coord frame\'s `set` only', () => {
    const store = newStore();
    const { result } = mountHook(store, []);
    expect(result.current.stallQuietMs).toBeNull();
    expect(result.current.coordPaused).toBe(false);
    act(() => { store.setState({ stallQuietMs: QUIET, ...coordFrame('set') }); });
    expect(result.current.stallQuietMs).toBe(QUIET);
    expect(result.current.coordPaused).toBe(true);
    act(() => { store.setState(coordFrame('unmeasurable')); });
    expect(result.current.coordPaused).toBe(false);
  });

  it('holds `boxNow` while `next` and its inputs hold, though the window clock reads on', () => {
    const store = newStore();
    act(() => { store.setState({ stallQuietMs: QUIET }); });
    const runs = [runOf(1, 100)];   // its boundary is 20 minutes out
    const { result, rerender } = mountHook(store, runs);
    const first = result.current;
    expect(first.boxNow).toBe(NOW);
    vi.setSystemTime(NOW + 5 * MIN);
    rerender({ rs: runs });
    expect(result.current.roll.now).toBe(NOW + 5 * MIN);
    expect(result.current.boxNow).toBe(NOW);
    expect(result.current.roll.next).toBe(first.roll.next);
  });

  it('re-reads `boxNow` at the boundary with no frame, through the clock\'s one timer', () => {
    const store = newStore();
    act(() => { store.setState({ stallQuietMs: QUIET }); });
    const { result } = mountHook(store, [runOf(1, 100)]);
    expect(result.current.boxNow).toBe(NOW);
    act(() => { vi.advanceTimersByTime(20 * MIN + 1); });
    expect(result.current.boxNow).toBe(NOW + 20 * MIN + 1);
  });

  it('re-reads `boxNow` when the pause changes, with no boundary ahead before or after', () => {
    const store = newStore();
    act(() => { store.setState({ stallQuietMs: QUIET, ...coordFrame('set') }); });
    const runs = [runOf(1, 300)];   // long past its threshold: nothing ahead
    const { result } = mountHook(store, runs);
    expect(result.current.roll.next).toBeNull();
    vi.setSystemTime(NOW + MIN);
    act(() => { store.setState(coordFrame('clear')); });
    expect(result.current.roll.next).toBeNull();
    expect(result.current.boxNow).toBe(NOW + MIN);
  });

  it('hands the clock the pause: no wake at a boundary while paused, the boundary once the pause clears (review 1289 F1)', () => {
    const store = newStore();
    act(() => { store.setState({ stallQuietMs: QUIET, ...coordFrame('set') }); });
    const { result } = mountHook(store, [runOf(1, 100)]);   // its boundary, 20 minutes out, is ahead
    expect(result.current.roll.next).toBeNull();
    act(() => { store.setState(coordFrame('clear')); });
    expect(result.current.roll.next).toBe(NOW + 20 * MIN);
    act(() => { store.setState(coordFrame('set')); });
    expect(result.current.roll.next).toBeNull();
  });

  it('re-reads `boxNow` when the runs change, with the same boundary ahead', () => {
    const store = newStore();
    act(() => { store.setState({ stallQuietMs: QUIET }); });
    const runs = [runOf(1, 100)];
    const { result, rerender } = mountHook(store, runs);
    expect(result.current.boxNow).toBe(NOW);
    vi.setSystemTime(NOW + 5 * MIN);
    rerender({ rs: [...runs] });
    expect(result.current.boxNow).toBe(NOW + 5 * MIN);
  });

  it('re-reads `boxNow` when the quiet time changes, with the same boundary ahead', () => {
    const store = newStore();
    act(() => { store.setState({ stallQuietMs: 4 * HOUR }); });
    // At 4 h the earliest boundary is the 180-minute box's, 60 minutes out. At 2 h, 40 minutes on, it and the 100-minute
    // box have crossed and the 60-minute box's, the same instant, is the earliest.
    const { result } = mountHook(store, [runOf(1, 300), runOf(2, 100), runOf(3, 180), runOf(4, 60)]);
    expect(result.current.roll.next).toBe(NOW + 60 * MIN);
    vi.setSystemTime(NOW + 40 * MIN);
    act(() => { store.setState({ stallQuietMs: QUIET }); });
    expect(result.current.roll.next).toBe(NOW + 60 * MIN);
    expect(result.current.boxNow).toBe(NOW + 40 * MIN);
  });
});

describe('the project cards\' boxes (FleetCards)', () => {
  /** One card, project-c, of coordinators each with one worker and a programme whose runs last moved as given. */
  function cardFleet(boxes: readonly { coord: string; moves: readonly number[] }[]): { sessions: FleetSession[]; runs: RunSummary[] } {
    const sessions: FleetSession[] = [];
    const runs: RunSummary[] = [];
    let n = 0;
    for (const { coord, moves } of boxes) {
      // The first coordinator changed state a minute ago, so the card is active and drawn open.
      sessions.push(sess(coord, 'project-c', { role: 'coordinator', status: 'busy', bucket: 'working', bucketSince: at(1), statusUpdatedAt: at(1) }));
      moves.forEach((m, i) => {
        const id = `${coord}-w${i}`;
        sessions.push(sess(id, 'project-c', { role: 'child' }));
        runs.push(run(++n, coord, id, { program: `prog-${coord}`, programTitle: `Programme ${coord}`, project: 'project-c', lastMoveAt: at(m) }));
      });
    }
    return { sessions: withRunBinding(sessions, runs), runs };
  }
  const frames = (f: { sessions: FleetSession[]; runs: RunSummary[] }, stallQuietMs: number | null) =>
    ({ conn: 'open' as const, fleetFrameSeen: true, runsFrameSeen: true, runs: f.runs, sessions: f.sessions, stallQuietMs });
  const mountCards = (): FleetStore => {
    const store = newStore();
    renderFleet(<FleetCards selectedId={null} onOpen={noop} />, store);
    return store;
  };
  const stateOf = (coord: string): string | null =>
    [...document.querySelectorAll<HTMLElement>('section.pg-box')]
      .find((b) => b.querySelector('.pg-title')?.textContent === `Programme ${coord}`)?.getAttribute('data-state') ?? null;

  it('a box that crossed under the pause reads stalled once the pause clears, with no boundary ahead', () => {
    const store = mountCards();
    act(() => { store.setState({ ...frames(cardFleet([{ coord: 'a', moves: [180] }, { coord: 'b', moves: [QUIET / MIN - 1] }]), QUIET), ...coordFrame('set') }); });
    act(() => { vi.advanceTimersByTime(MIN + 1_000); });
    expect(stateOf('b')).toBe('paused');
    act(() => { store.setState(coordFrame('clear')); });
    expect(stateOf('b')).toBe('stalled');
  });

  it('a runs frame that ages a box reads it stalled while the clock waits on another box', () => {
    const store = mountCards();
    const f = cardFleet([{ coord: 'a', moves: [100] }, { coord: 'b', moves: [115, 30] }]);
    act(() => { store.setState(frames(f, QUIET)); });
    expect(stateOf('b')).toBe('moving');
    act(() => { vi.advanceTimersByTime(10 * MIN); });
    // b's newest run closes: it last moved 125 minutes ago, and the clock still waits on a's boundary, 20 minutes out.
    act(() => { store.setState({ runs: f.runs.map((r) => (r.claimedBy === 'b' && r.id === 3 ? { ...r, state: 'done' as const } : r)) }); });
    expect(stateOf('b')).toBe('stalled');
  });

  it('a quiet time that changes with no boundary moving reads the boxes against the new one', () => {
    const store = mountCards();
    // The cards' clock also holds the rollup's window end, 29 minutes out (the coordinator changed state a minute ago), which is
    // the earliest boundary before and after: 25 minutes on, `next` is the same, and only a `boxNow` re-read tells b, 100
    // minutes quiet, that it has crossed the new 2 h threshold.
    act(() => { store.setState(frames(cardFleet([
      { coord: 'a', moves: [300] }, { coord: 'b', moves: [100] }, { coord: 'c', moves: [180] }, { coord: 'd', moves: [60] },
    ]), 4 * HOUR)); });
    expect(stateOf('b')).toBe('moving');
    vi.setSystemTime(NOW + 25 * MIN);
    act(() => { store.setState({ stallQuietMs: QUIET }); });
    expect(stateOf('b')).toBe('stalled');
    expect(stateOf('c')).toBe('stalled');
    expect(stateOf('d')).toBe('moving');
  });
});
