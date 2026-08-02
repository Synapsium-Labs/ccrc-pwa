/** The run-scoped home for every PATH-containment directory, and the only
 *  cleanup in this package that the test POOL cannot skip.
 *
 *  WHY THIS FILE EXISTS (final review, tests finding 1).
 *  `contain-path.setup.ts` makes its stub directory at MODULE SCOPE of a
 *  `setupFiles` entry, which runs BEFORE the test module is imported. When the
 *  test module THROWS AT IMPORT, the directory exists and no vitest hook ever
 *  fires — one leaked /tmp directory per failed-to-import file. That is not an
 *  exotic case here: `auditExecWhitelist()` runs at module load and
 *  `refuseToBoot` THROWS by design, so every over-permission mutation turns
 *  most of this suite into import failures. The harness leaked worst on exactly
 *  the failure it exists to cause, and mutation sweeps are this project's whole
 *  method — 50-120 runs each. The reviewer measured 10 leaked directories from
 *  one mutant, twice, and 98 residues on a box that hit 95% disk that day.
 *
 *  WHY NOT `process.on('exit')` IN THE SETUP FILE. That was the first fix and it
 *  is NOT sufficient — MEASURED, not reasoned: with an exit handler in place,
 *  the module-load-throw pin still failed 2 runs in 12. Vitest's default pool is
 *  `forks`, and tinypool DESTROYS a worker process when the run ends; a
 *  destroyed process runs no `exit` handlers. A mechanism that works 80% of the
 *  time on a leak this project has paid for twice is not a fix.
 *
 *  WHAT THIS DOES INSTEAD. `globalSetup` runs in vitest's MAIN process, before
 *  any worker is forked, and its returned teardown runs in that same main
 *  process after the run — whether the run passed, failed, or never imported a
 *  test module. So: make ONE run-scoped root here, hand it to the workers
 *  through the environment they inherit at fork, and remove the root at the
 *  end. Whatever the workers leak inside it goes with it.
 *
 *  WHY A RUN-SCOPED ROOT AND NOT A SWEEP OF `/tmp/ccrc-agent-containpath-*`.
 *  A sweep would also mop up the historical residue, and it is refused anyway.
 *  Deleting a directory that a CONCURRENT agent test process is still using
 *  takes the stub `tmux` off that process's PATH, which makes `exec.test.ts`'s
 *  `tmux kill-server` resolve to the REAL binary — the exact mechanism that has
 *  killed the live fleet four times. Sibling lanes run this suite at the same
 *  time on this box. A root that this run created and only this run can name
 *  has no such reach. Stale directories cost disk; a wrong sweep costs eleven
 *  sessions.
 *
 *  FAILS SAFE. If this file is ever unwired, `contain-path.setup.ts` falls back
 *  to `os.tmpdir()` and the containment itself is unaffected — the stub `tmux`
 *  and `gh` are still made and still put earliest on PATH. Only the cleanup
 *  degrades, and `contain-path.test.ts` fails when it does.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Read by `contain-path.setup.ts` in every worker. Workers are forked AFTER
 *  this function returns, so they inherit it; nothing else passes state from
 *  the main process to a `setupFiles` module body, which runs too early for
 *  vitest's `provide`/`inject` channel. */
export const CONTAIN_PATH_ROOT_ENV = 'CCRC_TEST_CONTAINED_PATH_ROOT';

export default function setup(): () => void {
  const root = mkdtempSync(path.join(tmpdir(), 'ccrc-agent-containpath-run-'));
  process.env[CONTAIN_PATH_ROOT_ENV] = root;
  return () => {
    delete process.env[CONTAIN_PATH_ROOT_ENV];
    // Only ever this run's own root, by a name no other process was told.
    rmSync(root, { recursive: true, force: true });
  };
}
