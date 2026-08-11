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

## Dogfood findings (live, wave 1)

- F1 — A FRESHLY SPAWNED WORKER CANNOT RECEIVE ITS FIRST BRIEF. The delivery gate
  requires hookstate evidence of a completed turn (hs === null -> skip, correctly
  fail-shut), but a virgin session has never spoken. The brief sat queued ~40min.
  Interim: the coordinator sent a kickoff prompt via the ordinary prompt route; the
  worker's first Stop wrote hookstate and the lane then delivered the brief verbatim.
  FIX CANDIDATE (wave 2 amendment or Build 5): session-hook.sh's SessionStart handler
  writes state=done — a just-started session is definitionally at an idle boundary.
- F3 — BUG #21 REPRODUCED LIVE ON THE MAIL PATH (typed-but-unsent self-block).
  After F1's nudge, the delivery lane typed the 2.8KB brief into the worker's box
  but the Enter did not land; the text sat as an unsent draft; the lane then read
  its OWN un-submitted injection as `draft-present` and refused to redeliver,
  backing off to 5 attempts / ~7min out. The draft guard doing its job (never type
  over a human mid-sentence) is what made the self-block sticky. Recovered by the
  operator via POST /api/sessions/:id/submit with the exact box-prefix as `expect`
  (the box-mismatch safety check itself worked — refused my first wrong guess).
  FIX: this is task #21; the mail delivery path needs the same submit-proof the
  interactive send path has, so a mail injection whose Enter is lost is retried as
  ITS OWN pending delivery rather than abandoned as someone else's draft.
- F4 — VISUAL NESTING GAP (operator-raised). Worker workspaces do not visually nest
  under their program on the fleet screen; the data exists (hold reason
  `program:<slug> wave:N/M`) but the fleet list groups flat by project. Proposed as
  a fast-follow — see task.
- F2 — THE DRAFT GUARD HELD UNDER RACE. The kickoff nudge and the brief delivery
  raced; the sweep answered draft-present twice, backed off, and delivered cleanly
  once the box emptied. The design behaved exactly as specified; recorded as a pass.

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
