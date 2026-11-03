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
- **D-7019** — `main-landed-the-spool-guard-and-the-race-rows` (PR4 Tasks 4.1 and 4.2): after PR4 was cut, `main` landed #1883
  (D-7448: the spool append's gate probes absence first, `[[ ! -L "$f" && ( ! -e "$f" || -f "$f" ) ]] || return 1`, with a race row
  that pins that two-probe shape against a reversed control) and #1607 (the race rows tell an identity skip from a lost append,
  through `assertLanded`). The merge of `main` took main's side in both files, by the coordinator's ruling:
  - `_hook_spool_append` keeps main's gate line byte for byte. Task 4.1's positive-type form now stands only in
    `_hook_history_scope`, with its rows in `session-hook.test.ts`.
  - Dropped from `delegation-spool.test.ts`: W4-H1 (a bucket created between two of the guard's reads), covered by main's D-7448
    raced-first-write row; W4-H3 (the positive-form pin), which contradicts main's pin; and Task 4.2's reach probe (`reachProbe`,
    `fates`, `noMissing`, W4-H5a and W4-H5b), whose job main's `assertLanded` does: an honest skip is counted and replayed (main's
    slow-lookup rows), and a line taken out is a lost append (main's D-7450 control). The unused probe helpers left
    `hookGuardSeam.ts`.
  - W4-H2 (a bucket REMOVED between two of the guard's reads is still appended to) is dropped with no replacement, because main's
    gate does not hold it (read from the gate, not measured): a bucket present at `! -e` and gone at `-f` is refused. Main's row argues why that cannot happen to a
    current bucket: absent to regular is the only move a current-hour bucket makes, and the prune removes older hours only.
    That argument is now the only guard for this case, and no row measures it.
  - W4-H4 (a FIFO at the bucket's name is never opened) is kept. On the merged tree it is green; with main's gate mutated to admit
    a FIFO (`|| -p "$f"`), it goes red (the hook blocks opening the FIFO and is killed at its 10 s bound); restored from a saved
    copy.
