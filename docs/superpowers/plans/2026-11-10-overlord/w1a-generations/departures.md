# Overlord W1a, generations: departures from the plan

Each departure from `w1a-generations.md` is named by a slug. No D-number is taken here: the coordinator folds these into
the programme's ledger. The plan's own decisions (its "Deviations found" list) stand unless a slug below changes one.

## The table and its store (Task 1)

- **walk-column-per-walk** (review 1902 F1, the coordinator's ruling) — the column a write moves is decided per walk,
  not per pass. A `walk` column records the mode a walk began in (`live` or `shadow`), set by the mint or by the first
  step out of `active` or `degraded`, and cleared when the walk ends (`active`, `degraded`, `ended`). A live walk
  finishes on `state` after `continuity` drops to shadow; a mint ending a row on a live walk mints the next row live, so
  a renewal a start completes goes on in `state`; a shadow mint never writes `state` past `active`. The plan's "the
  store's step and mint take `live` … nothing else chooses the column" is narrowed to: `live` chooses the column only for
  a walk that begins in this pass.
- **shadow-deadline-column** (review 1902 F1, "`deadlineAt` never leaks a carded deadline onto an active row") —
  `shadowState` has its own deadline column, `shadowDeadlineAt`, set and cleared by the same rule as `deadlineAt`. In
  shadow a mint writes `state` `active` with `deadlineAt` null, and the carded deadline in `shadowDeadlineAt`.
- **one-effective-state-accessor** (review 1902 F6) — `effectiveGeneration(row, live)` in `continuityStore.ts` answers the
  effective state, its deadline, the column the next step writes and whether a shadow walk's residue stands; `genViewOf`
  builds the machine's view from it. The card (part B) and the probes use these and read no column by hand.
- **nudge-point-derived** (review 1912 F3) — no nudge column: the carded nudge point is the carded deadline less the lane
  period (`CARDED_NUDGE_AT_MS`), derived from the stored deadline when the renewal act feeds `nudge-due`.
- **host-ended-column** (review 1912 F3) — `hostEnded` is a column, as the machine's view needs it; `probeRounds` counts
  failed rounds (0 or 1); `walkClass` holds the view's `cls`. Every view field is a column, so a restart resumes the walk.
- **proven-follows-the-view** (review 1920 R2) — `proven` is written from the machine's next view on every step, so it is
  cleared when the conversation ends (`hostEnded`), as the machine's `degrade` says. The plan's "set once, never cleared
  (A2)" is superseded.
- **cas-key-carries-both-columns** — every compare-and-set compares `(term, n, state, shadowState, walk)` as the caller
  read them, by row id: the plan's `(identity, term, n, state)` with the shadow column and the walk beside `state`, so a
  shadow step raced by another write changes nothing.
- **only-a-mint-ends** — `stepGeneration` refuses `ended`: a generation ends only in the mint that replaces it, with its
  outcome, in one transaction.
- **clear-shadow-walk-resets-the-view** (corrected by review 2003 F12) — when `continuity` is live and a walk begun in
  shadow left its residue, `clearShadowWalk` removes it. A row whose `state` is `active` is reset to `GEN_ACTIVE` (proven,
  no counters), as a generation that was working when the machine began; a `degraded` row keeps its `proven`, its counters
  and its `walkClass`, so a generation the machine degraded is never marked proven by a shadow walk's clearing.
- **hold-off-absolute** (review 1902 F4) — `setHoldOff` stores `holdOffUntilObservedMs` absolute on the identity's
  accumulator (`observed.ms + HOLD_OFF_MS`), computed inside the compare-and-set; the gather (`softTimesOf`) subtracts
  `mintedObservedMs` to put it on the generation's own age, with a case at a nonzero `mintedObservedMs`.
- **start-reported-at-column** (reviews 1949 G3, 1975) — `startReportedAt`, the start's `reportedAt`, is stored on the row,
  so a start older than the live generation's is recognised as late without a join.
- **prev-model-column** — `prevModel`, the model of the generation a mint ends, is stored on the new row, so a resumed
  start's model class can be compared with the conversation it resumed (`resumed-other-class`).
- **starts-since-takes-a-limit** — `startsSince` takes an optional limit, so the pass reads at most 200 starts in SQL.
- **wave-boundary-read** (moved by review 2003 F11) — the wave boundary is read by `newestClaimedWorkRuns`
  (`coord/bindingReads.ts`), not by the continuity adapter: the coordinator's binding series (`bindingRunsOf`), the runs it
  claims (`runsClaimedBy`, the binding module's own rule beside `childrenOf`), newest first, and each run's kind and
  programme from `run(id)`, until two work runs. No session-keyed reader is added to `CoordStore` (the census's ceiling of
  four stands), and no stand-in value is left for a column that cannot be null. A read that throws (a claimed run whose
  row cannot be hydrated, such as a malformed `prLineage`) answers `ok: false` with the error, as the continuity adapter's
  read did before the move (review 2006 R4): the wave reading is unmeasured and named in `blind`, and the pass, its later
  generations and its log go on. Each coordinator generation still costs two `run(id)` hydrations a pass where it needs
  only kind, state and programme (review 2006 N8): left, since a narrower read would be a new store member for one caller.

## The pass mints and ends (Task 2)

- **start-decider-in-l1** — what a start does (mint or a named skip, and the outcome of the generation it ends) is
  decided by `startVerdict` in a new L1 module, `server/src/continuity/generationStart.ts`, with `waveBoundaryOf`
  beside it; both join `MUTANT_SETS` (`server/test/sim/generationStartSets.ts`) and `mutation-floors.json`. The lane makes
  no decision inline.
- **uuid-checked-against-the-current-row** (reviews 1949 G2, 1975 H2) — the registry keeps no history of a row's
  conversations, so a start other than `startup` is the row's own only when its `uuid` is the conversation the registry
  names for the row at the pass; otherwise it is skipped as `foreign-uuid` (or `uuid-unmeasured` when the registry's uuid
  could not be read). A `startup` is not checked: the door attributed it against the registry at its send and it keeps
  its own sender. The cost: a row's own `clear` that lands after the registry has moved on to a newer conversation mints
  nothing, and the newer start mints instead, so a generation in between can go unrecorded.
- **starts-in-reported-order** (review 1949 G3) — a batch is taken in `reportedAt` order (then id), and a start older than
  the live generation's start is skipped as `late`, so a late-landed older `clear` never mints or ends after a newer one.
- **first-start-mints** (review 1975) — an identity with no generation mints n=1 from the first start the lane has,
  whatever its source.
- **coordinator-first-mint** (review 2003 F2) — a coordinator's own `startup` lands before it opens its first run, when its
  role still reads undecided, so the batch skips it. On every pass, an identity that reads as a coordinator (it claims an
  open run) and has no generation mints n=1 from its newest start that mints, among the starts the cursor has passed (at
  most `FIRST_MINT_LOOKBACK`, 20, looked through; a start above the cursor is the batch's to judge). The walk is
  `firstMintOf` (L1) and runs newest first; it STOPS at a start `startHold` holds (review 2006 R2), so a start that would
  read on a later pass is never passed over for an older conversation, which would then be n=1 for good. Past the bound
  (and once this process has held it) the start no longer holds, and the walk falls through as the batch does. Its account
  is recorded only when the start is the identity's newest as the account goes (`newestStart`, slug newest-start-trusted).
  No cursor rides this mint.
- **start-held-on-a-failed-read** (review 2003 F2; review 2006 R3 and R8) — a start skipped as `unregistered` or
  `uuid-unmeasured` (a registry read that failed this pass) is not judged for good on first sight: `startHold` (L1) holds
  it while the server received it less than `START_RETRY_MS` (five lane periods, 150 s) ago. The batch stops at the first
  held start: it and every start after it wait for a later pass, and the cursor stays below the lowest id among them; past
  the bound the start is skipped, counted and logged, and the starts behind it go on in the same pass. Starts judged in the
  same pass above the held one are judged again next pass (a mint answers `superseded`, a skip is counted again).
  - **The bound is wall time, by ruling (review 2006 R3).** Spec §11.5 allows the wall clock for a timer whose expiry
    permits nothing, and giving up on a start permits nothing: it only stops waiting for a registry read. Two guards keep
    the wall clock from costing a start its retry. A clock that reads earlier than the start's receipt reads as the receipt
    (`startAged`), so a backward step keeps it held. And every held start gets at least one retry on a pass of the current
    process before it is skipped: the lane keeps a process-local memo of the starts it held (`GenerationsDeps.retried`,
    the watcher's own set), and a start past the bound that this process has not held yet is held once more. So a server
    restart, an update's supervisor sweep (when half-written rows are likeliest) or a slow tick never skips a start with no
    retry. The memo is not durable, and losing it only adds a retry.
  - **No start waits longer than the bound for another start's hold (review 2006 R8).** A start behind a hold that has
    itself waited out `START_RETRY_MS` since its own receipt is judged past the hold, so a chain of holds (each a late
    resend reported before it) cannot keep it waiting. It may then mint before an older held start of the same identity,
    which reads `late` when its own read succeeds.
- **start-held-after-the-listing** (review 2006 R1) — the tick lists the registry, then awaits its other sweeps and the
  gather's fleet reads before the pass reads its starts, and the start door attributes a start against a fresh registry
  read. So a `/clear` accepted in that window carries a conversation the pass's listing has not seen, and would read
  `foreign-uuid` and be skipped for good. The watcher passes the listing's time (`GenerationsInput.listedAt`, the tick's
  own `listedAt`), and a start the server received at or after it is held for a pass whatever its skip; the next pass's
  listing knows it. The same hold keeps an older listing's account off a start it predates (slug newest-start-trusted's
  second window). The simulator's stand-in registry is listed after each beat's deliveries.
- **batch-split-in-l1** (review 2006 R6) — which starts a pass judges, which wait and where the cursor moves
  (`planStartBatch`), the coordinator's first-mint walk (`firstMintOf`) and the "newest start" rule (`newestStart`) are
  decisions, so they are L1 in `generationStart.ts`, each with its exhaustive cases and a mutant set with a floor. The
  lane (L4) reads, asks and writes.
- **other-source-mints** — a start whose source is `other` (a word outside the vocabulary) mints like `startup`'s
  siblings; only `compact` and `fork` are skipped by source.
- **swap-before-crash** — the outcome is `renewed` for a generation that was `clearing`; else `unmeasured` when either
  account is not known (review 2003 F4: a swap cannot be ruled out); else `swapped` when the account changed; else, on the
  same row incarnation (both known), `cleared` for a `clear` (slug clear-is-not-a-crash) and `crashed` for any other start
  while it was `active`; else `woken`. The plan lists `crashed` before `swapped`; a start on another account is a swap even
  when the incarnation stayed.
- **newest-start-trusted** (review 2003 F4; review 2006 R5 and R6) — the registry is read at the pass, not at the start,
  so its account describes only an identity's newest start in the pass. An older start judged in the same pass ends the
  live generation with the outcome `unmeasured` and mints a generation with no account (`lane` null). `GENERATION_OUTCOMES`
  gains `unmeasured` (`shared/continuity.ts`, appended with the claim holder's agreement); `startVerdict` takes `newest`
  and answers `lane`. "Newest" is one L1 rule (`newestStart`), asked by the batch and the first mint alike: only a later
  start of the same identity that could move the account makes a start older, and a `compact` or a `fork` cannot (review
  2006 R6). "Newest in the pass" is not "newest in fact", and one window remains (review 2006 R5): a start accepted but not
  yet judged, then a swap that flips the row's account, then the swap's own start still in the hook's spool (resends wait
  5 to 30 s, longer behind a hold). The first start is judged as newest and records the new account (its outcome can read
  `swapped`), and the swap's start then compares new with new. Nothing in W1a acts on an outcome, and `lane` feeds only
  the next start's outcome, so the cost is mislabelled shadow data. The second window the review named (a listing older
  than the batch) is closed by slug start-held-after-the-listing.
- **outcome-from-the-state-column** (review 2003 F1) — the outcome reads the ended generation's `state` column, what the
  session lived, never a shadow walk's would-be state: in shadow `state` stands `active`, so an unplanned start on the same
  incarnation is `crashed` (now reachable), and a start never reads `renewed` while nothing renews.
- **clear-is-not-a-crash** (review 2006, the coordinator's ruling on the plan note) — `startOutcome` takes the start's
  source. A `clear` on the same row incarnation and account ends the generation `cleared`, a word appended to
  `GENERATION_OUTCOMES`; `crashed` stays for a start with no planned cause. A deliberate `/clear` would otherwise have made
  up most of the `crashed` column in shadow.
- **intent-unread** (review 2003 F2) — `roleFactsOf` gets `intentDeclared: 'unmeasured'`, as the mail pace does: the
  declared intent has no store read. A start of a session that claims no open run therefore reads undecided
  `coordinator-or-plain` and is skipped for good, counted (`skipped.undecided`) and logged: a plain session gets no
  generation. A coordinator does not lose its first generation to it (slug coordinator-first-mint), but a coordinator's
  later start that lands while it claims no open run (between programmes) mints nothing, and its live generation then
  spans that conversation too.
- **no-spool-drop-reader** — the hook's spool drop count (`<id>.startpending`'s header) is not read: the pass counts the
  starts it judged and skipped by reason, and a start the hook dropped never reaches it.
- **accumulator-advanced-before-mints** — each pass advances every live generation's accumulator first, then mints, so a
  mint carries the identity's accumulator to this pass. A gap is recorded per generation (`gaps`, with its `deltaMs`) and
  logged once a pass.
- **cursor-rides-the-last-mint** — the cursor advances to the batch's highest start id in the same transaction as the
  mint of the batch's last start (in `reportedAt` order), or alone after the batch when that start mints nothing. A mint
  that could not be written stops the batch and leaves the cursor, so the next pass judges it again; a start minted
  already answers `superseded`.
- **registry-from-the-tick** — the pass takes the tick's registry records; when the registry could not be listed it judges
  no start and leaves the cursor. A row the listing dropped (a half-written row) reads `unregistered` and is held (slug
  start-held-on-a-failed-read), and a start that landed after the listing is held a pass (slug
  start-held-after-the-listing).
- **pass-logs-its-counts** (review 2003 F5; review 2006 N3) — the pass logs, once, every non-zero skip count, the held and
  superseded starts and a batch stopped by a mint that could not be written, and in a line of its own each read that
  failed, naming what it stopped where it failed: before the batch, no start is judged and the cursor stays; after it,
  the batch ran and only the first mint's read is lost; at the end, no due is recorded. The watcher still discards the
  result; the pass's own log is the record. Starts above a standing hold are judged again each pass and counted again,
  and a write that changes nothing is not counted.
- **lane-wired-in-the-watcher** — the plan names `server/src/index.ts` for the wiring; the lane runs from the watcher's
  tick, as the case lane does (`FleetWatcher.sweepGenerations`, never awaited), with `Deps.time` from the watcher's deps
  and this process's id drawn once from `Deps.time.entropy`. `index.ts` is unchanged. The watcher's store port
  (`coord/ports.ts#WatcherCoordMember`) gains the lane's members.
- **schedule-row-at-the-renewal-period** (review R2-3) — the row `generations` runs at `RENEWAL_LANE_PERIOD_MS`, imported
  from `shared/continuity.ts`, and the step cap is `observedStepCapMs(RENEWAL_LANE_PERIOD_MS)`; there is no
  `GENERATIONS_PERIOD_MS`. `lane-schedule.test.ts`'s "every derivedFrom names a constant that exists" accepts a constant
  the schedule imports by name.

## The pass records `renewalDue` (Task 3)

- **behind-is-the-roll-release-test** (Step 1, measured) — the roll's behind test is `autoRollVerdict`
  (`server/src/coord/rollTarget.ts`): `startedAt >= release` is current, where `release` is `~/.ccrc/installed`'s time on
  the node (`ReleaseRead`) and `startedAt` the pane process's start (`processStartedAtFor`, `server/src/turnverdict.ts`).
  `installBehind` is `startedAt < release`; no install record reads not behind, an unreadable one or an unmeasured start
  reads unmeasured. Its other half, a newer Claude Code build on the lane, is not "a new ccrc install" and is not read.
  The watcher's install read is one method, `nodeRelease`, which the roll lane now calls too.
- **wave-boundary-read** (Step 1, measured) — no existing `CoordStore` read answers "the coordinator's newest run is open
  and the one before is closed" (`runs`, `openRunsForSession` and `runsNamingSession` answer other populations), so
  `newestClaimedWorkRuns` reads the coordinator's two newest work runs and `waveBoundaryOf` (L1) answers: the newest open,
  the one before closed (`TERMINAL_RUN_STATES`), and both of one programme. Review runs are not waves.
- **compactions-since-the-start** — the compactions are counted since the generation's start (`startReportedAt`, the
  hook's clock, the clock the compaction lines carry), not since `enteredAt`, which moves with the walk and is the server's
  clock.
- **compactions-read-on-events-change** (review 1927 N2) — the gather stats `$REG/<id>.compactevents` and re-reads the
  three compaction files only when its size or time changed (every compaction writes it: its pre line, or the rotation),
  and every time when it is absent (an older hook) or its stat failed. The cache is a read cache, never a decision's
  memory.
- **pair-window-unmeasured** (review 1927 M7) — `COMPACTION_PAIR_MS` has no W0 figure behind it; the pass says so where it
  counts.
- **coordinator-rows-unread-in-w1a** — besides the Overlord's inputs (reason `W1`), three coordinator rows have no reader
  yet and are passed unmeasured: `not-local` (`W1`), `probe-failed` (the probes piece) and `compaction-refused` (the
  compaction piece). They are named in `blind` on every coordinator and never fire.
- **due-on-the-state-column** (review 2003 F1, replacing at-rest-only) — a generation is judged by `renewalDue` and
  gathered for when its `state` column is `active` or `degraded` (`judgedForDue`, L1), whatever a shadow walk holds in
  `shadowState`: the due record does not depend on the walk, and the walk's own column still records the would-be states.
  A shadow mint leaves `state` `active`, so in the shipped default every generation carries the `renewalDue` answer of
  its last pass (`dueSince`, `dueWhy`, `dueClass`) and the triggers it could not read (`blind`), as the plan's Goal and
  the card's shadow note say. A generation on a live walk (`state` past `active`) is not judged.
- **live-gated-until-the-renewal-act** (review 2003 F3, also settling F15) — the `continuity` row carries a gate:
  `LANE_ARM_TEXT.rows.continuity.gate` says why, `laneArmGate` reads it, and while it stands the door refuses Live with
  `lane-gated` (409, its reason in `detail`). The route checks the body (400) and an unconfigured store first; within
  `decideLaneArmPost` the gate comes before sign-in, an unreadable row and the confirm (review 2006 N2). The Shadow lanes
  card shows the reason under the row. Nothing steps a generation in W1a, so a live walk would stand at `carded` and fire
  every deadline when the renewal act arrives; that piece lifts the gate. The per-walk ruling stands.
  - **The gate is in the view too (review 2006 N1).** A row is live only when its stored word is `live` AND its gate is
    open (`laneArmLive`, L0, one rule): `laneArmRowViewOf` answers `live: false` for a `continuity` row stored `live`
    (which only a box that ran this branch before the gate could hold), so the lane mints shadow walks, and the card checks
    neither radio under the gate's words. The view and the lane take the gate as an argument that defaults to
    `laneArmGate`; only the lane's own cases and the simulator open it (`GenerationsDeps.gate`), to drive the live walk
    the renewal act will arm. Nothing in the server passes one.
  - The card's gate line, its longest, is drawn and measured at every width in both skins in a real browser
    (`pwa/browser/shadow-lanes-card.browser.test.ts`, review 2006 N7), not only in jsdom.
- **word-columns-fail-the-row** (review 2003 F13) — a non-null `walkClass`, `dueWhy`, `dueClass` or `outcome` this build
  does not know, or a `blind` that is not a list of known triggers, fails the row as `state` does; null still reads as not
  written.
- **compactions-memo-keeps-ok-reads** (review 2003 F14) — the gather keeps a compactions read only when it worked; an
  unreadable one is read again on the next pass, not when the events file next changes.
- **behind-predicate-shared** (review 2003 N3) — `startedBeforeRelease` (`coord/rollTarget.ts`, L1) is the one "behind the
  install" test: the roll's `current` is its negation, and the gather's `installBehind` reads it.
- **mint-docstring-term** (review 2003 N2) — the mint carries the identity's newest row's accumulator within one `term`,
  and its docstring now says so.

## The simulator runs the lane (Task 4)

- **crash-invariant-is-g8** — the scenario already had a G6 (the deadline and budget bound) and a G7 (soft renewals
  from `active` only) from the renewal deciders' fix rounds, so the plan's new crash invariant is **G8**: after every pass
  that runs to its end, each identity has exactly one live generation, and the newest start it reported minted it.
- **crash-inside-the-pass** (corrected by review 2003 F8) — a crash "at any step" is placed inside a pass by a write that
  aborts, and every write after it: triggers on `continuity_generations` and `continuity_cursor` call `sim_tick`, a JS
  function, so the countdown is kept outside the aborting transaction (a counter in a table was rolled back with it, and
  the next write committed). The write index is drawn up to 14, so a busy pass's last writes (the Overlord's mint) are
  reached, more often while a start waits; the server goes down after that pass. `crash-mid-pass` is covered only when an
  abort landed, and a pass line (G5, G8) is written only when none did. The pass is synchronous, so this is a crash at a
  write boundary, never an interleaving.
