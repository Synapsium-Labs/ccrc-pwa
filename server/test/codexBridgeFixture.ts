// codexBridgeFixture.ts — the codex bridge's test fixtures (codex-bridge Stage 2, Task 1; spec 2026-10-15 §2, §5).
//
// What is here, and the one rule they share with Stage 1's `codexAuthFixture.ts`: NO TEST CAN REACH A LIVE ENDPOINT.
// Every bridge process a test starts gets CCGPT_BRIDGE_UPSTREAM_BASE (the only upstream override the backend adapter
// accepts, loopback http:// only) and CCRC_CODEX_AUTH_BASE (Stage 1's), each set to CLOSED_AUTH_BASE unless the
// caller's env names a non-empty one, and its env is built from scratch, so neither an operator's override nor any
// other variable of the vitest process reaches the package.
//
// `runBridgeDriver` runs `server/test/fixtures/codexbridge/driver.py`, which loads the package from this tree's
// `ccd/` directory (first on `sys.path`, as the shim's direct entry does) and runs a list of ops in ONE process.
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pythonOrSkip } from './ccgptHarness.js';
import { CLOSED_AUTH_BASE } from './codexAuthFixture.js';

export { driverLines } from './codexAuthFixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** This tree's `ccd` directory: the driver's `pkg`, the directory put first on `sys.path`. */
export const CCD_DIR = path.join(REPO, 'ccd');
/** The package under test, in this tree. */
export const BRIDGE_DIR = path.join(CCD_DIR, 'codexbridge');
/** The driver that runs a sequence of package operations in one process. */
export const BRIDGE_DRIVER = path.join(here, 'fixtures', 'codexbridge', 'driver.py');

const TMP_ROOT = (() => {
  try { return realpathSync(tmpdir()); } catch { return tmpdir(); }
})();

/** Spawn `python3 -I driver.py <action>` ASYNCHRONOUSLY (a synchronous child deadlocks against a fake server on this
 *  event loop), in the fixture `home`, which is its cwd and its HOME. `action.pkg` defaults to this tree's `ccd`
 *  directory. The env is built from scratch: PATH and TMPDIR, then the caller's `env`, then the two endpoint
 *  variables (each CLOSED_AUTH_BASE unless `env` names a non-empty value: an empty one would read as unset, which is
 *  a live endpoint), then HOME. No PYTHON* variable is set: `-I` implies `-E`, so the driver's own
 *  `sys.dont_write_bytecode = True` is what keeps a `__pycache__` out of the tree. Past `timeoutMs` (default 10000)
 *  the child is killed with SIGKILL and `timedOut` is true; `status` is then null. */
export function runBridgeDriver(
  home: string,
  action: object,
  env: Record<string, string> = {},
  o: { timeoutMs?: number } = {},
): Promise<{ status: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const resolved = path.resolve(home);
  if (!resolved.startsWith(TMP_ROOT + path.sep)) {
    throw new Error(`runBridgeDriver: home must be a fixture directory under ${TMP_ROOT} (use mkTmp) — got ${JSON.stringify(home)}`);
  }
  if ('HOME' in env) throw new Error('runBridgeDriver: env must not set HOME (the fixture owns it)');
  const py = pythonOrSkip();
  if (!py) throw new Error('runBridgeDriver called with no python3 — guard with pythonOrSkip() first');
  const named = (k: string): string => {
    const v = env[k];
    return typeof v === 'string' && v !== '' ? v : CLOSED_AUTH_BASE;
  };
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    TMPDIR: tmpdir(),
    ...env,
    CCGPT_BRIDGE_UPSTREAM_BASE: named('CCGPT_BRIDGE_UPSTREAM_BASE'),
    CCRC_CODEX_AUTH_BASE: named('CCRC_CODEX_AUTH_BASE'),
    HOME: resolved,
  };
  const full = { pkg: CCD_DIR, ...action };
  return new Promise((resolve, reject) => {
    const child = spawn(py, ['-I', BRIDGE_DRIVER, JSON.stringify(full)], {
      cwd: resolved, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 10_000);
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.once('error', (err) => { clearTimeout(timer); reject(err); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ status: code, stdout, stderr, timedOut }); });
  });
}
