// Delegation broker wave 5, PR7 (Task 5.7.2): adoption, the digest and the reminder (spec §5.6, §5.11; D-6999, D-7003, D-7812,
// D-7813, D-7821, D-7832, D-7852, D-7968).
//
// THIS MODULE IS L1: pure, no I/O, no clock (it is fed `now`), no capability read (it is fed `boxHolds` and the audit answers). It
// decides which unreleased `agent` or `workflow` lease the lane adopts, when, and what the lane only records it would adopt while the
// operator's marker is absent (O5-7 (a)); which kept leases are owed a reminder; which attention items stand; and the text of the
// one notice each adoption is owed. The lane (`delegationAdoptStep.ts`, L4) gathers the facts, acts through PR5b's `transitionLease`,
// and queues each owed notice from durable state.
//
// Terminal evidence is evidence that the lane may stop waiting, never a statement that the work completed: a dead parent does not prove
// a background agent stopped (ledger amendment `orphaned-background-agent-has-no-terminal-event`). No end is inferred from silence, a
// live parent, a missing `SessionEnd`, a SubagentStop alone, a paused workflow, an `unknown` status or an unmeasured read. A raw or
// attached lease is never adopted here (D-6999); a conflicting one waits for the operator's resolve (D-7003, D-7821).
import type { DelegationAdoptionHealth, DelegationLeaseSourceKind, LeaseAuditAnswer, LeaseAuditRefusal } from '../../../shared/api.js';
import { LEASE_AUDIT_REFUSALS } from '../../../shared/api.js';
import { delegationTreeKey } from './delegation-correlation.js';
import { parseDelegationInstant, formatDelegationInstant, type DelegationCheckpointV1, type DelegationLeaseRow } from './delegation-model.js';
import { DELEGATION_LEASE_EXPIRY_MS, delegationCarrierStateOf } from './delegation-lease-state.js';
import type { CarrierReadBack } from './delegation-carrier.js';
import type { DelegationCircuitBreakerState } from './delegation-policy.js';
import { DELEGATION_ORPHAN_HOLD_MARGIN_MS } from './delegation-orphan-hold.js';

/** A3, approved with the plan: how long after its terminal evidence a tree settles before it may be adopted. */
export const DELEGATION_ADOPT_SETTLE_MS = 5 * 60_000;
/** A3: how many earlier passes must have seen the same generation's terminal evidence before an adoption. */
export const DELEGATION_ADOPT_STABLE_PASSES = 2;
/** A3: a kept lease is reminded this long before its hold ends. */
export const DELEGATION_REMINDER_LEAD_MS = 24 * 3_600_000;
/** At most this many `ws-lease-audit` calls a pass; the rest count `unaudited` and wait. */
export const DELEGATION_AUDITS_PER_PASS = 4;
/** The lease sources this lane adopts (rule 1). A `raw` lease is attached by the operator (D-6999); `attached` is the operator's already. */
export const DELEGATION_ADOPTABLE_SOURCES = ['agent', 'workflow'] as const satisfies readonly DelegationLeaseSourceKind[];

/** What the lane measured of a lease's parent this pass: its registry row, the incarnation it reads, since when a supervisor has been
 *  measured dead outside its restart window for two passes (the lane's `firstDead`, as reconciliation's breaker reads it), and whether
 *  it is a ccd session (a registry row). `unmeasured` and a null incarnation are never evidence. */
export interface ParentFact { registry: 'present' | 'absent' | 'unmeasured'; incarnation: string | null; deadSince: string | null; ccd: boolean }

/**
 * Who is owed a lease's notices (O5-4 (a)): `coordinator` (the caller's `leaseCoordinatorOf(lease, runs)`) when it names one; else the
 * parent itself only while its measured incarnation is the lease's (`parentIncarnation`); else null (no mail: the feed row and the
 * operator's Keep control on the row). A re-created parent row is never mailed a Retain line it cannot use (W5-R2, D-7813).
 */
export function leaseRecipient(lease: Pick<DelegationLeaseRow, 'parentId' | 'parentIncarnation'>, parent: ParentFact | undefined,
  coordinator: string | null): string | null {
  if (coordinator !== null) return coordinator;
  if (parent === undefined || parent.registry !== 'present' || !parent.ccd) return null;
  return parent.incarnation === lease.parentIncarnation ? lease.parentId : null;
}

/** The lane's memory of one candidate: the generation it watched, its terminal instant, and the passes that saw it. */
export interface AdoptWatch { generation: number; terminalAt: string; passes: number }

