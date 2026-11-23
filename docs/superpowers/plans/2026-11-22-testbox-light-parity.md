# A light parity check for the test box: plan

The test box's switch turns on only after a parity check passes (`ccrc testbox-admin parity`, which runs
`ccd/testbox-parity`). The check replayed the five most recent merged pull requests and ran the whole server suite
twice for each, once on the fleet host and once on the box. That is many hours, and it loads the fleet host with the
same kind of heavy test run that crashed a fleet. The operator ruled that it be replaced by a much lighter check. This
plan is that check. It adds no setting, no knob and no verb.

## Measured

- `_tba_run_parity` passed `--recent 5`. The tool ran `<head> run --reporter=junit --maxWorkers=2` with no file named,
  which is the whole suite, once per pull request on each side.
- The `testtimes` artifact of 2026-11-22 lists 1957 server files and 24,185 s of whole-file time: about 3.4 hours a leg
  at two workers on a CI runner. One local leg had not ended after an hour on a loaded fleet host.
- The median file takes 2.3 s, p90 27.9 s, p99 190 s; 1773 files take 30 s or less, 184 more.
- Of the six known load flakes, three take over 30 s in CI: `typecheck-tests` 149 s, `session-hook` 138 s and
  `ccd-ws-gc` 61 s. `pr-sweep` takes 3.9 s, `ccd-session-state` 8.9 s and `ccd-bounded-reads` 24.3 s.
- With no times, the first 32 files of the sha256 spread cost 458 s of CI time, with `ccrc-models-advance` (217 s)
  among them. The first eight cost 42 s.
- `vitest list --filesOnly` in `server/` takes about 0.2 s and names 1975 files. The tracked test files number 1976:
  `server/test-e2e/session.e2e.test.ts` is outside the package's include (`test/**/*.test.ts`).
- `_tba_run_parity` passed no `--flaky`, and no test covered the flaky re-run, so that rule never ran.
- On a warm npm cache the four lockfile installs took 1 to 2 s each on a laptop. Budget 1 to 2 minutes on a loaded box.
- A merge commit on `main` is the merge queue's head commit, with one parent.
- `gh pr list` sorts by creation time, not by merge time, and without `--base` it lists pull requests into any branch.
- A local leg naming more than three test files is heavy to `ccrc test` (`CCRC_TEST_WIDE_FILES`), so it waits for one
  of the fleet's two heavy-test slots, and that wait counted against the leg's bound.

## The check

1. **One revision** (D-8945). The verb passes `--recent 1`; named pull requests still replace it. The newest is the pull
   request merged most recently into the default branch: the clone's `origin/HEAD`, else `gh repo view`, then one
   `gh pr list --state merged --base <branch> --limit 50` with `mergedAt`, sorted by merge time in the tool. The three
   fixtures still run once, with the first row.
2. **What vitest would run.** The universe is the tracked test files that the package's own vitest names with
   `<head> list --filesOnly`, a bounded step in the worktree. A tracked test outside the include is never picked, so it
   can never read `DIFFERS (not run)`. A listing that fails fails the revision before any leg. The command must
   therefore end in `run`, which the verb's always does.
3. **A sample, not every file** (D-8945). Per revision, the rule is TP_SAMPLE in `ccd/testbox-parity`, the tool that
   already owns which revisions run and how they are compared:
   - first the tests the revision changed against its first parent, in hash order;
   - then the known load flakes, read from the revision's `server/load-flakes.txt` (never a symlink), plus any `--flaky`;
   - then the rest, ordered by the sha256 of the package-relative path. No revision moves that order.
   - **With CI's per-file times**, one ceiling holds for every group: a file over 30 s is never sampled, a changed test
     or a flake included, and the summary line names each changed test and flake it left out. So the three heavy flakes
     are not sampled; they are still re-run alone when they differ as a changed test. A changed test or a flake with
     no time costs 30 s, and a spread file with no time is never taken. The changed tests may use at most half of
     `--sample-budget` and at most 12 files, so the flakes and the spread always have the other half. A file that would
     pass a limit is skipped and the fill goes on; the whole stops at 64 files.
   - **Without times**, nothing is priced, so the sample is small by count: at most 4 changed tests and 8 spread files,
     and no flake, because the flake list is where the heavy files are. Today that spread costs 42 s of CI time.
   - An empty sample fails the revision before any leg runs. The full suite is never run, and no flag brings it back.
