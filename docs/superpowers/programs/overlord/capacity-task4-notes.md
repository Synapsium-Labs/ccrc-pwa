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
  That would need a third `routes.ts` hunk. No refusal writes a feed row, the dispatch's or the send-back's: each keeps
  its stamp and its journal line (the dispatch's inside `dispatchRun`, the send-back's through `waitOnSendBackRefusal`).
  The console learns of the wait from the lane's `admission woken` feed row when the wake is sent. The coordinator ruled
  this (run 2842, the routes ruling) and, on review 2907's F2, amended W1-4's exit gate to read: "every refusal (dispatch
  and send-back) is a journal line; every wake is a journal line and a feed row". The plan text and D-6095's wording are
  left as they are here; the coordinator carries that amendment into W1-4b.
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
- **migration-slot.** The stack took slot 52, the draft took 107 and this PR first took 111. Door B1 (#3099) then
  took 110 and capacity Task 2 (#3101) took 111, and Task 3's seed moved to 112, so this PR takes 113: the next free
  slot by position after Task 3's seed, which it stacks on, with `main` at 111. Whoever lands second renumbers, under
  the coordinator's standing licence. The coord-db version pins read 113, and `run-close-switch`'s replay was counted
  again: one more undo line (the three admission columns), and sixty replayed migrations, 54 through 113. The comment
  there now also names 111 and 112, the two seed rows that go with `lane_arm_settings`, which `main` had not listed.
- **lane-count.** `LANE_SCHEDULE` gains the `admissionWake` row beside `main`'s new `blockWakes` row. `main` then added
  the `mailHold` row (mid-turn mail PR 4, #3087), and the absorb kept both, so the monotonic-clock pin goes to 56.
- **capacity-blocks-in-the-wake-tx.** The draft marked the claimant's `capacity` blocks woken from the lane, outside
  the mail's write. `main` now has the block-wake lane (D-8126 A6), which leaves `capacity` to this lane, and its rule is
  that a block is never woken without its mail. `queueAdmissionWake` therefore marks those blocks in the same
  transaction as the mail (`markBlockWoken`, the one writer of `wokenAt`), on the recorded arm only: a duplicate sends
  no mail, so it wakes no block (review 2907 F7). It still re-marks the run's own woken stamp, so a waiter whose wake is
  already recorded leaves the eligible list and does not spend the wake budget on every pass.

## Mutants

Each guard was mutated by hand, one at a time, and the admission-wake suite run against it; all 17 are killed by an
assertion, none by a timeout. M15 and M16 were added in fix round 1 (review 2907).

| Mutant | Guard | Result |
|---|---|---|
| M1 | a move clears the wait | 3 failed |
| M2 | the stamp keeps the oldest wait | 2 failed |
| M3 | a waiter refused again after its wake is eligible | 3 failed |
| M4 | the observation needs the same refusal | 3 failed |
| M5 | a duplicate re-marks the woken stamp | 2 failed |
| M6 | in shadow a waiting worker holds its slot | 1 failed (the room cases, added for it) |
| M6b | armed, a waiting worker frees its slot | 1 failed |
| M7 | the pause and mail-disabled markers stop the pass | 1 failed |
| M8 | a refused dispatch stamps | 2 failed |
| M9 | a refused send-back stamps | 2 failed |
| M10 | the claimant's `capacity` blocks are marked | 1 failed |
| M11 | no more wakes than the room | 5 failed |
| M12 | no more wakes than the budget admits | 1 failed |
| M13 | the observation key is the refusal | 3 failed |
| M14 | the advance route calls the send-back half | 1 failed |
| M15 | a duplicate wakes no block (review 2907 F7) | 1 failed: the block's `wokenAt` |
| M16 | `wakeAdmitMany` has one caller (review 2907 F4) | 1 failed: the window pin |

## Follow-ups

- **hook-false-positive.** The session hook refused two of this run's calls as a "copy or recursive read" of the ccrc
  state directory. Neither read it. One was a `grep -v` pattern argument in a test run's output filter that held the
  directory's path as text. The other was a note append whose text named the path. The coordinator has recorded both
  as one hook follow-up.
- **wake-tx-into-rundefstx.** Fold `admissionWakeTx.ts` into `rundefsTx.ts` when that file's freeze ends.

### Carried from review 2907 (no edit in this PR)

- **F3, to W1-5.** A `capacity` block is woken only inside a wake. A block recorded after its run's wake, or by a
  coordinator with no eligible waiter, stays live until its 24-hour lapse, and while it is live the coord-ball rung is
  silent for that coordinator. One wake also wakes every `capacity` block of the claimant, not only the woken run's.
  W1-5 wakes a block at record time when room exists and scopes the block wake to the woken run.
- **F5, to the arming card.** Armed only: `capsRoomOf` counts a slot the worker readings free as room, but the dispatch
  door hands it out only when the freed-slot window admits it. If the window refuses, the coordinator is refused again,
  re-stamped and woken again on the next pass: a repeated room mail, bounded by the wake budget, with no back-off.
- **F6.** A queued wake mail is cancelled only by a run close. A dispatch or send-back the coordinator made itself leaves
  it to be delivered; acting on it meets `bad-transition` before any fleet act.
- **A-N2.** Eligibility is a strict `admissionWokenAt < lastRefusedAt` on wall-clock times, so a refusal in the same
  millisecond as the wake, or after a backwards clock step, waits for a later refusal.
- **A-N3, A-N9.** The wake budget and the programme's served time are spent for each chosen waiter even when its write
  then answers `run-gone` or throws; `memory.served` is never pruned.
- **feed-row-project.** The `admission woken` feed row's `project` is empty, so it is not decorated with its project
  when several are active.
- **A-N6, A-N7.** The pause and mail-disabled markers come from the tick's listing and are not re-read inside the
  serialiser (as in the block-wake lane). The lane does not hold on `stall-watch-disabled`, which holds every other block
  wake, so `capacity` blocks are the one kind woken while it stands.
- **B-N1.** Small decisions outside L1: the hold rule inline in the lane, the inline cap-refusal test in `dispatchRun`
  beside `capWaitOf` (with `halt.limit ?? 0`), `sendBack: state !== 'planned'` in the store, and the `wakeOn ===
  'capacity'` filter in the transaction.
- **B-N2.** The waiter predicate is written twice in SQL (`admissionWaiters` and the observation's `admission` arm); only
  that arm's `lastRefusedAt = ?` condition is pinned by a test.
- **B-N4.** `admissionWakeTx.ts` declares L3 beside a model file that declares nothing.
- **B-N6.** The lane-schedule test's table of coordination lanes does not list `admissionWake`; its row is pinned in
  `admission-wake.test.ts`.

## Not started

W1-4b (D-6096) and W1-5 (D-6097) are later tasks, and this PR touches neither.