export interface AdoptionInput {
  now: string;
  checkpoint: DelegationCheckpointV1;
  /** Each candidate's carrier, read by the lane itself at decision time this pass (never PR6's read-backs, D-8034). */
  carriers: ReadonlyMap<string, CarrierReadBack>;
  /** The census's `present` trees, by `delegationTreeKey`. */
  treePresent: ReadonlySet<string>;
  /** The projects whose census this pass is a measured success (D-7852). */
  censused: ReadonlySet<string>;
  /** The audit answers the lane holds, by lease id. Absent or `'not-asked'`: not measured yet. */
  audits: ReadonlyMap<string, LeaseAuditAnswer | 'unsupported' | 'not-asked'>;
  /** The lane's memory of the last pass. */
  watch: ReadonlyMap<string, AdoptWatch>;
  parents: ReadonlyMap<string, ParentFact>;
  /** `conflictingTreeKeys(checkpoint)` (PR8). */
  conflicting: ReadonlySet<string>;
  /** The box can hold a tree: it marks carriers, takes the orphan lock while it does, and its orphan rung skips a held tree (D-8040). */
  boxHolds: boolean;
  breaker: DelegationCircuitBreakerState;
  marker: 'present' | 'absent' | 'unmeasured';
  /** The attention keys raised and still standing as of the last pass (lane memory): a standing key is not raised again. */
  raised?: ReadonlySet<string>;
}

/** Why shadow only records an adoption: the operator's marker is absent, or the registry listing that would show it did not read. */
export const DELEGATION_WOULD_ADOPT_WHYS = ['marker-absent', 'marker-unmeasured'] as const;
export type DelegationWouldAdoptWhy = (typeof DELEGATION_WOULD_ADOPT_WHYS)[number];
/** The attention key of a breaker episode (one item per episode, W5-D21). */
export const DELEGATION_ADOPT_BREAKER_KEY = 'breaker-suspended';

export type AdoptionDecision =
  | { kind: 'adopt'; leaseId: string; expectGeneration: number; terminalAt: string; expiresAt: string }
  | { kind: 'would-adopt'; leaseId: string; why: DelegationWouldAdoptWhy }
  | { kind: 'audit'; leaseId: string; generation: number }
  | { kind: 'remind'; leaseId: string; generation: number; expiresAt: string }
  | { kind: 'attention'; key: string; title: string; body: string };   // breaker suspended, an expiry passed, a conflicting lease

/** The decision kinds, as a TOTAL table over `AdoptionDecision['kind']`. */
const DELEGATION_ADOPTION_DECISION_KINDS: Readonly<Record<AdoptionDecision['kind'], true>> = {
  adopt: true, 'would-adopt': true, audit: true, remind: true, attention: true,
};
/** Every kebab word this file and the lane's adoption step spell, for `mail-routes.test.ts`'s scan of `server/src/coord`: the decision
 *  kinds, the shadow's whys, the breaker's attention key and an audit not yet asked. None is a mail rejection or a run refusal: they ride
 *  the lane's memory, its log lines and the health block. */
export function isDelegationAdoptionKebab(v: string): boolean {
  return Object.hasOwn(DELEGATION_ADOPTION_DECISION_KINDS, v) || (DELEGATION_WOULD_ADOPT_WHYS as readonly string[]).includes(v)
    || v === DELEGATION_ADOPT_BREAKER_KEY || v === 'not-asked';
}

/** Whether the health block carries `adoption` (D-8035's rule, for the adoption step): only when one of its counts is above zero, so a
 *  lane that counted nothing leaves the block's shape exactly as an older server's, and absence says nothing was counted. */
export function delegationAdoptionHealthShown(h: DelegationAdoptionHealth | null): DelegationAdoptionHealth | null {
  return h !== null && Object.entries(h).some(([k, n]) => k !== 'mode' && typeof n === 'number' && n > 0) ? { ...h } : null;
}

/** The clamped `terminalEvidenceAt` an adopt entry carries (D-7968): never before the lease's first observation. The settle counts
 *  from the unclamped `terminalAt`, and the activity row keeps its own `endedAt`. */
export function adoptTerminalEvidenceAt(terminalAt: string, lease: Pick<DelegationLeaseRow, 'firstObservedAt'>): string {
  return parseDelegationInstant(terminalAt) >= parseDelegationInstant(lease.firstObservedAt) ? terminalAt : lease.firstObservedAt;
}

