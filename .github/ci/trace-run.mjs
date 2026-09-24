// CI test selection (spec §5.1, §5.3, §5.4, contract Task 7): runs one or more server test files, each in its
// own `strace`d `vitest` process, and folds the parsed dependencies into a `Records` JSON (`.github/ci/testmap.mjs`
// then subtracts the baseline and builds/refreshes a `TestMap` from it -- this module's own output is RAW).
//
// The baseline (`test/ci-baseline.test.ts`) always traces FIRST, sequentially, never inside the concurrent pool:
// every other test's record is meaningless without it (the map-build step subtracts it from everything), so a
// baseline that fails to trace is a hard stop for the whole run, not one more `unknown: true` entry.
//
// Every record is kept SPLIT BY PROCESS — `root` (the vitest root process: its config, its include glob's walk of
// `server/test/`, the transforms of the test's imports) and `rest` (the worker and everything the test spawns) —
// because the baseline is subtracted per side (see `trace-to-deps.mjs`'s header for why). The root pid is
// captured by running vitest through `sh -c 'echo $$ > "$0"; exec "$@"'`: sh writes its own pid, then execs
// vitest as that same pid.
//
// The CLI does not decide what is red: it always writes the records and exits 0 (a crash of the runner itself is
// still non-zero). A traced test that failed or timed out is recorded `unknown` and named on stdout; whether that
// is NEWS — failing now and not unknown in the map this run started from — is `testmap.mjs`'s to say, after it
// has written the map (spec §5.4). A test that always fails under tracing (session-hook's timing budgets) would
// otherwise turn every refresh that re-traces it red.
//
// A test that SKIPS some of its own cases when traced (`CCRC_TRACING=1`, below) exits 0 with a record too small
// to trust — the skipped cases read nothing — which is the one unsafe direction (spec §5.2). Such a file is on
// `SKIPS_UNDER_TRACE`, and every record of it is written `unknown` (final review FR-5), so rule 2 always selects
// it. Its why is not a failure: testmap.mjs neither counts it as news nor warns on it.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTraceDirSplit } from './trace-to-deps.mjs';

/** @typedef {import('./trace-to-deps.mjs').DepRecord} DepRecord */
/** @typedef {{ root: DepRecord, rest: DepRecord, unknown: boolean, why?: string }} SplitRecord */
/** @typedef {{ format: 2, baseline: { root: DepRecord, rest: DepRecord }, tests: Record<string, SplitRecord> }} Records */

const DEFAULT_JOBS = 2;
const DEFAULT_TIMEOUT_SEC = 900;
const KILL_AFTER_SEC = 30;
const BASELINE_SERVER_REL = 'test/ci-baseline.test.ts';
const ROOT_PID_SH = 'echo $$ > "$0"; exec "$@"';

/** Repo-relative test files that skip cases when traced — each reads `CCRC_TRACING` (a scan in
 *  `ci-trace-run.test.ts` keeps this list equal to the files that do). `ci-trace-run.test.ts` skips its real
 *  traced runs (strace cannot attach under an outer strace), which read `ccd/worker-skill/SKILL.md`,
 *  `ccd/ccrc-models-probe` and `shared/` through links: its traced record never names them. */
export const SKIPS_UNDER_TRACE = ['server/test/ci-trace-run.test.ts'];
export const SKIPS_UNDER_TRACE_WHY = 'skips cases under trace';

/** `record`, written unknown when `file` is on `list` (default `SKIPS_UNDER_TRACE`) — with the why
 *  `SKIPS_UNDER_TRACE_WHY`, unless the run was already unknown for its own reason (a failure, a timeout), which
 *  wins as the first reason does in `recordOf`. The deps are kept either way.
 *  @param {string} file @param {SplitRecord} record @param {string[]} [list] @returns {SplitRecord} */
export function markSkipsUnderTrace(file, record, list = SKIPS_UNDER_TRACE) {
  if (!list.includes(file) || record.unknown) return record;
  return { ...record, unknown: true, why: SKIPS_UNDER_TRACE_WHY };
}

/**
 * The exact `strace` invocation this module wraps every traced `vitest run` in (spec §5.1): per-thread output
 * files (`-ff`), fd-to-path annotations (`-y`) so a relative path is always resolvable from the same line
 * (see `trace-to-deps.mjs`'s header), quiet (`-qq`), restricted to the file-shaped syscalls the map records —
 * plus `readlink` (`realpathSync.native` probes with it and nothing else) and `clone`/`clone3`, which record
 * nothing themselves but say which thread belongs to which process, for the root/rest split.
 * @param {string} traceDir
 * @returns {string[]}
 */
export function traceArgv(traceDir) {
  return [
    'strace', '-f', '-ff', '-ttt', '-y', '-qq',
    '-e', 'trace=openat,openat2,open,newfstatat,statx,access,faccessat2,readlink,readlinkat,getdents64,execve,execveat,symlink,symlinkat,chdir,fchdir,clone,clone3',
    '-o', path.join(traceDir, 't'),
  ];
}

