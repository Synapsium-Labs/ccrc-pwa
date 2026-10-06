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
all 98 cells are `measured`. Measured means measured **within the rig**, and two of §8.1's situations are reached
only through a proxy (`oom-and-account-swap-are-proxies`, D-4066):
- **Parent crash is a SIGKILL of the parent's Claude Code process** (`kill9` in parent-kill, wf-iso-resume and
  clear-compact-resume). It is the rig's proxy for §8.1's OOM column. A cgroup OOM kill of the pane's scope can take
  the whole process tree, not the parent alone; whether it does is the unit's OOM policy (an assumption about the
  box's systemd and cgroup settings, not measured here), and that case is unmeasured.
- **The account swap is a config-dir swap.** swap-resume's `swapConfig` copies the fixture config dir to a second
  one under the same fixture HOME, with the same mock auth, and resumes there. It is not a swap between accounts.

The seven interrupt-exit cells were re-captured in fix round 1 (D-4058); the other 91 are the first capture's, and
`matrix.json` re-derives byte-identically from the corpus. The fleet's installed lanes, re-read read-only at
2026-10-05 18:45 UTC (each lane's last update result), run 2.1.286 (four lanes) and 2.1.289 (eleven lanes); an
earlier read the same day had one lane on 2.1.285 and ten on 2.1.289. **Every installed lane version is covered**, and
no lane runs a version the corpus lacks. Lane counts drift as lanes update; re-read them before relying on one.

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
not observed. Session ids appear as ordinals (`s1`, `s2`), never as values. A run's notes are outcomes here, never
failures: the only notes in the corpus are `probe ["r1-resumed"]: not reached` (wf-iso-resume) and
`dialog answered: Background work is running` (interrupt-exit), each on all seven versions, and no fixture carries a
failure note. Each row names the scenario it reads.

| Question (scenario) | 2.1.280 | 2.1.281 | 2.1.285 | 2.1.286 | 2.1.287 | 2.1.288 | 2.1.289 |
|---|---|---|---|---|---|---|---|
| Q1 SubagentStart count; agent types (wf-plain) | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` |
| Q1 SubagentStop count; agent types (wf-plain) | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` |
| Q1 SubagentStart count (wf-iso) | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| Q2 tool name (agent-plain) | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` |
| Q2 `isolation` in PreToolUse input (agent-iso-unchanged) | yes | yes | yes | yes | yes | yes | yes |
| Q3 `agent_id` names `agent-<id>` (agent-iso-changed) | yes | yes | yes | yes | yes | yes | yes |
| Q3 meta carries `worktreePath` (agent-iso-changed / wf-iso) | all / all | all / all | all / all | all / all | all / all | all / all | all / all |
| Q3 admin records named by a meta (agent-iso-changed / wf-iso) | all / all | all / all | all / all | all / all | all / all | all / all | all / all |
| Q3 `CLAUDE_BASE` (agent-iso-changed / wf-iso / raw-worktree) | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none |
| Q4 subagent Bash events, with `agent_id` (agent-plain: the PreToolUse and PostToolUse of one Bash call) | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 |
| Q4 subagent Bash: parent's session id (agent-plain) / `cwd` in worktree (agent-iso-changed) | all / all | all / all | all / all | all / all | all / all | all / all | all / all |
| Q5 SessionStarts (clear-compact-resume) | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 |
| Q5 SessionStarts (swap-resume) | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 |
| Q6 trees left: agent-iso-unchanged / -changed / -dirty / -bg / parent-kill / interrupt-exit / raw-worktree (the first six read `worktreesLeft`; raw-worktree reads `otherRecordsLeft`, its admin record, since its tree is outside `.claude/worktrees` and its `worktreesLeft` is 0) | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 |
| Q6 SessionEnd: interrupt-exit reasons / parent-kill count | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 |
| Q7 wf-iso-resume: probes missed / records before kill / at end | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 |
| Q7 wf-limit-pause: probes missed | none | none | none | none | none | none | none |

The SubagentStop row is read from the cell's `events` (count, each with an `agent_id`) and the fixtures'
`agent_type`; on every version the two SubagentStops carry the same two agent ids as the two SubagentStarts.
agent-plain's subagent is not isolated, so its own `cwd`-in-worktree reading is `none` on every version; the "all"
in that row is agent-iso-changed's.

What the table cannot show, read from the same fixtures' event order and key sets. The delegated cells are the 77 of
the eleven Agent and Workflow scenarios. Each item holds on all seven versions unless it names one.
- **In the rig, every Agent and Workflow call launched in the background** (77 of 77 launches). The launch's
  PostToolUse returned at once with an async-launch response. Where the parent's turn then ended with a Stop (70
  cells, all but interrupt-exit's seven), that first Stop listed one `running` background task. **The order of that
  Stop and the subagent's SubagentStop varies:** the SubagentStop came after it in 60 cells and before it in three —
  2.1.280 and 2.1.281 agent-iso-unchanged, and 2.1.289 wf-plain's first worker — and never fired in parent-kill or
  interrupt-exit. A finished launch's result reached the parent only as a task-notification user turn (56 cells:
  agent-plain, the four agent-iso scenarios, wf-plain, wf-iso and wf-limit-pause). D-4005 recorded the background
  launch on 2.1.289, where the smoke run was made; the corpus measures it on **all seven**. Six Agent scenarios set
  `run_in_background` false and agent-iso-bg set it true; no PreToolUse input carried the key (49 of 49 Agent
  launches). **A foreground Agent call is therefore unmeasured on every version.**
- The Agent launch response names the subagent's agent id, the same id SubagentStart carries. The Workflow launch
  response names the workflow run id, which names that run's `wf_<run>-<n>` admin records and its
  `subagents/workflows/wf_<run>/` meta directory, and it names a task id. Each Workflow worker's SubagentStart
  `agent_id` names its meta file. The task id, or the agent id for an Agent, is the id that the parent's Stop
  `background_tasks` and the closing task notification carry. The closing notification also carries the launch's
  `tool_use_id` as `<tool-use-id>` (56 of 56 notifications), and every SubagentStart's `prompt_id` equals its
  launching PreToolUse's (98 of 98 SubagentStarts).
- SubagentStart and the launch's PostToolUse arrive in either order, and both orders occur within every version
  across the seven Agent scenarios. On 2.1.289, for example, SubagentStart came first in agent-plain,
  agent-iso-dirty and agent-iso-bg, and the launch came first in agent-iso-unchanged, agent-iso-changed,
  interrupt-exit and parent-kill.
- The Workflow PreToolUse input is the script alone. A worker's isolation is spelled inside the script text, never as
  a `tool_input` key.
- **Q3 `worktreePath` is not always written: an isolated Agent's meta loses its worktree fields when its tree is
  removed natively.** agent-iso-unchanged's meta carries no `worktreePath`, `worktreeBranch` or
  `spawnedWithWorktree`; it carries `worktreeCleanlyRemoved: true` beside `agentType`, `description`, `toolUseId`,
  `spawnDepth` and the two request fields (7 of 7; no other meta in the corpus carries `worktreeCleanlyRemoved`). An
  unisolated Agent's meta (agent-plain) lacks the three fields too, and lacks `worktreeCleanlyRemoved`; every
  isolated Agent whose tree stayed carries all three (agent-iso-changed, -dirty, -bg, parent-kill and
  interrupt-exit: 35 of 35). An isolated Workflow worker's meta carries `worktreePath` and `spawnedWithWorktree`,
  never `worktreeBranch`, and keeps both after native removal (wf-iso's unchanged worker, wf-iso-resume's finished
  worker and wf-limit-pause's worker: 21 of 21). The table's Q3 rows read agent-iso-changed and wf-iso only, and
  `build-matrix.mjs` keeps only metas whose `spawnedWithWorktree` is true, so a rewritten Agent meta is invisible to
  those rows by construction.
- **`workflowPhase` is a measured rig-vs-box difference.** Spec §3.1 says a Workflow worker's meta carries
  `workflowPhase`. No Workflow meta in the corpus does (0 of 49), while on the fleet box 8 of the census's 15 `wf_*`
  records with a found meta list it among their meta keys (`this-repo` 7, `project-1` 1, `project-2` 0). The
  real-lane cross-check checks it.
- **Q5 compact is a measurement LIMIT, not "never fired".** The hook exits for a `compact` SessionStart before its
  capture arm (`ccd/session-hook.sh:2905`). That is the stall-watch exclusion its arm comment documents at
  `:2919-2922`. Compaction shows only as PreCompact/PostCompact, which carried the pre-compaction session id, and the
  rig's resume by that id continued under it. During `/compact`, one SubagentStop fired with an agent id, an empty
  agent type, and no SubagentStart. On 2.1.289 the resumed turn's Stop was not captured (two Stops where the other
  versions show three), and the session-id sequence is unaffected.
- **SessionEnd:** clear-compact-resume captured two on every version, one for `/clear` (fired under the old id just
  before the new id's SessionStart) and one for the final `/exit`; the SIGKILL between them fired none. swap-resume
  captured two, one for each `/exit`. parent-kill captured none. interrupt-exit captured exactly one, reason
  `prompt_input_exit`, as the parent's last event. Its run (re-scripted in fix round 1, D-4058): the mock held the
  parent's post-launch request (label `main-hang`, reached on every version), so the Escape landed in a live
  main-loop turn, and no Stop fired. The `/exit` that followed opened Claude Code's "Background work is running"
  dialog on every version (the fixture note), and the rig answered it with Enter, which takes its first and default
  option, "Exit and stop tasks" (the option was read from the pane on 2.1.280 and 2.1.289 while re-scripting). The
  still-running agent then emitted no SubagentStop and no task notification, and its tree stayed. So a SessionEnd can
  end a parent whose agent never reports an end: it is a hint about the parent, never about its agents. A missing
  SessionEnd (parent-kill) is never terminal evidence either, which confirms §5.11. The dialog's other two options
  ("Move to background and exit", "Stay") are unmeasured. Superseded: before D-4058 the scenario's Escape reached an
  idle prompt (the parent's turn had already ended with a Stop), and its `/exit` stopped at this dialog unanswered, so
  that corpus's "none" measured no exit at all. That was OBSERVED on 2.1.289 only, from the pane while re-scripting;
  on the other six versions it is inferred, from the Stop that ends every old fixture (with no SessionEnd and no
  note, 7 of 7) and from the dialog the re-capture met on all seven.
- **Q6 removal:** an unchanged isolated tree was removed natively for Agent (agent-iso-unchanged) and for Workflow
  (wf-iso's unchanged worker, wf-limit-pause). wf-iso's committing worker's tree stayed (its record holds the
  commit). Committed trees stayed (agent-iso-changed, and agent-iso-bg, whose subagent commits too: its tip differs
  from its `CLAUDE_BASE` on 7 of 7), and so did a dirty one (agent-iso-dirty). **Nothing shows a tree staying because
  it ran in the background:** every Agent call launched in the background, agent-iso-unchanged's tree was removed,
  and the one scenario that asked for the background (agent-iso-bg) commits. The tree of an agent still running when
  its parent quit (interrupt-exit, through the dialog above) or was SIGKILLed (parent-kill, and wf-iso-resume's hung
  worker) stayed too. Those agents emitted no SubagentStop and no task notification, and all 21 of their trees are
  locked (amendment `orphaned-agent-tree-is-locked`).
- **Q3 raw:** a raw `git worktree add` record carries no `CLAUDE_BASE` but has a first `logs/HEAD` line, which
  confirms §5.5's fallback as the creation base of a rung-4 lease.
- **Q7:** in wf-iso-resume the hung worker **did not re-run within the probe window** after the parent's SIGKILL and
  `--resume`. No further SubagentStart fired, and the record left at the end is the one the before-kill snapshot
  held. In wf-limit-pause the worker answered after its mock 429 under one SubagentStart and one SubagentStop, and its
  probe was reached on every version. Whether a mock 429 provokes Claude Code's five-hour pause stays unknown
  (`wf-limit-pause-is-an-attempt`, D-3997).
- **Q2** asked `Agent` or `Task`. Claude Code offers its tools in each request, and the mock answers with the first
  entry of its `nameAny` list (`["Agent", "Task"]`) that the request offers, falling back to the list's first entry,
  `Agent`, when it offers neither (`mockapi.mjs`'s `toolName`: `… ?? tu.nameAny[0]`). So the mock's pick alone shows
  nothing; the evidence that Claude Code offered and executed `Agent` on every version is that the call RAN as
  `Agent`: a main-loop Agent PreToolUse and an `async_launched` PostToolUse on 49 of 49 Agent launches (D-3994).
  Whether it also offered `Task` cannot be told from the corpus: `Agent` is listed first, and no fixture records the
  offered tool list (`Task` appears in no fixture). A `Task` spelling is not observed, not excluded.

### Hook-side costs (Q8)

This is a bash micro-benchmark of the operations, not of the wave-2 hook (`q8-spool-cost-is-a-micro-benchmark`,
D-4000). It ran on 2026-10-05 against the repository with the most admin records, `project-1`'s main checkout,
which held 185 records at the start and at the end of the run (181 at the census). The load average was
25.06 / 22.22 / 23.77 at the start and 25.78 / 22.41 / 23.83 at the end, on 16 CPUs. Nothing in the repository was
written; the append went to a scratch file outside it, removed after.

| Operation (1000 iterations, 3 repeats) | seconds per 1000 | per operation |
|---|---|---|
| list `<common-dir>/worktrees/*` (bash glob, no fork) | 1.798, 1.595, 1.539 | 1.54–1.80 ms |
| find the common dir from a linked worktree (`read` its `.git` file, then `<admin>/commondir`; no fork) | 0.050, 0.044, 0.041 | 0.04–0.05 ms |
| find the common dir from the main checkout (the `read` fails on the `.git` directory, then `[[ -d ]]`) | 0.031, 0.027, 0.037 | 0.03–0.04 ms |
| one ~1 KiB spool append (`printf >>`) | 0.126, 0.107, 0.083 | 0.08–0.13 ms |

The commands, with placeholders: `<common-dir>` is the repository's `.git` directory, `<linked>` one of its linked
worktrees (whose `.git` is a file), `<main>` the main checkout, `$f` a scratch file outside the repository, and
`$line` the output of `printf '%01024d' 0`.

```bash
bash -c 'TIMEFORMAT=%R; time (for i in $(seq 1000); do a=("<common-dir>/worktrees"/*); done)'
bash -c 'TIMEFORMAT=%R; time (for i in $(seq 1000); do IFS= read -r l < "<linked>/.git"; g=${l#gitdir: }; IFS= read -r c < "$g/commondir"; done)'
bash -c 'TIMEFORMAT=%R; time (for i in $(seq 1000); do IFS= read -r l < "<main>/.git" 2>/dev/null || [[ -d "<main>/.git" ]]; done)'
bash -c 'TIMEFORMAT=%R; time (for i in $(seq 1000); do printf "%s\n" "$line" >> "$f"; done)'
```

The budget is the PostToolUse p95 pinned in `session-hook.test.ts`: 150 ms is the CI allowance and 50 ms is the
target. Spec §5.3 appends one line per event, and a worktree-mentioning Bash call writes two: its PreToolUse line
carries the before-listing and its PostToolUse line the after-listing. Each of the two finds the common dir, lists
and appends, so the call costs at most 2 × (0.05 + 1.80 + 0.13) ≈ 4.0 ms at 185 records. That is measured on the
largest repository, not extrapolated. Superseded: an earlier run on `this-repo` (74 records) stood in for it, and
its figure for `project-1` was a linear extrapolation (D-4011).

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
- HEAD shape, as read at this census: of those 123 records, 102 have a `ref:` HEAD (89 `agent-*`, 13 `wf_*`) and 21 a
  detached one (19 `agent-*`, 2 `wf_*`); ref / detached by label: `this-repo` 8 / 11, `project-1` 71 / 3,
  `project-2` 20 / 7, `project-3` 2 / 0, `project-4` 1 / 0. The census of that date computed `movedFromBase` for a
  detached HEAD only (before D-4065): `true` for all 21 detached records, `null` for all 102 `ref:` ones.
- A found meta's `worktreePath` equals its record's path, but that is a measurement for Agent records only. For the
  107 `agent-*` records with a found meta, the census finds the meta by the id in the record's name and then
  compares: 107 of 107 equal (the 108th agent record, in `project-4`, has no meta). For the 15 `wf_*` records it is
  true by construction: the census finds a Workflow meta BY its `worktreePath`, so a found one always equals.
- A `wf_*` record's `metaPathless` is set per workflow RUN: one path-less meta in a run marks every record of that
  run. All 8 path-less records (`project-1` 1, `project-2` 7) are `wf_*` records.
- Three `other` records carry a `CLAUDE_BASE` too (`project-1` 2, `project-2` 1). A `CLAUDE_BASE` does not imply a
  delegated kind; these records' origin is unmeasured.
- Every `worktreeAbsent` record is of kind `other`.
- Two records are `locked` (`this-repo` one `wf_*`, `project-3` one `agent-*`).

**Caveats.**
- `ageBucket` is the admin directory's mtime. It measures time since the last git activity on that record, **not the
  record's age**. Measured live, `this-repo` went from 48 `<1d` / 24 `<1h` to 72 `<1h` within minutes, with no census
  write.
- The `other` kind is large (`this-repo` 53 of 72). The census measures only that these names are neither
  `agent-*` nor `wf_*`. That they are ccd's own `ws/*` worktrees and other non-Claude worktrees is an unmeasured
  reading.

**Q9, as a proxy** (`q9-parent-class-is-a-proxy`, D-4001). `byParent` classes, per record with a found meta, the
working directory of the meta's parent (the munged project directory the meta sits under).
- `main-checkout`: the repository's main checkout. It is ALSO where every ccd `<wrapper>-<project>` session runs, so
  it cannot tell a ccd parent from a non-ccd one.
- `ccd-workspace`: a project directory whose name starts with the ccd worktrees root's. That is a PATH PREFIX, not
  proof that the parent was a ccd session.
- `other`: neither. That could be a subdirectory, another checkout, or a session outside ccd.
- `mixed`: one record whose metas (one per home or project directory it was found under) have parents in more than
  one class.

Across the 122 records with a found meta: `ccd-workspace` 49, `main-checkout` 10, `other` 59 and `mixed` 4.
**Assuming every `ccd-workspace`-class parent is a ccd session** (unmeasured: the class is a path prefix), the
non-ccd share is bounded only to between 0 and 73 of 122 (about 60%), and `project-1` carries 62 of the 73. Wave 2's
spool answers Q9 exactly: a tree whose parent wrote no spool line had a non-ccd parent.

**Q10, from source** (`incarnation-is-the-row-generation`, D-3996). Cited by content against `origin/main`
`77c11245a` (`git show 77c11245a:ccd/ccd`), the newest `main` when this was written, because `main`'s lines are the
ones a merged tree carries; the hook's lines are the same there as on this branch.
`$REG/<id>.generation` (D-2605) serves as a parent's registry incarnation.
- It is read through an owned alias in `_reg_generation_read` (`ccd/ccd:3752`), which answers valid,
  present-but-invalid, or genuinely absent.
- It is minted by a no-clobber `link` in `_reg_generation_mint` (`:3791`), which only `_reg_generation_init`
  (`:3814`) calls, and only on genuine absence: a present-but-invalid file is never repaired. Four sites call the
  init: `cmd_ws_add` (`:7278`), `cmd_ws_restore` (`:10447`), `cmd_start` (`:21865`) and `cmd_ensure` (`:22092`), the
  supervisor's path, which gives a row created before the mechanism its file.
- It is never rewritten. It is removed only when the row is purged (`rm -f "$REG/$id.generation"`, `:4091`).
- The hook sees it as `CCRC_SESSION_GENERATION` (`_hook_generation_ok`, `ccd/session-hook.sh:1303-1304`). A spawn
  sets that variable only when its read under the compaction lock succeeds (`:20775`), and otherwise spawns without
  it, with one of three warnings (`:20785` no valid file, `:20790` the lock contended, `:20800` no lock mechanism).
  The resume retry re-reads under its own acquisition (`:20853-20861`) and drops the variable **silently** when that
  lock is contended, the read fails, or the value disagrees with the first read.
- The file can be absent on a LIVE row: ccd's own comments quote a 2026-09-17 measurement of 31 of 34 live rows
  without it (`:20780`, `:22068`).

**So wave 2 reads the FILE, not the variable, and an ABSENT or INVALID file is an UNMEASURED incarnation, never a
changed one.**

### Amendments the measurement forces

Every rig-derived amendment below holds "in the rig" and stays provisional until the real-lane cross-check; the
census-derived `admin-record-without-its-tree` and the source-derived `incarnation-is-the-row-generation-file` are
the exception.

- `delegation-posttooluse-is-a-launch` — in the rig, every Agent and Workflow call launched in the background, its
  PostToolUse an async acknowledgement with the work ending later (its SubagentStop or the task notification); a
  foreground Agent's PostToolUse is unmeasured, so §5.3's "completion" stands for it until the real-lane cross-check
  (every delegated cell, 77 of 77) — spec §5.3 hook table, §5.2 execution, §5.11 terminal evidence.
- `launch-response-names-the-upstream-id` — the Agent launch response carries the subagent's agent id, and the
  Workflow launch response carries the workflow run id that names its `wf_` records and meta directory. Together
  they are the EARLIEST spool-side join that names the call exactly, from a parent's `tool_use_id` to either, so the
  envelope gains them as validated tokens (every delegated cell). Two further joins are measured: a closing task
  notification's `<tool-use-id>` equals the launch's `tool_use_id` (56 of 56), and every SubagentStart's `prompt_id`
  equals its launching PreToolUse's (98 of 98). The `prompt_id` join can arrive first (SubagentStart and the launch
  arrive in either order), but it names the prompt turn, not the call; every fixture holds one launch per turn, so a
  turn with two launches is unmeasured — spec §5.3 envelope, §5.4 rung 2.
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
  quits (`/exit`, its background-work dialog answered with Enter on the default option — "Exit and stop tasks" as
  read from the pane on 2.1.280 and 2.1.289 only: interrupt-exit) or is SIGKILLed
  (parent-kill; wf-iso-resume's hung worker) leaves its tree, unchanged included, with a SubagentStart and no
  SubagentStop or notification; the quitting parent's SessionEnd says nothing about its agent. Under the ephemeral
  rule such a tree is never due unless the parent is proved dead, so wave 2 must name what ends it (interrupt-exit,
  parent-kill, wf-iso-resume) — spec §5.11 clocks and terminal evidence, §5.2 execution.
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
  because `CCRC_SESSION_GENERATION` is absent on every spawn whose generation read failed and is dropped silently by
  a resume retry whose re-read is contended, fails or disagrees (Q10 above, D-3996). An ABSENT or INVALID file is an
  UNMEASURED incarnation, never a changed one, and the file can be absent on a live row — spec §5.1 parent key,
  §5.11 terminal evidence (a changed incarnation).
- `agent-meta-loses-worktree-fields-on-removal` — when an isolated Agent's tree is removed natively, its meta loses
  `worktreePath`, `worktreeBranch` and `spawnedWithWorktree` and gains `worktreeCleanlyRemoved: true`
  (agent-iso-unchanged, 7 of 7), while an isolated Workflow worker's meta keeps `worktreePath` and
  `spawnedWithWorktree` (21 of 21 removed workers). Nothing may need those fields to classify a removed Agent, and a
  meta without them is not by itself evidence that the Agent ran unisolated — spec §3.1 (the isolated `Agent` meta
  sentence), §5.4 rung 2.
- `orphaned-agent-tree-is-locked` — every tree left by an agent still running when its parent died or quit carries a
  `locked` admin file (interrupt-exit, parent-kill, wf-iso-resume: 21 of 21), and no finished agent's tree does
  (agent-iso-changed, -dirty, -bg and wf-iso's committing worker: 0 of 28; the raw `git worktree add` record is
  unlocked too, 0 of 7). Admission rung 4 requires an unlocked tree, so such an orphan is refused while its lock
  stands. The corpus measures the lock only up to each run's end, and every lock's reason names a pid and a process
  start time (`claude agent <id> (pid <n> start <n>)`, 21 of 21), so whether a lock outlives that process is
  unmeasured, left to the after-merge real-lane cross-check — spec §5.11 admission ladder rung 4, terminal evidence.

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
