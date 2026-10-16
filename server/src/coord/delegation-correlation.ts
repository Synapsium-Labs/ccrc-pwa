// Delegation broker wave 3, Task 11: the PURE join qualification and correlation ladder (spec §5.4, §5.14).
//
// `correlateDelegation` answers one question for one worktree-census record: which delegation activity does this worktree belong to?
// The answer is `run-child-owned` (rung 1: the existing run/child model owns it), `linked` (rung 2, 3 or 4 proved it), or one of three
// honest non-answers: `unresolved` (the evidence exists and does not decide), `conflicting` (it decides two ways; final until an
// operator resolves it), `unmeasured` (something needed was unreadable or is not yet durably applied, so it is retried).
//
// THIS MODULE IS L1. It imports types, the model's pure helpers and nothing else: no filesystem, no clock, no randomness, no store.
// Time comes only from the listing windows it is handed. It decides and emits NOTHING: no lease request, no journal entry, no effect.
// Task 12's pure policy turns a `linked` verdict into a `DelegationLeaseCreationRequest` (and a `run-child-owned` one into a
// `record-run-child-owned`, never a lease); Task 13 wires both to the watcher.
//
// THE LADDER
//   1. Run-child agreement is its own terminal verdict. A tree that gains a registry row or a `.child` marker within two
//      reconciliation passes is a ccd workspace being BORN, never a lease, so no lease verdict is given while the wait stands.
//   2. Exact upstream identity. A tree named `agent-<id>` or `wf_<run>-<n>` is decided HERE OR NOT AT ALL: the name routes, it never
//      links, and without rung-2 evidence the tree is `unmeasured` (retried), never passed to rungs 3 and 4. The same upstream ID in
//      two parents' evidence is `conflicting`.
//   3. The subagent's own path: an event from inside a subagent whose `cwd` equals the canonical path. "Inside a subagent" means
//      only that its `agentId` belongs to an activity a qualifying join has opened (a bare `agent_id` is retained evidence, not
//      placement; amendment `tool-agent-id-alone-is-unjoined-evidence`). The parent's own `cwd` never links.
//   4. The session's own creation delta: one Bash call whose before/after listings differ by exactly the one added admin record,
//      while no other session's window on the same repository overlaps it in time.
//
// NEVER LINKS: a display name, a name pattern, a branch prefix, a timestamp or a census bracket, process ancestry, directory nesting,
// a session's own working directory. This file reads from a census record only `state`, `adminRecord`, `project` and `canonicalPath`;
// the three pinned folds of wave 1's D-4008 (`locked` false for a failed stat, `baseAgreesFirstLog` null for an unreadable first log,
// an unreadable `gitdir` read as an absent canonical path) are no evidence of anything, and a source scan pins that nothing here reads
// them.
//
// THE EVIDENCE HORIZON (R57, D-4653; spec §5.3: "a lost event can delay or prevent a link, never create one"). The caller holds a bounded
// slice of the journal. Rung 4's overlap rule and the claimed-by-more-than-one-session rules of rungs 2 and 3 are NEGATIVE evidence: they
// keep a tree from linking only while the other party's events are still held. So the caller says how far its eviction reached
// (`evidenceHorizon`: the latest `observedAt` among events it no longer holds, or null when it dropped none), and a link that rests on
// such negative evidence becomes `unmeasured('evidence-horizon')` when the evidence it rests on reaches back to that horizon. A verdict
// that was not a link is never touched: an eviction can make a verdict less decided and never more.
//
// INTERPRETATIONS (each recorded in the task report): `conflicting` is decided over PARENTS: two linked rungs that name the same
// parent are agreement (the lowest rung's activity is reported) and two that name different parents conflict; `repository` on a
// listing window is compared to the census record's `project`, the one repository key the census carries; an `unresolved` ccd
// workspace (registry row or `.child` without run-child agreement) and a record whose first pass is still inside the birth wait are
// non-answers, not leases.
import { DELEGATION_ACTIVITY_SOURCE_KINDS, type DelegationEventEnvelopeV1, type DelegationLeaseSourceKind } from '../../../shared/api.js';
import {
  DELEGATION_MODEL_REFUSALS,
  DelegationModelError,
  leaseSourceKindOfActivity,
  parseDelegationInstant,
  type DelegationActivityRow,
  type DelegationCensusRecord,
} from './delegation-model.js';

