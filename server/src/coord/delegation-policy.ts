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
//   * D-4650: the input pairs each verdict with its record (`correlations` is `{record, verdict}[]`), so a verdict can never be applied
//     to the wrong tree; a pair whose record the census does not hold is a defect (it throws). The input also names the projects whose
//     census was a measured success this pass and the previous successful one: measured absence needs a tree's project in BOTH.
//   * An attempt row belongs to a parent (its session is a foreign key). A verdict names none, so the parent is read from the checkpoint:
//     a linked or run-child-owned verdict's activity, or (unowned work) the activities whose identity record the verdict's evidence
//     names. When no parent is named, an attempt cannot be filed without inventing one, so nothing is reported for that tree this pass.
//   * The circuit breaker withholds OWNERSHIP CLAIMS (a lease request, an unowned report); it adds no effect and takes no action. Facts
//     the census alone proves (run-child ownership, absence) are still reported.
//   * A `record-observation-interval` is a member of the union but policy never needs it in wave 3: intervals are measured where the
//     bytes are read (ingestion), and a policy-made `unmeasured` hour for a registry blip would cost the seven-day health window.
//   * A conflict is final per TREE (project and admin record), whichever parent or time recorded it.
//   * A tree an unreleased lease already holds (matched by canonical path, or by project and admin record) is never requested again.
//     The same activity: nothing. Another activity's link: no request, and a `conflicting` attempt (`rungs-disagree`), since a later
//     answer that disagrees with an existing link turns it conflicting (spec §5.4). The existing lease is not touched.
//   * Run versus worker is read from the checkpoint's ROWS, never from spelling: a workflow activity is a worker only when a run row
//     of the same parent and incarnation shares its identity record and its upstream ID is the run's plus `-<index>`.
//   * A run-child verdict whose owner activity the checkpoint does not hold (or whose parent has no session) reports nothing.
import {
  type DelegationCorrelationReason,
  type DelegationCorrelationVerdict,
} from './delegation-correlation.js';
import {
  DELEGATION_MODEL_REFUSALS,
  DelegationModelError,
  canonicalDelegationJson,
  delegationSha256Hex,
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
  /** One entry per verdict, each with the census record it is about (D-4650). A pair's `record` must be in `census`. */
  correlations: readonly { record: DelegationCensusRecord; verdict: DelegationCorrelationVerdict }[];
  registryReadable: boolean;
  firstDeadParents: readonly { parentId: string; firstMeasuredDeadAt: string }[];
  previousSuccessfulCensus: readonly DelegationCensusRecord[] | null;
  /** The projects whose worktree census was a measured success THIS pass (D-4650). A tree is absent only where it was censused. */
  censusedProjects: readonly string[];
  /** The same for `previousSuccessfulCensus`; null when there is none. */
  previousCensusedProjects: readonly string[] | null;
}

// ── The circuit breaker ───────────────────────────────────────────────────────────────────────────────────────────────

/** Spec §5.5: two or more parents first measured dead within this window. */
export const DELEGATION_CIRCUIT_BREAKER_WINDOW_MS = 10 * 60 * 1000;

export type DelegationCircuitBreakerState = 'clear' | 'suspended' | 'unmeasured';

/**
 * Whether this pass may make ownership claims. A REPORT, never an action: it answers one word.
 *   suspended   the registry is unreadable, or two or more distinct parents were first measured dead inside the window. The window is
 *               inclusive at its edge and counts an instant up to one window later than `now` as inside: both err toward suspending.
 *   unmeasured  fewer than two fresh deaths, but some first-dead instant could not be read, so a second fresh death cannot be ruled out.
 *   clear       neither.
 * A parent is dead here only because the caller measured it so and handed it over; policy infers deadness from nothing else, so a
 * supervisor mid-restart is not dead. An instant more than one window AHEAD of `now` is clock skew and counts as unreadable.
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
    // Clock skew: an instant further ahead than the window cannot be told from a fresh death, so it is unreadable, not counted.
    if (at - nowMs > DELEGATION_CIRCUIT_BREAKER_WINDOW_MS) { unreadable = true; continue; }
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
  // R57, 2c (R84): an eviction, a lost window or a lost hour made the answer unmeasured. Nothing is known of the tree, so it is retried,
  // never reported as work.
  'evidence-horizon': false,
};

/**
 * The ONE classifier of what counts as unowned work (R59): true when a tree left with this reason is attempted-and-undecided work.
 * Policy files a report with it, and the watcher counts `unresolved` and `conflicting` with it, so the two cannot disagree; neither
 * keeps a second table. A reason this table does not name fails closed (false).
 */
export const isUnownedWorkReason = (reason: string): boolean =>
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

