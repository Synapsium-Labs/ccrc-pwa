import type { Roster } from './roster.js';

/**
 * Generates the body of `~/.ccrc/accounts.sh` from a parsed roster — no
 * provenance marker (Task 4's `shared/mark.mjs` adds that). See
 * `shared/generate.mjs` for the emitted shape and the escaping rules.
 */
export function generateAccountsSh(roster: Roster): string;
