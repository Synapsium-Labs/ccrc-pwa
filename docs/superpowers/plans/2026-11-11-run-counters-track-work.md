# A run starts working when its worker takes its brief, and its tally says what it counts

- **D-8292 (2026-11-11)** — run counters track the work: a run at `dispatched` moves to `working` once its worker takes its wave brief (a delivery of the run's brief to the run's own session reached `ingestedAt` or was acked, the brief watch's "taken"), written by `CoordStore.startRunsOnTakenBrief` from the mail sweep through `advanceInner` as `causedBy: 'sweep'` with a `work-started:` detail; and the run row and its page header say `0/5 settled`, with the worker branch's commit count from the PR read beside it, labelled as that read.

## Why

#119 and #125 both measured the same misreading. One run read `items: {done: 0, total: 5}` while 58 commits had landed
on its branch, and another sat at `dispatched` for days while its worker was live and productive. Both counters were
read as "nothing is happening", and one of those runs was nominated for archiving on that evidence.

What `origin/main` wrote before this change:

- **`state`, `dispatched -> working`.** Only `POST /api/runs/:id/advance` with `{"to":"working"}`, the coordinator's
  call. The coordinator skill tells it to send that "once the worker is genuinely underway", and nothing else made the
  move, inferred or otherwise. A coordinator that went straight from dispatch to waiting on `wave-done` left the run at
  `dispatched` for the whole wave.
- **`items.done`.** `itemTally`, the count of items the coordinator acked `done`, which it does after a verified
  advance (spec 2026-10-20 §3.3, D-5914). This is by design, and `RunSummary.items`' docstring says so. The worker skill
  has no item verb, so a wave in progress reads `0/N` however far its branch has moved. The row drew a bare `0/5` that
  said none of this.

## Change

- `coord/briefwatch.ts` (L1): `BRIEF_TAKEN_START_PREFIX` and `briefTakenStartDetail`, beside the brief watch's own
  definition of a taken brief. The move's detail reads `work-started: the worker took its wave brief (delivery N,
  ingested|acked)`.
- `coord/store.ts`: `startRunsOnTakenBrief()` selects every run at `dispatched` with a taken brief delivery to the
  run's own session, and moves each to `working` through `advanceInner`, the one state writer, in one transaction.
  The sender is not read, so a brief the coordinator sent by hand after a refused `/clear` counts too. Only
  `dispatched` is selected, so a run that went on to review is never sent back and a closed run is never moved.
- `watch.ts`: the mail pass calls it once, after the revive and before the empty-queue return, so a brief acked
  through the route with nothing else outstanding still starts its run. An ingest edge sampled later in the same pass
  starts it on the next pass, one mail sweep later. It is a store-only act: no new read, no fleet act, no new loop.
- Coordinator skill (`wave-lifecycle-4-advance.md`): a `{"to":"working"}` that answers `bad-transition` with `from:
  working` means the server already made the move.
- PWA: `itemTallyLabel` reads `0/5 settled`, and `itemTallyTitle` says what that counts (not commits and not branch
  progress). `branchCommitsNote` is the one reader of the worker's `pr.ahead` on a run row: `58 commits`, titled as
  the pull request read's count. It draws only a positive count on an open run whose worker session names the run's
  branch. `RunRow` and the run page header draw both, and the header stays a superset of the row (D-5545). Checked in
  Chrome at 360, 390, 1280, 1470 and 1920, both skins and both themes (`run-tally.browser.test.ts`).

## Deviations found

- The ticket suggested inferring the move from the worker's first turn or its first push. The brief watch already
  records both halves of "the worker started a turn on its brief" (`ingestedAt` from the `UserPromptSubmit` edge after
  the nudge, and the ack), so that is the signal. A push needs a branch read the server makes only through the PR
  sweep, and it would leave a worker that is reading and planning reading `dispatched`.
- `items.done` is not changed. It stays the coordinator's settled count (D-5914). Counting commits as items would make
  progress up. The branch count is shown beside the tally as its own fact instead.
- `pr.ahead` reads an unmeasured branch as 0 (`phaseFor`), so 0 draws nothing rather than "0 commits".
- The worker heartbeat (`workerLastSeen`, D-8285) is a separate PR. This one neither reads nor changes it.
