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
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { REPO, scrubbedEnv } from './historyHelpers.js';
import { EXIT, REASONS, sha256Hex } from '../../ccd/history/lib.mjs';
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
import { generateWrapperBody, generateWrapperBody as t5WrapperBody } from '../../shared/wrapper.mjs';
import { rosterFromJson } from '../../shared/roster-json.mjs';
import { mkTmp as t5MkTmp } from './tmpHelpers.js';
// W2-4 Task 6 (W2-D55): t6-prefixed bindings, so none collides with a named import Tasks 1–5 put in this block.
import * as t6Driver from '../../deploy/history-replay.mjs';
import * as t6Fs from 'node:fs';
import t6Path from 'node:path';
import { execFileSync as t6ExecFile } from 'node:child_process';
import { readLimits as t6ReadLimits } from '../src/limits.js';
import { loadConfig as t6LoadConfig } from '../src/config.js';
import { localIO as t6LocalIO } from '../src/io.js';
import { rolloverCases as t6RolloverCases } from './fixtures/rollover.js';
import { DEFAULT_TEST_ROSTER as T6_ROSTER } from './helpers/roster.js';

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

// ── W2-4 Task 6: the limits stop and the spend budget (W2-D55; spec §10.2:2697, erratum E18) ─────────────────────
// The driver reads one limits row, read-only, by readLimits' rules, and keeps the provenance readLimits folds: a 0 from
// a lapsed resetAt is a measured reset, a 0 inferred from age measured nothing and stops as stale. The parity case holds
// the driver's reading to readLimits' over rolloverCases' bytes, the fixture limits.test.ts and ccd-limits.test.ts share.
// Fixture HOMEs only; the clock is a parameter.
describe('W2-4 Task 6: the limits row is read by readLimits\' rules, keeping its provenance (W2-D55 parity)', () => {
  const NOW_S = 1_785_231_736;
  const PICK = (r: { five: number | null; seven: number | null; ts: number | null; fiveResetAt: number | null; sevenResetAt: number | null; fiveRolledOver: boolean; sevenRolledOver: boolean }) =>
    ({ five: r.five, seven: r.seven, ts: r.ts, fiveResetAt: r.fiveResetAt, sevenResetAt: r.sevenResetAt, fiveRolledOver: r.fiveRolledOver, sevenRolledOver: r.sevenRolledOver });

  it('over every rolloverCases row, parseLimitsRow and readLimitsRow answer exactly what readLimits answers over the same bytes', async () => {
    const home = mkTmp('ccrc-replay-t6-parity-');
    t6Fs.mkdirSync(t6Path.join(home, '.ccrc'), { recursive: true });
    t6Fs.writeFileSync(t6Path.join(home, '.ccrc', 'accounts.json'), JSON.stringify(T6_ROSTER));
    const dir = t6Path.join(home, '.cc-limits');
    t6Fs.mkdirSync(dir, { recursive: true });
    const cases = t6RolloverCases(NOW_S);
    for (const c of cases) t6Fs.writeFileSync(t6Path.join(dir, c.file), c.content);
    const theirs = await t6ReadLimits(t6LocalIO, t6LoadConfig({ CCRC_HOME: home }), NOW_S);
    expect(cases.length, 'CONTROL: the shared fixture is not empty').toBeGreaterThan(10);
    for (const c of cases) {
      const id = c.file.slice(0, -'.json'.length);
      const want = PICK(theirs[id]!);
      expect(PICK(t6Driver.parseLimitsRow(c.content, NOW_S)), `${c.file}: ${c.why}`).toEqual(want);
      expect(want, `${c.file}: the fixture's own expectation`).toMatchObject(c.expect);
      const read = t6Driver.readLimitsRow(home, id, NOW_S);
      expect(read.state, c.file).toBe('row');
      if (read.state === 'row') expect(PICK(read.row!), c.file).toEqual(want);
    }
  });

  // D-5805: the window constants (18000, 604800) are held equal to readLimits' by this case, not by an import. rolloverCases has
  // no non-fact row aged in [3601, 20000) s for five or [20000, 700000) s for seven, so without these rows changing either
  // constant over that range reds nothing. Rows carry NO resetAt fields (no fact), aged window-1, window and window+1 seconds.
  it('the window boundaries agree with readLimits: a row with no resetAt aged window-1, window and window+1 seconds (D-5805)', async () => {
    const FIVE_W = 18000;
    const SEVEN_W = 604800;
    const home = mkTmp('ccrc-replay-t6-window-');
    t6Fs.mkdirSync(t6Path.join(home, '.ccrc'), { recursive: true });
    t6Fs.writeFileSync(t6Path.join(home, '.ccrc', 'accounts.json'), JSON.stringify(T6_ROSTER));
    const dir = t6Path.join(home, '.cc-limits');
    t6Fs.mkdirSync(dir, { recursive: true });
    // The five rows keep seven well inside its window; the seven rows carry a five value too (its age passes the five window).
    const rows: { id: string; ageS: number }[] = [];
    for (const d of [-1, 0, 1]) { rows.push({ id: `win-five-${d + 1}`, ageS: FIVE_W + d }); rows.push({ id: `win-seven-${d + 1}`, ageS: SEVEN_W + d }); }
    for (const r of rows) t6Fs.writeFileSync(t6Path.join(dir, `${r.id}.json`), JSON.stringify({ five: 50, seven: 60, ts: NOW_S - r.ageS }));
    const theirs = await t6ReadLimits(t6LocalIO, t6LoadConfig({ CCRC_HOME: home }), NOW_S);
    const inferredOf = (id: string) => {
      const read = t6Driver.readLimitsRow(home, id, NOW_S);
      expect(read.state, id).toBe('row');
      const row = (read as { row: ReturnType<typeof t6Driver.parseLimitsRow> }).row;
      expect(PICK(row), `${id}: the parity with readLimits`).toEqual(PICK(theirs[id]!));
      // No resetAt, so no fact: every rolled-over flag here is the age inference's, in readLimits and in the driver.
      expect(row.fiveInferred, `${id}: five provenance is readLimits' flag`).toBe(theirs[id]!.fiveRolledOver);
      expect(row.sevenInferred, `${id}: seven provenance is readLimits' flag`).toBe(theirs[id]!.sevenRolledOver);
      return row;
    };
    expect(inferredOf('win-five-0').fiveInferred, 'five at 17999 s is inside its window').toBe(false);
    expect(inferredOf('win-five-2').fiveInferred, 'five at 18001 s is past its window').toBe(true);
    inferredOf('win-five-1');   // exactly the window: whatever it answers equals readLimits' (asserted above)
    expect(inferredOf('win-seven-0').sevenInferred, 'seven at 604799 s is inside its window').toBe(false);
    expect(inferredOf('win-seven-2').sevenInferred, 'seven at 604801 s is past its window').toBe(true);
    inferredOf('win-seven-1');
  });

  it('only the age path sets *Inferred: a lapsed resetAt is a measured reset, an age-inferred 0 is not', () => {
    const inferred: Record<string, { fiveInferred: boolean; sevenInferred: boolean }> = {
      'no-reset-fields-old.json': { fiveInferred: true, sevenInferred: false },
    };
    for (const c of t6RolloverCases(NOW_S)) {
      const r = t6Driver.parseLimitsRow(c.content, NOW_S);
      expect({ fiveInferred: r.fiveInferred, sevenInferred: r.sevenInferred }, c.file)
        .toEqual(inferred[c.file] ?? { fiveInferred: false, sevenInferred: false });
    }
    const both = t6Driver.parseLimitsRow(JSON.stringify({ five: 5, seven: 50, ts: NOW_S - 700_000 }), NOW_S);
    expect(both).toMatchObject({ five: 0, seven: 0, fiveRolledOver: true, sevenRolledOver: true, fiveInferred: true, sevenInferred: true });
  });

  it('parseLimitsRow throws on text that is not JSON, and on JSON that is not one object', () => {
    expect(() => t6Driver.parseLimitsRow('not json', NOW_S)).toThrow(SyntaxError);
    for (const text of ['null', '[1, 2]', '42', '"row"']) {
      expect(() => t6Driver.parseLimitsRow(text, NOW_S), text).toThrow('a limits row is one JSON object');
    }
  });

  // D-5807: the account-id guard is the only thing between an id and a path. Decoy rows are planted where each bad id
  // would resolve if the guard were gone ('../up-a' reads <home>/up-a.json, 'a/b' reads <home>/.cc-limits/a/b.json), so
  // without the guard readLimitsRow answers a row instead of throwing.
  it('readLimitsRow and batchGate refuse an id that is not one path segment, and read the plain id (D-5807)', () => {
    const home = mkTmp('ccrc-replay-t6-id-');
    const dir = t6Path.join(home, '.cc-limits');
    t6Fs.mkdirSync(t6Path.join(dir, 'a'), { recursive: true });
    const row = JSON.stringify({ five: 1, seven: 1, ts: NOW_S - 60, fiveResetAt: NOW_S + 3600, sevenResetAt: NOW_S + 86_400 });
    for (const f of [t6Path.join(home, 'up-a.json'), t6Path.join(dir, 'a', 'b.json'), t6Path.join(dir, '.hidden.json'), t6Path.join(dir, '.json'), t6Path.join(dir, 'up-a.json')]) {
      t6Fs.writeFileSync(f, row);
    }
    expect(t6Driver.readLimitsRow(home, 'up-a', NOW_S).state, 'CONTROL: a plain id is read').toBe('row');
    const out = t6Path.join(home, 'out');
    t6Fs.mkdirSync(out, { mode: 0o700 });
    for (const bad of ['../up-a', '.hidden', 'a/b', '', 42, null, undefined]) {
      expect(() => t6Driver.readLimitsRow(home, bad as string, NOW_S), JSON.stringify(bad)).toThrow('not an account id');
      const gate = t6Driver.batchGate({ out, home, accountId: bad as string, budget: 1000, limits: { threshold_pct: 70, max_age_ms: 3_600_000 }, now: () => NOW_S * 1000 });
      expect(() => gate(), `batchGate ${JSON.stringify(bad)}`).toThrow('not an account id');
    }
    const okGate = t6Driver.batchGate({ out, home, accountId: 'up-a', budget: 1000, limits: { threshold_pct: 70, max_age_ms: 3_600_000 }, now: () => NOW_S * 1000 });
    expect(() => okGate(), 'CONTROL: the plain id passes the gate').not.toThrow();
  });
});