// ── The vocabulary the plan fixes ─────────────────────────────────────────────────────────────────────────────────────

/** One Bash call's before/after listing of a repository's admin-record names, with the call's time window. */
export interface DelegationListingWindow {
  sessionId: string;
  parentIncarnation: string;
  toolUseId: string;
  repository: string;
  startedAt: string;
  endedAt: string | null;
  before: readonly string[];
  after: readonly string[] | null;
}

export interface DelegationCorrelationInput {
  record: DelegationCensusRecord;
  runChildAgreement: {
    activityId: string;
    evidenceJournalIds: readonly string[];
  } | null;
  activities: readonly DelegationActivityRow[];
  acceptedEvidence: readonly {
    journalId: string;
    event: DelegationEventEnvelopeV1;
  }[];
  pointMetas: readonly {
    parentId: string;
    parentIncarnation: string;
    sourceKind: 'agent' | 'workflow';
    upstreamId: string;
    worktreePath: string;
    evidenceJournalId: string;
  }[];
  listingWindows: readonly DelegationListingWindow[];
  birthPassesRemaining: 0 | 1 | 2;
  hasRegistryRow: boolean;
  hasChildMarker: boolean;
  /** R57 (D-4653): the latest `observedAt` among events the caller has evicted from `acceptedEvidence` and `listingWindows`, or null when
   *  it evicted none. Every event observed AFTER it is held; an event at or before it may have been lost. */
  evidenceHorizon: string | null;
}

export type DelegationCorrelationVerdict =
  | {
      kind: 'run-child-owned';
      activityId: string;
      evidenceJournalIds: readonly string[];
    }
  | {
      kind: 'linked';
      activityId: string;
      rung: 2 | 3 | 4;
      evidenceJournalIds: readonly string[];
    }
  | { kind: 'unresolved'; reason: string; evidenceJournalIds: readonly string[] }
  | { kind: 'conflicting'; reason: string; evidenceJournalIds: readonly string[] }
  | { kind: 'unmeasured'; reason: string; evidenceJournalIds: readonly string[] };

/** The only verdict that may reach lease creation. `run-child-owned` is deliberately not assignable to it (W3-M63). */
export type DelegationLinkedVerdict = Extract<DelegationCorrelationVerdict, { kind: 'linked' }>;

/**
 * Every reason a non-answer can carry, declared ONCE. The plan types a verdict's `reason` as `string`, and that stays; but Task 12 must
 * branch on some of them (`ccrc-birth-wait` and `ccd-workspace-not-a-lease` are a tree being BORN, not unowned work), so the words are
 * a closed list it imports rather than spells. Server-internal (it is not a wire word), hence here and not in `shared/api.ts`.
 */
export const DELEGATION_CORRELATION_REASONS = [
  'record-unreadable',
  'record-absent',
  'ccd-workspace-not-a-lease',
  'ccrc-birth-wait',
  'canonical-path-unmeasured',
  'rung-2-evidence-absent',
  'same-upstream-id-in-multiple-sessions',
  'duplicate-activity-rows',
  'rung-2-meta-absent',
  'meta-paths-disagree',
  'rung-2-path-mismatch',
  'rung-2-subagent-event-absent',
  'activity-not-durably-open',
  'agent-id-claimed-by-multiple-sessions',
  'path-claimed-by-multiple-parents',
  'ambiguous-subagent-path',
  'parent-cwd',
  'overlapping-listing-window',
  'listing-window-instant-unreadable',
  'ambiguous-listing-windows',
  'rungs-disagree',
  'no-correlating-evidence',
  'evidence-horizon',
] as const;
export type DelegationCorrelationReason = (typeof DELEGATION_CORRELATION_REASONS)[number];

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Unlinked {
  kind: 'unresolved' | 'conflicting' | 'unmeasured';
  reason: DelegationCorrelationReason;
  evidenceJournalIds: readonly string[];
}
type Answer = DelegationLinkedVerdict | Unlinked;

