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

// `matches()`'s fixtures below are single-line and single-quoted into the
// snippet verbatim — enough for the two classifiers' truth tables, which only
// need one banner string per case. Real tmux capture-pane output is multi-line
// scrollback, and the wiring tests further down (`_accept_first_run_prompts`/
// `_spawn`) exercise exactly that shape: their pane text travels through the
// `PANE_TEXT` env var (see `acceptRc` and `SPAWN_STUB` below), not this
// quoting helper, so it carries embedded newlines untouched.
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
    // match. That corner is not bounded by pane shape — a restored session's
    // scrollback can absolutely contain one of these strings (open source
    // file, an old auth bug under discussion). It is bounded by the CALLER:
    // _accept_first_run_prompts checks this classifier LAST, after every
    // ready-marker and gate branch (ccd/ccd ~6576-6581, and the "order
    // regression this task fixes" test below), so a substring hit buried in
    // scrollback can only win once nothing else already matched.
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

// The two classifiers above are pure and correctly wired into ccd's OWN test
// suite already — but nothing until here drove the functions that actually
// CONSUME `_pane_login_screen`. A tmux/sleep stub in the ccd-archive idiom
// (`tmux() { case "$1" in ...; *) echo "tmux $*" >> "$HOME/ccd-calls" ;; esac; }`)
// makes `_accept_first_run_prompts` and `_spawn` run to completion in
// milliseconds against a fixture pane, with every keystroke ccd would have
// sent to a real terminal landing in `$HOME/ccd-calls` instead.
const SPAWN_STUB = `sleep() { :; };
  tmux() { case "$1" in
    capture-pane) printf '%s' "$PANE_TEXT" ;;
    *) echo "tmux $*" >> "$HOME/ccd-calls" ;;
  esac; };`;

/** `_accept_first_run_prompts cc-test <fromswap>`, returning its exit code —
 *  the function's own return, not the wrapping shell's, which is why the
 *  snippet echoes it explicitly instead of letting a nonzero code throw. */
const acceptRc = (paneText: string, fromswap = '0'): number => {
  const out = h.sh(
    `${SPAWN_STUB} _accept_first_run_prompts cc-test ${fromswap}; echo "rc=$?"`,
    { PANE_TEXT: paneText },
  );
  return Number(/rc=(\d+)/.exec(out)![1]);
};

describe('_accept_first_run_prompts (wiring, not just the classifier)', () => {
  it('returns 2 and sends no keystrokes on a bare login screen', () => {
    expect(acceptRc('Please run /login')).toBe(2);
    expect(h.calls().some((c) => c.includes('send-keys'))).toBe(false);
  });

  // The order regression this task fixes: the login check used to run BEFORE
  // the ready-marker check, over the FULL pane — so a healthy transcript that
  // merely quotes one of the banner strings (open source file, restored chat
  // discussing an old auth bug) tripped it and parked the session forever.
  it('does not mistake a healthy pane that quotes a login banner in scrollback for a login screen', () => {
    const pane = '● Read ccd/ccd\n  grep -Eq "Please run /login"\n? for shortcuts';
    expect(acceptRc(pane)).toBe(0);
    expect(h.calls().some((c) => c.includes('send-keys'))).toBe(false);
  });

  // Reviewers' "Case B" — the ordering fix's other edge. The test above shows
  // an ALREADY-HEALTHY pane (a ready marker present) surviving a banner quote
  // in scrollback; this one shows a pane that is NOT healthy yet — a REAL
  // first-run gate is up (Bypass Permissions: the highest-stakes gate, since
  // a bare Enter there hits "1. No, exit" instead of "2. Yes, I accept") —
  // while the SAME capture also quotes an auth banner in restored transcript
  // text. If the login classifier ever moved earlier than the gate checks in
  // `_accept_first_run_prompts`'s if/elif chain, this pane would short-circuit
  // to rc=2 with the Bypass gate never answered: parked one stray Enter away
  // from exiting instead of accepting. The fix (classifier checked LAST)
  // means the gate still gets its Down/Enter.
  it('answers a live Bypass-Permissions gate (Down, Enter) rather than bailing to the login path, when the same pane quotes an auth banner', () => {
    const pane =
      '★ Restored session — earlier scrollback:\n' +
      '> user: I saw "Please run /login" yesterday and reran the login flow\n' +
      'Bypass Permissions mode\n1. No, exit  2. Yes, I accept\nEnter to confirm';
    // capture-pane hands back the gate+banner pane exactly once, then a
    // healthy ready marker — enough to prove which branch fired without
    // looping the function's full 450-iteration window (the gate branch
    // `continue`s forever against a pane that never changes, which is
    // correct behavior but not a test worth waiting out).
    const out = h.sh(
      `sleep() { :; };
       tmux() { case "$1" in
         capture-pane)
           n=$(cat "$HOME/pane-calls" 2>/dev/null || echo 0)
           echo $((n+1)) > "$HOME/pane-calls"
           if [[ "$n" -lt 1 ]]; then printf '%s' "$PANE_TEXT"; else printf '%s' '? for shortcuts'; fi
           ;;
         *) echo "tmux $*" >> "$HOME/ccd-calls" ;;
       esac; };
       _accept_first_run_prompts cc-test 0; echo "rc=$?"`,
      { PANE_TEXT: pane },
    );
    expect(Number(/rc=(\d+)/.exec(out)![1])).toBe(0);
    const calls = h.calls();
    const downIdx = calls.findIndex((c) => c.includes('Down'));
    expect(downIdx).toBeGreaterThanOrEqual(0);
    expect(calls[downIdx + 1]).toContain('Enter');
  });
});

describe('_spawn (wiring): skips /effort injection exactly when login-gated', () => {
  const spawnAgainstPane = (paneText: string): string[] => {
    h.sh(
      // Trailing `; :` because `_spawn`'s own last statement is
      // `[[ ... ]] && _inject_spawn_effort ...` — on the login-gated pane
      // that condition is false, so `_spawn`'s exit code is 1 and, being the
      // last command in the snippet, would make `h.sh` throw on a perfectly
      // correct skip. The `:` gives the snippet its own success exit code.
      `${SPAWN_STUB}
       _reg_set myid wrapper claude
       _reg_set myid workdir '${h.home}'
       _reg_set myid uuid deadbeef
       _spawn myid new; :`,
      { PANE_TEXT: paneText },
    );
    return h.calls();
  };

  it('sends no /effort keystrokes when the pane is a login screen', () => {
    const calls = spawnAgainstPane('Please run /login');
    expect(calls.some((c) => c.includes('/effort'))).toBe(false);
  });

  it('DOES send /effort keystrokes once the TUI is healthy (positive control — proves the harness would catch the previous test if the skip were dropped)', () => {
    const calls = spawnAgainstPane('? for shortcuts');
    expect(calls.some((c) => c.includes('/effort'))).toBe(true);
  });
});