describe('W2-4 Task 6: the gate stops on every limits and budget condition (W2-D55)', () => {
  const NOW_S = 1_800_000_000;
  const NOW_MS = NOW_S * 1000;
  type Stop = { word: string; detail: string } | null;
  function t6Box(prefix: string): { home: string; out: string; row: string } {
    const base = mkTmp(prefix);
    const home = t6Path.join(base, 'home');
    t6Fs.mkdirSync(t6Path.join(home, '.cc-limits'), { recursive: true });
    const out = t6Path.join(base, 'out');
    t6Fs.mkdirSync(out, { mode: 0o700 });
    return { home, out, row: t6Path.join(home, '.cc-limits', 'up-a.json') };
  }
  const fresh = (five: number | null, seven: number | null, o: Record<string, number> = {}) => JSON.stringify(
    { five, seven, ts: NOW_S - 60, fiveResetAt: NOW_S + 3600, sevenResetAt: NOW_S + 86_400, ...o });
  function stopOf(b: { home: string; out: string }, o: { budget?: number; threshold?: number; maxAge?: number } = {}): Stop {
    const gate = t6Driver.batchGate({
      out: b.out, home: b.home, accountId: 'up-a', budget: o.budget ?? 1_000_000,
      limits: { threshold_pct: o.threshold ?? t6Driver.LIMITS_DEFAULTS.threshold_pct, max_age_ms: o.maxAge ?? t6Driver.LIMITS_DEFAULTS.max_age_ms },
      now: () => NOW_MS,
    });
    try { gate(); return null; } catch (e) {
      expect(e).toBeInstanceOf(t6Driver.DriverRefusal);
      return { word: (e as InstanceType<typeof t6Driver.DriverRefusal>).word, detail: (e as InstanceType<typeof t6Driver.DriverRefusal>).detail };
    }
  }

  it('LIMITS_DEFAULTS is frozen and exactly the open record\'s defaults, its batch fields Task 5\'s constants', () => {
    expect(Object.isFrozen(t6Driver.LIMITS_DEFAULTS)).toBe(true);
    expect(t6Driver.LIMITS_DEFAULTS).toEqual({ threshold_pct: 70, max_age_ms: 3_600_000, batch_max: 10, concurrency: 2 });
    expect(t6Driver.LIMITS_DEFAULTS.batch_max).toBe(t6Driver.BATCH_MAX);
    expect(t6Driver.LIMITS_DEFAULTS.concurrency).toBe(t6Driver.CONCURRENCY_MAX);
  });

  it('CONTROL: a fresh row under the threshold with an empty ledger admits the batch', () => {
    const b = t6Box('ccrc-replay-t6-pass-');
    t6Fs.writeFileSync(b.row, fresh(42, 61));
    expect(stopOf(b)).toBeNull();
  });

  it('absent: limits-stale absent', () => {
    expect(stopOf(t6Box('ccrc-replay-t6-absent-'))).toEqual({ word: 'limits-stale', detail: 'absent' });
  });

  it('a directory, a symlink to a fresh row and a FIFO: limits-stale not-regular, and the FIFO is never opened', () => {
    const b = t6Box('ccrc-replay-t6-notreg-');
    t6Fs.mkdirSync(b.row);
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'not-regular' });
    t6Fs.rmdirSync(b.row);
    const real = t6Path.join(b.home, 'elsewhere.json');
    t6Fs.writeFileSync(real, fresh(1, 1));
    t6Fs.symlinkSync(real, b.row);
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'not-regular' });
    t6Fs.unlinkSync(b.row);
    t6ExecFile('mkfifo', [b.row]);
    const t0 = Date.now();
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'not-regular' });
    expect(Date.now() - t0, 'a FIFO opened for read would block').toBeLessThan(5000);
  });

  it('unreadable (mode 000): limits-stale unreadable EACCES', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const b = t6Box('ccrc-replay-t6-unread-');
    t6Fs.writeFileSync(b.row, fresh(1, 1));
    t6Fs.chmodSync(b.row, 0o000);
    try { expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'unreadable EACCES' }); }
    finally { t6Fs.chmodSync(b.row, 0o600); }
  });

  it.each([
    ['not json', 'not json'],
    ['a JSON array', '[1, 2]'],
    // D-5806: a VALID object whose file is past the cap, so only LIMITS_ROW_CAP can answer malformed (padding inside the
    // object would leave a truncated prefix that fails JSON.parse by itself, and the row would stay green without the cap).
    ['past the 64 KiB read bound', fresh(1, 1) + ' '.repeat(65_536)],
  ])('malformed (%s): limits-stale malformed', (_label, text) => {
    const b = t6Box('ccrc-replay-t6-malformed-');
    t6Fs.writeFileSync(b.row, text);
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'malformed' });
  });

  it('five null, seven null, a percent outside 0 to 100, a row with no ts and a ts ahead of the clock: each limits-stale with its own detail', () => {
    const b = t6Box('ccrc-replay-t6-null-');
    t6Fs.writeFileSync(b.row, fresh(null, 10));
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'five-null' });
    t6Fs.writeFileSync(b.row, fresh(10, null));
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'seven-null' });
    t6Fs.writeFileSync(b.row, fresh(101, 10));
    expect(stopOf(b), 'over 100 is not a percent').toEqual({ word: 'limits-stale', detail: 'percent-out-of-range' });
    t6Fs.writeFileSync(b.row, fresh(10, -1));
    expect(stopOf(b), 'a negative value never passes the threshold').toEqual({ word: 'limits-stale', detail: 'percent-out-of-range' });
    t6Fs.writeFileSync(b.row, JSON.stringify({ five: 10, seven: 10 }));
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'ts-null' });
    t6Fs.writeFileSync(b.row, fresh(10, 10, { ts: NOW_S + 60 }));
    expect(stopOf(b), 'a minute ahead is clock skew: admitted').toBeNull();
    t6Fs.writeFileSync(b.row, fresh(10, 10, { ts: NOW_S + 3600 }));
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'ts-future 3600000' });
  });

  it('an age-inferred 0 stops as stale even when max_age_ms is raised past its age, so the inference is what stops', () => {
    const b = t6Box('ccrc-replay-t6-inferred-');
    t6Fs.writeFileSync(b.row, JSON.stringify({ five: 99, seven: 20, ts: NOW_S - 20_000 }));
    expect(stopOf(b, { maxAge: 30_000_000 })).toEqual({ word: 'limits-stale', detail: 'inferred-by-age' });
  });

  it('a resetAt-fact 0 beside a fresh seven is a measured reset: admitted', () => {
    const b = t6Box('ccrc-replay-t6-fact-');
    t6Fs.writeFileSync(b.row, JSON.stringify({ five: 87, seven: 40, ts: NOW_S - 600, fiveResetAt: NOW_S - 60, sevenResetAt: NOW_S + 200_000 }));
    expect(stopOf(b)).toBeNull();
  });

  it('older than max_age_ms: limits-stale old <age_ms>; exactly max_age_ms old still passes', () => {
    const b = t6Box('ccrc-replay-t6-old-');
    t6Fs.writeFileSync(b.row, fresh(10, 10, { ts: NOW_S - 3600 }));
    expect(stopOf(b)).toBeNull();
    t6Fs.writeFileSync(b.row, fresh(10, 10, { ts: NOW_S - 3601 }));
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'old 3601000' });
  });

  it('the threshold is inclusive: max(five, seven) 69 passes, 70 stops on either window', () => {
    const b = t6Box('ccrc-replay-t6-threshold-');
    t6Fs.writeFileSync(b.row, fresh(69, 12));
    expect(stopOf(b)).toBeNull();
    t6Fs.writeFileSync(b.row, fresh(70, 12));
    expect(stopOf(b)).toEqual({ word: 'limits-threshold', detail: 'five 70 seven 12 at or over 70' });
    t6Fs.writeFileSync(b.row, fresh(12, 70));
    expect(stopOf(b)).toEqual({ word: 'limits-threshold', detail: 'five 12 seven 70 at or over 70' });
  });

  it('the budget is inclusive: a ledger at budget-1 passes, at budget stops with budget-exhausted', () => {
    const b = t6Box('ccrc-replay-t6-budget-');
    t6Fs.writeFileSync(b.row, fresh(10, 10));
    t6Driver.recordSpend(b.out, 'run-a', 999);
    expect(stopOf(b, { budget: 1000 })).toBeNull();
    t6Driver.recordSpend(b.out, 'run-b', 1);
    expect(stopOf(b, { budget: 1000 })).toEqual({ word: 'budget-exhausted', detail: 'spent 1000 of 1000' });
  });

  it('batchGate refuses a malformed budget or limits at construction, before any read', () => {
    const b = t6Box('ccrc-replay-t6-shape-');
    const mk = (budget: number, limits: { threshold_pct: number; max_age_ms: number }) => () =>
      t6Driver.batchGate({ out: b.out, home: b.home, accountId: 'up-a', budget, limits });
    expect(mk(0, { threshold_pct: 70, max_age_ms: 1 })).toThrow('a budget is a positive integer');
    expect(mk(1.5, { threshold_pct: 70, max_age_ms: 1 })).toThrow('a budget is a positive integer');
    expect(mk(10, { threshold_pct: 0, max_age_ms: 1 })).toThrow('limits.threshold_pct');
    expect(mk(10, { threshold_pct: 101, max_age_ms: 1 })).toThrow('limits.threshold_pct');
    expect(mk(10, { threshold_pct: 70, max_age_ms: 0 })).toThrow('limits.max_age_ms');
    expect(mk(10, { threshold_pct: 70, max_age_ms: 1 })).not.toThrow();
  });
});

