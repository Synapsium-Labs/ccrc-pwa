// Task 9 (the runs rebuild, D-8072; spec 2026-11-04 §7): `runWaitLine`, the one reader of the row's "what it waits on" line.
// Null means today's line. Placeholders only.
import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../shared/api';
import { runWaitLine } from '../src/fleet/runWords';

const DAY = 86_400_000;
const H = 3_600_000;
const now = 1_800_000_000_000;

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'prog-a', programTitle: 'Programme A', wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  sessionId: 'sess-a', workspace: 'ws-a', branch: 'ws/a', state: 'working', kind: 'work', reviews: null,
  claimedBy: 'sess-coord', resumed: false, clearedAt: null, openedAt: now - 2 * DAY, dispatchStartedAt: null,
  dispatchedAt: now - 2 * DAY, closedAt: null, handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null,
            briefQueued: true, clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, hadChild: false, ...over,
});

describe('runWaitLine', () => {
  it('names each of §7\'s waits', () => {
    expect(runWaitLine(run({ state: 'planned', blockedBy: 1012 }), now)).toBe('Waits behind a stuck run.');
    expect(runWaitLine(run({ state: 'planned', waitsOn: 'coordinator' }), now)).toBe('Waits for its coordinator to start it.');
    expect(runWaitLine(run({ state: 'awaiting-review', waitsOn: 'coordinator' }), now)).toBe('Reviews done. Waits on its coordinator.');
    expect(runWaitLine(run({ state: 'awaiting-review', waitsOn: 'reviewer' }), now)).toBe('Waits on a reviewer.');
    expect(runWaitLine(run({ state: 'working', waitsOn: 'worker', lastMoveAt: now - 9 * DAY }), now)).toBe('No move in 9 days.');
  });

  it('keeps today\'s line (null) for a recent move, an absent fact and any other case', () => {
    expect(runWaitLine(run({ state: 'working', waitsOn: 'worker', lastMoveAt: now - 23 * H }), now)).toBeNull();
    expect(runWaitLine(run({ state: 'planned', waitsOn: undefined }), now)).toBeNull();
    expect(runWaitLine(run({ state: 'working', waitsOn: 'worker' }), now)).toBeNull();
    expect(runWaitLine(run({ state: 'merging', waitsOn: 'merge-queue', lastMoveAt: now - 9 * DAY }), now)).toBeNull();
    expect(runWaitLine(run({ state: 'done', closedAt: now - DAY, waitsOn: 'nobody' }), now)).toBeNull();
  });

  it('counts whole days rounded down, from a day up, for dispatched and working alike', () => {
    expect(runWaitLine(run({ state: 'dispatched', waitsOn: 'worker', lastMoveAt: now - 2 * DAY - 23 * H }), now)).toBe('No move in 2 days.');
    expect(runWaitLine(run({ state: 'working', waitsOn: 'worker', lastMoveAt: now - DAY - 1 }), now)).toBe('No move in 1 day.');
    expect(runWaitLine(run({ state: 'working', waitsOn: 'worker', lastMoveAt: now - DAY + 1 }), now)).toBeNull();
  });

  it('leaves a stuck run to its stuck line', () => {
    const stuck = { reason: 'never-started', since: now - 30 * DAY, cause: null, closes: null } as never;
    expect(runWaitLine(run({ state: 'planned', blockedBy: 9, stuck }), now)).toBeNull();
  });
});
