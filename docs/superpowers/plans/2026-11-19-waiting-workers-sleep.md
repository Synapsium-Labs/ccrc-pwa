# Waiting workers sleep and hold no slot: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a waiting worker holds no dispatch slot and no process within about 30 minutes, and a coordinator refused at
the cap never needs the operator.

**Architecture:** the run-done sleep policy (`decideSleep`, L1) gains the worker's own-run hold as a workspace hold and
one new case, an idle worker on a `working` run. `capsMeasured` leaves out a run whose worker is measured waiting. The
refusal path is re-grounded from `origin/handoff/d8126-autonomy-stack`.

**Tech stack:** TypeScript, Fastify, `node:sqlite`, vitest; one package per directory (`server/`, `pwa/`, `shared/`).

**Spec:** `docs/superpowers/specs/2026-11-19-waiting-workers-sleep-design.md`

## Global constraints

- Run a single suite from inside the package: `./node_modules/.bin/vitest run test/<file>`; never bare `npx vitest`.
- Verdicts are pure (L1); lanes act (L4). The cap's predicate lives in `capsMeasured` alone, the sleep rule in
  `decideSleep` alone.
- Additive wire only: no new run state, `FLEET_PROTO` untouched. No new `ccd` verb.
- A new guard ships with a test that goes red when the guard is removed. Characterization pins come first, green on
  `main`, in a commit of their own.
- Each task is one pull request. Push once per round. Nothing private in any text.
- D-numbers are issued by the allocator, never taken or invented. The spec's five calls are D-8789 to D-8793 (below).
- 30 minutes is `STOP_DONE_PARKED_IDLE_MS`; no second constant for the same time.

## Review focus

1. A worker whose hold names a run that is **not its own** must still be held: the own-run comparison is on the run's
   `sessionId`, never on the hold's text alone. (Task 1 test.)
2. An unreadable run read answers `unreadable` and holds, never `run-own`. (Task 1 test.)
3. A box without `hibernate-hold-ok` holds an own-run hold, as it holds a programme hold. (Task 1 test.)
4. A worker with unread mail, background work or a session cron is never put to sleep by the new case. (Task 2 tests.)
5. A cap reading that cannot be made keeps the run counted. (Task 3 test.)

---

### Task 1: the worker's own-run hold passes sleep (spec Part 1, `D-8789`)

**Files:**
- Modify: `server/src/stopDone.ts` (`StopDoneHeldKind`, `heldPasses`, the `held` text in `STOP_DONE_HOLD_MAP`)
- Modify: `server/src/sleepLane.ts` (`heldKindOf`, and its call in the run-done input)
- Modify: `server/src/depsShedPass.ts` (it calls `heldKindOf` too). The deps-shed verdict (`server/src/depsShed.ts`)
  passes only `none`, `programme` and `run-terminal`, so `'run-own'` holds there unchanged: this task widens nothing
  the deps shed removes, and a test pins that.
- Test: `server/test/stop-done-sweep.test.ts`, `server/test/stop-done-verdict.test.ts`, the deps-shed suite

**Interfaces:**
- Produces: `StopDoneHeldKind` gains `'run-own'`: the hold names an open run whose `sessionId` is this session.
  `heldKindOf(held: string | null, sessionId: string, coord)`: `'run-own'` when the named run is non-terminal and
  `run.sessionId === sessionId`; `'run-live'` for any other non-terminal run; the rest unchanged.
- `heldPasses` = `holdOkVerb && (heldKind is 'programme' | 'run-terminal' | 'run-own')`.

- [ ] **Step 1:** characterization, green on `main`: a child parked at `awaiting-review` with the hold
  `program:p wave:1 run:<its own run>` answers hold `held`; commit alone.
- [ ] **Step 2:** failing tests: the same child, 30 minutes quiet, answers `hibernate` with `holdOk` equal to the hold
  text; a hold naming another session's open run answers `held`; `holdOkVerb: false` answers `held`; a run read that
  fails answers `held`.
- [ ] **Step 3:** implement; run `./node_modules/.bin/vitest run test/stop-done-sweep.test.ts` and the verdict suite.
- [ ] **Step 4:** run the guard suites the change can reach (`single-definition`, `rings`, `typecheck-tests`); commit.

### Task 2: an idle worker on a `working` run sleeps after 30 minutes, in shadow (spec Parts 2 and 4, D-8790, D-8791)

