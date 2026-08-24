// server/test/lifecycle-harness-tmux.test.ts
//
// THE THIRD ISOLATION BOUNDARY, beside HOME and the `gh` poison. `_lc_obs`
// (wave 2) runs `tmux list-panes -a` on every event, and `makeCcdHarness`
// isolates HOME but not PATH or TMUX_TMPDIR — so without this the lifecycle
// suites read the operator's LIVE tmux server, and their answers depend on
// whether vitest happens to be running inside a ccd pane. `CLAUDE.md`'s "NEVER
// touch tmux" is a rule; this is the mechanism.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-tmux-'); });
afterEach(() => { h.cleanup(); });

describe('the ccd harness contains tmux', () => {
  it('resolves a tmux that RECORDS and REFUSES, never /usr/bin/tmux', () => {
    // Mutant: drop `tmux: true` from makeCcdHarness's ghContainedEnv literal ->
    // this fails with `expected '/usr/bin/tmux' to contain '.local/bin'`, and
    // every lifecycle test shells the operator's live tmux server.
    expect(h.sh('command -v tmux')).toContain('.local/bin');
    expect(h.sh('tmux list-panes -a 2>/dev/null; printf "rc=%s" "$?"')).toBe('rc=97');
    expect(h.tmuxCalls()).toEqual(['list-panes -a']);
  });

  it('a shell FUNCTION still wins over the poison — bash resolves functions first', () => {
    // Every existing ccd suite stubs tmux this way; the poison must not displace
    // them, or ~30 files change meaning at once.
    expect(h.sh('tmux() { echo STUB; }; tmux list-panes')).toBe('STUB');
    expect(h.tmuxCalls(), 'a stubbed call must not reach the poison').toEqual([]);
  });

  it('records nothing when nothing called it — absent file is no calls', () => {
    expect(h.tmuxCalls()).toEqual([]);
  });
});
