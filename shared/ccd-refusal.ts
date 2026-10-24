/**
 * The machine token ccd prints beside a fatal refusal (`refusal-v1`, #560, ARCH-14). L0: imports nothing.
 *
 * `_lc_refuse` (`ccd/ccd`) journals a refusal and then dies with English. Until this token the server rebuilt the
 * journal's word from that English with regexes, so rewording a die silently reclassified it. Now `_lc_refuse` prints
 * one anchored line on stderr first:
 *
 *     ccd-refusal: <act> <token>
 *
 * The line is never the last one (the die follows it) and bash's own redirect diagnostics may come before it, so a
 * reader looks for it anywhere in stderr, line-anchored. A server reads it BEFORE any prose matcher and keeps the
 * prose matchers as the fallback for a ccd that does not print it (no `refusal-v1`), or prints a word this build does
 * not list. Additive on the wire: no `FLEET_PROTO` bump, and the frozen caps corpus is untouched (the capability rides
 * the trailing `echo` lane of `cmd_caps`).
 *
 * DEPLOY ORDER: additive for the NEW server, not for an already-deployed one. A server without this reader compares
 * whole stderr in its prose matchers, so the extra line makes a pre-lock die (reclaim/expire/collect lock-unopenable,
 * flock-unavailable, token-malformed) fall through to its generic branch. This wave widens a server reader, so it
 * ships with `ccrc rollout --server-first`; a fleet-first rollout opens that window until the server lanes land.
 *
 * `CCD_REFUSAL_TOKENS` is the words `_lc_refuse` can print. `server/test/ccd-refusal-v1.test.ts` holds it set-equal to
 * the literal tokens at `_lc_refuse`'s call sites, in both directions.
 */

import type { LcRefusalToken } from './api.js';

/** The capability `cmd_caps` advertises when this copy of ccd prints the line. */
export const CCD_REFUSAL_CAP = 'refusal-v1';

/** The line's fixed head. */
export const CCD_REFUSAL_PREFIX = 'ccd-refusal: ';

/** THE one spelling of the reap-lock word outside `shared/api.ts`'s own vocabulary (`LcRefusalToken` and its word
 *  table, which `satisfies` ties this to). The lanes' own unions and tables name it through this. */
export const CCD_LOCK_UNOPENABLE = 'lock-unopenable' as const satisfies LcRefusalToken;

export const CCD_REFUSAL_TOKENS = [
  'bad-args', 'bad-session-id', 'dirty-tree', 'flock-unavailable', 'foreign-worktree', 'held', 'hibernated',
  'in-progress', 'incomplete-registry', 'is-a-workspace', CCD_LOCK_UNOPENABLE, 'nested-checkouts-present',
  'no-such-session', 'not-a-workspace', 'not-archived', 'run-id-malformed', 'scratch-unwritable', 'session-live',
  'session-verdict-unknown', 'tip-unreadable', 'token-malformed', 'tree-unreadable', 'worktree-missing',
] as const;
export type CcdRefusalToken = (typeof CCD_REFUSAL_TOKENS)[number];

/** ccd's act word (`destroy`, `reclaim`, `expire`, `collect`, …) and the token it refused with. */
export interface CcdRefusal { readonly act: string; readonly token: CcdRefusalToken }

const LINE = /^ccd-refusal: ([a-z][a-z0-9-]*) ([a-z][a-z0-9-]*)$/;

const isCcdRefusalToken = (v: string): v is CcdRefusalToken => (CCD_REFUSAL_TOKENS as readonly string[]).includes(v);

/** The first well-formed refusal line anywhere in `stderr`, or `null`: no such line, or a word this build does not
 *  list (a newer ccd) — either way the caller falls back to the prose. */
export function readCcdRefusal(stderr: string): CcdRefusal | null {
  for (const line of stderr.split('\n')) {
    const m = LINE.exec(line.trimEnd());
    if (m === null) continue;
    return isCcdRefusalToken(m[2]!) ? { act: m[1]!, token: m[2]! } : null;
  }
  return null;
}

/** `stderr` without its refusal lines, so the prose matchers (whole-output, anchored) read what they always read. */
export function withoutCcdRefusal(stderr: string): string {
  return stderr.split('\n').filter((l) => !LINE.test(l.trimEnd())).join('\n');
}
