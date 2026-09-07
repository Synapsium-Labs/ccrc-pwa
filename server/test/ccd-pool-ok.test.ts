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
import { makeCcdHarness, seedAccountsSh, WS_ADD, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { POOL_RULE_CASES, POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import type { ProjectPoolWire } from '../../shared/api.js';
import fs from 'node:fs';
import path from 'node:path';

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
  // ever carry one either. So the table is STRUCTURALLY blind to a real bug
  // class: `_pool_ok`'s comparison is `[[ -z "$ap" || "$ap" == "$pp" ]]`, and
  // inside `[[ ]]` an UNQUOTED right operand is a GLOB PATTERN, not a literal
  // — `[[ pool-a == * ]]` is true. Drop the quotes on `$pp` (`"$ap" == $pp`)
  // and every row above would still pass, because every row's `pp` is a
  // legal `POOL_NAME_RE` token and quoted/unquoted comparison agree on all of
  // them — this test drives the metacharacter directly, bypassing the
  // fixture table's own grammar limit.
  //
  // WHO CAN ACTUALLY REACH THIS, and who cannot: `_pool_ok`'s SECOND ARGUMENT
  // is caller-supplied, and nothing inside `_pool_ok` checks its provenance.
  // The one producer shipped today, `_project_pool_state`, CANNOT reach it —
  // it gates the on-disk tag through `_pool_name_valid` before ever emitting
  // `named <n>`, and `_pool_name_valid` refuses every one of `*`, `?` and
  // `[ab]` outright, so a tag file containing any of them reads as
  // `malformed`, not `named *`. Through the tag file this escape is
  // UNREACHABLE today. But a caller that CONSTRUCTS or FORWARDS a state word
  // itself — bypassing `_project_pool_state` — is not hypothetical: waves 2b
  // and 3 add callers, and Task 5 of this wave adds two more, and none of
  // them are required to route through the one validated producer. This test
  // is DEFENCE IN DEPTH on that caller-supplied argument, not evidence of a
  // live hole in the tag path — do not delete it as redundant with the table
  // (it is the only thing in either suite that can see this bug class at
  // all) and do not read its passing as proof there is nothing to defend
  // against — the argument's provenance is exactly what is unchecked.
  it.each([
    // `*` alone: the textbook case. Any unquoted glob match makes this pass.
    ['*', 'named *'],
    // `?` matches exactly one character; crafted so the STRING LENGTHS line
    // up (`pool-?` is 6 chars, same as `pool-a`) — an unquoted glob matches
    // this pattern against `pool-a` even though the two strings differ.
    ['pool-?', 'named pool-?'],
    // A bracket character class: `[ab]` at the last position glob-matches
    // either `a` or `b`, so `pool-[ab]` unquoted matches `pool-a` too.
    ['pool-[ab]', 'named pool-[ab]'],
  ] as const)('the comparison is a LITERAL match, not a glob: %s must not become a wildcard', (_pp, word) => {
    // Account pool stubbed non-empty on purpose: an untagged account
    // short-circuits on `-z "$ap"` before the comparison is ever reached,
    // which would prove nothing about quoting.
    const out = h.sh(`_ccrc_pool() { echo pool-a; }; _pool_ok anyaccount ${JSON.stringify(word)}; echo "rc=$?"`);
    // A literal comparison of "pool-a" against any of these three tokens
    // disagrees — the correct verdict is MISMATCH (rc 1), never serve (rc 0).
    expect(out).toBe('rc=1');
  });

  // Companion to `_acct_pool`'s "predates pools" case below, but pinned at
  // the OTHER call site: `_pool_ok`'s own `ap=$(_acct_pool "$1")` is a SECOND
  // place that captures `_acct_pool`'s output, and nothing here proved THAT
  // capture is safe — every case above either stubs `_ccrc_pool` directly or
  // calls `_acct_pool` on its own, so none of them exercise `_pool_ok`'s own
  // line over an `accounts.sh` that predates pools. The mutant this kills:
  // `ap=$(_acct_pool "$1")` -> `ap=$(_ccrc_pool "$1")`, which deletes the
  // `declare -F` guard at exactly the call site `_acct_pool`'s own comment
  // block argues for (the minutes of an agent deploy between the roster lane
  // landing and the ccd lane landing) — every assertion in this file stayed
  // green under that mutation because none of them route through it.
  it('answers with no leaked stderr and no rc 127 at _pool_ok\'s OWN capture line, over an accounts.sh that predates pools', () => {
    const out = h.sh(
      'unset -f _ccrc_pool; out=$( { _pool_ok claude "named pool-a"; } 2>&1 ); printf \'%s|%s\' "$out" "$?"');
    // An account with no visible pool tag is untagged for this decision, and
    // an untagged account serves any project — rc 0, and nothing on stdout
    // or stderr says otherwise.
    expect(out).toBe('|0');
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

const writeLimits = (w: string, five: number, seven: number): void =>
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));

const disable = (w: string): void =>
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${w}-disabled`), '');

const tag = (project: string, bytes: string): void => {
  const dir = path.join(h.home, '.cc-sessions', 'pools');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, project), bytes);
};

const shFail2 = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

describe('_ws_least_loaded [project] — placement honours the tag', () => {
  // POOLED_TEST_ROSTER: claude -> pool-a, claude-a -> pool-a, claude-b ->
  // pool-b, claude-d untagged, gpt untagged and NOT home-able.
  it('zero-arg is byte-identical to today: the cheapest home-able lane wins', () => {
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 60, 60);
    writeLimits('claude-b', 1, 1);
    writeLimits('claude-d', 70, 70);
    expect(h.sh('_ws_least_loaded')).toBe('claude-b');
  });

  it('zero-arg is unchanged even when the same project IS tagged elsewhere', () => {
    // `${1-}` reads as `untagged`, so every pre-existing caller keeps its exact
    // meaning without knowing pools exist. The parity harness's zero-arg calls
    // depend on it.
    tag('demo', 'pool-a');
    writeLimits('claude', 50, 50);
    writeLimits('claude-b', 1, 1);
    expect(h.sh('_ws_least_loaded')).toBe('claude-b');
  });

  it('with a tagged project it skips other-pool lanes, however cheap they are', () => {
    tag('demo', 'pool-a');
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 60, 60);
    writeLimits('claude-b', 1, 1);      // cheapest, and in the WRONG pool
    writeLimits('claude-d', 70, 70);
    expect(h.sh('_ws_least_loaded demo')).toBe('claude');
  });

  it('an UNTAGGED account serves a tagged project — it is not "in no pool", it is unconstrained', () => {
    tag('demo', 'pool-a');
    writeLimits('claude', 90, 90);
    writeLimits('claude-a', 90, 90);
    writeLimits('claude-b', 1, 1);      // wrong pool
    writeLimits('claude-d', 5, 5);      // untagged, and cheapest of the eligible
    expect(h.sh('_ws_least_loaded demo')).toBe('claude-d');
  });

  it('falls back to the first IN-POOL account when nothing eligible is measured', () => {
    // The `first` fallback sits AFTER the pool filter, so an all-unmeasured
    // in-pool set falls back to the first IN-POOL account in roster order —
    // never to a cheaper-looking account in another pool.
    tag('demo', 'pool-b');
    writeLimits('claude', 1, 1);        // pool-a: must not be the fallback
    expect(h.sh('_ws_least_loaded demo')).toBe('claude-b');
  });

  it('answers EMPTY when every in-pool lane is disabled', () => {
    tag('demo', 'pool-b');
    disable('claude-b');
    disable('claude-d');
    expect(h.sh('_ws_least_loaded demo')).toBe('');
  });

  it('answers EMPTY when the tag is undecidable — nobody decides, not "everyone may"', () => {
    // The mutant this kills is the one that matters most: an undecidable tag
    // that let placement proceed would put work on whatever account is
    // cheapest, i.e. it would silently LIFT the constraint on a chmod.
    for (const bytes of ['Pool a', '']) {
      tag('demo', bytes);
      writeLimits('claude-b', 1, 1);
      expect(h.sh('_ws_least_loaded demo'), JSON.stringify(bytes)).toBe('');
    }
    fs.rmSync(path.join(h.home, '.cc-sessions', 'pools', 'demo'));
    fs.mkdirSync(path.join(h.home, '.cc-sessions', 'pools', 'demo'));
    expect(h.sh('_ws_least_loaded demo')).toBe('');
  });
});

describe('cmd_ws_add refuses in-pool, names the reason, and touches nothing', () => {
  it('names the pool, each accounts own first failing predicate, and the remedies', () => {
    h.makeRepo('demo');
    tag('demo', 'pool-b');
    disable('claude');       // BOTH disabled AND wrong-pool — see assertion below
    disable('claude-b');
    disable('claude-d');
    const r = shFail2(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('in pool pool-b');
    // FIRST FAILING PREDICATE IN LOOP ORDER, mirroring `_ws_least_loaded`'s own
    // order: missing, then disabled, then pool. `claude` is BOTH disabled and
    // in the wrong pool, and is reported as disabled — the check that ran
    // first and the one the operator fixes first, never the pool arm.
    expect(r.stderr).toContain('claude:disabled');
    expect(r.stderr).not.toContain('claude:pool=pool-a');
    expect(r.stderr).toContain('claude-a:pool=pool-a');
    expect(r.stderr).toContain('claude-b:disabled');
    expect(r.stderr).toContain('claude-d:disabled');
    expect(r.stderr).toContain('nothing was touched');
    // …and it really touched nothing.
    expect(fs.existsSync(path.join(h.home, 'worktrees', 'demo', 'quiet-mesa'))).toBe(false);
    expect(h.reg('demo-quiet-mesa', 'uuid')).toBeNull();
  });

  it('names the TAG, not the accounts, when the tag is undecidable', () => {
    // The two empties `_ws_least_loaded` cannot tell apart, told apart here.
    // Without this the operator is sent to enable a lane for a project whose
    // problem is a permission bit on one file.
    h.makeRepo('demo');
    tag('demo', 'Pool a');
    const r = shFail2(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('tag:malformed');
    expect(r.stderr).toContain('.cc-sessions/pools/demo');
    expect(r.stderr).not.toContain(':disabled');
    expect(h.reg('demo-quiet-mesa', 'uuid')).toBeNull();
  });

  it('still places into a tagged project when the pool has an account', () => {
    // The other direction: the refusal must not have become the only outcome.
    h.makeRepo('demo');
    tag('demo', 'pool-b');
    writeLimits('claude', 1, 1);        // cheapest, wrong pool
    writeLimits('claude-b', 90, 90);
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(h.reg('demo-quiet-mesa', 'home')).toBe('claude-b');
  });

  it('an untagged project keeps the pre-existing refusal sentence exactly', () => {
    // No pool words where there is no pool. The reason list is unchanged for
    // every project on the box that nobody has tagged.
    h.makeRepo('demo');
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) disable(w);
    const r = shFail2(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no account available for placement —');
    expect(r.stderr).not.toContain('in pool');
    expect(r.stderr).not.toContain(':pool=');
  });
});

describe('the `_pool_ok` header states a call-site count that stays honest', () => {
  it('the number the header claims equals grep -c \'_pool_ok \' ccd/ccd', () => {
    // Task 7 (docs-honesty) corrected this header from "kept for wave 2b,
    // not consumed today" to a plain count, exactly the kind of numeric
    // claim that goes stale the next time a call site is added or removed
    // without the prose being updated alongside it. The header's own
    // sentence names the grep that produces the number ("Measured:
    // `grep -c '_pool_ok ' ccd/ccd` finds N call sites now") — re-run that
    // same pattern here and require the stated N to still be true.
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('THE THIRD CODE IS CONSUMED TODAY');
    expect(from, 'the _pool_ok header could not be found').toBeGreaterThan(-1);
    const block = src.slice(from, from + 400);
    const claimed = block.match(/finds (\d+) call sites now/);
    expect(claimed, 'the header no longer states a call-site count in the expected shape').not.toBeNull();
    const stated = Number(claimed![1]);
    const live = (src.match(/_pool_ok /g) || []).length;
    expect(live, `grep -c '_pool_ok ' ccd/ccd now finds ${live}, but the header still claims ${stated}`).toBe(stated);
  });
});
