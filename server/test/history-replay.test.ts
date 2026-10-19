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
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { REPO, scrubbedEnv } from './historyHelpers.js';
import { EXIT, REASONS } from '../../ccd/history/lib.mjs';
import * as replay from '../../deploy/history-replay.mjs';
import { DriverRefusal, admitAccount, readRoster } from '../../deploy/history-replay.mjs';
// W2-4 Task 2 (the --out rule, W2-D53, RP4): aliased, so no name here collides with an import above.
import * as t2Fs from 'node:fs';
import * as t2Path from 'node:path';
import { spawnSync as t2SpawnSync } from 'node:child_process';
import { pathToFileURL as t2FileUrl } from 'node:url';
import * as t2Drv from '../../deploy/history-replay.mjs';
import { mkTmp as t2MkTmp } from './tmpHelpers.js';
import { scrubbedEnv as t2Scrubbed } from './historyHelpers.js';
// ── W2-4 Task 4: imports under t4 aliases, so no binding collides with Tasks 1–3 above ───────────────────────────
import * as t4Fs from 'node:fs';
import * as t4Lib from '../../ccd/history/lib.mjs';
import * as t4Replay from '../../deploy/history-replay.mjs';
import { mkTmp as t4MkTmp } from './tmpHelpers.js';
import * as t5fs from 'node:fs';
import * as t5os from 'node:os';
import * as t5path from 'node:path';
import { spawnSync as t5spawnSync } from 'node:child_process';
import { afterEach as t5afterEach, vi as t5vi } from 'vitest';
import * as t5drv from '../../deploy/history-replay.mjs';
import { generateWrapperBody as t5WrapperBody } from '../../shared/wrapper.mjs';
import { mkTmp as t5MkTmp } from './tmpHelpers.js';

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

// ── W2-4 Task 3: account admission from the roster, before any spawn (W2-D52; RP3-admission, RP9) ─────────────────
// Function level, on fixture HOMEs only. The 'before any spawn' half of RP3 and RP9 (the stub's log absent, no stream
// file under --out) is Task 8's, through the step0a subcommand. No fixture holds a key: admission never opens a
// secrets file, so each one holds a comment line.
// The three declarations below are MODULE-LEVEL: Tasks 5, 6, 8 and 9 call writeRoster, and Task 8 rosters
// FIXTURE_ACCOUNTS, from their own describes.

