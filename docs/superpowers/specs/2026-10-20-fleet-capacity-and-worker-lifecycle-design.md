# Fleet capacity and the worker lifecycle (design)

**Status:** rev 0 (2026-10-20), a draft for the operator's review. It defines no D-numbers; the plan that follows it allocates them. Every operator choice it needs is in §6, each with a recommended option.

**The request (operator, 2026-10-20, verbatim):**

> "a lot of residual worker workspaces end up sticking around and idling for a long time after coordinator spawns them, and then they are rarely reused. Also, our fleet limit caps seem to not do the intended job and simply get in the way. It's some sort of illogical combination of rules that does not achieve the desired effect and instead hamstrings optimal operation."

> "should released sessions be cleaned up faster? do they stop taking up RAM AS SOON as they've been released?"

> "how can we avoid this happening in the future?"

> "why do we keep so many workspaces running when they have absolutely nothing to do"

**The operator's ruling (2026-10-20, verbatim), binding on this design:**

> "if the coordinator is unable to dispatch a workspace to carry out some work, it should do the work in its own workspace, UNLESS there is a very specific reason why it cannot or should not do that"

- **Citations** are to `origin/main` `3cbc76c7d`. They name a function, constant or file; this document cites no line numbers.
- **Measurements** come from four read-only inventories of 2026-10-20 (the caps, the worker lifecycle, prior decisions, and a box census taken at about 10:56 UTC). **[M]** marks a measured figure and **[I]** an inferred one. Run, account and programme names are withheld; programmes are "programme A", accounts "one account" or "lane-a".

**Date:** 2026-10-20 · **Branch:** `docs/fleet-capacity-spec` (cut from `origin/main` `3cbc76c7d`)

