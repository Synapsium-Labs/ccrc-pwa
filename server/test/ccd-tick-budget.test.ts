// THE SUPERVISE TICK'S FORK BUDGET (tick-diet spec §9 and goal 2, #387; plan
// Task 1). Every `claude-session@<id>` unit runs `ccd supervise <id>`, which
// loops every 5 s, and what a tick costs is the processes it creates, not the
// deciding: 179 forks and 85 execs on an idle tick, measured under `strace -f`
// in a container replay. This is the ratchet that goes red when a fork comes
// back.
//
// IT RUNS THE REAL LOOP. `cmd_supervise` runs under ccd's own `set -uo
// pipefail`, with only the pre-loop's `cmd_ensure` and `_svc_enable` stubbed,
// and the session leaves through the loop's own `gone` exit after N ticks.
// Real-executable shims on PATH answer tmux, `timeout`, `date` and `sleep`, and
// count every other external the tick runs; the counting rules and their
// residuals are in `tickBudgetHarness.ts`'s header. The figure is therefore a
// RATCHET and not the strace figure, and a PR that moves it states both.
//
// THE ASSERTIONS ARE EXACT (plan P6). A change that adds a fork reds, and so
// does one that removes a fork, until `TICK_BUDGET` holds the measured figure
// and the PR's departure restates it. `≤` would let an improvement go
// unrecorded. The budget moves wave by wave, so each wave's PR is green on its
// own tree and red against the tree before it: `main` at `300aedf8` was the
// first calibration, W1 lowers it (D-4960, measured below; D-4961), W2
// (D-4962) and W3 (D-4963) lower it again.
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';
import {
  FIXTURES, TICK_RUN_N, plantFixture, plantShims, countTicks, loopSleeps, commandWords, unshimmedExternals,
  supervisePrelude, fixtureScreenFile, type FixtureName, type ShimOpts, type TickCount,
} from './tickBudgetHarness.js';

