// POSITIVE CONTROL — MUST COMPILE CLEAN.
//
// Two jobs. First, it stops "nothing compiles" from satisfying the bypass pins
// next door: a legitimate `ExecWhitelist` and a legitimate `isExecAllowed` call
// have to keep building.
//
// Second, and the part that carries real weight: the type-level assertions
// below are where `FORBIDDEN_COMMANDS`'s CONTENTS and `ExecCommand`'s EXACT
// membership are pinned. Removing `'gh'` from `FORBIDDEN_COMMANDS` is the third
// and last edit needed to grant it (after the object literal and
// `EXEC_COMMANDS`), and it is the one edit no type in `whitelist.ts` can catch
// by itself — the disjointness proof there is satisfied by shrinking EITHER
// side. `GhIsForbidden` turns that shrink into `Assert<false>`, i.e. a compile
// error in this project, which `whitelist-structural.test.ts` reads as a
// failure of the positive control.
import {
  EXEC_COMMANDS,
  EXEC_WHITELIST,
  FORBIDDEN_COMMANDS,
  GRANTABLE_COMMANDS,
  REQUIRED_VERB_FLAG,
  UNGRANTABLE_VERBS,
  isExecAllowed,
  type ExecCommand,
  type ExecWhitelist,
  type ForbiddenCommand,
  type LawfulGrants,
} from '../../../src/whitelist.js';

type Assert<T extends true> = T;
/** Mutual `extends`, both sides wrapped in tuples so neither distributes over a
 *  union — `Equals<'a'|'b', 'a'>` must be `false`, not `boolean`. */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** The invariant, stated as a type: `gh` is forbidden. Deleting it from
 *  `FORBIDDEN_COMMANDS` breaks this build. */
export type GhIsForbidden = Assert<'gh' extends ForbiddenCommand ? true : false>;
/** `git` too — a `git push --force` grant is the same hole wearing a different
 *  binary, and `git` is the one a maintainer is likeliest to reach for. */
export type GitIsForbidden = Assert<'git' extends ForbiddenCommand ? true : false>;
/** Shell-equivalent escapes: any of these makes every other control decorative. */
export type ShellIsForbidden = Assert<'bash' extends ForbiddenCommand ? true : false>;
export type CurlIsForbidden = Assert<'curl' extends ForbiddenCommand ? true : false>;

/** EXACT membership, not a subset check: `Equals`, so ADDING a command is a
 *  build failure here as well as in `whitelist.ts`'s disjointness proof. */
export type ExecCommandIsExactlyTmuxAndCcd = Assert<Equals<ExecCommand, 'tmux' | 'ccd'>>;

/** A legitimate whitelist still builds — the pins are not a blanket refusal. */
export const good = {
  tmux: [['has-session'], ['capture-pane']],
  ccd: [['start'], ['ws-reap', '--expect']],
} as const satisfies ExecWhitelist;

/* VERIFY ROUND 2, P1 — the positive control for the VALUE machinery that
 * `g5..g8` next door pin negatively. Without this, "the whole `LawfulGrants`
 * conditional collapsed to `never` for everything" would satisfy all four
 * bypass fixtures while pinning nothing at all. A lawful table — `ws-reap`
 * carrying its `--expect`, no ungrantable verb, no empty prefix — must still
 * be assignable to `LawfulGrants<typeof itself>`. */
const lawfulTable = {
  tmux: [['has-session'], ['capture-pane']],
  ccd: [['start'], ['ws-audit', '--session'], ['ws-reap', '--expect']],
} as const satisfies ExecWhitelist;
export const lawful: LawfulGrants<typeof lawfulTable> = lawfulTable;

/** The two rule tables themselves, asserted as types. `ws-reap`'s required
 *  token is the reap confirmation; deleting the entry is the edit that would
 *  silently re-permit a token-free reap, and it breaks this build. */
export type ReapNeedsExpect = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['ws-reap'], '--expect'>>;
export type WsRmIsUngrantable = Assert<'ws-rm' extends (typeof UNGRANTABLE_VERBS)[number] ? true : false>;
export type WsGcIsUngrantable = Assert<'ws-gc' extends (typeof UNGRANTABLE_VERBS)[number] ? true : false>;

export const allowed: boolean = isExecAllowed('ccd', ['start', 'claude', 'demo']);
export const live: ExecWhitelist = EXEC_WHITELIST;
export const names: readonly string[] = [...EXEC_COMMANDS, ...FORBIDDEN_COMMANDS, ...GRANTABLE_COMMANDS];
