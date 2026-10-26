# PR4 (hook and ccd hygiene): notes for the ledger

Per-task note for `docs/superpowers/plans/2026-10-26-delegation-broker-wave4-project.md`, "## PR4". The coordinator folds these
into "## Deviations found" in the wave's ledger pull request.

## Deviations found

- **D-7017** — `w4-s2-isolates-the-name-test` (PR4 Task 4.4): row W4-S2 runs two arms, not one. The plan's arm (newest bucket 23 h
  old by name and by mtime) is kept by the mtime test as well as the name test, so mutant W4-SM2 (delete the name test) could not red
  it. A second arm plants the 23 h bucket with a 48 h old mtime, so the name test alone keeps it; W4-SM2 reds that arm, as the plan's
  mutation table predicts.
