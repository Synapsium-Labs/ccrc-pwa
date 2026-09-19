// The MANUAL-SWAP PIN — D-3097, D-3098, D-3099.
//
// THE DEFECT, FROM THE FLEET'S OWN LOG rather than from a hypothesis.
// `cmd_swap` moves `wrapper` and never touches `home`, and `_auto_swap_check`'s
// affinity arm exists to "return home the instant home has room again". So an
// operator's swap was reversed by the first tick past `SWAP_COOLDOWN` — 900
// seconds, which is what "it switched back straight away" measures to.
// `$REG/swap.log` on the fleet host, 2026-09-19, one session and one afternoon:
//
//   14:30:22 swap      <row>: <home-lane> -> gpt
//   15:25:47 auto-home <row>: gpt -> <home-lane>
//   15:36:54 swap      <row>: <home-lane> -> gpt
//   15:51:56 auto-home <row>: gpt -> <home-lane>   (15m 02s later)
//   16:28:53 swap      <row>: <home-lane> -> gpt
//   17:01:11 auto-home <row>: gpt -> <home-lane>
//
// `ccd prefer` is the verb that moves `home` and it is shell-only — no
// whitelist entry, no `CCD_ARGV` builder — so a PWA tap could not reach the one
// verb that would have made the choice stick.
//
// WHAT THE PIN IS, AND THE TWO THINGS IT IS NOT. It is a marker naming the
// account a HUMAN chose; the affinity arm stands down while the row is still on
// it. It is NOT a re-home (`home` is untouched, so ordinary affinity resumes the
// moment anything else moves the row) and it is NOT a hold: the limit RESCUE arm
// is above it and is not gated by it.
//
// FIXTURE HOME ONLY (`makeCcdHarness`) — nothing here may reach the live
// registry, tmux or systemd. `_dispatch_swap` is stubbed to RECORD, which is
// what makes "no relocation happened" an assertion rather than an assumption.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, CCD, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-pin-'); });
afterEach(() => { h.cleanup(); });

const ID = 'myid';
const PROMPT = '? for shortcuts\n❯ ';
const BANNER_PANE = 'API Error: 429 Too Many Requests\n❯ ';

const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string =>
  fs.existsSync(reg('swap.log')) ? fs.readFileSync(reg('swap.log'), 'utf8') : '';
const pin = (): string | null => h.reg(ID, 'swappin');
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));

/** A live row sitting on `claude-a` with its home still `claude` — the state a
 *  manual swap away from home leaves behind, and the one the affinity arm used
 *  to undo. `_swap_target` is stubbed to the home account so the arm HAS a
 *  destination: a test that let the real ranker answer would be measuring the
 *  fixture roster's telemetry instead of the gate. */
const seed = (wrapper = 'claude-a'): void => {
  h.sh(`_reg_set ${ID} uuid 11111111-1111-4111-8111-111111111111
        _reg_set ${ID} project demo
        _reg_set ${ID} workdir "$HOME/projects/demo"
        _reg_set ${ID} wrapper ${wrapper}
        _reg_set ${ID} home claude
        _reg_set ${ID} started 1`);
};

/** One supervise tick with the affinity arm reachable: a wide, idle, quiet pane
 *  at a prompt, and a destination. Everything the arm reads below the pin is
 *  satisfied, so a tick that does NOT dispatch did so because of the pin. */
const STUBS = (pane = PROMPT, target = 'claude'): string => `
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
    capture-pane) printf '%s\\n' ${JSON.stringify(pane)} ;; list-panes) echo 4242 ;; esac; return 0; };
  _pane_box_draft() { :; };
  _session_hard_blocked() { HARD_BLOCK_VIA=""; return 1; };
  _swap_target() { echo ${target}; }; _avail() { return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;

/** `<config>/sessions/<pane pid>.json`, the file the idle and quiet gates read. */
const sessionJson = (status = 'idle', quietSeconds = 600): void => {
  const d = path.join(h.home, '.claude-a', 'sessions');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '4242.json'), JSON.stringify({
    status, statusUpdatedAt: (Math.floor(Date.now() / 1000) - quietSeconds) * 1000,
  }));
};

const tick = (stubs = STUBS()): string => h.sh(`${stubs} _auto_swap_check ${ID}`);

// ── the arm the pin stands down, proven to fire without one ────────────────

describe('D-3097: the control — with no pin the affinity arm relocates the row home', () => {
  it('an idle, quiet session off home is pulled back, which is the behaviour being gated', () => {
    // THE POSITIVE CONTROL, and this suite is worthless without it: every case
    // below asserts that a dispatch did NOT happen, and a fixture in which the
    // arm could never have dispatched anyway would make all of them vacuously
    // green (the `a-green-mutation-needs-a-control` shape).
    seed(); sessionJson();
    tick();
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude`]);
    expect(swapLog()).toMatch(/auto-home myid: claude-a -> claude \[home=claude\]/);
  });
});

