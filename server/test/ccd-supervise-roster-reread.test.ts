// A RUNNING `ccd supervise` PICKS UP A NEW OR REMOVED LANE (D-7717).
//
// `accounts.sh` is sourced once at ccd's module top level, and a supervisor
// lives for weeks. Once per loop, at the boundary (before the probe and before
// any tick helper), `_roster_reread_check` compares the file's bytes with the
// bytes this process sourced. On a change it validates the new bytes in a
// subshell that unsets every generated name first, and only then unsets those
// names here and evaluates the same bytes. A refused file keeps the old roster
// and warns once per content. No unit is restarted and no pane is touched.
//
// THE LOOP IS THE REAL ONE. Only its collaborators are stubbed: the probe
// answers `live` for N ticks and then `gone` (the loop's one exit), the tick
// helpers are quiet except `_auto_swap_check`, which records what the roster
// says at the moment rotation would ask, and `sleep` is where the test rewrites
// `accounts.sh` (between two loops, which is when an operator's `ccrc account`
// write lands). Every roster file the test writes ends in one line that logs
// `src <BASH_SUBSHELL>` to an event file whenever it is evaluated: `src 0` is
// this shell (startup or a re-source), `src 1` is the validating subshell.
//
// The snippet and the ccd path ride the ENVIRONMENT, never a `bash -c` string
// built from a path (the harness's own `sh` idiom, D-5259).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ccdSource, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { DEFAULT_TEST_ROSTER } from './helpers/roster.js';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-roster-reread-'); });
afterEach(() => { h.cleanup(); });

const ID = 'claude-demo';
const LOG_LINE = `printf 'src %s\\n' "$BASH_SUBSHELL" >> "$HOME/roster-events"\n`;

type Roster = typeof DEFAULT_TEST_ROSTER;
const NEW_LANE = {
  id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a',
  exec: { kind: 'generated' }, homeAble: true, hue: 'green', telemetry: 'anthropic',
} as const;
const withNewLane = (): Roster => ({ ...DEFAULT_TEST_ROSTER, accounts: [...DEFAULT_TEST_ROSTER.accounts, NEW_LANE] } as unknown as Roster);
const withoutLaneB = (): Roster => ({ ...DEFAULT_TEST_ROSTER, accounts: DEFAULT_TEST_ROSTER.accounts.filter((a) => a.id !== 'claude-b') });
const gen = (r: Roster): string => generateAccountsSh(parseRoster(r));

const rosterPath = (): string => path.join(h.home, '.ccrc', 'accounts.sh');
/** The startup roster: the default one, with the event line. */
const plantStartup = (): void => { fs.writeFileSync(rosterPath(), gen(DEFAULT_TEST_ROSTER) + LOG_LINE); };
/** The file the `sleep` stub copies over accounts.sh after loop `n`. */
const stageNext = (n: number, text: string): void => { fs.writeFileSync(path.join(h.home, `next-${n}.sh`), text); };

/** `cmd_supervise` for `ticks` live loops, then `gone`. Bounded by spawnSync's
 *  own timeout, so a loop that stops exiting is one failed case, not a hung suite. */
