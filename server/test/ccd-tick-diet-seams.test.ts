// THE TICK DIET'S SEAMS (tick-diet spec §6.2, #387; plan Task 3). The budget
// suite (`ccd-tick-budget.test.ts`) says what a tick COSTS; these rows say
// WHERE each W1 change sits in `cmd_supervise`, which a count cannot. A prime
// that ran inside the loop, a tick context `cmd_ensure` could see, one a child
// process inherited, or a `tmux` function stub hidden behind `timeout`'s exec
// would each leave the count unchanged or lower, and each is a defect.
//
// D-4960, TWO HALVES. `_plat_timeout` caches whether `timeout -k` works in
// `_CCD_TIMEOUT_K`, but `_session_probe` calls it inside `out=$( )`, so on
// `main` the cache died with that subshell and every tick re-ran the probe.
// The supervisor now primes it once in its own shell, after the pre-flight's
// `cmd_ensure` and before the loop, when a `timeout` or `gtimeout` is on PATH
// (rows a). And `_session_probe`'s `$(type -t tmux)` becomes `declare -F
// tmux`, which forks nothing and must still send a `tmux` FUNCTION down the
// direct branch (row e).
//
// THE TICK CONTEXT (spec §6.2). `local CCD_TICK_CTX=1`, set just before
// `while :`, dynamically scoped like `CCD_IN_UNIT`, never exported: the tick
// helpers see it (row c), `cmd_ensure` does not (row b), and nothing the tick
// forks and execs does (row d). Nothing reads it until W4.
//
// THE MUTATION ROWS (plan Task 3), each measured on the working tree:
//   delete the pre-loop prime's `if`           -> rows (a), and the budget's kprobe row
//   drop its `command -v` condition            -> row (a), the no-timeout half
//   `declare -F tmux` -> `false`                -> row (e)
//   `local CCD_TICK_CTX=1` -> `export …`        -> row (d)
//   the `local` moved above the pre-flight     -> row (b)
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import {
  TICK_RUN_N, plantFixture, plantShims, countTicks, supervisePrelude, type TickCount,
} from './tickBudgetHarness.js';

const ID = 'claude-a-tick';
const N = TICK_RUN_N;
const LOOP_EXIT = 'ended; exiting for systemd restart';

/** Removed from every environment this file hands a process: the tmux variables,
 *  so nothing reaches a server outside a fixture, and `CCD_TICK_CTX`, so row
 *  (d)'s child can only see one the supervisor exported. */
const CLEAN_ENV = { TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: undefined, CCD_TICK_CTX: undefined };

const harnesses: CcdHarness[] = [];
afterAll(() => { for (const h of harnesses) h.cleanup(); });
const harness = (): CcdHarness => {
  const h = makeCcdHarness('ccrc-ccd-tick-seams-');
  harnesses.push(h);
  return h;
};

/** `source ccd; <snippet>` under the harness HOME, contained, with `front`
 *  (when given) ahead of the contained PATH. */
const run = (home: string, snippet: string, front?: string): SpawnSyncReturns<string> => {
  const env = ghContainedEnv(home, { ...process.env, ...CLEAN_ENV, HOME: home }, { systemd: true, tmux: true });
  if (front !== undefined) env['PATH'] = `${front}:${env['PATH'] ?? ''}`;
  return spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], { encoding: 'utf8', cwd: home, timeout: 60000, env });
};

