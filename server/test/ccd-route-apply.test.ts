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
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-apply-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const UUID = 'deadbeef-0000-4000-8000-000000000000';

const IDLE_PANE = '│ 🤖 Opus 5 · xhigh │ ▓ ctx ▁▁▁ 20% │\n❯ \n';
const MID_TURN_PANE = 'Working… (esc to interrupt)\n';
const PICKER_PANE = `${IDLE_PANE}❯ 1. Default (recommended) ✔\n  2. Sonnet\n  3. Opus\n  4. Haiku\nEnter to set as default · s to use this session only · Esc to cancel\n`;
const ACK_EFFORT = (level: string): string => `${IDLE_PANE}Set effort level to ${level} (this session only): …\n`;
const ACK_MODEL = (name: string): string => `${IDLE_PANE}Set model to ${name} for this session only\n`;
const DIALOG_PANE = `${IDLE_PANE}Change effort level?\n❯ 1. Yes, switch to high\n  2. No, go back\n`;

/** tmux, RECORDING. `capture-pane` answers `$HOME/pane.txt`; a `send-keys`
 *  whose key text names an existing `$HOME/pane-after-<key>.txt` copies that
 *  file over `pane.txt`, so a case SCRIPTS the pane's transitions. The `Enter`
 *  transition is guarded on the dialog actually being up: the Enter that
 *  submits `/effort` comes first and must not land the acknowledgement early. */
const TMUX_STUB = `tmux() {
  echo "tmux $*" >> "$HOME/tmux-calls"
  case "$1" in
    capture-pane) cat "$HOME/pane.txt" ;;
    list-panes)   echo 4242 ;;
    send-keys)    shift; while [[ "\${1:-}" == -t ]]; do shift 2; done; k="$*"; k="\${k#-l }"; k="\${k#/}"
                  if [[ -f "$HOME/pane-after-$k.txt" ]]; then
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
const plantIdle = (): void => {
  const dir = path.join(h.sh('_cfg_dir claude').trim(), 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '4242.json'), JSON.stringify({ status: 'idle', statusUpdatedAt: Date.now() - 120_000 }));
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
    after('model', PICKER_PANE);
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

  it('no acknowledgement within the window: apply-unconfirmed, nothing recorded, the next tick retries', () => {
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high --apply`);   // the pane never shows the ack line
    expect(h.reg(ID, 'routeapplied')).not.toContain('effort=high');
    expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
    fs.writeFileSync(path.join(h.home, 'tmux-calls'), '');
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()[0]).toBe('-l /effort');
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
});
