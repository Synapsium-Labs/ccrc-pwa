# PR4 (hook and ccd hygiene): notes for the ledger

Per-task note for `docs/superpowers/plans/2026-10-26-delegation-broker-wave4-project.md`, "## PR4". The coordinator folds these
into "## Deviations found" in the wave's ledger pull request.

## Deviations found

- **D-7017** — `w4-s2-isolates-the-name-test` (PR4 Task 4.4): row W4-S2 runs two arms, not one. The plan's arm (newest bucket 23 h
  old by name and by mtime) is kept by the mtime test as well as the name test, so mutant W4-SM2 (delete the name test) could not red
  it. A second arm plants the 23 h bucket with a 48 h old mtime, so the name test alone keeps it; W4-SM2 reds that arm, as the plan's
  mutation table predicts.
- **D-7018** — `scope-guard-pin-edited-in-place` (PR4 Task 4.1): `server/test/session-hook.test.ts` is not only appended to. Its
  existing row "the block sits after the card's call and before PostCompact's, and its gate forks nothing" pins the scope marker's
  guard line by its exact text (`[[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]] || return 0`), which Task 4.1 replaces, so the
  first whole-file run after Task 4.1 was red there. The one literal is edited in place to the positive form, on the same two
  lines, so no line of the file moves and the citation census that cites it by line is unaffected. The plan's Files list named
  the file "appended at the end only" and did not list this pin.
