// Delegation broker wave 4, PR1 Task 1.2: the `delegation` frame, DECIDED (spec §5.8, §8.4; D-6999, D-7002, D-7023).
//
// THIS MODULE IS L1. It imports the shared wire, the pure model, the policy's one classifier of unowned work, the correlation
// module's tree key and the binding's R9 decider, and nothing else: no filesystem, no store, no clock, no census adapter (`gitref.ts` is L3, so the census shape is
// declared structurally below; `DelegationCensusPass` and the lane's `absences` values are assignable to it as they are). It makes no
// durable write. The watcher (L4) gathers the inputs after a pass and broadcasts what this returns.
//
// R9 is decided by the binding module (`claimantAt`, `coord/runBinding.ts`), the one place a run is told to bind a session. It is
// legitimately different from `foldCoordPlacements` (`coord/placement.ts`): placement answers "the newest stamp for this session" to put
// a card on a project; R9 asks "whose run was live at THIS instant", because one ccd session id works several runs over time,
// sometimes for different coordinators, and the placement stamps do not carry a run's interval.
import {
  isDelegationActivityPlacement,
  isDelegationCreatorKind,
  isDelegationLiveness,
  isDelegationRowGroup,
  type DelegationActivityWire,
  type DelegationInferredWire,
  type DelegationLeaseWire,
  type DelegationLiveness,
  type DelegationProjectionWire,
  type DelegationRowGroup,
  type DelegationUnownedWire,
  type RunSummary,
  type SessionStatus,
} from '../../../shared/api.js';
import {
  formatDelegationInstant,
  parseDelegationInstant,
  type DelegationActivityRow,
  type DelegationAttemptRow,
  type DelegationCensusRecord,
  type DelegationCheckpointV1,
} from './delegation-model.js';
import { isUnownedWorkReason } from './delegation-policy.js';
import { delegationTreeKey } from './delegation-correlation.js';
import { claimantAt } from './runBinding.js';

/** How many newest closed runs the R9 mapping reads (L4 passes it to the store's narrow read). A worker whose run is older than
 *  that window falls back to its own row: the rider's store read by `sessionId` removes the bound. */
export const DELEGATION_PROJECTION_CLOSED_RUNS = 200;

export interface DelegationProjectionSession { id: string; status: SessionStatus; workdir?: string }
/** One run's stamp, from the narrow read `delegationRunStamps`, never the full `runs()` hydration. */
export type DelegationProjectionRun = Pick<RunSummary, 'id' | 'sessionId' | 'claimedBy' | 'openedAt' | 'closedAt'>;
export interface DelegationProjectionInput {
  checkpoint: Pick<DelegationCheckpointV1, 'activities' | 'leases' | 'attempts'>;
  census: {
    measuredAt: number;
    projects: ReadonlyMap<string, { delegation: readonly DelegationCensusRecord[] | null }>;
    incarnations: ReadonlyMap<string, { kind: 'measured'; incarnation: string } | { kind: 'unmeasured' }>;
  };
  absences: readonly { project: string; adminRecord: string }[];
  /** This tick's listed registry; never a partial listing (the lane withholds the projection when the registry is unlisted). */
  sessions: readonly DelegationProjectionSession[];
  /** Open runs plus the newest `DELEGATION_PROJECTION_CLOSED_RUNS` closed ones. */
  runs: readonly DelegationProjectionRun[];
}

type Presence = 'present' | 'absent' | 'unmeasured';
const bySortKey = <T>(key: (x: T) => readonly string[]) => (a: T, b: T): number => {
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
  return 0;
};

