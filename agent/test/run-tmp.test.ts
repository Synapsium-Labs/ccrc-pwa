// The agent suite's per-run temp parent: the server package's mechanism (`server/test/run-tmp.globalsetup.mjs`,
// #316), wired here by `vitest.config.ts`, not copied. That file's own suite (`server/test/run-tmp.test.ts`) pins
// the mechanism's every verdict; this one pins only that the AGENT suite gets its guarantees, with the agent's
// real `setupFiles` and `globalSetup` (the PATH containment included) derived from `vitest.config.ts`.
//
// WHY. Before the wiring, the contain-path root and every fixture went loose in TMPDIR, and the only cleanups were
// `globalSetup`'s teardown and the workers' `afterAll` hooks — none of which runs when the run is killed. Measured
// on a Mac, a whole `vitest run` under a scratch TMPDIR: a clean run left 0 entries, and a SIGINT to the group (or
// GNU timeout's double SIGTERM) ten seconds in left 30 (`ccrc-agent-containpath-run-*`, `-home-*`,
// `-deployverify-*`, …), every one of them for good: nothing reaped them later.
//
// WHAT IS PINNED:
//   - The wiring (A1): THIS run is inside its own run directory, its owner answers, and the PATH-containment
//     directory and a `mkTmp` fixture are both inside it.
//   - End to end (A2-A4), a nested real vitest under the agent's real setup: Ctrl-C to the group and GNU
//     timeout's double SIGTERM each leave the base empty; a SIGKILLed run is left while fresh and swept by the
//     next run once quiet.
//
// Socket bases live under a short `/tmp/ccrc-agent-rt-XXXXXX`, because a `mkTmp` path is too long for `sun_path`
// on macOS (104 bytes) — `server/test/run-tmp.test.ts`'s reason too — and each is removed after its test. Every
// process signalled is one this file started, by the handle Node keeps or the group id its leader was given.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RUN_DIR_ENV, RUN_PREFIX, RUN_QUIET_ENV, RUN_REFUSED_ENV, RUN_TMP, probeRun,
} from '../../server/test/run-tmp.globalsetup.mjs';
import { CONTAIN_PATH_ROOT_ENV } from './contain-path.globalsetup.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const agentRoot = path.resolve(here, '..');
const VITEST = path.resolve(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');

const groups: ChildProcess[] = [];
const bases: string[] = [];

const running = (c: ChildProcess): boolean => c.exitCode === null && c.signalCode === null;

/** Signal a group this file made, and its leader through its handle. Refuses anything that could be pid 0 or 1. */
function killGroup(c: ChildProcess, signal: NodeJS.Signals): void {
  const pid = c.pid;
  if (pid === undefined || !Number.isInteger(pid) || pid <= 1) throw new Error(`killGroup refuses pid ${pid}`);
  try { process.kill(-pid, signal); } catch { /* the group is empty */ }
  if (running(c)) c.kill(signal);
}

afterEach(() => {
  for (const c of groups.splice(0)) killGroup(c, 'SIGKILL');
  for (const b of bases.splice(0)) rmSync(b, { recursive: true, force: true });
});

/** A short socket base, real-pathed (macOS's `/tmp` is a link to `/private/tmp`), removed after the test. */
function socketBase(): string {
  const b = realpathSync(mkdtempSync('/tmp/ccrc-agent-rt-'));
  bases.push(b);
  return b;
}

describe('this run is wired (A1)', () => {
  it('runs inside its own run directory, the containment and the fixtures with it, and its owner answers', async () => {
    const refused = process.env[RUN_REFUSED_ENV];
    expect(refused, `the per-run temp dir was refused (${refused}); EINVAL means this TMPDIR is too long for a unix `
      + 'socket (sun_path) — see the header of server/test/run-tmp.globalsetup.mjs').toBeUndefined();
    const run = process.env[RUN_DIR_ENV];
    expect(run, 'no run directory: ../server/test/run-tmp.globalsetup.mjs is not wired as globalSetup in vitest.config.ts')
      .toBeTruthy();
    const inside = path.join(run!, RUN_TMP) + path.sep;
    expect(realpathSync(tmpdir())).toBe(path.join(run!, RUN_TMP));
    expect(mkTmp('ccrc-agent-runtmp-wire-').startsWith(inside)).toBe(true);
    // The containment's root must be made AFTER the run parent, or it lands loose in TMPDIR again: the order of
    // the `globalSetup` list is what this reads.
    expect(process.env[CONTAIN_PATH_ROOT_ENV]?.startsWith(inside), 'the contain-path root is outside the run directory')
      .toBe(true);
    expect(process.env.CCRC_TEST_CONTAINED_PATH_DIR?.startsWith(inside), 'the stub PATH dir is outside the run directory')
      .toBe(true);
    expect(await probeRun(run!)).toBe('live');
  });
});

describe('end to end: a nested real vitest under the agent\'s real setup (A2-A4)', () => {
  /** A `vitest.config.ts` list, read from its text (comments dropped) and resolved, so unwiring an entry reds
   *  every case here instead of quietly narrowing what they cover. */
  const entries = (key: string): string[] => {
    const cfg = readFileSync(path.join(agentRoot, 'vitest.config.ts'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    const m = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(cfg);
    expect(m, `${key} is not wired in vitest.config.ts`).toBeTruthy();
    const files = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => path.resolve(agentRoot, x[1]!));
    expect(files.length, `${key} names no files`).toBeGreaterThan(0);
    return files;
  };

  /** Makes a fixture the raw way, records what the run handed its worker, then sleeps or passes. */
  const FX_TEST = [
    "import { appendFileSync, mkdtempSync, readdirSync } from 'node:fs';",
    "import { tmpdir } from 'node:os';",
    "import path from 'node:path';",
    'const env = process.env;',
    "it('records its run, then does what FX_MODE says', async () => {",
    "  mkdtempSync(path.join(tmpdir(), 'ccrc-agent-fx-'));",
    '  appendFileSync(env.FX_RECORD, JSON.stringify({ tmpdir: tmpdir(),',
    `    runDir: env[${JSON.stringify(RUN_DIR_ENV)}], refused: env[${JSON.stringify(RUN_REFUSED_ENV)}],`,
    '    contained: env.CCRC_TEST_CONTAINED_PATH_DIR, baseListing: readdirSync(env.FX_BASE) }) + "\\n");',
    "  if (env.FX_MODE === 'sleep') await new Promise((r) => setTimeout(r, 30000));",
    '});',
    '',
  ].join('\n');

  interface Rec { tmpdir: string; runDir?: string; refused?: string; contained?: string; baseListing: string[] }
  type Exit = { code: number | null; signal: NodeJS.Signals | null };
  interface Nested { child: ChildProcess; pid: number; fx: string; exit: Promise<Exit>; output: () => string }

  /** A nested `vitest run` under `base` as its TMPDIR, in a process group of its own. This process runs under the
   *  outer run, so the run's and the containment's names are deleted — inherited, they would point the child at
   *  the outer run's directories. */
  function nested(base: string, mode: 'sleep' | 'pass', extra: { [k: string]: string } = {}): Nested {
    const fx = mkTmp('ccrc-agent-runtmp-e2e-');
    const config = { test: { globals: true, include: ['*.fx.test.mjs'], testTimeout: 60_000,
      setupFiles: entries('setupFiles'), globalSetup: entries('globalSetup') } };
    writeFileSync(path.join(fx, 'vitest.config.mjs'), `export default ${JSON.stringify(config)};\n`);
    writeFileSync(path.join(fx, 'run.fx.test.mjs'), FX_TEST);
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of [RUN_DIR_ENV, RUN_REFUSED_ENV, RUN_QUIET_ENV, CONTAIN_PATH_ROOT_ENV, 'CCRC_TEST_CONTAINED_PATH_DIR']) delete env[k];
    Object.assign(env, { TMPDIR: base, CI: '1', FX_BASE: base, FX_RECORD: path.join(fx, 'record.jsonl'), FX_MODE: mode }, extra);
    const c = spawn(process.execPath, [VITEST, 'run', '--root', fx], { cwd: fx, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    groups.push(c);
    let out = '';
    c.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; });
    c.stderr!.setEncoding('utf8').on('data', (d: string) => { out += d; });
    const watchdog = setTimeout(() => killGroup(c, 'SIGKILL'), 90_000);
    const exit = new Promise<Exit>((r) => c.once('exit', (code, signal) => { clearTimeout(watchdog); r({ code, signal }); }));
    return { child: c, pid: c.pid!, fx, exit, output: () => out };
  }

  const records = (n: Nested): Rec[] => {
    const f = path.join(n.fx, 'record.jsonl');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec) : [];
  };

  /** The fixture's first record — the moment its worker is inside the run — or a failure naming the output. */
  async function firstRecord(n: Nested): Promise<Rec> {
    let done = false;
    void n.exit.then(() => { done = true; });
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      const r = records(n);
      if (r.length > 0) return r[0]!;
      if (done) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error(`the nested run wrote no record\n--- nested output ---\n${n.output()}`);
  }

  /** POSITIVE CONTROLS: the run was really inside its own directory, with the containment and a fixture in it,
   *  so an empty base afterwards is the cleanup's doing and not a run that never wrote there. */
  function expectInsideRun(rec: Rec, base: string, n: Nested): void {
    expect(rec.refused, n.output()).toBeUndefined();
    expect(rec.tmpdir).toMatch(new RegExp(`^${base}/${RUN_PREFIX}[A-Za-z0-9]{6}/${RUN_TMP}$`));
    expect(rec.contained?.startsWith(rec.tmpdir + path.sep), `the stub PATH dir ${rec.contained} is outside the run`).toBe(true);
    expect(readdirSync(rec.tmpdir).some((f) => f.startsWith('ccrc-agent-fx-')), 'the fixture is not in the run').toBe(true);
  }

  it('A2: Ctrl-C to the group mid-suite exits 130 and leaves the base empty', async () => {
    const base = socketBase();
    const n = nested(base, 'sleep');
    const rec = await firstRecord(n);
    expectInsideRun(rec, base, n);
    process.kill(-n.pid, 'SIGINT');
    expect(await n.exit, n.output()).toEqual({ code: 130, signal: null });
    expect(readdirSync(base), 'the base is not empty after Ctrl-C').toEqual([]);
  }, 120_000);

  it('A3: GNU timeout\'s double SIGTERM — main, then its group — exits 143 and leaves the base empty', async () => {
    const base = socketBase();
    const n = nested(base, 'sleep');
    const rec = await firstRecord(n);
    expectInsideRun(rec, base, n);
    process.kill(n.pid, 'SIGTERM');
    process.kill(-n.pid, 'SIGTERM');
    expect(await n.exit, n.output()).toEqual({ code: 143, signal: null });
    expect(readdirSync(base), 'the base is not empty after SIGTERM').toEqual([]);
  }, 120_000);

  it('A4: a SIGKILLed run is left while fresh, and the next run sweeps it once quiet', async () => {
    const base = socketBase();
    const killed = nested(base, 'sleep');
    const rec = await firstRecord(killed);
    expectInsideRun(rec, base, killed);
    process.kill(killed.pid, 'SIGKILL');
    await killed.exit;
    killGroup(killed.child, 'SIGKILL');
    const run = rec.runDir!;
    expect(existsSync(run), 'no arm can answer SIGKILL, so the run must still be there').toBe(true);
    expect(await probeRun(run)).toBe('dead');
    // The quiet gate's positive control: under the default window the next run leaves a fresh dead run alone.
    const fresh = nested(base, 'pass');
    expect((await fresh.exit).code, fresh.output()).toBe(0);
    expect(existsSync(run), 'a dead run younger than the quiet window was swept').toBe(true);
    // With the window at zero the next run sweeps it at SETUP: its worker never sees it.
    const sweeping = nested(base, 'pass', { [RUN_QUIET_ENV]: '0' });
    expect((await sweeping.exit).code, sweeping.output()).toBe(0);
    expect(records(sweeping)[0]?.baseListing, 'setup did not sweep the quiet dead run').not.toContain(path.basename(run));
    // Every `ccrc-` entry is gone. Not asserted empty: vitest's own `project.tmpDir` sits beside the run, outside
    // it, and SIGKILL leaves it for good — the shared mechanism collects it on a signal only (D-6623).
    expect(readdirSync(base).filter((f) => f.startsWith('ccrc-')), 'a run or fixture survived the sweeping run').toEqual([]);
  }, 120_000);
});
