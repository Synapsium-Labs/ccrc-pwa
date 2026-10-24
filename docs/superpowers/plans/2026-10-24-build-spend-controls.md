# Build-spend controls

Operator ruling, 2026-10-24: fix all five gaps in how ccrc bounds the token spend of build and review work.

The fleet's 7-day transcript audit put Workflow-agent build and review work at about 42% of spend. Explicit polling came to about 7.5%.

A code audit of origin/main found the routing matrix, the ladder and the review panel in place, but mostly as guidance.
- The route is optional, so a dispatch without one runs at the lane default.
- Fix rounds and findings are unbounded.
- Each wave is reviewed twice.
- The fan-out rules are skill text only.
- No spend is attributed to a run.

## Deviations found

The ledger issued D-6794 to D-6799 for this work.

- **D-6794** — `route-default-per-run-kind`: if a dispatch carries no `route`, the server fills one from a single shared table keyed on the run kind. The `work` row uses the routing matrix's spec'd-worker row. The `review` row is a new matrix row for the review session's main loop: Sonnet high, workflows on for the panel only, compact 40. The server journals this as `route-defaulted`. A route the coordinator does pass is never overridden. The matrix and the table are pinned equal by a test.
- **D-6795** — `review-round-cap`: the store counts the review runs that name a work run. Opening a fourth review is refused with `cap-review-rounds`, which reaches the operator as a structured ask with the run, its rounds, and the last review's open findings. The operator can lift the cap per run. The cap is 3.
- **D-6796** — `findings-cap-and-minor-refuted-once`: each review lens returns at most its 8 most severe findings. The schema says `maxItems: 8`, and the lens prompt says to keep the most severe. Critical and important findings keep 3 Sonnet refuters each. A minor finding gets 1 refuter and is returned as advisory, so it never fails a wave alone.
- **D-6797** — `per-task-reviewer-on-sonnet`: the spec'd worker's per-task reviewer runs Sonnet high instead of Opus high, because the held-out panel is the gate. The judgement lenses of the held-out panel stay on Opus high.
- **D-6798** — `fan-out-routing-enforced`: the session hook's PreToolUse arm denies an Agent or Task call that names no `model`. It also denies a Workflow script whose `agent()` calls lack a `model` or an `effort`. The denial tells the agent to name them from the routing matrix. It is an accident guard and fails open, like the arm it sits in.
- **D-6799** — `per-run-token-attribution`: the usage sweep also groups its deduplicated usage by session id. The server joins sessions to runs through each run's bound sessions. GET /api/runs/:id reports the run's tokens and its proxy cost, and the run board shows them. This only measures; it is not a budget.
