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
// EACH HALF OF THE PRIME'S GUARD HAS ITS OWN ROW. `_plat_timeout` tries
// `timeout`, then `gtimeout` (Homebrew's coreutils installs it g-prefixed), so
// the guard is `command -v timeout || command -v gtimeout`. A row run on a
// host's PATH cannot pin either half: a macOS runner with coreutils has both
// names, and losing one half there still primes through the other. So each
// stubbed run gets a PATH of links to the externals it needs plus the logging
// shim under ONE name (or none), and asserts which names that PATH resolves
// before it asserts anything else.
//
// THE MUTATION ROWS (plan Task 3), each measured on the working tree:
//   delete the pre-loop prime's `if`           -> rows (a), and the budget's kprobe row
//   drop its `command -v` condition            -> row (a), no timeout on PATH
//   drop `|| command -v gtimeout`               -> row (a), gtimeout only
//   keep only `command -v gtimeout`             -> row (a), timeout only
//     (the budget-run row (a) and the budget's kprobe row run on the host's
//     PATH: measured GREEN under this mutation on macOS with Homebrew's
//     coreutils, which has `gtimeout`; the timeout-only row is the pin there)
//   `declare -F tmux` -> `false`                -> row (e)
//   `local CCD_TICK_CTX=1` -> `export …`        -> row (d)
//   the `local` moved above the pre-flight     -> row (b)
//
// TASK 10 MUTATION ROWS (D-4962, tick-diet spec §6.3): `_share_pct_to`'s memo
// lives and dies with one `_swap_target` call. Each row is measured on the
// working tree:
//   delete `; local CCD_SHARE_MEMO_ON=1; local -A CCD_SHARE_MEMO=()` from
//     `_swap_target`, and add a global memo at top level               -> seam (b)
//   drop the `CCD_SHARE_MEMO_ON` test from `_share_pct_to`              -> seam (c)
//   delete the `_swap_target` memo line and add nothing                 -> seam (a)
//   store the value with rc 0 in the memo                               -> seam (d)
//   drop ` && -n "$2"` from the store line's condition                 -> seam (e)
//   drop ` && -n "$2"` from the lookup condition only                  -> seam (e)
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

/** The names `_plat_timeout` looks a deadline binary up by, in its order. */
type TimeoutName = 'timeout' | 'gtimeout';

/** A `timeout` (or `gtimeout`) that logs its name and argv to
 *  `$HOME/seam-timeout`, drops `-k N` and the duration, and execs the rest:
 *  `_plat_timeout`'s `-k` probe then prints its bytes, and the cache reads `yes`
 *  on every platform. */
const writeTimeoutShim = (dir: string, name: TimeoutName): void => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), '#!/bin/sh\nprintf \'%s %s\\n\' "${0##*/}" "$*" >> "$HOME/seam-timeout"\n'
    + '[ "$1" = -k ] && shift 2\nshift\nexec "$@"\n', { mode: 0o755 });
};
const plantTimeout = (home: string): string => {
  const dir = path.join(home, 'seam-bin');
  writeTimeoutShim(dir, 'timeout');
  return dir;
};

/** A stubbed run's PATH: the logging shim under one of `_plat_timeout`'s names,
 *  or under none. */
type PathShape = TimeoutName | 'none';
const SHAPES: readonly PathShape[] = ['timeout', 'gtimeout', 'none'];
/** The PATH a stubbed run gets: `$HOME/seam-path`, holding links to the
 *  externals the stubbed supervisor runs (`printf` and `true` are what the
 *  shim execs for the probe and the prime; `type -P`, because `command -v`
 *  answers a builtin's bare name) and, from the node side, the shape's shim.
 *  Neither of the host's own deadline binaries is on it. */
const SEAM_PATH = `__nt="$HOME/seam-path"; mkdir -p "$__nt"
  for __c in bash date head mv printf rm tail tr true wc; do __p=$(type -P "$__c") && ln -s "$__p" "$__nt/$__c"; done
  PATH=$__nt
  for __b in timeout gtimeout; do command -v "$__b" >/dev/null 2>&1 && printf 'on-path %s\\n' "$__b" >> "$HOME/seam-log"; done`;

