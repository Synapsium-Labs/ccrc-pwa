// Finding a run (the runs rebuild, Task 8, D-8072; spec 2026-11-04 §8.3, F1, F2, F4). Neutral names only: the repository is public.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { RunFindAnswer, RunHit, RunSummary } from '../../shared/api';
import { api, ApiError } from '../src/lib/api';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';
import { RunsScreen } from './runs-board';
import { parseRunNumber } from '../src/screens/useRunFind';
import { runRow } from './ledgersFixture';

const makeSocket = (): WebSocket => ({ close() {}, set onopen(_v: unknown) {}, set onmessage(_v: unknown) {}, set onclose(_v: unknown) {}, set onerror(_v: unknown) {} }) as unknown as WebSocket;
const T0 = Date.UTC(2026, 10, 2, 11, 20);
const open = (over: Partial<RunSummary> = {}): RunSummary => ({
  ...runRow({ id: 410, program: 'programme-a' }),
  programTitle: 'Programme A', project: 'project-a', homeProject: 'project-a', workspace: 'lane-a', branch: 'ws/lane-a', reviews: null,
  openedAt: T0, dispatchedAt: T0, dispatchStartedAt: null, handoffCommit: null, items: { done: 1, total: 3 }, unreadMail: 0,
  resumed: false, clearedAt: null, health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false, ...over,
}) as unknown as RunSummary;
const hit = (over: Partial<RunHit> = {}): RunHit => ({
  id: 300, program: 'programme-a', programTitle: 'Programme A', wave: 1, waveOf: 2, kind: 'work', reviews: null, state: 'done',
  project: 'project-a', workspace: 'lane-a', branch: null, claimedBy: null, openedAt: T0, closedAt: T0 + 3_600_000,
  runTitle: null, closedBy: 'operator', closeDetail: 'abandon:overtaken', ...over,
});
const answer = (over: Partial<RunFindAnswer> = {}): RunFindAnswer => ({ ok: true, exact: null, runs: [], reviewsOf: [], next: null, ...over });

const board = (runs: RunSummary[] = []): FleetStore => {
  const store = createFleetStore({ makeSocket });
  store.setState({ runs, runsFrameSeen: true });
  return store;
};
const NEVER = () => new Promise<never>(() => {});
const mount = (store: FleetStore) => render(<RunsScreen store={store} loadRuns={async () => ({ ok: true, runs: [], nextBefore: null }) as never} loadCaps={NEVER} />);
const type = (text: string) => fireEvent.change(screen.getByLabelText('Find a run'), { target: { value: text } });
const settle = async (ms = 200) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  history.replaceState(null, '', '/runs');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); useFleetStore.setState({ projected: undefined }); });

describe('the number', () => {
  it('the three spellings mean run 410', () => {
    for (const t of ['410', '#410', 'run 410', ' Run 410 ']) expect(parseRunNumber(t), t).toBe(410);
    for (const t of ['', 'run', '0', '007', '#', 'run 4x', '99999999999999999999']) expect(parseRunNumber(t), t).toBeNull();
  });
});