/** Forks and execs per steady tick (ticks 2..N), per fixture. DECLARED ONCE.
 *  First calibrated on `main` at `300aedf8` (macOS, bash 5.3; Linux, bash 5.2:
 *  the same figures). W1 lowered it in three measured steps, each on its own
 *  branch and then RE-MEASURED TOGETHER at the merge (macOS, bash 5.3 only; the
 *  Linux figures for this tree are not yet measured):
 *    Task 3, D-4960 (the `-k` prime, `declare -F tmux`): -3 forks / -1 exec on every fixture.
 *    Task 4, D-4961 (the clock seam, 7 helper + 3 loop sites): -3..-23 forks, the same execs.
 *    Task 5 (`_cfg_dir_to`, an exact memo): -1 fork on the two leaving fixtures.
 *  The merged figures below are the dump of this suite on the merged tree, never
 *  a sum of the three. Lowered only by a change that measures the new figure and
 *  states it in its PR's departure.
 *
 *  RAISED BY #189 (the forked-session continued-in chain): +4 forks / +1 exec on EVERY fixture,
 *  measured on the merged tree. ON THESE FIXTURES that is not the walk's quiescence stat, which
 *  they never reach: no fixture plants a `workdir` field, so `_ci_bg_follow` (D-4945) costs
 *  nothing and `_follow_continued_in` (D-4935) stops before its stat. The four forks are
 *  `_follow_continued_in`'s per-tick `uuid` re-read (`$(_reg_get …)`: a subshell and `cat`, 2
 *  forks and the 1 exec) and a FAILING `$(_ci_addrs …)` for a row with no workdir (a subshell and
 *  its own `$(_reg_get … workdir)`, 2 forks, no exec; a failure is not memoized, so it repeats
 *  every tick). #189's real steady cost on a row WITH a workdir — the uuid re-read plus the
 *  size/mtime `stat` pair on a quiescent transcript — is NOT YET COUNTED by this harness (no
 *  fixture plants a workdir, and `stat` is not a passthrough shim); counting and trimming it is
 *  the tick-diet spec's stage 2(c) (§7.2). A deliberate feature cost, stated rather than hidden.
 *
 *  LOWERED BY W2 Task 8 (D-4962, `_limit_json_num`'s fast core; macOS, bash 5.3): each limits parse
 *  keeps its `$( )` until Task 9 but loses its `grep|head|grep`, 3 forks and 3 execs, so every
 *  fixture falls by 3 x its parses per steady tick, forks and execs together. Before -> after:
 *    idle-home 167/73 -> 140/46 (9 parses) · busy 164/72 -> 137/45 (9) · narrow 75/28 (none) ·
 *    away-over-ceiling 193/91 -> 148/46 (15) · hard-blocked 406/218 -> 244/56 (54) ·
 *    cooldown 97/36 (none) · fable 156/65 -> 138/47 (6) · leaving 391/224 -> 223/56 (56) ·
 *    fable-leaving 375/211 -> 225/61 (50).
 *
 *  LOWERED BY W2 Task 10 (D-4962, `_share_pct_to`'s memo; macOS, bash 5.3): `_share_pct` runs
 *  python3 once per distinct wrapper inside one `_swap_target` call. The `fable-leaving` fixture
 *  reads home's share twice (stay gate, then the candidate loop), so one python3 invocation is
 *  removed: -2 forks / -1 exec on that fixture only. Before -> after:
 *    idle-home 140/46 -> 140/46 · busy 137/45 -> 137/45 · narrow 75/28 -> 75/28 ·
 *    away-over-ceiling 148/46 -> 148/46 · hard-blocked 244/56 -> 244/56 ·
 *    cooldown 97/36 -> 97/36 · fable 138/47 -> 138/47 · leaving 223/56 -> 223/56 ·
 *    fable-leaving 225/61 -> 223/60.
 *
 *  LOWERED BY W2 Task 9 (D-4962, `_limit_field_to` and its three callers; macOS, bash 5.3; measured on top of
 *  Task 10): on the domain each `_limit_field` call loses its own `$( )` and its three `$(_limit_json_num …)`
 *  captures, 4 forks and no exec, so every fixture falls by 4 x its `_limit_field` calls per steady tick, its
 *  execs unchanged. Before -> after:
 *    idle-home 140/46 -> 128/46 (3 calls) · busy 137/45 -> 125/45 (3) · narrow 75/28 (none) ·
 *    away-over-ceiling 148/46 -> 128/46 (5) · hard-blocked 244/56 -> 172/56 (18) · cooldown 97/36 (none) ·
 *    fable 138/47 -> 130/47 (2) · leaving 223/56 -> 151/56 (18) · fable-leaving 223/60 -> 159/60 (16).
 *
 *  RE-MEASURED AT W2 CLOSE (Task 11) on the merged tree, Tasks 8, 10 and 9 together: macOS, bash 5.3, and Linux,
 *  bash 5.2 with GNU grep 3.8, print the same table, ticks 1-4 included. The figures below are that dump, never
 *  the sum of the three blocks above (which agree with it). W2 against W1 + #189, forks/execs per steady tick:
 *    idle-home 167/73 -> 128/46 · busy 164/72 -> 125/45 · narrow 75/28 (=) · away-over-ceiling 193/91 -> 128/46 ·
 *    hard-blocked 406/218 -> 172/56 · cooldown 97/36 (=) · fable 156/65 -> 130/47 · leaving 391/224 -> 151/56 ·
 *    fable-leaving 375/211 -> 159/60.
 *
 *  LOWERED BY W3 Task 13 (D-4963, `_reg_get` and `_reg_read` read through `_file_read_to`; macOS, bash 5.3): every
 *  registry read that finds its field loses its `cat`. A `$(_reg_get …)` loses 1 fork and 1 exec, the `cat` its
 *  subshell forked. A `$(_reg_read …)` loses 2 forks and 1 exec: its inner `v=$(cat -- "$f" 2>/dev/null)` carries a
 *  redirection, which keeps bash from exec'ing `cat` in the substitution's own child, so it was two processes
 *  (measured on bash 5.3 with a logging `cat`, xtrace off). So execs fall by the reads that found a field, and forks by
 *  those plus the `_reg_read` reads among them (4 on most fixtures, 6 on hard-blocked, 3 on cooldown, none on
 *  narrow). The plan's model was about -15 `cat` execs per tick [I]; measured -11 to -19. Before -> after:
 *    idle-home 128/46 -> 111/33 · busy 125/45 -> 109/33 · narrow 75/28 -> 64/17 · away-over-ceiling 128/46 -> 111/33 ·
 *    hard-blocked 172/56 -> 147/37 · cooldown 97/36 -> 82/24 · fable 130/47 -> 113/34 · leaving 151/56 -> 134/43 ·
 *    fable-leaving 159/60 -> 142/47.
 *
 *  LOWERED BY W3 Task 14 (D-4963, the hot sites: `_session_hard_blocked`'s `stalepress` and `tscan`,
 *  `_auto_stale_check`'s `stalepress`, `_auto_swap_check`'s `wrapper` (`_reg_read_to`), `lastswap` and `swapblocked`,
 *  `_auto_compact_check`'s `lastcompact`, `lastswap` and action-path `wrapper`; macOS bash 5.3 and Linux bash 5.2
 *  print the same table, ticks 1-4 included): each converted read loses its `$( )`, 1 fork and no exec (Task 13
 *  already took its `cat`), so forks fall by the converted reads a steady tick reaches and execs do not move. 7 where
 *  every gate is passed; busy 5 (`esc to interrupt` returns ahead of `stalepress` and `tscan`); hard-blocked 5 (the
 *  pane rung answers first); cooldown 4 (`lastswap`'s gate returns before `swapblocked` and the transcript); narrow 2
 *  (only `_auto_compact_check`'s two reads sit above its `_pane_measurable`). `_auto_stale_check`'s read and the
 *  action-path `wrapper` are reached by no fixture.
 *  Before -> after:
 *    idle-home 111/33 -> 104/33 · busy 109/33 -> 104/33 · narrow 64/17 -> 62/17 · away-over-ceiling 111/33 -> 104/33 ·
 *    hard-blocked 147/37 -> 142/37 · cooldown 82/24 -> 78/24 · fable 113/34 -> 106/34 · leaving 134/43 -> 127/43 ·
 *    fable-leaving 142/47 -> 135/47.
 */
