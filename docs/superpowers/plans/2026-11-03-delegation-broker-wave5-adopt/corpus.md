# Task 0, the corpus: the rig's fan-outs name their model, and the corpus for the versions the fleet runs

The corpus run, delegation broker wave 5, Task 0, on the coordinator's ruling of 2026-11-06 that took Task 0 out of PR7,
and its fix-round ruling on review 1591. Three departures are defined in the plan's "Deviations found": D-8063 to D-8065,
the whole block issued to this run, each amended in place in the fix round.

- **D-8063, the scenarios name their model.** Every scripted Agent or Task input names `"model": "haiku"`, and every
  workflow `agent(...)` call `model: 'haiku'`, with no effort. A row in `delegation-rig.test.ts` holds every scripted
  fan-out, from every place the mock answers a tool_use from, to the real session hook.
- **D-8064, `interrupt-exit` is unmeasured through 2.1.319.** The new cells join the ruled list (Task 6, R15) with the
  reason the 2.1.295 to 2.1.299 cells carry.
- **D-8065, the current lanes are what the fleet runs.** `CURRENT_LANES` is the union of two measurements, every version
  in it is captured, and the compaction rows hold for the two-stop compaction those versions fire.

## What was measured

- **The versions the fleet runs**, measured on 2026-11-06 two ways, aggregate versions only. The `version_to` of each
  lane's last update, that field alone: 2.1.311, 2.1.314, 2.1.316, 2.1.318 and 2.1.319. The live Claude Code sessions by
  process executable, just before the second capture: 2.1.312, 2.1.314, 2.1.316, 2.1.317, 2.1.318 and 2.1.319. The union
  is `CURRENT_LANES`: 2.1.311, 2.1.312, 2.1.314, 2.1.316, 2.1.317, 2.1.318 and 2.1.319. 2.1.311 stays in the corpus: a lane
  names it, and a session takes it on its next start. The newest version in the corpus before this run was 2.1.299.
- **The trial, before the first capture.** `agent-plain` and `wf-plain`, each run alone on 2.1.319 (`rig.sh run`), both
  built `measured`, with SubagentStart and SubagentStop among their events: the same event set as on 2.1.299. The trial's
  raw root was removed, so the trial is not in the tree.
- **The captures.** `recapture.sh` with the versions named, never `--missing`, each committed on its own: first 2.1.311,
  2.1.314, 2.1.316, 2.1.318 and 2.1.319 (70 fixtures), then 2.1.312 and 2.1.317 (28 fixtures). Each version has 13 measured
  cells and one unmeasured cell, `interrupt-exit` (D-8064). `wf-iso-resume` misses its `r1-resumed` probe on each, as on
  all 14 versions before: that is an outcome, not an unmeasured cell. Each raw root was removed after its capture's
  commit, and the rig README's leftover check printed nothing.
- **A typed `/compact` fires two SubagentStops from 2.1.311** (D-8065). On each of the seven new versions the compaction
  fires two SubagentStops between PreCompact and PostCompact, each with no agent type and an id no SubagentStart named;
  2.1.280 to 2.1.299 fire one. `session-hook-compact-carry.test.ts`'s row admits the compaction's own stops and pins the
  count by a closed version range, and a row replays every two-stop version's own payloads through the real hook, with
  `hook-main-state-v1` advertised and without it, and holds that the second stop keeps the main state as the first does.
  Its setups are an idle `done`, a mid-turn `working`, and a `done` whose Stop left a background agent (the delegated
  pair set), each from 2.1.319's own captures. The corpus holds no live ask and no subagent's own wait (no capture has an
  AskUserQuestion or a PermissionRequest), so neither is a setup there.

## Measured, not departures

None of these is a field the correlation, the spool or the watch reads.

- **The hook's compaction comment is stale.** In `ccd/session-hook.sh`, the comment that opens at
  `compactions-write-no-hookstate` (D-5239), above the `dispatch-live-gate-v1` line, says in its "Measured" sentence that a
  typed `/compact` fires PreCompact, "a SubagentStop" and PostCompact. From 2.1.311 it fires two. Two readings, which the
  fixtures do not decide: (i) a manual compaction now runs two agents, a real lane change; (ii) newer builds retry the
  compaction against the mock, whose default reply is no summary, a rig artefact. The hook is out of this run's scope, so
  the comment stands; the coordinator carries it to the Rider.
- **`interrupt-exit` lost its unnamed SubagentStop.** On 2.1.295 to 2.1.299 the capture ends `SubagentStart, Stop,
  SubagentStop, SessionEnd`, and that stop has no agent type, an id no SubagentStart named, and the running agent in its
  `background_tasks`. On every new version it ends `SubagentStart, Stop, SessionEnd`, with no SubagentStop. The cell is
  unmeasured either way (D-8064). It bears on the compaction question: the unnamed, typeless SubagentStop is not specific
  to compaction, since it also appeared at `/exit` on 2.1.295 to 2.1.299.
- **Two changes to the capture are confounded with the version.** (a) The scenarios name a model for the first time on
  the new versions, and no 2.1.299 capture names one, so `tool_input.model`, `resolvedModel` and the subagent meta's
  `model` change for that reason, and whether the meta keys `isBuiltIn` and `finished` came with the version or with the
  model naming cannot be told apart. (b) Every cell that makes a `.git/worktrees/<n>` admin directory gains a `refs`
  entry on the new versions, `raw-worktree` included, which is a plain `git worktree add` with no Claude Code agent: that
  points to the capture box's git, not to Claude Code. Not measured: the fixtures do not record the git version.
- **New interleavings, one capture each.** Each cell is one capture, so a race and a version change look the same. The
  count of each event kind matches 2.1.299 in every scenario except `interrupt-exit` and the compaction above. Orderings
  that no older version shows: `wf-iso` on 2.1.311, 2.1.316 and 2.1.318 (a SubagentStart before the main Stop),
  `wf-iso-resume` on 2.1.311, 2.1.316, 2.1.318 and 2.1.319, and `wf-limit-pause` on 2.1.316. The second capture's two
  versions are not in that review count. Orderings of the main Stop against a SubagentStart or a PostToolUse already
  differ between the older versions, so none of these says more than "the race can go this way".