/** The frame's payload for one pass. Byte-stable for the watcher's dedupe: every list is sorted on fixed keys. */
export function projectDelegation(input: DelegationProjectionInput): DelegationProjectionWire {
  const { checkpoint, census } = input;
  const sessions = new Map(input.sessions.map((s) => [s.id, s]));
  const owned = ownedPaths(input.sessions);
  const activities = new Map(checkpoint.activities.map((a) => [a.activityId, a]));
  const absent = new Set(input.absences.map((a) => delegationTreeKey(a.project, a.adminRecord)));
  const groupOf = (id: string): DelegationRowGroup => (sessions.has(id) ? 'parent' : 'offline-coordinator');
  const coordinatorOf = (id: string, at: string): string | null => claimantAt(input.runs, id, parseDelegationInstant(at));
  const presence = (project: string, adminRecord: string): Presence => presenceOf(census.projects, absent, project, adminRecord);
  const liveness = (a: DelegationActivityRow): DelegationLiveness => livenessOf(a, sessions, census.incarnations);

  const unreleased = checkpoint.leases.filter((l) => l.releasedAt === null);
  const leasedTrees = new Set(unreleased.map((l) => delegationTreeKey(l.project, l.adminRecord)));
  const leasedActivities = new Set(unreleased.map((l) => l.activityId));
  // The newest unowned-work attempt per tree (R59's one classifier). A tree is in conflict when ITS newest attempt is `conflicting`, so
  // a lease suppressed for a conflict always leaves the tree an unowned row (D-7003).
  const newest = new Map<string, DelegationAttemptRow>();
  for (const a of checkpoint.attempts) {
    if ((a.verdict !== 'unresolved' && a.verdict !== 'conflicting') || !isUnownedWorkReason(a.detail ?? '')) continue;
    const k = delegationTreeKey(a.project, a.adminRecord);
    const held = newest.get(k);
    if (!held || held.attemptedAt < a.attemptedAt || (held.attemptedAt === a.attemptedAt && held.attemptId < a.attemptId)) newest.set(k, a);
  }
  const conflicting = new Set([...newest].filter(([, a]) => a.verdict === 'conflicting').map(([k]) => k));

  const activityRows: DelegationActivityWire[] = [];
  for (const a of checkpoint.activities) {
    if (a.sourceKind === 'bash-worktree' || leasedActivities.has(a.activityId)) continue;
    const now = liveness(a);
    if (now === 'ended') continue;
    activityRows.push({
      activityId: a.activityId, parentId: a.parentId, group: groupOf(a.parentId),
      placement: coordinatorOf(a.parentId, a.openedAt) === null ? 'row' : 'chip', sourceKind: a.sourceKind, upstreamId: a.upstreamId,
      displayName: a.displayName, liveness: now, openedAt: a.openedAt, lastEventAt: a.lastEventAt,
    });
  }

  const leaseRows: DelegationLeaseWire[] = [];
  for (const l of unreleased) {
    const k = delegationTreeKey(l.project, l.adminRecord);
    if (owned.has(l.canonicalPath) || (conflicting.has(k) && l.sourceKind !== 'raw')) continue;
    const workspace = presence(l.project, l.adminRecord);
    if (workspace === 'absent') continue;
    const coordinator = coordinatorOf(l.parentId, l.firstObservedAt);
    const parentId = coordinator ?? l.parentId;
    const act = activities.get(l.activityId);
    const inferred: DelegationInferredWire | null = l.sourceKind !== 'raw' ? null
      : { creator: act?.sourceKind === 'bash-worktree' ? { kind: 'bash-call', toolUseId: act.upstreamId } : { kind: 'unmeasured' } };
    leaseRows.push({
      leaseId: l.leaseId, parentId, via: coordinator === null ? null : l.parentId, group: groupOf(parentId), project: l.project,
      adminRecord: l.adminRecord, canonicalPath: l.canonicalPath, sourceKind: l.sourceKind, workspace,
      liveness: act ? liveness(act) : 'unmeasured', inferred, firstObservedAt: l.firstObservedAt,
    });
  }

  const unownedRows: DelegationUnownedWire[] = [];
  for (const [k, a] of newest) {
    if ((leasedTrees.has(k) && a.verdict !== 'conflicting') || (a.canonicalPath !== null && owned.has(a.canonicalPath))) continue;
    const workspace = presence(a.project, a.adminRecord);
    if (workspace === 'absent') continue;
    unownedRows.push({
      project: a.project, adminRecord: a.adminRecord, canonicalPath: a.canonicalPath, verdict: a.verdict as DelegationUnownedWire['verdict'],
      reason: a.detail!, rung: a.rung, workspace, attemptedAt: a.attemptedAt,
    });
  }

  return {
    asOf: formatDelegationInstant(census.measuredAt),
    activities: activityRows.sort(bySortKey((r) => [r.parentId, r.openedAt, r.activityId])),
    leases: leaseRows.sort(bySortKey((r) => [r.parentId, r.firstObservedAt, r.leaseId])),
    unowned: unownedRows.sort(bySortKey((r) => [r.project, r.adminRecord])),
  };
}

function livenessOf(
  a: DelegationActivityRow,
  sessions: ReadonlyMap<string, DelegationProjectionSession>,
  incarnations: DelegationProjectionInput['census']['incarnations'],
): DelegationLiveness {
  if (a.executionState === 'ended') return 'ended';
  const parent = sessions.get(a.parentId);
  if (!parent || parent.status === 'dead') return 'stale';
  const inc = incarnations.get(a.parentId);
  if (a.executionState === 'unknown' || inc?.kind !== 'measured') return 'unmeasured';
  return inc.incarnation === a.parentIncarnation ? 'live' : 'stale';
}

/** A tree's presence: an unmeasured project is never absent; a present record wins; a lane-held absence of a measured project is
 *  absent; anything else is unmeasured. */
function presenceOf(
  projects: DelegationProjectionInput['census']['projects'],
  absent: ReadonlySet<string>,
  project: string,
  adminRecord: string,
): Presence {
  const records = projects.get(project)?.delegation ?? null;
  if (records === null) return 'unmeasured';
  if (records.some((r) => r.adminRecord === adminRecord && r.state === 'present')) return 'present';
  return absent.has(delegationTreeKey(project, adminRecord)) ? 'absent' : 'unmeasured';
}

/** Programme ownership wins: the workdirs of the listed sessions. */
function ownedPaths(sessions: readonly DelegationProjectionSession[]): ReadonlySet<string> {
  return new Set(sessions.flatMap((s) => (s.workdir === undefined ? [] : [s.workdir])));
}

/** The projection's closed words, for the mail-routes kebab census: derived from `shared/api.ts`'s four tables, never re-spelled. */
export const isDelegationProjectionKebab = (tok: string): boolean =>
  isDelegationLiveness(tok) || isDelegationRowGroup(tok) || isDelegationActivityPlacement(tok) || isDelegationCreatorKind(tok);
