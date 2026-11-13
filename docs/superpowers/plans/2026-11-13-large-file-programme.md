# The large-file programme: the design for approval

- **D-8615 (2026-11-13)** — `large-file-programme`: the design for refactoring every non-test source file over 3,000
  lines, one file at a time, by DDD, Clean Architecture and SOLID. The design is
  `docs/superpowers/specs/2026-11-13-large-file-programme-design.md`, and it is for the operator's approval. Each file
  starts with a characterization pin, is moved in pure-move slices, and freezes its growth at 10 lines per PR during the
  refactor. When a file is done, it ends at one context and one ring per module, and it takes an absolute cap that may
  only fall.

## What this is

This is the design only. No code changes, and no task is dispatched until the operator answers the spec's §5.

- The `ccd/ccd` split keeps its own plan, `docs/superpowers/plans/2026-11-06-ccd-file-split.md` (D-8048), and runs first
  once its Task 0 passes.
- Every other file gets a plan of its own when it reaches the front of the spec's §4 order.

## Deviations found

- **`ccd/ccrc-doctor-checks` and `ccd/session-hook.sh`.** The ccd split plan's Phase D names both as "Not in this plan".
  The design places them after Phase D and its Q7 ruling, because both depend on how the split libraries load.
- **The size ceiling is measured in code lines, not file lines.** The ccd plan bounds a library at 6,000 file lines. The
  design measures in code lines (2,500, Q1) instead, because that is the unit the growth check already measures. With
  this repository's comment density, the two bounds land in the same range.
- **Line citations.** The design cites `file:line` at `218a5e3a3`, as its brief asked. CLAUDE.md prefers anchors in code,
  but `citations.test.ts` excludes `docs/`, so these citations are snapshots and are marked as such.
