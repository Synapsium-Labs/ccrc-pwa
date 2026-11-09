// Advanced, the board's foot and Finished's read (the runs rebuild, Task 11, D-8073; spec 2026-11-04 §8.2, §8.2.3, §8.6, F10,
// F18, o13). Placeholders only. The reads are injected: `read` for Advanced, `loadFinished` and `loadArchive` for the board.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CoordCapsView, RunHit, RunSummary } from '../../shared/api';
import { ApiError, api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { clearScreenCache } from '../src/lib/screenCache';
import { runsAdvancedPath, runsClosedSinceOf, runsFilterOf } from '../src/lib/routes';
import { RunsAdvancedScreen } from '../src/screens/RunsAdvancedScreen';
import type { FindReader } from '../src/screens/useRunList';
import { fleetSession } from './fleetFixture';
import { RunsScreen, foundRows } from './runs-board';
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

describe('the board while no frame has landed', () => {
  it('a Finished row offers no Resume, since an open wave of its programme may exist', async () => {
    const dead = fleetSession({ id: 'sess-coord', status: 'dead', lifecycle: 'orphan', workspace: null, branch: null });
    const store = makeStore();
    act(() => { store.setState({ sessions: [dead], fleetFrameSeen: true }); });
    render(<RunsScreen store={store} loadFinished={async () => answer([hit(3)])} />);
    await flush();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(document.querySelectorAll('li.run-row')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /resume run 3/i })).toBeNull();
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

describe('Finished reads find, in close order (§8.2.3, F10, F18)', () => {
  const board = (props: Partial<React.ComponentProps<typeof RunsScreen>> & { live?: RunSummary[]; frame?: boolean } = {}) => {
    const { live = [], frame = true, ...rest } = props;
    const store = makeStore();
    if (frame) act(() => { store.setState({ runs: live, runsFrameSeen: true, sessions: [], fleetFrameSeen: true }); });
    const view = render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} {...rest} />);
    return { store, ...view };
  };
  const finishedIds = (): number[] => [...document.querySelectorAll<HTMLElement>('[role="group"][aria-label^="finished"] li.run-row')]
    .map((li) => Number(/^run (\d+) /.exec(li.getAttribute('title') ?? '')?.[1]));

  it('the board’s own call is fixed: closed runs, 50 at a time, nothing a new server refuses', async () => {
    const spy = vi.spyOn(api, 'findRuns').mockResolvedValue(answer([hit(3)]));
    board({ loadRuns: undefined, loadFinished: undefined });
    await flush();
    expect(spy).toHaveBeenCalledWith({ scope: 'closed', limit: 50 });
  });

  it('Finished no longer reads the paged archive', async () => {
    const archive = vi.fn(async () => ({ runs: [run(5, { state: 'done', closedAt: NOW }), run(6, { state: 'done', closedAt: NOW })] }));
    const runsRead = vi.spyOn(api, 'runs');
    board({ loadRuns: archive, loadFinished: async () => answer([hit(6)]) });
    await flush();
    expect(archive).not.toHaveBeenCalled();
    expect(runsRead).not.toHaveBeenCalled();
    expect(finishedIds()).toEqual([6]);
  });

  it('a just-abandoned old run heads Finished', async () => {
    let n = 0;
    const store = makeStore();
    act(() => { store.setState({ runs: [run(9)], runsFrameSeen: true, sessions: [], fleetFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS}
      loadFinished={async () => { n += 1; return answer(n === 1 ? [hit(20)] : [hit(9, { closedAt: NOW, closedBy: 'operator' }), hit(20)]); }} />);
    await flush();
    expect(finishedIds()).toEqual([20]);
    act(() => { store.setState({ runs: [] }); });
    await flush();
    expect(finishedIds()).toEqual([9, 20]);
  });

  it('a Finished row of a programme with no open run still offers Resume, as today', async () => {
    const dead = fleetSession({ id: 'sess-coord', status: 'dead', lifecycle: 'orphan', workspace: null, branch: null });
    const store = makeStore();
    act(() => { store.setState({ runs: [], runsFrameSeen: true, sessions: [dead], fleetFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} loadFinished={async () => answer([hit(3)])} />);
    await flush();
    expect(screen.getByRole('button', { name: /resume run 3/i })).toBeInTheDocument();
  });

  it('a Finished row beside an open wave offers none', async () => {
    const dead = fleetSession({ id: 'sess-coord', status: 'dead', lifecycle: 'orphan', workspace: null, branch: null });
    const store = makeStore();
    act(() => { store.setState({ runs: [run(4)], runsFrameSeen: true, sessions: [dead], fleetFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} loadFinished={async () => answer([hit(3)])} />);
    await flush();
    expect(finishedIds()).toEqual([3]);
    expect(screen.queryByRole('button', { name: /resume run 3/i })).toBeNull();
  });

  describe('the board’s states (§8.2)', () => {
    const FAILED = 'Could not reach the server — runs may exist that are not shown.';
    it('before the first frame and before Finished answers, the board says Loading…', async () => {
      board({ frame: false, loadRuns: NEVER, loadFinished: NEVER });
      await flush();
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByText('No runs open.')).toBeNull();
    });

    it('a failed Finished read with no frame says Could not reach the server, never No runs open.', async () => {
      board({ frame: false, loadRuns: NEVER, loadFinished: async () => { throw new Error('down'); } });
      await flush();
      expect(screen.getByText(FAILED)).toBeInTheDocument();
      expect(screen.queryByText('No runs open.')).toBeNull();
    });

    it('with the frame seen, no open run and a failed Finished read, it says the same', async () => {
      board({ loadFinished: async () => { throw new Error('down'); } });
      await flush();
      expect(screen.getByText(FAILED)).toBeInTheDocument();
      expect(screen.queryByText('No runs open.')).toBeNull();
    });

    it('with open runs and a failed Finished read, the Finished group says it could not be read', async () => {
      board({ live: [run(5)], loadFinished: async () => { throw new Error('down'); } });
      await flush();
      const g = screen.getByRole('group', { name: 'finished, unknown' });
      expect(within(g).getByText('Could not reach the server — finished runs may exist that are not shown.')).toBeInTheDocument();
    });

    it('Finished answering before the frame and the paged read never claims "No runs open."; the board reads Loading', async () => {
      const { store } = board({ frame: false, loadRuns: NEVER, loadFinished: async () => answer([]) });
      await flush();
      expect(screen.queryByText('No runs open.')).toBeNull();
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      act(() => { store.setState({ runs: [], runsFrameSeen: true }); });
      expect(screen.getByText('No runs open.')).toBeInTheDocument();
    });

    it('with Finished answered ok and no frame yet, the open half says Loading… and never No runs open., and Finished’s rows show', async () => {
      board({ frame: false, loadFinished: async () => answer([hit(3)]) });
      await flush();
      expect(screen.getByText('Loading…').closest('[data-state]')).toHaveAttribute('data-state', 'loading');
      expect(screen.queryByText('No runs open.')).toBeNull();
      expect(finishedIds()).toEqual([3]);
    });

    it('the same holds when the server never sends a frame', async () => {
      vi.useFakeTimers();
      try {
        board({ frame: false, loadFinished: async () => answer([hit(3)]) });
        await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
        expect(screen.getByText('Loading…')).toBeInTheDocument();
        expect(screen.queryByText('No runs open.')).toBeNull();
        expect(finishedIds()).toEqual([3]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('an older server’s Finished reads as answered: the open half still waits for the frame, and the older line shows', async () => {
      const older = async (): ReturnType<FindReader> => { throw new ApiError(404, { ok: false }); };
      board({ frame: false, loadFinished: older, loadArchive: async () => ({ runs: [run(7, { state: 'done', closedAt: NOW })] }) });
      await flush();
      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.getByText('This server is older, so Finished shows only the runs it can list.')).toBeInTheDocument();
      expect(finishedIds()).toEqual([7]);
    });

    it('no state reads the removed coldState', () => {
      const text = readFileSync(resolve(__dirname, '../src/screens/RunsScreen.tsx'), 'utf8');
      expect(text).not.toMatch(/\bcoldState\b/);
      expect(text).not.toMatch(/useColdRuns\(|runsPage|runPages/);
    });

    it('a held Finished answer is a signal even when its re-read fails', async () => {
      let n = 0;
      const { store } = board({ frame: false, loadRuns: NEVER, loadFinished: async () => { n += 1; if (n > 1) throw new Error('down'); return answer([hit(3)]); } });
      await flush();
      act(() => { store.setState({ runs: [run(9)], runsFrameSeen: true }); });
      expect(finishedIds()).toEqual([3]);
      act(() => { store.setState({ runs: [] }); });                // a close: Finished is read again, and the read fails
      await flush();
      expect(finishedIds()).toEqual([3]);
      expect(screen.queryByText(FAILED)).toBeNull();
      expect(screen.getByText('Could not reach the server — finished runs may exist that are not shown.')).toBeInTheDocument();
    });
  });

  describe('against an older server (§8.2.3)', () => {
    const OLDER = 'This server is older, so Finished shows only the runs it can list.';
    const archive = [run(5, { state: 'done', closedAt: NOW - 5_000 }), run(6, { state: 'done', closedAt: NOW - 1_000 }), run(7)];
    const refuse = (status: number, code: string) => async (): Promise<never> => { throw new ApiError(status, { error: code }); };

    it('whose find reaches GET /api/runs/:id and answers 400 bad-request, Finished reads the unpaged archive, sorts it by closedAt, and says so', async () => {
      const unpaged = vi.fn(async () => ({ runs: archive }));
      board({ loadFinished: refuse(400, 'bad-request'), loadArchive: unpaged });
      await flush();
      expect(unpaged).toHaveBeenCalledTimes(1);
      expect(finishedIds()).toEqual([6, 5]);
      expect(screen.getByText(OLDER)).toBeInTheDocument();
    });

    it('that case never reads as failed or as empty', async () => {
      board({ loadFinished: refuse(400, 'bad-request'), loadArchive: async () => ({ runs: [] }) });
      await flush();
      expect(document.querySelector('[data-state="error"]')).toBeNull();
      expect(screen.queryByText(/Could not reach the server/)).toBeNull();
      expect(screen.getByText(OLDER)).toBeInTheDocument();
    });

    it('a 404 from find reads the same', async () => {
      board({ loadFinished: refuse(404, 'not-found'), loadArchive: async () => ({ runs: archive }) });
      await flush();
      expect(finishedIds()).toEqual([6, 5]);
      expect(screen.getByText(OLDER)).toBeInTheDocument();
    });

    it('a 400 with another error code reads as failed', async () => {
      const unpaged = vi.fn(async () => ({ runs: archive }));
      board({ loadFinished: refuse(400, 'bad-limit'), loadArchive: unpaged });
      await flush();
      expect(unpaged).not.toHaveBeenCalled();
      expect(screen.queryByText(OLDER)).toBeNull();
      expect(screen.getByText(/Could not reach the server/)).toBeInTheDocument();
    });

    it('a find that fails for any other reason shows as failed, as today’s cold read does', async () => {
      board({ loadFinished: refuse(500, 'server-error'), loadArchive: async () => ({ runs: archive }) });
      await flush();
      expect(screen.queryByText(OLDER)).toBeNull();
      expect(screen.getByText(/Could not reach the server/)).toBeInTheDocument();
    });

    it('an unpaged archive that cannot be read is a failure', async () => {
      board({ loadFinished: refuse(400, 'bad-request'), loadArchive: async () => { throw new Error('down'); } });
      await flush();
      expect(screen.getByText(/Could not reach the server/)).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText(OLDER)).toBeNull());
    });
  });
});
