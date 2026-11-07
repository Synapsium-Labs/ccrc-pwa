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
import type { DelegationAdoptionHealth, DelegationLeaseSourceKind, LeaseAuditAnswer, LeaseAuditRefusal, Presence } from '../../../shared/api.js';
import { LEASE_AUDIT_REFUSALS } from '../../../shared/api.js';
import { delegationTreeKey } from './delegation-correlation.js';
import { parseDelegationInstant, formatDelegationInstant, type DelegationCheckpointV1, type DelegationLeaseRow } from './delegation-model.js';
import { DELEGATION_LEASE_EXPIRY_MS, delegationCarrierStateOf } from './delegation-lease-state.js';
import { carrierReadBackVersus, leastRecentlyRead, type CarrierReadBack } from './delegation-carrier.js';
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
/** Review 1587 F3 (D-8057 amended): a definite audit answer is held for its lease's generation for at most this long, then asked again. */
export const DELEGATION_AUDIT_HOLD_MS = 60 * 60_000;
/** Review 1587 F7: at most this many carriers the adoption step reads a pass, as PR6 bounds its own re-reads; the rest wait a pass. */
export const DELEGATION_ADOPT_CARRIER_READS_PER_PASS = 8;
/** The lease sources this lane adopts (rule 1). A `raw` lease is attached by the operator (D-6999); `attached` is the operator's already. */
export const DELEGATION_ADOPTABLE_SOURCES = ['agent', 'workflow'] as const satisfies readonly DelegationLeaseSourceKind[];

/** What the lane measured of a lease's parent this pass: its registry row, the incarnation it reads, since when a supervisor has been
 *  measured dead outside its restart window for two passes (the lane's `firstDead`, read only while this pass's `presence` is `dead`,
 *  review 1609 F1), whether it is a ccd session (a registry row), whether this pass measured it alive or dead from its row's `presence`
 *  (`alive` and `dead`; `null` for `unknown`, `asleep`, no `presence`, or a session the pass does not name: its liveness is unmeasured),
 *  whether the lane retracted a death it had counted for it (a stop or archive stamp dated at or before it, review 1604 F7), and the
 *  last pass the lane measured it alive, with the incarnation the census read then (review 1609 F5; `null` incarnation: unread).
 *  `unmeasured`, a null incarnation and a null `alive` are never evidence. */
export interface ParentFact {
  registry: 'present' | 'absent' | 'unmeasured'; incarnation: string | null; deadSince: string | null; ccd: boolean; alive: boolean | null;
  deathRetracted: boolean; lastAlive: { at: string; incarnation: string | null } | null;
}

/** The reads one pass of the lane makes of the parents (review 1587 A7: the step passes them, this file classifies them). */
export interface AdoptionParentReads {
  now: string;
  /** Whether the registry listed this pass. */
  registryListed: boolean;
  /** Every id the registry's listing named, built or not (`RegistryRead.listedIds`); null before a listing. */
  listedIds: ReadonlySet<string> | null;
  /** The ids whose row the registry assembled this pass (the pass's records). */
  built: ReadonlySet<string>;
  /** The sessions this pass measured, with their row's `presence` (review 1609 F1); a session they do not name is unmeasured. */
  sessions: readonly { readonly id: string; readonly presence?: Presence | undefined }[];
  /** The parents whose counted death the lane retracted (review 1604 F7), until they are alive again, die again or are measured absent
   *  from the registry's listing (review 1609 F2). */
  retracted: ReadonlySet<string>;
  /** The lane's last-alive instants (epoch ms) and the incarnation the census read on that pass (review 1609 F5). */
  lastAlive: ReadonlyMap<string, { readonly at: number; readonly incarnation: string | null }>;
  /** The census's settled incarnations. */
  incarnations: ReadonlyMap<string, { readonly kind: 'measured'; readonly incarnation: string } | { readonly kind: 'unmeasured' }>;
  /** The lane's first-dead instants (epoch ms), as the breaker reads them. */
  firstDead: ReadonlyMap<string, number>;
}