const isAdoptable = (l: DelegationLeaseRow): boolean => (DELEGATION_ADOPTABLE_SOURCES as readonly string[]).includes(l.sourceKind);
const carrierRow = (cp: DelegationCheckpointV1, id: string) => (cp.leaseCarriers ?? []).find((c) => c.leaseId === id);
const order = (a: DelegationLeaseRow, b: DelegationLeaseRow): number =>
  a.creatingJournalSequence - b.creatingJournalSequence || (a.leaseId < b.leaseId ? -1 : a.leaseId > b.leaseId ? 1 : 0);

/** The leases whose carrier the lane reads this pass for adoption: unreleased, adoptable, `ephemeral`, on no conflicting tree, whose
 *  journalled `seen` equals their generation (rules 1 to 3; any other waits or leaves without a read). */
export function adoptionCarrierReads(checkpoint: DelegationCheckpointV1, conflicting: ReadonlySet<string>): string[] {
  return [...checkpoint.leases].sort(order).filter((l) => l.releasedAt === null && isAdoptable(l)
    && delegationCarrierStateOf(l, carrierRow(checkpoint, l.leaseId)) === 'ephemeral'
    && !conflicting.has(delegationTreeKey(l.project, l.adminRecord)) && l.generation > 0 && l.carrierGenerationSeen === l.generation)
    .map((l) => l.leaseId);
}

/** Rule 4's terminal evidence, or null: an `ended` activity with its `endedAt`, or a parent proved dead (registry measured absent,
 *  dead outside its restart window for two passes, or a measured incarnation other than the lease's). `first` is the instant to use
 *  when the evidence is the parent's (the first pass the rule held). */
function terminalOf(cp: DelegationCheckpointV1, lease: DelegationLeaseRow, parent: ParentFact | undefined, first: string): string | null {
  const activity = cp.activities.find((a) => a.activityId === lease.activityId);
  if (activity !== undefined && activity.executionState === 'ended' && activity.endedAt !== null) return activity.endedAt;
  if (parent === undefined || parent.registry === 'unmeasured') return null;
  if (parent.registry === 'absent' || parent.deadSince !== null) return first;
  return parent.incarnation !== null && parent.incarnation !== lease.parentIncarnation ? first : null;
}

/** Whether an audit answer proves the tree changed: an unsupported box, a refusal and an unmeasured fact all count as changed (the
 *  safe direction: the tree is kept); only `changed: false` is unchanged. */
const auditChanged = (a: LeaseAuditAnswer | 'unsupported'): boolean => a === 'unsupported' || !a.ok || a.changed !== false;

/**
 * One pass's adoption decisions (plan "## PR7", rules 1 to 9), oldest lease first, the reminders and the attention items. A lease that
 * fails a rule leaves `ephemeral` as it is and loses its watch entry, unless the rule waits (rules 2, 3, 5 to 8), which keeps it.
 * `raised` in the answer is every attention key that still stands, which the lane keeps for the next pass.
 */
