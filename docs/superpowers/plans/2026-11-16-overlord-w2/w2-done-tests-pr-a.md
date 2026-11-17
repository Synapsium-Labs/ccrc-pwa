# Overlord W2 done tests, PR A: notes for the ledger

What PR A (Tasks A1 to A4 of [`w2-done-tests.md`](w2-done-tests.md)) found while building,
for the coordinator to fold into the programme's ledger. The plan's own deviations stand as written; these are the
departures and measurements the build added, by slug. No D-number is minted here.

## In short

- **Built as the plan states:** `shared/doneTests.ts`, `runs.closePr` (migration 86: overlaps A (#2949) landed 85 first, renumbered on the coordinator's word),
  `closePrFactsOf`, `parseDoneTest`, `targetVerdict`, `readTarget`, the reader's census, the writers-map pin of
  `runs.closePr` and the routing reference's paragraph.
- **The close's characterization came first:** `close-run-characterization.test.ts` was green on `main`'s code before
  the close was touched, and stays green after, with the one additive column set aside.
- **Five departures,** each below. None changes a rule the plan states; each makes a rule measurable on this tree.

## Departures

| Slug | What the plan says | What the code does, and why |
|---|---|---|
| `lineage-recorded-at-is-seconds` | DT7: a lineage entry counts when its `recordedAt` is at or after the run's `openedAt` | `.prhistory`'s `recordedAt` is whole seconds (ccd writes `int(time.time())`) and `runs.openedAt` is milliseconds, and the fold converts neither. The window is measured in seconds: an entry counts when `recordedAt >= floor(openedAt / 1000)`, so one recorded in the second the run opened counts |
| `stored-lineage-parse-throws-in-the-store` | Table 3 row 15: an unparsable lineage is `unmeasurable`, `lineage-unreadable` | `runs.prLineage` is parsed by the store's hydrator (`JSON.parse` in `hydrateRun`), so corrupt JSON text throws there and `readTarget` answers row 1, `unmeasured` (it holds). Row 15 is reached by a lineage that parses but is not a list of `{ pr, recordedAt }` entries. Holding is the safe side; a later piece may give the hydrator a measured read |
| `census-allows-the-decider-and-the-close-argument` | Task A4 Step 2: no file outside `store.ts` and `doneTestRead.ts` reads `closePr` | The census counts a read as a member access, an index by name or a destructuring. `doneTests.ts` reads the gathered fact `closePr` (the decider, which the plan's §9 names the only one) and is allowed beside the gatherer; `close.ts` passes `closePr:` as a key of the writer's input, which is not a read |
| `target-facts-reuse-read-failure` | §11 Task A3's interface spells `run: … \| 'absent' \| 'unreadable'` | The pair is declared once, as `shared/agent-protocol.ts#ReadFailure`, and `single-definition/vocabularies` refuses a second spelling, so `TargetFacts` names `ReadFailure`. Same two words |
| `close-pr-merged-is-the-phase-readers-predicate` | DT7: `{ pr, merged, head }` | `merged` is `prstate.ts#isMergedRow`, the predicate every phase reader uses, so a pull request a merge train landed (closed with the train label, proven by the train record) records `merged: true`. `mergedFactsOf`, the landing line's reader, leaves such a row to its PR-keyed reader; the done test reads the run's PR as merged either way |

## Measured

- **Growth:** `schema.ts` +13 (one migration and its comment), `store.ts` +10 (the column, its read, its strip and its
  one `UPDATE`), both within 40.
- **Mutation:** `parseDoneTest` 10 of 10 mutants killed, `targetVerdict` 30 of 30, floors 1. The vocabulary's spelled
  list kills `review-passed` added to the measured map. The close's record kills a `closePr` written from the
  lineage's newest merged entry (the reuse case) and a dropped wire strip. The census kills a weakened read pattern and
  a planted second reader in `close.ts`.
- **The reuse case (F1):** a workspace whose `.prhistory` holds wave 1's merged PR records wave 2's own open PR as not
  merged, and `run-closed` reads it `ended`, never `passed`.

## For the index

- Relay A and the coordinator doors' counter call `parseDoneTest` from `relayBody.ts` and `requestAnswers.ts`, the
  file names their plans give; the census allows exactly those two beside `doneTestRead.ts`. A different file name is a
  one-line change to the census.