/** Each lease parent's facts this pass (review 1587 A7, F1). A row the registry assembled is present. A row its listing named that it
 *  could not assemble (a uuid, wrapper or workdir that read back empty, or raced a removal) is unmeasured, never absent; only an id the
 *  listing did not name is absent, and no listing is unmeasured. Liveness is the row's `presence` (review 1609 F1, as the projection's
 *  `livenessOf` reads a row): `alive` is alive, `dead` is dead, and `unknown` (tmux did not answer, D-309) and `asleep` (a hibernated
 *  parent: a deliberate stop, not a death) are unmeasured. `deadSince` is the lane's first-dead instant once a later pass reads it, and
 *  only while the parent is measured `dead`: the lane's first-dead memory reads `status`, which is `dead` for every pane tmux did not
 *  call live, and stays so because the breaker reads it in the fail-shut direction (D-8092). */
export function adoptionParentFacts(checkpoint: DelegationCheckpointV1, reads: AdoptionParentReads): Map<string, ParentFact> {
  const nowMs = parseDelegationInstant(reads.now), out = new Map<string, ParentFact>();
  const presence = new Map(reads.sessions.map((x) => [x.id, x.presence] as const));
  for (const { parentId } of checkpoint.leases) {
    if (out.has(parentId)) continue;
    const registry = !reads.registryListed || reads.listedIds === null ? 'unmeasured'
      : reads.built.has(parentId) ? 'present' : reads.listedIds.has(parentId) ? 'unmeasured' : 'absent';
    const inc = reads.incarnations.get(parentId), dead = reads.firstDead.get(parentId), word = presence.get(parentId);
    const alive = word === 'alive' ? true : word === 'dead' ? false : null, seen = reads.lastAlive.get(parentId);
    out.set(parentId, { registry, incarnation: inc?.kind === 'measured' ? inc.incarnation : null,
      deadSince: alive === false && dead !== undefined && dead < nowMs ? formatDelegationInstant(dead) : null, ccd: registry === 'present',
      alive, deathRetracted: reads.retracted.has(parentId),
      lastAlive: seen === undefined ? null : { at: formatDelegationInstant(seen.at), incarnation: seen.incarnation } });
  }
  return out;
}

/** Who is owed a lease's notices (O5-4 (a)), three answers never folded together (review 1587 F6, A2): `mail` to the coordinator the
 *  caller's `leaseCoordinatorOf(lease, runs)` names, else to the parent itself while its measured incarnation is the lease's;
 *  `record-only` when there is no one to mail (the feed row and the operator's Keep control on the row: a parent measured absent, or a
 *  re-created parent row, which is never mailed a Retain line it cannot use, W5-R2, D-7813); `unmeasured` when the parent's row or
 *  incarnation did not read, which holds the notice. */
