// Delegation broker wave 5, PR8 (Task 5.8.2): the one body of the three lease doors (`POST /api/leases/:lease/retain`,
// `operator-retain` and `resolve`, registered in `routes.ts`).
//
// THIS MODULE IS L4, with no fastify: it gathers the facts the L1 decisions need (the caller's or the parent's incarnation, the
// checkpoint of the ONE `DelegationDurability` the watcher's lane opened, the claimant read, the box's capabilities), hands them to
// `delegation-lease-acts.ts`, acts through PR5b's `transitionLease` and `releaseLease`, re-reads the caller's incarnation, and answers a
// `LeaseDoorAnswer`. It decides nothing itself. It never composes a ccd verb: the box's carrier is marked by the lane's next pass
// (`delegationCarrierMark.ts`), so every answer says `carrier: 'pending'`. It renews nothing on a branch write.
import type { DelegationCarrierState, LeaseDoorAnswer, LeaseDoorRefusal } from '../../../shared/api.js';
import type { FleetIO } from '../io.js';
import type { FleetState } from '../fleetstate.js';
import { LEASE_MARK_LOCK_CAP, ORPHAN_LEASE_CAP, capSupported, ccdCan } from '../ccdargv.js';
import { childReclaimGenerationRead } from './childReclaim.js';
import { readParentGenerations, settleParentIncarnations } from './gitref.js';
import type { DelegationDurability, DelegationLeaseActOutcome } from './delegation-checkpoint.js';
import { formatDelegationInstant, type DelegationCheckpointV1 } from './delegation-model.js';
import { DELEGATION_LEASE_EXPIRY_MS } from './delegation-lease-state.js';
import { conflictingTreeKeys } from './delegation-conflicts.js';
import {
  decideOperatorRetain, decideResolve, decideRetain, leaseCoordinatorOf, type LeaseDoorTarget, type LeaseResolveAnswer,
} from './delegation-lease-acts.js';
import type { CoordStore } from './store.js';
import type { StampedRun } from './runBinding.js';

export interface LeaseDoorDeps {
  io: Pick<FleetIO, 'readFileMeasured'>;
  registryDir: string;
  fleetState: Pick<FleetState, 'ccdVerbs'> | undefined;
  /** The watcher's one applier (`watcher.delegationApplier()`); null while the lane has none open. */
  applier: () => Promise<DelegationDurability | null>;
  /** Every run that ever named the session, unbounded (D-7818): `runStampsOfSeries` over the store. */
  runStampsNaming: (sessionId: string) => RunStampsRead;
  now: () => number;
}

const no = (error: LeaseDoorRefusal, detail: string): LeaseDoorAnswer => ({ ok: false, error, detail });

/** The claimant rule's runs, every one, or why none is given (all-or-failure). */
export type RunStampsRead = { ok: true; runs: readonly StampedRun[] } | { ok: false; detail: string };

/**
 * D-7818 and D-8042: every run that ever named `sessionId`, open or closed, with no limit, each with its interval. It is composed
 * from two readers the store already has, never a store method of its own: the binding's own series (`CoordStore#bindingRunsOf`,
 * every run the session works on or claims, any state, unbounded), then each run's interval by its id (`CoordStore#run`, a run-keyed
 * read). A fifth session-keyed run reader would break the ARCH-62 census's ceiling of four (`run-session-census.test.ts`). The series
 * also holds the runs the session claims; `claimantAt` reads only the ones that name it as worker. All-or-failure: one unreadable
 * run fails the read. It costs one run read per run in the series, on a door that is rare.
 */
export function runStampsOfSeries(coord: Pick<CoordStore, 'bindingRunsOf' | 'run'>, sessionId: string): RunStampsRead {
  const series = coord.bindingRunsOf(sessionId);
  if (!series.ok) return { ok: false, detail: series.detail };
  const runs: StampedRun[] = [];
  for (const b of series.runs) {
    const read = coord.run(b.id);
    if (!read.ok) return { ok: false, detail: read.detail };
    if (read.run !== null) runs.push({ id: read.run.id, sessionId: read.run.sessionId, claimedBy: read.run.claimedBy, openedAt: read.run.openedAt, closedAt: read.run.closedAt });
  }
  return { ok: true, runs };
}
/** How many times a door decides again when the lease moved between its read and its act (`stale-generation`, the lane's carrier mint). */
const ATTEMPTS = 2;

