// L1, context C3 (Session Conversation): `profileFor`, the launch-profile route a session's next launch should carry
// (Overlord spec §3.6 H1, §3.3.7 H14, §3.3.4 C39; the plan is `docs/superpowers/plans/2026-11-10-overlord/w1a-launch-profiles.md`,
// Task 5). Pure: the role reading, the Settings row's choice, the measured window and the `continuity` row's state arrive
// as arguments, and the answer is the four route fields the profile lane diffs against the route it read.
//
// AN UNDECIDED READING TAKES THE MEMBER THAT DOES LESS (C49): `worker-or-reviewer` reads `worker`, `coordinator-or-plain`
// reads `plain`. Written out here, never `ROLE_AMBIGUITIES[x][0]`, whose order is the view's (its first member of
// `coordinator-or-plain` is `coordinator`, the member that does more). The lane never passes `coordinator-or-plain`: it skips
// a session whose role it cannot decide (review 2024 F2), so only `worker-or-reviewer` reaches this rule from it.
//
// COMPACTION FOLLOWS CONTINUITY (the plan's `compaction-follows-continuity`): `compact` and `compactwindow` are numbers
// only while the `continuity` row is live and the role's profile has a compaction column; otherwise both are null, which
// the lane reads as "leave the route alone".
import { FLEET_ROLES, type FleetRole } from '../../../shared/fleetRoles.js';
import { PLAIN_AUTO_MEMORY_DEFAULT, isPlainAutoMemoryChoice, type PlainAutoMemoryChoice } from '../../../shared/plainAutoMemory.js';
import type { ChildReclaimGeneration } from '../../../shared/api.js';
import type { RoleAmbiguity, RoleReading } from '../roleOf.js';
import type { BuildAgreement } from '../../../shared/api.js';
import { compactThresholdFor, launchDigestOf } from './launchProfile.js';

/** The member of each undecided reading that does less (C49). */
export const PROFILE_OF_UNDECIDED: Readonly<Record<RoleAmbiguity, FleetRole>> = {
  'worker-or-reviewer': 'worker',
  'coordinator-or-plain': 'plain',
};

/** The route fields the profile lane writes, as values (the lane spells them as route words). */
export interface ProfileRoute {
  /** The `FLEET_ROLES` row the spawn applies (route field `profile`). */
  readonly profile: FleetRole;
  /** Auto memory (route field `automem`): `off` for every role whose profile says `off`; the Settings row's choice for a
   *  role whose profile says `switch` (`plain`). */
  readonly automem: 'on' | 'off';
  /** ccd's own compact threshold in percent of the window (route field `compact`), or null: leave the route alone. */
  readonly compact: number | null;
  /** Claude Code's auto-compact window in tokens (route field `compactwindow`), or null: leave the route alone. */
  readonly compactwindow: number | null;
  /** The expected digest of the row (route field `profiledigest`, Overlord W1 sandbox Task 2): `launchDigestOf(profile)` for a
   *  role whose profile has a surface, absent for every other. ccd refuses the spawn when the row it reads does not hash to
   *  it, so the field, never a role word, makes a spawn fail closed (slug `expected-digest-rides-the-route`). */
  readonly profiledigest?: string;
}

export function profileFor(reading: RoleReading, plainAutoMemory: 'on' | 'off', windowTokens: number | null,
  continuityLive: boolean): ProfileRoute {
  const profile = reading.kind === 'role' ? reading.role : PROFILE_OF_UNDECIDED[reading.between];
  const row = FLEET_ROLES[profile].launchProfile;
  const automem = row.autoMemory === 'switch' ? plainAutoMemory : 'off';
  const t = continuityLive ? compactThresholdFor(row, windowTokens) : null;
  const base = { profile, automem, compact: t === null ? null : t.pct, compactwindow: t === null ? null : t.windowTokens };
  return row.surface === null ? base : { ...base, profiledigest: launchDigestOf(profile) };
}

/** What the lane does to `profiledigest` this pass (Overlord W1 sandbox Task 2, question 5 ruled in fix round 2: never kill what
 *  cannot be respawned). `write` the target only while the fleet node's measured build equals the server's, so the field never
 *  leads the row the fleet box has installed; `hold` (send nothing for the field) while they differ or the inventory is
 *  unmeasured, so a rollout's skew keeps the old value; `clear` (an empty value) when the role has no surface and the field
 *  stands; `none` otherwise. A row whose field never stood is never sent a clear, so an older ccd sees nothing new. */
export type ProfileDigestWrite =
  | { readonly act: 'write'; readonly value: string }
  | { readonly act: 'hold' | 'clear' | 'none' };

export function profileDigestWriteOf(target: string | undefined, standing: string | undefined,
  builds: BuildAgreement): ProfileDigestWrite {
  if (target === undefined) return standing !== undefined ? { act: 'clear' } : { act: 'none' };
  if (standing === target) return { act: 'none' };
  return builds === 'agreed' ? { act: 'write', value: target } : { act: 'hold' };
}

/** The Settings row "Auto memory for plain sessions" as the store read it: a row, no row, or a read that failed, never one
 *  `null` (`CoordStore.plainAutoMemorySettings`). */
export type PlainAutoMemoryRead =
  | { readonly kind: 'row'; readonly choice: unknown }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** The setting: a stored choice through the one narrowing; a lost row is the default (H14: off). A failed read, or a word
 *  this build does not know, is null: the lane writes no `automem` from it. */
export function plainAutoMemoryOf(r: PlainAutoMemoryRead): PlainAutoMemoryChoice | null {
  if (r.kind === 'absent') return PLAIN_AUTO_MEMORY_DEFAULT;
  if (r.kind === 'unreadable') return null;
  return isPlainAutoMemoryChoice(r.choice) ? r.choice : null;
}

/** The lane's declared intent for one session, from the ONE reader of that fact (`intentOfCheckpoint`, in
 *  `declaredIntent.ts`, shared byte for byte with card PR B #2793; review 2024 F2): a registry row with no incarnation declared
 *  none (the card's fold); an incarnation that could not be read, or a checkpoint not ready, is unmeasured, and the lane then
 *  skips the row (the card renders it unmeasured: each keeps its own fold). */
export function declaredIntentOf(incarnation: ChildReclaimGeneration, readCheckpoint: (id: string, incarnation: string) =>
  boolean | 'not-ready', id: string): boolean | 'unmeasured' {
  if (incarnation.kind === 'absent') return false;
  if (incarnation.kind === 'unreadable') return 'unmeasured';
  const r = readCheckpoint(id, incarnation.v);
  return r === 'not-ready' ? 'unmeasured' : r;
}
