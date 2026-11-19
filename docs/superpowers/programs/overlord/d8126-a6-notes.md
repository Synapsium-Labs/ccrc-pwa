# D-8126 wave A6: notes for the ledger

Wave A6 of `docs/superpowers/plans/2026-11-09-coordinator-autonomy-default.md` (the detectors that act: the coord-ball
mail rung, dark; the nudge's run holds; block wakes; the R7 count), built on `main` for the Overlord programme (#2491).

## Where it came from

The wave was first built on an unreviewed handoff branch, ten commits from "coord-ball mails the coordinator before
anyone pushes the operator, dark" to "block wakes run on their own lane". That branch's base was 446 commits behind
`main`. This PR ports those commits onto today's `main`. Every ported line runs under this wave's tests on `main`:
with the source change reverted, the new tests fail (measured, below).

- The stack's A3 (the call record) matches the A3 that merged as #2606, apart from main's later `callText` export and
  the migration number in a comment. So the wave builds on main's A3 unchanged: `wokenAt`, `build` and `markBlockWoken`
  are already there.
- **No migration.** The wave adds no table or column, so it takes no migration slot and moves no coord-db pin.
- The stack's final re-pin commit carried no A6 hunk that main still needs. The lane count and the port's member list
  were re-derived here against main (53 lanes, six new port members).

## What was rebuilt rather than ported

- **Growth.** The stack grew `watch.ts` by 161 net code lines and took `stall.ts` past its D-8635 cap (1619 against
  1603). The deciders now live in a new L1 file, `coord/coordBall.ts` (the rung's decider, its two derived facts and the
  R7 predicate). The reads live in `coord/coordBallLane.ts` (the rung's input, the nudge's open-run fact, the R7 notice
  and the ball-only claimants) and `coord/blockWakeLane.ts` (the wake pass). The wake's level mapping, its clearing
  half and its mail words are in `coordCalls.ts` (L1). Measured by the growth check's own counter: `watch.ts` +37,
  `stall.ts` 1586 (cap 1603), `store.ts` +4 against the merge base. No waiver.
- **`a6-claimed-runs-through-the-binding`.** The stack added a store read, `openRunsOfClaimant` (`WHERE claimedBy = ?`),
  and split `stallCandidates`' cast-and-prove to share it. That is a fifth session-keyed binding reader, which ARCH-62's
  census caps at four. The claimed runs are read instead from the binding's own series (`bindingRunsOf`, then
  `runsClaimedBy`, then `run(id)`), as `newestClaimedWorkRuns` does, so `store.ts` gains only the four one-line
  delegations.
- **`a6-wake-turn-in-l1`.** The stack's lane compared the turn marker's start with the row's time. `blockWakeDue` now
  takes `lastTurnAt` and decides that itself, so the lane decides nothing.
- **Two `NOT_BINDING_SITES` rows** (`runSessionCensus.ts`) name `coordBall.ts`'s two mail checks: a delivery to the
  coordinator, and a mail it sent. No run is read there.

## Slugs (departures and readings; the coordinator mints numbers)

