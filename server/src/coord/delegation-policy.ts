// Delegation broker wave 3, Task 12: the PURE report-only reconciliation policy (spec §5.5).
//
// `planDelegationReconciliation` reads the recovery state, the worktree census, the correlation verdicts (Task 11), the registry's
// readability, the first-dead parents and the previous successful census, and returns a list of report effects drawn from a closed
// union of six. It does no IO, reads no clock (time comes only from `input.now`), mints no identifier and holds no authority: an effect
// is a statement for the watcher (Task 13) to record, not an act. Nothing here can adopt, retain, promote, dispatch, audit, clean up,
// write a carrier, mint a token or delete; the union has no member that could.
//
// THIS MODULE IS L1. It imports the pure model and the pure correlation module and nothing else: no filesystem, no store, no
// randomness. The one hash it takes (an attempt's ID) is the model's own SHA-256 over canonical JSON, so the same decision always
// has the same ID and a pass that sees it again can tell it is already recorded.
//
// WHAT EACH VERDICT BECOMES
//   run-child-owned   -> `record-run-child-owned` ONLY. The existing run/child model owns the tree; it is never a lease (W3-M63).
//   linked (2, 3, 4)  -> `request-linked-lease-identity`: measured identity and nothing else (no UUID, no sequence, no clock but the
//                        canonical `firstObservedAt`). The journal adapter, not policy, mints the lease ID after deduplication (W3-M62).
//   unresolved/conflicting -> `record-unowned-worktree`, but only for a REASON that leaves a tree attempted and undecided. A tree being
//                        born (`ccrc-birth-wait`), a ccd workspace (`ccd-workspace-not-a-lease`) and an absent record are not unowned
//                        work, and a reason policy has never heard of fails closed.
//   unmeasured        -> nothing. Unknown stays unmeasured and is retried; it is never reported as work, as absence or as ownership.
//   a record missing from this census AND the previous SUCCESSFUL one -> `record-measured-absence`, for a tree the broker once held.
//   every ready pass  -> one `repair-report-projection` naming the checkpoint revision the pass read.
//
// INTERPRETATIONS (each recorded in the task report)
//   * `correlations[i]` is the verdict for `census[i]`: the plan's input type carries no key to join them, so they are index-aligned and
//     a list of another length is a defect (it throws), never a quiet truncation.
//   * An attempt row belongs to a parent (its session is a foreign key). A verdict names none, so the parent is read from the checkpoint:
//     a linked or run-child-owned verdict's activity, or the activities whose identity record the verdict's evidence names. When no
//     parent is named, an attempt cannot be filed without inventing one, so nothing is reported for that tree this pass.
//   * The circuit breaker withholds OWNERSHIP CLAIMS (a lease request, an unowned report); it adds no effect and takes no action. Facts
//     the census alone proves (run-child ownership, absence) are still reported.
//   * A `record-observation-interval` is a member of the union but policy never needs it in wave 3: intervals are measured where the
//     bytes are read (ingestion), and a policy-made `unmeasured` hour for a registry blip would cost the seven-day health window.
//   * A conflict is final per TREE (project and admin record), whichever parent or time recorded it.
import {
  isDelegationCorrelationKebab,
  type DelegationCorrelationReason,
  type DelegationCorrelationVerdict,
} from './delegation-correlation.js';
import {
  DelegationModelError,
  canonicalDelegationJson,
  delegationSha256Hex,
  isDelegationModelKebab,
  leaseSourceKindOfActivity,
  parseDelegationInstant,
  type DelegationActivityRow,
  type DelegationAttemptRow,
  type DelegationCensusRecord,
  type DelegationLeaseCreationRequest,
  type DelegationObservationInterval,
  type DelegationRecoveryState,
} from './delegation-model.js';

// ── The vocabulary the plan fixes ─────────────────────────────────────────────────────────────────────────────────────

export type DelegationReportEffect =
  | {
      kind: 'request-linked-lease-identity';
      attempt: DelegationAttemptRow;
      request: DelegationLeaseCreationRequest;
    }
  | { kind: 'record-run-child-owned'; attempt: DelegationAttemptRow }
  | { kind: 'record-measured-absence'; project: string; adminRecord: string; observedAt: string }
  | { kind: 'record-unowned-worktree'; attempt: DelegationAttemptRow }
  | { kind: 'repair-report-projection'; checkpointRevision: number }
  | { kind: 'record-observation-interval'; interval: DelegationObservationInterval };

