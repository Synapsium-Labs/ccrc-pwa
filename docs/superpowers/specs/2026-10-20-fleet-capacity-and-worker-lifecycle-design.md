# Fleet capacity and the worker lifecycle (design)

**Status:** rev 1.1 (2026-10-20). Rev 1 was revised after three reviews (fidelity, correctness, architecture; the Review log at the end). **The operator ruled every decision in §6 on 2026-10-20, accepting each recommended option** (§6.1, the decision log). It defines no D-numbers; the W1 plan (`docs/superpowers/plans/2026-10-20-fleet-capacity-w1.md`) defines D-6091 to D-6097.

**The request (operator, 2026-10-20, verbatim):**

> "a lot of residual worker workspaces end up sticking around and idling for a long time after coordinator spawns them, and then they are rarely reused. Also, our fleet limit caps seem to not do the intended job and simply get in the way. It's some sort of illogical combination of rules that does not achieve the desired effect and instead hamstrings optimal operation."

> "should released sessions be cleaned up faster? do they stop taking up RAM AS SOON as they've been released?"

> "how can we avoid this happening in the future?"

> "why do we keep so many workspaces running when they have absolutely nothing to do"

**The operator's ruling (2026-10-20, verbatim), binding on this design:**

> "if the coordinator is unable to dispatch a workspace to carry out some work, it should do the work in its own workspace, UNLESS there is a very specific reason why it cannot or should not do that"

- **Citations** are to `origin/main` `3cbc76c7d`. They name a function, constant or file; this document cites no line numbers.
- **Measurements** come from four read-only inventories of 2026-10-20: the caps inventory, the worker-lifecycle inventory, the prior-decisions inventory, and a box census taken at about 10:56 UTC. Figures from different inventories were not taken at the same instant, and each row below names its source. **[M]** marks a measured figure, **[I]** an inferred one, and **[open]** a fact not yet measured. Run, account and programme names are withheld; programmes are "programme A", accounts "one account" or "lane-a".

**Date:** 2026-10-20 · **Branch:** `docs/fleet-capacity-spec` (cut from `origin/main` `3cbc76c7d`) · **Issues:** #398 (fleet-wide admission control), #473 (sleep when idle, wake on demand), #456 (live-session cap and parking; see §6 F7), #778 (ARCH-43, `decideSleep`), #769 (one reading of a session), #389 (the test-runner worker cap)

