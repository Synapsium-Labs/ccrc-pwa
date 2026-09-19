// The rule, in bash: an account MAY serve a project iff the account is
// untagged, or the project is untagged, or the names are equal — and if the
// project's tag cannot be read, NOBODY DECIDES.
//
// Driven over `POOL_RULE_CASES`, the ONE fixture table wave 3's `poolVerdict`
// and wave 4's `splitByPool` are driven over too, so the three spellings of
// one rule cannot drift apart without a red suite in at least one of them.
//
// TWO BLOCKS, TWO SUBJECTS, and the split is deliberate:
//   * `_pool_ok` is the RULE. Since wave 1 Task 2 its only use of the account
//     argument is to ask `_acct_pool_state`, so the row-driven loop below
//     stubs THAT function to the row's own account word — which lets EVERY
//     row run, including one naming a state no fixture account's declared tag
//     carries, and keeps this block independent of what wave 1 chose to put
//     in `POOLED_TEST_ROSTER`. The integration blocks further down
//     (`_ws_least_loaded`, `cmd_ws_add`) exercise the real, sourced
//     `_acct_pool_state` instead — `plantPoolEpoch` seeds the central
//     projection it reads, mirroring `POOL_BY_ID` so the central document
//     agrees with the declared roster `seedAccountsSh` already writes.
//   * `_acct_pool` is the ROSTER READ (the DECLARED side, spec §5.6's lowest
//     precedence — `_pool_ok` no longer consults it directly, but callers
//     still use it to render a pool name in refusal text). It is pinned
//     separately against the REAL generated `accounts.sh`, which is the only
//     thing that can prove the generator and this reader agree.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, plantPoolEpoch, plantPoolSyncTimer, seedAccountsSh, WS_ADD, CCD, type CcdHarness }
  from './ccdWsHelpers.js';
