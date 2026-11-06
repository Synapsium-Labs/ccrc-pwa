# ccd File Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** split `ccd/ccd` (46,002 lines, 729 functions) into a small spine plus fixed libraries in `ccd/lib/`, assembled into one stamped file at install, with no behaviour change; then do the same for `ccd/ccrc`, and make new code land in the libraries.

**Architecture:** the tree holds the spine and the libraries. A source checkout loads the libraries at the spine's foot, as it does today. The installer inlines them at that same point, so the box holds one file that the launcher's digest covers from first byte to last. Functions move in 19 script-generated, byte-for-byte slices, smallest and least hot first, and each slice is its own PR.

**Tech Stack:** bash 5, python3 standard library (the installer, the slice tool), vitest, shellcheck 0.11.0.

**Spec:** the rulings in `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` ("Rulings recorded for ARCH-02b") and O9 (a) in `docs/superpowers/specs/2026-10-19-ccrc-consolidation-wave-design.md`; the scope is issue #2006. There is no separate design spec: the design is the section below.

## Ledger

- **D-8048 (2026-11-06)** — `ccd-file-split-plan`: assemble `ccd/ccd` at install from fixed libraries, move functions in 19 pure slices, tighten the growth check, then repeat for `ccd/ccrc`. Measured at `4c677d328`.

## Global Constraints

- No runtime-sourced ccd siblings: ccd loads only a fixed list, never a file chosen at run time.
- ccd's decisions stay in ccd. Nothing moves to the server.
- Behaviour does not change. The one exception needs a ruling (Q2).
- Each step is a standalone PR with a characterization pin and counted exit criteria (O9 (a)).
- The hot-file lane allows one tracked PR on `ccd/ccd` at a time.
- A move carries functions and their leading comment blocks only. Top-level statements stay in the spine: 18 of them are bare `declare -A` lines, which would turn local inside the load's function.
- The dispatcher, `die`, `_roster_fp_to`, the K rows of `ccd/contexts.tsv` and `_ccd_lib_load` stay in the spine.
- No tracker ids in any repository file, commit or PR body: cite `#n`, ARCH-NN or D-numbers.
- `ccd/ccd` and `ccd/lib/*.sh` run under `set -uo pipefail`, never `-e`.

## Review Focus

