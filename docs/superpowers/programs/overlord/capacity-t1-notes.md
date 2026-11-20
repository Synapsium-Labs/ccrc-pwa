# Capacity Task 1: notes for the ledger

This note records what Task 1 of the waiting-workers plan
([`2026-11-19-waiting-workers-sleep.md`](../../plans/2026-11-19-waiting-workers-sleep.md), spec Part 1) built when this
PR adopted draft #3069, and where it departs from the plan's text. The coordinator folds it into the programme ledger.
It defines no D-number: D-8789 is the number the coordinator issued for this task's call (slug
`own-run-hold-passes`), and the plan's "Deviations found" defines it.

## In short

- **The amendment:** D-8789 amends D-6091's "an open run's hold still holds" for the worker's own newest placed run, as
  F5 (b) requires. As the plan says, an older open run of the same worker answers `held` (review 2868 F1). A `planned`
  run of its own (wave N+1 opened, not yet dispatched) answers `held` too.
- **Built:** `StopDoneHeldKind` gains `run-own`. `heldKindOf(held, coord, asker)` answers it only when the named run is
  open, its `sessionId` is the asker's (`runNamesSession`, never the hold's text), and its id is the asker's newest
  placed run (`OwnRunAsker.newestPlacedRunId`). `runDoneInput` builds the asker from the same store read the verdict
  decides on (`store.last.runId`), so the act-time re-ask re-proves the comparison on its fresh read. Any other open
  run, another session's or an older or `planned` one of its own, answers `run-live` and holds.
  `stopDoneSleepInput` passes `run-own` with `hibernate-hold-ok`, as it passes a programme hold. A parked worker carrying the
  hold its own dispatch wrote now sleeps after `STOP_DONE_PARKED_IDLE_MS`, and the hold is handed to `--hold-ok`.
- **Unchanged:** a hold naming another session's open run (`run-live`), a run the store cannot read (`unreadable`),
  and any hold on a box without `hibernate-hold-ok` still hold. Whether the run's state lets the worker sleep is still
  the verdict's (`not-done` for a `working` run). ccd's `_hib_hold_ok` already passes any programme-grammar hold, the
  `run:` suffix included, so ccd is not changed.
- **Live at merge:** this change acts as soon as a box runs it, on every box whose ccd lists `hibernate-hold-ok`, and
  on no other box. There, a dispatched worker parked at `awaiting-review`, `merging` or `closing` and quiet 30 minutes
  is put to sleep from the first pass after the update. That is D-6092's intended act, which the own-run hold had
  blocked until now. The coordinator ruled that it ships without a shadow: it adds no lane and repairs an existing one.
- **The act:** `ccd hibernate --hold-ok <hold> <id>`, the run-done lane's existing clean stop, which `ccd ensure`
  reverses. No new act, verb or wire field.
- **Still held, with an own-run hold passing:** unread mail, a claim, background work (the row's or the turn
  marker's), a session cron, a dialog, a running turn, a working marker, a busy live word, an open screen and an older
  active run of its own (`run-worker`, through `openPlacedWorkers`) (`stop-done-verdict.test.ts`, "an own-run hold
  passes, and every activity still holds"). Mail, a claim, a background marker, a session cron and the older active run
  are pinned at the pass too, one case each (`stop-done-sweep.test.ts`). Over the real store, each with a control that
  differs only in the run the hold names: an older active own run, a `planned` own run, and an older own run parked at
  `awaiting-review`, `merging` or `closing` beside a newer one.

## 1. Departures from the plan and the draft, by slug

| Slug | What the plan or draft says | What this PR does, and why |
|---|---|---|
| `held-kind-asker-required` | The plan's interface is `heldKindOf(held, sessionId, coord)`. The draft added `sessionId` as a trailing optional parameter, defaulting to `null`, and compared ownership alone. | The trailing parameter is a **required** `asker: OwnRunAsker \| null`: `{ sessionId, newestPlacedRunId }`, or `null` when no session asks. Ownership alone is not enough (review 2868 F1, the plan's review focus 1): the hold's run id must equal the newest placed run's. The order stays the draft's (`held, coord, asker`); the parameters are different types, so a swap does not compile. |
| `deps-shed-names-no-session` | The plan: "Modify `server/src/depsShedPass.ts` only if it calls `heldKindOf`". It does. | `depsShedPass` passes `null`, with a comment saying why. Removing a sleeping worker's dependencies is a different act from the sleep, and the SAFETY rules forbid widening what is removed. Its verdict (`depsShed.ts`) also holds every kind outside `none`/`programme`/`run-terminal`, so `run-own` would hold there anyway. The pair is pinned (`deps-shed-pass.test.ts`, own-run hold, shadow and armed; `deps-shed-verdict.test.ts`, `run-own` in the held list), but the two guards back each other up: the `null` alone has no red case, because changing it gives `run-own`, which the verdict still holds (review 2868 F4). Recorded, not tested, as defence in depth. |
| `characterization-real-store` | Step 1: a characterization that a child parked at `awaiting-review` with its own-run hold answers `held`. | Pinned over the real store in `stop-done-sweep.test.ts` (the watcher's own pass, deps unmocked), in a commit of its own, green on `main`. The "today" row is flipped in the behaviour commit to `now: … sleeps, the hold handed to --hold-ok (was: held)`. The kept rows (no token, another session's open run, a run the store does not have) stay green on both sides. |

## 2. Red-first evidence

Each guard was mutated and the suites that pin it were run (`ccrc test`), then the file was restored from a saved copy.
The first table was measured at 65ff672cf0, before the later rows existed, so its counts are that commit's (review 2868
F7). The guard `asker !== null` (formerly `sessionId !== null`) has no runtime red case: dropping it fails the type
check, which is what catches it (review 2868 F4).