/**
 * The whole traced command for one test file, run from `server/`: strace, then a `sh` that writes its OWN pid to
 * `pidFile` and `exec`s vitest — so the pid in `pidFile` IS the vitest root process (exec keeps the pid).
 * @param {string} traceDir
 * @param {string} pidFile
 * @returns {string[]}
 */
export function tracedCommand(traceDir, pidFile) {
  return [
    ...traceArgv(traceDir),
    'sh', '-c', ROOT_PID_SH, pidFile,
    './node_modules/.bin/vitest', 'run', '--config', 'vitest.select.config.ts', '--maxWorkers=1',
  ];
}

/**
 * The traced child's environment. `UV_USE_IO_URING=0` keeps libuv on its threadpool: with io_uring, Node's
 * asynchronous fs can be submitted through the ring, and none of it would appear as a syscall strace can see.
 * `CCRC_TRACING=1` tells a test it is being traced — this module's own suite skips its nested-strace cases then,
 * since strace cannot attach under an outer strace; a file that reads it belongs on `SKIPS_UNDER_TRACE`.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} listFile
 * @returns {NodeJS.ProcessEnv}
 */
export function tracedEnv(env, listFile) {
  return { ...env, CCRC_TEST_LIST: listFile, CI: 'true', UV_USE_IO_URING: '0', CCRC_TRACING: '1' };
}

/** Runs `argv[0]` with the rest as args, under a `timeout --kill-after` wrapper, WITHOUT inheriting stdio.
 *
 *  `stdio: 'ignore'` (rather than piping and draining) and listening for `'exit'` rather than `'close'` guard
 *  against the same class of hang, belt and braces: a test that leaks a DETACHED grandchild (`spawn(...,
 *  {detached: true})`, e.g. a stray `sleep 300`) that inherited a copy of this process's own stdout/stderr pipe
 *  would keep that pipe's write end open long after `timeout` has correctly killed the traced `vitest` process --
 *  and Node's `'close'` event waits for every stream fd to close, not just for the process to exit, so
 *  `trace-run.mjs` could hang on a job `timeout` had already ended. `'exit'` fires the moment the traced process
 *  itself terminates, independent of any fd a descendant still holds open; `stdio: 'ignore'` removes the pipe a
 *  descendant could hold open in the first place, for the direct child at least.
 *
 *  Measured (this module's own suite): a unit case spawns a shell that backgrounds a `sleep` holding the
 *  shell's stdio and exits; `runTraced` must resolve on that exit. Mutating BOTH halves (`'pipe'` and
 *  `'close'`) hangs it until the case's own timeout; either half alone still passes, because either one
 *  suffices. Through `traceAll`, the leak fixture (a detached `sleep 300` with `stdio: 'inherit'`) returns
 *  inside its bound either way on this repo's `forks` pool, which gives the grandchild its worker's own stdio
 *  pipe rather than this function's. */
export function runTraced(argv, opts) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { ...opts, stdio: 'ignore' });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on('error', (err) => finish({ code: null, signal: null, error: String(err) }));
    child.on('exit', (code, signal) => finish({ code, signal, error: null }));
  });
}

/**
 * Reads one finished traced run: `workDir` holds `trace/` (strace's per-thread files) and `root.pid`. A failed
 * spawn, a timeout, a non-zero exit, a missing root pid (or no trace file for it — the split could not be
 * trusted), or an unresolved relative path each make the record `unknown`, with the reason.
 * @param {string} workDir
 * @param {string} repoRoot
 * @param {{ code: number|null, signal: string|null, error: string|null }} exit
 * @param {number} timeoutSec
 * @returns {SplitRecord}
 */
export function recordOf(workDir, repoRoot, exit, timeoutSec) {
  const traceDir = path.join(workDir, 'trace');
  let why;
  if (exit.error) why = `spawn error: ${exit.error}`;
  else if (exit.code === 124 || exit.signal) why = `timeout after ${timeoutSec}s`;
  else if (exit.code !== 0) why = `vitest exited ${exit.code}`;

  let rootPid = '';
  try {
    rootPid = readFileSync(path.join(workDir, 'root.pid'), 'utf8').trim();
  } catch {
    rootPid = '';
  }
  const rootTraced = /^[1-9]\d*$/.test(rootPid) && existsSync(path.join(traceDir, `t.${rootPid}`));
  if (!why && !rootTraced) why = `no trace of the vitest root process (root.pid: ${JSON.stringify(rootPid)})`;

  const { root, rest, unresolved } = parseTraceDirSplit(traceDir, repoRoot, rootTraced ? rootPid : 0);
  if (!why && unresolved > 0) why = `${unresolved} unresolved relative path(s)`;

  return why ? { root, rest, unknown: true, why } : { root, rest, unknown: false };
}

