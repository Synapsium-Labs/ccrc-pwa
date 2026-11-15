# Fix round 1

## R1

**Defect.** `landingBindingOf` chose open rows from the damage-folded display state. A raw `landed`, `closed` or `withdrawn` row with an unreadable `afterIds`, `fixesMain`, `pinnedAt`, `ejections`, `ejectionKind` or `runId` displays `unknown`, counted as open, and held the binding at `projection-unreadable` for good (no repair visits a raw terminal row).

**Fact added.** `LandingMutationFacts.stateWords` (`landingWrites.ts`): the stored state word of every entry of the project, `'unrecognised'` when it is outside the L0 vocabulary. Built in `landingFactsOf` from the raw row, before the display fold. `landingBindingOf` calls a row open when its word is `unrecognised`, `unknown`, nonterminal, or has no record (fail closed). The `clear` predicate, the precedence order, recovery and identity handling are unchanged.

**Tests.** `test/landing-terminal-damage.test.ts` (real `CoordStore`; raw landed/closed/withdrawn with six damaged columns: display `unknown`, stored word terminal, binding `ready` for the clean head, one cue to its creator, second pass `duplicate`, raw bytes unchanged; a closed re-pin of a damaged closed row stays `kept`; controls for raw pinned, unknown and `parked-v9` with damage and undamaged, and an independent recovery hold). `landing-control.test.ts`: the ORDER-unknown cases rewritten to the real reader's shape. Fixtures that build `LandingMutationFacts` carry the field.

**Red-first note.** The tests were written after the implementation in this session, so the red is measured by mutation, below, not against the old code.

**Mutations** (`landingLine.ts` saved, restored with `cp`, `cmp` equal; run: `ccrc test --` vitest on `test/landing-control.test.ts` and `test/landing-terminal-damage.test.ts`):

| Mutation | rc | Red |
|---|---|---|
| (a) openness from display state | 1 | `ORDER-unknown: a damaged terminal row ...` and all 18 `raw <landed/closed/withdrawn>, <damage>: displays unknown ... cue queues once` |
| (b) `'unrecognised'` treated terminal | 1 | `AssertionError: unrecognised: expected { mode: 'ready', ... } to match object { mode: 'held', ...}`; `ORDER-unknown (fix round 2)`; the real-store `raw parked-v9` controls |
| (c) missing record treated terminal | 1 | `AssertionError: expected { mode: 'ready', entryId: 107, ... } to match object { mode: 'held', ...}` (pure case only; the store always writes a record per entry) |

**Green.** Slice of 11 landing files: 427 passed, rc 0. Production typecheck rc 0. `typecheck-tests` 12 passed. single-definition and rings: 45 files, 1487 passed. Armed `growth-check`: 94 passed. No OOM kill occurred.

**Limitation.** `landingOrder` counts a display-`unknown` row as an outstanding dependency, so a row whose `afterIds` names a damaged terminal row stays `empty-or-blocked`; that is the 5e display contract, not this seam.