/** A session's CURRENT incarnation, read twice (`$REG/<id>.generation`, ruling R38), or why it is unmeasured. */
async function incarnationOf(d: LeaseDoorDeps, id: string): Promise<{ kind: 'measured'; incarnation: string } | { kind: 'unmeasured'; reason: string }> {
  const generationOf = (s: string) => childReclaimGenerationRead(d.io, d.registryDir, s);
  try {
    return (await settleParentIncarnations(generationOf, await readParentGenerations(generationOf, [id]))).get(id) ?? { kind: 'unmeasured', reason: 'unread' };
  } catch { return { kind: 'unmeasured', reason: 'unreadable' }; }
}

/** The applier, ready, with its checkpoint; or `not-ready`. */
async function readyApplier(d: LeaseDoorDeps): Promise<{ durable: DelegationDurability; cp: DelegationCheckpointV1 } | LeaseDoorAnswer> {
  let durable: DelegationDurability | null;
  try { durable = await d.applier(); } catch { durable = null; }
  if (durable === null) return no('not-ready', 'the delegation lane has no durable applier open yet — retry');
  const state = durable.state();
  if (state.phase !== 'ready') return no('not-ready', 'the delegation lane is recovering its checkpoint — retry');
  return { durable, cp: state.checkpoint as DelegationCheckpointV1 };
}

/** The box has the carrier's writer (`ccdCan`'s `leaseMark` row, the verb question asked once), so a keep waits for the read-back. */
const carrierMarks = (d: LeaseDoorDeps): boolean => ccdCan(d.fleetState, 'leaseMark');

/** The box can hold a tree: it marks the carrier, takes the orphan act's lock while it does (D-8037), and its orphan rung skips a held tree. */
const boxHolds = (d: LeaseDoorDeps): boolean =>
  carrierMarks(d) && capSupported(d.fleetState, LEASE_MARK_LOCK_CAP) && capSupported(d.fleetState, ORPHAN_LEASE_CAP);

/** One act through a PR5b door, turned into the doors' answer; a throw (a fold refusal, a failed application) is not confirmed durable. */
async function settle(durable: DelegationDurability, act: () => Promise<DelegationLeaseActOutcome>): Promise<LeaseDoorAnswer | 'moved'> {
  let out: DelegationLeaseActOutcome;
  try { out = await act(); } catch (err) {
    return no('not-ready', `the act is not confirmed durable (${err instanceof Error ? err.message : String(err)}) — retry`);
  }
  if (out.kind === 'refused') return out.refusal === 'stale-generation' ? 'moved' : no(out.refusal, out.detail);
  const lease = durable.state().checkpoint.leases.find((l) => l.leaseId === out.leaseId);
  return { ok: true, lease: out.leaseId, generation: out.generation, disposition: out.state satisfies DelegationCarrierState,
    expiresAt: out.state === 'released' ? null : lease?.cleanupDueAt ?? null, carrier: 'pending' };
}

/** Decide and act, again once when the lease moved under the act; past that the act answers `not-ready`. */
async function decideAndAct(d: LeaseDoorDeps, step: (durable: DelegationDurability, cp: DelegationCheckpointV1) => Promise<LeaseDoorAnswer | 'moved'>): Promise<LeaseDoorAnswer> {
  for (let i = 0; i < ATTEMPTS; i++) {
    const ready = await readyApplier(d);
    if (!('durable' in ready)) return ready;
    const out = await step(ready.durable, ready.cp);
    if (out !== 'moved') return out;
  }
  return no('not-ready', 'the lease moved while this act was queued — retry');
}

const keepRequest = (d: LeaseDoorDeps, leaseId: string, expectGeneration: number, reason: 'retain' | 'operator-retain' | 'attach') => {
  const at = d.now();
  return { leaseId, expectGeneration, reason, at: formatDelegationInstant(at), expiresAt: formatDelegationInstant(at + DELEGATION_LEASE_EXPIRY_MS),
    terminalEvidenceAt: null, runId: null, promotedSession: null, auditEvidence: null, carrierRequired: carrierMarks(d) };
};

/**
 * Retain, after the route's token, body and attribution checks: the caller's incarnation (`registry-unmeasurable`), the applier
 * (`not-ready`), the parent's run stamps (`not-ready` when unreadable; skipped for a lease the checkpoint does not hold), `decideRetain`,
 * the `retain` transition (7 days from now), then the caller's incarnation once more: a proven move answers `incarnation-changed` and the
 * transition stands.
 */
