// Delegation broker wave 5, PR6 (Task 5.6.1): a carrier for every linked lease. L1 policy: the mark planner, the carrier parser
// and the read-back comparison. Pure: no I/O, no clock (it is fed `nowMs`), no capability read (it is fed `supported`).
//
// The journal is the one source of a lease's generation; the box's carrier (one file per lease under the registry, written only by
// the verb `CCD_ARGV.leaseMark` composes) corroborates it. The planner never invents a generation: it marks at the lease's own, and the verb
// writes any generation above the stored one (D-7802), so a carrier that missed generations catches up in one write. A carrier
// it cannot read, one ahead of the journal, and one no journal lease owns are counted, never acted on. A mark the box refused in a
// word that will stand (every word but `busy` and `unmeasured`) is not composed again until its generation or its tree's census
// row changes (D-7807), and never takes the per-pass budget from a lease that can be marked.
import {
  DELEGATION_LEASE_RELEASE_REASONS, DELEGATION_LEASE_SOURCE_KINDS, isDelegationCarrierState,
  type DelegationCarrierHealth, type DelegationCarrierState, type DelegationLeaseReleaseReason, type DelegationLeaseSourceKind,
  type LeaseMarkRefusal,
} from '../../../shared/api.js';
import type { LeaseMarkArgs } from '../ccdargv.js';
import { delegationTreeKey } from './delegation-correlation.js';
import {
  parseDelegationInstant, type DelegationCheckpointV1, type DelegationLeaseCarrierRow, type DelegationLeaseRow,
} from './delegation-model.js';
import { delegationCarrierStateOf } from './delegation-lease-state.js';

/** At most this many `mint` and `mark` steps a pass (a heal included), oldest lease first; the rest count `pending`. */
export const DELEGATION_CARRIER_MARKS_PER_PASS = 8;
/** The box's own bound on a carrier (`ccd/lib/delegation-lease.sh#__DL_CARRIER_MAX`): a larger one is malformed, never read. */
export const DELEGATION_CARRIER_MAX_BYTES = 16384;

/** One carrier, as the box's carrier writer writes it (rule 12 of the verb), `markedAt` included. */
export interface DelegationCarrierBody {
  v: 1; leaseId: string; generation: number; state: DelegationCarrierState; journalSeq: number;
  parentId: string; parentIncarnation: string; activityId: string; source: DelegationLeaseSourceKind; project: string;
  adminRecord: string; canonicalPath: string; fingerprint: string; claudeBase: string | null; branch: string | null;
  expiresAt: number | null; releaseReason: DelegationLeaseReleaseReason | null; promotedRun: number | null;
  promotedSession: string | null; markedAt: number;
}
export type ParsedCarrier = { kind: 'carrier'; body: DelegationCarrierBody } | { kind: 'malformed'; detail: string };
/** What the lane read for one lease's carrier: proven absent, unreadable, or the file's parse. */
export type CarrierReadBack = { kind: 'absent' } | { kind: 'unreadable'; detail: string } | ParsedCarrier;
/** A mark refusal that will answer the same until something changes: every `LeaseMarkRefusal` but `busy` and `unmeasured`. */
export interface StandingMarkRefusal { generation: number; censusRow: string | null; word: LeaseMarkRefusal }
export type CarrierStep =
  | { kind: 'mint'; leaseId: string; expectGeneration: 0 }                  // journal `carrier`, then mark at generation 1
  | { kind: 'mark'; args: LeaseMarkArgs }                                   // compose the verb at the lease's generation
  | { kind: 'seen'; leaseId: string; generation: number };                 // journal `lease-carrier-seen`

/** The refusals that are retried at the next pass; every other word stands (rule 6, D-7807). */
export const DELEGATION_CARRIER_RETRIED_REFUSALS = ['busy', 'unmeasured'] as const satisfies readonly LeaseMarkRefusal[];
export function isStandingMarkRefusal(word: LeaseMarkRefusal): boolean {
  return !(DELEGATION_CARRIER_RETRIED_REFUSALS as readonly string[]).includes(word);
}

const LEASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STRINGS = ['parentId', 'parentIncarnation', 'activityId', 'project', 'adminRecord', 'canonicalPath', 'fingerprint'] as const;
/** Every key of the body, total over the interface: a key added to `DelegationCarrierBody` is a compile error here until it is listed. */
const BODY_KEYS: Readonly<Record<keyof DelegationCarrierBody, true>> = {
  v: true, leaseId: true, generation: true, state: true, journalSeq: true, parentId: true, parentIncarnation: true, activityId: true,
  source: true, project: true, adminRecord: true, canonicalPath: true, fingerprint: true, claudeBase: true, branch: true, expiresAt: true,
  releaseReason: true, promotedRun: true, promotedSession: true, markedAt: true,
};
const KEYS = Object.keys(BODY_KEYS) as readonly (keyof DelegationCarrierBody)[];
const count = (v: unknown, min: number): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const strOrNull = (v: unknown): boolean => v === null || typeof v === 'string';

