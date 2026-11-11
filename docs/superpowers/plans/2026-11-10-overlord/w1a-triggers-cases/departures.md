# W1a trigger table and case lane: departures found while carrying out the plan

A note for the programme's coordinator to fold into `w1a-triggers-cases.md`'s "Deviations found" and the index plan.
The coordinator issued the one new departure's number, D-8241, and defined it in the index plan
(`docs/superpowers/plans/2026-11-10-overlord.md`); this note cites it and defines nothing. The plan file is left
unedited, because the ledger guard refuses an edit to it from a work branch.

## New departures

- **The case read looks back two windows (D-8241), correction.** The plan's pass read
  `stallObservationsSince(caseWindowFrom(now))`. `casesDue` takes an episode's time from its earliest row in its input,
  so when an episode's first rung slid out of the 14-day window while a later rung stayed inside, the episode took the
  later rung's time. A case had already consumed that episode, so it counted again, and an episode that began more than
  14 days ago counted as "in 14 days". The pass now reads from `caseReadFrom(now)`, two windows back
  (`practiceCases.ts`), so every episode's earliest row is in the decider's input, unless the episode's rows span more
  than 14 days (the recorded residual); the decider still counts only episodes that began inside the window. The read
  is the same statement with a lower bound, so the M17d plan is unchanged.
  Residual, recorded and not closed: one episode's rows can span more than 14 days, so it can still be counted a second
  time. Two ways reach it. A shadow rung counts as done only while its delivery stays shadow
  (`coord/stall.ts#rungDoneAt`), so arming the live marker, the wave-2 marker or a Settings level re-sends that rung
  live under the same key, whenever the operator arms it. And the wave-1 ladder keeps one key until the worker mails,
  with its second and third rungs due only once the worker is idle again (`coord/stall.ts#stallWaveOneLadder`). A
  shadow first rung at T0, a case at T0 + 1 h and a live re-send at T0 + 20 d are counted again by a pass at T0 + 29 d,
  whose read starts at T0 + 1 d. In shadow that is a wrong count, not a wrong act.

## Rulings within the plan

- **The migration slot moved.** The plan named entry 49; `main` stood at 55 when Task 5 was written, and at 56 before
  the push, so `practice_cases` is entry 57 (`user_version` 56 to 57). Another piece took 56 first: the branch absorbed
  `main` a second time, on its own conflict, and renumbered the entry and nothing else. Two older migration tests name
  every later entry (`coord-calls-store.test.ts`'s replay of the later entries, `run-close-switch.test.ts`'s step back to
  version 53), as `lane_arm_settings` did for itself; they were red on this branch from its first `practice_cases` entry
  until each named `practice_cases` too.
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

## Fix round 1 (review run 1793)

- **One occurrence per run, arm and key stays (F1).** The spec keys an occurrence so (§10.5). An arm whose key is per
  delivery (`mail-stuck`, `coord-deaf`) or moves with each wait (the quiet ladder) can therefore count one stall more
  than once; `practice-cases.test.ts` pins it as the known width, and it is an open question for the cases going live.
- **An episode later than the lane's clock is not counted yet (F3).** The stall sweep stamps its rows with its own clock
  and the lane reads `Deps.time`, so a row can be later than the pass's `now`. `casesDue` now counts an episode only once
  `now` reaches it, so a case's `openedAt` is never below its evidence and the next pass finds that evidence consumed.
  The store's compare-and-set is unchanged.
- **A run the lane cannot read is warned and answered (F5).** It still lowers the count, as Review Focus 5 allows, but
  the pass warns once and answers `unread: 'runs'`, so a failed read never reads as a fully read pass. An absent run is
  left out without a warning.
- **The missing reds (F4).** Two signatures fed in descending order pin both sorts, an absent run pins the run filter,
  and a `tick()` test pins the lane's dispatch.

## Known limits

- The `tick()` test sees only the dispatch from `tick`, not `sweepCases`' own body (its `runLane('cases', …)` and its
  `Deps.time` clock), the same shape as the sibling lanes' tests.
- No input of the decider's grid is later than `NOW`, so the oracle comparison cannot see `casesDue`'s `e.at > now`
  guard; the dedicated tests (an episode later than `now`, and the lane-clock pass) kill it.
