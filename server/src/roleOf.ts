import type { ChildMark, RunKind, SessionRole } from '../../shared/api.js';
import { FLEET_ROLES, type FleetRole } from '../../shared/fleetRoles.js';
import type { DesignationRead, PendingKind } from '../../shared/overlord-designation.js';

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

/** What the fleet frame measures for the role today: the `.child` axis only. The designation and the lanes have no
 *  reader before their waves; claim and intent are not read on this path, so they are 'unmeasured'. */
export const ROLE_FACTS_CHILD_AXIS: Omit<RoleFacts, 'child'> = {
  designation: 'none', auditBody: false, replayBody: false,
  childRunKind: 'unmeasured', claimsOpenRun: 'unmeasured', declaredIntent: 'unmeasured',
};

/** THE ONE DERIVATION of the wire's role, from the registry's reading of `.child` and nothing else: the
 *  `SessionRole` column of `roleOf` over the child axis (`ROLE_FACTS_CHILD_AXIS`). `none` reads undecided
 *  coordinator-or-plain, whose view is `coordinator`; `child` (its run kind not measured here) and `unreadable` read
 *  undecided worker-or-reviewer, whose view is `child`. `unreadable` is a child: the marker file exists, which is
 *  what the start card (`session-hook.sh`'s `_hook_role_card`) tests, so the badge
 *  and the card agree on the `.child` axis, and ONLY that axis: a session whose
 *  `.child` exists, parsed or not, is a child to both, and a dispatched child is
 *  never told, or shown, that it coordinates. The card has further silences the
 *  badge does not read: a held row (`$REG/<id>.hold`), the card-off switch, and
 *  a `resume`/`fork` start. So a held row with no `.child` shows the coordinator
 *  badge although it was never given the card; both are as spec §8 asks. */
export const sessionRoleOf = (child: ChildMark): SessionRole =>
  sessionRoleOfReading(roleOf({ ...ROLE_FACTS_CHILD_AXIS, child }));

/** What a caller reads about one session, before it is assembled into `RoleFacts`. */
export interface RoleFactInputs {
  /** The registry record's child mark, as read. */
  readonly child: ChildMark;
  /** The kind of the run the child mark names. Read only when `child.kind` is 'child'. */
  readonly childRunKind: RunKind | 'unmeasured';
  /** The ids that claim a run that is not terminal (`openCoordinatorIds`), or 'unmeasured'. */
  readonly openCoordinators: ReadonlySet<string> | 'unmeasured';
  /** Declared coordinator intent on the current incarnation, or 'unmeasured'. */
  readonly intentDeclared: boolean | 'unmeasured';
  /** The designation as the caller read it this pass (`designationFactFrom`). */
  readonly designation: DesignationFact;
}

/** The designation as one caller read it this pass: no row, or the ids it binds. An unmeasured read never reaches
 *  here: the caller fails closed first (plan 2026-11-14 w1-designation Task 3, "What an unmeasured designation does"). */
export type DesignationFact = { readonly kind: 'none' }
  | { readonly kind: 'row'; readonly live: string | null; readonly pending: string | null;
      readonly pendingKind: PendingKind | null; readonly term: number };

/** `pending` when the id is the pending attempt, `live` when it is the binding, `none` otherwise. */
export function designationFactOf(sessionId: string, d: DesignationFact): RoleFacts['designation'] {
  if (d.kind === 'none') return 'none';
  if (d.pending === sessionId) return 'pending';
  if (d.live === sessionId) return 'live';
  return 'none';
}

/** The Overlord's identity word: the generation identity `identityOf` answers for its body, the setter of the role's timers
 *  and the recipient of their mail (Overlord W1, the Overlord's timers). One spelling: a reserved id, never a session's. */
export const OVERLORD_IDENTITY = 'overlord';

/** X5: the generation identity of a session. `overlord` for the live bound id, and for the pending id of a
 *  `designate` attempt; the session id for everything else, a rebind's pending body included. */
export function identityOf(sessionId: string, d: DesignationFact): string {
  if (d.kind === 'none') return sessionId;
  if (d.live === sessionId) return OVERLORD_IDENTITY;
  if (d.pending === sessionId && d.pendingKind === 'designate') return OVERLORD_IDENTITY;
  return sessionId;
}

/** The one narrowing of a `DesignationRead` to what the deciders read; `'unmeasured'` is the caller's to fail closed on. */
export function designationFactFrom(r: DesignationRead): DesignationFact | 'unmeasured' {
  if (r.kind === 'unmeasured') return 'unmeasured';
  const row = r.row;
  if (r.kind === 'not-designated' && row === null) return { kind: 'none' };
  return {
    kind: 'row', live: r.kind === 'designated' ? r.sessionId : null,
    pending: row?.pending?.sessionId ?? null, pendingKind: row?.pending?.kind ?? null,
    term: r.kind === 'designated' ? r.term : row?.term ?? 0,
  };
}

const word = (v: boolean | 'unmeasured'): RoleFactWord => (v === 'unmeasured' ? 'unmeasured' : v ? 'yes' : 'no');

/** THE ONE DECIDER of "this session claims an open run" (`RoleFacts.claimsOpenRun`): its id among the open claimants
 *  (`openCoordinatorIds`), or 'unmeasured' when they could not be read, never `no`. `roleFactsOf` and the linking suggest
 *  gate (`suggesterVerdict`, D-8808, review 2997 A4) both decide it here, so the role and the gate cannot disagree. Pure. */
export function claimsOpenRunOf(sessionId: string, openCoordinators: ReadonlySet<string> | 'unmeasured'): RoleFactWord {
  return openCoordinators === 'unmeasured' ? 'unmeasured' : word(openCoordinators.has(sessionId));
}

/** THE ONE ASSEMBLY of a session's `RoleFacts` (Overlord W1a, renewal deciders Task 0): every lane that asks `roleOf`
 *  about a session builds its facts here. Pure. `auditBody` and `replayBody` are fixed (false, false) until their waves bring readers; an unmeasured input stays unmeasured, never `no`. */
export function roleFactsOf(sessionId: string, i: RoleFactInputs): RoleFacts {
  return {
    designation: designationFactOf(sessionId, i.designation), auditBody: false, replayBody: false,
    child: i.child,
    childRunKind: i.child.kind === 'child' ? i.childRunKind : 'unmeasured',
    claimsOpenRun: claimsOpenRunOf(sessionId, i.openCoordinators),
    declaredIntent: word(i.intentDeclared),
  };
}
