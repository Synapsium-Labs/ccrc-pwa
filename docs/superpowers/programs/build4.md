# Program: build4

Spec: docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md
Plan: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md
Workspace: ccrc-pwa-amber-harbor (spawned by wave-1 dispatch, 2026-08-11; run id 1)
Coordinator: claude-ccrc-pwa (Fable tier — first-ever coordinated program, contract under test;
tier re-evaluated at each wave boundary per the model-selection policy)

This is Build 7's ratified dogfood — the first program driven through the coordinator.
The plan's WAVE MAP is the binding dispatch order: four waves, sequential merges,
each cut from main after the previous merged.

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | Coordination: the writer (Tasks 1–5 — items on dispatch, dispatchRun tx, settleItems, POST /api/runs/:id/items, skill docs) | — | dispatched (run 1, worker ccrc-pwa-amber-harbor, brief 2793B queued) |
| 2 | Fleet Mutation + run-control substrate (Tasks 6–10 — coord-pause verb+grant, coord frame, abandon route) | — | pending |
| 3 | PWA: the console's hands (Tasks 11–14 — banner, abandon sheet, start-program sheet) | — | pending |
| 4 | Session Conversation: the transcript (Tasks 15–19 — envelope parser, mail ChatItem, ask card) | — | pending |

## Decisions & deviations

- The plan carries D-B4-1..D-B4-17 measured against main@40a41db; the plan-review's four
  blocking findings were fixed before the plan merged (d0c44df). Workers follow the plan's
  deviations, not the spec's original text, where they differ.
- Wave 2 is agent-first at rollout (ccd + whitelist before server), stated in its brief.
- Waves 3 and 4 are file-disjoint and could run in parallel; run sequentially unless the
  coordinator judges the calendar needs it (parallelism only across proven-disjoint workspaces).

## Carried constraints

- The wave-1 run's own tally reads `—` (no items exist until wave 1 ships the writer and a
  LATER dispatch names items) — expected, spec §3.4, not a defect for reviewers to file.
- shared/api.ts is touched by waves 1, 2 and 4 in three disjoint regions; RunsScreen.tsx by
  waves 1 and 3; coord/store.ts by waves 1 and 2. Sequential merging keeps the conflicts cheap;
  a conflict there is expected, not a finding.
- Suites run FOREGROUND with >=600000ms timeouts on a loaded box; ccd-ws-gc/pr-sweep/
  session-hook/typecheck-tests have known load flakes — isolate before concluding.

## Next-wave brief

Wave 1 brief is the plan's WAVE MAP "Wave 1 brief sketch", dispatched verbatim (minus this
ledger excerpt). On wave-done: re-measure, advance, review the handoff commit, open wave 2
BEFORE closing wave 1 (final:false).
