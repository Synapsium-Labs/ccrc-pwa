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
import { CCD, ghContainedEnv, harnessBin, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

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
    after('model', `${IDLE_PANE}  1. Default (recommended)  Use the default model (currently gpt-5.6-sol[1m])\n`
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
    const STALE = `${IDLE_PANE}Set model to Sonnet 5 for this session only\n`;
    pane(STALE);
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} routeapplied "class=sonnet"`);
    after('model', `${STALE}❯ 1. Default (recommended) ✔\n  2. Sonnet\n  3. Opus\n  4. Haiku\n`);
    h.sh(`${TMUX_STUB} _route_apply_now ${ID} || :`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=sonnet');
    expect(h.reg(ID, 'routeskip')).toMatch(/apply-unconfirmed/);
    expect(keys().at(-1)).toBe('Escape');
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
    after('model', `${IDLE_PANE}  1. Default (recommended)  Sonnet 5 · Efficient for routine tasks\n`
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
