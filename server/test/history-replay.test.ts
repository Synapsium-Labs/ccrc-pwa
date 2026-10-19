// deploy/history-replay.mjs: the ccrc history W2 replay driver (spec 2026-10-05 §10.2; W2 decisions W2-D50 to W2-D59).
// The ONE test file W2 creates (W2-D5). It is listed in ci.yml's node-floor heredoc, so the 22.16.0 leg runs it on
// every pull request; ci-pipeline.test.ts derives that list from this directory and reds when the line is missing.
//
// ISOLATION: every spawn runs on a mkTmp fixture HOME with historyHelpers' scrubbedEnv, which drops the session's
// own TMUX, TMUX_PANE, CLAUDECODE, CLAUDE_CONFIG_DIR, CCRC_SESSION_GENERATION and CCRC_RECALL_* first. Children are
// spawned with an argv array on process.execPath, never through a shell. Key-shaped fixture values are assembled at
// run time; no fixture names a real account, host or path.
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { REPO, scrubbedEnv } from './historyHelpers.js';
import { EXIT, REASONS } from '../../ccd/history/lib.mjs';
import * as replay from '../../deploy/history-replay.mjs';
// W2-4 Task 2 (the --out rule, W2-D53, RP4): aliased, so no name here collides with an import above.
import * as t2Fs from 'node:fs';
import * as t2Path from 'node:path';
import { spawnSync as t2SpawnSync } from 'node:child_process';
import { pathToFileURL as t2FileUrl } from 'node:url';
import * as t2Drv from '../../deploy/history-replay.mjs';
import { mkTmp as t2MkTmp } from './tmpHelpers.js';
import { scrubbedEnv as t2Scrubbed } from './historyHelpers.js';

const SCRIPT = path.join(REPO, 'deploy', 'history-replay.mjs');

/** One driver run as the operator makes it: node on the script, an argv array, a fixture HOME, the scrubbed env plus
 *  `extraEnv`, and the HOME as cwd so a relative path never lands in the checkout. */
function runDriver(home: string, args: string[], extraEnv: Record<string, string> = {}): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: home, encoding: 'utf8', timeout: 60_000,
    env: { ...scrubbedEnv(process.env), HOME: home, ...extraEnv },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** What a refusal prints: exactly one stderr line. */
const refusalLine = (word: string, detail: string): string => `ccrc history-replay: ${word}: ${detail}\n`;

// ── W2-4 Task 1: the driver's words (W2-D59, W2-D12; D-5774) ──────────────
describe('history-replay W2-4 Task 1: the driver words (W2-D59, W2-D12; D-5774)', () => {
  const W2_D59 = ['family-unlisted', 'family-recall-off', 'quiz-unanswerable', 'quiz-sha-mismatch',
    'claude-version-moved', 'tree-moved', 'wrapper-moved', 'code-changed', 'limits-threshold', 'limits-stale',
    'budget-exhausted', 'record-invalid', 'record-sha-mismatch', 'input-sha-mismatch', 'assignment-mismatch', 'out-refused'];
  const PLAN_CHOSEN = ['args-invalid', 'in-pane', 'roster-invalid', 'account-refused', 'input-invalid', 'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured'];

  it('DRIVER_REASONS is frozen, duplicate-free, and exactly W2-D59\'s sixteen words in order, then W2-4\'s nine', () => {
    expect(W2_D59).toHaveLength(16);
    expect(Object.isFrozen(replay.DRIVER_REASONS)).toBe(true);
    expect(new Set(replay.DRIVER_REASONS).size, 'a word is listed twice').toBe(replay.DRIVER_REASONS.length);
    expect([...replay.DRIVER_REASONS]).toEqual([...W2_D59, ...PLAN_CHOSEN]);
  });

  it('DRIVER_REASONS is disjoint from lib REASONS: no driver word is a CLI word (C-J)', () => {
    const cli = Object.keys(REASONS);
    expect(cli.length, 'lib REASONS read empty: the disjointness would hold vacuously').toBeGreaterThan(40);
    expect(replay.DRIVER_REASONS.filter((w) => cli.includes(w))).toEqual([]);
  });

  it('DriverRefusal carries its word and detail, refuse() throws one, and a word outside DRIVER_REASONS is a TypeError', () => {
    const r = new replay.DriverRefusal('out-refused', 'symlink');
    expect(r).toBeInstanceOf(Error);
    expect([r.name, r.word, r.detail, r.message]).toEqual(['DriverRefusal', 'out-refused', 'symlink', 'out-refused: symlink']);
    expect(() => replay.refuse('in-pane', 'x')).toThrow(replay.DriverRefusal);
    expect(() => new replay.DriverRefusal('bad-args', 'x'), 'a lib word is not a driver word').toThrow(TypeError);
    expect(() => new replay.DriverRefusal('', 'x')).toThrow(TypeError);
  });
});

