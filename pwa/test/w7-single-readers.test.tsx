// W7 Task C7n's single readers (D-7192, D-7209; ARCH-75; plan docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md).
// The fleet store owns the one `GET /api/feed` read: `refreshFeed()` is its on-demand door, beside `refreshAccounts()`,
// and the connect-time durable read goes through the same reader. `useColdRuns` keeps its three transition re-reads
// by default and drops them when a caller asks for once-per-mount.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { CoordStatus, FleetSession, NotifyEvent, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { createFleetStore, type FleetStore, type FleetStoreDeps } from '../src/stores/fleet';
import { useColdRuns } from '../src/screens/useColdRuns';
import { api } from '../src/lib/api';

/** A socket that never opens, so `connect()` is driven by hand through its `onopen`. */
interface FakeSocket { onopen: (() => void) | null; onmessage: unknown; onclose: unknown; onerror: unknown; close(): void }
const sockets: FakeSocket[] = [];
const makeStore = (deps: FleetStoreDeps = {}): FleetStore => createFleetStore({
  makeSocket: () => {
    const s: FakeSocket = { onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} };
    sockets.push(s);
    return s as unknown as WebSocket;
  },
  catchUp: async () => ({ epoch: 'epoch-a', seq: 0, events: [] }) as never,
  ...deps,
});
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };

const event = (seq: number): NotifyEvent => ({ seq, at: 1_784_500_000_000, kind: 'mail', sessionId: 'session-a', title: 'a finding', body: 'a record', runId: null });

beforeEach(() => { vi.useFakeTimers(); sockets.length = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('refreshFeed(): the store\'s one feed reader, on demand', () => {
  it('one request per call, limit 100, through the injected reader', async () => {
    const fetchFeed = vi.fn(async (_limit: number) => ({ events: [] as NotifyEvent[] }));
    const store = makeStore({ fetchFeed });
    await store.getState().refreshFeed();
    expect(fetchFeed.mock.calls).toEqual([[100]]);
    await store.getState().refreshFeed();
    expect(fetchFeed.mock.calls).toEqual([[100], [100]]);
  });

  it('the default reader is api.feed(100)', async () => {
    const feed = vi.spyOn(api, 'feed').mockResolvedValue({ events: [] } as never);
    await makeStore().getState().refreshFeed();
    expect(feed.mock.calls).toEqual([[100]]);
  });

  it('the answer is merged through mergeFeed, its dropped count included, and resolves ok', async () => {
    const unreadable = { seq: 9, at: 1, kind: 'mail' } as unknown as NotifyEvent;   // no title: not revivable
    const store = makeStore({ fetchFeed: async () => ({ events: [event(2), event(1), unreadable] }) });
    await expect(store.getState().refreshFeed()).resolves.toBe('ok');
    expect(store.getState().feed.map((e) => e.seq)).toEqual([1, 2]);
    expect(store.getState().feedDropped).toBe(1);
  });

  it('a rejected read resolves error and writes nothing', async () => {
    const store = makeStore({ fetchFeed: async () => { throw new Error('down'); } });
    store.getState().mergeFeed([event(1)], 0);
    await expect(store.getState().refreshFeed()).resolves.toBe('error');
    expect(store.getState().feed.map((e) => e.seq)).toEqual([1]);
    expect(store.getState().feedDropped).toBe(0);
  });

  it('the connect-time durable read and refreshFeed share the one reader', async () => {
    const fetchFeed = vi.fn(async (_limit: number) => ({ events: [event(1)] }));
    const store = makeStore({ fetchFeed });
    store.getState().connect();
    act(() => { sockets[0]!.onopen?.(); });
    await flush();
    expect(fetchFeed.mock.calls).toEqual([[100]]);
    expect(store.getState().feed.map((e) => e.seq)).toEqual([1]);
    await store.getState().refreshFeed();
    expect(fetchFeed.mock.calls).toEqual([[100], [100]]);
    store.getState().disconnect();
  });
});

describe('useColdRuns: rereadOnTransitions', () => {
  const coord = (doneAt: number): CoordStatus => ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], childReclaimDoneAt: doneAt });
  const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({ id, program: 'program-a', programTitle: 'Program A', wave: 1, waveOf: 1, project: 'project-a', homeProject: null,
    sessionId: 'session-a', workspace: 'ws-a', branch: null, state: 'working', kind: 'work', reviews: null, claimedBy: 'coord-a', resumed: false, clearedAt: null,
    openedAt: 1, dispatchStartedAt: null, dispatchedAt: 1, closedAt: null, handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
    health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null },
    childReclaim: null, reviewCap: null, ...over });

  /** A finished run whose child's reclaim is still pending, so both reclaim transitions are due a re-read. */
  const finished = run(7, { state: 'done', closedAt: 2, sessionId: 'session-b', childReclaim: { word: 'pending', sentence: null, at: null } });
  const child: FleetSession = fleetSession({ id: 'session-b', project: 'project-a' });

  const drive = async (rereadOnTransitions: boolean | undefined): Promise<number[]> => {
    const loadRuns = vi.fn(async () => ({ runs: [finished] }));
    const store = makeStore();
    act(() => { store.setState({ runs: [run(1)], runsFrameSeen: true, sessions: [child], fleetFrameSeen: true, coord: coord(1), coordFrameSeen: true }); });
    const counts: number[] = [];
    renderHook(() => useColdRuns(store, loadRuns, rereadOnTransitions === undefined ? undefined : { rereadOnTransitions }));
    await flush();
    counts.push(loadRuns.mock.calls.length);                             // the mount read
    act(() => { store.setState({ runs: [] }); });                       // a run leaves the live slice
    await flush();
    counts.push(loadRuns.mock.calls.length);
    act(() => { store.setState({ sessions: [] }); });                   // the child leaves the fleet frame
    await flush();
    counts.push(loadRuns.mock.calls.length);
    act(() => { store.setState({ coord: coord(2), coordFrameSeen: true }); }); // a new reclaim end
    await flush();
    counts.push(loadRuns.mock.calls.length);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });     // no poll
    counts.push(loadRuns.mock.calls.length);
    return counts;
  };

  it('the default (true) reads on mount and on each of the three transitions', async () => {
    expect(await drive(undefined)).toEqual([1, 2, 3, 4, 4]);
  });

  it('true, said aloud, is the default schedule', async () => {
    expect(await drive(true)).toEqual([1, 2, 3, 4, 4]);
  });

  it('false reads on mount only', async () => {
    expect(await drive(false)).toEqual([1, 1, 1, 1, 1]);
  });
});
