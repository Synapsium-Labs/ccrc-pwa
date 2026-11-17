# Account organization, PR D: the builder's notes

**Run** 2316 (programme `overlord`, #2491) · **Plan** `docs/superpowers/plans/2026-11-16-account-organization.md`
(#2909), Tasks D1 and D2 · **Spec delta** #2910

These notes are for the coordinator's ledger. They name departures by slug. No D-number is used or invented.

## In short

The generation row keeps the previous generation's account, `prevLane`, in one migration. The Overlord's renewal table
gains a hard row, `resumed-other-org`, read from `startOtherOrg` apart from `startResumed`. The row is the Overlord's
only. An unknown organization makes the row blind, never "same".

## D1 Step 1: the gate

`GenRow.lane` names the account the start ran on. The path: `FleetWatcher.sweepGenerations` (`server/src/watch.ts`)
builds the pass's registry from the session records, with `lane` set to the record's `wrapper` (null when the wrapper
is unmeasured). `generationStart.ts` takes that lane for a mint only when the start is its identity's newest start "as
the registry's account goes" (`newest`), else null. `mintGeneration` stores it as `lane`. A wrapper is a roster
account's `id` (`AccountDef.id`). So the gate passes, and no deviation is recorded for it.

## What was built

| Task | What | Where |
|---|---|---|
| D1 | Migration 86: `ALTER TABLE continuity_generations ADD COLUMN prevLane TEXT` | `server/src/coord/schema.ts` |
| D1 | `GenRow.prevLane`, read by `genRowOf`; the mint writes the newest row's `lane`, as `prevModel` | `server/src/continuity/continuityStore.ts` |
| D2 | `'resumed-other-org'` in the trigger vocabulary, after `resumed-other-class` | `shared/continuity.ts` |
| D2 | `RenewalInputs.startOtherOrg`, its predicate, `TRIGGER_CLASS` hard, the Overlord's row after `resumed-other-class` | `server/src/continuity/renewalDue.ts` |
| D2 | `renewalInputsOf` computes Table 3 through `orgRelation`; `GenerationsInput.orgOf` | `server/src/continuity/generationsLane.ts` |
| D2 | The watcher passes `orgOf` from the roster the server holds (`cfg.roster`, which `reloadRoster` swaps) | `server/src/watch.ts` |

## Departures, by slug

- `migration-85-not-84`: the brief said the next free slot was 84. Responses B (#2914) landed 84 on `main` before this
  branch was cut, so this entry was 85. Overlaps (#2949) then landed 85, and in fix round 1 the coordinator ruled a merge
  of `main` and the next slot, 86. Whoever lands second renumbers again at landing, on the coordinator's word.
- `own-account-unknown-is-unmeasured`: Table 3 has no row for a resumed generation whose own `lane` is null (the
  registry's wrapper was unmeasured, or the start was not the newest). It reads unmeasured, `account unknown`, the same
  direction as `previous account unknown`, and never "same".
- `org-of-absent-is-unlabelled`: `GenerationsInput.orgOf` is optional. Absent, every account reads unlabelled, so a resume
  onto another account is unmeasured and the row is blind (the safe direction). Only the watcher passes it.
- `own-account-unknown-is-unmeasured` and `org-of-absent-is-unlabelled` stand as recorded (the coordinator's rulings in
  fix round 1); Table 3 gains the own-account row in the programme's ledger PR, not here.
- `org-read-at-the-lane-pass`: the relation uses the roster the server holds when the lane reads the row, as Table 3
  says. A label changed after a resume changes the reading on the next pass; the reading is never stored.

## Rollback exposure (review 2335 F1)

`resumed-other-org` is the first trigger word added after the vocabulary shipped. An older build's `genRowOf` refuses a
row whose `dueWhy` or `blind` carries a word it does not know, and `liveGenerations` is all-or-failure, so one such row
fails that build's whole generations read. That is fail-closed by design (review 2003 F13). It takes a rollback below
this PR onto a database that already holds such a row. The migration's comment says the same.

## Peer grants

- `server/src/continuity/continuityStore.ts`, `generationsLane.ts`, `shared/continuity.ts` and the lane test's import pin
  (claim 4570, run 2244): additive co-edits as described above. Run 2244's #2934 changes the same `renewalInputsOf` call
  (a sixth argument, `renewNow`) and the same import list (three entries), so whoever lands second keeps both sides.
- `server/test/sim/renewalDeciderSets.ts` (claim 4574, run 2246): the renewalDue section only.
- Run 2244 asked in turn for `schema.ts`, `watch.ts` and `coord-db.test.ts` (this run's claim 4668), and was granted. Its
  hand-offs migration also takes a slot after 84, so one of the two renumbers at landing, on the coordinator's word.

## Tests and mutation

The new `continuity-generations-org.test.ts` holds D1 (the migration, the mint's `prevLane`, an older row), every row of
Table 3, the row's class, place and roles, its blindness apart from `resumed-other-class` and `resumed-long`, the feed's
word, and the watcher reading the labels from the roster it holds. It was red first (18 of 18 cases that touch the change).

Green: the new file, `continuity-renewal-due`, `continuity-vocabulary`, `continuity-generations-store`,
`continuity-generations-lane`, `continuity-renewal-acts`, `continuity-renewal-feed`, `continuity-soft-renewal`,
`run-close-switch`, `rings/*`, `single-definition/*`, `sim/mutation-floors` (the `renewalDue` floor), `growth-check`
armed, `topology-clean`, `anchors`, `citations`, `deviation-refs`, the server and pwa type checks, and the whole `coord*`
set, 29 files, one at a time. Under load (15 to 20) four cases timed out at their 20 s limit and passed alone with a longer
one: two in `coord-db` (each about 21 s, a fresh chain of the whole migration list) and two in `coord-store` (the delegation identity
table and the outstanding-mail clamp, which inserts 510 rows, about 27 s). None touches this change. The full test-tree type check was killed by the
test slice's shared memory cap, so the touched test files were type-checked through a scratch config, and CI runs the whole.

`mutation-run.py` mutates Python modules only, so the mutants were applied one at a time by a script that saves the file,
applies one replacement, runs the named test file and restores the saved copy. All 12 were killed:

| Mutant | Killed by |
|---|---|
| an unmeasured `startOtherOrg` folds to false (the predicate) | `continuity-renewal-due` |
| the row classed soft | `continuity-renewal-due` |
| the row in the coordinator's list | `continuity-renewal-due` |
| `unknown` folds to "same" (the lane) | `continuity-generations-org` |
| previous account unknown folds to false | `continuity-generations-org` |
| own account unknown folds to false | `continuity-generations-org` |
| a start that did not resume is read by the relation | `continuity-generations-org` |
| the mint writes null for `prevLane` | `continuity-generations-org` |
| the mint writes its own lane for `prevLane` | `continuity-generations-org` |
| the read drops `prevLane` | `continuity-generations-org` |
| the watcher passes no labels | `continuity-generations-org` |
| the pass drops `orgOf` | `continuity-generations-org` |

## Growth

Lines added and removed against `main`, all far within the 40-line limit with no waiver:
`server/src/continuity/generationsLane.ts` +20 −3, `server/src/coord/schema.ts` +17 (comment and one statement),
`server/src/continuity/renewalDue.ts` +11 −5, `server/src/continuity/continuityStore.ts` +10 −7, `server/src/watch.ts` +2,
`shared/continuity.ts` +1. `growth-check` runs green armed.
