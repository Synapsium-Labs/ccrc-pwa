# Overlord W1a: the weekly replay quiz, its baseline and its record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** once a week the server asks the operator to run history's replay quiz over live coordinator families, by
hand, and records each run's result beside the probe rows. The first run, taken before any W1a arm is armed, is the
baseline M13 compares against, and no W1a arm can be armed until it exists.

**Why:** the replay quiz that would measure recall was built but never run (Table 3.3.9b), and nothing measures loss or
drift over weeks (C52). The operator ruled W0-28 B (item 168): M13's baseline is the first run of W1a's weekly quiz
lane, taken before any W1a arm is armed, under the history programme coordinator's four conditions. The quiz is that
programme's own (C53); this piece only schedules it, records it and guards the baseline's place in time.

**The four conditions** (the results note, "The replay quiz's baseline", carried by the ruling), each a rule of this
plan:
1. it reads the history store read-only, and no session runs a writing form of `ccrc history`;
2. it writes no history marker (recall-off, steer, agents-on, headless-on or any other); markers are the operator's;
3. it mails the history programme's coordinator before any reuse of that programme's quiz files
   (`deploy/history-replay.mjs`, `deploy/history-gate.mjs` or the quiz builder), and runs the driver by the operator's
   hand, as the driver requires;
4. the baseline is never written up as a W2 result, a PASS or a measured benefit of recall.

**What each run records** (the minimum the history coordinator named): one quiz over live coordinator families, with
recall on and no A/B window, using the same questions, judge, judge model and scoring as the lane M13 later reads; the
frozen question list's sha; the number of questions and of families; the score with its interval; the ccrc release
and Claude Code builds; and whether the history programme's W3 steering and W4 agents-on were armed on the families and
node measured.

