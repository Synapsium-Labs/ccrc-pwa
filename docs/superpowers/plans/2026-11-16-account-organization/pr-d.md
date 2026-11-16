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
| D1 | Migration 85: `ALTER TABLE continuity_generations ADD COLUMN prevLane TEXT` | `server/src/coord/schema.ts` |
| D1 | `GenRow.prevLane`, read by `genRowOf`; the mint writes the newest row's `lane`, as `prevModel` | `server/src/continuity/continuityStore.ts` |
| D2 | `'resumed-other-org'` in the trigger vocabulary, after `resumed-other-class` | `shared/continuity.ts` |
| D2 | `RenewalInputs.startOtherOrg`, its predicate, `TRIGGER_CLASS` hard, the Overlord's row after `resumed-other-class` | `server/src/continuity/renewalDue.ts` |
| D2 | `renewalInputsOf` computes Table 3 through `orgRelation`; `GenerationsInput.orgOf` | `server/src/continuity/generationsLane.ts` |
| D2 | The watcher passes `orgOf` from the roster the server holds (`cfg.roster`, which `reloadRoster` swaps) | `server/src/watch.ts` |

## Departures, by slug

- `migration-85-not-84`: the brief said the next free slot was 84. Responses B (#2914) landed 84 on `main` before this
  branch was cut, so this entry is 85. Several open PRs hold 84 or more; whoever lands second renumbers at landing, on
  the coordinator's word.
- `own-account-unknown-is-unmeasured`: Table 3 has no row for a resumed generation whose own `lane` is null (the
  registry's wrapper was unmeasured, or the start was not the newest). It reads unmeasured, `account unknown`, the same
  direction as `previous account unknown`, and never "same".
- `org-of-absent-is-unlabelled`: `GenerationsInput.orgOf` is optional. Absent, every account reads unlabelled, so a resume
  onto another account is unmeasured and the row is blind (the safe direction). Only the watcher passes it.
- `org-read-at-the-lane-pass`: the relation uses the roster the server holds when the lane reads the row, as Table 3
  says. A label changed after a resume changes the reading on the next pass; the reading is never stored.

## Tests and mutation

To be filled in with the measured runs before the push.
