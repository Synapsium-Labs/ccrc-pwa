// Two pure "pane text -> verdict" classifiers, both consumed on the spawn/
// supervise path but tested here without tmux (see ccdWsHelpers.ts — `h.sh`
// sources ccd and runs the snippet directly; no tmux session involved):
//
//   _pane_login_screen  — is this pane an auth flow? Consumed by
//     _accept_first_run_prompts to withhold keystrokes (a stray Enter on a
//     numbered login menu selects whatever the cursor is on).
//   _pane_hard_blocked  — is this session stuck regardless of turn state?
//     Consumed by _auto_swap_check's immediate-rescue branch. Auth-failure
//     strings join the same rescue lane as a 429/spend-limit banner; the
//     login-METHOD menu deliberately does not (that screen appears during an
//     intentional login, not a failure — evacuating out from under an
//     operator mid-login would be wrong).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;

// Fixtures are single-line and single-quoted into the snippet verbatim — the
// pane text these functions see is always tmux capture-pane output, which is
// this shape in practice. Multi-line fixtures would need heredoc plumbing
// this suite doesn't need: documented limitation, not an oversight.
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const matches = (fn: string, pane: string): boolean =>
  h.sh(`${fn} ${q(pane)} && echo yes || echo no`) === 'yes';

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-login-screen-'); });
afterEach(() => { h.cleanup(); });

describe('_pane_login_screen', () => {
  it('matches "Select login method"', () => {
    expect(matches('_pane_login_screen', 'Select login method')).toBe(true);
  });

  it('matches "Invalid API key"', () => {
    expect(matches('_pane_login_screen', 'Invalid API key')).toBe(true);
  });

  it('matches "Please run /login"', () => {
    expect(matches('_pane_login_screen', 'Please run /login')).toBe(true);
  });

  it('does not match a normal TUI pane', () => {
    expect(matches('_pane_login_screen', '? for shortcuts')).toBe(false);
  });

  it('does not match an empty pane', () => {
    expect(matches('_pane_login_screen', '')).toBe(false);
  });

  it('does not match user text that merely mentions login (single-line, exact-substring limitation)', () => {
    // The classifier is a plain substring match against the exact banner
    // strings, not a semantic read of the pane — this is deliberate (no
    // false positive from ordinary conversation), and it means a transcript
    // excerpt that happens to quote one of the banners verbatim would also
    // match. That corner is out of scope: real login screens are short,
    // banner-only panes, never a scrollback full of chat.
    expect(matches('_pane_login_screen', '> can you help me fix the login page bug?')).toBe(false);
  });
});

describe('_pane_hard_blocked', () => {
  it('still matches the pre-existing limit/429 strings (pinned, unchanged by this task)', () => {
    expect(matches('_pane_hard_blocked', '5-hour limit reached · resets 3pm')).toBe(true);
    expect(matches('_pane_hard_blocked', 'API Error: 429 Too Many Requests')).toBe(true);
    expect(matches('_pane_hard_blocked', 'You have reached your usage limit')).toBe(true);
    expect(matches('_pane_hard_blocked', 'out of credits')).toBe(true);
    expect(matches('_pane_hard_blocked', 'monthly spend limit reached')).toBe(true);
    expect(matches('_pane_hard_blocked', 'rate limit exceeded')).toBe(true);
  });

  it('does not match an ordinary working pane', () => {
    expect(matches('_pane_hard_blocked', '? for shortcuts')).toBe(false);
  });

  it('matches "Invalid API key" — lost auth joins the rescue lane like a 429', () => {
    expect(matches('_pane_hard_blocked', 'Invalid API key')).toBe(true);
  });

  it('matches "Please run /login" — lost auth joins the rescue lane like a 429', () => {
    expect(matches('_pane_hard_blocked', 'Please run /login')).toBe(true);
  });

  it('does NOT match "Select login method" — that screen appears during an intentional login', () => {
    expect(matches('_pane_hard_blocked', 'Select login method')).toBe(false);
  });
});
