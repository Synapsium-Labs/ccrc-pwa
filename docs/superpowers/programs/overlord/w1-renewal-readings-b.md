# Renewal readings B: the builder's departures

Departures from `docs/superpowers/plans/2026-11-14-overlord-w1/w1-renewal-readings.md` found while building PR B (Tasks 3
and 4: `startById`, the transcript resolver handed to the renewal readings, and `notLocalOf`), by slug. No D-number is minted
for them; the coordinator folds them into the plan's ledger. Measured on `main` at `125a388691`.

## What was built

- `continuityStore.ts#startById` (with its `StartRead` answer), one `CoordStore` delegate and the `WatcherCoordPort` member:
  a generation's own start read by primary key, never through `startsOf`'s newest-N window (review 2183, F16).
- `renewalReadings.ts#notLocalOf` (L1) with its consumer-declared inputs (`Carrier`, `TranscriptAnswer`, `TranscriptAsk`):
  the plan's nine rules, first match.
- `renewalReadingsWiring.ts`: `notLocal` for every generation the gather reads, Overlord and coordinator. It reads the start
  by id, the session's identity from the pass's registry listing (`measuredIdentity`), the session's own account's config dir
  (`configDirFor`), then asks the watcher's one memoized `TranscriptResolver` with the registry workdir and no `foreign`,
  bracketed by the isolation word's carrier (`IsolationReader.wakingHostKey`) read before and after the ask.
- `watch.ts`: the pass's wiring gets `transcript: (o) => this.transcripts.resolve(o)`, the instance the name sweep and the
  idle nudge already ask.

## Departures

- **`not-local-unwired-keeps-w1`**: the plan makes the resolver a required dep. Here `transcript` and `cfg` are optional, and
  a pass without either answers no `notLocal`, so the field keeps the lane's `W1` (a producer not wired, never a default,
  as the plan's Global Constraints say). Reason: `continuity-generations-lane.test.ts` builds the wiring for its latch alone
  and is held by a W1 peer; this keeps that file untouched. The watcher's pin (`continuity-renewal-readings-wiring.test.ts`,
  "the watcher binds ... the transcript resolver") goes red if the real pass stops handing the resolver in.
- **`not-local-carrier-unmeasured-has-its-own-reason`**: the plan's rule 3 reads an unmeasured carrier and a changed carrier
  both as `host changed during the read`. An unmeasured carrier (no ready link, an agent that sent no host report, or no
  isolation reader) is not a change, so it reads `host unmeasured`; only two measured carriers that differ, by digest or by
  key epoch, read `host changed during the read`. This keeps the distinction the isolation reader gives.
- **`not-local-start-reasons-keep-the-detail`**: rule 1's one reason `start unread` is split: a failed read is
  `start unread: <detail>`, and no row for the id is `start row absent`.
- **`not-local-resolver-throw-is-the-field-catch`**: the plan lists "the resolver threw" as an `unread` ask. A throw anywhere in
  the reading (the start read, the resolver, the carrier) is caught by the wiring's per-field catch instead, as every other
  reading's is (F17): `not-local read failed`, logged once per pass, the other fields and generations unaffected.
- **`not-local-fork-takes-the-turn-guard`**: rule 7 names `startup`, `clear` and `other`. `fork` (a source never reported)
  takes the same turn guard; only `resume` and `compact` read not local at once.
- **`not-local-stop-at-the-start-is-after-it`**: rule 8 reads "a stop before `startReportedAt`" as no turn, so a stop at
  exactly `startReportedAt` counts as a turn of this generation. Mutant L8 pins the boundary.
- **`isolation-reader-is-server-deps`**: the plan names `deps.isolation` as a member the isolation word adds. On `main` it is
  `ServerDeps.isolation`, set once by `wireIsolation` in the composition root; the wiring takes
  `Pick<IsolationReader, 'wakingHostKey'>` from the deps the watcher already hands it. No second reader.
- **`not-local-source-pin-on-symbols`**: the plan's pin ("names no `CCD_ARGV` member but `poolAnswer`") is PR D's. This PR pins
  that `renewalReadingsOf` names no ccd argv and never `foreign`, keyed on `scan/symbols.ts#sourceOfSymbol`: a literal file read
  is refused by the source-pin ratchet in `single-definition/advance-switches.test.ts`.
- **`start-by-id-tests-in-own-file`**: `startById`'s tests are in a new `server/test/continuity-start-by-id.test.ts`, not the
  generations store's suite, as PR C did for its column (`designated-class-tests-in-own-file`).

## Files held by W1 peers

Own hunks, with a one-line notice to the holder (Sequence A, run 3297): `server/src/continuity/continuityStore.ts`,
`server/src/coord/store.ts`, `server/src/coord/ports.ts` and `server/test/sim/mutation-floors.json` (one floor row,
`renewalReadings.ts#notLocalOf`). Whichever of us lands second merges the other's.

## Measured, not assumed

- **Red first.** The three suites ran red before the code (30 failing), green after.
- **Mutation floor.** `renewalReadings.ts#notLocalOf`'s set, twelve mutants, every one killed (floor 1): `complete: false` read
  as not local (L1), `found` dropped (L2), an unread marker read as not local (L3), the turn guard applied to `resume` and
  `compact` (L4), the source check dropped (L5), the key epoch not compared (L6), one unmeasured carrier read as enough (L7),
  the boundary moved (L8), `working` not counted (L9), an unread ask read as local (L10), a missing start row read as local
  (L11), and the turn guard dropped (L12).
- **By hand (Task 3, Step 5).** `startById` reading through a newest-20 window, with 21 later starts in the fixture: red. The
  wiring passing `foreign: []` to the resolver: the ask test and the source pin both red. Both restored from saved copies.
- **What its merge arms.** The coordinators' and the Overlord's due records gain the `not-local` row's reading. In shadow it is
  recorded only; once `continuity` is live, a long-lived session whose conversation is absent on its host renews by a fresh
  start (C50). No ccd file changes, no new verb and no new lane row.
