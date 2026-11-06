// Delegation broker wave 5, PR8 (Task 5.8.1): the decisions behind Retain and resolve (spec §5.4, §5.14, §6; D-7818..D-7822,
// D-7833, D-7835, D-7837, D-7843).
//
// THIS MODULE IS L1: pure, no I/O, no clock (the caller passes every instant and every measured fact). It decides, in order, whether a
// lease's parent (or, O5-4 (a), that parent's coordinator) may keep a lease for another 7 days, whether the operator may keep one, and
// what the operator's resolve of a lease or of a `tree-<key>` does. The doors (`delegationLeaseDoor.ts`, L4) gather the facts and act
// through PR5b's `transitionLease` and `releaseLease`, which re-decide through `decideLeaseTransition` and `decideLeaseRelease`: every
// write here is grammar PR5a folds (a `lease-transition` with reason `retain`, `operator-retain` or `attach`, or a `lease-released`
// with reason `foreign`, each carrying `resolvesThrough`), so this module adds no journal kind, entry field or checkpoint member.
//
// O5-8 is ruled (c): a resolve acts on a LEASE only. A `tree-<key>` is resolved as the unreleased lease on that tree, never by minting
// one, and a tree with no unreleased lease refuses `tree-unleased`.
import { isLeaseDoorRefusal, isSessionIdShape, type LeaseDoorRefusal } from '../../../shared/api.js';
import {
  parseDelegationInstant,
  type DelegationAttemptMark,
  type DelegationCheckpointV1,
  type DelegationLeaseCarrierRow,
  type DelegationLeaseRow,
} from './delegation-model.js';
import { decideLeaseRelease, decideLeaseTransition, delegationCarrierStateOf, type DelegationLeaseActRefusal } from './delegation-lease-state.js';
import { delegationTreeTarget, newestUnownedAttempts } from './delegation-conflicts.js';
import { delegationTreeKey } from './delegation-correlation.js';
import { claimantAt, type StampedRun } from './runBinding.js';

/**
 * O5-4 (a)'s ONE claimant rule (D-7843): the coordinator the lease's parent worked for when the lease was first observed, exactly the
 * frame's R9 (`claimantAt`, as `delegation-projection.ts#projectDelegation` nests the row). Retain reads it here; PR7's digest recipient
 * and PR9's promote gate import it. `runs` is `CoordStore#delegationRunStampsNaming(lease.parentId)`, every run that ever named the
 * parent, never the bounded `delegationRunStamps()`, whose newest-500-closed window a long-kept lease outlives (D-7818).
 */
export function leaseCoordinatorOf(lease: Pick<DelegationLeaseRow, 'parentId' | 'firstObservedAt'>, runs: readonly StampedRun[]): string | null {
  return claimantAt(runs, lease.parentId, parseDelegationInstant(lease.firstObservedAt));
}

/** A door's target: a lease id, or `tree-<64 hex>` (`delegationTreeTarget`) for the tree of an unowned row (D-7837). */
export type LeaseDoorTarget = { kind: 'lease'; leaseId: string } | { kind: 'tree'; treeKey: string };

const LEASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TREE_TARGET = /^tree-([0-9a-f]{64})$/;

/** A lowercase UUID (the lease ids `randomUUID` mints), or `tree-` followed by 64 lowercase hex; anything else is null. */
export function parseLeaseTarget(param: string): LeaseDoorTarget | null {
  if (LEASE_ID.test(param)) return { kind: 'lease', leaseId: param };
  const tree = TREE_TARGET.exec(param);
  return tree === null ? null : { kind: 'tree', treeKey: tree[1]! };
}

// ── The requests, as the routes receive them (each refusal is `bad-request`) ────────────────────────────────────────────

type BadRequest = { ok: false; detail: string };
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(v).sort().join(',') === [...keys].sort().join(',');