const TICK_BUDGET: Record<FixtureName, { forks: number; execs: number }> = {
  'idle-home': { forks: 104, execs: 33 },
  busy: { forks: 104, execs: 33 },
  narrow: { forks: 62, execs: 17 },
  'away-over-ceiling': { forks: 104, execs: 33 },
  'hard-blocked': { forks: 142, execs: 37 },
  cooldown: { forks: 78, execs: 24 },
  fable: { forks: 106, execs: 34 },
  leaving: { forks: 127, execs: 43 },
  'fable-leaving': { forks: 135, execs: 47 },
};

/** `_plat_timeout`'s `-k` probe, per tick inside the loop. On `main` at
 *  `300aedf8` it was 1 on every tick: the cache it sets died with the `$( )`
 *  the probe runs in. D-4960 primes the cache once in the supervisor's own
 *  shell, before the loop, so it is 0. The pre-loop is outside this count;
 *  `ccd-tick-diet-seams.test.ts` row (a) holds it. */
const TICK_KPROBE = 0;

const ID = 'claude-a-tick';
const N = TICK_RUN_N;

/** Every environment this file hands a process: TMUX, TMUX_PANE and TMUX_TMPDIR
 *  removed, so nothing reaches a server outside this file's own. */
const NO_TMUX_ENV = { TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: undefined };

// The two bash spawns, beside the containment they run under. The shim
// directory goes in FRONT of what `ghContainedEnv` returns: its bin holds the
// poisoned tmux the tmux shim must displace, and every passthrough shim execs
// what that same bin resolves first, so a poisoned tool stays poisoned.
const tickEnv = (home: string, shims: string): NodeJS.ProcessEnv => {
  const contained = ghContainedEnv(home, { ...process.env, ...NO_TMUX_ENV, HOME: home }, { systemd: true, tmux: true });
  return { ...contained, PATH: `${shims}:${contained['PATH'] ?? ''}` };
};
const supervise = (home: string, shims: string): SpawnSyncReturns<string> =>
  spawnSync('bash', ['-c', `source "${CCD}"; ${supervisePrelude()}cmd_supervise ${ID}`],
    { encoding: 'utf8', cwd: home, timeout: 60000, env: tickEnv(home, shims) });