export interface DelegationReconciliationInput {
  now: string;
  recovery: DelegationRecoveryState;
  census: readonly DelegationCensusRecord[];
  correlations: readonly DelegationCorrelationVerdict[];
  registryReadable: boolean;
  firstDeadParents: readonly { parentId: string; firstMeasuredDeadAt: string }[];
  previousSuccessfulCensus: readonly DelegationCensusRecord[] | null;
}

// ── The circuit breaker ───────────────────────────────────────────────────────────────────────────────────────────────

/** Spec §5.5: two or more parents first measured dead within this window. */
export const DELEGATION_CIRCUIT_BREAKER_WINDOW_MS = 10 * 60 * 1000;

export type DelegationCircuitBreakerState = 'clear' | 'suspended' | 'unmeasured';

/**
 * Whether this pass may make ownership claims. A REPORT, never an action: it answers one word.
 *   suspended   the registry is unreadable, or two or more distinct parents were first measured dead inside the window. The window is
 *               inclusive at its edge and counts an instant later than `now` (clock skew) as inside: both err toward suspending.
 *   unmeasured  fewer than two fresh deaths, but some first-dead instant could not be read, so a second fresh death cannot be ruled out.
 *   clear       neither.
 * A parent is dead here only because the caller measured it so and handed it over; policy infers deadness from nothing else, so a
 * supervisor mid-restart is not dead.
 */
export function delegationCircuitBreaker(
  input: Pick<DelegationReconciliationInput, 'now' | 'registryReadable' | 'firstDeadParents'>,
): DelegationCircuitBreakerState {
  if (!input.registryReadable) return 'suspended';
  const nowMs = parseDelegationInstant(input.now);
  const fresh = new Set<string>();
  let unreadable = false;
  for (const dead of input.firstDeadParents) {
    let at: number;
    try {
      at = parseDelegationInstant(dead.firstMeasuredDeadAt);
    } catch (err) {
      if (err instanceof DelegationModelError) { unreadable = true; continue; }
      throw err;
    }
    if (nowMs - at <= DELEGATION_CIRCUIT_BREAKER_WINDOW_MS) fresh.add(dead.parentId);
  }
  if (fresh.size >= 2) return 'suspended';
  return unreadable ? 'unmeasured' : 'clear';
}

// ── What a non-answer's reason means ──────────────────────────────────────────────────────────────────────────────────

/**
 * Every correlation reason, classified ONCE as a TOTAL table: `true` when a tree left with that reason is attempted-and-undecided
 * work (so, with an `unresolved` or `conflicting` verdict, it may be reported as unowned); `false` when it is not. A reason added to
 * the correlation module's list is a compile error here until it is classified.
 *   false because the tree is not work: being born, a ccd workspace, an absent record.
 *   false because the reason is a retry (an `unmeasured` verdict's), not a decision.
 */
const UNOWNED_BY_REASON: Readonly<Record<DelegationCorrelationReason, boolean>> = {
  'record-unreadable': false,
  'record-absent': false,
  'ccd-workspace-not-a-lease': false,
  'ccrc-birth-wait': false,
  'canonical-path-unmeasured': false,
  'rung-2-evidence-absent': false,
  'same-upstream-id-in-multiple-sessions': true,
  'duplicate-activity-rows': true,
  'rung-2-meta-absent': false,
  'meta-paths-disagree': true,
  'rung-2-path-mismatch': false,
  'rung-2-subagent-event-absent': false,
  'activity-not-durably-open': false,
  'agent-id-claimed-by-multiple-sessions': true,
  'path-claimed-by-multiple-parents': true,
  'ambiguous-subagent-path': true,
  'parent-cwd': true,
  'overlapping-listing-window': true,
  'listing-window-instant-unreadable': false,
  'ambiguous-listing-windows': true,
  'rungs-disagree': true,
  'no-correlating-evidence': true,
};

/** A reason this table does not name fails closed. */
const isUnownedReason = (reason: string): boolean =>
  Object.hasOwn(UNOWNED_BY_REASON, reason) && UNOWNED_BY_REASON[reason as DelegationCorrelationReason] === true;

