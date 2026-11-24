# Renewal readings E: the builder's departures

Departures from `docs/superpowers/plans/2026-11-14-overlord-w1/w1-renewal-readings.md` found while building PR E (Task 8: the
Overlord's hard `modelDrift` and the soft `readersRunning`, from door process B1's functions), by slug. No D-number is minted
for them; the coordinator folds them into the plan's ledger. Measured on `main` at `66eb018733`.

## What PR E ships

- `server/src/continuity/renewalReadings.ts` (L1): `modelDriftInputOf` (the sidecar as `modelDriftOf` takes it, and why it is
  no evidence), `modelDriftReadingOf` (`modelDriftOf` over the start's class, the reported switches and that sidecar, its
  `Read<boolean>` mapped to a `Reading<boolean>`) and `readersRunningReadingOf` (`readersRunning` over the reader events since
  the start, mapped the same way). `modelDriftOf` and `readersRunning` are passed through unchanged.
- `server/src/continuity/renewalReadingsWiring.ts` (L4): for an Overlord generation only, `w1.modelDrift` and
  `soft.readersRunning`, each inside its own catch (F17). A coordinator gets neither, so its `readersRunning` stays the renewal
  act's `not-applicable`.
- `server/src/continuity/hookReportStore.ts` (L3): `readerEventsSinceStart`, beside door process B1's
  `modelSwitchesSinceStart`; one delegate on the store (`readerEventsOf`) and two members on the watcher's port
  (`modelSwitchesOf`, which B1 had delegated but not put on the port, and `readerEventsOf`).

## Departures

- **`door-readings-floor-is-the-start-rows-receipt`**: the plan reads both producers since `startReportedAt`. That is the hook's
  clock (`StartRow.reportedAt`), and both readers count by the server's (`receivedAt`). Door process B1 already reads the
  switches from the start row's receipt (`modelSwitchesSinceStart`, so a hook clock ahead of the server's cannot hide a
  switch), so the wiring takes B1's existing delegate, `modelSwitchesOf(sessionId, startId)`, and the reader events by the
  same floor through one new read, `readerEventsSinceStart`, which also answers the floor it used, so `readersRunning`'s
  `generationStartedAt` is that same instant. A missing or unreadable start row is a failed read, never an empty list.