- `a6-block-wakes-own-lane`: P7 serves the wakes from the stall watch's coordinator pass. The stack moved them to a lane
  of their own (`blockWakes`, at the stall sweep's cadence). The reason: a parked thread must wake whatever level the stall
  watch runs at, and even after its coordinator's last run has closed. The pass no longer carries them. The two kill
  switches, `mail-disabled` and `stall-watch-disabled`, hold the lane (fix round 1, R7).
- `a6-clearing-needs-a-not-ok`: a `disk` or `memory` wake is a clearing. It fires only after the lane has seen the
  condition not-ok at a sweep after the row was made. That reading is kept in memory, so after a restart the block
  waits out its 24-hour lapse. This goes past the plan's `blockWakeDue` signature: the fact set gains `sawNotOk`.
- `a6-account-room-turn-after-row`: an `account-room` block wakes, quietly, only on a turn that STARTED after the row
  was recorded (the marker's `turnAt`). The turn that recorded the block ends after the row, so a stop marker alone
  must not release it.
- `a6-coord-ball-subject-per-rung`: the plan's subject was `stall:coord-ball:<key>`. Each rung now has its own subject,
  `stall:coord-ball:<key>:r<rung>`. A run-less session's rung is found by its exact subject, so rung 3 must not share
  rung 2's.
- `a6-ball-only-coordinators`: a coordinator whose open runs are all inactive (for example `awaiting-review`) is not a
  `stallCandidates` subject. The pass also visits every open-run claimant (`openCoordinatorIds`) for the coord-ball
  mail rung alone (`ballOnly`), with no marker clock. That is the case the rung exists for.
- `a6-wait-mail-holds`: the coordinator's own `wait:` mail holds the rung until a later exchange or re-activation moves
  the ball time past it.
- `a6-idle-word-strict`: the rung mails only a coordinator whose live word reads `idle`, as the plan says. It reads
  the word through the session reading's `keystroke` policy (`turnSays`), where only `idle` is at rest, because W2's
  census allows no new raw comparison of a live word. A `shell` word holds, even though the mail gate delivers on
  `shell`. Doubt mails nothing.

## Measured: red first, by mutation

Each mutant edited one source file in place (its `old` text occurring exactly once) in a scratch copy of the tree. It
ran the committed test file that pins it through `ccrc test`, and the file was restored from a saved copy, its sha256
checked before the next mutant.

- **L1, 44 of 44 killed:** `coordBall.ts` (every hold of the rung, its 20-minute and 30-minute boundaries, rung 3's
  once-only, the mail-disabled hold, the R7 predicate's five conditions, the two derived facts), `stall.ts`
  (`stallRungWave`, the rung recipients, the coord-ball mail arm), `coordCalls.ts` (`blockWakeDue`'s every branch, the
  readings, the clearing half) and `idlenudge.ts` (the open-run holds). Three survivors of the first round, R7 with no
  claimed run and a disk or memory clearing never seen failing, got tests and were then killed.
- **Lanes and store, 27 of 29 killed in the first round:** `blockWakeLane.ts`, `coordBallLane.ts`, the stall pass's
  wiring in `watch.ts` (the R7 call, the ball-only subjects, the tick's wake lane, the nudge's staging), `ledgersStore.ts`'s
  blocking-level read and `coordCallsStore.ts`'s time-block read. Fix round 1 killed the two survivors:
  - `w-ballonly-return` was NOT equivalent (review 2817 R3): a ball-only coordinator that also ran the session arms
    reached mail-stuck's stuck-gate clause, and with `stall-watch-escalate` set it pushed the operator about a
    coordinator that arm never covered. The first test armed no escalate, so it could not see the push. With escalate
    in its markers, the case kills the mutant.
  - `w-nudge-taskskip` was equivalent in the verdict but not in cost (R13): `readTasks` is an agent-link read. A
    read-count assertion on the task directory kills it.

- **Fix round 1, 19 of 19 killed:** one mutant per new guard. R1 (`checking` counted), R2 (the mark and the mail outside one
  transaction, and a lost compare-and-set that still sends), R4 (the old turn test restored), R5 (the holds, the dialog hold, `run-unnamed`, the `unknown` state, the
  ball-only subject's marker read), R6 (the fence, the programme), R7 (the lane's hold call, each kill switch, the
  watcher's listing), R9 (the child filter, the held threshold), R13 (the task read) and R3 (the ball-only `return`).

## Readings that are not this wave's

- Two `stall-sweep` cases from the stall-watch settings wave (M8a's "one resolution for both sweeps", and "the answer
  carries where the level came from") time out at 20 s on this box under load: 35 s and 28 s on unmodified `main` too.

## Fix round 1 (review 2817, the coordinator's rulings)

- **R1, only `open` blocks.** `programmeHasBlockingItem` counts a `blocking` item in state `open` only: a `checking` item
  has been ticked, so the ball is the coordinator's (`waitingCount` reads it the same way). Both the rung and the nudge's
  `run-blocked-on-operator` hold read it.
- **R2, one transaction.** The wake lane calls the store's `wakeBlockTx` (`coordCallsStore.ts`, a holder of the database
  handle, so the lane never reaches for it), which runs `markBlockWoken`'s compare-and-set and then the wake mail's insert
  (`insertSystemMailTx`) inside one `tx`. An insert that throws rolls the mark back, so the row stays unwoken for the next
  pass. The earlier comment
  ("the coord-ball rung covers a lost wake") was false and is gone.
- **R4, "still idle" means the ball has not moved (ruling).** Rung 3 fires when the coordinator is idle now and its ball
  time has not moved since rung 2 was done, whether or not delivering rung 2 started a turn. Rung 3 shares rung 2's key,
  the ball time, so a ball that moved is a new key and starts at rung 2. Plan conformance: A6-1's "still idle with no turn
  since" is read this way by ruling; the stack's `live.since <= done2` made rung 3 unreachable in practice.
- **R5, the rung takes the session holds.** The decider runs `stallSessionHolds` first (absent, unmeasured, a pending
  dialog, an account limit), and holds `run-unnamed` on a run whose state or kind this build cannot name or that reads
  `unknown`. A ball-only subject's marker is now read (still with no marker clock), so the unmeasured-marker hold applies
  to it too. The normal-subject `judgeCoordBall` call is dropped: a normal subject always claims an active run, so it
  could fire only in that doubt case, and it re-read each worker's mail. `stall-sweep`'s one-mail-read-per-candidate pin
  (D-3641) is back to what main had.
- **R6, the returned text is fenced (ruling).** The wake mail returns `chosen` inside `untrustedBlock(…, CARD_TEXT_PREFACE)`,
  as the timer lane returns a note (C63). The sender stays `operator`, as the plan says.
- **R7, the wake lane honours the two kill switches, and nothing else (ruling).** Under `mail-disabled` it holds: no row is
  marked woken and no mail is queued, so the wake comes after the window (D-3636). Under `stall-watch-disabled` it holds
  too. It takes no arming marker of its own: it mails a coordinator only its own parked words, at most once per call. The
  coordination pause does not hold it, because pause is a dispatch stop, not a mail stop. The mail names the programme
  when the row records one.
- **R9, the R7 count starts at the held threshold, for child mail (ruling).** An episode writes its `r7-breach` row only
  once a child's held mail (the worker of a run the coordinator claims) is older than `COORD_BLOCKED_HELD_MS`, the
  threshold the coord-blocked push itself starts at.
- **R10, the exit evidence.** A coordinator is run-less, so a shadow coord-ball rung leaves a once-per-key warn line
  (`stall-watch shadow coord-ball r2 … (run-less)`), not an observation row. The plan's "a day of shadow rows" is read
  from the fleet's shadow log, not the database. Settings' notice counts read `run_events` only, so they never count
  coord-ball rungs 2 and 3.
- **R12.** `blockWakeLane.ts` and `coordBallLane.ts` declare their ring and context (L4 delivery, C5) in their headers.

## Follow-ups (carried, not built here)

- **R8.** A coordinator's own pending timer is not a hold of the coord-ball rung (the worker's quiet arm has one,
  `timerHoldUntil`). The plan's A6-1 hold list does not name timers, and parking is a `block` call (`liveBlock` holds).
  A coordinator that parks with a timer instead could be mailed while it waits.
- **R11.** The nudge's `lastEventAt` counts `run_events` the server writes itself (stall and landing observations), so
  those can keep an abandoned run looking fresh inside `TASKS_STALE_MS`. Bounded: one extra nudge at worst.