/** The effect tags, as a TOTAL table over the union: an effect added to it is a compile error until it is named here. */
const DELEGATION_REPORT_EFFECT_KINDS: Readonly<Record<DelegationReportEffect['kind'], true>> = {
  'request-linked-lease-identity': true,
  'record-run-child-owned': true,
  'record-measured-absence': true,
  'record-unowned-worktree': true,
  'repair-report-projection': true,
  'record-observation-interval': true,
};

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lists are copied, de-duplicated and in code-unit order, so an effect neither aliases its input nor depends on its order. */
const idsOf = (list: readonly string[]): string[] => [...new Set(list)].sort();
const treeKey = (project: string, adminRecord: string): string => JSON.stringify([project, adminRecord]);
const parentKey = (parentId: string, parentIncarnation: string): string => JSON.stringify([parentId, parentIncarnation]);

/** An agent's tree is named for its upstream ID; a workflow worker's tree is its whole upstream ID, which ends in the worker index. */
const AGENT_TREE_PREFIX = 'agent-';
const WORKFLOW_WORKER_INDEX = /-\d+$/;

/**
 * Is this activity one the rung that linked it could have linked to this tree? A name is routing, never proof, and the ladder already
 * decided; this is policy refusing a verdict whose activity cannot be the tree's by its own kind. It is how a Workflow RUN row (its
 * upstream ID is the run, with no worker index) and a listing-only Bash activity (rung 4 only) are kept from being read as a worker or
 * an owner.
 */
function activityMayOwn(activity: DelegationActivityRow, rung: 2 | 3 | 4, record: DelegationCensusRecord): boolean {
  switch (activity.sourceKind) {
    case 'agent': return rung === 3 || (rung === 2 && record.adminRecord === `${AGENT_TREE_PREFIX}${activity.upstreamId}`);
    case 'workflow': return rung === 2 && record.adminRecord === activity.upstreamId && WORKFLOW_WORKER_INDEX.test(activity.upstreamId);
    case 'bash-worktree': return rung === 4;
  }
}

/** What one pass knows of the checkpoint, indexed once. */
interface Ground {
  now: string;
  activitiesById: ReadonlyMap<string, DelegationActivityRow>;
  activitiesByIdentity: ReadonlyMap<string, readonly DelegationActivityRow[]>;
  sessions: ReadonlySet<string>;
  attemptIds: ReadonlySet<string>;
  finalConflicts: ReadonlySet<string>;
  openLeases: ReadonlySet<string>;
}

const leaseKey = (activityId: string, project: string, adminRecord: string, canonicalPath: string): string => JSON.stringify([activityId, project, adminRecord, canonicalPath]);

function groundOf(now: string, recovery: DelegationRecoveryState): Ground {
  const cp = recovery.checkpoint;
  const byIdentity = new Map<string, DelegationActivityRow[]>();
  for (const a of cp.activities) byIdentity.set(a.identityJournalId, [...(byIdentity.get(a.identityJournalId) ?? []), a]);
  return {
    now,
    activitiesById: new Map(cp.activities.map((a) => [a.activityId, a] as const)),
    activitiesByIdentity: byIdentity,
    sessions: new Set(cp.sessions.map((s) => parentKey(s.sessionId, s.parentIncarnation))),
    attemptIds: new Set(cp.attempts.map((a) => a.attemptId)),
    finalConflicts: new Set(cp.attempts.filter((a) => a.verdict === 'conflicting').map((a) => treeKey(a.project, a.adminRecord))),
    openLeases: new Set(cp.leases.filter((l) => l.releasedAt === null).map((l) => leaseKey(l.activityId, l.project, l.adminRecord, l.canonicalPath))),
  };
}

/** The parents the checkpoint can attribute these journal records to: those of the activities whose identity record they name. Only a
 *  parent with a session row is a parent an attempt can reference. In a stable order. */
function parentsNamedBy(ground: Ground, evidence: readonly string[]): { parentId: string; parentIncarnation: string }[] {
  const out = new Map<string, { parentId: string; parentIncarnation: string }>();
  for (const id of evidence) {
    for (const a of ground.activitiesByIdentity.get(id) ?? []) {
      const key = parentKey(a.parentId, a.parentIncarnation);
      if (ground.sessions.has(key)) out.set(key, { parentId: a.parentId, parentIncarnation: a.parentIncarnation });
    }
  }
  return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, parent]) => parent);
}

/** One attempt row. Its ID is the hash of what was decided and about whom, with NO clock, so the same decision seen again is the same
 *  row; the domain tag is a hash input, not a code. */
