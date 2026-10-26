# Wave 4, PR3: journal compaction (task note)

This note is PR3's record for the wave's ledger pull request (Global Constraints, "Ledger edits"). The coordinator folds it into the
plan and the programme ledger; this PR edits neither.

## Status

- **Phase A** (no edit to `watch.ts`, `store.ts`, `mail-routes.test.ts`, `delegation-wave3.integration.test.ts` or
  `delegation-watch.test.ts`): Task 3.2 (the planner), Task 3.3 (`compactJournal`, the carried file, recovery's carried rules),
  Task 3.4's checkpoint half (the delete walk, the repair's step 0, the retained reader in the repair), Task 3.5 (C1) and Task 3.1's
  builder door (`upkeepIntervals`, `DelegationDurability.upkeep`, `rowsChanged`).
- **Phase B** (after PR1 releases its files): Task 3.1's call site in the lane, Task 3.4's two store methods, Task 3.7, the kebab arm
  W4-K2 in `mail-routes.test.ts`, the closed list in `delegation-wave3.integration.test.ts`. Task 3.6 waits for #1578.
- The lane rows the plan places in `delegation-watch.test.ts` go into a NEW file, `server/test/delegation-compaction-lane.test.ts`,
  because PR4 holds the old one (the coordinator's brief).

## Deviations found

- **D-7011** — `k6-keeps-a-whole-call-and-its-ager`: K6 is wider than the plan's "pair" in two ways, both found by reading the fold
  against the plan's text.
  - A call is every record on its key from the first listing-carrying PreToolUse up to and including the first PostToolUse. The plan
    says the next Bash record closes the pair, but the fold folds a second PreToolUse into the first call (it compares the latest
    listing), so a PostToolUse kept with only one of two PreToolUses could open, or compare, differently.
  - A carried call that the fold AGED (no PostToolUse within `DELEGATION_BASH_PENDING_MS`) carries the record that aged it. Without it,
    a recovery over the compacted set ages the call later, and a PostToolUse with no listing that the original fold read as unpaired is
    read as the call's PostToolUse instead, which opens an activity on a covered record and refuses `fold-refused`.
  Rows: `D-7011 (a)` and `D-7011 (b)` in `delegation-compaction.test.ts`; mutants D7011a and D7011b red them.
- **D-7012** — `k6-keeps-a-call-split-across-the-previous-cut`: a Bash call with a record in the current carried file and a record in the
  journal is carried whole, even when this cut removes the journal's record. The plan's Task 3.3 argument ("old carried lines that no
  rule selects any more are gone already, which is safe because nothing holds them") misses this case: after a crash between a SECOND
  compaction's two renames, the new carried file sits beside the UNCUT journal, and a PreToolUse carried last time for its straddling
  PostToolUse, dropped now because this cut also removes the PostToolUse, leaves that PostToolUse in the uncut journal without its
  PreToolUse, and recovery refuses `fold-refused`. Found by W4-C13b on the first implementation. Rows: `D-7012` (the planner) and
  W4-C13b; mutant D7012 reds both.
- **D-7013** — `mutation-table-as-measured`: three pins of the plan's mutation table measure differently in this implementation.
  - W4-CM13 (skip the writer reopen) is EQUIVALENT: `writer-close` already drops the descriptor, and the writer reopens lazily by path,
    so it cannot write into the unlinked inode. The variant that also skips the close (W4-CM13v) is killed by W4-C14.
  - W4-CM22 (keep the launch-index entry) is not seen by W4-C22, because `memory-prune` drops a cut launch's entry before the
    retirement runs (and a retired run's launch is always cut). A new builder row, W4-C22b, kills it; CM22 with CM36 together red W4-C22.
  - W4-CM20 (retire an activity a record above S names) reds W4-C21, not W4-C20: in the fixture the record above S is a SubagentStop,
    which recovery reads as a stop-only candidate that ages out, so recovery stays ready.
- **D-7014** — `planner-and-applier-interface-details`: small departures from the plan's interface text.
  - The planner imports VALUES from `delegation-model.ts` as well as types (`parseDelegationInstant`, `encodeDelegationNaturalKey`,
    `DELEGATION_BASH_PENDING_MS`, and `isDelegationWorkerIndex`, moved into the model from the checkpoint so the planner's
    run-with-its-workers rule and the fold read one definition). No new outward edge: the checkpoint already imports the model.
  - `compactJournal` answers `{ kind: 'skipped', reason: 'not-ready' }` on an applier that is not ready, instead of throwing through
    `requireReady()`.
  - The builder keeps a private `equalPreSequence` map (the sequence of the PreToolUse behind each 'equal' Bash-call fact), because the
    fact itself carries only the PreToolUse's journalId and `memory-prune` needs its position. The clone census becomes 18 collections.
  - `DelegationDurabilityDeps.eventsDeleteChunk` and `repairDelegationProjection`'s `deleteChunk` are test seams for
    `DELEGATION_EVENTS_DELETE_CHUNK`.
  - Phase A only: the projection port's `countEventsAtOrBelow` and `deleteEventsBetween` are optional, because the production port
    (`watch.ts`) and the store methods are phase B's; phase B makes them required.
- **D-7015** — `unused`
- **D-7016** — `unused`

## W3-M38, amended (for the wave-3 plan, plan :991)

W3-M38 is to read: "Add a journal rewrite, truncate, rename or remove caller other than the tail heal and `compactJournal`, or drop a
carry rule", with its rows `delegation-wave3.integration.test.ts`'s closed list and W4-C6..C8.
