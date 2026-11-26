# Wave 5l, Task 5: the gate and the notes

Run 3942, programme `landing-order`, wave 32.

## Step 1: typechecks and the suite

- **Server sources** (`tsc --noEmit -p tsconfig.json`, through `ccrc test`): clean.
- **Tests-inclusive typecheck** (`-p test/tsconfig.tests.json`, `ccrc test --local`): killed for memory in the test
  slice, exit 137 (`MemoryMax=6G`), as the brief warned. In its place, `tsc --noEmit` over a narrow config under the
  session's temp root naming the nine changed test files and what they import: clean. The pull request's run is the
  arbiter for the whole tests project.
- **The full server suite was not run locally.** `ccrc test` estimated it at 264 min over 2115 files against its 15-min
  budget, and answers that the full suite runs on CI once per accepted tip, after review, by a dispatched full run. That
  dispatch is the coordinator's, not this wave's, so I stopped the local run while it was still queued for a slot. It had
  run no test.
- **What ran instead**, each file alone through `ccrc test`, every one green: the new prover file and Task 1's ten
  regression files (Task 1 note); the seven Task 2 test files, five more readers of the line and the single-definition
  suite (Task 2 note); the four coordinator suites and `ccrc-api-closed` (Task 3 note).

## Step 2: the notes

Each task note lists its files and claims, what moved since the baseline (nothing: every cited file is the same at
`ad52d25f4b` as at `f45fce5aee`), and its mutation rows as measured: 32 rows, every predicted case red, every file
restored to its committed bytes (sha256 in the tables).

## Step 3: what the plan asked that this wave did not keep

- The full server suite once (above): not run locally; left to the CI full run after review.
- Task 2 Step 2's red was measured at run time, not through the typecheck (vitest does not typecheck).
- Task 3 Step 2's red was not measured between the pin edit and the text edit; row M18 measured each new sentence's pin
  red instead (Task 3 note).
- Task 4 Step 3, the rendered README on GitHub's preview, is checked once the pull request exists, and reported in the
  wave-done.
- D-9134 (`store-case-journal-seed`): the store case first journals one no-run creation in another project (Task 2
  note), defined in the plan's "Deviations found" with the number the coordinator issued.
