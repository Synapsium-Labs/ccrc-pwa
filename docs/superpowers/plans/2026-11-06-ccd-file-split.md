# ccd File Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** split `ccd/ccd` (46,002 lines and 729 functions at `4c677d328`) into a small spine plus fixed libraries in `ccd/lib/`, assembled into one stamped file at install, with no behaviour change; then split `ccd/ccrc` too, with how its libraries load decided at the Phase D gate (Q7), and make new code land in the libraries.

**Architecture:** the tree holds the spine and the libraries. A source checkout loads the libraries at the spine's foot, as it does today. The installer inlines them at that same point, so the box holds one file that the launcher's digest covers from first byte to last. Functions move in 19 script-generated, byte-for-byte slices, smallest and least hot first, and each slice is its own PR.

**Tech Stack:** bash 5, python3 standard library (the installer, the slice tool), vitest, shellcheck 0.11.0.

**Spec:** the rulings in `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` ("Rulings recorded for ARCH-02b") and O9 (a) in `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md`; the scope is issue #2006. There is no separate design spec: the design is the section below.

**Status:** the operator ruled Q1 to Q8 on 2026-11-06 (D-8048). The answers close each question under Operator Rulings, at the end of this plan. Only Part A of Task 2, the two list fixes, starts now, in a PR of its own. Everything else waits for Task 0 (Q5). On 2026-11-10 the operator added one context, C10 Session host, in the session-host report's ruling Q13 (`docs/superpowers/specs/2026-11-09-session-host-research.md`, §6.1 and §8 A4). Task 7 gives it a home and orders its PRs against slices 6, 9, 12 and 13 (D-8272).

## Ledger

- **D-8048 (2026-11-06)** — `ccd-file-split-plan`: assemble `ccd/ccd` at install from fixed libraries, move functions in 19 pure slices, tighten the growth check, then repeat for `ccd/ccrc`. Measured at `4c677d328`.
- **D-8272 (2026-11-11)** — `ccd-file-split-session-host`: the session-host ruling Q13 adds context C10 Session host to `ccd/contexts.tsv`, homed in `ccd/lib/sessionhost.sh` (Task 7). It owns hosting, observing and driving sessions behind the one `SessionHost` interface of the session-host report's §8 A4, and its PRs are ordered against slices 6, 9, 12 and 13.

## Global Constraints

- No runtime-sourced ccd siblings: ccd loads only a fixed list, never a file chosen at run time.
- ccd's decisions stay in ccd. Nothing moves to the server.
- Behaviour does not change. The one exception is ruled (Q2): a tampered install refuses at the launcher, not in the load.
- Each step is a standalone PR with a characterization pin and counted exit criteria (O9 (a)).
- The hot-file lane allows one tracked PR on `ccd/ccd` at a time. Each hot library gets a lane of its own, live before about slice 9 (Q4).
- Landing follows the landing advisory in `ccd/session-hook.sh`: absorb `main` only on a conflict, a red required check or an ejection, and only with `git merge`. No rebase, no force-push. A clean branch lands as it is.
- A move carries functions, their leading comment blocks, and the comment and blank lines between two functions of one run. Nothing else. Top-level statements stay in the spine: 18 of them are bare `declare -A` lines, which would turn local inside the load's function. Existing `# @ccd-lib:` pointer lines stay too, because `ccdSource()` splices one level only.
- The dispatcher, `die`, `_roster_fp_to`, the K rows of `ccd/contexts.tsv` and `_ccd_lib_load` stay in the spine.
- No tracker ids in any repository file, commit or PR body: cite `#n`, ARCH-NN or D-numbers.
- `ccd/ccd` and `ccd/lib/*.sh` run under `set -uo pipefail`, never `-e`.

## Review Focus