/**
 * Traces one server-relative test file (or the baseline) and returns its split record.
 * @param {string} repoRoot
 * @param {string} serverRelPath
 * @param {number} timeoutSec
 * @returns {Promise<SplitRecord>}
 */
async function traceOne(repoRoot, serverRelPath, timeoutSec, killAfterSec) {
  const workDir = mkdtempSync(path.join(tmpdir(), 'ccrc-trace-'));
  const traceDir = path.join(workDir, 'trace');
  mkdirSync(traceDir);
  const listFile = path.join(workDir, 'list.txt');
  writeFileSync(listFile, serverRelPath + '\n', 'utf8');

  const argv = [
    'timeout', `--kill-after=${killAfterSec}`, String(timeoutSec),
    ...tracedCommand(traceDir, path.join(workDir, 'root.pid')),
  ];
  const exit = await runTraced(argv, {
    cwd: path.join(repoRoot, 'server'),
    env: tracedEnv(process.env, listFile),
  });

  const record = recordOf(workDir, repoRoot, exit, timeoutSec);
  rmSync(workDir, { recursive: true, force: true });
  return record;
}

/** Runs `worker` over `items` with at most `concurrency` in flight at once.
 *  @template T @param {T[]} items @param {number} concurrency @param {(item: T) => Promise<void>} worker */
export async function runPool(items, concurrency, worker) {
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
    }
  }
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, lane);
  await Promise.all(lanes);
}

/**
 * Traces the baseline plus every file in `serverRelPaths`, `jobs` at a time, and returns the raw `Records`
 * (format 2: repo-relative test keys, each record split root/rest, NOT baseline-subtracted -- `testmap.mjs`
 * does that).
 * @param {string} repoRoot
 * @param {string[]} serverRelPaths server-relative paths, e.g. `test/bus.test.ts`
 * `baselineTimeoutSec` (default `timeoutSec`) bounds the baseline alone; `killAfterSec` (default 30) is the
 * `timeout --kill-after` grace; `skipsUnderTrace` (default `SKIPS_UNDER_TRACE`) names the files written unknown.
 * @param {{ jobs?: number, timeoutSec?: number, baselineTimeoutSec?: number, killAfterSec?: number, skipsUnderTrace?: string[] }} [options]
 * @returns {Promise<Records>}
 */
export async function traceAll(repoRoot, serverRelPaths, options = {}) {
  const root = realpathSync(repoRoot);
  const jobs = options.jobs ?? DEFAULT_JOBS;
  const skipsUnderTrace = options.skipsUnderTrace ?? SKIPS_UNDER_TRACE;
  const timeoutSec = options.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
  const baselineTimeoutSec = options.baselineTimeoutSec ?? timeoutSec;
  const killAfterSec = options.killAfterSec ?? KILL_AFTER_SEC;

  const baselineResult = await traceOne(root, BASELINE_SERVER_REL, baselineTimeoutSec, killAfterSec);
  if (baselineResult.unknown) {
    throw new Error(`trace-run: baseline trace failed: ${baselineResult.why}`);
  }
  const baseline = { root: baselineResult.root, rest: baselineResult.rest };

  /** @type {Record<string, SplitRecord>} */
  const tests = {};
  await runPool(serverRelPaths, jobs, async (serverRelPath) => {
    const repoRelKey = path.posix.join('server', serverRelPath);
    tests[repoRelKey] = markSkipsUnderTrace(repoRelKey, await traceOne(root, serverRelPath, timeoutSec, killAfterSec), skipsUnderTrace);
  });

  return { format: 2, baseline, tests };
}

function parseCliArgs(argv) {
  const opts = { jobs: DEFAULT_JOBS, timeout: DEFAULT_TIMEOUT_SEC, killAfter: KILL_AFTER_SEC };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') opts.repo = argv[++i];
    else if (a === '--files') opts.files = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--jobs') opts.jobs = Number(argv[++i]);
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--kill-after') opts.killAfter = Number(argv[++i]);
    else throw new Error(`trace-run.mjs: unrecognized argument ${a}`);
  }
  for (const req of ['repo', 'files', 'out']) {
    if (!opts[req]) throw new Error(`trace-run.mjs: --${req} is required`);
  }
  return opts;
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const serverRelPaths = readFileSync(opts.files, 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const records = await traceAll(opts.repo, serverRelPaths, { jobs: opts.jobs, timeoutSec: opts.timeout, killAfterSec: opts.killAfter });
  writeFileSync(opts.out, JSON.stringify(records));
  // Named for the log only; map-build decides whether a failure is news (see the header).
  for (const [file, r] of Object.entries(records.tests)) {
    if (r.unknown) process.stdout.write(`trace-run: ${file}: ${r.why}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stderr.write(`trace-run.mjs: ${err instanceof Error ? err.stack : err}\n`);
    process.exit(1);
  });
}
