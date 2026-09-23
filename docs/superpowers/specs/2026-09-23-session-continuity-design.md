# Session continuity — delegated work, swaps, background processes and operator state survive a restart — design

**Status:** design approved in the brainstorm by the operator 2026-09-23 (rulings in §3); rev 2 after a six-lens
adversarial review (all surviving findings applied) and a rev-3 verification pass; rev 4 records the operator's
rulings on the written spec (C9–C11, C13, C14; §11 items 1–5 ruled 2026-09-23, item 6 found at plan time and open) and the measurements behind
them; rev 5 reconciles it with its first wave plans, 2026-09-24 ·
**Date:** 2026-09-23 ·
**Branch:** `ws/enhance-ccrc-for-parallel-agents` (based on `origin/main` `bbb5e714`) ·
**Companion:** `2026-09-23-landing-order-and-main-churn-design.md`. Its stage 5 needs this spec's stage 1; this
spec's stage 5 appends its skill clauses after that spec's stage 1 (§10).
**Parents — extended, and amended where §3 says:** `2026-09-09-post-swap-redrive-design.md` (R1–R5),
`2026-09-10-limit-recovery-followups-design.md`, `2026-08-28-limit-park-and-wake-design.md` (non-goal "reviving
anything"; §7 keystrokes default-off; R4 box-wide release lock, designed and not yet shipped),
`2026-09-14-effort-model-routing-design.md` (the route record), `2026-09-09-graphify-compaction-card-design.md`
(the session-start injection path), `2026-09-22-child-workspace-reclamation-design.md` (child TMPDIR
containment; stage 6's scope rule is its process-side twin).

The operator, 2026-09-23: *"interruptions due to hitting limits when the task is delegated to subagents, and the
work simply vanishing when moving accounts"*; *"an aggressive reaper which reaps legitimate watchers … needs to
allow legitimate work to take place, but reap orphaned, forgotten, abandoned or zombied processes"*; *"can we
enhance recovery during account swap similar to how Claude Code itself does it?"*

A restart — limit rescue, auto-home, manual swap, supervisor revival — is today a place where work is lost. This
spec makes it a place where work is handed over. It adds no revival: the swap stays the one sanctioned restart,
and everything here changes what is on disk when it happens and what the restarted session is told.

---

## 1. The problem, measured

Fleet box, 2026-09-08..2026-09-23, deduplicated by workflow run id, agent id, session uuid and tool-use id across
the account-root copies a swapping session accumulates. Instruments and inputs are archived beside this
session's transcript (`landing-baseline/delegation`, `reaper`, `instruments`); §9 names what is committed.

### 1.1 Delegated work and the limit

| Workflow agents, 2026-09-08..09-23 | Value |
|---|---|
| Workflow runs / agents started | 1,023 / 21,833 |
| Agents whose last row is a `rate_limit` error | 894 |
| … of which died on their FIRST call (launched into a wall already hit) | 425 |
| Runs where every death landed within 120 s of the first | 93 of 102 |
| Runs with any rate-limit-dead agent that still ended `completed` | 89 of 102 |
| Rate-limit-FAILED agents never re-run | 617 of 624 |
| Output tokens produced by the rate-limit-stopped agents | 6.46M |
| Output tokens of agents lost to any cause (rate limit, mid-turn interrupt, other API error), on a 1,029-run base by earliest journal time | 11.8M |

Until 2026-09-16, when one account hit its window every in-flight agent died within about two minutes; the
Workflow runtime marked each failed and the script usually completed with holes. **Claude Code changed during the
window.** From 2026-09-15, with the build the fleet installed that day, a Workflow run pauses agents that hit a
five-hour limit and re-runs them after the reset: 18 runs to 2026-09-23 18:26, and 91 of 91 re-run agents returned
a result. Runs with an agent failed on a session limit and no pause: 45 on 09-08..09-16, 0 on 09-17..09-23. A
weekly limit is still "too far out to wait for" (7 runs). Most of the deaths above are therefore the earlier
behaviour. What remains is a paused run killed with its process by a rescue swap (no paused run has yet been seen
under a parent that was itself blocked: 0 of 18), weekly limits, and background Agent-tool subagents (unmeasured).
§9's stage-3 baselines are re-cut at 2026-09-16 before a plan uses them.

### 1.2 The swap

| Swaps, 2026-09-08..2026-09-23, cut at 08:49 (the rescue-timing table below re-cuts to 18:26: 248 rescues) | Value |
|---|---|
| Swaps: auto-home / auto-rescue / manual | 604 / 244 / 128 |
| Rescues preceded by the parent's own `rate_limit` within 30 min | 211 of 244 |
| Rescue after the first agent death | median 26 s, p90 287 s |
| Rescues that cut delegated work (live, or a failure notice still unread) | 79 of 244 |
| Sidecar carries that skipped an existing destination, logged `(kept)` | 774 of 1,310 |
| "Journal not on disk" resume refusals, all after only `(kept)` carries | 8 of 72 resume calls |
| "scriptPath must be a script path" resume refusals, all after a swap | 5 of 72 |
| Rescues with live delegated work: resumed the exact run / continued an agent / relaunched / dropped / idled | 11 / 1 / 6 / 7 / 5 of 30 |
| Finished agents replayed from cache in those 12 resumes / re-run | 813 / 0 |
| Rescues landing on a target another session also landed on within 10 min | 136 of 244 |
| Sessions with 3+ auto-rescues in any 60 min | 7 (max 4) |
| Unread failed-agent notices at a rescue not referenced within 60 min | 96 of 100 |

| Rescue timing, 2026-09-08..2026-09-23 18:26 | Value |
|---|---|
| Auto-rescues, every one on a `(blocked)` verdict | 248 |
| … on the session's own five-hour banner: minutes to that account's reset, median / p25 | 129 / about 54 (n=150) |
| … of those within 10 / 15 / 30 minutes of the reset | 2 / 3 / 14 |
| … adding the 18 on a monthly-spend banner, which also carries a five-hour reset (168 in all) | 3 / 7 / 18 |
| … on a banner the session carried in from the previous account | 32 (20 with no turn on the target) |
| Rescue to the first real turn on the target | median 1.6 min, p90 5.4 (n=201) |
| Targets themselves blocked before the source account's reset | at least 123 |
| Next move back to the source after its reset (a round trip) | 47 |

Pools run dry about two hours before they reset, not just before it, and a swap is fast.

Six mechanisms, read off the source at `bbb5e714`:

1. **The carry drops work.** `_swap_carry_sidecars` (`ccd/ccd:21492`) copies a session's sidecar directory
   (`<root>/projects/<project>/<uuid>/`: subagent transcripts, tool results, workflow journals) only when the
   destination does not exist. On a return visit it logs `(kept)` and skips the tree, so everything created
   since the session last left that account stays behind. The rule is an anti-nesting guard (copying a directory
   onto an existing one nests it) and avoids a half-merged tree; its own comment records that a partially built
   destination makes the skip permanent. Journals and agent logs are appended in place (§5.1).
   Every account root is its own bind mount of one volume, and `link(2)` across two mounts answers `EXDEV`, so
   every first carry since 2026-09-22 is `(copy)`, never `(link)`.
2. **The restarted session is told nothing specific.** The redrive prompt is one constant (`RESUME_PROMPT`,
   `ccd/ccd:1208`): background work "is gone: re-check their journals". Resuming by run id works across accounts
   when the journal is present; the eight journal-missing refusals are the carry, and the five scriptPath
   refusals are unexplained (stage 2 measures them).
3. **The stop gives Claude Code no chance to hand over.** `cmd_swap` (`ccd/ccd:22404`) stops the unit, kills the
   tmux session and sleeps one second. Claude Code ships an exit handoff — an adopt record handing background
   shells, workflows and agents "to the next wake of this session" — gated on the process running as one of its
   own background jobs: `CLAUDE_CODE_SESSION_KIND=bg` (or a daemon context), a job directory under
   `<config>/jobs/`, and `CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF` unset. ccd sets none of these, so it has fired zero
   times on the fleet. That mode also brings Claude Code's own background-revival supervisor, a second restart
   authority beside `ccd supervise`.
4. **Rescues herd and chain.** Rescued sessions land together on the same target. The worst chain was five
   rescues and one other swap over 68 minutes, bouncing between two accounts that were both already blocked;
   `SWAP_COOLDOWN` (`ccd/ccd:1085`, 900 s) and `SWAPBLOCK_COOLDOWN` (`:1086`, 1800 s) spaced it but did not stop it.
5. **The rescue kills the in-process wait.** Post-swap-redrive R1 (D-2236) made the rescue ignore Claude Code's
   armed auto-continue, which is right for a stalled session and costs the wait for one whose reset is minutes
   away.
6. **The blocked verdict trusts a banner the session brought with it.** A resumed session re-renders its
   conversation, the previous account's limit banner included, and until a new turn runs that banner is also the
   transcript's newest real row. `_session_hard_blocked` (`ccd/ccd:16612`) does not ask which account wrote it, so
   a session that lands and does not turn is rescued again once `SWAP_COOLDOWN` passes: 32 of the 248 rescues,
   mostly 15 minutes apart. The same verdict parses the reset time and discards it
   (`_transcript_limit_banner "$f" >/dev/null`, `:16693`); no rescue decision reads a reset.

### 1.3 Background processes

| Background processes | Value |
|---|---|
| Unique background tasks Claude Code stopped "because the system is running low on memory", since 2026-09-04 | 186 in 44 sessions (9 since 2026-09-18) |
| … mapped to a command (186 minus 53 unmapped; `reaper/classify_kills.py`) | 133 |
| … of those: CI, PR, deploy or limit watchers / test suites | 76 / 25 |
| Pane scopes whose tmux pane is gone, 2026-09-23 18:28 | 12, holding 32 processes and 1.32 GB; none from the 325 panes started since 2026-09-17 21:02 |
| … of which one DynamoDB Local server a pane started 27 days earlier | 1.27 GB |
| … still used by a live session (that server; a limits logger) / test and probe leaks / forgotten servers / idle fleet infrastructure | 2 / 7 / 2 / 1 |
| Pane scopes ended by the kernel's OOM killer, each ending its session, 2026-09-16..23 | 16 session deaths in 10 sessions, all with the pressure reap on |

The "aggressive reaper" is Claude Code's background-shell pressure reap. Its full rule, from the installed
bundle: interactive sessions only; the runtime reports critical memory pressure AND host memory reads scarce; no
input for 30 minutes; no turn running; no delegated agents; and never a task started with the Monitor tool. It
chooses by idleness, not by the shell's own memory, so a Bash `run_in_background` watcher in a session that ended
its turn to wait on CI is the first victim. It is disabled only by `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`
present at process start; ccd sets none of the related variables. Memory is otherwise bounded: every pane runs in
its own transient `tmux-spawn-*.scope` capped by `ccd-cap-scopes`, and the session slice has a hard `MemoryMax`.
Meanwhile nothing collects processes left in the scopes of panes that no longer exist. The `tail` processes
found there were left by test and mutation runs of the limit-banner FIFO case, whose timeout does not kill the
child's process group, not by the live detector (`_transcript_limit_banner`, `ccd/ccd:20156`, refuses
non-regular files and reads synchronously).

The reap and the kernel's OOM killer read different gauges. The reap needs host `MemAvailable` under 10% and
4 GiB, about 3 GiB here; the session slice meets its 24G `MemoryMax` with about 13 GB of host memory still free
(slice at 22.6 GiB on 2026-09-23 18:28). 8 of the 10 OOM stops since 2026-09-20 had no reap near them. Every pane
scope carries `OOMPolicy=stop`, so the OOM kill of any process in it, a background test worker included, ends the
session, which its supervisor restarts. The DynamoDB Local server runs at `oom_score_adj` −900 and every Claude Code
at 200, so the kernel takes a session before it.

### 1.4 Operator state

A session's route record is seeded at first spawn. Until PR #169 (`507aefe9`, 2026-09-22) the operator-spawn
default row was `class=fable effort=ultracode`; #169 changed the row (`ccd/ccd:17662`, now `class=opus`) and so
only new seeds. A `/model` or `/effort` typed in the session changes the running process only; the next restart
rebuilds the command line from the record. Measured on this spec's own authoring session: seeded with Fable
before #169, switched to Opus by the operator at 18:39 UTC on 2026-09-22, respawned with `--model fable` by an
auto-home at 04:17 UTC the next day.

## 2. What the parent designs already say

- **Post-swap redrive:** every spawn sets `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` and a ccd-authored resume
  prompt, submitted by Claude Code only when the resumed tail is an interrupted turn; a typed fallback exists
  (D-2231; in the window 762 `redrive-skip not-stalled`, 0 typed). Neither it nor its follow-ups mention
  workflows or subagents. This spec changes what the re-drive SAYS and what is on disk when it fires.
- **Limit park and wake:** no revival; unattended keystrokes are a default-off capability; its R4 designs a
  box-wide `$REG/.release.lock` on `_dispatch_swap` because concurrent restart-time scans once stalled the box
  for 9.7 h. That lock is not in ccd yet, and it covers only `_dispatch_swap`; stage 1 takes a non-blocking
  slot inside the carry itself so every path that carries is covered (§5.1).
- **Effort/model routing:** the route record is the authority at spawn, and its §5.3 rules that a keystroke not
  accompanied by a field write is transient by design. Stage 7 amends that for the operator's own choice (C7).
- **Compaction card:** the session-start context is an n-subject join whose standing subjects are clipped
  together at `CARD_MAX_CHARS=2400` (`ccd/session-hook.sh:2439`); the compact subject has its own ceiling
  (`COMPACT_CARD_MAX_CHARS=4000`), and their derived sum is pinned under the harness's 10,000-character
  SessionStart spill (`session-hook.test.ts:2642`). The manifest subject gets its own ceiling as a new term in
  that derived sum, re-pinned under the spill.

## 3. Decisions settled in the brainstorm, and amendments named

| # | Ruling or amendment | What it fixes |
|---|---|---|
| C1 | Two specs, landing and continuity (operator). | This spec. |
| C2 | Rescue timing: "least time interruption and max recovery potential so that we do not waste tokens and do not lose work, but also don't wait too long" (operator). | Stage 4. |
| C3 | Reaper: "is there no more elegant way?" — no heuristic sweep (operator). | Stage 6: one variable plus the scope boundary the kernel enforces. Amended by C11. |
| C4 | Headroom estimation dropped (operator). | No fan-out gate. Target choice keeps using the limits files it already reads. |
| C5 | "Enhance recovery during account swap similar to how Claude Code itself does it" (operator). | Stage 2 spike decides stage 3's mechanism. |
| C6 | AMENDS post-swap-redrive R1 / D-2236: the rescue waits instead of swapping when the reset is near and Claude Code's auto-continue is armed, or when no target has room. | Stage 4. Slug `rescue-waits-near-reset`, D-3498. |
| C7 | AMENDS routing §5.3 "a keystroke not accompanied by a field write is transient": the operator's own `/model`/`/effort` is written to the record before a restart. | Stage 7. Slug: `operator-model-survives-restart`. |
| C8 | REVERSES the carry's "an existing destination is LEFT ALONE rather than merged". | Stage 1. Slug `sidecar-carry-merges`, D-3496. |
| C9 | No backfill of the historical backlog unless a programme needs one (operator, 2026-09-23, on the written spec). | §11 item 1. |
| C10 | Re-seed the route records seeded under the pre-#169 default: yes, one-off (operator, 2026-09-23, on the written spec). | §11 item 2: executed by hand the same day; no code. |
| C11 | AMENDS C3 (operator, 2026-09-23, on §11 item 4's measurements): beside the variable and the scope boundary, a sweep stops dead ccd pane scopes that have done nothing for six hours and serve nothing; everything else is reported. | Stage 6. Slug: `inert-scope-sweep`. |
| C12 | AMENDS D-3100's argument that a re-rendered banner "cannot reach a relocation" because the rescue arm sits below `SWAP_COOLDOWN`: the cooldown expires, and 32 of 248 rescues came from a banner the session carried in (§1.2 mechanism 6). A banner older than the session's landing is not a block, which also gives up the pane rung's immediacy for a pane positive that the transcript dates as carried in (§8). | Stage 4 rule 1. Slug `carried-in-banner-is-not-a-block`, D-3497. |
| C13 | The rescue-wait bound is 10 minutes (operator, 2026-09-23). | Stage 4 rule 2; §11 item 3. |
| C14 | The slice ceiling is answered by measuring `OOMPolicy=continue` for pane scopes in the stage-2 spike, never by an aggregate `MemoryHigh` (operator, 2026-09-23). | Stage 2 step 7; §11 item 5. |

## 4. Roles and authority

- **ccd** carries, stops gracefully, writes the manifest, spreads rescues, reports dead scopes of its own panes
  and stops the inert ones (C11), honours the route record. It never resumes anything itself and never types beyond the existing
  redrive fallback's constant text.
- **The session (the model)** decides whether to resume. It is told what was in flight and the literal call that
  resumes it; that is a request, and §9 measures whether it is honoured.
- **Hooks** record launches (PostToolUse) and deliver the manifest (SessionStart). They never deny a launch.
- **The server** reads what ccd wrote and shows it; it never parses Claude Code's journal formats, never mails a
  resume list, and runs nothing but `tmux` and `ccd`.
- **The operator** sees counts on the phone and on the run, overrides a refused swap with the counts in view,
  stops, or moves into a unit, the services doctor reports in dead scopes, and rules on §11.

## 5. The design, in stages

Stage N is §5.N.

### 5.1 Stage 1 — the carry merges instead of skipping (ccd only)

**The write model, measured.** A live `agent-*.jsonl` keeps one inode while it grows. Over the 128 workflow runs
that finished on their own root in three days, `journal.jsonl` is appended in place in 128 of 128, `agent-*.jsonl`
in 4,447 files, and `workflows/<runId>.json` is written whole at the run's end in 128 of 128. The 389 `(copy)`
fallbacks come from the mounts, not the device: every account root is its own bind mount of one volume, `link(2)`
across two mounts answers `EXDEV`, every dated `(copy)` involved a root that was already a mount (262 of 262), and
every dated `(link)` ran while both roots were plain directories (163 of 163). Since 2026-09-22 every first carry is
`(copy)`, so a file carried since then never shares an inode with its source. The rules below are written for
append-in-place logs and rewritten records.

In `_swap_carry_sidecars`, the branch taken when the destination exists walks the source tree file by file and
decides on size, modification time and content; a shared inode can answer only "equal":

| Source vs destination | Action | Counted |
|---|---|---|
| absent at destination | hardlink, or copy when linking fails | `+N` |
| the same inode; or equal size and equal nanosecond mtime; or equal bytes | nothing | no |
| append-only log (`*.jsonl`), destination a strict byte-prefix of a larger source | replace by temp file and rename | `~R` |
| append-only log, destination longer than source and source its prefix | keep destination (it is further along) | no |
| append-only log, neither a prefix of the other | keep destination | `!D` |
| rewritten record (`workflows/<runId>.json`, `agent-*.meta.json`, `workflows/scripts/*`), source newer | replace | `~R` |
| any other file whose bytes differ (a tool result is written once) | keep destination | `!D` |
| a destination entry of another type where the source has a regular file | keep destination | `!D` |
| a non-regular source entry (a symlink, a fifo) | never followed, never copied | no |

Equality is never decided on size alone. The size-and-mtime quick check reads no bytes; its named cost is that two
different files of identical size and identical nanosecond mtime read as equal. Over the 673 return-visit pairs on
the fleet box it takes the walk's read from p50 80 MiB / p90 764 MiB (bytes compared) to p50 5.6 MiB / p90
208 MiB, the bytes that are actually new.

Nothing is deleted. The first carry to an account keeps today's path unchanged, including the anti-nesting guard
and the clear-then-copy fallback. A destination left partial by an earlier failure is repaired by the walk rather
than kept forever. The log line becomes `sidecar <uuid> -> <dst> (merged +N ~R !D)`, and each `!D` adds a line
`sidecar <uuid> diverged <kept> longer <longer>` naming the longer copy's path, which stage 3's manifest reads.

**Bounded.** The walk reads both copies, where `(kept)` read nothing. It takes a box-wide non-blocking slot of
its own, `$REG/.carry.lock`, inside the carry itself; park-and-wake R4's lock has not shipped. `_swap_carry_sidecars`
has one caller, `cmd_swap`, so the slot covers every path that carries — rescue, auto-home, manual or PWA swap,
`swap-self` — not only the ones that pass through `_dispatch_swap`; a supervisor revival never changes account and
never carries. The byte budget, `CARRY_MERGE_BUDGET` (512 MiB per sidecar directory), is charged by a dry `lstat`
pass over the whole walk — every byte it would read to compare and every byte it would copy — before anything
moves: all or nothing. When the slot is busy, or the walk is over budget, the carry falls back to today's `(kept)`,
logged as `(kept: busy)` or `(kept: budget)`, and the destination is exactly as it was. A walk that cannot run —
no `flock`, the lock file unopenable, no `python3`, a destination that is not a real directory, the walker's own
failure — is `(kept: error)`, its own word because its remedy differs. It never waits, because the unit is already
stopped. At 512 MiB, 43 of the 673 return-visit pairs on the box fall back to `(kept: budget)` on their first merge
(87 without the quick check); they are the stranded backlog C9 does not backfill.

Tests under `makeCcdHarness` with fixture homes, each red when its rule is removed: a return visit carries new
journals; an equal file is untouched and uncounted; equality is never decided on size alone; a prefix journal is
extended; a longer destination is kept; a diverged journal is kept and counted; a newer record replaces; a
differing unclassified file is kept and counted; a non-regular source entry is not followed; nothing is deleted; no
nesting on an existing destination; a partial destination is repaired; the budget falls back before any byte
moves; a walk that cannot run is `(kept: error)`. The `ccd/ccd` edit re-stamps the generated header and follows
the compaction-card citation-corpus procedure.

The historical backlog on source accounts is not recovered (§11).

### 5.2 Stage 2 — spike: Claude Code's native exit handoff under ccd (half a day; decides stage 3)

On one scratch session on a scratch account, with a Bash background watcher, a Monitor task, a two-agent workflow
and a plain background agent running:

1. launch with both gates set — `CLAUDE_CODE_SESSION_KIND=bg` and `CLAUDE_JOB_DIR` under `<config>/jobs/` — and
   `CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF` unset; record what else changes for an interactive tmux session under
   the bg kind (heartbeats, fleet view, idle behaviour);
2. stop gracefully: `SIGTERM` to the Claude Code process and a bounded wait for its exit, instead of the tmux kill
   and one-second sleep;
3. run a ccd swap and observe: the adopt record; the log line naming what was handed "to the next wake of this
   session"; on the next wake, whether workflows re-register, agents auto-resume, shells are adopted or reported
   failed; where handed-over shells' processes sit in the cgroup tree; whether the job directory under the SOURCE
   root's `jobs/` is found from the destination root;
4. observe whether Claude Code's own background-revival supervisor or daemon engages, and whether it restarts
   anything ccd did not;
5. resume a workflow by run id after the swap with a current-root script path, to explain the five scriptPath
   refusals;
6. with the two-agent workflow paused on a five-hour limit, let the parent itself hit the limit, and observe whether
   the paused run survives a stage-4 wait, and whether it survives a swap followed by a resume by run id;
7. set `OOMPolicy=continue` on the scratch session's pane scope with `systemctl --user set-property`, run a
   background process past a small scope `MemoryMax`, and observe that only that process is killed and the session
   lives (C14). If `set-property` refuses the property on a transient scope, record it: the remaining route is the
   user manager's `DefaultOOMPolicy`, which needs a re-exec of the fleet's user manager and returns to the operator.

**Decision rule.** Native handoff is primary for stage 3 only if it fires with both gates set, the next wake
adopts across the account change, and no second restart authority engages (or it can be switched off). Otherwise
ccd's manifest is primary. Either way the graceful stop ships. The spike's transcript and measurements are
committed with the plan.

### 5.3 Stage 3 — recovery at every restart (ccd, hook, prompt)

**The graceful stop.** Every ccd stop that will be followed by a resume sends `SIGTERM` to the Claude Code process
and waits a bounded time, measured in the spike, before the tmux kill. The unit is still stopped first, so
`Restart=always` cannot resurrect it under the old wrapper.

**The launch record.** `session-hook.sh`'s PostToolUse arm appends one row to `$REG/<id>.deleg` for each Workflow
launch, background Agent, `resumeFromRunId` and `SendMessage` continuation: time, wrapper, kind, run/task/agent id,
script path. Rows from a subagent's own hook input are dropped. On a single-UNIX-user box "the hook is the only
writer" is a convention, so the mechanism is validation: ids must match `^[A-Za-z0-9_-]+$`; a script path must
resolve (realpath) under this session's own current-root sidecar and match a strict path class; a failing row is
dropped and counted, at write and again at compose.

**The manifest.** In the swap body, right after the carry (the unit is stopped, so journals are final), and at a
supervisor revival from the launch record alone, ccd writes `$REG/<id>.inflight`, stamped with its write time and
the session generation. It takes the same slot and a byte budget; busy or over budget, it writes `unmeasured`. Items
come from the launch record joined with sidecar files changed in the last day:

| Class | Meaning |
|---|---|
| `in-flight` | started, no result |
| `holed` | the run completed but some agents' last row is a rate-limit error |
| `stopped-agent` | an agent whose transcript ends on a rate-limit error or without a finished turn |
| `diverged` | from stage 1's `diverged` lines in the swap log, naming the longer copy |
| `deferred-until-reset` | its resume already failed on the limit once (below) |
| `abandoned` | older than the window, no terminal record: counted, never dropped silently |

An item retires when the launch record shows its resume completed or its run finished. The file's absence means
`never-written`, distinct from `none`.

**Delivery.** The redrive prompt becomes a composed per-spawn string: today's sentence plus up to eight validated
items, each with its literal call (`Workflow({scriptPath: "<current-root path>", resumeFromRunId: "<id>"})`, or
`SendMessage` to the agent id). Ids and paths only; never free text such as a workflow name. With no manifest, an
empty one, or `unmeasured`, the prompt is byte-identical to today's. The list rides the session-start context
as its own subject, clipped at its own ceiling; the prompt's eight items are the guaranteed carrier. The typed fallback
keeps today's constant.

**Not-stalled restarts.** Claude Code submits the resume prompt only when the resumed tail is an interrupted turn.
A session that had ended its turn to wait lands idle; it gets the manifest in its session-start context at its next
turn, the counts reach the phone (stage 5), and nothing types. §9 counts stalled and not-stalled restarts with a
non-empty manifest separately.

**Deferred, not relaunched into the wall.** The manifest keeps a resume-attempt count per run; a run whose resumed
agents die on the limit again becomes `deferred-until-reset <resetsAt>`, and the prompt says: resume once; if agents
stop on the limit again, stop and leave it listed.

**Background shells** killed by the stop, or handed over natively, are listed so the session re-arms its watchers.

### 5.4 Stage 4 — rescue timing, the herd, and swaps that cut work (ccd; its refusal of swaps that cut work needs stage 3)

**The rescue policy (C2, C6).** A rate-limited turn is lost either way — Claude Code's wait re-runs it after the
reset, and a resume after a swap re-runs it too — so waiting saves only the swap and the risk that the model does
not resume, and stage 3 removes most of that risk. Measured (§1.2): a swap reaches its first real turn in a median
1.6 minutes, and rescues fire a median 129 minutes before the reset, so a wait never saves wall clock; what it saves
is the move, the carry and a round trip.

1. **A carried-in banner is not a block.** `cmd_swap`, the one verb that moves a session between accounts, stamps
   `$REG/<id>.landed` (epoch, wrapper) after the carry and the wrapper flip, before `_svc_start` starts the unit;
   absent means never swapped, and every row is current. `lastswap` cannot serve: it is stamped at dispatch, up to
   `SWAP_JITTER` (120 s) before the swap runs, and deleted on a refused swap. A rate-limit row older than the
   landing is not evidence of a block, from the transcript or the pane: a pane-arm positive is dated by the
   transcript, and one whose newest rate-limit row is older than the landing is not a block; with no rate-limit row
   at all, the pane's verdict stands as today. A transcript it cannot read (`_transcript_limit_banner` rc 2), or
   whose path does not resolve, is unread, never "no row": it cannot date a pane positive, and the pane's verdict
   stands. The transcript arm's cache (`$REG/<id>.tscan`) records unread as `2`, distinct from a read with no row
   (`0`). The dating read is uncached. A suppressed positive is logged once per landing (`carried-in <id>: …` in the
   swap log), floored by `$REG/<id>.carriednote`. An auth failure, which the pane arm also matches, keeps today's
   path and never reads a reset (C12).
2. **Wait near the current account's own reset; otherwise swap at once.** On a rate-limit verdict ccd keeps the
   `resetsAt` and `rateLimitType` that `_transcript_limit_banner` already prints, from the banner row that
   postdates the landing. It waits — leaves Claude Code's armed auto-continue alone and types nothing — when the
   type is `five_hour`, the reset is within `RESCUE_WAIT_BOUND` (600 s, a knob; 0 turns the wait off), the backend
   is Anthropic's (`_is_anthropic_backend`), and Claude Code's auto-continue is armed on the pane
   (`_pane_auto_continue_armed`). A stalled session near its reset, a `seven_day` block, a block on any
   non-Anthropic backend (the Codex lane among them), or no postdating row carrying both values swaps as today;
   `~/.cc-limits` is not a fallback, because it cannot say which window blocked. It also waits when no placeable
   target has room (today's `stranded`). A wait is recorded once on entry and once on exit, in
   `$REG/<id>.rescuewait` and the swap log, never under the word `hold`, which is the workspace-reap hold. It ends:
   - at the reset, when Claude Code's own timer or the stale-phase Enter (D-2360) continues the turn;
   - `RESCUE_WAIT_GRACE` (120 s, its own constant, not `STALE_PRESS_COOLDOWN`) after the reset, by what the pane
     shows at that tick. Only an ARMED auto-continue ends a wait in place: Claude Code re-sends the turn itself, and
     ccd never swaps away from an account that has just reset. A STALLED session is rescued as today, because
     nothing on its own account will re-send the turn (the redrive fallback types only on an unsubmitted resume
     pair): its near or chain wait closes and the tick swaps it to a target with room, skipping the accounts it
     just left blocked, with no second chain wait on the same reset; its no-room wait stays open;
   - for the no-room wait, in a swap when a target gains room.

   No wait of any kind keys on a rate-limit row written at or after its own `resetsAt`: such a row is stale on
   arrival, and a wait keyed on it would never end. A stalled session whose own account is the only one with room
   idles until another target gains room, as it does today (§11 item 6).

   A longer bound for a session with delegated work in flight is not specified: no paused run has been seen under
   a blocked parent (§1.1), and the stage-2 spike measures whether one survives a wait (§11 item 3).
3. **Spread and do not bounce.** Target choice skips an account the session just left blocked — the source account
   of any of this session's auto-rescues within `RESCUE_CHAIN_WINDOW` (3600 s), until that rescue's logged reset
   passes — and prefers a target that has not received any session's rescue within `RESCUE_SPREAD_WINDOW` (600 s)
   when another placeable target exists. The history is read from the swap log's tail (`RESCUE_LOG_TAIL_BYTES`,
   1 MiB), whose `auto-rescue` line carries the dated row as appended `reset=`, `type=` and `row=` tokens. A session
   already rescued three times in the last hour is not rescued a fourth time at once: it takes a **chain wait**
   on its current account for at most 30 minutes (a knob), recorded in `.rescuewait` with `kind=chain`, then swaps
   to a target with room that is not the account it just left blocked. A chain wait ends early at its account's
   reset under rule 2's first two end conditions and never swaps away from an account that has just reset; at 30
   minutes with no target that has room it becomes the no-room wait. Both waits sit inside, not instead of,
   `SWAP_COOLDOWN` and `SWAPBLOCK_COOLDOWN`.

Tests under `makeCcdHarness` with fixture homes, every fixture past `SWAP_COOLDOWN`, each red when its guard is
removed: a transcript banner row older than `.landed` produces no rescue; a pane positive whose newest rate-limit
row predates `.landed` produces no rescue; no `.landed` with an old row rescues; an unreadable or unresolvable
transcript under a pane positive rescues; a `five_hour` row whose reset is 300 s out, with auto-continue armed,
produces no dispatch, and deleting the bound check makes it dispatch; the same row on a stalled session
dispatches; the same row on a non-Anthropic backend dispatches; a `seven_day` row 300 s out dispatches; a bound of
0 dispatches; an armed pane after the reset with no new row ends the wait in place and nothing dispatches, and
with a new row a dispatch follows; a stalled no-room wait across its own reset is rescued once a target has room; a
stalled chain wait whose account reset closes and the tick rescues, with no second chain wait; a row written after
its own `resetsAt` opens no wait; an auth-failure pane with
an old rate-limit row carrying a near reset dispatches; a target set with no room gives no dispatch and a stranded
record; a target just left blocked is skipped; a fourth rescue within the hour takes the chain wait; a chain wait
whose account resets inside it does not swap on an armed pane. The two caching pins in `ccd-limit-banner.test.ts` that cached an
absent or unreadable transcript as a negative verdict now expect unread (`2`). `.landed`, `.rescuewait` and
`.carriednote` join the per-session registry field list and purge with the row; `.rescuewait` is read by ccd's own
entry/exit dedupe and by doctor, whose reader ships with stage 6's first part and its doctor checks; §9's
instrument reads the swap log.

**Swaps that are not rescues do not cut work.** Auto-home, affinity and manual swaps refuse while the session's
on-demand manifest scan finds `in-flight` or `stopped-agent` items younger than two hours. Other classes do not
block. An `unmeasured` scan refuses for at most three ticks, then the swap proceeds and is logged. A session whose
exec kind has no Claude Code transcript is `not-applicable` and never refused. A manual swap from the PWA shows
the on-demand counts; the operator overrides with a distinct flag, `--cut-delegated`, minted at its own
`CCD_ARGV` site and carried as a body field. ccd answers the refusal with its own refusal word, which the swap
route maps to its own 409 carrying the counts rather than the generic 502. `--force` keeps its one meaning,
accepting transcript loss.

### 5.5 Stage 5 — skills, the programme loop, the phone

- **One clause appended to each of the worker, coordinator and reviewer skills** after the landing spec's stage-1
  clauses (numbers assigned at merge; the three pins and the `README.md`/`CLAUDE.md` count words move in the same
  commit): after a ccd restart note or on any null agent result, resume the named run with its current-root script
  path before relaunching anything; a rate-limit null is unverified work to re-run, never an empty finding. The
  worker clause also says to wait on CI or a deploy with the Monitor tool rather than a Bash background loop.
- **`references/review-panel.md`** gains "resume before re-run": an unverified lens or unexamined finding is cured
  by resuming the same run, not by relaunching the panel.
- **The programme loop sees holes.** `GET /api/runs/:id/signals` carries the delegation state of the run's bound
  worker session (`runs.sessionId`; for a review run, the reviewer session), computed in the route handler, not in
  `CoordStore.runSignals`, which stays pure coord.db. Only items newer than the run's dispatch count. The
  coordinator skill says a wave-done from a worker reading `holed` or `abandoned` above zero is reported as such
  before it is accepted, and one reading `unmeasured` is reported as unverified. Pinned by a test in which the
  coordinator and the worker hold different counts.
- **The phone.** An additive, optional `FleetSession.delegations` field — state
  `listed | none | never-written | not-applicable | unmeasured`, counts, ids — read from `$REG/<id>.inflight` by the
  agent, and in local mode by the server's own reader, one reader per mode, a parity test between them. A chip on
  the session card. No server-side journal parsing, no coord.db table, no mail.

### 5.6 Stage 6 — background processes: stop the wrong kills, collect the real orphans (ccd)

1. **Stop the wrong kills.** ccd sets `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` in every spawn environment,
   beside the resume variables, from stage 6's first deploy; it does not wait for item 2. The reap stops only
   background shells of a live, idle Claude Code, and every process in a dead scope has already lost its Claude
   Code, so no collector frees memory the reap would have freed (§1.3). Watchers can already opt out today by using
   the Monitor tool instead of Bash `run_in_background`; stage 5's worker clause says so.
2. **Report every dead scope; stop only the inert ones** (C11). Every ccd pane
   runs in its own transient scope under the session slice, and its processes stay there unless something
   deliberately moves them to another unit (`systemd-run --user --unit …`), which is how a service a session wants
   to outlive its pane must leave.
   - A sweep of its own — `ccd-scope-sweep`, a oneshot on a one-minute timer beside `ccd-cap-scopes`, so a slow
     stop or a sweep fault never delays capping a new scope — reads only the `tmux-spawn-*.scope` units in the
     session slice whose `Description` parses as `tmux child pane <pid> launched by process <pid>`. Any other scope,
     ccd's own `ccrc-tmux-server.scope` first among them, is outside the sweep, never reported and never stopped
     (pinned by a test with a server scope in the fixture slice); a `Description` that does not parse is
     unmeasurable. A pane scope is **dead** when none of its processes is a live pane of the tmux server its
     `Description` names, and **ccd's** when that server is ccd's current server or a tmux server that no longer
     runs, checked by pid, `comm` and a start time earlier than the scope's, against pid reuse. A scope of any other
     live tmux server is never touched. Values come from `systemctl --user show` (`ControlGroup`, `CPUUsageNSec`),
     never from a string-built cgroup path.
   - It keeps one verdict record per scope — dead or live, inert or not and why, first seen dead — in
     `$XDG_RUNTIME_DIR/ccd-scope-sweep.state`. Doctor reads that record and never re-derives it; a reboot resets
     the clock, which is the safe direction.
   - It **stops** a dead ccd scope (`--no-block`) at the first tick at least six hours after first seeing it dead,
     when its CPU usage has not moved since then, no process in it started in the last six hours, no process holds
     a TCP or UDP socket or a listening Unix socket, no process is the parent of one in another cgroup, no live
     handoff record names one of its processes, and `$REG/scope-sweep-paused` is absent. A **handoff record** is
     Claude Code's native adopt record, naming a background shell handed "to the next wake", if the stage-2 spike
     makes native handoff primary; the stage-3 launch record carries run and agent ids, never a pid, so under
     manifest-primary, and before stage 3, no record exists and that predicate is satisfied. A predicate it cannot
     measure skips that scope for the tick and records nothing; a scope seen live drops its entry.
   - Every other dead scope is **reported**, never stopped: doctor lists scope, processes, age, sockets and memory,
     and the operator stops it or moves the service into a unit. Doctor also lists every process older than a day
     in a live pane scope, other than the pane's own process and its Claude Code's MCP servers.
   - Measured against the 12 dead scopes of 2026-09-23: 5 stop (22 processes, 20 MB, all test and probe leaks, no
     CPU over 42 minutes); 7 are reported, among them both services a live session still used, which listen or
     poll. The named cost: a process that waits more than six hours with no CPU and no inet or listening socket — a
     lone long `sleep`, a blocking waiter on a connected Unix socket or inotify — in a pane that is gone.
   - When ccd itself ends a pane (stop, swap, archive), it stops that pane's scope after the stage-3 handoff,
     unless a live handoff record names any process in it; then it reports the scope instead of stopping it,
     because a scope stop ends every process in the scope.
   - Tests run under a fixture root — `PROC_ROOT` and `CGROUP_ROOT` overrides and a stubbed `systemctl` on `PATH`,
     so they run on the macOS leg — with a red row per predicate, plus: a scope of a live non-ccd server is never
     touched; an unmeasurable predicate skips; a scope seen live resets its clock.
3. **Fix the test leak** at its source: the limit-banner test harness kills its child's whole process group on
   timeout.

Named trade: with the pressure reap disabled, a pane's background children share its scope with the live Claude
Code process. At the pane scope's `MemoryHigh` (8G, set by `ccd-cap-scopes`) the whole scope is throttled, the
session included. At its `MemoryMax` (12G), the slice's 24G or `user@`'s 26G, the kernel's OOM killer chooses the
victim, and under `OOMPolicy=stop` the kill of any process in a pane scope ends that session. That is already how
sessions die with the reap on (§1.3), because the slice fills while the host still reads plenty free. §9 counts OOM
stops of scopes whose session had been idle 30 minutes or more with a live background shell — the reap's own class
— for a week with the reap still on, before the variable ships (baseline B); the variable is removed when that
class exceeds B + 2 in any week after it ships, and the removal takes effect at each session's next start. An aggregate `MemoryHigh` must never return to the slice.

### 5.7 Stage 7 — the operator's choice survives a restart (ccd)

**ccd journals its own keystrokes.** `_inject_spawn_effort` and `_route_apply_now` append each `/effort` or
`/model` they type, with its value and time, to `$REG/<id>.typed`. The `routeapplied` stamp cannot serve: the spawn
writes it from the composed argv before the settle `/effort` is typed, and `route --apply` rewrites it for fields
it never types.

Before a stop that will be followed by a spawn, ccd reads the session transcript for the newest `/model` or
`/effort` local command that no `.typed` row matches (same value within a short window). A `/model` value maps to
the record's class vocabulary through a bash alias table — `opus`, `sonnet`, `haiku`, `fable`, `default`, and
their `[1m]` variants — plus, for a full model id, a bash port of `familyClassOf`'s dash-token rule
(`shared/models.mjs:451`), with an agreement pin between the two. A value outside the vocabulary is logged and
leaves the record unchanged, never a failure in the stop path. A mapped value is written through `cmd_route`'s own
writer with `actor=operator-session`, and the swap log records it. Mutation rows: the settle `/effort` on a session
with no effort field is not promoted; a `route --apply` `/model` is not promoted; an unmappable value does not abort
a swap; an operator `/model opus` survives an auto-home.

## 6. Invariants kept

- **No revival.** Nothing starts, restarts or swaps a session ccd would not already restart. The one new stop
  behaviour is a graceful signal before the existing kill; the typed fallback text is unchanged.
- **A new, named process-stop authority, bounded.** Stage 6 stops the scopes of panes ccd itself ends and (C11)
  dead ccd pane scopes that have done nothing for six hours and serve nothing; never a scope of another live tmux
  server, and never a scope that is not a pane's.
- **ccd is the authority** on files and sessions; nobody but the operator, acting on doctor's report, touches
  `~/.cc-sessions`, tmux or a unit outside ccd, and doctor's next run records what the operator stopped.
- **The server never runs git or Claude Code** and never parses journal formats.
- **Additive wire**, one reader per field per mode, absence means unknown, `FLEET_PROTO` unchanged.
- **Mutation-table discipline** for every guard named above.
- **Per exec kind.** A session with no Claude Code transcript (the Codex lane) is `not-applicable`, never an empty
  list and never a refusal, and gets no variable it does not read.

## 7. Surfaces touched

| Area | Change |
|---|---|
| `ccd/ccd` | carry merge and its `diverged` lines; the carry and scan slot and budgets; graceful stop; keystroke journal `.typed`; manifest writer and scan; composed prompt; `.landed` stamp in `cmd_swap`, `.carriednote` and the carried-in-banner check; rescue wait near reset, spread, no-bounce, the `auto-rescue` line's `reset=`/`type=`/`row=` tokens; in-flight refusal and its refusal word; `--cut-delegated`; the pressure-reap variable in the spawn environment; scope stop on pane end; route write from `/model`/`/effort`; re-stamp and citation-corpus procedure |
| `ccd/ccd-scope-sweep` (new) | per-scope verdict record `$XDG_RUNTIME_DIR/ccd-scope-sweep.state`; inert stop (C11); report. `ccd/ccd-cap-scopes` is unchanged |
| `deploy/systemd/ccd-scope-sweep.{service,timer}`, `deploy/deploy.sh`, `ccd/ccrc` install spine, `agent/test/deploy-verify.test.ts` | the unit and timer, their install and uninstall, and the pins that enumerate each ccd timer |
| `ccd/ccrc-doctor-checks` | reads the sweep's verdict record and `$REG/<id>.rescuewait`; lists dead scopes and long-lived pane processes; records operator stops |
| `ccd/session-hook.sh`, `server/test/session-hook.test.ts` | PostToolUse launch record with validation; SessionStart manifest subject with its own ceiling, re-pinned under the 10,000-character spill |
| `ccd/worker-skill`, `ccd/coordinator-skill`, `ccd/reviewer-skill`, `references/review-panel.md`, `README.md`, `CLAUDE.md` | clauses, paragraph, count words; pins |
| `server/src/server.ts` (swap route), `server/src/ccdargv.ts` | `--cut-delegated` mint site and body field; the refusal's own 409 |
| `agent/src`, `server/src` (`watch.ts`, `fleet.ts`, `coord/routes.ts` signals), `shared/api.ts` | the `delegations` field, readers per mode, run signals |
| `pwa/src` | session-card chip; swap-sheet on-demand counts and override |
| `server/test` (limit-banner harness; `ccd-limit-banner.test.ts`) | process-group kill on timeout; the two caching pins expect unread (`2`) |
| `deploy/measure-continuity.py` (new, read-only) | the instruments of §9 |

## 8. Failure modes named

- **The handoff fires but its record lands where the carry did not bring it:** why stage 1 ships first and the
  spike measures the job directory's root.
- **Mass rescue I/O:** the carry walk and the manifest scan take a non-blocking slot on every path and run under
  byte budgets, falling back to `(kept)` or `unmeasured` rather than waiting; the swap body is the place, never the
  spawn path; §9 measures `(kept: busy)`, `(kept: budget)`, `(kept: error)` and the `unmeasured` rate.
- **Two different files of equal size and equal nanosecond mtime read as equal:** the quick check's named cost;
  equality is never decided on size alone, pinned.
- **The model ignores the manifest:** counts reach the operator and the coordinator anyway; §9 retires prompt text
  that measures no change.
- **A carried-in banner rescues a session that is not blocked:** the `.landed` stamp dates the banner.
- **A real block on the target reads as carried-in** while the transcript lags the pane (the kind of lag D-2443 stands down for):
  the dating read is uncached and the next tick asks again; §9 counts pane positives rule 1 suppressed that became
  a rescue within five minutes.
- **A near-reset wait lasts longer than the reset promised:** it ends `RESCUE_WAIT_GRACE` after the reset, in
  place only on an armed pane, otherwise in a swap; a row stale on arrival opens no wait.
- **A stalled session idles on a reset account:** a stalled session's waits end in a swap, never in place; the one
  case left is a stalled session whose own account is the only one with room (§11 item 6).
- **A chain wait on an account with a far reset:** bounded at 30 minutes, then a swap that skips the account just
  left blocked, or the no-room wait when no target has room.
- **The slice ceiling kills a live session** once the pressure reap is off: named in §5.6, measured in §9 by the
  reap's own class, undone by removing the variable.
- **A dead-scope stop kills a wanted service:** only a scope inert for six hours, with no inet or listening socket
  and no child elsewhere, is stopped (C11); everything else is reported.
- **The sweep mistakes a server scope for a dead pane:** only `tmux-spawn-*.scope` units with a pane `Description`
  are read; ccd's `ccrc-tmux-server.scope` sits in the same slice.

## 9. Measurement, targets and the kill rule

Baseline frozen at 2026-09-08..2026-09-23; the rescue-timing rows run to 2026-09-23 18:26, the scope census to 18:28,
and the OOM row covers 2026-09-16..23. Committed with the plan: the carry counter over the swap log, the journal
census deduplicated by run id, the post-swap outcome classifier, the pressure-kill scan, the dead-scope census.

| Stage | Metric | Baseline | Target |
|---|---|---|---|
| 1 | `(kept)` carries by reason (`busy`, `budget`, `error`, bare); journal-missing resume refusals | 774 of 1,310, all by existence; 8 | only `busy`/`budget`, under 2%, reported with and without the pairs stranded before stage 1's deploy; 0 |
| 2 | spike outcome | — | decides stage 3 |
| 3 | rescues with live work that resumed the exact run; finished agents re-run by relaunches; manifest writes ending `unmeasured`; stalled vs not-stalled restarts with a non-empty manifest | 11 of 30; up to 3.6M tokens; —; — | over two thirds; near 0; under 5%; reported |
| 4 | sessions with 4 or more auto-rescues in an hour; chain waits that end in neither a swap nor a reset; non-rescue swaps that cut delegated work; rescues on a carried-in banner; near-reset waits that end in a swap; pane positives suppressed by rule 1 that became a rescue within 5 min | at least 1 (archive max 4); —; 4 of 5 manual swaps with live work; 32 of 248; —; — | 0; 0; 0; 0; reported; reported |
| 5 | holed or unmeasured wave-dones accepted without a note | not measured | 0 |
| 6 | pressure kills of background shells; dead ccd scopes that pass the inert test yet survive a day; OOM stops of pane scopes whose session was idle 30 minutes or more with a live background shell, and all pane-scope OOM stops | 186 since 2026-09-04 (9 since 09-18); 5 of 12 on 2026-09-23; B, measured the week before the variable ships, and 16 in 2026-09-16..23 | 0; 0; at most B + 2 a week, reported |
| 7 | restarts that revert an operator's `/model` | this session's case | 0 |

Stage 1's first merges meet the backlog C9 does not backfill: 43 of the 673 return-visit pairs on the box exceed
`CARRY_MERGE_BUDGET` and fall back to `(kept: budget)`. Its row is therefore reported over all carries and over
carries whose pair was not stranded before its deploy.

Prompt text and skill clauses are requests; a stage whose metric has not moved two weeks after rollout is retired or
redesigned.

## 10. Sequencing

1 → 2 → 3 → {4, 5}, with one exception: stage 4's rescue policy (rules 1–3 and their tests) reads only the
transcript, the limits files and the swap log, needs nothing from stages 1–3, and ships any time; stage 4's refusal
of swaps that cut work reads stage 3's manifest scan and ships after it. Stage 6 ships in two parts. The first — the spawn variable (after its one-week baseline, §5.6),
the dead-scope report, the inert stop, and the harness fix — needs nothing from stages 1–5 and
can ship any time. Before stage 3 no handoff record exists, so a handed-over waiter with no CPU and no socket can be
stopped; that is §5.6's named cost. The second, ccd stopping a scope when it ends a pane, ships with or after stage
3 and the stage-2 decision on native handoff, whose record it reads. Stage 7 is independent. Stage 5's clauses are appended after the landing spec's
stage 1. The landing spec's stage 5 needs this spec's stage 1.

## 11. Operator decisions

Decided on the written spec, 2026-09-23 — items 1–2 first, items 3–5 on the measurements recorded under each:

1. **No backfill of the historical backlog** (C9) unless a programme needs one. Workflow journals and agent
   transcripts stranded on source accounts by past `(kept)` carries stay where they are; a first pass counted about
   850 run directories and a second could not reproduce the count, so the committed instrument re-derives it if a
   programme asks.
2. **Re-seed the route records seeded under the pre-#169 default** (C10). Executed the same day: of the 41 sessions
   with a registry row, one record's only class write was the pre-#169 spawn default — this spec's authoring
   session — and it was reset through `cmd_route` with `actor=operator-ruling`. The one other record saying Fable,
   claude-rp-llm, was set by the operator from the PWA and is untouched. No code ships for it.

3. **The rescue-wait bound is 10 minutes** (C13; §5.4 rule 2). Against the 168 rescues of §1.2 on a five-hour window (150 on a session
   banner, 18 on a monthly-spend banner), of 248:

   | `RESCUE_WAIT_BOUND` | Rescues that would have waited | Minutes waited, total | Swaps avoided / round trips avoided | Live delegated work kept |
   |---|---|---|---|---|
   | 0 (today) | 0 | 0 | 0 / 0 | — |
   | 5 min | 2 | 6 | 2 / 0 | 0 |
   | 10 min | 3 | 13 | 3 / 0 | 0 |
   | 15 min | 7 | 60 | 9 / 2 | 0 |
   | 30 min | 18 | 300 | 25 / 7 | 0 (1 swap that had resumed fine) |
   | every five-hour block | 168 | 18,024 | 215 / 47 | unmeasured (19 had live work at the rescue) |

   Each count is an upper bound: the wait also needs Claude Code's auto-continue armed on the pane (§5.4 rule 2),
   which no log recorded at rescue time; §9's stage-4 instrument counts the waits from the first deploy.
   No bound at or under 30 minutes avoids a bounce, and the one near-reset rescue recorded as dropping live work
   was an agent that had already died on the limit four seconds before the rescue. A wait almost never saves wall
   clock: one rescue in 248 fired closer to its reset than its swap took. Ten minutes costs almost nothing — 13
   minutes of waiting across the window — and avoids 3 swaps and their carries; no bound under 15 minutes avoids a
   round trip. The carried-in-banner check (rule 1) touches ten times as many rescues. A longer
   bound for delegated work waits on stage 2's sixth measurement.
4. **The inert-scope sweep (C11), which amends C3.** Stage 6 stops dead ccd pane scopes that have done nothing for
   six hours and serve nothing, and reports the rest (§5.6 item 2), rather than only reporting. On 2026-09-23 it
   stops 5 scopes, 22 processes, 20 MB, all test and probe leaks, and reports the other 7, including the two
   services live sessions still used; it collects the orphaned and zombied without touching anything that runs,
   serves or forks. The pressure-reap variable ships first (§10). The operator stopped the DynamoDB Local server the
   same day (2026-09-23 21:13 UTC, data file unchanged); MekWarLive restarts it from its own script when it needs it.
5. **The slice ceiling** (C14). 16 session deaths in 10 sessions from the OOM killer in a week, with the reap on,
   while the host had memory to spare (§1.3). The kill itself chose sensibly, usually a background worker; what
   turns it into a session death is `OOMPolicy=stop` on every pane scope, the user manager's `DefaultOOMPolicy`.
   Stage 2 step 7 measures `OOMPolicy=continue` on a scratch pane scope. Two alternatives are closed:
   - **An aggregate soft cap** (`MemoryHigh` on the slice or on `user@`) kills nothing and throttles every session
     at once. It froze the fleet on 2026-08-14 (`user@`) and on 2026-09-09 and three times on 2026-09-10 (the
     slice), and `deploy/assert-slice-policy.sh` refuses it at deploy.
   - **A higher hard cap** gains little: `user@1000` is capped at 26G on a 30.6 GiB host, so a slice `MemoryMax`
     above that is never reached, and the parent's limit or the host's OOM killer acts instead, with less say over
     the victim.
   Stage 6 does not wait for step 7: the reap fires below about 3 GiB of host memory, after the slice has already
   reached its ceiling, so the variable barely moves this risk; its own kill rule (§5.6) guards the rest.

6. **Open — a stalled session whose own account is the only one with room.** Measured from the code on
   2026-09-24: nothing re-sends a stalled session's turn on its own account after the reset, and the forced
   target choice never offers the current account, so the session idles until another target gains room — today
   and under stage 4 alike. A stop and resume on the same account would end that, because the landing's redrive
   re-sends the turn, but it is a restart ccd does not make today, against §6's first invariant. Recommended:
   leave it as today and count it — stage 4's instrument reports stalled no-room waits that outlive their own
   reset — and rule on it with the count in hand.

## 12. Out of scope, named

Preventing the rate-limit deaths themselves (no headroom estimation, C4); recovering the partial output of an agent
cut mid-turn (a resumed agent re-runs from its start); reconciling divergent transcripts across roots (counted and
named, never overwritten); server mail carrying resume lists; typing anything but the fallback's constant; the Codex
lane's delegation (`not-applicable`).
