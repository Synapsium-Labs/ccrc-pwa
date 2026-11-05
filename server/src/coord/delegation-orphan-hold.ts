// Delegation broker wave 5, PR4 (Task 5.4.3): the orphan-tree lane's server skip (D-7002, D-7811, D-7828, D-7850; O5-1 (a)).
//
// This file is L1: pure, no I/O, no clock (it is fed `nowMs`). The orphan lane's executor (`collectOrphanTree`) asks it, through
// the beat's `leaseHold`, after the audit and before the licence, and composes no removal for a tree it answers `held` or
// `not-ready`. It closes the window between "the journal says a tree is kept" and "the carrier says so", which the box rung
// (`ccd/lib/delegation-lease.sh#_dl_orphan_rung`) cannot see. It has no marker and no switch: disabling it is the wrong
// safety direction.
import type { DelegationCarrierState } from '../../../shared/api.js';
import { parseDelegationInstant, type DeepReadonly, type DelegationCheckpointV1, type DelegationLeaseRow } from './delegation-model.js';

/** The server keeps skipping for one hour past a hold's expiry (clock skew; D-7794), as the box rung does (`__DL_HOLD_MARGIN_S`). */
export const DELEGATION_ORPHAN_HOLD_MARGIN_MS = 3_600_000;
/** O5-1 (a): the carrier states that hold a tree back from the orphan lane; `transferring` holds without an expiry. */
export const DELEGATION_ORPHAN_HELD_STATES = ['adopted', 'retained', 'transferring'] as const satisfies readonly DelegationCarrierState[];

export type OrphanLeaseHold =
  | { kind: 'free' }
  | { kind: 'held'; leaseId: string; state: DelegationCarrierState; until: string | null }
  | { kind: 'not-ready'; detail: string };

/** The orphan classes (`_ws_orphan_class`'s words) whose tree WAITS while the checkpoint is not ready. Every audited class, `ccd-root`
 *  included, is looked up in a READY checkpoint (a raw lease can sit at a `ccd-root` path, D-7811); only this set's `not-ready` stops. */
export const DELEGATION_UNREADY_HOLD_CLASSES = ['claude', 'superpowers'] as const;

const HELD: readonly string[] = DELEGATION_ORPHAN_HELD_STATES;
const UNREADY: readonly string[] = DELEGATION_UNREADY_HOLD_CLASSES;

export function orphanLeaseHold(input: {
  /** null: no applier, or one not `ready`. */
  checkpoint: DeepReadonly<DelegationCheckpointV1> | null;
  heldStateOf: (lease: DeepReadonly<DelegationLeaseRow>, cp: DeepReadonly<DelegationCheckpointV1>) => DelegationCarrierState;
  /** The tree's exact path, compared byte for byte with `canonicalPath` (D-7850); `orphanClass` is the census row's `cls`, or null
   *  when the lane holds no row for the tree, which waits as an unready class does (never a class this frees). */
  path: string; orphanClass: string | null; nowMs: number;
}): OrphanLeaseHold {
  const { checkpoint: cp, path, orphanClass, nowMs } = input;
  if (cp === null) {
    if (orphanClass === null) return { kind: 'not-ready', detail: 'the delegation checkpoint is not ready, and this tree\'s class is unknown' };
    return UNREADY.includes(orphanClass)
      ? { kind: 'not-ready', detail: `the delegation checkpoint is not ready, so whether a lease holds this ${orphanClass} tree is unknown` }
      : { kind: 'free' };
  }
  const lease = cp.leases.find((l) => l.releasedAt === null && l.canonicalPath === path);
  if (lease === undefined) return { kind: 'free' };
  const state = input.heldStateOf(lease, cp);
  if (!HELD.includes(state)) return { kind: 'free' };
  if (state === 'transferring') return { kind: 'held', leaseId: lease.leaseId, state, until: null };
  const until = lease.cleanupDueAt;
  let dueMs: number;
  try {
    if (until === null) throw new Error('no expiry');
    dueMs = parseDelegationInstant(until);
  } catch {
    return { kind: 'not-ready', detail: `lease ${lease.leaseId} holds this tree (${state}) with no readable expiry` };
  }
  return nowMs <= dueMs + DELEGATION_ORPHAN_HOLD_MARGIN_MS ? { kind: 'held', leaseId: lease.leaseId, state, until } : { kind: 'free' };
}
