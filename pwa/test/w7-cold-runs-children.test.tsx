// The archive reads `useColdRuns` makes for a finished run that had a child, pinned before C7d (D-7179; Task C7a; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 3). The board used to gather that answer itself, for its
// own life, from fleet marks and cold chips (D-7214). The server says it now (`RunSummary.hadChild`, D-8068), and these
// rows keep what that memory protected, plus the case it could not: a board that loads after the child has gone.
// `RunSummary.childIds` names only OPEN runs with a bound worker, so it never names a closed run; these rows are what a
// reader keyed on it would lose. Each row pins the `loadRuns` calls, under fake timers (no wall-clock wait decides a count).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ChildReclaimStatus, CoordStatus, FleetSession, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { useColdRuns } from '../src/screens/useColdRuns';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

const T = 1_784_500_000_000;

const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: 'program-a', programTitle: 'Program A', wave: 1, waveOf: 3, project: 'project-a', homeProject: null,
  sessionId: 'session-a', workspace: 'ws-a', branch: 'ws/ws-a', state: 'working', kind: 'work', reviews: null,
  claimedBy: 'coord-a', resumed: false, clearedAt: null, openedAt: T - 1_000_000, dispatchStartedAt: null, dispatchedAt: T - 900_000,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false, ...over,
});
const finished = (id: number, word: ChildReclaimStatus['word'] | null, over: Partial<RunSummary> = {}): RunSummary =>
  run(id, { state: 'done', closedAt: T - 60_000, childReclaim: word === null ? null : { word, sentence: null, at: null }, ...over });
const hadChild = { hadChild: true };
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

describe('useColdRuns: a finished run that had a child, and the reads it triggers (D-8068)', () => {
  it('the race row: finished run 7, no live runs, its child leaves the fleet; a coord-frame reclaim end re-reads (two loadRuns calls)', async () => {
    const { store, loadRuns } = await mount([finished(7, null, hadChild)], [child(7)]);
    expect(loadRuns).toHaveBeenCalledTimes(1);
    await fleetFrame(store, []);                    // the vanish: no chip, so wave 5 stays quiet
    expect(loadRuns).toHaveBeenCalledTimes(1);
    await coordFrame(store, T + 1);                 // wave 6's trigger: the run had a child
    expect(loadRuns).toHaveBeenCalledTimes(2);
    await coordFrame(store, T + 1);                 // the same value again: no read
    expect(loadRuns).toHaveBeenCalledTimes(2);
  });

  it('the resumed-child row: a child whose mark names run 1 while its binding names run 5; both finished rows are re-read for', async () => {
    const resumed = child(1, { run: { id: 5, state: 'working', claimedBy: 'coord-a' }, openRun: { id: 5, state: 'working', claimedBy: 'coord-a' } });
    for (const id of [1, 5]) {
      const { store, loadRuns } = await mount([finished(id, null, hadChild)], [resumed]);
      await coordFrame(store, T + 1);
      expect(loadRuns, `run ${id}`).toHaveBeenCalledTimes(2);
      cleanup();
    }
  });

  it('the board-mounted-after-close row: the board mounts after run 7 closed, with the child still listed', async () => {
    const { store, loadRuns } = await mount([finished(7, null, hadChild)], [child(7)]);
    expect(loadRuns).toHaveBeenCalledTimes(1);
    await coordFrame(store, T + 1);
    expect(loadRuns).toHaveBeenCalledTimes(2);
  });

  it('the reload row: a board mounted after the child left, which no fleet frame ever told, still re-reads', async () => {
    const { store, loadRuns } = await mount([finished(7, null, hadChild)], []);
    await coordFrame(store, T + 1);
    expect(loadRuns).toHaveBeenCalledTimes(2);
  });

  it('a finished run the server says had no child is not re-read, whatever a fleet frame marks', async () => {
    const nobody = await mount([finished(7, null)], [fleetSession({ id: 'session-b', project: 'project-a' })]);
    await coordFrame(nobody.store, T + 1);
    expect(nobody.loadRuns).toHaveBeenCalledTimes(1);
    cleanup();
    const marked = await mount([finished(7, null)], [child(7)]);
    await coordFrame(marked.store, T + 1);
    expect(marked.loadRuns, 'the board reads no mark now').toHaveBeenCalledTimes(1);
  });

  it('the skew row: childIds absent or present, the re-reads are the same (the reader never reads childIds)', async () => {
    const counts: number[] = [];
    for (const childIds of [undefined, [7], []] as const) {
      const rows = [finished(7, null, { ...hadChild, ...(childIds === undefined ? {} : { childIds }) })];
      const { store, loadRuns } = await mount(rows, [child(7)]);
      await fleetFrame(store, []);
      await coordFrame(store, T + 1);
      counts.push(loadRuns.mock.calls.length);
      cleanup();
    }
    expect(counts).toEqual([2, 2, 2]);
  });

  it('the older-server row: a row with no hadChild key asks no read of its own, and the chip triggers still fire', async () => {
    const { hadChild: _gone, ...bare } = finished(7, null);
    const chipless = await mount([bare as RunSummary], [child(7)]);
    await coordFrame(chipless.store, T + 1);
    expect(chipless.loadRuns).toHaveBeenCalledTimes(1);
    cleanup();
    const { hadChild: _also, ...pending } = finished(7, 'pending');
    const chipped = await mount([pending as RunSummary], [child(7)]);
    await coordFrame(chipped.store, T + 1);
    expect(chipped.loadRuns).toHaveBeenCalledTimes(2);
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
