# Centralised update management, wave 15: `--no-reload` for `_svc_enable`, so a supervisor restart stops reloading the user manager: Implementation Plan

The coordinator scoped wave 15 on 2026-10-06 (programme ledger: row 15 of the waves table, "`--no-reload` for `_svc_enable`, alone", fleet-first; it carries ruling F3 of the 2026-10-05 13:58 "Re-check once" entry). Run 300 opened at 16:07 UTC with deviation block 4286 to 4295. A workflow drafted this plan on 2026-10-06 (a scout, then a prototyping drafter), from `main` at `8b0547b48c89ac5bb72ddbcf7580a4ddf097aa46` (#295, wave 13, merged 16:03 UTC). Every row marked *(prototype)* was run through the real files with vitest at that commit, on a loaded Linux box (load 17 to 37 on 16 cores), and restored with `cp` + `cmp`. The same workflow then revised the plan at about 17:00 UTC against an attack with two lenses (systemd, pins). The revision re-measured the live claims, the line citations into the two edited test files, the install spine's `systemctl` calls and `cmd_restamp`'s body. It changed no shipped code. The only test-code change since the prototype is the wording of one comment in the new describe (pins F6). The prototype did not run that wording, but it is a comment, so no count moves. Its file is `docs/superpowers/plans/2026-10-06-centralised-update-w15-svc-enable-no-reload.md`.

**The dispatch waits on three claims (the coordinator's ruling on Reading 7, 2026-10-06 19:58 UTC).** This wave edits three files that other programmes hold: `ccd/ccd` (claim 1057, child-reclamation wave 6, run 291), `ccd/ccrc` (claim 1055, ccrc-history wave 2, run 302) and `server/test/macos-platform.test.ts` (claim 1058, run 291). The coordinator dispatches the wave only once all three have ended. The worker re-reads the live claims at Task 1 Step 1 and stops if any of the three is live.

**Wave 15 changes one shipped line, in two files.** `_svc_enable`'s Linux arm becomes `systemctl --user enable --no-reload "$1"`. The same line changes in `ccd/ccrc`, because the platform block is byte-identical in both files and a test holds that (D-4286). The edit is line-neutral, so no `ccd/ccd:<n>` or `ccd/ccrc:<n>` citation moves. Everything else is test code.

One line per task:
- **Task 1.** `_svc_enable` gains `--no-reload` in `ccd/ccd` and in its platform twin in `ccd/ccrc` (D-4286). `ccd/ccd` is restamped. The two exact-argv pins in `ccd-supervised-start.test.ts` and the Linux-arm set in `macos-platform.test.ts` are rewritten. The wave adds two name-bound arm rows and a three-case describe that models systemctl's reload rule for the verbs ccd issues: the self-heal and the alive start ask for no reload, and `enable --now` keeps its one.
- **Task 2.** The gate and the PR.

**Live effect: `ccd/ccd` reaches every rostered home through the install spine on the first release after the merge (about 30 to 50 min).** `_inst_bins` (through `_inst_ccd_pair`) places the body at `~/.local/libexec/ccrc/ccd` behind the rendered launcher. `_svc_enable` then runs on every supervisor start fleet-wide, so treat this as live code.
- `cmd_supervise` runs it once on entry (`ccd/ccd:22197`). The sweep in `ccrc update` runs `try-restart "claude-session@*"`, which restarts every supervisor, so each unit runs it once per sweep. That is the storm: 71 reloads over about 27 s at 71 units (the wave-11 plan's F3 measurement, 24 sweeps). The attack reproduced it in a throwaway systemd 255 container. `try-restart 'sv@*'` over 6 supervisors whose `ExecStart` runs the self-heal enable logged 6 reloads attributed to the units with a plain `enable`, and 0 with `--no-reload`. All 6 units came back active.
- `cmd_start`'s already-alive branch runs it for a live pane its supervisor is already watching (`ccd/ccd:21810`). `cmd_enable` reaches that branch as an alias, and so do the PWA's `enable` route and `server/src/ccdargv.ts`.
- **A wrong argv breaks boot persistence silently.** `_svc_enable` discards stderr, and both callers only print `ccd: warn: could not enable boot-persistence for <id>`. The pane keeps running, but no `default.target.wants` link is made. For that reason the exact-argv pins and the name-bound arm row are the merge gate.
- **The release that ships this change already benefits from it.** Before `_upd_sweep` runs, the spine places the new body (`_inst_bins`), installs the units (`_inst_units`) and reloads in `_inst_enable`. That reload is one explicit `daemon-reload` at `ccd/ccrc:15247`, plus one implicit reload for every `enable --now` that follows it (the role unit, `ccd-cap-scopes.timer`, and up to eight `_inst_enable_timer` calls on a fleet role). So every supervisor the sweep restarts runs the new `cmd_supervise` against loaded units.
- Fleet-first ordering holds and costs nothing, because the server is unchanged.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:**
- a restarted supervisor links its own unit for boot persistence without reloading the user manager, so a sweep of N units queues no reload per unit;
- `cmd_start` on a live, watched row does the same;
- `enable --now` (`_svc_enable_now`), `disable --now` and the Darwin arm are unchanged;
- the platform block stays byte-identical in `ccd/ccd` and `ccd/ccrc`;
- `ccd/ccd`'s marker verifies as `ccrc-unmodified`.

**Architecture:**
- No ring changes. Shipped code changes on one line in each of `ccd/ccd` (`:882`) and `ccd/ccrc` (`:911`), plus `ccd/ccd`'s marker on line 2. `server/src`, `agent/src`, `pwa/`, `shared/`, the units, the spine and the sweep are untouched.
- **Tests:** `server/test/ccd-supervised-start.test.ts` and `server/test/macos-platform.test.ts`.
- **Prose:** this plan.

**Tech Stack:**
- bash (`ccd/ccd`, `ccd/ccrc`).
- systemd's `systemctl(1)`. On `--no-reload`, the systemd 255 man page on the drafting box says: "When used with enable and disable, do not implicitly reload daemon configuration after executing the changes."
- `shared/mark.mjs` for the stamp; vitest 4.1 in `server/`; node `>=22.13.0`; no new dependency.

**Measured by the attack on a real user manager.** This was a throwaway `ubuntu:24.04` container with systemd 255.4, run privileged with `--cgroupns=private --rm` and tmpfs mounts, as a lingering test user. It was removed afterwards. It touched no fleet unit.
- (a) `enable` and `enable --no-reload` create byte-identical wants links.
- (b) The flag's position is free: `systemctl --user --no-reload enable <unit>` exits 0.
- (c) A plain `enable` reloads even when the link already exists, so the self-heal reloaded on every restart.
- (d) Consider a unit file changed on disk, then `enable --no-reload`, then `try-restart`. The restart keeps the OLD `ExecStart` and prints a "changed on disk" warning, and only a `daemon-reload` makes it run the new one. That is the hazard Review Focus 2 argues no ccd path reaches.
- (e) The state a NEW link leaves behind is covered in Review Focus 3.

This plan did not re-run the container. Its recipe is a read-only, throwaway method that a reviewer may repeat with `docker run --rm` (the Docker hygiene rule applies).

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md`. No section changes. The input is ruling F3 and the waves table on the coordination branch (`docs/superpowers/programs/centralised-update-management.md`).

**Producers:**
- `main` at `8b0547b4` (#295, wave 13).
- The wave-11 plan's attack F3 (`docs/superpowers/plans/2026-10-05-centralised-update-w11-sweep-window.md`, around line 314) and the 13:58 ruling.
- This plan's scout, read-only at `8b0547b4`.
- This plan's prototype, measured at `8b0547b4` in an isolated worktree.
- The attack (systemd and pins lenses) and this revision.

**D-refs this plan cites as they stand:** none. The wave's only number is D-4286.

## Not in this wave

Reviewers: do not raise these.

- **Any other `ccd/ccd` change** (the ruling's "alone"). That includes the comments that describe the reload or the call:
  - `ccd/ccd:22192-22195` ("`enable` without `--now` asks systemd for nothing else"), which this wave makes true rather than false;
  - line 881's trailing comment (Reading 5);
  - the platform-block comment at `ccd/ccd:866` / `ccd/ccrc:895` ("which is why `_svc_enable` below is the same call minus the start"). After this wave the Linux `_svc_enable` also drops the reload, so the sentence is no longer exact. It sits inside the byte-identical region, so a later fix needs the same line-neutral edit in both files (Reading 5).
- **`_svc_enable_now` and `_svc_disable_now`.** They keep their implicit reload. Every one of their callers starts or stops a unit, and the ruling names `_svc_enable` only. The callers are `_ws_supervise` (from ws-add and ws-restore), `_supervised_start` (from start, ensure and the swap tail), `_resupervise_live` and the stop paths.
- **The Darwin arm** (`ccd/ccd:883-885`, `ccd/ccrc:912-914`). launchd has no reload to skip.
- **A daemon-reload anywhere else** (the sweep, the spine, a caller). The spine already reloads before the sweep, and nothing on `_svc_enable`'s two paths writes a unit file (Reading 2).
- **The stale prose** that says `_svc_enable` reloads, or that cites its caller wrongly. It is residue (Reading 4), and the ruling's "alone" is the reason it stays:
  - `deploy/deploy.sh:771`, which claim 1055 holds at revision (claim 1052 held it at drafting);
  - `agent/test/deploy-verify.test.ts:907`, which claim 1056 holds at revision;
  - `docs/superpowers/plans/2026-09-07-telemetry-keepalive.md:1701`;
  - the wave-11 plan's anchors `:21947` / "called by `cmd_ensure`" (lines 154 and 314).
- **Measuring the reload count on a real fleet user manager.** That is an operator-side, read-only journal check after the release (Reading 3). No test in this tree can reach a real manager, by design. The attack's throwaway container answered the semantic questions (Tech Stack).
- **Everything under the live claims** (Global Constraints), and every other residue item in the 07:07 map (waves 14, 16 to 19).

## Global Constraints

- **Anchors.**
  - Every anchor is measured at `8b0547b4` and quoted.
  - Step 1 of each task re-measures its anchors by their QUOTED TEXT (`grep -nF`) on the tip being built. Do this after `git fetch origin main`, and after a merge if `main` moved. The quote wins over any line number.
  - Find code with graphify first (`graphify query "…"` over `graphify-out/`), then confirm with `grep -nF`.
- **Scope.**
  - Change the files in File structure, and nothing else. `ccd/ccd` changes on line 2 (the marker) and line 882 only. `ccd/ccrc` changes on line 911 only.
  - **Never write** `docs/superpowers/specs/*`, the programme ledger (`docs/superpowers/programs/*`), `README.md`, `CLAUDE.md`, or any claimed path.
  - Re-read the live claims before the first edit, before Task 1 Step 4, and again before the push: `~/.local/bin/ccrc-api claims list --project ccrc-pwa`.
    - Claims at revision (17:00 UTC): live claims were 1048, 1049, 1053, 1055 and 1056. Claims 1051 and 1052 had ended.
    - **Claim 1055 (run 302, ccrc-history wave 2) names `ccd/ccrc`, a File-structure path.** While any live claim names `ccd/ccrc`, Task 1 Step 4 does not run. Mail the coordinator and wait for the claim to end or for the ruling on Reading 7.
    - No live claim named `ccd/ccd`, `server/test/ccd-supervised-start.test.ts` or `server/test/macos-platform.test.ts`. If one ever does, stop and mail the coordinator.
    - Claim 1056 holds `single-definition.test.ts`, `install-census.test.ts` and `ccrc-install.test.ts`. This plan only RUNS those files.
  - **The scope check.** The first command lists every path the five live claims held at revision, plus the paths claims 1051 and 1052 held at drafting (ended since, kept on purpose), plus the never-write paths. It must print nothing:

        git diff --stat origin/main...HEAD -- \
          server/src/childReclaimSweep.ts server/src/coord/store.ts server/src/coord/childReclaim.ts server/src/watch.ts \
          server/src/server.ts server/src/coord/close.ts server/src/coord/routes.ts \
          pwa/src/fleet/runWords.ts pwa/src/screens/RunsScreen.tsx pwa/src/fleet/SessionLine.tsx \
          pwa/src/fleet/childReclaimWords.ts pwa/src/fleet/ChildReclaimBanner.tsx pwa/src/fleet/AbandonSheet.tsx \
          pwa/src/fleet/fleet.css pwa/design/audit.mjs server/test/sourceScan.ts shared/api.ts \
          docs/superpowers/plans/2026-09-22-child-reclamation-wave4-sweep-and-switch.md \
          docs/superpowers/plans/2026-09-22-child-reclamation-wave5-run-chip.md \
          server/test/reconstruction-drill.test.ts pwa/test/runs-screen.test.tsx pwa/test/abandon-sheet.test.tsx \
          'server/test/child-reclaim-*.test.ts' server/test/child-reclaim.test.ts server/test/coord-store.test.ts \
          pwa/test/session-line.test.tsx pwa/test/fleet-css.test.ts pwa/test/contrast.test.ts \
          pwa/test/child-reclaim-banner.test.tsx server/test/session-hook.test.ts \
          server/test/delegation-rig server/test/fixtures/delegation server/test/delegation-rig.test.ts \
          deploy/delegation-census.mjs server/test/delegation-census.test.ts \
          docs/superpowers/plans/2026-10-05-delegation-broker-wave1-measurement.md \
          ccd/history ccd/ccd-history-sweep deploy/systemd/ccd-history-sweep.service deploy/systemd/ccd-history-sweep.timer \
          ccd/ccrc-doctor-checks install.sh CLAUDE.md README.md .github deploy/deploy.sh ccd/session-hook.sh \
          deploy/gen-wrappers.mjs deploy/measure-history.py shared/lifecycle.ts \
          server/test/history-lib.test.ts server/test/history-store.test.ts server/test/history-sweep.test.ts \
          server/test/history-drain.test.ts server/test/history-ingest.test.ts \
          server/test/history-holds.test.ts server/test/history-op.test.ts server/test/history-cli.test.ts \
          server/test/measure-history.test.ts server/test/historyHelpers.ts server/test/historyFixtures.ts \
          server/test/fixtures/history server/test/single-definition.test.ts server/test/license.test.ts \
          server/test/lifecycle.test.ts server/test/ccrc-cli.test.ts server/test/ccrc-install.test.ts \
          server/test/installTreeFixture.ts server/test/ccrc-uninstall.test.ts server/test/install-census.test.ts \
          server/test/ccrc-doctor.test.ts server/test/ci-pipeline.test.ts agent/test/deploy-verify.test.ts \
          docs/superpowers/plans/2026-10-05-ccrc-history-w1-capture.md \
          server/package.json agent/package.json pwa/package.json server/package-lock.json server/test/node-floor.test.ts \
          CONTRIBUTING.md deploy/backup-coord.mjs \
          docs/superpowers/specs docs/superpowers/programs

    `ccd/ccrc` is checked apart from that list, because it is both claimed (1055, at revision) and in File structure. The command below must print exactly `1 1 ccd/ccrc`, and that answer is allowed only when `claims list` shows no live claim naming `ccd/ccrc`:

        git diff --numstat origin/main...HEAD -- ccd/ccrc

    Before the push, add any path a NEW live claim names to the first command.
  - `git diff --stat origin/main...HEAD` lists exactly File structure's files.
- **Fixture HOMEs only.**
  - Every case that runs `ccd/ccd` runs under `makeCcdHarness` (`server/test/ccdWsHelpers.ts`). Its `systemctl` and `tmux` are shell functions or PATH stubs that record argv into `$HOME/ccd-calls`, so nothing reaches a real user manager.
  - **Never run `systemctl --user` against a real unit**, in a test or by hand. The only `systemctl` this plan runs for real is `systemctl --version` (Task 1 Step 1). It is a read and touches no unit.
  - Never run `ccd` against the live `$HOME`. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or a `claude-session@*` unit. Never run `ccrc update`, `rollback`, `rollout`, `install` or `deploy.sh`.
  - Never read `~/.cc-secrets` or `~/.ccrc/mail.token`.
- **The stamp.**
  - `ccd/ccd` is generated, and line 2 is `# ccrc:generated 1 sha256=<digest of the body>`.
  - Restamp it by recomputing, with `ccd/ccrc restamp ccd/ccd` from the checkout root (`cmd_restamp`, `ccd/ccrc:23701`). Running the verb reads `ccd/ccrc` and writes only `ccd/ccd`. If a harness refuses the verb, use Task 1 Step 5's node fallback, which is the same `markGenerated` path. Never copy a stamp from this plan, a PR or another branch.
  - Restamp AFTER the last `ccd/ccd` edit. Restamp again after any merge or rebase that touches `ccd/ccd` (#299, #301 and #303 all do; Risk notes).
  - The gate is `server/test/ownership.test.ts` ("verifies as ccrc-unmodified").
  - `node shared/mark.mjs --check ccd/ccd` exits 0 only on `ccrc-unmodified`, so it is a quick check. `mark-check.test.ts` tests that tool, not the committed file (T1-5).
- **Line neutrality.**
  - The two shipped edits replace a line with a line. `wc -l ccd/ccd ccd/ccrc` must print 29868 and 23805 at `8b0547b4`, both before and after the edit. After a merge it must print `origin/main`'s pair, both before and after.
  - Any rationale goes in this plan or in test comments, never as a new line in `ccd/ccd` or `ccd/ccrc`. A new line there would move the compaction-card citation corpus in `server/test/session-hook.test.ts`, which claim 1049 holds and this wave may not write.
- **Mutation-table discipline.**
  - Before each mutation, `cp ccd/ccd "$SCRATCH/ccd.good"; cp ccd/ccrc "$SCRATCH/ccrc.good"`. Never use `git checkout --`, and never a bare `git stash`.
  - Apply the mutation and check that it parses: `bash -n ccd/ccd && bash -n ccd/ccrc`.
  - Run the named commands. Restore with `cp` and check with `cmp`. Then `git status --porcelain` must show only this wave's files, and `node shared/mark.mjs --check ccd/ccd` must print `ccrc-unmodified`.
  - A row is done only with a measured red count and the assertion that fired. Each row lists its full expected red set. If the measured set differs, report it; never accept it silently.
  - The mutants are not restamped, except where a row says so. So `ownership.test.ts` is red under every `ccd/ccd` mutant, and that red is not part of a row's set unless the row names it.
  - Mutation rows that write `ccd/ccrc` (T1-1, T1-2, T1-3, T1-4) run only when no live claim names `ccd/ccrc`.
- **D-numbers.**
  - This plan defines D-4286, from the block issued to run 300 (4286 to 4295), in `## Deviations found`.
  - **The worker's reserve is numbers 4287 to 4291.** Take them in order. Define each one in this plan's `## Deviations found`, in the commit that first cites it. Write any unspent number bare.
  - Never write a number outside the block. Never call the allocator. Never land a `D-TBD-` spelling.
- **Suites.**
  - Run each file in the foreground, one command per call, inside `server/`: `./node_modules/.bin/vitest run test/<file>.test.ts [-t "<pattern>"]`. Use a timeout of at least 600000 ms and keep each run under 600 s of wall time. Never bare `npx vitest`. Never split by `file:line`.
  - Run `npm ci` in `server/`, and in `agent/` and `pwa/` for `typecheck-tests`, wherever `node_modules` is absent.
  - `TMPDIR` and all scratch go under the session's scratchpad (`$SCRATCH/tmp`; `mkdir -p` it), never on the work volume.
  - The box is loaded. Prefer `-t` filters while iterating, and run each whole file at the end of each task.
  - `session-hook` and `typecheck-tests` are on CLAUDE.md's load-flake list. Re-run one IN ISOLATION before calling a red a break.
- **No residue in tracked text:** no hostname, username, absolute home path, mount path, docserver URL or org name. Run `topology-clean.test.ts` after the `git add` of each new or changed file.
- **Commits.**
  - Commit on the workspace branch only: `fix(ccd): …` for Task 1, `docs(update): …` for the plan. Never a separate feature branch.
  - Author and committer are the noreply identity.
  - Send the wave-done in the same turn as the push. Never end a turn to wait on CI.

## Review Focus

1. **The argv is right, exactly once, and only on `_svc_enable`.** This is live on every supervisor start fleet-wide.
   - `_svc_enable`'s Linux arm is `systemctl --user enable --no-reload "$1" 2>/dev/null; return $?`.
     - The flag goes after the verb. systemctl accepts it in either position (the attack measured `--user --no-reload enable` exiting 0).
     - The order is chosen so that two kinds of reader still match: the `case "$2" in enable)` stub in `ccd-supervised-start.test.ts`, and every reader that keys on the verb's position.
   - `_svc_enable_now` is still `systemctl --user enable --now "$1"`, with no `--no-reload`. T1-3 reds 8 + 2 + 2 when the flag leaks onto it.
   - The Darwin arms of both functions are byte-unchanged: `git diff` shows one changed line per file outside the marker.
   - Three pins hold it: the two exact pins in `ccd-supervised-start` (`toEqual`, so no extra call and no other spelling passes) and the name-bound `_svc_enable` row in `macos-platform`.
2. **No caller needs the reload it loses.** Read the two callers against the shipped tree and confirm:
   - `cmd_supervise` (`ccd/ccd:22132`, with the call at `:22197`) is the unit's own `ExecStart`, so the instance is loaded and running when it links itself.
   - `cmd_start`'s already-alive branch (`ccd/ccd:21809-21812`) runs `_svc_enable` only when `_have_systemctl` holds and `_resupervise_live` declines.
     - `_resupervise_live` (`:21540`) declines for a call from inside the unit (`CCD_IN_UNIT=1`), and for a row in any state but `unsupervised` or `unclaimed`, normally `running`.
     - Those states come from the freshness of the registry's `supervised` heartbeat, not from the manager, so on this branch the instance is not proven loaded.
     - It does not need to be. The call creates (or confirms) the on-disk wants link of a `claude-session@<id>` instance. `EnableUnitFiles` reads the template from disk whether or not the instance is loaded: the attack measured `enable --no-reload` of a never-started instance, which made its link with rc 0. Nothing on the branch writes a unit file.
   - On Linux, `ccd/ccd` writes no systemd unit file or drop-in. `grep -n 'config/systemd' ccd/ccd` finds a `-f` test, the audit's wants-link read and a comment. Its `_svc_daemon_reload` has no caller.
   - Every path that DOES write unit files reloads on its own before any supervisor restarts:
     - the spine's `_inst_units` is the only `_inst_atomic` writer into the unit directory (`ccd/ccrc:14799-14900`), and it sits immediately before `_inst_enable`'s `daemon-reload` (`ccd/ccrc:15247`) in `CCRC_INST_SPINE` (`:12442-12444`), which runs before `_upd_sweep`;
     - the gate-failure restore's arm 3 (`ccd/ccrc:20466`) reloads and never sweeps;
     - `ccrc rollback` by flip runs the kept tree's whole spine (`_ver_flip_back`, `:20638`);
     - `deploy.sh`'s sweep (`:1105`) follows `AGENT_CMD`'s `daemon-reload` (`:963`).

   The attack measured the hazard this rules out, on a real manager: a changed unit file plus `enable --no-reload` plus `try-restart` keeps the old `ExecStart`. Any future caller that writes a unit file must therefore `daemon-reload` itself before relying on `_svc_enable` (Reading 2).
3. **What `--no-reload` leaves behind.** These facts were measured by the attack on systemd 255.4, in a throwaway container. This plan did not re-measure them.
   - **An idempotent self-heal sets nothing.** When the link already exists, `enable --no-reload` leaves `NeedDaemonReload=no` on every unit. That is the steady state and every sweep restart, because a supervisor started by `enable --now` already has its link.
   - **A NEW link made with `--no-reload` makes the whole manager "outdated" until its next reload.**
     - `NeedDaemonReload=yes` appears on EVERY loaded unit, unrelated ones included.
     - `systemctl --user start|restart|try-restart|status` on any unit prints `Warning: The unit file, source configuration file or drop-ins of <unit> changed on disk. Run 'systemctl --user daemon-reload'`.
     - `show` on the new instance gives an empty `WantedBy=`, and `default.target`'s `Wants=` leaves it out.
     - Once that instance stops, the manager garbage-collects it, so it drops out of `list-units 'claude-session@*' --all`.
     - The next reload (any `enable --now`/`disable --now`, the next spine run, an explicit `daemon-reload`, or boot) clears all of it.
   - **The link on disk is made exactly as before**, so boot reads it. ccd's own audit (`_ws_unit_state`, `ccd/ccd:21449-21451`, `-L`/`-e`) reads the disk first and still answers `enabled`.
   - **Readers in this tree:**
     - `_svc_list_sessions --all` is called only from `_upd_sweep`'s Darwin arm (`ccd/ccrc:21055`, `:21085`).
     - `git grep -niE 'changed on disk|NeedDaemonReload'` over `ccd deploy server/src agent/src` finds one comment (`ccd/ccrc:20462`).
     - Every ccd `_svc_*` systemctl call discards stderr. The sweep's `try-restart "claude-session@*"` (`ccd/ccrc:21175`) does not capture stderr: a warning there reaches the operator's terminal, not a decision.

   The attack's conclusion, which this plan adopts: the effect is real but cosmetic, and only a self-heal that REPAIRED a missing link can cause it. Is any reader missed?
4. **The tests model the rule for the verbs ccd issues, not only the spelling.**
   - The new describe's stub counts a reload for `daemon-reload`, and for an `enable` or `disable` without `--no-reload`. Those are the verbs ccd's `_svc_` layer issues. systemctl also reloads implicitly for other install verbs (`reenable`, `mask`, `unmask`, `link`, `preset`, `revert`, `add-wants`), which ccd never issues and the stub does not model. The exact pins would red on any such mutant.
   - T1-4 (the flag moved before the verb) leaves the three cases green and reds only the spelling pins, which is the intended split.
   - The third case is the other edge: a fresh start's `enable --now` still counts one reload, so a fix that silenced every reload would red.
5. **Parity and the stamp.**
   - `macos-platform`'s "is byte-identical in ccd and ccrc" reds when either copy differs (T1-1, T1-2).
   - `ownership.test.ts` reds on an unrestamped body (T1-5).
   - The edit is line-neutral (29868 / 23805). So `session-hook`'s citation census and every `ccd/ccd:<n>` / `ccd/ccrc:<n>` reference stay valid. `session-hook` was run whole on the prototype (335 green).

## Risk notes

- **The blast radius.** `_svc_enable` runs on every supervisor start, and `ccd/ccd` reaches every rostered home on the release after the merge. If systemctl refused `--no-reload`, every `_svc_enable` would fail. Boot persistence would then silently stop being repaired: the unit keeps running, the pane is untouched, and only the `could not enable boot-persistence` warning in the unit's log says so. The option is documented in `systemctl(1)` on the drafting box (systemd 255) and accepted by systemd 255.4 (the attack). Task 1 Step 1 reads the fleet box's `systemctl --version` and its man page entry. Stop and report if either lacks `--no-reload`.
- **The "changed on disk" warning after a repair is benign.** Only a self-heal that created a link that was missing causes it (Review Focus 3). If the operator sees `Warning: … changed on disk. Run 'systemctl --user daemon-reload'` after such a repair, nothing is wrong. `systemctl --user daemon-reload` clears it, and so does the next `enable --now` or spine run. Before this wave the same repair reloaded at once, so the warning never appeared.
- **The reload a supervisor no longer makes was load-bearing in one place and a hazard in another.**
  - `deploy/deploy.sh:769-773` argues that a deploy aborted before its `daemon-reload` is "not containment", because "`ccd`'s own `_svc_enable`/`_svc_disable_now` reload on the next session start or stop", which could load a truncated unit file. After this wave `_svc_enable` no longer reloads, but `_svc_enable_now` and `_svc_disable_now` still do. So the sentence's conclusion stands, and only the function it names is wrong. The comment stays, for the ruling's "alone"; claim 1055 also holds the file at revision (Reading 4).
  - A reload a supervisor triggers mid-sweep makes the manager re-read every unit file while other units restart, which is the serialisation F3 measured. Removing it only shortens the sweep.
- **An enable that failed for the reload's sake.** systemctl's implicit reload runs inside the same command. A reload that fails or times out under load can therefore make `enable` itself exit non-zero, and the caller prints the boot-persistence warning although the link was made. With `--no-reload` that cause is gone. That a plain `enable` always reloads was measured (the attack). That such a reload fails under load was not.
- **Sweep timing.** Wave 11's sweep bounds (the verify windows, the 128 bound, the re-check) were sized from measurements that included the storm. Without it, supervisors settle sooner, which only lowers exposure. Nothing in the tree assumes how long the storm lasts: `git grep -niE 'reload storm|Reloading finished'` over `server/test`, `ccd/ccrc` and `deploy` finds only this wave's own test comment.
- **Three fixtures read `$3` as the unit and would mis-read `--no-reload`:** `ccrc-install.test.ts:522-534` (claim 1056: run only), `ccrc-install-graphify.test.ts:155-159` and `ccrc-update.test.ts:428`. None of them is reached:
  - `ccd/ccrc` defines `_svc_enable` but never calls it;
  - its spine calls `systemctl --user enable --now` directly (`ccd/ccrc:15198`, `:15251`);
  - the update stub already refuses a plain `enable` (`[ "$2" = "--now" ]`), so a path that reached `_svc_enable` through it would have been red before this wave too.

  Step 1 re-measures that no `ccd/ccrc` line calls `_svc_enable`.
- **Open PRs #299, #301 and #303 also edit `ccd/ccd`, and #299 and #301 also edit `ccd/ccrc`.** Measured from their diffs at drafting (heads `34cfe5ee7`, `e8352ab03`, `775b50931`):
  - None has a hunk inside either platform block (`ccd/ccd:41-1221`, `ccd/ccrc:70-1250`) apart from `ccd/ccd`'s marker on line 2, and none touches `ccd-supervised-start.test.ts` or `macos-platform.test.ts`. So `_svc_enable` stays at `ccd/ccd:882` and `ccd/ccrc:911` under each of them, and a rebase conflicts on the marker line only.
  - **The later lander takes either side of line 2, resolves the rest as source, and re-runs `ccd/ccrc restamp ccd/ccd`** (worker clause 16).
  - All three change `ccd/ccd`'s line count, and each one's earliest hunk is below the platform block's end and above the callers. So the callers' lines (`:21810`, `:22197`) move under each of #299, #301 and #303. #301 moves them most: it adds about 3500 lines. This plan cites those lines only as anchors, and Step 1 re-measures them by quote.
  - After any of the three lands, the `wc -l` pair to hold is the new `origin/main`'s, not 29868 / 23805.
- **Run 302 (ccrc-history wave 2) holds `ccd/ccrc` (claim 1055) at revision.** Its diff is not visible to this plan. If it lands first, re-run Task 1 Step 1 on the merged tree. Stop if it changed `_svc_enable`, `_svc_enable_now` or either platform sentinel in `ccd/ccrc` (Task 2 Step 1). `ccd/ccrc` carries no marker, so no restamp follows from it (Reading 7).
- **The wave-11 plan names the wrong call site.** It cites the storm's caller as "`cmd_ensure`, `:21947`". At `8b0547b4`, `:21947` is `cmd_start`'s `_supervised_start` call, and the per-restart enable is `cmd_supervise` at `:22197`. This plan cites the corrected anchor and leaves the wave-11 text alone (Reading 4).
- **Citations into the two edited test files.**
  - In `macos-platform.test.ts`, the inserted rows (around `:335`) sit below every line that shipped source or tests cite into that file: `ccrc-install.test.ts:4994` and `timer-first-run.test.ts:112` cite `:184-189`, `ccd/ccrc:9219` cites `:113`, and `ccd-account-auth.test.ts:143` cites `:54`. Three plan snapshots cite lines past the insertion and shift by the inserted rows: `2026-09-07-account-connections-wave1-fleet-box.md:13132` and `:13269` cite `:351-363`, and `2026-10-02-centralised-update-w9-stable-readiness.md:323` cites `:961-962`. They stay as history.
  - In `ccd-supervised-start.test.ts`, no citation is at or after the insertion point (around `:560`). The highest is `2026-08-20-substrate-unreachable.md:22`, which cites `:364`. The two pins are replaced line for line.
  - No machine-checked corpus cites either file. With the edit applied, `session-hook`'s `-t "the compaction card — every line citation is anchored"` ran 13 green.
- **macOS.** The two new `macos-platform` rows read the file text, so they run on `test-macos` too (advisory, flaky by ruling). The new `ccd-supervised-start` describe is `describeLinux` and skips there. Its Darwin counterpart (`describeDarwin('the same lifecycle, in launchd terms'`) is unchanged.

## Deviations found

These are departures from the ruling, or from what shipped text at `8b0547b4` documents.

- **D-4286** — *The wave edits `ccd/ccrc` as well as `ccd/ccd`: `_svc_enable`'s Linux arm changes in both, because the platform block is one definition spelled in two files.*
  - **Ruled:** "Add `--no-reload` to that enable, ALONE (no other `ccd/ccd` change)." The waves table names the file as `ccd/ccd`.
  - **Shipped:** `_svc_enable` is defined inside the platform block, which `ccd/ccd` (`:41-1221`) and `ccd/ccrc` (`:70-1250`) carry byte for byte. `server/test/macos-platform.test.ts:67` holds that (`expect(platformBlock(ccd)).toBe(platformBlock(ccrc))`). `ccd/ccrc`'s copy (`:910-915`) has no caller; it exists for that parity.
  - **Now:** the same one-line edit lands at `ccd/ccrc:911`.
    - Measured: with `ccd/ccd` alone edited, "is byte-identical in ccd and ccrc" reds (T1-1, T1-2).
    - No other `ccd/ccd` or `ccd/ccrc` line changes, apart from `ccd/ccd`'s marker. `ccd/ccrc` carries no marker.
    - At revision, claim 1055 (run 302) held `ccd/ccrc`, so the edit waits for that claim to end (Reading 7).
  - **Why not exempt the line from the parity test:** that would weaken a guard that keeps two installed copies from drifting, to save one identical line (Reading 1).

## File structure

**New**
- `docs/superpowers/plans/2026-10-06-centralised-update-w15-svc-enable-no-reload.md` (this plan).

**Changed**
- `ccd/ccd` (Task 1): line 2 (the marker, recomputed) and line 882 (`_svc_enable`'s Linux arm).
- `ccd/ccrc` (Task 1): line 911 (the same arm, D-4286). This is held by claim 1055 at revision, and the edit waits for it (Reading 7).
- `server/test/ccd-supervised-start.test.ts` (Task 1): two exact pins (`:222`, `:357`), and one new `describeLinux` with three cases, after the `_supervised_start's fallbacks` describe.
- `server/test/macos-platform.test.ts` (Task 1): two rows appended to the `arms` table, and one string in the `every _svc_ verb` set.

**Run, not edited:**
- `ownership`, `mark-check`, `ccrc-restamp`;
- `ccd-start-id`, `ccd-harness-containment`, `ccd-svc-real-home`;
- `install-census` and `single-definition` (claim 1056: run only);
- `session-hook` (claim 1049: run only);
- `typecheck-tests`, `topology-clean`, `dtbd`, `deviation-refs`.

## Tasks

### Task 1: `_svc_enable` links the unit with `--no-reload`, in `ccd/ccd` and its platform twin (D-4286)

**Files:** `ccd/ccd`, `ccd/ccrc`, `server/test/ccd-supervised-start.test.ts`, `server/test/macos-platform.test.ts`.

**Interfaces:** `_svc_enable <unit>` keeps its signature, its exit status (systemctl's) and its Darwin arm. Its callers are `cmd_supervise` and `cmd_start`'s already-alive branch, both in `ccd/ccd`. No other caller exists in the tree.

- [ ] **Step 1: Re-measure.** From the checkout root:
  ```bash
  git fetch origin main
  ~/.local/bin/ccrc-api claims list --project ccrc-pwa
                                                     # no live claim names ccd/ccd or the two test files;
                                                     # if one names ccd/ccrc (claim 1055 at revision), Steps 1-3 only (Reading 7)
  grep -nF '  if [ "$CCD_OS" != darwin ]; then systemctl --user enable "$1" 2>/dev/null; return $?; fi' ccd/ccd ccd/ccrc
                                                     # ccd/ccd:882 and ccd/ccrc:911, one hit each
  grep -nF '_svc_enable() {   # <unit> — boot persistence only, no start' ccd/ccd ccd/ccrc      # :881, :910
  grep -nF '  if [ "$CCD_OS" != darwin ]; then systemctl --user enable --now "$1" 2>/dev/null; return $?; fi' ccd/ccd ccd/ccrc
                                                     # :870 and :899 — must NOT change
  grep -nF '# ── THE PLATFORM LAYER — one file, two userlands' ccd/ccd ccd/ccrc               # :41, :70
  grep -nF '# ── END PLATFORM LAYER — the byte-identical region ends HERE' ccd/ccd ccd/ccrc   # :1221, :1250
  git grep -nE '_svc_enable([^_]|$)' -- ccd deploy agent/src server/src
                                                     # definitions at ccd/ccd:881 and ccd/ccrc:910; calls at
                                                     # ccd/ccd:21810 and :22197 only; comments at ccd/ccd:790,866,
                                                     # ccd/ccrc:819,895 and deploy/deploy.sh:771. No call in ccd/ccrc.
  grep -nF '_svc_enable "claude-session@$id" 2>/dev/null \' ccd/ccd                             # :21810, :22197
  grep -n 'config/systemd' ccd/ccd                   # :2369 (-f test), :21449 (wants link read), :22187 (comment)
  grep -nF '  systemctl --user daemon-reload \' ccd/ccrc                                         # :15247 (_inst_enable), :23000
  grep -nF "    expect(sysCalls()).toEqual(['systemctl --user enable claude-session@claude-a-demo']);" server/test/ccd-supervised-start.test.ts   # :222
  grep -nF "    expect(sysCalls()).toEqual(['systemctl --user enable claude-session@myid']);" server/test/ccd-supervised-start.test.ts             # :357
  grep -nF "      'systemctl --user enable \"\$1\"'," server/test/macos-platform.test.ts                                                       # :348
  grep -nF "    expect(platformBlock(ccd)).toBe(platformBlock(ccrc));" server/test/macos-platform.test.ts                                    # :67
  wc -l ccd/ccd ccd/ccrc                             # 29868 and 23805
  node shared/mark.mjs --check ccd/ccd               # ccd/ccd: ccrc-unmodified
  systemctl --version | head -1                      # a read; no unit. The drafting box: systemd 255
  man systemctl | grep -A2 -- '--no-reload'          # "When used with enable and disable, do not implicitly reload …"
  cd server
  ./node_modules/.bin/vitest list test/ccd-supervised-start.test.ts | wc -l    # 25 at 8b0547b4
  ./node_modules/.bin/vitest list test/macos-platform.test.ts | wc -l          # 96 at 8b0547b4
  ```
  If `main` moved, merge it first (Task 2 Step 1), restamp, and re-run this step on the merged tree.
- [ ] **Step 2: Write the pins first (red).**
  - In `server/test/ccd-supervised-start.test.ts`, the two exact pins become:
    ```ts
        expect(sysCalls()).toEqual(['systemctl --user enable --no-reload claude-session@claude-a-demo']);
    ```
    in "a live pane that IS being watched costs one idempotent enable and no --now", and
    ```ts
        expect(sysCalls()).toEqual(['systemctl --user enable --no-reload claude-session@myid']);
    ```
    in "cmd_supervise heals its own boot-persistence at entry — enable, no --now — and its ensure adds nothing".
  - In the same file, add the describe below between two landmarks: after the `describe('_supervised_start\'s fallbacks take the split form', …)` block closes (its last case is "neither fallback wraps _spawn_start in a command substitution (D-297)"), and before the `// ── THE SAME LIFECYCLE, ON LAUNCHD` banner.
    ```ts
    describeLinux('boot persistence never reloads the user manager (wave 15)', () => {
      // THE RELOAD STORM. `systemctl --user enable` reloads the whole user manager
      // after it links the unit, unless `--no-reload` says not to. `ccrc update`'s
      // sweep try-restarts every supervisor, and each one runs `cmd_supervise`'s
      // self-heal enable on entry, so a sweep of 71 units queued 71 reloads, one
      // after another (about 27 s, wave 11's attack F3). Nothing on that path writes
      // a unit file, and the install spine has already reloaded before the sweep,
      // so the self-heal needs the symlink and nothing else.
      //
      // MODELLED FOR THE VERBS CCD ISSUES: this stub counts a reload for
      // `daemon-reload`, and for an `enable`/`disable` without `--no-reload`, so the
      // property holds whatever the argv's word order. systemctl reloads for other
      // install verbs too (reenable, mask, link, preset, ...), which ccd never issues.
      // The exact argv pins above hold the spelling. The third case is the other edge:
      // `enable --now` (`_svc_enable_now`) keeps its reload, so the flag cannot leak onto it.
      const RELOADS = `systemctl() {
        echo "systemctl $*" >> "$HOME/ccd-calls"
        case " $* " in
          *" daemon-reload "*) echo reload >> "$HOME/reloads" ;;
          *" enable "*|*" disable "*)
            case " $* " in *" --no-reload "*) ;; *) echo reload >> "$HOME/reloads" ;; esac ;;
        esac
        case "$*" in
          "--user enable --now "*)  : > "$HOME/pane-up" ;;
          "--user disable --now "*) rm -f "$HOME/pane-up" ;;
        esac
        return 0
      };`;
      const reloads = (): number => {
        const f = path.join(h.home, 'reloads');
        return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0;
      };

      it('cmd_supervise\'s self-heal enable links the unit and asks for no reload', () => {
        seed('myid');
        const r = shFail(`${NO_PANE} ${RELOADS} cmd_supervise myid`);
        expect(r.code).toBe(1);   // no session -> the watch loop exits for systemd
        expect(sysCalls()).toHaveLength(1);
        expect(reloads(), 'a restarted supervisor reloaded the user manager').toBe(0);
      });

      it('cmd_start on a live, watched row reconciles the symlink and asks for no reload', () => {
        h.sh(`mkdir -p "$HOME/projects/demo"`);
        h.sh(`_reg_claim claude-a-demo; _reg_set claude-a-demo supervised "$(date +%s)"`);
        const out = h.sh(`${UNIT} ${RELOADS} : > "$HOME/pane-up"; cmd_start claude-a demo`);
        expect(out).toContain('already running: claude-a-demo');
        expect(sysCalls()).toHaveLength(1);
        expect(reloads(), 'the already-alive branch reloaded the user manager').toBe(0);
      });

      it('a fresh start\'s enable --now keeps its one reload: the flag is _svc_enable\'s alone', () => {
        h.sh(`mkdir -p "$HOME/projects/demo"`);
        h.sh(`${UNIT} ${RELOADS} cmd_start claude-a demo`);
        expect(sysCalls()).toContain('systemctl --user enable --now claude-session@claude-a-demo');
        expect(reloads(), 'enable --now lost its reload').toBe(1);
      });
    });
    ```
    - `RELOADS` follows `${NO_PANE}` / `${UNIT}` in each snippet, so its `systemctl` replaces theirs and their `tmux` stays.
    - The second case seeds the row exactly as that file's `beat` helper does (`_reg_claim`, then a fresh `supervised` stamp), which makes `_session_state` read `running`.
    - The comment block differs from the prototype's wording (pins F6) and is comment only.
  - In `server/test/macos-platform.test.ts`, append two rows to the `arms` table in `describe('the Linux arms are the original GNU commands'`, after the `'_svc_run_supervised (the call)'` row:
    ```ts
        // Wave 15: the boot-persistence enable links the unit WITHOUT reloading the
        // user manager (every restarted supervisor runs it, so a sweep reloaded once
        // per unit), and `enable --now` keeps its reload. Each row binds the NAME,
        // so the flag cannot move from one function to the other unseen.
        ['_svc_enable', /^_svc_enable\(\) \{[^\n]*\n {2}if \[ "\$CCD_OS" != darwin \]; then systemctl --user enable --no-reload "\$1" 2>\/dev\/null; return \$\?; fi$/m],
        ['_svc_enable_now', /^_svc_enable_now\(\) \{[^\n]*\n {2}if \[ "\$CCD_OS" != darwin \]; then systemctl --user enable --now "\$1" 2>\/dev\/null; return \$\?; fi$/m],
    ```
    Then, in "every _svc_ verb reaches systemctl unchanged when not on Darwin", replace `'systemctl --user enable "$1"',` with:
    ```ts
          'systemctl --user enable --no-reload "$1"',
    ```
    The inserted lines move no citation made by shipped source or tests. They do shift three plan-snapshot citations, which stay as history (Risk notes).
- [ ] **Step 3: Run them red** against the unchanged `ccd/ccd` and `ccd/ccrc`:
  ```bash
  cd server
  ./node_modules/.bin/vitest run test/ccd-supervised-start.test.ts
  ./node_modules/.bin/vitest run test/macos-platform.test.ts
  ```
  Expected (T1-0, *prototype*): `ccd-supervised-start` **4 failed** | 24 passed | 4 skipped:
  - "a live pane that IS being watched costs one idempotent enable and no --now";
  - "cmd_supervise heals its own boot-persistence at entry — enable, no --now — and its ensure adds nothing";
  - "cmd_supervise's self-heal enable links the unit and asks for no reload";
  - "cmd_start on a live, watched row reconciles the symlink and asks for no reload".

  Expected for `macos-platform`: **2 failed** | 96 passed | 11 skipped. The two are "_svc_enable still runs the GNU command on Linux" and "every _svc_ verb reaches systemctl unchanged when not on Darwin".

  The fresh-start reload case and the `_svc_enable_now` row are green on `main`, as they must be: they pin the edge this wave must not move.
- [ ] **Step 4: The edit.** Re-read `claims list` first: no live claim may name `ccd/ccd` or `ccd/ccrc` (Reading 7). Then, from the checkout root, make one substitution per file. Each must match exactly once:
  ```bash
  grep -cF 'systemctl --user enable "$1" 2>/dev/null; return $?; fi' ccd/ccd ccd/ccrc     # 1 and 1
  sed -i 's|systemctl --user enable "$1" 2>/dev/null; return \$?; fi|systemctl --user enable --no-reload "$1" 2>/dev/null; return $?; fi|' ccd/ccd ccd/ccrc
  grep -nF 'systemctl --user enable --no-reload "$1"' ccd/ccd ccd/ccrc                   # ccd/ccd:882, ccd/ccrc:911
  bash -n ccd/ccd && bash -n ccd/ccrc
  wc -l ccd/ccd ccd/ccrc                                                                  # 29868 and 23805, unchanged
  ```
  The resulting line in both files:
  ```bash
    if [ "$CCD_OS" != darwin ]; then systemctl --user enable --no-reload "$1" 2>/dev/null; return $?; fi
  ```
- [ ] **Step 5: Restamp, then check.**
  ```bash
  ccd/ccrc restamp ccd/ccd                  # expected "restamp: ccd/ccd: restamped" (NOT run in the prototype; see below)
  node shared/mark.mjs --check ccd/ccd      # "ccd/ccd: ccrc-unmodified", exit 0
  git diff --numstat -- ccd                 # "2 2 ccd/ccd" and "1 1 ccd/ccrc"
  git diff -U0 -- ccd | grep '^[-+][^-+]'   # exactly: the two marker lines, and the two arm lines per file
  ```
  The prototype could not run `ccd/ccrc restamp` (its harness refused the call). It recomputed the marker through the same `markGenerated`/`verifyMarker` path that `cmd_restamp` (`ccd/ccrc:23701-23733`) takes, and verified `ccrc-edited` before and `ccrc-unmodified` after. The expected output line comes from `cmd_restamp`'s source: it prints `restamp: $f: restamped` for that verdict and refuses only a path under `$HOME/.local/bin` or `$HOME/.ccrc`. If the verb is refused, restamp by recomputing with the same module from the checkout root:
  ```bash
  node --no-warnings --input-type=module -e '
  import { readFileSync } from "node:fs"; import { writeFile } from "node:fs/promises";
  import { pathToFileURL } from "node:url";
  const { markGenerated, verifyMarker } = await import(pathToFileURL("shared/mark.mjs").href);
  const f = "ccd/ccd"; const t = readFileSync(f, "utf8"); const v = verifyMarker(t);
  if (v === "ccrc-edited") { await writeFile(f, markGenerated(t)); console.log("restamped"); } else console.log(v);'
  ```
  The prototype's digest held only for `8b0547b4`; never copy it.
- [ ] **Step 6: Run green.**
  ```bash
  cd server
  ./node_modules/.bin/vitest run test/ccd-supervised-start.test.ts     # 28 passed | 4 skipped (vitest list: 28)
  ./node_modules/.bin/vitest run test/macos-platform.test.ts           # 98 passed | 11 skipped (vitest list: 98)
  ./node_modules/.bin/vitest run test/ownership.test.ts                # 14 passed
  ./node_modules/.bin/vitest run test/ccd-start-id.test.ts             # 30 passed
  ```
- [ ] **Step 7: The mutation table.** Each row starts from the green Task 1 tree (`cp` both files to `$SCRATCH/*.good` first) and ends restored and `cmp`-checked. All rows are *prototype*, measured at `8b0547b4`. Rows that write `ccd/ccrc` run only when no live claim names it.

  | Row | Mutation (both files unless named) | Command(s) | Expected red set (measured) |
  |---|---|---|---|
  | T1-0 | Red-first: Task 1's tests against `main`'s `ccd/ccd` and `ccd/ccrc` | `ccd-supervised-start`, `macos-platform` | 4 (the two exact pins, the two no-reload cases) + 2 (`_svc_enable` row, the verb set) |
  | T1-1 | Drop `--no-reload` from `ccd/ccd` only | `ccd-supervised-start`, `macos-platform` | 4 (as T1-0) + 3 (`is byte-identical in ccd and ccrc`, `_svc_enable` row, the verb set) |
  | T1-2 | Drop `--no-reload` from `ccd/ccrc` only | `ccd-supervised-start`, `macos-platform` | 0 + 1 (`is byte-identical in ccd and ccrc`) |
  | T1-3 | Leak it onto `_svc_enable_now`: `systemctl --user enable --now --no-reload "$1"` (the `_svc_enable` arm kept) | `ccd-supervised-start`, `macos-platform`, `ccd-start-id` | 8 (seven existing `enable --now` pins: "emits exactly disable --now, reset-failed, enable --now", "ccd enable is ccd start under another name", "adopts a live pane no supervisor is watching", "a bare ccd start on the same row adopts it too", "adopts the pane, and the row stops reading `unsupervised`", "never duplicates the call a fresh start already made", "attach revives a dead row through the unit"; plus "a fresh start's enable --now keeps its one reload") + 2 (`_svc_enable_now` row, the verb set) + 2 ("and enables the unit, so `ccd ensure` on the row is a real repair", "an `unsupervised` row still adopts — PR #50's own population is untouched") |
  | T1-4 | Move the flag before the verb: `systemctl --user --no-reload enable "$1"` | `ccd-supervised-start`, `macos-platform` | 2 (the two exact pins only; the three modelled cases stay GREEN, by design) + 2 (`_svc_enable` row, the verb set) |
  | T1-5 | Keep the edit, put `main`'s marker back on line 2 (an edit without a restamp) | `node shared/mark.mjs --check ccd/ccd`, `ownership`, `mark-check` | `--check` prints `ccrc-edited`, exit 1; `ownership` 1 ("verifies as ccrc-unmodified — re-stamp ccd/ccd after editing it (see the note above)"); `mark-check` 0 (7 green: it tests the tool, not the committed file) |

  Report each row's measured set against this column, with the assertion that fired. Under T1-1, T1-3 and T1-4, `ownership` is also red (an unrestamped body). That is expected and outside the rows' sets.
- [ ] **Step 8: Commit.**
  - `git add ccd/ccd ccd/ccrc server/test/ccd-supervised-start.test.ts server/test/macos-platform.test.ts`, then run `topology-clean.test.ts`.
  - Commit as `fix(ccd): _svc_enable links with --no-reload, so a supervisor restart stops reloading the user manager (D-4286)`.
  - The message cites D-4286, so the plan must already be committed or ride this commit.

### Task 2: The gate and the PR

- [ ] **Step 1: Start from a merged, clean tree.**
  ```bash
  git status --porcelain
  git fetch origin main
  git merge-base --is-ancestor origin/main HEAD && echo "origin/main is in HEAD" || echo "MAIN MOVED"
  ~/.local/bin/ccrc-api claims list --project ccrc-pwa      # no live claim names a File-structure path
  ```
  - If `main` moved, run `git merge --no-edit origin/main` and record `git show --remerge-diff HEAD`. On a conflict on `ccd/ccd` line 2, take either side of that line only and resolve the rest as source. Then run `ccd/ccrc restamp ccd/ccd` (or Task 1 Step 5's fallback) and `node shared/mark.mjs --check ccd/ccd`.
  - **Stop and report** if `main` changed any of these:
    - `_svc_enable` or `_svc_enable_now`, in either file;
    - either platform sentinel;
    - the two callers' guard lines: `if _have_systemctl && ! _resupervise_live "$id"; then`, and the `_reg_set "$id" supervised "$(date +%s)"` before the self-heal;
    - `_inst_enable`'s `daemon-reload`;
    - any of the pins Task 1 Step 1 measures.
  - If #299, #301, #303 or run 302's PR merged first:
    - expect exactly the marker conflict for the first three (Risk notes), and no marker at all in `ccd/ccrc`;
    - re-measure `wc -l` against the new `origin/main`: the pair must equal `origin/main`'s.
- [ ] **Step 2: Dependencies.** `npm ci` in `server/`, `agent/` and `pwa/`, wherever `node_modules` is absent.
- [ ] **Step 3: Server, one file per call,** in the foreground, with a timeout of at least 600000 ms. Counts were measured on the prototype:
  - Edited: `ccd-supervised-start` (**28** passed, 4 skipped), `macos-platform` (**98** passed, 11 skipped).
  - Run, not edited:
    - `ownership` (**14**), `mark-check` (**7**), `ccrc-restamp` (**9**);
    - `ccd-start-id` (**30**), `ccd-harness-containment` (**14**), `ccd-svc-real-home` (**16**);
    - `install-census` (**22**), `single-definition` (**275**). Claim 1056 holds both: run only.
    - `session-hook` (**335**, about 160 s at load 37). Claim 1049 holds it: run only. If the whole file must be re-run in parts, its citation census is `-t "the compaction card — every line citation is anchored"` (**13**).
    - `typecheck-tests` (**12**, about 77 s), `topology-clean` (**55**), `dtbd` (**1**), `deviation-refs` (**31**).

  If a known load flake reds, re-run it IN ISOLATION before calling it a break.
- [ ] **Step 4: The ledger and scope guards, last.**
  ```bash
  git fetch origin main
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
  ./node_modules/.bin/vitest run test/dtbd.test.ts
  ./node_modules/.bin/vitest run test/topology-clean.test.ts
  cd ..
  # the scope check (Global Constraints) — the first command prints nothing
  # the ccd/ccrc check prints "1 1 ccd/ccrc", and claims list names no live claim on ccd/ccrc
  git diff --stat origin/main...HEAD     # exactly File structure's New and Changed lists
  wc -l ccd/ccd ccd/ccrc                 # equal to origin/main's pair
  node shared/mark.mjs --check ccd/ccd   # ccrc-unmodified
  ```
  Then run the D-number check. Every D-token the branch adds must either be one of 4286 to 4291 and defined in this plan, or already be on `origin/main`. The block and reserve numbers are checked for a definition BEFORE the on-main skip, so a mention landing on `main` first cannot excuse a missing definition. The pattern sees tokens of any length. The check prints nothing:
  ```bash
  PLAN=docs/superpowers/plans/2026-10-06-centralised-update-w15-svc-enable-no-reload.md
  git diff origin/main...HEAD | grep '^+' | grep -oE '\bD-[0-9]+\b' | sort -u > "$SCRATCH/dnums"
  while read -r d; do
    case "${d#D-}" in
      428[6-9]|429[01]) grep -qE "^- \*\*$d\*\* — " "$PLAN" || echo "UNDEFINED $d"; continue ;;
      429[2-5])         echo "BLOCK NUMBER PAST THE RESERVE: $d"; continue ;;
    esac
    git grep -qwF -e "$d" origin/main -- docs/superpowers && continue          # cited as it stands
    echo "OUTSIDE THE BLOCK OR THE RESERVE: $d"
  done < "$SCRATCH/dnums"
  ```
- [ ] **Step 5: The PR,** from the workspace branch.
  - **Its first paragraph says:**
    - that `_svc_enable` now links a supervisor's unit with `systemctl --user enable --no-reload`, so a supervisor restart in `ccrc update`'s sweep no longer reloads the user manager (71 serial reloads, about 27 s, at 71 units);
    - that `enable --now`, `disable --now` and the Darwin arm are unchanged;
    - that the same line changes in `ccd/ccrc`, for the platform block's parity (D-4286);
    - that `ccd/ccd` reaches every home through the spine on the next release, whose own sweep already runs the new body.
  - **The body has:**
    - the two callers, and why neither needs the reload;
    - the paths that do write unit files, and where each one reloads;
    - the attack's container facts (Tech Stack, Review Focus 3), including the benign "changed on disk" warning after a self-heal that repaired a missing link;
    - the mutation table's measured results;
    - the merge note for #299, #301, #303 and run 302 (the later lander restamps `ccd/ccd`).
  - **Links:** the plan and the files are GitHub `blob/main` URLs built from the repository's own remote (`git remote get-url origin`). Until the merge, put the PR's `/files` view beside each one. Never a docserver URL.
  - The body is hand-written and ends with the attribution line the session's instructions give.
  - Every commit's author and committer are the noreply identity: `git log --format='%an <%ae> | %cn <%ce>' origin/main..HEAD`.
  - **After CI starts,** read the PR's `select tests` summary. A `ccd/ccd` change selects every test that reads it, so the summary must list `ccd-supervised-start.test.ts`, `macos-platform.test.ts`, `ownership.test.ts` and `ccd-start-id.test.ts`. If one is missing, run `gh workflow run ci.yml --ref <branch> -f mode=full` and name that run in the wave-done.
- [ ] **Step 6: The wave-done, in the same turn as the push.** It carries:
  - the tip sha, the PR number, and the remerge-diff result (or "main unmoved");
  - `wc -l` of both files against `origin/main`'s, and `mark.mjs --check`'s verdict;
  - which restamp path ran (the verb or the fallback);
  - the claim state on `ccd/ccrc` at the edit and at the push;
  - each suite's result against Step 3's counts, and the load;
  - every mutation row (T1-0 to T1-5), with its measured red set against the listed set and the assertion that fired;
  - the fleet box's `systemctl --version` line, and whether its man page documents `--no-reload` (Task 1 Step 1);
  - any reserve number spent, defined in this plan in the commit that cites it;
  - two lines for the operator (Reading 3):
    - "After the release, count the reloads the supervisors requested in one sweep's journal window, read only: `journalctl --user --since <sweep start> -o cat | grep -c \"Reloading requested from client PID .* (unit claude-session@\"`. Expect 0, against one per restarted unit before. The spine's own reloads (one `daemon-reload` plus one per `enable --now`) are attributed to no `claude-session@` unit and stay."
    - "A `changed on disk … daemon-reload` warning seen after a self-heal that repaired a missing link is benign. `systemctl --user daemon-reload` clears it."

## Readings (for the coordinator to rule; each was chosen where no ruling decided it)

1. **The `ccd/ccrc` twin (D-4286).** The ruling says `ccd/ccd` alone, but the parity test forces the same line into `ccd/ccrc`. Options:
   - (a) **edit both, byte-identical** (this plan). It costs one extra identical line in `ccd/ccrc`, and the parity guard keeps meaning what it says. The timing is Reading 7, because claim 1055 holds the file at revision.
   - (b) teach `platformBlock` to skip `_svc_enable`, and edit `ccd/ccd` alone. That weakens the one guard that stops two installed copies drifting.
   - (c) delete `ccd/ccrc`'s uncalled `_svc_enable`. That breaks the byte-identical block by design, and it is a larger change than the wave.

   Recommendation: (a).
2. **The shape: unconditional `--no-reload`, and no reload added anywhere.** Options:
   - (a) **`_svc_enable` always passes `--no-reload`** (this plan). Neither caller writes a unit file, and every path that does write one reloads on its own before a supervisor restarts (Review Focus 2).
   - (b) a parameter (`_svc_enable <unit> [reload]`), so a future caller can ask for the reload. Nothing calls it that way today, so it would be an untested branch in live code.
   - (c) `--no-reload` plus one `daemon-reload` at the end of `_upd_sweep`. That is a `ccd/ccrc` sweep change outside "alone", and the spine's reloads already precede the sweep.

   Recommendation: (a). A future caller that writes a unit file and then calls `_svc_enable` must reload itself, as the spine does. The attack measured why: a changed unit file plus `enable --no-reload` plus `try-restart` runs the old `ExecStart`.
3. **The manager's state after a NEW link, and the operator's check.** With `--no-reload`, an idempotent self-heal (the steady state, and every sweep restart) changes nothing in the manager. A self-heal that REPAIRS a missing link leaves the manager "outdated" until its next reload, as measured by the attack on systemd 255.4:
   - `NeedDaemonReload=yes` on every unit;
   - a "changed on disk" warning on any start, restart, try-restart or status;
   - the new instance missing from `WantedBy=` and `default.target`'s `Wants=`;
   - once stopped, the instance garbage-collected out of `list-units --all`.

   Boot, the link on disk and `_ws_unit_state` are unaffected, and no reader in this tree consults the in-memory state on Linux (Review Focus 3). Options:
   - (a) **accept it as cosmetic, and ask the operator for one read-only measurement after the release.** In one sweep's journal window, count only the reloads attributed to supervisors (`grep -c "Reloading requested from client PID .* (unit claude-session@"`). Expect 0, against one per restarted unit before. Do not count every "Reloading finished": the spine's `daemon-reload` and each of its `enable --now` calls reload too, so that count would be about a dozen, not 1.
   - (b) also ask the operator to read `systemctl --user show -p NeedDaemonReload` on one unit, but only right after a self-heal that CREATED a link. There it should read `yes`, and the next reload clears it. After an ordinary sweep it reads `no` in every case and proves nothing.
   - (c) gate the merge on a real `systemd --user` run. The attack's throwaway container already answered the semantic questions in minutes, and a CI harness for it stays out of scope.

   Recommendation: (a). Add (b) only if the operator has a repair case to observe.
4. **The stale prose and the wave-11 anchor.** Four texts say `_svc_enable` reloads, or cite its caller wrongly:
   - `deploy/deploy.sh:771` (claim 1055 at revision; claim 1052 at drafting);
   - `agent/test/deploy-verify.test.ts:907` (a comment; claim 1056 at revision);
   - `docs/superpowers/plans/2026-09-07-telemetry-keepalive.md:1701`;
   - the wave-11 plan's "`cmd_ensure`, `:21947`" (lines 154 and 314), which should read `cmd_supervise`, `:22197`.

   The platform-block comment at `ccd/ccd:866` / `ccd/ccrc:895` is related, but it sits under Reading 5. Options:
   - (a) **leave all four, and add them to the residue list** for the first wave that holds `deploy/deploy.sh` and `agent/test/deploy-verify.test.ts` after claims 1055 and 1056 end. The ruling says "alone", and none of them changes behaviour.
   - (b) fix the two unclaimed ones now (an As-built bullet in the wave-11 plan, a note in the telemetry plan), and leave the two claimed ones for later. That splits one correction across two waves.
   - (c) fix only the wave-11 plan, since it is this programme's own record and the source of the F3 ruling.

   Recommendation: (a). If the coordinator prefers (c), it takes reserve number 4287.
5. **The two platform-block comments.** Line 881's trailing comment reads `# <unit> — boot persistence only, no start`. Line 866 / 895's sentence says `_svc_enable` "is the same call minus the start", which on Linux it no longer exactly is. Both can be fixed line-neutrally, in both files for parity, for example by folding `, no reload` into each. This plan leaves both, because the ruling says "alone" and the test comments and this plan carry the reason. Recommendation: leave both, and list them as residue. The coordinator may rule them in at no line cost.
6. **Landing order against #299, #301 and #303.** They share only `ccd/ccd`'s marker line with this wave. Options:
   - (a) **land in whatever order they are ready; the later lander restamps** (the ledger's standing rule).
   - (b) hold wave 15 until #299 lands, so that waves 15 to 19 restamp against one base.

   Recommendation: (a). The wave is one line, and holding it delays the sweep's benefit for nothing.
7. **BLOCKING: claim 1055 (run 302, ccrc-history wave 2) holds `ccd/ccrc` at revision (about 16:59 UTC, hard expiry about 8 h later).** The wave cannot land without its one-line `ccd/ccrc` edit (D-4286). Options:
   - (a) **wait.** The worker does Task 1 Steps 1 to 3 (the unclaimed test files, red-first) and holds before Step 4 until claim 1055 ends. Then it merges `main` (which may carry run 302's `ccd/ccrc` changes), re-measures and continues.
   - (b) the coordinator asks run 302's coordinator whether run 302 can carry the one identical `ccd/ccrc:911` line itself, or release `ccd/ccrc` early. Either is a cross-programme agreement only a coordinator can make.
   - (c) Reading 1(b): edit `ccd/ccd` alone and narrow the parity test. That weakens a guard to work around a claim that will end.
   - (d) dispatch wave 15 only after claim 1055 ends.

   Recommendation: (a), with (b) to shorten the wait if run 302 is long. Never write `ccd/ccrc` under a live claim.

## Coordinator rulings on this plan's readings (2026-10-06)

- **Reading 7: neither (a) nor (b).**
  - Three claims cover this wave's files, not one. Claim 1057 (child-reclamation wave 6, run 291) holds `ccd/ccd`.
    Claim 1058 (the same run) holds `server/test/macos-platform.test.ts`. Claim 1055 (ccrc-history wave 2, run 302) holds
    `ccd/ccrc`.
  - (a) would start a worker on files that another worker holds, which the coordinator skill's clause 10 calls a defect
    in the ledger.
  - (b) would ask another programme to carry this wave's line, which reshapes that programme's wave.
  - **Ruled:** the coordinator holds the dispatch until all three claims have ended. A claim that lapses at its hard cap
    while its PR is still open does not count as ended for this purpose: the coordinator waits for that PR to land, or
    for its coordinator to say the paths are free.
  - The worker re-reads the claims at Task 1 Step 1 and stops, mailing the coordinator, if any of the three is live.
- **Reading 1:** edit both `_svc_enable` lines byte-identically, `ccd/ccd` and `ccd/ccrc` (D-4286). The platform-block parity
  test keeps holding them.
- **Reading 2:** an unconditional `--no-reload`, with no reload added to any caller or to `_upd_sweep`. A future writer of a
  unit file must reload the manager itself. The plan's Risk notes say so, and the attack measured a stale `ExecStart`
  otherwise.
- **Reading 3:** accept the cosmetic manager-wide "outdated" state, which only a self-heal that repairs a missing link
  causes.
  - The post-release count is the coordinator's own read-only measurement, taken during its standing monitoring of the
    first release that carries this wave.
  - It counts the reloads attributed to `claude-session@` units on the fleet box, from the user journal, read-only.
    Expected: 0, against the install spine's own reloads.
  - The operator is not asked to run it.
- **Reading 4:** residue. The stale prose under live claims, and the wave-11 plan's anchor, go to the programme's residue
  list.
- **Reading 5:** residue. This wave is "alone": the two platform-block comments are not edited here.
- **Reading 6:** land independently of #299, #301 and #303. Whichever lands later rebases and restamps `ccd/ccd` by
  recomputing the marker, never by copying it.
