// `_route_apply_check` — the supervise tick's half of the applier, and the
// settle's `routeapplied` stamp that keeps a fresh spawn from being re-typed.
//
// THE TICK IS NOT THE VERB. `ccd route --apply` runs once, in the operator's
// hands, and can afford to say "queued". The tick runs every 5 s on every LIVE
// session of a ~20-session fleet, so its first act is a registry comparison
// that returns before any tmux call; only a genuinely pending field reaches the
// pane. This file pins both halves — the cheap refusal AND the retry that
// eventually lands — plus the two structural facts nothing else can see: that
// the tick is wired into the supervise loop at all, and that the compactor's
// predicate was EXTRACTED rather than copied.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-tick-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const UUID = 'deadbeef-0000-4000-8000-000000000000';

const IDLE_PANE = '│ 🤖 Opus 5 · xhigh │ ▓ ctx ▁▁▁ 20% │\n❯ \n';
const MID_TURN_PANE = 'Working… (esc to interrupt)\n';
const ACK_EFFORT = (level: string): string => `${IDLE_PANE}Set effort level to ${level} (this session only): …\n`;

const TMUX_STUB = `tmux() {
  echo "tmux $*" >> "$HOME/tmux-calls"
  case "$1" in
    capture-pane) cat "$HOME/pane.txt" ;;
    list-panes)   echo 4242 ;;
    send-keys)    shift; while [[ "\${1:-}" == -t ]]; do shift 2; done; k="$*"; k="\${k#-l }"; k="\${k#/}"
                  [[ -f "$HOME/pane-after-$k.txt" ]] && cp "$HOME/pane-after-$k.txt" "$HOME/pane.txt" ;;
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
const plantIdle = (wrapper = 'claude'): void => {
  const dir = path.join(h.sh(`_cfg_dir ${wrapper}`).trim(), 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '4242.json'), JSON.stringify({ status: 'idle', statusUpdatedAt: Date.now() - 120_000 }));
};
/** `makeCcdHarness` plants a binary only for the roster's home-able ids; `gpt` — the test
 *  roster's non-Anthropic lane — needs its own (`ccd-route-degrade.test.ts`'s `install()`). */
const install = (w: string): void => {
  fs.writeFileSync(path.join(h.home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });
};

/** A ccd constant read OUT OF THE SOURCE rather than re-typed: these two decide how many
 *  real keystrokes a permanently-refused field costs, so a copy here would go on passing
 *  against a driver whose budget had been widened. Same source-slicing idiom this file
 *  already uses on `_auto_compact_check`'s body. */
const constOf = (name: string): string => {
  const m = new RegExp(`^${name}=([0-9]+)`, 'm').exec(fs.readFileSync(CCD, 'utf8'));
  if (!m) throw new Error(`ccd/ccd no longer defines ${name}= at column 0 — re-anchor this test`);
  return m[1]!;
};
const BACKOFF = constOf('ROUTE_RETRY_BACKOFF');
const MAX = Number(constOf('ROUTE_RETRY_MAX'));

describe('_route_apply_check: the pending field waits for an idle pane and then lands', () => {
  beforeEach(() => {
    seed(ID); plantIdle();
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} effort high; _reg_set ${ID} routeapplied "class=opus effort=xhigh"`);
  });

  it('a mid-turn pane is left alone — nothing typed, routeskip=mid-turn — and the SAME record lands once the pane is idle', () => {
    pane(MID_TURN_PANE);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toEqual([]);
    expect(h.reg(ID, 'routeskip')).toMatch(/^\d+ mid-turn$/);

    pane(IDLE_PANE); after('s', ACK_EFFORT('high'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toEqual(['-l /effort', 'Enter', 'Left', 'Left', 'Left', 'Left', 'Left', 'Left', 'Left', 'Right', 'Right', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('effort=high');
    expect(h.reg(ID, 'routeskip')).toBeNull();
  });

  it('nothing pending: the tick returns before any tmux call at all and clears a stale routeskip', () => {
    h.sh(`_reg_set ${ID} effort xhigh; _reg_set ${ID} routeskip "1 mid-turn"`);
    pane(MID_TURN_PANE);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(fs.existsSync(path.join(h.home, 'tmux-calls'))).toBe(false);
    expect(h.reg(ID, 'routeskip')).toBeNull();
  });
});

// Copied from ccd-route-spawn.test.ts (module-local there).
const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

describe('the settle stamps what it COMPOSED, so a fresh spawn is never re-typed', () => {
  it('_spawn_start writes routeapplied from the composed argv, and the very next tick types nothing', () => {
    seed(ID); plantIdle();
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} effort xhigh; _reg_set ${ID} subagent sonnet; _reg_set ${ID} workflow on`);
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=opus effort=xhigh subagent=sonnet workflow=on');

    pane(IDLE_PANE);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toEqual([]);
  });

  it('a session with NO record has its routeapplied removed — nothing was composed, so nothing is claimed', () => {
    seed(ID);
    h.sh(`_reg_set ${ID} routeapplied "class=opus effort=xhigh"`);
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(h.reg(ID, 'routeapplied')).toBeNull();
  });

  it('a NON-Anthropic lane: routeapplied carries the degraded class ALONE, beside inert=effort,workflow — and the next tick types nothing', () => {
    // CONTROLLER RULING S4-R9. `--effort` and `--settings` are composed only on the
    // Anthropic arm, but the stamp used to be written unconditionally — so a gpt-lane
    // spawn wrote `routeapplied effort=high` NEXT TO `inert=effort`, two records of the
    // same spawn contradicting each other. The docstring over that write says "WHAT IS
    // WRITTEN IS WHAT WAS COMPOSED"; this is what makes that true again. `_route_wanted`
    // skips the same fields, so an inert field is neither claimed applied nor typed.
    install('gpt');
    seed(ID, 'gpt'); plantIdle('gpt');
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} effort high; _reg_set ${ID} workflow on`);
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start ${ID} resume 2>/dev/null`);
    expect(h.reg(ID, 'inert')).toBe('effort,workflow');
    expect(h.reg(ID, 'routeapplied')).toBe('class=opus');   // the rung SERVED: fable is unservable by backend

    pane(IDLE_PANE);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toEqual([]);
  });
});

describe('structural: the tick is wired in, and the predicate was EXTRACTED rather than copied', () => {
  const src = (): string => fs.readFileSync(CCD, 'utf8');

  it("the supervise loop's live) arm runs the applier on the same line as the compactor", () => {
    expect(src()).toContain('_auto_compact_check "$id"; _route_apply_check "$id"');
  });

  it('_auto_compact_check calls both halves of the predicate and captures no pane of its own', () => {
    const all = src().split('\n');
    const start = all.findIndex((l) => l.startsWith('_auto_compact_check() {'));
    expect(start, 'ccd/ccd no longer defines _auto_compact_check() at column 0 — re-anchor this test').toBeGreaterThanOrEqual(0);
    const end = all.findIndex((l, i) => i > start && l === '}');
    expect(end).toBeGreaterThan(start);
    // Comments are stripped: the body DISCUSSES the pipeline it no longer owns, and a scan that
    // read those words would answer "still inline" about a function that calls out for it.
    const body = all.slice(start + 1, end).filter((l) => !l.trim().startsWith('#'));
    expect(body.join('\n')).toContain('_pane_for_keystroke "$id"');
    expect(body.join('\n')).toContain('_idle_for_keystroke "$id"');
    expect(body.filter((l) => l.includes('tmux capture-pane')),
      'the compactor re-grew a capture of its own — the predicate is extracted, not copied').toEqual([]);
  });
});

describe('a record that PREDATES the applier is SEEDED, never typed on sight (controller ruling S4-R8)', () => {
  beforeEach(() => { seed(ID); plantIdle(); pane(IDLE_PANE); });

  it('(a) a record with no class and no effort is NOTHING PENDING — no keystroke, ever', () => {
    // AN ABSENT FIELD IS NOT `default`/`auto`. `_route_wanted` used to answer `default` for
    // an absent `class`, so a live session carrying one settle-applied field and nothing
    // else got `/model` + Enter + `s` on its very first tick — overriding a model a human
    // had picked by hand, on a record that never mentioned a class.
    //
    // Both spellings of the ruling's example are here: `compact=off`, which
    // `_route_valid`'s compact arm REFUSES (that field's vocabulary is a 10–100
    // percentage, so this is what a torn or hand-edited field looks like), and
    // `compact=80`, which it admits. Neither may reach the picker, and for the same reason.
    //
    // AND WITH AND WITHOUT A `routeapplied` FILE, which is not belt and braces: the seeding
    // gate below would ALSO answer "types nothing" on the no-file half, so that half alone
    // is green against a `_route_wanted` that has gone back to answering `default` for an
    // absent class. The half that already carries a stamp is the one that measures the
    // absence rule, and the `class=` assertion is what catches a seed inventing one.
    for (const v of ['off', '80']) {
      for (const stamped of [false, true]) {
        h.sh(`_reg_set ${ID} compact ${v}`);
        if (stamped) h.sh(`_reg_set ${ID} routeapplied "compact=${v}"`);
        h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
        expect(keys(), `compact=${v}, stamped=${stamped}`).toEqual([]);
        expect(h.reg(ID, 'routeapplied') ?? '', `compact=${v}, stamped=${stamped}`).not.toContain('class=');
      }
    }
  });

  it('(b) a full record with NO routeapplied file: the file appears with the SERVED words, one swap.log line, and no tmux call at all', () => {
    // Every routing record on this fleet was applied by its last settle's argv — that is
    // what `_spawn_start` composes — but nothing WROTE that down until slice 4. So the
    // first tick to meet such a record states what the pane is already running and types
    // nothing. The words are `_route_wanted`'s, not the record's raw fields: the class
    // SERVED (`degraded` wins), the effort past the haiku filter.
    h.sh(`_reg_set ${ID} class fable; _reg_set ${ID} degraded opus; _reg_set ${ID} effort xhigh;`
      + ` _reg_set ${ID} subagent sonnet; _reg_set ${ID} workflow on`);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=opus effort=xhigh subagent=sonnet workflow=on');
    expect(fs.existsSync(path.join(h.home, 'tmux-calls')),
      'the seeding tick reached tmux — a record that predates the applier must be written down, not typed').toBe(false);
    expect(swapLog()).toMatch(
      new RegExp(`routeapplied-seeded ${ID}: class=opus effort=xhigh subagent=sonnet workflow=on \\(record predates the applier\\)`));
  });

  it('(c) the seed is not a suppression: a DIVERGENT write after it is pending, and lands at the next idle tick', () => {
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} effort xhigh`);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toBe('class=opus effort=xhigh');
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high`);   // the coordinator's form: no --apply
    expect(keys()).toEqual([]);
    after('s', ACK_EFFORT('high'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toEqual(['-l /effort', 'Enter', 'Left', 'Left', 'Left', 'Left', 'Left', 'Left', 'Left', 'Right', 'Right', '-l s']);
    expect(h.reg(ID, 'routeapplied')).toContain('effort=high');
  });

  it('the tick WRITES NOTHING while it decides: a haiku+level record leaves no routenotepair and no route-refuse line', () => {
    // CONTROLLER RULING S4-R9. `_route_apply_pending`'s "REGISTRY READS ONLY" was not true:
    // it reached `_route_effort_for`, whose haiku+level arm writes a `route-refuse` line
    // and a floor marker. That is a WRITE on the 5-second tick of every live session, and
    // it burns the field's own note floor so the next real spawn stays silent about the
    // same bad pairing. The gate now reads through `_route_effort_for … quiet`.
    h.sh(`_reg_set ${ID} class haiku; _reg_set ${ID} effort high; _reg_set ${ID} routeapplied "class=haiku"`);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routenotepair')).toBeNull();
    expect(swapLog()).not.toContain('route-refuse');
    expect(keys()).toEqual([]);
  });
});

describe('the bounded retry: a field the PANE refuses is tried ROUTE_RETRY_MAX times, ROUTE_RETRY_BACKOFF apart (ruling S4-R7)', () => {
  // THE DEFECT THIS BOUNDS. `_route_note`'s floor makes a standing refusal QUIET; it does
  // not make it cheap. `/effort ultracode` on a lane launched `{"enableWorkflows":false}`
  // is refused verbatim by Claude Code, and `class=fable` on a lane whose picker lists no
  // Fable row can never be acknowledged — and before this, either one re-entered the
  // applier every 5 s and typed a whole key sequence into a LIVE pane twelve times a
  // minute, for ever, silently after the first note. The pane here never shows an ack.
  beforeEach(() => {
    seed(ID); plantIdle(); pane(IDLE_PANE);
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} effort high; _reg_set ${ID} routeapplied "class=opus effort=xhigh"`);
  });
  const age = (n: number): void => { h.sh(`_reg_set ${ID} routetries "${n} $(( $(date +%s) - ${BACKOFF} ))"`); };

  it('(a) an unacknowledged apply and three ticks inside the backoff type ONE sequence in total', () => {
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    const one = keys().length;
    expect(one).toBeGreaterThan(0);
    expect(h.reg(ID, 'routetries')).toMatch(/^1 \d+$/);
    for (let i = 0; i < 3; i++) h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toHaveLength(one);
  });

  it('(b) past ROUTE_RETRY_BACKOFF the same record is attempted a second time', () => {
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    const one = keys().length;
    age(1);   // the counter's epoch is the only input, so the clock is moved rather than waited on
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toHaveLength(one * 2);
    expect(h.reg(ID, 'routetries')).toMatch(/^2 \d+$/);
  });

  it('(c) at ROUTE_RETRY_MAX the applier gives up IN ITS OWN WORDS and types nothing more', () => {
    age(MAX);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toEqual([]);
    expect(h.reg(ID, 'routeskip')).toMatch(/^\d+ apply-gave-up$/);
    expect(swapLog()).toMatch(new RegExp(`route-skip ${ID}: apply-gave-up \\(effort=high after ${MAX} attempts\\)`));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toEqual([]);
  });

  it('(d) a cmd_route write clears the counter — the operator asked for something, so the budget resets', () => {
    age(MAX);
    h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=high`);   // no --apply: the record alone
    expect(h.reg(ID, 'routetries')).toBeNull();
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()[0]).toBe('-l /effort');
  });

  it('(e) a mid-turn refusal is NOT an attempt — the idle predicate never spends the budget', () => {
    // The transient conditions (mid-turn, drafting, an occupied box, a session sitting out
    // a usage limit) type nothing at all, so counting them would exhaust the budget on a
    // session that was merely busy and then refuse to apply a perfectly good record.
    pane(MID_TURN_PANE);
    for (let i = 0; i < 5; i++) h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()).toEqual([]);
    expect(h.reg(ID, 'routetries')).toBeNull();
    expect(h.reg(ID, 'routeskip')).toMatch(/mid-turn/);
    pane(IDLE_PANE); after('s', ACK_EFFORT('high'));
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(h.reg(ID, 'routeapplied')).toContain('effort=high');
  });
});

/** `cmd_supervise` as a bounded PROGRAM — `ccd-substrate.test.ts`'s idiom, because the loop
 *  under test is a `while :` and spawnSync's own timeout is what turns a loop that stops
 *  exiting into one failed case instead of a hung suite. */
const runSupervise = (snippet: string): { code: number; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  });
  return { code: r.status ?? 1, stderr: r.stderr ?? '' };
};

/** A FAKE CLOCK, because what is under test is ELAPSED REAL TIME and a suite may not spend
 *  it. `date +%s` answers from a file, `sleep` advances it by the seconds it was asked to
 *  sleep, and a tick helper advances it by the seconds it pretends to spend typing. */
const CLOCK = `printf 1000 > "$HOME/now"
  date() { if [[ "\${1:-}" == +%s ]]; then cat "$HOME/now"; else command date "$@"; fi; }
  _advance() { printf '%s' "$(( $(cat "$HOME/now") + $1 ))" > "$HOME/now"; }
  sleep() { _advance "\${1:-0}"; }`;

describe('the supervise heartbeat counts the seconds the applier actually spends', () => {
  it('four live ticks whose applier spends 20s each stamp TWICE — five assumed seconds a tick stamps not at all', () => {
    // THE DEFECT THIS PINS. `_route_apply_check` types the slider one key at a time with a
    // `sleep 1` between keystrokes and then polls `ROUTE_ACK_WAIT` seconds for the
    // acknowledgement, so a live tick that applies a record costs ~20 real seconds, not the
    // 5 the loop sleeps. Against `beat=$((beat + tick))` six such ticks are 120-150 REAL
    // seconds between stamps — at or past `_session_state`'s 120-second freshness window,
    // so a healthy session reads `unsupervised` on the fleet board while its supervisor is
    // moving a slider. Measured on the mutant (`beat=$((beat + tick))` restored): ONE stamp,
    // the entry one, and no loop stamp at all in the 100 fake seconds this run covers.
    //
    // The counter answers the PRE-FLIGHT probe first (n=1), so n<=5 is four live ticks.
    // Each accrues 20 spent + the 5 it is about to sleep = 25, and the beat stamps at 30:
    // ticks 2 and 4. Entry stamp + 2 = 3.
    seed(ID);
    const r = runSupervise(`${CLOCK}
      systemctl() { :; }; cmd_ensure() { :; }; _sync_uuid() { :; }; _auto_stale_check() { :; }
      _auto_swap_check() { :; }; _auto_compact_check() { :; }
      _route_apply_check() { _advance 20; }
      n=0; _session_probe() { n=$((n+1)); PROBE_DETAIL=""
        if (( n <= 5 )); then PROBE_VERDICT=live; else PROBE_VERDICT=gone; fi; }
      _reg_set() { printf '%s' "$3" > "$REG/$1.$2"; echo "stamp $2" >> "$HOME/ccd-calls"; }
      cmd_supervise ${ID}`);
    // THAT `_reg_set` REPLACED THE REAL ONE for the run above: a RECORDING stub, the
    // `stamp <field>` log being the only thing this test reads. It is byte-equivalent to
    // the shipped writer and NOT mechanism-equivalent (the old truncating redirect, no tmp,
    // no rename) — the caveat `ccd-session-state.test.ts` states at length beside the same
    // stub. Any `h.reg(...)` in this case would measure the STUB's bytes; none does.
    expect(r.stderr).toContain('ended; exiting for systemd restart');   // the loop's own exit, not spawnSync's kill
    expect(h.calls().filter((l) => l === 'stamp supervised')).toHaveLength(3);
  });
});

describe('the compactor and the applier share a pane, and only one of them types per tick (final review finding 5)', () => {
  // THE COLLISION. The supervise loop's live) arm runs
  // `_auto_compact_check "$id"; _route_apply_check "$id"` on ONE line (pinned
  // above). The compactor ends by sending `/compact` + Enter and signals
  // nothing; the applier then re-asks the idle predicate, whose whole answer is
  // a pane capture and a `sessions/<pid>.json` read — neither of which has
  // moved yet — and types `/model` on top of a compaction. The interlock is
  // `lastcompact`, which `_auto_compact_check` writes immediately BEFORE its
  // send-keys, so it also holds between processes: `ccd route --apply` is the
  // operator's process, not the supervisor's.
  const QUIET = Number(constOf('ROUTE_COMPACT_QUIET'));
  const HOT_PANE = '│ 🤖 Opus 5 · xhigh │ ▓ ctx ▁▁▁ 95% │\n❯ \n';

  beforeEach(() => {
    seed(ID); plantIdle();
    h.sh(`_reg_set ${ID} class opus; _reg_set ${ID} effort high; _reg_set ${ID} routeapplied "class=opus effort=xhigh"`);
  });

  it('ONE tick, both conditions: /compact is typed and the applier declines with its own word', () => {
    pane(HOT_PANE);
    h.sh(`${TMUX_STUB} _auto_compact_check ${ID}; _route_apply_check ${ID}`);
    expect(keys(), 'the applier typed into a pane the compactor had just typed into').toEqual(['-l /compact', 'Enter']);
    expect(h.reg(ID, 'routeskip')).toMatch(/^\d+ compacting$/);
    expect(swapLog()).toMatch(new RegExp(`route-skip ${ID}: compacting`));
    // The refusal is a NOTE, never an attempt (ruling S4-R7): nothing was typed
    // and the condition clears itself, so the retry budget must not be spent.
    expect(h.reg(ID, 'routetries')).toBeNull();
  });

  it('once the quiet window has passed the SAME record lands', () => {
    pane(IDLE_PANE); after('s', ACK_EFFORT('high'));
    h.sh(`_reg_set ${ID} lastcompact "$(( $(date +%s) - ${QUIET} ))"`);
    h.sh(`${TMUX_STUB} _route_apply_check ${ID}`);
    expect(keys()[0]).toBe('-l /effort');
    expect(h.reg(ID, 'routeapplied')).toContain('effort=high');
  });

  it('the VERB declines too — the operator\'s own process cannot see the supervisor\'s keystroke either', () => {
    pane(IDLE_PANE);
    h.sh(`_reg_set ${ID} lastcompact "$(date +%s)"`);
    const out = h.sh(`${TMUX_STUB} cmd_route --session ${ID} --set effort=max --apply`);
    expect(out).toContain(`queued ${ID}`);
    expect(keys()).toEqual([]);
    expect(h.reg(ID, 'routeskip')).toMatch(/^\d+ compacting$/);
  });
});