/** One roster account in rosterFromJson's grammar; `extra` overrides the defaults. */
const fixtureAccount = (id: string, exec: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, label: id, configDirSuffix: `.${id}`, exec, homeAble: false, telemetry: 'none', ...extra });
/** The twelve fixture rows. gen-u declares no provider, so it reads as anthropic (the roster's default, ruled). */
const FIXTURE_ACCOUNTS = [
  fixtureAccount('up-a', { kind: 'upstream' }, { configDirSuffix: '.claude', homeAble: true, telemetry: 'anthropic' }),
  fixtureAccount('gen-a', { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-a.env' }),
  fixtureAccount('gen-o', { kind: 'generated', provider: 'openai', secretsFile: '.cc-secrets/gen-o.env' }),
  fixtureAccount('cx-a', { kind: 'codex', provider: 'openai', proxyPort: 41001, litellmPort: 41002, authDir: '.cx-a-auth' }),
  fixtureAccount('ext-n', { kind: 'external' }),
  fixtureAccount('ext-a', { kind: 'external', provider: 'anthropic', secretsFile: '.cc-secrets/ext-a.env' }),
  fixtureAccount('gen-h', { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-h.env' }, { hidden: true }),
  fixtureAccount('gen-u', { kind: 'generated', secretsFile: '.cc-secrets/gen-u.env' }),
  fixtureAccount('gen-s', { kind: 'generated', provider: 'anthropic' }),
  fixtureAccount('gen-m', { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-m.env' }),
  fixtureAccount('gen-r', { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-r.env' }),
  fixtureAccount('gen-d', { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-d.env' }),
];
/** `$HOME/.ccrc/accounts.json`, as the operator's roster. */
function writeRoster(home: string, accounts: object[]): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.ccrc', 'accounts.json'), `${JSON.stringify({ version: 1, accounts }, null, 2)}\n`);
}

describe('W2-4 Task 3: account admission from the roster (W2-D52, RP3-admission, RP9)', () => {
  const ADMIT_DRIVER = fileURLToPath(new URL('../../deploy/history-replay.mjs', import.meta.url));
  const IS_ROOT = (process.getuid?.() ?? 1) === 0;
  const SECRETS_TEXT = '# fixture secrets file: admission stats it and never opens it\n';
  const acct = fixtureAccount;
  const ACCOUNTS = FIXTURE_ACCOUNTS;
  /** A fixture HOME with ACCOUNTS rostered. Every declared secrets file is a readable regular file except gen-m's
   *  (never planted), gen-r's (mode 000) and gen-d's (a directory). A secrets file is planted even where the row is
   *  refused for something else, so each refusal below is that row's own and never a missing file's. */
  function admitHome(): string {
    const home = mkTmp('ccrc-replay-admit-');
    writeRoster(home, ACCOUNTS);
    mkdirSync(join(home, '.cc-secrets'), { mode: 0o700 });
    for (const id of ['gen-a', 'gen-o', 'ext-a', 'gen-h', 'gen-u', 'gen-r']) {
      writeFileSync(join(home, '.cc-secrets', `${id}.env`), SECRETS_TEXT, { mode: 0o600 });
    }
    chmodSync(join(home, '.cc-secrets', 'gen-r.env'), 0o000);
    mkdirSync(join(home, '.cc-secrets', 'gen-d.env'));
    return home;
  }
  /** A DriverRefusal as {word, detail}, or 'passed'; anything else is rethrown. */
  function refusalOf(f: () => unknown): { word: string; detail: string } | 'passed' {
    try {
      f();
      return 'passed';
    } catch (e) {
      if (e instanceof DriverRefusal) return { word: e.word, detail: e.detail };
      throw e;
    }
  }
  /** admitAccount's verdict on `id` over one readRoster of `home`. */
  function verdict(home: string, id: string): { word: string; detail: string } | 'passed' {
    const { json, roster } = readRoster(home);
    return refusalOf(() => admitAccount(json, roster, id, home));
  }

  it('readRoster parses the file once and answers the parsed object beside its validation', () => {
    const home = admitHome();
    const { json, roster } = readRoster(home);
    expect((json as { accounts: Array<{ id: string }> }).accounts.map((a) => a.id)).toEqual(ACCOUNTS.map((a) => a['id']));
    expect((json as { accounts: Array<{ hidden?: boolean }> }).accounts[6]!.hidden, 'hidden is read from the parsed object').toBe(true);
    expect(roster.upstreamId).toBe('up-a');
    expect(Object.keys(roster.accounts[6]!), 'rosterFromJson returns no hidden: why admission reads the parsed object').not.toContain('hidden');
  });

  it('readRoster refuses roster-invalid: absent, unreadable with its code, not JSON, and RosterInvalid with its message', () => {
    const absent = mkTmp('ccrc-replay-roster-');
    expect(refusalOf(() => readRoster(absent))).toEqual({ word: 'roster-invalid', detail: 'absent' });
    const dir = mkTmp('ccrc-replay-roster-');
    mkdirSync(join(dir, '.ccrc', 'accounts.json'), { recursive: true });
    expect(refusalOf(() => readRoster(dir))).toEqual({ word: 'roster-invalid', detail: 'unreadable EISDIR' });
    const garbled = mkTmp('ccrc-replay-roster-');
    mkdirSync(join(garbled, '.ccrc'));
    writeFileSync(join(garbled, '.ccrc', 'accounts.json'), '{"version": 1, "accounts": [');
    expect(refusalOf(() => readRoster(garbled))).toEqual({ word: 'roster-invalid', detail: 'not-json' });
    const twoUp = mkTmp('ccrc-replay-roster-');
    writeRoster(twoUp, [ACCOUNTS[0]!, acct('up-b', { kind: 'upstream' })]);
    expect(refusalOf(() => readRoster(twoUp))).toEqual({
      word: 'roster-invalid',
      detail: 'the roster has 2 upstream accounts: exactly one account must have exec.kind "upstream".',
    });
  });

  it('admits upstream and generated/anthropic (RP3), each with its launch path and config dir from the roster; a generated account with no declared provider reads as anthropic', () => {
    const home = admitHome();
    const { json, roster } = readRoster(home);
    expect(admitAccount(json, roster, 'up-a', home)).toEqual({
      accountId: 'up-a', kind: 'upstream', launcher: join(home, '.local', 'bin', 'up-a'),
      configDir: join(home, '.claude'), wrapperPath: null, secretsPath: null,
    });
    expect(admitAccount(json, roster, 'gen-a', home)).toEqual({
      accountId: 'gen-a', kind: 'generated', launcher: join(home, '.local', 'bin', 'gen-a'),
      configDir: join(home, '.gen-a'), wrapperPath: join(home, '.local', 'bin', 'gen-a'),
      secretsPath: join(home, '.cc-secrets', 'gen-a.env'),
    });
    // gen-u declares no provider: the roster's own default reads it as anthropic (coordinator ruling), so it is admitted.
    expect(admitAccount(json, roster, 'gen-u', home)).toEqual({
      accountId: 'gen-u', kind: 'generated', launcher: join(home, '.local', 'bin', 'gen-u'),
      configDir: join(home, '.gen-u'), wrapperPath: join(home, '.local', 'bin', 'gen-u'),
      secretsPath: join(home, '.cc-secrets', 'gen-u.env'),
    });
  });

  const REFUSED: Array<[string, string, string]> = [
    ['cx-a', 'kind-codex', 'a codex account (RP3)'],
    ['ext-n', 'kind-external', 'an external account with no declared provider (RP3)'],
    ['ext-a', 'kind-external', 'an external account declaring anthropic, its secrets file readable (RP3)'],
    ['gen-o', 'provider-openai', 'a generated account declaring openai, its secrets file readable (RP3)'],
    ['gen-h', 'hidden', 'a hidden generated/anthropic account, its secrets file readable'],
    ['gen-s', 'secrets-undeclared', 'a generated/anthropic account with no declared secretsFile'],
    ['gen-m', 'secrets-absent', 'a declared secretsFile that is absent (RP9)'],
    ['gen-d', 'secrets-not-regular', 'a declared secretsFile that is a directory (RP9)'],
    ['nobody', 'unknown-id', 'an id the roster does not hold'],
  ];
  it.each(REFUSED)('%s is refused account-refused %s: %s', (id, detail) => {
    expect(verdict(admitHome(), id)).toEqual({ word: 'account-refused', detail });
  });

  it.skipIf(IS_ROOT)('a declared secretsFile this user cannot read is refused secrets-unreadable (RP9; skipped as root)', () => {
    expect(verdict(admitHome(), 'gen-r')).toEqual({ word: 'account-refused', detail: 'secrets-unreadable' });
  });

  it('the secretsFile is stat\'ed through a symlink, as the wrapper\'s [ -r ] reads it: to a readable file admitted, dangling absent', () => {
    const home = admitHome();
    const real = join(home, 'elsewhere.env');
    writeFileSync(real, SECRETS_TEXT, { mode: 0o600 });
    symlinkSync(real, join(home, '.cc-secrets', 'gen-m.env'));
    expect(verdict(home, 'gen-m')).toBe('passed');
    const dangling = admitHome();
    symlinkSync(join(dangling, 'nowhere.env'), join(dangling, '.cc-secrets', 'gen-m.env'));
    expect(verdict(dangling, 'gen-m')).toEqual({ word: 'account-refused', detail: 'secrets-absent' });
  });

  it('an upstream account whose config dir is not exactly $HOME/.claude is refused upstream-config-dir', () => {
    const home = mkTmp('ccrc-replay-admit-');
    writeRoster(home, [acct('up-b', { kind: 'upstream' }, { homeAble: true, telemetry: 'anthropic' })]);
    expect(verdict(home, 'up-b')).toEqual({ word: 'account-refused', detail: 'upstream-config-dir' });
  });

  // The json/roster disagreement is the caller's defect, never an account's refusal: a TypeError (main answers exit 1),
  // not a DriverRefusal (exit 2). Both halves: a row whose exec kind differs from the roster's, and a row that is gone
  // (D-5801: the plan's interface states this guard, and its test block had no case for it).
  it('a parsed json that disagrees with its roster about an account is a TypeError, never a refusal (caller defect)', () => {
    const home = admitHome();
    const { json, roster } = readRoster(home);
    const kindSwapped = structuredClone(json);
    kindSwapped.accounts.find((a: { id: string }) => a.id === 'up-a').exec.kind = 'generated';
    const rowGone = structuredClone(json);
    rowGone.accounts = rowGone.accounts.filter((a: { id: string }) => a.id !== 'up-a');
    for (const bad of [kindSwapped, rowGone]) {
      let thrown: unknown = null;
      try {
        admitAccount(bad, roster, 'up-a', home);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect(thrown).not.toBeInstanceOf(DriverRefusal);
    }
    // CONTROL: the undamaged pair admits the same account.
    expect(admitAccount(json, roster, 'up-a', home).kind).toBe('upstream');
  });

  // RP9's "no credentials file is read", measured: a FIFO with no writer blocks whoever opens it, so admission run in
  // a child with a deadline returns promptly only if it never opened one. CONTROL: a child that does open it is killed.
  // The driver URL rides the env, never argv: with `-e`, process.argv[1] stays unset, so the entry guard never runs main.
  const ADMIT_CHILD = [
    'const d = await import(process.env.ADMIT_DRIVER_URL);',
    'const home = process.env.HOME;',
    'const { json, roster } = d.readRoster(home);',
    'const out = {};',
    "for (const id of ['gen-m', 'gen-a', 'up-a']) {",
    '  try { out[id] = d.admitAccount(json, roster, id, home).kind; }',
    '  catch (e) { if (!(e instanceof d.DriverRefusal)) throw e; out[id] = e.detail; }',
    '}',
    'process.stdout.write(JSON.stringify(out));',
  ].join('\n');
  /** A FIFO at `<configDir>/.credentials.json` for gen-m, gen-a and up-a; the name is assembled, never spelled. */
  function plantCredentialFifos(home: string): string[] {
    const fifos = ['.gen-m', '.gen-a', '.claude'].map((dir) => join(home, dir, ['.credentials', 'json'].join('.')));
    for (const f of fifos) {
      mkdirSync(join(f, '..'), { recursive: true, mode: 0o700 });
      const r = spawnSync('mkfifo', [f], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(lstatSync(f).isFIFO()).toBe(true);
    }
    return fifos;
  }

  it('admission never opens a config dir\'s credentials file: planted as FIFOs, admission returns promptly (RP9)', () => {
    const home = admitHome();
    plantCredentialFifos(home);
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', ADMIT_CHILD], {
      env: { ...scrubbedEnv(process.env), HOME: home, ADMIT_DRIVER_URL: pathToFileURL(ADMIT_DRIVER).href },
      encoding: 'utf8', timeout: 15_000,
    });
    expect(r.signal, `admission blocked on a FIFO: ${r.stderr}`).toBeNull();
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ 'gen-m': 'secrets-absent', 'gen-a': 'generated', 'up-a': 'upstream' });
  });

  it('CONTROL: a child that opens one of those FIFOs is killed at its deadline, so the probe above can see a read', () => {
    const home = admitHome();
    const [fifo] = plantCredentialFifos(home);
    const r = spawnSync(process.execPath, ['-e', 'require("node:fs").readFileSync(process.argv[1])', fifo!], {
      env: { ...scrubbedEnv(process.env), HOME: home }, encoding: 'utf8', timeout: 2_000,
    });
    expect(r.signal).toBe('SIGTERM');
  });

  it('the driver never spells a credentials file name', () => {
    expect(readFileSync(ADMIT_DRIVER, 'utf8')).not.toMatch(/credentials\.json/);
  });
});

// ── W2-4 Task 4: spawned text, the stream-json reader and the spend ledger (W2-D54, W2-D51, W2-D55) ─────────────
// Pure or small: no spawn and no HOME. Redaction runs over a pair index the test builds with makePairIndex, standing
// in for the index W2-5a passes once per run. The secret is assembled at runtime from parts and never written whole.
// A mkTmp directory stands in for --out.
describe('W2-4 Task 4: spawned text, the stream-json reader and the spend ledger', () => {
  const SECRET = ['q7v', 'k2m9', 'x4p8', 'w3n6', 'z5r1', 'h8t2', 'j6y4', 'c9d3', 'b1f7', 'g5s'].join('');
  const IDX = t4Lib.makePairIndex([{ len: SECRET.length, sha256: t4Lib.sha256Hex(SECRET) }]);
  /** A tool_result whose secret starts 20 code points before the cut and ends 18 after it, with text after it, so the
   *  cut bites after redaction too. */
  const STRADDLE = `${'a '.repeat(1990)}${SECRET} ${'b '.repeat(100)}`;
  const field = (text: string, rawLen: number = Buffer.byteLength(text)) => ({ text, rawLen });
  const points = (s: string): number => Array.from(s).length;
  /** The text of a 'text' answer; any other answer fails the case. */
  const textOf = (r: { state: string }): string => {
    expect(r.state).toBe('text');
    return (r as unknown as { text: string }).text;
  };

  it('the fixture straddles the cut: the secret starts before code point 4,000 and ends after it', () => {
    expect(t4Replay.TOOL_RESULT_CUT).toBe(4000);
    const at = STRADDLE.indexOf(SECRET);
    expect(at).toBeLessThan(t4Replay.TOOL_RESULT_CUT);
    expect(at + SECRET.length).toBeGreaterThan(t4Replay.TOOL_RESULT_CUT);
  });

  it('W2-D54 order: a secret straddling code point 4,000 is redacted whole before the cut, and no prefix of it survives', () => {
    const text = textOf(t4Replay.toolResultText(field(STRADDLE), IDX));
    expect(text, "the secret's head survived the cut").not.toContain(SECRET.slice(0, 6));
    expect(text).toContain(t4Lib.REDACTED_MARK);
    expect(points(text)).toBe(t4Replay.TOOL_RESULT_CUT);
    // CONTROL: cut first and redact afterwards, and the head the cut leaves matches no (length, sha256) pair.
    expect(t4Lib.redactField(t4Replay.cutToolResult(STRADDLE), IDX)).toContain(SECRET.slice(0, 20));
  });

  it('redactForSpawn passes the WHOLE field through redactField and never cuts it', () => {
    const long = `${'c '.repeat(4000)}${SECRET} end`;
    const r = t4Replay.redactForSpawn(field(long), IDX);
    expect(r).toEqual({ state: 'text', text: t4Lib.redactField(long, IDX) });
    expect(textOf(r)).not.toContain(SECRET);
    expect(points(textOf(r))).toBeGreaterThan(t4Replay.TOOL_RESULT_CUT);
  });

  it('a field over blobOverDecodeCap is discarded, never truncated or decoded; at the cap it is redacted', () => {
    const over = t4Lib.BLOB_DECODE_MAX + 1;
    const discard = { state: 'discard', why: 'over-decode-cap' };
    expect(t4Replay.redactForSpawn(field(STRADDLE, over), IDX)).toEqual(discard);
    expect(t4Replay.toolResultText(field(STRADDLE, over), IDX)).toEqual(discard);
    expect(t4Replay.redactForSpawn({ text: STRADDLE, rawLen: '12' as unknown as number }, IDX), "a non-numeric raw_len is over the cap, as lib's reader holds")
      .toEqual(discard);
    expect(t4Replay.redactForSpawn(field('ok', t4Lib.BLOB_DECODE_MAX), IDX)).toEqual({ state: 'text', text: 'ok' });
  });

  it('cutToolResult keeps the first 4,000 code points and never splits a surrogate pair', () => {
    const astral = String.fromCodePoint(0x1f600);
    const cut = t4Replay.cutToolResult(astral.repeat(4001));
    expect(points(cut)).toBe(4000);
    expect(cut.length).toBe(8000);
    expect(t4Replay.cutToolResult(`${'a'.repeat(3999)}${astral}tail`)).toBe(`${'a'.repeat(3999)}${astral}`);
    expect(t4Replay.cutToolResult('short')).toBe('short');
  });

  it("the driver never names lib's display-window redaction (CONTROL: the pattern sees a planted line)", () => {
    const NAME = /\bredactDisplayWindow\b/;
    expect(NAME.test("import { redactDisplayWindow } from '../ccd/history/lib.mjs';")).toBe(true);
    expect(t4Fs.readFileSync(new URL('../../deploy/history-replay.mjs', import.meta.url), 'utf8')).not.toMatch(NAME);
  });

  // ── the stream-json reader ──
  const SID = '4d1c9e2a-7b3f-4a6c-9d8e-1f2a3b4c5d6e';
  /** Stream lines: an object is one JSON line, a string is written as it is. */
  const lines = (...events: unknown[]): string => `${events.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n')}\n`;
  const usage = (input: number, cacheCreation: number, cacheRead: number, output: number) =>
    ({ input_tokens: input, cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: cacheRead, output_tokens: output });
  /** An init event with no `plugins` field: absent, so it must read null. `mcp_servers` is present and empty. */
  const INIT = { type: 'system', subtype: 'init', session_id: SID, model: 'model-a', tools: ['Bash', 'Agent'], mcp_servers: [], skills: ['ccrc-history'], slash_commands: ['compact'] };
  /** One assistant message written as two content-block events, each repeating the message's id and usage. */
  const A1_TEXT = { type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'running it' }], usage: usage(10, 20, 30, 4) } };
  const A1_TOOL = { type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'true' } }], usage: usage(10, 20, 30, 4) } };
  const U1 = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: false }] } };
  const A2 = { type: 'assistant', message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'done' }], usage: usage(1, 2, 3, 5) } };
  const DENIAL = { tool_name: 'Bash', tool_use_id: 'toolu_9', tool_input: { command: 'cat x' } };
  const RESULT = { type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: 'done', usage: usage(100, 200, 300, 40), permission_denials: [DENIAL] };
  const STREAM = lines(INIT, A1_TEXT, A1_TOOL, U1, 'not json {', A2, RESULT);

  it('the init event: each field as the stream carried it, and a field it did not carry reads null', () => {
    expect(t4Replay.readStreamJson(STREAM).init).toEqual({
      sessionId: SID, model: 'model-a', tools: ['Bash', 'Agent'], mcpServers: [], plugins: null, skills: ['ccrc-history'], slashCommands: ['compact'],
    });
    expect(t4Replay.readStreamJson(lines({ type: 'system', subtype: 'init' })).init)
      .toEqual({ sessionId: null, model: null, tools: null, mcpServers: null, plugins: null, skills: null, slashCommands: null });
  });

  it('the rest of the stream: one tool pair by id, the result event, its permission denial, its usage, the message count and the malformed line', () => {
    const f = t4Replay.readStreamJson(STREAM);
    expect(f.toolPairs).toEqual([{ id: 'toolu_1', name: 'Bash', input: { command: 'true' }, result: 'ok', isError: false }]);
    expect(f.result).toEqual({ subtype: 'success', isError: false, numTurns: 2, text: 'done' });
    expect(f.permissionDenials).toEqual([DENIAL]);
    expect(f.usageSource).toBe('result');
    expect(f.usage).toEqual({ input: 100, cacheCreation: 200, cacheRead: 300, output: 40 });
    expect(f.assistantMessages).toBe(2);
    expect(f.malformedLines).toBe(1);
    expect(t4Replay.spendTokens(f)).toBe(640);
  });

  it("with no result event, usage is the assistant messages' summed once per message.id, and there is no result or denial list", () => {
    const f = t4Replay.readStreamJson(lines(INIT, A1_TEXT, A1_TOOL, U1, A2));
    expect(f.usageSource).toBe('assistant');
    expect(f.usage).toEqual({ input: 11, cacheCreation: 22, cacheRead: 33, output: 9 });
    expect(f.assistantMessages).toBe(2);
    expect(f.result).toBeNull();
    expect(f.permissionDenials).toBeNull();
    expect(t4Replay.spendTokens(f)).toBe(75);
  });

  it('an empty stream is no init, no result and no usage: zeros with usageSource none', () => {
    expect(t4Replay.readStreamJson('')).toEqual({
      init: null, usage: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 }, usageSource: 'none', toolPairs: [],
      permissionDenials: null, result: null, assistantMessages: 0, malformedLines: 0,
    });
  });

  it('a line that is not a JSON object is counted, and odd shapes never throw', () => {
    const f = t4Replay.readStreamJson(lines('42', 'null', '[1]', '{"type":',
      { type: 'assistant' }, { type: 'assistant', message: { content: 'text' } },
      { type: 'user', message: { content: [null, 5, { type: 'tool_result' }] } },
      { type: 'system', subtype: 'init', tools: 'Bash' }, { type: 'result', num_turns: '3', usage: null }));
    expect(f.malformedLines).toBe(4);
    expect(f.init?.tools).toBeNull();
    expect(f.result).toEqual({ subtype: null, isError: null, numTurns: null, text: null });
    expect(f.usageSource).toBe('none');
    expect(f.toolPairs).toEqual([]);
  });

  // D-5802: the brief's odd-shapes list states sjCount's fold to 0, and its test block had no case that reds without it.
  it('a usage count that is not a non-negative integer reads 0, and an absent cache key reads 0, so spend stays a finite sum', () => {
    const odd = t4Replay.readStreamJson(lines(
      { type: 'result', usage: { input_tokens: '7', cache_creation_input_tokens: -3, cache_read_input_tokens: 1.5, output_tokens: 2 } }));
    expect(odd.usageSource).toBe('result');
    expect(odd.usage).toEqual({ input: 0, cacheCreation: 0, cacheRead: 0, output: 2 });
    expect(t4Replay.spendTokens(odd)).toBe(2);
    const bare = t4Replay.readStreamJson(lines(
      { type: 'assistant', message: { id: 'msg_4', usage: { input_tokens: 5, output_tokens: 2 } } }));
    expect(bare.usageSource).toBe('assistant');
    expect(bare.usage).toEqual({ input: 5, cacheCreation: 0, cacheRead: 0, output: 2 });
    expect(t4Replay.spendTokens(bare)).toBe(7);
  });

  it('a tool_result in content blocks joins its text blocks, an absent is_error reads null, and a result with no tool_use pairs nothing', () => {
    const f = t4Replay.readStreamJson(lines(
      { type: 'assistant', message: { id: 'msg_3', content: [{ type: 'tool_use', id: 'toolu_3', name: 'Agent', input: { prompt: 'look' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_3', content: [{ type: 'text', text: 'one' }, { type: 'image' }, { type: 'text', text: 'two' }] }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_stray', content: 'stray' }] } },
    ));
    expect(f.toolPairs).toEqual([{ id: 'toolu_3', name: 'Agent', input: { prompt: 'look' }, result: 'one\ntwo', isError: null }]);
    expect(f.assistantMessages).toBe(1);
    expect(f.usageSource).toBe('none');
  });

  // ── the spend ledger ──
  const ledger = (out: string): string => `${out}/${t4Replay.SPEND_LEDGER}`;
  /** The word and detail of the DriverRefusal `f` throws, or null when it returns. */
  const refusalOf = (f: () => unknown): { word: string; detail: string } | null => {
    try { f(); } catch (e) {
      expect(e).toBeInstanceOf(t4Replay.DriverRefusal);
      const r = e as { word: string; detail: string };
      return { word: r.word, detail: r.detail };
    }
    return null;
  };
  const CLOSED = { word: 'budget-exhausted', detail: 'ledger-unreadable' };
  const GOOD = '{"name":"a","tokens":1,"ts_ms":1}\n';

  it('the ledger: absent is 0; one canonical line per finished spawn, mode 0600; summed over every line, a repeated name included', () => {
    const out = t4MkTmp('ccrc-replay-t4-ledger-');
    expect(t4Fs.existsSync(ledger(out))).toBe(false);
    expect(t4Replay.spentSoFar(out)).toBe(0);
    t4Replay.recordSpend(out, 'step0a/writer', 100);
    t4Replay.recordSpend(out, 'step0a/judge', 50);
    t4Replay.recordSpend(out, 'step0a/writer', 120);   // a resumed batch re-ran this job: both spawns spent
    expect(t4Replay.spentSoFar(out), 'a re-run adds to the total, never replaces it').toBe(270);
    const rows = t4Fs.readFileSync(ledger(out), 'utf8').split('\n');
    expect(rows).toHaveLength(4);
    expect(rows[3]).toBe('');
    expect(rows[0]).toMatch(/^\{"name":"step0a\/writer","tokens":100,"ts_ms":[0-9]+\}$/);
    expect(t4Fs.statSync(ledger(out)).mode & 0o777).toBe(0o600);
  });

  it('recordSpend refuses a name or a count it could not read back, and writes nothing', () => {
    const out = t4MkTmp('ccrc-replay-t4-record-');
    expect(() => t4Replay.recordSpend(out, '', 1)).toThrow(/^recordSpend: /);
    expect(() => t4Replay.recordSpend(out, 'x', -1)).toThrow(/^recordSpend: /);
    expect(() => t4Replay.recordSpend(out, 'x', 1.5)).toThrow(/^recordSpend: /);
    expect(() => t4Replay.recordSpend(out, 'x', Number.NaN)).toThrow(/^recordSpend: /);
    expect(t4Fs.existsSync(ledger(out))).toBe(false);
  });

  it.each([
    ['a torn last line', `${GOOD}{"name":"b","tok`],
    ['a line that is not JSON', `${GOOD}not json\n`],
    ['a blank line', `${GOOD}\n${GOOD}`],
    ['a JSON array', `${GOOD}[1]\n`],
    ['a negative count', `${GOOD}{"name":"b","tokens":-1,"ts_ms":1}\n`],
    ['a fractional count', `${GOOD}{"name":"b","tokens":1.5,"ts_ms":1}\n`],
    ['an extra key', `${GOOD}{"name":"b","tokens":1,"ts_ms":1,"x":0}\n`],
    ['a missing key', `${GOOD}{"name":"b","tokens":1}\n`],
    ['an empty name', `${GOOD}{"name":"","tokens":1,"ts_ms":1}\n`],
  ])('a malformed ledger (%s) fails closed as budget-exhausted, never a count', (_why, body) => {
    const out = t4MkTmp('ccrc-replay-t4-malformed-');
    t4Fs.writeFileSync(ledger(out), body);
    expect(refusalOf(() => t4Replay.spentSoFar(out))).toEqual(CLOSED);
  });

  it('a ledger that is a directory, or a symlink to a readable ledger, fails closed too', () => {
    const dir = t4MkTmp('ccrc-replay-t4-dir-');
    t4Fs.mkdirSync(ledger(dir));
    expect(refusalOf(() => t4Replay.spentSoFar(dir))).toEqual(CLOSED);
    const link = t4MkTmp('ccrc-replay-t4-link-');
    t4Fs.writeFileSync(`${link}/elsewhere`, GOOD);
    t4Fs.symlinkSync(`${link}/elsewhere`, ledger(link));
    expect(refusalOf(() => t4Replay.spentSoFar(link))).toEqual(CLOSED);
  });

  it.skipIf(process.getuid?.() === 0)('an unreadable ledger fails closed (skipped as root, which reads it anyway)', () => {
    const out = t4MkTmp('ccrc-replay-t4-unreadable-');
    t4Fs.writeFileSync(ledger(out), GOOD);
    t4Fs.chmodSync(ledger(out), 0o000);
    expect(refusalOf(() => t4Replay.spentSoFar(out))).toEqual(CLOSED);
  });
});