// ── W2-4 Task 1: the argument grammar ─────────────────────────────────────
describe('history-replay W2-4 Task 1: the argument grammar', () => {
  /** A fixture grammar: one subcommand and one flag of each kind. */
  const OPTS = { specs: { out: 'string', budget: 'int', dry: 'bool' } as const, subs: ['fixture-sub'] };
  const refusalOf = (argv: string[], opts: Parameters<typeof replay.parseArgs>[1] = OPTS): [string, string] | null => {
    try { replay.parseArgs(argv, opts); return null; } catch (e) {
      if (e instanceof replay.DriverRefusal) return [e.word, e.detail];
      throw e;
    }
  };

  it('FLAG_SPECS declares exactly the seven flags W2-4 uses, frozen', () => {
    expect(Object.isFrozen(replay.FLAG_SPECS)).toBe(true);
    expect(replay.FLAG_SPECS).toEqual({ out: 'string', account: 'string', budget: 'int', 'writer-model': 'string',
      'judge-model': 'string', 'arm-model': 'string', 'settings-mode': 'string' });
  });

  it('a subcommand, a string, an int and a bool parse to {sub, flags}', () => {
    expect(replay.parseArgs(['fixture-sub', '--out', '/x/y', '--budget', '3000000', '--dry'], OPTS))
      .toEqual({ sub: 'fixture-sub', flags: { out: '/x/y', budget: 3_000_000, dry: true } });
    expect(replay.parseArgs(['fixture-sub'], OPTS)).toEqual({ sub: 'fixture-sub', flags: {} });
  });

  it.each([
    [[], 'no subcommand'],
    [['--out', '/x'], 'no subcommand'],
    [['other-sub'], 'unknown subcommand "other-sub"'],
    [['fixture-sub', '--nope', 'v'], 'unknown flag "--nope"'],
    [['fixture-sub', '--out=/x'], 'unknown flag "--out=/x"'],
    [['fixture-sub', 'stray'], 'unexpected argument "stray"'],
    [['fixture-sub', '--out', '/a', '--out', '/b'], 'repeated flag --out'],
    [['fixture-sub', '--dry', '--dry'], 'repeated flag --dry'],
    [['fixture-sub', '--out'], 'missing value for --out'],
    [['fixture-sub', '--out', '--budget', '5'], 'missing value for --out'],
    [['fixture-sub', '--budget', '0'], '--budget wants a positive integer, got "0"'],
    [['fixture-sub', '--budget', '-5'], '--budget wants a positive integer, got "-5"'],
    [['fixture-sub', '--budget', '1.5'], '--budget wants a positive integer, got "1.5"'],
    [['fixture-sub', '--budget', '1e6'], '--budget wants a positive integer, got "1e6"'],
    [['fixture-sub', '--budget', '0x10'], '--budget wants a positive integer, got "0x10"'],
    [['fixture-sub', '--budget', '007'], '--budget wants a positive integer, got "007"'],
    [['fixture-sub', '--budget', '99999999999999999999'], '--budget wants a positive integer, got "99999999999999999999"'],
  ])('argv %j is args-invalid: %s', (argv, detail) => {
    expect(refusalOf(argv)).toEqual(['args-invalid', detail]);
  });

  it('under the driver\'s own grammar (no opts: FLAG_SPECS and HANDLERS\' keys) an unregistered subcommand is args-invalid', () => {
    // parseArgs is called with no opts here; refusalOf's default is the fixture grammar. The name is one no task
    // registers, so the case holds after Tasks 8 and 9 register step0a and probe, and those tasks pin their own names.
    const own = (argv: string[]): [string, string] | null => {
      try { replay.parseArgs(argv); return null; } catch (e) {
        if (e instanceof replay.DriverRefusal) return [e.word, e.detail];
        throw e;
      }
    };
    expect(replay.HANDLERS.has('no-such-sub')).toBe(false);
    expect(own(['no-such-sub', '--out', '/x'])).toEqual(['args-invalid', 'unknown subcommand "no-such-sub"']);
    expect(own(['fixture-sub']), 'the fixture grammar is not the default').toEqual(['args-invalid', 'unknown subcommand "fixture-sub"']);
  });
});

