// ONE check before ccd types into a pane (operator ruling SH-9, D-8271).
//
// Every place ccd presses a key into a session's pane goes through `_pane_type_ready`, which refuses on three
// readings of the pane: a half-typed draft in the input box (the box read every typer already used), the pane in a
// tmux mode such as copy-mode (`#{pane_in_mode}`: keys go to the mode, not to Claude Code), and a pane narrower
// than `READER_MIN_COLS` (the width below which ccd's own screen readers cannot be trusted). Each refusal is one
// `type-refused` line in `$REG/swap.log` naming the session and the reason.
//
// The rows: (1) the census, read off `ccd/ccd` itself, that every function holding a key sender calls the check
// before its first key, or is a continuation of a sequence whose every caller did; (2) one row per refusal reason
// and the pass case, with the log line; (3) the floor; (4) a row per kind of site driven through the real function.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, boxed, type CcdHarness, ccdSource } from './ccdWsHelpers.js';
import { READER_MIN_COLS } from '../../shared/api.js';

const CHECK = '_pane_type_ready';
/** The same key-sender pattern `ccd-limit-no-keys.test.ts` refuses, so the two censuses cannot disagree on what a key is. */
const SENDS = /send-keys|_send_keys|paste-buffer|load-buffer|send-prefix/;

/** Functions that press keys only in the MIDDLE of a sequence a checked function began: closing the picker or slider
 *  it opened, confirming the dialog its own keystroke raised, answering a startup gate the spawn loop checked for.
 *  Checking again there would refuse ccd's own half-finished text (the `/effort` it just typed reads as a draft),
 *  and leave a picker standing. Each is held to its callers below: every caller must be checked, or be one of these. */
const CONTINUATIONS = ['_route_escape', '_route_model_close', '_route_model_ack_wait', '_answer_two_option_dialog'];

/** The functions that begin a typing sequence today. Non-vacuity: a census that found none would pass on anything. */
const KNOWN_TYPERS = [
  '_auto_stale_check', '_auto_compact_check', '_route_type_effort', '_route_type_model',
  '_accept_first_run_prompts', '_redrive_after_spawn', 'cmd_clip',
];

type Fn = { name: string; code: string[] };

/** `ccd/ccd` cut into functions: a line belongs to the last `name() {` defined at column 0 above it. Comment lines
 *  and trailing ` # …` comments are dropped, so prose that NAMES a key sender is not one. */