const lines = (file: string): string[] =>
  (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split('\n').filter(Boolean);

/** A `timeout` that logs its argv to `$HOME/seam-timeout`, drops `-k N` and the
 *  duration, and execs the rest: `_plat_timeout`'s `-k` probe then prints its
 *  bytes, and the cache reads `yes` on every platform. */
const plantTimeout = (home: string): string => {
  const dir = path.join(home, 'seam-bin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'timeout'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/seam-timeout"\n'
    + '[ "$1" = -k ] && shift 2\nshift\nexec "$@"\n', { mode: 0o755 });
  return dir;
};

/** A PATH holding neither `timeout` nor `gtimeout`: links to the externals this
 *  file's stubbed supervisor runs, and nothing else. */
const NO_TIMEOUT_PATH = `__nt="$HOME/no-timeout-bin"; mkdir -p "$__nt"
  for __c in bash date head mv rm tail tr wc; do __p=$(command -v "$__c") && ln -s "$__p" "$__nt/$__c"; done
  PATH=$__nt`;

/** The real loop with every pre-loop and tick helper stubbed to write what it
 *  sees to `$HOME/seam-log`, in order. `_plat_timeout` is WRAPPED, not
 *  replaced: it logs its argv and runs the real body, so the cache the tick
 *  reads is the one the real call left. The pre-flight probe answers live, so
 *  `cmd_ensure` runs; tick 1 answers live; the next probe is the loop's own
 *  `gone` exit. */
const stubbedSupervise = (noTimeout: boolean): string => `
  __src=$(declare -f _plat_timeout); eval "__real_plat_timeout\${__src#_plat_timeout}"
  _plat_timeout() { printf 'plat_timeout %s\\n' "$*" >> "$HOME/seam-log"; __real_plat_timeout "$@"; }
  _svc_enable() { :; }; _reg_set() { :; }; sleep() { :; }
  cmd_ensure() { printf 'ensure %s\\n' "\${CCD_TICK_CTX:-unset}" >> "$HOME/seam-log"; }
  __n=0; _session_probe() { __n=$((__n + 1)); PROBE_DETAIL=; PROBE_SUBSTRATE=present
    if (( __n <= 2 )); then PROBE_VERDICT=live; else PROBE_VERDICT=gone; fi; }
  _sync_uuid() { printf 'sync %s\\n' "\${CCD_TICK_CTX:-unset}" >> "$HOME/seam-log"; }
  _auto_stale_check() { printf 'cache %s\\n' "\${_CCD_TIMEOUT_K:-unset}" >> "$HOME/seam-log"
    bash -c 'printf "child %s\\n" "\${CCD_TICK_CTX:-unset}"' >> "$HOME/seam-log"; }
  _auto_swap_check() { :; }; _auto_compact_check() { :; }; _route_apply_check() { :; }
  ${noTimeout ? NO_TIMEOUT_PATH : ''}
  cmd_supervise ${ID}`;

interface Stubbed { log: string[]; timeoutArgv: string[]; status: number | null; stderr: string }
const stubbedRuns = new Map<boolean, Stubbed>();
/** One stubbed run per PATH shape, shared by every row that reads it. */
const stubbed = (noTimeout: boolean): Stubbed => {
  let s = stubbedRuns.get(noTimeout);
  if (!s) {
    const h = harness();
    const r = run(h.home, stubbedSupervise(noTimeout), noTimeout ? undefined : plantTimeout(h.home));
    s = {
      log: lines(path.join(h.home, 'seam-log')), timeoutArgv: lines(path.join(h.home, 'seam-timeout')),
      status: r.status, stderr: r.stderr ?? '',
    };
    stubbedRuns.set(noTimeout, s);
  }
  // NON-VACUITY: the loop's own exit, after a tick that ran its helpers.
  expect(s.stderr, `the run did not end through the loop: ${s.stderr.slice(-400)}`).toContain(LOOP_EXIT);
  expect(s.status).toBe(1);
  expect(s.log.filter((l) => l.startsWith('sync ')), 'tick 1 never reached its helpers').toHaveLength(1);
  return s;
};

let budget: TickCount[] | undefined;
/** `idle-home` through the budget runner: the real loop, real helpers, N ticks. */
const budgetRun = (): TickCount[] => {
  if (!budget) {
    const h = harness();
    plantFixture(h.home, ID, 'idle-home');
    const r = run(h.home, `${supervisePrelude()}cmd_supervise ${ID}`, plantShims(h.home));
    expect(r.stderr, `the budget run did not end through the loop: ${(r.stderr ?? '').slice(-400)}`)
      .toContain(LOOP_EXIT);
    budget = countTicks(h.home, r.pid);
  }
  return budget;
};

describe('the `-k` cache is primed once, in the supervisor\'s own shell (D-4960, tick-diet spec §6.2)', () => {
  it(`(a) a ${N}-tick budget run probes \`-k\` in no tick; the pre-loop probes twice, the prime's being the one that survives`, () => {
    const counts = budgetRun();
    expect(counts, 'the pre-loop and ticks 1..N').toHaveLength(N + 1);
    expect(counts.slice(1).map((t) => t.kprobe), 'a tick re-ran the `-k` probe: the cache did not survive')
      .toEqual(Array(N).fill(0));
    // The pre-flight's `_session_probe` still probes inside its own `out=$( )`,
    // whose cache dies with it; the prime's probe is the second, and the only
    // one the loop inherits.
    expect(counts[0]!.kprobe, 'the pre-loop: the pre-flight\'s probe, then the prime').toBe(2);
  }, 120_000);

  it('(a) with a `timeout` on PATH the pre-loop calls `_plat_timeout 5 true` once, after `cmd_ensure`, and the tick finds the cache decided', () => {
    const s = stubbed(false);
    expect(s.log.filter((l) => l.startsWith('plat_timeout ')), 'the prime').toEqual(['plat_timeout 5 true']);
    expect(s.log.indexOf('plat_timeout 5 true'), 'the prime runs after the pre-flight\'s `cmd_ensure`')
      .toBeGreaterThan(s.log.indexOf('ensure unset'));
    expect(s.log.indexOf('plat_timeout 5 true'), 'the prime runs before the loop')
      .toBeLessThan(s.log.findIndex((l) => l.startsWith('sync ')));
    expect(s.log, 'a tick helper reads the cache the prime set in this shell').toContain('cache yes');
    expect(s.timeoutArgv.filter((a) => a === '-k 1 1 printf ccd-k-ok'), 'the `-k` probe ran once').toHaveLength(1);
  }, 120_000);

  it('(a) with neither `timeout` nor `gtimeout` on PATH there is no prime, and the tick finds the cache undecided', () => {
    const s = stubbed(true);
    expect(s.log.filter((l) => l.startsWith('plat_timeout ')), 'a prime with no timeout to probe').toEqual([]);
    expect(s.log).toContain('cache unset');
  }, 120_000);

  it('(e) `_session_probe` calls a `tmux` FUNCTION directly: one `has-session`, and no `timeout` exec', () => {
    const h = harness();
    const r = run(h.home, `tmux() { printf '%s\\n' "$*" >> "$HOME/seam-tmux-fn"; }
      _session_probe ${ID}; printf '%s' "$PROBE_VERDICT"`, plantTimeout(h.home));
    expect(r.status, r.stderr ?? '').toBe(0);
    expect(lines(path.join(h.home, 'seam-tmux-fn')), 'the function stub, called directly')
      .toEqual([`has-session -t =cc-${ID}:`]);
    expect(lines(path.join(h.home, 'seam-timeout')), 'the probe went through `timeout`, which cannot see a function')
      .toEqual([]);
    expect(r.stdout).toBe('live');
  }, 120_000);
});

describe('the tick context: dynamically scoped, after the pre-flight, never exported (tick-diet spec §6.2)', () => {
  it('(b) `cmd_ensure` never sees `CCD_TICK_CTX`', () => {
    expect(stubbed(false).log.filter((l) => l.startsWith('ensure '))).toEqual(['ensure unset']);
  }, 120_000);

  it('(c) a tick helper (`_sync_uuid`) sees `CCD_TICK_CTX=1`', () => {
    expect(stubbed(false).log.filter((l) => l.startsWith('sync '))).toEqual(['sync 1']);
    expect(stubbed(true).log.filter((l) => l.startsWith('sync ')), 'with no timeout on PATH too').toEqual(['sync 1']);
  }, 120_000);

  it('(d) a child `bash -c` run from a tick helper does not: the variable is never exported', () => {
    expect(stubbed(false).log.filter((l) => l.startsWith('child '))).toEqual(['child unset']);
  }, 120_000);
});
