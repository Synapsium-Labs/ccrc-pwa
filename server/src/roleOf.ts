import type { ChildMark, RunKind, SessionRole } from '../../shared/api.js';
import { FLEET_ROLES, type FleetRole } from '../../shared/fleetRoles.js';

/** L1 policy, context C3 (Session Conversation): decides a fleet session's role from measured facts, with no
 *  I/O. The table it reads is `FLEET_ROLES` (L0); the decision order is Overlord design spec §3.3.9
 *  (`docs/superpowers/specs/2026-11-09-overlord-design.md`), Table 3.3.9a plus its typed undecided answers.
 *  An unmeasured fact is never read as `no`: it yields an undecided reading naming the two roles it cannot
 *  tell apart. */
export type RoleFactWord = 'yes' | 'no' | 'unmeasured';

export interface RoleFacts {
  /** §3.1: the designation naming this session. No reader before W1, so callers pass 'none'. */
  readonly designation: 'none' | 'pending' | 'live';
  /** §9.5: a row the audit lane wrote for this session. No lane before its wave: false. */
  readonly auditBody: boolean;
  /** §9.5: a row the replay lane wrote for this session. No lane before its wave: false. */
  readonly replayBody: boolean;
  readonly child: ChildMark;
  /** The kind of the run `child.runId` names; 'unmeasured' when not read. Read only when child.kind is 'child'. */
  readonly childRunKind: RunKind | 'unmeasured';
  /** `claimedBy` on a run that is not terminal (`openCoordinatorIds`' question). */
  readonly claimsOpenRun: RoleFactWord;
  /** Declared coordinator intent on the current incarnation (`deriveCoordinatorIntentByParent`'s question). */
  readonly declaredIntent: RoleFactWord;
}

export const ROLE_AMBIGUITIES = {
  'worker-or-reviewer': ['worker', 'reviewer'],
  'coordinator-or-plain': ['coordinator', 'plain'],
} as const satisfies Record<string, readonly FleetRole[]>;

export type RoleAmbiguity = keyof typeof ROLE_AMBIGUITIES;

export type RoleReading =
  | { readonly kind: 'role'; readonly role: FleetRole }
  | { readonly kind: 'undecided'; readonly between: RoleAmbiguity };

const is = (role: FleetRole): RoleReading => ({ kind: 'role', role });
const between = (a: RoleAmbiguity): RoleReading => ({ kind: 'undecided', between: a });

export function roleOf(f: RoleFacts): RoleReading {
  if (f.designation === 'pending' || f.designation === 'live') return is('overlord');
  if (f.auditBody) return is('auditor');
  if (f.replayBody) return is('replay');
  if (f.child.kind === 'unreadable') return between('worker-or-reviewer');
  if (f.child.kind === 'child') {
    if (f.childRunKind === 'work') return is('worker');
    if (f.childRunKind === 'review') return is('reviewer');
    return between('worker-or-reviewer');
  }
  if (f.claimsOpenRun === 'yes' || f.declaredIntent === 'yes') return is('coordinator');
  if (f.claimsOpenRun === 'no' && f.declaredIntent === 'no') return is('plain');
  return between('coordinator-or-plain');
}

/** The view: the role's `sessionRole` column; an undecided reading reads its first member's (all members agree). */
export function sessionRoleOfReading(r: RoleReading): SessionRole {
  const role = r.kind === 'role' ? r.role : ROLE_AMBIGUITIES[r.between][0];
  return FLEET_ROLES[role].sessionRole;
}

/** THE ONE DERIVATION of the role, from the registry's reading of `.child` and
 *  nothing else. `unreadable` is a child: the marker file exists, which is what
 *  the start card (`session-hook.sh`'s `_hook_role_card`) tests, so the badge
 *  and the card agree on the `.child` axis, and ONLY that axis: a session whose
 *  `.child` exists, parsed or not, is a child to both, and a dispatched child is
 *  never told, or shown, that it coordinates. The card has further silences the
 *  badge does not read: a held row (`$REG/<id>.hold`), the card-off switch, and
 *  a `resume`/`fork` start. So a held row with no `.child` shows the coordinator
 *  badge although it was never given the card; both are as spec §8 asks. */
export const sessionRoleOf = (child: ChildMark): SessionRole => (child.kind === 'none' ? 'coordinator' : 'child');
