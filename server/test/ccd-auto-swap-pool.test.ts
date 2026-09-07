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
import { eventsOf, measOf } from './lifecycleHelpers.js';

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

  it('never names an account `_pool_for` did not offer', () => {
    seed(); tagPool('demo', 'pool-b'); disable('claude-b'); disable('claude-d');
    const why = h.sh(`_strand_why ${ID} demo`);
    expect(why, 'gpt is not home-able: it was never a candidate').not.toContain('gpt');
    expect(why, 'the account it is already stuck on is not a destination').not.toContain('claude:');
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

  it('a valid crossing marker on the HOME account survives the re-seed — "stay here on purpose" beats a retag', () => {
    // Row 44. No case above ever plants a `.crosspool` marker before ticking,
    // so none of them can tell the shipped `[[ -z "$crossed" ]]` guard from a
    // mutant that deletes it — both leave `.home` at `claude-b` because
    // nothing here ever asks for anything else. This is the fixture that
    // actually distinguishes them: a `prefer`-style marker records the HOME
    // account (ruling 8), so a wrong-pool `.home` that was crossed to
    // DELIBERATELY must not be silently re-seeded back into pool.
    seed(); tagPool('demo', 'pool-b');
    h.sh(`_reg_set ${ID} home claude; _reg_set ${ID} crosspool "1700000000 pool-b claude"`);
    writeLimits('claude-b', 10, 10);
    tick(AFFINITY);
    expect(h.reg(ID, 'home'), 'the crossed home is left exactly where the marker put it').toBe('claude');
    expect(eventsOf(h.home, 'rehome'), 'a crossed home is not a rehome').toHaveLength(0);
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

  it('strands an UNTAGGED project too — the pre-existing SILENT strand, made loud', () => {
    // ccd:11243 reached this state today with every account at the ceiling and
    // returned with no marker, no line and no stamp, retrying every 5 s for ever.
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
