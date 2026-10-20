# Runs close themselves, and the runs page becomes a programme view (design)

**Status:** rev 0 (2026-10-20), a draft for the operator's review. It defines no D-numbers; the plan that follows it allocates them. Every operator choice it needs is in §6, each with a recommended option.

**The request (operator, 2026-10-20, verbatim):**

> "what are we going to do with the \"runs\" page. How is that page useful and why do I need to manually abandon runs on it when they dont' start? It's all nonsensical"

**The operator's ruling (2026-10-20), binding on this design.** Asked "The runs page and runs that never start: what should I do?", the operator chose "Auto-expire + programme view (Recommended)", whose stated meaning was:

> "Runs that never start or whose coordinator is gone close themselves and tell the coordinator, so you never abandon one by hand. The page becomes a per-programme view (programme, wave, working, waiting, done, needs you), with the raw run ledger under 'advanced'. Specced and planned through the companion like the others."

In the same exchange the operator kept the daily brake as planned (fleet-capacity spec §6 F3 (a): it counts only fresh workspaces, default 64, `CAP_MAX` 256). This design does not touch it.

**What the ruling supersedes.** Three earlier sentences forbid an automatic close, and this ruling overturns them for the causes named in §3.1 only:
- the fleet-capacity spec's "Nothing closes a run automatically; that stays the coordinator's act" (§3.4) and its R11, "Nothing ends a forgotten or never-dispatched run";
- the coordinator-durability tail spec's rejected alternative (b), which cites #760's "must not auto-close".

The drift reconciler itself still never acts. It stays a reader, and §3.1 gives the act to the one lane that already closes runs.

- **Citations** are to `origin/main` `1128d3ab6`. They name a function, constant or file; this document cites no line numbers.
- **Measurements** come from one read-only snapshot of the controller's `coord.db` (about 17:15 UTC on 2026-10-20), joined with the fleet registry's markers and per-session process counts. **[M]** marks a measured figure, **[I]** an inferred one, and **[open]** a fact not yet measured. Liveness in that snapshot is approximate: it counts processes in each session's pane scope (two or more reads "live"), not the server's `ClaimantVerdict` ladder, and it does not separate hibernated sessions (§1.3). Programmes are "programme A", accounts "one account".

**Date:** 2026-10-20 · **Branch:** `docs/runs-page-spec` (cut from `origin/main` `1128d3ab6`) · **Issues:** #435 (the reused-name root fix), #755 (D3, brief confirmation), #757 (D4, roster re-injection), #758 (D6, runs released when a coordinator is archived), #760 (D7, the drift reconciler), #957 (the fleet-capacity spec)

