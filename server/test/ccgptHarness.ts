import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** The stub package root. On PYTHONPATH it satisfies the publisher's hard
 *  `from litellm.llms.chatgpt.authenticator import Authenticator` on a box
 *  whose ambient python3 has no litellm — which is every box in CI. */
export const PYSTUB_DIR = path.join(here, 'fixtures', 'pystub');

/** The shipped file under ccd/, resolved from THIS file's path — the same way
 *  usage-sweep.test.ts resolves ccd-usage-sweep.py. A file with no install
 *  line is still a complete subject. */
export function ccgptFile(name: string): string {
  return path.join(REPO, 'ccd', name);
}

/** An absolute python3, or null when the box has none. Callers return early on
 *  null rather than failing: a missing interpreter is an environment fact, and
 *  a false red is worse than an unpinned claim. */
export function pythonOrSkip(): string | null {
  const r = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const exe = (r.stdout || '').trim();
  return exe && existsSync(exe) ? exe : null;
}

export function runPy(
  file: string,
  opts: { home: string; args?: string[]; env?: Record<string, string>; stdin?: string; timeoutMs?: number },
): { status: number | null; stdout: string; stderr: string } {
  const py = pythonOrSkip();
  if (!py) throw new Error('runPy called with no python3 — guard with pythonOrSkip() first');
  const r = spawnSync(py, [file, ...(opts.args ?? [])], {
    encoding: 'utf8',
    input: opts.stdin,
    timeout: opts.timeoutMs ?? 20_000,
    // A CLOSED env: the fixture HOME and nothing inherited. The publisher reads
    // its output directory from HOME, so an inherited HOME would write into the
    // operator's real ~/.cc-limits.
    env: { HOME: opts.home, PATH: process.env.PATH ?? '/usr/bin:/bin', ...(opts.env ?? {}) },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