// ── W2-4 Task 1: RP2, the pane refusal (W2-D51, W2-D45) ───────────────────
describe('history-replay W2-4 Task 1: RP2, the pane refusal comes first (W2-D51, W2-D45)', () => {
  const PANE = 'TMUX_PANE is set; run the driver from a shell outside tmux';

  it('paneRefusal: undefined answers null; any defined value, the empty string included, answers in-pane', () => {
    expect(replay.paneRefusal({})).toBeNull();
    expect(replay.paneRefusal({ TMUX_PANE: undefined, TMUX: '/tmp/fixture-sock,1,0' })).toBeNull();
    for (const v of ['%9', '']) {
      const r = replay.paneRefusal({ TMUX_PANE: v });
      expect(r, JSON.stringify(v)).toBeInstanceOf(replay.DriverRefusal);
      expect([r?.word, r?.detail]).toEqual(['in-pane', PANE]);
    }
  });

  it.each(['%9', ''])('RP2: TMUX_PANE=%j refuses in-pane, exit 2, before anything: the --out path is not created', (pane) => {
    const home = mkTmp('ccrc-replay-rp2-');
    const out = path.join(home, 'replay-out');
    const r = runDriver(home, ['step0a', '--out', out, '--account', 'up-a', '--budget', '1000'], { TMUX_PANE: pane });
    expect(r.code).toBe(EXIT.REFUSED);
    expect(r.stderr).toBe(refusalLine('in-pane', PANE));
    expect(r.stdout).toBe('');
    expect(existsSync(out), 'the --out path was created').toBe(false);
  });

  it('RP2: with TMUX_PANE set, an argv the grammar refuses still answers in-pane: the pane is checked first', () => {
    const home = mkTmp('ccrc-replay-rp2-');
    const r = runDriver(home, ['--no-such-flag'], { TMUX_PANE: '' });
    expect([r.code, r.stderr]).toEqual([EXIT.REFUSED, refusalLine('in-pane', PANE)]);
  });

  it('RP2 CONTROL: without TMUX_PANE the same argv reaches the grammar, so the scrubbed env really lacks it', () => {
    expect(scrubbedEnv({ TMUX_PANE: '%1', HOME: '/h' })).toEqual({ HOME: '/h' });
    const home = mkTmp('ccrc-replay-rp2-');
    const r = runDriver(home, ['--no-such-flag']);
    expect([r.code, r.stderr]).toEqual([EXIT.REFUSED, refusalLine('args-invalid', 'no subcommand')]);
  });
});

