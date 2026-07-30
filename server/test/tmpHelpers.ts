// Every fixture directory this suite makes, removed when the file that made it
// finishes.
//
// `mkdtempSync(path.join(tmpdir(), 'ccrc-'))` with no matching `rmSync` was the
// shape in 17 of these files: one full run leaked hundreds of directories, a
// mutation sweep runs the suite 50-120 times, and /tmp reached 47k directories
// and 1.4 GiB once and 25k again five weeks later — on the box whose OOM/disk
// incident history is the reason this project exists. `trap 'rm -rf "$TMPHOME"'
// EXIT` is the same rule on the ccd side of the harness.
//
// A file-scoped `afterAll` rather than a global sweep of `/tmp/ccrc-*`: test
// FILES run in parallel processes, so removing everything that matches the
// prefix would delete another file's live fixture mid-test. Each module
// registry is per test file (vitest isolates by default), so `made` holds
// exactly what this file made, and the hook registers on this file's root
// suite when it imports the module.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const made: string[] = [];

/** `mkdtempSync` under `os.tmpdir()`, remembered for removal. Same signature as
 *  the call it replaces — a prefix, not a path — so nothing about what a test
 *  asserts can change by adopting it. */
export function mkTmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterAll(() => {
  // `force` because a fixture the test already removed itself is the normal
  // case, not an error — several files own their own cleanup and this is the
  // net underneath them.
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
