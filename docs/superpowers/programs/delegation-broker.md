# Program: delegation-broker

Spec: `docs/superpowers/specs/2026-10-04-delegation-broker-design.md` (approved 2026-10-05, revisions R1–R9 included)
Plans: `docs/superpowers/plans/2026-10-05-delegation-broker-wave1-measurement.md` (waves 1–2) and
`docs/superpowers/plans/2026-10-08-delegation-broker-wave3-observe.md` (wave 3, operator-approved 2026-10-09). Waves
4–7 are planned one at a time from the measured fields, each before its run dispatches
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-soft-basin` (the session that wrote the spec; claimant of run 271)
Workspace: **a fresh child per wave**

**What this program is.** A coordinator that delegates through generic `Agent` / `Workflow` calls or a raw
`git worktree add` leaves nothing ccrc can see: no run edge, no hold, no history, no cleanup owner (spec §1). The
program adds a server-owned delegation broker in six design stages, each shipping dark or report-only and enabled
separately: measure what Claude Code actually emits (1), observe it into a journal and a store (2), project it into
the fleet tree (3), adopt provable work and let a coordinator promote it into a real run (4), audit leftover
worktrees in shadow (5), and finally clean them through the existing safety spine (6). The programme delivers those
six stages in seven waves because wave 2 is a separate close-out of stage 1; programme wave 3 therefore owns design
stage 2, and every later stage is offset by one. It never forbids `Agent` or `Workflow`, never forces isolation, and
never links work by a name, a path, a time or a working directory.

## Waves

| # | spec stage | scope | deploy class | depends on | PRs | state |
|---|---|---|---|---|---|---|
| 1 | 1 Measure | `SessionEnd` registered (captured in a `-hookcap` session, otherwise inert); the capture reducer's delegation block; the mock-API capture rig in the tree; the fixture corpus and its derived matrix; a read-only on-box census | fleet (the hook and installer reach homes through `ccrc update`); tests | — | #284 | **merged** 2026-10-06 as `22b4eabda` after reviews 277, 296 and 304 and two fix rounds; run 271 closed `done`; review 304's 13 findings carried to wave 2 as residue |
| 2 | 1 Measure (close-out) | the real-lane cross-check (a worker runs two `-hookcap` lanes); a capture of every fleet Claude Code version the corpus lacks; review 304's residue; one re-capture script | tests and docs (the hook and installer unchanged) | 1 | #321 | **merged** 2026-10-13 as `4967dc495`, a plain merge of exact head `823efd3eb` (fix round 5, which absorbed `main`), adding history only; its content first reached `main` inside #340's squash `081636389` on 2026-10-10, byte-identical to `e183237e5`, the tip review 334 accepted; run 306 closed `done` |
| 3 | 2 Observe | exact-pane and turn-marker corrections; current-lane recapture; bounded hook spools; additive byte-safe ingestion; journal/checkpoint and one complete `delegation_*` migration; census, correlation and report-only reconciliation; checkpoint-owned health; delegation-hooks doctor; coordinator intent and clause 17 | fleet first, then server; skills/doctor | 2 | #448, #597 | **merged** 2026-10-18 as `46c50a9a4` (03:04:32Z), a squash of head `1ee3c784a`, after reviews 518, 533, 544, 556, 563, 578 and 583; run 360 closed `done`; dispatched 2026-10-14 00:25:04Z: run 360 to a fresh child (`ccrc-pwa-soft-delta`, branch `ws/soft-delta`) with all 16 items, from plan commit `081636389`, after every overlapping claim's holder consented (decisions below); plan and O1–O5 operator-approved 2026-10-09; block 4633–4664; pre-soak follow-up #597 merged 2026-10-18 as `c1453e422` (22:04:47Z), a squash of head `7cb2ccda5`, after reviews 610, 615 and 617; run 600 closed `done`; D-5433..D-5436 used from block D-5433..D-5438; prerelease `v0.0.299` |
| 4 | 3 Project | the `delegation` frame; activity and lease rows in the PWA; a ccd prune of absent owners' spool directories (operator ruling 2026-10-14) | server + pwa, plus the fleet box for the ccd prune (order set by its plan) | 3 | — | to plan |
| 5 | 4 Adopt | `ws-lease-mark` and carriers; read-only `ws-lease-audit`; adoption; digest mail; retain and resolve; promotion through `ws-add --base` | **AGENT-FIRST**, then server | 4 | — | to plan |
| 6 | 5 Clean (shadow) | audit tokens for due leases; shadow rows; the shadow review | server | 5 | — | to plan |
| 7 | 6 Clean (live) | `ws-lease-clean`; the executor taking a target record | **AGENT-FIRST**, then server | 6; #166 wave 4's sweep (merged #215, live) | — | to plan |

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
  event that named it" is, for an `agent_id`-keyed activity, the earliest journal event of the parent (same
  incarnation) that names that id and is retained when the activity opens, once a qualifying join is known, whichever
  join came first; on every measured order that is the launch response or SubagentStart itself. A qualifying join
  gates opening; it contributes no hash component and does not choose among the journal events retained when opening
  occurs. Once the retained evidence set at opening is fixed, neither the qualifying join's kind or order nor the
  time of a positive meta read contributes a hash component or selects among those retained events. Timing can affect
  which events remain retained before opening only through the pruning contract below: an occurrence pruned before
  any qualifying join for that id is durably applied is gone permanently as evidence (review 332 F1). A bare occurrence never
  opens an activity, but once a join is known it may be that earliest event (a refinement of review 318 F1's wording,
  ruled with review 324). The other source kinds keep the first event naming their upstream id. A meta is a join, not
  a journal event, and nothing of it is hashed (review 324 F3, F4). The id is selected once, at open, and never
  changes: it is part of the checkpointed applied state, reconstruction restores it verbatim and never re-selects it
  from the journal left after pruning, pruning cannot pass an identity event before a durable checkpoint holds its
  id, and a bare occurrence pruned before any qualifying join for that id is durably applied never becomes one (review 328 F1;
  spec §5.2, §5.12). The observe stage's parser (wave 3) must not use the presence of `agent_type` to decide whether
  an event qualifies — spec §5.2 activity id, §5.3, §5.4 rung 3 (a non-empty `agent_id` does not by itself place an
  event inside a subagent).
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
  the workspace is reclaimed; ephemeral worktrees are cleaned under the #166 / workspace-lifecycle spine; the new
  ccd verbs are workspace-lifecycle verbs, not coordination mutation; four corrections from measurement.
- **2026-10-05 — operator decision: spec approved with revisions R1–R9** (spec §2.1): promotion dispatches a child
  from the lease's tip; only the server journal creates a lease; rungs 3 and 4 narrowed; hour-bucketed spool; a
  separate read-only `ws-lease-audit`; admission rung 6 replaced; a `delegation` frame; carriers and the audit ship
  in stage 4; a worker's leases nest under the top coordinator "via <worker>".
- **2026-10-05 — planning shape (historical six-stage numbering).** Wave 1 was planned in full; later design stages
  are planned one at a time from measured fields because the spec forbids a contract on an unmeasured field (§8.1).
  Since the 2026-10-07 close-out decision, six design stages are delivered through seven programme waves. Each
  implementation wave's plan is written and reviewed before its run dispatches; wave 3 returns to opening only after
  operator plan approval.
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
- **2026-10-10 (found 2026-10-12) — #340 landed before #321 and carried wave 2's content.** The ledger had #340 land
  after #321. It was squash-merged first, as `081636389`. The coordinator had built the ledger branch on top of
  `ws/plain-hollow`, so the branch held all 55 wave-2 commits (`e183237e5` is an ancestor of its tip, `fe0c81900`).
  The squash therefore put wave 2's content on `main`, outside wave 2's own landing. All 24 non-ledger files wave 2
  changed are byte-identical on `main` to `e183237e5`, the tip review 334 accepted. So nothing unreviewed landed, but
  the landing skipped the run's own record. This was the coordinator's error. Coordinator clause 15 keeps
  programme-ledger documents on the coordinator's own ledger PR, never inside a feature PR. A ledger branch cut from a
  wave branch carries that wave's commits, so a ledger branch is cut from `origin/main`. This entry is the first
  written on a branch cut that way.
- **2026-10-12 — #321 conflicted with `main` in the ledger only.** GitHub read #321 `CONFLICTING`/`DIRTY`. `git
  merge-tree` against `main` named one path, this file, changed on `main` only by #340. To send a fix round, run 306
  had to go from `merging` to `working`. The cap refused that twice (`cap-concurrency`, 7 of 7 active runs, at
  10:37Z and 10:49Z). The operator then authorised a one-shot waiter in the coordinator's session. It advanced run 306
  at 20:35:24Z.
  - The worker had already spent #321's one self-licensed absorption (`f7d57b16b`, 2026-10-07). Fix-round mail 4405
    therefore named the PR ejected from the landing line at base `2d1835188` (worker clause 16, trigger 3). This
    repository has no merge queue and no strict status-check policy, so the ejection was the coordinator's measured
    landing check, not a queue event.
  - Ruling: resolve the ledger by taking `main`'s version verbatim. `main`'s ledger already held 248 of the branch's
    279 added ledger lines. The 31 it lacked were wording #340 had superseded: review 334 F2's identity timing,
    O1–O5 in place of review 332's open questions, and the approved wave-3 plan in place of the old next-wave bullet.
- **2026-10-12 — fix round 5's wave-done verified (mail 4411).** The worker merged `main` at `2d1835188` with `git
  merge`. Only this file conflicted, and the worker took `main`'s version. The tip is `823efd3eb` (parents
  `e183237e5` and `2d1835188`).
  - Its tree equals `main`'s tree, so #321 then carried no content diff against `main`.
  - Re-gate: 11 docs-sensitive and hook files 1236/1236, and `session-hook.test.ts` 450/450 alone. Exact-head CI run
    38306081177 was green on every required check (664 server test files).
  - The worker's `suite:` line stays `red`, as first reported.
  - Run 306 advanced to `awaiting-review` on that fingerprint.
- **2026-10-13 — operator decision: land #321 without a new review, by admin merge.** The PR changed nothing on `main`,
  and `main`'s copy of wave 2 is byte-identical to the tip review 334 accepted. So the operator chose to skip a review
  of the empty diff. They ruled a plain merge commit at the exact head, not the `--squash` the wave lifecycle
  prescribes for a landing without a merge queue: the PR carried no content, so a merge commit adds only wave 2's
  history. The PR's author is the same account the coordinator's `gh` uses, so no approval could be given. The
  operator then instructed an admin merge, bypassing the ruleset's one-approval rule.
  - Correction: the next-wave brief below calls `--admin` forbidden. Clause 15 forbids it only on a native-queue
    project, and the wave lifecycle prescribes it where a repository's ruleset requires it, as this one does.
  - Run 306 advanced to `merging`.
  - `gh pr merge 321 --merge --admin --match-head-commit 823efd3eb…` merged it at 01:48:36Z as `4967dc495` (parents
    `24c9da9fc` and `823efd3eb`, no content change).
  - Run 306 closed `final:true`, `done`, `released:true`. Its workspace's reclaim is deferred to the server's sweep,
    because the programme stays open through run 360.

- **2026-10-13 — wave 3's claims settled by consent, not by waiting.** Four runs held claims that overlapped the
  wave-3 file map: run 354, run 400, run 399 and run 410. On the operator's word, the coordinator asked each holder's
  coordinator for region consent on the terms of R56, the region-consent ruling in the child-reclamation contract
  §12. All four consented, each with fenced regions:
  - mail 4690, for run 400; mail 4699 extends it to `server/src/coord/db.ts` and `server/test/asks-store.test.ts`;
  - mail 4699, for run 399: new describe blocks only, in `server/test/fleet-health.test.ts`;
  - mail 4691, for run 354, with one condition on meaning: Task 2 must not change the hook's `$paid`. Task 2 adds a
    variable of its own and switches only the turn-marker reader;
  - mail 4695, for run 410: wave 3 may add only its new `delegation-hooks` check, that check's remedies and its one
    list entry in `ccd/ccrc-doctor-checks`, and nothing in the box-token check.
  The brief names every consent and states the key fences. The consent texts, with every fence verbatim, reach the
  worker in a clip file outside the repository. A 409 naming one of those runs on a consented path is the worker's
  licence; any other 409 is a clause-11 question.
  - The first dispatch, at 23:44Z, was refused `cap-daily` (24 of 24 in the rolling window). A one-shot waiter in
    the coordinator's session re-ran the claim gate and dispatched at the first age-out. Run 360 went to
    `dispatched` at 2026-10-14 00:25:04Z with all 16 items and the route below. At send, all 25 overlapping
    claim-path pairs were licensed.
- **2026-10-14 — path identity W1b (run 433) and wave 3 share files by mutual consent.** Run 433's coordinator
  asked to edit `ccd/ccd` beside run 360's claim 1281 (mail 4790). The coordinator consented (4791), with fences:
  - wave 3 owns `_reg_purge`'s GENERATION LAST unlink line (wave 3 appends the join record's unlink to it), the
    spool directory's creation beside `_child_tmpdir` on the spawn path, and `delegation-events-v1` in `cmd_caps`;
  - W1b owns the argument loops, the post-loop id checks, the id predicates, ws-add's id minting, `cmd_start` and
    `cmd_enable`, the audits' entry lines and the collector. Its inserts go inside the temp-root witness block.
  Run 433's coordinator consented in return:
  - in mail 4793, to wave 3's Task 14 in `ccd/ccrc-doctor-checks` and to its spawn-directory pins in the existing
    `ccd-ws-add*` tests. Task 14's `CCRC_DOCTOR_CHECKS` entry is licensed by 4695, not by 4793;
  - in mail 4832, to three in-place edits of the `_reg_purge` unlink-count ratchet in
    `server/test/ccd-workspaces.test.ts` (28 → 29).
  Both sides regenerate the stamp line. Whichever lands second merges `main`, keeps both sides, re-points by content
  and restamps `ccd/ccd`.
- **2026-10-14 — operator ruling: wave 4 owns pruning absent owners' spool directories.** The worker found (mail 4946)
  that a session's spool directory keeps its last 24–25 hourly buckets after the session is gone.
  - The hook prunes only its own owner's buckets (spec §5.3, W3-M06), and nothing removes the directory of a purged
    owner, or of one that never runs again.
  - So the rollout line "hooks retain only their own 24-hour buckets" holds only for live owners.
  - The coordinator ruled (mail 4947) that wave 3 adds no deletion: it corrects the wording and records the gap as a
    deviation from its block.
  - The operator ruled that wave 4 adds a ccd prune. It removes `$REG/delegation/spool/<id>/` only when the owner's
    registry row is gone and the directory's newest bucket is more than 24 hours old: the same day of ingestion the
    spec gives a live owner.
  - That makes wave 4 a ccd change as well, so its plan sets a deploy class that includes the fleet box.
- **2026-10-14 to 2026-10-18 — other programmes shared wave 3's files by consent.** Each consent names its regions.
  Whichever PR lands second merges `main` (never a rebase), keeps both sides, re-points citations by content and
  re-runs the touched suites.
  - Run 308 (`ccrc-pwa-quiet-river`), mails 5003 and 5005: run 308 edits its named `ccd/ccd` functions
    (`_resume_env`'s body, `_sync_uuid`, the operator-choice functions); wave 3 keeps its `_reg_purge` line, its spool
    helper and its `cmd_caps` word. In return, wave 3's Task 14 adds only its new `delegation-hooks` doctor check. 5005
    adds that the second-lander steps never license a merge of `main` on their own; worker clause 16 still decides.
  - Run 413 (5112, 5113), on `server/test/single-definition.test.ts`: own lines only; if both append a describe at the
    end of the file, run 413's stays last.
  - Run 400 (5149), on `shared/api.ts` and `server/test/single-definition.test.ts`: keep both sides, with wave 3's foot
    block after `main`'s and run 400's.
  - Run 399 (5103, worker to worker under clause 11): additive hunks in `server/src/watch.ts` and
    `server/test/divergence-sweep.test.ts`, off the regions 5103 lists.
  - Centralised update waves 15 and 16 (5255), path identity wave 2 (5339) and centralised update wave 19, run 483
    (5448): each fenced to its own functions or lines, and off wave 3's.
  - `README.md` and `CLAUDE.md` were held by run 468 (`ccrc-pwa-plain-mesa`). It consented to each in-place edit wave 3
    made there (5227, 5233, 5248, 5352, 5441, 5514, 5743, 5827, 5879). Its 6109 raised no objection to any notice sent
    (5938, 6025, 6046 and 6069 had gone unanswered) and said none is needed in future.
- **2026-10-15 — operator rulings: a torn journal tail heals itself, and wave 4 fixes the installer's foreign-hook
  drop.**
  - D-4642 had a torn journal tail block capture and every caller. Offered three options, the operator answered "we
    need a self-healing mechanism for this" (coordinator mail 5246). Task 8C built it as D-4655, which supersedes
    D-4642.
  - Healable means bytes after the last LF only, with every complete record valid, the chain intact, and the
    checkpoint naming a complete record or none. Anything else is corruption and stays fail-closed.
  - The server, the journal's sole writer, heals inside the serialised applier. It quarantines the torn bytes under
    `~/.ccrc` (never deletes them), fsyncs, truncates to the last complete record and fsyncs again. Capture never
    writes the journal: on a healable tail it captures the complete prefix and records the tail's length and SHA-256
    in an additive manifest field.
  - A heal is reported, never silent and never a doctor FAIL. Mail 5424 made one more case a must-fix: a heal that the
    process dies before reporting is reported at the next boot, from the quarantine directory alone.
  - The same day the operator chose option B for the installer. `ccd/install-session-hooks.sh`'s `JQ_UNMANAGED` filter
    drops every hook group, under any event, that holds a `/session-hook.sh` command, foreign commands in it included.
    Wave 3 leaves the installer as it is; its new doctor fixer refuses a home with such a mixed group and leaves
    `settings.json` byte-identical (R55, widened in the answer to mail 5179). Wave 4 owns the installer fix: a per-hook
    sweep that removes only ccrc's own command and keeps a backup.
- **2026-10-15 to 2026-10-16 — the bounds for the worker's own lane rulings (coordinator mail 5213).**
  - A lane change is the worker's to rule only when it lives in lane memory or inside the normal durable application,
    adds no file and no SQLite-only state, leaves the journal untouched, and moves verdicts only toward unmeasured
    (D-4008's direction). A second durable file, journal compaction, the O5 order and the O3 snapshot contents stay the
    operator's.
  - Accepted inside those bounds: R65 and rung 4's 20-minute margin (5354); R67 to R69 (5387); R70 for
    `refused-project`, its `not-a-checkout` arm only on 5387's condition, which R71's streak carries; R73 to R75 (5406,
    5424); R77 (5439); M-A and D-4658 (one durable application per pass; 5443); and D-4659 (lost evidence never decides
    a link; R84). Each lane mark states what sets and clears it, with a safety row and a liveness row.
  - Accepted apart from those bounds: D-4656, the intent door exempt like the claim lanes, as the plan corrected to
    the spec's route row (5354).
  - Rung 4's margin rests on Claude Code's 10-minute ceiling for a foreground Bash call. Measured on the fleet box on
    2026-10-16 (5443): no home and no running Claude Code process sets `BASH_MAX_TIMEOUT_MS` or
    `BASH_DEFAULT_TIMEOUT_MS`. A doctor WARN for either variable goes to wave 4.
- **2026-10-16 — operator ruling on rung 4: "Keep, decide later".** The worker's question (5472) was a creator outside any
  hook window, such as a background job, getting a wrong permanent lease. The coordinator's answer (5477) named the
  whole class no hook can bracket: background Bash and Monitor calls, children a foreground call leaves running, calls whose text lacks the
  worktree token, tools that are not Bash, sessions with no spool, creators filed under another repository, and
  anything outside Claude Code. Across that class rung 4 contradicts spec §5.1 and §5.3. The coordinator declined a
  narrow hook fix and asked the operator.
  - The ruling (relayed in 5480): wave 3 journals rung-4 links as designed, each traceable to its bracketing command.
    Before wave 4 displays anything, the operator rules on how soak-era and later rung-4 links are treated.
  - It changed no linking. It made the identification answer load-bearing: every rung-4 lease the soak creates is
    listable from the journal with its creator's `toolUseId` and both listings. Four gaps go to the operator with wave
    4's plan: the lost-evidence context is not kept with the lease; other sessions' calls around a lease are not held;
    hook-level drops and sessions with no spool leave no trace; and the listing's common dir is never recorded.
  - Measured by the worker (5493): the census lists linked worktrees only, so a worktree-naming Bash call from a main
    checkout matches no tree and vetoes every repository. Rung 4 is expected to read largely unresolved or unmeasured
    live. Attributing main checkouts (Q-W4) goes to wave 4.
- **2026-10-16 — re-review B ruled, the M-B fields licensed, and #448 opened (mails 5497 and 5504).**
  - Re-review B's Q2/F4, ruled "keep the letter" (5497): of 66 active session units, 0 lacked a generation file, so a
    fold toward linking bought nothing measured. Incarnation-absent owners are named in wave-done and the README, and
    go to wave 4 beside hook presence if they matter during the soak.
  - B-F1 (important) was fixed as R85: a held `Pre` with no `Post` is lost evidence (§5.3).
  - The M-B field licence (5504): `foundAtBoot?: true` on the tail-heal surface D-4655 names, and
    `tailQuarantineUnmeasured?: true` on delegation health. Both are additive, under protocol 1, and mark the heal
    report unmeasured, not the lane's verdict. Review 518's F8 later found these fields had no D-entry.
  - #448 opened at head `db97d89c4` (5503).
- **2026-10-16 — wave 3's first wave-done verified (mail 5507); review 518.** The tip, the handoff commit and #448's
  head were all `6d7ae4990`, and all 16 items settled `done`. The worker sent `suite: red` (box-only reds and named
  flakes; the full run at `db97d89c4` had no branch-red file) and `failure: shallow`.
  - Reviewer `ccrc-pwa-swift-river`, at `6d7ae4990`. Panel complete: 45 agents, 13 confirmed, 1 refuted, 0 unexamined,
    no unverified lens.
  - 18 findings, 5 important (S1, F1, F2, F3, W1) and 13 minor; W5 was refuted as a defect and kept on record. S1 was
    `ccrc-doctor.test.ts`'s end-of-file fixture sweep timing out on this box. F1–F3 were unpinned guards. W1 was a
    session the lane never visits: it makes no lost window, so rung 4 links across it.
  - Ruled in fix round 5512: W1's known part fixed now (a lane-down or recovery stretch is a lost window over every
    repository, and a listed owner is read once before it is dropped); W3 fixed; rows for F1–F6, W4 and W5; S1 fixed and
    measured by one background whole-file run; F7, F9 and F10 recorded as D-4660, D-4661 and D-4662; F8 and W5 as
    amendments of D-4655 and D-4659; F11 and F13 as comments; F12 no action. W1's never-listed part and W2 went to the
    operator (next entry).
- **2026-10-16 — operator rulings on review 518's W1 and W2.**
  - W1's never-listed session (born and gone between two census passes, never read): "Wave 4". Wave 3 discloses it and
    pins today's link (R91); wave 4 lists the spool root.
  - W2, `deploy/deploy.sh`'s `prune_backups`, which keeps the newest `CCRC_BACKUP_KEEP` timestamp-named directories and applies
    none of Task 8 Step 6's keep sets: "Accept; W16 blocks KEEP=0". The age-only fallback prune is accepted for the soak
    and recorded as D-4663, and wave 3 makes no `deploy.sh` edit. Centralised update wave 16 took the guard as D-5144:
    `prune_backups` refuses an all-zeros `CCRC_BACKUP_KEEP` and prunes nothing, its selection and delete lines
    unchanged. It landed in #444 as `13f11b696` on 2026-10-17 at 20:06Z. Full keep sets go to a later wave, on wave 4's
    list.
  - Review 568 of #444 found that `prune_backups` keeps the newest directory by name, which the deploying machine's
    clock sets. By agreement (6007) that stays in centralised update wave 17, because #448 makes no `deploy.sh` edit.
- **2026-10-17 — review 533 (`ccrc-pwa-amber-hollow`, at `8e758c8f0`).** Panel incomplete: the correctness and spec
  lenses returned, and the reproduce lens never did, because the box's out-of-memory killer took the reviewer's pane
  four times.
  - 4 findings: F1 important (R109's tick-level mark and its `reachedOwners` flag were unpinned), F2–F4 minor.
  - Ruled: F1 and F2 fixed with rows R110, R111 and R112, each red against its own mutant, and a fourth mutant recorded
    in D-4659 as redundant; F3 fixed in place; F4 reworded inside the three consented README lines.
  - An unverified lens is not an approval (coordinator clause 14), so the next scoped review re-ran the reproduce lens.
- **2026-10-17 — review 544 (`ccrc-pwa-swift-basin`, at `5a058fc4c`).** Panel complete after two out-of-memory resumes:
  4 confirmed, 4 refuted, 0 unexamined.
  - 5 findings: P2 important (a boot recovery left the ready instant at the pass's clock), and P1, P3, P4 and the
    reviewer's own M1, minor.
  - Ruled: P2 fixed (R113: the ready instant is no earlier than recovery's return); P1's late-return arms kept, D-4659
    corrected, and R114 pins today's hold; P3 reworded with the README holder's consent; P4's count re-measured; M1 in
    prose. A conditional late-return arm was declined and left for the operator to place in wave 4.
  - The next wave-done (5849, at `9ebe539f3`) reported a new intermittent red in `session-hook-turnmark` ("concurrent
    rotators"). It is green alone and on re-run, and its cause is unknown.
- **2026-10-17 — review 556 (`ccrc-pwa-brisk-prairie`, at `9ebe539f3`).** Panel complete: 15 agents, no deaths, no
  unverified lens. 6 findings, all minor.
  - Ruled: F3 enforced (R115, a clamp for a backward clock step); W1 fixed (R116: the lane is not ready while a recovery
    it started has not settled); F2 pinned (R117); F1 argued in D-4659 rather than pinned, because no order was found in
    which the second mark matters; W2 reworded with consent (5879).
  - W3: the hook's 2 s tmux lookup bound and its jq read's `|| exit 0` drop a whole event silently. Ruled part of the
    carried class: D-4662 corrected, and the drops go on wave 4's list.
  - Centralised update's coordinator, `ccrc-pwa-bright-river`, had operator authority to merge that programme's
    completion chain, with #448 on it; #448's merge stayed with this coordinator (5892, 5895). The worker then merged
    `main` `71fb70189` (`feac1a7a2`). CI at that merge was red only in `main`'s own `dispatch-live-gate.test.ts`.
- **2026-10-17 — the landing freeze with centralised update (mails 5954 and 5960).** Whichever of #448 and #444 was
  ready first would land. Once either sent its landing absorb, the other would not merge until that PR landed or its
  coordinator said it had stopped. #444 merged first. Mail 6021 said #448's absorb had started, and 6022 held #441 and
  #482 until #448 landed. Mail 6157 ended the freeze at #448's merge.
- **2026-10-17 — review 563 (`ccrc-pwa-swift-prairie`, at `a8c2cd90f`).** Panel complete at the last fix commit
  `e78020622`: 15 agents, no deaths, 0 unexamined. 2 minor findings, neither needing a ruling: F1, no row pinned R115's
  clamp on the `recoveredAt` arm; F2, a plan sentence that said the reverse of the cut-recovery order. Ruled: row R120
  and the prose fix, as the first commits of the landing round.
- **2026-10-17 to 2026-10-18 — the landing round.** #448 then conflicted with `main` in eight files. This repository
  has no strict status-check rule, so the coordinator ejected the PR (worker clause 16, trigger 3) at base `27f0a24a0`
  (fix round 6020), and named a new base at each later absorb.
  - K `de20f154c` (R120 at `c16bfd137`, and the prose fixes). M2 `88ca1584e` merged `main` `d656d022a`, eight files
    resolved by rule. `4b4cc226d` raised `ccrc-api-closed`'s route census from 24 to 25, for #508's route.
  - M3 `a3c8df5f7` merged `8e6abf461`. #511 had taken `MIGRATIONS[20]` (`user_version` 21), so wave 3's migration moved
    to `MIGRATIONS[21]`, `user_version` 22, with its SQL byte-identical. It had never shipped: releases come from `main`
    only.
  - M4 `4e824f5bd` merged `0e48e786e` (`CLAUDE.md` line 10, `server/src/coord/routes.ts`, `shared/api.ts`). Review 578
    read K through M4.
  - After it: `5f87b0859` and K2 `2a915cb1d` (review 578's fixes), then M5 `e368c9423`, merging `7129eca88`, and M6
    `fff4f4f7a`, merging `3b5473fbb` (citations only).
  - CI at M6 was red in `refusal-status.test.ts`, #572's ratchet. M7 `4032ba2de` merged `14be46e1d` cleanly. F7
    `e8caac911` sends the intent route's six refusals through `refuseRoute` and declares its three words
    (`application-failed`, `incarnation-changed`, `not-ready`) in `GENERIC_REFUSALS` and `REFUSAL_STATUS`, with no pin
    changed. P7 `2fe4fdf51` records it in the plan. `4464fd452` fixed a clock flake in a
    `delegation-wave3.integration` test.
  - M8 `1ee3c784a` merged `004357787` (citations only). Review 583 read K2 through M8.
  - Pre-merge re-probe: `main` had moved to `9ce0d5310` (#579), and the merge-tree was clean. The named suites passed on
    the merge tree, except one `single-definition` case that needs the `.git` the scratch copy lacked; the PR read
    mergeable, and 25 checks were green with 5 skipped. `gh pr merge 448 --squash --admin
    --match-head-commit 1ee3c784a…` merged it at 03:04:32Z on 2026-10-18 as `46c50a9a4`.
  - Run 584 opened for wave 4 as `planned`, with no session: opening it on the worker's session was refused, because
    that workspace was spent with #448. Run 360 then closed `final:true`, `done`, `released:true`, with its child
    reclaim queued. The prerelease `v0.0.258` carries wave 3.
- **2026-10-18 — review 578 (`ccrc-pwa-quiet-meadow`, at `4e824f5bd`).** Panel complete at K: 12 agents, 3 confirmed,
  0 refuted, 0 unexamined. 5 findings, all minor.
  - F1 and F5 (a test comment and a doctor-checks comment) were fixed in `5f87b0859`, and F2 and F3 (two plan
    clauses) in K2 `2a915cb1d`, which also carries F4's D-4659 bullet.
  - F4: #512's stop-done lane stops idle children; a stopped pane reads `dead`; and the lane's circuit breaker reads
    two such stops within 10 minutes as a mass death. While suspended, `planRecord` withholds rung-2, rung-3 and rung-4
    lease requests and unowned records, and the soak (Rollout step 8) reads circuit-breaker periods.
  - Ruled: recorded in D-4659 as a limit, with no code change in wave 3. The coordinator's first reading, that wave 3
    acts on nothing here, was corrected before the fix round went out. The operator's question was open: fix it before
    the soak, in a follow-up PR, or keep it as a known limitation (ruled 2026-10-18, "Fix before soak": D-5433, below).
- **2026-10-18 — review 583 (`ccrc-pwa-soft-summit`, at `1ee3c784a`).** Two panels, both complete, at K2 and at
  `4464fd452`: each 15 agents, 1 confirmed, 3 refuted, 0 unexamined. CI run 39089647516 was green.
  - F1 (minor): the F4 bullet names Rollout step 7 as the gate, and step 7 does not say so. Ruled no change: the D-4659
    bullet is the record until the operator rules on F4 (since ruled: D-5433, below).
  - F2 (minor): `COORDINATOR_INTENT_REFUSALS`'s docstring is stale after F7. Ruled to wave 4's list, as a line-neutral
    comment edit.
- **2026-10-18 — lesson: `shared/api.ts` citations in prose are test-pinned.** README's and the child-reclamation
  spec's citations of `shared/api.ts` lines are checked by `collect-lane-prose.test.ts` (the spec's) and by
  `session-hook.test.ts`'s README audit, which must stay empty. Wave 3 inserts 8 lines high in `shared/api.ts` (at
  `FleetHealth.delegation`), so most absorbs (M2, M3, M5, M6 and M8) conflicted on
  those citations. The first M8 draft took `main`'s side and
  planned a correction afterwards. A check rejected it: the PR would have landed with both guards red, and a
  post-merge correction in a ledger PR is outside clause 15. Resolve such a conflict by measuring the merged file and
  writing its numbers.
- **2026-10-18 — wave 3's deviation block.** The merged plan defines D-4633 through D-4663, 31 entries. D-4655
  supersedes D-4642, by the operator's ruling of 2026-10-15. 4664 is unused, as the plan's "Unused" line states.
  #448's squash title names "D-4633..D-4659" only; the plan is the record.
- **2026-10-18 — the operator's rulings for a pre-soak follow-up (run 600).** Three rulings put one follow-up PR before
  the soak.
  - On review 578 F4, "Fix before soak": the lane's circuit breaker must not count a deliberate stop or archive as a
    fresh death. This became D-5433. The coordinator dropped the restarting skip it first drafted: that skip was unsafe,
    because tmux `unknown` collapses to `alive=false`, and nobody had ruled on it. It goes to wave 4's list.
  - On a new Linux red, "Bounded diagnosis": `session-hook-turnmark`'s eight-way fan-out lost a join (CI run
    39103454968, `expected [ 'w0-1' ] to deeply equal []`). A lost update is fixed red-first; D-4662's silent drop is
    recorded only. This became D-5434. Outcome: a lost update in `_hook_join_record`'s two-read entry guard, which
    refused a first writer whose sibling had just created the file. The guard now refuses only a positive non-regular
    type, pinned by a source row. D-4662's silent exits are unchanged.
  - On wave 3's macOS reds, "Add to the follow-up": 7 `session-hook-turnmark` rotation cases and 3 `ccrc-doctor`
    spool cases. `full-suite` needs `test-macos`, so they block every stable promotion. Code that macOS gets wrong is
    fixed, and a case that is Linux-only by design skips on darwin with its reason. This is an exception to the
    2026-09-28 ruling that macOS legs gate nothing, for wave 3's own files only. This became D-5435. Outcome: the
    rotation's `-ef` re-check was wrong on darwin, whose `/dev/fd` carries the fdesc device, and now compares two
    descriptors. Two doctor cases skip on darwin by design, and one is fixed with a launchctl stub. The descriptor
    compare is pinned by `test-macos` alone, so a regression shows only in a daily or full run.
  - Run 600 opened as a wave-3 work run with a fresh block, D-5433..D-5438. D-4664 stays unused, because the plan's
    block rule repurposes no number. Run 600 was dispatched to a fresh child, `ccrc-pwa-swift-mesa` (`ws/swift-mesa`),
    whose PR is #597.
- **2026-10-18 — claims settled by consent with run 561 (the public-tree scrub).** Run 561 held `server/src/watch.ts`,
  `ccd/session-hook.sh`, README, the delegation spec and this ledger (claim 1644, renewed as 1690).
  - Its coordinator consented (6342) to run 600 editing all four unclaimed, off its lines. It carried that consent to
    561's renewed claims (6491), and consented to run 600 editing `shared/api.ts`'s `DELEGATION_SPOOL_BOUNDS` block and
    its comment only (6491). The same consent lets this ledger PR edit this file unclaimed, off run 561's lines.
  - In return, this coordinator consented to run 561 editing `ccd/ccrc-doctor-checks` comments (6479) and three lines
    of `server/test/ccrc-doctor.test.ts` (6506), beside run 600's claim. Each PR lands on its own.
- **2026-10-18 — run 600's absorb (6407).** The worker measured a conflict with `main` in `server/src/watch.ts` only:
  #595 (D-5242) had changed the same `LaneSession` Pick and the same `noteSessions` record line.
  - Ruled: take the union. `stoppedBy` and `archivedAt` are optional beside `hibernatedAt`, and an absent field reads
    as no stop evidence. #595's census lane row hands rows without either field, and the first draft would have thrown
    on them.
  - The status is tested once per row, so the hibernation census stays at `hits: 5`.
  - `cmd_hibernate` writes its marker, then `_ws_unsupervise`, then kills the pane. So a torn tick can record a
    hibernation as a death that #595's conjunct never erases; D-5433's stamp erasure clears it.
- **2026-10-18 — journal growth and the soak (operator ruling "Soak, watch disk").** The centralised-update
  coordinator measured the server box (mails 6418, 6420, 6421, 6452).
  - `delegation_events` grows about 6 MB an hour, roughly 150 MB a day. The journal (`delegation-events.log`) and the
    checkpoint grow beside it. Each of the 10 kept update backups holds a full copy of all three, so the backups carry
    about ten times the delegation data.
  - The rate is the design: the hook spools a PreToolUse and a PostToolUse line for every Bash call, and wave 3 keeps
    the whole journal (plan "Wave 3 performs no physical journal compaction").
  - Ruled: the soak runs as planned, and journal compaction goes first in wave 4's plan. If the server box's free disk
    falls below 15 GB during the soak, the operator decides again.
  - The centralised-update coordinator mails a daily read-only measurement, and its hourly probe flags a breach
    within the hour. Day 0, 16:15Z: 32 GB free; `coord.db` 146.8 MB; `delegation_events` 56.8 MB in 21,758 rows; the
    journal 42.4 MB; the checkpoint 4.8 MB; `~/ccrc-backups` 1,217 MB.
- **2026-10-18 — the darwin spool interleave (operator ruling "macOS cap, record losses").** `delegation-spool.test.ts`
  "lines near the cap do not interleave" red once on darwin (job 117716174716) with a 4,947-byte line, which is
  1,024 + 3,923.
  - The coordinator folded it into item 3 as an eleventh, flaky red, in a third wave-3 file. That is an extension of
    the macOS ruling's own shape, and run 600 was sent back for it whatever its review found.
  - The worker's diagnosis: bash writes a builtin `printf` through stdio. BSD and macOS libc (and musl) buffer stdout
    at 1,024 bytes, while glibc sizes the buffer from `st_blksize` (4096). So on darwin a long spool line is several
    writes, and a sibling hook's line can land between them.
  - Spec §5.3 refuses the external writer and the lock ("no locks, no waiting, no extra forks on the probe path").
  - Ruled by the operator: the cap is 4096 only where bash is built for glibc Linux and `OSTYPE` reads `linux-gnu*`,
    and 1008 everywhere else: 1008, not 1024, because a bash 4.4-5.1 built with bash malloc has a 1008-byte buffer.
    One value drives the jq's shedding and the shell's checks. This became D-5436.
  - The losses on the small cap are recorded in D-5436: listing room of about 15 to 20 names, so rung 4 is lost for a
    busy repository; and deep-path Workflow launches go unwritten. So are its residuals: a glibc bash built with bash
    malloc, an exported non-`linux-gnu` OSTYPE, and an `st_blksize` under 4096. `history -a` goes to wave 4's list as
    the lossless route.
- **2026-10-18 — review 610 (`ccrc-pwa-swift-river`, at `380ee56fa`).** The panel was complete: 5 confirmed findings,
  all minor, plus F6.
  - Every mutant reproduced, and the fan-out race reproduced: 486 refusals with `main`'s guard, 0 at the tip.
  - Ruled into fix round 1 (6496): F1 (the outlived-stamp residual in `noteSessions`' comment); F2 and F3 (the D-5434
    pin reads all six types and every line up to the append); F4 (R9 in the mutation table); and F6 (the spec's three
    stale `shared/api.ts` citations, inherited from `main`). F5, a commit message, is recorded only.
  - The spool fix rode the same round (6499).
  - Ruled on fix round 1's wave-done (6540), to wave 4's list: delegation-watch R111 (review 533's row). It was red
    once on darwin and 1 in 36 at CPUQuota=25% on Linux, and the follow-up does not touch it.
- **2026-10-18 — review 615 (`ccrc-pwa-clear-ridge`, at `410265acb`).** The panel was complete, found nothing in the
  code, and every mutant table reproduced exactly. 5 minor findings.
  - Ruled into fix round 2 (6553), docs and one test title only: commit lists; both tests of the cap in spec §5.3 and
    README; three more stale citations in the spec's facts table; and the darwin-only row verified. F5 (the full-disk
    sentence's home) needed no change.
- **2026-10-18 — review 617 (`ccrc-pwa-quiet-prairie`, at `7cb2ccda5`).** The panel was complete, with 3 minor
  findings. Ruled: no further round.
  - F1: more stale rows in the spec's facts table (:88-99), pre-existing on `main`. They go to a docs sweep on wave 4's
    list.
  - F2: a commit message. Recorded only.
  - F3: test titles and comments in `delegation-spool.test.ts`, and `shared/api.ts`'s bounds bullet, state the cap by
    half its condition. To wave 4's list.
- **2026-10-18 — #597 merged.** The pre-merge probe merged the head onto `main` `62db8d3b5`.
  - Green on that merge: oss-metadata, pools-prose, single-definition, deviation-refs, hibernate-census,
    delegation-watch and delegation-wave3.integration, and server `tsc`. typecheck-tests was not run there, for want of
    `ui` modules; #597 touches no PWA or UI code.
  - `gh pr merge 597 --squash --admin --match-head-commit 7cb2ccda5…` merged it at 22:04:47Z as `c1453e422`. The
    prerelease `v0.0.299` carries it.
  - Run 600 closed `final:true`, `done`, `released:true`, with its child reclaim queued.
  - The block: D-5433..D-5436 are defined in the plan. D-5437 and D-5438 are unused.
  - Its last full run (39156998467) is red only on ccd-docs-tree "row 64" on its latest attempt, a main-red (main's
    daily 39093762060). ccd-docs-index was red on attempt 1 and passed on re-run. `main`'s macOS reds and the flaky
    R111 can still fail a stable promotion's `full-suite`.

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
- **Wave 4 owns the absent-owner spool prune** (operator ruling 2026-10-14, decisions above). Until it lands, a
  removed owner's spool directory keeps its last 24–25 hourly buckets. Wave 4's plan must prune a directory only when
  its owner's registry row is gone and its newest bucket is more than 24 hours old. Neither the hook nor the server
  deletes it.
- **What wave 2 (run 306, reviews 318, 324, 328 and 332) hands to wave 3's plan.** Its evidence is in the
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
  - An activity id is selected once, at open; a checkpointed id is restored, never re-hashed after pruning. Whichever
    wave builds the journal's checkpoint, pruning and reconstruction keeps each selected id in the checkpointed
    applied state, restores it verbatim, and derives one only for an activity the checkpoint does not hold. Wave 3
    physically prunes no journal record; its planning holds preserve checkpoint, lease, lineage and identity dependencies
    for the later separately approved compaction protocol (spec
    §5.2, §5.12 and §8.4's row; amendment `tool-agent-id-alone-is-unjoined-evidence`, review 328 F1).
  - All eight real-lane amendment slugs carry into wave 3: `agent-input-keys-are-the-callers`,
    `post-turn-subagentstop-is-unpaired`, `real-payloads-carry-scratchpad-dir`,
    `toolsearch-may-precede-a-workflow-call`, `parent-stop-does-not-bound-workflow-start`,
    `workflow-phase-is-not-always-written`, `teardown-hook-event-names-another-session` and
    `tool-agent-id-alone-is-unjoined-evidence`.

### Review-332 implementation questions answered by the approved wave-3 plan

These five points originated as implementation questions in review 332 F3; they were not requirements of the approved
spec and this ledger does not rewrite them into retroactive requirements. The operator approved the wave-3 plan on
2026-10-09, approving the following exact answers for wave 3. A later change requires an operator ruling; rejection of
one blocks its owning durability task rather than licensing a weaker fallback.

1. **ID escape (O1).** A meta-opened activity id cannot be returned, inserted into `coord.db`, logged as an outcome or
   included in a report until an atomic checkpoint contains its natural-key mapping and activity row.
2. **Pruning during reconstruction (O2).** Pruning is disabled from reconstruction entry through checkpoint
   validation, all retained evidence applicable to a checkpoint-missing activity, retained-suffix replay, natural-key
   restoration and restoration of every pruning hold. A failure leaves state `reconstructing` and pruning disabled.
3. **Checkpoint and backup (O3).** The authoritative sidecars are `~/.ccrc/delegation-events.log` and
   `~/.ccrc/delegation-checkpoint.json`; every coordination backup/update snapshot and fallback server-deploy snapshot
   includes them, the existing consistent `coord.db` snapshot when present and commit marker
   `coordination-snapshot.json`. Restore fails closed unless the manifest, pair, pre-anchor evidence and retained suffix
   agree; its anchor is `(sequence, journalId, digest)`, because the journal also carries non-hook lease records.
   Ordinary tree rollback never restores the authoritative sidecars.
4. **Immutable mapping (O4).** The checkpoint persists `(parent id, parent incarnation, source kind, upstream id)` to
   the selected activity id. The hash input names the accepted retained naming record’s `journalId`, not its raw envelope
   `eventId`. Recovery restores that exact id and never hashes a later event because the selected event was pruned.
5. **Durable application (O5).** Apply in order: append one complete journal record; fsync the journal; build next
   state; write and fsync a checkpoint temp in the same directory; atomic rename; fsync the parent directory; only
   then repair/commit `coord.db`. A positive meta has no journal event and becomes durable through the same checkpoint
   replacement. SQLite commit alone is not durable application.

**Retained-before-checkpoint reconstruction trap (review 334 observation).** If event E1 at journal sequence 10 is
still retained, the checkpoint position is sequence 20, and the corresponding activity is absent from the checkpoint,
E1 remains eligible to be the selected identity event. Recovery therefore inspects all retained evidence applicable
to a checkpoint-missing activity, including evidence before `appliedJournalSequence`; “retained journal” never means
only the suffix after the checkpoint.

### Focused wave-3 plan review folded before operator approval

One focused independent Opus plan review completed against the tracked wave-3 plan. It reported 0 critical, 16
important and 0 minor findings; it ran no tests. All 16 findings survived source/spec verification and are folded into
the plan rather than deferred:

- Journal identity is nonrecursive: RFC 8785 canonical JSON fixes `journalId` from the record without `journalId` or
  `digest`, then fixes `digest` from the record including `journalId` but excluding `digest`. Fixed vectors own both.
- Activity identity uses the accepted naming record’s `journalId`. Every spool line binds the parent incarnation read at
  write time, and the server derives event identity from owner, incarnation, UTC bucket, byte offsets and raw-line hash.
- The spool is a closed lifecycle union covering compact `SessionStart.source`, `SessionEnd.reason`, normalized Agent and
  Workflow launches, and normalized terminal task notifications. It excludes arbitrary response data, prompt/result/
  diagnostics, Agent `outputFile` and `scratchpad_dir`; approved Workflow `transcriptDir` and `scriptPath` remain closed fields.
- Existing `readFrom` is widened additively with bounded `maxBytes` and canonical `dataB64`; old decoded-only peers are
  unmeasured for spool ingestion. Activity sources (`agent|workflow|bash-worktree`) remain distinct from carrier
  provenance (`agent|workflow|raw|attached`).
- Pure policy returns only measured lease-identity input. The serialized journal adapter deduplicates, then owns
  `randomUUID()`, deterministic lineage identity, generation-0 append with replay-stable observation/opening time,
  checkpoint and projection. Rung-1 run-child agreement is a distinct `run-child-owned` report and can never create a lease.
- Lease identity uniqueness applies only while unreleased; the exact tuple is reusable after release. Rows preserve both
  creating and current journal sequence. Attempts may have a null path unless linked. Projection replacement uses an
  explicit foreign-key-safe delete/insert order and rolls back atomically.
- Observation health and explicit coordinator intent are checkpoint-owned and survive SQLite deletion/reprojection;
  direct SQLite writes are never their authority. Per-session/per-incarnation UTC-hour intervals are retained for at least
  seven complete days. A dedicated `delegation-hooks` doctor task owns every-home hook and spool-directory readiness,
  role-aware SKIP, foreign Worktree-hook warning and remedies.
- The repaired recapture path is actually run against current lane versions before parser implementation. Wave 3 plans
  retention holds but performs no physical journal compaction; a later approved plan must supply the crash-safe rewrite
  protocol before truncation can exist.

These are plan refinements and proposed implementation decisions under the approved design; they do not retroactively
change the spec or convert O1–O5 into prior requirements.

## Next-wave brief

**Wave 3 merged on 2026-10-18.** #448 landed at 03:04:32Z as `46c50a9a4`, after reviews 518, 533, 544, 556, 563, 578
and 583 (decisions above). Run 360 closed `done`, and the prerelease `v0.0.258` carries the wave.

**Its pre-soak follow-up merged the same day.** #597 landed at 22:04:47Z as `c1453e422`, after reviews 610, 615 and
617 (decisions above). Run 600 closed `done`, and the prerelease `v0.0.299` carries it.

**Wave 4 — project** inputs:
- Run 584 is open, `wave:4`, state `planned`, with no session. Its plan is not written.
- The operator's wave-4 list, collected from wave 3's rulings and reviews:
  - rung 4: how soak-era and later rung-4 links are treated, ruled before wave 4 displays anything (2026-10-16), with
    the four identification gaps beside it, and Q-W4, attributing main checkouts without the symlinked spelling;
  - journal compaction, first in wave 4's plan (operator ruling 2026-10-18, "Soak, watch disk"), with the
    checkpoint-size bound that rides it;
  - mark liveness: what clears each lane mark, and counting mark-forced unmeasured links apart;
  - W1's never-listed part: list the spool root;
  - `prune_backups`' full keep sets (D-4663; D-5144 only blocks KEEP=0);
  - the conditional late-return arm that review 544 left for the operator to place;
  - the hook's silent whole-event drops (D-4662);
  - `session-hook-turnmark`'s concurrent-rotators red: likely D-5434's lost update, which D-5434's guard should close,
    but never reproduced separately; and the same two-read guard shape in `_hook_spool_append` and
    `_hook_history_scope` (D-5434);
  - a doctor WARN when `BASH_MAX_TIMEOUT_MS` or `BASH_DEFAULT_TIMEOUT_MS` is set;
  - hook presence as a measured input (a home with no hook reads measured-empty), with incarnation-absent owners
    beside it;
  - the absent-owner spool prune (operator ruling 2026-10-14);
  - the installer's `JQ_UNMANAGED` fix (operator ruling 2026-10-15), and registering `PostToolUseFailure`;
  - B-F3: the X2 and X4 lane rows carry no count assertion;
  - listing shed for large repositories: on the 4096 cap, this repository's 124 linked names (about 2,082 B) do not
    shed today, and roughly 155 to 200 names would; the live shed rate is unmeasured;
  - lease release for a reused raw worktree path, which stays conflicting until release exists (release itself is
    wave 5's);
  - an agent-side realpath resolver for the projects root, which a remote-mode server cannot resolve;
  - from review 578 (F4 itself is fixed by D-5433): R111's fixed 20 ms real-time wait, which reds under load (once
    on darwin, and 1 in 36 at CPUQuota=25% on Linux); `ccd/session-hook.sh`'s stale "exits in its arm" comments
    for a compact SessionStart; and a development `coord.db` at `user_version` 21, from an earlier branch build,
    meeting the renumbered migration (no known box);
  - from the M6 absorb's check: #575's hookstate carry keys on `$paid` (any `agent_id`), while wave 3's turn marker
    keys on the join, so an unjoined `agent_id` keeps a stored `done` while the marker reads `working`;
  - from review 583: the stale `COORDINATOR_INTENT_REFUSALS` docstring;
  - from the follow-up (run 600):
    - a swap or `restarting` row in the breaker, dropped from the F4 ruling;
    - `history -a` as the spool's lossless route on the small cap, unmeasured on darwin (D-5436);
    - the small cap's losses off glibc Linux (darwin, musl): about 15 to 20 listing names, beside the listing-shed
      item above (D-5436);
    - the spec facts table's other stale rows (review 617 F1);
    - the cap's half-stated condition in `delegation-spool.test.ts`'s titles and comments and in `shared/api.ts`'s
      bounds bullet (review 617 F3).

Rollout and the seven-day soak are the operator's acts, by the plan's "Rollout and Verification" steps 1–9. They run
on `v0.0.299` or later, which carries #597, under the disk watch the decisions above record. `v0.0.299` is a
prerelease, so the rollout is `ccrc rollout --to v0.0.299` unless it is promoted to stable first.

**Review 334 accepted wave 2 at its exact tip; wave 2 merged on 2026-10-13** (the decisions above record how). Reviewer `ccrc-pwa-keen-summit` accepted
`e183237e59f481ac85730bc06ca5cef29dea1d15` in immutable report
`.superpowers/sdd/delegation-broker-programme/review-334-e183237e.md`: 36 panel agents, 0 errors, 0 empty, 0 skipped,
2 confirmed minor findings, 9 refuted and 0 unexamined. Review 332 F1 and F3 are closed. F1 is only an immutable
commit-message overstatement; the tree already matches the ruling, so there is no tree change and no history rewrite.
F2 is the two “for that id” ledger corrections above. The reviewer measured handoff 874/874, isolated
`session-hook.test.ts` 335/335, docs-sensitive subset 492/492, `git diff --check origin/HEAD...HEAD` rc 0 and
exact-head CI run 37688188835 success; the full-suite red remains explicitly unwaived.

**Wave 3 — observe (report-only)** is approved at
`docs/superpowers/plans/2026-10-08-delegation-broker-wave3-observe.md` (operator approval 2026-10-09):
- Its contents are the exact-pane correction as the first implementation commit; the separate turn-marker correction;
  the re-capture tooling obligations followed by a mandatory current-lane capture; bounded incarnation-bound owner
  spools; byte-exact ingestion/cursors through a named pure/framing plus serialized-durability boundary; one six-table
  `delegation_*` migration; canonical journal/checkpoint/backup/recovery; the existing census extension; exact-evidence
  correlation; report-only reconciliation; checkpoint-owned health and coordinator intent; `delegation-hooks` doctor;
  and coordinator clause 17.
- It carries the 3.9 KiB listing/strict-under-4-KiB line constraint, all eight real-lane amendment slugs, D-4008's
  folds as no positive evidence, the retained-before-checkpoint trap, and O1–O5 above as operator-approved wave-3
  implementation decisions that remain nonretroactive to the spec.
- Its one migration creates the complete future-facing six-table schema required by spec §5.2, including inert lease
  disposition, clock, cleanup-population/evidence and carrier-generation fields; later waves add code only. Wave 3's
  serialized server journal adapter alone mints a deduplicated linked lease identity at generation 0; pure policy has no
  UUID authority, rung-1 run-child agreement remains under existing ownership, and closed policy prevents carrier writes,
  transitions, clocks, audit tokens, cleanup admission or executable effects.
- It retains the complete journal in wave 3. Physical compaction is explicitly deferred until a later approved plan
  specifies serialized temp rewrite, durability, rename, append-FD reopening and fault injection.
- It defines named red tests for every wave-3-applicable spec §8.4 mutation and every verified plan-review correction,
  and explicitly defers fleet/PWA
  projection, adoption, carrier, promotion, audit-token and cleanup behavior to waves 4–7.
- At the approval boundary it had allocated no deviation number, opened no run, dispatched no worker, merged no PR,
  deployed nothing and invoked no cleanup. The operator reviewed and approved that tracked plan before the transition
  acts recorded next.
- The allocator issued the contiguous 32-number wave-3 block on 2026-10-09: 4633, 4634, 4635, 4636, 4637, 4638,
  4639, 4640, 4641, 4642, 4643, 4644, 4645, 4646, 4647, 4648, 4649, 4650, 4651, 4652, 4653, 4654, 4655,
  4656, 4657, 4658, 4659, 4660, 4661, 4662, 4663 and 4664. They remain bare until the worker defines an actual
  departure; unused numbers are recorded as unused.
- Run 360 opened on 2026-10-09 as `wave:3`, `waveOf:7`, state `planned`, with no inherited worker `sessionId`, while
  run 306 remained open. Run 306 then advanced from `awaiting-review` to `merging` on the independently accepted
  fingerprint: branch tip and handoff commit both `e183237e59f481ac85730bc06ca5cef29dea1d15`, PR #321 open.
- The immediate pre-landing read found that exact PR head unchanged and all four required contexts green (`build-pwa`,
  `test (agent)`, `test (pwa)`, `test (server)`). The first exact-head `gh pr merge` attempt changed nothing because
  this installed gh requires an explicit method outside interactive mode. A fresh rules read then found no
  `merge_queue` rule on `main`, and GitHub reported `REVIEW_REQUIRED`, so no guessed method and no forbidden
  `--admin` or `--squash` bypass followed. Run 306 stayed at `merging` until fix round 5 and the operator's
  2026-10-13 admin-merge instruction, recorded in the decisions above.
- Done on 2026-10-13: #321 landed as `4967dc495` and run 306 closed `final:true`. This plan and the programme ledger
  had already reached `main` in #340 (`081636389`), and the plan is unchanged there since. Run 360's fresh worker
  dispatches from merged `main` and must never depend on a coordinator worktree for its plan.
- Done on 2026-10-14: run 360 dispatched (decisions above).

### Run 360 dispatch package — dispatched 2026-10-14

This package is the durable handoff for the fresh wave-3 worker. It was written as preparation only, while run 360
was `planned`, with no worker and no items. Dispatch was forbidden until #321 merged, run 306 closed `final:true`, the
plan/ledger PR merged, and the claim preflight below was remeasured and settled. The first three were met by
2026-10-13: #321 merged as `4967dc495`, run 306 closed `done`, and the plan is on `main` at `081636389`, which is
the `[PLAN_COMMIT]` the brief names. Dispatch then waited for the claim preflight and a free concurrency slot.

**Dispatched 2026-10-14 at 00:25:04Z** with this brief, the route and all 16 items, once every overlapping claim's
holder had consented (decisions above). The claim snapshots below are history.

- **Plan and base.** Execute all 16 tasks in
  `docs/superpowers/plans/2026-10-08-delegation-broker-wave3-observe.md` from the merged `main` commit that contains
  this approved plan. The dispatch brief must replace this descriptive base with that immutable merged commit before
  it is sent; no worker may read the coordinator's branch or worktree.
- **Execution and branch discipline.** Use `superpowers:subagent-driven-development` task by task. Commit on the
  workspace's own branch, never a separate feature branch. Implementers run Sonnet at `high`; each task gets an
  Opus `high` reviewer; scouts use Haiku. Dynamic workflows stay off.
- **Route, atomically with dispatch.** `{"class":"opus","effort":"xhigh","subagent":"sonnet","workflow":"off","compact":"40"}`.
  The main loop stays Opus `xhigh` because the preceding work required multiple fix rounds for missed guards; there
  is no evidence for demotion. The five route fields do not encode the reviewer/scout split, so the brief states it.
- **Deviation block.** Numbers 4633 through 4664 were issued for wave 3. Define actual departures in numerical order,
  in the commit that first cites each one, and record every unused number as unused. Do not allocate another block.
- **Authority boundary.** This wave observes and reports only. It may ingest bounded evidence, correlate only exact
  evidence, append immutable evidence and linked lease identity, record unresolved/unowned work and measured absence,
  repair the disposable synchronous SQLite projection, and report observation health. It may not invent parentage;
  dispatch, adopt, retain, resolve, or promote generic work; write a carrier; start a lease clock; mint audit or cleanup
  tokens; nominate or execute cleanup; weaken admission; or emit a PWA `delegation` frame. Future-facing columns land
  inertly. Wave 3 performs no physical journal compaction.
- **Durability decisions.** O1–O5 above bind this wave: no activity ID escapes before its checkpoint row and mapping
  are durable; pruning remains disabled throughout reconstruction and after reconstruction failure; the authoritative
  files are `~/.ccrc/delegation-events.log` and `~/.ccrc/delegation-checkpoint.json`, with
  `coordination-snapshot.json` committing a consistent snapshot; the accepted naming record's `journalId` fixes the
  natural-key mapping; and durable order is journal append, journal fsync, next-state construction, checkpoint temp
  write, temp fsync, atomic rename, parent-directory fsync, then SQLite projection. These are approved wave-3
  implementation answers, not retroactive spec requirements.
- **Evidence traps carried literally.** Recovery must inspect retained evidence applicable to a checkpoint-missing
  activity even when it predates `appliedJournalSequence`. D-4008's failed lock stat, unreadable first log, and
  unreadable `gitdir` are never positive adoption or cleanup evidence. Carry all eight amendment slugs:
  `agent-input-keys-are-the-callers`, `post-turn-subagentstop-is-unpaired`,
  `real-payloads-carry-scratchpad-dir`, `toolsearch-may-precede-a-workflow-call`,
  `parent-stop-does-not-bound-workflow-start`, `workflow-phase-is-not-always-written`,
  `teardown-hook-event-names-another-session`, and `tool-agent-id-alone-is-unjoined-evidence`.
- **Order that cannot move.** Task 1 is the red-first exact-pane ownership correction and its sole first implementation
  commit is `fix(hooks): resolve ownership from the exact pane`. Task 2 is the separate raw-`agent_id` turn-marker
  correction. Task 3 repairs all three D-3999 recapture defects before `--missing` can establish coverage. Task 6 then
  measures the current supported Claude lanes and captures every missing version before parser/correlation logic is
  implemented; never infer the live lane set from the dated plan.
- **Rollout handoff, not worker authority.** Implementation itself does not deploy. After independent review, merge,
  and release, rollout is fleet/agent first, then server, then skills/doctor verification across rostered homes;
  validate journal/checkpoint recovery and coordination snapshots before the seven-day observation clock starts. No
  hand rollout, stable promotion, marker mutation, cleanup, or PWA behavior belongs to the worker.

**Claim snapshot, re-measured 2026-10-13 01:57 UTC against every task's Files block (full paths and bare file
names).** Superseded: by dispatch, claim 1204 had ended and every remaining overlap was consented (decisions above).
Ten claims were live. Three overlapped wave 3, and none had been consented for run 360 at that time:

- Claim 1204, run 398 (`ccrc-pwa-calm-delta`), holds `ccd/ccrc-doctor-checks`, `server/test/ccrc-doctor.test.ts`
  and `README.md`, overlapping Tasks 14 and 16.
- Claim 1211, run 354 (`ccrc-pwa-brisk-meadow`), holds `deploy/deploy.sh`, `CLAUDE.md`,
  `server/test/session-hook.test.ts` and `server/test/ccrc-api-closed.test.ts`, overlapping Tasks 1, 2, 5, 8 and 15.
- Claim 1213, run 354, holds `ccd/ccrc`, `agent/test/deploy-verify.test.ts` and
  `server/test/install-session-hooks.test.ts`, overlapping Tasks 5 and 8.
- Claims 1205, 1208, 1209, 1210, 1212, 1214 and 1215 have no path in the wave-3 file map.
- Claim 1197 (run 358) was live at 01:51 UTC, on `ccd/ccd`, `server/src/coord/schema.ts`,
  `server/src/coord/store.ts`, `server/src/watch.ts` and `server/test/coord-db.test.ts` (Tasks 5, 7, 10 and 13). It
  ended before 01:57. Run 358's PR #351 still adds the next `coord.db` migration slot, so Task 7 must re-count
  `MIGRATIONS.length` on `origin/main` before implementation, before the PR and before merge.

The 2026-10-09 snapshot below is kept as history. It is superseded.

**Claim snapshot, measured 2026-10-09 immediately before this package was written.** It is evidence of current
contention, not consent and not authorization for a later dispatch. The coordinator must re-read all active claims
immediately before dispatch and obtain explicit region consent or wait for every remaining overlap:

- Claim 1126, run 347 (`ccrc-pwa-clear-summit`), holds `ccd/session-hook.sh`, directly overlapping Tasks 1, 2 and 5.
- Claim 1125, run 347, holds `ccd/ccd` and `shared/api.ts`, directly overlapping Tasks 4, 5, 7 and 13.
- Claim 1124, run 342 (`ccrc-pwa-plain-prairie`), holds `server/src/server.ts`, `server/src/auth/gate.ts`,
  `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts` and
  `server/test/single-definition.test.ts`, directly overlapping Tasks 4, 13 and 15.
- Claim 1129, run 350 (`ccrc-pwa-brisk-basin`), holds `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `deploy/deploy.sh`,
  `README.md`, `CLAUDE.md`, `server/test/ccrc-update.test.ts`, `server/test/install-census.test.ts`,
  `server/test/ccrc-doctor.test.ts` and `server/test/install-coordinator-skill.test.ts`, directly overlapping Tasks
  8, 14, 15 and 16.
