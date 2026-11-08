// Task 9 (the runs rebuild, D-8072; spec 2026-11-04 §7, §8.2, A9, A10, A50): every board row opens its run page, `/runs/<id>`;
// the board reads nothing per row; `/runs?run=<id>` (old chat text) is replaced by the run's page; the row says what it waits
// on (`runWaitLine`); and the board's own empty, failed and information states. Placeholders only: project `project-a`,
// session `sess-a`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CoordCapsView, RunSummary, RunsPageAnswer } from '../../shared/api';
import { FINISHED_FOLD } from '../src/fleet/runWords';
import { ApiTimeout } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { runPath, runsRunHref } from '../src/lib/routes';
import { RunsScreen } from '../src/screens/RunsScreen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { clearScreenCache } from '../src/lib/screenCache';

beforeEach(() => { navigate('/runs', { replace: true }); clearScreenCache(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: 'prog-a', programTitle: 'Programme A',
  wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  sessionId: 'sess-a', workspace: 'ws-a', branch: 'ws/a',
  state: 'working', kind: 'work', reviews: null,
  claimedBy: 'sess-coord', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 1, total: 2 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
});
const closed = (id: number, ageMs: number): RunSummary => run(id, { state: 'done', closedAt: Date.now() - ageMs });

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});
const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});

/** The board at `path`, with a live frame of `live` (none: no frame yet) and an archive read answered by `archive`. */
function board(path: string, live: RunSummary[] | null, archive: RunSummary[] | Error = []) {
  const store = makeStore();
  act(() => { store.setState({ runs: live ?? [], runsFrameSeen: live !== null, sessions: [], fleetFrameSeen: true }); });
  const loadRuns = vi.fn((): Promise<RunsPageAnswer> =>
    archive instanceof Error ? Promise.reject(archive) : Promise.resolve({ runs: archive }));
  navigate(path);
  const r = render(<RunsScreen store={store} loadRuns={loadRuns} loadCaps={NO_CAPS} />);
  return { ...r, store, loadRuns };
}

const here = (): string => location.pathname + location.search;
const rowOf = (id: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`.run-row[title^="run ${id}"]`);
  expect(el, `the row of run ${id}`).not.toBeNull();
  return el!;
};

describe('a row opens its run page (A9)', () => {
  it('no row carries data-inert, whatever it lacks: a session, a spawn, a reclaimed child', async () => {
    board('/runs', [
      run(1, { sessionId: null, state: 'planned' }),
      run(2, { sessionId: null, state: 'planned', dispatchStartedAt: Date.now() - 5_000 }),
      run(3),
      run(4, { childReclaim: { word: 'reclaimed', sentence: 'gone', at: null } }),
    ]);
    await screen.findByText('Programme A');
    expect(document.querySelectorAll('.run-row')).toHaveLength(4);
    expect(document.querySelectorAll('[data-inert]')).toHaveLength(0);
    expect(document.querySelectorAll('.run-row > .run-open')).toHaveLength(4);
  });

  it('a tap on any row opens /runs/<id>, and a tap on a session-less row does too', async () => {
    board('/runs', [run(7), run(8, { sessionId: null, state: 'planned' })]);
    await screen.findByText('Programme A');
    fireEvent.click(rowOf(7).querySelector('.run-open')!);
    expect(here()).toBe('/runs/7');
    navigate('/runs');
    fireEvent.click(rowOf(8).querySelector('.run-open')!);
    expect(here()).toBe('/runs/8');
  });

  it('every door lands on /runs/<id> or the programme page: the session header, the hold cell, the inbox', async () => {
    const { inboxTarget } = await import('../src/fleet/inboxTarget');
    expect(inboxTarget(
      { seq: 1, at: 1, kind: 'run', sessionId: '', title: 't', body: 'b', runId: 410 },
      new Map(), new Map([[410, { id: 410 }]]),
    )).toEqual({ kind: 'runs', path: '/runs/410' });
    const { openRunAt } = await import('../src/fleet/openers');
    expect(openRunAt(410)).toBe(openRunAt(410));
    act(() => { openRunAt(410)(); });
    expect(here()).toBe('/runs/410');
  });
});

describe('the board reads nothing per row (A10)', () => {
  it('mounting the board fires no GET /api/runs/:id', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('no network in this test'));
    vi.stubGlobal('fetch', fetchImpl);
    board('/runs', [run(1), run(2), run(3)]);
    await screen.findByText('Programme A');
    await act(async () => { await Promise.resolve(); });
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => /\/api\/runs\/\d+/.test(u))).toEqual([]);
    expect(document.querySelector('.run-spend')).toBeNull();
  });
});

describe('runsRunHref and the old ?run= link (A50)', () => {
  it('runsRunHref builds /runs/<id>', () => {
    expect(runsRunHref(410)).toBe('/runs/410');
    expect(runsRunHref(410)).toBe(runPath(410));
  });

  it('/runs?run=410 is replaced by /runs/410, and Back skips it', async () => {
    navigate('/runs');
    const lengthBefore = history.length;
    board('/runs?run=410', [run(410)]);
    await waitFor(() => expect(here()).toBe('/runs/410'));
    // pushState of the legacy link, then a replace of it: one entry more than before, never two.
    expect(history.length).toBe(lengthBefore + 1);
  });

  it('/runs?run=410&q=x goes to the run', async () => {
    board('/runs?run=410&q=x', [run(410)]);
    await waitFor(() => expect(location.pathname).toBe('/runs/410'));
    expect(location.search).not.toContain('run=');
  });

  it('a bad ?run= (0, a number past safe integer) stays on the board and opens nothing', async () => {
    for (const bad of ['0', '99999999999999999999']) {
      const { unmount } = board(`/runs?run=${bad}`, [run(1)]);
      await screen.findByText('Programme A');
      expect(location.pathname).toBe('/runs');
      unmount();
    }
  });
});

