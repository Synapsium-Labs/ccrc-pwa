// Every fixture directory this suite makes, removed when the file that made it
// finishes. The agent-package twin of `server/test/tmpHelpers.ts`, deliberately
// identical in shape so there is one discipline in this repo and not two.
//
// WHY IT EXISTS HERE TOO (critic2, gates 3 related sub-item). The agent package
// had the registry, but only inside `helpers.ts` — and `whitelist.test.ts`,
// which imports none of that, cleaned up by calling `rmSync` AFTER its
// assertions (lines 9/10/19). That works on a PASSING run and leaks on a
// FAILING one, because a failed `expect` throws and the `rmSync` below it never
// executes. Failing runs are not the rare case here: this project's whole
// method is mutation sweeps, which run the suite 50-120 times with assertions
// deliberately failing, and the previous fix round added three more test files
// to that same directory without touching it. The host hit 95% disk the day
// this was written; /tmp has twice been the thing that filled.
//
// A hook, not a trailing statement, is the entire point: `afterAll`/`afterEach`
// run whether the test passed, failed or threw.
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

/** Remove every directory `mkTmp` made in this file, and forget them. Exported
 *  so the hook below has something a test can call: an `afterAll` cannot be
 *  observed from inside the file it runs for. */
export function removeTmpFixtures(): void {
  // `force` because a fixture the test already removed itself is the normal
  // case, not an error — several files own their own cleanup and this is the
  // net underneath them. `splice(0)` because `mkdtemp` hands out a name the
  // kernel may reuse: a cleaner that kept its list would, at end of file,
  // delete a directory that by then belongs to someone else.
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

afterAll(removeTmpFixtures);