function attemptOf(
  ground: Ground,
  parent: { parentId: string; parentIncarnation: string },
  record: DelegationCensusRecord,
  fields: { rung: DelegationAttemptRow['rung']; verdict: DelegationAttemptRow['verdict']; detail: string | null; evidence: readonly string[] },
): DelegationAttemptRow {
  const evidence = idsOf(fields.evidence);
  return {
    attemptId: delegationSha256Hex(canonicalDelegationJson([
      'delegation_attempt_v1', parent.parentId, parent.parentIncarnation, record.project, record.adminRecord, record.canonicalPath,
      fields.rung, fields.verdict, fields.detail, evidence,
    ])),
    parentId: parent.parentId,
    parentIncarnation: parent.parentIncarnation,
    project: record.project,
    adminRecord: record.adminRecord,
    canonicalPath: record.canonicalPath,
    attemptedAt: ground.now,
    rung: fields.rung,
    verdict: fields.verdict,
    evidenceJournalIds: evidence,
    detail: fields.detail,
  };
}

// ── One record ────────────────────────────────────────────────────────────────────────────────────────────────────────

function planRunChildOwned(ground: Ground, record: DelegationCensusRecord, verdict: Extract<DelegationCorrelationVerdict, { kind: 'run-child-owned' }>): DelegationReportEffect[] {
  if (record.canonicalPath === null) return [];                                    // the attempt's `linked` verdict needs a path
  const owner = ground.activitiesById.get(verdict.activityId);
  const parents = owner === undefined
    ? parentsNamedBy(ground, verdict.evidenceJournalIds)
    : parentsNamedBy(ground, [owner.identityJournalId]).filter((p) => p.parentId === owner.parentId && p.parentIncarnation === owner.parentIncarnation);
  const out: DelegationReportEffect[] = [];
  for (const parent of parents) {
    const attempt = attemptOf(ground, parent, record, { rung: 1, verdict: 'linked', detail: null, evidence: verdict.evidenceJournalIds });
    if (!ground.attemptIds.has(attempt.attemptId)) out.push({ kind: 'record-run-child-owned', attempt });
  }
  return out;
}

function planLinked(ground: Ground, record: DelegationCensusRecord, verdict: Extract<DelegationCorrelationVerdict, { kind: 'linked' }>): DelegationReportEffect[] {
  const canonicalPath = record.canonicalPath;
  if (canonicalPath === null || verdict.evidenceJournalIds.length === 0) return [];
  const activity = ground.activitiesById.get(verdict.activityId);
  if (activity === undefined || !ground.sessions.has(parentKey(activity.parentId, activity.parentIncarnation))) return [];
  if (!activityMayOwn(activity, verdict.rung, record)) return [];
  if (ground.openLeases.has(leaseKey(activity.activityId, record.project, record.adminRecord, canonicalPath))) return [];
  const parent = { parentId: activity.parentId, parentIncarnation: activity.parentIncarnation };
  const attempt = attemptOf(ground, parent, record, { rung: verdict.rung, verdict: 'linked', detail: null, evidence: verdict.evidenceJournalIds });
  const request: DelegationLeaseCreationRequest = {
    activityId: activity.activityId,
    parentId: activity.parentId,
    parentIncarnation: activity.parentIncarnation,
    project: record.project,
    adminRecord: record.adminRecord,
    canonicalPath,
    creationBase: record.claudeBase,
    sourceKind: leaseSourceKindOfActivity(activity.sourceKind),
    correlationJournalIds: idsOf(verdict.evidenceJournalIds),
    firstObservedAt: ground.now,
  };
  return [{ kind: 'request-linked-lease-identity', attempt, request }];
}

function planUnowned(ground: Ground, record: DelegationCensusRecord, verdict: Extract<DelegationCorrelationVerdict, { kind: 'unresolved' | 'conflicting' }>): DelegationReportEffect[] {
  if (!isUnownedReason(verdict.reason)) return [];
  const out: DelegationReportEffect[] = [];
  for (const parent of parentsNamedBy(ground, verdict.evidenceJournalIds)) {
    const attempt = attemptOf(ground, parent, record, { rung: null, verdict: verdict.kind, detail: verdict.reason, evidence: verdict.evidenceJournalIds });
    if (!ground.attemptIds.has(attempt.attemptId)) out.push({ kind: 'record-unowned-worktree', attempt });
  }
  return out;
}