/** Retain's body is exactly `{byId, byUuid}` (a session id and a non-empty string), then `:lease` is a lease id: in that order. */
export function parseRetainRequest(body: unknown, param: string): { ok: true; leaseId: string; byId: string; byUuid: string } | BadRequest {
  if (!isObject(body) || !keysAre(body, ['byId', 'byUuid'])) return { ok: false, detail: 'the body is exactly {byId, byUuid}' };
  const { byId, byUuid } = body;
  if (typeof byId !== 'string' || !isSessionIdShape(byId) || typeof byUuid !== 'string' || byUuid === '') {
    return { ok: false, detail: 'byId is a session id and byUuid a non-empty string' };
  }
  const target = parseLeaseTarget(param);
  if (target?.kind !== 'lease') return { ok: false, detail: 'the path names a lease id (a lowercase UUID)' };
  return { ok: true, leaseId: target.leaseId, byId, byUuid };
}

/** The operator's keep carries no body (or `{}`), and `:lease` is a lease id. */
export function parseOperatorRetainRequest(body: unknown, param: string): { ok: true; leaseId: string } | BadRequest {
  if (body !== undefined && body !== null && !(isObject(body) && keysAre(body, []))) return { ok: false, detail: 'the body is empty: {}' };
  const target = parseLeaseTarget(param);
  if (target?.kind !== 'lease') return { ok: false, detail: 'the path names a lease id (a lowercase UUID)' };
  return { ok: true, leaseId: target.leaseId };
}

/** The resolve's body is exactly `{action: 'attach', parent}` or `{action: 'foreign'}`, and `:lease` is a lease id or `tree-<64 hex>`. */
export function parseResolveRequest(body: unknown, param: string):
  { ok: true; target: LeaseDoorTarget; action: 'attach' | 'foreign'; parent: string | null } | BadRequest {
  const attach = isObject(body) && keysAre(body, ['action', 'parent']) && body['action'] === 'attach'
    && typeof body['parent'] === 'string' && isSessionIdShape(body['parent']);
  const foreign = isObject(body) && keysAre(body, ['action']) && body['action'] === 'foreign';
  if (!attach && !foreign) return { ok: false, detail: 'the body is exactly {action: \'attach\', parent: <session id>} or {action: \'foreign\'}' };
  const target = parseLeaseTarget(param);
  if (target === null) return { ok: false, detail: 'the path names a lease id (a lowercase UUID) or tree-<64 lowercase hex>' };
  return { ok: true, target, action: attach ? 'attach' : 'foreign', parent: attach ? (body as { parent: string }).parent : null };
}

type Refused = { ok: false; refusal: LeaseDoorRefusal; detail: string };
const no = (refusal: LeaseDoorRefusal, detail: string): Refused => ({ ok: false, refusal, detail });

/** The lease table's refusal, in the doors' words. `stale-generation` cannot follow a decision fed the lease's own generation; if the
 *  lease moved between the read and the door, the act is retried, so it answers `not-ready`. */
const doorRefusal = (r: DelegationLeaseActRefusal): LeaseDoorRefusal => (isLeaseDoorRefusal(r) ? r : 'not-ready');

type KeepInput = {
  lease: DelegationLeaseRow | undefined; carrier: DelegationLeaseCarrierRow | undefined;
  /** `conflictingTreeKeys(checkpoint)`. */
  conflicting: ReadonlySet<string>;
  /** The box reports the carrier mark, its orphan lock and the orphan rung (`LEASE_MARK_CAP`, `LEASE_MARK_LOCK_CAP`, `ORPHAN_LEASE_CAP`), so a
   *  held tree is marked and skipped. */
  boxHolds: boolean;
  /** The box reports the carrier-mark capability, so a keep waits for the carrier to be read back (`decideLeaseTransition`). */
  carrierRequired: boolean;
};
type KeepAnswer<R> = { ok: true; reason: R; expectGeneration: number } | Refused;

