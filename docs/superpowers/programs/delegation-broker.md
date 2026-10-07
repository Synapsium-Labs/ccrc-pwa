# Program: delegation-broker

Spec: `docs/superpowers/specs/2026-10-04-delegation-broker-design.md` (approved 2026-10-05, revisions R1–R9 included)
Plans: `docs/superpowers/plans/2026-10-05-delegation-broker-wave1-measurement.md` (wave 1). Wave 2 is a close-out run
driven by that plan's own sections and this ledger's rulings. Waves 3–7 are planned one at a time from the measured
fields, each before its run dispatches
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
| 1 | 1 Measure | `SessionEnd` registered (captured in a `-hookcap` session, otherwise inert); the capture reducer's delegation block; the mock-API capture rig in the tree; the fixture corpus and its derived matrix; a read-only on-box census | fleet (the hook and installer reach homes through `ccrc update`); tests | — | #284 | **merged** 2026-10-06 as `22b4eabda` after reviews 277, 296 and 304 and two fix rounds; run 271 closed `done`; review 304's 13 findings carried to wave 2 as residue |
| 2 | 1 Measure (close-out) | the real-lane cross-check (a worker runs two `-hookcap` lanes); a capture of every fleet Claude Code version the corpus lacks; review 304's residue; one re-capture script | tests and docs (the hook and installer unchanged) | 1 | #321 | **fix round (review 328)**: run 306 dispatched 2026-10-07 08:46 UTC to `ccrc-pwa-plain-hollow` (operator decision: the cross-check folds into a close-out wave); PR #321 carries fix rounds for reviews 318, 324 and 328 |
| 3 | 2 Observe | hooks append to the spool; ingestion and cursors; the one `delegation_*` migration; census extension; correlation and reconciliation, report-only; the coordinator-intent route; coordinator clause 17 | fleet first, then server; skills | 2 | — | to plan once wave 2's cross-check is in the measurement section |
| 4 | 3 Project | the `delegation` frame; activity and lease rows in the PWA | server + pwa | 3 | — | to plan |
| 5 | 4 Adopt | `ws-lease-mark` and carriers; read-only `ws-lease-audit`; adoption; digest mail; retain and resolve; promotion through `ws-add --base` | **AGENT-FIRST**, then server | 4 | — | to plan |
| 6 | 5 Clean (shadow) | audit tokens for due leases; shadow rows; the shadow review | server | 5 | — | to plan |
| 7 | 6 Clean (live) | `ws-lease-clean`; the executor taking a target record | **AGENT-FIRST**, then server | 6; CCR-15 wave 4's sweep (merged #215, live) | — | to plan |

## Measurement matrix (filled by wave 1; wave 2's close-out added 2.1.292 and the real-lane cross-check)

Wave 1's answers to spec §8.1, per Claude Code version, read from the committed corpus
(`server/test/fixtures/delegation/matrix.json`, derived by `server/test/delegation-rig/build-matrix.mjs` from 140
synthetic rig captures: mock API, fixture HOME, fixture repo). The on-box census names projects by label only, and
the hook-side costs are below. Wave 2 (run 306) added the real-lane cross-check (two lanes, D-3995) under its own
heading, and nothing in a later wave may depend on a hook field that the corpus and the cross-check have not measured
(spec §8.1). The cross-check's evidence is not committed, so a field only it shows counts only once a later wave
measures it again (see "Real-lane cross-check").

**Versions covered:** 2.1.280, 2.1.281, 2.1.285, 2.1.286, 2.1.287, 2.1.288, 2.1.289, 2.1.290, 2.1.291 and 2.1.292, each
with 14 scenarios, and all 140 cells are `measured`. The corpus counts in the prose below the table, in "What the
table cannot show" and the amendments ("99 of 99", "126 of 126", "on all nine", …), are over the nine versions
2.1.280–2.1.291 they were measured on; 2.1.292's cells were compared answer by answer with them and match on every
answer the table reads. The Q8 hook costs and the on-box census numbers are not counts over versions. Measured means
measured **within the rig**: two of §8.1's situations are reached only through a proxy
(`oom-and-account-swap-are-proxies`, D-4066), and one is reached but not answered, because the rig compacts a session
but never captures the `compact` SessionStart (`compaction-is-unmeasured`, D-4364):
- **Parent crash is a SIGKILL of the parent's Claude Code process** (`kill9` in parent-kill, wf-iso-resume and
  clear-compact-resume). It is the rig's proxy for §8.1's OOM column. A cgroup OOM kill of the pane's scope can take
  the whole process tree, not the parent alone; whether it does is the unit's OOM policy (an assumption about the
  box's systemd and cgroup settings, not measured here), and that case is unmeasured.
- **The account swap is a config-dir swap.** swap-resume's `swapConfig` copies the fixture config dir to a second
  one under the same fixture HOME, with the same mock auth, and resumes there. It is not a swap between accounts.
- **Q5's compaction is unmeasured.** The rig does compact a session (clear-compact-resume), but the hook exits for a
  `compact` SessionStart before its capture arm, so no fixture holds one. Compaction shows only as PreCompact and
  PostCompact, which carried the pre-compaction session id in all ten versions' clear-compact-resume, and the rig's
  resume by that id continued under it. So "rotates on compaction" is not answered by this corpus; the amendment
  `compact-sessionstart-is-not-captured` names what the observe stage's spool (spec §7 stage 2; wave 3 since the
  2026-10-07 renumbering) must do.

The corpus comes from four captures, and `matrix.json` re-derives byte-identically from it:
- the first capture's 91 cells: its seven versions, 2.1.280 to 2.1.289 above, every scenario but interrupt-exit;
- those versions' seven interrupt-exit cells, re-captured in fix round 1 (D-4058);
- fix round 2's 28 cells, 2.1.290 and 2.1.291 × 14 scenarios, captured 2026-10-06 14:20–14:41 UTC with the rig at
  `e47f3689f` (a git-archive snapshot), sanitised by the sanitiser at `858caf47d` and committed in `158bc2227`. Of
  the versions installed when that capture started (2.1.285–2.1.291), it ran the two the corpus lacked; a later
  version was to be the observe stage's first step (then wave 2, wave 3 since the 2026-10-07 renumbering; D-4004), and
  the close-out (run 306) ran it instead, as the fourth capture below says. Fix round 2's rig changes were not in the
  snapshot the runs used (the git-archive snapshot of `e47f3689f` above) and change none of them: `claude_pid`
  resolves the versions directory to its own spelling on a box whose HOME is physical, as the capture box's is, and
  the workflow scenarios' `answerDialog "Run a dynamic workflow"` step, since replaced by a 10 s sleep (D-4058),
  waited out its 10 s timeout and pressed nothing: no dialog showed, and 36 of 36 workflow fixtures carry no
  `dialog answered:` note.
- the 2.1.292 capture's 14 cells, 2.1.292 × 14 scenarios, captured 2026-10-07 10:11:46–10:20:55 UTC with
  `recapture.sh --missing` at commit `ccf0167b9` (a git-archive snapshot), sanitised by the sanitiser at that commit
  and committed in `3cad0d2cd`. It ran the version the corpus lacked of those installed when it started (2.1.285,
  2.1.286, 2.1.287, 2.1.289, 2.1.290, 2.1.291, 2.1.292). Every cell is `measured`, and the only notes are the two the
  earlier versions carry (both read from the committed fixtures). Its raw root, with the run's log, was then removed,
  as the README's cleanup step says, so later waves read only the committed fixtures and the matrix derived from them.

