# Overlord W1a, timers PR C: departures from the plan (Tasks 7 to 9)

Each departure from `w1a-timers.md` is named by a slug. No D-number is taken here: the coordinator folds these into the
programme's ledger. This note sits beside `departures.md` (PR A's, which this pull request does not edit: the ledger guard
keeps an existing plan file to the ledger branch), as launch profiles PR B's `departures-pr-b.md` does. The spec
departure this PR builds, **stall-notice-names-no-note**, is in `departures.md`'s spec list.

## PR C: the timer sender, the lane, the stall hold (Tasks 7 to 9)

### The timer sender (Task 7)

- **role-readers-measured** (Step 2) — the readers of a role sender, measured at the merge base: `FleetWatcher.mailSender`
  (`watch.ts`: the park notice and the sender push), `CoordStore.runLastMoves` (`store.ts`: `MAIL_ROLE_IDS` in its
  `NOT IN`), `REVIVE_SKIPPED_SENDERS` (`mailRevive.ts`, typed by `SystemMailSender`) and `insertSystemMailTx` /
  `queueSystemMail` (`rundefsTx.ts`, typed by it). `shared/api.ts#ASK_OPERATOR_PRINCIPAL` deliberately does not derive from
  the map, and nothing in `pwa/src` reads it. `POST /api/mail` refuses `fromId: 'timer'` as `unknown-sender` (no registry
  row), pinned before and after the row.
- **role-sender-cases-in-one-file** — the characterization (green on `main`, its own commit) and the flipped pins live in
  the new `mail-role-senders.test.ts`, the revive's two cases included, rather than split into `mail-revive.test.ts`, so
  the one file holds what every reader does with the role. `run-last-move.test.ts`'s role-list pin gains `timer`.
- **escalation-push-names-the-recipient** — a parked timer mail mails no park notice and pushes nothing tagged `timer`;
  the park's one operator escalation (`escalatePark`) still pushes, tagged with the recipient, as it does for every role.

### The lane (Task 8)

- **run-and-programme-read-in-the-pass** — the bound run's state and the programme's `planEnd` are read synchronously in
  the pass, right before the cleanup decides, rather than in the async gather; the gather keeps the pending read and the
  stamps. Each run is read once a pass.
- **run-row-absent-waits** — a bound run whose row does not read (a failed read, or no row) is `unmeasured`, so its timer
  waits; runs are never deleted, so no row is a fault, never a close.
- **programme-row-absent-reads-ended** — `programmeLive` answers false for a programme with no row as for one whose
  `planEnd` is set, so such a timer is cancelled `programme-ended`. The set door refuses a programme that is not live
  (bound-key-must-be-live), so no timer binds a programme with no row; a read that throws waits.
- **due-is-the-passs-clock** — `dueAt <= now` is the pass's own selection of the `keep` timers to pack, with `now` from
  `Clock.wall()` after the gather.
- **sim-lends-mail-clock** — the store's mail insert stamps `at` from the ambient clock (`insertMail`), which the lane does
  not own and the simulator stubs to a thrower, so `timerDay.ts` lends the pass the server's wall clock for its length.
- **sim-crash-is-a-write-that-aborts** — a crash inside a pass is a trigger that aborts every write to `mail` and
  `continuity_timers` past a drawn count (`generationDay.ts`'s shape); the scenario then crashes the server. 32 seeds in CI.
- **watcher-level-cases** — `continuity-timer-lane.test.ts` also drives `FleetWatcher.sweepTimers`, so the "read the
  listing from `records`" mutant (Step 6) is caught where it would be written.

### The stall hold (Task 9)

- **hold-answers-its-timer** — `timerHoldUntil` answers `{ id, dueAt, until }` or null, not the time alone, so the verdict
  and the three notices read the one pick. `stallTimerHold` times it against the ladder that decides r1
  (`stallR1QuietFrom`, and the marker ladder's back-off or the resolved quiet time).
- **hold-gates-r1** — the hold answers at step 10's quiet rung when r1 is due, in both ladders. A held r1 sends nothing,
  so r2 and r3, which follow r1, do not come either; once r1 is sent, the hold plays no part.
- **pending-holds-until-it-fires** — a pending timer holds while it waits: until its `dueAt` plus one quiet period while
  it is not yet due, and to the cap once overdue (the lane is held or a pass behind). Fired, it holds until `firedAt` plus
  one quiet period.
- **stall-timers-laundered** — `stallTimersOf` maps the store's hold read to `StallTimers` with the ids and times only, so
  a note never enters `stall.ts`; a failed read, or a fired row with no fire time, is `unmeasured`.
  `stallTimerFiredSince` spells the read's `now - TIMER_HOLD_CAP_MS` beside the cap.
- **timer-hold-floor** — `timerHoldUntil`'s cases are written once in `sim/timerSets.ts` (seven mutants, floor 1) and run
  on the real module by `stall-timer-hold.test.ts`. The lane-level cases are in `stall-sweep.test.ts`: the real lane pass
  fires the timer and the real `sweepStalls` holds its check.

### Rollback (measured before merge)

- **no-rollback-wait, measured** — at `v0.0.1164`, the oldest version kept on the fleet box, `mailSender` reads a role
  only for `coordinator` (so `timer` is read as a session id: one park notice and a push for it, as Task 7's
  characterization pins), and `dueDeliveries` selects queued deliveries by state with no sender filter, so a queued timer
  mail is delivered by the older lane.

## Growth (PR C)

Measured against the merge base before the push: `server/src/watch.ts` +16, `server/src/coord/store.ts` 0.