/** Evidence lists are de-duplicated and in code-unit order, so a verdict does not depend on the order evidence was handed over. */
const ids = (list: readonly string[]): string[] => [...new Set(list)].sort();
const unresolved = (reason: DelegationCorrelationReason, evidence: readonly string[] = []): Unlinked => ({ kind: 'unresolved', reason, evidenceJournalIds: ids(evidence) });
const conflicting = (reason: DelegationCorrelationReason, evidence: readonly string[] = []): Unlinked => ({ kind: 'conflicting', reason, evidenceJournalIds: ids(evidence) });
const unmeasured = (reason: DelegationCorrelationReason, evidence: readonly string[] = []): Unlinked => ({ kind: 'unmeasured', reason, evidenceJournalIds: ids(evidence) });
const linked = (activityId: string, rung: 2 | 3 | 4, evidence: readonly string[]): DelegationLinkedVerdict => ({ kind: 'linked', activityId, rung, evidenceJournalIds: ids(evidence) });

/** A parent is (ccd id, registry incarnation): the same ccd id under another incarnation is another parent. */
const parentKey = (parentId: string, parentIncarnation: string): string => JSON.stringify([parentId, parentIncarnation]);

const AGENT_PREFIX = 'agent-';
const WORKFLOW_PREFIX = 'wf_';

/** A non-empty string is the only kind of ID or path there is; anything else names nothing. */
const text = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** Does this event CLAIM the agent: a SubagentStart naming it, or an Agent/Task launch response that launched it. A SubagentStop
 *  alone and a bare tool event do not (an unpaired stop is routine, and a bare `agent_id` is not placement). */
function claimsAgent(event: DelegationEventEnvelopeV1, agentId: string): boolean {
  if (event.eventKind === 'SubagentStart') return event.agentId === agentId;
  if (event.eventKind === 'PostToolUse' && (event.toolName === 'Agent' || event.toolName === 'Task')) {
    const launch = event.launch;
    return typeof launch === 'object' && launch !== null && launch.agentId === agentId;
  }
  return false;
}

interface Claims {
  /** The distinct parents that hold this upstream ID in any of their durable evidence. */
  parents: Map<string, { parentId: string; parentIncarnation: string }>;
  /** The journal records that show those claims. */
  journalIds: string[];
}

/** Every parent that claims the upstream ID: through an open activity, a point meta, or (for an agent) a claiming event. */
function claimsOf(input: DelegationCorrelationInput, sourceKind: 'agent' | 'workflow', upstreamId: string): Claims {
  const claims: Claims = { parents: new Map(), journalIds: [] };
  const claim = (parentId: string, parentIncarnation: string, journalId: string): void => {
    claims.parents.set(parentKey(parentId, parentIncarnation), { parentId, parentIncarnation });
    claims.journalIds.push(journalId);
  };
  for (const a of input.activities) if (a.sourceKind === sourceKind && a.upstreamId === upstreamId) claim(a.parentId, a.parentIncarnation, a.identityJournalId);
  for (const m of input.pointMetas) if (m.sourceKind === sourceKind && m.upstreamId === upstreamId) claim(m.parentId, m.parentIncarnation, m.evidenceJournalId);
  if (sourceKind === 'agent') {
    for (const { journalId, event } of input.acceptedEvidence) if (claimsAgent(event, upstreamId)) claim(event.sessionId, event.parentIncarnation, journalId);
  }
  return claims;
}

// ── The evidence horizon (R57, D-4653) ───────────────────────────────────────────────────────────────────────────────

/**
 * How long after the horizon a listing window must have begun for rung 4 to trust that no evicted window overlaps it: ten minutes.
 * A window is a Bash call, and Claude Code's Bash tool ends a call at its timeout, ten minutes at the longest by default; a call that
 * began at or before the horizon and was still running a margin later is a call that outlived its own ceiling, and a call that never
 * reported its end is an OPEN-ENDED window, which the rule below already refuses. So a candidate window that began a full margin after
 * the horizon cannot overlap a window whose events were evicted, and one that began sooner might.
 */
export const DELEGATION_EVIDENCE_MARGIN_MS = 10 * 60 * 1000;

/** The horizon as epoch milliseconds, or `null` when the caller evicted nothing. A horizon that is not a canonical instant fails SAFE:
 *  `NaN` makes every comparison below false, which the callers read as "reaches the horizon" (see `reachesHorizon`). */
