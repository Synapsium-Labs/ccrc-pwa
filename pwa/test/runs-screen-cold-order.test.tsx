// Child-reclamation wave 6, fix round 1 (review 335 F11; spec §5.9): the board's
// archive read has ONE source for a finished row's reclaim chip, and since this
// wave a reclaim puts two reads in flight a tick or two apart (the vanish read
// of wave 5, and the coord frame's second trigger). When the older read
// resolves last it must not overwrite the newer one: the row would show the
// stale "workspace pending" chip, the very symptom the wave exists to fix.
// `loadCold` keeps a high-water mark: only a read NEWER than the last one
// applied may set `cold`, and a rejection older than that is dropped too.
//
// Every read here is a deferred the test settles by hand, in the order it names.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ChildReclaimStatus, CoordCapsView, CoordStatus, RunSummary } from '../../shared/api';
import { RunsScreen } from '../src/screens/RunsScreen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
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
const finished = (word: ChildReclaimStatus['word']): RunSummary =>
  run({ id: 7, state: 'done', closedAt: Date.now() - 60_000, childReclaim: { word, sentence: null, at: null } });

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});
const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});

const T = 1_758_500_000_000;
const coordAt = (doneAt: number): CoordStatus =>
  ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], childReclaimDoneAt: doneAt });

/** One archive read the test settles by hand. */
interface Read { resolve(rows: RunSummary[]): Promise<void>; reject(): Promise<void> }

/** A board whose first read (the mount read) has landed with the row PENDING, and
 *  whose next two reads are in flight: `older` was fired by the first change of
 *  the newest reclaim end, `newer` by the second. Neither has answered. */
const boardWithTwoReadsInFlight = async () => {
  const store = makeStore();
  act(() => { store.setState({ runs: [], runsFrameSeen: true, sessions: [], fleetFrameSeen: true,
    coord: coordAt(T), coordFrameSeen: true }); });
  const reads: Read[] = [];
  const loadRuns = vi.fn((): Promise<{ runs: RunSummary[] }> => new Promise((res, rej) => {
    reads.push({
      resolve: async (rows) => { await act(async () => { res({ runs: rows }); }); },
      reject: async () => { await act(async () => { rej(new Error('network')); }); },
    });
  }));
  render(<RunsScreen store={store} loadRuns={loadRuns} loadCaps={NO_CAPS} />);
  await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(1));
  await reads[0]!.resolve([finished('pending')]);
  await screen.findByRole('group', { name: /finished/i });
  act(() => { store.setState({ coord: coordAt(T + 1) }); });
  await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(2));
  act(() => { store.setState({ coord: coordAt(T + 2) }); });
  await waitFor(() => expect(loadRuns).toHaveBeenCalledTimes(3));
  return { older: reads[1]!, newer: reads[2]! };
};
const chipWord = (): string | null =>
  document.querySelector('.run-child-reclaim')?.getAttribute('data-child-reclaim') ?? null;
const errorShown = (): boolean => document.querySelector('[data-state="error"]') !== null;

describe('RunsScreen: the archive read is a high-water mark (spec §5.9)', () => {
  it('the NEWER read lands first with the row reclaimed, the stale one last with it pending: reclaimed stays', async () => {
    const { older, newer } = await boardWithTwoReadsInFlight();
    expect(chipWord(), 'before either read lands').toBe('pending');
    await newer.resolve([finished('reclaimed')]);
    expect(chipWord()).toBe('reclaimed');
    await older.resolve([finished('pending')]);
    expect(chipWord(), 'the stale read overwrote the newer one').toBe('reclaimed');
  });

  it('control: in-order resolution shows the newest reading', async () => {
    const { older, newer } = await boardWithTwoReadsInFlight();
    await older.resolve([finished('pending')]);
    expect(chipWord()).toBe('pending');
    await newer.resolve([finished('reclaimed')]);
    expect(chipWord()).toBe('reclaimed');
  });

  it('a stale REJECTION arriving after the newer success does not show the error state', async () => {
    const { older, newer } = await boardWithTwoReadsInFlight();
    await newer.resolve([]);                                   // an answered, empty archive
    expect(document.querySelector('.runs-empty')?.getAttribute('data-state')).toBe('ok');
    await older.reject();
    expect(errorShown(), 'a read older than the applied one set the error state').toBe(false);
    expect(document.querySelector('.runs-empty')?.getAttribute('data-state')).toBe('ok');
  });

  it('an OLDER rejection arriving first does not stop the newer success from landing', async () => {
    const { older, newer } = await boardWithTwoReadsInFlight();
    await older.reject();
    await newer.resolve([]);
    expect(errorShown()).toBe(false);
    expect(document.querySelector('.runs-empty')?.getAttribute('data-state')).toBe('ok');
  });

  it('the chosen reading: a rejection advances nothing, so an older success after a newer failure still lands', async () => {
    // A rejection carries no reading to be "newer" than, so only a success moves the mark. The
    // newest read failed, the older one answered, and the older answer is the freshest one there is.
    const { older, newer } = await boardWithTwoReadsInFlight();
    await newer.reject();
    await older.resolve([finished('reclaimed')]);
    expect(chipWord()).toBe('reclaimed');
  });

  it('a success whose body cannot be read is an error, not a silent drop: the mark moves only after the read', async () => {
    // No frame has landed, so the board knows nothing and shows the error state when the read fails.
    // A `null` answer throws when the body is read. If the mark had already moved to this read, the
    // `catch` would see a read that is no longer newer than the mark and drop the failure, leaving
    // the board on "Loading…" for good.
    const store = makeStore();
    const loadRuns = vi.fn(async () => null as unknown as { runs: RunSummary[] });
    render(<RunsScreen store={store} loadRuns={loadRuns} loadCaps={NO_CAPS} />);
    await waitFor(() => expect(document.querySelector('.runs-empty')?.getAttribute('data-state')).toBe('error'));
  });
});
