# `_child_tmpdir` on macOS — BSD `chmod` and an option after an operand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On macOS, a child gets its own `TMPDIR` exactly as it does on Linux. `_child_tmpdir` answers rc 0 for an ordinary child on both platforms. A regression to a GNU-only argument order reds on the LINUX legs, not only on the non-required macOS leg that let this one through.

**Architecture:** one token moves in `ccd/ccd`'s `_child_tmpdir`, in place, below the frozen citation boundary. Two new test groups: one runs the real function under a BSD-order `chmod`, the other is a literal-absence census of the shape. No server, wire or capability change.

**Tech Stack:** bash (`ccd/ccd`), vitest (`server/test`).

**Programme:** `child-tmpdir-bsd`, a one-wave follow-up to `child-reclamation` (CCR-15), coordinated by `ccrc-pwa-calm-mesa`. Ledger: `docs/superpowers/programs/child-tmpdir-bsd.md` on the coordinator's branch `ws/ccr-15-reclamation-policy-fleet-cleanup`.

---

## The defect, measured 2026-09-24

- Wave 1 (#175, `bbb5e714`) shipped `_child_tmpdir` with `… || ! chmod 0700 -- "$dir" 2>/dev/null; then` (origin/main `ccd/ccd`, search `^_child_tmpdir()`). The `--` comes AFTER the mode operand.
- GNU getopt permutes arguments, so on Linux `--` is still read as end-of-options. BSD getopt (macOS `/bin/chmod`) stops at the first operand, `0700`. `--` then becomes a FILE operand. chmod re-modes `$dir`, fails on `--` ("No such file or directory"), and exits 1. `_child_tmpdir` answers rc 2 ("could not be made a private directory") for EVERY child on macOS, and `_spawn_start` spawns it without `TMPDIR`. It fails safe (warned, uncontained), but on macOS the containment never happens.
- Measured:
  - `env POSIXLY_CORRECT=1 chmod 0700 -- d` gives rc 1 with `cannot access '--'`, and the mode IS applied.
  - `env POSIXLY_CORRECT=1 chmod -- 0700 d` and `… chmod 0700 d` both give rc 0.
  - `env POSIXLY_CORRECT=1 mkdir -p -m 0700 -- r r/x` gives rc 0, so the `mkdir` on the line above is correct as written.
- CI evidence:
  - PR #184's macOS 2/2 leg (job 107770374104) fails 5 cases in `ccd-child-tmpdir.test.ts` and 1 in `ccd-ws-add-child.test.ts`, every one through that rc 2.
  - main's full run 36026429539 (test-macos 4/4) fails the `ccd-ws-add-child` case.
  - The runner's bash is Homebrew 5.3, and coreutils' gnubin is NOT on PATH, so `chmod` is BSD.
- It stayed red because the macOS leg is non-required. #183 made stable promotion require every macOS shard, so it now blocks every promotion.
- Not this defect, and not this plan's: main's test-macos 3/4 cancellation. `ccgpt-proxy.test.ts` wedges the single macOS worker on every main run since #165 (2026-09-22), before child-reclamation existed.

## Global constraints

- **Fixture HOMEs only** (`makeCcdHarness`). Never run ccd against the live `$HOME`.
- **The edit is in place and line-neutral.** `_child_tmpdir` sits below the frozen citation boundary (measure it, as the brief says; expected `ccd/ccd:19131`). Change the one token on the one line, prove it with `git diff -U0 origin/main -- ccd/ccd` (exactly one hunk, `-1 +1`), and re-stamp ccd. No S6-R11 move follows from a line-neutral edit, but run the census re-measurer anyway and report `stated / base / tree`.
- **Do not touch anything else in `_child_tmpdir`.** Its check-once shape is contract R1/R26. Wave 3 (run 148, in flight) carries the same function unchanged and will take this line by merging main.
- **Mutation-table discipline.** Every new pin reds when its subject is removed, measured and then restored.

## Task 1 — the fix and its pins

**Files:** `ccd/ccd`, `server/test/ccd-child-tmpdir.test.ts` (and `server/test/ccd-ws-add-child.test.ts` only if a shared helper belongs there).

- [ ] Measure the frozen boundary and write it down.
- [ ] RED (Linux): make the BSD argument order visible on Linux WITHOUT setting `POSIXLY_CORRECT` on bash itself, because bash would enter posix mode. Suggested shape: a fixture `bin/` holding a `chmod` shim that runs `exec env POSIXLY_CORRECT=1 <real chmod> "$@"`, with the real path resolved once, measured and not assumed, then put first on the PATH the ccd process sees. On macOS the real chmod is already BSD, and the shim changes nothing. Under that PATH, on the unfixed tree:
  - "rc 0 for a child: prints the path, and both directories exist at 0700" goes red;
  - "re-privatises a leaf that already exists wider" goes red;
  - "FOLLOWS a symlinked ROOT" goes red;
  - the `_spawn_start` "TMPDIR … spliced exactly once" case goes red.

  Run them as a second describe block over the same cases (a parameterised pair, or a shared body), not as copies.
- [ ] GREEN: `chmod 0700 -- "$dir"` → `chmod -- 0700 "$dir"`. Re-stamp.
- [ ] Census (a literal-absence pin; say so in its comment): no non-comment line in the shipped bash under `ccd/` and `deploy/` (enumerate files by shebang; do not hand-list them) has `chmod`, `chown` or `chgrp` followed by a non-option operand and then a bare `--`. Report the file count it scanned. It is honest about what it is: it catches this spelling, not every GNU-only argument order.
- [ ] Mutation rows, each measured red, then restored and re-stamped:
  1. put the `--` back after the mode: the Linux shim cases red, and the census reds;
  2. delete the shim from the PATH, keeping the unfixed line: the shim cases go green again, which proves the shim is what makes them discriminate (a control);
  3. a census control: plant `chmod 600 -- "$x"` in a scratch copy of a scanned file and confirm the census reds on it.
- [ ] Every existing case in both files stays green on Linux.
- [ ] Say in your wave-done which of the existing macOS-only-accidental passes now discriminate again. The review of this defect found that, on macOS, the rc-2 cases and the "no marker → no TMPDIR" tails passed only because every child answered rc 2 there.

## Task 2 — verification and PR

- [ ] `git fetch origin main`, and merge (never rebase) if `main` moved `ccd/ccd`. Then re-stamp and re-measure.
- [ ] server: `npm ci`, then `./node_modules/.bin/vitest run test/ccd-child-tmpdir.test.ts test/ccd-ws-add-child.test.ts` in the foreground (timeout ≥ 600000 ms), then deviation-refs, dtbd, topology-clean, session-hook (with `TMPDIR=/tmp`; you are a marked child) and the other `ccd-*` suites that source ccd (say which).
- [ ] Commit this plan file into `docs/superpowers/plans/` on your branch, beside the fix.
- [ ] Open the PR against `main` from this workspace's own branch. Its body carries the defect, the fix, the boundary measurement, the mutation table and the census count. Do not merge. Do not deploy.
- [ ] **The macOS measurement is the point.** Read the PR's macOS legs. For each of `ccd-child-tmpdir.test.ts` and `ccd-ws-add-child.test.ts`, report whether it ran and passed on a macOS leg (job id plus the `✓` line), or did not run there (selection, or a leg cancelled at its cap by the `ccgpt-proxy` wedge). Do not wait on CI by sleeping. Report what has landed when you send wave-done, and name what is still pending.

## Deviations found

Numbers are ISSUED, never chosen. This plan's block was allocated by its coordinator at run-open, and a worker never calls the allocator. Name any departure in your wave-done mail; the coordinator assigns it a number from this block and has it defined here.

- **D-3510** (`child-tmpdir-bsd-chmod`) — wave 1's plan and its shipped `_child_tmpdir` (`bbb5e714`, #175) spelled the privatising call `chmod 0700 -- "$dir"`, an argument order only GNU getopt accepts. On macOS it made every child answer rc 2 and spawn uncontained. It went unnoticed because the macOS leg was non-required, and #183 made it block every stable promotion. This plan changes it to `chmod -- 0700 "$dir"` and adds a Linux-visible BSD-order pin and a literal-absence census. Measured by the coordinator 2026-09-24; its evidence is this plan's "The defect, measured".
- **D-3511** (`plan-diff-one-hunk`) — Global constraints asks for `git diff -U0 origin/main -- ccd/ccd` to show exactly one hunk, `-1 +1`. Measured at `79a7e5ab`, it shows two, each `-1 +1`: `@@ -2 +2 @@`, ccd's `# ccrc:generated` stamp, and `@@ -19752 +19752 @@`, the fix. After a re-stamp the stamp line is always its own hunk; the brief named it, but this plan's sentence did not. It is an error in the plan's wording, and the fix is unchanged: one token on one line.
- **D-3512** (`bsd-cases-plus-resume`) — Task 1's RED lists four cases that go red under the BSD-order shim. A fifth goes red too: "BOTH spawn lines carry it when the --resume attempt dies and the retry runs". Both describe blocks run whole under `describe.each` over the two chmod substrates, rather than only the four listed cases, so every `_child_tmpdir` and `_spawn_start` case gets the BSD-order arm. That is more coverage than the plan prescribed. Mutation row 1 measured 6 red: those five and the census.

---

## Review lenses

The held-out panel (three Opus·high lenses, three Sonnet·high refuters per finding) reads this wave. It is asked to hold:
- the edit is one token on one line, and nothing else in `_child_tmpdir` moved;
- the shim cases discriminate on Linux, and the control (row 2) proves it;
- the census is described as what it is;
- the macOS evidence is reported as measured, with job ids, or named as unmeasured.
