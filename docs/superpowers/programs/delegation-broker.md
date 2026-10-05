# Program: delegation-broker

Spec: `docs/superpowers/specs/2026-10-04-delegation-broker-design.md` (approved 2026-10-05, revisions R1–R9 included)
Plans: `docs/superpowers/plans/2026-10-05-delegation-broker-wave1-measurement.md` (wave 1); waves 2–6 are planned one at
a time from wave 1's measured fields, before each wave's run opens
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-soft-basin` (the session that wrote the spec; claimant of run 271)
Workspace: **a fresh child per wave**

**What this program is.** A coordinator that delegates through generic `Agent` / `Workflow` calls or a raw
`git worktree add` leaves nothing ccrc can see: no run edge, no hold, no history, no cleanup owner (spec §1). The
program adds a server-owned delegation broker in six stages, each shipping dark or report-only and enabled
separately: measure what Claude Code actually emits (1), observe it into a journal and a store (2), project it into
the fleet tree (3), adopt provable work and let a coordinator promote it into a real run (4), audit leftover
worktrees in shadow (5), and finally clean them through the existing safety spine (6). It never forbids `Agent` or
`Workflow`, never forces isolation, and never links work by a name, a path, a time or a working directory.

## Waves

| # | spec stage | scope | deploy class | depends on | PRs | state |
|---|---|---|---|---|---|---|
| 1 | 1 Measure | `SessionEnd` registered (captured in a `-hookcap` session, otherwise inert); the capture reducer's delegation block; the mock-API capture rig in the tree; the fixture corpus and its derived matrix; a read-only on-box census | fleet (the hook and installer reach homes through `ccrc update`); tests | — | — | **run 271 open** (`planned`) since 2026-10-05 15:20 UTC; dispatches once this ledger's PR merges |
| 2 | 2 Observe | hooks append to the spool; ingestion and cursors; the one `delegation_*` migration; census extension; correlation and reconciliation, report-only; the coordinator-intent route; coordinator clause 17 | fleet first, then server; skills | wave 1's matrix and its real-lane cross-check | — | to plan once wave 1's measurement section is complete |
| 3 | 3 Project | the `delegation` frame; activity and lease rows in the PWA | server + pwa | 2 | — | to plan |
| 4 | 4 Adopt | `ws-lease-mark` and carriers; read-only `ws-lease-audit`; adoption; digest mail; retain and resolve; promotion through `ws-add --base` | **AGENT-FIRST**, then server | 3 | — | to plan |
| 5 | 5 Clean (shadow) | audit tokens for due leases; shadow rows; the shadow review | server | 4 | — | to plan |
| 6 | 6 Clean (live) | `ws-lease-clean`; the executor taking a target record | **AGENT-FIRST**, then server | 5; CCR-15 wave 4's sweep (merged #215, live) | — | to plan |

## Measurement matrix (wave 1 fills this section)

Wave 1's answers to spec §8.1, per Claude Code version, read from the committed corpus
(`server/test/fixtures/delegation/matrix.json`, derived by `server/test/delegation-rig/build-matrix.mjs` from 98
synthetic rig captures: mock API, fixture HOME, fixture repo). The on-box census names projects by label only, and
the hook-side costs are below. After wave 1 merges, the coordinator adds the real-lane cross-check (two lanes, D-3995)
under its own heading. Until that is here, nothing in waves 2–6 may depend on a hook field (spec §8.1).

**Versions covered:** 2.1.280, 2.1.281, 2.1.285, 2.1.286, 2.1.287, 2.1.288 and 2.1.289, each with 14 scenarios, and
all 98 cells are `measured`. The fleet's installed lanes, re-read read-only at 2026-10-05 18:45 UTC (each lane's
last update result), run 2.1.286 (four lanes) and 2.1.289 (eleven lanes); an earlier read the same day had one lane
on 2.1.285 and ten on 2.1.289. **Every installed lane version is covered**, and no lane runs a version the corpus
lacks. Lane counts drift as lanes update; re-read them before relying on one.

**Scenario → §8.1 source** (the matrix is keyed by version × scenario, D-3998):
- Agent: `agent-plain`.
- Isolated Agent: `agent-iso-unchanged`, `agent-iso-changed`, `agent-iso-dirty`, `agent-iso-bg`, `interrupt-exit`
  and `parent-kill`.
- Workflow worker: `wf-plain`.
- Isolated Workflow worker: `wf-iso`, `wf-iso-resume` and `wf-limit-pause`.
- Raw `git worktree add` from Bash: `raw-worktree`.
- The session itself (Q5, which has no delegation source): `clear-compact-resume` and `swap-resume`.

### Corpus answers (plan Task 9 Step 1)

Status is read first: an unmeasured cell would print `unmeasured`, and none did. Inside a measured cell, "—" means
not observed. Session ids appear as ordinals (`s1`, `s2`), never as values.

| Question (scenario) | 2.1.280 | 2.1.281 | 2.1.285 | 2.1.286 | 2.1.287 | 2.1.288 | 2.1.289 |
|---|---|---|---|---|---|---|---|
| Q1 SubagentStart count; agent types (wf-plain) | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` |
| Q1 SubagentStart count (wf-iso) | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| Q2 tool name (agent-plain) | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` |
| Q2 `isolation` in PreToolUse input (agent-iso-unchanged) | yes | yes | yes | yes | yes | yes | yes |
| Q3 `agent_id` names `agent-<id>` (agent-iso-changed) | yes | yes | yes | yes | yes | yes | yes |
| Q3 meta carries `worktreePath` (agent / wf) | all / all | all / all | all / all | all / all | all / all | all / all | all / all |
| Q3 admin records named by a meta (agent / wf) | all / all | all / all | all / all | all / all | all / all | all / all | all / all |
| Q3 `CLAUDE_BASE` (agent / wf / raw) | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none |
| Q4 subagent Bash: count, with `agent_id` (agent-plain) | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 |
| Q4 subagent Bash: parent's session id / `cwd` in worktree | all / all | all / all | all / all | all / all | all / all | all / all | all / all |
| Q5 SessionStarts (clear-compact-resume) | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 |
| Q5 SessionStarts (swap-resume) | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 |
| Q6 trees left: unchanged / changed / dirty / bg / killed / interrupted / raw | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 |
| Q6 SessionEnd: interrupt-exit reasons / parent-kill count | none / 0 | none / 0 | none / 0 | none / 0 | none / 0 | none / 0 | none / 0 |
| Q7 wf-iso-resume: probes missed / records before kill / at end | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 |
| Q7 wf-limit-pause: probes missed | none | none | none | none | none | none | none |

What the table cannot show, read from the same fixtures' event order and key sets. Each item holds on all seven
versions unless it names one.
- **In the rig, every Agent and Workflow call launched in the background.** The launch's PostToolUse returned at
  once with an async-launch response. The parent's Stop then fired still counting one background task. The
  subagent's SubagentStop came later, and the result reached the parent only as a task-notification user turn.
  D-4005 recorded this on 2.1.289, where the smoke run was made; the corpus measures it on **all seven**. Six Agent
  scenarios set `run_in_background` false and agent-iso-bg set it true; no PreToolUse input carried the key. **A
  foreground Agent call is therefore unmeasured on every version.**
- The Agent launch response names the subagent's agent id, the same id SubagentStart carries. The Workflow launch
  response names the workflow run id, which names that run's `wf_<run>-<n>` admin records and its
  `subagents/workflows/wf_<run>/` meta directory, and it names a task id. Each Workflow worker's SubagentStart
  `agent_id` names its meta file. The task id, or the agent id for an Agent, is the id that the parent's Stop
  `background_tasks` and the closing task notification carry.
- SubagentStart and the launch's PostToolUse arrive in either order, and both orders occur within every version
  across the seven Agent scenarios. On 2.1.289, for example, SubagentStart came first in agent-plain,
  agent-iso-dirty and agent-iso-bg, and the launch came first in agent-iso-unchanged, agent-iso-changed,
  interrupt-exit and parent-kill.
- The Workflow PreToolUse input is the script alone. A worker's isolation is spelled inside the script text, never as
  a `tool_input` key.
- **Q5 compact is a measurement LIMIT, not "never fired".** The hook exits for a `compact` SessionStart before its
  capture arm (`ccd/session-hook.sh:2905`). That is the stall-watch exclusion its arm comment documents at
  `:2919-2922`. Compaction shows only as PreCompact/PostCompact, which carried the pre-compaction session id, and the
  rig's resume by that id continued under it. During `/compact`, one SubagentStop fired with an agent id, an empty
  agent type, and no SubagentStart. On 2.1.289 the resumed turn's Stop was not captured (two Stops where the other
  versions show three), and the session-id sequence is unaffected.
- **SessionEnd:** clear-compact-resume captured two on every version, one for `/clear` (fired under the old id just
  before the new id's SessionStart) and one for the final `/exit`. The SIGKILL between them fired none. swap-resume
  captured two, one for each `/exit`. interrupt-exit and parent-kill captured **none**. In interrupt-exit the
  Escape reached an idle prompt (the parent's Stop had already fired with one background task), and the matrix does
  not say whether the `/exit` that followed completed. This confirms §5.11 and changes nothing: a missing SessionEnd
  is never terminal evidence.
- **Q6 removal:** an unchanged isolated tree was removed natively for Agent and for Workflow. In wf-iso, the
  unchanged worker's tree went and the committing worker's tree stayed (its record holds the commit), and
  wf-limit-pause left nothing. Committed, dirty and background trees stayed, and so did the tree of a background
  agent still running when its parent exited (interrupt-exit) or was SIGKILLed (parent-kill); those two agents
  emitted no SubagentStop and no task notification.
- **Q3 raw:** a raw `git worktree add` record carries no `CLAUDE_BASE` but has a first `logs/HEAD` line, which
  confirms §5.5's fallback as the creation base of a rung-4 lease.
- **Q7:** in wf-iso-resume the hung worker **did not re-run within the probe window** after the parent's SIGKILL and
  `--resume`. No further SubagentStart fired, and the record left at the end is the one the before-kill snapshot
  held. In wf-limit-pause the worker answered after its mock 429 under one SubagentStart and one SubagentStop, and its
  probe was reached on every version. Whether a mock 429 provokes Claude Code's five-hour pause stays unknown
  (`wf-limit-pause-is-an-attempt`, D-3997).
- Q2 asked `Agent` or `Task`: the mock offers both names and Claude Code chose `Agent` every time (D-3994). A `Task`
  spelling is not observed, not excluded.

### Hook-side costs (Q8)

This is a bash micro-benchmark of the operations, not of the wave-2 hook (`q8-spool-cost-is-a-micro-benchmark`,
D-4000). It ran against `this-repo`'s main checkout, which held 74 admin records when the benchmark ran (72 at the
census). The repository with the most records is `project-1` (181), but its path is not read, so `this-repo` stood
in for it. The box was loaded: load average 46.81 / 41.83 / 37.04 on 16 CPUs, unchanged across the three repeats.

| Operation (1000 iterations, 3 repeats) | seconds per 1000 | per operation |
|---|---|---|
| list `<common-dir>/worktrees/*` (bash glob, no fork) | 0.570, 0.749, 0.597 | 0.57–0.75 ms |
| find the common dir (`read` of `.git`, no fork) | 0.047, 0.028, 0.051 | 0.03–0.05 ms |
| one ~1 KiB spool append (`printf >>`) | 0.106, 0.274, 0.210 | 0.11–0.27 ms |

The budget is the PostToolUse p95 pinned in `session-hook.test.ts`: 150 ms is the CI allowance and 50 ms is the
target. A worktree-mentioning Bash call costs two listings plus one append, at most about 1.8 ms at 74 records. Scaling
linearly to `project-1`'s 181 records gives about 1.8 ms per listing. That figure is an extrapolation, not a
measurement.

### On-box census (read-only, fleet box, 2026-10-05)

From `deploy/delegation-census.mjs` `.totals`. `adminRead` was `ok` for all five labels.

| label | records | agent | wf | other | metaFound | metaMissing | metaMalformed | metaPathless | homesUnreadable | multiHome | worktreeAbsent | byAge | byParent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| this-repo | 72 | 12 | 7 | 53 | 19 | 0 | 0 | 0 | 0 | 8 | 14 | <1h 72 | ccd-workspace 17, main-checkout 2 |
| project-1 | 181 | 73 | 1 | 107 | 74 | 0 | 0 | 1 | 0 | 64 | 5 | <1h 5, <1d 8, <7d 165, >=7d 3 | other 59, ccd-workspace 12, mixed 3 |
| project-2 | 51 | 20 | 7 | 24 | 27 | 0 | 0 | 7 | 0 | 10 | 3 | <1h 13, <7d 1, >=7d 37 | ccd-workspace 18, main-checkout 8, mixed 1 |
| project-3 | 6 | 2 | 0 | 4 | 2 | 0 | 0 | 0 | 0 | 1 | 0 | <1h 4, <7d 2 | ccd-workspace 2 |
| project-4 | 2 | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | <1h 1, >=7d 1 | none |

`metaMalformed`, `metaPathless`, `homesUnreadable` and `adminRead: 'not-main'` are the census's additive fields
(D-4008). The census records show more than the totals.
- Every `agent-*` and `wf_*` record, 123 of 123, carries a `CLAUDE_BASE` that agrees with its first `logs/HEAD` line.
- Every found meta's `worktreePath` equals its record's path.
- Three `other` records carry a `CLAUDE_BASE` too (`project-1` 2, `project-2` 1). A `CLAUDE_BASE` does not imply a
  delegated kind; these records' origin is unmeasured.
- Every `worktreeAbsent` record is of kind `other`.
- Two records are `locked`.

**Caveats.**
- `ageBucket` is the admin directory's mtime. It measures time since the last git activity on that record, **not the
  record's age**. Measured live, `this-repo` went from 48 `<1d` / 24 `<1h` to 72 `<1h` within minutes, with no census
  write.
- The `other` kind is large (`this-repo` 53 of 72), because ccd's own `ws/*` worktrees and any non-Claude worktree
  land there.

**Q9, as a proxy** (`q9-parent-class-is-a-proxy`, D-4001). `byParent` classes the working directory of each found
meta's parent.
- `main-checkout` is ALSO where every ccd `<wrapper>-<project>` session runs, so it cannot tell a ccd parent from a
  non-ccd one.
- `other` means neither the main checkout nor under the ccd workspace root. That could be a subdirectory, another
  checkout, or a session outside ccd.

Across the 122 found metas: `ccd-workspace` 49, `main-checkout` 10, `other` 59 and `mixed` 4. The non-ccd share is
therefore bounded only to between 0 and 73 of 122 (about 60%), and `project-1` carries almost all of it. Wave 2's
spool answers Q9 exactly: a tree whose parent wrote no spool line had a non-ccd parent.

**Q10, from source** (`incarnation-is-the-row-generation`, D-3996). `$REG/<id>.generation` (D-2605) serves as a
parent's registry incarnation.
- It is minted once, by a no-clobber `link`, in `_reg_generation_mint` (`ccd/ccd:3791`).
- It is never rewritten. It is removed only when the row is purged (`ccd/ccd:4091`).
- It is read through an owned alias in `_reg_generation_read` (`ccd/ccd:3752`).
- The hook sees it as `CCRC_SESSION_GENERATION` (`_hook_generation_ok`, `ccd/session-hook.sh:1303-1304`). ccd sets
  that variable only when the read succeeds at spawn, and otherwise spawns without it, with a warning
  (`ccd/ccd:20528-20553`). **So wave 2 reads the FILE, not the variable.**

### Amendments the measurement forces

Every rig-derived amendment below holds "in the rig" and stays provisional until the real-lane cross-check; the
census-derived `admin-record-without-its-tree` and the source-derived `incarnation-is-the-row-generation-file` are
the exception.

- `delegation-posttooluse-is-a-launch` — in the rig, every Agent and Workflow call launched in the background, its
  PostToolUse an async acknowledgement with the work ending later (its SubagentStop or the task notification); a
  foreground Agent's PostToolUse is unmeasured, so §5.3's "completion" stands for it until the real-lane cross-check
  (agent-*, wf-* cells) — spec §5.3 hook table, §5.2 execution, §5.11 terminal evidence.
- `launch-response-names-the-upstream-id` — the Agent launch response carries the subagent's agent id, and the
  Workflow launch response carries the workflow run id that names its `wf_` records and meta directory. Together
  they are the only spool-side join from a parent's `tool_use_id` to either, so the envelope gains them as validated
  tokens (every agent-*, wf-* cell) — spec §5.3 envelope, §5.4 rung 2.
- `activity-keyed-by-agent-id-not-arrival` — SubagentStart and the launch's PostToolUse arrive in either order, both
  orders occurring within every version across the seven Agent scenarios, so an Agent activity's upstream id is its
  agent id whichever event comes first, never the `tool_use_id` — spec §5.2 activity id.
- `run-end-is-a-task-notification` — a launch ends, for the parent, as a task-notification user turn naming the
  launch's task id, and that id leaves the next Stop's `background_tasks`. This is the only "workflow-run-ended
  evidence" the corpus shows, so the spool records that task id and never the prompt text (wf-plain, wf-iso,
  wf-limit-pause) — spec §5.2 execution, §5.11.
- `workflow-isolation-is-in-the-script` — the Workflow PreToolUse input is the script alone, so
  `tool_input.isolation` never exists for a Workflow. A worker's isolation is read from its meta's
  `spawnedWithWorktree` / `worktreePath` (wf-plain, wf-iso) — spec §5.3 PreToolUse row.
- `sessionend-on-clear-is-a-rotation` — a SessionEnd fires under the old id immediately before the `clear`
  SessionStart under the new one, so a SessionEnd's reason separates an id rotation from an exit, and the
  session-UUID history records the pair as one rotation (clear-compact-resume) — spec §5.3 SessionEnd row,
  §5.2 `delegation_sessions`.
- `orphaned-background-agent-has-no-terminal-event` — a background isolated agent still running when its parent
  exits or is SIGKILLed leaves its tree, unchanged included, with a SubagentStart and no SubagentStop or
  notification. Under the ephemeral rule such a tree is never due unless the parent is proved dead, so wave 2 must
  name what ends it (interrupt-exit, parent-kill) — spec §5.11 clocks and terminal evidence, §5.2 execution.
- `workflow-worker-not-rerun-after-restart` — after a parent SIGKILL and `--resume`, the hung isolated worker did not
  re-run within the probe window, and its record stayed. "A paused workflow is not ended" must not wait on a resume
  the corpus never saw (wf-iso-resume, probe missed on all seven) — spec §5.11, §5.12 restart.
- `compact-sessionstart-is-not-captured` — the hook exits for a `compact` SessionStart before capture, and compaction
  showed no id change in PreCompact/PostCompact. "Rotates on compaction" is unmeasured, and wave 2's spool line for
  that SessionStart must be written inside its arm before the exit (clear-compact-resume) — spec §3 `_sync_uuid` row,
  §5.2, §5.3.
- `compaction-fires-an-unpaired-subagentstop` — `/compact` emits a SubagentStop with an agent id, an empty agent
  type, and no SubagentStart or launch, so a SubagentStop alone never opens an activity (clear-compact-resume) —
  spec §5.2 activity, §5.3.
- `admin-record-without-its-tree` — 22 records (`this-repo` 14, `project-1` 5, `project-2` 3; census
  `worktreeAbsent`) name a worktree directory that is gone. The workspace dimension has no value for that state, so
  the census extension reports it distinctly, never as `present` — spec §5.2 workspace, §5.5 census.
- `incarnation-is-the-row-generation-file` — the parent's incarnation is `$REG/<id>.generation`, read from the file,
  because `CCRC_SESSION_GENERATION` is absent on every spawn whose generation read failed (Q10 above, D-3996) —
  spec §5.1 parent key.

### Real-lane cross-check

Pending: the coordinator runs it after wave 1 merges, per the plan's "After the merge" steps.

## Decisions & deviations

- **2026-10-01 to 2026-10-04 — the operator's rulings during design** (spec §2): route 1 (a delegation broker plus
  reconciliation); ephemeral workers render as activity under their parent; durable work outside `runs dispatch` is
  auto-adopted and guided; coordinator identity is explicit intent plus inferred escalation; nesting lasts until
  the workspace is reclaimed; ephemeral worktrees are cleaned under the CCR-15 / workspace-lifecycle spine; the new
  ccd verbs are workspace-lifecycle verbs, not coordination mutation; four corrections from measurement.
- **2026-10-05 — operator decision: spec approved with revisions R1–R9** (spec §2.1): promotion dispatches a child
  from the lease's tip; only the server journal creates a lease; rungs 3 and 4 narrowed; hour-bucketed spool; a
  separate read-only `ws-lease-audit`; admission rung 6 replaced; a `delegation` frame; carriers and the audit ship
  in stage 4; a worker's leases nest under the top coordinator "via <worker>".
- **2026-10-05 — planning shape.** Wave 1 is planned in full now. Waves 2–6 are planned one at a time, each from the
  fields wave 1 measured, because the spec forbids a contract on an unmeasured field (§8.1). Each wave's plan is
  written and reviewed before its run opens.
- **2026-10-05 — operator decision: the programme runs through ccrc** — wave 1 is dispatched as run 271 to a fresh
  child worker executing subagent-driven, not run in the spec-writing session (§10). The operator approved merging
  this ledger's docs PR once its checks are green.
- **2026-10-05 — the parent incarnation field is already in the tree** (spec §5.1, §8.1 item 10): `$REG/<id>.generation`
  (D-2605) is minted once at row creation and never rewritten. The hook also sees it as `CCRC_SESSION_GENERATION`, but
  ccd does not set that on every spawn path, so later waves read the file. Wave 1 records this from source.

Deviation numbers: each wave's block is minted at its run-open and recorded here in prose; no number is spelled as
a `D-` token in this file until a plan defines it. **Wave 1 (run 271):** twenty numbers, 3992 through 4011, minted
2026-10-05 15:20 UTC. The plan's ten slugs take the first ten in the order the plan lists them; the rest are for
departures found mid-wave (Tasks 4–6's rig fixes among them). Numbers not used stay unused; nothing re-issues them.

## Carried constraints

- macOS CI legs are flaky by ruling and gate nothing; mutation-table discipline (every guard ships with a red);
  `ccd/ccd` re-stamped after every edit; README citation instruments green; no stage marker gains a writer.
- **ccrc never registers `WorktreeCreate` or `WorktreeRemove`** — either replaces Claude Code's native worktree
  handling (spec §3.1). The installer's event list is pinned.
- `ws-reclaim` stays child-only; `ws-expire` (unbuilt) stays archive-only; no skill names a lease verb.
- **Real-lane captures never leave the fleet box**: only `deploy/hook-capture-reduce.mjs` output is committed.
  **Rig captures are synthetic** (a mock API, a fixture HOME, a fixture repo), so their payloads may be committed
  after the rig's fail-closed allowlist sanitiser, and the public-content guard (`topology-clean.test.ts`) passes on
  them. Project names are operator data: measurement write-ups name projects by label only.
- Nothing new lands above `ccd/session-hook.sh:2900` (README's anchor); edits above it stay line-neutral.
- `CLAUDE.md`'s amendments (spec §13) land with the wave that ships each verb or route, not before.
- The program runs through `runs open` / `runs dispatch`; open wave N+1's run before closing wave N's.

## Next-wave brief

**Wave 1 — measurement.** Plan: `docs/superpowers/plans/2026-10-05-delegation-broker-wave1-measurement.md`, read at
the sha the brief names. A fresh child workspace from `main`. Deploy class: the hook and installer change reach the
fleet through `ccrc update`; everything else is tests and fixtures. One PR. After the merge, the coordinator runs the
plan's real-lane cross-check (two lanes, `-hookcap` sessions) and writes its reduced tables into the measurement
matrix section above, with the corpus's. Dispatch preconditions: the plan is on `main`; one active-run slot; the
daily dispatch cap has room.
