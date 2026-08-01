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
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-agent-containpath-'));

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
 *  isolated. */
for (const name of ['tmux', 'gh'] as const) {
  const bin = path.join(dir, name);
  // Refuses everything, says so on stderr, and touches nothing.
  writeFileSync(bin, `#!/bin/sh\necho "contained-${name} refuses: $*" 1>&2\nexit 1\n`);
  chmodSync(bin, 0o755);
}

process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
// Read by the pin. Its presence is the only proof this setup file ran.
process.env.CCRC_TEST_CONTAINED_PATH_DIR = dir;

afterAll(() => rmSync(dir, { recursive: true, force: true }));