function functions(src: string): Map<string, Fn> {
  const out = new Map<string, Fn>();
  let cur: Fn | null = null;
  for (const raw of src.split('\n')) {
    const def = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/.exec(raw);
    if (def) { cur = { name: def[1]!, code: [] }; out.set(cur.name, cur); }
    if (!cur || /^\s*#/.test(raw)) continue;
    cur.code.push(raw.replace(/\s#\s.*$/, ''));
  }
  return out;
}

const firstIdx = (fn: Fn, re: RegExp): number => fn.code.findIndex((l) => re.test(l));
const callRe = (name: string): RegExp => new RegExp(`(^|[\\s;&|({!])${name}(\\s|;|$|\\))`);

describe('the census: every key ccd sends is behind the one check (D-8271)', () => {
  const fns = functions(ccdSource());
  const typers = [...fns.values()].filter((f) => f.code.some((l) => SENDS.test(l)));
  const checks = (f: Fn): boolean => f.code.slice(1).some((l) => callRe(CHECK).test(l));

  it('the check is defined exactly once and sends no key itself', () => {
    const src = ccdSource();
    expect(src.split('\n').filter((l) => new RegExp(`^${CHECK}\\(\\)\\s*\\{`).test(l))).toHaveLength(1);
    const f = fns.get(CHECK)!;
    expect(f.code.some((l) => SENDS.test(l)), 'the check presses no key').toBe(false);
    for (const reading of ['_pane_measurable', '#{pane_in_mode}', '_pane_box_read']) {
      expect(f.code.join('\n'), `the check reads ${reading}`).toContain(reading);
    }
  });

  it('finds the known typing functions (non-vacuous)', () => {
    const names = typers.map((f) => f.name);
    for (const k of [...KNOWN_TYPERS, ...CONTINUATIONS.filter((c) => c !== '_route_model_close')]) {
      expect(names, `${k} no longer sends a key — update this census`).toContain(k);
    }
  });

  it.each(KNOWN_TYPERS)('%s calls the check before its first key', (name) => {
    const f = fns.get(name)!;
    const check = firstIdx(f, callRe(CHECK));
    const key = firstIdx(f, SENDS);
    expect(check, `${name} never calls ${CHECK}`).toBeGreaterThan(0);
    expect(check, `${name} sends a key before ${CHECK}`).toBeLessThan(key);
    for (const c of CONTINUATIONS) {
      const call = firstIdx(f, callRe(c));
      if (call > 0) expect(check, `${name} calls ${c} before ${CHECK}`).toBeLessThan(call);
    }
  });

  it('every function that sends a key is checked or a continuation', () => {
    const bare = typers.filter((f) => !CONTINUATIONS.includes(f.name) && !checks(f)).map((f) => f.name);
    expect(bare, 'these send keys with no typing check').toEqual([]);
  });

  it.each(CONTINUATIONS)('%s is reached only from checked functions or other continuations', (name) => {
    const callers = [...fns.values()].filter((f) => f.name !== name && f.code.some((l) => callRe(name).test(l)));
    expect(callers.length, `${name} has no caller — drop it from CONTINUATIONS`).toBeGreaterThan(0);
    for (const c of callers) {
      expect(CONTINUATIONS.includes(c.name) || checks(c), `${c.name} reaches ${name} without the typing check`).toBe(true);
    }
  });

  it('no other ccd program sends a key', () => {
    const dir = path.dirname(CCD);
    const hits: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name === 'ccd') continue;
      const text = fs.readFileSync(path.join(dir, e.name), 'utf8');
      for (const l of text.split('\n')) {
        if (/^\s*(#|\/\/|\*)/.test(l)) continue;
        if (SENDS.test(l.replace(/\s#\s.*$/, ''))) hits.push(`${e.name}: ${l.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

// ── the check itself ────────────────────────────────────────────────────────

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-typecheck-'); });
afterEach(() => { h.cleanup(); });

/** A tmux that answers the three readings the check takes, recording every call. `$W` the active pane's width,
 *  `$MODE` its `#{pane_in_mode}`, `$BOX` the pane text; every key is recorded and never sent. */
const TMUX = `tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
  case "$1" in
    list-panes) case "$*" in *pane_active*) echo "1 \${W:-200}" ;; *) echo 4242 ;; esac ;;
    display-message) case "$*" in *pane_in_mode*) echo "\${MODE:-0}" ;; esac ;;
    capture-pane) printf '%s\\n' "\${BOX-}" ;;
  esac; return 0; };`;

const rc = (snippet: string, env: Record<string, string> = {}): number =>
  Number(h.sh(`${TMUX} sleep() { :; }; ${snippet}; echo "rc=$?"`, env).trim().split('\n').at(-1)!.replace('rc=', ''));
const log = (): string[] =>
  h.sh('cat "$REG/swap.log" 2>/dev/null; true').split('\n').filter((l) => l.includes('type-refused'));
const keys = (): string[] =>
  h.sh('cat "$HOME/ccd-calls" 2>/dev/null; true').split('\n').filter((l) => SENDS.test(l));

const EMPTY = boxed('');
const DRAFT = boxed('half a sentence the operator was typ');

describe(`${CHECK}: three refusals and a pass, each refusal on the log`, () => {
  it('passes a wide pane, out of any mode, with an empty box, and says nothing', () => {
    expect(rc(`${CHECK} demo compact`, { BOX: EMPTY })).toBe(0);
    expect(log()).toEqual([]);
  });

  it('passes a pane with no box at all (a dialog the caller means to answer)', () => {
    expect(rc(`${CHECK} demo spawn`, { BOX: '  Do you trust the files in this folder?\n  ❯ 1. Yes, I trust this folder\n    2. No, exit' })).toBe(0);
  });

  it('refuses a half-typed draft', () => {
    expect(rc(`${CHECK} demo compact`, { BOX: DRAFT })).toBe(1);
    expect(log()).toHaveLength(1);
    expect(log()[0]).toMatch(/ type-refused demo: draft at compact, /);
  });

  it('refuses a pane in copy-mode', () => {
    expect(rc(`${CHECK} demo route`, { BOX: EMPTY, MODE: '1' })).toBe(1);
    expect(log()).toHaveLength(1);
    expect(log()[0]).toMatch(/ type-refused demo: copy-mode at route, /);
  });

  it('refuses when tmux will not say whether the pane is in a mode', () => {
    const r = rc(`${TMUX.replace('display-message)', 'display-message) return 1 ;; nomatch)')} ${CHECK} demo route`, { BOX: EMPTY });
    expect(r).toBe(1);
    expect(log()[0]).toMatch(/ type-refused demo: copy-mode at route, /);
  });

  it(`refuses a pane under READER_MIN_COLS (${READER_MIN_COLS}) columns`, () => {
    expect(rc(`${CHECK} demo stale`, { BOX: EMPTY, W: String(READER_MIN_COLS - 1) }), 'narrow is its own rc, so the spawn loop can say 6').toBe(2);
    expect(log()).toHaveLength(1);
    expect(log()[0]).toMatch(new RegExp(` type-refused demo: narrow at stale, .*${READER_MIN_COLS} columns`));
    expect(rc(`${CHECK} demo stale`, { BOX: EMPTY, W: String(READER_MIN_COLS) }), 'exactly the floor reads').toBe(0);
  });

  it('the log line leads with a timestamp and names the session id and the reason', () => {
    rc(`${CHECK} demo-quiet-basin compact`, { BOX: DRAFT });
    expect(log()[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d type-refused demo-quiet-basin: draft at compact, the input box holds a half-typed draft$/);
  });

  it('`append` (the operator\'s own clip, which adds to the box and presses no Enter) still refuses copy-mode', () => {
    expect(rc(`${CHECK} demo clip append`, { BOX: DRAFT, W: '40' }), 'a draft and a narrow pane do not refuse an append').toBe(0);
    expect(rc(`${CHECK} demo clip append`, { BOX: EMPTY, MODE: '1' })).toBe(1);
    expect(log()[0]).toMatch(/ type-refused demo: copy-mode at clip, /);
  });

  it('reads the session\'s own pane, through _tmux_t', () => {
    rc(`${CHECK} demo compact`, { BOX: EMPTY });
    const calls = h.sh('cat "$HOME/ccd-calls"');
    expect(calls).toContain('display-message -p -t =cc-demo: #{pane_in_mode}');
    expect(calls).toContain('capture-pane -t =cc-demo: -p -e');
  });
});

describe(`${CHECK}: the log is floored per reason (D-2013's budget)`, () => {
  it('the same reason twice inside COMPACT_NOTE_FLOOR is one line; a new reason speaks at once', () => {
    rc(`${CHECK} demo compact; ${CHECK} demo route`, { BOX: EMPTY, MODE: '1' });
    expect(log()).toHaveLength(1);
    rc(`${CHECK} demo compact`, { BOX: DRAFT });
    expect(log()).toHaveLength(2);
    expect(log()[1]).toMatch(/ draft at compact, /);
  });

  it('a pass ends the episode, so the next refusal speaks again', () => {
    rc(`${CHECK} demo compact`, { BOX: EMPTY, MODE: '1' });
    rc(`${CHECK} demo compact`, { BOX: EMPTY });
    rc(`${CHECK} demo compact`, { BOX: EMPTY, MODE: '1' });
    expect(log()).toHaveLength(2);
  });

  it('a torn floor field is not evaluated', () => {
    h.sh(`_reg_set demo typerefuse 'copy-mode REG[$(touch "$HOME/PWNED-typerefuse")]'`);
    rc(`${CHECK} demo compact`, { BOX: EMPTY, MODE: '1' });
    expect(fs.existsSync(path.join(h.home, 'PWNED-typerefuse'))).toBe(false);
    expect(log()).toHaveLength(1);
  });
});

// ── the sites, driven through their own functions ──────────────────────────

describe('a refused check sends no key at the site', () => {
  it('_auto_stale_check: copy-mode refuses the Enter', () => {
    const stale = `${boxed('')}\n  Your usage limit has reset · press enter to continue`;
    rc(`_pane_limit_stale() { return 0; }; _pane_box_read() { echo empty; }; _auto_stale_check demo`, { BOX: stale, MODE: '1' });
    expect(keys()).toEqual([]);
    expect(log()[0]).toMatch(/ copy-mode at stale, /);
  });

  it('_route_type_model: refused, it answers 3 and types no `/model`', () => {
    expect(rc('_route_type_model demo opus claude', { BOX: EMPTY, MODE: '1' })).toBe(3);
    expect(keys()).toEqual([]);
  });

  it('_route_type_effort: refused, it answers 3 and types no `/effort`', () => {
    expect(rc('_route_type_effort demo high', { BOX: DRAFT })).toBe(3);
    expect(keys()).toEqual([]);
    expect(log()[0]).toMatch(/ draft at route, /);
  });

  it('the route typers journal their keystroke only once the check passed', () => {
    rc('_route_type_effort demo ultracode', { BOX: EMPTY, MODE: '1' });
    expect(h.reg('demo', 'typed') ?? '', 'a refusal journals nothing').not.toMatch(/ effort /);
    rc(`_pane_effort_switch_dialog() { return 1; }; _route_effort_ack_wait() { return 0; };
      _route_type_effort demo ultracode`, { BOX: EMPTY });
    expect(h.reg('demo', 'typed')).toMatch(/^\d+ effort ultracode$/m);
    for (const name of ['_route_type_effort', '_route_type_model']) {
      const f = functions(ccdSource()).get(name)!;
      const check = firstIdx(f, callRe(CHECK));
      const note = firstIdx(f, /_typed_note "\$id" (effort|model) /);
      expect(note, `${name} journals after the check`).toBeGreaterThan(check);
      expect(note, `${name} journals before its first key`).toBeLessThan(firstIdx(f, SENDS));
    }
  });

  it('_route_apply_now: a refused typer is not counted as an attempt', () => {
    rc(`_route_wanted() { echo "opus high"; }; _route_applied_get() { :; }; _typed_note() { :; };
      _route_apply_now demo`, { BOX: EMPTY, MODE: '1' });
    expect(h.reg('demo', 'routetries')).toBeNull();
    expect(keys()).toEqual([]);
  });

  it('_redrive_after_spawn: copy-mode refuses the resume prompt', () => {
    rc(`_transcript_path() { echo /dev/null; }; _transcript_stalled_pair() { return 0; };
      _pane_auto_continue_armed() { return 1; }; _pane_hard_blocked() { return 1; }; REDRIVE_WAIT_S=1;
      _redrive_after_spawn demo cc-demo 0`, { BOX: EMPTY, MODE: '1' });
    expect(keys()).toEqual([]);
    expect(log()[0]).toMatch(/ copy-mode at redrive, /);
  });

  it('_accept_first_run_prompts: copy-mode refuses the trust-folder answer, the spawn times out instead', () => {
    const trust = '  Do you trust the files in this folder?\n  ❯ 1. Yes, I trust this folder\n    2. No, exit';
    const r = rc('SPAWN_GATE_TRIES=3; _accept_first_run_prompts cc-demo 0', { BOX: trust, MODE: '1' });
    expect(r).not.toBe(0);
    expect(keys()).toEqual([]);
    expect(log()[0]).toMatch(/ copy-mode at spawn, /);
  });

  it('_accept_first_run_prompts: a dotted session id is logged and floored under itself, not its tmux name', () => {
    // `_tmux` maps '.' and ':' to '_' (tmux renames them), so `cc-foo_bar` is foo.bar's session. The check must
    // name foo.bar on swap.log and keep its floor in foo.bar's registry, never under an id that does not exist.
    const trust = '  Do you trust the files in this folder?\n  ❯ 1. Yes, I trust this folder\n    2. No, exit';
    rc('SPAWN_GATE_TRIES=2; _accept_first_run_prompts cc-foo_bar 0 foo.bar', { BOX: trust, MODE: '1' });
    expect(keys()).toEqual([]);
    expect(log()[0]).toMatch(/ type-refused foo\.bar: copy-mode at spawn, /);
    expect(h.reg('foo_bar', 'typerefuse'), 'no orphan floor under the tmux name').toBeNull();
    expect(h.reg('foo.bar', 'typerefuse')).toMatch(/^copy-mode \d+$/);
  });

  it('_spawn_settle hands its session id to the gate loop', () => {
    h.sh(`_accept_first_run_prompts() { echo "$*" > "$HOME/afrp-args"; return 0; }; tmux() { :; };
      _spawn_settle foo.bar 0; true`);
    expect(h.sh('cat "$HOME/afrp-args"').trim()).toBe('cc-foo_bar 0 foo.bar');
  });

  it('_accept_first_run_prompts: a pane that goes narrow after the first pass answers 6, not a timeout', () => {
    const trust = '  Do you trust the files in this folder?\n  ❯ 1. Yes, I trust this folder\n    2. No, exit';
    const r = rc(`_pane_measurable() { local n; n=$(cat "$HOME/pm" 2>/dev/null); echo "x$n" > "$HOME/pm"; [[ -z "$n" ]]; };
      SPAWN_GATE_TRIES=5; _accept_first_run_prompts cc-demo 0`, { BOX: trust });
    expect(r).toBe(6);
    expect(keys()).toEqual([]);
    expect(log()[0]).toMatch(/ type-refused demo: narrow at spawn, /);
  });

  it('_accept_first_run_prompts: out of copy-mode the same dialog is answered', () => {
    const trust = '  Do you trust the files in this folder?\n  ❯ 1. Yes, I trust this folder\n    2. No, exit';
    rc('SPAWN_GATE_TRIES=1; _accept_first_run_prompts cc-demo 0', { BOX: trust });
    expect(keys().length).toBeGreaterThan(0);
  });

  it('_auto_compact_check: copy-mode refuses `/compact` after every other gate passed', () => {
    rc(`_pane_for_keystroke() { KS_PANE="x"; return 0; }; _pane_ctx_pct() { echo 90; };
      _idle_for_keystroke() { return 0; }; _compact_no_turns() { return 1; };
      _auto_compact_check demo`, { BOX: EMPTY, MODE: '1' });
    expect(keys()).toEqual([]);
    expect(h.reg('demo', 'lastcompact'), 'a refused compaction is not stamped, so the next tick retries').toBeNull();
    expect(log()[0]).toMatch(/ copy-mode at compact, /);
  });

  it('cmd_clip: copy-mode refuses the path and says why', () => {
    const png = path.join(h.home, 'shot.png');
    fs.writeFileSync(png, 'x');
    const out = h.sh(`${TMUX} _alive() { return 0; };
      ( cmd_clip ${JSON.stringify(png)} demo ) 2>&1; true`, { MODE: '1', BOX: EMPTY });
    expect(out).toMatch(/copy-mode/);
    expect(keys()).toEqual([]);
  });

  it('cmd_clip: a draft in the box does not refuse it (the operator adds to their own text)', () => {
    const png = path.join(h.home, 'shot.png');
    fs.writeFileSync(png, 'x');
    h.sh(`${TMUX} _alive() { return 0; }; cmd_clip ${JSON.stringify(png)} demo >/dev/null; true`, { BOX: DRAFT });
    expect(keys()).toHaveLength(1);
  });
});
