# Renewal readings B: the builder's departures

Departures from `docs/superpowers/plans/2026-11-14-overlord-w1/w1-renewal-readings.md` found while building PR B (Tasks 3
and 4: `startById`, the transcript resolver handed to the renewal readings, and `notLocalOf`), by slug. No D-number is minted
for them; the coordinator folds them into the plan's ledger. Measured on `main` at `125a388691`.

## What was built

- `continuityStore.ts#startById` (with its `StartRead` answer), one `CoordStore` delegate and the `WatcherCoordPort` member:
  a generation's own start read by primary key, never through `startsOf`'s newest-N window (review 2183, F16).
- `renewalReadings.ts#notLocalOf` (L1) with its consumer-declared inputs (`Carrier`, `TranscriptAnswer`, `TranscriptAsk`):
  the plan's nine rules, first match, and the two fix round 1 rules for an absence (below).
- `renewalReadings.ts#notLocalAskOf` (L1, fix round 1 F2): what the reading asks the resolver about, or why it does not ask.
- `renewalReadingsWiring.ts`: `notLocal` for every generation the gather reads, Overlord and coordinator. It reads the start
  by id and the session's identity from the pass's registry listing (`measuredIdentity`), lets `notLocalAskOf` decide the ask,
  takes the generation's account's config dir (`configDirFor`), then asks the watcher's one memoized `TranscriptResolver` with
  the registry workdir and no `foreign`. A complete absence from it is checked by one fresh walk of the same ladder
  (`resolveTranscript`, no memory), dated after that walk. The isolation word's carrier (`IsolationReader.wakingHostKey`) is
  read before the first ask and after the last.
- `watch.ts`: the pass's wiring gets `transcript: (o) => this.transcripts.resolve(o)`, the instance the name sweep and the
  idle nudge already ask.

## Departures

- **`not-local-unwired-keeps-w1`**: the plan makes the resolver a required dep. Here `transcript` and `cfg` are optional, and
  a pass without either answers no `notLocal`, so the field keeps the lane's `W1` (a producer not wired, never a default, as
  the plan's Global Constraints say). Reason: `continuity-generations-lane.test.ts` builds the wiring for its latch alone and
  is held by a W1 peer; this keeps that file untouched. The watcher's pin (`continuity-renewal-readings-wiring.test.ts`, "the
  watcher binds ... the transcript resolver") goes red if the real pass stops handing the resolver in, also when the old line is only commented out (it reads code
  only, review 3696 F5).
- **`not-local-carrier-unmeasured-has-its-own-reason`**: the plan's rule 3 reads an unmeasured carrier and a changed carrier
  both as `host changed during the read`. An unmeasured carrier (no ready link, an agent that sent no host report, or no
  isolation reader) is not a change, so it reads `host unmeasured`; only two measured carriers that differ, by digest or by
  key epoch, read `host changed during the read`. This keeps the distinction the isolation reader gives.
- **`not-local-start-reasons-keep-the-detail`**: rule 1's one reason `start unread` is split: a failed read is `start unread:
  <detail>`, and no row for the id is `start row absent`.
- **`not-local-resolver-throw-is-the-field-catch`**: the plan lists "the resolver threw" as an `unread` ask. A throw anywhere
  in the reading (the start read, the resolver, the carrier) is caught by the wiring's per-field catch instead, as every other
  reading's is (F17): `not-local read failed`, logged once per pass, the other fields and generations unaffected.
- **`not-local-fork-takes-the-turn-guard`**: rule 7 names `startup`, `clear` and `other`. `fork` (a source never reported)
  takes the same turn guard; only `resume` and `compact` read not local at once.
- **`not-local-stop-at-the-start-is-after-it`**: rule 8 reads "a stop before `startReportedAt`" as no turn, so a stop at
  exactly `startReportedAt` counts as a turn of this generation. Mutant L8 pins the boundary.
- **`isolation-reader-is-server-deps`**: the plan names `deps.isolation` as a member the isolation word adds. On `main` it is
  `ServerDeps.isolation`, set once by `wireIsolation` in the composition root; the wiring takes `Pick<IsolationReader,
  'wakingHostKey'>` from the deps the watcher already hands it. No second reader.
- **`not-local-source-pin-on-parsed-file`**: the plan's pin (Task 4: the wiring "names no `CCD_ARGV` member but `poolAnswer`",
  `poolAnswer` arriving with PR D) is this PR's. With no `poolAnswer` yet, the pin here is stricter: the wiring file's imports
  (`scan/symbols.ts#parsedFile`) and its code (`codeOnly`) name no ccd argv at all, and never `foreign`. A literal file read
  is refused by the source-pin ratchet in `single-definition/advance-switches.test.ts`; the parsed-file form is not (review
  3696 F4). PR D widens it to `poolAnswer`.
- **`start-by-id-tests-in-own-file`**: `startById`'s tests are in a new `server/test/continuity-start-by-id.test.ts`, not the
  generations store's suite, as PR C did for its column (`designated-class-tests-in-own-file`).

