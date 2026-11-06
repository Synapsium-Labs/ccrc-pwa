// Delegation broker wave 5, PR8 (Task 5.8.1): the ONE derivation of a tree's newest unowned-work attempt (D-7820, D-7822).
//
// THIS MODULE IS L1. It imports the pure model, the policy's one classifier of unowned work, the correlation module's tree key and
// the lease table's attempt ordering, and nothing else: no filesystem, no store, no clock. The projection reads it, and so does every
// wave-5 decider, so the frame and the acts never disagree about which attempt is a tree's newest, which tree is in conflict, or which
// tree the operator said is not delegation's.
//
// Correlation does NOT read `conflictingTreeKeys`: it keeps `delegation-policy.ts#groundOf`'s `finalConflicts` (every tree with ANY
// `conflicting` attempt ever recorded), legitimately different in the opposite safety direction (D-7821). `finalConflicts` is
// correlation's input guard, which never records another attempt or requests a lease on a tree once seen conflicting; this module's
// `conflictingTreeKeys` is the act gate the operator's resolve opens. Since correlation records nothing more on such a tree, its newest
// attempt never changes after the conflict, so a resolve is final for that tree.
//
// The policy imports this module for `disownedTreeKeys`, and this module imports the policy for its classifier: each reads the other
// only inside function bodies, so the cycle evaluates nothing at module load.
import { delegationSha256Hex, type DelegationAttemptRow, type DelegationCheckpointV1 } from './delegation-model.js';
import { isUnownedWorkReason } from './delegation-policy.js';
import { delegationTreeKey } from './delegation-correlation.js';
import { attemptMarkAbove } from './delegation-lease-state.js';

/** The newest unowned-work attempt per tree (R59's one classifier), keyed by `delegationTreeKey`, by `attemptedAt` then `attemptId`.
 *  A tree is in conflict when ITS newest attempt is `conflicting`, so a lease suppressed for a conflict always leaves the tree an
 *  unowned row (D-7003). Moved, unchanged, out of `delegation-projection.ts#projectDelegation`. */
export function newestUnownedAttempts(cp: Pick<DelegationCheckpointV1, 'attempts'>): ReadonlyMap<string, DelegationAttemptRow> {
  const newest = new Map<string, DelegationAttemptRow>();
  for (const a of cp.attempts) {
    if ((a.verdict !== 'unresolved' && a.verdict !== 'conflicting') || !isUnownedWorkReason(a.detail ?? '')) continue;
    const k = delegationTreeKey(a.project, a.adminRecord);
    const held = newest.get(k);
    if (!held || held.attemptedAt < a.attemptedAt || (held.attemptedAt === a.attemptedAt && held.attemptId < a.attemptId)) newest.set(k, a);
  }
  return newest;
}

type Resolutions = Pick<DelegationCheckpointV1, 'leases' | 'leaseCarriers'>;

/** Whether attempt `a` is covered by an operator's resolution (D-7820): some lease on its tree, released or not, has a carrier row whose
 *  `resolvedThrough` is ordered at or above it (`attemptedAt`, then `attemptId`). */
export function resolvedAttemptCovered(cp: Resolutions, a: DelegationAttemptRow): boolean {
  const k = delegationTreeKey(a.project, a.adminRecord);
  const onTree = new Set(cp.leases.filter((l) => delegationTreeKey(l.project, l.adminRecord) === k).map((l) => l.leaseId));
  return (cp.leaseCarriers ?? []).some((c) => onTree.has(c.leaseId) && c.resolvedThrough !== null && !attemptMarkAbove(a, c.resolvedThrough));
}

/** The trees whose newest unowned-work attempt is `conflicting` and NOT covered by a resolution, keyed by `delegationTreeKey`: a
 *  conflicted tree is final until the operator resolves it (spec §5.4), and only resolve acts on it (D-7819). */
export function conflictingTreeKeys(cp: Pick<DelegationCheckpointV1, 'attempts'> & Resolutions): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [k, a] of newestUnownedAttempts(cp)) if (a.verdict === 'conflicting' && !resolvedAttemptCovered(cp, a)) out.add(k);
  return out;
}

/** One disowned tree's key: its project, admin record and creation base. A tree re-created with another creation base is a new tree. */
export const disownedTreeKey = (project: string, adminRecord: string, creationBase: string | null): string =>
  JSON.stringify([project, adminRecord, creationBase]);

/** Every tree the operator said is not delegation's (D-7822): each lease released `foreign` (its carrier row's `releaseReason`), keyed by
 *  `disownedTreeKey` with the lease's creation base. A lease released for another reason is not disowned. */
export function disownedTreeKeys(cp: Resolutions): ReadonlySet<string> {
  const foreign = new Set((cp.leaseCarriers ?? []).filter((c) => c.releaseReason === 'foreign').map((c) => c.leaseId));
  return new Set(cp.leases.filter((l) => l.releasedAt !== null && foreign.has(l.leaseId))
    .map((l) => disownedTreeKey(l.project, l.adminRecord, l.creationBase)));
}

/** The ONE spelling of a tree in a URL (D-7837): the SHA-256 hex of `delegationTreeKey`, carried as `tree-<64 hex>`. The box's
 *  `_dl_tree_key` hashes another identity and is never this form. */
export const delegationTreeTarget = (project: string, adminRecord: string): string => delegationSha256Hex(delegationTreeKey(project, adminRecord));