/** `type -t` of each word, from a shell that sourced ccd under the run's PATH. */
const typesOf = (home: string, shims: string, words: readonly string[]): Map<string, string> => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; for w in "$@"; do printf '%s\\t%s\\n' "$w" "$(type -t -- "$w")"; done`,
    'types', ...words], { encoding: 'utf8', cwd: home, timeout: 60000, env: tickEnv(home, shims) });
  return new Map((r.stdout ?? '').split('\n').filter(Boolean).map((l) => l.split('\t') as [string, string]));
};

interface Measured {
  counts: TickCount[]; status: number | null; stderr: string; sleeps: number; unshimmed: string[];
}

const harnesses: CcdHarness[] = [];
afterAll(() => { for (const h of harnesses) h.cleanup(); });

const measure = (h: CcdHarness, opts: ShimOpts = {}): Measured => {
  const shims = plantShims(h.home, opts);
  const r = supervise(h.home, shims);
  const types = typesOf(h.home, shims, commandWords(h.home));
  return {
    counts: countTicks(h.home, r.pid),
    status: r.status,
    stderr: r.stderr ?? '',
    sleeps: loopSleeps(h.home),
    unshimmed: unshimmedExternals(h.home, (w) => types.get(w) ?? ''),
  };
};

/** One run per fixture, shared by every assertion about it and by the table. */
const runs = new Map<FixtureName, Measured>();
const measured = (name: FixtureName): Measured => {
  let m = runs.get(name);
  if (!m) {
    const h = makeCcdHarness('ccrc-ccd-tick-budget-');
    harnesses.push(h);
    plantFixture(h.home, ID, name);
    m = measure(h);
    runs.set(name, m);
  }
  return m;
};

const steady = (m: Measured): TickCount[] => m.counts.slice(2, N + 1);
const fe = (t: TickCount): string => `${t.forks}/${t.execs}/${t.tmux}/${t.kprobe}/${t.date}`;

describe(`the supervise tick's fork budget: the real loop, ${N} ticks per fixture (tick-diet spec §9, #387)`, () => {
  for (const name of FIXTURES) {
    describe(name, () => {
      it('runs to the loop\'s own `gone` exit, through every tick, with no unshimmed external', () => {
        const m = measured(name);
        // NON-VACUITY. The loop's own exit, not spawnSync's kill; N sleeps by the
        // supervisor itself; and a tick that cost something.
        expect(m.stderr, `the run did not end through the loop: ${m.stderr.slice(-400)}`)
          .toContain('ended; exiting for systemd restart');
        expect(m.status).toBe(1);
        expect(m.sleeps, 'the loop\'s own sleeps').toBe(N);
        expect(m.counts, 'the pre-loop and ticks 1..N').toHaveLength(N + 1);
        expect(m.counts[2]!.forks, 'tick 2 forked nothing: the count measured nothing').toBeGreaterThan(0);
        // An external with no shim is an exec this count cannot see.
        expect(m.unshimmed, 'an external the tick ran has no shim: add it to the shim list '
          + '(`PASSTHROUGH_SHIMS`, tickBudgetHarness.ts)').toEqual([]);
      }, 120_000);

      it(`is steady: ticks 2–${N} cost the same`, () => {
        const ticks = steady(measured(name));
        const shape = ticks.map((t) => ({ forks: t.forks, execs: t.execs, tmux: t.tmux, kprobe: t.kprobe, date: t.date }));
        expect(shape.every((s) => JSON.stringify(s) === JSON.stringify(shape[0])),
          `${name} is not steady over ticks 2–${N}: ${ticks.map(fe).join(' | ')} (forks/execs/tmux/kprobe/date). `
          + 'Re-shape the fixture until every input it reads is decided; never average.').toBe(true);
      }, 120_000);

      it(`runs the \`-k\` probe exactly TICK_KPROBE times in each of ticks 1–${N} (D-4960)`, () => {
        const m = measured(name);
        expect(m.counts.slice(1).map((t) => t.kprobe)).toEqual(Array(N).fill(TICK_KPROBE));
      }, 120_000);

      it('forks and execs exactly its TICK_BUDGET per steady tick', () => {
        const t = steady(measured(name))[0]!;
        expect({ forks: t.forks, execs: t.execs },
          `${name}'s steady tick moved. A fork came back, or one went: lower or raise TICK_BUDGET to the measured `
          + 'figure and restate it in the PR\'s departure').toEqual(TICK_BUDGET[name]);
      }, 120_000);
    });
  }

  it('prints the table, for the PR\'s departure', () => {
    const rows = FIXTURES.map((name) => {
      const m = measured(name);
      const beat = m.counts.some((t) => t.heartbeat) ? ' (heartbeat carved out)' : '';
      return `${name.padEnd(18)} | pre-loop kprobe ${m.counts[0]!.kprobe} | tick 1 ${fe(m.counts[1]!)} `
        + `| ticks 2–${N} ${fe(steady(m)[0]!)}${beat}`;
    });
    console.log(['forks/execs/tmux/kprobe/date per tick', ...rows].join('\n'));
    expect(rows).toHaveLength(FIXTURES.length);
  }, 600_000);
});

