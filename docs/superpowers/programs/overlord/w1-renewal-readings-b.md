# Renewal readings B: the builder's departures

Departures from `docs/superpowers/plans/2026-11-14-overlord-w1/w1-renewal-readings.md` found while building PR B (Tasks 3
and 4: `startById`, the transcript resolver handed to the renewal readings, and `notLocalOf`), by slug. No D-number is minted
for them; the coordinator folds them into the plan's ledger. Measured on `main` at `125a388691`.

## What was built

- `continuityStore.ts#startById` (with its `StartRead` answer), one `CoordStore` delegate and the `WatcherCoordPort` member:
  a generation's own start read by primary key, never through `startsOf`'s newest-N window (review 2183, F16).
- `renewalReadings.ts#notLocalOf` (L1) with its consumer-declared inputs (`Carrier`, `TranscriptAnswer`, `AbsenceProbe`,
  `TranscriptAsk`): eleven rules, first match, numbered in its doc comment. Against the plan's nine: rule 6 is new (an
  absence believed only from the measured search, below), rule 9 is rewritten (a first turn still running), and rule 10 is
  new (an absence no later than the marker's last event); review 3718 F5 asked for the count.
- `renewalReadings.ts#notLocalAskOf` (L1, fix round 1 F2): what the reading asks the resolver about, or why it does not ask.
- `renewalReadingsWiring.ts`: `notLocal` for every generation the gather reads, Overlord and coordinator. It reads the start
  by id and the session's identity from the pass's registry listing (`measuredIdentity`), lets `notLocalAskOf` decide the ask,
  takes the generation's account's config dir (`configDirFor`), then asks the watcher's one memoized `TranscriptResolver` with
  the registry workdir and no `foreign`. A complete absence from it is checked by one measured search of every place the
  resolver's own-account search looks (`resolve.ts#uuidGlobPlaces`, over the watcher's `io`), dated after that search. The
  isolation word's carrier (`IsolationReader.wakingHostKey`) is read before the first read and after the last.
- `resolve.ts#uuidGlobPlaces` (fix round 2): one pure export, the account's projects root and the place `<uuid>.jsonl` has in
  each directory a listing of it names. The resolver's own glob (`globByUuid`) now reads it, with its behaviour unchanged, and
  so does the measured search, so the places have one owner.
- `watch.ts`: the pass's wiring gets `transcript: (o) => this.transcripts.resolve(o)`, the instance the name sweep and the
  idle nudge already ask.

## Departures

- **`not-local-unwired-keeps-w1`**: the plan makes the resolver a required dep. Here `transcript` and `cfg` are optional, and
  a pass without either answers no `notLocal`, so the field keeps the lane's `W1` (a producer not wired, never a default, as
  the plan's Global Constraints say). Reason: `continuity-generations-lane.test.ts` builds the wiring for its latch alone and
  is held by a W1 peer; this keeps that file untouched. The watcher's pin (`continuity-renewal-readings-wiring.test.ts`, "the
  watcher binds ... the transcript resolver") goes red if the real pass stops handing the resolver in, also when the old line
  is only commented out (it reads code only, review 3696 F5).
- **`not-local-carrier-unmeasured-has-its-own-reason`**: the plan's rule 3 reads an unmeasured carrier and a changed carrier
  both as `host changed during the read`. An unmeasured carrier (no ready link, an agent that sent no host report, or no
  isolation reader) is not a change, so it reads `host unmeasured`; only two measured carriers that differ, by digest or by
  key epoch, read `host changed during the read`. This keeps the distinction the isolation reader gives.
