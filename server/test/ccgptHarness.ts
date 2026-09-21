import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

// Fix round 2, finding 3: `opts.home` had zero validation — every containment
// guarantee `runPy`/`spawnPy` make is expressed RELATIVE to this value, so a
// call site that miscomputes it (anything other than `mkTmp()`) silently
// points HOME, cwd and every relative write at a real directory, with no
// error at all. `mkTmp()` (`tmpHelpers.ts`) always returns an absolute,
// `realpathSync`-resolved path under the OS temp root — resolved for the same
// reason `mkTmp` itself resolves it (a symlinked temp root, e.g. macOS's
// `/var` -> `/private/var`, would make an unresolved comparison fail on a
// platform this suite has never been wrong on before) — so requiring that
// shape costs no legitimate caller anything.
const TMP_ROOT = (() => {
  try { return realpathSync(tmpdir()); } catch { return tmpdir(); }
})();

function assertFixtureHome(home: string, caller: string): void {
  const resolved = path.resolve(home);
  if (resolved !== TMP_ROOT && !resolved.startsWith(TMP_ROOT + path.sep)) {
    throw new Error(
      `${caller}: opts.home must be a fixture directory under the OS temp root ` +
      `(${TMP_ROOT}) — got ${JSON.stringify(home)}. Use mkTmp() from tmpHelpers.ts.`,
    );
  }
}

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

// Shared by `runPy` and `spawnPy` (ccgpt-proxy review round 1, commit fe7da071 C-1/I-1/I-2;
// round 2, finding 4): those three findings were one defect, not three — a
// second, hand-rolled python-spawn site in ccgpt-proxy.test.ts reproduced
// this containment BY HAND and got it wrong (`...env` spread LAST, no `cwd`,
// no `PYTHONDONTWRITEBYTECODE`), and then diverged a SECOND time within that
// same task. The fix is not to patch call sites; it is to give the contract
// one body that every python-spawning helper in this file calls, so a caller
// of either can no longer drift from the other.
//
// Round 2's re-review found `cwd` had converged in BEHAVIOUR between `runPy`
// and `spawnPy` (both correctly passed `cwd: opts.home` to their own spawn
// call) but not in STRUCTURE — it was still a separate literal at each call
// site, which is exactly how the round 1 defect started. So this now returns
// the WHOLE spawn-options pair, `{cwd, env}`, not env alone: there is one
// place, not two, that decides where and with what environment a python
// child runs.
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
function containedSpawnOptions(
  home: string,
  callerEnv: Record<string, string> | undefined,
  caller: string,
): { cwd: string; env: Record<string, string> } {
  // Round 2, finding 3: validated FIRST, before the HOME-differs check below
  // — a wrong `opts.home` is a defect in the call site itself, independent
  // of whatever `opts.env` happens to contain.
  assertFixtureHome(home, caller);
  if (callerEnv && 'HOME' in callerEnv && callerEnv.HOME !== process.env.HOME) {
    throw new Error(`${caller}: opts.env must not set HOME (the harness owns it) — got ${JSON.stringify(callerEnv.HOME)}`);
  }
  return {
    // The fixture HOME is the child's cwd too (I3, round 1): unset, a
    // subject writing any relative path lands in `server/` — the tracked
    // working tree, not a fixture — which is exactly how this file's own
    // first run left four untracked artefacts in the repo.
    cwd: home,
    env: {
      // PATH is deliberately inherited, and this is the one exception to
      // containment (M4): the interpreter itself, and anything the subject
      // shells out to (git, gh, curl), are found through it, and a fixed
      // minimal value would break a box whose python3 sits somewhere
      // nonstandard. Everything else the child sees is either the caller's
      // own `env` or the two keys applied after it below.
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
    },
  };
}

/** The discriminated result of running a python file to completion — shared
 *  by `runPy` and `runPyAsync` (task-10-fix-rulings.md's D-3157 hoist).
 *  Extracted here because there was nothing to "share" before: `runPy` used
 *  to write this same object literal inline in its own signature, and the
 *  Task 10 review caught that its report claimed a type existed to share
 *  when none did. `timedOut` has a DIFFERENT derivation in the two
 *  functions — `runPy`'s comes from `spawnSync`'s own `err.code ===
 *  'ETIMEDOUT'`; `runPyAsync`'s comes from that function's OWN `setTimeout`
 *  + `SIGKILL`, since `spawnPy` enforces no deadline of its own — so the
 *  shape `{status: null, signal: 'SIGKILL', timedOut: true}` can only ever
 *  come from `runPyAsync`, never from `runPy`. Same TYPE, different
 *  inhabitants; callers should not assume the two are interchangeable
 *  evidence of "how" a subject was killed, only "whether". */
