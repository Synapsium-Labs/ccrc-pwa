// Console speed S2: the run archive in pages. `useColdRuns(store, loader, { page })` asks a PAGED loader
// (`(limit, before?) => RunsPageAnswer`), appends older pages on `loadOlder()`, and keeps the pages in the fleet
// store (`runPages`, memory only) so a second mount draws them at once. The loader is a fake here: the real paged
// read is another task's. Fake timers, so no wall-clock wait decides a count.
import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { RunsPageAnswer, RunSummary } from '../../shared/api';
import { useColdRuns, type PagedLoader } from '../src/screens/useColdRuns';
import { MailScreen } from '../src/screens/MailScreen';
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
const closed = (id: number, over: Partial<RunSummary> = {}): RunSummary => run(id, { state: 'done', closedAt: T - 60_000, ...over });

/** A fake archive: `terminal` ids (closed runs) and `active` ids, answering the paged read the way the server does
 *  (every active run, the newest `limit` closed runs below `before`, ids ascending, `nextBefore` iff older remain). */
function archive(terminal: number[], active: number[] = []): { load: Mock<PagedLoader>; set(t: number[], a?: number[]): void } {
  let term = [...terminal];
  let act_ = [...active];
  const load = vi.fn<PagedLoader>(async (limit, before) => {
    const eligible = term.filter((id) => before === undefined || id < before).sort((a, b) => b - a);
    const page = eligible.slice(0, limit);
    const rows = [...act_.map((id) => run(id)), ...page.map((id) => closed(id))].sort((a, b) => a.id - b.id);
    return eligible.length > limit ? { runs: rows, nextBefore: page[page.length - 1]! } : { runs: rows };
  });
  return { load, set(t, a = act_) { term = [...t]; act_ = [...a]; } };
}

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const ids = (rows: RunSummary[] | null): number[] => (rows ?? []).map((r) => r.id);
const range = (hi: number, lo: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the run archive in pages', () => {
  // The brief's first row names RunsScreen; its switch to the paged read waits for the paged `api` read, so this row
  // pins the hook the screen will pass `page: 50` to.
  it('RunsScreen asks for limit 50 (the hook asks limit 50 when given page 50, and no before)', async () => {
    const a = archive(range(120, 1), [130]);
    const store = makeStore();
    const { result } = renderHook(() => useColdRuns(store, a.load, { page: 50 }));
    await flush();
    expect(a.load).toHaveBeenCalledTimes(1);
    expect(a.load).toHaveBeenCalledWith(50);
    expect(result.current.state).toBe('ok');
    expect(ids(result.current.cold)).toEqual([...range(120, 71).reverse(), 130]);
    expect(result.current.hasOlder).toBe(true);
  });

  it('Show older appends the next page', async () => {
    const a = archive(range(120, 1), [130]);
    const store = makeStore();
    const { result } = renderHook(() => useColdRuns(store, a.load, { page: 50 }));
    await flush();
    await act(async () => { await result.current.loadOlder(); });
    expect(a.load).toHaveBeenLastCalledWith(50, 71);
    expect(ids(result.current.cold)).toEqual([...range(120, 21).reverse(), 130]);
    expect(result.current.hasOlder).toBe(true);
    await act(async () => { await result.current.loadOlder(); });
    expect(a.load).toHaveBeenLastCalledWith(50, 21);
    expect(new Set(ids(result.current.cold)).size).toBe(121);       // every closed run once, plus the active one
    expect(result.current.hasOlder).toBe(false);
    const calls = a.load.mock.calls.length;
    await act(async () => { await result.current.loadOlder(); });   // nothing older: no read
    expect(a.load.mock.calls.length).toBe(calls);
  });

  it('a second mount draws the stored pages before the read returns', async () => {
    const a = archive(range(120, 1));
    const store = makeStore();
    const first = renderHook(() => useColdRuns(store, a.load, { page: 50 }));
    await flush();
    await act(async () => { await first.result.current.loadOlder(); });
    first.unmount();
    const held: { release(): void } = { release() {} };
    const slow = vi.fn<PagedLoader>((limit, before) => new Promise<RunsPageAnswer>((resolve) => {
      held.release = () => { void a.load(limit, before).then(resolve); };
    }));
    const second = renderHook(() => useColdRuns(store, slow, { page: 50 }));
    // The read has NOT returned: the stored pages are already drawn, state `ok`.
    expect(slow).toHaveBeenCalledTimes(1);
    expect(second.result.current.state).toBe('ok');
    expect(second.result.current.cold).toHaveLength(100);
    expect(second.result.current.hasOlder).toBe(true);
    await act(async () => { held.release(); await vi.advanceTimersByTimeAsync(0); });
    expect(second.result.current.cold).toHaveLength(100);           // the re-read kept the older page
  });

  it('a re-read keeps the older pages', async () => {
    const a = archive(range(120, 1));
    const store = makeStore();
    const { result } = renderHook(() => useColdRuns(store, a.load, { page: 50 }));
    await flush();
    await act(async () => { await result.current.loadOlder(); });
    a.set(range(122, 1));                                           // two more runs closed since
    await act(async () => { await result.current.reload(); });
    expect(a.load).toHaveBeenLastCalledWith(50);
    expect(ids(result.current.cold).sort((x, y) => y - x)).toEqual(range(122, 21));
    expect(result.current.hasOlder).toBe(true);
    expect(store.getState().runPages?.nextBefore).toBe(21);
  });

  it('a re-read replaces the rows its page covers, and drops an active run that has closed', async () => {
    const a = archive(range(60, 1), [70]);
    const store = makeStore();
    const { result } = renderHook(() => useColdRuns(store, a.load, { page: 50 }));
    await flush();
    await act(async () => { await result.current.loadOlder(); });
    a.set(range(70, 1), []);                                        // run 70 closed
    await act(async () => { await result.current.reload(); });
    const row70 = (result.current.cold ?? []).filter((r) => r.id === 70);
    expect(row70).toHaveLength(1);
    expect(row70[0]!.state).toBe('done');
    expect(result.current.cold).toHaveLength(70);
  });

  it('a failed re-read keeps the stored pages and shows the error', async () => {
    const a = archive(range(120, 1));
    const store = makeStore();
    const { result } = renderHook(() => useColdRuns(store, a.load, { page: 50 }));
    await flush();
    await act(async () => { await result.current.loadOlder(); });
    const before = ids(result.current.cold);
    a.load.mockRejectedValueOnce(new Error('down'));
    await act(async () => { await result.current.reload(); });
    expect(result.current.state).toBe('error');
    expect(ids(result.current.cold)).toEqual(before);               // rows still drawn, never folded to empty
    expect(store.getState().runPages?.runs).toHaveLength(100);
    await act(async () => { await result.current.reload(); });      // the next good read clears it
    expect(result.current.state).toBe('ok');
  });

  it('MailScreen still reads the full archive', async () => {
    const loadRuns = vi.fn(async (): Promise<{ runs: RunSummary[] }> => ({ runs: [closed(1)] }));
    const store = makeStore();
    store.setState({ refreshFeed: async () => 'ok' as const });
    render(<MailScreen store={store} loadRuns={loadRuns} />);
    await flush();
    expect(loadRuns).toHaveBeenCalledTimes(1);
    expect(loadRuns).toHaveBeenCalledWith();                        // no limit, no before: today's full answer
    expect(store.getState().runPages).toBeNull();                   // and it leaves the pages alone
    const plain = renderHook(() => useColdRuns(store, loadRuns));
    await flush();
    expect(plain.result.current.hasOlder).toBe(false);
  });
});