/** The verdict kinds this file reads, as a TOTAL table (it spells `run-child-owned` in a type). */
const DELEGATION_VERDICT_KINDS_READ: Readonly<Record<DelegationCorrelationVerdict['kind'], true>> = {
  'run-child-owned': true, linked: true, unresolved: true, conflicting: true, unmeasured: true,
};

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lists are copied, de-duplicated and in code-unit order, so an effect neither aliases its input nor depends on its order. */
const idsOf = (list: readonly string[]): string[] => [...new Set(list)].sort();
const treeKey = (project: string, adminRecord: string): string => JSON.stringify([project, adminRecord]);
const parentKey = (parentId: string, parentIncarnation: string): string => JSON.stringify([parentId, parentIncarnation]);

/** An agent's tree is named for its upstream ID. */
const AGENT_TREE_PREFIX = 'agent-';

/** `<run>-<index>` where the index is a canonical non-negative integer. */
function isWorkerOf(run: DelegationActivityRow, worker: DelegationActivityRow): boolean {
  if (!worker.upstreamId.startsWith(`${run.upstreamId}-`)) return false;
  const index = worker.upstreamId.slice(run.upstreamId.length + 1);
  return /^(?:0|[1-9]\d*)$/.test(index) && Number.isSafeInteger(Number(index));
}

/**
 * Is this workflow activity a WORKER, and not a RUN row? Decided from the checkpoint's rows, never from spelling (a run ID may itself
 * end in digits): a worker is opened from its run's meta, so a run row of the same parent and incarnation shares its identity record,
 * and its upstream ID is the run's plus `-<index>`. Any other workflow activity, the run row itself included, is not a worker.
 */
function isWorkflowWorker(activities: readonly DelegationActivityRow[], candidate: DelegationActivityRow): boolean {
  return activities.some((run) => run.sourceKind === 'workflow' && run.activityId !== candidate.activityId
    && run.parentId === candidate.parentId && run.parentIncarnation === candidate.parentIncarnation
    && run.identityJournalId === candidate.identityJournalId && isWorkerOf(run, candidate));
}

/**
 * Is this activity one the rung that linked it could have linked to this tree? A name is routing, never proof, and the ladder already
 * decided; this is policy refusing a verdict whose activity cannot be the tree's by its own kind. It keeps a Workflow RUN row from being
 * read as a worker, and an agent from owning another agent's tree. (It does NOT tell a listing-only Bash call from a creating one: the
 * rung-4 delta of exactly one added record, which correlation measures, is what keeps a listing from being evidence.)
 */
function activityMayOwn(activities: readonly DelegationActivityRow[], activity: DelegationActivityRow, rung: 2 | 3 | 4, record: DelegationCensusRecord): boolean {
  switch (leaseSourceKindOfActivity(activity.sourceKind)) {
    case 'agent': return rung === 3 || (rung === 2 && record.adminRecord === `${AGENT_TREE_PREFIX}${activity.upstreamId}`);
    case 'workflow': return rung === 2 && record.adminRecord === activity.upstreamId && isWorkflowWorker(activities, activity);
    case 'raw': return rung === 4;
    case 'attached': return false;
  }
}

/** What one pass knows of the checkpoint, indexed once. */
interface Ground {
  now: string;
  activities: readonly DelegationActivityRow[];
  activitiesById: ReadonlyMap<string, DelegationActivityRow>;
  activitiesByIdentity: ReadonlyMap<string, readonly DelegationActivityRow[]>;
  sessions: ReadonlySet<string>;
  attemptIds: ReadonlySet<string>;
  finalConflicts: ReadonlySet<string>;
  /** Every unreleased lease: whoever holds a tree holds it, whichever activity it names. */
  openLeases: readonly { activityId: string; parentId: string; parentIncarnation: string; project: string; adminRecord: string; canonicalPath: string }[];
}