// ── W2-4 Task 5: the spawn contract and the batch runner (W2-D50, W2-D51, W2-D53, W2-D55; RP1-contract) ────────
// Every spawn reaches a recording stub, a node script at `$HOME/.local/bin/up-a` (the fixture upstream), never a
// real Claude Code. The generated account's launcher is the real wrapper text from generateWrapperBody, which
// sources a fixture secrets file and execs the same stub, so the generated case runs through its own wrapper.
// The stub logs one JSON line per run: argv, env key names, every env value except CLAUDE_CODE_OAUTH_TOKEN, cwd,
// the cwd's mode and entries, stdin, and start and end stamps; then it prints STUB_STREAM on stdout. It finds its
// fixture home from its own path (`<home>/.local/bin/<id>`), never from $HOME, so a mutant that leaks the
// caller's env still logs inside the fixture and never writes to the HOME running the suite.

/** The file the stub prints as its stream-json. */
const STUB_STREAM = 'stub-stream.jsonl';
const T5_STUB_LOG = 'stub-log.jsonl';
type T5Launch = ReturnType<typeof t5drv.admitAccount>;
type T5Job = Parameters<typeof t5drv.launchRun>[0];
/** Optional stub controls, each a file under $HOME: sleep before exiting, text for stderr, an exit code. */
const T5_STUB_SLEEP = 'stub-sleep-ms';
const T5_STUB_STDERR = 'stub-stderr.txt';
const T5_STUB_EXIT = 'stub-exit';
const T5_STUB_SOURCE = `#!/usr/bin/env node
(async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const start = Date.now();
  const home = path.resolve(path.dirname(process.argv[1]), '..', '..');
  const at = (f) => path.join(home, f);
  const opt = (f) => { try { return fs.readFileSync(at(f), 'utf8'); } catch { return null; } };
  const stdin = fs.readFileSync(0, 'utf8');
  const cwd = process.cwd();
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (k !== 'CLAUDE_CODE_OAUTH_TOKEN') env[k] = v;
  const cwdMode = fs.statSync(cwd).mode & 0o777;
  const cwdEntries = fs.readdirSync(cwd);
  const sleep = Number(opt(${JSON.stringify(T5_STUB_SLEEP)}) ?? '0');
  if (sleep > 0) await new Promise((r) => setTimeout(r, sleep));
  const err = opt(${JSON.stringify(T5_STUB_STDERR)});
  if (err !== null) process.stderr.write(err);
  fs.appendFileSync(at(${JSON.stringify(T5_STUB_LOG)}), JSON.stringify({ argv: process.argv.slice(2),
    envKeys: Object.keys(process.env).sort(), env, cwd, cwdMode, cwdEntries, stdin, start, end: Date.now() }) + '\\n');
  process.stdout.write(opt(${JSON.stringify(STUB_STREAM)}) ?? '');
  process.exitCode = Number(opt(${JSON.stringify(T5_STUB_EXIT)}) ?? '0');
})();
`;