describe('D-3097: a pin naming the row’s own account stands the affinity arm down', () => {
  it('no dispatch, and `home` is not rewritten to buy it', () => {
    seed(); sessionJson();
    h.sh(`_reg_set ${ID} swappin claude-a`);
    tick();
    expect(dispatches()).toEqual([]);
    // The pin is not a re-home: the row still KNOWS where it belongs, which is
    // what lets ordinary affinity resume the moment the pin stops applying.
    expect(h.reg(ID, 'home')).toBe('claude');
    expect(pin()).toBe('claude-a');
  });

  it('a pin naming a DIFFERENT account does not stand the arm down — it is ended instead', () => {
    // The pin is a claim about the present. A row that has moved off the pinned
    // account is no longer the row the operator pinned, and the marker must not
    // go on suppressing affinity from the grave.
    seed(); sessionJson();
    h.sh(`_reg_set ${ID} swappin claude-b`);
    tick();
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude`]);
    expect(pin()).toBeNull();
    expect(swapLog()).toMatch(/pin-ended myid: pinned to claude-b, now on claude-a/);
  });
});

describe('D-3097: the RESCUE arm is not gated by the pin', () => {
  it('a hard-blocked pinned session is still evacuated', () => {
    // The single most important case in this file. A pin is a preference about
    // where a HEALTHY session sits; a limited one is stuck NOW, and leaving it
    // wedged because an operator once chose that lane would be a worse defect
    // than the one being fixed. The rescue arm sits ABOVE the pin check, and
    // this is the measurement that says so.
    seed();
    h.sh(`_reg_set ${ID} swappin claude-a`);
    tick(`
      tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
        capture-pane) printf '%s\\n' ${JSON.stringify(BANNER_PANE)} ;; list-panes) echo 4242 ;; esac; return 0; };
      _pane_box_draft() { :; };
      _swap_target() { echo claude; }; _avail() { return 0; };
      _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude`]);
    expect(swapLog()).toMatch(/auto-rescue myid: claude-a \(blocked\) -> claude/);
  });
});

describe('D-3098: the stand-down is SAID, once per floor', () => {
  it('the first pinned tick writes one line; the next ticks inside the floor write none', () => {
    // Unfloored this is 12 lines a minute per session into a file a human reads
    // — `_compact_note`'s own measurement, and the reason `_route_note_floored`
    // exists rather than a second copy of its arithmetic.
    seed(); sessionJson();
    h.sh(`_reg_set ${ID} swappin claude-a`);
    tick(); tick(); tick();
    const lines = swapLog().split('\n').filter((l) => l.includes(' pin-hold '));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /pin-hold myid: pinned to claude-a by hand; the return-home\/ceiling arm stands down \(a limit still evacuates\)/);
    expect(dispatches()).toEqual([]);
  });

  it('the floor anchor is the row’s own field, so a NEW pin speaks straight away', () => {
    // `_swap_pin_tick` clears `swappinnote` with the pin. Without that, a pin
    // ended and a fresh one taken inside the same 1800 seconds would be silent
    // — the operator's second choice suppressed by the floor their first one
    // set.
    seed(); sessionJson();
    h.sh(`_reg_set ${ID} swappin claude-a`);
    tick();
    expect(h.reg(ID, 'swappinnote')).toMatch(/^\d+$/);
    h.sh(`_reg_set ${ID} swappin claude-b`);   // the row moved on; the pin is stale
    tick();
    expect(h.reg(ID, 'swappinnote')).toBeNull();
  });
});

describe('D-3099: the pin follows the truth', () => {
  it('an UNREADABLE pin is neither deleted nor ignored — doubt reads as pinned', () => {
    // `_crosspool_tick`'s lesson, applied to a second operator marker: deleting
    // a deliberate choice on a read that FAILED is a destructive act on a false
    // reason. And standing the arm down is the safe direction here, exactly as
    // `-e` (not `-f`) on the hold file two lines below makes an unreadable hold
    // defer.
    seed(); sessionJson();
    fs.mkdirSync(reg(`${ID}.swappin`));   // a directory: present, readable by nobody as a value
    tick();
    expect(dispatches()).toEqual([]);
    expect(fs.existsSync(reg(`${ID}.swappin`))).toBe(true);
  });

  it('no pin at all is not a pin — absent and unreadable are different conditions', () => {
    seed(); sessionJson();
    tick();
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude`]);
  });
});