function groundOf(now: string, recovery: DelegationRecoveryState): Ground {
  const cp = recovery.checkpoint;
  const byIdentity = new Map<string, DelegationActivityRow[]>();
  for (const a of cp.activities) byIdentity.set(a.identityJournalId, [...(byIdentity.get(a.identityJournalId) ?? []), a]);
  return {
    now,
    activities: cp.activities,
    activitiesById: new Map(cp.activities.map((a) => [a.activityId, a] as const)),
    activitiesByIdentity: byIdentity,
    sessions: new Set(cp.sessions.map((s) => parentKey(s.sessionId, s.parentIncarnation))),
    attemptIds: new Set(cp.attempts.map((a) => a.attemptId)),
    finalConflicts: new Set(cp.attempts.filter((a) => a.verdict === 'conflicting').map((a) => treeKey(a.project, a.adminRecord))),
    openLeases: cp.leases.filter((l) => l.releasedAt === null).map((l) => ({
      activityId: l.activityId, parentId: l.parentId, parentIncarnation: l.parentIncarnation, project: l.project, adminRecord: l.adminRecord, canonicalPath: l.canonicalPath,
    })),
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
  // The linked path's rule: an owner the checkpoint does not hold, or whose parent has no session row, is not reported. No parent is
  // guessed from the evidence (that would invent one).
  const owner = ground.activitiesById.get(verdict.activityId);
  if (owner === undefined || !ground.sessions.has(parentKey(owner.parentId, owner.parentIncarnation))) return [];
  const attempt = attemptOf(ground, owner, record, { rung: 1, verdict: 'linked', detail: null, evidence: verdict.evidenceJournalIds });
  return ground.attemptIds.has(attempt.attemptId) ? [] : [{ kind: 'record-run-child-owned', attempt }];
}

function planLinked(ground: Ground, record: DelegationCensusRecord, verdict: Extract<DelegationCorrelationVerdict, { kind: 'linked' }>): DelegationReportEffect[] {
  const canonicalPath = record.canonicalPath;
  if (canonicalPath === null || verdict.evidenceJournalIds.length === 0) return [];
  const activity = ground.activitiesById.get(verdict.activityId);
  if (activity === undefined || !ground.sessions.has(parentKey(activity.parentId, activity.parentIncarnation))) return [];
  if (!activityMayOwn(ground.activities, activity, verdict.rung, record)) return [];
  const parent = { parentId: activity.parentId, parentIncarnation: activity.parentIncarnation };
  // A tree or path an unreleased lease holds is held, whichever activity holds it. The same activity: nothing to do. Another
  // activity's link is a later answer that disagrees with an existing one, so it turns conflicting (and requests nothing).
  const holders = holdersOf(ground, record);
  if (holders.length > 0) {
    if (holders.every((l) => l.activityId === activity.activityId)) return [];
    const attempt = attemptOf(ground, parent, record, { rung: null, verdict: 'conflicting', detail: 'rungs-disagree', evidence: verdict.evidenceJournalIds });
    return ground.attemptIds.has(attempt.attemptId) ? [] : [{ kind: 'record-unowned-worktree', attempt }];
  }
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

/** The unreleased leases that hold this tree: by its canonical path, or by its (project, admin record). */
function holdersOf(ground: Ground, record: DelegationCensusRecord): Ground['openLeases'] {
  return ground.openLeases.filter((l) => (record.canonicalPath !== null && l.canonicalPath === record.canonicalPath) || (l.project === record.project && l.adminRecord === record.adminRecord));
}

/**
 * 5477 b (R84): a LATER rung-1 answer that disagrees with a lease. A tree an unreleased lease holds (a rung-4 lease in wave 3) that has
 * since gained a registry row or a `.child` is a ccd workspace, which is never a lease: the two answers disagree, so ONE conflicting
 * attempt (`rungs-disagree`, no rung) is filed under the LEASE's parent (which must have a session row: no parent is invented), with the
 * lease activity's identity record beside the verdict's evidence. The conflict is then final (`finalConflicts`): nothing re-links the
 * tree, and no second lease is requested. Wave 3 has no lease-level transition: the lease itself stays `linked`, the conflict is a
 * checkpoint attempt only, and a leased tree is outside the health counts. (A `run-child-owned` verdict beside a lease would be the same
 * disagreement; wave 3 hands correlation no run-child agreement, so it cannot arise here: a note for wave 5.)
 */
function planWorkspaceOverLease(ground: Ground, record: DelegationCensusRecord, verdict: Extract<DelegationCorrelationVerdict, { kind: 'unresolved' }>): DelegationReportEffect[] {
  const out: DelegationReportEffect[] = [];
  for (const holder of holdersOf(ground, record)) {
    if (!ground.sessions.has(parentKey(holder.parentId, holder.parentIncarnation))) continue;
    const identity = ground.activitiesById.get(holder.activityId)?.identityJournalId;
    const attempt = attemptOf(ground, holder, record, {
      rung: null, verdict: 'conflicting', detail: 'rungs-disagree', evidence: identity === undefined ? verdict.evidenceJournalIds : [...verdict.evidenceJournalIds, identity],
    });
    if (!ground.attemptIds.has(attempt.attemptId) && !out.some((e) => e.kind === 'record-unowned-worktree' && e.attempt.attemptId === attempt.attemptId)) {
      out.push({ kind: 'record-unowned-worktree', attempt });
    }
  }
  return out;
}

function planUnowned(ground: Ground, record: DelegationCensusRecord, verdict: Extract<DelegationCorrelationVerdict, { kind: 'unresolved' | 'conflicting' }>): DelegationReportEffect[] {
  if (!isUnownedWorkReason(verdict.reason)) return [];
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
      if (!claimsAllowed || finalConflict) return [];
      return verdict.reason === 'ccd-workspace-not-a-lease' ? planWorkspaceOverLease(ground, record, verdict) : planUnowned(ground, record, verdict);
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

function planAbsences(input: DelegationReconciliationInput): DelegationReportEffect[] {
  // One successful census is not two, and a tree is absent only where BOTH passes looked at its project (D-4650).
  if (input.previousSuccessfulCensus === null || input.previousCensusedProjects === null) return [];
  const censused = new Set(input.censusedProjects);
  const previouslyCensused = new Set(input.previousCensusedProjects);
  const here = notAbsentIn(input.census);
  const before = notAbsentIn(input.previousSuccessfulCensus);
  const held = new Map<string, { project: string; adminRecord: string }>();
  for (const l of input.recovery.checkpoint.leases) if (l.releasedAt === null) held.set(treeKey(l.project, l.adminRecord), { project: l.project, adminRecord: l.adminRecord });
  for (const a of input.recovery.checkpoint.attempts) held.set(treeKey(a.project, a.adminRecord), { project: a.project, adminRecord: a.adminRecord });
  return [...held.entries()]
    .filter(([key, tree]) => censused.has(tree.project) && previouslyCensused.has(tree.project) && !here.has(key) && !before.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, tree]) => ({ kind: 'record-measured-absence' as const, project: tree.project, adminRecord: tree.adminRecord, observedAt: input.now }));
}

// ── The plan ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Each entry of `correlations` pairs a verdict with the census record it is about; the record must be in `census`, and it contributes
 * ONLY its tree key (R54 N1): the plan reads the CENSUS's own record for that key, so a pair carrying a stale or foreign copy of a tree
 * (another state, path or base) is never acted on as if the census had measured it. A tree key paired twice is a defect (R54 N2): it is
 * refused (`bad-row`) and no pair is planned, because two verdicts for one tree could request two leases in one pass. `census` and
 * `previousSuccessfulCensus` must be measured successes for the projects named in `censusedProjects` and `previousCensusedProjects`:
 * a project whose census view was null is not listed, and its trees are never absent. The result lists, in order: each pair's effects
 * in the order given, then measured absences by tree, then the projection repair. A recovery that is not `ready` decides nothing.
 */
export function planDelegationReconciliation(input: DelegationReconciliationInput): readonly DelegationReportEffect[] {
  parseDelegationInstant(input.now);
  const censused = new Map<string, DelegationCensusRecord>();
  for (const r of input.census) if (!censused.has(treeKey(r.project, r.adminRecord))) censused.set(treeKey(r.project, r.adminRecord), r);
  const paired = new Set<string>();
  for (const { record } of input.correlations) {
    const key = treeKey(record.project, record.adminRecord);
    if (!censused.has(key)) {
      throw new DelegationModelError('bad-row', `a verdict is about ${record.project}/${record.adminRecord}, which the census does not hold`);
    }
    if (paired.has(key)) throw new DelegationModelError('bad-row', `the tree ${record.project}/${record.adminRecord} is paired with two verdicts: none is planned`);
    paired.add(key);
  }
  if (input.recovery.phase !== 'ready') return [];
  const ground = groundOf(input.now, input.recovery);
  const claimsAllowed = delegationCircuitBreaker(input) === 'clear';
  const effects: DelegationReportEffect[] = [];
  for (const { record, verdict } of input.correlations) effects.push(...planRecord(ground, claimsAllowed, censused.get(treeKey(record.project, record.adminRecord))!, verdict));
  effects.push(...planAbsences(input));
  effects.push({ kind: 'repair-report-projection', checkpointRevision: input.recovery.checkpoint.revision });
  return effects;
}

// ── The words this file spells, for the coordination scanner ─────────────────────────────────────────────────────────

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`: the six effect tags, every correlation
 *  reason it classifies as a table key, the verdict kinds it reads, and the one model refusal it throws (`bad-row`, read from the
 *  model's table). Derived from this file's own total tables, so a word added to a union is admitted and a typo is not; no other
 *  word of the correlation or model vocabularies is admitted. None is a mail rejection or a run refusal: an effect rides the
 *  watcher's lane and no route answers with one. */
export function isDelegationPolicyKebab(v: string): boolean {
  const own = (o: object): boolean => Object.prototype.hasOwnProperty.call(o, v);
  return own(DELEGATION_REPORT_EFFECT_KINDS) || own(UNOWNED_BY_REASON) || own(DELEGATION_VERDICT_KINDS_READ) || own(DELEGATION_MODEL_REFUSALS);
}
