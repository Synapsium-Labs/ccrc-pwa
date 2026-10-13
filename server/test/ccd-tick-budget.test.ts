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
// own tree and red against the tree before it: `main` at `300aedf8` is the
// calibration below, W1 lowers it (D-4960, D-4961), W2 (D-4962) and W3 (D-4963)
// lower it again.
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
 *  Calibrated on `main` at `300aedf8` (macOS, bash 5.3; Linux, bash 5.2: the
 *  same figures). Lowered only by a change that measures the new figure and
 *  states it in its PR's departure. */
const TICK_BUDGET: Record<FixtureName, { forks: number; execs: number }> = {
  'idle-home': { forks: 174, execs: 81 },
  busy: { forks: 170, execs: 79 },
  narrow: { forks: 77, execs: 31 },
  'away-over-ceiling': { forks: 202, execs: 101 },
  'hard-blocked': { forks: 427, execs: 240 },
  cooldown: { forks: 100, execs: 40 },
  fable: { forks: 162, execs: 72 },
  leaving: { forks: 413, execs: 247 },
  'fable-leaving': { forks: 395, execs: 232 },
};

/** `_plat_timeout`'s `-k` probe, per tick inside the loop. On `main` it is 1 on
 *  every tick: the cache it sets dies with the `$( )` the probe runs in
 *  (D-4960, visible). The pre-loop is outside this count. */
const TICK_KPROBE = 1;

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
