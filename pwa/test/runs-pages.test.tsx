// The board's Finished group in pages (console speed S2, moved to `GET /api/runs/find` in the runs rebuild, Task 11 and
// Task 12a, D-8073, D-8074): "Show older", its failures, and a re-read that keeps the older pages. The archive is a fake
// paged loader that `runs-board.tsx` answers `find` from. Fake timers, so no wall-clock wait decides a count.
import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RunHit, RunsPageAnswer, RunSummary } from '../../shared/api';
import { RunsScreen } from './runs-board';
import type { FindReader } from '../src/screens/useRunList';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

type PagedLoader = (limit: number, before?: number) => Promise<RunsPageAnswer>;

const T = 1_784_500_000_000;

const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: 'program-a', programTitle: 'Program A', wave: 1, waveOf: 3, project: 'project-a', homeProject: null,
  sessionId: 'session-a', workspace: 'ws-a', branch: 'ws/ws-a', state: 'working', kind: 'work', reviews: null,
  claimedBy: 'coord-a', resumed: false, clearedAt: null, openedAt: T - 1_000_000, dispatchStartedAt: null, dispatchedAt: T - 900_000,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false, ...over,
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

/** A fake `find` over closed runs: the newest `limit` ids below the cursor's `beforeId`, and `next` while older remain. */
function finder(terminal: number[]): { read: Mock<FindReader>; impl: FindReader } {
  const impl: FindReader = async (q) => {
    const limit = q.limit ?? 50;
    const eligible = terminal.filter((id) => q.beforeId === undefined || id < q.beforeId).sort((a, b) => b - a);
    const page = eligible.slice(0, limit);
    return {
      ok: true, exact: null, runs: page.map((id) => closed(id)) as unknown as RunHit[], reviewsOf: [],
      next: eligible.length > limit ? { beforeAt: T - 60_000, beforeId: page[page.length - 1]! } : null,
    };
  };
  return { read: vi.fn<FindReader>(impl), impl };
}

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});
const NO_CAPS = (): Promise<never> => new Promise(() => {});
/** The Finished fold's door ("Show N more finished runs"), or null once every loaded row is shown. */
const foldDoor = (): HTMLElement | null => screen.queryByRole('button', { name: /more finished run/i });
const unfold = (): void => {
  // Bounded: a door that never goes away is a failing test, not a hang.
  for (let n = 0, door = foldDoor(); door !== null; door = foldDoor(), n++) {
    if (n >= 20) throw new Error('the Finished fold door is still there after 20 taps');
    fireEvent.click(door);
  }
};
/** Finished's re-read failure line: newer closes may be missing. */
const REREAD_FAILED = 'Could not reach the server — finished runs may exist that are not shown.';
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const range = (hi: number, lo: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the run archive in pages', () => {
  it('Show older appears only while older runs remain', async () => {
    const a = archive(range(120, 1), [130]);
    const f = finder(range(120, 1));
    render(<RunsScreen store={makeStore()} loadRuns={a.load} loadFinished={f.read} loadCaps={NO_CAPS} />);
    await flush();
    unfold();
    const button = screen.getByRole('button', { name: 'Show older' });
    expect(button).not.toBeDisabled();
    // One tap asks the next page (before = the oldest id of page one) and the control is disabled while it is on its way.
    let release: () => void = () => {};
    f.read.mockImplementationOnce((q) => new Promise((resolve) => { release = () => { void f.impl(q).then(resolve); }; }));
    fireEvent.click(button);
    expect(f.read).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'closed', limit: 50, beforeId: 71 }));
    expect(screen.getByRole('button', { name: 'Show older' })).toBeDisabled();
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    // The second page (21..70) leaves 20 runs older: still offered once the fold shows the new rows. The third reaches the end: gone.
    unfold();
    expect(screen.getByRole('button', { name: 'Show older' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(f.read).toHaveBeenLastCalledWith(expect.objectContaining({ beforeId: 21 }));
    unfold();
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
  });

  it('Show older appears only after the fold is exhausted', async () => {
    const a = archive(range(120, 1));
    const f = finder(range(120, 1));
    render(<RunsScreen store={makeStore()} loadRuns={a.load} loadFinished={f.read} loadCaps={NO_CAPS} />);
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
    expect(f.read).toHaveBeenLastCalledWith(expect.objectContaining({ beforeId: 71 }));
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();   // the new rows are folded again
    expect(foldDoor()).not.toBeNull();
  });

  it('a failed Show older says so and keeps the rows', async () => {
    const a = archive(range(120, 1));
    const f = finder(range(120, 1));
    const { container } = render(<RunsScreen store={makeStore()} loadRuns={a.load} loadFinished={f.read} loadCaps={NO_CAPS} />);
    await flush();
    unfold();
    expect(screen.queryByText('Could not load older runs.')).toBeNull();
    const rows = (): number => container.querySelectorAll('.runs-list > li').length;
    const before = rows();
    expect(before).toBe(50);
    f.read.mockRejectedValueOnce(new Error('down'));
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(screen.getByText('Could not load older runs.')).toBeInTheDocument();
    expect(screen.queryByText(REREAD_FAILED), 'no re-read failed: newer runs are not missing').toBeNull();
    expect(rows()).toBe(before);
    expect(screen.getByRole('button', { name: 'Show older' })).not.toBeDisabled();
    // A second failure keeps the line.
    f.read.mockRejectedValueOnce(new Error('down'));
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
    expect(screen.queryByText(REREAD_FAILED), 'a good retry of Show older leaves no failure line (fix round 2, F3)').toBeNull();
  });

  it('a failed re-read keeps the rows Finished holds and says newer closes may be missing (Step 6; fix round 1)', async () => {
    const a = archive(range(120, 1), [130]);
    const f = finder(range(120, 1));
    const store = makeStore();
    store.setState({ runs: [run(130)], runsFrameSeen: true });
    const { container } = render(<RunsScreen store={store} loadRuns={a.load} loadFinished={f.read} loadCaps={NO_CAPS} />);
    await flush();
    const rows = (): number => container.querySelectorAll('[role="group"][aria-label^="finished"] .runs-list > li').length;
    const drawn = rows();
    expect(drawn, 'the first page draws').toBeGreaterThan(0);
    expect(screen.queryByText(REREAD_FAILED)).toBeNull();
    f.read.mockRejectedValueOnce(new Error('down'));                // run 130 closes: Finished is read again, and the read fails
    act(() => { store.setState({ runs: [] }); });
    await flush();
    expect(screen.getByText(REREAD_FAILED)).toBeInTheDocument();
    expect(rows(), 'the rows held stay').toBe(drawn);
    // Both failed: both lines, two different facts (newer runs missing, older ones missing) (fix round 2, F4).
    unfold();
    f.read.mockRejectedValueOnce(new Error('down'));
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(screen.getByText('Could not load older runs.')).toBeInTheDocument();
    expect(screen.getByText(REREAD_FAILED)).toBeInTheDocument();
  });

  it('a re-read during Show older shows no failure line', async () => {
    const a = archive(range(120, 1), [130]);
    const f = finder(range(120, 1));
    const store = makeStore();
    store.setState({ runs: [run(130)], runsFrameSeen: true });
    render(<RunsScreen store={store} loadRuns={a.load} loadFinished={f.read} loadCaps={NO_CAPS} />);
    await flush();
    unfold();
    let release: () => void = () => {};
    f.read.mockImplementationOnce((q) => new Promise((resolve) => { release = () => { void f.impl(q).then(resolve); }; }));
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(f.read).toHaveBeenLastCalledWith(expect.objectContaining({ beforeId: 71 }));
    // Run 130 leaves the live frame: Finished is read again, issued AFTER the older page began.
    act(() => { store.setState({ runs: [] }); });
    await flush();
    expect(f.read).toHaveBeenLastCalledWith({ scope: 'closed', limit: 50 });
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(0); });
    // The late older page was dropped as stale: nothing failed, and the next tap asks again.
    expect(screen.queryByText('Could not load older runs.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show older' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(f.read, 'the re-read kept the cursor that reaches the older rows').toHaveBeenLastCalledWith(expect.objectContaining({ beforeId: 71 }));
  });

  it('Show older, then a run closes: the older rows stay and the cursor still reaches the rest', async () => {
    const a = archive(range(120, 1), [130]);
    const f = finder(range(120, 1));
    const store = makeStore();
    store.setState({ runs: [run(130)], runsFrameSeen: true });
    const { container } = render(<RunsScreen store={store} loadRuns={a.load} loadFinished={f.read} loadCaps={NO_CAPS} />);
    await flush();
    unfold();
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    unfold();
    const rows = (): number => container.querySelectorAll('[role="group"][aria-label^="finished"] .runs-list > li').length;
    expect(rows()).toBe(100);
    act(() => { store.setState({ runs: [] }); });                   // a run closes: Finished is read again
    await flush();
    unfold();
    expect(rows(), 'the older page the operator loaded stays').toBe(100);
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(f.read).toHaveBeenLastCalledWith(expect.objectContaining({ beforeId: 21 }));
  });

  it('a good re-read leaves the older page\'s failure line; only the next good tap clears it (fix round 2, F3)', async () => {
    const a = archive(range(120, 1), [130]);
    const f = finder(range(120, 1));
    const store = makeStore();
    store.setState({ runs: [run(130)], runsFrameSeen: true });
    render(<RunsScreen store={store} loadRuns={a.load} loadFinished={f.read} loadCaps={NO_CAPS} />);
    await flush();
    unfold();
    f.read.mockRejectedValueOnce(new Error('down'));
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(screen.getByText('Could not load older runs.')).toBeInTheDocument();
    act(() => { store.setState({ runs: [] }); });                   // a re-read, which answers
    await flush();
    expect(screen.getByRole('button', { name: 'Show older' })).toBeInTheDocument();   // the block is still mounted
    expect(screen.getByText('Could not load older runs.'), 'the older pages are still not loaded').toBeInTheDocument();
    expect(screen.queryByText(REREAD_FAILED)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(screen.queryByText('Could not load older runs.')).toBeNull();
  });

  it('Show older is absent when the archive fits one page', async () => {
    const a = archive(range(30, 1));
    render(<RunsScreen store={makeStore()} loadRuns={a.load} loadCaps={NO_CAPS} />);
    await flush();
    unfold();
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
  });

});
