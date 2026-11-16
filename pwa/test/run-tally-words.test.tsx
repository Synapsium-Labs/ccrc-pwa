// D-8292 (#119): the run row says what its item count counts. `items.done` counts what the coordinator settled
// (D-5914), so a wave in progress reads `0/5` however far its branch has moved, and a reader took that for "no work".
// The tally now says "settled", and beside it the row shows the worker branch's commit count from the PR read, labelled
// as that read: a separate, measured fact, never folded into the tally and never a claim of progress.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { UNCHECKED_PR, type FleetSession, type RunSummary } from '../../shared/api';
import { branchCommitsNote, itemTallyLabel, itemTallyTitle } from '../src/fleet/runWords';
import { RunRow } from '../src/screens/RunRow';
import { RunDetailScreen } from '../src/screens/RunDetailScreen';
import { api } from '../src/lib/api';
import { createFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const NOW = 1_800_000_000_000;

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 31, program: 'p', programTitle: 'Build', wave: 8, waveOf: 9, project: 'proj-a', homeProject: null,
  sessionId: 'proj-a-x', workspace: 'x', branch: 'ws/x', state: 'working', kind: 'work', reviews: null,
  claimedBy: 'proj-a-coord', resumed: false, clearedAt: null, openedAt: NOW - 60_000, dispatchStartedAt: null,
  dispatchedAt: NOW - 60_000, closedAt: null, handoffCommit: null, items: { done: 0, total: 5 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null,
    briefQueued: true, clearError: null, coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
});

const worker = (ahead: number, over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id: 'proj-a-x', project: 'proj-a', branch: 'ws/x', pr: { ...UNCHECKED_PR, phase: 'open', ahead }, ...over });

describe('the tally says what it counts', () => {
  it('"settled" rides the count, and the title says it is not commits', () => {
    expect(itemTallyLabel({ done: 0, total: 5 })).toBe('0/5 settled');
    expect(itemTallyLabel({ done: 0, total: 0 })).toBe('—');
    expect(itemTallyTitle({ done: 0, total: 5 })).toMatch(/coordinator has settled/);
    expect(itemTallyTitle({ done: 0, total: 5 })).toMatch(/not commits/);
    expect(itemTallyTitle({ done: 0, total: 0 })).toBeNull();
  });
});

describe('the branch commit count beside it', () => {
  it('names the worker branch\'s commits past its base, labelled as the PR read', () => {
    const n = branchCommitsNote(run(), worker(58));
    expect(n?.word).toBe('58 commits');
    expect(n?.title).toMatch(/pull request read/);
    expect(n?.title).toMatch(/not settled items/);
    expect(branchCommitsNote(run(), worker(1))?.word).toBe('1 commit');
  });

  it('says nothing it did not measure', () => {
    expect(branchCommitsNote(run(), null)).toBeNull();
    expect(branchCommitsNote(run(), worker(0))).toBeNull();
    expect(branchCommitsNote(run(), fleetSession({ id: 'proj-a-x', branch: 'ws/x', pr: null }))).toBeNull();
    // Another branch's count is not this run's.
    expect(branchCommitsNote(run(), worker(58, { branch: 'ws/other' }))).toBeNull();
    // A closed run's row is a record; a live count would read as now.
    expect(branchCommitsNote(run({ state: 'done', closedAt: NOW }), worker(58))).toBeNull();
  });

  it('the row draws both, the tally and the count, each with its title', () => {
    const { container } = render(<ul><RunRow run={run()} nowMs={NOW} session={worker(58)} /></ul>);
    const tally = container.querySelector('.run-tally');
    expect(tally?.textContent).toBe('0/5 settled');
    expect(tally?.getAttribute('title')).toMatch(/not commits/);
    const commits = container.querySelector('.run-commits');
    expect(commits?.textContent).toBe('58 commits');
    expect(commits?.getAttribute('title')).toMatch(/pull request read/);
  });

  it('a row with no worker session draws no count', () => {
    const { container } = render(<ul><RunRow run={run()} nowMs={NOW} session={null} /></ul>);
    expect(container.querySelector('.run-commits')).toBeNull();
  });
});

describe('the run page header draws what the row draws (D-5545)', () => {
  it('the tally with its title and the commit count, from the same readers', async () => {
    const r = run();
    vi.spyOn(api, 'runRecord').mockResolvedValue({ ok: true, run: r, events: [], reviewedBy: [], olderEvents: 0 });
    vi.spyOn(api, 'run').mockRejectedValue(new Error('offline'));
    vi.spyOn(api, 'runItems').mockRejectedValue(new Error('offline'));
    vi.spyOn(api, 'runSignals').mockRejectedValue(new Error('offline'));
    vi.spyOn(api, 'goals').mockRejectedValue(new Error('offline'));
    const store = createFleetStore({ makeSocket: () => ({ close() {} }) as unknown as WebSocket });
    const bound = { ...worker(58), run: { id: 31, state: 'working' as const, claimedBy: 'proj-a-coord' } };
    act(() => { store.setState({ sessions: [bound], fleetFrameSeen: true }); });
    render(<RunDetailScreen id={31} store={store} />);
    const head = await waitFor(() => { const h = document.querySelector('.rd-head'); if (h === null) throw new Error('no header'); return h; });
    expect(head.querySelector('.rd-tally')?.textContent).toBe('0/5 settled');
    expect(head.querySelector('.rd-tally')?.getAttribute('title')).toMatch(/not commits/);
    expect(head.querySelector('.rd-commits')?.textContent).toBe('58 commits');
  });
});
