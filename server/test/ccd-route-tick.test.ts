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
const seed = (id: string, wrapper = 'claude'): void => {
  h.sh(`_reg_set ${id} wrapper ${wrapper}
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid ${UUID}`);
};
const plantIdle = (): void => {
  const dir = path.join(h.sh('_cfg_dir claude').trim(), 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '4242.json'), JSON.stringify({ status: 'idle', statusUpdatedAt: Date.now() - 120_000 }));
};

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
