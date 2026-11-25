# Landing order, wave 1e — the browser shards fit their deadline again Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, as the dispatch specifies. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: decided by the programme's coordinator on 2026-11-25, on a defect measured in the merge queue that night, and amended the same night (D-9055): the shard's deadline goes to 30 minutes as well.** No implementation exists yet. It is built before wave 1d: it is the smaller change and the more frequent cause.

**Goal:** No browser shard of a merge-queue run expects more than about 12 minutes, and its deadline leaves room for a runner at about twice the usual time, so a green one is no longer cancelled at its deadline and its entry removed.

**Why:** of the fourteen merge-queue runs created from 00:17Z to 01:58Z on 2026-11-25, six ran the browser suite (the others were documentation groups, which skip it). In those six the second shard took 916 s, 924 s, 1085 s, 1187 s, 1204 s and 1211 s. The last two were cancelled at the deadline about a second after their summary line read all files passed (runs 45516946367 and 45527962041), and each removed a green entry. The first and third shards took 808 s to 1025 s.

**What was measured** (run 45527962041, jobs 138915898214, 138915898216 and 138915898257, the per-file lines of the three job logs):
- The suite is 118 files, 4,333 tests and 7,887 s of file time. `FILE_MS` in `pwa/browser/slowFirst.ts` names 82 files from a run of 2026-11-10, so 36 files cost its median.
- The three shards held 2,239 s, 3,360 s and 2,288 s of file time. By the stored figures each was meant to hold about 2,040 s.
- The runner was not slow: the 27 timed files of the second shard ran at a median of 1.05 times their stored figure.
- One file is the difference: `project-linking-card.browser.test.ts`, one `describe` of 22 tests, took 869.9 s against a stored 360.3 s. Five pull requests have changed it since 2026-11-13, three of them since 2026-11-20 (#3109, #3123, #3230).
- Simulated with the sharder's own rule on the run's own times, three workers a shard: three shards expect 878 s each; four expect 870 s, 657 s, 658 s and 659 s, the first set by that one file alone; four with that file in two halves expect 658 s to 659 s each.
- **The amendment's measurement** (run 45543535717, job 138967552810, 04:18Z the same night): a third green shard was cancelled at the deadline, and this one on a slow runner. 15 of its 39 files had finished, all green, in 2,194 s of file time, at a median of 1.25 times their times in the run above (largest 1.54); by the reporting coordinator's measurement, the same shard on a faster runner an hour earlier (run 45535406715) had needed 2,501 s for all 39. The run's other two shards took 14:29 and 13:14. Balance does nothing for a slow runner: at 1.7 times, a balanced shard of four stands about three minutes under 20.

**Architecture:** A data refresh, one test file moved into two, and two numbers in the workflow: the matrix and the deadline. D-8167 ruled that this leg is kept under its deadline by balance and a shard, never by a longer deadline. This wave follows it for the heavy shard, and overrules its last clause for the slow runner (D-9055): the deadline is what catches a wedged job, and 20 minutes was within reach of a healthy one.

**Tech Stack:** vitest's browser config and its sequencer (`pwa/browser/slowFirst.ts`), GitHub Actions YAML, vitest suites under `pwa/test/` and `server/test/`.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §5.2 and §10 (fewer wasted CI runs per landing). The spec's text does not change.

**Files (the whole wave):**
- Modify: `pwa/browser/slowFirst.ts` (`FILE_MS`, its doc comment, the header's sentence on the shard count)
- Modify: `pwa/browser/project-linking-card.browser.test.ts`; Create: one sibling test file and one shared module beside it
- Modify: `.github/workflows/ci.yml` (job `browser-pwa`: the matrix and the comment above the deadline)
- Modify: `server/test/ci-pipeline.test.ts` (the shard-count pin and its comment)
- Modify: `pwa/test/browser-leg.test.ts` only if a case there names a count or a file this wave moves

## What this does not claim

- **It does not stop the table going stale again.** `FILE_MS` is refreshed by hand from a job log, as D-7746 and D-8167 left it. A source the leg derives for itself is a later wave's; this plan adds none.
- **It makes no test faster and changes no test's body.** The 22 tests of the split file run as they did, in two files.
- **It changes no setting, and one deadline only,** the browser shard's.

## Global Constraints

- **The deadline on `browser-pwa` becomes 30** (D-9055), and no other job's deadline changes. Wave 1d owns the server shard's deadline; do not touch it here.
- **Every required check name still reports:** `test (pwa)` reads `needs.browser-pwa.result` as before. The job stays one job, `browser-pwa`, named `browser (pwa) ${{ matrix.shard }}/${{ matrix.total }}`.
- **No test body changes.** In Task 2 an `it` block moves whole, with its title unchanged. Helpers move to one shared module whose name does not contain `.browser.test.`, so the leg does not collect it.
- **This pull request changes `.github/`, so it runs the full suite** (the selector's `infraTrigger`). Do not add the `full-ci` label and do not dispatch a full run by hand.
- **Fast pull-request CI may not run the browser suite for real.** Read the pull request's own run: if its browser shards ran the tests, their four durations are the evidence; if they skipped, say so in the wave-done, and the merge queue's run is the first measurement.
- **Files other sessions hold.** Read `GET /api/claims?project=ccrc-pwa` before each task and claim what you edit. For a held file, send its holder the hunk as a packet first: a unified diff against a named `main` commit, inline, with its size and sha256; the file stays untouched until the answer.
- **Neutral names only.** The repository is public. Pull request and run numbers of this repository are fine; session, lane and host names are not.
- **Tests.** Every test and typecheck runs through `ccrc test -- <command>`, in the foreground, with a timeout of at least 600000 ms, `--maxWorkers=2` on a vitest run. The pwa suites run from `pwa/`, the server suites from `server/`.
- **Deviation numbers are issued, never chosen.** This plan defines D-9026, the one number issued for it on 2026-11-25. A departure found during execution is named by slug in the wave-done (`D-TBD-<slug>`), and the coordinator numbers it.
- **Commits** go on the workspace's own branch. Push once, when the build is complete, with code, tests and notes together; the pull request stays a draft. Notes go under `docs/superpowers/programs/landing-order/` as `wave1e-task-<n>.md`.

## Review Focus

1. **Every browser file still runs exactly once.** The shards partition the files at any count; `browser-leg.test.ts` pins it for the table's names plus an unnamed one. After Task 2 the leg lists 119 files and 4,333 tests.
2. **The split loses no test.** The two files together hold the same 22 titles as the one file did on `main`, each once. Task 2 measures the titles before and after.
3. **The shared module is not collected as a test and not shipped.** Its name carries no `.browser.test.`, and nothing under `pwa/src` imports it.
4. **A file the table does not name is still placed.** The median fallback is untouched; Task 1 changes data only.
5. **The count is read in one place.** The sequencer takes the count from vitest's `--shard=i/n`; the workflow's matrix is the only writer of it, and `ci-pipeline.test.ts` the only pin.

---

### Task 1: refresh the table

**Files:**
- Modify: `pwa/browser/slowFirst.ts`
- Test: `pwa/test/browser-leg.test.ts`

**Interfaces:**
- Produces: `FILE_MS` naming every browser file on the branch's base, by basename, in ms.

- [ ] **Step 1: Read the three job logs** of run 45527962041 (`gh run view --job <id> --log`, jobs 138915898214, 138915898216 and 138915898257) and take each file's own line: its basename and its ms. Expected: 118 files, 7,887,041 ms in all, 4,333 tests. A newer green merge-queue run that ran the suite may be used instead; then name it and its three jobs.
- [ ] **Step 2: Replace every figure in `FILE_MS`** with the run's, and add the files it did not name. Keep the table's order rule as it is. Rewrite the doc comment's source sentence to name this run, its jobs, the file count and the file time, and leave the earlier history in place.
- [ ] **Step 3: Run** `browser-leg` from `pwa/`. Expected: green; its case that every name in the table is a browser file holds for all of them.
- [ ] **Step 4: Commit.** `fix(ci): the browser shards' file times, refreshed from a merge-queue run (wave 1e)`

### Task 2: the one long file becomes two

**Files:**
- Modify: `pwa/browser/project-linking-card.browser.test.ts`
- Create: `pwa/browser/project-linking-card-wide.browser.test.ts`
- Create: `pwa/browser/projectLinkingCardRig.ts`
- Modify: `pwa/browser/slowFirst.ts` (the two halves' figures)

**Interfaces:**
- Produces: two test files that together hold the 22 tests, and one module that exports what both use.

- [ ] **Step 1: Pin today's titles.** List the file's `it(` titles on the branch's base into the task note: 22, in order.
- [ ] **Step 2: Move the shared code** (everything above the `describe`) into `projectLinkingCardRig.ts` and export what the tests use. Import it in the test file. Run the file's typecheck through the pwa package's own `tsc --noEmit`. Commit this move alone: the test file's tests are unchanged and still 22.
- [ ] **Step 3: Divide the tests by their own times.** From the job log of Step 1 of Task 1, take each test's ms. Move whole `it` blocks into the new file, under a `describe` with the same title plus `, second file`, so that each file holds between 45% and 55% of the 869.9 s. Change no body and no title.
- [ ] **Step 4: Measure.** The two files' titles together equal Step 1's list, each once. `browser-leg` is green. If this box can run the browser leg, run both files once and record their times; if it cannot, say so in the note.
- [ ] **Step 5: Give each half its figure in `FILE_MS`,** the sum of its tests' ms from the log, and remove nothing else.
- [ ] **Step 6: Commit.** `test(pwa): the project linking card's browser tests run as two files (wave 1e)`

### Task 3: four shards

**Files:**
- Modify: `.github/workflows/ci.yml` (job `browser-pwa`)
- Modify: `server/test/ci-pipeline.test.ts`
- Modify: `pwa/browser/slowFirst.ts` (the header's sentence on the count)

**Interfaces:**
- Produces: `shard: [1, 2, 3, 4]`, `total: [4]` and `timeout-minutes: 30` on `browser-pwa`.

- [ ] **Step 1: Move the pin first, and see it red.** In `ci-pipeline.test.ts` the case `is one job, browser-pwa, named browser (pwa) i/n over a shard matrix, …` expects a total of 3 (D-8167). Change the expectation to 4 and its comment to say why (D-9026). Run the suite: red on the count.
- [ ] **Step 2: Change the matrix,** and add a paragraph to the comment above the deadline, after D-8167's, that says what was measured (D-9026): at three shards the second took 916 s to 1,211 s in six queue runs of 2026-11-25 and was cancelled twice while green; the table was 36 files behind and one file had grown from 360 s to 870 s; at four shards, with the table refreshed and that file in two, a shard expects about 660 s, eleven minutes, and about twelve with its setup. Then change `timeout-minutes` to 30 and say why (D-9055): a third green shard was cancelled on a slow runner the same night, at 1.25 to 1.7 times the usual file times, so 30 is a deadline for a wedged job with room for a runner at about twice the usual time. The pin's case in `ci-pipeline.test.ts` that names the 20-minute deadline moves to 30 in the same commit, title and comment with it.
- [ ] **Step 3: Correct the sentence that names the count** in the header of `slowFirst.ts` ("CI runs three shards since D-8167"). The comment in the `pwa-shard` job that says "the three shards' tests skip" is about the pwa shards, which stay three: leave it.
- [ ] **Step 4: Run** `ci-pipeline`, `ci-merge-queue`, `oss-metadata` and every suite `git grep -l "browser-pwa" server/test` names, one file per process. Expected: green.
- [ ] **Step 5: The mutation table,** each row measured red and restored from a saved copy with its sha256 checked:

| id | Mutation | Predicted red |
|---|---|---|
| 1E-01 | the matrix total goes back to 3 | `ci-pipeline`'s shard-count case |
| 1E-02 | `timeout-minutes` on `browser-pwa` goes back to 20 | `ci-pipeline`'s case that names the deadline |
| 1E-03 | one name in `FILE_MS` is misspelt | `browser-leg`'s case that every name is a browser file |
| 1E-04 | one `it` block is deleted from the new file | Task 2 Step 4's title comparison, run as written in the note |

- [ ] **Step 6: The gate.** One file per process: `browser-leg` and the pwa typecheck from `pwa/`; from `server/`, `ci-pipeline`, `ci-merge-queue`, `oss-metadata`, `citations`, `anchors`, `docs-parity`, `topology-clean`, `typecheck-tests`, `deviation-refs` (after `git fetch origin main`) and `single-definition/` whole. `typecheck-tests` and `deviation-refs` have each failed for the test box's own reasons: re-run one alone, once with `ccrc test --local`, before calling it a break, and report both results.
- [ ] **Step 7: Commit, push once, wave-done.** `fix(ci): the browser leg runs as four shards (wave 1e, D-9026)`. The wave-done names the pull request's four browser shard durations if they ran, or says they skipped.

## Deviations found

One number was issued for this plan on 2026-11-25, and one more for its amendment the same night.

- **D-9026 (2026-11-25)** — `browser-four-shards`: the browser leg runs as four shards, not three, with its file-time table refreshed from merge-queue run 45527962041 and `project-linking-card.browser.test.ts` divided into two files. At three shards the second took 916 s to 1,211 s in six queue runs and was cancelled twice at the 20-minute deadline with every test green. For the heavy shard the fix is balance and a shard, as D-8167 ruled. The table is still refreshed by hand, which is the residual. Its deadline is D-9055's.
- **D-9055 (2026-11-25)** — `browser-shard-deadline`: the `browser-pwa` job's deadline is 30 minutes, not 20. It overrules the last clause of D-8167's comment, "never a longer deadline", on a measurement that comment did not have: on 2026-11-25 the same shard's files ran at 1.25 to about 1.7 times their usual time by runner, and a green shard was cancelled for it. A green shard cancelled removes its entry and rebuilds every group behind it; a wedged one that runs to 30 costs ten runner-minutes more than at 20. The same stance as D-9014 takes for the server shards.

**As built.** The wave merged on 2026-11-25 as #3362 (merge commit `cb973d69`) after one review round. In its own queue run the four shards took 630, 592, 743 and 632 seconds. One more number was issued on 2026-11-25 for the departure the worker reported by slug.

- **D-9065 (2026-11-25)** — `linking-card-time-varies`: the file this wave divided does not take a steady time. It took 869,850 ms in queue run 45527962041 and 425,156 ms in run 45532069453 thirty-five minutes later, every case about half as long and in the same proportions. The table keeps the higher figure, which places the two halves most cautiously; at the lower one the four shards stay balanced as well. So a stored file time is a ceiling for this file, not a measurement, and the table's hand refresh (D-9026's residual) should not lower it on one fast run.
