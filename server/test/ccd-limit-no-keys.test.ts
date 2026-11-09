// No key ever reaches Claude Code's rate-limit menu from the limit-rescue code (D-8123, limit-swap-autofix Task 9).
//
// The menu ("What do you want to do?") is auto-opened when a limit lands, and an Enter or a digit typed into it can pick
// "Switch to usage credits". Every path this plan adds ends the session and resumes it on another account; none reads or
// writes the input box except to stand down. This is the source pin behind the keystroke assertion each behavioural test
// file ends with: the bodies of these functions, cut out of `ccd/ccd`, contain no tmux key sender at all. A function
// that is renamed or removed fails the "found" row, so the pin cannot go vacuous.
import { describe, it, expect } from 'vitest';
import { ccdSource } from './ccdWsHelpers.js';

/** The functions that decide or perform a limit rescue without a supervisor tick, or that move a session off a limit. */
const GUARDED = [
  'cmd_limit_watchdog', '_watchdog_one', '_watchdog_sign_to', '_swap_watchdog_act_gate', '_watchdog_resume_here',
  '_watchdog_resume_run', '_limitwait_open', '_limitwait_close', '_wake_ceiling_move',
];
/** Added by Task 10; checked once it exists. */
const WHEN_PRESENT = ['cmd_limit_wait'];

/** The body of `name() { … }` at column 0, up to the closing brace at column 0. */
function body(src: string, name: string): string | null {
  const open = src.indexOf(`\n${name}() {`);
  if (open < 0) return null;
  const close = src.indexOf('\n}\n', open);
  return close < 0 ? null : src.slice(open, close + 3);
}
const SENDS = /send-keys|_send_keys|paste-buffer|load-buffer|send-prefix/;

describe('the limit-rescue code sends no key', () => {
  const src = ccdSource();

  it.each(GUARDED)('%s is found and contains no key sender', (name) => {
    const b = body(src, name);
    expect(b, `${name} was not found in ccd/ccd`).not.toBeNull();
    expect(b!.length, `${name} is empty`).toBeGreaterThan(40);
    // Comments may NAME the forbidden words; only code lines count.
    const code = b!.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s#\s.*$/, '')).join('\n');
    expect(code).not.toMatch(SENDS);
  });

  it.each(WHEN_PRESENT)('%s, when it exists, contains no key sender', (name) => {
    const b = body(src, name);
    if (b === null) return;
    const code = b.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(SENDS);
  });

  it('the dispatch the watchdog uses starts a swap or a restart, never a key', () => {
    const b = body(src, '_dispatch_swap');
    expect(b).not.toBeNull();
    const code = b!.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(SENDS);
  });
});
