// `ccd route --apply` and `_route_apply_now` — the ONE typer (routing spec §5.3
// "live change"; slice 1's measured keystrokes D-2808 / D-2810 / D-2811 and
// slice 4's picker probe).
//
// WHAT IS BEING PINNED, and why each assertion is a keystroke LIST rather than
// an outcome. ccd is the only thing in this tree allowed to type into a live
// pane, and every one of these sequences was MEASURED on a private tmux server
// against Claude Code 2.1.273 — not guessed from the UI's prose:
//
//   • the session-only key is `s`, in BOTH the effort slider and the model
//     picker, and neither writes the lane's settings.json;
//   • the slider does not wrap, so `Left`×7 pins it at `low` and `Right`×N
//     walks to the target;
//   • the model picker DOES wrap (`Up` on row 1 lands on the last row), so a
//     driver must read the cursor row off the capture and count the delta —
//     "press Up×N to pin at row 1" is unsound;
//   • `ultracode` has no slider row a delta can reach, and the plain
//     `/effort ultracode` form is session-only by construction (D-2810);
//   • Opus 5 interposes a `Change effort level?` dialog when the conversation
//     already has turns, and Fable 5.1 does not — a driver tolerates both.
//
// A test that asserted "the record says high" would pass against a driver that
// typed `/effort high` — the PERSISTING form, which writes
// `modelSettings.<model>.effortLevel` into the lane every other session on that
// account then inherits. The keystrokes are the contract.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). The `tmux` stub RECORDS `send-keys`
// and never sends one, which is what makes "nothing was typed" an assertion.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD, ghContainedEnv, harnessBin, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { USAGE_FRESH_S } from '../src/usage.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-apply-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const UUID = 'deadbeef-0000-4000-8000-000000000000';

/** Claude Code's idle bottom, as 2.1.280 draws it: the prompt box, the `👤`
 *  statusline row directly under its bottom border, the mode row. The effort
 *  ack is read only while this is on screen — a dialog or the slider hides it. */
const RULE = '─'.repeat(40);
const BOTTOM = (effort = 'xhigh'): string =>
  `${RULE}\n❯ \n${RULE}\n  👤 acct-a │ 🤖 Opus 5 · ${effort} │ ▓ ctx ▁▁▁ 20% │ 💲 1.0\n  ⏸ manual mode on\n`;
const IDLE_PANE = BOTTOM();
const MID_TURN_PANE = 'Working… (esc to interrupt)\n';
/** The picker under its own title line, as every Claude Code from 2.1.280 to
 *  2.1.291 draws it (measured 2026-10-06; `fixtures/panes/cc291-model-*`): the
 *  driver finds the picker by that title, so a fixture without it is a picker
 *  no real pane has ever shown. */
const PICKER = (rows: string): string => `  Select model\n\n${rows}\n  Enter to set as default · s to use this session only · Esc to cancel\n`;
const PICKER_PANE = `${IDLE_PANE}${PICKER('❯ 1. Default (recommended) ✔\n  2. Sonnet\n  3. Opus\n  4. Haiku')}`;
/** The ack where Claude Code prints it: a `⎿` line under the echoed command,
 *  ABOVE the prompt box — and the statusline row already showing the level
 *  (ultracode shows as `xhigh`), as it does within a second on real 2.1.280
 *  panes. The applier reads all three. */
const ACK_EFFORT = (level: string, above = ''): string =>
  `${above}❯ /effort\n  ⎿  Set effort level to ${level} (this session only): …\n${BOTTOM(level === 'ultracode' ? 'xhigh' : level)}`;
/** The model outcome where Claude Code prints it (measured 2026-10-06, 2.1.285–2.1.291): a `⎿` line
 *  under the echoed `❯ /model`, ABOVE the prompt box. */
const MODEL_OUTCOME = (line: string): string => `❯ /model\n  ⎿  ${line}\n\n`;
const ACK_MODEL = (name: string): string => `${MODEL_OUTCOME(`Set model to ${name} for this session only`)}${IDLE_PANE}`;
/** Opus 5's confirmation, as captured: it REPLACES the prompt box and the
 *  statusline row, and its cursor row is the pane's lowest `❯ N.` row. */
const DIALOG = (to: string, above = ''): string =>
  `${above}❯ /effort\n${RULE}\n  Change effort level?\n  Your next response will be slower and use more tokens\n  ❯ 1. Yes, switch to ${to}\n    2. No, go back\n`;
const DIALOG_PANE = DIALOG('high');

/** tmux, RECORDING. `capture-pane` answers `$HOME/pane.txt`; a `send-keys`
 *  whose key text names an existing `$HOME/pane-after-<key>.txt` copies that
 *  file over `pane.txt`, so a case SCRIPTS the pane's transitions. The N-th
 *  Enter first looks for `pane-after-Enter-<N>.txt`, for a case whose two
 *  Enters (submit, then confirm) lead to two different screens. The `Enter`
 *  transition is guarded on the dialog actually being up: the Enter that
 *  submits `/effort` comes first and must not land the acknowledgement early. */
const TMUX_STUB = `tmux() {
  echo "tmux $*" >> "$HOME/tmux-calls"
  # §6.3: answer the pane-width query (D-2861's idiom, discriminated on the whole
  # argument list so the \`#{pane_pid}\` readers below are undisturbed). Without it
  # \`_pane_measurable\` stands the applier down INSIDE the test and every keystroke
  # assertion here reads as an empty list.
  case "$*" in *pane_active*) echo "1 200"; return 0 ;; esac
  case "$1" in
    capture-pane) cat "$HOME/pane.txt" ;;
    list-panes)   echo 4242 ;;
    send-keys)    shift; while [[ "\${1:-}" == -t ]]; do shift 2; done; k="$*"; k="\${k#-l }"; k="\${k#/}"
                  # LOCAL, and not named n: this runs inside ccd's own functions, and
                  # bash scopes dynamically — an unscoped counter here overwrote the
                  # slider's Right count in the caller.
                  local stub_enters=0 stub_numbered=0
                  if [[ "$k" == Enter ]]; then
                    stub_enters=$(( $(cat "$HOME/enter-count" 2>/dev/null || echo 0) + 1 )); echo "$stub_enters" > "$HOME/enter-count"
                    if [[ -f "$HOME/pane-after-Enter-$stub_enters.txt" ]]; then
                      cp "$HOME/pane-after-Enter-$stub_enters.txt" "$HOME/pane.txt"; stub_numbered=1
                    fi
                  fi
                  if [[ "$stub_numbered" == 0 && -f "$HOME/pane-after-$k.txt" ]]; then
                    if [[ "$k" != Enter ]] || grep -q "Yes, switch" "$HOME/pane.txt"; then
                      cp "$HOME/pane-after-$k.txt" "$HOME/pane.txt"
                    fi
                  fi ;;
  esac; return 0
}; sleep() { :; };`;

const keys = (): string[] => {
  const f = path.join(h.home, 'tmux-calls');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.startsWith('tmux send-keys')).map((l) => l.replace(/^tmux send-keys -t \S+ /, ''));
};
const pane = (text: string): void => { fs.writeFileSync(path.join(h.home, 'pane.txt'), text); };
const after = (key: string, text: string): void => { fs.writeFileSync(path.join(h.home, `pane-after-${key}.txt`), text); };
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

const seed = (id: string, wrapper = 'claude'): void => {
  h.sh(`_reg_set ${id} wrapper ${wrapper}
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid ${UUID}`);
};

/** The lane's session JSON the idle predicate reads: `<config dir>/sessions/<pane pid>.json`,
 *  idle and quiet for longer than COMPACT_QUIET (`ccd-auto-compact.test.ts`'s `plantSession`
 *  shape); `_cfg_dir claude` names the directory and the tmux stub names the pid. */
const plantIdle = (wrapper = 'claude'): void => {
  const dir = path.join(h.sh(`_cfg_dir ${wrapper}`).trim(), 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '4242.json'), JSON.stringify({ status: 'idle', statusUpdatedAt: Date.now() - 120_000 }));
};

/** `makeCcdHarness` plants a binary only for the roster's home-able ids
 *  (`ccd-route-degrade.test.ts`'s `install()`, copied): `gpt` — the test roster's
 *  non-Anthropic lane, `telemetry: 'none'` — needs its own before a case can run on it. */
const install = (w: string): void => {
  fs.writeFileSync(path.join(h.home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });
};

/** THE MEASURED SLIDER ORDER, READ OUT OF `ccd/ccd` rather than re-typed here (controller
 *  ruling S4-R9). The `Right` count IS the position in this list — that is the whole of
 *  D-2808's slider measurement — so a second copy of the order in the test would go on
 *  passing against a driver whose stops had been reordered or one inserted in the middle,
 *  which is exactly the defect that ruling removed from `ccd/ccd`. Source-sliced, the way
 *  `ccd-route-tick.test.ts` slices `_auto_compact_check`'s body: this suite imports nothing
 *  from bash. */
