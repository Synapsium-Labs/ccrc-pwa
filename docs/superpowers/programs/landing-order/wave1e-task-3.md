# Wave 1e, Task 3: four shards

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave1e-browser-shards.md`, Task 3 (D-9026). Base: `main` at
4e17ac96ee0d7e8f99f9dc24515b71f91d2e7190.

## What changed

- `.github/workflows/ci.yml`, job `browser-pwa` only: `shard: [1, 2, 3, 4]`, `total: [4]`, and a paragraph after
  D-8167's in the comment above the deadline (`FOUR SHARDS (D-9026)`). `timeout-minutes` was 20 at this step and is 30 at the tip (the amendment below; corrected by the coordinator after review run 3750), the job is
  still one job named `browser (pwa) ${{ matrix.shard }}/${{ matrix.total }}`, and nothing outside the job moved.
- `server/test/ci-pipeline.test.ts`: the case `is one job, browser-pwa, named browser (pwa) i/n …` expects 4, its
  comment says why (D-9026). Moved first and seen red: `the browser leg runs as four shards (D-9026): expected 3 to be
  4`.
- `pwa/browser/slowFirst.ts`: the header's sentence on the count says four since D-9026. The `pwa-shard` job's "the
  three shards' tests skip" is about the pwa shards, which stay three, and is left as it is.
- `pwa/test/browser-leg.test.ts` names no count and no file this wave moves: unchanged.

## The amendment: the limit becomes 30 (D-9055)

The coordinator amended the wave after dispatch (mail of 2026-11-25, `browser-shard-deadline`). At 04:18Z a third
green browser shard was cancelled at its 20-minute limit on a slow runner (run 45543535717, job 138967552810): its 15
finished files, all green, ran at a median of 1.25 times their times in run 45527962041 (at most 1.54), about 1.7 times
a fast runner's run of the same shard, while the run's other two shards took 14:29 and 13:14. Four shards fix the
heavy shard; nothing fixes a slow runner, and at 1.7 times a balanced shard of four stands about three minutes under
20.

- `ci.yml`, job `browser-pwa`: `timeout-minutes: 30`, and a paragraph after this wave's `FOUR SHARDS (D-9026)` one,
  `THE LIMIT IS 30 (D-9055)`, which says it overrules D-8167's sentence that the limit is never raised, gives the times
  above, what a shard expects (about eleven minutes) and what the limit is for (a wedged job, with room for a runner at
  about twice the usual time). D-8167's paragraph stays as history. No other job's limit moved.
- `ci-pipeline.test.ts`: the case's title says `a 30-minute deadline (D-7746, D-9055)`, it expects `'30'`, and its
  comments say why.
- D-9026's plan text said the limit stays 20 when this was written; the coordinator corrected the plan (#3363), and it says 30 since.

## Simulation

The sequencer's own rule, written out: `balancedShard` places files longest first onto the least-loaded shard by
`FILE_MS` (a file it does not name costs the median); inside a shard the files run longest first, the four
`SLOW_FIRST` files at the head, over three workers, each onto the first free worker, for its time in the named run.

| placement table | times | shards | expected per shard |
|---|---|---|---|
| the run's own (one linking file) | run 45527962041 | 3 | 878 s, 877 s, 878 s |
| the run's own (one linking file) | run 45527962041 | 4 | 870 s, 657 s, 658 s, 659 s |
| this branch's `FILE_MS` (two linking files) | run 45527962041 | 3 | 877 s, 877 s, 877 s |
| this branch's `FILE_MS` (two linking files) | run 45527962041 | 4 | **658 s, 658 s, 658 s, 657 s** |
| this branch's `FILE_MS` (two linking files) | run 45532069453 | 4 | 636 s, 581 s, 596 s, 660 s |

Each shard holds about 1,970 s of file time at four. The plan's figures (878 s; 870, 657, 658 and 659 s; 658 to
659 s) are reproduced. On the other night run's times, whose linking file took half as long, the placement still
holds every shard at 660 s or under. About 660 s is eleven minutes, about twelve with the job's setup, under the
limit, now 30 (D-9055).

## Step 4

From `server/`, one file per process through `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2`:
`ci-pipeline` 132 passed, `ci-merge-queue` 6 passed, `oss-metadata` 29 passed. `git grep -l "browser-pwa" server/test`
names `ci-merge-queue` and `ci-pipeline` only.

## Step 5: the mutation table

Each row: the file copied aside and its sha256 taken, the one edit applied (a unique match, refused otherwise), the
command run, the file restored from the copy and its sha256 compared. Commands run through `ccrc test --
./node_modules/.bin/vitest run --maxWorkers=2 <file>` from the package named.

| id | mutation | command | red | restored sha256 (equal before and after) |
|---|---|---|---|---|
| 1E-01 | `total: [4]` becomes `total: [3]` in `browser-pwa` | `test/ci-pipeline.test.ts` from `server/` | the shard-count case: `expected [ 1, 2, 3, 4 ] to deeply equal [ 1, 2, 3 ]` (its 1..total check comes first) | `ci.yml` ffe1f39bb9d8f26c707110f6c9f1941f0758821fc0771ae93f3b7db9d194fd20 |
| 1E-01b | both lists back to three, `shard: [1, 2, 3]` and `total: [3]` | the same | the same case: `the browser leg runs as four shards (D-9026): expected 3 to be 4` | `ci.yml` ffe1f39bb9d8f26c707110f6c9f1941f0758821fc0771ae93f3b7db9d194fd20 |
| 1E-02 | `timeout-minutes: 30` on `browser-pwa` goes back to 20 (D-9055; the plan's row is this same mutation back to 20) | the same | the same case, the deadline: `expected '20' to be '30'` | `ci.yml` ffe1f39bb9d8f26c707110f6c9f1941f0758821fc0771ae93f3b7db9d194fd20 |
| 1E-03 | `runs-widths.browser.test.ts` becomes `run-widths.browser.test.ts` in `FILE_MS` | `test/browser-leg.test.ts` from `pwa/` | `every file FILE_MS names is a browser file, …`: `run-widths.browser.test.ts: expected false to be true` | `slowFirst.ts` 31b5b8aae0590a8e16b54e958d34a7a7014653a4a712e3212164455365a1ae1f |
| 1E-04 | the `every row opened at ${width}px` block deleted from `project-linking-card-wide.browser.test.ts` | Task 2's title comparison, as written in `wave1e-task-2.md` | exit 1, `DIFF`: `split 17 titles`, five `MISSING every row opened at <w>px …` | `project-linking-card-wide.browser.test.ts` 152e8eab24ee915f4e22d4c046e18e2c5084a7c1a3b224980814d1455a23d9c3 |

1E-01, 1E-01b and 1E-02 were measured again on the amended `ci.yml` (the sha256 above); the first round's runs, on
the file with the limit at 20, were red in the same places.
1E-01 and 1E-02 red in the same case: the plan names it "the shard-count case" for one and "the case that names the
20-minute deadline" for the other, and it is one case that pins both. After every restore the gate below ran green.

## Step 6: the gate

One file per process, through `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <file>` unless said.

| suite | from | result |
|---|---|---|
| `browser-leg` | `pwa/` | green, 22 passed |
| pwa typecheck, `tsc --noEmit` | `pwa/` | green twice during the wave (after the move, after the division; the later edits are the table's data and comments). On the final tree it was killed twice by the test slice's memory cap: `ccrc test: the test slice's memory cap killed a process during this run (MemoryMax=6G, CCRC_TEST_SLICE_MEMORY_MAX; 3 OOM kill(s) in ccrctests.slice); exit 137`, then the same with 2 kills. The pull request's `pwa-static` job is the arbiter. |
| `ci-pipeline` | `server/` | green, 132 passed (and again after the amendment) |
| `ci-merge-queue` | `server/` | green, 6 passed |
| `oss-metadata` | `server/` | green, 29 passed |
| `citations` | `server/` | green, 4 passed |
| `anchors` | `server/` | green, 9 passed |
| `docs-parity` | `server/` | green, 81 passed |
| `topology-clean` | `server/` | green, 61 passed |
| `deviation-refs` (after `git fetch origin main`) | `server/` | on the test box: 1 failed, 33 passed, the case `is looking at two real trees, each with a real ledger in it` at `Test timed out in 20000ms` (23 s); alone with `ccrc test --local`: green, 34 passed |
| `single-definition/` whole | `server/` | green, 44 files, 1,592 passed |
| `typecheck-tests` | `server/` | on the test box: `Cannot find module 'typescript'` from the box checkout's `pwa/package.json`, no tests run (the box's checkout has no pwa install). Alone with `ccrc test --local`: killed by the slice's memory cap, `ccrc test: the test slice's memory cap killed a process during this run (MemoryMax=6G, CCRC_TEST_SLICE_MEMORY_MAX; 10 OOM kill(s) in ccrctests.slice); exit 1`, five cases red on `expected -1 to be +0` and the file lists of the killed compiles. The pull request's run is the arbiter. |

No full suite ran locally.

## After the absorb of `main` (round 3)

Ledger pull request #3363 defined D-9055 on `main` (merge commit 1c625acc39ed1597c553c842cfec2d75e2210503). Before it,
`deviation-refs` was red on this branch as expected: `floorFromScan over the real tracked tree …`, because
`.github/workflows/ci.yml` named D-9055 above the ledger high-water D-9026. The branch absorbed `origin/main` once, with
`git merge`, at that commit: no conflict, none of this wave's files changed on `main`, and no browser test file was
added there, so `FILE_MS` still names every browser file.

| suite | result after the absorb |
|---|---|
| `deviation-refs` | the D-9055 case green. One case, `is looking at two real trees, each with a real ledger in it`, timed out at 20 s on the test box (27.9 s) and again alone with `ccrc test --local` (55.6 s), both under the box's load: the timeout the brief names, not a scan finding |
| `ci-pipeline`, `ci-merge-queue`, `oss-metadata`, `citations`, `anchors`, `docs-parity`, `topology-clean` | green: 132, 6, 29, 4, 9, 81 and 61 passed |
| `single-definition/` whole | green, 44 files, 1,592 passed |
| `browser-leg` | green, 22 passed |
| pwa typecheck | green |
| `typecheck-tests`, alone with `ccrc test --local` | killed again by the slice's memory cap (`6 OOM kill(s) in ccrctests.slice`); the pull request's run is the arbiter |
