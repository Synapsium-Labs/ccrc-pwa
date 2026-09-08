// The pool half of the 5-second auto-swap tick (spec §5.5.3-§5.5.4, §5.8).
//
// `_auto_swap_check` and `_swap_target` stay REAL here — that is the whole
// point of the file, and it is what separates it from
// `ccd-auto-swap-hold.test.ts`, which stubs `_swap_target` because its subject
// is the hold rung and not the decision. Only `tmux`, `_dispatch_swap` and
// `notify.sh` are stubbed; `_avail` is left real and steered through
// `~/.cc-limits/<w>.json`, because half of these cases are about which
// predicate failed first and a stubbed `_avail` cannot answer that.
//
// FIXTURE HOME ONLY (`makeCcdHarness`) — HOME is ccd's single isolation
// boundary and nothing here may reach the live registry, tmux, or systemd.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import { eventsOf, measOf, decOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-auto-swap-pool-');
  // claude, claude-a -> pool-a ; claude-b -> pool-b ; gpt, claude-d untagged.
  // Re-seeded rather than hand-written: a fixture accounts.sh typed out here
  // would be a fourth copy of the roster.
  seedAccountsSh(h.home, POOLED_TEST_ROSTER);
});
afterEach(() => { h.cleanup(); });

const ID = 'claude-demo';
const PANE_PID = '4242';

const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string =>
  fs.existsSync(reg('swap.log')) ? fs.readFileSync(reg('swap.log'), 'utf8') : '';
const notices = (): string =>
  fs.existsSync(path.join(h.home, 'notify-log'))
    ? fs.readFileSync(path.join(h.home, 'notify-log'), 'utf8') : '';
const noticeLines = (): string[] => notices().split('\n').filter(Boolean);
const logLines = (verb: string): string[] =>
  swapLog().split('\n').filter((l) => l.includes(` ${verb} `));

const plantNotify = (): void => {
  fs.writeFileSync(reg('notify.sh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
};
const tagPool = (project: string, pool: string): void => {
  fs.mkdirSync(reg('pools'), { recursive: true });
  fs.writeFileSync(path.join(reg('pools'), project), pool);
};
const disable = (w: string): void => { fs.writeFileSync(reg(`${w}-disabled`), ''); };
const writeLimits = (w: string, five: number, seven: number): void => {
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));
};

/** The Codex shape `ccgpt-usage` writes: weekly only, `five` null. Mirrors
 *  `ccd-default-pool.test.ts`'s helper of the same name (PR #61) — `writeLimits`
 *  above CANNOT say it, because its signature takes `five: number` and an
 *  overflow lane has no 5h window at all. Both timestamps are load-bearing, not
 *  decoration: `_limit_field` zeroes a score whose `ts` is over a week old and
 *  zeroes one whose reset instant has passed, and either zero would make `_avail`
 *  pass and drop this candidate out of the census the case is about. Copied from
 *  #61's helper rather than imported: its version is a module-local `const`, not
 *  an export. */
const writeWeeklyOnly = (w: string, seven: number): void => {
  const now = Math.floor(Date.now() / 1000);
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five: null, seven, ts: now, fiveResetAt: null, sevenResetAt: now + 400_000 }));
};

/** Installs an overflow lane. `makeCcdHarness` stubs the roster's HOME-ABLE ids
 *  only ("A non-home-able account deliberately gets NO stub"), so a case about an
 *  INSTALLED one has to say so itself — and a case that forgets to gets a green
 *  `not.toContain` for the wrong reason, which is the defect the negative case
 *  below was relabelled for. Deliberately NOT hoisted into `beforeEach`: five
 *  hard-coded strand-reason strings elsewhere in this file, and the `_strand_mark`
 *  banner assertion, all enumerate the census and would shift. */
const install = (w: string): void => {
  fs.writeFileSync(path.join(h.home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });
};

/** A live-looking session on `claude`, written with `_reg_set` — the same
 *  writer ccd uses. `lastswap`/`swapblocked` are deliberately absent so both
 *  cooldown gates are open, and NO `.home` file is written, so `_home_for`
 *  falls back to the id prefix exactly as a pre-2026-07-28 row does. */
const seed = (): void => {
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
  h.sh(`_reg_set ${ID} uuid 11111111-1111-4111-8111-111111111111
    _reg_set ${ID} project demo
    _reg_set ${ID} workdir "$HOME/projects/demo"
    _reg_set ${ID} wrapper claude
    _reg_set ${ID} started 1`);
};

/** `ccd-auto-swap-hold.test.ts`'s AFFINITY fixture, with `_swap_target` and
 *  `_avail` left REAL: a pane at a clean prompt, a pane pid, and a dispatch
 *  that logs instead of running systemd-run. */
const AFFINITY = `
  tmux() { case "\${1:-}" in
             capture-pane) printf '%s\\n' "❯ " ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

/** The RESCUE fixture: a real limit banner, matched by the REAL
 *  `_pane_hard_blocked` — the classifier IS the discriminator here. */
const BLOCKED = `
  tmux() { case "\${1:-}" in
             capture-pane) echo "API Error: 429 Too Many Requests" ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

