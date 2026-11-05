// Delegation broker wave 5, PR5a (Task 5.5.1): the ONE lease transition table, the carrier-state derivation and the one
// decision every lease transition and release goes through.
//
// This file is L1: pure, no I/O, no clock (it is fed every instant). The live doors (PR5b's `transitionLease`, `releaseLease`)
// and the journal replay fold (`DelegationCheckpointBuilder`) both call `decideLeaseTransition` / `decideLeaseRelease`, so a
// journalled transition and a live one can never mean two different things (spec §5.12, plan "## PR5"). The fold passes
// `carrierRequired: false`: the journal already holds the decision, and the carrier's catch-up is not replay's to wait for.
//
// `foldLeaseTransition`, `foldLeaseRelease` and `foldLeaseCarrierSeen` turn one applied journal entry into the rows it writes.
// They never write a cleanup state or a cleanup clock (wave 5 has no cleaner, D-7002), never write `unknown`, never close an
// activity, and change nothing a lease does not own.
import type { DelegationCarrierState, DelegationLeaseReleaseReason } from '../../../shared/api.js';
import type {
  DelegationAttemptMark,
  DelegationJournalEntryV1,
  DelegationLeaseCarrierRow,
  DelegationLeaseRow,
  DelegationLineageRow,
} from './delegation-model.js';

// ── The vocabularies (one definition each; `single-definition/vocabularies.test.ts` W5-V3) ───────────────────────────────

export const DELEGATION_LEASE_TRANSITION_REASONS = ['carrier', 'adopt', 'retain', 'operator-retain', 'attach', 'transfer',
  'transfer-refused', 'transfer-recovered', 'promote'] as const;
export type DelegationLeaseTransitionReason = (typeof DELEGATION_LEASE_TRANSITION_REASONS)[number];

export const DELEGATION_LINEAGE_CLOSE_REASONS = ['native-removed', 'transferred', 'foreign', 'transfer'] as const;
export type DelegationLineageCloseReason = (typeof DELEGATION_LINEAGE_CLOSE_REASONS)[number];

export const DELEGATION_LEASE_ACT_REFUSALS = ['lease-unknown', 'lease-released', 'stale-generation', 'wrong-disposition',
  'not-ready', 'carrier-behind'] as const;
export type DelegationLeaseActRefusal = (typeof DELEGATION_LEASE_ACT_REFUSALS)[number];

/** The reasons that start a new step from a settled state, and so refuse `carrier-behind` while the box's carrier has not caught
 *  up (`carrierGenerationSeen < generation`) on a box that reports the carrier-mark capability (D-7806). `carrier` mints the first carrier, and
 *  `transfer-refused`, `transfer-recovered` and `promote` finish a transfer whose marks PR9 drives synchronously. */
export const DELEGATION_CARRIER_GATED_REASONS = ['adopt', 'retain', 'operator-retain', 'attach', 'transfer'] as const satisfies
  readonly DelegationLeaseTransitionReason[];

/** A3, approved with the plan: an adopted or retained tree is held back from the orphan lane for 7 days from its last keep. */
export const DELEGATION_LEASE_EXPIRY_MS = 7 * 86_400_000;

const SETTLED = ['ephemeral', 'adopted', 'retained'] as const satisfies readonly DelegationCarrierState[];

/** One row per reason: the states it may start from, and where it goes (`prior` = the lease's own disposition). Total over
 *  `DelegationLeaseTransitionReason`, so a reason added to the list is a compile error here until it has a row. */
export const DELEGATION_LEASE_TRANSITIONS: Readonly<Record<DelegationLeaseTransitionReason,
  { from: readonly DelegationCarrierState[]; to: DelegationCarrierState | 'prior' }>> = {
  carrier: { from: ['ephemeral'], to: 'ephemeral' },                 // and only at generation 0 (D-7830)
  adopt: { from: ['ephemeral'], to: 'adopted' },
  retain: { from: SETTLED, to: 'retained' },
  'operator-retain': { from: SETTLED, to: 'retained' },
  attach: { from: SETTLED, to: 'retained' },
  transfer: { from: SETTLED, to: 'transferring' },
  'transfer-refused': { from: ['transferring'], to: 'prior' },
  'transfer-recovered': { from: ['transferring'], to: 'prior' },
  promote: { from: ['transferring'], to: 'promoted' },
};

