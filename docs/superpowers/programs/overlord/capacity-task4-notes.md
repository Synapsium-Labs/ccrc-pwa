# Capacity Task 4, the admission wake: notes (Overlord wave 189, run 2842)

This pull request adopts draft #3077 (W1-4, D-6095): when the concurrency cap refuses a coordinator's dispatch, the
run is stamped as waiting, and a lane mails that coordinator once a slot frees. It is Task 4 of
`docs/superpowers/plans/2026-11-19-waiting-workers-sleep.md`. It is stacked on Task 3 (run 2841, which adopts #3074)
and holds Task 3's diff until that lands. It brings in the draft's five commits, then reworks them against today's
`main` and Task 3's re-grounded cap reader.

## Departures from the draft

- **send-back-routes-packet.** The draft also stamps a send-back that the cap refused, from the advance route in
  `server/src/coord/routes.ts`. Another programme's frozen run holds that file. Under operator item 486, its holder
  accepted one exact additive packet against `main` (`963286cc9`): an import line and one call,
  `waitOnSendBackRefusal(coord, id, gate)`, placed between the gate and its refusal. The decision is
  `capWaitOf` (L1) and the act is `waitOnSendBackRefusal` in `server/src/coord/dispatch.ts`. The handler gains no `if`
  (ARCH-33's pin of four still holds) and no decision. Task 3 (run 2841) has its own packet, which rewrites the
  `overConcurrency:` line just above this call. Whichever lands second rebuilds its hunk; a rebuild that keeps the same
  two added lines needs no new packet. The route-level case is in `admission-wake.test.ts`, because the holder
  declined `run-routes.test.ts`.
- **dispatch-feed-row-dropped.** The draft wrote a record-only feed row from the dispatch route for every cap refusal.
  That would need a third `routes.ts` hunk. The dispatch refusal keeps its stamp and its journal line, both written
  inside `dispatchRun`. The console learns of the wait from the lane's `admission woken` feed row when the wake is
  sent. The coordinator ruled this (run 2842, the routes ruling).
- **capwaitof-in-admissionwake.** The draft put `capWaitOf`, the pure check that says whether a refusal is the cap's,
  in `server/src/coord/advance.ts`. That file is held under the same freeze, and its holder declined the edit. It is
  in `server/src/coord/admissionWake.ts` (L1) instead, with its test in `admission-wake.test.ts`, as are the draft's
  `advance-gate.test.ts` and `run-routes.test.ts` cases.
- **wake-observation-row.** The draft sent the wake through `queueSystemMail` and skipped a repeat by checking the
  feed. `queueSystemMail` skips only a mail that is still outstanding, so a wake the coordinator had already read could
  be sent again. The brief asks for the stall-notice pattern. `queueAdmissionWake` writes three things in one
  transaction: an observation row (`admission-woken:<claimant> refused=<lastRefusedAt>`), the mail and the
  `admissionWokenAt` stamp. The observation row is the once-only key, through `run_events`' per-run detail check. The
  observation writer gains a third predicate, `admission`: the run must still be idle, have a claimant, and its
  newest refusal must still be the one being woken. A run that moved or was refused again since the lane read it
  answers `run-gone` and is not written to. A refusal episode runs from the newest refusal to its wake. A refusal after
  the wake opens a new episode, so a coordinator refused again is woken again. The mail names its run (`runId`), so a
  run's close cancels a wake that has not been delivered yet.
- **wake-tx-own-file.** That transaction lives in a new file, `server/src/coord/admissionWakeTx.ts`, which follows
  `rundefsTx.ts`. `rundefsTx.ts` would be its natural home, but the same frozen run holds it. The new file is a handle
  holder in `single-definition/core-vocab.test.ts`. A follow-up may fold it into `rundefsTx.ts` once that file is free.
- **room-is-the-armed-reading.** The draft's room check subtracted every waiting run. Task 3 ships the cap reading
  in shadow behind the `cap-counts-working` row. `capsRoomOf` now leaves out waiting runs only when the reading is
  armed (`usage.workingOnly`). In shadow, the lane reads no worker facts, and only a slot freed in the ordinary way
  wakes anyone. Armed, a slot that a waiting or gone worker frees is room too. The brief makes this binding.
- **lane-file.** The draft wrote the lane's pass inside `server/src/watch.ts`, about 70 lines. Measured with
  growth-check armed, that grew `watch.ts` by 54 net code lines with Task 3's lines, over the limit of 40, and this
  run takes no waiver. The pass now lives in `server/src/coord/admissionWakeLane.ts` (L4, context C5), in the block-wake
  lane's shape: `FleetWatcher.sweepAdmissionWake` hands it the store, the listing, the serialiser, the worker-facts port,
  the lane's memory and the feed sink, and the pass decides nothing itself.
- **migration-slot.** The stack took slot 52 and the draft took 107. This PR takes 111: the next free slot by
  position after capacity Task 3's seed row (110), which it stacks on, with `main` at 109 when it last took `main`.
  Whoever lands second renumbers, under the coordinator's standing licence. The coord-db version pins and
  `run-close-switch`'s replay were counted again: one more undo line, and fifty-eight replayed migrations, Task 3's
  seed included.
- **lane-count.** `LANE_SCHEDULE` gains the `admissionWake` row beside `main`'s new `blockWakes` row, so the
  monotonic-clock pin goes to 55.
- **capacity-blocks-in-the-wake-tx.** The draft marked the claimant's `capacity` blocks woken from the lane, outside
  the mail's write. `main` now has the block-wake lane (D-8126 A6), which leaves `capacity` to this lane, and its rule is
  that a block is never woken without its mail. `queueAdmissionWake` therefore marks those blocks in the same
  transaction as the mail (`markBlockWoken`, the one writer of `wokenAt`).

## Follow-ups

- **hook-false-positive.** The session hook refused two of this run's calls as a "copy or recursive read" of the ccrc
  state directory. Neither read it. One was a `grep -v` pattern argument in a test run's output filter that held the
  directory's path as text. The other was a note append whose text named the path. The coordinator has recorded both
  as one hook follow-up.
- **wake-tx-into-rundefstx.** Fold `admissionWakeTx.ts` into `rundefsTx.ts` when that file's freeze ends.

## Not started

W1-4b (D-6096) and W1-5 (D-6097) are later tasks, and this PR touches neither.
