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
  changes, and the reading keeps the usage's word; `renewalDue`'s `blind` then names the row only, as it does for every
  unmeasured row. It takes no `nowMs`: the gather reads the sidecar each pass with the pass's wall clock, so
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
- **`sidecar-read-derives-read-failure`**: the consumer-declared `SidecarRead` first spelled the read-failure pair itself,
  a second copy of `shared/agent-protocol.ts#ReadFailure`; the first CI run's `single-definition/vocabularies.test.ts` caught
  it. It now derives the pair (`ReadFailure | 'malformed'`).
- **`switch-target-class-unused-by-drift`**: `modelDriftOf` counts every `switched` report whatever its target, so the
  target's class (`toClass`) does not change the drift; the mapper still classes it, since `SwitchReading` carries it.

## Not built here, and why

- **No chore for the operator.** Both readings are automatic; nothing here adds a manual step.
- **What a merge arms.** `modelDrift` changes the generations lane's due record and `blind`, in shadow and live alike:
  `model-drift` is a hard row of the Overlord, so on a live lane a measured `true` drains the Overlord at its next turn end
  through the renewal act, which owns the act. `readersRunning` reaches `softRenewalMay` through `soft`: a soft Overlord
  trigger with readers running now waits `readers` instead of `unmeasured`, and with none running the permit goes on to the
  break. With renewal readings F's operator quiet beside it, that break can open for the Overlord; fix round 1 makes the
  terminal drawer's input and the submit route write the operator mark (below), so input through any console path keeps the
  break shut for 20 minutes. The other break input, `placeHiddenObservedMs`, stays the lane's `W1`. No migration, route,
  timer lane or ccd verb.

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
| | R5 | the start floor lost | the predecessor's sidecar case (numbered R6 until fix round 1) |
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

## Fix round 1 (review 3710; the coordinator's ruling in call 1020)

- **F1, F2.** The wiring took the store's two reads off the port and called them bare; on the composition the port is the
  coordination store, whose reads are methods, so both threw and both readings read unmeasured every pass. They are now bound
  to the store (`coord.modelSwitchesOf?.bind(coord)`, the same form for both). A wiring case over a real `CoordStore` on a
  fixture database, with a start row, a switch and a reader event, asserts both readings measured and nothing logged; it was
  red at `b2f8994ba2` (`model drift read failed`) and green with the bind.
- **The operator's paths that wrote no mark.** The terminal drawer's input (`/ws/pty/:id`, an `input` frame) and the submit
  route (`POST /api/sessions/:id/submit`, after a submit that went) now call the prompt route's one writer,
  `promptHandoffs.ts#markOperatorPrompt`. Its keying, `operatorMark.ts#markProgrammesOf`, gains the Overlord: the designated
  session marks `@overlord` after its programmes, so one rule serves the Overlord and a coordinator, and the store's
  `putOperatorMark` stays the one writer. The server's main route file took three added lines, by a packet its other open
  holder, Authority B, consented to on main `94bbc42af9`.
- **The real pass.** For each path, a coordinator and the Overlord (no reader running) the operator typed to through it are
  driven through `generationsPass` with the real `softRenewalMay`: the coordinator waits `no-break`, the Overlord waits
  `unmeasured` (its quiet reads a measured 0, and its place-hidden input is still the lane's `W1`). Controls with no input
  start, the Overlord's because its quiet reads 30 minutes, no activity: the break the mark keeps shut.
- **The bases, two merges.** #3352 had not merged by 03:00Z, so main was merged as it stood: `4e17ac96ee`, its one conflict in
  `server/src/coord/ports.ts` kept both sides' members (`pruneSequenceThrough` and this PR's two). #3352 then merged, and by
  the coordinator's ruling in call 1054 main was merged once more at `1ec2db8ec3`, which holds it: the one conflict, in the
  wiring, kept both sides as written (F's `turns` field, then this PR's two readings).
- **F3, F4.** "What a merge arms" above gains the soft permit; "no reason is lost" is narrowed to what is true; the drift set's
  mutants are R1 to R5.

Departures of this round, by slug:

