# Centralised update management, wave 16: the sweep names every unit truly, the verify script stops passing what it cannot read, and the Darwin helper, the fallback deploy and the versions arms close their residue: Implementation Plan

The coordinator cut wave 16 on 2026-10-15 at 22:11 UTC (programme ledger, "the cut to completion": waves 15 to 19 re-scoped, row 16 of the waves table). It is the node side's residue in files no claim holds today, plus two regions of `ccd/ccrc` and `deploy/deploy.sh` that the delegation programme's run 360 holds under claim 1423 and has consented to share (mail 5255, quoted under Global Constraints). Run 484 carries it, with deviation block 5135 to 5154. A workflow drafted this plan from `main` at `518789ad039188950f5b33872dccd67c022f03c0` (#426): a scout measured the residue census, then a drafter prototyped every task red-first in an isolated worktree and measured every mutation row. Every row and count marked *(prototype)* was run through the real files with vitest at that commit, on a loaded Linux box (load 21 to 70 on 16 cores), and restored with `cp` + `cmp`. Three attack lenses then read the draft and the prototype. Every change their findings caused is marked *(revised, unmeasured)*: the box stood at load 174 when the revision was written, so nothing was re-run, and the worker measures those lines first. Its file is `docs/superpowers/plans/2026-10-15-centralised-update-w16-sweep-and-verify.md`.

**`main` moved while the plan was drafted:** it reads `0b3ff2f62` (#384) at 00:25 UTC on 2026-10-16. #384 changes `ccd/ccrc` in eight hunks, none in a region this wave edits (the nearest adds one line inside `_upd_report`, after `_upd_sweep` ends). The prototype was merged with it as a measurement: no conflict, `bash -n` green on all three scripts, and the wave's suites green on the merged tree (Task 8 Step 1 lists them). The worker builds on `origin/main` as it finds it.

**The wave lands SECOND, after run 360** (the consent's condition). Run 360's unlanded branch (tip `d671549e0` at 20:38 UTC) edits `ccd/ccrc` and `deploy/deploy.sh` in hunks disjoint from this wave's. `git merge-tree` of the prototype against that tip is clean, and the merged `ccd/ccrc` (24222 lines) and `deploy.sh` (1303) both pass `bash -n`. Run 360's branch does conflict with #384 in two `ccd/ccrc` hunks (about `:2224` and `:16551`, both inside its own fenced regions; an attack lens measured it). That is run 360's landing round, not this wave's, and one more reason this wave waits. Once run 360 lands, the worker absorbs `main` by an ordinary merge and re-runs the gate (Task 8).

One line per task:
- **Task 1.** Item 3 (W16-b; D-5135): the sweep's "is FAILED — try-restart skipped it and this sweep did not verify it" warning names only a unit that was NOT active before the restart. A unit that was active before and reads `failed` after was restarted: it is verified (D-3984), or, when the crash listing cannot be read, it gets item G's true line instead. The fixture gains an opt-in `failedListed` plant, because the stub answered the `--state=failed` listing with nothing for every case, so nothing could reach that loop.
- **Task 2.** Reading 9's sweep half (W16-c; D-5136), ruled "warn only": a unit the pre-restart listing showed `activating` or `failed` is never verified, whatever it reads after the restart (the ruling's own sentence: "only units active before the restart are verified"), and never fails the update. It is named once, with its pre-restart word: "reads 'active' after it" when the post-restart listing shows it active, "is not active after it" when it does not. D-3984's narrowing stands. *(revised, unmeasured: the draft verified a prior unit that read active after; an attack lens measured that this failed the update for a crash-looping unit.)*
- **Task 3.** Two comments and a closure: the stale-pid sentence in `_upd_sweep_stop`'s header (W16-d), the pgid clause's comment in `collect` (W16-e), and T6-INT-W closed as unpinnable, with its measurement (W16-f; no shipped seam).
- **Task 4.** `deploy/verify-service.sh` (R18(a); D-5137, D-5138): a registry this user cannot search fails, and says why (W17-a); a stamp-absent, uuid-present row is re-read once, `STOP_INTERVAL` later, so a purge caught between its two unlinks passes as purged (W17-b).
- **Task 5.** The Darwin stay-up helpers (R18(b), R10j; D-5139 to D-5141): `sleep N & wait $!`, so an INT to the shell alone ends it at once (W17-c); no unit is a refusal (W17-d); a `launchctl print` that FAILED is told from a job launchd does not hold, and stays fail-closed (W17-e).
- **Task 6.** The fallback deploy (R8c, R10c(3); D-5142, D-5143): `prune_backups` refuses a `CCRC_BACKUP_KEEP` that is not a whole number from 0 to 9999, by replacing one line (W18-c); the sweep refuses when its listing fails (W18-d).
- **Task 7.** Test only (R8g, W18-e): `_ver_verdicts`' rc-1 WARN arms in `_ver_gc` and `cmd_versions` get sourced-function cases.
- **Task 8.** The gate, the wait for run 360, and the PR.

**Live effect, and the sequencing every task respects.** Deploy class fleet-first: auto moves the boxes as for every release, and the coordinator watches the first move onto each, read-only (the 2026-10-15 default for question 2 of 2026-10-06). The health gate restores a failed move (exit 4).
- The move INTO this wave runs the OLD sweep, the one this wave replaces, with the NEW `verify-service.sh`. The detached update re-execs the launcher, the launcher execs `~/ccrc/ccd/ccrc` before the flip, and that old sweep resolves `local verify="$BOX_TREE_DIR/deploy/verify-service.sh"` at call time, when `~/ccrc` already names the new tree (pinned by `ccrc-sweep-deliberate-stop.test.ts`'s X0b).
- So Task 4 protects the move into the wave. Tasks 1, 2 and 5 first run on the move AFTER it. Task 6 runs only when an operator runs `deploy.sh` from a checkout that has it. Task 7 ships no code.
- A rollback pairs this wave's sweep with an OLDER script (`~/ccrc` then names the kept tree). The sweep's changes are warnings, and one fewer verify call for a unit that was not active before; every call it does make is unchanged, so it holds with S11, S10 and S0 (the window file's Q and R families run it against S10 and S0; green, *prototype* on the draft's sweep).
- Risk notes argue the OLD-sweep-with-new-script pairing in full.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:**
- every claude-session@ unit that was `activating` or `failed` before the sweep's restart, or that was active before it and is not active after it, is named by exactly one true line; a unit the pre-restart listing showed `activating` or `failed` is never verified and never fails the update;
- the verify script can no longer pass a session unit whose registry it could not read, and no longer fails a deliberate stop caught mid-purge;
- the Darwin helper cannot swallow an INT, pass vacuously, or call an unmeasured job unloaded;
- the fallback deploy refuses a KEEP it would splice into a remote command, and refuses a sweep over a listing it never read;
- `_ver_verdicts`' rc-1 arms are reached by a test.

**Architecture:**
- No ring changes. No server, agent, PWA or `shared/` source changes. No change to `ccd/ccd`, `ccd/ccrc-doctor-checks`, a unit file or `install.sh`.
- **`ccd/ccrc`** (grows by about 45 lines, all at line 20998 or later, past every frozen citation; the prototype's 33 before the revision, *revised, unmeasured*):
  - `_upd_sweep`'s Linux arm: the failed-listing loop skips a unit in `before` (Task 1); a `prior` set from the pre-restart listing, kept out of `units` (into `pback` when the post-restart listing shows it active), and one more naming loop after item G's (Task 2). No `systemctl` call is added, so the sweep's argv order is unchanged.
  - `_upd_sweep_stop`'s header: one comment line reworded in place (Task 3).
  - `_ccrc_job_pid` and `_ccrc_job_stayed_up` (Task 5).
- **`deploy/verify-service.sh`** (grows by 22 lines, all below line 62): `STOP_WHY` initialised empty beside the knobs, a new `registry_evidence` function split out of `stopped_on_purpose`, the `-x` refusal, the one re-read, and `fail`'s cause line (Task 4).
- **`deploy/deploy.sh`** (grows by 5 lines, all after line 1109): `prune_backups`' `local keep=` line replaced by one line (Task 6, line-neutral; line 240 is NOT touched, *revised*); `SWEEP_CMD`'s listing captured (+2) with a 3-line comment above it.
- **Tests:**
  - `server/test/sweepFixture.ts`: the `failedListed` plant and the `activeListingRc` knob, both opt-in (Tasks 1, 2).
  - `server/test/ccrc-sweep-window.test.ts`: W17e (a)/(b) gain the Reading 9 line, the pgid comment, and a new describe W23a to W24f (Tasks 1 to 3).
  - `agent/test/deploy-verify.test.ts`: V31 to V32c (Task 4) and a new describe D1 to D2 (Task 6), both at the end of the file.
  - NEW `server/test/ccrc-darwin-job-helpers.test.ts` (Task 5) and NEW `server/test/ccrc-versions-warn-arms.test.ts` (Task 7).

**Tech Stack:**
- bash `set -uo pipefail` (`ccd/ccrc`, `deploy/verify-service.sh`) and `set -e` (`deploy/deploy.sh`). ccrc's floor is bash ≥ 4.4.
- vitest in `agent/` and `server/`; TypeScript on node `>=22.13.0`; no new dependency.
- systemd's `try-restart` restarts an `activating` unit and is a no-op on a `failed` one (wave 12's measurement, cited by W17e's comment). `claude-session@.service` is `Type=simple`, `Restart=always`, `RestartSec=3` (`ccd/claude-session@.service:18-25`): a unit reads `active` the moment it forks. launchd's `launchctl print` exits 113 for a job it does not hold (`_svc_is_active`'s rule).

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md`. No section changes. The inputs are the ledger's residue list (R8, R10, R14, R18), its 2026-10-06 wave-13 scoping entries, the 2026-10-15 21:41 rulings (Reading 9: warn only; "only units active before the restart are verified") and the 22:11 cut.

**Producers:**
- `main` at `518789ad0` (#426), re-measured against `0b3ff2f62` (#384).
- The node-side residue census of 2026-10-15 22:11, and this plan's scout (anchors, claims, the frozen citation census, the old-sweep pairing).
- This plan's prototype, measured in an isolated worktree, and three attack lenses over it (their measurements are cited where they are used).

**D-refs this plan cites as they stand:**
- D-3599: an unmeasured listing degrades the sweep (the ccrc twin of Task 6's refusal);
- D-3946 to D-3950: wave 10's deliberate-stop classifier; D-3976 to D-3978: R13(a)'s purged-arm guards;
- D-3972, D-3975, D-3983, D-3984 and D-3988: wave 11's sweep (the shared window, the Darwin helper's window, the re-check, the crash-shaped listing, the launcher's stop file);
- D-2605: `_reg_purge` removes `.generation` last;
- D-3423: `_keep_ok`, the KEEP validator.

## Not in this wave

Reviewers: do not raise these.

- **The backup prune's R14(a) (a shared `_bak_removable`) and R10i (`[ ! -L "$d" ]` in `_bak_list`).** They moved to wave 17 on 2026-10-15, because run 360's unlanded branch rewrites `_bak_list`, `_bak_prune` and `_bak_gc`. Task 6 touches only `deploy.sh`'s KEEP validation.
- **`_keep_ok`'s header sentence, "the ONE validator for every KEEP knob … `CCRC_BACKUP_KEEP` below".** After Task 6 it has a deliberate twin in `deploy.sh`, held equal by D1c. The sentence sits inside claim 1423's fenced `_bak_*` region, so its wording passes to wave 17's backup-prune work, which owns that region after run 360. *(revised)*
- **Wave 17's other halves:** `ccrc-api` placed by the install spine and removed by uninstall, Reading 9's DOCTOR half (a WARN that never FAILs), R10k (a refused sweep recorded as a detail word) and R8f. They wait for run 360 and claim 1403.
- **README's Reading 9 clause** (`README.md`, about `:812-813`). It belongs to the coordinator's docs PR, and claim 1403 holds `README.md`. This wave adds behaviour README does not yet describe; it falsifies nothing README says.
- **`ccrc-update.test.ts`'s G1b-control title.** That case ("a unit already FAILED in the unfiltered listing (never active) is not warned about …") now sees Task 2's line for `gamma`. Its assertions stay green (they forbid only `gamma.service was active before try-restart`), so only its title goes stale. The file is run-only here (Global Constraints): the title is residue for the next wave that may write it.
- **`deploy.sh`'s own item-3 line and Reading 9 there.** `SWEEP_CMD` verifies `--state=active` units only, so its "is FAILED — try-restart skipped it" line is true there. The ruling names `ccrc update` and doctor, not the fallback deploy, so `deploy.sh` is not taught `prior`. Its serial `|| exit 1` verify loop (README's "a serial loop with no re-check") is unchanged.
- **`_reg_purge`'s unlink order in `ccd/ccd`.** The ruling chose the verify script's re-read instead (claim 1396's file, and a multi-verb contract).
- **R18's caller-other-signal note, R17, R10c(1) and (2).** Closed on 2026-10-15 as documented limitations, each with a sentence in the docs PR. Task 5's comment states the first of them where it bites.
- **A pin for T6-INT-W.** The 2026-10-06 07:07 ruling allows one only without a new seam in shipped code, and none exists (Task 3; wave 12's Reading 8).
- **A frozen copy of the pre-wave-16 verify script as a new fixture.** Optional, and not required by the ruling (Reading 6).
- **The zero line's "try-restart had nothing running to restart"** when a `prior` unit was restarted (W24f). It is byte-identical by constraint (`runbook-holds`), and Task 2's line, printed just above it, names the unit (Reading 2).

## Global Constraints

- **The delegation programme's consent (mail 5255; claim 1423, run 360), as the brief carries it. Binding.** `ccd/ccrc` and `deploy/deploy.sh` are under claim 1423. Do NOT edit these regions (`main` numbering at `518789ad0`):
  - `ccd/ccrc`: the `BAK_*` globals (about `:1866-1870`), `usage` (about `:2031`), `:2223-2240`, `_inst_floor` (about `:16530`), `_upd_backup` (about `:20098`), `cmd_backup` and `_bak_list`/`_bak_prune`/`_bak_keepset`/`_bak_gc` (about `:22042-22345`, which holds `_keep_ok` and its header), and the VERB case (about `:24027`).
  - `deploy/deploy.sh`: about `:1218-1223`, the coordination-snapshot capture.
  - In `prune_backups`, change the KEEP validation ONLY: leave the directory selection and the delete line exactly as they are.
  - **The wave lands SECOND, after run 360.** Absorb `origin/main` by an ordinary merge once run 360 lands: never a rebase, a force-push or GitHub's Update branch. Keep both sides of every hunk. Then re-run `bash -n` on the three scripts and the `ccrc-update` and `deploy-verify` suites before the wave-done (Task 8 Step 1).
  - Every edit this wave makes to `ccd/ccrc` lies between `:20998` and `:21433` (`main` numbering at `518789ad0`): 900 lines below `_upd_backup` and 600 above `cmd_backup`, the nearest fenced regions. Every edit to `deploy.sh` is at `:242` (one line replaced in place, about 975 lines above the fenced capture) or at `:1109-1111` (about 105 lines above it, a separate hunk). `git merge-tree` against run 360's tip is clean (the header). Task 8 Step 5's hunk check holds this after the merge, when the numbers have moved.
- **Claims (ccrc-worker clause 11, with one stated exception).** *(revised)*
  - Before the first edit, claim exactly the paths no live claim holds, in one all-or-nothing call: `deploy/verify-service.sh`, `server/test/sweepFixture.ts`, `server/test/ccrc-sweep-window.test.ts`, `agent/test/deploy-verify.test.ts`, `server/test/ccrc-darwin-job-helpers.test.ts`, `server/test/ccrc-versions-warn-arms.test.ts`, and this plan's file.
  - Do NOT put `ccd/ccrc` or `deploy/deploy.sh` in that call. Claim 1423 holds both, so the call would answer 409 and acquire nothing (claims are all-or-nothing). The consent of mail 5255, scoped by the fences above, licenses this wave's edits in those two files without a claim of its own. That is the one stated exception to clause 11.
  - Once run 360 lands and claim 1423 ends, claim both files before the merge and the push. If claim 1423 is still live after run 360's PR has merged, mail the coordinator and push nothing.
  - A 409 on any other path stops the wave: mail the holder through the response's `mailHint`, and the coordinator.
- **Run-only files: never edit these.**
  - `server/test/ccrc-update.test.ts` and `server/test/install-census.test.ts` (claim 1388 at the brief; not live at 00:25 UTC, but run 360's branch edits both);
  - `server/test/single-definition.test.ts` (claim 1390 at the brief, claim 1436 of run 399 at 00:25 UTC) and `shared/api.ts`;
  - `ccd/ccrc-doctor-checks` and `server/test/ccrc-doctor.test.ts` (claim 1410);
  - `README.md`, `CLAUDE.md`, `ccd/session-hook.sh` and `server/test/session-hook.test.ts` (claim 1403);
  - `ccd/ccd` and `server/test/ccdWsHelpers.ts`, and every other path a live claim names.
  - Re-read the claims before the first edit, before each task's edit step, and before the push: `~/.local/bin/ccrc-api claims list --project ccrc-pwa` (a read). Live at 00:25 UTC on 2026-10-16, and unchanged at 01:11 UTC: 1403, 1404, 1407, 1409, 1410, 1411, 1412, 1413, 1414, 1419, 1423, 1425, 1435, 1436, 1437. None names a file this wave writes except 1423's two consented files. If a new claim names one, stop and mail the coordinator.
  - New pins go in NEW test files or in the unclaimed ones this plan names: `ccrc-sweep-window.test.ts`, `sweepFixture.ts`, `agent/test/deploy-verify.test.ts`. `ccrc-sweep-deliberate-stop.test.ts` is unclaimed and run only.
- **The scope check.** It prints nothing:

      git diff --stat origin/main...HEAD -- ccd/ccd ccd/ccrc-doctor-checks ccd/session-hook.sh ccd/ccrc-api shared server/src agent/src pwa \
        server/test/ccrc-update.test.ts server/test/install-census.test.ts server/test/single-definition.test.ts \
        server/test/session-hook.test.ts server/test/ccrc-doctor.test.ts server/test/ccdWsHelpers.ts \
        server/test/ccrc-sweep-deliberate-stop.test.ts server/test/fixtures README.md CLAUDE.md agent/CLAUDE.md \
        .github install.sh deploy/systemd deploy/coordination-snapshot.mjs docs/superpowers/specs docs/superpowers/programs

  `git diff --stat origin/main...HEAD` lists exactly File structure's New and Changed files.
- **Line pins that must hold.**
  - `deploy/deploy.sh` lines 1 to 648 keep their positions. `session-hook.test.ts`'s frozen citation census cites `deploy.sh:560`, `:570`, `:629` and `:648`, and the scout MEASURED three comment lines inserted inside `prune_backups` redding two of its cases (the per-file citation debt and the **Files:** location index). So Task 6's KEEP check replaces line 242 by one line, and line 240 is not touched. This prints nothing: `diff <(git show origin/main:deploy/deploy.sh | sed -n '1,241p;243,648p') <(sed -n '1,241p;243,648p' deploy/deploy.sh)` *(revised: the draft also reworded line 240)*. After a merge that moves those lines, re-derive the number from the quoted text.
  - `deploy/verify-service.sh` lines 1 to 62 do not move (V15 pins them; `ccd/ccrc:25`, `ccd/ccrc:1713`, `ccd/ccrc-doctor-checks:153` and `server/test/ccrc-cli.test.ts:131` cite them). This prints nothing: `diff <(git show origin/main:deploy/verify-service.sh | sed -n '1,62p') <(sed -n '1,62p' deploy/verify-service.sh)`. V14's `  reg="$HOME/.cc-sessions"` line stays byte-identical.
  - **`ccd/ccrc` citations.** No machine-checked corpus cites a `ccd/ccrc` line numbered 20000 or higher; the frozen census's highest `ccd/ccrc` anchor is `:11635`. `session-hook.test.ts -t "every line citation is anchored"` stays 13 green (*prototype*, on the 518789ad0 tree and on the tree merged with `0b3ff2f62`). Run it after every `ccd/ccrc` or `deploy.sh` edit.
  - `_upd_sweep` stays readable by `/_upd_sweep\(\) \{([\s\S]*?)\n\}/` (no line inside it starts with `}`); its Linux arm (after the Darwin arm's two-space `  fi`) contains no `_ccrc_die`, comments included, and exactly four `bash "$verify" "${units[k]}"`-shaped calls (W0); the KillMode preflight precedes the first `try-restart` in the Linux arm (`single-definition.test.ts`).
  - `SWEEP_CMD` holds no apostrophe (both `SWEEP_CMD='([\s\S]*?)'` readers end at the first one), and its KillMode guard precedes its `try-restart`.
  - The sweep's success line, zero line and every pre-existing warning line are byte-identical (`runbook-holds.test.ts`, `SWEEP_OK`).
- **Anchors.** Every anchor is measured at `518789ad0` and quoted. Step 1 of each task re-measures its anchors by their QUOTED TEXT (`grep -nF`) on the tip being built, after `git fetch origin main` (and a merge if `main` moved). The quote wins over the number. Find code with graphify first (`graphify query "…"` over `graphify-out/`), then confirm with `grep -nF`.
- **Scratch.** *(revised)* Before the first task: `SCRATCH=<this session's scratchpad directory>/w16`, `SHARD_TMP="$SCRATCH/shard-tmp"`, `mkdir -p "$SCRATCH/tmp" "$SHARD_TMP"`, and `TMPDIR="$SCRATCH/tmp"`. All three are absolute and never under the checkout or the work volume. Every subagent brief carries the same absolute values.
- **Fixture HOMEs only.**
  - Every case that runs or sources `ccd/ccrc` runs on `sweepFixture.ts`'s `makeBox` HOME, with its env built from scratch (never `...process.env`), every tool that is not a stub a recording POISON, and `assertContained` on the spawn's FINAL env before every spawn. Every agent case runs the real script on a `mkTmp` HOME with `assertStubsResolve` first, the prune cases included (Task 6).
  - No case runs `ccd`, `ccrc`, `systemctl`, `launchctl`, `systemd-run`, `tmux`, `gh`, `ssh` or `journalctl` against the live box, reads or writes a real `~/.cc-sessions`, `~/.ccrc` or `~/.cc-limits`, or touches a `claude-session@*` unit. The one permitted touch of the live registry is Task 8 Step 1's single `stat` of its mode, on this box only.
  - Never run `ccd` verbs, `ccrc update`/`rollback`/`rollout`/`install`, or `deploy.sh`. Never read `~/.cc-secrets` or `~/.ccrc/mail.token`.
  - **Writes through `gh` and `ccrc-api` are the worker protocol's only** *(revised)*: acking the brief, this wave's claims and their release, mail to the coordinator (the READY and the wave-done), `gh pr create`/`gh pr edit` for this wave's PR, and `gh workflow run ci.yml --ref <this branch> -f mode=full` in Task 8 Step 6. Never `gh pr merge`, never another branch's PR, never a ledger POST (the D-numbers are issued).
  - A case that leaves a process behind (Task 5's J6: the helper's own orphaned `sleep`) COLLECTS with `survivors`, REAPS with `reapSurvivors`, and only then asserts.
  - A case that makes a directory unsearchable (Task 4's V31) restores its mode in `finally`, and skips under root, which ignores mode bits.
- **Mutation-table discipline.** Every guard ships with a case that reds when the guard is removed or mutated, and the red is measured.
  - Before each mutation: `cp <file> "$SCRATCH/<name>.good"`. Never `git checkout --`, never a bare `git stash`.
  - Apply the mutation, check that it parses (`bash -n`), run the named command, restore with `cp`, check with `cmp`, and confirm `git status --porcelain` shows only this wave's files.
  - A row is done only with a measured red set and the assertion that fired. Each row lists its full expected set; a measured set that differs is reported, never accepted silently. A spawn timeout is "code -1", a suite hang "killed by timeout(1)", never "red".
  - Rows marked *(prototype)* were measured through the real files with vitest. Rows marked *(revised, unmeasured)* are the expected set, never yet run. The worker re-measures every row on the tip it builds.
- **D-numbers.**
  - This plan defines D-5135 to D-5143, in order, from the block issued to run 484 (5135 to 5154), in `## Deviations found`.
  - **The worker's reserve is numbers 5144 to 5148.** Take them in order, and define each in `## Deviations found` in the commit that first cites it. Numbers 5149 to 5154 are not used by this plan or the worker; they stay with the coordinator.
  - Never write a number outside the block, and write an unspent one bare, without its `D-` (a contiguous `D-<n>` above the highest defined number reds `deviation-refs.test.ts`; measured). Never call the allocator. Never land a `D-TBD-` spelling. A code comment that a departure governs names its number.
- **Suites.**
  - Run each file in the foreground, one command per call, inside its package, with a timeout of at least 600000 ms: `./node_modules/.bin/vitest run test/<file>.test.ts [-t "<pattern>"]`. Never bare `npx vitest`. Never split by `file:line`.
  - `npm ci` in `agent/` (and `pwa/` for `typecheck-tests`) wherever `node_modules` is absent.
  - `TMPDIR` and all scratch go under `$SCRATCH` (above), never on the work volume.
  - **`ccrc-update.test.ts` and `ccrc-install.test.ts` run past 590 s whole on this box** (both measured: `timeout 590` fired). Run each in `-t` parts by w11's rule: paren-free patterns (write `.` for a `+` or a `(`), each part's PASSED count non-zero, and the UNION of the parts' passed titles (`--reporter=json --outputFile.json=…`) equal to `vitest list test/<file>.test.ts`'s titles; a pattern may overlap another, since the union, not the sum, is the check. A pattern must not begin with `--` (vitest reads it as an option; measured). The prototype's seven parts are in Task 8 Step 4.
  - Known load flakes (CLAUDE.md's list) are re-run IN ISOLATION before a red is called a break. Under this box's load, `session-hook`'s "the SWEEP run forks one further `rm` per swept candidate — 2 planted, 2 swept" redded twice ("18 interleaved strace lines … Re-run in isolation") and then passed in isolation on both the base tree and the wave's (*prototype*); four `ccrc-update` cases hit their 20 s timeout at load 53 and passed in isolation.
- **No residue in tracked text:** no hostname, username, account or lane name, absolute home path, mount path, docserver URL or org name. Fixture ids are `demo-a` … `demo-f`, `demo-x`, `demo-gone`. Run `topology-clean.test.ts` after the `git add` of each new or changed file.
- **Commits.** On the workspace branch only, at least once per task: `fix(update): …` for shipped code, `test(update): …` for test-only tasks, `docs(update): …` for the plan. Never a separate feature branch. Author and committer are the noreply identity. Send the wave-done in the same turn as the push, and never end a turn to wait on CI (the one planned turn end is Task 8 Step 1's READY, on a named wake).

## Review Focus

1. **Every unit that did not stay verified-and-active gets exactly one true line, and only units active before the restart (or absent from that listing) are verified** (Tasks 1, 2).
   - The outcomes for a unit, by its pre-restart word and what it reads after:
     | before | after | line | verified |
     |---|---|---|---|
     | active | active | none | yes |
     | active | activating/failed, crash listing read | D-3984's "was active before … reads '<w>' after it — it is verified with the rest" | yes (then re-checked) |
     | active | failed, crash listing unread (or no script) | item G's "was active before try-restart and is not active after it" | no |
     | active | inactive / gone | item G's line | no |
     | failed | failed | item 3's "is FAILED — try-restart skipped it …" | no |
     | activating | failed | item 3's line (see Reading 2 on its wording) | no |
     | activating or failed | inactive / gone / still activating | Task 2's "was already '<w>' before try-restart and is not active after it — it is named, not verified, and does not fail this update …" | no |
     | activating or failed | active (in the post-restart listing) | Task 2's "was already '<w>' before try-restart and reads 'active' after it — it is named, not verified, and does not fail this update …" | no (W24c; *revised*) |
     | activating or failed, nothing active before | down, listing read | Task 2's line, then the zero line | no (W24f; *revised*) |
     | absent | failed | item 3's line | no |
     | absent | active | none | yes, as before wave 16 (Reading 1) |
     | inactive, deactivating, anything else | anything not active | none | no |
   - W23a to W24f pin each row. Are any rows missing, or any line untrue?
   - No `systemctl` call is added (`ccrc-update`'s argv-order case stays green, *prototype* on the draft), the success line is unconditional as before, and nothing new can fail the update: a `prior` unit is never in `units`, so it reaches no verify and no die.
   - Task 2's loop runs only when the post-restart listing was read (`arc` 0, W24e): an unread listing proves nothing about "not active after it". It runs above the zero-line return (W24f), so a box with nothing active before still names its crash-looping unit.
2. **The verify script's two changes only turn a false pass into a failure, or a false failure into a true pass** (Task 4).
   - stdout and the exit codes keep their meaning: the sweep reads only the rc and a `stopped on purpose: ` stdout line (`_upd_sweep_spo`), and the new text goes to stderr on the failure path. `STOP_WHY` is initialised empty, so a caller's environment cannot plant a cause line (V31c; *revised*).
   - A non-session unit never reaches the registry code (V13's exact call sequence).
   - The stamped and purged paths keep their exact call logs (V1, V17, V18, V27 green); only the race shape pays one more `sleep STOP_INTERVAL` and one filesystem re-read; the purged outcome keeps its one `LoadState` query (V32).
   - The `-x` test sits after the settle, and V31's call log pins that (row T4-5; *revised*).
   - Is there any input where the re-read can turn a crash into a pass? It reads only the stamp and the uuid, after the unit has already settled `inactive`; a crash under Restart=always never reads `inactive` (the script's own header).
3. **The Darwin helper's sentinel cannot pass** (Task 5). `_ccrc_job_pid` runs inside `$(…)`, so its answer rides stdout; `!<rc>` for a failed print, nothing for 113. Two equal `!1` reads would pass the old `p1 != p2` test, so the helper refuses any `!`-prefixed first read explicitly (J2 and row T5-5).
4. **`deploy.sh` stays line-neutral above line 648, holds no apostrophe in `SWEEP_CMD`, and its KEEP test is `_keep_ok`'s, held equal by D1c** (Task 6).
5. **The move into the wave: the OLD sweep with the NEW script** (Risk notes). Is the argument complete?
6. **The two closures say exactly what was measured** (Task 3): the pgid exception reds nothing by construction; T6-INT-W is unpinnable without a shipped seam.

## Risk notes

- **The move INTO this wave runs the OLD sweep with the NEW `verify-service.sh` (deploy class fleet-first).** Why it is safe:
  - **The interface is unchanged.** The old sweep passes one unit, reads only the rc and whether stdout holds a `stopped on purpose: ` line, and replays both streams. Task 4 changes neither the argument contract, nor stdout, nor what an rc means. Its new text is one `## <cause>` line on stderr, on the failure path only.
  - **Non-session units are untouched.** `ccrc.service` and `ccrc-agent.service`, which the update's own health gate verifies, never reach `stopped_on_purpose`'s registry code (`case "$UNIT" in claude-session@?*.service`); V13 pins their exact query sequence.
  - **The behavioural deltas are confined to a claude-session@ unit that settled `inactive`:** (a) an unsearchable registry, before a false pass (measured: rc 0, "its registry row is purged", V31 red-first), now rc 1 with its cause; (b) a stamp-absent, uuid-present row, now one `sleep STOP_INTERVAL` (1 s by default) and one filesystem re-read, which can only turn the purge-window false failure into a true pass. A hand stop or a crash keeps the identical `systemctl` call log and still fails (V32c, V5, V16(b)). `STOP_WHY=""` changes nothing unless a caller exported a `STOP_WHY`, and then it removes a false line.
  - **Measured, not just argued** (*prototype*, on the draft's script, before the `STOP_WHY` initialisation): the window file at `518789ad0` with `518789ad0`'s `ccd/ccrc` (the old sweep) and the NEW script: 65 of 65 green. `ccrc-sweep-deliberate-stop.test.ts` (the FROZEN v0.0.84 sweep with the tree's script): 8 of 8. `deploy.sh`'s `SWEEP_CMD` with the new script (V16(a), (b)): green. Task 4 Step 6 re-measures the pairing on the final script.
  - **The one way the move could fail where it passed before:** a fleet box whose `~/.cc-sessions` has no x bit for its owner, and a session unit that settles `inactive` during the sweep. That update then fails (exit 1, install complete, nothing rolled back), which is the truth: the deliberate stop could not be told from a crash. The fleet box's registry was measured searchable (mode `drwxrwxr-x`, a read-only `stat`, 2026-10-15). Task 8 Step 1 repeats that one `stat` on the box the worker runs on; the coordinator measures any other node *(revised)*.
  - The added wall cost is at most `STOP_INTERVAL` (1 s) on a unit that is going to fail anyway. Verify jobs run concurrently, and the sweep has no per-job deadline.
- **The NEW sweep with an OLDER script (a rollback).** The sweep's changes are stderr lines and one fewer verify call for a unit that was not active before; every call it makes is made exactly as before, so every script version answers it (the window file's Q family runs S10 and its R family S0: green, *prototype* on the draft's sweep).
- **Task 2 removes a verify.** *(revised, unmeasured)* A unit the pre-restart listing showed `activating` or `failed` leaves `units`, so it is never verified and cannot fail the update, even when the post-restart listing shows it `active`. An attack lens measured why that matters, on the draft's prototype: a unit `activating` before and listed `active` after (a crash-looping `Type=simple` unit try-restart had just forked) was verified twice and failed the update, code 1, with no Reading 9 line. The ruling's "does not fail the update" was a race. `ccrc-update.test.ts` (run only) plants no `activating` row in its pre-restart listing, and never lists its pre-failed `gamma` as active after, so no case there changes (read, not run). A unit ABSENT from the pre-restart listing and active after is still verified (Reading 1).
- **Darwin.** Task 5 changes a helper three callers share on a Mac: `_upd_sweep`'s Darwin arm, `_inst_enable`'s stay-up check and the update's health gate. No macOS box is centrally managed (design decision 17), so the change is live only on a hand-run Mac. The fail-closed direction is unchanged (an unmeasured job never "stays up"); only its detail word changes. `sleep N & wait $!` leaves the background `sleep` to finish by itself after an INT (it ignores SIGINT, as every asynchronous command of a non-interactive shell does); it is harmless and read-only. A caller that traps a signal other than INT and RETURNS from its handler would cut the window short; no caller does (`grep -n "trap " ccd/ccrc`: every INT/TERM trap exits, and none is set on the helper's paths). R18's caller-other-signal note stays a documented limitation.
  - **What the macOS leg covers** *(revised)*: nothing of D-5139, D-5140 or D-5141. The new file's cases are `itLinux` (J6 reads `/proc`, and `sweepFixture.ts` has run only under `itLinux` suites), so on a Mac the file skips. `ccrc-update`'s Darwin D-cases reach only the one-unit pass and churn details (D4: `pid 4242 -> 4242`), never the zero-unit refusal, the sentinel or an INT. And `test-macos` no longer runs on a pull request at all (`ci.yml`, amendment 2026-10-15): it reports only on the daily, dispatched and stable-gate full runs, advisory and flaky by ruling. So this wave's Darwin evidence is the Linux-sourced helper cases alone (Reading 9).
- **Item 3's change cannot hide a unit.** A unit in `before` that reads `failed` gets neither item 3's line nor a place in `failed`, so it falls to D-3984's verify, or, when that cannot run, to item G's loop. W23b pins the second path: if the `failed+=` were kept while the line was dropped, the unit would be "seen" and silent (row T1-2).
- **`deploy.sh` is the operator's fallback.** Task 6's KEEP refusal makes `prune_backups` return 1 before any `ssh`, and both callers already turn that into a warning (`prune_backups || echo "deploy: warning: backup prune failed on $BOX (the deploy itself succeeded)" >&2`, `:1140` and `:1290`). So a bad KEEP prints two warnings and fails no deploy. The first is true; the caller's second says "failed on $BOX" although nothing reached the box *(revised)*. Its "the deploy itself succeeded" is true, and the callers are not edited (the consent limits `deploy.sh` to the KEEP validation, and each edit there costs a line pin). The sweep's listing refusal fails the deploy exactly as its KillMode refusal does. KEEP=0 still prunes every timestamped backup (`head -n -0` prints everything): that is the KEEP *value*'s meaning, and the consent limits this wave to validation (Reading 7).
- **D1c is a tripwire into a fenced region.** *(revised)* It reads `_keep_ok`'s regex out of `ccd/ccrc`, inside claim 1423's `_bak_*` region, which wave 17's backup-prune work will rewrite. Its extractor finds the regex anywhere in `_keep_ok`'s body, so re-wrapping the function does not red it; changing the regex on one side only does, by design. The wave-done asks the coordinator to tell claim 1423's holder and wave 17's brief that `agent/test/deploy-verify.test.ts` D1c pins `_keep_ok`'s regex.
- **`main` moved; run 360 lands first.** Both measured clean against this wave (the header). Run 360's branch inserts one 46-line describe at `deploy-verify.test.ts:2348`; this wave appends at the end of the file, 370 lines away.
- **Citations into the edited test files.** `ccrc-sweep-window.test.ts` gains 4 comment lines after `:121` (the pgid note) and 5 at `:523-541`; no source or test cites a line of that file (`git grep -n 'ccrc-sweep-window.test.ts:[0-9]' -- ':!docs'` finds nothing). `deploy-verify.test.ts` grows only at its end; the two citations into it (`ccd/ccrc:14070`, `ccrc-install.test.ts:2259`) name `:1750-1791`, above every edit. `sweepFixture.ts` grows inside a type and a builder; V15's index pins read `verify-service.sh`, not a test file.

## Deviations found

These are departures from the ruling or the brief, or from what shipped text at `518789ad0` documents.

- **D-5135** — *Item 3's "is FAILED — try-restart skipped it and this sweep did not verify it" warning skips a unit that was active before the restart: no line, and no place in `failed`.*
  - **Shipped:** the loop warned for every `--state=failed` unit and appended it to `failed` (`ccd/ccrc:21268-21271`). A unit active before that crash-looped to `failed` was restarted, then verified by D-3984 (`:21321`), so it got the false sentence AND "it is verified with the rest". The ledger's 2026-10-06 01:29 entry named it item 3.
  - **Now:** a unit in `before` is skipped. Both halves are skipped, because `failed` also counts as "seen" in item G's loop: a unit kept there while its line was dropped would be silent whenever the crash listing cannot be read (W23b, row T1-2). With the skip, that unit gets item G's true line instead.
  - **Not changed:** the sentence itself, for a unit that was NOT active before; `deploy.sh`'s twin, which is true there (it verifies `--state=active` only).
- **D-5136** — *Reading 9's sweep half: a unit the pre-restart listing showed `activating` or `failed` is never verified, never fails the update, and is named once with its pre-restart word, whether or not it reads active after the restart.*
  - **Ruled** (the operator, 2026-10-15 21:41): "warn only … This keeps D-3984's narrowing: only units active before the restart are verified."
  - **Shipped:** such a unit was not in `before`, so D-3984 never added it from the crash listing; but the post-restart `--state=active` listing built `units` whatever a unit read before, so one that listed `active` after was verified, and its crash failed the update. One that did not list active was never named, unless it read `failed`, when only item 3's line printed. W17e (a) pinned the silence and called it "a question for wave 13".
  - **Measured** (an attack lens, on the draft's prototype): `Type=simple` reads `active` the moment try-restart forks a unit, so a crash-looping unit is usually in that listing. Planted `activating` before and `active` after, it was verified twice and failed the update (code 1), with no Reading 9 line. So `prior` units leave `units` *(revised, unmeasured)*.
  - **The choices this plan made where the ruling is silent:**
    - the words are `activating` and `failed`, the two the ruling's "crash-looping" covers; `inactive`, `deactivating` and any other word are not named (W24d; Reading 3);
    - the unit is named once: one that item 3 names is in `failed`, and gets no second line (W23c, W24b);
    - one the post-restart listing shows `active` goes to `pback`, never `units`, and is named "reads 'active' after it" (W24c);
    - "is not active after it" prints only when the post-restart listing was read (`arc` 0, W24e): before, an unread listing with nothing active before fell through to the zero line, and the new line would have claimed "not active after it" over a set nobody listed;
    - the loop sits above the zero-line return, so a box with nothing active before still names its unit (W24f);
    - a unit ABSENT from the pre-restart listing and active after is still verified (Reading 1);
    - item 3's sentence for an `activating`-before unit that reads `failed` after is left as it is (Reading 2).
  - No `systemctl` call is added and the argv order is unchanged; W0's four verify calls are unchanged; the success line stays unconditional.
- **D-5137** — *`verify-service.sh` fails a session unit whose registry this user cannot search, and names that cause on stderr; the test sits after the unit settles `inactive`, not beside `[ -d "$reg" ]`.*
  - **The ledger** (R18(a)): "a kept row reads as purged. One fix is to test `[ -x "$reg" ]` beside `[ -d "$reg" ]`."
  - **Measured worse than that:** with the x bit off, every `-e`/`-L` under the registry is false, so the purged arm passes: exit **0**, "its registry row is purged", for a stamped stop, a kept row and an empty registry alike (V31's red-first). It was a false pass, not only a misread.
  - **Placement:** after the settle, so the cause prints only when the classifier was asked, and a unit that never settles keeps today's message and query count. V31's call log pins it (row T4-5). `fail` prints `## <cause>` after its `## <check>` line, from `STOP_WHY`, a global initialised empty beside the knobs (`STOP_WHY=""`, below line 62), so a `STOP_WHY` in the caller's environment cannot print (V31c) *(revised)*.
- **D-5138** — *A stamp-absent, uuid-present row is re-read once, `STOP_INTERVAL` later, through a new `registry_evidence` (rc 2 for that shape), reusing the existing knob.*
  - **The ledger** (R18(a)): "`_reg_purge` deletes `.stopped` before `.uuid`, so a verify that lands between the two reads an unstamped stop, and a deliberate stop fails." The ruling chose a re-read in the script over a `_reg_purge` reorder in `ccd/ccd`.
  - **Shipped text departed from:** the script's header says "Everything else fails exactly as before". A hand stop (the row kept, no stamp) still fails, with the identical `systemctl` call log, but now after one more `sleep STOP_INTERVAL` (1 s by default; `0` in every harness).
  - **Why reuse `STOP_INTERVAL`:** a new knob would need its own default pin (V22's kind) and an entry in every harness; the re-read is the same kind of wait as the deactivating re-poll. Reading 5 offers the alternative.
- **D-5139** — *`_ccrc_job_stayed_up`'s two sleeps run as `sleep N & wait $!`.*
  - **The ledger** (R18(b)): "An INT to the sweep shell alone during the shared window is swallowed while bash waits out the foreground `sleep`."
  - **Measured** (J6 red-first): an INT to the shell alone during the settle or the window was held until the `sleep` ended (8 s), and the run then went on and printed `rc=0`; with `& wait $!` it ends by SIGINT at once.
  - **The cost:** the background `sleep` finishes by itself (read-only, at most the window). A caller that traps another signal and returns would cut the window short; no caller does, and R18's note stays a documented limitation (2026-10-15 22:11).
- **D-5140** — *`_ccrc_job_stayed_up` with no unit answers 1 at once, with its globals emptied, instead of sleeping and passing vacuously.*
  - **The ledger** (R18(b)): "`_ccrc_job_stayed_up` passes vacuously when it is given no arguments. Every caller guards against that." Every caller still does; the guard makes the helper's own contract say so.
- **D-5141** — *`_ccrc_job_pid` prints `!<rc>` for a `launchctl print` that FAILED (any rc but 0 and 113), and `_ccrc_job_stayed_up` never lets such a read hold; its detail says "unmeasured (launchctl print exited N)".*
  - **The ledger** (R10j): "The Darwin sweep arm cannot tell a failed `launchctl print` from an unloaded job."
  - **Shipped:** `|| return 0` printed nothing for both, so the detail read `pid none -> none`. It was already fail-closed; only the diagnosis was conflated. 113 is launchd's one positive "not loaded" answer (`_svc_is_active`'s rule), and keeps the old detail (J3).
  - **The shape:** the answer rides stdout, because both call sites run the helper inside `$(…)`, where a global would be lost. Two equal sentinels would pass `p1 != p2` as one stable pid, so a `!`-prefixed first read is refused explicitly (J2, row T5-5).
- **D-5142** — *`deploy.sh`'s `prune_backups` refuses a `CCRC_BACKUP_KEEP` outside `^[0-9]{1,4}$` before any `ssh`, with `_keep_why`'s sentence shape: a second spelling of `ccd/ccrc`'s `_keep_ok`, by design, held equal by a test.*
  - **The ledger** (R8): "`deploy.sh`'s `prune_backups` reads `CCRC_BACKUP_KEEP` unvalidated." Measured: the value is spliced into the remote command (`head -n -$keep`), so `1; <cmd>` would run `<cmd>` on the box (the operator's own variable), and `abc` errors harmlessly.
  - **Why a second spelling:** `deploy.sh` runs on the operator's machine and never sources `ccd/ccrc`. `single-definition.test.ts` has no scan this trips (measured green: 571; 585 after #384). D1c holds the two regexes equal, so a later widening of either side is a red suite. `_keep_ok`'s header still calls it "the ONE validator for every KEEP knob"; that sentence is in the fenced region and passes to wave 17 (Not in this wave) *(revised)*.
  - **Line-neutral, by the consent's fence and the frozen census:** one line replaces line 242, carrying this number in a trailing comment; line 240 is not touched *(revised)*. The directory selection and the delete line are byte-identical. KEEP=0 still means "keep none" (Reading 7).
- **D-5143** — *`deploy.sh`'s `SWEEP_CMD` captures its listing, and a listing that fails refuses the sweep before any KillMode query or restart.*
  - **The ledger** (R10c(3)): "`deploy.sh`'s sweep still restarts behind the template probe alone when its listing fails." Measured (D2 red-first): the loop saw only the template probe, KillMode passed, `try-restart claude-session@*` ran, nothing was verified, exit 0.
  - **Now:** `listing=$(…) || { …; exit 1; }`, then the loop reads `printf "%s\n" "$listing"`. The success path's call order is unchanged (the existing `SWEEP_CMD` cases stay green), and the KillMode guard still precedes `try-restart`. It is `ccrc update`'s D-3599 refusal, spelled for the fallback.

Reserve: numbers **5144 to 5148**, the worker's, in order, each defined here in the commit that first cites it. Numbers 5149 to 5154 are not used.

## File structure

**New**
- `docs/superpowers/plans/2026-10-15-centralised-update-w16-sweep-and-verify.md` (this plan).
- `server/test/ccrc-darwin-job-helpers.test.ts` (Task 5): J1 to J6, 8 cases.
- `server/test/ccrc-versions-warn-arms.test.ts` (Task 7): VW1 to VW3, 4 cases.

**Changed**
- `ccd/ccrc` (Tasks 1, 2, 3, 5): `_ccrc_job_pid`, `_ccrc_job_stayed_up`, `_upd_sweep_stop`'s header comment, `_upd_sweep`'s Linux arm. 24038 → about 24083 lines on `518789ad0` (the prototype's 24071 before the revision; *revised, unmeasured*).
- `deploy/verify-service.sh` (Task 4): 218 → 240 lines; lines 1 to 62 unchanged.
- `deploy/deploy.sh` (Task 6): 1291 → 1296 lines; lines 1 to 1109 keep their positions, one of them (242) replaced in place.
- `server/test/sweepFixture.ts` (Tasks 1, 2): `UnitPlant.failedListed`, `BoxOpts.activeListingRc`, the stub's `failed` and `active` arms.
- `server/test/ccrc-sweep-window.test.ts` (Tasks 1 to 3): 65 → 77 cases.
- `agent/test/deploy-verify.test.ts` (Tasks 4, 6): 85 → 105 cases.

**Run, not edited:** `ccrc-sweep-deliberate-stop`, `ccrc-update`, `install-census`, `single-definition`, `session-hook`, `runbook-holds`, `macos-platform`, `ccrc-install`, `topology-clean`, `typecheck-tests`, `dtbd`, `deviation-refs`; the whole agent suite.

## Tasks

### Task 1: Item 3 — the "is FAILED" warning names only a unit that was not active before (W16-b; D-5135)

**Files:** `ccd/ccrc`, `server/test/sweepFixture.ts`, `server/test/ccrc-sweep-window.test.ts`.

**Interfaces:** `_upd_sweep`'s output contract is unchanged except that one warning line no longer prints for a unit in `before`. `UnitPlant.failedListed?: boolean` is new and opt-in.

- [ ] **Step 1: Re-measure, and claim.** From the checkout root:
  ```bash
  git fetch origin main
  ~/.local/bin/ccrc-api claims list --project ccrc-pwa      # 1423 names ccd/ccrc (consented); nothing else this wave writes
  # then the one all-or-nothing claim of Global Constraints' "Claims" bullet (never ccd/ccrc or deploy/deploy.sh)
  grep -nF '  local u km listing lu _ll la _lr lrc=0' ccd/ccrc                                   # :21227, inside _upd_sweep
  grep -nF '  local -a before=() after=() failed=()' ccd/ccrc                                   # :21228
  grep -nF '    [ "$la" = active ] && before+=("$lu")' ccd/ccrc                                # :21247
  grep -nF 'update: warning: $u is FAILED — try-restart skipped it and this sweep did not verify it.' ccd/ccrc   # :21269 (and nowhere else in ccd/ccrc)
  grep -nF "was active before try-restart and reads '\$cw' after it — it is verified with the rest (wave 11, D-3984)" ccd/ccrc   # :21321
  grep -nF '    for a in ${after[@]+"${after[@]}"} ${failed[@]+"${failed[@]}"}; do [ "$a" = "$b" ] && { seen=1; break; }; done' ccd/ccrc   # :21430
  grep -nF "  '      failed) exit 0 ;;'," server/test/sweepFixture.ts                             # the stub answers --state=failed with nothing
  cd server && ./node_modules/.bin/vitest list test/ccrc-sweep-window.test.ts | wc -l          # 65 at 518789ad0
  ```
- [ ] **Step 2: The fixture.** In `server/test/sweepFixture.ts`, exactly this (the `activeListingRc` knob is Task 2's; it can land here or there):
  ```diff
  --- a/server/test/sweepFixture.ts
  +++ b/server/test/sweepFixture.ts
  @@ -71,2 +71,6 @@ export interface UnitPlant {
     preRestart?: string | null;
  +  /** In the POST-restart `--state=failed` listing, the one the sweep's "is FAILED" warning loop reads (wave 16). Opt-in
  +   *  and never derived from `listed`: before wave 16 that listing answered nothing for every case, and still does for
  +   *  every case that does not set this. */
  +  failedListed?: boolean;
   }
  @@ -93,2 +97,4 @@ export interface BoxOpts {
     crashListingRc?: number;
  +  /** The post-restart `--state=active` listing exits this rc (and prints nothing) instead of answering (wave 16). */
  +  activeListingRc?: number;
     /** `<home>/tmp` is a directory (default) or a regular file. */
  @@ -126,5 +132,7 @@ const SYSTEMCTL_STUB = [
     '    case "$state" in',
  -  '      failed) exit 0 ;;',
  +  '      failed) cat "$fx/list.failed"; exit 0 ;;',
     '      "") cat "$fx/list.all"; exit 0 ;;',
  -  '      active) cat "$fx/list.active"; exit 0 ;;',
  +  '      active)',
  +  '        if [ -f "$fx/active.rc" ]; then IFS= read -r rc < "$fx/active.rc"; exit "$rc"; fi',
  +  '        cat "$fx/list.active"; exit 0 ;;',
     '      activating,failed)',
  @@ -239,3 +247,5 @@ export function makeBox(o: BoxOpts): Box {
     const crash: string[] = [];
  +  const failedL: string[] = [];
     for (const p of o.units) {
  +    if (p.failedListed === true) failedL.push(row(p.unit, 'failed', 'failed'));
       const pre = p.preRestart === undefined ? 'active' : p.preRestart;
  @@ -256,3 +266,5 @@ export function makeBox(o: BoxOpts): Box {
     writeFileSync(join(fx, 'list.crash'), lines(crash));
  +  writeFileSync(join(fx, 'list.failed'), lines(failedL));
     if (o.crashListingRc !== undefined) writeFileSync(join(fx, 'crash.rc'), `${o.crashListingRc}\n`);
  +  if (o.activeListingRc !== undefined) writeFileSync(join(fx, 'active.rc'), `${o.activeListingRc}\n`);
     const byUnit = new Map<string, string[]>();
  ```
  Every existing case still sees an empty failed listing: `list.failed` is always written, and empty unless a plant sets `failedListed`.
- [ ] **Step 3: Write the cases first (red).** Append this describe at the end of `server/test/ccrc-sweep-window.test.ts` (Task 2 adds its W24 cases inside it, after W23d):
  ```ts
  // WAVE 16 (centralised update management; D-5135, D-5136): what the sweep SAYS about a unit that did not come back
  // active. Two listings decide it, and before wave 16 the fixture could plant only one of them. `--state=failed`, read
  // right after try-restart for item 3's "is FAILED" warning, answered nothing for every case (`sweepFixture.ts`'s
  // `failedListed` is opt-in, so every case above still sees that). The other is the PRE-restart listing's ACTIVE
  // column, which builds `before` (verified) and, since wave 16, `prior` (`activating` or `failed` there: named, never
  // verified, never fatal — the operator's Reading 9 ruling of 2026-10-15, "warn only").
  describe('_upd_sweep, Linux arm: a unit that did not come back active is named truly (wave 16, D-5135, D-5136)', () => {
    const F = U('f');
    const X = U('x');
    const SKIPPED = (u: string): string => `${u} is FAILED — try-restart skipped it and this sweep did not verify it`;
    const VERIFIED = (u: string, w: string): string =>
      `${u} was active before try-restart and reads '${w}' after it — it is verified with the rest (wave 11, D-3984)`;
    const UNSEEN = (u: string): string => `${u} was active before try-restart and is not active after it`;
    const TAIL = (u: string): string => 'it is named, not verified, and does not fail this update (only a supervisor that '
      + `was active before the restart is verified; wave 16, D-5136). On the box: systemctl --user status ${u}`;
    const PRIOR = (u: string, w: string): string =>
      `update: warning: ${u} was already '${w}' before try-restart and is not active after it — ${TAIL(u)}`;
    const BACK = (u: string, w: string): string =>
      `update: warning: ${u} was already '${w}' before try-restart and reads 'active' after it — ${TAIL(u)}`;
    const PRIOR_ANY = 'before try-restart and is not active after it — it is named, not verified';
    const NAMED_ANY = 'it is named, not verified';
    const ZERO = 'update: sweep: no claude-session@ supervisor was active when the sweep began';

    // ── item 3 (D-5135): the failed listing names only a unit that was NOT active before ──
    itLinux('W23a active before, failed after: verified, and never also told it was skipped and unverified', () => {
      const box = makeBox({
        units: [stable(A, 0), { unit: B, active: ['failed'], mainPid: [], listed: 'crash:failed', failedListed: true }],
      });
      const r = runSweep(box);
      expect(r.stderr, ctx(r)).toContain(VERIFIED(B, 'failed'));
      expect(r.stderr, ctx(r)).not.toContain(SKIPPED(B));
      expect(count(box, act(B)), 'demo-b is verified: its first call and its re-check').toBe(2);
      expect(r.code, ctx(r)).toBe(1);
      expect(dieOf(r.stderr), ctx(r)).toBe(dieLine(1, 2, 0, B));
      noPoison(box);
    }, 60_000);

    itLinux('W23b active before, failed after, the crash listing unread: item G\'s true line, never the skipped one', () => {
      const box = makeBox({
        units: [stable(A, 0), { unit: B, active: ['failed'], mainPid: [], listed: 'crash:failed', failedListed: true }],
        crashListingRc: 94,
      });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(0);
      expect(r.stderr, ctx(r)).not.toContain(SKIPPED(B));
      expect(r.stderr, 'the unit must not drop out of item G\'s accounting').toContain(UNSEEN(B));
      expect(count(box, act(B))).toBe(0);
      expect(r.stdout).toContain(SWEEP_OK);
      noPoison(box);
    }, 60_000);

    itLinux('W23c failed before and after: named ONCE, by item 3, and never verified', () => {
      const box = makeBox({
        units: [stable(A, 0),
          { unit: F, active: ['failed'], mainPid: [], listed: 'crash:failed', preRestart: 'failed', failedListed: true }],
      });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(0);
      expect(r.stderr, ctx(r)).toContain(SKIPPED(F));
      expect(lines(r.stderr, F), 'item 3 names it, and nothing else does').toBe(1);
      expect(count(box, act(F))).toBe(0);
      expect(r.stdout).toContain(SWEEP_OK);
      noPoison(box);
    }, 60_000);

    itLinux('W23d absent from the pre-restart listing, failed after: named once, by item 3, never verified', () => {
      const box = makeBox({
        units: [stable(A, 0),
          { unit: X, active: ['failed'], mainPid: [], listed: 'crash:failed', preRestart: null, failedListed: true }],
      });
      const r = runSweep(box);
      expect(r.code, ctx(r)).toBe(0);
      expect(r.stderr, ctx(r)).toContain(SKIPPED(X));
      expect(lines(r.stderr, X), ctx(r)).toBe(1);
      expect(count(box, act(X))).toBe(0);
      noPoison(box);
    }, 60_000);
  });
  ```
  (`PRIOR`, `BACK`, `TAIL`, `NAMED_ANY` and `ZERO` are Task 2's; they can land here or there. *revised: `PRIOR` now builds on `TAIL`, with the same text as the draft's.*)
- [ ] **Step 4: Run them red** against the unchanged `ccd/ccrc`:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts -t "W23"
  ```
  Expected (T1-0, *prototype*, from one red-first run of Tasks 1 and 2's cases together, `-t "W2[34]|W17e"` on `main`'s `ccd/ccrc`: 6 failed | 6 passed): **2 failed** | 2 passed here. W23a reds on `not.toContain('claude-session@demo-b.service is FAILED — try-restart skipped it …')` (the shipped sweep prints both that and D-3984's line); W23b reds on the same assertion. W23c and W23d are green on `main`, as they must be: they pin the lines this task must keep.
- [ ] **Step 5: The change.** In `_upd_sweep`'s Linux arm, two edits.
  - The locals line `  local u km listing lu _ll la _lr lrc=0` becomes (two new locals; never reuse `inb`/`cb`, which are `local`ed later):
    ```bash
      local u km listing lu _ll la _lr lrc=0 fb fin
    ```
  - The failed-listing loop, with its comment, becomes:
    ```bash
      # try-restart is a no-op on a failed unit (its own man page), so a
      # pre-existing failed session was neither restarted nor verified — not this
      # update's doing, must not fail it, must not be silent either. A unit in
      # `before` that reads failed here WAS restarted: it is the verify's below
      # (D-3984), or item G's line when that cannot run, so it gets neither this
      # line nor a place in `failed` (wave 16, D-5135; item 3 of 2026-10-06 01:29).
      for u in $(systemctl --user list-units "claude-session@*" --state=failed --plain --no-legend | awk '{print $1}'); do
        fin=0; for fb in ${before[@]+"${before[@]}"}; do [ "$fb" = "$u" ] && { fin=1; break; }; done
        [ "$fin" -eq 0 ] || continue
        echo "update: warning: $u is FAILED — try-restart skipped it and this sweep did not verify it. On the box: systemctl --user reset-failed $u, then ccd start the session" >&2
        failed+=("$u")
      done
    ```
  Both the line AND `failed+=` are skipped for a unit in `before`, so that it falls to D-3984's verify or to item G's loop. No `systemctl` call is added. Then `bash -n ccd/ccrc`.
- [ ] **Step 6: Run green.**
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts -t "W23"     # 4 passed (prototype)
  ```
- [ ] **Step 7: The mutation table** (*prototype*, measured with `-t "W2[34]|W17e"` on the finished draft Tasks 1 and 2 tree):

  | Row | Mutation | Expected red set (measured) |
  |---|---|---|
  | T1-0 | Red-first: Step 3's cases against `main`'s `ccd/ccrc` | W23a, W23b (the item 3 line printed for a unit active before) |
  | T1-1 | Delete `    [ "$fin" -eq 0 ] \|\| continue` | W23a, W23b (`not.toContain(SKIPPED(B))`) |
  | T1-2 | Skip the line but keep `failed+=` (`[ "$fin" -eq 0 ] && echo …`) | W23b only: "the unit must not drop out of item G's accounting" |
- [ ] **Step 8: Commit** `fix(update): the sweep's "is FAILED" warning names only a unit that was not active before the restart (D-5135)`, with the plan committed first or in the same commit.

### Task 2: Reading 9's sweep half — a unit already down before the restart is named, never verified, never fatal (W16-c; D-5136)

**Files:** `ccd/ccrc`, `server/test/sweepFixture.ts` (the `activeListingRc` knob, if Task 1 did not land it), `server/test/ccrc-sweep-window.test.ts`.

**Interfaces:** one new stderr line per qualifying unit, and a unit the pre-restart listing showed `activating` or `failed` is no longer verified when the post-restart listing shows it active *(revised)*. `BoxOpts.activeListingRc?: number` is new and opt-in.

- [ ] **Step 1: Re-measure.**
  ```bash
  grep -nF '  # added, and the argv order below is unchanged.' ccd/ccrc                         # :21245, the pre-restart read's comment
  grep -nF '  local after_listing arc=0' ccd/ccrc                                                 # :21288: `arc` is set before Task 2's loop
  grep -nF '  local -a units=() missing=() crash=() unrec=() ncfail=()' ccd/ccrc                  # :21302
  grep -nF "  for u in \$(printf '%s\n' \"\$after_listing\" | awk '{print \$1}'); do units+=(\"\$u\"); done" ccd/ccrc   # :21305, the one line that builds units
  grep -nF '  if [ "${#before[@]}" -eq 0 ]; then' ccd/ccrc                                        # :21433, the loop goes right above it
  grep -nF "and is no proof that the choice is right (a question for wave 13)." server/test/ccrc-sweep-window.test.ts   # W17E's comment
  grep -nF "    expect(count(box, act(X)), 'demo-x is never verified').toBe(0);" server/test/ccrc-sweep-window.test.ts
  grep -nF "expect(r.stderr).not.toMatch(/claude-session@gamma\.service was active before try-restart/);" server/test/ccrc-update.test.ts   # G1b-control: run only
  grep -c 'activating' server/test/ccrc-update.test.ts                                           # 0 at 518789ad0: no case there plants a prior activating unit
  ```
- [ ] **Step 2: Write the cases first (red).**
  - In W17E's comment, the last two lines (`// try-restart DOES restart an activating unit: (a) pins the shipped choice, …` and `// and is no proof that the choice is right (a question for wave 13).`) become:
    ```ts
      // try-restart DOES restart an activating unit: (a) pins the shipped choice, to verify only units that were active.
      // The operator ruled that choice on 2026-10-15 (Reading 9, "warn only"; wave 16, D-5136): such a unit, still down
      // after the restart, is NAMED by its own line and is still never verified, and never fails the update. (b) is not
      // named by that line: the pre-restart listing never showed it.
    ```
  - In the W17e case, after `expect(count(box, act(X)), 'demo-x is never verified').toBe(0);`, add:
    ```ts
        const named = `${X} was already 'activating' before try-restart and is not active after it — it is named, not verified`;
        if (_k === 'a') expect(r.stderr, ctx(r)).toContain(named);
        else expect(r.stderr, ctx(r)).not.toContain('before try-restart and is not active after it — it is named');
    ```
  - Inside Task 1's describe, after W23d, add:
    ```ts
      // ── Reading 9's sweep half (D-5136): already down before the restart: named once, never verified, never fatal ──
      itLinux.each([
        ['activating', 'crash:activating'],
        ['failed', 'gone'],
        ['activating', 'gone'],
      ] as const)('W24a %s before the restart, %s after: named with its pre-restart word, never verified, never fatal', (pre, listed) => {
        const box = makeBox({ units: [stable(A, 0), { unit: X, active: ['inactive'], mainPid: [], listed, preRestart: pre }] });
        const r = runSweep(box);
        expect(r.code, ctx(r)).toBe(0);
        expect(r.stderr.split('\n'), ctx(r)).toContain(PRIOR(X, pre));
        expect(lines(r.stderr, X), 'one line, and only that one').toBe(1);
        expect(count(box, act(X))).toBe(0);
        expect(count(box, LIST_CRASH), 'nothing active before is missing, so the crash listing is not read').toBe(0);
        expect(r.stdout).toContain(SWEEP_OK);
        noPoison(box);
      }, 60_000);

      itLinux('W24b activating before, failed after: named once, by item 3, never a second line', () => {
        const box = makeBox({
          units: [stable(A, 0),
            { unit: X, active: ['failed'], mainPid: [], listed: 'crash:failed', preRestart: 'activating', failedListed: true }],
        });
        const r = runSweep(box);
        expect(r.code, ctx(r)).toBe(0);
        expect(r.stderr, ctx(r)).toContain(SKIPPED(X));
        expect(lines(r.stderr, X), ctx(r)).toBe(1);
        expect(r.stderr).not.toContain(NAMED_ANY);
        noPoison(box);
      }, 60_000);

      // Type=simple reads `active` the moment try-restart forks a unit, so a crash-looping one is usually IN the
      // post-restart active listing, and then dies inside the verify's window. It is still never verified (the ruling:
      // only units active before the restart are verified), so its crash cannot fail the update.
      itLinux('W24c activating before, listed active after, crashing in the window: named, never verified, never fatal', () => {
        const box = makeBox({
          units: [stable(A, 0), { unit: X, active: ['activating'], mainPid: [], listed: 'active', preRestart: 'activating' }],
        });
        const r = runSweep(box);
        expect(r.code, ctx(r)).toBe(0);
        expect(count(box, act(X)), 'a unit that was not active before the restart is never verified').toBe(0);
        expect(r.stderr.split('\n'), ctx(r)).toContain(BACK(X, 'activating'));
        expect(lines(r.stderr, X), 'one line, and only that one').toBe(1);
        expect(r.stderr).not.toContain(PRIOR_ANY);
        expect(r.stdout).toContain(SWEEP_OK);
        noPoison(box);
      }, 60_000);

      itLinux('W24e nothing active before, and the post-restart listing unread: no unit is called "not active after it"', () => {
        const box = makeBox({
          units: [{ unit: X, active: ['inactive'], mainPid: [], listed: 'gone', preRestart: 'activating' }],
          activeListingRc: 94,
        });
        const r = runSweep(box);
        expect(r.code, ctx(r)).toBe(0);
        expect(r.stderr, ctx(r)).not.toContain(X);
        expect(r.stdout).toContain(ZERO);
        noPoison(box);
      }, 60_000);

      itLinux('W24f nothing active before, one unit crash-looping before and down after, the listing read: named, then the zero line', () => {
        const box = makeBox({ units: [{ unit: X, active: ['inactive'], mainPid: [], listed: 'gone', preRestart: 'activating' }] });
        const r = runSweep(box);
        expect(r.code, ctx(r)).toBe(0);
        expect(r.stderr.split('\n'), ctx(r)).toContain(PRIOR(X, 'activating'));
        expect(lines(r.stderr, X), ctx(r)).toBe(1);
        expect(count(box, act(X))).toBe(0);
        expect(r.stdout).toContain(ZERO);
        noPoison(box);
      }, 60_000);

      itLinux('W24d a pre-restart word other than active, activating or failed is not named (inactive, deactivating)', () => {
        const box = makeBox({
          units: [stable(A, 0),
            { unit: X, active: ['inactive'], mainPid: [], listed: 'gone', preRestart: 'inactive' },
            { unit: F, active: ['inactive'], mainPid: [], listed: 'gone', preRestart: 'deactivating' }],
        });
        const r = runSweep(box);
        expect(r.code, ctx(r)).toBe(0);
        expect(r.stderr, ctx(r)).not.toContain(X);
        expect(r.stderr, ctx(r)).not.toContain(F);
        noPoison(box);
      }, 60_000);
    ```
    *(revised, unmeasured: W24c replaces the draft's "activating before, active after: verified" case, whose plant was a stable unit; W24f is new.)*
- [ ] **Step 3: Run them red** against Task 1's `ccd/ccrc`:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts -t "W24|W17e"
  ```
  Expected (T2-0, *revised, unmeasured*): **6 failed** | 4 passed. W17e (a), the three W24a rows and W24f red on the missing line; W24c reds on `code` (Task 1's sweep verifies demo-x, which fails its verify and its re-check: code 1; an attack lens measured exactly this on the draft's prototype). W17e (b), W24b, W24d and W24e are green before the change: they pin what it must not do. (*Prototype*, on the draft's cases: 4 failed | 5 passed; W24e was measured red on the draft's loop before its `arc` guard.)
- [ ] **Step 4: The change.** Four edits in `_upd_sweep`'s Linux arm *(revised, unmeasured: the second and fourth differ from the prototype)*.
  - The locals become:
    ```bash
      local u km listing lu _ll la _lr lrc=0 fb fin pi pin pb
      local -a before=() after=() failed=() prior=() priorw=() pback=()
    ```
  - The pre-restart read, with its comment's last line, becomes:
    ```bash
      # added, and the argv order below is unchanged. A unit that column shows
      # `activating` or `failed` goes to `prior`, with its word: never verified,
      # and named below (wave 16, D-5136).
      while read -r lu _ll la _lr; do
        if [ "$la" = active ]; then before+=("$lu")
        else case "$la" in activating|failed) prior+=("$lu"); priorw+=("$la") ;; esac; fi
      done <<< "$listing"
    ```
  - The one line that builds `units` from the post-restart listing (`  for u in $(printf '%s\n' "$after_listing" | awk '{print $1}'); do units+=("$u"); done`) becomes:
    ```bash
      # A unit the pre-restart listing showed `activating` or `failed` is never verified, even when this listing shows it
      # active (wave 16, D-5136; the ruling: only units active before the restart are verified). Type=simple reads
      # `active` the moment try-restart forks it, so a crash-looping one is usually here: it goes to `pback`, named below.
      for u in $(printf '%s\n' "$after_listing" | awk '{print $1}'); do
        pin=0; for pb in ${prior[@]+"${prior[@]}"}; do [ "$pb" = "$u" ] && { pin=1; break; }; done
        if [ "$pin" -eq 1 ]; then pback+=("$u"); else units+=("$u"); fi
      done
    ```
  - Right after item G's loop (its `done`) and before `  if [ "${#before[@]}" -eq 0 ]; then`:
    ```bash
      # Reading 9's sweep half (the operator, 2026-10-15: warn only; wave 16, D-5136): a unit the pre-restart listing showed
      # `activating` or `failed` is NAMED, once, and is never verified and never fails this update. One that item 3 named
      # above is in `failed` and gets no second line. One the post-restart listing shows active is in `pback`. Only when
      # that listing was READ (`arc` 0): an unread one proves nothing about "after it". Above the zero line, so a box
      # with nothing active before still names it.
      for ((pi = 0; arc == 0 && pi < ${#prior[@]}; pi++)); do
        b="${prior[pi]}"; seen=""
        for a in ${pback[@]+"${pback[@]}"}; do [ "$a" = "$b" ] && { seen=back; break; }; done
        for a in ${failed[@]+"${failed[@]}"}; do [ "$a" = "$b" ] && { seen=failed; break; }; done
        case "$seen" in
          back) echo "update: warning: $b was already '${priorw[pi]}' before try-restart and reads 'active' after it — it is named, not verified, and does not fail this update (only a supervisor that was active before the restart is verified; wave 16, D-5136). On the box: systemctl --user status $b" >&2 ;;
          failed) ;;
          *) echo "update: warning: $b was already '${priorw[pi]}' before try-restart and is not active after it — it is named, not verified, and does not fail this update (only a supervisor that was active before the restart is verified; wave 16, D-5136). On the box: systemctl --user status $b" >&2 ;;
        esac
      done
    ```
    - Both lines avoid the substring `was active before try-restart`, which G1b-control (`ccrc-update.test.ts`, run only) forbids for `gamma`, and the substring `_ccrc_die` (W0). No line of the block starts with `}` (the `_upd_sweep` reader).
    - `b`, `a` and `seen` are item G's locals (`local b a seen`, declared just above); `seen` is reset to a word here.
    - The four `bash "$verify" "${units[k]}"` calls are untouched, and no `systemctl` call is added.
  - `bash -n ccd/ccrc`.
- [ ] **Step 5: Run green.**
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts       # 77 passed (65 + 12; revised, unmeasured; the draft's prototype: 76)
  ```
- [ ] **Step 6: The mutation table** (`-t "W2[34]|W17e"`). T2-1 to T2-4 were *prototype*-measured on the draft's loop, which this revision restructured; every row is *revised, unmeasured* as written here:

  | Row | Mutation | Expected red set |
  |---|---|---|
  | T2-0 | Red-first: Step 2's cases against Task 1's `ccd/ccrc` | W17e (a), W24a ×3, W24c, W24f |
  | T2-1 | Silence the "is not active after it" line (the `*)` arm's `echo` → `:`) | W17e (a), W24a ×3, W24f |
  | T2-2 | Delete the loop's `for a in ${failed…}` line | W23c, W24b (a second line beside item 3's) |
  | T2-3 | `prior` takes every word that is not `active` (`case "$la" in *)`) | W24d |
  | T2-4 | Drop `arc == 0 &&` from the loop header | W24e |
  | T2-5 | Move the whole block (comment and loop) below the zero line's `return 0; fi` | W24f (an attack lens measured this move leaving the draft's 76 cases green) |
  | T2-6 | A prior unit re-enters `units` (`if [ "$pin" -eq 1 ]` → `if false`) | W24c (code 1: verified, and its crash fails the update) |
  | T2-7 | Silence the "reads 'active' after it" line (the `back)` arm's `echo` → `:`) | W24c |
- [ ] **Step 7: Run the readers of the sweep** (run only), Task 8 Step 4's `ccrc-update` part A (`-t "the supervisor sweep|the health gate|the Darwin arms a Linux leg"`, 40 passed, *prototype* on the draft), `single-definition`, `runbook-holds`, and `session-hook -t "every line citation is anchored"` (13).
- [ ] **Step 8: Commit** `fix(update): a supervisor already down before the sweep's restart is named, never verified, never fatal (Reading 9; D-5136)`.

### Task 3: The stale-pid comment, the pgid clause, and T6-INT-W closed (W16-d, W16-e, W16-f)

**Files:** `ccd/ccrc` (one comment line, in place), `server/test/ccrc-sweep-window.test.ts` (comment lines). No code, no case.

- [ ] **Step 1: Re-measure.**
  ```bash
  grep -nF '# the sweep right after it starts the launcher and truncated right after it is reaped (a stale pid is never signalled).' ccd/ccrc   # :21068
  grep -nF '        lpid=$!; printf' ccd/ccrc                                                     # :21363, the sweep's own write
  grep -nF '        lpid=""; : >"$vdir/launcher.proc"' ccd/ccrc                                   # :21365, the truncation
  grep -nF "  // a job that was never recorded sits in a group nothing signalled, and still reds. Needs the \`kill\` shadow." server/test/ccrc-sweep-window.test.ts   # :121
  ```
- [ ] **Step 2: The stale-pid sentence (W16-d), line-neutral.** `_upd_sweep_stop`'s header line becomes:
  ```bash
  # the sweep right after it starts the launcher and truncated right after it is reaped (an INT in the few builtins between can TERM the reaped pid once).
  ```
  Why: between `wait "$lpid"` returning (`:21364`) and the truncation (`:21365`), an INT runs the handler (`:21361`), which writes the reaped `$lpid` back, and `_upd_sweep_stop` TERMs it because `looped` exists. The window is a few builtins; review 281's ruling tied this sentence to stable (ledger, 2026-10-06 01:29 item 1). It is a header comment outside every function body, so W0's and `single-definition`'s slices are unaffected. No test reads it (`git grep -n 'never signalled'` finds only plans).
- [ ] **Step 3: The pgid clause (W16-e).** In `collect`, after the line Step 1 found, add:
  ```ts
    // NO CASE REDS WHEN THE EXCEPTION IS REMOVED, by construction (wave 16, R18(d)): dropping an exception only makes a
    // case stricter, so only a case that planted the race above could red, and none does — the race is not plantable
    // from here. Measured: `false && termedGroups.has(g)` left this file green in every full run (2 of 2 at `main`
    // 518789ad0, 65 cases; R of R as wave 16 left it, C cases).
  ```
  Write R and C from the worker's own runs of row T3-1 on the finished file (77 cases expected), never a typed number, and never commit the letters *(revised: the draft's comment typed "75", a count measured before W24e and W24f existed, which the file never has at its tip)*.
- [ ] **Step 4: T6-INT-W is closed, unpinnable (W16-f). No code, no case.** The record:
  - **The guard:** the INT handler's own `echo "$lpid" >"$vdir/launcher.proc"` (`:21361`) covers an INT between the launch (`:21362`, `( _upd_sweep_launch … ) &`) and the sweep's own write (`:21363`): two adjacent statements.
  - **The measurement** (*prototype*): with only that text mutated (`then echo "$lpid" >"$vdir/launcher.proc"; _upd_sweep_stop` → `then _upd_sweep_stop`), `ccrc-sweep-window.test.ts -t "W2[12]"` stayed **12 of 12 green in 3 of 3 runs** (36 case-runs). The scout measured the same at `518789ad0`, and wave 12 measured 0 reds in 12 (its plan's row T6-INT-W).
  - **Why no pin:** a deterministic INT between two adjacent statements needs a hook in shipped code, which the 2026-10-06 07:07 ruling forbids ("pins it only if that needs no new seam in shipped code"). The guard stays as reasoned code. Wave 12's Reading 8 recorded it, beside T6-RERAISE, as an unpinned guard; this closes it.
- [ ] **Step 5: The mutation rows:**

  | Row | Mutation | Command | Result |
  |---|---|---|---|
  | T3-1 | `if (termedGroups.has(g))` → `if (false && termedGroups.has(g))` | the whole window file, twice, on the finished file | 0 reds expected. *Prototype*: 75 of 75, 2 of 2, measured before W24e and W24f existed; re-measure on the 77-case file and write that into Step 3's comment |
  | T3-INT | the handler's `launcher.proc` write removed | `-t "W2[12]"`, three times | 0 reds: 12 of 12, 3 of 3 (*prototype*; Step 4) |
- [ ] **Step 6: Run** the window file whole and `session-hook -t "every line citation is anchored"`; commit `docs(update): the stale-pid sentence, the pgid clause's limit, and T6-INT-W closed as unpinnable`.

### Task 4: `verify-service.sh` — an unsearchable registry fails and says why; a purge caught mid-unlink is re-read once (R18(a); D-5137, D-5138)

**Files:** `deploy/verify-service.sh`, `agent/test/deploy-verify.test.ts`.

**Interfaces:** the script's argument, stdout and exit codes are unchanged. New: `STOP_WHY` initialised empty beside the knobs; one `## <cause>` stderr line in `fail` when `STOP_WHY` is set; and the function `registry_evidence` (rc 0 evidence, rc 1 refusal, rc 2 the race shape). No new environment knob: the re-read reuses `STOP_INTERVAL` (`CCRC_VERIFY_STOP_INTERVAL`, already `0` in every harness: `runVerify`, `sweepFixture`'s base env, V16's sweep).

- [ ] **Step 1: Re-measure.**
  ```bash
  grep -nF '  [ -d "$reg" ] || return 1' deploy/verify-service.sh                              # :137
  grep -nF '  [ "$st" = inactive ] || return 1' deploy/verify-service.sh                         # :144
  grep -nF '    return 1' deploy/verify-service.sh                                               # :167, the kept-row arm
  grep -nF '  echo "## $1" >&2' deploy/verify-service.sh                                         # :180, in fail
  grep -nF 'STOP_INTERVAL="${CCRC_VERIFY_STOP_INTERVAL:-1}"' deploy/verify-service.sh            # :69 (V22 pins it)
  grep -n 'STOP_WHY' deploy/verify-service.sh                                                    # nothing at 518789ad0
  diff <(git show origin/main:deploy/verify-service.sh | sed -n '1,62p') <(sed -n '1,62p' deploy/verify-service.sh)   # nothing
  cd agent && ./node_modules/.bin/vitest list test/deploy-verify.test.ts | wc -l    # 85 at 518789ad0
  ```
  (The registry's mode is read once, in Task 8 Step 1, on this box only.)
- [ ] **Step 2: Write the cases first (red).** At the end of `describe('verify-service.sh tells a deliberate supervisor stop from a crash (wave 10, R12)'`, after V30 (before its closing `});`, the end of the file at `518789ad0`):
  ```ts
    // ── wave 16, R18(a) (D-5137, D-5138) ─────────────────────────────────────
    const UNSEARCHABLE = '## ~/.cc-sessions cannot be searched (no x permission), so ccd\'s stop stamp and registry row cannot be '
      + 'read — a deliberate stop cannot be told from a crash';
    const isRoot = (process.getuid?.() ?? 1) === 0;
    /** The settle's exact query order: the check's is-active, its MainPID, the window's is-active, then the classifier's
     *  own is-active (its settle read). The `-x` refusal comes AFTER the fourth (D-5137; Reading 4). */
    const SETTLED = (u: string): string[] => [
      `systemctl --user is-active ${u}`,
      `systemctl --user show -p MainPID --value ${u}`,
      `systemctl --user is-active ${u}`,
      `systemctl --user is-active ${u}`,
    ];

    // Root ignores mode bits, so the plant would not be unsearchable there. The mode is restored in `finally`: a 0600
    // directory would defeat the fixture's own cleanup.
    it.skipIf(isRoot).each([
      ['a stamped stop with its row kept', { 'demo-gone.uuid': 'u', 'demo-gone.stopped': '1791151850 ccd' }],
      ['an empty registry', {}],
    ] as const)('V31: an unsearchable registry (%s) is not a purged row — the unit fails, and says why (D-5137)', (_label, files) => {
      const home = fixtureHome(); plantReg(home, files);
      const reg = path.join(home, '.cc-sessions');
      chmodSync(reg, 0o600);
      try {
        const r = runVerify(stubs({ isActive: ['active', 'inactive', 'inactive'], mainPid: ['4242'] }), U, { home });
        expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(1);
        expect(r.stdout).not.toContain('stopped on purpose');
        expect(r.stderr.split('\n')).toContain(UNSEARCHABLE);
        expect(r.stderr).toContain("became 'inactive'");
        expect(nLoadState(r.calls), 'the purged arm was never reached').toBe(0);
        expect(r.calls.trim().split('\n').slice(0, 4), 'the -x test sits after the settle (D-5137)').toEqual(SETTLED(U));
      } finally {
        chmodSync(reg, 0o755);
      }
    }, 30_000);

    it('V31b: a searchable registry never prints that cause (V5\'s hand stop)', () => {
      const home = fixtureHome(); plantReg(home, { 'demo-gone.uuid': 'u' });
      const r = runVerify(stubs({ isActive: ['active', 'inactive', 'inactive'], mainPid: ['4242'] }), U, { home });
      expect(r.code).toBe(1);
      expect(r.stderr).not.toContain('cannot be searched');
    }, 30_000);

    it('V31c: a STOP_WHY in the caller\'s environment never prints a cause line (a crash; D-5137)', () => {
      const home = fixtureHome(); plantReg(home, {});
      const r = runVerify(stubs({ isActive: ['active', 'active'], mainPid: ['4242', '5151'] }), U,
        { home, env: { STOP_WHY: 'planted' } });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('CRASH-LOOPING');
      expect(r.stderr).not.toContain('## planted');
    }, 30_000);

    /** A stub `sleep` that records its argument and, when it is the distinctive STOP_INTERVAL 7, acts on the registry:
     *  the second half of a purge (`rm` the uuid), a stamp landing, or nothing. */
    const sleepActing = (dir: string, home: string, act: 'purge' | 'stamp' | 'none'): void => {
      const reg = path.join(home, '.cc-sessions');
      const action = act === 'purge' ? `rm -f ${JSON.stringify(path.join(reg, 'demo-gone.uuid'))}`
        : act === 'stamp' ? `printf '%s\\n' '1791151850 ccd' > ${JSON.stringify(path.join(reg, 'demo-gone.stopped'))}`
          : ':';
      writeFileSync(path.join(dir, 'sleep'),
        `#!/bin/sh\nD=${JSON.stringify(dir)}\nprintf '%s\\n' "$1" >> "$D/sleeps"\n[ "$1" = 7 ] && ${action}\nexit 0\n`,
        { mode: 0o755 });
    };
    const sleeps = (dir: string): string[] => readFileSync(path.join(dir, 'sleeps'), 'utf8').trim().split('\n');

    it('V32: a purge caught between its two unlinks is re-read once, STOP_INTERVAL later, and passes as purged (D-5138)', () => {
      const home = fixtureHome(); plantReg(home, { 'demo-gone.uuid': 'u' });
      const dir = stubs({ isActive: ['active', 'inactive', 'inactive'], mainPid: ['4242'] });
      sleepActing(dir, home, 'purge');
      const r = runVerify(dir, U, { home, env: { CCRC_VERIFY_STOP_INTERVAL: '7' }, provesSleep: true });
      expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
      expect(r.stdout.trim()).toBe(PURGED_LINE);
      expect(sleeps(dir)).toEqual(['0', '0', '7']);
      expect(nLoadState(r.calls)).toBe(1);
    }, 30_000);

    it('V32b: a stamp that lands by the re-read passes as stamped, with no LoadState query (D-5138)', () => {
      const home = fixtureHome(); plantReg(home, { 'demo-gone.uuid': 'u' });
      const dir = stubs({ isActive: ['active', 'inactive', 'inactive'], mainPid: ['4242'] });
      sleepActing(dir, home, 'stamp');
      const r = runVerify(dir, U, { home, env: { CCRC_VERIFY_STOP_INTERVAL: '7' }, provesSleep: true });
      expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
      expect(r.stdout.trim()).toBe(STAMPED_LINE);
      expect(sleeps(dir)).toEqual(['0', '0', '7']);
      expect(nLoadState(r.calls)).toBe(0);
    }, 30_000);

    it('V32c: a hand stop (the row kept, no stamp, at both reads) still fails — after exactly one re-read (D-5138)', () => {
      const home = fixtureHome(); plantReg(home, { 'demo-gone.uuid': 'u' });
      const dir = stubs({ isActive: ['active', 'inactive', 'inactive'], mainPid: ['4242'] });
      sleepActing(dir, home, 'none');
      const r = runVerify(dir, U, { home, env: { CCRC_VERIFY_STOP_INTERVAL: '7' }, provesSleep: true });
      expect(r.code).toBe(1);
      expect(r.stdout).not.toContain('stopped on purpose');
      expect(r.stderr).toContain('DEPLOY FAILED');
      expect(sleeps(dir)).toEqual(['0', '0', '7']);
      expect(nLoadState(r.calls)).toBe(0);
      expect(r.calls.trim().split('\n').slice(0, 4)).toEqual(SETTLED(U));
    }, 30_000);
  ```
  *(revised, unmeasured: `SETTLED`, V31's call-log assertion and V31c are new; V32c's log is the same four lines as the draft's.)* `runVerify` spreads `process.env` before `opts.env` (`agent/test/deploy-verify.test.ts:104-108`), which is exactly why V31c plants `STOP_WHY` there.
- [ ] **Step 3: Run them red** against `main`'s script:
  ```bash
  cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts -t "V3[12]"
  ```
  Expected (T4-0): **5 failed** | 2 passed. Both V31 rows red on `code` (the shipped script exits **0**, "its registry row is purged", over an unsearchable registry: a false pass, not only a misread); V32, V32b and V32c red on `sleeps` (`['0', '0']`, no re-read). V31b and V31c are green: V31b pins that a searchable registry never prints the cause, and V31c that no planted cause prints (the shipped `fail` has no cause line). (*Prototype*, on the draft's six cases: 5 failed | 1 passed; V31c is *revised, unmeasured*.)
- [ ] **Step 4: The change.** In `deploy/verify-service.sh`, all below line 62 (the hunk headers are guides; apply by the quoted text):
  ```diff
  --- a/deploy/verify-service.sh
  +++ b/deploy/verify-service.sh
  @@ -69,1 +69,2 @@ STOP_POLLS="${CCRC_VERIFY_STOP_POLLS:-10}"
   STOP_INTERVAL="${CCRC_VERIFY_STOP_INTERVAL:-1}"
  +STOP_WHY=""   # the classifier's refusal cause, printed by fail (wave 16, D-5137); never inherited from the caller
  @@ -111,2 +112,5 @@ STOP_INTERVAL="${CCRC_VERIFY_STOP_INTERVAL:-1}"
   # and ccrc-agent.service never reach the registry, and never cost a query.
  +# Nor is a registry this user cannot SEARCH (wave 16, D-5137): without its x bit
  +# every `-e`/`-L` under it answers false, so a kept row would read as purged and
  +# a crash would pass. It fails, and the failure names that cause (STOP_WHY).
   #
  @@ -129,17 +133,9 @@ ccd_id_ok() {   # <id> -> 0 iff ccd could have minted it
   
  -stopped_on_purpose() {   # -> 0, and one stdout line, iff $UNIT is a session stopped on purpose
  -  local id reg st n=0 s evidence load
  -  case "$UNIT" in claude-session@?*.service) ;; *) return 1 ;; esac
  -  id="${UNIT#claude-session@}"; id="${id%.service}"
  -  case "$id" in */*) return 1 ;; esac
  -  [ -n "${HOME:-}" ] || return 1
  -  reg="$HOME/.cc-sessions"
  -  [ -d "$reg" ] || return 1
  -  st=$(systemctl --user is-active "$UNIT" 2>&1)
  -  while [ "$st" = deactivating ] && [ "$n" -lt "$STOP_POLLS" ]; do
  -    sleep "$STOP_INTERVAL"
  -    n=$((n + 1))
  -    st=$(systemctl --user is-active "$UNIT" 2>&1)
  -  done
  -  [ "$st" = inactive ] || return 1
  +# registry_evidence — the registry half of stopped_on_purpose, which runs it with `id` and `reg` set (bash's dynamic
  +# scope). rc 0 with `evidence` set: the stamp is present, or the row is purged. rc 1: the purged arm refused (not a ccd
  +# id, or a unit systemd cannot load). rc 2: the stamp is ABSENT and `<id>.uuid` PRESENT — a hand stop, or `_reg_purge` caught
  +# between two unlinks (it takes `<id>.stopped` before `<id>.uuid`; R18(a)), which stopped_on_purpose re-reads once
  +# (wave 16, D-5138). Filesystem reads only, apart from the purged arm's one LoadState query.
  +registry_evidence() {
  +  local s load
     if [ -e "$reg/$id.stopped" ]; then
  @@ -166,4 +162,29 @@ stopped_on_purpose() {   # -> 0, and one stdout line, iff $UNIT is a session sto
     else
  -    return 1
  +    return 2
     fi
  +  return 0
  +}
  +
  +stopped_on_purpose() {   # -> 0, and one stdout line, iff $UNIT is a session stopped on purpose
  +  local id reg st n=0 evidence rc=0
  +  case "$UNIT" in claude-session@?*.service) ;; *) return 1 ;; esac
  +  id="${UNIT#claude-session@}"; id="${id%.service}"
  +  case "$id" in */*) return 1 ;; esac
  +  [ -n "${HOME:-}" ] || return 1
  +  reg="$HOME/.cc-sessions"
  +  [ -d "$reg" ] || return 1
  +  st=$(systemctl --user is-active "$UNIT" 2>&1)
  +  while [ "$st" = deactivating ] && [ "$n" -lt "$STOP_POLLS" ]; do
  +    sleep "$STOP_INTERVAL"
  +    n=$((n + 1))
  +    st=$(systemctl --user is-active "$UNIT" 2>&1)
  +  done
  +  [ "$st" = inactive ] || return 1
  +  # An unsearchable registry answers every test below with "absent" (wave 16, D-5137; R18(a)): refuse, and say why.
  +  [ -x "$reg" ] || { STOP_WHY="~/.cc-sessions cannot be searched (no x permission), so ccd's stop stamp and registry row cannot be read — a deliberate stop cannot be told from a crash"; return 1; }
  +  # The purge window (wave 16, D-5138; R18(a)): ONE more read, STOP_INTERVAL later, of a stamp-absent, uuid-present
  +  # row. A purge in flight then reads purged; a hand stop still reads the same, and fails as before.
  +  registry_evidence; rc=$?
  +  if [ "$rc" -eq 2 ]; then sleep "$STOP_INTERVAL"; registry_evidence; rc=$?; fi
  +  [ "$rc" -eq 0 ] || return 1
     echo "stopped on purpose: $UNIT settled 'inactive', and $evidence — a deliberate stop, not a crash"
  @@ -180,2 +201,3 @@ fail() {
     echo "## $1" >&2
  +  [ -z "$STOP_WHY" ] || echo "## $STOP_WHY" >&2
     echo "##" >&2
  ```
  - `registry_evidence` is the old body's registry half, moved whole with its comments; only its last `return 1` becomes `return 2`, and it ends `return 0`.
  - The `-x` test sits AFTER the unit settles `inactive`, not beside `[ -d "$reg" ]` as the ledger sketched it (D-5137): so the cause prints only when the classifier was really asked, and a unit that never settles keeps today's message and query count. V31's `SETTLED` log pins the placement (row T4-5).
  - `STOP_WHY` is a global, set empty at the top (the script is `set -u`, and an inherited value must never print: V31c) *(revised)*; `stopped_on_purpose` runs in the script's own shell (`stopped_on_purpose && exit 0`), so `fail` sees what it set.
  - `bash -n deploy/verify-service.sh`, and the line-pin `diff` above prints nothing.
- [ ] **Step 5: Run green.**
  ```bash
  cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts            # 92 passed (85 + 7; revised, unmeasured; the draft's prototype: 91)
  cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-deliberate-stop.test.ts   # 8 passed: the FROZEN v0.0.84 sweep with this script
  cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-window.test.ts       # the tree's sweep with this script
  ```
- [ ] **Step 6: The old sweep with the new script, measured once by hand** (Risk notes; *prototype* on the draft's script: 65 of 65). Copy `git show origin/main:ccd/ccrc` and `git show origin/main:server/test/ccrc-sweep-window.test.ts` over the two files, keep this task's script and Task 1's fixture, run the window file, then restore both with `cp` + `cmp`. Record the count in the wave-done.
- [ ] **Step 7: The mutation table** (the whole agent file; T4-0 to T4-4 *prototype* on the draft's script, T4-5 and T4-6 *revised, unmeasured*):

  | Row | Mutation | Expected red set |
  |---|---|---|
  | T4-0 | Red-first: Step 2's cases against `main`'s script | V31 ×2, V32, V32b, V32c |
  | T4-1 | `[ -x "$reg" ] \|\| {` → `: \|\| {` | V31 ×2 (code: the false pass is back) |
  | T4-2 | Delete `fail`'s `STOP_WHY` line | V31 ×2 (the cause line) |
  | T4-3 | `if [ "$rc" -eq 2 ]; then sleep` → `if false; then sleep` | V32, V32b, V32c |
  | T4-4 | The re-read always passes (`registry_evidence; rc=$?; fi` → `registry_evidence; rc=0; evidence="the re-read"; fi`) | V5, V9, V16(b), V26, V31b, V32, V32b, V32c (8: every kept row now passes) |
  | T4-5 | The `-x` line moved up to directly after `  [ -d "$reg" ] \|\| return 1` | V31 ×2 (the `SETTLED` log: the fourth call is `status`, not the settle's `is-active`; an attack lens measured this move leaving the draft's 104 cases green) |
  | T4-6 | Delete `STOP_WHY=""` | V31c (`## planted`) |
- [ ] **Step 8: Commit** `fix(update): verify-service.sh fails a registry it cannot search, and re-reads a purge caught mid-unlink once (D-5137, D-5138)`.

### Task 5: The Darwin stay-up helpers — an INT ends the window, no unit is a refusal, a failed print is unmeasured (R18(b), R10j; D-5139, D-5140, D-5141)

**Files:** `ccd/ccrc`, NEW `server/test/ccrc-darwin-job-helpers.test.ts`.

**Interfaces:** `_ccrc_job_pid <unit>` prints a pid, nothing (no pid, or not loaded: rc 113), or `!<rc>` (a print that failed). `_ccrc_job_stayed_up <unit>...` keeps its globals and its one-unit contract; with no unit it answers 1 at once, with the globals empty. Callers: `_inst_enable` (`:14813`), the health gate (`:19887`) and the sweep's Darwin arm (`:21193`, `:21203`); no caller passes zero units, and none calls either helper inside `$(…)` (`grep -n '_ccrc_job_' ccd/ccrc`).

- [ ] **Step 1: Re-measure.**
  ```bash
  grep -nF '_ccrc_job_pid() {' ccd/ccrc                                                         # :21000
  grep -nF '  out="$(_svc_launchctl print "$(_svc_domain)/$(_svc_label "$1")" 2>/dev/null)" || return 0' ccd/ccrc   # :21002
  grep -nF '  sleep "${CCRC_VERIFY_SETTLE:-3}"' ccd/ccrc                                         # :21015
  grep -nF '  sleep "${CCRC_VERIFY_WINDOW:-5}"' ccd/ccrc                                         # :21017
  grep -n '_ccrc_job_pid\|_ccrc_job_stayed_up' ccd/ccrc                                          # the callers above, no others
  grep -n "trap " ccd/ccrc | grep -v '^[0-9]*: *#'                                              # every INT/TERM trap exits; none on these paths
  ```
- [ ] **Step 2: Write the cases first (red):** the new file, whole:
  ```ts
  // The Darwin sweep's stay-up helpers, `_ccrc_job_pid` and `_ccrc_job_stayed_up` (centralised update management, wave
  // 16: R18(b) and R10j; D-5139, D-5140, D-5141). They serve three callers on a Mac: `_upd_sweep`'s Darwin arm,
  // `_inst_enable`'s stay-up check and the update's health gate. No macOS box is centrally managed (design decision 17),
  // so the cases run the helpers SOURCED out of the tree's `ccd/ccrc` on Linux, with `_svc_launchctl`, `_svc_domain` and
  // `_svc_label` shadowed by shell functions: what is under test is the helpers' own shell, not launchd. Every case is
  // `itLinux`: J6 reads `/proc` through `survivors`, and `sweepFixture.ts` has never run on the macOS leg, so this file
  // gives that leg no evidence (the plan's Reading 9).
  //
  // SAFETY. `sweepFixture.ts`'s fixture HOME and env, built from scratch, with every tool that is not a stub a recording
  // POISON (`launchctl` among them), and `assertContained` on the spawn's final env before every spawn. The shadowed
  // `_svc_launchctl` never execs a binary. A case that leaves a background `sleep` behind (the INT cases: the helper's
  // own orphan, by design) COLLECTS it, REAPS it, and only then asserts.
  import { describe, expect } from 'vitest';
  import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { spawn, spawnSync } from 'node:child_process';
  import { itLinux } from './platformFixtures.js';
  import { BASH, CCRC_SRC, assertContained, makeBox, poisonFiles, reapSurvivors, survivors, type Box } from './sweepFixture.js';

  /** The shadows. `_svc_launchctl print <domain>/<label>` answers from `$HOME/lc/<label>`, one line per call (the last
   *  repeating): `<rc> <pid>`; rc 0 prints a launchd-shaped record carrying that pid, any other rc prints nothing. Every
   *  call touches `$HOME/lc/called`, so a case can tell when the first pid read has happened. */
  const SHADOWS = [
    '_svc_domain() { printf %s gui/501; }',
    '_svc_label() { local x="${1#claude-session@}"; printf %s "app.ccrc.session.${x%.service}"; }',
    '_svc_launchctl() {',
    '  [ "$1" = print ] || return 90',
    '  local f="$HOME/lc/${2##*/}" n=0 line rc',
    '  [ -f "$f.n" ] && IFS= read -r n < "$f.n"',
    '  n=$((n + 1)); echo "$n" > "$f.n"; : > "$HOME/lc/called"',
    '  line=$(sed -n "${n}p" "$f"); [ -n "$line" ] || line=$(tail -n 1 "$f")',
    '  rc="${line%% *}"',
    '  [ "$rc" = 0 ] && printf \'%s\\n\\tpid = %s\\n\\tstate = running\\n\' "{" "${line#* }"',
    '  return "$rc"',
    '}',
  ].join('\n');

  const OUT = 'printf "rc=%s\\nbad=%s\\nwhy=%s\\ndetail=%s\\n" "$rc" "${CCRC_STAYED_BAD[*]}" "${CCRC_STAYED_WHY[*]}" "$CCRC_STAYED_DETAIL"';

  interface Plan { [label: string]: string[] }

  function box(plan: Plan): Box {
    const b = makeBox({ units: [] });
    mkdirSync(join(b.home, 'lc'), { recursive: true });
    for (const [label, answers] of Object.entries(plan)) writeFileSync(join(b.home, 'lc', `app.ccrc.session.${label}`), answers.join('\n') + '\n');
    return b;
  }

  function script(body: string): string[] {
    return ['-c', ['. "$1"', SHADOWS, body].join('\n'), 'ccrc-under-test', CCRC_SRC];
  }

  function run(b: Box, body: string, env: Record<string, string> = {}): { code: number; out: Record<string, string>; stderr: string } {
    const e = { ...b.env, ...env };
    assertContained({ home: b.home, env: e });
    const r = spawnSync(BASH, script(body), { env: e, encoding: 'utf8', timeout: 45_000 });
    const out: Record<string, string> = {};
    for (const l of (r.stdout ?? '').split('\n')) { const k = l.indexOf('='); if (k > 0) out[l.slice(0, k)] = l.slice(k + 1); }
    return { code: r.status ?? -1, out, stderr: r.stderr ?? '' };
  }

  const U1 = 'claude-session@demo-a.service';
  const U2 = 'claude-session@demo-b.service';

  describe('_ccrc_job_stayed_up: no unit is a refusal, never a vacuous pass (wave 16, R18(b); D-5140)', () => {
    itLinux('J1 called with no unit, it answers 1 at once, with the globals empty, and never sleeps the settle', () => {
      const b = box({});
      const r = run(b, `s=$SECONDS; _ccrc_job_stayed_up; rc=$?; el=$((SECONDS - s)); ${OUT}; echo "el=$el"`,
        { CCRC_VERIFY_SETTLE: '6', CCRC_VERIFY_WINDOW: '0' });
      expect(r.code, r.stderr).toBe(0);
      expect(r.out).toMatchObject({ rc: '1', bad: '', why: '', detail: '' });
      expect(Number(r.out['el']), 'the helper slept before refusing').toBeLessThanOrEqual(1);
      expect(poisonFiles(b)).toEqual([]);
    }, 60_000);

    itLinux('J1b one unit keeps the contract the gate and _inst_enable read: rc 0 and the one detail', () => {
      const b = box({ 'demo-a': ['0 4242'] });
      const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, { CCRC_VERIFY_SETTLE: '0', CCRC_VERIFY_WINDOW: '0' });
      expect(r.out).toMatchObject({ rc: '0', bad: '', detail: 'pid 4242 -> 4242 across 0s+0s' });
    }, 60_000);
  });

  describe('_ccrc_job_pid: a failed launchctl print is not an unloaded job (wave 16, R10j; D-5141)', () => {
    const ENV = { CCRC_VERIFY_SETTLE: '0', CCRC_VERIFY_WINDOW: '0' };

    itLinux('J2 a print that failed at both reads is UNMEASURED: the job did not stay up, and the detail says why', () => {
      const b = box({ 'demo-a': ['1 -'] });
      const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, ENV);
      expect(r.out['rc'], 'two equal failed reads must never read as one stable pid').toBe('1');
      expect(r.out['bad']).toBe(U1);
      expect(r.out['detail']).toBe('pid unmeasured (launchctl print exited 1) -> unmeasured (launchctl print exited 1) across 0s+0s');
    }, 60_000);

    itLinux('J3 a job launchd does not hold (113) keeps its old detail: no pid at either read', () => {
      const b = box({ 'demo-a': ['113 -'] });
      const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, ENV);
      expect(r.out).toMatchObject({ rc: '1', bad: U1, detail: 'pid none -> none across 0s+0s' });
    }, 60_000);

    itLinux('J4 a print that failed once, then answered, is still a job that did not stay up, named as unmeasured', () => {
      const b = box({ 'demo-a': ['1 -', '0 4242'] });
      const r = run(b, `_ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`, ENV);
      expect(r.out).toMatchObject({ rc: '1', bad: U1, detail: 'pid unmeasured (launchctl print exited 1) -> 4242 across 0s+0s' });
    }, 60_000);

    itLinux('J5 in a shared window, only the unmeasured job is listed', () => {
      const b = box({ 'demo-a': ['1 -'], 'demo-b': ['0 5151'] });
      const r = run(b, `_ccrc_job_stayed_up ${U1} ${U2}; rc=$?; ${OUT}`, ENV);
      expect(r.out).toMatchObject({ rc: '1', bad: U1 });
      expect(r.out['why']).toBe('pid unmeasured (launchctl print exited 1) -> unmeasured (launchctl print exited 1) across 0s+0s');
    }, 60_000);
  });

  describe('_ccrc_job_stayed_up: an INT to the shell alone ends it at once (wave 16, R18(b); D-5139)', () => {
    // A foreground `sleep` makes bash hold an INT sent to the shell alone until the sleep exits (measured: 4.0 s for a
    // `sleep 4`, then the script went on); a `wait` on a background sleep returns at once. The orphaned `sleep` carries
    // the fixture HOME, so `survivors` finds it and `reapSurvivors` ends it.
    const pause = (ms: number): Promise<void> => new Promise((res) => { setTimeout(res, ms); });

    itLinux.each([
      ['the settle', 'start', { CCRC_VERIFY_SETTLE: '8', CCRC_VERIFY_WINDOW: '0' }],
      ['the window', 'called', { CCRC_VERIFY_SETTLE: '0', CCRC_VERIFY_WINDOW: '8' }],
    ] as const)('J6 an INT during %s ends the run by that signal, well inside the sleep', async (_label, marker, env) => {
      const b = box({ 'demo-a': ['0 4242'] });
      const e = { ...b.env, ...env };
      assertContained({ home: b.home, env: e });
      const child = spawn(BASH, script(`: > "$HOME/lc/start"; _ccrc_job_stayed_up ${U1}; rc=$?; ${OUT}`),
        { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
        child.on('exit', (code, signal) => { res({ code, signal }); });
      });
      const deadline = Date.now() + 20_000;
      while (!existsSync(join(b.home, 'lc', marker)) && Date.now() < deadline) await pause(25);
      expect(existsSync(join(b.home, 'lc', marker)), 'the helper never reached the sleep under test').toBe(true);
      await pause(300);
      const sent = Date.now();
      child.kill('SIGINT');
      const end = await Promise.race([done, pause(15_000).then(() => null)]);
      const elapsed = Date.now() - sent;
      if (end === null) child.kill('SIGKILL');
      reapSurvivors(b);
      expect(survivors(b)).toEqual([]);
      expect(end, 'the shell never exited').not.toBeNull();
      expect(end!.signal, `stdout: ${stdout}`).toBe('SIGINT');
      expect(elapsed, 'the INT waited out the sleep').toBeLessThan(4_000);
      expect(stdout).not.toContain('rc=');
    }, 60_000);
  });
  ```
- [ ] **Step 3: Run it red** against `main`'s `ccd/ccrc`:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-darwin-job-helpers.test.ts
  ```
  Expected (T5-0, *prototype*): **6 failed** | 2 passed. J1 (rc 0 after the whole 6 s settle), J2 and J4 and J5 (the detail reads `pid none -> none`: the failed print is called unloaded), and both J6 rows (the INT was held until the 8 s `sleep` ended, and the run printed `rc=0`). J1b and J3 are green: they pin the one-unit contract and the 113 detail that must not move.
- [ ] **Step 4: The change.** In `ccd/ccrc`:
  ```diff
  --- a/ccd/ccrc
  +++ b/ccd/ccrc
  @@ -20999,5 +20999,12 @@ _upd_legacy_target() {   # <tag> -> 0, or dies before anything is installed
   # the same file's Darwin-arm test).
  -_ccrc_job_pid() {   # <unit> -> the job's pid on stdout, or nothing when it has none
  -  local out
  -  out="$(_svc_launchctl print "$(_svc_domain)/$(_svc_label "$1")" 2>/dev/null)" || return 0
  +# `_ccrc_job_pid` tells a `launchctl print` that FAILED from a job launchd does not hold (wave 16, R10j; D-5141): 113 is
  +# launchd's one positive "not loaded" answer (`_svc_is_active`'s rule), so it prints nothing, as a job with no pid does;
  +# any other non-zero exit prints `!<rc>`, a question never answered. It runs inside `$(…)`, so the answer rides stdout.
  +_ccrc_job_pid() {   # <unit> -> the job's pid on stdout; nothing when it has none or is not loaded (113); `!<rc>` when print failed
  +  local out rc=0
  +  out="$(_svc_launchctl print "$(_svc_domain)/$(_svc_label "$1")" 2>/dev/null)" || rc=$?
  +  if [ "$rc" -ne 0 ]; then
  +    [ "$rc" -eq 113 ] || printf '!%s' "$rc"
  +    return 0
  +  fi
     case "$out" in
  @@ -21011,13 +21018,21 @@ _ccrc_job_stayed_up() {   # <unit>... -> 0 iff ONE pid held across ONE shared wi
     # whose pid did not hold, CCRC_STAYED_WHY their details in the same order, and CCRC_STAYED_DETAIL is the first one's.
  -  local u i=0 d p2
  +  # Wave 16 (R18(b); D-5139, D-5140): no unit is a refusal, never a vacuous pass, and each sleep runs in the background
  +  # under a `wait`, which an INT to this shell alone interrupts at once (a foreground `sleep` defers it to the sleep's
  +  # end). The orphaned `sleep` ends by itself. A caller that traps another signal and returns would cut the window short:
  +  # no caller does. An unmeasured read (`!<rc>`, D-5141) never holds, even against an equal one.
  +  local u i=0 d p2 a b
     local -a p1=()
     CCRC_STAYED_BAD=(); CCRC_STAYED_WHY=(); CCRC_STAYED_DETAIL=""
  -  sleep "${CCRC_VERIFY_SETTLE:-3}"
  +  [ "$#" -gt 0 ] || return 1
  +  sleep "${CCRC_VERIFY_SETTLE:-3}" & wait $!
     for u in "$@"; do p1+=("$(_ccrc_job_pid "$u")"); done
  -  sleep "${CCRC_VERIFY_WINDOW:-5}"
  +  sleep "${CCRC_VERIFY_WINDOW:-5}" & wait $!
     for u in "$@"; do
       p2="$(_ccrc_job_pid "$u")"
  -    d="pid ${p1[i]:-none} -> ${p2:-none} across ${CCRC_VERIFY_SETTLE:-3}s+${CCRC_VERIFY_WINDOW:-5}s"
  +    a="${p1[i]:-none}"; b="${p2:-none}"
  +    case "$a" in '!'*) a="unmeasured (launchctl print exited ${a#!})" ;; esac
  +    case "$b" in '!'*) b="unmeasured (launchctl print exited ${b#!})" ;; esac
  +    d="pid $a -> $b across ${CCRC_VERIFY_SETTLE:-3}s+${CCRC_VERIFY_WINDOW:-5}s"
       [ "$#" -eq 1 ] && CCRC_STAYED_DETAIL="$d"
  -    if [ -z "${p1[i]}" ] || [ "${p1[i]}" != "$p2" ]; then
  +    if [ -z "${p1[i]}" ] || [ "${p1[i]}" != "$p2" ] || [ "${p1[i]:0:1}" = '!' ]; then
         CCRC_STAYED_BAD+=("$u"); CCRC_STAYED_WHY+=("$d")
  ```
  - `_ccrc_job_pid` keeps `return 0` on every path, so `$(…)` callers see only its stdout.
  - The `!`-prefixed first read is refused explicitly, because two equal sentinels (`!1`, `!1`) would pass `p1 != p2` as one stable pid.
  - The zero-unit guard sits AFTER the globals are emptied, so a caller reads empty globals.
  - `bash -n ccd/ccrc`.
- [ ] **Step 5: Run green.**
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-darwin-job-helpers.test.ts   # 8 passed (prototype)
  ```
  Then `ccrc-update`'s part A (Task 8 Step 4): its Darwin sweep cases (D1 to D8 run on Linux with a `launchctl` stub) and its health-gate cases stay green (40, *prototype*).
- [ ] **Step 6: The mutation table** (*prototype*, the new file whole):

  | Row | Mutation | Expected red set (measured) |
  |---|---|---|
  | T5-0 | Red-first: the new file against `main`'s `ccd/ccrc` | J1, J2, J4, J5, J6 ×2 |
  | T5-1 | The settle back to a foreground `sleep` | J6 (the settle) |
  | T5-2 | The window back to a foreground `sleep` | J6 (the window) |
  | T5-3 | Delete `[ "$#" -gt 0 ] \|\| return 1` | J1 |
  | T5-4 | The sentinel collapsed (`[ "$rc" -eq 113 ] \|\| printf '!%s' "$rc"` → `:`) | J2, J4, J5 |
  | T5-5 | Drop `\|\| [ "${p1[i]:0:1}" = '!' ]` | J2 ("two equal failed reads must never read as one stable pid"), J5 |
- [ ] **Step 7: Commit** `fix(update): the Darwin stay-up helper ends on an INT, refuses no unit, and tells a failed launchctl print from an unloaded job (D-5139, D-5140, D-5141)`.

### Task 6: The fallback deploy — the prune refuses a bad KEEP, the sweep refuses an unread listing (R8c, R10c(3); D-5142, D-5143)

**Files:** `deploy/deploy.sh`, `agent/test/deploy-verify.test.ts`.

**Interfaces:** `prune_backups` returns 1, with one warning and no `ssh`, for a KEEP outside `^[0-9]{1,4}$`; everything else in it is byte-identical. `SWEEP_CMD` exits 1, before any KillMode query or restart, when its listing fails; its success-path call order is unchanged.

- [ ] **Step 1: Re-measure.**
  ```bash
  grep -nF '  local keep="${CCRC_BACKUP_KEEP:-10}"' deploy/deploy.sh                              # :242, the one line this task replaces
  grep -nF '# would report failure for services that are live and green.' deploy/deploy.sh         # :240, never edited
  grep -nF '      | sort | head -n -$keep | xargs -r rm -rf --"' deploy/deploy.sh                    # :245, never edited
  grep -nF '  # healthy box makes it look unnecessary.' deploy/deploy.sh                           # :1109
  grep -nF '    && for u in $(systemctl --user list-units "claude-session@*" --plain --no-legend | awk "{print \$1}") claude-session@ccrc-deploy-preflight.service; do \' deploy/deploy.sh   # :1111
  grep -nF '_keep_ok() { [[ "$1" =~ ^[0-9]{1,4}$ ]]; }' ccd/ccrc                                  # :22055, fenced: read only
  ```
  `deploy.sh` cannot source `ccd/ccrc` (it runs on the operator's machine), so the KEEP test is a second spelling of `_keep_ok` by design. Measured before choosing its shape: with the validator in place, `single-definition.test.ts` stays green (571, *prototype*; 585 on the tree merged with `0b3ff2f62`): no scan there reads `KEEP`, `_keep_ok` or `{1,4}`. D1c holds the two spellings equal instead.
- [ ] **Step 2: Write the cases first (red).** Append this describe at the end of `agent/test/deploy-verify.test.ts`:
  ```ts
  // WAVE 16 (centralised update management; R8c, R10c(3); D-5142, D-5143): the fallback deploy's backup prune refuses a
  // KEEP that is not a whole number, and its supervisor sweep refuses when it cannot list the supervisors. Both are RUN,
  // extracted from deploy.sh, on a fixture HOME with a stub `ssh` (a shell function in the SSH array, and recording
  // poisons for the real `ssh` and `scp` first on PATH) or a stub `systemctl`; nothing reaches a box.
  describe('deploy.sh refuses what it cannot measure: the prune KEEP and the sweep listing (wave 16, D-5142, D-5143)', () => {
    const deploySh = readFileSync(path.join(deployDir, 'deploy.sh'), 'utf8');

    /** `prune_backups` out of deploy.sh, run with `SSH` a function that records the remote command and does nothing.
     *  `ssh` and `scp` on PATH are recording poisons, proven to resolve before the spawn: a prune that ever reached for
     *  a real binary would write `poison`, and every row asserts it is empty. */
    const runPrune = (keep: string | undefined): { code: number; stderr: string; remote: string | null; poison: string } => {
      const fn = /prune_backups\(\) \{([\s\S]*?)\n\}/.exec(deploySh);
      expect(fn, 'deploy.sh has no prune_backups() helper').toBeTruthy();
      const home = mkTmp('ccrc-agent-prunekeep-');
      const rec = path.join(home, 'remote');
      const poison = path.join(home, 'poison');
      const bin = path.join(home, 'stubbin');
      mkdirSync(bin, { recursive: true });
      for (const t of ['ssh', 'scp']) {
        writeFileSync(path.join(bin, t), `#!/bin/sh\necho "${t} $*" >> ${JSON.stringify(poison)}\nexit 97\n`, { mode: 0o755 });
      }
      const script = [
        `ssh_stub() { printf '%s' "$2" > ${JSON.stringify(rec)}; }`,
        'SSH=(ssh_stub); BOX=box.invalid',
        `prune_backups() {${fn![1]!}\n}`,
        'prune_backups',
      ].join('\n');
      const env: NodeJS.ProcessEnv = { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, HOME: home, LANG: 'C' };
      if (keep !== undefined) env.CCRC_BACKUP_KEEP = keep;
      assertStubsResolve(env, bin, ['ssh', 'scp']);
      const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 15_000, env });
      return {
        code: r.status ?? -1, stderr: r.stderr ?? '',
        remote: existsSync(rec) ? readFileSync(rec, 'utf8') : null,
        poison: existsSync(poison) ? readFileSync(poison, 'utf8') : '',
      };
    };

    it.each([
      ['abc', 'abc'], ['10000', '10000'], ['-1', '-1'], ['1; touch x', '1; touch x'], ['3 ', '3 '],
      ['\u001b[31m', '?[31m'], ['9'.repeat(40), `${'9'.repeat(32)}...`],
    ])('D1: CCRC_BACKUP_KEEP=%j is refused before anything is sent: one warning, rc 1 (D-5142)', (keep, shown) => {
      const r = runPrune(keep);
      expect(r.code, r.stderr).toBe(1);
      expect(r.remote, 'the remote prune ran with an unchecked KEEP').toBeNull();
      expect(r.poison, 'a real ssh or scp was reached').toBe('');
      expect(r.stderr).toContain(`deploy: warning: CCRC_BACKUP_KEEP='${shown}' is not a whole number from 0 to 9999 — nothing pruned`);
    }, 30_000);

    it.each([
      [undefined, '10'], ['3', '3'], ['0', '0'], ['9999', '9999'],
    ])('D1b: CCRC_BACKUP_KEEP=%j reaches the remote prune as `head -n -%s`, unchanged (D-5142)', (keep, n) => {
      const r = runPrune(keep);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.poison, 'a real ssh or scp was reached').toBe('');
      expect(r.remote).toContain(`| sort | head -n -${n} | xargs -r rm -rf --`);
    }, 30_000);

    it('D1c: the KEEP test is ccd/ccrc\'s `_keep_ok`, spelled a second time on purpose and held equal here (D-5142)', () => {
      // deploy.sh runs on the operator's machine and never sources ccd/ccrc, so the test is a second spelling by
      // design. This holds the two regexes together: a widened or narrowed copy on either side is a red suite.
      // `_keep_ok` sits in a region another programme owns, so its regex is found ANYWHERE in the function's body:
      // re-wrapping the one-liner does not red this case; changing the regex on one side does.
      const ccrc = readFileSync(path.resolve(deployDir, '..', 'ccd', 'ccrc'), 'utf8');
      const ours = /\[\[ "\$keep" =~ (\S+) \]\]/.exec(deploySh);
      const body = /^_keep_ok\(\) \{([\s\S]*?)(?:; \}$|\n\})/m.exec(ccrc);
      const theirs = body ? /=~ (\S+)/.exec(body[1]!) : null;
      expect(ours, 'deploy.sh lost its KEEP test').toBeTruthy();
      expect(body, 'ccd/ccrc lost _keep_ok').toBeTruthy();
      expect(theirs, '_keep_ok no longer tests a regex').toBeTruthy();
      expect(ours![1]).toBe(theirs![1]);
      expect(ours![1]).toBe('^[0-9]{1,4}$');
    }, 30_000);

    it('D2: the sweep refuses, and restarts nothing, when `list-units claude-session@*` fails (D-5143)', () => {
      const sweep = /SWEEP_CMD='([\s\S]*?)'\n/.exec(deploySh);
      expect(sweep, 'the supervisor sweep is no longer a single quoted block').toBeTruthy();
      const home = mkTmp('ccrc-agent-deploysweep-list-');
      const bin = path.join(home, 'stubbin');
      mkdirSync(bin, { recursive: true });
      writeFileSync(path.join(bin, 'systemctl'),
        '#!/bin/sh\necho "systemctl $*" >> "$HOME/calls"\n'
        + 'case "$*" in\n'
        + '  *"list-units claude-session@* --plain --no-legend") echo "Failed to connect to bus" >&2; exit 1 ;;\n'
        + '  *"show -p KillMode"*) echo "KillMode=process"; exit 0 ;;\n'
        + 'esac\nexit 0\n', { mode: 0o755 });
      const env: NodeJS.ProcessEnv = { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, HOME: home, LANG: 'C' };
      assertStubsResolve(env, bin, ['systemctl']);
      const r = spawnSync('bash', ['-c', sweep![1]!], { encoding: 'utf8', timeout: 15_000, env });
      expect(r.status, `stderr:\n${r.stderr}`).toBe(1);
      expect(r.stderr).toContain('deploy: FAILED — systemctl --user list-units claude-session@* failed, so the supervisors to be '
        + 'checked could not be listed. REFUSING to sweep.');
      const calls = readFileSync(path.join(home, 'calls'), 'utf8').trim().split('\n');
      expect(calls, 'the sweep went on past a listing it could not read').toEqual([
        'systemctl --user list-units claude-session@* --plain --no-legend',
      ]);
    }, 30_000);
  });
  ```
  *(revised, unmeasured: `runPrune`'s poisons and `assertStubsResolve`, and D1c's body-wide extractor. The rows and their expectations are the draft's.)*
- [ ] **Step 3: Run them red** against `main`'s `deploy.sh`:
  ```bash
  cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts -t "D1|D2"
  ```
  Expected (T6-0, *prototype* on the draft's cases; the revised harness should not move it): **9 failed** | 4 passed. Every D1 row reds on `code` (the remote prune ran, rc 0), D1c on "deploy.sh lost its KEEP test", D2 on its status (the old sweep went on past the failed listing: KillMode passed on the template probe alone, `try-restart` ran, nothing was verified, exit 0). The four D1b rows are green: they pin the remote command this task must not change.
- [ ] **Step 4: The change.** One line replaced, and one hunk added *(revised: line 240 is no longer reworded)*:
  ```diff
  --- a/deploy/deploy.sh
  +++ b/deploy/deploy.sh
  @@ -242 +242 @@ prune_backups() {   # keep the newest $CCRC_BACKUP_KEEP (default 10) timestamped backups
  -  local keep="${CCRC_BACKUP_KEEP:-10}"
  +  local keep="${CCRC_BACKUP_KEEP:-10}" v; [[ "$keep" =~ ^[0-9]{1,4}$ ]] || { v="${keep:0:32}"; [ "${#keep}" -le 32 ] || v="$v..."; echo "deploy: warning: CCRC_BACKUP_KEEP='${v//[![:print:]]/?}' is not a whole number from 0 to 9999 — nothing pruned" >&2; return 1; }   # D-5142: ccd/ccrc's _keep_ok and _keep_why, spelled again (this file never sources ccd/ccrc)
  @@ -1109,4 +1109,9 @@ cd ~/ccrc/agent && npm ci && npm run build \
     # healthy box makes it look unnecessary.
  +  #
  +  # A LISTING THAT FAILS REFUSES THE SWEEP (wave 16, R10c(3); D-5143), as `ccrc update`'s sweep refuses (D-3599): the
  +  # loop below would otherwise see only the template probe, and try-restart would run over units nobody listed.
     SWEEP_CMD='export XDG_RUNTIME_DIR=/run/user/$(id -u) \
  -    && for u in $(systemctl --user list-units "claude-session@*" --plain --no-legend | awk "{print \$1}") claude-session@ccrc-deploy-preflight.service; do \
  +    && { listing=$(systemctl --user list-units "claude-session@*" --plain --no-legend) \
  +         || { echo "deploy: FAILED — systemctl --user list-units claude-session@* failed, so the supervisors to be checked could not be listed. REFUSING to sweep." >&2; exit 1; }; } \
  +    && for u in $(printf "%s\n" "$listing" | awk "{print \$1}") claude-session@ccrc-deploy-preflight.service; do \
            km=$(systemctl --user show -p KillMode "$u" 2>/dev/null); \
  ```
  - The KEEP line is ONE line replacing one line, and line 240 is untouched: lines 1 to 648 keep their positions (Global Constraints). The value is shown as `_keep_why` shows it (capped at 32 characters with `...`, a non-printable byte as `?`).
  - `SWEEP_CMD` holds no apostrophe, and the refusal message holds none either. (The KEEP line's trailing comment holds one, in `prune_backups`, outside every `SWEEP_CMD` reader.)
  - `bash -n deploy/deploy.sh`, then the line-pin `diff` of Global Constraints.
- [ ] **Step 5: Run green.**
  ```bash
  cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts      # 105 passed (92 + 13; revised, unmeasured; the draft's prototype: 104)
  cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t "every line citation is anchored"   # 13
  cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
  ```
- [ ] **Step 6: The mutation table** (the whole agent file; *prototype* on the draft's harness, re-measured on the revised one):

  | Row | Mutation | Expected red set |
  |---|---|---|
  | T6-0 | Red-first: Step 2's cases against `main`'s `deploy.sh` | D1 ×7, D1c, D2 |
  | T6-1 | `[[ "$keep" =~ … ]] \|\| {` → `true \|\| {` | D1 ×7 |
  | T6-2 | The listing back to `$(systemctl … \| awk …)` in the `for` | D2 |
  | T6-3 | The regex widened to `^[0-9]{1,5}$` | D1 (`10000`), D1c |
- [ ] **Step 7: Commit** `fix(deploy): prune_backups refuses a KEEP that is not a whole number, and the sweep refuses a listing it could not read (D-5142, D-5143)`.

### Task 7: `_ver_verdicts`' rc-1 WARN arms reached by a test (R8g, W18-e)

**Files:** NEW `server/test/ccrc-versions-warn-arms.test.ts`. No shipped edit.

- [ ] **Step 1: Re-measure.**
  ```bash
  grep -nF '  if ! _ver_verdicts "$mode" "$keep"; then' ccd/ccrc        # :22519, in _ver_gc
  grep -nF '      elif ! _ver_verdicts prune "$keep"; then' ccd/ccrc    # :22631, in cmd_versions
  grep -nF '_ver_verdicts() {' ccd/ccrc                                 # :22387
  ```
  These are below every fenced region (`_bak_gc` ends at about `:22345`), and run 360's tip changes none of `_ver_*`. The file stubs `_ver_layout`, `_ver_list`, `_ver_protect`, `_ver_sweep_leftovers`, `_box_build_fields` and `_ver_kept`, and the belt itself, so a later change to their signatures would red it: that is the harness fragility Reading 8 names.
- [ ] **Step 2: The file, whole:**
  ```ts
  // `_ver_verdicts`' rc 1 reaches its callers' WARN arms (centralised update management, wave 16, R8g). `_ver_verdicts`
  // answers 1 only when a numeric test of <keep> ERRORS, a belt over `_keep_ok`, which every caller asks first; so no
  // input from outside reaches those arms, and `ccrc-update.test.ts` pins only the belt itself. Here the belt is
  // stubbed to answer 1, and each of the three arms that read it is run and its line pinned: `_ver_gc`'s auto arm (the
  // install's and the update's prune), its prune arm (`ccrc versions --prune`), and `cmd_versions`' listing. The six
  // shadowed readers are the price of reaching arms no input can reach: a change to what one of them sets reds this file
  // without any change in behaviour, and the fix is to the shadow, not to the arm.
  //
  // SAFETY. `ccd/ccrc` is SOURCED on `sweepFixture.ts`'s fixture HOME and env (built from scratch, every tool that is not
  // a stub a recording POISON), `assertContained` runs on the spawn's final env, and every reader the arms would reach
  // first is a shell function: no service manager, no lock, no real `$HOME/ccrc` or `$HOME/ccrc-versions`. The only files
  // are the fixture's own `ccrc-versions/<name>/.ccrc-installed` records, which make the versions "complete".
  import { describe, expect } from 'vitest';
  import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { spawnSync } from 'node:child_process';
  import { itLinux } from './platformFixtures.js';
  import { BASH, CCRC_SRC, assertContained, makeBox, poisonFiles, type Box } from './sweepFixture.js';

  const NAMES = ['v0.0.3', 'v0.0.2', 'v0.0.1', 'v0.0.0'];
  const WHY = 'the stubbed belt answered 1';

  /** Every reader `_ver_gc` and `cmd_versions` consult before the arms, as a function; `_ver_verdicts` is the belt
   *  answering 1 exactly as the real one does: every verdict `kept: unmeasured`, nothing doomed, VER_WHY set. */
  const SHADOWS = [
    '_ver_layout() { VER_LAYOUT=linked; }',
    `_ver_list() { VER_NAMES=(${NAMES.join(' ')}); VER_CURRENT=${NAMES[0]}; return 0; }`,
    '_ver_protect() { declare -gA VER_PROTECT=(); return 0; }',
    '_ver_sweep_leftovers() { return 0; }',
    '_box_build_fields() { return 1; }',
    '_ver_kept() { return 0; }',
    '_ver_verdicts() {',
    '  echo "belt: $1 $2" >> "$HOME/belt-calls"',
    '  declare -gA VER_VERDICT=(); local n',
    '  for n in "${VER_NAMES[@]}"; do VER_VERDICT[$n]="kept: unmeasured"; done',
    `  VER_DOOMED=(); VER_DOOMED_WHY=(); VER_WHY=${JSON.stringify(WHY)}; return 1`,
    '}',
  ].join('\n');

  function box(): Box {
    const b = makeBox({ units: [] });
    // Three COMPLETE versions beside the pointed-at one, so `ncomp` (3) > KEEP (1) and `_ver_gc` does not return early.
    for (const n of NAMES) {
      mkdirSync(join(b.home, 'ccrc-versions', n), { recursive: true });
      writeFileSync(join(b.home, 'ccrc-versions', n, '.ccrc-installed'), 'fixture record\n');
    }
    return b;
  }

  function run(b: Box, body: string): { code: number; stdout: string; stderr: string; belt: string } {
    const env = { ...b.env, CCRC_VERSIONS_KEEP: '1' };
    assertContained({ home: b.home, env });
    const r = spawnSync(BASH, ['-c', ['. "$1"', SHADOWS, body].join('\n'), 'ccrc-under-test', CCRC_SRC],
      { env, encoding: 'utf8', timeout: 45_000 });
    const f = join(b.home, 'belt-calls');
    const belt = existsSync(f) ? readFileSync(f, 'utf8') : '';
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', belt };
  }

  describe('_ver_verdicts answering 1 reaches each caller\'s WARN arm (wave 16, R8g)', () => {
    itLinux.each([
      ['update', 'update: versions:'],
      ['install', 'install: versions:'],
    ])('VW1 the %s prune (auto): one WARN line, nothing pruned, rc 1', (pfx, lead) => {
      const b = box();
      const r = run(b, `_ver_gc ${pfx} auto; echo "rc=$?"`);
      expect(r.belt, r.stderr).toBe('belt: auto 1\n');
      expect(r.stdout.split('\n')).toEqual([`${lead} WARN: nothing pruned — ${WHY}`, 'rc=1', '']);
      expect(poisonFiles(b)).toEqual([]);
    }, 60_000);

    itLinux('VW2 the hand-run prune (`ccrc versions --prune`\'s _ver_gc): prune skipped, nothing removed, rc 1', () => {
      const b = box();
      const r = run(b, '_ver_gc versions prune; echo "rc=$?"');
      expect(r.belt, r.stderr).toBe('belt: prune 1\n');
      expect(r.stdout.split('\n')).toEqual([`versions: prune skipped — ${WHY}; nothing was removed`, 'rc=1', '']);
    }, 60_000);

    itLinux('VW3 the listing (`ccrc versions`): one WARN line, every version kept as unmeasured, rc 0', () => {
      const b = box();
      const r = run(b, 'cmd_versions; echo "rc=$?"');
      expect(r.belt, r.stderr).toBe('belt: prune 1\n');
      const out = r.stdout.split('\n');
      expect(out).toContain(`versions: WARN: ${WHY} — nothing would be pruned`);
      for (const n of NAMES) expect(out.some((l) => l.includes(` ${n}  complete  kept: unmeasured`)), `${n}: ${r.stdout}`).toBe(true);
      expect(out).toContain('rc=0');
    }, 60_000);
  });
  ```
- [ ] **Step 3: Run it.** The arms are shipped and unreached, so the file is green on `main` (4 passed, *prototype*); its red is the mutation table.
- [ ] **Step 4: The mutation table** (*prototype*):

  | Row | Mutation (in `ccd/ccrc`, restored after) | Expected red set (measured) |
  |---|---|---|
  | T7-1 | `_ver_gc`'s verdicts arm: the auto `echo` → `:` | VW1 ×2 |
  | T7-2 | the same arm's prune `echo` → `:` | VW2 |
  | T7-3 | `cmd_versions`' verdicts `echo` → `:` | VW3 |

  The protect arm directly above the verdicts arm prints the same two lines; the stubbed `_ver_protect` answers 0, so only the verdicts arm can print them, and each row mutates the verdicts arm alone.
- [ ] **Step 5: Commit** `test(update): _ver_verdicts' rc-1 WARN arms are reached and pinned (R8g)`.

### Task 8: The gate, the wait for run 360, and the PR

- [ ] **Step 1: Land second: wait for run 360, then merge `main`.** *(revised: the wait, the READY mail, the claims and the one `stat` are new)*
  - **First, Steps 2 to 5 on the tree as built** (on `origin/main` as Task 1 found it, merged forward by an ordinary merge if `main` moved and run 360 has not landed).
  - **Then, while run 360's PR has not merged:** push NOTHING. Mail the coordinator a READY, which is not a wave-done: the local tip sha, Steps 3 to 5's results against their counts, the mutation rows measured so far, and "waiting on run 360's merge". Then end the turn. The wake is the coordinator's mail saying run 360 landed. If no such mail can be named, do not end the turn: mail the coordinator and ask.
  - **On that mail:**
    ```bash
    git status --porcelain
    git fetch origin main
    ~/.local/bin/ccrc-api claims list --project ccrc-pwa
    git merge-base --is-ancestor origin/main HEAD && echo "origin/main is in HEAD" || echo "MAIN MOVED"
    ```
    - If claim 1423 has ended, claim `ccd/ccrc` and `deploy/deploy.sh` (Global Constraints' "Claims"). If it is still live, mail the coordinator and push nothing.
    - Then `git merge --no-edit origin/main`: an ordinary merge, never a rebase, a force-push or GitHub's Update branch. Keep both sides of every hunk. Record `git show --remerge-diff HEAD`.
    - **Stop and report** if `main` changed `_upd_sweep`, `_upd_sweep_stop`'s header, `_ccrc_job_pid`, `_ccrc_job_stayed_up`, `_keep_ok`, `_ver_gc`'s or `cmd_versions`' verdicts arms, `deploy/verify-service.sh`, `prune_backups` or `SWEEP_CMD`, or any line Step 1 of a task quotes.
    - After the merge, re-run, in this order: `bash -n ccd/ccrc && bash -n deploy/deploy.sh && bash -n deploy/verify-service.sh`; `ccrc-update` in parts (Step 4); `deploy-verify` whole; the window, deliberate-stop, Darwin-helper and versions files; `session-hook -t "every line citation is anchored"`; `single-definition`; the Global Constraints' line-pin `diff`s (re-derive the `deploy.sh` line number from its quoted text); and Step 5's hunk check. Then push, and send the wave-done in the same turn (Step 7).
  - *Prototype*, on the DRAFT's tree merged with `0b3ff2f62` (#384): `bash -n` green on all three; window 76, deliberate-stop 8, Darwin 8, versions 4, `single-definition` 585, `install-census` 25, `topology-clean` 55, `ccrc-update` part A 40 (518 cases in the file there), `deploy-verify` 104, `session-hook` census 13. And against run 360's tip `d671549e0`: `git merge-tree --write-tree` clean, `bash -n` green on the merged `ccd/ccrc` and `deploy.sh`. The revised plan expects window 77 and `deploy-verify` 105.
  - **The registry's mode, once, on this box only:** `stat -c '%A' "$HOME/.cc-sessions"`. Metadata only: never `ls`, open or write it. That is the single permitted touch of the live registry. No other node is measured from here; the coordinator measures any other. Report a mode without the owner's x bit before the push.
- [ ] **Step 2: Dependencies:** `npm ci` in `agent/`, `server/` and `pwa/`, wherever `node_modules` is absent.
- [ ] **Step 3: Agent, in full** (CI runs `test (agent)` in full): `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts` (105, *revised*), then `./node_modules/.bin/vitest run` (514 in 26 files expected; *prototype* on the draft: 513). `agent/tsconfig.json` does not type-check `test/`; `typecheck-tests` does.
- [ ] **Step 4: Server, one file per call,** foreground, timeout ≥ 600000 ms. Counts are *prototype* unless marked:
  - Edited or new: `ccrc-sweep-window` (**77**, *revised*; the draft's 76), `ccrc-darwin-job-helpers` (**8**), `ccrc-versions-warn-arms` (**4**).
  - Run, not edited: `ccrc-sweep-deliberate-stop` (**8**), `runbook-holds` (**23**), `macos-platform` (**102**, 11 skipped), `install-census` (**25**), `single-definition` (**571**; 585 after #384), `topology-clean` (**55**), `session-hook` (**516**; the census alone **13**), `typecheck-tests`, `dtbd`, `deviation-refs`.
  - `ccrc-update` in `-t` parts (it ran past 590 s whole). The prototype's seven, whose passed titles' union equalled `vitest list`'s 502 titles exactly:
    - A `the supervisor sweep|the health gate|the Darwin arms a Linux leg` (40)
    - B `ccrc versions|ccrc watchdog` (67)
    - C `ccrc rollback` (48)
    - D `killed-flip|is a statement about|pruned after a completed run` (86)
    - E `update.json at every phase|the projection|the automatic restore|previous, and a spine` (93)
    - F `the floor, on every path|fetch . verify|--check: what runs|older than W6|restore arm 1|provenance` (92 passed, 4 load timeouts at 20 s, re-run in isolation: 4 passed)
    - G `one update at a time|update --detach|_upd_restore_copy|migration keeps|one EXIT chain|already there|refused before anything moves|ccrc channel|tag is bound|argument surface|updateEnv|fleet-behind|codex steps|source pins|refuses --downgrade|Plan 3a Task 10|tarball name|preflight .D-3140` (83)

    After #384 the file lists 518; re-derive the parts' union against `vitest list` on the merged tree, and add a part for any title the union misses.
  - `ccrc-install` in `-t` parts by the same rule (it ran past 590 s whole). The prototype ran only the describes that reach the verify script or the stay-up gate on Linux, `the landing block|the units, and the one|a fresh box|the fleet lane|install: the build stamp` (66 passed); the gate runs the whole file in parts.
  - Then `cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"`, and `node node_modules/typescript/bin/tsc -p test/tsconfig.tests.json --noEmit` (clean, *prototype*; the agent's `test/tsconfig.tests.json` too).
  - **The sharded gate, as wave 11 runs it:** if the 1-minute load (`cat /proc/loadavg`) is under 20, also run `./node_modules/.bin/vitest run --shard=<i>/6` for `i` = 1 to 6 in sequence with `TMPDIR="$SHARD_TMP"`. The sum of their `Test Files` must equal `find server/test -name '*.test.ts' | wc -l`. Otherwise, say in the wave-done that the shards were not run, and give the load. (The prototype did not run them: load 21 to 70.)
  - A red in a known load flake is re-run IN ISOLATION before it is called a break (Global Constraints names the two seen here).
- [ ] **Step 5: The ledger, scope and line guards, last.**
  ```bash
  git fetch origin main
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts && ./node_modules/.bin/vitest run test/dtbd.test.ts && cd ..
  # the Global Constraints' scope check: prints nothing
  git diff --stat origin/main...HEAD     # exactly File structure's New and Changed lists
  diff <(git show origin/main:deploy/verify-service.sh | sed -n '1,62p') <(sed -n '1,62p' deploy/verify-service.sh)   # nothing
  diff <(git show origin/main:deploy/deploy.sh | sed -n '1,241p;243,648p') <(sed -n '1,241p;243,648p' deploy/deploy.sh)   # nothing
  bash -n ccd/ccrc; bash -n deploy/deploy.sh; bash -n deploy/verify-service.sh; echo "exit $?"
  ```
  **The fence check** *(revised, unmeasured as a command; the hunk contexts were read off the prototype by an attack lens)*. Every hunk this wave adds to the two consented files must sit in a region it owns, wherever the merge has moved the numbers:
  ```bash
  git diff -U0 origin/main...HEAD -- ccd/ccrc | grep '^@@' | sed -E 's/^@@ [^@]* @@ ([A-Za-z_]+).*/\1/' | sort -u
  # expected exactly: _ccrc_job_stayed_up, _upd_legacy_target (the hunk that starts _ccrc_job_pid's header), _upd_sweep,
  # _upd_sweep_launch (the hunk in _upd_sweep_stop's header), and _ccrc_job_pid if git names it
  git diff -U0 origin/main...HEAD -- deploy/deploy.sh | grep '^@@'
  # expected exactly two hunks: line 242 (context `prune_backups() {`) and the SWEEP_CMD block (context the
  # `cd ~/ccrc/agent && npm ci && npm run build \` line)
  ```
  A name or hunk outside those lists: read it. If it lies in a fenced region (Global Constraints), stop and report.

  Then the D-number check. Every D-token the branch adds is one of 5135 to 5148 and defined in this plan, or already on `origin/main`. The block numbers are checked for a definition BEFORE the on-main skip. It prints nothing:
  ```bash
  PLAN=docs/superpowers/plans/2026-10-15-centralised-update-w16-sweep-and-verify.md
  git diff origin/main...HEAD | grep '^+' | grep -oE '\bD-[0-9]+\b' | sort -u > "$SCRATCH/dnums"
  while read -r d; do
    case "${d#D-}" in
      513[5-9]|514[0-8]) grep -qE "^- \*\*$d\*\* — " "$PLAN" || echo "UNDEFINED $d"; continue ;;
      5149|515[0-4])     echo "BLOCK NUMBER PAST THE RESERVE: $d"; continue ;;
    esac
    git grep -qwF -e "$d" origin/main -- docs/superpowers && continue
    echo "OUTSIDE THE BLOCK OR THE RESERVE: $d"
  done < "$SCRATCH/dnums"
  ```
- [ ] **Step 6: The PR,** from the workspace branch. **This repository is public**: no hostname, account or lane name, absolute or home path, mount path, tailnet name or address, docserver URL, private repo, or ticket ID anywhere in the title, body, commits or branch name. Check the text before posting.
  - **Its first paragraph says:** the merge goes live by auto, fleet box first, and the coordinator watches the first move; the move INTO this wave runs the OLD sweep with this wave's verify script, which Task 4 makes safe and the deliberate-stop file and the hand pairing measure; the sweep's own changes (Tasks 1, 2) first run on the move after; a rollback pairs this sweep with an older script, which holds because its changes are stderr lines and one fewer verify call; the wave landed after run 360's PR, by an ordinary merge.
  - **The body:** one section per task, carrying D-5135 to D-5143 by number; the operator's Reading 9 ruling (2026-10-15) for D-5136; Review Focus 1's table; the mutation tables' measured results; the T6-INT-W closure and its measurement; the not-in-this-wave list.
  - **Links:** the plan and the files are GitHub `blob/main` URLs built from the repository's own remote (`git remote get-url origin`), with the PR's `/files` view beside each until the merge. Never a docserver URL.
  - Every commit's author and committer are the noreply identity: `git log --format='%an <%ae> | %cn <%ce>' origin/main..HEAD`.
  - The body is hand-written and ends with the attribution line the session's instructions give.
  - **The CI selection, read without waiting** *(revised)*. The selector's rule 1 selects every new or modified test file, so the new files are always selected. If the PR's `select tests` summary is already published when the wave-done is written, check that it lists `ccrc-update.test.ts`, `single-definition.test.ts`, `ccrc-sweep-deliberate-stop.test.ts` and the other files that read `ccd/ccrc` and `deploy/verify-service.sh`; otherwise say in the wave-done that the coordinator reads it. Only if such a reader is missing, run `gh workflow run ci.yml --ref <branch> -f mode=full` and name that run. Never wait on CI before the wave-done.
- [ ] **Step 7: The wave-done, in the same turn as the push.** It carries:
  - the tip sha, the PR number, the remerge-diff result, and run 360's merge commit that this wave landed after;
  - the claim state on every path at each edit and at the push: the claim acquired before the first edit, and `ccd/ccrc` and `deploy/deploy.sh` claimed after claim 1423 ended;
  - each suite's result against Step 4's counts, the `-t` parts with their union check, the shards or why not, and the load;
  - each task's red-first counts and every mutation row (T1-0 to T7-3), with its measured red set against the listed set and the assertion that fired; *prototype* rows re-measured through the real files, and every *revised, unmeasured* row measured for the first time;
  - the hand pairing of Task 4 Step 6 (the old sweep with the new script);
  - this box's `~/.cc-sessions` mode (Step 1);
  - the fence check's output (Step 5);
  - a request that the coordinator tell claim 1423's holder and wave 17's brief that `agent/test/deploy-verify.test.ts` D1c pins `_keep_ok`'s regex;
  - any reserve number spent, defined in this plan in the commit that cites it;
  - anything the work found that bears on a reading below.

## Readings (for the coordinator to rule; each was chosen where no ruling decided it)

1. **A unit ABSENT from the pre-restart listing that reads active after the restart is still verified** (D-5136) *(revised: the draft's Reading 1 was about a unit `activating` before and active after; an attack lens measured that verifying it made the ruling's "does not fail the update" a race, and the ruling's own sentence, "only units active before the restart are verified", now decides it: such a unit is named, never verified, W24c)*. What is left is the unit the pre-restart listing did not show at all: a session started during the sweep, which runs the new ccd. Options:
   - (a) **keep the shipped verify** (this plan): the ruling's subject is a unit crash-looping BEFORE the update, and this one was not running then; it runs the ccd the sweep must hold to the bar.
   - (b) verify only units in `before`, as the ruling's sentence reads literally. That stops verifying a supervisor that runs the new ccd and widens what the success line claims unverified.

   Recommendation: (a). If (b), it takes reserve number 5144, one more case in W24, and a line for such a unit.
2. **Two sentences that are slightly untrue for an `activating`-before unit.**
   - Item 3's line, for one that reads `failed` after, says "try-restart skipped it", and systemd's try-restart restarts an activating unit (W24b).
   - The zero line, on a box with nothing active before, says "try-restart had nothing running to restart" although it restarted that unit (W24f). It is byte-identical by constraint (`runbook-holds`), and Task 2's line, printed just above it, names the unit.

   Options: (a) **leave both** (this plan): the remedy item 3 gives is right, and each unit is still named once, never verified; (b) word item 3's line by the pre-restart word ("was already 'activating' before try-restart and is FAILED after it …"), a third sentence and a lookup into `prior` from the failed loop. The zero line changes only with `runbook-holds`' holder. Recommendation: (a); (b) for item 3 is cheap if the coordinator wants every word true, and takes reserve number 5144 (or 5145 after Reading 1(b)).
3. **Which pre-restart words are "already down"** (D-5136). This plan names `activating` and `failed`, the ruling's "crash-looping". It does not name `inactive` (a unit list-units shows only while it has a job), `deactivating` (a stop in progress, which try-restart does not restart), `reloading` or `maintenance`. Recommendation: as drafted; widen only if a measured fleet listing shows another word on a down session.
4. **The `-x` refusal's placement** (D-5137): after the settle (this plan, pinned by V31's call log, row T4-5), or beside `[ -d "$reg" ]` as the ledger sketched. Beside `-d` would refuse before the `is-active` re-read, but would print its cause for a unit the classifier was never asked about (one still `deactivating` at the bound). Recommendation: after the settle.
5. **The re-read's wait** (D-5138): reuse `STOP_INTERVAL` (this plan; 1 s by default, 0 in every harness), or a new `CCRC_VERIFY_PURGE_REREAD` with its own default pin. Recommendation: reuse. A new knob adds a V22-style pin and an entry in every harness for the same kind of wait.
6. **A frozen copy of the pre-wave-16 script.** `ccrc-sweep-deliberate-stop.test.ts` runs the FROZEN v0.0.84 sweep with the tree's script; the immediately-previous sweep (today's `main`) with the new script was measured once by hand (65 of 65 on the draft's script, Task 4 Step 6). Options:
   - (a) **leave it measured once** (this plan), and recorded in the wave-done;
   - (b) freeze `git show origin/main:deploy/verify-service.sh` as `server/test/fixtures/verify-service-pre-wave16.sh`, pinned by digest like S0 and S10, and run this wave's sweep against it (the rollback direction) plus a small differential against the new script.

   Recommendation: (a). (b) is test-only and cheap, if the coordinator wants the rollback pairing permanent; it would add one fixture and one describe, and no D-number.
7. **KEEP=0** (D-5142). `head -n -0` prints every name, so `CCRC_BACKUP_KEEP=0` removes every timestamped backup, including the one the deploy just took. That is the value's documented meaning ("keep the newest N"), and the consent limits this wave to validation. Options: (a) **leave it** (this plan), as `ccrc`'s own `_keep_ok` allows 0; (b) refuse 0 in `deploy.sh` alone, which breaks D1c's equality and needs the consent's holder. Recommendation: (a); if the operator wants a floor, it belongs to wave 17's backup-prune work, beside `_bak_prune`, for both spellings at once.
8. **The versions-arm file stubs six readers** (Task 7). A later change to `_ver_layout`, `_ver_list`, `_ver_protect`, `_ver_sweep_leftovers`, `_box_build_fields` or `_ver_kept` that moves what the arms see would red VW1 to VW3 without a behaviour change. That is the price of reaching arms no input can reach. Recommendation: accept; the file's header says so.
9. **The Darwin helper cases give the macOS leg nothing** (Task 5) *(revised)*. J1 to J5 need only bash and the shadowed `_svc_*` functions, so they could be plain `it` and run on a Mac; J6 reads `/proc` and stays `itLinux`. But `sweepFixture.ts` has never run on the macOS leg, that leg runs only on the daily, dispatched and stable-gate full runs (never on a PR), and it is advisory and flaky by ruling. Options: (a) **keep the file `itLinux`** (this plan), and say so in the Risk notes; (b) make J1 to J5 plain `it`, prove `sweepFixture.ts` on a Mac with a dispatched full run, and keep J6 `itLinux` behind a `PLATFORM-ONLY:` marker. Recommendation: (a) here; (b) belongs to wave 18's test-containment work if the coordinator wants Mac evidence for D-5139 to D-5141.
## Coordinator rulings on this plan's readings (2026-10-16)

- **Reading 1:** (a). A unit absent from the pre-restart listing and active after it stays verified.
- **Reading 2:** (a). Item 3's wording and the zero line stay as they are.
- **Readings 3, 4, 5, 7 and 8:** as recommended. Only `activating` and `failed` count as already down; the `-x`
  refusal sits after the settle; the re-read reuses `STOP_INTERVAL`; `KEEP=0` keeps none (a floor, if wanted, is wave
  17's, for both spellings at once); the six shadowed readers are accepted.
- **Reading 6: (b), against the recommendation.** Freeze `git show <dispatch base>:deploy/verify-service.sh` as
  `server/test/fixtures/verify-service-pre-wave16.sh`, pinned by digest as S0 and S10 are. Run this wave's sweep
  against it (the rollback direction), plus a small differential against the new script. Why: the update watchdog
  can roll a box back unattended, and a rollback pairs the newer sweep with the older script, so that pairing
  deserves a permanent pin, not one measurement by hand. It is test-only, and it uses no D-number.
- **Reading 9:** (a). The Darwin helper file stays `itLinux`. Widening it is wave 18's, with a dispatched full run.
- **The base moved.** This plan was drafted at `518789ad0`. `main` is now `0b3ff2f62`: #384 changed `ccd/ccrc` in four
  line-neutral or near-neutral hunks (about :2104 to :2232, `_inst_floor`, `_upd_backup_copy`, `_upd_restore_arm2`,
  and one added line in `_upd_report` at about :21491), plus `server/test/ccrc-update.test.ts` (+102) and
  `server/test/single-definition.test.ts` (+264). No hunk is in `_upd_sweep`'s region. Re-measure every anchor by
  its quoted text at the dispatch base, and every count, before Task 1.
- **Unmeasured rows.** The reviser marked every revised row and count unmeasured (the box was at load 174). The worker
  measures each one first and records the measured value in its ledger.
- **Fences.** The delegation programme's consent (mail 5255) is quoted in the Global Constraints. Its claim is now
  1472, on the same paths plus `deploy/coordination-snapshot.mjs`, `ccd/ccrc-doctor-checks` and the two test files.
  The fences are unchanged. Task 8's wait for run 360 stands.

## What the worker measured (run 484, 2026-10-16)

Built on `origin/main` at `0b3ff2f62`. Every anchor quoted in Tasks 1 to 7 measured at its stated line, except `_keep_ok`
(`:22056`) and the `_ver_*` anchors (one line lower). Every *(revised, unmeasured)* row and count is measured below.

- **Counts at the tip:**

  | File | Plan | Measured |
  |---|---|---|
  | `ccrc-sweep-window` | 77 | 77 after Task 2; **89** with the S15 describe (P0 to P7, Reading 6 (b)) |
  | `deploy-verify` | 92, then 105 | 92, then 105 |
  | `ccrc-darwin-job-helpers` | 8 | 8 |
  | `ccrc-versions-warn-arms` | 4 | 4 |
  | agent, whole | 514 in 26 files | 514 in 26 files |
  | `ccrc-update` | 518 listed after #384 | 506 titles listed; seven `-t` parts (the plan's), passed-title union 506, 0 failed |
  | `ccrc-install` | in parts | 299 titles; four parts, union 299, 0 failed |
- **Red-first:** T1-0 2 failed of 4; T2-0 6 failed of 10; T4-0 5 failed of 7; T5-0 6 failed of 8; T6-0 9 failed of 13. Each red set
  is the plan's.
- **Mutation rows:** every row, T1-0 to T7-3, was measured through the real files and restored with `cp` + `cmp`. Each red set is
  the listed one except three, whose measured sets are these:
  - **T4-6** (delete `STOP_WHY=""`) reds 6, not V31c alone: under `set -u`, `fail`'s `[ -z "$STOP_WHY" ]` aborts on every
    failure path. The precise inheritance mutation, `STOP_WHY="${STOP_WHY:-}"`, reds exactly V31c.
  - **T6-1** reds D1 ×7 and D1c: the mutation also removes the regex text D1c extracts.
  - **V32**'s first red against `main`'s script fires on `code`, before `sleeps`; same cause.
- **Reading 6 (b):** `server/test/fixtures/verify-service-pre-wave16.sh` is `git show 0b3ff2f62:deploy/verify-service.sh`, byte
  for byte (218 lines, sha256 `efcfa3be9797212995ad6d206b997a5d6b00fa82853ba4f8a5b2775f0b6062dc`), exported as
  `FROZEN_VERIFY_S15`. Rows R6-1 (a byte appended: all 12 P cases red), R6-2 (S15 pointed at S10: all 12 red) and R6-3 (the
  tree's purged arm skips `LoadState`: P7's purged-stop row alone red). P7 compares per-unit call order, because concurrent
  verifies interleave across units. The scope check's `server/test/fixtures` entry is superseded by that ruling.
- **The hand pairing** (Task 4 Step 6: `main`'s sweep and window file with the new script): 65 of 65.
- **Task 3:** T3-1 left the window file green, 89 of 89 in 2 of 2 runs. T3-INT stayed green, 12 of 12 in 3 of 3 runs.
- **This box's `~/.cc-sessions`:** `drwxrwxr-x`, measured by one `stat`.
- **Shards:** tried at load 18. Shard 1 of 6 passed the 590 s bound (`timeout(1)`) before its summary, so the shards were not run.
- **One gap the wave leaves, for the coordinator:** when the update DIES (a unit active before fails its verify and its re-check),
  `_upd_sweep_die` exits before Task 2's naming loop, so a `prior` unit gets no line on that path. Item G's lines share the
  property. The die line names the unit that failed the update. Review Focus 1's table describes the success paths.
- **Fix round 1 (review 512, the coordinator's rulings on F3 and F4):**
  - **F3:** the two D-5136 warnings now end "(a supervisor already 'activating' or 'failed' before the restart is never
    verified; …)". The old "(only a supervisor that was active before the restart is verified; …)" was wrong, because Reading 1
    (a) still verifies a unit that was absent from the pre-restart listing or shown in any other state. The comment above the
    `units` builder says the same thing, in the same two lines, so `ccd/ccrc` keeps every line where it was. W24's `TAIL`, P5
    and W24c's comment follow.
  - **F3, measured:** putting the old wording back in the `back)` arm reds P5 and W24c. Putting it back in the `*)` arm reds
    W24a ×3 and W24f.
  - **F4:** J6's kill and reap now run in a `finally`, and the header says so.
  - **F4, measured:** with the marker assertion forced to fail (the settle row waits for a marker that never appears), the old
    J6 left its bash child and that child's `sleep 8` running, and the new J6 leaves nothing.
