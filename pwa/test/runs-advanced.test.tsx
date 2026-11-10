// Advanced, the board's foot and Finished's read (the runs rebuild, Task 11, D-8073; spec 2026-11-04 §8.2, §8.2.3, §8.6, F10,
// F18, o13; the board's Finished is the programmes since Task 18, D-8075). Placeholders only. The reads are injected: `read` for
// Advanced, `loadProgrammes` for the board.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CoordCapsView, ProgrammeRow, RunHit, RunSummary } from '../../shared/api';
import type { RunCloseGroupView, RunCloseRequest, RunCloseView } from '../../shared/run-close';
import { ApiError, api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { clearScreenCache } from '../src/lib/screenCache';
import { runsAdvancedPath, runsClosedSinceOf, runsFilterOf } from '../src/lib/routes';
import { RunsAdvancedScreen } from '../src/screens/RunsAdvancedScreen';
import { RunsScreen as RealRunsScreen } from '../src/screens/RunsScreen';
import type { FindReader } from '../src/screens/useRunList';
import { RunsScreen, foundRows, programmeRow, programmesAnswer } from './runs-board';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

const NOW = Date.now();
const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: 'prog-a', programTitle: 'Programme A', wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  sessionId: 'sess-a', workspace: 'ws-a', branch: 'ws/a', state: 'working', kind: 'work', reviews: null, claimedBy: 'sess-coord',
  resumed: false, clearedAt: null, openedAt: NOW - 1_000_000, dispatchStartedAt: null, dispatchedAt: NOW - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 1, total: 2 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true,
    clearError: null, coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
});
/** A slim `find` row: stored columns only. */
const hit = (id: number, over: Partial<RunHit> = {}): RunHit => ({
  id, program: 'prog-a', programTitle: 'Programme A', runTitle: null, wave: 1, waveOf: 2, kind: 'work', reviews: null,
  state: 'done', project: 'project-a', workspace: `ws-${id}`, branch: null, claimedBy: 'sess-coord', openedAt: NOW - 2_000_000,
  closedAt: NOW - id * 1_000, closedBy: null, closeDetail: null, ...over,
});
const openHit = (id: number, over: Partial<RunHit> = {}): RunHit => hit(id, { state: 'planned', closedAt: null, workspace: null, ...over });
const answer = (runs: RunHit[], next: { beforeAt: number; beforeId: number } | null = null): Awaited<ReturnType<FindReader>> =>
  ({ ok: true, exact: null, runs, reviewsOf: [], next });

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});
const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});
const NEVER = (): Promise<never> => new Promise<never>(() => {});
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };

let width = 900;
beforeEach(() => {
  navigate('/runs', { replace: true });
  clearScreenCache();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList?.contains('runs-column') ? width : 0; } });
  vi.spyOn(api, 'runRecord').mockImplementation(async (id: number) => ({ ok: true, run: run(id), events: [], reviewedBy: [], olderEvents: 0 }) as never);
  vi.spyOn(api, 'run').mockImplementation(async (id: number) => ({ ok: true, run: run(id), spend: { measured: false, reason: 'no-sweep' } }) as never);
  vi.spyOn(api, 'runItems').mockResolvedValue({ ok: true, items: [] } as never);
  vi.spyOn(api, 'runSignals').mockRejectedValue(new ApiError(404, { ok: false }));
  vi.spyOn(api, 'goals').mockRejectedValue(new ApiError(404, { ok: false }));
  // Advanced's lane rows read their own door; every older suite here leaves it unanswered.
  vi.spyOn(api, 'runClose').mockImplementation(NEVER as never);
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
  history.replaceState(null, '', '/');
  width = 900;
});

const advanced = (read: FindReader, path = '/runs/advanced', store: FleetStore = makeStore()) => {
  navigate(path, { replace: true });
  return { store, ...render(<RunsAdvancedScreen store={store} read={read} />) };
};
const listIds = (): number[] => [...document.querySelectorAll<HTMLElement>('.ra-list .rf-name')]
  .map((n) => Number(/^Run (\d+)/.exec(n.textContent ?? '')?.[1]));

