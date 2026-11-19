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
  `stall.ts` 1586 (cap 1603), `store.ts` +6. No waiver.
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
  of their own (`blockWakes`, at the stall sweep's cadence). The reason: a parked thread must wake even when the stall
  watch is switched off, and even after its coordinator's last run has closed. The pass no longer carries them.
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
- `a6-idle-word-strict`: the rung mails only a coordinator whose live word reads `idle`, as the plan says. A `shell`
  word holds, even though the mail gate delivers on `shell`. Doubt types nothing.
