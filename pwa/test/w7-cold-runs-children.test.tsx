// `useColdRuns`'s child accumulation (`childRunsSeen`, D-7214) and the archive reads it triggers, pinned before C7d
// (D-7179; Task C7a; plan docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 3). `childRunsSeen` asks
// "which finished runs had a child", from two facts held for the board's life: the minting run each fleet session's
// `.child` mark names, and every cold row carrying a reclaim chip. `RunSummary.childIds` names only OPEN runs with a
// bound worker, so it never names a closed run; these rows are what a reader keyed on it would lose. Each row pins the
// `loadRuns` calls, under fake timers (no wall-clock wait decides a count).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ChildReclaimStatus, CoordStatus, FleetSession, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { childRunsSeen } from '../src/fleet/runWords';
import { useColdRuns } from '../src/screens/useColdRuns';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

const T = 1_784_500_000_000;

const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: 'program-a', programTitle: 'Program A', wave: 1, waveOf: 3, project: 'project-a', homeProject: null,
  sessionId: 'session-a', workspace: 'ws-a', branch: 'ws/ws-a', state: 'working', kind: 'work', reviews: null,
  claimedBy: 'coord-a', resumed: false, clearedAt: null, openedAt: T - 1_000_000, dispatchStartedAt: null, dispatchedAt: T - 900_000,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, ...over,
});
const finished = (id: number, word: ChildReclaimStatus['word'] | null, over: Partial<RunSummary> = {}): RunSummary =>
  run(id, { state: 'done', closedAt: T - 60_000, childReclaim: word === null ? null : { word, sentence: null, at: null }, ...over });
const child = (runId: number, over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id: 'session-a', project: 'project-a', workspace: 'ws-a', role: 'child', child: { kind: 'child', runId }, ...over });
const coordWith = (doneAt?: number): CoordStatus => ({
  pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [],
  ...(doneAt === undefined ? {} : { childReclaimDoneAt: doneAt }),
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

/** Let every promise the hook chained settle; fake timers, so nothing waits on the clock. */
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };

/** Mount the hook over a store already holding `sessions` and a coord frame at `T`, with a cold read answering `rows`. */
async function mount(rows: RunSummary[], sessions: FleetSession[]): Promise<{ store: FleetStore; loadRuns: ReturnType<typeof vi.fn> }> {
  const store = makeStore();
  act(() => { store.setState({ runs: [], runsFrameSeen: true, sessions, fleetFrameSeen: true, coord: coordWith(T), coordFrameSeen: true }); });
  const loadRuns = vi.fn(async (): Promise<{ runs: RunSummary[] }> => ({ runs: rows }));
  renderHook(() => useColdRuns(store, loadRuns));
  await flush();
  return { store, loadRuns };
}
const coordFrame = async (store: FleetStore, doneAt: number): Promise<void> => {
  act(() => { store.setState({ coord: coordWith(doneAt), coordFrameSeen: true }); });
  await flush();
};
const fleetFrame = async (store: FleetStore, sessions: FleetSession[]): Promise<void> => {
  act(() => { store.setState({ sessions, fleetFrameSeen: true }); });
  await flush();
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useColdRuns: the children it remembers and the reads they trigger (D-7214)', () => {
  it('the race row: finished run 7, no live runs, a child marked {kind: child, runId: 7}; a coord-frame reclaim end re-reads (two loadRuns calls)', async () => {
    expect([...childRunsSeen(new Set(), [child(7)], [finished(7, null)])]).toEqual([7]);
    const { store, loadRuns } = await mount([finished(7, null)], [child(7)]);
    expect(loadRuns).toHaveBeenCalledTimes(1);
    await fleetFrame(store, []);                    // the vanish: no chip, so wave 5 stays quiet
    expect(loadRuns).toHaveBeenCalledTimes(1);
    await coordFrame(store, T + 1);                 // wave 6's trigger: the run had a child
    expect(loadRuns).toHaveBeenCalledTimes(2);
    await coordFrame(store, T + 1);                 // the same value again: no read
    expect(loadRuns).toHaveBeenCalledTimes(2);
  });

  it('the resumed-child row: a child whose mark names run 1 while its binding names run 5; run 1 is in the set', async () => {
    const resumed = child(1, { run: { id: 5, state: 'working', claimedBy: 'coord-a' }, openRun: { id: 5, state: 'working', claimedBy: 'coord-a' } });
    expect([...childRunsSeen(new Set(), [resumed], [])]).toEqual([1]);
    const { store, loadRuns } = await mount([finished(1, null)], [resumed]);
    await coordFrame(store, T + 1);
    expect(loadRuns).toHaveBeenCalledTimes(2);
  });

  it('the board-mounted-after-close row: the board mounts after run 7 closed; the mark still puts it in the set', async () => {
    const { store, loadRuns } = await mount([finished(7, null)], [child(7)]);
    expect(loadRuns).toHaveBeenCalledTimes(1);
    await coordFrame(store, T + 1);
    expect(loadRuns).toHaveBeenCalledTimes(2);
  });

  it('a finished run nobody marked and no chip names is not in the set: no re-read', async () => {
    const { store, loadRuns } = await mount([finished(7, null)], [fleetSession({ id: 'session-b', project: 'project-a' })]);
    await coordFrame(store, T + 1);
    expect(loadRuns).toHaveBeenCalledTimes(1);
  });

  it('the skew row: childIds absent or present, the set and the re-reads are the same (the reader never reads childIds)', async () => {
    const counts: number[] = [];
    const sets: number[][] = [];
    for (const childIds of [undefined, [7], []] as const) {
      const rows = [finished(7, null, childIds === undefined ? {} : { childIds })];
      sets.push([...childRunsSeen(new Set(), [child(7)], rows)]);
      const { store, loadRuns } = await mount(rows, [child(7)]);
      await fleetFrame(store, []);
      await coordFrame(store, T + 1);
      counts.push(loadRuns.mock.calls.length);
      cleanup();
    }
    expect(sets).toEqual([[7], [7], [7]]);
    expect(counts).toEqual([2, 2, 2]);
  });

  it('the schedule: one read per mount, one on a live run leaving the slice, one on a pending child\'s session leaving the fleet', async () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [run(8)], runsFrameSeen: true, sessions: [child(9)], fleetFrameSeen: true, coord: coordWith(T), coordFrameSeen: true }); });
    const loadRuns = vi.fn(async (): Promise<{ runs: RunSummary[] }> => ({ runs: [finished(9, 'pending', { sessionId: 'session-a' })] }));
    renderHook(() => useColdRuns(store, loadRuns));
    await flush();
    expect(loadRuns).toHaveBeenCalledTimes(1);
    act(() => { store.setState({ runs: [] }); });   // run 8 leaves the live slice
    await flush();
    expect(loadRuns).toHaveBeenCalledTimes(2);
    await fleetFrame(store, []);                    // the pending child's session leaves the fleet frame
    expect(loadRuns).toHaveBeenCalledTimes(3);
  });
});