describe('W2-4 Task 6: a stop is resumable (W2-D55: a stopped batch spawns nothing more, and a re-run resumes)', () => {
  const NOW_S = 1_800_000_000;
  const LIMITS = { threshold_pct: 70, max_age_ms: 3_600_000 };
  /** One upstream account on the stub (Task 5's plantStub), with a canned stream whose result usage is 150 tokens. */
  const T6_UP_A = { id: 'up-a', label: 'up-a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' };
  const T6_STREAM = [
    { type: 'system', subtype: 'init', session_id: 'sess-t6', model: 'model-w', tools: [], mcp_servers: [], plugins: [], skills: [], slash_commands: [] },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ok',
      usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 } },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n';
  const rowAt = (tsS: number): string => JSON.stringify({ five: 10, seven: 20, ts: tsS, fiveResetAt: tsS + 7200, sevenResetAt: tsS + 86_400 });
  function t6Rig(prefix: string) {
    const base = mkTmp(prefix);
    const home = t6Path.join(base, 'home');
    t6Fs.mkdirSync(t6Path.join(home, '.claude'), { recursive: true });
    t6Fs.mkdirSync(t6Path.join(home, '.cc-limits'), { recursive: true });
    writeRoster(home, [T6_UP_A]);
    plantStub(home, 'up-a');
    t6Fs.writeFileSync(t6Path.join(home, 'stub-stream.jsonl'), T6_STREAM);
    const { json, roster } = t6Driver.readRoster(home);
    const launch = t6Driver.admitAccount(json, roster, 'up-a', home);
    const out = t6Driver.prepareOut(t6Path.join(base, 'out'));
    const jobs = ['t6-j1', 't6-j2', 't6-j3'].map((name) =>
      ({ launch, mode: 'writer', model: 'model-w', settingsMode: 'restricted', stdin: 'q', out, name, lang: undefined }));
    return { home, out, jobs, row: t6Path.join(home, '.cc-limits', 'up-a.json') };
  }

  it('a limits stop mid-batch spawns nothing more; refreshed, the re-run spawns only the unfinished jobs and counts spend once', async () => {
    const r = t6Rig('ccrc-replay-t6-resume-');
    t6Fs.writeFileSync(r.row, rowAt(NOW_S));
    const late = (NOW_S + 3601) * 1000;
    let calls = 0;
    // The batch's gate and the first spawn's gate see a fresh row; the clock then passes max_age_ms, so the second stops.
    const gate = t6Driver.batchGate({ out: r.out, home: r.home, accountId: 'up-a', budget: 1_000_000, limits: LIMITS,
      now: () => (++calls <= 2 ? NOW_S * 1000 : late) });
    gate();
    await expect(t6Driver.runBatch(r.jobs, { concurrency: 1, gate })).rejects.toMatchObject({ word: 'limits-stale', detail: 'old 3601000' });
    expect(stubLog(r.home)?.length, 'the first job spawned and nothing after the stop').toBe(1);
    expect(t6Fs.existsSync(t6Path.join(r.out, 't6-j1.run.json'))).toBe(true);
    expect(t6Fs.existsSync(t6Path.join(r.out, 't6-j2.run.json'))).toBe(false);
    // The operator refreshes the row (one interactive statusline render on the account); the same batch runs again.
    t6Fs.writeFileSync(r.row, rowAt(NOW_S + 3601));
    const again = t6Driver.batchGate({ out: r.out, home: r.home, accountId: 'up-a', budget: 1_000_000, limits: LIMITS, now: () => late });
    again();
    const outcomes = await t6Driver.runBatch(r.jobs, { concurrency: 1, gate: again });
    expect(outcomes.map((o) => [o.name, o.skipped]).sort()).toEqual([['t6-j1', true], ['t6-j2', false], ['t6-j3', false]]);
    expect(stubLog(r.home)?.length, 'the finished job is never re-spawned').toBe(3);
    expect(t6Driver.spentSoFar(r.out), 'three spawns of 150 tokens, each counted once: the finished job was never re-spawned').toBe(450);
  }, 60_000);

  it('a budget the first spawn exhausts stops the batch before the second spawn', async () => {
    const r = t6Rig('ccrc-replay-t6-spend-');
    t6Fs.writeFileSync(r.row, rowAt(NOW_S));
    const gate = t6Driver.batchGate({ out: r.out, home: r.home, accountId: 'up-a', budget: 150, limits: LIMITS, now: () => NOW_S * 1000 });
    gate();
    await expect(t6Driver.runBatch(r.jobs, { concurrency: 1, gate })).rejects.toMatchObject({ word: 'budget-exhausted', detail: 'spent 150 of 150' });
    expect(stubLog(r.home)?.length, 'one spawn, then the stop').toBe(1);
  }, 60_000);
});

// ── W2-4 Task 7: preflights, codeShas, the release stamp and the recall-off presence check ──────────────────────
// (W2-D56, W2-D24, W2-D6, W2-D78(ii), W2-D29, W2-D59). Function level, every HOME and tree a mkTmp fixture. The only
// child spawned is a fixture `--version` stub under the fixture HOME, through the driver's own env and cwd rules.
import * as t7fs from 'node:fs';
import * as t7path from 'node:path';
import { fileURLToPath as t7FileURLToPath } from 'node:url';
import { describe as t7describe, expect as t7expect, it as t7it } from 'vitest';
import * as t7drv from '../../deploy/history-replay.mjs';
import { sha256Hex as t7Sha, canonicalJson as t7Canon } from '../../ccd/history/lib.mjs';
import { mkTmp as t7MkTmp } from './tmpHelpers.js';