export function decideAdoption(input: AdoptionInput): { decisions: readonly AdoptionDecision[]; watch: Map<string, AdoptWatch>;
  health: DelegationAdoptionHealth; raised: Set<string> } {
  const cp = input.checkpoint, nowMs = parseDelegationInstant(input.now), raisedBefore = input.raised ?? new Set<string>();
  const health: DelegationAdoptionHealth = { mode: 'live', adopted: 0, wouldAdopt: 0, waiting: 0, unchanged: 0, unaudited: 0, conflicting: 0,
    unsupported: 0, uncensused: 0, owed: 0 };
  health.mode = input.breaker === 'suspended' ? 'suspended' : input.breaker === 'unmeasured' || input.marker === 'unmeasured' ? 'unmeasured'
    : input.marker === 'absent' ? 'shadow' : 'live';
  const decisions: AdoptionDecision[] = [], attention: AdoptionDecision[] = [];
  const watch = new Map<string, AdoptWatch>(), raised = new Set<string>();
  const raise = (key: string, title: string, body: string): void => {
    raised.add(key);
    if (!raisedBefore.has(key)) attention.push({ kind: 'attention', key, title, body });
  };
  let audits = DELEGATION_AUDITS_PER_PASS, suspended = false;
  for (const lease of [...cp.leases].sort(order)) {
    if (lease.releasedAt !== null || !isAdoptable(lease)) continue;                                   // rule 1 (D-6999)
    const id = lease.leaseId, key = delegationTreeKey(lease.project, lease.adminRecord), prior = input.watch.get(id);
    const keep = (): void => { if (prior !== undefined) watch.set(id, prior); };
    if (delegationCarrierStateOf(lease, carrierRow(cp, id)) !== 'ephemeral') continue;               // rule 2
    if (input.conflicting.has(key)) {                                                                 // rule 2: waits for the operator
      keep();
      health.conflicting += 1;
      raise(`conflicting:${id}:${lease.generation}`, `worktree on a conflicting tree: ${lease.project}/${lease.adminRecord}`,
        `Lease ${id} (generation ${lease.generation}) sits on a tree whose evidence disagrees; it is not kept automatically until you resolve it.`);
      continue;
    }
    const rb = input.carriers.get(id);                                                                // rule 3
    if (rb === undefined || rb.kind !== 'carrier' || rb.body.generation !== lease.generation || lease.carrierGenerationSeen !== lease.generation) {
      keep();
      health.waiting += 1;
      continue;
    }
    if (!input.boxHolds) { keep(); health.unsupported += 1; continue; }
    const same = prior !== undefined && prior.generation === lease.generation ? prior : undefined;   // rule 4 (W5-D9: a new generation resets)
    const terminalAt = terminalOf(cp, lease, input.parents.get(lease.parentId), same?.terminalAt ?? input.now);
    if (terminalAt === null) continue;
    const seen: AdoptWatch = { generation: lease.generation, terminalAt, passes: (same?.passes ?? 0) + 1 };
    watch.set(id, seen);
    if (nowMs - parseDelegationInstant(terminalAt) < DELEGATION_ADOPT_SETTLE_MS                       // rule 5
        || (same?.passes ?? 0) < DELEGATION_ADOPT_STABLE_PASSES) { health.waiting += 1; continue; }
    if (!input.censused.has(lease.project)) { health.uncensused += 1; continue; }                    // rule 6 (D-7852): waits
    if (!input.treePresent.has(key)) { watch.delete(id); continue; }
    const audit = input.audits.get(id);                                                               // rule 7
    if (audit === undefined || audit === 'not-asked') {
      if (audits > 0) { audits -= 1; decisions.push({ kind: 'audit', leaseId: id, generation: lease.generation }); } else health.unaudited += 1;
      continue;
    }
    if (!auditChanged(audit)) { health.unchanged += 1; watch.delete(id); continue; }
    if (input.breaker !== 'clear') { suspended ||= input.breaker === 'suspended'; health.waiting += 1; continue; }   // rule 8
    if (input.marker === 'present') {                                                                 // rule 9
      health.adopted += 1;
      decisions.push({ kind: 'adopt', leaseId: id, expectGeneration: lease.generation, terminalAt,
        expiresAt: formatDelegationInstant(nowMs + DELEGATION_LEASE_EXPIRY_MS) });
    } else {
      health.wouldAdopt += 1;
      decisions.push({ kind: 'would-adopt', leaseId: id, why: input.marker === 'absent' ? 'marker-absent' : 'marker-unmeasured' });
    }
  }
  if (input.breaker === 'suspended') {
    raise(DELEGATION_ADOPT_BREAKER_KEY, 'delegation adoption suspended', `Adoption is suspended: ${suspended ? 'a changed worktree waits' : 'nothing waits yet'}, `
      + 'because several delegated parents died at once or the registry did not read. It resumes when the breaker clears.');
  }
  for (const lease of [...cp.leases].sort(order)) {                                                   // the reminder and a passed expiry
    if (lease.releasedAt !== null || lease.cleanupDueAt === null) continue;
    const state = delegationCarrierStateOf(lease, carrierRow(cp, lease.leaseId));
    if (state !== 'adopted' && state !== 'retained') continue;
    const due = parseDelegationInstant(lease.cleanupDueAt);
    if (nowMs < due && due - nowMs <= DELEGATION_REMINDER_LEAD_MS) {
      decisions.push({ kind: 'remind', leaseId: lease.leaseId, generation: lease.generation, expiresAt: lease.cleanupDueAt });
    }
    if (nowMs > due + DELEGATION_ORPHAN_HOLD_MARGIN_MS) {
      raise(`expired:${lease.leaseId}:${lease.generation}`, `worktree no longer held back: ${lease.project}/${lease.adminRecord}`,
        `Lease ${lease.leaseId} was kept until ${utc(lease.cleanupDueAt)}. The worktree is no longer held back from the disk sweep.`);
    }
  }
  return { decisions: [...decisions, ...attention], watch, health, raised };
}

/** One owed notice's facts. */
export interface LeaseDigestItem { leaseId: string; generation: number; canonicalPath: string; parentId: string; expiresAt: string }
/** The doors the notice names: Retain always; promotion once PR9 sets it. */
export interface LeaseDigestDoors { retain: true; promote: boolean }