describe('the routes', () => {
  it('runsAdvancedPath carries the chip and closedSince, and the readers give them back', () => {
    expect(runsAdvancedPath()).toBe('/runs/advanced');
    expect(runsAdvancedPath('by-you')).toBe('/runs/advanced?filter=by-you');
    expect(runsAdvancedPath('by-ccrc', 1234)).toBe('/runs/advanced?filter=by-ccrc&closedSince=1234');
    expect(runsAdvancedPath(undefined, 5)).toBe('/runs/advanced?closedSince=5');
    expect(runsFilterOf('?filter=open')).toBe('open');
    expect(runsFilterOf('?filter=bogus')).toBeNull();
    expect(runsClosedSinceOf('?closedSince=1234')).toBe(1234);
    expect(runsClosedSinceOf('?closedSince=-1')).toBeNull();
  });
});

describe('All runs on Advanced (§8.6)', () => {
  it('open runs first, then close order, 50 at a time with Show older', async () => {
    const page1 = [openHit(90), openHit(91), ...Array.from({ length: 48 }, (_, k) => hit(10 + k))];
    const read = vi.fn<FindReader>(async (q) => (q.beforeId === undefined
      ? answer(page1, { beforeAt: 5_000, beforeId: 57 })
      : answer([hit(7), hit(6)])));
    advanced(read);
    await flush();
    expect(read).toHaveBeenCalledWith({ limit: 50 });
    expect(listIds().slice(0, 4)).toEqual([90, 91, 10, 11]);
    expect(listIds()).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(read).toHaveBeenLastCalledWith({ limit: 50, beforeAt: 5_000, beforeId: 57 });
    expect(listIds().slice(-2)).toEqual([7, 6]);
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
  });

  it('a failed Show older says Could not load older runs. Try again. and keeps the rows already read (o13)', async () => {
    const read = vi.fn<FindReader>(async (q) => {
      if (q.beforeId !== undefined) throw new Error('down');
      return answer([hit(10), hit(11)], { beforeAt: 1, beforeId: 11 });
    });
    advanced(read);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await flush();
    expect(screen.getByText('Could not load older runs. Try again.')).toBeInTheDocument();
    expect(listIds()).toEqual([10, 11]);
    expect(screen.getByRole('button', { name: 'Show older' })).not.toBeDisabled();
  });

  it('the chip is in the URL', async () => {
    const read = vi.fn<FindReader>(async () => answer([hit(10)]));
    advanced(read);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Closed by you' }));
    await flush();
    expect(location.search).toBe('?filter=by-you');
    expect(read).toHaveBeenLastCalledWith({ scope: 'closed', closedBy: 'operator', limit: 50 });
    expect(screen.getByRole('button', { name: 'Closed by you' })).toHaveAttribute('aria-pressed', 'true');
    // A chip asks for the closer's word on the wire.
    fireEvent.click(screen.getByRole('button', { name: 'Closed by ccrc' }));
    await flush();
    expect(read).toHaveBeenLastCalledWith({ scope: 'closed', closedBy: 'sweep', limit: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Closed by coordinators' }));
    await flush();
    expect(read).toHaveBeenLastCalledWith({ scope: 'closed', closedBy: 'coordinator', limit: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await flush();
    expect(read).toHaveBeenLastCalledWith({ scope: 'open', limit: 50 });
    // The pressed chip clears: no chip is every run.
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await flush();
    expect(location.search).toBe('');
    expect(read).toHaveBeenLastCalledWith({ limit: 50 });
  });

  it('a cold link with a chip opens on that chip', async () => {
    const read = vi.fn<FindReader>(async () => answer([hit(10)]));
    advanced(read, '/runs/advanced?filter=by-ccrc');
    await flush();
    expect(read).toHaveBeenCalledWith({ scope: 'closed', closedBy: 'sweep', limit: 50 });
    expect(screen.getByRole('button', { name: 'Closed by ccrc' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('closedSince rides the URL beside the chip', async () => {
    const read = vi.fn<FindReader>(async () => answer([hit(10)]));
    advanced(read, runsAdvancedPath('by-ccrc', 1_700_000_000_000));
    await flush();
    expect(read).toHaveBeenCalledWith({ scope: 'closed', closedBy: 'sweep', closedSince: 1_700_000_000_000, limit: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Closed by you' }));
    await flush();
    expect(location.search).toBe('?filter=by-you&closedSince=1700000000000');
  });

  it('a just-abandoned old run heads All runs', async () => {
    let n = 0;
    const read = vi.fn<FindReader>(async () => { n += 1; return answer(n === 1 ? [openHit(9), hit(20)] : [hit(9, { closedAt: NOW, closedBy: 'operator' }), hit(20)]); });
    const store = makeStore();
    act(() => { store.setState({ runs: [run(9)], runsFrameSeen: true }); });
    advanced(read, '/runs/advanced', store);
    await flush();
    expect(listIds()).toEqual([9, 20]);
    act(() => { store.setState({ runs: [] }); });                 // run 9 closes: it leaves the open frame
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(listIds()).toEqual([9, 20]);
    expect(document.querySelector('.ra-list .rf-link')!.textContent).toContain('closed by you');
  });

  it('an open hit reads its word and line from the live frame, by id', async () => {
    const read = vi.fn<FindReader>(async () => answer([openHit(9, { state: 'planned' }), hit(20)]));
    const store = makeStore();
    act(() => { store.setState({ runs: [run(9, { state: 'working', workspace: 'ws-live' })], runsFrameSeen: true }); });
    advanced(read, '/runs/advanced', store);
    await flush();
    const row = document.querySelector<HTMLElement>('.ra-list .rf-link')!;
    expect(row.textContent).toContain('working');
    expect(row.textContent).toContain('ws-live');
    expect(row.textContent).not.toContain('planned');
  });

  it('says it is loading, then that it could not load, with a way to try again', async () => {
    const read = vi.fn<FindReader>().mockImplementationOnce(NEVER);
    const first = advanced(read);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    first.unmount();
    const failing = vi.fn<FindReader>().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(answer([hit(10)]));
    advanced(failing);
    await flush();
    expect(screen.getByText(/Could not load runs\. Try again\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(listIds()).toEqual([10]);
  });

  it('in a broad column a row opens beside the list with ?open=<id>', async () => {
    width = 1300;
    const read = vi.fn<FindReader>(async () => answer([hit(410), hit(411)]));
    advanced(read);
    await flush();
    expect(document.querySelector('.runs-column')).toHaveAttribute('data-column', 'broad');
    expect(screen.getByText('Select a run to see it here.')).toBeInTheDocument();
    const link = within(document.querySelector<HTMLElement>('.ra-list')!).getAllByRole('link')[1]!;
    expect(link.getAttribute('href')).toBe('/runs/advanced?open=411');
    fireEvent.click(link);
    expect(location.pathname + location.search).toBe('/runs/advanced?open=411');
    await within(document.querySelector<HTMLElement>('.runs-detail-pane')!).findByRole('heading', { level: 2, name: 'Run 411' });
    // The chip stays in the address a row opens from.
    fireEvent.click(screen.getByRole('button', { name: 'Closed by you' }));
    await flush();
    expect(location.search).toBe('?filter=by-you');
  });

  it('below broad a row opens the run page', async () => {
    const read = vi.fn<FindReader>(async () => answer([hit(410)]));
    advanced(read);
    await flush();
    expect(document.querySelector('.ra-list .rf-link')).toHaveAttribute('href', '/runs/410');
    expect(document.querySelector('.runs-detail-pane')).toBeNull();
  });

  it('chips are a labelled group of toggle buttons that can wrap', async () => {
    advanced(vi.fn<FindReader>(async () => answer([])));
    await flush();
    const chips = within(screen.getByRole('group', { name: 'Filter' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['Open', 'Closed by you', 'Closed by ccrc', 'Closed by coordinators']);
    expect(screen.getByText('No runs.')).toBeInTheDocument();
  });
});

describe('the switches on Advanced (§8.6 item 1, Task 12a, D-8074)', () => {
  const COORD = { pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [
    { kind: 'terminal', sessionId: 'ws-closed', runId: 77, token: 'tree-unreadable', sentence: 'ccrc could not read this worktree.', at: NOW - 60_000 },
  ] } as never;

  it('ChildReclaimBanner names a closed run from All runs’ hits', async () => {
    const store = makeStore();
    act(() => { store.setState({ coord: COORD, coordFrameSeen: true, runs: [], runsFrameSeen: true }); });
    // Run 77 is closed, so only the hit can say which programme and wave it belongs to.
    advanced(async () => answer([hit(77, { program: 'port-api', programTitle: 'Port the API', wave: 5, waveOf: 7 })]), '/runs/advanced', store);
    await waitFor(() => expect(document.querySelector('.child-reclaim-who')?.textContent).toBe('port-api · wave 5 of 7 · run #77 · ws-closed'));
  });

  it('the pause switch, the child-reclaim switch and the caps all render here, in that order, and Pause works from here', async () => {
    const store = makeStore();
    act(() => { store.setState({ coord: COORD, coordFrameSeen: true, runs: [], runsFrameSeen: true }); });
    const pause = vi.spyOn(api, 'coordPause').mockResolvedValue(undefined);
    const view = render(<RunsAdvancedScreen store={store} read={async () => answer([])}
      loadCaps={async () => ({ caps: { maxConcurrentWorkers: 3 }, usage: { running: 1 } })} />);
    await waitFor(() => expect(view.container.querySelector('.caps-control')).not.toBeNull());
    const order = [...view.container.querySelectorAll('.coord-banner, .child-reclaim-banner, .caps-control')]
      .map((el) => (el.matches('.coord-banner') ? 'pause' : el.matches('.child-reclaim-banner') ? 'reclaim' : 'caps'));
    expect(order).toEqual(['pause', 'reclaim', 'caps']);
    fireEvent.click(within(view.container.querySelector<HTMLElement>('.coord-banner')!).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(pause).toHaveBeenCalledWith(true));
  });
});

describe('the board foot (§8.2 item 10)', () => {
  const states: [string, () => void][] = [
    ['loading', () => { render(<RunsScreen store={makeStore()} loadRuns={NEVER} loadFinished={NEVER} loadCaps={NO_CAPS} />); }],
    ['no runs open', () => {
      const s = makeStore(); act(() => { s.setState({ runs: [], runsFrameSeen: true }); });
      render(<RunsScreen store={s} loadRuns={async () => ({ runs: [] })} loadFinished={async () => foundRows([])} loadCaps={NO_CAPS} />);
    }],
    ['open runs and finished runs', () => {
      const s = makeStore(); act(() => { s.setState({ runs: [run(5)], runsFrameSeen: true }); });
      render(<RunsScreen store={s} loadRuns={async () => ({ runs: [] })} loadFinished={async () => answer([hit(6)])} loadCaps={NO_CAPS} />);
    }],
    ['a failed read', () => {
      render(<RunsScreen store={makeStore()} loadRuns={async () => { throw new Error('down'); }}
        loadFinished={async () => { throw new Error('down'); }} loadCaps={NO_CAPS} />);
    }],
  ];
  it.each(states)('links to /runs/advanced when the board is %s', async (_name, mountIt) => {
    mountIt();
    await flush();
    const link = screen.getByRole('link', { name: 'Advanced' });
    expect(link).toHaveAttribute('href', '/runs/advanced');
    fireEvent.click(link);
    expect(location.pathname).toBe('/runs/advanced');
  });
});

describe('Finished is the programmes (§8.2.3, A26, D-8075)', () => {
  const board = (props: Partial<React.ComponentProps<typeof RunsScreen>> & { live?: RunSummary[]; frame?: boolean } = {}) => {
    const { live = [], frame = true, ...rest } = props;
    const store = makeStore();
    if (frame) act(() => { store.setState({ runs: live, runsFrameSeen: true, sessions: [], fleetFrameSeen: true }); });
    const view = render(<RunsScreen store={store} loadCaps={NO_CAPS} {...rest} />);
    return { store, ...view };
  };
  const finishedRow = (slug: string, over: Partial<ProgrammeRow> = {}): ProgrammeRow => programmeRow(slug, {
    title: `Programme ${slug}`, lastMoveAt: NOW - 3_600_000, ending: { outcome: 'complete', waves: 5, neverStarted: 0, closedBy: null }, ...over,
  });
  const openFold = (): void => { fireEvent.click(screen.getByRole('button', { name: /finished/i })); };
  const finishedSlugs = (): string[] => [...document.querySelectorAll<HTMLElement>('.programme-finished-row')].map((li) => li.dataset.programme ?? '');

  it('the board’s own call is fixed: GET /api/programmes from the operator’s local midnight', async () => {
    const spy = vi.spyOn(api, 'programmes').mockResolvedValue({ ok: true, programmes: [], closedToday: { operator: 0, sweep: 0, coordinator: 0 } });
    const store = makeStore();
    act(() => { store.setState({ runs: [], runsFrameSeen: true, sessions: [], fleetFrameSeen: true }); });
    render(<RealRunsScreen store={store} />);
    await flush();
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(midnight.getTime());
  });

  it('Finished lists a programme with no open run and its ending, folded, and leaves out one that is still open', async () => {
    board({ live: [run(4, { program: 'prog-open', programTitle: 'Programme open' })],
      loadProgrammes: programmesAnswer([finishedRow('prog-done'), finishedRow('prog-open')]) });
    await flush();
    expect(finishedSlugs()).toEqual([]);
    openFold();
    expect(finishedSlugs()).toEqual(['prog-done']);
    expect(screen.getByText('complete · 5 waves done')).toBeInTheDocument();
  });

  it('the fold ends with All runs, newest close first, which opens All runs', async () => {
    board({ loadProgrammes: programmesAnswer([finishedRow('prog-done')]) });
    await flush();
    openFold();
    const link = screen.getByRole('link', { name: 'All runs, newest close first' });
    expect(link).toHaveAttribute('href', '/runs/advanced');
    fireEvent.click(link);
    expect(location.pathname).toBe('/runs/advanced');
  });

  it('a programme whose last move was over 7 days ago is not in Finished', async () => {
    board({ loadProgrammes: programmesAnswer([finishedRow('prog-old', { lastMoveAt: NOW - 8 * 86_400_000 }), finishedRow('prog-new')]) });
    await flush();
    openFold();
    expect(finishedSlugs()).toEqual(['prog-new']);
  });

  it('a just-closed programme heads Finished once the frame drops its last run', async () => {
    let n = 0;
    const { store } = board({ live: [run(9)], loadProgrammes: async () => {
      n += 1;
      return { ok: true, programmes: n === 1 ? [finishedRow('prog-b', { lastMoveAt: NOW - 86_400_000 })]
        : [finishedRow('prog-a', { lastMoveAt: NOW }), finishedRow('prog-b', { lastMoveAt: NOW - 86_400_000 })], closedToday: { operator: 0, sweep: 0, coordinator: 0 } };
    } });
    await flush();
    act(() => { store.setState({ runs: [] }); });
    await flush();
    openFold();
    expect(finishedSlugs()).toEqual(['prog-a', 'prog-b']);
  });

  describe('the board’s states (§8.2)', () => {
    const FAILED = 'Could not reach the server — runs may exist that are not shown.';
    const FINISHED_FAILED = 'Could not reach the server — finished runs may exist that are not shown.';
    it('before the first frame and before the programmes answer, the board says Loading…', async () => {
      board({ frame: false, loadProgrammes: NEVER });
      await flush();
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByText('No runs open.')).toBeNull();
    });

    it('a failed programmes read with no frame says Could not reach the server, never No runs open.', async () => {
      board({ frame: false, loadProgrammes: async () => { throw new Error('down'); } });
      await flush();
      expect(screen.getByText(FAILED)).toBeInTheDocument();
      expect(screen.queryByText('No runs open.')).toBeNull();
    });

    it('with the frame seen, no open run and a failed programmes read, it says the same', async () => {
      board({ loadProgrammes: async () => { throw new Error('down'); } });
      await flush();
      expect(screen.getByText(FAILED)).toBeInTheDocument();
      expect(screen.queryByText('No runs open.')).toBeNull();
    });

    it('with open runs and a failed programmes read, the cards stay and Finished says it could not be read', async () => {
      board({ live: [run(5)], loadProgrammes: async () => { throw new Error('down'); } });
      await flush();
      expect(screen.getByTestId('programme-card')).toBeInTheDocument();
      expect(screen.getByText(FINISHED_FAILED)).toBeInTheDocument();
    });

    it('the programmes answering before the frame never claims "No runs open."; the board reads Loading', async () => {
      const { store } = board({ frame: false, loadProgrammes: programmesAnswer([]) });
      await flush();
      expect(screen.queryByText('No runs open.')).toBeNull();
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      act(() => { store.setState({ runs: [], runsFrameSeen: true }); });
      expect(screen.getByText('No runs open.')).toBeInTheDocument();
    });

    it('the same holds when the server never sends a frame', async () => {
      vi.useFakeTimers();
      try {
        board({ frame: false, loadProgrammes: programmesAnswer([finishedRow('prog-done')]) });
        await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
        expect(screen.getByText('Loading…')).toBeInTheDocument();
        expect(screen.queryByText('No runs open.')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('an older server has no programmes route: the cards still show, from the open runs, and the older line shows', async () => {
      const older = async (): Promise<never> => { throw new ApiError(404, { ok: false }); };
      board({ live: [run(5)], loadProgrammes: older });
      await flush();
      expect(screen.getByTestId('programme-card')).toBeInTheDocument();
      expect(screen.getByText('This server is older, so Finished is not available.')).toBeInTheDocument();
      expect(document.querySelector('[data-state="error"]')).toBeNull();
      expect(screen.queryByText(/Could not reach the server/)).toBeNull();
    });

    it('any other refusal reads as failed, not as an older server', async () => {
      board({ live: [run(5)], loadProgrammes: async () => { throw new ApiError(500, { error: 'server-error' }); } });
      await flush();
      expect(screen.queryByText('This server is older, so Finished is not available.')).toBeNull();
      expect(screen.getByText(FINISHED_FAILED)).toBeInTheDocument();
    });

    it('no state reads the removed coldState', () => {
      const text = readFileSync(resolve(__dirname, '../src/screens/RunsScreen.tsx'), 'utf8');
      expect(text).not.toMatch(/\bcoldState\b/);
      expect(text).not.toMatch(/useColdRuns\(|runsPage|runPages/);
    });

    it('a held answer stays when its re-read fails, and the failure line shows beside it', async () => {
      let n = 0;
      const { store } = board({ live: [run(9)], loadProgrammes: async () => {
        n += 1;
        if (n > 1) throw new Error('down');
        return { ok: true, programmes: [finishedRow('prog-done')], closedToday: { operator: 0, sweep: 0, coordinator: 0 } };
      } });
      await flush();
      act(() => { store.setState({ runs: [] }); });                // a close: the programmes are read again, and the read fails
      await flush();
      openFold();
      expect(finishedSlugs()).toEqual(['prog-done']);
      expect(screen.getByText(FINISHED_FAILED)).toBeInTheDocument();
    });
  });
});

describe('What ccrc closes on its own (§8.6 item 2, §12.3, A15, o7, o12, Task 26, D-8077)', () => {
  const HOUR = 3_600_000;
  const none = { closed7d: 0, refused7d: 0, updatedAt: 0, marker: 'clear' as const, held: null };
  const group = (g: 'never-started' | 'claimant-crashed', over: Partial<RunCloseGroupView> = {}): RunCloseGroupView =>
    ({ group: g, choice: 'shadow', state: 'shadow', list: null, ...none, ...over });
  const would = (runId: number, at: number, why: 'never-started' | 'review-of-closed' | 'later-review' = 'never-started') =>
    ({ runId, program: `prog-${runId}`, why, at });
  /** 14 runs would close, 11 now and 3 later (the spec's example), with 1085 held and 65 under an archived coordinator. */
  const fourteen = (): RunCloseGroupView => {
    const ws = [
      ...Array.from({ length: 11 }, (_, k) => would(100 + k, NOW - HOUR)),
      would(899, NOW + 5 * HOUR), would(396, NOW + 9 * HOUR), would(984, NOW + 30 * HOUR, 'review-of-closed'),
    ];
    const named = [
      { runId: 1085, program: 'prog-1085', why: 'live-session' },
      { runId: 65, program: 'prog-65', why: 'coordinator-not-reached' },
      { runId: 66, program: 'prog-66', why: 'coordinator-not-reached' },
    ];
    return group('never-started', { list: { would: ws, named, now: 0, later: 0 }, closed7d: 3, refused7d: 1 });
  };
  const view = (...groups: RunCloseGroupView[]): RunCloseView =>
    ({ groups: groups.length > 0 ? groups : [fourteen(), group('claimant-crashed')] });
  const mount = (v: RunCloseView | (() => Promise<unknown>), write: (b: RunCloseRequest) => Promise<unknown> = async () => v) => {
    navigate('/runs/advanced', { replace: true });
    const readRunClose = typeof v === 'function' ? v : async () => ({ ok: true, ...v });
    const writeRunClose = vi.fn(write);
    const out = render(<RunsAdvancedScreen store={makeStore()} read={vi.fn<FindReader>(async () => answer([]))} loadCaps={NO_CAPS}
      readRunClose={readRunClose} writeRunClose={writeRunClose} />);
    return { ...out, writeRunClose };
  };
  const rowOf = (g: string): HTMLElement => screen.getByTestId(`run-close-${g}`);

  it('a row shows its state word, Turn off and Turn on, and Back to shadow when on (o7)', async () => {
    mount(view());
    await flush();
    const shadow = rowOf('never-started');
    expect(within(shadow).getByText('Shadow')).toBeInTheDocument();
    expect(within(shadow).getByRole('button', { name: 'Turn on' })).toBeEnabled();
    expect(within(shadow).getByRole('button', { name: 'Turn off' })).toBeEnabled();
    expect(within(shadow).queryByRole('button', { name: 'Back to shadow' })).toBeNull();
    cleanup();
    mount(view(group('never-started', { choice: 'on', state: 'on' }), group('claimant-crashed')));
    await flush();
    const on = rowOf('never-started');
    expect(within(on).getByText('On')).toBeInTheDocument();
    expect(within(on).getByRole('button', { name: 'Turn off' })).toBeEnabled();
    expect(within(on).getByRole('button', { name: 'Back to shadow' })).toBeEnabled();
    expect(within(on).queryByRole('button', { name: 'Turn on' })).toBeNull();
  });

  it('Turn on lists every run that would close with reasons, and counts those closing now and those closing when their time runs out', async () => {
    mount(view());
    await flush();
    fireEvent.click(within(rowOf('never-started')).getByRole('button', { name: 'Turn on' }));
    const sheet = await screen.findByTestId('run-close-sheet');
    expect(screen.getByText('Let ccrc close these on its own?')).toBeInTheDocument();
    expect(within(sheet).getByTestId('run-close-sheet-count')).toHaveTextContent('14 runs would close, 11 now and 3 when their time runs out.');
    const closing = within(within(sheet).getByRole('list', { name: 'Would close' })).getAllByRole('listitem');
    expect(closing).toHaveLength(14);
    expect(closing[0]).toHaveTextContent('Run 100 · prog-100');
    expect(closing[0]).toHaveTextContent('Planned, nothing started, and the programme is quiet · closes now');
    expect(closing[11]).toHaveTextContent('Run 899 · prog-899');
    expect(closing[11]).toHaveTextContent('closes in 5 h');
    expect(closing[13]).toHaveTextContent('A review of work that is already closed');
  });

  it('a run the row fits but the lane holds, such as 1085 with a live session, is named under the list and not in it', async () => {
    mount(view());
    await flush();
    fireEvent.click(within(rowOf('never-started')).getByRole('button', { name: 'Turn on' }));
    const sheet = await screen.findByTestId('run-close-sheet');
    const closing = within(sheet).getByRole('list', { name: 'Would close' });
    expect(within(closing).queryByText(/Run 1085/)).toBeNull();
    const named = within(sheet).getByRole('list', { name: 'Not closing' });
    expect(within(named).getByText(/Run 1085/).closest('li')).toHaveTextContent('it has a live session');
  });

  it('a run whose E1 warning cannot be delivered, such as 65, 66 and 83 under an archived coordinator, is named and not counted', async () => {
    mount(view());
    await flush();
    fireEvent.click(within(rowOf('never-started')).getByRole('button', { name: 'Turn on' }));
    const sheet = await screen.findByTestId('run-close-sheet');
    expect(within(within(sheet).getByRole('list', { name: 'Would close' })).queryByText(/Run 65 ·/)).toBeNull();
    const named = within(sheet).getByRole('list', { name: 'Not closing' });
    expect(within(named).getByText(/Run 65 ·/).closest('li')).toHaveTextContent('Open the coordinator');
    expect(within(named).getByText(/Run 66 ·/)).toBeInTheDocument();
    expect(within(sheet).getByTestId('run-close-sheet-count')).toHaveTextContent('14 runs would close');
  });

  it("the Advanced row's count matches the sheet's", async () => {
    mount(view());
    await flush();
    const row = within(rowOf('never-started')).getByTestId('run-close-count').textContent;
    expect(row).toBe('14 runs would close, 11 now and 3 when their time runs out.');
    fireEvent.click(within(rowOf('never-started')).getByRole('button', { name: 'Turn on' }));
    expect((await screen.findByTestId('run-close-sheet-count')).textContent).toBe(row);
  });

  it('Turn on sends the group and choice once, Keep it in shadow sends nothing, and Turn off and Back to shadow act at once', async () => {
    const m = mount(view(), async () => ({ ok: true, ...view(group('never-started', { choice: 'on', state: 'on' }), group('claimant-crashed')) }));
    await flush();
    fireEvent.click(within(rowOf('never-started')).getByRole('button', { name: 'Turn on' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep it in shadow' }));
    expect(m.writeRunClose).not.toHaveBeenCalled();
    fireEvent.click(within(rowOf('never-started')).getByRole('button', { name: 'Turn on' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn on' }));
    await flush();
    expect(m.writeRunClose).toHaveBeenCalledTimes(1);
    expect(m.writeRunClose).toHaveBeenCalledWith({ group: 'never-started', choice: 'on' });
    // The reply is installed as the view: the row now reads On.
    expect(within(rowOf('never-started')).getByText('On')).toBeInTheDocument();
    fireEvent.click(within(rowOf('never-started')).getByRole('button', { name: 'Back to shadow' }));
    await flush();
    expect(m.writeRunClose).toHaveBeenLastCalledWith({ group: 'never-started', choice: 'shadow' });
    fireEvent.click(within(rowOf('claimant-crashed')).getByRole('button', { name: 'Turn off' }));
    await flush();
    expect(m.writeRunClose).toHaveBeenLastCalledWith({ group: 'claimant-crashed', choice: 'off' });
  });

  it('while coordination is paused every row reads held with no would-close list, and Turn on is disabled (o12)', async () => {
    mount(view(
      group('never-started', { state: 'held', held: 'coordination-paused' }),
      group('claimant-crashed', { state: 'held', held: 'coordination-paused' }),
    ));
    await flush();
    for (const g of ['never-started', 'claimant-crashed']) {
      const row = rowOf(g);
      expect(within(row).getByText('Held')).toBeInTheDocument();
      expect(within(row).getByText('Held while coordination is paused.')).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'Turn on' })).toBeDisabled();
      expect(within(row).queryByTestId('run-close-count')).toBeNull();
    }
  });

  it('an off row cannot be turned on blind: it offers Back to shadow first', async () => {
    mount(view(group('never-started', { choice: 'off', state: 'off' }), group('claimant-crashed')));
    await flush();
    const row = rowOf('never-started');
    expect(within(row).getByText('Off')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Turn on' })).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Back to shadow' })).toBeEnabled();
  });

  it('a marker remains an emergency override: the row says so and offers no control it could not keep', async () => {
    mount(view(group('never-started', { choice: 'off', state: 'on', marker: 'set' }), group('claimant-crashed')));
    await flush();
    const row = rowOf('never-started');
    expect(within(row).getByText('On')).toBeInTheDocument();
    expect(within(row).getByText(/A marker on the box arms this group/)).toBeInTheDocument();
    expect(within(row).queryAllByRole('button')).toHaveLength(0);
  });

  it('the crash row gets the same control; its sheet has no list to show', async () => {
    mount(view());
    await flush();
    const row = rowOf('claimant-crashed');
    expect(within(row).getByText('Shadow')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Turn off' })).toBeEnabled();
    fireEvent.click(within(row).getByRole('button', { name: 'Turn on' }));
    const sheet = await screen.findByTestId('run-close-sheet');
    expect(within(sheet).getByText(/closes the runs of a coordinator that crashed/)).toBeInTheDocument();
    expect(within(sheet).queryByRole('list')).toBeNull();
  });

  it('closes and refusals of the last 7 days show per group', async () => {
    mount(view(fourteen(), group('claimant-crashed', { closed7d: 2, refused7d: 0 })));
    await flush();
    expect(within(rowOf('never-started')).getByText('Last 7 days: 3 closed, 1 refused.')).toBeInTheDocument();
    expect(within(rowOf('claimant-crashed')).getByText('Last 7 days: 2 closed, 0 refused.')).toBeInTheDocument();
  });

  it('a read that fails says so with a way to try again, and a write that fails toasts and re-reads', async () => {
    let calls = 0;
    mount(async () => { calls += 1; if (calls === 1) throw new Error('down'); return { ok: true, ...view() }; });
    await flush();
    expect(screen.getByText(/Could not read what ccrc closes on its own/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(rowOf('never-started')).toBeInTheDocument();
  });
});
