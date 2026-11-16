# PR4 (hook and ccd hygiene): notes for the ledger

Per-task note for `docs/superpowers/plans/2026-10-26-delegation-broker-wave4-project.md`, "## PR4". The coordinator folds these
into "## Deviations found" in the wave's ledger pull request.

## Deviations found

- **D-7017** — `w4-s2-isolates-the-name-test` (PR4 Task 4.4): row W4-S2 runs two arms, not one. The plan's arm (newest bucket 23 h
  old by name and by mtime) is kept by the mtime test as well as the name test, so mutant W4-SM2 (delete the name test) could not red
  it. A second arm plants the 23 h bucket with a 48 h old mtime, so the name test alone keeps it; W4-SM2 reds that arm, as the plan's
  mutation table predicts. **Correction (review 1365, F1):** W4-S4 had the same defect, and commit 81bd84300's "SM1..SM10 each
  killed" was untrue for SM4. S4's extras (a foreign file, a subdirectory, a link named like a bucket) were fresh, so the mtime test
  kept the directory whatever the entry test did: dropping the type test left all rows green, and dropping the whole entry line was
  red only through W4-S2's second arm. S4 now ages every extra to 48 h (a link by its own mtime, and its target). Measured in fix
  round 1, on the whole file with each mutant restored from a saved copy: SM1 to SM10 are each killed by the row the plan names
  (SM1 by S1, SM2 by S2, SM3 by S3, SM4 by S4 in both forms, type test dropped and any entry accepted, SM5 by S5, SM6 by S6 (a),
  SM7 by S8 and S9, SM8 by S10, SM9 by S6 (b), SM10 by S12).
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
## Fix round 1 (review 1365), recorded for the fold

No D-number: these are the coordinator's fix-round rulings, and D-7020 stays unused.
- Task 4.4: three prune guards had no row that noticed them, and one owner-directory state was not covered by the plan's rules.
  - W4-S13 (an empty owner directory is judged by its own mtime: kept at 1 h, removed at 48 h) is red when that mtime read is
    replaced by an empty reading. W4-S14 (`$REG/delegation` a link: nothing under its target is removed) is red when the
    `! -L "$REG/delegation"` test is dropped.
  - The `"$id" != "$self"` guard gets no row. It is near-equivalent, because the spawning id always has a registry row, so the row
    test already keeps its directory.
  - An owner directory the prune cannot read or search (a hand-made mode 000; ccd makes every owner directory 0700) globbed as
    empty, so it passed on its own mtime, was renamed to `.prune.<id>.<pid>`, failed `rmdir` and stayed stranded, retried at every
    spawn. `_dsp_old_absent` now refuses a directory it cannot read or search (`-r`/`-x`, on the line that already tested `-d`
    and `! -L`, so `ccd/ccd`'s net growth is unchanged). W4-S15 was red before that change and is red again when the test is
    dropped.
- `server/test/ccd-harness-integrity.test.ts` changed, though PR4's Files list does not name it (commit 04eeea2e6). The seam's
  BASH_ENV function `_w4_seam` is a `_x() {` a test writes, so the census of such functions (D-6051) lists it in
  `TEST_LOCAL_HELPERS` under `hookGuardSeam.ts`. Fast CI found it; the plan's suite list does not run that file.
