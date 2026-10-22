// deploy/history-replay.mjs: the ccrc history W2 replay driver (spec 2026-10-05 §10.2; W2 decisions W2-D50 to W2-D59).
// The ONE test file W2 creates (W2-D5). It is listed in ci.yml's node-floor heredoc, so the 22.16.0 leg runs it on
// every pull request; ci-pipeline.test.ts derives that list from this directory and reds when the line is missing.
//
// ISOLATION: every spawn runs on a mkTmp fixture HOME with historyHelpers' scrubbedEnv, which drops the session's
// own TMUX, TMUX_PANE, CLAUDECODE, CLAUDE_CONFIG_DIR, CCRC_SESSION_GENERATION and CCRC_RECALL_* first. Children are
// spawned with an argv array on process.execPath, never through a shell. Key-shaped fixture values are assembled at
// run time; no fixture names a real account, host or path.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
// W2-5a Task 1 (W2-D74, W2-D75, W2-D33, W2-D24): w5a1-prefixed bindings, so none collides with a binding above. The
// fixture store is built by the real sweep in a historyHelpers box (a mkTmp HOME whose PATH holds the poisoned gh) and
// read here, in process, through the driver's exports.
import { beforeAll as w5a1BeforeAll } from 'vitest';
import { DatabaseSync as W5a1Db } from 'node:sqlite';
import { brotliCompressSync as w5a1Brotli } from 'node:zlib';
import * as w5a1H from './historyHelpers.js';
import * as w5a1Fx from './historyFixtures.js';
import * as w5a1Lib from '../../ccd/history/lib.mjs';
import * as w5a1Derive from '../../ccd/history/derive.mjs';
import * as w5a1Recall from '../../ccd/history/recall.mjs';
import { createStore as w5a1CreateStore } from '../../ccd/history/store.mjs';
import * as w5a1Gate from '../../deploy/history-gate.mjs';
import * as w5a1Drv from '../../deploy/history-replay.mjs';

const SCRIPT = path.join(REPO, 'deploy', 'history-replay.mjs');

/** One driver run as the operator makes it: node on the script, an argv array, a fixture HOME, the scrubbed env plus
 *  `extraEnv`, and the HOME as cwd so a relative path never lands in the checkout. */
function runDriver(home: string, args: string[], extraEnv: Record<string, string> = {}): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], {
    cwd: home, encoding: 'utf8', timeout: 60_000,
    env: { ...scrubbedEnv(process.env), HOME: home, ...extraEnv },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ── D-5985: the claim every runBatch, launchRun and step0bMechanics call needs ────────────────────────────
// A case that calls the runner directly claims its --out first, as a subcommand does after prepareOut. `claimFor` makes
// the claim once per --out and releases every claim after the test, so the lock never outlives a case. `claimedBatch` and
// `claimedRun` are runBatch and launchRun with that claim added; a case that pins the claim requirement itself calls
// the exports bare.
type Claim = ReturnType<typeof replay.claimOut>;
const claimsByOut = new Map<string, Claim>();
function claimFor(out: string, liveness?: typeof replay.liveness): Claim {
  const have = claimsByOut.get(out);
  if (have !== undefined) return have;
  const c = replay.claimOut(out, liveness === undefined ? {} : { liveness });
  claimsByOut.set(out, c);
  return c;
}
afterEach(() => {
  for (const c of claimsByOut.values()) c.release();
  claimsByOut.clear();
});
const claimedBatch = (jobs: Parameters<typeof replay.runBatch>[0], opts: Record<string, unknown> = {}): ReturnType<typeof replay.runBatch> =>
  replay.runBatch(jobs, { claim: claimFor((jobs[0] as { out: string }).out), ...opts } as never);
const claimedRun = (job: Parameters<typeof replay.launchRun>[0], opts: Record<string, unknown> = {}): ReturnType<typeof replay.launchRun> =>
  replay.launchRun(job, { claim: claimFor((job as { out: string }).out), ...opts } as never);

// ── D-5984, D-5985: helpers for the cases that run, signal and wait on real child processes ─────────────────
const HAS_PROC = existsSync('/proc/self/stat');
/** Field 22 of /proc/<pid>/stat, read as the driver reads it (the text after the last ')' starts at field 3). */
const startOf = (pid: number): string => {
  const t = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return t.slice(t.lastIndexOf(')') + 1).trim().split(/\s+/)[19]!;
};
/** A pid record's bytes, as the driver writes them (sorted keys, one newline). */
const recText = (pid: number, start: string | null): string => `{"pid":${pid},"start":${start === null ? 'null' : JSON.stringify(start)}}\n`;
/** A wait on a child that cannot hang the suite. */
const bounded = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: NodeJS.Timeout;
  const clock = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms: ${what}`)), ms); });
  return Promise.race([p, clock]).finally(() => clearTimeout(timer));
};
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Poll `ok` every 50 ms for at most `ms`; true when it held. */
async function until(ok: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (ok()) return true; await pause(50); }
  return ok();
}
/** True when no process answers to the group (ESRCH). */
const groupGone = (pid: number): boolean => { try { process.kill(-pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; } };
/** Child processes a case started; killed after it (only these pids) so a failed case leaves nothing running. */
const startedChildren: Array<ReturnType<typeof spawn>> = [];
function sleeperChild(): ReturnType<typeof spawn> {
  const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  startedChildren.push(c);
  return c;
}
/** A pid that was alive, with the start it had, and is dead and reaped now. */
async function deadRecord(): Promise<{ pid: number; start: string | null }> {
  const c = sleeperChild();
  const pid = c.pid!;
  const start = HAS_PROC ? startOf(pid) : null;
  const closed = new Promise<void>((r) => c.once('close', () => r()));
  c.kill('SIGKILL');
  await bounded(closed, 20_000, 'a killed sleeper closing');
  return { pid, start };
}
afterEach(() => {
  for (const c of startedChildren) { try { c.kill('SIGKILL'); } catch { /* already gone */ } }
  startedChildren.length = 0;
});

/** What a refusal prints: exactly one stderr line. */
const refusalLine = (word: string, detail: string): string => `ccrc history-replay: ${word}: ${detail}\n`;

// ── W2-4 Task 1: the driver's words (W2-D59, W2-D12; D-5774) ──────────────
describe('history-replay W2-4 Task 1: the driver words (W2-D59, W2-D12; D-5774)', () => {
  const W2_D59 = ['family-unlisted', 'family-recall-off', 'quiz-unanswerable', 'quiz-sha-mismatch',
    'claude-version-moved', 'tree-moved', 'wrapper-moved', 'code-changed', 'limits-threshold', 'limits-stale',
    'budget-exhausted', 'record-invalid', 'record-sha-mismatch', 'input-sha-mismatch', 'assignment-mismatch', 'out-refused'];
  const PLAN_CHOSEN = ['args-invalid', 'in-pane', 'roster-invalid', 'account-refused', 'input-invalid', 'code-unmeasured', 'version-unmeasured', 'tree-unmeasured', 'wrapper-unmeasured'];
  const FIX_ROUND_1 = ['run-live', 'out-in-use', 'interrupted'];   // D-5984, D-5985
  const W2_5A = ['store-unreadable'];   // W2-5a Task 1: a store this node cannot open or read (W2-D59, its owner PR's word)

  it('DRIVER_REASONS is frozen, duplicate-free, and exactly W2-D59\'s sixteen words in order, then W2-4\'s nine, then fix round 1\'s three, then W2-5a\'s', () => {
    expect(W2_D59).toHaveLength(16);
    expect(Object.isFrozen(replay.DRIVER_REASONS)).toBe(true);
    expect(new Set(replay.DRIVER_REASONS).size, 'a word is listed twice').toBe(replay.DRIVER_REASONS.length);
    expect([...replay.DRIVER_REASONS]).toEqual([...W2_D59, ...PLAN_CHOSEN, ...FIX_ROUND_1, ...W2_5A]);
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
   *  pool), so the worker's umask is saved first and restored afterwards. From W2-5a Task 1 importing the driver loads
   *  cli.mjs, which sets this worker's umask to 077 at import, so the saved value is 077 too. */
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
    const r = spawnSync(process.execPath, ['--no-warnings', link, 'no-such-sub'], {
      cwd: home, encoding: 'utf8', timeout: 60_000, env: { ...scrubbedEnv(process.env), HOME: home },
    });
    expect([r.status, r.stderr]).toEqual([EXIT.REFUSED, refusalLine('args-invalid', 'unknown subcommand "no-such-sub"')]);
    expect(process.exitCode ?? 0, 'importing the driver set an exit code').toBe(0);
  });
});

// ── W2-4 Task 1: W2-D51, no deploy/history-*.mjs spells a node:sqlite specifier. From W2-5a Task 1 the driver loads it, but only
// through store.mjs (its one importer), whose openReader is every store read's door; D-5814's import pin names store.mjs.
describe('history-replay W2-4 Task 1: no deploy/history-*.mjs spells a node:sqlite specifier (W2-D51)', () => {
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
    // D-5814: a symlink is never followed, even to a file holding the right text (the isFile guard, W2-D53's marker rule).
    ['a marker that is a symlink to a file holding OUT_KIND', (b) => {
      const o = made(b); const m = t2Path.join(o, t2Drv.OUT_MARKER); const target = t2Path.join(b, 'marker-target');
      t2Fs.writeFileSync(target, t2Drv.OUT_KIND); t2Fs.rmSync(m); t2Fs.symlinkSync(target, m); return o;
    }, 'marker-mismatch'],
  ];

  it.each(REUSE)('W2-D53: %s is refused, and nothing is created in its place', (_what, plant, detail) => {
    const b = base();
    const o = plant(b);
    const before = t2Fs.readdirSync(b).sort();
    expect(refusalOf(() => t2Drv.prepareOut(o))).toEqual(out(detail));
    expect(t2Fs.readdirSync(b).sort(), 'the refusal created something').toEqual(before);
  });

  // D-5814: a FIFO marker must be refused without being opened, or readFileSync blocks the driver forever. The call runs
  // in a child with a deadline (the FIFO cases of Task 3), and a CONTROL shows the same child accepts a regular marker.
  const MARKER_CHILD = [
    'const d = await import(process.env.MARKER_DRIVER_URL);',
    'try { process.stdout.write("accepted " + d.prepareOut(process.env.MARKER_OUT)); }',
    'catch (e) { if (!(e instanceof d.DriverRefusal)) throw e; process.stdout.write(e.word + " " + e.detail); }',
  ].join('\n');
  const markerChild = (o: string) => spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', MARKER_CHILD], {
    env: { ...scrubbedEnv(process.env), MARKER_DRIVER_URL: pathToFileURL(T2_SCRIPT).href, MARKER_OUT: o }, encoding: 'utf8', timeout: 10_000,
  });
  it('D-5814: a marker that is a FIFO is refused marker-mismatch without being opened (child with a deadline); a regular marker is accepted by the same child', () => {
    const o = made(base());
    const marker = t2Path.join(o, t2Drv.OUT_MARKER);
    const control = markerChild(o);
    expect(control.status, control.stderr).toBe(0);
    expect(control.stdout, 'CONTROL').toBe(`accepted ${o}`);
    t2Fs.rmSync(marker);
    const mk = spawnSync('mkfifo', [marker], { encoding: 'utf8' });
    expect(mk.status, mk.stderr).toBe(0);
    const r = markerChild(o);
    expect(r.signal, `prepareOut blocked on the FIFO marker: ${r.stderr}`).toBeNull();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('out-refused marker-mismatch');
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
    const r = t2SpawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code],
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
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', ADMIT_CHILD], {
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
      permissionDenials: null, result: null, assistantMessages: 0, malformedLines: 0, firstCallUsage: null,
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
  // D-5986: a ledger the gate cannot read whole is out-refused, never budget-exhausted (raising --budget clears none of these states).
  const NOT_REGULAR = { word: 'out-refused', detail: 'spend.jsonl is not a regular file' };
  const MALFORMED = { word: 'out-refused', detail: 'spend.jsonl malformed' };
  const UNREADABLE = { word: 'out-refused', detail: 'spend.jsonl unreadable EACCES' };
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
    ['lines that each read but sum past the safe-integer range', `{"name":"a","tokens":${Number.MAX_SAFE_INTEGER},"ts_ms":1}\n{"name":"b","tokens":${Number.MAX_SAFE_INTEGER},"ts_ms":1}\n`],
  ])('a malformed ledger (%s) fails closed as out-refused spend.jsonl malformed, never a count', (_why, body) => {
    const out = t4MkTmp('ccrc-replay-t4-malformed-');
    t4Fs.writeFileSync(ledger(out), body);
    expect(refusalOf(() => t4Replay.spentSoFar(out))).toEqual(MALFORMED);
  });

  it('a ledger that is a directory, or a symlink to a readable ledger, fails closed too: out-refused spend.jsonl is not a regular file', () => {
    const dir = t4MkTmp('ccrc-replay-t4-dir-');
    t4Fs.mkdirSync(ledger(dir));
    expect(refusalOf(() => t4Replay.spentSoFar(dir))).toEqual(NOT_REGULAR);
    const link = t4MkTmp('ccrc-replay-t4-link-');
    t4Fs.writeFileSync(`${link}/elsewhere`, GOOD);
    t4Fs.symlinkSync(`${link}/elsewhere`, ledger(link));
    expect(refusalOf(() => t4Replay.spentSoFar(link))).toEqual(NOT_REGULAR);
  });

  // D-5814: an --out whose search bit is gone makes the ledger's lstat fail with EACCES (not ENOENT): fail closed, never 0.
  it.skipIf(process.getuid?.() === 0)('an --out that lost its search bit fails closed: the lstat error other than ENOENT is out-refused spend.jsonl unreadable EACCES, never an empty ledger (skipped as root)', () => {
    const out = t4MkTmp('ccrc-replay-t4-nosearch-');
    t4Replay.recordSpend(out, 'r0', 500);
    t4Fs.chmodSync(out, 0o600);
    try { expect(refusalOf(() => t4Replay.spentSoFar(out))).toEqual(UNREADABLE); }
    finally { t4Fs.chmodSync(out, 0o700); }
    expect(t4Replay.spentSoFar(out), 'CONTROL: the mode restored, the ledger reads').toBe(500);
  });

  it.skipIf(process.getuid?.() === 0)('an unreadable ledger fails closed (skipped as root, which reads it anyway)', () => {
    const out = t4MkTmp('ccrc-replay-t4-unreadable-');
    t4Fs.writeFileSync(ledger(out), GOOD);
    t4Fs.chmodSync(ledger(out), 0o000);
    expect(refusalOf(() => t4Replay.spentSoFar(out))).toEqual(UNREADABLE);
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
const T5_STUB_SWAP = 'stub-swap-path';
/** Optional stub acts (D-5986), each a file under $HOME holding a path, taken just before the stub exits: remove the path;
 *  chmod the directory to 0500 (a run subdirectory nobody may then change); and, only in a run whose argv carries
 *  `--tools Bash,Agent` (an arm or a box run; in step 0a, the box run), replace the path by a directory, as a same-user
 *  process could. */
const T5_STUB_RM = 'stub-rm-path';
const T5_STUB_CHMOD = 'stub-chmod-path';
const T5_STUB_BOX_SWAP = 'stub-box-swap-path';
/** When present, the stub leaves a mode-000 directory with a file in it in its cwd (D-5984: nobody may remove it). */
const T5_STUB_LOCK = 'stub-lock-cwd';
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
  // D-5986: replace the named path by a directory while the run is open, as a same-user process could.
  const swap = opt(${JSON.stringify(T5_STUB_SWAP)});
  if (swap !== null) { fs.rmSync(swap, { force: true }); fs.mkdirSync(swap); }
  const rm = opt(${JSON.stringify(T5_STUB_RM)});
  if (rm !== null) fs.rmSync(rm, { force: true });
  const boxSwap = opt(${JSON.stringify(T5_STUB_BOX_SWAP)});
  if (boxSwap !== null && process.argv.slice(2).includes('Bash,Agent')) { fs.rmSync(boxSwap, { force: true }); fs.mkdirSync(boxSwap); }
  const chmod = opt(${JSON.stringify(T5_STUB_CHMOD)});
  if (chmod !== null) fs.chmodSync(chmod, 0o500);
  if (opt(${JSON.stringify(T5_STUB_LOCK)}) !== null) {
    fs.mkdirSync(path.join(cwd, 'locked'), { mode: 0o700 });
    fs.writeFileSync(path.join(cwd, 'locked', 'f'), 'x');
    fs.chmodSync(path.join(cwd, 'locked'), 0o000);
  }
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
  const out = t5drv.prepareOut(t5path.join(home, 'out'));
  claimFor(out);   // D-5985: claimed like a subcommand's --out, before any leftover a case plants
  return {
    home, out,
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
/** D-6122 (precedent D-3701, ccd-child-reclaim-entry.test.ts's DARWIN_ADDED): macOS's runtime adds this one key to a
 *  process started with a clean environment, so a stub records it though spawnEnv never passes it. Dropped only on
 *  darwin; any other extra key still reds. */
const DARWIN_ADDED_ENV_KEY = '__CF_USER_TEXT_ENCODING';
function withoutDarwinAdded(keys: readonly string[], platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'darwin' ? keys.filter((k) => k !== DARWIN_ADDED_ENV_KEY) : [...keys];
}
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

describe('D-6122: the key macOS adds to a clean env is tolerated on Darwin only', () => {
  it('darwin drops __CF_USER_TEXT_ENCODING and keeps the other keys in order', () => {
    expect(withoutDarwinAdded(['CLAUDE_CONFIG_DIR', 'HOME', DARWIN_ADDED_ENV_KEY, 'LANG', 'PATH'], 'darwin'))
      .toEqual(['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']);
  });
  it('linux keeps it: the input comes back unchanged, in the same order', () => {
    const keys = ['CLAUDE_CONFIG_DIR', 'HOME', DARWIN_ADDED_ENV_KEY, 'LANG', 'PATH'];
    expect(withoutDarwinAdded(keys, 'linux')).toEqual(keys);
  });
  it('darwin keeps every other extra key, so only that one key is tolerated', () => {
    expect(withoutDarwinAdded(['HOME', 'EXTRA_KEY', DARWIN_ADDED_ENV_KEY], 'darwin')).toEqual(['HOME', 'EXTRA_KEY']);
  });
});

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
    const o = await claimedRun(t5job(b, b.up, mode, `rp1-${mode}`));
    const log = stubLog(b.home);
    expect(log, 'the stub ran once').toHaveLength(1);
    const l = log![0]!;
    expect(l.argv).toEqual(t5Argv(mode, `fixture-model-${mode}`, b.home));
    expect(withoutDarwinAdded(l.envKeys)).toEqual([...T5_BASE_KEYS, ...(mode === 'arm' ? T5_RECALL_KEYS : [])].sort());
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
    await claimedRun(t5job(b, b.gen, 'writer', 'rp1-gen'));
    const l = stubLog(b.home)![0]!;
    expect(l.envKeys).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(withoutDarwinAdded(l.envKeys).filter((k) => !T5_BASH_KEYS.includes(k))).toEqual([...T5_BASE_KEYS, 'CLAUDE_CODE_OAUTH_TOKEN'].sort());
    expect(l.env['CLAUDE_CONFIG_DIR']).toBe(t5path.join(b.home, '.gen-a'));
    expect(l.env['PATH']).toBe(`${b.out}/poison-bin:${t5path.dirname(process.execPath)}:/usr/bin:/bin`);
    for (const k of T5_NEVER_KEYS) expect(l.envKeys, k).not.toContain(k);
    expect(t5fs.readFileSync(t5path.join(b.home, T5_STUB_LOG), 'utf8')).not.toContain(T5_TOKEN);
  }, 60_000);

  it('upstream gets no CLAUDE_CODE_OAUTH_TOKEN from the driver, even when the caller carries one', async () => {
    const b = t5Box('ccrc-replay-t5-uptok-');
    t5vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', T5_TOKEN);
    await claimedRun(t5job(b, b.up, 'judge', 'rp1-uptok'));
    expect(stubLog(b.home)![0]!.envKeys).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  }, 60_000);

  it('the poisoned gh sits first on PATH under --out and exits 97', async () => {
    const b = t5Box('ccrc-replay-t5-gh-');
    await claimedRun(t5job(b, b.up, 'box', 'rp1-gh'));
    const gh = t5path.join(b.out, 'poison-bin', 'gh');
    expect(t5fs.statSync(gh).mode & 0o777).toBe(0o700);
    const r = t5spawnSync(gh, ['pr', 'merge'], { encoding: 'utf8' });
    expect(r.status).toBe(97);
  }, 60_000);

  it('a run leaves its stream, one ledger line and its run.json, written last with no tmp left, and keeps only the unknown option names from stderr', async () => {
    const b = t5Box('ccrc-replay-t5-files-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_STDERR), "error: unknown option '--fixture-flag'\nfixture-noise that is not kept\n");
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_EXIT), '1');
    const o = await claimedRun(t5job(b, b.up, 'writer', 'step/files'));
    expect([o.code, o.unknownOptions]).toEqual([1, ['--fixture-flag']]);
    expect(t5fs.readFileSync(t5path.join(b.out, 'step', 'files.jsonl'), 'utf8')).toBe(T5_STREAM);
    expect(o.facts.usageSource).toBe('result');
    const run = JSON.parse(t5fs.readFileSync(t5path.join(b.out, 'step', 'files.run.json'), 'utf8'));
    expect([run.kind, run.name, run.code, run.tokens, run.unknown_options]).toEqual(['ccrc-history-replay-run', 'step/files', 1, T5_TOKENS, ['--fixture-flag']]);
    expect(JSON.stringify(run)).not.toContain('fixture-noise');
    expect(t5fs.readdirSync(t5path.join(b.out, 'step')).sort()).toEqual(['files.jsonl', 'files.run.json']);
    expect(t5drv.spentSoFar(b.out)).toBe(T5_TOKENS);
  }, 60_000);

  it('a run that outlives its timeout is killed with its process group and recorded with its signal', async () => {
    const b = t5Box('ccrc-replay-t5-timeout-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_SLEEP), '8000');
    const o = await claimedRun(t5job(b, b.up, 'box', 'rp1-timeout', { timeoutMs: 300 }));
    expect([o.code, o.signal]).toEqual([null, 'SIGTERM']);
    expect(o.ms).toBeLessThan(5_000);
    expect(stubLog(b.home), 'killed before it logged').toBeNull();
  }, 6_000);

  // D-5804 (history-w2-4-spawn-guard-pins): the run-name grammar, the launcher-under-home check and the poison-bin
  // directory check each have a case that reaches the guard's branch.
  it.each(['', 'Upper', 'a b', '../escape', 'x/../../escape', '/escape', 'a//b', '.hidden', 'a/b/c/d/e', 'x'.repeat(65)])(
    'a bad run name %j is a TypeError before any spawn and writes nothing outside --out', async (name) => {
      const b = t5Box('ccrc-replay-t5-badname-');
      t5typeError(await t5caught(() => claimedRun(t5job(b, b.up, 'box', name))), /is not a run name/);
      expect(stubLog(b.home), 'nothing spawned').toBeNull();
      expect(t5fs.readdirSync(b.home).filter((f) => f.startsWith('escape')), 'nothing beside --out').toEqual([]);
      expect(t5fs.readdirSync(b.out).filter((f) => f !== 'poison-bin' && !f.startsWith('.')), 'nothing inside --out').toEqual([]);
    }, 60_000);

  it('a run name that is not a string is a TypeError, not the name undefined', async () => {
    const b = t5Box('ccrc-replay-t5-nostrname-');
    t5typeError(await t5caught(() => claimedRun(t5job(b, b.up, 'box', undefined as unknown as string))), /is not a run name/);
    t5typeError(await t5caught(() => claimedRun(t5job(b, b.up, 'box', 7 as unknown as string))), /is not a run name/);
    expect(stubLog(b.home)).toBeNull();
    expect(t5fs.readdirSync(b.out).filter((f) => f !== '.driver.lock'), '--out holds only its marker (and the claim\'s lock)').toEqual(['.ccrc-history-replay']);
  }, 60_000);

  it('a launcher under another home, or in a sibling directory sharing the bin prefix, is a TypeError before any spawn', async () => {
    const b = t5Box('ccrc-replay-t5-launcher-');
    const other = t5Box('ccrc-replay-t5-otherhome-');
    const near = t5path.join(b.home, '.local', 'bin-near');
    t5fs.mkdirSync(near, { recursive: true });
    t5fs.writeFileSync(t5path.join(near, 'up-a'), T5_STUB_SOURCE, { mode: 0o700 });
    for (const launcher of [other.up.launcher, t5path.join(near, 'up-a')]) {
      const launch = { ...b.up, launcher };
      t5typeError(await t5caught(() => claimedRun(t5job(b, launch, 'box', 'launcher-0'))), /is not under .*\/\.local\/bin/);
    }
    expect(stubLog(b.home), 'nothing spawned in this home').toBeNull();
    expect(stubLog(other.home), 'nothing spawned in the other home').toBeNull();
  }, 60_000);

  it('a poison-bin that is a file, or a symlink to a directory, is refused out-refused before any spawn', async () => {
    const file = t5Box('ccrc-replay-t5-poisonfile-');
    t5fs.writeFileSync(t5path.join(file.out, 'poison-bin'), 'not a directory');
    await expect(claimedRun(t5job(file, file.up, 'box', 'poison-0')))
      .rejects.toMatchObject({ word: 'out-refused', detail: 'poison-bin is not a directory' });
    expect(stubLog(file.home)).toBeNull();
    const link = t5Box('ccrc-replay-t5-poisonlink-');
    const target = t5path.join(link.home, 'poison-target');
    t5fs.mkdirSync(target);
    t5fs.symlinkSync(target, t5path.join(link.out, 'poison-bin'));
    await expect(claimedRun(t5job(link, link.up, 'box', 'poison-1')))
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
    await expect(claimedBatch(eleven, { gate: T5_NO_GATE })).rejects.toThrow(TypeError);
    await expect(claimedBatch(eleven.slice(0, 2), { concurrency: 3, gate: T5_NO_GATE })).rejects.toThrow(TypeError);
    await expect(claimedBatch(eleven.slice(0, 2), {}), 'a batch with no gate never spawns ungated').rejects.toThrow(/opts\.gate is required/);
    const { lang: _lang, ...noLang } = t5job(b, b.up, 'box', 'no-lang');
    await expect(claimedRun(noLang as T5Job), 'a caller that forgets lang fails loudly').rejects.toThrow(TypeError);
    expect(stubLog(b.home)).toBeNull();
  }, 60_000);

  it('four jobs run two at a time, never three: the stub stamps overlap at most 2 deep', async () => {
    const b = t5Box('ccrc-replay-t5-conc-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_SLEEP), '1500');
    const outs = await claimedBatch(Array.from({ length: 4 }, (_, i) => t5job(b, b.up, 'box', `conc-${i}`)), { gate: T5_NO_GATE });
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
    await expect(claimedBatch(jobs, { concurrency: 1, gate })).rejects.toMatchObject({ word: 'budget-exhausted' });
    expect(stubLog(b.home)).toHaveLength(1);
    expect(t5fs.existsSync(t5path.join(b.out, 'gate-0.run.json'))).toBe(true);
    const again = await claimedBatch(jobs, { concurrency: 1, gate: () => { calls += 1; } });
    expect(again.map((o) => o.skipped)).toEqual([true, false, false]);
    expect(calls, 'the resumed batch gated its two spawns only').toBe(4);
    expect(stubLog(b.home)).toHaveLength(3);
  }, 60_000);

  it('resume: a finished job is never spawned again and the ledger counts it once; a job with no run.json is spawned again and its spend adds to the total', async () => {
    const b = t5Box('ccrc-replay-t5-resume-');
    const jobs = [t5job(b, b.up, 'writer', 'resume-0'), t5job(b, b.up, 'judge', 'resume-1')];
    await claimedBatch(jobs, { gate: T5_NO_GATE });
    const again = await claimedBatch(jobs, { gate: T5_NO_GATE });
    expect(again.map((o) => [o.skipped, o.tokens, o.facts.usageSource])).toEqual([[true, T5_TOKENS, 'result'], [true, T5_TOKENS, 'result']]);
    expect(stubLog(b.home)).toHaveLength(2);
    expect(t5drv.spentSoFar(b.out)).toBe(2 * T5_TOKENS);
    t5fs.rmSync(t5path.join(b.out, 'resume-1.run.json'));
    const third = await claimedBatch(jobs, { gate: T5_NO_GATE });
    expect(third.map((o) => o.skipped)).toEqual([true, false]);
    expect(stubLog(b.home)).toHaveLength(3);
    // A run.json lost after its ledger line (a kill between the two): the re-spawn spends again, and the summed
    // ledger counts both spawns. Over-counting is the budget's safe direction (coordinator ruling).
    expect(t5drv.spentSoFar(b.out), 'the re-spawned job spent twice, and both count').toBe(3 * T5_TOKENS);
  }, 60_000);

  // D-5811 (history-w2-4-interrupted-spawn-spend): a spawn streams into `<name>.jsonl.part`; its spend line, then the
  // rename to `<name>.jsonl`, then run.json. A `.part` with no run.json is a spawn whose driver died, charged once.
  const T5_LEFTOVER_STREAM = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'x', permission_denials: [],
    usage: { input_tokens: 3, cache_creation_input_tokens: 4, cache_read_input_tokens: 5, output_tokens: 6 } }) + '\n';
  const T5_LEFTOVER_TOKENS = 18;
  const ledgerRows = (out: string): Array<{ name: string; tokens: number }> =>
    t5fs.readFileSync(t5path.join(out, t5drv.SPEND_LEDGER), 'utf8').split('\n').filter((l) => l !== '').map((l) => { const r = JSON.parse(l); return { name: r.name, tokens: r.tokens }; });

  it('a spawn streams into .jsonl.part and renames it after its spend line: the final stream and run.json appear only when it closes', async () => {
    const b = t5Box('ccrc-replay-t5-partflow-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_SLEEP), '1500');
    const flight = claimedRun(t5job(b, b.up, 'box', 'flow-0'));
    const part = t5path.join(b.out, 'flow-0.jsonl.part');
    for (let i = 0; i < 100 && !t5fs.existsSync(part); i++) await new Promise((r) => setTimeout(r, 50));
    expect(t5fs.existsSync(part), 'the stream is opened as .part').toBe(true);
    expect(t5fs.existsSync(t5path.join(b.out, 'flow-0.jsonl')), 'no final stream while the child runs').toBe(false);
    expect(t5fs.existsSync(t5path.join(b.out, 'flow-0.run.json'))).toBe(false);
    await flight;
    expect(t5fs.existsSync(part), 'renamed away').toBe(false);
    expect(t5fs.readFileSync(t5path.join(b.out, 'flow-0.jsonl'), 'utf8')).toBe(T5_STREAM);
    expect(t5fs.existsSync(t5path.join(b.out, 'flow-0.run.json'))).toBe(true);
  }, 60_000);

  it('the spend line lands before the rename of .part: a rename that fails leaves the spawn charged', async () => {
    const b = t5Box('ccrc-replay-t5-spendfirst-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_SLEEP), '1500');
    const flight = claimedRun(t5job(b, b.up, 'box', 'order-0'));
    const settled = flight.then(() => null, (e: unknown) => e);
    const part = t5path.join(b.out, 'order-0.jsonl.part');
    for (let i = 0; i < 100 && !t5fs.existsSync(part); i++) await new Promise((r) => setTimeout(r, 50));
    expect(t5fs.existsSync(part), 'the stream is open while the child runs').toBe(true);
    // The rename fails DURING the run: the final path becomes a non-empty directory after the pre-spawn check passed.
    const finalDir = t5path.join(b.out, 'order-0.jsonl');
    t5fs.mkdirSync(finalDir);
    t5fs.writeFileSync(t5path.join(finalDir, 'blocker'), 'x');
    expect(await settled, 'the rename failed').not.toBeNull();
    expect(t5drv.spentSoFar(b.out), 'charged although the rename failed').toBe(T5_TOKENS);
    expect(t5fs.existsSync(t5path.join(b.out, 'order-0.run.json'))).toBe(false);
  }, 60_000);

  // D-5811: a final stream path that is not a regular file refuses before the spawn, so no tokens are spent on a damaged --out.
  it('a final stream path that is a directory or a symlink refuses out-refused run-stream-invalid before the spawn; a regular file there is replaced by the re-spawn', async () => {
    for (const [label, plant] of [
      ['directory', (p: string, b: { home: string }) => { void b; t5fs.mkdirSync(p); }],
      ['symlink', (p: string, b: { home: string }) => { const t = t5path.join(b.home, 'final-target'); t5fs.writeFileSync(t, T5_LEFTOVER_STREAM); t5fs.symlinkSync(t, p); }],
    ] as const) {
      const b = t5Box(`ccrc-replay-t5-finalpath-${label}-`);
      const final = t5path.join(b.out, 'fin-0.jsonl');
      plant(final, b);
      const job = t5job(b, b.up, 'box', 'fin-0');
      await expect(claimedRun(job), `${label} through launchRun`).rejects.toMatchObject({ word: 'out-refused', detail: 'run-stream-invalid fin-0' });
      await expect(claimedBatch([job], { gate: T5_NO_GATE }), `${label} through the batch`).rejects.toMatchObject({ word: 'out-refused', detail: 'run-stream-invalid fin-0' });
      expect(stubLog(b.home), `${label}: no spawn`).toBeNull();
      expect(t5drv.spentSoFar(b.out), `${label}: nothing spent`).toBe(0);
      expect(t5fs.existsSync(t5path.join(b.out, 'fin-0.jsonl.part')), `${label}: no .part`).toBe(false);
      expect(t5fs.lstatSync(final).isFile(), `${label}: left untouched`).toBe(false);
    }
    // CONTROL: a finished spawn whose run.json was lost leaves a regular file there; the re-spawn replaces it.
    const c = t5Box('ccrc-replay-t5-finalpath-file-');
    t5fs.writeFileSync(t5path.join(c.out, 'fin-1.jsonl'), 'stale\n');
    await claimedRun(t5job(c, c.up, 'box', 'fin-1'));
    expect(stubLog(c.home)).toHaveLength(1);
    expect(t5fs.readFileSync(t5path.join(c.out, 'fin-1.jsonl'), 'utf8')).toBe(T5_STREAM);
    expect(t5drv.spentSoFar(c.out)).toBe(T5_TOKENS);
  }, 60_000);

  it('a .part leftover with no run.json is charged once before the re-spawn, its inode is never reused, and the spawn adds its own spend', async () => {
    const b = t5Box('ccrc-replay-t5-leftover-');
    const job = t5job(b, b.up, 'box', 'left-0');
    const part = t5path.join(b.out, 'left-0.jsonl.part');
    t5fs.writeFileSync(part, T5_LEFTOVER_STREAM);
    const held = t5path.join(b.home, 'held-part');
    t5fs.linkSync(part, held);
    const heldIno = t5fs.statSync(held).ino;
    const outs = await claimedBatch([job], { gate: T5_NO_GATE });
    expect(outs.map((o) => o.skipped)).toEqual([false]);
    expect(ledgerRows(b.out), 'the leftover is charged first, once').toEqual([{ name: 'left-0', tokens: T5_LEFTOVER_TOKENS }, { name: 'left-0', tokens: T5_TOKENS }]);
    expect(t5drv.spentSoFar(b.out)).toBe(T5_LEFTOVER_TOKENS + T5_TOKENS);
    expect(t5fs.existsSync(part)).toBe(false);
    expect(t5fs.readFileSync(held, 'utf8'), 'the dead driver\'s stream was removed, not truncated in place').toBe(T5_LEFTOVER_STREAM);
    expect(t5fs.statSync(t5path.join(b.out, 'left-0.jsonl')).ino, 'the new stream is a new inode').not.toBe(heldIno);
    expect(stubLog(b.home)).toHaveLength(1);
    // Resumed again: nothing is charged twice.
    await claimedBatch([job], { gate: T5_NO_GATE });
    expect(t5drv.spentSoFar(b.out)).toBe(T5_LEFTOVER_TOKENS + T5_TOKENS);
  }, 60_000);

  it('launchRun charges the leftover itself, for a caller that bypasses the batch', async () => {
    const b = t5Box('ccrc-replay-t5-leftover-direct-');
    t5fs.writeFileSync(t5path.join(b.out, 'left-1.jsonl.part'), T5_LEFTOVER_STREAM);
    await claimedRun(t5job(b, b.up, 'box', 'left-1'));
    expect(ledgerRows(b.out)).toEqual([{ name: 'left-1', tokens: T5_LEFTOVER_TOKENS }, { name: 'left-1', tokens: T5_TOKENS }]);
  }, 60_000);

  it('a gate sees a leftover\'s charge: a budget the leftover alone exhausts refuses budget-exhausted with no spawn', async () => {
    const b = t5Box('ccrc-replay-t5-leftover-gate-');
    t5fs.writeFileSync(t5path.join(b.out, 'left-2.jsonl.part'), T5_LEFTOVER_STREAM);
    const gate = (): void => {
      const stop = t5drv.decideBudget(t5drv.spentSoFar(b.out), T5_LEFTOVER_TOKENS);
      if (stop !== null) throw new t5drv.DriverRefusal(stop.word, stop.detail);
    };
    await expect(claimedBatch([t5job(b, b.up, 'box', 'left-2')], { concurrency: 1, gate }))
      .rejects.toMatchObject({ word: 'budget-exhausted', detail: `spent ${T5_LEFTOVER_TOKENS} of ${T5_LEFTOVER_TOKENS}` });
    expect(stubLog(b.home), 'nothing spawned').toBeNull();
    expect(t5drv.spentSoFar(b.out)).toBe(T5_LEFTOVER_TOKENS);
    expect(t5fs.existsSync(t5path.join(b.out, 'left-2.jsonl.part'))).toBe(false);
  }, 60_000);

  it('a leftover that is a directory or a symlink refuses out-refused run-stream-invalid with no spawn and no charge, through the batch and through launchRun', async () => {
    for (const [label, plant] of [
      ['directory', (p: string, b: { home: string }) => { void b; t5fs.mkdirSync(p); }],
      ['symlink', (p: string, b: { home: string }) => { const t = t5path.join(b.home, 'link-target'); t5fs.writeFileSync(t, T5_LEFTOVER_STREAM); t5fs.symlinkSync(t, p); }],
    ] as const) {
      const b = t5Box(`ccrc-replay-t5-leftover-${label}-`);
      plant(t5path.join(b.out, 'left-3.jsonl.part'), b);
      const job = t5job(b, b.up, 'box', 'left-3');
      await expect(claimedBatch([job], { gate: T5_NO_GATE }), `${label} through the batch`).rejects.toMatchObject({ word: 'out-refused', detail: 'run-stream-invalid left-3' });
      await expect(claimedRun(job), `${label} through launchRun`).rejects.toMatchObject({ word: 'out-refused', detail: 'run-stream-invalid left-3' });
      expect(stubLog(b.home), label).toBeNull();
      expect(t5drv.spentSoFar(b.out), label).toBe(0);
      expect(t5fs.lstatSync(t5path.join(b.out, 'left-3.jsonl.part')).isFile(), `${label} left untouched`).toBe(false);
    }
  }, 60_000);

  // D-5814: the first throw stops the batch at concurrency 2 too: the lane that did not throw takes no further job.
  it('at concurrency 2 a job that refuses on resume stops the other lane: exactly the job already started runs', async () => {
    const b = t5Box('ccrc-replay-t5-stoplane-');
    const jobs = Array.from({ length: 4 }, (_, i) => t5job(b, b.up, 'box', `lane-${i}`));
    t5fs.writeFileSync(t5path.join(b.out, 'lane-1.run.json'), JSON.stringify({
      kind: 'ccrc-history-replay-run', name: 'lane-1', account: 'other-a', mode: 'box', model: 'fixture-model-box', settings_mode: 'restricted' }) + '\n');
    await expect(claimedBatch(jobs, { concurrency: 2, gate: T5_NO_GATE })).rejects.toMatchObject({ word: 'out-refused', detail: 'run-json-mismatch lane-1' });
    expect(stubLog(b.home), 'lane-0 was already started; lanes 2 and 3 never start').toHaveLength(1);
    expect(t5fs.existsSync(t5path.join(b.out, 'lane-2.jsonl.part')) || t5fs.existsSync(t5path.join(b.out, 'lane-2.jsonl'))).toBe(false);
  }, 60_000);

  // D-5814: spend before the completion marker. A run.json that cannot be written leaves the spawn charged already.
  it('the spend line lands before run.json: a run.json write that fails leaves the spawn charged', async () => {
    const b = t5Box('ccrc-replay-t5-spendbeforemarker-');
    t5fs.mkdirSync(t5path.join(b.out, `marker-0.run.json.tmp-${process.pid}`));
    await expect(claimedRun(t5job(b, b.up, 'box', 'marker-0'))).rejects.toThrow();
    expect(t5fs.existsSync(t5path.join(b.out, 'marker-0.run.json'))).toBe(false);
    expect(t5drv.spentSoFar(b.out), 'charged although run.json was never written').toBe(T5_TOKENS);
  }, 60_000);

  // D-5814: stderr is kept to STDERR_KEEP_BYTES (64 KiB); an unknown-option line past it is not read.
  it('stderr is bounded: an unknown option named past 64 KiB is not kept, one named early is', async () => {
    const b = t5Box('ccrc-replay-t5-stderrcap-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_STDERR),
      `error: unknown option '--early-flag'\n${'x'.repeat(70_000)}\nerror: unknown option '--beyond-cap'\n`);
    const o = await claimedRun(t5job(b, b.up, 'box', 'cap-0'));
    expect(o.unknownOptions).toEqual(['--early-flag']);
  }, 60_000);

  it('resume refuses a stream changed after its run.json, a run.json that does not parse, and one recorded for another account, mode, model or settings mode', async () => {
    const b = t5Box('ccrc-replay-t5-tamper-');
    const job = t5job(b, b.up, 'box', 'tamper-0');
    await claimedBatch([job], { gate: T5_NO_GATE });
    // The same --out and name under another account, mode, model or settings mode is never answered from this run.
    // D-5804: variant 1 carries the recorded model, so it differs from the recorded run in its mode alone.
    const others = [t5job(b, b.gen, 'box', 'tamper-0'), t5job(b, b.up, 'writer', 'tamper-0', { model: 'fixture-model-box' }),
      t5job(b, b.up, 'box', 'tamper-0', { model: 'fixture-model-other' }), t5job(b, b.up, 'box', 'tamper-0', { settingsMode: 'fallback' })];
    for (const [i, other] of others.entries()) {
      await expect(claimedBatch([other], { gate: T5_NO_GATE }), `variant ${i}`).rejects.toMatchObject({ word: 'out-refused', detail: 'run-json-mismatch tamper-0' });
    }
    t5fs.appendFileSync(t5path.join(b.out, 'tamper-0.jsonl'), '{}\n');
    await expect(claimedBatch([job], { gate: T5_NO_GATE })).rejects.toMatchObject({ word: 'out-refused', detail: 'run-stream-changed tamper-0' });
    t5fs.writeFileSync(t5path.join(b.out, 'tamper-0.run.json'), 'not json');
    await expect(claimedBatch([job], { gate: T5_NO_GATE })).rejects.toMatchObject({ word: 'out-refused', detail: 'run-json-invalid tamper-0' });
    expect(stubLog(b.home)).toHaveLength(1);
  }, 60_000);

  // D-5804 (history-w2-4-spawn-guard-pins): the duplicate-job check and finishedOutcome's kind, name and null checks.
  it('two jobs in one batch with the same --out and name are a TypeError before any spawn', async () => {
    const b = t5Box('ccrc-replay-t5-dup-');
    const job = t5job(b, b.up, 'box', 'dup-0');
    t5typeError(await t5caught(() => claimedBatch([job, { ...job }], { gate: T5_NO_GATE })), /two jobs share one --out and name/);
    expect(stubLog(b.home)).toBeNull();
    expect(t5fs.readdirSync(b.out).filter((f) => f !== '.driver.lock'), '--out holds only its marker (and the claim\'s lock)').toEqual(['.ccrc-history-replay']);
    const ok = await claimedBatch([job, t5job(b, b.up, 'box', 'dup-1')], { gate: T5_NO_GATE });
    expect(ok.map((o) => o.skipped), 'the control: two names are fine').toEqual([false, false]);
  }, 60_000);

  it('resume refuses a well-formed run.json of the wrong kind or the wrong name, and one that is the JSON null', async () => {
    const b = t5Box('ccrc-replay-t5-kind-');
    const job = t5job(b, b.up, 'box', 'kind-0');
    await claimedBatch([job], { gate: T5_NO_GATE });
    const runJson = t5path.join(b.out, 'kind-0.run.json');
    const good = t5fs.readFileSync(runJson, 'utf8');
    const rec = JSON.parse(good) as Record<string, unknown>;
    for (const [label, text] of [['kind', { ...rec, kind: 'ccrc-history-replay-other' }], ['name', { ...rec, name: 'kind-1' }], ['null', null]] as const) {
      t5fs.writeFileSync(runJson, JSON.stringify(text) + '\n');
      await expect(claimedBatch([job], { gate: T5_NO_GATE }), label).rejects.toMatchObject({ word: 'out-refused', detail: 'run-json-invalid kind-0' });
    }
    t5fs.writeFileSync(runJson, good);
    const again = await claimedBatch([job], { gate: T5_NO_GATE });
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
    t5typeError(await t5caught(() => claimedRun(t5job(b, b.up, 'box', name))), refusal);
    t5typeError(await t5caught(() => claimedBatch([t5job(b, b.up, 'box', name)], { gate: T5_NO_GATE })), refusal);
    expect(t5fs.readFileSync(ledger).equals(before), 'the ledger is byte-identical').toBe(true);
    expect(t5drv.spentSoFar(b.out)).toBe(65);
    expect(t5fs.existsSync(t5path.join(b.out, `${name}.run.json`))).toBe(false);
    expect(stubLog(b.home), 'nothing spawned').toBeNull();
  }, 60_000);
});

// ── fix round 1: no unseen child (D-5984) and one driver per --out (D-5985) ────────────────────────────────
// In-process cases stub the liveness reader, so no verdict depends on what the box is running; the cases that use the
// real reader start their own children and signal only those. Every wait on a child is bounded.
describe('fix round 1 (D-5984): liveness answers alive, dead or unmeasured', () => {
  it.skipIf(!HAS_PROC)('this process reads alive with its own start, dead with another start, and a reaped child dead with its old start', async () => {
    expect(replay.liveness(process.pid, startOf(process.pid))).toBe('alive');
    expect(replay.liveness(process.pid, '1'), 'a start that is not this process\'s: the pid was reused').toBe('dead');
    const gone = await deadRecord();
    expect(replay.liveness(gone.pid, gone.start)).toBe('dead');
    expect(replay.liveness(gone.pid, '1')).toBe('dead');
  });

  it('with no recorded start the answer is kill(pid, 0): this process alive, a reaped child dead', async () => {
    expect(replay.liveness(process.pid, null)).toBe('alive');
    const gone = await deadRecord();
    expect(replay.liveness(gone.pid, null)).toBe('dead');
  });

  it('a pid that is no positive integer, or a start that is no string, reads unmeasured', () => {
    for (const pid of [0, -1, 1.5, Number.NaN, '12' as never, null as never]) expect(replay.liveness(pid, null), String(pid)).toBe('unmeasured');
    expect(replay.liveness(process.pid, 7 as never)).toBe('unmeasured');
  });

  // kill(pid, 0) answers EPERM for a process of another user: it exists, so the answer is alive. Pid 1 is the one process
  // that is always there and, run as a user, never ours. As root kill succeeds and the answer is alive either way, so the
  // case measures nothing there.
  it.skipIf(process.getuid?.() === 0)('with no recorded start, a process another user owns (EPERM) reads alive', () => {
    expect(replay.liveness(1, null)).toBe('alive');
  });

  // A /proc that does not answer for this very process cannot say a pid is gone: its ENOENT is "no /proc", not "no process".
  it('a pid file that is missing reads dead only where /proc answers for this process, and unmeasured where it does not', () => {
    const proc = mkTmp('ccrc-replay-proc-');
    const stat = (start: string): string => `777 (a b) S ${'0 '.repeat(18)}${start} 0\n`;
    mkdirSync(path.join(proc, '777'), { recursive: true });
    writeFileSync(path.join(proc, '777', 'stat'), stat('12345'));
    expect(replay.liveness(777, '12345', proc), 'CONTROL: the fixture /proc has the pid with its start').toBe('alive');
    expect(replay.liveness(777, '999', proc), 'CONTROL: another start is a reused pid').toBe('dead');
    expect(replay.liveness(778, '12345', proc), 'no /proc/self/stat: a missing pid file proves nothing').toBe('unmeasured');
    mkdirSync(path.join(proc, 'self'), { recursive: true });
    writeFileSync(path.join(proc, 'self', 'stat'), stat('1'));
    expect(replay.liveness(778, '12345', proc), 'a /proc that answers for itself: the pid is gone').toBe('dead');
  });

  // D-5984: the two other unmeasured arms. Each fixture row also holds <procDir>/self/stat, so that a /proc which answers
  // for itself is not what makes the answer: deleting either arm falls through to 'dead', not to the missing-/proc arm.
  it('a stat that cannot be read for any reason but ENOENT (a directory there: EISDIR) reads unmeasured, never dead', () => {
    const proc = mkTmp('ccrc-replay-proc-unreadable-');
    mkdirSync(path.join(proc, 'self'), { recursive: true });
    writeFileSync(path.join(proc, 'self', 'stat'), `1 (a) S ${'0 '.repeat(18)}1 0\n`);
    mkdirSync(path.join(proc, '779', 'stat'), { recursive: true });
    expect(replay.liveness(780, '12345', proc), 'CONTROL: the fixture /proc answers for itself, so a missing pid file is dead').toBe('dead');
    expect(replay.liveness(779, '12345', proc), 'a stat that fails to read with EISDIR is not a dead process').toBe('unmeasured');
  });

  it('a stat line with no closing parenthesis (unparsable) reads unmeasured, never dead', () => {
    const proc = mkTmp('ccrc-replay-proc-unparsable-');
    mkdirSync(path.join(proc, 'self'), { recursive: true });
    writeFileSync(path.join(proc, 'self', 'stat'), `1 (a) S ${'0 '.repeat(18)}1 0\n`);
    mkdirSync(path.join(proc, '781'), { recursive: true });
    writeFileSync(path.join(proc, '781', 'stat'), `781 (a b S ${'0 '.repeat(18)}12345 0\n`);
    mkdirSync(path.join(proc, '782'), { recursive: true });
    writeFileSync(path.join(proc, '782', 'stat'), `782 (a b) S ${'0 '.repeat(18)}12345 0\n`);
    expect(replay.liveness(782, '12345', proc), 'CONTROL: the same line with its parenthesis closed reads alive').toBe('alive');
    expect(replay.liveness(781, '12345', proc), 'an unparsable stat line is not a dead process').toBe('unmeasured');
  });
});

describe('fix round 1 (D-5984): a leftover whose writer is alive is never charged, removed or spawned again; a dead one is charged once', () => {
  const L_STREAM = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'x', permission_denials: [],
    usage: { input_tokens: 3, cache_creation_input_tokens: 4, cache_read_input_tokens: 5, output_tokens: 6 } }) + '\n';
  const L_TOKENS = 18;
  const noGate = (): void => {};
  /** Plant `<name>.jsonl.part` (unless `part` is null) and `<name>.pid` (unless `pid` is null) under out. */
  function plant(out: string, name: string, files: { part?: string | null; pid?: string | null }): void {
    mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
    if (files.part !== null) writeFileSync(path.join(out, `${name}.jsonl.part`), files.part ?? L_STREAM);
    if (files.pid !== undefined && files.pid !== null) writeFileSync(path.join(out, `${name}.pid`), files.pid);
  }
  const asks: Array<[number, string | null]> = [];
  const stubLive = (state: 'alive' | 'dead' | 'unmeasured') => (pid: number, start: string | null) => { asks.push([pid, start]); return state; };
  const notAsked = (): never => { throw new Error('liveness was asked about a record that needed no answer'); };
  const ledgerOf = (out: string): Array<{ name: string; tokens: number }> =>
    existsSync(path.join(out, replay.SPEND_LEDGER))
      ? readFileSync(path.join(out, replay.SPEND_LEDGER), 'utf8').split('\n').filter((l) => l !== '').map((l) => { const r = JSON.parse(l); return { name: r.name, tokens: r.tokens }; })
      : [];

  it.each(['alive', 'unmeasured'] as const)('a .part whose .pid reads %s refuses run-live naming the pid, its group and both files: nothing is charged, removed or spawned, through the batch and through launchRun', async (state) => {
    const b = t5Box('ccrc-replay-d5984-live-');
    plant(b.out, 'live-0', { pid: recText(424242, '777') });
    asks.length = 0;
    const job = t5job(b, b.up, 'box', 'live-0');
    for (const via of ['batch', 'launchRun'] as const) {
      const call = via === 'batch' ? claimedBatch([job], { gate: noGate, liveness: stubLive(state) }) : claimedRun(job, { liveness: stubLive(state) });
      await expect(call, via).rejects.toMatchObject({ word: 'run-live' });
      await call.catch((e: replay.DriverRefusal) => {
        expect(e.detail).toContain('424242');
        expect(e.detail).toContain('process group 424242');
        expect(e.detail).toContain(state);
        expect(e.detail).toContain('live-0.jsonl.part');
        expect(e.detail).toContain('live-0.pid');
      });
    }
    expect(asks[0], 'asked about the record\'s pid and start').toEqual([424242, '777']);
    expect(existsSync(path.join(b.out, 'live-0.jsonl.part')) && existsSync(path.join(b.out, 'live-0.pid')), 'both files stay').toBe(true);
    expect(readFileSync(path.join(b.out, 'live-0.jsonl.part'), 'utf8'), 'the stream is untouched').toBe(L_STREAM);
    expect(ledgerOf(b.out), 'nothing charged').toEqual([]);
    expect(stubLog(b.home), 'nothing spawned').toBeNull();
  }, 60_000);

  // D-5984: the remedy the detail gives is the one that keeps the charge. With the `.pid` removed ALONE, the next claim
  // charges the `.part` once and removes it; removing both files would lose that run's tokens for good.
  it.each(['alive', 'unmeasured'] as const)('a run-live detail (%s writer) says to remove only the .pid; doing so, the next claim charges the .part once and removes it', (state) => {
    const out = replay.prepareOut(path.join(mkTmp('ccrc-replay-d5984-remedy-'), 'out'));
    plant(out, 'sub/rem-0', { pid: recText(424290, '31') });
    let detail = '';
    try { replay.claimOut(out, { liveness: stubLive(state) }); } catch (e) { detail = (e as replay.DriverRefusal).detail; expect((e as replay.DriverRefusal).word).toBe('run-live'); }
    expect(detail, 'the detail says to remove only the .pid and never the .part').toContain(
      'If the pid is confirmed not to be a live Claude Code from this --out (a reused pid, or a box with no /proc), remove only the `sub/rem-0.pid`: '
      + 'the next driver then charges the `sub/rem-0.jsonl.part` and removes it. Never remove the `sub/rem-0.jsonl.part`.');
    expect(detail, 'one line').not.toContain('\n');
    expect(ledgerOf(out), 'the refused claim charged nothing').toEqual([]);
    rmSync(path.join(out, 'sub', 'rem-0.pid'));
    const c = replay.claimOut(out, { liveness: notAsked });
    try {
      expect(ledgerOf(out), 'the .part\'s tokens are charged exactly once').toEqual([{ name: 'sub/rem-0', tokens: L_TOKENS }]);
      expect(existsSync(path.join(out, 'sub', 'rem-0.jsonl.part')), 'and the .part is removed').toBe(false);
    } finally { c.release(); }
  });

  it('a regular .pid that is not exactly {pid, start} refuses run-live naming the file: nothing is charged, removed or spawned', async () => {
    const malformed: Array<[string, string]> = [['not json', 'not json\n'], ['empty', ''], ['pid zero', recText(0, null)], ['pid missing', '{"start":null}\n'],
      ['start missing', '{"pid":5}\n'], ['start a number', '{"pid":5,"start":7}\n'], ['start not digits', '{"pid":5,"start":"1x"}\n'],
      ['extra key', '{"extra":1,"pid":5,"start":null}\n'], ['not whole (no newline)', '{"pid":5,"start":null}'], ['an array', '[5,null]\n']];
    for (const [label, text] of malformed) {
      const b = t5Box('ccrc-replay-d5984-malformed-');
      plant(b.out, 'bad-0', { pid: text });
      await expect(claimedBatch([t5job(b, b.up, 'box', 'bad-0')], { gate: noGate, liveness: notAsked }), label).rejects.toMatchObject({ word: 'run-live' });
      await expect(claimedBatch([t5job(b, b.up, 'box', 'bad-0')], { gate: noGate, liveness: notAsked }), label).rejects.toThrow(/bad-0\.pid/);
      expect(existsSync(path.join(b.out, 'bad-0.pid')) && existsSync(path.join(b.out, 'bad-0.jsonl.part')), `${label}: both files stay`).toBe(true);
      expect(ledgerOf(b.out), label).toEqual([]);
      expect(stubLog(b.home), label).toBeNull();
    }
  }, 60_000);

  it('a .pid that is no regular file (a directory, a symlink either way, a FIFO) beside a .part refuses out-refused naming the file: nothing is charged, removed or spawned, through the batch and through launchRun (D-5984, D-5986)', async () => {
    for (const [label, make] of [
      ['directory', (p: string) => mkdirSync(p)],
      ['symlink', (p: string) => symlinkSync(path.join(path.dirname(p), 'target.pid'), p)],
      ['dangling symlink', (p: string) => symlinkSync(path.join(path.dirname(p), 'nowhere.pid'), p)],
      ['fifo', (p: string) => { const r = spawnSync('mkfifo', [p], { encoding: 'utf8' }); expect(r.status, r.stderr).toBe(0); }],
    ] as const) {
      const b = t5Box(`ccrc-replay-d5984-notfile-${label.replace(' ', '-')}-`);
      plant(b.out, 'bad-1', {});
      writeFileSync(path.join(b.out, 'target.pid'), recText(5, null));
      make(path.join(b.out, 'bad-1.pid'));
      for (const via of ['launchRun', 'runBatch'] as const) {
        const call = via === 'launchRun'
          ? claimedRun(t5job(b, b.up, 'box', 'bad-1'), { liveness: notAsked })
          : claimedBatch([t5job(b, b.up, 'box', 'bad-1')], { gate: noGate, liveness: notAsked });
        await expect(call, `${label} via ${via}`).rejects.toMatchObject({ word: 'out-refused', detail: 'bad-1.pid is not a regular file' });
      }
      expect(lstatSync(path.join(b.out, 'bad-1.pid')), `${label}: the .pid stays`).toBeTruthy();
      expect(readFileSync(path.join(b.out, 'bad-1.jsonl.part'), 'utf8'), `${label}: the stream is untouched`).toBe(L_STREAM);
      expect(ledgerOf(b.out), label).toEqual([]);
      expect(stubLog(b.home), label).toBeNull();
    }
  }, 60_000);

  it('a mode-000 .pid beside a .part (skipped as root) refuses out-refused <name>.pid unreadable EACCES: nothing is charged or removed, though liveness would say dead (D-5986)', async () => {
    if (process.getuid?.() === 0) return;   // root reads a mode 000 file
    const b = t5Box('ccrc-replay-d5986-pid-eacces-');
    plant(b.out, 'eacces-0', { pid: recText(424262, '1') });
    const pidFile = path.join(b.out, 'eacces-0.pid');
    chmodSync(pidFile, 0o000);
    try {
      for (const via of ['launchRun', 'runBatch'] as const) {
        const call = via === 'launchRun'
          ? claimedRun(t5job(b, b.up, 'box', 'eacces-0'), { liveness: () => 'dead' })
          : claimedBatch([t5job(b, b.up, 'box', 'eacces-0')], { gate: noGate, liveness: () => 'dead' });
        await expect(call, via).rejects.toMatchObject({ word: 'out-refused', detail: 'eacces-0.pid unreadable EACCES' });
      }
      expect(existsSync(pidFile) && existsSync(path.join(b.out, 'eacces-0.jsonl.part')), 'both files stay').toBe(true);
      expect(ledgerOf(b.out), 'nothing charged').toEqual([]);
      expect(stubLog(b.home), 'nothing spawned').toBeNull();
    } finally {
      chmodSync(pidFile, 0o600);
    }
  }, 60_000);

  it('a .part whose .pid reads dead is charged once, then both files are removed, and the job spawns on a new stream', async () => {
    const b = t5Box('ccrc-replay-d5984-dead-');
    plant(b.out, 'dead-0', { pid: recText(424243, '55') });
    asks.length = 0;
    const out = await claimedBatch([t5job(b, b.up, 'box', 'dead-0')], { gate: noGate, liveness: stubLive('dead') });
    expect(out.map((o) => o.skipped)).toEqual([false]);
    expect(asks).toEqual([[424243, '55']]);
    expect(ledgerOf(b.out), 'the dead writer\'s stream is charged once, then the new spawn').toEqual([{ name: 'dead-0', tokens: L_TOKENS }, { name: 'dead-0', tokens: T5_TOKENS }]);
    expect(existsSync(path.join(b.out, 'dead-0.pid')), 'the record is gone').toBe(false);
    expect(existsSync(path.join(b.out, 'dead-0.jsonl.part')), 'the part is gone').toBe(false);
    expect(stubLog(b.home)).toHaveLength(1);
  }, 60_000);

  it('a lone .pid is removed, liveness is never asked, and nothing is charged', async () => {
    const b = t5Box('ccrc-replay-d5984-lone-');
    plant(b.out, 'lone-0', { part: null, pid: recText(424244, null) });
    await claimedBatch([t5job(b, b.up, 'box', 'lone-0')], { gate: noGate, liveness: notAsked });
    expect(existsSync(path.join(b.out, 'lone-0.pid'))).toBe(false);
    expect(ledgerOf(b.out)).toEqual([{ name: 'lone-0', tokens: T5_TOKENS }]);
  }, 60_000);

  it('claimOut settles every leftover under --out, whatever its job: a dead writer\'s .part at any of four depths is charged and removed, a link is never followed', async () => {
    const out = replay.prepareOut(path.join(mkTmp('ccrc-replay-d5984-walk-'), 'out'));
    plant(out, 'a', { pid: recText(424245, '9') });
    plant(out, 'b', { pid: null });
    plant(out, 'deep/er/est/x', { pid: recText(424246, null) });
    plant(out, 'gone/only', { part: null, pid: recText(424247, '1') });
    const tooDeep = path.join(out, 'q/r/s/t/u');
    mkdirSync(tooDeep, { recursive: true });
    writeFileSync(path.join(tooDeep, 'v.jsonl.part'), L_STREAM);
    const target = mkTmp('ccrc-replay-d5984-walk-link-');
    writeFileSync(path.join(target, 'linked.jsonl.part'), L_STREAM);
    symlinkSync(target, path.join(out, 'link'));
    const c = claimFor(out, stubLive('dead'));
    expect(c.out).toBe(out);
    expect(ledgerOf(out).map((r) => r.name).sort()).toEqual(['a', 'b', 'deep/er/est/x']);
    expect(ledgerOf(out).every((r) => r.tokens === L_TOKENS)).toBe(true);
    for (const f of ['a.jsonl.part', 'a.pid', 'b.jsonl.part', 'deep/er/est/x.jsonl.part', 'deep/er/est/x.pid', 'gone/only.pid']) {
      expect(existsSync(path.join(out, f)), `${f} is gone`).toBe(false);
    }
    expect(existsSync(path.join(tooDeep, 'v.jsonl.part')), 'a directory past four levels is not walked').toBe(true);
    expect(existsSync(path.join(target, 'linked.jsonl.part')), 'a symlinked directory is not followed').toBe(true);
  }, 60_000);

  it('claimOut refuses run-live on a live writer anywhere under --out and releases its lock; a name that is no run name refuses out-refused', () => {
    const out = replay.prepareOut(path.join(mkTmp('ccrc-replay-d5984-walkrefuse-'), 'out'));
    plant(out, 'sub/live-1', { pid: recText(424248, '3') });
    expect(() => replay.claimOut(out, { liveness: stubLive('alive') })).toThrow(/run-live: pid 424248/);
    expect(existsSync(path.join(out, '.driver.lock')), 'the refused claim leaves no lock').toBe(false);
    rmSync(path.join(out, 'sub'), { recursive: true });
    for (const [file, detail] of [['Bad.jsonl.part', 'run-name-invalid Bad.jsonl.part'], ['.jsonl.part', 'run-name-invalid .jsonl.part'],
      ['spend.jsonl.part', 'run-name-invalid spend.jsonl.part'], ['x y.pid', 'run-name-invalid x y.pid']] as const) {
      writeFileSync(path.join(out, file), L_STREAM);
      expect(() => replay.claimOut(out, { liveness: stubLive('dead') }), file).toThrow(new replay.DriverRefusal('out-refused', detail));
      expect(existsSync(path.join(out, '.driver.lock')), `${file}: no lock left`).toBe(false);
      rmSync(path.join(out, file));
    }
  });
});

describe('fix round 1 (D-5984): each child leads its own process group, with a pid record while it runs', () => {
  it('while a child runs its .pid names it (pid and start, mode 0600, a group leader) beside its .part; the record is gone once it has closed', async () => {
    const b = t5Box('ccrc-replay-d5984-record-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_SLEEP), '1500');
    const flight = claimedRun(t5job(b, b.up, 'box', 'rec-0'));
    const pidFile = t5path.join(b.out, 'rec-0.pid');
    expect(await until(() => existsSync(pidFile), 10_000), 'the record appears').toBe(true);
    const text = readFileSync(pidFile, 'utf8');
    const rec = JSON.parse(text);
    expect(Object.keys(rec).sort()).toEqual(['pid', 'start']);
    expect(text).toBe(recText(rec.pid, rec.start));
    expect(statSync(pidFile).mode & 0o777).toBe(0o600);
    expect(existsSync(t5path.join(b.out, 'rec-0.jsonl.part'))).toBe(true);
    expect(replay.liveness(rec.pid, rec.start), 'the record names a live process').toBe('alive');
    expect(() => process.kill(-rec.pid, 0), 'it leads a process group of its own').not.toThrow();
    if (HAS_PROC) {
      expect(rec.start).toBe(startOf(rec.pid));
      const stat = readFileSync(`/proc/${rec.pid}/stat`, 'utf8');
      expect(Number(stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[2]), 'its pgrp is its own pid').toBe(rec.pid);
    }
    await bounded(flight, 30_000, 'the run finishing');
    expect(existsSync(pidFile), 'removed after the spend line').toBe(false);
    expect(existsSync(t5path.join(b.out, 'rec-0.jsonl.part'))).toBe(false);
  }, 60_000);

  it('a launcher that cannot be started rejects and leaves neither a .part nor a .pid', async () => {
    const b = t5Box('ccrc-replay-d5984-spawnfail-');
    chmodSync(t5path.join(b.home, '.local', 'bin', 'up-a'), 0o644);
    await expect(claimedRun(t5job(b, b.up, 'box', 'fail-0'))).rejects.toThrow(/EACCES/);
    expect(existsSync(t5path.join(b.out, 'fail-0.jsonl.part')), 'no part left').toBe(false);
    expect(existsSync(t5path.join(b.out, 'fail-0.pid')), 'no record left').toBe(false);
  }, 60_000);

  // D-5984: the run's cwd is removed best-effort. A child that leaves an entry nobody may remove in it (a mode-000 directory)
  // must not turn a finished run into a raw EACCES before its spend line: the run is charged once and its run.json written.
  // Skipped as root, which removes it anyway. The case restores the modes and removes the leftover cwd itself.
  it.skipIf(process.getuid?.() === 0)('a child-made entry nobody may remove in the run cwd does not fail the finished run: it is charged and recorded', async () => {
    const b = t5Box('ccrc-replay-d5984-cwdlock-');
    t5fs.writeFileSync(t5path.join(b.home, T5_STUB_LOCK), '1');
    const outcome = await claimedRun(t5job(b, b.up, 'box', 'cwd-0'));
    try {
      expect(outcome.skipped).toBe(false);
      expect(replay.spentSoFar(b.out), 'charged once').toBe(T5_TOKENS);
      expect(existsSync(t5path.join(b.out, 'cwd-0.run.json')), 'recorded').toBe(true);
      expect(existsSync(t5path.join(outcome.cwd, 'locked')), 'CONTROL: the entry the child made is the one left behind').toBe(true);
    } finally {
      chmodSync(t5path.join(outcome.cwd, 'locked'), 0o700);
      rmSync(outcome.cwd, { recursive: true, force: true });
    }
  }, 60_000);

  // D-5984: a child no record names must not run on. Whatever stops the `.pid` record being written whole, the child's
  // group is SIGKILLed and the run rejects. The record's tmp file is `<name>.pid.tmp-<this pid>` (the run is in-process, so
  // process.pid is the writer's); a DIRECTORY planted there (settleLeftover and the claim walk look at `.pid` and
  // `.jsonl.part` names only, so they let it through) makes the exclusive create refuse.
  it('when the .pid record cannot be written, the child\'s whole group is killed, the run rejects and no run.json is written', async () => {
    const b = t5Box('ccrc-replay-d5984-pidfail-');
    writeFileSync(t5path.join(b.home, '.local', 'bin', 'up-a'), `#!/usr/bin/env node
(async () => {
  const fs = await import('node:fs');
  const cp = await import('node:child_process');
  const path = await import('node:path');
  const home = path.resolve(path.dirname(process.argv[1]), '..', '..');
  fs.writeFileSync(path.join(home, 'stub.pid'), String(process.pid));
  const g = cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 25000)'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(home, 'grandchild.pid'), String(g.pid));
  setTimeout(() => {}, 25000);
})();
`, { mode: 0o700 });
    mkdirSync(t5path.join(b.out, `pf-0.pid.tmp-${process.pid}`));
    const files = ['stub.pid', 'grandchild.pid'].map((f) => t5path.join(b.home, f));
    const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
    let killedPid: number | null = null;
    try {
      const failure = await bounded(claimedRun(t5job(b, b.up, 'box', 'pf-0')).then(() => null, (e: unknown) => e), 30_000, 'the run rejecting');
      expect(failure, 'the run rejects').toBeInstanceOf(DriverRefusal);
      expect((failure as DriverRefusal).word).toBe('out-refused');
      // The refusal names the child it killed, so the check below does not depend on the stub having started.
      const detail = (failure as DriverRefusal).detail;
      const named = /^pf-0\.pid\.tmp-\d+ already exists and is not a regular file; its child \(pid (\d+)\) was killed with its group$/.exec(detail);
      expect(named, detail).not.toBeNull();
      killedPid = Number(named![1]);
      expect(await until(() => groupGone(killedPid!), 10_000), 'no process is left in the killed child\'s group').toBe(true);
      // A stub that did start has its pid file read after the group is gone, so its grandchild is checked too.
      const grandchild = existsSync(files[1]!) ? Number(readFileSync(files[1]!, 'utf8')) : null;
      if (grandchild !== null) expect(await until(() => !alive(grandchild), 10_000), 'the grandchild died with the group').toBe(true);
      expect(existsSync(t5path.join(b.out, 'pf-0.run.json')), 'no run.json').toBe(false);
      expect(existsSync(t5path.join(b.out, 'pf-0.pid')), 'no record').toBe(false);
      expect(existsSync(t5path.join(b.out, 'pf-0.jsonl.part')), 'the .part is left for the next claim').toBe(true);
      // The next driver on this --out charges that .part once (one ledger line) and removes it (D-5811).
      claimsByOut.get(b.out)!.release();
      claimsByOut.delete(b.out);
      claimFor(b.out);
      const ledger = readFileSync(t5path.join(b.out, replay.SPEND_LEDGER), 'utf8').split('\n').filter((l) => l !== '');
      expect(ledger, 'charged once').toHaveLength(1);
      expect(existsSync(t5path.join(b.out, 'pf-0.jsonl.part')), 'the .part is removed after the charge').toBe(false);
    } finally {
      if (killedPid !== null && !groupGone(killedPid)) { try { process.kill(-killedPid, 'SIGKILL'); } catch { /* gone */ } }
      for (const f of files) { try { process.kill(Number(readFileSync(f, 'utf8')), 'SIGKILL'); } catch { /* gone, or never written */ } }
    }
  }, 60_000);

  it('a run that outlives its timeout is killed with its whole group, and still records its run.json', async () => {
    const b = t5Box('ccrc-replay-d5984-timeout-');
    writeFileSync(t5path.join(b.home, '.local', 'bin', 'up-a'), `#!/usr/bin/env node
(async () => {
  const fs = await import('node:fs');
  const cp = await import('node:child_process');
  const path = await import('node:path');
  const home = path.resolve(path.dirname(process.argv[1]), '..', '..');
  fs.readFileSync(0);
  const g = cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 25000)'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(home, 'grandchild.pid'), String(g.pid));
  setTimeout(() => {}, 25000);
})();
`, { mode: 0o700 });
    const grandchildFile = t5path.join(b.home, 'grandchild.pid');
    try {
      const o = await bounded(claimedRun(t5job(b, b.up, 'box', 'to-0', { timeoutMs: 3000 })), 30_000, 'the timed-out run');
      expect([o.skipped, o.signal]).toEqual([false, 'SIGTERM']);
      expect(existsSync(t5path.join(b.out, 'to-0.run.json')), 'a timed-out run records its run.json').toBe(true);
      const grandchild = Number(readFileSync(grandchildFile, 'utf8'));
      const dead = await until(() => { try { process.kill(grandchild, 0); return false; } catch { return true; } }, 10_000);
      expect(dead, 'the grandchild in the run\'s group died with it').toBe(true);
    } finally {
      try { process.kill(Number(readFileSync(grandchildFile, 'utf8')), 'SIGKILL'); } catch { /* gone */ }
    }
  }, 60_000);

  it('main installs one handler each for SIGINT, SIGTERM and SIGHUP while a subcommand runs and removes them after it returns, however it ends', async () => {
    const count = (): number[] => ['SIGINT', 'SIGTERM', 'SIGHUP'].map((s) => process.listenerCount(s));
    const before = count();
    const seen: number[][] = [];
    const umask = process.umask(0o022);
    process.umask(umask);
    const quiet = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      replay.HANDLERS.set('fixture-sig', async () => { seen.push(count()); return 0; });
      replay.HANDLERS.set('fixture-sig-throws', async () => { seen.push(count()); return replay.refuse('budget-exhausted', 'x'); });
      expect(await replay.main(['fixture-sig'], {})).toBe(0);
      expect(count(), 'removed after a return').toEqual(before);
      expect(await replay.main(['fixture-sig-throws'], {})).toBe(EXIT.REFUSED);
      expect(count(), 'removed after a refusal').toEqual(before);
    } finally {
      quiet.mockRestore();
      replay.HANDLERS.delete('fixture-sig');
      replay.HANDLERS.delete('fixture-sig-throws');
      process.umask(umask);
    }
    for (const during of seen) expect(during, 'one more of each while the handler ran').toEqual(before.map((n) => n + 1));
  });
});

describe('fix round 1 (D-5985): one driver per --out, and the claim every runner requires', () => {
  const extra: Claim[] = [];
  afterEach(() => { for (const c of extra) c.release(); extra.length = 0; });
  const claimNow = (out: string, liveness?: typeof replay.liveness): Claim => {
    const c = replay.claimOut(out, liveness === undefined ? {} : { liveness });
    extra.push(c);
    return c;
  };
  const freshOut = (): string => replay.prepareOut(path.join(mkTmp('ccrc-replay-d5985-'), 'out'));
  const LOCK = '.driver.lock';
  const lockPath = (out: string): string => path.join(out, LOCK);
  const myStart = (): string | null => (HAS_PROC ? startOf(process.pid) : null);

  it('a claim writes the lock naming this driver (whole, 0600), leaves no temp file, and release removes it; a second release is harmless', () => {
    const out = freshOut();
    const c = claimNow(out);
    expect(readFileSync(lockPath(out), 'utf8')).toBe(recText(process.pid, myStart()));
    expect(statSync(lockPath(out)).mode & 0o777).toBe(0o600);
    expect(readdirSync(out).sort(), 'no tmp or stale file beside the lock').toEqual([replay.OUT_MARKER, LOCK].sort());
    c.release();
    expect(existsSync(lockPath(out))).toBe(false);
    expect(() => c.release()).not.toThrow();
    const again = claimNow(out);
    expect(existsSync(lockPath(out)), 'the --out is claimable again').toBe(true);
    again.release();
  });

  it('release removes only a lock that still names this driver', () => {
    const out = freshOut();
    const c = claimNow(out);
    writeFileSync(lockPath(out), recText(424250, '4'));
    c.release();
    expect(readFileSync(lockPath(out), 'utf8'), 'another driver\'s lock is left alone').toBe(recText(424250, '4'));
  });

  // D-5985: the start half of the identity. A lock that names THIS pid with ANOTHER start is a reused pid's, not this
  // driver's, and release leaves it alone.
  it('release leaves a lock that names this pid with another start', () => {
    const out = freshOut();
    const c = claimNow(out);
    const reused = recText(process.pid, '1');
    expect(reused, 'the planted start differs from this process\'s').not.toBe(recText(process.pid, myStart()));
    writeFileSync(lockPath(out), reused);
    c.release();
    expect(readFileSync(lockPath(out), 'utf8'), 'a reused pid\'s lock is left alone').toBe(reused);
  });

  // D-5985: the pid half of both identity checks, and release()'s idempotence.
  it('release leaves a lock that names another pid with this process\'s start', () => {
    const out = freshOut();
    const c = claimNow(out);
    const theirs = recText(424262, myStart());
    writeFileSync(lockPath(out), theirs);
    c.release();
    expect(existsSync(lockPath(out)), 'release did not remove another pid\'s lock').toBe(true);
    expect(readFileSync(lockPath(out), 'utf8'), 'another pid\'s lock is left alone even with this start').toBe(theirs);
  });

  it('an old claim\'s second release does not remove a newer claim\'s lock in the same process', () => {
    const out = freshOut();
    const a = claimNow(out);
    a.release();
    expect(existsSync(lockPath(out))).toBe(false);
    const b = claimNow(out);
    expect(readFileSync(lockPath(out), 'utf8'), 'the newer claim holds the lock').toBe(recText(process.pid, myStart()));
    a.release();
    expect(existsSync(lockPath(out)), 'the second release of the old claim did not remove the newer claim\'s lock').toBe(true);
    expect(readFileSync(lockPath(out), 'utf8'), 'the second release of the old claim leaves the newer claim\'s lock').toBe(recText(process.pid, myStart()));
    b.release();
    expect(existsSync(lockPath(out))).toBe(false);
  });

  it('a lock held by a live driver refuses out-in-use naming the pid, and leaves the lock as it was: this process, another process, an unmeasured holder', async () => {
    const out = freshOut();
    claimNow(out);
    expect(() => replay.claimOut(out)).toThrow(new replay.DriverRefusal('out-in-use', `pid ${process.pid} holds ${LOCK} (alive)`));
    expect(readFileSync(lockPath(out), 'utf8')).toBe(recText(process.pid, myStart()));
    const other = freshOut();
    const sleeper = sleeperChild();
    const rec = recText(sleeper.pid!, HAS_PROC ? startOf(sleeper.pid!) : null);
    writeFileSync(lockPath(other), rec);
    expect(() => replay.claimOut(other)).toThrow(new replay.DriverRefusal('out-in-use', `pid ${sleeper.pid} holds ${LOCK} (alive)`));
    expect(readFileSync(lockPath(other), 'utf8')).toBe(rec);
    const unknown = freshOut();
    writeFileSync(lockPath(unknown), recText(424251, '8'));
    expect(() => replay.claimOut(unknown, { liveness: () => 'unmeasured' })).toThrow(new replay.DriverRefusal('out-in-use', `pid 424251 holds ${LOCK} (unmeasured)`));
    expect(readFileSync(lockPath(unknown), 'utf8')).toBe(recText(424251, '8'));
    expect(readdirSync(unknown).sort(), 'a refusal leaves no temp or stale file').toEqual([replay.OUT_MARKER, LOCK].sort());
  });

  it('a lock held by a dead driver is taken over: it then names this driver, and no stale or temp file remains', async () => {
    const out = freshOut();
    const dead = await deadRecord();
    writeFileSync(lockPath(out), recText(dead.pid, dead.start));
    claimNow(out);
    expect(readFileSync(lockPath(out), 'utf8')).toBe(recText(process.pid, myStart()));
    expect(readdirSync(out).sort()).toEqual([replay.OUT_MARKER, LOCK].sort());
  });

  it('a dead holder\'s lock that changes hands before it is taken is put back, and the claim refuses out-in-use', async () => {
    const out = freshOut();
    const sleeper = sleeperChild();
    const theirs = recText(sleeper.pid!, HAS_PROC ? startOf(sleeper.pid!) : null);
    writeFileSync(lockPath(out), recText(424252, '2'));
    const swap = (): 'dead' => { writeFileSync(lockPath(out), theirs); return 'dead'; };   // read as dead, then another driver takes it
    expect(() => replay.claimOut(out, { liveness: swap })).toThrow(/out-in-use: .driver.lock changed hands/);
    expect(readFileSync(lockPath(out), 'utf8'), 'the live driver\'s lock is back').toBe(theirs);
    expect(readdirSync(out).sort()).toEqual([replay.OUT_MARKER, LOCK].sort());
  });

  // D-5985: the pid half of the takeover's re-read. The stale file names ANOTHER pid with the dead holder's START (a new
  // driver took the lock in the window), so it is not the holder read as dead: put back, refuse.
  it('a stale lock that names another pid with the dead holder\'s start is put back, and the claim refuses out-in-use', () => {
    const out = freshOut();
    writeFileSync(lockPath(out), recText(424260, '7'));
    const theirs = recText(424261, '7');
    const swap = (): 'dead' => { writeFileSync(lockPath(out), theirs); return 'dead'; };   // read as dead, then another pid takes the lock
    expect(() => replay.claimOut(out, { liveness: swap })).toThrow(/out-in-use: .driver.lock changed hands/);
    expect(readFileSync(lockPath(out), 'utf8'), 'the other pid\'s lock is back').toBe(theirs);
    expect(readdirSync(out).sort(), 'no stale or temp file remains').toEqual([replay.OUT_MARKER, LOCK].sort());
  });

  // D-5985: the start half of the takeover's re-read. The stale file names the SAME dead pid but ANOTHER start (the pid was
  // reused by a new driver that took the lock in the window), so it is not the holder read as dead: put back, refuse.
  it('a stale lock that names the same pid with another start is put back, and the claim refuses out-in-use', () => {
    const out = freshOut();
    writeFileSync(lockPath(out), recText(424254, '2'));
    const theirs = recText(424254, '3');
    const swap = (): 'dead' => { writeFileSync(lockPath(out), theirs); return 'dead'; };   // read as dead, then the pid's new owner takes the lock
    expect(() => replay.claimOut(out, { liveness: swap })).toThrow(/out-in-use: .driver.lock changed hands/);
    expect(readFileSync(lockPath(out), 'utf8'), 'the other start\'s lock is back').toBe(theirs);
    expect(readdirSync(out).sort(), 'no stale or temp file remains').toEqual([replay.OUT_MARKER, LOCK].sort());
  });

  it('a lock that is empty, torn, not a record, a directory or a symlink refuses out-in-use naming the file, and is left as it was', () => {
    for (const text of ['', 'junk\n', '{"pid":1}\n', recText(0, null), '{"pid":5,"start":null}']) {
      const out = freshOut();
      writeFileSync(lockPath(out), text);
      expect(() => replay.claimOut(out, { liveness: () => 'dead' }), JSON.stringify(text)).toThrow(/out-in-use: \.driver\.lock is not a lock record/);
      expect(readFileSync(lockPath(out), 'utf8')).toBe(text);
    }
    const dir = freshOut();
    mkdirSync(lockPath(dir));
    expect(() => replay.claimOut(dir, { liveness: () => 'dead' })).toThrow(/out-in-use: \.driver\.lock is not a regular file/);
    const linked = freshOut();
    const elsewhere = path.join(mkTmp('ccrc-replay-d5985-target-'), 'real-lock');
    writeFileSync(elsewhere, recText(424253, '6'));
    symlinkSync(elsewhere, lockPath(linked));
    expect(() => replay.claimOut(linked, { liveness: () => 'dead' })).toThrow(/out-in-use: \.driver\.lock is not a regular file/);
    expect(readFileSync(elsewhere, 'utf8'), 'the link\'s target is untouched').toBe(recText(424253, '6'));
    expect(lstatSync(lockPath(linked)).isSymbolicLink()).toBe(true);
  });

  it('two drivers that both see one dead lock end with exactly one holder', async () => {
    const dir = mkTmp('ccrc-replay-d5985-race-');
    const racer = path.join(dir, 'racer.mjs');
    writeFileSync(racer, `import { claimOut } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
let claim = null;
let buf = '';
process.stdout.write('ready\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const cmd = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (cmd === 'go') {
      try { claim = claimOut(process.argv[2]); process.stdout.write('ok\\n'); } catch (e) { process.stdout.write('refused ' + (e.word ?? e.message) + '\\n'); }
    } else if (cmd === 'quit') {
      if (claim) claim.release();
      process.exit(0);
    }
  }
});
`);
    for (let round = 0; round < 3; round++) {
      const out = freshOut();
      const dead = await deadRecord();
      writeFileSync(lockPath(out), recText(dead.pid, dead.start));
      const racers = [0, 1].map(() => {
        const c = spawn(process.execPath, ['--no-warnings', racer, out], { stdio: ['pipe', 'pipe', 'inherit'] });
        startedChildren.push(c);
        const lines: string[] = [];
        let partial = '';
        c.stdout!.setEncoding('utf8');
        c.stdout!.on('data', (d: string) => { partial += d; const parts = partial.split('\n'); partial = parts.pop()!; lines.push(...parts); });
        const exited = new Promise<void>((r) => c.once('close', () => r()));
        return { c, lines, exited };
      });
      for (const r of racers) expect(await until(() => r.lines.includes('ready'), 20_000), 'a racer is up').toBe(true);
      for (const r of racers) r.c.stdin!.write('go\n');
      for (const r of racers) expect(await until(() => r.lines.length >= 2, 20_000), 'a racer answered').toBe(true);
      const answers = racers.map((r) => r.lines[1]).sort();
      expect(answers, `round ${round}`).toEqual(['ok', 'refused out-in-use']);
      const winner = racers.find((r) => r.lines[1] === 'ok')!;
      expect(JSON.parse(readFileSync(lockPath(out), 'utf8')).pid, 'the lock names the one holder').toBe(winner.c.pid);
      for (const r of racers) r.c.stdin!.write('quit\n');
      for (const r of racers) await bounded(r.exited, 20_000, 'a racer exiting');
      expect(existsSync(lockPath(out)), 'the winner released').toBe(false);
      expect(readdirSync(out), 'no tmp or stale file').toEqual([replay.OUT_MARKER]);
    }
  }, 120_000);

  it('runBatch, launchRun and step0bMechanics refuse a call with no claim, a released claim or a claim over another --out: a TypeError before any spawn', async () => {
    const b = t5Box('ccrc-replay-d5985-claim-');
    const other = t5Box('ccrc-replay-d5985-claim-other-');
    const job = t5job(b, b.up, 'box', 'cl-0');
    const spent = claimNow(freshOut());
    spent.release();
    const noClaim = /opts\.claim is required/;
    t5typeError(await t5caught(() => replay.runBatch([job], { gate: T5_NO_GATE } as never)), noClaim);
    t5typeError(await t5caught(() => replay.launchRun(job)), noClaim);
    t5typeError(await t5caught(() => replay.launchRun(job, {} as never)), noClaim);
    t5typeError(await t5caught(() => replay.runBatch([job], { gate: T5_NO_GATE, claim: spent } as never)), noClaim);
    t5typeError(await t5caught(() => replay.launchRun(job, { claim: spent } as never)), noClaim);
    t5typeError(await t5caught(() => replay.runBatch([job], { gate: T5_NO_GATE, claim: { ...claimFor(b.out) } } as never)), noClaim);
    const wrongOut = /is not the claimed --out/;
    t5typeError(await t5caught(() => replay.runBatch([job], { gate: T5_NO_GATE, claim: claimFor(other.out) } as never)), wrongOut);
    t5typeError(await t5caught(() => replay.launchRun(job, { claim: claimFor(other.out) } as never)), wrongOut);
    t5typeError(await t5caught(() => replay.step0bMechanics({ launch: b.up, out: b.out, model: 'fixture-model-arm', settingsMode: 'restricted', lang: undefined, gate: T5_NO_GATE } as never)), noClaim);
    expect(stubLog(b.home), 'no spawn').toBeNull();
    expect(stubLog(other.home), 'no spawn').toBeNull();
    expect((await claimedBatch([job], { gate: T5_NO_GATE })).map((o) => o.skipped), 'CONTROL: the live claim runs').toEqual([false]);
  }, 60_000);
});

// ── fix round 1 (D-5986): no-follow, type-checked I/O under --out ───────────────────────────────────────────
// Every path the driver reads or writes under a reused --out, and the --step0a input, is read with lstat, a no-follow
// non-blocking open and an fstat, and written through an exclusive create (a tmp file and then a rename or a link, or the
// `.part` the child writes in place), or opened O_APPEND|O_NOFOLLOW.
// A link or a FIFO planted there refuses out-refused (input-invalid for --step0a) and nothing is followed or waited on.
// A case that could block runs the call in a child with a deadline, so a regression times out instead of hanging the suite.
describe('fix round 1 (D-5986): no-follow, type-checked I/O under --out', () => {
  const D6_STREAM = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'x', permission_denials: [],
    usage: { input_tokens: 3, cache_creation_input_tokens: 4, cache_read_input_tokens: 5, output_tokens: 6 } }) + '\n';
  const freshOut = (): string => replay.prepareOut(path.join(mkTmp('ccrc-replay-d5986-'), 'out'));
  const outsideDir = (): string => mkTmp('ccrc-replay-d5986-outside-');
  /** What a call throws, or null when it throws nothing. */
  const thrown = (f: () => unknown): unknown => { try { f(); } catch (e) { return e; } return null; };

  it('a ledger that is a symlink (to a file, or dangling): recordSpend and claimOut\'s charge refuse out-refused, and the target is untouched', () => {
    for (const dangling of [false, true]) {
      const out = freshOut();
      const target = path.join(outsideDir(), 'outside.jsonl');
      if (!dangling) writeFileSync(target, 'ORIGINAL\n');
      symlinkSync(target, path.join(out, replay.SPEND_LEDGER));
      expect(() => replay.recordSpend(out, 'x', 5), `dangling ${dangling}`).toThrow(new replay.DriverRefusal('out-refused', `${replay.SPEND_LEDGER} is not a regular file`));
      writeFileSync(path.join(out, 'a.jsonl.part'), D6_STREAM);
      expect(thrown(() => replay.claimOut(out, { liveness: () => 'dead' })), `claimOut, dangling ${dangling}`).toMatchObject({ word: 'out-refused' });
      if (dangling) expect(existsSync(target), 'the dangling target is not created').toBe(false);
      else expect(readFileSync(target, 'utf8'), 'the target gained no line').toBe('ORIGINAL\n');
      expect(existsSync(path.join(out, 'a.jsonl.part')), 'the uncharged stream stays').toBe(true);
      expect(existsSync(path.join(out, '.driver.lock')), 'the refused claim leaves no lock').toBe(false);
    }
    const ok = freshOut();
    replay.recordSpend(ok, 'x', 5);
    expect(replay.spentSoFar(ok), 'CONTROL: a plain ledger takes the line').toBe(5);
    expect(statSync(path.join(ok, replay.SPEND_LEDGER)).mode & 0o777).toBe(0o600);
  });

  it('poison-bin/gh as a symlink (to a file, or dangling) or a directory: ensurePoisonBin refuses out-refused, and the target keeps its bytes and mode', () => {
    for (const kind of ['file', 'dangling', 'directory'] as const) {
      const out = freshOut();
      mkdirSync(path.join(out, 'poison-bin'));
      const gh = path.join(out, 'poison-bin', 'gh');
      const target = path.join(outsideDir(), 'outside-target');
      if (kind === 'file') { writeFileSync(target, 'KEEP\n', { mode: 0o644 }); chmodSync(target, 0o644); symlinkSync(target, gh); }
      if (kind === 'dangling') symlinkSync(target, gh);
      if (kind === 'directory') mkdirSync(gh);
      expect(thrown(() => replay.ensurePoisonBin(out)), kind).toMatchObject({ word: 'out-refused' });
      if (kind === 'file') {
        expect(readFileSync(target, 'utf8'), 'the target is not overwritten').toBe('KEEP\n');
        expect(statSync(target).mode & 0o777, 'the target\'s mode is not changed').toBe(0o644);
      }
      if (kind === 'dangling') expect(existsSync(target), 'the dangling target is not created').toBe(false);
      expect(readdirSync(path.join(out, 'poison-bin')), `${kind}: no tmp file left`).toEqual(['gh']);
    }
    const ok = freshOut();
    const dir = replay.ensurePoisonBin(ok);
    expect(statSync(path.join(dir, 'gh')).mode & 0o777, 'CONTROL: a plain gh is 0700').toBe(0o700);
    expect(replay.ensurePoisonBin(ok), 'and is planted again').toBe(dir);
  });

  it('a run subdirectory that is a symlink (to a directory, or dangling), a file, or a link in the middle of a nested name: out-refused before any spawn, and nothing is written through it', async () => {
    const cases: Array<[string, string, (p: string, outside: string) => void, string]> = [
      ['a symlink to a directory', 'sub/run-0', (p, o) => symlinkSync(o, p), 'sub is not a directory'],
      ['a dangling symlink', 'sub/run-0', (p, o) => symlinkSync(path.join(o, 'nothing-here'), p), 'sub is not a directory'],
      // A file in the directory's place: the check-only walk of the name's parents answers first, still out-refused and still before any spawn.
      ['a file', 'sub/run-0', (p) => writeFileSync(p, 'not a directory'), 'sub is not a directory'],
    ];
    for (const [label, name, plant, detail] of cases) {
      const b = t5Box('ccrc-replay-d5986-subdir-');
      const outside = outsideDir();
      plant(path.join(b.out, 'sub'), outside);
      const job = t5job(b, b.up, 'box', name);
      await expect(claimedRun(job), `${label} through launchRun`).rejects.toMatchObject({ word: 'out-refused', detail });
      await expect(claimedBatch([job], { gate: T5_NO_GATE }), `${label} through the batch`).rejects.toMatchObject({ word: 'out-refused', detail });
      expect(readdirSync(outside).filter((f) => f !== 'nothing-here'), `${label}: nothing written through the link`).toEqual([]);
      expect(stubLog(b.home), `${label}: no spawn`).toBeNull();
      expect(replay.spentSoFar(b.out), `${label}: nothing spent`).toBe(0);
    }
    const nested = t5Box('ccrc-replay-d5986-subdir-nested-');
    const outside = outsideDir();
    mkdirSync(path.join(outside, 'inner'));
    symlinkSync(outside, path.join(nested.out, 'top'));
    await expect(claimedRun(t5job(nested, nested.up, 'box', 'top/inner/run-1'))).rejects.toMatchObject({ word: 'out-refused', detail: 'top is not a directory' });
    expect(readdirSync(path.join(outside, 'inner')), 'nothing written through the middle link').toEqual([]);
    const ok = t5Box('ccrc-replay-d5986-subdir-ok-');
    await claimedRun(t5job(ok, ok.up, 'box', 'deep/er/run-2'));
    expect(lstatSync(path.join(ok.out, 'deep', 'er')).isDirectory(), 'CONTROL: a nested name makes its real directories').toBe(true);
    expect(statSync(path.join(ok.out, 'deep')).mode & 0o777).toBe(0o700);
  }, 60_000);

  it('a run subdirectory that is a symlink to a directory HOLDING a matching leftover or finished run: the batch refuses out-refused before it reads, charges, removes or skips anything there', async () => {
    // The check-only walk of a name's parents runs before the pre-pass settle and before finishedOutcome, because
    // O_NOFOLLOW protects only the last component: an outside .part would be charged and deleted, and an outside
    // finished run would resolve skipped with its cwd read from outside --out.
    const part = t5Box('ccrc-replay-d5986-linked-part-');
    const outsidePart = outsideDir();
    writeFileSync(path.join(outsidePart, 'run-0.jsonl.part'), D6_STREAM);
    symlinkSync(outsidePart, path.join(part.out, 'sub'));
    const partJob = t5job(part, part.up, 'box', 'sub/run-0');
    await expect(claimedBatch([partJob], { gate: T5_NO_GATE }), 'a leftover .part behind the link').rejects.toMatchObject({ word: 'out-refused', detail: 'sub is not a directory' });
    expect(readFileSync(path.join(outsidePart, 'run-0.jsonl.part'), 'utf8'), 'the outside .part was not removed').toBe(D6_STREAM);
    expect(replay.spentSoFar(part.out), 'and was not charged').toBe(0);
    expect(stubLog(part.home), 'no spawn').toBeNull();

    // A finished run made for the name 'sub/run-0' in a real run, then moved behind the link.
    const done = t5Box('ccrc-replay-d5986-linked-done-');
    const outsideDone = outsideDir();
    await claimedRun(t5job(done, done.up, 'box', 'seed-0'));
    const rec = JSON.parse(readFileSync(path.join(done.out, 'seed-0.run.json'), 'utf8'));
    rec.name = 'sub/run-0';
    writeFileSync(path.join(outsideDone, 'run-0.run.json'), JSON.stringify(rec) + '\n');
    writeFileSync(path.join(outsideDone, 'run-0.jsonl'), readFileSync(path.join(done.out, 'seed-0.jsonl')));
    symlinkSync(outsideDone, path.join(done.out, 'sub'));
    const spawnsBefore = stubLog(done.home)?.length ?? 0;
    const doneJob = t5job(done, done.up, 'box', 'sub/run-0');
    await expect(claimedBatch([doneJob], { gate: T5_NO_GATE }), 'a finished run behind the link').rejects.toMatchObject({ word: 'out-refused', detail: 'sub is not a directory' });
    await expect(claimedRun(doneJob), 'through launchRun').rejects.toMatchObject({ word: 'out-refused', detail: 'sub is not a directory' });
    expect(stubLog(done.home)?.length ?? 0, 'no new spawn').toBe(spawnsBefore);
  }, 60_000);

  it('a run.json tmp, or a .pid tmp, planted as a symlink is refused out-refused and never written through', async () => {
    const rj = t5Box('ccrc-replay-d5986-rjtmp-');
    const target = path.join(outsideDir(), 'outside-target');
    writeFileSync(target, 'KEEP\n');
    symlinkSync(target, path.join(rj.out, `rj-0.run.json.tmp-${process.pid}`));
    await expect(claimedRun(t5job(rj, rj.up, 'box', 'rj-0'))).rejects.toMatchObject({ word: 'out-refused' });
    expect(readFileSync(target, 'utf8'), 'run.json\'s tmp was not written through').toBe('KEEP\n');
    expect(existsSync(path.join(rj.out, 'rj-0.run.json'))).toBe(false);
    expect(replay.spentSoFar(rj.out), 'the finished spawn is charged before the marker').toBe(T5_TOKENS);

    const pid = t5Box('ccrc-replay-d5986-pidtmp-');
    const target2 = path.join(outsideDir(), 'outside-target');
    writeFileSync(target2, 'KEEP\n');
    symlinkSync(target2, path.join(pid.out, `pid-0.pid.tmp-${process.pid}`));
    await expect(claimedRun(t5job(pid, pid.up, 'box', 'pid-0'))).rejects.toMatchObject({ word: 'out-refused' });
    expect(readFileSync(target2, 'utf8'), 'the .pid tmp was not written through').toBe('KEEP\n');
    expect(existsSync(path.join(pid.out, 'pid-0.pid'))).toBe(false);
  }, 60_000);

  it('a .part that was swapped for a directory while the run was open is refused out-refused run-stream-invalid, not read: nothing is charged, no run.json', async () => {
    const b = t5Box('ccrc-replay-d5986-swapped-part-');
    writeFileSync(path.join(b.home, 'stub-swap-path'), path.join(b.out, 'sw-0.jsonl.part'));
    await expect(claimedRun(t5job(b, b.up, 'box', 'sw-0'))).rejects.toMatchObject({ word: 'out-refused', detail: 'run-stream-invalid sw-0' });
    expect(stubLog(b.home), 'the run did happen').toHaveLength(1);
    expect(existsSync(path.join(b.out, 'sw-0.run.json'))).toBe(false);
    expect(replay.spentSoFar(b.out)).toBe(0);
  }, 60_000);

  it('a stale tmp file of this pid that is a regular file is replaced; the lock\'s tmp as a symlink refuses out-refused and the target is untouched', () => {
    const out = freshOut();
    writeFileSync(path.join(out, `.driver.lock.tmp-${process.pid}`), 'stale junk from an earlier driver of this pid');
    const c = replay.claimOut(out);
    expect(readFileSync(path.join(out, '.driver.lock'), 'utf8')).toBe(recText(process.pid, HAS_PROC ? startOf(process.pid) : null));
    expect(readdirSync(out).sort(), 'the stale tmp is gone').toEqual([replay.OUT_MARKER, '.driver.lock'].sort());
    c.release();
    const linked = freshOut();
    const target = path.join(outsideDir(), 'outside-target');
    writeFileSync(target, 'KEEP\n');
    symlinkSync(target, path.join(linked, `.driver.lock.tmp-${process.pid}`));
    expect(thrown(() => replay.claimOut(linked))).toMatchObject({ word: 'out-refused' });
    expect(readFileSync(target, 'utf8'), 'the lock\'s tmp was not written through').toBe('KEEP\n');
    expect(existsSync(path.join(linked, '.driver.lock')), 'no lock taken').toBe(false);
  });

  // D-5986: every failure to read, list, create or write a path under --out answers a driver refusal (out-refused), never
  // a raw errno (exit 1): an --out holder can make each of these happen. Root ignores modes, so each case is skipped for
  // uid 0 and restores the modes it changed in a finally, so the fixture's cleanup can remove the tree.
  it('a spend.jsonl nobody may write (mode 000) met by a leftover to charge: claimOut refuses out-refused spend.jsonl unwritable EACCES, keeps the .part, and releases the lock', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const out = freshOut();
    writeFileSync(path.join(out, 'lo-0.jsonl.part'), D6_STREAM);
    const ledger = path.join(out, replay.SPEND_LEDGER);
    writeFileSync(ledger, '');
    chmodSync(ledger, 0o000);
    try {
      expect(thrown(() => replay.claimOut(out))).toMatchObject({ word: 'out-refused', detail: 'spend.jsonl unwritable EACCES' });
      expect(existsSync(path.join(out, 'lo-0.jsonl.part')), 'the .part stays, for the next driver to charge').toBe(true);
      expect(existsSync(path.join(out, '.driver.lock')), 'the lock was released').toBe(false);
    } finally {
      chmodSync(ledger, 0o600);
    }
  });

  it('a run subdirectory nobody may list (mode 000): claimOut\'s walk refuses out-refused <sub> unreadable EACCES and releases the lock; a batch into it, on a claim taken before, refuses out-refused and spawns nothing', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const out = freshOut();
    const sub = path.join(out, 'sub');
    mkdirSync(sub);
    chmodSync(sub, 0o000);
    try {
      expect(thrown(() => replay.claimOut(out))).toMatchObject({ word: 'out-refused', detail: 'sub unreadable EACCES' });
      expect(existsSync(path.join(out, '.driver.lock')), 'the lock was released after the walk refused').toBe(false);
    } finally {
      chmodSync(sub, 0o700);
    }
    const b = t5Box('ccrc-replay-d5986-unlistable-');   // claims b.out first, as a subcommand does
    const bsub = path.join(b.out, 'sub');
    mkdirSync(bsub);
    chmodSync(bsub, 0o000);
    try {
      await expect(claimedBatch([t5job(b, b.up, 'box', 'sub/run-0')], { gate: T5_NO_GATE }))
        .rejects.toMatchObject({ word: 'out-refused', detail: 'sub/run-0.run.json unreadable EACCES' });
      expect(stubLog(b.home), 'no spawn').toBeNull();
    } finally {
      chmodSync(bsub, 0o700);
    }
  }, 60_000);

  it('a run subdirectory nobody may write into (mode 0500): the run refuses out-refused <name>.jsonl.part unwritable EACCES before it spawns, and a --out nobody may write to refuses to plant the poison bin', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const b = t5Box('ccrc-replay-d5986-unwritable-');
    const sub = path.join(b.out, 'sub');
    mkdirSync(sub);
    chmodSync(sub, 0o500);
    try {
      await expect(claimedRun(t5job(b, b.up, 'box', 'sub/run-0')))
        .rejects.toMatchObject({ word: 'out-refused', detail: 'sub/run-0.jsonl.part unwritable EACCES' });
      expect(stubLog(b.home), 'no spawn, so no orphan').toBeNull();
      expect(replay.spentSoFar(b.out), 'nothing spent').toBe(0);
    } finally {
      chmodSync(sub, 0o700);
    }
    const o = freshOut();
    chmodSync(o, 0o500);
    try {
      expect(thrown(() => replay.ensurePoisonBin(o))).toMatchObject({ word: 'out-refused', detail: 'poison-bin unwritable EACCES' });
    } finally {
      chmodSync(o, 0o700);
    }
  }, 60_000);

  it('a run subdirectory nobody may write into (mode 0500) holding a leftover .part, a lone .pid, or a stale tmp of the lock: the removal that fails refuses out-refused <rel> unwritable EACCES, never a raw errno, and the lock is released', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const ledgerLines = (out: string): number =>
      existsSync(path.join(out, replay.SPEND_LEDGER)) ? readFileSync(path.join(out, replay.SPEND_LEDGER), 'utf8').split('\n').filter((l) => l !== '').length : 0;
    // (1) a leftover .part (no .pid): the charge lands, the removal fails, the .part stays and is charged again by the next driver (an over-count)
    const a = freshOut();
    const asub = path.join(a, 'sub');
    mkdirSync(asub);
    writeFileSync(path.join(asub, 'lo-0.jsonl.part'), D6_STREAM);
    chmodSync(asub, 0o500);
    try {
      expect(thrown(() => replay.claimOut(a))).toMatchObject({ word: 'out-refused', detail: 'sub/lo-0.jsonl.part unwritable EACCES' });
      expect(existsSync(path.join(asub, 'lo-0.jsonl.part')), 'the .part stays').toBe(true);
      expect(ledgerLines(a), 'charged once').toBe(1);
      expect(existsSync(path.join(a, '.driver.lock')), 'the lock was released').toBe(false);
      expect(thrown(() => replay.claimOut(a))).toMatchObject({ word: 'out-refused', detail: 'sub/lo-0.jsonl.part unwritable EACCES' });
      expect(ledgerLines(a), 'the left .part is charged again: an over-count, never a lost charge').toBe(2);
    } finally {
      chmodSync(asub, 0o700);
    }
    // (2) a lone .pid
    const b = freshOut();
    const bsub = path.join(b, 'sub');
    mkdirSync(bsub);
    writeFileSync(path.join(bsub, 'lo-1.pid'), recText(424242, null));
    chmodSync(bsub, 0o500);
    try {
      expect(thrown(() => replay.claimOut(b))).toMatchObject({ word: 'out-refused', detail: 'sub/lo-1.pid unwritable EACCES' });
      expect(existsSync(path.join(bsub, 'lo-1.pid')), 'the .pid stays').toBe(true);
      expect(existsSync(path.join(b, '.driver.lock')), 'the lock was released').toBe(false);
    } finally {
      chmodSync(bsub, 0o700);
    }
    // (3) a stale regular tmp of the lock, in a --out nobody may write into: the replace-stale removal refuses
    const c = freshOut();
    const tmpName = `.driver.lock.tmp-${process.pid}`;
    writeFileSync(path.join(c, tmpName), 'stale');
    chmodSync(c, 0o500);
    try {
      expect(thrown(() => replay.claimOut(c))).toMatchObject({ word: 'out-refused', detail: `${tmpName} unwritable EACCES` });
    } finally {
      chmodSync(c, 0o700);
    }
  });

  it('a dead record\'s .pid, removed after its .part is charged, in a run subdirectory nobody may write into (mode 0500): claimOut refuses out-refused <rel> unwritable EACCES, charged once, both files left', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const a = freshOut();
    const sub = path.join(a, 'sub');
    mkdirSync(sub);
    writeFileSync(path.join(sub, 'dd-0.jsonl.part'), D6_STREAM);
    writeFileSync(path.join(sub, 'dd-0.pid'), recText(424243, null));
    chmodSync(sub, 0o500);
    try {
      expect(thrown(() => replay.claimOut(a, { liveness: () => 'dead' }))).toMatchObject({ word: 'out-refused', detail: 'sub/dd-0.pid unwritable EACCES' });
      const ledger = readFileSync(path.join(a, replay.SPEND_LEDGER), 'utf8').split('\n').filter((l) => l !== '');
      expect(ledger, 'the charge happened, once').toHaveLength(1);
      expect(existsSync(path.join(sub, 'dd-0.pid')), 'the .pid stays').toBe(true);
      expect(existsSync(path.join(sub, 'dd-0.jsonl.part')), 'the .part stays').toBe(true);
      expect(existsSync(path.join(a, '.driver.lock')), 'the lock was released').toBe(false);
    } finally {
      chmodSync(sub, 0o700);
    }
  });

  it('a removal that cannot mask a refusal is quiet: release in a --out nobody may write into does not throw, and a takeover that fails refuses out-refused, not the raw errno of its tmp cleanup', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    // (1) the claim's release: the lock cannot be removed, and the release still returns
    const a = freshOut();
    const claim = replay.claimOut(a);
    chmodSync(a, 0o500);
    try {
      expect(() => claim.release()).not.toThrow();
      expect(existsSync(path.join(a, '.driver.lock')), 'the lock stays (it names this driver, dead by the next start)').toBe(true);
    } finally {
      chmodSync(a, 0o700);
    }
    // (2) a dead holder's lock in a --out that turns unwritable while the driver starts: the rename refuses, and the
    // tmp file's cleanup in the finally, which fails too, must not replace that refusal
    const b = freshOut();
    writeFileSync(path.join(b, '.driver.lock'), recText(424244, null));
    try {
      expect(thrown(() => replay.claimOut(b, { liveness: () => 'dead', afterHeld: () => chmodSync(b, 0o500) })))
        .toMatchObject({ word: 'out-refused', detail: '.driver.lock unwritable EACCES' });
    } finally {
      chmodSync(b, 0o700);
    }
  });

  // D-5986: guards a seam reaches. Each case below is skipped as root (which ignores modes) and restores the modes it changed
  // in a finally, so the fixture's cleanup can remove the tree.
  it('the lock\'s link that fails for a reason other than EEXIST (the --out turns unwritable between the failed link and the retry) refuses out-refused .driver.lock unwritable EACCES and leaves no lock', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const out = freshOut();
    writeFileSync(path.join(out, '.driver.lock'), recText(424270, null));
    let held = 0;
    try {
      expect(thrown(() => replay.claimOut(out, { afterHeld: () => { held++; rmSync(path.join(out, '.driver.lock')); chmodSync(out, 0o500); } })))
        .toMatchObject({ word: 'out-refused', detail: '.driver.lock unwritable EACCES' });
      expect(held, 'the lock was found held once, so the retry is the link that failed').toBe(1);
      expect(existsSync(path.join(out, '.driver.lock')), 'no lock was taken').toBe(false);
    } finally {
      chmodSync(out, 0o700);
    }
    expect(replay.claimOut(out, { liveness: () => 'dead' }).release, 'CONTROL: the mode restored, the same --out is claimed').toBeTypeOf('function');
  });

  /** A box whose stub, just before it exits, removes `rm` (when given) and then makes `sub` mode 0500. */
  function subdirBox(prefix: string, rm: string | null): { b: ReturnType<typeof t5Box>; sub: string } {
    const b = t5Box(prefix);
    const sub = path.join(b.out, 'sub');
    if (rm !== null) writeFileSync(path.join(b.home, 'stub-rm-path'), path.join(sub, rm));
    writeFileSync(path.join(b.home, 'stub-chmod-path'), sub);
    return { b, sub };
  }
  const ledgerLines = (out: string): string[] =>
    existsSync(path.join(out, replay.SPEND_LEDGER)) ? readFileSync(path.join(out, replay.SPEND_LEDGER), 'utf8').split('\n').filter((l) => l !== '') : [];
  /** After a refused run: release the case's claim and claim the --out again as a later driver would (the dead writer's
   *  leftovers are charged again and removed), then answer the ledger's line count. */
  function nextDriverCharges(b: { out: string }): number {
    claimsByOut.get(b.out)?.release();
    claimsByOut.delete(b.out);
    replay.claimOut(b.out, { liveness: () => 'dead' }).release();
    return ledgerLines(b.out).length;
  }

  it('launchRun\'s removal of the .pid after the spend line, in a run subdirectory the stub made mode 0500 before it exited: out-refused sub/<name>.pid unwritable EACCES, charged once, the .part and .pid left for the next driver', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const { b, sub } = subdirBox('ccrc-replay-d5986-postspend-pid-', null);
    try {
      await expect(claimedRun(t5job(b, b.up, 'box', 'sub/run-0')))
        .rejects.toMatchObject({ word: 'out-refused', detail: 'sub/run-0.pid unwritable EACCES' });
      expect(stubLog(b.home), 'the run spawned once').toHaveLength(1);
      expect(ledgerLines(b.out), 'the spend line was written before the removal').toHaveLength(1);
      expect(existsSync(path.join(sub, 'run-0.jsonl.part')), 'the .part stays').toBe(true);
      expect(existsSync(path.join(sub, 'run-0.pid')), 'the .pid stays').toBe(true);
      expect(existsSync(path.join(sub, 'run-0.jsonl')) || existsSync(path.join(sub, 'run-0.run.json')), 'no stream, no run.json').toBe(false);
    } finally {
      chmodSync(sub, 0o700);
    }
    expect(nextDriverCharges(b), 'the next driver charges the left .part again: an over-count, never a lost charge').toBe(2);
    expect(existsSync(path.join(sub, 'run-0.jsonl.part')) || existsSync(path.join(sub, 'run-0.pid')), 'and removes both').toBe(false);
  }, 60_000);

  it('launchRun\'s rename of the .part, in a run subdirectory the stub made mode 0500 after it removed its own .pid: out-refused sub/<name>.jsonl unwritable EACCES, charged once, the .part left for the next driver', async (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const { b, sub } = subdirBox('ccrc-replay-d5986-rename-', 'run-1.pid');
    try {
      await expect(claimedRun(t5job(b, b.up, 'box', 'sub/run-1')))
        .rejects.toMatchObject({ word: 'out-refused', detail: 'sub/run-1.jsonl unwritable EACCES' });
      expect(stubLog(b.home), 'the run spawned once').toHaveLength(1);
      expect(ledgerLines(b.out), 'the spend line was written before the rename').toHaveLength(1);
      expect(existsSync(path.join(sub, 'run-1.jsonl.part')), 'the .part stays').toBe(true);
      expect(existsSync(path.join(sub, 'run-1.pid')), 'the .pid was the stub\'s to remove, and it is gone').toBe(false);
      expect(existsSync(path.join(sub, 'run-1.jsonl')) || existsSync(path.join(sub, 'run-1.run.json')), 'no stream, no run.json').toBe(false);
    } finally {
      chmodSync(sub, 0o700);
    }
    expect(nextDriverCharges(b), 'the next driver charges the left .part again').toBe(2);
    expect(existsSync(path.join(sub, 'run-1.jsonl.part')), 'and removes it').toBe(false);
  }, 60_000);

  it('the .part\'s exclusive create: a regular file planted at <name>.jsonl.part after launchRun\'s settle and before the create (through a RunJob getter) refuses out-refused <name>.jsonl.part already exists, spawns nothing and keeps the planted bytes', async () => {
    const b = t5Box('ccrc-replay-d5986-oexcl-');
    const planted = path.join(b.out, 'ex-0.jsonl.part');
    const job = t5job(b, b.up, 'box', 'ex-0');
    let reads = 0;
    Object.defineProperty(job, 'timeoutMs', {
      enumerable: true,
      // launchRun reads timeoutMs once, after settleLeftover and before runChild creates the .part
      get: () => { reads++; writeFileSync(planted, 'PLANTED\n', { mode: 0o600 }); return 5_000; },
    });
    await expect(claimedRun(job)).rejects.toMatchObject({ word: 'out-refused', detail: 'ex-0.jsonl.part already exists' });
    expect(reads, 'the getter planted the file once, at the place the case means').toBe(1);
    expect(stubLog(b.home), 'no spawn').toBeNull();
    expect(readFileSync(planted, 'utf8'), 'the planted file was not opened for writing').toBe('PLANTED\n');
    expect(existsSync(path.join(b.out, 'ex-0.pid')), 'no .pid').toBe(false);
    expect(ledgerLines(b.out), 'nothing spent').toEqual([]);
  }, 60_000);

  it('a launcher that vanished after admission: the spawn fails with its own error, the child-less .part and .pid are removed, and nothing is charged', async () => {
    const b = t5Box('ccrc-replay-d5986-nospawn-');
    rmSync(b.up.launcher);
    const err = await t5caught(() => claimedRun(t5job(b, b.up, 'box', 'ns-0')));
    expect(err, 'the spawn error is raised as it is').toMatchObject({ code: 'ENOENT' });
    expect(err).not.toBeInstanceOf(replay.DriverRefusal);
    expect(existsSync(path.join(b.out, 'ns-0.jsonl.part')), 'the .part of a spawn that produced no child is removed').toBe(false);
    expect(existsSync(path.join(b.out, 'ns-0.pid')), 'no .pid').toBe(false);
    expect(ledgerLines(b.out), 'nothing spent').toEqual([]);
  }, 60_000);

  it('prepareOut under a parent nobody may write into: the mkdir fails with its own EACCES and --out is refused out-refused create-failed EACCES, nothing created', (ctx) => {
    if (process.getuid?.() === 0) ctx.skip();
    const parent = outsideDir();
    chmodSync(parent, 0o500);
    try {
      const err = thrown(() => replay.prepareOut(path.join(parent, 'out')));
      expect(err).toBeInstanceOf(replay.DriverRefusal);
      expect(err).toMatchObject({ word: 'out-refused', detail: 'create-failed EACCES' });
    } finally {
      chmodSync(parent, 0o700);
    }
    expect(readdirSync(parent), 'nothing was created').toEqual([]);
    expect(replay.prepareOut(path.join(parent, 'out')), 'CONTROL: the mode restored, the same --out is made').toBe(path.join(realpathSync(parent), 'out'));
  });

  // D-5986: the marker write refuses out-refused marker-unwritable <errno>, telling the operator to remove --out. A file-size
  // limit of 0 (prlimit, an argv, no shell) makes the write of the marker's bytes fail EFBIG after mkdir and the exclusive
  // create succeeded: node ignores SIGXFSZ.
  it.skipIf(!existsSync('/usr/bin/prlimit'))('prepareOut whose marker cannot be written (a file-size limit of 0): out-refused marker-unwritable EFBIG, the directory made and the marker left empty', () => {
    const dir = mkTmp('ccrc-replay-d5986-marker-');
    const script = path.join(dir, 'child.mjs');
    writeFileSync(script, `import * as D from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
import { join } from 'node:path';
let said;
try { D.prepareOut(join(process.argv[2], 'out')); said = 'no refusal'; } catch (e) { said = e.word + ': ' + e.detail; }
process.stdout.write(said);
`);
    const r = spawnSync('/usr/bin/prlimit', ['--fsize=0', process.execPath, '--no-warnings', script, dir], { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL', env: { ...scrubbedEnv(process.env), HOME: dir } });
    expect(r.signal, r.stderr).toBeNull();
    expect(r.stdout).toBe('out-refused: marker-unwritable EFBIG; --out was created: remove it before a re-run');
    expect(readdirSync(path.join(dir, 'out')), 'the directory was made; the marker was created empty').toEqual([replay.OUT_MARKER]);
    expect(readFileSync(path.join(dir, 'out', replay.OUT_MARKER), 'utf8'), 'its bytes were not written').toBe('');
  });

  // D-5985, D-5986: the same file-size seam reaches writeWhole's write arm through the lock's tmp (claimOut on a made --out):
  // the tmp's write fails EFBIG, the tmp is dropped and no lock is made. Under --fsize=0 the marker itself would fail, so
  // the parent makes --out.
  it.skipIf(!existsSync('/usr/bin/prlimit'))('claimOut whose lock tmp cannot be written (a file-size limit of 0): out-refused .driver.lock.tmp-<pid> unwritable EFBIG, the tmp dropped and no lock made; a large limit does not refuse', () => {
    const dir = mkTmp('ccrc-replay-d5985-locktmp-');
    const out = replay.prepareOut(path.join(dir, 'out'));
    const script = path.join(dir, 'child.mjs');
    writeFileSync(script, `import * as D from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
let said;
try { D.claimOut(process.argv[2]); said = 'no refusal'; } catch (e) { said = e?.word ? e.word + ': ' + e.detail : 'RAW ' + (e?.code ?? e); }
process.stdout.write(said);
`);
    const run = (fsize: number) => spawnSync('/usr/bin/prlimit', [`--fsize=${fsize}`, process.execPath, '--no-warnings', script, out], { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL', env: { ...scrubbedEnv(process.env), HOME: dir } });
    const r = run(0);
    expect(r.signal, r.stderr).toBeNull();
    expect(r.stdout).toMatch(/^out-refused: \.driver\.lock\.tmp-\d+ unwritable EFBIG$/);
    expect(readdirSync(out).filter((n) => n === '.driver.lock' || n.startsWith('.driver.lock.tmp-')), 'the tmp was dropped and no lock was made').toEqual([]);
    const c = run(1_000_000);
    expect(c.signal, c.stderr).toBeNull();
    expect(c.stdout, 'CONTROL: a large limit does not refuse').toBe('no refusal');
  });

  // D-5986: the same arm through writePlain (ensurePoisonBin): poison-bin/gh unwritable EFBIG, the tmp dropped, no target.
  it.skipIf(!existsSync('/usr/bin/prlimit'))('ensurePoisonBin whose tmp cannot be written (a file-size limit of 0): out-refused poison-bin/gh unwritable EFBIG, nothing left; a large limit does not refuse', () => {
    const dir = mkTmp('ccrc-replay-d5986-poison-');
    const out = replay.prepareOut(path.join(dir, 'out'));
    const script = path.join(dir, 'child.mjs');
    writeFileSync(script, `import * as D from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
let said;
try { D.ensurePoisonBin(process.argv[2]); said = 'no refusal'; } catch (e) { said = e?.word ? e.word + ': ' + e.detail : 'RAW ' + (e?.code ?? e); }
process.stdout.write(said);
`);
    const run = (fsize: number) => spawnSync('/usr/bin/prlimit', [`--fsize=${fsize}`, process.execPath, '--no-warnings', script, out], { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL', env: { ...scrubbedEnv(process.env), HOME: dir } });
    const r = run(0);
    expect(r.signal, r.stderr).toBeNull();
    expect(r.stdout).toBe('out-refused: poison-bin/gh unwritable EFBIG');
    expect(existsSync(path.join(out, 'poison-bin', 'gh')), 'no target').toBe(false);
    expect(readdirSync(path.join(out, 'poison-bin')).filter((n) => n.startsWith('gh.tmp-')), 'the tmp was dropped').toEqual([]);
    const c = run(1_000_000);
    expect(c.signal, c.stderr).toBeNull();
    expect(c.stdout, 'CONTROL: a large limit does not refuse').toBe('no refusal');
    expect(existsSync(path.join(out, 'poison-bin', 'gh')), 'CONTROL: the target exists').toBe(true);
  });

  // D-5986: appendPlain's write arm through recordSpend. The limit is EXACTLY the ledger's size: a larger one makes a partial
  // write and a torn line. The refusal leaves the ledger's bytes as they were.
  it.skipIf(!existsSync('/usr/bin/prlimit'))('recordSpend whose ledger is at the file-size limit: out-refused spend.jsonl unwritable EFBIG, the ledger unchanged; a large limit appends one line', () => {
    const dir = mkTmp('ccrc-replay-d5986-spend-');
    const out = replay.prepareOut(path.join(dir, 'out'));
    replay.recordSpend(out, 'old', 1);
    const ledger = path.join(out, replay.SPEND_LEDGER);
    const before = readFileSync(ledger);
    const script = path.join(dir, 'child.mjs');
    writeFileSync(script, `import * as D from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
let said;
try { D.recordSpend(process.argv[2], 'j0', 5); said = 'no refusal'; } catch (e) { said = e?.word ? e.word + ': ' + e.detail : 'RAW ' + (e?.code ?? e); }
process.stdout.write(said);
`);
    const run = (fsize: number) => spawnSync('/usr/bin/prlimit', [`--fsize=${fsize}`, process.execPath, '--no-warnings', script, out], { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL', env: { ...scrubbedEnv(process.env), HOME: dir } });
    const r = run(before.length);
    expect(r.signal, r.stderr).toBeNull();
    expect(r.stdout).toBe('out-refused: spend.jsonl unwritable EFBIG');
    expect(readFileSync(ledger).equals(before), 'the ledger is byte for byte what it was').toBe(true);
    const c = run(1_000_000);
    expect(c.signal, c.stderr).toBeNull();
    expect(c.stdout, 'CONTROL: a large limit does not refuse').toBe('no refusal');
    const lines = readFileSync(ledger, 'utf8').split('\n').filter((l) => l !== '');
    expect(lines.length, 'CONTROL: exactly one line was added').toBe(2);
    expect(lines[1]).toContain('"j0"');
  });

  // D-5986: appendPlain's fstat arm. A FIFO at spend.jsonl with a reader held open lets the no-follow O_NONBLOCK open succeed, so
  // only the fstat type check refuses (without the held reader the open fails ENXIO, which is the open arm, pinned elsewhere).
  it('recordSpend onto a FIFO ledger with a reader held open: out-refused spend.jsonl is not a regular file, and nothing went into the FIFO', () => {
    const dir = mkTmp('ccrc-replay-d5986-fifo-');
    const out = replay.prepareOut(path.join(dir, 'out'));
    const p = path.join(out, replay.SPEND_LEDGER);
    const mk = spawnSync('mkfifo', [p], { encoding: 'utf8' });
    expect(mk.status, mk.stderr).toBe(0);
    const rd = openSync(p, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const err = thrown(() => replay.recordSpend(out, 'j0', 5));
      expect(err).toBeInstanceOf(replay.DriverRefusal);
      expect(err).toMatchObject({ word: 'out-refused', detail: 'spend.jsonl is not a regular file' });
      // A non-blocking read of a FIFO with no writer answers 0 (end of file), or EAGAIN when a writer is open: either way no bytes.
      let got = 0;
      try { got = readSync(rd, Buffer.alloc(64), 0, 64, null); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EAGAIN') throw e; }
      expect(got, 'the FIFO holds no bytes: nothing of the spend line went into it').toBe(0);
    } finally {
      closeSync(rd);
    }
  });

  /** Run `body` (ESM, top-level await) in a child with a deadline; the driver is `D`, a scratch directory is `base`. */
  function inChild(body: string, ms: number): { out: string; err: string; signal: NodeJS.Signals | null; status: number | null } {
    const dir = mkTmp('ccrc-replay-d5986-child-');
    const script = path.join(dir, 'child.mjs');
    writeFileSync(script, `import * as D from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
import { closeSync, ftruncateSync, mkdirSync, openSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const base = process.argv[2];
const fresh = (n) => { mkdirSync(join(base, n)); return D.prepareOut(join(base, n, 'out')); };
const fifo = (p) => execFileSync('mkfifo', [p]);
const said = (f) => { try { f(); return 'no refusal'; } catch (e) { return e.word + ': ' + e.detail; } };
const results = {};
${body}
process.stdout.write(JSON.stringify(results));
`);
    const r = spawnSync(process.execPath, ['--no-warnings', script, dir], { encoding: 'utf8', timeout: ms, killSignal: 'SIGKILL', env: { ...scrubbedEnv(process.env), HOME: dir } });
    return { out: r.stdout, err: r.stderr, signal: r.signal, status: r.status };
  }

  it('a FIFO as the ledger, the lock, a .pid or a .part never blocks the driver: each is refused, the call returns inside its deadline', () => {
    const r = inChild(`
{ const out = fresh('ledger'); fifo(join(out, D.SPEND_LEDGER));
  results.append = said(() => D.recordSpend(out, 'x', 1));
  results.read = said(() => D.spentSoFar(out)); }
{ const out = fresh('lock'); fifo(join(out, '.driver.lock'));
  results.lock = said(() => D.claimOut(out)); }
{ const out = fresh('pid'); writeFileSync(join(out, 'a.jsonl.part'), '{}\\n'); fifo(join(out, 'a.pid'));
  results.pid = said(() => D.claimOut(out)); }
{ const out = fresh('part'); fifo(join(out, 'b.jsonl.part'));
  results.part = said(() => D.claimOut(out)); }
`, 30_000);
    expect(r.signal, `a call blocked on a FIFO: ${r.err}`).toBeNull();
    expect(r.status, r.err).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      append: 'out-refused: spend.jsonl is not a regular file',
      read: 'out-refused: spend.jsonl is not a regular file',
      lock: 'out-in-use: .driver.lock is not a regular file; remove it only after confirming no driver runs on this --out',
      pid: 'out-refused: a.pid is not a regular file',
      part: 'out-refused: run-stream-invalid b',
    });
  });

  // D-5986: a ledger past the read bound (256 MiB) is out-refused spend.jsonl over-cap, never read and never summed. The file is
  // sparse (no disk), and the call runs in a child, so a read that did happen could not take the test runner with it.
  it('a ledger past the read bound refuses out-refused spend.jsonl over-cap from its size, before any read: the child\'s peak memory stays small', () => {
    const r = inChild(`
{ const out = fresh('cap');
  const fd = openSync(join(out, D.SPEND_LEDGER), 'w'); ftruncateSync(fd, 256 * 1024 * 1024 + 1); closeSync(fd);
  results.read = said(() => D.spentSoFar(out)); }
results.peakMiB = Math.round(process.resourceUsage().maxRSS / 1024);
`, 60_000);
    expect(r.signal, `the read did not finish: ${r.err}`).toBeNull();
    expect(r.status, r.err).toBe(0);
    const got = JSON.parse(r.out);
    expect(got.read).toBe('out-refused: spend.jsonl over-cap');
    // The refusal is the same whether the size or the read loop finds the excess, so the up-front answer shows only as memory:
    // a loop that reads up to the cap holds 256 MiB of chunks.
    expect(got.peakMiB, `the child held ${got.peakMiB} MiB at its peak: the file was read into memory`).toBeLessThan(160);
  }, 90_000);

  it('a --step0a input that is a FIFO, a symlink or a directory refuses input-invalid not-regular and is never opened or waited on', () => {
    const r = inChild(`
const sha = 'a'.repeat(64);
{ const p = join(base, 'in.fifo'); fifo(p); results.fifo = said(() => D.loadStep0a(p, sha)); }
{ writeFileSync(join(base, 'real.json'), '{}\\n'); symlinkSync(join(base, 'real.json'), join(base, 'in.link')); results.link = said(() => D.loadStep0a(join(base, 'in.link'), sha)); }
{ mkdirSync(join(base, 'in.dir')); results.dir = said(() => D.loadStep0a(join(base, 'in.dir'), sha)); }
`, 30_000);
    expect(r.signal, `loadStep0a blocked on a FIFO: ${r.err}`).toBeNull();
    expect(r.status, r.err).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      fifo: 'input-invalid: step0a not-regular', link: 'input-invalid: step0a not-regular', dir: 'input-invalid: step0a not-regular' });
  });

  it('a .pid or a lock the driver cannot tell is a record tells its cause: a malformed one, a type (a .pid out-refused, a lock out-in-use) and an unreadable file (mode 000, skipped as root) say different things', async () => {
    const lockOut = freshOut();
    writeFileSync(path.join(lockOut, '.driver.lock'), 'junk\n');
    expect(() => replay.claimOut(lockOut)).toThrow(/out-in-use: \.driver\.lock is not a lock record/);
    const b = t5Box('ccrc-replay-d5986-cause-');
    writeFileSync(path.join(b.out, 'p-0.jsonl.part'), D6_STREAM);
    writeFileSync(path.join(b.out, 'p-0.pid'), 'junk\n');
    await expect(claimedRun(t5job(b, b.up, 'box', 'p-0'))).rejects.toMatchObject({ word: 'run-live', detail: expect.stringContaining('p-0.pid is not a pid record') });
    rmSync(path.join(b.out, 'p-0.pid'));
    mkdirSync(path.join(b.out, 'p-0.pid'));
    await expect(claimedRun(t5job(b, b.up, 'box', 'p-0'))).rejects.toMatchObject({ word: 'out-refused', detail: 'p-0.pid is not a regular file' });
    if (process.getuid?.() === 0) return;   // root reads a mode 000 file
    const lock = freshOut();
    writeFileSync(path.join(lock, '.driver.lock'), recText(424260, '1'), { mode: 0o600 });
    chmodSync(path.join(lock, '.driver.lock'), 0o000);
    expect(() => replay.claimOut(lock, { liveness: () => 'dead' })).toThrow(/out-in-use: \.driver\.lock is unreadable \(EACCES\)/);
    expect(existsSync(path.join(lock, '.driver.lock')), 'an unreadable lock is left as it was').toBe(true);
    rmSync(path.join(b.out, 'p-0.pid'), { recursive: true });
    writeFileSync(path.join(b.out, 'p-0.pid'), recText(424261, '1'), { mode: 0o600 });
    chmodSync(path.join(b.out, 'p-0.pid'), 0o000);
    await expect(claimedRun(t5job(b, b.up, 'box', 'p-0'), { liveness: () => 'dead' })).rejects.toMatchObject({
      word: 'out-refused', detail: 'p-0.pid unreadable EACCES' });
    expect(replay.spentSoFar(b.out), 'nothing charged for an unreadable record').toBe(0);
    expect(stubLog(b.home), 'nothing spawned').toBeNull();
  }, 60_000);

  it('a lock released between the failed link and the read is taken at once, instead of refusing out-in-use', async () => {
    const out = freshOut();
    const dead = await deadRecord();
    writeFileSync(path.join(out, '.driver.lock'), recText(dead.pid, dead.start));
    let held = 0;
    const c = replay.claimOut(out, { afterHeld: () => { held++; rmSync(path.join(out, '.driver.lock')); } });
    expect(held, 'the lock was found held once').toBe(1);
    expect(readFileSync(path.join(out, '.driver.lock'), 'utf8')).toBe(recText(process.pid, HAS_PROC ? startOf(process.pid) : null));
    expect(readdirSync(out).sort(), 'no tmp or stale file').toEqual([replay.OUT_MARKER, '.driver.lock'].sort());
    c.release();
    const again = freshOut();
    writeFileSync(path.join(again, '.driver.lock'), recText(dead.pid, dead.start));
    let swapped = 0;
    expect(() => replay.claimOut(again, { afterHeld: () => { swapped++; rmSync(path.join(again, '.driver.lock')); writeFileSync(path.join(again, '.driver.lock'), recText(process.pid, null)); } }),
      'CONTROL: a lock that is held again after the release is a live holder\'s, and refuses').toThrow(/out-in-use: pid \d+ holds \.driver\.lock/);
    expect(swapped).toBe(1);
  });
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

  // D-5814: mkdtemp is subject to the umask, so a umask that strips the owner's write bit yields a directory that is not
  // 0700. makeRunCwd refuses it and removes it. The umask is saved and restored around the call (a fork worker).
  it('under umask 0o277 a run cwd made 0500 is refused out-refused run-cwd-mode 500 and removed', () => {
    const tmp = t5MkTmp('ccrc-replay-t5-cwdmode-');
    t5vi.stubEnv('TMPDIR', tmp);
    const was = process.umask(0o277);
    let err: unknown = null;
    try { t5drv.makeRunCwd(); } catch (e) { err = e; } finally { process.umask(was); }
    expect(err).toMatchObject({ word: 'out-refused', detail: 'run-cwd-mode 500' });
    expect(t5fs.readdirSync(tmp), 'the refused directory is removed').toEqual([]);
    expect(t5fs.statSync(t5drv.makeRunCwd()).mode & 0o777, 'CONTROL: under the default umask the cwd is 0700').toBe(0o700);
  });
});

describe('W2-4 Task 5: the driver passes no env whole and names only HOME, TMUX_PANE and LANG on a process.env line (os.tmpdir() reads TMPDIR implicitly, for the run cwd)', () => {
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
    expect(envLines, 'no other process.env text; a handler\'s env arrives as main\'s parameter').toEqual([PROJECTION]);
  });

  it('deploy/history-replay.mjs spells no bypass flag and spawns through no shell', () => {
    const code = t5fs.readFileSync(SRC, 'utf8').split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l));
    expect(code.filter((l) => /dangerously-skip-permissions|bypassPermissions/.test(l))).toEqual([]);
    expect(code.filter((l) => /\bshell\s*:|\b(?:exec|execSync|execFile|execFileSync)\s*\(/.test(l))).toEqual([]);
  });

  // D-5814, widened by W2-5a Task 1: the import block is exactly the fourteen modules W2-5a's driver loads, every one
  // added here once (R3). node:child_process brings in `spawn` only, and node:crypto and each ccd/history module beyond
  // lib.mjs bring in exactly the names the plan's tasks use (W2-D33, W2-D74). A later W2-5a task that adds a name to a
  // module's braces updates that module's entry here in the same commit. So no edit adds a second reader unseen: keptOf
  // (W2-D68), sweep.mjs's recall-off content reader (W2-D29, R6) or a decode of its own. W2-D24's code hash covers the
  // driver and the gate. The other ccd/history modules ride the release tag (W2-D24).
  const EXPECTED_IMPORTS = ['node:fs', 'node:os', 'node:path', 'node:child_process', 'node:url', 'node:crypto',
    '../ccd/history/lib.mjs', '../ccd/history/store.mjs', '../ccd/history/derive.mjs', '../ccd/history/recall.mjs',
    '../ccd/history/cli.mjs', '../ccd/history/sweep.mjs', './history-gate.mjs', '../shared/roster-json.mjs'];
  const EXACT_NAMES: Record<string, string> = {
    'node:child_process': '{ spawn }',
    'node:crypto': '{ randomBytes }',
    '../ccd/history/store.mjs': '{ StoreError, openReader, userVersion }',
    '../ccd/history/derive.mjs': '{ blobReadStmts, bodyOf, epochOfUuid, holdingCopyOf }',
    '../ccd/history/recall.mjs': '{ expandEntryBody, familiesOf as scopeFamiliesOf, transcriptsOf }',
    '../ccd/history/cli.mjs': '{ pairIndexOf }',
    '../ccd/history/sweep.mjs': '{ ftsTextOfBlob }',
  };
  const importViolations = (text: string): string[] => {
    const found: string[] = [];
    const froms = [...text.matchAll(/^import\s+([^;]*?)\s*from\s*'([^']+)';/gms)];
    if (JSON.stringify(froms.map((m) => m[2])) !== JSON.stringify(EXPECTED_IMPORTS)) found.push(`imports ${froms.map((m) => m[2]).join(', ')}`);
    for (const m of froms) {
      const want = EXACT_NAMES[m[2]!];
      if (want !== undefined && m[1]!.trim() !== want) found.push(`${m[2]} brings in ${m[1]}`);
    }
    for (const l of text.split('\n')) {
      if (isComment(l.trim())) continue;
      if (/^import\s*['"]/.test(l) || /\bimport\s*\(/.test(l) || /\brequire\s*\(/.test(l)) found.push(`side-effect or dynamic load ${l.trim()}`);
    }
    return found;
  };
  it('CONTROL: the import scan sees spawnSync, a stray history-gate specifier, node:fs/promises, a dynamic import, a missing module, keptOf from derive.mjs and sweep.mjs\'s recall-off reader', () => {
    const real = t5fs.readFileSync(SRC, 'utf8');
    expect(importViolations(real), 'the driver itself').toEqual([]);
    const variants: Array<[string, string]> = [
      ['spawnSync', real.replace("import { spawn } from 'node:child_process';", "import { spawn, spawnSync } from 'node:child_process';")],
      ['history-gate', real.replace("import { rosterFromJson", "import { x } from '../deploy/history-gate.mjs';\nimport { rosterFromJson")],
      ['fs/promises', real.replace("import os from 'node:os';", "import os from 'node:os';\nimport { readFile } from 'node:fs/promises';")],
      ['dynamic', real + "\nconst m = await import('node:sqlite');\n"],
      ['missing', real.replace("import os from 'node:os';\n", '')],
      // The two below edit a module's braces by pattern, so they hold whatever names later tasks add there.
      ['keptOf', real.replace(/^import \{ ([^}]*) \} from '\.\.\/ccd\/history\/derive\.mjs';$/m, (_m, n: string) => `import { ${n}, keptOf } from '../ccd/history/derive.mjs';`)],
      ['sweep reader', real.replace(/^import \{ ([^}]*) \} from '\.\.\/ccd\/history\/sweep\.mjs';$/m, (_m, n: string) => `import { ${n}, recallOffPresence as sweepPresence } from '../ccd/history/sweep.mjs';`)],
    ];
    for (const [label, text] of variants) {
      expect(text, `${label}: the variant differs from the driver`).not.toBe(real);
      expect(importViolations(text), label).not.toEqual([]);
    }
  });
  it('deploy/history-replay.mjs imports exactly its fourteen modules, and node:child_process, node:crypto and each ccd/history module beyond lib.mjs bring in exactly their pinned names', () => {
    expect(importViolations(t5fs.readFileSync(SRC, 'utf8'))).toEqual([]);
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

  // D-5814: a sample at exactly its resetAt second has rolled over, in readLimits (`now >= resetAt`) and in the driver.
  it('a resetAt equal to now is a lapsed reset, held to readLimits: five alone, then seven alone', async () => {
    const home = mkTmp('ccrc-replay-t6-resetedge-');
    t6Fs.mkdirSync(t6Path.join(home, '.ccrc'), { recursive: true });
    t6Fs.writeFileSync(t6Path.join(home, '.ccrc', 'accounts.json'), JSON.stringify(T6_ROSTER));
    const dir = t6Path.join(home, '.cc-limits');
    t6Fs.mkdirSync(dir, { recursive: true });
    t6Fs.writeFileSync(t6Path.join(dir, 'edge-five.json'), JSON.stringify({ five: 80, seven: 30, ts: NOW_S - 60, fiveResetAt: NOW_S, sevenResetAt: NOW_S + 1000 }));
    t6Fs.writeFileSync(t6Path.join(dir, 'edge-seven.json'), JSON.stringify({ five: 30, seven: 80, ts: NOW_S - 60, fiveResetAt: NOW_S + 1000, sevenResetAt: NOW_S }));
    const theirs = await t6ReadLimits(t6LocalIO, t6LoadConfig({ CCRC_HOME: home }), NOW_S);
    for (const id of ['edge-five', 'edge-seven']) {
      const read = t6Driver.readLimitsRow(home, id, NOW_S);
      expect(read.state, id).toBe('row');
      expect(PICK((read as { row: ReturnType<typeof t6Driver.parseLimitsRow> }).row), id).toEqual(PICK(theirs[id]!));
    }
    expect([theirs['edge-five']!.fiveRolledOver, theirs['edge-five']!.five], 'CONTROL: readLimits rolls five over at resetAt === now').toEqual([true, 0]);
    expect([theirs['edge-seven']!.sevenRolledOver, theirs['edge-seven']!.seven]).toEqual([true, 0]);
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
    t6Fs.writeFileSync(b.row, fresh(10, 10, { ts: NOW_S + 61 }));
    expect(stopOf(b), 'a minute and a second ahead is no longer skew (D-5814)').toEqual({ word: 'limits-stale', detail: 'ts-future 61000' });
    t6Fs.writeFileSync(b.row, fresh(10, 10, { ts: NOW_S + 3600 }));
    expect(stopOf(b)).toEqual({ word: 'limits-stale', detail: 'ts-future 3600000' });
  });

  it('an age-inferred 0 stops as stale even when max_age_ms is raised past its age, so the inference is what stops', () => {
    const b = t6Box('ccrc-replay-t6-inferred-');
    t6Fs.writeFileSync(b.row, JSON.stringify({ five: 99, seven: 20, ts: NOW_S - 20_000 }));
    expect(stopOf(b, { maxAge: 30_000_000 })).toEqual({ word: 'limits-stale', detail: 'inferred-by-age' });
  });

  it('seven ALONE inferred by age stops as stale: five is a resetAt fact, seven is older than its own 7d window, max_age_ms is past seven days (D-5814)', () => {
    const b = t6Box('ccrc-replay-t6-seven-inferred-');
    // five rolled over by a resetAt FACT (not inferred); seven has no resetAt and its sample is 700000 s old (past 604800 s).
    // max_age_ms is raised past that age, so neither the age check nor the threshold stops it: only the sevenInferred half does.
    t6Fs.writeFileSync(b.row, JSON.stringify({ five: 87, seven: 20, ts: NOW_S - 700_000, fiveResetAt: NOW_S - 60 }));
    expect(stopOf(b, { maxAge: 800_000_000 })).toEqual({ word: 'limits-stale', detail: 'inferred-by-age' });
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
    claimFor(out);
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
    await expect(claimedBatch(r.jobs, { concurrency: 1, gate })).rejects.toMatchObject({ word: 'limits-stale', detail: 'old 3601000' });
    expect(stubLog(r.home)?.length, 'the first job spawned and nothing after the stop').toBe(1);
    expect(t6Fs.existsSync(t6Path.join(r.out, 't6-j1.run.json'))).toBe(true);
    expect(t6Fs.existsSync(t6Path.join(r.out, 't6-j2.run.json'))).toBe(false);
    // The operator refreshes the row (one interactive statusline render on the account); the same batch runs again.
    t6Fs.writeFileSync(r.row, rowAt(NOW_S + 3601));
    const again = t6Driver.batchGate({ out: r.out, home: r.home, accountId: 'up-a', budget: 1_000_000, limits: LIMITS, now: () => late });
    again();
    const outcomes = await claimedBatch(r.jobs, { concurrency: 1, gate: again });
    expect(outcomes.map((o) => [o.name, o.skipped]).sort()).toEqual([['t6-j1', true], ['t6-j2', false], ['t6-j3', false]]);
    expect(stubLog(r.home)?.length, 'the finished job is never re-spawned').toBe(3);
    expect(t6Driver.spentSoFar(r.out), 'three spawns of 150 tokens, each counted once: the finished job was never re-spawned').toBe(450);
  }, 60_000);

  it('a budget the first spawn exhausts stops the batch before the second spawn', async () => {
    const r = t6Rig('ccrc-replay-t6-spend-');
    t6Fs.writeFileSync(r.row, rowAt(NOW_S));
    const gate = t6Driver.batchGate({ out: r.out, home: r.home, accountId: 'up-a', budget: 150, limits: LIMITS, now: () => NOW_S * 1000 });
    gate();
    await expect(claimedBatch(r.jobs, { concurrency: 1, gate })).rejects.toMatchObject({ word: 'budget-exhausted', detail: 'spent 150 of 150' });
    expect(stubLog(r.home)?.length, 'one spawn, then the stop').toBe(1);
  }, 60_000);

  // D-5986: budget-exhausted means only that spend has reached the budget. A ledger the gate cannot read whole is out-refused,
  // and a larger --budget does not clear it.
  it('a torn ledger stops the gate out-refused spend.jsonl malformed under any budget, before a spawn; budget-exhausted is left to a ledger that reads', async () => {
    const r = t6Rig('ccrc-replay-t6-torn-');
    t6Fs.writeFileSync(r.row, rowAt(NOW_S));
    t6Fs.writeFileSync(t6Path.join(r.out, t6Driver.SPEND_LEDGER), '{"name":"a","tok');
    for (const budget of [150, 1_000_000_000]) {
      const gate = t6Driver.batchGate({ out: r.out, home: r.home, accountId: 'up-a', budget, limits: LIMITS, now: () => NOW_S * 1000 });
      await expect(claimedBatch(r.jobs, { concurrency: 1, gate }), `budget ${budget}`).rejects.toMatchObject({ word: 'out-refused', detail: 'spend.jsonl malformed' });
    }
    expect(stubLog(r.home), 'no spawn').toBeNull();
    t6Fs.writeFileSync(t6Path.join(r.out, t6Driver.SPEND_LEDGER), '{"name":"a","tokens":200,"ts_ms":1}\n');
    const gate = t6Driver.batchGate({ out: r.out, home: r.home, accountId: 'up-a', budget: 150, limits: LIMITS, now: () => NOW_S * 1000 });
    expect(() => gate(), 'CONTROL: a ledger that reads and has reached the budget').toThrow('budget-exhausted: spent 200 of 150');
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
// ── W2-4 Task 9 imports ──
import * as t9Driver from '../../deploy/history-replay.mjs';
import * as t9Fs from 'node:fs';
import t9Path from 'node:path';
import { createHash as t9CreateHash } from 'node:crypto';

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
      t7expect(withoutDarwinAdded(log.envKeys)).toEqual(['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']);
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
    // D-5986: the input is type-checked before it is opened, so a directory is said to be what it is (it was the kernel's EISDIR).
    t7it('a step 0a path that is a directory refuses input-invalid not-regular', () => {
      const dir = t7path.join(t7path.dirname(plant('x')), 'a-dir');
      t7fs.mkdirSync(dir);
      t7expect(refusalOf(() => t7drv.loadStep0a(dir, t7Sha('x')))).toEqual({ word: 'input-invalid', detail: 'step0a not-regular' });
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
// run uses a fixture tree (t8Tree): a copy of the driver beside the gate's real bytes (the driver imports the gate,
// W2-5a Task 1) and fixture bytes for measure-history.py, so the recorded shas can be pinned exactly; lib.mjs is
// copied, and ccd/history's other entries and shared/ are symlinks to this checkout.
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
  /** The gate's real bytes: the driver imports ./history-gate.mjs (W2-5a Task 1), so a tree it runs from carries the gate
   *  itself, and step 0a records that file's sha. */
  const T8_GATE_BYTES = readFileSync(path.join(REPO, 'deploy', 'history-gate.mjs'));
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

  /** A tree the driver runs from: its own bytes copied (so TREE_ROOT is this tree), the gate's real bytes (the driver
   *  imports it), fixture bytes for deploy/measure-history.py (`measure: false` leaves it out), lib.mjs copied and
   *  ccd/history's other entries and shared/ symlinked to this checkout, so every import resolves. */
  function t8Tree(opts: { measure?: boolean } = {}): string {
    const repo = path.resolve(path.dirname(SCRIPT), '..');
    const tree = mkTmp('ccrc-w2-t8-tree-');
    mkdirSync(path.join(tree, 'deploy'));
    copyFileSync(SCRIPT, path.join(tree, 'deploy', 'history-replay.mjs'));
    writeFileSync(path.join(tree, 'deploy', 'history-gate.mjs'), T8_GATE_BYTES);
    if (opts.measure !== false) writeFileSync(path.join(tree, 'deploy', 'measure-history.py'), T8_MEASURE_BYTES);
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
  function t8Run(tree: string, home: string, args: string[], extraEnv: Record<string, string> = {}, timeout = 120_000) {
    const r = spawnSync(process.execPath, ['--no-warnings', path.join(tree, 'deploy', 'history-replay.mjs'), ...args],
      // SIGKILL at the deadline (D-5986): the driver holds SIGTERM until its event loop turns, so a call blocked on a FIFO would outlive a SIGTERM and hang spawnSync.
      { env: { ...scrubbedEnv(process.env), HOME: home, ...extraEnv }, encoding: 'utf8', timeout, killSignal: 'SIGKILL' });
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
    const ok = { unknownOptions: [] as string[], facts: { init: {} as object | null } };
    expect(replay.flagsAccepted(argvs, [ok, ok])).toEqual({ '--restricted': true, '-p': true, '--tools': true, '--model': true, '--allowedTools': true });
    const named: Record<string, boolean> = replay.flagsAccepted(argvs, [ok, { ...ok, unknownOptions: ['--allowedTools'] }]);
    expect(named['--allowedTools']).toBe(false);
    expect(Object.entries(named).filter(([, v]) => !v).map(([k]) => k)).toEqual(['--allowedTools']);
  });

  // D-5812: a flag is accepted only when a run that carried it reached its init event.
  it('flagsAccepted: a flag whose every run emitted no init is false, a flag a run with an init also carried stays true', () => {
    const argvs = [['--restricted', '-p', '--tools', '', '--model', 'm1'], ['--restricted', '-p', '--tools', 'Bash,Agent', '--allowedTools', 'Bash(x:*)']];
    const reached = { unknownOptions: [] as string[], facts: { init: {} as object | null } };
    const notReached = { unknownOptions: [] as string[], facts: { init: null as object | null } };
    expect(replay.flagsAccepted(argvs, [reached, notReached]), 'the box-only flag was never reached').toEqual({
      '--restricted': true, '-p': true, '--tools': true, '--model': true, '--allowedTools': false });
    expect(replay.flagsAccepted(argvs, [notReached, reached]), 'the writer-only flag was never reached').toEqual({
      '--restricted': true, '-p': true, '--tools': true, '--model': false, '--allowedTools': true });
    expect(Object.values(replay.flagsAccepted(argvs, [notReached, notReached])).every((v) => v === false)).toBe(true);
    expect(replay.flagsAccepted(argvs, [reached, { ...reached, unknownOptions: ['-p'] }])['-p'], 'a run that reached init but named the flag unknown').toBe(false);
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
    // D-5983: the sha256 line is the one stderr line, as open and freeze print it; stdout stays empty.
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe(`sha256 ${sha256Hex(bytes)}\n`);
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
      expect(withoutDarwinAdded(e.envKeys), key).toEqual(['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']);
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
    const printed = /^sha256 ([0-9a-f]{64})\n$/.exec(r.stderr);
    expect(printed, r.stderr).not.toBeNull();
    const file = path.join(out, replay.STEP0A_FILE);
    expect(replay.loadStep0a(file, printed![1]!)).toEqual(JSON.parse(readFileSync(file, 'utf8')));
  }, 120_000);

  // D-5983: the sha256 line is on stderr (as open and freeze print it), exactly one line, and stdout is empty.
  it('on success the sha256 line is the whole of stderr and stdout is empty, the hex being the sha256 of step0a json', () => {
    const home = t8Home('ccrc-w2-t8-shastream-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
    const m = /^sha256 ([0-9a-f]{64})\n$/.exec(r.stderr);
    expect(m, r.stderr).not.toBeNull();
    expect(m![1]).toBe(sha256Hex(readFileSync(path.join(out, replay.STEP0A_FILE))));
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
    // D-5815: every required flag is checked before --out is made, so a missing one never leaves a fresh --out behind.
    expect(existsSync(out), `a missing --${flag} left --out behind`).toBe(false);
  }, 60_000);

  // D-5815: the required-flag check precedes admission (it supersedes Task 8's order), so a missing --budget answers
  // args-invalid even when the account would be refused, and nothing is made.
  it('a missing --budget with an unadmissible account answers budget-required, not account-refused, and makes no --out', () => {
    const home = t8Home('ccrc-w2-t8-required-first-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { account: 'cx-a', budget: null }));
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('ccrc history-replay: args-invalid: budget-required\n');
    expect(existsSync(out)).toBe(false);
    expect(stubLog(home)).toBeNull();
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

  // D-5813: a model id the argv builder would throw on, and a ':' in HOME or --out (PATH's separator), are operator
  // inputs: a driver word before --out is made, never exit 1 after the writer run has spent.
  it.each(['writer-model', 'judge-model', 'arm-model'])('a malformed --%s is refused args-invalid before --out is made, with no spawn and no spend', (flag) => {
    for (const bad of ['fx judge', '-x']) {
      const home = t8Home('ccrc-w2-t8-badmodel-');
      const out = t8Out();
      const r = t8Run(t8Tree(), home, t8Argv(out, { [flag]: bad }));
      expect(r.code, `${bad}: ${r.stderr}`).toBe(2);
      expect(r.stderr, bad).toBe(`ccrc history-replay: args-invalid: ${flag} ${JSON.stringify(bad)} is not a model id\n`);
      expect(stubLog(home), `${bad}: nothing spawned`).toBeNull();
      expect(existsSync(out), `${bad}: --out not made`).toBe(false);
    }
    const home = t8Home('ccrc-w2-t8-goodmodel-');
    const control = t8Run(t8Tree(), home, t8Argv(t8Out(), { [flag]: 'fixture-model-ok.1:x' }));
    expect(control.code, `CONTROL: ${control.stderr}`).toBe(0);
  }, 120_000);

  it("a ':' in HOME or in --out is refused args-invalid before --out is made and before any spawn", () => {
    const home = t8Home('ccrc-w2-t8-colon-');
    const out = t8Out();
    const inHome = t8Run(t8Tree(), home, t8Argv(out), { HOME: '/fixture/home:x' });
    expect(inHome.code).toBe(2);
    expect(inHome.stderr).toBe("ccrc history-replay: args-invalid: HOME contains ':'\n");
    expect(existsSync(out)).toBe(false);
    const colonOut = path.join(mkTmp('ccrc-w2-t8-colonout-'), 'out:x');
    const inOut = t8Run(t8Tree(), home, t8Argv(colonOut));
    expect(inOut.code).toBe(2);
    expect(inOut.stderr).toBe("ccrc history-replay: args-invalid: out contains ':'\n");
    expect(existsSync(colonOut)).toBe(false);
    expect(stubLog(home)).toBeNull();
  }, 60_000);

  // D-5813: the ':' check also runs on the realpath prepareOut answers, so an --out under an ancestor symlink to a
  // directory whose name holds ':' is a driver word, not spawnEnv's TypeError (exit 1). Without the check that TypeError
  // is thrown BEFORE any spawn (in measureClaudeVersion's env build for step 0a, in launchRun for the probe), so the empty
  // stub log does not tell the mutant from the guard: the exit code does.
  it("an --out under an ancestor symlink to a path holding ':' is refused args-invalid before any spawn", () => {
    const home = t8Home('ccrc-w2-t8-colonlink-');
    const base = mkTmp('ccrc-w2-t8-colonlink-base-');
    mkdirSync(path.join(base, 'a:b'));
    symlinkSync(path.join(base, 'a:b'), path.join(base, 'link'));
    const r = t8Run(t8Tree(), home, t8Argv(path.join(base, 'link', 'out')));
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toBe("ccrc history-replay: args-invalid: out contains ':'\n");
    expect(stubLog(home)).toBeNull();
  }, 60_000);

  it('a settings mode outside SETTINGS_MODES is refused args-invalid before any spawn', () => {
    const home = t8Home('ccrc-w2-t8-settings-');
    const r = t8Run(t8Tree(), home, t8Argv(t8Out(), { 'settings-mode': 'open' }));
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('ccrc history-replay: args-invalid: settings-mode open\n');
    expect(stubLog(home)).toBeNull();
  }, 60_000);

  // D-5815: --settings-mode is checked before --out is made, as the probe checks it, so a bogus value is a usage mistake
  // that leaves nothing behind.
  it('--settings-mode bogus is refused args-invalid and no --out is made', () => {
    const home = t8Home('ccrc-w2-t8-settings-first-');
    const out = t8Out();
    const r = t8Run(t8Tree(), home, t8Argv(out, { 'settings-mode': 'bogus' }));
    expect(r.code).toBe(2);
    expect(r.stderr).toBe('ccrc history-replay: args-invalid: settings-mode bogus\n');
    expect(existsSync(out), 'a bogus --settings-mode left --out behind').toBe(false);
    expect(stubLog(home)).toBeNull();
  }, 60_000);

  it('an unmeasured code sha refuses code-unmeasured, and an untagged stamp tree-unmeasured, before any spawn', () => {
    const home = t8Home('ccrc-w2-t8-unmeasured-');
    // W2-5a Task 1: a tree without the gate cannot load the driver (it imports the gate), so the absent file is the census script.
    const noMeasure = t8Run(t8Tree({ measure: false }), home, t8Argv(t8Out()));
    expect(noMeasure.code).toBe(2);
    expect(noMeasure.stderr).toBe('ccrc history-replay: code-unmeasured: deploy/measure-history.py is absent\n');
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

  // D-5986: the init read after the batch. The stub acts only in the box run (the last of the three): it replaces the writer's
  // finished stream, which the earlier lane left a regular file, by a directory. Nothing between that run and the read
  // looks at the writer's stream again, so the read is what finds it. (The box run's own stream is renamed by the driver
  // after the stub has exited, so it cannot be the one the stub changes.)
  it('step0a: a finished stream that stops being a regular file by the time the batch is done refuses out-refused run-stream-invalid step0a/writer from the init read, and writes no step0a json', () => {
    const home = t8Home('ccrc-w2-t8-initread-');
    const out = t8Out();
    mkdirSync(path.dirname(out), { recursive: true });
    const real = path.join(realpathSync(path.dirname(out)), 'out');
    writeFileSync(path.join(home, 'stub-box-swap-path'), path.join(real, 'step0a', 'writer.jsonl'));
    const r = t8Run(t8Tree(), home, t8Argv(out));
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toBe('ccrc history-replay: out-refused: run-stream-invalid step0a/writer\n');
    expect(t8Runs(home).map(t8ModelOf), 'all three runs spawned and finished').toEqual([T8_MODELS.writer, T8_MODELS.judge, T8_MODELS.box]);
    expect(lstatSync(path.join(out, 'step0a', 'writer.jsonl')).isDirectory(), 'the stub made the swap').toBe(true);
    expect(existsSync(path.join(out, replay.STEP0A_FILE)), 'no step0a json').toBe(false);
    expect(existsSync(path.join(out, 'step0a', 'box.run.json')), 'the box run itself was recorded').toBe(true);
  }, 120_000);

  // D-5812: step 0a pins the launch it measured (account, Claude Code version, wrapper sha256) before its first run.
  describe('the launch step 0a recorded is the launch a resume runs under (D-5812)', () => {
    const FIRST_LINE = T8_STREAM.split('\n')[0]!;
    const MOVED_STREAM = T8_STREAM.replace('fixture-model-writer', 'fixture-model-moved');
    const MOVED_LINE = MOVED_STREAM.split('\n')[0]!;
    const stoppedStep0a = (home: string, tree: string, out: string, account = 'up-a') => {
      const stopped = t8Run(tree, home, t8Argv(out, { account, budget: String(T8_PER_RUN) }));
      expect(stopped.code, stopped.stderr).toBe(2);
      expect(stopped.stderr.startsWith('ccrc history-replay: budget-exhausted: ')).toBe(true);
      expect(t8Runs(home).map(t8ModelOf)).toEqual([T8_MODELS.writer]);
    };
    const resume = (home: string, tree: string, out: string, account = 'up-a') => t8Run(tree, home, t8Argv(out, { account, budget: String(10 * T8_PER_RUN) }));

    it('pins {kind, v, account, claude_code_version, wrapper_sha256} at 0600 before the first run', () => {
      const home = t8Home('ccrc-w2-t8-launch-pin-');
      const out = t8Out();
      stoppedStep0a(home, t8Tree(), out);
      const file = path.join(out, 'step0a', 'launch.json');
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
        kind: 'ccrc-history-replay-step0a-launch', v: 1, account: 'up-a', claude_code_version: FIRST_LINE, wrapper_sha256: null });
      expect(readdirSync(path.join(out, 'step0a')).sort()).toEqual(['launch.json', 'writer.jsonl', 'writer.run.json']);
    }, 120_000);

    it('a Claude Code version that moved between the stop and the resume refuses claude-version-moved with no new spawn; nothing moved resumes', () => {
      const home = t8Home('ccrc-w2-t8-launch-version-');
      const tree = t8Tree();
      const out = t8Out();
      stoppedStep0a(home, tree, out);
      writeFileSync(path.join(home, STUB_STREAM), MOVED_STREAM);
      const r = resume(home, tree, out);
      expect(r.code).toBe(2);
      expect(r.stderr).toBe(`ccrc history-replay: claude-version-moved: step0a recorded ${JSON.stringify(FIRST_LINE)}, now ${JSON.stringify(MOVED_LINE)}\n`);
      expect(t8Runs(home), 'no new spawn').toHaveLength(1);
      expect(existsSync(path.join(out, replay.STEP0A_FILE))).toBe(false);
      writeFileSync(path.join(home, STUB_STREAM), T8_STREAM);
      const control = resume(home, tree, out);
      expect(control.code, control.stderr).toBe(0);
      expect(JSON.parse(readFileSync(path.join(out, replay.STEP0A_FILE), 'utf8')).claude_code_version).toBe(FIRST_LINE);
      const again = resume(home, tree, out);
      expect(again.code, 'a complete step0a re-run with nothing moved still exits 0').toBe(0);
    }, 180_000);

    it('a wrapper that moved between the stop and the resume refuses wrapper-moved with no new spawn; the wrapper restored resumes', () => {
      const home = t8Home('ccrc-w2-t8-launch-wrapper-');
      const tree = t8Tree();
      const out = t8Out();
      stoppedStep0a(home, tree, out, 'gen-a');
      const wrapper = path.join(home, '.local', 'bin', 'gen-a');
      const was = readFileSync(wrapper);
      writeFileSync(wrapper, Buffer.concat([was, Buffer.from('\n# moved\n')]), { mode: 0o755 });
      const r = resume(home, tree, out, 'gen-a');
      expect(r.code).toBe(2);
      expect(r.stderr).toBe(`ccrc history-replay: wrapper-moved: step0a recorded ${JSON.stringify(sha256Hex(was))}, now ${JSON.stringify(sha256Hex(readFileSync(wrapper)))}\n`);
      expect(t8Runs(home), 'no new spawn').toHaveLength(1);
      writeFileSync(wrapper, was, { mode: 0o755 });
      const control = resume(home, tree, out, 'gen-a');
      expect(control.code, control.stderr).toBe(0);
    }, 180_000);

    it('a step0a that is a regular file in an otherwise valid --out refuses out-refused (step0a is not a directory, D-5986) before any new spawn and spends nothing', () => {
      const home = t8Home('ccrc-w2-t8-launch-dirfile-');
      const tree = t8Tree();
      const out = t8Out();
      stoppedStep0a(home, tree, out);
      const ledgerBefore = readFileSync(path.join(out, replay.SPEND_LEDGER), 'utf8');
      rmSync(path.join(out, 'step0a'), { recursive: true });
      writeFileSync(path.join(out, 'step0a'), 'not a directory');
      const r = resume(home, tree, out);
      expect(r.code, r.stderr).toBe(2);
      expect(r.stderr).toBe('ccrc history-replay: out-refused: step0a is not a directory\n');
      expect(t8Runs(home), 'no new print-mode run').toHaveLength(1);
      expect(readFileSync(path.join(out, replay.SPEND_LEDGER), 'utf8'), 'no new spend line').toBe(ledgerBefore);
    }, 180_000);

    // D-5986: a step0a that is a link in a reused --out is refused, never followed, and never an exit 1.
    it('a step0a that is a symlink (to a directory, or dangling) in a reused --out refuses out-refused step0a is not a directory: exit 2, nothing written through it, no spawn', () => {
      for (const dangling of [false, true]) {
        const home = t8Home(`ccrc-w2-t8-d5986-link-${dangling}-`);
        const out = t8Out();
        replay.prepareOut(out);
        const target = path.join(mkTmp('ccrc-w2-t8-d5986-target-'), 'dir');
        if (!dangling) mkdirSync(target);
        symlinkSync(target, path.join(out, 'step0a'));
        const r = t8Run(t8Tree(), home, t8Argv(out), {}, 60_000);
        expect(r.code, `dangling ${dangling}: ${r.stderr}`).toBe(2);
        expect(r.stderr).toBe('ccrc history-replay: out-refused: step0a is not a directory\n');
        if (dangling) expect(existsSync(target), 'the dangling target is not created').toBe(false);
        else expect(readdirSync(target), 'nothing written through the link').toEqual([]);
        expect(t8Runs(home), 'no print-mode run').toEqual([]);
      }
    }, 180_000);

    it('a finished run whose stream or run.json is a FIFO, a directory, a link or (the stream) gone is refused out-refused on the resume: exit 2, never a block, never exit 1, no new spawn', () => {
      const home = t8Home('ccrc-w2-t8-d5986-finished-');
      const tree = t8Tree();
      const out = t8Out();
      stoppedStep0a(home, tree, out);
      const stream = path.join(out, 'step0a', 'writer.jsonl');
      const runJson = path.join(out, 'step0a', 'writer.run.json');
      const streamBytes = readFileSync(stream);
      const runJsonBytes = readFileSync(runJson);
      const link = path.join(home, 'link-target');
      writeFileSync(link, 'x');
      const fifo = (p: string): void => { expect(spawnSync('mkfifo', [p]).status).toBe(0); };
      const changed = 'ccrc history-replay: out-refused: run-stream-changed step0a/writer\n';
      const unreadable = 'ccrc history-replay: out-refused: run-json-unreadable step0a/writer not-regular\n';
      const rows: Array<[string, (p: string) => void, string, string]> = [
        ['a FIFO as the stream', fifo, stream, changed],
        ['a directory as the stream', (p) => mkdirSync(p), stream, changed],
        ['a symlink as the stream', (p) => symlinkSync(link, p), stream, changed],
        ['the stream gone', () => {}, stream, changed],
        ['a FIFO as run.json', fifo, runJson, unreadable],
        ['a directory as run.json', (p) => mkdirSync(p), runJson, unreadable],
        ['a symlink as run.json', (p) => symlinkSync(link, p), runJson, unreadable],
      ];
      for (const [label, plant, at, line] of rows) {
        rmSync(stream, { recursive: true, force: true });
        rmSync(runJson, { recursive: true, force: true });
        writeFileSync(stream, streamBytes);
        writeFileSync(runJson, runJsonBytes);
        rmSync(at);
        plant(at);
        const r = t8Run(tree, home, t8Argv(out, { account: 'up-a', budget: String(10 * T8_PER_RUN) }), {}, 30_000);
        expect(r.code, `${label}: ${r.stderr}`).toBe(2);
        expect(r.stderr, label).toBe(line);
        expect(t8Runs(home), `${label}: no new print-mode run`).toHaveLength(1);
      }
      writeFileSync(stream, streamBytes);
      rmSync(runJson, { recursive: true, force: true });
      writeFileSync(runJson, runJsonBytes);
      const control = resume(home, tree, out);
      expect(control.code, `CONTROL: the untouched pair resumes: ${control.stderr}`).toBe(0);
    }, 300_000);

    it('a launch.json that is not a file, not JSON, of another kind or version, over its size, of the wrong types or for another account is refused before any new spawn', () => {
      const home = t8Home('ccrc-w2-t8-launch-invalid-');
      const tree = t8Tree();
      const out = t8Out();
      stoppedStep0a(home, tree, out);
      const file = path.join(out, 'step0a', 'launch.json');
      const good = readFileSync(file, 'utf8');
      const rec = JSON.parse(good) as Record<string, unknown>;
      const as = (v: unknown): (() => void) => () => writeFileSync(file, JSON.stringify(v) + '\n');
      const invalid = 'ccrc history-replay: out-refused: step0a-launch-invalid\n';
      const copy = path.join(home, 'launch-copy.json');
      const rows: Array<[string, () => void, string, number?]> = [
        ['a directory', () => { rmSync(file); mkdirSync(file); }, invalid],
        ['a symlink to a good launch.json', () => { writeFileSync(copy, good); rmSync(file); symlinkSync(copy, file); }, invalid],
        ['a FIFO (read with a deadline)', () => { rmSync(file); expect(spawnSync('mkfifo', [file]).status).toBe(0); }, invalid, 20_000],
        ['not JSON', () => writeFileSync(file, 'not json'), invalid],
        ['the JSON null', as(null), invalid],
        ['an array', as([rec]), invalid],
        ['another kind', as({ ...rec, kind: 'ccrc-history-replay-other' }), invalid],
        ['another version', as({ ...rec, v: 2 }), invalid],
        ['over its size bound', as({ ...rec, pad: 'x'.repeat(5000) }), invalid],
        ['an account that is not a string', as({ ...rec, account: 7 }), invalid],
        ['a version that is not a string', as({ ...rec, claude_code_version: 7 }), invalid],
        ['a wrapper sha of the wrong type', as({ ...rec, wrapper_sha256: 7 }), invalid],
        ['another account', as({ ...rec, account: 'other-a' }), 'ccrc history-replay: out-refused: step0a-launch-mismatch\n'],
      ];
      for (const [label, plant, line, deadline] of rows) {
        rmSync(file, { recursive: true, force: true });
        writeFileSync(file, good);
        plant();
        const r = deadline === undefined ? resume(home, tree, out)
          : t8Run(tree, home, t8Argv(out, { budget: String(10 * T8_PER_RUN) }), {}, deadline);
        expect(r.code, label).toBe(2);
        expect(r.stderr, label).toBe(line);
        expect(t8Runs(home), `${label}: no new spawn`).toHaveLength(1);
      }
      rmSync(file, { recursive: true, force: true });
      writeFileSync(file, good);
      const control = resume(home, tree, out);
      expect(control.code, control.stderr).toBe(0);
    }, 300_000);
  });

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

  // D-5984: a driver stopped by SIGINT, SIGTERM or SIGHUP leaves no child running and starts no further spawn. The real driver
  // runs as a child of this test with the real liveness reader; the stub sleeps through the writer run so the signal lands
  // while it runs. Only the driver child this case started, and that child's own process groups, are ever signalled.
  describe('a signal stops the driver: no child left running, no further spawn, nothing recorded (D-5984)', () => {
    const SLEEPER_STUB = `#!/usr/bin/env node
(async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const home = path.resolve(path.dirname(process.argv[1]), '..', '..');
  const args = process.argv.slice(2);
  if (args.includes('--version')) {
    if (fs.existsSync(path.join(home, 'version-sleep'))) {
      fs.writeFileSync(path.join(home, 'version-started'), String(process.pid));
      await new Promise((r) => setTimeout(r, 60000));
    }
    process.stdout.write('9.9.9 (Claude Code)\\n');
    return;
  }
  fs.readFileSync(0);
  // The spawn is logged only AFTER the ignoring handler is installed and the grandchild is recorded, and the case signals on
  // that log line: a SIGTERM that landed earlier would end the stub and let a dropped-SIGKILL mutant pass by chance.
  if (fs.existsSync(path.join(home, 'ignore-term'))) process.on('SIGTERM', () => {});
  if (fs.existsSync(path.join(home, 'with-grandchild'))) {
    // A grandchild in the stub's own group (no setsid), its stdio on /dev/null: only a group signal reaches it.
    const g = (await import('node:child_process')).spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
    fs.writeFileSync(path.join(home, 'grandchild.pid'), String(g.pid));
  }
  fs.appendFileSync(path.join(home, 'spawn-log.jsonl'), JSON.stringify({ pid: process.pid, argv: args }) + '\\n');
  const ms = Number(fs.readFileSync(path.join(home, 'sleep-ms'), 'utf8'));
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  process.stdout.write(fs.readFileSync(path.join(home, 'stub-stream.jsonl'), 'utf8'));
})();
`;
    const STOP_GRACE_MS = 5_000;   // the driver's own, module-private
    const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const spawnLog = (home: string): Array<{ pid: number; argv: string[] }> => {
      const p = path.join(home, 'spawn-log.jsonl');
      return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : [];
    };
    const modelOf = (e: { argv: string[] }): string => e.argv[e.argv.indexOf('--model') + 1]!;

    it.each([
      ['SIGTERM', false], ['SIGINT', false], ['SIGHUP', false], ['SIGTERM', true],
    ] as const)('%s while the writer runs (stub ignores SIGTERM: %s): exit 2 interrupted, the writer\'s group is gone, no judge or box spawn, no run.json, no step0a.json, no .pid or .part; a re-run spawns the writer again', async (sig, ignoresTerm) => {
      const home = t8Home('ccrc-w2-t8-signal-');
      writeFileSync(path.join(home, '.local', 'bin', 'up-a'), SLEEPER_STUB, { mode: 0o700 });
      writeFileSync(path.join(home, 'sleep-ms'), '60000');
      writeFileSync(path.join(home, 'with-grandchild'), '');
      if (ignoresTerm) writeFileSync(path.join(home, 'ignore-term'), '');
      const tree = t8Tree();
      const out = t8Out();
      const driver = spawn(process.execPath, ['--no-warnings', path.join(tree, 'deploy', 'history-replay.mjs'), ...t8Argv(out)],
        { env: { ...scrubbedEnv(process.env), HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
      startedChildren.push(driver);
      let stdout = '';
      let stderr = '';
      driver.stdout.on('data', (d) => { stdout += String(d); });
      driver.stderr.on('data', (d) => { stderr += String(d); });
      const exited = new Promise<{ code: number | null; signal: string | null }>((r) => driver.once('close', (code, signal) => r({ code, signal })));
      let stubPid = 0;
      let grandchildPid = 0;
      try {
        const pidFile = path.join(out, 'step0a', 'writer.pid');
        expect(await until(() => existsSync(pidFile) && spawnLog(home).length === 1, 60_000), 'the writer started and was recorded').toBe(true);
        stubPid = JSON.parse(readFileSync(pidFile, 'utf8')).pid;
        expect(spawnLog(home)[0]!.pid, 'the record names the stub').toBe(stubPid);
        expect(groupGone(stubPid), 'the stub leads a live group').toBe(false);
        grandchildPid = Number(readFileSync(path.join(home, 'grandchild.pid'), 'utf8'));
        expect(alive(grandchildPid), 'CONTROL: the grandchild in the stub\'s group is running').toBe(true);
        const signalled = Date.now();
        driver.kill(sig);
        // The SIGTERM step: a stub that exits on SIGTERM is gone, group and all, well before the grace ends, so a stop whose
        // SIGTERM step is dropped (only the SIGKILL after the grace remains) reds here. The ignoring stub is ended by the
        // SIGKILL after the grace, which is its own bound below.
        expect(await until(() => groupGone(stubPid), 10_000), 'no process is left in the writer\'s group').toBe(true);
        const groupEnded = Date.now() - signalled;
        if (ignoresTerm) expect(groupEnded, 'the stub that ignores SIGTERM lives until the SIGKILL after the grace').toBeGreaterThanOrEqual(STOP_GRACE_MS - 500);
        else expect(groupEnded, 'a cooperative stub ends on the SIGTERM, before the grace').toBeLessThan(STOP_GRACE_MS);
        const r = await bounded(exited, ignoresTerm ? 40_000 : 30_000, 'the driver exiting after the signal');
        expect(r, `${stderr}`).toEqual({ code: 2, signal: null });
        expect(stdout).toBe('');
        expect(stderr).toMatch(new RegExp(`^ccrc history-replay: interrupted: ${sig} received; [^\\n]*\\n$`));
        // The group half: a signal sent to the leader alone leaves the grandchild running.
        expect(await until(() => !alive(grandchildPid), 10_000), 'the grandchild in the writer\'s group died with it').toBe(true);
        expect(spawnLog(home).map(modelOf), 'the judge and the box never spawned').toEqual([T8_MODELS.writer]);
        expect(existsSync(path.join(out, 'step0a', 'writer.run.json')), 'no run.json for the stopped run').toBe(false);
        expect(existsSync(path.join(out, replay.STEP0A_FILE)), 'no step0a.json').toBe(false);
        expect(readdirSync(path.join(out, 'step0a')).filter((n) => n.endsWith('.pid') || n.endsWith('.part')), 'no record or stream left').toEqual([]);
        expect(existsSync(path.join(out, '.driver.lock')), 'the lock is released').toBe(false);
        expect(readFileSync(path.join(out, replay.SPEND_LEDGER), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l).name),
          'the stopped run\'s spend line is written once').toEqual(['step0a/writer']);
        // A plain re-run spawns the writer again, then the judge and the box.
        writeFileSync(path.join(home, 'sleep-ms'), '0');
        rmSync(path.join(home, 'ignore-term'), { force: true });
        rmSync(path.join(home, 'with-grandchild'), { force: true });
        const again = t8Run(tree, home, t8Argv(out));
        expect(again.code, again.stderr).toBe(0);
        expect(spawnLog(home).slice(1).map(modelOf)).toEqual([T8_MODELS.writer, T8_MODELS.judge, T8_MODELS.box]);
        expect(existsSync(path.join(out, replay.STEP0A_FILE))).toBe(true);
      } finally {
        if (stubPid > 0) { try { process.kill(-stubPid, 'SIGKILL'); } catch { /* gone */ } }
        if (grandchildPid > 0) { try { process.kill(grandchildPid, 'SIGKILL'); } catch { /* gone */ } }
        driver.kill('SIGKILL');
      }
    }, 180_000);

    it('SIGTERM while --version runs: exit 2 interrupted (never version-unmeasured), the version child\'s group is gone, step0a has written nothing', async () => {
      const home = t8Home('ccrc-w2-t8-signal-version-');
      writeFileSync(path.join(home, '.local', 'bin', 'up-a'), SLEEPER_STUB, { mode: 0o700 });
      writeFileSync(path.join(home, 'sleep-ms'), '0');
      writeFileSync(path.join(home, 'version-sleep'), '');
      const tree = t8Tree();
      const out = t8Out();
      const driver = spawn(process.execPath, ['--no-warnings', path.join(tree, 'deploy', 'history-replay.mjs'), ...t8Argv(out)],
        { env: { ...scrubbedEnv(process.env), HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
      startedChildren.push(driver);
      let stderr = '';
      driver.stderr.on('data', (d) => { stderr += String(d); });
      const exited = new Promise<{ code: number | null; signal: string | null }>((r) => driver.once('close', (code, signal) => r({ code, signal })));
      let versionPid = 0;
      try {
        const started = path.join(home, 'version-started');
        expect(await until(() => existsSync(started) && readFileSync(started, 'utf8') !== '', 60_000), 'the --version child started').toBe(true);
        versionPid = Number(readFileSync(started, 'utf8'));
        driver.kill('SIGTERM');
        expect(await bounded(exited, 30_000, 'the driver exiting after the signal'), stderr).toEqual({ code: 2, signal: null });
        expect(stderr).toMatch(/^ccrc history-replay: interrupted: SIGTERM received; [^\n]*\n$/);
        expect(await until(() => groupGone(versionPid), 10_000), 'the --version child\'s group is gone').toBe(true);
        expect(spawnLog(home), 'no run spawned').toEqual([]);
        expect(existsSync(path.join(out, 'step0a')) || existsSync(path.join(out, replay.STEP0A_FILE)), 'nothing written by step0a').toBe(false);
        expect(existsSync(path.join(out, '.driver.lock')), 'the lock is released').toBe(false);
      } finally {
        if (versionPid > 0) { try { process.kill(-versionPid, 'SIGKILL'); } catch { /* gone */ } }
        driver.kill('SIGKILL');
      }
    }, 120_000);
  });
});

// ── W2-4 Task 9: the probe and step 0b's mechanics (W2-D58, W2-D57, W2-D55) ─────────────────────────────────────
// The probe drives the real subcommand through runDriver against Task 5's recording stub at $HOME/.local/bin/up-a.
// Step 0b's mechanics are exports W2-5b wires; they are pinned here at function level and, for the two halves of
// the persistence check, through step0bMechanics on a stub (Task 5's, and a Task 9 stub that writes the transcript
// a --no-session-persistence run must not leave).

/** One stream-json line per event, as `claude -p --output-format stream-json --verbose` prints them: the init
 *  event, an assistant message per tool call (each followed by its tool_result) and per extra text turn, and a
 *  result event unless `result` is null, its subtype `success` unless one is given. Every message id is distinct. */
function t9Stream(o: {
  sessionId: string | null;
  assistants: number;
  result: null | { numTurns: number | null; subtype?: string; denials?: unknown[] };
  calls?: Array<{ id: string; command: string; isError: boolean }>;
}): string {
  const usage = { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 2 };
  const lines: unknown[] = [{
    type: 'system', subtype: 'init', ...(o.sessionId === null ? {} : { session_id: o.sessionId }), model: 'fixture-model-arm',
    tools: ['Bash', 'Agent'], mcp_servers: [], plugins: [], skills: [], slash_commands: [],
  }];
  let n = 0;
  for (const c of o.calls ?? []) {
    n += 1;
    lines.push({ type: 'assistant', message: { id: `msg-${n}`, role: 'assistant', content: [{ type: 'tool_use', id: c.id, name: 'Bash', input: { command: c.command } }], usage } });
    lines.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: c.id, content: c.isError ? 'permission denied' : '{}', is_error: c.isError }] } });
  }
  while (n < o.assistants) {
    n += 1;
    lines.push({ type: 'assistant', message: { id: `msg-${n}`, role: 'assistant', content: [{ type: 'text', text: 'DONE' }], usage } });
  }
  if (o.result !== null) {
    lines.push({
      type: 'result', subtype: o.result.subtype ?? 'success', is_error: (o.result.subtype ?? 'success') !== 'success',
      ...(o.result.numTurns === null ? {} : { num_turns: o.result.numTurns }),
      result: 'DONE', usage, permission_denials: o.result.denials ?? [],
    });
  }
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

/** The LaunchSpec Task 3's admitAccount answers for the upstream fixture up-a. */
function t9Launch(home: string): { accountId: string; kind: 'upstream'; launcher: string; configDir: string; wrapperPath: null; secretsPath: null } {
  return { accountId: 'up-a', kind: 'upstream', launcher: t9Path.join(home, '.local', 'bin', 'up-a'), configDir: t9Path.join(home, '.claude'), wrapperPath: null, secretsPath: null };
}

/** A stub that prints $HOME/<STUB_STREAM> and then does what --no-session-persistence forbids: it writes
 *  `<CLAUDE_CONFIG_DIR>/projects/<slug of its cwd>/<the init session_id>.jsonl`. */
function t9PlantPersistingStub(home: string, id: string): void {
  const bin = t9Path.join(home, '.local', 'bin');
  t9Fs.mkdirSync(bin, { recursive: true });
  t9Fs.writeFileSync(t9Path.join(bin, id), [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'fs.readFileSync(0);',
    `const text = fs.readFileSync(path.join(process.env.HOME, ${JSON.stringify(STUB_STREAM)}), 'utf8');`,
    'process.stdout.write(text);',
    "const sid = JSON.parse(text.split('\\n')[0]).session_id;",
    "const dir = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));",
    'fs.mkdirSync(dir, { recursive: true });',
    "fs.writeFileSync(path.join(dir, sid + '.jsonl'), text);",
    '',
  ].join('\n'), { mode: 0o700 });
}

describe('W2-4 Task 9: the probe, a box verb and an early check only, W2-D58', () => {
  type T9Entry = { argv: string[]; envKeys: string[]; stdin: string };
  const T9_MODEL = 'fixture-model-arm';
  const t9Account = (id: string, configDirSuffix: string, exec: Record<string, unknown>) =>
    ({ id, label: id, configDirSuffix, exec, homeAble: true, hue: 'cyan', telemetry: 'anthropic' });
  /** The command each taught spelling admits, in allowedToolSpellings' order, spelled here independently. */
  const t9Commands = (home: string): string[] => [
    `${home}/.local/bin/ccrc history status --json`,
    '"$HOME/.local/bin/ccrc" history status --json',
    '~/.local/bin/ccrc history status --json',
  ];
  /** A fixture HOME: up-a (upstream, Task 5's recording stub) and ext-n (external, refused), and up-a's limits row
   *  fresh at `pct` percent. --out is a sibling of HOME, not yet created. */
  function t9Box(prefix: string, pct = 10): { home: string; out: string } {
    const base = mkTmp(prefix);
    const home = t9Path.join(base, 'home');
    t9Fs.mkdirSync(home, { mode: 0o700 });
    writeRoster(home, [t9Account('up-a', '.claude', { kind: 'upstream' }), t9Account('ext-n', '.ext-n', { kind: 'external' })]);
    plantStub(home, 'up-a');
    const now = Math.floor(Date.now() / 1000);
    t9Fs.mkdirSync(t9Path.join(home, '.cc-limits'), { recursive: true });
    t9Fs.writeFileSync(t9Path.join(home, '.cc-limits', 'up-a.json'),
      JSON.stringify({ five: pct, seven: pct, ts: now, fiveResetAt: now + 3600, sevenResetAt: now + 86_400 }));
    return { home, out: t9Path.join(base, 'out') };
  }
  const t9Args = (out: string, account = 'up-a'): string[] =>
    ['probe', '--out', out, '--account', account, '--budget', '1000000', '--arm-model', T9_MODEL];

  it('three box-mode spawns, one per taught spelling, and a denial for one spelling is recorded for that one only; exit 0', () => {
    const { home, out } = t9Box('ccrc-replay-t9-probe-');
    const cmds = t9Commands(home);
    t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({
      sessionId: 'sess-probe', assistants: 4,
      result: { numTurns: 4, denials: [{ tool_name: 'Bash', tool_use_id: 'tu-2', tool_input: { command: cmds[1] } }] },
      calls: [{ id: 'tu-1', command: cmds[0]!, isError: false }, { id: 'tu-2', command: cmds[1]!, isError: true }, { id: 'tu-3', command: cmds[2]!, isError: false }],
    }));
    const r = runDriver(home, t9Args(out));
    expect(r.code, r.stderr).toBe(0);

    const log = stubLog(home) as T9Entry[] | null;
    expect(log, 'the stub ran').not.toBeNull();
    expect(log!.length, 'one spawn per taught spelling').toBe(3);
    const boxArgv = t9Driver.spawnArgv({ mode: 'box', model: T9_MODEL, settingsMode: 'restricted', home });
    for (const e of log!) {
      expect(e.argv, 'box mode: the arm tools and the three spellings, no arm values').toEqual(boxArgv);
      expect(withoutDarwinAdded(e.envKeys).sort(), 'the box env: no CCRC_RECALL_*').toEqual(['CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']);
    }
    expect(cmds.map((c) => log!.filter((e) => e.stdin.includes(c)).length), 'each spelling reaches the stub once').toEqual([1, 1, 1]);

    const bytes = t9Fs.readFileSync(t9Path.join(out, 'probe.json'));
    // D-5983: the sha256 line is the one stderr line, as open and freeze print it; stdout stays empty.
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe(`sha256 ${t9CreateHash('sha256').update(bytes).digest('hex')}\n`);
    const doc = JSON.parse(bytes.toString('utf8'));
    expect(Object.keys(doc).sort()).toEqual(['account', 'budget', 'kind', 'measured_ms', 'model', 'settings_mode', 'spellings', 'spend', 'v']);
    expect(doc).toMatchObject({ kind: t9Driver.PROBE_KIND, v: 1, account: 'up-a', settings_mode: 'restricted', model: T9_MODEL, budget: 1_000_000 });
    expect(doc.spend, 'the ledger under --out counts the three runs').toBe(3 * 5);
    expect(doc.spellings).toEqual([
      { spelling: t9Driver.allowedToolSpellings(home)[0], denied: false, tool_error: false, ran: true, result_seen: true },
      { spelling: t9Driver.allowedToolSpellings(home)[1], denied: true, tool_error: true, ran: true, result_seen: true },
      { spelling: t9Driver.allowedToolSpellings(home)[2], denied: false, tool_error: false, ran: true, result_seen: true },
    ]);
    expect(t9Fs.readdirSync(t9Path.join(out, 'probe')).sort(), 'the streams live under out/probe').toEqual([
      'spelling-1.jsonl', 'spelling-1.run.json', 'spelling-2.jsonl', 'spelling-2.run.json', 'spelling-3.jsonl', 'spelling-3.run.json',
    ]);
    // This PR's whole subcommand set, in registration order (Task 1's grammar cases use an unregistered name).
    expect([...t9Driver.HANDLERS.keys()]).toEqual(['step0a', 'probe']);
  });

  // D-5983: the sha256 line is on stderr (as open and freeze print it), exactly one line, and stdout is empty.
  it('on success the sha256 line is the whole of stderr and stdout is empty, the hex being the sha256 of probe json', () => {
    const { home, out } = t9Box('ccrc-replay-t9-shastream-');
    t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({ sessionId: 'sess-probe', assistants: 1, result: { numTurns: 1 } }));
    const r = runDriver(home, t9Args(out));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
    const m = /^sha256 ([0-9a-f]{64})\n$/.exec(r.stderr);
    expect(m, r.stderr).not.toBeNull();
    expect(m![1]).toBe(t9CreateHash('sha256').update(t9Fs.readFileSync(t9Path.join(out, 'probe.json'))).digest('hex'));
  });

  it('a stream with no result event records ran but result_seen false, so its denied false measured nothing', () => {
    const { home, out } = t9Box('ccrc-replay-t9-noresult-');
    const cmds = t9Commands(home);
    t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({
      sessionId: 'sess-probe', assistants: 1, result: null, calls: [{ id: 'tu-1', command: cmds[0]!, isError: false }],
    }));
    const r = runDriver(home, t9Args(out));
    expect(r.code, r.stderr).toBe(0);
    const doc = JSON.parse(t9Fs.readFileSync(t9Path.join(out, 'probe.json'), 'utf8'));
    expect(doc.spellings.map((s: { ran: boolean; denied: boolean; tool_error: boolean | null; result_seen: boolean }) => [s.ran, s.denied, s.tool_error, s.result_seen]))
      .toEqual([[true, false, false, false], [false, false, null, false], [false, false, null, false]]);
  });

  // D-5810: a result event with no permission_denials array measured nothing about denial, so result_seen is false for it.
  it('a result event carrying no permission_denials array records result_seen false', () => {
    const { home, out } = t9Box('ccrc-replay-t9-nodenials-');
    const cmds = t9Commands(home);
    const stream = t9Stream({
      sessionId: 'sess-probe', assistants: 1, result: { numTurns: 1 }, calls: [{ id: 'tu-1', command: cmds[0]!, isError: false }],
    });
    const stripped = stream.replace(',"permission_denials":[]', '');
    expect(stripped, 'CONTROL: the result line lost its permission_denials key').not.toBe(stream);
    expect(stripped).not.toContain('permission_denials');
    t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), stripped);
    const r = runDriver(home, t9Args(out));
    expect(r.code, r.stderr).toBe(0);
    const doc = JSON.parse(t9Fs.readFileSync(t9Path.join(out, 'probe.json'), 'utf8'));
    expect(doc.spellings.map((s: { ran: boolean; denied: boolean; result_seen: boolean }) => [s.ran, s.denied, s.result_seen]))
      .toEqual([[true, false, false], [false, false, false], [false, false, false]]);
  });

  // D-5813: operator inputs the probe refuses with a driver word, and one HOME spelling shared by argv and prompt.
  it('a malformed --arm-model, a ":" in HOME or in --out, and an absent or non-executable launcher are driver refusals before any spawn', () => {
    const rows: Array<{ name: string; line: string; env?: Record<string, string>; args?: (out: string) => string[]; prep?: (home: string) => void }> = [
      { name: 'space in model', args: (out) => t9Args(out).map((a) => (a === T9_MODEL ? 'fx arm' : a)), line: 'ccrc history-replay: args-invalid: arm-model "fx arm" is not a model id\n' },
      { name: 'leading dash model', args: (out) => t9Args(out).map((a) => (a === T9_MODEL ? '-x' : a)), line: 'ccrc history-replay: args-invalid: arm-model "-x" is not a model id\n' },
      { name: 'colon in HOME', env: { HOME: '/fixture/home:x' }, line: "ccrc history-replay: args-invalid: HOME contains ':'\n" },
      { name: 'colon in out', args: (out) => t9Args(`${out}:x`), line: "ccrc history-replay: args-invalid: out contains ':'\n" },
      { name: 'absent launcher', prep: (home) => t9Fs.rmSync(t9Path.join(home, '.local', 'bin', 'up-a')), line: 'ccrc history-replay: account-refused: launcher-ENOENT\n' },
      ...(process.getuid?.() === 0 ? [] : [{ name: 'non-executable launcher', prep: (home: string) => t9Fs.chmodSync(t9Path.join(home, '.local', 'bin', 'up-a'), 0o644), line: 'ccrc history-replay: account-refused: launcher-EACCES\n' }]),
    ];
    for (const c of rows) {
      const { home, out } = t9Box(`ccrc-replay-t9-input-${c.name.replace(/[^a-z]/g, '-')}-`);
      c.prep?.(home);
      const r = runDriver(home, (c.args ?? t9Args)(out), c.env);
      expect(r.code, `${c.name}: ${r.stderr}`).toBe(2);
      expect(r.stderr, c.name).toBe(c.line);
      expect(stubLog(home), `${c.name}: nothing was spawned`).toBeNull();
      expect(t9Fs.existsSync(t9Path.join(out, 'probe')), `${c.name}: no stream file`).toBe(false);
      expect(t9Fs.existsSync(t9Path.join(out, 'probe.json')), c.name).toBe(false);
      if (!c.name.includes('colon in out')) continue;
      expect(t9Fs.existsSync(`${out}:x`), 'the colon --out was not made').toBe(false);
    }
  });

  it('a HOME with a trailing slash gives the probe one spelling: the first taught spelling in the argv is the one its prompt asks for', () => {
    const { home, out } = t9Box('ccrc-replay-t9-trailing-');
    t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({ sessionId: 'sess-probe', assistants: 1, result: { numTurns: 1 } }));
    const r = runDriver(home, t9Args(out), { HOME: `${home}/` });
    expect(r.code, r.stderr).toBe(0);
    const log = stubLog(home) as T9Entry[];
    expect(log).toHaveLength(3);
    const first = `${home}/.local/bin/ccrc history status --json`;
    for (const e of log) {
      expect(e.argv).toContain(`Bash(${home}/.local/bin/ccrc history:*)`);
      expect(e.stdin).not.toContain(`${home}//`);
    }
    expect(log.filter((e) => e.stdin.includes(first)), 'the prompt asks for the spelling the argv carries').toHaveLength(1);
    const doc = JSON.parse(t9Fs.readFileSync(t9Path.join(out, 'probe.json'), 'utf8'));
    expect(doc.spellings[0].spelling).toBe(`Bash(${home}/.local/bin/ccrc history:*)`);
  });

  it('refused before any spawn: an external account, a missing budget, a flag the probe never reads, a limits row at the threshold', () => {
    // D-5810: the last five rows pin each PROBE_REQUIRED entry, the SETTINGS_MODES refusal and the probe's own HOME refusal,
    // each of which reds when its line is deleted; `env` is runDriver's extraEnv.
    const cases: Array<{ name: string; pct?: number; args: (out: string) => string[]; line: string; env?: Record<string, string> }> = [
      { name: 'external', args: (out) => t9Args(out, 'ext-n'), line: 'ccrc history-replay: account-refused: ' },
      { name: 'no budget', args: (out) => t9Args(out).filter((_, i, a) => a[i] !== '--budget' && a[i - 1] !== '--budget'), line: 'ccrc history-replay: args-invalid: budget-required\n' },
      { name: 'writer flag', args: (out) => [...t9Args(out), '--writer-model', 'fixture-model-writer'], line: 'ccrc history-replay: args-invalid: --writer-model is not a probe flag\n' },
      { name: 'threshold', pct: 70, args: (out) => t9Args(out), line: 'ccrc history-replay: limits-threshold: ' },
      { name: 'no arm model', args: (out) => t9Args(out).filter((_, i, a) => a[i] !== '--arm-model' && a[i - 1] !== '--arm-model'), line: 'ccrc history-replay: args-invalid: arm-model-required\n' },
      { name: 'no out', args: (out) => t9Args(out).filter((_, i, a) => a[i] !== '--out' && a[i - 1] !== '--out'), line: 'ccrc history-replay: args-invalid: out-required\n' },
      { name: 'no account', args: (out) => t9Args(out).filter((_, i, a) => a[i] !== '--account' && a[i - 1] !== '--account'), line: 'ccrc history-replay: args-invalid: account-required\n' },
      { name: 'bogus settings mode', args: (out) => [...t9Args(out), '--settings-mode', 'bogus'], line: 'ccrc history-replay: args-invalid: settings-mode bogus\n' },
      { name: 'empty HOME', args: (out) => t9Args(out), env: { HOME: '' }, line: 'ccrc history-replay: args-invalid: HOME is unset or not absolute\n' },
    ];
    for (const c of cases) {
      const { home, out } = t9Box(`ccrc-replay-t9-refuse-${c.name.replace(/ /g, '-')}-`, c.pct);
      t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({ sessionId: 'sess-probe', assistants: 1, result: { numTurns: 1 } }));
      const r = runDriver(home, c.args(out), c.env);
      expect(r.code, `${c.name}: ${r.stderr}`).toBe(2);
      expect(r.stderr.startsWith(c.line), `${c.name}: ${r.stderr}`).toBe(true);
      expect(stubLog(home), `${c.name}: nothing was spawned`).toBeNull();
      expect(t9Fs.existsSync(t9Path.join(out, 'probe.json')), c.name).toBe(false);
      expect(t9Fs.existsSync(t9Path.join(out, 'probe')), `${c.name}: no stream file`).toBe(false);
    }
  });
});

describe('W2-4 Task 9: the probe checks every required flag before --out is made (D-5815)', () => {
  // The probe's own fixture box is built inline, as Task 9's t9Box does: up-a (a recording stub) and ext-n (external, refused).
  function box(prefix: string): { home: string; out: string } {
    const base = mkTmp(prefix);
    const home = path.join(base, 'home');
    mkdirSync(home, { mode: 0o700 });
    const acct = (id: string, suffix: string, exec: Record<string, unknown>) =>
      ({ id, label: id, configDirSuffix: suffix, exec, homeAble: true, hue: 'cyan', telemetry: 'anthropic' });
    writeRoster(home, [acct('up-a', '.claude', { kind: 'upstream' }), acct('ext-n', '.ext-n', { kind: 'external' })]);
    plantStub(home, 'up-a');
    const now = Math.floor(Date.now() / 1000);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    writeFileSync(path.join(home, '.cc-limits', 'up-a.json'),
      JSON.stringify({ five: 10, seven: 10, ts: now, fiveResetAt: now + 3600, sevenResetAt: now + 86_400 }));   // fresh, so only the ':' check can stop it
    return { home, out: path.join(base, 'out') };
  }
  const argvOf = (out: string, account: string, drop: string | null): string[] => {
    const base: Array<[string, string]> = [['out', out], ['account', account], ['budget', '1000000'], ['arm-model', 'fixture-model-arm']];
    return ['probe', ...base.filter(([k]) => k !== drop).flatMap(([k, v]) => [`--${k}`, v])];
  };
  it.each(['out', 'account', 'budget', 'arm-model'])('a missing --%s alone is args-invalid, with no --out made and no spawn', (flag) => {
    const { home, out } = box('ccrc-replay-t9-req-');
    const r = runDriver(home, argvOf(out, 'up-a', flag));
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toBe(`ccrc history-replay: args-invalid: ${flag}-required\n`);
    expect(existsSync(out), `a missing --${flag} left --out behind`).toBe(false);
    expect(stubLog(home)).toBeNull();
  });
  describe("the realpath ':' check (D-5813)", () => {
    // D-5813: as step0a, the ':' check also runs on prepareOut's realpath (an ancestor symlink to a path holding ':').
    // Without the check the TypeError (exit 1) is thrown in launchRun, before its spawn; the exit code tells the mutant
    // from the guard.
    it("an --out under an ancestor symlink to a path holding ':' is refused args-invalid before any spawn", () => {
      const { home } = box('ccrc-replay-t9-colonlink-');
      const base = mkTmp('ccrc-replay-t9-colonlink-base-');
      mkdirSync(path.join(base, 'a:b'));
      symlinkSync(path.join(base, 'a:b'), path.join(base, 'link'));
      const r = runDriver(home, argvOf(path.join(base, 'link', 'out'), 'up-a', null));
      expect(r.code, r.stderr).toBe(2);
      expect(r.stderr).toBe("ccrc history-replay: args-invalid: out contains ':'\n");
      expect(stubLog(home)).toBeNull();
    });
  });
  it('a missing --budget with an unadmissible account answers budget-required, not account-refused, and makes no --out', () => {
    const { home, out } = box('ccrc-replay-t9-reqfirst-');
    const r = runDriver(home, argvOf(out, 'ext-n', 'budget'));
    expect(r.code, r.stderr).toBe(2);
    expect(r.stderr).toBe('ccrc history-replay: args-invalid: budget-required\n');
    expect(existsSync(out)).toBe(false);
    expect(stubLog(home)).toBeNull();
  });
});

describe('W2-4 Task 9: step 0b mechanics without the seam, W2-D57', () => {
  const T9_MODEL_0B = 'fixture-model-arm';
  const t9Facts = (o: Parameters<typeof t9Stream>[0]) => t9Driver.readStreamJson(t9Stream(o));
  const T9_ALLOWED = '~/.local/bin/ccrc history status --json';
  const T9_STOP = 'error_max_turns';

  it('the turn probe prompt asks for twenty separate Bash calls of an allowed spelling, MAX_TURNS is 12, and the stop it reads is error_max_turns', () => {
    expect(t9Driver.MAX_TURNS).toBe(12);
    expect(t9Driver.TURN_PROBE_PROMPT).toContain('twenty separate Bash tool calls');
    expect(t9Driver.TURN_PROBE_PROMPT).toContain(`exactly the command \`${T9_ALLOWED}\``);
    expect(t9Driver.allowedToolSpellings('/h')[2], 'CONTROL: the third taught spelling admits that command').toBe('Bash(~/.local/bin/ccrc history:*)');
    expect(t9Driver.MAX_TURNS_STOP_SUBTYPE).toBe(T9_STOP);
  });

  it('the bound holds only when the result event shows the max-turns stop within 12 assistant turns; 13 turns does not hold', () => {
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 12, result: { numTurns: 12, subtype: T9_STOP } })))
      .toEqual({ held: true, turns: 12, num_turns: 12, subtype: T9_STOP });
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 13, result: { numTurns: 13, subtype: T9_STOP } })))
      .toEqual({ held: false, turns: 13, num_turns: 13, subtype: T9_STOP });
  });

  // D-5810: a maxTurns that is no positive integer throws; compared with `>` it would read a bound that never trips as held.
  it('turnBoundHeld refuses a maxTurns that is not a positive integer', () => {
    const facts = t9Facts({ sessionId: 's', assistants: 12, result: { numTurns: 12, subtype: T9_STOP } });
    for (const maxTurns of [0, -1, 1.5, Number.NaN, 'x' as never, null as never]) {
      expect(() => t9Driver.turnBoundHeld(facts, maxTurns), `maxTurns ${String(maxTurns)}`).toThrow(TypeError);
    }
    expect(t9Driver.turnBoundHeld(facts, 12), 'CONTROL: 12 is accepted').toEqual({ held: true, turns: 12, num_turns: 12, subtype: T9_STOP });
  });

  it('a run that ended for any other reason within the bound is unmeasured, never held', () => {
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 12, result: { numTurns: 12 } })))
      .toEqual({ held: 'unmeasured', turns: 12, num_turns: 12, subtype: 'success' });
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 3, result: { numTurns: 3, subtype: 'error_during_execution' } })))
      .toEqual({ held: 'unmeasured', turns: 3, num_turns: 3, subtype: 'error_during_execution' });
  });

  it('no result event is unmeasured within the bound and false past it, its subtype and num_turns null', () => {
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 5, result: null })))
      .toEqual({ held: 'unmeasured', turns: 5, num_turns: null, subtype: null });
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 13, result: null })))
      .toEqual({ held: false, turns: 13, num_turns: null, subtype: null });
  });

  it('a max-turns result without num_turns still holds: num_turns is recorded, the assistant turn count decides', () => {
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 12, result: { numTurns: null, subtype: T9_STOP } })))
      .toEqual({ held: true, turns: 12, num_turns: null, subtype: T9_STOP });
  });

  it('num_turns within the bound beside more assistant messages than the bound does not hold', () => {
    expect(t9Driver.turnBoundHeld(t9Facts({ sessionId: 's', assistants: 14, result: { numTurns: 12, subtype: T9_STOP } })))
      .toEqual({ held: false, turns: 14, num_turns: 12, subtype: T9_STOP });
  });

  it('the project slug replaces every non-alphanumeric character with a dash', () => {
    expect(t9Driver.projectSlugOf('/tmp/ccrc-history-replay-Ab9_x.y')).toBe('-tmp-ccrc-history-replay-Ab9-x-y');
    expect(() => t9Driver.projectSlugOf('relative/dir')).toThrow(TypeError);
  });

  it('persistenceLeft over a config dir: nothing under projects is nothing left', () => {
    const configDir = t9Path.join(mkTmp('ccrc-replay-t9-pl-none-'), '.claude');
    expect(t9Driver.persistenceLeft({ configDir, sessionId: 'sess-a', cwd: '/tmp/run-a' })).toEqual({ left: false, transcripts: [], projectDir: false });
    t9Fs.mkdirSync(t9Path.join(configDir, 'projects', '-tmp-other'), { recursive: true });
    t9Fs.writeFileSync(t9Path.join(configDir, 'projects', '-tmp-other', 'sess-b.jsonl'), '{}\n');
    expect(t9Driver.persistenceLeft({ configDir, sessionId: 'sess-a', cwd: '/tmp/run-a' }), 'another session under another project is not this run')
      .toEqual({ left: false, transcripts: [], projectDir: false });
  });

  it('persistenceLeft: a transcript named by the session id under another project dir is caught by the session id half alone', () => {
    const configDir = t9Path.join(mkTmp('ccrc-replay-t9-pl-sid-'), '.claude');
    t9Fs.mkdirSync(t9Path.join(configDir, 'projects', '-tmp-elsewhere'), { recursive: true });
    t9Fs.writeFileSync(t9Path.join(configDir, 'projects', '-tmp-elsewhere', 'sess-a.jsonl'), '{}\n');
    expect(t9Driver.persistenceLeft({ configDir, sessionId: 'sess-a', cwd: '/tmp/run-a' }))
      .toEqual({ left: true, transcripts: ['-tmp-elsewhere/sess-a.jsonl'], projectDir: false });
  });

  it('persistenceLeft: a project dir keyed by the run cwd is caught by the slug half alone', () => {
    const configDir = t9Path.join(mkTmp('ccrc-replay-t9-pl-slug-'), '.claude');
    t9Fs.mkdirSync(t9Path.join(configDir, 'projects', '-tmp-run-a'), { recursive: true });
    expect(t9Driver.persistenceLeft({ configDir, sessionId: 'sess-a', cwd: '/tmp/run-a' })).toEqual({ left: true, transcripts: [], projectDir: true });
  });

  // D-5810: a non-ENOENT failure on the projects directory is thrown, never answered as clean. Mode 000 is the named
  // case; it trips the lstat of the cwd slug first, so the two other modes isolate each rethrow: 0o400 lets the listing
  // succeed but refuses the lstat (search denied), and 0o100 lets the lstat answer ENOENT but refuses the listing.
  // The skip is for root, for whom a mode does not refuse a read.
  it.skipIf(process.getuid?.() === 0)('persistenceLeft: an unreadable projects directory throws, never reads as clean', () => {
    for (const mode of [0o000, 0o400, 0o100]) {
      const configDir = t9Path.join(mkTmp(`ccrc-replay-t9-pl-eacces-${mode.toString(8)}-`), '.claude');
      const projects = t9Path.join(configDir, 'projects');
      t9Fs.mkdirSync(projects, { recursive: true });
      t9Fs.chmodSync(projects, mode);
      try {
        expect(() => t9Driver.persistenceLeft({ configDir, sessionId: 'sess-a', cwd: '/tmp/run-a' }), `mode ${mode.toString(8)}`).toThrow(/EACCES/);
      } finally {
        t9Fs.chmodSync(projects, 0o700);
      }
    }
  });

  // D-5810: the input guards refuse a shape rather than reading it as clean or held.
  it('persistenceLeft: a relative configDir and a sessionId that is no session id throw TypeError', () => {
    const configDir = t9Path.join(mkTmp('ccrc-replay-t9-pl-input-'), '.claude');
    expect(() => t9Driver.persistenceLeft({ configDir: 'rel/.claude', sessionId: 'sess-a', cwd: '/tmp/run-a' }), 'relative configDir').toThrow(TypeError);
    expect(() => t9Driver.persistenceLeft({ configDir: undefined as never, sessionId: 'sess-a', cwd: '/tmp/run-a' }), 'configDir not a string').toThrow(TypeError);
    // D-5814: the message is asserted, so the `typeof` half of the guard has its own mutant: without it a number or
    // undefined throws a runtime TypeError of another text, and a String object passes as a clean verdict.
    for (const sessionId of ['', 'a/b', '.hidden', 42 as never, undefined as never, ['x'] as never, new String('x') as never]) {
      expect(() => t9Driver.persistenceLeft({ configDir, sessionId, cwd: '/tmp/run-a' }), `sessionId ${JSON.stringify(sessionId)}`).toThrow(/is not a session id/);
    }
    expect(t9Driver.persistenceLeft({ configDir, sessionId: 'sess-a', cwd: '/tmp/run-a' }), 'CONTROL: a plain id on an absolute configDir answers').toEqual({ left: false, transcripts: [], projectDir: false });
  });

  it('persistenceLeft: a null session id never reads as clean', () => {
    const configDir = t9Path.join(mkTmp('ccrc-replay-t9-pl-null-'), '.claude');
    expect(t9Driver.persistenceLeft({ configDir, sessionId: null, cwd: '/tmp/run-a' })).toEqual({ left: true, transcripts: [], projectDir: false });
  });

  it('step0bMechanics on the stub: a stub that writes its transcript is caught by both halves', async () => {
    const base = mkTmp('ccrc-replay-t9-0b-left-');
    const home = t9Path.join(base, 'home');
    t9Fs.mkdirSync(home, { mode: 0o700 });
    t9PlantPersistingStub(home, 'up-a');
    t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({ sessionId: 'sess-left', assistants: 13, result: { numTurns: 13 } }));
    const out = t9Driver.prepareOut(t9Path.join(base, 'out'));
    const got = await t9Driver.step0bMechanics({ launch: t9Launch(home), out, model: T9_MODEL_0B, settingsMode: 'restricted', lang: undefined, gate: () => {}, claim: claimFor(out) });
    const projects = t9Fs.readdirSync(t9Path.join(home, '.claude', 'projects'));
    expect(projects.length, 'CONTROL: the stub wrote one project dir').toBe(1);
    expect(got).toEqual({
      turn_bound: { held: false, turns: 13, num_turns: 13, subtype: 'success' },
      persistence: { left: true, transcripts: [`${projects[0]}/sess-left.jsonl`], project_dir: true },
    });
    expect(t9Fs.existsSync(t9Path.join(out, 'step0b', 'turn-bound.run.json')), 'one box-mode run named step0b/turn-bound').toBe(true);
  });

  it('step0bMechanics on the stub: a clean run leaves nothing, and a run that ended without the max-turns stop is unmeasured, never held', async () => {
    const base = mkTmp('ccrc-replay-t9-0b-clean-');
    const home = t9Path.join(base, 'home');
    t9Fs.mkdirSync(home, { mode: 0o700 });
    plantStub(home, 'up-a');
    t9Fs.writeFileSync(t9Path.join(home, STUB_STREAM), t9Stream({ sessionId: 'sess-clean', assistants: 12, result: { numTurns: 12 } }));
    const out = t9Driver.prepareOut(t9Path.join(base, 'out'));
    await expect(t9Driver.step0bMechanics({ launch: t9Launch(home), out, model: T9_MODEL_0B, settingsMode: 'restricted', lang: undefined, claim: claimFor(out) } as never),
      'no gate: a TypeError before any spawn (the stub log below still counts one run)').rejects.toThrow(/opts\.gate is required/);
    const got = await t9Driver.step0bMechanics({ launch: t9Launch(home), out, model: T9_MODEL_0B, settingsMode: 'restricted', lang: undefined, gate: () => {}, claim: claimFor(out) });
    expect(got).toEqual({ turn_bound: { held: 'unmeasured', turns: 12, num_turns: 12, subtype: 'success' }, persistence: { left: false, transcripts: [], project_dir: false } });
    const log = stubLog(home) as Array<{ argv: string[]; stdin: string }> | null;
    expect(log?.length).toBe(1);
    expect(log![0]!.argv).toEqual(t9Driver.spawnArgv({ mode: 'box', model: T9_MODEL_0B, settingsMode: 'restricted', home }));
    expect(log![0]!.stdin).toBe(t9Driver.TURN_PROBE_PROMPT);
  });
});

// ── fix round 2 (D-5984): the driver yields to signals before every spawn, and every stop check is pinned or removed ──────
// A Node signal handler runs only when the loop reaches its poll phase. These cases run main in-process, hold a no-op
// SIGTERM listener (without one the vitest fork dies), and send this process a real SIGTERM where the point is the
// yield, or call main's installed listener directly where the point is the check after it. An in-process stop leaves
// the driver's flag set until the next main entry, and its unref'd SIGKILL timer fires STOP_GRACE_MS later over
// whatever the registry holds then: endStop resets the flag through one more main call and waits the grace out, so
// nothing spawns inside it.
describe('fix round 2 (D-5984): signals are yielded to before every spawn, and every stop check is pinned or removed', () => {
  const STOP_GRACE_MS = 5_000;   // the driver's own, module-private
  const hold = (): void => {};
  const probeArgs = (out: string): string[] => ['probe', '--out', out, '--account', 'up-a', '--budget', '1000000', '--arm-model', 'fixture-model-arm'];
  const LEFTOVER = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'x', permission_denials: [],
    usage: { input_tokens: 3, cache_creation_input_tokens: 4, cache_read_input_tokens: 5, output_tokens: 6 } }) + '\n';

  /** A fixture HOME for a probe run by main: up-a (the recording stub), a fresh limits row, an --out that is not made yet. */
  function probeBox(prefix: string): { home: string; out: string } {
    const base = mkTmp(prefix);
    const home = join(base, 'home');
    mkdirSync(home, { mode: 0o700 });
    writeRoster(home, [{ id: 'up-a', label: 'up-a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' }]);
    plantStub(home, 'up-a');
    const now = Math.floor(Date.now() / 1000);
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(join(home, '.cc-limits', 'up-a.json'), JSON.stringify({ five: 10, seven: 10, ts: now, fiveResetAt: now + 3600, sevenResetAt: now + 86_400 }));
    return { home, out: join(base, 'out') };
  }
  const spendNames = (out: string): string[] => {
    const p = join(out, replay.SPEND_LEDGER);
    return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l).name) : [];
  };
  /** Run `fn` with a no-op SIGTERM listener held, and main's stderr captured; answers what stderr got. */
  async function holdingTerm(fn: () => Promise<void>): Promise<string> {
    let err = '';
    const quiet = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => { err += String(c); return true; });
    const umask = process.umask(0o022);
    process.umask(umask);
    process.on('SIGTERM', hold);
    try { await fn(); } finally { process.off('SIGTERM', hold); quiet.mockRestore(); process.umask(umask); }
    return err;
  }
  /** Reset the stopping flag with one more main call (a no-op handler), then wait out the SIGKILL timer a stop armed. */
  async function endStop(): Promise<void> {
    const umask = process.umask(0o022);
    process.umask(umask);
    replay.HANDLERS.set('fr2-reset', async () => 0);
    try { await replay.main(['fr2-reset'], {}); } finally { replay.HANDLERS.delete('fr2-reset'); process.umask(umask); }
    await pause(STOP_GRACE_MS + 400);
  }
  /** Run `fn` as a subcommand of main, so main's SIGINT, SIGTERM and SIGHUP listeners are installed while it runs. */
  async function underMain(fn: () => Promise<void>): Promise<void> {
    let failure: unknown = null;
    replay.HANDLERS.set('fr2-fixture', async () => { try { await fn(); } catch (e) { failure = e; } return 0; });
    const umask = process.umask(0o022);
    process.umask(umask);
    try { await replay.main(['fr2-fixture'], {}); } finally { replay.HANDLERS.delete('fr2-fixture'); process.umask(umask); }
    if (failure !== null) throw failure;
  }
  /** main's own SIGTERM listener, called as the signal would: the stopping flag is set at once, with no loop turn. */
  const raiseStop = (): void => { (process.listeners('SIGTERM').at(-1) as () => void)(); };
  const noProbeResult = (out: string): void => {
    expect(existsSync(join(out, 'probe.json')), 'no probe.json').toBe(false);
  };

  it('a SIGTERM pending across main\'s whole stretch, claimOut\'s walk included, is handled at the first yield: exit 2 interrupted, no spawn, no spawn charge, no probe.json', async () => {
    const { home, out } = probeBox('ccrc-replay-fr2-pending-');
    replay.prepareOut(out);
    writeFileSync(join(out, 'old-run.jsonl.part'), LEFTOVER);   // a leftover with no record: claimOut charges and removes it before any yield
    let code = -1;
    let err = '';
    try {
      err = await holdingTerm(async () => {
        process.kill(process.pid, 'SIGTERM');
        code = await replay.main(probeArgs(out), { HOME: home });
      });
    } finally { await endStop(); }
    expect(code, err).toBe(EXIT.REFUSED);
    expect(err).toMatch(/^ccrc history-replay: interrupted: SIGTERM received; [^\n]*\n$/);
    expect(stubLog(home), 'no probe spawn').toBeNull();
    expect(spendNames(out), 'only the leftover was charged: no spawn charge').toEqual(['old-run']);
    expect(existsSync(join(out, 'old-run.jsonl.part')), 'CONTROL: claimOut did walk').toBe(false);
    noProbeResult(out);
    expect(existsSync(join(out, 'probe')) ? readdirSync(join(out, 'probe')) : [], 'no run under probe').toEqual([]);
  }, 60_000);

  it('a signal that arrives in a job\'s post-close stretch is handled by the yield before the next job: that job never spawns, and the first one is recorded', async () => {
    const b = t5Box('ccrc-replay-fr2-yield-');
    let gates = 0;
    let sent = false;
    const armed = { ...b.up, get accountId(): string {
      // launchRun reads launch.accountId when it builds run.json, after the child's close and the rename.
      if (!sent && existsSync(join(b.out, 'y-0.jsonl'))) { sent = true; process.kill(process.pid, 'SIGTERM'); }
      return 'up-a';
    } } as T5Launch;
    const jobs = [t5job(b, armed, 'box', 'y-0'), t5job(b, b.up, 'box', 'y-1')];
    try {
      await holdingTerm(async () => {
        await underMain(async () => {
          await expect(claimedBatch(jobs, { concurrency: 1, gate: () => { gates += 1; } })).rejects.toMatchObject({ word: 'interrupted' });
        });
      });
    } finally { await endStop(); }
    expect(sent, 'CONTROL: the signal was sent in the first job\'s post-close stretch').toBe(true);
    expect(gates, 'the second job never reached the gate').toBe(1);
    expect(stubLog(b.home), 'one spawn only').toHaveLength(1);
    expect(existsSync(join(b.out, 'y-0.run.json')), 'the first job is recorded').toBe(true);
    expect(readdirSync(b.out).filter((n) => n.startsWith('y-1')), 'nothing of the second job').toEqual([]);
  }, 60_000);

  it('the batch\'s last check: a signal pending after the LAST job refuses interrupted, because that lane\'s final iteration takes no job and checks nothing itself', async () => {
    const b = t5Box('ccrc-replay-fr2-last-');
    let sent = false;
    const armed = { ...b.up, get accountId(): string {
      if (!sent && existsSync(join(b.out, 'l-0.jsonl'))) { sent = true; process.kill(process.pid, 'SIGTERM'); }
      return 'up-a';
    } } as T5Launch;
    try {
      await holdingTerm(async () => {
        await underMain(async () => {
          await expect(claimedBatch([t5job(b, armed, 'box', 'l-0')], { concurrency: 1, gate: T5_NO_GATE })).rejects.toMatchObject({ word: 'interrupted' });
        });
      });
    } finally { await endStop(); }
    expect(sent, 'CONTROL: the signal was sent in the last job\'s post-close stretch').toBe(true);
    expect(existsSync(join(b.out, 'l-0.run.json')), 'the job itself was recorded').toBe(true);
  }, 60_000);

  it('the lane check: with the stop set, runBatch refuses interrupted before its gate, and nothing spawns', async () => {
    const b = t5Box('ccrc-replay-fr2-lane-');
    let gates = 0;
    try {
      await holdingTerm(async () => {
        await underMain(async () => {
          raiseStop();
          await expect(claimedBatch([t5job(b, b.up, 'box', 'k-0'), t5job(b, b.up, 'box', 'k-1')], { gate: () => { gates += 1; } })).rejects.toMatchObject({ word: 'interrupted' });
        });
      });
    } finally { await endStop(); }
    expect(gates, 'the gate was never called').toBe(0);
    expect(stubLog(b.home)).toBeNull();
  }, 60_000);

  it('a fully resumed probe with a SIGTERM pending refuses interrupted and writes no probe.json (the lane check or the batch\'s last check)', async () => {
    const { home, out } = probeBox('ccrc-replay-fr2-resumed-');
    const first = runDriver(home, probeArgs(out));
    expect(first.code, first.stderr).toBe(0);
    expect(stubLog(home), 'CONTROL: the first run spawned the three spellings').toHaveLength(3);
    rmSync(join(out, 'probe.json'));
    let code = -1;
    let err = '';
    try {
      err = await holdingTerm(async () => {
        process.kill(process.pid, 'SIGTERM');
        code = await replay.main(probeArgs(out), { HOME: home });
      });
    } finally { await endStop(); }
    expect(code, err).toBe(EXIT.REFUSED);
    expect(err).toMatch(/^ccrc history-replay: interrupted: SIGTERM received; [^\n]*\n$/);
    expect(stubLog(home), 'nothing spawned again').toHaveLength(3);
    noProbeResult(out);
  }, 120_000);

  it('launchRun\'s pre-spawn check: with the stop set it refuses interrupted, the stub never runs, and no .part or .pid is made', async () => {
    const b = t5Box('ccrc-replay-fr2-launch-');
    try {
      await holdingTerm(async () => {
        await underMain(async () => {
          raiseStop();
          await expect(claimedRun(t5job(b, b.up, 'box', 'p-0'))).rejects.toMatchObject({ word: 'interrupted' });
        });
      });
    } finally { await endStop(); }
    expect(stubLog(b.home), 'the stub never ran').toBeNull();
    expect(readdirSync(b.out).filter((n) => n.startsWith('p-0')), 'no .part, .pid or stream').toEqual([]);
  }, 60_000);

  it('measureClaudeVersion\'s check: with the stop set it refuses interrupted and --version never spawns', async () => {
    const b = t5Box('ccrc-replay-fr2-version-');
    try {
      await holdingTerm(async () => {
        await underMain(async () => {
          raiseStop();
          await expect(replay.measureClaudeVersion(b.up, b.out, undefined)).rejects.toMatchObject({ word: 'interrupted' });
        });
      });
    } finally { await endStop(); }
    expect(stubLog(b.home), '--version never spawned').toBeNull();
  }, 60_000);

  it('measureClaudeVersion yields first: a SIGTERM pending when it is called is handled before its check, so --version never spawns', async () => {
    const b = t5Box('ccrc-replay-fr2-version-yield-');
    try {
      await holdingTerm(async () => {
        await underMain(async () => {
          process.kill(process.pid, 'SIGTERM');
          await expect(replay.measureClaudeVersion(b.up, b.out, undefined)).rejects.toMatchObject({ word: 'interrupted' });
        });
      });
    } finally { await endStop(); }
    expect(stubLog(b.home), '--version never spawned').toBeNull();
  }, 60_000);
});

// ── fix round 2 (D-5984): the wait after a leader's exit is bounded ─────────────────────────────────────────────────
// 'close' fires only when every stdio pipe has closed, so a process that outlives the leader and holds one would hold
// the run, the lock and every signal's answer. spawnGroup starts a STOP_GRACE_MS timer at the leader's 'exit'; 'close'
// clears it; when it fires it SIGKILLs the leader's group and destroys the streams. A grandchild that calls setsid is
// the one process the group kill cannot reach: it keeps running, and no longer holds the driver. Every stub here is a
// recording stub under a fixture HOME that starts only processes the case kills by their recorded pid, in a finally.
describe.skipIf(!existsSync('/usr/bin/setsid'))('fix round 2 (D-5984): the wait after a leader exits is bounded', () => {
  const STOP_GRACE_MS = 5_000;   // the driver's own, module-private
  const SLEEP_S = 12;            // the setsid grandchild outlives every bound below
  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  /** The pids a stub recorded, one per line; each is killed (alone and as a group) by a case's finally. */
  const recorded = (file: string): number[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map(Number) : []);
  const killAll = (pids: number[]): void => {
    for (const pid of pids) {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* gone, or never a group */ }
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
  };
  /** Node, run as a CommonJS launcher. `body` runs after `home`, `args` and the requires exist. */
  const stubSource = (body: string): string => `#!/usr/bin/env node
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const home = path.resolve(path.dirname(process.argv[1]), '..', '..');
const args = process.argv.slice(2);
const stream = () => fs.readFileSync(path.join(home, ${JSON.stringify(STUB_STREAM)}), 'utf8');
fs.appendFileSync(path.join(home, 'leaders.pids'), process.pid + '\\n');
${body}
`;
  /** setsid as the stub starts it: not detached, so setsid is no group leader and execs sleep in its own pid, which is
   *  recorded. Its stderr is the run's stderr pipe; its stdout and stdin are not. */
  const SETSID_GRANDCHILD = `const g = cp.spawn('/usr/bin/setsid', ['sleep', '${SLEEP_S}'], { stdio: ['ignore', 'ignore', 'inherit'] });
fs.appendFileSync(path.join(home, 'grandchildren.pids'), g.pid + '\\n');
g.unref();`;
  const pidsOf = (b: { home: string }): string => path.join(b.home, 'grandchildren.pids');
  /** Every pid a case's stubs recorded, leaders and grandchildren: what its finally kills. */
  const allOf = (home: string): number[] => [...recorded(join(home, 'leaders.pids')), ...recorded(join(home, 'grandchildren.pids'))];

  it('SIGTERM while a setsid grandchild holds the run\'s stderr: exit 2 interrupted well before the grandchild ends, which keeps running (the named residual)', async () => {
    const base = mkTmp('ccrc-replay-fr2-setsid-stop-');
    const home = join(base, 'home');
    mkdirSync(home, { mode: 0o700 });
    writeRoster(home, [{ id: 'up-a', label: 'up-a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' }]);
    plantStub(home, 'up-a');
    writeFileSync(join(home, '.local', 'bin', 'up-a'), stubSource(`fs.readFileSync(0);
${SETSID_GRANDCHILD}
process.stdout.write(stream());`), { mode: 0o700 });
    const now = Math.floor(Date.now() / 1000);
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(join(home, '.cc-limits', 'up-a.json'), JSON.stringify({ five: 10, seven: 10, ts: now, fiveResetAt: now + 3600, sevenResetAt: now + 86_400 }));
    const out = join(base, 'out');
    const driver = spawn(process.execPath, ['--no-warnings', SCRIPT, 'probe', '--out', out, '--account', 'up-a', '--budget', '1000000', '--arm-model', 'fixture-model-arm'],
      { env: { ...scrubbedEnv(process.env), HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    startedChildren.push(driver);
    let stderr = '';
    driver.stderr.on('data', (d) => { stderr += String(d); });
    const exited = new Promise<{ code: number | null; signal: string | null }>((r) => driver.once('close', (code, signal) => r({ code, signal })));
    const gcFile = join(home, 'grandchildren.pids');
    try {
      expect(await until(() => recorded(gcFile).length >= 1, 60_000), 'a stub started and recorded its setsid grandchild').toBe(true);
      const started = Date.now();
      await pause(2_000);
      driver.kill('SIGTERM');
      const r = await bounded(exited, 30_000, 'the driver exiting after the signal');
      const answered = Date.now() - started;
      expect(r, stderr).toEqual({ code: 2, signal: null });
      expect(stderr).toMatch(/^ccrc history-replay: interrupted: SIGTERM received; [^\n]*\n$/);
      expect(answered, `answered at ${answered} ms, not when the ${SLEEP_S} s grandchild ended`).toBeLessThan(9_000);
      expect(recorded(gcFile).some(alive), 'the setsid grandchild escaped the group kill and is still running: the residual, no longer holding the driver').toBe(true);
    } finally {
      killAll(allOf(home));
      driver.kill('SIGKILL');
    }
  }, 120_000);

  it('the bound\'s timer is cleared at close: a real probe whose stubs exit at once ends within STOP_GRACE_MS - 1 s of its last child\'s exit, not a grace later', async () => {
    const base = mkTmp('ccrc-replay-fr2-timer-cleared-');
    const home = join(base, 'home');
    mkdirSync(home, { mode: 0o700 });
    writeRoster(home, [{ id: 'up-a', label: 'up-a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' }]);
    plantStub(home, 'up-a');
    // Each stub notes the time just before it writes its stream and exits; the driver's own exit is measured against the last.
    writeFileSync(join(home, '.local', 'bin', 'up-a'), stubSource(`fs.readFileSync(0);
fs.appendFileSync(path.join(home, 'exits.ms'), Date.now() + '\\n');
process.stdout.write(stream());`), { mode: 0o700 });
    const now = Math.floor(Date.now() / 1000);
    mkdirSync(join(home, '.cc-limits'), { recursive: true });
    writeFileSync(join(home, '.cc-limits', 'up-a.json'), JSON.stringify({ five: 10, seven: 10, ts: now, fiveResetAt: now + 3600, sevenResetAt: now + 86_400 }));
    const out = join(base, 'out');
    const driver = spawn(process.execPath, ['--no-warnings', SCRIPT, 'probe', '--out', out, '--account', 'up-a', '--budget', '1000000', '--arm-model', 'fixture-model-arm'],
      { env: { ...scrubbedEnv(process.env), HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    startedChildren.push(driver);
    let stderr = '';
    driver.stderr.on('data', (d) => { stderr += String(d); });
    const exited = new Promise<{ code: number | null; signal: string | null }>((r) => driver.once('close', (code, signal) => r({ code, signal })));
    try {
      const r = await bounded(exited, 60_000, 'the driver exiting');
      const closedAt = Date.now();
      expect(r, stderr).toEqual({ code: 0, signal: null });
      const exits = recorded(join(home, 'exits.ms'));
      expect(exits.length, 'the stubs ran').toBeGreaterThanOrEqual(1);
      const lag = closedAt - Math.max(...exits);
      expect(lag, `the driver ended ${lag} ms after its last child's exit (an uncleared bound timer holds it a whole grace)`).toBeLessThan(STOP_GRACE_MS - 1_000);
    } finally {
      killAll(allOf(home));
      driver.kill('SIGKILL');
    }
  }, 120_000);

  it('a run whose leader exits while a setsid grandchild holds stderr returns after about the grace, with the leader\'s stderr line read and recorded', async () => {
    const b = t5Box('ccrc-replay-fr2-setsid-read-');
    writeFileSync(join(b.home, '.local', 'bin', 'up-a'), stubSource(`fs.readFileSync(0);
process.stderr.write("error: unknown option '--fixture-flag'\\n");
${SETSID_GRANDCHILD}
process.stdout.write(stream());`), { mode: 0o700 });
    try {
      const started = Date.now();
      const o = await bounded(claimedRun(t5job(b, b.up, 'box', 'bw-0')), 60_000, 'the run returning');
      const took = Date.now() - started;
      expect(took, `returned after ${took} ms`).toBeLessThan(9_000);
      expect(took, 'the bound waits out the grace (a timer that fires at the exit returns early and reds this by time)').toBeGreaterThanOrEqual(STOP_GRACE_MS - 1_000);
      expect([o.skipped, o.code, o.unknownOptions]).toEqual([false, 0, ['--fixture-flag']]);
      const run = JSON.parse(readFileSync(join(b.out, 'bw-0.run.json'), 'utf8'));
      expect(run.unknown_options, 'the leader\'s stderr line is recorded').toEqual(['--fixture-flag']);
      expect(recorded(pidsOf(b)).some(alive), 'the setsid grandchild is still running').toBe(true);
    } finally { killAll(allOf(b.home)); }
  }, 120_000);

  it('the bound reaches --version too: a setsid grandchild holding its stdout does not hold measureClaudeVersion', async () => {
    const b = t5Box('ccrc-replay-fr2-setsid-version-');
    writeFileSync(join(b.home, '.local', 'bin', 'up-a'), stubSource(`process.stdout.write('9.9.9 (Claude Code)\\n');
const g = cp.spawn('/usr/bin/setsid', ['sleep', '${SLEEP_S}'], { stdio: ['ignore', 'inherit', 'ignore'] });
fs.appendFileSync(path.join(home, 'grandchildren.pids'), g.pid + '\\n');
g.unref();`), { mode: 0o700 });
    try {
      const started = Date.now();
      const v = await bounded(replay.measureClaudeVersion(b.up, b.out, 'fixture.UTF-8'), 60_000, '--version returning');
      const took = Date.now() - started;
      expect(took, `returned after ${took} ms`).toBeLessThan(9_000);
      expect(v).toEqual({ state: 'value', version: '9.9.9 (Claude Code)' });
    } finally { killAll(allOf(b.home)); }
  }, 120_000);

  it('the timeout path: a process in the run\'s group that ignores SIGTERM and holds stderr survives the timeout\'s SIGTERM, and is dead when the run returns', async () => {
    const b = t5Box('ccrc-replay-fr2-timeout-group-');
    // The grandchild records its own pid only AFTER it has installed its ignoring handler, so a recorded pid is one the
    // timeout's SIGTERM cannot kill. Same group (no setsid, no detached), stderr inherited from the run's pipe.
    writeFileSync(join(b.home, '.local', 'bin', 'up-a'), stubSource(`fs.readFileSync(0);
const g = cp.spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); require('node:fs').appendFileSync(process.argv[1], process.pid + '\\\\n'); setTimeout(() => {}, 25000)", path.join(home, 'grandchildren.pids')], { stdio: ['ignore', 'ignore', 'inherit'] });
setTimeout(() => {}, 25000);`), { mode: 0o700 });
    try {
      const run = bounded(claimedRun(t5job(b, b.up, 'box', 'tg-0', { timeoutMs: 8_000 })), 60_000, 'the timed-out run returning');
      run.catch(() => {});
      expect(await until(() => recorded(pidsOf(b)).length >= 1 && recorded(join(b.home, 'leaders.pids')).length >= 1, 60_000), 'the stub and its grandchild recorded their pids').toBe(true);
      const [gc] = recorded(pidsOf(b));
      const [leader] = recorded(join(b.home, 'leaders.pids'));
      expect(await until(() => !alive(leader!), 30_000), 'the timeout\'s SIGTERM ended the leader').toBe(true);
      expect(alive(gc!), 'CONTROL: the grandchild survived the timeout\'s SIGTERM (it ignores it), so only the bound can end it').toBe(true);
      const o = await run;
      expect([o.skipped, o.signal]).toEqual([false, 'SIGTERM']);
      expect(await until(() => !alive(gc!), 3_000), 'the group member that ignored SIGTERM is dead when the run returns').toBe(true);
    } finally { killAll(allOf(b.home)); }
  }, 120_000);
});

// ── W2-5a Task 1: reconstruction reads the store through W2-1's exports (W2-D74, W2-D75, W2-D33, W2-D68 (2), W2-D54,
// W2-D24, W2-D29) ────────────────────────────────────────────────────────────────────────────────────────────────────
// The scans and pure cases run everywhere. The store cases run on ONE fixture HOME (historyHelpers' makeHistoryBox: a
// mkTmp HOME whose PATH holds ccrcContainedEnv's poisoned gh, ssh, curl and managers). The real sweep builds its store
// from planted transcripts, as history-recall's W2-D33 block builds its own: no live store, no model and no claude are
// touched or spawned. The cases read it in this process through the driver's exports, and change it only through a
// writer handle on the fixture store, putting every column back in a finally.
type W5a1Rs = { db: W5a1Db; close: () => void } & Record<string, unknown>;
type W5a1Payload =
  | { state: 'payload'; text: string; counts: { members: number; absent: number; off_copy: number; unparseable: number; pointer_lines: number } }
  | { state: 'discard'; why: string };
const w5a1 = w5a1Drv as unknown as {
  openReplayStore(home: string): W5a1Rs;
  reconstructPayload(rs: W5a1Rs, boundaryEntryId: number, question: string): W5a1Payload;
  entryBodyOf(rs: unknown, row: { entry_id: number; blob_id: number }): { state: string; word?: string };
  boundaryCopyOf(rs: W5a1Rs, boundaryEntryId: number): { state: string; rows: Array<{ blob_id: number; uuid: string }>; summaryIndex: number | null };
  spanRowsOf(rs: W5a1Rs, boundaryEntryId: number): { state: 'span'; rows: Array<Record<string, unknown>> } | { state: 'discard'; why: string };
  composePayload(parts: { summary: string; kept: readonly string[] }, question: string): string;
  renderToolUseLine(name: string, inputText: string): string;
  removePointerLines(text: string): { text: string; replaced: number };
  RECON_DISCARDS: readonly string[];
  POINTER_REMOVED: string;
  CODE_SHA_FILES: readonly string[];
  DRIVER_REASONS: readonly string[];
  TOOL_RESULT_CUT: number;
  DriverRefusal: new (word: string, detail: string) => Error & { word: string; detail: string };
};
const w5a1D = w5a1Derive as unknown as {
  blobReadStmts(db: W5a1Db): Record<string, unknown>;
  bodyOf(s: Record<string, unknown>, blobId: number, budget: { bytes: number }): unknown;
  keptOf(s: Record<string, unknown>, blobId: number | null, budget: { bytes: number }): Set<string>;
};
const w5a1R = w5a1Recall as unknown as {
  expandEntryBody(rc: unknown, e: { entry_id: number; blob_id: number }): { state: string; body: unknown; primary: unknown; causes: string[] };
};
const W5A1_DEPLOY = path.join(REPO, 'deploy');
const w5a1DeployMjs = (): string[] => readdirSync(W5A1_DEPLOY).filter((f) => f.endsWith('.mjs')).sort();
/** A deploy file's code lines: a line whose trimmed start is //, * or /* is prose, which may name what the code never calls. */
const w5a1Code = (f: string): string[] => readFileSync(path.join(W5A1_DEPLOY, f), 'utf8').split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l));
const W5A1_KEPT_OF = /\bkeptOf\b/;
const W5A1_DECODE = /\bunbrotli(?:Prefix)?\b|\bbrotliDecompress(?:Sync)?\b|\bcreateBrotliDecompress\b|(['"`])node:zlib\1/;
/** Every word the store cases below answer: each must be a RECON_DISCARDS member. */
const W5A1_SEEN_DISCARDS = ['boundary-absent', 'boundary-uncopied', 'summary-absent', 'summary-unparseable', 'summary-tombstone',
  'summary-over-cap', 'summary-undecodable', 'kept-absent', 'kept-unreadable', 'member-tombstone', 'member-over-cap', 'member-undecodable',
  'body-unrenderable'];

describe('W2-5a Task 1: the driver reads the store only through W2-1 exports', () => {
  it('CONTROL: the keptOf pattern sees an import, a call, a namespace read and an alias, and not another name; the corpus holds the driver and the gate, and the driver reads kept lists through bodyOf', () => {
    for (const planted of ["import { bodyOf, keptOf } from '../ccd/history/derive.mjs';", 'const kept = keptOf(s, b.kept_blob_id, budget);',
      'const v = derive.keptOf(s, id, { bytes: 0 });', "import { keptOf as readKept } from '../ccd/history/derive.mjs';"]) {
      expect(W5A1_KEPT_OF.test(planted), planted).toBe(true);
    }
    expect(W5A1_KEPT_OF.test('const keptOfficial = 1;')).toBe(false);
    expect(w5a1DeployMjs()).toEqual(expect.arrayContaining(['history-gate.mjs', 'history-replay.mjs']));
    expect(w5a1Code('history-replay.mjs').some((l) => /\bbodyOf\(/.test(l)), 'CONTROL: the driver does read a kept list, through bodyOf').toBe(true);
  });

  it('no deploy/*.mjs names keptOf on a code line (W2-D33, W2-D68): a NULL id, a tombstone and a body that is not a list would fold into one empty set', () => {
    expect(w5a1DeployMjs().filter((f) => w5a1Code(f).some((l) => W5A1_KEPT_OF.test(l)))).toEqual([]);
  });

  it('no deploy/*.mjs decodes a blob itself (W2-D74): no unbrotli, brotliDecompress or node:zlib on a code line; CONTROL: the pattern sees each', () => {
    for (const planted of ["import { unbrotli } from '../ccd/history/store.mjs';", 'const b = brotliDecompressSync(z);',
      "import zlib from 'node:zlib';", 'const s = createBrotliDecompress();']) expect(W5A1_DECODE.test(planted), planted).toBe(true);
    expect(W5A1_DECODE.test('const body = bodyOf(rs.blobs, id, { bytes: 0 });')).toBe(false);
    expect(w5a1DeployMjs().filter((f) => w5a1Code(f).some((l) => W5A1_DECODE.test(l)))).toEqual([]);
  });

  it('CODE_SHA_FILES parity (W2-D24, decisions §7): CODE_SHA_FILES is the gate\'s GATE_CODE_FILES itself, so the four gate_code paths are spelled once', () => {
    expect(w5a1.CODE_SHA_FILES).toBe(w5a1Gate.GATE_CODE_FILES);
    expect([...w5a1Gate.GATE_CODE_FILES], 'CONTROL: the four W2-D24 names')
      .toEqual(['deploy/history-gate.mjs', 'deploy/measure-history.py', 'deploy/history-replay.mjs', 'ccd/history/lib.mjs']);
    expect(w5a1Code('history-replay.mjs').filter((l) => l.includes("'deploy/measure-history.py'")), 'the driver spells no gate_code path').toEqual([]);
  });

  it('W2-D29 (R6): the driver\'s recallOffPresence is its own (home, ids) lstat; no driver import binds a recallOffPresence under any name, and cli.mjs re-exports nothing', () => {
    const IMPORT = /^import\s+([^;]*?)\s*from\s*'([^']+)';/gms;
    const bindsReader = (i: RegExpMatchArray): boolean => /\brecallOffPresence\b/.test(i[1]!);
    for (const planted of ["import { recallOffPresence as sweepPresence } from '../ccd/history/sweep.mjs';", "import { ftsTextOfBlob, recallOffPresence } from '../ccd/history/sweep.mjs';"]) {
      expect([...planted.matchAll(IMPORT)].some(bindsReader), `CONTROL: ${planted}`).toBe(true);
    }
    expect([..."import { ftsTextOfBlob } from '../ccd/history/sweep.mjs';".matchAll(IMPORT)].some(bindsReader), 'CONTROL: another sweep.mjs name is not the reader').toBe(false);
    const src = readFileSync(SCRIPT, 'utf8');
    const imports = [...src.matchAll(IMPORT)];
    expect(imports.length, 'CONTROL: the scan read the import block').toBeGreaterThan(5);
    expect(imports.filter(bindsReader).map((i) => i[0])).toEqual([]);
    expect(src.split('\n').filter((l) => /^export function recallOffPresence\(/.test(l))).toEqual(['export function recallOffPresence(home, ids) {']);
    const cli = readFileSync(path.join(REPO, 'ccd', 'history', 'cli.mjs'), 'utf8').split('\n');
    expect(cli.filter((l) => /^export\s*(?:\*|\{)/.test(l)), 'cli.mjs re-exports nothing, so importing pairIndexOf brings no second reader').toEqual([]);
    expect(cli.some((l) => l.includes("recallOffPresence } from './sweep.mjs';")), 'CONTROL: cli.mjs imports sweep\'s reader').toBe(true);
  });

  it('RECON_DISCARDS is frozen, duplicate-free, Task 1\'s fourteen words first, holds every word the store cases answer (body-unrenderable, D-6302, among them), and is disjoint from DRIVER_REASONS and GATE_REASONS: a discard is a count, never a refusal (R5)', () => {
    expect(Array.isArray(w5a1.RECON_DISCARDS) && Object.isFrozen(w5a1.RECON_DISCARDS)).toBe(true);
    // Tasks 2, 3 and 4 append their boundary words after these, in place, each pinning its own slice.
    expect(w5a1.RECON_DISCARDS.slice(0, 14)).toEqual(['boundary-absent', 'boundary-uncopied', 'summary-absent', 'summary-unparseable',
      'summary-tombstone', 'summary-over-cap', 'summary-undecodable', 'kept-absent', 'kept-unreadable', 'member-tombstone',
      'member-over-cap', 'member-undecodable', 'over-decode-cap', 'leaf-absent']);
    expect(new Set(w5a1.RECON_DISCARDS).size).toBe(w5a1.RECON_DISCARDS.length);
    expect(W5A1_SEEN_DISCARDS.filter((w) => !w5a1.RECON_DISCARDS.includes(w))).toEqual([]);
    expect(w5a1.RECON_DISCARDS.filter((w) => w5a1.DRIVER_REASONS.includes(w))).toEqual([]);
    expect(w5a1.RECON_DISCARDS.filter((w) => (w5a1Gate.GATE_REASONS as readonly string[]).includes(w))).toEqual([]);
  });

  it('W2-D75 item 3 and W2-D64: composePayload joins the summary, each kept member and the question by one blank line, the question followed by ANSWER_PROTOCOL; an empty question and empty parts still carry it; renderToolUseLine is lib\'s tool_use rendering', () => {
    expect(w5a1.composePayload({ summary: 's', kept: ['a', 'b'] }, 'q')).toBe(`s\n\na\n\nb\n\nq\n\n${w5a1Gate.ANSWER_PROTOCOL}`);
    expect(w5a1.composePayload({ summary: '', kept: [] }, '')).toBe(`\n\n\n\n${w5a1Gate.ANSWER_PROTOCOL}`);
    const input = { file_path: '/home/u/tree/demo/b.md' };
    expect(w5a1.renderToolUseLine('Read', JSON.stringify(input))).toBe('[tool_use Read] {"file_path":"/home/u/tree/demo/b.md"}');
    expect(w5a1.renderToolUseLine('Read', JSON.stringify(input)), 'CONTROL: lib\'s rendering of the same block')
      .toBe(w5a1Lib.renderEntryText([{ type: 'tool_use', id: 'toolu_01W5A1R', name: 'Read', input }]));
  });

  it('item 1 (W2-D75): removePointerLines replaces each whole line naming a .jsonl path with [pointer removed], and nothing else', () => {
    const ptr = 'If you need specific details from before compaction, read the full transcript at: /home/u/.claude/projects/-home-u-tree-demo/abc.jsonl';
    const text = ['1. Primary Request and Intent:', '   keep /home/u/tree/demo/b.md', ptr, 'Continue from where it left off.'].join('\n');
    expect(w5a1.removePointerLines(text)).toEqual({
      text: ['1. Primary Request and Intent:', '   keep /home/u/tree/demo/b.md', '[pointer removed]', 'Continue from where it left off.'].join('\n'), replaced: 1,
    });
    expect(w5a1.POINTER_REMOVED).toBe('[pointer removed]');
    // CONTROL: a .jsonl name with no path, a path ending .jsonlx and a text with no pointer are left alone.
    for (const keep of ['the file notes.jsonl', 'see /home/u/tree/x.jsonlx', 'no pointer here']) expect(w5a1.removePointerLines(keep)).toEqual({ text: keep, replaced: 0 });
    expect(w5a1.removePointerLines(`${ptr}\n${ptr}`).replaced, 'every such line').toBe(2);
  });

  it('openReplayStore refuses store-unreadable with the store\'s own word, never its message: a missing store and a zero-byte one (W2-D51)', () => {
    const answer = (home: string): [string, string] => {
      try { w5a1.openReplayStore(home).close(); return ['opened', '']; } catch (e) {
        expect(e).toBeInstanceOf(w5a1.DriverRefusal);
        const r = e as { word: string; detail: string };
        return [r.word, r.detail];
      }
    };
    expect(answer(mkTmp('ccrc-w5a1-nostore-'))).toEqual(['store-unreadable', 'store-missing']);
    const zero = mkTmp('ccrc-w5a1-zerostore-');
    const f = w5a1Lib.historyPaths(zero).dbFile;
    mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    writeFileSync(f, '', { mode: 0o600 });
    expect(answer(zero)).toEqual(['store-unreadable', 'store-zero-byte']);
    expect(statSync(f).size, 'the open adopted nothing').toBe(0);
  });

  it('the driver runs under --no-warnings: its shebang passes the flag', () => {
    expect(readFileSync(SCRIPT, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env -S node --no-warnings');
  });

  it('importing the driver loads cli.mjs, which sets the importing process\'s umask to 0o077, and runs no main (W2-D33)', () => {
    const code = ['process.umask(0o022);', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});`, 'console.log(String(process.umask(0o022)));'].join('\n');
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code],
      { encoding: 'utf8', timeout: 60_000, env: { ...scrubbedEnv(process.env), HOME: mkTmp('ccrc-w5a1-umask-') } });
    expect(r.status, r.stderr).toBe(0);
    expect([r.stdout, r.stderr], 'the umask is 0o077 after the import, and neither main printed').toEqual([`${0o077}\n`, '']);
  });
});

describe.skipIf(process.platform === 'darwin')('W2-5a Task 1: reconstruction from a fixture store', () => {
  const ID = 'claude-a-w5a1';
  const GEN = '0189abcd-1234-4678-9abc-0000000005a1';
  const TAG = 'a5a10001';
  const u = (i: number): string => `${TAG}-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const ts = (i: number): string => new Date(Date.UTC(2026, 9, 1, 10, 0, i)).toISOString();
  const SID = u(0);
  const HEAVY = 120_000;
  /** The run's secret: a fixture token under ~/.ccrc, written after every sweep, so only pairIndexOf's read of it redacts it.
   *  Assembled at run time; no fixture value is key-shaped. */
  const SECRET = ['zq', 'w5a1', 'plain', 'words', 'value'].join('-');
  const POINTER = `If you need specific details from before compaction, read the full transcript at: /home/u/.claude/projects/${w5a1H.SEED_SLUG}/${SID}.jsonl`;
  const SUMMARY = ['<summary>', '1. Primary Request and Intent:', '   zqw5a1 intent', `   zqw5a1 token ${SECRET}`, '9. Optional Next Step:',
    '   zqw5a1 next step', '</summary>', POINTER, 'Continue from where it left off.'].join('\n');
  const RESULT = `zqw5a1 result ${SECRET} ${'r '.repeat(2500)}end`;
  const QUESTION = `Which file did the session read first? ${SECRET}`;
  // W2-D54: the run's secret sits in every part kind, the summary, a user text block and a tool_use input as well as the
  // tool_result and the question, so each redaction call is pinned by its own part (mutants M19 and M20).
  const USER_PART = `[user] zqw5a1 open the app ${w5a1Lib.REDACTED_MARK}`;
  const READ_LINE = `[tool_use Read] {"file_path":"/home/u/tree/demo/b.md","note":"${w5a1Lib.REDACTED_MARK}"}`;
  let box: w5a1H.HistoryBox;
  let dbFile = '';
  /** Leaf N's rows. Its kept list names u(3), u(1), u(2) out of file order, and u(9), which no copy holds. u(4) is not
   *  kept. The first text block of u(2) is `fill`: "..." in the copy seeded first, "" in the second, a ccd-sanitize pair. */
  const rows = (fill: string): object[] => {
    const read = w5a1Fx.toolUseRow({ uuid: u(2), ts: ts(2), parentUuid: u(1), sessionId: SID, toolUseId: 'toolu_01W5A1', name: 'Read', input: { file_path: '/home/u/tree/demo/b.md', note: SECRET } });
    const m = read['message'] as { content: unknown[] };
    m.content = [{ type: 'text', text: fill }, ...m.content];
    return [
      w5a1Fx.userRow({ uuid: u(1), ts: ts(1), sessionId: SID, text: `zqw5a1 open the app ${SECRET}` }),
      read,
      w5a1Fx.toolResultRow({ uuid: u(3), ts: ts(3), parentUuid: u(2), sessionId: SID, toolUseId: 'toolu_01W5A1', content: RESULT }),
      w5a1Fx.assistantRow({ uuid: u(4), ts: ts(4), parentUuid: u(3), sessionId: SID, text: 'zqw5a1 not kept' }),
      w5a1Fx.boundaryRow({ uuid: u(5), ts: ts(5), parentUuid: u(4), sessionId: SID, trigger: 'manual', headUuid: u(4), anchorUuid: u(6),
        tailUuid: u(4), allUuids: [u(3), u(1), u(2), u(9)] }),
      w5a1Fx.summaryRow({ uuid: u(6), ts: ts(6), parentUuid: u(5), sessionId: SID, text: SUMMARY }),
    ];
  };

  w5a1BeforeAll(() => {
    box = w5a1H.makeHistoryBox('ccrc-w5a1-');
    dbFile = w5a1Lib.historyPaths(box.home).dbFile;
    // The sanitised copy is seeded FIRST, so its entries' primary bodies are the "..." ones (history-recall's DM2b shape),
    // and one more tick derives leaf N.
    const seeded = w5a1H.seedFamily(box, { id: ID, project: 'demo', generation: GEN, uuid: SID, rows: rows('...') });
    const t = w5a1H.runSweep(box);
    expect(t.code, t.stderr).toBe(0);
    w5a1H.plantTranscript(box, 'claude-b', path.basename(path.dirname(seeded.transcript)), SID, rows(''));
    // Two discovery passes (SCAN_INTERVAL_MS) find and ingest the second copy.
    for (let k = 0; k < 2; k += 1) {
      const r = w5a1H.runDriver(box, { offsetMs: w5a1Lib.SCAN_INTERVAL_MS + 60_000 });
      expect(r.code, r.stderr).toBe(0);
    }
    writeFileSync(path.join(box.home, '.ccrc', 'w5a1.token'), `${SECRET}\n`, { mode: 0o600 });
  }, 3 * HEAVY);

  const ro = <T,>(fn: (db: W5a1Db) => T): T => { const db = new W5a1Db(dbFile, { readOnly: true }); try { return fn(db); } finally { db.close(); } };
  const rw = <T,>(fn: (db: W5a1Db) => T): T => { const db = new W5a1Db(dbFile); try { return fn(db); } finally { db.close(); } };
  const idOf = (uuid: string): number => ro((db) => Number((db.prepare('SELECT entry_id FROM entries WHERE uuid = ?').get(uuid) as { entry_id: number }).entry_id));
  const blobOf = (uuid: string): number => ro((db) => Number((db.prepare('SELECT blob_id FROM entries WHERE uuid = ?').get(uuid) as { blob_id: number }).blob_id));
  const keptBlob = (): number => ro((db) => Number((db.prepare('SELECT kept_blob_id AS k FROM boundaries WHERE entry_id = ?').get(idOf(u(5))) as { k: number }).k));
  /** A read handle through the driver's own open, closed after `fn`. */
  const withStore = <T,>(fn: (rs: W5a1Rs) => T): T => { const rs = w5a1.openReplayStore(box.home); try { return fn(rs); } finally { rs.close(); } };
  const payload = (q: string = QUESTION): W5a1Payload => withStore((rs) => w5a1.reconstructPayload(rs, idOf(u(5)), q));
  const parts = (p: W5a1Payload): string[] => {
    expect(p.state, JSON.stringify(p).slice(0, 200)).toBe('payload');
    return (p as { text: string }).text.split('\n\n');
  };
  const picked = (uuid: string) => withStore((rs) => w5a1R.expandEntryBody(rs, { entry_id: idOf(uuid), blob_id: blobOf(uuid) }));
  type BlobCols = { z: Uint8Array | null; raw_len: number; pruned_ms: number | null };
  /** Sets a blob's stored columns for `fn`, then puts back the three it read. */
  const withBlob = <T,>(blobId: number, set: Partial<BlobCols>, fn: () => T): T => {
    const orig = ro((db) => db.prepare('SELECT z, raw_len, pruned_ms FROM blobs WHERE blob_id = ?').get(blobId)) as BlobCols;
    const put = (v: BlobCols): void => rw((db) => { db.prepare('UPDATE blobs SET z = ?, raw_len = ?, pruned_ms = ? WHERE blob_id = ?').run(v.z, v.raw_len, v.pruned_ms, blobId); });
    put({ ...orig, ...set });
    try { return fn(); } finally { put(orig); }
  };
  type BoundaryCols = { kept_blob_id: number | null; anchor_uuid: string | null };
  /** Sets boundary N's kept id or anchor for `fn`, then puts both back. */
  const withBoundary = <T,>(set: Partial<BoundaryCols>, fn: () => T): T => {
    const b = idOf(u(5));
    const orig = ro((db) => db.prepare('SELECT kept_blob_id, anchor_uuid FROM boundaries WHERE entry_id = ?').get(b)) as BoundaryCols;
    const put = (v: BoundaryCols): void => rw((db) => { db.prepare('UPDATE boundaries SET kept_blob_id = ?, anchor_uuid = ? WHERE entry_id = ?').run(v.kept_blob_id, v.anchor_uuid, b); });
    put({ ...orig, ...set });
    try { return fn(); } finally { put(orig); }
  };
  /** A body stored as the store stores one: brotli bytes and the raw length. */
  const stored = (text: string): { z: Uint8Array; raw_len: number } => { const b = Buffer.from(text, 'utf8'); return { z: w5a1Brotli(b), raw_len: b.length }; };

  it('W2-D74: a kept member\'s body is expand\'s pick, the unsanitised side, never the sanitised primary', () => {
    const k = picked(u(2));
    expect([k.state, (k.primary as Array<{ text?: string }>)[0]!.text, k.causes], 'CONTROL: the primary is the sanitised copy, seeded first, paired ccd-sanitize')
      .toEqual(['body', '...', ['ccd-sanitize']]);
    expect(parts(payload())[2]).toBe(`[assistant] \n${READ_LINE}`);
  }, HEAVY);

  it('item 1 (W2-D75): the summary row\'s text, redacted whole, with its transcript-pointer line replaced by [pointer removed]', () => {
    expect(picked(u(6)).body, 'CONTROL: the stored summary names the transcript').toBe(SUMMARY);
    const p = payload();
    expect(parts(p)[0]).toBe(SUMMARY.replace(POINTER, '[pointer removed]').replace(SECRET, w5a1Lib.REDACTED_MARK));
    expect((p as { counts: { pointer_lines: number } }).counts.pointer_lines).toBe(1);
  }, HEAVY);

  it('item 2 (W2-D75, W2-D68 (2)): kept(N) members present in the store, in the holding copy\'s file order, role-tagged; a row outside kept(N) is not there', () => {
    const p = payload();
    const ps = parts(p);
    expect(ps, 'summary, three members, question, protocol').toHaveLength(6);
    expect(ps[1]).toBe(USER_PART);
    expect(ps[3]!.startsWith('[tool_result] zqw5a1 result ')).toBe(true);
    expect((p as { text: string }).text).not.toContain('zqw5a1 not kept');
    expect((p as { counts: object }).counts).toEqual({ members: 3, absent: 1, off_copy: 0, unparseable: 0, pointer_lines: 1 });
    const list = withStore((rs) => w5a1D.bodyOf(w5a1D.blobReadStmts(rs.db), keptBlob(), { bytes: 0 }));
    expect(list, 'CONTROL: the kept list is stored out of file order, with a uuid no copy holds').toEqual([u(3), u(1), u(2), u(9)]);
  }, HEAVY);

  it('item 2 (W2-D54): a tool_result is redacted whole over the run\'s pair index (pairIndexOf), then cut to TOOL_RESULT_CUT code points', () => {
    const tr = parts(payload())[3]!;
    expect(tr).not.toContain(SECRET);
    expect(tr.startsWith(`[tool_result] zqw5a1 result ${w5a1Lib.REDACTED_MARK} r r`)).toBe(true);
    expect(Array.from(tr.slice('[tool_result] '.length))).toHaveLength(w5a1.TOOL_RESULT_CUT);
    expect(JSON.stringify(picked(u(3)).body), 'CONTROL: the stored row holds the value verbatim').toContain(SECRET);
    expect(w5a1Lib.redactField(RESULT, w5a1Lib.makePairIndex([])), 'CONTROL: no shape rule redacts it without its pair').toContain(SECRET);
  }, HEAVY);

  it('W2-D54: the summary, a user text block and a tool_use input are each redacted whole over the run\'s pair index; no part carries the value', () => {
    const ps = parts(payload());
    for (const [i, what] of [[0, 'the summary'], [1, 'the user row'], [2, 'the Read tool_use']] as const) {
      expect(ps[i], what).not.toContain(SECRET);
      expect(ps[i], what).toContain(w5a1Lib.REDACTED_MARK);
    }
    for (const id of [u(6), u(1), u(2)]) {
      expect(JSON.stringify(picked(id).body), `CONTROL: the stored row ${id} holds the value verbatim`).toContain(SECRET);
    }
  }, HEAVY);

  it('item 3 (W2-D75, W2-D64): the question, redacted, then ANSWER_PROTOCOL, last; an empty question still carries it', () => {
    const ps = parts(payload());
    expect(ps[4]).toBe(`Which file did the session read first? ${w5a1Lib.REDACTED_MARK}`);
    expect(ps[5]).toBe(w5a1Gate.ANSWER_PROTOCOL);
    expect(parts(payload('')).slice(-2)).toEqual(['', w5a1Gate.ANSWER_PROTOCOL]);
  }, HEAVY);

  it('kept(N) through bodyOf, never keptOf (W2-D68, W2-D33): a NULL kept id is kept-absent; a tombstoned kept blob and one that is not a list are kept-unreadable, never an empty list', () => {
    const kb = keptBlob();
    const live = withStore((rs) => [...w5a1D.keptOf(w5a1D.blobReadStmts(rs.db), kb, { bytes: 0 })]);
    expect(new Set(live), 'CONTROL: on the live blob, keptOf and the payload agree on kept(N)').toEqual(new Set([u(3), u(1), u(2), u(9)]));
    withBoundary({ kept_blob_id: null }, () => expect(payload()).toEqual({ state: 'discard', why: 'kept-absent' }));
    withBlob(kb, { z: null, pruned_ms: Date.UTC(2026, 0, 2) }, () => {
      expect(payload()).toEqual({ state: 'discard', why: 'kept-unreadable' });
      expect(withStore((rs) => w5a1D.keptOf(w5a1D.blobReadStmts(rs.db), kb, { bytes: 0 }).size), 'CONTROL: keptOf folds the tombstone into an empty set').toBe(0);
    });
    withBlob(kb, stored('{"a":1}'), () => expect(payload()).toEqual({ state: 'discard', why: 'kept-unreadable' }));
    expect(parts(payload())[1], 'CONTROL: every column is back').toBe(USER_PART);
  }, HEAVY);

  it('expandEntryBody\'s five words (D-6238): an unparseable kept member is read as text and counted; tombstone, over-cap and undecodable each discard under their own word; for the summary row all four discard', () => {
    const m = blobOf(u(1));
    const s = blobOf(u(6));
    const PRUNED = Date.UTC(2026, 0, 2);
    const OVER = w5a1Lib.BLOB_DECODE_MAX + 1;
    withBlob(m, { z: null, pruned_ms: PRUNED }, () => expect(payload()).toEqual({ state: 'discard', why: 'member-tombstone' }));
    withBlob(m, { raw_len: OVER }, () => expect(payload()).toEqual({ state: 'discard', why: 'member-over-cap' }));
    withBlob(m, { z: null }, () => expect(payload()).toEqual({ state: 'discard', why: 'member-undecodable' }));
    withBlob(m, stored('zq not json {'), () => {
      const p = payload();
      expect(parts(p)[1]).toBe('[user] zq not json {');
      expect((p as { counts: { unparseable: number } }).counts.unparseable).toBe(1);
    });
    withBlob(s, { z: null, pruned_ms: PRUNED }, () => expect(payload()).toEqual({ state: 'discard', why: 'summary-tombstone' }));
    withBlob(s, { raw_len: OVER }, () => expect(payload()).toEqual({ state: 'discard', why: 'summary-over-cap' }));
    withBlob(s, { z: null }, () => expect(payload()).toEqual({ state: 'discard', why: 'summary-undecodable' }));
    withBlob(s, stored('zq not json {'), () => expect(payload()).toEqual({ state: 'discard', why: 'summary-unparseable' }));
    expect(parts(payload())[1], 'CONTROL: every column is back').toBe(USER_PART);
  }, HEAVY);

  it('W2-D65: leaf N\'s span is the rows derivation recorded for leaf N, in holding-copy file order, in the store\'s column names; a row that is no boundary is leaf-absent', () => {
    const b = idOf(u(5));
    const span = withStore((rs) => w5a1.spanRowsOf(rs, b));
    expect(span.state).toBe('span');
    const rows = (span as { rows: Array<Record<string, unknown>> }).rows;
    const recorded = ro((db) => db.prepare(`SELECT e.uuid AS uuid FROM nodes n JOIN node_sources s ON s.node_id = n.node_id
      JOIN entries e ON e.entry_id = s.entry_id WHERE n.boundary_entry_id = ? AND n.depth = 0 ORDER BY s.ord`).all(b)) as Array<{ uuid: string }>;
    expect(recorded.length, 'CONTROL: the sweep recorded leaf N\'s sources').toBeGreaterThan(0);
    expect(rows.map((r) => r['uuid'])).toEqual(recorded.map((r) => r.uuid));
    expect(Object.keys(rows[0]!).sort()).toEqual(['blob_id', 'entry_id', 'model', 'provenance', 'ts_ms', 'type', 'uuid']);
    const copy = withStore((rs) => w5a1.boundaryCopyOf(rs, b));
    const at = rows.map((r) => copy.rows.findIndex((c) => c.uuid === r['uuid']));
    expect(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1]!)), 'holding-copy file order').toBe(true);
    expect(withStore((rs) => w5a1.spanRowsOf(rs, idOf(u(1))))).toEqual({ state: 'discard', why: 'leaf-absent' });
  }, HEAVY);

  it('one store open per run (R3): the open reads this node\'s store id through its own handle', () => {
    const want = ro((db) => String((db.prepare("SELECT v FROM meta WHERE k = 'store_id'").get() as { v: string }).v));
    expect(want, 'CONTROL: the fixture store holds a UUID store id').toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(withStore((rs) => rs['storeId'])).toBe(want);
  }, HEAVY);

  it('boundary N and its summary row: boundary-absent, boundary-uncopied and summary-absent; the summary pick is the row leaf N\'s derivation used', () => {
    expect(withStore((rs) => w5a1.reconstructPayload(rs, idOf(u(1)), QUESTION))).toEqual({ state: 'discard', why: 'boundary-absent' });
    withBoundary({ anchor_uuid: u(8) }, () => expect(payload()).toEqual({ state: 'discard', why: 'summary-absent' }));
    const b = idOf(u(5));
    const held = ro((db) => db.prepare('SELECT file_id, entry_id, line FROM memberships WHERE entry_id = ?').all(b)) as Array<{ file_id: number; entry_id: number; line: number }>;
    expect(held.length, 'CONTROL: both copies hold N, so the second copy was ingested').toBe(2);
    rw((db) => { db.prepare('DELETE FROM memberships WHERE entry_id = ?').run(b); });
    try {
      expect(payload()).toEqual({ state: 'discard', why: 'boundary-uncopied' });
    } finally {
      rw((db) => { for (const h of held) db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)').run(h.file_id, h.entry_id, h.line); });
    }
    const leaf = ro((db) => db.prepare('SELECT summary_blob_id AS s FROM nodes WHERE boundary_entry_id = ? AND depth = 0').get(b)) as { s: number | null } | undefined;
    expect(leaf?.s, 'CONTROL: the sweep derived leaf N with its summary').toBe(blobOf(u(6)));
    const pick = withStore((rs) => { const c = w5a1.boundaryCopyOf(rs, b); return c.summaryIndex === null ? null : c.rows[c.summaryIndex]!.blob_id; });
    expect(pick, 'the payload\'s summary row is the one derivation used').toBe(leaf!.s);
    expect(parts(payload())[1], 'CONTROL: the memberships are back').toBe(USER_PART);
  }, HEAVY);

  it('D-6301: a body word expandEntryBody does not answer today throws a TypeError naming it, never a discard with no word; a word it does answer keeps its own discard (CONTROL)', async () => {
    let word = 'mystery';
    vi.resetModules();
    vi.doMock('../../ccd/history/recall.mjs', async (importOriginal: () => Promise<object>) => ({
      ...(await importOriginal()),
      expandEntryBody: () => ({ state: word, body: null, primary: null, causes: [], blob: { state: 'none' } }),
    }));
    try {
      const fresh = (await import('../../deploy/history-replay.mjs')) as unknown as typeof w5a1;
      expect(() => fresh.entryBodyOf({}, { entry_id: 1, blob_id: 1 })).toThrow(new TypeError('entryBodyOf: unknown body state mystery'));
      const rs = fresh.openReplayStore(box.home);
      try {
        expect(() => fresh.reconstructPayload(rs, idOf(u(5)), QUESTION), 'the payload path throws too').toThrow(TypeError);
        word = 'tombstone';
        expect(fresh.reconstructPayload(rs, idOf(u(5)), QUESTION), 'CONTROL: a known body-less word keeps its own discard through the same stub')
          .toEqual({ state: 'discard', why: 'summary-tombstone' });
      } finally { rs.close(); }
    } finally {
      vi.doUnmock('../../ccd/history/recall.mjs');
      vi.resetModules();
    }
  }, HEAVY);

  it('D-6302: a body nested past JSON.stringify\'s stack parses and cannot be rendered; a kept member and the summary row each discard the boundary body-unrenderable, a count, never a thrown RangeError', () => {
    const DEPTH = 10_000;
    const nested = `${'{"a":'.repeat(DEPTH)}1${'}'.repeat(DEPTH)}`;
    expect(() => JSON.stringify(JSON.parse(nested)), 'CONTROL: this depth parses and cannot be stringified').toThrow(RangeError);
    withBlob(blobOf(u(1)), stored(`[{"type":"tool_use","name":"Read","input":${nested}}]`), () => {
      expect(picked(u(1)).state, 'CONTROL: expandEntryBody answers body for it').toBe('body');
      expect(payload()).toEqual({ state: 'discard', why: 'body-unrenderable' });
    });
    withBlob(blobOf(u(6)), stored(nested), () => {
      expect(picked(u(6)).state, 'CONTROL: expandEntryBody answers body for it').toBe('body');
      expect(payload()).toEqual({ state: 'discard', why: 'body-unrenderable' });
    });
    expect(parts(payload())[1], 'CONTROL: every column is back').toBe(USER_PART);
  }, HEAVY);
});

describe.skipIf(process.platform === 'darwin')('W2-5a Task 1: openReplayStore\'s refusal arms on a fixture HOME (W2-D51, W2-D59)', () => {
  /** What the open answers for `home`: 'opened', or the refusal's word and detail. */
  const answer = (home: string): [string, string] => {
    try { w5a1.openReplayStore(home).close(); return ['opened', '']; } catch (e) {
      expect(e).toBeInstanceOf(w5a1.DriverRefusal);
      const r = e as { word: string; detail: string };
      return [r.word, r.detail];
    }
  };
  /** A store the real createStore made under a fresh fixture HOME, then `edit` run on a writer handle. */
  const storeWith = (prefix: string, edit: (db: W5a1Db) => void): string => {
    const home = mkTmp(prefix);
    w5a1CreateStore(home);
    const db = new W5a1Db(w5a1Lib.historyPaths(home).dbFile);
    try { edit(db); } finally { db.close(); }
    return home;
  };

  it('CONTROL: an untouched created store opens', () => {
    expect(answer(storeWith('ccrc-w5a1-arm-ok-', () => {}))).toEqual(['opened', '']);
  });

  it('a store whose meta holds no store_id refuses store-unreadable store-id-absent', () => {
    expect(answer(storeWith('ccrc-w5a1-arm-noid-', (db) => { db.prepare("DELETE FROM meta WHERE k = 'store_id'").run(); })))
      .toEqual(['store-unreadable', 'store-id-absent']);
  });

  it('a store whose store_id is not a UUID refuses store-unreadable store-id-unreadable, apart from an absent one', () => {
    expect(answer(storeWith('ccrc-w5a1-arm-badid-', (db) => { db.prepare("UPDATE meta SET v = 'not-a-uuid' WHERE k = 'store_id'").run(); })))
      .toEqual(['store-unreadable', 'store-id-unreadable']);
  });

  it('a file that is not a SQLite database refuses store-unreadable with store-read-failed and SQLite\'s own message', () => {
    const home = mkTmp('ccrc-w5a1-arm-garbage-');
    const f = w5a1Lib.historyPaths(home).dbFile;
    mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    writeFileSync(f, 'this is not a database. '.repeat(400), { mode: 0o600 });
    const [word, detail] = answer(home);
    expect(word).toBe('store-unreadable');
    expect(detail).toMatch(/^store-read-failed: .+/);
  });
});

// ── W2-5a Task 2: fact mining, the producer and the redaction screen (W2-D61, W2-D65, W2-D67) ───────────────────
// Pure and in-process: no spawn, no HOME, no store and no network. Span rows are built in memory with the entries
// columns mining reads, and each row's body comes from a stand-in for W2-1's expandEntryBody answer ({state, body,
// primary, causes, blob}; mining reads state and body only), which records every row it is asked for. Redaction runs
// through lib's own redactField over pair indexes built with makePairIndex, standing in for the run's pairIndexOf
// index. Key-shaped fixtures are assembled at runtime and never written whole; paths are /home/u fixtures.
// MODULE-LEVEL below: w5a2Akia, w5a2Span, the w5a2 block builders and the W5A2_ constants, which later W2-5a tasks call
// from their own describes (Task 6's W2-D67 pin: a span holding a key-shaped value reaches the stub redacted, R7).
import { readFileSync as w5a2Read } from 'node:fs';
import * as w5a2Lib from '../../ccd/history/lib.mjs';
import * as w5a2Gate from '../../deploy/history-gate.mjs';
import * as w5a2Drv from '../../deploy/history-replay.mjs';

/** A synthetic access-key-shaped value lib's shape layer masks, assembled at runtime and never written whole. */
function w5a2Akia(): string {
  return ['AK', 'IA', 'Q7V2M9X4', 'P8W3N6Z5'].join('');
}
/** Model names: backendOf reads the first as anthropic and the second as other. */
const W5A2_CLAUDE = 'claude-fixture-model';
const W5A2_GATEWAY = 'fixture-gateway-model';
const W5A2_CWD = '/home/u/tree';
const W5A2_CONFIG_DIRS = ['/home/u/.claude', '/home/u/.gen-a'];
const W5A2_IDX0 = w5a2Lib.makePairIndex([]);
type W5a2Spec = { provenance: string; body: unknown; model?: string | null; type?: string; state?: string; source_tool_use_id?: string | null };
type W5a2Row = {
  entry_id: number; uuid: string; type: string; model: string | null; provenance: string; ts_ms: number | null; blob_id: number;
  source_tool_use_id: string | null;
};
type W5a2Pick = (r: { entry_id: number }) => { state: string; body: unknown; primary: unknown; causes: string[]; blob: null };
let w5a2NextId = 1000;
/** Span rows in file order, entry ids unique across the file, and a pick that answers like expandEntryBody and records
 *  every row it is asked for. An assistant row defaults to W5A2_CLAUDE; `state` other than 'body' gives a null body. */
function w5a2Span(specs: W5a2Spec[]): { rows: W5a2Row[]; pick: W5a2Pick; picked: number[] } {
  const bodies = new Map<number, { state: string; body: unknown }>();
  const rows = specs.map((s): W5a2Row => {
    const entry_id = w5a2NextId++;
    const state = s.state ?? 'body';
    bodies.set(entry_id, { state, body: state === 'body' ? s.body : null });
    const model = 'model' in s ? s.model ?? null : (s.provenance === 'model' ? W5A2_CLAUDE : null);
    return {
      entry_id, uuid: `fixture-${entry_id}`, type: s.type ?? (s.provenance === 'model' ? 'assistant' : 'user'), model,
      provenance: s.provenance, ts_ms: entry_id, blob_id: entry_id + 50_000, source_tool_use_id: s.source_tool_use_id ?? null,
    };
  });
  const picked: number[] = [];
  const pick: W5a2Pick = (r) => {
    picked.push(r.entry_id);
    const b = bodies.get(r.entry_id)!;
    return { state: b.state, body: b.body, primary: b.body, causes: [], blob: null };
  };
  return { rows, pick, picked };
}
const w5a2Text = (text: string) => ({ type: 'text', text });
const w5a2Use = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input });
const w5a2Result = (id: string, content: unknown, isError?: boolean) =>
  (isError === undefined ? { type: 'tool_result', tool_use_id: id, content } : { type: 'tool_result', tool_use_id: id, content, is_error: isError });
type W5a2MineInput = Parameters<typeof w5a2Drv.mineBoundary>[0];
type W5a2Mined = Extract<ReturnType<typeof w5a2Drv.mineBoundary>, { state: 'mined' }>;
type W5a2Candidate = W5a2Mined['candidates'][number];
/** mineBoundary over a w5a2Span, as boundary 'fixture-boundary' of family ('fixture-store', 'fixture-a', 'fixture-gen')
 *  with cwd and cwd_real W5A2_CWD; `over` replaces any input. */
function w5a2Mine(sp: { rows: W5a2Row[]; pick: W5a2Pick }, over: Partial<W5a2MineInput> = {}): ReturnType<typeof w5a2Drv.mineBoundary> {
  return w5a2Drv.mineBoundary({
    storeId: 'fixture-store', ccrcId: 'fixture-a', generation: 'fixture-gen',
    boundaryUuid: 'fixture-boundary', boundaryTsMs: 900_000, rows: sp.rows, pick: sp.pick, cwd: W5A2_CWD, cwdReal: W5A2_CWD,
    configDirs: W5A2_CONFIG_DIRS, ...over,
  });
}
/** The mined answer; a discard fails the case. */
function w5a2MinedOf(r: ReturnType<typeof w5a2Drv.mineBoundary>): W5a2Mined {
  expect(r.state).toBe('mined');
  return r as W5a2Mined;
}

describe('W2-5a Task 2: fact mining, the producer and the redaction screen', () => {
  const screen = (c: W5a2Candidate) => w5a2Drv.screenCandidate(c, { idx: W5A2_IDX0, baselineText: '' });
  const DRIVER_URL = new URL('../../deploy/history-replay.mjs', import.meta.url);

  // ── mining (W2-D65) and the two forms of a fact (W2-D61) ──
  it('W2-D65 sha: maximal runs of 7 to 40 lower-case hex with a digit and a letter, bounded, never inside a UUID', () => {
    const text = `commit 9f3e2d1 in session 4d1c9e2a-7b3f-4a6c-9d8e-1f2a3b4c5d6e; build-1f2a3b4c5d6e-x; deadbeef 1234567 ABC1234f g1f2a3b4c ${'a1'.repeat(20)}9 ${'0a'.repeat(20)}`;
    const sp = w5a2Span([{ provenance: 'model', body: [w5a2Text(text)] }]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.map((c) => [c.kind, c.fact, c.fact_raw])).toEqual([
      ['sha', '9f3e2d1', '9f3e2d1'], ['sha', '1f2a3b4c5d6e', '1f2a3b4c5d6e'], ['sha', '0a'.repeat(20), '0a'.repeat(20)],
    ]);
    expect(r.candidates.every((c) => c.leaf.text === text && c.source_provenance === 'model')).toBe(true);
    expect(r.candidates[0]).toMatchObject({
      store_id: 'fixture-store', ccrc_id: 'fixture-a', generation: 'fixture-gen',
      producer: { state: 'row', backend: 'anthropic' }, repo_roots: [W5A2_CWD], boundary_uuid: 'fixture-boundary',
      source_entry_uuid: sp.rows[0]!.uuid, source_entry_id: sp.rows[0]!.entry_id, pair: null,
      leaf: { text, rawLen: Buffer.byteLength(text, 'utf8') },
    });
    // R4: the writer's span is each mined row's rendering, one list the boundary's candidates share.
    expect(r.candidates[0]!.span).toEqual([{ text, rawLen: Buffer.byteLength(text, 'utf8') }]);
    expect(r.candidates.every((c) => c.span === r.candidates[0]!.span)).toBe(true);
  });

  it('W2-D65 command: a Bash input command, collapsed, 12 to 300 characters, never a recall, and only from Bash', () => {
    const at300 = `echo ${'x'.repeat(295)}`;
    const sp = w5a2Span([{ provenance: 'model', body: [
      w5a2Use('c1', 'Bash', { command: 'ls -la /tmp' }),
      w5a2Use('c2', 'Bash', { command: 'npm run test' }),
      w5a2Use('c3', 'Bash', { command: at300 }),
      w5a2Use('c4', 'Bash', { command: `${at300}x` }),
      w5a2Use('c5', 'Bash', { command: 'ccrc history grep thing' }),
      w5a2Use('c6', 'Bash', { command: '/home/u/.local/bin/ccrc history expand x' }),
      w5a2Use('c7', 'Task', { command: 'npm run build', prompt: 'look' }),
    ] }]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.filter((c) => c.kind === 'command').map((c) => c.fact)).toEqual(['npm run test', at300]);
    expect([r.counts['command-length'], r.counts['command-recall']]).toEqual([2, 2]);
  });

  it('W2-D61: a multi-line command is mined, F collapsed and F_raw exact, and the redaction screen keeps it', () => {
    const raw = 'cd server &&\n  ./node_modules/.bin/vitest run \\\n    test/a.test.ts';
    const r = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Use('m1', 'Bash', { command: raw })] }])));
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0]!;
    expect(c).toMatchObject({ kind: 'command', fact: 'cd server && ./node_modules/.bin/vitest run \\ test/a.test.ts', fact_raw: raw, leaf: { text: raw } });
    expect(c.fact).toBe(w5a2Gate.collapseWs(raw));
    expect(screen(c), 'the source side reads F_raw, which its leaf holds verbatim').toEqual({ state: 'pass' });
  });

  it('W2-D61: a short quoted command present in a kept tool_use is rejected by B, CONTROL the JSON rendering alone would admit it', () => {
    const raw = 'git commit -m "wip"';
    const r = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Use('q1', 'Bash', { command: raw })] }])));
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0]!;
    expect(c).toMatchObject({ kind: 'command', fact: raw, fact_raw: raw });
    // A stand-in for W2-D68's B over one kept member, in both of its renderings; the B task re-asserts this on real B.
    const kept = (command: string) => [w5a2Use('toolu_k', 'Bash', { command })];
    const both = (command: string) => `${w5a2Lib.renderEntryText(kept(command))}\n${w5a2Lib.ftsTextOf(kept(command), 'entry')}`;
    expect(w5a2Drv.screenCandidate(c, { idx: W5A2_IDX0, baselineText: both(raw) })).toEqual({ state: 'drop', reason: 'baseline-hit' });
    expect(w5a2Drv.screenCandidate(c, { idx: W5A2_IDX0, baselineText: w5a2Lib.renderEntryText(kept(raw)) }), 'CONTROL: the JSON rendering escapes the quotes')
      .toEqual({ state: 'pass' });
    expect(w5a2Drv.screenCandidate(c, { idx: W5A2_IDX0, baselineText: both('git commit -m "wap"') }), 'CONTROL: another command in B')
      .toEqual({ state: 'pass' });
  });

  it('W2-D65 path: the path fields of the seven tools, made absolute against the epoch cwd, never under a rostered config dir', () => {
    const sp = w5a2Span([{ provenance: 'model', body: [
      w5a2Use('p1', 'Read', { file_path: '/home/u/tree/src/app.ts' }),
      w5a2Use('p2', 'Edit', { file_path: 'src/lib/x.ts', old_string: 'a', new_string: 'b' }),
      w5a2Use('p3', 'Glob', { pattern: '**/*.ts', path: 'server' }),
      w5a2Use('p4', 'Grep', { pattern: 'TODO', path: '/home/u/tree/docs' }),
      w5a2Use('p5', 'NotebookEdit', { notebook_path: 'nb/a.ipynb', new_source: 'x' }),
      w5a2Use('p6', 'MultiEdit', { file_path: '../other/y.ts', edits: [] }),
      w5a2Use('p7', 'Write', { file_path: '/home/u/.claude/settings.json', content: '{}' }),
      w5a2Use('p8', 'Read', { file_path: '/home/u/.gen-a/projects/p/memory/m.md' }),
      w5a2Use('p9', 'Read', { file_path: '~/notes.md' }),
      w5a2Use('p10', 'WebFetch', { url: 'https://example.com/a', path: '/home/u/tree/web' }),
    ] }]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.map((c) => [c.kind, c.fact, c.fact_raw])).toEqual([
      ['path', '/home/u/tree/src/app.ts', '/home/u/tree/src/app.ts'],
      ['path', '/home/u/tree/src/lib/x.ts', 'src/lib/x.ts'],
      ['path', '/home/u/tree/server', 'server'],
      ['path', '/home/u/tree/docs', '/home/u/tree/docs'],
      ['path', '/home/u/tree/nb/a.ipynb', 'nb/a.ipynb'],
      ['path', '/home/u/other/y.ts', '../other/y.ts'],
    ]);
    expect([r.counts['path-config-dir'], r.counts['path-tilde'], r.counts['path-no-cwd']]).toEqual([2, 1, 0]);
  });

  it('W2-D65 path: with no epoch cwd a relative path is not mined, and the repo roots are the distinct cwd and cwd_real', () => {
    const body = [w5a2Use('q1', 'Read', { file_path: 'src/a.ts' }), w5a2Use('q2', 'Read', { file_path: '/srv/tree/src/b.ts' })];
    const none = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body }]), { cwd: null, cwdReal: null }));
    expect(none.candidates.map((c) => [c.fact, c.repo_roots])).toEqual([['/srv/tree/src/b.ts', []]]);
    expect(none.counts['path-no-cwd']).toBe(1);
    const two = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body }]), { cwd: W5A2_CWD, cwdReal: '/srv/tree' }));
    expect(two.candidates.map((c) => c.repo_roots)).toEqual([[W5A2_CWD, '/srv/tree'], [W5A2_CWD, '/srv/tree']]);
  });

  it('W2-D65 error: an is_error result gives its first non-empty line that is not just Exit code N, collapsed, 16 to 300 characters', () => {
    const uses = ['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => w5a2Use(id, 'Bash', { command: `npm run check-${id}` }));
    const sp = w5a2Span([
      { provenance: 'model', body: uses },
      { provenance: 'tool', body: [w5a2Result('e1', 'Exit code 1\n\n  fatal:   not a git repository (or any parent)\nmore', true)] },
      { provenance: 'tool', body: [w5a2Result('e2', 'Exit code 2\nshort failure', true)] },
      { provenance: 'tool', body: [w5a2Result('e3', 'Exit code 3\n   \n', true)] },
      { provenance: 'tool', body: [w5a2Result('e4', 'error: this result is not marked as an error', false)] },
      { provenance: 'tool', body: [w5a2Result('e5', [w5a2Text('Exit code 1'), w5a2Text('npm ERR! missing script: lint')], true)] },
    ]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.filter((c) => c.kind === 'error').map((c) => [c.fact, c.fact_raw])).toEqual([
      ['fatal: not a git repository (or any parent)', '  fatal:   not a git repository (or any parent)'],
      ['npm ERR! missing script: lint', 'npm ERR! missing script: lint'],
    ]);
    expect([r.counts['error-length'], r.counts['error-no-line']]).toEqual([1, 1]);
    const first = r.candidates.find((c) => c.kind === 'error')!;
    expect(first.leaf.text).toBe('Exit code 1\n\n  fatal:   not a git repository (or any parent)\nmore');
    expect(first.producer).toEqual({ state: 'paired', backend: 'anthropic', tool_use_uuid: sp.rows[0]!.uuid });
    expect(first.pair).toEqual({ name: 'Bash', input: { text: '{"command":"npm run check-e1"}', rawLen: 30 } });
  });

  it.each(['operator', 'summary', 'harness', 'ccrc-injected', 'recall-echo'])('W2-D65 never mined: the %s row, whatever its body holds, and its body is never picked', (prov) => {
    const sp = w5a2Span([{ provenance: prov, body: [
      w5a2Text('commit 9f3e2d1 at /home/u/tree/src/app.ts'),
      w5a2Use('o1', 'Read', { file_path: '/home/u/tree/src/app.ts' }),
      w5a2Result('o1', 'see 9f3e2d1 and a long enough failure line here', true),
    ] }]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates).toEqual([]);
    expect(sp.picked).toEqual([]);
  });

  it('W2-D65 never mined: a synthetic assistant row, and a path an operator row names in its text', () => {
    const sp = w5a2Span([
      { provenance: 'model', model: '<synthetic>', body: [w5a2Text('commit 9f3e2d1'), w5a2Use('s1', 'Read', { file_path: '/home/u/tree/a.ts' })] },
      { provenance: 'operator', body: [w5a2Text('please open /home/u/tree/src/app.ts')] },
      { provenance: 'model', body: [w5a2Use('s2', 'Read', { file_path: '/home/u/tree/src/b.ts' })] },
    ]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.map((c) => [c.kind, c.fact])).toEqual([['path', '/home/u/tree/src/b.ts']]);
    expect(sp.picked).toEqual([sp.rows[2]!.entry_id]);
  });

  // ── the producer and its pairing (W2-D65) ──
  it('W2-D65 producer: a tool_result answering a gateway tool_use is dropped as producer-other, CONTROL the same result answering an anthropic one passes', () => {
    const run = (useModel: string) => {
      const sp = w5a2Span([
        { provenance: 'model', model: useModel, body: [w5a2Use('g1', 'Bash', { command: 'git rev-parse HEAD' })] },
        { provenance: 'model', model: W5A2_CLAUDE, body: [w5a2Text('checking the head')] },
        { provenance: 'tool', body: [w5a2Result('g1', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')] },
      ]);
      return { sha: w5a2MinedOf(w5a2Mine(sp)).candidates.find((c) => c.kind === 'sha')!, sp };
    };
    const gw = run(W5A2_GATEWAY);
    expect(gw.sha.producer).toEqual({ state: 'paired', backend: 'other', tool_use_uuid: gw.sp.rows[0]!.uuid });
    expect(screen(gw.sha)).toEqual({ state: 'drop', reason: 'producer-other' });
    expect(screen(run(W5A2_CLAUDE).sha), 'CONTROL: an anthropic tool_use').toEqual({ state: 'pass' });
  });

  it('W2-D65 pairing: a tool_result row with a NULL source_tool_use_id but a paired block id is mined and passes, and the block id wins over the column', () => {
    const sp = w5a2Span([
      { provenance: 'model', body: [w5a2Use('n1', 'Bash', { command: 'git log -1 --format=%H' })] },
      { provenance: 'model', model: W5A2_GATEWAY, body: [w5a2Use('n2', 'Bash', { command: 'git log -2 --format=%H' })] },
      { provenance: 'tool', source_tool_use_id: null, body: [w5a2Result('n1', '0123456789abcdef0123456789abcdef01234567')] },
      { provenance: 'tool', source_tool_use_id: 'n1', body: [w5a2Result('n2', '89abcdef0123456789abcdef0123456789abcdef')] },
    ]);
    const shas = w5a2MinedOf(w5a2Mine(sp)).candidates.filter((c) => c.kind === 'sha');
    expect(shas.map((c) => [c.fact, c.producer])).toEqual([
      ['0123456789abcdef0123456789abcdef01234567', { state: 'paired', backend: 'anthropic', tool_use_uuid: sp.rows[0]!.uuid }],
      ['89abcdef0123456789abcdef0123456789abcdef', { state: 'paired', backend: 'other', tool_use_uuid: sp.rows[1]!.uuid }],
    ]);
    expect(shas.map((c) => screen(c))).toEqual([{ state: 'pass' }, { state: 'drop', reason: 'producer-other' }]);
  });

  it('W2-D65 pairing: a result whose tool_use is outside the span or written after it is result-unpaired, as the sweep pairs in file order', () => {
    const outside = w5a2Span([{ provenance: 'tool', body: [w5a2Result('x1', 'fixed in 9f3e2d1')] }]);
    const later = w5a2Span([
      { provenance: 'tool', body: [w5a2Result('x2', 'fixed in 9f3e2d1')] },
      { provenance: 'model', body: [w5a2Use('x2', 'Bash', { command: 'git show --stat HEAD' })] },
    ]);
    for (const sp of [outside, later]) {
      const sha = w5a2MinedOf(w5a2Mine(sp)).candidates.find((c) => c.kind === 'sha')!;
      expect(sha.producer).toEqual({ state: 'unpaired' });
      expect(sha.pair).toBeNull();
      expect(screen(sha)).toEqual({ state: 'drop', reason: 'result-unpaired' });
    }
  });

  it('W2-D65: the driver never reads the source_tool_use_id column, CONTROL the pattern sees a planted read', () => {
    const COLUMN = /source_tool_use_id|sourceToolUseID/;
    const code = (t: string): string[] => t.split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l) && COLUMN.test(l));
    expect(code('      const first = row.source_tool_use_id ?? undefined;')).toHaveLength(1);
    expect(code(w5a2Read(DRIVER_URL, 'utf8'))).toEqual([]);
  });

  // ── the body pick (W2-D74 through W2-D65) ──
  it.each(['tombstone', 'over-cap', 'undecodable', 'unparseable'])('W2-D74 via W2-D65: a mined row whose body pick answers %s discards the boundary by its own word', (state) => {
    const sp = w5a2Span([{ provenance: 'model', body: [w5a2Text('commit 9f3e2d1')] }, { provenance: 'model', state, body: null }]);
    expect(w5a2Mine(sp)).toMatchObject({ state: 'discard', why: `span-${state}`, boundaryUuid: 'fixture-boundary' });
  });

  it('W2-D65: a body pick state outside expandEntryBody words is a defect that throws, never a discard word', () => {
    expect(() => w5a2Mine(w5a2Span([{ provenance: 'model', state: 'mystery', body: null }]))).toThrow(/body pick state/);
  });

  it('D-6303: a mined tool_use input nested 5,000 deep cannot be rendered and discards the boundary as body-unrenderable; CONTROL: 4,000 deep mines normally', () => {
    // Built at runtime: a body that parses (far inside lib's JSON_DEPTH_MAX) but overflows V8's JSON.stringify stack.
    const nested = (levels: number): unknown => {
      let v: unknown = 'leaf';
      for (let i = 0; i < levels; i += 1) v = { a: v };
      return v;
    };
    const body = (levels: number) => [w5a2Use('deep1', 'Bash', { command: 'npm run build:all', nest: nested(levels) })];
    expect(w5a2Mine(w5a2Span([{ provenance: 'model', body: body(5000) }]))).toMatchObject({
      state: 'discard', why: 'body-unrenderable', boundaryUuid: 'fixture-boundary',
    });
    const ok = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: body(4000) }])));
    expect(ok.candidates.map((c) => [c.kind, c.fact])).toEqual([['command', 'npm run build:all']]);
    expect(w5a2Drv.RECON_DISCARDS).toContain('body-unrenderable');
  });

  it('W2-D65 CONTROL: an unmined row whose body is pruned never discards the boundary and is never picked', () => {
    const sp = w5a2Span([{ provenance: 'operator', state: 'tombstone', body: null }, { provenance: 'model', body: [w5a2Text('commit 9f3e2d1')] }]);
    const r = w5a2MinedOf(w5a2Mine(sp));
    expect(r.candidates.map((c) => c.fact)).toEqual(['9f3e2d1']);
    expect(sp.picked).toEqual([sp.rows[1]!.entry_id]);
  });

  it('W2-D65: kind and fact are deduplicated within a family, the earliest boundary first and file order within it, and another kind with the same text is kept', () => {
    const body = (extra: unknown[]) => [w5a2Text('commit 9f3e2d1'), w5a2Use('d1', 'Bash', { command: 'npm run test' }), ...extra];
    const mine = (uuid: string, ts: number, sp: ReturnType<typeof w5a2Span>) => w5a2MinedOf(w5a2Mine(sp, { boundaryUuid: uuid, boundaryTsMs: ts }));
    const early = mine('b-early', 100, w5a2Span([{ provenance: 'model', body: body([w5a2Text('again 9f3e2d1')]) }]));
    const late = mine('b-late', 200, w5a2Span([
      { provenance: 'model', body: body([w5a2Use('d2', 'Read', { file_path: '/home/u/tree/src/app.ts' })]) },
      { provenance: 'tool', body: [w5a2Result('d2', '/home/u/tree/src/app.ts', true)] },
    ]));
    const counts = w5a2Drv.newDropCounts();
    const kept = w5a2Drv.dedupeFamily([late, early], counts);
    expect(kept.map((c) => [c.boundary_uuid, c.kind, c.fact])).toEqual([
      ['b-early', 'sha', '9f3e2d1'], ['b-early', 'command', 'npm run test'],
      ['b-late', 'path', '/home/u/tree/src/app.ts'], ['b-late', 'error', '/home/u/tree/src/app.ts'],
    ]);
    expect(counts.duplicate).toBe(3);
  });

  // ── the redaction discard (W2-D67) ──
  it('W2-D67: a synthetic key-shaped fact assembled at runtime is discarded first as redact-fact, for a command and for an error line, and counted without its value', () => {
    const key = w5a2Akia();
    const sp = w5a2Span([
      { provenance: 'model', body: [w5a2Use('k1', 'Bash', { command: `aws configure set aws_access_key_id ${key}` })] },
      { provenance: 'tool', body: [w5a2Result('k1', `InvalidClientTokenId: key ${key} rejected`, true)] },
    ]);
    const cands = w5a2MinedOf(w5a2Mine(sp)).candidates;
    expect(cands.map((c) => c.kind)).toEqual(['command', 'error']);
    const counts = w5a2Drv.newDropCounts();
    for (const c of cands) {
      const s = screen(c);
      expect(s).toEqual({ state: 'drop', reason: 'redact-fact' });
      w5a2Drv.noteDrop(counts, (s as { reason: string }).reason);
    }
    expect(counts['redact-fact']).toBe(2);
    expect(JSON.stringify(counts), 'counts carry words, never a value').not.toMatch(new RegExp(`${key.slice(0, 4)}|${key.slice(4)}`));
  });

  it('W2-D67: a fact intact alone but masked inside the leaf it was mined from is discarded as redact-leaf', () => {
    const leaf = `rotate key ${['sk', 'a1b2c3d4e5f6'].join('-')} now`;
    const r = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Text(leaf)] }])));
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0]!;
    expect(c).toMatchObject({ kind: 'sha', fact_raw: 'a1b2c3d4e5f6', leaf: { text: leaf } });
    expect(w5a2Lib.redactField(c.fact_raw, W5A2_IDX0), 'CONTROL: the fact alone is not masked').toBe('a1b2c3d4e5f6');
    expect(w5a2Lib.redactField(leaf, W5A2_IDX0), 'CONTROL: its leaf masks it').not.toContain('a1b2c3d4e5f6');
    expect(screen(c)).toEqual({ state: 'drop', reason: 'redact-leaf' });
  });

  it('W2-D67 (R10, F6): a whitespace-split bearer token leaves F_raw intact under redaction but not F, and is discarded as redact-fact; CONTROL: the same split command with no Authorization header passes', () => {
    // The token is assembled at runtime. A newline splits the header from its value, so lib's bearer rule ([ \t]+ only)
    // misses F_raw; collapseWs joins them in F, which the rule masks.
    const tok = ['zq', 'w5a2', 'bearer', 'value'].join('');
    const split = `curl -H "Authorization: Bearer\n${tok}" https://api.example.test/v1`;
    const plain = `curl -H "Accept: text/plain"\n${tok} https://api.example.test/v1`;
    const cands = w5a2MinedOf(w5a2Mine(w5a2Span([
      { provenance: 'model', body: [w5a2Use('f6', 'Bash', { command: split })] },
      { provenance: 'model', body: [w5a2Use('f7', 'Bash', { command: plain })] },
    ]))).candidates.filter((x) => x.kind === 'command');
    expect(cands.map((x) => x.fact_raw)).toEqual([split, plain]);
    const [c, ctl] = [cands[0]!, cands[1]!];
    expect(c.fact, 'F joins the header and its value').toBe(`curl -H "Authorization: Bearer ${tok}" https://api.example.test/v1`);
    expect(w5a2Lib.redactField(c.fact_raw, W5A2_IDX0), 'CONTROL: F_raw alone is not masked, so an F_raw-only screen passes it').toBe(c.fact_raw);
    expect(w5a2Lib.redactField(c.leaf.text, W5A2_IDX0), 'CONTROL: nor is its leaf, so redact-leaf does not fire').toContain(c.fact_raw);
    expect(w5a2Lib.redactField(c.fact, W5A2_IDX0), 'CONTROL: F is masked').not.toContain(tok);
    expect(w5a2Drv.screenRedaction(c, W5A2_IDX0)).toBe('redact-fact');
    expect(screen(c)).toEqual({ state: 'drop', reason: 'redact-fact' });
    expect(w5a2Lib.redactField(ctl.fact, W5A2_IDX0), 'CONTROL: the header-less command\'s F is not masked').toBe(ctl.fact);
    expect(w5a2Drv.screenRedaction(ctl, W5A2_IDX0), 'CONTROL: so it passes the screen').toBeNull();
  });

  it('W2-D67: an F_raw the redaction masks under an F it does not (a relative path through a registered value, resolved away) is discarded as redact-fact, never redact-leaf', () => {
    // W2-D67's first clause alone: the AKIA cases fire both clauses (F equals F_raw) and the bearer case only the F
    // clause. The value is assembled at runtime and registered in this case's own pair index; path.posix.resolve
    // removes it from F.
    const secret = ['zq', 'w5a2', 'fraw', 'pathvalue'].join('');
    const idx = w5a2Lib.makePairIndex([{ len: secret.length, sha256: w5a2Lib.sha256Hex(secret) }]);
    const raw = `${secret}/../src/app.ts`;
    const cands = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Use('fr1', 'Read', { file_path: raw })] }]))).candidates;
    expect(cands.map((x) => [x.kind, x.fact, x.fact_raw])).toEqual([['path', '/home/u/tree/src/app.ts', raw]]);
    const c = cands[0]!;
    expect(w5a2Lib.redactField(c.fact_raw, idx), 'CONTROL: F_raw is masked').not.toContain(secret);
    expect(w5a2Lib.redactField(c.fact, idx), 'CONTROL: F, resolved past the value, is not').toBe(c.fact);
    expect(w5a2Lib.redactField(c.leaf.text, idx), 'CONTROL: the redacted leaf no longer holds F_raw, so redact-leaf is the next word').not.toContain(c.fact_raw);
    expect(w5a2Drv.screenRedaction(c, idx)).toBe('redact-fact');
    expect(w5a2Drv.screenCandidate(c, { idx, baselineText: '' })).toEqual({ state: 'drop', reason: 'redact-fact' });
  });

  it('W2-D67 order CONTROL: redaction runs before admission, so a masked fact that B also holds is counted redact-fact, never baseline-hit', () => {
    const command = `aws configure set aws_access_key_id ${w5a2Akia()}`;
    const c = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Use('o1', 'Bash', { command })] }]))).candidates[0]!;
    const baselineText = `notes\n${command}`;
    expect(w5a2Gate.admitFact('command', c.fact, baselineText, '', { repoRoots: [] }).admitted, 'CONTROL: B holds the fact').toBe(false);
    expect(w5a2Drv.screenCandidate(c, { idx: W5A2_IDX0, baselineText })).toEqual({ state: 'drop', reason: 'redact-fact' });
  });

  it('W2-D67: admission compares unredacted F against unredacted B, so a fact B holds only inside a masked value is still rejected', () => {
    const secret = ['9f3e2d1', 'Q7mZx4Kp', 'W3n6Z5r1H8t2'].join('');
    const idx = w5a2Lib.makePairIndex([{ len: secret.length, sha256: w5a2Lib.sha256Hex(secret) }]);
    const r = w5a2MinedOf(w5a2Mine(w5a2Span([{ provenance: 'model', body: [w5a2Text('cherry-pick 9f3e2d1 onto main')] }])));
    expect(r.candidates).toHaveLength(1);
    const baselineText = `token was ${secret} yesterday`;
    expect(w5a2Lib.redactField(baselineText, idx), 'CONTROL: redaction would hide the fact from B').not.toContain('9f3e2d1');
    expect(w5a2Drv.screenCandidate(r.candidates[0]!, { idx, baselineText })).toEqual({ state: 'drop', reason: 'baseline-hit' });
  });

  it('W2-D67, R5: drop counts carry reason words only, each starting at 0, and a word outside FACT_DROP_REASONS throws; the two driver-local lists are disjoint from each other and from DRIVER_REASONS and GATE_REASONS', () => {
    // This task's fourteen come first; Tasks 5 and 6 append their fact drops after them, in place, each pinning its slice.
    expect(w5a2Drv.FACT_DROP_REASONS.slice(0, 14)).toEqual([
      'path-no-cwd', 'path-tilde', 'path-config-dir', 'command-recall', 'command-length', 'error-no-line', 'error-length',
      'duplicate', 'redact-fact', 'redact-leaf', 'result-unpaired', 'producer-other', 'producer-unknown', 'baseline-hit',
    ]);
    expect(w5a2Drv.RECON_DISCARDS.slice(14, 18), 'the span words, appended to Task 1\'s list').toEqual(['span-unparseable', 'span-tombstone', 'span-over-cap', 'span-undecodable']);
    expect(w5a2Drv.RECON_DISCARDS.at(-1), "body-unrenderable (D-6302) stays last, so a task that inserts words keeps it there").toBe('body-unrenderable');
    expect(Object.isFrozen(w5a2Drv.FACT_DROP_REASONS)).toBe(true);
    expect(new Set(w5a2Drv.FACT_DROP_REASONS).size).toBe(w5a2Drv.FACT_DROP_REASONS.length);
    // R5 as amended by R10: only the pairs that involve a drop list are pinned. DRIVER_REASONS and GATE_REASONS already
    // share three words at the base (W2-3's and W2-4's), so that pair is never pinned; QUOTA_SKIPS is a report list.
    expect(w5a2Drv.FACT_DROP_REASONS.filter((w) => w5a2Drv.DRIVER_REASONS.includes(w)), 'a drop is a count, not a refusal').toEqual([]);
    expect(w5a2Drv.FACT_DROP_REASONS.filter((w) => (w5a2Gate.GATE_REASONS as readonly string[]).includes(w)), 'one spelling per word').toEqual([]);
    expect(w5a2Drv.FACT_DROP_REASONS.filter((w) => (w5a2Drv.RECON_DISCARDS as readonly string[]).includes(w)), 'a fact drop is not a boundary discard').toEqual([]);
    const counts = w5a2Drv.newDropCounts();
    expect(Object.keys(counts)).toEqual([...w5a2Drv.FACT_DROP_REASONS]);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(() => w5a2Drv.noteDrop(counts, 'not-a-reason')).toThrow(/^noteDrop: /);
    expect(Object.keys(counts)).toEqual([...w5a2Drv.FACT_DROP_REASONS]);
  });

  it('W2-D61 and W2-D67: the driver imports collapseWs and lib redaction and declares no copy of either, CONTROL planted copies are seen', () => {
    const COPY = /^\s*(?:export\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+)(collapseWs|FACT_KINDS|SECRET_SHAPE_RES|redact(?!ForSpawn\b)[A-Za-z]*)\b/;
    const copies = (t: string): string[] => t.split('\n').filter((l) => COPY.test(l));
    // The FACT_KINDS line is built from parts, as measure-history.test.ts's OWN_WORDS are: W2-D12's scan there reads
    // every server/test file and is not anchored to a line start, so a whole planted declaration would be a second holder.
    for (const planted of ['function collapseWs(s) {', `export const ${'FACT' + '_KINDS'} = Object.freeze([]);`, 'const redactLeaf = (t) => t;',
      'export function redactField(text, idx) {', 'const SECRET_SHAPE_RES = [];']) expect(copies(planted), planted).toHaveLength(1);
    expect(copies('export function redactForSpawn(field, idx) {'), "W2-4's door is lib's redactField behind the decode cap").toEqual([]);
    const src = w5a2Read(DRIVER_URL, 'utf8');
    expect(copies(src)).toEqual([]);
    expect(src).toMatch(/^import \{[^}]*\bcollapseWs\b[^}]*\} from '\.\/history-gate\.mjs';$/m);
    expect(src).toMatch(/^import \{[^}]*\bredactField\b[^}]*\} from '\.\.\/ccd\/history\/lib\.mjs';$/m);
  });

  it('W2-D65: rosterConfigDirs lists every rostered account config dir under HOME, hidden ones included, once each and sorted', () => {
    const roster = rosterFromJson({ version: 1, accounts: FIXTURE_ACCOUNTS });
    expect(w5a2Drv.rosterConfigDirs(roster, '/home/u')).toEqual([
      '/home/u/.claude', '/home/u/.cx-a', '/home/u/.ext-a', '/home/u/.ext-n', '/home/u/.gen-a', '/home/u/.gen-d',
      '/home/u/.gen-h', '/home/u/.gen-m', '/home/u/.gen-o', '/home/u/.gen-r', '/home/u/.gen-s', '/home/u/.gen-u',
    ]);
  });
});

// ── W2-5a Task 3: boundary admission (W2-D66; spec §10.2 RP5 with the straddle and two-copy CONTROLs; D-5771) ──────
// In-process only: no case spawns a child, so no claude, ccrc or gh is reached, and no account or roster is read. The
// pure cases build copies in memory; the store cases plant a store with store.mjs's own createStore under a mkTmp
// HOME, close the writer, and hand admission a handle from store.mjs's openReader, the route W2-D51 names. Models:
// claude-fixture-4 (anthropic), gpt-fixture-5 (a gateway) and Claude Code's own `<synthetic>`.
// The W5A3_ and w5a3 declarations are MODULE-LEVEL: later W2-5a tasks build their copies and stores with them.
import * as w5a3Drv from '../../deploy/history-replay.mjs';
import * as w5a3Store from '../../ccd/history/store.mjs';
import * as w5a3Lib from '../../ccd/history/lib.mjs';
import { mkTmp as w5a3MkTmp } from './tmpHelpers.js';

const W5A3_CLAUDE = 'claude-fixture-4';
const W5A3_GATEWAY = 'gpt-fixture-5';
const W5A3_SYNTH = '<synthetic>';
/** One copy row with the columns admission reads (entries joined through memberships, in file order). */
type W5a3Row = { uuid: string; type: string; model: string | null; provenance: string; is_compact_summary: number };
/** A uuid in the fixture shape: an 8-hex seed, then a 12-hex counter. */
const w5a3Uid = (seed: number, n: number): string => `${seed.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const w5a3Op = (uuid: string): W5a3Row => ({ uuid, type: 'user', model: null, provenance: 'operator', is_compact_summary: 0 });
const w5a3Asst = (uuid: string, model: string | null): W5a3Row => ({ uuid, type: 'assistant', model, provenance: 'model', is_compact_summary: 0 });
interface W5a3Copy { rows: W5a3Row[]; boundary: string; summary: string; bi: number; si: number }
/** One copy in the manual shape, reduced to what admission reads. It holds an operator row before each `before`
 *  model's assistant row, the operator's /compact row, the boundary, its summary (the anchor), then an operator row
 *  before each `after` model's assistant row. The head, up to the summary, is minted from `seed`. The rows after the
 *  summary are minted from `tailSeed`, counted from 0x1001. So two copies of one transcript share their head
 *  (boundary and summary included) and part after the summary. `noSummary` leaves the summary row out: the anchor then
 *  names a uuid the copy does not hold (DM25's shape). */
function w5a3Copy(before: Array<string | null>, after: Array<string | null>,
  o: { seed?: number; tailSeed?: number; noSummary?: boolean } = {}): W5a3Copy {
  const seed = o.seed ?? 0xa3;
  const tailSeed = o.tailSeed ?? seed;
  const rows: W5a3Row[] = [];
  let n = 0;
  let m = 0;
  const head = (): string => { n += 1; return w5a3Uid(seed, n); };
  const tail = (): string => { m += 1; return w5a3Uid(tailSeed, 0x1000 + m); };
  for (const model of before) {
    rows.push(w5a3Op(head()));
    rows.push(w5a3Asst(head(), model));
  }
  rows.push(w5a3Op(head()));
  const boundary = head();
  rows.push({ uuid: boundary, type: 'system', model: null, provenance: 'harness', is_compact_summary: 0 });
  const summary = head();
  if (o.noSummary !== true) rows.push({ uuid: summary, type: 'user', model: null, provenance: 'summary', is_compact_summary: 1 });
  for (const model of after) {
    rows.push(w5a3Op(tail()));
    rows.push(w5a3Asst(tail(), model));
  }
  return { rows, boundary, summary, bi: rows.findIndex((r) => r.uuid === boundary), si: rows.findIndex((r) => r.uuid === summary) };
}

interface W5a3PlantSession { pk: number; ccrcId: string; generation: string; mergedInto?: number; epochs: Array<{ ccUuid: string; confirmed: boolean }> }
interface W5a3PlantTranscript {
  pk: number; ccUuid: string; agentId?: string; files: Array<{ fileId: number; sourceKey?: string; rows: W5a3Row[] }>;
  boundary: string; anchor: string; tsNull?: boolean; unheld?: boolean;
}
/** A store made by store.mjs's createStore under a fresh mkTmp HOME, planted in one transaction, and closed. It
 *  answers the HOME and the db file. Each transcript has one boundary (ord 1). A uuid is one entry per transcript, and every file
 *  that lists it is a membership at its row's line (1-based), so two copies share their head entries. `tsNull` stores
 *  the boundary's ts_ms as NULL. `unheld` leaves the boundary row's membership out of every file, so no copy holds
 *  it. Every other entry is stamped 1 s after the one before. The sessions' epochs take seq 1, 2, … in list order. */
function w5a3PlantStore(sessions: W5a3PlantSession[], transcripts: W5a3PlantTranscript[]): { home: string; dbFile: string } {
  const home = w5a3MkTmp('ccrc-replay-w5a3-');
  w5a3Store.createStore(home);
  const dbFile = w5a3Lib.historyPaths(home).dbFile;
  const db = w5a3Store.openWriter(dbFile);
  try {
    db.exec('BEGIN');
    db.prepare("INSERT INTO blobs (blob_id, sha256, codec, z, raw_len) VALUES (1, ?, 'br5', ?, 1)").run(Buffer.alloc(32, 0xa3), Buffer.from([0]));
    const ses = db.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms, merged_into) VALUES (?, ?, ?, 'demo', 1, ?)");
    const ep = db.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, ?, ?, 'startup', 'hook', ?)");
    for (const s of sessions) ses.run(s.pk, s.ccrcId, s.generation, s.mergedInto ?? null);
    for (const s of sessions) s.epochs.forEach((e, i) => { ep.run(s.pk, i + 1, e.ccUuid, e.confirmed ? 1 : null); });
    const tr = db.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid, agent_id) VALUES (?, ?, ?)');
    const file = db.prepare("INSERT INTO ingest_files (file_id, dev, ino, source_key, transcript_pk, status, parser_version) VALUES (?, 1, ?, ?, ?, 'live', 1)");
    const ent = db.prepare('INSERT INTO entries (uuid, transcript_pk, type, model, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, is_compact_summary) VALUES (?, ?, ?, ?, ?, 1, 0, 0, 1, ?, ?)');
    const mem = db.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
    const bnd = db.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, anchor_uuid) VALUES (?, ?, 1, ?)');
    let ts = 1_000;
    for (const t of transcripts) {
      tr.run(t.pk, t.ccUuid, t.agentId ?? '');
      const ids = new Map<string, number>();
      for (const f of t.files) {
        file.run(f.fileId, 9000 + f.fileId, f.sourceKey ?? '', t.pk);
        f.rows.forEach((r, i) => {
          let id = ids.get(r.uuid);
          if (id === undefined) {
            ts += 1000;
            const stamp = t.tsNull === true && r.uuid === t.boundary ? null : ts;
            id = Number(ent.run(r.uuid, t.pk, r.type, r.model, r.provenance, stamp, r.is_compact_summary).lastInsertRowid);
            ids.set(r.uuid, id);
          }
          if (!(t.unheld === true && r.uuid === t.boundary)) mem.run(f.fileId, id, i + 1);
        });
      }
      bnd.run(ids.get(t.boundary)!, t.pk, t.anchor);
    }
    db.exec('COMMIT');
  } finally {
    w5a3Store.closeWriter(db);
  }
  return { home, dbFile };
}

describe('W2-5a Task 3: RP5 over one copy, admitBoundary (W2-D66)', () => {
  const CL = W5A3_CLAUDE;
  const GW = W5A3_GATEWAY;
  const SY = W5A3_SYNTH;
  const verdictOf = (c: W5a3Copy) => w5a3Drv.admitBoundary(c.rows, c.bi, c.si);
  const ADMITTED = { admitted: true, reason: null, before: 'anthropic', after: 'anthropic' };

  it('CONTROL: anthropic rows on both sides are admitted', () => {
    expect(verdictOf(w5a3Copy([CL, CL], [CL]))).toEqual(ADMITTED);
  });

  it('RP5: a gateway row as the last real assistant row before the boundary is not admitted, whatever came before it', () => {
    expect(verdictOf(w5a3Copy([CL, GW], [CL]))).toEqual({ admitted: false, reason: 'before-other', before: 'other', after: 'anthropic' });
  });

  it('RP5: the anthropic-to-gateway straddle, anthropic rows before and a gateway row after the summary, is not admitted', () => {
    expect(verdictOf(w5a3Copy([CL, CL], [GW, CL]))).toEqual({ admitted: false, reason: 'after-other', before: 'anthropic', after: 'other' });
  });

  it('RP5: a synthetic row before the boundary is skipped, and the boundary is judged by the real row before it', () => {
    expect(verdictOf(w5a3Copy([CL, SY], [CL]))).toEqual(ADMITTED);
    expect(verdictOf(w5a3Copy([GW, SY], [CL]))).toEqual({ admitted: false, reason: 'before-other', before: 'other', after: 'anthropic' });
  });

  it('RP5: a synthetic row after the summary is skipped, and the boundary is judged by the real row after it', () => {
    expect(verdictOf(w5a3Copy([CL], [SY, CL]))).toEqual(ADMITTED);
    expect(verdictOf(w5a3Copy([CL], [SY, GW]))).toEqual({ admitted: false, reason: 'after-other', before: 'anthropic', after: 'other' });
  });

  it('a model-less assistant row is skipped on either side, as lib.backendOf reads it unknown', () => {
    expect(verdictOf(w5a3Copy([CL, null], [null, CL]))).toEqual(ADMITTED);
  });

  it('with no real assistant row on a side, that side is unknown and the boundary is not admitted', () => {
    expect(verdictOf(w5a3Copy([], [CL]))).toEqual({ admitted: false, reason: 'before-unknown', before: 'unknown', after: 'anthropic' });
    expect(verdictOf(w5a3Copy([CL], [SY]))).toEqual({ admitted: false, reason: 'after-unknown', before: 'anthropic', after: 'unknown' });
  });

  it('both sides failing: the reason names the before side, tested first', () => {
    expect(verdictOf(w5a3Copy([GW], [GW]))).toEqual({ admitted: false, reason: 'before-other', before: 'other', after: 'other' });
  });

  it('only assistant rows are witnesses before the boundary, as lib.producerOfCopy reads after it', () => {
    const c = w5a3Copy([CL], [CL]);
    const rows = c.rows.map((r, i) => (i === c.bi - 1 ? { ...r, model: GW } : r));
    expect(rows[c.bi - 1]!.type, 'CONTROL: the row carrying a gateway model is the operator\'s /compact row').toBe('user');
    expect(w5a3Drv.admitBoundary(rows, c.bi, c.si)).toEqual(ADMITTED);
  });

  it('the after side starts at the summary row, as derive.mjs leafFields reads the producer: a gateway row between the boundary and its summary is no witness', () => {
    const c = w5a3Copy([CL], [CL]);
    const rows = [...c.rows.slice(0, c.bi + 1), w5a3Asst(w5a3Uid(0xa3, 0x2001), GW), ...c.rows.slice(c.bi + 1)];
    expect(rows[c.si + 1]!.is_compact_summary, 'CONTROL: the summary moved one row down').toBe(1);
    expect(w5a3Drv.admitBoundary(rows, c.bi, c.si + 1)).toEqual(ADMITTED);
  });

  it('an index outside the copy is a defect: TypeError, never a verdict', () => {
    const c = w5a3Copy([CL], [CL]);
    for (const [b, s] of [[-1, c.si], [c.bi, c.rows.length], [1.5, c.si], [c.bi, Number.NaN]] as Array<[number, number]>) {
      expect(() => w5a3Drv.admitBoundary(c.rows, b, s), `${b}, ${s}`).toThrow(/is not a row of the copy/);
    }
  });

  it('R6: the before witness is not bounded by the previous boundary: with no assistant row between two boundaries, the second is judged by the real row before the first', () => {
    const c = w5a3Copy([CL], []);
    const boundary2 = w5a3Uid(0xa3, 0x4001);
    const summary2 = w5a3Uid(0xa3, 0x4002);
    const rows: W5a3Row[] = [
      ...c.rows,
      w5a3Op(w5a3Uid(0xa3, 0x4000)),
      { uuid: boundary2, type: 'system', model: null, provenance: 'harness', is_compact_summary: 0 },
      { uuid: summary2, type: 'user', model: null, provenance: 'summary', is_compact_summary: 1 },
      w5a3Op(w5a3Uid(0xa3, 0x4003)),
      w5a3Asst(w5a3Uid(0xa3, 0x4004), CL),
    ];
    const bi2 = rows.findIndex((r) => r.uuid === boundary2);
    const si2 = rows.findIndex((r) => r.uuid === summary2);
    expect(rows.slice(c.si + 1, bi2).some((r) => r.type === 'assistant'), 'CONTROL: no assistant row between the two boundaries').toBe(false);
    expect(w5a3Drv.admitBoundary(rows, bi2, si2)).toEqual(ADMITTED);
  });
});

describe('W2-5a Task 3: the summary row is lib.summaryRowFor\'s pick, summaryIndexOf (W2-D66)', () => {
  const CL = W5A3_CLAUDE;
  const summaryLike = (uuid: string, provenance: string): W5a3Row => ({ uuid, type: 'user', model: null, provenance, is_compact_summary: 1 });

  it('the anchored summary row: its index in the copy', () => {
    const c = w5a3Copy([CL], [CL]);
    expect(w5a3Drv.summaryIndexOf(c.rows, c.boundary, c.summary)).toBe(c.si);
  });

  it('an anchor the copy does not hold is -1, though a compact summary row follows the boundary', () => {
    const c = w5a3Copy([CL], [CL]);
    const rows = c.rows.map((r) => (r.uuid === c.summary ? summaryLike(w5a3Uid(0xa3, 0x3001), 'summary') : r));
    expect(rows.some((r, i) => i > c.bi && r.is_compact_summary === 1), 'CONTROL: a compact summary row follows the boundary').toBe(true);
    expect(w5a3Drv.summaryIndexOf(rows, c.boundary, c.summary)).toBe(-1);
  });

  it('an anchor that names a harness echo row is -1, as derive.mjs copyPlan marks an echo', () => {
    const c = w5a3Copy([CL], [CL]);
    const rows = c.rows.map((r) => (r.uuid === c.summary ? { ...r, provenance: 'harness' } : r));
    expect(w5a3Drv.summaryIndexOf(rows, c.boundary, c.summary)).toBe(-1);
  });

  it('an anchor naming the boundary itself takes the first compact summary row after it that is no echo', () => {
    const c = w5a3Copy([CL], [CL]);
    const rows = [...c.rows.slice(0, c.bi + 1), summaryLike(w5a3Uid(0xa3, 0x3002), 'harness'), ...c.rows.slice(c.bi + 1)];
    expect(w5a3Drv.summaryIndexOf(rows, c.boundary, c.boundary)).toBe(c.si + 1);
  });
});

describe('W2-5a Task 3: the population over a planted store, admitStoreBoundaries (W2-D66)', () => {
  const CL = W5A3_CLAUDE;
  const GW = W5A3_GATEWAY;
  const cc = (k: number): string => w5a3Uid(0xcc, k);
  const gen = (k: number): string => w5a3Uid(0x5e5, k);
  const T3_HELD = w5a3Copy([CL, CL], [GW], { seed: 3, tailSeed: 0x31 });
  const T3_LONG = w5a3Copy([CL, CL], [CL, CL, CL], { seed: 3, tailSeed: 0x32 });
  const T4_HELD = w5a3Copy([CL], [CL], { seed: 4, tailSeed: 0x41 });
  const T4_LONG = w5a3Copy([CL], [GW, GW, GW], { seed: 4, tailSeed: 0x42 });
  const T10_RETIRED = w5a3Copy([CL], [CL], { seed: 0xa, tailSeed: 0xa1 });
  const T10_LIVE = w5a3Copy([CL], [GW], { seed: 0xa, tailSeed: 0xa2 });
  const one = (pk: number, c: W5a3Copy, fileId: number, extra: Partial<W5a3PlantTranscript> = {}): W5a3PlantTranscript =>
    ({ pk, ccUuid: cc(pk), files: [{ fileId, rows: c.rows }], boundary: c.boundary, anchor: c.summary, ...extra });
  const SESSIONS: W5a3PlantSession[] = [
    ...[1, 2, 3, 4, 5, 8, 10, 11].map((k) => ({ pk: k, ccrcId: `claude-a-p${k}`, generation: gen(k), epochs: [{ ccUuid: cc(k), confirmed: true }] })),
    { pk: 6, ccrcId: 'claude-a-p6', generation: gen(6), epochs: [{ ccUuid: cc(6), confirmed: false }] },
    { pk: 9, ccrcId: 'claude-a-p9', generation: gen(9), mergedInto: 1, epochs: [{ ccUuid: cc(9), confirmed: true }] },
    { pk: 12, ccrcId: 'claude-a-other', generation: gen(12), epochs: [{ ccUuid: cc(1), confirmed: true }] },
  ];
  const TRANSCRIPTS: W5a3PlantTranscript[] = [
    one(1, w5a3Copy([CL, CL], [CL], { seed: 1 }), 1),
    one(2, w5a3Copy([CL, GW], [CL], { seed: 2 }), 2),
    { pk: 3, ccUuid: cc(3), files: [{ fileId: 3, rows: T3_HELD.rows }, { fileId: 4, rows: T3_LONG.rows }], boundary: T3_HELD.boundary, anchor: T3_HELD.summary },
    { pk: 4, ccUuid: cc(4), files: [{ fileId: 5, rows: T4_HELD.rows }, { fileId: 6, rows: T4_LONG.rows }], boundary: T4_HELD.boundary, anchor: T4_HELD.summary },
    one(5, w5a3Copy([CL], [CL], { seed: 5 }), 7, { tsNull: true }),
    one(6, w5a3Copy([CL], [CL], { seed: 6 }), 8),
    one(7, w5a3Copy([CL], [CL], { seed: 7 }), 9, { ccUuid: cc(1), agentId: 'a3sub' }),
    one(8, w5a3Copy([CL], [CL], { seed: 8, noSummary: true }), 10),
    one(9, w5a3Copy([CL], [CL], { seed: 9 }), 11),
    { pk: 10, ccUuid: cc(10), files: [{ fileId: 12, sourceKey: 'retired-fixture', rows: T10_RETIRED.rows }, { fileId: 13, rows: T10_LIVE.rows }], boundary: T10_LIVE.boundary, anchor: T10_LIVE.summary },
    one(11, w5a3Copy([CL], [CL], { seed: 0xb }), 14, { unheld: true }),
  ];
  type Result = ReturnType<typeof w5a3Drv.admitStoreBoundaries>;
  let memo: { dbFile: string; res: Result } | null = null;
  /** The planted store and admission's answer over it, through Task 1's store opener as a subcommand opens it, made once;
   *  a throw leaves it unmade, so every case reds. */
  function planted(): { dbFile: string; res: Result } {
    if (memo === null) {
      const { home, dbFile } = w5a3PlantStore(SESSIONS, TRANSCRIPTS);
      const rs = w5a3Drv.openReplayStore(home);
      try {
        memo = { dbFile, res: w5a3Drv.admitStoreBoundaries(rs) };
      } finally {
        rs.close();
      }
    }
    return memo;
  }
  const rowOf = (pk: number) => planted().res.boundaries.find((b) => b.transcript_pk === pk)!;
  /** W1's measure: a copy's membership rows after the boundary row (the window's longest-copy rule, W2-D15). */
  function afterCount(fileId: number, uuid: string): number {
    const db = w5a3Store.openReader(planted().dbFile);
    try {
      return Number((db.prepare(`SELECT count(*) AS n FROM memberships m JOIN memberships mb ON mb.file_id = m.file_id
        JOIN entries e ON e.entry_id = mb.entry_id WHERE m.file_id = ? AND e.uuid = ? AND m.line > mb.line`).get(fileId, uuid) as { n: number }).n);
    } finally {
      db.close();
    }
  }

  it('every main boundary once, in transcript order, with its family and verdict; a subagent transcript\'s boundary is outside the population', () => {
    expect(planted().res.boundaries.map((b) => [b.transcript_pk, b.ccrc_id, b.reason, b.admitted, b.file_id])).toEqual([
      [1, 'claude-a-p1', null, true, 1],
      [2, 'claude-a-p2', 'before-other', false, 2],
      [3, 'claude-a-p3', 'after-other', false, 3],
      [4, 'claude-a-p4', null, true, 5],
      [5, 'claude-a-p5', 'ts-null', false, null],
      [6, null, 'no-epoch', false, null],
      [8, 'claude-a-p8', 'summary-absent', false, 10],
      [9, null, 'no-epoch', false, null],
      [10, 'claude-a-p10', 'after-other', false, 13],
      [11, 'claude-a-p11', 'boundary-uncopied', false, null],
    ]);
    expect(typeof rowOf(1).summary_entry_id, 'R3: the admitted row names the summary row it judged').toBe('number');
    expect(rowOf(5).summary_entry_id, 'a boundary judged before its copy names none').toBeNull();
  });

  it('the counts: admitted and every RECON_DISCARDS word, zeros included', () => {
    const zero = Object.fromEntries(['admitted', ...w5a3Drv.RECON_DISCARDS].map((w) => [w, 0]));
    expect(planted().res.counts).toEqual({
      ...zero, admitted: 2, 'no-epoch': 2, 'ts-null': 1, 'boundary-uncopied': 1, 'summary-absent': 1, 'before-other': 1, 'after-other': 2,
    });
  });

  it('two copies, the straddle CONTROL: the holding copy (live, smaller file_id) straddles and is not admitted, though the copy with the most rows after the boundary is anthropic throughout', () => {
    const t3 = rowOf(3);
    expect(t3).toMatchObject({
      uuid: T3_HELD.boundary, ccrc_id: 'claude-a-p3', generation: gen(3), admitted: false, reason: 'after-other',
      file_id: 3, boundary_index: T3_HELD.bi, summary_index: T3_HELD.si, before: 'anthropic', after: 'other',
    });
    expect(typeof t3.ts_ms).toBe('number');
    expect(afterCount(4, T3_HELD.boundary), 'CONTROL: W1\'s longest-copy rule would read file 4').toBeGreaterThan(afterCount(3, T3_HELD.boundary));
    expect(w5a3Drv.admitBoundary(T3_LONG.rows, T3_LONG.bi, T3_LONG.si).admitted, 'CONTROL: file 4 alone would be admitted').toBe(true);
  });

  it('two copies, reversed: the holding copy is anthropic on both sides and admitted, though the copy with the most rows after the boundary reaches a gateway', () => {
    expect(rowOf(4)).toMatchObject({
      admitted: true, reason: null, file_id: 5, boundary_index: T4_HELD.bi, summary_index: T4_HELD.si, before: 'anthropic', after: 'anthropic',
    });
    expect(afterCount(6, T4_HELD.boundary), 'CONTROL: W1\'s longest-copy rule would read file 6').toBeGreaterThan(afterCount(5, T4_HELD.boundary));
    expect(w5a3Drv.admitBoundary(T4_LONG.rows, T4_LONG.bi, T4_LONG.si).admitted, 'CONTROL: file 6 alone would not be admitted').toBe(false);
  });

  it('two copies, a live copy is read before a retired copy with a smaller file_id (lib.pickHoldingCopy: live first)', () => {
    expect(rowOf(10)).toMatchObject({ admitted: false, reason: 'after-other', file_id: 13, before: 'anthropic', after: 'other' });
    expect(afterCount(12, T10_LIVE.boundary), 'CONTROL: neither length nor file order picks file 13').toBe(afterCount(13, T10_LIVE.boundary));
    expect(w5a3Drv.admitBoundary(T10_RETIRED.rows, T10_RETIRED.bi, T10_RETIRED.si).admitted, 'CONTROL: the retired copy alone would be admitted').toBe(true);
  });

  it('RP5 in a store: an Anthropic-wrapper session (claude-a-p2) whose last real assistant row before the boundary is a gateway row is not admitted, and no roster is read', () => {
    expect(rowOf(2)).toMatchObject({ ccrc_id: 'claude-a-p2', admitted: false, reason: 'before-other', before: 'other', after: 'anthropic', file_id: 2 });
    expect(w5a3Drv.admitStoreBoundaries.length, 'one parameter, the store handle: no HOME, so no roster').toBe(1);
  });

  it('the family is derive.mjs epochOfUuid\'s: a confirmed epoch of an unmerged session, the smallest session_pk', () => {
    expect([rowOf(1).ccrc_id, rowOf(1).generation], 'session 1, not session 12, which holds a later epoch of the same uuid').toEqual(['claude-a-p1', gen(1)]);
    expect([rowOf(6).ccrc_id, rowOf(6).reason], 'an unconfirmed epoch').toEqual([null, 'no-epoch']);
    expect([rowOf(9).ccrc_id, rowOf(9).reason], 'a confirmed epoch of a merged session').toEqual([null, 'no-epoch']);
  });

  it('CONTROL (R5): this task\'s six words are appended to RECON_DISCARDS after Task 2\'s, none is a DRIVER_REASONS word, and every reason a verdict carries is a RECON_DISCARDS word', () => {
    expect(w5a3Drv.RECON_DISCARDS.slice(18, 24)).toEqual(['no-epoch', 'ts-null', 'before-other', 'before-unknown', 'after-other', 'after-unknown']);
    expect(w5a3Drv.RECON_DISCARDS.filter((w) => (w5a3Drv.DRIVER_REASONS as readonly string[]).includes(w))).toEqual([]);
    const reasons = new Set(planted().res.boundaries.map((b) => b.reason).filter((r) => r !== null));
    for (const r of reasons) expect(w5a3Drv.RECON_DISCARDS).toContain(r);
    expect(reasons.size, 'CONTROL: the planted store reaches six reasons').toBe(6);
  });
});

// ── W2-5a Task 4: Baseline B and its files (W2-D68, W2-D69; W2-D33's kept-list scan; W2-D61's quoted-command pin) ────
// In-process, on fixture stores and fixture trees only. Each case makes a mkTmp root that holds a fixture HOME (its
// roster is two of W2-4 Task 3's FIXTURE_ACCOUNTS rows; its store is made by store.mjs's createStore and written with
// openWriter) and a fixture tree, and hands the driver Task 1's openReplayStore over that HOME, as a subcommand does. W2-D69's
// ancestor walk stops at that root (ctx.top), so no case reads a file outside its own tree; the default walk to the
// filesystem root is pinned on baselineCandidates, which reads nothing. Nothing is spawned but mkfifo, and no live
// store or real home is read. Facts are SHA-shaped, `fa` + five digits + `cafe`, so each has its own seven-character
// prefix (the variant W2-D62 tests), or short synthetic commands; nothing key-shaped is planted.
// The W5A4_ and w5a4 declarations are MODULE-LEVEL: later W2-5a tasks build B fixtures with them.
import * as w5a4Fs from 'node:fs';
import * as w5a4Path from 'node:path';
import { createHash as w5a4Hash } from 'node:crypto';
import { inspect as w5a4Inspect } from 'node:util';
import type { DatabaseSync as W5a4Db } from 'node:sqlite';
import * as w5a4Lib from '../../ccd/history/lib.mjs';
import * as w5a4St from '../../ccd/history/store.mjs';
import * as w5a4DeriveMod from '../../ccd/history/derive.mjs';
import * as w5a4Gate from '../../deploy/history-gate.mjs';
import * as w5a4Drv from '../../deploy/history-replay.mjs';
import { mkTmp as w5a4MkTmp } from './tmpHelpers.js';

/** derive.mjs has no .d.mts (W2-1, R1): the two reads the CONTROL needs, typed at the call site. */
const w5a4Derive = w5a4DeriveMod as unknown as {
  keptOf: (s: unknown, blobId: number | null, budget: { bytes: number }) => Set<string>;
  blobReadStmts: (db: W5a4Db) => unknown;
};
const W5A4_UUID = (n: number): string => `5a400000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const W5A4_FACT = (n: number): string => `fa${String(n).padStart(5, '0')}cafe`;
/** A short Bash command with quotes: renderEntryText escapes them, so only the string-leaf rendering holds it whole. */
const W5A4_QUOTED = 'git log --format="%h %s" -n 3';
/** The served card's command, quoted the same way, inside an attachment object. */
const W5A4_CARD_CMD = 'make check ARGS="--fast --keep"';
const W5A4_ROOT_USER = (process.getuid?.() ?? 1) === 0;

type W5a4Stored = 'tombstone' | 'over-cap';
type W5a4Row = {
  key: string;
  type: 'user' | 'assistant' | 'system' | 'attachment';
  provenance: 'operator' | 'model' | 'tool' | 'summary' | 'harness';
  body: unknown;
  stored?: W5a4Stored;
  variants?: Array<{ body: unknown; cause: 'ccd-sanitize' | 'unknown'; stored?: W5a4Stored }>;
  held?: boolean;
};
interface W5a4Spec {
  rows?: W5a4Row[];
  kept?: string[] | null | 'tombstone' | 'object' | 'non-string';
  keptExtra?: string[];
  /** Epochs 1..n of the family, each cwd a name under the tree (null: none). N's is `nSeq`, default the last. */
  epochs?: Array<{ cwd: string | null; cwdReal?: string | null }>;
  nSeq?: number;
}
/** An admitted row of Task 3's admitStoreBoundaries, as the fixture knows it. */
type W5a4Admission = {
  entry_id: number; uuid: string; transcript_pk: number; ts_ms: number | null; ccrc_id: string | null; generation: string | null;
  admitted: boolean; reason: string | null; file_id: number | null; boundary_index: number | null; summary_index: number | null;
  summary_entry_id: number | null; before: string | null; after: string | null;
};
/** Task 1's ReplayStore, as the fixture reads it. */
type W5a4Rs = { db: W5a4Db; close(): void };
interface W5a4Fixture {
  root: string; home: string; tree: string; cwd: string; rs: W5a4Rs; db: W5a4Db; keptBlobId: number | null;
  boundary: W5a4Admission;
  ctx: { home: string; configDirs: string[]; budget: { bytes: number }; top: string };
  uuidOf: (key: string) => string;
}
type W5a4Answer =
  | { state: 'built'; bytes: number; files: number; keptMembers: number; keptAbsent: number; postRows: number; text: string }
  | { state: 'discard'; why: string };

/** The holding copy, in line order: an operator row and three kept rows before the boundary; the summary (its last line
 *  the transcript pointer); a kept assistant row; the served card and a harness notice; the operator's next prompt (the
 *  stop); and a row after it. Assistant rows carry Task 3's anthropic fixture model, so RP5 admits the boundary. */
function w5a4Rows(): W5a4Row[] {
  const bash = { type: 'tool_use', id: 'toolu_k1', name: 'Bash', input: { command: W5A4_QUOTED } };
  return [
    { key: 'op1', type: 'user', provenance: 'operator', body: `look at ${W5A4_FACT(4)} please` },
    { key: 'a1', type: 'assistant', provenance: 'model', body: [{ type: 'text', text: '...' }, bash], variants: [
      { cause: 'ccd-sanitize', body: [{ type: 'text', text: `the sanitised text named ${W5A4_FACT(5)}` }, bash] },
      { cause: 'unknown', body: [{ type: 'text', text: `another copy named ${W5A4_FACT(6)}` }, bash] },
    ] },
    { key: 'r1', type: 'user', provenance: 'tool', body: [{ type: 'tool_result', tool_use_id: 'toolu_k1', content: `kept output ${W5A4_FACT(3)}` }] },
    { key: 'a2', type: 'assistant', provenance: 'model', body: [{ type: 'tool_use', id: 'toolu_k2', name: 'Edit', input: { [W5A4_FACT(9)]: true } }] },
    { key: 'boundary', type: 'system', provenance: 'harness', body: 'Conversation compacted' },
    { key: 'summary', type: 'user', provenance: 'summary',
      body: `This session is being continued. Summary: ${W5A4_FACT(1)} was the head.\nIf you need specifics, read the full transcript at: /home/u/.claude/projects/-home-u-tree-demo/${W5A4_FACT(2)}.jsonl` },
    { key: 'a3', type: 'assistant', provenance: 'model', body: [{ type: 'text', text: `a kept reply after the summary, ${W5A4_FACT(7)}` }] },
    { key: 'card', type: 'attachment', provenance: 'harness', body: { type: 'hook_additional_context', content: [`History: node L1a2b3c4 ran ${W5A4_CARD_CMD}`] } },
    { key: 'sys', type: 'system', provenance: 'harness', body: `a harness notice ${W5A4_FACT(8)}` },
    { key: 'op2', type: 'user', provenance: 'operator', body: 'the next prompt' },
    { key: 'late', type: 'attachment', provenance: 'harness', body: { type: 'hook_additional_context', content: [`later context ${W5A4_FACT(30)}`] } },
  ];
}
const W5A4_KEPT = ['a1', 'r1', 'a2', 'a3'];
/** w5a4Rows with one row patched. */
const w5a4With = (key: string, patch: Partial<W5a4Row>): W5a4Row[] => w5a4Rows().map((r) => (r.key === key ? { ...r, ...patch } : r));

const w5a4Open: W5a4Rs[] = [];
afterEach(() => {
  for (const rs of w5a4Open) { try { rs.close(); } catch { /* its case closed it */ } }
  w5a4Open.length = 0;
});

/** One family, one confirmed epoch per `epochs` entry, one transcript (N's epoch's session uuid), one live copy
 *  (file 1) holding every row not marked `held: false`, and the boundary's kept list. Answers the admitted row Task 3
 *  would hand B, built by position over the held rows, and the ctx a subcommand passes, with `top` at the root. */
function w5a4Fixture(spec: W5a4Spec = {}): W5a4Fixture {
  const root = w5a4MkTmp('w5a4-baseline-');
  const home = w5a4Path.join(root, 'home');
  const tree = w5a4Path.join(root, 'tree');
  const cwd = w5a4Path.join(tree, 'demo');
  w5a4Fs.mkdirSync(cwd, { recursive: true });
  w5a4Fs.mkdirSync(home, { recursive: true });
  writeRoster(home, FIXTURE_ACCOUNTS.slice(0, 2));
  w5a4St.createStore(home);
  const dbFile = w5a4Lib.historyPaths(home).dbFile;
  const w = w5a4St.openWriter(dbFile);
  const rows = spec.rows ?? w5a4Rows();
  const epochs = spec.epochs ?? [{ cwd: 'demo' }];
  const nSeq = spec.nSeq ?? epochs.length;
  const under = (name: string | null | undefined): string | null => (name === null || name === undefined ? null : w5a4Path.join(tree, name));
  let blobN = 0;
  const blob = (body: unknown, stored?: W5a4Stored): number => {
    blobN += 1;
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const sha = w5a4Hash('sha256').update(`${blobN}:`).update(raw).digest();
    if (stored === 'tombstone') {
      return Number(w.prepare("INSERT INTO blobs (sha256, codec, z, raw_len, pruned_ms) VALUES (?, 'br5', NULL, ?, 1)").run(sha, raw.length).lastInsertRowid);
    }
    const rawLen = stored === 'over-cap' ? w5a4Lib.BLOB_DECODE_MAX + 1 : raw.length;
    return Number(w.prepare("INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, 'br5', ?, ?)").run(sha, w5a4St.brotli(raw), rawLen).lastInsertRowid);
  };
  const ids = new Map<string, number>();
  const uuids = new Map<string, string>();
  const uuidOf = (key: string): string => {
    const u = uuids.get(key);
    if (u === undefined) throw new Error(`w5a4Fixture: no row ${key}`);
    return u;
  };
  w.exec('BEGIN');
  w.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'fam-a', ?, 'demo', 1)").run(W5A4_UUID(0xfa));
  const epoch = w.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, cwd, cwd_real, confirmed_ms) VALUES (1, ?, ?, 'startup', 'hook', ?, ?, 1)");
  epochs.forEach((e, i) => { epoch.run(i + 1, W5A4_UUID(0xe0 + i), under(e.cwd), under(e.cwdReal)); });
  w.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?)').run(W5A4_UUID(0xe0 + nSeq - 1));
  w.prepare("INSERT INTO ingest_files (file_id, dev, ino, transcript_pk, status, parser_version) VALUES (1, 1, 5401, 1, 'live', 1)").run();
  const entry = w.prepare(`INSERT INTO entries (uuid, transcript_pk, type, model, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms, is_compact_summary)
    VALUES (?, 1, ?, ?, ?, 1, 0, 1, ?, ?, ?)`);
  const member = w.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (1, ?, ?)');
  const variant = w.prepare('INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms, cause) VALUES (?, ?, 1, 1, ?)');
  rows.forEach((r, i) => {
    const primary = blob(r.body, r.stored);
    const id = Number(entry.run(W5A4_UUID(i + 1), r.type, r.type === 'assistant' ? W5A3_CLAUDE : null, r.provenance, primary, 1_000 + i,
      r.provenance === 'summary' ? 1 : 0).lastInsertRowid);
    ids.set(r.key, id);
    uuids.set(r.key, W5A4_UUID(i + 1));
    if (r.held !== false) member.run(id, i + 1);
    if (r.variants !== undefined) {
      variant.run(id, primary, 'unknown');   // a store may list the primary among its variants; B reads it once
      for (const v of r.variants) variant.run(id, blob(v.body, v.stored), v.cause);
    }
  });
  const kept = spec.kept === undefined ? W5A4_KEPT : spec.kept;
  let keptBlobId: number | null = null;
  if (kept === 'tombstone') keptBlobId = blob([uuidOf('a1')], 'tombstone');
  else if (kept === 'object') keptBlobId = blob({ allUuids: [uuidOf('a1')] });
  else if (kept === 'non-string') keptBlobId = blob([uuidOf('a1'), 7]);
  else if (kept !== null) keptBlobId = blob([...kept.map(uuidOf), ...(spec.keptExtra ?? [])]);
  w.prepare('INSERT INTO boundaries (entry_id, transcript_pk, ord, anchor_uuid, kept_blob_id) VALUES (?, 1, 1, ?, ?)')
    .run(ids.get('boundary')!, uuidOf('summary'), keptBlobId);
  w.exec('COMMIT');
  w5a4St.closeWriter(w);
  const rs = w5a4Drv.openReplayStore(home) as unknown as W5a4Rs;
  w5a4Open.push(rs);
  const held = rows.filter((r) => r.held !== false).map((r) => r.key);
  const boundary: W5a4Admission = {
    entry_id: ids.get('boundary')!, uuid: uuidOf('boundary'), transcript_pk: 1, ts_ms: 1_000 + rows.findIndex((r) => r.key === 'boundary'),
    ccrc_id: 'fam-a', generation: W5A4_UUID(0xfa), admitted: true, reason: null, file_id: 1,
    boundary_index: held.indexOf('boundary'), summary_index: held.indexOf('summary'), summary_entry_id: ids.get('summary')!,
    before: 'anthropic', after: 'anthropic',
  };
  const configDirs = w5a4Drv.rosterConfigDirs(w5a4Drv.readRoster(home).roster, home);
  return { root, home, tree, cwd, rs, db: rs.db, keptBlobId, boundary, ctx: { home, configDirs, budget: { bytes: 0 }, top: root }, uuidOf };
}

/** A file with its parent directories. */
const w5a4Put = (p: string, text: string): void => {
  w5a4Fs.mkdirSync(w5a4Path.dirname(p), { recursive: true });
  w5a4Fs.writeFileSync(p, text);
};
/** W2-D69's tree for a fixture, one fact per file: the cwd's CLAUDE.md (with a relative, a `~`, a directory, a
 *  nobody and a chained mention), the cwd's .claude/CLAUDE.md, the tree's CLAUDE.local.md and a CLAUDE.md that links to
 *  a regular file, gen-a's config-dir CLAUDE.md, a memory file under the cwd's slug in the upstream config dir, the two
 *  imported files, and a six-link import chain. */
function w5a4WriteFiles(fx: W5a4Fixture): void {
  w5a4Put(w5a4Path.join(fx.cwd, 'CLAUDE.md'),
    `# demo\nfact ${W5A4_FACT(10)}\nsee @docs/notes.md and @~/shared/team.md, the folder @docs/ and ask @nobody.\nchain: @chain/d1.md\n`);
  w5a4Put(w5a4Path.join(fx.cwd, '.claude', 'CLAUDE.md'), `fact ${W5A4_FACT(12)}\n`);
  w5a4Put(w5a4Path.join(fx.tree, 'CLAUDE.local.md'), `fact ${W5A4_FACT(11)}\n`);
  w5a4Put(w5a4Path.join(fx.root, 'elsewhere', 'real.md'), `fact ${W5A4_FACT(18)}\n`);
  w5a4Fs.symlinkSync(w5a4Path.join(fx.root, 'elsewhere', 'real.md'), w5a4Path.join(fx.tree, 'CLAUDE.md'));
  w5a4Put(w5a4Path.join(fx.home, '.gen-a', 'CLAUDE.md'), `fact ${W5A4_FACT(13)}\n`);
  w5a4Put(w5a4Path.join(fx.home, '.claude', 'projects', fx.cwd.replace(/[^A-Za-z0-9]/g, '-'), 'memory', 'topic.md'), `fact ${W5A4_FACT(14)}\n`);
  w5a4Put(w5a4Path.join(fx.cwd, 'docs', 'notes.md'), `fact ${W5A4_FACT(15)}\n`);
  w5a4Put(w5a4Path.join(fx.home, 'shared', 'team.md'), `fact ${W5A4_FACT(16)}\n`);
  for (let i = 1; i <= 6; i += 1) w5a4Put(w5a4Path.join(fx.cwd, 'chain', `d${i}.md`), `fact ${W5A4_FACT(20 + i)}\n${i < 6 ? `@d${i + 1}.md\n` : ''}`);
}
const w5a4B = (fx: W5a4Fixture, boundary: W5a4Admission = fx.boundary): W5a4Answer =>
  w5a4Drv.baselineOf(fx.rs as never, boundary, fx.ctx) as unknown as W5a4Answer;
function w5a4Built(fx: W5a4Fixture): Extract<W5a4Answer, { state: 'built' }> {
  const b = w5a4B(fx);
  if (b.state !== 'built') throw new Error(`B was not built: ${JSON.stringify(b)}`);
  return b;
}
const w5a4Admitted = (kind: 'sha' | 'command', F: string, text: string): boolean =>
  w5a4Gate.admitFact(kind, F, text, '', { repoRoots: [] }).admitted;

describe('W2-5a Task 4: Baseline B parts 1 to 3, W2-D68', () => {
  it('B is built for the row admitStoreBoundaries admits, read in place of a hand-made row', () => {
    const fx = w5a4Fixture();
    const rows = w5a4Drv.admitStoreBoundaries(fx.rs as never).boundaries as unknown as W5a4Admission[];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.admitted, JSON.stringify(row)).toBe(true);
    const pick = (r: W5a4Admission) => [r.entry_id, r.uuid, r.transcript_pk, r.file_id, r.boundary_index, r.summary_index, r.summary_entry_id];
    expect(pick(row)).toEqual(pick(fx.boundary));
    const viaTask3 = w5a4B(fx, row);
    expect(viaTask3.state).toBe('built');
    expect((viaTask3 as { text: string }).text).toBe(w5a4Built(fx).text);
  });

  it('part 1 is the summary row whole, its pointer line kept', () => {
    const b = w5a4Built(w5a4Fixture());
    expect(w5a4Admitted('sha', W5A4_FACT(1), b.text), 'the summary text').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(2), b.text), 'the transcript-pointer line: B keeps it, only the payload removes it').toBe(false);
  });

  it('part 2 is every kept member in the store, its primary and every variant', () => {
    const b = w5a4Built(w5a4Fixture());
    expect(w5a4Admitted('sha', W5A4_FACT(3), b.text), 'a kept tool_result').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(5), b.text), 'only in a ccd-sanitize variant').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(6), b.text), 'only in a variant of another cause: expand would not pick it, B reads it').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(7), b.text), 'only in a post-summary kept member').toBe(false);
    // CONTROL: a row of leaf N's span outside kept(N) is not in B, so B is not the whole copy.
    expect(w5a4Admitted('sha', W5A4_FACT(4), b.text)).toBe(true);
  });

  it('W2-D74: a fact only in the sanitised body, the primary expand passes over, is rejected by B (R7)', () => {
    const a1 = w5a4Rows().find((r) => r.key === 'a1')!;
    const primary = [{ type: 'text', text: `the sanitised primary ${W5A4_FACT(42)}` }, ...(a1.body as unknown[]).slice(1)];
    const b = w5a4Built(w5a4Fixture({ rows: w5a4With('a1', { body: primary }) }));
    expect(w5a4Admitted('sha', W5A4_FACT(42), b.text)).toBe(false);
    // CONTROL: no variant holds it, so only B's reading of the primary rejects it.
    expect(a1.variants!.some((v) => JSON.stringify(v.body).includes(W5A4_FACT(42)))).toBe(false);
  });

  it('both renderings: a short quoted command in a kept tool_use and a fact only in a tool_use key are not admitted', () => {
    const b = w5a4Built(w5a4Fixture());
    expect(w5a4Admitted('command', W5A4_QUOTED, b.text), 'W2-D61: the string leaf holds it whole').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(9), b.text), 'renderEntryText keeps an input key; the leaves do not').toBe(false);
    // CONTROL: each rendering alone misses one of them, so neither half is redundant.
    const bash = [{ type: 'tool_use', id: 'toolu_k1', name: 'Bash', input: { command: W5A4_QUOTED } }];
    expect(w5a4Admitted('command', W5A4_QUOTED, w5a4Lib.renderEntryText(bash))).toBe(true);
    const keyed = [{ type: 'tool_use', id: 'toolu_k2', name: 'Edit', input: { [W5A4_FACT(9)]: true } }];
    expect(w5a4Admitted('sha', W5A4_FACT(9), w5a4Lib.ftsTextOf(keyed, 'entry'))).toBe(true);
  });

  it('part 3 takes the rows after the summary to the first operator row, the served card included', () => {
    const b = w5a4Built(w5a4Fixture());
    expect(w5a4Admitted('command', W5A4_CARD_CMD, b.text), 'the served card: its string leaves hold the quoted command').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(8), b.text), 'a harness row before the stop').toBe(false);
    expect(b.postRows).toBe(2);
    // CONTROL: the row after the operator's next prompt is not in B.
    expect(w5a4Admitted('sha', W5A4_FACT(30), b.text)).toBe(true);
    // CONTROL: the card's JSON rendering escapes its quotes, and ftsTextOf reads nothing of an object, so the object's
    // string leaves are what reject it (D-6279).
    const card = { type: 'hook_additional_context', content: [`History: node L1a2b3c4 ran ${W5A4_CARD_CMD}`] };
    expect(w5a4Admitted('command', W5A4_CARD_CMD, w5a4Lib.renderEntryText(card))).toBe(true);
    expect(w5a4Lib.ftsTextOf(card, 'entry')).toBe('');
  });

  it('a kept member after the summary is never the stop, and an assistant row that is not kept is', () => {
    // a3, a kept assistant row between the summary and the card, is part 2's, so the card is still read
    // (D-6278).
    const b = w5a4Built(w5a4Fixture());
    expect(w5a4Admitted('sha', W5A4_FACT(7), b.text)).toBe(false);
    expect(w5a4Admitted('command', W5A4_CARD_CMD, b.text)).toBe(false);
    // CONTROL: with a3 outside kept(N) it is the first assistant row after the summary, the stop, so neither it nor the
    // card is in B.
    const c = w5a4Built(w5a4Fixture({ kept: ['a1', 'r1', 'a2'] }));
    expect(w5a4Admitted('sha', W5A4_FACT(7), c.text)).toBe(true);
    expect(w5a4Admitted('command', W5A4_CARD_CMD, c.text)).toBe(true);
    expect(c.postRows).toBe(0);
  });

  it('kept members come in holding-copy order, absent ones are counted, and the run budget is charged', () => {
    const rows: W5a4Row[] = [...w5a4Rows(), { key: 'x', type: 'user', provenance: 'tool', held: false,
      body: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: `elsewhere ${W5A4_FACT(31)}` }] }];
    const fx = w5a4Fixture({ rows, kept: ['x', 'a3', 'a2', 'r1', 'a1'], keptExtra: [W5A4_UUID(0xdead), W5A4_UUID(0xbeef)] });
    const b = w5a4Built(fx);
    expect([b.keptMembers, b.keptAbsent]).toEqual([5, 2]);
    const at = (n: number): number => b.text.indexOf(W5A4_FACT(n));
    expect(at(5)).toBeGreaterThan(-1);
    expect(at(5) < at(3) && at(3) < at(7) && at(7) < at(31), 'held members by line (a1, r1, a3), then the unheld one').toBe(true);
    expect(b.bytes).toBe(Buffer.byteLength(b.text, 'utf8'));
    expect(fx.ctx.budget.bytes, 'every blob B read was charged to the run budget').toBeGreaterThan(0);
  });
});

describe('W2-5a Task 4: B fails closed, W2-D68', () => {
  it('a NULL kept id discards as kept-absent', () => {
    expect(w5a4B(w5a4Fixture({ kept: null }))).toEqual({ state: 'discard', why: 'kept-absent' });
  });

  it('a tombstoned kept blob discards as kept-unreadable, never an empty B', () => {
    const fx = w5a4Fixture({ kept: 'tombstone' });
    expect(w5a4B(fx)).toEqual({ state: 'discard', why: 'kept-unreadable' });
    // CONTROL, the reason for Task 1's keptOf scan (W2-D33): derive.mjs's kept-set reader answers an empty set for this
    // same blob, which a B built on it would read as "nothing was kept".
    expect(w5a4Derive.keptOf(w5a4Derive.blobReadStmts(fx.db), fx.keptBlobId, { bytes: 0 }).size).toBe(0);
  });

  it('a kept body that is not an array of strings discards as kept-unreadable', () => {
    expect(w5a4B(w5a4Fixture({ kept: 'object' }))).toEqual({ state: 'discard', why: 'kept-unreadable' });
    expect(w5a4B(w5a4Fixture({ kept: 'non-string' }))).toEqual({ state: 'discard', why: 'kept-unreadable' });
  });

  it('an empty kept list is an empty part 2, not a discard', () => {
    const b = w5a4Built(w5a4Fixture({ kept: [] }));
    expect([b.keptMembers, b.keptAbsent]).toEqual([0, 0]);
    expect(w5a4Admitted('sha', W5A4_FACT(3), b.text)).toBe(true);
  });

  it('a kept member whose primary or a variant is pruned or over the decode cap discards', () => {
    const a1 = w5a4Rows().find((r) => r.key === 'a1')!;
    for (const rows of [
      w5a4With('a1', { stored: 'tombstone' }),
      w5a4With('a1', { stored: 'over-cap' }),
      w5a4With('a1', { variants: [{ ...a1.variants![0]!, stored: 'tombstone' }, a1.variants![1]!] }),
    ]) expect(w5a4B(w5a4Fixture({ rows }))).toEqual({ state: 'discard', why: 'kept-member-unreadable' });
  });

  it('a summary that cannot be read is summary-unreadable, a copy that moved is copy-moved, and a row not admitted throws', () => {
    expect(w5a4B(w5a4Fixture({ rows: w5a4With('summary', { stored: 'tombstone' }) }))).toEqual({ state: 'discard', why: 'summary-unreadable' });
    const fx = w5a4Fixture();
    expect(w5a4B(fx, { ...fx.boundary, boundary_index: fx.boundary.boundary_index! + 1 })).toEqual({ state: 'discard', why: 'copy-moved' });
    expect(w5a4B(fx, { ...fx.boundary, summary_index: 999 })).toEqual({ state: 'discard', why: 'copy-moved' });
    expect(() => w5a4B(fx, { ...fx.boundary, admitted: false, reason: 'after-other' })).toThrow(TypeError);
  });

  it('a post-summary row that cannot be read discards; a row after the stop is never read', () => {
    expect(w5a4B(w5a4Fixture({ rows: w5a4With('sys', { stored: 'tombstone' }) }))).toEqual({ state: 'discard', why: 'post-row-unreadable' });
    // CONTROL: the same damage after the operator's next prompt is never read.
    expect(w5a4B(w5a4Fixture({ rows: w5a4With('late', { stored: 'tombstone' }) })).state).toBe('built');
  });

  it('B\'s discard words are appended to RECON_DISCARDS after Task 3\'s, each once (R5)', () => {
    expect(w5a4Drv.RECON_DISCARDS.slice(24, 35)).toEqual(['copy-moved', 'summary-unreadable', 'kept-member-unreadable', 'post-row-unreadable',
      'post-over-cap', 'cwd-unknown', 'cwd-missing', 'cwd-unreadable', 'file-unreadable', 'file-not-regular', 'file-over-cap']);
    expect(w5a4Drv.RECON_DISCARDS, 'kept-absent and kept-unreadable are Task 1\'s').toEqual(expect.arrayContaining(['kept-absent', 'kept-unreadable']));
    expect(new Set(w5a4Drv.RECON_DISCARDS).size).toBe(w5a4Drv.RECON_DISCARDS.length);
  });

  it('more than 200 post-summary rows discard as post-over-cap; 200 do not', () => {
    const many = (n: number): W5a4Row[] => [
      ...w5a4Rows().slice(0, 6),
      ...Array.from({ length: n }, (_, i): W5a4Row => ({ key: `h${i}`, type: 'system', provenance: 'harness', body: `notice ${i}` })),
      { key: 'op2', type: 'user', provenance: 'operator', body: 'the next prompt' },
    ];
    expect(w5a4Built(w5a4Fixture({ rows: many(200), kept: ['a1', 'r1', 'a2'] })).postRows).toBe(200);
    expect(w5a4B(w5a4Fixture({ rows: many(201), kept: ['a1', 'r1', 'a2'] }))).toEqual({ state: 'discard', why: 'post-over-cap' });
  });
});

describe('W2-5a Task 4: B fails closed on a body that cannot be rendered, D-6304', () => {
  /** A fixture whose row `key` stores an object nested `depth` deep. It parses, and lib's renderEntryText throws a
   *  RangeError on it from about 4,500 levels. Built at runtime: the blob is written raw, because JSON.stringify of the
   *  nested value would throw in the fixture itself. */
  const nested = (key: string, depth: number): W5a4Fixture => {
    const fx = w5a4Fixture();
    fx.rs.close();
    const w = w5a4St.openWriter(w5a4Lib.historyPaths(fx.home).dbFile);
    const row = w.prepare('SELECT blob_id FROM entries WHERE uuid = ?').get(fx.uuidOf(key)) as { blob_id: number };
    const raw = Buffer.from(`${'{"a":'.repeat(depth)}"x"${'}'.repeat(depth)}`, 'utf8');
    w.prepare('UPDATE blobs SET z = ?, raw_len = ? WHERE blob_id = ?').run(w5a4St.brotli(raw), raw.length, Number(row.blob_id));
    w5a4St.closeWriter(w);
    const rs = w5a4Drv.openReplayStore(fx.home) as unknown as W5a4Rs;
    w5a4Open.push(rs);
    return { ...fx, rs, db: rs.db };
  };

  it.each([['summary', 'the summary row (part 1)'], ['a3', 'a kept member (part 2)'], ['card', 'a post-summary row (part 3)']])(
    '%s: a body nested 5,000 deep discards body-unrenderable, and 4,000 deep builds B (%s)', (key) => {
      expect(w5a4B(nested(key, 5000))).toEqual({ state: 'discard', why: 'body-unrenderable' });
      // CONTROL: the same row 4,000 deep renders, so the discard is the depth and not the fixture.
      expect(w5a4B(nested(key, 4000)).state).toBe('built');
    });

  it('body-unrenderable is an existing RECON_DISCARDS word, and no word was added for it', () => {
    expect(w5a4Drv.RECON_DISCARDS).toContain('body-unrenderable');
    expect(w5a4Drv.RECON_DISCARDS.at(-1)).toBe('body-unrenderable');
    expect(w5a4Drv.RECON_DISCARDS).toHaveLength(35 + 1);
  });
});

describe('W2-5a Task 4: B is held in memory only, W2-D68 and W2-D33', () => {
  /** What the default fixture plants in B, as the seven-character variant W2-D62 tests, and the two commands. */
  const IN_B = [1, 2, 3, 5, 6, 7, 8, 9].map((n) => W5A4_FACT(n).slice(0, 7));
  const leaks = (text: string): string[] => [...IN_B, W5A4_QUOTED, W5A4_CARD_CMD].filter((s) => text.includes(s));
  const refusal = (fn: () => unknown): { word: string; detail: string } | null => {
    try { fn(); return null; } catch (e) { if (e instanceof DriverRefusal) return { word: e.word, detail: e.detail }; throw e; }
  };
  const byUuid = (a: { boundary_uuid: string }, b: { boundary_uuid: string }): number =>
    (a.boundary_uuid < b.boundary_uuid ? -1 : a.boundary_uuid > b.boundary_uuid ? 1 : 0);

  it('its text is not enumerable, so no serialiser or inspector carries it', () => {
    const fx = w5a4Fixture();
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m));
    const b = w5a4Built(fx);
    const calls = spies.map((s) => s.mock.calls.length);
    for (const s of spies) s.mockRestore();
    expect(calls, 'B is never logged').toEqual([0, 0, 0, 0]);
    expect(leaks(b.text), 'CONTROL: the text holds every planted fact').toHaveLength(IN_B.length + 2);
    expect(Object.keys(b)).not.toContain('text');
    expect(Object.isFrozen(b)).toBe(true);
    for (const [how, s] of [['JSON.stringify', JSON.stringify(b)], ['canonicalJson', w5a4Lib.canonicalJson(b)], ['inspect', w5a4Inspect(b, { depth: 8 })]] as const) {
      expect(leaks(s), how).toEqual([]);
    }
  });

  it('the baseline record carries counts only, and a scan of --out finds no B text', () => {
    const fx = w5a4Fixture();
    const b = w5a4Built(fx);
    const out = w5a4Drv.prepareOut(w5a4Path.join(fx.root, 'out'));
    const rows = [w5a4Drv.baselineRow(fx.boundary.uuid, b), w5a4Drv.baselineRow(W5A4_UUID(2), { state: 'discard', why: 'kept-absent' })];
    expect(rows[0]).toEqual({ boundary_uuid: fx.boundary.uuid, state: 'built', why: null, bytes: b.bytes, files: 0, kept_members: 4, kept_absent: 0, post_rows: 2 });
    const sha = w5a4Drv.writeBaselineRecord(out, 'quiz', { storeId: 'store-a', rows });
    const file = w5a4Path.join(out, 'quiz', w5a4Drv.BASELINE_RECORD);
    const bytes = w5a4Fs.readFileSync(file);
    expect(bytes.toString('utf8')).toBe(`${w5a4Lib.canonicalJson({
      kind: 'ccrc-history-w2-baseline', v: 1, baseline_files: 'v1', store_id: 'store-a', boundaries: [...rows].sort(byUuid), discards: { 'kept-absent': 1 },
    })}\n`);
    expect(sha).toBe(w5a4Lib.sha256Hex(bytes));
    expect(w5a4Fs.statSync(file).mode & 0o777).toBe(0o600);
    // The scan: every file under --out, read whole, holds nothing B holds (the CONTROL is the case above: the text does).
    const walk = (dir: string): string[] => w5a4Fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((d) => (d.isDirectory() ? walk(w5a4Path.join(dir, d.name)) : [w5a4Path.join(dir, d.name)]));
    const files = walk(out);
    expect(files).toContain(file);
    for (const f of files) expect(leaks(w5a4Fs.readFileSync(f, 'utf8')), f).toEqual([]);
  });

  it('the record is sorted by boundary and counts each discard word', () => {
    const fx = w5a4Fixture();
    const out = w5a4Drv.prepareOut(w5a4Path.join(fx.root, 'out'));
    const d = (n: number, why: string) => w5a4Drv.baselineRow(W5A4_UUID(n), { state: 'discard', why });
    w5a4Drv.writeBaselineRecord(out, 'pilot', { storeId: 'store-a', rows: [d(3, 'kept-absent'), d(1, 'post-over-cap'), d(2, 'kept-absent')] });
    const rec = JSON.parse(w5a4Fs.readFileSync(w5a4Path.join(out, 'pilot', 'baseline.json'), 'utf8')) as
      { boundaries: Array<{ boundary_uuid: string }>; discards: Record<string, number> };
    expect(rec.boundaries.map((r) => r.boundary_uuid)).toEqual([W5A4_UUID(1), W5A4_UUID(2), W5A4_UUID(3)]);
    expect(rec.discards).toEqual({ 'kept-absent': 2, 'post-over-cap': 1 });
  });

  it('the record refuses a link at its section or its file, and a caller defect throws', () => {
    const fx = w5a4Fixture();
    const rows = [w5a4Drv.baselineRow(W5A4_UUID(1), { state: 'discard', why: 'kept-absent' })];
    const out1 = w5a4Drv.prepareOut(w5a4Path.join(fx.root, 'out1'));
    w5a4Fs.mkdirSync(w5a4Path.join(fx.root, 'elsewhere-dir'));
    w5a4Fs.symlinkSync(w5a4Path.join(fx.root, 'elsewhere-dir'), w5a4Path.join(out1, 'quiz'));
    expect(refusal(() => w5a4Drv.writeBaselineRecord(out1, 'quiz', { storeId: 's', rows }))).toEqual({ word: 'out-refused', detail: 'quiz is not a directory' });
    expect(w5a4Fs.readdirSync(w5a4Path.join(fx.root, 'elsewhere-dir'))).toEqual([]);
    const out2 = w5a4Drv.prepareOut(w5a4Path.join(fx.root, 'out2'));
    w5a4Fs.mkdirSync(w5a4Path.join(out2, 'quiz'));
    w5a4Fs.writeFileSync(w5a4Path.join(fx.root, 'target.json'), 'untouched\n');
    w5a4Fs.symlinkSync(w5a4Path.join(fx.root, 'target.json'), w5a4Path.join(out2, 'quiz', 'baseline.json'));
    expect(refusal(() => w5a4Drv.writeBaselineRecord(out2, 'quiz', { storeId: 's', rows })))
      .toEqual({ word: 'out-refused', detail: 'quiz/baseline.json is not a regular file' });
    expect(w5a4Fs.readFileSync(w5a4Path.join(fx.root, 'target.json'), 'utf8')).toBe('untouched\n');
    expect(() => w5a4Drv.writeBaselineRecord(out2, 'arms', { storeId: 's', rows })).toThrow(TypeError);
    expect(() => w5a4Drv.writeBaselineRecord(out2, 'pilot', { storeId: 's', rows: [rows[0]!, rows[0]!] })).toThrow(TypeError);
  });

  it('BASELINE_FILES_ID is the open record default', () => {
    const rec = w5a4Gate.OPEN_RECORD_V1 as unknown as { draft: { quiz: { fields: { baseline_files: { value: string } } } } };
    expect(w5a4Drv.BASELINE_FILES_ID).toBe(rec.draft.quiz.fields.baseline_files.value);
    expect(w5a4Drv.BASELINE_FILES_ID).toBe('v1');
  });
});

describe('W2-5a Task 4: the baseline files, W2-D69', () => {
  it('a fact in any file of a, b or c is not admitted; a later epoch is not read', () => {
    const fx = w5a4Fixture({ epochs: [{ cwd: 'old' }, { cwd: 'demo' }, { cwd: 'later' }], nSeq: 2 });
    w5a4WriteFiles(fx);
    w5a4Put(w5a4Path.join(fx.tree, 'old', 'CLAUDE.md'), `fact ${W5A4_FACT(17)}\n`);
    w5a4Put(w5a4Path.join(fx.tree, 'later', 'CLAUDE.md'), `fact ${W5A4_FACT(19)}\n`);
    const b = w5a4Built(fx);
    for (const [n, where] of [[10, 'the cwd CLAUDE.md'], [11, 'an ancestor CLAUDE.local.md'], [12, 'the cwd .claude/CLAUDE.md'],
      [13, 'a config dir CLAUDE.md'], [14, 'a memory file under the slug'], [17, 'an earlier epoch cwd'],
      [18, 'a CLAUDE.md that links to a regular file']] as const) {
      expect(w5a4Admitted('sha', W5A4_FACT(n), b.text), where).toBe(false);
    }
    // CONTROL: an epoch after N's is not the family's history up to N.
    expect(w5a4Admitted('sha', W5A4_FACT(19), b.text)).toBe(true);
    // 7 at depth 0 (demo/CLAUDE.md, demo/.claude/CLAUDE.md, tree/CLAUDE.md, tree/CLAUDE.local.md, old/CLAUDE.md,
    // .gen-a/CLAUDE.md, topic.md), 3 at depth 1 (notes.md, team.md, d1.md), d2 to d5.
    expect(b.files).toBe(14);
  });

  it('a fact only in an imported file is not admitted, to depth 5 and no deeper', () => {
    const fx = w5a4Fixture();
    w5a4WriteFiles(fx);
    const b = w5a4Built(fx);
    expect(w5a4Admitted('sha', W5A4_FACT(15), b.text), 'a relative import').toBe(false);
    expect(w5a4Admitted('sha', W5A4_FACT(16), b.text), 'a ~ import, read as HOME').toBe(false);
    for (let depth = 1; depth <= 5; depth += 1) expect(w5a4Admitted('sha', W5A4_FACT(20 + depth), b.text), `depth ${depth}`).toBe(false);
    // CONTROL: the sixth link of the chain is past BASELINE_IMPORT_DEPTH and is never read.
    expect(w5a4Admitted('sha', W5A4_FACT(26), b.text)).toBe(true);
    expect(w5a4Drv.BASELINE_IMPORT_DEPTH).toBe(5);
  });

  it('an absent file is left out, and a mention of a directory or of nothing is not an import', () => {
    expect(w5a4Built(w5a4Fixture()).files).toBe(0);
    const fx = w5a4Fixture();
    w5a4Put(w5a4Path.join(fx.cwd, 'docs', 'keep.txt'), 'not markdown\n');
    w5a4Put(w5a4Path.join(fx.cwd, 'CLAUDE.md'), 'see the folder @docs/ and ask @nobody.\n');
    expect(w5a4Built(fx).files).toBe(1);
  });

  it('a removed worktree discards: N cwd or cwd_real gone is cwd-missing, an unknown one cwd-unknown; an earlier gone cwd is left out', () => {
    const removed = w5a4Fixture();
    w5a4Fs.rmSync(removed.cwd, { recursive: true });
    expect(w5a4B(removed)).toEqual({ state: 'discard', why: 'cwd-missing' });
    expect(w5a4B(w5a4Fixture({ epochs: [{ cwd: 'demo', cwdReal: 'real-gone' }] }))).toEqual({ state: 'discard', why: 'cwd-missing' });
    expect(w5a4B(w5a4Fixture({ epochs: [{ cwd: null }] }))).toEqual({ state: 'discard', why: 'cwd-unknown' });
    // CONTROL: an earlier epoch's removed directory is left out, and its ancestors are still read.
    const earlier = w5a4Fixture({ epochs: [{ cwd: 'gone' }, { cwd: 'demo' }] });
    w5a4Put(w5a4Path.join(earlier.tree, 'CLAUDE.md'), `fact ${W5A4_FACT(40)}\n`);
    expect(w5a4Admitted('sha', W5A4_FACT(40), w5a4Built(earlier).text)).toBe(false);
  });

  it.skipIf(W5A4_ROOT_USER)('an unreadable memory file or memory directory discards as file-unreadable', () => {
    const fx = w5a4Fixture();
    w5a4WriteFiles(fx);
    const memory = w5a4Path.join(fx.home, '.claude', 'projects', fx.cwd.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
    const topic = w5a4Path.join(memory, 'topic.md');
    w5a4Fs.chmodSync(topic, 0o000);
    try {
      expect(w5a4B(fx)).toEqual({ state: 'discard', why: 'file-unreadable' });
    } finally { w5a4Fs.chmodSync(topic, 0o600); }
    w5a4Fs.chmodSync(memory, 0o000);
    try {
      expect(w5a4B(fx)).toEqual({ state: 'discard', why: 'file-unreadable' });
    } finally { w5a4Fs.chmodSync(memory, 0o700); }
    expect(w5a4B(fx).state, 'CONTROL: readable again, B is built').toBe('built');
  });

  it.skipIf(W5A4_ROOT_USER)('an unreadable cwd discards as cwd-unreadable', () => {
    const fx = w5a4Fixture();
    w5a4Fs.chmodSync(fx.tree, 0o600);   // no search permission: the stat of tree/demo fails EACCES
    try {
      expect(w5a4B(fx)).toEqual({ state: 'discard', why: 'cwd-unreadable' });
    } finally { w5a4Fs.chmodSync(fx.tree, 0o700); }
  });

  it('a FIFO or a directory at CLAUDE.md discards as file-not-regular', () => {
    const fifo = w5a4Fixture();
    const mk = spawnSync('mkfifo', [w5a4Path.join(fifo.cwd, 'CLAUDE.md')], { encoding: 'utf8' });
    expect(mk.status, mk.stderr).toBe(0);
    expect(w5a4B(fifo), 'answered from the stat, never a blocking open').toEqual({ state: 'discard', why: 'file-not-regular' });
    const dir = w5a4Fixture();
    w5a4Fs.mkdirSync(w5a4Path.join(dir.cwd, 'CLAUDE.md'));
    expect(w5a4B(dir)).toEqual({ state: 'discard', why: 'file-not-regular' });
  });

  it('a file over 1 MiB discards as file-over-cap; one of exactly 1 MiB is read', () => {
    expect(w5a4Drv.BASELINE_FILE_MAX).toBe(1024 * 1024);
    const over = w5a4Fixture();
    w5a4Put(w5a4Path.join(over.cwd, 'CLAUDE.md'), 'x'.repeat(w5a4Drv.BASELINE_FILE_MAX + 1));
    expect(w5a4B(over)).toEqual({ state: 'discard', why: 'file-over-cap' });
    const at = w5a4Fixture();
    w5a4Put(w5a4Path.join(at.cwd, 'CLAUDE.md'), `${W5A4_FACT(41)}${'x'.repeat(w5a4Drv.BASELINE_FILE_MAX - W5A4_FACT(41).length)}`);
    expect(w5a4Admitted('sha', W5A4_FACT(41), w5a4Built(at).text)).toBe(false);
  });

  it('the ancestor walk reaches the filesystem root by default and stops at top when given', () => {
    const names = (dir: string): string[] => ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md'].map((n) => w5a4Path.join(dir, n));
    expect(w5a4Drv.baselineCandidates({ cwds: ['/home/u/tree/demo'], configDirs: ['/home/u/.gen-a'] })).toEqual([
      ...names('/home/u/tree/demo'), ...names('/home/u/tree'), ...names('/home/u'), ...names('/home'), ...names('/'),
      '/home/u/.gen-a/CLAUDE.md',
    ]);
    // Each path once: the upstream config dir's CLAUDE.md is also an ancestor's .claude/CLAUDE.md, and is read once.
    expect(w5a4Drv.baselineCandidates({ cwds: ['/home/u/tree/demo'], configDirs: ['/home/u/.claude'] })).toHaveLength(15);
    expect(w5a4Drv.baselineCandidates({ cwds: ['/home/u/tree/demo'], configDirs: [], top: '/home/u/tree' }))
      .toEqual([...names('/home/u/tree/demo'), ...names('/home/u/tree')]);
    expect(w5a4Drv.BASELINE_NAMES).toEqual(['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md']);
  });
});

// ── W2-5a Task 5: answerability, the same-millisecond count and sampling ─────────────────────────────────────────
// (W2-D70, W2-D34, W2-D71; D-5780). In-process only. Every store is built by hand under a mkTmp HOME, as
// history-card.test.ts's W1-B3 Task 4 builds one: createStore, then rows inserted directly, and each blob the sweep would
// index indexed through the sweep's own ftsTextOfBlob and indexBlob. Nothing here runs a pass, spawns a child, reads a
// roster, a live store or a live HOME, or reaches claude, ccrc or gh. The sampler's stages are recording stand-ins.
import { createHash as w5a5Hash } from 'node:crypto';
import type { DatabaseSync as W5a5Db } from 'node:sqlite';
import { describe as w5a5describe, expect as w5a5expect, it as w5a5it } from 'vitest';
import * as w5a5Drv from '../../deploy/history-replay.mjs';
import * as w5a5Lib from '../../ccd/history/lib.mjs';
import * as w5a5Gate from '../../deploy/history-gate.mjs';
import * as w5a5StoreMod from '../../ccd/history/store.mjs';
import * as w5a5SweepMod from '../../ccd/history/sweep.mjs';
import { mkTmp as w5a5MkTmp } from './tmpHelpers.js';
import * as w6Gate from '../../deploy/history-gate.mjs';
import { createHash as w6Hash } from 'node:crypto';

type W5a5Rng = { nextU32(): number };
type W5a5Cand = { id: string; kind: string; boundary_uuid: string; rank?: [number | string, number]; [k: string]: unknown };
type W5a5Verdict = { keep: true; candidate: W5a5Cand } | { keep: false; reason: string };
type W5a5Stage = (c: W5a5Cand, f: unknown) => Promise<W5a5Verdict>;
type W5a5Src = { via: 'entry' | 'sidecar'; entryId: number | null; blobId: number; name: string | null };
type W5a5Check = { ok: true; entryUuid: string } | { ok: false; clause: number; why: string };
type W5a5Answer = { state: 'answerable'; source: W5a5Src & { entryUuid: string } } | { state: 'untimed' } | { state: 'unanswerable' };
type W5a5Span = { tsMs: number; transcriptPk: number; spanEntryIds: number[] };
type W5a5Same = { tsMs: number; holdingFileId: number; transcriptPks: number[] };
type W5a5FamRef = { store_id: string; ccrc_id: string; generation: string };
type W5a5Quotas = { target: number; caps: { family: number; boundary: number; kind_per_family: number } };
type W5a5Sampled = { questions: W5a5Cand[]; families: string[]; drops: Record<string, Record<string, number>>; skips: Record<string, number>; reports: Record<string, unknown> };
/** The exports this task adds, typed for the test. The driver is JavaScript, so its inferred JSDoc types are loose. */
interface W5a5Api {
  QUIZ_STAGES: readonly string[];
  QUOTA_SKIPS: readonly string[];
  FACT_DROP_REASONS: readonly string[];
  RECON_DISCARDS: readonly string[];
  DRIVER_REASONS: readonly string[];
  SOURCE_FAILS: Readonly<Record<string, number>>;
  familyScopeOf(db: W5a5Db, f: { ccrc_id: string; generation: string }): number[];
  familyRng(seedHex: string, label: string, f: W5a5FamRef): W5a5Rng;
  checkSource(db: W5a5Db, idx: unknown, source: W5a5Src, factRaw: string, tsMs: number): Promise<W5a5Check>;
  answerability(db: W5a5Db, idx: unknown, ctx: W5a5Span, factRaw: string): Promise<W5a5Answer>;
  answerableStage(db: W5a5Db, idx: unknown, contextOf: (c: W5a5Cand) => W5a5Span & { factRaw: string }): W5a5Stage;
  asofSameMsHits(db: W5a5Db, ctx: W5a5Same, factRaw: string): number;
  sameMsReport(db: W5a5Db, contextOf: (c: W5a5Cand) => W5a5Same & { factRaw: string }): (c: W5a5Cand) => Promise<{ asof_same_ms_hits: number }>;
  seededOrder<T>(rng: W5a5Rng, items: readonly T[], keyOf: (x: T) => string): T[];
  quizRng(seedHex: string): W5a5Rng;
  pilotRng(seedHex: string): W5a5Rng;
  quizFamilyOrderKey(seedHex: string, f: W5a5FamRef): string;
  drawSeedHex(draw?: (n: number) => Uint8Array): string;
  quizPopulation<F extends W5a5FamRef & { admitted: number }>(families: F[], o: { pilotFamilies: W5a5FamRef[]; assignment: Array<W5a5FamRef & { arm: string }> }): { families: F[]; excluded: Record<string, number> };
  sampleQuestions(o: { families: unknown[]; rng: W5a5Rng; quotas: W5a5Quotas; stages: Record<string, W5a5Stage>; afterAdmit?: (c: W5a5Cand, f: unknown) => Promise<unknown>; candidateRng?: (f: W5a5FamRef) => W5a5Rng; familyOrder?: (f: W5a5FamRef) => string }): Promise<W5a5Sampled>;
  quizFloor(nQuestions: number, nFamilies: number, haltFloor: { questions: number; families: number }): { halt: boolean; short: string[] };
  sampleFidelityBoundaries(o: { families: unknown[]; rng: W5a5Rng; n: number; admitBoundary: (b: { boundary_uuid: string }, f: unknown) => Promise<{ keep: true } | { keep: false; reason: string }> }): Promise<{ boundaries: Array<{ family: W5a5FamRef; boundary: { boundary_uuid: string } }>; drops: Record<string, number> }>;
}
const w5a5D = w5a5Drv as unknown as W5a5Api;
const w5a5Sweep = w5a5SweepMod as unknown as {
  ftsTextOfBlob(z: Uint8Array, isSidecar: boolean, idx: unknown, rawLen: number): Promise<{ text: string | null; overCap?: boolean }>;
  indexBlob(db: W5a5Db, blobId: number, text: string, idx: unknown, overCap?: boolean): void;
};

w5a5describe('W2-5a Task 5: answerability, the same-millisecond count and sampling', () => {
  const D = w5a5D;
  const T = 1_760_000_000_000;              // boundary N's ts_ms: T_N
  const IDX = w5a5Lib.makePairIndex([]);    // no registered pair: redaction changes none of these texts
  const INDEXED = new Set<string>(w5a5Lib.INDEXED_PROVENANCE as readonly string[]);
  const UUID = (n: number): string => `5a5e0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  type RowSpec = { key: string; ts: number | null; provenance: string; text: string; files?: number[]; indexed?: boolean; variantText?: string };
  type SideSpec = { key: string; name: string; bytes: Buffer; linkTo: string | null; tpk?: number };
  type Fx = { dbFile: string; entry: Record<string, number>; blob: Record<string, number>; uuid: Record<string, string> };

  /** A store built by hand. Transcript 1 is this family's main transcript, with file 1 (N's holding copy) and file 2 (another
   *  copy of it). Transcript 2 is another family's, with file 3. Rows go in the order given, each a member of every file it
   *  lists (default file 1) at its own line. A row whose provenance the sweep indexes (INDEXED_PROVENANCE) is indexed
   *  through the sweep's own functions unless `indexed: false`, and so is every variant and sidecar. `edit` runs on the
   *  writer before it closes. */
  async function build(rows: RowSpec[], sides: SideSpec[] = [], edit?: (w: W5a5Db, fx: Fx) => void): Promise<Fx> {
    const home = w5a5MkTmp('w5a5-store-');
    w5a5StoreMod.createStore(home);
    const dbFile = w5a5Lib.historyPaths(home).dbFile;
    const w = w5a5StoreMod.openWriter(dbFile) as unknown as W5a5Db;
    w5a5StoreMod.createFtsTables(w);
    w.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?), (2, ?)').run(UUID(9001), UUID(9002));
    const file = w.prepare("INSERT INTO ingest_files (file_id, dev, ino, transcript_pk, status, parser_version) VALUES (?, 1, ?, ?, 'live', 1)");
    file.run(1, 5001, 1);
    file.run(2, 5002, 1);
    file.run(3, 5003, 2);
    const fx: Fx = { dbFile, entry: {}, blob: {}, uuid: {} };
    const blobOf = (bytes: Buffer): number => Number((w.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?) RETURNING blob_id')
      .get(w5a5Hash('sha256').update(bytes).digest(), w5a5StoreMod.CODEC, w5a5StoreMod.brotli(bytes), bytes.length) as { blob_id: number | bigint }).blob_id);
    const index = async (blobId: number, isSidecar: boolean): Promise<void> => {
      const b = w.prepare('SELECT z, raw_len FROM blobs WHERE blob_id = ?').get(blobId) as { z: Uint8Array; raw_len: number | bigint };
      const t = await w5a5Sweep.ftsTextOfBlob(b.z, isSidecar, IDX, Number(b.raw_len));
      w5a5Sweep.indexBlob(w, blobId, t.text ?? '', IDX, t.overCap === true);
    };
    const body = (text: string): Buffer => Buffer.from(w5a5Lib.canonicalJson([{ type: 'text', text }]));
    const ent = w.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', ?, 1, ?, ?, ?, ?) RETURNING entry_id");
    const member = w.prepare('INSERT INTO memberships (file_id, entry_id, line) VALUES (?, ?, ?)');
    for (const [i, r] of rows.entries()) {
      const files = r.files ?? [1];
      const blobId = blobOf(body(r.text));
      const id = Number((ent.get(UUID(i + 1), files.includes(3) ? 2 : 1, r.provenance, i, files[0]!, blobId, r.ts) as { entry_id: number | bigint }).entry_id);
      for (const f of files) member.run(f, id, i + 1);
      fx.entry[r.key] = id;
      fx.blob[r.key] = blobId;
      fx.uuid[r.key] = UUID(i + 1);
      if (r.indexed !== false && INDEXED.has(r.provenance)) await index(blobId, false);
      if (r.variantText !== undefined) {
        const v = blobOf(body(r.variantText));
        w.prepare("INSERT INTO entry_variants (entry_id, blob_id, first_file_id, first_seen_ms, cause) VALUES (?, ?, ?, 1, 'unknown')").run(id, v, files[0]!);
        fx.blob[`${r.key}:variant`] = v;
        await index(v, false);
      }
    }
    for (const s of sides) {
      const blobId = blobOf(s.bytes);
      w.prepare('INSERT INTO sidecars (transcript_pk, name, blob_id, entry_id, first_seen_ms) VALUES (?, ?, ?, ?, ?)')
        .run(s.tpk ?? 1, s.name, blobId, s.linkTo === null ? null : fx.entry[s.linkTo]!, T - 60_000);
      fx.blob[s.key] = blobId;
      await index(blobId, true);
    }
    edit?.(w, fx);
    w5a5StoreMod.closeWriter(w);
    return fx;
  }
  /** The driver's reads go through the read-only handle, as W2-D51's openReader route opens it. */
  async function withReader<R>(fx: Fx, fn: (db: W5a5Db) => Promise<R> | R): Promise<R> {
    const db = w5a5StoreMod.openReader(fx.dbFile) as unknown as W5a5Db;
    try { return await fn(db); } finally { db.close(); }
  }
  const span = (fx: Fx, keys: string[]): W5a5Span => ({ tsMs: T, transcriptPk: 1, spanEntryIds: keys.map((k) => fx.entry[k]!) });
  const ans = (fx: Fx, keys: string[], fact: string): Promise<W5a5Answer> => withReader(fx, (db) => D.answerability(db, IDX, span(fx, keys), fact));
  const check = (fx: Fx, src: W5a5Src, fact: string): Promise<W5a5Check> => withReader(fx, (db) => D.checkSource(db, IDX, src, fact, T));
  const rowSrc = (fx: Fx, key: string): W5a5Src => ({ via: 'entry', entryId: fx.entry[key]!, blobId: fx.blob[key]!, name: null });

  w5a5describe('answerability, W2-D70 and D-5780', () => {
    w5a5it('the words are fixed: the two drop words, appended to FACT_DROP_REASONS after Task 2\'s (R5), and each failure word with its clause', () => {
      w5a5expect(D.FACT_DROP_REASONS.slice(14, 16)).toEqual(['unanswerable', 'unanswerable-untimed']);
      w5a5expect(new Set(D.FACT_DROP_REASONS).size).toBe(D.FACT_DROP_REASONS.length);
      w5a5expect({ ...D.SOURCE_FAILS }).toEqual({
        'entry-absent': 1, provenance: 1, 'not-verbatim': 1, 'blob-absent': 2, 'not-indexed': 2, pruned: 2, 'no-match': 3, unlinked: 4, 'ts-null': 4, 'ts-after': 4,
      });
      w5a5expect(Object.isFrozen(D.SOURCE_FAILS)).toBe(true);
    });

    w5a5it('a fact in a stamped model row of the span is answerable, and the source is that row', async () => {
      const fx = await build([{ key: 'm', ts: T - 5000, provenance: 'model', text: 'run zqcmd51 now' }]);
      w5a5expect(await ans(fx, ['m'], 'zqcmd51 now')).toEqual({
        state: 'answerable', source: { via: 'entry', entryId: fx.entry.m, blobId: fx.blob.m, name: null, entryUuid: fx.uuid.m },
      });
    });

    w5a5it('clause 4: a source stamped exactly T_N is answerable, and one stamped one ms after T_N is untimed', async () => {
      const at = await build([{ key: 'r', ts: T, provenance: 'tool', text: 'zqat51 output' }]);
      w5a5expect((await ans(at, ['r'], 'zqat51 output')).state).toBe('answerable');
      const after = await build([{ key: 'r', ts: T + 1, provenance: 'tool', text: 'zqat51 output' }]);
      w5a5expect(await ans(after, ['r'], 'zqat51 output')).toEqual({ state: 'untimed' });
      w5a5expect(await check(after, rowSrc(after, 'r'), 'zqat51 output')).toEqual({ ok: false, clause: 4, why: 'ts-after' });
    });

    w5a5it('clause 4: a NULL-ts source is not answerable, and is untimed', async () => {
      const fx = await build([{ key: 'r', ts: null, provenance: 'tool', text: 'zqnull51 output' }]);
      w5a5expect(await ans(fx, ['r'], 'zqnull51 output')).toEqual({ state: 'untimed' });
      w5a5expect(await check(fx, rowSrc(fx, 'r'), 'zqnull51 output')).toEqual({ ok: false, clause: 4, why: 'ts-null' });
    });

    w5a5it('clause 1: a harness row and an indexed recall-echo row are not sources; CONTROL: the same text in a tool row is', async () => {
      const harness = await build([{ key: 'h', ts: T - 1000, provenance: 'harness', text: 'zqmeta51 injected' }]);
      w5a5expect(await ans(harness, ['h'], 'zqmeta51 injected')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(harness, rowSrc(harness, 'h'), 'zqmeta51 injected')).toEqual({ ok: false, clause: 1, why: 'provenance' });
      const echo = await build([{ key: 'e', ts: T - 1000, provenance: 'recall-echo', text: 'zqecho51 result' }]);
      w5a5expect(await ans(echo, ['e'], 'zqecho51 result')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(echo, rowSrc(echo, 'e'), 'zqecho51 result')).toEqual({ ok: false, clause: 1, why: 'provenance' });
      const tool = await build([{ key: 'e', ts: T - 1000, provenance: 'tool', text: 'zqecho51 result' }]);
      w5a5expect((await ans(tool, ['e'], 'zqecho51 result')).state).toBe('answerable');
    });

    w5a5it('clause 2: a blob marked unindexed, and a pruned blob, are not sources even with their index row still present', async () => {
      const cold = await build([{ key: 'r', ts: T - 1000, provenance: 'tool', text: 'zqcold51 output' }], [],
        (w, fx) => { w.prepare('UPDATE blobs SET fts_indexed = 0 WHERE blob_id = ?').run(fx.blob.r!); });
      w5a5expect(await ans(cold, ['r'], 'zqcold51 output')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(cold, rowSrc(cold, 'r'), 'zqcold51 output')).toEqual({ ok: false, clause: 2, why: 'not-indexed' });
      const pruned = await build([{ key: 'r', ts: T - 1000, provenance: 'tool', text: 'zqgone51 output' }], [],
        (w, fx) => { w.prepare('UPDATE blobs SET z = NULL, pruned_ms = ? WHERE blob_id = ?').run(T, fx.blob.r!); });
      w5a5expect(await ans(pruned, ['r'], 'zqgone51 output')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(pruned, rowSrc(pruned, 'r'), 'zqgone51 output')).toEqual({ ok: false, clause: 2, why: 'pruned' });
    });

    w5a5it('clause 3: a source the index MATCH does not return is not answerable', async () => {
      const fx = await build([{ key: 'r', ts: T - 1000, provenance: 'tool', text: 'zqmiss51 output' }], [],
        (w, f) => { w.prepare('DELETE FROM blobs_fts WHERE rowid = ?').run(f.blob.r!); });
      w5a5expect(await ans(fx, ['r'], 'zqmiss51 output')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(fx, rowSrc(fx, 'r'), 'zqmiss51 output')).toEqual({ ok: false, clause: 3, why: 'no-match' });
    });

    w5a5it('clause 1: a phrase the MATCH finds but the index text does not hold verbatim is not answerable; CONTROL: the verbatim fact is', async () => {
      const fx = await build([{ key: 'r', ts: T - 1000, provenance: 'tool', text: 'zqrun51 zqtest51:zqunit51 now' }]);
      w5a5expect(await ans(fx, ['r'], 'zqrun51 zqtest51-zqunit51')).toEqual({ state: 'unanswerable' });
      w5a5expect(await check(fx, rowSrc(fx, 'r'), 'zqrun51 zqtest51-zqunit51')).toEqual({ ok: false, clause: 1, why: 'not-verbatim' });
      w5a5expect((await ans(fx, ['r'], 'zqrun51 zqtest51:zqunit51')).state).toBe('answerable');
    });

    w5a5it('the sidecar window: a fact past SIDECAR_FTS_BYTES is not answerable, and one inside it is', async () => {
      const bytes = Buffer.from(`zqhead51 ${'x '.repeat(270_000)}zqtail51\n`);
      w5a5expect(bytes.indexOf('zqtail51'), 'CONTROL: the tail starts past the window').toBeGreaterThan(w5a5Lib.SIDECAR_FTS_BYTES);
      const fx = await build([{ key: 'tr', ts: T - 2000, provenance: 'tool', text: 'Output too large. Full output saved to: tool-results/big51.txt' }],
        [{ key: 's', name: 'big51.txt', bytes, linkTo: 'tr' }]);
      w5a5expect(await ans(fx, ['tr'], 'zqhead51')).toEqual({
        state: 'answerable', source: { via: 'sidecar', entryId: fx.entry.tr, blobId: fx.blob.s, name: 'big51.txt', entryUuid: fx.uuid.tr },
      });
      w5a5expect(await ans(fx, ['tr'], 'zqtail51')).toEqual({ state: 'unanswerable' });
    });

    w5a5it('clause 4: an unlinked sidecar is untimed; CONTROL: the same sidecar linked to a stamped span row is answerable', async () => {
      const side = (linkTo: string | null): SideSpec[] => [{ key: 's', name: 'toolu_01SIDE51.txt', bytes: Buffer.from('zqside51 body\n'), linkTo }];
      const row: RowSpec[] = [{ key: 'tr', ts: T - 2000, provenance: 'tool', text: 'saved elsewhere' }];
      const unlinked = await build(row, side(null));
      w5a5expect(await ans(unlinked, ['tr'], 'zqside51 body')).toEqual({ state: 'untimed' });
      w5a5expect(await check(unlinked, { via: 'sidecar', entryId: null, blobId: unlinked.blob.s!, name: 'toolu_01SIDE51.txt' }, 'zqside51 body'))
        .toEqual({ ok: false, clause: 4, why: 'unlinked' });
      const linked = await build(row, side('tr'));
      w5a5expect((await ans(linked, ['tr'], 'zqside51 body'))).toEqual({
        state: 'answerable', source: { via: 'sidecar', entryId: linked.entry.tr, blobId: linked.blob.s, name: 'toolu_01SIDE51.txt', entryUuid: linked.uuid.tr },
      });
    });

    w5a5it('clause 4: a sidecar linked to a NULL-ts span row is untimed, though the sidecar has a first-seen time', async () => {
      const fx = await build([{ key: 'tr', ts: null, provenance: 'tool', text: 'saved elsewhere' }],
        [{ key: 's', name: 'toolu_01SIDE52.txt', bytes: Buffer.from('zqside52 body\n'), linkTo: 'tr' }]);
      w5a5expect(await ans(fx, ['tr'], 'zqside52 body')).toEqual({ state: 'untimed' });
      w5a5expect(await check(fx, { via: 'sidecar', entryId: fx.entry.tr!, blobId: fx.blob.s!, name: 'toolu_01SIDE52.txt' }, 'zqside52 body'))
        .toEqual({ ok: false, clause: 4, why: 'ts-null' });
    });

    w5a5it('a sidecar linked to a row outside the span is never a source', async () => {
      const fx = await build([
        { key: 'tr', ts: T - 2000, provenance: 'tool', text: 'nothing here' },
        { key: 'post', ts: T + 5000, provenance: 'tool', text: 'a later result' },
      ], [{ key: 's', name: 'toolu_01SIDE53.txt', bytes: Buffer.from('zqside53 body\n'), linkTo: 'post' }]);
      w5a5expect(await ans(fx, ['tr'], 'zqside53 body')).toEqual({ state: 'unanswerable' });
    });

    w5a5it('sources are tried rows first, in span order, then sidecars: a fact in both answers from the row', async () => {
      const fx = await build([{ key: 'r', ts: T - 3000, provenance: 'tool', text: 'zqboth51 in the row' }],
        [{ key: 's', name: 'toolu_01SIDE54.txt', bytes: Buffer.from('zqboth51 in the sidecar\n'), linkTo: 'r' }]);
      const a = await ans(fx, ['r'], 'zqboth51');
      w5a5expect(a.state === 'answerable' ? a.source.via : a.state).toBe('entry');
    });

    w5a5it('answerableStage keeps an answerable candidate with its source, and drops the rest as unanswerable or unanswerable-untimed', async () => {
      const fx = await build([
        { key: 'good', ts: T - 3000, provenance: 'tool', text: 'zqgood51 output' },
        { key: 'null', ts: null, provenance: 'tool', text: 'zqnull53 output' },
        { key: 'cold', ts: T - 3000, provenance: 'tool', text: 'zqcold53 output', indexed: false },
      ]);
      const verdicts = await withReader(fx, async (db) => {
        const stage = D.answerableStage(db, IDX, (c) => ({ ...span(fx, ['good', 'null', 'cold']), factRaw: c.fact_raw as string }));
        const out: Record<string, W5a5Verdict> = {};
        for (const f of ['zqgood51 output', 'zqnull53 output', 'zqcold53 output']) out[f] = await stage({ id: f, kind: 'error', boundary_uuid: UUID(7000), fact_raw: f }, null);
        return out;
      });
      w5a5expect(verdicts['zqgood51 output']).toEqual({
        keep: true,
        candidate: { id: 'zqgood51 output', kind: 'error', boundary_uuid: UUID(7000), fact_raw: 'zqgood51 output', source: { via: 'entry', entryId: fx.entry.good, blobId: fx.blob.good, name: null, entryUuid: fx.uuid.good } },
      });
      w5a5expect(verdicts['zqnull53 output']).toEqual({ keep: false, reason: 'unanswerable-untimed' });
      w5a5expect(verdicts['zqcold53 output']).toEqual({ keep: false, reason: 'unanswerable' });
    });
  });

  w5a5describe('the same-millisecond count, W2-D34', () => {
    /** One fact, zqsame51, planted in every shape the count must tell apart. Expected: 4 (out, outVariant, outSide, outDual). */
    const SAME_ROWS: RowSpec[] = [
      { key: 'holdAfter', files: [1], ts: T, provenance: 'tool', text: 'zqsame51 in the holding copy' },
      { key: 'both', files: [1, 2], ts: T, provenance: 'tool', text: 'zqsame51 in both copies' },
      { key: 'out', files: [2], ts: T, provenance: 'tool', text: 'zqsame51 outside' },
      { key: 'outBefore', files: [2], ts: T - 1, provenance: 'tool', text: 'zqsame51 one ms before' },
      { key: 'outAfter', files: [2], ts: T + 1, provenance: 'tool', text: 'zqsame51 one ms after' },
      { key: 'outNull', files: [2], ts: null, provenance: 'tool', text: 'zqsame51 with no stamp' },
      { key: 'outEcho', files: [2], ts: T, provenance: 'recall-echo', text: 'zqsame51 echoed' },
      { key: 'outVariant', files: [2], ts: T, provenance: 'tool', text: 'no fact here a', variantText: 'zqsame51 in a variant' },
      { key: 'outSide', files: [2], ts: T, provenance: 'tool', text: 'no fact here b' },
      { key: 'outDual', files: [2], ts: T, provenance: 'tool', text: 'zqsame51 in a row and its sidecar' },
      { key: 'otherFamily', files: [3], ts: T, provenance: 'tool', text: 'zqsame51 in another family' },
    ];
    const SAME_SIDES: SideSpec[] = [
      { key: 'sSide', name: 'toolu_01SAME51.txt', bytes: Buffer.from('zqsame51 in a sidecar\n'), linkTo: 'outSide' },
      { key: 'sDual', name: 'toolu_01SAME52.txt', bytes: Buffer.from('zqsame51 in the dual sidecar\n'), linkTo: 'outDual' },
      { key: 'sLoose', name: 'toolu_01SAME53.txt', bytes: Buffer.from('zqsame51 unlinked\n'), linkTo: null },
    ];
    const CTX: W5a5Same = { tsMs: T, holdingFileId: 1, transcriptPks: [1] };

    w5a5it('counts the entries outside N holding copy, in the family, searchable, stamped exactly T_N, by row, variant or sidecar, each once', async () => {
      const fx = await build(SAME_ROWS, SAME_SIDES);
      await withReader(fx, (db) => {
        w5a5expect(D.asofSameMsHits(db, CTX, 'zqsame51')).toBe(4);
        w5a5expect(D.asofSameMsHits(db, CTX, 'zqabsent51')).toBe(0);
      });
    });

    w5a5it('familyScopeOf is recall.mjs\'s own family scope: a confirmed epoch\'s transcript that holds rows, never an unconfirmed epoch\'s or another family\'s (R6)', async () => {
      const home = w5a5MkTmp('w5a5-scope-');
      w5a5StoreMod.createStore(home);
      const dbFile = w5a5Lib.historyPaths(home).dbFile;
      const w = w5a5StoreMod.openWriter(dbFile) as unknown as W5a5Db;
      w.prepare("INSERT INTO sessions (session_pk, ccrc_id, generation, project, first_seen_ms) VALUES (1, 'fam-a', 'g1', 'demo', 1), (2, 'fam-b', 'g1', 'demo', 2)").run();
      const ep = w.prepare("INSERT INTO epochs (session_pk, seq, cc_session_uuid, cause, declared_by, confirmed_ms) VALUES (?, ?, ?, 'startup', 'hook', ?)");
      ep.run(1, 1, UUID(9101), 1);
      ep.run(1, 2, UUID(9102), null);
      ep.run(2, 1, UUID(9103), 1);
      w.prepare('INSERT INTO transcripts (transcript_pk, cc_session_uuid) VALUES (1, ?), (2, ?), (3, ?)').run(UUID(9101), UUID(9102), UUID(9103));
      const bytes = Buffer.from(w5a5Lib.canonicalJson([{ type: 'text', text: 'scope' }]));
      const blobId = Number((w.prepare('INSERT INTO blobs (sha256, codec, z, raw_len) VALUES (?, ?, ?, ?) RETURNING blob_id')
        .get(w5a5Hash('sha256').update(bytes).digest(), w5a5StoreMod.CODEC, w5a5StoreMod.brotli(bytes), bytes.length) as { blob_id: number | bigint }).blob_id);
      const ent = w.prepare("INSERT INTO entries (uuid, transcript_pk, type, provenance, prov_version, struct_rank_ns, struct_file_id, blob_id, ts_ms) VALUES (?, ?, 'user', 'operator', 1, 0, 0, ?, ?)");
      for (const t of [1, 2, 3]) ent.run(UUID(9200 + t), t, blobId, T - 1000);
      w5a5StoreMod.closeWriter(w);
      const fx: Fx = { dbFile, entry: {}, blob: {}, uuid: {} };
      w5a5expect(await withReader(fx, (db) => D.familyScopeOf(db, { ccrc_id: 'fam-a', generation: 'g1' }))).toEqual([1]);
      // CONTROL: every transcript of the family's epochs, the second family rule R6 forbids, would also take the unconfirmed one.
      const naive = await withReader(fx, (db) => (db.prepare(`SELECT DISTINCT t.transcript_pk AS p FROM epochs e
        JOIN transcripts t ON t.cc_session_uuid = e.cc_session_uuid WHERE e.session_pk = 1 ORDER BY p`).all() as Array<{ p: number | bigint }>).map((r) => Number(r.p)));
      w5a5expect(naive).toEqual([1, 2]);
    });

    w5a5it('sameMsReport answers the count per admitted candidate, as a report', async () => {
      const fx = await build(SAME_ROWS, SAME_SIDES);
      const rep = await withReader(fx, (db) => D.sameMsReport(db, (c) => ({ ...CTX, factRaw: c.fact_raw as string }))({ id: 'q1', kind: 'error', boundary_uuid: UUID(7001), fact_raw: 'zqsame51' }));
      w5a5expect(rep).toEqual({ asof_same_ms_hits: 4 });
    });
  });

  w5a5describe('sampling, W2-D71', () => {
    const SEED = 'ab'.repeat(32);
    const L8 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const BIG: W5a5Quotas = { target: 1000, caps: { family: 1000, boundary: 1000, kind_per_family: 1000 } };
    type Fam = W5a5FamRef & { admitted: number; calls: number; candidates: () => Promise<W5a5Cand[]> };
    const fam = (ccrc: string, cands: W5a5Cand[], o: { store?: string; gen?: string; admitted?: number } = {}): Fam => {
      const f: Fam = {
        store_id: o.store ?? 's1', ccrc_id: ccrc, generation: o.gen ?? 'g1', admitted: o.admitted ?? 1, calls: 0,
        candidates: async () => { f.calls += 1; return cands; },
      };
      return f;
    };
    const cand = (id: string, kind = 'sha', boundary = `b-${id}`): W5a5Cand => ({ id, kind, boundary_uuid: boundary });
    const recorder = (log: string[], drop: Record<string, Record<string, string>> = {}): Record<string, W5a5Stage> => Object.fromEntries(
      D.QUIZ_STAGES.map((n) => [n, async (c: W5a5Cand): Promise<W5a5Verdict> => {
        log.push(`${n}:${c.id}`);
        const reason = drop[n]?.[c.id];
        return reason === undefined ? { keep: true, candidate: c } : { keep: false, reason };
      }]));
    const ids = (r: W5a5Sampled): string[] => r.questions.map((q) => q.id);
    const fk = (f: W5a5FamRef): string => w5a5Gate.familyKey(f.store_id, f.ccrc_id, f.generation);

    w5a5it('the stage order and the quota words are fixed', () => {
      w5a5expect([...D.QUIZ_STAGES]).toEqual(['redaction', 'producer', 'admit-baseline', 'answerable', 'writer', 'admit-question']);
      w5a5expect([...D.QUOTA_SKIPS]).toEqual(['cap-family', 'cap-boundary', 'cap-kind']);
      w5a5expect(Object.isFrozen(D.QUIZ_STAGES) && Object.isFrozen(D.QUOTA_SKIPS)).toBe(true);
    });

    w5a5it('seededOrder sorts by key, then draws its order: a recorded vector for each substream, and input order never moves it', () => {
      w5a5expect(D.seededOrder(D.quizRng(SEED), L8, (x) => x)).toEqual(['f', 'a', 'g', 'b', 'd', 'h', 'e', 'c']);
      w5a5expect(D.seededOrder(D.quizRng(SEED), [...L8].reverse(), (x) => x)).toEqual(['f', 'a', 'g', 'b', 'd', 'h', 'e', 'c']);
      w5a5expect(D.seededOrder(D.pilotRng(SEED), L8, (x) => x)).toEqual(['h', 'b', 'f', 'e', 'c', 'g', 'd', 'a']);
      const rng = D.quizRng(SEED);
      D.seededOrder(rng, L8, (x) => x);
      w5a5expect(D.seededOrder(rng, ['x1', 'x2', 'x3', 'x4'], (x) => x), 'a second order continues the same stream').toEqual(['x4', 'x3', 'x1', 'x2']);
    });

    w5a5it('seededOrder refuses a key listed twice', () => {
      w5a5expect(() => D.seededOrder(D.quizRng(SEED), ['k1', 'k1'], (x) => x)).toThrow(/listed twice/);
    });

    w5a5it('drawSeedHex is 32 drawn bytes as 64 lowercase hex, and refuses a draw of another length', () => {
      w5a5expect(D.drawSeedHex(() => new Uint8Array(32).fill(0xab))).toBe('ab'.repeat(32));
      const a = D.drawSeedHex();
      w5a5expect(a).toMatch(/^[0-9a-f]{64}$/);
      w5a5expect(D.drawSeedHex()).not.toBe(a);
      w5a5expect(() => D.drawSeedHex(() => new Uint8Array(16))).toThrow(/32 bytes/);
    });

    w5a5it('families in seeded order, then the candidates of each family, all from one stream: a recorded vector', async () => {
      const lists: Record<string, W5a5Cand[]> = {
        'fam-c': [cand('c2'), cand('c1'), cand('c3')], 'fam-a': [cand('a1'), cand('a3'), cand('a2')], 'fam-b': [cand('b3'), cand('b1'), cand('b2')],
      };
      const fams = Object.entries(lists).map(([id, cs]) => fam(id, cs));
      const r = await D.sampleQuestions({ families: fams, rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]) });
      w5a5expect(ids(r)).toEqual(['a2', 'a3', 'a1', 'b1', 'b2', 'b3', 'c1', 'c3', 'c2']);
      w5a5expect(r.families).toEqual(fams.map(fk).sort());
      const rev = Object.entries(lists).reverse().map(([id, cs]) => fam(id, [...cs].reverse()));
      const again = await D.sampleQuestions({ families: rev, rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]) });
      w5a5expect(ids(again), 'the same seed and inputs in another order give the same list').toEqual(ids(r));
    });

    w5a5it('the stages run in QUIZ_STAGES order, whatever order the stages object lists them in', async () => {
      const log: string[] = [];
      const stages = Object.fromEntries(Object.entries(recorder(log)).reverse());
      await D.sampleQuestions({ families: [fam('fam-a', [cand('o1')])], rng: D.quizRng(SEED), quotas: BIG, stages });
      w5a5expect(log).toEqual(D.QUIZ_STAGES.map((n) => `${n}:o1`));
    });

    w5a5it('lazy: a candidate a stage drops reaches no later stage, and the drop is counted under that stage', async () => {
      const log: string[] = [];
      const r = await D.sampleQuestions({
        families: [fam('fam-a', [cand('c1'), cand('c2', 'path')])], rng: D.quizRng(SEED), quotas: BIG,
        stages: recorder(log, { 'admit-baseline': { c1: 'in-baseline' } }),
      });
      w5a5expect(log.filter((l) => l.endsWith(':c1'))).toEqual(['redaction:c1', 'producer:c1', 'admit-baseline:c1']);
      w5a5expect(r.drops['admit-baseline']).toEqual({ 'in-baseline': 1 });
      w5a5expect(ids(r)).toEqual(['c2']);
    });

    w5a5it('the family cap: five questions, the rest skipped before any stage', async () => {
      const kinds = ['sha', 'path', 'command', 'error'];
      const log: string[] = [];
      const r = await D.sampleQuestions({
        families: [fam('fam-a', Array.from({ length: 7 }, (_, i) => cand(`k${i}`, kinds[i % 4]!)))], rng: D.quizRng(SEED),
        quotas: { target: 1000, caps: { family: 5, boundary: 1000, kind_per_family: 1000 } }, stages: recorder(log),
      });
      w5a5expect(r.questions.length).toBe(5);
      w5a5expect(r.skips).toEqual({ 'cap-family': 2, 'cap-boundary': 0, 'cap-kind': 0 });
      w5a5expect(log.filter((l) => l.startsWith('redaction:')).length).toBe(5);
    });

    w5a5it('the boundary cap: three questions from one boundary', async () => {
      const kinds = ['sha', 'path', 'command', 'error', 'sha'];
      const r = await D.sampleQuestions({
        families: [fam('fam-a', kinds.map((k, i) => cand(`b${i}`, k, 'b-one')))], rng: D.quizRng(SEED),
        quotas: { target: 1000, caps: { family: 1000, boundary: 3, kind_per_family: 1000 } }, stages: recorder([]),
      });
      w5a5expect(r.questions.length).toBe(3);
      w5a5expect(r.skips).toEqual({ 'cap-family': 0, 'cap-boundary': 2, 'cap-kind': 0 });
    });

    w5a5it('the kind cap: two questions of one kind in a family', async () => {
      const r = await D.sampleQuestions({
        families: [fam('fam-a', [cand('s1'), cand('s2'), cand('s3'), cand('s4'), cand('p1', 'path')])], rng: D.quizRng(SEED),
        quotas: { target: 1000, caps: { family: 1000, boundary: 1000, kind_per_family: 2 } }, stages: recorder([]),
      });
      w5a5expect(r.questions.map((q) => q.kind).sort()).toEqual(['path', 'sha', 'sha']);
      w5a5expect(r.skips).toEqual({ 'cap-family': 0, 'cap-boundary': 0, 'cap-kind': 2 });
    });

    w5a5it('a cap counts admitted questions only: a candidate the writer drops does not use the family cap', async () => {
      w5a5expect(D.seededOrder(D.quizRng(SEED), ['d1', 'd2', 'd3'], (x) => x), 'CONTROL: d1 is drawn first').toEqual(['d1', 'd2', 'd3']);
      const r = await D.sampleQuestions({
        families: [fam('fam-a', [cand('d1'), cand('d2', 'path'), cand('d3', 'command')])], rng: D.quizRng(SEED),
        quotas: { target: 1000, caps: { family: 2, boundary: 1000, kind_per_family: 1000 } }, stages: recorder([], { writer: { d1: 'writer-leak' } }),
      });
      w5a5expect(ids(r)).toEqual(['d2', 'd3']);
      w5a5expect(r.drops.writer).toEqual({ 'writer-leak': 1 });
    });

    w5a5it('each question carries its rank, [family rank, candidate rank]; with candidateRng a family\'s ranks do not depend on what other families hold (R4)', async () => {
      const cr = (f: W5a5FamRef): W5a5Rng => D.familyRng(SEED, 'quiz-sample', f);
      const lists: Record<string, W5a5Cand[]> = {
        'fam-a': ['a1', 'a2', 'a3', 'a4'].map((n) => cand(n)), 'fam-b': ['b1', 'b2', 'b3', 'b4'].map((n) => cand(n)), 'fam-c': ['c1', 'c2', 'c3', 'c4'].map((n) => cand(n)),
      };
      const rankOf = (r: W5a5Sampled): Record<string, string> => Object.fromEntries(r.questions.map((q) => [q.id, JSON.stringify(q.rank)]));
      const whole = rankOf(await D.sampleQuestions({ families: Object.entries(lists).map(([id, cs]) => fam(id, cs)), rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]), candidateRng: cr }));
      w5a5expect(Object.keys(whole)).toHaveLength(12);
      w5a5expect(new Set(Object.values(whole)).size, 'no two questions share a rank').toBe(12);
      for (const only of Object.keys(lists)) {
        // A node that holds one family walks the same global list, the others empty, and ranks its own as the whole walk does.
        const local = rankOf(await D.sampleQuestions({ families: Object.entries(lists).map(([id, cs]) => fam(id, id === only ? cs : [])), rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]), candidateRng: cr }));
        w5a5expect(local, only).toEqual(Object.fromEntries(Object.entries(whole).filter(([id]) => id.startsWith(only.slice(-1)))));
      }
    });

    w5a5it('the quiz\'s keyed family order (W2-D71 as amended 2026-10-22; R10): families sorted by quizFamilyOrderKey, each question ranked [key, candidate rank], and two nodes\' outputs merged by rank are the one walk over both', async () => {
      const cr = (f: W5a5FamRef): W5a5Rng => D.familyRng(SEED, 'quiz-sample', f);
      const ko = (f: W5a5FamRef): string => D.quizFamilyOrderKey(SEED, f);
      // The key, recomputed from its definition: the 'quiz-sample' substream's seed hashed with familyKey.
      const sub = w5a5Hash('sha256').update(`${SEED}:quiz-sample`).digest('hex');
      const refA: W5a5FamRef = { store_id: 's1', ccrc_id: 'fam-a', generation: 'g1' };
      w5a5expect(ko(refA)).toBe(w5a5Hash('sha256').update(`${sub}:${fk(refA)}`).digest('hex'));
      w5a5expect(ko(refA)).toMatch(/^[0-9a-f]{64}$/);
      const lists: Record<string, W5a5Cand[]> = {
        'fam-a': ['a1', 'a2', 'a3'].map((n) => cand(n)), 'fam-b': ['b1', 'b2', 'b3'].map((n) => cand(n)),
        'fam-c': ['c1', 'c2', 'c3'].map((n) => cand(n)), 'fam-d': ['d1', 'd2', 'd3'].map((n) => cand(n)),
      };
      const walk = (held: string[], target: number): Promise<W5a5Sampled> => D.sampleQuestions({
        families: held.map((id) => fam(id, lists[id]!)), rng: D.quizRng(SEED), quotas: { ...BIG, target }, stages: recorder([]),
        candidateRng: cr, familyOrder: ko,
      });
      const all = await walk(['fam-a', 'fam-b', 'fam-c', 'fam-d'], 1000);
      // A recorded vector: the keys sort fam-a, fam-d, fam-b, fam-c; each family's candidates come from its own stream.
      w5a5expect(ids(all)).toEqual(['a3', 'a2', 'a1', 'd2', 'd1', 'd3', 'b1', 'b3', 'b2', 'c2', 'c1', 'c3']);
      w5a5expect(all.questions.map((q) => q.rank)).toEqual(['fam-a', 'fam-d', 'fam-b', 'fam-c'].flatMap((id) =>
        [0, 1, 2].map((ci) => [ko({ store_id: 's1', ccrc_id: id, generation: 'g1' }), ci])));
      const again = await walk(['fam-d', 'fam-c', 'fam-b', 'fam-a'], 1000);
      w5a5expect(ids(again), 'input order never moves the keyed order').toEqual(ids(all));
      // Two nodes, each holding the families the other's sit between in the key order, and no list of the other's.
      const cmp = (x: string | number, y: string | number): number => (x < y ? -1 : x > y ? 1 : 0);
      const byRank = (x: W5a5Cand, y: W5a5Cand): number => cmp(x.rank![0], y.rank![0]) || cmp(x.rank![1], y.rank![1]);
      for (const target of [1000, 5]) {
        const one = await walk(['fam-a', 'fam-b', 'fam-c', 'fam-d'], target);
        const nodeA = await walk(['fam-a', 'fam-b'], target);
        const nodeB = await walk(['fam-d', 'fam-c'], target);
        const merged = [...nodeA.questions, ...nodeB.questions].sort(byRank).slice(0, target);
        w5a5expect(merged.map((q) => [q.id, q.rank]), `target ${target}`).toEqual(one.questions.map((q) => [q.id, q.rank]));
        if (target === 5) {
          w5a5expect(ids(one)).toEqual(['a3', 'a2', 'a1', 'd2', 'd1']);
          w5a5expect([...nodeA.questions, ...nodeB.questions].slice(0, target).map((q) => q.id),
            'CONTROL: the nodes\' lists concatenated are not the walk; only the rank order merges them').toEqual(['a3', 'a2', 'a1', 'b1', 'b3']);
        }
      }
      await w5a5expect(D.sampleQuestions({ families: [fam('fam-a', [cand('x1')]), fam('fam-a', [cand('x2')])], rng: D.quizRng(SEED),
        quotas: BIG, stages: recorder([]), candidateRng: cr, familyOrder: ko })).rejects.toThrow(/listed twice/);
    });

    w5a5it('the target stops the draw: no further stage runs, and a family not reached is never mined', async () => {
      const log: string[] = [];
      const fams = [fam('fam-a', ['1', '2', '3', '4', '5'].map((n) => cand(`a${n}`))), fam('fam-b', ['1', '2', '3', '4', '5'].map((n) => cand(`b${n}`)))];
      const r = await D.sampleQuestions({ families: fams, rng: D.quizRng(SEED), quotas: { ...BIG, target: 3 }, stages: recorder(log) });
      w5a5expect(r.questions.length).toBe(3);
      w5a5expect(log.filter((l) => l.startsWith('writer:')).length).toBe(3);
      w5a5expect(fams[0]!.calls + fams[1]!.calls).toBe(1);
    });

    w5a5it('the same-millisecond report never gates: the list is the same with and without it, and each question carries its report', async () => {
      const make = (): Fam[] => [fam('fam-a', [cand('a1'), cand('a2', 'path')]), fam('fam-b', [cand('b1')])];
      const plain = await D.sampleQuestions({ families: make(), rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]) });
      const withRep = await D.sampleQuestions({
        families: make(), rng: D.quizRng(SEED), quotas: BIG, stages: recorder([]), afterAdmit: async () => ({ asof_same_ms_hits: 7 }),
      });
      w5a5expect(ids(withRep)).toEqual(ids(plain));
      w5a5expect(plain.reports).toEqual({});
      w5a5expect(withRep.reports).toEqual(Object.fromEntries(ids(plain).map((id) => [id, { asof_same_ms_hits: 7 }])));
    });

    w5a5it('malformed sampler inputs are defects: a missing or unknown stage, a drop with no reason, a bad quota, a bad kind, a repeated id', async () => {
      const one = (): Fam[] => [fam('fam-a', [cand('x1')])];
      const stages = recorder([]);
      const noWriter = Object.fromEntries(Object.entries(stages).filter(([k]) => k !== 'writer'));
      await w5a5expect(D.sampleQuestions({ families: one(), rng: D.quizRng(SEED), quotas: BIG, stages: noWriter })).rejects.toThrow(/no 'writer' stage/);
      await w5a5expect(D.sampleQuestions({ families: one(), rng: D.quizRng(SEED), quotas: BIG, stages: { ...stages, judge: stages.writer! } })).rejects.toThrow(/'judge' is an unknown stage/);
      await w5a5expect(D.sampleQuestions({ families: one(), rng: D.quizRng(SEED), quotas: BIG, stages: recorder([], { producer: { x1: '' } }) })).rejects.toThrow(/without a reason word/);
      await w5a5expect(D.sampleQuestions({ families: one(), rng: D.quizRng(SEED), quotas: { ...BIG, target: 0 }, stages })).rejects.toThrow(/not a positive integer/);
      await w5a5expect(D.sampleQuestions({ families: one(), rng: D.quizRng(SEED), quotas: { ...BIG, caps: { ...BIG.caps, boundary: 0 } }, stages })).rejects.toThrow(/caps\.boundary=0 is not a positive integer/);
      await w5a5expect(D.sampleQuestions({ families: [fam('fam-a', [cand('y1', 'decision')])], rng: D.quizRng(SEED), quotas: BIG, stages })).rejects.toThrow(/has kind/);
      await w5a5expect(D.sampleQuestions({ families: [fam('fam-a', [cand('z1'), cand('z1', 'path')])], rng: D.quizRng(SEED), quotas: BIG, stages })).rejects.toThrow(/listed twice/);
    });

    w5a5it('the population drops families with no admitted boundary, pilot families, and every family of a control-assigned store and id', () => {
      const F = (store: string, ccrc: string, gen: string, admitted = 1): W5a5FamRef & { admitted: number } => ({ store_id: store, ccrc_id: ccrc, generation: gen, admitted });
      const a1 = F('s1', 'fam-a', 'g1', 2); const a2 = F('s1', 'fam-a', 'g2'); const b1 = F('s1', 'fam-b', 'g1'); const b2 = F('s1', 'fam-b', 'g2');
      const a3 = F('s2', 'fam-a', 'g1'); const c1 = F('s1', 'fam-c', 'g1'); const c2 = F('s1', 'fam-c', 'g2'); const d1 = F('s1', 'fam-d', 'g1', 0);
      const r = D.quizPopulation([a1, a2, b1, b2, a3, c1, c2, d1], {
        pilotFamilies: [c1],
        assignment: [{ ...a1, arm: 'control' }, { ...b1, arm: 'treatment' }, { ...a3, arm: 'treatment' }],
      });
      w5a5expect(r.families).toEqual([b1, b2, a3, c2]);
      w5a5expect(r.excluded).toEqual({ 'no-admitted-boundary': 1, pilot: 1, 'control-id': 2 });
      w5a5expect(() => D.quizPopulation([b1], { pilotFamilies: [], assignment: [{ ...b1, arm: 'holdout' }] })).toThrow(/not an assignment arm/);
    });

    w5a5it('the halt floor: fewer than 60 questions or fewer than 12 families halts, and exactly the floor does not', () => {
      const floor = { questions: 60, families: 12 };
      w5a5expect(D.quizFloor(60, 12, floor)).toEqual({ halt: false, short: [] });
      w5a5expect(D.quizFloor(59, 12, floor)).toEqual({ halt: true, short: ['questions'] });
      w5a5expect(D.quizFloor(60, 11, floor)).toEqual({ halt: true, short: ['families'] });
      w5a5expect(D.quizFloor(0, 0, floor)).toEqual({ halt: true, short: ['questions', 'families'] });
    });

    w5a5it('fidelity boundaries: at most one per family, in seeded family order, a dropped boundary counted, and a family not reached never read', async () => {
      type FFam = W5a5FamRef & { calls: number; boundaries: () => Promise<Array<{ boundary_uuid: string }>> };
      const ffam = (id: string): FFam => {
        const f: FFam = { store_id: 's1', ccrc_id: id, generation: 'g1', calls: 0, boundaries: async () => { f.calls += 1; return [{ boundary_uuid: `${id}-b1` }, { boundary_uuid: `${id}-b2` }]; } };
        return f;
      };
      const four = (): FFam[] => ['fam-a', 'fam-b', 'fam-c', 'fam-d'].map(ffam);
      const fams = four();
      const two = await D.sampleFidelityBoundaries({ families: fams, rng: D.pilotRng(SEED), n: 2, admitBoundary: async () => ({ keep: true }) });
      w5a5expect(two.boundaries.map((p) => p.family.ccrc_id)).toEqual(['fam-d', 'fam-c']);
      w5a5expect(fams.reduce((n, f) => n + f.calls, 0)).toBe(2);
      const all = await D.sampleFidelityBoundaries({
        families: four(), rng: D.pilotRng(SEED), n: 10,
        admitBoundary: async (b, f) => ((f as FFam).ccrc_id === 'fam-a' ? { keep: false, reason: 'payload-discarded' } : { keep: true }),
      });
      w5a5expect(all.boundaries.map((p) => p.family.ccrc_id).sort()).toEqual(['fam-b', 'fam-c', 'fam-d']);
      w5a5expect(all.drops).toEqual({ 'payload-discarded': 2 });
    });
  });
});

// ── W2-5a Task 6: the question writer, the frozen lists, the fidelity pilot (W2-D72, W2-D73, W2-D64; D-5779) ──────
// Live safety: every spawn reaches W2-4's recording stub at `$HOME/.local/bin/<id>` in a mkTmp fixture HOME, through
// spawnEnv's allow-list, with the poisoned gh first on PATH. gen-a goes through its real generated wrapper over the stub.
// Every --out is a prepareOut directory under that HOME, claimed with claimFor. Limits rows and the release stamp are
// fixture files. Only the sourceQuiz describe opens a store: the real sweep's store in a w6SourceBox fixture HOME, read
// through openReplayStore, whose pair index is pairIndexOf over that fixture HOME. The other fidelity functions take rows
// and streams as values, and their redaction runs over a pair index built with makePairIndex. Key-shaped values are
// assembled at runtime.

const W6_MODEL = 'claude-opus-9-1';                 // a synthetic exact Opus id (EXACT_MODEL_ID_RE and OPUS_MODEL_RE)
const W6_STAMP = 'v9.9.6';
const W6_CMD = 'npm run fixture-build --workspace pkg-a';   // 39 characters: below LABELLER.window, matched whole
const W6_CMD2 = 'npm run fixture-lint --workspace pkg-b';
const W6_ERR = 'Error: fixture deploy step three failed';
const W6_SECRET = ['m4p', 'x9q2', 'r7v1', 'k3z8', 't6w5', 'n2h9', 'b8c4', 'y1d6', 'f5g3', 'j7e'].join('');
const W6_IDX = t4Lib.makePairIndex([{ len: W6_SECRET.length, sha256: t4Lib.sha256Hex(W6_SECRET) }]);
/** An AKIA-shaped key, assembled here, so no key-shaped literal sits in the tree. `tail` is seven capitals. */
const w6Akia = (tail: string): string => ['AK', 'IA'].join('') + ['FIXTURE', 'W6', tail].join('');
const W6_INIT = { type: 'system', subtype: 'init', session_id: 'fixture-writer-session', model: W6_MODEL, tools: [],
  mcp_servers: [], plugins: [], skills: [], slash_commands: [] };
const W6_USAGE = { input_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 };
/** A writer stream: the fixed init line (so the stub's `--version`, its first line, never moves), one assistant
 *  message and, unless `result` is false, a result event whose text is `reply`. */
function w6Reply(reply: string, opts: { result?: boolean } = {}): string {
  const events: object[] = [W6_INIT,
    { type: 'assistant', message: { id: 'msg-w6-1', role: 'assistant', content: [{ type: 'text', text: reply }], usage: W6_USAGE } }];
  if (opts.result !== false) {
    events.push({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: reply, permission_denials: [], usage: W6_USAGE });
  }
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}
const W6_GEN = '00000000-0000-4000-8000-0000000000c6';
const W6_BOUNDARY = '00000000-0000-4000-8000-0000000000b6';
const W6_SOURCE = '00000000-0000-4000-8000-0000000000e6';
const w6Field = (text: string): { text: string; rawLen: number } => ({ text, rawLen: Buffer.byteLength(text) });
type W6Item = {
  store_id: string; ccrc_id: string; generation: string; boundary_uuid: string; kind: string; fact: string; fact_raw: string;
  source_entry_uuid: string; repo_roots: string[]; leaf: { text: string; rawLen: number };
  pair: { name: string; input: { text: string; rawLen: number } } | null; span: Array<{ text: string; rawLen: number }>;
};
/** A command candidate whose leaf is its Bash command, in the writer's item fields of Task 2's candidate (R4). */
function w6Item(over: Partial<W6Item> = {}): W6Item {
  const fact = over.fact ?? W6_CMD;
  return {
    store_id: 'fixture-store-a', ccrc_id: 'fixture-ccrc-a', generation: W6_GEN, boundary_uuid: W6_BOUNDARY, kind: 'command',
    fact, fact_raw: fact, source_entry_uuid: W6_SOURCE, repo_roots: ['/home/u/tree'],
    leaf: w6Field(fact), pair: null, span: [w6Field(fact)], ...over,
  };
}
type W6Box = { home: string; out: string; claim: ReturnType<typeof claimFor> };
/** A fixture HOME: Task 3's twelve rows; a stub at every id's launcher; gen-a's real wrapper over the upstream stub and
 *  its secrets file; a fresh limits row for every id; a tagged release stamp; the writer stream; a claimed --out. */
function w6Box(prefix: string): W6Box {
  const home = mkTmp(prefix);
  writeRoster(home, FIXTURE_ACCOUNTS);
  const nowS = Math.floor(Date.now() / 1000);
  mkdirSync(join(home, '.cc-limits'), { recursive: true });
  for (const a of FIXTURE_ACCOUNTS as Array<{ id: string }>) {
    plantStub(home, a.id);
    writeFileSync(join(home, '.cc-limits', `${a.id}.json`),
      JSON.stringify({ five: 10, seven: 20, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
  }
  const flat = rosterFromJson(JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')));
  const genA = flat.accounts.find((a) => a.id === 'gen-a')!;
  writeFileSync(join(home, '.local', 'bin', 'gen-a'), generateWrapperBody(genA, flat.upstreamId), { mode: 0o700 });
  mkdirSync(join(home, '.cc-secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.cc-secrets', 'gen-a.env'), `export CLAUDE_CODE_OAUTH_TOKEN=${T5_TOKEN}\n`, { mode: 0o600 });
  writeFileSync(join(home, '.ccrc', 'build.json'),
    JSON.stringify({ sha: 'fixture', ref: 'main', builtAt: '2026-10-22T00:00:00Z', dirty: false, version: W6_STAMP }));
  writeFileSync(join(home, STUB_STREAM), w6Reply('QUESTION: Which command rebuilt the fixture package before the release step?'));
  const out = replay.prepareOut(join(home, 'out'));
  return { home, out, claim: claimFor(out) };
}
/** What step 0a would have recorded for this box and account: the stub's version line, the stamp, the wrapper's sha
 *  (null for upstream) and the code shas measured now over this checkout. */
function w6Expected(home: string, id: string): Record<string, unknown> {
  const shas = replay.codeShas();
  if (shas.state !== 'measured') throw new Error(`fixture: codeShas is ${shas.state}`);
  return {
    claude_code_version: readFileSync(join(home, STUB_STREAM), 'utf8').split('\n')[0]!.trim(),
    release_stamp: W6_STAMP,
    wrapper_sha256: id === 'gen-a' ? sha256Hex(readFileSync(join(home, '.local', 'bin', 'gen-a'))) : null,
    code_shas: shas.files,
  };
}
function w6Open(b: W6Box, id: string, over: Record<string, unknown> = {}): ReturnType<typeof replay.openWriter> {
  return replay.openWriter({
    home: b.home, accountId: id, model: W6_MODEL, settingsMode: 'restricted', writerInput: 'excerpt', claim: b.claim,
    budget: 100_000, limits: replay.LIMITS_DEFAULTS, expected: w6Expected(b.home, id), lang: 'fixture.UTF-8', idx: W6_IDX, ...over,
  } as never);
}
/** The stub's print-mode runs: the writer spawns, not the `--version` calls. */
const w6Runs = (home: string) => (stubLog(home) ?? []).filter((e) => e.argv.includes('-p'));
const w6Excerpt = (r: unknown): string => {
  expect((r as { state: string }).state).toBe('input');
  return (r as { input: { excerpt: string } }).input.excerpt;
};
const w6Text = (r: unknown): string => {
  expect((r as { state: string }).state).toBe('text');
  return (r as { excerpt: string }).excerpt;
};
const W6_LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('W2-5a Task 6: the writer input, W2-D72 and W2-D54', () => {
  it('excerpt: a short leaf is sent whole, as canonical v1 input with kind, fact and excerpt', () => {
    const r = replay.writerInputOf(w6Item(), 'excerpt', W6_IDX);
    expect(r).toEqual({ state: 'input', input: { v: 1, kind: 'command', fact: W6_CMD, excerpt: W6_CMD } });
  });

  it('excerpt: a long leaf is windowed to 4000 code points centred on the first occurrence of the raw fact', () => {
    const F = 'make fixture-target';
    const leaf = `${'a'.repeat(6000)}${F}${'b'.repeat(6000)}${F}${'c'.repeat(100)}`;
    const ex = w6Excerpt(replay.writerInputOf(w6Item({ kind: 'command', fact: F, fact_raw: F, leaf: w6Field(leaf) }), 'excerpt', W6_IDX));
    const start = 6000 + Math.floor(F.length / 2) - 2000;
    expect(ex).toBe(leaf.slice(start, start + 4000));
    expect(ex.indexOf(F)).toBe(6000 - start);
  });

  it('excerpt: the window is clamped at either end of the leaf and always holds the whole raw fact', () => {
    const F = 'make fixture-target';
    const head = `${'x'.repeat(10)}${F}${'y'.repeat(9000)}`;
    expect(w6Text(replay.windowExcerpt({ base: head, factRaw: F, firstWindow: 4000, pairLine: null }))).toBe(head.slice(0, 4000));
    const tail = `${'y'.repeat(9000)}${F}${'x'.repeat(10)}`;
    expect(w6Text(replay.windowExcerpt({ base: tail, factRaw: F, firstWindow: 4000, pairLine: null }))).toBe(tail.slice(tail.length - 4000));
  });

  it('excerpt: a paired tool_use is appended as one line, redacted whole and capped at 2000 code points', () => {
    const input = `${'p '.repeat(500)}${W6_SECRET} ${'q '.repeat(2000)}`;   // the secret sits inside the 2000 cap
    const item = w6Item({ kind: 'error', fact: W6_ERR, fact_raw: W6_ERR, leaf: w6Field(`${W6_ERR}\nmore output`),
      pair: { name: 'Bash', input: w6Field(input) } });
    const ex = w6Excerpt(replay.writerInputOf(item, 'excerpt', W6_IDX));
    const line = Array.from(replay.renderToolUseLine('Bash', t4Lib.redactField(input, W6_IDX))).slice(0, 2000).join('');
    expect(ex).toBe(`${W6_ERR}\nmore output\n${line}`);
    expect(ex).not.toContain(W6_SECRET.slice(0, 6));
    expect(Array.from(ex.slice(ex.lastIndexOf('\n') + 1)).length).toBe(2000);
  });

  it('excerpt: a window past 8 KiB of UTF-8 shrinks around the fact until it fits, never splitting a code point', () => {
    const F = 'make fixture-target';
    const cjk = `${'中'.repeat(6000)}${F}${'中'.repeat(6000)}`;
    const ex = w6Text(replay.windowExcerpt({ base: cjk, factRaw: F, firstWindow: 4000, pairLine: null }));
    expect(Buffer.byteLength(ex)).toBeLessThanOrEqual(replay.WRITER_EXCERPT_MAX_BYTES);
    expect(Buffer.byteLength(ex)).toBeGreaterThan(replay.WRITER_EXCERPT_MAX_BYTES - 4);
    expect(ex).toContain(F);
    expect(cjk.includes(ex)).toBe(true);
    const astral = String.fromCodePoint(0x1f600);
    const wide = `${astral.repeat(3000)}${F}${astral.repeat(3000)}`;
    const ex2 = w6Text(replay.windowExcerpt({ base: wide, factRaw: F, firstWindow: 4000, pairLine: null }));
    expect(Buffer.byteLength(ex2)).toBeLessThanOrEqual(8192);
    expect(ex2).toContain(F);
    expect(ex2).not.toMatch(W6_LONE_SURROGATE);
    expect(wide.includes(ex2)).toBe(true);
  });

  it('excerpt: a raw fact whose own bytes pass 8 KiB is discarded as writer-input-over-cap', () => {
    const F = '中'.repeat(3000);
    expect(replay.windowExcerpt({ base: F, factRaw: F, firstWindow: 4000, pairLine: null }))
      .toEqual({ state: 'discard', why: 'writer-input-over-cap' });
    expect(replay.writerInputOf(w6Item({ kind: 'error', fact: F, fact_raw: F, leaf: w6Field(F) }), 'excerpt', W6_IDX))
      .toEqual({ state: 'discard', why: 'writer-input-over-cap' });
    expect(replay.FACT_DROP_REASONS.slice(16, 17), 'R5: a fact drop, appended after Task 5\'s').toEqual(['writer-input-over-cap']);
  });

  it('a leaf or a paired input over the decode cap is discarded, never cut', () => {
    const over = { text: W6_CMD, rawLen: t4Lib.BLOB_DECODE_MAX + 1 };
    expect(replay.writerInputOf(w6Item({ leaf: over }), 'excerpt', W6_IDX)).toEqual({ state: 'discard', why: 'over-decode-cap' });
    expect(replay.writerInputOf(w6Item({ pair: { name: 'Bash', input: over } }), 'excerpt', W6_IDX))
      .toEqual({ state: 'discard', why: 'over-decode-cap' });
    expect(replay.writerInputOf(w6Item({ span: [over] }), 'leaf-span', W6_IDX)).toEqual({ state: 'discard', why: 'over-decode-cap' });
  });

  it('W2-D54 order: a secret straddling the window edge is redacted whole before the window, and no head of it survives', () => {
    const F = 'make fixture-target';
    // Spaced filler, so the secret is a run of its own and its (length, sha256) pair matches it whole.
    const leaf = `${'a '.repeat(1500)}${F}  ${'b '.repeat(989)}${W6_SECRET} ${'c '.repeat(1500)}`;
    const end = 3000 + Math.floor(F.length / 2) - 2000 + 4000;
    expect(leaf.indexOf(W6_SECRET), 'the fixture: the secret starts 10 code points before the window ends').toBe(end - 10);
    const ex = w6Excerpt(replay.writerInputOf(w6Item({ fact: F, fact_raw: F, leaf: w6Field(leaf) }), 'excerpt', W6_IDX));
    expect(ex).not.toContain(W6_SECRET.slice(0, 6));
    expect(ex).toContain(t4Lib.REDACTED_MARK);
    // CONTROL: window the raw leaf first and redact afterwards, and the head the window leaves matches no pair.
    const raw = w6Text(replay.windowExcerpt({ base: leaf, factRaw: F, firstWindow: 4000, pairLine: null }));
    expect(t4Lib.redactField(raw, W6_IDX)).toContain(W6_SECRET.slice(0, 10));
  });

  it('leaf-span: the whole span, each leaf redacted, joined by newlines and windowed to the 8 KiB budget', () => {
    const span = [w6Field('first leaf text'), w6Field(W6_CMD), w6Field(`third leaf ${W6_SECRET}`)];
    const ex = w6Excerpt(replay.writerInputOf(w6Item({ span }), 'leaf-span', W6_IDX));
    expect(ex).toBe(`first leaf text\n${W6_CMD}\nthird leaf ${t4Lib.REDACTED_MARK}`);
    const big = [w6Field('q'.repeat(5000)), w6Field(`${'r'.repeat(2000)}${W6_CMD}${'s'.repeat(2000)}`), w6Field('t'.repeat(5000))];
    const ex2 = w6Excerpt(replay.writerInputOf(w6Item({ span: big }), 'leaf-span', W6_IDX));
    expect(Buffer.byteLength(ex2)).toBe(8192);
    expect(ex2).toContain(W6_CMD);
  });

  it('a raw fact absent from its redacted leaf is a TypeError, never an empty excerpt', () => {
    expect(() => replay.writerInputOf(w6Item({ leaf: w6Field('some other command') }), 'excerpt', W6_IDX)).toThrow(TypeError);
    expect(() => replay.writerInputOf(w6Item(), 'whole-session' as never, W6_IDX)).toThrow(TypeError);
  });

  it('writerStdin is the writer prompt, a blank line, the canonical input and one newline', () => {
    const input = { v: 1, kind: 'command', fact: W6_CMD, excerpt: W6_CMD };
    expect(replay.writerStdin(input)).toBe(
      `${w6Gate.WRITER_PROMPT}\n\n{"excerpt":${JSON.stringify(W6_CMD)},"fact":${JSON.stringify(W6_CMD)},"kind":"command","v":1}\n`);
  });

  it('W2-D67 (R10, F6): a whitespace-split bearer token, mined by Task 2, is dropped redact-fact by the redaction stage, because the writer input carries F as it stands', () => {
    // The token is assembled at runtime; a newline splits it from its header in F_raw, and collapseWs joins them in F.
    const tok = ['zq', 'w5a6', 'bearer', 'value'].join('');
    const command = `curl -H "Authorization: Bearer\n${tok}" https://api.example.test/v1`;
    const sp = w5a2Span([{ provenance: 'model', body: [w5a2Use('b6', 'Bash', { command })] }]);
    const c = w5a2MinedOf(w5a2Mine(sp, { storeId: 'fixture-store-a', ccrcId: 'fixture-ccrc-a', generation: W6_GEN })).candidates.find((x) => x.kind === 'command')!;
    expect(c).toMatchObject({ fact_raw: command, leaf: { text: command } });
    const made = replay.writerInputOf(c as never, 'excerpt', W6_IDX) as { state: string; input: { fact: string; excerpt: string } };
    expect(made.state).toBe('input');
    expect(made.input.excerpt, 'CONTROL: the excerpt, redacted whole, keeps the split token (lib\'s bearer rule reads one line)').toContain(tok);
    expect(made.input.fact, 'CONTROL: the writer input carries F, the header and token joined, unredacted').toContain(`Bearer ${tok}`);
    expect(w5a2Drv.screenRedaction(c, W6_IDX), 'so the redaction stage, which runs before the writer stage, drops it').toBe('redact-fact');
  });
});

describe('W2-5a Task 6: the writer spawn, RP1-writer and RP3-writer', () => {
  it.each(['up-a', 'gen-a'])('RP1-writer %s: the writer call goes through W2-4 spawn in writer mode, with the composed input on stdin', async (id) => {
    const b = w6Box(`ccrc-w2-5a-t6-rp1-${id}-`);
    const w = await w6Open(b, id);
    const item = w6Item();
    const qid = replay.qidOf(item);
    const r = await w.ask('quiz', item);
    expect(r).toMatchObject({ state: 'question', qid, entry: { qid, question: 'Which command rebuilt the fixture package before the release step?' } });
    const runs = w6Runs(b.home);
    expect(runs, 'one writer spawn').toHaveLength(1);
    const l = runs[0]!;
    expect(l.argv).toEqual(t5Argv('writer', W6_MODEL, b.home));
    expect(l.argv).not.toContain('--allowedTools');
    const keys = withoutDarwinAdded(l.envKeys).filter((k) => !T5_BASH_KEYS.includes(k));
    expect(keys).toEqual(id === 'gen-a' ? [...T5_BASE_KEYS, 'CLAUDE_CODE_OAUTH_TOKEN'].sort() : [...T5_BASE_KEYS].sort());
    for (const k of [...T5_NEVER_KEYS, ...T5_RECALL_KEYS]) expect(l.envKeys, k).not.toContain(k);
    expect(l.env['PATH']).toBe(`${b.out}/poison-bin:${path.dirname(process.execPath)}:/usr/bin:/bin`);
    expect(l.env['CLAUDE_CONFIG_DIR']).toBe(join(b.home, id === 'gen-a' ? '.gen-a' : '.claude'));
    const input = `{"excerpt":${JSON.stringify(W6_CMD)},"fact":${JSON.stringify(W6_CMD)},"kind":"command","v":1}`;
    expect(l.stdin).toBe(`${w6Gate.WRITER_PROMPT}\n\n${input}\n`);
    const dir = join(b.out, 'quiz', 'writer');
    expect(readFileSync(join(dir, `${qid}.jsonl`), 'utf8')).toBe(readFileSync(join(b.home, STUB_STREAM), 'utf8'));
    expect(JSON.parse(readFileSync(join(dir, `${qid}.run.json`), 'utf8'))).toMatchObject({ mode: 'writer', model: W6_MODEL, account: id });
    expect(readFileSync(join(dir, `${qid}.input.json`), 'utf8')).toBe(`${input}\n`);
    expect(readFileSync(join(b.home, T5_STUB_LOG), 'utf8')).not.toContain(T5_TOKEN);
  }, 60_000);

  it.each([['cx-a', 'kind-codex'], ['ext-n', 'kind-external'], ['ext-a', 'kind-external'], ['gen-o', 'provider-openai']])(
    'RP3-writer %s: refused account-refused before any spawn, and the stub log stays absent', async (id, detail) => {
      const b = w6Box(`ccrc-w2-5a-t6-rp3-${id}-`);
      const err = await w6Open(b, id).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(DriverRefusal);
      expect(err).toMatchObject({ word: 'account-refused', detail });
      expect(stubLog(b.home), 'no spawn, not even --version').toBeNull();
      expect(existsSync(join(b.out, 'quiz'))).toBe(false);
    }, 60_000);

  it('a writer model that is not an exact Opus id is refused before admission and any spawn', async () => {
    for (const model of ['opus', 'claude-opus-latest', 'claude-other-9-1']) {
      const b = w6Box('ccrc-w2-5a-t6-model-');
      const err = await w6Open(b, 'up-a', { model }).then(() => null, (e: unknown) => e);
      expect(err, model).toMatchObject({ word: 'args-invalid' });
      expect(stubLog(b.home), model).toBeNull();
    }
  }, 60_000);

  it('a stub question holding the 7-character SHA prefix is discarded as writer-leak, and a 6-character one is kept', async () => {
    const b = w6Box('ccrc-w2-5a-t6-leak-');
    const w = await w6Open(b, 'up-a');
    const sha = ['0a1b2c3', 'd4e5f60', '718293a', '4b5c6d7', 'e8f9012', '34567'].join('');
    const sha2 = ['9f8e7d6', 'c5b4a39', '2817f6e', '5d4c3b2', 'a190817', '26354'].join('');
    writeFileSync(join(b.home, STUB_STREAM), w6Reply(`QUESTION: Which commit, starting ${sha.slice(0, 7)}, landed the fixture merge?`));
    const leak = await w.ask('quiz', w6Item({ kind: 'sha', fact: sha, fact_raw: sha, leaf: w6Field(`merged at ${sha}`) }));
    expect(leak).toMatchObject({ state: 'discard', why: 'writer-leak' });
    // CONTROL: a 6-character prefix is under LABELLER.sha_admit_prefix, so the same shape of question is kept.
    writeFileSync(join(b.home, STUB_STREAM), w6Reply(`QUESTION: Which commit, starting ${sha2.slice(0, 6)}, landed the fixture merge?`));
    const kept = await w.ask('quiz', w6Item({ kind: 'sha', fact: sha2, fact_raw: sha2, leaf: w6Field(`merged at ${sha2}`) }));
    expect(kept).toMatchObject({ state: 'question' });
    expect(w6Runs(b.home)).toHaveLength(2);
  }, 60_000);

  it('a reply with no QUESTION line, or a run with no result event, is writer-malformed with no retry', async () => {
    const b = w6Box('ccrc-w2-5a-t6-malformed-');
    const w = await w6Open(b, 'up-a');
    writeFileSync(join(b.home, STUB_STREAM), w6Reply('I would ask about the build command.'));
    expect(await w.ask('quiz', w6Item())).toMatchObject({ state: 'discard', why: 'writer-malformed', run: { code: 0, skipped: false } });
    writeFileSync(join(b.home, STUB_STREAM), w6Reply('QUESTION: Which command linted the fixture package?', { result: false }));
    expect(await w.ask('quiz', w6Item({ fact: W6_CMD2, fact_raw: W6_CMD2, leaf: w6Field(W6_CMD2) })))
      .toMatchObject({ state: 'discard', why: 'writer-malformed' });
    expect(w6Runs(b.home), 'one spawn per ask, never a retry').toHaveLength(2);
  }, 60_000);

  it('W2-D67 (R7): an AKIA-shaped key in the leaf or in its paired tool_use, mined by Task 2 from leaf N\'s span, reaches the writer stub redacted, under both writer inputs', async () => {
    const key = w5a2Akia();
    const sp = w5a2Span([
      { provenance: 'model', body: [w5a2Use('k7', 'Bash', { command: `AWS_ACCESS_KEY_ID=${key} ./fixture-deploy.sh` })] },
      { provenance: 'tool', body: [w5a2Result('k7', `${W6_ERR}\nkey in env: ${key}\n`, true)] },
    ]);
    const mined = w5a2MinedOf(w5a2Mine(sp, { storeId: 'fixture-store-a', ccrcId: 'fixture-ccrc-a', generation: W6_GEN }));
    const err = mined.candidates.find((c) => c.kind === 'error')!;
    expect(err).toMatchObject({ fact_raw: W6_ERR, pair: { name: 'Bash' } });
    expect(err.leaf.text, 'CONTROL: the mined leaf holds the key').toContain(key);
    expect(err.pair!.input.text, 'CONTROL: so does its paired tool_use').toContain(key);
    expect(w5a2Drv.screenRedaction(err, W6_IDX), 'the screen keeps it: the fact is intact once the key is masked').toBeNull();
    for (const writerInput of ['excerpt', 'leaf-span']) {
      const b = w6Box(`ccrc-w2-5a-t6-akia-${writerInput}-`);
      writeFileSync(join(b.home, STUB_STREAM), w6Reply('QUESTION: What error did the fixture deploy step print?'));
      const w = await w6Open(b, 'up-a', { writerInput });
      expect(await w.ask('quiz', err as never), writerInput).toMatchObject({ state: 'question' });
      const stdin = w6Runs(b.home)[0]!.stdin;
      expect(stdin, writerInput).not.toContain(key);
      expect(stdin, writerInput).toContain(t4Lib.REDACTED_MARK);
      expect(stdin, writerInput).toContain(W6_ERR);
      expect(readFileSync(join(b.out, 'quiz', 'writer', `${replay.qidOf(err as never)}.input.json`), 'utf8'), writerInput).not.toContain(key);
    }
  }, 120_000);

  it('the preflight runs before every writer batch: a version that moves between two asks refuses before the second spawn', async () => {
    const b = w6Box('ccrc-w2-5a-t6-moved-');
    const w = await w6Open(b, 'up-a');
    expect(await w.ask('quiz', w6Item())).toMatchObject({ state: 'question' });
    const moved = readFileSync(join(b.home, STUB_STREAM), 'utf8').replace('fixture-writer-session', 'fixture-writer-moved');
    writeFileSync(join(b.home, STUB_STREAM), moved);
    const err = await w.ask('quiz', w6Item({ fact: W6_CMD2, fact_raw: W6_CMD2, leaf: w6Field(W6_CMD2) })).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'claude-version-moved' });
    expect(w6Runs(b.home)).toHaveLength(1);
  }, 60_000);

  it('the limits gate stops the writer at open: limits-threshold, and the stub never runs', async () => {
    const b = w6Box('ccrc-w2-5a-t6-limits-');
    const nowS = Math.floor(Date.now() / 1000);
    writeFileSync(join(b.home, '.cc-limits', 'up-a.json'),
      JSON.stringify({ five: 90, seven: 20, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
    const err = await w6Open(b, 'up-a').then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'limits-threshold' });
    expect(stubLog(b.home)).toBeNull();
  }, 60_000);

  it('W2-D55: the writer stops at its budget before the next writer batch: budget-exhausted, one stub run', async () => {
    const b = w6Box('ccrc-w2-5a-t6-budget-');
    const w = await w6Open(b, 'up-a', { budget: 1 });
    const first = await w.ask('quiz', w6Item());
    expect(first, 'CONTROL: the first ask ran, the ledger at 0').toMatchObject({ state: 'question', run: { skipped: false } });
    expect((first as { run: { tokens: number } }).run.tokens, 'CONTROL: the stub run spent past the budget').toBeGreaterThanOrEqual(1);
    const err = await w.ask('pilot', w6Item()).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'budget-exhausted' });
    expect(w6Runs(b.home)).toHaveLength(1);
  }, 60_000);

  it('W2-D55, W2-D56: a limits row raised past the threshold between two asks stops the second before its spawn: limits-threshold', async () => {
    const b = w6Box('ccrc-w2-5a-t6-limits-ask-');
    const w = await w6Open(b, 'up-a');
    await w.ask('quiz', w6Item());
    expect(w6Runs(b.home), 'CONTROL: the first ask spawned under the fresh row').toHaveLength(1);
    const nowS = Math.floor(Date.now() / 1000);
    writeFileSync(join(b.home, '.cc-limits', 'up-a.json'),
      JSON.stringify({ five: 90, seven: 20, ts: nowS - 60, fiveResetAt: nowS + 3600, sevenResetAt: nowS + 86400 }));
    const err = await w.ask('pilot', w6Item()).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'limits-threshold' });
    expect(w6Runs(b.home)).toHaveLength(1);
  }, 60_000);

  it('a resumed ask reuses the finished run with no spawn, and changed input for the same qid refuses out-refused', async () => {
    const b = w6Box('ccrc-w2-5a-t6-resume-');
    const w = await w6Open(b, 'up-a');
    const first = await w.ask('quiz', w6Item());
    const again = await w.ask('quiz', w6Item());
    expect(again).toMatchObject({ state: 'question', run: { skipped: true } });
    expect((again as { entry: unknown }).entry).toEqual((first as { entry: unknown }).entry);
    expect(w6Runs(b.home)).toHaveLength(1);
    const changed = w6Item({ leaf: w6Field(`cd pkg-a && ${W6_CMD}`) });
    expect(replay.qidOf(changed)).toBe(replay.qidOf(w6Item()));
    const err = await w.ask('quiz', changed).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ word: 'out-refused' });
    expect((err as { detail: string }).detail).toMatch(/^writer-input-changed quiz\/writer\/[0-9a-f]{16}\.input\.json$/);
    expect(w6Runs(b.home)).toHaveLength(1);
  }, 60_000);
});

const W6_HEAD = { writer_model: W6_MODEL, labeller: { ...w6Gate.LABELLER, sha_min_prefix: 7 } };
/** A frozen entry for `fact`, its qid computed by qidOf (its type is inferred, so it is a FrozenEntry). */
function w6Entry(fact: string) {
  const six = { store_id: 'fixture-store-a', ccrc_id: 'fixture-ccrc-a', generation: W6_GEN, boundary_uuid: W6_BOUNDARY, kind: 'command', fact };
  return { qid: replay.qidOf(six), ...six, fact_raw: fact, question: `Which command ran as step ${fact.length}?`,
    source_entry_uuid: W6_SOURCE, repo_roots: ['/home/u/tree'] };
}

describe('W2-5a Task 6: the frozen lists, W2-D73', () => {
  it('qidOf is the first 16 hex of sha256 over the canonical six-tuple', () => {
    const six = ['fixture-store-a', 'fixture-ccrc-a', W6_GEN, W6_BOUNDARY, 'command', W6_CMD];
    expect(replay.qidOf(w6Item())).toBe(w6Hash('sha256').update(JSON.stringify(six)).digest('hex').slice(0, 16));
  });

  it('frozenListText: canonical bytes, entries sorted by qid, no trailing newline, byte-identical twice and in any input order', () => {
    const a = w6Entry(W6_CMD);
    const c = w6Entry(W6_CMD2);
    const text = replay.frozenListText('quiz', W6_HEAD, [a, c]);
    expect(replay.frozenListText('quiz', W6_HEAD, [c, a])).toBe(text);
    expect(replay.frozenListText('quiz', W6_HEAD, [a, c])).toBe(text);
    expect(text.endsWith('\n')).toBe(false);
    const doc = JSON.parse(text);
    expect(t4Lib.canonicalJson(doc)).toBe(text);
    expect(doc.entries.map((e: { qid: string }) => e.qid)).toEqual([a.qid as string, c.qid as string].sort());
    expect(Object.keys(doc.entries[0]).sort()).toEqual([...replay.FROZEN_ENTRY_KEYS]);
    expect([doc.kind, doc.version, doc.writer_model, doc.writer_prompt_sha256, doc.answer_protocol_sha256])
      .toEqual(['ccrc-history-w2-quiz', 1, W6_MODEL, w6Gate.WRITER_PROMPT_SHA256, w6Gate.ANSWER_PROTOCOL_SHA256]);
    expect(JSON.parse(replay.frozenListText('pilot', W6_HEAD, [a])).kind).toBe('ccrc-history-w2-pilot');
  });

  it('frozenListText refuses a wrong qid, an extra key, a repeated qid, an unknown kind and an aliased writer model', () => {
    const a = w6Entry(W6_CMD);
    expect(() => replay.frozenListText('quiz', W6_HEAD, [{ ...a, qid: '0'.repeat(16) }] as never)).toThrow(TypeError);
    expect(() => replay.frozenListText('quiz', W6_HEAD, [{ ...a, arm: 'x' }] as never)).toThrow(TypeError);
    expect(() => replay.frozenListText('quiz', W6_HEAD, [a, a] as never)).toThrow(TypeError);
    const decision = { ...a, kind: 'decision' };
    expect(() => replay.frozenListText('quiz', W6_HEAD, [decision] as never)).toThrow(TypeError);
    expect(() => replay.frozenListText('quiz', { ...W6_HEAD, writer_model: 'opus' }, [a] as never)).toThrow(TypeError);
    expect(() => replay.frozenListText('ab' as never, W6_HEAD, [a] as never)).toThrow(TypeError);
  });

  it('writeFrozenList writes quiz and pilot lists at 0600 and answers the sha of the bytes on disk', () => {
    const b = w6Box('ccrc-w2-5a-t6-write-');
    for (const section of ['quiz', 'pilot'] as const) {
      const text = replay.frozenListText(section, W6_HEAD, [w6Entry(W6_CMD)]);
      const sha = replay.writeFrozenList(b.out, section, text);
      const p = join(b.out, section, 'frozen.json');
      expect(readFileSync(p, 'utf8')).toBe(text);
      expect(statSync(p).mode & 0o777).toBe(0o600);
      expect(sha).toBe(sha256Hex(readFileSync(p)));
    }
  });

  it('writeFrozenList keeps a list it already wrote, and refuses a different list over it', () => {
    const b = w6Box('ccrc-w2-5a-t6-rewrite-');
    const text = replay.frozenListText('quiz', W6_HEAD, [w6Entry(W6_CMD)]);
    const sha = replay.writeFrozenList(b.out, 'quiz', text);
    expect(replay.writeFrozenList(b.out, 'quiz', text)).toBe(sha);
    const other = replay.frozenListText('quiz', W6_HEAD, [w6Entry(W6_CMD2)]);
    expect(() => replay.writeFrozenList(b.out, 'quiz', other)).toThrow(/holds another frozen list/);
    expect(readFileSync(join(b.out, 'quiz', 'frozen.json'), 'utf8')).toBe(text);
  });

  it('loadFrozenList: a one-byte edit refuses quiz-sha-mismatch before any parse, and a consumer that loads first never spawns', async () => {
    const b = w6Box('ccrc-w2-5a-t6-load-');
    const text = replay.frozenListText('quiz', W6_HEAD, [w6Entry(W6_CMD), w6Entry(W6_CMD2)]);
    const sha = replay.writeFrozenList(b.out, 'quiz', text);
    const p = join(b.out, 'quiz', 'frozen.json');
    expect(replay.loadFrozenList(p, sha, 'quiz').entries).toHaveLength(2);
    writeFileSync(p, text.replace('Which', 'Whick'));
    const { json, roster } = readRoster(b.home);
    const launch = admitAccount(json, roster, 'up-a', b.home);
    const consumer = async () => {
      replay.loadFrozenList(p, sha, 'quiz');
      return claimedBatch([t5job(b, launch, 'writer', 'quiz/consumer')], { gate: T5_NO_GATE });
    };
    await expect(consumer()).rejects.toMatchObject({ word: 'quiz-sha-mismatch' });
    expect(stubLog(b.home)).toBeNull();
  }, 60_000);

  it('loadFrozenList: bytes whose sha matches but are not the canonical list refuse input-invalid', () => {
    const text = replay.frozenListText('quiz', W6_HEAD, [w6Entry(W6_CMD)]);
    const dir = mkTmp('ccrc-w2-5a-t6-loose-');
    const loose = JSON.stringify(JSON.parse(text), null, 2);
    writeFileSync(join(dir, 'loose.json'), loose);
    expect(() => replay.loadFrozenList(join(dir, 'loose.json'), sha256Hex(loose), 'quiz')).toThrow(/frozen list/);
    let word = '';
    try { replay.loadFrozenList(join(dir, 'loose.json'), sha256Hex(loose), 'quiz'); } catch (e) { word = (e as { word: string }).word; }
    expect(word).toBe('input-invalid');
    // CONTROL: the canonical bytes of the same list load.
    writeFileSync(join(dir, 'tight.json'), text);
    expect(replay.loadFrozenList(join(dir, 'tight.json'), sha256Hex(text), 'quiz').kind).toBe('ccrc-history-w2-quiz');
    let pilotWord = '';
    try { replay.loadFrozenList(join(dir, 'tight.json'), sha256Hex(text), 'pilot'); } catch (e) { pilotWord = (e as { word: string }).word; }
    expect(pilotWord, 'a quiz list is not a pilot list').toBe('input-invalid');
  });
});

describe('W2-5a Task 6: the fidelity pilot payloads and overhead arithmetic', () => {
  const sj = (...events: object[]): string => events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const usage = (input: number, cc: number, cr: number, out = 3) =>
    ({ input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out });
  const msg = (id: string, u: object | null) =>
    ({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text: 'ok' }], ...(u === null ? {} : { usage: u }) } });
  const RESULT = { type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: 'ok', usage: usage(999, 999, 999) };
  const facts = (input: number, cc: number, cr: number) => replay.readStreamJson(sj(msg('m1', usage(input, cc, cr)), msg('m2', usage(1, 1, 1)), RESULT));

  it('readStreamJson firstCallUsage: the first message usage, counted once; null when the first message carried none', () => {
    expect(facts(10, 20, 30).firstCallUsage).toEqual({ input: 10, cacheCreation: 20, cacheRead: 30, output: 3 });
    const repeated = replay.readStreamJson(sj(msg('m1', usage(10, 20, 30)), msg('m1', usage(10, 20, 30)), msg('m2', usage(5, 5, 5))));
    expect(repeated.firstCallUsage).toEqual({ input: 10, cacheCreation: 20, cacheRead: 30, output: 3 });
    expect(replay.readStreamJson(sj(msg('m0', null), msg('m1', usage(10, 20, 30)), RESULT)).firstCallUsage).toBeNull();
    expect(replay.readStreamJson(sj(RESULT)).firstCallUsage).toBeNull();
  });

  it('usageInputOf and userTextOf read a stored row body, and an unreadable count is null, never 0', () => {
    expect(replay.usageInputOf({ message: { usage: usage(100, 200, 300) } })).toBe(600);
    expect(replay.usageInputOf({ message: { usage: { input_tokens: 7 } } }), 'absent cache counts are 0').toBe(7);
    expect(replay.usageInputOf({ message: { usage: { cache_read_input_tokens: 7 } } })).toBeNull();
    expect(replay.usageInputOf({ message: { usage: { input_tokens: -1 } } })).toBeNull();
    expect(replay.usageInputOf({ message: {} })).toBeNull();
    expect(replay.userTextOf({ message: { content: 'plain text' } })).toBe('plain text');
    expect(replay.userTextOf({ message: { content: [{ type: 'text', text: 'a' }, { type: 'tool_result', content: 'x' }, { type: 'text', text: 'b' }] } })).toBe('a\nb');
    expect(replay.userTextOf({ message: { content: [{ type: 'tool_result', content: 'x' }] } })).toBeNull();
  });

  const row = (type: string, provenance: string, model: string | null, body: object) =>
    ({ type, provenance, model, body, rawLen: Buffer.byteLength(JSON.stringify(body)) });
  const user = (provenance: string, text: string) => row('user', provenance, null, { type: 'user', message: { role: 'user', content: text } });
  const asst = (model: string, u: object) => row('assistant', 'model', model, { type: 'assistant', message: { role: 'assistant', usage: u, content: [] } });
  const EPOCH = [
    user('harness', 'harness notice text'),
    user('operator', 'please rebuild the fixture package'),
    asst('<synthetic>', usage(1, 0, 0)),
    asst('claude-fixture-1', usage(2000, 9000, 1000)),
    user('operator', 'a later prompt'),
  ];
  const COPY = [
    asst('claude-fixture-1', usage(5, 5, 5)),
    user('operator', 'before the boundary'),
    row('user', 'summary', null, { type: 'user', message: { role: 'user', content: 'the summary' } }),
    asst('<synthetic>', usage(1, 0, 0)),
    asst('claude-fixture-1', usage(1000, 4000, 25000)),
  ];

  it('originalSideOf: the first non-synthetic call of the epoch, the operator text before it, and the first non-synthetic call after the summary', () => {
    expect(replay.originalSideOf({ epochRows: EPOCH, copyRows: COPY, summaryIndex: 2 })).toEqual({
      state: 'measured', firstInput: 12000, postInput: 30000,
      userRows: [{ text: 'please rebuild the fixture package', rawLen: EPOCH[1]!.rawLen }],
    });
    expect(replay.originalSideOf({ epochRows: EPOCH.slice(0, 3), copyRows: COPY, summaryIndex: 2 }))
      .toEqual({ state: 'unmeasured', why: 'epoch-first-call-absent' });
    expect(replay.originalSideOf({ epochRows: [EPOCH[0]!, EPOCH[3]!], copyRows: COPY, summaryIndex: 2 }))
      .toEqual({ state: 'unmeasured', why: 'epoch-first-user-text-absent' });
    expect(replay.originalSideOf({ epochRows: EPOCH, copyRows: COPY.slice(0, 4), summaryIndex: 2 }))
      .toEqual({ state: 'unmeasured', why: 'post-boundary-call-absent' });
    const noUsage = [...COPY.slice(0, 4), row('assistant', 'model', 'claude-fixture-1', { message: { content: [] } })];
    expect(replay.originalSideOf({ epochRows: EPOCH, copyRows: noUsage, summaryIndex: 2 }))
      .toEqual({ state: 'unmeasured', why: 'post-boundary-usage-absent' });
  });

  it('fidelityFigures: each side net of its own fixed overhead, and unmeasured is never folded into zero', () => {
    const original = { state: 'measured', firstInput: 12000, postInput: 30000, userRows: [] };
    const runs = { payload: facts(1000, 0, 24000), empty: facts(9000, 0, 0), 'user-text': facts(9200, 0, 0) };
    expect(replay.fidelityFigures({ original, runs } as never)).toEqual({
      state: 'measured', original_payload: 18200, replay_payload: 16000, original_overhead: 11800, replay_overhead: 9000, user_text_tokens: 200,
    });
    const none = replay.readStreamJson(sj(RESULT));
    expect(replay.fidelityFigures({ original, runs: { ...runs, empty: none } } as never)).toEqual({ state: 'unmeasured', why: 'empty-first-call-absent' });
    expect(replay.fidelityFigures({ original, runs: { ...runs, 'user-text': facts(9000, 0, 0) } } as never))
      .toEqual({ state: 'unmeasured', why: 'user-text-nonpositive' });
    expect(replay.fidelityFigures({ original: { ...original, firstInput: 100 }, runs } as never))
      .toEqual({ state: 'unmeasured', why: 'original-overhead-negative' });
    expect(replay.fidelityFigures({ original: { ...original, postInput: 11800 }, runs } as never))
      .toEqual({ state: 'unmeasured', why: 'original-payload-nonpositive' });
    expect(replay.fidelityFigures({ original, runs: { ...runs, payload: facts(9000, 0, 0) } } as never))
      .toEqual({ state: 'unmeasured', why: 'replay-payload-nonpositive' });
    expect(replay.fidelityFigures({ original: { state: 'unmeasured', why: 'post-boundary-call-absent' }, runs } as never))
      .toEqual({ state: 'unmeasured', why: 'post-boundary-call-absent' });
  });
});

/** A HOME whose store the real sweep built from one family, as Task 1's fixture is built, for sourceQuiz end to end
 *  (here and in Task 7's --out walk). Leaf N's span holds one Bash command fact the kept list does not hold (`cmd`, a
 *  plain build command by default; the W2-D67 case passes a key-shaped one); Anthropic
 *  rows sit on both sides of the boundary (RP5); the summary row holds a sentinel only B carries (its part 1); and every
 *  row's cwd is a directory that exists, so B's files resolve and its ancestor walk stops at `top`. Nothing is spawned
 *  but the sweep, and no live store or home is read. */
type W6SourceBox = { box: w5a1H.HistoryBox; cwd: string; id: string; gen: string; cmd: string; sentinel: string; u: (i: number) => string };
const w6Indexed = (box: w5a1H.HistoryBox, uuid: string): boolean => {
  const db = w5a1H.openStoreRO(box);
  try {
    const r = db.prepare('SELECT b.fts_indexed AS f FROM entries e JOIN blobs b ON b.blob_id = e.blob_id WHERE e.uuid = ?').get(uuid) as { f: number } | undefined;
    return r !== undefined && Number(r.f) === 1;
  } finally {
    db.close();
  }
};
function w6SourceBox(prefix: string, cmd = 'npm run fixture-build --workspace pkg-a'): W6SourceBox {
  const box = w5a1H.makeHistoryBox(prefix);
  const cwd = join(box.home, 'tree', 'demo');
  mkdirSync(cwd, { recursive: true });
  const id = 'claude-a-w5a6';
  const gen = '0189abcd-1234-4678-9abc-0000000005a6';
  const u = (i: number): string => `a5a60001-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const ts = (i: number): string => new Date(Date.UTC(2026, 9, 2, 10, 0, i)).toISOString();
  const sid = u(0);
  const sentinel = ['zq', 'w5a6', 'sentinel'].join('');
  const base = { sessionId: sid, cwd };
  const rows = [
    w5a1Fx.userRow({ ...base, uuid: u(1), ts: ts(1), text: 'please rebuild the fixture package' }),
    w5a1Fx.toolUseRow({ ...base, uuid: u(2), ts: ts(2), parentUuid: u(1), msgId: 'msg_w5a6_2', toolUseId: 'toolu_01W5A6', name: 'Bash', input: { command: cmd } }),
    w5a1Fx.toolResultRow({ ...base, uuid: u(3), ts: ts(3), parentUuid: u(2), toolUseId: 'toolu_01W5A6', content: 'built ok' }),
    w5a1Fx.assistantRow({ ...base, uuid: u(4), ts: ts(4), parentUuid: u(3), msgId: 'msg_w5a6_4', text: 'done with the build' }),
    w5a1Fx.boundaryRow({ ...base, uuid: u(5), ts: ts(5), parentUuid: u(4), trigger: 'manual', headUuid: u(4), anchorUuid: u(6), tailUuid: u(4), allUuids: [u(4)] }),
    w5a1Fx.summaryRow({ ...base, uuid: u(6), ts: ts(6), parentUuid: u(5), text: `<summary>\n1. Primary Request and Intent:\n   ${sentinel}\n</summary>` }),
    w5a1Fx.assistantRow({ ...base, uuid: u(7), ts: ts(7), parentUuid: u(6), msgId: 'msg_w5a6_7', text: 'continuing after the summary' }),
  ];
  w5a1H.seedFamily(box, { id, project: 'demo', generation: gen, uuid: sid, rows, workdir: cwd });
  // One more tick derives leaf N (as Task 1's fixture); more, if needed, until the command row's blob is indexed.
  for (let k = 0; k < 4 && (k === 0 || !w6Indexed(box, u(2))); k += 1) {
    const t = w5a1H.runSweep(box);
    if (t.code !== 0) throw new Error(`w6SourceBox: the sweep exited ${String(t.code)}: ${t.stderr}`);
  }
  if (!w6Indexed(box, u(2))) throw new Error('w6SourceBox: the command row was never indexed');
  return { box, cwd, id, gen, cmd, sentinel, u };
}

describe.skipIf(process.platform === 'darwin')('W2-5a Task 6: sourceQuiz, Tasks 1 to 6 composed (W2-D71)', () => {
  let sb: W6SourceBox;
  w5a1BeforeAll(() => { sb = w6SourceBox('ccrc-w5a6-source-'); }, 360_000);
  const OTHER_STORE = '00000000-0000-4000-8000-0000000005a6';
  type Asked = { section: string; item: Record<string, any> };
  type Sourced = { entries: Array<Record<string, any>>; fidelity: Array<Record<string, any>>; counts: Record<string, any>; asof_same_ms_hits: Record<string, unknown> };
  /** A writer handle as openWriter answers one, with no spawn: it records each ask and writes one question. */
  const fakeWriter = (asked: Asked[]) => ({
    ask: async (section: string, item: Record<string, any>) => {
      asked.push({ section, item });
      const qid = replay.qidOf(item as never) as string;
      return { state: 'question', qid, run: { code: 0, signal: null, skipped: false, tokens: 1, result: true },
        entry: { qid, store_id: item.store_id, ccrc_id: item.ccrc_id, generation: item.generation, boundary_uuid: item.boundary_uuid,
          kind: item.kind, fact: item.fact, fact_raw: item.fact_raw, question: 'Which command rebuilt the fixture package?',
          source_entry_uuid: item.source_entry_uuid, repo_roots: [...item.repo_roots] } };
    },
  });
  type Exclude = { pilotFamilies: Array<Record<string, string>>; assignment: Array<Record<string, string>> };
  async function source(mode: 'quiz' | 'pilot', asked: Asked[], exclude: Exclude = { pilotFamilies: [], assignment: [] }, box: W6SourceBox = sb): Promise<{ r: Sourced; out: string; storeId: string }> {
    const rs = replay.openReplayStore(box.box.home) as unknown as { storeId: string; close(): void };
    try {
      const out = replay.prepareOut(join(mkTmp('ccrc-w5a6-out-'), 'out'));
      const caps = { family: 5, boundary: 3, kind_per_family: 2 };
      // No family list in either mode: sourceQuiz walks the store's own admitted families (R10). The exclusions name
      // OTHER_STORE's families too, as an assignment over every node does; they exclude nothing here.
      const r = await replay.sourceQuiz({
        mode, rs, home: box.box.home, out, writer: fakeWriter(asked), seedHex: 'ab'.repeat(32),
        exclude: { pilotFamilies: [...exclude.pilotFamilies], assignment: [{ store_id: OTHER_STORE, ccrc_id: 'claude-a-elsewhere', generation: box.gen, arm: 'control' }, ...exclude.assignment] },
        plan: mode === 'quiz' ? { target: 5, caps } : { n_fidelity: 1, n_usage: 5, caps },
        configDirs: [], top: box.box.home,
      } as never) as unknown as Sourced;
      return { r, out, storeId: rs.storeId };
    } finally {
      rs.close();
    }
  }

  it('quiz mode: the leaf\'s command fact passes every stage to the writer in Task 2\'s candidate shape and comes back a ranked frozen entry; B is recorded by its counts only', async () => {
    const asked: Asked[] = [];
    const { r, out, storeId } = await source('quiz', asked);
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0]!;
    expect(e).toMatchObject({ store_id: storeId, ccrc_id: sb.id, generation: sb.gen, boundary_uuid: sb.u(5), kind: 'command',
      fact: sb.cmd, fact_raw: sb.cmd, source_entry_uuid: sb.u(2) });
    expect(e.qid).toBe(replay.qidOf(e as never));
    expect(e.rank, 'the family\'s order key and its candidate rank (R10)').toEqual([replay.quizFamilyOrderKey('ab'.repeat(32), { store_id: storeId, ccrc_id: sb.id, generation: sb.gen }), 0]);
    expect(e.repo_roots).toContain(sb.cwd);
    expect(asked.map((a) => a.section)).toEqual(['quiz']);
    expect(asked[0]!.item).toMatchObject({ leaf: { text: sb.cmd }, pair: null, id: e.qid });
    expect((asked[0]!.item.span as Array<{ text: string }>).some((f) => f.text.includes(sb.cmd))).toBe(true);
    expect(r.asof_same_ms_hits).toEqual({ [e.qid]: { asof_same_ms_hits: 0 } });
    expect(r.counts.boundaries.admitted).toBe(1);
    const recText = readFileSync(join(out, 'quiz', 'baseline.json'), 'utf8');
    expect(JSON.parse(recText).boundaries.map((b: { state: string }) => b.state)).toEqual(['built']);
    expect(recText).not.toContain(sb.sentinel);
  }, 120_000);

  // The payload stdin has no parts argument: it is reconstructPayload's own text, so every part of it went through
  // Task 1's redaction (Task 1's W2-D54 cases plant a pair-index value in the summary, a user text and a tool_use input).
  it('fidelityStdins: the payload stdin is reconstructPayload\'s own text with an empty question, never parts handed in; the empty-question and user-text runs go through one composer, the user text redacted', () => {
    const rs = replay.openReplayStore(sb.box.home) as unknown as { db: { prepare(sql: string): { get(...a: unknown[]): unknown } }; close(): void };
    try {
      const idOf = (uuid: string): number => Number((rs.db.prepare('SELECT entry_id FROM entries WHERE uuid = ?').get(uuid) as { entry_id: number }).entry_id);
      const want = replay.reconstructPayload(rs as never, idOf(sb.u(5)), '') as { state: string; text: string };
      expect(want.state, 'CONTROL: the box\'s boundary reconstructs').toBe('payload');
      expect(want.text, 'CONTROL: the payload holds the summary').toContain(sb.sentinel);
      const k = w6Akia('QRSTUVW');
      const r = replay.fidelityStdins(rs as never, idOf(sb.u(5)), [w6Field(`rebuild with ${k}`)]);
      expect(r.state).toBe('stdins');
      const s = (r as { stdins: Record<string, string> }).stdins;
      expect(Object.keys(s).sort()).toEqual([...replay.FIDELITY_RUNS].sort());
      expect(s['payload']).toBe(want.text);
      expect(s['empty']).toBe(replay.composePayload(replay.FIDELITY_EMPTY_PARTS, ''));
      expect(s['user-text']).toBe(replay.composePayload(replay.FIDELITY_EMPTY_PARTS, `rebuild with ${t4Lib.REDACTED_MARK}`));
      expect(s['empty']).not.toContain(sb.sentinel);
      for (const v of Object.values(s)) {
        expect(v.endsWith(w6Gate.ANSWER_PROTOCOL)).toBe(true);
        expect(v).not.toContain(k);
      }
      expect(replay.fidelityStdins(rs as never, idOf(sb.u(5)), [{ text: 'x', rawLen: t4Lib.BLOB_DECODE_MAX + 1 }]))
        .toEqual({ state: 'discard', why: 'over-decode-cap' });
      expect(replay.fidelityStdins(rs as never, idOf(sb.u(1)), [w6Field('x')]), 'a row that is no boundary answers reconstruction\'s own word')
        .toEqual({ state: 'discard', why: 'boundary-absent' });
    } finally {
      rs.close();
    }
  }, 120_000);

  it('pilot mode: one fidelity boundary per family before the usage questions, on the pilot\'s own stream', async () => {
    const asked: Asked[] = [];
    const { r, storeId } = await source('pilot', asked);
    expect(r.fidelity).toEqual([{ store_id: storeId, ccrc_id: sb.id, generation: sb.gen, boundary_uuid: sb.u(5) }]);
    expect(r.entries.map((x) => x.fact)).toEqual([sb.cmd]);
    expect(asked.map((a) => a.section)).toEqual(['pilot']);
  }, 120_000);

  it('quiz mode walks this node\'s own admitted families, never a census list (R10, W2-D71, W2-D77): a family no census names is sourced; CONTROL: a pilot family and a control-held (store_id, ccrc_id) are not', async () => {
    // The box's family is in no census and no assignment as a quiz family: sourceQuiz is handed no family list at all.
    const free = await source('quiz', []);
    expect(free.r.entries.map((x) => [x.ccrc_id, x.fact])).toEqual([[sb.id, sb.cmd]]);
    expect(free.r.counts.population).toEqual({ 'no-admitted-boundary': 0, pilot: 0, 'control-id': 0 });
    const own = { store_id: free.storeId, ccrc_id: sb.id, generation: sb.gen };
    const asked: Asked[] = [];
    const pilot = await source('quiz', asked, { pilotFamilies: [own], assignment: [] });
    expect(pilot.r.entries, 'CONTROL: a pilot family is never quizzed').toEqual([]);
    expect(pilot.r.counts.population).toEqual({ 'no-admitted-boundary': 0, pilot: 1, 'control-id': 0 });
    // Another generation of the same (store_id, ccrc_id) assigned control excludes every generation of it (W2-D77).
    const control = await source('quiz', asked, { pilotFamilies: [], assignment: [{ ...own, generation: '00000000-0000-4000-8000-0000000005a7', arm: 'control' }] });
    expect(control.r.entries, 'CONTROL: a control-held id is never quizzed').toEqual([]);
    expect(control.r.counts.population).toEqual({ 'no-admitted-boundary': 0, pilot: 0, 'control-id': 1 });
    expect(asked, 'neither excluded family reached the writer').toEqual([]);
  }, 120_000);

  // The shipped stage, not Task 2's functions called directly: writerInputOf sends F as it stands, so sourceQuiz's
  // redaction stage is what keeps a masked F from the writer's stdin, input.json and the frozen lists (W2-D67, R10 F6).
  it('W2-D67 on the shipped path: a key-shaped command fact in the store is dropped redact-fact at sourceQuiz\'s redaction stage and never reaches the writer or --out; CONTROL: the plain box\'s command passes that stage', async () => {
    const key = w6Akia('KLMNOPQ');
    const kb = w6SourceBox('ccrc-w5a6-source-key-', `aws configure set aws_access_key_id ${key}`);
    expect(t4Lib.redactField(kb.cmd, W6_IDX), 'CONTROL: lib\'s shape layer masks the fact').not.toContain(key);
    const asked: Asked[] = [];
    const { r, out } = await source('quiz', asked, { pilotFamilies: [], assignment: [] }, kb);
    expect(r.counts.boundaries.admitted, 'CONTROL: the boundary is admitted, so its leaf is mined').toBe(1);
    expect(r.counts.drops.redaction).toEqual({ 'redact-fact': 1 });
    expect(r.entries).toEqual([]);
    expect(asked, 'the writer is never asked').toEqual([]);
    // sourceQuiz writes one file under --out, the baseline record; the frozen lists and the writer's input.json carry
    // only what the writer was asked, and it was asked nothing.
    const recText = readFileSync(join(out, 'quiz', 'baseline.json'), 'utf8');
    expect(JSON.parse(recText).boundaries, 'no B was built: the drop came before admission').toEqual([]);
    expect(recText).not.toContain(key.slice(4));
    // CONTROL: the plain box's command passes the redaction stage and reaches the writer.
    const plainAsked: Asked[] = [];
    const plain = await source('quiz', plainAsked);
    expect(plain.r.counts.drops.redaction).toEqual({});
    expect(plainAsked.map((a) => a.item.fact)).toEqual([sb.cmd]);
  }, 600_000);
});