The fleet's installed lanes, re-read read-only at 2026-10-07 12:38 UTC (each lane's last update result, its
`version_to`; no pin file under the versions directory), run 2.1.286 (one lane), 2.1.289 (one), 2.1.290 (five), 2.1.291
(two) and 2.1.292 (six): 15 lanes. **Every installed lane version is covered**, and no lane runs a version the corpus
lacks. 2.1.280, 2.1.281 and 2.1.288 are not installed on the box now (its versions directory holds 2.1.285, 2.1.286,
2.1.287, 2.1.289, 2.1.290, 2.1.291 and 2.1.292); their cells stay as measured history. Earlier reads had 2.1.286 on two
lanes, 2.1.289 on one, 2.1.290 on six and 2.1.291 on six (2026-10-06 14:58 UTC), 2.1.286 on four lanes and 2.1.289 on
eleven (2026-10-05 18:45 UTC), and before that one lane on 2.1.285. Lane counts drift as lanes update; re-read them
before relying on one.

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
`dialog answered: Background work is running` (interrupt-exit), each on all ten versions, and no fixture carries a
failure note. Each row names the scenario it reads.

| Question (scenario) | 2.1.280 | 2.1.281 | 2.1.285 | 2.1.286 | 2.1.287 | 2.1.288 | 2.1.289 | 2.1.290 | 2.1.291 | 2.1.292 |
|---|---|---|---|---|---|---|---|---|---|---|
| Q1 SubagentStart count; agent types (wf-plain) | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` |
| Q1 SubagentStop count; agent types (wf-plain) | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` | 2; `workflow-subagent` |
| Q1 SubagentStart count (wf-iso) | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| Q2 tool name (agent-plain) | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` | `Agent` |
| Q2 `isolation` in PreToolUse input (agent-iso-unchanged) | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Q3 `agent_id` names `agent-<id>` (agent-iso-changed) | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Q3 meta carries `worktreePath` (agent-iso-changed / wf-iso) | all / all | all / all | all / all | all / all | all / all | all / all | all / all | all / all | all / all | all / all |
| Q3 admin records named by a meta (agent-iso-changed / wf-iso) | all / all | all / all | all / all | all / all | all / all | all / all | all / all | all / all | all / all | all / all |
| Q3 `CLAUDE_BASE` (agent-iso-changed / wf-iso / raw-worktree) | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none | all / all / none |
| Q4 subagent Bash events, with `agent_id` (agent-plain: the PreToolUse and PostToolUse of one Bash call) | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 | 2, 2 |
| Q4 subagent Bash: parent's session id (agent-plain) / `cwd` in worktree (agent-iso-changed) | all / all | all / all | all / all | all / all | all / all | all / all | all / all | all / all | all / all | all / all |
| Q5 SessionStarts (clear-compact-resume) | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 | startup s1, clear s2, resume s2 |
| Q5 SessionStarts (swap-resume) | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 | startup s1, resume s1 |
| Q6 trees left: agent-iso-unchanged / -changed / -dirty / -bg / parent-kill / interrupt-exit / raw-worktree (the first six read `worktreesLeft`; raw-worktree reads `otherRecordsLeft`, its admin record, since its tree is outside `.claude/worktrees` and its `worktreesLeft` is 0) | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 | 0/1/1/1/1/1/1 |
| Q6 SessionEnd: interrupt-exit reasons / parent-kill count | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 | `prompt_input_exit` / 0 |
| Q7 wf-iso-resume: probes missed / records before kill / at end | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 | `r1-resumed` / 1 / 1 |
| Q7 wf-limit-pause: probes missed | none | none | none | none | none | none | none | none | none | none |

The SubagentStop row is read from the cell's `events` (count, each with an `agent_id`) and the fixtures'
`agent_type`; on every version the two SubagentStops carry the same two agent ids as the two SubagentStarts.
agent-plain's subagent is not isolated, so its own `cwd`-in-worktree reading is `none` on every version; the "all"
in that row is agent-iso-changed's.

What the table cannot show, read from the same fixtures' event order and key sets. The delegated cells are the 99 of
the eleven Agent and Workflow scenarios. Each item holds on all nine versions unless it names one.
- **In the rig, every Agent and Workflow call launched in the background** (99 of 99 launches). The launch's
  PostToolUse returned at once with an async-launch response. Where the parent's turn then ended with a Stop (90
  cells, all but interrupt-exit's nine), that first Stop listed one `running` background task. **The order of that
  Stop and the subagent's SubagentStop varies:** the SubagentStop came after it in 78 cells and before it in three —
  2.1.280 and 2.1.281 agent-iso-unchanged, and 2.1.289 wf-plain's first worker — and never fired in parent-kill or
  interrupt-exit. A finished launch's result reached the parent only as a task-notification user turn (72 cells:
  agent-plain, the four agent-iso scenarios, wf-plain, wf-iso and wf-limit-pause). D-4005 recorded the background
  launch on 2.1.289, where the smoke run was made; the corpus measures it on **all nine**. Six Agent scenarios set
  `run_in_background` false and agent-iso-bg set it true; no PreToolUse input carried the key (63 of 63 Agent
  launches). **A foreground Agent call is therefore unmeasured on every version.**
- The Agent launch response names the subagent's agent id, the same id SubagentStart carries. The Workflow launch
  response names the workflow run id, which names that run's `wf_<run>-<n>` admin records and its
  `subagents/workflows/wf_<run>/` meta directory, and it names a task id. Each Workflow worker's SubagentStart
  `agent_id` names its meta file. The task id, or the agent id for an Agent, is the id that the parent's Stop
  `background_tasks` and the closing task notification carry. The closing notification also carries the launch's
  `tool_use_id` as `<tool-use-id>` (72 of 72 notifications), and every SubagentStart's `prompt_id` equals its
  launching PreToolUse's (126 of 126 SubagentStarts).
- SubagentStart and the launch's PostToolUse arrive in either order, and both orders occur within every version
  across the seven Agent scenarios. On 2.1.289, for example, SubagentStart came first in agent-plain,
  agent-iso-dirty and agent-iso-bg, and the launch came first in agent-iso-unchanged, agent-iso-changed,
  interrupt-exit and parent-kill.
- The Workflow PreToolUse input is the script alone. A worker's isolation is spelled inside the script text, never as
  a `tool_input` key.
- **Q3 `worktreePath` is not always written: an isolated Agent's meta loses its worktree fields when its tree is
  removed natively.** agent-iso-unchanged's meta carries no `worktreePath`, `worktreeBranch` or
  `spawnedWithWorktree`; it carries `worktreeCleanlyRemoved: true` beside `agentType`, `description`, `toolUseId`,
  `spawnDepth` and the two request fields (9 of 9; no other meta in the corpus carries `worktreeCleanlyRemoved`). An
  unisolated Agent's meta (agent-plain) lacks the three fields too, and lacks `worktreeCleanlyRemoved`; every
  isolated Agent whose tree stayed carries all three (agent-iso-changed, -dirty, -bg, parent-kill and
  interrupt-exit: 45 of 45). An isolated Workflow worker's meta carries `worktreePath` and `spawnedWithWorktree`,
  never `worktreeBranch`, and keeps both after native removal (wf-iso's unchanged worker, wf-iso-resume's finished
  worker and wf-limit-pause's worker: 27 of 27). The table's Q3 rows read agent-iso-changed and wf-iso only, and
  `build-matrix.mjs` keeps only metas whose `spawnedWithWorktree` is true, so a rewritten Agent meta is invisible to
  those rows by construction.
- **`workflowPhase` is a measured rig-vs-box difference.** Spec §3.1 says a Workflow worker's meta carries
  `workflowPhase`. No Workflow meta in the corpus does (0 of 63), while on the fleet box 8 of the census's 15 `wf_*`
  records with a found meta list it among their meta keys (`this-repo` 7, `project-1` 1, `project-2` 0). The
  real-lane cross-check has run, and found it on neither lane (amendment `workflow-phase-is-not-always-written`).
- **Q5 compact is a measurement LIMIT, not "never fired".** The hook exits for a `compact` SessionStart before its
  capture arm (`ccd/session-hook.sh:2905`). That is the stall-watch exclusion its arm comment documents at
  `:2919-2922`. Compaction shows only as PreCompact/PostCompact, which carried the pre-compaction session id, and the
  rig's resume by that id continued under it. During `/compact`, one SubagentStop fired with an agent id, an empty
  agent type, and no SubagentStart. On 2.1.289 the resumed turn's Stop was not captured (two Stops where the other
  eight versions show three). swap-resume shows the same on 2.1.291: its first turn's Stop was not captured before
  that turn's `/exit` (one Stop where the other eight versions show two; SessionStart, UserPromptSubmit, SessionEnd,
  then the resumed half as everywhere else). Each missing Stop belongs to the turn just before an `/exit`; it is
  observed run variance, in two scenarios on two versions, and its cause is unmeasured. The session-id sequence and
  the SessionEnds are unaffected in both.
- **SessionEnd:** clear-compact-resume captured two on every version, one for `/clear` (fired under the old id just
  before the new id's SessionStart) and one for the final `/exit`; the SIGKILL between them fired none. swap-resume
  captured two, one for each `/exit`. parent-kill captured none. interrupt-exit captured exactly one, reason
  `prompt_input_exit`, as the parent's last event. Its run (re-scripted in fix round 1, D-4058): the mock held the
  parent's post-launch request (label `main-hang`, reached on every version), so the Escape landed in a live
  main-loop turn, and no Stop fired. The `/exit` that followed opened Claude Code's "Background work is running"
  dialog on every version (the fixture note; since fix round 2 a dialog that never shows is a failure note and the
  cell builds `unmeasured`, D-4058), and the rig answered it with Enter, which takes its first and default
  option, "Exit and stop tasks" (the option was read from the pane on 2.1.280 and 2.1.289 while re-scripting). The
  still-running agent then emitted no SubagentStop and no task notification, and its tree stayed. So a SessionEnd can
  end a parent whose agent never reports an end: it is a hint about the parent, never about its agents. A missing
  SessionEnd (parent-kill) is never terminal evidence either, which confirms §5.11. The dialog's other two options
  ("Move to background and exit", "Stay") are unmeasured. Superseded: before D-4058 the scenario's Escape reached an
  idle prompt (the parent's turn had already ended with a Stop), and its `/exit` stopped at this dialog unanswered, so
  that corpus's "none" measured no exit at all. That was OBSERVED on 2.1.289 only, from the pane while re-scripting;
  on the first capture's other six versions it is inferred, from the Stop that ends every old fixture (with no
  SessionEnd and no note, 7 of 7) and from the dialog fix round 1's re-capture met on all seven.
- **Q6 removal:** an unchanged isolated tree was removed natively for Agent (agent-iso-unchanged) and for Workflow
  (wf-iso's unchanged worker, wf-limit-pause). wf-iso's committing worker's tree stayed (its record holds the
  commit). Committed trees stayed (agent-iso-changed, and agent-iso-bg, whose subagent commits too: its tip differs
  from its `CLAUDE_BASE` on 9 of 9), and so did a dirty one (agent-iso-dirty). **Nothing shows a tree staying because
  it ran in the background:** every Agent call launched in the background, agent-iso-unchanged's tree was removed,
  and the one scenario that asked for the background (agent-iso-bg) commits. The tree of an agent still running when
  its parent quit (interrupt-exit, through the dialog above) or was SIGKILLed (parent-kill, and wf-iso-resume's hung
  worker) stayed too. Those agents emitted no SubagentStop and no task notification, and all 27 of their trees are
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
  `Agent`: a main-loop Agent PreToolUse and an `async_launched` PostToolUse on 63 of 63 Agent launches (D-3994).
  Whether it also offered `Task` cannot be told from the corpus: `Agent` is listed first, and no fixture records the
  offered tool list (`Task` appears in no fixture). A `Task` spelling is not observed, not excluded.

### Hook-side costs (Q8)

This is a bash micro-benchmark of the operations, not of the observe stage's hook (wave 3 since the 2026-10-07
renumbering; `q8-spool-cost-is-a-micro-benchmark`, D-4000). It ran on 2026-10-05 against the repository with the
most admin records, `project-1`'s main checkout, which held 185 records at the start and at the end of the run (181
at the census). The load average was 25.06 / 22.22 / 23.77 at the start and 25.78 / 22.41 / 23.83 at the end, on 16
CPUs. Nothing in the repository was written; the append went to a scratch file outside it, removed after.

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
non-ccd share is bounded only to between 0 and 73 of 122 (about 60%), and `project-1` carries 62 of the 73. The
observe stage's spool (wave 3 since the 2026-10-07 renumbering) answers Q9 exactly: a tree whose parent wrote no spool
line had a non-ccd parent.

**Q10, from source** (`incarnation-is-the-row-generation`, D-3996). Cited by content against `origin/main`
`77c11245a` (`git show 77c11245a:ccd/ccd`), the newest `main` when this was written, because `main`'s lines are the
ones a merged tree carries; the hook's lines are the same there as on this branch. Re-read at `origin/main`
`f7e51156f` (2026-10-06, after #301 edited `ccd/ccd`): every line cited below has the same content; those past `:8628`,
where #301 added five `caps` lines, sit five lines lower there (`:10452`, `:21870`, `:22097`, `:20780`-`:20866`,
`:22073`).
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

**So the observe stage (wave 3 since the 2026-10-07 renumbering) reads the FILE, not the variable, and an ABSENT or
INVALID file is an UNMEASURED incarnation, never a changed one.**

### Amendments the measurement forces

Every rig-derived amendment below holds "in the rig" and stays provisional until the real-lane cross-check; the
census-derived `admin-record-without-its-tree` and the source-derived `incarnation-is-the-row-generation-file` are
the exception.

- `delegation-posttooluse-is-a-launch` — in the rig, every Agent and Workflow call launched in the background, its
  PostToolUse an async acknowledgement with the work ending later (its SubagentStop or the task notification); a
  foreground Agent's PostToolUse is unmeasured, so §5.3's "completion" stands for it until the real-lane cross-check
  (every delegated cell, 99 of 99) — spec §5.3 hook table, §5.2 execution, §5.11 terminal evidence.
- `launch-response-names-the-upstream-id` — the Agent launch response carries the subagent's agent id, and the
  Workflow launch response carries the workflow run id that names its `wf_` records and meta directory. Together
  they are the EARLIEST spool-side join that names the call exactly, from a parent's `tool_use_id` to either, so the
  envelope gains them as validated tokens (every delegated cell). Two further joins are measured: a closing task
  notification's `<tool-use-id>` equals the launch's `tool_use_id` (72 of 72), and every SubagentStart's `prompt_id`
  equals its launching PreToolUse's (126 of 126). The `prompt_id` join can arrive first (SubagentStart and the launch
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
  rule such a tree is never due unless the parent is proved dead, so the observe stage (wave 3 since the 2026-10-07
  renumbering) must name what ends it (interrupt-exit, parent-kill, wf-iso-resume) — spec §5.11 clocks and terminal
  evidence, §5.2 execution.
- `workflow-worker-not-rerun-after-restart` — after a parent SIGKILL and `--resume`, the hung isolated worker did not
  re-run within the probe window, and its record stayed. "A paused workflow is not ended" must not wait on a resume
  the corpus never saw (wf-iso-resume, probe missed on all nine) — spec §5.11, §5.12 restart.
- `compact-sessionstart-is-not-captured` — the hook exits for a `compact` SessionStart before capture, and compaction
  showed no id change in PreCompact/PostCompact. "Rotates on compaction" is unmeasured, and the observe stage's spool
  line (wave 3 since the 2026-10-07 renumbering) for that SessionStart must be written inside its arm before the exit
  (clear-compact-resume) — spec §3 `_sync_uuid` row, §5.2, §5.3.
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
  (agent-iso-unchanged, 9 of 9), while an isolated Workflow worker's meta keeps `worktreePath` and
  `spawnedWithWorktree` (27 of 27 removed workers). Nothing may need those fields to classify a removed Agent, and a
  meta without them is not by itself evidence that the Agent ran unisolated — spec §3.1 (the isolated `Agent` meta
  sentence), §5.4 rung 2.
- `orphaned-agent-tree-is-locked` — every tree left by an agent still running when its parent died or quit carries a
  `locked` admin file (interrupt-exit, parent-kill, wf-iso-resume: 27 of 27), and no finished agent's tree does
  (agent-iso-changed, -dirty, -bg and wf-iso's committing worker: 0 of 36; the raw `git worktree add` record is
  unlocked too, 0 of 9). Admission rung 4 requires an unlocked tree, so such an orphan is refused while its lock
  stands. The corpus measures the lock only up to each run's end, and every lock's reason names a pid and a process
  start time (`claude agent <id> (pid <n> start <n>)`, 27 of 27), so whether a lock outlives that process is
  unmeasured, left to the after-merge real-lane cross-check — spec §5.11 admission ladder rung 4, terminal evidence.

### Real-lane cross-check

Run 2026-10-07 by wave 2's worker (run 306), under wave 1's plan "After the merge" standing rules: two fresh `-hookcap`
scratch sessions started with `ccd start` and stopped with `ccd stop`, driven by one mail each, each in a scratch git
repository with one commit, outside the projects root. Lanes: the lowest and the highest Claude Code version the fleet
ran at 08:55 UTC, **2.1.286** and **2.1.292** (D-3995). Every lane's `settings.json` registered `SessionEnd` (15 of 15),
on ccrc v0.0.114. The mail asked for one `Agent` call with `isolation: "worktree"` whose subagent commits one file, then
one `Workflow` with one `{ isolation: 'worktree' }` agent doing the same, then "done". No lane stopped at a permission
dialog, none declined, and both did all three steps. Only reduced output is here: `deploy/hook-capture-reduce.mjs` over
each capture (`--root scratch=<repo> --root worktrees=<repo>/.claude/worktrees`), `deploy/delegation-census.mjs` over
each scratch repository with the lane's config dir as `--home`, and booleans computed on the box. The rig side is the
same reducer run over the corpus's `agent-iso-changed` and `wf-iso` fixtures for the same version, their events written
out as a capture directory. A lane is named by its version; the registry rows of both scratch ids stay for the operator.
The tables, the teardown result and the agent-meta checks below rest on the lanes' capture directories, scratch
repositories and config dirs. These stay on the fleet box, with every scratch session's registry row, until the
operator removes them, and are never committed; after that they are a dated record that cannot be derived again. So a
later wave may rely on a field only if the committed corpus shows it or the wave measures it again. Each amendment
below only narrows what a later wave may assume, or has it drop or keep data it cannot attribute, so it stands either
way.

**Table 1: real lane against the rig's cells for the same version.**

| check | 2.1.286 | 2.1.292 |
|---|---|---|
| Agent: PreToolUse input keys | `description`, `isolation`, `prompt` — the rig's mock also sends `subagent_type` (`agent-input-keys-are-the-callers`) | same as 2.1.286 |
| Agent: isolation token | `worktree` 1, as the rig | `worktree` 1, as the rig |
| Agent: launch PostToolUse response keys | `agentId`, `canReadOutputFile`, `description`, `isAsync`, `outputFile`, `prompt`, `resolvedModel`, `status` — as the rig; `status` `async_launched`, `isAsync` true | same keys and values |
| Agent: SubagentStart against the launch PostToolUse | SubagentStart first, as the rig | launch first; the rig's cell has SubagentStart first — both orders are already measured (`activity-keyed-by-agent-id-not-arrival`) |
| Agent: subagent events | its tool events carry `agent_id` and `cwd` `worktrees/*`, then SubagentStop (its transcript names the agent), as the rig | same |
| Agent: the launch's ids | the response `agentId` is the SubagentStart `agent_id`; that SubagentStart's `prompt_id` is the launch PreToolUse's; a task notification carries the launch's `tool_use_id`; the parent's Stop `background_tasks` lists the agent id — all true | the first three true; no Stop fell while the agent ran, so `background_tasks` never listed it |
| Workflow: PreToolUse input keys / isolation in `tool_input` | `script` / absent, as the rig | same |
| Workflow: launch response keys | `runId`, `scriptPath`, `status`, `summary`, `taskId`, `taskType`, `transcriptDir`, `workflowName` — as the rig (vetted: none is an agent or label name); `status` `async_launched` | same |
| Workflow: the launch's ids | `runId` names the `wf_<run>-<n>` admin record; SubagentStart `prompt_id` = launch's; notification carries `tool_use_id`; Stop `background_tasks` lists `taskId` — all true | all true |
| Workflow: SubagentStart against the parent's Stop | before the Stop; the rig's cell has it after (`parent-stop-does-not-bound-workflow-start`) | before the Stop; as 2.1.286 |
| Main thread before the Workflow call | — | a ToolSearch call (input keys `max_results`, `query`) loads the Workflow tool first (`toolsearch-may-precede-a-workflow-call`) |
| Unpaired SubagentStop (no SubagentStart, empty agent type, `cwd` `scratch`) | 3, one after each of the parent's 3 Stops; the rig shows one only during `/compact` (`post-turn-subagentstop-is-unpaired`) | 2, one after each of 2 Stops |
| Event key sets (per event, every field path) | the rig's, plus `scratchpad_dir` on every event (`real-payloads-carry-scratchpad-dir`) | the rig's, plus `scratchpad_dir`, minus Stop's `background_tasks.[].agent_type` (no Stop fell while the agent ran; see the "Agent: the launch's ids" row), plus the main-thread ToolSearch call's input keys |
| `cwd` labels | main `scratch`, subagent `worktrees/*`, as the rig | same |
| Session ids | one (`s1`) for every event of the turn, as the rig | same, except the SessionEnd below |
| SessionEnd at `ccd stop` | none captured under this lane's id; its SessionEnd (reason `other`) was filed under the 2.1.292 lane's id (`teardown-hook-event-names-another-session`) | its own: none captured anywhere; the one under its id is 2.1.286's |

**Table 2: the census of each scratch repository, before and after `ccd stop` (identical both times).**

| record | 2.1.286 | 2.1.292 | the rig, same version |
|---|---|---|---|
| Agent record: meta keys | `agentType`, `description`, `requestNonInteractive`, `requestShape`, `spawnDepth`, `spawnedWithWorktree`, `toolUseId`, `worktreeBranch`, `worktreePath` | the same nine | the same nine |
| Workflow record: meta keys | `agentType`, `description`, `requestNonInteractive`, `requestShape`, `spawnDepth`, `spawnedWithWorktree`, `worktreePath` | the same seven | the same seven |
| `worktreePath` equals the record's tree | yes, both records | yes, both | yes |
| `CLAUDE_BASE` | present, equals the first `logs/HEAD` line, both records | the same | the same |
| HEAD / moved from base / locked | `ref:` / yes / no, both records | the same | the same |
| `workflowPhase` | absent | absent | absent (0 of 63 rig Workflow metas before this wave's capture, 0 in 2.1.292's) |

What this confirms, on these two lanes: `delegation-posttooluse-is-a-launch` (all four launches `async_launched`),
`launch-response-names-the-upstream-id` (every join true), `run-end-is-a-task-notification`,
`workflow-isolation-is-in-the-script` and `activity-keyed-by-agent-id-not-arrival` (both orders, one per lane). Not
exercised here, so still rig-only: `agent-meta-loses-worktree-fields-on-removal` (both trees were changed and stayed),
`orphaned-agent-tree-is-locked` and whether its lock outlives the process (no isolated tree was orphaned on purpose;
the teardown probe below stopped two lanes, each with a non-isolated background agent still running, which left a
SubagentStart and no SubagentStop and made no tree), the tree half of `orphaned-background-agent-has-no-terminal-event`
(those two agents show its no-SubagentStop half at `ccd stop`), `sessionend-on-clear-is-a-rotation`, and every Q5 and
Q7 situation.

Amendments the cross-check forces (each a difference from the rig; `slug — sentence — spec §`):
- `agent-input-keys-are-the-callers` — the Agent `tool_input` key set is whatever the calling model sends: both real
  lanes omitted `subagent_type`, which the rig's mock always sends. Nothing may require it — spec §5.3 PreToolUse row.
- `post-turn-subagentstop-is-unpaired` — on both lanes a SubagentStop with an agent id, an empty agent type, no
  SubagentStart and no launch followed every one of the parent's Stops (5 of 5); the rig showed one only during
  `/compact`. This widens `compaction-fires-an-unpaired-subagentstop`: a SubagentStop alone never opens an activity,
  and it is routine, not rare — spec §5.2 activity, §5.3.
- `real-payloads-carry-scratchpad-dir` — every real event carries `scratchpad_dir`, a path, which no rig payload does
  (its cause is unmeasured: the rig's fixture HOME and mock API do not produce it). The spool's allowlist must drop it,
  like `cwd` and `transcript_path` — spec §5.3 envelope.
- `toolsearch-may-precede-a-workflow-call` — the 2.1.292 lane loaded the Workflow tool with a main-thread ToolSearch
  before calling it; the 2.1.286 lane did not. Whether that follows the version or the lane's tool set is unmeasured.
  A ToolSearch is not a delegation event and opens nothing — spec §5.3 PreToolUse row.
- `parent-stop-does-not-bound-workflow-start` (review 318 F7) — on both real lanes an isolated Workflow worker's
  SubagentStart arrived before the parent's Stop; in the rig's wf-iso cells for the same versions it arrived after.
  The corpus itself shows both: wf-plain's first worker starts before the parent's Stop on all ten versions, and
  wf-iso's workers after it. Either order occurs, so a parent Stop neither opens nor closes a Workflow activity, and a
  worker is correlated by the workflow and agent joins (`launch-response-names-the-upstream-id`); the observe stage's
  correlation (wave 3) must not use that order — spec §5.2 execution, §5.4 rung 2.
- `workflow-phase-is-not-always-written` (review 304 F11) — spec §3.1 says an isolated Workflow worker's meta carries
  `workflowPhase`. Neither real lane's Workflow meta has it, nor any of the corpus's, while 8 of the on-box census's 15
  found `wf_*` metas list it. What decides whether it is written is unmeasured (a workflow that declares phases is
  the candidate), so nothing may need it — spec §3.1, §5.4 rung 2.
- `teardown-hook-event-names-another-session` — `ccd stop` of the 2.1.286 lane fired its SessionEnd (reason `other`)
  and the hook filed it under the 2.1.292 lane's id; the 2.1.292 lane's own stop-time SessionEnd was captured nowhere.
  The hook resolves its session with `tmux display-message -p '#S'` and no `-t "$TMUX_PANE"`
  (`ccd/session-hook.sh:2760`). Measured on a private tmux server: once a pane's session is killed, that query answers
  another live session, and with `-t "$TMUX_PANE"` it answers nothing. So a hook event fired during teardown is
  attributed to whichever session tmux picks.
  Which events fire then was measured afterwards (the coordinator's question), on three more fresh `-hookcap` lanes
  stopped one at a time: 2.1.290 busy, then 2.1.292 idle, then 2.1.292 busy. Busy means the main thread blocked in a
  foreground Bash loop while a non-isolated background Agent still ran; a stop during a model request is unmeasured.
  2.1.290 stood in for the low end, because the fleet's only 2.1.286 lane and its 2.1.289 lane were at their weekly
  limits. The idle 2.1.292 lane had declined the mailed instruction (it would not act on a mailbox whose name did not
  match its working directory) and was stopped as it was. The first two stops' SessionEnds were filed under the busy
  2.1.292 lane's id, whose tmux session was started before either stop (the first SessionEnd arrived before that lane's
  own SessionStart); the third, the busy 2.1.292 lane's own, was filed under a catcher session started after the second
  stop, again before the catcher's own SessionStart. With round 1's idle 2.1.286 stop above, every teardown measured
  (2.1.286 idle, 2.1.290 busy, 2.1.292 idle, 2.1.292 busy) fired exactly one event: SessionEnd, reason `other`, filed
  under the most recently started `-hookcap` session's id. No Stop, StopFailure, SubagentStop or PostToolUse fired at
  `ccd stop`, so nothing that writes hookstate, the turn marker or the subagent set was misfiled, and SessionEnd writes
  none of them: today only a capture is misfiled. The observe stage's spool (wave 3 since the 2026-10-07 renumbering)
  must resolve the pane exactly (and drop an event it cannot), or every stop-time SessionEnd lands on another
  session — spec §5.3 SessionEnd row, §5.1 parent key.
- `tool-agent-id-alone-is-unjoined-evidence` (review 318 F1) — on each busy teardown lane above (2.1.290, 2.1.292),
  one main-checkout `PreToolUse` (Bash) carried an `agent_id` and no `agent_type` key. Its `cwd`, `session_id` and
  `prompt_id` were the parent turn's, and no launch response, SubagentStart, SubagentStop or `agent-*.meta.json` ever
  named that id. Each fired about 32 s after the lane's background Agent launched, while the main thread was blocked
  in its foreground Bash loop. Its cause is unmeasured, and the corpus has no such event (0 of 1338 hook events carry
  `agent_id` with no `agent_type` key; the ten `/compact` SubagentStops carry an empty one). A tool event whose only
  delegation evidence is `agent_id`, with no correlating Agent launch response, SubagentStart or agent meta, is kept
  as evidence and opens no activity; it attaches to one once a launch response, SubagentStart or agent meta naming
  the same `agent_id` is known, whether that join came before it or arrives later. A shared `prompt_id` names the
  turn, not the agent, and is not such a join (`launch-response-names-the-upstream-id`). So spec §5.2's "the first
  event that named it" is, for an `agent_id`-keyed activity, the earliest retained journal event of the parent
  (same incarnation) naming that id once a qualifying join is known, whichever join came first; on every measured
  order that is the launch response or SubagentStart itself. A bare occurrence never opens an activity, but once a
  join is known it may be that earliest event (a refinement of review 318 F1's wording, ruled with review 324). The
  other source kinds keep the first event naming their upstream id. A meta is a join, not a journal event, and
  nothing of it is hashed (review 324 F3, F4). The id is selected once, at open, and never changes: it is part of the
  checkpointed applied state, reconstruction restores it verbatim and never re-selects it from the journal left after
  pruning, pruning cannot pass an identity event before a checkpoint holds its id, and a bare occurrence pruned
  before any qualifying join is durably applied never becomes one (review 328 F1; spec §5.2, §5.12). The observe stage's parser (wave 3) must not use the presence of
  `agent_type` to decide whether an event qualifies — spec §5.2 activity id, §5.3, §5.4 rung 3 (a non-empty
  `agent_id` does not by itself place an event inside a subagent).
  A second reader, already shipped, places an event by a raw non-empty `agent_id`: the hook's turn-marker classifier
  (`paid` in `ccd/session-hook.sh`) skips the main-thread marker write for such an event, so each such PreToolUse
  above was dropped from its turn marker as a subagent's. No harm was measured, because earlier main-thread events
  had already marked both turns `working` (review 324 F10). Wave 3 must resolve that reader against this contract
  with a red-first phantom-main-thread case and without assuming `agent_type`, after its first-commit
  `-t "$TMUX_PANE"` correction unless its approved plan proves the two must be one atomic change.

## Decisions & deviations

Entries dated before 2026-10-07 use the six-wave numbering and are kept as written: "wave 2" in them is the observe
stage, wave 3 since the 2026-10-07 renumbering, and each later number there is one lower than today's. Run 306 was
opened as that stage's run and is now the close-out's.

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
  this ledger's docs PR once its checks are green. #280 merged 2026-10-05 as `1eda8630a`, every check green.
- **2026-10-05 — wave 1's brief and routing.** The spec'd-plan row: Opus · high main loop, Sonnet · high implementers,
  an Opus · high reviewer per task, Haiku scouts, workflows off, compact 40. Nine items, one per task. The brief
  routes Task 1 around a live peer claim on `ccd/session-hook.sh` (landing-order wave 3's fix round, hard cap 19:04 UTC):
  Tasks 2–5 first, and the peer protocol for the three disjoint lines Task 1 changes.
- **2026-10-05 — overlap rule with child-reclamation wave 5 (run 260), agreed by both coordinators (mail 3563).** Both
  waves edit `server/test/session-hook.test.ts` (ours: one in-place line, the unknown-event row; theirs: the
  citation-debt census's `shared/api.ts` entry) and `README.md` (ours: the registered-events, capture and census
  sentences; theirs: four `shared/api.ts` anchors re-pointed by content). Each edits only its own region; whichever
  PR lands second absorbs main by `git merge` alone and re-runs `session-hook.test.ts` in full plus
  `typecheck-tests`; neither waits. The worker was told (mail 3564).
- **2026-10-05 — wave 1's wave-done verified (mail 3577).** The branch tip, the remote tip and the head of #284 are
  all `347b7b64`, and the server accepted the fingerprint. The worker sent `suite: red`, `failure: unclear`. Its
  first full run was red on four rows: three load rows that pass in isolation, and `tmp-sweep`'s fail-closed row,
  which it reports as also red on a clean `main`; the review brief asks for that to be reproduced. The block 3992
  through 4011 is fully defined. Ruled: the full suite ran as one bounded background job rather than foreground
  shards, which is accepted (the hard timeout and the log kept a hang visible; the gate suites ran in the foreground).
  The raw synthetic capture root stays on the box until #284 merges. Review run 277 runs the held-out panel, plus
  public-content, hook-inertness and measurement-provenance lenses.
- **2026-10-05 — review 277's verdict (`ccrc-pwa-calm-summit`, at `347b7b64`):** 36 findings (0 critical, 11 important,
  25 minor), merged from 59 confirmed. Per lens, confirmed out of raised:
  - Panel: correctness 4/5, spec 5/5, reproduce 6/7.
  - Wave lenses: public-content 0/4, hook-change 1/2, provenance-matrix 6/7, provenance-amendments 9/10,
    deviations 5/7, whole-branch 2/5.
  - Mutation agents: 13 of 126 cells survived.

  No lens came back unverified. The committed corpus is clean; `matrix.json` re-derives byte-identically; `SessionEnd`
  is measured inert outside `-hookcap` (no file written, a median of 32 ms); the `tmp-sweep` main-red claim
  reproduced. The systematic weakness is guard arms added in review and fix rounds that have no row able to go red.
- **2026-10-05 — fix round 1 rulings (mail 3587).** Every finding is fixed except F34, a dated spec anchor that stays
  as it is. The rulings that needed one:
  - F4: re-script interrupt-exit and re-run it on all seven versions (plan Task 6 Step 3), falling back to unmeasured
    after one honest attempt.
  - F6, F22, F23: new or widened amendments.
  - F7: no merge of `main`. Coordinator clause 15 allows asking for an absorb only on a measured conflict, and the
    merge is clean, so the plan's merge-before-handoff constraint is superseded as a planning error.
  - F8, F10, F28: the departures are recorded.
  - F13, F14, F15, F16 are in scope. F16 means Q8 is re-run on the largest repo.
  - F17: SIGKILL and swap-resume are declared as proxies.

  A second block was minted for the round: ten numbers, 4058 through 4067 (4058 F4, 4059 F7, 4060 and 4061 F8,
  4062 F10, 4063 F28, the rest spare).
- **2026-10-05 — routing:** the worker's effort rises from high to xhigh for fix round 1 (`runs route`, kind `shallow`:
  tests missed). The review found guards without a red row; the routing matrix raises effort one rung for that.
- **2026-10-06 — fix round 1's wave-done verified (mail 3681).** The branch, the remote and #284 are all at
  `e47f3689f` (13 commits), and the server accepted the fingerprint. The worker sent `suite: red` (carried from round
  0), `failure: shallow`.
  - F4 is a measured fix (number 4058): the old `/exit` had stopped at Claude Code's unanswered "Background work is
    running" dialog. Re-scripted, every version shows `SessionEnd` `prompt_input_exit`, no `Stop`, and one locked
    tree left.
  - Asked (mail 3642), the worker measured `clear-compact-resume` and `swap-resume`: they launch no background
    work, so they were never blocked.
  - Numbers 4058 through 4065 are defined; 4066 and 4067 are unused.
  - CI reds `server 4/5` on a compaction-card row of `session-hook.test.ts`. The worker reads it as strace
    interleaving, outside this branch's diff, and review 296 is asked to reproduce that.
  - The fleet box's `/tmp` reaper took the raw roots before merge; the committed corpus re-scans clean. A
    protect-list entry is the operator's call.
  - Review run 296's dispatch was refused `cap-daily` (24 of 24, fleet-wide). It retries at each measured age-out,
    the first at 12:41 UTC.
- **2026-10-06 — review 296's verdict (`ccrc-pwa-soft-prairie`, at `e47f3689f`):** 18 findings (3 important).
  - Previous findings: 29 of review 277's 36 landed as ruled, 6 with a remainder, and F34 was left by ruling.
  - Mutation: 15 of review 277's 16 survived or row-less cells now red, and one is declared untestable as ruled.
    All 34 original mutation-table rows red through their named rows.
  - Public content: 0 hits. `matrix.json` re-derives byte-identically.
  - The CI red is a strace harness flake the branch cannot reach: 3 of 18 runs at the tip, 3 of 18 on main.
  - Per lens, confirmed out of raised: fix-range panel 6/8, whole-branch panel 6/11, wave lenses 14/34.
- **2026-10-06 — fix round 2 rulings (mail 3704).**
  - The sanitiser gets a stopping line. A spelling that contradicts a claim the header or the deviation entry
    makes is fixed, or the claim is corrected (F1: every `%XX` is decoded for the scan). An exotic spelling the
    corpus lacks and the synthetic rig cannot produce becomes a named known limit (F11 glue characters and `~/`,
    F12 the munged-top denylist). An attack review of a parser never converges otherwise.
  - F2: a missing dialog answer becomes a failure note, never a measured zero.
  - F3: the two §8.1 proxies get number 4066. 4067 is reserved for F18's scenario-rule departure, or is recorded
    as unused.
  - No escalation: effort stays xhigh, because round 1 landed 29 of 36 cleanly.
  - **New versions:** 12 of 15 lanes now run 2.1.290/2.1.291, which the corpus lacked, and spec §8.1 lets no
    contract depend on a field until every version the fleet runs is measured. So this round captures both,
    stopping at the versions installed when the capture starts. The 2.1.280/2.1.281 fixtures stay as history.
- **2026-10-06 — fix round 2's wave-done verified (mail 3729).** The branch, the remote and #284 are all at
  `3efb0ac37`, and the server accepted the fingerprint.
  - All 18 rulings landed. 2.1.290 and 2.1.291 were captured with no rig adaptation: 9 versions, 126 of 126 cells
    measured, every lane covered.
  - The block 4058–4067 is fully defined.
  - The worker's per-task review caught a consequence of my F2 ruling. The four workflow scenarios carried an
    `answerDialog` for a dialog that never appears (Workflow is granted by `permissions.allow`), and the new
    failure arm would have marked every workflow capture unmeasured. The worker replaced the step with an
    equal sleep and pinned that with a data-derived row. Accepted, subject to review 304.
- **2026-10-06 — review 304's verdict (`ccrc-pwa-clear-meadow`, at `3efb0ac37`):** 13 findings (2 important, 11
  minor), all from 23 confirmed raw findings, with no lens unverified.
  - All 18 of review 296's findings landed as ruled. The workflow sleep changes no measured cell.
  - The 28 new fixtures re-sanitise byte-identically, and `matrix.json` re-derives byte-identically.
  - Public content: 0 hits.
  - Both important findings predate the round and are claim errors, not data errors: F1, the `..` claim against
    `DOTDOT`; F2, Q5 compaction called measured.
- **2026-10-06 — wave 1 accepted with residue; #284 merged as `22b4eabda`.**
  - The review is clean of blockers, and every required CI leg is green; `full-suite` and `test-macos 2/2` are macOS
    reds, which gate nothing by ruling.
  - #284 landed second, after child-reclamation wave 5 (#290). On the overlap rule's step 2 I made one
    substitution: clause 15 allows an absorb only on a measured conflict, and the merge-tree was clean. So I measured
    that exact merged tree in a scratch snapshot with its own `npm ci` (`session-hook.test.ts` 335/335,
    `typecheck-tests` 12/12) instead of having the worker merge `main`. Reported to calm-mesa (mail 3755).
  - Wave 2's run (306) was opened before run 271 closed, so the programme never had zero open runs. This amends the
    planning-shape entry above: a wave's run may open before its plan exists, but it is never dispatched until its
    plan is written and approved.
  - Review 304's residue, ruled for wave 2's plan:
    - F1: narrow the claim. A `..` that is not at the string's start or after `/` is a known limit, pinned by a row.
      Widening `DOTDOT` would red 18 historical strings in fixtures whose versions are no longer installed.
      [Corrected 2026-10-07, review 318 F5: the corpus now holds 20 such strings in 10 files (` ../raw-wt`, two to a
      file; `grep -rhoF ' ../raw-wt'` over the committed fixtures, as the plan's D-4007 counts), 18 in 9 files before
      2.1.292's capture added two. At this ruling only 4 of the 18 were in versions no longer installed (2.1.280 and
      2.1.281, per the lane read of 2026-10-06 14:58 UTC in this ledger as merged in `22b4eabda`); 2.1.288 is not
      installed as of 2026-10-07, which makes six of the 20, as D-4007 states.]
    - F2: the compaction gap gets its own deviation number, and the plan header and "Versions covered" say Q5
      compaction is unmeasured.
    - F3: date each mutation count by the commit it was taken at, and drop "every count matches".
    - F4: a known limit plus a pinning row.
    - F5: an empty `--scan` argument is refused with the usage exit 2, plus a row.
    - F6: word the `--scan` index promise as the code behaves.
    - F7: `rig.sh run` refuses a missing binary with exit 2, plus a row.
    - F8: an unreadable meta gets its own marker, and the header's self-contradiction goes.
    - F9: `--home` is resolved like `--repo`, plus a row.
    - F10: distinct markers for an unreadable worktree directory and `CLAUDE_BASE`.
    - F11: an amendment slug for the `workflowPhase` contradiction.
    - F12: one re-capture script, because every wave now begins with a re-capture.
    - F13: the wording fix.
- **2026-10-05 — the parent incarnation field is already in the tree** (spec §5.1, §8.1 item 10): `$REG/<id>.generation`
  (D-2605) is never rewritten once present. The hook also sees it as `CCRC_SESSION_GENERATION`, but ccd does not set
  that on every spawn path, so later waves read the file. Wave 1 records this from source. **Corrected after review
  277 (F27):** the file is not minted at row creation alone — ccd mints it on genuine absence at four sites, and a
  live row can lack it (ccd's own comments quote 31 of 34 rows without it, measured 2026-09-17). The resume retry
  spawn also drops the environment value silently when its re-read fails. So an absent or invalid file is an
  UNMEASURED incarnation, never a changed one.

Deviation numbers: each wave's block is minted at its run-open and recorded here in prose; no number is spelled as
a `D-` token in this file until a plan defines it. **Wave 1 (run 271):** twenty numbers, 3992 through 4011, minted
2026-10-05 15:20 UTC. The plan's ten slugs take the first ten in the order the plan lists them; the rest are for
departures found mid-wave (Tasks 4–6's rig fixes among them). Numbers not used stay unused; nothing re-issues them.

- **2026-10-07 — operator decision: the real-lane cross-check moves to a worker, in a close-out wave 2.** Wave 1's plan
  had the coordinator start two `-hookcap` lanes with `ccd start`, which coordinator clause 1 forbids. That
  assignment was a planning error: in the stall-watch precedent, the wave's own executing session ran those lanes.
  Asked to choose, the operator picked "fold into wave 2A":
  - Run 306 becomes a close-out wave: the cross-check, a capture of every fleet Claude Code version the corpus
    lacks, review 304's residue, and the one re-capture script that the residue ruling F12 asks for.
  - The broker's observe stage moves to wave 3, so the programme is now 7 waves. Run 306's stored denominator
    still reads 6; it is cosmetic and is corrected at wave 3's open.
- **2026-10-07 — wave 2's routing:** Opus · xhigh main loop, Sonnet · high implementers, an Opus · high reviewer per
  task, Haiku scouts, workflows off, compact 40. This raises the spec'd-plan row's high by one rung on wave 1's
  evidence: two fix rounds of missed-test findings, and the round run at xhigh landed 29 of 36 cleanly.
- **2026-10-07 — wave 2's deviation block:** ten numbers, 4364 through 4373, minted before dispatch. They are defined
  in wave 1's plan's "Deviations found", because every departure this close-out can make is from that plan.

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
- **The corpus must cover every Claude Code version the fleet runs before a wave depends on a hook field** (spec
  §8.1). Lanes update often, so each such wave begins by re-reading the lane versions and capturing any the
  corpus lacks with the rig's recapture steps. `--missing` may be relied on only once the re-capture tooling
  obligations below are closed (D-3999 in wave 1's plan); until then an unmeasured cell is not coverage.
- **The observe stage's spool line (review 296; wave 3 since the 2026-10-07 renumbering):** on the largest repo the
  worktree-name listing alone is about 3.9 KB, which nearly fills spec §5.3's 4 KiB line. The observe stage's line
  design must measure that case: the listing is the optional field that gets dropped, and the worst case is about
  8.5 ms per call.
- **What wave 2 (run 306, reviews 318, 324 and 328) hands to wave 3's plan.** Its evidence is in the
  "Real-lane cross-check" section and the plan's D-numbers named below; a wave 3 plan reads these before it names a
  task:
  - Wave 3's first implementation commit is the red-first `tmux display-message -p -t "$TMUX_PANE" '#S'` ownership
    correction in the hook, so an event fired during teardown is dropped and not filed under another live session
    (amendment `teardown-hook-event-names-another-session`).
  - The hook's turn-marker classifier (`paid` in `ccd/session-hook.sh`) is a second reader that treats a raw
    non-empty `agent_id` as subagent placement. No harm was measured: earlier main-thread events had already marked
    both turns `working`. Wave 3 must resolve that reader against the qualifying-join contract with a red-first
    phantom-main-thread case and without assuming `agent_type`, after the first-commit correction above unless its
    approved plan proves the two must be one atomic change (amendment `tool-agent-id-alone-is-unjoined-evidence`).
  - Wave 3 closes three re-capture tooling obligations before any later capture relies on `--missing` (D-3999 in
    wave 1's plan): `recapture.sh` exits 0 when single runs failed; `rig.sh versions` reads an unreadable versions
    directory as none installed; and `recapture.sh`'s closing cleanup hint prints the raw root unescaped, so it is
    escaped before any later capture relies on it. The obvious `%q` change reds two existing rows, the spaced real-run
    row ("a real run over a tree and a TMPDIR whose paths carry a space …") and the "--dry-run, no version named …"
    row, whose `<raw>` placeholder `%q` turns into `\<raw\>`, so the red-first fix updates and proves both, not one.
    Until these close, an unmeasured cell is not coverage.
  - D-4008's three folds, `locked` (false when its stat fails), `baseAgreesFirstLog` (null when `logs/HEAD` cannot be
    read) and an unreadable `gitdir` (read as absent), are no positive cleanup or adoption evidence.
  - An activity id is selected once, at open, and is restored, never re-hashed. Whichever wave builds the journal's
    checkpoint, pruning and reconstruction keeps each selected id in the checkpointed applied state, restores it
    verbatim, derives one only for an activity the checkpoint does not hold, and prunes no event before a durable
    checkpoint covers it and no identity event before a checkpoint holds its id (spec §5.2, §5.12 and §8.4's row;
    amendment `tool-agent-id-alone-is-unjoined-evidence`, review 328 F1).
  - All eight real-lane amendment slugs carry into wave 3: `agent-input-keys-are-the-callers`,
    `post-turn-subagentstop-is-unpaired`, `real-payloads-carry-scratchpad-dir`,
    `toolsearch-may-precede-a-workflow-call`, `parent-stop-does-not-bound-workflow-start`,
    `workflow-phase-is-not-always-written`, `teardown-hook-event-names-another-session` and
    `tool-agent-id-alone-is-unjoined-evidence`.

## Next-wave brief

**Wave 2 — the measurement close-out (run 306), dispatched 2026-10-07.** In order:
1. Review 304's residue, as ruled above, with the F12 re-capture script first.
2. A capture of every Claude Code version the fleet runs that the corpus lacks, read at the start: 2.1.292 at least.
3. The real-lane cross-check, run by the worker under wave 1's plan "After the merge" standing rules. Its reduced
   tables go into the measurement section under "Real-lane cross-check", each difference as an amendment slug.

One PR from a fresh child. A review run on the held-out panel follows.

**Wave 3 — observe (report-only)** comes next:
- It is planned only once wave 2's cross-check is in the measurement section, from the measured fields only.
- Its contents: the spool, ingestion and cursors, the one `delegation_*` migration, the census extension, correlation
  and reconciliation (report-only), the coordinator-intent route, and coordinator clause 17.
- It carries the spool-line constraint: a listing of about 3.9 KB nearly fills the 4 KiB line.
- Its plan starts from the carried constraints above, which wave 2's review rounds added: the first
  implementation commit (the red-first `-t "$TMUX_PANE"` ownership correction); the turn-marker `paid` reader's
  phantom-main-thread case; the three re-capture tooling obligations, closed before any capture relies on
  `--missing` (D-3999); D-4008's three folds as no positive cleanup or adoption evidence; activity ids restored from
  the checkpoint, never re-hashed after pruning; and the eight real-lane amendment slugs.
- Its plan is Markdown, `docs/superpowers/plans/<date>-<topic>.md`: plans stay Markdown under the operator's
  2026-10-07 ruling, and ccrc-pwa's deviation and ledger guards, which read `*.md` plans, are one reason (review 328
  F2).
- The operator reviews the plan before its run dispatches.
