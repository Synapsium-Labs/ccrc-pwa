// The group abandon sheet (D-8074; spec 2026-11-04 §9.2; wave B4 Task 14): the ticked list and its words, the loop's progress and
// Stop, the toast, the part-done list, and the wiring from a Stuck head's control.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RunStuck, RunSummary, StuckCause, StuckReason } from '../../shared/api';
import { ToastHost } from '@ccrc/ui';
import { GroupAbandonSheet } from '../src/fleet/GroupAbandonSheet';
import { ABANDON_CALL_MS, type GroupStanding } from '../src/fleet/groupAbandon';
import { ApiError, ApiTimeout } from '../src/lib/api';
import * as router from '../src/lib/router';
import { RunsScreen } from './runs-board';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

const H = 3_600_000;
const D = 24 * H;
const NOW = Date.now();

beforeEach(() => { try { window.localStorage.clear(); } catch { /* none */ } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: `programme-${id}`, programTitle: `Programme ${id}`, wave: 2, waveOf: 4, project: 'project-a', homeProject: null,
  sessionId: null, workspace: null, branch: null, state: 'planned', kind: 'work', reviews: null,
  claimedBy: 'project-a-coordinator', resumed: false, clearedAt: null, openedAt: NOW - 3 * H, dispatchStartedAt: null,
  dispatchedAt: null, closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
            clearError: null, coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
});
const stuckRun = (id: number, reason: StuckReason, over: Partial<RunSummary> = {}, cause: StuckCause | null = null,
  closes: RunStuck['closes'] = null): RunSummary => run(id, { stuck: { reason, cause, since: NOW - 9 * D, closes }, ...over });

const answered = { released: true };

function mount(runs: RunSummary[], extra: Partial<Parameters<typeof GroupAbandonSheet>[0]> = {}) {
  const onClose = vi.fn(), onDone = vi.fn();
  const abandonRun = vi.fn().mockResolvedValue(answered);
  render(
    <>
      <ToastHost />
      <GroupAbandonSheet reason="overtaken" runs={runs} nowMs={NOW} presence={() => 'alive'} standing={() => 'in-group'}
        onClose={onClose} onDone={onDone} abandonRun={abandonRun} {...extra} />
    </>,
  );
  return { onClose, onDone, abandonRun };
}
const three = (): RunSummary[] => [1, 2, 3].map((i) => stuckRun(i, 'overtaken'));
const rowOf = (id: number): HTMLElement => screen.getByRole('checkbox', { name: new RegExp(`^Run ${id} `) });

describe('the list and its words', () => {
  it('lists every free run ticked, each with its number, name and line, and never a held run', () => {
    mount([...three(), stuckRun(4, 'overtaken', { workspace: 'lane-4', sessionId: 's-4' })]);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    for (const box of screen.getAllByRole('checkbox')) expect(box).toHaveAttribute('aria-checked', 'true');
    expect(rowOf(1)).toHaveTextContent('A later wave moved on 9 days ago · Nothing closes this on its own');
    expect(screen.queryByRole('checkbox', { name: /^Run 4 / })).toBeNull();
    expect(screen.getByText('Abandon 3 runs?')).toBeInTheDocument();
    expect(screen.getByText('Overtaken by later waves')).toBeInTheDocument();
    expect(screen.getByText('Their coordinators are told.')).toBeInTheDocument();
  });

  it('unticking follows in the title and confirm, down to one in the singular, and to none disables Confirm', () => {
    mount(three());
    fireEvent.click(rowOf(3));
    expect(screen.getByText('Abandon 2 runs?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abandon 2 runs' })).toBeEnabled();
    fireEvent.click(rowOf(2));
    expect(screen.getByText('Abandon 1 run?')).toBeInTheDocument();
    expect(screen.getByText('A later wave moved on without this one.')).toBeInTheDocument();
    expect(screen.getByText('It holds no workspace. It is recorded as closed by you.')).toBeInTheDocument();
    expect(screen.getByText('Its coordinator is told.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abandon 1 run' })).toBeEnabled();
    fireEvent.click(rowOf(1));
    expect(screen.getByText('Choose a run to abandon.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abandon' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep them' })).toBeInTheDocument();
    expect(rowOf(1)).toHaveAttribute('aria-checked', 'false');
  });

  it('every coordinator gone leaves the coordinator sentence out, and some gone says Live coordinators', () => {
    cleanup();
    mount(three(), { presence: (r) => (r.id === 1 ? 'dead' : 'alive') });
    expect(screen.getByText('Live coordinators are told.')).toBeInTheDocument();
    cleanup();
    mount(three(), { presence: () => 'dead' });
    expect(screen.queryByText(/coordinators? (is|are) told/)).toBeNull();
  });
});