/** A fold's own refusal, beside the decision's: an entry the decision allows whose fields contradict it (a wrong target, a missing
 *  expiry or run, terminal evidence out of place). Replay only: no door answers it, since a door builds the entry from its decision. */
export const DELEGATION_LEASE_BAD_ENTRY = 'bad-entry';

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`: the three lists (the reasons, the
 *  lineage close reasons and the act refusals) and, beyond them, the fold's one refusal `bad-entry`. */
export function isDelegationLeaseStateKebab(v: string): boolean {
  return v === DELEGATION_LEASE_BAD_ENTRY || (DELEGATION_LEASE_TRANSITION_REASONS as readonly string[]).includes(v)
    || (DELEGATION_LINEAGE_CLOSE_REASONS as readonly string[]).includes(v)
    || (DELEGATION_LEASE_ACT_REFUSALS as readonly string[]).includes(v);
}

// ── The carrier state and the one decision ───────────────────────────────────────────────────────────────────────────

/** A lease's carrier state: `released` once released, `transferring` while its carrier row says so, else its disposition. */
export function delegationCarrierStateOf(lease: DelegationLeaseRow, carrier: DelegationLeaseCarrierRow | undefined): DelegationCarrierState {
  if (lease.releasedAt !== null) return 'released';
  if (carrier !== undefined && carrier.transferringSince !== null) return 'transferring';
  return lease.disposition;
}

export type DelegationLeaseDecision =
  | { ok: true; to: DelegationCarrierState; generation: number }
  | { ok: false; refusal: DelegationLeaseActRefusal; detail: string };

const no = (refusal: DelegationLeaseActRefusal, detail: string): DelegationLeaseDecision => ({ ok: false, refusal, detail });

/** The checks every generation-writing act shares, in order: a known lease, not released, at the generation the caller read. */
function decideCommon(lease: DelegationLeaseRow | undefined, expectGeneration: number, what: string): DelegationLeaseDecision | null {
  if (lease === undefined) return no('lease-unknown', `${what}: no such lease`);
  if (lease.releasedAt !== null) return no('lease-released', `${what}: lease ${lease.leaseId} was released at ${lease.releasedAt}`);
  if (expectGeneration !== lease.generation) {
    return no('stale-generation', `${what}: lease ${lease.leaseId} is at generation ${lease.generation}, not ${expectGeneration}`);
  }
  return null;
}

/**
 * Whether `req.reason` may move `lease` now, and where to. The ONE decision of a lease transition: the live door passes the
 * capability it measured as `carrierRequired`, the replay fold passes `false`. Refuses, in order: `lease-unknown`,
 * `lease-released`, `stale-generation`, `wrong-disposition` (the table, and `carrier` only at generation 0), then
 * `carrier-behind` for a gated reason while the box's carrier has not been read back at the lease's generation.
 */
export function decideLeaseTransition(lease: DelegationLeaseRow | undefined, carrier: DelegationLeaseCarrierRow | undefined,
  req: { reason: DelegationLeaseTransitionReason; expectGeneration: number; carrierRequired: boolean }): DelegationLeaseDecision {
  const common = decideCommon(lease, req.expectGeneration, req.reason);
  if (common !== null || lease === undefined) return common ?? no('lease-unknown', `${req.reason}: no such lease`);
  const row = DELEGATION_LEASE_TRANSITIONS[req.reason];
  const state = delegationCarrierStateOf(lease, carrier);
  if (!row.from.includes(state)) {
    return no('wrong-disposition', `${req.reason}: lease ${lease.leaseId} is ${state}; ${req.reason} starts only from ${row.from.join(', ')}`);
  }
  if (req.reason === 'carrier' && lease.generation !== 0) {
    return no('wrong-disposition', `carrier: lease ${lease.leaseId} is at generation ${lease.generation}; carrier is only its first transition`);
  }
  if (req.carrierRequired && (DELEGATION_CARRIER_GATED_REASONS as readonly string[]).includes(req.reason)
      && (lease.carrierGenerationSeen === null || lease.carrierGenerationSeen < lease.generation)) {
    return no('carrier-behind',
      `${req.reason}: lease ${lease.leaseId}'s carrier was read back at ${String(lease.carrierGenerationSeen)}, behind generation ${lease.generation}`);
  }
  return { ok: true, to: row.to === 'prior' ? lease.disposition : row.to, generation: lease.generation + 1 };
}