function horizonMsOf(input: DelegationCorrelationInput): number | null {
  if (input.evidenceHorizon === null) return null;
  try { return parseDelegationInstant(input.evidenceHorizon); } catch (err) { if (err instanceof DelegationModelError) return Number.NaN; throw err; }
}

/**
 * Do this activity's claims reach back to the horizon? Its claim set is complete only if no claim of it, or of a rival for the same
 * upstream ID, can have been evicted; an event can have been evicted only if it was observed at or before the horizon. So the claim set
 * is complete only when the activity's identity record AND its earliest claiming event (a start, a stop or a launch response naming its
 * agent, from its own parent) were observed strictly after it. With no horizon nothing was evicted. An unreadable horizon reaches.
 */
function reachesHorizon(input: DelegationCorrelationInput, activity: DelegationActivityRow): boolean {
  const horizon = horizonMsOf(input);
  if (horizon === null) return false;
  if (Number.isNaN(horizon)) return true;
  let earliest: number;
  try { earliest = parseDelegationInstant(activity.openedAt); } catch (err) { if (err instanceof DelegationModelError) return true; throw err; }
  for (const { event } of input.acceptedEvidence) {
    if (event.sessionId !== activity.parentId || event.parentIncarnation !== activity.parentIncarnation) continue;
    const named = event.agentId === activity.upstreamId || (event.eventKind === 'PostToolUse' && 'launch' in event && event.launch !== null
      && typeof event.launch === 'object' && 'agentId' in event.launch && event.launch.agentId === activity.upstreamId);
    if (!named) continue;
    try { earliest = Math.min(earliest, parseDelegationInstant(event.observedAt)); } catch (err) { if (err instanceof DelegationModelError) return true; throw err; }
  }
  return earliest <= horizon;
}

// ── Rung 2: exact upstream identity ──────────────────────────────────────────────────────────────────────────────────

/**
 * Decides a tree named `agent-<id>` (sourceKind `agent`, upstream ID `<id>`) or `wf_<run>-<n>` (sourceKind `workflow`, the whole name).
 * It ALWAYS answers: with no rung-2 evidence the answer is `unmeasured`, because the name only routes. The proof is the parent's own
 * evidence (an agent needs a SubagentStart or SubagentStop for the ID from the same parent; a workflow worker needs only its meta),
 * a point meta whose `worktreePath` EQUALS the canonical path, string for string, and the activity a qualifying join has durably opened.
 */
function rung2(input: DelegationCorrelationInput, sourceKind: 'agent' | 'workflow', upstreamId: string, canonical: string): Answer {
  const claims = claimsOf(input, sourceKind, upstreamId);
  if (claims.parents.size === 0) return unmeasured('rung-2-evidence-absent');
  if (claims.parents.size > 1) return conflicting('same-upstream-id-in-multiple-sessions', claims.journalIds);
  const [parent] = [...claims.parents.values()];
  if (parent === undefined) return unmeasured('rung-2-evidence-absent');
  const same = (parentId: string, parentIncarnation: string): boolean => parentId === parent.parentId && parentIncarnation === parent.parentIncarnation;

  const activities = input.activities.filter((a) => a.sourceKind === sourceKind && a.upstreamId === upstreamId && same(a.parentId, a.parentIncarnation));
  if (new Set(activities.map((a) => a.activityId)).size > 1) return conflicting('duplicate-activity-rows', activities.map((a) => a.identityJournalId));
  const metas = input.pointMetas.filter((m) => m.sourceKind === sourceKind && m.upstreamId === upstreamId && same(m.parentId, m.parentIncarnation));
  if (metas.length === 0) return unmeasured('rung-2-meta-absent', claims.journalIds);
  const metaIds = metas.map((m) => m.evidenceJournalId);
  if (new Set(metas.map((m) => m.worktreePath)).size > 1) return conflicting('meta-paths-disagree', [...metaIds, ...activities.map((a) => a.identityJournalId)]);
  if (metas[0]?.worktreePath !== canonical) return unmeasured('rung-2-path-mismatch', metaIds);

  const spool: string[] = [];
  if (sourceKind === 'agent') {
    for (const { journalId, event } of input.acceptedEvidence) {
      if ((event.eventKind === 'SubagentStart' || event.eventKind === 'SubagentStop') && event.agentId === upstreamId && same(event.sessionId, event.parentIncarnation)) spool.push(journalId);
    }
    if (spool.length === 0) return unmeasured('rung-2-subagent-event-absent', metaIds);
  }
  const activity = activities[0];
  if (activity === undefined) return unmeasured('activity-not-durably-open', [...metaIds, ...spool]);
  // R57: the "one parent" and "one activity row" checks above are negative evidence an eviction could have emptied.
  if (reachesHorizon(input, activity)) return unmeasured('evidence-horizon', [...spool, ...metaIds, activity.identityJournalId]);
  return linked(activity.activityId, 2, [...spool, ...metaIds, activity.identityJournalId]);
}

