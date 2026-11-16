# W5 Task C5h: notes while building (D-7077; ARCH-67)

Task C5h, built from its design note `2026-10-27-w5-c5h-design.md` (#1685). The design note is not edited (the ledger guard). This note defines the four departures the build found that the design note does not name. The coordinator issued D-7235 to D-7238 for them, and each is defined here, in the same act as its use in the pull request body.

## Deviations found

- **D-7235** — `c5h-step0-on-unpushed-build` (Task C5h; ARCH-67): Step 0 items 8 to 11 were measured on the build's own unpushed commits, and on scratch Linux copies of them, rather than on a throwaway prototype. Nothing was pushed before every gate was printed. G-1 was measured on the real commits, which the design note calls the stronger form (§5).
- **D-7236** — `c5h-corpus-row-scope` (Task C5h; ARCH-67): commit 1's corpus row covers the docs and cross rows of `fixtures/redact/profiles.json` plus the helper's own shapes. The docs-parity corpus stays held by docs-parity's own row, because it is a constant in that test file, which is append-only. Both run through the CLI from commit 7.
- **D-7237** — `c5h-rows-from-the-mutation-run` (Task C5h; ARCH-67): running the mutation table showed five mutants that the design note's rows could not reach in this implementation: a non-sticky failure, a missing close in the `finally` hidden by the atexit hook, a pipe error, the `self.spawn` route, and `failure_line`'s own cut order. Each gained a row in its commit (commit 7, or commit 1 for the cut row). The atexit and wall-time rows were strengthened (a stub that lingers; four 500 ms gaps).
- **D-7238** — `c5h-rd-read-refuses-empty` (Task C5h; ARCH-67): `_rd_read` also refuses an empty file, because a CLI or rules module with no bytes cannot redact.