/** The carrier's grammar, the box reader's (`__DL_CARRIER_PY`) on the server: every key, no other, each value in its grammar. */
export function parseDelegationCarrier(text: string): ParsedCarrier {
  const bad = (detail: string): ParsedCarrier => ({ kind: 'malformed', detail });
  if (new TextEncoder().encode(text).length > DELEGATION_CARRIER_MAX_BYTES) return bad(`the carrier is over ${DELEGATION_CARRIER_MAX_BYTES} bytes`);
  let v: unknown;
  try { v = JSON.parse(text); } catch { return bad('the carrier is not JSON'); }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return bad('the carrier is not one object');
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  const extra = keys.find((k) => !(KEYS as readonly string[]).includes(k));
  if (extra !== undefined) return bad(`the carrier holds the key ${extra}, outside its grammar`);
  const missing = KEYS.find((k) => !(k in o));
  if (missing !== undefined) return bad(`the carrier lacks the key ${missing}`);
  if (o.v !== 1) return bad('the carrier is not version 1');
  if (typeof o.leaseId !== 'string' || !LEASE_ID.test(o.leaseId)) return bad('leaseId is not a lease id');
  if (!count(o.generation, 1) || !count(o.journalSeq, 1)) return bad('generation and journalSeq are positive integers');
  if (!isDelegationCarrierState(o.state)) return bad('state is not a carrier state');
  for (const k of STRINGS) if (typeof o[k] !== 'string') return bad(`${k} is not a string`);
  if (!(DELEGATION_LEASE_SOURCE_KINDS as readonly unknown[]).includes(o.source)) return bad('source is not a lease source');
  if (!strOrNull(o.claudeBase) || !strOrNull(o.branch) || !strOrNull(o.promotedSession)) return bad('claudeBase, branch and promotedSession are strings or null');
  if (o.expiresAt !== null && !count(o.expiresAt, 1)) return bad('expiresAt is not epoch milliseconds');
  if (o.promotedRun !== null && !count(o.promotedRun, 1)) return bad('promotedRun is not a run id');
  if (o.releaseReason !== null && !(DELEGATION_LEASE_RELEASE_REASONS as readonly unknown[]).includes(o.releaseReason)) return bad('releaseReason is not a release reason');
  if (!count(o.markedAt, 0)) return bad('markedAt is not epoch milliseconds');
  return { kind: 'carrier', body: o as unknown as DelegationCarrierBody };
}

/** The mark of `lease` at its own generation, state and sequence (the verb's argv, through `CCD_ARGV.leaseMark`). The expiry rides only on
 *  a kept lease (`adopted`, `retained`), the reason only on a released one, the run and session only on a promoted one. */
export function carrierMarkArgs(lease: DelegationLeaseRow, carrier: DelegationLeaseCarrierRow | undefined): LeaseMarkArgs {
  const state = delegationCarrierStateOf(lease, carrier);
  let expiresAtMs: number | null = null;
  if ((state === 'adopted' || state === 'retained') && lease.cleanupDueAt !== null) {
    try { expiresAtMs = parseDelegationInstant(lease.cleanupDueAt); } catch { expiresAtMs = null; }   // the box then reads `unmeasured`: fails shut
  }
  const promoted = state === 'promoted' && carrier?.promotedRun != null && carrier.promotedSession != null
    ? { runId: carrier.promotedRun, sessionId: carrier.promotedSession } : null;
  return {
    leaseId: lease.leaseId, generation: lease.generation, project: lease.project, adminRecord: lease.adminRecord, parentId: lease.parentId,
    parentIncarnation: lease.parentIncarnation, activityId: lease.activityId, source: lease.sourceKind, state, journalSeq: lease.currentJournalSequence,
    expiresAtMs, releaseReason: state === 'released' ? carrier?.releaseReason ?? null : null, promoted,
  };
}

/** How a carrier read back compares with its lease as journalled: `ahead` and `foreign` (another sequence, state or identity at the
 *  lease's generation) are `mismatched`; `equal` licenses a `seen`; `behind` licenses a mark. The ONE comparison: the planner and
 *  `markLeaseCarrier`'s read-back both ask it, so `carrierGenerationSeen` moves on the same equality wherever it moves. */
export function carrierReadBackVersus(lease: DelegationLeaseRow, carrier: DelegationLeaseCarrierRow | undefined,
  body: DelegationCarrierBody): 'equal' | 'behind' | 'ahead' | 'foreign' {
  if (body.generation > lease.generation) return 'ahead';
  if (body.generation < lease.generation) return 'behind';
  const same = body.leaseId === lease.leaseId && body.parentId === lease.parentId && body.parentIncarnation === lease.parentIncarnation
    && body.activityId === lease.activityId && body.source === lease.sourceKind && body.project === lease.project
    && body.adminRecord === lease.adminRecord;
  return same && body.state === delegationCarrierStateOf(lease, carrier) && body.journalSeq === lease.currentJournalSequence ? 'equal' : 'foreign';
}

/** Rule 6's census row of one tree: its census state, head and lock, and the registry workdirs at or inside `treePath` (the lease's
 *  journalled path), so a `locked`, `registered` or `nested` refusal is composed again once the lock goes, the row goes, or the head
 *  moves. `record` undefined: the pass's census does not list the tree. A canonical string, compared and never parsed. */
