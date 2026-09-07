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
