# Landing order wave 5j-a: fix round 1

Review run 3781 read the tip `e94b55a0c0023b4e9b919dd6ff7dc40114b57025`. It found nothing critical or important, and five
minor points. The coordinator ruled on them in call 1166. This note gives each ruling, what changed, and its red and green.
Every test ran through `ccrc test`, one file per process, from `server/`.

## R1: a withdrawn row with no run is kept at a pin (the review's F1)

The plan's Task 3 moved the whole `withdrawn` arm out of the kept case. Decision 7, section 4.3 and section 11 C3 say a
run-less withdrawn entry cannot re-enter, and section 11 wins over a task. In the pin arm of `decideLandingWrite`
(`server/src/coord/landingEntry.ts`), a `withdrawn` row now re-pins only when its run field is a number. A withdrawn row
with no run answers `kept withdrawn`, as on main, and the run still advances. A `closed` row is unchanged in both forms:
it re-pins with or without a run, because `closed` is GitHub's word and `withdrawn` is the operator's. The comment at the
branch now says a run-bound withdrawn row.

The run field. `LandingEntry.runId` is `number | null`. The strict row reader (`landingEntryFactsOfRow`) reads a stored run
id that is neither absent nor a positive safe integer as unreadable, and the store then refuses the whole snapshot, so
the decider is never handed anything else. The condition is `typeof current.runId === 'number'`, so it keeps on anything
that is not a number. The type is not widened.

Cases, in `server/test/landing-entry-store.test.ts`:

- Pure: a pin over a readable, unmarked withdrawn row with no run answers `kept withdrawn`. The run-bound row still
  answers `repin`, and a closed row re-pins with and without a run. Red before the source change
  (`expected { act: 'repin', id: 3 } to deeply equal { act: 'none', …(1) }`), green after.
- Store, main's dropped arm back for the no-run form: a withdrawn row with no run, at a verified pin of its pull request by
  a run. The row is unchanged byte for byte, so it keeps its state, its null run, its pinned sha, its pin time and its
  detail. No witness is written, the answer is `kept withdrawn`, and the run is at `merging`. Red before the source
  change, green after.
- Store, the case the review found lost: an unreadable run-bound withdrawn row (its `handoffCommit` is not a hash) is kept
  under its own word at a pin. The row and the witnesses are unchanged, and the run still advances. R1 does not touch
  this path, so the case was green before the source change and after it. Its red is measured by mutant FR1-X below.

The file went from 61 cases to 64.

### Mutation row A25, and FR1-X

Each row was run from a saved copy. The sha256 was checked before and after, and the source was restored byte for byte
(`c829b0eaa1c0e333…`, the source at `e90d73d600`).

| Row | Mutation | Predicted red | Measured | Restore |
|---|---|---|---|---|
| A25 | `(current.state === 'withdrawn' && typeof current.runId === 'number')` to `current.state === 'withdrawn'` | both no-run cases | 2 failed: the store no-run case; the pure no-run case | restored, sha256 c829b0eaa1c0e333 |
| FR1-X | the closed or withdrawn arm's readable-and-unmarked condition to `true` | the unreadable run-bound store case | 3 failed: the unreadable run-bound store case; the pure closed gate; the pure withdrawn gate | restored, sha256 c829b0eaa1c0e333 |

Commit: `e90d73d60064e75097c236d34d08e3cbe5ba83aa`.

## R2: two order case titles say what they assert (the review's F2)

In `server/test/landing-line-order.test.ts`:

- The loop over two setters is dropped. The walk never reads `setBy`, so the loop fed it the same input twice. The case
  is now titled "C with its order declared again without the withdrawn B is free: C is the head and nothing waits", and
  it asserts that once. Who may declare the order again is the next half's feed side, and no feed-side assertion is added.
- "B re-pinned then closed is met" becomes "B pinned again (a later pin time) is outstanding as a pinned target; B landed
  is met; B closed is met". The closed arm sets B closed directly.

This is a retitling with one loop removed, so there is no new red to measure. The file is green, 68 of 68. Commit:
`a36791cee6964567a88973d72ed79e4a5befc449`. The Task 5 note's mutation table names the old titles, as they were measured.

## R3: the armed 401 with an entry in the line (the review's note under the weakened tests)

In `server/test/landing-read-route.test.ts`, a new armed case seeds one entry, then asks with neither credential. It
restores the assertion the inverted dark case dropped:

- The 401's body has exactly the keys `detail`, `error`, `ok` and `verdict`.
- The body contains neither sha, nor the setter, nor an `entries`, `order` or `pr` key.

A token read of the same app, in the same case, answers 200 with the entry and its pinned sha. That shows the seeded line
is visible to a credentialed read, so the negative assertions can fail. No mutant that leaks the line into the 401 was
measured: the route has none to remove, and A15 (the credential check removed) already reds the status. The file is
green, 32 of 32. Commit: `f09caa38d354935ed023018082ef0c270e642d19`.

## R4: a departure named by its slug (the review's F3)

Task 2's commit is red alone in the single-definition directory: the holder list gains `landingDoorsTx.ts` one commit
later, for the reason the Task 2 note gives. The Task 2 note now names the departure by its slug,
`landing-doors-holder-pin-order`. No history is rewritten.

## R5: the store growth figure (the review's F4)

The Task 2 note now gives the figure against the merge base, `531bdb86bd60c0f8809cfa8a9a887779d57c4be6`: 21 lines added
and 12 removed in `server/src/coord/store.ts`. This is the figure the review measured.

## R6: the cross-tree deviation scan, with its condition (the review's F5)

The Task 5 note now says I did not record the load at the first two runs. It adds the review's 33 of 34 with both heavy
slots held, and this round's result with its condition (below).

## The gate

This is the plan's Task 5 Step 4 list plus the lane-naming census (`coord-token`), one file per process on the test box,
at the tip of this round's code:

- All green: `landing-journal` (76), `landing-journal-store` (79), `landing-entry-store` (64), `landing-entry-census`
  (40), `landing-read-route` (32), `landing-writes-route` (36), `landing-line-order` (68), `landing-control` (59),
  `landing-terminal-damage` (64), `auth-gate` (394), `box-token-census` (80), `coord-pause-route` (27),
  `coordinator-skill` (290), `refusal-status` (28), `coord-token` (43), `secret-mask` (97, 1 skipped), `mail-routes` (61),
  `growth-check` (61, 3 skipped), `citations` (4), `anchors` (9) and `topology-clean` (61).
- The whole `single-definition/` directory was green: 44 files, 1592 tests.
- The server typecheck (`tsc --noEmit -p tsconfig.json`) was clean.
- `deviation-refs`, after `git fetch origin main`: 34 of 34 green. At its start the load average was 11.95 (16 CPUs), and
  `ccrc test --status` read: the test slice holding 1.9G of its 6.0G memory cap, heavy slots 2 of 2 held, 1 run waiting
  (12:16:34Z).
- The tests-inclusive typecheck did not run here, for the reasons the Task 5 note gives. The pull request's own run is
  its arbiter. No full suite ran locally.

## Other

- Merge probe before the push: `git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD` against main at
  `0a07d29f54cdcbaf7870d645625c1b3ffb3049d6` exits 0, so main was not absorbed.
- One push for the round, the third on this pull request. The pull request stays a draft. No deviation number is
  defined on the branch.
- During the round, another session sent a peer packet for `server/test/box-token-census.test.ts`, a file in my claim
  that this branch does not change. It changes one door row and one route count, and I answered yes.