/** A canned stream-json: init, one assistant message, a result whose usage sums to 65. */
const T5_STREAM = [
  { type: 'system', subtype: 'init', session_id: 'fixture-session-id', model: 'fixture-model', tools: [], mcp_servers: [], plugins: [], skills: [], slash_commands: [] },
  { type: 'assistant', message: { id: 'msg-fixture-1', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'ok' }] } },
  { type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ok', permission_denials: [],
    usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 } },
].map((e) => JSON.stringify(e)).join('\n') + '\n';
const T5_TOKENS = 65;

/** Plant the recording stub at `$HOME/.local/bin/<id>` (mode 0700) and the default STUB_STREAM. */
function plantStub(home: string, id: string): void {
  const bin = t5path.join(home, '.local', 'bin');
  t5fs.mkdirSync(bin, { recursive: true });
  t5fs.writeFileSync(t5path.join(bin, id), T5_STUB_SOURCE, { mode: 0o700 });
  if (!t5fs.existsSync(t5path.join(home, STUB_STREAM))) t5fs.writeFileSync(t5path.join(home, STUB_STREAM), T5_STREAM);
}

type T5Log = { argv: string[]; envKeys: string[]; env: Record<string, string>; cwd: string; cwdMode: number;
  cwdEntries: string[]; stdin: string; start: number; end: number };
