# Capacity Task 1: notes for the ledger

This note records what Task 1 of the waiting-workers plan
([`2026-11-19-waiting-workers-sleep.md`](../../plans/2026-11-19-waiting-workers-sleep.md), spec Part 1) built when this
PR adopted draft #3069, and where it departs from the plan's text. The coordinator folds it into the programme ledger.
It defines no D-number: D-8789 is the number the coordinator issued for this task's call (slug
`own-run-hold-passes`), and the plan's "Deviations found" defines it.

## In short

- **The amendment:** D-8789 amends D-6091's "an open run's hold still holds" for the worker's own newest placed run, as F5 (b) requires. An older ACTIVE run of the worker's own still holds it, through `openPlacedWorkers`
  (`run-worker`), as the design review (2848) required.
- **Built:** `StopDoneHeldKind` gains `run-own`, a hold naming an open run whose `sessionId` is the asking session.
  `heldKindOf` answers it through `runNamesSession` on the run the store reads, never on the hold's text.
  `stopDoneSleepInput` passes it with `hibernate-hold-ok`, as it passes a programme hold. A parked worker carrying the
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
  active run of its own (`stop-done-verdict.test.ts`, "an own-run hold passes, and every activity still holds"). Mail,
  a claim, a background marker, a session cron and the older active run are pinned at the pass too, one case each
  (`stop-done-sweep.test.ts`), and the older active run over the real store, with its control.

## 1. Departures from the plan and the draft, by slug

| Slug | What the plan or draft says | What this PR does, and why |
|---|---|---|
| `held-kind-session-required` | The plan's interface is `heldKindOf(held, sessionId, coord)`. The draft added `sessionId` as a trailing optional parameter, defaulting to `null`. | `sessionId: string \| null` is the trailing parameter and is **required**, so every caller says whether a session is asking. The order stays the draft's (`held, coord, sessionId`) to keep the diff to the existing callers small. |
| `deps-shed-names-no-session` | The plan: "Modify `server/src/depsShedPass.ts` only if it calls `heldKindOf`". It does. | `depsShedPass` passes `null`, with a comment saying why. Removing a sleeping worker's dependencies is a different act from the sleep, and the SAFETY rules forbid widening what is removed. Its verdict (`depsShed.ts`) also holds every kind outside `none`/`programme`/`run-terminal`, so `run-own` would hold there anyway. Both are pinned: `deps-shed-pass.test.ts` (own-run hold, shadow and armed) and `deps-shed-verdict.test.ts` (`run-own` in the held list). |
| `characterization-real-store` | Step 1: a characterization that a child parked at `awaiting-review` with its own-run hold answers `held`. | Pinned over the real store in `stop-done-sweep.test.ts` (the watcher's own pass, deps unmocked), in a commit of its own, green on `main`. The "today" row is flipped in the behaviour commit to `now: … sleeps, the hold handed to --hold-ok (was: held)`. The kept rows (no token, another session's open run, a run the store does not have) stay green on both sides. |

## 2. Red-first evidence

Each guard was mutated and the suites that pin it were run (`ccrc test`), then the file was restored from a saved copy:

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

The act itself is pinned by argv equality in `stop-done-sweep.test.ts`: one own-run held pass composes exactly the one
`hibernate --hold-ok` call and nothing else, and the same hold naming another session's run composes none.

## 3. Carried

- Task 2 (`working-idle-sleep`) consumes `run-own`; nothing of it is built here.
