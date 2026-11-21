// No key ever reaches Claude Code's rate-limit menu from the limit-rescue code (D-8123, limit-swap-autofix Task 9).
//
// The menu ("What do you want to do?") is auto-opened when a limit lands, and an Enter or a digit typed into it can pick
// "Switch to usage credits". Every path this plan adds ends the session and resumes it on another account; none reads or
// writes the input box except to stand down. This is the source pin behind the keystroke assertion each behavioural test
// file ends with: the bodies of these functions, cut out of `ccd/ccd`, contain no tmux key sender at all. A function
// that is renamed or removed fails the "found" row, so the pin cannot go vacuous.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { CCD_ALIASES_LIB, ccdSource } from './ccdWsHelpers.js';

/** The functions that decide or perform a limit rescue without a supervisor tick, or that move a session off a limit. */
const GUARDED = [
  'cmd_limit_watchdog', '_watchdog_one', '_watchdog_sign_to', '_swap_watchdog_act_gate', '_watchdog_resume_here',
  '_watchdog_resume_run', '_limitwait_open', '_limitwait_close', '_limitwait_choose', 'cmd_limit_wait', '_wake_ceiling_move',
];

/** The body of `name() { … }` at column 0, up to the closing brace at column 0. */
function body(src: string, name: string): string | null {
  const open = src.indexOf(`\n${name}() {`);
  if (open < 0) return null;
  const close = src.indexOf('\n}\n', open);
  return close < 0 ? null : src.slice(open, close + 3);
}
/** ccd's own typing helpers: each sends keys to a pane (review 3006 F2), so calling one is sending a key. */
const TYPERS = ['_route_type_model', '_route_type_effort', '_route_escape', '_answer_two_option_dialog'];
const SENDS = new RegExp(`send-keys|_send_keys|paste-buffer|load-buffer|send-prefix|\\b(?:${TYPERS.join('|')})\\b`);

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

  it.each(TYPERS)('the typing helper %s is defined in ccd/ccd (so naming it in the scan is not vacuous)', (name) => {
    expect(body(src, name), `${name} was not found in ccd/ccd`).not.toBeNull();
  });

  it('the dispatch the watchdog uses starts a swap or a restart, never a key', () => {
    const b = body(src, '_dispatch_swap');
    expect(b).not.toBeNull();
    const code = b!.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(SENDS);
  });
});

// REVIEW 2964 F12: the model-class Anthropic arm's library observes a session on every supervise tick (`_alias_observe`) and carries a
// held id and an effort into a launch, and it types nothing: no key reaches a pane from it. The list above is a fixed set of
// limit-rescue functions, so a key sender added to the library would not be seen by it; this one scans EVERY function of the library
// (the names are read from its own text, so a new function is covered at once). Comments may name the words; only code lines count.
describe('the model-aliases library sends no key', () => {
  const lib = fs.readFileSync(CCD_ALIASES_LIB, 'utf8');
  const names = [...lib.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/gm)].map((m) => m[1]!);

  it('lists its functions (so the scan below cannot be vacuous)', () => {
    expect(names.length).toBeGreaterThan(15);
    expect(names).toContain('_alias_observe');
  });

  it.each(names)('%s contains no key sender', (name) => {
    const b = body(lib, name);
    expect(b, `${name} was not found in ccd/lib/model-aliases.sh`).not.toBeNull();
    const code = b!.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s#\s.*$/, '')).join('\n');
    expect(code).not.toMatch(SENDS);
  });
});