/**
 * The notices owed, from durable state only (D-7812): every unreleased lease whose carrier state is `adopted` (its `adoptedAt` set), at
 * its current generation, with a recipient. A lease is adopted only from `ephemeral`, so the generation an adopted lease stands at is
 * its adoption's; a promotion that is refused back to `adopted` lands two generations later and is owed a notice of its own (review
 * 1462 M3). Never built from this pass's decisions: the caller asks `hasMailWithSubject` inside `queueRunlessNotice`'s transaction.
 */
export function owedLeaseNotices(checkpoint: DelegationCheckpointV1, recipientOf: (l: DelegationLeaseRow) => string | null):
  readonly { recipient: string; item: LeaseDigestItem }[] {
  const out: { recipient: string; item: LeaseDigestItem }[] = [];
  for (const lease of [...checkpoint.leases].sort(order)) {
    if (lease.releasedAt !== null || lease.adoptedAt === null || lease.cleanupDueAt === null) continue;
    if (delegationCarrierStateOf(lease, carrierRow(checkpoint, lease.leaseId)) !== 'adopted') continue;
    const recipient = recipientOf(lease);
    if (recipient === null) continue;
    out.push({ recipient, item: { leaseId: lease.leaseId, generation: lease.generation, canonicalPath: lease.canonicalPath,
      parentId: lease.parentId, expiresAt: lease.cleanupDueAt } });
  }
  return out;
}

const utc = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
/** The closing sentence of the digest and the reminder, under O5-1 (a). */
export const DELEGATION_HOLD_CLOSING = 'After that date the worktree is no longer held back from the disk sweep, which never removes '
  + 'uncommitted work, and removes a worktree with unpushed commits only after saving them to a rescue ref.';
const retainLine = (leaseId: string): string =>
  `~/.local/bin/ccrc-api leases retain ${leaseId} --json '{"byId":"<your id>","byUuid":"<your uuid>"}'`;

/** One adoption's notice (D-7813): one per adopted lease and generation, its subject naming both and never a pass. */
export function buildLeaseDigest(recipient: string, item: LeaseDigestItem, doors: LeaseDigestDoors): { subject: string; body: string } {
  void doors.promote;                                                 // PR9 adds the promote line
  return {
    subject: `delegation: worktree kept for ${recipient} (${item.leaseId}, generation ${item.generation})`,
    body: [
      `A worktree that delegated work by ${item.parentId} left changed is kept: ${item.canonicalPath}`,
      `It is kept until ${utc(item.expiresAt)}.`,
      `To keep it for another 7 days: ${retainLine(item.leaseId)}`,
      DELEGATION_HOLD_CLOSING,
    ].join('\n'),
  };
}

/** The reminder a kept lease is owed once, `DELEGATION_REMINDER_LEAD_MS` before its hold ends, per lease and generation. */
export function buildLeaseReminder(item: LeaseDigestItem, doors: LeaseDigestDoors): { subject: string; body: string } {
  void doors.promote;
  return {
    subject: `delegation: worktree hold ends soon (${item.leaseId}, generation ${item.generation})`,
    body: [
      `The worktree ${item.canonicalPath} is kept until ${utc(item.expiresAt)}.`,
      `To keep it for another 7 days: ${retainLine(item.leaseId)}`,
      DELEGATION_HOLD_CLOSING,
    ].join('\n'),
  };
}

/** `ws-lease-audit`'s one JSON line, read: the box's answer, or a refusal; anything outside the verb's grammar is `unmeasured`, which
 *  counts as changed (rule 7). */
export function parseLeaseAuditAnswer(stdout: string): LeaseAuditAnswer {
  const line = stdout.trim().split('\n').pop() ?? '';
  const no = (detail: string): LeaseAuditAnswer => ({ ok: false, refusal: 'unmeasured', detail });
  let doc: unknown;
  try { doc = JSON.parse(line); } catch { return no('the audit answered no JSON line'); }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return no('the audit answered no object');
  const o = doc as Record<string, unknown>;
  if (o.ok === false) {
    return (LEASE_AUDIT_REFUSALS as readonly unknown[]).includes(o.refusal)
      ? { ok: false, refusal: o.refusal as LeaseAuditRefusal, detail: typeof o.detail === 'string' ? o.detail : '' }
      : no('the audit refused outside its grammar');
  }
  if (o.ok !== true || !(o.changed === true || o.changed === false || o.changed === 'unmeasured')) return no('the audit answered outside its grammar');
  return o as unknown as LeaseAuditAnswer;
}