// ── W2-4 Task 1: main's stderr line and exit codes, and the entry guard ───
describe('history-replay W2-4 Task 1: main answers one stderr line, exit 2 for a word and 1 for a defect', () => {
  /** Runs `fn` with a handler registered under `sub`, and removes it afterwards (HANDLERS is module state). From Task 2
   *  on, main sets process.umask(0o077) before parseArgs, and these cases call main in this test process (vitest's fork
   *  pool), so the worker's umask is saved first and restored afterwards: no later case inherits 077. */
  const withHandler = async (sub: string, h: (flags: Record<string, string | number | boolean>, env: Record<string, string | undefined>) => Promise<number>,
    fn: () => Promise<void>): Promise<void> => {
    replay.HANDLERS.set(sub, h);
    const umask = process.umask(0o022);
    process.umask(umask);
    try { await fn(); } finally { replay.HANDLERS.delete(sub); process.umask(umask); }
  };
  const stderrOf = async (fn: () => Promise<number>): Promise<{ code: number; err: string }> => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await fn();
      return { code, err: spy.mock.calls.map((c) => String(c[0])).join('') };
    } finally { spy.mockRestore(); }
  };

  it('a registered handler gets the parsed flags and the env, and its code is main\'s', async () => {
    const seen: unknown[] = [];
    await withHandler('fixture-sub', async (flags, env) => { seen.push(flags, env.HOME); return 0; }, async () => {
      const r = await stderrOf(() => replay.main(['fixture-sub', '--out', '/x', '--budget', '7'], { HOME: '/fixture-home' }));
      expect(r).toEqual({ code: 0, err: '' });
    });
    expect(seen).toEqual([{ out: '/x', budget: 7 }, '/fixture-home']);
  });

  it('a handler\'s DriverRefusal is one stderr line and EXIT.REFUSED (2)', async () => {
    await withHandler('fixture-sub', async () => replay.refuse('budget-exhausted', 'spent 10 of 10'), async () => {
      expect(await stderrOf(() => replay.main(['fixture-sub'], {})))
        .toEqual({ code: EXIT.REFUSED, err: refusalLine('budget-exhausted', 'spent 10 of 10') });
    });
    expect(EXIT.REFUSED).toBe(2);
  });

  it('any other throw is a defect: one internal-error report and EXIT.INTERNAL (1)', async () => {
    await withHandler('fixture-sub', async () => { throw new Error('fixture defect'); }, async () => {
      const r = await stderrOf(() => replay.main(['fixture-sub'], {}));
      expect(r.code).toBe(EXIT.INTERNAL);
      expect(r.err).toMatch(/^ccrc history-replay: internal error: Error: fixture defect\n/);
    });
    expect(EXIT.INTERNAL).toBe(1);
  });

  it('spawned with no subcommand: exit 2, the one args-invalid line, nothing on stdout', () => {
    const r = runDriver(mkTmp('ccrc-replay-main-'), []);
    expect(r).toEqual({ code: EXIT.REFUSED, stdout: '', stderr: refusalLine('args-invalid', 'no subcommand') });
  });

  it('the entry guard: run through a symlink, main still runs (realpath), and importing the module ran nothing', () => {
    const home = mkTmp('ccrc-replay-main-');
    mkdirSync(path.join(home, 'bin'));
    const link = path.join(home, 'bin', 'replay.mjs');
    symlinkSync(SCRIPT, link);
    // A name no task registers, so this case still holds once Tasks 8 and 9 register step0a and probe.
    const r = spawnSync(process.execPath, [link, 'no-such-sub'], {
      cwd: home, encoding: 'utf8', timeout: 60_000, env: { ...scrubbedEnv(process.env), HOME: home },
    });
    expect([r.status, r.stderr]).toEqual([EXIT.REFUSED, refusalLine('args-invalid', 'unknown subcommand "no-such-sub"')]);
    expect(process.exitCode ?? 0, 'importing the driver set an exit code').toBe(0);
  });
});