// THE PARSER'S OWN ROWS: written run files, no spawn. Each pins a case no
// fixture reaches today, so the live suite alone could not see it break.
describe('the parser reads what the trace says ran, and which sleep ended a tick', () => {
  const plant = (xtrace: string[], log: string[]): string => {
    const d = mkTmp('ccrc-tick-parser-');
    fs.writeFileSync(path.join(d, '.xtrace'), `${xtrace.join('\n')}\n`);
    fs.writeFileSync(path.join(d, '.tick-shims.log'), log.map((l) => `${l}\n`).join(''));
    return d;
  };

  it('sees through `command` and `exec` to the program they run', () => {
    const home = plant([
      '+100:_x: command stat .',
      '+100:_x: command -- stat -f %m .',
      '+100:_x: command -v stat',
      '+100:_x: command -V tmux',
      '+100:_x: command grep -c x',
      '+100:_x: command printf x',
      '+100:_x: command -p grep -c x',
      '+100:_x: command _x_fn',
      '++101:_x: exec stat .',
      '++101:_x: exec -a name sort -n',
      '++101:_x: exec grep -c x',
      '++101:_x: exec printf x',
      '+100:_x: exec',
    ], []);
    const types: Record<string, string> = {
      command: 'builtin', exec: 'builtin', printf: 'builtin', stat: 'file', grep: 'file', sort: 'file', tmux: 'file',
      _x_fn: 'function',
    };
    expect(unshimmedExternals(home, (w) => types[w] ?? '').sort()).toEqual([
      'command -p grep (a default PATH, past every shim)',
      'command _x_fn (type -t: function, which `command` skips)',
      'command stat',
      'exec sort',
      'exec printf (type -t: builtin; `exec` runs a program)',
      'exec stat',
    ].sort());
  });

  // A tick ends where the LOOP slept. The sleep shim cannot see which function
  // forked it, so a helper's in-shell `sleep` advances the counter too; the
  // trace can see it, and the run must stop there and say so.
  const loop = [
    '+100:: cmd_ensure',
    '+100:cmd_supervise: local beat=0 unknown_run=0 tick=5 t0 spent',
    '++300:cmd_supervise: date +%s',
    '+300: @shim date',
  ];
  const loopSleep = ['+100:cmd_supervise: sleep 5', '+201: @shim sleep', '+201: @tick 1'];
  it('cuts a tick at the loop\'s own sleep', () => {
    const home = plant([...loop, ...loopSleep], ['0 300 100 date +%s', '0 201 100 sleep 5']);
    expect(countTicks(home, 100).map(({ tick, forks, execs, date }) => ({ tick, forks, execs, date })))
      .toEqual([{ tick: 0, forks: 0, execs: 0, date: 0 }, { tick: 1, forks: 2, execs: 2, date: 1 }]);
  });
  it('refuses a tick a helper\'s in-shell sleep ended, naming the helper', () => {
    const home = plant([...loop, '+100:_auto_stale_check: sleep 0', '+200: @shim sleep', '+200: @tick 1'],
      ['0 300 100 date +%s', '0 200 100 sleep 0']);
    expect(() => countTicks(home, 100)).toThrow(/tick 1 .*`_auto_stale_check`/);
  });
});