describe('the box', () => {
  it('open runs filter at once from the frame', async () => {
    vi.spyOn(api, 'findRuns').mockImplementation(NEVER);
    mount(board([open({ id: 11, runTitle: 'Tidy lane' }), open({ id: 12, programTitle: 'Other', program: 'other', workspace: 'lane-b', branch: 'ws/lane-b', project: 'project-b' })]));
    type('tidy');
    expect(screen.getByText('Run 11 · Tidy lane · wave 1 of 3')).toBeInTheDocument();
    expect(screen.queryByText(/Run 12/)).toBeNull();
  });

  it('closed runs arrive 200 ms after typing stops', async () => {
    const find = vi.spyOn(api, 'findRuns').mockResolvedValue(answer({ runs: [hit()] }));
    mount(board());
    type('programme');
    await settle(199);
    expect(find).not.toHaveBeenCalled();
    type('programme a');
    await settle(199);
    expect(find).not.toHaveBeenCalled();
    await settle(1);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]![0]).toMatchObject({ q: 'programme a', scope: 'closed' });
    expect(screen.getByText('Run 300 · Programme A · wave 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('closed by you: overtaken')).toBeInTheDocument();
  });

  it('?q= holds the query across a reload', async () => {
    vi.spyOn(api, 'findRuns').mockResolvedValue(answer());
    const first = mount(board());
    type('lane-a');
    expect(location.search).toBe('?q=lane-a');
    first.unmount();
    mount(board());
    expect(screen.getByLabelText('Find a run')).toHaveValue('lane-a');
  });

  it('a whole number and Enter opens /runs/<id>', () => {
    vi.spyOn(api, 'findRuns').mockImplementation(NEVER);
    mount(board());
    type('#410');
    fireEvent.keyDown(screen.getByLabelText('Find a run'), { key: 'Enter' });
    expect(location.pathname + location.search).toBe('/runs/410?q=%23410');
  });

  it('clearing restores the board with its folds and scroll', async () => {
    vi.spyOn(api, 'findRuns').mockImplementation(NEVER);
    Object.defineProperty(window, 'scrollY', { value: 340, configurable: true });
    mount(board([open({ id: 11 })]));
    // A card with no known last move waits for the programmes read, so the list appears once it settles.
    await settle();
    expect(screen.getByRole('list', { name: 'Programmes' })).toBeInTheDocument();
    type('lane');
    expect(screen.queryByRole('list', { name: 'Programmes' })).toBeNull();
    type('');
    expect(screen.getByRole('list', { name: 'Programmes' })).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 340);
    expect(location.search).toBe('');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('a result opens /runs/<id>?q=<query>, and carries no Abandon', async () => {
    vi.spyOn(api, 'findRuns').mockImplementation(NEVER);
    mount(board([open({ id: 11 })]));
    type('lane');
    const link = screen.getByRole('link', { name: /Run 11/ });
    expect(link).toHaveAttribute('href', '/runs/11?q=lane');
    fireEvent.click(link);
    expect(location.pathname + location.search).toBe('/runs/11?q=lane');
    expect(screen.queryByRole('button', { name: /abandon/i })).toBeNull();
  });

  it('Reviews of run 410 sits below the exact hit', async () => {
    vi.spyOn(api, 'findRuns').mockResolvedValue(answer({
      exact: hit({ id: 410, state: 'working', closedAt: null, closedBy: null, closeDetail: null }),
      reviewsOf: [hit({ id: 411, kind: 'review', reviews: 410 })],
    }));
    mount(board());
    type('410');
    await settle();
    const exact = screen.getByRole('link', { name: /Run 410 /});
    const head = screen.getByRole('heading', { name: 'Reviews of run 410' });
    expect(exact.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(head.parentElement!).getByRole('link', { name: /Run 411/ })).toBeInTheDocument();
  });

  it('says what it found nothing for, and a number with no run', async () => {
    vi.spyOn(api, 'findRuns').mockResolvedValue(answer());
    mount(board());
    type('xyz');
    await settle();
    expect(screen.getByText("No run matches 'xyz'.")).toBeInTheDocument();
    type('9999');
    await settle();
    expect(screen.getByText('There is no run 9999.')).toBeInTheDocument();
  });

  it('a failed read on a number says only that it could not search, never that there is no run', async () => {
    vi.spyOn(api, 'findRuns').mockRejectedValue(new TypeError('offline'));
    mount(board());
    type('410');
    await settle();
    expect(screen.getByText('Could not search closed runs. Showing open runs only.')).toBeInTheDocument();
    expect(screen.queryByText(/There is no run/)).toBeNull();
  });

  it('clearing restores a pane the board was scrolled in, read before the swap', async () => {
    vi.spyOn(api, 'findRuns').mockImplementation(NEVER);
    mount(board([open({ id: 11 })]));
    const pane = screen.getByLabelText('Find a run').closest('.rf-box')!.parentElement!;
    pane.style.overflowY = 'auto';
    Object.defineProperty(pane, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(pane, 'clientHeight', { value: 500, configurable: true });
    let top = 340;
    Object.defineProperty(pane, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; } });
    type('lane');
    top = 0; // the short results page clamps the scroller
    type('');
    expect(top).toBe(340);
  });

  it('the read failing keeps the open runs and says so', async () => {
    vi.spyOn(api, 'findRuns').mockRejectedValue(new TypeError('offline'));
    mount(board([open({ id: 11 })]));
    type('lane');
    await settle();
    expect(screen.getByText('Could not search closed runs. Showing open runs only.')).toBeInTheDocument();
    expect(screen.getByText(/Run 11/)).toBeInTheDocument();
  });

  it('any failure from find, as on an older server where the id parse refuses it with 400, reads Could not search closed runs', async () => {
    vi.spyOn(api, 'findRuns').mockRejectedValue(new ApiError(400, { ok: false }));
    mount(board([open({ id: 11 })]));
    type('lane');
    await settle();
    expect(screen.getByText('Could not search closed runs. Showing open runs only.')).toBeInTheDocument();
    expect(screen.getByText(/Run 11/)).toBeInTheDocument();
  });

  it('/ focuses the box on /runs', () => {
    mount(board());
    expect(document.activeElement).not.toBe(screen.getByLabelText('Find a run'));
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(screen.getByLabelText('Find a run'));
  });
});
