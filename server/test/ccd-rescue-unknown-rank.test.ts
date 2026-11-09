// An unmeasured home never outranks measured room on a forced rescue (D-8123, limit-swap-autofix Task 3).
//
// `_swap_target`'s home-recovered arm has no `force` condition on purpose: a forced call that finds home recovered
// goes straight there rather than pick a third lane. But "recovered" is read by `_avail`, which passes an account
// whose usage nobody measured, so on a forced rescue (cur != home) an unmeasured home was returned before the
// candidate loop ranked anything, ahead of a measured account with room. A forced call now lets an unmeasured home
// fall through to the loop, where it ranks like any other unmeasured candidate (after every measured one) and is
// still eligible when nothing measured has room. The unforced call (the D-6181 affinity return home) is unchanged.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). Neutral ids: the session `lane-a-project-a`, the fixture roster's wrappers
// (`claude`, `claude-a`, `claude-b`, `claude-d`, `gpt`). Nothing here reaches a pane, so no key can be sent.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, plantPoolEpoch, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { POOLED_TEST_ROSTER, POOL_BY_ID } from './fixtures/poolRule.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-rescue-unknown-rank-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-0000000000e3';
const T0 = Math.floor(Date.now() / 1000);

const seed = (wrapper: string, home: string): void => {
  h.sh(`_reg_set ${ID} wrapper ${wrapper}
        _reg_set ${ID} home ${home}
        _reg_set ${ID} project project-a
        _reg_set ${ID} workdir "$HOME/projects/project-a"
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'project-a'), { recursive: true });
};
/** `~/.cc-limits/<w>.json`: both windows measured, a fresh `ts`. */
const limits = (w: string, five: number, seven: number): void => {
  fs.mkdirSync(path.join(h.home, '.cc-limits'), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify({ five, seven, ts: T0 }));
};
/** `_swap_target id cur home force hrc` → "stdout rc=N". */
const target = (cur: string, home: string, force: string): string =>
  h.sh(`out=$(_swap_target ${ID} ${cur} ${home} '${force}' 0); echo "$out rc=$?"`, { FAKE_NOW: String(T0), TMUX: '' });

describe('a forced rescue ranks an unmeasured home after measured room', () => {
  it('forced, away from home, home unmeasured, claude-b measured at 40: picks claude-b', () => {
    seed('claude-a', 'claude'); limits('claude-a', 100, 100); limits('claude-b', 40, 40);   // claude: no file
    expect(target('claude-a', 'claude', '1')).toBe('claude-b rc=0');
  });

  it('forced, home unmeasured and nothing measured has room: still home (eligible, ranked last)', () => {
    seed('claude-a', 'claude'); limits('claude-a', 100, 100);
    limits('claude-b', 100, 100); limits('claude-d', 100, 100);
    expect(target('claude-a', 'claude', '1')).toBe('claude rc=0');
  });

  it('kept: unforced, home unmeasured: returns home (the affinity policy, not a rescue)', () => {
    seed('claude-a', 'claude'); limits('claude-a', 10, 10); limits('claude-b', 40, 40);
    expect(target('claude-a', 'claude', '')).toBe('claude rc=0');
  });

  it('kept: forced, home measured at 20: returns home before the loop', () => {
    seed('claude-a', 'claude'); limits('claude-a', 100, 100); limits('claude', 20, 20); limits('claude-b', 5, 5);
    expect(target('claude-a', 'claude', '1')).toBe('claude rc=0');
  });
});

// The fall-through must not cost a home the loop never walks (verifier findings on Task 3). The candidate loop only
// reads `_pool_for` accounts that pass `_pool_ok`, so a CROSSED home (the arm skips `_pool_ok` for it) and a home a
// hand-set `<id>.pool` list leaves out are invisible to it: on a forced call an otherwise-recovered unmeasured home
// is kept as a rank-100 fallback and returned when the loop finds nothing, instead of turning into a strand.
describe('a forced rescue keeps an unmeasured home the loop never walks as its fallback', () => {
  const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
  const tagPool = (project: string, pool: string): void => {
    fs.mkdirSync(reg('pools'), { recursive: true });
    fs.writeFileSync(path.join(reg('pools'), project), pool);
  };
  beforeEach(() => {
    seedAccountsSh(h.home, POOLED_TEST_ROSTER);   // claude, claude-a -> pool-a; claude-b -> pool-b; claude-d, gpt untagged
    plantPoolEpoch(h.home, POOL_BY_ID);
  });

  it('forced, crossed home unmeasured, every in-pool candidate at the ceiling: still the crossed home', () => {
    seed('claude-a', 'claude-b'); tagPool('project-a', 'pool-a');
    h.sh(`_reg_set ${ID} crosspool "1700000000 pool-a claude-b"`);
    limits('claude-a', 100, 100); limits('claude', 100, 100); limits('claude-d', 100, 100);   // claude-b: no file
    expect(target('claude-a', 'claude-b', '1')).toBe('claude-b rc=0');
  });

  it('forced, crossed home unmeasured, a measured in-pool account has room: the measured account wins', () => {
    seed('claude-a', 'claude-b'); tagPool('project-a', 'pool-a');
    h.sh(`_reg_set ${ID} crosspool "1700000000 pool-a claude-b"`);
    limits('claude-a', 100, 100); limits('claude', 30, 30); limits('claude-d', 100, 100);
    expect(target('claude-a', 'claude-b', '1')).toBe('claude rc=0');
  });

  it('forced, hand-set pool list that leaves home out, home unmeasured, listed accounts at the ceiling: still home', () => {
    seed('claude-a', 'claude');
    fs.writeFileSync(reg(`${ID}.pool`), 'claude-a claude-b claude-d\n');
    limits('claude-a', 100, 100); limits('claude-b', 100, 100); limits('claude-d', 100, 100);   // claude: no file
    expect(target('claude-a', 'claude', '1')).toBe('claude rc=0');
  });

  it('forced, hand-set pool list that leaves home out, a listed account has room: that account wins', () => {
    seed('claude-a', 'claude');
    fs.writeFileSync(reg(`${ID}.pool`), 'claude-a claude-b claude-d\n');
    limits('claude-a', 100, 100); limits('claude-b', 100, 100); limits('claude-d', 40, 40);
    expect(target('claude-a', 'claude', '1')).toBe('claude-d rc=0');
  });

  it('a wake move (measured room only) still refuses the unmeasured home as a fallback', () => {
    seed('claude-a', 'claude');
    fs.writeFileSync(reg(`${ID}.pool`), 'claude-a claude-b claude-d\n');
    limits('claude-a', 100, 100); limits('claude-b', 100, 100); limits('claude-d', 100, 100);
    const out = h.sh(`out=$(CCD_RESCUE_MEASURED_ONLY=1 _swap_target ${ID} claude-a claude 1 0); echo "$out rc=$?"`,
      { FAKE_NOW: String(T0), TMUX: '' }).trim();
    expect(out).toBe('rc=1');
  });
});

describe('the unforced call is unchanged for a wrong-pool current account', () => {
  it('retag relocation: session on a wrong-pool account, home unmeasured, measured room elsewhere: home (one move)', () => {
    const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
    seedAccountsSh(h.home, POOLED_TEST_ROSTER); plantPoolEpoch(h.home, POOL_BY_ID);
    fs.mkdirSync(reg('pools'), { recursive: true });
    fs.writeFileSync(path.join(reg('pools'), 'project-a'), 'pool-a');
    seed('claude-b', 'claude'); limits('claude-b', 10, 10); limits('claude-a', 30, 30);   // claude: no file
    expect(target('claude-b', 'claude', '')).toBe('claude rc=0');
  });
});

describe('keystroke pin', () => {
  it('sends no key to any pane', () => {
    seed('claude-a', 'claude'); limits('claude-a', 100, 100); limits('claude-b', 40, 40);
    target('claude-a', 'claude', '1');
    expect(h.calls().filter((l) => /send-keys/.test(l))).toEqual([]);
  });
});
