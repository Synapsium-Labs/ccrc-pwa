import path from 'node:path';

// D-7504 (ARCH-05, #551): the session store's path default, moved inward from `auth/sessions.ts` so that
// `config.ts#loadConfig` (L3) reads it from an L1 file instead of the L4 store. This module imports
// `node:path` and nothing else: no `node:os`, so it cannot reach the live home.

/**
 * The path under `home`, and the ONE place `sessions.json` is spelled.
 *
 * `home` IS REQUIRED, AND THAT IS THE SAFETY RULE MADE STRUCTURAL (D-123, Task 5
 * + its review fold-in). This function was `defaultSessionsPath()` with no
 * parameter, reaching `os.homedir()` — and `config.ts` must derive the path from
 * `cfg.home`, which is `CCRC_HOME` when set, which every server test sets to a
 * throwaway fixture. Wired the original way the suite would have minted and
 * swept sessions in the operator's LIVE `~/.ccrc/sessions.json`. A DEFAULT
 * parameter would have left that one keystroke away; a required one makes the
 * dangerous call a compile error, which is the difference between a rule and a
 * mechanism ("the ccd suite's single isolation boundary is HOME", `CLAUDE.md`).
 *
 * It exists at all — rather than `config.ts` writing `path.join(home, '.ccrc',
 * 'sessions.json')` inline — for `defaultCoordDbPath(home)`'s reason: "the same
 * string built twice, once tested and once not, is how a rename in one place
 * silently opens a different, brand-new, empty file in the other"
 * (`config.ts#loadConfig`, the comment on its `coordDbPath` default).
 */
export function defaultSessionsPath(home: string): string {
  return path.join(home, '.ccrc', 'sessions.json');
}
