# Renewal readings G: the place hidden, and the first start's account hold

What PR G built, where `main` differed from the plan, and the builder's departures, by slug. Plan:
`docs/superpowers/plans/2026-11-14-overlord-w1/w1-renewal-readings.md`, Task 10 (PR G), with open question 7 (slug
`place-hidden-is-a-mark`). It also carries one ticket ruled into it (call 1677): `first-start-failure-holds-its-account`, the
recorded limit of PR H (#3455, its note `w1-renewal-readings-h.md`, slug `first-start-failure-writes-no-hold`). No D-number was
issued for this piece, so none is defined; the coordinator folds these slugs into the plan's ledger. Measured on `main` at
`3fda0fc9b1`, with home B (#3457) merged.

## What ships

### Item 1: the place hidden (Task 10)

- **The reading** (`renewalReadings.ts#placeHiddenOf`, L1, pure). The Overlord's soft `placeHiddenObservedMs` is the
  `@overlord-place` mark's observed `quiet`. The console's visible place refreshes that mark at most once a minute
  (home B's `placeMarkReport.ts`), and the generations lane already ages every operator mark by observed time
  (`advanceMarkQuiet`). It reads `markQuietMs`, the hand-offs piece's one reading of a mark's quiet, exactly as
  `operatorQuietOf` reads a programme's mark. There are three states plus one guard:
  - **Marks that could not be read:** unmeasured `place-mark: the marks could not be read`. Never 0 and never long hidden.
  - **A mark never written:** measured `OPERATOR_MARK_MS`, as `operatorQuietOf` reads a programme with no mark (no place has
    been visible). It never reads as "visible just now" (slug `never-written-place-reads-no-activity`).
  - **A written mark:** its quiet, at most `OPERATOR_MARK_MS`, the most the lane ages a mark (`markAges`). A fresh mark the
    lane has not aged yet reads 0, by the hand-offs piece's rule (ruling F5).
  - **A mark dated after the pass's `now`** (the wall clock stepped back since it was written): unmeasured
    `place-mark: dated after this pass`, never trusted as visible (slug `future-place-mark-is-unmeasured`). The next visible
    frame rewrites it at once (`placeMarkDue` refreshes a future mark), and the pass after that reads 0.
- **The wiring** (`generationsLane.ts#softInputsOf`, one line). The Overlord's `placeHiddenObservedMs` was `later('W1')`. It is
  now `placeHiddenOf(marks, now)`, from the one read of the marks that step FOUR already takes for the operator's quiet, after
  step ONE aged them. A coordinator's and a worker's stay `not-applicable`. The gather's `...r?.soft` still spreads over it.
- **The five minutes** stay `softRenewalMay`'s alone (`BREAK_PLACE_HIDDEN_MS` in `shared/continuity.ts`). The new decider
  never names them, and the soft decider is unchanged.
- **One comment** in `shared/continuity.ts` (`OVERLORD_PLACE_MARK`'s): "the generations lane does not yet" became the
  sentence that says it does.

### Item 2: a failed first start holds its account (ticket first-start-failure-holds-its-account)

- **Where the hold is written.** In the settle's `fail-pending` arm (`continuity/routes.ts#settleLoads`). The settle asks the
  one hold decider, `holdOfStart`, over the sandbox verdict it already holds and the account the body runs on. On `hold` it
  hands `{ lane, startId }` to the failure record. `overlordDesignationStore.ts#failPending` then writes the hold through the
  one hold writer, `accountHolds.ts#holdAccount`, **inside the failure's own transaction**, after the generation ends and
  before the sequence stamp. The failure and its hold commit or roll back together (hold 1, built as asked; slug
  `first-start-hold-in-the-failure-transaction`). A hold the table refuses is answered in `held` and logged
  (`could not be written; the failure stands`). It never undoes the failure, and the stop is never skipped.
- **The account.** The registry's measured wrapper, the same source the generations pass mints `GenRow.lane` from (`watch.ts`:
  the wrapper unless the registry marks it unmeasured). It comes through a new optional settle port read, `laneOf`, wired in
  `server.ts` on the same line as `failPending` (0 lines of growth). The settle reads it beside `workspaceOf`, before the
  evidence is re-checked, so no await follows that check (review 3346 F3; slug
  `settle-reads-the-account-before-the-recheck`). A continuity generation is not a source: the loads door settles at once,
  often before the pass has minted the pending body's generation (slug `first-start-lane-from-the-registry`). An account the
  port cannot name (`null`, a throw, or no `laneOf` wired) leaves the account unknown, so `holdOfStart` answers
  `unmeasured` and nothing is held. The failure and its stop go on as before.
- **Reuse.** No second decider, no second reader of the start's loads, and no new table, column, route or door. The decider's
  rulings stand: another profile, a failed or unmeasured profile property, and a failure the workspace or the launch's
  composition explains hold nothing (review 3981's F2).
- **One writer, two callers.** `holdAccount` is still the table's one hold writer (`writers-map.test.ts` is unchanged in
  content). Its header and the census comment now say it has two callers behind one decider: the generations pass, for the
  designated Overlord's start, and `failPending`, for a designate or rebind attempt whose start failed (slug
  `hold-writer-two-callers`).
- **Seen and cleared like any hold.** Every reader goes through the table, not through a generation: the holds door
  (`standingHolds`), readiness (`coord.accountHolds()`), and every builder of `AccountFacts` (`held`). No reader keys on the
  designated generation, so none was widened. The operator's clear door clears it, and `holdAccount`'s own guard
  (`excluded.startId > startId`) means the same start never puts a cleared hold back.

## Where main differed from the plan

| Slug | What |
|---|---|
| `place-hidden-read-in-the-lane` | The plan names `renewalReadingsWiring.ts`. The reading is in the lane's `softInputsOf` instead, for PR F's two measured reasons (`overlord-quiet-read-in-the-lane`): the gather runs before step ONE ages the marks, and it awaits fleet reads while the console can move the mark. The lane's one read of the marks serves both the quiet and the place. The wiring is untouched. |
| `place-hidden-decider-in-the-readings` | The plan maps home B's reader directly. The mapping is a pure decider in `renewalReadings.ts` (the plan's Global Constraints: every mapper is there), with a mutant set and a floor. |
| `place-marks-carry-their-at` | The lane's marks are typed `PlaceMarkReading` (`MarkReading` with the `at` the store's row already carries), so the future guard reads the `at` the one read returned. `MarkReading` is unchanged, so `operatorQuietOf`'s callers and tests are untouched. |
| `place-tests-in-own-file` | Task 10's cases are in a new `continuity-renewal-readings-place.test.ts`, not in the two readings suites (other open work edits those), as PR F did. |
| `operator-quiet-case-reads-the-place` | One case of PR F's suite (`continuity-renewal-readings-operator.test.ts`) asserted "with the place unmeasured the permit waits `unmeasured`". The place is now measured, so the case sets the place on the recorded inputs and asserts both answers (`no-break` with the place visible, `unmeasured` with it unmeasured). Its first case's comment says the place is held visible. |
| `generation-day-inputs-unchanged` | The simulator's generation day (`sim/generationDay.ts`) builds its own `SoftInputs`, with the place unmeasured. Nothing there reads the lane, so it is unchanged. |

