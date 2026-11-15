// The pool set's spelling table (the pool-set plan, Task 1): ONE definition of the cases, written for both languages.
// `parsePoolSet` and `poolSetSpelling` (`shared/poolset.ts`) are driven through it by `pool-set-spelling.test.ts`; a
// LATER pull request of the plan (Task 2) drives bash `_poolset_parse` (`ccd/lib/pool-set.sh`) over the same rows, so
// the two spellings cannot drift. Pool names are the fixture names `pool-a`, `pool-b` and `pool-ab` only.
import type { PoolSet, PoolSetSpelled } from '../../../shared/poolset.js';

/** Spelling in; the set it reads as, or `'malformed'`. */
export interface ParseCase { name: string; spelling: string; out: PoolSet | 'malformed'; why: string }
/** Set in; its spelling, or which of the two ways it has none: the empty set, or one the grammar cannot spell. */
export interface SpellCase { name: string; set: PoolSet; out: PoolSetSpelled; why: string }

const SPELLED = (spelling: string): PoolSetSpelled => ({ kind: 'spelled', spelling });

const S = (pools: readonly string[], untagged: boolean): PoolSet => ({ pools, untagged });
const name32 = `a${'b'.repeat(31)}`;            // the longest pool name POOL_NAME_RE allows
const name33 = `a${'b'.repeat(32)}`;            // one past it

// Fill a spelling to an exact byte length with distinct, ascending, grammar-clean names: `n01` ... each of 4 characters
// plus a comma, so the length is a multiple of 5 less one.
const ascending = (count: number): string[] => Array.from({ length: count }, (_x, i) => `n${String(i).padStart(3, '0')}`);
const spellingOf = (count: number): string => ascending(count).join(',');          // 4 * count + (count - 1) bytes
const JUST_UNDER = spellingOf(204);                                                  // 1019 bytes
const AT_CAP = `${JUST_UNDER},n205`;                                                  // 1024 bytes exactly

/** Exactly POOL_SET_SPELLING_MAX_BYTES bytes of valid, ascending names. */
export const POOL_SET_AT_CAP_SPELLING = AT_CAP;

export const POOL_SET_PARSE_CASES: readonly ParseCase[] = [
  { name: 'one name', spelling: 'pool-a', out: S(['pool-a'], false), why: 'the smallest named set' },
  { name: 'two names ascending', spelling: 'pool-a,pool-b', out: S(['pool-a', 'pool-b'], false), why: 'the comma joins; order is as written' },
  { name: 'a prefix pair ascending', spelling: 'pool-a,pool-ab', out: S(['pool-a', 'pool-ab'], false), why: 'a prefix sorts before its extension, so this is ascending, and the names stay whole' },
  { name: 'one name and untagged', spelling: 'pool-b+untagged', out: S(['pool-b'], true), why: 'the suffix is the yes' },
  { name: 'two names and untagged', spelling: 'pool-a,pool-b+untagged', out: S(['pool-a', 'pool-b'], true), why: 'the suffix after a list' },
  { name: 'untagged alone', spelling: '+untagged', out: S([], true), why: 'a set of no pools that admits untagged accounts' },
  { name: 'a 32-character name', spelling: name32, out: S([name32], false), why: 'POOL_NAME_RE\'s upper bound' },
  { name: 'the longest spelling', spelling: AT_CAP, out: { pools: [...ascending(204), 'n205'], untagged: false }, why: 'exactly POOL_SET_SPELLING_MAX_BYTES passes' },
  { name: 'unsorted', spelling: 'pool-b,pool-a', out: 'malformed', why: 'one set has one spelling: the order is ascending or it is malformed' },
  { name: 'a repeat', spelling: 'pool-a,pool-a', out: 'malformed', why: 'strictly ascending: a repeat is malformed' },
  { name: 'a repeat after the suffix is not a list', spelling: 'pool-a+untagged+untagged', out: 'malformed', why: 'the suffix appears once' },
  { name: 'the empty string', spelling: '', out: 'malformed', why: 'the empty set has no spelling, and an empty value means clear' },
  { name: 'a name that fails the pattern: upper case', spelling: 'Pool-a', out: 'malformed', why: 'POOL_NAME_RE' },
  { name: 'a name that fails the pattern: leading digit', spelling: '1pool', out: 'malformed', why: 'POOL_NAME_RE' },
  { name: 'a name that fails the pattern: 33 characters', spelling: name33, out: 'malformed', why: 'POOL_NAME_RE\'s upper bound, one past' },
  { name: 'a name that fails the pattern: an underscore', spelling: 'pool_a', out: 'malformed', why: 'POOL_NAME_RE' },
  { name: 'a leading comma', spelling: ',pool-a', out: 'malformed', why: 'an empty name' },
  { name: 'a trailing comma', spelling: 'pool-a,', out: 'malformed', why: 'an empty name' },
  { name: 'a doubled comma', spelling: 'pool-a,,pool-b', out: 'malformed', why: 'an empty name' },
  { name: 'a comma before the suffix', spelling: 'pool-a,+untagged', out: 'malformed', why: 'an empty name before the suffix' },
  { name: 'the suffix first', spelling: '+untagged,pool-a', out: 'malformed', why: 'the suffix ends the spelling' },
  { name: 'a space', spelling: 'pool-a, pool-b', out: 'malformed', why: 'a byte outside the grammar' },
  { name: 'a trailing newline', spelling: 'pool-a\n', out: 'malformed', why: 'a byte outside the grammar' },
  { name: 'a trailing CR', spelling: 'pool-a\r', out: 'malformed', why: 'a CRLF file keeps the CR (review 2085): outside the grammar' },
  { name: 'a NUL inside', spelling: 'pool-a\0+untagged', out: 'malformed', why: 'a NUL is outside the grammar' },
  { name: 'a non-ASCII character', spelling: 'pool-é', out: 'malformed', why: 'the grammar is ASCII' },
  { name: 'one past the cap', spelling: `${AT_CAP}x`, out: 'malformed', why: 'POOL_SET_SPELLING_MAX_BYTES + 1 bytes (and a name of 5 characters)' },
  { name: 'past the cap by the suffix', spelling: `${AT_CAP}+untagged`, out: 'malformed', why: 'the cap counts the suffix' },
  { name: 'far past the cap', spelling: spellingOf(1000), out: 'malformed', why: 'a 4,999-byte value of valid, ascending names (a bash read takes it whole): only the cap refuses it' },
  { name: 'upper-case suffix', spelling: 'pool-a+UNTAGGED', out: 'malformed', why: 'the suffix is exact' },
  { name: 'a plus without the word', spelling: 'pool-a+', out: 'malformed', why: 'the suffix is exact' },
  { name: 'a pool named for the suffix word', spelling: 'untagged', out: S(['untagged'], false), why: '`untagged` is a valid pool name; only `+untagged` is the suffix' },
  { name: 'ascending in bytes, not in a locale\'s collation', spelling: 'pool-b,poola', out: S(['pool-b', 'poola'], false), why: '`-` (0x2d) sorts before `a` in bytes; en_US collation ignores the dash and puts `poola` first, so only `local LC_ALL=C` keeps bash bytewise (review 2120 F2)' },
  { name: 'descending in bytes, ascending in a locale\'s collation', spelling: 'poola,pool-b', out: 'malformed', why: 'the other side of the row above: bytes decide, never the locale' },
];