/** Every line the stub logged, in order, or null when it never ran. */
function stubLog(home: string): T5Log[] | null {
  const p = t5path.join(home, T5_STUB_LOG);
  if (!t5fs.existsSync(p)) return null;
  return t5fs.readFileSync(p, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as T5Log);
}

/** The fixture OAuth token, assembled at runtime so no key-shaped literal sits in the tree. */
const T5_TOKEN = ['sk', 'ant', 'oat01'].join('-') + '-' + ['FIXTURE', 'TASK5', 'x'.repeat(24)].join('');

/** A home with up-a (upstream, the stub) and gen-a (generated/anthropic: its real wrapper, its secrets file),
 *  an admitted LaunchSpec for each, and a prepared --out. */
function t5Box(prefix: string): { home: string; out: string; up: T5Launch; gen: T5Launch } {
  const home = t5MkTmp(prefix);
  writeRoster(home, [
    { id: 'up-a', label: 'Up A', configDirSuffix: '.claude', homeAble: true, telemetry: 'anthropic', exec: { kind: 'upstream' } },
    { id: 'gen-a', label: 'Gen A', configDirSuffix: '.gen-a', homeAble: true, telemetry: 'anthropic',
      exec: { kind: 'generated', provider: 'anthropic', secretsFile: '.cc-secrets/gen-a.env' } },
  ]);
  plantStub(home, 'up-a');
  t5fs.writeFileSync(t5path.join(home, '.local', 'bin', 'gen-a'),
    t5WrapperBody({ id: 'gen-a', configDirSuffix: '.gen-a', execKind: 'generated', secretsFile: '.cc-secrets/gen-a.env' }, 'up-a'),
    { mode: 0o700 });
  t5fs.mkdirSync(t5path.join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
  t5fs.writeFileSync(t5path.join(home, '.cc-secrets', 'gen-a.env'), `export CLAUDE_CODE_OAUTH_TOKEN=${T5_TOKEN}\n`, { mode: 0o600 });
  const { json, roster: parsed } = t5drv.readRoster(home);
  return {
    home, out: t5drv.prepareOut(t5path.join(home, 'out')),
    up: t5drv.admitAccount(json, parsed, 'up-a', home), gen: t5drv.admitAccount(json, parsed, 'gen-a', home),
  };
}

const T5_RECALL = { session: 'fixture-recall-session', arm: 'fixture-arm-value', asof: 'fixture-asof-uuid' };
/** An explicit no-op gate: runBatch requires one, and these cases test the runner, not Task 6's stop. */
const T5_NO_GATE = (): void => {};
const T5_BASE_KEYS = ['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH'];
const T5_RECALL_KEYS = ['CCRC_RECALL_ARM', 'CCRC_RECALL_ASOF', 'CCRC_RECALL_SESSION'];
/** Keys bash itself exports to what it execs; seen only on the generated route, which runs the wrapper. */
const T5_BASH_KEYS = ['PWD', 'SHLVL', '_'];
const T5_NEVER_KEYS = ['CCRC_SESSION_GENERATION', 'TMUX', 'TMUX_PANE', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID'];
const t5job = (b: { out: string }, launch: T5Launch, mode: string, name: string, extra: Partial<T5Job> = {}): T5Job => ({
  launch, mode, model: `fixture-model-${mode}`, settingsMode: 'restricted', stdin: `fixture input for ${name}\n`,
  out: b.out, name, lang: 'fixture.UTF-8', ...(mode === 'arm' ? { recall: T5_RECALL } : {}), ...extra,
});
/** What a call raises (sync or async), or null when it raises nothing. */
async function t5caught(run: () => unknown): Promise<unknown> {
  try { await run(); } catch (e) { return e; }
  return null;
}
/** The error is a TypeError whose message matches `re`: the refusal under test, never some other TypeError. */
function t5typeError(err: unknown, re: RegExp): void {
  expect(err, 'a TypeError was raised').toBeInstanceOf(TypeError);
  expect((err as Error).message).toMatch(re);
}
/** Plant the ambient state a leaked env would carry, so every absence below can fail. The ambient LANG differs from
 *  the job's, so a child LANG of 'fixture.UTF-8' proves it came through RunJob.lang, never from process.env. */
function t5Ambient(): void {
  t5vi.stubEnv('LANG', 'ambient.UTF-8');
  t5vi.stubEnv('PATH', `/fixture-caller-bin:${process.env['PATH'] ?? ''}`);
  for (const k of T5_NEVER_KEYS) t5vi.stubEnv(k, 'fixture-ambient');
  t5vi.stubEnv('CCRC_RECALL_ARM', 'fixture-ambient');
}

/** The contract's argv, spelled out here rather than taken from spawnArgv, so a stub case is not circular. */
const t5Spellings = (home: string): string[] =>
  [`Bash(${home}/.local/bin/ccrc history:*)`, 'Bash("$HOME/.local/bin/ccrc" history:*)', 'Bash(~/.local/bin/ccrc history:*)'];
const t5Argv = (mode: string, model: string, home: string): string[] => ['--restricted', '-p', '--no-session-persistence',
  '--strict-mcp-config', '--output-format', 'stream-json', '--verbose', '--max-turns', '12', '--model', model,
  ...(mode === 'arm' || mode === 'box' ? ['--tools', 'Bash,Agent', '--allowedTools', ...t5Spellings(home)] : ['--tools', ''])];

describe('W2-4 Task 5: the spawn argv and env, pure (W2-D50, W2-D51)', () => {
  const HOME = '/fixture/home';
  const SPELLINGS = t5Spellings(HOME);
  const FIXED = t5Argv('writer', 'fixture-model', HOME).slice(1, -2);

  it('the words: four modes, two settings modes, 12 turns, 10 a batch, 2 at once', () => {
    expect([...t5drv.SPAWN_MODES]).toEqual(['arm', 'writer', 'judge', 'box']);
    expect([...t5drv.SETTINGS_MODES]).toEqual(['restricted', 'fallback']);
    expect([t5drv.MAX_TURNS, t5drv.BATCH_MAX, t5drv.CONCURRENCY_MAX, t5drv.POISON_BIN_DIR]).toEqual([12, 10, 2, 'poison-bin']);
    expect(Object.isFrozen(t5drv.SPAWN_MODES) && Object.isFrozen(t5drv.SETTINGS_MODES)).toBe(true);
  });

  it('the three taught spellings, exactly', () => {
    expect([...t5drv.allowedToolSpellings(HOME)]).toEqual(SPELLINGS);
    expect(() => t5drv.allowedToolSpellings('relative/home')).toThrow(TypeError);
  });

  it.each(['arm', 'box'])('%s: --restricted, the fixed flags, --model, --tools Bash,Agent and the three spellings', (mode) => {
    expect(t5drv.spawnArgv({ mode, model: 'fixture-model', settingsMode: 'restricted', home: HOME }))
      .toEqual(['--restricted', ...FIXED, '--tools', 'Bash,Agent', '--allowedTools', ...SPELLINGS]);
  });

  it.each(['writer', 'judge'])('%s: --tools with an empty value and no --allowedTools', (mode) => {
    expect(t5drv.spawnArgv({ mode, model: 'fixture-model', settingsMode: 'restricted', home: HOME }))
      .toEqual(['--restricted', ...FIXED, '--tools', '']);
  });

  it('the fallback settings mode replaces --restricted with the two settings flags, first', () => {
    expect(t5drv.spawnArgv({ mode: 'writer', model: 'fixture-model', settingsMode: 'fallback', home: HOME }))
      .toEqual(['--setting-sources', 'project,local', '--settings', '{"disableAllHooks":true}', ...FIXED, '--tools', '']);
  });

  it('no argv in any mode or settings mode carries a bypass flag; an unknown mode, settings mode or model id is a TypeError', () => {
    for (const mode of t5drv.SPAWN_MODES) for (const settingsMode of t5drv.SETTINGS_MODES) {
      const argv = t5drv.spawnArgv({ mode, model: 'fixture-model', settingsMode, home: HOME });
      expect(argv.filter((a) => /dangerously|bypass/i.test(a)), `${mode} ${settingsMode}`).toEqual([]);
    }
    expect(() => t5drv.spawnArgv({ mode: 'other', model: 'm', settingsMode: 'restricted', home: HOME })).toThrow(TypeError);
    expect(() => t5drv.spawnArgv({ mode: 'box', model: 'm', settingsMode: 'none', home: HOME })).toThrow(TypeError);
    expect(() => t5drv.spawnArgv({ mode: 'box', model: '--verbose', settingsMode: 'restricted', home: HOME })).toThrow(TypeError);
  });

  it('the env: the allow-list exactly, PATH built from the poison dir and node, LANG else C.UTF-8, arm values only in arm mode', () => {
    const base = { home: HOME, configDir: `${HOME}/.claude`, poisonBin: '/fixture/out/poison-bin' };
    const PATH = `/fixture/out/poison-bin:${t5path.dirname(process.execPath)}:/usr/bin:/bin`;
    expect(t5drv.spawnEnv({ ...base, mode: 'writer', lang: 'fixture.UTF-8' }))
      .toEqual({ HOME, PATH, LANG: 'fixture.UTF-8', CLAUDE_CONFIG_DIR: `${HOME}/.claude` });
    expect(t5drv.spawnEnv({ ...base, mode: 'judge', lang: undefined })['LANG']).toBe('C.UTF-8');
    expect(t5drv.spawnEnv({ ...base, mode: 'box', lang: '' })['LANG']).toBe('C.UTF-8');
    expect(t5drv.spawnEnv({ ...base, mode: 'arm', lang: 'fixture.UTF-8', recall: T5_RECALL })).toEqual({
      HOME, PATH, LANG: 'fixture.UTF-8', CLAUDE_CONFIG_DIR: `${HOME}/.claude`,
      CCRC_RECALL_SESSION: T5_RECALL.session, CCRC_RECALL_ARM: T5_RECALL.arm, CCRC_RECALL_ASOF: T5_RECALL.asof,
    });
    expect(() => t5drv.spawnEnv({ ...base, mode: 'arm', lang: undefined })).toThrow(TypeError);
    expect(() => t5drv.spawnEnv({ ...base, mode: 'arm', lang: undefined, recall: { ...T5_RECALL, asof: '' } })).toThrow(TypeError);
    expect(() => t5drv.spawnEnv({ ...base, mode: 'writer', lang: undefined, recall: T5_RECALL })).toThrow(TypeError);
  });

  // D-5804 (history-w2-4-spawn-guard-pins): each spawnEnv path check is pinned, one assertion per distinct check.
  it.each(['home', 'configDir', 'poisonBin'] as const)('the env refuses a %s that is not a string, is relative, or holds a colon, by its name', async (key) => {
    const good = { home: HOME, configDir: `${HOME}/.claude`, poisonBin: '/fixture/out/poison-bin' };
    const re = new RegExp(`spawnEnv: ${key} .* is not an absolute path without`);
    const withBad = (bad: unknown): Record<string, string> =>
      t5drv.spawnEnv({ ...good, mode: 'writer', lang: undefined, [key]: bad as string });
    t5typeError(await t5caught(() => withBad(undefined)), re);
    t5typeError(await t5caught(() => withBad('relative/path')), re);
    t5typeError(await t5caught(() => withBad(`${good[key]}:/fixture/extra`)), re);
    expect(withBad(good[key])['PATH'], 'the control: the good value is accepted').toContain('/fixture/out/poison-bin');
  });
});

describe('W2-4 Task 5: RP1-contract on the stub, launch per kind (W2-D50, W2-D51)', () => {
  t5afterEach(() => { t5vi.unstubAllEnvs(); });

  it.each(['arm', 'writer', 'judge', 'box'])('upstream, %s: launched direct; exact argv, exact env keys and values, stdin, an empty 0700 cwd outside any git tree, removed after', async (mode) => {
    const b = t5Box(`ccrc-replay-t5-up-${mode}-`);
    t5Ambient();
    const o = await t5drv.launchRun(t5job(b, b.up, mode, `rp1-${mode}`));
    const log = stubLog(b.home);
    expect(log, 'the stub ran once').toHaveLength(1);
    const l = log![0]!;
    expect(l.argv).toEqual(t5Argv(mode, `fixture-model-${mode}`, b.home));
    expect(l.envKeys).toEqual([...T5_BASE_KEYS, ...(mode === 'arm' ? T5_RECALL_KEYS : [])].sort());
    expect(l.env['HOME']).toBe(b.home);
    expect(l.env['PATH']).toBe(`${b.out}/poison-bin:${t5path.dirname(process.execPath)}:/usr/bin:/bin`);
    expect(l.env['LANG']).toBe('fixture.UTF-8');
    expect(l.env['CLAUDE_CONFIG_DIR']).toBe(t5path.join(b.home, '.claude'));
    if (mode === 'arm') {
      expect([l.env['CCRC_RECALL_SESSION'], l.env['CCRC_RECALL_ARM'], l.env['CCRC_RECALL_ASOF']]).toEqual([T5_RECALL.session, T5_RECALL.arm, T5_RECALL.asof]);
    }
    for (const k of T5_NEVER_KEYS) expect(l.envKeys, k).not.toContain(k);
    expect(l.stdin).toBe(`fixture input for rp1-${mode}\n`);
    expect([l.cwdMode, l.cwdEntries]).toEqual([0o700, []]);
    expect(l.cwd.startsWith(t5fs.realpathSync(t5os.tmpdir()) + t5path.sep)).toBe(true);
    expect(t5drv.insideGitTree(l.cwd).state).toBe('outside');
    expect(o.cwd).toBe(l.cwd);
    expect(t5fs.existsSync(l.cwd), 'the cwd is removed after the run').toBe(false);
    expect([o.skipped, o.code, o.signal, o.tokens]).toEqual([false, 0, null, T5_TOKENS]);
  }, 60_000);

  it('generated: launched through its own wrapper, which sources the declared secrets file: CLAUDE_CODE_OAUTH_TOKEN reaches the stub, by name only', async () => {
    const b = t5Box('ccrc-replay-t5-gen-');
    t5Ambient();
    expect(b.gen.launcher).toBe(t5path.join(b.home, '.local', 'bin', 'gen-a'));
    await t5drv.launchRun(t5job(b, b.gen, 'writer', 'rp1-gen'));
    const l = stubLog(b.home)![0]!;
    expect(l.envKeys).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(l.envKeys.filter((k) => !T5_BASH_KEYS.includes(k))).toEqual([...T5_BASE_KEYS, 'CLAUDE_CODE_OAUTH_TOKEN'].sort());
    expect(l.env['CLAUDE_CONFIG_DIR']).toBe(t5path.join(b.home, '.gen-a'));
    expect(l.env['PATH']).toBe(`${b.out}/poison-bin:${t5path.dirname(process.execPath)}:/usr/bin:/bin`);
    for (const k of T5_NEVER_KEYS) expect(l.envKeys, k).not.toContain(k);
    expect(t5fs.readFileSync(t5path.join(b.home, T5_STUB_LOG), 'utf8')).not.toContain(T5_TOKEN);
  }, 60_000);

  it('upstream gets no CLAUDE_CODE_OAUTH_TOKEN from the driver, even when the caller carries one', async () => {
    const b = t5Box('ccrc-replay-t5-uptok-');
    t5vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', T5_TOKEN);
    await t5drv.launchRun(t5job(b, b.up, 'judge', 'rp1-uptok'));
    expect(stubLog(b.home)![0]!.envKeys).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  }, 60_000);

  it('the poisoned gh sits first on PATH under --out and exits 97', async () => {
    const b = t5Box('ccrc-replay-t5-gh-');
    await t5drv.launchRun(t5job(b, b.up, 'box', 'rp1-gh'));
    const gh = t5path.join(b.out, 'poison-bin', 'gh');
    expect(t5fs.statSync(gh).mode & 0o777).toBe(0o700);
    const r = t5spawnSync(gh, ['pr', 'merge'], { encoding: 'utf8' });
    expect(r.status).toBe(97);
  }, 60_000);

  it('a run leaves its stream, one ledger line and its run.json, written last with no tmp left, and keeps only the unknown option names from stderr', async () => {
    const b = t5Box('ccrc-replay-t5-files-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_STDERR), "error: unknown option '--fixture-flag'\nfixture-noise that is not kept\n");
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_EXIT), '1');
    const o = await t5drv.launchRun(t5job(b, b.up, 'writer', 'step/files'));
    expect([o.code, o.unknownOptions]).toEqual([1, ['--fixture-flag']]);
    expect(t5fs.readFileSync(t5path.join(b.out, 'step', 'files.jsonl'), 'utf8')).toBe(T5_STREAM);
    expect(o.facts.usageSource).toBe('result');
    const run = JSON.parse(t5fs.readFileSync(t5path.join(b.out, 'step', 'files.run.json'), 'utf8'));
    expect([run.kind, run.name, run.code, run.tokens, run.unknown_options]).toEqual(['ccrc-history-replay-run', 'step/files', 1, T5_TOKENS, ['--fixture-flag']]);
    expect(JSON.stringify(run)).not.toContain('fixture-noise');
    expect(t5fs.readdirSync(t5path.join(b.out, 'step')).sort()).toEqual(['files.jsonl', 'files.run.json']);
    expect(t5drv.spentSoFar(b.out)).toBe(T5_TOKENS);
  }, 60_000);

  it('a run that outlives its timeout is killed on its own pid and recorded with its signal', async () => {
    const b = t5Box('ccrc-replay-t5-timeout-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_SLEEP), '8000');
    const o = await t5drv.launchRun(t5job(b, b.up, 'box', 'rp1-timeout', { timeoutMs: 300 }));
    expect([o.code, o.signal]).toEqual([null, 'SIGTERM']);
    expect(o.ms).toBeLessThan(5_000);
    expect(stubLog(b.home), 'killed before it logged').toBeNull();
  }, 6_000);

  // D-5804 (history-w2-4-spawn-guard-pins): the run-name grammar, the launcher-under-home check and the poison-bin
  // directory check each have a case that reaches the guard's branch.
  it.each(['', 'Upper', 'a b', '../escape', 'x/../../escape', '/escape', 'a//b', '.hidden', 'a/b/c/d/e', 'x'.repeat(65)])(
    'a bad run name %j is a TypeError before any spawn and writes nothing outside --out', async (name) => {
      const b = t5Box('ccrc-replay-t5-badname-');
      t5typeError(await t5caught(() => t5drv.launchRun(t5job(b, b.up, 'box', name))), /is not a run name/);
      expect(stubLog(b.home), 'nothing spawned').toBeNull();
      expect(t5fs.readdirSync(b.home).filter((f) => f.startsWith('escape')), 'nothing beside --out').toEqual([]);
      expect(t5fs.readdirSync(b.out).filter((f) => f !== 'poison-bin' && !f.startsWith('.')), 'nothing inside --out').toEqual([]);
    }, 60_000);

  it('a run name that is not a string is a TypeError, not the name undefined', async () => {
    const b = t5Box('ccrc-replay-t5-nostrname-');
    t5typeError(await t5caught(() => t5drv.launchRun(t5job(b, b.up, 'box', undefined as unknown as string))), /is not a run name/);
    t5typeError(await t5caught(() => t5drv.launchRun(t5job(b, b.up, 'box', 7 as unknown as string))), /is not a run name/);
    expect(stubLog(b.home)).toBeNull();
    expect(t5fs.readdirSync(b.out), '--out holds only its marker').toEqual(['.ccrc-history-replay']);
  }, 60_000);

  it('a launcher under another home, or in a sibling directory sharing the bin prefix, is a TypeError before any spawn', async () => {
    const b = t5Box('ccrc-replay-t5-launcher-');
    const other = t5Box('ccrc-replay-t5-otherhome-');
    const near = t5path.join(b.home, '.local', 'bin-near');
    t5fs.mkdirSync(near, { recursive: true });
    t5fs.writeFileSync(t5path.join(near, 'up-a'), T5_STUB_SOURCE, { mode: 0o700 });
    for (const launcher of [other.up.launcher, t5path.join(near, 'up-a')]) {
      const launch = { ...b.up, launcher };
      t5typeError(await t5caught(() => t5drv.launchRun(t5job(b, launch, 'box', 'launcher-0'))), /is not under .*\/\.local\/bin/);
    }
    expect(stubLog(b.home), 'nothing spawned in this home').toBeNull();
    expect(stubLog(other.home), 'nothing spawned in the other home').toBeNull();
  }, 60_000);

  it('a poison-bin that is a file, or a symlink to a directory, is refused out-refused before any spawn', async () => {
    const file = t5Box('ccrc-replay-t5-poisonfile-');
    t5fs.writeFileSync(t5path.join(file.out, 'poison-bin'), 'not a directory');
    await expect(t5drv.launchRun(t5job(file, file.up, 'box', 'poison-0')))
      .rejects.toMatchObject({ word: 'out-refused', detail: 'poison-bin is not a directory' });
    expect(stubLog(file.home)).toBeNull();
    const link = t5Box('ccrc-replay-t5-poisonlink-');
    const target = t5path.join(link.home, 'poison-target');
    t5fs.mkdirSync(target);
    t5fs.symlinkSync(target, t5path.join(link.out, 'poison-bin'));
    await expect(t5drv.launchRun(t5job(link, link.up, 'box', 'poison-1')))
      .rejects.toMatchObject({ word: 'out-refused', detail: 'poison-bin is not a directory' });
    expect(t5fs.readdirSync(target), 'nothing planted through the link').toEqual([]);
    expect(stubLog(link.home)).toBeNull();
  }, 60_000);
});

describe('W2-4 Task 5: the batch runner, at most 2 at once, gated, resumable (W2-D51, W2-D53, W2-D55)', () => {
  t5afterEach(() => { t5vi.unstubAllEnvs(); });

  it('a batch of more than BATCH_MAX jobs, a concurrency above CONCURRENCY_MAX, a batch with no gate, or a job without its lang key is a TypeError before any spawn', async () => {
    const b = t5Box('ccrc-replay-t5-bounds-');
    const eleven = Array.from({ length: 11 }, (_, i) => t5job(b, b.up, 'box', `bound-${i}`));
    await expect(t5drv.runBatch(eleven, { gate: T5_NO_GATE })).rejects.toThrow(TypeError);
    await expect(t5drv.runBatch(eleven.slice(0, 2), { concurrency: 3, gate: T5_NO_GATE })).rejects.toThrow(TypeError);
    await expect(t5drv.runBatch(eleven.slice(0, 2), {}), 'a batch with no gate never spawns ungated').rejects.toThrow(TypeError);
    const { lang: _lang, ...noLang } = t5job(b, b.up, 'box', 'no-lang');
    await expect(t5drv.launchRun(noLang as T5Job), 'a caller that forgets lang fails loudly').rejects.toThrow(TypeError);
    expect(stubLog(b.home)).toBeNull();
  }, 60_000);

  it('four jobs run two at a time, never three: the stub stamps overlap at most 2 deep', async () => {
    const b = t5Box('ccrc-replay-t5-conc-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_SLEEP), '1500');
    const outs = await t5drv.runBatch(Array.from({ length: 4 }, (_, i) => t5job(b, b.up, 'box', `conc-${i}`)), { gate: T5_NO_GATE });
    expect(outs.map((o) => o.skipped)).toEqual([false, false, false, false]);
    const log = stubLog(b.home)!;
    expect(log).toHaveLength(4);
    const depth = Math.max(...log.map((x) => log.filter((y) => y.start <= x.start && x.start < y.end).length));
    expect(depth).toBe(2);
  }, 60_000);

  it('the gate is called before each spawn; a gate that throws stops the batch with its refusal and no further spawn', async () => {
    const b = t5Box('ccrc-replay-t5-gate-');
    let calls = 0;
    const gate = (): void => { calls += 1; if (calls === 2) throw new t5drv.DriverRefusal('budget-exhausted', 'fixture stop'); };
    const jobs = Array.from({ length: 3 }, (_, i) => t5job(b, b.up, 'box', `gate-${i}`));
    await expect(t5drv.runBatch(jobs, { concurrency: 1, gate })).rejects.toMatchObject({ word: 'budget-exhausted' });
    expect(stubLog(b.home)).toHaveLength(1);
    expect(t5fs.existsSync(t5path.join(b.out, 'gate-0.run.json'))).toBe(true);
    const again = await t5drv.runBatch(jobs, { concurrency: 1, gate: () => { calls += 1; } });
    expect(again.map((o) => o.skipped)).toEqual([true, false, false]);
    expect(calls, 'the resumed batch gated its two spawns only').toBe(4);
    expect(stubLog(b.home)).toHaveLength(3);
  }, 60_000);

  it('resume: a finished job is never spawned again and the ledger counts it once; a job with no run.json is spawned again and its spend adds to the total', async () => {
    const b = t5Box('ccrc-replay-t5-resume-');
    const jobs = [t5job(b, b.up, 'writer', 'resume-0'), t5job(b, b.up, 'judge', 'resume-1')];
    await t5drv.runBatch(jobs, { gate: T5_NO_GATE });
    const again = await t5drv.runBatch(jobs, { gate: T5_NO_GATE });
    expect(again.map((o) => [o.skipped, o.tokens, o.facts.usageSource])).toEqual([[true, T5_TOKENS, 'result'], [true, T5_TOKENS, 'result']]);
    expect(stubLog(b.home)).toHaveLength(2);
    expect(t5drv.spentSoFar(b.out)).toBe(2 * T5_TOKENS);
    t5fs.rmSync(t5path.join(b.out, 'resume-1.run.json'));
    const third = await t5drv.runBatch(jobs, { gate: T5_NO_GATE });
    expect(third.map((o) => o.skipped)).toEqual([true, false]);
    expect(stubLog(b.home)).toHaveLength(3);
    // A run.json lost after its ledger line (a kill between the two): the re-spawn spends again, and the summed
    // ledger counts both spawns. Over-counting is the budget's safe direction (coordinator ruling).
    expect(t5drv.spentSoFar(b.out), 'the re-spawned job spent twice, and both count').toBe(3 * T5_TOKENS);
  }, 60_000);

  it('resume refuses a stream changed after its run.json, a run.json that does not parse, and one recorded for another account, mode, model or settings mode', async () => {
    const b = t5Box('ccrc-replay-t5-tamper-');
    const job = t5job(b, b.up, 'box', 'tamper-0');
    await t5drv.runBatch([job], { gate: T5_NO_GATE });
    // The same --out and name under another account, mode, model or settings mode is never answered from this run.
    // D-5804: variant 1 carries the recorded model, so it differs from the recorded run in its mode alone.
    const others = [t5job(b, b.gen, 'box', 'tamper-0'), t5job(b, b.up, 'writer', 'tamper-0', { model: 'fixture-model-box' }),
      t5job(b, b.up, 'box', 'tamper-0', { model: 'fixture-model-other' }), t5job(b, b.up, 'box', 'tamper-0', { settingsMode: 'fallback' })];
    for (const [i, other] of others.entries()) {
      await expect(t5drv.runBatch([other], { gate: T5_NO_GATE }), `variant ${i}`).rejects.toMatchObject({ word: 'out-refused', detail: 'run-json-mismatch tamper-0' });
    }
    t5fs.appendFileSync(t5path.join(b.out, 'tamper-0.jsonl'), '{}\n');
    await expect(t5drv.runBatch([job], { gate: T5_NO_GATE })).rejects.toMatchObject({ word: 'out-refused', detail: 'run-stream-changed tamper-0' });
    t5fs.writeFileSync(t5path.join(b.out, 'tamper-0.run.json'), 'not json');
    await expect(t5drv.runBatch([job], { gate: T5_NO_GATE })).rejects.toMatchObject({ word: 'out-refused', detail: 'run-json-invalid tamper-0' });
    expect(stubLog(b.home)).toHaveLength(1);
  }, 60_000);

  // D-5804 (history-w2-4-spawn-guard-pins): the duplicate-job check and finishedOutcome's kind, name and null checks.
  it('two jobs in one batch with the same --out and name are a TypeError before any spawn', async () => {
    const b = t5Box('ccrc-replay-t5-dup-');
    const job = t5job(b, b.up, 'box', 'dup-0');
    t5typeError(await t5caught(() => t5drv.runBatch([job, { ...job }], { gate: T5_NO_GATE })), /two jobs share one --out and name/);
    expect(stubLog(b.home)).toBeNull();
    expect(t5fs.readdirSync(b.out), '--out holds only its marker').toEqual(['.ccrc-history-replay']);
    const ok = await t5drv.runBatch([job, t5job(b, b.up, 'box', 'dup-1')], { gate: T5_NO_GATE });
    expect(ok.map((o) => o.skipped), 'the control: two names are fine').toEqual([false, false]);
  }, 60_000);

  it('resume refuses a well-formed run.json of the wrong kind or the wrong name, and one that is the JSON null', async () => {
    const b = t5Box('ccrc-replay-t5-kind-');
    const job = t5job(b, b.up, 'box', 'kind-0');
    await t5drv.runBatch([job], { gate: T5_NO_GATE });
    const runJson = t5path.join(b.out, 'kind-0.run.json');
    const good = t5fs.readFileSync(runJson, 'utf8');
    const rec = JSON.parse(good) as Record<string, unknown>;
    for (const [label, text] of [['kind', { ...rec, kind: 'ccrc-history-replay-other' }], ['name', { ...rec, name: 'kind-1' }], ['null', null]] as const) {
      t5fs.writeFileSync(runJson, JSON.stringify(text) + '\n');
      await expect(t5drv.runBatch([job], { gate: T5_NO_GATE }), label).rejects.toMatchObject({ word: 'out-refused', detail: 'run-json-invalid kind-0' });
    }
    t5fs.writeFileSync(runJson, good);
    const again = await t5drv.runBatch([job], { gate: T5_NO_GATE });
    expect(again.map((o) => o.skipped), 'the control: the untouched record resumes').toEqual([true]);
    expect(stubLog(b.home)).toHaveLength(1);
  }, 60_000);

  it('a run named for the spend ledger is refused before any spawn: its stream path would truncate the ledger (D-5803)', async () => {
    const b = t5Box('ccrc-replay-t5-spendname-');
    const ledger = t5path.join(b.out, t5drv.SPEND_LEDGER);
    for (const [n, tokens] of [['seed-a', 10], ['seed-b', 20], ['seed-c', 35]] as const) t5drv.recordSpend(b.out, n, tokens);
    const before = t5fs.readFileSync(ledger);
    expect(before.toString('utf8').split('\n').filter((l) => l !== '')).toHaveLength(3);
    const name = t5drv.SPEND_LEDGER.replace(/\.jsonl$/, '');
    const refusal = /would stream into the spend ledger/;
    t5typeError(await t5caught(() => t5drv.launchRun(t5job(b, b.up, 'box', name))), refusal);
    t5typeError(await t5caught(() => t5drv.runBatch([t5job(b, b.up, 'box', name)], { gate: T5_NO_GATE })), refusal);
    expect(t5fs.readFileSync(ledger).equals(before), 'the ledger is byte-identical').toBe(true);
    expect(t5drv.spentSoFar(b.out)).toBe(65);
    expect(t5fs.existsSync(t5path.join(b.out, `${name}.run.json`))).toBe(false);
    expect(stubLog(b.home), 'nothing spawned').toBeNull();
  }, 60_000);
});

describe('W2-4 Task 5: makeRunCwd refuses a temp root inside a git tree (W2-D51)', () => {
  t5afterEach(() => { t5vi.unstubAllEnvs(); });

  it('a TMPDIR under a planted git tree refuses out-refused and leaves no directory behind', () => {
    const root = t5MkTmp('ccrc-replay-t5-gitcwd-');
    t5fs.mkdirSync(t5path.join(root, '.git'));
    const tmp = t5path.join(root, 'tmp');
    t5fs.mkdirSync(tmp);
    t5vi.stubEnv('TMPDIR', tmp);
    let err: unknown = null;
    try { t5drv.makeRunCwd(); } catch (e) { err = e; }
    expect(err).toMatchObject({ word: 'out-refused', detail: `run-cwd-in-git-tree ${root}` });
    expect(t5fs.readdirSync(tmp)).toEqual([]);
  });
});

describe('W2-4 Task 5: the driver passes no env whole and reads only HOME, TMUX_PANE and LANG by name', () => {
  const SRC = t5path.resolve(__dirname, '..', '..', 'deploy', 'history-replay.mjs');
  /** The entry guard's by-name projection (Task 1): the driver's ONE process.env line. No line is exempt from the scan. */
  const PROJECTION = 'process.exitCode = await main(process.argv.slice(2), { HOME: process.env.HOME, TMUX_PANE: process.env.TMUX_PANE, LANG: process.env.LANG });';
  const isComment = (t: string): boolean => t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
  /** Non-comment lines that pass an env whole, spread one, or read process.env by any name outside the three. */
  const envViolations = (text: string): string[] => text.split('\n').filter((line) => {
    const t = line.trim();
    if (isComment(t)) return false;
    if (/\.\.\.\s*(?:process\.)?env\b/.test(t) || /\benv\s*:\s*(?:process\.)?env\b/.test(t) || /[{,]\s*env\s*[,}]/.test(t)
      || /Object\.assign\([^)]*\benv\b/.test(t)) return true;
    return [...t.matchAll(/process\.env(\.[A-Za-z_][A-Za-z0-9_]*)?/g)].some((m) => !['.HOME', '.TMUX_PANE', '.LANG'].includes(m[1] ?? ''));
  });

  it('CONTROL: the scan sees a spread, a whole pass (the old entry-guard form included), another name and a computed read, and passes the by-name projection', () => {
    for (const bad of ['const e = { ...process.env, HOME: home };', 'spawn(cmd, argv, { env: process.env });', 'const p = process.env.PATH;',
      'const v = process.env[name];', 'run({ ...env });', 'spawn(cmd, argv, { cwd, env: env });', 'spawn(cmd, argv, { cwd, env });',
      'Object.assign(child, process.env);', 'process.exitCode = await main(process.argv.slice(2), process.env);']) {
      expect(envViolations(bad), bad).toEqual([bad]);
    }
    expect(envViolations([`  ${PROJECTION}`, '// never { ...process.env }', 'spawn(cmd, argv, { cwd, env: childEnv });'].join('\n'))).toEqual([]);
  });

  it('deploy/history-replay.mjs: no violation, and the entry guard\'s by-name projection is its only process.env line', () => {
    const text = t5fs.readFileSync(SRC, 'utf8');
    expect(envViolations(text)).toEqual([]);
    const envLines = text.split('\n').map((l) => l.trim()).filter((t) => !isComment(t) && /\bprocess\.env\b/.test(t));
    expect(envLines, 'every other env read goes through main\'s env parameter').toEqual([PROJECTION]);
  });

  it('deploy/history-replay.mjs spells no bypass flag and spawns through no shell', () => {
    const code = t5fs.readFileSync(SRC, 'utf8').split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l));
    expect(code.filter((l) => /dangerously-skip-permissions|bypassPermissions/.test(l))).toEqual([]);
    expect(code.filter((l) => /\bshell\s*:|\b(?:exec|execSync|execFile|execFileSync)\s*\(/.test(l))).toEqual([]);
  });
});
