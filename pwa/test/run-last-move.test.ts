// Task G1 (D-7334, D-7338): `runLastMove` is the app's one reader of `RunSummary.lastMoveAt`. An absent field is an older
// server and reads null, so an older server shows no movement (spec §5). A server that sent null measured a run with no
// move yet, so the reader falls back to its dispatch time, then its open time. A number is the move itself.
import { describe, expect, it } from 'vitest';
import type { RunSummary } from '../../shared/api';
import { runLastMove } from '../src/fleet/runWords';

const OPENED = 1_790_000_000_000;
const DISPATCHED = OPENED + 60_000;
const MOVED = OPENED + 3_600_000;

const run = (o: { lastMoveAt?: number | null; dispatchedAt?: number | null } = {}): RunSummary => ({
  id: 1, program: 'program-a', programTitle: 'Program A', wave: 1, waveOf: 3, project: 'project-a', homeProject: null,
  sessionId: 'lane-a-project-a', workspace: null, branch: null, state: 'working', claimedBy: 'coord-a', resumed: false,
  clearedAt: null, openedAt: OPENED, dispatchStartedAt: null, dispatchedAt: DISPATCHED, closedAt: null, handoffCommit: null,
  items: { done: 0, total: 0 }, unreadMail: 0,
  ...o,
} as RunSummary);

describe('runLastMove: the one reader of RunSummary.lastMoveAt', () => {
  it('an absent field (an older server) reads null, whatever the run\'s other times say', () => {
    expect(runLastMove(run())).toBeNull();
  });

  it('a number is the move', () => {
    expect(runLastMove(run({ lastMoveAt: MOVED }))).toBe(MOVED);
  });

  it('null falls back to the dispatch time', () => {
    expect(runLastMove(run({ lastMoveAt: null }))).toBe(DISPATCHED);
  });

  it('null with no dispatch yet falls back to the open time', () => {
    expect(runLastMove(run({ lastMoveAt: null, dispatchedAt: null }))).toBe(OPENED);
  });
});