**Related:**
- `2026-10-19-ccrc-consolidation-wave-design.md`, the DDD/Clean/SOLID direction. This design is written to fit its K1 (workspace end of life), K3/K4 (alive and idle) and K15 (placement) clusters (§4).
- `2026-10-16-working-state-and-interruptions-design.md` §5.11 (hibernation, D-5242) and its plan's Task 15b (stop-done, D-5370), Task 17b (D-5427, D-5428) and D-5426 (the `mail` hold). Task 19 (the shadow week, then arming) is pending.
- `2026-08-07-build7-fleet-coordination-design.md` §5 (the two dispatch caps), `2026-08-11-crossrepo-programmes-design.md` §5 ("the constraint is the box"), `2026-09-14-review-runs-design.md` (review runs, D-2803, D-2805, and the rejected `maxResidentSessions`).
- `2026-09-22-child-workspace-reclamation-design.md` §1 (the operator's rules 1-4 of 2026-09-22, rule 3 among them).
- `2026-10-20-fleet-operations-maintenance-mode-and-programme--design.md` §4 (programme-aware placement, #749) and §3 (maintenance mode, #296).
- `2026-10-20-workspace-disk-and-registry-truth-design.md` §2.6 (the `review-report-stale` banner word).
- `2026-10-18-claude-binary-lifecycle-design.md` and its W1 plan, which define `_mem_headroom` and `ccd claude mem` (D-5697, CB1c, not yet built) and `CLAUDE_HEADROOM_GATE_BYTES`.
- `2026-10-17-coordinator-first-routing-design.md`, the routing every question in this design follows.

## In short

- **The box is full of sessions that have nothing to do, and the caps cannot see them.** At the census 60 Claude Code sessions were live, 53 of them idle, holding 12.7 GB of the 14.7 GB their main processes use; memory pressure (PSI `some avg10`) read 92% and load 145 on 16 cores [M]. The concurrency cap read 11 of 14 "running" that morning (caps inventory) [M].
- **Released is not stopped.** Releasing a workspace ends its binding, not its process; nothing sleeps a finished child sooner than 6 hours, and holds keep most of them awake indefinitely (§1.2).
- **Each rule measures something other than what it protects (§2).** The concurrency cap counts run rows, the daily brake counts every dispatch alike, the finished-worker lane waits 6 hours behind a hold that D-5427 added without weighing it against the operator's ruling, the review report pins a whole workspace, nothing ends a forgotten run, and a refusal tells a coordinator to wait for a wake that never comes. Together they hold idle processes alive and refuse the cheap work (resumes, send-backs) that would end them.
- **The design (§3) keeps every mechanism and corrects what each one measures:**
  - **(a) Stop early, retire carefully.** A finished worker is put to sleep (hibernated: process stopped, workspace kept, wakeable) about 10 minutes after its run closes, restoring the operator's 2026-10-17 ruling "stop workers at run close" at D-5370's 10-minute grace. Sleep is cheap and reversible, so holds that guard a workspace (programme holds, open PRs, unpushed work, a cited report) guard retirement only, never sleep.
  - **(b) Reviews leave a sleeping reviewer, and one reviewer serves every round.** The reviewer sleeps 10 minutes after review-done with its worktree (and its report) intact; each fix round resumes that reviewer with a cleared context.
  - **(c) Reuse first, through the owner that exists.** The coordinator's own reuse step names a finished child of the same programme; rule 3 decides which children qualify (§6 F2); a new `ccd` act-time check makes reuse refuse whenever it could lose work.
  - **(d) One admission rule on the real resource.** The run-row concurrency cap is replaced by one rule measured on box memory (headroom and pressure), read on the box, with an in-flight reservation and a fleet-wide spawn rate. A refusal is immediate and asks for one bounded sleep pass outside the request. Resuming a live session is free; stale runs hold nothing.
  - **(e) A refusal never strands work.** The coordinator does the work in its own workspace, in a sibling worktree bound to the run in place, per the operator's ruling, unless one of seven named reasons applies; then the server wakes it when capacity frees.
  - **(f) Placement spreads by live sessions** as one more key in #749's ranking for new sessions.
  - **(g) Observability:** capacity shown in real terms (headroom, pressure, idle residue), and a pressure alarm through the existing feed funnel.
- **Nothing new is invented where something exists (§4).** Sleep is K1's `decideSleep` with its existing policies plus one; admission reads K3/K4's session reading and the binary lifecycle's `_mem_headroom`; placement is one key in K15/#749's triple; the alarm is K6's `notify`; reuse runs through the coordinator skill's step 6 and `refuseSpentChild`.
- **Migration is smallest first (§5).** W1 restores the 10-minute ruling, adds the in-place bind, wakes refused coordinators and writes the do-it-yourself words; the two loosening items (resumes free, stale runs uncounted) wait until W1-1 has freed memory. Reviews, memory admission, reuse, placement and the PWA follow.

## 1. The problem in numbers

### 1.1 What the operator sees

The operator's words are the requirement: workers "sticking around and idling for a long time", "rarely reused", caps that "simply get in the way", and "so many workspaces running when they have absolutely nothing to do". Measured on 2026-10-20:

| What | Measured | Source |
|---|---|---|
| Live Claude Code sessions (main processes) | 60, holding 14.7 GB RSS | census 10:56 UTC [M] |
| Of those, idle with a finished turn | 53, holding 12.7 GB | census [M] |
| Idle at least 6 h / at least 24 h | 26 / 12 | census [M] |
| Box memory | 391 MB free; 10.4 GB of about 16 GB swap used | census [M] |
| Memory pressure, PSI `some avg10` | 92% (which PSI file, box-wide or the slice's, is not recorded) | census [M], source [open] |
| Load average | 145 on 16 cores | census [M] |
| Claude processes in the caps pass | 62: 12 busy, 49 idle, 1 shell | caps inventory, same morning, before the census [M] |
| Session slice | 22.8 GB of its 24 GB `MemoryMax` | caps inventory, same pass [M] |
| Concurrency cap | 11 of 14 "running" | caps inventory, `coordinator_state`, `capsUsage` [M] |
| Daily brake | 62 of 64 used; 64 is `CAP_MAX`; who set 64 and why is not recorded | `capsUsage`, `coordinator_state.updatedAt` ≈ 2026-10-20 [M value, cause open] |
| Of the 62 daily dispatches | 43 reviews, 19 work, 0 resumes | runs, last 24 h [M] |
| Child workspaces in the registry | 46: 21 live and held, 21 live with no hold, 4 stopped by hand | registry [M] |
| Review children whose own run is `done` | 25, of which 21 still running | registry joined to runs [M] |
| Reviewers kept per open work run | up to 4 | registry joined to runs [M] |
| Finished children put to sleep or stopped by the stop-done lane | 0 of the 46 current children (no lane `.stopped` stamp; 0 `.hibernated`) | registry stamps [M] |
| Hibernated sessions | 0 (`hibernate-live` absent; 117 shadow lines for 14 sessions in 24 h) | registry, journal [M] |
| Work sessions that served more than one run | 19 of 117 (an upper bound on reuse) | closed runs [M] |
| Dispatches refused by a cap, logged | 0 in 7 days (refusals are not logged) | journal [M] |
| Live sessions on the busiest account | 12, including 3 reviewers dispatched within 20 minutes; the next 9, 8, 8, 7 | registry [M] |
| Planned runs | 18; 10 older than 24 h; the oldest 768 h | runs [M] |

**Not yet confirmed** (each is a first step of the wave that depends on it):
- Whether the stale runs (two final waves at `dispatched` for 6 to 8 days, one at `working` for 153 h, and ones at 42 h, 21 h and 10 h) have a busy live process. The caps inventory's tmux probe used the wrong socket. Open: join each run's `sessionId` to `<configDir>/sessions/<pid>.json`'s status. W1-3's first step.
- How many finished children are held only by `mail` (D-5426: queued or delivered mail never acknowledged). Task 15b's follow-up count was never taken. W1-1's gate.
- Which PSI file the census read (box `/proc/pressure/memory` or the slice's `memory.pressure`). W3-2's shadow week logs the slice's own.
- How many of the 53 idle sessions are coordinators with an open run (they never sleep under today's holds; §6 F6). W1-1's baseline.
- How many children have a merged or closed PR and no other claim (F2 b's reuse population). W4's first step.

### 1.2 What the numbers say

- **Memory is the binding resource, and idle sessions spend most of it.** 53 of 60 live sessions were idle, and 26 had been idle for more than 6 hours, while the box was swapping and stalled on memory 92% of the time.
- **Released is not stopped.** To the operator's question "do they stop taking up RAM AS SOON as they've been released?": no. `ws-release` at a run's close ends the run's binding, not the process. 21 of 25 review children whose own run was done were still running [M], held by `review-report-live` and stop-done's `reviewing` until the reviewed work run closes. Nothing sleeps a finished child sooner than 6 hours (stop-done's `recent`), and nothing at all while a hold applies. §3.1 makes sleep follow run close within about 10 minutes.
- **The caps were not at their limit and still in the way.** The concurrency cap saw 3 free slots on a box with no headroom, and the daily brake was 2 dispatches from refusing everything, mostly because of reviews.
- **Nothing that exists to reclaim idle sessions acted.** The finished-worker lane slept or stopped none; hibernation is unarmed.
- **Nothing was reused.** 0 of 62 dispatches resumed a workspace.

## 2. The root causes, as a causal chain

Each rule below was added for a stated reason. The chain shows what each actually measures and how they combine into the measured state.

### 2.1 The rules, one at a time

**R1. The concurrency cap, `maxConcurrentWorkers`.**
- *Stated intent:* a runaway-coordinator bound at one chokepoint (build7 §5), kept whole-box because "the constraint is the box" (crossrepo §5).
- *What it measures:* run **rows** in `dispatched`, `working` or `unknown` (`CoordStore.capsUsage`, `ACTIVE_RUN_STATES`), fleet-wide. Since D-2803 idle run states are excluded, so a worker parked at `awaiting-review` "gives its slot back" while its process lives on.
- *What it misses:* processes and memory. 11 rows counted while 62 Claude processes were live (12 busy, 49 idle) [M].
- *What it may count wrongly:* stale rows [I]. Two final waves at `dispatched` for 6 to 8 days and one run at `working` for 153 h; whether their workers are busy was not confirmed (§1.1, not yet confirmed). The drift reconciler only reports them.
- *Where it is checked:* `dispatchRun` step 2 (`capsMeasured`), before the resume-versus-fresh branch, and the advance route when a run re-enters `working` (a send-back). So resuming a live idle worker, which starts no process, is refused exactly like a cold spawn.

**R2. The daily brake, `maxSessionsPerDay`.**
- *Stated intent:* a budget brake on dispatches per rolling 24 h (build7 §5).
- *What it measures:* every dispatch (`dispatchedIn24h`): a fresh spawn, a resume of a warm workspace and a review run cost the same.
- *What follows:* reviews are 69% of it [M]. The live value is 64, its own ceiling `CAP_MAX`; who set it and why is not recorded (`coordinator_state.updatedAt` ≈ 2026-10-20; the seed is 12) [M value, cause open]. The `CAP_MAX` comment assumes "about twenty live sessions" against 60 measured.

**R3. The finished-worker lane, stop-done (D-5370), changed by D-5427.**
- *Stated intent:* the operator's 2026-10-17 ruling (Task 15b), made after 28 long-idle sessions were stopped by hand, chose "stop workers at run close": a finished run's worker is stopped once idle, and restarts on re-dispatch. D-5370 implemented it with a 10-minute grace (`STOP_DONE_GRACE_MS`).
- *What D-5427 changed:* Task 17b made the lane compose `ccd hibernate` (a good change: mail and an open screen now wake the worker) and also gave it hibernation's `recent` hold, N = 6 h from the turn marker (`stopDoneVerdict`, `hibernateAfterMs`), with `opted-out`, `scheduled` and `ccd`'s `attached`. Its stated reason is to make the lane a strict subset of hibernation; it does not weigh the delay against the run-close ruling, and no new ruling is recorded. The consolidation spec (§7, K1) lists D-5427 among the rulings it keeps; restoring the timing therefore needs the operator's confirmation (§6 F5).
- *What its other holds do:* `held` (any `.hold`, including a programme hold `program:<p> wave:N+1` that a non-final close writes), `not-done` (any newest run not `done`; a `failed` run reads `not-done` too), `reviewing` (a review child of a still-open run, "the coordinator may come back to it for a re-review"), and `mail` (D-5426: `outstandingMailFor` matches queued and delivered mail never acknowledged, which holds a finished worker with no time limit). Non-final producers are `held`, waiting producers are `not-done`, and kept reviewers are `reviewing`; the share held only by `mail` among the 21 unheld live children is unmeasured [open]. Final children are retired by the close-time reclaim before the lane sees them.
- *Result:* 0 of the 46 current children slept or stopped by the lane [M]. The `reviewing` reason contradicts `openRun`, which refuses a `sessionId` on every review run: nothing ever comes back to a review child.

**R4. Hibernation (D-5242).**
- *Stated intent:* sleep any session idle for N hours (6 h default), shadow first, armed by the operator after a shadow week (Task 19).
- *What it does today:* nothing. `hibernate-live` is absent and nothing in the tree writes it; 117 shadow lines named 14 sessions in a day [M]. Even armed, its `run-worker` hold keeps every producer with a non-terminal run, `planned` and `awaiting-review` included, awake, and its `run-claimant` hold keeps every coordinator with any open run awake.

**R5. The review report pins the reviewer's workspace.**
- *Stated intent:* the coordinator cites the report by path in fix-round mail, so the child-reclaim sweep holds a review child `review-report-live` until the reviewed work run closes (`childReclaimSweepVerdict`); the disk spec adds only a 7-day banner word.
- *Combined with R3 and R6:* the worktree claim also keeps the process (stop-done's `reviewing`), and every fix round mints another reviewer, each kept until the work run closes. Up to 4 per work run [M].

**R6. Review runs are never reused.**
- *Stated intent:* "a report and the tip it describes are always one pair" (review-runs §6). That pairing is per **run** (each run carries its own `reviewedTip`), not per session.
- *What it does:* `openRun` refuses `sessionId` on a review run, so each round is a fresh workspace, a fresh dispatch against R2, and a fresh process.

**R7. Rule 3, one PR per child (operator, 2026-09-22).**
- *Stated intent:* a sub-workspace serves at most one PR and is then cleaned up; "future PRs are picked up by other fresh spawned children".
- *What it does:* a producer that opened a PR is `workspace-spent`, so wave N+1 always mints. Only a producer that opened no PR can be resumed. 19 of 117 work sessions served more than one run [M].

**R8. Refusal words with no wake.**
- *Stated intent:* the coordinator skill says, for `cap-concurrency` or `cap-daily`, "Stop, say which cap, and wait to be woken."
- *What happens:* no server code wakes a coordinator when a slot frees or the 24 h window rolls. Refusals are not logged (0 in 7 days [M]). A refused coordinator stalls silently, and its programme with it.

**R9. No admission by memory anywhere.**
- *What exists:* per-pane scope limits (`ccd-cap-scopes`: `MemoryHigh` 8G, `MemoryMax` 12G) and the slice's `MemoryMax` 24G. They throttle or kill; they never refuse a spawn. `wakeBudget.ts` says it outright: `ccd`'s spawn path has no concurrency control of its own. `_mem_headroom` exists only in the binary-lifecycle plan (CB1c, not yet built), for rolls.
- *The earlier rejection:* the operator rejected a `maxResidentSessions` cap (review-runs §3) because `coord.db` sees a fraction of resident sessions (23% then) and an aggregate memory cap "froze the fleet three times". §3.4 measures the box rather than counting sessions in the server, never caps a cgroup, and routes refused work to a live coordinator; whether that is distinct enough from the rejected cap is the operator's call (§6 F7).

**R10. Placement ignores how many sessions an account carries.**
- `_ws_least_loaded` and its server mirror `projectHome` rank only by `_limit_score` (the 5 h and 7 d usage), which barely moves in minutes. Three reviewers dispatched within 20 minutes all landed on one account, which then carried 12 live sessions, the most of any (next 9, 8, 8, 7) [M]. Its usage score at the time was five = 26, seven = 9. #749 adds a programme-member key but not a live-session one.

**R11. Nothing ends a forgotten or never-dispatched run.**
- *What it does:* stale `planned` runs (one 768 h old; 10 of 18 older than 24 h [M]) and the open runs of a coordinator that is alive but has forgotten them keep `siblings-open` and programme holds standing, because a programme counts any open run. One planned run pins a workspace `siblings-open`.
- *Why nothing ends them:* the retire lanes that could (dead-coordinator, archived-expiry) are shadow, and dead-coordinator acts only on a crashed coordinator, not a forgetful one. The run-quiet banner is the only signal.

### 2.2 How they combine

```
R7 rule 3 ──▶ every PR-producing wave mints a fresh child ─┐
R6 fresh reviewer per round ──▶ 1-4 reviewers per work run ─┼─▶ many fresh workspaces per day
                                                            │       │
R2 brake counts every dispatch alike ◀──────────────────────┘       │
   (69% reviews, 0 resumes) ──▶ brake at CAP_MAX, no room left on the dial
                                                                    ▼
R5 report pins the reviewer ─┐                          many finished, idle processes
R3 stop-done: 6 h `recent`,  ├─▶ none of them is ever put to sleep ──┐
   `held`/`not-done`/         │                                       │
   `reviewing`/`mail`         │                                       │
R4 hibernation unarmed ──────┘                                       ▼
R11 forgotten runs keep holds standing ──▶ retirement never comes  memory full, PSI 92%, load 145
R1 counts run rows, not processes ──▶ sees free slots on a full box  │
R9 nothing admits by memory ─────────▶ dispatch keeps spawning ──────┤
R1 also charges resumes (and may count stale rows) ──▶ refuses the cheap path (resume, send-back)
R8 refusal has no wake ──▶ the refused coordinator and its programme stall silently
R10 placement blind to counts ──▶ the spawns that happen pile onto one account
```

The common defect: **the rules guard the wrong boundary.** Holds that exist to protect a *workspace* (its branch, its PR, its report, its next wave) are applied to the *process*, which is cheap to stop and restart. Caps that exist to protect the *box* count *rows*. And the one decision that would end the waste, sleep, is either delayed by a hold the operator's run-close ruling did not include or unarmed.

## 3. Design

### 3.0 Two acts, two bars

The design separates two acts that today share holds:

| Act | What it frees | Reversible? | Who decides (K1) | Bar |
|---|---|---|---|---|
| **Sleep** (`ccd hibernate`) | the process: RAM, CPU, tool children | yes: mail, an open screen, a dispatch or the operator wakes it through `ensure` | `decideSleep(facts, policy)` | **low:** the session is idle and nothing is *using* it right now |
| **Retire** (`ws-reclaim`, `ws-reap`, `ws-expire`) | the workspace: worktree, branch, disk, registry row | no | `decideRetire(facts, reason)` | **high:** no open PR, no unpushed work, no live review need, no open run naming it, the reason's evidence |

A **use** blocks sleep: a turn running, background work, a viewer with the screen open (D-5242's open claim), a terminal attached, scheduled crons, mail not yet acknowledged (D-5426), an open run in which the session is the *active* worker (`dispatched`, `working` or `unknown`, the members of `ACTIVE_RUN_STATES`). A **claim on the workspace** blocks retirement only: a programme hold, a `run:` hold, an open PR, unpushed commits, a report the coordinator still cites. Sleeping a held workspace keeps everything the hold protects, because hibernation keeps the worktree, the branch, the transcript (its uuid) and the registry row, and `ccd-tmp-sweep` already counts a hibernated row as live.

**Scope of the split.** W1 applies it to the `run-done` policy only (today's stop-done lane), where the operator's run-close ruling already covers it. Applying it to `idle-hours` and `pressure` changes D-5242's hold set (`run-claimant`, `run-worker` in idle run states and `held` would become retire claims there), which is the operator's call: §6 F6. Until F6 is ruled, a coordinator with any open run never sleeps under `idle-hours` or `pressure`, and an `awaiting-review` producer never sleeps under `pressure`.

### 3.1 (a) Lifecycle: finished workers sleep within minutes

**The ruling restored.** The operator's 2026-10-17 ruling (Task 15b, D-5370) chose "stop workers at run close": a finished run's worker is stopped once idle, and restarts on re-dispatch. D-5370 implemented it with a 10-minute grace (`STOP_DONE_GRACE_MS`). D-5427 kept the lane but put it behind hibernation's 6 h `recent` hold without weighing it against that ruling. This design restores the ruling's timing (subject to the operator's confirmation in §6 F5, because consolidation §7 lists D-5427 as kept) and keeps D-5427's act:

- The `run-done` sleep policy (today's stop-done lane) composes `ccd hibernate` as D-5427 made it, under its own switches (`stop-done-disabled`, `hibernate-disabled`, `reclaim-paused`), at its own cadence (60 s, at most 3 acts a pass, D-5428's act-time re-measure on the coordination serialiser).
- Its clock is the run's close: it acts once the worker's newest run has been `done` for `STOP_DONE_GRACE_MS` (10 min) **and** the turn marker has been quiet for the same 10 minutes. It no longer reads N. Every other hold stays: those D-5427 added (`opted-out`, `scheduled`, `ccd`'s `attached`) and the lane's own (`viewer`, `mail`, `marker-background`, and the rest of `STOP_DONE_HOLD_MAP`).
- **`mail` stays a sleep hold, unbounded, as D-5426 keeps it.** W1-1's gate counts the finished children it holds. If that count is material, the plan proposes a bound to the operator (for example: delivered mail older than the grace, for which the session has already been woken, does not hold sleep, since new mail wakes a hibernated session anyway); this design does not change D-5426.
- **Holds that move from sleep to retire, for this policy:** `held` for a programme hold or a `run:` hold whose run is terminal; `reviewing` (the report and the worktree survive sleep, so the coordinator's cited path still resolves); and `run-worker` / `not-done` for a `planned` run that names the session (a planned, never-dispatched run is not a use; only `dispatched`, `working` and `unknown` are). A `.hold` written by the operator by hand stays a sleep hold.
- **Which states count as finished** beyond `done` is §6 F5: whether to add `failed`, and whether a producer parked at `awaiting-review`, `merging` or `closing` also sleeps after 30 minutes idle. A send-back is mail or a dispatch, and both wake the worker through `ensure`, so the review-runs design's "somewhere warm to land" (its opening paragraph and §3) stays, minus the process. That extension is W1-1b, gated on F5.

**General hibernation (any idle session).** The `idle-hours` policy (D-5242) is unchanged in its contract; its holds change only as §6 F6 rules. Two things change:
- It is armed. Task 19 is the operator's act; the operator asked for it on 2026-10-20, pending a network path to the box. The shadow lines already exist (117 a day).
- N is §6 F1. The recommendation is 2 hours: past the one-hour prompt-cache lifetime that D-5242 chose N by. Under today's holds that frees idle unbound sessions and coordinators with no open run; coordinators with an open run sleep only if F6 is ruled (i). A coordinator asleep wakes on its next mail through the wake budget, as D-5242 already specifies.

**A pressure policy (new row, same decider).** `decideSleep(facts, 'pressure')` is the bounded "sleep the longest-idle first" that a short admission asks for (§3.4).
- *Holds:* every `idle-hours` hold except `recent`, which it replaces with a floor of 30 minutes idle for children (`.child`). Sessions without `.child` (the operator's own) keep D-5242's N as their floor, unless the operator acts through "Sleep idle now" (§3.7).
- *Order:* candidates by idle age, longest first.
- *When it acts:* only while `admit-live` is armed (before that it writes shadow lines only), and only when admission asks for a pass, the pressure alarm is raised (§3.7), or the operator presses "Sleep idle now".
- *Budget:* at most 3 sleeps a minute **fleet-wide across every caller** (admission, alarm, operator), kept in a window like the wake budget's, so concurrent refused dispatches never sleep more than 3 sessions a minute in total. Its switch (`pressure-sleep-disabled`) and its schedule are rows in K12's `SWITCHES` and K11's `LANE_SCHEDULE`.

**Retirement keeps its high bar.** `decideRetire`'s reasons and evidence are unchanged (child reclamation, the PR ledger, archive expiry). `review-report-live` stays a retire claim while the reviewed work run is open, as today. Retiring a spent child at its run's close (close-time reclaim) already happens within minutes and is kept, except as §3.3 changes it for a child F2 (b) would reuse. Retirement still waits on forgotten and never-dispatched runs (R11); this design does not add an automatic close (that stays the coordinator's act, prompted by the run-quiet banner of W1-3), and the dead-coordinator and expiry lanes stay as their own designs arm them.

### 3.2 (b) Reviews: one sleeping reviewer, resumed per round

**The reviewer sleeps; its workspace stays.** With W1-1, stop-done's `reviewing` hold no longer holds sleep, so a reviewer sleeps 10 minutes after review-done. The child-reclaim sweep keeps the workspace under `review-report-live` until the reviewed work run closes, so the coordinator's fix-round mail can still cite the report by path, and the next round has a reviewer to resume. Measured, that is 21 running review children [M] that would have been asleep. No report copy is needed for the memory problem; copying the report into the run record (so the reviewer's disk can go sooner) is a disk-programme follow-up, out of scope here.

**One reviewer per work run, resumed per round.** A fix round opens its review run with the previous reviewer's `sessionId` when that reviewer reviewed the same work run, and dispatch resumes it (waking it if asleep) with `/clear`, as the resume arm already does for workers (D-5238's live-idle gate).

- *Resume, not a fresh one, and why it keeps the review-runs design's reason:* the reason for "never reused" was that "a report and the tip it describes are always one pair". That pair is per review **run**: each round is still its own run with its own `reviewedTip` and its own report, and `stale-review` still refuses a tip that moved. Only the session is reused.
- *Independence:* `/clear` gives the round a fresh context, so the reviewer does not anchor on its previous findings unless the brief hands them over. The coordinator's brief may hand them over deliberately ("check these findings were fixed"); that is the coordinator's choice per round.
- *What `openRun` accepts:* a `sessionId` on a review run only when that session is the reviewer of an earlier review run of the same `reviews` target; anything else stays refused with today's words. The rule is one predicate in `openRun`, held by a test with the refusals. A review is never done inline by the coordinator (§3.5, reason 1), so no other session is admitted.
- *What it saves:* rounds 2 to 4 of a work run mint nothing; the wake of a sleeping reviewer goes through admission and the wake budget (§3.4).

### 3.3 (c) Reuse: wake a finished worker before minting one

**Through the owner that exists.** The coordinator skill's step 6 already resumes a same-project child by naming its `sessionId`, and `refuseSpentChild` already refuses one that is spent. Reuse stays there; the server adds no candidate query of its own (one owner per job).

- **Under F2 (a)** (rule 3 as written), the candidates are producers that opened no PR and closed `final: false` under a programme hold, which step 6 covers today. The only change is §3.1: such a child is asleep rather than live, and the resume wakes it.
- **Under F2 (b)** (one open PR at a time), three changes:
  - `refuseSpentChild` accepts a child whose PR has merged or closed, of the **same programme** (never one holding another programme's `program:<p> wave:N+1`), and the coordinator skill's step 6 names such a child before minting.
  - `childReclaimDecision`'s `spent` arm does not retire at close while the child's programme has a next wave: the child sleeps (§3.1), and a retire claim with a stated ceiling (the programme's close, or 7 days, whichever is first) keeps the workspace. This defers retirement and therefore holds disk, which F2's trade-off states.
  - A new act-time verb in `ccd` (named by the plan, W4) prepares the reused tree under the workspace lock. It refuses unless all of these hold: `_ws_gc_dirty` reads clean (untracked files included), `git stash list` is empty, and the old branch head is reachable from a remote ref or the recorded PR head. An unmeasured answer counts as a refusal. It then creates a **new** branch from `origin/main` and never moves or deletes the old one. On refusal, dispatch mints fresh as today. Neither `ccd ensure` nor the resume `/clear` gate checks for uncommitted or unpushed work today; the only such checks are the reclaim lane's `_ws_gc_dirty` and `_ws_wip_commit`, so this verb is the guard.
- The coordinator may always force a fresh spawn; the reuse choice is the coordinator's, as today.

**Population.** Under (a), the 19 of 117 multi-run sessions [M] are the upper bound of today's reuse; under (b), the population (children with a merged or closed PR and no other claim) is unmeasured [open]. W4's first step measures it, and W4 does not start if it is near zero.

**Rule 3 is the operator's.** §6 F2 lays out the options; the recommended one keeps rule 3's purpose (one PR per child at a time, cleaned up after) while letting a child whose PR has merged or closed take its programme's next wave.

### 3.4 (d) Capacity: one admission rule on box memory

**One rule replaces the concurrency cap.** A dispatch that would start a process (a fresh spawn or a wake of a sleeping session) is admitted only when the box has room:

```
admit     ⇔  headroom − reserved ≥ H  ∧  pressure < P  ∧  the fleet-wide spawn rate allows
headroom  =  min( cgroup term, /proc/meminfo MemAvailable )
cgroup term = _mem_headroom: min over the session slice and each ancestor up to the user tree
              of memory.max − that level's own anon (CB1c, D-5697)
pressure  =  the session slice's memory.pressure "some avg10" (PSI, cgroup v2);
             the box's /proc/pressure/memory when the slice's file is absent
reserved  =  R × (spawns and wakes admitted in the last 3 minutes)
unmeasured when: zero limited cgroup levels (every level reads `max`), or any of the cgroup,
             meminfo or PSI files is unreadable — never "infinite"
```

- **Why these.** The cgroup term answers "is there room for one more session" in the cgroup that will kill it if not (the slice's `MemoryMax`); it reads `anon`, not `memory.current`, so page cache does not read as full (the CB1c plan's stop rule). `MemAvailable` covers what the cgroup term cannot: physical RAM, processes outside the slice, and pages already pushed to swap (which `anon` does not count). Pressure answers "is the box already stalling", which headroom misses when swap absorbs the shortfall. The box read 92% memory pressure at the census [M]; whether headroom alone would have refused then is not measured [I]. W3-2's shadow week logs the slice's `memory.pressure` itself before F4's P is armed.
- **The reservation.** A Claude session reaches its resident size seconds to minutes after `ws-add`, so dispatches inside that window would all read the same headroom. Each spawn or wake admitted in the last 3 minutes is charged a nominal per-session figure R against headroom. R is a constant written with its measurement: the plan measures the census median of a session's whole tree (main process and tool children; the main process alone averaged about 245 MB [M]). Fresh spawns are also capped at **2 a minute fleet-wide**, recorded in the wake budget's window as `asked`, so spawns and automatic wakes share one rate.
- **Where it is measured.** On the box, by `ccd`: `_mem_headroom` and the read-only `ccd claude mem` (both CB1c, D-5697, not yet built; one writer, CB1c, and W3-1 waits for it), which this design extends with a `--json` form carrying the headroom fields, `MemAvailable` and a new `psiSome10`. The server reads it fresh at the dispatch (through the agent, as every `ccd` call goes) and on the node inventory sweep's cadence for display.
- **Where it is decided.** `decideAdmission(reading, reservations, policy)` is a pure L1 function in C5 (Coordination). It replaces `capsMeasured`'s verdict in `dispatchRun` step 2 and in the advance route. `decideCaps` (in `coord/caps.ts`, the `POST /api/coord/caps` validator) stays as the dial validator until W3-4 removes the concurrency field.
- **Where it is enforced at the act.** `ccd ws-add --child` re-reads the same figures inside its own lock and refuses `no-headroom` when headroom is below a hard floor (H/2, never configurable above H) **or the reading is unmeasured**. Only this floor fails closed. This is the TOCTOU guard (consolidation K2's act-time re-check), and it holds even for a spawn that reaches `ccd` without the server's check. It applies to dispatched children only. Each case (limited level, all levels `max`, unreadable file, swap-heavy slice) is pinned with the `ccd-mem-headroom` fixture tree.
- **How it survives the server being down.** The figures live on the box (cgroup and proc files). H, P and the floor are box markers (`$REG/admit-headroom-gib`, `$REG/admit-pressure-pct`), read by `ccd` and by the server; H's default is derived from `CLAUDE_HEADROOM_GATE_BYTES` (one source of the figure), and the marker only overrides it. With the server down nothing dispatches, and `ccd`'s own floor still guards `ws-add --child`. The reservation and the spawn rate are server memory, like the wake budget's window; a server restart forgets them, which costs at most one window's burst, and `ccd`'s floor still holds.
- **What it never touches.** Account switching and the auto-swap are never blocked: `_auto_swap_check`, `_swap_idle_gate`, `_swap_target`, `cmd_swap`, `swap-self` and the swap routes read none of these figures, and the consolidation spec's swap pin is extended with that row. The operator's own new sessions (the PWA's New session, `cc`, `ccd ws-add` without `--child`) are never refused; the PWA shows the reading beside the button (§3.7). An asked wake (the operator's open or Wake) is never refused, as D-5242 rules.

**Unmeasured.** Before W3-4, an unmeasured reading falls back to today's concurrency cap. After W3-4 (which removes that cap), an unmeasured reading admits a fresh spawn only at the fleet-wide rate (2 a minute, shared with wakes), and `fleet-pressure-unmeasured` is raised after 3 failed sweeps (§3.7). W3-4 is conditional on zero unmeasured readings during the shadow week.

**Ordering: refuse at once, then one bounded sleep pass outside the request.** `dispatchRun` runs entirely inside `coordMutex.run(...)`, and `CoordMutex` is a non-reentrant promise chain that the sleep executor also takes (`StopDoneSweepDeps.serial`). So dispatch never sleeps anything itself:

1. Inside the mutex, `dispatchRun` takes a fresh reading and calls `decideAdmission`. If it fails, `dispatchRun` refuses `capacity` with the reading and stamps the run (`admissionWaitSince`, §3.5). Nothing else happens inside the mutex.
2. The refusal requests one `pressure` pass. That pass runs on its own K11 `LANE_SCHEDULE` row, outside the mutex, through the sleep executor and its serialiser, inside the policy's fleet-wide budget (3 sleeps a minute).
3. The coordinator then works by §3.5: it self-works, or (when a reason applies) ends its turn and waits for the wake-on-free mail, which is sent only when admission passes with a margin.

No in-request retry is designed: PSI `some avg10` is a 10 s exponential average and needs about 15 s or more of zero stall to fall from 90% below 20%, so a short settle would sleep sessions and refuse anyway, and the request already shares ccrc-api's 30 s cap with `worker-starting`'s 15 s wait. A pin holds that an admission-short dispatch completes while a concurrent close takes `coordMutex` (no nesting), and that 5 refused dispatches inside one minute sleep at most 3 sessions in total.

**What is free and what is charged.**

| Dispatch kind | Admission | Wake budget | Daily brake |
|---|---|---|---|
| Resume of a **live** session (worker or reviewer) | free | — | per §6 F3 (recommended: free) |
| Send-back (advance to `working`) of a live worker | free | — | per §6 F3 (recommended: free) |
| In-place bind (§3.5; the coordinator works the run itself) | free | — | free |
| Wake of a **hibernated** session | admitted by memory, reserved | counted as an asked wake (never refused by the budget, D-5242) | per §6 F3 (recommended: free) |
| Fresh spawn (`ws-add --child`) | admitted by memory, reserved, 2 a minute | recorded as `asked` | counted |

Today all of the first four kinds that start nothing are charged like a spawn.

**Stale runs never hold capacity.** With admission on memory, no run row is counted at all. Until W3 lands, W1-3 changes the concurrency verdict: `capsMeasured` (over the store rows from `capsUsage` plus the session reading; `capsUsage` stays a plain SQL count) counts a run only while its worker session reads alive and busy, or was dispatched within the last 2 hours. A run whose worker is dead, stopped, asleep, archived, or idle longer than that is not counted, and the existing drift words (`run-quiet`, `claimant-gone`) name it on the banner so the coordinator closes or abandons it. Nothing closes a run automatically; that stays the coordinator's act. The predicate is temporary: it reads today's `liveStatus` and turn verdict (the source K3 will replace), and it is deleted at W3-4 with the cap.

**The daily brake.** Its purpose (a budget brake against a runaway coordinator, build7 §5) is not about memory, so the admission rule does not replace it. Whether it stays, what it counts, and at what ceiling is §6 F3; W1 does not change what it counts.

**Per-programme fairness.** No quota is added now. When capacity is short, the wake-on-free queue (§3.5) is served round-robin by programme, oldest refusal first within a programme, so one programme cannot starve the others. A per-programme share is reconsidered only if §8's refusal counts show one programme taking most of the box.

### 3.5 (e) A refusal never strands work

**The coordinator does the work itself.** Per the operator's ruling, a coordinator whose dispatch is refused (`capacity`, `cap-daily`, or today's `cap-concurrency` until W3) does that wave itself, now, following the same worker skill clauses it would brief a worker with (one PR, wave-done evidence, no merge without review).

- **The tree rule.** Self-work happens in a plain `git worktree add` sibling inside the coordinator's own workspace directory (a git act, not a `ccd ws-*` verb), cut from `origin/main`. The coordinator's own checkout and its programme ledger (`docs/superpowers/programs/<slug>.md`, normally dirty) are never switched, and never committed into the wave. The sibling is removed after the PR is pushed and the run closes.
- **The binding: an in-place bind (W1-4b).** The wave's run binds the coordinator as its worker through a distinct act, never through dispatch's resume arm (which would run `ccd ensure` on the coordinator, refuse `worker-busy` mid-turn, take a `ws-hold`, route, mail a brief and type `/clear` into its own pane). The act is a dispatch variant `inPlace: true` (or an equivalent advance), accepted only when the caller's id and uuid are the run's claimant and the claimant's measured project equals the run's project. It moves `planned` to `working` with `sessionId` = the claimant, records an additive `inPlace` flag (`resumed = false`), and runs **no** admission, caps, ensure, hold, route, brief mail or `/clear`. A dispatch (not `inPlace`) whose target session equals the run's claimant is refused `self-dispatch` before any fleet act. The run then reaches `awaiting-review` and closes as any run does, so the run board, the review run and close work unchanged. Stop-done's `not-a-child` and hibernation's `run-claimant` already keep the coordinator awake through and after the self-run (`STOP_DONE_HOLD_MAP`).
- **Tests.** Self-work runs suites with the repo's capped worker count (#389's vitest cap) and never starts a full suite while another runs on the box.
- **Routed asks while self-working.** Under coordinator-first routing, a busy coordinator holds its other children's asks until the 180 s escalation. Before self-working, a coordinator with other runs at `dispatched` or `working` checks for routed asks between commits and ends its turn whenever one arrives, or reason 5 applies. §8 counts asks escalated during self-work.

**The very specific reasons it must not, and then waits.** It waits only when one of these applies, and it names the reason in its status:

1. **The refused run is a review.** A refused review run is never done inline, whoever produced the wave: clause 14 makes the review a held-out multi-lens panel run only by a reviewer session, and a coordinator must not review its own work. It waits for the wake.
2. **Wrong repository.** The wave is a crossing into a project the coordinator's workspace does not sit in (`project-mismatch`); its own worktree cannot carry that branch.
3. **Another wave is open in its sibling.** The sibling worktree holds uncommitted or unpushed work of another wave, or an open PR the new work would mix into. It finishes or parks that first, then does the refused wave serially. (Ledger edits in its own checkout do not count.)
4. **Forbidden to sessions.** The work needs an act the ccrc SAFETY rules forbid to sessions (`ws-*` destructive verbs, unit or tmux touches, credentialed operator acts) or is marked operator-only in the plan.
5. **The plan says parallel-only.** The plan marks the wave as needing an isolated workspace (for example, it needs a second account's limits), and says why.
6. **The fleet is paused.** The refusal is `paused` or maintenance mode (#296), not capacity. That is the operator's stop; the coordinator reports and waits.
7. **The box is in distress.** The refusal is `capacity` and the `fleet-pressure` alarm is raised, or headroom is below H/2. The memory hogs are tool children (test workers, builds), not the Claude process, so self-work then would deepen the stall; the coordinator ends its turn and waits for the wake.

**The refusal words say so.** The `capacity` refusal's detail reads, in substance: "No room for a new workspace: headroom 1.2 GiB (needs 3 GiB), pressure 34% (limit 20%); idle sessions are being put to sleep. Do this wave in your own workspace now (an in-place bind and a sibling worktree), unless one of the reasons in the coordinator skill applies; if one does, end your turn and the server will mail you when there is room." The coordinator skill's "When something is wrong" entry for a cap refusal is rewritten to the ruling and the seven reasons, replacing "wait to be woken".

**The server wakes waiting coordinators.** A refused dispatch stamps its run (`admissionWaitSince`, additive). When admission would pass with a margin (headroom ≥ H + 1 GiB and pressure < P/2, so one freed session does not wake ten coordinators), the server sends system mail (`queueSystemMail`, the kickoff path) to the oldest waiting coordinator per programme, round-robin, at most 2 a minute (the wake budget's rate). A coordinator that is asleep wakes on that mail through the wake budget, as any mail does. For `cap-daily`, the wake is sent when the rolling window frees a slot. Each refusal and each wake is logged (one journal line and one feed row through K6's funnel, with a `dedupeKey` per run), so §8 can count them.

### 3.6 (f) Placement spreads by live sessions

#749 makes the placement key a triple: tier, then programme members on the lane, then the walk's existing order. This design adds one key between the second and third: **live sessions on the lane**, fewest first.

- *Counted by `ccd` from local files only:* registry rows whose `.wrapper` is the lane and which are not stopped, archived or hibernated (a hibernated member counts for the programme spread, as #749 says, but not as live load).
- *Where it applies:* `_ws_least_loaded` (a new child's home), inside #749's tiers and after every filter, where #749's key applies. Unlike #749's key (which leaves `projectHome` untouched, because a new session in a project has no programme), it is also added to `projectHome`, because live load concerns every new session; `projected-home.test` gains the fixture. It is **not** added to `_swap_target`: the measured defect concerns new-spawn placement only, and the swap path is ruling-protected. It never removes a candidate, never moves a running session, and never blocks a swap; with every count equal, the order is #749's.
- *Why a key and not a per-account cap:* a cap would refuse; the operator ruled that switching is never blocked, and placement is a preference. The measured defect (three spawns in 20 minutes all on one account, taking it to 12 live) is an ordering one.

### 3.7 (g) Observability

**What the PWA shows.** Capacity in real terms, replacing the two run-row counters in `CapsControl`:
- **The glance (fleet card / header strip):** one line, e.g. "Memory: tight · 2.1 GiB free · 29 idle". Words: `ok`, `tight` (admission passes but without the wake margin), `full` (admission refuses), `unmeasured`.
- **The detail (header sheet, a superset of the glance):** headroom against H, pressure against P, live sessions split busy / idle / asleep, **idle residue** (live sessions idle with no binding, their count and RSS), waiting coordinators (refused runs and since when), the daily brake's count, and the last refusals and wakes. The operator's existing actions stay; one is added: "Sleep idle now", which runs the `pressure` policy once (an operator act, inside the policy's fleet-wide budget).
- **Each session row:** an idle session with no binding reads "idle 7h · no work" so residue is visible where it lives.
- **Widths and skins:** judged at 360, 390, 1280 and 1920 px in both skins and both themes, as every PWA change is.

**The pressure alarm.** One feed event through K6's `notify` funnel, `fleet-pressure`, raised when pressure ≥ 50% for 5 minutes or headroom < H/2, cleared when both recover for 5 minutes, deduplicated by key, with one push on raise. While it is raised, the `pressure` policy may run (inside its budget) if `admit-live` is armed. The reading comes from the node inventory sweep; a reading that fails for 3 sweeps raises `fleet-pressure-unmeasured` instead of guessing.

## 4. How this maps onto the consolidation clusters and lanes

Nothing here is a parallel mechanism. Every change lands in an owner the consolidation spec already names, and where that cluster's wave has not started, the change lands in today's code in the shape the cluster will absorb.

| This design | Owner (consolidation spec) | Reuses | New |
|---|---|---|---|
| (a) finished-worker sleep at 10 min | K1 `decideSleep`, policy `run-done` (today `stopDone.ts`) | the lane, its switches, D-5427's `ccd hibernate`, D-5428's act-time re-measure | the clock reads the run close, not N; three holds move to retire for this policy |
| (a) general hibernation | K1 policy `idle-hours` (today `hibernateSweep.ts`) | all of D-5242 | arming (operator act); N per F1; holds per F6 |
| (a)/(d) pressure sleep | K1, a third policy row `pressure` | `hibernateVerdict`'s holds, the sleep executor | one policy row: floor, ordering, fleet-wide budget, switch |
| (a) sleep versus retire holds | K1's two deciders; C5's `bindingsOf` | today's hold vocabulary | the split of holds into "use" and "claim" (run-done now; others per F6) |
| (b) reviewer reuse | C5 `openRun`, dispatch's resume arm | the resume arm, `/clear`, D-5238; `review-report-live` as a retire claim | one `openRun` predicate |
| (c) reuse first | the coordinator skill's step 6; C5 `refuseSpentChild`; K1 `childReclaimDecision` | the resume arm, `_ws_gc_dirty` | under F2 (b): the predicate change, the `spent` arm's deferral, one `ccd` act-time verb |
| (d) admission | C5 `decideAdmission`, replacing `capsMeasured`'s verdict; C1 for the reading | CB1c's `_mem_headroom` and `ccd claude mem`; the node inventory sweep; the wake budget's window | `ccd claude mem --json`, `_mem_pressure`, `MemAvailable`; the reservation; `ccd`'s floor |
| (d) stale runs not counted (temporary) | C5 `capsMeasured` | today's `liveStatus`, turn verdict | the count predicate, deleted at W3-4 |
| (e) in-place bind | C5 `dispatchRun` / the advance route, one new arm | the run state machine | `inPlace` flag; `self-dispatch` refusal |
| (e) wake waiting coordinators | C5; K6 `notify`; K11 `LANE_SCHEDULE` | `queueSystemMail`, the wake budget | `admissionWaitSince`, one schedule row |
| (f) live-session key | K15; #749's triple in `_ws_least_loaded` and `projectHome` | `_limit_score`, #749's tiers | one key |
| (g) alarm and display | K6 `notify`; K14 (PWA, one owner per fact) | the feed, `CapsControl` | `fleet-pressure` event; the capacity fact on the fleet frame |
| switches | K12 `SWITCHES` | — | `pressure-sleep-disabled`, `admit-live`, `admit-headroom-gib`, `admit-pressure-pct` |

**Fit with the consolidation waves.** The consolidation W4 (K1) waits for hibernation's Task 19 and merges stop-done and hibernation without changing behaviour. This design's W1-1 is a **behaviour commit** in that spec's sense (§5.1 rule 1b): its own commit, characterization assertions changed only there, before/after rows in the PR body, citing the operator's 2026-10-17 ruling and F5's confirmation. If consolidation W4 lands first, W1-1 is one row's clock in `decideSleep`; if W1-1 lands first, W4's characterization pins the restored timing. The same holds for the `pressure` row. If F6 is ruled (i), the use-hold set is one set inside `decideSleep` shared by every policy, which narrows rather than widens the gap K1 merges. W1-3 adds a liveness consumer in `capsMeasured` that K3's migration must move or (better) find already deleted by W3-4.

**PWA.** W6 touches `pwa/`; it lands after the skins chain's screens (or line-disjoint from them) and outside any consolidation series before W7, whose CI path guard (consolidation §5.1 rule 8) refuses `pwa/` changes.

**Lanes.** W1 is server and skill text (server lane). W3's `ccd` half deploys agent-first, as every release does. No wave adds a herd restart: the `run-done` policy acts at most 3 a pass, the `pressure` policy at most 3 a minute fleet-wide, and wakes stay inside the wake budget.

## 5. Migration waves, smallest first

Every wave lands its characterization pins first, keeps behaviour changes in their own commits, and rolls back by revert. Each W1 item is a separate PR.

### 5.1 W1: quick wins (server and skill text; one small new arm)

- **W1-1. Restore the run-close timing for finished workers** (after F5's confirmation). First, the baseline: count finished children held only by `mail`, and coordinators with an open run among the idle. Then `stopDoneVerdict`: the clock is the run's `done` plus `STOP_DONE_GRACE_MS` and 10 minutes of turn-marker quiet, not N; `reviewing`, programme holds, terminal-run `run:` holds and `planned`-run `run-worker` / `not-done` stop holding sleep. Pins: one case per moved hold; "a programme-held finished child sleeps at 10 min"; "a planned run naming the child does not hold sleep"; "an operator `.hold` still holds"; "`mail` still holds"; the D-5427 shared-hold words unchanged. *Gate:* after deploy, the `run-done` lane's feed shows finished children asleep within 15 minutes of close, with mail-held children reported as an excluded row with their count.
- **W1-1b. Extend "finished" per F5** (`failed`; `awaiting-review`, `merging`, `closing` after 30 minutes idle): narrows `not-done` and `run-worker` for the `run-done` policy. Its own behaviour commit. Waits for F5.
- **W1-2. Live resumes and send-backs skip the concurrency check.** `dispatchRun` takes the resume-versus-fresh branch before the concurrency check and skips it for a resume of a live session; the advance route stops checking it for a send-back of a live worker. `dispatchedIn24h` is unchanged (what it counts is F3, W3-5). Pins: a live resume at a full concurrency cap dispatches; a fresh spawn at a full cap refuses as today. Lands after W1-1's gate is met and hibernation is armed.
- **W1-3. Stale runs are not counted (temporary).** First step: the measurement of §1.1 (are the stale runs' workers busy?). Then `capsMeasured` counts a run only while its worker reads alive and busy, or was dispatched within 2 hours, using today's `liveStatus` and turn verdict; the predicate is deleted at W3-4. Pins: a 6-day `dispatched` run with a dead worker is not counted; a busy one is; a run whose worker is idle but not hibernated or dead is still counted for its first 2 h; slots freed by the predicate are handed out no faster than 2 a minute. Lands after W1-1's gate is met and hibernation is armed. If W1-3 slips, the zero-code fallback is the operator raising the concurrency dial.
- **W1-4. Wake refused coordinators.** `admissionWaitSince` on a refused run; a schedule row that mails the oldest waiter per programme when the cap frees (with today's caps, until W3), at most 2 a minute; one journal line and one feed row per refusal and per wake. Pins: a refusal followed by a freed slot sends one mail; two programmes waiting are served alternately.
- **W1-4b. The in-place bind.** The `inPlace` dispatch variant (or advance) of §3.5, accepted only for the claimant in its own measured project; the `self-dispatch` refusal; the additive `inPlace` flag. Pins: characterization of today's dispatch first; then an in-place bind moves `planned` to `working` with no fleet act; a non-claimant `inPlace` is refused; a plain dispatch to the claimant is refused `self-dispatch`; an in-place run reaches `awaiting-review` and opens a review run.
- **W1-5. The do-it-yourself ruling in words.** The refusal details for `cap-concurrency` and `cap-daily` (and later `capacity`) carry the §3.5 text; the coordinator skill's "When something is wrong" entry and the crossing paragraph that says "wait to be woken" are rewritten to the ruling, the tree rule, the in-place bind and the seven reasons. Lands after W1-4 and W1-4b, so the words never promise a wake or a bind that does not exist.

### 5.2 W2: the review lifecycle

- **W2-2.** One reviewer per work run: `openRun` accepts a `sessionId` on a review run only for the earlier reviewer of the same target; the coordinator skill's fix-round step names it; the reviewer skill notes that a round starts from `/clear`. Relies on W1-1 (the reviewer sleeps, its workspace kept under `review-report-live`). (W2-1, a report copy into the run record, is dropped from this programme; see §3.2 and the Review log.)

### 5.3 W3: memory admission

- **W3-1.** After CB1c: `ccd claude mem --json` with the headroom fields, `MemAvailable` and `_mem_pressure`'s `psiSome10`; the node inventory sweep stores them. Read-only: shown, decides nothing.
- **W3-2.** `decideAdmission` (with the reservation and the spawn rate) and the `pressure` sleep policy, in **shadow**: every dispatch logs what admission would have answered beside what the caps answered, and the slice's own `memory.pressure`, for a week.
- **W3-3.** Arm admission (an operator act, `$REG/admit-live`); `capacity` refusal words; `ccd ws-add --child`'s floor (H/2 or unmeasured). The concurrency cap stays as a dial the operator can still set, but at `CAP_MAX` by default, so it decides nothing.
- **W3-4.** After two releases with admission as the only reader, and only if the shadow week saw zero unmeasured readings, remove the concurrency cap's dispatch check, its field and W1-3's predicate (the wire change's rollback horizon, consolidation §5.1 rule 4).
- **W3-5.** The daily brake per §6 F3.

### 5.4 W4: reuse first

- Waits for F2. First step: measure the reuse population (§3.3). Under F2 (b): the `refuseSpentChild` change, the `spent` arm's deferral, the `ccd` act-time verb with pins ("unpushed commits → mint fresh", "remote branch deleted, local unique commits → mint fresh", "stash present → mint fresh", "unmeasured → mint fresh"), and the coordinator skill's step 6 text.

### 5.5 W5: placement

- The live-session key in `_ws_least_loaded` and `projectHome`. Rides #749's FP8 (the same walk, the same parity fixture). Waits for #749's ccd tasks.

### 5.6 W6: PWA

- The capacity glance and detail, idle residue on rows, "Sleep idle now", the `fleet-pressure` alarm's feed row. Placement per §4's PWA paragraph; judges every width, skin and theme.

### 5.7 Sequencing at a glance

```
F5 confirmed ─▶ W1-1 ─▶ (gate met, hibernation armed) ─▶ W1-2, W1-3
F5 ruled ─▶ W1-1b
W1-4 ─┐
W1-4b ┴─▶ W1-5
W1-1 ─▶ W2-2
CB1c ─▶ W3-1 ─▶ W3-2 (shadow week) ─▶ W3-3 (operator arms) ─▶ W3-4 ─▶ W3-5 (per F3)
F2 ruled ─▶ W4
#749 FP8 ─▶ W5
skins chain screens ─▶ W6
Task 19 (operator arms hibernation) runs beside all of this; F1 and F6 tune it
```

## 6. Operator decisions

Each decision has options with a recommended one and its trade-off. **All seven were ruled on 2026-10-20; each took its recommended option** (§6.1). The options are kept as written, so the trade-off each ruling accepted stays on the record.

**F1. N for general hibernation (any idle session).** *Decided 2026-10-20: (b), N = 2 h.*
- (a) 6 h, as built (D-5242). Least change; leaves 26 sessions [M] idle for a working day before sleep.
- (b) **Recommended.** 2 h. Past the one-hour prompt-cache lifetime D-5242 reasons from, so a wake costs nothing idling would have kept. Under today's holds it frees idle unbound sessions and coordinators with no open run; coordinators with an open run sleep only if F6 is (i). Trade-off: more wakes, each a cold `--resume` (seconds) inside the wake budget.
- (c) 1 h. Most memory back; a coordinator that checks in hourly would wake every time.

**F2. Rule 3, one PR per child.** *Decided 2026-10-20: (b), one open PR per child at a time.*
- (a) Keep rule 3 as written. Reuse (§3.3) then covers only producers that opened no PR, through step 6 as today. Trade-off: almost every wave still mints a workspace (disk, a cold start, the brake).
- (b) **Recommended.** One *open* PR per child at a time. A child whose PR has merged or closed may take its own programme's next wave in the same project, only after the `ccd` act-time check proves nothing would be lost and on a new branch from `origin/main`, with its context cleared; otherwise it is retired as today. Keeps rule 3's purpose (a child never carries two PRs at once; finished children are cleaned up) and its letter for children not reused. Trade-off: it changes the operator's own rule; retirement of such a child is deferred (a retire claim with a ceiling), so it holds disk longer; and a reused tree carries build caches from the previous wave (cheaper, and occasionally stale).
- (c) Drop rule 3. A child serves its programme until the programme ends. Most reuse; workspaces live as long as programmes, which is what rule 1 was written against.

**F3. The daily brake.** *Decided 2026-10-20: (a), it counts only fresh workspaces; default 64, `CAP_MAX` 256.*
- (a) **Recommended.** Keep it, counting only fresh workspaces; default 64, `CAP_MAX` raised to 256. Keeps a runaway-coordinator brake that memory admission does not provide (a coordinator could spawn and finish workers all day within memory). Trade-off: one more dial to explain.
- (b) Remove it; memory admission and the accounts' own limits bound the fleet. Simplest; nothing bounds a coordinator that loops on cheap waves.
- (c) Keep it counting every dispatch, raise `CAP_MAX`. Smallest change; still charges reviews and resumes.

**F4. The admission thresholds.** *Decided 2026-10-20: (a), H = 3 GiB, P = 20%, floor H/2, a shadow week before arming.*
- (a) **Recommended.** H = 3 GiB (derived from `CLAUDE_HEADROOM_GATE_BYTES`, the roll gate's figure; the marker overrides), P = 20% PSI `some avg10` of the slice, floor H/2. Trade-off: chosen from one day's census, whose PSI source is not recorded; W3-2's shadow week checks them on the slice's own `memory.pressure` before arming.
- (b) H = 4 GiB, P = 10%. More conservative; more coordinators do their own work.
- (c) Headroom only, no pressure. Simpler; misses the swap-absorbed stall the census measured.

**F5. When a finished worker sleeps.** *Decided 2026-10-20: (0) confirmed and (b).*
- (0) **Confirm the restoration.** W1-1 restores D-5370's run-close timing (10 minutes after `done`), overriding the 6 h `recent` hold D-5427 added, which consolidation §7 lists among the rulings it keeps. **Recommended: confirm.**
- (a) `done` only, as D-5370. Leaves `failed` runs' workers and producers at `awaiting-review` awake (10 measured, the oldest dispatched 114 h earlier [M]).
- (b) **Recommended.** (a), plus `failed` (a change from D-5370), plus a producer parked at `awaiting-review`, `merging` or `closing` after 30 minutes idle (W1-1b). A send-back or a merge step wakes it through `ensure` or mail. Trade-off: a send-back costs a cold resume instead of landing in a live process.
- (c) At release: when the workspace loses its last binding (no open run, no hold). Waits for the coordinator to close the work run, which is unbounded today (R11); recommended against.

**F6. One use-hold set for every sleep policy.** *Decided 2026-10-20: (i).*
- (i) **Recommended.** One use-hold set inside `decideSleep`, shared by `run-done`, `idle-hours` and `pressure`: `run-claimant`, `run-worker` in idle run states (`planned`, `awaiting-review`, …) and programme or terminal-run holds become retire claims; policies differ only in clock and population. Coordinators idle between waves then sleep and wake on mail, and K1's merge gets one hold set. Trade-off: it changes D-5242's hold set; a coordinator's next wave after a long gap starts from a cold resume.
- (ii) Keep `idle-hours`' holds as built. A coordinator with any open run never sleeps (38 open runs, 18 of them planned, at the census [M]); the `pressure` policy's population is then mostly unbound sessions.

**F7. Admission is not the rejected resident-session cap.** *Decided 2026-10-20: (a).*
- (a) **Recommended.** Confirm that §3.4 is outside the review-runs §3 rejection of `maxResidentSessions`: it counts nothing in the server, never caps a cgroup, refuses only dispatched children, never refuses the operator, a resume or a swap, and sends refused work to a live coordinator. W3-2's shadow week is the evidence before arming. (#456's live-session cap stays unbuilt.)
- (b) Treat it as the rejected cap; keep the run-row caps with W1's fixes only, and rely on sleep (W1-1, F1, F6) to free memory.

### 6.1 Decision log

**2026-10-20, the operator's ruling.** Asked "accept all seven recommended options (F1..F7)?", the operator answered, verbatim:

> "Accept all recommended (Recommended)"

| Decision | Status | Option chosen | What it binds |
|---|---|---|---|
| F1 | decided 2026-10-20 | (b) N = 2 h | general hibernation's N; already set on the fleet box (below) |
| F2 | decided 2026-10-20 | (b) one open PR per child at a time | W4 (§3.3, §5.4) |
| F3 | decided 2026-10-20 | (a) the daily brake counts only fresh workspaces; default 64, `CAP_MAX` 256 | W3-5; W1 does not change what the brake counts |
| F4 | decided 2026-10-20 | (a) H = 3 GiB headroom, P = 20% PSI `some avg10`, floor H/2, a shadow week before arming | W3-2, W3-3 |
| F5 | decided 2026-10-20 | (0) the D-5370 restoration confirmed, and (b): `failed` runs, and producers parked at `awaiting-review`, `merging` or `closing` after 30 minutes idle | W1-1 (the confirmation), W1-1b (the extension) |
| F6 | decided 2026-10-20 | (i) one use-hold set inside `decideSleep` | the sleep-decider merge (consolidation K1); W1-1 and W1-1b write the `run-done` split in that shape |
| F7 | decided 2026-10-20 | (a) admission is not the rejected `maxResidentSessions` cap | W3; #456's live-session cap stays unbuilt |

**Operator acts recorded on 2026-10-20.** Both were done on the fleet box at the operator's request; neither is a code change.
- **N = 2 h** (F1) was set through `$REG/hibernate-after-hours`.
- **Hibernation was armed** at 13:49 UTC (working-state plan Task 19), through `$REG/hibernate-live`. From that moment the `idle-hours` policy acts rather than writing shadow lines, under D-5242's holds as built (F6 (i) reaches them only through the sleep-decider merge). §3.1's "It is armed" paragraph now describes the fleet's state, and the arming gate of W1-2 and W1-3 (§5.1, §5.7) is met.

## 7. Risks and rollback

| Risk | Guard | Rollback |
|---|---|---|
| Sleeping a session someone is about to use | every D-5242 use-hold stays (viewer, attached, mail, scheduled, background); D-5428's act-time re-measure; a wake is one `ensure` | `stop-done-disabled` / `pressure-sleep-disabled`; revert W1-1 |
| A sleep herd from refused dispatches | no sleep inside dispatch; the `pressure` policy's fleet-wide budget of 3 a minute across every caller; acts only while `admit-live` is armed | `pressure-sleep-disabled` |
| A wake or spawn herd | the wake budget (2 a minute) for automatic wakes; fresh spawns 2 a minute fleet-wide; the in-flight reservation; the wake-on-free margin; no wave adds a restart | `hibernate-disabled`; `admit-live` off |
| Admission refusing on a bad reading | shadow week (W3-2); `MemAvailable` beside the cgroup term; unmeasured falls back to today's cap before W3-4 and to the fixed spawn rate after it, with `fleet-pressure-unmeasured`; W3-4 conditional on zero unmeasured readings; `ccd`'s floor fails closed only below H/2 or unmeasured, and the coordinator then self-works | remove `$REG/admit-live` (no deploy) |
| Loosening the only bound before memory frees | W1-2 and W1-3 land after W1-1's gate and hibernation's arming; freed slots handed out at most 2 a minute | revert W1-2 / W1-3; the operator's dial |
| A coordination-plane deadlock or stall | admission is decided inside `coordMutex` with no nested lock and no settle; the sleep pass runs outside it; a pin with a concurrent close | revert |
| The coordinator doing a wave itself loses its programme context or its ledger | the in-place bind runs no `/clear`, ensure or route; self-work in a sibling worktree, never in its own checkout; `self-dispatch` refuses the unsafe path; the seven reasons | the coordinator can still wait (reason 5 if the plan says so) |
| Self-work deepens a memory stall | reason 7 (alarm raised or headroom below H/2 → wait); capped test workers; no concurrent full suite | — |
| Children's asks escalate while their coordinator self-works | the coordinator ends its turn when a routed ask arrives; §8 counts escalations during self-work | the coordinator waits instead |
| Account switching blocked by mistake | the swap path reads none of the figures; the live-session key is not added to `_swap_target`; the consolidation swap pin gains a row | revert |
| A reused child (F2 b) loses or carries work | the `ccd` act-time verb: clean (untracked included), no stash, old head reachable from a remote or the PR head, unmeasured refuses; a new branch, the old one kept; mint fresh on any refusal | the coordinator forces a fresh spawn; revert W4 |
| Losing the earlier lesson ("an aggregate cap froze the fleet") | admission refuses only dispatched children and routes the work to a live coordinator; it never caps a cgroup and never refuses an operator spawn, a resume or a swap; F7 asks the operator | `admit-live` off |

**Bound rulings, kept:** account switching and the auto-swap are never blocked; no herd restarts; hibernation's contract (wake through `ensure`, the wake budget, the presence contract); coordinator-first routing; improve what exists first (every part grows out of a mechanism named in §4); a card is a glance and its header a superset; every width, skin and theme.

## 8. Measures of success

Measured on the box before W1 and after each wave, the same queries as §1.1:

| Measure | Baseline (2026-10-20) | Target after W1 | Target after W3 |
|---|---|---|---|
| Live children idle with no binding | 21 children [M]; 53 idle overall | ≤ 5 children not held by `mail`, none older than 30 min after close; mail-held counted separately | ≤ 5 across the fleet beyond N |
| Finished children held only by `mail` | unmeasured [open] | counted | counted |
| Idle coordinators with an open run | unmeasured [open] | counted (F6 baseline) | per F6 |
| RSS held by idle residue | 12.7 GB [M] | < 5 GB | < 3 GB |
| Reviewers awake per closed review | 21 of 25 [M] | 0 after 15 min | 0 after 15 min; one reviewer session per work run (W2-2) |
| Resumes per dispatch | 0 of 62 [M] | — | ≥ 30% of work dispatches after W2/W4 |
| Fresh workspaces per day | 62 [M] | — | ≤ work waves + one reviewer per work run |
| Refusals, and refusals with no follow-up | unlogged [M] | logged; 0 refusals without self-work or a wake within 1 h | same |
| Asks escalated while their coordinator self-worked | — | counted | counted |
| PSI `some avg10` (slice) | 92% at the census (source not recorded) [M] | — | p95 over a day < 20% |
| Load per core | 9 at the census [M] | — | p95 < 2 |
| Sessions on the busiest account | 12 [M] | — | ≤ the mean + 3 after W5 |

## Review log

Three reviews of rev 0 (fidelity, correctness, architecture) on 2026-10-20. Every finding and its outcome:

| # | Review | Sev. | Finding | Outcome |
|---|---|---|---|---|
| 1 | fidelity | med | D-5370 ruling misquoted (the 10 minutes is D-5370's grace, not the operator's words) | Fixed: §3.1, R3 and In short quote "stop workers at run close" and attribute the 10 minutes to `STOP_DONE_GRACE_MS` |
| 2 | fidelity | med | Unbounded `mail` hold missing from the chain | Fixed: R3, §2.2, §3.1 (stays unbounded, D-5426 unchanged; a bound only if the count shows it matters), W1-1 gate, §8 baseline |
| 3 | fidelity | med | Stale-run liveness stated as measured | Fixed: R1 marked [I]; §1.1 "Not yet confirmed" list; W1-3's first step measures it |
| 4 | fidelity | med | The RAM question was not answered | Fixed: §1.2 "Released is not stopped", and In short |
| 5 | fidelity | med | Who raised the daily cap stated as fact | Fixed: R2, §1.1 and §2.2 say the value is measured and the cause open |
| 6 | fidelity | low | Readings from different passes mixed | Fixed: §1.1 rows name their pass; R1 uses the caps pass's 62 processes; In short says "that morning" |
| 7 | fidelity | low | Busy-account figure overstated | Fixed: R10, §1.1, §3.6 |
| 8 | fidelity | low | PSI 92% versus slice room marked [M]; PSI file unnamed | Fixed: §3.4 marks the comparison [I]; the source is [open]; W3-2 logs the slice's own |
| 9 | fidelity | low | `ccd claude mem --json` cited as existing | Fixed: §3.4 and §4 say CB1c builds `ccd claude mem`, this design adds `--json` |
| 10 | fidelity | low | Report read and `coord/redact.ts` misdescribed | Moot: the report copy (W2-1) is dropped (finding 19); the deferred note carries no such claim |
| 11 | fidelity | low | `.stopped` stamps do not measure hibernation; "ever" unmeasurable | Fixed: §1.1 and R3 read "0 of the 46 current children (no `.stopped`, 0 `.hibernated`)" |
| 12 | fidelity | low | Hold history and `done`/`failed` misstated | Fixed: §3.1 lists D-5427's and the lane's own holds; F5 (b) names `failed` as a change from D-5370 |
| 13 | fidelity | low | Retirement pins from forgotten and planned runs omitted | Fixed: R11, §2.2, §3.1's retirement paragraph |
| 14 | fidelity | low | Consolidation `pwa/` rule misstated | Fixed: §4's PWA paragraph |
| 15 | fidelity | low | Placement claim contradicted #749 on `projectHome` | Fixed: §3.6 says it is added to `projectHome` unlike #749's key, with the fixture |
| 16 | fidelity | low | "Warm place to land" and 114 h misattributed | Fixed: §3.1 and F5 (a) |
| 17 | correctness | high | Sleep inside `dispatchRun` deadlocks on the non-reentrant `CoordMutex` | Fixed: §3.4 refuses at once inside the mutex; one `pressure` pass runs on its own schedule row outside it; no in-request settle; pin with a concurrent close. Architecture finding 31 asked the same; its simpler form (no in-request retry) is adopted |
| 18 | correctness | high | No clean-and-pushed check exists at `ensure` or the `/clear` gate | Fixed: §3.3 and W4 add a `ccd` act-time verb (clean incl. untracked, no stash, head reachable, unmeasured refuses, new branch, old kept); §7 names it; pins added |
| 19 | correctness | med | No binding act for "coordinator as worker" | Fixed: §3.5 and W1-4b, the in-place bind and the `self-dispatch` refusal (merged with finding 30) |
| 20 | correctness | med | Coordinator's checkout and ledger would mix into the wave | Fixed: §3.5's tree rule (a sibling worktree); reason 3 reworded |
| 21 | correctness | med | Self-work runs heavy work on a full box; inline review breaks clause 14 | Fixed: reason 7 (box in distress); capped test workers; reason 1 now says a refused review is never done inline (this overrides architecture finding 30's inline-review predicate) |
| 22 | correctness | med | Headroom ignores RAM and swapped pages; "no limited level" undefined; PSI source unstated | Fixed: §3.4's formula (min with `MemAvailable`, unmeasured cases, slice PSI with box fallback, floor refuses on unmeasured), fixture pins |
| 23 | correctness | med | `unmeasured` falls back to a cap W3-4 deletes | Fixed: §3.4 "Unmeasured", §7, W3-4 conditional on zero unmeasured readings |
| 24 | correctness | med | No reservation for spawns in flight | Fixed: §3.4's reservation R and the 2-a-minute spawn rate in the wake budget's window |
| 25 | correctness | med | 10 s settle cannot outrun PSI; no fleet-wide sleep budget | Fixed: no settle; the `pressure` policy's fleet-wide 3-a-minute budget; pin |
| 26 | correctness | med | W1-2 and W1-3 loosen the only bound before memory frees | Fixed: §5.1 and §5.7 sequence them after W1-1's gate and arming; W1-3's 2-a-minute pin |
| 27 | correctness | low | `pressure` policy could sleep operator sessions at 30 min, and act unarmed | Fixed: §3.1 (non-children keep N; acts only while `admit-live` is armed) |
| 28 | correctness | low | Self-working coordinator delays children's routed asks | Fixed: §3.5 "Routed asks while self-working"; §8 row |
| 29 | architecture | high | Self-work has no server path | Fixed with finding 19 (W1-4b before W1-5; §4 row) |
| 30 | architecture | high (part) | Inline review predicate in `openRun` | Not applied: finding 21 (clause 14's held-out panel) rules inline review out, so no predicate is added |
| 31 | architecture | med | In-dispatch sleep misreads working-state §5.7; no latency budget | Fixed with finding 17 |
| 32 | architecture | med | W2-1 (report copy) defeats W2-2 and is unneeded | Fixed: W2-1 dropped (deferred to the disk programme); `review-report-live` stays a retire claim; §3.2, §4, §5.2, §5.7, §8 updated |
| 33 | architecture | med | W4's server query is a second owner or finds nothing | Fixed: §3.3 reuses through step 6 and `refuseSpentChild`; the `spent` arm defers retirement under F2 (b); same programme only; population measured first; F2's trade-off states the disk cost |
| 34 | architecture | med | The use/claim split applied to `run-done` only | Fixed: new §6 F6 (i recommended, ii stated); §3.0 scope paragraph; F1 (b) and §3.5 corrected; baseline count added |
| 35 | architecture | med | F5 and W1-1 overlap; F5 (b) had no wave; D-5427 is listed as kept | Fixed: F5 (0) confirmation; W1-1 `done` only; W1-1b gated on F5; R3 says consolidation §7 keeps D-5427 |
| 36 | architecture | low | `siblings-open` is not a stop-done hold; `unknown` missing from uses | Fixed: §3.1 and §3.0; W1-1 pin |
| 37 | architecture | low | `decideCaps`, the report read and `capsUsage` misplaced | Fixed: §3.4 and §4 (`capsMeasured`); W1-3's filter in `capsMeasured`; the report read is moot (finding 32) |
| 38 | architecture | low | W1-2 pre-empted F3 | Fixed: W1-2 leaves `dispatchedIn24h` alone; the count change is W3-5 per F3 |
| 39 | architecture | low | R9 decided an operator rejection in the spec | Fixed: R9 defers to new §6 F7 |
| 40 | architecture | low | Two owners of `_mem_headroom`; two sources of 3 GiB; `_swap_target` in scope | Fixed: W3-1 waits for CB1c; H derived from `CLAUDE_HEADROOM_GATE_BYTES`; the key is not added to `_swap_target` |
| 41 | architecture | low | W1-3 adds a liveness consumer K3 must move; W1-1's gate rests on an unmeasured population | Fixed: W1-3 marked temporary, deleted at W3-4, with the zero-code fallback; mail-held count in §1.1 and W1-1's gate |