const supervise = (ticks: number): { code: number | null; stderr: string } => {
  const snippet = `
    _i=0; _n=0
    _session_probe() {
      _i=$((_i+1)); echo probe >> "$HOME/roster-events"
      if (( _i <= ${ticks} + 1 )); then PROBE_VERDICT=live; else PROBE_VERDICT=gone; fi
      PROBE_DETAIL=""; PROBE_SUBSTRATE=""
    }
    sleep() {
      _n=$((_n+1)); echo sleep >> "$HOME/roster-events"
      if [[ -e "$HOME/next-$_n.sh" ]]; then cp "$HOME/next-$_n.sh" "$HOME/.ccrc/accounts.sh"; fi
      if [[ -e "$HOME/rm-$_n" ]]; then rm -f "$HOME/.ccrc/accounts.sh"; fi
    }
    systemctl() { echo "systemctl $*" >> "$HOME/mgr-calls"; }
    launchctl() { echo "launchctl $*" >> "$HOME/mgr-calls"; }
    tmux() { echo "tmux $*" >> "$HOME/mgr-calls"; }
    _svc_enable() { :; }; cmd_ensure() { :; }; _end_note_gone() { :; }
    _sync_uuid() { :; }; _auto_stale_check() { :; }; _auto_compact_check() { :; }; _route_apply_check() { :; }
    _auto_swap_check() {
      local cnew="" cb="" vnew=0 hnew=0 vb=0 hb=0
      _cfg_dir_to cnew lane-a; _cfg_dir_to cb claude-b
      _is_valid_wrapper lane-a && vnew=1; _is_home_able lane-a && hnew=1
      _is_valid_wrapper claude-b && vb=1; _is_home_able claude-b && hb=1
      echo "swap accounts=\${CCRC_ACCOUNTS[*]-UNSET} new=$vnew$hnew:\${cnew#"$HOME/"} b=$vb$hb:\${cb#"$HOME/"}" >> "$HOME/roster-events"
      if [[ -e "$HOME/ask-measured" ]]; then
        if declare -p CCRC_MEASURED >/dev/null 2>&1; then echo "measured set" >> "$HOME/roster-events"; else echo "measured unset" >> "$HOME/roster-events"; fi
      fi
    }
    cmd_supervise ${ID}`;
  // The harness's own environment, re-contained here so the census in
  // ccd-workspaces.test.ts reads every poison at this call site.
  const env = ghContainedEnv(h.home, { ...h.env(), CCD_HARNESS_SRC: CCD, CCD_HARNESS_SNIPPET: snippet },
    { systemd: true, tmux: true, net: true });
  const r = spawnSync('bash', ['-c', 'ccd_h_src=$CCD_HARNESS_SRC ccd_h_snippet=$CCD_HARNESS_SNIPPET; '
    + 'unset CCD_HARNESS_SRC CCD_HARNESS_SNIPPET; source "$ccd_h_src"; eval "$ccd_h_snippet"'], {
    encoding: 'utf8', cwd: h.home, timeout: 30000, env,
  });
  return { code: r.status, stderr: r.stderr ?? '' };
};

