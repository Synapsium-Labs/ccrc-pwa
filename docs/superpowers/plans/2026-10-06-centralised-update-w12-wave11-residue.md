# Centralised update management, wave 12: wave 11's test and prose residue — D3 Linux-only, D-3984's filter pinned, NEW sweep + S10 pinned, S0 named, the plan's bookkeeping (R19, R18 c–e): Implementation Plan

The coordinator scoped wave 12 on 2026-10-06 02:45 UTC (programme ledger, "wave 12 scoped narrow"), after review 281 ruled at 02:35 and #287 merged as `d2bac7ae` at 02:37 (v0.0.92). Run 282 opened at 02:38 with deviation block 4068 to 4087. This plan was drafted by workflow `wf_a11d694f-c70` (prototype, attack, revise) on 2026-10-06, from `main` at `d2bac7ae61c17efbbb1eec4a33477a424480b8b4`. Its file is `docs/superpowers/plans/2026-10-06-centralised-update-w12-wave11-residue.md`.

**Wave 12 changes NO shipped runtime code.** It edits tests, adds one frozen fixture, changes one README sentence, and amends the merged wave-11 plan's prose. The 02:35 ruling says R19 lands before `stable` is promoted "with F1 to F4 and R18(e)": R18(e)'s part of that is the prose point on D-3988's stale-pid sentence, which is Task 4's A8 (item 3's warning, the other half of the ledger's R18(e), was moved to wave 13 at 02:45). Everything lands in one PR, so `stable` waits on that PR as a whole. R19 comes first (Tasks 1–3); R18(c)–(e) follow (Task 4).

One line per task:
- **Task 1.** R19(a): `ccrc-update.test.ts`'s D3 becomes `itLinux`, because BSD stat refuses its GNU `stat -c %s` shim. D3d already covers Darwin with the real `_plat_size`. The file's section comment and the wave-11 plan's ruling get matching notes (D-4068).
- **Task 2.** R19(b) and (e): `sweepFixture.ts`'s `UnitPlant` gains `preRestart`, which plants a unit in the PRE-restart listing as not active, or leaves it out. W17e (×2) pins that D-3984's `if [ "$m" = "$cu" ]` filter leaves such a unit unverified. The filter's mutation row reds W17e and nothing else. The S0 fixture's prose says "pre-wave-10 (every release through v0.0.79)" (D-4070).
- **Task 3.** R19(d): S10, the script v0.0.80–v0.0.91 ship, is frozen as `server/test/fixtures/verify-service-pre-wave11.sh` and pinned by its digest (Q0). Q1–Q9 pin the NEW sweep with it, and each proves by digest that the box was given S10:
  - pass: healthy, stamped stop, purged stop, and a transient failure that recovers by its re-check (×2);
  - fail: unstamped stop, an activating crash, MainPID churn, failed with a purged row, and a crash-shaped listed unit (D-4069).
- **Task 4.** R19(c) and R18(c)–(e), prose only:
  - README's sweep sentence says the crash-shaped verify is for units active before the restart. It also says one shared window holds for up to `CCRC_SWEEP_VERIFY_JOBS` (128) units, given a scratch dir.
  - One over-long `ccrc-doctor.test.ts` comment line is rewrapped.
  - The merged wave-11 plan gets a dated note at its head and is amended in place, each change marked `(2026-10-06, wave 12, …)` (D-4071):
    - W20's "not code -1";
    - five helpers → six;
    - D-3977's capital;
    - T5-6's red set;
    - T7-1's measured respelling;
    - the rows added during the wave, under the names the ledger and the brief give, and wave 12's own guard rows labelled as such;
    - D-3988's two overclaims.
- **Task 5.** The gate and the PR.

**Live effect: none.** No file a box runs changes. `server/test/fixtures/` is in no release's install path: the tree ships it, and nothing outside vitest runs it. The wave needs no rollout order.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:**
- the macOS legs stop going red on correct code;
- the two pairings and the one filter that nothing pinned get cases that red when they break;
- the wave-11 record says what was shipped and measured.

**Architecture:**
- No ring changes. No change to `ccd/ccrc`, `ccd/ccd`, `ccd/ccrc-doctor-checks`, any file in `deploy/`, a unit, `install.sh`, `server/src`, `agent/src`, `pwa/` or `shared/`.
- `ccd/ccrc` and `deploy/verify-service.sh` are mutated only for a moment, to measure a row. Each is restored with `cp` + `cmp` before the next step.
- **Tests:**
  - `server/test/ccrc-update.test.ts` (Task 1);
  - `server/test/sweepFixture.ts` (Tasks 2–3);
  - `server/test/ccrc-sweep-window.test.ts` (Tasks 2–3);
  - one new frozen fixture (Task 3);
  - one comment in `server/test/ccrc-doctor.test.ts` (Task 4).
- **Prose:** `README.md` (one sentence, Task 4) and the merged wave-11 plan (Task 4).

**Tech Stack:**
- vitest 4.1 in `server/`, and in `agent/` only to run the unchanged `deploy-verify` file;
- TypeScript on node `>=22.13.0`;
- bash `set -uo pipefail` under test;
- no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md`. No section changes. The inputs are:
- the ledger's R18 and R19 (`docs/superpowers/programs/centralised-update-management.md` on the coordination branch);
- review 281's findings F1–F4, as the ledger records them.

**Producers:**
- `main` at `d2bac7ae` (#287, wave 11; v0.0.92).
- Review 281 (workflow `wf_e7d29566-e2c`): F1–F4, ruled to R19 at 02:35.
- Run 270's wave-done residue (mail 3610), ruled to R18 at 01:29.
- This plan's prototype, measured at `d2bac7ae` on a loaded Linux box (load 14–20), and its revision's re-measurement (load ~17). Every row marked *(prototype)* below was run through the real file with vitest; a row marked *(measured in revision)* was re-run after the attack's changes. The worker re-measures each one.

**Inputs this plan's author could NOT read** (Risk notes): review 281's report file, and run 270's wave-done and task reports. Both were in workspaces that no longer exist: the run closed `done` with `childReclaim: queued`. As a result:
- the S10 case list is the one in the coordinator's brief;
- the rows added during wave 11 are re-measured here with mutation text this plan chose. The ledger names them "T6-INT2 to INT5", and the wave-12 brief "T6-INT, T6-INT2a, T6-INT4, T6-INT5" — the two do not agree, and neither is the worker's own record (Reading 3).
- **Precondition for Task 4 Step 4 (A17–A19), as the coordinator ruled it (Reading 3, below):** the coordinator recovered run 270's wave-done and review 281's report from its own session record. Both sit, gitignored, in the coordinator's worktree under `.superpowers/w11-evidence/` (`run-270-wave-done.md`, `review-281-33f4eaaa.md`), and the brief gives their absolute path. Read both before Task 3 and Task 4. The task reports were not recovered. Do not mail for them.

**D-refs this plan cites as they stand:**
- D-3972 to D-3984, D-3987 and D-3988 (wave 11);
- D-3981 and D-3830 (amending a committed plan in place);
- D-3982 (frozen copies in the test tree).

## Not in this wave

Reviewers: do not raise these.

- **Wave 13 (the live-code residue, ruled at 02:45):**
  - item 3's false warning for a unit that D-3984 then verifies: "is FAILED — try-restart skipped it and this sweep did not verify it" (a `ccd/ccrc` change);
  - R17: the foreground calls outside `_upd_sweep_kill`'s reach, and a TERM to the process group in the fork window;
  - R18(a): `verify-service.sh`'s unsearchable registry, and `_reg_purge`'s order;
  - R18(b): Darwin's swallowed INT, and `_ccrc_job_stayed_up` called with no arguments;
  - the older list: R2, R3, R4-1 and R4-3, R8a–h, R9-R1, R10c/f/i/j/k, R14(a–e), `--no-reload` for `_svc_enable`, the `ccd/ccd` harness containment and the dotted-id reverse maps.
- **`_upd_sweep_stop`'s header comment in `ccd/ccrc`** still says "(a stale pid is never signalled)". Task 4 rewords the PLAN's copy of that claim (R18e). The shipped comment lives in `ccd/ccrc`, so it is wave 13's, beside item 3 (Reading 8 asks the coordinator to list it there).
- **A unit that read `activating` before the restart.** systemd's try-restart restarts an activating unit, and the sweep's `before` takes only units the pre-restart listing shows `active`, so such a unit is restarted onto the new ccd and then neither verified nor warned about. W17e (a) pins that shipped choice and says so; whether it is right is a `ccd/ccrc` question (Reading 9).
- **The last clause of R18(d): "removing the pgid filter's 'TERMed group' exception reds nothing"** (`collect` in `ccrc-sweep-window.test.ts`).
  - The scope text for this wave lists R18(d)'s other points but not this one, and the 02:45 wave-13 list does not name it either.
  - Removing an exception can only make a case stricter. So no red can show the exception is needed unless a case plants the fork-window race it absorbs.
  - Reading 4 asks the coordinator where it goes. No code changes for it here.
- **The unpinned guards this wave's measurement found** (T6-INT-W, T6-RERAISE: 0 red each). They are recorded as rows (Task 4, A19), not pinned; pinning them is a new test (Reading 8). *(Ruled 2026-10-06, Reading 8: T6-RERAISE is pinned in this wave, D-4072; T6-INT-W goes to wave 13.)*
- **A portable shim for D3**, such as `_plat_size() { wc -c < "$1"; }`. The coordinator preferred Linux-only (Reading 1).
- **README beyond the one sentence, and CLAUDE.md.** README grows by 3 lines (5732 → 5735). That stays inside CLAUDE.md's `~5700` ratchet (`pools-prose.test.ts`: |claimed − real| ≤ 100), so CLAUDE.md is not edited.
- **Retiring S0 or S10.** D-3982's retirement rule covers both: they retire once no box can roll back to a pre-wave-10 or pre-wave-11 script.

## Global Constraints

- **Anchors.**
  - Every anchor is measured at `d2bac7ae` and quoted.
  - Step 1 of each task re-measures its anchors by their QUOTED TEXT on the tip being built (`grep -nF`). Do this after `git fetch origin main`, and after a merge if `main` moved. The quote wins over any line number.
  - Find code with graphify first (`graphify query "…"` over `graphify-out/`), then confirm with `grep -nF`.
- **Scope.**
  - Change the files in File structure, and nothing else.
  - This prints nothing:

        git diff --stat origin/main...HEAD -- ccd deploy agent/src server/src pwa shared '*.service' '*.timer' install.sh CLAUDE.md agent/CLAUDE.md .github server/test/ccdWsHelpers.ts server/test/ccrcContainment.ts server/test/containedTools.ts server/test/platformFixtures.ts server/test/fixtures/verify-service-pre-wave10.sh server/test/fixtures/upd-sweep-pre-wave11.bash

  - `ccd` and `deploy` are whole directories in that list. Wave 12 writes none of `ccd/ccrc`, `ccd/ccd`, `deploy/verify-service.sh`, `deploy/deploy.sh` or `deploy/systemd`.
  - This lists exactly File structure's files:

        git diff --stat origin/main...HEAD

- **Fixture HOMEs only.**
  - Every case that runs or sources `ccd/ccrc`, or runs any copy of `verify-service.sh`, runs under a `mkTmp` HOME. It gets there through `sweepFixture.ts`'s `makeBox`, or `ccrc-update.test.ts`'s `freshUpdateBox`/`sourcedCcrc`, unchanged.
  - `runSweep` proves containment on the spawn's final env before every spawn. `assertContained` does the 12-name resolution and wave 9's `assertNoRealTool`.
    - The stubs are `systemctl` and `journalctl`.
    - `tmux`, `ccd`, `launchctl`, `loginctl`, `systemd-run`, `ssh`, `scp`, `curl` and `npm` are recording POISONS that exit 97.
    - `gh` is `ghContainedEnv`'s.
    - Every new case ends with `noPoison(box)`.
  - No case runs `ccrc update`, `rollback`, `rollout`, `install` or `deploy.sh` outside a fixture.
  - No case reads or writes a real `~/.cc-sessions`, `~/.ccrc` or `~/.cc-limits`, or touches a `claude-session@*` unit.
  - If you list processes, mask `x-ccrc-mail-token` in what you print.
- **Frozen fixtures are never edited.**
  - `verify-service-pre-wave10.sh` (S0), `upd-sweep-pre-wave11.bash` (the OLD sweep) and the new `verify-service-pre-wave11.sh` (S10) are released bytes.
  - Each is pinned by a digest case (R0, X0, Q0).
  - A mutation row may change one byte for the measurement, and must restore it with `cp` + `cmp`.
- **Mutation-table discipline.**
  - Before each mutation: `cp <file> "$SCRATCH/<name>.orig"`. Never `git checkout --`, and never a bare `git stash`.
  - Apply the mutation and check that it parses (`bash -n` for shell). If a mutation cannot parse as spelled, respell it and record the respelling.
  - Run the named command. Then restore with `cp` and check with `cmp`. `git status --porcelain` must then show only this wave's intended files.
  - A row is done only with a measured red count and the assertion that fired.
    - A spawn timeout is "code -1". A suite hang is "killed by timeout(1)". Neither is ever "red".
    - Code -1 is also what a bash ended by its own unhandled signal gives (W20). The clock tells the two apart.
  - Each row lists its full expected red set. A measured set that differs is reported, not silently accepted.
  - A row marked *race* names its run count N. Run it N times and record "k of N" with the reds of each red run. A 0-of-N result is reported to the coordinator as such, not recorded as a changed red set. T6-INT4 is N = 16 (D-3988's own count); T6-STOPW is N = 8.
- **D-numbers.**
  - This plan defines D-4068 to D-4071, from the block issued to run 282 (4068 to 4087), in `## Deviations found`.
  - **The worker's reserve is numbers 4072 to 4076.**
    - Take them in order.
    - Define each one in this plan's `## Deviations found`, in the commit that first cites it.
    - Write any other unspent number bare.
  - Never write a number outside the block. Never call the allocator. Never land a `D-TBD-` spelling.
  - The commit that first writes D-4068 to D-4071 anywhere tracked must contain this plan, or come after the commit that does.
  - The gate (Task 5 Step 4) checks every D-token the branch adds: each is already on `origin/main`, or is 4068–4076 and defined in this plan. Nothing from 4077 to 4087 is written with the prefix.
