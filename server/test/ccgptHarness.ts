import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
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
 *  line is still a complete subject.
 *  Throws when the file does not exist, naming the path it looked for — a
 *  missing shipped file otherwise surfaces as a confusing spawn/ENOENT error
 *  inside whichever case happens to run first (M3). */
export function ccgptFile(name: string): string {
  const p = path.join(REPO, 'ccd', name);
  if (!existsSync(p)) throw new Error(`ccgptFile: no such shipped file: ${p}`);
  return p;
}

// Memoised (M2): unmemoised, every runPy() call re-spawned python3 just to
// resolve it, on top of the spawn that actually runs the subject — two
// processes per case across the ~100 cases the later tasks add. Resolved
// once, kept private; no invalidation API, because the interpreter a box has
// does not change mid-suite.
let cachedPython: string | null | undefined;

/** An absolute python3, or null when the box has none. Memoised after the
 *  first call. A missing interpreter is an environment fact, not a failure of
 *  the subject under test — but see ccgpt-harness.test.ts for why that no
 *  longer means "each case returns early and the suite reports green": a
 *  caller of this function is expected to gate a `describe.skipIf` once, not
 *  swallow the absence per-case. */
export function pythonOrSkip(): string | null {
  if (cachedPython !== undefined) return cachedPython;
  const r = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  if (r.status !== 0) return (cachedPython = null);
  const exe = (r.stdout || '').trim();
  return (cachedPython = exe && existsSync(exe) ? exe : null);
}

// Shared by `runPy` and `spawnPy` (ccgpt-proxy review round 1, C-1/I-1/I-2):
// those three findings were one defect, not three — a second, hand-rolled
// python-spawn site in ccgpt-proxy.test.ts reproduced this containment BY
// HAND and got it wrong (`...env` spread LAST, no `cwd`, no
// `PYTHONDONTWRITEBYTECODE`), and then diverged a SECOND time within that
// same task. The fix is not to patch call sites; it is to give the contract
// one body that every python-spawning helper in this file calls, so a caller
// of either can no longer drift from the other.
//
// A caller-supplied `HOME` is refused rather than silently dropped (C1): a
// caller writing `env: { HOME: someOtherPath }` has misunderstood the seam
// and should be told, not quietly corrected. This does NOT fire for the
// realistic call `env: { ...process.env, PYTHONPATH: PYSTUB_DIR }` — there
// `opts.env.HOME` is a byproduct of carrying the ambient env forward, not a
// deliberate override, and its value is identical to the ambient
// `process.env.HOME` the child would inherit unchanged if the caller had done
// nothing; only a HOME that actually differs from that is a deliberate
// attempt to steer the child's home, and that is what throws. `caller` names
// the throwing function in the message so a failure in either `runPy` or
// `spawnPy` is unambiguous about its own origin.
function containedEnv(
  home: string,
  callerEnv: Record<string, string> | undefined,
  caller: string,
): Record<string, string> {
  if (callerEnv && 'HOME' in callerEnv && callerEnv.HOME !== process.env.HOME) {
    throw new Error(`${caller}: opts.env must not set HOME (the harness owns it) — got ${JSON.stringify(callerEnv.HOME)}`);
  }
  return {
    // PATH is deliberately inherited, and this is the one exception to
    // containment (M4): the interpreter itself, and anything the subject
    // shells out to (git, gh, curl), are found through it, and a fixed
    // minimal value would break a box whose python3 sits somewhere
    // nonstandard. Everything else the child sees is either the caller's own
    // `env` or the two keys applied after it below.
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    ...(callerEnv ?? {}),
    // Applied LAST, deliberately (C1): these are the containment, not a
    // default the spread above may override. A caller writing the natural
    // `env: { ...process.env, PYTHONPATH: PYSTUB_DIR }` still gets the
    // fixture HOME and never touches the real `~/.cc-limits`, `~/.ccrc/coord.db`
    // or `~/.ccrc/models/<lane>.effort.json` — the last of which a later
    // gpt-lane task reads for real on this box.
    HOME: home,
    // Suppresses .pyc creation (C2's primary fix — the .gitignore entry is
    // the belt, for a python run that bypasses this function entirely, e.g.
    // a worker debugging by hand). Verified: the stub still imports with
    // this set.
    PYTHONDONTWRITEBYTECODE: '1',
  };
}

export function runPy(
  file: string,
  opts: { home: string; args?: string[]; env?: Record<string, string>; stdin?: string; timeoutMs?: number },
): { status: number | null; signal: NodeJS.Signals | null; timedOut: boolean; stdout: string; stderr: string } {
  const py = pythonOrSkip();
  if (!py) throw new Error('runPy called with no python3 — guard with pythonOrSkip() first');
  const env = containedEnv(opts.home, opts.env, 'runPy');
  const r = spawnSync(py, [file, ...(opts.args ?? [])], {
    encoding: 'utf8',
    input: opts.stdin,
    timeout: opts.timeoutMs ?? 20_000,
    // The fixture HOME is the child's cwd too (I3): unset, a subject writing
    // any relative path lands in `server/` — the tracked working tree, not a
    // fixture — which is exactly how this file's own first run left four
    // untracked artefacts in the repo (see PYTHONDONTWRITEBYTECODE above).
    cwd: opts.home,
    env,
  });
  const err = r.error as NodeJS.ErrnoException | undefined;
  if (err && err.code !== 'ETIMEDOUT') {
    // ENOENT/EACCES/etc: the child never ran at all. Throwing here — rather
    // than folding it into the return value — means "python said nothing" can
    // no longer misread as a real, empty, successful run.
    throw new Error(`runPy: spawn failed for ${file}: ${err.code ?? err.message}`);
  }
  // Three conditions that used to collapse into the same `status: null` (I2):
  // a run the harness itself killed on timeout (`timedOut`), a run killed by
  // some other signal (`signal`), and an ordinary exit (`status` a number,
  // `signal: null`, `timedOut: false`). A caller can now tell "the publisher
  // exited 0" from "the publisher never got the chance to."
  return {
    status: r.status,
    signal: r.signal ?? null,
    timedOut: err?.code === 'ETIMEDOUT',
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

/** Long-lived sibling of `runPy`, for a subject that must keep RUNNING — a
 *  server, not a one-shot script; `ccd/ccgpt-proxy.py` is exactly this shape.
 *  Applies the identical HOME/cwd/PYTHONDONTWRITEBYTECODE containment via the
 *  shared `containedEnv` helper above, so the contract has one body instead
 *  of a second, independently-maintained copy (ccgpt-proxy review round 1,
 *  C-1/I-1/I-2).
 *
 *  Returns the live child. Unlike `runPy`, this function does not wait for
 *  exit or collect output — the caller owns killing the child and awaiting
 *  its `'close'`, and reads `child.stdout`/`child.stderr` itself for
 *  whatever it needs. Swallowing the handle here would make every later
 *  caller re-spawn just to get it back (see ccgpt-proxy review round 1, M-2). */
export function spawnPy(
  file: string,
  opts: { home: string; args?: string[]; env?: Record<string, string> },
): { child: ChildProcess } {
  const py = pythonOrSkip();
  if (!py) throw new Error('spawnPy called with no python3 — guard with pythonOrSkip() first');
  const env = containedEnv(opts.home, opts.env, 'spawnPy');
  const child = spawn(py, [file, ...(opts.args ?? [])], {
    cwd: opts.home,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { child };
}
