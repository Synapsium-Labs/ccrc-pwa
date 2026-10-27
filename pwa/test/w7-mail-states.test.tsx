// `MailScreen`'s own feed read, pinned before C7n (D-7179; Task C7a Step 5; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 15; ARCH-75; D-7209). The two feed reads are not one
// read twice: the screen's `api.feed(100)` also drives its `readState`, which words the empty state, and it reads on
// every open; the store's connect-time read records no success or failure. These rows hold the screen's three empty
// states byte for byte and its request schedule under fake timers, so C7n keeps both.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { CoordStatus, FleetSession, NotifyEvent, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { MailScreen } from '../src/screens/MailScreen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };

/** The empty state's element and its words, byte for byte (`EmptyState` with its `data-state`). */
const emptyState = (): { state: string | null; text: string } | null => {
  const el = document.querySelector('[data-state]');
  return el === null ? null : { state: el.getAttribute('data-state'), text: el.textContent ?? '' };
};

const event = (seq: number): NotifyEvent => ({ seq, at: 1_784_500_000_000, kind: 'mail', sessionId: 'session-a', title: 'a finding', body: 'a record', runId: null });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('MailScreen: its three empty states, byte for byte', () => {
  it('"Loading…" before its feed read settles', async () => {
    render(<MailScreen store={makeStore()} loadFeed={() => new Promise(() => {})} loadRuns={async () => ({ runs: [] })} />);
    await flush();
    expect(emptyState()).toEqual({ state: 'loading', text: 'Loading…' });
  });

  it('the error sentence after it rejects', async () => {
    render(<MailScreen store={makeStore()} loadFeed={async () => { throw new Error('down'); }} loadRuns={async () => ({ runs: [] })} />);
    await flush();
    expect(emptyState()).toEqual({ state: 'error', text: 'Could not reach the server — mail may exist that is not shown.' });
  });

  it('nothing of either once it answers: an empty answer reads "Nothing yet.", a record renders no empty state', async () => {
    render(<MailScreen store={makeStore()} loadFeed={async () => ({ events: [] })} loadRuns={async () => ({ runs: [] })} />);
    await flush();
    expect(emptyState()).toEqual({ state: 'ok', text: 'Nothing yet.' });
    cleanup();
    render(<MailScreen store={makeStore()} loadFeed={async () => ({ events: [event(1)] })} loadRuns={async () => ({ runs: [] })} />);
    await flush();
    expect(document.body.textContent).toContain('a finding');
    expect(document.body.textContent).not.toMatch(/Loading…|Could not reach the server|Nothing yet\./);
  });
});

describe('MailScreen: its request schedule (the default loaders, through the api)', () => {
  const coord = (doneAt: number): CoordStatus => ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], childReclaimDoneAt: doneAt });
  const run = (id: number): RunSummary => ({ id, program: 'program-a', programTitle: null, wave: 1, waveOf: 1, project: 'project-a', homeProject: null,
    sessionId: 'session-a', workspace: 'ws-a', branch: null, state: 'working', kind: 'work', reviews: null, claimedBy: 'coord-a', resumed: false, clearedAt: null,
    openedAt: 1, dispatchStartedAt: null, dispatchedAt: 1, closedAt: null, handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
    health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null },
    childReclaim: null, reviewCap: null });

  it('one api.feed(100) and one api.runs(true) per mount; none on a run leaving the live slice, a session leaving the fleet frame or a new reclaim end; one more feed read on each re-open', async () => {
    const feed = vi.spyOn(api, 'feed').mockResolvedValue({ events: [] } as never);
    const runs = vi.spyOn(api, 'runs').mockResolvedValue({ runs: [] } as never);
    const store = makeStore();
    const s: FleetSession = fleetSession({ id: 'session-a', project: 'project-a' });
    act(() => { store.setState({ runs: [run(1)], runsFrameSeen: true, sessions: [s], fleetFrameSeen: true, coord: coord(1), coordFrameSeen: true }); });
    const { unmount } = render(<MailScreen store={store} />);
    await flush();
    expect([feed.mock.calls, runs.mock.calls]).toEqual([[[100]], [[true]]]);
    act(() => { store.setState({ runs: [] }); });                         // a run leaves the live slice
    await flush();
    act(() => { store.setState({ sessions: [] }); });                     // a session leaves the fleet frame
    await flush();
    act(() => { store.setState({ coord: coord(2), coordFrameSeen: true }); }); // a new reclaim end
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });  // its clock ticks; no poll
    expect([feed.mock.calls.length, runs.mock.calls.length]).toEqual([1, 1]);
    unmount();
    render(<MailScreen store={store} />);                                  // the re-open
    await flush();
    expect([feed.mock.calls, runs.mock.calls]).toEqual([[[100], [100]], [[true], [true]]]);
  });
});
