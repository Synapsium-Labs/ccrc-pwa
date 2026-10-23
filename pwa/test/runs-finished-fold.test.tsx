// The Runs board folds its finished runs (D-6442).
//
// The Finished group used to mount every closed run the cold read returns, up
// to 500 (`closedLimit ?? 500`, server side), and the board's one `useNow` hands
// every row a new `nowMs` each second while a dispatch is pending. This file
// holds the fold: the first 20 rows, a Show more door, the group's total in its
// name, no re-render of a finished row on a 1 s tick, and focus on the heading
// when the last batch shows.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { CoordCapsView, RunSummary } from '../../shared/api';
import { RunsScreen } from '../src/screens/RunsScreen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
