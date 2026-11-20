# Capacity Task 2: notes for the ledger

This note records what Task 2 of the waiting-workers plan
([`2026-11-19-waiting-workers-sleep.md`](../../plans/2026-11-19-waiting-workers-sleep.md), spec Parts 2 and 4) built
when this PR adopted draft #3070, and where it departs from the plan's text. The coordinator folds it into the
programme ledger. It defines no D-number: D-8790 (slug `working-idle-sleeps`) and D-8791 (slug
`coordinator-told-of-sleep`) are the numbers the coordinator issued, and the plan's "Deviations found" defines them.

## In short

- **Built:** the run-done sleep policy gains its waiting case. A dispatched worker whose newest placed run is `working`
  (`STOP_DONE_WAITING_STATES`) and whose turn marker has been quiet `STOP_DONE_PARKED_IDLE_MS` (the one 30-minute
  constant) is put to sleep. Its own active run holds it neither as `not-done` nor as `run-worker`. A second active
  run naming it still holds `run-worker` (`lastRunBySession`'s new `otherOpenPlacedWorkers`), and a `dispatched` run
  still holds `not-done`. Every use hold stands: unread mail, background work, a session cron, a live claim, a viewer,
  a menu, the bucket, the roster, a turn, the act-time re-measure and ccd's `attached`.
- **Shadow until armed:** the case reads its own Shadow lanes row, `working-idle-sleep`, seeded `shadow` by one
  migration. In shadow a waiting answer writes one journal line (`ccrc-server: stop-done shadow: …`) and is not asked
  again for an hour. Read again at the act beside the kill switches, a row set back to shadow holds the act
  (`switched-off`). Nothing in the tree arms it: only the operator's `POST /api/coord/lane-arm` does.
- **Live:** the act is `ccd hibernate` as today, the worker's own-run hold passing with `--hold-ok` (Task 1, D-8789).
  The asleep row and the journal line say "waiting on a working run". The run's coordinator gets one notice per sleep
  (`worker-asleep: run <id>, last turn ended <UTC minute>`), at most `WORKER_ASLEEP_MAILS_PER_RUN` (3) a run. It goes
  through the stall watch's `queueStallNotice`: a `run_events` observation row naming the worker and the instant its
  quiet began, written in one transaction with the mail, so a restart or a later pass never mails the same sleep
  twice, acked or not. A worker parked at review, merge or close sends no mail.
- **Unchanged:** the mail-only count stays a count of finished workers. The stall watch is untouched. No new run
  state, no new `ccd` verb, `FLEET_PROTO` unchanged, and the lane's kill switches (`stop-done-disabled`,
  `hibernate-disabled`, `reclaim-paused`) stop the case as they stop the rest of the lane.

## 1. Departures from the plan, the brief and the draft, by slug

| Slug | What the plan, brief or draft says | What this PR does, and why |
|---|---|---|
| `migration-next-free-slot` | The brief: "Build on 112". The draft took 107. | `MIGRATIONS` is positional, so an entry cannot sit at 112 while 110 and 111 are not on `main`. The seed row is the next free entry on `main` today, 110 (`user_version` 109 -> 110), anchored in `coord-db.test.ts` on the entry before it. Approvals PR 3 (110) and door B1 (111) build on the same slots, and capacity Task 4 carries a migration too: whoever lands second moves up, renumbering the entry, its comment and the two version pins. |
| `stacked-on-task-1` | The brief: bring #3069's and #3070's commits in together. | Task 1 is taken from its adopting PR (#3092) by a plain merge of that branch's tip, not from the draft's commits, so Task 1's re-grounded code is the code this PR stands on. Until #3092 lands this PR's diff holds Task 1's too; one absorb of `main` after it lands leaves Task 2 alone. |
| `task-1-pin-on-dispatched` | Task 1 pins "an own-run hold on a working run is still held by the run". | Task 2 makes a quiet `working` run the waiting case on purpose, so that pin moves to a `dispatched` run (its brief unread), which still holds `not-done`. The draft moved its own pins that read a `working` run as `not-done` the same way. |
| `lane-row-order` | The draft appends `working-idle-sleep` after `anchor-slot`. | Kept. Approvals PR 3 appends `approval-park` after `anchor-slot` as well; its worker and this one agreed that whoever lands second appends after the other and re-counts the lane censuses. |
| `lane-words-file` | The plan lists `pwa/src/fleet/laneArmWords.ts` among the files. | The row's words live in `shared/lane-arm.ts` (`LANE_ARM_TEXT`) as every row's do, and the console's one lane-keyed table that needs the row is `SHADOW_LOG` in `ShadowLanesSection.tsx`, so `laneArmWords.ts` is not changed. |
| `suite-copies-one-store` | The draft's new suite opened a fresh coordination store per use. | Every open replays every migration. Under a loaded box, three live cases that open two or three stores passed the 20 s case bound. The suite now builds one migrated database in `beforeAll` and copies it per store (the pattern of `designation-actor.test.ts`), and closes each copy after its case. |

