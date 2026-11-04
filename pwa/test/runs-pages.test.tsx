// Console speed S2: the run archive in pages. `useColdRuns(store, loader, { page })` asks a PAGED loader
// (`(limit, before?) => RunsPageAnswer`), appends older pages on `loadOlder()`, and keeps the pages in the fleet
// store (`runPages`, memory only) so a second mount draws them at once. The loader is a fake here: the real paged
// read is another task's. Fake timers, so no wall-clock wait decides a count.
import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { RunsPageAnswer, RunSummary } from '../../shared/api';
import { useColdRuns, type PagedLoader } from '../src/screens/useColdRuns';
import { appendOlderRunPage, mergeFirstRunPage } from '../src/fleet/runWords';
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

  it('a run that closes inside the loaded older pages is fetched again', async () => {
    // Run 60 is active and sits inside the older region already loaded (below page one, above the stored nextBefore).
    const a = archive(range(120, 21).filter((id) => id !== 60), [60]);
    const store = makeStore();
    const { result } = renderHook(() => useColdRuns(store, a.load, { page: 40 }));
    await flush();
    await act(async () => { await result.current.loadOlder(); });
    expect(store.getState().runPages?.nextBefore).toBe(40);
    expect(result.current.cold?.find((r) => r.id === 60)?.state).toBe('working');
    a.set(range(120, 21), []);                                      // run 60 closes; page one is still 120..81
    await act(async () => { await result.current.reload(); });
    // Its fresh closed copy is on no page held, so the row is not lost silently: Show older is offered again from it.
    expect(result.current.hasOlder).toBe(true);
    expect(store.getState().runPages?.nextBefore).toBeGreaterThanOrEqual(61);
    await act(async () => { await result.current.loadOlder(); });
    const sixty = (result.current.cold ?? []).filter((r) => r.id === 60);
    expect(sixty).toHaveLength(1);
    expect(sixty[0]!.state).toBe('done');
    expect(ids(result.current.cold).sort((x, y) => y - x)).toEqual(range(120, 21));
    expect(result.current.hasOlder).toBe(false);
  });

  it('an older page that lands after a re-read does not undo it', async () => {
    const a = archive(range(120, 1), [130]);
    const store = makeStore();
    const { result } = renderHook(() => useColdRuns(store, a.load, { page: 50 }));
    await flush();
    // Show older is asked now, and its answer (read of the old archive, run 130 still active) is held back.
    const stale = await a.load(50, 71);
    let release: () => void = () => {};
    a.load.mockImplementationOnce(() => new Promise<RunsPageAnswer>((resolve) => { release = () => resolve(stale); }));
    let older: Promise<void> = Promise.resolve();
    act(() => { older = result.current.loadOlder(); });
    a.set(range(130, 1), []);                                       // run 130 closed since
    await act(async () => { await result.current.reload(); });      // the re-read lands first
    expect(store.getState().runPages?.nextBefore).toBe(71);
    await act(async () => { release(); await older; });
    const rows = result.current.cold ?? [];
    expect(rows.find((r) => r.id === 130)?.state).toBe('done');     // not undone by the stale active copy
    expect(ids(rows).sort((x, y) => y - x)).toEqual(range(130, 81).concat(range(80, 71)));
    expect(store.getState().runPages?.nextBefore).toBe(71);         // nor its nextBefore overwritten
    expect(result.current.hasOlder).toBe(true);
  });

  it('appendOlderRunPage: held active rows win, and the answer adds only closed rows below the held nextBefore', () => {
    const held = { runs: [closed(90), run(130)], nextBefore: 71 };
    const next = appendOlderRunPage(held, { runs: [run(130, { state: 'done', closedAt: T }), closed(70), closed(75), run(140)], nextBefore: 21 }, 71);
    expect(next.runs.map((r) => [r.id, r.state])).toEqual([[70, 'done'], [90, 'done'], [130, 'working']]);
    expect(next.nextBefore).toBe(21);
  });

  it('a re-read of page one keeps the older pages', () => {
    // Pure: the held view has closed runs 129..21 (page one and the older pages below it) and active 130; nextBefore 21.
    const held = { runs: [...range(130, 21).filter((id) => id !== 130).reverse().map((id) => closed(id)), run(130)], nextBefore: 21 };
    // Two more runs closed since: page one is now 122..73, so ids 72..21 are the older region.
    const next = mergeFirstRunPage(held, { runs: [...range(122, 73).reverse().map((id) => closed(id)), run(130)], nextBefore: 73 });
    expect(next.runs.map((r) => r.id)).toEqual([...range(122, 21).reverse(), 130]);
    expect(next.nextBefore).toBe(21);                               // the older pages' reach is kept
    expect(mergeFirstRunPage(held, { runs: [closed(120), closed(119)] }).nextBefore).toBeNull();  // nothing older remains
    expect(mergeFirstRunPage(null, { runs: [closed(9)], nextBefore: 9 })).toEqual({ runs: [closed(9)], nextBefore: 9 });
  });

  it('an older page never duplicates a run already shown', () => {
    const held = { runs: [closed(80), closed(75), closed(71), run(90)], nextBefore: 71 };
    const next = appendOlderRunPage(held, { runs: [closed(71, { closedAt: T }), closed(70), closed(69), run(90)], nextBefore: 60 }, 71);
    const idsOut = next.runs.map((r) => r.id);
    expect(idsOut).toEqual([69, 70, 71, 75, 80, 90]);
    expect(new Set(idsOut).size).toBe(idsOut.length);
    expect(next.nextBefore).toBe(60);
  });

  it('an older page asked from a superseded nextBefore is refused', () => {
    const held = { runs: [closed(80), closed(61), run(60)], nextBefore: 61 };
    const answer: RunsPageAnswer = { runs: [closed(39), closed(38)], nextBefore: 30 };
    expect(appendOlderRunPage(held, answer, 40)).toBe(held);        // asked from 40; the board now asks from 61
    expect(appendOlderRunPage(held, answer, 61)).not.toBe(held);    // the question it does ask is answered
    expect(appendOlderRunPage({ runs: [closed(80)], nextBefore: null }, answer, 40).runs.map((r) => r.id)).toEqual([80]);
  });

  it('a re-read that lands while Show older is in flight keeps its nextBefore', async () => {
    const a = archive(range(120, 21).filter((id) => id !== 60), [60]);
    const store = makeStore();
    const { result } = renderHook(() => useColdRuns(store, a.load, { page: 40 }));
    await flush();
    await act(async () => { await result.current.loadOlder(); });
    expect(store.getState().runPages?.nextBefore).toBe(40);
    // The older page (asked from 40) is read of the archive as it stands now, then run 60 closes.
    const stale = await a.load(40, 40);
    a.set(range(120, 21), []);
    const fresh = await a.load(40);
    const gates: Array<() => void> = [];
    const hold = (answer: RunsPageAnswer) => () => new Promise<RunsPageAnswer>((resolve) => { gates.push(() => resolve(answer)); });
    a.load.mockImplementationOnce(hold(fresh)).mockImplementationOnce(hold(stale));
    let reread: Promise<void> = Promise.resolve();
    let older: Promise<void> = Promise.resolve();
    act(() => { reread = result.current.reload(); });               // issued BEFORE Show older begins
    act(() => { older = result.current.loadOlder(); });             // still asks from the stale 40
    expect(a.load).toHaveBeenLastCalledWith(40, 40);
    await act(async () => { gates[0]!(); await reread; });          // the re-read lands first: nextBefore 61
    expect(store.getState().runPages?.nextBefore).toBe(61);
    await act(async () => { gates[1]!(); await older; });           // the page asked from 40 is refused
    expect(store.getState().runPages?.nextBefore).toBe(61);
    expect(result.current.hasOlder).toBe(true);
    await act(async () => { await result.current.loadOlder(); });   // and run 60 is fetched
    expect(ids(result.current.cold).sort((x, y) => y - x)).toEqual(range(120, 21));
    expect(result.current.cold?.find((r) => r.id === 60)?.state).toBe('done');
    expect(result.current.hasOlder).toBe(false);
  });

  it('a failed re-read stays visible after Show older succeeds', async () => {
    const a = archive(range(120, 1));
    const store = makeStore();
    const { result } = renderHook(() => useColdRuns(store, a.load, { page: 50 }));
    await flush();
    a.load.mockRejectedValueOnce(new Error('down'));
    await act(async () => { await result.current.reload(); });
    expect(result.current.state).toBe('error');
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.cold).toHaveLength(100);                  // the page landed
    expect(result.current.state).toBe('error');                     // only a good re-read clears the error
    await act(async () => { await result.current.reload(); });
    expect(result.current.state).toBe('ok');
  });

  it('a failed Show older shows its error and keeps every row', async () => {
    const a = archive(range(120, 1));
    const store = makeStore();
    const { result } = renderHook(() => useColdRuns(store, a.load, { page: 50 }));
    await flush();
    a.load.mockRejectedValueOnce(new Error('down'));
    await act(async () => { await result.current.loadOlder(); });
    expect(result.current.state).toBe('error');
    expect(result.current.cold).toHaveLength(50);
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
