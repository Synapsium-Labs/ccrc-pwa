# Wave 1d, fix round 1 (review run 3753 on c62318f02a)

Run 3739, plan `docs/superpowers/plans/2026-11-25-landing-order-wave1d-queue-ci.md`. The review found no defect in the
decider or the script. Its findings are about what the tests did not pin; the coordinator ruled on each.

## What changed

- **F1, the compare request is pinned.** The stub `gh` in `queue-live.test.ts` records its arguments, one per line. The
  `landed` and `superseded` cases assert the exact request: `api`, `repos/owner/repo/compare/<sha>...main`, `--jq`,
  `.status` (the repository, the group's commit then `main`, the field read). Reversed, a landed commit reads `behind`,
  which is `superseded`, and a merged group's late jobs would exit 1. New row 1D-08.
- **F3, the base the armed rows use is driven by the fixture case.** `armedBase(env, root, git)` in `growthCheck.ts`
  holds what `resolveBase()` did: skip outside CI and without `GROWTH_CHECK`, skip without `origin/main`, else
  `growthBase`. The suite's `resolveBase()` is now one call of it. The stacked-entry case resolves every base through
  `armedBase` (with `CI` set, as on a runner) and asserts its skip without `CI`. New row 1D-09: `armedBase` taking the
  plain merge base instead of `growthBase` reds the stacked case. What remains unpinned is `resolveBase()`'s one-line
  call of `armedBase` with `process.env` and the root.
- **F4.** `ci-merge-queue.test.ts` admits the step's script as its exact two lines (`QUEUE_LIVE_RUN`), not any two
  lines. The `QUEUE_BASE` line is left as it was.
- **F5.** The three comments that said the run always measures from the merge base are corrected (`growthCheck.ts` twice,
  `growth-check.test.ts`'s header). Two of them name `armedBase` and the queue group's parent; the third names `armedBase`
  and D-9016 (count corrected after review run 3762).
- **F6.** The case where the remote cannot be read runs under `ghContainedEnv` (a poisoned `gh` first on `PATH`), and
  asserts that no `gh` was asked.
- **F7.** The README's three sentences now follow the bypass sentences, which read as they did on `main`, and say
  that a job whose leg skips (a docs-only group's node floor) skips the step too, with no count of jobs.
- **F8.** The script's `::notice::` line on `superseded` stays. The header comment now says what it prints. Departure,
  for a number: `queue-live-notice-line` (the plan said one line).
- **F9.** The slow full queue shard was 29m53 (run 45421481370, the fifth server shard), not 29m24: corrected in the
  README, in task 1's note, and in the workflow's comment (that edit goes by packet to the holder of `ci.yml`).
- **F10.** Task 1's note says what can be checked from the tree: the branch's twelve `ci.yml` hunks. The packet's own
  figures are gone from it.
- **F2 and F11, recorded once.** The required-closure pin in `ci-merge-queue.test.ts` arrived one commit after the
  step and `QUEUE_BASE` it admits, and the commit layout is not the plan's (Task 2's commit is three, and Task 4's
  message precedes the workflow edits). The squash merge keeps neither.

## Mutation table, re-measured at the round's code commit `a6fac124df4c31da69132dd9e3d005dad17787ce`

Each row: the file saved, one change written, one suite run from `server/` as
`ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 <suite>` on the test box, the file restored from the saved
copy, its sha256 checked equal.

| id | Mutation | Suite | Red (exit 1) | Restored sha256 |
|---|---|---|---|---|
| 1D-01 | `server-shard`'s deadline back to 30 | `oss-metadata`, `ci-pipeline` | none (exit 0 in both): no suite pins 45 | `ccaa222d94f06244cbe81046fc54518a19f691bfa75ad804da1e8206ef6fe118` (`ci.yml`) |
| 1D-02 | the step removed from `server-shard` | `queue-live` | the workflow case | `ccaa222d94f06244cbe81046fc54518a19f691bfa75ad804da1e8206ef6fe118` |
| 1D-03 | `present` with `onMain: 'no'` answers `superseded` | `queue-live` | the table case | `75a385b0ad207852becae9f107897c5b27a2a222cc483eacf9db9b8a2c694d04` (`queue-live.mjs`) |
| 1D-04 | the compare skipped, every absent branch off `main` | `queue-live` | `landed`, `superseded` (its request now asserted, none made) and `unmeasured` when the compare fails | `75a385b0ad207852becae9f107897c5b27a2a222cc483eacf9db9b8a2c694d04` |
| 1D-05 | exit 1 on `unmeasured` | `queue-live` | both `unmeasured` cases | `75a385b0ad207852becae9f107897c5b27a2a222cc483eacf9db9b8a2c694d04` |
| 1D-06 | `growthBase` ignores `QUEUE_BASE` | `growth-check` | the stacked case | `e187f4b8803b214eed114aaa9998980cbadd4fc047137deead7b9be0e8825a76` (`growthCheck.ts`) |
| 1D-07 | `growthBase` without the ancestor check | `growth-check` | the stacked case | `e187f4b8803b214eed114aaa9998980cbadd4fc047137deead7b9be0e8825a76` |
| 1D-08 | the compare request reversed (`main...<sha>`) | `queue-live` | `landed` and `superseded` (`the compare request`) | `75a385b0ad207852becae9f107897c5b27a2a222cc483eacf9db9b8a2c694d04` |
| 1D-09 | `armedBase` takes the plain merge base, not `growthBase` | `growth-check` | the stacked case | `e187f4b8803b214eed114aaa9998980cbadd4fc047137deead7b9be0e8825a76` |

1D-04 now reds one case more than in round 0, `superseded`, because that case asserts the request, which the mutation
no longer makes.
