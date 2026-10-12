// Child-reclamation wave 6, Task 12 (spec §5.9): the board's second trigger.
// Wave 5 re-reads the archive when a finished child's session leaves the fleet
// frame, but ccd journals the reclaim's end after the purge, so that read
// usually races the server's journal mirror and the row reads no chip. The
// coord frame now carries the newest reclaim end the mirror has committed;
// the board re-reads once per CHANGE of it, never on null, never on a timer,
// and only while some finished row is still unsettled.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ChildReclaimStatus, CoordCapsView, CoordStatus, FleetSession, RunSummary } from '../../shared/api';
import { RunsScreen } from '../src/screens/RunsScreen';
import { childReclaimDoneRefreshDue, childRunsSeen } from '../src/fleet/runWords';
import { childReclaimDoneAtOf } from '../src/fleet/childReclaimWords';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// ── fixtures copied verbatim from runs-screen.test.tsx ──
const r = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'build4-transcript-surface', programTitle: 'Build 4: transcript surface',
  wave: 3, waveOf: 4, project: 'ccrc-pwa', homeProject: null,
  sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
  state: 'working', kind: 'work', reviews: null,
  claimedBy: 'ccrc-pwa-coordinator', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, ...over,
});

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'ccrc-pwa-clear-cove', wrapper: 'claude', home: 'claude', project: 'ccrc-pwa',
  workdir: '/w', workspace: 'clear-cove', name: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/clear-cove', ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null,
  bucket: 'working', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null, started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null, ...over,
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});
// ── end of copied fixtures ──

const T = 1_758_500_000_000;
const coordWith = (doneAt?: number, over: Partial<CoordStatus> = {}): CoordStatus => ({
  pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [],
  ...(doneAt === undefined ? {} : { childReclaimDoneAt: doneAt }), ...over,
});
const finished = (id: number, word: ChildReclaimStatus['word'] | null): RunSummary =>
  r({ id, state: 'done', closedAt: Date.now() - 60_000,
      childReclaim: word === null ? null : { word, sentence: null, at: null } });

/** One board whose cold read answers `rows`. The coord frame is already seen at
 *  `doneAt`, unless `coordSeen` is false. */
const board = async (rows: RunSummary[],
  opts: { doneAt?: number; sessions?: FleetSession[]; coordSeen?: boolean } = {}) => {
  const store = makeStore();
  act(() => { store.setState({ runs: [], runsFrameSeen: true, sessions: opts.sessions ?? [], fleetFrameSeen: true,
    coord: opts.coordSeen === false ? null : coordWith(opts.doneAt), coordFrameSeen: opts.coordSeen !== false }); });
  const loadRuns = vi.fn(async (): Promise<{ runs: RunSummary[] }> => ({ runs: rows }));
  render(<RunsScreen store={store} loadRuns={loadRuns} loadCaps={NO_CAPS} />);
  await screen.findByRole('group', { name: /finished/i });
  expect(loadRuns).toHaveBeenCalledTimes(1);
  return { store, loadRuns };
};
const frame = (store: FleetStore, c: CoordStatus): void => {
  act(() => { store.setState({ coord: c, coordFrameSeen: true }); });
};
/** Long enough for a fired read to have been issued. */
const settle = async (): Promise<void> => { await act(async () => { await new Promise((res) => setTimeout(res, 60)); }); };

describe('childReclaimDoneAtOf — the one reader, absence permits', () => {
  it('reads a finite number, and null for everything else, an older server’s frame included', () => {
    expect(childReclaimDoneAtOf({ pause: 'clear', mail: 'clear' })).toBeNull();   // predates the field
    expect(childReclaimDoneAtOf(null)).toBeNull();
    expect(childReclaimDoneAtOf({ childReclaimDoneAt: null })).toBeNull();
    expect(childReclaimDoneAtOf({ childReclaimDoneAt: '1758500000000' })).toBeNull();
    expect(childReclaimDoneAtOf({ childReclaimDoneAt: Number.NaN })).toBeNull();
    expect(childReclaimDoneAtOf(coordWith(T))).toBe(T);
  });
});

describe('childReclaimDoneRefreshDue — once per change, never a poll', () => {
  const none = new Set<number>();
  it('is due on a change while a finished row reads pending, deferred or paused', () => {
    for (const word of ['pending', 'deferred', 'paused'] as const) {
      expect(childReclaimDoneRefreshDue([finished(7, word)], none, T, T + 1), word).toBe(true);
    }
  });

  it('is due on ANY change: down as well as up, and from null; never only on an increase', () => {
    expect(childReclaimDoneRefreshDue([finished(7, 'pending')], none, T + 10, T + 5)).toBe(true);
    expect(childReclaimDoneRefreshDue([finished(7, 'pending')], none, null, T)).toBe(true);
  });

  it('is not due on null, or when nothing changed', () => {
    expect(childReclaimDoneRefreshDue([finished(7, 'pending')], none, T, null)).toBe(false);
    expect(childReclaimDoneRefreshDue([finished(7, 'pending')], none, T, T)).toBe(false);
  });

  it('reads a row with no chip as unsettled only when its run had a child', () => {
    expect(childReclaimDoneRefreshDue([finished(7, null)], none, T, T + 1)).toBe(false);
    expect(childReclaimDoneRefreshDue([finished(7, null)], new Set([7]), T, T + 1)).toBe(true);
  });

  it('is not due when every finished row is settled, nor for an open row', () => {
    expect(childReclaimDoneRefreshDue([finished(7, 'reclaimed'), finished(8, 'refused')], new Set([7, 8]), T, T + 1))
      .toBe(false);
    expect(childReclaimDoneRefreshDue([r({ id: 7, state: 'working' })], new Set([7]), T, T + 1)).toBe(false);
  });
});

