// The runs page at a glance (D-6170, spec §5 W0, G5 (a)). A row is named by its
// programme's title and wave in words, never a workspace, a branch or a run
// number; the run number stays only in the controls' accessible names and the
// row's title (D-5589); Abandon is drawn on open rows only; a group head prints
// the programme's title. "today:" rows pin the answer the base gave and are
// flipped by the behaviour commits; "kept:" rows hold across them.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { CoordCapsView, FleetSession, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { RunsScreen } from '../src/screens/RunsScreen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// Neutral fixtures: programme-a titled "Programme A", workspace s-aaaa, run 7.
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 7, program: 'programme-a', programTitle: 'Programme A',
  wave: 3, waveOf: 5, project: 'project-a', homeProject: null,
  sessionId: 'project-a-s-aaaa', workspace: 's-aaaa', branch: 'ws/s-aaaa',
  state: 'working', kind: 'work', reviews: null,
  claimedBy: 'project-a-coordinator', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 1, total: 4 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, ...over,
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});

/** The board with `active` from the live frame and `finished` from the cold read. */
async function board(active: RunSummary[], finished: RunSummary[] = [], sessions: FleetSession[] = []): Promise<HTMLElement> {
  const store = makeStore();
  act(() => {
    store.setState({ runs: active, runsFrameSeen: true, fleetFrameSeen: true, conn: 'open', sessions });
  });
  const load = vi.fn().mockResolvedValue({ runs: finished });
  const { container } = render(<RunsScreen loadCaps={NO_CAPS} store={store} loadRuns={load} />);
  await act(async () => { await Promise.resolve(); });
  return container;
}

const rows = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('li.run-row')];
const nameOf = (row: HTMLElement): string => row.querySelector('.run-ws')?.textContent ?? '';

describe('kept: across D-6170', () => {
  it('kept: an open planned run with no session renders Abandon (the wedge door, D-282)', async () => {
    const c = await board([run({ state: 'planned', sessionId: null, workspace: null, branch: null, dispatchedAt: null })]);
    expect(within(rows(c)[0]!).getByRole('button', { name: 'Abandon run 7' })).toBeInTheDocument();
  });

  it('kept: the resume door on an open run whose claimant is dead', async () => {
    const dead = fleetSession({ id: 'project-a-coordinator', project: 'project-a', status: 'dead', bucket: 'dead', lifecycle: 'orphan' });
    await board([run()], [], [dead]);
    expect(screen.getByRole('button', { name: 'Resume run 7' })).toBeInTheDocument();
  });

  it('kept: the resume door on an all-terminal programme whose claimant is dead', async () => {
    const dead = fleetSession({ id: 'project-a-coordinator', project: 'project-a', status: 'dead', bucket: 'dead', lifecycle: 'orphan' });
    await board([], [run({ state: 'done', closedAt: Date.now() - 1_000 })], [dead]);
    expect(await screen.findByRole('button', { name: 'Resume run 7' })).toBeInTheDocument();
  });

  it("kept: Abandon's accessible name carries the run number", async () => {
    await board([run({ id: 12 })]);
    expect(screen.getByRole('button', { name: 'Abandon run 12' })).toBeInTheDocument();
  });
});

describe('today: before D-6170', () => {
  it('today: a done row and a failed row each render Abandon', async () => {
    const c = await board([run({ id: 1 })], [
      run({ id: 2, state: 'done', closedAt: Date.now() - 2_000 }),
      run({ id: 3, state: 'failed', closedAt: Date.now() - 3_000 }),
    ]);
    await screen.findByRole('button', { name: 'Abandon run 2' });
    expect(rows(c)).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Abandon run 3' })).toBeInTheDocument();
  });

  it('today: a run with no workspace and no branch renders its run number as its name', async () => {
    const c = await board([run({ workspace: null, branch: null })]);
    expect(nameOf(rows(c)[0]!)).toBe('7');
  });

  it('today: a run with a workspace renders the workspace as its name', async () => {
    const c = await board([run()]);
    expect(nameOf(rows(c)[0]!)).toBe('s-aaaa');
  });

  it('today: the group head of programme-a titled "Programme A" prints programme-a', async () => {
    const c = await board([run()]);
    expect(c.querySelector('.runs-group .runs-program')?.textContent).toBe('programme-a');
  });
});
