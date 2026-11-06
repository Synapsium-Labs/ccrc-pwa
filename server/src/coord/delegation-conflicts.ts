// Delegation broker wave 5, PR8 (Task 5.8.1): the ONE derivation of a tree's newest unowned-work attempt (D-7820, D-7822).
//
// THIS MODULE IS L1. It imports the pure model, the policy's one classifier of unowned work and the correlation module's tree key,
// and nothing else: no filesystem, no store, no clock. The projection reads it, and so does every wave-5 decider, so the frame and the
// acts never disagree about which attempt is a tree's newest.
import type { DelegationAttemptRow, DelegationCheckpointV1 } from './delegation-model.js';
import { isUnownedWorkReason } from './delegation-policy.js';
import { delegationTreeKey } from './delegation-correlation.js';

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
