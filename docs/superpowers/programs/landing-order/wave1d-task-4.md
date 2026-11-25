# Wave 1d, Task 4: the README, the mutation table and the gate

Run 3739, plan `docs/superpowers/plans/2026-11-25-landing-order-wave1d-queue-ci.md`.

## README

Three sentences in **What CI runs**, after "Nothing reaches `main` through the queue without it.": one per decision,
D-9014, D-9015 and D-9016, in the words of the plan's Deviations. Nothing else in that paragraph changed.

## Mutation table

Every row: the file saved first, the mutation written, one suite run from `server/` as
`ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <suite>` on the test box, the file restored from the saved
copy, and its sha256 checked equal to the saved one. Rows 1D-02 to 1D-05 were measured after the workflow edits were
applied; an earlier pass of 1D-03 to 1D-05, before them, also redded the workflow case, which was then red for that
reason alone.

| id | Mutation | Suite | Red (exit 1) | Restored sha256 |
|---|---|---|---|---|
| 1D-01 | `server-shard`'s `timeout-minutes` back to 30 | `oss-metadata`, `ci-pipeline` | none: both green (exit 0). No suite pins the number; the plan's table allows none to be added | `ccaa222d94f06244cbe81046fc54518a19f691bfa75ad804da1e8206ef6fe118` (`ci.yml`) |
| 1D-02 | the `queue group still live` step removed from `server-shard` | `queue-live` | the workflow case (`server-shard`'s first step is the checkout) | `ccaa222d94f06244cbe81046fc54518a19f691bfa75ad804da1e8206ef6fe118` (`ci.yml`) |
| 1D-03 | `queueGroupFate` answers `superseded` for `present` with `onMain: 'no'` | `queue-live` | the table case (`present/no: expected 'superseded' to be 'live'`) | `96da2eb911f37e6e924e56212c963b21055adbd658497a7833f8f6ec096dbb3d` (`queue-live.mjs`) |
| 1D-04 | the script skips the compare and reads every absent branch as off `main` | `queue-live` | `landed`, and `unmeasured` when the compare fails | `96da2eb911f37e6e924e56212c963b21055adbd658497a7833f8f6ec096dbb3d` |
| 1D-05 | the script exits 1 on `unmeasured` | `queue-live` | both `unmeasured` end-to-end cases | `96da2eb911f37e6e924e56212c963b21055adbd658497a7833f8f6ec096dbb3d` |
| 1D-06 | `growthBase` ignores `QUEUE_BASE` | `growth-check` | the stacked case, at its `queue-parent` expectation | `6304ba8079f830a2e3abbbb50f5b963d5e9326b7460903aaa2f9bccfd8d351d2` (`growthCheck.ts`) |
| 1D-07 | `growthBase` takes `QUEUE_BASE` without the ancestor check | `growth-check` | the stacked case, at the commit off HEAD's history | `6304ba8079f830a2e3abbbb50f5b963d5e9326b7460903aaa2f9bccfd8d351d2` |

**1D-03 against the prediction.** The plan predicted the `live` end-to-end case red too. It stays green, because the
script never reads the second fact for a present branch (`onMain` stays `unmeasured`, and the stub `gh` never runs),
so that mutation cannot reach it through the script. The table case is the pin for it.

## The gate

One file per process, from `server/`, through `ccrc test` on the test box unless named otherwise: the results and
what could not run are in the wave-done mail. No full suite ran locally; this pull request changes `.github/`, so its
own run is the full suite.
