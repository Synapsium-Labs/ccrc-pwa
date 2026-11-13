// server/test/ccd-launch-profile.test.ts
//
// Overlord W1a launch profiles, Task 3 (spec §3.6, H1; §3.3.7, H14; §3.3.4, C39): ccd applies the launch profile a
// session's route names, at every spawn. The row is `ccd/lib/launch-profiles.json`'s (a projection of
// `FLEET_ROLES.launchProfile`, held equal by `launch-profiles-file.test.ts`); the route fields are `profile`, `automem`
// and `compactwindow`. The substrate is `ccd-spawn-fleet-pins.test.ts`'s: both spawn lines (`--resume` and the
// `--session-id` retry), with the fleet pins armed, in a fixture HOME.
//
// CHARACTERIZATION FIRST (Review Focus 1): a row whose route names no profile spawns byte for byte as on the branch
// point, flags and environment both, on a first start, a resume (both lines), a fresh start and a routed row. The
// recording below was taken on the branch point's code, before `_profile_spawn_compose` existed (fix round 1 added the
// generation case and each case's stderr, recorded the same way, on the branch point's `ccd/ccd`): flags, environment
// and warnings, so the composer adds no line to a no-profile spawn's stderr either.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { COMPACT_WINDOW_MAX_TOKENS, COMPACT_WINDOW_MIN_TOKENS } from '../src/continuity/launchProfile.js';

const ID = 'lane-a-project-a';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const GEN = 'cafebabe-0000-4000-8000-000000000000';
const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-launch-profile-'); });
afterEach(() => { h.cleanup(); });

/** Seed a row; `route` is a list of `field value` pairs written as registry fields (what `cmd_route --set` leaves). */
const seed = (route: readonly (readonly [string, string])[] = []): void => {
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} workdir '${h.home}'
        _reg_set ${ID} uuid ${UUID}
        ${route.map(([f, v]) => `_reg_set ${ID} ${f} '${v}'`).join('\n        ')}`);
};
/** HOME and the run's temp root, which differ per run, as placeholders; everything else is the spawn's own bytes. */
const norm = (l: string): string => l.split(h.home).join('<HOME>').replace(/CCRC_SESSION_TMPDIR='[^']*'/g, "CCRC_SESSION_TMPDIR='<TMP>'");
/** Run `_spawn_start` with `mode`, and answer the tmux new-session lines with HOME normalised, plus stderr. */
const spawn = (mode: 'new' | 'resume', pre = ''): { lines: string[]; err: string } => {
  h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"`);
  const r = spawnSync('bash', ['-c', 'a_src=$A_SRC a_snip=$A_SNIP; unset A_SRC A_SNIP; source "$a_src"; eval "$a_snip"'], {
    env: ghContainedEnv(h.home, { ...h.env(), A_SRC: CCD, A_SNIP: `${RESUME_DIES} ${pre} _spawn_start ${ID} ${mode}` }, { systemd: true, tmux: true, net: true }),
    cwd: h.home, encoding: 'utf8',
  });
  const lines = h.calls().filter((c) => c.startsWith('tmux new-session')).map(norm);
  return { lines, err: r.stderr.split(h.home).join('<HOME>') };
};
/** The one `--settings` value of a spawn line, parsed (inline JSON, exactly one flag). */
const settingsOf = (l: string): Record<string, unknown> => {
  const all = [...l.matchAll(/--settings '([^']*)'/g)].map((m) => m[1] as string);
  expect(all, l).toHaveLength(1);
  return JSON.parse(all[0]!) as Record<string, unknown>;
};
// ── The recording (branch point d24da2880), normalised by `norm`. ────────────────────────────────────────────────
const RECORDED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/launch-profile/branch-point.json'), 'utf8')) as Record<string, string[]>;

