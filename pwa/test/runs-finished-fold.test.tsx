// The Runs board folds its finished runs (D-6442).
//
// The Finished group used to mount every closed run the cold read returns, up
// to 500 (`closedLimit ?? 500`, server side), and the board's one `useNow` hands
// every row a new `nowMs` each second while a dispatch is pending. This file
// holds the fold: the first 20 rows, a Show more door, the group's total in its
// name, no re-render of a finished row on a 1 s tick, and focus on the heading
// when the last batch shows.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CoordCapsView, RunSummary } from '../../shared/api';
import { RunsScreen } from '../src/screens/RunsScreen';
import { FINISHED_FOLD, finishedClock, finishedMoreLabel, runWarnings } from '../src/fleet/runWords';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

// `runWarnings` is the one pure call every RunRow render makes, so a spy on it
// counts row renders. A partial mock: the real function still answers.
vi.mock('../src/fleet/runWords', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/fleet/runWords')>();
  return { ...real, runWarnings: vi.fn(real.runWarnings) };
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const T0 = 1_800_000_000_000;

/** A finished run. The workspace carries the id, so a row's `title`
 *  (`run <id> · ws-a-<id>`) names its run without reading the DOM's order. */
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'programme-a', programTitle: 'Programme A',
  wave: 1, waveOf: 1, project: 'project-a', homeProject: null,
  sessionId: 'lane-a-ws-a', workspace: 'ws-a', branch: 'ws/ws-a',
  state: 'done', kind: 'work', reviews: null,
  claimedBy: 'lane-a-coordinator', resumed: false, clearedAt: null,
  openedAt: T0 - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: T0 - 900_000, closedAt: T0 - 60_000,
  handoffCommit: null, items: { done: 3, total: 3 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, ...over,
});

/** `n` closed runs, ids 1..n, run `i` closed at `T0 + i * 60 s`, handed over in
 *  an ODD-then-EVEN order so the board's sort is what orders them. */
const closedRuns = (n: number): RunSummary[] => {
  const rows = Array.from({ length: n }, (_, k) => k + 1).map((id) => run({
    id, sessionId: `lane-a-ws-a-${id}`, workspace: `ws-a-${id}`, branch: `ws/ws-a-${id}`,
    closedAt: T0 + id * 60_000, dispatchedAt: T0 + id * 60_000 - 600_000,
  }));
  return [...rows.filter((x) => x.id % 2 === 1), ...rows.filter((x) => x.id % 2 === 0).reverse()];
};

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});
const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});

/** Mounts the board with `active` on the live frame and `archive` as the cold read. */
const mount = async (archive: RunSummary[], active: RunSummary[] = []): Promise<void> => {
  const store = makeStore();
  act(() => { store.setState({ runs: active, runsFrameSeen: true, fleetFrameSeen: true }); });
  render(<RunsScreen store={store} loadCaps={NO_CAPS} loadRuns={async () => ({ runs: [...active, ...archive] })} />);
  await act(async () => { await Promise.resolve(); });
};

const finishedGroup = (): HTMLElement => {
  const g = document.querySelector<HTMLElement>('[role="group"][aria-label^="finished"]');
  if (g === null) throw new Error('no Finished group');
  return g;
};
const finishedRows = (): HTMLElement[] => [...finishedGroup().querySelectorAll<HTMLElement>('li.run-row')];
/** The run ids of the Finished group's rows, in DOM order, read off each row's title. */
const finishedIds = (): number[] =>
  finishedRows().map((li) => Number(/^run (\d+) /.exec(li.getAttribute('title') ?? '')?.[1]));

