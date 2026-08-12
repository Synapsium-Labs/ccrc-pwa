// The five production accounts as ccd's BASH still hard-codes them today —
// DERIVED from `DEFAULT_TEST_ROSTER` (server/test/helpers.ts) for every field
// that roster already carries, plus a small side table for the three concepts
// ccd has and the roster does not.
//
// ON ITS LAST READER, BUT STAYING — an earlier version of this comment said
// Task 9 would delete it outright once its last reader grew a round-trip.
// That turned out wrong. Three test files used to compare ccd's hand-written
// arrays and `case` arms against a TypeScript roster; Task 8 — which made
// ccd, and both installers, source the generated `~/.ccrc/accounts.sh` — took
// two of them off this fixture entirely: `install-session-hooks.test.ts` and
// `install-coordinator-skill.test.ts` now assert against `DEFAULT_TEST_ROSTER`
// directly, because the literal `homes` arrays they were pinning no longer
// exist. `wrapper-roster-fixture.test.ts` is the one reader left, and Task 9
// DID add that round-trip — but as an ADDITIONAL describe, beside the four
// that were already asserting ccd's bash answer SPACE (a whole `case`
// statement's arm set, a whole array's token list) is exactly this fixture's
// `ccdValid`/`homeAble` set, both directions. The round-trip checks a
// different property — per-input agreement between the generated bash and
// the server's own TypeScript — and does not touch `ccdValid` or `homeAble`
// at all, so it proves nothing about answer-space completeness and cannot
// replace those four. `label` has no substitute anywhere: it is ccd's
// human-facing display string, not a roster field (the test roster uses ids
// as labels — see `CCD_SIDE` below), and `wrapper-roster-fixture.test.ts`'s
// statusline describe still needs it. This file goes only when something
// else supplies BOTH of those — most likely Task 10's real
// `deploy/accounts.default.json` carrying real labels, at which point the
// four completeness describes and the statusline describe can probably read
// it directly and this hand-derived side table stops earning its keep.
//
// WHY IT IS DERIVED AND NOT WRITTEN OUT. The first version of this file
// restated the ids, config-dir suffixes and home-able flags that
// `DEFAULT_TEST_ROSTER` already holds, and nothing compared the two — a second
// hand-typed copy of the roster, in the plan whose entire purpose is to delete
// the last one (review round 1, finding 2). The concrete failure that allowed:
// ccd's `_cfg_dir` is pinned against THESE suffixes while the server's
// `configDirFor` is pinned against the roster's, so the two could drift into
// mapping one account to two different config dirs with every test still green.
// Derivation makes that impossible rather than unlikely.
//
// `idPrefix` is derived too, as `<id>-`: that is precisely what
// `idHomeWrapper` (server/src/fleet.ts) matches on and what
// `shared/generate.mjs` emits its `case` arms from, so spelling it out here
// would be a third statement of a rule two implementations already share.
//
// The side table below holds only what the roster genuinely does not know:
//
//   `label`     — ccd's `statusline-command.sh` display label, which is NOT the
//                 roster's `label` field in the test fixture (the fixture uses
//                 ids as labels; ccd's bash carries the human ones). A real
//                 roster's label and this are the same concept; statusline is
//                 the one ccd surface Task 8 left reading a literal.
//   `ccdValid`  — `_is_valid_wrapper` used to accept `VALID_WRAPPERS` plus a
//                 hardcoded `gpt`; it now iterates `CCRC_ACCOUNTS`, so every
//                 rostered account is valid and this field is `true` for all of
//                 them today. Still read by two describes in
//                 `wrapper-roster-fixture.test.ts` that ask "which accounts
//                 should ccd accept" as a filter over `WRAPPERS` — trivially
//                 `true` for every entry right now, but the field, not a bare
//                 `WRAPPERS` list, is what keeps those describes correct the
//                 day this fixture ever needs to express an invalid account
//                 again.
//
// `hooksAble` was the third, and is gone: it named the accounts in the
// installers' literal `homes` arrays, and those arrays were replaced in Task 8
// by a `source` of the generated roster, so the concept has nothing left to
// distinguish (both installers already `continue` past a home whose directory
// is absent, which is what made "every account" safe).
import { DEFAULT_TEST_ROSTER } from '../helpers.js';

export interface CcdMirrorAccount {
  configDirSuffix: string;
  idPrefix: string;
  label: string;
  homeAble: boolean;
  ccdValid: boolean;
}

/** The ccd-only half. Keyed by roster id, and checked against the roster
 *  below in BOTH directions — an account in one and not the other throws at
 *  import rather than silently dropping out of every comparison in three test
 *  files, which is the failure mode a fixture like this has. */
const CCD_SIDE: Record<string, { label: string; ccdValid: boolean }> = {
  claude: { label: 'team·max', ccdValid: true },
  claude2: { label: 'alt·max', ccdValid: true },
  'claude-corp': { label: 'team·shared', ccdValid: true },
  gpt: { label: 'gpt', ccdValid: true },
  'claude-dev0': { label: 'lab·dev0', ccdValid: true },
};

function buildMirror(): Record<string, CcdMirrorAccount> {
  const out: Record<string, CcdMirrorAccount> = {};
  for (const a of DEFAULT_TEST_ROSTER.accounts) {
    const side = CCD_SIDE[a.id];
    if (!side) {
      throw new Error(
        `ccdMirror: roster account "${a.id}" has no ccd-side entry. Add one (label/ccdValid) ` +
          'or wrapper-roster-fixture.test.ts silently stops covering it.',
      );
    }
    out[a.id] = {
      configDirSuffix: a.configDirSuffix,
      idPrefix: `${a.id}-`,
      homeAble: a.homeAble,
      ...side,
    };
  }
  for (const id of Object.keys(CCD_SIDE)) {
    if (!(id in out)) {
      throw new Error(
        `ccdMirror: ccd-side entry "${id}" names no roster account. Remove it, or add the ` +
          'account to DEFAULT_TEST_ROSTER (server/test/helpers.ts).',
      );
    }
  }
  return out;
}

export const CCD_MIRROR: Record<string, CcdMirrorAccount> = buildMirror();

/** Roster declaration order — the order every describe iterates in, and the
 *  order ccd's own arrays are written in. */
export const CCD_MIRROR_NAMES: readonly string[] = DEFAULT_TEST_ROSTER.accounts.map((a) => a.id);