- **`one-delegate-for-the-reader-events`** (the brief: "one of the two event readers is already a coordination store
  delegate"): measured, `modelSwitchesOf` was a delegate and the reader events had none. This PR adds exactly one,
  `readerEventsOf`, through the store's one port (`WatcherCoordPort`), the plan's "0 to +2".
- **`drift-sidecar-must-postdate-the-start`**: the plan reads the sidecar's class "when the base usage reading is measured
  and not stale". A sidecar written before the generation's start is fresh by its age but is the predecessor's: after a renewal
  that changes the class (`class-changed`, or the operator's class door), the old sidecar would read as a fresh sidecar of
  another class than the new start's, and `model-drift`, a hard row, would fire at once and drain the new generation. So
  `modelDriftInputOf` reads a sidecar whose `ts` (seconds) is at or before the start's report (milliseconds, the same fleet
  node's clock) as stale: no evidence, so with no switch report the row is blind. The statusline writes again within the
  first turn, so the reading is measured from then on.
- **`drift-input-carries-the-usage-word`**: the plan's `modelDriftInputOf(usage, nowMs)` answers the sidecar or "unmeasured
  `usage stale` or the read's own reason". `modelDriftOf` takes a `SidecarClass` (`fresh`, `stale`, `absent`), which has no
  arm for an unreadable or malformed sidecar, and treats all three non-fresh kinds alike. So `modelDriftInputOf` answers
  `{ sidecar, why }`: the decider's input, and the usage's own word (`usage stale`, `usage from before the start`, `usage
  absent`, `usage unreadable`, `usage malformed`), which `modelDriftReadingOf` appends to an unmeasured answer. No verdict
  changes and no reason is lost. It takes no `nowMs`: the gather reads the sidecar each pass with the pass's wall clock, so
  its `stale` flag is already decided against now (`usage.ts#parseUsageSidecar`, the one freshness rule).
- **`door-reads-optional-on-the-wiring`**: the two reads are optional members of `ReadingsCoord`. A store without them (a
  test, the simulator, an older wiring) leaves both readings at the lane's `W1`, the plan's failure contract for an absent
  port, and the existing wiring tests stand unchanged. `ReadingsCoord` became an interface extending the `Pick`: the
  watcher's store census (`rings/watcher-store-port.test.ts`) follows a `Pick` or an interface whose every property names a
  store member, and does not follow an intersection, which first lost every member the wiring reaches.
- **`door-readings-tests-in-own-files`**: the cases are in `server/test/sim/renewalReadingDoorSets.ts` and
  `server/test/continuity-renewal-readings-door.test.ts`, not the plan's "two suites", so this PR adds no hunk inside a file a
  W1 peer is editing beyond one import and one spread in `renewalReadingSets.ts`.
- **`class-changed-k5-imports-nothing`**: PR C's mutant K5 in `renewalReadingSets.ts` appended its own import of
  `familyClassOf`. The module now imports it, so the mutant would not compile (`invalid`); K5 now adds no import. Its kill is
  unchanged.
- **`switch-target-class-unused-by-drift`**: `modelDriftOf` counts every `switched` report whatever its target, so the
  target's class (`toClass`) does not change the drift; the mapper still classes it, since `SwitchReading` carries it.

## Not built here, and why

- **No chore for the operator.** Both readings are automatic; nothing here adds a manual step.
- **What a merge arms.** The two readings change only the generations lane's due record and `blind`, in shadow and live
  alike. `model-drift` is a hard row of the Overlord, so on a live lane a measured `true` drains the Overlord at its next turn
  end through the renewal act, which owns the act. No migration, route, timer lane or ccd verb.

## Guards, measured red before and green after

Red first: the new suite against `main`'s code: 33 of 36 cases failed, each on a function or a read `main` does not have; the
three that passed need none (a coordinator reads nothing, a store without the reads answers neither, and B1's switches read).
Green with the change: 36 of 36.

The mutant sets (`renewalReadingDoorSets.ts`, floors 1 in `mutation-floors.json`), every mutant killed:

| Set | Mutant | What it does | Killed by |
|---|---|---|---|
| `modelDriftInputOf` | I1 | a stale sidecar read as fresh (the plan's) | the stale case |
| | I2 | an unread usage read as a fresh sidecar of no class (the plan's) | the absent, unreadable, malformed case |
| | I3 | the before-the-start guard removed | the predecessor's sidecar case |
| | I4 | `<=` to `<` at the start | the sidecar at exactly the start |
| | I5 | a fresh sidecar read as stale | the fresh case |
| `modelDriftReadingOf` | R1 | measured always true | the typed-refused case |
| | R2 | unmeasured read as measured false | the stale case |
| | R3 | the usage word dropped | the stale case's reason |
| | R4 | the start model not classed | the typed-refused case |
| | R6 | the start floor lost | the predecessor's sidecar case |
| `readersRunningReadingOf` | N1 | a failed read as 0 | the failed read case |
| | N2 | the start floor lost | the events-before-the-start case |
| | N3 | unmeasured as a count | the stale reader case |
| | N4 | `now` read as the floor | the stale reader case |

By hand, each restored from the commit after its run:

| Mutation | Case that went red |
|---|---|
| H1: the readers' own catch removed | a readers read that throws |
| H2: readers read for every role | a coordinator generation gets neither reading |
| H3: the store's floor at 0, not the start row | the reader events from the start row's receipt |
| H4: a missing start row read as an empty list | a start row that is missing is a failed read |
| H5: the switches asked for another start id | an Overlord generation reads by its own session and start id |

## Tests run

Each alone, through the fleet's test wrapper, from `server/`: the new suite; `continuity-renewal-readings.test.ts`,
`continuity-renewal-readings-wiring.test.ts`, `continuity-readings.test.ts`, `continuity-hook-reports.test.ts`,
`continuity-generations-lane.test.ts`; `sim/mutation-floors.test.ts` scoped to the renewal readings' sets, the baseline and
the two floor checks; `rings/watcher-store-port.test.ts`, `rings/totality.test.ts`, `rings/outward-edges.test.ts`,
`rings/held-by-leaf.test.ts`, `coord-policy-rings.test.ts`, `single-definition/writers-map.test.ts`,
`single-definition/core-vocab.test.ts`, `run-session-census.test.ts`, `ownership.test.ts`, `growth-check.test.ts`,
`growth-caps.test.ts`; the server's `tsc --noEmit`, and the touched test files under the tests' compiler options (the whole
tests project was killed twice by the test slice's memory cap on a loaded box, so CI's typecheck is its arbiter).
