// `.github/ci/trace-run.mjs` (spec §5.1/§5.3/§5.4, contract Task 7): runs a real `strace`d `vitest` process per
// server test file. These are REAL integration tests -- they shell out to real `strace`, `timeout` and `vitest`
// against fixture test files written into this repo's OWN `server/`, because `vitest.select.config.ts` resolves
// `CCRC_TEST_LIST` entries relative to `server/`, and a synthetic standalone repo would need its own
// `node_modules` to run real `vitest` under real `strace` at all. The fixtures live in a per-run DOT directory
// under `server/` — never `server/test/`, where a concurrent vitest would collect them and typecheck-tests'
// census would race them; vitest's include glob does not match it, the census skips dot directories, and a
// literal include there runs (measured).
//
// When this file is itself being traced (a map rebuild traces every server test; `CCRC_TRACING=1` comes from
// trace-run's own environment), its nested-strace cases skip: strace cannot attach under an outer strace, so
// they would fail and leave this file `unknown` in every map.
//
// Platform gating (per the plan): `strace` does not exist on Darwin, so this whole suite is a structural no-op
// there -- `describe.skip`. On Linux, `strace` is a required tool for real CI (the daily map rebuild and every
// per-merge refresh depend on it); a Linux box that lacks it while `CI` is set must FAIL loudly, never silently
// skip -- §6.3's "loud, never silent" applies to the tracer's own preconditions as much as to the selector's.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceArgv, traceAll, tracedCommand, tracedEnv, recordOf, runTraced, runPool } from '../../.github/ci/trace-run.mjs';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const repoRoot = path.resolve(serverRoot, '..');

