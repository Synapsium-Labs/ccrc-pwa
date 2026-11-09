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
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

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

describe('keystroke pin', () => {
  it('sends no key to any pane', () => {
    seed('claude-a', 'claude'); limits('claude-a', 100, 100); limits('claude-b', 40, 40);
    target('claude-a', 'claude', '1');
    expect(h.calls().filter((l) => /send-keys/.test(l))).toEqual([]);
  });
});