1. A feature PR rebased across a move that keeps its old copy of a function. It must go red, never run two definitions (Task 1, `ccd-contexts`' "defines a function twice" row, pinned with a fixture).
2. A live process re-sourcing its body during an update. Two routes do this by path: `_pane_scope_detach` runs `source '$self'`, and `carry-dedupe.py`'s `route()` runs `source "$1"`. An assembled body must be whole on its own (Task 5).
3. A library whose bytes would merge lines or end early when inlined: no final newline, two final newlines, a NUL, a top-level `declare` without `-g`, a top-level `$1` (Tasks 4 and 5).
4. Rollback to a body that still pins library files, with those files present or absent (Task 5).
5. A full temp or root filesystem at start: the load holds no here-string today, and the assembled start must stay as free of temp files (Task 5 keeps the existing row).
6. A region that takes more than its function. A swallowed assignment becomes a local inside the load, and a splice cannot show it, because the splice puts the bytes back (Task 1: the region rule and the `declare -p` check).
7. A scan that stays green because moved code left it. A red test is the easy case; the six silent ones in Task 4 are the hard one.
8. A move PR waiting in the queue. Nothing it asserts may depend on the `main` it was opened against (Task 1: computed at test time).

## What Is Measured And What Is Inferred

Everything here was measured at `4c677d328` unless it says otherwise. Hunk counts use git's hunk-header attribution (`git log -p -U0`, the last column-0 name before the hunk), so they are approximate: a hunk in a comment block between two functions counts for the one above it. Timings come from a development Mac (bash 5.3, perl `shasum`), not the fleet box.

`main` has moved since. At `5dd21cdb2`, `ccd/ccd` holds 46,210 lines (+208) and 738 functions (+9), from 5 commits, and `ccd/contexts.tsv` has 9 more rows. All nine new functions are C1 or C4, so they fall into slices and the spine's count does not change. The tables below were not redone for this. An exit count that has to hold at run time compares with `moveBase`, not with a figure here.

**Measured: size and heat**

| Context | Functions | Body lines | Lead comment lines | Hunks, 30 days (of 1,531) |
|---|---|---|---|---|
| C4 Workspace | 300 | 20,243 | 662 | 883 |
| C1 Registry & Accounts | 201 | 8,427 | 1,157 | 194 |
| C3 Conversation | 116 | 4,037 | 181 | 74 |
| C9 Docs | 8 | 3,698 | 4 | 4 |
| C2 Mutation | 67 | 2,696 | 318 | 54 |
| K kernels | 29 | 424 | 327 | 10 |
| C7 Update | 2 | 134 | 0 | 12 |
| C5 Coordination | 6 | 112 | 57 | 8 |
| Top level | n/a | 3,526 (412 code) | n/a | 292 |

`ccd/ccd` took 105 of the 1,193 commits on `main` in 30 days. `_docs_py` alone is 3,617 lines. The top-level hunks include the line-2 stamp until #1525, and C7's 12 hunks are all `_ccd_lib_load`.

**Measured: what each mechanism assumes**

| Mechanism | What it assumes today | Consequence |
|---|---|---|
| Release build (`deploy/build-release.sh`) | Copies the tree and writes a per-file `MANIFEST`. It assembles nothing. | `ccd/lib/*.sh` is already digest-listed in every release. |
| Install (`ccd/ccd-entry-install.py`) | The only writer of the stamp and every pin; `ccrc install`, `ccrc update` and `deploy.sh` all reach it. | It is the one place assembly can go without a second path. |
| Stamp | Line 2 is a placeholder, stamped at install since #1525. | Issue #2006's "every ccd PR conflicts on the line-2 stamp" is out of date. |
| `ccrc restamp` | Refuses `ccd/ccd`. It still regenerates `session-hook.sh` and `ccd-account-health` from functions in `ccd/ccd`. | `shared/hook-helpers.mjs` must read the spliced program once a source function moves (`_plat_epoch_ms` stays; the `_authdead_*` writers move). |
| Digest checks | Launcher pins the body; the body pins three libraries. Load reads, hashes, then `eval`s inside `_ccd_lib_load`. | A library costs one hash pipeline per verb. |
| Cost of one library | #1897 touched 26 files. The names are hard-coded in the installer, the loader, `ccrc` backup and uninstall, `deploy.sh`, and at least nine test files. | Nineteen more would be about 500 file edits without a table (inferred). |
| Text scanners | 150 test files read ccd through `ccdSource()`, which splices each `# @ccd-lib:<id>` region back, one level deep. The guard matches only `readFileSync(CCD, …)`, so a `read('ccd/ccd')` helper, a `scan = [...]` array, a `CCD_PATH` constant and a flat `readdir` all pass it. | The one-text view is not enforced. A scratch run of the end state went red in 17 test files and left 6 more green while moved code dropped out of their scan (Task 4 has the list). Each moved run needs a pointer line (249 at the end, measured). |
| `ccd/contexts.tsv` | 850 rows, 2 columns, in definition order. | Every move reorders rows, so the tool writes them. |
| Growth check | `GROWTH_FILES` is a static list in `growth-check.test.ts`: `ccd/ccd`, `ccd/lib/disk-retention.sh` and `ccd/ccrc`, not the other two libraries. A waiver only counts in the PR that adds it. `netGrowth` gives a new file a base of 0, and `growthOver` passes a listed file when another listed file shrinks by as much. | `train-proof.sh` and `delegation-lease.sh` grow unmeasured today, and left alone, so would all 19 new libraries: 19,447 of `ccd/ccd`'s 20,134 code lines. 19 waivers: `ccd/ccd` 8 (1,059 lines), `ccd/ccrc` 6 (1,750), `session-hook.sh` 4 (652), `watch.ts` 1 (225). |
| Shellcheck ratchet | One pin for `ccd/ccd + ccd/lib`, 142 findings, summed per file. Its header says a split "does not trip it". | **False.** See the spike. |
| Citations (`citations.test.ts`) | Lines a branch adds may hold no numeric citation. | `ccd/ccd` has 150 such lines; 159 citations sit in moved regions, so a plain move goes red. |
| CI selection | `SESSION_HOOK_TRIGGERS` matches `ccd/ccd` exactly. | An edit in a library skips the session-hook suites in a fast PR. |

**Measured: the spike.** A throwaway script in a scratch directory (nothing committed) cut every non-K function into 19 files, using the region rule in Task 1 Step 4.

- Only `_roster_fp_to` and `_ccd_lib_load` run during load (`bash -x` with a stub roster, 558 traced lines; `die` on the refusal path, `_plat_sha256` on the installed arm). So 698 functions can load at the foot.
- All 729 regions, each `eval`ed alone in an empty shell, define exactly one function and no variable.
- After each of the 19 slices in turn, `eval`ed inside a function at the foot: `declare -f` (32,717 lines) and `declare -p` were byte-identical to today's source form. So were all 22 libraries inlined at the foot. `BASH_SOURCE[0]` inside an `eval`-defined function names the evaluating file, so it holds in both forms.
- The spliced text of the end state equals today's, byte for byte.
- In every slice, `ccd/ccd` shrinks by exactly the library's net code lines (20,134 today: 687 stay, 19,447 move). So `growthOver`'s shrink rule passes every move with no change, and a program-wide count does not move.
- The end-state spine is 4,203 lines and 31 functions, with 249 new pointer lines. The largest library is 5,111 lines.
- Shellcheck summed per file goes from 142 to about **299** on a pure move, because a variable set in the spine and read in a library reads as unused. C9 alone adds 0; C5 + C7 add 5. (Measured on the first cut. The second cut moves the same code.)
- Shellcheck over the spliced program counts 154, in 57 s. That text is unchanged by a pure move, so the count cannot move.
- Start time: load 90 to 100 ms in both forms; hashing the three libraries 54 ms more; parse alone 61 ms.

**Measured: what the first cut got wrong.** The rule this plan first stated, `name() {` through the first column-0 `}`, cannot cut the file: 70 regions swallow another definition (15 from another context) and 26 swallow top-level lines. `_cfg_dir` would run from line 17287 to 17413 and take `TRANSCRIPT_JQ_LIB`, `CONTINUED_IN_JQ` and 9 bare `declare -A _CI_*` lines. Stopping at the next definition still sweeps top-level statements for 11 non-K one-liners. A run that crossed an existing pointer line was wrong in a third way: `ccdSource()` left that pointer unspliced, so its region left every text scan (a refusal call, four `_ws_orphan_locked` words and `PR_TRAIN_PROOFS_FILE` went missing). None of this shows in a splice alone.

**Inferred, not measured**

- The hash saving on the fleet box. `sha256sum` is C, so it will be smaller than 54 ms. Task 5 measures it.
- Merge conflicts. The line-2 conflict is already gone, and git merges non-overlapping hunks in one file. The real relief is that the lane serialises per file, so feature PRs in different libraries stop queueing behind each other. Q4 ruled for that: one lane per library.
- The spine stays hot. In the 32 commits since 2026-10-27, 16 hunks hit the dispatcher `case`. A new verb still edits the spine, by a line or two.
- **CI time does not fall.** Every ccd test sources the whole program, so the test map selects the same tests. The earlier claim that this split helps CI is not supported.
- Shellcheck memory does not fall. Q3 ruled for the spliced pass, which still peaks near 6.2 GB, so the macOS CI legs keep skipping. One 4,999-line library peaked at 1.0 GB.

## The Assembled Artifact

**In the tree:** `ccd/ccd` is the spine. It names its libraries once, in a literal array:

```bash
__CCD_LIBS=(disk-retention train-proof delegation-lease)   # load order; one word per ccd/lib/<word>.sh
```

**In a source checkout:** `_ccd_lib_load` reads that fixed list and `eval`s each file. No digest is checked, as today.

**On the box:** one file, `~/.local/libexec/ccrc/ccd`. The installer replaces the single `_ccd_lib_load || …` line with each library, in table order, between two marker lines:

```bash
# ── ccd-section disk-retention sha256=<hex> lines=<n> ──
<the library's bytes>
# ── ccd-section-end disk-retention ──
```

Spine line numbers above the foot stay the committed ones, because everything is inserted at the foot.

**Why it stays auditable:**

1. Assembly is deterministic: the same tree gives the same bytes.
2. Each section carries its library's digest, and the release `MANIFEST` lists the same digest for the same file.
3. The stamp covers the whole file, and the launcher's digest covers the stamped bytes. That is stronger than today: no byte of the body is outside the launcher's digest, and nothing is `eval`ed. Two routes skip the launcher, because each sources the body by path, so nothing is checked there (Q2): `_pane_scope_detach`, and `carry-dedupe.py`'s `route()`, which `cmd_carry_dedupe` hands `${BASH_SOURCE[0]}`. `_dispatch_swap` is not one: it execs `~/.local/bin/ccd`. Task 5 pins that both routes get a whole body.
4. `ccd-entry-install.py --verify-body <tree> <home>` rebuilds the body and compares bytes. `ccrc doctor` shows that as one row (Q6): WARN for the first release, skipped where there is no ccd pair. It compares against this box's tree and reads no manifest, so a changed tree still passes.
5. `grep -n 'ccd-section ' ~/.local/libexec/ccrc/ccd` is the file's table of contents.

The redactor pins stay: node runs those two files, so they stay files. `transcript.jq` and `carry-dedupe.py` stay separate files too, and no digest was found for them (Q1).

## Coexisting With Open Work

- **Only the two list fixes start now (Q5),** as Part A of Task 2, in a separate PR. They touch no `ccd/ccd` line, so they sit outside the lane.
- **Everything else is held** for the refactor, any open PR on `ccd/ccd` and a check of #2006's conditions (Task 0). That covers Task 1, Part B of Task 2 (the lint rebaseline and the program row) and Task 3 onward.
- **Tasks 3 to 5 and the slices need the lane.** Open on `ccd/ccd` at `4c677d328`: #1114 (169+ lines), #2347 and #2307 (3 lines each, spine only). All three have merged since, as has #2374, the one open at the ruling, so none is open at `5dd21cdb2`. #1611 touches `ccd/ccrc` only.
- **A move syncs like any other PR, and is regenerated only on a conflict.** `main` takes about 40 commits a day and about 3 of them touch `ccd/ccd`, so a clean move PR is left alone. On a conflict in `ccd/ccd` or `ccd/contexts.tsv`, the move is rebuilt inside a `git merge` commit (Task 6 Step 7), so the branch never needs a force-push and no exception is asked for.
- **A move yields to features.** `preflight` refuses a slice while any open PR has a hunk in one of its functions. The move waits; the feature does not.
- **The lane alternates.** After a move lands, the next waiting feature PR takes the lane before the next move.
- **A feature PR caught by a move** remakes its edit in the library, which holds the same bytes, and drops its `ccd/ccd` hunk. `patch` cannot do this for it: #1114's diff applied only 3 of 10 hunks to `accounts-swap` (measured). If the PR keeps the old function, `ccd-contexts` goes red.
- **#1114 overlapped** `accounts-swap`, `accounts` and `workspace` (`_ws_slug_valid`) at `4c677d328`, and has since merged. The Accounts PRs overlapped no slice. `preflight` answers this afresh for each slice.

## Rollback

| Step | Rollback | Box state |
|---|---|---|
| Tasks 1, 2, 7, 8 | `git revert` | None. Tests and CI only. |
| Task 3 | `git revert` | None. Comments only. |
| Task 4 | `git revert` | None. Installed bytes do not change, apart from one array line. |
| Task 5 | `ccrc rollback` restores body and launcher from the backup; then `git revert` | The three old library files stay on the box and in the backup rows until Task 9, so a restored body finds its pinned bytes. `_upd_backup_copy` skips an absent file. |
| Each slice (Task 6) | `git revert` of the one squashed commit, or `ccd-split.py unmove <library>` if later PRs edited the library. Both delete a library, and the growth check counts that as a shrink (Task 2). | None. A pure move changes no data. Every release holds a whole program. |
| Task 9 | `git revert`, after one stable release has passed | Reinstates the rows; old files were already gone. |

There is no switch to install unassembled: two install shapes would be one more thing to test.

---

## Phase 0: Gate

### Task 0: Confirm the start conditions

This gates Task 1, Part B of Task 2 and Task 3 onward (Q5). Only Part A of Task 2 goes ahead of it. All eight questions are ruled, so no ruling is waited on here.

**Files:** none.

- [ ] **Step 1: Read the open PRs on the shared files.**

Run: `gh pr list --repo Synapsium-Labs/ccrc-pwa --state open --limit 100 --json number,files --jq '.[] | select(any(.files[]; .path=="ccd/ccd")) | .number'`
Expected: nothing listed. An open PR holds the start, as #2374 did at the ruling.

- [ ] **Step 2: Confirm the refactor has closed, and issue #2006's own conditions.** The 2026-10-30 ruling on #2006 starts this work after the refactor closes, and 8 architecture epics were still open at the 2026-11-06 ruling. The W5 ccd series and the K5/K16 ccd tasks have merged, and no other ccd programme is open. Not measured here. A programme still open stops everything Task 0 gates, and goes to the operator.

---

## Phase A: The Ground (no function moves)

### Task 1: The pure-move pin and the slice tool

**Held (Q5):** this starts only once Task 0 passes.

**Files:**
- Create: `.github/ci/ccd-split.py`, `.github/ci/ccd-split-slices.tsv`, `server/test/ccd-split-pin.test.ts`, `server/test/ccdSplit.ts`, `server/test/ccd-split-records/` (empty)
- Modify: `.github/ci/fast-plan.mjs` (guard list), `server/test/ccdWsHelpers.ts` (export `spliceCcd`)

**Interfaces:**
- Produces: `spliceCcd(main: string, libs: readonly string[]): string`, the body of today's `ccdSource()` as a pure function.
- Produces: `.github/ci/ccd-split.py plan|preflight|move|unmove <slice>`. `plan` prints functions, lines, runs and citations, and with `--record` writes the record. `preflight` exits 0 only when no open PR has a hunk in a slice function; it reads PR heads with `git fetch origin pull/<n>/head`, because `gh pr diff` gave nothing usable for these PRs (measured). `move` writes the library, pointer lines, the `__CCD_LIBS` word and reordered `contexts.tsv` rows. `unmove` puts each region back at its pointer. Both refuse `die`, `_roster_fp_to`, `_ccd_lib_load` and every K row, and refuse any region that fails Step 4's check.
- Produces: `.github/ci/ccd-split-slices.tsv`, rows `<move-order>\t<library>\t<context>\t<name-regex>`. A function belongs to the first row in file order that matches, so the catch-all rows sit last in the file whatever their move order.
- Produces: `server/test/ccd-split-records/<NN>-<library>.json`: `{library, functions: string[]}`, and nothing derived. No digest and no count is stored, because either would go stale while the PR queues.
- Produces: `moveBase(env, root): string`, the sha a run judges against. In a `merge_group` run it is `merge_group.base_sha` from `GITHUB_EVENT_PATH`, the same base `ci.yml` uses, so an entry ahead in the queue is not counted as part of a move. Otherwise it is `merge-base(origin/main, HEAD)`.
- Produces: `programDump(tree): string`, the `declare -f` and `declare -p` output of a tree sourced on a fixture home, with the shell's own variables and `__CCD_LIBS` removed by name.

- [ ] **Step 1: Write the failing tests** in `ccd-split-pin.test.ts`.

```ts
it('FIXTURE: a diff that adds a pointer is a pure move', () => {
  expect(pureMoveVerdict(base, movedByteForByte)).toEqual({ pure: true, differing: [] });
  expect(pureMoveVerdict(base, movedAndEdited).pure).toBe(false);
});
it('FIXTURE: a diff with no new pointer is not judged', () => {
  expect(pureMoveVerdict(base, featureEdit)).toBeNull();
});
it('FIXTURE: the __CCD_LIBS line may gain the moved library and nothing else', () => {
  expect(pureMoveVerdict(baseWithArray, movedWithOneNewWord)).toEqual({ pure: true, differing: [] });
  expect(pureMoveVerdict(baseWithArray, movedWithAnotherWordDropped)).toEqual({ pure: false, differing: ['__CCD_LIBS'] });
});
it('FIXTURE: a run that crosses an older pointer is not pure', () => {
  expect(pureMoveVerdict(baseWithPointer, movedOverThePointer).pure).toBe(false);
});
it('FIXTURE: a rebase that keeps the old function reds as a double definition', () => {
  expect(duplicateDefinitions(mainAndLibWithSameFn)).toEqual(['fa']);
});
it('FIXTURE: the dump ignores __CCD_LIBS and sees a swallowed global', () => {
  expect(programDump(movedWithOneNewWord)).toBe(programDump(baseWithArray));
  expect(programDump(movedWithBareDeclare)).not.toBe(programDump(baseWithArray));
});
it('FIXTURE: a region refuses a top-level line, a second definition or a variable', () => {
  expect(regionProblems(oneLinerThenAssignment)).toEqual([]);   // the assignment stays out of the region
  expect(regionProblems(regionHoldingTwoFunctions)).toEqual(['two definitions']);
});
it('REAL: this diff, against moveBase, is pure if it adds a pointer', () => { /* skips without origin/main, as growth-check does */ });
it('REAL: a record added in this diff holds', () => {
  /* computed now, from moveBase and HEAD: programDump equal; spine functions = base count minus the record's;
     each named function defined once in the program, in ccd/ccd before the move and in the library after */
});
```

`moveBase` is read at run time, so a change that lands on `main` while the move is queued sits on both sides of every comparison and cannot eject it.

- [ ] **Step 2: Run them to see them fail.**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-split-pin.test.ts --maxWorkers=2`
Expected: FAIL, `pureMoveVerdict` not defined.

- [ ] **Step 3: Implement** `pureMoveVerdict(base: Tree, head: Tree): {pure: boolean, differing: string[]} | null`, `duplicateDefinitions(tree: Tree): string[]`, `regionProblems(text: string): string[]`, `programDump` and `moveBase` in `ccdSplit.ts`. Purity has two parts. First, the one `__CCD_LIBS=(` line is taken out of each side, and the head's words must equal the base's plus exactly the libraries the diff adds, order kept; anything else answers `differing: ['__CCD_LIBS']`. Second, `spliceCcd` of both sides, with `# @ccd-lib:` lines and each library's header block (everything above its first marker, comment lines only) removed, compares byte for byte. Records follow `waiversAdded`: only a file `moveBase` does not hold counts.

- [ ] **Step 4: Implement `ccd-split.py`.** Fill the slice table from the table in Task 6. A region is found like this:

1. A definition is a column-0 `name() {` line (729 at `4c677d328`).
2. Its end is the first line, before the next definition, at which `bash -n` accepts the span with exit 0 and empty stderr. Stderr matters: an unclosed heredoc is only a warning. This handles all three forms without a list: 67 one-liners, 659 that close on a column-0 `}`, and 3 that close on `; }` (`_ws_supervise`, `_lc_intent`, `_lc_done`). It costs 3,929 `bash -n` runs at this size.
3. Its lead is the `#` block directly above, stopping at a `# @ccd-lib:` line.
4. A run is the regions of one slice with only comment and blank lines between them. A top-level statement or a `# @ccd-lib:` line ends the run.
5. `regionProblems` then `eval`s each region alone in an empty shell. It must define exactly one function and no variable, or `move` refuses and names it. All 729 passed at `4c677d328`.

`ccdCallGraph` does not use this rule: it stops at the next definition, so it sees a one-liner's following statements as its body. Step 5 of Task 6 allows for that.

- [ ] **Step 5: Prove the tool on a scratch copy.**

Run: `.github/ci/ccd-split.py plan docs`
Expected: 8 functions, about 3,709 lines, 1 run. Then, in a scratch copy with the `__CCD_LIBS` line added (Task 4 has not landed yet), `move` every slice in table order. After each one, check that `spliceCcd` equals today's text apart from that line, and that `programDump` is unchanged. The dump is the check that sees a swallowed global; the splice cannot, because it puts moved bytes back where they were. At the end, inline all the libraries at the foot and check `programDump` again.

- [ ] **Step 6: Run the tests, then commit.**

Exit count: `ccd/ccd` unchanged, its function count equal to `moveBase`'s; every region passes `regionProblems`; 19 slices match in `programDump`. The pin suite runs on every PR through the guard list.

### Task 2: The ratchet reads the program as one, and CI follows the libraries

Q5 splits this task in two. Part A is the two list fixes, one small PR on test and CI lists, and it starts now. Part B is the lint rebaseline and the program row. It waits for Task 0, and the rebaseline must land before slice 1 (Q3).

#### Part A: the two list fixes (starts now, separate PR)

**Files:**
- Modify: `.github/ci/fast-plan.mjs`, `server/test/ci-fast-plan.test.ts`, `server/test/growthCheck.ts`, `server/test/growth-check.test.ts`, `CLAUDE.md` ("What CI runs"), `README.md` (the same sentence)

**Interfaces:**
- Produces: `growthFiles(base, head, root): string[]`, the static list without its library entry, plus every `ccd/lib/*.sh` at either sha (`git ls-tree`). No library is ever named by hand, so no later PR has a list to forget.

- [ ] **Step 1: Write the failing rows.**

```ts
it('a change under ccd/lib/ runs the session-hook suites', () => {
  expect(fastSelection({ ...args, changed: ['ccd/lib/docs.sh'] }).hook).toBe(true);
});
it('every ccd/lib/*.sh is a growth-listed file, with no list to keep', () => {
  expect(growthFiles(base, headWithNewLib, dir)).toContain('ccd/lib/workspace.sh');
});
```

- [ ] **Step 2: Run to see them fail.**

Run: `cd server && ./node_modules/.bin/vitest run test/ci-fast-plan.test.ts test/growth-check.test.ts --maxWorkers=2`

- [ ] **Step 3: Change the two lists.** `SESSION_HOOK_TRIGGERS` gains a `ccd/lib/` prefix match. The `ci-fast-plan` row that pins the literal list changes with it, and so does every sentence naming the triggers: the header of `fast-plan.mjs`, "What CI runs" in `CLAUDE.md`, and the README. The armed rows read `growthFiles`. That brings `train-proof.sh`, `delegation-lease.sh` and `ccrc-settings.sh` under the limit beside `disk-retention.sh`.

The D-6913 row (`ccd/lib/disk-retention.sh is held like ccd/ccd`) reads `GROWTH_FILES`, so it breaks when that entry leaves. Rewrite it to run over every `ccd/lib/*.sh` that `growthFiles` answers, with no library's name in it, and correct the comment on `GROWTH_FILES`.

- [ ] **Step 4: Run, then commit.**

Exit count: every `ccd/lib/*.sh` listed (4 today); `GROWTH_FILES` holds no `ccd/lib/` entry, and no row of `growth-check.test.ts` names a library that exists (a fixture tree's made-up name is fine); `ccd/ccd` unchanged.

#### Part B: the ratchet and the program row (held by Task 0)

**Files:**
- Modify: `server/test/shellcheck-ratchet.test.ts`, `server/test/shellcheck-baseline.json`, `server/test/growthCheck.ts`, `server/test/growth-check.test.ts`

**Interfaces:**
- Consumes: `spliceCcd`, `growthFiles`.
- Produces: the `ccd/ccd + ccd/lib` pin measured over one spliced temp file, findings mapped back to `<file>:<line>`.
- Produces: `programRow(base, head, root): GrowthRow`, named `ccd (program)`: the net code lines of `ccd/ccd` plus every `ccd/lib/*.sh` not named `ccrc-*`, summed at each sha.

- [ ] **Step 1: Write the failing rows.**

```ts
it('FIXTURE: moving a function between ccd/ccd and a library leaves the count alone', () => { /* same count both ways */ });
it('REAL: a finding names the file and line it came from, not the spliced text', () => {});
it('FIXTURE: a pure move passes: the new library against the shrink, and the program row at 0', () => {
  expect(growthOver([newLib(1000), row('ccd/ccd', -1000), program(0)], [])).toEqual([]);
});
it('FIXTURE: a feature of 41 lines in a library is named, in the file and in the program', () => {
  expect(growthOver([row('ccd/lib/workspace.sh', 41), program(41)], [])).toEqual(['ccd/lib/workspace.sh', 'ccd (program)']);
});
it('FIXTURE: 30 lines in each of three libraries passes every file and reds the program', () => {
  expect(growthOver([...threeLibsAt(30), program(90)], [])).toEqual(['ccd (program)']);
});
it('FIXTURE: shrinking one library cannot pay for growing two', () => {
  expect(growthOver([row('ccd/lib/a.sh', -1000), row('ccd/lib/b.sh', 1000), row('ccd/lib/c.sh', 1000), program(1000)], []))
    .toEqual(['ccd (program)']);
});
it('FIXTURE: a revert passes: the deleted library is the shrink', () => {
  expect(growthOver([row('ccd/ccd', 1000), deletedLib(-1000), program(0)], [])).toEqual([]);
});
it('FIXTURE: one waiver on a library covers its file up to maxDelta, and raises the program row by maxDelta', () => {});
it('FIXTURE: an exemption on main for a member raises the program row by its cap; one that does not apply raises nothing', () => {
  const rows = [row('ccd/ccd', 60), program(60)];
  const over = growthOver(rows, []);
  const named = [exemption({ pr: 1100, file: 'ccd/ccd', cap: 100 })];
  expect(failing(growthVerdicts(rows, over, named, 1100, []))).toEqual([]);
  expect(failing(growthVerdicts(rows, over, named, 1101, []))).toEqual(['ccd/ccd', 'ccd (program)']);
  expect(failing(growthVerdicts(rows, over, named, 1100, ['server/test/growthCheck.ts']))).toEqual(['ccd/ccd', 'ccd (program)']);
});
it('FIXTURE: no waiver or exemption can name the program row', () => {
  expect(parseExemptions(list(entry({ file: 'ccd (program)' })), files, today).problems).not.toEqual([]);
});
```

`failing` is the files of the verdicts whose `fails` is true.

The rows stand on the shrink rule that exists today. `netGrowth` gives a new library a base of 0, so a move shows that library's whole size as its delta, and `growthOver` passes it only because `ccd/ccd` shrinks by at least as much. The spike measured the two as exactly equal in all 19 slices.

- [ ] **Step 2: Run to see them fail.**

Run: `cd server && ./node_modules/.bin/vitest run test/shellcheck-ratchet.test.ts test/growth-check.test.ts --maxWorkers=2`

- [ ] **Step 3: Change the ratchet** (Q3). `pinKey` keeps the group; the group is linted once, over `spliceCcd`. `ccd/lib/ccrc-settings.sh` takes its own pin of 6, because the sweeps source it and ccd does not. Correct the header's claim.

- [ ] **Step 4: Rebaseline** the group from 142 to the measured count (154 at `4c677d328`), with the `codes` map the run prints. The comment on the pin says why this one rise happened, and the PR lists the new findings by code.

- [ ] **Step 5: Add the program row.** `armedGrowth` adds `programRow`.

The per-file rule stays, with one addition: a member of the program that is absent at head counts as a shrink of its whole size, so `git revert` and `unmove` pass. Every other file keeps today's rule.

The program row is red over `GROWTH_LIMIT`, and it never counts as another row's shrink. That bounds the total, which the per-file rows cannot do, and it is tighter than today: `ccd/ccd` and `disk-retention.sh` each have 40 lines now, and the program gets 40 between them.

Two kinds of entry raise the program row, each by its own limit, so a feature needs one entry, not two. A waiver the diff adds for a member raises it by `maxDelta`. An exemption on `origin/main` naming this PR and a member raises it by `cap`; an exemption is never in the diff, because `exemptionsOnMain` reads `main`'s copy only.

No entry names the row itself: `ccd (program)` stays out of the file list that `parseExemptions` and `parseWaiverFiles` check against, so they refuse it. `growthVerdicts` decides this row last instead. It adds up the entries that applied to a member's row, and the program row fails only over `GROWTH_LIMIT` plus that sum. An entry that did not apply raises nothing: one over its limit, one on a member that is not over, or an exemption whose diff edits the check's own files.

- [ ] **Step 6: Run, then commit.**

Exit count: group pin = measured value; total ratchet files unchanged plus 1; `ccd/ccd` unchanged; `ccd (program)` delta 0 on a fixture move.

### Task 3: Citations out of `ccd/ccd`

**Files:** Modify: `ccd/ccd` (comments only), `server/test/ccd-split-pin.test.ts`, `server/test/citations.test.ts`

- [ ] **Step 1: First commit: the pin.** Add this row, and commit it alone. It passes on the old code, where the diff changes nothing.

```ts
it('REAL: a diff that changes only comments in ccd/ccd leaves programDump alone', () => { /* moveBase against HEAD, computed now */ });
```

`bash` drops comments from the dump, so a comment edit cannot move it.

- [ ] **Step 2: Second commit: the rewrite.** Rewrite each `ccd:NNNN` and `<file>.<ext>:NN` in `ccd/ccd` to a symbol (`ccd#_ws_least_loaded`), following the header of `citations.test.ts`.

- [ ] **Step 3: Verify.**

Run: `grep -cE 'ccd:[0-9]{3,5}\b|\.(ts|tsx|mjs|sh):[0-9]+\b' ccd/ccd`
Expected: `0` (150 today). `BASELINE` in `citations.test.ts` drops by the same count in this PR.

Exit count: 0 citation lines in `ccd/ccd`; `programDump` byte-identical.

### Task 4: One library table, and every scanner on it

Task 5 ends the per-file install, so only the tree side needs the table. The backup rows in `ccd/ccrc` and `deploy/deploy.sh` stay as they are until Task 9.

**Files:**
- Modify: `ccd/ccd` (`__CCD_LIBS`, `_ccd_lib_load`), `ccd/ccd-entry-install.py`, `shared/hook-helpers.mjs` (reads the spliced program, so `ccrc restamp` keeps finding `_authdead_*`), `server/vitest.config.ts`, `agent/vitest.config.ts`, `server/test/consolidationCensus.ts`, `server/test/ccdWsHelpers.ts`, `server/test/ccd-lib-load.test.ts`, `server/test/ccd-entry-install.test.ts`, `server/test/ccd-install-stamp.test.ts`, `server/test/install-census.test.ts`, `server/test/installTreeFixture.ts`, `server/test/build-release.test.ts`, `server/test/ownership.test.ts`, `agent/test/ccd-entry-exec.test.ts`, `agent/test/deploy-verify.test.ts`, and the 22 other test files in the inventory below
- Create: `server/test/ccd-lib-shape.test.ts`, `server/test/ccdReadGuard.ts`

**Interfaces:**
- Produces: `read_lib_table(body: bytes) -> list[str]` in the installer, from exactly one line matching `^__CCD_LIBS=\(([a-z0-9 -]+)\)( .*)?$`; any other count refuses.
- Produces: `ccdLibNames(root?: string): string[]` in `consolidationCensus.ts`, the same line read in TS. `CCD_LIB_FILES`, `CCD_LIBS` and every hard-coded trio in a test derive from it.
- Produces: `programFile(rel: string): string`, which answers `ccd/ccd` for `ccd/ccd` and for each library in the table, and `rel` otherwise. A census that names where a definition sits names the program, so a move does not change its answer.
- Produces: `ccdTreeCopy(dir: string): string`, the body and every library in the table copied together. Nothing copies the body alone.

**The scanner inventory.** Measured by running 72 test files on a scratch tree holding all 19 slices, with a wrapper around `fs` recording every read of `ccd/ccd` and every listing of `ccd/`. Reds are compared with the same files on an untouched tree. The 72 are every server test file a static pass found reaching the text, except `ccrc-account`. That is a strong census, not a proof: `docs-parity` reaches the file through an import alias (`CCD as ccdScriptT6`) that the first pass missed, and it joined the list only because review named it. Step 6 is the proof.

*Red at a move: 41 rows in 17 files.*

| Kind | Files | Conversion |
|---|---|---|
| Reads the raw text (8) | `ccd-id-cap` (`read('ccd/ccd')`, which also pins the file's line numbers), `docs-parity` (`ccdScriptT6`), `hibernate-census`, `hook-helpers-characterization`, `hook-helpers-generated`, `pool-name-parity` and `pools-existence-pairing` (both through `CCD_PATH`), `workspace-refusal-census` | `ccdSource()`. A scan that reports a line reports it in the spliced text. |
| Copies the body alone (2) | `ccd-carry-dedupe` (copies it, then calls `cmd_carry_dedupe`, so it breaks at slice 3), `ccd-ws-add-base` (edits it to build an older ccd) | `ccdTreeCopy()`. `ccd-ws-add-base` edits `cmd_ws_add` wherever the table puts it. `hook-helpers-generated`'s three copies change the same way. |
| Names the file a definition sits in (5) | `single-definition/advance-switches`, `single-definition/roster-bash`, `single-definition/switches-history`, `delegation-wave3.integration`, `ccd-reg-id-ok` | `programFile()` on each holder. |
| Lists `ccd/` flat (1) | `ccd-child-tmproot-witness` (`shipped()` filters by shebang, and a library has none) | Add `ccd/lib/*.sh`. It stays silent through the early slices and reds only when its count floor trips. |
| The load itself (1) | `ccd-lib-load` | Part of this task. |

*Green while moved code leaves the scan: 6 files.* `auth-passkey` (the `scan` array), `pane-history-route` (`EXTRA`), `license` (the `shipped` array), `ccd-workdirid` (its `['ccd/ccd', CCD]` pair), `routing-references` (two reads), `routing-env-census` (the file array in its first row). Each reads `ccdSource()` for its ccd entry.

*Already whole, and listed as `PROGRAM_READERS`.* `single-definition/helpers` (`isBash` takes `.sh`), the `census-w5` readers, `consolidationCensus`, `ccd-account-auth`, `ccd-harness-integrity`, `ccd-id-cap`'s walk, `ccrc-versioned-audit`, `license`'s walks, `routing-env-census`' `CCD_SHIPPED`, `session-hook`, `late-census`, `workflow-control-census`, `ccd-collect-record`.

*Not evidence.* `ccrc-install-tree` and `ccrc-install-landing` (38 rows) went red only because the scratch installer does not publish new libraries; Task 5 ends that. `build-release`, `ccd-tick-diet-equivalence-static` and `session-hook` show the same reds on an untouched tree on this Mac. `transcript-jq-ship` and `path-identity-w1b-prose` read top-level text that stays, and convert with the rest. The agent suite and `ccrc-account` were not run; Step 6 covers them.

- [ ] **Step 1: First commit: the pin.** These rows pass on the old code. Commit them alone.

```ts
it('PIN: the source form loads disk-retention, train-proof, delegation-lease, in that order', () => {});
it('PIN: the load refuses with these words and no others', () => {});
it('PIN: every test-side library list names those three', () => {});
it('PIN: programDump of the source form is unchanged by this PR, apart from _ccd_lib_load', () => { /* moveBase against HEAD */ });
```

- [ ] **Step 2: Second commit: the scanners and the guard.** Convert the inventory, and add `ccdReadGuard.ts` to `setupFiles`. No `ccd/ccd` line changes, so Step 1's rows stay green.

The guard works by behaviour, not spelling. It wraps `fs.readFileSync`, `fs.copyFileSync`, `fs.readdirSync` and `fs.promises.readFile`, then calls `syncBuiltinESMExports()`, so a named import sees it too. A read or copy of `ccd/ccd`, or a listing of `ccd/`, throws in the test that made it, unless the first test-side stack frame is in `FILE_READERS` (tests about the bytes) or `PROGRAM_READERS` (walks that also take in `ccd/lib`). The same wrapper is what measured the inventory: it saw `read()` helpers, `scan` arrays, `CCD_PATH` and flat listings alike. This replaces the regex in `ccd-lib-load.test.ts`.

The wrapper cannot see a child process. So one static row pins that no test hands `ccd/ccd` to `grep`, `sed`, `awk`, `wc`, `cat`, `head` or `tail` in a shell string (0 today).

- [ ] **Step 3: Third commit: write the failing rows.**

```ts
it('every test-side library list follows the table', () => { /* a fixture tree with a fourth word */ });
it('no library sets a global with a bare declare', () => {
  expect(topLevelDeclares(ccdLibNames())).toEqual([]);   // needs -g: the load is inside a function, inlining is not
});
it('no library reads a positional or returns at its top level', () => {
  expect(topLevelPositionals(ccdLibNames())).toEqual([]);
});
it('a library header holds comment lines only', () => {});
it('FIXTURE: the guard throws on a raw read, a helper read, a body copy and a flat listing', () => {});
it('hook-helpers.mjs reads the same text as spliceCcd', () => {});
```

The top-level split reuses `census-w5/accountMarkers.ts`'s reader.

- [ ] **Step 4: Implement.** `_ccd_lib_load` builds its file list from `__CCD_LIBS`; the three pin lines stay until Task 5. Same libraries published, same order, same refusal words.

- [ ] **Step 5: Verify.**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-lib-load.test.ts test/ccd-lib-shape.test.ts test/ccd-entry-install.test.ts test/ccd-install-stamp.test.ts test/install-census.test.ts test/ownership.test.ts test/routing-references.test.ts --maxWorkers=2`, then `cd agent && ./node_modules/.bin/vitest run test/ccd-entry-exec.test.ts test/deploy-verify.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 6: Rehearse the end state.** In a scratch copy of the branch, `move` every slice, then run the whole server and agent suites with the guard on, beside the same suites on an untouched copy.
Expected: no new red except the `ccrc-install-*` rows above, and no guard throw. A new red or throw is a scanner the inventory missed: convert it in this PR.

Exit count: 0 test files hard-code the three library names as a list; 23 inventory files converted; 0 guard throws in the rehearsal; `ccd/ccd` functions equal to `moveBase`'s count; `programDump` differs by `_ccd_lib_load` alone.

### Task 5: Assemble at install

**Ruled:** Q1 (join at install), Q2 (the three refusals leave installed boxes), Q6 (the doctor row). Held by Task 0 with the rest (Q5).

**Files:**
- Modify: `ccd/ccd-entry-install.py`, `ccd/ccd` (foot), `ccd/contexts.tsv` (one K row, `_ccd_hash_pick`), `ccd/ccd-entry.py` (comment), `ccd/ccrc-doctor-checks`, `README.md` (the install-stamp section), `server/test/ccdWsHelpers.ts`, `server/test/ccd-lib-load.test.ts`, `server/test/ccd-install-stamp.test.ts`, `server/test/ccd-entry-install.test.ts`, `agent/test/deploy-verify.test.ts`
- Create: `server/test/ccd-assembled-parity.test.ts`

**Interfaces:**
- Produces: `assemble_body(tree: str, body: bytes) -> bytes`: pins rendered, sections inlined, not yet stamped. `stamp_body` then runs as it does today.
- Produces: CLI `--print-body <tree>` (stamped bytes on stdout) and `--verify-body <tree> <home>` (exit 0 same, 1 differ, naming the first differing section).
- Produces: `_ccd_hash_pick` in `ccd/ccd`: the tool selection lifted from `_ccd_lib_load`, keeping `__CCD_HASH_CMD` and the `lib-hash` refusal. The installer's replacement for the load line runs it and sets `__CCD_LAYOUT=installed`. It runs during load, so it is a K row and stays in the spine.
- Consumes: `read_lib_table`.
- Changes: `installedCcdBody` in `ccdWsHelpers.ts` shells out to `--print-body`, so the assembler has one implementation. Memoised by tree digest.

- [ ] **Step 1: First commit: the pin.** Add `ccd-assembled-parity.test.ts` with the rows that describe today, and commit them alone. They pass on the old code, through today's installer and `eval` load. This is the step that changes what runs on the box, so these rows are what Step 5 is judged against.

```ts
it('PIN: the installed body and the source form define the same program', () => {
  expect(dump(installed)).toEqual(dump(sourceForm));   // declare -f and declare -p, a fixture HOME
});
it('PIN: a body re-sourced by _pane_scope_detach is the whole program', () => {});
it('PIN: a body sourced by carry-dedupe.py route() is the whole program', () => {
  /* bash -c 'source "$1" && _carry_link_route "$2" "$3"' on the installed path, as route() runs it; it answers, and declare -F equals the program's */
});
it('PIN: an unusable TMPDIR does not refuse the start', () => {});
it('PIN: a body restored from a backup finds its pinned libraries, present or restored', () => {});
it('PIN: a tampered, missing or unreadable library refuses with lib-digest, lib-missing, lib-unreadable', () => {});
```

- [ ] **Step 2: Second commit: write the failing rows.** The pins above stay as they are, apart from the last one, which Step 5 turns.

```ts
it('every section header names its bytes', () => { /* sha256 and lines match the library; lines are whole */ });
it('the assembled body is deterministic', () => { expect(render()).toBe(render()); });
it('the same tree verifies; a changed section does not', () => {});
it('bash -n accepts the assembled bytes before anything is published', () => {});
it('the doctor row is WARN on a mismatch, never FAIL, and names the first differing section', () => {});
it('the doctor row skips where there is no ccd pair', () => {});
```

- [ ] **Step 3: Run to see them fail.**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-assembled-parity.test.ts --maxWorkers=2`

- [ ] **Step 4: Implement.** The installer stops publishing `lib/*.sh`, and leaves any already there. The three `__CCD_LIB*_SHA256` lines and the installed arm of `_ccd_lib_load` go. `read_lib`'s one-newline, no-NUL rule stays. `_upd_backup_set` keeps its rows. `install` refuses unless `bash -n` passes on the staged bytes. The doctor row calls `--verify-body` and changes nothing. It is WARN on a mismatch for the first release, so a false mismatch cannot make `ccrc update` exit 3. It skips (`_dr_skip`) where there is no ccd pair. Whether a server-role box has a pair is unconfirmed, so the row looks for the pair, not the role. What the row becomes after the first release is not ruled.

- [ ] **Step 5: Turn the `lib-*` rows.** In `ccd-lib-load.test.ts` and Step 1's last pin, the installed-entry refusals for a tampered library become the launcher's `entry-body-digest` refusal on a tampered body, exit status still 125 (Q2). The source-arm rows stay.

- [ ] **Step 6: Measure, and put the numbers in the PR.** `ccd version` start time before and after, on the test box, ten runs.

- [ ] **Step 7: Run the install, lib-load, stamp, deploy and parity suites, then commit.**

- [ ] **Step 8: Rehearse the end state again.** As in Task 4 Step 6, now through the assembling installer.
Expected: no new red at all. The 38 `ccrc-install-*` rows clear here.

Exit count: 1 file holds ccd on an installed box; 0 `eval` of a library in an installed run; `declare -f` and `declare -p` dumps equal across both forms; `ccd/ccd` functions = `moveBase`'s count plus 1, `_ccd_hash_pick`.

- [ ] **Step 9: Soak.** The release runs on the test box for one full update and one `ccrc rollback` before the fleet takes it. The operator rolls it; a session never does.

---

## Phase B: The Moves

### Task 6: One slice (repeat in table order, one PR each)

**Files:**
- Create: `ccd/lib/<library>.sh`, `server/test/ccd-split-records/<NN>-<library>.json`
- Modify: `ccd/ccd`, `ccd/contexts.tsv`

No test or growth file changes in a slice: Task 4 moved the scanners to the program view, and Task 2 derives the growth list. If a slice needs one, the rehearsal missed it, and that is a finding.

**Interfaces:**
- Consumes: `ccd-split.py`, the pure-move pin, `__CCD_LIBS`.

- [ ] **Step 1: Preflight on a fresh `origin/main`.**

Run: `.github/ci/ccd-split.py preflight <slice>`
Expected: exit 0. Exit 1 names the PRs; skip to the next clear slice or wait. Until the lanes are live, a skip stays within slices 1 to 8 (see below).

- [ ] **Step 2: Take the lane.** One tracked PR on `ccd/ccd`, per the lane rule.

- [ ] **Step 3: First commit: the pin.** Add the record with `ccd-split.py plan <slice> --record`. Run the slice's suites below on the old code.
Expected: PASS, nothing moved yet.

- [ ] **Step 4: Second commit: the move.**

Run: `.github/ci/ccd-split.py move <slice>`. No hand edit.

- [ ] **Step 5: Verify.**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-split-pin.test.ts test/ccd-assembled-parity.test.ts test/ccd-contexts.test.ts test/ccd-lib-shape.test.ts <slice suites> --maxWorkers=2`
Expected: PASS; no new line in `ccd/contexts-edges.tsv`. `ccdCallGraph` reads a one-liner's body up to the next definition, so a move can change what follows it, and with it an edge: that is a finding to explain, not to add.

- [ ] **Step 6: Open the PR, and leave it alone.** The body gives the exit counts. A clean branch lands as it is: `main` moving is not a reason to touch it, and every sync restarts CI. The record's checks run from `moveBase` at test time, so a `ccd/ccd` change that lands while the move queues cannot eject it.

- [ ] **Step 7: Only on a trigger, absorb `main`.** The triggers are the landing advisory's three: a conflict, a required check red while `main` passes the same tests, or an ejection. Probe with `git fetch origin && git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD`.

If `ccd/ccd` and `ccd/contexts.tsv` merge clean, this is a plain `git merge origin/main`. If either conflicts, rebuild the move inside the merge:

```bash
git merge --no-commit --no-ff origin/main          # stops on the conflict
git checkout origin/main -- ccd/ccd ccd/contexts.tsv
.github/ci/ccd-split.py preflight <slice>          # exit 1: git merge --abort, and wait for that PR
.github/ci/ccd-split.py move <slice> --regenerate  # rewrites the library and the record
git add ccd/ccd ccd/contexts.tsv ccd/lib/<library>.sh server/test/ccd-split-records/<NN>-<library>.json
git commit                                         # the merge commit, then a plain push
```

The PR keeps its number and its lane. The history only gains a commit, so there is no force-push and no exception to ask for. The pure-move pin then judges the regenerated move against the new merge-base. `ccd/ccd` takes about 3 commits a day, and `preflight` keeps open feature hunks out of the slice, so this should be rare.

**Lanes before slice 9 (Q4).** This gates every slice from 9 to 19, in whatever order a skip reaches them. Before any of them takes the lane, confirm that each hot library has its own lane. The change is not in this plan or this repository: the merge keeper's list is kept elsewhere, and it matches exact names, so a new library has no lane until it is listed. If the lanes are not live, the moves stay within slices 1 to 8, and stop when those are done or blocked, until they are.

**The slices.** Line, run and function counts are as of `4c677d328`, by Task 1's region rule, and so is the open-overlap column. `plan` recomputes the counts at move time, and `preflight` the overlap. Hunks are 30 days. "Spine lines after" includes the pointer lines, one per run: 249 in total.

| # | Library | Rows it takes | Fns | Lines | Runs | Hunks | Open overlap | Suites | Spine fns after | Spine lines after |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `update` | `cmd_version` | 1 | 58 | 1 | 0 | none | ccd-version, ccd-verb-sets | 728 | 45,945 |
| 2 | `coordination` | C5 | 6 | 169 | 5 | 8 | none | ccd-ws-add-child, reclaim-pause-pin | 722 | 45,781 |
| 3 | `accounts-carry` | C1 `_carry`, `cmd_carry` | 4 | 589 | 2 | 5 | none | ccd-carry-dedupe, ccd-swap-carry | 718 | 45,194 |
| 4 | `accounts-lifecycle` | C1 `_lc_`, hibernate | 18 | 770 | 1 | 2 | none | ccd-hibernate, ccd-hibernate-roll | 700 | 44,425 |
| 5 | `docs` | C9 | 8 | 3,709 | 1 | 4 | none | ccd-docs-index, -tree, -show, -fetch, -helper-redactor | 692 | 40,717 |
| 6 | `conversation-transcript` | C3 `_ci_`, `_compact`, `_transcript`, `_auto_compact`, `_pane_tail` | 39 | 1,413 | 19 | 15 | none | session-hook suites, ccd-pane-box-draft | 653 | 39,323 |
| 7 | `mutation` | C2, the rest | 61 | 1,720 | 18 | 20 | none | ccd-helpers-pin, ccd-verb-sets | 592 | 37,621 |
| 8 | `mutation-spawn` | C2 `_spawn`, `cmd_start`, `cmd_ensure`, `cmd_supervise`, `cmd_enable` | 6 | 1,313 | 3 | 34 | none | ccd-spawn-split, -verdict, ccd-supervised-start | 586 | 36,311 |
| 9 | `conversation` | C3, the rest | 77 | 2,878 | 23 | 59 | none | ccd-route-*, ccd-pane-narrow-note | 509 | 33,456 |
| 10 | `workspace-pr` | C4 `_pr_`, `cmd_pr`, `_gh` | 19 | 2,307 | 6 | 29 | none | ccd-pr-state, -open, -queue, -landing | 490 | 31,155 |
| 11 | `workspace-create` | C4 add, rename, rm | 3 | 1,441 | 3 | 56 | none | ccd-ws-add-*, ccd-ws-rename, ccd-ws-rm-attic | 487 | 29,717 |
| 12 | `accounts-swap` | C1 `_swap`, `cmd_swap`, `_auto_swap`, `_rescue`, `_strand`, `_crosspool`, `_limit`, `_tick` | 53 | 3,680 | 14 | 80 | #1114 | ccd-swap-pin, ccd-swap-* | 434 | 26,051 |
| 13 | `accounts` | C1, the rest | 125 | 4,625 | 39 | 107 | #1114 | account-markers-pin, ccd-helpers-pin | 309 | 21,465 |
| 14 | `workspace-archive` | C4 archive, restore, attic, expire | 29 | 1,566 | 4 | 78 | none | ccd-ws-expire-*, ccd-ws-archive-if-no-pane | 280 | 19,903 |
| 15 | `workspace-gc` | C4 gc, audit, leaf | 19 | 1,646 | 10 | 81 | none | ccd-ws-gc, ccd-ws-audit | 261 | 18,267 |
| 16 | `workspace-reap` | C4 reap | 8 | 2,240 | 7 | 79 | none | ccd-ws-reap | 253 | 16,034 |
| 17 | `workspace` | C4, the rest | 78 | 4,365 | 39 | 102 | #1114 | ccd-helpers-pin, ccd-ws-add-dash-id | 175 | 11,708 |
| 18 | `workspace-collect` | C4 collect, `_tmp_` | 64 | 2,512 | 22 | 127 | none | ccd-ws-collect-* | 111 | 9,218 |
| 19 | `workspace-reclaim` | C4 reclaim | 80 | 5,047 | 32 | 297 | none | ccd-child-reclaim-pin, coord-reclaim | 31 | 4,203 |

Row order mixes size and heat on purpose: a 3,709-line slice with 4 hunks is cheaper to land than a 770-line one that is edited daily.

**Exit count per slice, computed at test time from `moveBase` and HEAD, and stored nowhere:** `ccd/ccd` functions = the base count minus the record's; `ccd/contexts.tsv` rows unchanged; `declare -F` count unchanged; `programDump` unchanged; spliced text unchanged apart from the one `__CCD_LIBS` line; `ccd (program)` delta 0; shellcheck group pin unchanged; no library over 6,000 lines.

**Phase B exit:** 32 functions in `ccd/ccd`, all K rows plus `_ccd_lib_load` and `_roster_fp_to`: the table's 31, measured before Task 5, and `_ccd_hash_pick`; under 4,300 lines; 22 shell libraries in the table, every one measured by the growth check. No C10 row is left in `ccd/ccd`, and `sessionhost.sh` is a 23rd library once it exists (Task 7, D-8272).

---

## Phase C: New Code Goes Into The Libraries

### Task 7: The home rule (after slice 5)

**Files:** Modify: `server/test/ccd-contexts.test.ts`, `server/test/growthCheck.ts`, `server/test/growth-check.test.ts`, `CLAUDE.md` (the Rings bullet)

- [ ] **Step 1: Write the failing rows.**

```ts
it('a function new in this diff is defined in a library when its context has one', () => {
  expect(homelessNewFunctions(base, head)).toEqual([]);
});
it('FIXTURE: a new C9 function in ccd/ccd reds; a new C4 function passes until ccd/lib/workspace.sh exists', () => {});
it('FIXTURE: a new C10 function in ccd/ccd passes until ccd/lib/sessionhost.sh exists, then reds', () => {});   // D-8272
it('no library exceeds CCD_LIB_MAX_LINES', () => { /* 6000, one constant, not per file */ });
```

- [ ] **Step 2: Run to see them fail, implement `homelessNewFunctions(base: Tree, head: Tree): string[]`, run, commit.** `CCD_LIB_MAX_LINES` bounds one file and the program row bounds a PR, so a library cannot grow unmeasured. A context has a home once its catch-all library exists: C1 `accounts`, C2 `mutation`, C3 `conversation`, C4 `workspace`, C5 `coordination`, C7 `update`, C9 `docs`, C10 `sessionhost`. A new function may then sit in any library of that context. K has no home and stays in the spine.

Exit count: `homelessNewFunctions` = 0 on `main`.

#### The Session host context (D-8272)

The session-host ruling Q13 adds one context. `ccd/contexts.tsv` names it C10, and `CCD_CONTEXTS` holds it from D-8272 on. The 08-10 spec's ring-context-map table has no C10 row (`CCD_ONLY_CONTEXTS`): the server declares the `SessionHost` port at its consumer, C3 L2 (report §8 A4), and C10 is ccd's adapter for it.

**What it owns:** hosting, observing and driving sessions, behind the one interface of the report's §8 A4.

- `SessionHost.lifecycle` (HOST): `start`, `renew`, `stop`, `verdict` and `receipt`.
- `SessionHost.observe` (OBSERVE): typed live facts. Each is a value, `unmeasured`, `stale` or `absent`, with when it was measured and whether an event or a pane fallback gave it.
- `SessionHost.drive` (DRIVE): `deliver`, `clear`, `compact`, `answer` and `escape`. Each answers `done`, `queued-behind-turn` or `refused(reason)`.
- Inside ccd: `host_verdict`; `host_send_keys` and `host_capture`, the only two functions that touch a pane; and `observe_gate`, which replaces `_pane_for_keystroke`, `_idle_for_keystroke` and `_swap_idle_gate`. `ccd caps` advertises each facet and operation, with `hibernate-fresh` staying the first word.

**Its home, `ccd/lib/sessionhost.sh`.** No slice creates it: no function is C10 at D-8272, and the split tool moves none into it.

- The first PR that adds a C10 function after Task 4 creates the library, as one more word in `__CCD_LIBS`. Before Task 4 a new library is the 26-file edit of #1897, so a C10 function that cannot wait sits in the spine with a C10 row until then.
- Once the library exists, a new C10 function in the spine is red in `homelessNewFunctions`, and `CCD_LIB_MAX_LINES` bounds the file like any other library.
- A function whose row changes to C10 moves into `sessionhost.sh` in the same PR, from the spine or from a slice's library. That changes behaviour, so it is a feature under the lane rule, never part of a slice. Each new cross-context edge goes into `ccd/contexts-edges.tsv` with its reason in the PR.

**Order against slices 6, 9, 12 and 13.** These four slices hold the code the Session host takes over (report §4, "Relation to the file-split plan"). Two rules cover every case:

1. **Ordered first means the slice waits only while that PR is open.** `preflight` already refuses a slice while an open PR has a hunk in its functions. When a slice is next, its lanes are live and no Session host PR overlaps it, the slice moves. The Session host PR then takes the functions from the library.
2. **A Session host PR never waits for a slice.** If a slice moves while one is open, the PR is a feature caught by a move (Coexisting With Open Work) and remakes its edit in the library.

| Slice | Library | What C10 takes from it | Order |
|---|---|---|---|
| 6 | `conversation-transcript` | Compaction and the limit banner: `_auto_compact_check`, `_compact_lock_*` and `_transcript_limit_banner` back `drive.compact` and observe's compaction and limit facts | Slice 6 first. The compaction work comes late in the harness order (report §5 steps 3, 6 and 7), so it takes these functions from `conversation-transcript.sh` |
| 9 | `conversation` | The keystroke gates `_pane_for_keystroke` and `_idle_for_keystroke`, which become `observe_gate` (the report's ruling Q9: the copy-mode, width and draft checks in one shared check that logs each refusal). The `_route_type_*` typists stay C3 and type through `host_send_keys` behind the gate | The gate PR first. It is ruled now, and slice 9 must wait for the per-library lanes (Task 6) anyway |
| 12 | `accounts-swap` | `_swap_idle_gate`, folded into `observe_gate`. The event-based limit sign (report §5 step 7) is a new C10 fact that `_auto_swap_check` reads; `_auto_swap_check` itself stays C1 | The same gate PR first, for the same reason. The step 7 PR comes after, and edits `_auto_swap_check` wherever it sits |
| 13 | `accounts` | `cmd_account_pane`'s private tmux server (`-L ccrc-auth-<id>`). It goes through `host_target`, the one tmux lookup of the report's ruling Q8 (not this plan's Q8). The verb stays C1 | The report's Q8 lookup PR first, since it is ruled now and slice 13 is late in the table. If slice 13 has moved, the lookup PR edits `accounts.sh` |

No other slice changes order, and slices 1 to 5, 7 and 8 move as planned. Slices 7 and 8 hold `_tmux_t`, `_tmux_at` and the spawn code. A Session host PR that takes any of them follows the same two rules.

### Task 8: Close the spine to waivers and both other routes, pay the debt (after Phase B)

**Ruled:** Q8. `ccd/ccd` loses its waiver route and takes a 10-line limit, and this task also closes the two other ways past that limit: the new-file route and the shrink route.

**Files:** Modify: `server/test/growthCheck.ts`, `server/test/growth-check.test.ts`; Delete: every `server/test/growth-waivers/*.json` whose `file` is `ccd/ccd`. Select by that field, not the name: at `5dd21cdb2` there are 9, and one of them is `D-7599-pr-state-pr-form.json`.

- [ ] **Step 1: Write the failing rows.**

```ts
it('a waiver added for ccd/ccd waives nothing, and voids no other entry', () => {
  const parsed = parseWaiverFiles(ledgerOf('ccd/ccd', 'ccd/lib/docs.sh'), growthFiles(base, head, dir));
  expect(parsed.problems).toEqual([]);
  const rows = [row('ccd/ccd', 60), row('ccd/lib/docs.sh', 60), program(120)];
  expect(failing(growthVerdicts(rows, growthOver(rows, []), [], null, [], parsed.entries))).toEqual(['ccd/ccd']);
});
it('a merge-base that still holds the ccd/ccd entries parses clean', () => {
  expect(waiversInDiff(files, baseWithTheNine, head, dir).problems).toEqual([]);
});
it('ccd/ccd may grow by SPINE_LIMIT, the other files by GROWTH_LIMIT', () => {
  expect(growthOver([row('ccd/ccd', SPINE_LIMIT + 1)], [])).toEqual(['ccd/ccd']);
});
it('a new file under L1_L2_NEW_FILE_DIRS passes nothing for ccd/ccd', () => {
  expect(growthOver([row('ccd/ccd', SPINE_LIMIT + 1), program(SPINE_LIMIT + 1)], ['shared/new.ts'])).toEqual(['ccd/ccd']);
});
it('a shrink elsewhere pays for ccd/ccd only when the program total does not grow', () => {
  expect(growthOver([row('ccd/ccd', 100), row('ccd/lib/docs.sh', -100), program(0)], [])).toEqual([]);
  expect(growthOver([row('ccd/ccd', 100), row('ccd/ccrc', -100), program(100)], [])).toEqual(['ccd/ccd', 'ccd (program)']);
});
it('a slice reverted after this task still passes', () => {
  expect(growthOver([row('ccd/ccd', 1000), deletedLib(-1000), program(0)], [])).toEqual([]);
});
it('a named PR over 40 lines passes ccd/ccd and the program, up to its cap', () => {
  const failed = (d: number) => {
    const rows = [row('ccd/ccd', d), program(d)];
    return failing(growthVerdicts(rows, growthOver(rows, []), [exemption({ pr: 1100, file: 'ccd/ccd', cap: 100 })], 1100, []));
  };
  expect(failed(60)).toEqual([]);
  expect(failed(101)).toEqual(['ccd/ccd', 'ccd (program)']);
});
it('a named PR for 11 to 40 lines passes on a cap of 41, and a lower cap is refused', () => {
  const rows = [row('ccd/ccd', 20), program(20)];
  expect(failing(growthVerdicts(rows, growthOver(rows, []), [exemption({ pr: 1100, file: 'ccd/ccd', cap: 41 })], 1100, []))).toEqual([]);
  expect(parseExemptions(list(entry({ file: 'ccd/ccd', cap: 20 })), files, today).entries).toEqual([]);
});
```

- [ ] **Step 2: Implement.** `SPINE_LIMIT = 10`: a new verb's dispatcher row and its capability word fit. `growthOver` no longer lets a new file under `L1_L2_NEW_FILE_DIRS` pass `ccd/ccd`, and it counts another file's shrink for `ccd/ccd` only when `ccd (program)` does not grow, so a revert or `unmove` still passes. The row's words name `SPINE_LIMIT`, not `GROWTH_LIMIT`.

The waiver route closes in `matchWaiver`, not in the parse. `matchWaiver` answers nothing for `ccd/ccd`, and `parseWaiverFiles` goes on accepting it as a listed file. It must not be a parse problem: any problem empties the whole ledger, so one stray `ccd/ccd` entry would void every library's waiver, and so would a merge-base that still holds the 9 entries.

The named-PR exemption in `growth-exemptions.json` stays, the operator's own door and now the only one. An entry on `main` clears both rows: `matchExemptions` clears `ccd/ccd`, and Task 2 Part B's raise clears `ccd (program)`. `parseExemptions` keeps its one rule, a cap above `GROWTH_LIMIT`, so a named exception for 11 to 40 lines still carries a cap of at least 41, and it allows that much. The list is empty today, and each exception is a merged change naming the PR, which has no UI control yet and none in this plan.

Libraries keep `GROWTH_LIMIT` and the waiver ledger, and each is listed (Task 2), so a library waiver is real: 41 lines in `ccd/lib/workspace.sh` is red in the file and in the program until the PR adds one.

- [ ] **Step 3: Delete those waiver files, run, commit.**

Exit count: 0 `ccd/ccd` waivers (9 at `5dd21cdb2`), 1,148 waived lines closed; the new-file route closed and the shrink route bounded for `ccd/ccd`; a named PR over 40 lines passes both rows up to its cap; 12 waivers left at that sha, the `ccd/ccrc` 7 for Phase D.

### Task 9: Retire the old installed files (one stable release after Task 5)

**Files:** Modify: `ccd/ccrc` (`_upd_backup_set`, uninstall), `deploy/deploy.sh`, `ccd/ccd-entry-install.py`, their tests.

- [ ] **Step 1: Check.** Stable has carried an assembled body for one release, and no rollback reaches a pre-assembly body.

- [ ] **Step 2: Remove the three `lib/*.sh` backup rows; the installer deletes the stale files; uninstall keeps its `rm -f`, so a box that skipped a release is still cleaned.**

- [ ] **Step 3: Run the update, uninstall and deploy suites, commit.**

Exit count: 0 files under `~/.local/libexec/ccrc/lib/` on an updated box.

---

## Phase D: `ccd/ccrc` (later; its own gate after Phase B)

`ccd/ccrc` is a different shape, so this phase is sized here and detailed in a follow-up plan once Phase B's exit is met. How its libraries load is decided at this gate (Q7).

**Measured:** 29,210 lines, 551 functions, 26,216 lines in functions and their comments; 70 commits and 904 hunks in 30 days; about 135 test files name it and 28 read it as text; 178 shellcheck findings.

**How it differs from ccd:**

- It has no function map. `ccd/contexts.tsv` covers ccd only.
- It runs from the tree. `~/.local/bin/ccrc` is a shim that `exec`s `~/ccrc/ccd/ccrc`, because it finds `ccrc-doctor-checks`, `ccrc-test`, `history/cli.mjs` and `package.json` through `CCRC_HERE`.
- It has no stamp and no launcher digest. The release `MANIFEST` is what vouches for it.
- `_plat_*` and `_svc_*` (47 functions, 1,111 lines) are byte-pinned against ccd, so they stay in the spine.

**Order,** smallest and least hot first, one PR each, with the pure-move pin generalised (`spliceCcrc`, `ccrcSource()`):

| # | Library | Fns | Lines | Hunks | Suites | Spine lines after |
|---|---|---|---|---|---|---|
| 0 | `ccd/ccrc-contexts.tsv` and its test (the ARCH-34 step), and a second program row, `ccd/ccrc` plus `ccd/lib/ccrc-*.sh` | n/a | 0 | n/a | new census | 29,210 |
| 1 | `ccrc-settings-verb` | 13 | 371 | 16 | ccrc-cli, settings suites | 28,839 |
| 2 | `ccrc-expose` | 7 | 532 | 3 | expose suites | 28,307 |
| 3 | `ccrc-memory` | 8 | 647 | 9 | memory suites | 27,660 |
| 4 | `ccrc-box` | 16 | 874 | 0 | box suites | 26,786 |
| 5 | `ccrc-versions` | 22 | 1,019 | 16 | version suites | 25,767 |
| 6 | `ccrc-uninstall` | 16 | 1,120 | 103 | ccrc-uninstall | 24,647 |
| 7 | `ccrc-models` | 59 | 1,888 | 94 | models suites | 22,759 |
| 8 | `ccrc-codex` | 69 | 2,616 | 138 | codex suites | 20,143 |
| 9 | `ccrc-install` | 63 | 3,869 | 88 | ccrc-install-* | 16,274 |
| 10 | `ccrc-accounts` | 90 | 4,699 | 117 | account suites | 11,575 |
| 11 | `ccrc-update` | 88 | 5,706 | 169 | ccrc-update-*, rollback | 5,869 |

Groups here are by name prefix, so they are a first cut; step 0 replaces them. The `ccrc-update` slice goes last because it runs while the tree under it is replaced.

**Pin per step:** the same three as ccd: spliced text unchanged, `declare -f`/`declare -p` dumps equal, the slice's suites green on the old code first.

**Exit:** `ccd/ccrc` under 6,500 lines; 0 new `ccd/ccrc` waivers; the existing ones deleted (7 at `5dd21cdb2`); `SPINE_LIMIT` extended to it.

**Not in this plan:** `ccd/ccrc-doctor-checks` (11,568 lines), `ccd/session-hook.sh` (6,031) and every TypeScript file.

---

## Operator Rulings

The operator ruled all eight questions on 2026-11-06 (D-8048), each as recommended. These are settled.

**Q1. What does "build time" mean?** Issue #2006 says assembled at build time. The release build only copies files, and `deploy.sh` never goes through it, so assembling there needs a second path.
*Ruled: join at install.* `ccd-entry-install.py`, the one writer of the stamp, assembles on every path, including `deploy.sh`. Every box runs one shell file, covered by the launcher's digest. Redactor files keep their own pins; `transcript.jq` and `carry-dedupe.py` stay separate. It costs Task 5 as planned and one soak on the test box.

**Q2. May `lib-missing`, `lib-unreadable` and `lib-digest` go from an installed box?** After Task 5 the installed body reads no library file, so those refusals cannot happen.
*Ruled: yes.* A tampered install refuses at the launcher with `entry-body-digest`, exit status still 125. This is the one observable change in the programme. Source checkouts keep the three refusals, and `lib-hash` stays, so a box with no hashing tool still refuses. `_pane_scope_detach` and `carry-dedupe.py`'s `route()` source the body by path and skip the launcher, so neither route is digest-checked: today the load checks the library pins there, and after Task 5 nothing does. Task 5 pins only that each gets a whole body.

**Q3. May the shellcheck pin rise once, on a new measure?** The rule is that a pin only goes down. Summing per file would reach 299 on a pure move.
*Ruled: yes, lint the spliced program.* The pin is re-set once to the measured count, about 154, and `ccrc-settings.sh` takes its own pin of 6, so the total goes from 142 to about 160. Like for like that is 136 to about 154, a rise of 18. A move then cannot change the count. It takes one rebaseline with a comment saying why, and the PR lists the new findings by code. The rebaseline is held (Q5), and must land before slice 1.

**Q4. Does each library get its own hot-file lane?** The lane's rule is not in this repository, and a new library has no lane until it is listed there.
*Ruled: one lane per library, and `ccd/ccd` keeps its own.* PRs in different libraries land side by side, and PRs in the same listed library land one at a time. The lanes must be live before about slice 9 (Task 6). The keeper change happens elsewhere, not in this plan or this repository. `ccd/contexts.tsv` needs no lane: rows merge unless adjacent.

**Q5. What may start before the refactor closes?** Tasks 1 and 2 touch no line of `ccd/ccd`, but issue #2006 says to start after the refactor closes.
*Ruled: only the two list fixes, now, in a separate PR.* Every `ccd/lib/*.sh` is measured for growth, and a library edit runs the session-hook suites (Task 2, Part A). Task 1, the lint rebaseline, the program row and Task 3 onward stay held for the refactor, any open PR on `ccd/ccd` and a check of #2006's conditions (Task 0).

**Q6. May Task 5 add one `ccrc doctor` row?** It is new but read-only, and it is what makes "auditable" something a person can run.
*Ruled: yes.* The row reports whether the installed ccd matches this box's tree, and names the first differing section. Its severity is WARN for the first release, and it is skipped where there is no ccd pair (Task 5).

**Q7. How should `ccd/ccrc` be assembled?** It has no install-time render, and `CCRC_HERE` needs it in the tree. Options: load fixed libraries at its foot from the tree, or assemble at the release build so `MANIFEST` covers the one file (a checkout deploy would still run the source form).
*Ruled: decide at the Phase D gate.* Nothing is decided now, and this plan prefers neither option. It blocks only Phase D's detailed plan.

**Q8. May `ccd/ccd` lose the waiver door after Phase B?** Only a named PR in `growth-exemptions.json` could then pass `SPINE_LIMIT`.
*Ruled: yes: close it, at 10 lines, with the operator's named exception only.* New code goes in a library. Task 8 is widened: it also turns off the new-file route for `ccd/ccd`, and limits the shrink route to changes where the program total does not grow.

**Later ruling (2026-11-10, D-8272): does the harness layer get its own context?** This is the session-host report's question 13 (§4, "Relation to the file-split plan"). The plan gave a context a home only in a catch-all library of its own context, and Q8 caps the spine at 10 lines per PR. So the shared gates (`host_send_keys`, `host_capture` and `observe_gate`, with their tables) had no place to go.
*Ruled: a Session host context.* One new context in `ccd/contexts.tsv`, C10, has a home library, `ccd/lib/sessionhost.sh`. It owns hosting, observing and driving behind the one `SessionHost` interface of the report's §8 A4, and its PRs are ordered against slices 6, 9, 12 and 13. Task 7 holds the home and the order.

**For the record:** the second reason in issue #2006 is out of date and should be corrected there. `ccrc restamp` is refused for `ccd/ccd`, and the line-2 stamp no longer conflicts (#1525).
