# The automatic roll: the serialiser is never held across its ccd call, and a roll that woke nothing gives its wake back, ruled

## Deviations found

- **D-7541 (2026-10-30)** — the automatic roll holds the coordination serialiser only around its store reads, never across ccd hibernate --roll
- **D-7542 (2026-10-30)** — a roll ccd refused or whose wake failed gives its wake-budget slot back

**Why.** Review of the automatic coordinator roll (D-7452, D-7458) found five defects. This file records the two that
change a rule (the D-numbers above) and the two that fix ccd's words. The fifth, the Settings card's copy, is the
card's own change.

**D-7541, the serialiser.** The roll's act ran inside `port.serial`, the ONE coordination mutex (`CoordMutex`, handed to
the sleep executor as the stop-done lane's serialiser), for the whole `ccd hibernate --roll` call. That call now
includes `cmd_ensure`'s pane wait, and the runner's bound for `hibernate` had been raised to 300 s, so a slow or hung
roll blocked every coordination write fleet-wide for up to five minutes. Now:

- `sleepLane.ts`'s `sleepAct` still has ONE act site for every sleep lane, but a `wake` lane's act is three steps:
  1. on the serialiser and the session's queue: the record re-read, the verdict asked again, the verb, the switches
     over a fresh listing (D-7047) and the wake budget;
  2. on the session's queue only: the ccd call, so nothing else writes to that session while it is rolled;
  3. only for a roll that landed, on the serialiser and the queue again: the target asked again
     (`asks.afterAct`; for the roll, the Settings row and the row's role, read fresh). A target that stopped being
     one while ccd ran is journalled beside the roll: `rolled <id> … ; by the time ccd answered it was no longer a
     roll target (<word>)`. The roll happened either way, so the outcome stays `rolled`, with `after`.
- Each step takes the serialiser before the queue, the order every other holder takes them in, so the split adds no
  lock-order inversion.
- The two sleep lanes (`stay-asleep`) keep holding both across their plain `ccd hibernate`, which is a re-measure and a
  kill. So the runner's 300 s bound is keyed on `--roll` now (`CCD_ROLL_TIMEOUT_MS`), and a plain hibernate is back on
  the flat 90 s. The comment that said the larger bound "costs it nothing it uses" is gone: under the serialiser, it
  did cost something.
- Red first: `roll-lane.test.ts` "a coordination write issued while the roll call is in flight is not blocked by it"
  (a real FIFO mutex, the ccd call held open: the old act timed out at 500 ms), the after-call rows (the setting turned
  off, the row no longer a coordinator, and a control), and `remote-runner.test.ts`'s two plain-hibernate rows at 90 s.

**D-7542, the wake budget.** `admitWake('auto', id)` was spent before the act, and nothing gave it back. A roll that
ccd refused (`session-busy`) or whose wake failed still counted against `WAKE_BURST` for a minute and stamped the
session's last wake, which delayed the mail lane's own wake of that session by `MAIL_WAKE_FLOOR_MS`. Now:

- `coord/wakeBudget.ts`: `wakeRefund(recent, at)` (L1, pure) takes ONE admission back out of the window, and
  `WakeAdmission` is the handle.
- `FleetWatcher.admitWakeRefundable(id)` admits and records exactly as `admitWake('auto', id)` does (one clock read
  for both), or answers null. Its `refund` takes the admission back and puts the session's last wake back as it stood.
  A second refund does nothing. The roll's act port uses it.
- The act refunds when the answer woke nothing: ccd refused it; the call failed before anything stopped, or never
  started; the pane would not die (exit 6); or the wake failed and ccd put the row back to sleep (exit 4). An
  unrestored wake (exit 5) and an unknown ending keep the slot spent, because the unit may still bring the session up.
  A throw before the call refunds; one after it does not.
- Red first: `wake-budget.test.ts`'s `wakeRefund` rows, `roll-wake-admission.test.ts` (the watcher), and the
  `roll-lane.test.ts` refund rows.

**The ccd fixes (D-7458's verb).**

- A pane kill that leaves the pane live is not a roll. After the kill, `cmd_hibernate --roll` asks `_alive`. On a live
  pane it prints `ccd: roll-kill-failed — …` and exits 6, never `rolled`, and no wake is tried. The server reads the
  phrase as its own outcome, `kill-failed`, whose line says it was not rolled and names the session to check. The kill
  line itself is unchanged, so `ccd-operator-choice.test.ts`'s stop census still holds.
- The exit-4 line said "put back to sleep" even when the unit could not be stopped again, because `_ws_unsupervise`
  swallows a failed `_svc_disable_now`. Its status stays 0 (`ccd-session-state.test.ts` pins that), and it now also
  leaves the answer in `_WS_UNSUPERVISE_DISABLED`. When the put-back's disable fails, the roll takes the unrestored
  branch: exit 5, `roll-wake-unrestored`, "its unit claude-session@<id> could not be stopped again".
- Red first, in `ccd-hibernate-roll.test.ts`: the kill-failed row and its control, and the failed-disable row. The
  fixture's stub `tmux` now reports the pane gone once a `kill-session` has been called, as a real one does.

