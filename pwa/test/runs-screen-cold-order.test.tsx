// Child-reclamation wave 6, fix round 1 (review 335 F11; spec §5.9): the archive hook's
// read (`useColdRuns`; the board left it in Task 12a, D-8074) has ONE source for a finished row's reclaim chip, and since this
// wave a reclaim puts two reads in flight a tick or two apart (the vanish read
// of wave 5, and the coord frame's second trigger). When the older read
// resolves last it must not overwrite the newer one: the row would show the
// stale "workspace pending" chip, the very symptom the wave exists to fix.
// `loadCold` keeps a high-water mark: only a read NEWER than the last one
// applied may set `cold`, and a rejection older than that is dropped too.
//
// Every read here is a deferred the test settles by hand, in the order it names.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ChildReclaimStatus, CoordStatus, RunSummary } from '../../shared/api';
import { useColdRuns } from '../src/screens/useColdRuns';
import { ApiTimeout } from '../src/lib/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'build4-transcript-surface', programTitle: 'Build 4: transcript surface',
  wave: 3, waveOf: 4, project: 'ccrc-pwa', homeProject: null,
  sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
  state: 'working', kind: 'work', reviews: null,
  claimedBy: 'ccrc-pwa-coordinator', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
});
const finished = (word: ChildReclaimStatus['word']): RunSummary =>
  run({ id: 7, state: 'done', closedAt: Date.now() - 60_000, childReclaim: { word, sentence: null, at: null } });

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

const T = 1_758_500_000_000;
const coordAt = (doneAt: number): CoordStatus =>
  ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], childReclaimDoneAt: doneAt });

/** One archive read the test settles by hand. */
interface Read { resolve(rows: RunSummary[]): Promise<void>; reject(): Promise<void> }

/** A board whose first read (the mount read) has landed with the row PENDING, and
 *  whose next two reads are in flight: `older` was fired by the first change of
 *  the newest reclaim end, `newer` by the second. Neither has answered. */
let hook: { current: ReturnType<typeof useColdRuns> };
const boardWithTwoReadsInFlight = async () => {
  const store = makeStore();
  act(() => { store.setState({ runs: [], runsFrameSeen: true, sessions: [], fleetFrameSeen: true,
    coord: coordAt(T), coordFrameSeen: true }); });
  const reads: Read[] = [];
  const loadRuns = vi.fn((): Promise<{ runs: RunSummary[] }> => new Promise((res, rej) => {
    reads.push({
      resolve: async (rows) => { await act(async () => { res({ runs: rows }); }); },
      reject: async () => { await act(async () => { rej(new Error('network')); }); },
    });
  }));
  hook = renderHook(() => useColdRuns(store, loadRuns)).result;
  await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(1));
  await reads[0]!.resolve([finished('pending')]);
  await waitFor(() => expect(hook.current.cold).not.toBeNull());
  act(() => { store.setState({ coord: coordAt(T + 1) }); });
  await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2));
  act(() => { store.setState({ coord: coordAt(T + 2) }); });
  await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(3));
  return { older: reads[1]!, newer: reads[2]! };
};
const chipWord = (): string | null => hook.current.cold?.[0]?.childReclaim?.word ?? null;
const errorShown = (): boolean => hook.current.state === 'error';

