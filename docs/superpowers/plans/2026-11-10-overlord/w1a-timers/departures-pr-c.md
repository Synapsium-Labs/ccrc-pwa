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
  and r1's notice read the one pick (since fix round 1, r1 alone names it: only-r1-names-the-timer below). `stallTimerHold` times it against the ladder that decides r1
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

### Fix round 1 (review 2053 at 960102ce8)

- **unbuilt-row-waits** (F1, the coordinator's ruling: wait) — a row the tick's listing named but `buildRecord` left
  unbuilt is not measured, so its timers wait whatever its `.generation` reads: nothing fires, nothing is cancelled. The
  plan's narrower rung (wait only for an `absent` stamp and a listed row) is replaced by the Review Focus's wording. The
  lane takes the tick's listing through `timerListingOf` (`timerLane.ts`), whose `unmeasuredIds` name each listed id with
  no built record and, by the same fold, each record whose plain fields (`.archived` among them) read unreadable, so an
  archive state that was never read waits too. `sweepTimers` in `watch.ts` now passes the tick's facts to it.
- **timer-mail-never-pushes** (F2, ruled: no push) — a fired timer is a session's own reminder, not news for the operator:
  `pushNewMail` records mail from the role `timer` and never pushes it (its `recordOnly` set), pinned in
  `push-copy.test.ts` beside the run-close warning's case.
- **only-r1-names-the-timer** (F3: the fallback the coordinator allowed) — r1's check mail names the timer that held it;
  r2's report and the r3 push no longer do. The plan's Task 9 says all three notices name it. They cannot do that
  faithfully from the current facts, because r1's own delivery moves the quiet start the line is computed from. Naming
  it there would need a row of r1's own, and a new form of `run_events.detail` for that row is read as unknown by an
  older build's `parseStallDetail`, so the cost was a reader change and a rollback case. The stale comment on
  `stallQuietFrom` is corrected, and the test now pins that r2 and r3 carry no timer line even when r1 changed nothing.
- **sim-reads-what-the-lane-read** (F4) — each `fire` line in `timerDay.ts` carries `read=`, `bornAfter=` and
  `listing=`, and T2 now passes a fire only on a measured read equal to the stamp, of a row the listing named and built,
  set before the listing began. T4 now counts every `setter-gone` on a row that still carries the timer's stamp, whether
  or not the listing named it. A pass that throws records a `threw` line, and T5 reds on a throw with no fault armed. The
  world now models four more cases:
  - a listed, unbuilt row whose `.generation` already reads its own stamp (`unbuilt-matching-wait`);
  - a listing that was not read (`listing-unread-wait`);
  - a new row that sets its first timer while it is still being made (`being-made-wait`);
  - a listing up to 45 s older than its pass.

  The cleanup mutants K1 and K6 now die in the simulator on T2, and K3 on T4, as well as in `timerSets.ts`'s unit cases.
- **revive-of-a-recycled-id** (F5: recorded, not changed) — a revived run-bound timer mail carries no check of its
  recipient's incarnation: if a setter's id were recycled while its run is still open, the new session would get the old
  setter's reminder. The same exposure holds for every run-bound mail addressed to a literal session id (a live-again id
  is read as a later incarnation of the same recipient), so `timer` stays out of `REVIVE_SKIPPED_SENDERS`: the reminder
  is still owed.
- **cancel-isolated-and-race-is-a-skip** (F6) — each cleanup `cancelTimer` runs in its own try: a thrown write is logged,
  counted in `failed`, and the pass goes on. A fire that rolls back because a timer it carried is measured no longer
  pending (a setter's or the operator's cancel between the gather and the pass) is counted in `skipped` and logged as
  skipped, not failed; the re-read is `pendingTimers`, and a read that fails counts as a failure. A setter missing from
  the gathered stamps waits (pinned).
- Notes from F6, recorded with no change:
  - The earliest pending timer outranks a fired one, so a 30-day reminder pending raises r1's threshold to about 24 hours
    in every episode until it fires. The plan's 40-hour case rules it.
  - An overdue pending timer is named when the limit hold or `mail-disabled` delayed r1.
  - W1's Overlord setter has no `.generation` of its own, so W1 must branch before `incarnationOf`, or such a setter
    reads absent and unlisted, and is cancelled `setter-gone`.
  - The mail's `at` comes from `Date.now()` in `insertMail`, a few ms after the pass's `firedAt`; nothing compares the two.

### Rollback (measured before merge)

- **no-rollback-wait, measured** — at `v0.0.1164`, the oldest version kept on the fleet box, `mailSender` reads a role
  only for `coordinator` (so `timer` is read as a session id: one park notice and a push for it, as Task 7's
  characterization pins), and `dueDeliveries` selects queued deliveries by state with no sender filter, so a queued timer
  mail is delivered by the older lane. Two more consequences there, both bounded to mail already queued (review 2053 F6):
  that build's stall watch counts a delivered run-bound timer mail as an exchange (its `relevant` has no timer filter),
  and its park notice addressed to `timer` itself parks (no registry row), so the escalation pushes `✉ blocked › timer`.

## Growth (PR C)

Measured against the merge base before the push: `server/src/watch.ts` +16, `server/src/coord/store.ts` 0.
