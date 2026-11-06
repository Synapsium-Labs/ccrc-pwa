# Task 0, the corpus: the rig's fan-outs name their model, and the corpus for the fleet's lane versions

The corpus run, delegation broker wave 5, Task 0, on the coordinator's ruling of 2026-11-06 that took Task 0 out of PR7.
Three departures are defined in the plan's "Deviations found": D-8063 to D-8065, the whole block issued to this
run.

- **D-8063, the scenarios name their model.** Every scripted Agent or Task input names `"model": "haiku"`, and every
  workflow `agent(...)` call `model: 'haiku'`, with no effort. A row in `delegation-rig.test.ts` holds every scenario's
  fan-out to the real session hook.
- **D-8064, `interrupt-exit` is unmeasured through 2.1.319.** The five new cells join the ruled list with the reason the
  2.1.295 to 2.1.299 cells carry.
- **D-8065, the current lanes are the five re-read.** `CURRENT_LANES` is 2.1.311, 2.1.314, 2.1.316, 2.1.318 and 2.1.319.

## What was measured

- **The lane versions**, re-read on 2026-11-06 as the `version_to` of each lane's last update, that field alone: 2.1.311,
  2.1.314, 2.1.316, 2.1.318 and 2.1.319. The newest version in the corpus before this run was 2.1.299.
- **The trial, before the capture.** `agent-plain` and `wf-plain`, each run alone on 2.1.319 (`rig.sh run`), both built
  `measured`, with SubagentStart and SubagentStop among their events: the same event set as on 2.1.299. The trial's raw
  root was removed.
- **The capture.** `recapture.sh` with the five versions named: 70 fixtures, `matrix.json` rebuilt, and the corpus scan read
  267 files with no residue. Each version has 13 measured cells and one unmeasured cell, `interrupt-exit` (D-8064).
  `wf-iso-resume` misses its `r1-resumed` probe on each, as on all 14 versions before: that is an outcome, not an unmeasured
  cell. The raw root was removed after the capture's commit, and the rig README's leftover check printed nothing.
- **A typed `/compact` fires two SubagentStops from 2.1.311** (D-8065, amended). On each of the five new versions the
  compaction fires two SubagentStops between PreCompact and PostCompact, each with no agent type and an id no SubagentStart
  named; 2.1.280 to 2.1.299 fire one. `session-hook-compact-carry.test.ts`'s row admits one or more and pins the count by
  version range, and a row runs the real hook over 2.1.319's own payloads and holds that the second stop keeps the main
  state as the first does.

## Measured, not departures

- **The hook's compaction comment is stale.** The comment above `compactions-write-no-hookstate` (D-5239) in
  `ccd/session-hook.sh` still says a typed `/compact` fires "a SubagentStop". From 2.1.311 it fires two. Two readings,
  which the fixtures do not decide: (i) a manual compaction now runs two agents, a real lane change; (ii) newer builds
  retry the compaction against the mock, whose default reply is no summary, a rig artefact. The hook is out of this run's
  scope, so the comment stands; the coordinator carries it to the Rider.