// ── Rung 3: the subagent's own path ──────────────────────────────────────────────────────────────────────────────────

function rung3(input: DelegationCorrelationInput, canonical: string): Answer | null {
  const hits = new Map<string, { activity: DelegationActivityRow; journalIds: string[] }>();
  // Parents that THEMSELVES reported the path as a working directory (an event with no `agentId`). A non-isolated subagent inherits its
  // parent's cwd on every event it emits, so a cwd the parent reported can never place a subagent (ruling R42).
  const parentReported = new Map<string, string[]>();
  for (const { journalId, event } of input.acceptedEvidence) {
    if (!text(event.cwd) || event.cwd !== canonical) continue;
    const agentId = event.agentId;
    if (!text(agentId)) {
      const key = parentKey(event.sessionId, event.parentIncarnation);
      parentReported.set(key, [...(parentReported.get(key) ?? []), journalId]);
      continue;
    }
    // SubagentStart and SubagentStop are the host's own events about the agent and carry the parent's context on a non-isolated one:
    // they are not "emitted from inside" it.
    if (event.eventKind === 'SubagentStart' || event.eventKind === 'SubagentStop') continue;
    const activity = input.activities.find((a) => a.sourceKind === 'agent' && a.upstreamId === agentId && a.parentId === event.sessionId && a.parentIncarnation === event.parentIncarnation);
    if (activity === undefined) continue;                                        // an agent no qualifying join opened: evidence, not placement
    const hit = hits.get(activity.activityId) ?? { activity, journalIds: [activity.identityJournalId] };
    hit.journalIds.push(journalId);
    hits.set(activity.activityId, hit);
  }
  if (hits.size === 0) return null;
  const all = [...hits.values()].flatMap((h) => h.journalIds);
  for (const { activity } of hits.values()) {
    const reported = parentReported.get(parentKey(activity.parentId, activity.parentIncarnation));
    if (reported !== undefined) return unresolved('parent-cwd', [...all, ...reported]);
  }
  for (const { activity } of hits.values()) {
    if (claimsOf(input, 'agent', activity.upstreamId).parents.size > 1) return conflicting('agent-id-claimed-by-multiple-sessions', all);
  }
  if (hits.size > 1) {
    const parents = new Set([...hits.values()].map((h) => parentKey(h.activity.parentId, h.activity.parentIncarnation)));
    return parents.size > 1 ? conflicting('path-claimed-by-multiple-parents', all) : unresolved('ambiguous-subagent-path', all);
  }
  const [only] = [...hits.values()];
  if (only === undefined) return null;
  // R57: the vetoes above (`parent-cwd`, a second claimant, a second subagent on the path) are negative evidence an eviction could have emptied.
  if (reachesHorizon(input, only.activity)) return unmeasured('evidence-horizon', only.journalIds);
  return linked(only.activity.activityId, 3, only.journalIds);
}

// ── Rung 4: the session's own creation delta ─────────────────────────────────────────────────────────────────────────

/** Did this window add exactly the one record, and remove none? A window with no after-listing measured no delta at all. */
function addedExactly(window: DelegationListingWindow, adminRecord: string): boolean {
  if (window.after === null) return false;
  const before = new Set(window.before);
  const after = new Set(window.after);
  const added = [...after].filter((name) => !before.has(name));
  const removed = [...before].filter((name) => !after.has(name));
  return added.length === 1 && added[0] === adminRecord && removed.length === 0;
}

