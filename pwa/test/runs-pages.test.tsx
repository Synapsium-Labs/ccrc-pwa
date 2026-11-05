// Console speed S2: the run archive in pages. `useColdRuns(store, loader, { page })` asks a PAGED loader
// (`(limit, before?) => RunsPageAnswer`), appends older pages on `loadOlder()`, and keeps the pages in the fleet
// store (`runPages`, memory only) so a second mount draws them at once. The loader is a fake here: the real paged
// read is another task's. Fake timers, so no wall-clock wait decides a count.
import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { RunsPageAnswer, RunSummary } from '../../shared/api';
import { useColdRuns, type OlderOutcome, type PagedLoader } from '../src/screens/useColdRuns';
import { appendOlderRunPage, mergeFirstRunPage } from '../src/fleet/runWords';
import { MailScreen } from '../src/screens/MailScreen';
import { RunsScreen } from '../src/screens/RunsScreen';
import { api } from '../src/lib/api';
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
const NO_CAPS = (): Promise<never> => new Promise(() => {});
const NO_SPEND = (): Promise<never> => new Promise(() => {});
/** The Finished fold's door ("Show N more finished runs"), or null once every loaded row is shown. */
const foldDoor = (): HTMLElement | null => screen.queryByRole('button', { name: /more finished run/i });
const unfold = (): void => {
  // Bounded: a door that never goes away is a failing test, not a hang.
  for (let n = 0, door = foldDoor(); door !== null; door = foldDoor(), n++) {
    if (n >= 20) throw new Error('the Finished fold door is still there after 20 taps');
    fireEvent.click(door);
  }
};
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const ids = (rows: RunSummary[] | null): number[] => (rows ?? []).map((r) => r.id);
const range = (hi: number, lo: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the run archive in pages', () => {
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

  it('RunsScreen asks for limit 50', async () => {
    // The screen's own default reader: the paged `api` read, limit 50 and no `before` on the first ask.
    const spy = vi.spyOn(api, 'runsPage').mockImplementation(async () => ({ runs: [closed(3)] }));
    render(<RunsScreen store={makeStore()} loadCaps={NO_CAPS} loadSpend={NO_SPEND} />);
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(50, null);
    // And an injected loader is asked the same way: limit 50, no `before`.
    const a = archive(range(120, 1), [130]);
    cleanup();
    render(<RunsScreen store={makeStore()} loadRuns={a.load} loadCaps={NO_CAPS} loadSpend={NO_SPEND} />);
    await flush();
    expect(a.load).toHaveBeenCalledTimes(1);
    expect(a.load).toHaveBeenCalledWith(50);
  });

  it('Show older appears only while older runs remain', async () => {
    const a = archive(range(120, 1), [130]);
    render(<RunsScreen store={makeStore()} loadRuns={a.load} loadCaps={NO_CAPS} loadSpend={NO_SPEND} />);
    await flush();
    unfold();
    const button = screen.getByRole('button', { name: 'Show older' });
    expect(button).not.toBeDisabled();
    // One tap asks the next page (before = the oldest id of page one) and the control is disabled while it is on its way.
    let release: () => void = () => {};
    a.load.mockImplementationOnce((limit, before) => new Promise<RunsPageAnswer>((resolve) => {
      release = () => { void archive(range(120, 1), [130]).load(limit, before).then(resolve); };
    }));
    fireEvent.click(button);
    expect(a.load).toHaveBeenLastCalledWith(50, 71);
    expect(screen.getByRole('button', { name: 'Show older' })).toBeDisabled();
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    // The second page (21..70) leaves 20 runs older: still offered once the fold shows the new rows. The third reaches the end: gone.
    unfold();
    expect(screen.getByRole('button', { name: 'Show older' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(a.load).toHaveBeenLastCalledWith(50, 21);
    unfold();
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
  });

  it('Show older appears only after the fold is exhausted', async () => {
    const a = archive(range(120, 1));
    render(<RunsScreen store={makeStore()} loadRuns={a.load} loadCaps={NO_CAPS} loadSpend={NO_SPEND} />);
    await flush();
    // 50 rows are loaded, FINISHED_FOLD (20) are shown: the other 30 sit behind the fold door, and a tap that loaded 50 more
    // below the fold would change nothing visible.
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
    fireEvent.click(foldDoor()!);                                   // 40 shown of 50
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
    fireEvent.click(foldDoor()!);                                   // all 50 shown: the fold is exhausted
    expect(foldDoor()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(a.load).toHaveBeenLastCalledWith(50, 71);
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();   // the new rows are folded again
    expect(foldDoor()).not.toBeNull();
  });

  it('a failed Show older says so and keeps the rows', async () => {
    const a = archive(range(120, 1));
    const { container } = render(<RunsScreen store={makeStore()} loadRuns={a.load} loadCaps={NO_CAPS} loadSpend={NO_SPEND} />);
    await flush();
    unfold();
    expect(screen.queryByText('Could not load older runs.')).toBeNull();
    const rows = (): number => container.querySelectorAll('.runs-list > li').length;
    const before = rows();
    expect(before).toBe(50);
    a.load.mockRejectedValueOnce(new Error('down'));
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(screen.getByText('Could not load older runs.')).toBeInTheDocument();
    expect(rows()).toBe(before);
    expect(screen.getByRole('button', { name: 'Show older' })).not.toBeDisabled();
    // A second failure keeps the line.
    a.load.mockRejectedValueOnce(new Error('down'));
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(screen.getByText('Could not load older runs.')).toBeInTheDocument();
    // The retry succeeds: the line is gone while the Show older block is still mounted (20 runs remain older).
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    unfold();
    expect(rows()).toBe(100);
    expect(screen.getByRole('button', { name: 'Show older' })).toBeInTheDocument();
    expect(screen.queryByText('Could not load older runs.')).toBeNull();
  });

  it('a re-read during Show older shows no failure line', async () => {
    const a = archive(range(120, 1), [130]);
    const store = makeStore();
    store.setState({ runs: [run(130)], runsFrameSeen: true });
    render(<RunsScreen store={store} loadRuns={a.load} loadCaps={NO_CAPS} loadSpend={NO_SPEND} />);
    await flush();
    unfold();
    let release: () => void = () => {};
    a.load.mockImplementationOnce((limit, before) => new Promise<RunsPageAnswer>((resolve) => {
      release = () => { void archive(range(120, 1), [130]).load(limit, before).then(resolve); };
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(a.load).toHaveBeenLastCalledWith(50, 71);
    // Run 130 leaves the live frame: the board re-reads page one, issued AFTER the older page began.
    act(() => { store.setState({ runs: [] }); });
    await flush();
    expect(a.load).toHaveBeenLastCalledWith(50);
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    // The late older page was dropped as stale: nothing failed, and the next tap asks again.
    expect(store.getState().runPages?.nextBefore).toBe(71);
    expect(screen.queryByText('Could not load older runs.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show older' })).not.toBeDisabled();
  });

  it('a good re-read clears the failure line', async () => {
    const a = archive(range(120, 1), [130]);
    const store = makeStore();
    store.setState({ runs: [run(130)], runsFrameSeen: true });
    render(<RunsScreen store={store} loadRuns={a.load} loadCaps={NO_CAPS} loadSpend={NO_SPEND} />);
    await flush();
    unfold();
    a.load.mockRejectedValueOnce(new Error('down'));
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(screen.getByText('Could not load older runs.')).toBeInTheDocument();
    act(() => { store.setState({ runs: [] }); });                   // a re-read, which answers
    await flush();
    expect(screen.getByRole('button', { name: 'Show older' })).toBeInTheDocument();   // the block is still mounted
    expect(screen.queryByText('Could not load older runs.')).toBeNull();
  });

  it('Show older is absent when the archive fits one page', async () => {
    const a = archive(range(30, 1));
    render(<RunsScreen store={makeStore()} loadRuns={a.load} loadCaps={NO_CAPS} loadSpend={NO_SPEND} />);
    await flush();
    unfold();
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
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

  it('an old run that closes stays on the board', async () => {
    // The server's page one carries a terminal run whose `closedAt` is at or after the page's oldest `closedAt`, however
    // old its id (console speed S2, final review I1). The fake loader answers that way: run 30 is active at the mount,
    // closes after runs 100..149, and rides page one as an extra.
    let activeOld = true;
    const load = vi.fn<PagedLoader>(async (limit, before) => {
      const pageIds = range(149, 100).slice(0, limit);
      const old = activeOld ? run(30) : closed(30, { closedAt: T });
      const rows = before === undefined
        ? [old, ...pageIds.map((id) => closed(id))].sort((a, b) => a.id - b.id)
        : [];
      return { runs: rows, nextBefore: 100 };
    });
    const store = makeStore();
    const { result } = renderHook(() => useColdRuns(store, load, { page: 50 }));
    await flush();
    expect(result.current.cold?.find((r) => r.id === 30)?.state).toBe('working');
    activeOld = false;                                              // run 30 closes, after 50 newer runs closed
    await act(async () => { await result.current.reload(); });
    const thirty = (result.current.cold ?? []).filter((r) => r.id === 30);
    expect(thirty).toHaveLength(1);
    expect(thirty[0]!.state).toBe('done');
    expect(result.current.hasOlder).toBe(true);
    expect(store.getState().runPages?.nextBefore).toBe(100);
    // A later re-read that no longer carries it keeps the closed copy the operator already holds.
    load.mockImplementation(async (limit) => ({ runs: range(149, 100).slice(0, limit).reverse().map((id) => closed(id)), nextBefore: 100 }));
    await act(async () => { await result.current.reload(); });
    expect((result.current.cold ?? []).filter((r) => r.id === 30).map((r) => r.state)).toEqual(['done']);
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
    let older: Promise<OlderOutcome> = Promise.resolve('idle');
    act(() => { older = result.current.loadOlder(); });
    a.set(range(130, 1), []);                                       // run 130 closed since
    await act(async () => { await result.current.reload(); });      // the re-read lands first
    expect(store.getState().runPages?.nextBefore).toBe(71);
    await act(async () => { release(); await older; });
    await expect(older).resolves.toBe('dropped');                   // late, not failed
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
    let older: Promise<OlderOutcome> = Promise.resolve('idle');
    act(() => { reread = result.current.reload(); });               // issued BEFORE Show older begins
    act(() => { older = result.current.loadOlder(); });             // still asks from the stale 40
    expect(a.load).toHaveBeenLastCalledWith(40, 40);
    await act(async () => { gates[0]!(); await reread; });          // the re-read lands first: nextBefore 61
    expect(store.getState().runPages?.nextBefore).toBe(61);
    await act(async () => { gates[1]!(); await older; });           // the page asked from 40 is refused
    await expect(older).resolves.toBe('dropped');
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
    let outcome: OlderOutcome = 'idle';
    await act(async () => { outcome = await result.current.loadOlder(); });
    expect(outcome).toBe('failed');
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