## Rules, and the case that goes red when each is broken

| Rule | Case (file) |
|---|---|
| Five minutes hidden opens the break; a visible report resets it | "five minutes hidden opens the break; a visible report resets it, and a place kept visible never opens it" (place suite: the real pass, home B's real reporter, the real store) |
| An unread mark waits unmeasured unless the quiet disjunct passes | "marks that cannot be read make the place unmeasured: the permit waits `unmeasured` unless the quiet disjunct passes" |
| The reading is asked once per pass | "the marks are read once per pass for the permit: the place adds no read beside the operator's quiet" (the store's mark reader is counted: 2 a pass, step ONE's and step FOUR's) |
| A mark never written is not "visible just now" | "a place mark never written reads as long hidden ..." and the decider's G2 case |
| A mark from the future is not trusted as visible | "a place mark dated after the pass is not trusted as visible ..." and the decider's G3/G6 case |
| The Overlord's only | "the place is the Overlord's only: a coordinator's and a worker's generation read not applicable, whatever the mark" |
| The hold and the failure are one fact | "a failure that rolls back leaves no hold" (store suite) |
| A refused hold never undoes the failure or skips the stop | "a hold the table refuses leaves the failure recorded and its stop owed" (store) and "... still records the failure and stops the body, and says so" (loads door) |
| Fail, then left out of the list, then cleared, then offered again | "a failed first start holds its account: the holds read shows it, the next ordered list leaves it out, the clear offers it again" (the real server, its real settle port and its real clear door) |
| The never-empty rule stands for this path | "the never-empty rule stands for this path: with every candidate held, the list is kept as it was" |
| The decider's rulings stand | "a failed first start whose failure is not the account's holds nothing: the launch, the workspace, another profile" |
| A rebind attempt holds too, and the old binding stays | "a failed rebind body that loaded from its account's own configuration holds that account; the old binding stays" |
| An unknown account holds nothing | "an account the port cannot name holds nothing: a read that throws or answers null, or no read wired" |

## Fix round 1: the Overlord cases of the operator-mark paths suite (call 1690)

The first CI run reddened nine cases of `continuity-operator-mark-paths.test.ts` (shard 2). I had not run that file before the
push. Their rig writes no place mark, so the place now reads long hidden, and R19's break is an OR: the place hidden for five
minutes is a break even with the operator's quiet at 0. Option A was ruled: the soft decider and the reading stay as built.
The cases now stand the place on screen **through the real reporter**: `placeVisible` sends one `{ type: 'visible', visible:
true }` frame of the bound session over the real `/ws/session/:id` socket. The server's own `placeMarkReporter` turns that
frame into the mark at the rig's clock, so no mark is written by hand.

| Case ("the Overlord the operator ... ") | Old expectation | New expectation | Why the new one is stronger |
|---|---|---|---|
| typed to through the drawer | waits `unmeasured` | waits `no-break`; quiet 0 and place 0, both measured | The old one passed only because the place reading did not exist yet; the case's own comment said so ("the place-hidden input is still the lane's W1"). The new one proves the wait on two measured readings, with the place stood on screen as the console stands it. |
| typed to through the submit route | waits `unmeasured` | waits `no-break`; quiet 0 and place 0 | as above |
| acted on through the question door, a free-text answer | waits `unmeasured` | waits `no-break`; quiet 0 and place 0 | as above |
| acted on through the question door, a dialog row | waits `unmeasured` | waits `no-break`; quiet 0 and place 0 | as above |
| acted on through the question door, a multi-select set | waits `unmeasured` | waits `no-break`; quiet 0 and place 0 | as above |
| acted on through the question door, an ask | waits `unmeasured` | waits `no-break`; quiet 0 and place 0 | as above |
| acted on through the dialog tab move | waits `unmeasured` | waits `no-break`; quiet 0 and place 0 | as above |
| acted on through the interrupt | waits `unmeasured` | waits `no-break`; quiet 0 and place 0 | as above |
| acted on through the model and effort picker | waits `unmeasured` | waits `no-break`; quiet 0 and place 0 | as above |

Each case's title gained "its place on screen", and the drawer case's comment now says what is measured. Four new cases in
the same suite pin R19's rule for the Overlord openly. Both marks age on the rig's one clock, and the lane runs the real
`softRenewalMay`:

- The place on screen and the operator just acted: no break.
- The place on screen (re-reported every minute) and the operator quiet for 20 minutes: a break, opened by the quiet. Every
  pass before it waits `no-break`, and the place stays under five minutes.
- The place hidden for five minutes and the operator just acted: a break, opened by the place (the OR). The quiet reads 0.
- The place mark unread: the permit waits `unmeasured`. The same inputs start once the quiet reaches 20 minutes.

**The search the missed file called for** (point 5 of the ruling). Every suite that builds the generations lane's soft inputs
or asserts a soft wait word: `grep` over `server/test` for `softRenewalMay`, `SoftInputs`, `softInputsOf`, the two soft
readings, `'no-break'`, `.waits` and `generationsPass(`, kept where the file imports the lane, the soft decider or their sets.
Each was run alone; the wave-done lists them.

## Mutation

**The floors' set.** `server/src/continuity/renewalReadings.ts#placeHiddenOf` joins `MUTANT_SETS` through
`sim/renewalPlaceReadingSets.ts` (spread by `renewalReadingSets.ts`) at floor 1. No floor was lowered. Before: the baseline
(the real module) passes its suite. After: every mutant is killed (the floors suite run alone, 392 cases).

| Mutant | Killed by |
|---|---|
| G1 an unread mark read as 0 hidden (the plan's Step 5) | "marks that could not be read: unmeasured, never 0 hidden and never long hidden" |
| G2 a mark never written read as visible just now (the builder's own) | "a mark never written reads `OPERATOR_MARK_MS` ..." |
| G3 a mark from the future trusted | "a mark dated after the pass is never trusted as visible" |
| G4 any mark read as the place | "only the place mark is the place" |
| G5 the quiet uncapped | "a mark's observed quiet is the reading, at most `OPERATOR_MARK_MS`" |
| G6 a mark at the pass read as from the future | "a mark dated after the pass ..." (its at-the-pass line) |
| G7 an unread mark read as long hidden | "marks that could not be read ..." |

The existing `overlordDesignationStore.ts#failPending` set still kills every mutant over the changed function.

**By hand.** Each mutation was applied to the committed source, the named file was run alone through the test wrapper, and
the source was restored (`git checkout`). Before: every named file green.

| Mutation | File run | Red |
|---|---|---|
| an unread mark read as 0 hidden (the plan's) | place suite | 2 of 12 |
| a mark never written read as 0, visible just now (the builder's own) | place suite | 3 of 12 |
| the place reads the marks again for itself (a second read a pass) | place suite | 1 of 12 (the once-per-pass case) |
| the Overlord's place back to `later('W1')` | place suite | 5 of 12 |
| the place given to every role | place suite | 1 of 12 (the roles case) |
| the hold written in its own write, before the failure's transaction | store suite | 3 of 54 |
| the settle never hands the hold | loads door suite | 4 of 74 |
| the settle holds the account whatever the decider says | loads door suite | 1 of 74 |
| an account read that throws is not caught | loads door suite | 1 of 74 |

## What a merge arms

- **Item 1.** Only an Overlord generation's soft permit reads the place. No Overlord is designated on any box until the last
  build, so nothing renews differently today. The day one is designated and continuity is live: a soft renewal due on the
  Overlord's generation can start at a break once its place has not been visible for five minutes of observed time. Before,
  the place disjunct was always unmeasured, so only 20 minutes of operator quiet made a break. A console that never showed
  the place (the mark never written) reads as hidden. A coordinator's and a worker's permits are unchanged.
- **Item 2.** A designate or rebind whose first start fails the launch profile check because it loaded something from the
  account's own configuration now holds that account out of the Overlord's ordered list. The pass's hold already works this
  way, in shadow and live alike, since it acts on no session. That can happen today on a box where the operator presses
  Start the Overlord and the start fails that way: the next attempt is offered another account, and the hold shows on the
  holds read and readiness until the operator clears it. A single-account box still starts (the never-empty rule).

## Harness dependence

- Item 1 adds none. The reading is the server's own mark, which the console's session socket refreshes. Any agent harness
  the server hosts is read the same way.
- Item 2 reuses PR H's reading of one harness. `holdOfStart` holds only on the sandbox check's `fromAccount`, which reads
  Claude Code's own configuration layout (PR H's Known limits, "What the hold assumes about the harness"). Nothing new here
  depends on a harness beyond that.

## Properties of the hold (forgery and repetition)

- The settle acts only on the pending attempt's own newest start, with its stored report (`sandboxSettle` checks the pending
  session, its generation and the newest start). So a hold on this path carries the same exposure as the start door's
  report, the same as the designated body's hold in the pass.
- Its effect only narrows. There is one row per lane, a held account is still counted, and with every candidate held the list
  is kept as it was.
- Repeated failures on one lane are one hold. A cleared hold is never put back by the same start.

## Known limits

- **Acting from a surface that does not show the place is not "on screen".** The break is R19's either-or. An operator who acts
  on the Overlord from a surface that does not show its place (an answer given from the waiting list, say), with the place
  hidden for five minutes, meets a break. The renewal carries the thread and the answer, as every soft renewal does.
- **A rebind leaves the old place mark.** The place mark is one key, not one per session. After a rebind, the mark the old
  body's place refreshed still reads as visible for up to five minutes, until it ages or the new place refreshes it.
- **A backward wall step leaves a hidden place unmeasured.** While the place is hidden, a mark dated after the pass stays
  unmeasured for as long as the wall clock is behind it, and the break falls back to the operator's 20 minutes of quiet. A
  visible place is refreshed within one frame.
- **One more registry read per settle.** Item 2 reads the session's registry record a second time beside `workspaceOf`.
  Both reads happen once per settle, which runs once per designate or rebind start.
- **An unmeasured wrapper holds nothing.** When the registry does not measure the failed body's wrapper, the account is
  unknown and no hold is written. The failure is still recorded and the body still stopped.
- **The floors run on the test box** reds two `pwa/src/face/mood.ts` sets whose baseline cannot resolve `@ccrc/ui` in the
  box's checkout. This branch changes nothing in `pwa/`, so it is the run's environment (reported in the wave-done).

## Growth

`server/src/server.ts` 0 (one line replaced); `server/src/coord/store.ts` 0 (one line replaced); `shared/api.ts` untouched.
Not growth-checked (net, measured by `git diff --numstat` against `3fda0fc9b1`): the lane +1, the readings module +22, the
continuity routes +18, the designation store +7, the holds module +2, `shared/continuity.ts` 0.
