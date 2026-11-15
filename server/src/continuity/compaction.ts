// L1, context C3 (Session Conversation): `compactInstructionsFor`, the compaction text a session's role carries
// (Overlord spec §3.3.9, C51; the plan is `docs/superpowers/plans/2026-11-10-overlord/w1a-compaction.md`, Task 1).
// Pure: it reads the L0 role table and nothing else.
//
// The text is a column of `FLEET_ROLES` (`shared/fleetRoles.ts`), one source with two carriers: ccd's auto-compact
// types `/compact <text>` and history W3's one PreCompact print carries it as a section (C53). Both read it from the
// launch-profile projection, `ccd/lib/launch-profiles.json`'s `compactText`, which
// `server/test/launch-profiles-file.test.ts` holds equal to this answer for every role.
import { FLEET_ROLES, type FleetRole } from '../../../shared/fleetRoles.js';

/** The role's compaction instructions: one line, total over `FleetRole`. `auditor` and `replay` answer `plain`'s. */
export function compactInstructionsFor(role: FleetRole): string {
  return FLEET_ROLES[role].compactInstructions;
}