- **`not-local-absence-confirmed-by-a-fresh-walk`** (review 3696 F1, fix round 1): the shared resolver serves a held
  `fallback` for up to its back-off while its own path has no file, even when the transcript exists at another spelling of the
  workdir. So the wiring keeps the shared resolver for every `found` (one stat on a memo hit, its other callers unchanged) and
  checks each complete absence with one walk of the same ladder that has no memory (`resolveTranscript`, the resolver module's
  own function, over the watcher's `io`; no second implementation). `notLocalOf` believes an absence only from that walk
  (`fresh`), otherwise unmeasured `absence not confirmed by a fresh walk`; with no walk wired, an absence is never believed.
  The answer is dated after the walk (`observedAt`), and an absence observed no later than the turn marker's last event reads
  unmeasured `absence older than the turn marker`. Cost: one extra walk per absent generation per pass, nothing for a found
  one.
- **`not-local-first-turn-running-is-unmeasured`** (review 3696 F1, the second shape): the review asked whether a fresh
  generation's first pass can race the transcript's first append under a `working` marker. Nothing in this tree orders the
  two: the marker turns `working` from the prompt's hook (`ccd/session-hook.sh`), and when Claude Code first appends to the
  transcript relative to that hook is Claude Code's, so a pass between them can see no file. It was not measured against a
  live session (a worker runs fixture HOMEs only), so the shape is treated as real and closed by rule rather than by timing:
  an absence is believed for a fresh source only once a turn of this generation has stopped (`stopAt` at or after the start);
  while the first turn runs, the reading is unmeasured `first turn still running`, and the pass after its stop confirms or
  clears it. A later turn running after an earlier stop still reads not local, since the file was written by then. This
  replaces the plan's rule 9 counting `working` at once.
- **`not-local-ask-refuses-a-moved-registry-row`** (review 3696 F2, fix round 1): the ask is decided by `notLocalAskOf`, which
  asks the generation's own account (`g.lane`) for the start's conversation and only when the registry row agrees with both. A
  row on another account (`registry account differs from the generation's`, a swap between its flip and the swap's new start),
  on another conversation (`registry conversation differs from the start's`, a successor the generation does not hold) or a
  generation with no account (`generation account unknown`) is not asked, and reads unmeasured. A generation whose registry
  has followed a fork it was not minted for stays blind on this row until its next mint.
- **`registry-lookup-named-in-the-run-session-census`**: the wiring finds the session's registry record by the generation's
  session id (`r.id === g.sessionId`). The ARCH-62 census (`server/test/runSessionCensus.ts`) counts any comparison naming
  `sessionId`, so this lookup is named in its `NOT_BINDING_SITES` with its reason, as `coord/questions.ts`'s registry lookup
  is: no run is read. The local battery did not run that census; the PR's first CI run caught it.

## Files held by W1 peers

Own hunks, with a one-line notice to the holder (Sequence A, run 3297): `server/src/continuity/continuityStore.ts`,
`server/src/coord/store.ts`, `server/src/coord/ports.ts` and `server/test/sim/mutation-floors.json` (one floor row,
`renewalReadings.ts#notLocalOf`, and in fix round 1 a second, `renewalReadings.ts#notLocalAskOf`); and, to designation B
(run 3652), `server/test/runSessionCensus.ts` (one `NOT_BINDING_SITES` row). Whichever of us lands second merges the other's.

## Measured, not assumed

- **Red first.** The three suites ran red before the code (31 failing: 10 in the readings file, 16 in the wiring file, 5 in
  the start-by-id file; review 3696 F6 corrected the 30 this line said), green after. Fix round 1: 15 failing before its code
  (8 in the readings file, 7 in the wiring file), green after.
- **Mutation floors.** `renewalReadings.ts#notLocalOf`'s set, fifteen mutants after fix round 1, every one killed (floor 1):
  `complete: false` read as not local (L1), `found` dropped (L2), an unread marker read as not local (L3), the source check
  forced each way (L4, L5), the key epoch not compared (L6), one unmeasured carrier read as enough (L7), the stop boundary
  moved (L8), a first turn running read as not local (L9), an unread ask read as local (L10), a missing start row read as
  local (L11), the stop guard dropped (L12), the fresh-walk check dropped (L13), the marker-age check dropped (L14) and its
  boundary moved (L15). `renewalReadings.ts#notLocalAskOf`'s set, four mutants, every one killed: the account check, the
  conversation check, the unknown-account check and the unmeasured-identity check each dropped (A1 to A4).
- **By hand, fix round 1** (each restored from a saved copy, the wiring test file run alone): no fresh walk on an absence, 7
  red; the shared resolver's absence trusted as fresh, 1 red (the memoizing fake's case); the second carrier read taken before
  the asks, 1 red (F3's case, a carrier that moves only inside an ask); the observation time taken before the asks, 1 red; the
  ask's account taken from the registry row, not the generation, 1 red; the watcher's line kept only as a comment, 1 red (F5's
  `codeOnly`); a `CCD_ARGV` import added to the wiring, 1 red (F4's parsed-file pin).
- **By hand (Task 3, Step 5).** `startById` reading through a newest-20 window, with 21 later starts in the fixture: red. The
  wiring passing `foreign: []` to the resolver: the ask test and the source pin both red. Both restored from saved copies.
- **What its merge arms.** The coordinators' and the Overlord's due records gain the `not-local` row's reading. In shadow it
  is recorded only; once `continuity` is live, a long-lived session whose conversation is absent on its host renews by a fresh
  start (C50). No ccd file changes, no new verb and no new lane row.
