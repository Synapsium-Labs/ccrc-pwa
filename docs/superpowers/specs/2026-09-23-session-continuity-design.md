# Session continuity — delegated work, swaps, background processes and operator state survive a restart — design

**Status:** design approved in the brainstorm by the operator 2026-09-23 (rulings in §3); rev 2 after a six-lens
adversarial review (all surviving findings applied) and a rev-3 verification pass; written spec awaiting operator review · **Date:** 2026-09-23 ·
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

When one account hits its window, every in-flight agent dies within about two minutes; the Workflow runtime marks
each failed and the script usually completes with holes. Claude Code's own in-process wait, which pauses
rate-limited agents until the reset, engaged in 18 runs.

### 1.2 The swap

| Swaps, 2026-09-08..09-23 | Value |
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

Five mechanisms, read off the source at `bbb5e714`:

1. **The carry drops work.** `_swap_carry_sidecars` (`ccd/ccd:21492`) copies a session's sidecar directory
   (`<root>/projects/<project>/<uuid>/`: subagent transcripts, tool results, workflow journals) only when the
   destination does not exist. On a return visit it logs `(kept)` and skips the tree, so everything created
   since the session last left that account stays behind. The rule is an anti-nesting guard (copying a directory
   onto an existing one nests it) and avoids a half-merged tree; its own comment records that a partially built
   destination makes the skip permanent.
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

### 1.3 Background processes

| Background processes | Value |
|---|---|
| Unique background tasks Claude Code stopped "because the system is running low on memory", since 2026-09-04 | 186 in 44 sessions |
| … mapped to a command (186 minus 53 unmapped; `reaper/classify_kills.py`) | 133 |
| … of those: CI, PR, deploy or limit watchers / test suites | 76 / 25 |
| Pane scopes whose tmux pane is gone, 2026-09-23 | 13, holding 33 processes and 1.3 GB |
| … of which one DynamoDB Local server a pane started 27 days earlier | 1.27 GB |

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
  slot inside the carry itself so every restart path is covered (§5.1).
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
| C3 | Reaper: "is there no more elegant way?" — no heuristic sweep (operator). | Stage 6: one variable plus the scope boundary the kernel enforces. |
| C4 | Headroom estimation dropped (operator). | No fan-out gate. Target choice keeps using the limits files it already reads. |
| C5 | "Enhance recovery during account swap similar to how Claude Code itself does it" (operator). | Stage 2 spike decides stage 3's mechanism. |
| C6 | AMENDS post-swap-redrive R1 / D-2236: the rescue holds instead of swapping when the reset is near or no target has room. | Stage 4. Slug for minting at plan time: `rescue-holds-near-reset`. |
| C7 | AMENDS routing §5.3 "a keystroke not accompanied by a field write is transient": the operator's own `/model`/`/effort` is written to the record before a restart. | Stage 7. Slug: `operator-model-survives-restart`. |
| C8 | REVERSES the carry's "an existing destination is LEFT ALONE rather than merged". | Stage 1. Slug: `sidecar-carry-merges`. |

## 4. Roles and authority

- **ccd** carries, stops gracefully, writes the manifest, spreads rescues, reports and stops dead scopes of its
  own panes, honours the route record. It never resumes anything itself and never types beyond the existing
  redrive fallback's constant text.
- **The session (the model)** decides whether to resume. It is told what was in flight and the literal call that
  resumes it; that is a request, and §9 measures whether it is honoured.
- **Hooks** record launches (PostToolUse) and deliver the manifest (SessionStart). They never deny a launch.
- **The server** reads what ccd wrote and shows it; it never parses Claude Code's journal formats, never mails a
  resume list, and runs nothing but `tmux` and `ccd`.
- **The operator** sees counts on the phone and on the run, overrides a refused swap with the counts in view,
  activates the scope stop after its report-only week, and rules on §11.

## 5. The design, in stages

Stage N is §5.N.

### 5.1 Stage 1 — the carry merges instead of skipping (ccd only)

