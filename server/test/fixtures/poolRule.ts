// The pool fixtures every language's copy of the pool machinery is driven
// through. Two exports with two different jobs, in one file because they are
// one subject:
//
//  - `POOLED_TEST_ROSTER` — `DEFAULT_TEST_ROSTER` with pool tags, DERIVED from
//    it rather than retyped, so an account added to or renamed in the root test
//    roster cannot leave a stale copy here. `server/test/helpers.ts`'s docstring
//    states the rule this obeys: that roster is ROOT, and the only other copies
//    are derived from it.
//  - `POOL_RULE_CASES` (added by wave 1's Task 5) — the truth table of the rule
//    itself.
//
// Pool names here are `pool-a` / `pool-b` / `pool-ab`, and account ids are the
// test roster's. No operator's real pool name, account name or label appears in
// this repository at all (spec §8, "Single definition"); `topology-clean.test.ts`
// is what keeps that true.
import { DEFAULT_TEST_ROSTER } from '../helpers.js';

/** Which fixture accounts carry a tag. Two accounts share `pool-a` on purpose —
 *  a pool of one cannot tell "the rule picked the in-pool account" from "the
 *  rule picked the only account left". `gpt` and `claude-d` are absent from this
 *  map, so they stay untagged, which is the state every account on a live box is
 *  in on the day pools ship. */
const POOL_BY_ID: Readonly<Record<string, string | undefined>> = {
  claude: 'pool-a',
  'claude-a': 'pool-a',
  'claude-b': 'pool-b',
};

/**
 * `DEFAULT_TEST_ROSTER`, tagged. Raw JSON shape, not a parsed `Roster`: it is
 * fed to `parseRoster`, `seedRoster` and `seedAccountsSh`, all of which take
 * `unknown` and do their own parsing, so this is the same kind of value the
 * roster on disk is.
 *
 * An untagged account gets NO `pool` KEY, rather than `pool: null` — the parser
 * refuses a written `null` (`AccountDef.pool`), and a fixture that could not be
 * written by hand into `~/.ccrc/accounts.json` is not a fixture of anything.
 */
export const POOLED_TEST_ROSTER = {
  ...DEFAULT_TEST_ROSTER,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) => {
    const pool = POOL_BY_ID[a.id];
    return pool === undefined ? { ...a } : { ...a, pool };
  }),
};