/** What every keep shares, after the claimant: a conflicted tree, a hold the box cannot honour, then the transition table. */
function decideKeep<R extends 'retain' | 'operator-retain'>(lease: DelegationLeaseRow, input: KeepInput, reason: R): KeepAnswer<R> {
  if (input.conflicting.has(delegationTreeKey(lease.project, lease.adminRecord))) {
    return no('lease-conflicting', `${reason}: lease ${lease.leaseId}'s tree is in conflict; only the operator's resolve acts on it`);
  }
  if (!input.boxHolds && delegationCarrierStateOf(lease, input.carrier) === 'ephemeral') {
    return no('box-unsupported', `${reason}: the fleet box cannot hold lease ${lease.leaseId}'s tree (it lacks the carrier mark, its lock or the orphan rung)`);
  }
  const d = decideLeaseTransition(lease, input.carrier, { reason, expectGeneration: lease.generation, carrierRequired: input.carrierRequired });
  return d.ok ? { ok: true, reason, expectGeneration: lease.generation } : no(doorRefusal(d.refusal), d.detail);
}

/** The released checks every act shares: a known lease, not released. */
function known(lease: DelegationLeaseRow | undefined, what: string): Refused | null {
  if (lease === undefined) return no('lease-unknown', `${what}: no such lease`);
  if (lease.releasedAt !== null) return no('lease-released', `${what}: lease ${lease.leaseId} was released at ${lease.releasedAt}`);
  return null;
}

/**
 * Retain (`POST /api/leases/:lease/retain`): refuses, in order, `lease-unknown`, `lease-released`, `not-lease-parent` (the caller is
 * neither the lease's parent at the lease's incarnation nor the coordinator `leaseCoordinatorOf` names), `lease-conflicting`,
 * `box-unsupported` (an `ephemeral` lease on a box that cannot hold its tree), then the transition table (`wrong-disposition` from
 * `transferring` or `promoted`, `carrier-behind` while the carrier has not been read back at the lease's generation).
 */
export function decideRetain(input: KeepInput & {
  byId: string; byIncarnation: string;
  /** `leaseCoordinatorOf(lease, runs)`, resolved by the caller. */
  coordinator: string | null;
}): KeepAnswer<'retain'> {
  const { lease } = input;
  const gone = known(lease, 'retain');
  if (gone !== null || lease === undefined) return gone ?? no('lease-unknown', 'retain: no such lease');
  const parent = input.byId === lease.parentId && input.byIncarnation === lease.parentIncarnation;
  if (!parent && (input.coordinator === null || input.coordinator !== input.byId)) {
    return no('not-lease-parent', `retain: ${input.byId} is not lease ${lease.leaseId}'s parent at its incarnation, nor that parent's coordinator`);
  }
  return decideKeep(lease, input, 'retain');
}

/** The operator's keep (`POST /api/leases/:lease/operator-retain`): Retain's checks with no claimant. */
export function decideOperatorRetain(input: KeepInput): KeepAnswer<'operator-retain'> {
  const { lease } = input;
  const gone = known(lease, 'operator-retain');
  if (gone !== null || lease === undefined) return gone ?? no('lease-unknown', 'operator-retain: no such lease');
  return decideKeep(lease, input, 'operator-retain');
}

export type ResolveAnswer =
  | { ok: true; act: 'transition'; leaseId: string; reason: 'attach'; expectGeneration: number; resolvesThrough: DelegationAttemptMark | null }
  | { ok: true; act: 'release'; leaseId: string; expectGeneration: number; resolvesThrough: DelegationAttemptMark | null }
  | Refused;

/** The lease a target names: by id, or the unreleased lease on the tree a `tree-<key>` names (the first by lease id; policy holds one). */
function leaseOfTarget(cp: Pick<DelegationCheckpointV1, 'leases'>, target: LeaseDoorTarget): DelegationLeaseRow | Refused {
  if (target.kind === 'lease') {
    return cp.leases.find((l) => l.leaseId === target.leaseId) ?? no('lease-unknown', `resolve: no lease ${target.leaseId}`);
  }
  const onTree = cp.leases.filter((l) => l.releasedAt === null && delegationTreeTarget(l.project, l.adminRecord) === target.treeKey)
    .sort((a, b) => (a.leaseId < b.leaseId ? -1 : a.leaseId > b.leaseId ? 1 : 0));
  return onTree[0] ?? no('tree-unleased', `resolve: tree ${target.treeKey} holds no unreleased lease (a worktree with no lease is not resolved in wave 5)`);
}

