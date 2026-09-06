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
import type { ProjectPoolWire } from '../../../shared/api.js';
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

// One-directional agreement check, at import: a `POOL_BY_ID` key naming no
// account in `DEFAULT_TEST_ROSTER` is not one more untagged account — the
// `.map` below looks a renamed or removed id up by `a.id` and gets `undefined`
// back, indistinguishable from a deliberate miss, so a stale key would
// silently cost `gen-accounts.test.ts`'s ACCEPT row one of its three
// `_ccrc_pool` arms with nothing to say so. The reverse direction needs no
// check: an id absent from `POOL_BY_ID` is meant to stay untagged, which is
// exactly what a miss here already means.
for (const id of Object.keys(POOL_BY_ID)) {
  if (!DEFAULT_TEST_ROSTER.accounts.some((a) => a.id === id)) {
    throw new Error(
      `poolRule: POOL_BY_ID names "${id}", which is not an account in ` +
        'DEFAULT_TEST_ROSTER (server/test/helpers.ts). Rename or remove this ' +
        'key, or POOLED_TEST_ROSTER silently stops tagging the intended account.',
    );
  }
}

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

/**
 * One row of the pool-rule truth table — the ONE definition of the rule's
 * cases. Today only `poolRule` (`shared/poolrule.ts`) is driven through these
 * rows, by this table's own suite (`pool-rule-core.test.ts`). It owes two more
 * callers: wave 3's server module and wave 4's PWA `splitByPool` are to
 * value-import it rather than re-deriving the rule. `ccd`'s bash `_pool_ok`
 * will be the OTHER spelling (wave 2a) — the two cannot share code across the
 * language boundary, so once it lands it will share these FIXTURES instead,
 * exactly as `fixtures/leastLoaded.ts` already does for the placement rule.
 * Until then, "either drifts, its own suite reds against these rows" names an
 * obligation on wave 2a, not machinery that exists yet.
 *
 * `expect` is deliberately a THIRD vocabulary rather than either
 * implementation's own: bash will answer rc 0/1/2 and TypeScript answers a
 * discriminated union, and writing the table in either idiom would quietly make
 * it that side's fixture with the other side translating. Mapping:
 *
 *   serve       -> bash rc 0   /  `{ ok: true }`
 *   mismatch    -> bash rc 1   /  `{ ok: false, reason: 'pool-mismatch' }`
 *   undecidable -> bash rc 2   /  `{ ok: false, reason: 'pool-undecidable' }`
 */
export interface PoolRuleCase {
  name: string;
  /** `null` = an untagged account, or one this side cannot see — see
   *  `poolRule`'s docstring for why those two are deliberately one value. */
  accountPool: string | null;
  project: ProjectPoolWire;
  expect: 'serve' | 'mismatch' | 'undecidable';
  /** Why this row is in the table, in one sentence — what breaks if it goes. */
  why: string;
}

export const POOL_RULE_CASES: readonly PoolRuleCase[] = [
  {
    name: 'both-untagged', accountPool: null, project: { state: 'untagged' }, expect: 'serve',
    why: 'ruling 3 — an untagged project is unconstrained, which is the behaviour every box has today',
  },
  {
    name: 'untagged-project-tagged-account', accountPool: 'pool-a', project: { state: 'untagged' }, expect: 'serve',
    why: 'tagging an ACCOUNT constrains nothing on its own; rollout step 2 depends on this row being true',
  },
  {
    name: 'untagged-project-other-tagged-account', accountPool: 'pool-b', project: { state: 'untagged' }, expect: 'serve',
    why: 'the same for a second pool name — the answer must not depend on which name',
  },
  {
    name: 'untagged-account-tagged-project', accountPool: null, project: { state: 'tagged', name: 'pool-a' }, expect: 'serve',
    why: 'an account with no pool serves any project — the second disjunct of the rule',
  },
  {
    name: 'same-pool-a', accountPool: 'pool-a', project: { state: 'tagged', name: 'pool-a' }, expect: 'serve',
    why: 'the names agree',
  },
  {
    name: 'same-pool-b', accountPool: 'pool-b', project: { state: 'tagged', name: 'pool-b' }, expect: 'serve',
    why: 'the names agree, for a second name — an implementation that hard-coded one pool passes the row above alone',
  },
  {
    name: 'mismatch-a-into-b', accountPool: 'pool-a', project: { state: 'tagged', name: 'pool-b' }, expect: 'mismatch',
    why: 'the refusal ruling 4 makes overridable only by an explicit, separate flag',
  },
  {
    name: 'mismatch-b-into-a', accountPool: 'pool-b', project: { state: 'tagged', name: 'pool-a' }, expect: 'mismatch',
    why: 'the same in the other direction — the rule is symmetric, and an inverted comparison passes one row alone',
  },
  {
    name: 'mismatch-on-a-prefix', accountPool: 'pool-a', project: { state: 'tagged', name: 'pool-ab' }, expect: 'mismatch',
    why: 'the comparison is EQUALITY, not a prefix or glob match — a TS `startsWith`, or a bash `==` with an '
      + 'unquoted right side, passes every other row in this table',
  },
  {
    name: 'unreadable-tagged-account', accountPool: 'pool-a', project: { state: 'unreadable' }, expect: 'undecidable',
    why: 'the tag exists and could not be read: nobody decides, and nobody crosses',
  },
  {
    name: 'unreadable-untagged-account', accountPool: null, project: { state: 'unreadable' }, expect: 'undecidable',
    why: 'THE ROW THAT MATTERS — an untagged account must not short-circuit past an unknown constraint. '
      + 'This is what fails when the untagged shortcuts are evaluated before the undecidable states',
  },
  {
    name: 'malformed-tagged-account', accountPool: 'pool-b', project: { state: 'malformed' }, expect: 'undecidable',
    why: 'a hand-typed tag with two tokens is a rewrite, not a permission',
  },
  {
    name: 'malformed-untagged-account', accountPool: null, project: { state: 'malformed' }, expect: 'undecidable',
    why: 'the same short-circuit as unreadable-untagged-account, for the other undecidable state',
  },
];
