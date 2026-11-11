# A synchronous lane is timed on its row's clock only

## Goal

`LaneRunner.runSync` and `FleetWatcher.runLaneSync` took an optional `now`, a clock reading a caller could hand in instead of the row's own clock. No production caller passes one, and all four synchronous lanes (`claimRenew`, `claimLapse`, `approvalPrune`, `digestBeat`) are rows on the monotonic clock, so a handed-in wall reading could only ever mix the two clocks. The parameter goes; behaviour is otherwise unchanged.

## What was read first

- The four `runLaneSync` callers in `server/src/watch.ts` (`renewClaims`, `lapseClaims`, `sweepApprovals`, `sweepDigest`) pass a name and a body only. `sweepDigest(now)` and `sweepApprovals` keep their own wall `now` for the day naming and the prune's retention, inside the body; neither reaches the runner.
- A repository-wide search for `runSync(` and `runLaneSync(` finds no other caller outside `server/test/lane-schedule.test.ts` (the other `runSync` hits are unified's markdown processor).
- The only rows that passed a reading were four rows of `lane-schedule.test.ts`, which drove the runner with injected numbers instead of its clock seam.

## Deviations found

- **D-8197 (2026-11-11)** — lane-sync-mono-clock: `runSync` and `runLaneSync` drop the optional `now`; a synchronous lane stamps and throttles on its row's own clock (the monotonic one for every synchronous lane) and no caller can hand in a reading. The test rows that passed a reading now move the rig's clock seam instead, and a new row pins the two signatures.

## Tasks

- [x] T1. Test first, red: a row pins `runSync`'s arity at two and refuses `now` in both method bodies; the four rows that passed a reading drive the rig's clocks (the monotonic one, and the wall one only where the row is about a wall row's starting stamp).
- [x] T2. Remove the parameter from `LaneRunner.runSync` and `FleetWatcher.runLaneSync` and reword their comments.
