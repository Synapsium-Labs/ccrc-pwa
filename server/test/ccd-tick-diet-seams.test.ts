// The tick diet's SEAMS suite (#387, tick-diet spec §6.2): the behaviour rows
// that are NOT differential — a clock seam's stub sensitivity, a memo's scope.
// Each row drives the REAL `cmd_supervise` loop the way `ccd-route-tick.test.ts`
// and `ccd-substrate.test.ts` do, under a fake clock that stubs `date` as a
// FUNCTION (the idiom eleven suites use), and asserts the seam under test was
// the path the loop took.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-tick-diet-seams-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const UUID = 'deadbeef-0000-4000-8000-000000000000';

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
 *  sleep, and a tick helper advances it by the seconds it pretends to spend typing.
 *  This is `ccd-route-tick.test.ts`'s CLOCK idiom verbatim — the eleven suites that stub
 *  `date` as a function all use this shape, and `_now_s_to` must honour the function stub
 *  even when `EPOCHSECONDS` is set (D-4961, tick-diet spec §6.2). */
const CLOCK = `printf 1000 > "$HOME/now"
  date() { if [[ "\${1:-}" == +%s ]]; then cat "$HOME/now"; else command date "$@"; fi; }
  _advance() { printf '%s' "$(( $(cat "$HOME/now") + $1 ))" > "$HOME/now"; }
  sleep() { _advance "\${1:-0}"; }`;

const seed = (id: string): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid ${UUID}`);
};

describe('D-4961 the clock seam: the loop\'s `t0` and `spent` come from the `date` stub, not `EPOCHSECONDS` (tick-diet spec §6.2)', () => {
  // THE SEAM. `_now_s_to` prefers `$EPOCHSECONDS` (no fork) when the shell has it AND `date`
  //  is not a FUNCTION. Eleven test suites stub `date` as a function to fake the clock, and
  //  `printf '%(%s)T'` would bypass them all. The `! declare -F date >/dev/null` guard makes
  //  `_now_s_to` call the stub instead. Without it, the loop's `t0` and `spent` read
  //  `$EPOCHSECONDS` (the real epoch, e.g. 1.7 billion) and the beat never reaches 30 in the
  //  fake clock's 100-second window — one stamp (the entry one), not three.
  it('four live ticks whose applier spends 20s each stamp TWICE — the `date` function stub drives the loop, not `$EPOCHSECONDS`', () => {
    seed(ID);
    const r = runSupervise(`${CLOCK}
      systemctl() { :; }; cmd_ensure() { :; }; _sync_uuid() { :; }; _auto_stale_check() { :; }
      _auto_swap_check() { :; }; _auto_compact_check() { :; }
      _route_apply_check() { _advance 20; }
      n=0; _session_probe() { n=$((n+1)); PROBE_DETAIL=""
        if (( n <= 5 )); then PROBE_VERDICT=live; else PROBE_VERDICT=gone; fi; }
      _reg_set() { printf '%s' "$3" > "$REG/$1.$2"; echo "stamp $2" >> "$HOME/ccd-calls"; }
      cmd_supervise ${ID}`);
    expect(r.stderr).toContain('ended; exiting for systemd restart');
    // The counter answers the PRE-FLIGHT probe first (n=1), so n<=5 is four live ticks.
    // Each accrues 20 spent + the 5 it is about to sleep = 25, and the beat stamps at 30:
    // ticks 2 and 4. Entry stamp + 2 = 3.
    expect(h.calls().filter((l) => l === 'stamp supervised')).toHaveLength(3);
  });

  it('the `date` stub is honoured even when `EPOCHSECONDS` is explicitly exported to a wrong value', () => {
    // If the guard `! declare -F date >/dev/null` is dropped, `_now_s_to` would take the
    //  `$EPOCHSECONDS` fast path and the fake clock's `date` function would never be called.
    //  Exporting `EPOCHSECONDS=999999` makes the wrongness measurable: the beat would start
    //  at 999999 and never stamp inside the 100-fake-second window.
    seed(ID);
    const r = runSupervise(`export EPOCHSECONDS=999999
      ${CLOCK}
      systemctl() { :; }; cmd_ensure() { :; }; _sync_uuid() { :; }; _auto_stale_check() { :; }
      _auto_swap_check() { :; }; _auto_compact_check() { :; }
      _route_apply_check() { _advance 20; }
      n=0; _session_probe() { n=$((n+1)); PROBE_DETAIL=""
        if (( n <= 5 )); then PROBE_VERDICT=live; else PROBE_VERDICT=gone; fi; }
      _reg_set() { printf '%s' "$3" > "$REG/$1.$2"; echo "stamp $2" >> "$HOME/ccd-calls"; }
      cmd_supervise ${ID}`);
    expect(r.stderr).toContain('ended; exiting for systemd restart');
    expect(h.calls().filter((l) => l === 'stamp supervised')).toHaveLength(3);
  });
});
