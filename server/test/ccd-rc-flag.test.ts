// server/test/ccd-rc-flag.test.ts
//
// Stage 2e — `--remote-control` is a PER-BOX FACT (D-99).
//
// `_spawn_start` used to hardcode `--remote-control '$id'`, so "this box drives
// its sessions over the RC socket" was a property of ccd's SOURCE. It is now a
// property of the BOX: `$HOME/.ccrc/remote-control`, first line `on`.
//
// WHAT LIVES HERE, and why not in `ccd-login-screen.test.ts`: that file's header
// names its subject as two pure pane classifiers (`_pane_login_screen`,
// `_pane_hard_blocked`) plus the wiring that consumes them. This file's subject
// is the FLAG — its reader's truth table, and the two things the flag's
// existence puts at risk in `_accept_first_run_prompts`:
//
//   1. An RC-OFF pane must still be recognised as "the TUI is up". The ready
//      marker most people picture is the RC indicator `/rc active`; a box with
//      the flag off never renders one, and if that were the only marker every
//      spawn on such a box would sit out the full ~15-minute window and answer
//      rc 4 on a perfectly healthy session.
//   2. `/rc active` must SURVIVE in the marker set anyway. The flip is not
//      atomic across a fleet: sessions spawned before it are still RC panes and
//      still have to classify. Deleting the alternative is scheduled for "after
//      no pre-flip session survives", which is an operator observation, not a
//      code change anybody can make today.
//
// The argv half of the flag — which of `_spawn_start`'s two spawn lines carries
// the option — is pinned in `ccd-spawn-split.test.ts`, beside the rest of that
// function's contract.
//
// FIXTURE HOMES ONLY (`makeCcdHarness`): ccd is the live fleet's supervisor and
// HOME is its single isolation boundary.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-rc-flag-'); });
afterEach(() => { h.cleanup(); });

/** Writes the box's flag file with `body` VERBATIM — no newline is appended
 *  here, because whether the writer supplies one is exactly what the
 *  no-trailing-newline case below measures. `<home>/.ccrc` already exists;
 *  `makeCcdHarness` seeds `accounts.sh` into it before anything else. */
const flag = (body: string): void => {
  writeFileSync(path.join(h.home, '.ccrc', 'remote-control'), body);
};

/** `_rc_enabled` as a boolean. `&& echo on || echo off` rather than letting the
 *  non-zero return throw: OFF is the function's ordinary answer, not an error. */
const rcEnabled = (): boolean => h.sh('_rc_enabled && echo yes || echo no') === 'yes';

