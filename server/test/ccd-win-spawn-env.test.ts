// The Windows port: what a ccd-spawned session's environment carries there. Claude Code runs hooks, the statusline
// and its Bash tool in the bash CLAUDE_CODE_GIT_BASH_PATH names (else Git Bash, a second MSYS runtime in which the
// session hook exits having written nothing), and no oom_score_adj prefix is set where /proc has none to raise.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

describe.skipIf(process.platform !== 'win32')('ccd spawn environment on Windows', () => {
  // ccd is sourced in the contained harness (a fixture HOME, the poisoned tools), never with the parent's env.
  let h: CcdHarness;
  beforeAll(() => { h = makeCcdHarness('ccrc-win-spawn-env-'); });
  afterAll(() => { h?.cleanup(); });
  const ask = (fn: string): string => h.sh(fn);

  it('pins Claude Code to MSYS2 bash, `/`-separated, for hooks and the Bash tool', () => {
    expect(ask('_pane_shell_env')).toMatch(/^CLAUDE_CODE_GIT_BASH_PATH='[A-Za-z]:\/[^'\\]*\/usr\/bin\/bash\.exe'$/);
  });

  it('a child\'s shell pin is that bash, never /bin/bash, which a native Claude Code cannot run', () => {
    expect(ask('printf %s "$CHILD_SHELL_PIN"')).toMatch(/^[A-Za-z]:\/.*\/usr\/bin\/bash\.exe$/);
  });

  it('sets no oom_score_adj shell prefix: there is no /proc/self/oom_score_adj to raise', () => {
    expect(ask('_tool_adj_env')).toBe('');
  });
});