/** The real loop with every pre-loop and tick helper stubbed to write what it
 *  sees to `$HOME/seam-log`, in order. `_plat_timeout` is WRAPPED, not
 *  replaced: it logs its argv and runs the real body, so the cache the tick
 *  reads is the one the real call left. The pre-flight probe answers live, so
 *  `cmd_ensure` runs; tick 1 answers live; the next probe is the loop's own
 *  `gone` exit. */
const stubbedSupervise = (): string => `
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
  ${SEAM_PATH}
  cmd_supervise ${ID}`;

interface Stubbed { log: string[]; timeoutArgv: string[]; status: number | null; stderr: string }
const stubbedRuns = new Map<PathShape, Stubbed>();
/** One stubbed run per PATH shape, shared by every row that reads it. */
const stubbed = (shape: PathShape): Stubbed => {
  let s = stubbedRuns.get(shape);
  if (!s) {
    const h = harness();
    if (shape !== 'none') writeTimeoutShim(path.join(h.home, 'seam-path'), shape);
    const r = run(h.home, stubbedSupervise());
    s = {
      log: lines(path.join(h.home, 'seam-log')), timeoutArgv: lines(path.join(h.home, 'seam-timeout')),
      status: r.status, stderr: r.stderr ?? '',
    };
    stubbedRuns.set(shape, s);
  }
  // NON-VACUITY: the PATH holds exactly the shape's deadline binary, so the
  // guard's other half cannot answer for it; and the loop's own exit, after a
  // tick that ran its helpers.
  expect(s.log.filter((l) => l.startsWith('on-path ')), 'the deadline binaries this run\'s PATH resolves')
    .toEqual(shape === 'none' ? [] : [`on-path ${shape}`]);
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

  // One row per half of the guard: on a PATH with only that name, deleting the
  // half leaves the guard false, and the row reds on every host.
  for (const bin of ['timeout', 'gtimeout'] as const) {
    it(`(a) with only \`${bin}\` on PATH the pre-loop calls \`_plat_timeout 5 true\` once, after \`cmd_ensure\`, and the tick finds the cache decided`, () => {
      const s = stubbed(bin);
      expect(s.log.filter((l) => l.startsWith('plat_timeout ')), 'the prime').toEqual(['plat_timeout 5 true']);
      expect(s.log.indexOf('plat_timeout 5 true'), 'the prime runs after the pre-flight\'s `cmd_ensure`')
        .toBeGreaterThan(s.log.indexOf('ensure unset'));
      expect(s.log.indexOf('plat_timeout 5 true'), 'the prime runs before the loop')
        .toBeLessThan(s.log.findIndex((l) => l.startsWith('sync ')));
      expect(s.log, 'a tick helper reads the cache the prime set in this shell').toContain('cache yes');
      expect(s.timeoutArgv.filter((a) => a === `${bin} -k 1 1 printf ccd-k-ok`), `the \`-k\` probe ran once, through \`${bin}\``)
        .toHaveLength(1);
    }, 120_000);
  }

  it('(a) with neither `timeout` nor `gtimeout` on PATH there is no prime, and the tick finds the cache undecided', () => {
    const s = stubbed('none');
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
    expect(stubbed('timeout').log.filter((l) => l.startsWith('ensure '))).toEqual(['ensure unset']);
  }, 120_000);

  it('(c) a tick helper (`_sync_uuid`) sees `CCD_TICK_CTX=1`', () => {
    for (const shape of SHAPES) {
      expect(stubbed(shape).log.filter((l) => l.startsWith('sync ')), `PATH shape ${shape}`).toEqual(['sync 1']);
    }
  }, 120_000);

  it('(d) a child `bash -c` run from a tick helper does not: the variable is never exported', () => {
    expect(stubbed('timeout').log.filter((l) => l.startsWith('child '))).toEqual(['child unset']);
  }, 120_000);
});