describe('childRunsSeen — which runs had a child, remembered across frames', () => {
  it('takes a run a fleet frame marked as a child’s, and a finished row that carried a chip', () => {
    const seen = childRunsSeen(new Set(), [
      sess({ child: { kind: 'child', runId: 41 } }),
      sess({ id: 'ccrc-pwa-keen-dune', child: { kind: 'unreadable' } }),
      sess({ id: 'ccrc-pwa-calm-reef' }),
    ], [finished(7, 'pending'), finished(8, null)]);
    expect([...seen].sort((a, b) => a - b)).toEqual([7, 41]);
  });

  it('never forgets: a later frame without the child keeps the run', () => {
    const once = childRunsSeen(new Set(), [sess({ child: { kind: 'child', runId: 41 } })], []);
    expect([...childRunsSeen(once, [], [])]).toEqual([41]);
  });
});

describe('the board re-reads the archive when the newest reclaim end changes (wave 6)', () => {
  it('re-reads once when the value changes and a finished row is still pending', async () => {
    const { store, loadRuns } = await board([finished(7, 'pending')], { doneAt: T });
    frame(store, coordWith(T + 1));
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2));
    frame(store, coordWith(T + 1, { pause: 'set' }));          // a new frame, the same value
    await settle();
    expect(loadRuns).toHaveBeenCalledTimes(2);
  });

  it('a null is never a reason to read: a restarted server, then its first measured value', async () => {
    const { store, loadRuns } = await board([finished(7, 'pending')], { doneAt: T });
    frame(store, coordWith());                                   // restarted: the field is absent
    await settle();
    expect(loadRuns).toHaveBeenCalledTimes(1);
    frame(store, coordWith(T));                                  // the same instant, but a change from null
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2));
  });

  it('the race row: no chip, but this board saw its child in a fleet frame', async () => {
    const child = sess({ child: { kind: 'child', runId: 7 } });
    const { store, loadRuns } = await board([finished(7, null)], { doneAt: T, sessions: [child] });
    act(() => { store.setState({ sessions: [] }); });           // the vanish: wave 5 sees no chip and stays quiet
    await settle();
    expect(loadRuns).toHaveBeenCalledTimes(1);
    frame(store, coordWith(T + 1));
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2));
  });

  it('the race row after wave 5’s re-read: pending before, no chip now', async () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [], runsFrameSeen: true, sessions: [sess()], fleetFrameSeen: true,
      coord: coordWith(T), coordFrameSeen: true }); });
    const loadRuns = vi.fn<() => Promise<{ runs: RunSummary[] }>>()
      .mockResolvedValueOnce({ runs: [finished(7, 'pending')] })
      .mockResolvedValue({ runs: [finished(7, null)] });
    render(<RunsScreen store={store} loadRuns={loadRuns} loadCaps={NO_CAPS} />);
    await screen.findByRole('group', { name: /finished/i });
    act(() => { store.setState({ sessions: [] }); });           // wave 5's trigger: it reads, and races
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2));
    await settle();
    frame(store, coordWith(T + 1));
    await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(3));
  });

  it('does not re-read when every finished row is settled, or on the first frame it sees', async () => {
    const settled = await board([finished(7, 'reclaimed'), finished(8, 'refused'), finished(9, null)], { doneAt: T });
    frame(settled.store, coordWith(T + 1));
    await settle();
    expect(settled.loadRuns, 'a settled board re-read').toHaveBeenCalledTimes(1);
    cleanup();
    const late = await board([finished(7, 'pending')], { coordSeen: false });
    frame(late.store, coordWith(T));                             // the first frame: a baseline
    await settle();
    expect(late.loadRuns, 'the first frame was read as a change').toHaveBeenCalledTimes(1);
    frame(late.store, coordWith(T + 1));                         // and the baseline was taken
    await waitFor(() => expect(late.loadRuns).toHaveBeenCalledTimes(2));
  });

  it('an older server: frames that never carry the field never read', async () => {
    const { store, loadRuns } = await board([finished(7, 'pending')]);
    frame(store, coordWith(undefined, { pause: 'set' }));
    frame(store, coordWith(undefined, { mail: 'set' }));
    await settle();
    expect(loadRuns).toHaveBeenCalledTimes(1);
  });
});
