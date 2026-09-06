// The rule, in bash: an account MAY serve a project iff the account is
// untagged, or the project is untagged, or the names are equal — and if the
// project's tag cannot be read, NOBODY DECIDES.
//
// Driven over `POOL_RULE_CASES`, the ONE fixture table wave 3's `poolVerdict`
// and wave 4's `splitByPool` are driven over too, so the three spellings of
// one rule cannot drift apart without a red suite in at least one of them.
//
// TWO BLOCKS, TWO SUBJECTS, and the split is deliberate:
//   * `_pool_ok` is the RULE. Its only use of the wrapper argument is to ask
//     `_acct_pool`, so the table is driven with `_ccrc_pool` overridden to the
//     row's own `accountPool` — which lets EVERY row run, including one naming
//     a pool no fixture account carries, and keeps this block independent of
//     what wave 1 chose to put in `POOLED_TEST_ROSTER`.
//   * `_acct_pool` is the ROSTER READ. It is pinned separately against the
//     REAL generated `accounts.sh`, which is the only thing that can prove the
//     generator and this reader agree.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { POOL_RULE_CASES, POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import type { ProjectPoolWire } from '../../shared/api.js';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-pool-ok-');
  seedAccountsSh(h.home, POOLED_TEST_ROSTER);
});
afterEach(() => { h.cleanup(); });

/** The bash word `_project_pool_state` would print for a wire state. The one
 *  place the two languages' spellings meet; it is HERE and not in shipped
 *  source because nothing shipped crosses the two. */
const stateWord = (p: ProjectPoolWire): string =>
  p.state === 'tagged' ? `named ${p.name}` : p.state;

/** `serve` -> 0, `mismatch` -> 1, `undecidable` -> 2. */
const WANT_RC: Record<string, number> = { serve: 0, mismatch: 1, undecidable: 2 };

