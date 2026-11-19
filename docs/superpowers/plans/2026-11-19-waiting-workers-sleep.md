# Waiting workers sleep and hold no slot: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** once armed, a waiting worker gives up its dispatch slot after about 30 minutes; an eligible worker also
sleeps, but a worker holding a live claim keeps its process by design. A coordinator refused at the cap never needs
the operator to free a slot.

**Architecture:** the run-done sleep policy (`decideSleep`, L1) gains the worker's own-run hold as a workspace hold and
one new case, an idle worker on a `working` run. The cap reader reports waiting in shadow and excludes measured
waiting runs only after arming. The refusal path is re-grounded from `origin/handoff/d8126-autonomy-stack`.

**Tech stack:** TypeScript, Fastify, `node:sqlite`, vitest; one package per directory (`server/`, `pwa/`, `shared/`).

**Spec:** `docs/superpowers/specs/2026-11-19-waiting-workers-sleep-design.md`

## Global constraints

- Run a single suite from inside the package: `./node_modules/.bin/vitest run test/<file>`; never bare `npx vitest`.
- Verdicts are pure (L1); lanes act (L4). `store.capsUsage` owns the counted-row predicate, and admission and the caps
  view go through the new cap reader. The sleep rule lives in `decideSleep` alone.
- Every migration takes the next free slot at its first step and is rechecked against the next free slot before
  merge. Re-derive the schema pins and censuses; do not reuse stack slot numbers.
- Additive wire only: no new run state, `FLEET_PROTO` untouched. No new `ccd` verb.
- A new guard ships with a test that goes red when the guard is removed. Characterization pins come first, green on
  `main`, in a commit of their own.
- Each task is one pull request. Push once per round. Nothing private in any text.
- D-numbers are issued by the allocator, never taken or invented. The spec's five calls are D-8789 to D-8793 (below).
- 30 minutes is `STOP_DONE_PARKED_IDLE_MS`; no second constant for the same time.

## Review focus

1. A hold passes only for the worker's **own newest placed run**: compare the hold's run id to the newest placed
   run and verify the run's `sessionId`. Neither the hold's text nor ownership alone is enough. (Task 1 tests.)
2. An unreadable run read answers `unreadable` and holds, never `run-own`. (Task 1 test.)
3. A box without `hibernate-hold-ok` holds an own-run hold, as it holds a programme hold. (Task 1 test.)
4. A worker with unread mail, background work or a session cron is never put to sleep by the new case. (Task 2 tests.)
5. A cap reading that cannot be made keeps the run counted. Shadow changes neither the effective count nor today's
   send-back check. (Task 3 tests.)

---

### Task 1: the worker's own-run hold passes sleep (spec Part 1, `D-8789`)

Adopt draft #3069 on `main`.

**Files:**
- Modify: `server/src/stopDone.ts` (`StopDoneHeldKind`, `heldPasses`, the `held` text in `STOP_DONE_HOLD_MAP`)
- Modify: `server/src/sleepLane.ts` (`heldKindOf`, and its call in the run-done input)
- Modify: `server/src/depsShedPass.ts` (it calls `heldKindOf` too). The deps-shed verdict (`server/src/depsShed.ts`)
  passes only `none`, `programme` and `run-terminal`, so `'run-own'` holds there unchanged: this task widens nothing
  the deps shed removes, and a test pins that.
- Test: `server/test/stop-done-sweep.test.ts`, `server/test/stop-done-verdict.test.ts`, the deps-shed suite

**Interfaces:**
- Produces: `StopDoneHeldKind` gains `'run-own'`. `heldKindOf` uses the measured newest placed run as well as the
  session id and run read: `'run-own'` only for the worker's own newest placed run, when it is non-terminal and
  `run.sessionId === sessionId`; `'run-live'` for any other non-terminal run; failed reads stay `unreadable`.
  Re-prove the same comparison at act time.
