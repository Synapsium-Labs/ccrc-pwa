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
import { afterAll, afterEach, beforeEach, type TestContext } from 'vitest';

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
 *  in a `beforeAll`, and in every file that did not opt in. The `null` between
 *  tests is load-bearing: it is how the next `beforeEach` knows no other test
 *  is still open (see the overlap refusal below). */
let madeThisTest: string[] | null = null;
/** The test `madeThisTest` belongs to, so an `afterEach` only ever empties
 *  its own test's list — never the list of a test whose start it refused. */
let madeThisTestOwner: unknown = null;

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
 *  (the 300 span 2026-09-23..10-06; the four failed 10-02..06), always this
 *  file and no other, while its case count grew 481 -> 514. Three of the four
 *  were re-run, and the failed server shard went green in each. No process
 *  was left writing into the fixtures (a `ps` filtered to the temp root,
 *  taken in the hook, named none of that file's).
 *
 *  What it costs is NOT volume alone. ccrc-install leaves about the same
 *  bytes for its `afterAll` (270 dirs, 2.52 GB, 86k entries) and that hook
 *  took 2.1 s; the same ~2.5 GB of ccrc-update fixtures, removed per test
 *  while still warm, took ~3.7 s in total (p95 25 ms per removal, review
 *  measurement). So the cost of one end-of-file removal scales with what is
 *  left for it AND with the box's load and how cold that metadata has gone
 *  by then — rank another file's need to opt in by a measured `afterAll`
 *  time on a loaded box, not by its byte count. Removed per test, the work
 *  goes in ~500 small removals, each inside its own hook budget, and the
 *  final hook is bounded by what the file makes outside its tests — 0
 *  directories for that file, measured. Other `afterAll`s measured:
 *  ccrc-doctor (681 dirs, 289 MB, 80k entries, 2.4 s), ccrc-install (2.1 s,
 *  above); ccrc-install-graphify (41 dirs, 564 MB, 6.4 s) has since opted in;
 *  the rest under 1 s.
 *
 *  Not the default, deliberately. A file opts in only when ALL of these hold:
 *  - no fixture made inside one test is read from a later one (it would be
 *    gone);
 *  - no `onTestFinished` callback and no cleanup RETURNED from a
 *    `beforeEach` reads a `mkTmp` HOME: vitest runs the `afterEach` hooks
 *    first, then those cleanups, then `onTestFinished` (`runTest` in
 *    @vitest/runner, 4.1), so they find the HOME already removed. A
 *    describe-level `afterEach` is fine — it runs before this file-level one;
 *  - its tests do not overlap (`.concurrent`): there is one list per file, so
 *    a second test starting while the first is open is REFUSED — its
 *    `beforeEach` throws — rather than allowed to have either test's
 *    `afterEach` remove the other's HOME mid-run.
 *  And one consequence to know: a case that TIMES OUT loses its HOME at that
 *  moment, because vitest runs `afterEach` when the timer fires while the
 *  timed-out body may still be running; that straggler then writes into a
 *  removed HOME. Only an already-failed case sees it.
 *
 *  `maxRetries` because a test may leave a detached child still exiting into
 *  its HOME (the `--detach` cases run one for real) — `rm`'s own retry on
 *  `ENOTEMPTY`/`EBUSY` covers that window instead of failing a passed test in
 *  its `afterEach`. A removal that still fails (EACCES from a mode a test did
 *  not restore, which no retry covers) does not stop the others: every
 *  directory is tried, the ones that failed go back on the `afterAll`'s list
 *  for a second attempt, and the first error then fails the test. */
export function removeTmpFixturesAfterEachTest(): void {
  beforeEach((ctx) => {
    if (madeThisTest !== null) {
      throw new Error('removeTmpFixturesAfterEachTest: a test began while another test\'s fixture list '
        + 'was still open — the tests overlap (.concurrent?), or the opt-in was called twice');
    }
    madeThisTest = [];
    madeThisTestOwner = ctx.task;
  });
  afterEach((ctx) => {
    if (madeThisTestOwner !== ctx.task) return;   // a test whose start was refused owns nothing
    const mine = madeThisTest ?? [];
    madeThisTest = null;
    madeThisTestOwner = null;
    if (mine.length === 0) return;
    // FORGET them before removing them, for the reason `removeTmpFixtures`
    // forgets: a path `mkdtemp` may hand out again must not be removed twice.
    const gone = new Set(mine);
    made.splice(0, made.length, ...made.filter((d) => !gone.has(d)));
    const errors: unknown[] = [];
    for (const dir of mine) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      } catch (e) {
        made.push(dir);   // the afterAll tries it again
        errors.push(e);
      }
    }
    if (errors.length > 0) throw errors[0];
  });
}

/** For the second case of a pair whose first case sets something up: call it
 *  when the first case's marker is still unset. Under a `-t` that filtered
 *  the first case out it SKIPS this one (nothing to witness); otherwise it
 *  returns and the caller's own vacuity assertion fails, as it should — the
 *  first case was deleted, renamed out of place, or never ran. */
export function skipIfPreviousCaseFilteredOut(ctx: TestContext): void {
  const siblings = ctx.task.suite?.tasks ?? [];
  const prev = siblings[siblings.indexOf(ctx.task) - 1];
  if (prev?.type === 'test' && prev.mode === 'skip') ctx.skip('the case before this one was filtered out');
}

/** Every directory `mkTmp` made in this file that is still waiting for the
 *  `afterAll` — what a file asserts on to prove its own final hook is small. */
export function pendingTmpFixtures(): readonly string[] {
  return made.slice();
}