## 2. The design review's rulings (review 2848, relayed by the coordinator)

| Finding | Ruling | What this PR does |
|---|---|---|
| F5, the coordinator's mail | Key each sleep durably, never re-send after an ack, bound the mails per run; red cases for the restart and the bound. | The draft read the subject back over every delivery state. The notice now rides `queueStallNotice` (an existing owner, not a second dedupe): the observation row `worker-asleep:<worker>:<since>` and the mail in one transaction. `workerAsleepNoticeDue` (L1, `stopDone.ts`) decides the bound from the run's `run_events` (`runEvents`, an existing read), so no store change. The row is `causedBy 'operator'` with `fromState = toState`, so drift's act clock, the notify lane and the stall ladder (which parses only its own details) all skip it. New cases: the row alone stops a second mail after the mail rows are deleted, and the fourth and fifth sleeps of a run are acted on and unmailed. |
| F9, where the arming gate sits | Only the new case waits on the row; every other run-done sleep is unchanged; read the row through `laneArmRowViewOf`. | Already so in the draft: `answerLive` reads `v.waiting`, which the verdict sets exactly when the run it read is in `STOP_DONE_WAITING_STATES` (`working`), from the same store read, and an answer without it is live as before. The row is read through `laneArmRowViewOf(WORKING_IDLE_SLEEP_LANE, …).live`, as `rollLane.ts` reads its own; a read that throws is shadow. Unchanged. |
| F13, holds pinned | One case each for `menu`, `roster` (subagents), `bucket`, `turn`, the row's `background`, unread mail, background work, a session cron and a claim. | The draft's one looping case is now one case per hold (`it.each`), plus `viewer`, `run-claimant`, `marker` and the unmeasurable `bg -1` and absent `crons`. The pass-level cases for unread mail, background work and a session cron stay. |
| F2, arming order | Part 2 is armed before Part 3, whose cap reading now ships in shadow too. | Recorded here. This PR arms nothing: the `working-idle-sleep` row is seeded `shadow`. The operator arms it first; Task 3's row comes after. |

## 3. Red-first evidence

Each guard was mutated, `stop-done-working-idle.test.ts` was run through `ccrc test`, and the file was restored from
a saved copy:

| Mutant | Result |
|---|---|
| a second active run no longer holds a waiting worker (`otherOpenWorker` read as `false`) | killed (2 failed) |
| `dispatched` joins the waiting states | killed (3 failed) |
| the row's shadow ignored (`answerLive` always true) | killed (2 failed) |
| the coordinator mail's read-back removed | killed (1 failed) |
| the mail-only count counts a waiting worker | killed (1 failed) |
| unread mail does not hold a waiting worker (review focus 4) | killed (2 failed) |
| background work does not hold a waiting worker (review focus 4) | killed (2 failed) |
| a session cron does not hold a waiting worker (review focus 4) | killed (2 failed) |

The characterization commit (`test(sleep): pin today's run-done answer …`) is green on its base, Task 1's tip; the
rows marked `today:` are the ones the behaviour commit flips to `now: … (was: …)`.

## 4. Residuals

- **The shadow hold-off covers the worker, not the case.** A waiting worker logged in shadow is not asked again for
  an hour (the lane's one hold-off map). If its run moves to `awaiting-review` inside that hour, the parked sleep
  reaches it up to an hour later than it would otherwise. Nothing is lost; the next pass after the hour decides it.
- **Arming is the operator's.** Going Live puts the fleet's quiet `working` workers to sleep within a pass or two
  (three acts a pass), and each coordinator is mailed once per sleep.