**Architecture:** an L4 lane on a weekly `LANE_SCHEDULE` row raises one operator item a week through the ledger's
existing server raise; an operator-run `ccrc` subcommand reads the driver's report (read-only) and posts it to a
box-token door that writes `continuity_quiz_runs`; an L1 decider marks the baseline; the lane-arm door's L1 decider,
`decideLaneArmPost`, refuses to arm a W1a row before a baseline exists. The W1a rows it guards are `continuity`,
`launch-profile` and `anchor-slot`; the coordinator skill's clause that W1a adds is ordered after the baseline is taken
(the index's order), because it changes what a coordinator recalls. The server never runs the driver. One pull request.

**Tech Stack:** TypeScript (ESM), bash (`ccd/ccrc`), `node:sqlite`, vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.9 (C52: "The replay quiz runs. A server lane runs
history's replay quiz weekly, and the scores land beside the probe rows. Its first run, taken before any other part of
W1a is armed, is the baseline (C53)."), §3.3.10 (C53: the quiz is history's own; a measure, never a gate on history's
waves; the wave asks that programme's coordinator first), Table 11.1c row "The renewal lane, the weekly replay quiz",
§12 (M13); the results note `docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md` (W0-28).

## What exists today

- `deploy/history-replay.mjs` is the operator-run driver (header: started by hand on a named node). It refuses inside a
  pane (`TMUX_PANE` set: `in-pane`, exit 2). Its reports print as canonical JSON on stdout with `sha256 <hex>` on
  stderr. Its quiz arms always run both recall arms side by side (the results note: "a reduced run also cannot skip the
  pilot or part 2 without a code change"), and its `report` subcommand takes the W2 study's inputs (`part1`, `frozen`,
  `arms-summary`, `judged`, each with its sha). `deploy/history-gate.mjs` is its pure scoring (`BOOTSTRAP`: a 95%
  percentile bootstrap). The judge model is required and must be an exact Opus id.
- No server lane runs or schedules it (`grep` of `server/src` finds nothing).
- Server-raised items exist (`server/src/coord/endRequest.ts` raises through `ledgersStore.ts`).
- `shared/lane-arm.ts` and `POST /api/coord/lane-arm` (D-8274). The door's verdict is L1:
  `server/src/coord/laneArm.ts#decideLaneArmPost({ request, row, signedIn })`, called from the handler in
  `server/src/coord/routes.ts`; its refusal words are the closed `shared/lane-arm.ts#LANE_ARM_REFUSALS`. W1a adds the
  rows `continuity` (the generations piece, Task 1), `launch-profile` (the launch-profiles piece, PR B Task 5) and
  `anchor-slot` (the anchor piece, Task 2). `lane_arm_settings` keeps only each row's current choice and its
  `updatedAt`, no history. The `#2726` run may add a row of its own (`peer-mail-hold`); it is not a W1a arm and this
  piece does not name it.

## Global Constraints

- **The four conditions above bind every task.** Nothing in this piece writes under `~/.ccrc/history`, runs a writing
  form of `ccrc history`, touches a history marker, or runs the driver. The `ccrc` subcommand only reads files the
  operator names and marker files' existence.
- **Architecture (`CLAUDE.md`).** One writer: the quiz door writes `continuity_quiz_runs`. The baseline rule is L1
  (`quizBaseline`), and so is the arming refusal: `decideLaneArmPost` takes the fact `baselineExists` and decides; the
  handler in `routes.ts` only reads the fact and passes it. The lane is L4 and only raises an item. Consolidate: the item
  goes through the ledger's existing server raise; the arming guard is one more refusal of the existing lane-arm door,
  not a second switch. A guard ships
  with a test that goes red without it.
- **Peer protocol first.** Before Task 1, mail the history programme's coordinator (`ccrc-api peers list`): name this
  piece, the four conditions, the report it reads, and the driver change it needs (below); wait for the answer before
  Task 3.
- **SAFETY (`CLAUDE.md`).** The `ccrc` subcommand refuses inside a session (`CLAUDECODE` set) and inside a `cc-*` pane,
  as `ccrc history`'s writing verbs do: speed bumps for an operator's verb. It never prints a secret.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs. **Growth check:** `ccd/ccrc` and `server/src/coord/routes.ts` grow at most 40 net lines.
- **Censuses.** The quiz door takes the box token, because its caller is the operator's `ccrc` on the box, which has no
  console cookie. It sits in the box-token census as EXEMPT, with the reason "the operator's quiz record from the box;
  refused inside a session at the client". Update
  `server/src/auth/gate.ts`, `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts`,
  `server/test/rings/fastify-l4.data.ts`, the README's auth paragraph and `CLAUDE.md`'s box-token paragraph.
- **Migration slot** re-measured before merge. Cite by symbol or `@anchor`. No private names. No D-number invented;
  departures go in `docs/superpowers/plans/2026-11-10-overlord/w1a-replay-quiz/departures.md`.

## Review Focus

1. The server never runs the driver and never writes a history file or marker (an import and path pin in the lane's and
   the subcommand's tests).
2. The baseline is the first run recorded while every W1a lane-arm row's stored choice is `shadow`, read from
   `lane_arm_settings` at the recording; together with point 3 no W1a row can be `live` before it, so the rule needs
   no arm history.
3. No W1a lane can be armed `live` before a baseline row exists (`baseline-missing`).
4. Nothing labels a run a PASS or a benefit: the record holds the score and its interval only.

---

### Task 1: The record and the baseline rule

**Files:**
- Modify: `server/src/coord/schema.ts` (migration: `continuity_quiz_runs`)
- Create: `server/src/continuity/quiz.ts` (L1: `quizBaseline(runs, w1aChoices)`, `validQuizReport(json)`;
  `W1A_ARM_ROWS = ['continuity', 'launch-profile', 'anchor-slot']`, typed against `LaneArmLane`)
- Create: `server/src/continuity/quizStore.ts` (`insertQuizRun`, `quizRuns`; its own module, so this lane shares no
  store file with the server spine)
- Test: `server/test/continuity-quiz.test.ts` (new), `server/test/coord-db.test.ts`

**Schema:**

```sql
CREATE TABLE continuity_quiz_runs (
  id INTEGER PRIMARY KEY, measuredAt INTEGER NOT NULL, recordedAt INTEGER NOT NULL, recordedBy TEXT NOT NULL,
  reportSha TEXT NOT NULL UNIQUE, questionsSha TEXT NOT NULL, questions INTEGER NOT NULL, families INTEGER NOT NULL,
  score REAL NOT NULL, lo REAL NOT NULL, hi REAL NOT NULL, judgeModel TEXT NOT NULL,
  ccrcRelease TEXT NOT NULL, claudeBuilds TEXT NOT NULL,       -- JSON array
  steerArmed TEXT NOT NULL, agentsOnArmed TEXT NOT NULL,       -- 'yes' | 'no' | 'partial' | 'unmeasured'
  baseline INTEGER NOT NULL
);
```

`quizBaseline` answers `true` for a run when no earlier row is a baseline and every row of `W1A_ARM_ROWS` reads
`shadow` in `lane_arm_settings` when the run is recorded (an unreadable row answers `false`, so an unreadable read never
makes a baseline). This is derivable from what the table keeps: the arming guard (Task 2) stops any of these rows going
`live` before a baseline exists, so "has never been live" and "is shadow now" agree. A row armed before this piece
merged is the one case the guard cannot see. The index orders this piece after the three rows it guards merge, so
the guard cannot stand before they exist; until it merges, the interim rule holds instead: the coordinator raises no
W1a arm item before the baseline is recorded (the index's "What a merge arms", and launch profiles' Task 8). The
departures note records it (the coordinator's ruling on R9).

- [ ] **Step 1: Failing tests:** the first run with every row shadow is the baseline; a second is not; a first run
  recorded while any W1a row is `live` is not; an unreadable row makes no baseline; a report missing any field the record needs is
  refused by `validQuizReport` naming the field; a duplicate `reportSha` is one row.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green. Register `quizBaseline`'s floor.
- [ ] **Step 5: Commit.** `feat(continuity): continuity_quiz_runs and the baseline rule (W0-28)`

### Task 2: Arming a W1a lane waits for the baseline

**Files:**
- Modify: `server/src/coord/laneArm.ts` (`decideLaneArmPost` takes `baselineExists: boolean`; `live` for a row of
  `W1A_ARM_ROWS` while it is `false` answers `{ kind: 'baseline-missing' }`, decided before the confirm key; `shadow`
  is never refused)
- Modify: `shared/lane-arm.ts` (`LANE_ARM_REFUSALS` gains `baseline-missing`; the closed list's one append)
- Modify: `server/src/coord/routes.ts` (the lane-arm handler reads whether a baseline row exists through
  `quizStore.ts` and passes it; it maps the new verdict to 409 `baseline-missing`; nothing else)
- Modify: `shared/refusal.ts` (`baseline-missing`, 409)
- Test: the lane-arm decider's suite and the lane-arm route suite (measure: `grep -ln decideLaneArmPost server/test`)

- [ ] **Step 1: Failing tests:** in the decider, each of the three rows refused before a baseline and accepted after;
  `roster-card` (not a W1a row) unaffected; `shadow` always accepted; at the route, the 409 body names
  `baseline-missing`.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Mutation.** Drop the check: red. Revert.
- [ ] **Step 6: Commit.** `feat(lane-arm): a W1a lane is armed only after the quiz baseline exists (W0-28)`

### Task 3: The operator's record verb and its door

**Files:**
- Modify: `ccd/ccrc` (`ccrc quiz-record --report <file> --sha <hex>`: refuses in a session or a `cc-*` pane; reads the
  report, checks its sha, reads the existence of the steer and agents-on markers on this node read-only, and the
  installed release and Claude Code builds (`ccrc version`), then posts)
- Create: `server/src/continuity/quizRoutes.ts` (`POST /api/continuity/quiz-runs`, registered from `server/src/server.ts`;
  a lane source of its own in the box-token census)
- Modify: the census files
- Test: `server/test/ccrc-quiz-record.test.ts` (new, fixture HOME, a stub server), `server/test/continuity-quiz-route.test.ts`

The report it reads is the single-arm, recall-on, no-A/B report the history coordinator agrees to in the peer mail
(Global Constraints). Today's driver has no such mode (its arms run both recall arms side by side). If the history
programme adds it, Task 3 reads that report's fields; until it does, this task stops after the door and its tests, and
the departures note records the wait.

- [ ] **Step 1: Failing tests:** inside a session the verb refuses and posts nothing; a wrong sha refuses; a good report
  posts once and prints the row id and whether it is the baseline; the door refuses a malformed body naming the field.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(ccrc): quiz-record, the operator's record of a replay quiz run`

### Task 4: The weekly lane raises the operator's item

**Files:**
- Create: `server/src/continuity/quizLane.ts` (L4: once per ISO week in the Settings time zone, if no run was recorded
  this week and no item for this week is open, raise one item on the `overlord` programme: "Run this week's replay
  quiz", whose body gives the driver's commands from the history programme's runbook, the four conditions, and the
  `ccrc quiz-record` line; before a baseline exists, the title says "the baseline")
- Modify: `server/src/laneSchedule.ts` (row `quiz`, daily cadence, weekly by its own key)
- Modify: `server/src/index.ts`
- Test: `server/test/continuity-quiz-lane.test.ts` (new)

- [ ] **Step 1: Failing tests:** one item a week; none when a run is recorded that week; none twice; the body names every
  condition; the lane's file imports nothing that runs a process or writes a file (an import pin).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(continuity): the weekly quiz lane asks the operator to run the replay quiz`

## Deviations found

None yet. Decisions this plan takes, by slug:

- **quiz-lane-reminds-not-runs** — the driver refuses inside a pane and condition 3 makes it the operator's by hand, so
  the lane asks and records; C52 now reads so (this programme's spec amendment).
- **quiz-needs-a-single-arm-mode** — the baseline's "recall on and no A/B window" needs a driver mode history's driver does
  not have; it is that programme's change, asked by peer mail. Recorded as a dependency and a spec gap.
- **arming-waits-for-the-baseline** — the lane-arm door's L1 decider refuses `live` for `continuity`, `launch-profile`
  and `anchor-slot` until a baseline exists, so "taken before any W1a arm is armed" is a mechanism, not a convention.
- **baseline-rule-from-current-choices** — the baseline rule reads the W1a rows' current choices, which
  `lane_arm_settings` keeps, rather than an arm history it does not keep; the arming guard makes the two agree.
- **quiz-record-is-the-operators** — the record comes from an operator verb on the box, refused inside a session, through
  a box-token door; a session could still post it directly (the box token is shared), so the row carries `recordedBy`
  and the door's census reason says so.

## Where things stand

**Needs before it starts:** the generations piece (Task 1: the `continuity` row), the launch-profiles piece's PR B
(Task 5: the `launch-profile` row) and the anchor piece (Task 2: the `anchor-slot` row), because `W1A_ARM_ROWS` is
typed against `LaneArmLane` and a name not yet in it does not compile; and the start-report piece (the continuity
routes' home). Task 3 needs the history programme's single-arm report.

**What depends on it:** every W1a arm (Task 2's guard); M13 (§12), which compares later runs against the baseline; the
Overlord's weekly drift reading (C52), which reads the same rows from W1.

**Open questions for the operator, most important first:**

1. **May W1a's arms wait for the quiz baseline?** Task 2 makes them wait. If the history programme's single-arm mode
   is far off, the operator may prefer to arm with the baseline recorded as "not taken", which W0-28's ruling does not
   allow as written.
2. **Which node runs the quiz?** The driver is started on a named node; recommend the fleet box, where the families are.