export type LeaseRecipient = { kind: 'mail'; to: string } | { kind: 'record-only' } | { kind: 'unmeasured' };
export function leaseRecipient(lease: Pick<DelegationLeaseRow, 'parentId' | 'parentIncarnation'>, parent: ParentFact | undefined,
  coordinator: string | null): LeaseRecipient {
  if (coordinator !== null) return { kind: 'mail', to: coordinator };
  if (parent === undefined || parent.registry === 'unmeasured') return { kind: 'unmeasured' };
  if (parent.registry === 'absent' || !parent.ccd) return { kind: 'record-only' };
  if (parent.incarnation === null) return { kind: 'unmeasured' };
  return parent.incarnation === lease.parentIncarnation ? { kind: 'mail', to: lease.parentId } : { kind: 'record-only' };
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
  /** The trees whose census record read `unreadable` (review 1604 F6): unmeasured, never absent. Absent: none. */
  treeUnread?: ReadonlySet<string>;
  /** The projects whose census this pass is a measured success (D-7852). */
  censused: ReadonlySet<string>;
  /** The audit answers the lane is fed this pass (`adoptionAudits`), by lease id. Absent or `'not-asked'`: not measured yet. */
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

/** Whether a lease is one adoption may still act on at its generation: unreleased, adoptable and `ephemeral`. */
const candidate = (cp: DelegationCheckpointV1, l: DelegationLeaseRow): boolean =>
  l.releasedAt === null && isAdoptable(l) && delegationCarrierStateOf(l, carrierRow(cp, l.leaseId)) === 'ephemeral';

/** The leases whose carrier the lane reads this pass, just before its act or its shadow line (review 1587 F7): those at a generation
 *  above 0 that pass rules 1, 2, rule 3's journalled `seen` and rules 4 to 6 this pass, at most `DELEGATION_ADOPT_CARRIER_READS_PER_PASS`.
 *  They rotate as PR6's re-reads do (`delegation-carrier.ts#leastRecentlyRead`, D-8034's order; review 1604 F2): never read first, then the oldest read, by the
 *  lane pass `lastRead` names, and oldest lease first among equals, so every candidate is read within a few passes. The read stays at
 *  decision time (D-8034, 1546 F1); a lease over the bound waits a pass. */
export function adoptionCarrierReads(input: Omit<AdoptionInput, 'carriers'>, lastRead: ReadonlyMap<string, number>): string[] {
  const reads: string[] = [];
  walkAdoption(input, null, reads);
  return leastRecentlyRead(reads, lastRead, DELEGATION_ADOPT_CARRIER_READS_PER_PASS);   // PR6's comparator, shared (review 1609 F10)
}

/** An audit answer held between passes: the generation it measured, and when it was read. */
export interface HeldLeaseAudit { generation: number; answer: LeaseAuditAnswer; at: string }
const definite = (a: LeaseAuditAnswer): boolean => a.ok && typeof a.changed === 'boolean';
/**
 * The audit answers the decider is fed this pass, and the answers held for the next (review 1587 F3, A8; D-8057 amended). Fed: `unsupported`
 * on a box without `lease-audit-v1`; else this pass's own answer at the lease's generation, whatever it says (rule 7 counts one that is not
 * definite as changed); else a held answer at that generation read within `DELEGATION_AUDIT_HOLD_MS`. Held: only a definite answer
 * (`changed: true` or `false`), for a lease still a candidate at that generation, within the bound; an unmeasured, refused or unsupported
 * answer is never held, so it is asked again on a later pass within the audit budget.
 */
export function adoptionAudits(input: { now: string; checkpoint: DelegationCheckpointV1; auditable: boolean;
  held: ReadonlyMap<string, HeldLeaseAudit>; fresh: ReadonlyMap<string, HeldLeaseAudit> }):
  { audits: Map<string, LeaseAuditAnswer | 'unsupported'>; held: Map<string, HeldLeaseAudit> } {
  const nowMs = parseDelegationInstant(input.now), cp = input.checkpoint;
  const audits = new Map<string, LeaseAuditAnswer | 'unsupported'>(), held = new Map<string, HeldLeaseAudit>();
  const young = (h: HeldLeaseAudit | undefined, l: DelegationLeaseRow): h is HeldLeaseAudit =>
    h !== undefined && h.generation === l.generation && nowMs - parseDelegationInstant(h.at) >= 0                     // F8: a clock step back
      && nowMs - parseDelegationInstant(h.at) <= DELEGATION_AUDIT_HOLD_MS;
  for (const l of cp.leases) {
    if (!input.auditable) { audits.set(l.leaseId, 'unsupported'); continue; }
    const fresh = input.fresh.get(l.leaseId), before = input.held.get(l.leaseId);
    const now = young(fresh, l) ? fresh : young(before, l) && definite(before.answer) ? before : undefined;
    if (now === undefined) continue;
    audits.set(l.leaseId, now.answer);
    if (definite(now.answer) && candidate(cp, l)) held.set(l.leaseId, now);
  }
  return { audits, held };
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

/** Review 1587 F2 and 1604 F5, F7 (D-8058): the counter-evidence that drops a parent's death the lane already saw: the parent measured
 *  alive this pass at the lease's incarnation (its row present), or the lane's retraction of the death it had counted (a deliberate stop
 *  first read as a crash). The retraction drops it whatever the incarnation the census reads now: a delay only, since a later death
 *  starts a watch of its own (review 1609 F7). An ended activity never needs keeping (it is in the journal), so it is never disproved
 *  here. Asked at every rule that keeps a watch entry. */
const deathDisproved = (cp: DelegationCheckpointV1, lease: DelegationLeaseRow, parent: ParentFact | undefined): boolean =>
  !activityEnded(cp, lease) && parent !== undefined
  && ((parent.registry === 'present' && parent.alive === true && parent.incarnation === lease.parentIncarnation) || parent.deathRetracted);
/** Review 1609 F5: a watch entry the parent outlived. The lane measured the parent alive after the entry's `terminalAt`, at the lease's
 *  incarnation or at one the census did not read, on a pass the decider may not have seen (the step runs only on a newer census), so
 *  the death it rests on ended and the entry is gone: a later death starts its own settle and passes. An ended activity's instant is
 *  never outlived (the parent lives on after its agent). */
const outlived = (cp: DelegationCheckpointV1, lease: DelegationLeaseRow, parent: ParentFact | undefined, w: AdoptWatch): boolean => {
  const seen = parent?.lastAlive ?? null;
  return seen !== null && !activityEnded(cp, lease) && (seen.incarnation === null || seen.incarnation === lease.parentIncarnation)
    && parseDelegationInstant(seen.at) > parseDelegationInstant(w.terminalAt);
};
const activityEnded = (cp: DelegationCheckpointV1, lease: DelegationLeaseRow): boolean => {
  const activity = cp.activities.find((a) => a.activityId === lease.activityId);
  return activity !== undefined && activity.executionState === 'ended' && activity.endedAt !== null;
};
/** Review 1604 F1: whether this pass MEASURED the parent: its row present with an incarnation read and its liveness read. A kept death
 *  moves only on a measured read; any other read holds the lease's entry as it was. */
const parentMeasured = (parent: ParentFact | undefined): boolean =>
  parent !== undefined && parent.registry === 'present' && parent.incarnation !== null && parent.alive !== null;

/** Whether an audit answer proves the tree changed: an unsupported box, a refusal and an unmeasured fact all count as changed (the
 *  safe direction: the tree is kept); only `changed: false` is unchanged. */
const auditChanged = (a: LeaseAuditAnswer | 'unsupported'): boolean => a === 'unsupported' || !a.ok || a.changed !== false;

/**
 * One pass's adoption decisions (plan "## PR7", rules 1 to 9), oldest lease first, the reminders and the attention items. A lease that
 * fails a rule leaves `ephemeral` as it is and loses its watch entry, unless the rule waits (rules 2, 3, 5 to 8), which keeps it. The
 * departures are D-8058's: a parent's death the lane already saw stays evidence, moves only on a measured read of the parent, and is
 * dropped when the parent is alive again at the lease's incarnation or the lane retracts the death (reviews 1587 F2, 1604 F1, F5, F7);
 * an unreadable census record and a definite `changed: false` keep the entry (1604 F6); rule 3's read-back is checked after rule 6,
 * because the lane reads a carrier only for a lease past rules 4 to 6 (1587 F7, `adoptionCarrierReads`); and an entry the parent
 * outlived is gone (1609 F5). Rule 3's read-back must equal the lease as PR6 compares it, not only its generation (1609 F8, D-8093).
 * `raised` in the answer is every attention key that still stands, which the lane keeps for the next pass.
 */
export function decideAdoption(input: AdoptionInput): { decisions: readonly AdoptionDecision[]; watch: Map<string, AdoptWatch>;
  health: DelegationAdoptionHealth; raised: Set<string> } {
  return walkAdoption(input, input.carriers, null);
}

/** The rules' one walk. Fed `carriers: null` it plans the pass's carrier reads instead (`reads`): a lease that reaches the read-back
 *  check is named there and goes no further. */
function walkAdoption(input: Omit<AdoptionInput, 'carriers'>, carriers: ReadonlyMap<string, CarrierReadBack> | null, reads: string[] | null):
  { decisions: readonly AdoptionDecision[]; watch: Map<string, AdoptWatch>; health: DelegationAdoptionHealth; raised: Set<string> } {
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
    const id = lease.leaseId, key = delegationTreeKey(lease.project, lease.adminRecord), parent = input.parents.get(lease.parentId);
    const watched = input.watch.get(id), prior = watched !== undefined && outlived(cp, lease, parent, watched) ? undefined : watched;   // 1609 F5
    const keep = (): void => { if (prior !== undefined && !deathDisproved(cp, lease, parent)) watch.set(id, prior); };   // 1604 F5, F7
    if (delegationCarrierStateOf(lease, carrierRow(cp, id)) !== 'ephemeral') continue;               // rule 2
    if (input.conflicting.has(key)) {                                                                 // rule 2: waits for the operator
      keep();
      health.conflicting += 1;
      raise(`conflicting:${id}:${lease.generation}`, `worktree on a conflicting tree: ${lease.project}/${lease.adminRecord}`,
        `Lease ${id} (generation ${lease.generation}) sits on a tree whose evidence disagrees; it is not kept automatically until you resolve it.`);
      continue;
    }
    if (lease.carrierGenerationSeen !== lease.generation) { keep(); health.waiting += 1; continue; }  // rule 3, journalled (read: below)
    if (!input.boxHolds) { keep(); health.unsupported += 1; continue; }
    const same = prior !== undefined && prior.generation === lease.generation ? prior : undefined;   // rule 4 (W5-D9: a new generation resets)
    let terminalAt = terminalOf(cp, lease, parent, same?.terminalAt ?? input.now);
    if (terminalAt === null && same !== undefined && !deathDisproved(cp, lease, parent)) {           // F2: a death seen is kept (D-8058)
      if (!parentMeasured(parent)) { watch.set(id, same); health.waiting += 1; continue; }         // 1604 F1: an unmeasured read holds
      terminalAt = same.terminalAt;                                                                   // measured dead: counts the pass
    }
    if (terminalAt === null) continue;
    const seen: AdoptWatch = { generation: lease.generation, terminalAt, passes: (same?.passes ?? 0) + 1 };
    watch.set(id, seen);
    if (nowMs - parseDelegationInstant(terminalAt) < DELEGATION_ADOPT_SETTLE_MS                       // rule 5
        || (same?.passes ?? 0) < DELEGATION_ADOPT_STABLE_PASSES) { health.waiting += 1; continue; }
    if (!input.censused.has(lease.project)) { health.uncensused += 1; continue; }                    // rule 6 (D-7852): waits
    if (!input.treePresent.has(key)) {
      if (input.treeUnread?.has(key) === true && same !== undefined) { watch.set(id, same); health.waiting += 1; } else watch.delete(id);   // 1604 F6
      continue;
    }
    if (carriers === null) { if (lease.generation > 0) reads?.push(id); continue; }                  // rule 3's read (F7): planning only
    const rb = carriers.get(id);                                                                      // 1609 F8 (D-8093): PR6's equality
    if (rb === undefined || rb.kind !== 'carrier' || carrierReadBackVersus(lease, carrierRow(cp, id), rb.body) !== 'equal') {   // unread, over the bound, behind or foreign
      if (prior !== undefined) watch.set(id, prior); else watch.delete(id);
      health.waiting += 1;
      continue;
    }
    const audit = input.audits.get(id);                                                               // rule 7
    if (audit === undefined || audit === 'not-asked') {
      if (audits > 0) { audits -= 1; decisions.push({ kind: 'audit', leaseId: id, generation: lease.generation }); } else health.unaudited += 1;
      continue;
    }
    if (!auditChanged(audit)) { health.unchanged += 1; continue; }                                    // 1604 F6: kept, asked again after the hold
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

/** One owed notice's facts. `audit` is what the adoption's audit showed (`adoptAuditWord`), when the lane still remembers it: absent after a
 *  restart, since the checkpoint does not record it (the floor rule), and then the notice claims neither (review 1609 F9). */
export interface LeaseDigestItem { leaseId: string; generation: number; canonicalPath: string; parentId: string; expiresAt: string; audit?: AdoptAuditWord }

/** Review 1609 F9: what an adoption's audit showed, for its words. `changed` only when the audit answered `changed: true`; `unchecked`
 *  when rule 7 counted an answer that was not definite as changed (an unsupported box, a refusal, `changed: 'unmeasured'`, or none). */
export type AdoptAuditWord = 'changed' | 'unchecked';
export function adoptAuditWord(audit: LeaseAuditAnswer | 'unsupported' | undefined): AdoptAuditWord {
  return audit !== undefined && audit !== 'unsupported' && audit.ok && audit.changed === true ? 'changed' : 'unchecked';
}
/** The feed row an applied adoption writes (record-only), in the words its audit earned (review 1609 F9). */
export function buildAdoptionFeedRow(lease: Pick<DelegationLeaseRow, 'leaseId' | 'project' | 'adminRecord'>, expiresAt: string,
  audit: AdoptAuditWord): { title: string; body: string } {
  return {
    title: `worktree kept: ${lease.project}/${lease.adminRecord}`,
    body: audit === 'changed' ? `Delegated work left this worktree changed; it is kept until ${expiresAt} (lease ${lease.leaseId}).`
      : `This delegated worktree is kept because its changes could not be checked, until ${expiresAt} (lease ${lease.leaseId}).`,
  };
}
/** The doors the notice names: Retain always; promotion once PR9 sets it. */
export interface LeaseDigestDoors { retain: true; promote: boolean }

/**
 * The notices owed, from durable state only (D-7812): every unreleased lease whose carrier state is `adopted` (its `adoptedAt` set), at
 * its current generation, before its hold ends (review 1587 F5: no dated notice after its date; the `expired:` attention item covers the
 * lease), with a recipient to mail or one unmeasured (which holds the notice; `record-only` is owed no mail). A lease is adopted only from `ephemeral`, so the generation an adopted lease stands at is
 * its adoption's; a promotion that is refused back to `adopted` lands two generations later and is owed a notice of its own (review
 * 1462 M3). Never built from this pass's decisions: the caller asks `hasMailWithSubject` inside `queueRunlessNotice`'s transaction.
 */
export function owedLeaseNotices(checkpoint: DelegationCheckpointV1, now: string, recipientOf: (l: DelegationLeaseRow) => LeaseRecipient):
  readonly { recipient: Exclude<LeaseRecipient, { kind: 'record-only' }>; item: LeaseDigestItem }[] {
  const out: { recipient: Exclude<LeaseRecipient, { kind: 'record-only' }>; item: LeaseDigestItem }[] = [];
  const nowMs = parseDelegationInstant(now);
  for (const lease of [...checkpoint.leases].sort(order)) {
    if (lease.releasedAt !== null || lease.adoptedAt === null || lease.cleanupDueAt === null) continue;
    if (parseDelegationInstant(lease.cleanupDueAt) <= nowMs) continue;          // F5: no dated notice after its date (`expired:` covers it)
    if (delegationCarrierStateOf(lease, carrierRow(checkpoint, lease.leaseId)) !== 'adopted') continue;
    const recipient = recipientOf(lease);
    if (recipient.kind === 'record-only') continue;
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
      item.audit === 'changed' ? `A worktree that delegated work by ${item.parentId} left changed is kept: ${item.canonicalPath}`
        : item.audit === 'unchecked' ? `A worktree of delegated work by ${item.parentId} is kept because its changes could not be checked: ${item.canonicalPath}`
          : `A worktree of delegated work by ${item.parentId} is kept: ${item.canonicalPath}`,
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