- Claims 1123 and 1127 were also live but had no direct path overlap with the approved wave-3 file map. No overlap
  above has been consented for run 360. Expiry timestamps are deliberately not a settlement; remeasurement governs.

**Wave-specific dispatch brief.** Send this prose only after substituting the immutable merged plan commit and the
fresh claim result where bracketed; send it in the same `/dispatch` request as the route and all 16 item titles:

> Execute delegation-broker wave 3 of 7, Observe (report-only), from
> `docs/superpowers/plans/2026-10-08-delegation-broker-wave3-observe.md` at merged commit `[PLAN_COMMIT]`, Tasks 1–16
> in order. Use `superpowers:subagent-driven-development` task by task. Commit on this workspace's own branch, never a
> separate feature branch. Route: Opus `xhigh` main loop, Sonnet `high` implementers, Opus `high` per-task reviewers,
> Haiku scouts, workflows off, compact 40. The issued deviation block is 4633–4664: define departures in order and
> record every unused number as unused. `[CLAIM_SETTLEMENT]`
>
> Keep the wave report-only. Hooks are evidence, never authority. Do not invent a parent; create or attach a run;
> adopt, retain, resolve, promote, or dispatch generic work; write a carrier; activate a lease clock; mint an audit or
> cleanup token; nominate or execute cleanup; weaken admission; emit a PWA `delegation` frame; or physically compact
> the journal. O1–O5 bind implementation exactly: IDs do not escape before checkpoint durability; pruning remains
> disabled through reconstruction and after failure; the journal/checkpoint pair plus `coordination-snapshot.json`
> are authoritative; the accepted naming record's `journalId` fixes immutable activity identity; and application is
> journal append → journal fsync → next state → checkpoint temp write → temp fsync → atomic rename → parent-directory
> fsync → SQLite projection. Retained evidence before the checkpoint position still participates when the checkpoint
> lacks its activity. D-4008's three unreadable/failed folds are never positive evidence.
>
> Carry the amendment slugs `agent-input-keys-are-the-callers`, `post-turn-subagentstop-is-unpaired`,
> `real-payloads-carry-scratchpad-dir`, `toolsearch-may-precede-a-workflow-call`,
> `parent-stop-does-not-bound-workflow-start`, `workflow-phase-is-not-always-written`,
> `teardown-hook-event-names-another-session`, and `tool-agent-id-alone-is-unjoined-evidence`. First, write the exact
> red tests and make the exact-pane lookup correction alone as `fix(hooks): resolve ownership from the exact pane`.
> Make the raw-`agent_id` turn-classifier correction a separate second commit. Repair all three D-3999 recapture defects
> before relying on `--missing`; then remeasure the currently supported Claude lane versions and capture every missing
> version before parser or correlation implementation. Do not infer current versions from the plan date.
>
> Work red-first and mutation-check every named W3-M guard. Keep `DatabaseSync` synchronous and the wire additive at
> protocol 1. Implementation does not deploy. After independent review, merge and release, the handoff rollout is
> fleet/agent first, then server, then skills and `delegation-hooks` doctor verification across every rostered home;
> recovery and snapshot validation precede the seven-day health window. Report every red honestly and send one
> `wave-done` only after the plan's complete
> foreground verification.

**Initial dispatch items.** These are created atomically by `/api/runs/360/dispatch`; do not pre-create or settle them
through `/api/runs/360/items`:

1. Exact-pane hook ownership — mandatory first implementation commit
2. Bare `agent_id` main-turn classification — separate second commit
3. Close D-3999 recapture obligations before using `--missing`
4. Shared vocabulary and additive measured IO
5. Fleet spool writer and hook registration
6. Recapture the current supported Claude lanes
7. One six-table migration and synchronous projection
8. Journal, checkpoint, recovery, retention, backup, and restore
9. Per-bucket ingestion with honest gaps
10. Extend the existing worktree census without narrowing failures
11. Pure join qualification and correlation ladder
12. Pure report-only reconciliation and circuit breaker
13. Watcher sibling lane and seven-day health
14. Doctor ownership and remedies
15. Coordinator intent route, exact CLI syntax, and clause 17
16. Integrated compatibility, recovery, scope, and rollout gate
