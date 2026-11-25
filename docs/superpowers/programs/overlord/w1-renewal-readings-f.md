# Renewal readings F: the builder's departures

Departures from `docs/superpowers/plans/2026-11-14-overlord-w1/w1-renewal-readings.md` found while building PR F (Task 9: the
operator's words, `turns` and the soft `operatorQuietObservedMs` of the Overlord's generation), by slug. No D-number is minted
for them; the coordinator folds them into the plan's ledger. Measured on `main` at `66eb018733`.

## What ships

- **`turns`** (the wiring, `renewalReadingsWiring.ts`). For an Overlord generation, the private store's
  `messagesSince(g.startReportedAt)`: the messages recorded at or after the generation's start, passed through as the
  `Reading<number>` it is (`StoreRead<number>` has the same shape). It runs inside its own catch, as every wired reading does:
  a throw reads unmeasured `turns read failed`, logged once a pass. A coordinator gets no `turns`, and the store is not asked.
  With no private store in the wiring's deps, `turns` is not answered and keeps the lane's `W1`.
- **The Overlord's operator quiet** (the lane, `generationsLane.ts#softInputsOf`). `operatorQuietOf([OVERLORD_OPERATOR_MARK],
  marks)`: the hand-offs piece's one mark reader, over the `@overlord` mark that the prompt route's nudge queue writes
  (`nudgeQueue.ts#queueOperatorNudge`). Its rules are the hand-offs piece's: a mark with no `quiet` for its `at` reads 0, no
  mark (or one 30 minutes quiet) reads `OPERATOR_MARK_MS`, "no activity", and marks that could not be read read unmeasured.
  A soft reading the gather answers still spreads over it (`...r?.soft`).

## Departures

- **`overlord-quiet-read-in-the-lane`**: the plan has the wiring answer the soft quiet. It is read in the lane instead, in the
  one line of `softInputsOf` that gave the Overlord `later('W1')`, from the marks the lane already reads for a coordinator.
  Two measured reasons. (1) The gather (and so the wiring) runs before the pass, and the pass's step ONE ages every mark
  (`advanceMarkQuiet`); the lane's own read is taken after that aging, in the same synchronous pass. (2) The gather awaits
  fleet reads, so the prompt route can move the mark while it runs: a value the wiring read before that would still carry the
  old `at`'s quiet and could open a break the operator just closed. Reading it in the lane avoids both and adds no second
  read of `operator_marks` per pass. The cost is one L0 import in the lane (`shared/operatorMessages.js`, the mark's key,
  which imports nothing), added to the "imports nothing that sends" pin's allowed list in `continuity-generations-lane.test.ts`
  with its reason.
- **`turns-store-through-watcher-deps`**: `server/src/watch.ts` changes by 0 lines. `sweepGenerations` already hands the wiring
  `this.deps`, which carries the private store (`index.ts` sets `deps.operatorModel`). The watcher's view of the store,
  `deps.ts#WatcherDeps`'s `operatorModel` `Pick`, gains `messagesSince` in place (one line replaced, one comment line
  reworded; no line added).
- **`turns-why-passed-through`**: an unmeasured `turns` carries the store's own reason (for example `the private store is not
  open`), unprefixed, as the plan's Table 1 says ("as answered, its own reasons").
- **`turns-tests-in-own-file`**: PR F's tests are in a new `server/test/continuity-renewal-readings-operator.test.ts`, not in
  the two readings suites, so this PR adds no hunk to files PRs B and E are editing. The wiring cases use a real private store
  (`OperatorModelStore` over a fixture `operator-model.db`); the quiet cases run the real `generationsPass` over a real
  `coord.db` with an Overlord generation.
- **`overlord-quiet-without-store-is-no-activity`** (checked, no change): on a box with no private store, the prompt route
  refuses a message to the designated session (`promptRecord.ts`, `unavailable`), so no console message reaches the Overlord
  and no `@overlord` mark is written. The quiet then reads `OPERATOR_MARK_MS` by the hand-offs piece's rule, which is the
  truth there: the operator has no console path to talk to the Overlord. `turns` stays `W1` on that box.
- **No manual chore** (the operator's standing direction): both readings are measured by the system; nothing here asks the
  operator to do anything.

## Hand mutations (Task 9, Step 5)

Each was applied to the source, the new suite was run alone, and the source was restored.

| Mutant | Where | Result |
|---|---|---|
| count from `0` instead of `startReportedAt` | wiring | red: 3 (before the start not counted, none since is 0, asked for its own start) |
| read unread marks as no activity (`[]` for `unmeasured`) | lane | red: 1 (marks that cannot be read) |
| the Overlord's quiet back to `later('W1')` | lane | red: 5 |
| the mark reader asked for no key (`[]`) | lane | red: 4 |
| `turns` never wired | wiring | red: 6 |
| `turns` asked for every role | wiring | red: 1 (a coordinator gets no `turns`) |

No new L1 function: both readings pass through a producer's reader, so nothing joins `MUTANT_SETS`.

## Growth

`shared/api.ts` 0; `server/src/watch.ts` 0; `server/src/deps.ts` 0 (two lines replaced); `server/src/coord/store.ts` 0;
`server/src/coord/schema.ts` 0. The wiring and the lane are not growth-checked (wiring +7, lane +1 net).