export async function retainLease(d: LeaseDoorDeps, req: { leaseId: string; byId: string }): Promise<LeaseDoorAnswer> {
  const inc = await incarnationOf(d, req.byId);
  if (inc.kind !== 'measured') return no('registry-unmeasurable', `the registry incarnation of ${req.byId} is unmeasured (${inc.reason}) — transient, retry`);
  const out = await decideAndAct(d, async (durable, cp) => {
    const lease = cp.leases.find((l) => l.leaseId === req.leaseId);
    const stamps = lease === undefined ? { ok: true as const, runs: [] } : d.runStampsNaming(lease.parentId);
    if (!stamps.ok) return no('not-ready', `the runs that named ${lease!.parentId} are unreadable (${stamps.detail}) — retry`);
    const decided = decideRetain({ lease, carrier: cp.leaseCarriers?.find((c) => c.leaseId === req.leaseId), byId: req.byId,
      byIncarnation: inc.incarnation, coordinator: lease === undefined ? null : leaseCoordinatorOf(lease, stamps.runs),
      conflicting: conflictingTreeKeys(cp), boxHolds: boxHolds(d), carrierRequired: carrierMarks(d) });
    if (!decided.ok) return no(decided.refusal, decided.detail);
    return settle(durable, () => durable.transitionLease({ ...keepRequest(d, req.leaseId, decided.expectGeneration, 'retain'), resolvesThrough: null }));
  });
  if (!out.ok) return out;
  const after = await incarnationOf(d, req.byId);
  if (after.kind === 'measured' && after.incarnation !== inc.incarnation) {
    return no('incarnation-changed', `the registry incarnation of ${req.byId} changed while the retain was queued; the lease stays retained`);
  }
  return out;
}

/** The operator's keep: the applier, `decideOperatorRetain`, the `operator-retain` transition (7 days from now). */
export async function operatorRetainLease(d: LeaseDoorDeps, leaseId: string): Promise<LeaseDoorAnswer> {
  return decideAndAct(d, async (durable, cp) => {
    const decided = decideOperatorRetain({ lease: cp.leases.find((l) => l.leaseId === leaseId), carrier: cp.leaseCarriers?.find((c) => c.leaseId === leaseId),
      conflicting: conflictingTreeKeys(cp), boxHolds: boxHolds(d), carrierRequired: carrierMarks(d) });
    if (!decided.ok) return no(decided.refusal, decided.detail);
    return settle(durable, () => durable.transitionLease({ ...keepRequest(d, leaseId, decided.expectGeneration, 'operator-retain'), resolvesThrough: null }));
  });
}

/** The operator's resolve: for attach, the parent's incarnation first (a live registry row); then the applier, `decideResolve`, and the
 *  `attach` transition or the `foreign` release, each with the resolution mark. */
export async function resolveLease(d: LeaseDoorDeps, req: { target: LeaseDoorTarget; action: 'attach' | 'foreign'; parent: string | null }): Promise<LeaseDoorAnswer> {
  const parentInc = req.action === 'attach' && req.parent !== null ? await incarnationOf(d, req.parent) : null;
  return decideAndAct(d, async (durable, cp) => {
    const decided: LeaseResolveAnswer = decideResolve({ target: req.target, action: req.action, parent: req.parent, checkpoint: cp,
      conflicting: conflictingTreeKeys(cp), boxHolds: boxHolds(d), carrierRequired: carrierMarks(d),
      liveParent: (id) => (id === req.parent && parentInc?.kind === 'measured' ? { incarnation: parentInc.incarnation } : null) });
    if (!decided.ok) return no(decided.refusal, decided.detail);
    if (decided.act === 'release') {
      return settle(durable, () => durable.releaseLease({ leaseId: decided.leaseId, expectGeneration: decided.expectGeneration, releaseReason: 'foreign',
        at: formatDelegationInstant(d.now()), lastHeadSha: null, resolvesThrough: decided.resolvesThrough }));
    }
    return settle(durable, () => durable.transitionLease({ ...keepRequest(d, decided.leaseId, decided.expectGeneration, 'attach'), resolvesThrough: decided.resolvesThrough }));
  });
}