function rung4(input: DelegationCorrelationInput): Answer | null {
  const { record } = input;
  const candidates = input.listingWindows.filter((w) => w.repository === record.project && addedExactly(w, record.adminRecord));
  if (candidates.length === 0) return null;
  try {
    const span = (w: DelegationListingWindow): [number, number] => [parseDelegationInstant(w.startedAt), w.endedAt === null ? Number.POSITIVE_INFINITY : parseDelegationInstant(w.endedAt)];
    // Overlap first: a delta that another session's window overlaps is `unresolved` however many windows also show the record.
    for (const mine of candidates) {
      const [start, end] = span(mine);
      const mineKey = parentKey(mine.sessionId, mine.parentIncarnation);
      for (const other of input.listingWindows) {
        if (other.repository !== mine.repository || parentKey(other.sessionId, other.parentIncarnation) === mineKey) continue;
        const [otherStart, otherEnd] = span(other);
        if (start <= otherEnd && otherStart <= end) return unresolved('overlapping-listing-window');
      }
    }
  } catch (err) {
    if (err instanceof DelegationModelError) return unmeasured('listing-window-instant-unreadable');
    throw err;
  }
  if (candidates.length > 1) return unresolved('ambiguous-listing-windows');
  const [mine] = candidates;
  if (mine === undefined) return null;
  const activity = input.activities.find((a) => a.sourceKind === 'bash-worktree' && a.upstreamId === mine.toolUseId && a.parentId === mine.sessionId && a.parentIncarnation === mine.parentIncarnation);
  if (activity === undefined) return unmeasured('activity-not-durably-open');
  const call = input.acceptedEvidence
    .filter(({ event }) => event.sessionId === mine.sessionId && event.parentIncarnation === mine.parentIncarnation
      && (event.eventKind === 'PreToolUse' || event.eventKind === 'PostToolUse') && event.toolName === 'Bash' && event.toolUseId === mine.toolUseId)
    .map(({ journalId }) => journalId);
  // R57: the overlap rule above is negative evidence. A window whose pre-listing was evicted is a window that is not there to overlap.
  // The link stands only if every window the caller holds on this repository is closed and began after the horizon, and the candidate
  // began a full margin after it (`DELEGATION_EVIDENCE_MARGIN_MS`).
  const horizon = horizonMsOf(input);
  if (horizon !== null) {
    let reaches: boolean;
    try {
      reaches = Number.isNaN(horizon)
        || input.listingWindows.some((w) => w.repository === mine.repository && (w.endedAt === null || parseDelegationInstant(w.startedAt) <= horizon))
        || parseDelegationInstant(mine.startedAt) < horizon + DELEGATION_EVIDENCE_MARGIN_MS;
    } catch (err) {
      if (!(err instanceof DelegationModelError)) throw err;
      reaches = true;
    }
    if (reaches) return unmeasured('evidence-horizon', [...call, activity.identityJournalId]);
  }
  return linked(activity.activityId, 4, [...call, activity.identityJournalId]);
}

/**
 * Rungs 3 and 4 are both tried, and a conflict at either is final. Two linked answers that name different PARENTS conflict; two that
 * name the same parent agree, and the lowest rung's activity is the answer. A link beside a merely unresolved or unmeasured answer is
 * the link (a linked answer decides).
 */
function combine(input: DelegationCorrelationInput, answers: readonly (Answer | null)[]): Answer {
  const present = answers.filter((a): a is Answer => a !== null);
  const everything = present.flatMap((a) => a.evidenceJournalIds);       // for a disagreement: every witness
  const conflict = present.find((a): a is Unlinked => a.kind === 'conflicting');
  if (conflict !== undefined) return conflicting(conflict.reason, [...conflict.evidenceJournalIds, ...present.filter((a) => a.kind === 'linked').flatMap((a) => a.evidenceJournalIds)]);
  const links = present.filter((a): a is DelegationLinkedVerdict => a.kind === 'linked');
  const [lowest] = links;
  if (lowest !== undefined) {
    const parentOf = (v: DelegationLinkedVerdict): string => {
      const a = input.activities.find((row) => row.activityId === v.activityId);
      return a === undefined ? JSON.stringify(['missing', v.activityId]) : parentKey(a.parentId, a.parentIncarnation);
    };
    if (new Set(links.map(parentOf)).size > 1) return conflicting('rungs-disagree', everything);
    // The proof of a link is the links' own evidence: a non-answer beside it (a refused parent-cwd, an overlap) proves nothing.
    return linked(lowest.activityId, lowest.rung, links.flatMap((l) => l.evidenceJournalIds));
  }
  return present[0] ?? unresolved('no-correlating-evidence');
}