const STOPS: string[] = (() => {
  const m = /^ROUTE_EFFORT_STOPS="([^"]*)"$/m.exec(fs.readFileSync(CCD, 'utf8'));
  if (!m) throw new Error('ccd/ccd no longer defines ROUTE_EFFORT_STOPS= at column 0 — re-anchor this test');
  return m[1]!.split(' ');
})();

/** The dispatcher, run the way the box runs it — `ccd-account-pane.test.ts`'s `runCcd`.
 *  A caps arm that exists is not the same fact as a VERB that reaches the applier, and
 *  every other case in this file drives `cmd_route` as a sourced function.
 *
 *  The pane-scripting `tmux` and a no-op `sleep` are REAL FILES here, written into
 *  `harnessBin` where they REPLACE the harness's contained refusers rather than race them
 *  (`ccdWsHelpers.ts` states that contract): a shell-function stub cannot cross into a
 *  subprocess, and `sleep` is an external command, so this is the only way to keep the
 *  ladder's per-key second out of the suite's wall clock. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const bin = harnessBin(h.home);
  fs.writeFileSync(path.join(bin, 'tmux'),
    '#!/bin/bash\n'
    + 'echo "tmux $*" >> "$HOME/tmux-calls"\n'
    + 'case "$*" in *pane_active*) echo "1 200"; exit 0 ;; esac\n'
    + 'case "$1" in\n'
    + '  capture-pane) cat "$HOME/pane.txt" ;;\n'
    + '  list-panes)   echo 4242 ;;\n'
    + '  send-keys)    shift; while [[ "${1:-}" == -t ]]; do shift 2; done; k="$*"; k="${k#-l }"; k="${k#/}"\n'
    + '                if [[ -f "$HOME/pane-after-$k.txt" ]]; then\n'
    + '                  if [[ "$k" != Enter ]] || grep -q "Yes, switch" "$HOME/pane.txt"; then\n'
    + '                    cp "$HOME/pane-after-$k.txt" "$HOME/pane.txt"\n'
    + '                  fi\n'
    + '                fi ;;\n'
    + 'esac\n'
    + 'exit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    return { code: 0, stderr: '',
      stdout: execFileSync('bash', [CCD, ...args], { encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

describe('route --apply (routing spec §5.3 live change; slice 1 keystrokes D-2808/D-2810/D-2811)', () => {
  beforeEach(() => {
    seed(ID); plantIdle(); pane(IDLE_PANE);
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} effort xhigh; _reg_set ${ID} routeapplied "class=opus effort=xhigh"`);
  });

  it('effort=high on an idle pane: /effort, Enter, 7×Left, 2×Right, s — and routeapplied records it after the ack', () => {
    after('s', ACK_EFFORT('high'));
    const out = h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply --actor operator --reason picker`);
    expect(keys()).toEqual(['-l /effort', 'Enter', 'Left', 'Left', 'Left', 'Left', 'Left', 'Left', 'Left', 'Right', 'Right', '-l s']);
    expect(out).toContain(`set ${ID} effort=high`);
    expect(out).not.toContain('queued');
    expect(h.reg(ID, 'routeapplied')).toContain('effort=high');
    expect(h.reg(ID, 'routeskip')).toBeNull();
  });

  it("Opus 5's Change-effort dialog is confirmed with Enter, then the ack is read", () => {
    after('s', DIALOG_PANE); after('Enter', ACK_EFFORT('high'));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply`);
    expect(keys().slice(-2)).toEqual(['-l s', 'Enter']);
    expect(h.reg(ID, 'routeapplied')).toContain('effort=high');
  });

  it('effort=ultracode types the PLAIN form (session-only by construction, D-2810) and nothing else', () => {
    after('effort ultracode', ACK_EFFORT('ultracode'));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=ultracode --apply`);
    expect(keys()).toEqual(['-l /effort ultracode', 'Enter']);
    expect(h.reg(ID, 'routeapplied')).toContain('effort=ultracode');
  });

  // Measured 2026-09-23 on real 2.1.280 panes: Opus 5 raises its switch
  // confirmation for the PLAIN `/effort ultracode` too — `1. Yes, switch to
  // xhigh` — and this path never answered it, so no ack came and every retry
  // ended in Escape.
  it('effort=ultracode confirms Opus 5\'s switch dialog, then reads the ack', () => {
    after('Enter-1', DIALOG('xhigh')); after('Enter-2', ACK_EFFORT('ultracode'));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=ultracode --apply`);
    expect(keys()).toEqual(['-l /effort ultracode', 'Enter', 'Enter']);
    expect(h.reg(ID, 'routeapplied')).toContain('effort=ultracode');
  });

  // An EARLIER ultracode ack stays on screen above later ones — the captures
  // show `ultracode (this session only)` still visible over an open dialog.
  // The whole-pane grep read it as this apply's confirmation.
  it('a stale ultracode ack above an OPEN dialog confirms nothing — Escape, apply-unconfirmed', () => {
    const history = '❯ /effort ultracode\n  ⎿  Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration\n'
      + '❯ /effort\n  ⎿  Set effort level to max (this session only): …\n';
    // The dialog appears, and the confirming Enter is swallowed: it stays up.
    after('Enter-1', DIALOG('xhigh', history)); after('Enter-2', DIALOG('xhigh', history));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=ultracode --apply || :`);
    expect(h.reg(ID, 'routeapplied')).not.toContain('effort=ultracode');
    expect(keys()).toContain('Escape');
  });

  it('a "Yes, switch" QUOTED in chat above an idle box presses no Enter', () => {
    // On the open slider an Enter is "Enter to confirm", the form that SAVES
    // the level to the lane's settings.json; a reply quoting the dialog must
    // not be read as the dialog.
    after('s', ACK_EFFORT('high', '● The dialog reads "❯ 1. Yes, switch to high".\n'));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply`);
    expect(keys().at(-1)).toBe('-l s');
    expect(h.reg(ID, 'routeapplied')).toContain('effort=high');
  });

  it('…even the dialog\'s own lines, verbatim in chat (a Read of a capture), while the box is up', () => {
    // Title and cursor row both on screen — only the prompt box and the
    // statusline row under it say this is not the dialog, which hides both.
    const quoted = '⏺ The capture shows:\n  Change effort level?\n  ❯ 1. Yes, switch to high\n    2. No, go back\n';
    after('s', ACK_EFFORT('high', quoted));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply`);
    expect(keys().at(-1)).toBe('-l s');
  });

  it('the LOWEST ack is the pane\'s word on its effort — an older one above it is superseded', () => {
    // The keys were swallowed and the box came back with no new line: the
    // screen still shows an old `ultracode` ack, but a later `max` one below
    // it. The session is at max, whatever the older line says.
    const history = '❯ /effort ultracode\n  ⎿  Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration\n'
      + '❯ /effort\n  ⎿  Set effort level to max (this session only): …\n';
    after('Enter-1', `${history}${IDLE_PANE}`);
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=ultracode --apply || :`);
    expect(h.reg(ID, 'routeapplied')).not.toContain('effort=ultracode');
    expect(keys()).toContain('Escape');
  });

  it('a dialog QUOTED in chat above the still-open SLIDER presses no Enter', () => {
    // The slider hides the box too and has no `❯ N.` rows of its own, so the
    // quote's title and cursor row were all a pane-wide read could see — and
    // an Enter on the slider is "Enter to confirm", which saves the level.
    const SLIDER = `${RULE}\n  Effort\n  low     medium     high     xhigh      max       ultracode\n`
      + '  ←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel\n';
    const quoted = '⏺ The dialog reads:\n    Change effort level?\n    ❯ 1. Yes, switch to high\n      2. No, go back\n';
    after('s', `${quoted}❯ /effort\n${SLIDER}`);
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply || :`);
    expect(keys().slice(keys().indexOf('-l s') + 1)).not.toContain('Enter');
  });

  it('…nor above the FULLSCREEN slider, whose top edge carries a tmux notice rather than a bare rule', () => {
    // The real fullscreen edges (2.1.280): `▔▔… tmux focus-events off · … ▔`,
    // and at 100 columns `tmux detected · scroll with PgUp/PgDn · … ▔`.
    const quoted = '⏺ The dialog reads:\n    Change effort level?\n    ❯ 1. Yes, switch to high\n      2. No, go back\n';
    for (const edge of [
      `${'▔'.repeat(60)} tmux focus-events off · add 'set -g focus-events on' to ~/.tmux.conf ▔`,
      " tmux detected · scroll with PgUp/PgDn · or add 'set -g mouse on' to ~/.tmux.conf for wheel scroll ▔",
    ]) {
      h.sh('rm -f "$HOME/tmux-calls" "$HOME/enter-count"');
      const SLIDER = `${edge}\n  Effort\n  low     medium     high     xhigh      max       ultracode\n`
        + '  ←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel\n';
      after('s', `${quoted}❯ /effort\n${SLIDER}`);
      pane(IDLE_PANE);
      h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply || :`);
      expect(keys().slice(keys().indexOf('-l s') + 1), edge.slice(0, 30)).not.toContain('Enter');
    }
  });

  it('the confirmation\'s cursor row must sit BELOW its title — the dialog\'s own shape', () => {
    // An Enter here would pick option 1 of whatever menu this is. In the real
    // dialog the title comes first and `❯ 1. Yes, switch to …` under it.
    const MENU = `${RULE}\n ☐ Effort\n❯ 1. Yes, switch to high\n  2. No\n  Change effort level? (Claude is asking)\n`
      + 'Enter to select · ↑/↓ to navigate · Esc to cancel\n';
    after('s', `❯ /effort\n${MENU}`);
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply || :`);
    expect(keys().slice(keys().indexOf('-l s') + 1)).not.toContain('Enter');
  });

  it('an ack-shaped line a TOOL printed does not confirm while the statusline shows another effort', () => {
    // A grep/echo whose output line starts `⎿  Set effort level to high …` is
    // the lowest ack-shaped line on screen; the keys never landed, and the
    // statusline row still says `· low`.
    const tool = '● Bash(grep -oh "Set effort level to high (this session only)" notes.txt)\n'
      + '  ⎿  Set effort level to high (this session only): …\n';
    after('s', `${tool}${BOTTOM('low')}`);
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply || :`);
    expect(h.reg(ID, 'routeapplied')).not.toContain('effort=high');
    expect(keys()).toContain('Escape');
  });

  it('an ack is read only once the prompt box is back — never over a dialog still open', () => {
    // The lowest ack already names `high` (an earlier apply), and this
    // attempt's dialog swallows the confirming Enter and stays up. Recording
    // `high` applied now would press no Escape and leave the dialog to eat the
    // next keystroke (S4-R9) — so it is apply-unconfirmed, and Escaped.
    const history = '❯ /effort\n  ⎿  Set effort level to high (this session only): …\n';
    after('s', DIALOG('high', history)); after('Enter-2', DIALOG('high', history));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply || :`);
    expect(keys()).toContain('Escape');
    expect(h.reg(ID, 'routeapplied')).not.toContain('effort=high');
  });

  it('class=sonnet reads the picker, moves the cursor from the ✔ row to the Sonnet row, presses s — never `/model sonnet`, never Left/Right', () => {
    after('model', PICKER_PANE); after('s', ACK_MODEL('Sonnet 5'));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set class=sonnet --apply`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=sonnet');
  });

  it('a picker whose cursor sits BELOW the target moves Up (the list wraps, so the delta is counted from the cursor row)', () => {
    after('model', PICKER_PANE.replace('❯ 1.', '  1.').replace('  3. Opus', '❯ 3. Opus'));
    after('s', ACK_MODEL('Sonnet 5'));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set class=sonnet --apply`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Up', '-l s']);
  });

  it('a class the picker does not list: Escape, no-picker-row, nothing recorded', () => {
    // One Escape closes the picker (the slice-4 probe), so the pane the driver re-reads is the prompt
    // again and no second Escape follows (`_route_model_close`).
    after('model', PICKER_PANE); after('Escape', IDLE_PANE);
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set class=fable --apply`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Escape']);
    expect(h.reg(ID, 'routeskip')).toMatch(/no-picker-row/);
    expect(h.reg(ID, 'routeapplied')).not.toContain('class=fable');
  });

  it('on a degraded session the class typed is the rung SERVED, not the intended one', () => {
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} degraded opus; _reg_set ${ID} routeapplied "class=sonnet effort=xhigh"`);
    after('model', PICKER_PANE); after('s', ACK_MODEL('Opus 5'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=opus');
  });

  it('effort=auto types NOTHING and is recorded applied (absence is the lever)', () => {
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=auto --apply`);
    expect(keys()).toEqual([]);
    expect(h.reg(ID, 'routeapplied')).toContain('effort=auto');
  });

  it('workflow=off types nothing and is recorded applied-at-settle', () => {
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set workflow=off --apply`);
    expect(keys()).toEqual([]);
    expect(h.reg(ID, 'routeapplied')).toContain('workflow=off');
  });

  it('a mid-turn pane queues: nothing typed, routeskip=mid-turn, the verb prints queued', () => {
    pane(MID_TURN_PANE);
    const out = h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply`);
    expect(keys()).toEqual([]);
    expect(out).toContain(`queued ${ID}`);
    expect(h.reg(ID, 'routeskip')).toMatch(/^\d+ mid-turn$/);
    expect(swapLog()).toMatch(new RegExp(`route-skip ${ID}: mid-turn`));
  });

  it('no acknowledgement within the window: Escape, apply-unconfirmed, nothing recorded — and the retry waits out the backoff', () => {
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply`);   // the pane never shows the ack line
    expect(h.reg(ID, 'routeapplied')).not.toContain('effort=high');
    expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
    // CONTROLLER RULING S4-R9. The LAST key is `Escape`: a sequence that was never
    // acknowledged may have been swallowed by a slider, a picker or the
    // `Change effort level?` dialog, and leaving one of those standing hands the next
    // actor — the compactor's `/compact`, a nudge, a human — a pane whose keystrokes land
    // inside a menu. `_idle_for_keystroke`'s `grep -q ❯` cannot tell a picker's cursor row
    // from the prompt, so nothing downstream would notice.
    expect(keys().at(-1)).toBe('Escape');
    // CONTROLLER RULING S4-R7. The attempt is COUNTED, and the tick that follows it
    // inside `ROUTE_RETRY_BACKOFF` types nothing at all — the pane already refused this
    // exact field once, and at 5s a tick "the next tick retries" meant twelve full key
    // sequences a minute into a live pane, for ever.
    expect(h.reg(ID, 'routetries')).toMatch(/^1 \d+$/);
    fs.writeFileSync(path.join(h.home, 'tmux-calls'), '');
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toEqual([]);
    // Aged past the backoff — the counter's epoch is the only input, so the clock is moved
    // rather than waited on — the SAME record is tried again.
    const backoff = h.sh('printf %s "$ROUTE_RETRY_BACKOFF"');
    h.sh(`_reg_set ${ID} routetries "1 $(( $(date +%s) - ${backoff} ))"`);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()[0]).toBe('-l /effort');
    expect(h.reg(ID, 'routetries')).toMatch(/^2 \d+$/);
  });

  it.each(STOPS)('effort=%s presses Right exactly its position in ROUTE_EFFORT_STOPS, after the seven Lefts (D-2808)', (level) => {
    // The slider does not wrap, so seven Lefts pin the marker at the FIRST stop from any
    // starting position and the Rights count from that known origin. Both numbers are the
    // measurement; neither is a constant this driver may pick.
    h.sh(`_reg_set ${ID} routeapplied "class=opus effort=auto"`);
    after('s', ACK_EFFORT(level));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=${level} --apply`);
    expect(keys().filter((k) => k === 'Left')).toHaveLength(7);
    expect(keys().filter((k) => k === 'Right')).toHaveLength(STOPS.indexOf(level));
    expect(h.reg(ID, 'routeapplied')).toContain(`effort=${level}`);
  });

  it('a level with no measured slider stop is its OWN refusal word and types nothing at all', () => {
    // CONTROLLER RULING S4-R9. `no-slider-stop` rather than `apply-unconfirmed`, because
    // the remedy differs: nothing was typed, so there is no pane to go and look at and no
    // acknowledgement was ever possible. The narrowed constant is how the arm is reached —
    // `_route_get` validates `effort` against `ROUTE_EFFORTS`, so no registry value can.
    // The first argument is the SESSION ID, not a tmux name (ruling S4-R14): the typers
    // derive their target through `_tmux` so `ccd-account-pane.test.ts`'s auth-pane scan
    // can see it derive. Nothing is typed on this arm, so the key log is empty either way.
    const out = h.sh(`${TMUX_STUB} ROUTE_EFFORT_STOPS="low medium"; _route_type_effort ${ID} high; echo "rc=$? why=$KS_WHY"`);
    expect(out).toContain('rc=2');
    expect(out).toContain('why=no-slider-stop');
    expect(keys()).toEqual([]);

    h.sh(`_reg_set ${ID} routeapplied "class=opus effort=auto"`);
    // `|| :` — the applier answers 1 when something is still pending, which is the point here.
    h.sh(`${TMUX_STUB} ROUTE_EFFORT_STOPS="low medium"; _route_apply_now ${ID} || :`);
    expect(h.reg(ID, 'routeskip')).toMatch(/^\d+ no-slider-stop$/);
    expect(h.reg(ID, 'routetries')).toMatch(/^1 \d+$/);
    expect(h.reg(ID, 'routeapplied')).not.toContain('effort=xhigh');
  });

  it("without --apply the verb writes and types nothing — the coordinator's form (spec §5.3, §8 row 5)", () => {
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high`);
    expect(keys()).toEqual([]);
    expect(h.reg(ID, 'routeapplied')).not.toContain('effort=high');
  });

  it('routeskip is its OWN field: a below-threshold compaction tick clears compactskip and leaves routeskip standing (spec §8 row 7)', () => {
    pane(MID_TURN_PANE);
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply`);
    pane(IDLE_PANE);   // ctx 20% < COMPACT_THRESHOLD
    h.sh(`${TMUX_STUB} _reg_set ${ID} compactskip "1 not-idle"; _auto_compact_check ${ID}`);
    expect(h.reg(ID, 'compactskip')).toBeNull();
    expect(h.reg(ID, 'routeskip')).toMatch(/mid-turn/);
  });

  it('THROUGH THE DISPATCHER: `ccd route --session … --set effort=high --apply` types the same keys', () => {
    // CONTROLLER RULING S4-R9. Every case above sources `ccd` and calls `cmd_route`
    // directly, so none of them measures the one thing an operator actually does: the
    // `route)` arm of the dispatcher, the flag parsed off a real argv, the verb reaching
    // the applier as a PROGRAM. `ccd-forget.test.ts` states the general form of this hole
    // — a caps arm that exists is not an arm that calls the function it names.
    after('s', ACK_EFFORT('high'));
    const r = runCcd('route', '--session', ID, '--set', 'effort=high', '--apply');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`set ${ID} effort=high`);
    expect(r.stdout).not.toContain('queued');
    expect(keys()).toEqual(['-l /effort', 'Enter', 'Left', 'Left', 'Left', 'Left', 'Left', 'Left', 'Left', 'Right', 'Right', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('effort=high');
  });

  it('a NON-Anthropic picker labels rows by model id and puts the class in the DESCRIPTION', () => {
    // Row 232 of the slice-4 probe, verbatim: the codex lane's `/model` picker names each
    // row by the model ID it will select and carries `Custom <Class> model` as the
    // description, where an Anthropic lane labels by class. The cursor opens on the
    // CURRENT model (row 2, the ✔), so `class=sonnet` is two Downs away — and neither the
    // count nor the direction is something the driver may assume: the list wraps.
    //
    // `gpt` is the test roster's non-Anthropic lane (`telemetry: 'none'`), so
    // `_is_anthropic_backend` answers false through the roster rather than through a stub.
    const GPT = 'demo-codex-lane';
    install('gpt'); seed(GPT, 'gpt'); plantIdle('gpt'); pane(IDLE_PANE);
    h.sh(`_reg_set ${GPT} class opus; _reg_set ${GPT} routeapplied "class=opus"`);
    after('model', `${IDLE_PANE}  Select model\n  1. Default (recommended)  Use the default model (currently gpt-5.6-sol[1m])\n`
      + '❯ 2. gpt-5.6-sol ✔  Custom Opus model\n'
      + '  3. gpt-6-astra  Custom Fable model\n'
      + '  4. gpt-5.6-terra  Custom Sonnet model\n'
      + '  5. gpt-5.6-luna  Custom Haiku model\n');
    after('s', ACK_MODEL('gpt-5.6-terra'));
    h.sh(`${TMUX_STUB} cmd_route --session ${GPT} --set class=sonnet --apply`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', '-l s']);
    expect(h.reg(GPT, 'routeapplied')).toContain('class=sonnet');
    expect(h.reg(GPT, 'routeskip')).toBeNull();
  });
});

describe('the final review\'s three writer/typer defects, each pinned where it happened', () => {
  beforeEach(() => { seed(ID); plantIdle(); });

  it('(1) a session that was NEVER routed: --apply on a busy pane queues, and the next idle tick TYPES the picker', () => {
    // FINDING 1. `_route_apply_seed` treats "no `routeapplied` file" as "this
    // record predates the applier" — a proxy that is only true at the deploy
    // moment, because `_spawn_start` DELETES the stamp for a session with no
    // record. Every never-routed session on the fleet therefore had no file,
    // and the first routing write to one of them was stamped applied by the
    // next tick with ZERO keystrokes: the pane kept its old model, nothing was
    // pending, the retry budget was never spent, and the PWA showed `queued`
    // and then its 60s unconfirmed toast for ever. The writers now seed the
    // stamp from what the LAST SETTLE composed — here, nothing at all — so the
    // write that follows is a divergence the applier types.
    pane(MID_TURN_PANE);
    const out = h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set class=opus --apply`);
    expect(out).toContain(`queued ${ID}`);
    expect(keys()).toEqual([]);
    expect(h.reg(ID, 'routeskip')).toMatch(/^\d+ mid-turn$/);
    // The stamp EXISTS and claims NOTHING — two conditions, not one: a session
    // that was served nothing is not a session whose record predates the code.
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.routeapplied`))).toBe(true);
    expect(h.reg(ID, 'routeapplied')).toBe('');
    expect(swapLog()).not.toContain('routeapplied-seeded');

    pane(IDLE_PANE); after('model', PICKER_PANE); after('s', ACK_MODEL('Opus 5'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=opus');
  });

  it("(1) the argv writer's own path — a wave N>=2 dispatch — seeds what the settle composed and leaves the NEW pair pending", () => {
    // The same swallow reached `_route_argv_write`: the dispatcher's wave N>=2
    // routing write carries no `--apply`, so the tick is the only thing that
    // would ever type it.
    h.sh(`_reg_set ${ID} class sonnet; _reg_set ${ID} effort auto`);   // a record with no stamp, as the fleet's are
    h.sh(`${TMUX_STUB} _route_argv_write ${ID} 'run:7 dispatch' argv class=opus`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=sonnet effort=auto');
    expect(swapLog()).toMatch(new RegExp(`routeapplied-seeded ${ID}: class=sonnet effort=auto \\(seeded at a route write`));

    pane(IDLE_PANE); after('model', PICKER_PANE); after('s', ACK_MODEL('Opus 5'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=opus');
  });

  it('(3) a STALE `Set model to …` line confirms nothing: the ack is bound to the row `s` was pressed on', () => {
    // FINDING 3. `_route_ack_wait "$t" "Set model to .* for this session only"`
    // greps the WHOLE visible pane, so any earlier model acknowledgement — a
    // human's own `/model` tap minutes ago, a previous applier run — satisfied
    // it, and `class` was recorded applied against a pane that never took it.
    // The pane here carries an acknowledgement for ANOTHER model and the stub
    // never renders a new one.
    const STALE = `${MODEL_OUTCOME('Set model to Sonnet 5 for this session only')}${IDLE_PANE}`;
    pane(STALE);
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} routeapplied "class=sonnet"`);
    after('model', `${STALE}${PICKER('❯ 1. Default (recommended) ✔\n  2. Sonnet\n  3. Opus\n  4. Haiku')}`);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=sonnet');
    expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
    expect(keys().at(-1)).toBe('Escape');
  });

  it('(3) …and when the picker CLOSES on `s` with no new outcome, the stale line is the lowest and still names another model', () => {
    // The whole-pane read (2026-10-06) widened what the outcome check can see to the WHOLE pane, so
    // finding 3's case is re-asked in the shape that read meets: no picker left on screen, the stale
    // `Sonnet 5` outcome the lowest model line there is, and the row `s` was pressed on is `Opus`.
    const STALE = `${MODEL_OUTCOME('Set model to Sonnet 5 for this session only')}${IDLE_PANE}`;
    pane(STALE);
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} routeapplied "class=sonnet"`);
    after('model', `${STALE}${PICKER('❯ 1. Default (recommended) ✔\n  2. Sonnet\n  3. Opus\n  4. Haiku')}`);
    after('s', STALE);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=sonnet');
    expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
  });

  it('(3) the control: an acknowledgement NAMING the selected row confirms it', () => {
    pane(IDLE_PANE);
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} routeapplied "class=sonnet"`);
    after('model', PICKER_PANE); after('s', ACK_MODEL('Opus 5'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toContain('class=opus');
    expect(h.reg(ID, 'routeskip')).toBeNull();
  });

  it("(3) the Default row binds on the DESCRIPTION's model name, parenthesised label and all", () => {
    // Research doc row 232, both halves: the Anthropic picker labels row 1
    // `Default (recommended)` — regex metacharacters, which is why the subject
    // is quoted — and describes it with the model that row resolves to, which
    // is the word the acknowledgement then carries (`Set model to Sonnet 5 …`).
    pane(IDLE_PANE);
    h.sh(`_reg_set ${ID} class default; _reg_set ${ID} routeapplied "class=opus"`);
    after('model', `${IDLE_PANE}  Select model\n  1. Default (recommended)  Sonnet 5 · Efficient for routine tasks\n`
      + '  2. Sonnet  Sonnet 5 · Efficient for routine tasks\n'
      + '❯ 3. Opus ✔  Opus 5 · Best for everyday, complex tasks\n'
      + '  4. Haiku  Haiku 4.5 · Fastest for quick answers\n');
    after('s', ACK_MODEL('Sonnet 5'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Up', 'Up', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=default');
  });

  it('(4) a class write VOIDS a standing degraded stamp — the tap is not silently a no-op', () => {
    // FINDING 4. `_route_wanted` answers the class SERVED, and the `degraded`
    // stamp is a statement about the PREVIOUS class: with `class=fable
    // degraded=opus` already applied, an operator tapping Sonnet got the record
    // rewritten, ZERO keystrokes, no refusal word, and a session still running
    // the old (more expensive) rung until some later settle.
    pane(IDLE_PANE);
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} degraded opus; _reg_set ${ID} routeapplied "class=opus"`);
    after('model', PICKER_PANE); after('s', ACK_MODEL('Sonnet 5'));
    const out = h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set class=sonnet --apply`);
    expect(h.reg(ID, 'degraded')).toBeNull();
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=sonnet');
    expect(out).not.toContain('queued');
  });

  it('(4) the other direction: a write that names NO class leaves the stamp standing', () => {
    // The rule is only wrong when the INTENT changes. An effort write says
    // nothing about which rung this lane can serve, so the stamp — and the
    // class the applier types — must survive it untouched.
    pane(IDLE_PANE);
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} degraded opus; _reg_set ${ID} routeapplied "class=opus"`);
    after('s', ACK_EFFORT('high'));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply`);
    expect(h.reg(ID, 'degraded')).toBe('opus');
    expect(h.reg(ID, 'routeapplied')).toContain('class=opus');
    expect(h.reg(ID, 'routeapplied')).toContain('effort=high');
  });
});

describe("`--apply`'s post-write stamp omits every field the `inert` stamp names (controller ruling S6-R3)", () => {
  // THE THIRD `routeapplied` WRITER. The spawn's composition and
  // `_route_apply_seed` both read the `inert` stamp before they claim a field;
  // this loop did not, so an operator writing `subagent=haiku` with `--apply`
  // to a session the last settle had already stamped `inert=subagent` got two
  // records of one session contradicting each other — `inert` saying the lane
  // composed no `CLAUDE_CODE_SUBAGENT_MODEL`, `routeapplied` saying it did —
  // until the next settle rewrote both. `workflow` had carried the same hole
  // since slice 4, when the stamp learnt the word and this arm did not.
  //
  // `compact` is NEVER inert (`ROUTE_INERTABLE` has no word for it — it is a
  // threshold ccd's own compactor reads, not something a lane composes), so its
  // arm is unguarded and the third case below is what says so.
  const GPT = 'demo-codex-lane';
  beforeEach(() => {
    install('gpt'); seed(GPT, 'gpt'); plantIdle('gpt'); pane(IDLE_PANE);
    h.sh(`_reg_set ${GPT} class opus
          _reg_set ${GPT} routeapplied "class=opus"
          _reg_set ${GPT} inert "effort,workflow,subagent"`);
  });

  it('a codex lane stamped inert=…,subagent: the record takes subagent=haiku, routeapplied does NOT', () => {
    h.sh(`${TMUX_STUB} cmd_route --session ${GPT} --set subagent=haiku --apply`);
    expect(h.reg(GPT, 'subagent')).toBe('haiku');
    expect(h.reg(GPT, 'routeapplied')).not.toContain('subagent=');
    expect(h.reg(GPT, 'routeapplied')).toBe('class=opus');
    expect(keys()).toEqual([]);
  });

  it('a codex lane stamped inert=…,workflow: the record takes workflow=off, routeapplied does NOT', () => {
    h.sh(`${TMUX_STUB} cmd_route --session ${GPT} --set workflow=off --apply`);
    expect(h.reg(GPT, 'workflow')).toBe('off');
    expect(h.reg(GPT, 'routeapplied')).not.toContain('workflow=');
    expect(h.reg(GPT, 'routeapplied')).toBe('class=opus');
  });

  it('`compact` is not in the inert vocabulary, so the same call still claims it applied', () => {
    h.sh(`${TMUX_STUB} cmd_route --session ${GPT} --set compact=80 --apply`);
    expect(h.reg(GPT, 'routeapplied')).toContain('compact=80');
  });

  it('CONTROL — an Anthropic lane carries no inert stamp and claims both fields exactly as before', () => {
    seed(ID); plantIdle(); pane(IDLE_PANE);
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} routeapplied "class=opus"`);
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set subagent=haiku --set workflow=off --apply`);
    expect(h.reg(ID, 'inert')).toBeNull();
    expect(h.reg(ID, 'routeapplied')).toContain('subagent=haiku');
    expect(h.reg(ID, 'routeapplied')).toContain('workflow=off');
  });
});

/** The measured captures (`fixtures/panes/cc291-*`): Claude Code 2.1.291 in a private tmux server, a
 *  fixture home and a mock API, 2026-10-06 — the same shapes on 2.1.285 and 2.1.288. An API-key lane,
 *  so every row carries a price and the rows are five; a Max lane lists its own rows (no prices, and
 *  Fable only while it is current — research row 232), and the static evidence in the bundled source
 *  is what bridges the two: the picker's title, footer, `s` binding and outcome prefixes are one
 *  component on both, and its visible-row count is computed from the pane's height alone. */
