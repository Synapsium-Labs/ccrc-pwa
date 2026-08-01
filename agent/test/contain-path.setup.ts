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
const bin = path.join(dir, 'tmux');
// Refuses everything, says so on stderr, and touches nothing.
writeFileSync(bin, '#!/bin/sh\necho "contained-tmux refuses: $*" 1>&2\nexit 1\n');
chmodSync(bin, 0o755);

process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
// Read by the pin. Its presence is the only proof this setup file ran.
process.env.CCRC_TEST_CONTAINED_PATH_DIR = dir;

afterAll(() => rmSync(dir, { recursive: true, force: true }));