**Related:**
- `2026-10-19-ccrc-consolidation-wave-design.md`: one owner per job, decide in L1, act in L4. C5 owns runs and keeps the dead-coordinator lane (K1's "legitimately different" row); K6 is the one notice funnel; K11 owns cadence; K12 owns switches; K14 gives the PWA one reader per server fact.
- `2026-10-20-fleet-capacity-and-worker-lifecycle-design.md` (#957): W1-3's stale-run filter in `capsMeasured`; R11; §6 F3.
- `2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon-design.md`: the drift reconciler's `run-quiet` and `claimant-gone` (D-5921), OA-D6 (arming the dead-coordinator lane), and D6/D8 as W6 inputs.
- `2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m-design.md` (#119): `workerLastSeen` / `workerTurn` and the server's dispatched-to-working compare-and-set (D-5915).
- `2026-09-24` workspace lifecycle spec §5.2 (the archive door's `programme:'end'`) and §5.4 (the dead-coordinator lane).
- `2026-10-15-ccrc-two-skins-design.md` and the skins W3 plan: P5 (D-5588), P5a (D-5587, D-5650), P6 (U9) and P9 (D-5592), which this design absorbs (§3.2).
- `2026-10-17-coordinator-first-routing-design.md`: every notice in this design goes to the coordinator first.

## In short

- **Most failed closes are the operator's, and almost all of those are runs that never started.** Of 24 failed closes ever, 12 were the operator's Abandon, 10 of them on a `planned` run. All 5 Abandons of the last 7 days were `planned` runs [M]. Open today are 21 `planned` runs with no `run_events` row and no dispatch stamp; 10 of them are more than 7 days old, and the oldest is 823 h [M].
- **Nothing in the server ever ends such a run (§2).** Every lane that reads runs either excludes `planned` (stall watch, drift's `run-quiet`), only reports (drift has no caller on main), or acts only on a coordinator that crashed and is shadow anyway (the dead-coordinator lane). The coordinator is never told a run ended, and after compaction it forgets quiet runs. So the only door left is the operator's Abandon.
- **The page asks the operator to act because it is a ledger, not a view.** It lists run rows by programme slug, shows a run number when a row has no workspace, and puts Abandon on every row, finished ones included. It has no answer to "what is each programme doing, and does any of it need me?".
- **The design (§3):**
  - **(a) Auto-expire.** The dead-coordinator lane becomes C5's one **run-close lane**, with one row per stuck cause (each with its own condition, grace, arming marker and per-pass cap), the way K1 gives sleep one row per policy. It closes `failed` with `causedBy 'sweep'` and a `detail` naming the cause, so history never reads as a person's Abandon. It never closes a run whose worker is alive and working, never touches a run that has an open PR or unpushed commits (those go to the coordinator), never closes a review run while its work run is open, and re-measures at the act on the one coordination mutex so a late start wins. It tells the coordinator with one system mail per programme per pass, and that mail never wakes a sleeping coordinator.
  - **(b) Programme view.** `/runs` shows programmes, not runs. Each card reads "programme A · wave 3 of 5" with working, waiting, done and needs-you counts, the last activity and the coordinator. A drill-down lists one programme's waves. The raw run ledger moves under "Advanced".
  - **(c) Wire.** Additive fields only: `closedBy`, `closeDetail` and `lastActAt` on `RunSummary`, plus one cold read `GET /api/programs` built from existing store reads.
  - **(d) Observability.** One quiet line per programme ("ccrc closed 2 runs that never started"), one record-only feed row per pass, and a digest line. No toasts and no push.
- **Nothing new where something exists (§4).** The detectors are drift's predicates, the actor is the dead-coordinator lane's executor and `closeRun`'s guarded `'sweep'` arm, the notice is `queueSystemMail` and K6's funnel, and the switches are K12 rows.
- **Migration is smallest first (§5).** W1 closes never-started runs in an idle programme, the cause behind every manual Abandon of the last week. W2 closes runs whose coordinator is gone. W3 is the programme view, W4 moves the ledger under Advanced, and W5 closes runs whose worker is gone.

## 1. The problem in numbers

### 1.1 What the operator sees

The operator's words are the requirement: they must "manually abandon runs … when they dont' start", and the page is "nonsensical". Measured on 2026-10-20:

| What | Measured | Source |
|---|---|---|
| Runs ever | done 649, failed 24, open 36 | `runs` [M] |
| Open runs by state | planned 21, awaiting-review 6, working 4, dispatched 3, merging 2 | `runs` [M] |
| Planned runs with any `run_events` row, or a `dispatchStartedAt` | 0 of 21 | `runs`, `run_events` [M] |
| Planned runs older than 7 days since their last transition | 10 (oldest 823 h) | `runs` [M] |
| Planned runs that are review runs | 8 of 21 | `runs` [M] |
| Failed closes by `causedBy`, all time | coordinator 12, operator 12 (10 from `planned`, 2 from `closing`), sweep 0 | `run_events` [M] |
| Operator Abandons, last 7 days | 5, all from `planned` (2 work, 3 review), on runs open 14 to 71 h | `run_events` [M] |
| Coordinator closes, last 7 days | 267 done, 8 failed | `run_events` [M] |
| Open runs with no worker session at all | 21 (the planned ones) | `runs` [M] |
| Open runs whose worker has a registry record but no pane process | 6 (dispatched 2, working 2, awaiting-review 2) | registry, cgroups [M, approximate] |
| Open runs whose coordinator is archived or has no registry record | 3, all planned, 776 to 823 h old | registry [M] |
| Open runs whose coordinator has no live agent process | 13 more (asleep, idle or gone; not separated) | cgroups [M, approximate] |
| Dispatched runs since their last transition | 2 at 199 h and 159 h, with 9 and 4 stall observations; both workers have no pane, both coordinators are live | `run_events`, cgroups [M] |
| Open programmes, programme · wave pairs, claimants | 19, 32, 13 | `runs` [M] |
| Open runs under a programme row that reads `done` or `abandoned` | 4 and 1 | `programs` [M] |
| Sweep closes ever | 0 (the dead-coordinator lane is shadow: `dead-coordinator-lane-live` absent) | registry, `run_events` [M] |

**Open runs by age since opened** (from the first pass, 35 runs; one more planned run appeared by the second) [M]:

| State | under 1 h | 1–6 h | 6–24 h | 1–7 d | over 7 d |
|---|---|---|---|---|---|
| planned (work and review) | 0 | 4 | 3 | 3 | 10 |
| awaiting-review | 0 | 0 | 4 | 2 | 0 |
| dispatched | 0 | 1 | 0 | 0 | 2 |
| merging | 0 | 0 | 2 | 0 | 0 |
| working | 0 | 0 | 1 | 1 | 2 |

### 1.2 What the numbers say

- **The operator closes half of all failed runs, and the runs they close never started.** Half of all failed closes are the operator's (12 of 24), and 10 of those 12 are `planned` runs. Coordinators close their own runs well (267 done in a week); what they leave behind is runs that were opened and never dispatched.
- **The backlog is old and has no owner.** 10 planned runs have waited more than a week, and 3 belong to coordinators that no longer exist. Those 3 are the runs the operator was advised to Abandon on 2026-10-19, and they are still open.
- **The stuck runs that did start are few, and their coordinators are alive.** Two dispatched runs have been quiet for a week, with stall mails sent to their live coordinators and nothing done.

### 1.3 Not yet confirmed

Each item is the first step of the wave that depends on it.
- Which of the 6 "no pane" workers and the 13 coordinators with no agent are **hibernated** (asleep and wakeable) rather than gone. The snapshot did not read `.hibernated`. W2's and W5's first step reads the server's own `ClaimantVerdict` and `liveStatus`.
- How the 4 open runs under a `done` programme and the 1 under `abandoned` arose. `CoordStore`'s programme upsert (`ON CONFLICT(slug) DO UPDATE SET title`) leaves `programs.state` as it was, so a run opened under a finished slug reads as a stale row [I]. W3's first step.
- Which claimants tripped the dead-coordinator breaker (one feed row about 8 h before the snapshot) and why `dead_claimants` is now empty. W2's first step.
- Why coordinators open review runs ahead of dispatch (8 of 21 planned runs are reviews): the coordinator skill's text and `openRun`'s preconditions. W1's first step.
- Whether the stall watch's coordinator rung (r2) ever led to a close for the two quiet dispatched runs. W5's first step.

## 2. Why runs get stuck today

### 2.1 One causal chain per cause

Each cause ends at the same place: the run stays open, and only the operator's Abandon (or the coordinator's own failed close, which it has forgotten to make) can end it.

**S1. Planned and never dispatched.**
- The coordinator opens runs ahead of time (later waves, review runs) through `POST /api/runs` (`openRun`), then never calls dispatch, or forgets the run after compaction (D4 #757, "re-inject its run roster on compaction", is still to spec).
- The stall watch (`sweepStalls`) reads `ACTIVE_RUN_STATES` only. Drift's `run-quiet` excludes `planned` by design ("a planned run waits by design … and is never a finding"). The dead-coordinator lane does not apply while the coordinator lives.
- The run keeps programme holds and `siblings-open` standing (capacity spec R11).
- **Measured:** 21 open, 10 over a week, every manual Abandon of the last week [M].

**S2. Dispatch refused or failed before `ws-add`.**
- `dispatchRun` refuses (registry unmeasurable, worker-starting, coordinator paused, a cap) before `markDispatchStarted`, so the run stays `planned` with no stamp.
- The coordinator gets the refusal in its HTTP answer and nothing else (capacity spec R8, fixed by its W1-4 wake). If it drops the wave, the run is S1.
- **Measured:** none of today's planned runs carries a dispatch stamp, so none is a half-done dispatch [M].

**S3. Dispatch stalled after `ws-add`.**
- `markDispatchStarted` is stamped and the spawn never confirms. The row says "dispatch never completed — a workspace may exist" after `SPAWN_STALL_MS` (6 min), as display only.
- **Measured:** 0 live [M].

**S4. Dispatched, but the worker never takes the brief or never reports.**
- A lost brief is now covered: `sweepBriefs` (D-5841, D3 #755) retries at 5 minutes and mails the claimant "brief not taken" at 10 minutes. It never closes.
- A worker that took the brief and then went away (its pane gone, not hibernated) gets the stall ladder's mails (worker, then coordinator). Drift's `run-quiet` would name it after 72 h, but drift has no caller. The #119 heartbeat (D-5915) is approved and not built.
- The coordinator is alive and has been mailed, and still does not close.
- **Measured:** 2 dispatched runs at 159 h and 199 h with no worker pane; 2 working runs and 2 awaiting-review runs with no worker pane [M, approximate].

**S5. Coordinator gone by a deliberate act (archived, stopped by hand, forgotten, absent from the registry).**
- The dead-coordinator lane counts only a crash: `DEAD_COORDINATOR_DELIBERATE_ACTS` (stop, archive, reap, destroy, purge, forget, reclaim, expire, hibernate) never read as "dead".
- The archive door's `programme:'end'` ends the runs only when the archive goes through the PWA door. An archive by `ccd` or by hand bypasses it. D6 #758 ("runs released when their coordinator is archived") is a consolidation W6 input and is unbuilt.
- The page offers Resume (hand the programme to a living coordinator) or Abandon. For a dead programme, the 2026-10-19 ruling was Abandon, never Reclaim.
- **Measured:** 3 open planned runs, 776 to 823 h old, whose claimant is archived (2) or absent (1) [M].

**S6. Coordinator crashed.**
- Owned by the dead-coordinator lane: a crash, dead for `DEAD_COORDINATOR_AFTER_MS` (1 h) with no successor, has every open run of the programme closed `failed` with `causedBy 'sweep'`, with a breaker (two crashes within 10 minutes).
- It is shadow until the operator creates `dead-coordinator-lane-live` (OA-D6), so today it only records.
- **Measured:** 0 sweep closes ever [M].

**S7. A reused workspace name.**
- A never-closed run still names a workspace id that was reaped. `ccd`'s slug picker hands the free name to a new child, and the card then reads the new child as working for the old run.
- The card fix landed (D-5828: a run id below the row's `.child` run is never that session's run). The root fix (release, reap and purge refuse while an open run binds the id; the slug picker skips bound names) waits on #435.
- The remedy was Abandon, never Reclaim, because Reclaim hands a dead programme to a live coordinator.
- **Measured:** the run in that history is still open, `planned`, 776 h old, with its worker stopped and its claimant archived [M]. It is an S5 run as well.

### 2.2 Why the page asks a person to act

```
coordinator opens waves ahead ──▶ forgets after compaction (D4 #757 unbuilt)
      │                                   │
      ▼                                   ▼
 run stays planned ◀── no lane reads planned (stall, run-quiet exclude it)
      │
      ├── coordinator archived by hand ──▶ dead-coordinator lane ignores deliberate acts (and is shadow)
      │
      ▼
 nothing ends it, nothing tells the coordinator a run ended (no close mail on any close)
      │
      ▼
 /runs lists every open row, Abandon on every row  ──▶  the operator is the only closer left
```

Three defects in the page make it worse:
- **It is a ledger.** Its group head is the programme **slug** (U9), its row names a workspace or a branch and falls back to the run number (D-5545 says it never should), and finished runs sit in one long list. It never says what a programme is doing as a whole.
- **Its "needs you" model is wrong.** `runGroups` (`RUN_GROUP`) files `awaiting-review` under `needs`. That state waits on a reviewer and the coordinator, not on the operator. The model also has no consumer.
- **Its doors invite the act.** Abandon is drawn on every row, finished rows included, and Resume appears whenever a claimant reads dead. Neither tells the operator that the system could have done it.

## 3. Design

### 3.1 (a) Auto-expire: the system closes stuck runs

#### One owner: C5's run-close lane

The dead-coordinator lane is already the one place that closes runs without the coordinator. It has:
- an L1 decider (`deadCoordinator.ts`);
- an L4 sweep (`watch.ts` `sweepDeadCoordinators`);
- one executor on the coordination serialiser (`coord/endDeadCoordinator.ts`);
- `closeRun`'s guarded third word, `'sweep'`, which can only be reached with a `SweepCloseGuard` (a compare-and-set plus a re-measure immediately before and after the fleet act);
- a breaker, durable anchors, a failure backoff and a hand-made live marker.

The consolidation spec (K1, "legitimately different") keeps it in C5's decider set. This design **widens that lane** into the run-close lane, with **one row per cause**. It does not add a parallel expiry lane. The other candidates do not fit:
- **K1** acts on workspaces (sleep, retire). It receives the worker after the close, through `closeRun`'s existing child reclaim, exactly as today.
- **W1-3's stale-run filter** (capacity spec §3.4) only stops counting a run. Its liveness predicate is the same question as row E4's "worker gone", so the two share one function (§4). Once E4 is live, W1-3 has nothing left to filter except runs still inside their grace.
- **The drift reconciler** stays a reader that never acts. Its `run-quiet` and `claimant-gone` predicates move to the L1 module both read, so a drift finding and a close can never disagree about the same run.

**Per-row shape.** Each row has its own condition, grace, arming marker (a K12 `SWITCHES` row, no writer in the tree, shadow first), per-pass cap and retry memory, on one K11 `LANE_SCHEDULE` row. Merging the rows' code never merges their arming or their budget, which is K1's rule applied to C5. In shadow, a row records "would close" through the funnel and acts on nothing.

#### The rows

All ages are wall-clock from the run's last **act** row in `run_events`, or from its open time if it has none. An act row is drift's definition: stall observations and the lanes' own `operator` rows never reset it. A programme's **last act** is the newest act row on any of its runs, open or closed, plus the coordinator's own dispatch, advance and close calls.

| Row | Cause | Condition (all must hold, measured at the pass and again at the act) | Grace (§6 G1–G3) | Fleet act at close |
|---|---|---|---|---|
| E1 `never-started` | S1, S2 | run `planned`; `dispatchStartedAt` null; the **programme** has no run in `ACTIVE_RUN_STATES` and no last act within the grace; the coordinator was mailed the warning (below) at least 24 h earlier and has acted on none of the programme's runs since | 72 h of programme quiet | none (no workspace was made) |
| E1r `review-orphaned` | S1 for a review run | review run `planned`; its target work run is closed, or has a later review run that reached `working` or `done` | 1 h | none |
| E2 `dispatch-stalled` | S3 | run `planned`; `dispatchStartedAt` set and older than the grace; no session bound; no registry record names the run in its `.child` marker | 1 h | none; a late child is handled below |
| E3 `claimant-gone` | S5 | every open run of a programme whose claimant measures dead on `ClaimantVerdict` by a deliberate act (archive, forget, purge, destroy, reap, expire) or is absent from the registry, with no successor (no live session holds the claimant's uuid, the lane's existing rule) | 1 h | as the dead-coordinator lane: `ws-release`, then the child reclaim |
| E3s `claimant-stopped` | S5, a hand stop | as E3, but the claimant's last deliberate act is `stop` | 24 h | as E3 |
| E4 `worker-gone` | S4 | run `dispatched`, `working` or `unknown`; its worker measures dead (`stopped` by no lane, `orphan`, `never-started`, or `absent`), **not** hibernated; no act in the grace; branch and PR checks below pass | 24 h | `ws-release` of nothing (the worker is gone); the child reclaim's own checks run as today |
| E5 `name-reused` | S7 | the run's `sessionId` is held by a session whose `.child` marker names a **later** run (D-5828's predicate), or whose registry generation is newer than the run's dispatch | at once, on the next pass | **none**: the name belongs to someone else now |
| (kept) `claimant-crashed` | S6 | today's rule, unchanged | 1 h | today's |

Notes on the rows:
- **E1 is per programme, not per run.** A queued wave 5 behind a working wave 4 is never closed, because its programme is active. Only a programme in which nothing has moved for the grace has its planned runs closed, all of them in one close pass.
- **Hibernation is never "gone".** A hibernated claimant or worker reads `stopped` with a `hibernate` act, which both E3 and E4 exclude. It wakes on mail and is still working for its programme.
- **`awaiting-review`, `merging` and `closing` are not stuck causes.** They wait on the coordinator or a reviewer, and drift's `review-waiting` already names them to the coordinator. They close only through E3 (the coordinator is gone) or through the work run's own close.
- **E3 and E4 together answer "whose coordinator is gone".** A crash keeps today's row and its arming (OA-D6). A deliberate archive or absence is E3. Only a coordinator stopped by hand gets a longer grace (§6 G2), because a stop is the one deliberate act a person often undoes.

#### The warning before E1

E1 is the only row whose coordinator is alive, so the coordinator gets a chance to act before the close. When a programme reaches **grace − 24 h** of quiet, the lane queues one system mail to the claimant:
- subject: `runs closing: <programme> · <waves> in 24 h`
- body: which runs, why ("opened, never dispatched, programme quiet for 48 h"), and what keeps them: any dispatch, advance or close on the programme resets the clock.

Nothing else keeps them. There is no "keep" verb: a queued wave the coordinator still means to run costs it one dispatch, and one it has forgotten closes itself.

#### What the close records

- **The transition:** `failed`, through `abandonMove` (`planned` and review runs fail directly; others go through `closing`), exactly as the operator's Abandon moves.
- **`causedBy`: `'sweep'`.** A person's Abandon stays `'operator'` and the coordinator's close stays `'coordinator'`, so the history stays honest: `run_events` shows which runs a person closed and which ones the system closed.
- **`detail`: `expired:<row>`** (for example `expired:never-started`, `expired:claimant-gone`), with the measured fact (the age, the claimant's verdict and cause). The crash row keeps its present detail.
- **The programme row:** D-51's last-close rule is unchanged. A programme whose last open run is closed by the lane reads `abandoned`, and the programme view says who closed it (§3.2).
- **The signature:** `closeRun`'s `'sweep'` overload already demands a guard. Its `stillCrashed` re-measure generalizes to `stillStuck(row)`: the row's whole condition, asked again inside the mutex immediately before the fleet act and again after it, before the commit (the departure `the-sweep-re-measures-inside-the-arm`).

#### What it must never do

| Never | How it is held |
|---|---|
| Close a run whose worker is alive and working | E4 requires the worker to measure dead (not hibernated) and no act within 24 h; a busy turn, a live pane, a mail ack or (after #119) a `workerLastSeen` inside the grace refuses. E1, E1r and E2 have no worker. E3 closes a programme whose coordinator is gone; if one of its workers is alive and busy, that run is left open and named under "needs you" (below) instead |
| Lose an unpushed branch or an open PR | A run whose branch has commits not on any remote, or whose PR is open, is **never** closed by the lane. It is told to the coordinator (E4) or, when the coordinator is gone (E3), shown under "needs you" with that reason. The worker's workspace is only ever released, never removed; the child reclaim keeps its own refusals (spent-child evidence, the PR ledger, dirty trees) |
| Close a review run whose work run is open | E1r needs the work run closed or already reviewed later. A planned review run of an open work run closes only with its programme (E1, E3) |
| Race a late start | The pass decides; the act runs on the one `CoordMutex` that `dispatchRun`, `advance` and `closeRun` share, and re-measures there. If a dispatch began between the pass and the act, `dispatchStartedAt` or the state has changed, `stillStuck` answers no, and the close is skipped. If the close commits first, the late dispatch is refused with `bad-transition` from `failed` |
| Strand a late child | A child whose `ws-add` completed after an E2 close carries a `.child` marker naming a closed run. Its brief mail was cancelled at close, so it has done no work. The child reclaim (K1's `child-spent` reason) already retires a child whose run is closed, with its own checks. If that child holds anything (it cannot, without a brief), the reclaim refuses and says so, as it does today |
| Release or reclaim a session that reused the name | E5 closes with no fleet act at all: no `ws-release`, no child reclaim. The session now holding the name is someone else's |
| Wake a herd | Each row acts on at most 3 programmes a pass. Mail to a sleeping coordinator does not wake it (below). No row restarts anything |
| Block an account swap | The lane reads no account figure and writes no swap marker |
| Run unarmed | Every new row starts shadow and records "would close"; its K12 marker arms it (§6 G4) |

#### Telling the coordinator

The coordinator learns of every lane close, which today it does not (there is no close mail at all).
- **One system mail per programme per pass**, through `queueSystemMail` (its dedupe on sender, run, recipient and subject keeps a retry from doubling it), from the `operator` role (the lane speaks for the operator, like the stall watch), kind `status`, to the run's `claimedBy`. Subject: `runs closed: <programme> · <waves> (<reason>)`. The body names each run in user words (programme · wave, work or review), the reason and the measured fact, and what the coordinator should do next ("re-open a wave if you still mean to run it").
- **A live coordinator** gets it on its next delivery.
- **A hibernated coordinator** gets it when it next wakes. The notice is marked as one that **never asks a wake**: the mail lane's `hibernated` gate holds it without spending the wake budget, and it lands through the ensure-wake gate on the coordinator's next wake (an operator open, other mail, a schedule). It is information, and waking a sleeping coordinator to tell it a run it forgot is gone would be a wake for nothing. Today's wake budget (`WAKE_BURST` 2 per `WAKE_WINDOW_MS`) still bounds every other wake.
- **A gone coordinator** (E3) cannot receive it. The mail is queued as for any recipient. If the claimant is revived (drift names that as `claimant-revived`), the mail lane delivers it as it would any outstanding mail to that id [I]; whether a parked row to an archived id is ever retried is W2's first step to confirm. The feed row and the digest are the operator's record.
- **After compaction** the mail is durable and the coordinator skill reads mail on wake, so the notice survives where a context-only roster does not. D4 #757 (the roster re-injected on compaction) is still the root fix for forgetting. This design makes forgetting cheap, not impossible.

#### The reused-name problem and #435

- **What this design fixes.** An open run that names a reaped workspace ends: by E3 when its coordinator is gone (the measured case), by E5 when the name is held by a later run's child, and by E1 when it was never started. Since the lane closes it with no fleet act, it can never release or reclaim the new holder. The false "coordinator gone" on the new child's card goes when the old run closes. Abandon is no longer needed, and Reclaim stays wrong.
- **What still waits on #435.** The name can still be reissued while a run binds it: `ccd`'s release, reap and purge do not refuse, and the slug picker does not skip bound names. Between the reuse and the next pass, the card fix (D-5828) is the only guard. The consolidation W6 `RunBinding` keyed on the worker's incarnation (K10) is the lasting answer, and E5's generation check becomes a read of that binding when it lands.

### 3.2 (b) The programme view

#### What the page answers

"What is each programme doing, and does any of it need me?" The default `/runs` shows **programmes**, not runs.

**The card (a glance, in user words).**
- **Title:** the programme's title (`programTitle`, never the slug alone) · the furthest wave reached, for example "programme A · wave 3 of 5", or "wave 3" when `waveOf` is null.
- **One count line:** "2 working · 1 waiting · 4 done". A count of zero is omitted, and the done count covers the whole programme.
- **Needs you:** a chip "needs you · 1" when the count is above zero, and the card sorts first.
- **Last activity:** "12 min ago", from the programme's last act.
- **The coordinator:** its session label and one state word (working, idle, asleep, gone).
- Never a run number, a workspace id, a branch or a state machine word.

**The counts.** Each open run falls in exactly one bucket, so the counts always add up.
- **working:** `dispatched`, `working`, `merging`, `closing`, `unknown`.
- **waiting:** `planned`, `awaiting-review`. These wait on the coordinator or a reviewer, not on the operator. This corrects `RUN_GROUP`.
- **done:** closed `done`. Runs closed `failed` are not counted on the card; the header lists them.
- **needs you:** an open run whose worker or coordinator session has an operator-facing question, plus a run the lane refused to close and left for the operator (§3.1: an open PR or unpushed commits under a gone coordinator, or a busy worker under a gone coordinator). The question predicate is the fleet rollup's operator-ask predicate, `bucket === 'attention'` (the fleet rollup plan's, once merged; it is not yet on main, so its D-number is not cited here; today the same test is `sessionFacts`' `needsYou`, which excludes a held ask). A child's ask held for its coordinator is not the operator's, which is coordinator-first routing. "Needs you" is shown **beside** working or waiting, not instead of it, and never counts a run twice in the line.

**The header (a superset of the card).** The programme screen, `/runs/p/<slug>`:
- the card's line, plus a wave stepper (P5's), with one row per wave;
- per run, in words: "wave 4 · work · working · <worker label>", with a link to the worker's session; the review runs of each wave nest under it;
- closed runs, each with who closed it: "done", "closed by the coordinator", "closed by ccrc: never started" or "closed by you";
- the coordinator, its state word and a link; the programme's PRs;
- the needs-you reasons, each with the door that answers it (the session for a question, the PR for a refused close).

**Order.** Needs you first, then open programmes by last activity, then a collapsed "Finished" group (§6 G6). Programmes are never shown by slug order.

**Other entry points.**
- The fleet screen's runs line becomes "4 programmes · 1 needs you".
- `inboxTarget`'s run kinds open the programme screen of the run's programme.
- The session header's "Open the run board" link opens that programme's screen.

**What the page keeps above the list.**
- `CoordBanner` (the coordination pause), shown only while paused.
- The "Start a program" door.
- `CapsControl` moves to the capacity glance and detail of capacity spec W6. Until then it moves under Advanced.
- `ChildReclaimBanner` moves under Advanced. Its attention rows join the needs-you count when K1's `AttentionRow[]` lands.

#### Advanced: the run ledger

`/runs/ledger`, reached from an "Advanced" link at the foot of the page. It is today's `RunsScreen` list (run rows, the spawn verdict, the dispatch window, chips, warnings), with each row's name corrected to programme · wave (U9). The page keeps it because three readers still need it:
- **Tracing.** A run id appears in mail subjects, journal lines, PR bodies and the coordinator's own words. The ledger is where an id is looked up, with `causedBy` and `detail` on every closed row.
- **The overrides.** Resume (`ResumeSheet`, the reclaim door) and Abandon (§6 G5) live here, and only here.
- **Debugging the lane.** The shadow rows' "would close" records are checked against the ledger before each row is armed.

**Abandon.** Recommended (§6 G5 (a)): it stays, under Advanced, on **open** rows only (today it is drawn on finished rows too). It is a manual override for what the lane will not close (a refused close under a gone coordinator), and for an operator who wants a run gone before its grace. D-282 (the door stays ungated so a dead coordinator's wedge has one) and the archive door's `programme:'end'`, which shares the arm, both still need the arm to exist. The confirm line gains one sentence: "ccrc would close this itself <when>" when a lane row applies, so the operator can see when the system would act.

#### Every width, both skins

Judged at 360, 390, 1280 and 1920 px × Refined and Instrument × dark and light.

| Width | Refined | Instrument |
|---|---|---|
| 360, 390 | cards stack, one per row; the count line wraps under the title; the needs-you chip stays on the title line; the stepper scrolls inside the header, never the page | the same cards; the phone tab bar stays |
| 1280 | cards in a two-column grid; the programme screen opens as a page | list column = programme list (needs you first); detail column = the programme screen. This is P9's layout (D-5592) with programmes in place of runs |
| 1920 | three-column grid | list column, detail column, and the ledger of the selected programme in the third region |

The skins W3 plan's P5 (board and stepper), P5a (`groupRuns`), P6 (row glance) and P9 (Instrument list column) are **absorbed**. Their tickets are re-scoped to this view rather than built beside it. `groupRuns` is kept and corrected (`awaiting-review` to waiting), with programmes as its unit.

### 3.3 (c) The wire and the data

Every change is additive (absence permits; no `FLEET_PROTO` bump), and each reads an existing store query.

- **`RunSummary`:**
  - `closedBy: 'coordinator' | 'operator' | 'sweep' | null`: the `causedBy` of the terminal `run_events` row (the store's `runEvents` read);
  - `closeDetail: string | null`: that row's detail (for example `expired:never-started`), redacted through the existing profile;
  - `lastActAt: number | null`: the newest act row, with drift's definition.
- **`GET /api/programs`**, a cold read: per programme `{slug, title, wave, waveOf, claimedBy, open: {working, waiting}, done, failed, lastActAt, closedBy}`, aggregated in SQL over `runs` and `run_events`. It answers the done counts without shipping 649 closed rows. It derives "open" from runs, never from `programs.state`, which can be stale (§1.3).
- **Live updates:** the existing `{type:'runs'}` frame on `/ws/fleet` (open runs) is unchanged. The PWA folds it into the cold programme list. A close moves a run out of the frame, and the PWA refetches `GET /api/programs` once, as `useColdRuns` does after an Abandon today.
- **The needs-you join** is the PWA's: open runs × the fleet frame's sessions (`bucket`), plus the lane's refused closes, which ride the coord frame as `AttentionRow`s (K1's shape; until then, a `refusedClose` field on the run summary).
- **K14:** one `usePrograms` hook owns the programme read. `useColdRuns` stays the one closed-runs reader for the ledger and `MailScreen`.
- **Server side:** the lane's L1 decider takes `DriftRunRow`-shaped inputs plus `ClaimantVerdict`, the worker's `SessionReading` (K3, today `liveStatus`), the child-marker read and the branch and PR facts the child reclaim already measures. It reads no file itself.

### 3.4 (d) Observability: a quiet line, not a toast storm

- **On the programme card:** one muted line, "ccrc closed 2 runs that never started · 3 h ago", for 24 h after a lane close.
- **In the programme header:** each closed run's "closed by ccrc: <reason>", and the line from the shadow rows ("would close in 20 h") so the operator can see an act coming.
- **The feed:** one `record-only` row per programme per pass through K6's `notify` ("closed 2 runs of programme A: never started, quiet 3 days"). It is never pushed; the "no push per reap" ruling applies.
- **The digest:** one line per day, "ccrc closed 7 stuck runs (5 never started, 2 coordinator gone)", in the existing daily digest.
- **Pushes:** only the existing ones. The breaker trip keeps its push, and a refused close under a gone coordinator raises one needs-you push through the operator-ask path (deduplicated by run).
- **The lane's counters:** closes per row per day, refusals per reason, and the shadow's "would close" count, shown on the ledger's head under Advanced.

## 4. Fit with the consolidation clusters and the fleet-capacity waves

One owner per job; nothing here runs beside an existing mechanism.

| Job | Owner | Reuses | New |
|---|---|---|---|
| Decide that a run is stuck | C5, the run-close lane's L1 decider (today `deadCoordinator.ts`, widened) | drift's `run-quiet` and `claimant-gone` predicates (moved into the shared L1 module), `ClaimantVerdict`, `DEAD_COORDINATOR_DELIBERATE_ACTS`, D-5828's child-marker predicate | the rows E1, E1r, E2, E3, E3s, E4, E5 and their conditions |
| Close it | `closeRun`'s `'sweep'` arm, through `coord/endDeadCoordinator.ts`'s executor | `abandonMove`, `SweepCloseGuard`, the coordination mutex, the breaker, the backoff | `stillStuck(row)` in place of `stillCrashed`; the `expired:<row>` detail |
| Find stuck runs for drift's report | the drift reconciler (D-5921), reader only | the same L1 predicates | none; it lists what the lane would close and never acts |
| Count a run against capacity | capacity spec W1-3 (`capsMeasured`, temporary) | the worker-liveness predicate shared with E4 | none; W1-3 and E4 call one function, which K3's `SessionReading` replaces |
| Retire the worker after a close | K1 `decideRetire`, reason `child-spent` | `closeRun`'s child reclaim | none |
| Tell the coordinator | C5 mail, `queueSystemMail` | the mail lane, the `hibernated` gate, the wake budget | the "never asks a wake" mark on one notice kind |
| Tell the operator | K6 `notify` (record-only), the digest | the feed, `sweepDigest` | the feed row's words |
| Cadence and switches | K11 `LANE_SCHEDULE`; K12 `SWITCHES` | the dead-coordinator lane's row and marker | one marker per new row |
| The programme view | K14 (`usePrograms`); the skins W3 screens | `groupRuns`, `runsByProgram`, `programmeWave`, `sessionLabel`, `inboxTarget` | the programme card and screen, `GET /api/programs` |

**Against the earlier rulings.**
- **Capacity R11 and §3.4's no-auto-close sentence** are superseded for E1 to E5. W1-3 still lands as specced if it lands first; it then shrinks to runs still inside a grace and is deleted at its W3-4 as planned.
- **#760's "must not auto-close"** is kept for the reconciler (it never acts) and superseded for the lane.
- **OA-D6** still arms the crash row. Each new row has its own shadow and marker, so arming one never arms another.
- **D6 #758** (runs released when the coordinator is archived) is answered by E3 without waiting for W6. W6's `RunBinding` later replaces E5's marker read.

**Consolidation timing.** The lane's code moves with C5's decider set. If consolidation W1a (K6 funnel, K12 switches) lands first, the rows are born as `SWITCHES` rows and funnel notices. Otherwise they use today's marker read and `recordFeedEvent` pair in the shape K6 and K12 absorb, and the K6 pin gains their rows. The PWA waves (W3, W4 here) land outside any consolidation series before its W7, whose path guard refuses `pwa/` changes in that series, and after or line-disjoint from the skins W3 screens they absorb.

## 5. Migration waves, smallest first

Each wave is its own PR, valuable alone. Each lands its characterization pins first, keeps behaviour changes in their own commits (consolidation §5.1 rule 1b) and rolls back by revert or by removing a marker.

- **W1. Never-started runs close themselves (E1, E1r).** First step: measure §1.3's review-run question and replay the lane's E1 condition over today's 21 planned runs. Then the rows, the warning mail, the close mail and the feed row, in **shadow** with their markers.
  - Pins: a queued wave behind an active wave is never a candidate; a programme quiet for 71 h is not, and one quiet for 72 h with a 24 h old warning is; a dispatch between the pass and the act skips the close; a review run of an open work run is never E1r; the close records `'sweep'` with `expired:never-started`; the mail carries no wake.
  - Gate to arm: a shadow window (§6 G4) whose "would close" list the operator reads.
  - This removes the cause behind every manual Abandon of the last week.
- **W2. Runs whose coordinator is gone close themselves (E3, E3s, E5).** First step: the hibernated-versus-gone measurement and the breaker row (§1.3). Then the two rows on the lane, shadow, plus E5 with no fleet act.
  - Pins: an archived claimant's programme closes after 1 h; a hibernated claimant never; a stopped one after 24 h; a run with an open PR is refused and listed; E5 makes no `ws-release` call.
  - This closes the 3 runs of the 2026-10-19 history.
- **W3. The programme view.** `GET /api/programs` and the three `RunSummary` fields (server, first commit), then the PWA: the card, the programme screen, the corrected `groupRuns`, the fleet line, `inboxTarget`. Judged at every width, skin and theme. The ledger stays the default screen's lower half until W4.
- **W4. The ledger moves under Advanced.** `/runs/ledger`; Abandon on open rows only, with its "ccrc would close this" sentence; Resume, `CapsControl` and `ChildReclaimBanner` move there; P5, P6 and P9 are closed as absorbed.
- **W5. Runs whose worker is gone close themselves (E2, E4).** It waits for the #119 heartbeat (D-5915), so "worker gone" reads `workerLastSeen`, not process counts. First step: §1.3's stall-rung trace.
  - Pins: a hibernated worker is never gone; a busy worker blocks; unpushed commits and an open PR refuse; a late child of an E2 close is retired by the child reclaim with its checks.

```
W1 (shadow ─▶ armed) ─┐
W2 (shadow ─▶ armed) ─┼─▶ W4
W3 ───────────────────┘
#119 heartbeat ─▶ W5 (shadow ─▶ armed)
#435 / consolidation W6 ─▶ E5 reads the binding
```

## 6. Operator decisions

Each decision has options with a recommended one and its trade-off. None is ruled yet.

**G1. The never-started grace (E1).**
- (a) **Recommended.** 72 h of programme quiet (drift's `RUN_QUIET_MS`), with the warning at 48 h. The 5 runs Abandoned last week were open 14 to 71 h, so some of them would have closed a day later than the operator closed them, but none would wait a week. Trade-off: a forgotten run holds its programme's holds for 3 days.
- (b) 24 h, warning at 12 h. Faster; a coordinator that plans a programme on Friday and dispatches on Monday loses its queued waves (it re-opens them).
- (c) 7 days. Safest for queued waves; leaves the stuck backlog visible for a week, which is the complaint.

**G2. When a coordinator gone by a deliberate act counts (E3, E3s).**
- (a) **Recommended.** Archived, forgotten, purged, destroyed, reaped, expired or absent: 1 h (the crash row's hour). Stopped by hand: 24 h. Hibernated: never. Trade-off: a coordinator archived by mistake and restored within the hour keeps its runs; after the hour they are closed and it re-opens them.
- (b) Every deliberate act alike at 1 h. Simpler; a hand stop for maintenance ends programmes.
- (c) Archived or absent only; a hand stop never counts. Narrowest; a stopped coordinator's runs stay open until someone archives it.

**G3. The worker-gone grace (E4).**
- (a) **Recommended.** 24 h after the worker measures dead with no act, read from the #119 heartbeat (W5). Trade-off: a day of a dead run holding a programme open.
- (b) 72 h (drift's `run-quiet`). Matches the report; slower.
- (c) 6 h. Fast; risks closing a run whose worker crashed and that the coordinator would have resumed.

**G4. How a row is armed.**
- (a) **Recommended.** Shadow for 3 days, then the operator creates the row's marker after reading its "would close" list. This is the same pattern as OA-D6 and hibernation's Task 19. Trade-off: one act per row (four in all).
- (b) Live on merge, with the marker as a kill switch. No operator act; the first pass acts on the whole backlog (21 runs), bounded by 3 programmes a pass.
- (c) Shadow until the operator arms all rows at once. One act; the earliest row waits for the latest.

**G5. Manual Abandon.**
- (a) **Recommended.** It stays, under Advanced, on open rows only, with "ccrc would close this itself <when>". A door for what the lane refuses and for impatience; D-282's wedge door and the archive door's arm stay meaningful. Trade-off: one more control to explain.
- (b) It goes from the PWA. The archive door's `programme:'end'` keeps the arm. Purest form of the ruling; a refused close under a gone coordinator then has no door but the coordinator's own close.
- (c) It stays on every row as today. Least change; keeps the invitation the operator called nonsensical.

**G6. The default landing and what finished programmes show.**
- (a) **Recommended.** `/runs` lands on the programme list. A programme with no open run sits in a collapsed "Finished" group for 7 days after its last close, then only in the ledger. Trade-off: an older programme is one tap further away.
- (b) It lands on a needs-you list, with programmes one tap further. Quickest answer to "does anything need me"; the programme picture is hidden.
- (c) The programme list, and finished programmes shown forever with a filter. Complete; the list grows without bound.

## 7. Risks and rollback

| Risk | Guard | Rollback |
|---|---|---|
| Closing a queued wave the coordinator still means to run | E1 is per programme and requires programme-wide quiet; a 24 h warning mail; any act resets the clock; a closed run is re-opened by one `POST /api/runs` | remove the row's marker; revert W1 |
| Closing a run whose worker is alive | E4 needs dead (not hibernated) and no act; a busy turn refuses; the act re-measures in the mutex | remove the E4 marker |
| Losing work (an unpushed branch, an open PR) | the lane refuses such runs; workspaces are released, never removed; the child reclaim keeps its own refusals | — |
| Closing a hibernated coordinator's programme | hibernation is excluded from E3 by its act and by the lifecycle word; W2's first step measures it | remove the E3 marker |
| A burst of closes or mail | 3 programmes per pass per row; one mail per programme per pass; the notice never asks a wake; the breaker stays | markers off |
| Releasing a session that reused a name | E5 makes no fleet act; pinned | revert W2 |
| Mistaking the lane's closes for the operator's | `'sweep'` plus `expired:<row>`; `closedBy` on the wire; the view says "closed by ccrc" | — |
| The view hides a run that needs attention | the ledger stays one tap away; needs-you counts refused closes and operator asks; the fleet line shows needs-you | the ledger as the default (revert W4) |
| Stale `programs.state` misleads the view | the view derives from runs, never from `programs.state` | — |
| A UI regression on one width or skin | every width × skin × theme judged in W3 and W4 | revert the PWA PR |

**Bound rulings, kept:** account switching and the auto-swap are never blocked; no herd restarts or herd wakes; coordinator-first routing (every close is told to the coordinator first, and "needs you" counts only operator asks); a coordinator that cannot dispatch does the work itself (unchanged; the warning mail says so); improve what exists first (the lane, its executor, drift's predicates, the mail lane and `groupRuns` are all reused); a card is a glance and its header a superset, in user words; every width, skin and theme.

## 8. Measures of success

Measured on the controller before W1 and after each wave, with the same queries as §1.1:

| Measure | Baseline (2026-10-20) | Target after W2 | Target after W5 |
|---|---|---|---|
| Manual Abandons per week | 5 [M] | ≤ 1 | 0 |
| Open runs with no live worker or coordinator session | 21 planned with no worker, 6 workers with no pane, 3 runs with a gone coordinator [M] | planned ones only inside G1's grace; 0 with a gone coordinator beyond G2 | 0 beyond any row's grace, except refused closes, which are listed |
| Time from a stuck run to its close | unbounded; oldest 823 h [M] | ≤ the row's grace + 1 h | same |
| Planned runs older than 7 days | 10 [M] | 0 | 0 |
| Lane closes per week, by row, and refusals by reason | 0 [M] | counted | counted |
| Coordinators told of a close | 0 of every close today [M] | every lane close | every lane close |
| Wakes caused by close notices | — | 0 | 0 |
| Run numbers shown on the default page | shown on rows with no workspace [M] | — | 0 (after W3) |