describe('`_share_pct`\'s memo lives and dies with one `_swap_target` call (D-4962, tick-diet spec §6.3, plan Task 10)', () => {
  const ID = 'claude-a-tick';
  const python3Counter = [
    'python3() {',
    '  printf \'%s\\n\' "$3" >> "$HOME/seam-py"',
    '  command python3 "$@"',
    '}',
  ].join('\n');
  const wrapServiceable = [
    '__src=$(declare -f _serviceable)',
    'eval "__real_serviceable${__src#_serviceable}"',
    '_serviceable() {',
    '  printf \'%s %s\\n\' "$1" "${2-}" >> "$HOME/seam-svc"',
    '  __real_serviceable "$@"',
    '}',
  ].join('\n');

  it('(a) one `_swap_target` call reads each wrapper\'s share at most once, and `_serviceable` asks about home more than once', () => {
    const h = harness();
    plantFixture(h.home, ID, 'fable-leaving');
    const snippet = [
      python3Counter,
      wrapServiceable,
      `_swap_target "${ID}" claude-b claude-a "" 0 > "$HOME/ans1"`,
      'echo "rc=$?" >> "$HOME/ans1"',
    ].join('\n');
    const r = run(h.home, snippet);
    expect(r.status, r.stderr ?? '').toBe(0);
    const svc = lines(path.join(h.home, 'seam-svc'));
    const py = lines(path.join(h.home, 'seam-py'));
    expect(svc.filter((l) => l === 'claude-a fable').length, 'non-vacuity: home was not asked about twice').toBeGreaterThanOrEqual(2);
    expect(py, 'each wrapper was read at most once').toEqual([...new Set(py)]);
    expect(py).toContain('claude-a');
    const ans = lines(path.join(h.home, 'ans1'));
    expect(ans, 'the answer was empty or rc was wrong').toHaveLength(2);
    expect(ans[1]).toBe('rc=0');
    expect(ans[0]).not.toBe('claude-a');
    expect(ans[0]).not.toBe('claude-b');
  }, 120_000);

  it('(b) two `_swap_target` calls in one shell read the sweep anew after it is rewritten', () => {
    const h = harness();
    plantFixture(h.home, ID, 'fable-leaving');
    const snippet = [
      python3Counter,
      `_swap_target "${ID}" claude-b claude-a "" 0 > "$HOME/ans1"`,
      'echo "rc=$?" >> "$HOME/ans1"',
      `command python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); d["perAccount"]["claude-a"]["fableShare"]["estimate"]=0.12; json.dump(d, open(sys.argv[1],"w"))' "$REG/usage/sweep/latest.json"`,
      `_swap_target "${ID}" claude-b claude-a "" 0 > "$HOME/ans2"`,
      'echo "rc=$?" >> "$HOME/ans2"',
    ].join('\n');
    const r = run(h.home, snippet);
    expect(r.status, r.stderr ?? '').toBe(0);
    const ans1 = lines(path.join(h.home, 'ans1'));
    const ans2 = lines(path.join(h.home, 'ans2'));
    expect(ans1[1]).toBe('rc=0');
    expect(ans2[1]).toBe('rc=0');
    expect(ans1[0]).not.toBe('claude-a');
    expect(ans1[0]).not.toBe('claude-b');
    expect(ans2[0]).toBe('claude-a');
    expect(ans1[0]).not.toBe(ans2[0]);
    const py = lines(path.join(h.home, 'seam-py'));
    expect(py.filter((l) => l === 'claude-a').length).toBe(2);
  }, 120_000);

  it('(c) outside `_swap_target`, two `_serviceable` calls and two `_class_gate` calls each run `python3` twice', () => {
    const h = harness();
    plantFixture(h.home, ID, 'fable-leaving');
    const snippet = [
      python3Counter,
      `{ _serviceable claude-a fable; __r=$?; echo; echo "rc=$__r"; } > "$HOME/s1"`,
      `{ _serviceable claude-a fable; __r=$?; echo; echo "rc=$__r"; } > "$HOME/s2"`,
      `{ _class_gate claude-a fable; __r=$?; echo; echo "rc=$__r"; } > "$HOME/s3"`,
      `{ _class_gate claude-a fable; __r=$?; echo; echo "rc=$__r"; } > "$HOME/s4"`,
    ].join('\n');
    const r = run(h.home, snippet);
    expect(r.status, r.stderr ?? '').toBe(0);
    for (const f of ['s1', 's2']) {
      const got = lines(path.join(h.home, f));
      expect(got).toEqual(['50', 'rc=1']);
    }
    for (const f of ['s3', 's4']) {
      const got = lines(path.join(h.home, f));
      expect(got).toEqual(['rc=1']);
    }
    const py = lines(path.join(h.home, 'seam-py'));
    expect(py.filter((l) => l === 'claude-a').length).toBe(4);
  }, 120_000);

  const rcCases: { name: string; setup: string; stub?: string; want: string; rc: number }[] = [
    { name: 'stale sweep', setup: `command python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); d["finishedAt"]="2020-01-01T00:00:00Z"; json.dump(d, open(sys.argv[1],"w"))' "$REG/usage/sweep/latest.json"`, want: 'stale', rc: 2 },
    { name: 'python3 rc 127', setup: '', stub: 'python3() { printf \'%s\\n\' "$3" >> "$HOME/seam-py"; return 127; }', want: 'no-figure', rc: 2 },
    { name: 'python3 rc 126', setup: '', stub: 'python3() { printf \'%s\\n\' "$3" >> "$HOME/seam-py"; return 126; }', want: 'no-figure', rc: 2 },
    { name: 'python3 rc 137', setup: '', stub: 'python3() { printf \'%s\\n\' "$3" >> "$HOME/seam-py"; return 137; }', want: 'no-figure', rc: 2 },
    { name: 'fresh 0.5 sweep', setup: '', want: '50', rc: 1 },
  ];
  it.each(rcCases)('(d) the memo carries rc $rc through a repeat: $name', ({ setup, stub, want, rc }) => {
    const h = harness();
    plantFixture(h.home, ID, 'fable-leaving');
    // The setup runs BEFORE the counter, so a stale sweep's rewrite is not counted.
    const snippet = [
      setup,
      stub ?? python3Counter,
      '__memo_scope() { local CCD_SHARE_MEMO_ON=1; local -A CCD_SHARE_MEMO=(); { _serviceable claude-a fable; __r=$?; echo; echo "rc=$__r"; } > "$HOME/d1"; { _serviceable claude-a fable; __r=$?; echo; echo "rc=$__r"; } > "$HOME/d2"; }',
      '__memo_scope',
    ].join('\n');
    const r = run(h.home, snippet);
    expect(r.status, r.stderr ?? '').toBe(0);
    const d1 = lines(path.join(h.home, 'd1'));
    const d2 = lines(path.join(h.home, 'd2'));
    expect(d1).toEqual([want, `rc=${rc}`]);
    expect(d2).toEqual([want, `rc=${rc}`]);
    // NON-VACUITY: the second answer came from the memo, so the reader ran once.
    expect(lines(path.join(h.home, 'seam-py')), 'the repeat was not served from the memo').toEqual(['claude-a']);
  }, 120_000);

  it('(e) the empty-wrapper departure (D-5042): the shell survives and both calls run', () => {
    const h = harness();
    const snippet = [
      '__memo_scope() { local CCD_SHARE_MEMO_ON=1; local -A CCD_SHARE_MEMO=(); _share_pct_to v ""; echo "rc=$? v=[$v]"; _share_pct_to v ""; echo "rc=$? v=[$v]"; echo survived; }',
      '__memo_scope',
    ].join('\n');
    const r = run(h.home, snippet);
    expect(r.status, r.stderr ?? '').toBe(0);
    expect((r.stdout ?? '').split('\n').filter(Boolean)).toEqual(['rc=1 v=[]', 'rc=1 v=[]', 'survived']);
    expect(r.stderr ?? '').not.toContain('bad array subscript');
  }, 120_000);
});