const events = (): string[] => {
  const p = path.join(h.home, 'roster-events');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
const swaps = (): string[] => events().filter((e) => e.startsWith('swap '));
const mgrCalls = (): string[] => {
  const p = path.join(h.home, 'mgr-calls');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

const OLD = 'swap accounts=claude claude-a claude-b gpt claude-d new=00: b=11:.claude-b';
const NEW = 'swap accounts=claude claude-a claude-b gpt claude-d lane-a new=11:.lane-a b=11:.claude-b';
const B_GONE = 'swap accounts=claude claude-a gpt claude-d new=00: b=00:';

describe('ccd supervise re-reads accounts.sh at the loop boundary (D-7717)', () => {
  beforeEach(() => { plantStartup(); });

  it('a changed accounts.sh is re-sourced on the next loop, and the new lane is placeable', () => {
    stageNext(1, gen(withNewLane()) + LOG_LINE);
    const r = supervise(3);
    expect(r.code).toBe(1);   // the loop's own `gone` exit
    // The whole order, so "on the next loop, at its boundary" is measured and not
    // inferred: the validating subshell, then this shell, then that loop's probe.
    expect(events()).toEqual([
      'src 0',                                  // ccd's startup source
      'probe',                                  // the pre-flight probe
      'probe', OLD, 'sleep',                    // loop 1; the file is rewritten in its sleep
      'src 1', 'src 0', 'probe', NEW, 'sleep',  // loop 2: validated, applied, THEN probed
      'probe', NEW, 'sleep',                    // loop 3: unchanged, not re-sourced
      'probe',                                  // gone
    ]);
    expect(r.stderr).toContain(`ccd: ${ID}: account roster re-read — lanes now: claude claude-a claude-b gpt claude-d lane-a`);
  });

  it('a removed lane is no longer placeable on the next loop, and its memoised config dir is dropped', () => {
    stageNext(1, gen(withoutLaneB()) + LOG_LINE);
    supervise(2);
    expect(swaps()).toEqual([OLD, B_GONE]);
  });

  it('an unchanged file is not re-sourced, even when it is rewritten with the same bytes', () => {
    stageNext(1, gen(DEFAULT_TEST_ROSTER) + LOG_LINE);   // same content, new mtime
    supervise(3);
    expect(events().filter((e) => e.startsWith('src '))).toEqual(['src 0']);
    expect(swaps()).toEqual([OLD, OLD, OLD]);
  });

  it('a malformed file keeps the old roster and warns once; a later good file is applied', () => {
    // The lane it would add is real, so a re-source of it would show: the
    // syntax error comes AFTER every definition.
    stageNext(1, gen(withNewLane()) + LOG_LINE + 'fi\n');
    stageNext(3, gen(withNewLane()) + LOG_LINE);
    const r = supervise(4);
    expect(swaps()).toEqual([OLD, OLD, OLD, NEW]);
    expect(r.stderr.split('\n').filter((l) => l.includes('changed and is refused'))).toHaveLength(1);
    expect(events().filter((e) => e === 'src 0')).toEqual(['src 0', 'src 0']);   // startup, then the good file only
  });

  it('a file that sources cleanly but defines no CCRC_ACCOUNTS keeps the old roster and warns', () => {
    const text = gen(withNewLane()).replace(/^CCRC_ACCOUNTS=.*\n/m, '');
    expect(text).not.toMatch(/^CCRC_ACCOUNTS=/m);
    stageNext(1, text + LOG_LINE);
    const r = supervise(2);
    expect(swaps()).toEqual([OLD, OLD]);
    expect(r.stderr).toContain(`ccd: warn: ${ID}: account roster`);
    expect(r.stderr).toContain('keeping the roster this supervisor holds (claude claude-a claude-b gpt claude-d)');
  });

  it('a file whose CCRC_ACCOUNTS is a function-local `declare` keeps the old roster', () => {
    // Evaluated one function deep, `declare -a` makes a LOCAL that is gone on
    // return. The validation runs at the same depth, so it sees the same loss.
    const text = gen(withNewLane()).replace(/^CCRC_ACCOUNTS=/m, 'declare -a CCRC_ACCOUNTS=');
    stageNext(1, text + LOG_LINE);
    supervise(2);
    expect(swaps()).toEqual([OLD, OLD]);
  });

  it('a file that disappears keeps the old roster and warns once', () => {
    fs.writeFileSync(path.join(h.home, 'rm-1'), '');
    const r = supervise(3);
    expect(swaps()).toEqual([OLD, OLD, OLD]);
    expect(r.stderr.split('\n').filter((l) => l.includes('changed and is refused'))).toHaveLength(1);
  });

  it('a name the new file no longer defines does not survive from the old roster', () => {
    // "UNSET IS NOT EMPTY": an accounts.sh from before CCRC_MEASURED existed
    // leaves the name unset, which ccd reads as "every lane measured". The old
    // array must not stand in for it after the re-read.
    fs.writeFileSync(path.join(h.home, 'ask-measured'), '');
    const text = gen(withNewLane()).replace(/^CCRC_MEASURED=.*\n/m, '');
    expect(text).not.toMatch(/^CCRC_MEASURED=/m);
    stageNext(1, text + LOG_LINE);
    supervise(2);
    expect(events().filter((e) => e.startsWith('measured ') || e.startsWith('swap ')))
      .toEqual([OLD, 'measured set', NEW, 'measured unset']);
  });

  it('the loop calls no systemctl, no launchctl and no tmux, across a re-read', () => {
    stageNext(1, gen(withNewLane()) + LOG_LINE);
    stageNext(2, gen(withoutLaneB()) + LOG_LINE);
    supervise(3);
    expect(swaps()[1]).toBe(NEW);   // the re-read really happened
    expect(mgrCalls()).toEqual([]);
    expect(h.systemctlCalls()).toEqual([]);
    expect(h.tmuxCalls()).toEqual([]);
  });
});

describe('the names a re-read unsets are the names the generator writes (D-7717)', () => {
  it('`_CCD_ROSTER_VARS` and `_CCD_ROSTER_FNS` equal accounts.sh\'s variables and functions', () => {
    const src = ccdSource();
    const list = (name: string): string[] => {
      const m = new RegExp(`^${name}=\\(([^)]*)\\)`, 'm').exec(src);
      expect(m, `${name} is defined in ccd/ccd`).not.toBeNull();
      return m![1]!.trim().split(/\s+/).sort();
    };
    const text = gen(withNewLane());
    const vars = [...text.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]!).sort();
    const fns = [...text.matchAll(/^([a-z_][a-z0-9_]*)\(\)\s*\{/gm)].map((m) => m[1]!).sort();
    expect(vars.length).toBeGreaterThan(0);
    expect(fns.length).toBeGreaterThan(0);
    expect(list('_CCD_ROSTER_VARS')).toEqual(vars);
    expect(list('_CCD_ROSTER_FNS')).toEqual(fns);
  });
});