- `heldPasses` = `holdOkVerb && (heldKind is 'programme' | 'run-terminal' | 'run-own')`.

- [ ] **Step 1:** characterization, green on `main`: a child parked at `awaiting-review` with the hold
  `program:p wave:1 run:<its own run>` answers hold `held`; commit alone.
- [ ] **Step 2:** failing tests: the same child, 30 minutes quiet, answers `hibernate` with `holdOk` equal to the hold
  text; another session's open run or an older open run of the same worker answers `held`; `holdOkVerb: false`
  answers `held`; a failed run read stays `unreadable` and holds. Pin that `mail`, `claim`, `marker-background`
  and `scheduled` still hold the same parked worker, and the own-run hold still bars deps shedding.
- [ ] **Step 3:** implement; run the sweep, verdict and deps-shed suites.
- [ ] **Step 4:** run `sleep-lanes-pin.test.ts`, `history-replay.test.ts`, `single-definition`, `rings` and
  `typecheck-tests`; commit.

### Task 2: an idle worker on a `working` run sleeps after 30 minutes, in shadow (spec Parts 2 and 4, D-8790, D-8791)

Adopt draft #3070, stacked on #3069; land after Task 1.

**Files:**
- Modify: `server/src/sleep.ts`, `server/src/stopDone.ts`, `server/src/sleepLane.ts`, `server/src/coord/store.ts`
  (`lastRunBySession` and durable sleep-notice dedupe), `shared/lane-arm.ts` (row `working-idle-sleep` and its
  `LANE_ARM_TEXT`), and `server/src/coord/schema.ts` (shadow seed). The card's `pwa/src/fleet/laneArmWords.ts`
  consumes the shared text; do not define it twice.
- Test: `server/test/stop-done-working-idle.test.ts` (new), the lane-arm censuses.

**Interfaces:**
- Consumes: Task 1's `'run-own'`. `lastRunBySession` distinguishes the worker's own newest placed run from any
  additional active run naming that worker.
- Produces: `STOP_DONE_WAITING_STATES = ['working'] as const`; the verdict treats the worker's own newest placed run
  in that set as parked for the clock. At the act site, use `runStateOf(store) === 'working'` from the run the lane
  read to apply only this case's gate. Read the row through `laneArmRowViewOf`, like `rollLane.ts`; the underlying
  `laneArmLive(stored: string, gate: string | null)` takes the stored setting and gate, not the row id. In shadow,
  journal without acting or mailing; existing parked sleeps do not take this gate.
- On live sleep, mail the run's `claimedBy` through `queueSystemMail`. Follow the stall-notice pattern: a durable
  observation row in the same transaction as the mail, or `hasMailWithSubject` with the run and worker's `stopAt`
  in the subject. At most one notice per `(run, stopAt)` and one per run per `STOP_DONE_PARKED_IDLE_MS`, including
  across acknowledgement and restart. A parked sleep sends none.

- [ ] Characterize `not-done` and `run-worker` for a `working` run; then failing tests for: sleeps at 30 minutes;
  holds under `mail`, `marker-background`, row `background`, `scheduled`, `claim`, `viewer`, `menu`, `roster`,
  `bucket` and `turn`; `dispatched` holds; a second active run holds `run-worker`; shadow writes no act and no
  mail and leaves parked sleeps alone; live mail dedupes across acknowledgement and restart, respects the per-run
  bound for different stop stamps, and is absent for parked sleeps.
- [ ] Implement, run the suites and censuses, commit.

### Task 3: a run holds a slot only while its worker works (spec Part 3, D-8792, D-8793)

Adopt draft #3074, based on `main`, with stack commits `81fc8422b` (D-6093) and `48ef4ad0e` (D-6094) as the
reference. `workerReadingFor`, `caps-stale-runs.test.ts` and `worker-reading-for.test.ts` come from `48ef4ad0e`;
none is on `main` yet. Land after Task 2; no code dependency on Task 1.