- **Suites.**
  - Run each file in the foreground, one command per call, inside the package, with a timeout of at least 600000 ms: `./node_modules/.bin/vitest run test/<file>.test.ts [-t "<pattern>"]`. Never bare `npx vitest`. Never split by `file:line`.
  - Run `npm ci` first wherever `node_modules` is absent:
    - `server/`;
    - `agent/`, for its one file;
    - `pwa/`, because `typecheck-tests` spawns all three compilers.
  - `TMPDIR` and all scratch go on the ROOT disk, under the session's scratchpad (`$SCRATCH/tmp`; `mkdir -p` it). Never on the work volume.
  - **`-t` parts that cannot run hollow.** `-t` is a JavaScript regex, matched against the full name (describe titles and the case title).
    - A title with `(` in it selects nothing unless escaped.
    - Use paren-free substrings, `|` for alternation (never `\|`), and a negative lookahead `^(?!.*<pattern>)` for "the rest".
    - Every part must report a non-zero `Tests N passed`, and the parts must be disjoint.
    - The sum of the parts' PASSED counts must equal the number of lines `./node_modules/.bin/vitest list test/<file>.test.ts` prints on this runner. (`vitest list` omits `itDarwin` and `skipIf` cases.)
    - Passed plus skipped always equals the whole file, so that sum proves nothing.
    - A part that reports everything skipped, or zero tests, fails the gate.
  - The box is loaded. Prefer `-t` filters while iterating, and run the whole file, or its parts, at each task's end.
- **No residue in tracked text:** no hostname, username, absolute home path, mount path, docserver URL or org name.
  - Fixture ids are `demo-a` … `demo-d`, `demo-x`, `demo-good`, `demo-gone`, and the existing `demo-u<n>`.
  - Run `topology-clean.test.ts` after `git add` of each new file.
- **Commits.**
  - Commit on the workspace branch only, at least once per task, as `test(update): …` or `docs(update): …`. Never use a separate feature branch.
  - Author and committer are the noreply identity.
  - Send the wave-done in the same turn as the push. Never end a turn to wait on CI.

## Review Focus

1. **A pin that cannot red is not a pin** (R19b, F1). W17e must red under the filter's mutation (`if [ "$m" = "$cu" ]; then` → `if true; then`). It must red because demo-x was NOT active before the restart, not by accident:
   - demo-b is missing, so the crash listing is read (asserted: `LIST_CRASH` once);
   - demo-x is in the crash listing (`listed: 'crash:…'`), and its `preRestart` keeps it out of `before`;
   - every existing plant's listings are byte-identical, so no other case moves. All 64 cases are green; under the mutant, 2 of 64 red, both of them W17e.
   - W17e's comment must not claim try-restart left (a) alone: systemd restarts an activating unit. (a) pins the shipped `before` = ACTIVE choice (row T2-3), (b) the "not touched" shape.
2. **The S10 cases run S10** (R19d, F3).
   - Q0's digest is that of `git show v0.0.91:deploy/verify-service.sh`, and every Q case checks the script copied into its box against that one constant (`ranS10`).
   - With `makeBox` made to ignore `verifySrc`, R2 and all ten Q1–Q9 tests red (measured in revision). So a fixture regression cannot silently test S11 twice.
   - Q3 is the one shape where S10 and S11 also behave apart (S11 asks `LoadState` on a purged row); elsewhere `noLoadState` is a tripwire only, and the comment says so.
   - Q4, Q5, Q7 and Q8 count `is-active` calls, so a re-check that never ran the script reds them (T3-3, measured in revision).
3. **D3 still pins what it pinned, on Linux** (R19a).
   - D3's body and shim are unchanged; only `it` → `itLinux`.
   - T7-2 and T7-4 still red D3 on Linux (re-measured).
   - On the macOS legs, D3 is skipped and D3d runs.
4. **The amended plan says what was shipped, and says that it was amended** (R18c–e, R19c).
   - A dated note at its head lists the amendments, and every changed sentence carries a `(2026-10-06, wave 12, …)` marker, naming what it said before or why it changed.
   - No row's measured red set is invented. Each one added in Task 4 is a red this plan measured, or the worker's re-measurement. No row is presented as the wave-11 worker's unless the worker's report was read.
5. **README's sentence is true of the shipped code** (R18c).
   - The crash-shaped verify needs the unit in `before`. `ccd/ccrc` builds `before` from the pre-restart listing's ACTIVE column, and the filter checks it.
   - The window is chunked by `CCRC_SWEEP_VERIFY_JOBS` (default 128, `^[1-9][0-9]{0,3}$`), and serial with no scratch dir.

## Risk notes

- **The two inputs that were not on the box.** Review 281's file and run 270's task reports were in workspaces that no longer exist. So:
  - The S10 cases (Q1–Q9) follow the case list in the coordinator's brief: "healthy 0, stamped stop 0, purged stop 0, unstamped stop 1, crash (activating) 1, crash (MainPID churn) 1, failed+purged 1, crash-shaped listed 1, transient-then-recovered 0". Each is built from an existing plant shape.
  - The rows added during wave 11 have two different names in the record: the ledger's "T4-7, T6-INT2 to INT5, T2-6 and T2-7" and the brief's "T4-7, T6-INT, T6-INT2a, T6-INT4, T6-INT5, T2-6, T2-7". This plan uses the brief's ids, says so in the amended plan, and its mutation text is its own choice, taken from D-3987's and D-3988's own sentences and the fix-round-1 commit (Reading 3).
  - Run 270's wave-done mail (3610) is held in the coordinator's store. The worker asks for it first (the precondition above). If it gives other mutations for those names, the worker records both.
- **Two of the re-measured rows are races** (T6-INT4, T6-STOPW). Each red once, in the one run made here. D-3988 measured T6-INT4 at 12 runs in 16. Their rows say *race*, with N = 16 and N = 8.
- **`ccrc-update.test.ts` ran whole in 540 s here** (load 15–18): 502 passed, 12 skipped. Its non-sweep remainder alone (482) took 504 s at load 15–17, as near the 600 s cap as the whole file. So the gate runs it in three parts (counts measured with `vitest list`):
  - `-t "supervisor sweep"` (20);
  - `-t "ccrc (rollback|versions|watchdog)|killed-flip state|is a statement about the version"` (169);
  - `-t "^(?!.*(supervisor sweep|ccrc (rollback|versions|watchdog)|killed-flip state|is a statement about the version))"` (313).

  `vitest list` prints 502 = 20 + 169 + 313.
- **`ccrc-doctor.test.ts` did not finish whole in 595 s here.** Its change is one comment line. The gate runs three parts:
  - `-t "ccrc doctor: auth"` (64; it ran green in 56 s);
  - `-t "ccrc doctor: (wrappers|fleet|codex|models|pools)"` (211);
  - `-t "^(?!.*ccrc doctor: (auth|wrappers|fleet|codex|models|pools))"` (395).

  `vitest list` prints 670 = 64 + 211 + 395.
- **README is read by fifteen pinning test files.** The change stays inside one sentence and adds three lines. The gate runs all fifteen.
- **The S10 fixture is a second copy of a shipped script** (D-4069).
  - It sits under `server/test/fixtures/`, as S0 does. That is outside `single-definition.test.ts`'s roots: `shared`, `server/src`, `pwa/src` and `agent/src`, plus the bash roots `ccd`, `deploy` and `install.sh`.
  - `topology-clean` walks `git ls-files`, so the fixture is scanned. Like S0 and S11, S10 holds only `127.0.0.1`, in a comment.
- **macOS.**
  - D3 is skipped there after Task 1. D3d already passed on `test-macos` (review 281).
  - W17e and Q0–Q9 are `itLinux`, like every case in the window file.
  - So this wave adds no macOS case.

## Deviations found

These are departures from a ledger ruling, or from what shipped text at `d2bac7ae` documents.

- **D-4068** — *D3 is Linux-only: the coordinator's ruling "D3 runs on every platform" is corrected.*
  - **Shipped:**
    - the wave-11 plan's "Coordinator rulings" bullet: "D3 runs on every platform with a shim, `_plat_size() { stat -c %s "$@"; }`";
    - `ccrc-update.test.ts`'s `it('D3: … (the platform size primitive stood in on this runner) …')`, and its section comment "D0–D4 and D6–D8 reach the arm from any runner".
  - **Why:** BSD stat refuses `stat -c %s`. So on the macOS legs the foreign report reads as this run's own, and D3 goes red on correct code (review 281's CI split; R19a). D3d, an `itDarwin` twin on the real `_plat_size`, passed on the same leg, so macOS is covered.
  - **Now:**
    - D3 is `itLinux`, the file's own platform helper (`platformFixtures.ts`'s `itLinux = it.skipIf(IS_DARWIN)`).
    - Its body, its shim and its red sets on Linux (T7-2, T7-4) are unchanged.
    - Its title drops "on this runner" for "GNU stat stands in for the platform size primitive".
    - The section comment names D3 as Linux-only.
    - The ruling's bullet gets a dated note (Task 4, D-4071).
- **D-4069** — *A third frozen copy of shipped code in the test tree: S10, the script v0.0.80 through v0.0.91 ship.*
  - **Shipped:** D-3982 says "Two frozen copies of shipped code live in the test tree, on purpose": the OLD sweep and S0.
  - **Why:** a rollback to v0.0.80–v0.0.91 pairs the NEW sweep with S10. Review 281 measured that pairing correct (F3), but no case pinned it, so a sweep change that broke it would land green.
  - **Now:**
    - `server/test/fixtures/verify-service-pre-wave11.sh` is `git show v0.0.91:deploy/verify-service.sh`, byte for byte.
    - It is sha256 `d066a31850f62661239fabf36c84e2d4f64eef35da6e839d31b112483d5f5cf8`, 189 lines and 10036 bytes. The digest is the same at every tag from v0.0.80 to v0.0.91 and at `d12b5aba` (measured).
    - Q0 pins the digest and the line count, that `stopped_on_purpose() {` is present, and that `LoadState` and `ccd_id_ok` are absent. Every Q1–Q9 case checks the copy its box was given against the same digest constant.
    - `sweepFixture.ts` exports it as `FROZEN_VERIFY_S10`.
    - It is never edited, and it retires by D-3982's rule.
- **D-4070** — *A fixture contract: a planted unit's word in the pre-restart listing, so a unit can be planted NOT active before the restart.*
  - **Shipped:** `sweepFixture.ts`'s `makeBox` writes every planted unit into the pre-restart listing (`list.all`) as `active`, whatever `listed` says. So D-3984's filter could not red (review 281 F1). The filter is `if [ "$m" = "$cu" ]; then`, inside the crash listing's loop in `ccd/ccrc`.
  - **Now:**
    - `UnitPlant` gains `preRestart?: string | null`.
    - When absent it is `'active'`, so every existing plant writes the same three listings, byte for byte (every crash plant in the tree uses `activating` or `failed`, for which the new SUB-word mapping gives the old word).
    - A word is written as the unit's ACTIVE column in the pre-restart listing. `null` leaves the unit out of that listing.
    - `listed`'s docstring now speaks of the POST-restart listings only.
    - W17e (a) and (b) use it.
- **D-4071** — *The merged wave-11 plan is amended in place*, following the precedent of D-3981 and D-3830. It is numbered, not merely allowed prose, because it changes that plan's record of what its pins red: T5-6's and T7-1's red sets are corrected, and rows that plan never carried are added with measured red sets (Reading 10 asks the coordinator whether to keep the number). A dated note at the plan's head lists the amendments, and every amended sentence carries `(2026-10-06, wave 12, R…)` and, where it replaces a claim, the claim it replaces. The amendments:
  - R19(c): W20's row, and the Global Constraint's "code -1" line. The shipped W20 asserts `toBe(-1)` and a clock under 20 000 ms.
  - R19(a): the `it` sentence above Task 7's case table, D3's row, and a dated sub-bullet under the coordinator's ruling.
  - R18(c): "five helpers" at its five sites (`ccd/ccrc` ships six: D-3988 added `_upd_sweep_stop`), and D-3977's lowercase sentence start.
  - R18(d): T5-6's red set; T7-1's measured respelling; the rows added during the wave, with this wave's measured red sets, under ids the amendment says are wave 12's unless the worker's report was read; wave 12's own guard rows in a table of their own.
  - R18(e): D-3988's "so a stale pid is never signalled" and "W21 asserts at most 10 + 50".