/** BLOCKED, but with `_dispatch_swap` left REAL and the seam BELOW it stubbed
 *  instead. `_dispatch_swap` takes only `id target` and BUILDS the `ccd swap`
 *  command itself, so a fixture that stubs `_dispatch_swap` cannot see any flag
 *  the real one would have added — it drops everything past `$2`. Stubbing
 *  `_svc_run_detached` records the whole argv, which is the only place the
 *  presence or absence of `--cross-pool` on an automatic move is decidable.
 *  Same technique as `ccd-crosspool.test.ts`'s self-swap fixture. */
const BLOCKED_REAL_DISPATCH = `
  tmux() { case "\${1:-}" in
             capture-pane) echo "API Error: 429 Too Many Requests" ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; return 0; };
`;

/** The status file the affinity arm's idle gate reads, under the CURRENT
 *  account's config dir (`_cfg_dir claude` -> `$HOME/.claude`). */
const idleStatus = (cfg = '.claude'): void => {
  const dir = path.join(h.home, cfg, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${PANE_PID}.json`),
    JSON.stringify({ status: 'idle', statusUpdatedAt: 1 }));
};

const tick = (stubs: string, n = 1): string =>
  h.sh(`${stubs} for ((i=0;i<${n};i++)); do _auto_swap_check ${ID}; done`);

describe('_strand_clear', () => {
  it('writes NOTHING when there is no strand — the `-e` test is what stops the spam', () => {
    seed();
    h.sh('for ((i=0;i<10;i++)); do _strand_clear ' + ID + '; done');
    expect(swapLog()).toBe('');
  });

  it('removes the marker and says so once when there IS one', () => {
    seed();
    h.sh(`_reg_set ${ID} stranded "1700000000 nowhere"; _strand_clear ${ID}; _strand_clear ${ID}`);
    expect(h.reg(ID, 'stranded')).toBeNull();
    expect(logLines('unstranded')).toHaveLength(1);
  });
});

describe('_strand_why names the candidates the decision was actually about', () => {
  it('annotates each `_pool_for` member with the FIRST predicate it failed', () => {
    seed(); tagPool('demo', 'pool-b');
    disable('claude-b');                 // in pool, but the lane is switched off
    writeLimits('claude-d', 99, 99);     // untagged, so in pool, but at the ceiling
    writeLimits('claude-a', 99, 99);     // ALSO at the ceiling — and in the wrong pool
    // claude-a fails BOTH the pool rule and _avail. The expected string is
    // only reachable if the pool check runs FIRST: `_avail` treats an
    // unmeasured account as available (its own "UNKNOWN IS AVAILABLE HERE"
    // rule), so without this second writeLimits call claude-a would never
    // reach `limit` under any ordering — it would just silently pass the
    // (untested) pool check and read `limit` for the wrong reason, or nothing
    // at all. With both predicates failing, `pool=pool-a` rather than `limit`
    // is what proves the pool arm is asked before `_avail`.
    expect(h.sh(`_strand_why ${ID} demo`))
      .toBe('claude-a:pool=pool-a claude-b:disabled claude-d:limit');
  });

  it('NAMES an installed overflow lane — after PR #61 it IS in `_pool_for`', () => {
    // THE RULING, AS A MECHANISM. Operator decision 2026-09-07 (PR #61) put an
    // installed, non-kill-switched overflow lane back into every pool, and wave
    // 2b's `_strand_why` walks `_pool_for`, so the census must name it. Before
    // this case the tree measured nothing of the kind: `_strand_why` is wholly
    // new in 2b and every one of its fixtures leaves the lane uninstalled.
    //
    // WHY EVERY PIECE IS LOAD-BEARING, and none of it is decoration:
    //  - `install('gpt')` — the harness stubs home-able ids only, so without it
    //    `_account_ok gpt` fails and the lane is absent for the wrong reason.
    //  - `seven: 99` — `SWAP_CEILING` is 98 (`grep -n 'SWAP_CEILING=' ccd/ccd`).
    //    At 97 the lane passes `_avail`, `_strand_why` has no else branch, and
    //    it vanishes from the census having proved nothing.
    //  - `gpt:limit` LAST — `_default_pool` seeds the home-able ids and APPENDS
    //    the overflow lane, so the order is a property of the code.
    //  - `toBe`, not `toContain('gpt:limit')` — the exact string is what pins
    //    the POSITION, which `toContain` cannot see. CORRECTED in the fix round
    //    after the merge review (D-1960): this used to add "since a missing binary
    //    would read `gpt:missing` and still contain the substring 'gpt'", and
    //    that reason is invented. `_default_pool` applies `_account_ok` before
    //    appending an overflow lane, so an uninstalled one never reaches this
    //    walk at all — it is ABSENT from the census, never `:missing`, and the
    //    weaker matcher would have caught a failed `install` too. The same
    //    harness confusion D-1909 is about, resurfacing one case earlier and in
    //    my own text this time.
    //
    // NOT pinned here, and deliberately not claimed: this case cannot pin the
    // PREDICATE ORDER for gpt. Only one annotation is reachable for an untagged,
    // installed lane — `:pool=` cannot fire (untagged is servable for every
    // pool) and `:disabled`/`:missing` cannot (`_default_pool` already applied
    // `_account_ok` before this walk sees the list) — so no reordering could
    // change its token. The order is pinned for `claude-a` by the first case
    // in this describe.
    seed(); tagPool('demo', 'pool-b'); disable('claude-b'); disable('claude-d');
    install('gpt'); writeWeeklyOnly('gpt', 99);
    expect(h.sh(`_strand_why ${ID} demo`))
      .toBe('claude-a:pool=pool-a claude-b:disabled claude-d:disabled gpt:limit');
  });

  it('never names an account `_pool_for` did not offer', () => {
    // RELABELLED at the wave-2b merge (D-1909), and the label is the whole defect. This
    // read 'gpt is not home-able: it was never a candidate' — a green assertion
    // stating a reason its own fixture does not establish. gpt is absent here
    // because `makeCcdHarness` installs stubs for home-able ids only, so
    // `_account_ok gpt` fails: absent for NOT BEING INSTALLED, which is a
    // different fact, and after PR #61 the stated one is simply false. The
    // assertion was always true; only its reason was invented.
    //
    // KEPT rather than replaced, and extended with a kill-switch arm, because
    // the negative direction is still worth measuring: `_default_pool` filters
    // the overflow half on installation AND on the kill-switch, and the positive
    // case above cannot see either filter.
    seed(); tagPool('demo', 'pool-b'); disable('claude-b'); disable('claude-d');
    const why = h.sh(`_strand_why ${ID} demo`);
    expect(why, 'an overflow lane nobody installed was never a candidate').not.toContain('gpt');
    expect(why, 'the account it is already stuck on is not a destination').not.toContain('claude:');
    install('gpt'); disable('gpt'); writeWeeklyOnly('gpt', 99);
    expect(h.sh(`_strand_why ${ID} demo`),
      'a kill-switched lane is not a candidate either').not.toContain('gpt');
  });

  it('answers ONE undecidable token rather than inventing a reason per candidate', () => {
    seed(); tagPool('demo', 'Pool Orate');
    expect(h.sh(`_strand_why ${ID} demo`))
      .toBe(`tag:malformed ${h.home}/.cc-sessions/pools/demo`);
  });
});

describe('_strand_mark', () => {
  it('marks once, logs once and banners once across ten calls', () => {
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');
    h.sh(`for ((i=0;i<10;i++)); do _strand_mark ${ID} claude demo; done`);
    expect(h.reg(ID, 'stranded'))
      .toMatch(/^\d{10} claude-a:pool=pool-a claude-b:disabled claude-d:disabled$/);
    expect(logLines('stranded')).toHaveLength(1);
    expect(noticeLines()).toHaveLength(1);
    expect(noticeLines()[0])
      .toBe(`cc swap STRANDED: ${ID} is blocked on claude and no account in pool pool-b can take it`
        + ' — claude-a:pool=pool-a claude-b:disabled claude-d:disabled');
    expect(h.reg(ID, 'strandnotify')).toMatch(/^\d{10}$/);
  });

  it('re-marks after a clear but does NOT re-banner inside the floor', () => {
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');
    h.sh(`_strand_mark ${ID} claude demo; _strand_clear ${ID}; _strand_mark ${ID} claude demo`);
    expect(logLines('stranded'), 'the marker follows the truth').toHaveLength(2);
    expect(logLines('unstranded')).toHaveLength(1);
    expect(noticeLines(), 'only the BANNER is floored').toHaveLength(1);
  });

  it('banners again once the floor has passed', () => {
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');
    h.sh(`_strand_mark ${ID} claude demo`);
    // SWAPBLOCK_COOLDOWN is 1800s; back-date the stamp past it.
    h.sh(`_reg_set ${ID} strandnotify $(( $(date +%s) - 1801 ))`);
    h.sh(`_strand_clear ${ID}; _strand_mark ${ID} claude demo`);
    expect(noticeLines()).toHaveLength(2);
  });

  it('says `(untagged)` in the banner and `[pool=-]` in the log for an untagged project', () => {
    seed(); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    h.sh(`_strand_mark ${ID} claude demo`);
    expect(swapLog()).toContain(`stranded ${ID}: claude (blocked) -> nowhere [pool=-]`);
    expect(notices()).toContain('no account in pool (untagged) can take it');
  });
});

describe('_crosspool_valid', () => {
  const valid = (pps: string, ...accts: string[]): string =>
    h.sh(`_crosspool_valid ${ID} "${pps}" ${accts.join(' ')} && echo yes || echo no`);
  const marker = (): void => { h.sh(`_reg_set ${ID} crosspool "1700000000 pool-a claude-b"`); };

  it('is false with no marker at all — one stat, no `cat`', () => {
    seed();
    expect(valid('named pool-a', 'claude-b')).toBe('no');
  });

  it('is true while the project pool AND the account both still match', () => {
    seed(); marker();
    expect(valid('named pool-a', 'claude-b')).toBe('yes');
    // The `home` clause: a `prefer --cross-pool` puts the marker on the home,
    // so callers pass both and either may satisfy it.
    expect(valid('named pool-a', 'claude', 'claude-b')).toBe('yes');
  });

  it('is false once the project was retagged or untagged', () => {
    seed(); marker();
    expect(valid('named pool-b', 'claude-b')).toBe('no');
    expect(valid('untagged', 'claude-b')).toBe('no');
    expect(valid('unreadable', 'claude-b')).toBe('no');
  });

  it('is false once the session moved off the crossed account', () => {
    seed(); marker();
    expect(valid('named pool-a', 'claude-a')).toBe('no');
  });
});

describe('_swap_target and the pool', () => {
  const target = (cur: string, home: string, force = ''): string =>
    h.sh(`_swap_target ${ID} ${cur} ${home} ${force} || true`);

  it('treats a wrong-pool current account as a MUST-LEAVE (force=pool skips both stay shortcuts)', () => {
    seed(); tagPool('demo', 'pool-b');
    writeLimits('claude', 1, 1);        // telemetry says home is fine: pre-pool, the answer was ""
    writeLimits('claude-b', 50, 50);
    expect(target('claude', 'claude')).toBe('claude-b');
  });

  it('never returns to a wrong-pool home', () => {
    seed(); tagPool('demo', 'pool-b');
    h.sh(`_reg_set ${ID} home claude`);
    // cur is IN pool and home is not: the home-recovered branch must not fire,
    // so the answer is "stay put" rather than a move onto the wrong pool.
    expect(target('claude-b', 'claude')).toBe('');
    // …and under force, the loop answers with an IN-POOL account, never home.
    expect(target('claude-b', 'claude', '1')).toBe('claude-d');
  });

  it('filters the candidate loop AFTER _pool_for — a hand-set registry `pool` list cannot land out of pool', () => {
    seed(); tagPool('demo', 'pool-b');
    h.sh(`_reg_set ${ID} pool "claude-a claude-b"`);
    writeLimits('claude-a', 1, 1);      // by far the cheapest, and in the WRONG pool
    writeLimits('claude-b', 90, 90);
    expect(target('claude', 'claude', '1')).toBe('claude-b');
  });

  it('answers NOTHING when the tag cannot be read — nobody decides', () => {
    seed(); tagPool('demo', 'Pool Orate');   // two tokens and a capital: malformed
    writeLimits('claude', 99, 99);
    expect(target('claude', 'claude', '1')).toBe('');
  });

  it('a VALID crossing marker suppresses the must-leave force and admits the crossed home', () => {
    seed(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} home claude-b; _reg_set ${ID} crosspool "1700000000 pool-a claude-b"`);
    // cur == home == the crossed account: without the marker this is a
    // must-leave and the loop moves it back into pool-a.
    expect(target('claude-b', 'claude-b')).toBe('');
  });

  it('admits the CROSSED home through the home-recovered branch', () => {
    seed(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} home claude-b`);
    // cur != home IS WHAT MAKES THIS CASE ABLE TO FAIL AT ALL. The case
    // above sets cur == home == the crossed account, where the cur==home
    // shortcut answers '' regardless of the marker and the home-recovered
    // branch is never reached — it cannot tell "the escape works" from "the
    // escape is missing". Here cur=claude is IN pool-a (no must-leave force),
    // so the branch actually runs and the marker's `cross_home` escape is
    // the only thing standing between the two expectations below.
    expect(target('claude', 'claude-b')).toBe('');          // no marker: the guard refuses the wrong-pool home
    h.sh(`_reg_set ${ID} crosspool "1700000000 pool-a claude-b"`);
    expect(target('claude', 'claude-b')).toBe('claude-b');  // marker: the crossed home is admitted
  });
});

describe('the tick re-seeds a wrong-pool home (§5.5.4 step 1)', () => {
  it('re-seeds inside ONE tick, journals `rehome`, and writes a FIRST .home for a row that had none', () => {
    seed(); tagPool('demo', 'pool-b'); idleStatus();
    writeLimits('claude-b', 10, 10); writeLimits('claude-d', 60, 60);
    expect(h.reg(ID, 'home'), 'the fixture must start with no .home at all').toBeNull();
    tick(AFFINITY);
    expect(h.reg(ID, 'home')).toBe('claude-b');
    const rows = eventsOf(h.home, 'rehome');
    expect(rows).toHaveLength(1);
    expect(measOf(rows[0]!))
      .toMatchObject({ from: 'claude', home: 'claude-b', reason: 'pool', pool: 'pool-b' });
    expect(swapLog()).toContain(`rehome ${ID}: home claude -> claude-b [pool=pool-b]`);
  });

  it('CLOBBERS a pre-existing wrong-pool .home — not `_ws_seed_home`, which never overwrites what is already there', () => {
    // No case in this file plants a `.home` BEFORE the tag it disagrees with,
    // so none of them can tell `_reg_set` from `_ws_seed_home` swapped in for
    // it: on a row that starts with no `.home` at all (the case above),
    // `_ws_seed_home`'s own "set once" guard writes it just as readily as
    // `_reg_set` does — the two are indistinguishable on a first write. A row
    // seeded before its project was ever tagged, or hand-set by an operator,
    // is the one this guards: `_ws_seed_home`'s contract is "never clobber a
    // deliberate choice", which is exactly backwards here — the retag IS the
    // new deliberate choice, and it must win over the stale file.
    seed(); tagPool('demo', 'pool-b');
    h.sh(`_reg_set ${ID} home claude-a`);
    writeLimits('claude-b', 10, 10);
    tick(AFFINITY);
    expect(h.reg(ID, 'home'), 'the pre-existing wrong-pool home is overwritten').toBe('claude-b');
    expect(measOf(eventsOf(h.home, 'rehome')[0]!)).toMatchObject({ from: 'claude-a', home: 'claude-b' });
  });

  it('is IDEMPOTENT: a second tick leaves .home byte-identical and writes no second row', () => {
    seed(); tagPool('demo', 'pool-b'); idleStatus(); writeLimits('claude-b', 10, 10);
    tick(AFFINITY);
    const first = fs.readFileSync(reg(`${ID}.home`));
    tick(AFFINITY);
    expect(fs.readFileSync(reg(`${ID}.home`))).toEqual(first);
    expect(eventsOf(h.home, 'rehome')).toHaveLength(1);
    expect(logLines('rehome')).toHaveLength(1);
  });

  it('re-seeds ABOVE the cooldown gates — a session inside SWAP_COOLDOWN still gets its home fixed', () => {
    // The move waits for the gate (D-1675); the pinned home does not, because a
    // wrong-pool `.home` is what the affinity arm would pull the session BACK to.
    seed(); tagPool('demo', 'pool-b'); writeLimits('claude-b', 10, 10);
    h.sh(`_reg_set ${ID} lastswap "$(date +%s)"`);
    tick(AFFINITY);
    expect(h.reg(ID, 'home')).toBe('claude-b');
    expect(h.calls().join('\n'), 'the MOVE is still gated').not.toContain('dispatch');
  });

  it('a valid crossing marker on the HOME account (a `prefer`-style crossing) survives the re-seed — "stay here on purpose" beats a retag', () => {
    // Row 44, fix round 1 (Important 3). The ORIGINAL version of this case
    // set `wrapper` and `home` to the SAME account (`claude`, seed()'s
    // default), so the marker's account matched BOTH arguments and the case
    // could not tell `_crosspool_valid`'s `"$home"` argument from its
    // `"$wrapper"` one — measured, three separate mutations (dropping either
    // argument from the call, or dropping `[[ -z "$crossed" ]]` from the
    // affinity-verb guard below) all stayed green at 32/32. `wrapper` and
    // `home` are now DIFFERENT accounts: a `prefer`-style marker records the
    // HOME account (ruling 8), and `wrapper` sits in-pool throughout, so
    // only a read of `"$home"` can possibly match here.
    seed(); tagPool('demo', 'pool-b');
    h.sh(`_reg_set ${ID} wrapper claude-b; _reg_set ${ID} home claude-a; `
      + `_reg_set ${ID} crosspool "1700000000 pool-b claude-a"`);
    tick(AFFINITY);
    expect(h.reg(ID, 'home'), 'the crossed home is left exactly where the marker put it').toBe('claude-a');
    expect(eventsOf(h.home, 'rehome'), 'a crossed home is not a rehome').toHaveLength(0);
  });

  it('a valid crossing marker on the WRAPPER account (a `swap`-style crossing) suppresses the auto-pool verb too', () => {
    // The companion to the case above: `wrapper` is the wrong-pool crossed
    // account and `home` is ALREADY correct, so the re-seed has nothing to
    // do here either way — this case is about `crossed`'s OTHER reader, the
    // affinity-verb decision. A mutant that reads only `"$home"` (dropping
    // `"$wrapper"` from the `_crosspool_valid` call) or one that drops
    // `[[ -z "$crossed" ]]` from the verb guard both mislabel this
    // deliberate crossing as a retag and log `auto-pool` instead of
    // `auto-home`.
    seed(); tagPool('demo', 'pool-b'); idleStatus('.claude-a');
    h.sh(`_reg_set ${ID} wrapper claude-a; _reg_set ${ID} home claude-b; `
      + `_reg_set ${ID} crosspool "1700000000 pool-b claude-a"`);
    writeLimits('claude-b', 10, 10);
    tick(AFFINITY);
    expect(swapLog()).toContain(`auto-home ${ID}: claude-a -> claude-b [home=claude-b]`);
    expect(swapLog(), 'a deliberate crossing is not a retag').not.toContain('auto-pool');
  });

  it('DELIBERATE FOLD: a wrapper-arm (`swap`) marker also suppresses the re-seed of an UNRELATED wrong-pool home', () => {
    // Review round 1, Minor 2. `crossed` is one bit answering "is this row
    // under a deliberate crossing at all?", folding `_crosspool_valid`'s
    // separate `wrapper`/`home` answers together — deliberately, per the
    // comment above the `_crosspool_valid` call. Here the marker names
    // `wrapper` (a `swap`-style crossing) and `home` is a DIFFERENT account
    // the marker never mentions, but `home` is ALSO wrong-pool (a plain
    // pre-existing retag, unrelated to the crossing). The fold means this
    // unrelated wrong-pool home is left exactly as it was — not fixed —
    // because `crossed` is set via `wrapper` alone. `_swap_target` will
    // ALSO refuse to send the session back to this `home` (its own
    // `cross_home` check asks about `home` specifically and finds no
    // match), so the row is stuck with a home it can neither return to nor
    // have repaired until the crossing ends — the documented cost, not a
    // bug to chase.
    seed(); tagPool('demo', 'pool-b');
    h.sh(`_reg_set ${ID} wrapper claude-a; _reg_set ${ID} home claude; `
      + `_reg_set ${ID} crosspool "1700000000 pool-b claude-a"`);
    writeLimits('claude-b', 10, 10);
    tick(AFFINITY);
    expect(h.reg(ID, 'home'), 'the fold leaves an unrelated wrong-pool home unfixed for the life of the crossing')
      .toBe('claude');
    expect(eventsOf(h.home, 'rehome')).toHaveLength(0);
  });
});

describe('the tick moves a retagged session (§5.5.4 step 5)', () => {
  it('moves on the AFFINITY arm with the verb `auto-pool` — the cause was a retag, not the ceiling', () => {
    seed(); tagPool('demo', 'pool-b'); idleStatus(); writeLimits('claude-b', 10, 10);
    tick(AFFINITY);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-b`);
    expect(swapLog()).toContain(`auto-pool ${ID}: claude -> claude-b [home=claude-b]`);
    expect(swapLog(), 'the ceiling did not cause this move').not.toContain('auto-home');
  });

  it('DEFERS the move while a hold stands — but still re-seeds the home', () => {
    // The hold rung must not move (§14 O3): a retag is an affinity-class
    // relocation and a mid-wave worker stays put until release. The re-seed
    // sits ABOVE the rung, so the deferral is visible rather than invisible.
    seed(); tagPool('demo', 'pool-b'); idleStatus(); writeLimits('claude-b', 10, 10);
    fs.writeFileSync(reg(`${ID}.hold`), 'program:demo wave:2/4 run:17');
    tick(AFFINITY);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    expect(h.reg(ID, 'lastswap'), 'a deferred tick stamps nothing').toBeNull();
    expect(h.reg(ID, 'home'), 'the re-seed runs above the hold rung').toBe('claude-b');
  });

  it('RESCUES a hard-blocked wrong-pool session at once, IN POOL, past the hold rung', () => {
    // claude-a is by far the cheapest lane and in the WRONG pool: a rescue that
    // ignored the filter would land there, which is the crossing ruling 6 forbids.
    seed(); tagPool('demo', 'pool-b');
    writeLimits('claude-a', 1, 1); writeLimits('claude-b', 10, 10);
    fs.writeFileSync(reg(`${ID}.hold`), 'held');
    tick(BLOCKED);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-b`);
    expect(swapLog()).toContain(`auto-rescue ${ID}: claude (blocked) -> claude-b`);
    expect(fs.existsSync(reg(`${ID}.stranded`)), 'a rescue is not a strand').toBe(false);
  });
});

describe('the tick strands rather than crossing (§5.5.4 steps 3-4, ruling 6)', () => {
  it('OVERFLOWS to an untagged lane rather than stranding — the composed rule, ruled and shipped', () => {
    // THE ONE STATE NEITHER PARENT PRODUCES ALONE, pinned as a mechanism rather
    // than left to the prose. Operator ruling 2026-09-08 (D-1908): ship as merged.
    //
    // Project tagged `pool-b`. Its in-pool home-able members are pinned at the
    // ceiling. `claude`/`claude-a` are HEALTHY and untouched — they have no
    // limits file at all, so `_avail` treats them as available — but they sit in
    // `pool-a`, so `_pool_ok` refuses them. `gpt` is untagged, which under
    // `_pool_ok`'s own rule (`[[ -z "$ap" || "$ap" == "$pp" ]]`) makes it a
    // member of EVERY pool, and PR #61 put an installed, non-kill-switched lane
    // back into `_pool_for`. So the home-able bracket is empty while healthy
    // home-able accounts exist, and the last-resort bracket wins.
    //
    // Pure #61 would pick a healthy Anthropic account here; pure wave 2b would
    // strand and banner. The merge picks gpt. That divergence is RULED, not a
    // defect, and it carries its own ledger number.
    //
    // THE SECOND HALF OF THE RULING IS THE RECORD, and it is the half a comment
    // could not enforce: this move is NOT a crossing under this tree's own
    // definition, so it must leave NO marker, NO `cross-pool` log line and NO
    // `dec.crosspool`. Asserted below, because "we decided not to record it" and
    // "we forgot to record it" look identical in a log six months from now.
    seed(); plantNotify(); tagPool('demo', 'pool-b');
    writeLimits('claude-b', 99, 99);          // the only tagged pool-b member, pinned
    writeLimits('claude-d', 99, 99);          // untagged, so in pool-b too — pinned
    install('gpt'); writeWeeklyOnly('gpt', 0);   // installed, untagged, wide open
    tick(BLOCKED_REAL_DISPATCH);
    // ON THE REAL CONSTRUCTION SITE, and this is the whole point of the fixture
    // choice. CORRECTED after the merge review (D-1955): the first version of this
    // case stubbed `_dispatch_swap`, whose stub records only `$1 -> $2` — so the
    // mutation that undoes the ruling the NATURAL way (dispatch the overflow move
    // with `--cross-pool`, letting `cmd_swap` take its crossing arm and record it)
    // left all 39 cases GREEN. Measured. The absence half was not pinned at all,
    // in the case written to pin it. `_dispatch_swap` is real here and
    // `_svc_run_detached` records the whole argv, so the flag is decidable.
    const argv = h.calls().join('\n');
    expect(argv, 'the last-resort bracket wins').toMatch(
      new RegExp(`exec '[^']*/ccd' swap '${ID}' 'gpt'`));
    expect(argv, 'a healthy account in the WRONG pool is still refused').not.toContain(`'claude-a'`);
    expect(argv, 'NO --cross-pool: an untagged lane crosses nothing, so the move claims nothing')
      .not.toContain('--cross-pool');
    expect(swapLog(), 'and the tick logged the dispatch it made').toContain(`dispatch ${ID} -> gpt`);
    expect(h.reg(ID, 'stranded'), 'a destination exists, so this is not a strand').toBeNull();
    expect(noticeLines(), 'nothing to announce').toHaveLength(0);
    expect(h.reg(ID, 'crosspool'), 'an untagged lane crosses nothing — no marker').toBeNull();
    expect(swapLog(), 'and no crossing is logged').not.toContain('cross-pool');
    // The journal half, asserted on the ROW rather than on the row list. An
    // `arrayContaining` over a whole `dec` object was the first shape here and it
    // could not have failed (D-1921): `dec` is `{surface:'none'}`, so a matcher demanding
    // `{crosspool:'1'}` misses for the wrong reason and would go on missing if
    // `dec.crosspool` really were emitted. Read the key.
    const rows = eventsOf(h.home, 'rehome');
    expect(rows, 'the tick re-homes as well as dispatching').toHaveLength(1);
    expect(decOf(rows[0]!)['crosspool'], 'no dec.crosspool — this is not a crossing').toBeUndefined();
    expect(measOf(rows[0]!)['reason'], 'the re-home reason is the pool rule').toBe('pool');
    expect(measOf(rows[0]!)['home'],
      'and home is re-seeded IN pool, even though the move itself went to the overflow lane')
      .toBe('claude-b');
  });

  it('STRANDS when the untagged lane is at its ceiling too, naming it in the reason', () => {
    // The contrast that proves the case above measures the RULING and not merely
    // "some destination existed". Identical fixture, one number changed: the
    // overflow lane is at 99 against a `SWAP_CEILING` of 98, so `_avail` refuses
    // it, the last-resort bracket is empty as well, and the tick strands — with
    // `gpt:limit` in the census, which is the very annotation the relabelled
    // `_strand_why` case above exists to license.
    seed(); plantNotify(); tagPool('demo', 'pool-b');
    writeLimits('claude-b', 99, 99);
    writeLimits('claude-d', 99, 99);
    install('gpt'); writeWeeklyOnly('gpt', 99);
    tick(BLOCKED);
    expect(h.calls().join('\n'), 'nothing is placeable').not.toContain('dispatch');
    expect(h.reg(ID, 'stranded'))
      .toMatch(/^\d{10} claude-a:pool=pool-a claude-b:limit claude-d:limit gpt:limit$/);
    expect(logLines('stranded')).toHaveLength(1);
  });

  it('marks ONCE over ten ticks, with one log line and one banner', () => {
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');   // nothing in pool-b, nothing untagged, is placeable
    tick(BLOCKED, 10);
    expect(h.calls().join('\n'), 'never cross').not.toContain('dispatch');
    expect(h.reg(ID, 'stranded'))
      .toMatch(/^\d{10} claude-a:pool=pool-a claude-b:disabled claude-d:disabled$/);
    expect(logLines('stranded')).toHaveLength(1);
    expect(noticeLines()).toHaveLength(1);
    expect(h.reg(ID, 'lastswap'), 'no stamp, so the first recovery tick rescues at once').toBeNull();
  });

  it('CLEARS the strand when the pane recovers, and says so', () => {
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');
    tick(BLOCKED);
    expect(fs.existsSync(reg(`${ID}.stranded`))).toBe(true);
    tick(AFFINITY);
    expect(fs.existsSync(reg(`${ID}.stranded`))).toBe(false);
    expect(logLines('unstranded')).toHaveLength(1);
  });

  it('CLEARS the strand on a RESCUE too, even while the pane still shows the SAME banner — the `_strand_clear` after the target check is load-bearing', () => {
    // Review round 1, Important 2. Every case above clears the strand only
    // via the AFFINITY fixture (a clean pane), which never exercises this
    // SPECIFIC `_strand_clear` — the one AFTER a destination is found,
    // reached on the RESCUE path too. Reproduced exactly as measured: strand
    // first (pool-b empty), then let claude-b recover while the pane STILL
    // shows the identical 429 banner (hard_blocked stays true across both
    // ticks, so this never takes the AFFINITY branch at all). Replacing this
    // line with `:` leaves the marker behind after a successful rescue,
    // which means the row's NEXT genuine strand is announced nowhere —
    // `_strand_mark`'s own debounce (`[[ ! -e "$REG/$id.stranded" ]]`) reads
    // the stale marker and stays silent, the exact silent-strand failure
    // this task exists to abolish, reintroduced for the rows that already
    // hit it once.
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');
    tick(BLOCKED);
    expect(fs.existsSync(reg(`${ID}.stranded`))).toBe(true);
    fs.rmSync(reg('claude-b-disabled'));
    tick(BLOCKED);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-b`);
    expect(fs.existsSync(reg(`${ID}.stranded`)), 'the marker must not survive a rescue').toBe(false);
    expect(logLines('unstranded')).toHaveLength(1);
  });

  it('strands an UNTAGGED project too — the pre-existing SILENT strand, made loud', () => {
    // Before wave 2b, `_auto_swap_check`'s bare `|| return 0` after
    // `_swap_target` reached this state with every account at the ceiling and
    // returned with no marker, no line and no stamp, retrying every 5 s for
    // ever. (Cited as `ccd:11243` until the fix round after the merge review,
    // D-1966: that line number now lands on an unrelated comment about git's
    // trailing newline — the grep form is what survives an edit above it.)
    seed(); plantNotify();                       // deliberately no tag at all
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    tick(BLOCKED, 10);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    expect(h.reg(ID, 'stranded')).toMatch(/^\d{10} claude-a:limit claude-b:limit claude-d:limit$/);
    expect(swapLog()).toContain(`stranded ${ID}: claude (blocked) -> nowhere [pool=-]`);
    expect(notices()).toContain('no account in pool (untagged) can take it');
  });

  it('writes NOTHING to swap.log across ten healthy ticks on a never-stranded session', () => {
    // The `-e` test inside `_strand_clear`, measured at the tick rather than at
    // the helper: ~20 live sessions x 12 ticks a minute is the real load.
    seed(); idleStatus();
    h.sh(`echo sentinel >> "$HOME/.cc-sessions/swap.log"`);
    const before = fs.readFileSync(reg('swap.log'));
    tick(AFFINITY, 10);
    expect(fs.readFileSync(reg('swap.log'))).toEqual(before);
  });

  it('the marker toggles on every flip while the BANNER is floored', () => {
    // `_pane_hard_blocked` greps the last eight pane lines, so a scrolling limit
    // banner flips the verdict tick by tick. Each flip is a legitimate
    // mark -> clear -> mark; only the banner waits out SWAPBLOCK_COOLDOWN.
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');
    for (let i = 0; i < 5; i++) {
      tick(BLOCKED);
      expect(fs.existsSync(reg(`${ID}.stranded`)), `blocked tick ${i}`).toBe(true);
      tick(AFFINITY);
      expect(fs.existsSync(reg(`${ID}.stranded`)), `clear tick ${i}`).toBe(false);
    }
    expect(logLines('stranded')).toHaveLength(5);
    expect(logLines('unstranded')).toHaveLength(5);
    expect(noticeLines(), 'one banner, not five').toHaveLength(1);
  });
});

describe('_reg_purge`s dot-free inventory', () => {
  it('names the three per-id fields this build adds', () => {
    // `_reg_purge` matches the SUFFIX SHAPE, not a list, so the purge itself is
    // already right — but ccd's own comment says an inventory that omits files
    // is one a future reader trusts and a future writer copies. These three are
    // registry fields under the one-dot rule and purge with the row; that is
    // exactly why they need no lifecycle-manifest entry of their own, and this
    // is the only place that claim is written down.
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('The dot-free claim, measured against every registry file');
    expect(from, 'the inventory comment could not be found').toBeGreaterThan(-1);
    const block = src.slice(from, from + 1400);
    for (const f of ['`crosspool`', '`stranded`', '`strandnotify`']) {
      expect(block, `${f} is written by this build and missing from the inventory`).toContain(f);
    }
  });
});