t7describe('W2-4 Task 7: preflights, codeShas, the release stamp and recall-off presence', () => {
  const REPO = t7path.resolve(t7path.dirname(t7FileURLToPath(import.meta.url)), '..', '..');
  const ROOT_SKIP = typeof process.getuid === 'function' && process.getuid() === 0;
  const H = (s: string): string => t7Sha(s);   // a well-formed sha256 for a fixture value
  /** A fixture tree holding the four gate_code files, each with its own bytes. */
  const plantTree = (): string => {
    const root = t7MkTmp('t7-tree-');
    for (const rel of t7drv.CODE_SHA_FILES) {
      t7fs.mkdirSync(t7path.join(root, t7path.dirname(rel)), { recursive: true });
      t7fs.writeFileSync(t7path.join(root, rel), `fixture bytes of ${rel}\n`);
    }
    return root;
  };
  const shasOf = (root: string): Record<string, string> =>
    Object.fromEntries(t7drv.CODE_SHA_FILES.map((rel: string) => [rel, t7Sha(t7fs.readFileSync(t7path.join(root, rel)))]));
  /** What a later subcommand compares against: step 0a's recorded values. */
  const EXPECTED = (): { claude_code_version: string; release_stamp: string; wrapper_sha256: string | null; code_shas: Record<string, string> } => ({
    claude_code_version: '9.9.9 (Claude Code)', release_stamp: 'v0.0.900', wrapper_sha256: H('wrapper'),
    code_shas: Object.fromEntries(t7drv.CODE_SHA_FILES.map((f: string) => [f, H(f)])),
  });
  /** The same values measured now, unmoved; `o` moves one. */
  const MEASURED = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: { state: 'value', version: '9.9.9 (Claude Code)' }, stamp: { state: 'value', tag: 'v0.0.900' },
    wrapperSha256: H('wrapper'), codeShas: { state: 'measured', files: { ...EXPECTED().code_shas } }, ...o,
  });
  /** The word and detail a DriverRefusal carries, or the throw itself when it is not one. */
  const refusalOf = (fn: () => unknown): { word: string; detail: string } => {
    try {
      fn();
    } catch (e) {
      if (e instanceof t7drv.DriverRefusal) return { word: (e as { word: string }).word, detail: (e as { detail: string }).detail };
      throw e;
    }
    throw new Error('expected a DriverRefusal, and nothing was thrown');
  };

  t7describe('codeShas over the four gate_code files, W2-D24', () => {
    t7it('CODE_SHA_FILES is exactly the four files gate_code pins, frozen, and TREE_ROOT is the tree the driver runs from', () => {
      t7expect([...t7drv.CODE_SHA_FILES]).toEqual(['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs']);
      t7expect(Object.isFrozen(t7drv.CODE_SHA_FILES)).toBe(true);
      t7expect(t7drv.TREE_ROOT).toBe(REPO);
    });

    t7it('over a fixture root, each entry is that file\'s sha256 and there are exactly four', () => {
      const root = plantTree();
      t7expect(t7drv.codeShas(root)).toEqual({ state: 'measured', files: shasOf(root) });
    });

    t7it.each(['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs'])(
      'one changed byte in %s changes exactly that entry', (rel) => {
        const root = plantTree();
        const before = (t7drv.codeShas(root) as { files: Record<string, string> }).files;
        const p = t7path.join(root, rel);
        const b = t7fs.readFileSync(p);
        b[0] = b[0]! ^ 1;
        t7fs.writeFileSync(p, b);
        const after = (t7drv.codeShas(root) as { files: Record<string, string> }).files;
        t7expect(Object.keys(after).filter((k) => after[k] !== before[k])).toEqual([rel]);
      });

    t7it('an absent file answers unmeasured absent, never a hash of nothing; an empty file is bytes and is hashed', () => {
      const root = plantTree();
      t7fs.rmSync(t7path.join(root, 'deploy/history-gate.mjs'));
      t7expect(t7drv.codeShas(root)).toEqual({ state: 'unmeasured', path: 'deploy/history-gate.mjs', cause: 'absent' });
      const root2 = plantTree();
      t7fs.writeFileSync(t7path.join(root2, 'ccd/history/lib.mjs'), '');
      t7expect((t7drv.codeShas(root2) as { files: Record<string, string> }).files['ccd/history/lib.mjs']).toBe(t7Sha(''));
    });

    t7it('a directory where a file belongs answers unmeasured unreadable', () => {
      const root = plantTree();
      t7fs.rmSync(t7path.join(root, 'deploy/measure-history.py'));
      t7fs.mkdirSync(t7path.join(root, 'deploy/measure-history.py'));
      t7expect(t7drv.codeShas(root)).toEqual({ state: 'unmeasured', path: 'deploy/measure-history.py', cause: 'unreadable' });
    });

    t7it.skipIf(ROOT_SKIP)('a mode-000 file answers unmeasured unreadable', () => {
      const root = plantTree();
      t7fs.chmodSync(t7path.join(root, 'deploy/history-replay.mjs'), 0o000);
      t7expect(t7drv.codeShas(root)).toEqual({ state: 'unmeasured', path: 'deploy/history-replay.mjs', cause: 'unreadable' });
    });

    t7it('over the real tree, before or after W2-3 lands: measured when history-gate.mjs exists, else unmeasured absent', () => {
      const r = t7drv.codeShas();
      if (t7fs.existsSync(t7path.join(REPO, 'deploy/history-gate.mjs'))) t7expect(r).toEqual({ state: 'measured', files: shasOf(REPO) });
      else t7expect(r).toEqual({ state: 'unmeasured', path: 'deploy/history-gate.mjs', cause: 'absent' });
    });
  });

  t7describe('readReleaseStamp keeps absent, unreadable, malformed and untagged apart', () => {
    const stampHome = (text: string | null): string => {
      const home = t7MkTmp('t7-stamp-');
      t7fs.mkdirSync(t7path.join(home, '.ccrc'), { mode: 0o700 });
      if (text !== null) t7fs.writeFileSync(t7path.join(home, '.ccrc', 'build.json'), text);
      return home;
    };
    const STAMP = { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-10-19T00:00:00Z', dirty: false };

    t7it('a tagged stamp is its version', () => {
      t7expect(t7drv.readReleaseStamp(stampHome(JSON.stringify({ ...STAMP, version: 'v0.0.900' })))).toEqual({ state: 'value', tag: 'v0.0.900' });
    });
    t7it('no build.json is absent', () => {
      t7expect(t7drv.readReleaseStamp(stampHome(null))).toEqual({ state: 'absent' });
    });
    t7it('a stamp with no version field is untagged', () => {
      t7expect(t7drv.readReleaseStamp(stampHome(JSON.stringify(STAMP)))).toEqual({ state: 'untagged' });
    });
    t7it('not JSON, an array, or a version that is not a non-empty string is malformed', () => {
      for (const text of ['{"sha":', '[]', JSON.stringify({ ...STAMP, version: 7 }), JSON.stringify({ ...STAMP, version: '' })]) {
        t7expect(t7drv.readReleaseStamp(stampHome(text)), text).toEqual({ state: 'malformed' });
      }
    });
    t7it('a directory at build.json is unreadable, with its code', () => {
      const home = stampHome(null);
      t7fs.mkdirSync(t7path.join(home, '.ccrc', 'build.json'));
      t7expect(t7drv.readReleaseStamp(home)).toEqual({ state: 'unreadable', code: 'EISDIR' });
    });
  });

  t7describe('wrapperSha and measureClaudeVersion', () => {
    /** A fixture home with one launcher at .local/bin/<id>, a node script that prints `out` and exits `rc`, logging
     *  its argv, env key names, cwd and the cwd's entries to $HOME/version-stub.json. */
    const versionHome = (id: string, out: string, rc = 0): { home: string; launcher: string } => {
      const home = t7MkTmp('t7-ver-');
      t7fs.mkdirSync(t7path.join(home, '.local', 'bin'), { recursive: true });
      t7fs.mkdirSync(t7path.join(home, '.claude'), { mode: 0o700 });
      const launcher = t7path.join(home, '.local', 'bin', id);
      t7fs.writeFileSync(launcher, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        `fs.writeFileSync(path.join(process.env.HOME, 'version-stub.json'), JSON.stringify({ argv: process.argv.slice(2), envKeys: Object.keys(process.env).sort(), cwd: process.cwd(), entries: fs.readdirSync(process.cwd()) }));`,
        `process.stdout.write(${JSON.stringify(out)});`,
        `process.exit(${rc});`,
        '',
      ].join('\n'), { mode: 0o700 });
      return { home, launcher };
    };
    const upstreamLaunch = (home: string, launcher: string) => ({
      accountId: 'up-a', kind: 'upstream', launcher, configDir: t7path.join(home, '.claude'), wrapperPath: null, secretsPath: null,
    });
    const outDir = (): string => { const d = t7MkTmp('t7-out-'); t7fs.chmodSync(d, 0o700); return d; };

    t7it('wrapperSha: a generated account\'s wrapper bytes hashed; null for upstream', () => {
      const home = t7MkTmp('t7-wrap-');
      const w = t7path.join(home, 'gen-a');
      t7fs.writeFileSync(w, '#!/bin/sh\n# fixture wrapper\n');
      t7expect(t7drv.wrapperSha({ accountId: 'gen-a', kind: 'generated', launcher: w, configDir: t7path.join(home, '.claude-gen-a'), wrapperPath: w, secretsPath: t7path.join(home, 's') }))
        .toBe(t7Sha('#!/bin/sh\n# fixture wrapper\n'));
      t7expect(t7drv.wrapperSha({ accountId: 'up-a', kind: 'upstream', launcher: w, configDir: t7path.join(home, '.claude'), wrapperPath: null, secretsPath: null })).toBeNull();
    });

    t7it('wrapperSha: an unreadable wrapper refuses wrapper-unmeasured, never wrapper-moved and never null (coordinator ruling)', () => {
      const home = t7MkTmp('t7-wrap-');
      const w = t7path.join(home, 'gen-a');
      const r = refusalOf(() => t7drv.wrapperSha({ accountId: 'gen-a', kind: 'generated', launcher: w, configDir: t7path.join(home, '.claude-gen-a'), wrapperPath: w, secretsPath: t7path.join(home, 's') }));
      t7expect(r.word).toBe('wrapper-unmeasured');
      t7expect(r.detail).toBe(`${w}: ENOENT`);
    });

    t7it('measureClaudeVersion: the first stdout line, trimmed, from --version alone, under the writer env and a fresh cwd, spending nothing', async () => {
      const { home, launcher } = versionHome('up-a', '  9.9.9 (Claude Code)  \nsecond line\n');
      const out = outDir();
      t7expect(await t7drv.measureClaudeVersion(upstreamLaunch(home, launcher), out, 'fixture.UTF-8')).toEqual({ state: 'value', version: '9.9.9 (Claude Code)' });
      const log = JSON.parse(t7fs.readFileSync(t7path.join(home, 'version-stub.json'), 'utf8'));
      t7expect(log.argv).toEqual(['--version']);
      t7expect(log.envKeys).toEqual(['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']);
      t7expect(log.entries).toEqual([]);
      t7expect(log.cwd.startsWith(out)).toBe(false);
      t7expect(t7fs.existsSync(log.cwd), 'the run cwd is removed afterwards').toBe(false);
      t7expect(t7fs.existsSync(t7path.join(out, t7drv.SPEND_LEDGER)), '--version records no spend').toBe(false);
    });

    t7it('measureClaudeVersion: a non-zero exit, or an empty first line, is failed with its code', async () => {
      const a = versionHome('up-a', '9.9.9 (Claude Code)\n', 3);
      t7expect(await t7drv.measureClaudeVersion(upstreamLaunch(a.home, a.launcher), outDir(), undefined)).toEqual({ state: 'failed', code: 3, signal: null });
      const b = versionHome('up-a', '\n9.9.9\n', 0);
      t7expect(await t7drv.measureClaudeVersion(upstreamLaunch(b.home, b.launcher), outDir(), undefined)).toEqual({ state: 'failed', code: 0, signal: null });
    });
  });

  t7describe('preflight, W2-D56: four words in a fixed order', () => {
    t7it('nothing moved: ok with no stamps', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED())).toEqual({ ok: true, stamps: [] });
    });
    t7it('a moved version is claude-version-moved', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ version: { state: 'value', version: '9.9.10 (Claude Code)' } })))
        .toEqual({ ok: false, word: 'claude-version-moved', detail: 'recorded 9.9.9 (Claude Code), measured 9.9.10 (Claude Code)' });
    });
    t7it('a failed --version is version-unmeasured, never claude-version-moved (coordinator ruling)', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ version: { state: 'failed', code: 3, signal: null } })))
        .toEqual({ ok: false, word: 'version-unmeasured', detail: '--version failed (code 3, signal null)' });
    });
    t7it('a moved release stamp is tree-moved', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ stamp: { state: 'value', tag: 'v0.0.901' } })))
        .toEqual({ ok: false, word: 'tree-moved', detail: 'recorded v0.0.900, measured v0.0.901' });
    });
    t7it.each([[{ state: 'absent' }], [{ state: 'untagged' }], [{ state: 'malformed' }], [{ state: 'unreadable', code: 'EACCES' }]])(
      'a release stamp read as %j is tree-unmeasured, never tree-moved and never a pass (coordinator ruling)', (stamp) => {
        t7expect(t7drv.preflight(EXPECTED(), MEASURED({ stamp })))
          .toEqual({ ok: false, word: 'tree-unmeasured', detail: `the release stamp is ${stamp.state}${stamp.state === 'unreadable' ? ' (EACCES)' : ''}` });
      });
    t7it('each unmeasured input refuses its own word at its place: version-unmeasured, then tree-unmeasured, then code-unmeasured', () => {
      const all = MEASURED({
        version: { state: 'failed', code: 3, signal: null }, stamp: { state: 'absent' },
        codeShas: { state: 'unmeasured', path: 'deploy/history-gate.mjs', cause: 'absent' },
      });
      const wordOf = (m: Record<string, unknown>): string => (t7drv.preflight(EXPECTED(), m) as { word: string }).word;
      const back = MEASURED();
      t7expect([
        wordOf(all),
        wordOf({ ...all, version: back.version }),
        wordOf({ ...all, version: back.version, stamp: back.stamp }),
      ]).toEqual(['version-unmeasured', 'tree-unmeasured', 'code-unmeasured']);
    });
    t7it('a moved wrapper is wrapper-moved, and so is a wrapper where none was recorded', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ wrapperSha256: H('other wrapper') }))).toMatchObject({ ok: false, word: 'wrapper-moved' });
      t7expect(t7drv.preflight({ ...EXPECTED(), wrapper_sha256: null }, MEASURED())).toMatchObject({ ok: false, word: 'wrapper-moved' });
      t7expect(t7drv.preflight({ ...EXPECTED(), wrapper_sha256: null }, MEASURED({ wrapperSha256: null }))).toEqual({ ok: true, stamps: [] });
    });
    t7it('one changed code sha is code-changed, naming that file', () => {
      const files = { ...EXPECTED().code_shas, 'ccd/history/lib.mjs': H('one byte moved') };
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ codeShas: { state: 'measured', files } })))
        .toEqual({ ok: false, word: 'code-changed', detail: 'changed ccd/history/lib.mjs' });
    });
    t7it('an unmeasured code file is code-unmeasured, never code-changed (coordinator ruling)', () => {
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ codeShas: { state: 'unmeasured', path: 'deploy/history-gate.mjs', cause: 'absent' } })))
        .toEqual({ ok: false, word: 'code-unmeasured', detail: 'deploy/history-gate.mjs is absent' });
    });
    t7it('the order is fixed: with all four moved, each word shows only once those before it are put back', () => {
      const all = MEASURED({
        version: { state: 'value', version: 'moved' }, stamp: { state: 'value', tag: 'moved' }, wrapperSha256: H('moved'),
        codeShas: { state: 'measured', files: { ...EXPECTED().code_shas, 'deploy/history-replay.mjs': H('moved') } },
      });
      const words: string[] = [];
      const m = { ...all };
      for (const [k, back] of Object.entries(MEASURED())) {
        words.push((t7drv.preflight(EXPECTED(), m) as { word: string }).word);
        m[k] = back;
      }
      t7expect(words).toEqual(['claude-version-moved', 'tree-moved', 'wrapper-moved', 'code-changed']);
    });
    t7it('allowCodeChange stamps code-changed and nothing else: an unmeasured code file still refuses code-unmeasured, a moved or unmeasured stamp still refuses', () => {
      const files = { ...EXPECTED().code_shas, 'deploy/history-gate.mjs': H('moved') };
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ codeShas: { state: 'measured', files } }), { allowCodeChange: true })).toEqual({ ok: true, stamps: ['code-changed'] });
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ codeShas: { state: 'unmeasured', path: 'deploy/history-gate.mjs', cause: 'absent' } }), { allowCodeChange: true }))
        .toEqual({ ok: false, word: 'code-unmeasured', detail: 'deploy/history-gate.mjs is absent' });
      t7expect(t7drv.preflight(EXPECTED(), MEASURED({ codeShas: { state: 'unmeasured', path: 'deploy/measure-history.py', cause: 'unreadable' } }), { allowCodeChange: true }))
        .toEqual({ ok: false, word: 'code-unmeasured', detail: 'deploy/measure-history.py is unreadable' });
      t7expect(t7drv.preflight(EXPECTED(), MEASURED(), { allowCodeChange: true })).toEqual({ ok: true, stamps: [] });
      for (const moved of [{ version: { state: 'value', version: 'moved' } }, { version: { state: 'failed', code: 3, signal: null } },
        { stamp: { state: 'value', tag: 'moved' } }, { stamp: { state: 'untagged' } }, { wrapperSha256: H('moved') }]) {
        t7expect(t7drv.preflight(EXPECTED(), MEASURED(moved), { allowCodeChange: true }).ok, JSON.stringify(moved)).toBe(false);
      }
    });
  });

  t7describe('loadStep0a checks the sha before parsing, then the shape', () => {
    const step0a = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
      kind: t7drv.STEP0A_KIND, v: 1, measured_ms: 1_800_000_000_000, account: 'up-a', settings_mode: 'restricted',
      claude_code_version: '9.9.9 (Claude Code)', wrapper_sha256: null, flags_accepted: { '--restricted': true },
      writer_init: null, judge_init: null, box_init: null, code_shas: Object.fromEntries(t7drv.CODE_SHA_FILES.map((f: string) => [f, H(f)])),
      release_stamp: 'v0.0.900', budget: 100_000, spend: 1_234, ...o,
    });
    const plant = (text: string): string => {
      const dir = t7MkTmp('t7-s0a-');
      const p = t7path.join(dir, 'step0a.json');
      t7fs.writeFileSync(p, text);
      return p;
    };

    t7it('a step 0a output with its own sha loads, whole', () => {
      const text = t7Canon(step0a()) + '\n';
      t7expect(t7drv.loadStep0a(plant(text), t7Sha(text))).toEqual(step0a());
    });
    t7it('a wrong sha refuses input-sha-mismatch, before the bytes are parsed: valid JSON and not-JSON alike', () => {
      const good = t7Canon(step0a()) + '\n';
      t7expect(refusalOf(() => t7drv.loadStep0a(plant(good), t7Sha('other bytes'))).word).toBe('input-sha-mismatch');
      t7expect(refusalOf(() => t7drv.loadStep0a(plant('{"kind":'), t7Sha('other bytes'))).word).toBe('input-sha-mismatch');
    });
    t7it('the right sha over bytes that are not JSON refuses input-invalid not-json', () => {
      t7expect(refusalOf(() => t7drv.loadStep0a(plant('{"kind":'), t7Sha('{"kind":')))).toEqual({ word: 'input-invalid', detail: 'step0a not-json' });
    });
    // D-5808: each field check of the step 0a shape, and loadStep0a's path, read and git-tree refusals, pinned by name.
    const hexOf = (c: string): string => c.repeat(64);
    t7it.each([
      ['an extra field', { extra: 1 }, (keys: string) => `fields ${keys}`],
      ['another kind', { kind: 'ccrc-history-w2-probe' }, () => 'kind'],
      ['a code sha missing', { code_shas: { 'ccd/history/lib.mjs': H('x') } }, () => 'code_shas'],
      ['a code sha that is not 64 lowercase hex', { code_shas: Object.fromEntries(t7drv.CODE_SHA_FILES.map((f: string) => [f, 'nothex'])) }, () => 'code_shas'],
      ['an unknown settings mode', { settings_mode: 'bypass' }, () => 'settings_mode'],
      ['a zero budget', { budget: 0 }, () => 'budget'],
      ['a fractional budget', { budget: 1.5 }, () => 'budget'],
      ['an empty release stamp', { release_stamp: '' }, () => 'release_stamp'],
      ['a non-string release stamp', { release_stamp: 9 }, () => 'release_stamp'],
      ['a version other than 1', { v: 2 }, () => 'v'],
      ['a zero measured_ms', { measured_ms: 0 }, () => 'measured_ms'],
      ['a fractional measured_ms', { measured_ms: 1.5 }, () => 'measured_ms'],
      ['an empty account', { account: '' }, () => 'account'],
      ['a non-string account', { account: 7 }, () => 'account'],
      ['an empty claude_code_version', { claude_code_version: '' }, () => 'claude_code_version'],
      ['a non-string claude_code_version', { claude_code_version: 1 }, () => 'claude_code_version'],
      ['a wrapper_sha256 that is not a sha', { wrapper_sha256: 'nothex' }, () => 'wrapper_sha256'],
      ['an uppercase wrapper_sha256', { wrapper_sha256: hexOf('A') }, () => 'wrapper_sha256'],
      ['a non-object flags_accepted', { flags_accepted: null }, () => 'flags_accepted'],
      ['an array flags_accepted', { flags_accepted: [true] }, () => 'flags_accepted'],
      ['a non-boolean flag', { flags_accepted: { '--restricted': 'yes' } }, () => 'flags_accepted'],
      ['a string writer_init', { writer_init: 'x' }, () => 'writer_init'],
      ['an array judge_init', { judge_init: [] }, () => 'judge_init'],
      ['a number box_init', { box_init: 3 }, () => 'box_init'],
      ['a negative spend', { spend: -1 }, () => 'spend'],
      ['a fractional spend', { spend: 0.5 }, () => 'spend'],
    ])('the right sha over %s refuses input-invalid, naming the field', (_name, o, detail) => {
      const text = t7Canon(step0a(o as Record<string, unknown>)) + '\n';
      const keys = Object.keys(step0a(o as Record<string, unknown>)).sort().join(' ');
      t7expect(refusalOf(() => t7drv.loadStep0a(plant(text), t7Sha(text)))).toEqual({ word: 'input-invalid', detail: `step0a shape ${(detail as (k: string) => string)(keys)}` });
    });
    t7it.each([['an array', '[]'], ['null', 'null'], ['a string', '"x"'], ['a number', '7']])('the right sha over %s refuses input-invalid not-object', (_name, text) => {
      t7expect(refusalOf(() => t7drv.loadStep0a(plant(text), t7Sha(text)))).toEqual({ word: 'input-invalid', detail: 'step0a shape not-object' });
    });
    t7it('a step 0a path that does not exist refuses input-invalid unreadable ENOENT, not a raw error', () => {
      const p = t7path.join(t7path.dirname(plant('x')), 'absent.json');
      t7expect(refusalOf(() => t7drv.loadStep0a(p, t7Sha('x')))).toEqual({ word: 'input-invalid', detail: 'step0a unreadable ENOENT' });
    });
    t7it('a step 0a path that is a directory refuses input-invalid unreadable EISDIR', () => {
      const dir = t7path.join(t7path.dirname(plant('x')), 'a-dir');
      t7fs.mkdirSync(dir);
      t7expect(refusalOf(() => t7drv.loadStep0a(dir, t7Sha('x')))).toEqual({ word: 'input-invalid', detail: 'step0a unreadable EISDIR' });
    });
    t7it('an empty or non-string step 0a path refuses args-invalid', () => {
      const sha = t7Sha('x');
      t7expect(refusalOf(() => t7drv.loadStep0a('', sha))).toEqual({ word: 'args-invalid', detail: '--step0a names no path' });
      t7expect(refusalOf(() => t7drv.loadStep0a(undefined, sha))).toEqual({ word: 'args-invalid', detail: '--step0a names no path' });
    });
    t7it.skipIf(process.getuid?.() === 0)('a step 0a path whose ancestor cannot be measured refuses input-invalid git-unmeasured, before the file is read', () => {
      const text = t7Canon(step0a()) + '\n';
      const p = plant(text);
      const dir = t7path.dirname(p);
      t7fs.chmodSync(dir, 0o000);
      try {
        t7expect(refusalOf(() => t7drv.loadStep0a(p, t7Sha(text)))).toEqual({ word: 'input-invalid', detail: `step0a git-unmeasured ${t7path.join(dir, '.git')} EACCES` });
      } finally {
        t7fs.chmodSync(dir, 0o700);
      }
    });
    t7it('a step 0a file inside a git tree refuses input-invalid, before it is read', () => {
      const text = t7Canon(step0a()) + '\n';
      const p = plant(text);
      t7fs.mkdirSync(t7path.join(t7path.dirname(p), '.git'));
      t7expect(refusalOf(() => t7drv.loadStep0a(p, t7Sha(text)))).toEqual({ word: 'input-invalid', detail: `step0a in-git-tree ${t7path.dirname(p)}` });
    });
    t7it('a --step0a-sha256 that is not 64 lowercase hex refuses args-invalid', () => {
      const text = t7Canon(step0a()) + '\n';
      t7expect(refusalOf(() => t7drv.loadStep0a(plant(text), t7Sha(text).toUpperCase())).word).toBe('args-invalid');
    });
  });

  t7describe('recall-off presence, W2-D78 ii: lstat whatever the entry, ENOENT alone is absent', () => {
    /** Where lib's recallOffPath puts `<id>` under `home` (the CONTROL below holds the two equal). */
    const roPath = (home: string, id: string): string => t7path.join(home, '.ccrc', 'history', 'recall-off', id);
    const roHome = (): { home: string; dir: string } => {
      const home = t7MkTmp('t7-ro-');
      const dir = t7path.dirname(roPath(home, 'fam-a'));
      t7fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      return { home, dir };
    };

    t7it('CONTROL: the fixture path is lib\'s recallOffPath', async () => {
      const lib = await import('../../ccd/history/lib.mjs');
      const home = t7MkTmp('t7-ro-');
      t7expect(lib.recallOffPath(home, 'fam-a')).toBe(roPath(home, 'fam-a'));
    });
    t7it('absent passes: no recall-off directory at all, and an empty one', () => {
      t7expect(t7drv.recallOffPresence(t7MkTmp('t7-ro-'), ['fam-a', 'fam-b'])).toEqual({ present: [], unmeasured: [] });
      const { home } = roHome();
      t7expect(t7drv.recallOffPresence(home, ['fam-a'])).toEqual({ present: [], unmeasured: [] });
      t7expect(() => t7drv.refuseRecallOff(home, ['fam-a'])).not.toThrow();
    });
    t7it.each([
      ['a regular file', (p: string) => t7fs.writeFileSync(p, 'a-generation\n')],
      ['an empty file', (p: string) => t7fs.writeFileSync(p, '')],
      ['a directory', (p: string) => t7fs.mkdirSync(p)],
      ['a dangling symlink', (p: string) => t7fs.symlinkSync(t7path.join(t7path.dirname(p), 'nowhere'), p)],
    ])('%s is present, and refuses family-recall-off', (_name, plantEntry) => {
      const { home, dir } = roHome();
      plantEntry(t7path.join(dir, 'fam-b'));
      t7expect(t7drv.recallOffPresence(home, ['fam-a', 'fam-b'])).toEqual({ present: ['fam-b'], unmeasured: [] });
      t7expect(refusalOf(() => t7drv.refuseRecallOff(home, ['fam-a', 'fam-b']))).toEqual({ word: 'family-recall-off', detail: 'present fam-b' });
    });
    t7it.skipIf(ROOT_SKIP)('a recall-off directory with mode 000 answers unmeasured, and refuses', () => {
      const { home, dir } = roHome();
      t7fs.chmodSync(dir, 0o000);
      try {
        t7expect(t7drv.recallOffPresence(home, ['fam-a'])).toEqual({ present: [], unmeasured: [{ id: 'fam-a', code: 'EACCES' }] });
        t7expect(refusalOf(() => t7drv.refuseRecallOff(home, ['fam-a']))).toEqual({ word: 'family-recall-off', detail: 'unmeasured fam-a EACCES' });
      } finally {
        t7fs.chmodSync(dir, 0o700);
      }
    });
    t7it('an id lib refuses is input-invalid, never read as absent and never exit 1 (coordinator ruling)', () => {
      t7expect(refusalOf(() => t7drv.recallOffPresence(t7MkTmp('t7-ro-'), ['../escape'])))
        .toEqual({ word: 'input-invalid', detail: 'family id "../escape" is not a session id' });
      t7expect(refusalOf(() => t7drv.refuseRecallOff(t7MkTmp('t7-ro-'), ['fam-a', '../escape'])), 'refuseRecallOff carries the same refusal')
        .toEqual({ word: 'input-invalid', detail: 'family id "../escape" is not a session id' });
    });
    t7it('the driver names recall-off on exactly one code line, an lstatSync of recallOffPath, and never spells the directory', () => {
      const code = t7fs.readFileSync(t7path.join(REPO, 'deploy', 'history-replay.mjs'), 'utf8').split('\n')
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
      const naming = (lines: string[]): string[] => lines.filter((l) => l.includes('recallOffPath(')).map((l) => l.trim());
      const spells = (lines: string[]): string[] => lines.filter((l) => /\/recall-off|'recall-off'|RECALL_OFF_DIR/.test(l));
      t7expect(naming(code)).toEqual(['lstatSync(recallOffPath(home, id));']);
      t7expect(spells(code)).toEqual([]);
      // CONTROL: both needles see a planted line.
      t7expect(naming(['  writeFileSync(recallOffPath(home, id), g);'])).toHaveLength(1);
      t7expect(spells(["  const p = path.join(root, 'recall-off', id);"])).toHaveLength(1);
    });
  });
});