export type PyOutcome = {
  status: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

/** Runs a python file to completion and reports how it ended.
 *
 *  CANNOT serve a subject that must talk to a mock server living in THIS
 *  SAME test process (task-10-fix-rulings.md, D-3157): `runPy` drives its
 *  child through `spawnSync`, which blocks the WHOLE Node event loop until
 *  the child exits — a `node:http` server in this process can never accept
 *  or answer a connection while `spawnSync` is blocking on it, so the two
 *  deadlock until this function's own `timeoutMs` kills the child. Measured
 *  directly: `ccgpt-usage.py`'s own suite, written to this exact shape
 *  first, timed out on every case whose mock server had to answer
 *  mid-flight. Use `runPyAsync` below for those cases instead; `runPy`
 *  stays correct and simpler for the many cases that need no server at
 *  all, or whose subject refuses before ever reaching one. */
export function runPy(
  file: string,
  opts: { home: string; args?: string[]; env?: Record<string, string>; stdin?: string; timeoutMs?: number },
): PyOutcome {
  const py = pythonOrSkip();
  if (!py) throw new Error('runPy called with no python3 — guard with pythonOrSkip() first');
  const { cwd, env } = containedSpawnOptions(opts.home, opts.env, 'runPy');
  const r = spawnSync(py, [file, ...(opts.args ?? [])], {
    encoding: 'utf8',
    input: opts.stdin,
    timeout: opts.timeoutMs ?? 20_000,
    cwd,
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
 *  shared `containedSpawnOptions` helper above, so the contract has one body
 *  instead of a second, independently-maintained copy (ccgpt-proxy review
 *  round 1, commit fe7da071 C-1/I-1/I-2; round 2, finding 4).
 *
 *  Returns the live child. Unlike `runPy`, this function does not wait for
 *  exit or collect output — the caller owns killing the child and awaiting
 *  its `'close'`, and reads `child.stdout`/`child.stderr` itself for
 *  whatever it needs. Swallowing the handle here would make every later
 *  caller re-spawn just to get it back (see ccgpt-proxy review round 1, commit b56286a4 M-2). */
export function spawnPy(
  file: string,
  opts: { home: string; args?: string[]; env?: Record<string, string> },
): { child: ChildProcess } {
  const py = pythonOrSkip();
  if (!py) throw new Error('spawnPy called with no python3 — guard with pythonOrSkip() first');
  const { cwd, env } = containedSpawnOptions(opts.home, opts.env, 'spawnPy');
  const child = spawn(py, [file, ...(opts.args ?? [])], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { child };
}

/** The async sibling `runPy` cannot be, for a one-shot subject that must
 *  talk to a mock server living in the SAME test process — see `runPy`'s
 *  own docstring for the deadlock this exists to avoid (task-10-fix-rulings.md
 *  D-3157). Drives the child through `spawnPy`'s async spawn (so the event
 *  loop stays free to answer the mock) and resolves once it exits, with the
 *  same `PyOutcome` shape `runPy` returns — a caller can treat the two as
 *  interchangeable RESULTS even though they are not interchangeable
 *  MECHANISMS (see `PyOutcome`'s own docstring on `timedOut`'s two
 *  derivations).
 *
 *  Same opts shape as `runPy` MINUS `stdin` — deliberately, not an
 *  oversight: `spawnPy`'s child stdio is `['ignore', 'pipe', 'pipe']`, and
 *  wiring a real stdin pipe through is a separate, testable change nothing
 *  in this wave's callers need (no subject driven through `runPyAsync`
 *  reads stdin). Add it, with its own containment case in
 *  `ccgpt-harness.test.ts`, when a caller actually needs it — folding it in
 *  silently here would be exactly the kind of untested surface this file's
 *  own containment discipline exists to prevent.
 *
 *  Enforces its OWN timeout via `setTimeout` + `SIGKILL`, unlike `spawnPy`
 *  itself (which sets no deadline): a one-shot script that never exits is a
 *  case that should fail loudly with a `timedOut` result, not hang the
 *  whole suite. */
export function runPyAsync(
  file: string,
  opts: { home: string; args?: string[]; env?: Record<string, string>; timeoutMs?: number },
): Promise<PyOutcome> {
  return new Promise((resolve, reject) => {
    const { child } = spawnPy(file, { home: opts.home, args: opts.args, env: opts.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs ?? 20_000);
    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { stderr += c.toString(); });
    child.once('error', (err) => { clearTimeout(timer); reject(err); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal: signal ?? null, timedOut, stdout, stderr });
    });
  });
}