1. A feature PR rebased across a move that keeps its old copy of a function. It must go red, never run two definitions (Task 1, `ccd-contexts`' "defines a function twice" row, pinned with a fixture).
2. A live process re-sourcing its body during an update (`_pane_scope_detach` runs `source '$self'`). An assembled body must be whole on its own (Task 5).
3. A library whose bytes would merge lines or end early when inlined: no final newline, two final newlines, a NUL, a top-level `declare` without `-g`, a top-level `$1` (Tasks 4 and 5).
4. Rollback to a body that still pins library files, with those files present or absent (Task 5).
5. A full temp or root filesystem at start: the load holds no here-string today, and the assembled start must stay as free of temp files (Task 5 keeps the existing row).

## What Is Measured And What Is Inferred

Everything here was measured at `4c677d328` unless it says otherwise. Hunk counts use git's hunk-header attribution (`git log -p -U0`, the last column-0 name before the hunk), so they are approximate: a hunk in a comment block between two functions counts for the one above it. Timings come from a development Mac (bash 5.3, perl `shasum`), not the fleet box.

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
| Text scanners | 150 test files read ccd through `ccdSource()`, which splices each `# @ccd-lib:<id>` region back. Seven files read the file on purpose. The guard matches only `readFileSync(CCD, …)`, so `routing-references.test.ts` reads `ccd/ccd` past it. `ccd-ws-add-base.test.ts` builds an older ccd by editing the file. | The one-text view exists and is mostly enforced. Each moved run needs a pointer line (162 at the end, measured in the spike). |
| `ccd/contexts.tsv` | 850 rows, 2 columns, in definition order. | Every move reorders rows, so the tool writes them. |
| Growth check | Lists `ccd/ccd`, `ccd/lib/disk-retention.sh` and `ccd/ccrc`, not the other two libraries. A waiver only counts in the PR that adds it. | `train-proof.sh` and `delegation-lease.sh` grow unmeasured today. 19 waivers: `ccd/ccd` 8 (1,059 lines), `ccd/ccrc` 6 (1,750), `session-hook.sh` 4 (652), `watch.ts` 1 (225). |
| Shellcheck ratchet | One pin for `ccd/ccd + ccd/lib`, 142 findings, summed per file. Its header says a split "does not trip it". | **False.** See the spike. |
| Citations (`citations.test.ts`) | Lines a branch adds may hold no numeric citation. | `ccd/ccd` has 150 such lines; 159 citations sit in moved regions, so a plain move goes red. |
| CI selection | `SESSION_HOOK_TRIGGERS` matches `ccd/ccd` exactly. | An edit in a library skips the session-hook suites in a fast PR. |

**Measured: the spike.** A throwaway script in a scratch directory (nothing committed) cut every non-K function into 19 files and inlined the three existing libraries.

- Only `_roster_fp_to` and `_ccd_lib_load` run during load (`bash -x` with a stub roster, 558 traced lines; `die` on the refusal path, `_plat_sha256` on the installed arm). So 698 functions can load at the foot.
- All 19 files loaded at the foot, `eval`ed inside a function: `declare -f` (32,716 lines) and `declare -p` (229 variables) matched today's source form, apart from one path-derived value caused by the scratch directory.
- All 22 libraries inlined at the foot instead of `eval`ed: the same match. `BASH_SOURCE[0]` inside an `eval`-defined function names the evaluating file, so it holds in both forms.
- The end-state spine is 4,365 lines and 31 functions, before pointer lines.
- Shellcheck summed per file goes from 142 to **299** on a pure move, because a variable set in the spine and read in a library reads as unused. C9 alone adds 0; C5 + C7 add 5.
- Shellcheck over the spliced program counts 154, in 57 s. That text is unchanged by a pure move, so the count cannot move.
- Start time: load 90 to 100 ms in both forms; hashing the three libraries 54 ms more; parse alone 61 ms.

**Inferred, not measured**

- The hash saving on the fleet box. `sha256sum` is C, so it will be smaller than 54 ms. Task 5 measures it.
- Merge conflicts. The line-2 conflict is already gone, and git merges non-overlapping hunks in one file. The real relief is that the lane serialises per file, so feature PRs in different libraries stop queueing behind each other (needs Q4).
- The spine stays hot. In the 32 commits since 2026-10-27, 16 hunks hit the dispatcher `case`. A new verb still edits the spine, by a line or two.
- **CI time does not fall.** Every ccd test sources the whole program, so the test map selects the same tests. The earlier claim that this split helps CI is not supported.
- Shellcheck memory does not fall if Q3 goes as recommended: the spliced pass still peaks near 6.2 GB. One 4,999-line library peaked at 1.0 GB.

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
3. The stamp covers the whole file, and the launcher's digest covers the stamped bytes. That is stronger than today: no byte on disk is outside the launcher's digest, and nothing is `eval`ed.
4. `ccd-entry-install.py --verify-body <tree> <home>` rebuilds the body and compares bytes. `ccrc doctor` shows that as one row (Q6).
5. `grep -n 'ccd-section ' ~/.local/libexec/ccrc/ccd` is the file's table of contents.

The redactor pins stay: node runs those two files, so they stay files.

## Coexisting With Open Work

- **Tasks 1 and 2 touch no `ccd/ccd` line,** so they can start now, outside the lane.
- **Tasks 3 to 5 and the slices need the lane.** Open on `ccd/ccd` at `4c677d328`: #1114 (169+ lines), #2347 and #2307 (3 lines each, spine only). #1611 touches `ccd/ccrc` only.
- **A move is regenerated, never rebased.** `ccd-split.py move <slice>` rebuilds the PR from current `main` in seconds, so a move holds no conflict of its own.
- **A move yields to features.** `preflight` refuses a slice while any open PR has a hunk in one of its functions. The move waits; the feature does not.
- **The lane alternates.** After a move lands, the next waiting feature PR takes the lane before the next move.
- **A feature PR caught by a move** remakes its edit in the library, which holds the same bytes, and drops its `ccd/ccd` hunk. `patch` cannot do this for it: #1114's diff applied only 3 of 10 hunks to `accounts-swap` (measured). If the PR keeps the old function, `ccd-contexts` goes red.
- **#1114 today overlaps** `accounts-swap`, `accounts` and `workspace` (`_ws_slug_valid`). The Accounts PRs overlap no slice.

## Rollback

| Step | Rollback | Box state |
|---|---|---|
| Tasks 1, 2, 7, 8 | `git revert` | None. Tests and CI only. |
| Task 3 | `git revert` | None. Comments only. |
| Task 4 | `git revert` | None. Installed bytes do not change, apart from one array line. |
| Task 5 | `ccrc rollback` restores body and launcher from the backup; then `git revert` | The three old library files stay on the box and in the backup rows until Task 9, so a restored body finds its pinned bytes. `_upd_backup_copy` skips an absent file. |
| Each slice (Task 6) | `git revert` of the one squashed commit, or `ccd-split.py unmove <library>` if later PRs edited the library | None. A pure move changes no data. Every release holds a whole program. |
| Task 9 | `git revert`, after one stable release has passed | Reinstates the rows; old files were already gone. |

There is no switch to install unassembled: two install shapes would be one more thing to test.

---

## Phase 0: Gate

### Task 0: Confirm the start conditions

This gates Task 3 onward. Tasks 1 and 2 touch no line of `ccd/ccd`, so they need only Q5 (and Task 2 needs Q3).

**Files:** none.

- [ ] **Step 1: Read the open PRs on the shared files.**

Run: `gh pr list --repo Synapsium-Labs/ccrc-pwa --state open --limit 100 --json number,files --jq '.[] | select(any(.files[]; .path=="ccd/ccd")) | .number'`
Expected: none of #1114, #2307, #2347 listed.

- [ ] **Step 2: Confirm issue #2006's own conditions.** The W5 ccd series and the K5/K16 ccd tasks have merged, and no other ccd programme is open. Not measured here. A programme still open stops Task 3 and goes to the operator.

- [ ] **Step 3: Get the rulings.** Q1, Q2 and Q6 are answered before Task 5.

---

## Phase A: The Ground (no function moves)

### Task 1: The pure-move pin and the slice tool

**Files:**
- Create: `.github/ci/ccd-split.py`, `.github/ci/ccd-split-slices.tsv`, `server/test/ccd-split-pin.test.ts`, `server/test/ccdSplit.ts`
- Modify: `.github/ci/fast-plan.mjs` (guard list), `server/test/ccdWsHelpers.ts` (export `spliceCcd`)

**Interfaces:**
- Produces: `spliceCcd(main: string, libs: readonly string[]): string`, the body of today's `ccdSource()` as a pure function.
- Produces: `.github/ci/ccd-split.py plan|preflight|move|unmove <slice>`. `plan` prints functions, lines, runs and citations. `preflight` exits 0 only when no open PR has a hunk in a slice function; it reads PR heads with `git fetch origin pull/<n>/head`, because `gh pr diff` gave nothing usable for these PRs (measured). `move` writes the library, pointer lines, the `__CCD_LIBS` word and reordered `contexts.tsv` rows. `unmove` puts each region back at its pointer. Both refuse `die`, `_roster_fp_to`, `_ccd_lib_load` and every K row.
- Produces: `.github/ci/ccd-split-slices.tsv`, rows `<move-order>\t<library>\t<context>\t<name-regex>`. A function belongs to the first row in file order that matches, so the catch-all rows sit last in the file whatever their move order.
- Produces: `server/test/ccd-split-records/<NN>-<library>.json`: `{library, functions: string[], dumpSha256, spineFunctionsAfter, spineLinesMax}`.

- [ ] **Step 1: Write the failing tests** in `ccd-split-pin.test.ts`.

```ts
it('FIXTURE: a diff that adds a pointer is a pure move', () => {
  expect(pureMoveVerdict(base, movedByteForByte)).toEqual({ pure: true, differing: [] });
  expect(pureMoveVerdict(base, movedAndEdited).pure).toBe(false);
});
it('FIXTURE: a diff with no new pointer is not judged', () => {
  expect(pureMoveVerdict(base, featureEdit)).toBeNull();
});
it('FIXTURE: a rebase that keeps the old function reds as a double definition', () => {
  expect(duplicateDefinitions(mainAndLibWithSameFn)).toEqual(['fa']);
});
it('REAL: this diff, against the merge-base, is pure if it adds a pointer', () => { /* skips without origin/main, as growth-check does */ });
it('REAL: a record added in this diff holds', () => { /* dump digest, spine counts */ });
```

- [ ] **Step 2: Run them to see them fail.**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-split-pin.test.ts --maxWorkers=2`
Expected: FAIL, `pureMoveVerdict` not defined.

- [ ] **Step 3: Implement** `pureMoveVerdict(base: Tree, head: Tree): {pure: boolean, differing: string[]} | null` and `duplicateDefinitions(tree: Tree): string[]` in `ccdSplit.ts`. Purity: `spliceCcd` of both sides, with `# @ccd-lib:` lines and each library's header block (everything above its first marker) removed, compares byte for byte. Records follow `waiversAdded`: only a file the merge-base does not hold counts.

- [ ] **Step 4: Implement `ccd-split.py`.** Regions are `name() {` through the first column-0 `}`, plus the `#` block directly above; the spike's rule, and the rule `ccdCallGraph` already relies on. Fill the slice table from the table in Task 6.

- [ ] **Step 5: Prove the tool on a scratch copy.**

Run: `.github/ci/ccd-split.py plan docs`
Expected: 8 functions, about 3,702 lines, 1 run. Then `move` every slice in a scratch copy and check `spliceCcd` output equals today's.

- [ ] **Step 6: Run the tests, then commit.**

Exit count: `ccd/ccd` unchanged, 729 functions. The pin suite runs on every PR through the guard list.

### Task 2: The ratchet reads the program as one, and CI follows the libraries

**Files:**
- Modify: `server/test/shellcheck-ratchet.test.ts`, `server/test/shellcheck-baseline.json`, `.github/ci/fast-plan.mjs`, `server/test/ci-fast-plan.test.ts`, `server/test/growth-check.test.ts`

**Interfaces:**
- Consumes: `spliceCcd`.
- Produces: the `ccd/ccd + ccd/lib` pin measured over one spliced temp file, findings mapped back to `<file>:<line>`.

- [ ] **Step 1: Write the failing rows.**

```ts
it('FIXTURE: moving a function between ccd/ccd and a library leaves the count alone', () => { /* same count both ways */ });
it('REAL: a finding names the file and line it came from, not the spliced text', () => {});
it('a change under ccd/lib/ runs the session-hook suites', () => {
  expect(fastSelection({ ...args, changed: ['ccd/lib/docs.sh'] }).hook).toBe(true);
});
it('every ccd/lib/*.sh shell library is a growth-listed file', () => {
  expect(GROWTH_FILES).toEqual(expect.arrayContaining(['ccd/lib/train-proof.sh', 'ccd/lib/delegation-lease.sh']));
});
```

- [ ] **Step 2: Run to see them fail.**

Run: `cd server && ./node_modules/.bin/vitest run test/shellcheck-ratchet.test.ts test/ci-fast-plan.test.ts test/growth-check.test.ts --maxWorkers=2`

- [ ] **Step 3: Change the ratchet** (after Q3). `pinKey` keeps the group; the group is linted once, over `spliceCcd`. `ccd/lib/ccrc-settings.sh` takes its own pin of 6, because the sweeps source it and ccd does not. Correct the header's claim.

- [ ] **Step 4: Rebaseline** the group from 142 to the measured count (154 at `4c677d328`), with the `codes` map the run prints. The comment on the pin says why this one rise happened.

- [ ] **Step 5: Change the two lists.** `SESSION_HOOK_TRIGGERS` gains a `ccd/lib/` prefix match. `GROWTH_FILES` gains the two missing libraries.

- [ ] **Step 6: Run, then commit.**

Exit count: group pin = measured value; total ratchet files unchanged plus 1; `ccd/ccd` unchanged.

### Task 3: Citations out of `ccd/ccd`

**Files:** Modify: `ccd/ccd` (comments only).

- [ ] **Step 1: Pin.** The pin for this step is `declare -f` and `declare -p` dumps before and after, on a fixture home. `bash` drops comments from the dump, so a comment edit cannot move it.

- [ ] **Step 2: Rewrite** each `ccd:NNNN` and `<file>.<ext>:NN` in `ccd/ccd` to a symbol (`ccd#_ws_least_loaded`), following the header of `citations.test.ts`.

- [ ] **Step 3: Verify and commit.**

Run: `grep -cE 'ccd:[0-9]{3,5}\b|\.(ts|tsx|mjs|sh):[0-9]+\b' ccd/ccd`
Expected: `0` (150 today). `BASELINE` in `citations.test.ts` drops by the same count in this PR.

Exit count: 0 citation lines in `ccd/ccd`; `declare -f` dump byte-identical.

### Task 4: One library table

Task 5 ends the per-file install, so only the tree side needs the table. The backup rows in `ccd/ccrc` and `deploy/deploy.sh` stay as they are until Task 9.

**Files:**
- Modify: `ccd/ccd` (`__CCD_LIBS`, `_ccd_lib_load`), `ccd/ccd-entry-install.py`, `server/test/consolidationCensus.ts`, `server/test/ccdWsHelpers.ts`, `server/test/ccd-lib-load.test.ts`, `server/test/ccd-entry-install.test.ts`, `server/test/ccd-install-stamp.test.ts`, `server/test/install-census.test.ts`, `server/test/installTreeFixture.ts`, `server/test/build-release.test.ts`, `server/test/ownership.test.ts`, `server/test/routing-references.test.ts`, `agent/test/ccd-entry-exec.test.ts`, `agent/test/deploy-verify.test.ts`
- Create: `server/test/ccd-lib-shape.test.ts`

**Interfaces:**
- Produces: `read_lib_table(body: bytes) -> list[str]` in the installer, from exactly one line matching `^__CCD_LIBS=\(([a-z0-9 -]+)\)( .*)?$`; any other count refuses.
- Produces: `ccdLibNames(root?: string): string[]` in `consolidationCensus.ts`, the same line read in TS. `CCD_LIB_FILES`, `CCD_LIBS` and every hard-coded trio in a test derive from it.

- [ ] **Step 1: Write the failing rows.**

```ts
it('every test-side library list follows the table', () => { /* a fixture tree with a fourth word */ });
it('no library sets a global with a bare declare', () => {
  expect(topLevelDeclares(ccdLibNames())).toEqual([]);   // needs -g: the load is inside a function, inlining is not
});
it('no library reads a positional or returns at its top level', () => {
  expect(topLevelPositionals(ccdLibNames())).toEqual([]);
});
it('no test reads ccd/ccd as text past ccdSource(), in any spelling', () => { /* widens the guard in ccd-lib-load.test.ts */ });
```

The top-level split reuses `census-w5/accountMarkers.ts`'s reader.

- [ ] **Step 2: Run to see them fail, then implement.** `_ccd_lib_load` builds its file list from `__CCD_LIBS`; the three pin lines stay until Task 5. Same libraries published, same order, same refusal words.

- [ ] **Step 3: Verify.**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-lib-load.test.ts test/ccd-lib-shape.test.ts test/ccd-entry-install.test.ts test/ccd-install-stamp.test.ts test/install-census.test.ts test/ownership.test.ts test/routing-references.test.ts --maxWorkers=2`, then `cd agent && ./node_modules/.bin/vitest run test/ccd-entry-exec.test.ts test/deploy-verify.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 4: Commit.**

Exit count: 0 test files hard-code the three library names as a list; `ccd/ccd` 729 functions; the `declare -f` dump differs by `_ccd_lib_load` alone.

### Task 5: Assemble at install

**Depends on:** Q1, Q2, Q6.

**Files:**
- Modify: `ccd/ccd-entry-install.py`, `ccd/ccd` (foot), `ccd/ccd-entry.py` (comment), `ccd/ccrc-doctor-checks`, `README.md` (the install-stamp section), `server/test/ccdWsHelpers.ts`, `server/test/ccd-lib-load.test.ts`, `server/test/ccd-install-stamp.test.ts`, `server/test/ccd-entry-install.test.ts`, `agent/test/deploy-verify.test.ts`
- Create: `server/test/ccd-assembled-parity.test.ts`

**Interfaces:**
- Produces: `assemble_body(tree: str, body: bytes) -> bytes`: pins rendered, sections inlined, not yet stamped. `stamp_body` then runs as it does today.
- Produces: CLI `--print-body <tree>` (stamped bytes on stdout) and `--verify-body <tree> <home>` (exit 0 same, 1 differ, naming the first differing section).
- Produces: `_ccd_hash_pick` in `ccd/ccd`: the tool selection lifted from `_ccd_lib_load`, keeping `__CCD_HASH_CMD` and the `lib-hash` refusal. The installer's replacement for the load line runs it and sets `__CCD_LAYOUT=installed`.
- Consumes: `read_lib_table`.
- Changes: `installedCcdBody` in `ccdWsHelpers.ts` shells out to `--print-body`, so the assembler has one implementation. Memoised by tree digest.

- [ ] **Step 1: Write the failing parity pin.**

```ts
it('source form and assembled form define the same program', () => {
  expect(dump(assembled)).toEqual(dump(sourceForm));   // declare -f and declare -p, a fixture HOME
});
it('every section header names its bytes', () => { /* sha256 and lines match the library; lines are whole */ });
it('the assembled body is deterministic', () => { expect(render()).toBe(render()); });
it('the same tree verifies; a changed section does not', () => {});
it('an assembled body re-sourced by _pane_scope_detach is the whole program', () => {});
it('an unusable TMPDIR does not refuse the assembled start', () => {});
it('bash -n accepts the assembled bytes before anything is published', () => {});
it('a body restored from a pre-assembly backup finds its pinned libraries, present or restored', () => {});
```

- [ ] **Step 2: Run to see them fail.**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-assembled-parity.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement.** The installer stops publishing `lib/*.sh`, and leaves any already there. The three `__CCD_LIB*_SHA256` lines and the installed arm of `_ccd_lib_load` go. `read_lib`'s one-newline, no-NUL rule stays. `_upd_backup_set` keeps its rows. `install` refuses unless `bash -n` passes on the staged bytes. The doctor row calls `--verify-body`.

- [ ] **Step 4: Turn the `lib-*` rows.** In `ccd-lib-load.test.ts`, the installed-entry refusals for a tampered library become the launcher's `entry-` digest refusal on a tampered body (Q2). The source-arm rows stay.

- [ ] **Step 5: Measure, and put the numbers in the PR.** `ccd version` start time before and after, on the test box, ten runs.

- [ ] **Step 6: Run the install, lib-load, stamp, deploy and parity suites, then commit.**

Exit count: 1 file holds ccd on an installed box; 0 `eval` of a library in an installed run; `declare -f` and `declare -p` dumps equal across both forms; 729 functions.

- [ ] **Step 7: Soak.** The release runs on the test box for one full update and one `ccrc rollback` before the fleet takes it. The operator rolls it; a session never does.

---

## Phase B: The Moves

### Task 6: One slice (repeat in table order, one PR each)

**Files:**
- Create: `ccd/lib/<library>.sh`, `server/test/ccd-split-records/<NN>-<library>.json`
- Modify: `ccd/ccd`, `ccd/contexts.tsv`

**Interfaces:**
- Consumes: `ccd-split.py`, the pure-move pin, `__CCD_LIBS`.

- [ ] **Step 1: Preflight on a fresh `origin/main`.**

Run: `.github/ci/ccd-split.py preflight <slice>`
Expected: exit 0. Exit 1 names the PRs; skip to the next clear slice or wait.

- [ ] **Step 2: Take the lane.** One tracked PR on `ccd/ccd`, per the lane rule.

- [ ] **Step 3: First commit: the pin.** Add the record with `ccd-split.py plan <slice> --record`. Run the slice's suites below on the old code.
Expected: PASS, nothing moved yet.

- [ ] **Step 4: Second commit: the move.**

Run: `.github/ci/ccd-split.py move <slice>`. No hand edit.

- [ ] **Step 5: Verify.**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-split-pin.test.ts test/ccd-assembled-parity.test.ts test/ccd-contexts.test.ts test/ccd-lib-shape.test.ts <slice suites> --maxWorkers=2`
Expected: PASS; no new line in `ccd/contexts-edges.tsv`. A one-liner's region can widen to the next definition, so a move may change an edge: that is a finding to explain, not to add.

- [ ] **Step 6: Open the PR.** The body gives the exit counts. If `main` moved, re-run from Step 1 rather than rebasing.

**The slices.** Line and function counts are today's; `plan` recomputes them at move time, and the record holds the real figures. Hunks are 30 days. Pointer lines add about 162 to the spine in total.

| # | Library | Rows it takes | Fns | Lines | Hunks | Open overlap | Suites | Spine fns after | Spine lines after |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `update` | `cmd_version` | 1 | 58 | 0 | none | ccd-version, ccd-verb-sets | 728 | 45,944 |
| 2 | `coordination` | C5 | 6 | 169 | 8 | none | ccd-ws-add-child, reclaim-pause-pin | 722 | 45,775 |
| 3 | `accounts-carry` | C1 `_carry`, `cmd_carry` | 4 | 587 | 5 | none | ccd-carry-dedupe, ccd-swap-carry | 718 | 45,188 |
| 4 | `accounts-lifecycle` | C1 `_lc_`, hibernate | 18 | 755 | 2 | none | ccd-hibernate, ccd-hibernate-roll | 700 | 44,433 |
| 5 | `docs` | C9 | 8 | 3,702 | 4 | none | ccd-docs-index, -tree, -show, -fetch, -helper-redactor | 692 | 40,731 |
| 6 | `conversation-transcript` | C3 `_ci_`, `_compact`, `_transcript`, `_auto_compact`, `_pane_tail` | 39 | 1,393 | 15 | none | session-hook suites, ccd-pane-box-draft | 653 | 39,338 |
| 7 | `mutation` | C2, the rest | 61 | 1,704 | 20 | none | ccd-helpers-pin, ccd-verb-sets | 592 | 37,634 |
| 8 | `mutation-spawn` | C2 `_spawn`, `cmd_start`, `cmd_ensure`, `cmd_supervise`, `cmd_enable` | 6 | 1,310 | 34 | none | ccd-spawn-split, -verdict, ccd-supervised-start | 586 | 36,324 |
| 9 | `conversation` | C3, the rest | 77 | 2,825 | 59 | none | ccd-route-*, ccd-pane-narrow-note | 509 | 33,499 |
| 10 | `workspace-pr` | C4 `_pr_`, `cmd_pr`, `_gh` | 19 | 2,294 | 29 | none | ccd-pr-state, -open, -queue, -landing | 490 | 31,205 |
| 11 | `workspace-create` | C4 add, rename, rm | 3 | 1,441 | 56 | none | ccd-ws-add-*, ccd-ws-rename, ccd-ws-rm-attic | 487 | 29,764 |
| 12 | `accounts-swap` | C1 `_swap`, `cmd_swap`, `_auto_swap`, `_rescue`, `_strand`, `_crosspool`, `_limit`, `_tick` | 53 | 3,640 | 80 | #1114 | ccd-swap-pin, ccd-swap-* | 434 | 26,124 |
| 13 | `accounts` | C1, the rest | 125 | 4,589 | 107 | #1114 | account-markers-pin, ccd-helpers-pin | 309 | 21,535 |
| 14 | `workspace-archive` | C4 archive, restore, attic, expire | 29 | 1,543 | 78 | none | ccd-ws-expire-*, ccd-ws-archive-if-no-pane | 280 | 19,992 |
| 15 | `workspace-gc` | C4 gc, audit, leaf | 19 | 1,639 | 81 | none | ccd-ws-gc, ccd-ws-audit | 261 | 18,353 |
| 16 | `workspace-reap` | C4 reap | 8 | 2,239 | 79 | none | ccd-ws-reap | 253 | 16,114 |
| 17 | `workspace` | C4, the rest | 78 | 4,334 | 102 | #1114 | ccd-helpers-pin, ccd-ws-add-dash-id | 175 | 11,780 |
| 18 | `workspace-collect` | C4 collect, `_tmp_` | 64 | 2,416 | 127 | none | ccd-ws-collect-* | 111 | 9,364 |
| 19 | `workspace-reclaim` | C4 reclaim | 80 | 4,999 | 297 | none | ccd-child-reclaim-pin, coord-reclaim | 31 | 4,365 |

Row order mixes size and heat on purpose: a 3,702-line slice with 4 hunks is cheaper to land than a 755-line one that is edited daily. `shared/hook-helpers.mjs` changes in row 13's PR, so it reads the spliced program. `ccd-ws-add-base.test.ts` changes in row 11's PR, because `cmd_ws_add` leaves the file it edits.

**Exit count per slice, all asserted by the record:** `ccd/ccd` functions = the "after" column as recomputed; `ccd/contexts.tsv` rows unchanged (850 plus any feature rows); `declare -F` count unchanged; spliced text unchanged; shellcheck group pin unchanged; no library over 6,000 lines.

**Phase B exit:** 31 functions in `ccd/ccd`, all K rows plus `_ccd_lib_load` and `_roster_fp_to`; under 4,700 lines; 22 shell libraries in the table.

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
it('no library exceeds CCD_LIB_MAX_LINES', () => { /* 6000, one constant, not per file */ });
```

- [ ] **Step 2: Run to see them fail, implement `homelessNewFunctions(base: Tree, head: Tree): string[]`, run, commit.** A context has a home once its catch-all library exists: C1 `accounts`, C2 `mutation`, C3 `conversation`, C4 `workspace`, C5 `coordination`, C7 `update`, C9 `docs`. A new function may then sit in any library of that context. K has no home and stays in the spine.

Exit count: `homelessNewFunctions` = 0 on `main`.

### Task 8: Close the spine to waivers, pay the debt (after Phase B)

**Depends on:** Q8.

**Files:** Modify: `server/test/growthCheck.ts`, `server/test/growth-check.test.ts`; Delete: the 8 `server/test/growth-waivers/*-ccd-ccd.json` files.

- [ ] **Step 1: Write the failing rows.**

```ts
it('a waiver added for ccd/ccd waives nothing', () => {
  expect(parseWaiverFiles(newCcdCcdEntry, GROWTH_FILES).entries).toEqual([]);
});
it('ccd/ccd may grow by SPINE_LIMIT, the other files by GROWTH_LIMIT', () => {
  expect(growthOver([row('ccd/ccd', SPINE_LIMIT + 1)], [])).toEqual(['ccd/ccd']);
});
```

- [ ] **Step 2: Implement.** `SPINE_LIMIT = 10`: a new verb's dispatcher row and its capability word fit. The named-PR exemption in `growth-exemptions.json` stays, the operator's own door. Waivers stay open for libraries.

- [ ] **Step 3: Delete the 8 waiver files, run, commit.**

Exit count: 0 `ccd/ccd` waivers (8 today), 1,059 waived lines closed; 11 waivers left, the `ccd/ccrc` 6 for Phase D.

### Task 9: Retire the old installed files (one stable release after Task 5)

**Files:** Modify: `ccd/ccrc` (`_upd_backup_set`, uninstall), `deploy/deploy.sh`, `ccd/ccd-entry-install.py`, their tests.

- [ ] **Step 1: Check.** Stable has carried an assembled body for one release, and no rollback reaches a pre-assembly body.

- [ ] **Step 2: Remove the three `lib/*.sh` backup rows; the installer deletes the stale files; uninstall keeps its `rm -f`, so a box that skipped a release is still cleaned.**

- [ ] **Step 3: Run the update, uninstall and deploy suites, commit.**

Exit count: 0 files under `~/.local/libexec/ccrc/lib/` on an updated box.

---

## Phase D: `ccd/ccrc` (later; its own gate after Phase B)

`ccd/ccrc` is a different shape, so this phase is sized here and detailed in a follow-up plan once Phase B's exit is met.

**Measured:** 29,210 lines, 551 functions, 26,216 lines in functions and their comments; 70 commits and 904 hunks in 30 days; about 135 test files name it and 28 read it as text; 178 shellcheck findings.

**How it differs from ccd:**

- It has no function map. `ccd/contexts.tsv` covers ccd only.
- It runs from the tree. `~/.local/bin/ccrc` is a shim that `exec`s `~/ccrc/ccd/ccrc`, because it finds `ccrc-doctor-checks`, `ccrc-test`, `history/cli.mjs` and `package.json` through `CCRC_HERE`.
- It has no stamp and no launcher digest. The release `MANIFEST` is what vouches for it.
- `_plat_*` and `_svc_*` (47 functions, 1,111 lines) are byte-pinned against ccd, so they stay in the spine.

**Order,** smallest and least hot first, one PR each, with the pure-move pin generalised (`spliceCcrc`, `ccrcSource()`):

| # | Library | Fns | Lines | Hunks | Suites | Spine lines after |
|---|---|---|---|---|---|---|
| 0 | `ccd/ccrc-contexts.tsv` and its test (the ARCH-34 step) | n/a | 0 | n/a | new census | 29,210 |
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

**Exit:** `ccd/ccrc` under 6,500 lines; 0 new `ccd/ccrc` waivers; the 6 existing ones deleted; `SPINE_LIMIT` extended to it.

**Not in this plan:** `ccd/ccrc-doctor-checks` (11,568 lines), `ccd/session-hook.sh` (6,031) and every TypeScript file.

---

## Open Questions For The Operator

**Q1. What does "build time" mean?** Issue #2006 says assembled at build time. The release build only copies files, and `deploy.sh` never goes through it, so assembling there needs a second path.
*Recommendation:* assemble in `ccd-entry-install.py`, the one writer of the stamp, on every path.

**Q2. May `lib-missing`, `lib-unreadable` and `lib-digest` go from an installed box?** After Task 5 the installed body reads no library file, so those refusals cannot happen. A tampered body refuses as `entry-` at the launcher instead. This is the one observable change in the programme. The source-checkout arm keeps them.
*Recommendation:* yes. The disk-retention model's aim, that every byte run is pinned, holds more strongly.

**Q3. May the shellcheck pin rise once, from 142 to about 154, on a new measure?** `ccrc-settings.sh` would also take its own pin of 6. The rule is that a pin only goes down. Summing per file would reach 299 on a pure move. The alternative is about 157 `# shellcheck disable` lines with reasons, which keeps the 142-style number and lets per-file lint drop to about 1 GB of memory.
*Recommendation:* yes, lint the spliced program. A move then cannot change the count, by construction.

**Q4. Does each library get its own hot-file lane?** The lane's rule is not in this repository. If `ccd/lib/*.sh` stays under one lane, the split gives feature work no queueing relief.
*Recommendation:* one lane per library, and `ccd/ccd` keeps its lane. `ccd/contexts.tsv` needs no lane: rows merge unless adjacent.

**Q5. May Tasks 1 and 2 start before #1114 and the Accounts work land?** They touch no line of `ccd/ccd`. Issue #2006 says no other ccd programme may be open before starting.
*Recommendation:* yes for Tasks 1 and 2, and hold Task 3 onward for the gate.

**Q6. May Task 5 add one `ccrc doctor` row?** It is new but read-only, and it is what makes "auditable" something a person can run.
*Recommendation:* yes.

**Q7. How should `ccd/ccrc` be assembled?** It has no install-time render, and `CCRC_HERE` needs it in the tree. Options: load fixed libraries at its foot from the tree, or assemble at the release build so `MANIFEST` covers the one file (a checkout deploy would still run the source form).
*Recommendation:* decide at the Phase D gate, leaning to the release build. It need not block anything before then.

**Q8. May `ccd/ccd` lose the waiver door after Phase B?** Only a named PR in `growth-exemptions.json` could then pass `SPINE_LIMIT`.
*Recommendation:* yes. That door already answers to the operator, and waivers are how the file grew.

**For the record:** the second reason in issue #2006 is out of date and should be corrected there. `ccrc restamp` is refused for `ccd/ccd`, and the line-2 stamp no longer conflicts (#1525).