export function delegationCarrierCensusRow(treePath: string, record: { state: string; headSha: string | null; locked: boolean } | undefined,
  workdirs: readonly string[]): string {
  const at = workdirs.filter((w) => w === treePath || w.startsWith(`${treePath}/`)).sort();
  return JSON.stringify(record === undefined ? ['unlisted', ...at] : [record.state, record.headSha, record.locked, ...at]);
}

/** Whether the health block carries `carriers`: only when a count is above zero, so a lane that counted nothing (no lease, or an
 *  applier not ready) leaves the block's shape exactly as an older server's, and absence says nothing was counted. */
export function delegationCarrierHealthShown(h: DelegationCarrierHealth | null): DelegationCarrierHealth | null {
  return h !== null && Object.values(h).some((n) => n > 0) ? { ...h } : null;
}

const order = (a: DelegationLeaseRow, b: DelegationLeaseRow): number =>
  a.creatingJournalSequence - b.creatingJournalSequence || (a.leaseId < b.leaseId ? -1 : a.leaseId > b.leaseId ? 1 : 0);

/**
 * The carrier steps of one pass (plan "## PR6", rules 1-8), oldest lease first by its creating journal sequence. `readBack` holds what
 * the lane read: a lease with no entry was not read (the lane reads no carrier already read back at its lease's generation) and is
 * `marked` when its `carrierGenerationSeen` equals its generation, else `unmeasured`; an entry for an id the checkpoint does not hold is
 * an unowned carrier (rule 8). `indexed` names the leases a by-tree entry names (rule 3's heal), or `'unmeasured'`, which composes no heal.
 */
export function planCarrierSteps(input: {
  checkpoint: DelegationCheckpointV1; readBack: ReadonlyMap<string, CarrierReadBack>; supported: boolean; nowMs: number;
  refused: ReadonlyMap<string, StandingMarkRefusal>; censusRow: ReadonlyMap<string, string>; indexed: ReadonlySet<string> | 'unmeasured';
}): { steps: readonly CarrierStep[]; health: DelegationCarrierHealth } {
  const health: DelegationCarrierHealth = { marked: 0, pending: 0, unsupported: 0, mismatched: 0, unmeasured: 0, unowned: 0, refused: 0 };
  const carriers = new Map((input.checkpoint.leaseCarriers ?? []).map((c) => [c.leaseId, c] as const));
  const owned = new Set(input.checkpoint.leases.map((l) => l.leaseId));
  const steps: CarrierStep[] = [];
  let budget = DELEGATION_CARRIER_MARKS_PER_PASS;
  const spend = (step: CarrierStep): void => { if (budget > 0) { budget -= 1; steps.push(step); } else health.pending += 1; };
  for (const lease of [...input.checkpoint.leases].sort(order)) {
    const released = lease.releasedAt !== null;
    const upToDate = lease.generation > 0 && (lease.carrierGenerationSeen ?? 0) >= lease.generation;
    if (!input.supported) { if (!released && !upToDate) health.unsupported += 1; continue; }        // rule 1
    if (lease.generation === 0) { if (!released) spend({ kind: 'mint', leaseId: lease.leaseId, expectGeneration: 0 }); continue; }   // rule 2
    const carrier = carriers.get(lease.leaseId);
    const rb = input.readBack.get(lease.leaseId);
    if (rb === undefined) { if (upToDate) health.marked += 1; else health.unmeasured += 1; continue; }
    if (rb.kind === 'unreadable' || rb.kind === 'malformed') { health.unmeasured += 1; continue; }     // rule 5
    if (rb.kind === 'carrier') {
      const versus = carrierReadBackVersus(lease, carrier, rb.body);
      if (versus === 'ahead' || versus === 'foreign') { health.mismatched += 1; continue; }            // rule 5: never overwritten
      if (versus === 'equal') {                                                                         // rule 4
        health.marked += 1;
        if (!upToDate) steps.push({ kind: 'seen', leaseId: lease.leaseId, generation: lease.generation });
        continue;
      }
    } else if (released && (input.indexed === 'unmeasured' || !input.indexed.has(lease.leaseId))) {
      continue;                                                       // rule 3: no carrier was ever written, and no entry names it
    }
    const standing = input.refused.get(lease.leaseId);                // rule 6
    if (standing !== undefined && standing.generation === lease.generation
        && standing.censusRow === (input.censusRow.get(delegationTreeKey(lease.project, lease.adminRecord)) ?? null)) {
      health.refused += 1;
      continue;
    }
    spend({ kind: 'mark', args: carrierMarkArgs(lease, carrier) });   // rules 3 and 7
  }
  for (const [id, rb] of input.readBack) {                            // rule 8
    if (owned.has(id)) continue;
    if (rb.kind === 'carrier' && rb.body.state !== 'released') health.unowned += 1;
    else if (rb.kind === 'unreadable' || rb.kind === 'malformed') health.unmeasured += 1;
  }
  return { steps, health };
}