// ── the writers ───────────────────────────────────────────────────────────

describe('D-3097: cmd_swap mints the pin, and only on the operator path', () => {
  /** The carry, stubbed down to the registry flip: this suite is about which
   *  marker the verb leaves behind, not about transcripts or systemd. */
  const SWAP_STUBS = `
    _svc_stop() { :; }; _svc_start() { :; }; cmd_ensure() { :; };
    _swap_beat() { :; }; _swap_beat_stop() { :; };
    _transcript_matches() { echo found; }; _swap_carry_jsonl() { :; };
    _swap_carry_sidecars() { :; }; _sanitize_anthropic() { :; };
    _lc_done() { :; }; _account_still_rostered() { :; }; _wrapper_rostered_now() { return 0; };
    tmux() { :; }; sleep() { :; };`;

  it('a human swap writes the target into the pin', () => {
    seed('claude');
    h.sh(`${SWAP_STUBS} cmd_swap ${ID} claude-a`);
    expect(h.reg(ID, 'wrapper')).toBe('claude-a');
    expect(pin()).toBe('claude-a');
  });

  it('the tick’s own dispatch (CCD_SWAP_AUTO=1) writes NO pin and CLEARS one', () => {
    // A rescue that minted a pin would then refuse to bring the session home —
    // the exact opposite of what a rescue means. And a rescue that left an old
    // pin standing would leave a marker naming an account the row has just
    // left; `_swap_pin_tick` would reach that conclusion on its next pass, and
    // doing it here means the two surfaces never disagree even for one tick.
    seed('claude');
    h.sh(`_reg_set ${ID} swappin claude`);
    h.sh(`${SWAP_STUBS} CCD_SWAP_AUTO=1 cmd_swap ${ID} claude-a`);
    expect(h.reg(ID, 'wrapper')).toBe('claude-a');
    expect(pin()).toBeNull();
  });
});

describe('D-3099: an explicit `prefer` supersedes a pin', () => {
  it('setting home by hand removes the pin, so one session never has two answers', () => {
    // `prefer` says "keep it here" in the field the affinity arm actually
    // reads. A pin left standing beside it would silently suppress the
    // return-home the operator just asked for — and the pin would win.
    seed('claude-a');
    h.sh(`_reg_set ${ID} swappin claude-a`);
    h.sh(`_lc_done() { :; }; _account_still_rostered() { :; }; cmd_prefer ${ID} claude-a`);
    expect(h.reg(ID, 'home')).toBe('claude-a');
    expect(pin()).toBeNull();
  });
});

describe('source pins: the two properties no fixture can observe', () => {
  it('the pin check sits ABOVE the hold and BELOW the rescue dispatch', () => {
    // Placement IS the contract here, and the suite above can only measure it
    // through behaviour that a later edit could satisfy by accident. The order
    // of these three anchors inside `_auto_swap_check` is what makes "a limit
    // still evacuates a pinned session" true by construction.
    const src = fs.readFileSync(CCD, 'utf8');
    const rescue = src.indexOf('auto-rescue $id: $wrapper (blocked)');
    const pinCheck = src.indexOf('if _swap_pinned "$id" "$wrapper"; then');
    const hold = src.indexOf('[[ -e "$REG/$id.hold" ]] && return 0');
    expect(rescue, 'the rescue log line moved or was renamed').toBeGreaterThan(0);
    expect(pinCheck, 'the pin check is gone from _auto_swap_check').toBeGreaterThan(0);
    expect(hold, 'the hold check moved or was renamed').toBeGreaterThan(0);
    expect(rescue, 'the pin now gates the rescue arm — a limited pinned session would wedge').toBeLessThan(pinCheck);
    expect(pinCheck, 'the pin check fell below the hold; keep it beside its own argument').toBeLessThan(hold);
  });

  it('the pin carries no epoch, so nothing about it can expire or reach arithmetic', () => {
    // "The operator picked this account" does not become less true after an
    // hour. The file holds ONE account name; the end of a pin is a measurement
    // (`_swap_pin_tick`), never a clock — and a field with no number in it is a
    // field D-299's class cannot reach.
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).toContain('_reg_set "$id" swappin "$target"');
    const arith = src.split('\n').filter((l) => l.includes('swappin"') && l.includes('$(('));
    expect(arith, 'the pin grew an epoch; give it a digit guard and an arith-containment row').toEqual([]);
  });
});
