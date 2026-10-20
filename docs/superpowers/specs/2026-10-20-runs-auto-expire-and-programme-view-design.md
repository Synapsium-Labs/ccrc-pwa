# Runs close themselves, and the runs page becomes a programme view (design)

**Status:** rev 1 (2026-10-20), a draft for the operator's review. Rev 1 applies three reviews (correctness, safety and UX); the Review log at the end records each finding and its outcome. It defines no D-numbers; the plan that follows it allocates them. Every operator choice it needs is in §6, each with a recommended option.

**The request (operator, 2026-10-20, verbatim):**

> "what are we going to do with the \"runs\" page. How is that page useful and why do I need to manually abandon runs on it when they dont' start? It's all nonsensical"

**The operator's ruling (2026-10-20), binding on this design.** Asked "The runs page and runs that never start: what should I do?", the operator chose "Auto-expire + programme view (Recommended)", whose stated meaning was:

> "Runs that never start or whose coordinator is gone close themselves and tell the coordinator, so you never abandon one by hand. The page becomes a per-programme view (programme, wave, working, waiting, done, needs you), with the raw run ledger under 'advanced'. Specced and planned through the companion like the others."

In the same exchange the operator kept the daily brake as planned (fleet-capacity spec §6 F3 (a): it counts only fresh workspaces, default 64, `CAP_MAX` 256). This design does not touch it.

**What the ruling supersedes.** Four earlier sentences forbid an automatic close, and this ruling overturns them for the causes named in §3.1 only:
- the fleet-capacity spec's "Nothing closes a run automatically; that stays the coordinator's act" (§3.4) and its R11, "Nothing ends a forgotten or never-dispatched run";
- the fleet-capacity spec's §3.1 retirement paragraph: "this design does not add an automatic close (that stays the coordinator's act, prompted by the run-quiet banner of W1-3)";
- the coordinator-durability tail spec's rejected alternative (b), which cites #760's "must not auto-close".

The drift reconciler itself still never acts. It stays a reader, and §3.1 gives the act to the one lane that already closes runs.

- **Citations** are to `origin/main` `1128d3ab6`. They name a function, constant or file; this document cites no line numbers.
- **Measurements** come from one read-only snapshot of the controller's `coord.db` (about 17:15 UTC on 2026-10-20), joined with the fleet registry's markers and per-session process counts. **[M]** marks a measured figure, **[I]** an inferred one, and **[open]** a fact not yet measured. Liveness in that snapshot is approximate: it counts processes in each session's pane scope (two or more reads "live"), not the server's `ClaimantVerdict` ladder, and it does not separate hibernated sessions (§1.3). Programmes are "programme A", accounts "one account".

**Date:** 2026-10-20 · **Branch:** `docs/runs-page-spec` (cut from `origin/main` `1128d3ab6`) · **Issues:** #435 (the reused-name root fix), #755 (D3, brief confirmation), #757 (D4, roster re-injection), #758 (D6, runs released when a coordinator is archived), #760 (D7, the drift reconciler), #761 (D8, the claimant's identity), #957 (the fleet-capacity spec)

