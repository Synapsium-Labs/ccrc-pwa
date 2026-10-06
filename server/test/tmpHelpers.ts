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
  made.push(dir); madeThisTest?.push(dir);   // the second: see removeTmpFixturesAfterEachTest
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
  madeThisTest?.splice(0);   // forgotten here too, or a per-test afterEach would remove them again
}

afterAll(removeTmpFixtures);

/** What the running TEST has made, while a file that opted in is between its
 *  `beforeEach` and its `afterEach`; `null` everywhere else — at collection,
 *  in a `beforeAll`, and in every file that did not opt in. */
let madeThisTest: string[] | null = null;

/** OPT-IN, once at a file's top level: remove what each TEST made when that
 *  test ends, so the `afterAll` above is left only what was made outside a
 *  test (at collection or in a `beforeAll`) — the fixtures a later test may
 *  still be reading.
 *
 *  WHY, measured (2026-10-06). `ccrc-update.test.ts` hands nearly every one of
 *  its ~500 cases a fresh HOME holding one or more copies of the ccrc tree,
 *  and all of them used to wait for the one `afterAll`: 648 directories,
 *  2.50 GB, 99,710 entries at the end of a local run. The synchronous loop
 *  above took 23.2 s over them on the dev box at load ~40 (the hook timed out
 *  there too) and 13.4 s on a re-run at load ~30 — against a 20 s
 *  `hookTimeout` (`vitest.config.ts`). On GitHub's runners the same file
 *  failed with every one of its tests passing (`Hook timed out in 20000ms`
 *  at the `afterAll` line above) in four jobs of the last 300 `ci.yml` runs
 *  (2026-10-02..06), always this file and no other, while its case count grew
 *  481 -> 514; the one job that was re-run went green. No process was left writing into the fixtures (a `ps`
 *  filtered to the temp root, taken in the hook, named none of that file's):
 *  the hook timed out on VOLUME, and the volume grows with every case added.
 *  Removed per test, the same bytes go in ~500 small removals, each inside
 *  its own hook budget, and the final hook is bounded by what the file makes
 *  outside its tests — 0 directories for that file, measured. The
 *  next heaviest files measured at their `afterAll`: ccrc-install-graphify
 *  (41 dirs, 564 MB, 6.4 s), ccrc-doctor (681, 289 MB, 80k entries, 2.4 s),
 *  ccrc-install (270, 2.52 GB, 86k entries, 2.1 s); the rest under 1 s.
 *
 *  Not the default, deliberately: a file that makes a fixture inside one test
 *  and reads it from a later one would lose it. A file opts in once it has
 *  none of those.
 *
 *  `maxRetries` because a test may leave a detached child still exiting into
 *  its HOME (the `--detach` cases run one for real) — `rm`'s own retry on
 *  `ENOTEMPTY`/`EBUSY` covers that window instead of failing a passed test in
 *  its `afterEach`. */
export function removeTmpFixturesAfterEachTest(): void {
  beforeEach(() => { madeThisTest = []; });
  afterEach(() => {
    const mine = madeThisTest ?? [];
    madeThisTest = null;
    if (mine.length === 0) return;
    // FORGET them before removing them, for the reason `removeTmpFixtures`
    // forgets: a path `mkdtemp` may hand out again must not be removed twice.
    const gone = new Set(mine);
    made.splice(0, made.length, ...made.filter((d) => !gone.has(d)));
    for (const dir of mine) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });
}

/** Every directory `mkTmp` made in this file that is still waiting for the
 *  `afterAll` — what a file asserts on to prove its own final hook is small. */
export function pendingTmpFixtures(): readonly string[] {
  return made.slice();
}