describe('the Finished group before the fold — characterization (D-6442)', () => {
  it('the first 20 finished rows are today’s newest 20, in today’s order', async () => {
    await mount(closedRuns(25));
    // Newest close first: run `i` closed at `T0 + i * 60 s`, so 25 leads. The ids
    // are recorded as values, so a change of order or of the cut is a red diff.
    expect(finishedIds().slice(0, 20)).toEqual(
      [25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
  });
});

const door = (): HTMLElement | null => screen.queryByRole('button', { name: /more finished runs?/ });

describe('the Finished group folds (D-6442)', () => {
  it('500 closed runs mount at most 20 RunRow', async () => {
    await mount(closedRuns(500));
    expect(FINISHED_FOLD).toBe(20);
    expect(finishedRows().length).toBeLessThanOrEqual(20);
    expect(finishedRows()).toHaveLength(20);
  });

  it('Show more reveals the next 20', async () => {
    await mount(closedRuns(500));
    fireEvent.click(door()!);
    // The next 20 are the next-newest: nothing reordered, nothing skipped.
    expect(finishedIds()).toEqual(Array.from({ length: 40 }, (_, k) => 500 - k));
    expect(door()).toHaveAccessibleName('Show 20 more finished runs, 460 not shown');
  });

  it('the Finished group’s name keeps the total', async () => {
    await mount(closedRuns(500));
    expect(screen.getByRole('group', { name: 'finished (500)' })).toBeInTheDocument();
    fireEvent.click(door()!);
    expect(screen.getByRole('group', { name: 'finished (500)' })).toBeInTheDocument();
  });

  it('shows no door for a group that fits in one batch', async () => {
    await mount(closedRuns(FINISHED_FOLD));
    expect(finishedRows()).toHaveLength(FINISHED_FOLD);
    expect(door()).toBeNull();
  });

  it('the last Show more moves focus to the Finished heading, never the body', async () => {
    await mount(closedRuns(25));
    expect(door()).toHaveAccessibleName('Show 5 more finished runs');
    fireEvent.click(door()!);
    expect(finishedRows()).toHaveLength(25);
    expect(door()).toBeNull();
    const head = finishedGroup().querySelector('.runs-group-head');
    expect(head).not.toBeNull();
    expect(document.activeElement).toBe(head);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('a middle Show more leaves focus on its door', async () => {
    await mount(closedRuns(45));
    const d = door()!;
    d.focus();
    fireEvent.click(d);
    expect(finishedRows()).toHaveLength(40);
    expect(document.activeElement).toBe(door());
  });
});

describe('a one-second tick (D-6442)', () => {
  // The board ticks each second while a dispatch is pending. A 30 s boundary of
  // the finished clock is `1_800_000_000_000` exactly; the clock starts one
  // second past it, so the six ticks below stay inside one finished-clock step.
  const BOUNDARY = 1_800_000_000_000;

  it('a 1 s tick re-renders no finished RunRow', async () => {
    vi.useFakeTimers({ now: BOUNDARY + 1_000 });
    const pending = run({
      id: 900, program: 'programme-b', programTitle: 'Programme B', state: 'planned', sessionId: null,
      workspace: null, branch: null, dispatchedAt: null, closedAt: null,
      dispatchStartedAt: BOUNDARY + 1_000 - 42_000,
    });
    await mount(closedRuns(30), [pending]);
    const calls = (): RunSummary[] => vi.mocked(runWarnings).mock.calls.map((c) => c[0] as RunSummary);
    expect(calls().length).toBeGreaterThan(0);
    vi.mocked(runWarnings).mockClear();
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    // The instrument works in the other direction: the open row, which does read
    // the second, DID re-render on those ticks.
    expect(calls().filter((x) => x.state === 'planned').length).toBeGreaterThanOrEqual(6);
    expect(calls().filter((x) => x.state === 'done')).toHaveLength(0);
    expect(document.querySelector('.run-dispatch')?.textContent).toContain('0:48');
  });
});

describe('the fold’s words (D-6442)', () => {
  it('finishedMoreLabel names the next batch and what stays hidden', async () => {
    expect(finishedMoreLabel(20, 480)).toBe('Show 20 more finished runs, 480 not shown');
    expect(finishedMoreLabel(20, 21)).toBe('Show 20 more finished runs, 21 not shown');
    // The last batch: nothing stays hidden, so the sentence stops there.
    expect(finishedMoreLabel(7, 7)).toBe('Show 7 more finished runs');
    expect(finishedMoreLabel(20, 20)).toBe('Show 20 more finished runs');
    expect(finishedMoreLabel(1, 1)).toBe('Show 1 more finished run');
    // And the door carries it: 500 rows, 20 shown, 480 not shown.
    await mount(closedRuns(500));
    expect(door()).toHaveAccessibleName('Show 20 more finished runs, 480 not shown');
    expect(door()?.textContent).toBe('Show 20 more finished runs, 480 not shown');
  });

  it('finishedClock floors to 30 s', () => {
    const b = 1_800_000_000_000;
    expect(finishedClock(b)).toBe(b);
    expect(finishedClock(b + 499)).toBe(b);
    expect(finishedClock(b + 29_999)).toBe(b);
    expect(finishedClock(b + 30_000)).toBe(b + 30_000);
    expect(finishedClock(b + 59_999)).toBe(b + 30_000);
  });
});

describe('measurement — Step 0 of C10 (D-6442)', () => {
  // No timing assertion: the numbers go to the console and the PR body. Real
  // `performance.now` is left alone (only timers and Date are faked), because a
  // faked clock would report every Profiler duration as zero.
  const pct = (xs: number[], q: number): number => {
    const v = [...xs].sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(q * v.length))]!;
  };

  it('500 closed runs and one pending dispatch: mount, then 20 one-second ticks', async () => {
    const BOUNDARY = 1_800_000_000_000;
    vi.useFakeTimers({ now: BOUNDARY + 1_000, toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    const pending = run({
      id: 900, program: 'programme-b', programTitle: 'Programme B', state: 'planned', sessionId: null,
      workspace: null, branch: null, dispatchedAt: null, closedAt: null,
      dispatchStartedAt: BOUNDARY + 1_000 - 42_000,
    });
    const archive = closedRuns(500);
    const store = makeStore();
    act(() => { store.setState({ runs: [pending], runsFrameSeen: true, fleetFrameSeen: true }); });
    const commits: number[] = [];
    render(
      <Profiler id="runs" onRender={(_id, _phase, actual) => { commits.push(actual); }}>
        <RunsScreen store={store} loadCaps={NO_CAPS} loadRuns={async () => ({ runs: [pending, ...archive] })} />
      </Profiler>,
    );
    commits.length = 0;
    const t0 = performance.now();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const mountWall = performance.now() - t0;
    const mountRender = commits.reduce((a, b) => a + b, 0);
    expect(finishedRows().length).toBeGreaterThan(0);

    commits.length = 0;
    const walls: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t = performance.now();
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
      walls.push(performance.now() - t);
    }
    // One commit a tick: the instrument saw each of them.
    expect(commits.length).toBeGreaterThanOrEqual(20);
    const f = (n: number): string => n.toFixed(1);
    console.info(
      `[C10 step 0] finished rows mounted ${finishedRows().length}; `
      + `mount: render ${f(mountRender)} ms, wall ${f(mountWall)} ms; `
      + `tick re-render (Profiler actualDuration, ${commits.length} commits): median ${f(pct(commits, 0.5))} ms, p90 ${f(pct(commits, 0.9))} ms; `
      + `tick wall: median ${f(pct(walls, 0.5))} ms, p90 ${f(pct(walls, 0.9))} ms`,
    );
  }, 120_000);
});
