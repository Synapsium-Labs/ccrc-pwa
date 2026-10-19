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