/**
 * PR5b, the live `promote` door's own request check (coordinator ruling on W5-J9c, D-8024): a promotion names the run its transfer named, so the
 * door refuses unless the carrier row exists with a non-null `transferRun` equal to `runId`; the answer is the refusal's detail, or null.
 * It is NOT part of `decideLeaseTransition` and no fold calls it: replay keeps PR5a's looser reading (D-7971), so a stricter writer never
 * makes the floor refuse a journal. PR9's promote door relies on it.
 */
export function promoteRunMismatch(carrier: DelegationLeaseCarrierRow | undefined, runId: number | null): string | null {
  if (carrier === undefined) return 'promote: the lease has no carrier row, so no transfer names a run';
  if (carrier.transferRun === null) return `promote: lease ${carrier.leaseId}'s carrier row names no transfer run`;
  if (carrier.transferRun !== runId) return `promote: lease ${carrier.leaseId} is transferring to run ${carrier.transferRun}, not run ${String(runId)}`;
  return null;
}

/** The release's decision (its own entry kind, the table's last row): any unreleased state but `transferring`. */
export function decideLeaseRelease(lease: DelegationLeaseRow | undefined, carrier: DelegationLeaseCarrierRow | undefined,
  req: { expectGeneration: number }): DelegationLeaseDecision {
  const common = decideCommon(lease, req.expectGeneration, 'release');
  if (common !== null || lease === undefined) return common ?? no('lease-unknown', 'release: no such lease');
  if (delegationCarrierStateOf(lease, carrier) === 'transferring') {
    return no('wrong-disposition', `release: lease ${lease.leaseId} is transferring; a transfer finishes before a release`);
  }
  return { ok: true, to: 'released', generation: lease.generation + 1 };
}

// ── The folds: one applied entry to the rows it writes ───────────────────────────────────────────────────────────────

/** What one lease entry writes: the lease row, its carrier row (`null` when every field is null, so none is kept), and the
 *  lineage rows it changes or opens (by `lineageId`). */
export interface DelegationLeaseFold {
  lease: DelegationLeaseRow;
  carrier: DelegationLeaseCarrierRow | null;
  lineage: readonly DelegationLineageRow[];
}

/** Why a fold refused: the decision's own refusal, or `bad-entry` for an entry the decision allows whose fields contradict it. */
export type DelegationLeaseFoldResult = { ok: true; fold: DelegationLeaseFold }
  | { ok: false; refusal: DelegationLeaseActRefusal | typeof DELEGATION_LEASE_BAD_ENTRY; detail: string };

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Whether attempt mark `a` is ordered above `b`, by the projection's own attempt ordering (`attemptedAt`, then `attemptId`). */
export function attemptMarkAbove(a: DelegationAttemptMark, b: DelegationAttemptMark): boolean {
  const at = byCodeUnits(a.attemptedAt, b.attemptedAt);
  return at > 0 || (at === 0 && byCodeUnits(a.attemptId, b.attemptId) > 0);
}

const emptyCarrier = (leaseId: string): DelegationLeaseCarrierRow => ({
  leaseId, transferringSince: null, transferRun: null, promotedRun: null, promotedSession: null, releaseReason: null, resolvedThrough: null,
});

const carrierOrNull = (c: DelegationLeaseCarrierRow): DelegationLeaseCarrierRow | null =>
  c.transferringSince === null && c.transferRun === null && c.promotedRun === null && c.promotedSession === null
    && c.releaseReason === null && c.resolvedThrough === null ? null : c;

/** `resolvesThrough` raises the carrier row's mark, never lowers it. */
const resolved = (c: DelegationLeaseCarrierRow, mark: DelegationAttemptMark | null): DelegationLeaseCarrierRow =>
  mark === null || (c.resolvedThrough !== null && !attemptMarkAbove(mark, c.resolvedThrough)) ? c : { ...c, resolvedThrough: mark };