// ── The ladder ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function correlateDelegation(input: DelegationCorrelationInput): DelegationCorrelationVerdict {
  const { record } = input;
  // Rung 1: the existing model owns the workspace. Terminal, and never a lease.
  if (input.runChildAgreement !== null) {
    return { kind: 'run-child-owned', activityId: input.runChildAgreement.activityId, evidenceJournalIds: [...input.runChildAgreement.evidenceJournalIds] };
  }
  if (record.state === 'unreadable') return unmeasured('record-unreadable');
  if (record.state === 'absent') return unresolved('record-absent');
  // A tree that has gained a registry row or a `.child` is a ccd workspace (born or not), never a lease.
  if (input.hasRegistryRow || input.hasChildMarker) return unresolved('ccd-workspace-not-a-lease');
  // A tree seen for the first time is inside the two-pass wait: it may yet be a ccd workspace being born.
  if (input.birthPassesRemaining > 0) return unresolved('ccrc-birth-wait');
  const canonical = record.canonicalPath;
  if (canonical === null) return unmeasured('canonical-path-unmeasured');

  // Rung 2 is the END of the road for a tree whose NAME routes it there: the name never links, and it never reaches rungs 3 and 4.
  if (record.adminRecord.startsWith(AGENT_PREFIX)) return rung2(input, 'agent', record.adminRecord.slice(AGENT_PREFIX.length), canonical);
  if (record.adminRecord.startsWith(WORKFLOW_PREFIX)) return rung2(input, 'workflow', record.adminRecord, canonical);
  return combine(input, [rung3(input, canonical), rung4(input)]);
}

/**
 * The lease provenance of a linked verdict's activity: `agent` and `workflow` for themselves, `raw` for a `bash-worktree` activity.
 * Wave 3 has no writer of `attached`, and none of the three can produce it. The activity must be one the caller has: there is no
 * default for a missing one.
 */
export function delegationLeaseSourceOfLinked(verdict: DelegationLinkedVerdict, activities: readonly DelegationActivityRow[]): DelegationLeaseSourceKind {
  const activity = activities.find((a) => a.activityId === verdict.activityId);
  if (activity === undefined) throw new DelegationModelError('bad-row', `the linked activity ${verdict.activityId} is not among the activities handed over`);
  return leaseSourceKindOfActivity(activity.sourceKind);
}

// ── The words this file spells, for the coordination scanner ─────────────────────────────────────────────────────────

/** The verdict kinds, as a TOTAL table over `DelegationCorrelationVerdict['kind']`. */
const DELEGATION_CORRELATION_VERDICT_KINDS: Readonly<Record<DelegationCorrelationVerdict['kind'], true>> = {
  'run-child-owned': true, linked: true, unresolved: true, conflicting: true, unmeasured: true,
};

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`: the verdict kinds, every reason a
 *  non-answer carries (`DELEGATION_CORRELATION_REASONS`, declared once above), `bash-worktree` from `shared/api.ts`'s activity
 *  source kinds and the model refusal it throws (`bad-row`), read from the model's table, never re-spelled. Derived from tables,
 *  so a word added to a union is admitted and a typo is not. None is a mail rejection or a run refusal: a verdict rides the
 *  projection and the lease request, and no route answers with one. */
export function isDelegationCorrelationKebab(v: string): boolean {
  return Object.prototype.hasOwnProperty.call(DELEGATION_CORRELATION_VERDICT_KINDS, v)
    || (DELEGATION_CORRELATION_REASONS as readonly string[]).includes(v)
    || (DELEGATION_ACTIVITY_SOURCE_KINDS as readonly string[]).includes(v)
    || Object.prototype.hasOwnProperty.call(DELEGATION_MODEL_REFUSALS, v);
}
