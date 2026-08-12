// The five production accounts as ccd's BASH still hard-codes them today —
// DERIVED from `DEFAULT_TEST_ROSTER` (server/test/helpers.ts) for every field
// that roster already carries, plus a small side table for the three concepts
// ccd has and the roster does not.
//
// TRANSITIONAL, AND DELETED BY TASKS 8 AND 9 of the stage-2a plan. Three test
// files compare ccd's hand-written arrays and `case` arms against a TypeScript
// roster: `wrapper-roster-fixture.test.ts`, `install-session-hooks.test.ts` and
// `install-coordinator-skill.test.ts`. Task 6 deleted the roster they compared
// against (`shared/api.ts`'s `ACCOUNTS`), because the roster is runtime data
// now — but ccd itself does not read it until Task 8, and these readers are
// rewritten or deleted in Tasks 8 and 9. Until then the cross-language
// guarantee is worth keeping alive, and keeping it alive means a fixture,
// because the thing on the other side of the comparison is still a literal.
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
//                 roster's label and this are the same concept, and Task 8 is
//                 where they become the same value.
//   `ccdValid`  — `_is_valid_wrapper` (ccd:104) accepts `VALID_WRAPPERS` plus a
//                 hardcoded `gpt`. Once ccd reads the generated roster, every
//                 rostered account is valid and the concept has nothing left to
//                 distinguish.
//   `hooksAble` — both installers' default `homes` arrays. Task 8 points them at
//                 every account's config dir (both already `continue` past a
//                 home that does not exist), so this concept disappears too.
import { DEFAULT_TEST_ROSTER } from '../helpers.js';

export interface CcdMirrorAccount {
  configDirSuffix: string;
  idPrefix: string;
  label: string;
  homeAble: boolean;
  ccdValid: boolean;
  hooksAble: boolean;
}

/** The ccd-only half. Keyed by roster id, and checked against the roster
 *  below in BOTH directions — an account in one and not the other throws at
 *  import rather than silently dropping out of every comparison in three test
 *  files, which is the failure mode a fixture like this has. */
const CCD_SIDE: Record<string, { label: string; ccdValid: boolean; hooksAble: boolean }> = {
  claude: { label: 'team·max', ccdValid: true, hooksAble: true },
  claude2: { label: 'alt·max', ccdValid: true, hooksAble: true },
  'claude-corp': { label: 'team·shared', ccdValid: true, hooksAble: true },
  gpt: { label: 'gpt', ccdValid: true, hooksAble: true },
  'claude-dev0': { label: 'lab·dev0', ccdValid: true, hooksAble: true },
};

function buildMirror(): Record<string, CcdMirrorAccount> {
  const out: Record<string, CcdMirrorAccount> = {};
  for (const a of DEFAULT_TEST_ROSTER.accounts) {
    const side = CCD_SIDE[a.id];
    if (!side) {
      throw new Error(
        `ccdMirror: roster account "${a.id}" has no ccd-side entry. Add one (label/ccdValid/` +
          'hooksAble) or the three ccd mirror tests silently stop covering it.',
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