**Files:**
- Modify: `server/src/coord/store.ts` (`capsUsage`), `server/src/coord/dispatch.ts` (cap reader and `capsMeasured`),
  `server/src/coord/dispatchDecide.ts`, `server/src/coord/advance.ts`, `server/src/turnverdict.ts` (`workerReadingFor`),
  `server/src/coord/routes.ts` (caps view), `shared/api.ts` (`CoordCapsUsage.waiting`), `pwa/src/fleet/CapsControl.tsx`,
  `shared/lane-arm.ts` (`cap-counts-working` row and text), `server/src/coord/schema.ts` (shadow seed).
- `server/src/coord/routes.ts` was held by another programme's frozen run when this plan was written: claim it and
  agree the edit with its holder before the first edit.

**Interfaces:**
- `store.capsUsage` owns the SQL counted-row predicate. Derive the waiting subset of those same rows through the
  new cap reader, shared by admission and the caps view; no second predicate or direct view-side count.
- `WorkerReading = 'busy' | 'waiting' | 'gone' | 'unmeasured'`. Awake `waiting` requires an idle turn verdict,
  `bg === 0`, no row background or subagents, `crons === 0`, and at least one readable stamp among `turnAt`,
  `stopAt`, `restartAt` with quiet time since the newest stamp of at least `STOP_DONE_PARKED_IDLE_MS`. No stamps
  means `unmeasured` and counts; known asleep, stopped, dead or archived is `gone`.
- `CoordCapsUsage` adds `waiting: number`, the number of measured `waiting` or `gone` rows in today's count.
  Report it in shadow and live. Shadow keeps today's effective count and checks; live excludes `waiting` and
  `gone`, applies the stack's freed-slot pacing and live-resume exemptions, and never refuses a send-back to a
  sleeper at the cap (`advance -> working` from `awaiting-review`, `merging` or `closing`). Other gates still bind.
  Mail wake is a separate door and keeps its existing wake budget. D-8793 remains for the operator to confirm.
- Define the switch once in the shared catalogue, seed it in shadow and extend the same census and single-definition
  pins as for Task 2. Off returns to today's cap count and send-back check without stopping the waiting readings.

- [ ] Characterize today's count and cap-checked send-back. Red-first tests: idle at 29 minutes counts and at 30
  minutes is waiting; marker background, row background, subagents and crons keep the run counted; missing stamps
  and other unmeasured readings count; a measured sleeper is `gone`. Waiting appears in the caps view in both modes;
  shadow still counts those rows and refuses a send-back to a sleeping worker at a full cap, while live excludes
  them and admits that send-back at a full cap even when no slot frees. Pin all three source states, live resumes,
  an unchanged mail wake, and the freed-slot pacing.
- [ ] Implement, run `caps-stale-runs.test.ts`, `worker-reading-for.test.ts`, `run-routes.test.ts`,
  `coord-caps-route.test.ts`, the PWA caps test and the lane-arm censuses; commit.
- [ ] After merge, keep Part 3 in shadow. Arm Part 2 first. Re-measure OA-F2 (dated sample size and share of eligible
  finished children asleep by 30 minutes, excluding and reporting mail-held children) and OA-F3 (the shadow table
  of counted runs the 30-minute rule would exclude, with each worker reading). These are arming evidence, not merge
  gates: the item asking the operator to arm Part 3 includes both. The spec's §1 is only the baseline.

### Tasks 4 to 6: the refusal path (spec Part 5)

Re-ground, in order, each as its own pull request under the fleet-capacity plan's gates and review band:
- **Task 4, W1-4 (D-6095):** adopt draft #3077, stacked on #3074. Stack commits in order: `45509bb6d`, `e6a17318f`,
  `dc58b2bd3`, `5c4d53d34`, `4c709ee94`.