/** Closes the lease's own open lineage rows (the lease-owned ones) at `at`, with `reason`. */
function closeLeaseLineage(lineage: readonly DelegationLineageRow[], leaseId: string, at: string, reason: string): DelegationLineageRow[] {
  return lineage.filter((n) => n.leaseId === leaseId && n.closedAt === null).map((n) => ({ ...n, closedAt: at, closeReason: reason }));
}

const bad = (detail: string): DelegationLeaseFoldResult => ({ ok: false, refusal: DELEGATION_LEASE_BAD_ENTRY, detail });

/**
 * The rows one applied `lease-transition` entry at `sequence` writes, decided by `decideLeaseTransition` with
 * `carrierRequired: false` (replay). The entry's `generation` must be the decision's and its `to` the decision's target.
 * `adopt` sets `adoptedAt`, `terminalEvidenceAt` (required there and only there, between `firstObservedAt` and `at`, D-7968) and the
 * expiry (`cleanupDueAt`, D-7829); the three keeps set `retainedAt` and the
 * expiry; `transfer` sets the carrier row's `transferringSince` and `transferRun`; the two transfer endings clear them; `promote`
 * sets `promotedAt` and the carrier row's `promotedRun` and `promotedSession`. Any entry closes the lease's open lineage with
 * `lineageClose` and opens a run-owned row for `lineageOpenRun` (with `runLineageId`, derived by the caller) when it names them,
 * and a non-null `resolvesThrough` raises the carrier row's mark. `generation = expectGeneration + 1` and `currentJournalSequence`
 * moves to `sequence`; no cleanup state or clock is written.
 */
export function foldLeaseTransition(input: {
  lease: DelegationLeaseRow | undefined; carrier: DelegationLeaseCarrierRow | undefined; lineage: readonly DelegationLineageRow[];
  entry: Extract<DelegationJournalEntryV1, { kind: 'lease-transition' }>; sequence: number; runLineageId: (runId: number) => string;
}): DelegationLeaseFoldResult {
  const { lease, carrier, entry: e } = input;
  const d = decideLeaseTransition(lease, carrier, { reason: e.reason, expectGeneration: e.generation - 1, carrierRequired: false });
  if (!d.ok || lease === undefined) return d.ok ? bad(`${e.reason}: no such lease ${e.leaseId}`) : d;
  if (d.generation !== e.generation) return bad(`${e.reason}: lease ${e.leaseId} would go to generation ${d.generation}, not ${e.generation}`);
  if (d.to !== e.to) return bad(`${e.reason}: lease ${e.leaseId} goes to ${d.to}, but the entry says ${e.to}`);
  const keeps = e.reason === 'adopt' || e.reason === 'retain' || e.reason === 'operator-retain' || e.reason === 'attach';
  if (keeps && e.expiresAt === null) return bad(`${e.reason}: lease ${e.leaseId}'s entry carries no expiry`);
  if ((e.reason === 'transfer' || e.reason === 'promote') && e.runId === null) return bad(`${e.reason}: lease ${e.leaseId}'s entry names no run`);
  // D-7968: `adopt` records the activity's terminal-evidence instant, and only `adopt` does; it lies between the lease's first
  // observation (the table's CHECK) and the adoption itself.
  if (e.reason === 'adopt') {
    if (e.terminalEvidenceAt === null) return bad(`adopt: lease ${e.leaseId}'s entry carries no terminal-evidence instant`);
    if (e.terminalEvidenceAt > e.at) return bad(`adopt: lease ${e.leaseId}'s terminal evidence ${e.terminalEvidenceAt} is after the adoption at ${e.at}`);
    if (e.terminalEvidenceAt < lease.firstObservedAt) {
      return bad(`adopt: lease ${e.leaseId}'s terminal evidence ${e.terminalEvidenceAt} is before its first observation ${lease.firstObservedAt}`);
    }
  } else if (e.terminalEvidenceAt !== null) return bad(`${e.reason}: only adopt records terminal evidence`);
  let row: DelegationLeaseRow = { ...lease, generation: e.generation, currentJournalSequence: input.sequence };
  if (d.to !== 'transferring' && d.to !== 'released') row = { ...row, disposition: d.to };
  let c: DelegationLeaseCarrierRow = carrier ?? emptyCarrier(e.leaseId);
  switch (e.reason) {
    case 'adopt': row = { ...row, adoptedAt: e.at, terminalEvidenceAt: e.terminalEvidenceAt, cleanupDueAt: e.expiresAt }; break;
    case 'retain': case 'operator-retain': case 'attach': row = { ...row, retainedAt: e.at, cleanupDueAt: e.expiresAt }; break;
    case 'transfer': c = { ...c, transferringSince: e.at, transferRun: e.runId }; break;
    case 'transfer-refused': case 'transfer-recovered': c = { ...c, transferringSince: null, transferRun: null }; break;
    case 'promote':
      row = { ...row, promotedAt: e.at };
      c = { ...c, transferringSince: null, transferRun: null, promotedRun: e.runId, promotedSession: e.promotedSession };
      break;
    case 'carrier': break;
  }
  c = resolved(c, e.resolvesThrough);
  const lineage: DelegationLineageRow[] = e.lineageClose === null ? [] : closeLeaseLineage(input.lineage, e.leaseId, e.at, e.lineageClose);
  if (e.lineageOpenRun !== null) {
    lineage.push({ lineageId: input.runLineageId(e.lineageOpenRun), parentId: lease.parentId, parentIncarnation: lease.parentIncarnation,
      activityId: null, leaseId: null, runId: e.lineageOpenRun, openedAt: e.at, closedAt: null, closeReason: null });
  }
  return { ok: true, fold: { lease: row, carrier: carrierOrNull(c), lineage } };
}

