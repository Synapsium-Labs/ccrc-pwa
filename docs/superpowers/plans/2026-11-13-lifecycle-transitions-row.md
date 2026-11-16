# The child-workspaces row names its transitions table

- **D-8612 (2026-11-13)** — `lifecycle-transitions-row`: the lifecycle manifest's `child-workspaces` row names
  `WORKSPACE_TRANSITIONS` (`shared/workspaceTransitions.ts`), the table that holds the refusal edges of the verbs that
  collect it, as the consolidation spec's C4 asks ("the manifest's workspace row points at the table"). A filed
  follow-up of the closed architecture refactor; no change in behaviour.

## What changed

1. **The row names the table.** `shared/lifecycle.ts`'s `child-workspaces` row ends its `collector` with
   `their refusal edges: WORKSPACE_TRANSITIONS (shared/workspaceTransitions.ts)`. The manifest has no owner or table
   field; `collector` is where a row names who acts on the class, so the pointer sits there.
2. **The pin.** `server/test/lifecycle.test.ts` holds the row to that text, imports the real `WORKSPACE_TRANSITIONS` so
   a rename of the export reds the test, checks that the table has edges for both verbs the row's collector runs
   (`reclaim`, `expire`), and checks that `shared/lifecycle.ts` still imports nothing.

## Deviations found

- The table is named as text, not imported. `shared/lifecycle.ts` is L0 and imports nothing (its header, and
  `late-census.test.ts`'s check of the file); the `history-switches` row names `HEADLESS_LIST_MAX_BYTES` the same
  way. The test, which may import, ties the text to the export.
- The `archived-workspaces` row, also collected by `ws-expire`, is left as it is: C4 names one workspace row, and the
  task named `child-workspaces`.