- **g8-mutation-row** (review 2003 F9) — `GenDayModules.coord` hands the pass a wrapper of the store; a MUTATION row's
  wrapper advances the cursor in its own transaction before the mint it covers, and G8 goes red within the CI seeds.
- **sim-real-store** — the generations live in an in-memory coord.db migrated by `MIGRATIONS`; the lane mints and ends the
  coordinator's generations from the reported starts, and every machine step goes through `stepGeneration` with its
  compare-and-set.
- **sim-arm-per-seed** (review 2003 F10) — the `continuity` row is drawn per seed (edges `live-arm` and `shadow-arm`), so
  shadow runs under crashes too: a shadow walk moves `shadowState` with `shadowDeadlineAt`, and every machine read, the
  deadlines included, goes through `effectiveGeneration`. One database serves every seed (migrated once, its day's tables emptied
  per seed): a database per seed churned native memory past the test slice's cap over `CCRC_SIM=full`'s 5,000 seeds.
- **sim-overlord-mints** — W1a's lane cannot tell the Overlord's role (no designation before W1), so the scenario mints the
  Overlord's generations from its reported starts through the same `mintGeneration`, in the lane's order, standing in for
  W1's designation.
- **sim-day-starts-working** — both identities begin the day at n=1, `active`: minted from a `startup` and stepped to
  `active` as a generation that was working when the machine began, with the cursor past both starts, as before.