4. **The times** are fetched with gh, each call a bounded step, once a run, from the default branch (they price files,
   so one branch's serve every revision): the newest unexpired `testtimes` artifacts of this repository's own runs on
   that branch, up to three; for each, its run (`gh api .../actions/runs/<id>`), which must be `.github/workflows/ci.yml`
   from `push`, `schedule` or `workflow_dispatch`, of this repository and not a fork; then `gh run download <run id>`.
   This is `.github/ci/main-artifact.mjs`'s rule (`artifactCandidates`, `isTrustedRun`), copied because it is
   **legitimately different by host**: the fleet box's release tree ships no `.github/` (`deploy/build-release.sh`'s
   PATHSPEC), and the tool serves any repository row, so the branch is the row's default branch, not a literal `main`.
   A test holds the copy's workflow path and events equal to the module's. The file must be at most 1 MiB and a JSON
   object of numbers of zero or more. A bad file only means no times. Times can only reorder or leave out the
   repository's own test files, so they cannot make a leg pass that did not earn it.
5. **The reference is a local leg over the sample** (D-8946). It runs as before: `ccrc test --local` in the
   worktree's package, in `ccrctests.slice`. CI's record was rejected for five measured reasons:
   - The merge-queue run of the newest merged pull request uploaded no artifact. Another green queue run uploaded none.
   - The only per-file CI data are wall times (`times-<shard>`, kept 3 days, and `testtimes`, kept 14 days). They
     carry no pass or fail and no skipped tests.
   - CI's pass or fail is per job, about 160 files a shard.
   - Parity compares skip counts and names per file, and CI keeps none.
   - A GitHub runner is a third environment. The fleet host is the fallback, so it is the reference.
6. **The legs report tap-flat** (D-8946). The tool compared each side's junit on stdout, but vitest 5 writes junit to
   `.vitest/junit/output.xml` unless a file is named. Neither leg printed one, so the comparison saw no file and every
   run read "every file agrees" (measured with vitest 5.0.5). The box cannot return a file. `--reporter=tap-flat`
   prints one line per test on stdout on both sides, with the file, the failures and the skips.
7. **A sampled file neither side reported differs** (`DIFFERS (not run)`), so a leg pair that ran nothing is never
   an agreement.
8. **The flaky re-run** is kept: a file on the list that differs is re-run alone on both sides once, and that answer
   counts. It is now live, because the list comes from the worktree. A re-run removes the verdict file first.
9. **The fixtures run in one leg pair**: the three files are named in one run on each side, and each side's `TP|`
   lines are split by fixture name before they are compared. The record keeps three fixture entries.