export const POOL_SET_SPELL_CASES: readonly SpellCase[] = [
  { name: 'one name', set: S(['pool-a'], false), out: SPELLED('pool-a'), why: 'the smallest named set' },
  { name: 'sorted', set: S(['pool-b', 'pool-a'], false), out: SPELLED('pool-a,pool-b'), why: 'the spelling sorts: one set has one spelling' },
  { name: 'sorted by byte order, a prefix first', set: S(['pool-ab', 'pool-a'], false), out: SPELLED('pool-a,pool-ab'), why: 'a prefix sorts before its extension' },
  { name: 'sorted by bytes, never by a locale', set: S(['poola', 'pool-b'], false), out: SPELLED('pool-b,poola'), why: '`-` sorts before `a` in bytes (review 2120 F2)' },
  { name: 'drops repeats', set: S(['pool-a', 'pool-b', 'pool-a'], false), out: SPELLED('pool-a,pool-b'), why: 'a set holds a name once' },
  { name: 'untagged suffix', set: S(['pool-b'], true), out: SPELLED('pool-b+untagged'), why: 'the yes is the suffix' },
  { name: 'untagged alone', set: S([], true), out: SPELLED('+untagged'), why: 'no names, the yes' },
  { name: 'the empty set has no spelling', set: S([], false), out: { kind: 'empty' }, why: 'open question 3: an empty route value means clear, and only this answer may become one' },
  { name: 'a name the grammar cannot spell', set: S(['Pool-A'], false), out: { kind: 'unspellable', why: 'name' }, why: 'a spelling `parsePoolSet` would refuse is never handed out, and it is not the empty set' },
  { name: 'one bad name among good ones', set: S(['pool-a', 'bad name'], true), out: { kind: 'unspellable', why: 'name' }, why: 'all or nothing' },
  { name: 'a bad name in an otherwise empty-looking set', set: S([''], false), out: { kind: 'unspellable', why: 'name' }, why: 'an empty NAME is a bad name, never the empty set' },
  { name: 'at the cap', set: { pools: [...ascending(204), 'n205'], untagged: false }, out: SPELLED(AT_CAP), why: 'exactly POOL_SET_SPELLING_MAX_BYTES is spelled' },
  { name: 'past the cap', set: { pools: ascending(250), untagged: false }, out: { kind: 'unspellable', why: 'over-cap' }, why: 'a spelling over POOL_SET_SPELLING_MAX_BYTES is never handed out, and it is not the empty set' },
];
