# ARCH-41: the workspace lifecycle's refusal edges as one table: Plan note

ARCH-41 (#776, PR #1563) adds `WORKSPACE_TRANSITIONS` (`shared/workspaceTransitions.ts`), the workspace's sibling of
`RUN_TRANSITIONS`. `server/test/workspace-refusal-census.test.ts` counts 104 client-read refusal edges: archive 7,
restore 4, forget 6, reap 43, expire 19, reclaim 15 and collect 10. That is well past the spec's test of about ten
edges, so the table is kept. One number, D-6978, was issued, for how the counted exit is met.

**Spec:** `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md` (§2.5, C4).

## Deviations found

- **D-6978**: `workspace-transitions`. The counted exit says that refusal edges not answered from
  `WORKSPACE_TRANSITIONS` go to 0. This is met for every TS reader, but not for ccd. The archive door's 7 edges are
  read through `workspaceEdge`. The expiry, reclaim and collect lanes (`archivedExpiry.ts`, `coord/childReclaim.ts`,
  `collectLane.ts`) type their words as `WorkspaceRefusal<verb>`, with the two post-act rescue words
  (`WORKSPACE_POST_ACT_WORDS`) beside them, and narrow them through `isWorkspaceRefusal`. A word the table lacks
  therefore fails to compile there. A characterization commit pins each lane's answers first, so the move changes no
  behaviour. The 97 `ccd` edges are still enforced in bash, which cannot read a TS table. The census holds each verb's
  codes to ccd's own text: for expire, reclaim and collect through the lane sets, which are already pinned to ccd in
  both directions, and for restore, forget and reap through words harvested from their ccd refusal sites. The table and
  ccd cannot drift apart without a red test, but ccd does not answer from the table. `shared/lifecycle.ts`'s workspace
  rows do not yet name the table as their collector policy. That is left to K1.
