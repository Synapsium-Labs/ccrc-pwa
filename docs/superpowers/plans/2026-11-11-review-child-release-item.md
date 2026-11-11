# A review child past its ceiling is an item with its own control

- **D-8293 (2026-11-11)** — review child ceiling, the release: past `REVIEW_CHILD_CEILING_MS` (D-5942) the child reclaim sweep raises one Waiting on you item per review run (`release-review`, raised by ccrc, held first for the reviewed run's coordinator), whose one control, Release workspace, is the operator's `POST /api/items/:id/act`; the act is the release, which the sweep reads back (`CoordStore.reviewChildReleased`) so the run it reviewed no longer keeps the workspace.

## Why

D-5942 (spec 2026-10-20 §2.6) bounded how long a review child is kept quietly: once the review's own run has been closed
seven days while the run it reviewed stays open, the verdict answers the kept word `review-report-stale` and the banner lists
the child. That only names the keep. The one way to end it was closing or abandoning the reviewed run, and the banner's kept
line is a report with no control on it. A reviewed run left `awaiting-review` for weeks kept every review child of it on disk,
and the operator could read that but not act on it. The ruling of 2026-11-04 is that an item waiting on the operator carries its
own control.

## What changes

- `shared/ledgers.ts`: a third `ItemAction`, `release-review` (`runId` is the reviewed run, `reviewRunId` the review run that
  minted the child, `sessionId` the child). Its `act` abandons nothing (`actAbandons` is false for it); it has no `decline`.
- `server/src/coord/reviewRelease.ts`: `reviewReleasePlan` decides, per judging pass, which items to raise (one per review run,
  ever) and which open ones to settle (the child is gone, or a definite verdict no longer keeps it for that run; a doubt or a
  hold settles nothing). `routeReviewReleases` raises the item through §10's writer (`raiseItemWithMail`) with the
  coordinator-first hold (`askNotifyAt`) and a notice naming the item, the way a refused close is told and held (D-8077), or
  at once when the run has no coordinator; and settles. Called from the sweep after its verdicts (`watch.ts`).
- The item's `runId` is the reviewed run, so that run's close settles the item as every action item of a run is settled
  (`settleEndRequestsInTx`).
- `POST /api/items/:id/act` on a release-review item moves it `act` (open to done) and nothing else: no run moves and no fleet
  act runs. Held, or not open, it is refused `not-open`.
- `CoordStore.reviewChildReleased(reviewRunId)` is the one read of the release: a release-review item of that review run that
  the operator's `act` closed. No new table: the item's own move is the fact. `childReclaimReviewedRun` carries it as
  `released`, and `childReclaimSweepVerdict` then stops keeping the child for the run it reviewed, exactly where a superseded
  report does (D-6922); every other keep still answers first.
- The release never deletes a child's work: the sweep's ordinary reclaim takes the workspace, and `ws-reclaim` pins its
  commits and uncommitted work under attic refs before it removes anything.
- `review-report-stale`'s sentence says Release on its item releases it too.
- The PWA: `ReleaseReviewControls` on the Waiting on you row and the item page (`ItemControls`), opening
  `ReleaseReviewSheet`. The sheet and Keep the run's now share one `ItemActSheet` (the markup census). The row is laid out
  by the existing `data-acts` rule: below 640 px (a 390 px phone) the control sits on its own line under the row; from 640 px
  (a 1280 px laptop, a 1920 px wide screen) it sits at the row's right.

## Deviations found

- Spec 2026-10-20 §2.6 said "the release is the existing act" (the reviewed run's close) and rejected a coordinator "release
  review child" verb. Amended there: the operator's Release on the item is a second release, the operator's act on an item the
  sweep raised. Still no coordinator verb: a coordinator ends the keep by closing or abandoning the reviewed run, and keeps a
  report it still cites by withdrawing the item inside the hold. An item is raised once per review run and never again, so a
  withdraw is not undone by the next pass.
- §2.6 also added no coordinator notice. The notice here is the item's hold notice (D-8077's tell-and-hold, through
  `insertSystemMailTx`), so it is the existing mechanism, not a second notifier.

## Tests

- `server/test/review-release.test.ts`: the verdict reads the release; the action's reader; the item is raised once, held,
  the coordinator is mailed its id, or unheld with no coordinator; settle on gone or handled, never on a doubt or a hold; the
  reviewed run's close settles it; `reviewChildReleased` after the operator's act only; the act route releases and runs no
  fleet act, and refuses a held item and a decline.
- `server/test/child-reclaim-sweep.test.ts`: through the watcher, past the ceiling the item is raised once, and after Release
  two sightings ask for the ordinary reclaim.
- `pwa/test/waiting-screen.test.tsx`, `pwa/test/item-view.test.tsx`, `pwa/test/api.test.ts`: the control, its sheet, a refusal
  in the sheet, a saved copy disabled, the call's URL.
