// D-8285 (#119): the worker heartbeat on a run row. `workerSeenNote` is the app's one reader of `RunSummary.workerLastSeen`
// and `.workerLastTurn`. An absent field (an older server, a marker that did not read, the first sweep not yet run) draws
// nothing, never "dead". The stale threshold is the stall watch's quiet time (`stallQuietMs`), the one `lastMoveAt` uses.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { RunSummary, RunWorkerTurn } from '../../shared/api';
import { workerSeenNote } from '../src/fleet/runWords';
import { RunRow } from '../src/screens/RunRow';

afterEach(cleanup);

const NOW = 1_800_000_000_000;
const QUIET = 2 * 3_600_000;

const run = (o: { workerLastSeen?: number; workerLastTurn?: RunWorkerTurn } = {}): RunSummary => ({
  id: 1, program: 'program-a', programTitle: 'Program A', wave: 1, waveOf: 3, project: 'project-a', homeProject: null,
  sessionId: 'lane-a-project-a', workspace: null, branch: null, state: 'working', claimedBy: 'coord-a', resumed: false,
  clearedAt: null, openedAt: NOW - 9_000_000, dispatchStartedAt: null, dispatchedAt: NOW - 8_000_000, closedAt: null,
  handoffCommit: null, items: { done: 0, total: 5 }, unreadMail: 0,
  ...o,
} as RunSummary);

const done = (at: number): RunWorkerTurn => ({ state: 'done', startedAt: at - 600_000, endedAt: at });

describe('workerSeenNote: the one reader of the worker heartbeat', () => {
  it('an absent heartbeat draws nothing: not measured is never dead', () => {
    expect(workerSeenNote(run(), NOW, QUIET)).toBeNull();
    expect(workerSeenNote(run({ workerLastSeen: Number.NaN }), NOW, QUIET)).toBeNull();
  });

  it('a finished turn reads "last seen N ago", quiet once past the stall watch\'s quiet time', () => {
    const fresh = workerSeenNote(run({ workerLastSeen: NOW - 5 * 60_000, workerLastTurn: done(NOW - 5 * 60_000) }), NOW, QUIET);
    expect(fresh).toMatchObject({ word: 'last seen 5m ago', quiet: false });
    const old = workerSeenNote(run({ workerLastSeen: NOW - 3 * 3_600_000, workerLastTurn: done(NOW - 3 * 3_600_000) }), NOW, QUIET);
    expect(old).toMatchObject({ word: 'last seen 3h ago · quiet', quiet: true });
    // No threshold (an older server, or no runs frame yet): never quiet.
    expect(workerSeenNote(run({ workerLastSeen: NOW - 3 * 3_600_000, workerLastTurn: done(NOW - 3 * 3_600_000) }), NOW, null))
      .toMatchObject({ word: 'last seen 3h ago', quiet: false });
  });

  it('a turn still open says so and is never called quiet: the marker does not move inside a turn', () => {
    const turn: RunWorkerTurn = { state: 'working', startedAt: NOW - 3 * 3_600_000, endedAt: null };
    expect(workerSeenNote(run({ workerLastSeen: NOW - 3 * 3_600_000, workerLastTurn: turn }), NOW, QUIET))
      .toMatchObject({ word: 'last seen 3h ago · in a turn', quiet: false });
  });

  it('a failed turn names the failure', () => {
    const turn: RunWorkerTurn = { state: 'failed', startedAt: NOW - 700_000, endedAt: NOW - 600_000 };
    expect(workerSeenNote(run({ workerLastSeen: NOW - 600_000, workerLastTurn: turn }), NOW, QUIET))
      .toMatchObject({ word: 'last seen 10m ago · turn failed', quiet: false });
  });
});

describe('the run row draws the heartbeat', () => {
  it('one span, its word, and the quiet flag for the eye and a screen reader alike', () => {
    const r = run({ workerLastSeen: NOW - 3 * 3_600_000, workerLastTurn: done(NOW - 3 * 3_600_000) });
    const { container } = render(<ul><RunRow run={r} nowMs={NOW} session={null} quietMs={QUIET} /></ul>);
    const seen = container.querySelector('.run-seen');
    expect(seen?.textContent).toBe('last seen 3h ago · quiet');
    expect(seen?.getAttribute('data-quiet')).toBe('true');
    expect(seen?.getAttribute('title')).toContain('turn marker');
  });

  it('no heartbeat, no span', () => {
    const { container } = render(<ul><RunRow run={run()} nowMs={NOW} session={null} quietMs={QUIET} /></ul>);
    expect(container.querySelector('.run-seen')).toBeNull();
  });
});