// ── W2-4 Task 8: step 0a, end to end (W2-D57, W2-D55, W2-D24, W2-D52, W2-D51) ──────────────────────────────────
// The subcommand as the operator runs it: a child process with a fixture HOME (t8Run, runDriver's env contract over
// a driver copy) against Task 5's recording stub. Every rostered id's launcher is a stub and every id has a fresh
// limits row, so a spawn of ANY account, admitted or not, leaves a log line, and only admission can stop it. Each
// run uses a fixture tree (t8Tree): a copy of the driver beside fixture bytes for the two gate_code files this PR
// does not own, so codeShas() is measured whichever of W2-3 and this PR merges first and the recorded shas can be
// pinned exactly; lib.mjs is copied, and ccd/history's other entries and shared/ are symlinks to this checkout.
describe('W2-4 Task 8: step0a end to end', () => {
  const T8_SESSION = '00000000-0000-4000-8000-0000000000a8';
  const T8_USAGE = { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 50 };
  const T8_PER_RUN = 200;   // the sum of T8_USAGE: what one run spends
  const T8_STREAM = [
    { type: 'system', subtype: 'init', session_id: T8_SESSION, model: 'fixture-model-writer', tools: [], mcp_servers: [], plugins: [], skills: [], slash_commands: [] },
    { type: 'assistant', message: { id: 'msg-t8-1', role: 'assistant', content: [{ type: 'text', text: 'ready' }], usage: T8_USAGE } },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'ready', usage: T8_USAGE, permission_denials: [] },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n';
  const T8_STAMP = 'v9.9.9';
  const T8_GATE_BYTES = '// fixture bytes for deploy/history-gate.mjs (W2-4 Task 8)\n';
  const T8_MEASURE_BYTES = '# fixture bytes for deploy/measure-history.py (W2-4 Task 8)\n';
  const T8_CALLER_ENV = {
    TMUX: '/tmp/fixture-tmux,1,0', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'fixture-session', CCRC_SESSION_GENERATION: 'fixture-generation',
    CCRC_RECALL_SESSION: 'fixture-session', CCRC_RECALL_ARM: 'fixture-arm', CCRC_RECALL_ASOF: 'fixture-asof',
  };
  const T8_MODELS = { writer: 'fixture-model-writer', judge: 'fixture-model-judge', box: 'fixture-model-arm' } as const;
  /** Step0aOutput's fifteen keys, sorted. */
  const T8_STEP0A_KEYS = ['account', 'box_init', 'budget', 'claude_code_version', 'code_shas', 'flags_accepted', 'judge_init',
    'kind', 'measured_ms', 'release_stamp', 'settings_mode', 'spend', 'v', 'wrapper_sha256', 'writer_init'];

  /** A limits row read as fresh: `five` and `seven` as given, sampled a minute ago, both windows still running. */
  function t8Limits(home: string, id: string, five: number, seven: number): void {
    const nowS = Math.floor(Date.now() / 1000);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    writeFileSync(path.join(home, '.cc-limits', `${id}.json`),
      JSON.stringify({ five, seven, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
  }

  /** A fixture HOME: Task 3's twelve rows (FIXTURE_ACCOUNTS); a stub at every id's launcher; gen-a's real wrapper (over its stub)
   *  and its secrets file, whose token is assembled here; gen-r's secrets file at mode 000, gen-d's a directory; a fresh limits row
   *  for every id, so only admission can stop a refused one; a tagged release stamp; the canned stream every stub prints. */
  function t8Home(prefix: string): string {
    const home = mkTmp(prefix);
    writeRoster(home, FIXTURE_ACCOUNTS);
    for (const a of FIXTURE_ACCOUNTS as Array<{ id: string }>) { plantStub(home, a.id); t8Limits(home, a.id, 10, 20); }
    const flat = rosterFromJson(JSON.parse(readFileSync(path.join(home, '.ccrc', 'accounts.json'), 'utf8')));
    const byId = new Map(flat.accounts.map((a) => [a.id, a]));
    writeFileSync(path.join(home, '.local', 'bin', 'gen-a'), generateWrapperBody(byId.get('gen-a')!, flat.upstreamId), { mode: 0o755 });
    for (const id of ['gen-a', 'gen-r']) {
      const p = path.join(home, byId.get(id)!.secretsFile!);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, `export CLAUDE_CODE_OAUTH_TOKEN=${['sk', 'ant', 'oat01', 'fixture', 't8'].join('-')}\n`, { mode: 0o600 });
    }
    chmodSync(path.join(home, byId.get('gen-r')!.secretsFile!), 0o000);
    // D-5809: gen-d's declared secretsFile is a DIRECTORY (RP9), so admission alone can stop it.
    mkdirSync(path.join(home, byId.get('gen-d')!.secretsFile!), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'build.json'),
      JSON.stringify({ sha: 'fixture', ref: 'main', builtAt: '2026-10-19T00:00:00Z', dirty: false, version: T8_STAMP }));
    writeFileSync(path.join(home, STUB_STREAM), T8_STREAM);
    return home;
  }

  /** A tree the driver runs from: its own bytes copied (so TREE_ROOT is this tree), fixture bytes for the two
   *  gate_code files this PR does not own (`gate: false` leaves deploy/history-gate.mjs out), lib.mjs copied and
   *  ccd/history's other entries and shared/ symlinked to this checkout, so every import resolves. */
  function t8Tree(opts: { gate?: boolean } = {}): string {
    const repo = path.resolve(path.dirname(SCRIPT), '..');
    const tree = mkTmp('ccrc-w2-t8-tree-');
    mkdirSync(path.join(tree, 'deploy'));
    copyFileSync(SCRIPT, path.join(tree, 'deploy', 'history-replay.mjs'));
    if (opts.gate !== false) writeFileSync(path.join(tree, 'deploy', 'history-gate.mjs'), T8_GATE_BYTES);
    writeFileSync(path.join(tree, 'deploy', 'measure-history.py'), T8_MEASURE_BYTES);
    mkdirSync(path.join(tree, 'ccd', 'history'), { recursive: true });
    for (const n of readdirSync(path.join(repo, 'ccd', 'history'))) {
      const from = path.join(repo, 'ccd', 'history', n);
      const to = path.join(tree, 'ccd', 'history', n);
      if (n === 'lib.mjs') copyFileSync(from, to); else symlinkSync(from, to);
    }
    symlinkSync(path.join(repo, 'shared'), path.join(tree, 'shared'));
    return tree;
  }

  /** runDriver's contract, for the driver copy in `tree`. */
  function t8Run(tree: string, home: string, args: string[], extraEnv: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [path.join(tree, 'deploy', 'history-replay.mjs'), ...args],
      { env: { ...scrubbedEnv(process.env), HOME: home, ...extraEnv }, encoding: 'utf8', timeout: 120_000 });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  /** A fresh --out path whose parent exists (Task 2 creates it). */
  const t8Out = (): string => path.join(mkTmp('ccrc-w2-t8-out-'), 'out');

  /** step0a's argv: every flag it requires, `over` replacing a value or (null) leaving the flag out. */
  function t8Argv(out: string, over: Record<string, string | null> = {}): string[] {
    const base: Record<string, string | null> = {
      out, account: 'up-a', budget: '100000', 'writer-model': T8_MODELS.writer, 'judge-model': T8_MODELS.judge,
      'arm-model': T8_MODELS.box, ...over,
    };
    return ['step0a', ...Object.entries(base).flatMap(([k, v]) => (v === null ? [] : [`--${k}`, v]))];
  }

  /** The stub's log lines for the batch's runs (print mode), by the model each was given. */
  function t8Runs(home: string): Array<Record<string, any>> {
    return (stubLog(home) ?? []).filter((e) => (e.argv as string[]).includes('-p'));
  }
  const t8ModelOf = (e: Record<string, any>): string => (e.argv as string[])[(e.argv as string[]).indexOf('--model') + 1]!;

  it('flagsAccepted: every flag the argvs carry, each true unless a run named it an unknown option', () => {
    const argvs = [['--restricted', '-p', '--tools', '', '--model', 'm1'], ['--restricted', '-p', '--tools', 'Bash,Agent', '--allowedTools', 'Bash(x:*)']];
    const ok = { unknownOptions: [] as string[] };
    expect(replay.flagsAccepted(argvs, [ok, ok])).toEqual({ '--restricted': true, '-p': true, '--tools': true, '--model': true, '--allowedTools': true });
    const named: Record<string, boolean> = replay.flagsAccepted(argvs, [ok, { unknownOptions: ['--allowedTools'] }]);
    expect(named['--allowedTools']).toBe(false);
    expect(Object.entries(named).filter(([, v]) => !v).map(([k]) => k)).toEqual(['--allowedTools']);
  });

  it('records the step 0a facts in step0a json under --out and prints the sha256 of its bytes, RP1-contract through the subcommand', async () => {
    const home = t8Home('ccrc-w2-t8-green-');
    const tree = t8Tree();
    const out = t8Out();
    // The caller's own session variables (all but TMUX_PANE, which refuses) must not reach a spawn.
    const r = t8Run(tree, home, t8Argv(out), T8_CALLER_ENV);
    expect(r.code, r.stderr).toBe(0);
    const file = path.join(out, replay.STEP0A_FILE);
    const bytes = readFileSync(file);
    expect(r.stdout).toBe(`sha256 ${sha256Hex(bytes)}\n`);
    const text = bytes.toString('utf8');
    expect(text.endsWith('\n') && !text.endsWith('\n\n')).toBe(true);
    const rec = JSON.parse(text);
    expect(Object.keys(rec).sort()).toEqual(T8_STEP0A_KEYS);
    expect(rec).toMatchObject({ kind: 'ccrc-history-w2-step0a', v: 1, account: 'up-a', settings_mode: 'restricted', wrapper_sha256: null,
      release_stamp: T8_STAMP, budget: 100000, spend: 3 * T8_PER_RUN });
    expect(replay.STEP0A_KIND).toBe('ccrc-history-w2-step0a');
    expect(rec.code_shas).toEqual({
      'deploy/history-gate.mjs': sha256Hex(T8_GATE_BYTES),
      'deploy/measure-history.py': sha256Hex(T8_MEASURE_BYTES),
      'deploy/history-replay.mjs': sha256Hex(readFileSync(SCRIPT)),
      'ccd/history/lib.mjs': sha256Hex(readFileSync(path.join(path.dirname(SCRIPT), '..', 'ccd', 'history', 'lib.mjs'))),
    });
    const init = replay.readStreamJson(T8_STREAM).init;
    expect(init).not.toBeNull();
    expect([rec.writer_init, rec.judge_init, rec.box_init]).toEqual([init, init, init]);
    expect(typeof rec.measured_ms).toBe('number');
    expect(readdirSync(path.join(out, 'step0a')).filter((n) => n.endsWith('.jsonl')).sort()).toEqual(['box.jsonl', 'judge.jsonl', 'writer.jsonl']);

    // RP1-contract through the subcommand: one run per mode, each exactly the contract's argv for its model.
    const runs = t8Runs(home);
    expect(runs.map(t8ModelOf).sort()).toEqual([T8_MODELS.box, T8_MODELS.judge, T8_MODELS.writer]);
    const want = {
      writer: replay.spawnArgv({ mode: 'writer', model: T8_MODELS.writer, settingsMode: 'restricted', home }),
      judge: replay.spawnArgv({ mode: 'judge', model: T8_MODELS.judge, settingsMode: 'restricted', home }),
      box: replay.spawnArgv({ mode: 'box', model: T8_MODELS.box, settingsMode: 'restricted', home }),
    };
    for (const e of runs) {
      const key = (Object.keys(T8_MODELS) as Array<keyof typeof T8_MODELS>).find((k) => T8_MODELS[k] === t8ModelOf(e))!;
      const argv = e.argv as string[];
      expect(argv, key).toEqual(want[key]);
      expect(e.stdin, key).toBe(replay.STEP0A_PROMPT);
      expect(e.envKeys, key).toEqual(['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']);
      expect(argv.some((t) => /dangerously|bypassPermissions/.test(t)), key).toBe(false);
      if (key === 'box') {
        expect(argv.slice(argv.indexOf('--tools'), argv.indexOf('--tools') + 2)).toEqual(['--tools', 'Bash,Agent']);
        for (const s of replay.allowedToolSpellings(home)) expect(argv).toContain(s);
      } else {
        expect(argv.slice(argv.indexOf('--tools'), argv.indexOf('--tools') + 2), key).toEqual(['--tools', '']);
        expect(argv, key).not.toContain('--allowedTools');
      }
    }
    // Every flag the three argvs carry is recorded, and the stub rejected none.
    const flags = [...new Set(Object.values(want).flat().filter((t) => t.startsWith('-')))].sort();
    expect(Object.keys(rec.flags_accepted).sort()).toEqual(flags);
    expect(Object.values(rec.flags_accepted).every((v) => v === true)).toBe(true);
    expect(flags).toEqual(expect.arrayContaining(['--restricted', '--no-session-persistence', '--strict-mcp-config', '--verbose', '--max-turns', '--model', '--tools', '--allowedTools']));

    // The version is the one the launcher answers (measured last: it adds a line to the stub's log).
    const { json, roster } = replay.readRoster(home);
    const v = await replay.measureClaudeVersion(replay.admitAccount(json, roster, 'up-a', home), mkTmp('ccrc-w2-t8-version-'), undefined);
    expect(v).toEqual({ state: 'value', version: rec.claude_code_version });
    // Task 1's grammar cases use an unregistered name; this task pins its own registration (has, not the exact
    // key list, which Task 9 extends).
    expect(replay.HANDLERS.has('step0a'), 'step0a is registered').toBe(true);
  }, 120_000);

  // D-5809: the writer and its validator cannot drift. The file step0a wrote, loaded back through Task 7's loadStep0a with
  // the sha256 step0a printed, comes back as the same object the file parses to.
  it('the step0a json it wrote loads back through loadStep0a with the sha256 it printed, as the same object', () => {
    const home = t8Home('ccrc-w2-t8-roundtrip-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out));
    expect(r.code, r.stderr).toBe(0);
    const printed = /^sha256 ([0-9a-f]{64})\n$/.exec(r.stdout);
    expect(printed, r.stdout).not.toBeNull();
    const file = path.join(out, replay.STEP0A_FILE);
    expect(replay.loadStep0a(file, printed![1]!)).toEqual(JSON.parse(readFileSync(file, 'utf8')));
  }, 120_000);

  it('the fallback settings mode is recorded, and its flags replace --restricted in flags_accepted', () => {
    const home = t8Home('ccrc-w2-t8-fallback-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { 'settings-mode': 'fallback' }));
    expect(r.code, r.stderr).toBe(0);
    const rec = JSON.parse(readFileSync(path.join(out, replay.STEP0A_FILE), 'utf8'));
    expect(rec.settings_mode).toBe('fallback');
    expect(rec.flags_accepted['--setting-sources']).toBe(true);
    expect(rec.flags_accepted['--settings']).toBe(true);
    expect(rec.flags_accepted).not.toHaveProperty('--restricted');
    for (const e of t8Runs(home)) expect((e.argv as string[]).slice(0, 4)).toEqual(['--setting-sources', 'project,local', '--settings', '{"disableAllHooks":true}']);
  }, 120_000);

  it('a generated account runs through its own wrapper, and step0a records that wrapper sha256', () => {
    const home = t8Home('ccrc-w2-t8-wrapper-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { account: 'gen-a' }));
    expect(r.code, r.stderr).toBe(0);
    const rec = JSON.parse(readFileSync(path.join(out, replay.STEP0A_FILE), 'utf8'));
    expect(rec.account).toBe('gen-a');
    expect(rec.wrapper_sha256).toBe(sha256Hex(readFileSync(path.join(home, '.local', 'bin', 'gen-a'))));
    const runs = t8Runs(home);
    expect(runs).toHaveLength(3);
    for (const e of runs) expect(e.envKeys).toContain('CLAUDE_CODE_OAUTH_TOKEN');   // by name only: the stub never logs its value
  }, 120_000);

  // RP3-admission and RP9 through the subcommand. gen-r's mode-000 file is readable to root, so as root its row is left out.
  // gen-u is not a row: a generated account with no declared provider reads as anthropic (the admission ruling, Task 3).
  const T8_REFUSED: Array<[string, string]> = ([
    ['cx-a', 'kind-codex'], ['ext-n', 'kind-external'], ['ext-a', 'kind-external'], ['gen-o', 'provider-openai'],
    ['gen-h', 'hidden'], ['gen-s', 'secrets-undeclared'], ['gen-m', 'secrets-absent'],
    // D-5809: gen-d, a secretsFile that is a directory, is a row.
    ['gen-r', 'secrets-unreadable'], ['gen-d', 'secrets-not-regular'], ['nobody-a', 'unknown-id'],
  ] as Array<[string, string]>).filter(([id]) => id !== 'gen-r' || process.getuid?.() !== 0);
  it.each(T8_REFUSED)('account %s is refused before any spawn: account-refused %s, no stub line, nothing under --out but its marker', (id, detail) => {
    const home = t8Home('ccrc-w2-t8-refused-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { account: id }));
    expect(stubLog(home), 'a spawn reached the stub').toBeNull();
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(`ccrc history-replay: account-refused: ${detail}\n`);
    expect(readdirSync(out)).toEqual([replay.OUT_MARKER]);
  }, 60_000);

  // D-5809: an upstream account whose config dir is not exactly $HOME/.claude (Task 3's up-b, the roster's one upstream)
  // is refused upstream-config-dir through the subcommand, with a stub and a fresh limits row planted so only admission stops it.
  it('an upstream account whose config dir is not $HOME/.claude is refused account-refused upstream-config-dir before any spawn', () => {
    const home = t8Home('ccrc-w2-t8-upconf-');
    writeRoster(home, [fixtureAccount('up-b', { kind: 'upstream' }, { homeAble: true, telemetry: 'anthropic' })]);
    plantStub(home, 'up-b');
    t8Limits(home, 'up-b', 10, 20);
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { account: 'up-b' }));
    expect(stubLog(home), 'a spawn reached the stub').toBeNull();
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('ccrc history-replay: account-refused: upstream-config-dir\n');
    expect(readdirSync(out)).toEqual([replay.OUT_MARKER]);
  }, 60_000);

  it.each(['out', 'account', 'budget', 'writer-model', 'judge-model', 'arm-model'])('a missing --%s is refused args-invalid before any spawn', (flag) => {
    const home = t8Home('ccrc-w2-t8-required-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { [flag]: null }));
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(`ccrc history-replay: args-invalid: ${flag}-required\n`);
    expect(stubLog(home)).toBeNull();
    expect(existsSync(path.join(out, replay.STEP0A_FILE))).toBe(false);
    if (flag === 'out') expect(existsSync(out)).toBe(false);
  }, 60_000);

  it('an empty HOME is refused args-invalid before --out is made, as the probe refuses it', () => {
    const home = t8Home('ccrc-w2-t8-home-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out), { HOME: '' });
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('ccrc history-replay: args-invalid: HOME is unset or not absolute\n');
    expect(existsSync(out)).toBe(false);
    expect(stubLog(home)).toBeNull();
  }, 60_000);

  it('a settings mode outside SETTINGS_MODES is refused args-invalid before any spawn', () => {
    const home = t8Home('ccrc-w2-t8-settings-');
    const r = t8Run(t8Tree(), home, t8Argv(t8Out(), { 'settings-mode': 'open' }));
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('ccrc history-replay: args-invalid: settings-mode open\n');
    expect(stubLog(home)).toBeNull();
  }, 60_000);

  it('an unmeasured code sha refuses code-unmeasured, and an untagged stamp tree-unmeasured, before any spawn', () => {
    const home = t8Home('ccrc-w2-t8-unmeasured-');
    const noGate = t8Run(t8Tree({ gate: false }), home, t8Argv(t8Out()));
    expect(noGate.code).toBe(2);
    expect(noGate.stderr).toBe('ccrc history-replay: code-unmeasured: deploy/history-gate.mjs is absent\n');
    writeFileSync(path.join(home, '.ccrc', 'build.json'), JSON.stringify({ sha: 'fixture', ref: 'main', dirty: false }));
    const untagged = t8Run(t8Tree(), home, t8Argv(t8Out()));
    expect(untagged.code).toBe(2);
    expect(untagged.stderr).toBe('ccrc history-replay: tree-unmeasured: stamp untagged\n');
    expect(stubLog(home)).toBeNull();
  }, 60_000);

  it('a generated account whose wrapper cannot be read stops step0a with wrapper-unmeasured before any spawn or spend (coordinator ruling)', () => {
    const home = t8Home('ccrc-w2-t8-wrapper-unread-');
    const wrapper = path.join(home, '.local', 'bin', 'gen-a');
    rmSync(wrapper);
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { account: 'gen-a' }));
    expect(stubLog(home), 'a spawn reached the stub').toBeNull();
    expect(r.code).toBe(2);
    expect(readdirSync(out), 'no spawn and no spend: nothing under --out but its marker').toEqual([replay.OUT_MARKER]);
    expect(r.stderr).toBe(`ccrc history-replay: wrapper-unmeasured: ${wrapper}: ENOENT\n`);
  }, 60_000);

  it('a budget the first run exhausts stops before the second, and a larger budget resumes without re-spawning the first', () => {
    const home = t8Home('ccrc-w2-t8-budget-');
    const tree = t8Tree();
    const out = t8Out();
    const stopped = t8Run(tree, home, t8Argv(out, { budget: String(T8_PER_RUN) }));
    expect(stopped.code).toBe(2);
    expect(stopped.stderr.startsWith('ccrc history-replay: budget-exhausted: ')).toBe(true);
    expect(t8Runs(home).map(t8ModelOf)).toEqual([T8_MODELS.writer]);
    expect(existsSync(path.join(out, replay.STEP0A_FILE))).toBe(false);
    const resumed = t8Run(tree, home, t8Argv(out, { budget: String(10 * T8_PER_RUN) }));
    expect(resumed.code, resumed.stderr).toBe(0);
    expect(t8Runs(home).map(t8ModelOf)).toEqual([T8_MODELS.writer, T8_MODELS.judge, T8_MODELS.box]);
    const rec = JSON.parse(readFileSync(path.join(out, replay.STEP0A_FILE), 'utf8'));
    expect(rec).toMatchObject({ budget: 10 * T8_PER_RUN, spend: 3 * T8_PER_RUN });
    expect(rec.writer_init).toEqual(replay.readStreamJson(T8_STREAM).init);
  }, 120_000);

  it('a limits row at the threshold stops before any spawn, the version spawn included', () => {
    const home = t8Home('ccrc-w2-t8-limits-');
    t8Limits(home, 'up-a', 70, 20);
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out));
    expect(r.code).toBe(2);
    expect(r.stderr.startsWith('ccrc history-replay: limits-threshold: ')).toBe(true);
    expect(stubLog(home)).toBeNull();
    expect(readdirSync(out)).toEqual([replay.OUT_MARKER]);
  }, 60_000);

  it('a launcher whose version cannot be measured stops step0a before its batch, refusing version-unmeasured, recording nothing', () => {
    const home = t8Home('ccrc-w2-t8-version-');
    chmodSync(path.join(home, '.local', 'bin', 'up-a'), 0o644);
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out));
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/^ccrc history-replay: version-unmeasured: \S+ --version failed \(code [^\n]*\)\n$/);
    expect(existsSync(path.join(out, 'step0a'))).toBe(false);
    expect(existsSync(path.join(out, replay.STEP0A_FILE))).toBe(false);
    expect(stubLog(home)).toBeNull();
  }, 60_000);
});
