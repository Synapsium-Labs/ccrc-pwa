// The pool rule's session side as a SET (C46) and its one-token spelling: L0, one concern.
//
// A session's side of the pool rule is either its project's one-name tag (as ever) or a set of pool names with an
// `untagged` yes or no. This file holds the set's shape and the spelling it travels in (a route-record value, a
// `ccd pool-answer` word), once for TypeScript; `ccd/lib/pool-set.sh#_poolset_parse` is the bash spelling and is driven
// over the same table (`server/test/fixtures/poolSetSpelling.ts`). It imports one VALUE from its sibling `roster.ts`
// (the pool-name pattern) and nothing from `node:*`, because the PWA bundles this file.
//
// The spelling: names in ascending byte order, joined by `,`, then `+untagged` when the set admits untagged accounts:
// `pool-a,pool-b`, `pool-b+untagged`, `+untagged`. Grammar `^(N(,N)*)?(\+untagged)?$`, N being POOL_NAME_RE, non-empty
// as a whole, names STRICTLY ascending (a repeat or an unsorted list is malformed, so one set has one spelling), at most
// POOL_SET_SPELLING_MAX_BYTES bytes. The grammar is ASCII-only (POOL_NAME_RE admits no byte above 0x7f), so a string
// the grammar accepts has as many bytes as characters, and the cap is read off `length` with no encoder; a string with a
// non-ASCII character is refused by the pattern, whatever its length.
//
// The EMPTY set has no spelling (open question 3 of the pool-set plan): an empty route value means "clear the field",
// so `poolSetSpelling` answers `empty` for it and `parsePoolSet` reads the empty string as malformed. A set the grammar
// cannot spell (a bad name, or over the cap) is a third answer, `unspellable`, never folded into `empty`: only `empty`
// may ever become the clearing write, and a writer that cleared an unspellable set would drop the session to its
// untagged project, the fail-open C46 forbids (departure `poolset-spelling-tells-empty-from-unspellable`).
import { POOL_NAME_RE } from './roster.js';

/** A session's set (C46): pool names in the operator's order, and the yes or no for accounts in no pool. */
export interface PoolSet { readonly pools: readonly string[]; readonly untagged: boolean }

/** The longest spelling, in bytes (the grammar is ASCII, so also in characters). */
export const POOL_SET_SPELLING_MAX_BYTES = 1024;

const UNTAGGED_SUFFIX = '+untagged';

/** What `poolSetSpelling` answers: three conditions a writer handles differently, so three arms, never one null. */
export type PoolSetSpelled =
  | { readonly kind: 'spelled'; readonly spelling: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unspellable'; readonly why: 'name' | 'over-cap' };

/**
 * The set's one token. `empty` for the empty set (no route spelling, see the header); `unspellable` with `name` for a
 * set holding a name that fails POOL_NAME_RE, and with `over-cap` for a spelling over the cap: a caller never receives
 * a spelling that `parsePoolSet` would refuse. Names are sorted ascending by byte order (plain `<` on ASCII strings)
 * and repeats drop.
 */
export function poolSetSpelling(set: PoolSet): PoolSetSpelled {
  const names = [...new Set(set.pools)];
  if (names.some((n) => !POOL_NAME_RE.test(n))) return { kind: 'unspellable', why: 'name' };
  if (names.length === 0 && !set.untagged) return { kind: 'empty' };
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const spelling = names.join(',') + (set.untagged ? UNTAGGED_SUFFIX : '');
  if (spelling.length > POOL_SET_SPELLING_MAX_BYTES) return { kind: 'unspellable', why: 'over-cap' };
  return { kind: 'spelled', spelling };
}

/** Read one spelling. Anything outside the grammar is `{ ok: false }`; there is no partial answer. */
export function parsePoolSet(spelling: string): { readonly ok: true; readonly set: PoolSet } | { readonly ok: false } {
  if (spelling.length === 0 || spelling.length > POOL_SET_SPELLING_MAX_BYTES) return { ok: false };
  const untagged = spelling.endsWith(UNTAGGED_SUFFIX);
  const head = untagged ? spelling.slice(0, spelling.length - UNTAGGED_SUFFIX.length) : spelling;
  // The spelling is non-empty, so an empty head means it IS the suffix: the set of no pools that admits untagged ones.
  if (head.length === 0) return { ok: true, set: { pools: [], untagged: true } };
  const pools = head.split(',');
  for (let i = 0; i < pools.length; i++) {
    const n = pools[i]!;
    if (!POOL_NAME_RE.test(n)) return { ok: false };
    if (i > 0 && !(pools[i - 1]! < n)) return { ok: false };
  }
  return { ok: true, set: { pools, untagged } };
}

// ---------- `ccd pool-answer` (the pool-set plan's Task 6) ----------
// The read-only answer for a session's current account, one line on stdout:
//   pool-answer side=<side> verdict=<verdict> pool-side=<pool side> pool-state=<state> crossing=<crossing> account=<id>
// A value that holds a space in ccd's own words carries `:` for it (`named:pool-a`, `set:pool-a,pool-b`), so every token
// is `key=value`. These are the line's words, one vocabulary for `server/src/poolrule.ts#parsePoolAnswer` and its readers
// (the renewal rows piece, the designation piece's door); `ccd/lib/pool-set.sh#cmd_pool_answer` is the other spelling.

/** The rule's three answers, as `_pool_ok`'s rc 0, 1 and 2 print them. */
export const POOL_ANSWER_VERDICTS = ['serve', 'mismatch', 'undecidable'] as const;
/** Which side the answer was decided on (`POOL_OK_SIDE`). */
export const POOL_ANSWER_POOL_SIDES = ['project', 'account', 'set'] as const;
/** `_crosspool_valid`'s three answers for the account the session runs on: rc 0, 1 and 2. */
export const POOL_ANSWER_CROSSINGS = ['valid', 'none', 'unreadable'] as const;
/** The line's keys, in the one order ccd prints them. */
export const POOL_ANSWER_KEYS = ['side', 'verdict', 'pool-side', 'pool-state', 'crossing', 'account'] as const;

/** One parsed `ccd pool-answer` line. `side` and `poolState` keep ccd's words with `:` for the space. */
export type PoolAnswer = {
  readonly side: string;
  readonly verdict: (typeof POOL_ANSWER_VERDICTS)[number];
  readonly poolSide: (typeof POOL_ANSWER_POOL_SIDES)[number];
  readonly poolState: string;
  readonly crossing: (typeof POOL_ANSWER_CROSSINGS)[number];
  readonly account: string;
};
