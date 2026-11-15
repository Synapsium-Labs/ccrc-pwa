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

## R3
**The earlier CI workaround (d5c8bb4d0), recorded truthfully.** Task 1 shipped `landedCallStep(call: CcdResult)` answering `parse | failed | not-ran`. The PR's first fast CI run failed two whole-tree guards no local selection had run: `consolidation-census` ("every `runCcd(` site answers the not-ran arm") and the `mail-routes` kebab-token scan (the `'not-ran'` act word). Commit d5c8bb4d0 satisfied both by moving the `res.ran === false` block (retry memory write, `stopped: 'link'`) back into the L4 lane and narrowing `landedCallStep` to the ran arm. That put a policy decision in delivery code; review 2123 (A1) and the coordinator's ruling R3 rejected it.

**The correction.** `landedCallStep(call: CcdResult)` in `landed.ts` (L1) reads `call.ran === false` first and answers `{act:'not-ran'; answer; stopped}`, carrying the retry answer (`{act:'retry', missingField:false}`) and the stop word (`'link'`), so the lane holds no constant policy choice. `landedPass` calls it on the line after `runCcd(`, applies `call.answer` and `call.stopped` on `not-ran` (no read counted), and reads no `ran` itself. Behaviour is unchanged: stop word, memory written, `read` not incremented on not-ran, ran-failed backs off and continues (existing rows in `landed-lane.test.ts` pin these and stayed green).

**Census row.** `'landedCallStep'` added to `RAN_CARRY_READERS` (the designed carried arm); window, regexes, `RAN_TABLE` and the count pin untouched. `'not-ran'` added as one `NOT_CODES` entry in `mail-routes.test.ts`'s wave 5i block.

**Tests.** `landed-decide.test.ts`: `landedCallStep` rows (not-ran with exact carried values, parse, failed) and an ownership check that `landedLane.ts` (comments stripped) holds no `.ran` and no `missingField: false`. Red first: 2 failed, 32 passed (the not-ran row got no `not-ran` act; the ownership scan found the lane's `res.ran`). The ownership check first read the lane with `readFileSync`, which `single-definition/advance-switches` counted as a new literal source pin on `landedLane.ts` (red); it now reads through `scan/parse.ts` `parseFile` (no pin).

| Mutant | Command (file) | Failing assertion | rc | Restore |
|---|---|---|---|---|
| M-R3a `landedCallStep` without its `ran === false` arm | landed-decide + landed-lane | 4 failed: `expected { act: 'failed' } to deeply equal { act: 'not-ran', ... }`, and three lane link-stop rows | 1 | cmp equal, green |
| M-R3b lane reads `res.ran === false` again | landed-decide | ownership: `expected ... not to match /\.ran\b/` | 1 | cmp equal, green |
| M-R3c `'landedCallStep'` out of `RAN_CARRY_READERS` | consolidation-census | REAL test: `expected [ 'server/src/coord/landedLane.ts:91' ] to deeply equal []` | 1 | cmp equal, green |
| M-R3d `'not-ran'` out of `NOT_CODES` | mail-routes | `not-ran is not a declared MailRejectCode, ...` | 1 | cmp equal, green |

**Green.** landed-lane, landed-decide, consolidation-census, mail-routes, pr-timeout-budget: 5 files, 190 passed, rc 0. single-definition, rings and coord-policy-rings: one real red (the pin above, fixed), then green; production tsc clean; armed `growth-check` 94 passed. The tests-inclusive tsc suite was OOM-killed by the slice cap in several runs (rc 1, flaking on its directory-coverage cases); a later run alone: 12 passed, rc 0; an earlier alone run also passed 12.