**Prerequisite measurements, before code:** stat inode and size of one live `journal.jsonl` and one
`agent-*.jsonl` before and after an agent writes, and of a `workflows/<runId>.json` write, to confirm which files
are appended in place and which are replaced; explain the 389 `(copy)` fallbacks on a box where every root is on
one device. The rules below are written for append-in-place logs and rewritten records; if the measurement says
otherwise, the rules change before the code.

In `_swap_carry_sidecars`, the branch taken when the destination exists walks the source tree file by file and
decides on content and size, never on inode identity:

| Source vs destination | Action | Counted |
|---|---|---|
| absent at destination | hardlink, or copy when linking fails | `+N` |
| equal size and equal bytes | nothing | no |
| append-only log (`*.jsonl`), destination a strict byte-prefix of a larger source | replace by temp file and rename | `~R` |
| append-only log, destination longer than source and source its prefix | keep destination (it is further along) | no |
| append-only log, neither a prefix of the other | keep destination | `!D`, named in the manifest with the longer copy's path |
| rewritten record (`workflows/<runId>.json`, `agent-*.meta.json`, `workflows/scripts/*`), source newer | replace | `~R` |

Nothing is deleted. The first carry to an account keeps today's path unchanged, including the anti-nesting guard
and the clear-then-copy fallback. A destination left partial by an earlier failure is repaired by the walk rather
than kept forever. The log line becomes `sidecar <uuid> -> <dst> (merged +N ~R !D)`.

**Bounded.** The walk reads both copies, where `(kept)` read nothing. It takes a box-wide non-blocking slot of
its own, inside the carry itself, so every path is covered — rescue, auto-home, manual swap, revival — not only
the ones that pass through `_dispatch_swap`. When the slot is busy, or the walk exceeds its byte budget, the
carry falls back to today's `(kept)`, logged as `(kept: busy)` or `(kept: budget)`; it never waits, because the
unit is already stopped. The slot is the one park-and-wake R4 designed if that has shipped, otherwise its own.

Tests under `makeCcdHarness` with fixture homes, each red when its rule is removed: a return visit carries new
journals; an equal file is untouched and uncounted; a prefix journal is extended; a longer destination is kept; a
diverged journal is kept and counted; a newer record replaces; nothing is deleted; no nesting on an existing
destination; a partial destination is repaired; the budget falls back. The `ccd/ccd` edit re-stamps the generated
header and follows the compaction-card citation-corpus procedure.

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
   refusals.

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
| `diverged` | from stage 1, naming the longer copy |
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

### 5.4 Stage 4 — rescue timing, the herd, and swaps that cut work (ccd; needs stage 3)

**The rescue policy (C2, C6).** A rate-limited turn is lost either way — Claude Code's wait re-runs it after the
reset, and a resume after a swap re-runs it too — so waiting saves only the swap and the risk that the model does
not resume, and stage 3 removes most of that risk.

1. **Swap at once** when a placeable target with room exists.
2. **Hold** — leave Claude Code's armed auto-continue alone, on the session's CURRENT account — only when that
   account's reset is within a bound (10 minutes, a knob) or no placeable target has room. The hold ends at the
   reset, when Claude Code's own armed timer continues the turn, or in a swap when a target gains room.
3. **Spread and do not bounce.** Target choice skips an account the session just left blocked and prefers a target
   that has not received a rescue within the last few minutes when another placeable target exists. A session
   already rescued three times in the last hour is not rescued a fourth time at once: it takes a **chain hold**
   on its current account for at most 30 minutes (a knob), then swaps to a target with room that is not the
   account it just left blocked. The chain hold is distinct from rule 2's near-reset hold and has its own end.
   Both sit inside, not instead of, `SWAP_COOLDOWN` and `SWAPBLOCK_COOLDOWN`.

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
   beside the resume variables, once the scope stop of item 2 is active (§10). Watchers can already opt out today
   by using the Monitor tool instead of Bash `run_in_background`; stage 5's worker clause says so.
