# Overlord W1 renewal readings, PR A: notes for the ledger

PR A of `../w1-renewal-readings.md` (Tasks 1 and 2): the readings' seam, the fitted ceiling and the daily backstop. This
file is what the coordinator folds into the plan's ledger; the plan itself is not edited here.

## What shipped

- `shared/renewal-readings.ts` (L0, K): `RenewalBackstop`, `BackstopRead`, `BACKSTOP_HOURS`, `BACKSTOP_DEFAULT` (04:00
  `UTC`), `BACKSTOP_ZONE_MAX`, `isBackstopHour`, `isBackstopZone`.
- `server/src/continuity/renewalReadings.ts` (C3, L1): `W1Inputs`, `SpotsRead`, `fittedCeilingOf`,
  `backstopInstantBefore`, `backstopDueOf`. All three deciders are in `MUTANT_SETS` (`sim/renewalReadingSets.ts`) with
  floors of 1.
- `server/src/continuity/renewalReadingsWiring.ts` (C3, L4): `renewalReadingsOf(deps, coord, records)`, the gather's
  `w1` port; each producer read and mapped inside its own `try` (F17), logged once per reading per pass.
- `generationsLane.ts`: `GenReadings.w1`, `GatherPorts.w1`, the gather's call, and the spread over the `W1` defaults in
  `renewalInputsOf`; `usageReading` is exported for the wiring's window.
- `continuityStore.ts`: `closedSpotProbes` (graded `pass`/`fail` only, F6), `backstopRead`, `setBackstop` (the row's one
  writer); three `CoordStore` delegates and two `WatcherCoordPort` members.
- Migration 87, `renewal_backstop_settings`, seeded 04:00 `UTC`, `isDefault = 1`. Built as 85 on `92e5f1344`; overlaps A
  (#2949) then landed 85, and on the coordinator's word this branch merged `main` once and renumbered to 86; decision model A
  (#2948) then landed 86, and on the coordinator's word (and its standing license) this branch merged `main` once more and
  renumbered to 87 (the slot count on that `main` printed 86). Other open pull requests hold 87 as well; the second to land
  renumbers on the coordinator's word.
  Moving off the end of the list redded decision model A's migration case (`decision-model-records.test.ts`), which rolled
  back to `COORD_SCHEMA_VERSION - 1` and so assumed its entry was the last. The case now finds its entry by its DDL, as
  `coord-db.test.ts`'s `dead_claimants` case does, and first undoes every later entry, newest first (an index on an older
  table, an added column, a created table); any other `ALTER` reds by name. Measured red before, green after, and red again
  with the old `COORD_SCHEMA_VERSION - 1`; green with a temporary later entry that adds a column and indexes, red by name with
  one that renames a column. The same text is on the three other branches whose migration follows decision model A's (the
  renewal hand-offs, done tests A, account organization D), so whichever lands later merges it cleanly.
- `GET` and `POST /api/continuity/renewal-backstop`, session-gated, never EXEMPT, no box token, with their census rows:
  `auth/gate.ts`, `auth-gate.test.ts` (255 routes, 252 HTTP, gated 157, after #2941's hierarchy item route and #2961's private-name doors), `box-token-census.test.ts`, `CLAUDE.md`,
  `secret-mask.test.ts`, `rings/fastify-l4.data.ts`, `coord-db.test.ts`, `run-close-switch.test.ts`,
  `writers-map.test.ts`, `time-ports.test.ts` (`shared/renewal-readings.ts` joins `TIME_PORT_FILES`).

Growth-checked files, net: `schema.ts` +16, `store.ts` +3, `watch.ts` +2, `server.ts` 0, `shared/api.ts` 0,
`coord/routes.ts` 0.

## Departures, by slug

- **`backstop-door-reads-the-route-coord`**: the plan gave `ContinuityRouteDeps` a new `backstop: { read(); set() }` and
  `server.ts` about +2. The doors read `deps.coord` instead, as the timer doors beside them do, so no second way to reach
  the same store and no edit to `server.ts`.
- **`backstop-door-store-failure-is-unavailable`**: the plan said a store failure answers "503 `unmeasured`". The word
  `unmeasured` is 502 in `REFUSAL_STATUS`, so the doors answer the 503 words the response retention door uses:
  `unavailable` for a row that does not read (with the store's detail) and `write-failed` for a set that did not land.
- **`type-import-needs-no-allow-entry`**: the plan added `./renewalReadings.js` to `continuity-generations-lane.test.ts`'s
  import allow-list in this pull request. That list counts value imports only, and `generationsLane.ts` imports
  `W1Inputs` as a type, so an entry now would red the list. Task 6's value import adds it.
- **`w1-inputs-ten-fields`**: `W1Inputs` is the ten fields; `installBehind` joins it in PR H, which is its first writer.
- **`spot-probe-at-is-asked-at`**: a spot probe's `at`, which orders `fittedCeiling`'s window, is the question's
  `askedAt`, the instant it was asked at its depth.
- **`gather-merges-soft-from-the-port`**: the gather sets `soft` from the port's answer as it stands; nothing on `main`
  sets `soft` in the gather before it (the simulator hands it directly to the pass).

## Measured

- Mutation: every mutant of the three sets killed (`fittedCeilingOf` 6, `backstopInstantBefore` 7, `backstopDueOf` 4). Two
  candidate mutants proved equivalent and were replaced: an unreadable zone's wall clock stubbed to `() => 0` answers null
  anyway, and `>` for `>=` in the gap search finds the same instant, since a gap's wall clock never reads the hour itself.
- By hand, each file restored from a saved copy: the spread removed from `renewalInputsOf` (the one-field case red), the
  undefined filter removed (the undefined-field case red), the store's grade filter widened to `grade IS NOT NULL` (the
  unmeasured-grade case red), the wiring's per-reading `try` removed (the throwing-port cases red), and each of the
  door's two guards removed (the `bad-request` case red).
- Question 8 (the reads per pass): PR A adds one `backstopRead` per pass and one `closedSpotProbes` per model class per
  pass, both local SQLite statements, and only for an Overlord generation, of which there is none until the operator
  designates one. No fleet read is added. The fleet-box measure the plan asks for belongs to PR B and PR D, which add the
  resolver and `pool-answer` reads.
