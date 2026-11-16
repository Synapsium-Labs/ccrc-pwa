# Portfolio PR B: build notes

What the build of Tasks 4 and 5 of `w1-portfolio.md` found, for the coordinator to fold into the programme ledger. Each
departure is a slug; the coordinator mints the numbers.

## Question 1, as the operator answered it

Operator item 328 (2026-11-16) answered question 1 **yes**: "A coordinator's pin counts, shown as ratified by the
coordinator." This is against the plan's recommendation, so the build takes the plan's "If the operator answers yes" path
at every site tagged "(question 1)" (slug **`coordinator-pin-ratifies`**, citing item 328):

- `shared/ledgers.ts#COORDINATOR_SOURCE_RATIFIES` is `true`, and `goalRatification`'s `coordinator` case answers ratified.
- The decider's coordinator case and the re-pin case read ratified again (`server/test/ratificationCases.ts`,
  `server/test/goals-ratification.test.ts`); the mutation floors are measured again (below).
- The Goals panel says "Ratified by the coordinator", and shows no Ratify button on a coordinator-written version, which
  reads ratified (`pwa/src/ledgers/ledgerWords.ts#ratificationWords`, `pwa/test/goals-panel.test.tsx`).
- The card renders a coordinator's goals as ratified (`server/test/continuity-card-facts.test.ts`).
- Columns, writers, doors and the item arm are as the plan has them. A version that rests on an item still does not
  ratify (question 3).

**What a merge arms:** a coordinator's goals render as ratified from this pull request's merge, on the card, in the goals
read and on the Goals panel. Rows written before the migration hold no source and read "Not recorded" until their next
write.

## Measured

- **Migration slot.** The ratification columns are one migration. `main` has 80 entries, so this branch writes it at its
  real next slot, 81 (`COORD_SCHEMA_VERSION` is `MIGRATIONS.length`, so a slot cannot be written ahead of the entries
  below it). It lands as 83 after authority A (81) and responses A (82), renumbered at landing on the coordinator's word;
  the entry's header says so, and `coord-db.test.ts` finds it by its DDL.
- **Mutation floors:** `goalRatification` (9 mutants: R-1 to R-9) and `itemAnswered` (4: A-1 to A-4), every mutant
  killed, each floor 1. The plan's red checks are R-1 (the item arm ratifies a ticked item), R-2 (`unreadable` read as
  `operator`), R-3 (question 1: the `coordinator` case ignores the constant) and A-1 (an `open` item with a `tickedAt`).
  `portfolioFor` gains P-FOR-28 to P-FOR-33 for F10; all killed, its floor stays 1.
- **Task 5's red checks**, measured by hand and restored from a saved copy: the door skipping the stamp check reds the
  stale case in the store test and in the route test; a no-op that tests the source instead of the verdict reds the case
  "(question 1) ratifying a coordinator pin, which already reads ratified, changes nothing".
- **Table 11.6.** `goals-changed` has its row, after `rank-changed`, and the refusal-table guard is green with `codeOnly`
  empty.

## Carried findings

- **F10 (review 2130), `rebuilt-wave-never-aged-from-its-stand-in`.** Durations are clamped at zero: a cycle whose close
  is stamped before its dispatch is 0, and so is the age of a wave dispatched after `now`. A run a disaster rebuild minted
  (`CoordStore#reconstruct`) has its `dispatchedAt` set to the rebuild's time. The facts read now marks such a run
  `rebuilt`: it is the one writer that inserts a run already dispatched, at its own `openedAt`, with no claimant
  (`portfolioStore.ts`' `REBUILT`). `portfolioFor` never measures from it. A rebuilt open wave is left out of
  `oldestOpenMs` and counted in the new `oldestOpenUnmeasured`, and a rebuilt done wave counts in `cycleUnmeasured`, so no
  measure understates. Both fixes are in this pull request's files (`shared/portfolio.ts`, `portfolio.ts`,
  `portfolioStore.ts`).
- **F1 (review 2130), `plan-fetch-text-contradicts-its-clip-rule`.** PR A already follows question 10's clip rule in the
  asks read, against the plan's fetch text (Task 2, about line 682). This pull request changes nothing there. The plan's
  text still reads as before; the ledger should carry the correction.

## Departures found in the build

- **`ratified-goals-stay-untrusted-on-the-card`**: the plan (question 1) says a coordinator's goals render "as ratified,
  outside the untrusted block". The card's renderer (`server/src/continuity/card.ts`, §3.3.2) puts every goal inside an
  untrusted block, ratified or not, and its own test pins that ("a goal's ratifier may be a coordinator"). A coordinator's
  goal text is session-written, so printing it bare would let it pose as a card row (review 1892, F1). The build changes
  only the gatherer (`cardFacts.ts`), as the plan's file list does: those goals now list under "goals marked ratified:",
  still inside the block. Moving them out would be a renderer change and a security call, so it is left to the
  coordinator.
- **`goals-version-parser-in-shared`**: the ratify door's body is read by `parseGoalsVersion` in `shared/ledgers.ts`,
  beside the `GoalsVersion` type the console and the store share, as PR A did for the rank body
  (`rank-body-parser-in-shared`).
- **`ratify-results-are-words-not-codes`**: `ratifyGoalsVersion` answers `unknown` and `stale`, which the door words as
  `not-found` and `goals-changed`. A quoted kebab word under `server/src/coord` must be a declared code
  (`mail-routes.test.ts`), as PR A found for the rank writer.
- **`ratify-404-reads-older-server`**: on the console, a 404 from the ratify door reads "This server does not offer
  ratifying goals" and takes the button away. An unknown route answers `{ ok: false, error: 'not-found' }` too, so the two
  cannot be told apart. The door's own `not-found` cannot meet a version the panel drew, because no pin or modification
  is ever deleted. `auth-off` says ratifying needs sign-in and takes the button away as well. This is
  `ledgerWords.ts#ratifyFailureOf`, L1.
- **`rollback-leaves-a-stale-source`**: an older build that re-pins after a rollback writes the text and not the
  source, so the stored source may describe older text until this build's next write. The migration's comment names it.
  Nothing refuses it.

## For the spec-fixes list

- §3.8 says "Until W3, only this door ratifies". Item 328 makes a coordinator's own pin ratify as well.