2. **Report dead scopes, then collect them by ownership.** Every ccd pane runs in its own transient scope under
   the session slice, and its processes stay there unless something deliberately moves them to another unit
   (`systemd-run --user --scope`), which is how a declared service should leave.
   - `ccd-cap-scopes` already enumerates pane scopes every minute. It reports each scope that belongs to ccd's own
     tmux server under the session slice, whose pane no longer exists, and whose processes no live handoff record
     names: scope, processes, age, memory. Scopes of any other tmux server are never touched; pinned by a test.
   - For one week that report is all it does, surfaced by doctor. Then the operator activates the stop, and it
     stops those scopes. The DynamoDB Local server in §1.3 is exactly what the week is for: a service a session
     started on purpose belongs in a unit, and doctor lists every pane-scope process older than a day.
   - When ccd itself ends a pane (stop, swap, archive), it stops that pane's scope after the stage-3 handoff,
     unless a live handoff record names any process in it; then it reports the scope instead of stopping it,
     because a scope stop ends every process in the scope.
3. **Fix the test leak** at its source: the limit-banner test harness kills its child's whole process group on
   timeout.

Named trade: with the pressure reap disabled, a pane's background children share its scope with the live Claude
Code process. At the pane scope's `MemoryHigh` (8G, set by `ccd-cap-scopes`) the whole scope is throttled, the
session included; at its `MemoryMax` (12G) or the slice ceiling the kernel's OOM choice can take the Claude Code
process — a mid-turn session death. Hence the order in §10: the variable ships only once the stop is active, and
Claude Code's reap stays on through the report-only week. §9 measures `memory.events` high and oom_kill per pane
scope and the supervisor revivals they cause. An aggregate `MemoryHigh` must never return to the slice.

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
- **A new, named process-stop authority, bounded.** Stage 6 stops scopes of ccd's own dead panes, after a
  report-only week the operator ends, never scopes of another tmux server.
- **ccd is the authority** on files and sessions; nobody touches `~/.cc-sessions`, tmux or a unit outside ccd.
- **The server never runs git or Claude Code** and never parses journal formats.
- **Additive wire**, one reader per field per mode, absence means unknown, `FLEET_PROTO` unchanged.
- **Mutation-table discipline** for every guard named above.
- **Per exec kind.** A session with no Claude Code transcript (the Codex lane) is `not-applicable`, never an empty
  list and never a refusal, and gets no variable it does not read.

## 7. Surfaces touched

| Area | Change |
|---|---|
| `ccd/ccd` | carry merge; the carry and scan slot and budgets; graceful stop; keystroke journal `.typed`; manifest writer and scan; composed prompt; rescue hold, spread, no-bounce; in-flight refusal and its refusal word; `--cut-delegated`; scope stop on pane end; route write from `/model`/`/effort`; re-stamp and citation-corpus procedure |
| `ccd/ccd-cap-scopes` | dead-scope report, then stop, own tmux server only |
| `ccd/session-hook.sh`, `server/test/session-hook.test.ts` | PostToolUse launch record with validation; SessionStart manifest subject with its own ceiling, re-pinned under the 10,000-character spill |
| `ccd/worker-skill`, `ccd/coordinator-skill`, `ccd/reviewer-skill`, `references/review-panel.md`, `README.md`, `CLAUDE.md` | clauses, paragraph, count words; pins |
| `server/src/server.ts` (swap route), `server/src/ccdargv.ts` | `--cut-delegated` mint site and body field; the refusal's own 409 |
| `agent/src`, `server/src` (`watch.ts`, `fleet.ts`, `coord/routes.ts` signals), `shared/api.ts` | the `delegations` field, readers per mode, run signals |
| `pwa/src` | session-card chip; swap-sheet on-demand counts and override |
| `server/test` (limit-banner harness) | process-group kill on timeout |
| `deploy/measure-continuity.py` (new, read-only) | the instruments of §9 |

## 8. Failure modes named

- **The handoff fires but its record lands where the carry did not bring it:** why stage 1 ships first and the
  spike measures the job directory's root.
