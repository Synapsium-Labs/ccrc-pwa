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
  simulator cases passed before and after the move commit.
- `INVARIANT_MAP` holds Table 11.7a's eighteen rows. `server/test/single-definition/invariant-table.test.ts` reads the
  spec's table and checks the names both ways, in order.
- `invariantVerdict` answers one of six arms per row. A row with no predicate reads `not-applicable` with a reason:
  `tables-absent` (what it reads is not built) or `predicate-not-built` (its tables are on main and its predicate has a
  ticket: I8 and I13's message half, `invariant-message-predicates`; I18, `invariant-i18-seal-predicate`), as call 1219
  ruled. I9 reads `simulator-only`.

**Task 5, the predicates and the gatherer.**
- First, Confirm the restore's database side moved unchanged from the private `rowsSide` in `overlordRestoreState.ts` to
  `overlordRestoreRows.ts#restoreRowsSide` (L3), with two characterization cases committed before the move and green on
  main (`server/test/overlord-restore-rows.test.ts`); Confirm's four suites (78 cases) stayed green.
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
    line is unmeasured. Subject `seq:<n>`.
  - **I7:** read only under a `coherent` guard (else `unmeasured` with the guard's cause), comparing Confirm's own two
    sides (`restoreRowsSide` and `journalSideOf` over the fold), each reading an absent side as the narrowest (ruling F8),
    on both sides alike, so a box with no rung on either side holds. Violated: the rows bind and the journal does not,
    or bind another session or generation; the term differs; the model class differs; the account set has a pool the
    journal lacks, or `untagged` where the journal is not; the rung ranks above the journal's; a journal latch is not
    standing, or stands at a wider cap. Subject: the field (`latch:<cause>` for a latch).
  - **I17:** a fired timer with no mail id, naming no mail, or naming a mail not from `timer` or not to its setter; a
    cancelled timer with a mail id; a state word this build cannot name is unmeasured. Joined by `mailId`, never the
    subject. A role timer (setter `overlord`, its mail to `overlord`) holds, measured with the timers worker.
- `invariantFacts.ts#gatherInvariantInput` reads the window (every retained line above the prune floor) and the four rows'
  facts inside one `tx()` that writes nothing, with no await between two reads; the journal is read in the same span. A
  table not migrated reads `absent`; a failed read `unmeasured`; a failure to open the span makes every arm `unmeasured`.
- `server/test/sim/livePredicate.ts` runs a production row through `invariantVerdict` as a simulator `Invariant`. The timer
  day runs production I17 over its own database on every default seed and catches a planted fault (a fired row stamped
  with another mail's id).

**Task 6, the findings, the runner, the rows.**
- Migration 128 (renumbered at the merge of main, see below): `overlord_invariant_findings`, its partial unique index, and
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
  `ladder-latch`. `stampReach` still has no live caller, so I2 holds over no rows.
- The latest migration was 127; the timers piece (#3388) also takes 128, so this entry is renumbered at the merge.

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
- `designation-baseline-is-a-dependency`: the gatherer takes the kept designation line's read as a dependency; with none
  wired, I5 reads unmeasured, never a pass or a violation.
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

## What runs on a box from the merge

With the `invariants` row at its seed, `shadow`:
- the watcher's `invariants` lane runs once a minute, one pass at a time. A pass reads the Shadow lanes row and the
  sequence head (one indexed read), and gathers only when the head moved, the mode changed, or ten minutes passed;
- a gather reads, inside one transaction that writes nothing: every retained sequence line above the prune floor; the
  reach-stamped asks and items and the bound outbox rows; the designation row; the ladder rows; the authority journal file
  and the guard's state; every fired or cancelled timer and the mail rows they name;
- the write-locked span, measured on fixture databases (median of 21 gathers, the worst in brackets): 5,000 lines and 200
  fired timers, 6.6 ms (58 ms); 50,000 and 2,000, 69 ms (159 ms); 180,000 and 5,000, 331 ms (456 ms). The sequence keeps 90
  days; at the few hundred lines a day the kinds on main stamp, the window stays near the first two figures;
- it records each new finding as a `shadow` row and logs one line when a verdict word moves. It raises no latch and no
  item: nothing reaches the operator until the row is set Live.

## Known limits

- I5 reads unmeasured until the kept designation line's read is wired (the other sequence run's store).
- A finding over a line the retention lane prunes resolves on the next pass (the subject is no longer listed), though it
  was not measured holding.
- The gather re-reads the whole window each pass the head moves; an incremental walk from a cursor is the obvious next
  step if the window grows past the measured figures.
- I2's state arm, I7's decision-model rows, I11's rung arm, I8, I13's message half and I18 are Later, each named in its row.