- **sim-soft-stamps-stand-in** — the soft renewals' stamps and the soft trigger's due start stay the scenario's durable
  records: the renewal act writes them (`softRenewalObservedMs`), and this piece has no writer for them.
- **g4-per-identity-on-mono** (review 1925, N5(b); review 2003 F6) — every identity has its own accumulator now, so G4
  reads each identity's lines apart, and an `obs` line carries a `mono` stamp: "advances exactly as the clock does"
  compares with the monotonic clock, and a line without one (the control rows) with its wall stamp, which no day skews.
  The stamp is the scenario's own clock, and whether a pass advanced the accumulator is the scenario's answer (no abort
  landed, or the stored time moved), never the stamp the decider under test wrote: an `observeTime` that leaves the
  stored mono stale escaped all 200 seeds under the old oracle and is red now (a MUTATION row). A step gap must have a
  cause (review 2006 R7): a freeze, a crash or a boot line since the identity's last observation, or a `deltaMs` equal to
  the clock's own step, which the `obs-gap` line now carries as `mono`. A stored stamp skewed 31 s behind the clock (each
  30 s beat then answers a step gap) passed G4, G2 and G3 before, and is red now (a MUTATION row).
- **g5-counts-reports** (review 2003 F7) — G5 counts the `report` lines the host writes, the day's first (n=1's) aside:
  at every pass that runs to its end, each start that had to mint did, and no mint is without a start or out of number.
  A start has to mint when it is a `startup` or its conversation is the identity's newest reported one at the first
  completed pass after it; a start whose conversation a later start replaced before a completed pass judged it may mint
  nothing (an aborted pass may have judged it already; slug
  uuid-checked-against-the-current-row: measured on seed 67, an unplanned resume of the old conversation and the
  renewal's clear landing in one beat). A `report` line carries the start's source and conversation.
- **gaps-from-the-pass** — the scenario's `obs-gap` lines are the gaps the pass recorded (`GenerationsResult.gaps`, now
  with each identity), as the decider answered them, never re-derived from the rows; so an `observeTime` that drops a
  freeze's gap still goes red on G4.