// The pure half — the command, the environment and the reading of one finished run — needs no strace, so it
// runs on every platform.
describe('trace-run.mjs: the traced command and how a finished run is read', () => {
  it('tracedCommand: strace, then a sh that writes its own pid and execs vitest (exec keeps the pid)', () => {
    expect(tracedCommand('/w/trace', '/w/root.pid')).toEqual([
      ...traceArgv('/w/trace'),
      'sh', '-c', 'echo $$ > "$0"; exec "$@"', '/w/root.pid',
      './node_modules/.bin/vitest', 'run', '--config', 'vitest.select.config.ts', '--maxWorkers=1',
    ]);
  });

  it('tracedEnv: the exact list, CI, libuv kept off io_uring, and CCRC_TRACING marking a traced run', () => {
    expect(tracedEnv({ PATH: '/bin', UV_USE_IO_URING: '1' }, '/w/list.txt')).toEqual({
      PATH: '/bin', CCRC_TEST_LIST: '/w/list.txt', CI: 'true', UV_USE_IO_URING: '0', CCRC_TRACING: '1',
    });
  });

  it('runTraced resolves when the process EXITS, even while a backgrounded descendant still holds its stdio', async () => {
    // The guard for a trace shard hanging to its deadline: `stdio: 'ignore'` + the 'exit' event. With a piped
    // stdio and 'close', this waits the sleeper's full 30s (measured: 4ms against 7007ms for a 7s sleeper).
    const dir = mkTmp('ccrc-trace-run-bg-');
    const pidFile = path.join(dir, 'bg.pid');
    const start = Date.now();
    const exit = await runTraced(['sh', '-c', `sleep 30 & echo $! > "${pidFile}"; exit 0`], {});
    const elapsed = Date.now() - start;
    try {
      expect(exit).toEqual({ code: 0, signal: null, error: null });
      expect(elapsed).toBeLessThan(10_000);
    } finally {
      try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch { /* already gone */ }
    }
  });

  it('runPool visits every item once and never runs more than `concurrency` at a time', async () => {
    const seen: number[] = [];
    let inFlight = 0;
    let peak = 0;
    await runPool([1, 2, 3, 4, 5], 2, async (n: number) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      seen.push(n);
      inFlight -= 1;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  /** A finished run's work dir: `trace/t.<pid>` files and, unless `pid` is null, `root.pid`. */
  function workDir(pid: string | null, files: Record<string, string>): string {
    const dir = mkTmp('ccrc-trace-run-work-');
    mkdirSync(path.join(dir, 'trace'));
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, 'trace', name), text);
    if (pid !== null) writeFileSync(path.join(dir, 'root.pid'), pid + '\n');
    return dir;
  }
  const REPO = mkTmp('ccrc-trace-run-repo-');
  const ok = { code: 0, signal: null, error: null };
  const cfg = `openat(AT_FDCWD<${REPO}/server>, "${REPO}/server/vitest.config.ts", O_RDONLY) = 3<${REPO}/server/vitest.config.ts>\n`;
  const own = `openat(AT_FDCWD<${REPO}/server>, "${REPO}/ccd/ccd", O_RDONLY) = 3<${REPO}/ccd/ccd>\n`;

  it('a clean run: the root pid\'s process is root, everything else rest, not unknown', () => {
    const rec = recordOf(workDir('700', { 't.700': cfg, 't.701': own }), REPO, ok, 60);
    expect(rec).toEqual({
      root: { read: ['server/vitest.config.ts'], probed: [], listed: [], subtree: [], git: false },
      rest: { read: ['ccd/ccd'], probed: [], listed: [], subtree: [], git: false },
      unknown: false,
    });
  });

  it('no root.pid, or a root pid with no trace file -> unknown (the split cannot be trusted)', () => {
    const noPid = recordOf(workDir(null, { 't.700': cfg }), REPO, ok, 60);
    expect(noPid.unknown).toBe(true);
    expect(noPid.why).toMatch(/root process/);
    const noFile = recordOf(workDir('999', { 't.700': cfg }), REPO, ok, 60);
    expect(noFile.unknown).toBe(true);
    expect(noFile.why).toMatch(/root process/);
  });

  it('a non-zero exit, a timeout, or an unresolved path -> unknown with the reason', () => {
    expect(recordOf(workDir('700', { 't.700': cfg }), REPO, { code: 1, signal: null, error: null }, 60).why)
      .toBe('vitest exited 1');
    expect(recordOf(workDir('700', { 't.700': cfg }), REPO, { code: 124, signal: null, error: null }, 60).why)
      .toBe('timeout after 60s');
    const unresolved = recordOf(workDir('700', { 't.700': 'access("rel", F_OK) = 0\n' }), REPO, ok, 60);
    expect(unresolved.unknown).toBe(true);
    expect(unresolved.why).toMatch(/unresolved/);
  });
});

const isDarwin = process.platform === 'darwin';
const hasStrace = (() => {
  try {
    return spawnSync('strace', ['-V']).status === 0;
  } catch {
    return false;
  }
})();

describe.skipIf(isDarwin)('trace-run.mjs', () => {
  if (!isDarwin && !hasStrace) {
    // Linux, no strace: CI must go red, never quietly skip (§6.3's "loud, never silent"); a local dev box
    // without strace gets a clear failure too, rather than a suite that silently ran zero assertions.
    it('FAILS loudly when strace is required but missing (linux)', () => {
      throw new Error(
        'trace-run.mjs test suite requires `strace` on Linux and none was found on PATH -- ' +
        'install it rather than skip this suite (CI test selection cannot trace without it).',
      );
    });
    return;
  }

  it('traceArgv is exactly the pinned strace invocation', () => {
    expect(traceArgv('/some/dir')).toEqual([
      'strace', '-f', '-ff', '-ttt', '-y', '-qq',
      '-e', 'trace=openat,openat2,open,newfstatat,statx,access,faccessat2,readlink,readlinkat,getdents64,execve,execveat,symlink,symlinkat,chdir,fchdir,clone,clone3',
      '-o', '/some/dir/t',
    ]);
  });

  const nested = process.env.CCRC_TRACING === '1';

  describe.skipIf(nested)('real traced runs', () => {
    // A per-run dot directory under server/: see the file header.
    const fixtureRel = `.ci-tracerun-${process.pid}-${Date.now()}`;
    const fixtureDir = path.join(serverRoot, fixtureRel);
    const tiny = `${fixtureRel}/tiny.test.ts`;
    const linked = `${fixtureRel}/linked.test.ts`;
    const failing = `${fixtureRel}/failing.test.ts`;
    const slow = `${fixtureRel}/slow.test.ts`;
    const leak = `${fixtureRel}/leak.test.ts`;
    const leakPidFile = path.join(fixtureDir, 'leak.pid');
    const cli = path.join(repoRoot, '.github', 'ci', 'trace-run.mjs');

    beforeAll(() => {
      mkdirSync(fixtureDir);
      writeFileSync(path.join(serverRoot, tiny),
        "import { describe, it, expect } from 'vitest';\n" +
        "describe('ci-tracerun tiny fixture', () => {\n" +
        // Asserted INSIDE the traced process, so the environment traceOne really passes is what is checked
        // (a red here makes the run exit 1, which the record reports as unknown).
        "  it('runs with libuv off io_uring', () => { expect(process.env.UV_USE_IO_URING).toBe('0'); });\n" +
        '});\n');
      // Reads two repo files only THROUGH symlinks in a tmp dir, the way ccrc-models builds its fixture box: one
      // opened (its fd resolves to the repo file), one only stat'ed (only the link's creation names it) — and
      // stats a file through a link to a whole repo DIRECTORY, which leaves only the directory to record.
      writeFileSync(path.join(serverRoot, linked),
        "import { it, expect } from 'vitest';\n" +
        "import { mkdtempSync, symlinkSync, readFileSync, statSync } from 'node:fs';\n" +
        "import { tmpdir } from 'node:os';\n" +
        "import path from 'node:path';\n" +
        "it('reads through tmp symlinks', () => {\n" +
        "  const box = mkdtempSync(path.join(tmpdir(), 'ccrc-tracerun-box-'));\n" +
        `  symlinkSync(${JSON.stringify(path.join(repoRoot, 'ccd', 'worker-skill', 'SKILL.md'))}, path.join(box, 'skill'));\n` +
        `  symlinkSync(${JSON.stringify(path.join(repoRoot, 'ccd', 'ccrc-models-probe'))}, path.join(box, 'probe'));\n` +
        "  expect(readFileSync(path.join(box, 'skill'), 'utf8').length).toBeGreaterThan(0);\n" +
        "  expect(statSync(path.join(box, 'probe')).isFile()).toBe(true);\n" +
        `  symlinkSync(${JSON.stringify(path.join(repoRoot, 'shared'))}, path.join(box, 'shared'));\n` +
        "  expect(statSync(path.join(box, 'shared', 'api.ts')).isFile()).toBe(true);\n" +
        '});\n');
      writeFileSync(path.join(serverRoot, failing),
        "import { it, expect } from 'vitest';\n" +
        "it('fails', () => { expect(1).toBe(2); });\n");
      writeFileSync(path.join(serverRoot, slow),
        "import { it } from 'vitest';\n" +
        "it('outlives the trace timeout', async () => { await new Promise((r) => setTimeout(r, 20_000)); }, 30_000);\n");
      writeFileSync(path.join(serverRoot, leak),
        "import { describe, it } from 'vitest';\n" +
        "import { spawn } from 'node:child_process';\n" +
        "import { writeFileSync } from 'node:fs';\n" +
        "describe('ci-tracerun leak fixture', () => {\n" +
        // `stdio: 'inherit'` (not 'ignore') is the part that matters: it shares this grandchild's stdout/
        // stderr fds with the process that spawned it. Its pid goes to a file, so afterAll kills exactly it.
        "  it('spawns a detached long-running process, inheriting stdio, and returns immediately', () => {\n" +
        "    const child = spawn('sleep', ['300'], { detached: true, stdio: 'inherit' });\n" +
        `    writeFileSync(${JSON.stringify(leakPidFile)}, String(child.pid));\n` +
        '    child.unref();\n' +
        '  });\n' +
        '});\n');
    });

    afterAll(() => {
      // Exactly the leaked sleeper, never a pattern: it is the leader of its own process group (detached).
      if (existsSync(leakPidFile)) {
        const pid = Number(readFileSync(leakPidFile, 'utf8'));
        try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      rmSync(fixtureDir, { recursive: true, force: true });
    });

    it('traces the baseline plus two files at jobs:2: the tiny one reads itself, the linked one reads through symlinks', async () => {
      const records = await traceAll(repoRoot, [tiny, linked], { jobs: 2, timeoutSec: 120 });
      expect(records.format).toBe(2);
      expect(records.baseline.root.git).toBe(false);
      expect(records.baseline.rest.git).toBe(false);
      expect(records.baseline.root.read).toContain('server/test/ci-baseline.test.ts');
      // The include glob's walk of server/test is the ROOT process's (measured on one of its threadpool
      // threads), never the worker's — which is what lets a test's own walk of it survive the subtraction.
      expect(records.baseline.root.listed).toContain('server/test');
      expect(records.baseline.rest.listed).not.toContain('server/test');

      expect(Object.keys(records.tests).sort()).toEqual([`server/${linked}`, `server/${tiny}`]);
      const t = records.tests[`server/${tiny}`];
      expect(t.unknown).toBe(false);
      expect(t.root.read).toContain(`server/${tiny}`);
      const l = records.tests[`server/${linked}`];
      expect(l.unknown).toBe(false);
      expect(l.rest.read).toContain('ccd/worker-skill/SKILL.md');
      expect(l.rest.read).toContain('ccd/ccrc-models-probe');
      expect(l.rest.subtree).toEqual(['shared']);
    }, 180_000);

    it('a baseline that fails to trace is a hard stop for the whole run', async () => {
      await expect(traceAll(repoRoot, [], { baselineTimeoutSec: 0.05, killAfterSec: 1 }))
        .rejects.toThrow(/trace-run: baseline trace failed: timeout after 0\.05s/);
    }, 60_000);

    it('records a leaked detached background process as unknown, and the runner returns', async () => {
      // The baseline gets its own ordinary timeout (a loaded box once took the 3s for itself); the leak fixture
      // gets 3s and a 2s kill-after grace, so this case does not idle on the default 30.
      const start = Date.now();
      const records = await traceAll(repoRoot, [leak], { jobs: 1, timeoutSec: 3, baselineTimeoutSec: 120, killAfterSec: 2 });
      const elapsedMs = Date.now() - start;
      const rec = records.tests[`server/${leak}`];
      expect(rec.unknown).toBe(true);
      expect(rec.why).toMatch(/timeout/i);
      // The leaked grandchild must not hang the job: back well inside its 300s — and inside the default 30s
      // kill-after grace too, which is what shows `killAfterSec` reached `timeout` (measured ~10s here).
      expect(elapsedMs).toBeLessThan(25_000);
    }, 150_000);

    it('the CLI records a traced test that FAILED or TIMED OUT as unknown and still exits 0 — map-build decides what is red', () => {
      const dir = mkTmp('ccrc-trace-run-cli-');
      writeFileSync(path.join(dir, 'red.txt'), `${failing}\n${slow}\n`);
      writeFileSync(path.join(dir, 'none.txt'), '');
      const red = spawnSync(process.execPath, [cli, '--repo', repoRoot, '--files', path.join(dir, 'red.txt'),
        '--out', path.join(dir, 'red.json'), '--timeout', '8', '--kill-after', '2'], { encoding: 'utf8' });
      expect(red.status).toBe(0);
      expect(red.stdout).toContain(`trace-run: server/${failing}: vitest exited 1`);
      expect(red.stdout).toContain(`trace-run: server/${slow}: timeout after 8s`);
      expect(red.stdout).not.toContain('::error::');
      const records = JSON.parse(readFileSync(path.join(dir, 'red.json'), 'utf8'));
      expect(records.tests[`server/${failing}`]).toMatchObject({ unknown: true, why: 'vitest exited 1' });
      expect(records.tests[`server/${slow}`]).toMatchObject({ unknown: true, why: 'timeout after 8s' });
      const green = spawnSync(process.execPath, [cli, '--repo', repoRoot, '--files', path.join(dir, 'none.txt'),
        '--out', path.join(dir, 'green.json'), '--timeout', '120'], { encoding: 'utf8' });
      expect(green.status).toBe(0);
    }, 180_000);
  });
});