- **Task 5, W1-4b (D-6096):** `d2d92cff8`, `7af069241`, `83556569a`, `a76f94659`, `1b30bf6f1`, `31f37745e`,
  `7e0c26df3`, then the in-place fix commits `cf6ec4fc0`, `ca4fb9a53`. Keep the Step 0 self-claimed-dispatch
  count gate: zero, or a recorded departure before the behaviour commit. Re-ground the fixes against the earlier
  tasks. If the cap detail does not exist at Task 5, carry the `cf6ec4fc0` cap-detail hunk into Task 6.
- **Task 6, W1-5 (D-6097):** `70c53d9eb`, `c121218b4`, `264625d1d`; only after D-8126 A5 is on `main`.
  Re-ground the cap detail with the in-place fix from Task 5: offer an in-place bind only on a qualifying planned
  dispatch, never on a send-back or where the bind would refuse.

The old `cdab5ae70` hold text is not picked: this plan replaces its OA-F2/OA-F3 merge holds with the Part 3 arming
check, and retains its Task 5 Step 0 count gate. The later measurement follow-ons are not refusal-path work;
re-derive `3203be4666`'s applicable slot and pin fixes on today's tree instead of picking its old slot numbers.

For each: cherry-pick onto a fresh branch from `main`, resolve against today's code, re-derive every census and pin,
take the next free migration slot at the first step and check it again before merge, run the suites the commits
touch, and have it reviewed again as unreviewed work.

## Deviations found

- **D-8789 (2026-11-19)** — own-run-hold-passes. Task 1 (spec Part 1): amends D-6091's "an open run's hold still
  holds" for the worker's own newest placed run, as ruling F5 (b) requires. When that run is non-terminal and its
  `sessionId` matches the worker, its workspace hold passes the run-done sleep like a programme hold through
  `ccd hibernate --hold-ok`, on a box with `hibernate-hold-ok`. Other open runs, operator text, unreadable reads
  and every use hold still hold. Live at once. Issued to run 2838.
- **D-8790 (2026-11-19)** — working-idle-sleeps. Task 2 (spec Part 2): the run-done sleep policy gains one case, a
  worker whose own newest placed run is `working` and whose turn marker has been quiet for `STOP_DONE_PARKED_IDLE_MS`;
  `not-done` and that run's `run-worker` no longer hold it. A `dispatched` run, a second active run and every use
  hold still hold. It ships in shadow as `working-idle-sleep`, armed by the operator before Part 3. Issued to run 2838.
- **D-8791 (2026-11-19)** — coordinator-told-of-sleep. Task 2 (spec Part 4): live sleep on a `working` run can mail
  its coordinator using the stall-notice pattern: an observation in the mail transaction or `hasMailWithSubject`
  with both run and `stopAt` in the subject. At most once per `(run, stopAt)` and once per run per
  `STOP_DONE_PARKED_IDLE_MS`, across acknowledgement and restart; parked sleep sends none and the stall watch is
  unchanged. Issued to run 2838.
- **D-8792 (2026-11-19)** — cap-counts-working. Task 3 (spec Part 3): the cap reader reports measured waiting from
  merge but excludes it from the `store.capsUsage` count only when `cap-counts-working` is armed. Known asleep,
  stopped, dead or archived workers qualify; awake workers must be idle, with no marker or row background,
  subagents or session crons, and at least 30 minutes since the newest readable stamp. A marker with no stamps or
  any other unmeasured reading keeps the run counted. This amends D-6094 by replacing the two-hour run-age bound
  with measured quiet time.
  Only when armed, a send-back to a sleeper is a resume and skips the cap check; unarmed, today's check stands.
  Issued to run 2838.
- **D-8793 (2026-11-19)** — cap-governs-starts. Task 3 (spec Part 3): the dispatch cap governs starts, not wakes; a
  waiting worker that wakes on mail is never refused and counts again from that moment, so busy workers may pass the cap
  for a while and new starts are refused until the count is back under it, with the wake budget still pacing wakes. The
  operator's to confirm. Issued to run 2838.
