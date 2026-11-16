# Overlord W2 overlaps, PR A: build notes

What the ledger should learn from PR A of `w2-overlaps.md` (Tasks 1 to 4). Departures are by slug; the coordinator mints
the numbers. The plan as merged governs; where the shipped code differed, the code's reading is recorded here.

## Departures

- **`open-run-read-is-the-stores`**: Task 3 lists `programmePairsStore.ts#programmeHasOpenRun`. `CoordStore` already had
  `programmeHasOpenRun(program)` (through `programOpenRunCount`, "a run that is not `done` or `failed`"), the same
  question, so the arm reads that one and no second reader was added (consolidate, don't duplicate). A `planned` run
  counts as open there, so rule 12 lapses nothing while a programme has a planned run.
- **`unknown-pair-kind-listed-apart`**: `StandingPairRow.kind` is a `PairKind`, so a stored `kind` outside the vocabulary
  (a newer build's) cannot ride a row. `standingPairs` answers it in a separate `unreadable` list (`{ id, key, why:
  'kind' | 'key' }`), never as a known kind; the moves and the relay read only `rows`. A `ruled` word outside the choice
  table, or a ruling with no time or actor, reads `ruled: 'unreadable'` on the row, which refuses a relay (fail closed).
- **`goal-conflict-open-literal-until-vocab`**: `goal-conflict-open` is not yet in `shared/refusal.ts#OVERLORD_REFUSALS`
  on `main`; the W2 vocabulary piece adds it (question 2). `RelayConflictVerdict` types the word as the string literal,
  and this PR edits no refusal table. Nothing sends it until relay A, after `overlord-route-v1`.
- **`collision-record-catch-beside-its-writer`**: the record's catch, its warn-once latch and its rollback live in
  `claimCollisions.ts#recordCollisionsAfterRefusal`, beside the writer, so `CoordStore#claimAttempt` gains one call after
  its transaction, not the catch (growth).
- **`overlap-project-from-measured-rows`**: the arm's `projectOf` is built from the tick's listing through
  `radar.ts#radarRowsOf`, so a session whose project did not read `measured` has no project and its radar conflicts are
  counted `unattributed`, as `SessionRecord.projectEvidence` requires of every decision on `.project`.
- **`radar-unread-starts-as-listing`**: `FleetWatcher#radarUnread` answers `'listing'` until the radar's first pass, so
  no overlap lapses before the radar has looked once.
- **`goal-signal-step-bound-is-a-parameter`**: `goalConflictSightings(history, now, stepsMax = GOAL_CONFLICT_STEPS_MAX)`
  takes an optional bound so a test reaches the cut cheaply; the arm passes none. Steps count each row-pair examination
  as well as each `pathsOverlap` call, which can only cut sooner.
- **`goal-signal-window-is-the-read`**: the decider reads only rows inside `[now − 14 days, now]`, so a triple's own
  "r3 within 14 days of r1" test can never fire and is left out (a mutant on it would be equivalent).
- **`second-triple-is-the-latest`**: of the triples that start at or after T1's close, T2 is the latest-closing one (the
  plan says "any"), so `newestAt` follows the newest evidence.
- **`evidence-claim-ids-keep-the-newest`**: past `PAIR_PATHS_MAX`, `claimIds` keeps the newest 20; `paths` keep the first
  20 sorted, with `pathsCut`.
- **`a-sighting-can-add-only-a-goals-changed-close`**: Task 2's property "adding a sighting never adds a close" cannot hold
  literally, because rule 7's `goals-changed` close needs a sighting. The property asserts no `lapsed` or
  `programme-ended` close is added.
- **`migration-slot-positional`**: the coordinator granted migration 87 (84 to 86 are granted to queued pieces). Migrations
  are positional (`COORD_SCHEMA_VERSION = MIGRATIONS.length`), so after one merge of `main` (83 entries) the entry is 84 by
  position, and `coord-db.test.ts` and `run-close-switch.test.ts` pin 84, which is what the code measures; pins at 87
  would be red until 84 to 86 land. The coordinator renumbers at landing.

## Hidden pins met (not in the plan's file list)

- `server/test/lane-schedule.test.ts`: the monotonic row count (46 to 47) and a row case for `overlaps`.
- `server/test/single-definition/core-vocab.test.ts`: `HANDLE_HOLDERS` gains `claimCollisions.ts` and
  `programmePairsStore.ts`.
- `server/test/rings/watcher-store-port.test.ts`: `WatcherCoordMember` stays sorted.

## Shared files, agreed with their holders

`schema.ts`, `watch.ts`, `laneSchedule.ts`, `ports.ts`, `coord-db.test.ts`, `run-close-switch.test.ts`, `time-ports.test.ts`
and `lane-schedule.test.ts` (responses B); `store.ts`, `writers-map.test.ts` and the mutation floors (portfolio B);
`core-vocab.test.ts` (designation A); `shared/programmeFacts.ts` (remaining work A writes its own block). All additive;
the second to land merges `main` once and keeps both sides.