/**
 * The operator's resolve (`POST /api/leases/:lease/resolve`). The target is a lease, or the unreleased lease on a `tree-<key>`'s tree
 * (`tree-unleased` when there is none). `resolvesThrough` is the tree's newest unowned-work attempt (`newestUnownedAttempts`), or null:
 * the resolution mark that takes the tree out of `conflictingTreeKeys` (D-7820).
 * - `attach`: `parent` is the lease's own parent (`not-lease-parent`; re-parenting is never offered) and a live registry row with a
 *   measured incarnation (`not-live-parent`). A non-conflicting lease must be `raw` (`wrong-disposition`: a linked agent or workflow lease
 *   is kept with operator-retain); a conflicting lease of any source is admitted, since resolve is the one act a conflict admits. An
 *   `ephemeral` lease on a box that cannot hold its tree refuses `box-unsupported`. The lease moves to `retained` and keeps its source
 *   and parent (D-7833).
 * - `foreign`: the lease is released with reason `foreign`, from any state but `transferring`, never gated on the box (D-7835).
 */
export function decideResolve(input: {
  target: LeaseDoorTarget; action: 'attach' | 'foreign'; parent: string | null;
  checkpoint: Pick<DelegationCheckpointV1, 'leases' | 'leaseCarriers' | 'attempts'>;
  conflicting: ReadonlySet<string>; boxHolds: boolean; carrierRequired: boolean;
  liveParent: (id: string) => { incarnation: string } | null;
}): ResolveAnswer {
  const found = leaseOfTarget(input.checkpoint, input.target);
  if ('ok' in found) return found;
  const lease = found;
  const gone = known(lease, 'resolve');
  if (gone !== null) return gone;
  const carrier = (input.checkpoint.leaseCarriers ?? []).find((c) => c.leaseId === lease.leaseId);
  const k = delegationTreeKey(lease.project, lease.adminRecord);
  const newest = newestUnownedAttempts(input.checkpoint).get(k);
  const resolvesThrough = newest === undefined ? null : { attemptedAt: newest.attemptedAt, attemptId: newest.attemptId };
  if (input.action === 'foreign') {
    const d = decideLeaseRelease(lease, carrier, { expectGeneration: lease.generation });
    return d.ok ? { ok: true, act: 'release', leaseId: lease.leaseId, expectGeneration: lease.generation, resolvesThrough } : no(doorRefusal(d.refusal), d.detail);
  }
  if (input.parent !== lease.parentId) {
    return no('not-lease-parent', `resolve: lease ${lease.leaseId} is attached to its own parent ${lease.parentId} only; it is never re-parented`);
  }
  if (input.liveParent(input.parent) === null) {
    return no('not-live-parent', `resolve: ${input.parent} is not a live session with a measured incarnation`);
  }
  if (!input.conflicting.has(k) && lease.sourceKind !== 'raw') {
    return no('wrong-disposition', `resolve: lease ${lease.leaseId} is a linked ${lease.sourceKind} lease with no conflict; keep it with operator-retain`);
  }
  if (!input.boxHolds && delegationCarrierStateOf(lease, carrier) === 'ephemeral') {
    return no('box-unsupported', `resolve: the fleet box cannot hold lease ${lease.leaseId}'s tree (it lacks the carrier mark, its lock or the orphan rung)`);
  }
  const d = decideLeaseTransition(lease, carrier, { reason: 'attach', expectGeneration: lease.generation, carrierRequired: input.carrierRequired });
  return d.ok ? { ok: true, act: 'transition', leaseId: lease.leaseId, reason: 'attach', expectGeneration: lease.generation, resolvesThrough }
    : no(doorRefusal(d.refusal), d.detail);
}

/** The words this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`: the lease doors' refusals (`shared/api.ts`'s one
 *  table, read and never re-spelled) and the operator-retain reason, the lease table's own word. */
export const isDelegationLeaseActsKebab = (tok: string): boolean => isLeaseDoorRefusal(tok) || tok === 'operator-retain';
