# Portfolio PR B: build notes

What the build of Tasks 4 and 5 of `w1-portfolio.md` found, for the coordinator to fold into the programme ledger. Each
departure is a slug; the coordinator mints the numbers.

## Question 1, as the operator answered it

Operator item 328 (2026-11-16) answered question 1 **yes**: "A coordinator's pin counts, shown as ratified by the
coordinator." This is against the plan's recommendation, so the build takes the plan's "If the operator answers yes" path
at every site tagged "(question 1)" (slug **`coordinator-pin-ratifies`**, citing item 328):

**The pin only (review 2240 F3, the coordinator's ruling).** The item says a coordinator's *pin* counts. A change to the
definition of done is operator-only (O3, coordinator-autonomy spec), so a coordinator's modification never ratifies. The
plan's "(question 1)" sites, as built after fix round 1:

- `shared/ledgers.ts#COORDINATOR_SOURCE_RATIFIES` is `true`, and `goalRatification`'s `coordinator` case answers ratified
  for the pin only: the decider takes the version kind (`of: 'pin' | 'modification'`), and a coordinator's modification
  reads `source-does-not-ratify` ("Not ratified: written by the coordinator"). An item-cited one reads as before ("rests on
  item N's answer", until W3), so the honest path is never weaker than the uncited one.
- The decider's coordinator case and the re-pin case read ratified; the new modification case reads not ratified
  (`server/test/ratificationCases.ts`, `server/test/goals-ratification.test.ts`); mutant R-10 drops the pin-only scope.
- The Goals panel says "Ratified by the coordinator" on a coordinator's pin, with no Ratify button, and offers Ratify on a
  coordinator's modification (`pwa/src/ledgers/ledgerWords.ts#ratifyOffered`, `pwa/test/goals-panel.test.tsx`).
- The card renders a coordinator's pin goals as ratified, and says so: "ratified by the coordinator" inside the fenced
  block (`server/test/continuity-card-facts.test.ts`, `server/test/continuity-card-render.test.ts`).
- Columns, writers, doors and the item arm are as the plan has them. A version that rests on an item still does not
  ratify (question 3). The spec's §3.8 bullet, C18 step 2 and the item-328 row of the answers table say "pin" (the head
  commit's `Ledger-Edit` trailer).

**What a merge arms:** a coordinator's pin goals render as ratified from this pull request's merge, on the card, in the
goals read and on the Goals panel. Rows written before the migration hold no source and read "Not recorded" until their
next write.

## Measured

- **Migration slot.** The ratification columns are one migration. The branch was built when `main` had 80 entries, so it
  wrote the entry at its real next slot, 81 (`COORD_SCHEMA_VERSION` is `MIGRATIONS.length`, so a slot cannot be written
  ahead of the entries below it; 83 could not exist yet). Authority A (#2895) then landed 81, and on the coordinator's word
  the branch merged `main` once and the entry became 82. Responses A (#2884) then landed 82, and on the coordinator's word
  the landing merge took `main` again and the entry is **83**, after the response record's tables. `coord-db.test.ts`
  finds the entry by its DDL, and `run-close-switch.test.ts` undoes it and replays thirty.
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
  source. For the pin this is closed in fix round 1 (F2: a source stamped before the text reads unrecorded); for the
  definition of done it is accepted (`done-when-provenance-survives-a-rollback`). The migration's comment names both.

## Fix round 1 (review 2240)

- **F1, ruling: attribution is the trust model (spec Table 3.8a).** `ccd/ccrc-api`'s `goals.pin`, `goals.modify` and
  `goals.merged` rows take the pane's pair as `calls.record` and the note door do: a bodyless call is `no-body`, a body that
  names `byId` or `byUuid` is `bad-body` and is never sent, and the client appends the pane's pair last
  (`server/test/ccrc-api-goals.test.ts`, measured red with the block removed: 10 of 11). **Residual:** a same-user process
  holding the box token can still forge the pair with a raw HTTP call; the client stops the accident and the stale case,
  not that forger (slug `goals-attribution-is-the-pane`).
- **F2.** The pin's source counts only when `ratifiedAt >= inShortAt` (`shared/ledgers.ts#pinSource`, mutants P-1 to P-4;
  the rollback sequence is a case of `goals-ratification.test.ts`). The definition-of-done half is accepted as the
  migration's comment states (slug **`done-when-provenance-survives-a-rollback`**). `writers-map.test.ts`' goals census
  now covers the text the sources describe: the pin's `specPath`, `inShort`, `inShortAt` and `doneWhen`, and a
  modification's `text`, `ruling` and `itemId`.
- **F3, ruling:** above. Slug `coordinator-pin-ratifies` now reads "the pin only".
- **F4.** The goals read carries `doneWhenVersion` (additive, optional; absent from an older server), the version that
  wrote the stored list. The panel draws the list beside that version's verdict and Ratify button, or on its own with its
  verdict and no button when the writer is unrecorded, unreadable or not shown (`ledgerWords.ts#doneWhenPlacement`).
- **F5.** `ratificationWords` and `ratifyOffered` read the reason and the source through the shared own-key guards
  (`isRatificationWhy`, `isRatifiedByKind`): a word this build cannot name reads "Could not read whether this is
  ratified", with no button.
- **F6.** `setSpecPin` takes a `WrittenSource` (every kind but the operator's), so only `ratifyGoalsVersion` writes
  `operator`; `addModification` derives its source from the row's `itemId` (`shared/ledgers.ts#modificationSource`, mutants
  M-1 and M-2), and the route no longer decides it.
- **F7, ruling.** Migration 83 gains `ratifiedActor` on both tables: the account gate's actor of the operator's ratify
  (its device label and session hash), NULL for every other source, cleared by a re-pin. In the writers census and the
  run-close-switch replay; the route test checks it is written.
- **F8.** The card's ratified goals say who ratified them inside the fenced block ("ratified by the coordinator", "by the
  operator", "by the answer to an item"; a word it cannot name, "by an unknown source"). `shared/continuity-card.ts`'s
  stale comment now says every goal is untrusted.
- **F9.** `doneWhenBy` moves only when the list's text changes: a re-pin with the same list, or with none, keeps the list's
  provenance. **Residual:** a list an earlier pin wrote follows the current pin's verdict (there is no per-list stamp); in
  W1 every pin is the coordinator's, and the panel shows that list beside the pin it is ratified with.
- **F10, ruling: accepted.** "The programme's own coordinator" is the run's current claimant. The reclaim door being open
  while sign-in is dark is the dark mode's known residual (slug `ratifying-chair-follows-the-claimant`).
- **Nits.** `shared/portfolio.ts`' `oldestOpenMs` comment names the all-rebuilt case; `RATIFICATION_WHYS` is gone, and its
  map is consumed by `isRatificationWhy`.

## For the spec-fixes list

- §3.8 said "Until W3, only this door ratifies". Item 328 makes a coordinator's own pin ratify as well; this pull request
  corrects §3.8, C18 step 2 and the item-328 row to "pin" (review 2240 F3).
