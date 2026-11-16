# The delegation lane's clocks and the schedule's recorded exceptions

- **D-8614 (2026-11-13)** — `lane-schedule-exceptions`: a follow-up of the closed architecture refactor (ARCH-68,
  D-5862). The delegation lane's recover, upkeep and compact clocks, and the daily audit-retention timer in
  `server/src/index.ts`, stay outside `LANE_SCHEDULE`. None of them is a cadence that a row can hold with the same firing
  and gating. Each is now a recorded exception, with its reason, in `LANE_SCHEDULE_EXCEPTIONS`
  (`server/test/consolidationCensus.ts`), and a structural census reds a clock that is neither a row nor named there.

## What was measured

`server/test/delegation-clocks.test.ts` pins when each delegation clock fires today. It drives the real lane through
`sweepDelegation`, with the wall clock mocked and the monotonic clock moved a full cadence before each pass, so the
`delegation` row never throttles a pass:

- **`lastUpkeepHour`** spends a **UTC hour** on the pass's wall instant. Two passes a minute apart across an hour
  boundary both enter the upkeep door. Two passes 58 minutes apart inside one hour enter it once. A wall clock stepped
  back into an earlier hour enters it again. The same method also enters the door on every pass where an interval is
  due, so the hour gates only the cursor and zero-delta work.
- **`lastCompactDay`** spends a **UTC day** the same way: two passes a minute apart across midnight both compact, and a
  step back into the previous day compacts again. A pass while the applier refuses pruning does not spend the day,
  so the next pass that day compacts.
- **`lastRecoverAt`** is the recovery backoff (`DELEGATION_RECOVERY_RETRY_MS`, five minutes): a safety interval, not a
  cadence. The applier's open sets it, and so does each recovery. Only a pass that finds the applier failed reads it,
  and a ready pass never sets it, so a failure that shows up ten minutes after the open is recovered on its first pass.
  It reads the wall clock, so a step back holds the next recovery until the wall passes the interval again.

## Why none becomes a row

A row of `LANE_SCHEDULE` is an elapsed cadence on the monotonic clock: OA-C4 (a) put every row there (#803).

- The two latches are calendar boundaries on the wall clock. A 60-minute or 24-hour row fires on elapsed time instead,
  so it would change both firing pins above: across a boundary it skips the second pass, and it ignores a step back.
  The precedent is `lastDigestDay`, which stayed a field because a day verdict is not a row (D-5862's plan).
- `lastRecoverAt` is a safety interval. The table's own header says a safety interval is never a row, and
  `lane-schedule.test.ts` lists `DELEGATION_RECOVERY_RETRY_MS` among the constants that may not be a row's cadence.
  D-5862's plan already said this clock stays.
- The audit-retention timer (D-5620, with the Linear journal's retention, D-7671) is no watcher lane. The composition
  root holds the three stores, runs the sweep once at boot before the server listens, and then once a day on an
  unref'd timer, whether or not the tick runs. Its comment cited "another branch holds `watch.ts`", which stopped being
  true when that branch merged. It now gives the reasons that still hold.

## What changed

- `consolidationCensus.ts`: `LANE_SCHEDULE_EXCEPTIONS` (file, owner, name, kind, reason) is where the schedule census
  keeps its exceptions. The kinds are `gap-rule`, `safety-interval`, `calendar-latch` and `process-timer`.
  `LANE_CLOCK_SHAPE_EXEMPT` is now derived from the table (its `FleetWatcher` rows), so the stall watch's gap rule is
  recorded in the same place.
- `handClocksOutsideSchedule()` is a structural query over three shapes:
  - `FleetWatcher`'s throttle shape;
  - `DelegationLane`'s throttle shape, and a numeric `last*` field compared with `===`/`!==` against a key;
  - every `setInterval(` in `server/src/index.ts`.
  The ratchet (`single-definition/advance-switches.test.ts`) requires every clock found to be named by an entry, and
  every entry to name a clock still found.
- Comments in `watch.ts`, `index.ts` and `laneSchedule.ts` name the exception. No behaviour changes.

## Deviations found

- The census found two further clocks of the same shapes, which the task did not name. Both are recorded too:
  - `DelegationLane#reconciledWallMs`: the breaker's staleness test (M-1), a `gap-rule`;
  - `DelegationLane#lastMarkWarnHour`: the marks warn line, at most once per UTC hour, a `calendar-latch` that the
    change-latch census also reports (D-5861).
- The task allowed moving a clock onto the schedule. None moved: the characterization pins show that each move would
  change when the clock fires.