**Files:**
- Modify: `server/src/sleep.ts`, `server/src/stopDone.ts`, `server/src/sleepLane.ts`, `server/src/coord/store.ts`
  (`lastRunBySession`: the worker's own run apart from other active runs), `shared/lane-arm.ts` (row
  `working-idle-sleep`), `server/src/coord/schema.ts` (the row's seed migration), `pwa/src/fleet/laneArmWords.ts`
- Test: `server/test/stop-done-working-idle.test.ts` (new), the lane-arm censuses

**Interfaces:**
- Consumes: Task 1's `'run-own'`.
- Produces: `STOP_DONE_WAITING_STATES = ['working'] as const`; the verdict treats a newest placed run in it as parked
  for the clock; the lane acts only when `laneArmLive('working-idle-sleep')`, else writes a shadow journal line.
  On a live act, one `queueSystemMail` to the run's `claimedBy`, subject `worker-asleep: run <id>`, deduped on run and
  the worker's `stopAt`.

- [ ] Characterize `not-done` and `run-worker` for a `working` run; then failing tests for: sleeps at 30 minutes;
  holds under `mail`, `marker-background`, `scheduled`, `claim`, `viewer`; `dispatched` holds; a second active run
  holds `run-worker`; shadow row writes no act and no mail; live sends exactly one mail across a restart.
- [ ] Implement, run the suites, commit.

### Task 3: a run holds a slot only while its worker works (spec Part 3, D-8792, D-8793)

**Files:**
- Modify: `server/src/coord/dispatch.ts` (`capsMeasured`), `server/src/coord/dispatchDecide.ts`,
  `server/src/coord/advance.ts`, `server/src/turnverdict.ts` (`workerReadingFor`), `server/src/coord/routes.ts`
  (caps view), `shared/api.ts` (`CoordCapsUsage.waiting`), `pwa/src/fleet/CapsControl.tsx`
- Start from stack commits `81fc8422b` (D-6093) and `48ef4ad0e` (D-6094); re-ground on `main`. `workerReadingFor`,
  `caps-stale-runs.test.ts` and `worker-reading-for.test.ts` come from `48ef4ad0e`; none is on `main` yet.
- `server/src/coord/routes.ts` was held by another programme's frozen run when this plan landed: claim it, and agree
  the edit with its holder, before the first edit.

**Interfaces:**
- Produces: `WorkerReading = 'busy' | 'waiting' | 'gone' | 'unmeasured'`; `waiting` = turn verdict idle, `bg === 0`,
  `crons === 0`, and `now - max(turnAt, stopAt, restartAt) >= STOP_DONE_PARKED_IDLE_MS`. `capsMeasured` counts a run
  unless its reading is `waiting` or `gone`. `CoordCapsUsage` gains `waiting: number`.

- [ ] Characterize today's count; failing tests: idle 29 minutes counts, 30 does not; asleep does not; unmeasured
  counts; a live resume at a full cap dispatches; freed slots are paced as the stack commit paces them.
- [ ] Implement, run `caps-stale-runs.test.ts`, `run-routes.test.ts`, the pwa caps test; commit.

### Tasks 4 to 6: the refusal path (spec Part 5)

Re-ground, in order, each as its own pull request under the fleet-capacity plan's gates and review band:
- **Task 4, W1-4 (D-6095):** stack commits `45509bb6d` to `4c709ee94`.
- **Task 5, W1-4b (D-6096):** stack commits `d2d92cff8` to `31f37745e` and the two fix commits after them.
- **Task 6, W1-5 (D-6097):** stack commits `70c53d9eb`, `c121218b4`; only after D-8126 A5 is on `main`.

For each: cherry-pick onto a fresh branch from `main`, resolve against today's code, re-derive every census and pin,
run the suites the commits touch, and have it reviewed again as unreviewed work.

## Deviations found

- **D-8789 (2026-11-19)** — own-run-hold-passes. Task 1 (spec Part 1): a workspace hold that names the worker's own
  newest placed open run passes the run-done sleep exactly as a programme hold does (through `ccd hibernate --hold-ok`, on
  a box that has `hibernate-hold-ok`), so a worker parked at review, merge or close sleeps after 30 minutes quiet; a hold
  naming any other open run, an operator's own text or an unreadable run read keeps holding. It restores ruling F5 (b)
  of the fleet-capacity design, which D-6092 never achieved on the fleet, and is live at once. Issued to run 2838.
- **D-8790 (2026-11-19)** — working-idle-sleeps. Task 2 (spec Part 2): the run-done sleep policy gains one case, a
  worker whose newest placed run is `working` and whose turn marker has been quiet for `STOP_DONE_PARKED_IDLE_MS`, which
  `not-done` and the worker's own `run-worker` no longer hold; a `dispatched` run, a second active run and every use hold
  still hold. It ships in shadow as the `working-idle-sleep` row on the Shadow lanes card, armed by the operator. Issued
  to run 2838.
- **D-8791 (2026-11-19)** — coordinator-told-of-sleep. Task 2 (spec Part 4): when the lane puts a worker to sleep on a
  `working` run, it queues one system mail to that run's coordinator (`worker-asleep: run <id>`, keyed on the run and
  the sleep so a restart never sends it twice) instead of changing the stall watch, which keeps holding every rung for a
  sleeper; a worker parked at review, merge or close sends none. Issued to run 2838.
- **D-8792 (2026-11-19)** — cap-counts-working. Task 3 (spec Part 3): `capsMeasured` counts a run in an active state
  unless its worker is measured waiting (asleep, stopped, dead or archived, or awake with its turn marker quiet for 30
  minutes and no background work or session cron), and every reading it cannot make keeps the run counted. It departs
  from D-6094 (stack commit `48ef4ad0e`), which read idle at the instant of asking and bounded it by the run's age: the
  reading gains the marker's quiet time and the two-hour bound goes. Live, in a commit of its own. Issued to run 2838.
- **D-8793 (2026-11-19)** — cap-governs-starts. Task 3 (spec Part 3): the dispatch cap governs starts, not wakes; a
  waiting worker that wakes on mail is never refused and counts again from that moment, so busy workers may pass the cap
  for a while and new starts are refused until the count is back under it, with the wake budget still pacing wakes. The
  operator's to confirm. Issued to run 2838.
