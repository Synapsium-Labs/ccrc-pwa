// Every fixture directory this suite makes, removed when the file that made it
// finishes.
//
// `mkdtempSync(path.join(tmpdir(), 'ccrc-'))` with no matching `rmSync` was the
// shape in 17 of the 23 files this replaces the call in: one full run leaked
// 140 directories, measured, and a mutation sweep runs the suite 50-120 times.
// /tmp held 7,830 of them when this landed, five weeks after the 47k/1.4 GiB
// failure CONSTRAINTS already paid for, on the box whose OOM/disk incident
// history is the reason this project exists.
//
// The sentence that used to end this paragraph — "`trap 'rm -rf "$TMPHOME"'
// EXIT` is the same rule on the ccd side of the harness" — was FALSE and is
// removed (critic2, gates Cannot-verify 3; declined twice as out-of-lane, made
// zero times). `TMPHOME` appears nowhere in this repository except that
// sentence: `grep -rn TMPHOME infra/` returns exactly one hit, the comment
// itself, and `ccd` arms no such trap. Whether it was ever true is unknown; it
// was cited by a review as corroboration for this file's discipline, which is
// how a false comment does damage. The discipline stands on its own — it is the
// `afterAll` below, and its ccd-side counterpart is whatever the ccd tests
// actually do, which is not this.
//
// A file-scoped `afterAll` rather than a global sweep of `/tmp/ccrc-*`: test
// FILES run in parallel processes, so removing everything that matches the
// prefix would delete another file's live fixture mid-test. Each module
// registry is per test file (vitest isolates by default), so `made` holds
// exactly what this file made, and the hook registers on this file's root
// suite when it imports the module.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach } from 'vitest';

const made: string[] = [];

/** `mkdtempSync` under `os.tmpdir()`, remembered for removal. Same signature as
 *  the call it replaces — a prefix, not a path — so nothing about what a test
 *  asserts can change by adopting it. */
export function mkTmp(prefix: string): string {
  // RESOLVED, and that is not cosmetic. `os.tmpdir()` answers `/var/folders/…`
  // on macOS, where `/var` is a symlink to `/private/var` — so a fixture home
  // handed out unresolved does not match what ccd reports back. ccd resolves
  // deliberately (`_ws_realpath`, `pwd -P`), so every assertion built from an
  // unresolved home compares two spellings of one directory and fails on that
  // platform alone, for a reason that has nothing to do with the subject.
  //
  // Resolving HERE fixes the whole class at its source rather than at each
  // assertion, and it is a no-op wherever the temp root holds no symlink —
  // which is every Linux box this suite has ever run on.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

/** Remove every directory `mkTmp` made in this file, and forget them. Exported
 *  so the hook below has something a test can call: an `afterAll` cannot be
 *  observed from inside the file it runs for. */
export function removeTmpFixtures(): void {
  // `force` because a fixture the test already removed itself is the normal
  // case, not an error — several files own their own cleanup and this is the
  // net underneath them.
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** How many directories this file's `mkTmp` has made and not yet removed: the mark `removeTmpFixturesSince`
 *  takes (centralised-update wave 13, R20a). */
export function tmpMark(): number {
  return made.length;
}

/** Remove every directory `mkTmp` made at or after `mark` (a `tmpMark()`), and forget it. A
 *  removal that throws keeps its directory for the `afterAll` below, which removes it or fails loudly, so a
 *  directory is never forgotten unremoved (centralised-update wave 13, R20a). */
export function removeTmpFixturesSince(mark: number): void {
  const kept: string[] = [];
  for (const dir of made.splice(mark)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { kept.push(dir); }
  }
  made.push(...kept);
}

/** OPT-IN, for a file whose one end-of-file sweep is too big for one hook: called at a file's top level, it
 *  registers a root `beforeEach` that marks `made.length` and a root `afterEach` that removes what the test
 *  made from that mark on. R20a measured `ccrc-update.test.ts`: about 650 directories and 2.5 GB in its one
 *  `afterAll`, which overran vitest's 20 s hook timeout on two CI shards while every test passed. A directory
 *  made BEFORE the mark (at collection time, or in a `beforeAll`) is left for the `afterAll`. A root
 *  `afterEach` runs after every describe-level one (vitest runs a test's after-hooks innermost first), so a
 *  describe's own teardown still sees its home.
 *
 *  Tests that OVERLAP (`.concurrent`) are refused: there is one mark per registration, so a second test that
 *  starts while the first is open would move it, and whichever ends first would remove from the other's mark on
 *  — a running test's home included. The second test's `beforeEach` throws instead, and its `afterEach` (which
 *  vitest still runs) removes nothing, because the open mark is not its own. */
export function removeTmpFixturesEachTest(): void {
  let mark = -1;
  let owner: unknown = null;
  beforeEach((ctx) => {
    if (owner !== null) {
      throw new Error('removeTmpFixturesEachTest: a test began while another test\'s mark was still open — '
        + 'the tests overlap (.concurrent), and one would remove the other\'s fixtures mid-run');
    }
    mark = tmpMark();
    owner = ctx.task;
  });
  afterEach((ctx) => {
    if (owner !== ctx.task) return;   // a test whose start was refused owns no mark
    if (mark >= 0) removeTmpFixturesSince(mark);
    mark = -1;
    owner = null;
  });
}

afterAll(removeTmpFixtures);