function planRecord(ground: Ground, claimsAllowed: boolean, record: DelegationCensusRecord, verdict: DelegationCorrelationVerdict): DelegationReportEffect[] {
  // Only a record measured PRESENT is a tree. An unreadable or absent one is no candidate, whatever verdict it was handed.
  if (record.state !== 'present') return [];
  const finalConflict = ground.finalConflicts.has(treeKey(record.project, record.adminRecord));
  switch (verdict.kind) {
    case 'run-child-owned':
      return planRunChildOwned(ground, record, verdict);
    case 'linked':
      return claimsAllowed && !finalConflict ? planLinked(ground, record, verdict) : [];
    case 'unresolved':
    case 'conflicting':
      return claimsAllowed && !finalConflict ? planUnowned(ground, record, verdict) : [];
    case 'unmeasured':
      return [];
  }
}

// ── Measured absence ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The trees a census does NOT show absent: a record that is present, or UNREADABLE (never absence). A tree no record names, or only an
 *  `absent` one, is absent from that listing. */
function notAbsentIn(census: readonly DelegationCensusRecord[]): Set<string> {
  const out = new Set<string>();
  for (const r of census) if (r.state !== 'absent') out.add(treeKey(r.project, r.adminRecord));
  return out;
}

function planAbsences(now: string, recovery: DelegationRecoveryState, census: readonly DelegationCensusRecord[], previous: readonly DelegationCensusRecord[] | null): DelegationReportEffect[] {
  if (previous === null) return [];                                                // one successful census is not two
  const here = notAbsentIn(census);
  const before = notAbsentIn(previous);
  const held = new Map<string, { project: string; adminRecord: string }>();
  for (const l of recovery.checkpoint.leases) if (l.releasedAt === null) held.set(treeKey(l.project, l.adminRecord), { project: l.project, adminRecord: l.adminRecord });
  for (const a of recovery.checkpoint.attempts) held.set(treeKey(a.project, a.adminRecord), { project: a.project, adminRecord: a.adminRecord });
  return [...held.entries()]
    .filter(([key]) => !here.has(key) && !before.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, tree]) => ({ kind: 'record-measured-absence' as const, project: tree.project, adminRecord: tree.adminRecord, observedAt: now }));
}

// ── The plan ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `correlations[i]` is the verdict for `census[i]`. `census` and `previousSuccessfulCensus` must each be a MEASURED SUCCESS: a pass
 * whose census view is null is not a census, and the watcher must not call this with an empty list standing in for one (an empty
 * list reads as "every tree is gone"). The result lists, in order: each record's effects in census order, then measured absences by
 * tree, then the projection repair. A recovery that is not `ready` decides nothing.
 */
export function planDelegationReconciliation(input: DelegationReconciliationInput): readonly DelegationReportEffect[] {
  parseDelegationInstant(input.now);
  if (input.census.length !== input.correlations.length) {
    throw new DelegationModelError('bad-row', `the census holds ${input.census.length} records and ${input.correlations.length} verdicts were handed over; they are index-aligned`);
  }
  if (input.recovery.phase !== 'ready') return [];
  const ground = groundOf(input.now, input.recovery);
  const claimsAllowed = delegationCircuitBreaker(input) === 'clear';
  const effects: DelegationReportEffect[] = [];
  input.census.forEach((record, i) => {
    const verdict = input.correlations[i];
    if (verdict !== undefined) effects.push(...planRecord(ground, claimsAllowed, record, verdict));
  });
  effects.push(...planAbsences(input.now, input.recovery, input.census, input.previousSuccessfulCensus));
  effects.push({ kind: 'repair-report-projection', checkpointRevision: input.recovery.checkpoint.revision });
  return effects;
}

// ── The words this file spells, for the coordination scanner ─────────────────────────────────────────────────────────

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`: the six effect tags and every correlation
 *  reason it classifies (this file's two total tables), plus the verdict kind it reads (`run-child-owned`) from the correlation
 *  module's guard and the model refusal it throws (`bad-row`) from the model's, read and never re-spelled. Derived from tables, so a
 *  word added to a union is admitted and a typo is not. None is a mail rejection or a run refusal: an effect rides the watcher's
 *  lane and no route answers with one. */
export function isDelegationPolicyKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return own(DELEGATION_REPORT_EFFECT_KINDS) || own(UNOWNED_BY_REASON) || isDelegationCorrelationKebab(v) || isDelegationModelKebab(v);
}