describe('useColdRuns: the archive read is a high-water mark (spec §5.9)', () => {
  it('the NEWER read lands first with the row reclaimed, the stale one last with it pending: reclaimed stays', async () => {
    const { older, newer } = await boardWithTwoReadsInFlight();
    expect(chipWord(), 'before either read lands').toBe('pending');
    await newer.resolve([finished('reclaimed')]);
    expect(chipWord()).toBe('reclaimed');
    await older.resolve([finished('pending')]);
    expect(chipWord(), 'the stale read overwrote the newer one').toBe('reclaimed');
  });

  it('control: in-order resolution shows the newest reading', async () => {
    const { older, newer } = await boardWithTwoReadsInFlight();
    await older.resolve([finished('pending')]);
    expect(chipWord()).toBe('pending');
    await newer.resolve([finished('reclaimed')]);
    expect(chipWord()).toBe('reclaimed');
  });

  it('a stale REJECTION arriving after the newer success does not show the error state', async () => {
    const { older, newer } = await boardWithTwoReadsInFlight();
    await newer.resolve([]);                                   // an answered, empty archive
    expect(hook.current.state).toBe('ok');
    await older.reject();
    expect(errorShown(), 'a read older than the applied one set the error state').toBe(false);
    expect(hook.current.state).toBe('ok');
  });

  it('an OLDER rejection arriving first does not stop the newer success from landing', async () => {
    const { older, newer } = await boardWithTwoReadsInFlight();
    await older.reject();
    await newer.resolve([]);
    expect(errorShown()).toBe(false);
    expect(hook.current.state).toBe('ok');
  });

  it('the chosen reading: a rejection advances nothing, so an older success after a newer failure still lands', async () => {
    // A rejection carries no reading to be "newer" than, so only a success moves the mark. The
    // newest read failed, the older one answered, and the older answer is the freshest one there is.
    const { older, newer } = await boardWithTwoReadsInFlight();
    await newer.reject();
    expect(errorShown()).toBe(true);
    await older.resolve([finished('reclaimed')]);
    expect(chipWord()).toBe('reclaimed');
    expect(errorShown(), 'the older rows may land, but may not clear the newer failure').toBe(true);
  });

  // Desktop-polish Task C14, D-8110, review 1606 F2: re-homed from runs-arrival after #2478 removed the not-loaded line.
  // Read the hook's two failure signals directly: an older success applies its rows but clears neither state nor timedOut.
  // D-8074 removed the paged arm (Task 12a); the guard holds on the one read that remains, so these run unpaged.
  it.each([
    { kind: 'timeout', error: new ApiTimeout('/api/runs', 8_000), timedOut: true },
    { kind: 'network', error: new Error('read failed'), timedOut: false },
  ])('a newer $kind failure holds both failure signals after an older success', async ({ error, timedOut }) => {
    const store = makeStore();
    const reads: { resolve(rows: RunSummary[]): Promise<void>; reject(error: Error): Promise<void> }[] = [];
    const loadRuns = vi.fn(() => new Promise<{ runs: RunSummary[] }>((resolve, reject) => {
      reads.push({
        resolve: async (rows) => { await act(async () => { resolve({ runs: rows }); }); },
        reject: async (error) => { await act(async () => { reject(error); }); },
      });
    }));
    const { result } = renderHook(() => useColdRuns(store, loadRuns, { rereadOnTransitions: false }));
    await waitFor(() => expect(reads).toHaveLength(1));
    act(() => { void result.current.reload(); });
    expect(reads).toHaveLength(2);
    await reads[1]!.reject(error);
    expect(result.current.state).toBe('error');
    expect(result.current.timedOut).toBe(timedOut);
    expect(result.current.reading).toBe(false);
    const rows = [finished('reclaimed')];
    await reads[0]!.resolve(rows);
    expect(result.current.cold).toEqual(rows);
    expect(result.current.state).toBe('error');
    expect(result.current.timedOut).toBe(timedOut);
    expect(result.current.reading).toBe(false);
    // Only a read issued after the settled failure may clear its signals.
    act(() => { void result.current.reload(); });
    await reads[2]!.resolve([]);
    expect(result.current.state).toBe('ok');
    expect(result.current.timedOut).toBe(false);
  });

  // Review 1689 F1 (C14 fix round 1, D-8110): dropping the newest-failure guard must flip both rows' timedOut.
  it.each([
    { kind: 'timeout', newer: new ApiTimeout('/api/runs', 8_000), older: new Error('read failed'), timedOut: true },
    { kind: 'network', newer: new Error('read failed'), older: new ApiTimeout('/api/runs', 8_000), timedOut: false },
  ])('a newer $kind failure keeps its timeout signal after an older failure settles', async ({ newer, older, timedOut }) => {
    const store = makeStore();
    const reads: { reject(error: Error): Promise<void> }[] = [];
    const loadRuns = vi.fn(() => new Promise<{ runs: RunSummary[] }>((_resolve, reject) => {
      reads.push({ reject: async (error) => { await act(async () => { reject(error); }); } });
    }));
    const { result } = renderHook(() => useColdRuns(store, loadRuns, { rereadOnTransitions: false }));
    await waitFor(() => expect(reads).toHaveLength(1));
    act(() => { void result.current.reload(); });
    expect(reads).toHaveLength(2);
    await reads[1]!.reject(newer);
    expect(result.current.state).toBe('error');
    expect(result.current.timedOut).toBe(timedOut);
    expect(result.current.reading).toBe(false);
    await reads[0]!.reject(older);
    expect(result.current.state).toBe('error');
    expect(result.current.timedOut).toBe(timedOut);
    expect(result.current.reading).toBe(false);
  });

  it('a success whose body cannot be read is an error, not a silent drop: the mark moves only after the read', async () => {
    // No frame has landed, so the board knows nothing and shows the error state when the read fails.
    // A `null` answer throws when the body is read. If the mark had already moved to this read, the
    // `catch` would see a read that is no longer newer than the mark and drop the failure, leaving
    // the board on "Loading…" for good.
    const store = makeStore();
    const loadRuns = vi.fn(async () => null as unknown as { runs: RunSummary[] });
    const view = renderHook(() => useColdRuns(store, loadRuns));
    await waitFor(() => expect(view.result.current.state).toBe('error'));
  });
});
