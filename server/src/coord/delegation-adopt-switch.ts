// Delegation broker wave 5 PR8b (D-8113, D-8114). L1, pure: the adoption switch's refusal rule, the door's view, and the bounded
// list of worktrees a pass would keep. No I/O and no clock: the route (`routes.ts`, L4) reads the listing, the caps and the lane's
// health, hands them here, and acts on the answer; the adoption step (`delegationAdoptStep.ts`, L4) hands its pass's kept leases.
// Nothing here changes what adoption keeps or when (the decider is `delegation-adoption.ts`, unchanged in behaviour; FR1 exports its
// `definite`).
import { DELEGATION_ADOPTION_KEEPS_MAX, type DelegationAdoptionHealth, type DelegationAdoptionKeep, type DelegationAdoptionKeeps,
  type LeaseAuditAnswer } from '../../../shared/api.js';
import type { DelegationAdoptCap, DelegationAdoptOnRefusal, DelegationAdoptRefusal, DelegationAdoptView } from '../../../shared/delegation-adopt.js';
import { DELEGATION_ADOPT_MARKER, readSwitches } from '../../../shared/switches.js';
import { CCD_ARGV, LEASE_AUDIT_CAP } from '../ccdargv.js';
import { definite } from './delegation-adoption.js';
import type { DelegationLeaseRow } from './delegation-model.js';

/** The two capabilities the door reads from the fleet box's measured `ccd caps` (`FleetState.ccdVerbs`): the switch's verb, and the
 *  read-only audit. `null` is a list that did not read, and answers `unmeasured` for both, never `absent`. */
export interface DelegationAdoptCaps { readonly verb: DelegationAdoptCap; readonly audit: DelegationAdoptCap }

/** The verb's own name, read off its builder so it is not a second spelling (`verb-gate.test.ts` holds the row's token to it). */
const VERB = CCD_ARGV.delegationAdopt('off')[0];

export function delegationAdoptCapsOf(ccdVerbs: readonly string[] | null): DelegationAdoptCaps {
  if (ccdVerbs === null) return { verb: 'unmeasured', audit: 'unmeasured' };
  const has = (token: string): DelegationAdoptCap => (ccdVerbs.includes(token) ? 'present' : 'absent');
  return { verb: has(VERB), audit: has(LEASE_AUDIT_CAP) };
}

/**
 * THE RULE (D-8113): what a tap of `on` or `off` is refused with, or null. `signedIn` is measured by the route: sign-in is armed and
 * the caller holds a session (the collect-lane door's own condition). `on` is refused first when the caller is not a signed-in
 * operator (`sign-in-unarmed`, review 1659 F2: arming fleet-wide adoption needs one, as arming unattended deletion does), then when
 * the caps did not read, when the fleet box's ccd has no switch verb, or when it lacks `lease-audit-v1` (without the audit, a box
 * that holds trees keeps every finished worktree without checking it, D-8057). `off` is refused only when the verb is missing,
 * signed in or not: a list that did not read lets `off` through, because turning adoption off is the safe direction. Sent to a box
 * whose ccd lacks the verb after all (its caps unread), `off` fails with ccd's own usage error, which the route answers as
 * `fleetFailed`, and the marker is as it was.
 */
export function delegationAdoptRefusal(caps: DelegationAdoptCaps, on: false, signedIn: boolean): DelegationAdoptRefusal | null;
export function delegationAdoptRefusal(caps: DelegationAdoptCaps, on: boolean, signedIn: boolean): DelegationAdoptOnRefusal | null;
export function delegationAdoptRefusal(caps: DelegationAdoptCaps, on: boolean, signedIn: boolean): DelegationAdoptOnRefusal | null {
  if (!on) return caps.verb === 'absent' ? 'fleet-switch-missing' : null;
  const unsigned = delegationAdoptSignInRefusal(on, signedIn);
  if (unsigned !== null) return unsigned;
  if (caps.verb === 'unmeasured' || caps.audit === 'unmeasured') return 'fleet-caps-unmeasured';
  if (caps.verb === 'absent') return 'fleet-switch-missing';
  if (caps.audit === 'absent') return 'fleet-audit-missing';
  return null;
}

/** THE RULE's sign-in arm, on its own (review 1665 N8): `on` from a caller that is not a signed-in operator is `sign-in-unarmed`;
 *  `off` never is. The route asks it BEFORE any I/O, as the collect-lane door does, and `delegationAdoptRefusal` asks it too: one
 *  definition. */
export function delegationAdoptSignInRefusal(on: boolean, signedIn: boolean): 'sign-in-unarmed' | null {
  return on && !signedIn ? 'sign-in-unarmed' : null;
}

/** The door's view of one registry listing (null: unlisted), one caps list (null: unread) and the lane's last pass, for a caller
 *  that is (`signedIn`) or is not a signed-in operator. */
export function delegationAdoptViewOf(listing: readonly string[] | null, ccdVerbs: readonly string[] | null,
  adoption: DelegationAdoptionHealth | null, signedIn: boolean): DelegationAdoptView {
  const caps = delegationAdoptCapsOf(ccdVerbs);
  return { state: readSwitches(listing)[DELEGATION_ADOPT_MARKER], caps,
    refused: { on: delegationAdoptRefusal(caps, true, signedIn), off: delegationAdoptRefusal(caps, false, signedIn) }, adoption };
}

/**
 * The bounded list (D-8114): the worktrees a pass would keep (its `would-adopt` decisions) or kept (its applied `adopt`s), in decision
 * order, at most `DELEGATION_ADOPTION_KEEPS_MAX` named and the rest counted. `changes` is what the audit fed to the decider measured,
 * only when that answer is a DEFINITE one, the decider's own predicate (`delegation-adoption.ts#definite`: it read, and `changed` is
 * true or false); an unsupported or refused audit, or one that read with `changed: 'unmeasured'`, names none (review 1659 F1).
 * Null when none was kept.
 */
export function adoptionKeepsOf(kept: readonly { readonly lease: DelegationLeaseRow; readonly audit: LeaseAuditAnswer | 'unsupported' | undefined }[]):
  DelegationAdoptionKeeps | null {
  if (kept.length === 0) return null;
  const items = kept.slice(0, DELEGATION_ADOPTION_KEEPS_MAX).map(({ lease, audit }): DelegationAdoptionKeep => ({
    project: lease.project, worktree: lease.adminRecord, parent: lease.parentId,
    ...(audit !== undefined && audit !== 'unsupported' && definite(audit)
      ? { changes: { dirty: audit.dirty, aheadOfBase: audit.aheadOfBase, branchAheadOfBase: audit.branchAheadOfBase } } : {}),
  }));
  return { items, more: kept.length - items.length };
}