- **D-4072** — *W21's SIGINT-to-the-shell arms assert an INT death (`signal === 'SIGINT'`), so dropping the handler's re-raise reds.* Reading 8's ruling spends this number.
  - **Shipped:** W21 accepted `ended.signal === sig || ended.code === status`, with status 130. So `kill -INT "$BASHPID"` replaced by `exit 130` passed every SIGINT arm (T6-RERAISE: 0 of 12 red before this change).
  - **Why:** the coordinator's ruling on Reading 8. The re-raise is a ruled guard (answer 3565: "Re-raise rather than `exit 130`"), and a ruled guard ships with a pin that reds.
  - **Now:**
    - The five SIGINT-to-the-shell arms assert `signal === 'SIGINT'`: mid-batch and its caller-trap row, launch-loop and its caller-trap row, and the second-batch case. In the two `.each` cases the branch is `sig === 'SIGINT' && target === 'shell'`.
    - The group arms and every SIGTERM arm keep `signal === sig || code === status`, unchanged.
    - Stability, no mutation: 8 of 8 runs of the five arms green (5 passed each), under box load 18 to 20.
    - T6-RERAISE (`kill -INT "$BASHPID"' INT` becomes `exit 130' INT` in `_upd_sweep`'s INT trap): the five-arm filter reds 5 of 5, each on `ended by SIGINT: signal null, code 130: expected false to be true`; `-t "W2[12]"` reds the same 5 of 12 and nothing else (the group arms, the SIGTERM arms and W22 stay green).

## File structure

**New**
- `docs/superpowers/plans/2026-10-06-centralised-update-w12-wave11-residue.md` (this plan).
- `server/test/fixtures/verify-service-pre-wave11.sh` (Task 3): S10, frozen, mode 100644.

**Changed**
- `server/test/ccrc-update.test.ts` (Task 1): D3's `it` → `itLinux`, its title, the three comment lines above it, and the Task 7 section comment's "D0–D4 and D6–D8 reach the arm from any runner".
- `server/test/sweepFixture.ts` (Tasks 2–3):
  - `FROZEN_VERIFY_S0`'s docstring;
  - the new `FROZEN_VERIFY_S10`;
  - `UnitPlant.preRestart` and its docstring;
  - `makeBox`'s pre-restart row.
- `server/test/ccrc-sweep-window.test.ts` (Tasks 2–3):
  - the header and the import;
  - W17e;
  - the S0 describe's title;
  - the new S10 describe (Q0–Q9).
- `server/test/ccrc-doctor.test.ts` (Task 4): one comment line in U5's block, rewrapped.
- `README.md` (Task 4): the sweep sentence in the update path.
- `docs/superpowers/plans/2026-10-05-centralised-update-w11-sweep-window.md` (Task 4; D-4071).

**Run, not edited:**
- `agent/test/deploy-verify.test.ts`;
- `ccrc-sweep-deliberate-stop`, `single-definition`, `runbook-holds`, `typecheck-tests`, `topology-clean`, `dtbd` and `deviation-refs`;
- the fifteen README-pinning files (Task 5).

## Tasks

### Task 1: R19(a): D3 is Linux-only (D-4068)

**Files:** `server/test/ccrc-update.test.ts` (D3, its comment, and the Task 7 section comment).

**Interfaces:** none produced. `itLinux` is already imported (`import { itLinux, itDarwin, platformContrast, python3ProgramArm, IS_DARWIN } from './platformFixtures.js';`).

- [ ] **Step 1: Re-measure:**
  ```bash
  cd server
  grep -nF "import { itLinux, itDarwin, platformContrast, python3ProgramArm, IS_DARWIN } from './platformFixtures.js';" test/ccrc-update.test.ts
  grep -nF "it('D3: a foreign report survives the Darwin die (the platform size primitive stood in on this runner) (wave 11, D-3973)'" test/ccrc-update.test.ts
  grep -nF "itDarwin('D3d: a foreign report survives the Darwin die, the real _plat_size (wave 11, D-3973)'" test/ccrc-update.test.ts
  grep -nF '  // D0–D4 and D6–D8 reach the arm from any runner (`sourcedCcrc` forces CCD_OS after' test/ccrc-update.test.ts   # ~2957
  grep -nF 'export const itLinux = it.skipIf(IS_DARWIN);' test/platformFixtures.ts
  grep -rnF 'stood in on this runner' . --include=*.ts --exclude-dir=node_modules   # only the D3 title
  ```
- [ ] **Step 2: Edit.** Replace the comment's last line and D3's opening line:
  ```diff
     // `_upd_report_readable` reads the file's size through `_plat_size`, which under a forced
     // CCD_OS=darwin runs BSD `stat -f %z` — a Linux runner's GNU stat refuses that and the foreign report
  -  // would read as this run's own. D3 stands the platform primitive in; D3d (macOS) runs the real one.
  -  it('D3: a foreign report survives the Darwin die (the platform size primitive stood in on this runner) (wave 11, D-3973)', () => {
  +  // would read as this run's own. D3 stands the platform primitive in with GNU `stat -c %s`, which BSD
  +  // stat refuses in turn, so D3 is Linux-only; D3d (macOS) runs the real one (wave 12, R19a; D-4068).
  +  itLinux('D3: a foreign report survives the Darwin die (GNU stat stands in for the platform size primitive) (wave 11, D-3973)', () => {
       d3(darwinBox('ccrc-update-sweep-d3-', IDS3), '_plat_size() { stat -c %s "$@"; }; ');
     });
  ```
  And the Task 7 section comment (about 75 lines above D3):
  ```diff
  -  // D0–D4 and D6–D8 reach the arm from any runner (`sourcedCcrc` forces CCD_OS after
  -  // the `.`), the launchctl stub is `updateEnv`'s own, and the window knobs are 0.
  +  // D0–D2, D4 and D6–D8 reach the arm from any runner (`sourcedCcrc` forces CCD_OS after
  +  // the `.`), and D3 from a Linux runner (wave 12, R19a; D-4068); the launchctl stub is
  +  // `updateEnv`'s own, and the window knobs are 0.
  ```
- [ ] **Step 3: Run:** `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "supervisor sweep"`. **Expected** on Linux: `Tests 20 passed | 494 skipped (514)`. D3 runs there, and D3d is skipped. *(prototype: 20 passed; the section-comment edit is comment-only)*
- [ ] **Step 4: Mutation table.** Mutate `ccd/ccrc` in place, with `cp` + `cmp` around each row.

  | # | Guard | Mutation | Goes red (full expected set) | Command |
  |---|---|---|---|---|
  | T1-1 | D3 still runs on Linux | D3's `itLinux(` becomes `itDarwin(` | none red; D3 now reports skipped: `Tests 19 passed` instead of 20. Record the count drop, not a red | `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "supervisor sweep"` |
  | T1-2 | T7-4 keeps D3 on Linux *(prototype)* | in `ccd/ccrc`'s Darwin arm, `      [ -z "$dfail" ] \|\| _upd_sweep_die "sweep: ${#first[@]} of` becomes `      [ -z "$dfail" ] \|\| _ccrc_die "sweep: ${#first[@]} of` | D0 (`not to contain '_ccrc_die'`) and D3 (`update.json` now `"phase":"failed"`): 2 of 20 | same |
  | T1-3 | T7-2 keeps D3 on Linux *(prototype)* | in `_ccrc_job_stayed_up`, `      CCRC_STAYED_BAD+=("$u"); CCRC_STAYED_WHY+=("$d")` becomes `      :` | D2, D3, D4, D6, D7, D8: 6 of 20 (the wave-11 row's set) | same |
- [ ] **Step 5: Commit**, with this plan if it is not on the branch yet: `test(update): ccrc-update's D3 is Linux-only — BSD stat refuses its GNU shim, and D3d covers macOS (wave 12, R19a; D-4068)`.

### Task 2: R19(b) and (e): a unit that was not active before the restart, and D-3984's filter pinned; S0 named for what it is (D-4070)

**Files:** `server/test/sweepFixture.ts`, `server/test/ccrc-sweep-window.test.ts`.

**Interfaces:**
- Produces: `UnitPlant.preRestart?: string | null`. The default is `'active'`; `null` means absent from the pre-restart listing. Task 3 uses `UnitPlant`, otherwise unchanged.

- [ ] **Step 1: Re-measure:**
  ```bash
  grep -nF '            if [ "$m" = "$cu" ]; then' ccd/ccrc                                   # the filter (inside the crash listing's loop)
  grep -nF '[ "$la" = active ] && before+=("$lu")' ccd/ccrc                                   # `before` is the pre-restart ACTIVE column
  grep -nF "    all.push(row(p.unit, 'active', 'running'));" server/test/sweepFixture.ts       # every unit written active before
  grep -nF "/** S0, the verify script as wave 10 shipped it, byte for byte" server/test/sweepFixture.ts
  grep -nF "// wave-10 script (\`fixtures/verify-service-pre-wave10.sh\`, S0, v0.0.79's bytes)" server/test/ccrc-sweep-window.test.ts
  grep -nF "describe('_upd_sweep, Linux arm, with the FROZEN wave-10 script S0" server/test/ccrc-sweep-window.test.ts
  grep -nF "  itLinux('W17d nothing missing: no crash listing', () => {" server/test/ccrc-sweep-window.test.ts
  grep -rn "FROZEN wave-10 script S0\|as wave 10 shipped it" server/test --include=*.ts      # the two sites above only
  grep -n "crash:" server/test/*.ts                                                          # crash plants: `activating` and `failed` only
  for t in v0.0.1 v0.0.59 v0.0.79; do git show "$t:deploy/verify-service.sh" | sha256sum; done   # each fae9a23f…dcd3 (S0's R0 literal)
  ```
  Also confirm that these are correct and stay as they are:
  - `R2`'s title, "no classifier before wave 10";
  - `sweepFixture.ts`'s two other "wave 10" mentions: its builders' history, and its SAFETY line.
- [ ] **Step 2: The fixture.** In `server/test/sweepFixture.ts`:
  - Replace `FROZEN_VERIFY_S0`'s one-line docstring:
    ```ts
    /** S0, the verify script every release through v0.0.79 ships (one digest from v0.0.1, measured) — the PRE-wave-10
     *  script, with no deliberate-stop classifier — byte for byte (`git show v0.0.79:deploy/verify-service.sh`; wave 12,
     *  R19e, which corrects the "as wave 10 shipped it" this line said). */
    export const FROZEN_VERIFY_S0 = join(here, 'fixtures', 'verify-service-pre-wave10.sh');
    ```
  - Replace `UnitPlant`'s docstring and type:
    ```ts
    /** One planted unit. `active` and `mainPid` are answered one per call, the last repeating, across EVERY call of
     *  that unit (the first verify's and the re-check's alike). `loadState` answers `show -p LoadState --value`
     *  (default `loaded`; `''` prints nothing and exits 1). `listed` is the POST-restart listings: `'active'` = in the
     *  `--state=active` listing (the default); `'crash:<word>'` = in the `--state=activating,failed` listing as `<word>`;
     *  `'gone'` = in neither. `preRestart` is the PRE-restart listing (`list-units claude-session@*`, which the sweep
     *  reads its `before` set from): the unit's ACTIVE word there (default `'active'`), or `null` for a unit that listing
     *  does not show at all (wave 12, R19b, D-4070: a unit that was NOT active before the restart). */
    export interface UnitPlant {
      unit: string; active: string[]; mainPid: string[]; loadState?: string;
      listed?: 'active' | `crash:${string}` | 'gone';
      preRestart?: string | null;
    }
    ```
  - In `makeBox`, add `subOf` below `const row = …` and change the plant loop:
    ```diff
       const row = (u: string, word: string, sub: string): string => `${u} loaded ${word} ${sub} x`;
    +  const subOf = (word: string): string =>
    +    (word === 'active' ? 'running' : word === 'failed' ? 'failed' : word === 'inactive' ? 'dead' : 'auto-restart');
       const all: string[] = [];
       const active: string[] = [];
       const crash: string[] = [];
       for (const p of o.units) {
    -    all.push(row(p.unit, 'active', 'running'));
    +    const pre = p.preRestart === undefined ? 'active' : p.preRestart;
    +    if (pre !== null) all.push(row(p.unit, pre, subOf(pre)));
         const listed = p.listed ?? 'active';
         if (listed === 'active') active.push(row(p.unit, 'active', 'running'));
         else if (listed !== 'gone') {
           const word = listed.slice('crash:'.length);
    -      crash.push(row(p.unit, word, word === 'failed' ? 'failed' : 'auto-restart'));
    +      crash.push(row(p.unit, word, subOf(word)));
         }
    ```
    What stays byte-identical, measured rather than general: every existing plant's pre-restart row is `active` → `running`, as before; and every crash plant in the tree uses `activating` or `failed` (Step 1's `grep -n "crash:"`), for which `subOf` gives the old SUB word (`auto-restart`, `failed`). So the three listings of every existing case are byte-identical. `subOf` is NOT the old crash expression in general: a future crash plant with `active` or `inactive` would get `running` or `dead`, where the old line gave `auto-restart`.
- [ ] **Step 3: The case.** In `server/test/ccrc-sweep-window.test.ts`, directly after W17d's closing `}, 60_000);`:
  ```ts

    // D-3984 verifies a crash-shaped unit only when it is one of `missing`, and `missing` is drawn from `before`: the
    // units the PRE-restart listing shows ACTIVE. The crash listing's loop takes a unit only if it is one of `missing`
    // (`if [ "$m" = "$cu" ]`). Every other case plants its units active before, so only this one can see that filter
    // (review 281 F1; wave 12, R19b, D-4070). Demo-b is missing, so the listing is read; demo-x is in it but was not
    // active before, so it is neither verified nor warned about. In (b) the pre-restart listing does not show demo-x at
    // all, and try-restart leaves such a unit alone. In (a) demo-x read `activating` before the restart, and systemd's
    // try-restart DOES restart an activating unit: (a) pins the shipped choice, to verify only units that were active,
    // and is no proof that the choice is right (a question for wave 13).
    const X = U('x');
    const W17E: ReadonlyArray<readonly [string, string, UnitPlant]> = [
      ['a', 'crash-looping before the restart too',
        { unit: X, active: ['activating'], mainPid: [], listed: 'crash:activating', preRestart: 'activating' }],
      ['b', 'absent from the pre-restart listing',
        { unit: X, active: ['failed'], mainPid: [], listed: 'crash:failed', preRestart: null }],
    ];
    itLinux.each(W17E)('W17e (%s) a crash-listed unit that was not active before the restart (%s) is not verified (D-3984)', (_k, _label, x) => {
      const box = makeBox({ units: [stable(A, 0), { unit: B, active: ['inactive'], mainPid: [], listed: 'gone' }, x] });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(0);
      expect(count(box, LIST_CRASH), 'demo-b is missing, so the crash listing is read').toBe(1);
      expect(r.stderr, ctx(r)).not.toContain(`${X} was active before try-restart`);
      expect(count(box, act(X)), 'demo-x is never verified').toBe(0);
      expect(r.stderr).toContain(`${B} was active before try-restart and is not active after it`);
      expect(r.stderr).not.toContain(RECHECK);
      expect(r.stdout).toContain(SWEEP_OK);
      noPoison(box);
    }, 60_000);
  ```
  - `not.toContain(\`${X} was active before try-restart\`)` covers both D-3984's line ("… and reads '…' after it") and item G's line ("… and is not active after it").
  - In (a), demo-x is in the pre-restart listing, so the KillMode preflight reads it too. The stub answers `KillMode=process`.
- [ ] **Step 4: S0's prose in the window file.** Replace the header's S0 sentence. It also names S10, which Task 3 adds; you may land Tasks 2 and 3 as one commit.
  ```ts
  // WHAT RUNS. This tree's `_upd_sweep` out of the sourced `ccd/ccrc`, on a fixture HOME whose `systemctl` and
  // `journalctl` are stubs, against this tree's `deploy/verify-service.sh` (S11) — or, for R1 to R3, against the FROZEN
  // pre-wave-10 script (`fixtures/verify-service-pre-wave10.sh`, S0, v0.0.79's bytes), and for Q1 to Q9 against the
  // FROZEN wave-10 script (`fixtures/verify-service-pre-wave11.sh`, S10, v0.0.91's bytes): a rollback pairs THIS sweep
  // with an OLDER script, so the sweep must hold with a script that knows nothing of `stopped on purpose:` (S0), or
  // nothing of wave 11's purged-arm guards (S10). The OLD sweep with the NEW script — the move INTO wave 11 — is
  // `ccrc-sweep-deliberate-stop.test.ts`'s. The builders are `sweepFixture.ts`'s. (Wave 12, R19e: this header called
  // S0 "wave-10"; it is the script BEFORE wave 10.)
  ```
  Then the S0 describe's title:
  ```diff
  -describe('_upd_sweep, Linux arm, with the FROZEN wave-10 script S0 (a rollback pairs this sweep with an older script)', () => {
  +describe('_upd_sweep, Linux arm, with the FROZEN pre-wave-10 script S0 (a rollback to v0.0.79 or older)', () => {
  ```
  R0's title ("the frozen S0 is v0.0.79's script") and R2's ("no classifier before wave 10") are right and stay.
- [ ] **Step 5: Run:**
  - `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts -t "W17"`. **Expected:** `Tests 6 passed` (W17, W17b, W17c, W17d, W17e (a) and (b)). *(prototype: 6 passed)*
  - Then the whole file. **Expected:** every case green: 53 at the end of this task, and 64 after Task 3. *(prototype: 53, then 64; measured in revision: 64 in 35 s, with W17e's comment then reworded, comment-only)*
  - `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-deliberate-stop.test.ts`. **Expected:** `Tests 8 passed`. It builds on `makeBox`, whose listings are unchanged. *(prototype: 8)*
- [ ] **Step 6: Mutation table.**

  | # | Guard | Mutation | Goes red (full expected set) | Command |
  |---|---|---|---|---|
  | T2-1 | D-3984's "was active before" filter (review 281 F1) *(prototype)* | in `ccd/ccrc`, `            if [ "$m" = "$cu" ]; then` becomes `            if true; then` | W17e (a) and (b) only, on `code` (`expected 1 to be +0`: demo-x verified, and it fails): 2 of 64. Every other case stays green, which is F1's finding (measured) | `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts` |
  | T2-2 | the fixture writes `preRestart` *(prototype)* | in `sweepFixture.ts`, `    const pre = p.preRestart === undefined ? 'active' : p.preRestart;` becomes `    const pre: string \| null = 'active';` | W17e (a) and (b) only, on `code`: 2 of 6 under `-t "W17"` | `… test/ccrc-sweep-window.test.ts -t "W17"` |
  | T2-3 | `before` takes only the ACTIVE word, so (a) sees it and (b) does not *(measured in revision)* | in `ccd/ccrc`, `    [ "$la" = active ] && before+=("$lu")` becomes `    before+=("$lu")` | window file: W17e (a) only, on `code` (`expected 1 to be +0`): 1 of 64. Then `ccrc-update -t "supervisor sweep"`: G1b-control, G1a, and G1a with the verify listing failing: 3 of 20 | the window file whole, then `… test/ccrc-update.test.ts -t "supervisor sweep"` |
- [ ] **Step 7: Commit:** `test(update): a crash-listed unit that was not active before the restart is pinned unverified, so D-3984's filter can go red; S0 is named the pre-wave-10 script (wave 12, R19b, R19e; D-4070)`. Then run `topology-clean.test.ts`.

### Task 3: R19(d): S10 frozen, and the NEW sweep pinned with it (D-4069)

**Files:**
- create `server/test/fixtures/verify-service-pre-wave11.sh`;
- `server/test/sweepFixture.ts` (one export);
- `server/test/ccrc-sweep-window.test.ts` (the import, and the S10 describe).

**Interfaces:**
- Consumes:
  - `makeBox`, `runSweep`, `calls` and `UnitPlant` (Task 2);
  - the window file's helpers `stable`, `churn`, `ACTIVATING`, `NEWPID`, `act`, `pidCall`, `count`, `ctx`, `dieOf`, `dieLine`, `stoppedLine`, `purgedLine`, `STAMP`, `RECHECK`, `sha256` and `noPoison`, and its `join` and `readFileSync` imports.
- Produces: `export const FROZEN_VERIFY_S10: string` in `sweepFixture.ts`.

- [ ] **Step 1: Re-measure:**
  ```bash
  for t in v0.0.80 v0.0.84 v0.0.85 v0.0.91; do git show "$t:deploy/verify-service.sh" | sha256sum; done   # each d066a318…5cf8
  git show origin/main:deploy/verify-service.sh | sha256sum      # NOT d066a318…: main ships S11 (efcfa3be…)
  git show v0.0.91:deploy/verify-service.sh | wc -l -c           # 189 10036
  git show v0.0.91:deploy/verify-service.sh | grep -c 'LoadState\|ccd_id_ok'   # 0
  grep -nF "  itLinux('R3 the re-check works with an older script', () => {" server/test/ccrc-sweep-window.test.ts   # the file's last case
  grep -nF "const act = (u: string): string => \`--user is-active \${u}\`;" server/test/ccrc-sweep-window.test.ts
  ```
  If any tag from v0.0.80 to v0.0.91 gives another digest, stop and report.
- [ ] **Step 2: Freeze S10:**
  ```bash
  git show v0.0.91:deploy/verify-service.sh > server/test/fixtures/verify-service-pre-wave11.sh
  sha256sum server/test/fixtures/verify-service-pre-wave11.sh   # d066a31850f62661239fabf36c84e2d4f64eef35da6e839d31b112483d5f5cf8
  ```
  - Mode 100644, as S0: `git add` it, and never `chmod +x` it.
  - It has no header. Its bytes are the pin, and `FROZEN_VERIFY_S10`'s docstring records where they came from.
- [ ] **Step 3: The export.** In `sweepFixture.ts`, directly below `FROZEN_VERIFY_S0`:
  ```ts
  /** S10, the verify script as v0.0.80 through v0.0.91 ship it — wave 10's, with the classifier and none of wave 11's
   *  purged-arm guards — byte for byte (`git show v0.0.91:deploy/verify-service.sh`; wave 12, R19d, D-4069). */
  export const FROZEN_VERIFY_S10 = join(here, 'fixtures', 'verify-service-pre-wave11.sh');
  ```
  Then the window file's import:
  ```ts
  import {
    BASH, CCRC_SRC, FROZEN_VERIFY_S0, FROZEN_VERIFY_S10, SWEEP_OK, makeBox, runSweep, sweepSpawn, calls, poisonFiles, report,
    survivors, reapSurvivors,
    type Box, type UnitPlant,
  } from './sweepFixture.js';
  ```
- [ ] **Step 4: The cases.** Append them at the end of `ccrc-sweep-window.test.ts`, after the S0 describe:
  ```ts
  // S10 is the script v0.0.80 through v0.0.91 ship: wave 10's deliberate-stop classifier, none of wave 11's purged-arm
  // guards (no `ccd_id_ok`, no `LoadState` query). A rollback to one of those releases pairs THIS sweep with it. Review
  // 281 measured the pairing correct and nothing pinned it (F3; wave 12, R19d, D-4069): Q1 to Q9 do, one case per shape
  // that review measured. Every Q case asserts that the script the box was given is S10 by its digest (`ranS10`), so a
  // fixture that stopped honouring `verifySrc` would red all nine. Q3 is the one shape where S10 and S11 also BEHAVE
  // apart — S11 asks `LoadState` on a purged row, S10 never does — so its `noLoadState` is behavioural; in the other
  // cases S11 would not ask either, and that assertion is a tripwire only.
  describe('_upd_sweep, Linux arm, with the FROZEN wave-10 script S10 (a rollback to v0.0.80–v0.0.91)', () => {
    const S10_SHA = 'd066a31850f62661239fabf36c84e2d4f64eef35da6e839d31b112483d5f5cf8';
    const s10 = (): string => readFileSync(FROZEN_VERIFY_S10, 'utf8');
    const ranS10 = (box: Box): void => {
      expect(sha256(readFileSync(join(box.home, 'ccrc', 'deploy', 'verify-service.sh'), 'utf8')),
        'the box was given S10, not this tree\'s script').toBe(S10_SHA);
    };
    const noLoadState = (box: Box): void => {
      expect(calls(box).filter((l) => l.includes('LoadState')), 'S10 never asks LoadState: S11 answered').toEqual([]);
    };

    itLinux('Q0 the frozen S10 is v0.0.91\'s script', () => {
      const text = s10();
      expect(sha256(text), 'the frozen S10 is no longer the released text — it is never edited; restore it from '
        + '`git show v0.0.91:deploy/verify-service.sh`').toBe(S10_SHA);
      expect(text.split('\n').length - 1).toBe(189);
      expect(text).toContain('stopped_on_purpose() {');
      expect(text).not.toContain('LoadState');
      expect(text).not.toContain('ccd_id_ok');
    }, 60_000);

    itLinux('Q1 healthy units pass with S10', () => {
      const box = makeBox({ units: [stable(A, 0), stable(B, 1)], verifySrc: FROZEN_VERIFY_S10 });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(0);
      expect(r.stdout).toContain(SWEEP_OK);
      expect(r.stderr).not.toContain(RECHECK);
      ranS10(box);
      noLoadState(box);
      noPoison(box);
    }, 60_000);

    itLinux('Q2 a stamped stop passes with S10, on its first verify', () => {
      const box = makeBox({
        units: [stable(A, 0), { unit: B, active: ['active', 'inactive', 'inactive'], mainPid: ['5151'] }],
        registry: { 'demo-a.uuid': 'u1\n', 'demo-b.uuid': 'u2\n', 'demo-b.stopped': `${STAMP}\n` },
        verifySrc: FROZEN_VERIFY_S10,
      });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(0);
      expect(r.stdout).toContain(stoppedLine(B, 'demo-b'));
      expect(r.stderr).not.toContain(RECHECK);
      ranS10(box);
      noLoadState(box);
      noPoison(box);
    }, 60_000);

    itLinux('Q3 a purged stop passes with S10, on its first verify', () => {
      const box = makeBox({
        units: [stable(A, 0), { unit: B, active: ['inactive', 'inactive'], mainPid: [] }],
        registry: { 'demo-a.uuid': 'u1\n', 'demo-b.generation': '1\n' },
        verifySrc: FROZEN_VERIFY_S10,
      });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(0);
      expect(r.stdout).toContain(purgedLine(B, 'demo-b'));
      expect(r.stderr).not.toContain(RECHECK);
      ranS10(box);
      noLoadState(box);
      noPoison(box);
    }, 60_000);

    itLinux('Q4 an unstamped stop fails with S10, after its re-check (ruling 3)', () => {
      const box = makeBox({
        units: [stable(A, 0), { unit: B, active: ['active', 'inactive'], mainPid: ['5151'] }],
        registry: { 'demo-a.uuid': 'u1\n', 'demo-b.uuid': 'u2\n' },
        verifySrc: FROZEN_VERIFY_S10,
      });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(1);
      expect(count(box, act(B)), 'the first verify and its re-check both ran S10').toBe(5);
      expect(dieOf(r.stderr), ctx(r)).toBe(dieLine(1, 2, 0, B));
      ranS10(box);
      noLoadState(box);
      noPoison(box);
    }, 60_000);

    itLinux('Q5 a crash-looping unit the active listing shows (activating at every read) fails with S10', () => {
      const box = makeBox({
        units: [stable(A, 0), { unit: B, active: ['activating'], mainPid: [] }],
        verifySrc: FROZEN_VERIFY_S10,
      });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(1);
      expect(count(box, act(B)), 'the first verify and its re-check both ran S10').toBe(2);
      expect(dieOf(r.stderr), ctx(r)).toBe(dieLine(1, 2, 0, B));
      ranS10(box);
      noLoadState(box);
      noPoison(box);
    }, 60_000);

    itLinux('Q6 a MainPID that churns through the re-check fails with S10', () => {
      const box = makeBox({ units: [stable(A, 0), churn(B)], verifySrc: FROZEN_VERIFY_S10 });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(1);
      expect(count(box, pidCall(B))).toBe(4);
      expect(dieOf(r.stderr), ctx(r)).toBe(dieLine(1, 2, 0, B));
      ranS10(box);
      noLoadState(box);
      noPoison(box);
    }, 60_000);

    itLinux('Q7 a failed unit whose registry row is purged fails with S10 (the classifier reads only a stop shape)', () => {
      const box = makeBox({
        units: [stable(A, 0), { unit: B, active: ['failed'], mainPid: [], listed: 'crash:failed' }],
        registry: { 'demo-a.uuid': 'u1\n', 'demo-b.generation': '1\n' },
        verifySrc: FROZEN_VERIFY_S10,
      });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(1);
      expect(count(box, act(B)), 'the first verify and its re-check both ran S10').toBe(2);
      expect(r.stdout).not.toContain('stopped on purpose:');
      expect(dieOf(r.stderr), ctx(r)).toBe(dieLine(1, 2, 0, B));
      ranS10(box);
      noLoadState(box);
      noPoison(box);
    }, 60_000);

    itLinux('Q8 a crash-shaped unit missing from the active listing is verified, and fails, with S10 (D-3984)', () => {
      const box = makeBox({
        units: [stable(A, 0), { unit: B, active: ['activating'], mainPid: [], listed: 'crash:activating' }],
        verifySrc: FROZEN_VERIFY_S10,
      });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(1);
      expect(count(box, act(B)), 'the first verify and its re-check both ran S10').toBe(2);
      expect(r.stderr).toContain(`${B} was active before try-restart and reads 'activating' after it`);
      expect(dieOf(r.stderr), ctx(r)).toBe(dieLine(1, 2, 0, B));
      ranS10(box);
      noLoadState(box);
      noPoison(box);
    }, 60_000);

    itLinux.each([
      ['activating at its second read', ACTIVATING],
      ['a new MainPID at its second read', NEWPID],
    ] as const)('Q9 a transient failure that recovers by its re-check passes with S10 (%s)', (_label, shape) => {
      const box = makeBox({ units: [stable(A, 0), { unit: B, ...shape }], verifySrc: FROZEN_VERIFY_S10 });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(0);
      expect(r.stderr).toContain(`re-check: ${B} passed its re-check`);
      expect(r.stdout).toContain(SWEEP_OK);
      ranS10(box);
      noLoadState(box);
      noPoison(box);
    }, 60_000);
  });
  ```
  What each shape does against S10's own code. S10's `stopped_on_purpose` classifies only a stop-shaped observation: `inactive`, `deactivating` or `nopid`.
  - Q2 reads `active` and MainPID 5151, then `inactive` at the window read. The classifier reads `inactive` again, and the stamp passes it.
  - Q3 reads `inactive` at the settle read. There is no `.uuid`, so S10's purged arm passes it and asks systemd nothing more. (S11 would ask `LoadState`.)
  - Q4 is ruling 3: an unstamped `inactive` with a kept `.uuid` fails, and its re-check fails too. Its 5 `is-active` reads are the first verify's 3 and the re-check's 2 (measured: 3 with the re-check's script call removed).
  - Q5 is in the active listing and reads `activating` at every read.
  - Q8 is missing from the active listing and crash-listed `activating` (D-3984). Neither Q5's word nor Q8's is stop-shaped. Each reads `is-active` once per call: 2 (measured: 1 with the re-check's script call removed).
  - Q7 reads `failed` with a purged row. `failed` is not stop-shaped, so the purged arm is never reached; 2 reads, as Q5.
  - Q9 is W14's two transient shapes, each recovered by the re-check.
- [ ] **Step 5: Run:**
  - `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts -t "FROZEN"`. **Expected:** `Tests 15 passed`: R0–R3 and Q0–Q9, with Q9 counting twice. *(measured in revision: 15 passed)*
  - Then the whole file. **Expected:** `Tests 64 passed (64)`. *(measured in revision: 64, in 35 s at load ~17)*
  - Red first applies only to Q0's pin (row T3-1). Q1–Q9 pin behaviour that is already correct (review 281 measured it), so their reds come from the mutation table.
- [ ] **Step 6: Mutation table.**

  | # | Guard | Mutation | Goes red (full expected set) | Command |
  |---|---|---|---|---|
  | T3-1 | the frozen S10 bytes *(measured in revision)* | in the fixture, `# nothing was measured — so it fails.` becomes `# nothing was measured — so it failz.` | Q0 (its sha256, with the "restore it from `git show v0.0.91:deploy/verify-service.sh`" message) and Q1–Q9, all ten tests (`the box was given S10, not this tree's script`: the copy is no longer S10's bytes): 11 of 15 | `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts -t "FROZEN"` |
  | T3-2 | the Q cases run S10, not the tree's script *(measured in revision)* | in `sweepFixture.ts`, `  cpSync(o.verifySrc ?? VERIFY_SRC, join(home, 'ccrc', 'deploy', 'verify-service.sh'));` becomes `  cpSync(VERIFY_SRC, join(home, 'ccrc', 'deploy', 'verify-service.sh'));` | R2 (`expected 0 to be 1`: S11's classifier passes the stamped stop on its first verify) and Q1–Q9, all ten tests (`the box was given S10, not this tree's script`; Q3 would also red on `noLoadState`): 11 of 15 | same |
  | T3-3 | the re-check reaches the script *(measured in revision)* | in `ccd/ccrc`'s re-check loop, `        r=0; bash "$verify" "${units[k]}" \|\| r=$?` (the line followed by `        if [ "$r" -eq 0 ]; then`) becomes `        r=1` | R1 and Q6 (`expected 2 to be 4`: no re-check call), R3 and Q9 ×2 (`code 1`), Q4 (`expected 3 to be 5`), Q5, Q7 and Q8 (`expected 1 to be 2`): 9 of 15 | same |
- [ ] **Step 7: Commit:** `test(update): S10, the script v0.0.80–v0.0.91 ship, is frozen and pinned by digest, and the NEW sweep is pinned with it — a rollback's pairing (wave 12, R19d; D-4069)`. Then run `topology-clean.test.ts`.

### Task 4: prose — README's sweep sentence, one long comment line, the wave-11 plan's record (R19c, R18 c–e; D-4071)

**Files:** `README.md`, `server/test/ccrc-doctor.test.ts`, `docs/superpowers/plans/2026-10-05-centralised-update-w11-sweep-window.md`.

- [ ] **Step 1: Re-measure:**
  ```bash
  grep -nF 'stay-up check (`deploy/verify-service.sh` on Linux), all of them in one shared window — a unit the post-restart listing' README.md
  grep -nF 'local vdir="" vjobs="${CCRC_SWEEP_VERIFY_JOBS:-128}"' ccd/ccrc
  grep -nF '[[ "$vjobs" =~ ^[1-9][0-9]{0,3}$ ]] || vjobs=128' ccd/ccrc
  grep -nF 'the supervisors are verified one at a time, as before wave 11' ccd/ccrc        # the no-scratch fallback
  grep -nF 'in 3.2 also BASH_ARGC, BASH_ARGV, BASH_LINENO, BASH_SOURCE, FUNCNAME and GROUPS), so the' server/test/ccrc-doctor.test.ts
  grep -c '^_upd_sweep_\(die\|launch\|stop\|kill\|replay\|spo\)() {' ccd/ccrc              # 6
  wc -l README.md                                                                        # 5732
  ```
  Then check each amendment's "Replace" text below with `grep -cF` against the wave-11 plan. Each must count exactly 1.
  Then read the recovered wave-done (`run-270-wave-done.md`, the precondition and Reading 3's ruling).
- [ ] **Step 2: README.** Replace these two lines:
  ```text
  stay-up check (`deploy/verify-service.sh` on Linux), all of them in one shared window — a unit the post-restart listing
  shows `activating` or `failed` is verified too — and a crash-like first failure gets ONE re-check, alone: it fails the
  ```
  with these five. The sentence's next line, `run (exit 1, …`, is unchanged.
  ```text
  stay-up check (`deploy/verify-service.sh` on Linux), all of them in one shared window (on Linux: for up to
  `CCRC_SWEEP_VERIFY_JOBS` units, default 128, given a scratch directory; more take one window per chunk, and with no
  scratch directory each unit is verified alone, in turn) — a unit that was active before the restart and that the
  post-restart listing shows `activating` or `failed` is verified too — and a crash-like first failure gets ONE
  re-check, alone: it fails the
  ```
  README goes from 5732 to 5735 lines. CLAUDE.md's `~5700` still holds, because `pools-prose`'s ratchet allows 100.
- [ ] **Step 3: `ccrc-doctor.test.ts`.** Split the one 187-character comment line. No other line moves.
  ```diff
  -    // read-only variables, five of this set in bash 3.2 (BASHOPTS arrived in 4.1) and six in 5.2; in 3.2 also BASH_ARGC, BASH_ARGV, BASH_LINENO, BASH_SOURCE, FUNCNAME and GROUPS), so the
  +    // read-only variables, five of this set in bash 3.2 (BASHOPTS arrived in 4.1) and six in 5.2; in 3.2 also
  +    // BASH_ARGC, BASH_ARGV, BASH_LINENO, BASH_SOURCE, FUNCNAME and GROUPS), so the
  ```
- [ ] **Step 4: The wave-11 plan's amendments (D-4071).** Apply each one, in order.
  - Each "Replace" text occurs exactly once in `docs/superpowers/plans/2026-10-05-centralised-update-w11-sweep-window.md` at `d2bac7ae` (prototype: A1–A19 measured at 19 of 19 applied once; A0 is new in revision, and its anchor, the title line, counts 1, measured).
  - Apply them with a short script that refuses a count other than 1. Never use `sed -i` over a pattern.
  - Each block below is indented two spaces for this list. Strip exactly two leading spaces from every line before matching.

  **A0. The dated note at the head (the brief's "dated note that says what changed and why").** Replace:

  ~~~~text
  # Centralised update management, wave 11: one shared verify window for the supervisor sweep, re-checked once (R12, sweep half), wave 10's residue (R13) and the auth reader's residue (R14 f–j): Implementation Plan
  ~~~~

  with:

  ~~~~text
  # Centralised update management, wave 11: one shared verify window for the supervisor sweep, re-checked once (R12, sweep half), wave 10's residue (R13) and the auth reader's residue (R14 f–j): Implementation Plan

  > **Amended 2026-10-06 by wave 12** (run 282; D-4071, residue R19(a), R19(c) and R18(c)–(e)), after this plan merged as part of #287. What changed, and why: D3's ruling and rows (it is Linux-only now, because BSD stat refuses its shim); W20's "not code -1" and the matching Global Constraint (the shipped W20 asserts code -1, and the clock); "five helpers" (six ship); D-3977's capital; T5-6's and T7-1's red sets and spelling (re-measured); the rows added during the wave and wave 12's own guard rows (re-measured, Tasks 2, 4 and 6); and two of D-3988's sentences that claimed more than was measured. Each changed sentence is marked *(2026-10-06, wave 12, …)* and names what it said before. Nothing else in this plan was changed.
  ~~~~

  **A1. R18(c), Architecture: the helper list.** Replace:

  ~~~~text
    - New, directly above `_upd_sweep` (Task 6): `_upd_sweep_die`, `_upd_sweep_launch`, `_upd_sweep_kill`, `_upd_sweep_replay` and `_upd_sweep_spo`.
  ~~~~

  with:

  ~~~~text
    - New, directly above `_upd_sweep` (Task 6): `_upd_sweep_die`, `_upd_sweep_launch`, `_upd_sweep_kill`, `_upd_sweep_replay` and `_upd_sweep_spo`. D-3988's fix round 2 added a sixth, `_upd_sweep_stop`, between `_upd_sweep_launch` and `_upd_sweep_kill` *(2026-10-06, wave 12, R18c; D-4071)*.
  ~~~~

  **A2. R18(c), Global Constraints: "The five new helpers".** Replace:

  ~~~~text
    - The five new helpers go ABOVE `_upd_sweep`, never inside it,
  ~~~~

  with:

  ~~~~text
    - The six new helpers (five planned, and D-3988's `_upd_sweep_stop`; *2026-10-06, wave 12, R18c; D-4071*) go ABOVE `_upd_sweep`, never inside it,
  ~~~~

  **A3. R18(c), File structure: "five new helpers".** Replace:

  ~~~~text
    - five new helpers above `:20813`, and `_upd_sweep`'s Linux verify block
  ~~~~

  with:

  ~~~~text
    - six new helpers above `:20813` (five planned, and D-3988's `_upd_sweep_stop`; *2026-10-06, wave 12, R18c; D-4071*), and `_upd_sweep`'s Linux verify block
  ~~~~

  **A4. R18(c), Task 6 Files: "the five new helpers".** Replace:

  ~~~~text
  - `ccd/ccrc`: the five new helpers, and `_upd_sweep`'s Linux verify block and its comment;
  ~~~~

  with:

  ~~~~text
  - `ccd/ccrc`: the five new helpers (six as shipped: D-3988 added `_upd_sweep_stop`; *2026-10-06, wave 12, R18c; D-4071*), and `_upd_sweep`'s Linux verify block and its comment;
  ~~~~

  **A5. R18(c), Task 6: "The five helpers go directly above".** Replace:

  ~~~~text
  The five helpers go directly above `_upd_sweep() {`, in this order:
  ~~~~

  with:

  ~~~~text
  The five helpers go directly above `_upd_sweep() {`, in this order. *(2026-10-06, wave 12, R18c; D-4071: `ccd/ccrc` ships six. D-3988's fix round 2 added `_upd_sweep_stop` between `_upd_sweep_launch` and `_upd_sweep_kill`; it is not printed below.)*
  ~~~~

  **A6. R18(c), D-3977: the lowercase sentence start.** Replace:

  ~~~~text
  (measured, system and user manager). no id ccd mints starts with a dot:
  ~~~~

  with:

  ~~~~text
  (measured, system and user manager). No id ccd mints starts with a dot:
  ~~~~

  **A7. R18(c), D-3977: its marker, at the end of the same entry.** Replace:

  ~~~~text
  It only narrows a pass, and closes the last of review 263 F2's named-unit inputs.
  ~~~~

  with:

  ~~~~text
  It only narrows a pass, and closes the last of review 263 F2's named-unit inputs. *(2026-10-06, wave 12, R18c; D-4071: the sentence "No id ccd mints starts with a dot" began with a lowercase "no".)*
  ~~~~

  **A8. R18(e), D-3988: "a stale pid is never signalled".** Replace:

  ~~~~text
  written after the launch and truncated after the reap, so a stale pid is never signalled.
  ~~~~

  with:

  ~~~~text
  written after the launch and truncated right after the reap, with `lpid` cleared first, so the INT handler cannot write the reaped pid back (the worker's A3). So a reaped pid stays on file only from the moment `wait` returns until the truncation, a few builtins later. A signal that lands in that window can TERM that pid once, and that pid names another process only if the kernel reused it in that instant. *(2026-10-06, wave 12, R18e; D-4071: this sentence said "so a stale pid is never signalled", which overclaims that window. `_upd_sweep_stop`'s header in `ccd/ccrc` still says "(a stale pid is never signalled)"; it is shipped code, so its rewording is wave 13's.)*
  ~~~~

  **A9. R18(e), D-3988: "W21 asserts at most 10 + 50".** Replace:

  ~~~~text
  against all 120 without the check; W21 asserts at most 10 + 50.
  ~~~~

  with:

  ~~~~text
  against all 120 without the check. W21 asserts `started < 120`: the mutant that drops the check starts all 120 in every run measured, and a bound on the scheduler-dependent count could flake on a slow runner (the worker's A2). *(2026-10-06, wave 12, R18e; D-4071: this sentence said "W21 asserts at most 10 + 50", the bound first drafted.)*
  ~~~~

  **A10. R19(c), Task 6 case table: W20's "(not code -1)".** Replace:

  ~~~~text
  | The sweep ends on its own SIGTERM, well inside the spawn timeout (not code -1). Then collect,
  ~~~~

  with:

  ~~~~text
  | The sweep ends on its own SIGTERM: `code` is -1, because a bash ended by an unhandled SIGTERM has no exit status, so `runSweep`'s `r.status ?? -1` returns -1. That it ended on its OWN signal, and not on the spawn timeout, is the clock: under 20 s, against the 30 s spawn timeout ((a)'s gate alone would hold it 10 s; in (b) the foreground verify sends the TERM). *(2026-10-06, wave 12, R19c; D-4071: this said "well inside the spawn timeout (not code -1)", and the shipped W20, a `describe` of two `itLinux` cases rather than an `it.each`, asserts `toBe(-1)` and `elapsed < 20_000`.)* Then collect,
  ~~~~

  **A11. R19(c), Global Constraints: the "code -1" line.** Replace:

  ~~~~text
    - A row is done only with a measured red count and the assertion that fired. A spawn timeout is "code -1", a suite hang is "killed by timeout(1)", never "red".
  ~~~~

  with:

  ~~~~text
    - A row is done only with a measured red count and the assertion that fired. A spawn timeout is "code -1", a suite hang is "killed by timeout(1)", never "red". *(2026-10-06, wave 12, R19c; D-4071: code -1 is also a bash that its own unhandled signal ended, W20; the clock tells the two apart.)*
  ~~~~

  **A12. R19(a), Task 7: the "D0–D4 and D6–D8 are `it`" sentence.** Replace:

  ~~~~text
  - D0–D4 and D6–D8 are `it`, so they run on every platform,
  ~~~~

  with:

  ~~~~text
  - D0–D4 and D6–D8 are `it`, so they run on every platform *(2026-10-06, wave 12, R19a; D-4068: except D3, which is `itLinux` since wave 12, because BSD stat refuses its GNU shim; D3d covers macOS)*,
  ~~~~

  **A13. R19(a), Task 7 case table: D3's row.** Replace:

  ~~~~text
  | rc 1; `update.json` byte-identical; stdout has `update: report: skipped — ` |
  | D4 |
  ~~~~

  with:

  ~~~~text
  | rc 1; `update.json` byte-identical; stdout has `update: report: skipped — `. *Linux only since 2026-10-06, wave 12 (R19a; D-4068)* |
  | D4 |
  ~~~~

  **A14. R19(a), Coordinator rulings: a dated sub-bullet under "Task 7's D3 on a Linux runner".** Replace:

  ~~~~text
    - T7-2's and T7-4's red sets keep D3. D3d is a macOS-only red, which the coordinator reads on `test-macos`.
  ~~~~

  with:

  ~~~~text
    - T7-2's and T7-4's red sets keep D3. D3d is a macOS-only red, which the coordinator reads on `test-macos`.
    - *(2026-10-06, wave 12, R19a; D-4068.)* "D3 runs on every platform" went red on the macOS legs: BSD stat
      refuses the GNU `stat -c %s` shim, so the foreign report again reads as this run's own there. D3d, on the real
      `_plat_size`, passed on the same leg (review 281). D3 is now `itLinux`, its body and shim unchanged. On Linux,
      T7-2 and T7-4 still red D3 (re-measured in wave 12: T7-4 reds D0 and D3; T7-2 reds D2, D3, D4, D6, D7, D8).
  ~~~~

  **A15. R18(d), Task 5 mutation table: T5-6.** Replace:

  ~~~~text
  | move the two `LoadState` lines to just above `if [ -e "$reg/$id.stopped" ]` | V1 and V18 (exact logs), and (server) X2 and X3b (exact logs). V17 and X4 stay green: their order is unchanged | both |
  ~~~~

  with:

  ~~~~text
  | move the two `LoadState` lines to just above `if [ -e "$reg/$id.stopped" ]` | V1 and V18 (exact logs), V23, V25 and V26 (each asserts no `LoadState` call, and the moved query now runs before its refusal), and (server) X2 and X3b (exact logs). V17 and X4 stay green: their order is unchanged. *(2026-10-06, wave 12, R18d; D-4071: the row listed V1, V18, X2 and X3b. Re-measured: agent 5 of 85 red, V1, V18, V23, V25, V26; server deliberate-stop 2 of 8, X2, X3b; the window file 0 red.)* | both |
  ~~~~

  **A16. R18(d), Task 7 mutation table: T7-1.** Replace:

  ~~~~text
    | T7-1 | one window | restore the per-unit loop (`for u in …; do _ccrc_job_stayed_up "$u" \|\| …; done`) with the new die | D1 (order) | `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "supervisor sweep"` |
  ~~~~

  with:

  ~~~~text
    | T7-1 | one window | restore the per-unit loop (`for u in …; do _ccrc_job_stayed_up "$u" \|\| …; done`) with the new die. *As measured (2026-10-06, wave 12, R18d; D-4071):* the line `if [ "${#kicked[@]}" -gt 0 ] && ! _ccrc_job_stayed_up "${kicked[@]}"; then` becomes the four lines `local -a sbad=() swhy=()`, `for u in ${kicked[@]+"${kicked[@]}"}; do _ccrc_job_stayed_up "$u" \|\| { sbad+=("$u"); swhy+=("$CCRC_STAYED_DETAIL"); }; done`, `CCRC_STAYED_BAD=(${sbad[@]+"${sbad[@]}"}); CCRC_STAYED_WHY=(${swhy[@]+"${swhy[@]}"})` and `if [ "${#kicked[@]}" -gt 0 ] && [ "${#sbad[@]}" -gt 0 ]; then`, so every verdict and line is kept and only the call order moves | D1 (order) only: 1 of 20 red, the order `alpha, alpha, beta, …` | `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "supervisor sweep"` |
  ~~~~

  **A17. R18(d), Task 2 mutation table: T2-6 and T2-7 after T2-5.** Replace:

  ~~~~text
    | T2-5 | the reason never names the variable (A1) | append ` ($name)` to the `name)` arm's `BUE_WHY` and `local name` in `_box_unit_env_shell` set from a re-read of the line | U5's `not.toContain(name)` assertions, all thirteen | same |
  ~~~~

  with:

  ~~~~text
    | T2-5 | the reason never names the variable (A1) | append ` ($name)` to the `name)` arm's `BUE_WHY` and `local name` in `_box_unit_env_shell` set from a re-read of the line | U5's `not.toContain(name)` assertions, all thirteen | same |
    | T2-6 | D-3987's `HISTCMD` *(added in the wave; mutation text and red set wave 12's, 2026-10-06, R18d, D-4071)* | `\|FUNCNAME\|GROUPS\|HISTCMD\|OPTIND)` becomes `\|FUNCNAME\|GROUPS\|OPTIND)` | U5 (1 of 2 matched red): its `HISTCMD` name row and the `HISTCMD=1/0` and `exposure HISTCMD=1+` inputs read rc 0 `on` | same |
    | T2-7 | D-3987's `OPTIND` *(added in the wave; mutation text and red set wave 12's, 2026-10-06, R18d, D-4071)* | `\|FUNCNAME\|GROUPS\|HISTCMD\|OPTIND)` becomes `\|FUNCNAME\|GROUPS\|HISTCMD)` | U5 (1 of 2 matched red): its `OPTIND` name row and the `OPTIND=1/0`, `OPTIND=09` and `export OPTIND="1/0"` inputs read rc 0 `on` | same |
  ~~~~

  **A18. R18(d), Task 4 mutation table: T4-7 after T4-6.** Replace:

  ~~~~text
    | T4-6 | the frozen sweep's helpers (T-8) | in a scratch copy pointed at by a transient `CCRC_SRC` edit, change `s="${s:0:200}"` to `s="${s:0:201}"` inside `_upd_json_str` | X0c only | same |
  ~~~~

  with:

  ~~~~text
    | T4-6 | the frozen sweep's helpers (T-8) | in a scratch copy pointed at by a transient `CCRC_SRC` edit, change `s="${s:0:200}"` to `s="${s:0:201}"` inside `_upd_json_str` | X0c only | same |
    | T4-7 | containment covers the env the spawn CARRIES (fix round 1) *(added in the wave; mutation text and red set wave 12's, 2026-10-06, R18d, D-4071)* | in `sweepSpawn` (`server/test/sweepFixture.ts`), `assertContained({ home: box.home, env });` becomes `assertContained(box);` | X1 only (1 of 8): `expected [Function] to throw an error` | same |
  ~~~~

  **A19. R18(d), Task 6 mutation table: the rows added during the wave, after T6-K3, and wave 12's own guard rows.** Replace:

  ~~~~text
    | T6-K3 | a pid of 1 or less is refused (verify L1) | delete `[ "$p" -gt 1 ] \|\| continue` in `_upd_sweep_kill` | W0 (text) only. No case plants such a pid file, and none may: under this mutant a planted `1` runs `kill -TERM -- -1`, which signals every process the user owns | same |
  ~~~~

  with the text below. In its first italic sentence, keep the ONE bracketed alternative that is true and drop the brackets: (i) if run 270's wave-done or task reports were obtained, the first; otherwise (ii), the second. Under (i), where the worker's own mutation for a row differs from this table's, add the worker's as a second line of that row, with its own re-measured red set.

  ~~~~text
    | T6-K3 | a pid of 1 or less is refused (verify L1) | delete `[ "$p" -gt 1 ] \|\| continue` in `_upd_sweep_kill` | W0 (text) only. No case plants such a pid file, and none may: under this mutant a planted `1` runs `kill -TERM -- -1`, which signals every process the user owns | same |

    *(2026-10-06, wave 12, R18d; D-4071.) The guards D-3988's finishing changes name, re-measured through the real file with `-t "W2[12]"` (12 cases). The wave-11 worker added rows for them during the wave and recorded them only in its reports; the ledger names those rows "T6-INT2 to INT5", the wave-12 brief "T6-INT, T6-INT2a, T6-INT4, T6-INT5". [(i) Their mutation text below was checked against the worker's reports, and where it differs both are given.] [(ii) Those reports could not be read in wave 12: the ids below are the brief's, and the mutation text is wave 12's reading of D-3988's own sentences, not the worker's.]*

    | # | Guard | Mutation | Goes red (measured in wave 12) | Command |
    |---|---|---|---|---|
    | T6-INT | the INT handler (D-3988: "The INT handler stays") | the `trap '… kill -INT "$BASHPID"' INT` line becomes `:` | the two caller-trap W21 cases, after the launch loop and in it (2 of 12): `the sweep ended on its own, within 15 s` / `within 20 s` | `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts -t "W2[12]"` |
    | T6-INT2a | the caller's INT trap is put back | `eval "${ltrap:-trap - INT}"` becomes `:` | W22 only (1 of 12): the trap left is the sweep's own | same |
    | T6-INT4 | the per-batch removal of `stop` and `looped` | `; rm -f "$vdir/looped" "$vdir/stop"` deleted from the batch's first line | the second-batch W21 case (1 of 12): `launcher leaks` (3 survivors in a group never TERMed). A race: k of 16 runs red in wave 12 (D-3988 measured 12 in 16) | same, 16 times |
    | T6-INT5 | the loop-top stop check | `if [ -e "$vdir/stop" ]; then break; fi` becomes `:` | the four `full` launch-loop W21 cases (4 of 12): `expected 120 to be less than 120` | same |

    *Wave 12's own guard rows (2026-10-06, R18d; D-4071), not rows of wave 11's. Two red nothing: the guards they name are unpinned, and are reported to the coordinator as residue.*

    | # | Guard | Mutation | Goes red (measured in wave 12) | Command |
    |---|---|---|---|---|
    | T6-INT-W | the handler's own `launcher.proc` write | `then echo "$lpid" >"$vdir/launcher.proc"; _upd_sweep_stop` becomes `then _upd_sweep_stop` | nothing (0 of 12). The window it covers, between the launch and the sweep's own write, is not pinned | `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts -t "W2[12]"` |
    | T6-STOPW | `_upd_sweep_stop` waits for the launcher | delete `wait "$p" 2>/dev/null` | the launch-loop `SIGTERM to the sweep's shell (full)` case (1 of 12): `launcher leaks` (3). A race: k of 8 runs red in wave 12 | same, 8 times |
    | T6-RERAISE | the handler re-raises INT, so the caller reads an INT death (D-3988: "`exit 130` would not read as an INT death") | in the INT trap, `kill -INT "$BASHPID"` becomes `exit 130` | nothing (0 of 12): W21 accepts `ended.signal === sig \|\| ended.code === status` with status 130, so exit 130 passes every SIGINT arm. Not pinned | same |
  ~~~~

  In every row above, the worker replaces each "k" with its own count, and each red set with its own measurement where it differs, reporting the difference in the wave-done.

- [ ] **Step 5: Re-measure the rows Step 4 adds, through the real file.** Each row carries the prototype's measurement. Re-run each one, and record your result beside it in the wave-done. A race row runs N times (Global Constraints).

  | # | Command | Prototype |
  |---|---|---|
  | T5-6 | agent `deploy-verify`, server `ccrc-sweep-deliberate-stop` and `ccrc-sweep-window`, each whole | agent 5 of 85 (V1, V18, V23, V25, V26); deliberate-stop 2 of 8 (X2, X3b); window 0 of 64 |
  | T7-1 | `ccrc-update -t "supervisor sweep"` | 1 of 20 (D1) |
  | T2-6, T2-7 | `ccrc-doctor -t "U5"` | 1 of 2 each (U5) |
  | T4-7 | `ccrc-sweep-deliberate-stop` | 1 of 8 (X1) |
  | T6-INT, T6-INT2a, T6-INT5, T6-INT-W, T6-RERAISE | `ccrc-sweep-window -t "W2[12]"` (12 cases), once each | 2, 1, 4, 0, 0 of 12 (T6-RERAISE: measured by the prototype and again by the attack) |
  | T6-INT4 (race, N = 16), T6-STOPW (race, N = 8) | the same, N times each | 1 of 12 in 1 run of 1, each |
- [ ] **Step 6: Run:**
  - `cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t "ccrc doctor: auth"`. **Expected:** `Tests 64 passed`.
  - The README-pinning files (Task 5 Step 3).
  - After `git fetch origin main`: `deviation-refs`, `dtbd` and `topology-clean`.
- [ ] **Step 7: Commit:** `docs(update): wave 11's plan says what shipped and what was measured — a dated head note, W20's code, six helpers, T5-6's and T7-1's rows, the rows added in the wave, D-3988's two overclaims; README's sweep sentence names the active-before rule and the window's bound (wave 12, R19c, R18c-e; D-4071)`.

### Task 5: The gate and the PR

- [ ] **Step 1: Start from a merged, clean tree.**
  ```bash
  git status --porcelain
  git fetch origin main
  git merge-base --is-ancestor origin/main HEAD && echo "origin/main is in HEAD" || echo "MAIN MOVED"
  ```
  - On `MAIN MOVED`, run `git merge --no-edit origin/main`, keep both sides of every hunk, and record `git show --remerge-diff HEAD`.
  - Stop and report if `main` changed any of these: `_upd_sweep`, its six helpers, `deploy/verify-service.sh`, `sweepFixture.ts`, the window file, D3, or the README sentence.
- [ ] **Step 2: Dependencies:** run `npm ci` in `server/`, `agent/` and `pwa/`, wherever `node_modules` is absent.
- [ ] **Step 3: Server, one file per call,** in the foreground, timeout ≥ 600000 ms:
  - `ccrc-sweep-window` (**64**) and `ccrc-sweep-deliberate-stop` (**8**).
  - `ccrc-update` in three parts:
    - `-t "supervisor sweep"` (**20**);
    - `-t "ccrc (rollback|versions|watchdog)|killed-flip state|is a statement about the version"` (**169**);
    - `-t "^(?!.*(supervisor sweep|ccrc (rollback|versions|watchdog)|killed-flip state|is a statement about the version))"` (**313**).

    `vitest list test/ccrc-update.test.ts | wc -l` must print **502** on Linux (measured: 502 = 20 + 169 + 313).
  - `ccrc-doctor` in three parts:
    - `-t "ccrc doctor: auth"` (**64**);
    - `-t "ccrc doctor: (wrappers|fleet|codex|models|pools)"` (**211**);
    - `-t "^(?!.*ccrc doctor: (auth|wrappers|fleet|codex|models|pools))"` (**395**).

    `vitest list` must print **670**.
  - `single-definition -t "supervisor sweep"`, then `single-definition` whole; `runbook-holds`.
  - The fifteen README-pinning files: `box-token-census`, `child-reclaim-prose`, `ccrc-install-graphify`, `coordinator-skill`, `crossrepo-prose`, `license`, `pools-prose`, `readme-roster-mirror`, `readme-holds`, `oss-metadata`, `reviewer-skill`, `topology-clean`, `session-hook`, `worker-skill`, and `ccrc-update` (run above).
  - `typecheck-tests` and `dtbd`.
  - In `agent/`: `./node_modules/.bin/vitest run test/deploy-verify.test.ts` (**85**; unchanged, it reads S11).

  A red in a known load flake (CLAUDE.md's list, which includes `session-hook` and `typecheck-tests`) is re-run IN ISOLATION before it is called a break.
- [ ] **Step 4: The ledger and scope guards, last:**
  ```bash
  git fetch origin main
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
  cd .. && git diff --stat origin/main...HEAD -- ccd deploy agent/src server/src pwa shared '*.service' '*.timer' install.sh CLAUDE.md agent/CLAUDE.md .github server/test/ccdWsHelpers.ts server/test/ccrcContainment.ts server/test/containedTools.ts server/test/platformFixtures.ts server/test/fixtures/verify-service-pre-wave10.sh server/test/fixtures/upd-sweep-pre-wave11.bash   # prints nothing
  git diff --stat origin/main...HEAD     # exactly File structure's New and Changed lists
  git ls-files -s server/test/fixtures/verify-service-pre-wave11.sh   # mode 100644
  sha256sum server/test/fixtures/verify-service-pre-wave11.sh          # d066a318…5cf8
  ```
  Then the D-number check: every D-token the branch adds is either already on `origin/main`, or is one of 4068–4076 and defined in this plan. It prints nothing:
  ```bash
  PLAN=docs/superpowers/plans/2026-10-06-centralised-update-w12-wave11-residue.md
  git diff origin/main...HEAD | grep '^+' | grep -oE 'D-[0-9]{4}\b' | sort -u > "$SCRATCH/dnums"
  while read -r d; do
    git grep -qwF -e "$d" origin/main -- docs/superpowers && continue          # cited as it stands
    case "${d#D-}" in
      406[89]|407[0-6]) grep -qE "^- \*\*$d\*\* — " "$PLAN" || echo "UNDEFINED $d" ;;
      *) echo "OUTSIDE THE BLOCK OR THE RESERVE: $d" ;;
    esac
  done < "$SCRATCH/dnums"
  ```
- [ ] **Step 5: The PR,** from the workspace branch.
  - Its first paragraph says that no shipped runtime code changes, so the merge moves no box's behaviour, and that this PR is what the `stable` promotion waits on: R19, with R18(e)'s prose point (the 02:35 ruling's "with F1 to F4 and R18(e)").
  - It has one section per task, carrying D-4068 to D-4071 by number, and a line naming the inputs this plan could not read (Risk notes), and whether run 270's wave-done was obtained.
  - Links to the plan and the files are GitHub `blob/main` URLs built from the repository's own remote (`git remote get-url origin`). Until merge, put the PR's `/files` view beside each one. Never a docserver URL.
  - The body is hand-written, and ends with the attribution line the session's instructions give.
  - Every commit's author and committer are the noreply identity: `git log --format='%an <%ae> | %cn <%ce>' origin/main..HEAD`.
  - After CI starts, read the PR's `select tests` summary. It must list `ccrc-sweep-window.test.ts`, `ccrc-sweep-deliberate-stop.test.ts`, `ccrc-update.test.ts`, `ccrc-doctor.test.ts`, and the README-pinning files. If one is missing, run `gh workflow run ci.yml --ref <branch> -f mode=full` and name that run in the wave-done.
- [ ] **Step 6: The wave-done, in the same turn as the push.** It carries:
  - the tip sha, the PR number, and the remerge-diff result if there was a merge;
  - each suite's result, the `-t` parts with their counts against `vitest list`, and the load;
  - every mutation row (T1-1 … T3-3, and Task 4 Step 5's) with its measured red set against the listed set and the assertion that fired; for races, k of N;
  - whether run 270's wave-done mail was obtained, which of A19's two header sentences was kept, and any row whose mutation there differs from this plan's;
  - the guards measured unpinned (T6-INT-W, T6-RERAISE), as residue for the coordinator to place;
  - the macOS cases for the coordinator to read: on `test-macos`, D3 must report skipped and D3d passed;
  - any reserve number spent, defined in this plan in the commit that cites it.

## Readings (for the coordinator to rule; each was chosen where no ruling decided it)

1. **D3 becomes `itLinux`, not a portable shim** (D-4068). This is the coordinator's stated preference. A portable shim (`_plat_size() { wc -c < "$1"; }`) would keep D3 running on macOS. But D3d already runs the real primitive there, so the shim would add a second macOS case that tests the shim, not the code.
2. **F1's plant has two shapes** (W17e (a) and (b)).
   - (a) is a unit that was crash-looping before the restart: it is in the pre-restart listing, but not `active`. systemd's try-restart DOES restart such a unit (from systemd's source; not measured, since no real unit may be driven). So (a) pins the shipped `before` = ACTIVE choice, and its comment says so (row T2-3 shows only (a) sees that choice).
   - (b) is a unit the pre-restart listing does not show at all: one that `ccd` started between the two listings. try-restart leaves it alone, so (b) is the "not touched" shape.
   - The filter's mutant reds both.
   - The crash words are `activating` for (a) and `failed` for (b), so both of the listing's words are covered.
   - The stub's `--state=failed` listing stays empty, so item 3's warning (wave 13) never fires here.
3. **The rows added during wave 11 are re-measured with this plan's mutation text** (D-4071; Risk notes). The ledger names them "T6-INT2 to INT5", and the brief "T6-INT, T6-INT2a, T6-INT4, T6-INT5"; this plan uses the brief's ids and says in the amended plan that they are wave 12's unless run 270's reports were read. The mapping chosen:
   - T2-6 and T2-7 are D-3987's two names.
   - T4-7 is fix round 1's containment on the env the spawn carries (X1).
   - The four T6-INT rows follow the order in which D-3988's "finishing changes" names them:
     - T6-INT: the INT handler;
     - T6-INT2a: the caller-trap restore (W22);
     - T6-INT4: the per-batch removal;
     - T6-INT5: the loop-top stop check.
   - Three more rows are this wave's own, in a table of their own:
     - T6-INT-W, the handler's own `launcher.proc` write, which reds nothing;
     - T6-STOPW, `_upd_sweep_stop`'s `wait`, which is a race;
     - T6-RERAISE, the handler's re-raise, which reds nothing.
   - The worker asks the coordinator for run 270's wave-done (mail 3610) first. If it says otherwise, the worker records both, and the coordinator rules which the plan keeps. *(Superseded by the ruling on Reading 3: the wave-done is recovered, and its mapping wins.)*
4. **R18(d)'s pgid-filter clause is in neither wave's list as scoped at 02:45** (Not in this wave). The options:
   - (a) place it on wave 13's list explicitly, so it is not lost (chosen: the worker names it in the wave-done as residue);
   - (b) one sentence beside `collect`'s comment in this wave, saying that dropping the exception reds nothing by construction, because it only absorbs a race that no case plants.

   This plan does (a). If (b) is ruled, it is a comment-only change to the window file.
5. **The README sentence speaks of chunks, not of "128 units or fewer".** The ledger's wording is "one shared window holds for 128 units or fewer, given a scratch dir". The sentence instead:
   - names the knob and its default, because `CCRC_SWEEP_VERIFY_JOBS` overrides the default;
   - says what more units get: one window per chunk;
   - says what no scratch dir gives: one unit at a time.

   Both behaviours are measured in the shipped code.
6. **D-3988's stale-pid sentence is reworded to the window it has** (R18e). From the moment `wait` returns until `launcher.proc` is truncated, a signal can TERM the reaped pid once. This plan does not claim the window is a microsecond. It says "a few builtins", which is what the code shows.
7. **The Q cases are a new describe, not rows in the S0 describe.** So `-t "FROZEN"` selects all fifteen rollback cases (measured), and each script's cases sit under a describe of their own.
8. **The unpinned guards go to wave 13, or are pinned here.** T6-INT-W (the handler's own `launcher.proc` write) and T6-RERAISE (the INT re-raise; W21's SIGINT arms accept exit 130) both red nothing. Pinning T6-RERAISE would tighten W21's SIGINT-to-shell arms to `signal === 'SIGINT'` — a test-only change, so it could ride wave 12, but it is a new pin the scope did not list. This plan records both as rows and leaves the pins to the coordinator (default: wave 13's list, with `_upd_sweep_stop`'s shipped "(a stale pid is never signalled)" comment and the pgid clause).
9. **A unit `activating` before the restart is restarted, then neither verified nor warned about** (attack finding F1, new residue). The sweep's `before` takes only `active`, while systemd's try-restart restarts an activating unit. Whether the sweep should verify (or warn about) such a unit is a `ccd/ccrc` question for wave 13, beside item 3. W17e (a) pins the current choice and would need to change with it.
10. **D-4071 is kept as a number.** The brief allows amending a merged plan's prose and reserves D-numbers for real departures. This plan numbers the amendment because it changes that plan's record of what its pins red (T5-6, T7-1) and adds measured rows it never carried; D-3981 numbered the same act, while D-3830 did not. If the coordinator rules it unnumbered, the markers cite D-3830 and D-3981 instead, and the reserve becomes numbers 4071 to 4075.
11. **Race rows run a named N.** T6-INT4 runs 16 times (D-3988's own count) and T6-STOPW 8, recorded as k of N; a 0-of-N is reported, not taken as a changed red set. The coordinator may set other counts.
12. **`ccrc-doctor`'s two non-auth parts (211 + 395) are required locally.** Its change is one comment line, and the whole file overran 595 s here. The coordinator may leave them to CI's selection instead.

## Coordinator rulings on this plan's readings (2026-10-06)

The coordinator ruled every reading on 2026-10-06 at 04:35 UTC. The plan was drafted by workflow `wf_a11d694f-c70`:
- a scout;
- an Opus drafter that prototyped in its own worktree;
- three Opus attack lenses (pins, fixtures, scope), with 23 findings;
- an Opus reviser, who applied 22 and made one a reading.

These rulings win over any sentence above that disagrees with them. Do not reshape one. If one cannot be done as written, stop that item and mail the coordinator the input and the result.

- **Reading 1: as written.** D3 is `itLinux`. D3d covers Darwin on the real primitive.
- **Reading 2: as written.** Both W17e shapes stay. W17e (a)'s comment says that it pins the shipped `before` = ACTIVE choice, which is wave 13's question (Reading 9). It does not say that this choice is right.
- **Reading 3: ruled otherwise. The wave-11 worker's own record is recovered, and its mapping wins.** It is `run-270-wave-done.md`; its "Red-first, per task" section is the source. The mapping:
  - **T6-INT:** drop the INT handler. Reds the two caller-trap W21 cases.
  - **T6-INT4:** drop the caller-trap restore. Reds W22.
  - **T6-INT2a:** drop the loop-top stop check. Reds 4 launch-loop cases at `< 120`.
  - **T6-INT5:** drop the per-batch `rm -f looped stop`. Reds the second-batch case in 3 of 4 runs, so it is a race row: N = 8, recorded as k of N.
  - **T4-7:** remove the containment check on the env the spawn gets. Reds X1.
  - **T2-6:** reds the 7 HISTCMD assertions. **T2-7:** reds the 9 OPTIND assertions.
  - **T5-6:** also reds V23, V25 and V26, the plan's under-listing.
  - **T7-1:** respelled as the whole block replaced with a die-on-first loop, it reds D1, D2, D6, D7 and D8. The isolated mutant that would red D1 alone was reasoned, never measured. Record it that way.
  - **How to record them:** add each row to the amended plan as the wave-11 worker's measured set, citing run 270's wave-done (mail 3610). Then re-measure it yourself.
    - A re-measured set that differs is recorded BESIDE the worker's, never instead of it, and named in the wave-done.
    - The task reports were not recovered, so a row the wave-done does not describe is this wave's own.
  - The plan's three own rows (T6-INT-W, T6-STOPW, T6-RERAISE) stay in a table of their own, labelled wave 12's.
- **Reading 4: (a).** The pgid-filter clause goes on wave 13's list. The ledger names it there.
- **Reading 5: as written.** It holds provided the sentence stays true of every shipped arm and the fifteen README-pinning files are green.
- **Reading 6: as written** ("a few builtins").
- **Reading 7: as written** (the Q cases get a describe of their own).
- **Reading 8: T6-RERAISE is pinned in this wave; T6-INT-W goes to wave 13.**
  - **Why:** the re-raise exists because the coordinator ruled it on 2026-10-05 (answer mail 3565: "Re-raise rather than `exit 130`"). A guard that the coordinator ruled into the live sweep ships with a test that reds when it goes, and the pin is test-only, in a file this wave already edits.
  - **The change:** tighten W21's SIGINT-to-the-shell arms to `signal === 'SIGINT'`, in place of accepting exit 130. The mutation row drops the re-raise, and the tightened arms must red. Spend reserve number 4072 on this pin, defined under Task 2 or 3 in the commit that first cites it.
  - **The stopping line:** run the tightened arms 8 times under load. If any no-mutation run fails, revert the tightening, record the measurement, and list the pin for wave 13 instead. Do not respell it a second time.
  - **To wave 13:** T6-INT-W, the shipped "(a stale pid is never signalled)" comment in `_upd_sweep_stop`, and the pgid clause.
- **Reading 9: wave 13, beside item 3.** A unit that reads `activating` before the restart is restarted, and then neither verified nor warned about. The ledger lists it there.
- **Reading 10: keep D-4071 as a number.** The reserve stays 4072 to 4076, and Reading 8's ruling spends 4072.
- **Reading 11: as written.** T6-INT4 at N = 16, T6-STOPW at N = 8, and T6-INT5 at N = 8 (Reading 3), each recorded as k of N.
- **Reading 12: ruled otherwise.**
  - Locally, run `ccrc-doctor`'s auth part only (`-t "ccrc doctor: auth"`, 64 cases). The change is one comment line.
  - The PR's selection must list `ccrc-doctor.test.ts`. CI runs the whole file there, and every Linux leg must be green.
  - If the selection does not list it, dispatch a full run (`gh workflow run ci.yml --ref <branch> -f mode=full`), and that run arbitrates.
- **One addition, from the recovered review: Q10.** Review 281 measured ten S10 shapes, and the plan has nine. The tenth is "crash-shaped failed+purged 1".
  - **Q10:** a unit missing from the active listing, crash-listed `failed`, with its registry row purged. It is verified, and it fails with S10, after its re-check.
  - Q10 checks the digest of the script its box ran, as every Q case does. Its row says which is-active count it asserts.
  - Task 3's `-t "FROZEN"` count becomes 16. T3-2's red set gains Q10.
  - No new deviation number: it is a case under D-4069.

## As built (the wave-12 worker's record, 2026-10-06)

Written at 05:46 UTC, after the final whole-branch review's fixes. It records what shipped and what was measured, where the text above (which stays as drafted, with the rulings) says otherwise. Measured values only.

- **Q7 and Q10.** Task 3's text above plants Q7 with `listed: 'crash:failed'`, which is the shape the coordinator's Q10 names. As built, Q7 drops `listed`: its unit is IN the active listing, reads `failed` at every read, and has a purged row. Q10 is the crash-listed failed+purged shape. These are review 281's "failed+purged" and "crash-shaped failed+purged". The worker told the coordinator in mail 3620. Q7 now asserts that no crash listing is read (`count(box, LIST_CRASH)` is 0), so it cannot quietly become Q10: putting `listed: 'crash:failed'` back on Q7's unit reds Q7 alone (1 of 16), `expected 1 to be +0`.
- **Counts.** `-t "FROZEN"` is 16 (R0–R3 and Q0–Q10, Q9 twice). The window file is 65, where the text above says 64.
  - T3-1 measured 12 of 16 (Q0 and Q1–Q10).
  - T3-2 measured 12 of 16 (R2 and Q1–Q10).
  - T3-3 measured 10 of 16 (the listed set plus Q10, `expected 1 to be 2`).
  - D-4069's "Every Q1–Q9 case" is Q1–Q10.
- **Reading 8's pin** landed as its own commit after Task 3, and is defined as D-4072 above. The five SIGINT-to-the-shell arms of W21 assert `signal === 'SIGINT'`:
  - 8 of 8 green with no mutation, measured twice, by the implementer and by the task reviewer;
  - `exit 130` in place of the re-raise reds 5 of 5.
- **T6-RERAISE** is therefore pinned. The bullet under "Not in this wave" carries a dated marker saying so.
- **Reserve numbers:** 4072 spent (Reading 8). 4073 to 4076 are unspent.