// ── W2-4 Task 1: W2-D51, no deploy/history-*.mjs loads node:sqlite ────────
describe('history-replay W2-4 Task 1: no deploy/history-*.mjs loads node:sqlite (W2-D51)', () => {
  /** Any quoted `node:sqlite` specifier: a static import, a dynamic import() and a createRequire call all quote it.
   *  KNOWN WIDTH: a specifier assembled from pieces is not seen; review is the backstop. A quoted mention inside a
   *  comment reds too, which is the safe side. */
  const SQLITE_LOAD = /(['"`])node:sqlite\1/;
  const DEPLOY = path.join(REPO, 'deploy');
  const historyMjs = (): string[] => readdirSync(DEPLOY).filter((f) => /^history-[\w.-]*\.mjs$/.test(f)).sort();

  it('CONTROL: the pattern sees each load form on a planted line, and not prose; the corpus holds the driver', () => {
    for (const planted of [
      "import { DatabaseSync } from 'node:sqlite';",
      'const { DatabaseSync } = await import("node:sqlite");',
      "const sqlite = createRequire(import.meta.url)('node:sqlite');",
      'const s = require(`node:sqlite`);',
    ]) expect(SQLITE_LOAD.test(planted), planted).toBe(true);
    expect(SQLITE_LOAD.test('// every store read opens through openReader, never node:sqlite directly')).toBe(false);
    expect(SQLITE_LOAD.test("import { DatabaseSync } from 'node:sqlite3';")).toBe(false);
    expect(historyMjs()).toContain('history-replay.mjs');
  });

  it('no deploy/history-*.mjs spells a node:sqlite load: every store read opens through store.mjs openReader', () => {
    const loaders = historyMjs().filter((f) => readFileSync(path.join(DEPLOY, f), 'utf8').split('\n').some((l) => SQLITE_LOAD.test(l)));
    expect(loaders).toEqual([]);
  });
});


// ── W2-4 Task 2: the --out rule (W2-D53; spec §10.2 "creates 0700 under umask 077", "refuses an --out inside a git
// tree"; pin RP4) ──────────────────────────────────────────────────────────────────────────────────────────────────
// prepareOut is called in-process: it reads only the paths it is handed and the uid parameter. main's umask is
// measured in a child process, because process.umask would otherwise change this test worker's own.
describe('W2-4 Task 2: the --out rule, created 0700 with its marker, reused only when it is still exactly that (W2-D53, RP4)', () => {
  const T2_SCRIPT = t2Path.resolve(__dirname, '../../deploy/history-replay.mjs');
  const asRoot = process.getuid?.() === 0;
  /** A fresh fixture directory, by its realpath (a darwin TMPDIR is a symlink). */
  const base = (): string => t2Fs.realpathSync(t2MkTmp('ccrc-replay-out-'));
  /** The refusal a call throws, or null when it returns; any other throw fails the case. */
  const refusalOf = (fn: () => unknown): { word: string; detail: string } | null => {
    try { fn(); return null; } catch (e) {
      if (e instanceof t2Drv.DriverRefusal) return { word: e.word, detail: e.detail };
      throw e;
    }
  };
  const out = (word: string): { word: string; detail: string } => ({ word: 'out-refused', detail: word });
  const modeOf = (p: string): string => (t2Fs.lstatSync(p).mode & 0o7777).toString(8).padStart(4, '0');
  /** A valid --out, made by prepareOut itself. */
  const made = (b: string): string => t2Drv.prepareOut(t2Path.join(b, 'out'));

  it('CONTROL: a fresh fixture is outside any git tree, and the walk sees a planted .git directory and a planted .git file above a path that does not exist yet', () => {
    const b = base();
    expect(t2Drv.insideGitTree(b), 'the run temp dir sits inside a git tree: every --out case below would refuse').toEqual({ state: 'outside' });
    t2Fs.mkdirSync(t2Path.join(b, 'repo', '.git'), { recursive: true });
    expect(t2Drv.insideGitTree(t2Path.join(b, 'repo', 'a', 'b'))).toEqual({ state: 'inside', at: t2Path.join(b, 'repo') });
    t2Fs.mkdirSync(t2Path.join(b, 'wt'));
    t2Fs.writeFileSync(t2Path.join(b, 'wt', '.git'), 'gitdir: /nowhere/.git/worktrees/wt\n');
    expect(t2Drv.insideGitTree(t2Path.join(b, 'wt', 'out'))).toEqual({ state: 'inside', at: t2Path.join(b, 'wt') });
  });

  it.each([
    ['a .git directory', (r: string) => t2Fs.mkdirSync(t2Path.join(r, '.git'))],
    ['a .git file (a worktree)', (r: string) => t2Fs.writeFileSync(t2Path.join(r, '.git'), 'gitdir: /nowhere/.git/worktrees/r\n')],
  ])('RP4: an --out under %s is refused in-git-tree and never created', (_what, plant) => {
    const b = base();
    const repo = t2Path.join(b, 'repo');
    t2Fs.mkdirSync(repo);
    plant(repo);
    const o = t2Path.join(repo, 'out');
    expect(refusalOf(() => t2Drv.prepareOut(o))).toEqual(out(`in-git-tree ${repo}`));
    expect(t2Fs.existsSync(o), 'the refused --out was created').toBe(false);
  });

  it('RP4: a created --out is mode 0700 and holds the marker with OUT_KIND, and prepareOut answers its realpath', () => {
    expect(t2Drv.OUT_MARKER).toBe('.ccrc-history-replay');
    expect(t2Drv.OUT_KIND).toBe('ccrc-history-replay-out');
    const b = base();
    const o = t2Path.join(b, 'out');
    expect(t2Drv.prepareOut(o)).toBe(t2Fs.realpathSync(o));
    expect(modeOf(o)).toBe('0700');
    const marker = t2Path.join(o, t2Drv.OUT_MARKER);
    expect(t2Fs.lstatSync(marker).isFile()).toBe(true);
    expect(modeOf(marker)).toBe('0600');
    expect(t2Fs.readFileSync(marker, 'utf8')).toBe(t2Drv.OUT_KIND);
    expect(t2Fs.readdirSync(o)).toEqual([t2Drv.OUT_MARKER]);
  });

  it('a clean reuse is accepted and keeps what is there: an interrupted batch resumes (W2-D53)', () => {
    const b = base();
    const o = made(b);
    t2Fs.writeFileSync(t2Path.join(o, 'finished.run.json'), '{}\n');
    expect(t2Drv.prepareOut(o)).toBe(o);
    expect(t2Drv.prepareOut(`${o}/`), 'a trailing slash names the same directory').toBe(o);
    expect(t2Fs.readdirSync(o).sort()).toEqual([t2Drv.OUT_MARKER, 'finished.run.json'].sort());
  });

  /** Each reuse that W2-D53 refuses, planted beside a fresh base: [what, plant -> the --out to pass, the detail]. */
  const REUSE: ReadonlyArray<readonly [string, (b: string) => string, string]> = [
    ['a symlink to a valid --out', (b) => { const l = t2Path.join(b, 'link'); t2Fs.symlinkSync(made(b), l); return l; }, 'symlink'],
    ['the same symlink named with a trailing slash', (b) => { const l = t2Path.join(b, 'link'); t2Fs.symlinkSync(made(b), l); return `${l}/`; }, 'symlink'],
    ['a dangling symlink', (b) => { const l = t2Path.join(b, 'link'); t2Fs.symlinkSync(t2Path.join(b, 'target'), l); return l; }, 'symlink'],
    ['a regular file', (b) => { const f = t2Path.join(b, 'out'); t2Fs.writeFileSync(f, ''); return f; }, 'not-directory'],
    ['mode 0750', (b) => { const o = made(b); t2Fs.chmodSync(o, 0o750); return o; }, 'mode 0750'],
    ['mode 0700 with the sticky bit', (b) => { const o = made(b); t2Fs.chmodSync(o, 0o1700); return o; }, 'mode 1700'],
    ['an empty 0700 directory with no marker', (b) => { const o = t2Path.join(b, 'out'); t2Fs.mkdirSync(o, { mode: 0o700 }); t2Fs.chmodSync(o, 0o700); return o; }, 'marker-absent'],
    ['a marker holding another word', (b) => { const o = made(b); t2Fs.writeFileSync(t2Path.join(o, t2Drv.OUT_MARKER), 'something-else'); return o; }, 'marker-mismatch'],
    ['a marker holding OUT_KIND and a newline', (b) => { const o = made(b); t2Fs.writeFileSync(t2Path.join(o, t2Drv.OUT_MARKER), `${t2Drv.OUT_KIND}\n`); return o; }, 'marker-mismatch'],
    ['a marker that is a directory', (b) => { const o = made(b); const m = t2Path.join(o, t2Drv.OUT_MARKER); t2Fs.rmSync(m); t2Fs.mkdirSync(m); return o; }, 'marker-mismatch'],
  ];

  it.each(REUSE)('W2-D53: %s is refused, and nothing is created in its place', (_what, plant, detail) => {
    const b = base();
    const o = plant(b);
    const before = t2Fs.readdirSync(b).sort();
    expect(refusalOf(() => t2Drv.prepareOut(o))).toEqual(out(detail));
    expect(t2Fs.readdirSync(b).sort(), 'the refusal created something').toEqual(before);
  });

  it('W2-D53: an --out another uid owns is refused foreign-owner (the uid is a parameter, so no second account is needed)', () => {
    const o = made(base());
    expect(refusalOf(() => t2Drv.prepareOut(o, process.getuid!() + 1))).toEqual(out('foreign-owner'));
    expect(t2Drv.prepareOut(o, process.getuid!()), 'CONTROL: the caller\'s own uid is accepted').toBe(o);
  });

  it('a relative --out is refused, and a missing parent is never created: no recursive create', () => {
    expect(refusalOf(() => t2Drv.prepareOut('rel/out'))).toEqual(out('relative'));
    expect(refusalOf(() => t2Drv.prepareOut(''))).toEqual(out('relative'));
    const b = base();
    expect(refusalOf(() => t2Drv.prepareOut(t2Path.join(b, 'no', 'such', 'out')))).toEqual(out('parent-absent'));
    expect(t2Fs.existsSync(t2Path.join(b, 'no')), 'a missing parent was created').toBe(false);
  });

  it.skipIf(asRoot)('an ancestor the walk cannot lstat is unmeasured, and unmeasured refuses: never read as outside', () => {
    const b = base();
    const locked = t2Path.join(b, 'locked');
    t2Fs.mkdirSync(locked);
    t2Fs.chmodSync(locked, 0o000);
    try {
      const o = t2Path.join(locked, 'out');
      expect(t2Drv.insideGitTree(o)).toEqual({ state: 'unmeasured', at: o, code: 'EACCES' });
      expect(refusalOf(() => t2Drv.prepareOut(o))).toEqual(out(`git-unmeasured ${o} EACCES`));
    } finally {
      t2Fs.chmodSync(locked, 0o700);
    }
    expect(t2Fs.readdirSync(locked), 'the refused --out was created').toEqual([]);
  });

  it('main sets umask 077 before any file act: a file the handler writes with the default mode lands 0600 (child process)', () => {
    const b = base();
    const o = t2Path.join(b, 'out');
    // A handler registered for this case only, in a child that starts under umask 022: only main's own umask can
    // make the probe 0600. Argv arrays, never a shell.
    const code = [
      `const d = await import(${JSON.stringify(t2FileUrl(T2_SCRIPT).href)});`,
      'const fs = await import(\'node:fs\');',
      'process.umask(0o022);',
      'd.HANDLERS.set(\'t2-umask\', async (flags) => { const real = d.prepareOut(flags.out); fs.writeFileSync(real + \'/probe\', \'x\'); return 0; });',
      `process.exitCode = await d.main(['t2-umask', '--out', ${JSON.stringify(o)}], { HOME: ${JSON.stringify(b)} });`,
    ].join('\n');
    const r = t2SpawnSync(process.execPath, ['--input-type=module', '-e', code],
      { encoding: 'utf8', env: { ...t2Scrubbed(process.env), HOME: b }, timeout: 60_000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(modeOf(t2Path.join(o, 'probe')), 'main set no umask 077 before the handler').toBe('0600');
    expect(modeOf(o)).toBe('0700');
  });

  it('the driver sets its umask once, to 077', () => {
    const src = t2Fs.readFileSync(T2_SCRIPT, 'utf8');
    expect(src.match(/process\.umask\(/g) ?? []).toHaveLength(1);
    expect(src).toContain('process.umask(0o077);');
  });
});