/** The rows one applied `lease-released` entry writes: `releasedAt`, the carrier row's `releaseReason` (and its `resolvesThrough`),
 *  and the lease's open lineage closed with the release reason. Decided by `decideLeaseRelease`. */
export function foldLeaseRelease(input: {
  lease: DelegationLeaseRow | undefined; carrier: DelegationLeaseCarrierRow | undefined; lineage: readonly DelegationLineageRow[];
  entry: Extract<DelegationJournalEntryV1, { kind: 'lease-released' }>; sequence: number;
}): DelegationLeaseFoldResult {
  const { lease, carrier, entry: e } = input;
  const d = decideLeaseRelease(lease, carrier, { expectGeneration: e.generation - 1 });
  if (!d.ok || lease === undefined) return d.ok ? bad(`release: no such lease ${e.leaseId}`) : d;
  if (d.generation !== e.generation) return bad(`release: lease ${e.leaseId} would go to generation ${d.generation}, not ${e.generation}`);
  const reason: DelegationLeaseReleaseReason = e.releaseReason;
  const row: DelegationLeaseRow = { ...lease, generation: e.generation, currentJournalSequence: input.sequence, releasedAt: e.at };
  const c = resolved({ ...(carrier ?? emptyCarrier(e.leaseId)), releaseReason: reason }, e.resolvesThrough);
  return { ok: true, fold: { lease: row, carrier: carrierOrNull(c), lineage: closeLeaseLineage(input.lineage, e.leaseId, e.at, reason) } };
}

/** What one applied `lease-carrier-seen` entry writes: `carrierGenerationSeen`, raised and never lowered. It changes neither the
 *  generation nor `currentJournalSequence` (D-7851), and a generation above the lease's refuses `stale-generation`. */
export function foldLeaseCarrierSeen(lease: DelegationLeaseRow | undefined,
  entry: Extract<DelegationJournalEntryV1, { kind: 'lease-carrier-seen' }>): { ok: true; lease: DelegationLeaseRow } | { ok: false; refusal: DelegationLeaseActRefusal; detail: string } {
  if (lease === undefined) return { ok: false, refusal: 'lease-unknown', detail: `carrier seen: no such lease ${entry.leaseId}` };
  if (entry.generation < 1 || entry.generation > lease.generation) {
    return { ok: false, refusal: 'stale-generation', detail: `carrier seen: lease ${lease.leaseId} is at generation ${lease.generation}, not ${entry.generation}` };
  }
  const seen = Math.max(lease.carrierGenerationSeen ?? 0, entry.generation);
  return { ok: true, lease: seen === lease.carrierGenerationSeen ? lease : { ...lease, carrierGenerationSeen: seen } };
}