import { POOL_RULE_CASES, POOLED_TEST_ROSTER, POOL_BY_ID } from './fixtures/poolRule.js';
import type { PoolRuleCase } from './fixtures/poolRule.js';
import type { ProjectPoolWire } from '../../shared/api.js';
import fs from 'node:fs';
import path from 'node:path';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-pool-ok-');
  seedAccountsSh(h.home, POOLED_TEST_ROSTER);
  // The central projection, agreeing with the declared roster above. `_pool_ok`
  // (Task 2) reads the account side through THIS document, so a fresh harness
  // with only `seedAccountsSh` would read every account `unreadable` — correct
  // for a control plane that has never synced (spec §5.8's cold-node fail-shut),
  // but not what the placement-wiring blocks below are exercising. A case that
  // wants the cold/absent document instead passes `undefined`, and one that
  // wants the two carriers to DISAGREE passes its own map — see the
  // projection-beats-roster case in the `_ws_least_loaded` block.
  plantPoolEpoch(h.home, POOL_BY_ID);
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

  /** The bash word `_acct_pool_state` would print for a row's account side —
   *  `accountState`, when the row opts into one of the three undecidable
   *  states, otherwise derived from `accountPool` exactly as `stateWord`
   *  derives the project word from `ProjectPoolWire`. Added by wave 1 Task 2,
   *  replacing the old `_ccrc_pool` stub now that `_pool_ok` reads the
   *  account's STATE rather than a bare name. */
  const acctWord = (c: PoolRuleCase): string =>
    c.accountState ?? (c.accountPool === null ? 'untagged' : `named ${c.accountPool}`);

  it.each(POOL_RULE_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    // `_acct_pool_state` overridden to this row's account state: it always
    // answers rc 0 with one of the five words, never bare stdout the way the
    // old `_ccrc_pool` generator did.
    const stub = `_acct_pool_state() { echo ${JSON.stringify(acctWord(c))}; };`;
    const out = h.sh(
      `${stub} { _pool_ok anyaccount ${JSON.stringify(stateWord(c.project))}; } 2>&1; echo "rc=$?"`);
    // stderr is folded into stdout: a predicate that answered correctly while
    // complaining is not a predicate a supervisor loop can call every 5 s.
    expect(out).toBe(`rc=${WANT_RC[c.expect]}`);
  });

  it('an undecidable PROJECT tag is a THIRD answer, not a mismatch — and the account side is never asked', () => {
    // The mutant this kills: the project arm's `*) return 1 ;;`. With it, an
    // unreadable tag becomes "this account may not serve", every candidate is
    // refused, and a permissions bug reads exactly like an empty pool.
    //
    // RETITLED AND DESTUBBED (wave 1 Task 2 fix round 1, M2). It carried a
    // `_ccrc_pool() { return 0; }` stub and a title saying "an untagged
    // account does not decide either", both left over from the rename: since
    // the account side moved to `_acct_pool_state`, nothing in this call
    // reaches `_ccrc_pool`, and the account side is not merely untagged here
    // — it is never consulted, because the project arm returns first. The
    // assertion below is unchanged; only the claims about it are.
    for (const word of ['unreadable', 'malformed']) {
      const out = h.sh(`_pool_ok anyaccount ${word}; echo "rc=$?"`);
      expect(out, word).toBe('rc=2');
    }
  });

  it('never calls _acct_pool_state at all for an untagged project — the blast-radius short-circuit (spec §5.8)', () => {
    // The mutant this kills: `ap=$(_acct_pool_state "$1")` moved ABOVE the
    // project `case`. Every fixture row's assertion is on the RETURN CODE
    // only, and for `acct-unreadable-project-untagged` the code stays `rc=0`
    // either way — the project arm returns before `$ap` is ever read, so a
    // reordered-but-still-unused assignment is invisible to an rc-only
    // check. Only a CALL COUNT can see it, and a call count is the actual
    // design property (§5.8): "an untagged project is unconstrained, so it
    // must serve WITHOUT CONSULTING THE ACCOUNT SIDE AT ALL" — otherwise a
    // control plane down longer than the lease stops placement everywhere,
    // not only into the projects someone deliberately tagged.
    const marker = path.join(h.home, 'acct-pool-state-calls');
    const out = h.sh(
      `_acct_pool_state() { echo called >> ${JSON.stringify(marker)}; echo unreadable; }; `
      + '_pool_ok anyaccount untagged; echo "rc=$?"');
    expect(out).toBe('rc=0');
    expect(fs.existsSync(marker),
      '_acct_pool_state must not be called at all when the project is untagged').toBe(false);
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
    // Account state stubbed non-empty AND tagged on purpose (wave 1 Task 2 —
    // was `_ccrc_pool() { echo pool-a; }`, updated for the new capture): an
    // untagged/undecidable account short-circuits before the comparison is
    // ever reached, which would prove nothing about quoting.
    const out = h.sh(
      `_acct_pool_state() { echo 'named pool-a'; }; _pool_ok anyaccount ${JSON.stringify(word)}; echo "rc=$?"`);
    // A literal comparison of "pool-a" against any of these three tokens
    // disagrees — the correct verdict is MISMATCH (rc 1), never serve (rc 0).
    expect(out).toBe('rc=1');
  });

  // Wave 1 Task 2 replaced this test's original subject: it used to pin
  // `_pool_ok`'s capture line against `unset -f _ccrc_pool` (an accounts.sh
  // that predates the DECLARED pool field), proving `ap=$(_acct_pool "$1")`
  // had not silently become `ap=$(_ccrc_pool "$1")`. `_pool_ok` no longer
  // calls `_acct_pool` at all — that whole mutant class is gone with the line
  // it targeted — so this test now pins the NEW capture line instead:
  // `ap=$(_acct_pool_state "$1")`, never a direct `_ccrc_pool`/`_acct_pool`
  // read that would silently restore the old, fail-open "no visible tag ==
  // untagged" behaviour the wave exists to close. Two functions stubbed to
  // DISAGREE — `_acct_pool_state` tagged, `_acct_pool` untagged — so only the
  // correct capture serves; the old capture would read `_acct_pool`'s empty
  // stdout as untagged and serve regardless of the project's real tag.
  it('captures the account side through _acct_pool_state, never _acct_pool directly', () => {
    const out = h.sh(
      "_acct_pool_state() { echo 'named pool-a'; }; _acct_pool() { :; }; "
      + 'out=$( { _pool_ok claude "named pool-a"; } 2>&1 ); printf \'%s|%s\' "$out" "$?"');
    // The names agree under the STUBBED `_acct_pool_state` — rc 0, and
    // nothing on stdout or stderr. Had `_pool_ok` still read `_acct_pool`
    // (stubbed empty/untagged here), the untagged short-circuit would also
    // answer 0, so the mismatch case below is what actually discriminates.
    expect(out).toBe('|0');
    const mismatch = h.sh(
      "_acct_pool_state() { echo 'named pool-b'; }; _acct_pool() { :; }; "
      + '_pool_ok claude "named pool-a"; echo "rc=$?"');
    // `_acct_pool_state` says pool-b, the project wants pool-a: a capture
    // still reading `_acct_pool` (empty/untagged here) would short-circuit
    // to serve (rc 0); the correct capture disagrees and answers MISMATCH.
    expect(mismatch).toBe('rc=1');
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

  it('the PROJECTION decides, not the declared roster — the one case where the two DISAGREE', () => {
    // THE PIN THIS WHOLE ACCOUNT ARM IS ABOUT, and until fix round 1 it did
    // not exist anywhere outside a stubbed unit test. Every other pooled
    // fixture in this tree plants the projection FROM the same map the
    // declared roster is generated from, so the two carriers agree BY
    // CONSTRUCTION and no integration case can tell which one decided.
    // Measured before this case was written: reverting `_pool_ok`'s account
    // read to the declared `_acct_pool` left all 227 assertions across the
    // five adapted files GREEN.
    //
    // Here they disagree on ONE account, deliberately. The declared roster
    // (`POOLED_TEST_ROSTER`, untouched, still written by `beforeEach`) says
    // `claude -> pool-a`; the projection re-planted below says
    // `claude -> pool-b`. Against a `pool-a` project that is the whole
    // question:
    //   declared read  -> `claude` is in pool and by far the cheapest: wins
    //   projected read -> `claude` is out of pool; `claude-a` wins instead
    // The two answers are different accounts, so the assertion cannot be
    // satisfied by both readers — which is what makes it a pin and not a
    // decoration.
    plantPoolEpoch(h.home, { ...POOL_BY_ID, claude: 'pool-b' });
    tag('demo', 'pool-a');
    writeLimits('claude', 1, 1);        // cheapest — and in pool-a by the ROSTER only
    writeLimits('claude-a', 90, 90);    // pool-a on BOTH carriers
    writeLimits('claude-b', 95, 95);    // pool-b on both
    writeLimits('claude-d', 99, 99);    // untagged on both: unconstrained, but dearest
    expect(h.sh('_ws_least_loaded demo')).toBe('claude-a');
  });

  it('guards the guard: the same skew with the declared and projected pools AGREEING picks claude', () => {
    // Without this the case above proves only that `claude` lost, not that
    // the PROJECTION is why. Same limits, same tag, same roster — only the
    // projection's `claude` row moves back to `pool-a`, and the cheapest
    // account wins again. A `_pool_ok` that had simply stopped serving
    // `claude` for some unrelated reason would red HERE.
    plantPoolEpoch(h.home, POOL_BY_ID);
    tag('demo', 'pool-a');
    writeLimits('claude', 1, 1);
    writeLimits('claude-a', 90, 90);
    writeLimits('claude-b', 95, 95);
    writeLimits('claude-d', 99, 99);
    expect(h.sh('_ws_least_loaded demo')).toBe('claude');
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

  it('names the PROJECTION and its own remedy when the ACCOUNT side is undecidable, not the project tag', () => {
    // I1/I2, fix round 1. On a cold node — a box whose control plane has
    // never synced, which is the EKS default path — the project tag is
    // perfectly readable and every account is undecidable. What the refusal
    // said before named the TAG (`tag:`/"pool tag for demo is … fix or clear
    // it"), which blames a healthy file and whose remedy would UNTAG the
    // project. The two conditions have different remedies, so they get
    // different sentences.
    // Item 5 (I3, wave-1 fix round A): the "EKS default path" this test's
    // own comment names IS a fleet node (§6's future-fit text: "pods hold
    // only a leased projection"), just a cold-started one — `plantPoolSyncTimer`
    // is what keeps this case meaning that, distinct from a box with no
    // control plane by configuration at all, which now falls back to the
    // declared tag instead.
    h.makeRepo('demo');
    tag('demo', 'pool-b');
    plantPoolEpoch(h.home, undefined);      // no document at all: never synced
    plantPoolSyncTimer(h.home);
    const r = shFail2(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('projection=unreadable');
    // NOT the project tag, in either spelling: the tag reads fine here.
    // ` tag:` is the reason list's own token for an undecidable TAG, and
    // `pool tag for` is the three verbs' die sentence for the same thing.
    expect(r.stderr).not.toContain(' tag:');
    expect(r.stderr).not.toContain('pool tag for');
    expect(r.stderr).not.toContain(':pool=');
    // …and the remedy names the carrier that actually decided.
    expect(r.stderr).toContain(`${h.home}/.cc-sessions/pool-epoch`);
    expect(h.reg('demo-quiet-mesa', 'uuid')).toBeNull();
  });

  it('tells STALE from UNREADABLE — one remedy is the control-plane link, the other is this file', () => {
    // FIVE CONDITIONS REACH rc 2 AND THE MESSAGE HAS TO SAY WHICH. `stale`
    // and `unreadable` are the pair the spec calls out by name: "both mean
    // nobody decides, but one's remedy is file permissions and the other's is
    // the control-plane link". A document that is well-formed and merely past
    // its lease must not read as an absent one.
    h.makeRepo('demo');
    tag('demo', 'pool-b');
    plantPoolEpoch(h.home, POOL_BY_ID, { lease: 1 });   // 1970: expired
    const r = shFail2(`${WS_ADD} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('projection=stale');
    expect(r.stderr).not.toContain('projection=unreadable');
    expect(h.reg('demo-quiet-mesa', 'uuid')).toBeNull();
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

describe('the `_pool_ok` header states counts that stay honest', () => {
  it('both numbers the header claims match grep -c \'_pool_ok \' ccd/ccd and its comment split', () => {
    // Task 7 (docs-honesty) corrected this header from "kept for wave 2b,
    // not consumed today" to a plain count, exactly the kind of numeric
    // claim that goes stale the next time a call site is added or removed
    // without the prose being updated alongside it. The header's own
    // sentence names the grep that produces the number ("Measured:
    // `grep -c '_pool_ok ' ccd/ccd` finds N matching LINES now, M of them
    // call sites") — re-run that same pattern here and require both stated
    // numbers to still be true.
    //
    // CORRECTED AGAIN (merge review, M5): the header used to state ONE
    // number and label it "call sites", and this pin computed the LINE
    // count. Both were 16, so the suite was green — validating a quantity
    // the sentence was not claiming, while its own failure message named the
    // right one. Five of those sixteen lines are comments, so the real
    // call-site count is 11 and the header asserted 15. The header now
    // states both numbers and this pin checks both, each against the thing
    // it is labelled as.
    //
    // The call-site classifier is "the line, trimmed, does not start with
    // `#`". That is exact for `ccd/ccd` today (re-measured in the fix round
    // after the merge review (D-1966): SIX comment matches of seventeen lines, all
    // of them whole-line comments, and no code line carries a trailing comment
    // mentioning the pattern — this said "five" and was left in the present
    // tense while the header above it was corrected to 17/11, so the pin's own
    // prose went stale in the commit that corrected the prose it pins). A
    // future code line with
    // `_pool_ok ` inside a trailing comment would be counted as a call site
    // — this pin would then need a real tokenizer, not a looser regex.
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('THE THIRD CODE IS CONSUMED TODAY');
    expect(from, 'the _pool_ok header could not be found').toBeGreaterThan(-1);
    const block = src.slice(from, from + 400);
    const claimed = block.match(/finds (\d+) matching LINES now, (\d+) of\n?/);
    expect(claimed, 'the header no longer states its two counts in the expected shape').not.toBeNull();
    const statedLines = Number(claimed![1]);
    const statedCalls = Number(claimed![2]);
    // CORRECTED (final whole-branch review, M-1): the header's own cited
    // command is `grep -c`, which counts LINES containing a match, not
    // occurrences — `.match(/g)` counted occurrences instead, silently
    // measuring something else. Line count and occurrence count agreed at 16
    // WHEN THAT WAS WRITTEN, and only because no line in `ccd/ccd` holds two
    // `_pool_ok ` calls — which is still true at 17. Count lines here, so this
    // test measures the same thing the header's cited command measures.
    const matching = src.split('\n').filter((line) => line.includes('_pool_ok '));
    const calls = matching.filter((line) => !line.trim().startsWith('#'));
    expect(matching.length,
      `grep -c '_pool_ok ' ccd/ccd now finds ${matching.length} matching LINES, `
      + `but the header still claims ${statedLines}`).toBe(statedLines);
    expect(calls.length,
      `${calls.length} of those ${matching.length} lines are CALL SITES (the rest are comments), `
      + `but the header still claims ${statedCalls}`).toBe(statedCalls);
  });
});