describe('_rc_enabled — the box flag reader', () => {
  it('is off when the file is absent', () => {
    // THE DEFAULT, and the direction every other case degrades toward: a box
    // that was never told is a box that does not drive its sessions over RC.
    expect(rcEnabled()).toBe(false);
  });

  it('is on for exactly `on`', () => {
    flag('on\n');
    expect(rcEnabled()).toBe(true);
  });

  it('reads only the FIRST line — a second line cannot change the verdict', () => {
    flag('on\nyes\nwhatever\n');
    expect(rcEnabled()).toBe(true);
    flag('off\non\n');
    expect(rcEnabled()).toBe(false);
  });

  it('tolerates surrounding whitespace, including a CRLF file', () => {
    flag('  on  \n');
    expect(rcEnabled()).toBe(true);
    // `[[:space:]]` covers CR, so a file written on (or copied through) Windows
    // line endings is not silently a different value.
    flag('on\r\n');
    expect(rcEnabled()).toBe(true);
  });

  // ── THE GARBLED-FILE TABLE ────────────────────────────────────────────────
  // MUTATION MEASURED (2026-08-19): relaxing the reader's last line from
  //   [[ "${first//[[:space:]]/}" == "on" ]]
  // to `[[ -n "$first" ]]` — i.e. "any non-empty file means on", the shortcut an
  // editor reaches for when the flag "obviously just needs to exist" — reds
  // FIVE of this file's cases and nothing else:
  //   5 failed | 10 passed  (`ccd-rc-flag` alone)
  //   5 failed | 58 passed  (with `ccd-spawn-split`; the argv half is untouched)
  // The five are the four below plus `reads only the FIRST line` (whose second
  // half is `off\non`, a non-empty first line that is not `on`). Restored; the
  // shipped bytes are back to the strict comparison.
  //
  // A garbled file must not HALF-ENABLE a mode. The failure direction is the
  // whole argument: an RC pane on a box with nothing listening is a session no
  // reader downstream can drive, so "I could not understand this" has to answer
  // the same as "nobody told me".
  it('is off for `ON` — the comparison is case-sensitive', () => {
    flag('ON\n');
    expect(rcEnabled()).toBe(false);
  });

  it('is off for `on extra` — internal whitespace does not get trimmed away into `on`', () => {
    // `${first//[[:space:]]/}` strips ALL whitespace, not just the ends, so
    // this collapses to `onextra` — which is not `on`. Named here because the
    // strip is global and an editor could reasonably expect otherwise.
    flag('on extra\n');
    expect(rcEnabled()).toBe(false);
  });

  it('is off for `yes` and for `off`', () => {
    flag('yes\n');
    expect(rcEnabled()).toBe(false);
    flag('off\n');
    expect(rcEnabled()).toBe(false);
  });

  it('is off for an empty file, and off for a file holding only whitespace', () => {
    flag('');
    expect(rcEnabled()).toBe(false);
    flag('\n');
    expect(rcEnabled()).toBe(false);
    flag('   \n');
    expect(rcEnabled()).toBe(false);
  });

  it('is off for `on` with NO trailing newline — the writer contract is a LINE', () => {
    // MEASURED, and recorded because it is a contract on the WRITERS (Stage 2e
    // Task 2's `ccrc install` / deploy fleet lane), not a quirk: bash's `read`
    // returns non-zero when it hits EOF before a delimiter, and the reader's
    // `|| return 1` takes that as "unreadable". `printf 'on' > file` is
    // therefore OFF; `printf 'on\n' > file` is ON.
    //
    // Left as-is rather than "fixed" because the direction is the safe one — a
    // half-written flag file degrades to off, which is what every other garbled
    // case does. A writer that appends the newline is the whole remedy.
    flag('on');
    expect(rcEnabled()).toBe(false);
  });

  it('is not an env override — HOME is ccd\'s only isolation boundary', () => {
    // The discipline `SPAWN_GATE_TRIES`' docstring states and
    // `SPAWN_RESUME_SETTLE_S` is already pinned on. This is the reason the flag
    // is a FILE at all (D-99): nothing on the wire can set a shell variable,
    // and per-box config that an environment could flip would be a way to
    // change what a spawn IS from outside the box.
    expect(h.sh('echo "$CCRC_RC_FILE"', { CCRC_RC_FILE: '/nowhere' }))
      .toBe(path.join(h.home, '.ccrc', 'remote-control'));
  });
});

// ---------------------------------------------------------------------------
// The ready-marker set, from both sides.
// ---------------------------------------------------------------------------

/** The ccd-login-screen.test.ts stub, verbatim in shape: `capture-pane` answers
 *  `$PANE_TEXT`, everything else is recorded, `sleep` costs nothing. Its own
 *  copy rather than an import because the two files model DIFFERENT tmux
 *  substrates over time (that one grows a call-counting capture for its gate
 *  cases) and a shared stub would make each file's fixture the other's
 *  constraint. */
const SPAWN_STUB = `sleep() { :; };
  tmux() { case "$1" in
    capture-pane) printf '%s' "$PANE_TEXT" ;;
    *) echo "tmux $*" >> "$HOME/ccd-calls" ;;
  esac; };`;

const acceptRc = (paneText: string, fromswap = '0'): number => {
  const out = h.sh(
    `${SPAWN_STUB} _accept_first_run_prompts cc-test ${fromswap}; echo "rc=$?"`,
    { PANE_TEXT: paneText },
  );
  return Number(/rc=(\d+)/.exec(out)![1]);
};

/** AN INVENTED FIXTURE, and it is labelled so deliberately.
 *
 *  Only the LAST line is measured bytes: it is the real captured footer from
 *  `statusline.test.ts:9` (`cc-claude2-expoAI-assistant`), which is the one part
 *  of the pane the marker set actually matches on when RC is off. The lines
 *  above it are a plausible idle prompt box written by hand — nobody has yet
 *  run a flag-off session on a real box, because Stage 2e is what makes flag-off
 *  possible.
 *
 *  THE STAGE-2 VM GATE REPLACES THIS with a genuine `capture-pane` of an RC-off
 *  session. Until then the honest claim of the test below is narrow: given a
 *  pane whose only live evidence is the permission-mode footer, the function
 *  answers "up" and sends nothing. That is the claim that matters, and it does
 *  not depend on the invented rows — but a real capture may carry rows this one
 *  does not, so do not read this fixture as "what an RC-off pane looks like".
 *
 *  NO `/rc` ANYWHERE IN IT: that is the point of the fixture (asserted below,
 *  so a later edit cannot quietly reintroduce one and leave the test passing
 *  for the RC-on reason). No raw control bytes either — the real capture this
 *  line came from carries none. */
const RC_OFF_READY_PANE = [
  '  ● Read ccd/ccd (1 line)',
  '',
  '╭──────────────────────────────────────────────────────────────────────────╮',
  '│ >                                                                        │',
  '╰──────────────────────────────────────────────────────────────────────────╯',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
].join('\n');