// THE REAL-TMUX VARIANT (plan Task 1 Step 6): the fake tmux is faithful for
// counting only if a real server gives the same figures. One `cc-<id>` session
// on a private `-L` socket, started with `-f /dev/null` and TMUX, TMUX_PANE and
// TMUX_TMPDIR removed (`ccd-tmux-anchor.test.ts`'s idiom), whose pane shows the
// `idle-home` screen and then blocks in `cat`. A second session keeps the server
// up when the shim kills the first at tick N, so the real server answers `can't
// find session`. Teardown kills only this file's own `-L` server.

/** The real tmux, resolved on the ambient PATH, absolute so a shim never finds
 *  itself. */
const REAL_TMUX: string | null = (() => {
  const r = spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' });
  const p = (r.stdout ?? '').trim();
  return r.status === 0 && p.startsWith('/') ? p : null;
})();
const NO_TMUX = REAL_TMUX === null;
/** Short (macOS `sun_path`) and unique per run. */
const SOCK = `cctick${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const T = (...args: string[]): SpawnSyncReturns<string> =>
  spawnSync(REAL_TMUX!, ['-L', SOCK, '-f', '/dev/null', ...args],
    { encoding: 'utf8', env: { ...process.env, ...NO_TMUX_ENV } });

describe.skipIf(NO_TMUX || process.platform === 'darwin')(
  'the fake tmux is faithful for counting: `idle-home` against a real tmux server on a private socket'
  + (NO_TMUX ? ' — SKIPPED: no tmux on PATH' : ''), () => {
    afterAll(() => {
      T('kill-server');
      // tmux leaves the socket FILE behind (measured, 3.4). TMUX_TMPDIR is
      // unset, so it is at tmux's own default, and the name is this run's alone.
      if (typeof process.getuid === 'function') {
        fs.rmSync(path.join('/tmp', `tmux-${process.getuid()}`, SOCK), { force: true });
      }
    });

    it('gives the shim run\'s exact `idle-home` budget', () => {
      const h = makeCcdHarness('ccrc-ccd-tick-budget-real-');
      harnesses.push(h);
      plantFixture(h.home, ID, 'idle-home');
      const keep = T('new-session', '-d', '-s', 'tick-keep', '-x', '80', '-y', '5', 'exec cat');
      expect(keep.status, `keeper new-session: ${keep.stderr}`).toBe(0);
      const mk = T('new-session', '-d', '-s', `cc-${ID}`, '-x', '200', '-y', '8',
        `cat '${fixtureScreenFile(h.home)}'; exec cat`);
      expect(mk.status, `fixture new-session: ${mk.stderr}`).toBe(0);
      let shown = '';
      for (let i = 0; i < 100 && !shown.includes('ctx'); i++) {
        shown = T('capture-pane', '-p', '-t', `=cc-${ID}:`).stdout ?? '';
        if (!shown.includes('ctx')) spawnSync('sleep', ['0.05']);
      }
      expect(shown, 'the pane never showed the idle-home screen').toContain('❯');
      const pid = Number(T('display-message', '-p', '-t', `=cc-${ID}:`, '#{pane_pid}').stdout.trim());
      expect(pid).toBeGreaterThan(0);
      plantFixture(h.home, ID, 'idle-home', { panePid: pid });   // the sessions JSON under the REAL pane's pid
      const m = measure(h, { realTmux: { bin: REAL_TMUX!, sock: SOCK } });
      expect(m.stderr).toContain('ended; exiting for systemd restart');
      expect(m.unshimmed).toEqual([]);
      const ticks = steady(m);
      expect(ticks.map(fe), 'steady against the real server').toEqual(Array(ticks.length).fill(fe(ticks[0]!)));
      expect({ forks: ticks[0]!.forks, execs: ticks[0]!.execs }).toEqual(TICK_BUDGET['idle-home']);
    }, 120_000);
  });