describe('the row says what it waits on (§7)', () => {
  it('a row shows runWaitLine in place of its ordinary line', async () => {
    board('/runs', [
      run(1, { state: 'planned', sessionId: null, waitsOn: 'coordinator' }),
      run(2, { state: 'awaiting-review', waitsOn: 'reviewer' }),
      run(3, { state: 'working', waitsOn: 'worker', lastMoveAt: Date.now() - 9 * 86_400_000 }),
    ]);
    expect(await screen.findByText('Waits for its coordinator to start it.')).toBeInTheDocument();
    expect(screen.getByText('Waits on a reviewer.')).toBeInTheDocument();
    expect(screen.getByText('No move in 9 days.')).toBeInTheDocument();
  });

  it('a run waiting behind a stuck run links that run', async () => {
    board('/runs', [run(5, { state: 'planned', sessionId: null, blockedBy: 1012 })]);
    const link = await screen.findByRole('link', { name: 'Waits behind a stuck run.' });
    expect(link).toHaveAttribute('href', '/runs/1012');
    fireEvent.click(link);
    expect(here()).toBe('/runs/1012');
  });

  it('a row with no wait line has none', async () => {
    board('/runs', [run(1)]);
    await screen.findByText('Programme A');
    expect(document.querySelector('.run-wait')).toBeNull();
  });
});

describe('the board\'s states (§8.2)', () => {
  it('No runs open. with no open run', async () => {
    board('/runs', []);
    expect(await screen.findByText('No runs open.')).toBeInTheDocument();
  });

  it('No runs open. stays above a Finished list when only closed runs remain', async () => {
    board('/runs', [], [closed(9, 60_000)]);
    const finished = await screen.findByRole('group', { name: /finished/i });
    const open = screen.getByText('No runs open.');
    expect(open.compareDocumentPosition(finished) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a list not yet heard says Loading and never no runs', () => {
    const store = makeStore();
    render(<RunsScreen store={store} loadRuns={() => new Promise(() => {})} loadCaps={NO_CAPS} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/no runs/i)).toBeNull();
  });

  it('Could not load runs. Try again. on ApiTimeout, with a Try again control that reads again', async () => {
    const store = makeStore();
    const loadRuns = vi.fn()
      .mockRejectedValueOnce(new ApiTimeout('/api/runs', 8_000))
      .mockResolvedValue({ runs: [] });
    render(<RunsScreen store={store} loadRuns={loadRuns} loadCaps={NO_CAPS} />);
    expect(await screen.findByText('Could not load runs. Try again.')).toBeInTheDocument();
    expect(screen.queryByText('No runs open.')).toBeNull();
    const calls = loadRuns.mock.calls.length;
    act(() => { store.setState({ runs: [], runsFrameSeen: false }); });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(loadRuns.mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() => expect(screen.queryByText('Could not load runs. Try again.')).toBeNull());
  });

  it('with the frame seen and no open run, a failed archive read says so and never No runs open.', async () => {
    board('/runs', [], new ApiTimeout('/api/runs', 8_000));
    expect(await screen.findByText('Could not load runs. Try again.')).toBeInTheDocument();
    expect(screen.queryByText('No runs open.')).toBeNull();
  });

  it('reconnecting keeps today\'s line', async () => {
    const { store } = board('/runs', [run(1)]);
    await screen.findByText('Programme A');
    act(() => { store.setState({ conn: 'down' }); });
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
  });

  it('the information line names a run no act can move and carries no control', async () => {
    board('/runs', [run(41, { state: 'future-state' as never }), run(42)]);
    const line = await screen.findByText(/1 run is in a state this server cannot read\./);
    expect(line.closest('[data-info="unreadable"]')).not.toBeNull();
    const link = within41(line);
    expect(link).toHaveAttribute('href', '/runs/41');
    expect(line.querySelector('button')).toBeNull();
    expect(line.closest('[data-info]')!.querySelector('button')).toBeNull();
  });

  it('a run already closing is told in its own line', async () => {
    board('/runs', [run(43, { state: 'closing' })]);
    expect(await screen.findByText(/1 run is already closing\./)).toBeInTheDocument();
  });
});

function within41(line: HTMLElement): HTMLElement {
  return (line.tagName === 'A' ? line : line.closest('a') ?? line.querySelector('a')) as HTMLElement;
}

describe('a return from a run keeps the folds and the scroll (C2)', () => {
  it('the Finished fold stays open after the board unmounts and mounts again', async () => {
    const archive = Array.from({ length: FINISHED_FOLD + 5 }, (_, i) => closed(100 + i, (i + 1) * 60_000));
    const first = board('/runs', [], archive);
    await screen.findByRole('group', { name: /finished/i });
    expect(document.querySelectorAll('.run-row')).toHaveLength(FINISHED_FOLD);
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(document.querySelectorAll('.run-row')).toHaveLength(FINISHED_FOLD + 5);
    first.unmount();
    board('/runs', [], archive);
    await screen.findByRole('group', { name: /finished/i });
    expect(document.querySelectorAll('.run-row')).toHaveLength(FINISHED_FOLD + 5);
  });

  it('the scroll place is restored on the way back', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 });
    const first = board('/runs', [run(1)]);
    await screen.findByText('Programme A');
    first.unmount();
    scrollTo.mockClear();
    board('/runs', [run(1)]);
    await screen.findByText('Programme A');
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });
});