describe('the run', () => {
  it('abandons only the ticked runs, each call with the limit, and says so in a toast with See them', async () => {
    const { abandonRun, onClose, onDone } = mount(three());
    fireEvent.click(rowOf(2));
    fireEvent.click(screen.getByRole('button', { name: 'Abandon 2 runs' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(abandonRun.mock.calls).toEqual([[1, { timeoutMs: ABANDON_CALL_MS }], [3, { timeoutMs: ABANDON_CALL_MS }]]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('2 runs abandoned.')).toBeInTheDocument();
    const nav = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    fireEvent.click(screen.getByText('See them'));
    expect(nav).toHaveBeenCalledWith('/runs/advanced?filter=by-you');
  });

  it('shows the progress while it runs and Stop ends it after the run in flight', async () => {
    let release: (v: typeof answered) => void = () => {};
    const abandonRun = vi.fn().mockImplementationOnce(() => new Promise((res) => { release = res; })).mockResolvedValue(answered);
    mount(three(), { abandonRun });
    fireEvent.click(screen.getByRole('button', { name: 'Abandon 3 runs' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Abandoning 0 of 3…');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(async () => { release(answered); });
    expect(await screen.findByText('1 abandoned, 2 not:')).toBeInTheDocument();
    expect(abandonRun).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Not reached.')).toHaveLength(2);
  });

  it('the sheet does not close under the loop', async () => {
    let release: (v: typeof answered) => void = () => {};
    const abandonRun = vi.fn().mockImplementation(() => new Promise((res) => { release = res; }));
    const { onClose } = mount(three(), { abandonRun });
    fireEvent.click(screen.getByRole('button', { name: 'Abandon 3 runs' }));
    await screen.findByRole('status');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(async () => { release(answered); });
    await screen.findByText(/not:/);
  });

  it('left alone shows in the toast when everything else went, and with nothing abandoned the toast has no link', async () => {
    const standing = (id: number): GroupStanding => (id === 2 ? 'moved' : 'in-group');
    const { onClose } = mount([1, 2].map((i) => stuckRun(i, 'overtaken')), { standing: (id) => (id === 1 ? 'moved' : standing(id)) });
    fireEvent.click(screen.getByRole('button', { name: 'Abandon 2 runs' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await screen.findByText('No runs abandoned. 2 started moving and were left alone.')).toBeInTheDocument();
    expect(screen.queryByText('See them')).toBeNull();
  });

  it('part done keeps the sheet: each run not abandoned first, then each that had already closed, with Open record', async () => {
    const abandonRun = vi.fn()
      .mockResolvedValueOnce(answered)
      .mockRejectedValueOnce(new ApiError(409, { error: 'bad-transition', from: 'done' }))
      .mockRejectedValueOnce(new ApiTimeout('/api/runs/3/abandon', ABANDON_CALL_MS));
    const { onClose, onDone } = mount([...three(), stuckRun(4, 'overtaken')], { abandonRun });
    fireEvent.click(screen.getByRole('button', { name: 'Abandon 4 runs' }));
    expect(await screen.findByText('1 abandoned, 1 had already closed, 2 not:')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Run 3'), expect.stringContaining('Run 4'), expect.stringContaining('Run 2'),
    ]);
    expect(within(items[0]!).getByText('No answer. It may have closed.')).toBeInTheDocument();
    expect(within(items[0]!).getByRole('link', { name: 'Open record' })).toHaveAttribute('href', '/runs/3');
    expect(within(items[1]!).getByText('Not reached.')).toBeInTheDocument();
    expect(within(items[2]!).getByText('This run already closed.')).toBeInTheDocument();
    expect(within(items[2]!).getByRole('link', { name: 'Open record' })).toHaveAttribute('href', '/runs/2');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a refusal shows its sentence and says a run left alone', async () => {
    const abandonRun = vi.fn().mockRejectedValueOnce(new ApiError(404, {})).mockResolvedValue(answered);
    mount(three(), { abandonRun, standing: (id) => (id === 3 ? 'moved' : 'in-group') });
    fireEvent.click(screen.getByRole('button', { name: 'Abandon 3 runs' }));
    expect(await screen.findByText('1 abandoned, 1 not:')).toBeInTheDocument();
    expect(screen.getByText('1 started moving and was left alone.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('from a Stuck head', () => {
  const makeStore = (): FleetStore => createFleetStore({
    makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
  });
  async function board(active: RunSummary[]): Promise<FleetStore> {
    const store = makeStore();
    act(() => { store.setState({ runs: active, runsFrameSeen: true, fleetFrameSeen: true, conn: 'open', sessions: [] }); });
    render(<><ToastHost /><RunsScreen store={store} loadRuns={vi.fn().mockResolvedValue({ runs: [] })} /></>);
    await act(async () => { await Promise.resolve(); });
    return store;
  }

  it('Abandon 1… opens the single sheet and no list', async () => {
    await board([stuckRun(1, 'never-started'), stuckRun(2, 'never-started', { workspace: 'w', sessionId: 's' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Abandon 1…' }));
    expect(await screen.findByText('Abandon run 1?')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('Abandon all 3… opens the list, and a run that closes under the loop reads already closed', async () => {
    const store = await board(three());
    fireEvent.click(screen.getByRole('button', { name: 'Abandon all 3…' }));
    expect(await screen.findByText('Abandon 3 runs?')).toBeInTheDocument();
    // Run 2 closes elsewhere before the loop reaches it: the frame drops it, and the loop counts it already closed.
    act(() => { store.setState({ runs: three().filter((r) => r.id !== 2) }); });
    const post = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', post);
    fireEvent.click(screen.getByRole('button', { name: 'Abandon 3 runs' }));
    expect(await screen.findByText('2 runs abandoned. 1 had already closed.')).toBeInTheDocument();
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/api/runs/1/abandon', '/api/runs/3/abandon']);
    vi.unstubAllGlobals();
  });

  it('the sheet outlives the band: the last stuck run closing does not close the sheet', async () => {
    const store = await board([1, 2].map((i) => stuckRun(i, 'never-started')));
    fireEvent.click(screen.getByRole('button', { name: 'Abandon 2…' }));
    await screen.findByText('Abandon 2 runs?');
    act(() => { store.setState({ runs: [] }); });
    expect(screen.getByText('Abandon 2 runs?')).toBeInTheDocument();
  });

  it('Closed today re-reads when the loop ends and shows the server\'s count, never one added locally (Task 20)', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ ok: true, programmes: [], closedToday: { operator: 1, sweep: 0, coordinator: 0 } })
      .mockResolvedValue({ ok: true, programmes: [], closedToday: { operator: 7, sweep: 0, coordinator: 0 } });
    const store = makeStore();
    const runs = [1, 2].map((i) => stuckRun(i, 'never-started'));
    act(() => { store.setState({ runs, runsFrameSeen: true, fleetFrameSeen: true, conn: 'open', sessions: [] }); });
    render(<><ToastHost /><RunsScreen store={store} loadProgrammes={read} /></>);
    await act(async () => { await Promise.resolve(); });
    expect(await screen.findByText('Closed today:', { exact: false })).toHaveTextContent('Closed today: 1 by you');
    fireEvent.click(screen.getByRole('button', { name: 'Abandon 2…' }));
    await screen.findByText('Abandon 2 runs?');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const before = read.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Abandon 2 runs' }));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByText('Closed today:', { exact: false })).toHaveTextContent('Closed today: 7 by you');
    vi.unstubAllGlobals();
  });
});
