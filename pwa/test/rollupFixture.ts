// The fleet the rollup cases are about (D-6088): a quiet project, a working one, and a coordinator with workers in
// every state the summary line counts. Shared by the decider's suite and the rendered one, so both read one fleet.
import type { FleetSession, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';

export const NOW = 1_800_000_000_000;
export const MIN = 60_000;
export const HOUR = 60 * MIN;

export const sess = (id: string, project: string, over: Partial<FleetSession> = {}): FleetSession =>
  fleetSession({ id, project, workspace: id, statusUpdatedAt: NOW - 5 * HOUR, bucketSince: NOW - 5 * HOUR, ...over });

/** A run in the shape the `runs` frame carries one: `claimedBy` coordinates `sessionId`. */
export const run = (id: number, claimedBy: string, sessionId: string | null, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: 'port-api', programTitle: 'Port the API', wave: 1, waveOf: 3,
  project: 'project-c', homeProject: null, sessionId, workspace: sessionId, branch: null,
  state: 'dispatched', kind: 'work', reviews: null,
  claimedBy, resumed: false, clearedAt: null,
  openedAt: NOW - HOUR, dispatchStartedAt: null, dispatchedAt: null,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 0 },
  unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, childReclaim: null, ...over,
});

/** An operator-facing question: a live pane's dialog that no coordinator holds (the ladder's `attention`). */
export const asking = (over: Partial<FleetSession> = {}): Partial<FleetSession> => ({
  status: 'idle', dialogPending: true, hookState: 'waiting', bucket: 'attention', bucketSince: NOW - 3 * HOUR,
  askSummary: 'Which branch?', ask: { state: 'held', parentId: 'coord', answeredBy: null }, ...over,
});

/** The same open question while the coordinator still holds it: `withCoordinator` set, so the ladder says `working`. */
export const heldByCoordinator = (): Partial<FleetSession> => ({
  status: 'idle', dialogPending: true, hookState: 'waiting', bucket: 'working', bucketSince: NOW - 3 * HOUR,
  askSummary: 'Which branch?', ask: { state: 'held', parentId: 'coord', answeredBy: null },
  withCoordinator: { kind: 'question', parentId: 'coord', since: NOW - 3 * HOUR, notifyAt: NOW + 2 * MIN },
});

/** The coordinator answered it: the dialog is closed, the chip says who ruled, and the row is idle again. */
export const answeredByCoordinator = (): Partial<FleetSession> => ({
  status: 'idle', bucket: 'idle', ask: { state: 'answered', parentId: 'coord', answeredBy: 'coord' },
});

/** A coordinator `coord` in project-c with five workers: two working, two idle, and `w5` as `w5` says. */
export function coordinatorFleet(w5: Partial<FleetSession>): { sessions: FleetSession[]; runs: RunSummary[] } {
  const coord = sess('coord', 'project-c', { role: 'coordinator', status: 'busy', bucket: 'working', bucketSince: NOW - 4 * HOUR });
  const kids = [
    sess('w1', 'project-c', { role: 'child', status: 'busy', bucket: 'working' }),
    sess('w2', 'project-c', { role: 'child', status: 'busy', bucket: 'working' }),
    sess('w3', 'project-c', { role: 'child' }),
    sess('w4', 'project-c', { role: 'child' }),
    sess('w5', 'project-c', { role: 'child', ...w5 }),
  ];
  const runs = kids.map((k, i) => run(10 + i, 'coord', k.id));
  return { sessions: [coord, ...kids], runs };
}