describe('_pool_ok over POOL_RULE_CASES — the rule, three exit codes', () => {
  it('guards the guard: the table is not empty and covers all three verdicts', () => {
    // A scan over an empty list passes everything.
    expect(POOL_RULE_CASES.length).toBeGreaterThanOrEqual(10);
    for (const want of ['serve', 'mismatch', 'undecidable']) {
      expect(POOL_RULE_CASES.some((c) => c.expect === want), want).toBe(true);
    }
    // Both undecidable STATES are exercised, not just one of them.
    for (const st of ['unreadable', 'malformed']) {
      expect(POOL_RULE_CASES.some((c) => c.project.state === st), st).toBe(true);
    }
  });

  it.each(POOL_RULE_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    // `_ccrc_pool` overridden to this row's account pool: the generator's own
    // contract is "empty stdout, rc 0, for an untagged or unknown id", so an
    // untagged account is a function that prints nothing.
    const stub = c.accountPool === null
      ? '_ccrc_pool() { return 0; };'
      : `_ccrc_pool() { echo ${JSON.stringify(c.accountPool)}; };`;
    const out = h.sh(
      `${stub} { _pool_ok anyaccount ${JSON.stringify(stateWord(c.project))}; } 2>&1; echo "rc=$?"`);
    // stderr is folded into stdout: a predicate that answered correctly while
    // complaining is not a predicate a supervisor loop can call every 5 s.
    expect(out).toBe(`rc=${WANT_RC[c.expect]}`);
  });

  it('undecidable is a THIRD answer, not a mismatch — an untagged account does not decide either', () => {
    // The mutant this kills: `*) return 1 ;;`. With it, an unreadable tag
    // becomes "this account may not serve", every candidate is refused, and a
    // permissions bug reads exactly like an empty pool.
    for (const word of ['unreadable', 'malformed']) {
      const out = h.sh(`_ccrc_pool() { return 0; }; _pool_ok anyaccount ${word}; echo "rc=$?"`);
      expect(out, word).toBe('rc=2');
    }
  });

  // NOT in POOL_RULE_CASES, and cannot be added to it: `POOL_NAME_RE` forbids
  // every glob metacharacter in a pool name (`/^[a-z][a-z0-9-]{0,31}$/`,
  // `shared/roster.ts`), and the no-real-names rule means no fixture row can
  // ever carry one either. So the table is STRUCTURALLY blind to the one bug
  // that matters most in this language: `_pool_ok`'s comparison is
  // `[[ -z "$ap" || "$ap" == "$pp" ]]`, and inside `[[ ]]` an UNQUOTED right
  // operand is a GLOB PATTERN, not a literal — `[[ pool-a == * ]]` is true.
  // Drop the quotes on `$pp` (`"$ap" == $pp`) and a project tagged `*` would
  // serve from every pooled account, silently, and no row above would ever
  // see it: every row's `pp` is a legal `POOL_NAME_RE` token, so quoted and
  // unquoted comparison agree on every one of them. This test drives the
  // metacharacter directly, bypassing the fixture table's own grammar limit,
  // and MUST NOT be deleted as "redundant with the table" — it is the only
  // thing in either suite that can see this class of bug.
  it('the comparison is a LITERAL match, not a glob: a metacharacter in the tag must not become a wildcard', () => {
    // Account pool stubbed non-empty on purpose: an untagged account
    // short-circuits on `-z "$ap"` before the comparison is ever reached,
    // which would prove nothing about quoting.
    const ap = 'pool-a';
    const cases: ReadonlyArray<[string, string]> = [
      // `*` alone: the textbook case. Any unquoted glob match makes this pass.
      ['named *', '*'],
      // `?` matches exactly one character; crafted so the STRING LENGTHS line
      // up (`pool-?` is 6 chars, same as `pool-a`) — an unquoted glob matches
      // this pattern against `pool-a` even though the two strings differ.
      ['named pool-?', 'pool-?'],
      // A bracket character class: `[ab]` at the last position glob-matches
      // either `a` or `b`, so `pool-[ab]` unquoted matches `pool-a` too.
      ['named pool-[ab]', 'pool-[ab]'],
    ];
    for (const [word, pp] of cases) {
      const out = h.sh(`_ccrc_pool() { echo ${JSON.stringify(ap)}; }; _pool_ok anyaccount ${JSON.stringify(word)}; echo "rc=$?"`);
      // A literal comparison of "pool-a" against any of these three tokens
      // disagrees — the correct verdict is MISMATCH (rc 1), never serve (rc 0).
      expect(out, pp).toBe('rc=1');
    }
  });
});

describe('_acct_pool — the roster read, over the real generated accounts.sh', () => {
  it('answers the pool the generator emitted, per account', () => {
    expect(h.sh('_acct_pool claude')).toBe('pool-a');
    expect(h.sh('_acct_pool claude-a')).toBe('pool-a');
    expect(h.sh('_acct_pool claude-b')).toBe('pool-b');
  });

  it('answers EMPTY for an untagged account and for an unknown id, rc 0, silently', () => {
    // The generator emits one `case` arm per TAGGED account only, so silence
    // is the answer for both — the collapse is accepted because
    // `_is_valid_wrapper` gates every id before any pool question is asked
    // (spec §6, first row).
    for (const w of ['claude-d', 'gpt', 'no-such-account']) {
      expect(h.sh(`out=$( { _acct_pool ${w}; } 2>&1 ); printf '%s|%s' "$out" "$?"`), w)
        .toBe('|0');
    }
  });

  it('answers EMPTY, rc 0 and SILENTLY over an accounts.sh that predates pools', () => {
    // A new ccd over an old `~/.ccrc/accounts.sh` must read every account as
    // untagged — today's behaviour — with no `command not found` on stderr and
    // no rc 127. `unset -f` reproduces exactly the state `declare -F` measures.
    const out = h.sh(
      'unset -f _ccrc_pool; out=$( { _acct_pool claude; } 2>&1 ); printf \'%s|%s\' "$out" "$?"');
    expect(out).toBe('|0');
  });

  it('guards the guard: the harness roster really does define _ccrc_pool', () => {
    // Without this the previous case proves nothing — an accounts.sh that
    // never had the function would make `unset -f` a no-op.
    expect(h.sh('declare -F _ccrc_pool >/dev/null && echo yes || echo no')).toBe('yes');
  });
});
