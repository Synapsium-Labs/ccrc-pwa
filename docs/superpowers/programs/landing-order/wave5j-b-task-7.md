# Wave 5j-b, Task 7: the doors' decisions, records and notices

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave5j-doors.md`, Task 7, with section 11's C1, C2, C4 and C7
(D-9049, D-9050). Base: `origin/main` at `31d5d9ae26`.

## What changed

- `server/src/coord/landingWrites.ts`
  - The command union gains `withdraw` and `pause` (`setBy: 'operator'`, `actor`); `LandingDoorParse` and
    `parseLandingDoor` read the two closed bodies.
  - `LandingMutationFacts` gains `flagsRow` and `pinTimes`.
  - The decision gains `unchanged`, `pause` and `withdraw`, with `LandingRecipient` and `LandingDependantRecipient`.
    The decider answers pause first (no identity-conflict or recovery refusal reaches it), then the shared identity
    conflict, then `decideWithdraw` (section 4.4's steps 2 to 7).
  - The write answers `LandingPauseWrite`, `LandingWithdrawWrite` and `LandingAuthorityWriteOf<C>` are declared here,
    beside `LandingAuthorityWrite`, because the retyped notice reads them (Task 8's store returns them).
  - `landingWithdrawNoticesOf` builds the notices; `landingMutationNotice` takes one pair, `{ command, result }`.
  - `landingCommandOf` returns the `entry`/`order` arms only.
  - The header's "Refusal order for both commands" is rewritten for four commands (C4).
- `server/src/coord/landingEntry.ts`: `landingRecordOf` builds the two door records; `landingFactsOf` answers
  `flagsRow` (a `landing_projects` row was read) and `pinTimes` (the raw row's `pinnedAt`, read strictly).
- `server/src/coord/landingWritesAct.ts`: its one call moves to the pair, and its command and `write` port are typed
  for the `entry`/`order` arms (C7). Task 8 adds the overloads.
- `server/src/coord/store.ts` (interim, this commit only): the noop and order answers carry `released`, and the decide
  step throws for the three door arms. Task 8 replaces the throw with the door arms. Nothing calls a door in this commit.

## Choices the plan left to the builder, said here

- **C1's shape.** The order decision carries `released: {entryId, pr}[]`: the targets the source's readable old edges
  named, the new edges drop, and whose STORED word is `withdrawn`. The writer's order answer carries it as
  `LandingAuthorityWrite`'s `released` (`[]` for a creation and a no-op). `landingMutationNotice` owes the order arm's
  event when the setter is not the claimant (as before) or when `released` is not empty, and the body ends
  `; released the withdrawn #<pr>, …`. The route helper for entries and order must drop `released` from its answer
  with `coordinator`: that line is in `routes.ts`, so it rides Task 9's hunk.
- **The pause door's "known" rule** (section 4.4, step 1): an entry of the project, a listed recovery subject whose own
  project is this one, or a `landing_projects` row. A subject of another project listed here only through an identity
  conflict does not make this project known by itself (a case pins it).
- **The notice's ISO time.** `landingWrites.ts` must name no `Date` (its purity test reads the identifier as a clock), so
  the body's time is formatted by a small integer conversion in the file (`isoOf`). A case pins
  `2026-11-25T14:30:05.007Z`.
- **The entry notice's last sentence** is the one that applies: the retreat-then-advance sentence for a run-bound entry,
  the cannot-come-back sentence for a run-less one.

## Departure (D-9093, issued by the coordinator)

**Superseded by fix round 1** (`wave5j-b-fix-round-1.md`, R1; the plan's section 13, C12): the copy described below
was deleted, `landingWrites.ts` imports `LANDING_ENTRY_TERMINAL` from the shared landing vocabulary, and the purity
case admits that one file. The paragraph is kept as the record of what was first built.

- **D-9093** `withdraw-terminal-mirror`: the withdraw arm needs `LANDING_ENTRY_TERMINAL`'s classification, and
  `landingWrites.ts` takes no value import (its purity test, `valueImports(p)` is `[]`). The file therefore mirrors the
  map as an exhaustive `Record<LandingEntryState, boolean>` (a new state is a compile error there), and a new
  `landing-writes.test.ts` case drives the withdraw arm over every state in `LANDING_ENTRY_STATES` against the L0 map,
  for the entry and for a dependant, so a drift is red. The alternative was a third facts field the plan did not name.

## Tests

- New cases in `landing-writes.test.ts`: `parseLandingDoor`; withdraw steps 1 to 6 and their collisions; acceptance of a
  head, an ejected, a quarantined and an unreadable-sha row; recipients (claimant, creation claimant, `unclaimed`,
  `unrecorded`); direct dependants only; an unreadable dependant; pause and resume; the records' round trip through
  `parseLandingJournal` with `deviceActor` over a real, long User-Agent cut in a space and inside an emoji; the notices'
  identities and bodies; the doors' feed events; C1's release cases; the terminal mirror.
- `mail-routes.test.ts`: `NOT_CODES` admits `landing-withdrawn` and `landing-held` (Step 0).
- The whole-facts builders gain the two fields: `landing-facts-scope.test.ts` (both literals), `landed-decide.test.ts`
  (both builders) and `landing-control.test.ts`. Measured with a typecheck over the landing test files: `landed-lane`,
  `landing-terminal-damage` and `landingFixture.ts` build no typed facts object whole and needed nothing.
- The seven moved `landingMutationNotice` calls keep their expectations; the helper's result gained `released: []`.
  No case was inverted.

## Measured

- Red first: the file failed at collection (the new describe blocks call functions that did not exist).
- Green, each alone: `landing-writes` 105, `landing-facts-scope` 3, `landed-decide` 34, `landed-lane` 44,
  `landing-control` 59, `landing-terminal-damage` 64, `mail-routes` 61.
- The server typecheck is clean. The tests-inclusive typecheck was killed by the test slice's memory cap
  (`ccrc test --local`, exit 137, `MemoryMax=6G`); a typecheck of the 22 landing and census test files it would cover,
  through a scratch project, is clean.