- **`not-local-start-reasons-keep-the-detail`**: rule 1's one reason `start unread` is split: a failed read is `start unread:
  <detail>`, and no row for the id is `start row absent`.
- **`not-local-resolver-throw-is-the-field-catch`**: the plan lists "the resolver threw" as an `unread` ask. A throw anywhere
  in the reading (the start read, the resolver, the carrier) is caught by the wiring's per-field catch instead, as every other
  reading's is (F17): `not-local read failed`, logged once per pass, the other fields and generations unaffected.
- **`not-local-fork-takes-the-turn-guard`**: the plan's rule 7 names `startup`, `clear` and `other`. `fork` (a source never
  reported) takes the same turn guard; only `resume` and `compact` read not local at once.
- **`not-local-stop-at-the-start-is-after-it`**: the plan's rule 8 reads "a stop before `startReportedAt`" as no turn, so a
  stop at exactly `startReportedAt` counts as a turn of this generation. Mutant L8 pins the boundary.
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

- **`not-local-absence-confirmed-by-a-measured-search`** (review 3718 F1 and F3, fix round 2; it replaces fix round 1's
  `not-local-absence-confirmed-by-a-fresh-walk`). The shared resolver serves a held `fallback` for up to its back-off while
  its own path has no file, even when the transcript exists at another spelling of the workdir (review 3696 F1). Fix round 1
  checked each complete absence with one fresh walk of the same ladder (`resolveTranscript`). Review 3718 found two things
  wrong with that. First, no case ran the walk the watcher wires in production, because every case injected its own (F1).
  Second, the ladder's `complete` is not a measured absence (F3): it folds an unreadable read into absence at several rungs
  (the exact rungs' `stat`, a null projects listing beside an answering config dir, each project directory's null `stat`), and
  the fleet io turns a request timeout into that null. So on a loaded fleet box, both the memory and a fresh walk can answer a
  complete absence, and the code's rule 7 (`notLocalOf`'s doc comment) would read a `resume` or `compact` start not local at
  once. Fix round 2 drops the fresh walk and its injection seam. A complete absence from the shared resolver is now checked by
  one measured search over the watcher's `io`: `readdirMeasured` of the account's projects root, then `statMeasured` of
  `<uuid>.jsonl` in every directory it names (`uuidGlobPlaces`, at most `GLOB_STAT_CONCURRENCY` in flight, pinned by a wiring
  case with forty directories, review 3742 F3). `notLocalOf` believes the absence only when every read was a proven absence:
  the root absent, or listed with every place absent. A file at any place reads local (`false`). An unreadable listing reads
  unmeasured `projects listing unreadable`, any unreadable place reads unmeasured `a transcript place unreadable`, and no
  search (no `io` wired) reads unmeasured `absence not measured`. These places are every place the resolver looks under the
  account: each exact rung's path is `<configDir>/projects/<munge>/<uuid>.jsonl`, one of them whenever its directory exists.
  The search keeps no memory, so it also covers what the fresh walk was for. Kept from fix round 1: the shared resolver for
  every `found` (the resolver unchanged for its other callers), and the answer dated after the last read (`observedAt`). The
  marker-age rule (10) applies only to a source other than `resume` or `compact`, and only after a turn of this generation has
  stopped. Then an absence observed no later than the marker's last event reads unmeasured `absence older than the turn
  marker` (review 3718 F5). That comparison crosses two hosts' clocks: the hook stamps the marker on the fleet box, and
  `observedAt` is the server's wall clock. The read order already carries the guarantee: the gather reads the marker before
  the first ask, so on one clock its last event is always earlier. The comparison adds only behaviour under clock skew, and
  there it fails closed (review 3718 F2). Cost: one listing plus one `stat` per project directory, per absent generation per
  pass, in place of the fresh walk's; nothing for a found one. A plain file directly in the projects root makes its place
  unreadable (ENOTDIR is not a proven absence), so that account's absence stays unmeasured while the file stands; this fails
  safe.
- **`not-local-complete-is-not-a-measured-absence`** (review 3718 F3): the plan's failure-contract row for this reading ("an
  agent read timed out, a directory unreadable -> `complete: false`") over-claims. The resolver's `complete` is `false` only
  when the own account's projects listing and its config dir both answer null; every other unreadable read is folded into
  absence, and the resolver's own doc names that limit. The correct row: an unreadable read in the measured search makes the
  reading unmeasured with its own reason, and `complete: false` from the resolver stays unmeasured `transcript search
  incomplete`, as before.
- **`not-local-first-turn-running-is-unmeasured`** (review 3696 F1, the second shape): the review asked whether a fresh
  generation's first pass can race the transcript's first append under a `working` marker. Nothing in this tree orders the
  two: the marker turns `working` from the prompt's hook (`ccd/session-hook.sh`), and when Claude Code first appends to the
  transcript relative to that hook is Claude Code's, so a pass between them can see no file. It was not measured against a
  live session (a worker runs fixture HOMEs only), so the shape is treated as real and closed by rule rather than by timing:
  an absence is believed for a fresh source only once a turn of this generation has stopped (`stopAt` at or after the start);
  while the first turn runs, the reading is unmeasured `first turn still running`, and the pass after its stop confirms or
  clears it. A later turn running after an earlier stop still reads not local, since the file was written by then. This
  replaces the plan's rule 9 counting `working` at once. Its cost (review 3718 F4): a generation that really is not local
  reads unmeasured for its whole first turn. A first turn that never stops leaves the marker `working`, so this row stays
  blind until the marker changes; that covers a hung turn, a session that died mid-turn, and one the operator interrupts
  with Esc. `notLocalOf` is handed the raw marker, not the stall view's re-read. Only this row goes blind; the other hard rows
  still decide.
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
`renewalReadings.ts#notLocalOf`, and in fix round 1 a second, `renewalReadings.ts#notLocalAskOf`); and, to designation B (run
3652), `server/test/runSessionCensus.ts` (one `NOT_BINDING_SITES` row). Whichever of us lands second merges the other's. Fix
round 2 adds `server/src/transcript/resolve.ts` (the `uuidGlobPlaces` export), which no peer held; this run claimed it. The
merge with main after Renewal readings F (#3352) adds one line to F's
`server/test/continuity-renewal-readings-operator.test.ts`: its coord fake gains `startById`, since this PR widens
`ReadingsCoord`. The new member throws, like its `raiseLatch`, and nothing in that file calls it. Claimed by this run, with a
notice to F's worker. The merge with main after Renewal readings E (#3350) adds the same line to E's
`server/test/continuity-renewal-readings-door.test.ts` (its `coordOf` fake gains a throwing `startById`), under E's claim 6974
by the peer rule, with a one-line notice to E's worker. It also drops a second, identical `ReadFailure` import that both sides
added to `renewalReadings.ts`. Everything else of both sides is kept: E's two readings beside `notLocal` and `turns` in the
wiring, `startById` added to E's `ReadingsCoord` list, and both sides' mutant sets.

## Measured, not assumed

- **Red first.** The three suites ran red before the code (31 failing: 10 in the readings file, 16 in the wiring file, 5 in
  the start-by-id file; review 3696 F6 corrected the 30 this line said), green after. Fix round 1: 16 failing before its code
  (8 in the readings file, 8 in the wiring file), green after. The eighth wiring red is the source pin, red on the old source
  because it pins the new `ResolveOpts` line (review 3718 F6 corrected the 15 this line said). Fix round 2: 22 failing before
  its code (11 in each file), green after. Most of them are red because the ask's shape changed (`fresh` became `measured`),
  not because of behaviour, so the mutants below carry the evidence.
- **Mutation floors.** `renewalReadings.ts#notLocalOf`'s set, fifteen mutants after fix round 1, every one killed (floor 1):
  `complete: false` read as not local (L1), `found` dropped (L2), an unread marker read as not local (L3), the source check
  forced each way (L4, L5), the key epoch not compared (L6), one unmeasured carrier read as enough (L7), the stop boundary
  moved (L8), a first turn running read as not local (L9), an unread ask read as local (L10), a missing start row read as
  local (L11), the stop guard dropped (L12), the marker-age check dropped (L14) and its boundary moved (L15). Fix round 2
  takes the set to nineteen, all killed: no measured search read as enough (L13, rewritten), an unreadable listing read as an
  absence (L16), a found place dropped (L17), an unreadable place read as an absence (L18), and a proven-absent projects root
  read as unreadable (L19). `renewalReadings.ts#notLocalAskOf`'s set, four mutants, every one killed: the account check, the
  conversation check, the unknown-account check and the unmeasured-identity check each dropped (A1 to A4).
- **By hand, fix round 1** (each restored from a saved copy, the wiring test file run alone): no fresh walk on an absence, 7
  red; the shared resolver's absence trusted as fresh, 1 red (the memoizing fake's case); the second carrier read taken before
  the asks, 1 red (F3's case, a carrier that moves only inside an ask); the observation time taken before the asks, 1 red; the
  ask's account taken from the registry row, not the generation, 1 red; the watcher's line kept only as a comment, 1 red (F5's
  `codeOnly`); a `CCD_ARGV` import added to the wiring, 1 red (F4's parsed-file pin).
  Fix round 1's two "no fresh walk" mutants were made through the injected seam, not the arm the watcher wires (review 3718
  F1); fix round 2 removes that seam.
- **By hand, fix round 2** (each restored from a saved copy and checked with `cmp`, the wiring test file run alone, 37
  cases). The measured search removed (`measured` always null): 10 red, the remembered-absence case and the real-io case
  among them. The search pointed at the remembered resolver (its answer taken as the measured one): 7 red, both of those cases
  among them. An unreadable place folded into an absence: 1 red. An unreadable listing folded into an absence: 1 red. Only the
  first listed directory searched: 3 red. The observation time taken before the search: 1 red. The second carrier read taken
  before the search: 1 red. `uuidGlobPlaces`' root renamed: 4 red in the wiring file. The resolver's own suites
  (`transcript-ladder`, `bounded-pool`, `continued-in-successor-parity`, `transcript-parse`, `feed-writers-pin`) are green
  with the export in place.
- **Review 3742's advisories.** F1: the incomplete-answer case now asserts that no measured search was taken; with
  `answer.complete &&` dropped from the wiring's search condition, 1 red. F3: a case with forty directories counts the
  stats in flight and pins `GLOB_STAT_CONCURRENCY`; with the limiter widened to 1000, 1 red. F2: every rule number in
  this note now says whether it is the plan's or the code's.
- **By hand (Task 3, Step 5).** `startById` reading through a newest-20 window, with 21 later starts in the fixture: red. The
  wiring passing `foreign: []` to the resolver: the ask test and the source pin both red. Both restored from saved copies.
- **What its merge arms.** The coordinators' and the Overlord's due records gain the `not-local` row's reading. In shadow it
  is recorded only; once `continuity` is live, a long-lived session whose conversation is absent on its host renews by a fresh
  start (C50). No ccd file changes, no new verb and no new lane row.
