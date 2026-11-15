# The replay quiz piece: departures and decisions (run 2114)

The departures this pull request takes from `docs/superpowers/plans/2026-11-10-overlord/w1a-replay-quiz.md`, by slug. None
has a D-number; the coordinator folds them into the ledger.

## Scope

- **quiz-record-waits-for-the-single-arm-plan** (Task 3 not built). The history programme's coordinator answered the peer
  mail the plan asks for: that programme will not add the single-arm, recall-on, no-A/B report mode (it is closing, and the
  mode is on its follow-up list with no date). It licensed this programme to build the mode in its own pull request on five
  terms: additive beside today's arms, with a characterization test green on `main` first; no edit to the quiz scorer, its
  code-file list or the frozen-tree diff set; a single-arm report carries no comparison figure (no lift, delta or PASS word);
  the pull request number mailed to that coordinator before its close; and this programme's plan names the report's fields.
  It also measured that the quiz sections run behind part 2's pilot acts, so the mode is a path through those acts or a
  recorded ruling to skip them, not a flag. The coordinator ruled (mail 20170): Tasks 1, 2 and 4 here; Task 3 (the
  `ccrc quiz-record` verb and `POST /api/continuity/quiz-runs`) waits for a separate plan for the single-arm mode and for the
  operator's answer to the plan's open question 1. Nothing in Tasks 1, 2 and 4 calls Task 3's verb or door. With no door, no
  census changes in this pull request (`auth/gate.ts`, `box-token-census.test.ts`, `rings/fastify-l4.data.ts`, the README and
  `CLAUDE.md` are untouched); Task 3 makes them.
- **quiz-item-waits-for-the-record-path** (ask 434, ruled hold, mail 20203). The weekly lane ships built and tested but raises
  no operator item while the record path is absent: an item the operator cannot act on is noise. The gate is
  `server/src/continuity/quiz.ts#QUIZ_RECORD_READY` (`false`), which `quizLaneVerdict` reads first;
  `continuity-quiz-lane.test.ts` pins that it equals whether `server/src/continuity/quizRoutes.ts` exists, so the pull
  request that ships Task 3's door must set it `true` in the same change, and the lane then raises. A fixture pins both
  directions (raises nothing while absent, once a week while present). The item's driver step says only "as its runbook says"
  and names the fleet box: the Task 3 pull request rewrites that step to the runbook's commands for the single-arm mode, and the
  node to the operator's answer to the plan's open question 2 (review 2121 F4).
- **The guard now stands for rows whose own gate is open.** `launch-profile` and `anchor-slot` have no gate today, so from
  this merge their Live is refused `baseline-missing` until a baseline row exists, which needs Task 3. That is the ruling's
  intent ("no W1a arm before the baseline"); the plan's open question 1 (arm with the baseline recorded as "not taken") is the
  operator's, and the history coordinator has told the operator the mode will not come from history.

## Mechanism

- **quiz-week-is-utc.** The plan keys the week "in the Settings time zone"; no time zone setting exists on `main` (the spec
  ships it in W1). The lane uses the ISO week in UTC (`quizWeek`); W1's setting can replace it.
- **quiz-lane-wired-through-the-watcher.** The plan names `server/src/index.ts`. A `LANE_SCHEDULE` row is run by
  `FleetWatcher.runLane`, so the lane is wired as its siblings are: `index.ts` builds the lane's port once
  (`quizLanePortOf(coord, QUIZ_RECORD_READY)`) into `Deps.quiz` (`deps.ts`), and `watch.ts` gains `sweepQuiz` and one call in
  the poll beside the timers lane. The port is declared by its consumer (`quizLane.ts#QuizLanePort`), so the lane takes no
  `CoordStore` method and `store.ts` and `coord/ports.ts` are untouched.
- **quiz-item-raised-once-in-any-state.** The plan says no item is raised while one for this week is open. The lane asks
  whether this week's item was ever raised, in any state, so an item the operator dismissed or ticked is not raised again the
  same week. The read is `ledgersStore.ts#itemRaisedWithTitle`, in the table's owner (the shape of
  `releaseReviewItemRaised`).
- **quiz-item-is-soon.** The item is `do`, needed-by `soon` with no label (nothing pushes, A20), never `blocking`: no work
  stops on one week's run (the brief's ruling). Its title says "the baseline" until a baseline row exists.
- **baseline-read-is-three-way.** The plan has `decideLaneArmPost` take `baselineExists: boolean`. The store's read can
  fail, so the decider takes `baseline: LaneArmBaseline` (`{ok: true, exists}` or `{ok: false, detail}`, no overloaded
  value): a W1a Live with an unreadable baseline answers 503 `state-unreadable`, never Live. The check sits after the gate,
  sign-in and unreadable-row checks and before the confirm key, as the plan says.
- **lane-arm-decider-takes-a-gate-override.** `continuity`'s gate still stands on `main`, so the decider takes an optional
  `gate` (the override `laneArmRowViewOf` already has) for a test to drive each W1a row's baseline path.
- **quiz-mutant-sets-beyond-the-floor.** The plan registers `quizBaseline`'s floor. `validQuizReport`, `quizLaneVerdict`
  and `quizWeek` are new L1 deciders too, so each joins `MUTANT_SETS` (`server/test/sim/quizSets.ts`) with a floor.
- **The interim rule (the coordinator's ruling on R9).** A W1a row armed before this piece merged is the one case the guard
  cannot see. Until it merges, the coordinator raises no W1a arm item before the baseline is recorded, as the index's "What
  a merge arms" and launch profiles' Task 8 say. A row already stored `live` when the first run is recorded makes that run no
  baseline, so it fails closed.

## Measured before merge

- **Migration slot.** This branch takes 75, the next free slot on `main` at its base. The push outbox piece (run 2099) takes
  75 too, and the portfolio and renewal act pieces add migrations; whoever lands later renumbers on the coordinator's word.
- **Peer merges.** The vocabulary piece's `refusal-table.data.json` maps `baseline-missing` to W1a; if it lands first, this
  pull request deletes that line. The renewal act lifts `continuity`'s gate; if it lands first, its confirmed continuity Live
  case in `lane-arm-route.test.ts` needs a baseline row seeded.
