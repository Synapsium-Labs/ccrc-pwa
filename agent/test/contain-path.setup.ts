/** Structural PATH containment for the whole agent test process.
 *
 *  The agent's job is to execute real binaries, and its fixtures isolate HOME —
 *  not PATH. So every negative exec test was one whitelist bug away from
 *  invoking the real thing, and `exec.test.ts` sends the sharpest argv there is:
 *  `tmux kill-server`, asserting the answer is `forbidden`.
 *
 *  MEASURED, three times in one morning: under a widening mutation of
 *  `EXEC_WHITELIST` (`tmux: [[]]`, an empty prefix matching every argv) the
 *  whitelist allowed it, the agent ran it, and the box's tmux server died —
 *  all eleven ccrc sessions with it, including the one driving the sweep.
 *  Exit 137; the fleet respawned at 10:29:57.
 *
 *  A negative test that stays harmless only while the code under test is
 *  correct is not a test — it is a loaded gun pointed at the fleet. This file
 *  puts a harmless `tmux` earliest on PATH for every agent test, so the
 *  containment does not depend on any individual test remembering to ask for
 *  it, and cannot be lost by adding a new test file.
 *
 *  Pinned by `contain-path.test.ts`, which fails if this file stops being
 *  wired in `vitest.config.ts`.
 */
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import { CONTAIN_PATH_ROOT_ENV } from './contain-path.globalsetup.js';

/** WHERE the stub directory goes, and why it is not just `os.tmpdir()`.
 *
 *  This module body runs as a `setupFiles` entry — BEFORE the test module is
 *  imported. So when a test module THROWS AT IMPORT, this directory already
 *  exists and the `afterAll` below never fires: one leaked /tmp directory per
 *  failed-to-import file. `whitelist.ts` throws at module load BY DESIGN
 *  (`auditExecWhitelist` -> `refuseToBoot`), so every over-permission mutation
 *  produces exactly that shape, and mutation sweeps are how this project works.
 *  Measured by the final review: 10 leaks from one mutant, twice; 98 residues
 *  on a box that hit 95% disk the same day.
 *
 *  `contain-path.globalsetup.ts` makes ONE root per run in vitest's main
 *  process and removes it there after the run, so anything left inside goes
 *  with it. Nothing a worker can do — including being destroyed by the pool —
 *  can skip that. `process.on('exit')` here was tried FIRST and MEASURED
 *  INSUFFICIENT: the default pool is `forks` and tinypool destroys worker
 *  processes, so the module-load-throw pin still failed 2 runs in 12.
 *
 *  The fallback to `os.tmpdir()` is deliberate and must stay. If the global
 *  setup is ever unwired, containment itself is UNAFFECTED — the stubs are
 *  still made and still put earliest on PATH — and only the cleanup degrades to
 *  what it was. A containment file that refused to run without its janitor
 *  would be a fleet outage waiting for a config edit. */
const root = process.env[CONTAIN_PATH_ROOT_ENV];
if (root) mkdirSync(root, { recursive: true });
const dir = mkdtempSync(path.join(root ?? tmpdir(), 'ccrc-agent-containpath-'));

/** Every real binary the whitelist is able to NAME gets a refusing stub here.
 *  The test for whether one belongs is not "does a test call it today" — it is
 *  "could a wrong whitelist make a test call it tomorrow", because that is the
 *  only case in which the containment matters at all.
 *
 *  `tmux` earned its place by killing the fleet four times. `gh` is here for the
 *  same reason found one review later, and it is the worse of the two: the
 *  mutant `M01_ADD_GH` adds a `gh: [['pr']]` grant, `exec.test.ts` sends
 *  `gh pr create --repo o/r …` expecting `forbidden`, and under that mutant the
 *  prefix matches — so the agent executed the REAL `gh`, holding the host's
 *  `repo`-WRITE-scoped token, against GitHub. It failed only because `o/r` does
 *  not exist. The mutant was killed for the right reason and by the wrong
 *  mechanism: a live authenticated write attempt. `ccd` needs no entry — it
 *  resolves to `$HOME/.local/bin/ccd` inside the fixture home, which is already
 *  isolated.
 *
 *  `systemctl` joined them in final review round 2. It is in `FORBIDDEN_COMMANDS`
 *  (`src/whitelist.ts`), so the whitelist NAMES it and a mutation that moves a
 *  name from that list to `EXEC_COMMANDS` is precisely the mutation class this
 *  project sweeps for. And it is in the same blast-radius class as `tmux`, not a
 *  lesser one: `systemctl --user stop ccrc.service` takes down the live server
 *  the fleet is driven from, and `--user stop ccrc-agent.service` takes down the
 *  agent running the sweep. `deploy-verify.test.ts` now also drives a script
 *  that calls `systemctl` for real, with its own stub earliest on PATH — this
 *  entry is the net under that stub, which is the whole reason the containment
 *  is structural and not per-test.
 *
 *  The bar for this list, stated so the next addition is argued rather than
 *  guessed: a real binary that MUTATES state outside the fixture, or spends a
 *  host credential. `journalctl` is deliberately NOT here — it is read-only and
 *  does neither. `bash`, `node` and `git` are not here either, and cannot be:
 *  stubbing them would break the runner and the fixtures themselves, so they
 *  stay contained by `HOME` isolation, which is what that boundary is for. */
for (const name of ['tmux', 'gh', 'systemctl'] as const) {
  const bin = path.join(dir, name);
  // Refuses everything, says so on stderr, and touches nothing.
  writeFileSync(bin, `#!/bin/sh\necho "contained-${name} refuses: $*" 1>&2\nexit 1\n`);
  chmodSync(bin, 0o755);
}

process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
// Read by the pin. Its presence is the only proof this setup file ran.
process.env.CCRC_TEST_CONTAINED_PATH_DIR = dir;

/** Remove this file's own directory, ONCE.
 *
 *  The `removed` latch is not decoration: `mkdtemp` hands out a name the kernel
 *  may hand to someone else afterwards, so a second `rmSync` of the same path
 *  could delete a directory that by then belongs to a concurrent worker.
 *  `server/test/tmpHelpers.ts` refuses the same hazard with `splice(0)`; this is
 *  the one-directory form of it. */
let removed = false;
function removeContainedDir(): void {
  if (removed) return;
  removed = true;
  rmSync(dir, { recursive: true, force: true });
}

/** The PROMPT half of the cleanup: it removes this file's directory as soon as
 *  the file's suite finishes, so a long run never holds one per test file.
 *
 *  It is deliberately NOT the only half, and the reason is the whole of tests
 *  finding 1: `afterAll` is a VITEST hook, so it runs only if vitest got far
 *  enough to build a suite for this test file. A test module that throws at
 *  import never gets that far. The GUARANTEED half is the run-scoped root in
 *  `contain-path.globalsetup.ts`, removed by vitest's main process after the
 *  run; see the header above `const root` for why an exit handler here was
 *  tried, measured, and rejected. Both halves are pinned by
 *  `contain-path.test.ts` — the second one behaviourally, with a nested run
 *  whose test module throws at import. */
afterAll(removeContainedDir);