describe('no profile, no change: the spawn is byte for byte the branch point (Review Focus 1)', () => {
  const cases: [string, 'new' | 'resume', readonly (readonly [string, string])[], string][] = [
    ['first start', 'new', [], ''],
    ['resume, both lines', 'resume', [], ''],
    ['fresh start', 'new', [], `_reg_set ${ID} fresh ${UUID};`],
    ['routed row, resume', 'resume', [['effort', 'high'], ['workflow', 'on'], ['subagent', 'sonnet']], ''],
    ['resume with a generation file', 'resume', [], `printf '%s' ${GEN} > "$HOME/.cc-sessions/${ID}.generation";`],
  ];
  for (const [name, mode, route, pre] of cases) {
    it(name, () => {
      seed(route);
      const { lines, err } = spawn(mode, pre);
      const errLines = err.split('\n').filter((l) => l !== '');
      if (process.env.LP_RECORD === '1') console.log(`RECORD ${JSON.stringify([name, lines, errLines])}`);
      expect(lines).toStrictEqual(RECORDED[name]);
      expect(errLines).toStrictEqual(RECORDED[`${name} (stderr)`]);
      expect(err).not.toContain('launch profile');
    });
  }
  it('the fresh start spends its receipt, and the generation case carries the generation', () => {
    expect(RECORDED['fresh start']).toBeDefined();
    seed();
    spawn('new', `_reg_set ${ID} fresh ${UUID};`);
    expect(h.reg(ID, 'fresh')).toBe(`used ${UUID}`);
    for (const l of RECORDED['resume with a generation file']!) expect(l).toContain(`CCRC_SESSION_GENERATION='${GEN}'`);
  });
});