**Related:**
- `2026-10-19-ccrc-consolidation-wave-design.md`: one owner per job, decide in L1, act in L4. C5 owns runs and keeps the dead-coordinator lane (K1's "legitimately different" row); K6 is the one notice funnel; K11 owns cadence; K12 owns switches; K14 gives the PWA one reader per server fact.
- `2026-10-20-fleet-capacity-and-worker-lifecycle-design.md` (#957): W1-3's stale-run filter in `capsMeasured`; R11; §6 F3.
- `2026-10-20-coordinator-durability-tail-epic-ledger-d7-recon-design.md`: the drift reconciler's `run-quiet` and `claimant-gone` (D-5921), OA-D6 (arming the dead-coordinator lane), and D6/D8 as W6 inputs.
- `2026-10-20-mail-and-run-truth-draft-never-blocks-rejected-m-design.md` (#119): `workerLastSeen` / `workerTurn` and the server's dispatched-to-working compare-and-set (D-5915).
- `2026-10-20-fleet-operations-maintenance-mode-and-programme--design.md` and its plan (#749): maintenance mode (FM3, FM6), which stops sessions through `cmd_stop`, and FM10, the programme spread line on the runs screen read from an additive `spread` field (FP9, `programmeSpread`).
- `2026-09-24` workspace lifecycle spec §5.2 (the archive door's `programme:'end'`) and §5.4 (the dead-coordinator lane).
- `2026-10-15-ccrc-two-skins-design.md` and the skins W3 plan: P5 (D-5588), P5a (D-5587, D-5650), P6 (U9) and P9 (D-5592), which this design absorbs (§3.2).
- `2026-10-17-coordinator-first-routing-design.md`: every notice in this design goes to the coordinator first.

## In short

- **Most failed closes are the operator's, and almost all of those are runs that never started.** Of 24 failed closes ever, 12 were the operator's Abandon, 10 of them on a `planned` run. All 5 Abandons of the last 7 days were `planned` runs [M]. Open today are 21 `planned` runs with no `run_events` row and no dispatch stamp; 10 of them are more than 7 days old, and the oldest is 823 h [M].
- **Nothing in the server ever ends such a run (§2).** Every lane that reads runs either excludes `planned` (stall watch, drift's `run-quiet`), only reports (drift has no caller on main), or acts only on a coordinator that crashed and is shadow anyway (the dead-coordinator lane). The coordinator is never told a run ended, and after compaction it forgets quiet runs. So the only door left is the operator's Abandon.
- **The page asks the operator to act because it is a ledger, not a view.** It lists run rows by programme slug, shows a run number when a row has no workspace, and puts Abandon on every row, finished ones included. It has no answer to "what is each programme doing, and does any of it need me?".
- **The design (§3):**
  - **(a) Auto-expire.** The dead-coordinator lane becomes C5's one **run-close lane**, with one row per stuck cause, the way K1 gives sleep one row per policy. It closes `failed` with `causedBy 'sweep'` and a `detail` naming the cause, so history never reads as a person's Abandon. Rules every row obeys (§3.1): a reused name gets no fleet act; an unmeasurable reading means "not this pass"; nothing acts during maintenance or a coordination pause; graces survive no controller gap; one lane-wide budget and per-row breakers bound every pass. It never closes a run whose worker is alive and working, never touches a run with an open PR or unpushed commits, never closes a review run while its work run is open, and re-measures at the act on the one coordination mutex so a late start wins. A live coordinator is warned before a never-started close and told after every close; a gone coordinator cannot be told, so its notice waits for whoever takes the programme over, and the feed and digest are the record.
  - **(b) Programme view.** `/runs` shows programmes, not runs. Each card reads "programme A · wave 3 of 5" with working, waiting and done **wave** counts, a needs-you chip, the last activity, the coordinator, and, when ccrc is about to close something, "closes in <when>". A drill-down lists one programme's waves. The raw run ledger moves under "Advanced".
  - **(c) Wire.** Additive, optional fields only: `closedBy?`, `closeDetail?` and `lastActAt?` on `RunSummary`, plus one cold read `GET /api/programs` built from existing store reads.
  - **(d) Observability.** One quiet line per programme ("ccrc closed 2 waves that never started"), one record-only feed row per pass, and a digest line. No toasts; the lane's mails and transitions never push; one push only for a close the lane refused under a gone coordinator.
- **Nothing new where something exists (§4).** The detectors are drift's predicates, the actor is the dead-coordinator lane's executor and `closeRun`'s guarded `'sweep'` arm, the notice is the system-mail path and K6's funnel, and the switches are K12 rows.
- **Migration is smallest first (§5).** W0 stops today's page inviting the act (PWA only). W1 closes never-started runs in an idle programme, the cause behind every manual Abandon of the last week. W2 closes runs whose coordinator is gone. W3 is the programme view, W4 moves the ledger under Advanced, and W5 closes runs whose worker is gone.

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
| Planned runs carrying a `sessionId` (a later wave bound at open) | 1 of 21 | `runs` [M] |
| Failed closes by `causedBy`, all time | coordinator 12, operator 12 (10 from `planned`, 2 from `closing`), sweep 0 | `run_events` [M] |
| Operator Abandons, last 7 days | 5, all from `planned` (2 work, 3 review), on runs open 14 to 71 h | `run_events` [M] |
| Coordinator closes, last 7 days | 267 done, 8 failed | `run_events` [M] |
| Open runs with no worker session at all | 21 (the planned ones) | `runs` [M] |
| Open runs whose worker has a registry record but no pane process | 6 (dispatched 2, working 2, awaiting-review 2) | registry, cgroups [M, approximate] |
| Open runs whose coordinator is archived or has no registry record | 3, all planned, 776 to 823 h old | registry [M] |
| Open runs whose coordinator has no live agent process | 13 more (asleep, idle or gone; not separated) | cgroups [M, approximate] |
| Dispatched runs since their last transition | 2 at 199 h and 159 h (8.3 and 6.6 days), with 9 and 4 stall observations; both workers have no pane, both coordinators are live | `run_events`, cgroups [M] |
| Awaiting-review runs | 6, two of them at 64 h | `runs` [M] |
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
- **The operator is less patient than any safe grace.** All 5 Abandons of the last week came 14 to 71 h after the run opened [M]. A grace alone cannot remove them; the page must also say that ccrc will close the run itself, and when (§3.2, §6 G1).
- **The backlog is old and has no owner.** 10 planned runs have waited more than a week, and 3 belong to coordinators that no longer exist. Those 3 are the runs the operator was advised to Abandon on 2026-10-19, and they are still open.
- **The stuck runs that did start are few.** Two dispatched runs have been quiet for 6.6 and 8.3 days, with 9 and 4 stall observations. Whether the stall ladder's coordinator rung reached their live coordinators is not traced (§1.3) [I].

### 1.3 Not yet confirmed

Each item is the first step of the wave that depends on it.
- Which of the 6 "no pane" workers and the 13 coordinators with no agent are **hibernated** (asleep and wakeable) rather than gone. The snapshot did not read `.hibernated`. W2's and W5's first step reads the server's own `ClaimantVerdict` and `liveStatus`.
- How the 4 open runs under a `done` programme and the 1 under `abandoned` arose. `CoordStore`'s programme upsert (`ON CONFLICT(slug) DO UPDATE SET title`) leaves `programs.state` as it was, so a run opened under a finished slug reads as a stale row [I]. W3's first step.
- Which claimants tripped the dead-coordinator breaker (one feed row about 8 h before the snapshot) and why `dead_claimants` is now empty. W2's first step.
- Why the 8 planned review runs exist. `openRun`'s `reviewState` rung admits a review run only against a work run at `awaiting-review`, so each was opened when its work run reached review, and its work run is still open [I]. Whether the reviewer was never dispatched, or the coordinator dropped it, is W1's first step.
- Whether the stall watch's coordinator rung (r2) reached the coordinators of the two quiet dispatched runs, and what they did. W5's first step.

## 2. Why runs get stuck today

### 2.1 One causal chain per cause

Each cause ends at the same place: the run stays open, and only the operator's Abandon (or the coordinator's own failed close, which it has forgotten to make) can end it.

**S1. Planned and never dispatched.**
- The coordinator opens runs ahead of dispatch through `POST /api/runs` (`openRun`): later waves at any time, and a review run when its work run reaches `awaiting-review` (`openRun`'s `reviewState` rung). It then never calls dispatch, or forgets the run after compaction (D4 #757, "re-inject its run roster on compaction", is still to spec).
- The stall watch (`sweepStalls`) reads `ACTIVE_RUN_STATES` only. Drift's `run-quiet` excludes `planned` by design ("a planned run waits by design … and is never a finding"). The dead-coordinator lane does not apply while the coordinator lives.
- The run keeps programme holds and `siblings-open` standing (capacity spec R11). A later-wave run bound at open also keeps the `ws-hold` that `holdAndBindSession` placed.
- **Measured:** 21 open, 10 over a week, every manual Abandon of the last week [M].

**S2. Dispatch refused or failed before `ws-add`.**
- `dispatchRun` refuses (registry unmeasurable, worker-starting, coordinator paused, a cap, the daily brake) before `markDispatchStarted`, so the run stays `planned` with no stamp, and no `run_events` row records the attempt.
- The coordinator gets the refusal in its HTTP answer and nothing else (capacity spec R8, fixed by its W1-4 wake). If it drops the wave, the run is S1. If it keeps retrying, today nothing records that it is trying.
- **Measured:** none of today's planned runs carries a dispatch stamp, so none is a half-done dispatch [M].

**S3. Dispatch stalled after `ws-add`.**
- `markDispatchStarted` is stamped and the spawn never confirms. The row says "dispatch never completed — a workspace may exist" after `SPAWN_STALL_MS` (6 min), as display only.
- **Measured:** 0 live [M].

**S4. Dispatched, but the worker never takes the brief or never reports.**
- A lost brief is now covered: `sweepBriefs` (D-5841, D3 #755) retries at 5 minutes and mails the claimant "brief not taken" at 10 minutes. It never closes.
- A worker that took the brief and then went away (its pane gone, not hibernated) gets the stall ladder's mails (worker, then coordinator). Drift's `run-quiet` would name it after 72 h, but drift has no caller. The #119 heartbeat (D-5915) is approved and not built.
- Whether the coordinator rung reached the coordinator is not traced (§1.3) [I]; either way, nothing closes the run.
- **Measured:** 2 dispatched runs at 159 h and 199 h with no worker pane; 2 working runs and 2 awaiting-review runs with no worker pane [M, approximate].

**S5. Coordinator gone by a deliberate act (archived, stopped by hand, forgotten, absent from the registry).**
- The dead-coordinator lane counts only a crash: `DEAD_COORDINATOR_DELIBERATE_ACTS` (stop, archive, reap, destroy, purge, forget, reclaim, expire, hibernate) never read as "dead", and `deadCoordinatorCrash` answers `unmeasured` ("listed, never acted on") for an absent row with no lifecycle history.
- The archive door's `programme:'end'` ends the runs only when the archive goes through the PWA door. An archive by `ccd` or by hand bypasses it. D6 #758 ("runs released when their coordinator is archived") is a consolidation W6 input and is unbuilt.
- The page offers Resume (hand the programme to a living coordinator) or Abandon. For a dead programme, the 2026-10-19 ruling was Abandon, never Reclaim, once its programme is confirmed dead.
- **Measured:** 3 open planned runs, 776 to 823 h old, whose claimant is archived (2) or absent (1) [M].

**S6. Coordinator crashed.**
- Owned by the dead-coordinator lane: a crash, dead for `DEAD_COORDINATOR_AFTER_MS` (1 h) with no successor, has every open run of the programme closed `failed` with `causedBy 'sweep'`, behind a breaker (`deadCoordinatorBreaker`: two claimants first measured dead within 10 minutes).
- It is shadow until the operator creates `dead-coordinator-lane-live` (OA-D6), so today it only records.
- **Measured:** 0 sweep closes ever [M].

**S7. A reused workspace name.**
- A never-closed run still names a workspace id that was reaped. `ccd`'s slug picker hands the free name to a new child, and the card then reads the new child as working for the old run.
- The card fix landed (D-5828, `runBelongsTo`: a run id below the row's `.child` run is never that session's run). The root fix (release, reap and purge refuse while an open run binds the id; the slug picker skips bound names) waits on #435.
- The remedy was Abandon, never Reclaim, because Reclaim hands a dead programme to a live coordinator.
- **Measured:** the run in that history is still open, `planned`, 776 h old, with its worker stopped and its claimant archived [M]. It is an S5 run as well, so any close of it must not touch the session that now holds the name (§3.1, rule R1).

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
- **Its "needs you" model is wrong.** `runGroups` (`RUN_GROUP`) files `awaiting-review` under `needs` (D-5587's map row: "the one state that waits on the operator"). That state waits on a reviewer and the coordinator, not on the operator. The model also has no consumer.
- **Its doors invite the act.** Abandon is drawn on every row, finished rows included, and Resume appears whenever a claimant reads dead. Neither tells the operator that the system could have done it.

## 3. Design

### 3.1 (a) Auto-expire: the system closes stuck runs

#### One owner: C5's run-close lane

The dead-coordinator lane is already the one place that closes runs without the coordinator. It has:
- an L1 decider (`deadCoordinator.ts`);
- an L4 sweep (`watch.ts` `sweepDeadCoordinators`), run on every registry pass;
- one executor on the coordination serialiser (`coord/endDeadCoordinator.ts`);
- `closeRun`'s guarded third word, `'sweep'`, which can only be reached with a `SweepCloseGuard` (a compare-and-set on `claimedBy` through `expectClaimedBy`, plus a re-measure immediately before and after the fleet act);
- a breaker, durable anchors, a gap rule (`DEAD_COORDINATOR_GAP_MS`), a failure backoff and a hand-made live marker.

The consolidation spec (K1, "legitimately different") keeps it in C5's decider set. This design **widens that lane** into the run-close lane, with **one row per cause**. It does not add a parallel expiry lane. The other candidates do not fit:
- **K1** acts on workspaces (sleep, retire). It receives the worker after the close, through `closeRun`'s existing child reclaim, exactly as today.
- **W1-3's stale-run filter** (capacity spec §3.4) only stops counting a run toward a cap, and it asks a different question: it counts a run while its worker "reads alive and busy, or was dispatched within the last 2 hours", so it also drops runs whose worker is asleep or idle, which no row here closes. The two keep two predicates ("counts toward the cap" and E4's "worker gone, not hibernated") over **one session reading** (today `liveStatus` and the turn verdict; K3's `SessionReading` later).
- **The drift reconciler** stays a reader that never acts. Its `run-quiet` and `claimant-gone` predicates move to the L1 module both read, so a drift finding and a close can never disagree about the same run.

**Per-row shape.** Each row has its own condition, grace, durable anchors and breaker. Arming is by wave group, one K12 `SWITCHES` marker each, no writer in the tree, shadow first: `runs-expire-never-started` (E1, E1r), `runs-expire-coordinator-gone` (E3, E3s, E5) and `runs-expire-worker-gone` (E2, E4): three acts in all (§6 G4). The crash row keeps OA-D6's marker. The lane has one K11 `LANE_SCHEDULE` row (every registry pass, as today) and one budget (rule R7). In shadow, a row records "would close" through the funnel, sends no mail and acts on nothing.

#### Rules every row obeys

These hold for E1, E1r, E2, E3, E3s, E4, E5 and the kept crash row alike. The L1 decider applies them before the row's own condition, and the act re-applies them inside the mutex.

- **R1. A reused name gets no fleet act.** `SweepCloseGuard` gains a typed field `fleetAct: 'release' | 'none'`, chosen by the decider. On `'none'` the abandon arm commits the transition with no `ccd` call and no `handOffChildReclaim`. Inside the mutex the act reads the run's session `.child` marker through a server port of D-5828's `runBelongsTo` (moved to `shared/`, so the server and the PWA share one definition). If the marker names a later run (`run.id < mark.runId`), the fleet act is `'none'`, whichever row closes the run. If the marker is unreadable or unrecognised, the row makes no fleet act and lists the run under "needs you" instead of closing it. When `sessionId` is null the fleet act is `'none'`; otherwise it is `'release'`, the abandon arm's ordinary `ws-release` or `ws-hold` handoff.
- **R2. Every uncertain answer is "not this pass".** A condition that reads `unmeasured`, unmeasurable or unreadable (a partial registry listing, an untrusted lifecycle journal, an unread `.child` marker, an unmeasured branch or PR reading) answers no for that pass, as the lane's existing rule "EVERY UNCERTAIN ANSWER IS 'NOT THIS PASS'" says.
- **R3. Nothing acts during maintenance or a pause.** While `$REG/maintenance` (fleet-operations FM3) or the coordinator pause marker is set, the whole lane holds: no warning, no close, no notice. Time under either never counts toward a grace (rule R5).
- **R4. A programme's activity.** A programme's last activity is the newest of:
  - its runs' act rows in `run_events`, with drift's definition (stall observations and `operator` rows excluded), **minus the lane's own `causedBy 'sweep'` rows**, so a partial pass never restarts the clock for the runs it left;
  - every run's `openedAt`, so a wave opened after the warning keeps the programme;
  - every dispatch attempt on any of its runs, refusals included, from a new `lastDispatchAttemptAt` that `dispatchRun` writes on every answer (the cap, the daily brake, `worker-starting`, the pause);
  - the claimant's newest mail naming any of the programme's runs (drift's existing `lastClaimantMailAt` read);
  - the claimant's last busy turn, from its session reading (a coordinator doing the work itself in its own workspace, per the 2026-10-20 ruling).
  A run's last activity is the same list restricted to that run.
- **R5. Graces survive no gap.** A grace accrues only across consecutive passes no more than `DEAD_COORDINATOR_GAP_MS` (10 min) apart, kept in durable anchors per (row, programme or run), like `dead_claimants`. A controller gap, a maintenance window, a pause or a backward clock step restarts the grace. A controller restart after days of downtime therefore closes nothing on its first pass.
- **R6. Branch and PR facts are read before the mutex.** For every row whose run has a `sessionId`, the decider reads `pr-state` (`CCD_ARGV.prStateSession`) for an open PR and the ws-audit `unpushed-commits` check for commits not on a remote, before the mutex. Inside the mutex, `stillStuck` re-checks only the store facts (state, `dispatchStartedAt`, `claimedBy`, activity) and the cheap liveness reading, and accepts a branch or PR reading at most 5 minutes old. An open PR or unpushed commits refuse the close and list the run (below); an unmeasured reading is rule R2. No `gh` call ever runs inside the mutex.
- **R7. One budget for the lane.** At most 3 programmes are acted on per pass across all rows together, and at most one E1 warning is sent per pass. Close notices to live coordinators are staggered by the wake budget's window (rule below). A 21-run backlog drains over several passes.
- **R8. Breakers per row, and a fleet-doubt arm.**
  - Each new row has its own breaker on **transitions**: two or more claimants (E3, E3s) or workers (E4) newly measured gone within 10 minutes trip that row only, as `deadCoordinatorBreaker` does for crashes.
  - The backlog present when a row is armed is snapshotted at arming, exempt from clustering, and drained by the budget (R7), so the first armed pass on 3 old gone claimants acts.
  - A lane-wide `fleetDoubt` arm, reused from today's breaker, stops every row for the pass on a partial or unreadable registry or mirror, an untrusted journal, or a box-wide burst (for example every pane stopped at once, as in a tmux-server outage). A simulated all-panes-stopped burst acts on nothing.

#### The rows

| Row | Cause | Condition (all must hold, measured at the pass and again at the act; rules R1 to R8 apply first) | Grace (§6 G1–G3) | Fleet act at close |
|---|---|---|---|---|
| E1 `never-started` | S1, S2 | run `planned`; `dispatchStartedAt` null; not a review run whose `reviews` target is open; the **programme** has no open run in any state other than `planned`, and no activity (R4) within the grace; the warning (below) was **delivered** (`deliveredAt`) at least 24 h earlier, and no activity since | 72 h of programme quiet | R1: release or hand off the hold when the run has a `sessionId`; none otherwise |
| E1r `review-orphaned` | S1 for a review run | review run `planned`; its target work run is closed, or has a later review run that reached `working` or `done` | 1 h | R1 |
| E2 `dispatch-stalled` | S3 | run `planned`; `dispatchStartedAt` set and older than the grace; no session bound; the registry reads whole and no record names the run in its `.child` marker | 1 h | none; a late child is handled below |
| E3 `claimant-gone` | S5 | every open run of a programme whose claimant measures dead on `ClaimantVerdict` by a removal act the trusted lifecycle journal records (archive, forget, purge, destroy, reap, expire); no successor: the runs' `claimedBy` still names the gone id at the act (`expectClaimedBy`, so a Resume that rewrote it ends the act with `claimant-changed`). An **absent** claimant with no lifecycle history, or one never started with no successful spawn, is listed under "needs you" ("would close") and **never closed**, keeping `deadCoordinatorCrash`'s `unmeasured` rule (§6 G2 (d) is the option to change that) | 1 h | as the dead-coordinator lane, under R1 (none when the name was reused) |
| E3s `claimant-stopped` | S5, a hand stop | as E3, but the claimant's last deliberate act is a `stop` the journal attributes to a person's stop verb; a stop written by an account swap, a supervisor, an OOM stop policy, any lane, or maintenance `on` (the maintenance manifest names it) never counts | 24 h | as E3 |
| E4 `worker-gone` | S4 | run `dispatched` or `working`; its worker reads `dead` on the `ClaimantVerdict` ladder (`stopped` by no lane, `orphan`, `never-started`, or `absent` with history), **not** hibernated, and (after #119) its `workerLastSeen` is older than the grace; no run activity (R4) in the grace; R6 passes. An `unknown` run is never E4 (`abandonMove` refuses `unknown` with `bad-transition`, D-2794); it is listed under "needs you" | 24 h | R1; the child reclaim's own checks run as today |
| E5 `name-reused` | S7 | the run's `sessionId` is held by a session whose `.child` marker is kind `child` and names a **later** run (`run.id < mark.runId`, D-5828's predicate, run ids only). A marker that is `none`, `unreadable` or `unrecognised` is never E5. No generation or incarnation test (generations move on every respawn, and they are another machine's clock) | at once, on the next pass | **none** (R1) |
| (kept) `claimant-crashed` | S6 | today's rule, unchanged, plus R1 to R8 | 1 h | today's, under R1 |

Notes on the rows:
- **E1 is per programme, not per run.** A queued wave behind a dispatched, working, awaiting-review, merging or closing wave is never closed, because its programme has an open run beyond `planned`. Only a programme in which nothing has moved for the grace has its planned runs closed, all of them across one or more passes.
- **A planned review run of an open work run** is closed only by E3 (the coordinator is gone), or by E1r once its work run has closed. E1 never closes it.
- **Hibernation is never "gone".** A hibernated claimant or worker reads `stopped` with a `hibernate` act, which both E3 and E4 exclude. It wakes on mail and is still working for its programme.
- **`awaiting-review`, `merging` and `closing` are not stuck causes.** They wait on the coordinator or a reviewer; drift's `review-waiting` will name them to the coordinator once D7's lane is wired. They close only through E3 (the coordinator is gone) or through the work run's own close.
- **E3 and E4 together answer "whose coordinator is gone".** A crash keeps today's row and its arming (OA-D6). A recorded removal is E3. Only a coordinator stopped by a person gets a longer grace (§6 G2), because a stop is the one deliberate act a person often undoes.

#### The warning before E1

E1 is the row whose coordinator is alive and has not been told anything, so the coordinator gets a chance to act before the close. When a programme reaches **grace − 24 h** of quiet (R4), the lane queues one system mail to the claimant:
- subject: `runs closing: <programme> · <waves> in 24 h`;
- body: which waves, why ("opened, never dispatched, programme quiet for 48 h"), and what keeps them: any open, dispatch attempt, advance, close or mail about these runs. A coordinator that cannot dispatch does the work in its own workspace, and its busy turns count too.
- **It wakes the coordinator.** A coordinator quiet for 48 h is most likely hibernated, and a warning it never reads gives it no chance. The warning asks a wake through the existing budget (`admitWake`, `MAIL_WAKE_FLOOR_MS`, `WAKE_BURST` 2 per `WAKE_WINDOW_MS`), and the lane sends at most one warning per pass (R7), so arming the row never wakes a herd.
- **Durable.** `warnedAt` is a `coord.db` row per (programme, claimant), invalidated when a run opens or any activity lands. The close needs the warning's delivery to carry a `deliveredAt` at least 24 h old. A warning still undelivered after 24 h is listed as the programme's needs-you reason ("coordinator not reached"), never closed past.
- **Shadow sends no warning.** The first armed pass sends warnings, and closes follow at least 24 h later.
- **Its runId is null** and the programme slug rides the envelope, so no run's close cancels it (`cancelOutstandingDeliveries` rejects only mail tied to the closed run, `MAIL_RUN_CLOSED_ERROR`).

Nothing else keeps them. There is no "keep" verb: a queued wave the coordinator still means to run costs it one dispatch attempt, and one it has forgotten closes itself.

#### What the close records

- **The transition:** `failed`, through `abandonMove` (`planned` and review runs fail directly; others go through `closing`), exactly as the operator's Abandon moves.
- **`causedBy`: `'sweep'`.** A person's Abandon stays `'operator'` and the coordinator's close stays `'coordinator'`, so the history stays honest: `run_events` shows which runs a person closed and which ones the system closed.
- **`detail`: `expired:<row>`** (for example `expired:never-started`, `expired:claimant-gone`), with the measured fact (the age, the claimant's verdict and cause). The crash row keeps its present detail.
- **The programme row:** D-51's last-close rule is unchanged. A programme whose last open run is closed by the lane reads `abandoned`, and the programme view says who closed it (§3.2).
- **The signature:** `closeRun`'s `'sweep'` overload already demands a guard. It gains `fleetAct` (R1), and its `stillCrashed` re-measure generalizes to `stillStuck(row)`: the row's store facts and cheap liveness reading, asked again inside the mutex immediately before the fleet act and again after it, before the commit (the departure `the-sweep-re-measures-inside-the-arm`; R6 for the branch and PR).
- **The untold row:** the close transaction also writes a durable `untold` row per closed run (programme, claimant, row, fact). The notice below drains these rows.

#### What it must never do

| Never | How it is held |
|---|---|
| Close a run whose worker is alive and working | E4 requires a `dead` verdict (not hibernated), a stale heartbeat after #119, and no activity within 24 h; a busy turn, a live pane or a mail ack refuses. E1, E1r and E2 have no worker. E3 closes a programme whose coordinator is gone; if one of its workers is alive and busy, that run is left open and named under "needs you" (below) instead |
| Lose an unpushed branch or an open PR | R6: a run whose branch has commits not on any remote, or whose PR is open, is **never** closed by the lane. It is told to the coordinator when it lives, or, when the coordinator is gone (E3), shown under "needs you" with that reason and its door (§3.2). The worker's workspace is only ever released, never removed; the child reclaim keeps its own refusals (spent-child evidence, the PR ledger, dirty trees) |
| Close a review run whose work run is open | E1 skips it. E1r needs the work run closed or already reviewed later. Only E3 closes it with its gone coordinator's programme |
| Close a queued wave behind a live wave | E1 needs every open run of the programme to be `planned` |
| Race a late start | The pass decides; the act runs on the one `CoordMutex` that `dispatchRun`, `advance` and `closeRun` share, and re-measures there. If a dispatch began between the pass and the act, `dispatchStartedAt` or the state has changed, `stillStuck` answers no, and the close is skipped. If the close commits first, the late dispatch is refused with `bad-transition` from `failed` |
| Strand a late child | A child whose `ws-add` completed after an E2 close carries a `.child` marker naming a closed run. Its brief mail was cancelled at close, so it has done no work. The child reclaim (K1's `child-spent` reason) already retires a child whose run is closed, with its own checks. If that child holds anything (it cannot, without a brief), the reclaim refuses and says so, as it does today |
| Release or reclaim a session that reused the name | R1, for every row: no `ws-release`, no `ws-hold`, no child reclaim when the marker names a later run, and no fleet act at all on an unreadable marker |
| Act during maintenance or a pause | R3: the lane holds, and the time never counts toward a grace |
| Act on a fleet-wide fault | R2 and R8: unmeasurable means not this pass; the fleet-doubt arm stops every row on a partial registry or a box-wide burst |
| Wake a herd | R7: 3 programmes a pass lane-wide, one warning a pass, close notices never ask a wake. No row restarts anything |
| Push a storm | Warnings, close notices and `expired:*` transitions are record-only (§3.4) |
| Block an account swap | The lane reads no account figure and writes no swap marker. A stop written by a swap is never E3s, and a swap's respawn never makes E5 |
| Run unarmed | Every new row starts shadow and records "would close"; its group's K12 marker arms it (§6 G4) |

#### Telling the coordinator

The coordinator learns of every lane close, which today it does not (there is no close mail at all). The operator's "tell the coordinator" is met for every row whose coordinator lives (E1, E1r, E2, E4, E5); for E3 and E3s it is impossible, and the notice goes to whoever takes the programme over.
- **One system mail per (programme, claimant) per pass.** Each pass drains the `untold` rows into one notice and deletes them in the same transaction as the insert (`insertSystemMailTx`, the `queueStallNotice` pattern). A restart between the close and the notice loses nothing, and the notice is never doubled. It is queued from the `operator` role (the lane speaks for the operator, like the stall watch), kind `status`, to the run's `claimedBy`, with **runId null** and the programme slug in the envelope, so no run close cancels it. Subject: `runs closed: <programme> · <waves> (<reason>)`. The body names each run in user words (programme · wave, work or review), the reason and the measured fact, and what the coordinator should do next ("re-open a wave if you still mean to run it").
- **A live coordinator** gets it on its next delivery.
- **A hibernated coordinator** gets it when it next wakes. The close notice **never asks a wake**: the mail lane's `hibernated` gate holds it without spending the wake budget, and it lands through the ensure-wake gate on the coordinator's next wake (an operator open, other mail, a schedule). Waking a sleeping coordinator to tell it that a run it forgot is gone would be a wake for nothing.
- **A gone coordinator** (E3, E3s) cannot be told. A delivery to a dead or archived recipient parks `undeliverable` at `MAIL_MAX_ATTEMPTS` (D-1066, D-1068), and `requeueAbandonedMail` re-queues only for runs that are not terminal. So the lane **queues no mail** to a claimant measured gone: its `untold` rows stay, and they are drained to the heir when Resume or the reclaim door rewrites the programme's `claimedBy`. Until then, the feed row and the digest are the record. An E3 close creates no parked delivery and no `mail-parked` drift.
- **The operator's own closes.** The manual Abandon (kept under Advanced, §6 G5) and the archive door's `programme:'end'` write the same `untold` rows ("closed by the operator"), so a live claimant is told of those too, through the same path.
- **After compaction** the mail is durable and the coordinator skill reads mail on wake, so the notice survives where a context-only roster does not. D4 #757 (the roster re-injected on compaction) is still the root fix for forgetting. This design makes forgetting cheap, not impossible.

#### The reused-name problem and #435

- **What this design fixes.** An open run that names a reaped workspace ends: by E3 when its coordinator is gone (the measured case), by E5 when the name is held by a later run's child, and by E1 when it was never started. Whichever row closes it, a reused name gets no fleet act (R1), so the close can never release or reclaim the new holder. The false "coordinator gone" on the new child's card goes when the old run closes. Abandon is no longer needed, and Reclaim stays wrong.
- **What still waits on #435.** The name can still be reissued while a run binds it: `ccd`'s release, reap and purge do not refuse, and the slug picker does not skip bound names. Between the reuse and the next pass, the card fix (D-5828) is the only guard. The consolidation W6 `RunBinding` keyed on the worker's incarnation (K10) is the lasting answer, and E5's marker read becomes a read of that binding when it lands.

### 3.2 (b) The programme view

#### What the page answers

The default `/runs` shows **programmes**, not runs, and supports three decisions at a glance:
1. **Does anything need me?** The needs-you chip on each card, and the door beside each reason on the programme screen.
2. **Is any programme stuck, and will ccrc handle it?** The pending-close line: "closes in <when>" on the card.
3. **How far along is each programme?** "wave 3 of 5" and the wave counts.

**The card (a glance, in user words).**
- **Title:** the programme's title (`programTitle`, never the slug alone) · its **current wave**: the highest wave whose work run has left `planned` (dispatched or later, or closed `done`); if none has, the lowest planned wave, worded "wave N queued". For example "programme A · wave 3 of 5", or "wave 3" when `waveOf` is null. A new `programmeCurrentWave` beside `programWave` computes it; `programWave` (the maximum over all runs, planned included) would read waves opened ahead as reached.
- **One count line, in waves:** "2 working · 1 waiting · 4 done · 2 queued". A count of zero is omitted.
- **Needs you:** a chip "needs you · 1" when the count is above zero, and the card sorts first.
- **Pending close:** when any lane row applies to the programme (armed or shadow), one muted line: "2 waves never started · ccrc closes them in 20 h unless dispatched", or "coordinator gone · ccrc closes this in 40 min".
- **Last activity:** "12 min ago", from the programme's last activity (R4).
- **The coordinator:** named as the session header names it (`session.name` when a person set one, else "coordinator of <project>"), never `sessionLabel`'s branch, workspace or id fallback, plus one state word (working, idle, asleep, gone). The word comes from `sessionFacts` (the fleet rollup's reading) over the fleet frame's session for `claimedBy`; "gone" when there is no session or the `ClaimantVerdict` is dead. The PWA adds no liveness reader.
- Never a run number, a workspace id, a branch or a state machine word.

**The counts.** Each wave of the programme is in exactly one of working, waiting, queued or done; "needs you · N" is a separate chip counting distinct waves with an operator-facing reason, and it never changes the other counts. Review runs nest under their wave and are never counted separately.
- **working:** the wave's work or review run is `dispatched`, `working`, `merging`, `closing` or `unknown`.
- **waiting:** the wave's work run is `awaiting-review`, or its review run is `planned`. These wait on the coordinator or a reviewer, not on the operator. This corrects `RUN_GROUP`, reversing D-5587's map row ("the one state that waits on the operator"), with a pin.
- **queued:** the wave's work run is `planned`.
- **done:** the wave's work run closed `done`. A wave closed `failed` is not counted on an open programme's card; the header lists it.
- **needs you:** `sessionFacts`' `needsYou` (`!dead && bucket === 'attention' && !heldAsk`: alive, attention bucket, not an ask held for the coordinator, which is coordinator-first routing) on the wave's worker or the coordinator, plus a close the lane refused and left for the operator (an open PR, unpushed commits or a busy worker under a gone coordinator; an unreadable `.child` marker; an `unknown` run; an absent claimant with no history), plus an E1 warning not delivered after 24 h. The fleet rollup's predicate replaces `sessionFacts`' only once it equals it.

**The header (a superset of the card).** The programme screen, `/runs/p/<slug>`:
- every card element verbatim (title with the current wave, the count line, the needs-you chip, the pending-close line, last activity, the coordinator and its state word), plus FM10's spread line (read from the wire's `spread`, never re-derived);
- a wave stepper (P5's), with one row per wave, wrapping to as many lines as needed;
- per wave, in words: "wave 4 · work · working", the worker named as programme · wave (`programmeWave`) and linking to its session; the review runs of each wave nest under it;
- closed waves, each with who closed it: "done", "closed by the coordinator", "closed by ccrc: never started" or "closed by you";
- the shadow rows' "would close in <when>" per run;
- the coordinator, its state word and a link; the programme's PRs;
- the needs-you reasons, each with the door that answers it, inline:
  - an operator question: "Open the session";
  - an open PR under a gone coordinator: "Open the PR"; the lane re-measures each pass and closes the run once the PR is merged or closed;
  - unpushed commits under a gone coordinator: "Hand to a coordinator" (`ResumeSheet`, the reclaim door; recommended) and "Close anyway (the branch stays on disk)" (the Abandon arm);
  - a busy worker under a gone coordinator: "Open the worker";
  - a warning not delivered: "Open the coordinator".
  These two verbs are the only Resume and Abandon doors outside Advanced, and they appear only on a needs-you reason.

**Finished programmes.** A programme with no open run moves to a collapsed "Finished" group (§6 G6). Its card says how it ended, in words, from `closedBy` and `closeDetail` over its last closes, for the whole 7-day Finished window: "complete · 5 of 5 waves done", "ended · wave 2 of 5 done, 3 never started (closed by ccrc)", "ended · coordinator gone (closed by ccrc)" or "ended · closed by you".

**Order.** Needs you first, then open programmes by last activity, then the collapsed "Finished" group. Programmes are never shown by slug order.

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

`/runs/ledger`, reached from an "Advanced" link at the foot of the page, at every width. It is today's `RunsScreen` list (run rows, the spawn verdict, the dispatch window, chips, warnings), with each row's name already corrected to programme · wave by W0. The page keeps it because three readers still need it:
- **Tracing.** A run id appears in mail subjects, journal lines, PR bodies and the coordinator's own words. The ledger is where an id is looked up, with `causedBy` and `detail` on every closed row.
- **The overrides.** Resume (`ResumeSheet`, the reclaim door) and Abandon (§6 G5) live here, apart from the needs-you doors above.
- **Debugging the lane.** The shadow rows' "would close" records and the lane's counters are checked against the ledger before each group is armed.

**Abandon.** Recommended (§6 G5 (a)): it stays, under Advanced, on **open** rows only (W0 already removes it from finished rows). It is a manual override for what the lane will not close, and for an operator who wants a run gone before its grace. D-282 (the door stays ungated so a dead coordinator's wedge has one) and the archive door's `programme:'end'`, which shares the arm, both still need the arm to exist. The confirm line gains one sentence: "ccrc would close this itself <when>" when a lane row applies, so the operator can see when the system would act.

#### Every width, both skins

Judged at 360, 390, 1280 and 1920 px × Refined and Instrument × dark and light.

| Width | Refined | Instrument |
|---|---|---|
| 360, 390 | cards stack, one per row; the title wraps (never ellipsized) and the needs-you chip wraps with it; the count line and the pending-close line wrap under the title; the stepper wraps to as many lines as needed and never scrolls | the same cards; the phone tab bar stays |
| 1280 | cards in a two-column grid; the programme screen opens as a page | list column = programme list (needs you first); detail column = the programme screen. This is P9's layout (D-5592) with programmes in place of runs |
| 1920 | three-column grid | list column (programmes, needs you first), detail column (the programme screen), third region = that programme's activity: closed waves with who closed them, the shadow rows' "would close in <when>", and the needs-you reasons, all in programme · wave words. The ledger stays only behind the Advanced link |

Colours come only from the skin tokens. The needs-you chip and the muted close lines meet 4.5:1 in dark and light, in both skins, judged in W3.

The skins W3 plan's P5 (board and stepper), P5a (`groupRuns`), P6 (row glance) and P9 (Instrument list column), and the fleet-operations plan's FM10 (the programme spread line), are **absorbed**. Their tickets are re-scoped to this view rather than built beside it. `groupRuns` is kept and corrected (`awaiting-review` to waiting, in W0), with programmes as its unit from W3.

### 3.3 (c) The wire and the data

Every change is additive and optional (absence permits; no `FLEET_PROTO` bump), and each reads an existing store query.

- **`RunSummary`** gains three **optional** fields, with an old-server/new-PWA and new-server/old-PWA skew test:
  - `closedBy?: 'coordinator' | 'operator' | 'sweep' | null`: the `causedBy` of the terminal `run_events` row (the store's `runEvents` read);
  - `closeDetail?: string | null`: that row's detail (for example `expired:never-started`), redacted through the existing profile;
  - `lastActAt?: number | null`: the run's last activity (R4).
- **`GET /api/programs`**, a cold read: per programme `{slug, title, currentWave, waveOf, claimedBy, waves: {working, waiting, queued, done, failed}, lastActAt, closedBy, ending, pendingClose, spread}`, aggregated in SQL over `runs` and `run_events`. It answers the done counts without shipping 649 closed rows. It derives "open" from runs, never from `programs.state`, which can be stale (§1.3). `spread` is FM10's `programmeSpread`; `usePrograms` reads it and never re-derives it.
- **Live updates:** the existing `{type:'runs'}` frame on `/ws/fleet` (open runs) is unchanged. The PWA folds it into the cold programme list. A close moves a run out of the frame, and the PWA refetches `GET /api/programs` once, as `useColdRuns` does after an Abandon today.
- **The needs-you join** is the PWA's: open runs × the fleet frame's sessions through `sessionFacts`' `needsYou`, plus the lane's refused closes and undelivered warnings, which ride the coord frame as `AttentionRow`s (K1's shape; until then, an optional `refusedClose?` field on the run summary).
- **K14:** one `usePrograms` hook owns the programme read. `useColdRuns` stays the one closed-runs reader for the ledger and `MailScreen`.
- **Server side:** the lane's L1 decider takes `DriftRunRow`-shaped inputs plus `ClaimantVerdict`, the session reading (K3's `SessionReading`, today `liveStatus`), the child-marker read (R1), and the `pr-state` and `unpushed-commits` readings (R6). It reads no file itself.

### 3.4 (d) Observability: a quiet line, not a toast storm

- **On the programme card:** before a close, the pending-close line (§3.2). After one, one muted line, "ccrc closed 2 waves that never started · 3 h ago", for 24 h; a Finished card keeps its ending line for its 7 days.
- **In the programme header:** each closed run's "closed by ccrc: <reason>", and the shadow rows' "would close in 20 h", so the operator can see an act coming.
- **The feed:** one `record-only` row per programme per pass through K6's `notify` ("closed 2 waves of programme A: never started, quiet 3 days"). The "no push per reap" ruling applies.
- **The digest:** one line per day, "ccrc closed 7 stuck runs (5 never started, 2 coordinator gone)", in the existing daily digest.
- **Pushes:** today `pushNewMail` pushes every queued mail outside its `recordOnly` test, and `pushNewRuns` pushes every run transition that has a `sessionId` (except into `closing`). W1 classifies the lane's warning and close-notice subjects as record-only in `pushNewMail`, as stall mail is, and makes `pushNewRuns` record-only for rows with `causedBy 'sweep'` and an `expired:*` detail; both are pinned. One new push kind: a refused close under a gone coordinator raises one needs-you push, deduplicated by run, through K6 `notify`. Nothing else pushes; the breaker trip keeps its push.
- **The lane's counters:** closes per row per day, refusals per reason, warnings sent and undelivered, and the shadow's "would close" count, shown on the ledger's head under Advanced.

## 4. Fit with the consolidation clusters and the fleet-capacity waves

One owner per job; nothing here runs beside an existing mechanism.

| Job | Owner | Reuses | New |
|---|---|---|---|
| Decide that a run is stuck | C5, the run-close lane's L1 decider (today `deadCoordinator.ts`, widened) | drift's `run-quiet` and `claimant-gone` predicates (moved into the shared L1 module), `ClaimantVerdict`, `deadCoordinatorCrash`, `DEAD_COORDINATOR_DELIBERATE_ACTS`, D-5828's `runBelongsTo` (moved to `shared/`), the gap rule | the rows E1, E1r, E2, E3, E3s, E4, E5, rules R1 to R8, `lastDispatchAttemptAt` |
| Close it | `closeRun`'s `'sweep'` arm, through `coord/endDeadCoordinator.ts`'s executor | `abandonMove`, `SweepCloseGuard`, `expectClaimedBy`, the coordination mutex, the breaker and its fleet-doubt arm, the backoff | `fleetAct` on the guard, `stillStuck(row)` in place of `stillCrashed`, the `expired:<row>` detail, the `untold` row, a breaker per row |
| Find stuck runs for drift's report | the drift reconciler (D-5921), reader only | the same L1 predicates | none; it lists what the lane would close and never acts |
| Count a run against capacity | capacity spec W1-3 (`capsMeasured`, temporary) | the session reading E4 also reads | none; W1-3 and E4 read one session reading and keep their two predicates, and K3's `SessionReading` replaces the reading |
| Retire the worker after a close | K1 `decideRetire`, reason `child-spent` | `closeRun`'s child reclaim | none |
| Tell the coordinator | C5 mail, `insertSystemMailTx` | the mail lane, the `hibernated` gate, `admitWake` and the wake budget, `pushNewMail`'s `recordOnly` | the warning (wakes, budgeted), the close notice (never wakes), the drain of `untold` rows to a live claimant or an heir |
| Tell the operator | K6 `notify` (record-only), the digest | the feed, `sweepDigest` | the feed row's words; one needs-you push kind |
| Cadence and switches | K11 `LANE_SCHEDULE`; K12 `SWITCHES` | the dead-coordinator lane's row and marker; maintenance and pause markers (R3) | three group markers |
| The programme view | K14 (`usePrograms`); the skins W3 screens; FM10 | `groupRuns`, `runsByProgram`, `programmeWave`, `sessionFacts`, `inboxTarget`, `programmeSpread` | the programme card and screen, `programmeCurrentWave`, `GET /api/programs` |

**Against the earlier rulings.**
- **Capacity R11, §3.4's and §3.1's no-auto-close sentences** are superseded for E1 to E5. W1-3 still lands as specced if it lands first, keeps its own predicate, and is deleted at its W3-4 as planned.
- **#760's "must not auto-close"** is kept for the reconciler (it never acts) and superseded for the lane.
- **OA-D6** still arms the crash row. Each new group has its own shadow and marker, so arming one never arms another.
- **`deadCoordinatorCrash`'s `unmeasured` rule** for an absent claimant with no history is kept (E3 lists, never closes); §6 G2 (d) is the option to supersede it.
- **D6 #758** (runs released when the coordinator is archived) is answered by E3 without waiting for W6. W6's `RunBinding` later replaces E5's marker read.

**Consolidation timing.** The lane's code moves with C5's decider set. If consolidation W1a (K6 funnel, K12 switches) lands first, the rows are born as `SWITCHES` rows and funnel notices. Otherwise they use today's marker read and `recordFeedEvent` pair in the shape K6 and K12 absorb, and the K6 pin gains their rows. The PWA waves (W0, W3, W4 here) land outside any consolidation series before its W7, whose path guard refuses `pwa/` changes in that series, and after or line-disjoint from the skins W3 screens they absorb.

## 5. Migration waves, smallest first

Each wave is its own PR, valuable alone. Each lands its characterization pins first, keeps behaviour changes in their own commits (consolidation §5.1 rule 1b) and rolls back by revert or by removing a marker.

- **W0. Today's page stops inviting the act.** PWA only, no server change. Abandon drawn only on open rows; a row's name is programme · wave, never a run id (U9); the group head shows `programTitle`; `RUN_GROUP` moves `awaiting-review` to waiting (reversing D-5587's map row, pinned).
  - Pins: no Abandon on a closed row; no row name equals a run id; the group head never equals the slug when a title exists.
- **W1. Never-started runs close themselves (E1, E1r).** First step: measure §1.3's review-run question and replay the E1 condition over today's 21 planned runs. Then rules R1 to R8, the rows, `lastDispatchAttemptAt`, the warning, the `untold` rows and the notice drain, the record-only push classification, and the feed row, in **shadow** behind `runs-expire-never-started`.
  - Pins: a queued wave behind a dispatched, working, awaiting-review or merging wave is never E1; a planned review of an awaiting-review work run is never E1; a programme quiet for 71 h is not a candidate, and one quiet for 72 h whose warning was delivered 24 h ago is; an undelivered warning blocks E1; a refused dispatch, an `openedAt`, a mail about a run and a busy coordinator turn each reset the clock; a partial E1 pass leaves the remaining runs eligible on the next pass; a dispatch between the pass and the act skips the close; a review run of an open work run is never E1r; an E1 close of a planned wave-2 run with a `sessionId` releases or hands off its hold, and one whose name was reused makes no `ccd` call; the close records `'sweep'` with `expired:never-started`; the notice survives the closes it reports; a crash between the close and the notice still produces exactly one notice; the warning wakes within the budget and the close notice never does; neither pushes; shadow sends no mail; nothing acts while maintenance or the pause is set; a controller restart after 3 days of downtime closes nothing on its first pass; a 21-run backlog drains over several passes and never acts on more than 3 programmes in one.
  - Gate to arm: a shadow window (§6 G4) whose "would close" list the operator reads.
  - With W0 and W3's pending-close line, this removes the cause behind every manual Abandon of the last week.
- **W2. Runs whose coordinator is gone close themselves (E3, E3s, E5).** First step: the hibernated-versus-gone measurement and the breaker row (§1.3). Then the rows, their breakers and the heir drain of `untold` rows, shadow behind `runs-expire-coordinator-gone`.
  - Pins: an archived claimant's programme closes after 1 h; a hibernated claimant never; a person's stop after 24 h; a stop by a swap, a supervisor, an OOM policy or maintenance never; an absent claimant with no history is listed, never closed; a Resume that rewrote `claimedBy` ends the act (`claimant-changed`); a run with an open PR or unpushed commits is refused and listed; an E3 close of a run whose `sessionId` is held by a later run's child makes no `ccd` call; an E3 close creates no parked delivery, and the notice reaches the heir after a Resume; a worker restarted by a swap after dispatch is never E5; the first armed pass on 3 old gone claimants acts; a simulated all-panes-stopped burst acts on nothing.
  - This closes the 3 runs of the 2026-10-19 history.
- **W3. The programme view.** `GET /api/programs`, `programmeCurrentWave` and the three optional `RunSummary` fields with their skew test (server, first commit), then the PWA: the card, the pending-close line, the programme screen with its needs-you doors, the Finished endings, the fleet line, `inboxTarget`, FM10's spread line. Judged at every width, skin and theme. The ledger stays the default screen's lower half until W4.
  - Pins: wave 3 working plus waves 4 and 5 planned reads "wave 3 of 5"; no card or header string equals `session.branch`, `session.workspace` or a run id, at every width including Instrument 1920; every card string appears in the header; a held child ask is never "needs you".
- **W4. The ledger moves under Advanced.** `/runs/ledger`; the "ccrc would close this" sentence on Abandon; Resume, `CapsControl` and `ChildReclaimBanner` move there; P5, P6, P9 and FM10 are closed as absorbed.
  - Pins: the needs-you doors are the only Resume and Abandon outside Advanced.
- **W5. Runs whose worker is gone close themselves (E2, E4).** It waits for the #119 heartbeat (D-5915), so "worker gone" reads `workerLastSeen` with a `dead` verdict, not process counts. First step: §1.3's stall-rung trace. Shadow behind `runs-expire-worker-gone`.
  - Pins: a hibernated worker is never gone; a busy worker blocks; unpushed commits and an open PR refuse; an `unknown` run is listed, never closed; a stale heartbeat after a controller outage closes nothing (R5); a late child of an E2 close is retired by the child reclaim with its checks.

```
W0 ─▶ W3 ─────────────┐
W1 (shadow ─▶ armed) ─┼─▶ W4
W2 (shadow ─▶ armed) ─┘
#119 heartbeat ─▶ W5 (shadow ─▶ armed)
#435 / consolidation W6 ─▶ E5 reads the binding
```

## 6. Operator decisions

Each decision has options with a recommended one and its trade-off. None is ruled yet.

**G1. The never-started grace (E1).**
- (a) **Recommended.** 72 h of programme quiet (drift's `RUN_QUIET_MS`), with the warning at 48 h. All 5 runs Abandoned last week were Abandoned before 72 h (14 to 71 h), so (a) alone would have prevented none of them; it works only together with W0 (no Abandon on finished rows) and W3's "ccrc closes them in <when>" line. A run Abandoned at 14 h would have closed about 58 h later, and only if its programme stayed quiet. The §8 target for manual Abandons after W1 is therefore conditional on W0 and W3. Trade-off: a forgotten run holds its programme's holds for 3 days.
- (b) 48 h, warning at 24 h. Closer to the operator's measured patience; a wave planned on Friday survives only if dispatched by Sunday.
- (c) 24 h, warning at 12 h. Faster; a coordinator that plans a programme on Friday and dispatches on Monday loses its queued waves (it re-opens them).
- (d) 7 days. Safest for queued waves; leaves the stuck backlog visible for a week, which is the complaint.

**G2. When a coordinator gone by a deliberate act counts (E3, E3s).**
- (a) **Recommended.** A removal the journal records (archived, forgotten, purged, destroyed, reaped, expired): 1 h (the crash row's hour). Stopped by a person: 24 h. Stopped by a swap, a supervisor, an OOM policy or maintenance, or hibernated: never. Absent with no lifecycle history: listed under needs you, never closed. Trade-off: a coordinator archived by mistake and restored within the hour keeps its runs; after the hour they are closed and it re-opens them.
- (b) Every recorded deliberate act alike at 1 h. Simpler; a person's stop for a short break ends programmes.
- (c) Recorded removals only; a person's stop never counts. Narrowest; a stopped coordinator's runs stay open until someone archives it.
- (d) As (a), and also close an absent claimant with no lifecycle history after 1 h. This supersedes `deadCoordinatorCrash`'s `unmeasured` rule for that case and closes the one absent-claimant run of the 2026-10-19 history without a person; it trusts a missing registry row as proof of death.

**G3. The worker-gone grace (E4).**
- (a) **Recommended.** 24 h after the worker reads `dead` with no activity, read from the #119 heartbeat (W5). Trade-off: a day of a dead run holding a programme open.
- (b) 72 h (drift's `run-quiet`). Matches the report; slower.
- (c) 6 h. Fast; risks closing a run whose worker crashed and that the coordinator would have resumed.

**G4. How a row is armed.**
- (a) **Recommended.** Shadow for 3 days, then the operator creates the group's marker after reading its "would close" list. This is the same pattern as OA-D6 and hibernation's Task 19. Trade-off: one act per group, three in all (`runs-expire-never-started` for E1 and E1r, `runs-expire-coordinator-gone` for E3, E3s and E5, `runs-expire-worker-gone` for E2 and E4).
- (b) Live on merge, with the marker as a kill switch. No operator act; the first pass acts on the whole backlog (21 runs), bounded by 3 programmes a pass lane-wide.
- (c) Shadow until the operator arms all three groups at once. One act; the earliest group waits for the latest.

**G5. Manual Abandon.**
- (a) **Recommended.** It stays, under Advanced, on open rows only, with "ccrc would close this itself <when>", plus "Close anyway" as a needs-you door for unpushed commits under a gone coordinator. A door for what the lane refuses and for impatience; D-282's wedge door and the archive door's arm stay meaningful. Trade-off: one more control to explain.
- (b) It goes from the PWA. The archive door's `programme:'end'` keeps the arm. Purest form of the ruling; a refused close under a gone coordinator then has no door but Resume.
- (c) It stays on every row as today. Least change; keeps the invitation the operator called nonsensical.

**G6. The default landing and what finished programmes show.**
- (a) **Recommended.** `/runs` lands on the programme list. A programme with no open run sits in a collapsed "Finished" group for 7 days after its last close, with its ending in words, then only in the ledger. Trade-off: an older programme is one tap further away.
- (b) It lands on a needs-you list, with programmes one tap further. Quickest answer to "does anything need me"; the programme picture is hidden.
- (c) The programme list, and finished programmes shown forever with a filter. Complete; the list grows without bound.

## 7. Risks and rollback

| Risk | Guard | Rollback |
|---|---|---|
| Closing a queued wave the coordinator still means to run | E1 is per programme and requires every open run to be `planned` and the programme quiet; a delivered 24 h warning that wakes the coordinator; any open, dispatch attempt, mail or busy turn resets the clock; a closed run is re-opened by one `POST /api/runs` | remove the group's marker; revert W1 |
| Closing a run whose worker is alive | E4 needs a `dead` verdict (not hibernated), a stale heartbeat and no activity; a busy turn refuses; the act re-measures in the mutex | remove the worker-gone marker |
| Losing work (an unpushed branch, an open PR) | R6: the lane refuses such runs and an unmeasured reading refuses too; workspaces are released, never removed; the child reclaim keeps its own refusals | — |
| Closing a hibernated or swapped coordinator's programme | hibernation and stops by a swap, a supervisor or an OOM policy are excluded from E3 and E3s; W2's first step measures it | remove the coordinator-gone marker |
| Closing programmes stopped by a maintenance window | R3: the lane holds during maintenance and the pause; maintenance stops never count for E3s | — |
| A fleet-wide fault reads every claimant as gone | R2 and R8: unmeasurable is not this pass; the fleet-doubt arm stops every row; per-row breakers on transitions | markers off |
| Controller downtime counted as quiet | R5: graces restart after a gap, a pause, maintenance or a backward clock step | — |
| A burst of closes, mail, wakes or pushes | R7: 3 programmes a pass lane-wide, one warning a pass within the wake budget; close notices never wake; warnings, notices and `expired:*` transitions are record-only | markers off |
| A coordinator never told | `untold` rows in the close transaction; a live claimant gets one notice per pass; a gone claimant's rows go to the heir; feed and digest are the record | — |
| Releasing a session that reused a name | R1 for every row; pinned | revert W2 |
| Mistaking the lane's closes for the operator's | `'sweep'` plus `expired:<row>`; `closedBy` on the wire; the view says "closed by ccrc" | — |
| The view hides a run that needs attention | needs-you counts operator asks, refused closes, unknown runs and undelivered warnings, each with a door; the ledger stays one tap away; the fleet line shows needs-you | the ledger as the default (revert W4) |
| Stale `programs.state` misleads the view | the view derives from runs, never from `programs.state` | — |
| A UI regression on one width or skin | every width × skin × theme judged in W0, W3 and W4 | revert the PWA PR |

**Bound rulings, kept:** account switching and the auto-swap are never blocked (a swap's stop and respawn never count for any row); no herd restarts or herd wakes (R7); coordinator-first routing (every close is told to the coordinator first, and "needs you" counts only operator asks); a coordinator that cannot dispatch does the work itself (its busy turns count as activity, and the warning says so); improve what exists first (W0 fixes today's page before anything new; the lane, its executor, drift's predicates, the mail lane and `groupRuns` are all reused); a card is a glance and its header a superset, in user words; every width, skin and theme.

## 8. Measures of success

Measured on the controller before W0 and after each wave, with the same queries as §1.1:

| Measure | Baseline (2026-10-20) | Target after W2 | Target after W5 |
|---|---|---|---|
| Manual Abandons per week | 5 [M] | ≤ 1, once W0 and W3 have landed | 0 |
| Open runs with no live worker or coordinator session | 21 planned with no worker, 6 workers with no pane, 3 runs with a gone coordinator [M] | planned ones only inside G1's grace; 0 with a gone coordinator beyond G2, except those listed under needs you | 0 beyond any row's grace, except refused closes, which are listed |
| Time from a stuck run to its close | unbounded; oldest 823 h [M] | ≤ the row's grace + 1 h | same |
| Planned runs older than 7 days | 10 [M] | 0 | 0 |
| Lane closes per week, by row, and refusals by reason | 0 [M] | counted | counted |
| Live coordinators told of a close | 0 of every close today [M] | every lane close | every lane close |
| Wakes caused by close notices; warnings per pass | — | 0; ≤ 1 | 0; ≤ 1 |
| Pushes caused by lane closes or notices | — | 0 (refused-close pushes counted apart) | 0 |
| Run numbers shown on the default page | shown on rows with no workspace [M] | 0 (after W0) | 0 |

## Review log

Three read-only reviews of rev 0 (`8c39b7101`): R1 (correctness against the code), R2 (safety), R3 (UX and simplicity). Every finding above low severity is applied, and every low one is applied too. Where two reviews disagreed, the outcome says how it was reconciled.

| # | Sev | Finding | Outcome |
|---|---|---|---|
| R1-1 | high | E3's fleet act would `ws-release` a reused name's new holder | Applied: rule R1 for every row; E3 cell; reused-name paragraph; W2 pin |
| R1-2 | medium | E1 closes a planned review run whose work run is open, and waves behind awaiting-review or merging | Applied: E1 needs every open run `planned` and skips a review of an open target; never-row rewritten; S1 and §1.3 cite `reviewState`; W1 pins |
| R1-3 | medium | E1 "no fleet act" leaks a later wave's `ws-hold` | Applied: R1 releases or hands off the hold when `sessionId` is set and the name is not reused; W1 pin. Reconciled with R2-1 (which asked for "none" on E1): the abandon arm's hold handoff already protects a workspace shared with an open earlier wave, and E1 only fires when every open run is `planned` |
| R1-4 | medium | E3 overrides `deadCoordinatorCrash`'s `unmeasured` rule; successor rule misstated | Applied: absent with no history is listed, never closed; G2 (d) is the explicit option; successor is the `claimedBy` compare-and-set; W2 pin |
| R1-5 | medium | Maintenance, the pause and refused dispatches would trigger closes | Applied: R3, R4 (`lastDispatchAttemptAt`), E3s excludes maintenance stops; pins |
| R1-6 | medium | E5's generation clause would close live runs | Applied: generation clause deleted; E5 is D-5828's predicate alone |
| R1-7 | medium | Mail to a gone coordinator is not delivered on revival | Applied: no mail to a gone claimant; `untold` rows go to the heir; feed and digest are the record; "tell the coordinator" scoped to live coordinators |
| R1-8 | medium | Run closes cancel the notices; warning wake unspecified; warning counted from queue | Applied: runId null on warning and notice; warning wakes within `admitWake`; E1 needs `deliveredAt` ≥ 24 h; pins |
| R1-9 | medium | W1-3 and E4 do not share one predicate | Applied: they share one session reading and keep two predicates; "nothing left to filter" deleted; §4 row |
| R1-10 | low | Overstated claims (review-waiting, stall mails, "a week") | Applied: §3.1 note, §1.2, S4, 6.6 and 8.3 days |
| R1-11 | low | Capacity §3.1's retirement sentence missing from the superseded list | Applied |
| R1-12 | low | E4 lists `unknown`, which `abandonMove` refuses | Applied: `unknown` dropped and listed under needs you |
| R1-13 | low | G4 says four markers for seven rows | Applied: three group markers, named |
| R1-14 | low | G1 (a)'s "a day later" is wrong | Applied: about 58 h, only if quiet |
| R1-15 | low | FM10 (programme spread) not absorbed | Applied: Related, §3.2, §3.3 `spread`, W3, W4 |
| R1-16 | low | Needs-you predicate underspecified | Applied: `sessionFacts`' `needsYou` plus the lane's refusals |
| R1-17 | low | New `RunSummary` fields declared required; D-5587 reversal not cited | Applied: optional with a skew test; D-5587 cited with a pin (W0) |
| R2-1 | high | "Fleet act: none" is not reachable through the abandon arm | Applied: `fleetAct` on `SweepCloseGuard`; R1 as an act-time precondition of every row; unreadable marker refuses; pins. E1's cell follows R1-3 (see above) |
| R2-2 | high | E1 closes a planned review whose work run is open | Applied with R1-2 |
| R2-3 | high | Lane's own `'sweep'` rows reset its clock; notice lost on restart | Applied: R4 excludes `'sweep'` rows; `untold` rows in the close transaction drained by `insertSystemMailTx`; pins |
| R2-4 | high | No breaker or fleet-fault protection for the new rows | Applied: R8 (per-row breakers on transitions, arming backlog snapshot, fleet-doubt arm) and R2; W2 pins |
| R2-5 | high | E5's generation test is unsafe | Applied with R1-6; swap pin |
| R2-6 | medium | E3 drops the unmeasured rule; E3s counts any stop; successor misstated | Applied with R1-4; E3s counts only a person's stop |
| R2-7 | medium | Real coordinator activity invisible to E1 | Applied: R4 (opens, dispatch attempts, mail, busy turns); warning text; pins |
| R2-8 | medium | Warning wake, delivery, storage and shadow underspecified | Applied: wakes within the budget, one per pass, `deliveredAt`, durable `warnedAt`, shadow sends none |
| R2-9 | medium | Existing paths push every mail and transition | Applied: record-only classification in `pushNewMail` and `pushNewRuns`; pins |
| R2-10 | medium | Per-row caps allow 21 programmes a pass | Applied: R7 lane-wide budget; cadence named; pin |
| R2-11 | medium | Branch and PR readers do not exist as named; `gh` inside the mutex | Applied: R6 names `pr-state` and `unpushed-commits`, reads before the mutex, unmeasured refuses, every row with a `sessionId` |
| R2-12 | medium | E3's notice can never arrive | Applied with R1-7 |
| R2-13 | medium | Wall-clock graces count controller downtime | Applied: R5; E4 needs a `dead` verdict; restart pins |
| R2-14 | low | Manual Abandon and the archive door still tell no one | Applied: they write the same `untold` rows |
| R3-1 | medium | Coordinator named by `sessionLabel` can show a branch or id | Applied: named as the session header names it; worker as programme · wave; W3 pin |
| R3-2 | medium | `programWave` counts planned waves as reached | Applied: `programmeCurrentWave`; queued tail; pin |
| R3-3 | medium | Count line mixes runs and waves | Applied: counts are waves; reviews nest; bucket paragraph rewritten |
| R3-4 | medium | Instrument 1920 shows the ledger on the default screen | Applied: third region is the programme's activity; pin |
| R3-5 | medium | The card never says ccrc will close it | Applied: pending-close line; "What the page answers" lists the three decisions |
| R3-6 | medium | A refused close under a gone coordinator dead-ends | Applied: inline doors per reason; the only Resume and Abandon outside Advanced; W4 pin |
| R3-7 | medium | A programme closed by ccrc looks complete under Finished | Applied: ending in words for the 7-day window |
| R3-8 | medium | G1 (a)'s justification misreads the data | Applied: G1 rewritten with the real numbers; 48 h added as (b); §8 target made conditional on W0 and W3 |
| R3-9 | medium | The cheapest fixes are deferred to W3 and W4 | Applied: W0 (PWA only) lands first; §5 diagram and §8 updated |
| R3-10 | low | Push wording contradicts itself | Applied: "In short" (d) and §3.4 |
| R3-11 | low | G4's count | Applied with R1-13 |
| R3-12 | low | Header superset not checkable | Applied: every card element verbatim; pin |
| R3-13 | low | Phone overflow and theme contrast unstated | Applied: wrapping rules and a contrast sentence |
| R3-14 | low | Coordinator state word names no reader | Applied: `sessionFacts` over the fleet frame; no new PWA liveness reader |
