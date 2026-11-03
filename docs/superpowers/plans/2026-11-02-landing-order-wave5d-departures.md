# Landing order wave 5d: three departures from its plan, recorded

The plan itself defines D-7635 to D-7647. These three were reported by the worker at its first handoff and examined by
reviews 1327 and 1357.

- **D-7788 (2026-11-02)** — `mutation-evidence-temp-root` (Global Constraints): every saved copy, mutation script,
  row log and execution artifact sat under the worker's session temp root, not under `.superpowers/sdd/` in the
  worktree as the plan says. The coordinator's brief asked for that placement.
- **D-7789 (2026-11-02)** — `mutation-runner-vitest` (the mutation steps of Tasks 1 to 3): the execution skill's
  mutation runner, `mutation-run.py`, drives Python test callables only, so the rows ran through a bash runner around
  the plan's own `ccrc test` command instead.
- **D-7790 (2026-11-02)** — `wave-commits-beyond-plan` (Tasks 1 to 4): the plan names three task commits. The branch
  has eight: the three, two README rewraps that change no wording, and the three fix-round commits that reviews 1313
  and 1327 required.

**D-7788.** The repository's rule keeps scratch, scripts and long logs out of every work tree, in the temp root the
session started with. The plan's in-worktree path predates that rule, and the brief followed the rule. The evidence
itself is unchanged: each row edited once, run under the stated bounds and restored from a saved copy whose SHA-256
and mode were checked. The cost is that the evidence is not in the tree; reviews 1327 and 1357 say so, and treat the
row results as the worker's own measurements.

**D-7789.** The plan names the command, not the runner, and the command is what ran. The runner's discipline is what
the plan asks for: one edit per row, a bounded run, and a restore from a saved copy checked by hash and mode. Only the
tool around the command differs. Review 1327 ran two mutants of its own through
`ccrc test` with vitest's `-t` filter, and both went red.

**D-7790.** The two rewraps are `816b3ba88`, for Task 1's wrap requirement, and `36f9897d2`, for the final review's M7;
neither changes a word. The fix-round commits are `d57c93afc` and `40cfb6752` (round 1) and `307e47b85` (round 2).
Each commit is named here so the count is checkable against the branch.

The plan is not edited, because merged plans are append-only. This file is the record, and the programme ledger folds
it in.
