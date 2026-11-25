# Overlord W1, the sequence, PR B2: the invariant monitor

Wave 234, run 3821. Plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md`, Tasks 4 to 6, less
Task 5's "The ladder's lines first" (wave 233, the other sequence run). This note is what the ledger should learn; the
coordinator folds it in. No deviation number was allocated: departures are recorded by slug.

## What was built, task by task

**Task 4, the move and the table.**
- `SequenceLine` and `Violation` moved from `server/test/sim/sequence.ts` to `server/src/coord/invariants.ts`.
  `SequenceLine` is the production wire line (`shared/overlord-sequence.ts#SequenceWireLine`), so the simulator's lines gain
  `actorKind` and `known`; `SimSequence.append` fills them (`server`, `true`), and three hand-built line helpers in the
  simulator suites gained them (one of them in the timer day, by the timers worker's yes). Characterization: the same 117
  cases passed before and after the move commit (`796e65d641`), each run locally over six files: `overlord-sequence` (29),
  `sim/generation-day` (39), `sim/run` (20), `sim/stall-coord-blocked-day` (11), `sim/timer-day` (7) and `sim/world` (11).
- `INVARIANT_MAP` holds Table 11.7a's eighteen rows. `server/test/single-definition/invariant-table.test.ts` reads the
  spec's table and checks the names both ways, in order.
- `invariantVerdict` answers one of six arms per row. A row with no predicate reads `not-applicable` with a reason:
  `tables-absent` (what it reads is not built) or `predicate-not-built` (its tables are on main and its predicate has a
  ticket: I8 and I13's message half, `invariant-message-predicates`; I18, `invariant-i18-seal-predicate`), as call 1219
  ruled. I9 reads `simulator-only`.

**Task 5, the predicates and the gatherer.**
- First, Confirm the restore's database side moved unchanged from the private `rowsSide` in `overlordRestoreState.ts` to
  `overlordRestoreRows.ts#restoreRowsSide` (L3), with two characterization cases committed before the move and green on
  main (`server/test/overlord-restore-rows.test.ts`); after the move, 78 cases stayed green, run locally over four files:
  `overlord-restore-rows` (2), `overlord-restore` (55), `overlord-restore-generation` (10) and `overlord-restore-route` (11).
- The four W1 predicates, pure and total, each a first-match table over its domain:
  - **I2, structural arm:** a reach-stamped ask or item with not exactly one bound outbox row; a bound row whose source
    has no stamp. A bound row of a source kind I2 does not name is unmeasured. Subject `ask:<id>` / `item:<id>`.
  - **I5, term arm:** the binding walked in seq order from the kept designation line: `live` binds its id, `retired` of
    the bound id ends it, `pending` and `failed` never move it (so a pending or failed rebind reads the standing body,
    and either stamp order of a rebind's go-live and retire binds the new body). A line whose actor kind is `session` must
    come from the bound session; `server` and `operator` lines are never read (so a `ladder-latch` line whose actor text
    names a session but whose kind is `server` is not that session's act, and every message line, always `server`, is
    not read); a designation line is a move of the binding, not a write under it. A line this build cannot name whose
    actor may be a session is unmeasured; a designation line it cannot name makes the binding unknown until the next
    known one. With no designation line before a session line, the current binding decides when none follows, else the
    line is unmeasured. Subject `seq:<n>`. The kept line is the sequence store's `designationBaseline`, passed in
    `index.ts` as it is (call 1240): the gatherer's field is required, so a composition root that drops it does not build.
  - **I7:** no authority field is wider than the journal's, and the term and the model class equal the journal's (call
    1286: neither has a width, so a row the journal does not witness is I7's subject in either direction). Read only under
    a `coherent` guard (else `unmeasured` with the guard's cause), comparing Confirm's own two
    sides (`restoreRowsSide` and `journalSideOf` over the fold), each reading an absent side as the narrowest (ruling F8),
    on both sides alike, so a box with no rung on either side holds. Violated: the rows bind and the journal does not,
    or bind another session or generation; the term differs; the model class differs; the account set has a pool the
    journal lacks, or `untagged` where the journal is not; the rung ranks above the journal's; a journal latch is not
    standing, or stands at a wider cap. Subject: the field (`latch:<cause>` for a latch).
  - **I17:** a fired timer with no mail id, naming no mail, or naming a mail not from `timer` or not to its setter; a
    cancelled timer with a mail id; a state word this build cannot name is unmeasured. Joined by `mailId`, never the
    subject. A role timer (setter `overlord`, its mail to `overlord`) holds, measured with the timers worker. The spec's
    "the setter's stamp still matches" part is not built: the row names it Later in its `waitsOn`.
- `invariantFacts.ts#gatherInvariantInput` reads the window (every retained line above the prune floor) and the four rows'
  facts inside one `tx()` that writes nothing, with no await between two reads; the journal is read in the same span. A
  table not migrated reads `absent`; a failed read `unmeasured`; a failure to open the span makes every arm `unmeasured`.
- `server/test/sim/livePredicate.ts` runs a production row through `invariantVerdict` as a simulator `Invariant`. The timer
  day runs production I17 over its own database on every default seed and catches a planted fault (a fired row stamped
  with another mail's id).

**Task 6, the findings, the runner, the rows.**
- Migration 129 (renumbered from 128 at the merge of main `4fa87d73f8`, see below): `overlord_invariant_findings`, its partial unique index, and
  the `invariants` lane-arm seed row (`shadow`).
- `invariantFindingsStore.ts`: `recordFinding` (a live finding's blocking item under `OVERLORD_ITEM_PROGRAMME`, raised by
  `ccrc`, kind `do`, through the new `ledgersStore.ts#raiseItemCheckedInTx`, and its row, in one transaction; with the
  watcher's bound-row writer when the item is shown at its raise), `resolveFindings`, `openFindings`, `findingCounts`
  (M24, shadow and live apart).
- `invariantLane.ts#InvariantMonitor`, built once in `index.ts` by `invariantMonitorOver` and run by the watcher's
  `invariants` lane: arming from the Shadow lanes row (unreadable reads shadow); `invariantPassDue` (the head moved, the
  mode changed, the head could not be read, or `INVARIANT_TABLE_SWEEP_MS` elapsed); gather; verdicts; `findingMoves`;
  resolve; record. Live, the latch is raised first in its own transaction through `overlordLadderRead.ts#raiseLatch` as
  `serverActorOf('invariants')`; a refused raise records nothing; `latchedOf` reads `raised`, `standing` or `row-only`.
  One log line per moved verdict word (`verdictWordChanges`). The last pass is kept in memory for PR C's read.
- The ladder's tenth cause, `invariant-violation` (latch, cap `advise`, notice `item`); the Shadow lanes card's eighth row,
  `invariants`, with its words, and its line in `pwa/src/fleet/ShadowLanesSection.tsx`; the lane schedule's row
  (`INVARIANT_SWEEP_MS` a minute, `INVARIANT_TABLE_SWEEP_MS` ten).
- `OVERLORD_ITEM_PROGRAMME` in `shared/overlord-sequence.ts` (the other sequence run's yes), the quiz re-pointed to it in a
  commit of its own.

## Where main differed from the plan's "What exists today"

- The simulator's line lacked `actorKind` and `known`; the production line already had both, so the move made the simulator's
  name an alias of it (no type move in `shared/`).
- The ladder's delivery-facing raise is `overlordLadderRead.ts#raiseLatch(deps, cause, detail, raisedBy)`, not
  `raiseLatch(deps, cause, detail, raisedBy)` over a store; it takes the cap from the cause row. The restore latch raises as
  `serverActorOf('authority')`, so the monitor raises as `serverActorOf('invariants')`.
- Seven Shadow lanes rows, not four; `invariants` is the eighth. Ten ladder causes with this one.
- `AuthorityView` gained `decisionRows` and `lastConfirm`; Confirm's `RestoreSide` carries neither, so I7 compares no
  decision-model row (Later).
- Responses A and private store B are on main: their rows read `predicate-not-built` with their tickets (call 1219).
- The sequence kinds on main were `generation`, `designation` and `message`; the other run adds `ladder-rung` and
  `ladder-latch`. The plan said `stampReach` had no live caller; on main it has several (the ask release, the item raise and
  set-blocking paths, and the held drain, in `pushOutboxStore.ts` and `pushSender.ts`), so I2 reads real rows from the merge
  (review 3843 F6). The review found no healthy-box input that reads violated: the stamp and its bound row are written in
  one transaction, and a one-per-source index keeps one row.
- The latest migration was 127; the timers piece (#3388) also took 128, so this entry became 129 at the merge of
  `4fa87d73f8` (below).
- Main absorbed before the first push: `8886cf49c382e4627751bb11fe64f18da66e0a82` (the push probe answered two conflicts, and
  the coordinator said yes). The merge commit holds exactly the two both-sides resolutions and nothing else: in
  `server/test/mail-routes.test.ts`, main's `isProgrammeDoorWord` arm and this branch's `isInvariantKebab` arm, under this
  branch's failure message (main's was the base's); in `server/test/single-definition/core-vocab.test.ts`, main's
  `programmeLifecycleActs.ts` and this branch's four files in `HANDLE_HOLDERS`. Main added no migration, so 128 stands
  until the timers piece lands.
- One clash git did not mark: main's programme lifecycle W2 (#3353) also added `ledgersStore.ts#raiseItemCheckedInTx`, so
  the merged file defined it twice and no module importing it parsed. A commit of its own after the merge keeps one
  definition: this branch's, which takes main's four arguments plus an optional reach and throws when no transaction is
  open. Main's one caller, `programmeLifecycleActs.ts#proposeEndInTx`, runs inside `CoordStore`'s `tx()`, and the
  lifecycle's suites ran green on the result.
- The merge of `4fa87d73f87c3b475086bab3ad0e893fa8935238` (call 1240: #3395, the other sequence run, and #3388, the timers,
  both on main) conflicted in the seven files the coordinator measured, and nothing else. The merge commit keeps both
  sides: in `schema.ts` main's 128 (the timers) and this branch's entry as 129; the four migration pins (coord-db's counts
  and lists at 129; limit-samples rolls back 129, 128 and 127, its slot four from the end; the lifecycle's two following
  entries; run-close-switch's roll-back undoes 129 and counts seventy-six); both floor sets in `mutation-floors.json`
  (main's `keptDesignationLine` and `txWithAuthorityReceipt` keys, and the timers' keys, beside this branch's nine); both new
  tables in the writers map. After the merge, three of this branch's cases needed what main changed: the two timer fixtures
  pass main's new `setRestoreGeneration`, the cut-subject case gives the timer mail packer main's two restore fields, and the refused-latch case counts one more gather, because the latch's raise now
  stamps a `ladder-latch` line and so moves the head the pass was remembered at (one extra gather per new live finding).

## Departures, by slug

- `i7-reads-confirms-two-sides`: I7 reads the same two sides Confirm reads, an absent side the narrowest on both sides, not
  the plan's "an absent database row reads the ladder's default" (call 1219). The comparison is I7's own predicate.
- `i7-latch-cap-compared`: beside "a latch the journal holds is not standing", a latch standing at a cap wider than the
  journal's is violated too (wider authority, I7's own words).
- `not-applicable-says-why`: the `not-applicable` arm carries `why`, `tables-absent` or `predicate-not-built` (call 1219).
- `invariant-monitor-built-in-the-composition-root`: the monitor is built once in `index.ts` and handed to the watcher as
  one optional dependency, with no `CoordStore` delegates and no `WatcherCoordMember` (accepted, call 1219's follow-up).
  Absent (a test, a script), `sweepInvariants` returns at once: no pass runs, nothing is recorded, and PR C's read will
  answer that no pass has run, never a pass.
- `designation-baseline-is-a-dependency`: the gatherer takes the kept designation line's read as a dependency, and
  `index.ts` passes the other sequence run's `designationBaseline` as it is (call 1240; call 1286 on F9: no second rule,
  no second reader). The field is required. Its cases, in `invariant-facts.test.ts` over the real read below a real prune
  floor: the kept live line binds the window (a line from the bound body holds, one from another is violated); a
  designation line after the floor moves the kept line, and the window lines before it read unmeasured, never holds;
  review 3843's F9 (below the floor live a, retired a, pending b: the kept line is the pending, and a later session line
  from a is violated, nothing being bound); an absent sequence table stays the read's own unmeasured answer. In
  `invariant-lane.test.ts`, the real `invariantMonitorOver` with the read records the I5 finding in shadow.
- `three-predicates-deferred-by-ruling`: I8, I13's message half and I18 read `not-applicable` (`predicate-not-built`)
  though plan question 11 says a predicate joins with its tables when they are on main at build. Call 1219 waived it for
  these three on purpose, and call 1286 confirms it: the card behind I8 is still a placeholder, I13's message half needs the
  private store's entries (W2), and the responses plan assigns I18's seal predicate to responses B. A `not-applicable` row
  never reads as a pass and records nothing, so the monitor is smaller, not wrong. Their tickets,
  `invariant-message-predicates` (I8 and I13's message half) and `invariant-i18-seal-predicate` (I18), are entries of this
  programme's plan, among its follow-ups; the coordinator records them in the ledger at its next fold.
- `gather-reads-the-whole-window`: the window is every retained line above the floor, read each pass the head moves (see
  the measurement below).
- `ladder-row-case-in-the-monitor-suite`: the plan's seams case for the new cause row is in `invariant-lane.test.ts`,
  because the seams file is the other run's.
- `invariant-sets-apart`: the monitor's mutant sets live in `server/test/sim/invariantSets.ts`, not `sequenceSets.ts`, so
  the two runs never meet in one file.
- `three-runner-deciders-in-l1`: when a pass is due, how a latch answer reads, and which verdict words moved are L1
  deciders with their own floors, so the runner holds no decision.

## Mutation tables

Every mutant is killed (`server/test/sim/mutation-floors.test.ts`, each set run against its suite of
`invariantSets.ts`). Floors added at 1; none lowered, no pin raised.

| Decider | Mutants | Killed |
|---|---|---|
| `invariantVerdict` | 9 (V1–V9) | 9 |
| `i2Structural` | 4 (A1–A4) | 4 |
| `i5Term` | 13 (B1–B13) | 13 |
| `i7Authority` | 11 (C1–C11) | 11 |
| `i17Timers` | 6 (D1–D6) | 6 |
| `findingMoves` | 7 (E1–E7) | 7 |
| `invariantPassDue` | 5 (F1–F5) | 5 |
| `latchedOf` | 3 (G1–G3) | 3 |
| `verdictWordChanges` | 2 (H1–H2) | 2 |

Before: no floor for any of these keys (the floors test answers `expected value must be number`, every mutant already
killed). After: every key at 1, green.

Review 3843 F13: E5 used to remove its guard, so it died on a TypeError (an unmeasured verdict has no `unmeasured` list),
not on what it names. It now resolves an unmeasured verdict's open row, and the resolve-nothing case kills it by its
assertion (`expected [ 7 ] to deeply equal []`, measured by hand). The nine sets ran again after the fix round: 12 of 12
green (the nine sets, the baseline, the names check and the merge-base floor check).

By hand, outside the floors file (each mutant applied, the named cases run, the file restored with no diff):

| Mutant | Where | Red |
|---|---|---|
| the arming read always true | `invariantLane.ts#invariantMonitorOver` | 5 of the 6 arming-binding cases in `invariant-lane.test.ts` (all but the live row) |
| the arming read from another lane's row | the same | 2 of 6 (every other lane live; the live row) |
| a pass remembered before its record (the tip before the fix) | `invariantLane.ts#InvariantMonitor.pass` | the refused-latch, lost-record and failed-shadow-record retries |
| I17's mail found by its subject | `invariantFacts.ts`, the I17 read | the cut-subject case in `invariant-facts.test.ts` |
| the kept line's read dropped at the composition root | `index.ts` | the server source type check (TS2741: the field is required) |
| the read passed to the monitor but not to its gather | `invariantLane.ts#invariantMonitorOver` | the real-read case in `invariant-lane.test.ts` |
| the read made, its answer ignored (baseline null) | `invariantFacts.ts`, I5's facts | the first three real-read cases in `invariant-facts.test.ts`, and the lane's |
| F9's other ruling: the kept line is always the newest live one | `overlordSequence.ts#keptDesignationLine` | F9's case (a later line from a would read holds) |

The I5 wiring adds no decider, so no floor key: `i5Term` and the other sequence run's `keptDesignationLine` keep theirs.

## What runs on a box from the merge

With the `invariants` row at its seed, `shadow`:
- the watcher's `invariants` lane runs once a minute, one pass at a time. A pass reads the Shadow lanes row and the
  sequence head (one indexed read), and gathers only when the head moved, the mode changed, or ten minutes passed;
- a gather reads, inside one transaction that writes nothing: every retained sequence line above the prune floor; the
  reach-stamped asks and items and the bound outbox rows; the designation row; the ladder rows; the authority journal file
  and the guard's state; every fired or cancelled timer and the mail rows they name;
- I2 reads real rows from the merge: the reach stamp has live callers on main (see "Where main differed"). I5 reads the
  window from the kept designation line (call 1240); I7 and I17 read their tables;
- the write-locked span, measured once, by hand, with a script not committed, on fixture databases (median of 21 gathers,
  the worst in brackets): 5,000 lines and 200 fired timers, 6.6 ms (58 ms); 50,000 and 2,000, 69 ms (159 ms); 180,000 and
  5,000, 331 ms (456 ms). Only the lines and the timers were sized: the authority journal was absent and I2's asks, items
  and outbox rows were empty, so the journal's verified read and I2's reads are not in these figures. The sequence keeps 90
  days. An earlier draft of this note said the window stays near the first two figures at "a few hundred lines a day"; no
  measured rate stands behind that figure, so it is withdrawn: the window on a real box is not measured here;
- the pass is remembered only when every step succeeded, so a failed open read, resolve, raise or record is retried by
  the next pass, a minute later (review 3843 F8);
- it records each new finding as a `shadow` row and logs one line when a verdict word moves. It raises no latch and no
  item: nothing reaches the operator until the row is set Live.

## The first full run

The first full run on the pushed tip (`2e77441905`), Actions run 45659873610, was red in four server shards (3, 9, 11 and
12), on five cases in the four files below, which this branch's own named runs had not included; each is fixed in one
commit (`b3f5708511`), and each file ran green alone after it:
- `programme-lifecycle-migration.test.ts` pinned the lifecycle's migration as the last entry, and
  `limit-samples-store.test.ts` rolled a database back to its slot past every later migration: migration 128 moved both by
  one, and the roll-back now undoes 128 too (its table and its lane-arm seed row).
- `run-session-census.test.ts` (ARCH-62) counted two comparisons in `invariants.ts`, I5's retire of the bound session and
  I7's binding comparison; neither reads a run, so both are named in `NOT_BINDING_SITES` with that reason, beside the
  restore's own.
- `operator-message-readers.test.ts` refuses any string outside the private store that names its tables: I8's and I13's
  rows named `operator_messages` in their descriptive `tables` list. They now say "the private store's messages"; no code
  reads that list.

The two face mood floors that failed on the test box (it could not resolve `@ccrc/ui`) ran green in the `server 9/12` job
of both full runs, 45659873610 and 45666226732 (the second on `b3f5708511`, green), with the rest of
`mutation-floors.test.ts` (369 cases).

## Review round 1 (review 3843 at `b3f5708511`, call 1286)

The review found no defect in today's code: shadow raises nothing by any path, and every mutant is killed. The fix round:
- F1: the production arming binding (`invariantMonitorOver`) now has six cases on a migrated temp database: the seeded
  row, every other lane live, an unknown stored word, an absent row and an unreadable row raise nothing; a live row
  raises. The by-hand mutants are in the table above.
- F8: a pass is remembered only when every step succeeded, so a refused latch, a failed record or a failed resolve is
  retried a minute later, not up to ten minutes later. The refused-latch case retries with no clock advance.
- F10: the gatherer's unmeasured and malformed journal arms; I17 over the timer lane's own packed mail with a cut subject;
  a latch raised with its record lost, recorded as standing by the next pass.
- F13: mutant E5 replaced (above). F7: the monotone claim narrowed in `invariants.ts` and its case added. F3: I7's row and
  header say the term and the model class equal the journal's, with the ahead-and-behind case. F12: the Shadow lanes
  card says what the monitor does: a pass a minute, the invariants read again when the sequence moves, the mode changes
  or ten minutes pass.
- F2 waived (slug `three-predicates-deferred-by-ruling`); F9 is settled for the wiring merge (`designation-baseline-is-a-dependency`);
  F14 needs nothing (the repository lands by squash).

## Known limits

- The kept designation line is the newest one standing (the other sequence run's rule, call 1077), not the binding at
  the prune floor. Once a designation line is stamped above the floor, the kept line moves to it, so the window's session
  lines before the first designation line in the window read unmeasured (`no designation line before it`), never holds
  and never violated, until the retention lane prunes them. Measured by the moved-line case.
- A finding over a line the retention lane prunes resolves on the next pass (the subject is no longer listed), though it
  was not measured holding. So does a finding over a timer the timers lane purges after 90 days (review 3843 F11). In
  both, a live finding's item stays open: the operator sees the item and no open finding.
- The gather re-reads the whole window each pass the head moves; an incremental walk from a cursor is the obvious next
  step if the window grows past the measured figures.
- I2's state arm, I7's decision-model rows, I11's rung arm, I17's setter-stamp arm, I8, I13's message half and I18 are
  Later, each named in its row.

## The wiring merge (call 1240)

One ordinary merge of main `4fa87d73f8` (see "Where main differed"), then I5's kept-line read wired at the composition
root, its cases, and the fixture updates the merge needed. Each mutant in the by-hand table above was applied, its named
checks run red, and the file restored with no diff.