10. **The queue wait** (D-8947). `--queue-wait` (the table's `parity/queue`, 300 s) is added to the local leg's bound
    only, so a wait for a heavy-test slot does not eat the run's own 7 minutes. A local leg stopped while `ccrc test`
    still says it is queued is logged as "waited in the fleet's heavy-test queue for its whole bound and never started:
    the fleet box was busy, which is no difference"; it still counts as a leg that could not run, so the record fails
    and the operator runs parity again. A leg that queued and then started logs how long it waited.
11. **Deadlines** (D-8947), in both tables: `parity` 1500, `parity/leg` 420, `parity/tail` 300, `parity/kill` 8, and
    two new rows, `parity/sample` 240 and `parity/queue` 300. `parity/sample` holds CI-measured seconds, not a
    deadline. The verb splits it evenly across the rows, never under 60 each, and passes it as `--sample-budget`. The
    tool starts nothing after the act's start plus 1200 s: room for two stopped steps and one queue wait. A step is 7
    minutes: three times the CI pace of a 240-s sample at two workers, plus a minute.
12. **The record shape is unchanged on disk.** The reader takes an optional `files?: number` (the count of test files
    compared), so a later record may carry it, and the card shows "N test files compared on each side" when one does.
    Nothing writes it yet: a server older than this reader refuses the whole test box status when a record carries an
    extra key, and the default rollout, the console's update and a watchdog rollback can all leave an older server
    beside a newer fleet box. The tool prints the count instead. Writing it is a follow-up for a release after this
    one is on every server.

## Expected duration, one row, fleet host loaded

| Step | Loaded | Idle |
|---|---|---|
| Default branch, gh list and the times fetch | about 15 s | |
| Worktree and the test file listing | 10 s | |
| Four `npm ci` | 1 to 2 min | |
| Local sample leg (120 s of CI time at two workers, about twice that under load, plus start) | about 4.5 min | |
| A wait for a heavy-test slot, when the fleet's two are held | 0 to 5 min | |
| Box sample leg (snapshot, install from the box's pristine store, run) | about 2.5 min | |
| One fixture leg pair | about 1 min | |
| A flaky re-run, only when a flake differs | about 1 min each | |
| Clean-up and the record | under 1 min | |
| **Total** | **about 10 min, 15 with a full queue** | **6 to 7 min** |

The worst case is bounded at 25 minutes by the unit's `RuntimeMaxSec`.

## Tasks

1. Tests first: `server/test/testbox-parity.test.ts` (a fixture repository of 200 test files and one e2e file outside
   the include, fakes that report the files they were asked for, a fake vitest that lists the include, a fake gh that
   names the default branch, lists by creation, lists and downloads `testtimes` and answers the run), the contract and
   verb tests, the new pin `server/test/load-flakes-pin.test.ts`, and the card's tests.
2. The tool: the default branch and the newest by merge time, the listing, the sample, the times fetch and its run
   check, the empty-sample guard, the not-run rule, the fixtures in one leg pair, tap-flat and the queue wait.
3. The verb: `--recent 1`, `--sample-budget` and `--queue-wait`; both deadline tables; the reader; the card.
4. Measure each new guard by breaking it and reading the red test.

## Rejected

- Running the local and box legs at the same time. It would halve the wall time, but it breaks the step and TERM model.
- Adding the tests vitest relates to the change. That took 39 s or more on an idle CI runner, and the set has no
  bound: a change to `shared/api.ts` relates hundreds of files.
- A junit upload in `ci.yml`. It changes CI infrastructure, and a runner is still the wrong environment.
- An `--all` flag. It would bring back the full suite as an option.
- Failing a revision that has no CI times. Another repository row's CI keeps none, so its parity could never pass.
- A committed snapshot of file times as the fallback. It would need a writer to keep it fresh, and only this
  repository has one.
- Skipping the heavy-test queue for the local leg. It is a heavy run on the fleet host, and the queue is what keeps it
  from piling on others.
- Writing `files` in this release (see step 12).

## Known limits

- The cap of 12 changed tests has no test of its own with times: the fixture's pull request changes two. The untimed
  cap of 4 has one.
- Without times, the changed tests and the spread are not priced. A heavy changed test can still make a leg run out
  of time; the count keeps that to one or two files.
- The times come from the default branch's newest daily or manual full run, not from the revision itself.
- A wait in the queue that ends the leg fails the record; the check does not retry by itself.

## Deviations found

- **D-8945 (2026-11-22)** — parity-one-pr-sample. Parity replays the newest PR merged into the default branch over
  a sample of the tests its vitest lists, not five full suites. No CI times: 4 changed, 8 spread, no flake.
- **D-8946 (2026-11-22)** — parity-reference-local. A local leg over the sample is the reference; CI keeps no per-file
  results. The legs report tap-flat, since vitest 5 writes junit to a file and the old compare saw no file.
- **D-8947 (2026-11-22)** — parity-deadlines-light. Parity 25 min, a step 7 min, sample 240 CI-seconds, and a
  5-min heavy-test queue wait on the local leg's bound only, in both tables.
