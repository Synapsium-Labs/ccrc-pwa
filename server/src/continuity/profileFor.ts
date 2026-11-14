// L1, context C3 (Session Conversation): `profileFor`, the launch-profile route a session's next launch should carry
// (Overlord spec §3.6 H1, §3.3.7 H14, §3.3.4 C39; the plan is `docs/superpowers/plans/2026-11-10-overlord/w1a-launch-profiles.md`,
// Task 5). Pure: the role reading, the Settings row's choice, the measured window and the `continuity` row's state arrive
// as arguments, and the answer is the four route fields the profile lane diffs against the route it read.
//
// AN UNDECIDED READING TAKES THE MEMBER THAT DOES LESS (C49): `worker-or-reviewer` reads `worker`, `coordinator-or-plain`
// reads `plain`. Written out here, never `ROLE_AMBIGUITIES[x][0]`, whose order is the view's (its first member of
// `coordinator-or-plain` is `coordinator`, the member that does more).
//
// COMPACTION FOLLOWS CONTINUITY (the plan's `compaction-follows-continuity`): `compact` and `compactwindow` are numbers
// only while the `continuity` row is live and the role's profile has a compaction column; otherwise both are null, which
// the lane reads as "leave the route alone".
import { FLEET_ROLES, type FleetRole } from '../../../shared/fleetRoles.js';
import { PLAIN_AUTO_MEMORY_DEFAULT, isPlainAutoMemoryChoice, type PlainAutoMemoryChoice } from '../../../shared/plainAutoMemory.js';
import type { RoleAmbiguity, RoleReading } from '../roleOf.js';
import { compactThresholdFor } from './launchProfile.js';

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
}

export function profileFor(reading: RoleReading, plainAutoMemory: 'on' | 'off', windowTokens: number | null,
  continuityLive: boolean): ProfileRoute {
  const profile = reading.kind === 'role' ? reading.role : PROFILE_OF_UNDECIDED[reading.between];
  const row = FLEET_ROLES[profile].launchProfile;
  const automem = row.autoMemory === 'switch' ? plainAutoMemory : 'off';
  const t = continuityLive ? compactThresholdFor(row, windowTokens) : null;
  return { profile, automem, compact: t === null ? null : t.pct, compactwindow: t === null ? null : t.windowTokens };
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