- **pass-takes-an-observe-decider** — `GenerationsDeps.observe` is the observed-time decider, `observeTime` unless given,
  so the scenario hands the pass the mutants its observed-time cases test.
- **store-statements-prepared-once** — the generation functions (and `startsSince`) prepare each statement once per
  database: the simulator's day runs 2,880 passes a seed, and compiling the same SQL on every call made 200 seeds take
  about two minutes (now about 50 s).
- **review-1925-n3-n5a** — the REACHABLE row is retitled (it is one degraded view, reached by two chains), and X6's comment
  in `check.py` gives each reason a degraded generation is unproven. N1 (have `check.py`'s mutation modes diff
  `reachable`) is optional and not taken here.
- **census-names-three-non-binding-sites** (narrowed by review 2003 F11; its count made true again by review 2006 N7 and
  R6) — the run/session census (ARCH-62) counts three sites of this piece that decide no binding, each named in
  `NOT_BINDING_SITES` with its reason: the live generation looked up by the start's session (a coordinator's identity is
  its session id), the compactions cache pruned by session id, and `newestStart`'s test that a later start is of the same
  identity. The wave boundary's read is the binding module's own rule (`runsClaimedBy`, counted beside `childrenOf`).
- **process-id-is-a-uuid** — the watcher draws the lane's process id with `Deps.time.entropy.uuid()`: the entropy port
  refuses fewer than 16 bytes, and a first draft's `hex(8)` failed every pass (seen in CI's log, not in a red case). A
  watcher case now runs one real sweep over the real time ports and goes red on it.