describe('the candidate-walk count in `ccd/ccd` stays honest (A1)', () => {
  it('both numbers #61\'s block claims match its own cited grep', () => {
    // A MECHANISM, NOT A COMMENT. #61's "THE FOUR CANDIDATE WALKS DO NOT AGREE"
    // block states a count and cites the grep that produces it. Until the fix
    // round after the wave-2b merge review (D-1956) it said "finds four" while the cited
    // command answers FIVE — four walks plus one PROSE line inside
    // `_default_pool` quoting the pattern — so the sentence written to stop the
    // number drifting could not be re-measured, and nothing anywhere pinned it:
    // `git grep -n 'CANDIDATE WALKS' -- server/test` was empty, so changing the
    // digit to seven kept every suite green.
    //
    // Same shape as `ccd-pool-ok.test.ts`'s `_pool_ok` header pin, deliberately:
    // that one had this exact defect (one number, labelled as the thing it was
    // not counting) and was corrected once already. Two quantities are stated,
    // so both are checked, and each message names which one is wrong.
    //
    // The walk/prose split is "the line, trimmed, does not start with `#`" —
    // exact for `ccd/ccd` today (measured: the one prose match is a whole-line
    // comment). A code line with the pattern inside a trailing comment would be
    // miscounted as a walk, and this pin would then need a real tokenizer.
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('CANDIDATE WALKS DO NOT AGREE');
    expect(from, "#61's candidate-walk block could not be found").toBeGreaterThan(-1);
    // FLATTENED before matching: the claim wraps across comment lines, so a
    // line-oriented regex misses it and the pin would fail for the wrong
    // reason. (It did, on the first run of this very test.)
    const block = src.slice(from, from + 900).replace(/\n\s*#\s?/g, ' ');
    const claimed = block.match(/finds (\d+) matching LINES, (\d+) of them walks/);
    expect(claimed, 'the block no longer states its two counts in the expected shape').not.toBeNull();
    const statedLines = Number(claimed![1]);
    const statedWalks = Number(claimed![2]);
    // The block's own cited pattern, re-run here rather than paraphrased.
    const re = /for (w|cand) in (\$\(_pool_for|"\$\{CCRC_HOME_ABLE\[@\]\}")/;
    const matching = src.split('\n').filter((line) => re.test(line));
    const walks = matching.filter((line) => !line.trim().startsWith('#'));
    expect(matching.length,
      `the block's own grep now finds ${matching.length} matching LINES, `
      + `but it still claims ${statedLines}`).toBe(statedLines);
    expect(walks.length,
      `${walks.length} of those ${matching.length} lines are WALKS (the rest are prose), `
      + `but the block still claims ${statedWalks}`).toBe(statedWalks);
  });
});