**Related:**
- `2026-10-19-ccrc-consolidation-wave-design.md`, the DDD/Clean/SOLID direction. This design is written to fit its K1 (workspace end of life), K3/K4 (alive and idle) and K15 (placement) clusters (§4).
- `2026-10-16-working-state-and-interruptions-design.md` §5.11 (hibernation, D-5242) and its plan's Task 15b (stop-done, D-5370) and Task 17b (D-5427, D-5428). Task 19 (the shadow week, then arming) is pending.
- `2026-08-07-build7-fleet-coordination-design.md` §5 (the two dispatch caps), `2026-08-11-crossrepo-programmes-design.md` §5 ("the constraint is the box"), `2026-09-14-review-runs-design.md` (review runs, D-2803, D-2805, and the rejected `maxResidentSessions`).
- `2026-09-22-child-workspace-reclamation-design.md` §1 (the operator's rules 1-4 of 2026-09-22, rule 3 among them).
- `2026-10-20-fleet-operations-maintenance-mode-and-programme--design.md` §4 (programme-aware placement, #749) and §3 (maintenance mode, #296).
- `2026-10-20-workspace-disk-and-registry-truth-design.md` §2.6 (the `review-report-stale` banner word).
- `2026-10-18-claude-binary-lifecycle-design.md` and its W1 plan, which define `_mem_headroom` (D-5697, CB1c) and `CLAUDE_HEADROOM_GATE_BYTES`.
- `2026-10-17-coordinator-first-routing-design.md`, the routing every question in this design follows.

## In short

- **The box is full of sessions that have nothing to do, and the caps cannot see them.** At the census 60 Claude Code sessions were live, 53 of them idle, holding 12.7 GB of the 14.7 GB their main processes use; memory pressure (PSI `some avg10`) read 92% and load 145 on 16 cores [M]. The concurrency cap read 11 of 14 "running" at the same time.
- **Each rule measures something other than what it protects (§2).** The concurrency cap counts run rows, the daily brake counts every dispatch alike, the finished-worker lane waits 6 hours behind a hold the operator never ruled, the review report pins a whole workspace, and a refusal tells a coordinator to wait for a wake that never comes. Together they hold idle processes alive and refuse the cheap work (resumes, reviews) that would end them.
- **The design (§3) keeps every mechanism and corrects what each one measures:**
  - **(a) Stop early, retire carefully.** A finished worker is put to sleep (hibernated: process stopped, workspace kept, wakeable) about 10 minutes after its run closes, restoring the operator's 2026-10-17 ruling. Sleep is cheap and reversible, so holds that guard a workspace (programme holds, open PRs, unpushed work) guard retirement only, never sleep.
  - **(b) Reviews leave nothing behind.** The review report is copied into the run record when the review closes, so the reviewer can sleep at once; one reviewer per work run is resumed, with a cleared context, for each fix round.
  - **(c) Reuse first.** Dispatch prefers waking a finished worker of the same project over minting a fresh one, within whatever rule 3 allows (§6 F2).
  - **(d) One admission rule on the real resource.** The run-row concurrency cap is replaced by one rule measured on box memory (headroom and pressure), read on the box, with "sleep the longest-idle first, then refuse". Resuming a live session is free; stale runs hold nothing; the daily brake counts only fresh workspaces.
  - **(e) A refusal never strands work.** The coordinator does the work in its own workspace, per the operator's ruling, unless one of six named reasons applies; then the server wakes it when capacity frees.
  - **(f) Placement spreads by live sessions** as one more key in #749's ranking.
  - **(g) Observability:** capacity shown in real terms (headroom, pressure, idle residue), and a pressure alarm through the existing feed funnel.
- **Nothing new is invented where something exists (§4).** Sleep is K1's `decideSleep` with its existing policies plus one; admission reads K3/K4's session reading and the binary lifecycle's `_mem_headroom`; placement is one key in K15/#749's triple; the alarm is K6's `notify`.
- **Migration is smallest first (§5).** W1 is five small PRs that need no new mechanism: restore the 10-minute ruling, stop charging resumes, stop counting stale runs, wake refused coordinators, and the do-it-yourself words. Reviews, memory admission, reuse, placement and the PWA follow.

## 1. The problem in numbers

### 1.1 What the operator sees

The operator's words are the requirement: workers "sticking around and idling for a long time", "rarely reused", caps that "simply get in the way", and "so many workspaces running when they have absolutely nothing to do". Measured on 2026-10-20:

| What | Measured | Source |
|---|---|---|
| Live Claude Code sessions (main processes) | 60, holding 14.7 GB RSS | census 10:56 UTC [M] |
| Of those, idle with a finished turn | 53, holding 12.7 GB | census [M] |
| Idle at least 6 h / at least 24 h | 26 / 12 | census [M] |
| Box memory | 391 MB free; 10.4 GB of about 16 GB swap used | census [M] |
| Memory pressure, PSI `some avg10` | 92% | census [M] |
| Load average | 145 on 16 cores | census [M] |
| Session slice, an hour earlier | 22.8 GB of its 24 GB `MemoryMax` | caps inventory [M] |
| Concurrency cap at the same time | 11 of 14 "running" | `coordinator_state`, `capsUsage` [M] |
| Daily brake | 62 of 64 used; 64 is `CAP_MAX` | `capsUsage` [M] |
| Of the 62 daily dispatches | 43 reviews, 19 work, 0 resumes | runs, last 24 h [M] |
| Child workspaces in the registry | 46: 21 live and held, 21 live with no hold, 4 stopped by hand | registry [M] |
| Review children whose own run is `done` | 25, of which 21 still running | registry joined to runs [M] |
| Reviewers kept per open work run | up to 4 | registry joined to runs [M] |
| Finished workers stopped by the stop-done lane | 0 of 46 children, ever | `.stopped` stamps [M] |
| Hibernated sessions | 0 (`hibernate-live` absent; 117 shadow lines for 14 sessions in 24 h) | registry, journal [M] |
| Work sessions that served more than one run | 19 of 117 (an upper bound on reuse) | closed runs [M] |
| Dispatches refused by a cap, logged | 0 in 7 days (refusals are not logged) | journal [M] |
| Live sessions on the busiest account | 12; the next 9, 8, 8, 7 | registry [M] |

### 1.2 What the numbers say

- **Memory is the binding resource, and idle sessions spend most of it.** 53 of 60 live sessions were idle, and 26 had been idle for more than 6 hours, while the box was swapping and stalled on memory 92% of the time.
- **The caps were not at their limit and still in the way.** The concurrency cap saw 3 free slots on a box with no headroom, and the daily brake was 2 dispatches from refusing everything, mostly because of reviews.
- **Nothing that exists to reclaim idle sessions acted.** The finished-worker lane stopped none; hibernation is unarmed.
- **Nothing was reused.** 0 of 62 dispatches resumed a workspace.

## 2. The root causes, as a causal chain

Each rule below was added for a stated reason. The chain shows what each actually measures and how they combine into the measured state.

### 2.1 The rules, one at a time

**R1. The concurrency cap, `maxConcurrentWorkers`.**
- *Stated intent:* a runaway-coordinator bound at one chokepoint (build7 §5), kept whole-box because "the constraint is the box" (crossrepo §5).
- *What it measures:* run **rows** in `dispatched`, `working` or `unknown` (`CoordStore.capsUsage`, `ACTIVE_RUN_STATES`), fleet-wide. Since D-2803 idle run states are excluded, so a worker parked at `awaiting-review` "gives its slot back" while its process lives on.
- *What it misses:* processes and memory. 11 rows counted against 60 live processes [M].
- *What it counts wrongly:* stale rows. Two final waves sat at `dispatched` for 6 to 8 days and one run at `working` for 153 h; the drift reconciler only reports them [M].
- *Where it is checked:* `dispatchRun` step 2, before the resume-versus-fresh branch, and the advance route when a run re-enters `working` (a send-back). So resuming a live idle worker, which starts no process, is refused exactly like a cold spawn.

**R2. The daily brake, `maxSessionsPerDay`.**
- *Stated intent:* a budget brake on dispatches per rolling 24 h (build7 §5).
- *What it measures:* every dispatch (`dispatchedIn24h`): a fresh spawn, a resume of a warm workspace and a review run cost the same.
- *What follows:* reviews are 69% of it [M], the operator raised it to its fat-finger ceiling `CAP_MAX` (64), and the `CAP_MAX` comment assumes "about twenty live sessions" against 60 measured.

**R3. The finished-worker lane, stop-done (D-5370), changed by D-5427.**
- *Stated intent:* the operator's 2026-10-17 ruling, made after 28 long-idle sessions were stopped by hand: stop a finished run's worker about 10 minutes after its run closes (`STOP_DONE_GRACE_MS`).
- *What D-5427 changed:* Task 17b made the lane compose `ccd hibernate` (a good change: mail and an open screen now wake the worker) and also gave it hibernation's `recent` hold, N = 6 h from the turn marker (`stopDoneVerdict`, `hibernateAfterMs`). Its stated reason is to make the lane a strict subset of hibernation; it does not weigh the delay against the 10-minute ruling, and no new ruling is recorded.
- *What its other holds do:* `held` (any `.hold`, including a programme hold `program:<p> wave:N+1` that a non-final close writes), `not-done` (any run not `done`), and `reviewing` (a review child of a still-open run, "the coordinator may come back to it for a re-review"). Every lingering population matches one of them: non-final producers are `held`, waiting producers are `not-done`, and kept reviewers are `reviewing`. Final children are retired by the close-time reclaim before the lane sees them.
- *Result:* 0 of 46 children stopped [M]. The `reviewing` reason contradicts `openRun`, which refuses a `sessionId` on every review run: nothing ever comes back to a review child.

**R4. Hibernation (D-5242).**
- *Stated intent:* sleep any session idle for N hours (6 h default), shadow first, armed by the operator after a shadow week (Task 19).
- *What it does today:* nothing. `hibernate-live` is absent and nothing in the tree writes it; 117 shadow lines named 14 sessions in a day [M]. Even armed, its `run-worker` hold keeps every producer with a non-terminal run, `awaiting-review` included, awake.

**R5. The review report pins the reviewer's workspace.**
- *Stated intent:* the coordinator cites the report by path in fix-round mail, so the child-reclaim sweep holds a review child `review-report-live` until the reviewed work run closes (`childReclaimSweepVerdict`); the disk spec adds only a 7-day banner word.
- *Combined with R6:* every fix round mints another reviewer, and each is kept until the work run closes. Up to 4 per work run [M].

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
- *What exists:* per-pane scope limits (`ccd-cap-scopes`: `MemoryHigh` 8G, `MemoryMax` 12G) and the slice's `MemoryMax` 24G. They throttle or kill; they never refuse a spawn. `wakeBudget.ts` says it outright: `ccd`'s spawn path has no concurrency control of its own. `_mem_headroom` exists only in the binary-lifecycle plan (CB1c), for rolls.
- *The earlier rejection, and why it does not apply here:* the operator rejected a `maxResidentSessions` cap (review-runs §3) because `coord.db` sees a fraction of resident sessions (23% then) and an aggregate memory cap "froze the fleet three times". Both reasons are about *counting sessions in the server* and *capping memory in a cgroup*. §3(d) does neither: it measures the box itself, and its refusal sends work to an already-live coordinator instead of stalling it (§3(e)).

**R10. Placement ignores how many sessions an account carries.**
- `_ws_least_loaded` and its server mirror `projectHome` rank only by `_limit_score` (the 5 h and 7 d usage), which barely moves in minutes. Three reviewers dispatched within 20 minutes landed on the account already carrying 12 live sessions [M]. #749 adds a programme-member key but not a live-session one.

### 2.2 How they combine

```
R7 rule 3 ──▶ every PR-producing wave mints a fresh child ─┐
R6 fresh reviewer per round ──▶ 1-4 reviewers per work run ─┼─▶ many fresh workspaces per day
                                                            │       │
R2 brake counts every dispatch alike ◀──────────────────────┘       │
   (69% reviews, 0 resumes) ──▶ brake raised to CAP_MAX             │
                                                                    ▼
R5 report pins the reviewer ─┐                          many finished, idle processes
R3 stop-done: 6 h `recent`,  ├─▶ none of them is ever put to sleep ──┐
   `held`/`not-done`/`reviewing` │                                    │
R4 hibernation unarmed ──────┘                                       ▼
                                                     memory full, PSI 92%, load 145
R1 counts run rows, not processes ──▶ sees free slots on a full box  │
R9 nothing admits by memory ─────────▶ dispatch keeps spawning ──────┤
R1 also counts stale rows and charges resumes ──▶ refuses the cheap path (resume, send-back)
R8 refusal has no wake ──▶ the refused coordinator and its programme stall silently
R10 placement blind to counts ──▶ the spawns that happen pile onto one account
```

The common defect: **the rules guard the wrong boundary.** Holds that exist to protect a *workspace* (its branch, its PR, its report, its next wave) are applied to the *process*, which is cheap to stop and restart. Caps that exist to protect the *box* count *rows*. And the one decision that would end the waste, sleep, is either delayed by a hold the operator never ruled or unarmed.

## 3. Design

### 3.0 Two acts, two bars

The design separates two acts that today share holds:

| Act | What it frees | Reversible? | Who decides (K1) | Bar |
|---|---|---|---|---|
| **Sleep** (`ccd hibernate`) | the process: RAM, CPU, tool children | yes: mail, an open screen, a dispatch or the operator wakes it through `ensure` | `decideSleep(facts, policy)` | **low:** the session is idle and nothing is *using* it right now |
| **Retire** (`ws-reclaim`, `ws-reap`, `ws-expire`) | the workspace: worktree, branch, disk, registry row | no | `decideRetire(facts, reason)` | **high:** no open PR, no unpushed work, no live review need, no open run naming it, the reason's evidence |

A **use** blocks sleep: a turn running, background work, a viewer with the screen open (D-5242's open claim), a terminal attached, scheduled crons, mail not yet acknowledged (D-5426), an open run in which the session is the *active* worker (`dispatched` or `working`). A **claim on the workspace** blocks retirement only: a programme hold, a `run:` hold, an open PR, unpushed commits, a report the coordinator still cites. Sleeping a held workspace keeps everything the hold protects, because hibernation keeps the worktree, the branch, the transcript (its uuid) and the registry row, and `ccd-tmp-sweep` already counts a hibernated row as live.

### 3.1 (a) Lifecycle: finished workers sleep within minutes

**The ruling restored.** The operator's 2026-10-17 ruling (D-5370) was "stop a finished worker about 10 minutes after its run closes". D-5427 kept the lane but put it behind hibernation's 6 h `recent` hold without a new ruling. This design restores the ruling's timing and keeps D-5427's act:

- The `run-done` sleep policy (today's stop-done lane) composes `ccd hibernate` as D-5427 made it, under its own switches (`stop-done-disabled`, `hibernate-disabled`, `reclaim-paused`), at its own cadence (60 s, at most 3 acts a pass, D-5428's act-time re-measure on the coordination serialiser).
- Its clock is the run's close: it acts once the worker's newest run has been terminal for `STOP_DONE_GRACE_MS` (10 min) **and** the turn marker has been quiet for the same 10 minutes. It no longer reads N. Every other hibernation hold it absorbed in D-5427 stays (`opted-out`, `scheduled`, `viewer`, `attached`, `marker-background`, `mail`).
- **Holds that move from sleep to retire:** `held` for a programme hold or a `run:` hold whose run is terminal; `reviewing` (the report survives sleep; §3.2 removes the need for the worktree entirely); `siblings-open` for a planned, never-dispatched run that names the session (it is not a use). A `.hold` written by the operator by hand stays a sleep hold.
- **Which states count as finished** is §6 F5: at the worker's run close (`done`, `failed`), or also at `awaiting-review` after a longer grace. The recommendation is to include `awaiting-review` at 30 minutes: a send-back is mail or a dispatch, and both wake the worker through `ensure`, so the "warm place to land" (review-runs §1) stays, minus the process.

**General hibernation (any idle session).** The `idle-hours` policy (D-5242) is unchanged in its holds and contract. Two things change:
- It is armed. Task 19 is the operator's act; the operator asked for it on 2026-10-20, pending a network path to the box. The shadow lines already exist (117 a day).
- N is §6 F1. The recommendation is 2 hours: past the one-hour prompt-cache lifetime that D-5242 chose N by, and short enough that a coordinator idle between waves does not hold memory overnight. A coordinator asleep wakes on its next mail through the wake budget, as D-5242 already specifies.

**A pressure policy (new row, same decider).** `decideSleep(facts, 'pressure')` answers the admission rule's "sleep the longest-idle first" (§3.4). It takes every `idle-hours` hold except `recent`, which it replaces with a floor of 30 minutes idle, orders candidates by idle age (longest first), and acts only when the admission rule asks it to or the pressure alarm is raised (§3.7). Its own switch (`pressure-sleep-disabled`), cadence (on demand, plus at most once a minute under alarm) and cap (3 acts a call) are rows in K12's `SWITCHES` and K11's `LANE_SCHEDULE`.

**Retirement keeps its high bar.** `decideRetire`'s reasons and evidence are unchanged (child reclamation, the PR ledger, archive expiry). What changes is only that a review child stops being held `review-report-live` once its report is copied (§3.2). Retiring a spent child at its run's close (close-time reclaim) already happens within minutes and is kept.

### 3.2 (b) Reviews: copy the report out, reuse one reviewer

**Copy the report at close.** When `closeRun` accepts a review run's fingerprint (`reviewedTip`, `report`), the server already reads the report to check `report-unreadable`. It now copies the bytes into the run record: a `reviewReport` row in `coord.db` keyed by the review run id (text, capped at 1 MiB, redacted by `coord/redact.ts` as any other stored text is), and serves it at `GET /api/runs/:id/report`. The coordinator's fix-round mail cites the run id instead of the path; the reviewer's absolute path stays in the fingerprint for audit.

- *Why the run record and not the coordinator's tree:* the coordinator may be in another project (a crossing), may be asleep, and its tree is not a durable store; the run record already holds the fingerprint, survives the reviewer's retirement, and is what the PWA's run board reads.
- *What it frees:* the child-reclaim sweep's `review-report-live` hold no longer applies once the copy exists, and the `run-done` policy sleeps the reviewer 10 minutes after review-done. Measured, that is 21 running review children [M] that would have been asleep.
- *Skew:* an older coordinator skill that still cites the path keeps working while the worktree exists; the hold is dropped only for runs whose copy exists.

**One reviewer per work run, resumed per round.** A fix round opens its review run with the previous reviewer's `sessionId` when that reviewer reviewed the same work run, and dispatch resumes it (waking it if asleep) with `/clear`, as the resume arm already does for workers (D-5238's live-idle gate).

- *Resume, not a fresh one, and why it keeps the review-runs design's reason:* the reason for "never reused" was that "a report and the tip it describes are always one pair". That pair is per review **run**: each round is still its own run with its own `reviewedTip` and its own report, and `stale-review` still refuses a tip that moved. Only the session is reused.
- *Independence:* `/clear` gives the round a fresh context, so the reviewer does not anchor on its previous findings unless the brief hands them over. The coordinator's brief may hand them over deliberately ("check these findings were fixed"); that is the coordinator's choice per round.
- *What `openRun` accepts:* a `sessionId` on a review run only when that session is the reviewer of an earlier review run of the same `reviews` target; anything else stays refused with today's words. The rule is one predicate in `openRun`, held by a test with the refusals.
- *What it saves:* rounds 2 to 4 of a work run mint nothing and charge nothing (§3.4: a resume is free, a wake goes through the wake budget).

### 3.3 (c) Reuse: wake a finished worker before minting one

**Dispatch looks for a sleeping or idle finished worker first.** When a work run opens without a `sessionId`, dispatch asks one store query (C5's `bindingsOf` plus K3's `readSession`) for a candidate:
- same project; a `.child`; its newest run terminal; no open run naming it; not archived, not retired;
- allowed by rule 3 as ruled in §6 F2;
- its tree clean and pushed (the act-time check `ccd ensure` and the resume `/clear` gate already make);
- preferring, in order: a live idle one (free), then a hibernated one (one wake), oldest finished first.

If one qualifies, the run binds it and dispatch resumes it with `/clear` and the brief, after resetting its branch as the reuse option ruled in F2 requires. If none qualifies, dispatch mints as today. The coordinator may still name a `sessionId` or force a fresh spawn (`fresh: true`); the server's choice is a default, never an override of the coordinator's.

**Rule 3 is the operator's.** Under rule 3 as written, only a producer that opened no PR qualifies, which is a small population (§1.1). §6 F2 lays out the options; the recommended one keeps rule 3's purpose (one PR per child at a time, cleaned up after) while letting a child whose PR has merged or closed take the programme's next wave.

### 3.4 (d) Capacity: one admission rule on box memory

**One rule replaces the concurrency cap.** A dispatch that would start a process (a fresh spawn or a wake of a sleeping session) is admitted only when the box has room:

```
admit  ⇔  headroom ≥ H  ∧  pressure < P
headroom = _mem_headroom          (min over the session slice and each ancestor up to the user tree
                                   of memory.max − that level's own anon; CB1c, D-5697)
pressure = the session slice's memory.pressure, "some avg10"   (PSI, cgroup v2)
```

- **Why these two.** Headroom answers "is there room for one more session" in the cgroup that will kill it if not (the slice's `MemoryMax`), and it is the figure the binary lifecycle already gates rolls on (`CLAUDE_HEADROOM_GATE_BYTES`). It reads `anon`, not `memory.current`, so page cache does not read as full (the CB1c plan's stop rule). Pressure answers "is the box already stalling", which headroom misses when swap absorbs the shortfall: the census had 92% pressure while the slice still had room under its maximum [M]. H and P are §6 F4 (recommended: H = 3 GiB, P = 20%).
- **Where it is measured.** On the box, by `ccd`: `_mem_headroom` (landed by CB1c, or by this programme's W3 if CB1c has not; one definition either way) and a new `_mem_pressure`, both behind the read-only `ccd claude mem --json`, which gains a `psiSome10` field. The server reads it fresh at the dispatch (through the agent, as every `ccd` call goes) and on the node inventory sweep's cadence for display.
- **Where it is decided.** `decideAdmission(reading, policy)` is a pure L1 function in C5 (Coordination), beside `decideCaps` in `coord/caps.ts`, which it replaces in the dispatch path.
- **Where it is enforced at the act.** `ccd ws-add --child` re-reads the same two figures inside its own lock and refuses `no-headroom` below a hard floor (H/2, never configurable above H). This is the TOCTOU guard (consolidation K2's act-time re-check), and it holds even for a spawn that reaches `ccd` without the server's check. It applies to dispatched children only.
- **How it survives the server being down.** The figures live on the box (cgroup files); nothing is counted in server memory (unlike today's wake-budget window), so a server restart forgets nothing. H, P and the floor are box markers (`$REG/admit-headroom-gib`, `$REG/admit-pressure-pct`), read by `ccd` and by the server. With the server down nothing dispatches, and `ccd`'s own floor still guards `ws-add --child`.
- **What it never touches.** Account switching and the auto-swap are never blocked: `_auto_swap_check`, `_swap_idle_gate`, `_swap_target`, `cmd_swap`, `swap-self` and the swap routes read neither figure, and the consolidation spec's swap pin is extended with that row. The operator's own new sessions (the PWA's New session, `cc`, `ccd ws-add` without `--child`) are never refused; the PWA shows the reading beside the button (§3.7). An asked wake (the operator's open or Wake) is never refused, as D-5242 rules.

**Ordering: sleep the longest-idle first, then refuse.** When admission fails, dispatch does not refuse at once:

1. It asks the `pressure` sleep policy for up to 3 candidates (longest idle first, every `idle-hours` hold kept, 30-minute floor).
2. It hibernates them through the sleep executor (which takes the coordination serialiser itself; dispatch has not taken the run mutex yet, as §5.7 of the working-state design already arranges for `worker-starting`).
3. It re-reads the figures after a settle of up to 10 s.
4. It admits if the rule now holds, and otherwise refuses `capacity` with the reading (§3.5).

**What is free and what is charged.**

| Dispatch kind | Admission | Wake budget | Daily brake |
|---|---|---|---|
| Resume of a **live** session (worker or reviewer) | free | — | free |
| Send-back (advance to `working`) of a live worker | free | — | free |
| Wake of a **hibernated** session | admitted by memory | counted as an asked wake (never refused by the budget, D-5242) | free |
| Fresh spawn (`ws-add --child`) | admitted by memory | — | counted |

Today all four are charged alike; a resume and a send-back start no process.

**Stale runs never hold capacity.** With admission on memory, no run row is counted at all. Until W3 lands, W1 changes the concurrency count: a run counts only while its worker session reads alive in K3's `readSession` and is busy, or was dispatched within the last 2 hours. A `dispatched`, `working` or `unknown` run whose worker is dead, stopped, asleep, archived or idle longer than that is not counted, and the existing drift words (`run-quiet`, `claimant-gone`) name it on the banner so the coordinator closes or abandons it. Nothing closes a run automatically; that stays the coordinator's act.

**The daily brake.** Its purpose (a budget brake against a runaway coordinator, build7 §5) is not about memory, so the admission rule does not replace it. It changes to count only fresh workspaces (`resumed = 0` and not a wake), with `CAP_MAX` raised so the operator's dial has room. Whether it stays, at what ceiling, or goes is §6 F3.

**Per-programme fairness.** No quota is added now. When capacity is short, the wake-on-free queue (§3.5) is served round-robin by programme, oldest refusal first within a programme, so one programme cannot starve the others. A per-programme share is reconsidered only if §8's refusal counts show one programme taking most of the box.

### 3.5 (e) A refusal never strands work

**The coordinator does the work itself.** Per the operator's ruling, a coordinator whose dispatch is refused (`capacity`, `cap-daily`, or today's `cap-concurrency` until W3) does that wave in its own workspace, now, on a branch of its own, following the same worker skill clauses it would brief a worker with (one PR, wave-done evidence, no merge without review). The wave's run stays open with the coordinator as its worker (`sessionId` = the coordinator), so the run board, the review run and close all work unchanged.

**The very specific reasons it must not, and then waits.** It waits only when one of these applies, and it names the reason in its status:

1. **Review of its own work.** The refused dispatch is a review of a wave the coordinator itself produced. A reviewer must not review its own work. (Reviewing a *producer's* wave inline is allowed: it is what build7 did before review runs, and the report is filed as the review run's report.)
2. **Wrong repository.** The wave is a crossing into a project the coordinator's workspace does not sit in (`project-mismatch`); its own worktree cannot carry that branch.
3. **Its workspace is mid-wave.** It holds uncommitted or unpushed work of another wave, or an open PR from its own branch that the new work would mix into. It finishes or parks that first, then does the refused wave serially.
4. **Forbidden to sessions.** The work needs an act the ccrc SAFETY rules forbid to sessions (`ws-*` destructive verbs, unit or tmux touches, credentialed operator acts) or is marked operator-only in the plan.
5. **The plan says parallel-only.** The plan marks the wave as needing an isolated workspace (for example, it runs the full suite while another wave does, or it needs a second account's limits), and says why.
6. **The fleet is paused.** The refusal is `paused` or maintenance mode (#296), not capacity. That is the operator's stop; the coordinator reports and waits.

**The refusal words say so.** The `capacity` refusal's detail reads, in substance: "No room for a new workspace: headroom 1.2 GiB (needs 3 GiB), pressure 34% (limit 20%); 3 idle sessions were put to sleep and it was not enough. Do this wave in your own workspace now, unless one of the reasons in the coordinator skill applies; if one does, end your turn and the server will mail you when there is room." The coordinator skill's "When something is wrong" entry for a cap refusal is rewritten to the ruling and the six reasons, replacing "wait to be woken".

**The server wakes waiting coordinators.** A refused dispatch stamps its run (`admissionWaitSince`, additive). When admission would pass with a margin (headroom ≥ H + 1 GiB and pressure < P/2, so one freed session does not wake ten coordinators), the server sends system mail (`queueSystemMail`, the kickoff path) to the oldest waiting coordinator per programme, round-robin, at most 2 a minute (the wake budget's rate). A coordinator that is asleep wakes on that mail through the wake budget, as any mail does. For `cap-daily`, the wake is sent when the rolling window frees a slot. Each refusal and each wake is logged (one journal line and one feed row through K6's funnel, with a `dedupeKey` per run), so §8 can count them.

### 3.6 (f) Placement spreads by live sessions

#749 makes the placement key a triple: tier, then programme members on the lane, then the walk's existing order. This design adds one key between the second and third: **live sessions on the lane**, fewest first.

- *Counted by `ccd` from local files only:* registry rows whose `.wrapper` is the lane and which are not stopped, archived or hibernated (a hibernated member counts for the programme spread, as #749 says, but not as live load).
- *Where it applies:* `_ws_least_loaded` (a new child's home) and `_swap_target`'s candidate walk, inside #749's tiers and after every filter, exactly where #749's key applies. It never removes a candidate, never moves a running session, and never blocks a swap; with every count equal, the order is #749's.
- *Server mirror:* `projectHome` (K15's single owner for new-session suggestions) gains the same key, held to `_ws_least_loaded` by `projected-home.test`.
- *Why a key and not a per-account cap:* a cap would refuse; the operator ruled that switching is never blocked, and placement is a preference. The measured defect (three spawns in 20 minutes on the account with 12 live) is an ordering one.

### 3.7 (g) Observability

**What the PWA shows.** Capacity in real terms, replacing the two run-row counters in `CapsControl`:
- **The glance (fleet card / header strip):** one line, e.g. "Memory: tight · 2.1 GiB free · 29 idle". Words: `ok`, `tight` (admission would sleep before admitting), `full` (admission refuses), `unmeasured`.
- **The detail (header sheet, a superset of the glance):** headroom against H, pressure against P, live sessions split busy / idle / asleep, **idle residue** (live sessions idle with no binding, their count and RSS), waiting coordinators (refused runs and since when), the daily brake's fresh-workspace count, and the last refusals and wakes. The operator's existing actions stay; one is added: "Sleep idle now", which runs the `pressure` policy once (an operator act, bounded by its per-call cap).
- **Each session row:** an idle session with no binding reads "idle 7h · no work" so residue is visible where it lives.
- **Widths and skins:** judged at 360, 390, 1280 and 1920 px in both skins and both themes, as every PWA change is.

**The pressure alarm.** One feed event through K6's `notify` funnel, `fleet-pressure`, raised when pressure ≥ 50% for 5 minutes or headroom < H/2, cleared when both recover for 5 minutes, deduplicated by key, with one push on raise. While it is raised, the `pressure` sleep policy runs at most once a minute. The reading comes from the node inventory sweep; a reading that fails for 3 sweeps raises `fleet-pressure-unmeasured` instead of guessing.

## 4. How this maps onto the consolidation clusters and lanes

Nothing here is a parallel mechanism. Every change lands in an owner the consolidation spec already names, and where that cluster's wave has not started, the change lands in today's code in the shape the cluster will absorb.

| This design | Owner (consolidation spec) | Reuses | New |
|---|---|---|---|
| (a) finished-worker sleep at 10 min | K1 `decideSleep`, policy `run-done` (today `stopDone.ts`) | the lane, its switches, D-5427's `ccd hibernate`, D-5428's act-time re-measure | the clock reads the run close, not N; four holds move to `decideRetire` |
| (a) general hibernation | K1 policy `idle-hours` (today `hibernateSweep.ts`) | all of D-5242 | arming (operator act); N per F1 |
| (a)/(d) pressure sleep | K1, a third policy row `pressure` | `hibernateVerdict`'s holds, the sleep executor | one policy row: floor, ordering, switch |
| (a) sleep versus retire holds | K1's two deciders; C5's `bindingsOf` | today's hold vocabulary | the split of holds into "use" and "claim" |
| (b) report copy-out | C5 (runs and their records); K1's `child-spent` reason | `closeRun`'s existing report read, `coord/redact.ts` | a `reviewReport` row and one GET |
| (b) reviewer reuse | C5 `openRun`, dispatch's resume arm | the resume arm, `/clear`, D-5238 | one `openRun` predicate |
| (c) reuse first | C5 dispatch; K3 `readSession`; C5 `bindingsOf` | the resume arm, `refuseSpentChild` | one candidate query |
| (d) admission | C5 `decideAdmission` beside `decideCaps`; C1 for the reading | CB1c's `_mem_headroom` and `ccd claude mem`; the node inventory sweep | `_mem_pressure`; the dispatch step; `ccd`'s floor |
| (d) resume free, stale not counted | C5 `capsUsage` / `capsMeasured` | K3 `readSession`, K4 `TurnReading` | the count predicate |
| (e) wake waiting coordinators | C5; K6 `notify`; K11 `LANE_SCHEDULE` | `queueSystemMail`, the wake budget | `admissionWaitSince`, one schedule row |
| (f) live-session key | K15; #749's triple in `_ws_least_loaded`, `_swap_target`, `projectHome` | `_limit_score`, #749's tiers | one key |
| (g) alarm and display | K6 `notify`; K14 (PWA, one owner per fact) | the feed, `CapsControl` | `fleet-pressure` event; the capacity fact on the fleet frame |
| switches | K12 `SWITCHES` | — | `pressure-sleep-disabled`, `admit-headroom-gib`, `admit-pressure-pct` |

**Fit with the consolidation waves.** The consolidation W4 (K1) waits for hibernation's Task 19 and merges stop-done and hibernation without changing behaviour. This design's W1-1 is a **behaviour commit** in that spec's sense (§5.1 rule 1b): its own commit, characterization assertions changed only there, before/after rows in the PR body, citing the operator's 2026-10-17 ruling. If consolidation W4 lands first, W1-1 is one row's clock in `decideSleep`; if W1-1 lands first, W4's characterization pins the restored timing. The same holds for the `pressure` row. The PWA wave (W6 here) follows the consolidation spec's rule that no `pwa/` file changes before the skins chain has landed, or it is line-disjoint from it.

**Lanes.** W1 is server and skill text (server lane). W3's `ccd` half deploys agent-first, as every release does. No wave adds a herd restart: the `run-done` and `pressure` policies act at most 3 a pass, and wakes stay inside the wake budget.

## 5. Migration waves, smallest first

Every wave lands its characterization pins first, keeps behaviour changes in their own commits, and rolls back by revert. Each W1 item is a separate PR.

### 5.1 W1: quick wins (server and skill text; no new mechanism)

- **W1-1. Restore the 10-minute ruling for finished workers.** `stopDoneVerdict`: the clock is the run's close plus `STOP_DONE_GRACE_MS` and 10 minutes of turn-marker quiet, not N; `reviewing`, programme holds, terminal-run `run:` holds and planned-run siblings stop holding sleep. Pins: one case per moved hold; "a programme-held finished child sleeps at 10 min"; "an operator `.hold` still holds"; the D-5427 shared-hold words unchanged. *Gate:* after deploy, the `run-done` lane's feed shows finished children asleep within 15 minutes of close.
- **W1-2. Resumes are not charged.** `dispatchRun` takes the resume-versus-fresh branch before the caps and skips both caps for a resume of a live session; the advance route stops cap-checking a send-back of a live worker; `dispatchedIn24h` counts `resumed = 0` only. Pins: a resume at a full cap dispatches; a fresh spawn at a full cap refuses as today.
- **W1-3. Stale runs are not counted.** `capsUsage().running` counts a run only while its worker reads alive and busy, or was dispatched within 2 hours (K3/K4 readings; until W2 of the consolidation lands, today's `liveStatus` and turn verdict). Pins: a 6-day `dispatched` run with a dead worker is not counted; a busy one is.
- **W1-4. Wake refused coordinators.** `admissionWaitSince` on a refused run; a schedule row that mails the oldest waiter per programme when the cap frees (with today's caps, until W3), at most 2 a minute; one journal line and one feed row per refusal and per wake. Pins: a refusal followed by a freed slot sends one mail; two programmes waiting are served alternately.
- **W1-5. The do-it-yourself ruling in words.** The refusal details for `cap-concurrency` and `cap-daily` (and later `capacity`) carry the §3.5 text; the coordinator skill's "When something is wrong" entry and the crossing paragraph that says "wait to be woken" are rewritten to the ruling with the six reasons. Lands after W1-4, so the words never promise a wake that does not exist.

### 5.2 W2: the review lifecycle

- **W2-1.** Copy the report at review close (`reviewReport`, `GET /api/runs/:id/report`); the coordinator skill cites the run id; the child-reclaim sweep drops `review-report-live` for a run with a copy.
- **W2-2.** One reviewer per work run: `openRun` accepts a `sessionId` on a review run only for the earlier reviewer of the same target; the coordinator skill's fix-round step names it; the reviewer skill notes that a round starts from `/clear`.

### 5.3 W3: memory admission

- **W3-1.** `_mem_headroom` (from CB1c if landed) and `_mem_pressure` behind `ccd claude mem --json`; the node inventory sweep stores them. Read-only: shown, decides nothing.
- **W3-2.** `decideAdmission` and the `pressure` sleep policy, in **shadow**: every dispatch logs what admission would have answered beside what the caps answered, for a week.
- **W3-3.** Arm admission (an operator act, `$REG/admit-live`); `capacity` refusal words; `ccd ws-add --child`'s floor. The concurrency cap stays as a dial the operator can still set, but at `CAP_MAX` by default, so it decides nothing.
- **W3-4.** After two releases with admission as the only reader, remove the concurrency cap's dispatch check and its field (the wire change's rollback horizon, consolidation §5.1 rule 4).
- **W3-5.** The daily brake per §6 F3.

### 5.4 W4: reuse first

- Dispatch's candidate query (§3.3) and the branch reset that §6 F2's ruled option needs. Waits for F2.

### 5.5 W5: placement

- The live-session key in `_ws_least_loaded`, `_swap_target` and `projectHome`. Rides #749's FP8 (the same walks, the same parity fixture). Waits for #749's ccd tasks.

### 5.6 W6: PWA

- The capacity glance and detail, idle residue on rows, "Sleep idle now", the `fleet-pressure` alarm's feed row. Waits for the skins chain's screens (or is line-disjoint) and judges every width, skin and theme.

### 5.7 Sequencing at a glance

```
W1-1 ─┐
W1-2 ─┼─▶ (each independent; W1-5 after W1-4)
W1-3 ─┤
W1-4 ─▶ W1-5
W2-1 ─▶ W2-2
CB1c ─▶ W3-1 ─▶ W3-2 (shadow week) ─▶ W3-3 (operator arms) ─▶ W3-4 ─▶ W3-5 (per F3)
F2 ruled ─▶ W4
#749 FP8 ─▶ W5
skins chain screens ─▶ W6
Task 19 (operator arms hibernation) runs beside all of this
```

## 6. Operator decisions

Each decision has options with a recommended one and its trade-off. None is ruled yet.

**F1. N for general hibernation (any idle session).**
- (a) 6 h, as built (D-5242). Least change; leaves 26 sessions [M] idle for a working day before sleep.
- (b) **Recommended.** 2 h. Past the one-hour prompt-cache lifetime D-5242 reasons from, so a wake costs nothing idling would have kept; coordinators idle between waves sleep and wake on mail. Trade-off: more wakes, each a cold `--resume` (seconds) inside the wake budget.
- (c) 1 h. Most memory back; a coordinator that checks in hourly would wake every time.

**F2. Rule 3, one PR per child.**
- (a) Keep rule 3 as written. Reuse (§3.3) then covers only producers that opened no PR. Trade-off: almost every wave still mints a workspace (disk, a cold start, the brake).
- (b) **Recommended.** One *open* PR per child at a time. A child whose PR has merged or closed may take its programme's next wave in the same project, after its branch is reset to a fresh branch from `origin/main` and its context cleared; otherwise it is retired as today. Keeps rule 3's purpose (a child never carries two PRs at once; finished children are cleaned up) and its letter for children not reused. Trade-off: it changes the operator's own rule, and a reused child's tree carries build caches from the previous wave (cheaper, and occasionally stale).
- (c) Drop rule 3. A child serves its programme until the programme ends. Most reuse; workspaces live as long as programmes, which is what rule 1 was written against.

**F3. The daily brake.**
- (a) **Recommended.** Keep it, counting only fresh workspaces; default 64, `CAP_MAX` raised to 256. Keeps a runaway-coordinator brake that memory admission does not provide (a coordinator could spawn and finish workers all day within memory). Trade-off: one more dial to explain.
- (b) Remove it; memory admission and the accounts' own limits bound the fleet. Simplest; nothing bounds a coordinator that loops on cheap waves.
- (c) Keep it counting every dispatch, raise `CAP_MAX`. Smallest change; still charges reviews and resumes.

**F4. The admission thresholds.**
- (a) **Recommended.** H = 3 GiB of `_mem_headroom` (the roll gate's figure, one constant family), P = 20% PSI `some avg10`, floor H/2. Trade-off: chosen from one day's census; W3-2's shadow week checks them before arming.
- (b) H = 4 GiB, P = 10%. More conservative; more coordinators do their own work.
- (c) Headroom only, no pressure. Simpler; misses the swap-absorbed stall the census measured.

**F5. When a finished worker sleeps.**
- (a) At its run's close (`done` or `failed`) plus 10 minutes. Restores D-5370 exactly. Leaves producers at `awaiting-review` awake (10 measured, up to 114 h [M]).
- (b) **Recommended.** (a), and also a producer parked at `awaiting-review`, `merging` or `closing` after 30 minutes idle. A send-back or a merge step wakes it through `ensure` or mail. Trade-off: a send-back costs a cold resume instead of landing in a live process.
- (c) At release: when the workspace loses its last binding (no open run, no hold). Waits for the coordinator to close the work run, which is unbounded today (§2.1 R3); recommended against.

## 7. Risks and rollback

| Risk | Guard | Rollback |
|---|---|---|
| Sleeping a session someone is about to use | every D-5242 use-hold stays (viewer, attached, mail, scheduled, background); D-5428's act-time re-measure; a wake is one `ensure` | `stop-done-disabled` / `pressure-sleep-disabled`; revert W1-1 |
| A wake herd after many sleeps | the wake budget (2 a minute) for automatic wakes; the wake-on-free queue at 2 a minute with a margin; no wave adds a restart | `hibernate-disabled` |
| Admission refusing on a bad reading | shadow week (W3-2); `unmeasured` never refuses (it falls back to today's caps); `ccd`'s floor only below H/2 | remove `$REG/admit-live` (no deploy) |
| The coordinator doing a wave itself loses its programme context | the six reasons; the run stays open with the coordinator as worker, so compaction-restore and the run board carry state | the coordinator can still wait (reason 5 if the plan says so) |
| Account switching blocked by mistake | the swap path reads neither figure; the consolidation swap pin gains a row for it | revert |
| A reused child (F2 b) carries stale state | branch reset from `origin/main`, `/clear`, the dirty-tree check at `ensure` | `fresh: true` per run; revert W4 |
| The report copy holds a secret | `coord/redact.ts` on store, the existing boundary; 1 MiB cap | revert W2-1; the worktree path still works while kept |
| Losing the earlier lesson ("an aggregate cap froze the fleet") | admission refuses only dispatched children and routes the work to a live coordinator; it never caps a cgroup and never refuses an operator spawn, a resume or a swap | `admit-live` off |

**Bound rulings, kept:** account switching and the auto-swap are never blocked; no herd restarts; hibernation's contract (wake through `ensure`, the wake budget, the presence contract); coordinator-first routing; improve what exists first (every part grows out of a mechanism named in §4); a card is a glance and its header a superset; every width, skin and theme.

## 8. Measures of success

Measured on the box before W1 and after each wave, the same queries as §1.1:

| Measure | Baseline (2026-10-20) | Target after W1 | Target after W3 |
|---|---|---|---|
| Live sessions idle with no binding | 21 children [M]; 53 idle overall | ≤ 5 children, none older than 30 min after close | ≤ 5 across the fleet beyond N |
| RSS held by idle residue | 12.7 GB [M] | < 5 GB | < 3 GB |
| Reviewers alive per closed review | 21 of 25 [M] | 0 after 15 min | 0 after 15 min, one session per work run |
| Resumes per dispatch | 0 of 62 [M] | ≥ 30% of work dispatches after W2/W4 | — |
| Fresh workspaces per day | 62 [M] | — | ≤ work waves + one reviewer each |
| Refusals, and refusals with no follow-up | unlogged [M] | logged; 0 refusals without self-work or a wake within 1 h | same |
| PSI `some avg10` | 92% at the census [M] | — | p95 over a day < 20% |
| Load per core | 9 at the census [M] | — | p95 < 2 |
| Sessions on the busiest account | 12 [M] | — | ≤ the mean + 3 after W5 |