| Mutant | Suites | Result |
|---|---|---|
| `heldPasses` drops `run-own` | `stop-done-verdict`, `stop-done-sweep` | killed (3 failed) |
| own run decided without `runNamesSession` (any open run is own) | `stop-done-sweep`, `sleep-lanes-pin` | killed (4 failed) |
| an unreadable run read answers `run-own` | `stop-done-sweep`, `sleep-lanes-pin` | killed (4 failed) |
| `run-own` passes without `hibernate-hold-ok` | `stop-done-verdict`, `stop-done-sweep`, `sleep-lanes-pin` | killed (3 failed) |
| the deps-shed verdict passes `run-own` | `deps-shed-verdict` | killed (1 failed) |
| the run-done lane names no session | `stop-done-sweep` | killed (1 failed) |

The coordinator's rulings asked for a red test behind each activity hold with an own-run hold passing. Before this PR,
no row stacked an activity on a passing hold, so a decider that skipped an activity check only when a hold passes went
undetected. Each of these mutants in `decideSleep` (`server/src/sleep.ts`) adds `&& r.held === null` to one activity
hold, and each is killed by the new rows alone:

| Mutant (skipped only when a hold passes) | Suite | Result |
|---|---|---|
| `mail` | `stop-done-verdict` | killed (1 failed) |
| `claim` | `stop-done-verdict` | killed (1 failed) |
| `menu` (a dialog) | `stop-done-verdict` | killed (1 failed) |
| `background` | `stop-done-verdict` | killed (1 failed) |
| `marker-background` | `stop-done-verdict` | killed (1 failed) |
| `scheduled` (a session cron) | `stop-done-verdict` | killed (1 failed) |
| `turn` | `stop-done-verdict` | killed (1 failed) |
| `run-worker` (an older active own run) | `stop-done-verdict`, `stop-done-sweep` | killed (3 failed) |

Measured at f07c667933 and 61573c8d5e.

The newest-placed comparison (review 2868 F1), measured at this round's tip, against `stop-done-sweep` and
`sleep-lanes-pin`:

| Mutant | Result |
|---|---|
| the comparison dropped (ownership alone) | killed (6 failed) |
| the wrong run: a hold's run id at or above the newest placed (a `planned` run passes) | killed (1 failed) |
| the wrong run: a hold's run id at or below the newest placed (an older own run passes) | killed (5 failed) |

The act itself is pinned by argv equality in `stop-done-sweep.test.ts`: one own-run held pass composes exactly the one
`hibernate --hold-ok` call and nothing else, and the same hold naming another session's run composes none.

## 3. Carried

- Task 2 (`working-idle-sleep`) consumes `run-own`; nothing of it is built here.
- Known gap (review 2868 F5): the activity table in `stop-done-verdict.test.ts` has no `bucket` row and no viewer
  start-up window row (`sinceStartMs`), so a mutant that skips either only when a hold passes would survive. Neither
  line is touched by this change.
- Review 2868 F6: `runNamesSession` proves no birth, so a reused workspace name could let an earlier occupant's open run
  read as its own. The hold is written by the dispatch or open for the current occupant, and the newest-placed
  comparison narrows it further; a limit that predates this change, not widened by it.
- Review 2868 F7: 61573c8d5e is titled `test` but touches `server/src`, with comment lines only.