// ── Applying a profile (Review Focus 2 and 5; plan Task 3 Step 2). ─────────────────────────────────────────────
const MEM = 'CLAUDE_CODE_DISABLE_AUTO_MEMORY=1';
const PINS = { autoContinueAtUsageLimit: false, crossSessionInbound: 'refuse', idleCompaction: true };
/** `cmd_route`, observed through its exit status (it refuses through `die`): the `ccd-route-verb.test.ts` shape. */
const route = (args: string, pre = ''): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; ${pre} cmd_route ${args}`],
      { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};
/** A profiles file of the test's own, named to ccd through `LAUNCH_PROFILES_JSON` (a snippet prefix). */
const altFile = (rows: unknown): string => {
  const f = path.join(h.home, 'alt-profiles.json');
  fs.writeFileSync(f, typeof rows === 'string' ? rows : JSON.stringify(rows));
  return `LAUNCH_PROFILES_JSON='${f}';`;
};

describe('the spawn applies the launch profile the route names (H1, H14, C39)', () => {
  it('coordinator with a compact window: idle compaction off over the fleet pin, memory off, the window set, on both resume lines', () => {
    seed([['profile', 'coordinator'], ['compactwindow', '350000']]);
    const { lines } = spawn('resume');
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(settingsOf(l)).toStrictEqual({ ...PINS, idleCompaction: false });
      expect(l).toContain(` ${MEM} `);
      expect(l).toContain(' CLAUDE_CODE_AUTO_COMPACT_WINDOW=350000 ');
    }
  });
  it('coordinator with no compact window: no compaction setting from the profile and no window variable (compaction-follows-continuity)', () => {
    seed([['profile', 'coordinator']]);
    const { lines, err } = spawn('new');
    expect(lines).toHaveLength(1);
    expect(settingsOf(lines[0]!)).toStrictEqual(PINS);
    expect(lines[0]).toContain(` ${MEM} `);
    expect(lines[0]).not.toContain('CLAUDE_CODE_AUTO_COMPACT_WINDOW');
    expect(err).not.toContain('launch profile');
  });
  it('the overlord turns forks and agent view off, and its memory', () => {
    seed([['profile', 'overlord']]);
    const l = spawn('new').lines[0]!;
    for (const w of ['CLAUDE_CODE_DISABLE_AGENT_VIEW=1', 'CLAUDE_CODE_FORK_SUBAGENT=0', MEM]) expect(l).toContain(` ${w} `);
    expect(settingsOf(l)).toStrictEqual(PINS);
  });
  it('a worker gets memory off and nothing else: the line is the no-profile line plus one word', () => {
    seed([['profile', 'worker']]);
    const l = spawn('new').lines[0]!;
    expect(l.replace(` ${MEM}`, '')).toBe(RECORDED['first start']![0]);
    expect(l).toContain(` ${MEM} `);
  });
  it('a fresh start applies it too', () => {
    seed([['profile', 'reviewer']]);
    const l = spawn('new', `_reg_set ${ID} fresh ${UUID};`).lines[0]!;
    expect(l.replace(` ${MEM}`, '')).toBe(RECORDED['fresh start']![0]);
    expect(l).toContain(` ${MEM} `);
  });
  it('plain follows the route: automem off sets the variable; on, or absent, does not', () => {
    seed([['profile', 'plain'], ['automem', 'off']]);
    expect(spawn('new').lines[0]).toContain(` ${MEM} `);
    seed([['automem', 'on']]);
    expect(spawn('new').lines).toStrictEqual(RECORDED['first start']);
    h.sh(`rm -f "$HOME/.cc-sessions/${ID}.automem"`);
    expect(spawn('new').lines).toStrictEqual(RECORDED['first start']);
  });
  it("a routed row keeps its own --settings keys and gains the profile's after the pins", () => {
    seed([['effort', 'high'], ['workflow', 'on'], ['subagent', 'sonnet'], ['profile', 'coordinator'], ['compactwindow', '120000']]);
    const { lines } = spawn('resume');
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(settingsOf(l)).toStrictEqual({ enableWorkflows: true, ...PINS, idleCompaction: false });
      expect(l).toContain(' CLAUDE_CODE_AUTO_COMPACT_WINDOW=120000 ');
    }
  });
});

describe('an unknown or unreadable profile never half-applies (Review Focus 2)', () => {
  const warned = (err: string, word: string): void => {
    expect(err).toContain(`ccd: warn: ${ID}: launch profile ${word} unreadable — spawning without it`);
  };
  it('the file deleted after the route was set: spawn as today, and warn, on a first start, a resume and a fresh start', () => {
    seed([['profile', 'coordinator'], ['compactwindow', '350000']]);
    const pre = `LAUNCH_PROFILES_JSON="$HOME/no-such.json";`;
    for (const [mode, rec] of [['new', 'first start'], ['resume', 'resume, both lines']] as const) {
      const { lines, err } = spawn(mode, pre);
      expect(lines, rec).toStrictEqual(RECORDED[rec]);
      warned(err, 'coordinator');
    }
    const fresh = spawn('new', `${pre} _reg_set ${ID} fresh ${UUID};`);
    expect(fresh.lines).toStrictEqual(RECORDED['fresh start']);
    warned(fresh.err, 'coordinator');
  });
  it('a file that does not parse, or a row of the wrong shape: nothing applied, settings or environment', () => {
    seed([['profile', 'worker']]);
    const row = (over: Record<string, unknown>): unknown => ({ worker: { env: {}, settings: {}, autoMemory: 'off', compactionSettings: {}, ...over } });
    for (const bad of ['{not json', row({ env: { CLAUDE_CODE_X: "a'b" } }), row({ env: { CLAUDE_CODE_X: 'a b' } }), row({ env: { PATH: '/x' } }),
      row({ autoMemory: 'maybe' }), row({ settings: [] }), row({ env: { CLAUDE_CODE_X: 1 } }), { worker: null },
      // jq's `$` matches before a final newline, so these two passed an unanchored check (review F3): the value would cut
      // the env line after it, and the key would run as a program.
      row({ env: { CLAUDE_CODE_X: '1\n', CLAUDE_CODE_Y: '2' } }), row({ env: { 'CLAUDE_CODE_X\n': '1' } })]) {
      const { lines, err } = spawn('new', altFile(bad));
      expect(lines, JSON.stringify(bad)).toStrictEqual(RECORDED['first start']);
      warned(err, 'worker');
    }
  });
  it('a settings merge that fails takes the environment with it, and says so once, naming the merge', () => {
    seed([['profile', 'worker']]);
    const { lines, err } = spawn('new', altFile({ worker: { env: { CLAUDE_CODE_X: '1' }, settings: { k: "it's" }, autoMemory: 'off', compactionSettings: {} } }));
    expect(lines).toStrictEqual(RECORDED['first start']);
    expect(err.split('\n').filter((l) => l.includes('launch profile'))).toStrictEqual([
      `ccd: warn: ${ID}: could not merge launch profile worker into this spawn's one --settings — spawning without them`]);
  });
  it('a profiles file that cannot be read journals its own route-unmeasured line, once, naming the file', () => {
    seed([['profile', 'coordinator']]);
    for (let i = 0; i < 2; i++) warned(spawn('new', `LAUNCH_PROFILES_JSON="$HOME/no-such.json";`).err, 'coordinator');
    const log = fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8').split('\n').filter((l) => l.includes('route-unmeasured'));
    expect(log).toHaveLength(1);
    expect(log[0]).toContain(`route-unmeasured ${ID}: field profile could not be checked — this box's launch profiles (${h.home}/no-such.json) cannot be read`);
    expect(log[0]).not.toContain('roster projection');
  });
  it('a stored word that is not a row: spawn as today, and the warning names it, or its byte count when it is not a word', () => {
    seed([['profile', 'bogus']]);
    const r1 = spawn('new');
    expect(r1.lines).toStrictEqual(RECORDED['first start']);
    warned(r1.err, 'bogus');
    h.sh(`printf '%s' 'x y' > "$HOME/.cc-sessions/${ID}.profile"`);
    const r2 = spawn('new');
    expect(r2.lines).toStrictEqual(RECORDED['first start']);
    warned(r2.err, '<3 bytes>');
  });
});

