# The automatic roll: asked again beside its call, a throw after the call is never a failure, and a row that will not roll is held off, ruled

## Deviations found

- **D-7552 (2026-10-30)** — the automatic roll is asked again beside its ccd call, a throw after the call is never a failure, and a row that will not roll is held off

**Why.** A second review of the automatic coordinator roll (D-7452, D-7458, D-7541, D-7542) found four defects. Three
change a rule (D-7552 above). The fourth fixes a journal line.

**The act is asked again beside its call.** D-7541 split the roll's act into three steps. Step 1 ran the reads on the
serialiser and the session's queue, and then released the queue. Step 2 took the queue again for the call. Anything
queued on that session while step 1 ran (an operator prompt sent, an ask answered, a dialog picked, mail delivered)
therefore ran between the last server-side check and `ccd hibernate --roll`. Only ccd's box-local re-measure stood
between a prompt that had just been submitted and the kill. Now:

- `sleepLane.ts`'s `sleepAct`, step 2: in the same turn of the session's queue as the call, and without the
  serialiser (which D-7541 keeps off the call), every read but the wake budget runs again. That is the record re-read
  and the row assembled from it, the verdict asked again over a fresh live read, the verb, and the switches over a
  fresh listing (D-7047).
- If the answer is no longer a roll, ccd is not called, and the wake admitted in step 1 is given back (D-7542).
- Red first, in `roll-lane.test.ts`: a task queued on the session during step 1 sets it busy, and a kill switch is
  raised during step 1. A real per-id FIFO queue stands in for `KeyedQueue`. A control row has nothing queued. The
  row "the reads before and after the call run on the serialiser" now also pins the third read, which is off the
  serialiser: `[true, false, true]`.

**A throw once ccd has been called is never "it was not stopped".** Step 3 asks the target again after a roll that
landed (`afterAct`, which calls `rowAtAct`, io over the agent link in remote mode). A throw there reached the outer
catch, which answered `failed`. `rollPass` then wrote "failed at its hibernate …; it was not stopped" about a session
that had been stopped and woken onto the new release. Now:

- Step 3 has its own `try`. A throw there is the re-ask unmeasured (`after: 'row-unmeasured'`, the word `afterAct`
  already gives a row it could not re-read), and the outcome stays `rolled`.
- For `setting-unreadable` and `row-unmeasured`, the rolled line says "once ccd answered, whether it was still a roll
  target could not be read again (…)". It no longer says "it was no longer a roll target", which it could not know.
- In the outer catch, a `wake` lane's throw once ccd was called is `outcome: 'unknown'`. Its line names the session to
  check, and the admission stays spent. A throw before the call is still a plain failure, and the admission is
  refunded.
- Red first: `rowAtAct` rejects once the call has returned, and the call itself throws. A control row has a throw
  before the call.

**A row that will not roll is held off.** The roll lane spent its one act a pass (`ROLL_PER_PASS`) on the first
eligible coordinator in frame order, whatever the act came to. The server's idle gate cannot see a draft in the input
box or an attached terminal, so a coordinator with a lasting draft was picked every pass. ccd refused it every time
(`session-busy: draft`), and every coordinator after it waited as `one-per-pass` forever. That broke the ruling that
every idle coordinator is rolled. Now:

- `ROLL_LANE.retry` is `hold-off` (`ROLL_HOLD_OFF_MS`, one hour, in `RollSweepMemory.heldUntil`), as stop-done's is.
  A row ccd refused, a failed call, a throw, or an unknown ending leaves the population for an hour. So does a row
  held at the act: for a `wake` lane only, `sleepAct` also holds off a row the act re-ask held, at step 1 or step 2.
- The next coordinator in frame order gets the next pass's act.
- A switched-off hold and a full wake budget still hold nothing off. Both hold every row alike, and D-7047 keeps
  switched-off holds free of retry memory.
- `sleepPass`'s `recorded-rows-in-frame-order` population now leaves out rows in retry, as
  `dispatched-children-by-id` already did. Only a `hold-off` lane has any, so idle-hours is unchanged.
- With the executor no longer pruning the roll's line memory (a `hold-off` lane prunes only its own map), `rollPass`
  prunes `lastAt` and `lastWhat` of ids the pass no longer sees.
- Red first: across two passes, the first coordinator's ccd always answers `session-busy: draft` and the second must
  be rolled. The same holds when the act re-ask holds the first coordinator. A control row checks that the held-off
  coordinator is asked again once its hold-off ends.

**The unrestored line (D-7458's words).** ccd exits 5 (`roll-wake-unrestored`) on two branches: `.hibernated` could not
be written again, or the unit could not be stopped again (the disable-failed branch). The server's line always said "ccd
could not write its hibernated marker again", which is false on the second branch. It now says "ccd could not put it
back to sleep, so it was not restored", and ccd's own stderr in the parentheses gives the cause. Red first: a row with
the unit-branch stderr (`ccd-hibernate-roll.test.ts`'s), and a control row with the marker branch.