- **`the-keying-adds-overlord-for-the-designated-session`**: `markProgrammesOf` answered only the programmes of a session's
  runs, and the Overlord's quiet reads one key, `@overlord` (renewal readings F, `generationsLane.ts#softInputsOf`), which only
  the nudge's transaction wrote. The drawer and the submit route type into the pane, so through the keying as it was they
  would mark the designated session's programmes (usually none) and leave its quiet at no activity, the break open. So the
  keying adds `@overlord` after the programmes when the designation reads this session as the bound one (`roleOf.ts`'s
  `designationFactOf` answering `live`). Without it (H9) the keying case, the writer's designation case, and both
  designated-session route cases go red, and through them the Overlord's real-pass cases.
- **`drawer-marks-once-per-two-seconds`**: the drawer sends a frame per keystroke, so it marks through a second instance of
  the drawer's existing per-session throttle (`interruptlog.ts#DrawerInterruptThrottle`, 2 s). The mark's windows are 20 and
  30 minutes, so the mark is never more than 2 s behind the input.
- **`unread-designation-writes-no-mark`**: a designation that cannot be read makes the keying `unmeasured`, so the writer
  writes no mark and logs, as it already did for runs it cannot read (a partial list would mark one key and miss another).
- **`overlord-prompts-still-mark-through-the-nudge`**: the designated session's prompts are recorded, never typed, and the
  nudge's transaction (`nudgeQueue.ts#queueOperatorNudge`) keeps writing `@overlord` there; `markOperatorPrompt` writes it
  for the paths that type.

Guards of this round, each measured red then green:

| Mutation | Case that went red |
|---|---|
| H6: the two reads taken off the store, as at `b2f8994ba2` | over a real coordination store, both readings measure and nothing is logged |
| H7: the drawer's mark call absent (the source before the round) | the drawer marks for the designated session, for a coordinator, and the real pass's drawer case |
| H8: the submit route's mark call absent (the same) | the submit marks for the designated session, for a coordinator, and the real pass's submit case |
| H7 and H8 together, after the second merge | the four real-pass cases: a coordinator and the Overlord, through each path |
| H9: the keying's `@overlord` arm dropped | the keying, the writer's designation read, and both designated-session route cases |

Known limits, measured by reading, not built for:

- **A failed mark write.** `putOperatorMark` answers `ok: false` and the writer logs it; the reading then reads the newest
  mark that was written, aged by the lane, and with none it reads `OPERATOR_MARK_MS`, no activity, so the break input passes.
  The same holds when the runs or the designation cannot be read and no mark is written.
- **The host's renewal act re-measures at the act.** `ccd hibernate --roll --fresh` (`ccdSessionHost.ts#ccdSessionHost`'s
  `renew`) re-reads the box-local facts before it ends the conversation and refuses `session-busy` at exit 3, touching nothing
  (`ccd/ccd#_hib_refuse`): a turn marker that is not `done`, a pane not idle for a keystroke, a half-typed draft, background
  tasks or session crons, and any terminal attached to the pane (an open drawer is one). The lane reads that as `refused`,
  before the first half. So an operator mid-turn at the `checkpointed` stage is not cut off; what stays open is an operator
  reading between turns, with an empty box and no drawer open, past the mark's 20 minutes, which the plan sets aside as
  presence.

## Tests run

Each alone, through the fleet's test wrapper, from `server/`: the new suite; in fix round 1,
`continuity-operator-mark-paths.test.ts` (new), `continuity-operator-mark.test.ts`, `continuity-prompt-renewing.test.ts`,
`pty.test.ts`, `routes.test.ts` and `secret-mask.test.ts`; `continuity-renewal-readings.test.ts`,
`continuity-renewal-readings-wiring.test.ts`, `continuity-readings.test.ts`, `continuity-hook-reports.test.ts`,
`continuity-generations-lane.test.ts`; `sim/mutation-floors.test.ts` scoped to the renewal readings' sets, the baseline and
the two floor checks; `rings/watcher-store-port.test.ts`, `rings/totality.test.ts`, `rings/outward-edges.test.ts`,
`rings/held-by-leaf.test.ts`, `rings/shared-imports.test.ts`, `rings/host-imports.test.ts`, `rings/exemption-age.test.ts`,
`rings/wire-totality.test.ts`, `rings/fastify-l4.test.ts`, `coord-policy-rings.test.ts`, every `single-definition/*.test.ts`
(44 files, after the first CI run's red), `run-session-census.test.ts`, `ownership.test.ts`, `growth-check.test.ts`,
`growth-caps.test.ts`; the server's `tsc --noEmit`, and the touched test files under the tests' compiler options (the whole
tests project was killed twice by the test slice's memory cap on a loaded box, so CI's typecheck is its arbiter).