describe('the route fields: written by cmd_route, checked by _route_valid, skipped by _route_any', () => {
  it('cmd_route writes the three and refuses what is not in their vocabulary', () => {
    seed();
    expect(route(`--session ${ID} --set profile=coordinator --set automem=off --set compactwindow=350000`).status).toBe(0);
    expect([h.reg(ID, 'profile'), h.reg(ID, 'automem'), h.reg(ID, 'compactwindow')]).toEqual(['coordinator', 'off', '350000']);
    // The window's bounds are the decider's own constants (review F5), so a TS-only change to them reds here.
    for (const ok of [COMPACT_WINDOW_MIN_TOKENS, COMPACT_WINDOW_MAX_TOKENS]) expect(route(`--session ${ID} --set compactwindow=${ok}`).status, `${ok}`).toBe(0);
    for (const bad of ['profile=bogus', 'profile=Coordinator', 'profile=', 'automem=maybe', 'compactwindow=50', `compactwindow=${COMPACT_WINDOW_MIN_TOKENS - 1}`,
      `compactwindow=${COMPACT_WINDOW_MAX_TOKENS + 1}`, 'compactwindow=0350000']) {
      const r = route(`--session ${ID} --set ${bad}`);
      expect(r.status, bad).not.toBe(0);
      expect(r.out, bad).toMatch(/not in its vocabulary/);
    }
  });
  it('an unreadable profiles file is "vocabulary unavailable", not a bad value', () => {
    seed();
    const r = route(`--session ${ID} --set profile=worker`, 'LAUNCH_PROFILES_JSON="$HOME/no-such.json";');
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/launch profiles \(.*no-such\.json\) cannot be read — re-run ccrc install/);
  });
  it('a row naming only the launch fields has no routing record: the coordinator row is still seeded', () => {
    seed([['profile', 'plain'], ['automem', 'off'], ['compactwindow', '350000']]);
    expect(h.sh(`_route_any ${ID} && echo yes || echo no`).trim()).toBe('no');
    h.sh(`_route_seed_default ${ID} claude`);
    expect(h.reg(ID, 'class')).toBe('opus');
  });
  it('a profile-only spawn writes no routeapplied', () => {
    seed([['profile', 'worker']]);
    spawn('new');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.routeapplied`))).toBe(false);
  });
});

