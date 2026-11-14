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
- **clear-shadow-walk-resets-the-view** — when `continuity` is live and a walk begun in shadow left its residue,
  `clearShadowWalk` removes it and resets the row to `GEN_ACTIVE` (proven, no counters), as a generation that was working
  when the machine began.
- **hold-off-absolute** (review 1902 F4) — `setHoldOff` stores `holdOffUntilObservedMs` absolute on the identity's
  accumulator (`observed.ms + HOLD_OFF_MS`), computed inside the compare-and-set; the gather (`softTimesOf`) subtracts
  `mintedObservedMs` to put it on the generation's own age, with a case at a nonzero `mintedObservedMs`.
- **start-reported-at-column** (reviews 1949 G3, 1975) — `startReportedAt`, the start's `reportedAt`, is stored on the row,
  so a start older than the live generation's is recognised as late without a join.
- **prev-model-column** — `prevModel`, the model of the generation a mint ends, is stored on the new row, so a resumed
  start's model class can be compared with the conversation it resumed (`resumed-other-class`).
- **starts-since-takes-a-limit** — `startsSince` takes an optional limit, so the pass reads at most 200 starts in SQL.
- **wave-boundary-read** — the wave boundary is read by `newestClaimedWorkRuns` (`continuityStore.ts`): the two newest work
  runs the coordinator claims, newest first.

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
- **other-source-mints** — a start whose source is `other` (a word outside the vocabulary) mints like `startup`'s
  siblings; only `compact` and `fork` are skipped by source.
- **swap-before-crash** — the outcome is `renewed` for a generation that was `clearing`; else `swapped` when the account
  changed; else `crashed` when it was `active` on the same row incarnation (both incarnations known); else `woken`. The plan
  lists `crashed` before `swapped`; a start on another account is a swap even when the incarnation stayed.
- **intent-unread** — `roleFactsOf` gets `intentDeclared: 'unmeasured'`, as the mail pace does: the declared intent has no
  store read. A session that claims no open run therefore reads undecided `coordinator-or-plain` and mints nothing; such
  starts are counted (`skipped.undecided`) and logged once a pass.
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
  no start and leaves the cursor.
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
- **at-rest-only** — a generation whose effective state is not `active` or `degraded` is not judged and not gathered.

## The simulator runs the lane (Task 4)

- **crash-invariant-is-g8** — the scenario already had a G6 (the deadline and budget bound) and a G7 (soft renewals
  from `active` only) from the renewal deciders' fix rounds, so the plan's new crash invariant is **G8**: after every pass
  that runs to its end, each identity has exactly one live generation, and the newest start it reported minted it.
- **crash-inside-the-pass** — a crash "at any step" is placed inside a pass by a write that aborts, and every write after
  it (`sim_fault`, triggers on `continuity_generations` and `continuity_cursor`), at a drawn write index, more often
  while a start waits; the server goes down after that pass. The pass is synchronous, so this is a crash at a write
  boundary, never an interleaving. Measured: committing the cursor before the mint's transaction turns G8 red on seed 3.
- **sim-real-store** — the generations live in an in-memory coord.db migrated by `MIGRATIONS`, with `continuity` live;
  the lane mints and ends the coordinator's generations from the reported starts, and every machine step goes through
  `stepGeneration` with its compare-and-set. One database serves every seed (migrated once, its day's tables emptied
  per seed): a database per seed churned native memory past the test slice's cap over `CCRC_SIM=full`'s 5,000 seeds.
- **sim-overlord-mints** — W1a's lane cannot tell the Overlord's role (no designation before W1), so the scenario mints the
  Overlord's generations from its reported starts through the same `mintGeneration`, in the lane's order, standing in for
  W1's designation.
- **sim-day-starts-working** — both identities begin the day at n=1, `active`: minted from a `startup` and stepped to
  `active` as a generation that was working when the machine began, with the cursor past both starts, as before.
- **sim-soft-stamps-stand-in** — the soft renewals' stamps and the soft trigger's due start stay the scenario's durable
  records: the renewal act writes them (`softRenewalObservedMs`), and this piece has no writer for them.
- **g4-per-identity-on-mono** (review 1925, N5(b)) — every identity has its own accumulator now, so G4 reads each
  identity's lines apart, and an `obs` line carries its `mono` stamp: "advances exactly as the clock does" compares with
  the monotonic clock, and a line without one (the control rows) with its wall stamp, which no day skews.
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
- **census-names-three-non-binding-sites** — the run/session census (ARCH-62) counts three new sites; none decides a
  binding, so each is named in `NOT_BINDING_SITES` with its reason: the live generation looked up by the start's session
  (a coordinator's identity is its session id), the compactions cache pruned by session id, and the wave boundary's read of
  the coordinator's two newest claimed work runs.
- **process-id-is-a-uuid** — the watcher draws the lane's process id with `Deps.time.entropy.uuid()`: the entropy port
  refuses fewer than 16 bytes, and a first draft's `hex(8)` failed every pass (seen in CI's log, not in a red case). A
  watcher case now runs one real sweep over the real time ports and goes red on it.