- **Mass rescue I/O:** the carry walk and the manifest scan take a non-blocking slot on every path and run under
  byte budgets, falling back to `(kept)` or `unmeasured` rather than waiting; the swap body is the place, never the
  spawn path; §9 measures `(kept: busy)`, `(kept: budget)` and the `unmeasured` rate.
- **The model ignores the manifest:** counts reach the operator and the coordinator anyway; §9 retires prompt text
  that measures no change.
- **A near-reset hold lasts longer than the reset promised:** bounded by the reset and ends in a swap.
- **A chain hold on an account with a far reset:** bounded at 30 minutes, then a swap that skips the account just
  left blocked.
- **The slice ceiling kills a live session** once the pressure reap is off: named in §5.6, measured in §9.
- **A dead-scope stop kills a wanted service:** a report-only week first, own tmux server only, doctor's list of
  long-lived pane processes.

## 9. Measurement, targets and the kill rule

Baseline frozen at 2026-09-08..2026-09-23. Committed with the plan: the carry counter over the swap log, the journal
census deduplicated by run id, the post-swap outcome classifier, the pressure-kill scan, the dead-scope census.

| Stage | Metric | Baseline | Target |
|---|---|---|---|
| 1 | `(kept)` carries by reason; journal-missing resume refusals | 774 of 1,310, all by existence; 8 | only `busy`/`budget`, under 2%; 0 |
| 2 | spike outcome | — | decides stage 3 |
| 3 | rescues with live work that resumed the exact run; finished agents re-run by relaunches; manifest writes ending `unmeasured`; stalled vs not-stalled restarts with a non-empty manifest | 11 of 30; up to 3.6M tokens; —; — | over two thirds; near 0; under 5%; reported |
| 4 | sessions with 4 or more auto-rescues in an hour; chain holds that end without a swap; non-rescue swaps that cut delegated work | at least 1 (archive max 4); —; 4 of 5 manual swaps with live work | 0; 0; 0 |
| 5 | holed or unmeasured wave-dones accepted without a note | not measured | 0 |
| 6 | pressure kills of background shells; dead ccd-pane scopes after the stop activates; pane-scope `memory.events` high and oom_kill, and the revivals they cause | 186 since 2026-09-04; 13; measured from the report week | 0; 0; no rise over the report week |
| 7 | restarts that revert an operator's `/model` | this session's case | 0 |

Prompt text and skill clauses are requests; a stage whose metric has not moved two weeks after rollout is retired or
redesigned.

## 10. Sequencing

1 → 2 → 3 → {4, 5}. Stage 6's report and the harness fix can ship any time; its stop activates after stage 3 and
the report-only week; its variable ships only with or after the stop's activation, so Claude Code's reap stays on
until orphans have a collector. Stage 7 is independent. Stage 5's clauses are appended after the landing spec's
stage 1. The landing spec's stage 5 needs this spec's stage 1.

## 11. Operator decisions left open

1. **Backfill the historical backlog?** Workflow journals and agent transcripts stranded on source accounts by past
   `(kept)` carries. A first pass counted about 850 run directories; a second pass could not reproduce the count,
   so the committed instrument re-derives it before any decision. Recommended: no backfill unless a programme needs
   one.
2. **Re-seed route records seeded under the pre-#169 default?** Records whose only class write is the spawn default
   still say Fable. Recommended: yes, one-off, through `cmd_route` with its own actor, for records with no operator
   write.
3. **The hold bound.** Ten minutes to reset is the proposed default for holding instead of swapping.
4. **Activating the scope stop** after the report-only week, and moving the long-lived pane services it lists into
   units.

## 12. Out of scope, named

Preventing the rate-limit deaths themselves (no headroom estimation, C4); recovering the partial output of an agent
cut mid-turn (a resumed agent re-runs from its start); reconciling divergent transcripts across roots (counted and
named, never overwritten); server mail carrying resume lists; typing anything but the fallback's constant; the Codex
lane's delegation (`not-applicable`).
