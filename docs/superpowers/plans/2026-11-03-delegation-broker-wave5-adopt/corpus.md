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