describe('_accept_first_run_prompts: a session on an RC-OFF box still reads as up', () => {
  it('the fixture is genuinely RC-free — it cannot pass for the RC-on reason', () => {
    // Guards the test below against its own fixture. Without this, pasting a
    // `/rc` footer in while editing would leave that test green while proving
    // the opposite of what it claims.
    expect(RC_OFF_READY_PANE).not.toContain('/rc');
    // And it must not carry the OTHER markers either: `? for shortcuts` and
    // `esc to interrupt` would each make the pane match without the footer
    // ever being consulted.
    expect(RC_OFF_READY_PANE).not.toContain('? for shortcuts');
    expect(RC_OFF_READY_PANE).not.toContain('esc to interrupt');
  });

  it('returns 0 on the permission-mode footer alone, and sends NO keystrokes', () => {
    // rc 0 = "a live marker appeared". Were the footer alternatives missing
    // from the marker set, this pane would match nothing, and the real
    // function would poll it for the full window and answer rc 4 — a healthy
    // session reported as a failed spawn, on every spawn, on every RC-off box.
    expect(acceptRc(RC_OFF_READY_PANE)).toBe(0);
    // Zero keystrokes: no gate is up, and a synthesized Enter into an idle
    // prompt is a message nobody wrote.
    expect(h.calls().some((c) => c.includes('send-keys'))).toBe(false);
  });

  it('the same pane on the swap-landing path (fromswap=1) answers identically', () => {
    // `fromswap` only picks between two answers to the resume gate. A pane with
    // no gate on it must not care, and this is the assertion that says so.
    expect(acceptRc(RC_OFF_READY_PANE, '1')).toBe(0);
    expect(h.calls().some((c) => c.includes('send-keys'))).toBe(false);
  });
});

describe('the ready-marker set keeps ALL FIVE alternatives, `/rc active` included', () => {
  const src = readFileSync(CCD, 'utf8');

  /** The marker line is the ONE `echo "$pane" | grep -Eq "…"` in ccd (the only
   *  other `grep -Eq` is `_pane_login_screen`'s, single-quoted and fed from a
   *  here-string). Anchored on the code, not on a comment: comments do not
   *  survive bash's deparse and a comment anchor pins nothing. */
  const markerRe = /echo "\$pane" \| grep -Eq "([^"]+)"/;

  it('the source still has exactly one ready-marker line to scan', () => {
    // A scan that finds nothing passes everything. This is the assertion that
    // the test below is looking at anything at all: move or rename the line and
    // THIS goes red rather than the guard silently disarming.
    const hits = src.split('\n').filter((l) => markerRe.test(l));
    expect(hits).toHaveLength(1);
  });

  it('holds exactly the five alternatives, in order', () => {
    // MUTATION MEASURED (2026-08-19): deleting the `/rc active|` alternative
    // from ccd's marker line reds this test ALONE —
    //   1 failed | 14 passed   (`ccd-rc-flag`)
    //   1 failed | 106 passed  (+ `ccd-login-screen`, `ccd-spawn-split`,
    //                           `ccd-spawn-verdict` — all three still green,
    //                           because every pane fixture they carry matches
    //                           one of the other four alternatives)
    // Which is the finding, not a footnote: nothing else in the suite notices
    // the loss, so this assertion is the whole mechanism keeping mixed-mode
    // classification alive. Restored immediately; the shipped bytes carry five.
    //
    // THE SET IS PINNED WHOLE, not "contains /rc active", so an ADDITION is as
    // visible as a deletion: a sixth marker is a widening of what counts as
    // "the TUI is up", and the failure direction of a wrong widening is a spawn
    // that reports success over a pane that never came up (M6, which the rc 3/4
    // split exists to have fixed).
    const body = markerRe.exec(src)![1];
    expect(body.split('|')).toEqual([
      // NEVER DELETE THIS ONE without the operator observation that licenses
      // it. The flip to flag-off is not atomic across the fleet: every session
      // spawned before it is still an RC pane whose footer renders `/rc`
      // (sometimes bare, sometimes `/rc active`), and it still has to classify
      // as "up" through a swap, a restart, and a `ccd ensure`. The deletion is
      // scheduled for "after no pre-flip session survives on the reference
      // fleet" — an observation, not a code change.
      '/rc active',
      // The RC-off box's own evidence. These two are the same footer line the
      // `RC_OFF_READY_PANE` fixture above ends with, which is why that fixture
      // and this list must move together.
      '\\? for shortcuts',
      'esc to interrupt',
      'shift\\+tab to cycle',
      '← for agents',
    ]);
  });
});
