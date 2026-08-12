// The five production accounts as ccd's BASH still hard-codes them today, in
// the shape `shared/api.ts`'s deleted `ACCOUNTS` literal used to carry.
//
// TRANSITIONAL, AND DELETED BY TASKS 8 AND 9 of the stage-2a plan. Three test
// files compare ccd's hand-written arrays and `case` arms against a TypeScript
// roster: `wrapper-roster-fixture.test.ts`, `install-session-hooks.test.ts` and
// `install-coordinator-skill.test.ts`. Task 6 deleted the roster they compared
// against, because the roster is runtime data now — but ccd itself does not
// read it until Task 8, and this file's readers are rewritten (or deleted) in
// Tasks 8 and 9. Until then the cross-language guarantee those tests provide is
// worth keeping alive, and keeping it alive means a literal, because the thing
// on the other side of the comparison is still a literal.
//
// Two fields here have NO counterpart in `shared/roster.ts`'s `AccountDef`, and
// that is not an oversight:
//
//   `ccdValid`  — `_is_valid_wrapper` (ccd:104) accepts `VALID_WRAPPERS` plus a
//                 hardcoded `gpt`. Once ccd reads the generated roster, every
//                 rostered account is valid and the concept has nothing left to
//                 distinguish.
//   `hooksAble` — both installers' default `homes` arrays. Task 8 points them at
//                 every account's config dir (both already `continue` past a
//                 home that does not exist), so this concept disappears too.
//
// `idPrefix` is likewise absent from `AccountDef`: it is always `<id>-`, which
// `idHomeWrapper` (server/src/fleet.ts) and `shared/generate.mjs` both derive
// rather than store. It is spelled out here only because these tests compare
// against ccd's literal `case` arms, which are not derived from anything yet.

export interface CcdMirrorAccount {
  configDirSuffix: string;
  idPrefix: string;
  label: string;
  homeAble: boolean;
  ccdValid: boolean;
  hooksAble: boolean;
}

export const CCD_MIRROR: Record<string, CcdMirrorAccount> = {
  claude: {
    configDirSuffix: '.claude', idPrefix: 'claude-', label: 'team·max',
    homeAble: true, ccdValid: true, hooksAble: true,
  },
  claude2: {
    configDirSuffix: '.claude-personal', idPrefix: 'claude2-', label: 'alt·max',
    homeAble: true, ccdValid: true, hooksAble: true,
  },
  'claude-corp': {
    configDirSuffix: '.claude-corp', idPrefix: 'claude-corp-', label: 'team·shared',
    homeAble: true, ccdValid: true, hooksAble: true,
  },
  gpt: {
    configDirSuffix: '.claude-gpt', idPrefix: 'gpt-', label: 'gpt',
    homeAble: false, ccdValid: true, hooksAble: true,
  },
  'claude-dev0': {
    configDirSuffix: '.claude-dev0', idPrefix: 'claude-dev0-', label: 'lab·dev0',
    homeAble: true, ccdValid: true, hooksAble: true,
  },
};

/** Declaration order, as a runtime list — the order every describe below
 *  iterates in, and the order ccd's own arrays are written in. */
export const CCD_MIRROR_NAMES: readonly string[] = Object.keys(CCD_MIRROR);