const PANES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes');
const capture = (name: string): string => fs.readFileSync(path.join(PANES, name), 'utf8');

describe('the /model flow as Claude Code 2.1.285–2.1.291 draws it (measured 2026-10-06)', () => {
  beforeEach(() => { seed(ID); plantIdle(); pane(IDLE_PANE); });

  it('a picker with the box, the 👤 row and the mode row drawn UNDER it (220x50): the cursor row is read off the whole pane', () => {
    // THE FLEET'S REFUSAL of 2026-10-05 — `no-picker-row (class=opus, the capture carries no cursor
    // row)` — at the canonical 220x50. `tail -12` of this capture holds the box, the statusline, the
    // mode row and the picker's LAST row only; the cursor sits on row 1 (`Default ✔`), sixteen rows up.
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', capture('cc291-model-ack-220x50-full.txt'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().slice(0, 5)).toEqual(['-l /model', 'Enter', 'Down', 'Down', '-l s']);
    expect(h.reg(ID, 'routeskip') ?? '').not.toMatch(/no-picker-row/);
  });

  it('a conversation SHORTER than the pane: the picker is drawn near the top and the last twelve rows are blank', () => {
    h.sh(`_reg_set ${ID} class sonnet; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-short.txt'));
    after('s', ACK_MODEL('Sonnet 5.5'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=sonnet');
  });

  it('a narrow pane (80x24): every description wraps, and row 1 sits fourteen rows up', () => {
    h.sh(`_reg_set ${ID} class haiku; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-80x24.txt'));
    after('s', ACK_MODEL('Haiku 4.5'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', 'Down', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=haiku');
  });

  it('a scroll-marked row (`↓ 3. Fable`, the 2.1.280 100x24 capture) is a row the cursor can reach', () => {
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc280-model-fullscreen-100x24.txt'));
    after('s', ACK_MODEL('Fable 5.1'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=fable');
  });

  it('`s` on another model raises `Switch model?`: Enter answers it, and the outcome nineteen rows up confirms', () => {
    // Every live session has turns, so every real switch meets this dialog; unanswered, no outcome
    // came and the Escape that followed was "No, go back". The outcome then renders under the echoed
    // `❯ /model`, ABOVE the box — nineteen rows from the bottom of this 220x50 pane.
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', capture('cc291-model-switch-220x50-full.txt'));
    after('Enter', capture('cc291-model-ack-220x50-full.txt'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', '-l s', 'Enter']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=fable');
    expect(h.reg(ID, 'routeskip')).toBeNull();
  });

  it('the outcome far above the bottom confirms on its own (a switch to the CURRENT model raises no dialog)', () => {
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', capture('cc291-model-ack-220x50-full.txt'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=fable');
  });

  it('a `Switch model?` WITHOUT the cache sentence (a PreModelSwitch hook\'s gate) is never answered', () => {
    const hook = capture('cc291-model-switch-220x50-full.txt')
      .replace('Your next response will be slower and use more tokens', 'A PreModelSwitch hook asked you to confirm')
      .replace(/This conversation is cached for the current model\.[^\n]*/, 'Fable needs a budget sign-off on this account.');
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', hook);
    after('Enter', capture('cc291-model-ack-220x50-full.txt'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().slice(keys().indexOf('-l s') + 1)).not.toContain('Enter');
    expect(h.reg(ID, 'routeapplied')).not.toContain('class=fable');
    expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
  });

  it('a dialog naming ANOTHER model than the row `s` was pressed on is never answered', () => {
    const other = capture('cc291-model-switch-220x50-full.txt').replace('Yes, switch to Fable 5.1', 'Yes, switch to Sonnet 5.5');
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', other);
    after('Enter', capture('cc291-model-ack-220x50-full.txt'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().slice(keys().indexOf('-l s') + 1)).not.toContain('Enter');
    expect(h.reg(ID, 'routeapplied')).not.toContain('class=fable');
  });

  it('an older outcome naming the target ABOVE a dialog still open confirms nothing', () => {
    // The Enter is pressed (the dialog is the cache one) and swallowed: the dialog stays the lowest shape
    // on the pane, so the `Set model to Fable 5.1` line above it is history, not this act's outcome.
    const stale = `${MODEL_OUTCOME('Set model to Fable 5.1 for this session only')}${capture('cc291-model-switch-220x50-full.txt')}`;
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', stale);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(h.reg(ID, 'routeapplied')).not.toContain('class=fable');
    expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
    // ONCE (review finding 11): a dialog still drawn on the next poll is a slow repaint, not a second
    // question — a further Enter could land on the prompt box the moment it closes.
    expect(keys().slice(keys().indexOf('-l s') + 1).filter((k) => k === 'Enter')).toHaveLength(1);
  });

  it('Escape on the dialog lands on the PICKER (measured), so a second Escape closes it', () => {
    const other = capture('cc291-model-switch-220x50-full.txt').replace('Yes, switch to Fable 5.1', 'Yes, switch to Sonnet 5.5');
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', other);
    after('Escape', capture('cc291-model-escape-to-picker-120x30.txt'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().slice(-2)).toEqual(['Escape', 'Escape']);
  });

  it('…and ONE Escape when it lands at the prompt — no blind second key', () => {
    const other = capture('cc291-model-switch-220x50-full.txt').replace('Yes, switch to Fable 5.1', 'Yes, switch to Sonnet 5.5');
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', other);
    after('Escape', IDLE_PANE);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().slice(keys().indexOf('-l s') + 1)).toEqual(['Escape']);
  });

  it('the Default row on a priced lane: `Use the default model (currently Opus 5.5) · $4/$20 per Mtok` binds to its outcome', () => {
    // Measured outcome: `Set model to Opus 5.5 (default) for this session only`. The ` · ` split took
    // the sentence for a model name and every `class=default` apply on such a lane was unconfirmed.
    h.sh(`_reg_set ${ID} class default; _reg_set ${ID} routeapplied "class=fable"`);
    after('model', capture('cc291-model-default-picker-120x30.txt'));
    after('s', capture('cc291-model-default-switch-120x30.txt'));
    after('Enter', capture('cc291-model-default-ack-120x30.txt'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Up', 'Up', '-l s', 'Enter']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=default');
  });

  it('no picker drawn at all, and a picker with no cursor row, are two details under one refusal word', () => {
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} routeapplied "class=default"`);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);   // `/model` never opened anything
    expect(h.reg(ID, 'routeskip')).toMatch(/no-picker-row/);
    expect(swapLog()).toContain('no-picker-row (class=opus, the capture carries no model picker)');
    h.sh(`rm -f "$REG/${ID}.routenote" "$REG/${ID}.routeskip"`);
    after('model', `${IDLE_PANE}${PICKER('  1. Default (recommended) ✔\n  2. Sonnet\n  3. Opus\n  4. Haiku')}`);
    after('Escape', IDLE_PANE);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(swapLog()).toContain('no-picker-row (class=opus, the capture carries no cursor row)');
  });

  it('a picker QUOTED in the conversation, with a later outcome line below it, is not the picker: nothing is moved', () => {
    // The whole-pane read must not reach back past the pane's latest model shape. Here `/model`
    // opened nothing, and the newest thing on screen is an outcome line printed AFTER a picker a
    // session quoted — the quote's rows and `❯` cursor are history, and a Down or an `s` aimed at
    // them would land in the prompt box.
    const quoted = `● The picker read:\n${PICKER('  ❯ 1. Default (recommended) ✔\n    2. Sonnet\n    3. Opus')}`
      + `${MODEL_OUTCOME('Set model to Sonnet 5 for this session only')}${IDLE_PANE}`;
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} routeapplied "class=default"`);
    after('model', quoted);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().filter((k) => k === 'Down' || k === 'Up' || k === '-l s')).toEqual([]);
    expect(swapLog()).toContain('the capture carries no model picker');
  });

  /** tmux whose first `n` captures answer `$HOME/late.txt` — the pane before the picker has drawn —
   *  and every later one `pane.txt`. Two covers the capture taken before `/model` is typed (the
   *  baseline a quoted picker is told apart by) and the first one after it. */
  const lateStub = (n: number): string => {
    const s = TMUX_STUB.replace('capture-pane) cat "$HOME/pane.txt" ;;',
      'capture-pane) local stub_caps; stub_caps=$(( $(cat "$HOME/cap-count" 2>/dev/null || echo 0) + 1 )); echo "$stub_caps" > "$HOME/cap-count"; '
      + `if [[ "$stub_caps" -le ${n} ]]; then cat "$HOME/late.txt"; else cat "$HOME/pane.txt"; fi ;;`);
    expect(s, 'the stub rewrite applied').not.toBe(TMUX_STUB);
    return s;
  };

  it('a picker that draws LATE (a loaded box) is waited for, not refused on the first capture', () => {
    // The capture right after Enter shows the prompt still; the picker is there on the next one.
    fs.writeFileSync(path.join(h.home, 'late.txt'), IDLE_PANE);
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} routeapplied "class=default"`);
    after('model', PICKER_PANE); after('s', ACK_MODEL('Opus 5'));
    h.sh(`${lateStub(2)} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=opus');
  });

  it('a picker QUOTED as the lowest shape while the real one draws LATE: the keys come off the REAL picker', () => {
    // Review finding 1. The quote was already the pane's lowest model shape before `/model` was typed,
    // so the first capture after it read `picker` and its rows, cursor and delta were the QUOTE's: with
    // the quote's cursor on Default, `s` landed on the real picker's cursor row (the current model) and
    // `class=default` was recorded against a pane still running Fable.
    const quote = `● The picker read:\n${PICKER('  ❯ 1. Default (recommended) ✔\n    2. Sonnet\n    3. Opus')}`;
    fs.writeFileSync(path.join(h.home, 'late.txt'), `${quote}${IDLE_PANE}`);
    pane(`${quote}${IDLE_PANE}`);
    h.sh(`_reg_set ${ID} class default; _reg_set ${ID} routeapplied "class=fable"`);
    after('model', `${quote}${capture('cc291-model-default-picker-120x30.txt')}`);
    after('s', capture('cc291-model-default-switch-120x30.txt'));
    after('Enter', capture('cc291-model-default-ack-120x30.txt'));
    h.sh(`${lateStub(2)} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Up', 'Up', '-l s', 'Enter']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=default');
  });

  it('…and a quote that is still the only picker after `/model` moves nothing', () => {
    const quote = `● The picker read:\n${PICKER('  ❯ 1. Default (recommended) ✔\n    2. Sonnet\n    3. Opus')}`;
    pane(`${quote}${IDLE_PANE}`);
    h.sh(`_reg_set ${ID} class sonnet; _reg_set ${ID} routeapplied "class=fable"`);
    after('model', `${quote}${IDLE_PANE}`);
    after('Escape', `${quote}${IDLE_PANE}`);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().filter((k) => k === 'Down' || k === 'Up' || k === '-l s')).toEqual([]);
    expect(h.reg(ID, 'routeskip')).toMatch(/no-picker-row/);
    expect(swapLog()).toContain('the capture carries no model picker but the one on the pane before /model');
  });

  it('the Default row binds `<X> (default)` off its own `(currently X)`: another model\'s dialog is never answered', () => {
    // Review finding 2: the Default row's subject was `.*`, so Enter went to ANY cache dialog.
    const other = capture('cc291-model-default-switch-120x30.txt').replaceAll('Opus 5.5 (default)', 'Haiku 4.5');
    h.sh(`_reg_set ${ID} class default; _reg_set ${ID} routeapplied "class=fable"`);
    after('model', capture('cc291-model-default-picker-120x30.txt'));
    after('s', other);
    after('Enter', capture('cc291-model-default-ack-120x30.txt'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().slice(keys().indexOf('-l s') + 1)).not.toContain('Enter');
    expect(h.reg(ID, 'routeapplied')).not.toContain('class=default');
  });

  it('…nor is another model\'s outcome taken for the Default row\'s', () => {
    h.sh(`_reg_set ${ID} class default; _reg_set ${ID} routeapplied "class=fable"`);
    after('model', capture('cc291-model-default-picker-120x30.txt'));
    after('s', ACK_MODEL('Haiku 4.5'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(h.reg(ID, 'routeapplied')).not.toContain('class=default');
    expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
  });

  it('the WRAPPED Default row (80x24) and the nested `(currently Opus 5.5 (1M context))` bind their own name', () => {
    h.sh(`_reg_set ${ID} class default; _reg_set ${ID} routeapplied "class=fable"`);
    after('model', capture('cc291-model-picker-80x24.txt'));
    after('s', ACK_MODEL('Haiku 4.5'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(h.reg(ID, 'routeapplied')).not.toContain('class=default');
    expect(h.sh(`_route_ack_subject 'Default (recommended)' 'Use the default model (currently Opus 5.5) ·' Default`))
      .toBe('Opus 5\\.5 \\(default\\)');
    expect(h.sh(`_route_ack_subject 'Default (recommended)' 'Use the default model (currently Opus 5.5 (1M context)) · $4/$20' Default`))
      .toBe('Opus 5\\.5 \\(1M context\\) \\(default\\)');
  });

  it('a Default row naming no model at all keeps the loose outcome and never answers a dialog', () => {
    h.sh(`_reg_set ${ID} class default; _reg_set ${ID} routeapplied "class=opus"`);
    after('model', `${IDLE_PANE}${PICKER('  1. Default (recommended)\n  2. Sonnet\n❯ 3. Opus ✔\n  4. Haiku')}`);
    after('s', capture('cc291-model-default-switch-120x30.txt'));
    after('Enter', capture('cc291-model-default-ack-120x30.txt'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().slice(keys().indexOf('-l s') + 1)).not.toContain('Enter');
    expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
  });

  it('a PreModelSwitch hook\'s gate is never answered, even when its reason quotes the cache sentence', () => {
    // Review finding 3: one component draws both; only the subtitle tells them apart.
    const hook = capture('cc291-model-switch-220x50-full.txt')
      .replace('Your next response will be slower and use more tokens', 'A PreModelSwitch hook asked you to confirm');
    expect(hook).toContain('is cached for the current model');
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', hook);
    after('Enter', capture('cc291-model-ack-220x50-full.txt'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().slice(keys().indexOf('-l s') + 1)).not.toContain('Enter');
    expect(h.reg(ID, 'routeapplied')).not.toContain('class=fable');
  });

  it('`_pane_model_state` reports a cursor row only for the cache form: subtitle first, cache sentence, no hook line anywhere', () => {
    const dlg = (sub: string, extra = ''): string => `${RULE}\n  Switch model?\n  ${sub}\n${extra}  This conversation is cached for the current model. Switching to Sonnet 5.5 means the full history gets\n  re-read on your next message.\n  ❯ 1. Yes, switch to Sonnet 5.5\n    2. No, go back\n`;
    const state = (p: string): string => { fs.writeFileSync(path.join(h.home, 'probe.txt'), p); return h.sh('_pane_model_state "$(cat "$HOME/probe.txt")"'); };
    expect(state(dlg('Your next response will be slower and use more tokens'))).toBe('dialog ❯ 1. Yes, switch to Sonnet 5.5');
    expect(state(dlg('A PreModelSwitch hook asked you to confirm'))).toBe('dialog');
    expect(state(dlg('Your next response will be slower and use more tokens', '  A PreModelSwitch hook asked you to confirm\n'))).toBe('dialog');
  });

  it('a `Switch model?` carrying the cache sentence but not the cache subtitle is never answered', () => {
    const odd = capture('cc291-model-switch-220x50-full.txt')
      .replace('Your next response will be slower and use more tokens', 'Fable needs a budget sign-off on this account.');
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', odd);
    after('Enter', capture('cc291-model-ack-220x50-full.txt'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().slice(keys().indexOf('-l s') + 1)).not.toContain('Enter');
  });

  it('the row\'s name is matched WHOLE: `Fable 5.1 (1M context)` neither answers nor confirms a `Fable 5.1` row', () => {
    // Review finding 4: an unanchored `(Fable|Fable 5\.1)` matched any Fable-* model.
    const wider = capture('cc291-model-switch-220x50-full.txt').replaceAll('Fable 5.1', 'Fable 5.1 (1M context)');
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', wider);
    after('Enter', ACK_MODEL('Fable 5.1 (1M context)'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().slice(keys().indexOf('-l s') + 1)).not.toContain('Enter');
    expect(h.reg(ID, 'routeapplied')).not.toContain('class=fable');
  });

  it('…and an outcome naming a NEIGHBOUR of the row\'s model confirms nothing', () => {
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', ACK_MODEL('Fable 4.1'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(h.reg(ID, 'routeapplied')).not.toContain('class=fable');
    expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
  });

  it('class=sonnet on the 2.1.280 picker takes the `Sonnet` row, never `Sonnet 5 (1M context)` below it', () => {
    // Review finding 5: the last first-word match won, so the session moved to the 1M variant.
    h.sh(`_reg_set ${ID} class sonnet; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc280-model-fullscreen-100.txt'));
    after('s', ACK_MODEL('Sonnet 5'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', 'Down', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('class=sonnet');
  });

  it('…and an EXACT `Sonnet` label wins over a `Sonnet …` variant listed above it', () => {
    h.sh(`_reg_set ${ID} class sonnet; _reg_set ${ID} routeapplied "class=default"`);
    after('model', `${IDLE_PANE}${PICKER('❯ 1. Default (recommended) ✔\n  2. Sonnet (1M context)\n  3. Sonnet\n  4. Haiku')}`);
    after('s', ACK_MODEL('Sonnet 5'));
    h.sh(`${TMUX_STUB} _route_apply_now ${ID}`);
    expect(keys()).toEqual(['-l /model', 'Enter', 'Down', 'Down', '-l s']);
  });

  it('the dialog still the lowest shape after the first Escape gets the second', () => {
    // Review finding 13: no Escape transition, so the pane stays on the dialog.
    const other = capture('cc291-model-switch-220x50-full.txt').replace('Yes, switch to Fable 5.1', 'Yes, switch to Sonnet 5.5');
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', other);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().slice(keys().indexOf('-l s') + 1)).toEqual(['Escape', 'Escape']);
  });

  it('a newer `Kept model as …` supersedes an older `Set model to …` (built from the bundled source\'s string, not measured)', () => {
    // Review finding 14: a cancel's outcome below an older switch's is the pane's latest word.
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} routeapplied "class=default"`);
    after('model', capture('cc291-model-picker-220x50-full.txt'));
    after('s', `${MODEL_OUTCOME('Set model to Fable 5.1 for this session only')}${MODEL_OUTCOME('Kept model as Opus 5.5')}${IDLE_PANE}`);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(h.reg(ID, 'routeapplied')).not.toContain('class=fable');
    expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
  });

  it('the picker ends at its footer: a numbered line drawn below it is no row', () => {
    // Review finding 15.
    h.sh(`_reg_set ${ID} class sonnet; _reg_set ${ID} routeapplied "class=default"`);
    after('model', `${IDLE_PANE}${PICKER('❯ 1. Default (recommended) ✔\n  2. Opus\n  3. Haiku')}  4. Sonnet  quoted\n`);
    after('Escape', IDLE_PANE);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(keys().filter((k) => k === 'Down' || k === 'Up' || k === '-l s')).toEqual([]);
  });

  it('`_route_picker_rows` reads a scroll marker as a row and never as the cursor', () => {
    const out = h.sh(`_route_picker_rows "$(printf '%s\\n' '  ❯ 1. Default ✔  a' '    2. Opus  b' '  ↓ 3. Fable  c' '  ↑ 4. Sonnet  d')"`);
    expect(out.trim().split('\n')).toEqual(['1\t1\tDefault\ta', '2\t0\tOpus\tb', '3\t0\tFable\tc', '4\t0\tSonnet\td']);
  });
});

describe('the read-back — a class the pane already runs is recorded, never typed (2026-10-05 fleet loop)', () => {
  // THE FLEET'S SHAPE: three refused applies, then the operator typed `/model opus` by hand, and ccd
  // logged `apply-gave-up (class=opus after 3 attempts)` every half hour for ever, because
  // `routeapplied` still said `class=fable` and nothing ever read the pane's model back.
  const usageFile = (): string => path.join(h.home, '.cc-sessions', 'usage', `${ID}.json`);
  const sidecar = (body: string): void => {
    fs.mkdirSync(path.dirname(usageFile()), { recursive: true });
    fs.writeFileSync(usageFile(), body);
  };
  const nowS = (): number => Math.floor(Date.now() / 1000);
  /** The hook's own `jq -c` shape (statusline-command.sh), key order and all. */
  const reading = (model: string | null, ageS = 5, effort: string | null = 'medium', uuid = UUID): string =>
    `${JSON.stringify({ ts: nowS() - ageS, uuid, account: 'acct-a', model, effort, ctxPct: 12, cost: 0.5, agent: null })}\n`;
  /** The stamp's time is what a reading must postdate: put the last spawn ten minutes back. */
  const stampAged = (ageS = 600): void => {
    const f = path.join(h.home, '.cc-sessions', `${ID}.routeapplied`);
    fs.utimesSync(f, nowS() - ageS, nowS() - ageS);
  };
  beforeEach(() => {
    seed(ID); plantIdle(); pane(IDLE_PANE);
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} routeapplied "class=fable"
          _reg_set ${ID} routetries "3 $(date +%s)"; _reg_set ${ID} routeskip "$(date +%s) apply-gave-up"; _reg_set ${ID} routenote "$(date +%s)"`);
    stampAged();
  });

  it('a FRESH sidecar running the pending class: recorded applied, the counters cleared, ONE line, nothing typed', () => {
    sidecar(reading('claude-opus-5-5'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=opus');
    expect(h.reg(ID, 'routetries')).toBeNull();
    expect(h.reg(ID, 'routeskip')).toBeNull();
    expect(h.reg(ID, 'routenote')).toBeNull();
    expect(keys()).toEqual([]);
    const lines = swapLog().split('\n').filter((l) => l.includes(ID));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(`route-readback ${ID}: class=opus already running \\(sidecar model claude-opus-5-5, effort medium, \\d+s old\\) — recorded applied, nothing typed`));
    // And the loop is over: the next tick finds nothing pending and says nothing.
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(swapLog()).not.toContain('apply-gave-up');
  });

  it('the `[1m]` model id is the same family', () => {
    sidecar(reading('claude-opus-5-5[1m]'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=opus');
  });

  it('a STALE sidecar (older than USAGE_FRESH_S) counts for nothing: the give-up note stands', () => {
    // The stamp is older still, so the reading postdates the last spawn and ONLY its age refuses it.
    stampAged(USAGE_FRESH_S + 600);
    sidecar(reading('claude-opus-5-5', USAGE_FRESH_S + 1));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=fable');
    expect(h.reg(ID, 'routetries')).toMatch(/^3 /);
    expect(swapLog()).not.toContain('route-readback');
  });

  it('a reading OLDER than the routeapplied stamp is the previous process\'s and counts for nothing', () => {
    sidecar(reading('claude-opus-5-5', 30));
    stampAged(0);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=fable');
  });

  it('a sidecar running ANOTHER class counts for nothing', () => {
    sidecar(reading('claude-sonnet-5-5'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=fable');
    expect(swapLog()).not.toContain('route-readback');
  });

  it('absent, unreadable and malformed are three answers, and none of them counts', () => {
    expect(h.sh(`_usage_sidecar_read ${ID}`).trim()).toBe('absent');
    fs.mkdirSync(usageFile(), { recursive: true });   // there, and not a file ccd can read
    expect(h.sh(`_usage_sidecar_read ${ID}`).trim()).toBe('unreadable');
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=fable');
    fs.rmSync(usageFile(), { recursive: true });
    for (const bad of ['not json at all\n', '{"model":"claude-opus-5-5","effort":"high"}\n', '{"ts":"1791290000","model":"claude-opus-5-5"}\n']) {
      sidecar(bad);
      expect(h.sh(`_usage_sidecar_read ${ID}`).trim(), bad).toBe('malformed');
      h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
      expect(h.reg(ID, 'routeapplied'), bad).toBe('class=fable');
    }
    sidecar(reading(null, 5, null));
    expect(h.sh(`_usage_sidecar_read ${ID}`).trim()).toMatch(new RegExp(`^reading \\d+ - - ${UUID}$`));
    sidecar(reading('claude-opus-5-5', 5, 'high'));
    expect(h.sh(`_usage_sidecar_read ${ID}`).trim()).toMatch(new RegExp(`^reading \\d+ claude-opus-5-5 high ${UUID}$`));
    expect(swapLog()).not.toContain('route-readback');
  });

  it('`default` never reads back: no model id is the lane\'s default', () => {
    h.sh(`_reg_set ${ID} class default`);
    stampAged();
    sidecar(reading('claude-opus-5-5'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=fable');
  });

  it('effort NEVER reads back: the sidecar cannot tell a level set from the model\'s default, so the tick TYPES it', () => {
    // Review finding 6. A session spawned with no effort runs its model's DEFAULT level, which is what
    // the status line (so the sidecar) shows. Recorded as an applied session-only effort, nothing was
    // typed — and the next class change then dropped it, since only a TYPED session-only effort
    // survives a model change (D-2811), with nothing pending to re-ask it.
    h.sh(`_reg_set ${ID} effort medium; _reg_set ${ID} routeapplied "class=opus"; rm -f "$REG/${ID}.routetries"`);
    stampAged();
    sidecar(reading('claude-opus-5-5', 5, 'medium'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=opus');
    expect(swapLog()).not.toContain('route-readback');
    expect(keys()[0]).toBe('-l /effort');
  });

  it('a reading from the SAME SECOND as the stamp is not placed after it', () => {
    // Review finding 7: both clocks tick in whole seconds, so `ts == stamp` cannot be told from a
    // previous process's last render.
    const t = nowS() - 5;
    fs.utimesSync(path.join(h.home, '.cc-sessions', `${ID}.routeapplied`), t, t);
    sidecar(`${JSON.stringify({ ts: t, uuid: UUID, account: 'acct-a', model: 'claude-opus-5-5', effort: 'medium', ctxPct: 12, cost: 0.5, agent: null })}\n`);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=fable');
  });

  it('a sidecar naming ANOTHER session (a second claude in the tmux session) counts for nothing', () => {
    // Review finding 10: the hook keys the file on the tmux SESSION, so any agent-less render in it writes here.
    sidecar(reading('claude-opus-5-5', 5, 'medium', 'cafef00d-0000-4000-8000-000000000000'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=fable');
    expect(swapLog()).not.toContain('route-readback');
  });

  it('a body two JSON readers could read differently (nested, duplicate key) is malformed', () => {
    // Review finding 8: the regex takes the first `"model":`, JSON.parse the last.
    const ts = nowS() - 5;
    for (const bad of [
      `{"ts":${ts},"x":{"model":"claude-opus-5-5"},"model":"claude-sonnet-5"}\n`,
      `{"ts":${ts},"x":{"model":"claude-opus-5-5"}}\n`,
      `{"ts":${ts},"model":"claude-opus-5-5","model":"claude-sonnet-5"}\n`,
      `{"ts":${ts},"ts":${ts - 3600},"model":"claude-opus-5-5"}\n`,
      `{"ts":${ts},"model":"claude-opus-5-5","effort":"low","effort":"max"}\n`,
    ]) {
      sidecar(bad);
      expect(h.sh(`_usage_sidecar_read ${ID}`).trim(), bad).toBe('malformed');
    }
  });

  it('a FIFO at the sidecar path is unreadable, never a read that blocks the tick', { timeout: 60_000 }, () => {
    // Review finding 12: `head` on a FIFO waits for a writer; the `-f` test is what keeps the tick alive.
    fs.mkdirSync(path.dirname(usageFile()), { recursive: true });
    execFileSync('mkfifo', [usageFile()]);
    const out = h.sh(`timeout 10 bash -c 'source "$1"; _usage_sidecar_read "$2"' ccd-fifo-probe '${CCD}' ${ID} || echo "rc=$?"`);
    expect(out.trim()).toBe('unreadable');
  });

  it('class read back, effort still pending and unreadable: the tick goes on and TYPES the effort', () => {
    h.sh(`_reg_set ${ID} effort low`);
    stampAged();
    sidecar(reading('claude-opus-5-5', 5, 'high'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toContain('class=opus');
    expect(keys()[0]).toBe('-l /effort');
  });

  it('`--apply` is unchanged: the operator\'s verb types the picker whatever the sidecar says', () => {
    h.sh(`rm -f "$REG/${ID}.routetries"`);
    sidecar(reading('claude-opus-5-5'));
    after('model', PICKER_PANE); after('s', ACK_MODEL('Opus 5'));
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set class=opus --apply`);
    expect(keys().slice(0, 2)).toEqual(['-l /model', 'Enter']);
    expect(swapLog()).not.toContain('route-readback');
  });

  it('ROUTE_READBACK_FRESH is USAGE_FRESH_S — the age the fleet row calls stale', () => {
    const m = /^ROUTE_READBACK_FRESH=(\d+)\b/m.exec(fs.readFileSync(CCD, 'utf8'));
    expect(m, 'ccd/ccd no longer defines ROUTE_READBACK_FRESH= at column 0').not.toBeNull();
    expect(Number(m![1])).toBe(USAGE_FRESH_S);
  });
});
