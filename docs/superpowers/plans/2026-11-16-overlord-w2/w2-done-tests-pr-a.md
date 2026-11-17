# Overlord W2 done tests, PR A: notes for the ledger

What PR A (Tasks A1 to A4 of [`w2-done-tests.md`](w2-done-tests.md)) found while building,
for the coordinator to fold into the programme's ledger. The plan's own deviations stand as written; these are the
departures and measurements the build added, by slug. No D-number is minted here.

## In short

- **Built as the plan states:** `shared/doneTests.ts`, `runs.closePr` (migration 90: overlaps A (#2949) landed 85, decision model A (#2948) 86, row revisions (#2965) 87, renewal readings A (#2962) 88 and remaining work A (#2951) 89 first, renumbered on the coordinator's word),
  `closePrFactsOf`, `parseDoneTest`, `targetVerdict`, `readTarget`, the reader's census, the writers-map pin of
  `runs.closePr` and the routing reference's paragraph.
- **The close's characterization came first:** `close-run-characterization.test.ts` was green on `main`'s code before
  the close was touched, and stays green after, with the one additive column set aside.
- **Nine departures,** each below; two follow the coordinator's rulings on review 2377 (F2, F7). None changes a rule the plan states; each makes a rule measurable on this tree.

## Departures

| Slug | What the plan says | What the code does, and why |
|---|---|---|
| `lineage-recorded-at-is-seconds` | DT7: a lineage entry counts when its `recordedAt` is at or after the run's `openedAt` | `.prhistory`'s `recordedAt` is whole seconds (ccd writes `int(time.time())`) and `runs.openedAt` is milliseconds, and the fold converts neither. The window is measured in seconds: an entry counts when `recordedAt >= floor(openedAt / 1000)`, so one recorded in the second the run opened counts |
| `stored-lineage-parse-throws-in-the-store` | Table 3 row 15: an unparsable lineage is `unmeasurable`, `lineage-unreadable` | `runs.prLineage` is parsed by the store's hydrator (`JSON.parse` in `hydrateRun`), so corrupt JSON text throws there and `readTarget` answers row 1, `unmeasured` (it holds). Row 15 is reached by a lineage that parses but is not a list of `{ pr, recordedAt }` entries. Holding is the safe side; a later piece may give the hydrator a measured read |
| `census-allows-the-decider-and-the-close-argument` | Task A4 Step 2: no file outside `store.ts` and `doneTestRead.ts` reads `closePr` | The census counts a read as a member access, an index by name or a destructuring. `doneTests.ts` reads the gathered fact `closePr` (the decider, which the plan's §9 names the only one) and is allowed beside the gatherer; `close.ts` passes `closePr:` as a key of the writer's input, which is not a read |
| `target-facts-reuse-read-failure` | §11 Task A3's interface spells `run: … \| 'absent' \| 'unreadable'` | The pair is declared once, as `shared/agent-protocol.ts#ReadFailure`, and `single-definition/vocabularies` refuses a second spelling, so `TargetFacts` names `ReadFailure`. Same two words |
| `close-pr-merged-is-the-phase-readers-predicate` | DT7: `{ pr, merged, head }` | `merged` is `prstate.ts#isMergedRow`, the predicate every phase reader uses, so a pull request a merge train landed (closed with the train label, proven by the train record) records `merged: true`. `mergedFactsOf`, the landing line's reader, leaves such a row to its PR-keyed reader; the done test reads the run's PR as merged either way |
| `census-admits-the-plan-sync-pr-link` | Task A4 Step 2: no file outside `store.ts` and `doneTestRead.ts` reads `prLineage` | The Linear plan sync (#2941, merged after this plan) reads a run's newest lineage entry in `linear/planSync.ts#prOfRunFrom` for the PR number to link, never whether it merged. The census admits that ONE function (review 2377 F4): it cuts `prOfRunFrom`'s body out, requires the rest of the file to read neither column and the body never to say `merged`, each with a planted control |
| `census-admits-the-edge-facts-until-remaining-work-b` | Task A4 Step 2: no file outside `store.ts` and `doneTestRead.ts` reads `prLineage` | Remaining work A (#2951, merged during this fix round) reads a run's lineage in `coord/programmeFactsStore.ts#edgeTargetFacts` for the PR numbers it lists (review 2377 F3's reader). The census admits that one function as it admits `prOfRunFrom` (body cut out, the rest of the file reads neither column, the body never says `merged`), until remaining work B moves the edge check onto `readTarget` and deletes the row (pending the coordinator's word) |
| `pr-merged-reads-the-own-close-only` | Table 3 row 12 and DT7: a PR the run replaced, merged inside its window, passes `pr-merged` through the lineage (row 13: closed ends it; row 14: another phase is `phase-<word>`) | The coordinator's ruling on review 2377 F2: `pr-merged` means "this run's PR N merged". The fold keeps lineage entries by the shared workspace branch, and ccd stamps an outgoing PR when it is replaced, inside the replacing run's window, so no entry says whose it is. Only the run's own `closePr` naming N answers it (passed if merged, ended if not). N named only by an in-window lineage entry is `unmeasurable:lineage-unattributed`, whatever its phase; outside the window, or nowhere, `not-this-runs-pr`. Rows 13 and 14 fold into it. The coordinator folds the plan's text in the ledger PR |
| `pr-merged-unreadable-close-is-unmeasurable` | Table 3 has no `pr-merged` row for an unreadable `closePr` | An unreadable `closePr` answers `unmeasurable:close-record-unreadable` before the lineage is read (review 2377 F7): the safe side, since the record that alone answers the target cannot be read |

## Measured

- **Growth:** `schema.ts` +13 (one migration and its comment), `store.ts` +10 (the column, its read, its strip and its
  one `UPDATE`), both within 40.
- **CI round 1:** `mail-routes.test.ts`'s kebab census found the done-test words undeclared; they are admitted through
  `coord/doneTests.ts#isDoneTestKebab`, and dropping one word from its map reds the scan.
- **CI round 2:** after decision model A (#2948) took 86, `decision-model-records.test.ts`'s migration case rolled back to
  `COORD_SCHEMA_VERSION - 1`, so the next migration re-added `closePr` and refused ("duplicate column name"). The case now finds
  its own slot by its DDL and undoes every later entry first: renewal readings A's shared text (its claim, co-edit granted),
  with `[...after].reverse()` for `toReversed`, which the tests' compile target lacks.
- **Mutation:** `parseDoneTest` 10 of 10 mutants killed, `targetVerdict` 30 of 30, floors 1. The vocabulary's spelled
  list kills `review-passed` added to the measured map. The close's record kills a `closePr` written from the
  lineage's newest merged entry (the reuse case) and a dropped wire strip. The census kills a weakened read pattern and
  a planted second reader in `close.ts`.
- **The reuse case:** a workspace whose `.prhistory` holds wave 1's merged PR records wave 2's own open PR as not
  merged, and `run-closed` reads it `ended`, never `passed`.
- **Fix round 1 (review 2377), each red on `616528f0e` and green after:**
  - F1: `prstate.ts#closePrFactsOf` records the bound row only when the verified claim names its number. A later wave on
    the same workspace that opened no PR (`prNumber: null`) still sees wave 1's merged row bound to the branch, and now
    records nothing (`close-pr-record`: the unit cases and the PR-less wave closed for real, then read through
    `readTarget`; on `616528f0e` it recorded `{ pr: 5, merged: true }` and `run-closed` read `passed:pr-5`).
    `done-tests-policy` carries the same wave as facts. `head` is stored as before.
  - F2: rows 12 to 14 and the review's timing case (wave 1's PR recorded inside wave 2's window) in `done-tests-policy`
    and `done-test-read`; the sweep now asserts that `pr-merged` passes or ends only on a `closePr` naming its PR.
  - F6: `review-passed` naming a run that is not a work run is `facts-mismatch`.
  - F5: the reader census also sees an unprefixed one-line `SELECT`, a parameter destructure and a typed destructure,
    with a control each; the old pattern reds the control. F4: removing the rest-of-file check reds its control.
  - F8: `mail-routes`' scan admits a done-test word only while no other coordination file quotes it; a planted quote in
    `close.ts` reds it.
  - F9: `RunRow.closePr`'s comment names no slot; `DONE_TEST_REFUSALS` is pinned to the words `parseDoneTest` gives.
  - Mutation: `targetVerdict` 31 mutants (six rewritten for the new rows, one added for F6), `parseDoneTest` 10, all
    killed, floors 1.

## For the index

- **Residual (review 2377 F1), for the ledger:** `close.ts`'s `landOnClose` mark reads the same verified line's bound
  row and predates this PR; a PR-less later wave on an unmarked workspace still reads wave 1's merged row there. Left as
  it is, on the coordinator's word.
- **Follow-up (review 2377 F4):** `linear/planSync.ts#prOfRunFrom` links `prLineage.at(-1)`, the newest REPLACED PR,
  often an earlier wave's; `runs.closePr` now offers the run's own PR as the source.
- **Carried to remaining work B (review 2377 F3, the coordinator's ruling):** B's edge check asks `doneTestRead.ts`
  through `readTarget`, and never reads a run's lineage or `closePr` itself.

- Relay A and the coordinator doors' counter call `parseDoneTest` from `relayBody.ts` and `requestAnswers.ts`, the
  file names their plans give; the census allows exactly those two beside `doneTestRead.ts`. A different file name is a
  one-line change to the census.
