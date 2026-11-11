# W1a trigger table and case lane: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-triggers-cases.md`'s "Deviations found" and the index plan.
It names each departure by a plain-words slug; the coordinator issues its number. The plan file is left unedited,
because the ledger guard refuses an edit to it from a work branch.

## New departures

- **case-read-looks-back-two-windows, correction.** The plan's pass read `stallObservationsSince(caseWindowFrom(now))`.
  `casesDue` takes an episode's time from its earliest row in its input, so when an episode's first rung slid out of
  the 14-day window while a later rung stayed inside, the episode took the later rung's time. A case had already
  consumed that episode, so it counted again, and an episode that began more than 14 days ago counted as "in 14 days".
  The pass now reads from `caseReadFrom(now)`, two windows back (`practiceCases.ts`), so every episode's earliest row is
  in the decider's input; the decider still counts only episodes that began inside the window. The read is the same
  statement with a lower bound, so the M17d plan is unchanged. Residual: an episode whose rows span more than 14 days
  can still be counted again; one episode's stall rungs span hours.

## Rulings within the plan

- **The migration slot moved.** The plan named entry 49; `main` stood at 55 when Task 5 was written, and at 56 before
  the push, so `practice_cases` is entry 57 (`user_version` 56 to 57). Another piece took 56 first: the branch absorbed
  `main` a second time, on its own conflict, and renumbered the entry and nothing else. Two older migration tests name
  every later entry (`coord-calls-store.test.ts`'s replay of the later entries, `run-close-switch.test.ts`'s step back to
  version 53), as `lane_arm_settings` did for itself; each now names `practice_cases` too.
- **The time ports merged mid-wave.** The branch absorbed `main` once, as a merge, on the coordinator's licence, so the
  lane takes its wall clock from `Deps.time.clock.wall()`. The lane's new files, and the role table's
  (`server/src/roleOf.ts`, `shared/fleetRoles.ts`), joined `TIME_PORT_FILES` in
  `server/test/single-definition/time-ports.test.ts` (the brief named `scan/ambient.ts`; the list lives in the test).
- **The stall vocabulary pin.** `stall.ts`'s value import from `shared/stall-watch.ts` is admitted by name and source on
  one exact line, as the role table's import is.
- **One pull request.** Tasks 1 to 6 ship as one pull request, as the brief asked, not the plan's two.
- **The coord ring's handle holders.** `practiceCasesStore.ts` names `DatabaseSync` by `import type`, as its siblings
  do, so it joins `HANDLE_HOLDERS` in `server/test/single-definition/core-vocab.test.ts` beside `reviewCapStore.ts`.
  The plan did not name that guard.
- **The lane-schedule census.** `lane-schedule.test.ts`'s count of monotonic rows rose from 39 to 40 with the new row.
- `MUTANT_SETS` is not on `main`; the simulator piece registers `practiceCases.ts`.
