# Centralised update management, wave 24: ccrc's own settings live in ccrc.env, read through one reader, and a census keeps it so: Implementation Plan

On 2026-10-22 the operator gave a directive, relayed verbatim in mail 8002: "I don't understand why anything related to CCrc shouldn't survive restarts etc as it should all be part if ccrc config???". It came up because the update backups' keep of 5 was first set in the user manager's environment, which a reboot loses. It was then made persistent with a systemd `environment.d` fragment on the server box. That is an operating-system workaround, not ccrc config. The coordinator cut wave 24 as run 855 and issued a block of twenty deviation numbers starting at D-6587. Every citation below is `path:line` at the pinned base `531797d62` (wave 23 landed, PR #1137), read with `git show 531797d62:<path>`. The worker re-reads each one in the text that has landed (see the absorb step). This is revision 2: revision 1 after its plan review (32 findings, three lenses). What each finding changed, and the one part rejected, is in "Review notes" at the end.

**What was measured** (a census of every `CCRC_*` name in the non-comment lines of `ccd/ccrc` and `ccd/ccrc-doctor-checks`, which `cmd_doctor` sources, ccd/ccrc:4005):

| What | Count | How it is read today |
|---|---|---|
| Distinct `CCRC_*` names in code lines | 102 | mostly constants, arrays, out-params and messages |
| Names read in a default-expansion form (`${CCRC_X:-…}`, `:=`, `-`, `=`, `+`, `?`) or passed by name to `_upd_validate_timeout` (ccd/ccrc:20532) or `_acct_deadline` (:9489) | 49 | the process environment only, with one exception |
| The exception | 1 | `CCRC_BACKUP_DATA_KEEP`: the environment, else `~/.ccrc/ccrc.env` alone through the byte-wise model, else 3 (`_bak_data_keep`, :23714) |
| A half-exception | 1 | `CCRC_UPDATE_DEADLINE_MS`: the environment if canonical, else `ccrc.env` through two-argument `_box_env_value` (:3161), which reads in the caller's locale (`_upd_deadline_ms`, :19288) |
| Names read from `ccrc.env` or the exposure file only, never the environment | — | the server's own settings (`CCRC_ROLE`, `CCRC_HOST`, `CCRC_PORT`, `CCRC_AUTH`, …), read where the server reads them |

`set -uo pipefail` is ccd/ccrc:68. Under `-u` a bare `$CCRC_X` of an unset name aborts the run, so every optional environment read in this file must use a default form. That is why a text census of those forms catches an unguarded read (Task 5's C7 pins the premise). It is not a proof that no other reader exists: fix round 1 retired the word "complete", and the census names what it does not catch (D-6746).

**What already holds.**
- The tree has a byte-wise model of how systemd reads an `EnvironmentFile=`: `_box_unit_env` (ccd/ccrc:3376), which reads `_box_env_value`'s `unit` mode on Linux and `_box_unit_env_shell` (:3437) on macOS. A shape it cannot decide answers rc 3, and an unreadable second file rc 2.
- Wave 23 put one knob on it, behind a whole-token awk scan (`_bak_data_keep`, ccd/ccrc:23714-23728):
  - the environment if set;
  - else `ccrc.env` alone. The model is called with `CCRC_EXPOSURE_FILE="$f/."`, so no second file is read. On Linux it is asked only when the scan finds the knob as a whole token. On macOS it is always asked. A NUL byte refuses first;
  - else 3.
  - Unmeasured is not unset (D-6365): an unreadable file, an untaken line, or an undecided model refuses, naming the file and never its bytes.
- `ccrc.env` holds secrets (`CCRC_AGENT_TOKEN`, `CCRC_VAPID_PRIVATE`, …). It is never sourced: `_box_env_value`'s header (ccd/ccrc:3100-3107).
- **No process that acts on a ccrc setting receives `ccrc.env` as its environment.** That is why wave 23's knob reads the file itself, and why the fragment works where a `ccrc.env` line would not:
  - a console update hands its run to `_svc_run_detached` → `systemd-run --user --collect` (ccd/ccrc:1138), under the user manager's environment;
  - the watchdog's unit runs `sh -c 'PATH=… exec ccrc watchdog'` with no `EnvironmentFile=` (deploy/systemd/ccrc-update-watchdog.service:28);
  - the models timer's unit sets `Environment=PATH=` only (deploy/systemd/ccrc-models.service:7, :11);
  - `ccrc rollout` runs `ssh <box> ccrc update` (ccd/ccrc:23338) in a non-interactive shell.
  - The macOS server job does source `ccrc.env` (`_inst_plist_server`, :15929-15934). But `--detach` is refused on macOS (`_upd_detach_os_check`, :19811), so no console-driven update runs under that job's environment.

**Where the settings are read, in time.**
- `cmd_update` (ccd/ccrc:17873) reads them in this order:
  - `_upd_resolve` takes the release base (`_upd_release_base`, :20513, called at :20584);
  - after the install, `_upd_gate` (:21250, called at :18578) takes `CCRC_UPDATE_HEALTH_S`;
  - `_ver_gc update auto` (:18627) takes `CCRC_VERSIONS_KEEP`;
  - the re-stamp of the report, then `_bak_gc update` (:18661, :23831) takes `CCRC_BACKUP_KEEP`, `CCRC_BACKUP_DATA_KEEP` and the deadline.
- `cmd_rollback` (:18906) gates at :19167, stamps `restarting` (:19169), sweeps (`_upd_sweep`, :19171) and prunes with `_bak_gc rollback` (:19178). Nothing re-stamps the report between the sweep and the prune, and no `UPD_THIN_AT` is set on this path (cmd_update's line :18661 is its only writer), so at the base the rollback's keep-set walk is unbounded (D-6601).
- Its one release-host question is `_upd_asset_listed` (:19084, the only code caller), whose `*)` arm dies blaming curl (:19091).
- `cmd_rollout` (:23103) pins the version on the deploying machine through `_upd_resolve` (:23203), so that machine's own release base is read there.
- The watchdog reads the deadline at :19485 (`cmd_watchdog`, :19390).
- `ccrc backup` (`cmd_backup`, :23450) ends in `_bak_prune` (:23467, :23576).
- `ccrc models refresh` reads its advance budget in `_models_advance_budget_secs` (:11202).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. The dispatched worker runs it under the `ccrc-worker` skill. The brief carries only this wave's specifics: this plan's path, the task range, the claim groups and the deviation block.

**Goal:** every ccrc setting (D-6588's seven) reads the process environment if set, else `~/.ccrc/ccrc.env` through wave 23's byte-wise model, else its default, through ONE reader. So a console update, the watchdog, a timer and an ssh rollout honour a line in `ccrc.env`, and the server box's `environment.d` fragment can go. Each setting is documented in `deploy/ccrc.env.example`. A LINE ccrc cannot read stops only the act whose setting it names, in that act's safe direction; a FILE no reader can scan (unreadable, a NUL byte) refuses every setting at once, and each act says so in its own line (D-6590). A census test fails the build on any new environment-only `CCRC_` read in `ccd/ccrc` or `ccd/ccrc-doctor-checks`, and on any second reader of a setting there, that is not a reasoned exception. Its scope is those two files: the other executables ccrc ships or runs are named in "Not in this wave", each with its names and class (D-6598).

**Architecture:** no server, agent or PWA change, no new verb, no new placed file or unit.
- `ccd/ccrc`:
  - `CCRC_SETTINGS`, the one list of ccrc's settings (D-6587);
  - `_ccrc_knob <KEY> <default> [file]`, the one reader. It is `_bak_data_keep`'s read, generalised (D-6587);
  - `_keep_knob <KEY> <default> [<lowest>]`, the one reader and validator of a keep (D-6589);
  - `_bak_data_keep` becomes a three-line wrapper;
  - `_bak_prune`, `_bak_gc`, `_ver_gc`, `cmd_versions`, `_upd_gate`, `_upd_deadline_ms`, `cmd_watchdog`'s deadline line, `_upd_release_base`, `_upd_resolve`'s base line, `_upd_asset_listed` and `_models_advance_budget_secs` read through it;
  - `_bak_keepset` gains a time bound that counts only verifications of a data set (D-6592), and `_bak_snap_class`'s pre-filter says whether a dir holds one;
  - `_bak_restamp`, new: the one spelling of the pre-prune re-stamp, called by `cmd_update` and now by `cmd_rollback`'s flip arm, so a rollback's keep-set is bounded too (D-6601);
  - `_upd_deadline_ms` gains `max` for the watchdog (D-6602).
- `ccd/ccrc-doctor-checks`: a `box-settings` check reports what `ccrc.env` alone sets, the read the soak needs before the fragment goes (D-6599).
- `deploy/ccrc.env.example`: a section for ccrc's own settings (D-6597).
- `server/test/ccrc-settings-census.test.ts`, new: the guard (D-6598).
- **Why not `EnvironmentFile=` on the timers and `systemd-run --property=EnvironmentFile=`:** that would export every secret in `ccrc.env` into ccrc and every child it starts (curl, node, jq), which `_box_env_value`'s header forbids. It would also make the file the environment, so a set environment could no longer win. And it would leave the ssh rollout and the interactive shell out (D-6587).

**Deploy class:** box tooling only (`ccd/ccrc`, `ccd/ccrc-doctor-checks`). It rides `ccrc update` and `ccrc rollout` to each box. No order is needed: nothing on the wire changes. **The update that installs this wave is mostly old text, but not wholly.**
- Its own `cmd_update` runs as the process that started it, so its gate, `_ver_gc` and `_bak_gc` are the old tree's text, which reads `CCRC_BACKUP_KEEP` from the environment only.
- Two things it starts run the NEW tree, and so read `ccrc.env` through the new reader on the move itself: the gate-failure restore's arm 2 child (`bash "$BOX_TREE_DIR/ccd/ccrc" update --to "$UPD_PREV_TAG" --no-gate --from restore`, ccd/ccrc:21738, reached when no kept previous version exists), which resolves its release base through the new `_upd_release_base`; and the watchdog timer's next tick, which reads the deadline, the gate window and the keep through it.
- So a `ccrc.env` line that nothing on Linux ever read before (an old mirror line, an `export` form, a stray `CCRC_UPDATE_HEALTH_S=0`) starts to count at the move's most fragile point. D-6600's step 0 counts, by name only, which of the seven each box's file names before the move.
- Every run after the move reads all seven through the reader. The soak's order depends on this (D-6600).

**Landing order, as dependencies:**
- Task 1 depends on nothing.
- Tasks 2, 3 and 4 need Task 1's reader. They are independent of each other but share `ccd/ccrc`, so they run in order.
- Task 5 (the guard) needs Tasks 1 to 4, because its C3 reds until no setting is expanded outside the reader.
- Task 6 (the doctor check) needs Task 1.
- Task 7 is the gate and the PR.

One PR, from this workspace's own branch.

## Not in this wave

- **The ccd-* sibling scripts' own knobs.** They are separate scripts that never source ccd/ccrc, so sharing the one reader means a shared library file: a new placement in the install census and its own wave. They are two kinds, and the first kind is squarely inside the directive:
  - **operator settings, read by ccd scripts** under timers with no shell and no `EnvironmentFile=`, so today they survive a reboot only through the user manager's environment (the directive's own complaint): `CCRC_KEEPALIVE_MODEL` and `CCRC_KEEPALIVE_PROMPT` (ccd/ccd-telemetry-keepalive:126-127, which pick the keepalive's model and prompt), `CCRC_USAGE_SWEEP_DAYS` (ccd/ccd-usage-sweep:21) and `CCRC_GRAPH_BUDGET`, `CCRC_GRAPH_MAX_WORKERS` (ccd/ccd-graph-sweep:18-19). README documents them as operator knobs (README.md:2798, :2958, :5664);
  - **call bounds**: `ccd/ccd-update-sync`'s `CCRC_UPDATE_SYNC_TIMEOUT`, `CCRC_POOL_SYNC_TIMEOUT`, and the account-health bounds.

  Not in this wave, because the reader would have to move into a placed library first. Reading 9 puts it to the coordinator, and the PR body and the wave-done ask for a ledger row naming each operator setting above (a later wave, or this one through a shared reader file if the coordinator rules so).
- **Other executables ccrc ships or runs, outside the census's two files** (D-6598 states the scope):
  - `deploy/verify-provenance.mjs:100` reads `process.env.CCRC_SIGSTORE_TRUSTED_ROOT`, spawned by `ccrc update`. **Environment-only for good:** a line in a file must never choose the provenance trust root. Nothing here documents it as a `ccrc.env` line, and C6 reds if the example ever does (it is added to C6's list by name).
  - `ccd/ccgpt-runtime:554-555` reads `CCRC_RUNTIME_PIP_S` and `CCRC_RUNTIME_PROBE_S` (built by `ccrc update`): call bounds.
  - `ccd/ccrc-models-probe:175` reads `CCRC_CODEX_PYTHON` (a fixture path) and :363 `CCRC_MODELS_PROBE_FIXTURE` (a fixture path).
  - `ccd/ccrc-codex:138` reads `CCRC_UPSTREAM` (a fixture path, the lane's upstream in tests).
  - A later wave that adds an operator-facing `process.env.CCRC_X` to a `deploy/*.mjs` helper is not seen by this census. Extending C5 and C6 to every helper `ccrc` invokes is carried with the sibling scripts (Reading 9).
- **`ccd/ccd`'s `CCRC_*` reads.** ccd is the session daemon, not ccrc, and its platform block is mirrored and stamped (`macos-platform.test.ts:60`). Not scanned.
- **deploy.sh's own `CCRC_BACKUP_KEEP` prune** (`prune_backups`, deploy/deploy.sh:241) and **deploy.env's precedence** (`cmd_rollout`, ccd/ccrc:23155-23161, and deploy/deploy.sh:31-33 source `deploy.env` after the environment, so a file assignment beats an exported value). It is a different file, on the deploying machine, read by the fallback path. `agent/test/deploy-verify.test.ts` is run, never edited.
- **A range for `CCRC_UPDATE_HEALTH_S`** (it accepts 0 and has no ceiling, `_upd_gate` :21252-21256). Tests set it to 0 through the environment (`updateEnv`, ccrc-update.test.ts:713; update-watchdog-revert.test.ts:293), and a ceiling changes behaviour nobody asked for. The watchdog's `TimeoutStartSec=1800` and the control plane's deadline bound it from outside. Reading 6.
- **The model's bare-CR rule** (carried item 4, first half). `_box_env_unit_whole` (ccd/ccrc:3319) refuses a file with a CR inside a line, where systemd would split the line there. The rule errs toward refusing, never toward a wrong value. Changing it moves `_box_unit_env`'s answers for install's gate line and doctor's auth check, which the U2, U3 and U3l tables pin (ccrc-doctor.test.ts:5354-5542). It is its own wave.
- **R7, the model's quadratic cost on a long knob-bearing line** (carried item 5). It is cost, not correctness. It needs a long line in an operator-owned file that names that very setting, and it predates the wave. Task 7 measures it once and reports; nothing is changed.
- ~~The control plane's hard cap~~ — **moved into this wave (D-6601).** Revision 1 argued it out because the watchdog records a live holder as wedged past twice the deadline. That was wrong: the watchdog's age is measured from the report's LAST write (`cmd_watchdog`, ccd/ccrc:19487, :19549), so it bounds nothing about how long the update ran before the re-stamp, and an update that writes a phase within each deadline can reach the re-stamp past three of them. The bash does know a start no earlier than the server's, less the spawn: its own report's `startedAt` (`UPD_REPORT_STARTED`, ccd/ccrc:2242, set at the first `_upd_phase`, :19902).
- **A read-only verb or flag that prints the resolved settings** (`ccrc config`, `ccrc backup --dry-run`). Either would move the verb pins (ccrc-cli.test.ts:228, install-census.test.ts:2028) and cost growth. The doctor check is the read-only door (D-6599).
- **The first-write template** (`_inst_env`, ccd/ccrc:14029-14038) gains no lines: the example documents the settings, and ccrc never writes `ccrc.env` after install.
- **The macOS server job exec'ing the server entry even for `INST_ROLE=fleet`** (`_inst_plist_server`, ccd/ccrc:15931-15934, `role_unit` chosen at :15972-15973). The census scout flagged it, unconfirmed and outside this wave's subject. Reported to the coordinator in the wave-done, never fixed here.
- **The server's parse of `CCRC_UPDATE_DEADLINE_MS`** (`Number(v)`, `isSafeInteger && > 0`, server/src/config.ts:446, :492) is not changed. D-6591 makes the bash safe against every spelling the server reads differently.

## Global Constraints

- **Files:**
  - Source: `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `deploy/ccrc.env.example`, `README.md`, and one line of `docs/superpowers/plans/2026-10-22-centralised-update-w23-backup-retention.md` (carried item 6).
  - Tests:
    - `server/test/ccrc-update.test.ts`;
    - `server/test/updateIntentFixtures.ts`, `nodeEnv`'s scrub list only (:33-34): it scrubs three of the seven today, and its users (`ccrc-doctor.test.ts`, `update-intent-cross-side.test.ts`, `update-projection.test.ts`) spawn real `ccrc`, so the missing four join it;
    - `server/test/ccrc-uninstall.test.ts`;
    - `server/test/ccrc-versions-warn-arms.test.ts`;
    - `server/test/ccrc-models-advance.test.ts`;
    - `server/test/ccrc-doctor.test.ts`;
    - `server/test/ccrc-settings-census.test.ts` (new);
    - `server/test/ccrc-install.test.ts`, its scrub list only (:765), and only if a name of D-6588's seven is absent there.
  - This plan.
  - `ccd/ccd` is NOT touched, so there is no restamp. `ccd/ccrc` is hand-written and unstamped (ccd/ccrc:63-67). Nothing in the platform block (ccd/ccrc:77-1308) is edited.
- **Functions this wave edits** (the consent list, by file):
  - `ccd/ccrc`:
    - new `CCRC_SETTINGS`, `_ccrc_knob` and `_keep_knob`, placed immediately above `_upd_deadline_ms`'s header (:19276);
    - `_upd_deadline_ms` (:19288) and its header (:19276-19287);
    - `cmd_watchdog`'s deadline line (:19485);
    - `cmd_update`'s re-stamp line (:18661), in place: its inline re-stamp becomes a call of the new `_bak_restamp` (D-6601);
    - `cmd_rollback`: its flip arm gains one `_bak_restamp` line before `_bak_gc rollback` (:19178), and its `_upd_asset_listed` case (:19085-19092) gains a `3)` arm (D-6594);
    - new `_bak_restamp`, placed immediately above `_bak_gc`'s header (:23803);
    - `_upd_release_base` (:20513);
    - `_upd_resolve`'s base line (:20584);
    - `_upd_asset_listed` (:21590; its base use at :21615);
    - `_upd_gate` (:21250);
    - `_bak_prune` (:23576) and its header (:23563-23575);
    - `_bak_keepset` (:23633) and its header (:23615-23632);
    - `_bak_data_keep` (:23714) and its header (:23686-23713);
    - `_bak_snap_class`: its out-param reset (:23771) and its pre-filter loop's body (:23773), each in place, and its header (:23757-23768). The loop's `for n in …` line (:23772) is not edited (delegation-wave3's pin);
    - `_bak_gc` (:23831) and its header (:23803-23830);
    - `_ver_gc` (:24144-24156);
    - `cmd_versions` (:24249; the edits at :24250, :24263-24271, :24301 and :24340);
    - `_models_advance_budget_secs` (:11203, in place: one line for one line);
    - the `usage()` heredoc's `update` paragraph (:2498-2503) and `backup` lines (:2585, :2589), in place.

    None of these is in run 722's only `ccd/ccrc` hunk (`@@ -423,7 +423,7 @@`, the one-line `_plat_workdirid_pane` beside `_plat_epoch_ms` at :426, inside the platform block). Every function above sits below :426 and outside the platform block.
  - `ccd/ccrc-doctor-checks`: the `disk` entry of `CCRC_DOCTOR_CHECKS` (:198), in place, and a new `_check_box-settings` appended at the end of the file.
- **Claims, in groups, each taken all-or-nothing when its group frees.** Re-read the live claims before each group with `ccrc-api claims list --project ccrc-pwa` (a read).
  - Group A, Tasks 1 to 4: `ccd/ccrc`, `server/test/ccrc-update.test.ts`, `server/test/ccrc-uninstall.test.ts`, `server/test/ccrc-versions-warn-arms.test.ts`, `server/test/ccrc-models-advance.test.ts`, `server/test/updateIntentFixtures.ts`, and `server/test/ccrc-install.test.ts` if its scrub list is edited. `updateIntentFixtures.ts` is a fixture wave 28 (run 856) may hold: if its claims name it, this group waits as below.
  - Group B, Task 5: `deploy/ccrc.env.example`, `server/test/ccrc-settings-census.test.ts`, `README.md`, and the wave-23 plan file.
  - Group C, Task 6: `ccd/ccrc-doctor-checks`, `server/test/ccrc-doctor.test.ts`.

  If a live claim covers `ccd/ccrc` (run 722's, path identity wave 3, PR #1132) or `README.md` (another wave's), the group waits for that claim to end, or for that run's consent through the coordinator. The function list above is what the coordinator asks consent for. Wave 28 (run 856) edits tests in `agent/test` and `server/test` for the update spawner; if its claims name any file above, the same rule applies.
- **The growth cap is armed** (`server/test/growth-check.test.ts:53`, `GROWTH_LIMIT = 40` in server/test/growthCheck.ts:46; the base is the merge-base with `origin/main`, so wave 23's +38 does not carry over).
  - `ccd/ccrc` may grow by at most 40 net code lines. Bash `#` comment lines and blank lines are not counted; heredoc lines are.
  - This plan's estimate is about +24 (revision 1's +13, plus +11 from the review):
    - `CCRC_SETTINGS` +1, `_ccrc_knob` +15 (the named-empty word, D-6587), `_keep_knob` +7 (its unmeasured line and `KEEP_FROM`, D-6589);
    - `_bak_data_keep` −10 (13 code lines become 3);
    - `_bak_prune` 0, `_bak_gc` −1 (the hard-cap term, D-6601), `_bak_keepset` +1, `_bak_snap_class` 0 (in place);
    - `_bak_restamp` +3, `cmd_update`'s line 0 (in place), `cmd_rollback` +2 (its re-stamp line and the `3)` arm);
    - `_ver_gc` 0, `cmd_versions` 0 (in place);
    - `_upd_gate` +1, `_upd_deadline_ms` +3 (`max` and the named-empty contribution, D-6602), the watchdog line 0;
    - `_upd_release_base` +1, `_upd_asset_listed` +1;
    - `_models_advance_budget_secs` 0, usage 0.
  - Measure it with `GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts` after each task.
  - The stop line is 39: 40 less run 722's +1, which lands on whichever branch lands second. Re-measure after the absorb.
  - No waiver is planned. If the measured count passes 39, stop and report to the coordinator. The open route is the reviewed waiver ledger (`server/test/growth-waivers.json`, D-6223), as its own small commit, with one of the worker's reserve numbers defined in this plan.
  - `ccd/ccrc-doctor-checks`, the example and the tests are not growth files.
- **Citation debt (session-hook.test.ts:7682, map entry `'ccd/ccrc': 5`).** The net line count of `ccd/ccrc` ABOVE base line 11635 must not change.
  - The only edits above it are in place: the usage rewrap (six lines for six, Task 5 Step 3), the two backup usage lines, and `_models_advance_budget_secs`'s one line (:11203).
  - Every new function sits at :19276 or below.
  - Verify with `git diff -U0 origin/main -- ccd/ccrc | grep '^@@'`: every hunk above 11635 has equal old and new counts. Then run session-hook.test.ts `-t 'CITATION DEBT'`.
  - README carries no `ccd/ccrc:NNN` citation, and none may be added.
- **No numeric citation in any added code or test line** (citations.test.ts, `BASELINE = 1584`). No line this wave adds to `ccd/ccrc`, `ccd/ccrc-doctor-checks` or any `server/test/*.ts` file may carry `<file>:NNN`. Cite a function, a `file#symbol` or a describe name. This plan's anchors are for reading, never for copying into a comment. Run `citations` after each task.
- **Pins this wave must keep green as they are:**
  - The path pin (ccrc-install.test.ts:2044, `'install writes the file status and doctor read — through BOX_ENV_FILE'`, :2056). The only non-`#` line of `ccd/ccrc` that names `.ccrc/ccrc.env` stays `BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"` (:1690). Usage lines and messages say "the box's ccrc.env".
  - The two-argument `_box_env_value` stays self-contained and unchanged. It is sliced out and run alone by history-lib.test.ts:325 (O53), deploy-env-guard.test.ts:256 and ccrc-doctor.test.ts:5354 (U1). `_box_unit_env`, `_box_unit_env_shell`, `_box_env_has_nul` and `_box_env_unit_whole` are not edited either (U2 to U4p, U4n).
  - `_bak_snap_class "$d"` appears exactly once (ccrc-update.test.ts:13131, in the row at :13120), and no bare `[ -f "$d/coord.db" ]` appears (:13130); `[ "$d" = "$BAK_KEEP_` appears 3 times, all in `_bak_removable` (:13145). `_bak_keepset`'s new line calls nothing but `date`. The pre-filter's cost word (D-6592) is set inside `_bak_snap_class`'s existing loop body, never by a second test of a member's name.
  - W23-B15 (ccrc-update.test.ts:14132) and the report-sequence rows at :4107 and :4211: `cmd_update`'s re-stamp detail stays exactly `pruning and thinning ~/ccrc-backups` through `_bak_restamp`.
  - delegation-wave3.integration.test.ts:1461: the only code line naming `delegation-events.log` stays `_bak_snap_class`'s pre-filter loop.
  - The release-source pair pin in ccrc-update.test.ts (the describe that holds `install.sh`'s owner and repo equal to ccd/ccrc's). `_upd_release_base`'s default stays the literal `https://github.com/$CCRC_RELEASE_OWNER/$CCRC_RELEASE_REPO/releases`. Find the pin with `git grep -n 'CCRC_RELEASE_OWNER' -- server/test` and re-read it before Task 4.
  - `BUDGET_OFF_LINE` (ccrc-models-advance.test.ts:291), the invalid-budget sentence, is unchanged.
  - The doctor table and function census (ccrc-doctor.test.ts:1580, :1695): one table entry and one `_check_box-settings`, added together. The table comment's rule, "every line below is cited by number elsewhere", is why the entry joins the `disk` line in place.
  - The usage phrases other suites pin survive whole: in the `backup` paragraph, `coordination-snapshot.json`, `delegation journal and checkpoint` and `(never ~/.ccrc/collect-lane-generation.log: a restore leaves it in place)`.
  - agent/test/deploy-verify.test.ts:1636 reads seven keys out of the example by `toContain`, so it holds as lines are added.
  - `deploy/ccrc.env.example:19` is `CCRC_FLEET=local`, and server/test/lifecycle.test.ts:405 cites it by number. No citations ratchet counts `.example` files, so nothing reds if it moves: the header's rewrap keeps its four lines (Task 5 Step 3.1), measured with `sed -n 19p deploy/ccrc.env.example` before and after.
  - W23-B20 (ccrc-update.test.ts:14170): with no exposure file and no deadline line, the bound is still the re-stamp's `updatedAt` plus 900, less 235.
- **Pins this wave changes on purpose** (D-6590). Every W23 row that asserts `— nothing pruned or thinned` or `— nothing was pruned or thinned` for a `CCRC_BACKUP_DATA_KEEP` refusal is rewritten in place. Which rewrite a row gets depends on whether its fault is a LINE or the WHOLE FILE:
  - **A line fault** (the file is readable, holds no NUL byte, and only `CCRC_BACKUP_DATA_KEEP` is refused): the line becomes `— nothing thinned` (from `_bak_gc`) or `— nothing was thinned` (from `_bak_prune`); where the row asserted every dir left, it asserts the count prune's result at that row's `CCRC_BACKUP_KEEP`. Known: W23-B3 (:13880), W23-B12's backup half (:14081), the B17 line-shape rows (:14213, the export, spaced and vertical-tab shapes), and the B17 Darwin twin (:14422). That twin's `pruneTwelve` passes `CCRC_BACKUP_KEEP: '10'` in the environment (:14411), so after this wave it prunes the two oldest of its twelve, prints only the `CCRC_BACKUP_DATA_KEEP … — nothing thinned` WARN, and answers `rc 1`.
  - **A whole-file fault** (the four B18 rows: mode 000 at :14431; a dangling link, a directory and a FIFO at :14453). The file is unreadable for EVERY key, and their `sourced(…)` passes no `CCRC_BACKUP_KEEP` (`updateEnv` deletes it), so both keeps refuse. Their new assertions: both WARN lines, `update: backups: WARN: CCRC_BACKUP_KEEP cannot be measured: ~/.ccrc/ccrc.env is there but cannot be read — nothing pruned` and `update: backups: WARN: CCRC_BACKUP_DATA_KEEP cannot be measured: ~/.ccrc/ccrc.env is there but cannot be read — nothing thinned`; `rc 1`; every dir byte-identical (`fingerprint`); and no `~/.ccrc/update.lock` created by the call. Never "the count prune's result": no count prune runs.
  - Find the rest with `git grep -n 'pruned or thinned' -- server/test`, and classify each by the same test.
  - The rollback-by-flip report-sequence rows: after D-6601 a completed flip writes one more `restarting` report (detail `pruning ~/ccrc-backups`) between the sweep and `done`. Find them with `git grep -n -E 'rolled back by flip|reportWrites' -- server/test/ccrc-update.test.ts server/test/update-watchdog-revert.test.ts`; each that pins the sequence gains that write.
  - The as-built note lists every row so changed, old and new assertion.
- **Fixture HOMEs only.** Every `ccrc` spawn and every sourced function runs under a `mkdtemp` HOME, quoted. Never run `ccrc` or `ccd` against the live HOME. Never touch tmux, `systemctl --user` on the live manager, `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or `~/.cc-secrets`. Never run `ccrc update`, `rollback`, `rollout`, `backup`, `versions --prune`, `doctor` or `install` outside a fixture. Never print the live user manager's environment.
- **Hermetic env.** Each of D-6588's seven joins every inherited-env scrub list where it is absent: `updateEnv` (ccrc-update.test.ts:707-708), ccrc-uninstall.test.ts's harness (:148-149), ccrc-install.test.ts (:765), `nodeEnv` (server/test/updateIntentFixtures.ts:33-34, which lacks `CCRC_BACKUP_KEEP`, `CCRC_BACKUP_DATA_KEEP`, `CCRC_VERSIONS_KEEP` and `CCRC_MODELS_ADVANCE_BUDGET_S`; claim group A) and ccrc-models-advance.test.ts (:146). Every `env -i` row spells its list as `env -i HOME=<home> PATH=<the row's PATH> TMPDIR=<home>/tmp`, plus whatever the row's shims need and never a `CCRC_` name, so `ccrc backup`'s temporary files stay inside the fixture. A shell that exports one cannot move a row. Fixture HOMEs whose `ccrc.env` holds only `CCRC_ROLE=…` read every setting as its default, so their rows do not move.
- **Memory and vitest.** Before any vitest run, read `anon` in the session slice's `memory.stat`, and run nothing while it reads above the programme's gate.
  - Run ONE file at a time, in the foreground, from inside `server/`: `./node_modules/.bin/vitest run test/<one>.test.ts --pool=forks --maxWorkers=1`, with `-t '<case>'` where a row names one case.
  - Use a short real TMPDIR (`mkdir -p ~/.cc-tmp/w24`) and wrap the call in `timeout -s INT 560`. Never use bare `npx vitest`.
  - `bash -n` and one-off scripts that source `ccd/ccrc` into a fixture HOME are cheap and preferred.
- **Disk.** Every fixture is kilobytes. Task 7's one-off R7 timing uses a 64 KiB file.
- **The absorb step.** Before each task's first edit, run `git fetch origin main`, and re-read in the landed text every anchor this task names.
  - Before the first push, rebase the local commits onto `origin/main`.
  - After the first push, merge `origin/main`. Never rebase or force-push a published branch.
  - Check whether a PR has landed with `gh pr view <n> --json state,mergeCommit`, never by sha ancestry.
  - Land through the merge queue: `gh pr merge <n> --match-head-commit <sha>`.
- **Public repo:** commits use the noreply identity. No hosts, IPs, home paths, lane, account or session names in code, comments, commits, the example or the PR body. Write `<home>`, "the server box" and "the fleet box". Fixture unit ids are `acct-a-demo` and `acct-b-demo`; a fixture mirror is `127.0.0.1` or `mirror.example`.
- **Routing.** Execute natively, inside the subscription, with no handoff. Pass the model explicitly on every subagent:
  - implementer subagents run on `sonnet`, one per task;
  - the per-task reviewer and the whole-branch reviewer run on `opus`;
  - scouts and transcription-grade edits run on `haiku`.

  The orchestrator reviews every diff. The wave-done fingerprint is this workspace branch's tip. The `suite:` line is one word.

## Review Focus

- **A setting named in `ccrc.env` in a shape the reader refuses, while the environment also sets it.** The environment wins, so the file's line is never consulted, until the environment goes (the soak's fragment). The doctor check reads the file alone and WARNs on it (Task 6's S3 runs with the environment set too).
- **A `ccrc.env` that no reader can scan** (a NUL byte, mode 000). Every act that reads a setting from it refuses in its own way, and each line says why. None reads a default silently (Task 1's R4 runs all seven). A whole-file fault refuses both keeps at once, so `_bak_gc` returns before the lock and `ccrc backup` exits 1 with both lines (Task 2's B6).
- **macOS.** Only `CCRC_BACKUP_DATA_KEEP` keeps wave 23's "always ask the model" (D-6587). Every other setting is read by the Linux rule, so a knob-less line the Darwin model rejects (`CCRC_PROJECTS_ROOT=~/code`) no longer stops an update (Task 1's R8, Task 4's U4). **Amended on the final review (ruling 16):** a comment line (first non-blank `#` or `;`, no CR inside it) no longer names a setting on either platform, so a copy of `deploy/ccrc.env.example`, whose `# KEY=` lines mention all seven (D-6597), plus one such odd line reads every default too, the data keep's macOS departure aside (Task 1's R12 to R14, D-6604).
- **Two sides of one deadline.** The thinning bound takes the smallest reading the server may hold, a named-empty line counted as the server's 900000 (D-6591); the watchdog's thresholds take the largest (D-6602).
- **A deadline set only in the exposure file, smaller than `ccrc.env`'s.** The server takes it, so the thinning bound must too (Task 3's D2, D3).
- **A rollback on a box with an invalid `CCRC_BACKUP_DATA_KEEP`.** A rollback never thins, so it must still prune by count and never name the data knob (Task 2's B3).
- **The process shapes that carry no setting** (a detached run, a timer, an ssh rollout). Under `env -i` with only HOME and PATH, each act reads `ccrc.env` (Task 2's P1 to P3, Task 3's D1 and H1, Task 4's U1 and M1). The units' own lines carry no `CCRC_` setting (Task 2's P5).
- **A second reader.** C8 (Task 5) reds on a non-array `${!name}` indirection or the whole-token awk program outside `_ccrc_knob`, on a variable key passed to `_box_env_value`/`_box_unit_env`/`_box_unit_env_shell` outside an enumerated set of bodies, on a literal key passed to them outside the server's settings, and on a code line that names a setting beside `BOX_ENV_FILE` or an awk, sed, grep or cut command. `eval` stays a residual: outside `_upd_validate_timeout` and `_acct_deadline` (which C5 reads by name) the base has none, and a reviewer should grep `eval` in the diff.
- **Time.** A rollback by flip, the watchdog's included, is now bounded like an update (D-6601), and the bound also stays inside the control plane's hard cap (D-6601). The keep-set's gate counts only verifications of a data set (D-6592), so a fleet box whose backups hold none is never stopped by it.

## Risk notes

- **Precedence differs from systemd's, by the directive.** The server reads its files over the user manager's environment (`EnvironmentFile=` lines override what the manager passes). ccrc reads a set environment over the file. That matters only for a setting both read, and only `CCRC_UPDATE_DEADLINE_MS` is one. D-6591's `min` makes the thinning bound the smallest of every reading the server might take. The watchdog DOES act on a live updater (past twice its deadline it writes `failed … wedged` over the holder's report, `cmd_watchdog`, ccd/ccrc:19549-19551), so it takes the largest decided reading (D-6602): it never calls a live update wedged sooner than any deadline the server may hold. Residual: a non-canonical spelling the server reads as larger than every decided reading (`2e6`) can still make the watchdog judge early; its WARN line names the setting, and doctor's `box-settings` names the line.
- **macOS keeps one refusal wave 23 ratified.** On Darwin a file the model cannot decide (any line not shell-plain) still refuses `CCRC_BACKUP_DATA_KEEP` whatever the scan says, so such a file stops the thinning there, never the count prune or an update. For every other setting, a Darwin file that names the setting AND holds such a line refuses that setting (the Darwin model refuses the whole file, `_box_unit_env_shell`, ccd/ccrc:3468-3482): `CCRC_RELEASE_BASE_URL` named beside `X=~/a` stops the update there, by D-6594 (Task 4's U4 second case).
- **An interactive `ccrc update` with a deadline in the shell but not in the manager.** The server reads the manager's (or the file's), which the shell's process cannot see. An interactive update holds no lease, so the server's deadline does not apply to it ("CLI and rollout updates take the same bound as a console update: one path, and harmless where there is no lease", wave 23's D-6464).
- **`${!key:-}` on macOS's /bin/bash 3.2.** The reader takes the environment by indirection. The Darwin rows (Task 1's R8) run on `test-macos`, which is advisory. If indirection with an operator fails there, the worker uses `_upd_validate_timeout`'s `eval "v=\"\${$key:-}\""` form, with `$key` checked against `CCRC_SETTINGS` first, and records it.
- **Cost.** Each read forks one awk (the whole-token scan), plus the model only when the file names that setting (and, on macOS, always for `CCRC_BACKUP_DATA_KEEP`). A `ccrc update` makes about ten reads. That is milliseconds, and suites that spawn `ccrc update` thousands of times pay it too.
- **A refused setting is louder than before in one place.** `ccrc backup` and an update now prune by count beside a refused data knob, and say both. The disk the wave-23 directive was about stays bounded by the count.
- **The installing update** reads its keeps the old way, but its arm-2 restore child and the watchdog's next tick run the new reader (Deploy class). D-6600's step 0 counts what each box's file names before the move.
- **A refused setting's WARN, where a whole file is at fault, appears once per setting.** A mode-000 `ccrc.env` makes an update print a refusal for each setting it reaches (the release base first, which stops it). That is louder than the base, which read none of them, and it is what "unmeasured is not unset" asks.

## Where each setting is read, and by which process

| Process | Its environment | Reads `ccrc.env` through `_ccrc_knob` after this wave? | The row that proves precedence |
|---|---|---|---|
| Interactive `ccrc update`, `rollback`, `backup`, `versions`, `models refresh` | the login shell | yes, in process | Task 1's R1 (environment over file over default), Task 2's B1-B5 |
| `ccrc rollout`'s pin (`cmd_rollout` → `_upd_resolve`, ccd/ccrc:23203), on the deploying machine | the operator's shell there | yes: the deploying machine's own `CCRC_RELEASE_BASE_URL` (its environment, else its `~/.ccrc/ccrc.env` when it is a box, else the default). An unreadable line stops the rollout at step 2, exit 2, before any box is touched | Task 4's U2 (`_upd_resolve`'s refusal), and U5 when the rollout harness reaches step 2 |
| `ccrc rollout` → `ssh <box> ccrc update --to …` (`cmd_rollout`) | the remote non-interactive shell (no setting) | yes, the remote box's file | Task 2's P1-P3 (`env -i`, the same shape) |
| Server-role console update (`localUpdateSpawnFor`, server/src/update/converge.ts:51; `boundedUpdateSpawn`, spawn.ts:42) → `_upd_detach` → `systemd-run --user --collect` | the user manager's; the `--detach` parent's `ccrc.service` environment does not reach the run (its argv is the contract, ccd/ccrc:19825) | yes, for the run that gates, prunes and thins | P1-P3, D1, H1; P5 pins that `_upd_detach`'s argv passes no `CCRC_` setting |
| Fleet-role console update (agent `makeUpdateSpawn`, agent/src/server.ts:404, :494) | the same handoff; agent.env holds no setting | yes | as above |
| Watchdog (ccrc-update-watchdog.service:28) → `ccrc rollback --from watchdog` (ccd/ccrc:19757) | the user manager's, no `EnvironmentFile=` | yes: the deadline (`max`, D-6602), the gate window, `CCRC_BACKUP_KEEP`, and for a rollback by flip the keep-set's bound (`min`, D-6601) | D1 (`_upd_deadline_ms` under `env -i`), D4, D5, B3, K5; P5 pins the unit's lines |
| ccrc-models.service (`ccrc models refresh --all`) | `Environment=PATH=` only | yes: `CCRC_MODELS_ADVANCE_BUDGET_S` | Task 4's M1; P5 pins the unit's lines |
| `ccrc install` (`_ver_gc install auto`, :15039) | the installing shell | yes | Task 2's P4 |
| macOS server job (`_inst_plist_server`) | sources `ccrc.env` and the exposure file into node | n/a: node is not ccrc. A ccrc it spawns gets the file's values as its environment, the same values. `--detach` is refused on macOS | none needed |
| `ccrc doctor`'s `box-settings` | the shell | the file ALONE, every setting | Task 6's S1-S4 |
| ccd-update-sync, claude-session@, the ccd sweeps | the user manager's | no: they run no ccrc act (Not in this wave) | — |
| deploy.sh | the deploying machine's | no (Not in this wave) | — |

## Deviations found

These twenty numbers, starting at D-6587, were issued to run 855. This revision defines sixteen, D-6587 to D-6602 (revision 2 added D-6601 and D-6602 and amended D-6587, D-6589 to D-6592, D-6594, D-6596, D-6598 and D-6600 in place). The block's last four are the worker's reserve: D-6603 and D-6604 are the worker's, spent (Task 3 Step 0; ruling 16) and defined below; D-6605 was spent by fix round 1 on review 891's F12 (defined below); D-6606 is unspent (defined below as unspent). The coordinator's rulings on review 891 (2026-10-24, below) issued eight more numbers, D-6744 to D-6751: D-6744 to D-6749 are defined by those rulings (below), and D-6750 and D-6751 are the round's reserve, unspent.

- **D-6587.** **ccrc has ONE reader for its own settings, `_ccrc_knob <KEY> <default> [file]`, generalised from wave 23's `_bak_data_keep`.** Beside it sits **`CCRC_SETTINGS`**, the one list of the names it reads. Both live in `ccd/ccrc` above `_upd_deadline_ms`.
  - **Precedence.**
    - A non-empty value in the process environment wins, taken by indirection. An exported empty value counts as unset.
    - Else `ccrc.env`'s value, read exactly as `_bak_data_keep` read its knob at the base:
      - the whole-token awk scan, with `-v k="$key"`;
      - `_box_env_has_nul` first;
      - the model `_box_unit_env "$key"` with `CCRC_EXPOSURE_FILE="$f/."` beside the call, asked when the scan answers 1 (the file names the key), on both platforms. **Amended on the final review (ruling 16):** a comment line (its first non-blank character `#` or `;`, no CR inside it) does not count as naming the key, so a file that mentions the key only in such lines answers 4 and reads `<default>`; a comment line with a CR inside it still counts, as the scan never skips it. **One exception, wave 23's ratified departure 1, kept for its one knob:** for `CCRC_BACKUP_DATA_KEEP` alone, on macOS, the model is also asked when the scan answers 4. The test is a literal in `_ccrc_knob` (`[ "$key" = CCRC_BACKUP_DATA_KEEP ]`), beside the `CCD_OS` test, never a parameter a caller passes.
    - **Why the Linux rule serves every other setting on macOS too.** Wave 23 asked the model on Darwin whatever the scan said because the launchd job sources the file with bash, which can build a name without spelling it. But a ccrc NOT started by that job never receives the job's bash reading of the file, and a ccrc started BY it already has that reading as its environment, which wins. So for a ccrc read, a file that never spells the key cannot set it on either platform. Keeping "always ask" for all seven would make any knob-less line `_box_env_shell_plain` rejects (`CCRC_PROJECTS_ROOT=~/code`, a CRLF file, `"…$…"`) refuse every setting at once on macOS, and so stop every update there through D-6594, where the base updated and pruned. The same argument applies to `CCRC_BACKUP_DATA_KEEP`; its departure is kept because the coordinator ratified it after review, and Reading 10 asks whether to retire it.
    - Else `<default>`. An empty value (the environment's or the file's) reads the default. The file's empty line is reported apart: `KNOB_FROM=empty` (below), because for the server a named-empty line is not "unset" (D-6591).
  - **`file` mode** (third argument `file`): the environment is not read. The doctor check (D-6599) and the deadline's `min` (D-6591) use it.
  - **Which file.** It reads `$BOX_ENV_FILE`. A caller that needs another file names it with a prefix assignment, `BOX_ENV_FILE="$f" _ccrc_knob …`, which bash keeps for the call alone. That is wave 23's `CCRC_EXPOSURE_FILE="$f/."` idiom. Only D-6591 does this, for the exposure file.
  - **Known names only.** A `<KEY>` not in `CCRC_SETTINGS` answers rc 1 with `KNOB_WHY="<KEY> is not one of ccrc's settings (CCRC_SETTINGS), so it is never read from a file"`, before anything is read. This is the mechanism behind the census's name-clash rule: `ccrc.env`'s `CCRC_ACCOUNTS` is the server's roster path, while ccrc's `CCRC_ACCOUNTS` is the `accounts.sh` array (ccd/ccrc:6696). No call can take the one for the other.
  - **The answers** (out-params, never stdout; it never dies and never prints):
    - rc 0: `KNOB` holds the value, as a string, unvalidated. `KNOB_FROM` is `environment`, `file`, `empty` (the file names the key with an empty value, `BUE_NAMED=1` with `BUE_VAL=""`; `KNOB` is the default) or `default`. `KNOB_WHY` is empty.
    - rc 1, unmeasured or an unknown name: `KNOB` and `KNOB_FROM` are empty. `KNOB_WHY` is `<KEY> cannot be measured: <why>`, with `$HOME` written as `~`. The `<why>` clauses are `_bak_data_keep`'s, word for word: "names it on a line this reader does not take (it reads only a plain KEY=value line)", "is there but cannot be read", "could not be scanned", and the model's `BUE_WHY`. So wave 23's B17 and B18 strings hold with the knob's name in them.
    - Validation is the caller's (`_keep_knob`, or the act's own parse).
  - **Why one reader and not a copy per knob:** this repo's single-definition rule. Wave 23's reader is the one the coordinator ruled correct after five review rounds (systemd fuzzing included), so the generalisation changes its input name and nothing in its logic.
  - **Why not let the operating system read it** (`EnvironmentFile=` on the timers, `systemd-run --property=EnvironmentFile=`): it exports `ccrc.env`'s secrets into every child, which `_box_env_value`'s header forbids. It inverts the directive's precedence, since the file becomes the environment. And it misses the ssh rollout and the interactive shell.
  - **The exposure file** (carried item 4, second half): no setting is read from it, except the deadline's `min` and `max`, because the server's deadline can come from it (D-6591, D-6602). No process that acts on any other setting receives it on Linux, and on macOS no console-driven update runs under the job that sources it.
  - **A whole-file fault refuses every setting.** An unreadable file (mode 000, a dangling link, a directory, a FIFO) answers "is there but cannot be read", and a NUL byte "could not be scanned", for every key, before any scan of a key. Only a LINE fault is per-key (D-6590).
- **D-6588.** **ccrc's settings, the operator-facing names, are seven:** `CCRC_BACKUP_KEEP`, `CCRC_BACKUP_DATA_KEEP`, `CCRC_VERSIONS_KEEP`, `CCRC_UPDATE_HEALTH_S`, `CCRC_UPDATE_DEADLINE_MS`, `CCRC_RELEASE_BASE_URL` and `CCRC_MODELS_ADVANCE_BUDGET_S`.
  - The rule: a setting is a value that decides what ccrc keeps or removes, how long it waits before judging an update, where it fetches a release from, or whether a step runs at all. An operator sets it once for the box, and an act run with no operator's shell (a console update, the watchdog, a timer) must honour it.
  - The other 42 names read from the environment are six reasoned classes, kept environment-only and listed by the census (Task 5's `ENV_ONLY`):
    - **call bound** (23): a time, size or concurrency bound on one call or wait. Its own header says the override exists so a suite need not wait out a production bound, and "the DEFAULT is what an operator gets" (ccd/ccrc:2053-2059, and the release bounds' header after it). `CCRC_HEALTH_TIMEOUT`; the six `CCRC_RELEASE_*` curl bounds; `CCRC_ACCOUNT_AUTH_TIMEOUT`, `CCRC_ACCOUNT_PROBE_TIMEOUT`, `CCRC_ACCT_USAGE_WAIT_S`; `CCRC_CODEX_PROBE_S`, `CCRC_CODEX_READY_S`; `CCRC_MODELS_LOCK_S`, `CCRC_MODELS_CANARY_S`; `CCRC_BOOTOUT_WAIT_S`, `CCRC_WATCHDOG_PROBE_GAP_S`, `CCRC_SWEEP_VERIFY_JOBS`, `CCRC_VERIFY_SETTLE`, `CCRC_VERIFY_WINDOW`; and in the doctor, `CCRC_DOCTOR_GH_TIMEOUT`, `CCRC_DOCTOR_DOCS_TIMEOUT`, `CCRC_SCOPE_SWEEP_STALE_S`, `CCRC_SCOPE_SETTLE_SEC`;
    - **fixture path** (6): a path or permission a test points elsewhere. `CCRC_CADDY_SYSTEM_FILE`, `CCRC_CADDY_ROOT_CA`, `CCRC_SCOPE_SWEEP_STATE`, `CCRC_CGROUP_ROOT`, `CCRC_PROC_ROOT`, `CCRC_ALLOW_SANDBOX_LAUNCHCTL`;
    - **per run** (1): `CCRC_ADDR`, the address for one run. The box's own address is `CCRC_HOST` and `CCRC_PORT`, already read from the file;
    - **rollout** (5): `CCRC_BOX`, `CCRC_AGENT_BOX`, `CCRC_SSH_KEY`, `CCRC_SSH_PORT`, `CCRC_DEPLOY_ENV`. Coordinates on the deploying machine, in `deploy.env`;
    - **handshake** (3): `CCRC_UPDATE_LOCK_HELD`, `CCRC_UPDATE_VERIFIED`, `CCRC_UPDATE_SPINE`, passed between ccrc's own processes;
    - **constant** (4): `CCRC_EXPOSURE_FILE`, `CCRC_CADDYFILE`, `CCRC_DDNS_UNIT`, `CCRC_HERE`. Set in the file and read with a guard default, or overridden for one call.
  - The names read from `ccrc.env` or the exposure file only (`CCRC_ROLE`, `CCRC_HOST`, `CCRC_PORT`, `CCRC_FLEET`, `CCRC_AGENT_URL`, `CCRC_AGENT_TOKEN`, `CCRC_MAIL_TOKEN_PATH`, `CCRC_AUTH_SECRET_PATH`, `CCRC_SESSIONS_PATH`, `CCRC_AUTH`, `CCRC_PROJECTS_ROOT`, and the exposure keys) are **the server's settings**. ccrc reads them where the server reads them, never the environment, because a shell's value would measure something the server does not run with. They are unchanged and outside the census's environment scan.
  - Why the call bounds stay out: their purpose is a test seam, by their own text. A box that needs one changed has a fault to report, not a setting to keep. Reading 1 offers the alternative.
- **D-6589.** **`_keep_knob <KEY> <default> [<lowest>]` is the one reader and validator of a keep.** It is `_ccrc_knob`, then `_keep_ok` (ccd/ccrc:23537), then the lowest bound (default 0).
  - rc 0 sets `KEEP` to the decimal value (`0002` is 2) and `KEEP_FROM` to the phrase a prune line prints: `the environment`, `the box's ccrc.env` or `the default` (`file` → the second, `empty` and `default` → the third). rc 1 sets `KEEP_WHY` to `KNOB_WHY` when unmeasured, or to `_keep_why <KEY> <value> <lowest>` (:23538) when invalid. So the sentences are today's: `CCRC_BACKUP_KEEP='x' is not a whole number from 0 to 9999`. **Amended by D-6605 (fix round 1, F12):** an invalid value's sentence ends with the source that won, `, as set in the environment` or `, as set in the box's ccrc.env`, before each caller's tail: `CCRC_BACKUP_KEEP='x' is not a whole number from 0 to 9999, as set in the box's ccrc.env`.
  - Its first line is exactly `_ccrc_knob "$1" "$2" || { KEEP=""; KEEP_WHY="$KNOB_WHY"; return 1; }`, so an unmeasured file never reaches `_keep_why` with an empty value (which would print `CCRC_BACKUP_KEEP='' is not a whole number …` and name neither the file nor the line).
  - `CCRC_BACKUP_KEEP` (`_bak_prune`, `_bak_gc`), `CCRC_VERSIONS_KEEP` (`_ver_gc`, `cmd_versions`) and `CCRC_BACKUP_DATA_KEEP` read through it.
  - `_bak_data_keep` stays as a wrapper: `_keep_knob CCRC_BACKUP_DATA_KEEP 3 2`, then `BAK_DATA_KEEP="$KEEP"` and `BAK_DATA_KEEP_WHY="$KEEP_WHY"`, with the same rc. Its out-params are what `_bak_thin` and wave 23's rows read.
  - Why: the base spells "read the keep, validate it, make it decimal" three times (:23577-23580, :23832-23837, :24145-24152). One spelling is the rule this repo enforces.
- **D-6590.** **A keep whose LINE cannot be read, or whose value is invalid, stops only its own act; a FILE no reader can scan refuses both keeps at once** (carried item 1; amends wave 23's D-6347, "an invalid value stops the prune and the thinning alike").
  - **The line and the file.** An export line, a spaced `=`, an invalid value: only the setting that line names is refused, and every other act runs. An unreadable `ccrc.env` (mode 000, a dangling link, a directory, a FIFO) or one holding a NUL byte is refused for every key (D-6587), so both keeps refuse and both acts stop, each with its own line. On macOS, a file the Darwin model cannot decide refuses `CCRC_BACKUP_DATA_KEEP` always, and any other setting the file names. The README paragraph and the example say this in the same two sentences: "a line ccrc cannot read stops only the act that reads it; a file ccrc cannot read at all stops every act that reads a setting from it, and each says so."
  - **`_bak_gc`** (update and rollback):
    - a refused `CCRC_BACKUP_KEEP` prints `<lead>: backups: WARN: <KEEP_WHY> — nothing pruned` and skips the count prune. On an update the thinning still runs;
    - a refused `CCRC_BACKUP_DATA_KEEP` prints `<lead>: backups: WARN: <BAK_DATA_KEEP_WHY> — nothing thinned`, and the count prune still runs;
    - **a rollback never reads `CCRC_BACKUP_DATA_KEEP`**, because it never thins (wave 23's D-6355);
    - both refused, or a rollback with its keep refused, returns 1 before the lock;
    - `_bak_gc` returns 1 whenever a setting was refused, as before.
  - **`_bak_prune`** (`ccrc backup`):
    - each refusal is one stderr line in `_ccrc_die`'s form, printed before the lock: `ccrc: <KEEP_WHY> — nothing was pruned`, `ccrc: <BAK_DATA_KEEP_WHY> — nothing was thinned`;
    - the other act runs;
    - every return of the function (its early "prune skipped" returns included: the unrecorded floor, the three lock arms and the classifier arm) returns 1 when a refusal was printed, so `ccrc backup` exits 1. Both refused returns 1 at once.
    - its header (:23563-23575) is rewritten to this: it still says "prune skipped" and returns 0 where `_bak_gc` WARNs, unless a setting was refused; each refusal is one stderr line in `_ccrc_die`'s form and the other act runs; the two `_ccrc_die`s it named are gone. The header's first line keeps naming `CCRC_BACKUP_KEEP`, without the `${…:-10}` form (a comment, but C3 reads code lines only, so this is for the reader).
  - **The prune line names its source.** `_bak_gc`'s `pruned` line reads `(kept: the newest $keep timestamped backups (CCRC_BACKUP_KEEP from $ksrc), every one named at or after …`, `$ksrc` being `KEEP_FROM` captured right after the keep's own `_keep_knob` call, in place; every pin of that line matches its prefix only (`git grep -n 'backups: pruned' -- server/test`, re-checked). `_bak_prune`'s `backup: pruned …` line, which ccrc-update.test.ts:12932 pins whole, is not changed.
  - Why:
    - The count prune predates the data knob and never depended on its value. The keep-set's three keeps are chosen without it (`_bak_keepset`, :23633).
    - Stopping the count prune on the data knob's fault grows the disk, which is what wave 23 exists to bound.
    - Each act's safety rests only on its own knob: the thinning keeps the newest N verified data sets whatever the count does, and the count keeps the keep-set's keeps whatever the thinning does.
    - The refusal stays visible: its line, and rc or exit 1.
    - The safe direction is unchanged: an act that deletes never runs on a value it could not measure.
- **D-6591.** **The deadline is read through the reader, and the thinning bound takes the smallest reading** (carried items 2 and 3).
  - `_upd_deadline_ms [min|max]` prints milliseconds and answers rc 0 when decided, rc 1 when not.
  - **Plain** (the reading `min` and `max` start from): `_ccrc_knob CCRC_UPDATE_DEADLINE_MS 900000`. A reading that is not `^[1-9][0-9]{0,14}$` (the server's safe-integer range, spelled canonically) is undecided: it prints 900000 and answers rc 1. A named-empty line (`KNOB_FROM=empty`) reads 900000, decided: that is what the server takes from it.
    - A set environment value that is not canonical is now undecided. It no longer falls through to the file, as W4a's `_upd_deadline_ms` let it: a set environment wins, and a winner that cannot be read is not replaced by a loser.
  - **`min`** (`_bak_gc`'s bound, for an update and for a rollback by flip, D-6601): the smallest of three readings:
    - the plain reading;
    - `ccrc.env` alone (`_ccrc_knob … "" file`);
    - the exposure file alone (`BOX_ENV_FILE="$CCRC_EXPOSURE_FILE" _ccrc_knob … "" file`). The server's `ccrc.service` reads it after `ccrc.env`, so the server's deadline can come from it.

    **A file that names the key with an empty value contributes 900000** (`KNOB_FROM=empty`), never "absent". For the server a bare `CCRC_UPDATE_DEADLINE_MS=` line is an assignment of the empty string, which overrides the manager's value or an earlier file's, and the server then takes its default 900000 (`Number('')` is 0, refused, server/src/config.ts:446, :492). Dropping that line from `min` would let a manager value of 1200000 make the bound restamp + 1200 − 235, past the server's 900 s (the review's scenarios a and b, both W24-D2 rows).

    If any of the three is undecided, or names a value that is not canonical, it prints 0 and answers rc 1. `_bak_gc` then WARNs `<lead>: backups: WARN: CCRC_UPDATE_DEADLINE_MS does not read as one whole number of milliseconds everywhere the server may take it from (the environment, the box's ccrc.env, the exposure file), so no verification starts this run past the keep-set's first full one — the next update continues`. The bound becomes the re-stamp less the 235 s margin, already past, so `thin` starts no verification (wave 23's W23-T28) and still finishes an interrupted thinning (W23-T29), and the keep-set starts no second full verification (D-6592). The keep-set's first full verification still runs ungated, by D-6592's design, which is why the WARN says "past the keep-set's first full one" (W24-D3 pins the string).
  - Why the smaller, and why non-canonical is undecided: the server takes `Number(v)` with `isSafeInteger && > 0` (server/src/config.ts:446, :492), so `6e5`, `+600000`, `600000.0` and `0x927C0` read 600000 there and 900000 here. The bash cannot know every figure the server's parse makes. But it can tell canonical digits, which both sides read alike, from everything else. The server takes the first of exposure file, `ccrc.env` and manager environment that names the key, and the bash cannot always know which that is, so the bound uses the smallest.
  - **The watchdog does not take the plain reading** (revision 1 said it did, and that a smaller deadline there was harmless; it is not). It takes `max` (D-6602).
- **D-6592.** **The keep-set's full verifications are bounded by the same instant** (carried item 2).
  - **Measured from the code.** `_bak_keepset` (ccd/ccrc:23633-23656) runs after the re-stamp and under the same lock. It walks every earlier dir that `_bak_ours` does not claim, newest first, and calls `_bak_snap_class` (:23769) on each until one holds a valid data set. For a dir that carries a data set, that is a full `validate`.
    - The walk is bounded by the dirs listed: up to `CCRC_BACKUP_KEEP` after earlier prunes, ten at the default, and more when those prunes did not run. It is not bounded by time.
    - Wave 23's Step 7 measured one full verification at 65 to 111 s wall, for a set about 0.8 of the server box's. Scaled, that is about 101, 132 and 150 s per set (mean, slowest, weighted).
    - So six `invalid` full-size sets ahead of the first valid one reach 900 s at the weighted figure (seven at the slowest, nine at the mean). Alone, the keep-set can pass the deadline, and the lease is then released `failed`, which halts the fleet until it is acked.
    - **Not every call is a full verification.** `_bak_snap_class`'s pre-filter (:23772-23775) answers rc 1 for a code-only dir without starting node, and a dir holding only `coordination-snapshot.json` (every fleet-box backup: `_upd_backup`'s `capture` writes a `data: no` manifest on every box) is validated in well under a second. Such a dir never sets `BAK_KEEP_DATA`, so on a box whose backups hold no data the walk always makes more than one call.
  - **The cost word.** `_bak_snap_class` sets `BAK_SNAP_HEAVY` (0|1) in its pre-filter: 1 when the dir holds any of its four member names other than `coordination-snapshot.json` (a coord.db, the journal or the checkpoint), the members a full verification reads. It is set in the existing loop's body, in place: the loop no longer `break`s at the first member found (so a manifest found first does not hide a coord.db), and its body gains `[ "$n" = coordination-snapshot.json ] || BAK_SNAP_HEAVY=1`. The `for n in …` line itself is unchanged (delegation-wave3.integration.test.ts:1461 pins it as the only code line naming the journal), and `BAK_SNAP_HEAVY=0` joins the reset on :23771.
  - **The bound.** `_bak_keepset [<until>]`. Before a classifier call, when `<until>` is given, `date +%s` is at or past it, AND an earlier call in this walk was heavy, it clears its three out-params and returns **3**. After each call it records `BAK_SNAP_HEAVY` in a local.
    - So the first full verification is never gated, and no cheap call is gated before one. The first full one is the steady-state one that has run since wave 9, the one whose answer both the count prune and `thin` (as `--verified`) use. It costs at most the 150 s the margin already reserves for one verification started just before the bound. **Narrowed by D-6745 (fix round 1, F3):** that holds while the re-stamp arrives with the reserve intact. When the re-stamp is already late, this first verification can still run past `until`, and past the control plane's hard cap, by one classifier call (W24-K1 measures one).
    - A box whose backups hold no data set (the fleet box, or a server box whose newest earlier dirs are deploy.sh code-only backups) is never stopped: its walk is cheap calls only, and it ends with rc 0 and a count prune, whatever `until` says. That closes the review's scenario where an undecided or tiny deadline (`6e5`, `200000`) made every fleet update print "nothing pruned or thinned" for good.
    - No second constant is spelled: the check is "now < until", and wave 23's 235 s margin already holds one full verification (D-6745: for every verification the bound gates, and for the first only when the re-stamp is not late).
  - `_bak_gc` computes `until` before `_bak_keepset` (D-6601's expression, over `_upd_deadline_ms min`) for both leads, whenever `UPD_THIN_AT` is set, and passes it in. A rollback passes it only to `_bak_keepset`, since it never thins. On rc 3 it prints `<lead>: backups: WARN: this run's time budget ran out before the keep-set found the newest valid coordination snapshot — nothing pruned or thinned; the next update continues` and returns 1 after unlocking, like the classifier's rc 2.
  - `_bak_prune` passes nothing, so `ccrc backup` stays unbounded, as wave 23 left it.
  - rc 3 is its own word, never rc 2: a time stop is not a classifier failure.
- **D-6593.** **`CCRC_UPDATE_HEALTH_S` is read through the reader.** On rc 1, `_upd_gate` prints `update: WARN: <KNOB_WHY> — using 90` and waits 90, as it does today for a value that is not digits.
  - Why not refuse: the gate runs after the install, so refusing there cannot undo anything. A rollback's gate (the watchdog's included) must still be able to judge a box.
  - Why not a shorter wait: a short window reads a slow but healthy box as failed and restores it. 90 is the default every box already runs with.
- **D-6594.** **`CCRC_RELEASE_BASE_URL` is read through the reader.**
  - On rc 1, `_upd_release_base` prints `$PROG: <KNOB_WHY>` on stderr (`ccrc: CCRC_RELEASE_BASE_URL cannot be measured: …`) and returns 1 with nothing on stdout. The lead is `$PROG:`, never `update:`, because a rollback and a rollout reach it too.
  - `_upd_resolve`'s base line dies with the reader's own cause: `$KNOB_WHY — nothing on this box was changed`, one stderr line (`ccrc: CCRC_RELEASE_BASE_URL cannot be measured: … — nothing on this box was changed`). **Amended by fix round 1 (F8, F9):** the plan's first wording, `CCRC_RELEASE_BASE_URL could not be read (the line above says why) — …`, pointed at a line that went only to stderr, so a detached update's report said nothing actionable. `_upd_resolve` now calls `_upd_release_base` in its own shell, output silenced, so `KNOB_WHY` (value-free) reaches the die and `update.json`'s detail; `UPD_FAIL_PREFIX` stays empty, so the report is a node fault, never a provenance verdict (W24-U5 pins the detail's class).
  - `_upd_asset_listed` answers **3** (the base could not be read), a word of its own: rc 2 means the release host could not be asked, and its one caller's die for rc 2 blames curl and the host (`cmd_rollback`, ccd/ccrc:19091). `cmd_rollback`'s case gains `3) _ccrc_die "rollback: $KNOB_WHY — nothing on this box was changed" ;;`, one line, before its `*)` arm (fix round 1, F8: the plan's first wording named "the line above"; `_upd_asset_listed` now runs `_upd_release_base` in the caller's shell, so `KNOB_WHY` reaches the die, and a rollback names its cause twice on stderr, once in the reader's line and once in the die, R35). `cmd_rollback` (:19084) is its only code caller at the base (re-checked with `git grep -n '_upd_asset_listed "' -- ccd/ccrc` after the absorb). **It is not the only caller:** restore arm 2 of `_upd_restore` asks `_upd_asset_listed` whether the previous tag ships a bundle (fix round 1, F10). Its `*)` arm blamed curl and the host for an rc 3, so it gains a `3)` arm: `update: arm 2: $KNOB_WHY, so no host was asked whether $UPD_PREV_TAG ships a bundle — the restore child's own resolve decides`. The flow is the `*)` arm's: the child runs the NEW tree's reader, which may take a line this one refused, and arm 3 follows if it refuses too.
  - **Where the base is read** (the table above): every box act that downloads, and **`ccrc rollout`'s pin on the deploying machine** (`cmd_rollout` → `_upd_resolve`, ccd/ccrc:23203). That machine reads its own environment, else its own `~/.ccrc/ccrc.env` when it is a box, else the default. An unreadable line there stops the rollout at step 2, exit 2 (`could not resolve the target release — read the line above`), before any box is touched. Ruled so, not environment-only: the deploying machine fetches SHA256SUMS from the same host its own update would, and a box that is also the operator's machine keeps one answer for both.
  - Why refuse: an operator names a mirror for a reason (a box with no route to the default host, or a rate limit). Fetching from the default host when that line cannot be read folds unmeasured into unset. The refusal comes before anything on the box changes.
  - **On macOS** only a file that NAMES the base can refuse it (D-6587): a knob-less line the Darwin model rejects reads the derived default, and the update runs (W24-U4). A file that names the base beside such a line refuses, as on Linux a refused line does.
  - **A whole-file fault** (mode 000, a NUL byte) refuses the base too, so it stops updates on that box, every role; the doctor names it (D-6599). Recorded in Risk notes.
  - The default expression stays verbatim (the release-source pin).
  - The value can carry `user:pass@`: no line prints it, and the doctor redacts it (D-6599).
- **D-6595.** **`CCRC_MODELS_ADVANCE_BUDGET_S` is read through the reader** (`_models_advance_budget_secs`, one line in place).
  - On rc 1 it prints `ccrc: <KNOB_WHY>, so the advance step is off for this run` on stderr and uses 0, the step off. That is the direction its invalid-value arm already takes (D-6266).
  - Why it is a setting: `=0` turns a step off (the function's header), and the models timer runs with no shell.
- **D-6596.** **`CCRC_VERSIONS_KEEP` is read through `_keep_knob`.**
  - `_ver_gc` keeps its arms, with `KEEP_WHY` as the sentence: `<lead> WARN: <KEEP_WHY> — nothing pruned` for `auto`, and `versions: <KEEP_WHY> — nothing was pruned` for `prune`.
  - `cmd_versions --prune` dies with `versions: <KEEP_WHY> — nothing was pruned`.
  - A listing WARNs `versions: WARN: <KEEP_WHY> — listing only; nothing would be pruned` and lists, because a listing removes nothing (final review F8, kept).
  - The listing's two hard-coded invalid-value texts stop saying something false about a value that may be valid but unmeasured. Each kept tree's verdict (ccd/ccrc:24301, `VER_VERDICT[$n]="kept: CCRC_VERSIONS_KEEP is not a whole number from 0 to 9999"`) becomes `kept: CCRC_VERSIONS_KEEP could not be used (the WARN above says why)`, and the summary's `keep="(not a whole number from 0 to 9999)"` (:24340) becomes `keep="(could not be used)"`. Both in place, one line for one.
- **D-6597.** **`deploy/ccrc.env.example` documents ccrc's own settings,** in a new last section, with the exact text of Task 5 Step 3:
  - each setting as a commented `# KEY=` line, so a copied example sets nothing;
  - its default (as `Default <value>`, which C2 checks against the code), its range, what it changes, and what a value ccrc cannot use does;
  - the precedence;
  - the plain-line rule, and the line/file sentence of D-6590.
  - `CCRC_UPDATE_DEADLINE_MS` keeps its line in the update control plane section, and its stale "nothing reads it until the dispatcher lands (W4)" (:257-259) is replaced.
  - The header's first paragraph gains that ccrc reads its own settings from the file too, rewrapped in its own four lines (lifecycle.test.ts:405 cites line 19).
  - The usage text stops saying "read from the process environment only" (ccd/ccrc:2499-2500) and stops writing `\$CCRC_BACKUP_KEEP` as if it were only a shell variable (:2585, :2589).
  - README stops saying the opposite anywhere: its "Turning the step off" paragraph (README.md:1953-1961, which says `~/.ccrc/ccrc.env` does not set the models budget and sends the operator to a systemd drop-in) and its pointer at :414 are rewritten (Task 5 Step 3.3), and every README line naming one of the seven is re-read and recorded.
- **D-6598.** **A census guard keeps it true:** `server/test/ccrc-settings-census.test.ts`, text-only, with no spawn.
  - **Its scope, stated:** it reads `ccd/ccrc`, `ccd/ccrc-doctor-checks` (which `cmd_doctor` sources) and `deploy/ccrc.env.example`. It does not read the ccd-* sibling scripts, `ccd/ccgpt-runtime`, `ccd/ccrc-models-probe`, `ccd/ccrc-codex` or the `deploy/*.mjs` helpers `ccrc` runs; "Not in this wave" names each of their `CCRC_` reads with a class. C6 alone also knows `CCRC_SIGSTORE_TRUSTED_ROOT` by name (`HELPER_ENV_ONLY`), so the example can never offer it as a line.
  - It derives the settings from `CCRC_SETTINGS` (never a second hand list), and each setting's default from the second argument of its literal `_ccrc_knob`/`_keep_knob` calls.
  - It holds the reasoned `ENV_ONLY` map of D-6588's 42, each with a class and a reason, and the reasoned `SERVER_SETTINGS` list (C8): the literal keys ccrc reads from the server's files.
  - Its rows C1 to C8 (Task 5; C9 to C11 were added by fix round 1, D-6746) red on: a new environment-only read; a setting expanded or file-read outside the reader; a setting not documented, or documented with a default the code does not use; an exception that is documented as a `ccrc.env` line, or no longer read; the loss of `set -u` (the premise that an unguarded read must spell a default C5 sees, not a proof of completeness, D-6746); and a second reader (indirection, the awk program, a variable or unlisted literal key to the box-env readers, or a setting beside a file read).
- **D-6599.** **`ccrc doctor` gains `box-settings`.** For each name in `CCRC_SETTINGS` it reads `ccrc.env` ALONE (`_ccrc_knob "$k" "" file`).
  - **PASS** names what the file sets, `KEY=value` each (a named-empty line as `KEY=` with "(empty: the default)"), and the rest as unset ("the default applies unless the environment sets it").
  - **WARN** carries each `KNOB_WHY`, with the remedy to rewrite the named line as a plain `KEY=value`. **Amended by fix round 1 (F15, review 891):** when a refusal's cause is model-wide (an unrelated non-ASCII `NAME=value` line or a line with an inner CR on Linux, every model refusal on macOS), the remedy is the model's own fix (`BUE_FIX`: the file and line numbers, never its bytes), once however many settings refuse, since the named line is already plain; a mixed cause gives that fix, then `; for each other refusal, ` and the plain-line clause. A NUL byte never reaches the model and keeps the generic remedy (R36).
  - The line passes through `_upd_redact`, so a mirror's credentials never print.
  - It reports what the reader reads, not whether the value is valid: each act validates its own.
  - Why: once the environment goes, the file is what every run reads, and the environment hides a bad line until then. This is the one read-only way to see the file's verdict, and the soak's steps 0 to 4 use it (D-6600).
  - Its table entry joins the `disk` line in place (`disk box-settings`), because the table's lines are cited by number elsewhere.
- **D-6600.** **The migration off the server box's `environment.d` fragment** (the soak constraint), in this order. Each step names its actor. The coordinator is a fleet-box session: it reads the server box only through the console's routes, never by ssh, so every act ON a box is the operator's.
  0. **Before the move, on BOTH boxes (the operator):** count, by name only and never printing a line, which of the seven each box's `ccrc.env` names, since the move's own arm-2 restore child and the watchdog's next tick read them through the new reader (Deploy class): `for k in CCRC_BACKUP_KEEP CCRC_BACKUP_DATA_KEEP CCRC_VERSIONS_KEEP CCRC_UPDATE_HEALTH_S CCRC_UPDATE_DEADLINE_MS CCRC_RELEASE_BASE_URL CCRC_MODELS_ADVANCE_BUDGET_S; do printf '%s %s\n' "$k" "$(LC_ALL=C grep -v -E '^[[:blank:]]*[#;]' ~/.ccrc/ccrc.env | LC_ALL=C grep -c -w -- "$k")"; done`. `LC_ALL=C` on both greps makes the count byte-wise, as the reader's is, so a non-ASCII byte neither hides a line nor splits a word. It counts a key only on a line that can assign it: comment lines are not counted, since the reader no longer counts them either (ruling 16, D-6604). A comment line with a CR inside it is counted by the reader but not by this command; doctor's `box-settings` names such a line at step 4. Each non-zero count is a line the operator reads and keeps or removes on purpose, before step 1.
  1. Wave 24 lands and the operator moves the server box onto a build that carries it. The installing update prunes the old way, from the environment (the fragment's 5).
  2. The coordinator measures that the box runs it: the server node's measured version in `GET /api/updates` names the tag or a later one.
  3. The operator adds one line, `CCRC_BACKUP_KEEP=5`, to the server box's `ccrc.env` by hand. **The keep stays 5:** the environment (the fragment) wins over the file, and both say 5 (Task 2's P2). The line may also be added before step 1: an older build never reads it, and the server only passes it to a `--detach` parent that prunes nothing. **Only that single line is safe before the new reader (review 891 F16).** Pasting the new commented section of `deploy/ccrc.env.example` first is not: the older reader (the base's and wave 23's data-keep reader) still counts a `# CCRC_BACKUP_DATA_KEEP=` comment as naming the knob, so beside an unrelated line the box's model cannot decide (`CCRC_VAPID_SUBJECT=mailto:josé@example.com` on Linux) it refuses, and wave 23 then stops both the prune and the thinning. The new reader defaults there (D-6604). Paste the section only after step 2.
  4. The operator runs `ccrc doctor` on the server box and relays its `box-settings` line to the coordinator, and does the same on the fleet box (whose keep stays the default unless step 0 found a line). On the server box it must PASS with `CCRC_BACKUP_KEEP=5`. A WARN means the line is in a shape the reader refuses, which the fragment was hiding. Fix the line and read again.
  5. Only then does the soak's coordinator have the fragment removed, by its own procedure, and the operator then runs `systemctl --user unset-environment CCRC_BACKUP_KEEP` on the server box. Removing an `environment.d` fragment does not take a value out of a running (lingering) user manager, which keeps it until the manager restarts, and possibly past a `daemon-reload`; without the unset, the environment would go on winning, and a later edit of the file's line would silently do nothing until a reboot. **The keep stays 5:** nothing sets the environment, and the file says 5 (Task 2's P1).
  6. The next completed update's prune line reads `the newest 5 timestamped backups (CCRC_BACKUP_KEEP from the box's ccrc.env)` (D-6590's source clause). `from the environment` there means step 5's unset did not take: repeat it.

  - Neither step alone changes the keep. Step 3 alone leaves the fragment winning at 5. Step 5 is never done alone: before step 1 it would bring back 10 (the old build reads the environment only), and before step 3 it would bring back the default 10.
  - **A rollback below wave 24's tag** (the watchdog's, or a console rollback, which may go below the floor) runs a tree that reads `CCRC_BACKUP_KEEP` from the environment only: once the fragment is gone, its keep is 10, and no line says why. The soak's disk measurement re-checks the prune line after any rollback. The same older reader applies to a copied example section left in the file: it counts `# CCRC_BACKUP_DATA_KEEP=` and refuses beside a model-fault line, so a rollback below the tag also stops the thinning until the section's comment lines are removed (review 891 F16).
  - The fleet box has no fragment; its keep is the default unless step 0 or step 4 found a line.
- **D-6601.** **A rollback by flip is bounded like an update, and the bound stays inside the control plane's hard cap** (carried item 2, closing what revision 1 left open).
  - **The gap, measured.** A console rollback by flip (`ccrc rollback --to <tag> --detach --from pwa`) holds the same busy lease and the same deadline as an update (`deadlineExpired`, server/src/update/dispatch.ts:243). Its flip arm stamps `restarting` (ccd/ccrc:19169), sweeps (:19171) and calls `_bak_gc rollback` (:19178) with no re-stamp and no `UPD_THIN_AT`, so its keep-set's full verifications are unbounded and nothing writes the report while they run. Six `invalid` full-size sets reach 900 s (D-6592), the lease is released `failed`, and the fleet halts until acked. The watchdog's own `rollback --from watchdog` by flip walks the same arm under `TimeoutStartSec=1800`.
  - **`_bak_restamp <detail>`**, new, above `_bak_gc`: the one spelling of the pre-prune re-stamp. Its body is `cmd_update`'s inline one (ccd/ccrc:18661): `UPD_THIN_AT="$(date +%s)"; _upd_report_is_mine && _upd_phase restarting "$1" && _upd_report_readable && { local rb=""; rb="$(jq -er '.updatedAt | numbers' -- "$BOX_UPDATE_JSON" 2>/dev/null)" && [[ "$rb" =~ ^[1-9][0-9]{0,10}$ ]] && UPD_THIN_AT="$rb"; }`. It never dies.
    - `cmd_update`'s line becomes `if [ "$gate_passed" -eq 1 ] && [ "$UPD_FROM" != restore ]; then _bak_restamp "pruning and thinning ~/ccrc-backups"; _bak_gc update || :; fi`, in place: the detail W23-B15 pins is unchanged.
    - `cmd_rollback`'s flip arm gains `_bak_restamp "pruning ~/ccrc-backups"` on the line before `_bak_gc rollback || :`.
  - **`until`** is computed by `_bak_gc` for both leads whenever `UPD_THIN_AT` is whole seconds: `until = min(UPD_THIN_AT + D, UPD_REPORT_STARTED + 4·D − 63) − 235` (the term was 22, then 40; D-6603, D-6744), with `D` = `_upd_deadline_ms min` / 1000.
    - The second term is the hard cap (D-3407: `now − updateStartedAt ≥ UPDATE_DEADLINE_HARD_CAP_FACTOR × deadlineMs`, dispatch.ts:241-245, factor 4 at :49), which the re-stamp cannot push out. The bash knows no lease start, but its own report's `startedAt` (`UPD_REPORT_STARTED`, set at its first `_upd_phase`, ccd/ccrc:19902) is no earlier than it, and later by at most the spawn's bound: 22 s, `UPDATE_SPAWN_TIMEOUT_MS + UPDATE_SPAWN_DRAIN_MS` (shared/agent-protocol.ts:493, :507). **Amended by D-6603 (Task 3 Step 0): the measured gap is at most 40 s, not 22, so the term is `− 40`.** **Amended again by D-6744 (fix round 1, F2): the term is `− 63`, the sum of the chain's own ceilings.** When `UPD_REPORT_STARTED` is not whole seconds the second term is left out.
    - **The worker measures that "at most 22 s" before Task 3's edit**, reading where `updateStartedAt` is stamped (server/src/update/) against the spawn, and whether a detached child can wait (a lock, `_inst_migrate_resume`) before its first `_upd_phase`. If the gap can exceed 22 s, it takes a reserve number, uses the measured bound, and says so in the wave-done.
    - The literals 4 and 63 are a deliberate cross-language second copy, pinned against the TypeScript constants and the two shell ceilings they are made of by W24-K6 (a text row), never by a comment (the 63 was 22, then 40; D-6603, D-6744).
    - A rollback passes `until` to `_bak_keepset` only (it never thins).
  - Why: the review's scenario reaches the re-stamp at start + 2800 s by writing a phase within each deadline; revision 1's bound would then lie at start + 3465 s, and one verification started just before it, plus the inventory's 75 s, passes the hard cap at start + 3600 s.
  - **Narrowed by D-6745 (fix round 1, F3).** The bound holds for every GATED verification. `_bak_keepset` never gates its first full verification (ruling 4, D-6592), so when the re-stamp is already late that one verification can run past `until`, and past the hard cap, by one classifier call (W24-K1 measures one). No behaviour changes; the guarantee is narrower than "stays inside the hard cap" read alone.
- **D-6602.** **The watchdog takes the largest deadline reading** (`_upd_deadline_ms max`).
  - `max`: the largest of the plain reading, `ccrc.env` alone and the exposure file alone. A named-empty file contributes 900000 (what the server takes from it), an absent one nothing, and an undecided one 900000 with rc 1.
  - `cmd_watchdog`'s deadline line becomes `deadline="$(_upd_deadline_ms max)" || echo "watchdog: WARN: CCRC_UPDATE_DEADLINE_MS does not read as one whole number of milliseconds everywhere the server may take it from (the environment, the box's ccrc.env, the exposure file) — using the largest reading ccrc could decide"`, one line. `lim` feeds both of its thresholds, the in-progress one (:19488) and the wedged one (:19549, twice the deadline).
  - Why: the watchdog acts on a live updater. Past twice its deadline it writes `failed … wedged` over the holder's report (:19549-19551). The plain reading puts the environment over the file, and the server puts the file over the environment. So a manager value of 300000 beside a `ccrc.env` line of 1800000 would wedge, at 601 s, an update the server still counted as inside its deadline (1200 s left). The largest reading never calls a live update wedged sooner than any deadline the server may hold.
  - Why one reading for both thresholds: a larger in-progress threshold only delays the watchdog's probe of a DEAD updater (the server's own deadline frees the lease meanwhile), and one read keeps the line one line.
  - Residual: a non-canonical spelling the server reads larger than every decided reading (`2e6`) can still be judged early; the WARN says so, and doctor's `box-settings` names the line.
- **D-6603.** **The hard-cap term allows 40 s between the lease's start and the bash's `startedAt`, not 22** (Task 3 Step 0, ruling 12; the worker's first reserve number). Amends D-6601's `− 22` to `− 40`.
  - **Measured, read only, before any edit.** The server acquires the lease and sends the move in one synchronous stretch (`runDispatch` in server/src/update/converge.ts, step 6 then step 7: `store.dispatchNode(…, now, …)` and then the local spawn or the link frame, D-3377). So the gap is the `--detach` parent's run, then the detached child's run up to its first `_upd_phase`, which is where `UPD_REPORT_STARTED` is set: the child adopts no `startedAt` from the parent's `queued` report.
    - The parent is killed at `UPDATE_SPAWN_TIMEOUT_MS` (20 s), so it hands off the child within 20 s or never.
    - A detached **update** child (`cmd_update`) reaches `_upd_phase resolving` after `_upd_lock` (a non-blocking `flock -n`), `_upd_last_report`, `_inst_migrate_resume`, `_ver_layout`, the tool loop, `_box_build_fields` and `_upd_fleet_warn`: no network call and no wait. Sourcing `ccd/ccrc` and running those under `env -i` in a fixture HOME took 76 to 272 ms over five runs at load average 50.
    - A detached **rollback by re-install** child (`cmd_rollback` with no kept tree) asks the release host AGAIN (`_upd_asset_listed "$to" SHA256SUMS`) before it calls `cmd_update`, whose `resolving` is its first `_upd_phase`. That curl is bounded by `--max-time "$CCRC_RELEASE_PROBE_MAX_TIME"`, default 15, which `_upd_asset_listed` validates to at most 18.
    - A rollback by flip writes `installing` before any network call (it has none).
  - **The bound the measurement supports:** 20 s (the parent) + 18 s (the re-install child's probe, at its validated ceiling) + the child's start-up (measured under 0.3 s, inside the 2 s of `UPDATE_SPAWN_DRAIN_MS`) = **40 s** = `UPDATE_SPAWN_TIMEOUT_MS + UPDATE_SPAWN_DRAIN_MS` + 18. The link's transit for a fleet node adds milliseconds.
  - Why one figure for every lead rather than 22 for an update and 40 for a re-install: `_bak_gc` would have to know which path called `cmd_update`, and the cost is 18 s less thinning time in a 3600 s cap. W24-K6 pins the 40 against the three literals it is made of.
  - **Superseded by D-6744 (fix round 1, F2).** The 40 left out the fleet-health request the detached child makes before its first `_upd_phase`; the term is 63. This entry stays as the history of the measurement, and of the 40 that W24-K6 and W24-D3 once pinned.

- **D-6604.** **Wave 23's whole-token rule (D-6347, D-6365) now counts assignment-capable lines only: a comment line with no CR inside it no longer makes `_ccrc_knob` ask the model** (the final review's Important 1; ruling 16, coordinator mail 8759).
  - **What changed.** The scan's count in `_ccrc_knob`'s awk program, in place and with no line added: a line whose first non-blank character is `#` or `;` and that holds no CR past its lead no longer counts toward "the file names the key". A line with a CR inside it still counts, matching the scan's existing `!/\r./` exception, since systemd ends a line at a bare CR. What the scan skips, refuses and hands to the model is otherwise unchanged.
  - **Why.** A line whose first non-blank character is `#` or `;` can never assign a key for systemd: a continuation into it belongs to the line above, another key's value, which the model already judges on that key's line. Counting it refused a whole file for a key it never sets. With the example's `# KEY=` lines (D-6597), a copied `ccrc.env` plus one unrelated line the model cannot decide (`CCRC_VAPID_SUBJECT=mailto:josé@example.com` on Linux, `CCRC_PROJECTS_ROOT=~/code` on macOS) refused all seven settings and so stopped every update (D-6594). It narrows what counts as an assignment line; it does not loosen what is refused.
  - **If it is wrong.** A comment that systemd did read as an assignment would set a key the reader reports as the default. No such reading exists for a line systemd skips as a comment; a value carried into it from the line above is the model's to refuse on that line.
  - **If it is wrong, on macOS (the residual of ruling 16).** The sentence above is true for systemd only. The macOS launchd job sources `ccrc.env` with bash, and bash CAN assign a key from a line that begins `#` or `;`. Four shapes were measured when the ruling was made: `FOO=a\` then `# CCRC_VERSIONS_KEEP=1`; `FOO="a` then `#" CCRC_VERSIONS_KEEP=1`; `FOO=a\` then `; CCRC_VERSIONS_KEEP=1`; and a line `\r;CCRC_VERSIONS_KEEP=1`. **Review 891 (F17) measured the residual as a family, not a four-shape boundary** (bash 3.2.57, 4.4.23 and 5.2.21, against the file-only Darwin read): also a single-quote span, a `$'` (ANSI-C quote) span, `;KEY=` with no space, a CR-leading `#x;KEY=`, and a double-quote span closing with `"; KEY=`. In each, bash sets the key while the Darwin read defaults. **It exists only while the key is named on no assignment line:** naming it on an ordinary assignment line makes the Darwin model refuse the opening multiline shape, so such a file refuses rather than reading the default. **What the base did (F18):** at `49e7f187a` the five ordinary knobs (the backup and versions keeps, the health window, the release base and the models budget) were environment-only and the deadline reader fell back on a value it could not read, so none of them refused anything on Darwin; only `CCRC_BACKUP_DATA_KEEP` had wave 23's model refusal. The refusal of all six non-data settings in these shapes is this branch's revision before ruling 16, not the base; ruling 16 made them read the default again. Accepted under D-6587's argument: a ccrc the job did not start never receives the job's bash reading, and a ccrc the job did start has that reading as its environment, which wins, so a ccrc read is unaffected. Recorded as the macOS residual of ruling 16 (final review of ruling 16, Important 1; widened by review 891 F17, F18). The data keep keeps its macOS departure and still refuses these shapes.
  - **The data keep's macOS departure is kept** (ruling 10): with `CCD_OS=darwin`, `CCRC_BACKUP_DATA_KEEP` asks the model when the scan answers 4, which a comment-only mention now answers, so a copied example plus one line the Darwin model rejects still refuses that keep.
  - **Pinned by** Task 1's W24-R12 (a copy of `deploy/ccrc.env.example`, read at test time, plus one odd line: every setting reads its default on both platform models, the data keep refused on macOS), W24-R13 (a comment line with a CR inside it still names the setting) and W24-R14 (a real assignment beside the odd line still refuses its key), each on `CCD_OS=linux` and `CCD_OS=darwin`. The mutant that counts comment lines again reds W24-R12, W24-R14 and the rewritten W23 row below.
  - **A W23 row rewritten on purpose** (controller's approval of the worker's NEEDS_CONTEXT). W23-B17's shape `a comment naming the knob above a non-ASCII value` (`# <KEY> is tuned below` then `NOTE=café`, on the Linux arm) moves from the undecided table, where it expected a refusal (`line 2 has a non-ASCII byte in a NAME=value line`), to the read table, where it reads the default 3; its comment now states the new rule. This supersedes review 839's "a token in a comment counts as naming the knob" for every key, the Linux data keep included; only the macOS data keep keeps "always ask".
- **D-6605.** **A keep refused for its value names the source that won, and prints no other byte** (fix round 1, F12; the coordinator's ruling 9; spent by the round from the worker's reserve).
  - **What changed.** `_keep_knob`'s refusal for an invalid value sets `KEEP_WHY` to `_keep_why <KEY> <value> <lowest>` followed by `, as set in the environment` or `, as set in the box's ccrc.env`, from `KNOB_FROM`. On a refusal for its value `KNOB_FROM` can only be `environment` or `file` (an empty or default reading is a valid keep), so the clause is always one of those two. Only the value's sanitised, capped quote prints, as before: no other byte of ccrc.env. Zero net code lines: the `case "$KNOB_FROM"` words line moved up one line and the refusal arm was edited in place.
  - **The plan's mandated sentence is amended** (D-6589, and the Task 1 and Task 2 rows that quote it). Old: `CCRC_BACKUP_KEEP='x' is not a whole number from 0 to 9999`, then each caller's tail. New: `CCRC_BACKUP_KEEP='x' is not a whole number from 0 to 9999, as set in the box's ccrc.env` (a file value), or `…, as set in the environment` (an environment value), then the tail (` — nothing pruned`, ` — nothing was thinned`, ` — listing only; …`). An unmeasured refusal (`<KEY> cannot be measured: …`) is unchanged: it already names the file.
  - **Why.** With the environment `CCRC_BACKUP_KEEP=' '` and a file value of 5, the refusal named the invalid value without saying it came from the environment, while doctor's file-only line passed with 5. Accepted prune lines already named their source; invalid-value refusals did not (review 891 F12). Diagnostic clarity, not a precedence defect.
  - **`deploy/deploy.sh` keeps its own copy of the sentence** (D-5142), without the clause: its value always comes from its own environment.
  - **Rows.** W24-R16 (new): the environment `' '` with file 5 names the environment; file `x` names ccrc.env; neither output holds `CCRC_ROLE`. The suites that quoted the old sentence were re-pinned, old → new, with the clause added before the dash (the versions rows, P11, W23-B3 and B12, and W24-B1, B2, B4, B5, B8 and R9 in ccrc-update.test.ts, and the two bounded-number rows in ccrc-uninstall.test.ts, a file this run's claim covers; ruling R33). Mutant: dropping `, as set in $KEEP_FROM` reds W24-R9, W24-R16 and both uninstall rows.
- **D-6606.** **Unspent: issued to run 855 as the worker's reserve, not needed by this wave.**
  - No code, test or document cites it. It is defined only so the issued block is accounted for.
- **D-6744.** **The hard-cap term is 63 s, the sum of the start chain's own ceilings, and W24-K6 derives it from the four sources** (review 891 F2; the coordinator's ruling 2). It amends D-6601's `− 40` to `− 63`. D-6603 stays as the history it is, with one bullet saying this supersedes its term.
  - **The gap, measured by the review.** D-6603's 40 s (the spawn's bound and one probe) left out the pre-report fleet-health request. A re-install rollback's detached child repeats the asset probe, enters `cmd_update`, then calls `_upd_fleet_warn` before its first `_upd_phase`; that calls `_box_health`, whose default curl limit is another 5 s. The review's source-derived fixture chain (17.95-second asset shims, a five-second health shim) measured parent 18.009 s plus child 23.032 s, 41.041 s.
  - **The term.** 63 = `(UPDATE_SPAWN_TIMEOUT_MS + UPDATE_SPAWN_DRAIN_MS) / 1000` (22) + the asset probe's ceiling twice (2 × 18; the last argument of `_upd_validate_timeout CCRC_RELEASE_PROBE_MAX_TIME`: the parent's probe and the detached child's repeat) + `_box_health`'s default curl limit (5). `_bak_gc`'s `until` line carries the sum as one literal: `hc=$(( 4 * dl / 1000 - 63 - margin ))`. W24-K6 reads the two TypeScript constants, parses the probe ceiling out of `_upd_asset_listed` and the health default out of ccd/ccrc, pins that `_upd_fleet_warn` calls `_box_health` and that its curl carries `--max-time "$CCRC_HEALTH_TIMEOUT"`, and asserts the literal equals the sum, so a change to any one source reds it. W24-D3's arithmetic follows.
  - **Re-measured** (fixture only, no row): the same chain, parent 18.016 s plus child 23.029 s = 41.045 s, below 63 by 21.955 s.
  - **Ruling R30: 63 is kept although it over-counts.** The parent's probe runs inside the spawn's 20 s bound (its ceiling is 18 so that it fits), so counting it a second time, as the ruling says, over-counts the chain by up to 18 s. A larger term only stops the thinning earlier, the safe direction. Cost: thinning stops up to 18 s earlier than it need. The `_bak_gc` header says so.
  - **Residuals no literal bounds:** the transient unit's start under the service manager, and a lease stamped before its dispatch.
  - **Mutants** (scratch clone, restored by cmp): probe ceiling 18 → 17, health default 5 → 6, spawn timeout 20 000 → 21 000, drain 2 000 → 1 000 each red W24-K6; the literal 63 → 40 reds W24-K6 and W24-D3.
- **D-6745.** **Ruling 4 stands, and the hard-cap guarantee narrows: the bound holds for every gated verification, not for the first** (review 891 F3; the coordinator's ruling 3).
  - `_bak_keepset` never gates its first full verification (ruling 4, D-6592), even when `until` is already past. When the re-stamp is already late, that one verification can run past `until`, and past the control plane's hard cap, by one classifier call (W24-K1 measures one); it can spend the roughly 150 s the margin reserved once the available reserve is gone. No full-size hard-cap expiry was run.
  - No change in behaviour. The narrowing is said where the code is (the `_bak_gc` bound's comment, `_bak_keepset`'s header), in D-6592 and D-6601 above, and in the example's deadline block.
- **D-6746.** **The census guards the spellings it names, and is not a proof that no other reader exists** (review 891 F4; the coordinator's ruling 4). It replaces the "complete" premise of this plan's first text and amends D-6598.
  - **Rows added.** C9 (a nameref to a setting: a `local`, `declare` or `typeset` whose option cluster holds `n`, with a setting after it). C10 (a `-v` test of a CCRC_ name, in `[[ ]]`, `[ ]` or `test`, is an environment read, so the name must be a reasoned `ENV_ONLY` exception, never a setting: `[[ -v CCRC_NEW ]] && x="$CCRC_NEW"`). C11, which matters most because sourcing is a whole second reader: `.` or `source`, in command position (first on a line, after `;`, `&`, `|`, `(`, `{` or `!`, or after any run of `if`, `elif`, `while`, `until`, `then`, `do`, `else`, `!`, `builtin`, `command`), of `$BOX_ENV_FILE`, a path ending `ccrc.env` (a quote inside it included), a name bound to either, `<(…)` naming one, or `/dev/stdin <` one. A name bound in a body that declares it `local` is followed in that body alone; any other binding, and `BOX_ENV_FILE`, everywhere. C7's title is now `ccd/ccrc keeps set -u, so a bare read of an unset name aborts and an unguarded read must spell the default C5 sees`.
  - **The one allowed sourcing site: `_inst_plist_server`.** Its launchd job command string, `set -a; [ -f '$env1' ] && . '$env1'; …`, is the macOS counterpart of `EnvironmentFile=`: the server's reading of ccrc.env, not ccrc's read of a setting. `SOURCING_BODIES` lists it with its reason and a pinned count of 1, both ways: a second sourcing in it, an unlisted body, or a listed body that no longer sources reds C11.
  - **Named residuals** (the census header and here, in place of "complete"). The coordinator's list: `${#NAME}`; an expansion split by a backslash-newline; indirect calls through the timeout helper; environment reads from node or jq; a two-line file loop; C6's spacing and export variants. What the census reviews measured: `eval "$(cat …)"`; `declare -p NAME`; a nameref whose target is held in a variable (`local -n r="$k"`) or assigned after its declaration; a `-v` test of a name held in a variable; a name bound through a second variable; a helper that sources a positional parameter handed the file; `printenv`. And, from the re-review (ruling R29), four sourcing shapes that survive C11: a `case` arm (`x) . "$BOX_ENV_FILE" ;;`), `time . …`, a sourcing in a callee that reads a name its caller declared `local` (dynamic scope), and a sourcing split over lines.
  - **Ruling R29:** those four are named, not caught. D-6746 rules the census guards the spellings it names, no code uses these forms, and each further catch adds pattern risk. Cost: a future sourcing in one of those forms passes the census silently.
  - **Measured.** Each row red on its mutant, restored by cmp: ten mutants for C9 to C11 at first (M1 to M9 and M3b), then 22 after the census review (command positions, scoped bindings, quote, process-substitution and stdin forms, the count pin), with three controls that stay green (`. "$f"` in a body that does not bind it, an unrelated local, jq's `.` filter) and three named residuals measured surviving. The census passes 11 of 11 at the round's tip.
- **D-6747.** **A digits-only health window the shell cannot compare is an unusable value: it waits 90 and says so** (review 891 F6; the coordinator's ruling 6).
  - Ruling 6 stands for every value the shell can compare, zero included: `CCRC_UPDATE_HEALTH_S=0` still fails after one probe, and no range is added. But a digits-only value of more than 18 characters (zero-padded included), or one the integer test refuses (`9223372036854775808`, `99999999999999999999`), made the comparison print `integer expression expected` and end the gate after its first failed probe (`gate FAILED after 0s`), after which the update restores. `_upd_gate`'s `case` gains a third alternative (`''|*[!0-9]*|???????????????????*)`, nineteen `?`), so such a value takes the documented path for an unusable value: the WARN, 90, never an early failure. A zero-padded value longer than 18 characters is comparable, but waits 90 too, by the length rule.
  - **WARN wording, changed for every unusable value** (the old non-digit case included). Old: `update: WARN: CCRC_UPDATE_HEALTH_S='<v>' is not a number of seconds — using 90`. New: `update: WARN: CCRC_UPDATE_HEALTH_S='<v>' is not a number of seconds (digits only, at most 18) — using 90`. No README, example or plan text quoted the old sentence; the existing row was re-pinned.
  - **Rows.** W24-H2 × 4 (`9223372036854775808` and `99999999999999999999`, each from ccrc.env and from the environment: the WARN, `gate FAILED after 90s`, rc 1, never `integer expression expected`). W24-H3 × 4, added after the review of the fix (`120` and `000000000000000120`, each from both sources: no WARN and `gate FAILED after 120s`, so an ordinary window is used as written). Mutants (restored, cmp clean): the guard removed reds all four H2 rows; the guard widened to `??*` reds all four H3 rows; the guard slipped to eighteen `?` reds the two 18-character H3 rows.
- **D-6748.** **`_upd_redact` masks a mirror base's userinfo with or without a scheme, so neither form leaves a credential in update's lines or `update.json`** (review 891 F7; the coordinator's ruling 7).
  - A scheme-less base (`user:pass@host/path`, which curl takes as http) was masked by doctor's `box-settings` but not by `_upd_redact`, so the fetching line, the error lines and the report's detail (which the inventory relays off the box) carried it. `_upd_redact` is the owner of redaction and now masks both forms: every `@`-ended run from a token's start (the text's start, or after whitespace, `"` or `<`), whose host ends at `/`, `?` or `#`, with or without a `:` in the userinfo, repeated `@` segments included. Doctor's mask is unchanged and is no longer the only one.
  - Kept as they are (pinned): `curl: (6) user@host`, prose `a@example.com`, `@scope/pkg`, a query's `?email=a@example.com/y`, and the existing `https://h?a@b` controls.
  - **Rows.** Three end-to-end rows with a synthetic credential (the fetching line; the one `download failed:` die line; `update.json`'s detail and file), and unit controls on the `_upd_redact` row. Mutants: the loop replaced by `:` reds the unit row and the three rows; the host-end class dropped and the boundary `(^|.)` each red the unit row.
  - **Ruling R31:** it over-masks text glued before a credentialed URL. A `'`, `(` or `=` directly before the userinfo goes with it (`k=u:p@h/r` prints `h/r`; an unbalanced `(` likewise). These are RFC 3986 sub-delims a userinfo may hold raw, so excluding them would leak part of such a password. Display only, never a leak. Cost: a slightly mangled error line.
  - **Ruling R32:** a raw `?`, `#`, `/` or space inside a password still prints, since it ends the pattern's authority; curl refuses such shapes as a host. Recorded here only, with no code comment (`_upd_redact` sits above the citation-debt line). Cost: a malformed credential could print.
- **D-6749.** **The comment-only header changes are accepted** (review 891 F21; the coordinator's ruling 13).
  - The plan's exact edit list permitted one in-place line in `_models_advance_budget_secs`; its three-line header changed too, and so did the headers of `_upd_release_base`, `_upd_gate`, `_upd_asset_listed` and `_ver_gc`. The source owner's external condition held: the platform block is untouched and the citation census is kept (the lines above base line 11635 net to zero in aggregate, and `session-hook`'s citation-debt row passes).
  - The as-built records each one, and corrects its one-line description of the hunk before line 11635 (its "Fix round 1" subsection).
- **D-6750.** **Unspent: issued to run 855 as the round's reserve, not needed by fix round 1.**
  - No code, test or document cites it. It is defined only so the issued block is accounted for.
- **D-6751.** **Unspent: issued to run 855 as the round's reserve, not needed by fix round 1.**
  - No code, test or document cites it. It is defined only so the issued block is accounted for.

## File structure

- `ccd/ccrc`:
  - Task 1: `CCRC_SETTINGS`, `_ccrc_knob`, `_keep_knob`, `_bak_data_keep` and its header.
  - Task 2: `_bak_prune` and its header, `_bak_gc`'s keep and data lines, its prune line's source clause, its prune-loop and thin guards, its final return; `_ver_gc`; `cmd_versions` (its verdict and summary texts included).
  - Task 3: `_upd_deadline_ms` and its header; `cmd_watchdog`'s deadline line; `_bak_restamp` (new), `cmd_update`'s re-stamp line, `cmd_rollback`'s flip-arm re-stamp; `_bak_gc`'s `until` line (moved above `_bak_keepset`, both leads, the hard-cap term) and its rc-3 arm; `_bak_keepset` and its header; `_bak_snap_class`'s cost word; `_upd_gate`; `_bak_gc`'s header.
  - Task 4: `_upd_release_base`, `_upd_resolve`'s base line, `_upd_asset_listed`, `cmd_rollback`'s `3)` arm, `_models_advance_budget_secs`.
  - Task 5: the usage `update` paragraph and the two `backup` lines.
- `ccd/ccrc-doctor-checks`: Task 6.
- `deploy/ccrc.env.example`, `README.md`, the wave-23 plan line: Task 5.
- `server/test/ccrc-update.test.ts`:
  - Task 1: a new describe after the W23 describe (which starts at :13793 and ends before :14489).
  - Task 2: rows nested at the end of the W23 describe, reusing `plantFull`, `runUpdate`, `runBackup`, `sourced` and `fingerprint`, and the in-place rewrites above.
  - Task 3: rows in Task 1's describe, and a watchdog row beside the `watchdog: update in progress` rows (:8306).
  - Task 4: the release rows.
- `server/test/ccrc-uninstall.test.ts`: the scrub list (Task 2); its `CCRC_BACKUP_KEEP` rows (:1358, :1446) run unchanged.
- `server/test/updateIntentFixtures.ts`: `nodeEnv`'s scrub list (Task 2, with the other scrub lists).
- `server/test/ccrc-versions-warn-arms.test.ts`: Task 2's P4.
- `server/test/ccrc-models-advance.test.ts`: Task 4's M1, M2.
- `server/test/ccrc-settings-census.test.ts`: Task 5.
- `server/test/ccrc-doctor.test.ts`: Task 6.

## Tasks

Tasks 1 to 4 are claim group A, Task 5 group B, Task 6 group C. A bash row sources the whole `ccd/ccrc` into a fixture HOME through the file's own helpers (`sourcedCcrc`, ccrc-update.test.ts:1185, or the W23 describe's `sourced`, :13839), so the new helpers are present; it never runs `ccrc` against the live HOME. Every red and green below is *(unmeasured: the worker measures each)*, because no vitest ran for this draft. Each `<why>` below is the reader's exact clause (D-6587). Rows write fixture files with `writeFileSync`, a `Buffer` where a byte matters.

### Task 1: one reader for ccrc's settings (W24-a; D-6587, D-6589)

**Files:**
- Modify `ccd/ccrc`:
  - new `CCRC_SETTINGS`, `_ccrc_knob`, `_keep_knob` above `_upd_deadline_ms`'s header (:19276);
  - `_bak_data_keep` (:23714-23728) and its header (:23686-23713).
- Test: `server/test/ccrc-update.test.ts`.

**Interfaces:**
- Produces:
  - `CCRC_SETTINGS=(CCRC_BACKUP_KEEP CCRC_BACKUP_DATA_KEEP CCRC_VERSIONS_KEEP CCRC_UPDATE_HEALTH_S CCRC_UPDATE_DEADLINE_MS CCRC_RELEASE_BASE_URL CCRC_MODELS_ADVANCE_BUDGET_S)`, one line, at the top level.
  - `_ccrc_knob <KEY> <default> [file]`: rc 0 sets `KNOB`, `KNOB_FROM` (`environment|file|empty|default`) and clears `KNOB_WHY`; rc 1 clears `KNOB` and `KNOB_FROM` and sets `KNOB_WHY`. Reads `$BOX_ENV_FILE`. Never prints, never dies.
  - `_keep_knob <KEY> <default> [<lowest>]`: rc 0 sets `KEEP` (decimal) and `KEEP_FROM` (a phrase, D-6589) and clears `KEEP_WHY`; rc 1 clears `KEEP` and sets `KEEP_WHY`.
  - `_bak_data_keep`: unchanged contract (rc 0 `BAK_DATA_KEEP`; rc 1 `BAK_DATA_KEEP_WHY`).

- [ ] **Step 1: Write the failing rows.** A new describe after the W23 describe: `'W24: ccrc reads its own settings through _ccrc_knob — the environment, else the box\'s ccrc.env, else the default (D-6587, D-6589)'`. Each row sources the file and echoes `rc $? val <KNOB> from <KNOB_FROM> why <KNOB_WHY>`.
  - `it('W24-R1: the environment wins, else ccrc.env, else the default; an exported empty value is unset')`:
    - environment `CCRC_BACKUP_KEEP=7`, file `CCRC_BACKUP_KEEP=5` → `rc 0 val 7 from environment`;
    - no environment, the same file → `rc 0 val 5 from file`;
    - no line, no environment → `rc 0 val 10 from default`;
    - environment `CCRC_BACKUP_KEEP=` (empty), file 5 → `rc 0 val 5 from file`.
  - `it('W24-R2: file mode reads ccrc.env alone')`:
    - environment 7, file 5, `_ccrc_knob CCRC_BACKUP_KEEP 10 file` → `val 5 from file`;
    - environment 7, no line, `_ccrc_knob CCRC_BACKUP_KEEP "" file` → `rc 0 val  from default`.
  - `it('W24-R3: a name outside CCRC_SETTINGS is never read, from the file or the environment')`. File `CCRC_ACCOUNTS=/x`, environment `CCRC_ACCOUNTS=/y`, `_ccrc_knob CCRC_ACCOUNTS ""` → rc 1, `val ` empty, why exactly `CCRC_ACCOUNTS is not one of ccrc's settings (CCRC_SETTINGS), so it is never read from a file`.
  - `it.each(SETTINGS)('W24-R4: %s — unmeasured is not unset: an export line, a NUL byte and an unreadable file each refuse')`. `SETTINGS` is parsed from `ccd/ccrc`'s `CCRC_SETTINGS=` line, never typed. For each name K:
    - `export K=5\n` → rc 1, why `K cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take (it reads only a plain KEY=value line)`;
    - `NOTE=x\0y\n` → rc 1, why `K cannot be measured: ~/.ccrc/ccrc.env could not be scanned`;
    - mode 000, skipped as root → rc 1, why `K cannot be measured: ~/.ccrc/ccrc.env is there but cannot be read`.

    The NUL and mode-000 shapes name no setting at all, so they also prove a whole-file fault refuses every key (D-6587). Then the same three shapes through `_keep_knob` for the three keeps: rc 1 and `KEEP_WHY` exactly the `KNOB_WHY` above, never a `'' is not a whole number` sentence.
  - `it('W24-R5: the exposure file is never read for a setting')`. `~/.ccrc/exposure.env` holds `CCRC_BACKUP_KEEP=2`, `ccrc.env` holds `CCRC_ROLE=server` → `val 10 from default`.
  - `it('W24-R6: another file is read only when the caller names it, and only for that call')`. `BOX_ENV_FILE="$HOME/other.env" _ccrc_knob CCRC_UPDATE_DEADLINE_MS "" file`, with `other.env` holding `CCRC_UPDATE_DEADLINE_MS=600000`, then `echo "after $BOX_ENV_FILE"` → `val 600000 from file` and `after <home>/.ccrc/ccrc.env`.
  - `it('W24-R7: an empty value in ccrc.env reads the default, and says it was named empty')`:
    - `CCRC_VERSIONS_KEEP=\n` → `rc 0 val 3 from empty`;
    - file mode, `CCRC_UPDATE_DEADLINE_MS=\n`, `_ccrc_knob CCRC_UPDATE_DEADLINE_MS "" file` → `rc 0 val  from empty`, never `from default`.
  - `it('W24-R8: a knob-less ccrc.env the Darwin model cannot decide reads the default for every setting but CCRC_BACKUP_DATA_KEEP, which keeps wave 23\'s departure')`. `NOTE=café\n`:
    - `CCD_OS=linux`, `_ccrc_knob CCRC_VERSIONS_KEEP 3` → `rc 0 val 3 from default`;
    - `CCD_OS=darwin`, the same call → `rc 0 val 3 from default` (D-6587: a file that never spells the key cannot set it for a ccrc read);
    - `CCD_OS=darwin`, `_ccrc_knob CCRC_BACKUP_DATA_KEEP 3` → rc 1, why starting `CCRC_BACKUP_DATA_KEEP cannot be measured: ~/.ccrc/ccrc.env line 1 is not a plain NAME=value line` (wave 23's ratified departure 1, kept);
    - `CCD_OS=darwin`, file `CCRC_VERSIONS_KEEP=2\nNOTE=café\n` → rc 1, why starting `CCRC_VERSIONS_KEEP cannot be measured: ~/.ccrc/ccrc.env line 2 is not a plain NAME=value line` (named, so the model is asked, and it refuses the whole file).

    `CCRC_PROJECTS_ROOT=~/code` and a CRLF file are the review's other knob-less shapes; the worker adds them as `it.each` cases of the second bullet if they cost no new helper.
  - `it('W24-R9: _keep_knob is the one bounded keep')`: (Fix round 1, D-6605: each invalid-value sentence below now ends `, as set in the environment` or `, as set in the box's ccrc.env`, by the source that won.)
    - file `CCRC_BACKUP_KEEP=0002` → `rc 0 keep 2`;
    - file `x` → rc 1, `CCRC_BACKUP_KEEP='x' is not a whole number from 0 to 9999`;
    - `_keep_knob CCRC_BACKUP_DATA_KEEP 3 2` with file `1` → rc 1, `CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999`;
    - environment `CCRC_BACKUP_KEEP=٣` → rc 1, the `_keep_why` sentence with the value sanitised.
  - Added by fix round 1 (F12, D-6605): `it('W24-R16: a keep refused for its value names where the value came from (D-6605)')`. ccrc.env `CCRC_ROLE=both` and `CCRC_BACKUP_KEEP=5` with the environment `CCRC_BACKUP_KEEP=' '` → exactly `rc 1 keep  why CCRC_BACKUP_KEEP=' ' is not a whole number from 0 to 9999, as set in the environment`; file value `x` → `… 'x' … 9999, as set in the box's ccrc.env`; neither output holds `CCRC_ROLE`, so no other byte of the file prints. The mutant that drops `, as set in $KEEP_FROM` reds this row, W24-R9 and the uninstall suite's two bounded-number rows.
  - Added by fix round 1 (F5): `it.each(['linux','darwin'])('W24-R15: a CRLF comment naming CCRC_RELEASE_BASE_URL beside the odd line reads the default')`: `# CCRC_RELEASE_BASE_URL=https://mirror.example/releases` with a CRLF ending, beside the platform's odd line (the UTF-8 `CCRC_VAPID_SUBJECT=mailto:josé@…` line on Linux), alone and inside a copy of the example → `rc 0 val … from default`. The mutant that turns the count clause `|| /\r./` into `|| /\r/` (a CR that ends the line counted as a second line) reds it; W24-R9 to R14 and W23-B17 did not.
- [ ] **Step 2: Run them red.** `./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'W24-R' --pool=forks --maxWorkers=1`. Expected: every row red, because `_ccrc_knob` and `_keep_knob` do not exist (`command not found` in stderr, the echo's values empty).
- [ ] **Step 3: Implement.**
  1. `CCRC_SETTINGS` as above, one line, at the top level above the new functions, with a header comment saying it is the one list (D-6587) and that the census derives from it.
  2. `_ccrc_knob`: its body is `_bak_data_keep`'s read (:23715-23724) with `CCRC_BACKUP_DATA_KEEP` replaced by `$key` (the awk `-v k="$key"`, the model's `_box_unit_env "$key"`), the out-params renamed, and four additions in this order:
     - the known-name check (`case " ${CCRC_SETTINGS[*]} " in *" $key "*)`), first;
     - `[ "${3:-}" = file ] || KNOB="${!key:-}"`;
     - `KNOB_FROM` set as it resolves, `empty` when the model answered `BUE_NAMED=1` with `BUE_VAL=""`;
     - the default applied last when `KNOB` is empty.

     The model's condition becomes `[ "$g" = 1 ] || { [ "$g" = 4 ] && [ "${CCD_OS:-linux}" = darwin ] && [ "$key" = CCRC_BACKUP_DATA_KEEP ]; }` (D-6587), one line for one.

     Move the header's argument (the scan, the model, the NUL refusal, why the exposure file is excluded) from `_bak_data_keep` to here, generalised. Reword its macOS residual: a console-driven update never runs on macOS (`_upd_detach_os_check`), so a value in the exposure file reaches no act there. Replace "on macOS the model is asked whatever the scan says" with D-6587's rule: on both platforms the model is asked when the file names the key, and on macOS also for `CCRC_BACKUP_DATA_KEEP` whatever the scan says (wave 23's departure, kept), with D-6587's argument for why the Linux rule serves every other setting there. Drop "The same fallback is harmless in `_upd_deadline_ms`": D-6591 replaces it.
  3. `_keep_knob`: its first line is exactly `_ccrc_knob "$1" "$2" || { KEEP=""; KEEP_WHY="$KNOB_WHY"; return 1; }` (D-6589). Then `_keep_ok "$KNOB"` and `[ "$((10#$KNOB))" -ge "${3:-0}" ]`, then `KEEP=$((10#$KNOB))` and `KEEP_FROM` from `KNOB_FROM` (`environment` → `the environment`, `file` → `the box's ccrc.env`, else `the default`), else `KEEP_WHY="$(_keep_why "$1" "$KNOB" "${3:-0}")"`.
  4. `_bak_data_keep` becomes the three-line wrapper (D-6589). Its header shrinks to the contract and a pointer to `_ccrc_knob`.
- [ ] **Step 4: Run them green**, then the whole W23 describe unchanged: `-t 'W23: update and ccrc backup thin'`. Every W23 row is green at this point, because Task 1 changes no refusal's reach. Then `bash -n ccd/ccrc`, `GROWTH_CHECK=1 … growth-check`, `citations`.
- [ ] **Step 5: Mutation rows.** Each measured red, then restored:

  | Mutation | Expected red |
  |---|---|
  | delete the known-name check | W24-R3 |
  | delete `[ "${3:-}" = file ] \|\|` (file mode reads the environment) | W24-R2 |
  | read the file before the environment | W24-R1 |
  | on an unmeasured file, `return 0` with the default | W24-R4 (all three shapes, every setting) |
  | `CCRC_EXPOSURE_FILE="$f/."` → `CCRC_EXPOSURE_FILE=` | W23-B17's UNDECIDED pinned row (wave 23's ruling on review 839) |
  | `_keep_knob` ignores its third argument | W24-R9's lowest row, W23-B3 |
  | drop `_keep_knob`'s first line (an unmeasured file reaches `_keep_why` with an empty value) | W24-R4's `_keep_knob` cases, W23-B17's export row |
  | `${!key:-}` → `${!key-}` (an exported empty value is no longer unset) | W24-R1's fourth case |
  | report a named-empty line as `default` | W24-R7 (both cases) |
  | drop `&& [ "$key" = CCRC_BACKUP_DATA_KEEP ]` (macOS always asks for every setting, revision 1's rule) | W24-R8's second case |
  | drop the whole Darwin `g = 4` arm (macOS never asks without the key) | W24-R8's third case, W23-B17's Darwin twin |
- [ ] **Step 6: Commit.** `feat(ccrc): one reader for ccrc's own settings — the environment, else ccrc.env, else the default (wave 24, D-6587, D-6589)`.

### Task 2: the keeps read ccrc.env, and each refused keep stops only its own act (W24-b; D-6589, D-6590, D-6596)

**Files:**
- Modify `ccd/ccrc`:
  - `_bak_prune` (:23576-23613) and its header (:23563-23575);
  - `_bak_gc`'s keep lines (:23832-23838), its prune loop's `for` line (:23861), its `pruned` line's keep clause (:23866), its thin line (:23873) and its final `return` (:23875);
  - `_ver_gc` (:24145-24156);
  - `cmd_versions` (:24250, :24263-24271, :24301, :24340).
- Test:
  - `server/test/ccrc-update.test.ts`, the W23 describe: the rewrites under "Pins this wave changes on purpose" (the line-fault and whole-file-fault classes apart), and new rows at its end;
  - `server/test/ccrc-versions-warn-arms.test.ts`;
  - the scrub lists, `nodeEnv`'s in `server/test/updateIntentFixtures.ts` included.

**Interfaces:**
- Consumes: Task 1's `_keep_knob`, `_bak_data_keep`.
- Produces: `_bak_gc <update|rollback>` rc 0 done or nothing to do; rc 1 when a setting was refused, a step skipped or a removal failed. It never dies. `_bak_prune` returns 1 when a refusal was printed.

- [ ] **Step 1: Write the failing rows** (nested at the end of the W23 describe): `describe('W24: a refused keep stops only its own act (D-6590)')`. (Fix round 1, D-6605: every invalid-value sentence below, B1 to B4 included, now ends `, as set in the environment` or `, as set in the box's ccrc.env` before the dash; the rows pin it.)
  - `it('W24-B1: an update with CCRC_BACKUP_DATA_KEEP=1 prunes by count and thins nothing')`. Twelve earlier code-only dirs (`plantDir` kind with neither data nor tree), `CCRC_BACKUP_KEEP=10`, sourced `_bak_gc update` under a floor:
    - stdout matches `/^update: backups: WARN: CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999 — nothing thinned$/m`;
    - the two oldest are pruned (their `pruned \$HOME/ccrc-backups/<ts>` lines);
    - no `thinned` line; `rc 1`.
  - `it('W24-B2: an update with CCRC_BACKUP_KEEP=x thins and prunes nothing by count')`. Five earlier full dirs (`plantFull`), the default data keep:
    - `/^update: backups: WARN: CCRC_BACKUP_KEEP='x' is not a whole number from 0 to 9999 — nothing pruned$/m`;
    - no `pruned` line; the two oldest full dirs list `['agent-dist', 'coordination-thinned.json']`; `rc 1`.
  - `it('W24-B3: a rollback never reads CCRC_BACKUP_DATA_KEEP')`. `CCRC_BACKUP_DATA_KEEP=1` in the environment, twelve code-only dirs, `_bak_gc rollback`:
    - two pruned, stdout never matches `/CCRC_BACKUP_DATA_KEEP/`, `rc 0`.
  - `it('W24-B4: ccrc backup says each refusal on stderr, runs the other act, and exits 1')`:
    - `CCRC_BACKUP_DATA_KEEP=1`, `CCRC_BACKUP_KEEP=0`, four full dirs → exit 1; stderr `/^ccrc: CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999 — nothing was thinned$/m`; the three older planted dirs pruned; the keep-set's data keep and this run's own left; no `thinned` line;
    - `CCRC_BACKUP_KEEP=x` → exit 1; stderr `/^ccrc: CCRC_BACKUP_KEEP='x' is not a whole number from 0 to 9999 — nothing was pruned$/m`; thinned lines present;
    - both → exit 1; both stderr lines; every planted dir byte-identical (`fingerprint`).
    - the lock held by another process (a `flock` child holding `~/.ccrc/update.lock`), `CCRC_BACKUP_DATA_KEEP=1` → exit 1: the `prune skipped — another ccrc run holds …` line AND the refusal line, never exit 0 (D-6590: every early return returns 1 after a refusal).
  - `it('W24-B5: an update with both refused touches nothing and returns 1 before the lock')`. Both WARN lines, `rc 1`, every dir byte-identical, and no `~/.ccrc/update.lock` created by this call where none was before.
  - `it('W24-B6: a ccrc.env no reader can scan refuses both keeps at once, in _bak_gc and in ccrc backup')`, for mode 000 (skipped as root) and a NUL byte (`Buffer.from('NOTE=x\0y\n')`), with no `CCRC_BACKUP_KEEP` in the environment:
    - `_bak_gc update` → both WARN lines (`CCRC_BACKUP_KEEP cannot be measured: … — nothing pruned`, `CCRC_BACKUP_DATA_KEEP cannot be measured: … — nothing thinned`), `rc 1`, every dir byte-identical, no lock file created;
    - `ccrc backup` → exit 1, both stderr lines (`ccrc: CCRC_BACKUP_KEEP cannot be measured: … — nothing was pruned`, `ccrc: CCRC_BACKUP_DATA_KEEP cannot be measured: … — nothing was thinned`), the planted dirs byte-identical (this run's own new backup is the only new dir).
  - `it('W24-B7: the prune line says where its keep came from')`. Twelve code-only dirs, `_bak_gc update`:
    - ccrc.env `CCRC_BACKUP_KEEP=10`, no environment → each `pruned` line contains `(kept: the newest 10 timestamped backups (CCRC_BACKUP_KEEP from the box's ccrc.env),`;
    - environment 10 → `(CCRC_BACKUP_KEEP from the environment)`;
    - neither → `(CCRC_BACKUP_KEEP from the default)`.
  - `it('W24-P1: under env -i (a detached run, a timer, an ssh shell), ccrc backup reads CCRC_BACKUP_KEEP from ccrc.env')`. Spawn `env -i HOME=<home> PATH=<the row's PATH> TMPDIR=<home>/tmp bash <repo>/ccd/ccrc backup` with ccrc.env `CCRC_BACKUP_KEEP=2` and four earlier plain dirs: exactly two timestamped dirs remain, this run's own and the newest planted.
  - `it('W24-P2: a set environment wins over ccrc.env')`. The same, with `CCRC_BACKUP_KEEP=3` added to the `env -i` list: three remain.
  - `it('W24-P3: with neither, the default 10')`. Eleven earlier plain dirs, no line: ten remain.
  - `it('W24-P5: no unit or detached argv carries a CCRC_ setting, so the reader\'s file read is the only source')`:
    - `deploy/systemd/ccrc-update-watchdog.service` and `deploy/systemd/ccrc-models.service` have no `EnvironmentFile=` line and no `Environment=` line naming `CCRC_`;
    - no code line of `_upd_detach`'s or `_svc_run_detached`'s body (sliced from `ccd/ccrc`, `#` lines dropped: `_upd_detach` has a comment naming `--setenv=PATH=…`) carries `--setenv`, `-E ` or a `CCRC_[A-Z0-9_]+=` assignment. The detached argv is `/bin/sh -c 'PATH=… exec ccrc "$@"'`, so the run's only source of a setting is the reader.
  - In `ccrc-versions-warn-arms.test.ts`, `it('W24-P4: CCRC_VERSIONS_KEEP from ccrc.env reaches _ver_gc and cmd_versions; the environment wins; an export line refuses the prune and lets the listing run')`. Reuse its fixture builder (:51):
    - ccrc.env `CCRC_VERSIONS_KEEP=1` with no environment → one complete version kept beyond the needed set; environment 2 → two;
    - `export CCRC_VERSIONS_KEEP=1` → `_ver_gc update auto` prints `/^update: versions: WARN: CCRC_VERSIONS_KEEP cannot be measured: .* — nothing pruned$/m`, and `cmd_versions` prints `versions: WARN: … — listing only; nothing would be pruned` and lists, each kept tree's verdict `kept: CCRC_VERSIONS_KEEP could not be used (the WARN above says why)`, the summary `CCRC_VERSIONS_KEEP=(could not be used)`, and no line saying `is not a whole number` (D-6596).
  - Rewrite in place every row listed under "Pins this wave changes on purpose" (D-6590's strings, and the count prune's result at the row's `CCRC_BACKUP_KEEP`).
- [ ] **Step 2: Run them red.** `-t 'W24: a refused keep'`, then `-t 'W23'`: B1, B3, B4, B6, B7 and P1-P4 red, plus the rewritten W23 rows (they still see `— nothing pruned or thinned` and an unpruned set); B2, B5 and P5 may already be green (record which). Then `ccrc-versions-warn-arms.test.ts -t 'W24-P4'` red.
- [ ] **Step 3: Implement.**
  1. `_bak_prune`: the four lines from `local keep=` to `keep=$((10#$keep))` become four:
     - the locals, with `r=0`;
     - `_keep_knob CCRC_BACKUP_KEEP 10` with its stderr line on rc 1;
     - `_bak_data_keep` with its stderr line on rc 1;
     - both refused returns 1.

     Every later `return 0` becomes `return "$r"`. The prune `for` line is prefixed `[ -n "$kwhy" ] ||`, and the `_bak_thin backup` line is prefixed `[ -n "$dwhy" ] ||`, both in place. Rewrite its header (:23563-23575) to D-6590's text.
  2. `_bak_gc`: the seven lines from `local lead=` to the `_bak_data_keep ||` line become four:
     - the locals;
     - `_keep_knob CCRC_BACKUP_KEEP 10 && { keep="$KEEP"; ksrc="$KEEP_FROM"; } || { kwhy=1; echo …; }` (captured at once: `_bak_data_keep` calls `_keep_knob` next and overwrites `KEEP` and `KEEP_FROM`);
     - `[ "$lead" != update ] || _bak_data_keep || { dwhy=1; echo …; }`;
     - `[ -z "$kwhy" ] || { [ "$lead" = update ] && [ -z "$dwhy" ]; } || return 1`.

     The prune `for` line and the thin line are guarded in place. The `pruned` line's `kept: the newest $keep timestamped backups,` gains ` (CCRC_BACKUP_KEEP from $ksrc)` before its comma, in place (D-6590). `[ -z "$kwhy$dwhy" ] || rc=1` goes before the final `return`.
  3. `_ver_gc`: `keep="${CCRC_VERSIONS_KEEP:-3}"` leaves the `local` line. `if ! _keep_ok "$keep"` becomes `if ! _keep_knob CCRC_VERSIONS_KEEP 3`, its two messages take `$KEEP_WHY`, and `keep=$((10#$keep))` becomes `keep="$KEEP"`.
  4. `cmd_versions`: the same three edits, and the two texts of D-6596 (:24301's verdict and :24340's summary), in place.
  5. Add `CCRC_BACKUP_KEEP`, `CCRC_BACKUP_DATA_KEEP` and `CCRC_VERSIONS_KEEP` to each scrub list that lacks them.
- [ ] **Step 4: Run them green.** `-t 'W24'`, the whole W23 describe, the pruner describes (`-t 'ccrc backup and update'`), `-t 'the KEEP knob is ONE bounded number'` (:10957). Then `ccrc-uninstall.test.ts -t 'ccrc backup'` (:1358, :1446, whose `_ccrc_die`-form KEEP sentences hold), `ccrc-versions-warn-arms.test.ts` whole, `ccrc-install.test.ts -t 'GC'` (:3626), growth, `citations`.
- [ ] **Step 5: Mutation rows.**

  | Mutation | Expected red |
  |---|---|
  | `_bak_gc` returns 1 when only `dwhy` is set (wave 23's reach) | W24-B1, the rewritten W23-B3 |
  | drop the prune loop's `[ -n "$kwhy" ] \|\|` | W24-B2 (a `pruned` line, or bash's arithmetic error on an empty keep) |
  | drop `[ "$lead" != update ] \|\|` before `_bak_data_keep` | W24-B3 |
  | `_bak_prune`'s final `return "$r"` → `return 0` | W24-B4 (exit 0) |
  | drop `_bak_prune`'s thin guard | W24-B4's first case (a `thinned` line) |
  | `_ver_gc` reads `${CCRC_VERSIONS_KEEP:-3}` again | W24-P4 (and Task 5's C3) |
  | in `_bak_gc`, let "both refused" fall through to `_ver_lock_try` | W24-B5 (a lock file created), W24-B6 |
  | `_bak_prune`'s lock-held skip returns 0 | W24-B4's lock-held case (exit 0) |
  | `_bak_gc`'s prune line drops its source clause | W24-B7 |
  | `cmd_versions`'s verdict back to `is not a whole number` | W24-P4's export case |
- [ ] **Step 6: Commit.** `feat(ccrc): the keeps read ccrc.env, and each refused keep stops only its own act (wave 24, D-6590, D-6596)`.

### Task 3: one deadline reading on both sides, the keep-set bounded on an update and a rollback, the gate window from ccrc.env (W24-c; D-6591, D-6592, D-6593, D-6601, D-6602)

**Files:**
- Modify `ccd/ccrc`:
  - `_upd_deadline_ms` (:19288-19298) and its header (:19276-19287);
  - `cmd_watchdog`'s deadline line (:19485);
  - `cmd_update`'s re-stamp line (:18661), in place, and the comment above it (:18650-18660) pointed at `_bak_restamp`;
  - `cmd_rollback`'s flip arm: one `_bak_restamp` line before `_bak_gc rollback || :` (:19178);
  - `_upd_gate` (:21251-21256);
  - `_bak_keepset` (:23633-23656) and its header (:23615-23632);
  - `_bak_snap_class`: the reset (:23771) and the pre-filter body (:23773), in place, and its header (:23757-23768);
  - new `_bak_restamp`, above `_bak_gc`'s header (:23803);
  - `_bak_gc`: the `until` line (:23872), moved to just before its `_bak_keepset` call (:23855), for both leads, with the hard-cap term; the keep-set rc arm (:23856-23860); its header (:23803-23830), whose "review 817 F4, a residual carried to wave 24" becomes D-6591's rule, and whose "never a rollback by flip" clause gains that a flip's keep-set is bounded too (D-6601).
- Test: `server/test/ccrc-update.test.ts`.

**Interfaces:**
- Consumes: Task 1's `_ccrc_knob`.
- Produces:
  - `_upd_deadline_ms [min|max]` → stdout milliseconds; rc 0 decided; rc 1 undecided, with stdout 900000 plain, 0 under `min`, and under `max` the largest decided reading (at least 900000).
  - `_bak_keepset [<until>]` → rc 0, 1 and 2 as before; rc 3 a time stop (only after a heavy call), all three out-params `""`.
  - `_bak_snap_class` also sets `BAK_SNAP_HEAVY` (0|1).
  - `_bak_restamp <detail>` → sets `UPD_THIN_AT`; never dies.

- [ ] **Step 0: Measure the spawn allowance (read only).** Before any edit, read where the server stamps `updateStartedAt` (server/src/update/) relative to the spawn, and whether a detached `ccrc update` or `rollback` child can wait (a lock, `_inst_migrate_resume`) before its first `_upd_phase`. Record the measured largest gap between the lease's start and the child's `startedAt`. If it can exceed 22 s (`UPDATE_SPAWN_TIMEOUT_MS + UPDATE_SPAWN_DRAIN_MS`), take a reserve number and use the measured figure (D-6601).

- [ ] **Step 1: Write the failing rows** (in Task 1's describe):
  - `it('W24-D1: the plain reading')`, each under `env -i` with HOME and PATH:
    - environment 700000 → `700000 rc 0`;
    - file 600000 → `600000 rc 0`;
    - neither → `900000 rc 0`;
    - environment `6e5` beside file 600000 → `900000 rc 1` (no fall-through);
    - file `6e5`, `0600000` or `600000.0` → `900000 rc 1`.
  - `it('W24-D2: min takes the smallest of the environment, ccrc.env and the exposure file, a named-empty file counts as 900000, and any reading it cannot decide makes it 0')`:
    - environment 1200000, ccrc.env `CCRC_UPDATE_DEADLINE_MS=` (empty) → `900000 rc 0` (the review's scenario a);
    - ccrc.env 1200000, exposure `CCRC_UPDATE_DEADLINE_MS=` → `900000 rc 0` (scenario b);
    - environment 700000, file 600000 → `600000 rc 0`;
    - plus exposure `CCRC_UPDATE_DEADLINE_MS=500000` → `500000 rc 0`;
    - exposure `+500000` → `0 rc 1`;
    - exposure mode 000, skipped as root → `0 rc 1`;
    - `ccrc.env` holding a NUL byte → `0 rc 1`;
    - no files, environment 700000 → `700000 rc 0`.
  - `it('W24-D3: _bak_gc update passes thin the smallest bound, and none it can use when the deadline is undecided')`. Reuse W23-B20's node shim:
    - exposure 600000 → `--until` equals the re-stamp's `updatedAt` + 600 − 235;
    - `ccrc.env` `6e5` → the D-6591 WARN line, exactly `update: backups: WARN: CCRC_UPDATE_DEADLINE_MS does not read as one whole number of milliseconds everywhere the server may take it from (the environment, the box's ccrc.env, the exposure file), so no verification starts this run past the keep-set's first full one — the next update continues`, and `--until` equals the re-stamp's `updatedAt` − 235;
    - a report whose `startedAt` is 3.5 deadlines back (written so by the shim, the re-stamp now): `--until` equals `startedAt + 4 × 900 − 40 − 235` (D-6603), the hard-cap term, earlier than the re-stamp's (D-6601).
  - `it('W24-D4: the watchdog warns on a deadline it cannot read and uses the largest it can')`. Reuse the watchdog fixture behind the `update in progress (installing, …)` rows (:8306), with `ccrc.env` `CCRC_UPDATE_DEADLINE_MS=6e5` and a report 700 s old:
    - stdout carries the D-6602 watchdog WARN line, then `watchdog: update in progress (installing, 70\ds old)`.
  - `it('W24-D5: the watchdog never wedges a live update the server still counts as inside its deadline')`. The same fixture with a live lock holder: environment `CCRC_UPDATE_DEADLINE_MS=300000`, `ccrc.env` `1800000`, the report 700 s old:
    - stdout has no `wedged` line and carries `watchdog: update in progress (installing, 70\ds old)` (lim is 1800, not 300); the report is not rewritten.
  - `it('W24-D6: _upd_deadline_ms max')`: environment 300000 beside file 1800000 → `1800000 rc 0`; exposure 2000000 → `2000000 rc 0`; a named-empty file beside environment 300000 → `900000 rc 0`; file `2e6` → `900000 rc 1`.
  - `it('W24-K1: past its bound the keep-set makes its first full verification and no other, and answers 3')`. Three earlier full dirs (`plantFull`: each holds a coord.db, so each call is heavy), the helper shimmed to answer `invalid` (W23's `withShim`, ccrc-update.test.ts:13324: a node shim first on PATH, never a redefined `_bak_snap_class`, so the pre-filter still runs), each call appended to a file. `_bak_keepset "$(( $(date +%s) - 1 ))"`:
    - exactly one call recorded, `rc 3`, `BAK_KEEP_SNAP`, `BAK_KEEP_DATA` and `BAK_KEEP_TREE` empty.
  - `it('W24-K2: before its bound, and with no bound, it walks until it finds a valid data set')`. The same fixture with the second dir `v1`, and `until` an hour ahead, then `""` → two calls each time, `rc 0`, `BAK_KEEP_DATA` the second dir.
  - `it('W24-K3: an update whose keep-set reaches the bound prunes and thins nothing')`. K1's fixture through `_bak_gc update` with `UPD_THIN_AT` set 700 s back:
    - the D-6592 WARN line, no `pruned` or `thinned` line, `rc 1`, every dir byte-identical.
  - `it('W24-K4: a walk of cheap calls is never stopped: manifest-only and code-only dirs past the bound prune by count')`. Five earlier `data: no` manifest-only dirs (only `coordination-snapshot.json`, the fleet box's shape) and two code-only dirs, `CCRC_BACKUP_KEEP=3`, `_bak_gc update` with `UPD_THIN_AT` 700 s back and the deadline undecided (`ccrc.env` `6e5`):
    - every dir classified (the call file lists five), `rc 1` only for the deadline WARN, no D-6592 WARN, and the count prune's `pruned` lines for the oldest beyond the keeps;
    - the same with the newest earlier dir a code-only deploy.sh backup and the rest manifest-only: the same result.
  - `it('W24-K5: a rollback by flip re-stamps and bounds its keep-set')`:
    - sourced `_bak_gc rollback` on K1's fixture with `UPD_THIN_AT` 700 s back → one classifier call, the D-6592 WARN, `rc 1`, nothing pruned;
    - the flip arm's text: in `cmd_rollback`'s body (sliced from `ccd/ccrc`), a `_bak_restamp ` line comes after `_upd_sweep` and directly before `_bak_gc rollback`;
    - a flip run in the rollback fixture (`rollback --to <kept tag> --from pwa`, the existing flip rows' harness, `git grep -n 'rolled back by flip' -- server/test/ccrc-update.test.ts`) writes a `restarting` report with detail `pruning ~/ccrc-backups` after its sweep and before `done`.
  - `it('W24-K6: the hard-cap term\'s literals are the control plane\'s')`, text only: the `until` line in `_bak_gc` carries `4 *` and `- 40`; `UPDATE_DEADLINE_HARD_CAP_FACTOR = 4` in server/src/update/dispatch.ts; and `(UPDATE_SPAWN_TIMEOUT_MS + UPDATE_SPAWN_DRAIN_MS) / 1000` parsed from shared/agent-protocol.ts, plus the ceiling `_upd_asset_listed` validates `CCRC_RELEASE_PROBE_MAX_TIME` against (the last argument of its `_upd_validate_timeout CCRC_RELEASE_PROBE_MAX_TIME` call in ccd/ccrc), equals 40 (D-6603). **Superseded by D-6744 (fix round 1):** the row now derives 63 = 22 + 2 × 18 + 5 from four sources (the two TypeScript constants, the probe ceiling parsed out of `_upd_asset_listed`, the health default parsed out of ccd/ccrc), pins that `_upd_fleet_warn` calls `_box_health` and that its curl carries `--max-time "$CCRC_HEALTH_TIMEOUT"`, and asserts the `until` line's literal equals the sum.
  - `it('W24-H1: the gate window is read from ccrc.env, the environment wins, and an unreadable line waits 90')`. A sourced `_upd_gate` with `_upd_gate_probe` redefined to fail, each case under `timeout 5`:
    - file `CCRC_UPDATE_HEALTH_S=0`, no environment → `update: gate FAILED after 0s` within the timeout;
    - environment 0, file `export CCRC_UPDATE_HEALTH_S=7` → fails at once, with no WARN;
    - file `export CCRC_UPDATE_HEALTH_S=0`, no environment → stdout `update: WARN: CCRC_UPDATE_HEALTH_S cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take (it reads only a plain KEY=value line) — using 90`, and `timeout` ends it (exit 124): still waiting at 5 s.
  - Added by fix round 1 (F6, D-6747): `W24-H2` ×4: `CCRC_UPDATE_HEALTH_S=9223372036854775808` and `99999999999999999999`, each from ccrc.env and from the environment, with `_upd_gate_probe` failing and `sleep` a no-op (the probe advances `SECONDS` by 30) → the WARN `… is not a number of seconds (digits only, at most 18) — using 90`, `update: gate FAILED after 90s — fixture: never up`, rc 1, never `integer expression expected`. `W24-H3` ×4: `120` and `000000000000000120` (18 characters), each from both sources → no WARN and `gate FAILED after 120s`, so an ordinary window is used as written (the review of the fix found no row pinned a 2 to 3 digit value as usable).
- [ ] **Step 2: Run them red.** `-t 'W24-[DKH]'`. Expected: D1's environment-`6e5` row red (today it falls through to the file); D2 and D6 red (`min` and `max` are ignored); D3, D4, D5, K1, K3, K5 and K6 red; H1's first row red (the file is not read). K2 is green; K4 may be green (record it).
- [ ] **Step 3: Implement.**
  1. `_upd_deadline_ms`, per D-6591 and D-6602, in about fourteen lines. The plain reading comes from `_ccrc_knob CCRC_UPDATE_DEADLINE_MS 900000` and the canonical test. Under `min` or `max`, the two `file`-mode readings go over `"$BOX_ENV_FILE"` and `"$CCRC_EXPOSURE_FILE"`, each through `BOX_ENV_FILE="$f"`, in one loop over the three; a `KNOB_FROM=empty` reading contributes 900000, a `default` one (the file does not name it) nothing. Rewrite the header: one reader, the `min` and `max` rules and their callers, why the smaller for the bound and the larger for the watchdog, why non-canonical is undecided, why named-empty is 900000.
  2. `cmd_watchdog`'s line becomes `deadline="$(_upd_deadline_ms max)" || echo "<the D-6602 watchdog WARN>"`, one line.
  3. `_upd_gate`: `limit="${CCRC_UPDATE_HEALTH_S:-90}"` leaves the `local` line. Add `_ccrc_knob CCRC_UPDATE_HEALTH_S 90 && limit="$KNOB" || { echo "update: WARN: $KNOB_WHY — using 90"; limit=90; }`. The existing digits `case` stays.
  4. `_bak_snap_class`: `BAK_SNAP_HEAVY=0` joins the reset line (:23771); the pre-filter body (:23773) becomes `if [ -e "$d/$n" ] || [ -L "$d/$n" ]; then any=1; [ "$n" = coordination-snapshot.json ] || BAK_SNAP_HEAVY=1; fi` (no `break`). Header: the cost word and why the loop no longer breaks.
  5. `_bak_keepset`: `local n i d src until="${1:-}" heavy=0`. Before `src=0; _bak_snap_class`, add one line: when `heavy` is 1, `until` is set and `date +%s` is at or past it, clear the three out-params and `return 3`. The call line becomes `src=0; _bak_snap_class "$d" || src=$?; [ "$BAK_SNAP_HEAVY" -eq 0 ] || heavy=1`, in place (the call is still spelled once). Header: the bound, why only a heavy call counts, rc 3.
  6. `_bak_restamp`, above `_bak_gc`'s header: D-6601's body, with a header naming its two callers. `cmd_update`'s line (:18661) and `cmd_rollback`'s new line call it (D-6601).
  7. `_bak_gc`: the `until` line moves above `_bak_keepset`, guarded by the same `UPD_THIN_AT` test, for both leads. Its `$(_upd_deadline_ms)` becomes `dl="$(_upd_deadline_ms min)" || echo "<the D-6591 WARN>"`, and the bound is D-6601's `min` of the re-stamp term and the hard-cap term (the latter only when `UPD_REPORT_STARTED` is whole seconds), less the margin. `_bak_keepset || krc=$?` becomes `_bak_keepset "$until" || krc=$?`. The rc arm's `echo` becomes `[ "$krc" -eq 3 ] && echo "<the D-6592 line>" || echo "<the classifier line, unchanged>"`, one line for one.
  8. Add `CCRC_UPDATE_DEADLINE_MS` and `CCRC_UPDATE_HEALTH_S` to the scrub lists that lack them (`updateEnv` already sets HEALTH_S to '0' explicitly; leave that).
- [ ] **Step 4: Run them green.** `-t 'W24'`; W23-B15, W23-B20 and the W23-T bound rows (`-t 'W23'`); the snapshot-classifier pin row (`-t '_bak_gc and _bak_prune each call _bak_keepset'`); the rollback flip rows (`-t 'rollback'`), with the report-sequence rewrites of "Pins this wave changes on purpose"; the watchdog describes (`-t 'watchdog'`); `update-watchdog-revert.test.ts` whole; `-t '_upd_gate'` and the gate rows (`-t 'gate'`); from the repo root's `server/`, `delegation-wave3.integration.test.ts -t 'journal'` (the journal-name pin). Then growth and `citations`.
- [ ] **Step 5: Mutation rows.**

  | Mutation | Expected red |
  |---|---|
  | `min` skips the exposure file | W24-D2's 500000 row, W24-D3's first case |
  | under `min`, a named non-canonical value is skipped as absent | W24-D2's `+500000` row |
  | under `min`, a named-empty file is skipped as absent | W24-D2's two named-empty rows |
  | the watchdog's line uses the plain reading again | W24-D5 (a `wedged` line) |
  | `cmd_watchdog`'s deadline line ignores `_upd_deadline_ms`'s rc | W24-D4 (no WARN line) |
  | `max` returns the smallest | W24-D6, W24-D5 |
  | `_bak_keepset` counts every call, heavy or not | W24-K4 (the D-6592 WARN, nothing pruned) |
  | `_bak_snap_class`'s pre-filter keeps its `break` (a manifest hides a coord.db) | W24-K1 (more than one call) |
  | `cmd_rollback`'s flip arm loses its `_bak_restamp` line (no `UPD_THIN_AT` on a rollback) | W24-K5's second and third cases |
  | `_bak_gc` computes `until` for an update only | W24-K5's first case (every call made, rc 0) |
  | the hard-cap term dropped | W24-D3's `startedAt` case |
  | a non-canonical environment value falls through to the file | W24-D1's environment-`6e5` row |
  | `_bak_keepset` ignores `until` | W24-K1 (three calls), W24-K3 |
  | `_bak_keepset` gates its first call too | W24-K1 (zero calls) |
  | `_bak_gc` passes `""` to `_bak_keepset` | W24-K3 |
  | `_upd_gate` uses 0 when the reader refuses | W24-H1's third row (fails at once) |
- [ ] **Step 6: Commit.** `feat(ccrc): one deadline reading on both sides, the keep-set bounded by it, and the gate window from ccrc.env (wave 24, D-6591, D-6592, D-6593)`.

### Task 4: the release mirror and the models budget read ccrc.env (W24-d; D-6594, D-6595)

**Files:**
- Modify `ccd/ccrc`:
  - `_upd_release_base` (:20513-20515);
  - `_upd_resolve`'s base line (:20584);
  - `_upd_asset_listed` (:21590, :21615);
  - `cmd_rollback`'s `_upd_asset_listed` case (:19085-19092): a `3)` arm before `*)`;
  - `_models_advance_budget_secs` (:11203), one line in place.
- Test: `server/test/ccrc-update.test.ts`, `server/test/ccrc-models-advance.test.ts`.

**Interfaces:**
- Consumes: Task 1's `_ccrc_knob`.
- Produces: `_upd_release_base` → rc 0 with the base on stdout; rc 1 with nothing on stdout and one stderr line, led `$PROG:`. `_upd_asset_listed` → 0 listed, 1 not (404), 2 the host could not be asked, **3 the base could not be read**.

- [ ] **Step 1: Write the failing rows.**
  - `it('W24-U1: the release base is the environment\'s, else ccrc.env\'s, else the derived default')`, a sourced `_upd_release_base` under `env -i HOME=<home> PATH=<PATH> TMPDIR=<home>/tmp`:
    - file `CCRC_RELEASE_BASE_URL=http://127.0.0.1:9/releases` → that;
    - environment `http://127.0.0.1:8/releases` beside it → the environment's;
    - neither → `https://github.com/` + the file's own owner and repo + `/releases`.
  - `it('W24-U2: a mirror line ccrc cannot read stops the update before anything changes')`. `ccrc update --to v9.9.9` in an update fixture whose ccrc.env holds `export CCRC_RELEASE_BASE_URL=http://127.0.0.1:9/releases`:
    - exit 1;
    - stderr is ONE line (fix round 1, F8): `ccrc: CCRC_RELEASE_BASE_URL cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take (it reads only a plain KEY=value line) — nothing on this box was changed`. The plan's first version asserted two lines, the reader's and a `could not be read (the line above says why)` die; the reader's own line is now silenced there, so the cause is stated once;
    - the curl shim records no call, and `~/ccrc` is unchanged.
  - `it('W24-U3: _upd_asset_listed answers 3 for the same line, and a rollback says the base, never curl')`:
    - sourced `_upd_asset_listed v9.9.9 SHA256SUMS; echo "rc $?"` → `rc 3`, the curl shim records no call;
    - `ccrc rollback --to v9.9.9` (a tag with no kept tree, so the release host is asked) → exit 1, stderr carries the reader's `ccrc: CCRC_RELEASE_BASE_URL cannot be measured: …` line and then `rollback: CCRC_RELEASE_BASE_URL cannot be measured: … — nothing on this box was changed` (fix round 1, F8: the die now carries `$KNOB_WHY`, where the first version said `could not be read (the line above says why)`), and never `curl failed`.
  - `it('W24-U4: on macOS a knob-less line the Darwin model rejects leaves the release base at its default, and a named base beside it refuses')`:
    - `CCD_OS=darwin`, ccrc.env `CCRC_ROLE=both\nCCRC_PROJECTS_ROOT=~/code\n` → sourced `_upd_release_base` prints the derived default, rc 0, nothing on stderr;
    - `CCD_OS=darwin`, `ccrc update --to v9.9.9` beside the same file reaches its curl shim (the base's SHA256SUMS URL recorded), never the D-6594 refusal;
    - `CCD_OS=darwin`, ccrc.env `CCRC_RELEASE_BASE_URL=http://127.0.0.1:9/releases\nCCRC_PROJECTS_ROOT=~/code\n` → rc 1, stderr `ccrc: CCRC_RELEASE_BASE_URL cannot be measured: ~/.ccrc/ccrc.env line 2 is not a plain NAME=value line…`.
  - `it('W24-U5: ccrc rollout\'s pin reads the deploying machine\'s base')`, only if the rollout harness reaches `cmd_rollout`'s pin (step 2) with no real box (find it with `git grep -n "rollout" -- server/test/ccrc-update.test.ts`): the deploying fixture's ccrc.env `export CCRC_RELEASE_BASE_URL=…` → exit 2, stderr the reader's line and `rollout: could not resolve the target release`, no ssh shim call. If no harness reaches step 2 without a new helper, the row is dropped and the as-built note says so; U2 covers `_upd_resolve`'s refusal. **Dropped, as built (Ledger R14).** Fix round 1 reused the name for a different row, below.
  - Added by fix round 1 (F8, F9): `it('W24-U5: a refused base\'s failed report says why, as a node fault, for update and rollback alike')`. `update --to v9.9.9 --from pwa` and `rollback --to v9.9.9 --from pwa` over an `export` mirror line; each asserts `update.json`'s `[phase, detail]` exactly: `failed` and the `KNOB_WHY` clause with no `provenance: ` lead. Mutants: `UPD_FAIL_PREFIX="provenance: "` before either die; either die back to the old sentence; `_upd_asset_listed` back to a subshell (`KNOB_WHY` lost) — each red.
  - Added by fix round 1 (F10): `it('a release base arm 2 cannot read is named as that, not as curl, and the restore child still decides')`, in the automatic restore's describe. The parent fetches through a plain `local://` line; the new tree's install appends an `export` line, so only arm 2's question meets the refusal → exit 4, the `3)` arm's sentence (with `$KNOB_WHY`) on stdout, the reader's line on stderr, no `curl failed`, and the child's argv. The mutant that deletes the `3)` arm, and the one that restores the old sentence, red it.
  - Added by fix round 1 (F11): `it('W24-U6: rollout names a box\'s refused check as the refusal it is, and ssh\'s 255, rc 0 and 127 each in their own words')`, a table of four legs on one ssh stub over the update fixture (a minimal copy of the rollout suite's ssh stub, R34): the box's real reader refuses (`its check refused (exit 1); the lines above say why — nothing was touched`, after the relayed `box: ccrc: CCRC_RELEASE_BASE_URL cannot be measured: …`), ssh's own 255 (`ssh failed (exit 255), so the check may not have run there`), a check that prints `nonsense` and exits 0 (the old question, `is ccrc installed there, and new enough to know --check?`), and a remote PATH with no ccrc (exit 127). Mutants: `|| crc=$?` back to `|| :`, the echo back to the old question, the `255)`, `0)` or `127)` arm deleted — each red.
  - Added by fix round 1 (F7, D-6748): three rows in the `update.json at every phase` describe with a ccrc.env `CCRC_RELEASE_BASE_URL=user:<synthetic>@127.0.0.1:1/rel` and a poisoned curl: the fetching line, the single `download failed:` die line and `update.json`'s detail and file never carry the credential. Unit controls on the `_upd_redact` row pin what stays (`curl: (6) user@host`, prose `a@example.com`, `@scope/pkg`, a query's email).
  - In `ccrc-models-advance.test.ts`, `it('W24-M1: the advance budget from ccrc.env turns the step off; the environment wins')`, using the file's `refresh` and `spy` helpers (:266, :551):
    - ccrc.env `CCRC_MODELS_ADVANCE_BUDGET_S=0`, no environment → no `_models_advance_lane` call;
    - the environment's 250 beside it → calls, as the default does.
  - `it('W24-M2: a budget line ccrc cannot read turns the step off and says why')`. ccrc.env `export CCRC_MODELS_ADVANCE_BUDGET_S=250` → no calls; stderr `ccrc: CCRC_MODELS_ADVANCE_BUDGET_S cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take (it reads only a plain KEY=value line), so the advance step is off for this run`.
- [ ] **Step 2: Run them red.** U1's first row, U2, U3, U4's third case, U5 (if written), M1's first row and M2 red. U4's first two cases are green (the base reads the environment only).
- [ ] **Step 3: Implement** D-6594 and D-6595 as written. `_upd_asset_listed` takes `local b; b="$(_upd_release_base)" || return 3` before its curl and uses `"$b"` in the URL. **Amended by fix round 1 (F8):** as built it is `local b; _upd_release_base >/dev/null && b="$KNOB" || return 3`, in the caller's shell, so `KNOB_WHY` reaches the caller; the subshell form is the mutant W24-U5 and W24-U3 kill. `cmd_rollback`'s case gains its `3)` arm (D-6594). `_upd_release_base`'s stderr line is led `$PROG:`. `_models_advance_budget_secs`'s first line becomes `local s; _ccrc_knob CCRC_MODELS_ADVANCE_BUDGET_S 250 && s="$KNOB" || { echo "$PROG: $KNOB_WHY, so the advance step is off for this run" >&2; s=0; }`. Add the two names to the scrub lists that lack them.
- [ ] **Step 4: Run them green**, then `ccrc-models-advance.test.ts` whole, the release-source pin describe, `-t '_upd_asset_listed'`, `-t 'release'` in ccrc-update, growth, `citations`.
- [ ] **Step 5: Mutation rows.**

  | Mutation | Expected red |
  |---|---|
  | `_upd_release_base` reads `${CCRC_RELEASE_BASE_URL:-…}` again | W24-U1's first row |
  | `_upd_resolve` ignores `_upd_release_base`'s rc | W24-U2 (a curl call recorded) |
  | `_upd_asset_listed` ignores it | W24-U3 |
  | `_upd_asset_listed` answers 2 for an unreadable base | W24-U3's rollback case (the curl die) |
  | `_ccrc_knob` asks the Darwin model for every setting whatever the scan (revision 1's rule) | W24-U4's first and second cases |
  | `_models_advance_budget_secs` reads the environment only | W24-M1's first row |
- [ ] **Step 6: Commit.** `feat(ccrc): the release mirror and the models budget read ccrc.env (wave 24, D-6594, D-6595)`.

### Task 5: the census guard, and the settings documented (W24-e; D-6597, D-6598)

**Files:**
- Create `server/test/ccrc-settings-census.test.ts`.
- Modify:
  - `deploy/ccrc.env.example`: its first line, :257-259, and a new last section;
  - `ccd/ccrc`: the usage `update` paragraph (:2498-2503), and the `backup` lines :2585 and :2589;
  - `README.md` :414, :846-848, :1169, :1203-1214, :1953-1961, and one paragraph after the maintenance verbs paragraph (every other line naming one of the seven is re-read and recorded, Step 3.3);
  - the wave-23 plan's Risk-notes line (carried item 6).

**Interfaces:**
- Consumes: Tasks 1 to 4's tree.
- Produces: the census, `describe('W24: every ccrc setting is read through _ccrc_knob, and every environment-only CCRC_ name is a reasoned exception (D-6598)')`.

- [ ] **Step 1: Write the census.**
  - **Inputs.**
    - The text of `ccd/ccrc` and `ccd/ccrc-doctor-checks`, with every line matching `/^\s*#/` dropped (its code lines).
    - `SETTINGS`, parsed from the one line `^CCRC_SETTINGS=\(([^)]*)\)$` of `ccd/ccrc`, split on spaces.
    - `ENV_ONLY: Record<string, { cls: 'call-bound' | 'fixture-path' | 'per-run' | 'rollout' | 'handshake' | 'constant'; why: string }>`, holding D-6588's 42 names. Each `why` is one sentence naming the header or function that makes it that class.
    - `HELPER_ENV_ONLY = { CCRC_SIGSTORE_TRUSTED_ROOT: 'deploy/verify-provenance.mjs reads it; a file line must never choose the provenance trust root' }`, read by C6 only.
    - `DEFAULTS`: for each setting, the second arguments of its literal calls, from `/\b(?:_ccrc_knob|_keep_knob) (CCRC_[A-Z0-9_]+) ("[^"]*"|\S+)/g`, the empty `""` (a file-mode call) dropped. Each setting must have exactly one distinct non-empty default (one default per setting is a rule of its own).
    - `SERVER_SETTINGS`: the literal keys ccrc reads from the server's files, with one reason each (they are the server's, read where the server reads them, D-6588): `CCRC_ROLE`, `CCRC_HOST`, `CCRC_PORT`, `CCRC_FLEET`, `CCRC_AUTH`, `CCRC_AGENT_URL`, `CCRC_AGENT_TOKEN`, `CCRC_MAIL_TOKEN_PATH`, `CCRC_AUTH_SECRET_PATH`, `CCRC_SESSIONS_PATH` (the last two through `_box_path_for`), and the exposure keys `CCRC_EXPOSE_MODE`, `CCRC_ORIGIN`, `CCRC_RP_ID`, `CCRC_DDNS_TOKEN`, `CCRC_DDNS_PROVIDER`, `CCRC_DDNS_DOMAIN`, `CCRC_CADDY_BIND`. Measured at the base from the code lines of both files; the base's two others, `CCRC_UPDATE_DEADLINE_MS` (`_upd_deadline_ms`) and `CCRC_BACKUP_DATA_KEEP` (`_bak_data_keep`), leave with this wave. The worker re-measures after the absorb.
    - `VAR_KEY_BODIES`: the function bodies that may pass a key in a variable to `_box_env_value`, `_box_unit_env` or `_box_unit_env_shell`: `_box_unit_env`, `_box_unit_env_shell`, `_box_path_for`, `cmd_expose` (its `for k in CCRC_ORIGIN CCRC_RP_ID CCRC_AUTH` loop) and `_ccrc_knob`. Measured at the base the same way.
    - `envReads(code)`: the union of the first groups of `/\$\{(CCRC_[A-Z0-9_]*[A-Z0-9]):?[-=+?]/g` and `/\b(?:_upd_validate_timeout|_acct_deadline) (CCRC_[A-Z0-9_]+)/g`.
  - **Rows.**
    - `it('C1: CCRC_SETTINGS is one line of unique CCRC_ names, none of them an ENV_ONLY name')`.
    - `it('C2: every setting is documented in deploy/ccrc.env.example: a "KEY=" or "# KEY=" line whose own block names the default the code uses')`. A setting's block is the `#` lines directly above its `# KEY=` line, up to (not including) the nearest bare `#` line, blank line or other `# KEY=` line. Joined with the `# ` stripped, the block must match `new RegExp('\\bDefault\\b[^.;]*\\b' + DEFAULTS[S] + '\\b')` when the default is a number, and `/\bDefault\b/` otherwise (the release base's default is an expression). And README's paragraph opening `**ccrc's own settings.**` names every member of `SETTINGS`.
    - `it('C3: no code line expands a setting, or reads one through _box_env_value, _box_unit_env, _upd_validate_timeout or _acct_deadline')`. For each S: no code line matches `new RegExp('\\$\\{?' + S + '(?![A-Za-z0-9_])')`, nor `new RegExp('\\b(?:_box_env_value|_box_unit_env|_upd_validate_timeout|_acct_deadline)\\b[^\\n]*\\b' + S + '\\b')`.
    - `it('C4: _ccrc_knob and _keep_knob take a setting by its literal name, every setting is taken somewhere, and only two calls pass a name in a variable')`:
      - the literal first arguments of `/\b(?:_ccrc_knob|_keep_knob) (CCRC_[A-Z0-9_]+)/g` equal `SETTINGS` as a set;
      - the calls with a `"$…"` first argument are exactly `_ccrc_knob "$1"` (in `_keep_knob`) and `_ccrc_knob "$k"` (in `_check_box-settings`).
    - `it('C5: every name read from the environment outside the reader is a reasoned exception, and every exception is still read')`. `envReads` of both files equals `Object.keys(ENV_ONLY)` exactly, in both directions, and the failure message prints both differences.
    - `it('C6: no exception is documented as a ccrc.env line')`. No `ENV_ONLY` or `HELPER_ENV_ONLY` name has a `^(# )?NAME=` line in the example.
    - `it('C7: ccd/ccrc keeps set -u, so a bare read of an unset name aborts and an unguarded read must spell the default C5 sees')`. A code line of `ccd/ccrc` matches `/^set -[a-z]*u[a-z]*o pipefail$/`. **Retitled by fix round 1 (F4, D-6746):** the plan's first title, `the census is complete only under set -u, which ccd/ccrc keeps`, claimed completeness the census does not have; the assertion is unchanged.
    - `it('C8: there is no second reader of a setting')`, over the code lines of both files, function bodies sliced as the W23 rows slice them (`^name\(\) \{[\s\S]*?\n\}$`):
      - (a) the literal keys passed to `_box_env_value`, `_box_unit_env`, `_box_unit_env_shell` and `_box_path_for` equal `SERVER_SETTINGS` as a set, in both directions, and none is in `SETTINGS`; a call whose key is a variable (`"$key"`, `"$k"`, `"$1"`) appears only inside a `VAR_KEY_BODIES` body;
      - (b) a non-array, non-prefix indirection (`/\$\{!(?![A-Za-z_][A-Za-z0-9_]*(?:\[@\]|@)\})/`: neither `${!arr[@]}` nor `${!PREFIX_@}`) and the whole-token awk program's fragment `index(t, k "=") != 1` appear only inside `_ccrc_knob`;
      - (c) no code line outside `_ccrc_knob` names a setting together with `BOX_ENV_FILE` or an `awk`, `sed`, `grep` or `cut` command word, except where the setting is the literal first argument of a `_ccrc_knob`/`_keep_knob` call on that line (`_upd_deadline_ms`'s `BOX_ENV_FILE="$CCRC_EXPOSURE_FILE" _ccrc_knob …` prefix form).
    - Added by fix round 1 (F4, D-6746): `it('C9: no nameref points at a setting')` (a `local`, `declare` or `typeset` whose option cluster holds `n`, with a setting after it); `it('C10: a -v test of a CCRC_ name reads the environment, so the name is a reasoned exception')` (never a setting, never unclassified); `it('C11: nothing sources the box env file but SOURCING_BODIES, by count')` (`.` or `source`, in command position, of `$BOX_ENV_FILE`, a `ccrc.env` path, a name bound to either, `<(…)` naming one, or `/dev/stdin <` one; the one allowed site is `_inst_plist_server`, count 1, both ways). The header's "what it does not catch" paragraph names the residuals (D-6746).
- [ ] **Step 2: Run it red.** `./node_modules/.bin/vitest run test/ccrc-settings-census.test.ts`. Expected:
  - C2 red for six settings (only the deadline has a line), and for the README paragraph (not yet written);
  - C3 red on the two `\$CCRC_BACKUP…` usage lines;
  - C1, C4, C5, C6, C7 and C8 green, since Tasks 1 to 4 built what they read. The example names `CCRC_RELEASE_BASE_URL` only in a comment's prose, never as a `KEY=` line, so C6 does not see it there. Record every row's measured state.
- [ ] **Step 3: Documentation.**
  1. `deploy/ccrc.env.example`:
     - The header's first paragraph (lines 1-4) gains the clause that the ccrc CLI reads its own settings (the last section) from the file too, rewrapped IN ITS OWN FOUR LINES, each at most 80 columns, so line 19 stays `CCRC_FLEET=local` (lifecycle.test.ts:405). A spelling that fits:

```
# ccrc server env — the ONE machine-config file for the server box, installed
# at ~/.ccrc/ccrc.env, read by ccrc.service (EnvironmentFile) and, for its
# own settings (the last section), by the ccrc CLI. Absent file = local mode
# on loopback defaults; every value overrides a default in server/src/config.ts.
```

       Measure `sed -n 19p deploy/ccrc.env.example` and `awk 'length > 80' deploy/ccrc.env.example` before and after.
     - :257-259 become: `# How long an update may run before the server calls it failed, in ms. Default`, `# if unset or not a positive integer: 900000 (15 minutes). The server reads it`, `# for the console's deadline, and ccrc reads it (the environment, else this file)`, `# to bound its thinning: write whole milliseconds, digits only, since any other`, `# spelling makes ccrc start no verification that run.`
     - Append this section, verbatim:

```
# ── ccrc's OWN SETTINGS (centralised update management, wave 24) — ALL OPTIONAL ──
#
# Read by the ccrc CLI on this box (update, rollback, backup, versions, models
# refresh, the update watchdog, a console-driven update), never by the server,
# which ignores them. ccrc reads each by name and never sources this file. The
# order: a value set in the process environment, else the line here, else the
# default. A console-driven update, the watchdog and the models timer run with
# no shell of yours, so a lasting setting belongs here. Write each as a plain
# KEY=value line: no export, no space around '=', no quote but one whole pair.
# A line ccrc cannot read that way stops only the act that reads it (it
# refuses, or falls back as its own text below says); it is never quietly the
# default. A file ccrc cannot read at all (unreadable, or holding a NUL byte)
# stops every act that reads a setting from it, and each says so. `ccrc
# doctor`'s box-settings check reads this file alone and names such a line.
#
# How many timestamped backups ~/ccrc-backups keeps, newest first; this run's
# own and the keep-set's keeps are never pruned. Default 10; a whole number
# from 0 to 9999. A value ccrc cannot use stops the count prune only.
# CCRC_BACKUP_KEEP=
#
# How many of those backups keep their coordination data set (coord.db, the
# delegation journal and checkpoint, the manifest); every older one keeps its
# code and coordination-thinned.json. Default 3; a whole number from 2 to
# 9999. A value ccrc cannot use stops the thinning only.
# CCRC_BACKUP_DATA_KEEP=
#
# How many complete versions ~/ccrc-versions keeps beyond the ones in use.
# Default 3; a whole number from 0 to 9999. A value ccrc cannot use stops the
# versions prune; `ccrc versions` still lists.
# CCRC_VERSIONS_KEEP=
#
# How many seconds an update's health gate waits for this box's unit (and,
# with a server, /health) to answer the new version before it restores the
# previous build. Default 90; digits only. A value ccrc cannot use waits 90.
# CCRC_UPDATE_HEALTH_S=
#
# The .../releases root `ccrc update` downloads from, for a mirror. Default:
# the GitHub releases of the owner/repo pair in this tree's ccd/ccrc. It may
# carry user:password@, which ccrc never prints. A line ccrc cannot read stops
# the update before anything on the box changes.
# CCRC_RELEASE_BASE_URL=
#
# The models refresh's time budget for its advance step, in seconds; 0 turns
# the step off. Default 250; a whole number, at most 3600. A value ccrc cannot
# use turns the step off for that run.
# CCRC_MODELS_ADVANCE_BUDGET_S=
#
# CCRC_UPDATE_DEADLINE_MS, in the update control plane section above, is read
# by both the server and ccrc.
```

  2. `ccd/ccrc` usage:
     - The `update` paragraph's :2498-2503 become exactly these six lines, each at most 78 columns (measure):

```
            After a passed gate and a finished sweep, ~/ccrc-backups is pruned
            to the newest CCRC_BACKUP_KEEP (default 10) timestamped backups,
            never this run's own; then every backup past the newest
            CCRC_BACKUP_DATA_KEEP (default 3) that carry the coordination
            data set is thinned to its code and coordination-thinned.json.
            Each setting here is the environment's, else the box's ccrc.env.
```

     - In the `backup` paragraph, `\$CCRC_BACKUP_KEEP` (:2585) becomes `CCRC_BACKUP_KEEP` and `\$CCRC_BACKUP_DATA_KEEP` (:2589) becomes `CCRC_BACKUP_DATA_KEEP`, in place with no rewrap.
  3. README:
     - :846's "(`CCRC_BACKUP_KEEP` from the process environment, default 10)" becomes "(`CCRC_BACKUP_KEEP`, default 10)".
     - :847-848's "(default 3, at least 2; the environment, else `~/.ccrc/ccrc.env`)" becomes "(default 3, at least 2)".
     - :1169's "(a `CCRC_VERSIONS_KEEP` that is not a whole number from 0 to 9999 is one)" becomes "(a `CCRC_VERSIONS_KEEP` that is not a whole number from 0 to 9999, or that `ccrc.env` names on a line the reader cannot take, is one)".
     - :1203-1206's "read from the process environment and else from `~/.ccrc/ccrc.env` alone, never `~/.ccrc/exposure.env`, which no process that thins receives on Linux; `0` and `1` are refused and an invalid value stops the prune and the thinning alike. So does a `ccrc.env` that is there but cannot be read, or that names the knob on a line the reader does not take." becomes "read as every ccrc setting is (below); `0` and `1` are refused, and an invalid value, or a line naming the knob that the reader does not take, stops the thinning only, while the count prune still runs (D-6590). A `ccrc.env` that is there but cannot be read at all stops both, and each says so."
     - :1212-1214's macOS sentence ("on macOS, whose launchd job sources the file with bash, one the model cannot decide still refuses") stays true for this knob alone (D-6587 keeps its departure); add "(this knob alone; every other setting reads the Linux rule there)".
     - **"Turning the step off" (:1953-1961) and its pointer (:414).** Rewrite the paragraph's setting sentences: the budget is read from the environment, else `~/.ccrc/ccrc.env`, else 250; a `CCRC_MODELS_ADVANCE_BUDGET_S=0` line in `ccrc.env` is the lasting place, and the hourly timer and a hand `ccrc models refresh` (the one `ccrc doctor`'s remedies name included) both honour it; a drop-in (`systemctl --user edit ccrc-models.service`, `[Service]`, `Environment=…`) still works as a one-unit override, because a set environment wins; a `ccrc.env` line ccrc cannot read turns the step off for that run and says why on standard error. Delete "`~/.ccrc/ccrc.env` does not set it: the unit reads no environment file, and `ccrc` never sources that one" (it never sources it still, and now reads it by name). The pointer at :414 ("for where `CCRC_MODELS_ADVANCE_BUDGET_S=0` must be set") becomes "for where to set `CCRC_MODELS_ADVANCE_BUDGET_S=0` (a `~/.ccrc/ccrc.env` line)". No test pins either paragraph at the base (`git grep -nE 'Turning the step off|does not read the drop-in|reads no environment file' -- server/test agent/test` is empty; re-run it after the absorb), which is why it went unseen; the anchor `#model-classes-per-lane-ccrc-models` is unchanged.
     - After the maintenance verbs paragraph, a new paragraph opening `**ccrc's own settings.**` says:
       - the seven names (C2 checks every one is named), and that `deploy/ccrc.env.example` documents each;
       - the precedence: the environment, else `~/.ccrc/ccrc.env` read by name as systemd reads it and never sourced, else the default;
       - that a console update, the watchdog and the models timer have no shell, so the file is where a lasting setting goes;
       - D-6590's line/file sentence: a line the reader cannot take stops only the act that reads it (D-6590 to D-6595, one clause each), and a file it cannot read at all stops every act that reads a setting from it;
       - that the thinning bound takes the smallest deadline reading, and the watchdog the largest (D-6591, D-6602);
       - that on macOS a file the model cannot decide refuses only the settings it names, and the data keep always (D-6587);
       - that `ccrc doctor`'s `box-settings` reads the file alone (D-6599).
     - **Every other README line naming one of the seven** is re-read: `git grep -nE 'CCRC_(BACKUP_KEEP|BACKUP_DATA_KEEP|VERSIONS_KEEP|UPDATE_HEALTH_S|UPDATE_DEADLINE_MS|RELEASE_BASE_URL|MODELS_ADVANCE_BUDGET_S)' -- README.md`. At the base that is :389, :414, :451, :846-847, :932, :959, :1117, :1168-1169, :1194, :1201, :1208-1209, :1943, :1953, :1958, :6595 and :6633. Expected unchanged, and why: :389 and :451 (the override's existence, true), :932, :959 and :1117 (the default and meaning, true), :1194 and :1201 (the range and count, true), :1208-1209 (the data knob's line grammar, the reader's own), :1943 (the budget's meaning), :6595 (deploy.sh's own prune, environment-only, "Not in this wave") and :6633. Also grep each README hit's paragraph for "process environment" and "does not set it". The as-built note records each line as checked, changed or not.
     - No `ccd/ccrc:NNN`. pools-prose.test.ts:779's end marker (`**Restore** (manual, from the target box`) is untouched.
  4. The wave-23 plan's Risk-notes line: "and is asked only when `ccrc.env`'s bytes name the knob as a whole token; a file that never names it reads 3 (D-6347, D-6365)" becomes "and is asked only when `ccrc.env`'s bytes name the knob as a whole token; on Linux a file that never names it, and holds no NUL byte, reads 3 (D-6347, D-6365), while on macOS the model is asked whatever the scan says". Nothing else in that plan changes.
- [ ] **Step 4: Run it green**, then `sed -n 19p deploy/ccrc.env.example` (still `CCRC_FLEET=local`), `lifecycle.test.ts`, `agent/test/deploy-verify.test.ts -t 'ccrc.service reads'` (from `agent/`), `ccrc-install.test.ts` whole (the path pin), `ccrc-cli.test.ts`, `collect-lane-restore-wording.test.ts`, `install-census.test.ts`, `pools-prose.test.ts`, `session-hook.test.ts -t 'CITATION DEBT'`, `docs-parity`, `citations`, `private-names`, `topology-clean`.
- [ ] **Step 5: Mutation rows.**

  | Mutation | Expected red |
  |---|---|
  | add `local x="${CCRC_NEW_KNOB:-5}"` inside `_bak_list` | C5 (an unclassified read) |
  | `_bak_gc`'s keep back to `"${CCRC_BACKUP_KEEP:-10}"` | C3 and C5 |
  | remove the example's `# CCRC_BACKUP_KEEP=` line | C2 |
  | add `CCRC_NEW_THING` to `CCRC_SETTINGS` | C2 and C4 |
  | add `_ccrc_knob CCRC_ACCOUNTS ""` to `_bak_list` | C4 (and W24-R3 at run time) |
  | add a fictitious `CCRC_GONE: { cls: 'call-bound', why: '…' }` to `ENV_ONLY` (nothing reads it; revision 1's row, deleting `_upd_validate_timeout CCRC_RELEASE_SPEED_TIME 30`, cannot red, since ccd/ccrc:2109's `:=` still reads that name) | C5 (a stale exception, naming `CCRC_GONE`) |
  | add `CCRC_HEALTH_TIMEOUT` to `CCRC_SETTINGS` | C1 |
  | add `_ccrc_knob "$name" 5` to `_bak_list` | C4 (a third variable first argument) |
  | change the example's `Default 10` for `CCRC_BACKUP_KEEP` to `Default 7` | C2 |
  | delete `Default 250; ` from the `CCRC_MODELS_ADVANCE_BUDGET_S` block | C2 (the bare `#` above bounds the block, so another block's `Default` no longer counts) |
  | drop `CCRC_VERSIONS_KEEP` from the README settings paragraph | C2 |
  | add `# CCRC_SIGSTORE_TRUSTED_ROOT=` to the example | C6 |
  | copy `_ccrc_knob` to `_ccrc_knob2` and call `_ccrc_knob2 CCRC_NEW_KEEP 5` in `_bak_list` | C8 (b): the indirection and the awk fragment outside `_ccrc_knob`; (a): a variable key in a body not listed |
  | add `v=$(sed -n 's/^CCRC_VERSIONS_KEEP=//p' "$BOX_ENV_FILE")` inside `_ver_gc` | C8 (c) |
  | add `_box_env_value "$BOX_ENV_FILE" CCRC_PORT_X` to `_bak_list` | C8 (a): a literal key outside `SERVER_SETTINGS` |
  | add `# CCRC_HEALTH_TIMEOUT=` to the example | C6 |
  | add `_box_env_value "$BOX_ENV_FILE" CCRC_VERSIONS_KEEP` to `_bak_list` | C3 |
  | `set -uo pipefail` → `set -o pipefail` | C7 |
- [ ] **Step 6: Commit.** `test(ccrc): a census keeps every ccrc setting on the one reader, and the settings are documented in ccrc.env.example (wave 24, D-6597, D-6598)`.

### Task 6: `ccrc doctor` reads ccrc.env's settings alone (W24-f; D-6599)

**Files:**
- Modify `ccd/ccrc-doctor-checks`: the `disk` entry (:198) becomes `  disk box-settings   # one line, as flock timeout: _check_box-settings is at the END of this file`, and `_check_box-settings` is appended at the end of the file.
- Test: `server/test/ccrc-doctor.test.ts`. Add a README line only if README lists doctor checks: find it with `git grep -n 'update-sweep' -- README.md`.

**Interfaces:**
- Consumes: `CCRC_SETTINGS`, `_ccrc_knob … file`, `_upd_redact`, `_dr_pass` and `_dr_warn` (dc:223-224).
- Produces: `_check_box-settings`, rc 0 PASS, rc 2 WARN.

- [ ] **Step 1: Write the failing rows** in a new describe, `'ccrc doctor: box-settings reads the box\'s ccrc.env alone (wave 24, D-6599)'`, using the file's doctor harness (its `installCcrc` tree and doctor run). Each row asserts the one `box-settings` line:
  - `it('W24-S1: nothing set')` → `/^PASS box-settings: the box's ccrc.env sets none of ccrc's settings\b/m`.
  - `it('W24-S2: a set line, and the environment does not change it')`. File `CCRC_BACKUP_KEEP=5`, environment `CCRC_BACKUP_KEEP=7` → PASS, matching `/CCRC_BACKUP_KEEP=5/`, and not `/=7/`.
  - `it('W24-S3: a line the reader refuses WARNs, even beside a set environment')`. File `export CCRC_BACKUP_KEEP=5`, environment 7 → `/^WARN box-settings: CCRC_BACKUP_KEEP cannot be measured: ~\/\.ccrc\/ccrc\.env names it on a line this reader does not take/m`, plus a `remedy:` line.
  - `it('W24-S4: a mirror\'s credentials never print')`. File `CCRC_RELEASE_BASE_URL=https://u:hunter2@mirror.example/releases` → PASS, the line does not contain `hunter2`.
  - `it('W24-S5: a named-empty line is reported as such')`. File `CCRC_UPDATE_DEADLINE_MS=` → PASS, matching `/CCRC_UPDATE_DEADLINE_MS= \(empty: the default\)/`.
  - Added by fix round 1 (F15, review 891), each `it.each(['linux','darwin'])`: `W24-S8` (a plain `CCRC_BACKUP_KEEP=5` and `CCRC_VERSIONS_KEEP=3` beside an unrelated UTF-8 `NOTE=café` line → WARN whose remedy starts with the model's own fix, once for the two settings, never the plain-line clause, no value or other byte printed); `W24-S9` (an inner-CR line → the model's CR fix); `W24-S10` (`export CCRC_BACKUP_KEEP=5` alone → today's remedy, exactly); `W24-S11` (causes mixed: the model fix, then `; for each other refusal, ` and the plain-line clause); `W24-S12` (an open quote on the setting's own line: Linux keeps today's remedy, macOS carries the model's line fix). The check resets the model's `BUE_FIX` and `BEW_CAUSE` before each setting and treats a cause as model-wide only when `BUE_FIX` is set and (macOS, or `BEW_CAUSE` names cr, nul or utf8). A NUL byte never reaches the model: its WARN says `could not be scanned` (the words an awk failure prints) and the remedy stays the generic one (R36). On Linux a quote left open or a trailing backslash on an EARLIER unrelated line gets the plain-line remedy, the model's per-key fix being dropped (R37).
- [ ] **Step 2: Run them red** (`-t 'box-settings'`). Then run the table census (:1580, :1695): it is red with the entry alone, and green with both.
- [ ] **Step 3: Implement** D-6599. Collect `set` (`KEY=value`, comma-joined; `KEY= (empty: the default)` for `KNOB_FROM=empty`), `unset` and `why` over `"${CCRC_SETTINGS[@]}"` with `_ccrc_knob "$k" "" file`.
  - Any rc 1 → `_dr_warn box-settings "$(_upd_redact "$why")" "rewrite each named line in the box's ccrc.env as a plain KEY=value line (deploy/ccrc.env.example shows each); until then the act that reads it refuses, or falls back as its line says"`.
  - Else → `_dr_pass box-settings "$(_upd_redact "the box's ccrc.env sets ${set:-none of ccrc's settings}${unset:+; not set there, so the default applies unless the environment sets it:$unset}")"`.
  - No role skip: every role reads its own settings.
- [ ] **Step 4: Run them green**, then `ccrc-doctor.test.ts` whole (the U and E tables, the auth describes, the table census), `ccrc-doctor-graphify.test.ts` (:608 reads the table), `citations`.
- [ ] **Step 5: Mutation rows.**

  | Mutation | Expected red |
  |---|---|
  | drop `file` from the check's call | W24-S2 (`=7`) |
  | treat rc 1 as unset | W24-S3 |
  | treat `empty` as unset | W24-S5 |
  | drop `_upd_redact` | W24-S4 |
  | drop the table entry | the table census (:1695, ORPHAN) |
- [ ] **Step 6: Commit.** `feat(doctor): box-settings reads ccrc.env's settings alone, so a line the environment hides is seen (wave 24, D-6599)`.

### Task 7: The gate and the PR

- [ ] **Step 1: The landing tip.** `git fetch origin main`, then rebase (before the first push) or merge (after it). Re-measure growth with run 722's line if #1132 has landed.
- [ ] **Step 2: The touched suites, one file at a time:**
  - whole: `ccrc-update.test.ts`, `ccrc-install.test.ts`, `ccrc-doctor.test.ts`, `ccrc-settings-census.test.ts`, `ccrc-versions-warn-arms.test.ts`, `ccrc-models-advance.test.ts`, `install-census.test.ts`, `ccrc-cli.test.ts`, `update-watchdog-revert.test.ts`, `ccrc-doctor-graphify.test.ts`, `update-intent-cross-side.test.ts` and `update-projection.test.ts` (`nodeEnv`'s users), `lifecycle.test.ts`, `delegation-wave3.integration.test.ts`;
  - by describe: `ccrc-uninstall.test.ts -t 'ccrc backup'` (its whole-file process-leak exit is main's, carried);
  - `history-lib.test.ts -t O53`, `deploy-env-guard.test.ts`, `macos-platform.test.ts`;
  - from `agent/`: `test/deploy-verify.test.ts`.
  - **Unmeasured, and so listed:** the Darwin arms of W24-R8 and W24-U4 under a real /bin/bash 3.2 (`test-macos` runs them, advisory); the rows run here under `CCD_OS=darwin` with this box's bash.
- [ ] **Step 3: The repo guards.** `GROWTH_CHECK=1 growth-check`, `citations`, `docs-parity`, `single-definition`, `topology-clean`, `private-names`, `dtbd`, `typecheck-tests`, `session-hook -t 'CITATION DEBT'`; then `git fetch origin main` and `deviation-refs`.
- [ ] **Step 4: R7, measured once** (carried item 5, never a row). In a scratch fixture HOME, write a `ccrc.env` holding one 64 KiB comment line that names `CCRC_BACKUP_KEEP`, then time `_ccrc_knob CCRC_BACKUP_KEEP 10` sourced, under `CCD_OS=linux` and under `CCD_OS=darwin`. Record both times in the as-built note. If either passes 5 s, say so in the wave-done.
- [ ] **Step 5: The wave-done.** The fingerprint is this branch's tip. The PR body says:
  - the rule, and the seven settings;
  - the census and its exceptions' classes;
  - the refusal table (D-6590 to D-6595);
  - the deadline's `min` and the keep-set bound;
  - the migration order (D-6600), word for word, with each step's actor (the operator's acts on a box, the coordinator's reads through `GET /api/updates` and relayed doctor lines), step 0's count, step 5's `unset-environment`, and the doctor line relayed at step 4;
  - the sibling-script operator settings (`CCRC_KEEPALIVE_MODEL`, `CCRC_KEEPALIVE_PROMPT`, `CCRC_USAGE_SWEEP_DAYS`, `CCRC_GRAPH_BUDGET`, `CCRC_GRAPH_MAX_WORKERS`) as an ask for a ledger row (Reading 9), and the census's stated scope (D-6598);
  - the macOS departure kept for `CCRC_BACKUP_DATA_KEEP` alone, as Reading 10;
  - growth measured;
  - every W23 row rewritten on purpose;
  - the macOS fleet-role observation (Not in this wave), as a report.
- [ ] **Step 6: Commit** the as-built note in this plan: `docs(plan): wave 24 as built`.

## Readings (for the coordinator to rule; each chosen where no ruling decided it)

1. **Which names are settings.** Chosen: D-6588's seven, plus the six environment-only classes with reasons. The alternative routes all 49 environment reads through the reader. That costs about 20 more lines, and nine of them are top-level `: "${X:=default}"` lines above line 11635 that run before any function exists, so they would need a second mechanism. It also turns test seams into documented settings.
2. **Own act only** (carried item 1). Chosen: a refused keep stops only its own act (D-6590). The alternative keeps wave 23's "stops both". It is simpler to state, but it lets a data-knob typo grow the disk without bound.
3. **A set but unreadable environment deadline.** Chosen: undecided, with no fall-through to the file (D-6591). The alternative keeps W4a's fall-through, under which a value the operator set is silently replaced by another source's.
4. **The keep-set's gate counts only full verifications, and the first is never gated** (D-6592). Chosen: so an undecidable or tiny deadline still lets the count prune run when the newest earlier data set is valid (the server box's steady state), and always when the backups hold no data set (the fleet box: its calls are all cheap). The alternatives: gate every call after the first (revision 1; it stops every fleet-box prune whenever the bound is past), or gate on elapsed wall time (it depends on the box's load).
5. **An unreadable mirror line refuses the update** (D-6594). The alternative WARNs and fetches from the default host. It is verified the same way, but it is the host the operator routed away from. A watchdog rollback by re-install refuses too; a rollback by flip needs no fetch.
6. **`CCRC_UPDATE_HEALTH_S` keeps no range** (Not in this wave). The alternative is 0 to 3600, with tests unchanged at 0.
7. **The doctor check prints values,** redacted (D-6599). The alternative prints names and sources only, which loses the step-4 reading of `=5`.
8. **`CCRC_MODELS_ADVANCE_BUDGET_S` is a setting** (D-6595), by its own header's off switch. The alternative leaves it a call bound.
9. **The sibling scripts' operator settings** (`CCRC_KEEPALIVE_MODEL`, `CCRC_KEEPALIVE_PROMPT`, `CCRC_USAGE_SWEEP_DAYS`, `CCRC_GRAPH_BUDGET`, `CCRC_GRAPH_MAX_WORKERS`; "Not in this wave"). Chosen: carried, with a ledger row the coordinator opens, because sharing the reader with scripts that never source ccd/ccrc needs a placed library file. The alternatives: this wave, through a shared reader file (a new install-census placement, and growth outside `ccd/ccrc`); or census rows for the sibling scripts now, so the guard at least lists them.
10. **macOS keeps "always ask the model" for `CCRC_BACKUP_DATA_KEEP` alone** (D-6587). Chosen: wave 23's departure 1 stays where the coordinator ratified it, and every other setting reads the Linux rule there. D-6587's argument (a ccrc never receives the launchd job's bash reading unless it was started by the job, and then that reading is its environment, which wins) applies to the data keep too. The alternative retires the departure, and a knob-less non-plain line on macOS then stops nothing at all.
11. **The watchdog takes the largest deadline reading for both of its thresholds** (D-6602). Chosen: one read, and it never wedges a live update sooner than any deadline the server may hold. The alternative takes `max` for the wedged threshold only and keeps the plain reading for the in-progress one (one more line), so a dead updater is probed sooner.

## Review notes (revision 1's plan review: 32 findings, lenses semantics-migration, tests-guards, scope-landing)

Each finding, numbered in the order the review listed it within its lens (SM, TG, SL), with its severity and what revision 2 did. Duplicates across lenses are answered once and pointed at.

- **SM-1 (major), a rollback by flip is unbounded:** fixed. `_bak_restamp` shared by `cmd_update` and `cmd_rollback`'s flip arm; `until` for both leads; W24-K5 and its mutation rows (D-6601).
- **SM-2 (major), macOS "always ask" extended to every setting:** fixed for six settings (the Linux rule on both platforms, D-6587's argument, R8's Darwin cases, U4). The part that would also retire it for `CCRC_BACKUP_DATA_KEEP` is **rejected for this wave**: the coordinator ratified that departure on review, and a plan does not reverse a ruling; Reading 10 asks.
- **SM-3 (minor), a named-empty deadline line:** fixed. `KNOB_FROM=empty`; it contributes 900000 under `min` and `max`; two W24-D2 rows, R7, S5, and a mutation row.
- **SM-4 (minor), the watchdog acts on a live updater:** fixed. `max` (D-6602), D-6591's false sentence removed, W24-D5 and D-6. The split (`max` for the wedge, plain for the probe) is not taken: Reading 11.
- **SM-5 (minor), a removed fragment lingers in the manager:** fixed. Step 5's `systemctl --user unset-environment` (the operator's), the prune line's source clause (W24-B7), step 6's check, and the rollback-below-the-floor note (D-6600).
- **SM-6 (minor), the installing update is not wholly old text:** fixed. Deploy class corrected (arm 2's child and the watchdog run the new tree), step 0's by-name count on both boxes, step 4 on both boxes.
- **SM-7 (minor), the hard cap:** fixed (D-6601, W24-D3's `startedAt` case, W24-K6). The "at most 22 s" between the lease start and the bash's `startedAt` is the review's claim, not yet measured from the server's code; Task 3's Step 0 measures it before any edit and takes a reserve number if it does not hold.
- **SM-8 (minor) and SL-2 (major), the gate counts cheap calls:** fixed by a cost word from the classifier's own pre-filter (D-6592, W24-K4, two mutation rows). The elapsed-time gate is not taken (Reading 4).
- **SM-9 (minor), `_keep_knob`'s unmeasured arm:** fixed, its first line spelled exactly (D-6589), R4's `_keep_knob` cases, a mutation row.
- **SM-10 (minor) and TG-11 (minor), executables outside the census:** fixed by naming each read with a class in "Not in this wave" and stating the census's scope in the Goal and D-6598; `CCRC_SIGSTORE_TRUSTED_ROOT` argued environment-only for good and known to C6. Extending C5 and C6 to every `deploy/*.mjs` helper and to `ccgpt-runtime`, `ccrc-models-probe` and `ccrc-codex` is **rejected for this wave**: those files have no shared reader to route through, and the directive's open question about them is Reading 9's.
- **TG-1 (major), no guard sees a second reader:** fixed. C8 (a, b, c) with `SERVER_SETTINGS` and `VAR_KEY_BODIES` measured at the base, and three mutation rows.
- **TG-2 (major) and SL-8 (minor), C2's block is unbounded:** fixed. A block ends at a bare `#`, a blank line or another `# KEY=`; it must name the default the code uses (`DEFAULTS`); the README paragraph must name every setting; three mutation rows.
- **TG-3 (major), the B18 rows:** fixed. Line faults and whole-file faults are listed apart, the B18 rows' new assertions spelled, W24-B6 added, and D-6590, the example and the README say that a file no reader can scan refuses every setting.
- **TG-4 (major) and SL-3 (major), README's "Turning the step off":** fixed. :1953-1961 and :414 rewritten in Task 5, and every README line naming one of the seven re-read and recorded.
- **TG-5 (minor), the C5 mutation cannot red:** fixed. A fictitious `ENV_ONLY` entry instead; the old row's flaw recorded in the table.
- **TG-6 (minor), missing mutation rows:** fixed, each added (C1, C4, W24-D4, W24-B5, `_bak_prune`'s lock-held skip as W24-B4's new case, `${!key-}`, the Darwin arms), and the overclaiming `min` row now expects W24-D2 only.
- **TG-7 (minor), `nodeEnv`:** fixed. `updateIntentFixtures.ts` joins Files and group A, behind the wave-28 claim check, and its users join Task 7's suites.
- **TG-8 (minor) and SL-6 (minor), `cmd_versions`'s texts:** fixed (D-6596, :24301 and :24340, W24-P4's export case, a mutation row).
- **TG-9 (minor), `_bak_prune`'s header:** fixed. In the consent list and Task 2, rewritten to D-6590.
- **TG-10 (minor), `env -i` drops TMPDIR:** fixed in Global Constraints and every `env -i` row.
- **TG-12 (minor), macOS update-level consequence:** fixed by SM-2's change, with W24-U4 at the update level.
- **TG-13 (minor), the example's line 19:** fixed. The header is rewrapped in its own four lines and line 19 measured; lifecycle.test.ts is not edited.
- **SL-1 (major), macOS release-base refusal:** answered with SM-2.
- **SL-4 (major), sibling-script operator settings:** classification corrected, Reading 9 added, and the PR body and wave-done ask for a ledger row. Doing them in this wave is **not chosen here**: it needs a placed shared reader (a new install-census placement), which is the coordinator's call on Reading 9.
- **SL-5 (minor), the deadline WARN's "no verification starts":** fixed, reworded and pinned in W24-D3.
- **SL-7 (minor), rollout's pin and the rollback's curl die:** fixed. The deploying machine's read is ruled and stated (the table, D-6594), `_upd_asset_listed`'s rc 3 with its own die in `cmd_rollback`, `$PROG:` as the lead, W24-U3's rollback case, and W24-U5 where the rollout harness reaches the pin.
- **SL-9 (minor), the soak's actors:** fixed. Step 2 is the coordinator's read of `GET /api/updates`; steps 0, 3, 4 and 5 are the operator's acts on the box.

## Coordinator rulings on this plan's readings (2026-10-23)

The coordinator read the plan whole and rules as follows. Where a ruling changes a count, a row list or a section,
the worker updates every place the plan states it, in the first task that touches it.

1. **The settings are D-6588's seven**, as chosen. Call bounds, fixture paths, per-run values, rollout coordinates,
   handshakes and constants stay environment-only, each in its named class, and the census holds the classes.
2. **A refused line stops only its own act**, as chosen (D-6590). A file no reader can scan stops every act that reads
   a setting, and each act says so in its own line.
3. **A set but non-canonical environment deadline is undecided**, as chosen (D-6591). It does not fall through to the
   file.
4. **The keep-set's gate counts full verifications only, and the first is never gated**, as chosen (D-6592).
5. **An unreadable mirror line refuses the update**, as chosen (D-6594), before anything on the box changes.
6. **`CCRC_UPDATE_HEALTH_S` keeps no range**, as chosen.
7. **The doctor check prints values**, as chosen (D-6599), for the seven names only, with a URL's userinfo masked. It
   never prints any other line of `ccrc.env`. Its rows go in a describe block of their own, appended to
   `ccrc-doctor.test.ts`, and no existing row there is edited.
8. **`CCRC_MODELS_ADVANCE_BUDGET_S` is a setting**, as chosen (D-6595).
9. **The sibling scripts' operator settings are carried**, as chosen. The coordinator opens a ledger row for them, a
   later wave with a shared reader file. This wave does not touch the sibling scripts, and the PR body names the row.
10. **macOS keeps "always ask the model" for `CCRC_BACKUP_DATA_KEEP` alone**, as chosen (D-6587).
11. **The watchdog takes the largest deadline reading for both thresholds**, as chosen (D-6602).
12. **Task 3 Step 0 decides D-6601's bound.** If the measured gap between the lease start and the child's `startedAt`
    breaks the plan's 22 s assumption, take a reserve number, state the bound the measurement supports, and say so
    in the wave-done. Never ship a bound the measurement does not support.
13. **Growth.** Measure `ccd/ccrc`'s net code lines at each task against `GROWTH_LIMIT`. If the wave would cross it,
    stop and report before taking any waiver.
14. **Claims.** Group A waits for run 722's consent on `ccd/ccrc` (requested in mail 8539), Group B for run 774's on
    README (mail 8540), and Group C for the holder of claim 2303's on the doctor files (mail 8541). The coordinator
    forwards each answer. A group whose consent is refused, or has not come when the other tasks are done, is split
    out, and the wave-done says which.
15. **The migration is D-6600's, and this wave asks no act on a box.** Step 2 is the coordinator's reading of
    `GET /api/updates`. Steps 0, 3, 4 and 5 are the operator's and the soak's coordinator's.
16. **A comment mention no longer names a setting** (final review Important 1; coordinator mail 8759). `_ccrc_knob`'s
    scan, in place with no growth, stops counting a line whose first non-blank character is `#` or `;` and that holds
    no CR inside it; a line with an inner CR keeps counting, as the scan never skips it. The data keep's macOS "always
    ask" (ruling 10) stays. Rows W24-R12 to R14 pin it on both platform models, and D-6600 step 0 counts assignment
    lines only. Why: a line whose first non-blank character is `#` or `;` can never assign a key for systemd (a
    continuation into it belongs to the line above, another key's value), so counting it refused a file for a key it
    never sets; with the example's `# KEY=` lines (D-6597), an ordinary copied file plus one unrelated odd line would
    stop every update fleet-wide. It narrows what counts as an assignment line; it does not loosen what is refused
    (D-6604).


## Coordinator rulings on review 891 (2026-10-24)

The coordinator's mail 8892 rules on review 891 (run 891's review of run 855 at `0754e84e2`), and asked that its body be recorded here verbatim. One substitution only: the review report's path under a session's clips directory, which names a session, is shortened to its file name (this repository is public).

Run 855, wave 24: fix round 1, ruled on review 891 (the review's report: review-891-0754e84e.md, at 0754e84e). Record this verbatim in the plan as "Coordinator rulings on review 891 (2026-10-24)". Eight numbers are issued to this round, D-6744 to D-6751. The rulings below define D-6744 to D-6749. D-6750 and D-6751 are your reserve, and D-6605 and D-6606 are still unspent.

The review found the wave as planned: the brief's 14 files, one settings reader, growth +23 of 39, every suite green but a teardown leak main shares. One finding is important: CI is red.

1. F1 (important). The three `spawnSync('env', ['-i', ...])` calls in ccrc-update.test.ts (about :14741, :14930 and :14983) go through the accepted bash runner, with the contained environment passed as Node's `env` option, which is what the raw-spawn census expects. Do not extend the census. raw-spawn-census must read 7 of 7 at your tip, as it does on main.

2. F2 (ruling, D-6744). The hard-cap term's `- 40` is replaced by the sum of the chain's own ceilings:
- the spawn's bound, `(UPDATE_SPAWN_TIMEOUT_MS + UPDATE_SPAWN_DRAIN_MS) / 1000`;
- the asset probe's ceiling (the last argument of `_upd_validate_timeout CCRC_RELEASE_PROBE_MAX_TIME`), counted twice: once for the parent's probe and once for the detached child's repeat probe;
- `_box_health`'s curl limit, for the fleet-health request before the first `_upd_phase`.
The `until` line carries the sum as one literal, and W24-K6 derives it from the four sources, so a change to any one of them reds it. A larger term only stops the thinning earlier, which is the safe direction. Re-run the review's fixture chain (17.95-second asset shims and a five-second health shim) and record that its measured gap falls below the new term. D-6744 names as residuals what no literal bounds: the transient unit's start under the service manager, and a lease stamped before its dispatch.

3. F3 (ruling, D-6745). Ruling 4 stands: the first full verification stays ungated. The guarantee narrows. The bound holds for every gated verification, but when the re-stamp is already late, the first verification can run past `until`, and past the hard cap, by one classifier call (W24-K1 measures one). Say so in the comment at about ccd/ccrc:23962, in the plan's D-6592 and D-6601 text, and in the example wherever it states the bound. There is no change in behaviour.

4. F4 (D-6746). The census guards the spellings it names; it is not a proof of completeness. Add a red-on-mutation row for each of the three survivors the review re-measured:
- a nameref to a setting;
- a read guarded by `[[ -v NAME ]]`;
- sourcing the box env file, in both the `set -a; . "$BOX_ENV_FILE"` form and the `source` form. This one matters most, because it is a whole second reader.
List the rest of what the review measured as named residuals in the census's header and in the plan, in place of "complete": `${#NAME}`, an expansion split by a backslash-newline, indirect calls through the timeout helper, environment reads from node or jq, a two-line file loop, and C6's spacing and export variants. Measure each new row red on its mutant, restored by cmp.

5. F5. Add the CRLF row: a CRLF `# CCRC_RELEASE_BASE_URL=` comment beside an unrelated model-fault line reads the default, and the count mutant (`/\r./` to `/\r/`) reds it.

6. F6 (D-6747). Ruling 6 stands for every value the shell can compare, zero included. A digits-only value it cannot compare (more than 18 digits, or one the integer test refuses) is an unusable value. It takes the example's documented path for an unusable value (it waits 90 and says so), never an early gate failure. Add rows for `9223372036854775808` and `99999999999999999999`, each from the file and from the environment.

7. F7 (D-6748). The owner of redaction is `_upd_redact`. It masks a base's userinfo with or without a scheme, as doctor's `box-settings` already does, so neither form leaves a credential in the fetching line, the error lines or `update.json`'s detail. Add a row for each of the three, using a synthetic credential. Doctor's mask stays as it is, but nothing relies on it alone.

8. F8 and F9. The reported detail of a base refusal carries the value-free KNOB_WHY clause. The refusal stays a node fault, not a provenance verdict. A report-level row asserts the detail's class, so that `UPD_FAIL_PREFIX="provenance: "` reds it.

9. F10, F11 and F12, in ccd/ccrc under your claim 2363:
- Restore arm 2 handles `_upd_asset_listed`'s rc 3 as the unreadable base it is.
- Rollout keeps a box's nonzero `update --check` refusal as its cause, instead of asking whether ccrc is installed or new enough.
- A keep refused for an invalid value names the source that won (the environment or ccrc.env) and prints no other byte of the file. The plan's mandated sentence is amended for this; spend D-6605 on it.
Growth: ruling 13 stands, with the stop line at 39 and +23 measured now. Take the code fixes in this order: F7, F6, F8, F10, F11, F12 (F1 is test-only). If the next fix would cross 39, stop there, record the rest in the as-built as carried to wave 29, and say so in the wave-done. No waiver.

10. F13. Qualify `cmd_backup`'s header (about ccd/ccrc:23555) and README's sentence that a lock-held skip does "nothing at all, exit 0" (in the maintenance verbs paragraph, about :1224). A skip returns 0 when the settings read, and 1 after a setting refusal (D-6590). That README sentence is outside your grant 8545, so I have asked run 774's coordinator for consent and will forward the answer whole. Do not edit that sentence until then; nothing else in the round waits on it.

11. F14 and F15. Inside your granted regions, the README's settings paragraph and the example name the model-wide causes (an unrelated UTF-8 NAME=value line, a line with an inner CR) beside unreadability and NUL. When the cause is model-wide, doctor's `box-settings` remedy carries the model's own fix (BUE_FIX).

12. F16 to F20, in the plan and the as-built:
- D-6600's migration note tells the single `CCRC_BACKUP_KEEP` line, which is safe before the new reader, from pasting the new commented section. An older reader counts `# CCRC_BACKUP_DATA_KEEP=` and refuses beside a model-fault line.
- D-6604's macOS residual is the family the review measured, and it exists only while the key is named on no assignment line.
- The base's Darwin behaviour is described as it was at `49e7f187a`, and the refusal of all six settings is named as this branch's revision before ruling 16.
- The as-built records every README setting hit as checked, changed or unchanged (Task 5).
- The as-built names the example's actual wording changes and the narrowing of the mirror sentence, with their rulings.

13. F21 (ruling, D-6749). The comment-only header changes are accepted: `_models_advance_budget_secs`'s three-line header, `_upd_release_base`, `_upd_gate`, `_upd_asset_listed` and `_ver_gc`. The source owner's condition held (the platform block is untouched and the citation census kept). Record each one in the as-built, and correct its one-line description of the hunk before line 11635.

Not in this round (the ledger carries them): `_inst_plist_server`'s fleet-role entry point, and install describe 35's teardown leak.

Gates, one file at a time, in the foreground:
- ccrc-update: the W24 and W23 describes and every describe this round touches;
- ccrc-settings-census, ccrc-doctor's box-settings describe, and raw-spawn-census;
- growth (GROWTH_CHECK=1), citations, docs-parity, single-definition, topology-clean, private-names, dtbd, typecheck-tests, and session-hook `-t 'CITATION DEBT'`;
- deviation-refs after `git fetch origin main`.
Mutations on a scratch copy under the plan's wrapper, restored by cmp. Scan the prose for private names. Measure merge-tree against main and #1245's head before the push; absorb main only on a conflict. Push once, wave-done in the same turn.

Claims 2359 and 2363 lapse at about 04:31 and 05:49 UTC. Re-take one before it lapses (a re-take mints a new id) and name the new ids in the wave-done.

Landing order: #1245 (wave 32, the fix for the trickle row's CI race) lands first, and #1237 absorbs it then.

## As built (run 855, 2026-10-23)

What shipped on the branch, how it departs from the text above, and what is still open. Written from the worker's
ledger and the per-task, fix-round and gate reports. A figure that no report measured is said to be unmeasured.
"Ledger R<n>" names the worker's own numbered rulings (the ledger is not in the repository, so each is stated here).
"Ruling 16" is the coordinator's ruling to this plan.

### Commits, in order

Branch base `49e7f187a`.

1. `800c9c808` docs(plan): the plan, as ruled.
2. `6377ba0cd` docs(plan): Task 3 Step 0 measured, the hard-cap term allows 40 s, not 22 (D-6603).
3. `cd954043b` feat: one reader for ccrc's own settings, the environment, else ccrc.env, else the default (D-6587, D-6589).
4. `cd2e85411` feat: the keeps read ccrc.env, and each refused keep stops only its own act (D-6590, D-6596).
5. `6df624aac` test: a rollback whose keep is refused returns before the lock (D-6590; Task 2's fix round 1).
6. `8b6e713bd` feat: one deadline reading on both sides, the keep-set bounded by it, the gate window from ccrc.env (D-6591, D-6592, D-6593).
7. `ebc6a6cca` feat: the release mirror and the models budget read ccrc.env (D-6594, D-6595).
8. `c95e68577` test: a census keeps every ccrc setting on the one reader, and the settings are documented in ccrc.env.example (D-6597, D-6598).
9. `780894fc5` test: the census's C8 names every second reader it finds, in all three parts at once (D-6598).
10. `c2746b307` fix: the settings reader prints nothing when its scan cannot run, and refuses as unscanned (D-6587; Task 6's first commit).
11. `80ca48234` feat(doctor): `box-settings` reads ccrc.env's settings alone, so a line the environment hides is seen (D-6599).
12. `37763260d` fix: final review, `box-settings` masks a mirror base's userinfo with or without a scheme, and the census and doctor rows close their gaps.
13. `fd32d90ae` fix: final review, the settings docs say what an unreadable ccrc.env, the deadline and a mirror's userinfo actually do.
14. `9d6d5c6bf` fix: a comment mention no longer names a setting, so one odd line cannot stop every update (ruling 16, D-6604).
15. `13de5f941` docs(plan, readme): ruling 16's macOS residual recorded, and its wording made exact (D-6604).
16. `96b94f097` test(ccrc-install): a fleet box's doctor now says `box-settings` PASS (D-6599; the gate's one red, below).
17. The as-built commit, which adds this section and defines D-6605 and D-6606 as unspent.

### Consents and claims

- `ccd/ccrc`: beside claim 2314 (request 8539, consent 8542). No edit at or near the platform block.
- README regions: beside claim 2306, later 2349 (request 8540, consent 8545; the owner's notice of the change is 8704).
  The settings paragraph went after the maintenance-verbs prose and before the next heading (Ledger R4).
- The doctor files and the install and uninstall scrub lists: beside claim 2303, later 2350 (requests 8541, 8555, 8737;
  consents 8543, 8557, 8739). Consent 8557 allowed the scrub lists to be extended in place with no row added; consent
  8739 allowed the one `awk` link line in `ccrc-doctor.test.ts`'s `healthy()` fixture.
- This run's own claim: 2321, released and re-taken as 2359 (same paths; the first re-take was refused because its intent
  ran over 512 bytes), then 2363 for the files whose earlier holders had ended. The `FLEET_BOX_CLASSES` line (commit 16)
  was made after claim 2350 ended, under claim 2363.

### Deviations spent beyond the plan

- **D-6603** (Task 3 Step 0): the hard-cap term allows 40 s, not 22, measured from `UPDATE_SPAWN_TIMEOUT_MS`, the spawn
  drain and the re-install child's probe ceiling. W24-K6 pins the figure against the three literals it is made of.
- **D-6604** (ruling 16): a comment line with no CR inside it no longer counts as naming a setting, with the macOS
  residual and the one W23 row rewritten on purpose (below).
- **D-6605** was spent by fix round 1 (F12) and **D-6606** is unspent; see "Fix round 1" below.

### Departures from the plan text, each with its ruling

- **`_keep_knob`'s first line also clears `KEEP_FROM`** (Ledger R8, from Task 1's review). D-6589 said the reader's wrapper
  sets exactly what it names. A stale `KEEP_FROM` after a refusal could reach `_keep_why`; the clear costs no line and
  W24-R10 pins it.
- **Mutant M8 is equivalent** (Ledger R7): `${!key:-}` to `${!key-}`. Both forms read an exported empty value as empty,
  which then falls through to the file. No row was added, and W24-R1's fourth case pins the behaviour.
- **D-6590's mandated sentence is hedged** (Ledger R21; the retention wording in the final fix). The plan's "a file ccrc
  cannot read at all stops every act that reads a setting from it" overstated two acts: the health gate waits its 90
  seconds, and the watchdog uses the largest reading it could decide. The README and the example now say that. The
  retention sentence "stops both" became "stops each keep it is read for (a keep set in the environment is never read
  from the file)".
- **The example's new heading drops its trailing ` ──`** and its text is rewrapped (Ledger R15), so that every line stays
  within 80 columns, which the global constraint ranks above "verbatim". **Corrected by fix round 1 (F20):** the sentence that
  followed, "its deadline block is rewrapped, no word changed", was false at the tip; the example's actual wording changes
  are listed under "Fix round 1" below.
- **The DEFAULTS regex** captures `[^\s;&|)]+` instead of `\S+` (Ledger R16), which swallowed a trailing `;`.
- **C4 is red between Tasks 5 and 6** (Ledger R17): the census checks a call Task 6 adds. The branch was not pushed in
  between.
- **U5 was dropped** (Ledger R14; fix round 1 reused the name W24-U5 for a different row, F8 and F9, and W24-U6's ssh stub now
  reaches `cmd_rollout`'s pin, so the first half of this sentence no longer holds for the rollout read): the rollout harness lives in `ccrc-rollout.test.ts`, outside claim group A. U2 covers
  `_upd_resolve`'s refusal, so the rollout pin's refusal is pinned only through that function.
- **`_upd_restore`'s arm 2 is left unedited** (Ledger R13; **superseded by fix round 1, F10**: arm 2 gained its `3)` arm). D-6594 said `cmd_rollback` was `_upd_asset_listed`'s only code
  caller; arm 2 of `_upd_restore` is a second, and its `*)` arm would blame curl for an rc 3. `_upd_restore` is not on the
  consented function list. A rollback by flip whose gate fails reaches it without an earlier `_upd_resolve`, which is
  wider than first measured, but still safe: the reader's own line prints first, and the child refuses.
- **Task 3's four choices** (Ledger R9 to R12):
  - with the deadline undecided, the hard-cap term is skipped (the bound is the re-stamp less 235 s), as D-6591's text says;
  - the hard-cap term computes `4 * dl / 1000`, the server's cap floored to seconds, at most 3 s later than the
    `4 * floor(dl / 1000)` form, inside the margin;
  - the deadline WARN makes `_bak_gc` return 1, which W24-K4 requires;
  - K1, K2, K3 and K5 use the real `invalid` fixture through the recording shim, and D4, D5 and the K5 flip row sit in
    describes whose fixtures are local. These are fixture placements, not behaviour.
- **Ruling 16 and its consequences.** The W23-B17 row move (Ledger R24, below); the README retention clause, which stated the
  old rule, rewritten in the same commit (Ledger R25); the macOS residual, four shapes in which bash assigns a key from a line
  beginning `#` or `;`, accepted under D-6587's argument and recorded in D-6604 with no code change (Ledger R26, since narrowing
  on Linux only would bring the original bug back on macOS); and the kept `|| /\r./` clause in the awk count (Ledger R27),
  which is behaviour-neutral, since R13 cannot go red on its removal, kept because it is the ruling's literal wording and
  documents the inner-CR case.
- **`healthy()`'s `awk` line** (Task 6): `box-settings` scans with `awk`, which the fixture's contained PATH did not link, so
  ten existing doctor rows went red. One `linkReal(home, 'awk')` line cleared all ten, under consent 8739.
- **The remedy's file clause and a silent reader** (Ledger R18, R19): the `box-settings` WARN's remedy also names a
  whole-file fault, which D-6599's remedy did not; and `_ccrc_knob` prints nothing when its scan cannot run (a missing `awk`
  printed `command not found`), as D-6587's "never prints" requires. The second is its own commit (`c2746b307`) with W24-R11.
- **The doctor mask's display edge** (Ledger R23): it ends the authority at the first `/` only, so a base with `?` or `#`
  before any `/` and an `@` after it loses its host from the printed line. It never shows a credential, and the server
  refuses such a base. It stands.
- **Other rulings:** a split of claim group A so that the scrub lists wait for their own consent (Ledger R1); the
  watchdog-revert suite has no flip pin, so its claim was moot (R2); never rebase (R3); no edit near the platform block
  (R6); implementers of `ccd/ccrc` and the doctor files ran on Opus, docs-only work on Sonnet (R5); ruling 16 itself,
  asked as mail 8758 and ruled as 8759 (R20, R22); and `FLEET_BOX_CLASSES` gaining `box-settings: PASS` with one doc-comment
  sentence (R28).

### W23 rows rewritten on purpose

Each row's old assertion pinned a behaviour this wave changes. No row was weakened to pass.

| Row | Old assertion | New assertion |
|---|---|---|
| W23-B3, update half (line fault) | WARN `... nothing pruned or thinned`; no `pruned` or `thinned` line; four planted dirs byte-identical | WARN `... nothing thinned`; `pruned` lines for 20250101..03 (keep 0); the keep-set's dir 20250104 byte-identical |
| W23-B3, backup loop (six values) | stderr `... nothing was pruned or thinned`; five dirs; four planted byte-identical | stderr `... nothing was thinned`; no `thinned` line; dirs exactly 20250104 and its own |
| W23-B12, backup half | stderr `... nothing was pruned or thinned` | stderr `... nothing was thinned` |
| W23-B17, three shapes (export, spaced, vertical tab) | `... (it reads only a plain KEY=value line) nothing was pruned or thinned` | `... nothing was thinned`; fingerprint unchanged |
| W23-B17, Darwin twin | WARN `... nothing pruned or thinned`; rc 1; no prune line; all twelve dirs left | WARN `... nothing thinned`; one WARN line; rc 1; `pruned` lines for the two oldest; the newest ten left |
| W23-B18, four whole-file rows (mode 000, dangling link, directory, FIFO) | one WARN, the data keep's, `... nothing pruned or thinned`; rc 1 | two WARNs (`CCRC_BACKUP_KEEP cannot be measured ... nothing pruned`, the data keep's `... nothing thinned`); rc 1; no prune or thin line; no `update.lock` taken |
| KEEP knob, first row of "the KEEP knob is ONE bounded number" | `kept: CCRC_VERSIONS_KEEP is not a whole number from 0 to 9999` | `kept: CCRC_VERSIONS_KEEP could not be used (the WARN above says why)` |
| `ccrc versions` argument-surface row | `CCRC_VERSIONS_KEEP=(not a whole number from 0 to 9999)` | `CCRC_VERSIONS_KEEP=(could not be used)` |
| Three report-sequence rows (a bare rollback by flip; a flip whose spine completed under a failing doctor; the killed-between-flip-and-stamp shape) | `['installing', 'checking', 'restarting', 'done']` | `['installing', 'checking', 'restarting', 'restarting', 'done']`, for the flip's new `restarting` write (D-6601) |
| W23-B17, "a comment naming the knob above a non-ASCII value" (Linux arm) | refused: `line 2 has a non-ASCII byte in a NAME=value line` | reads the default 3. Ruling 16 retires review 839's "a token in a comment counts as naming the knob" for every key but the macOS data keep (D-6604) |

`update-watchdog-revert.test.ts` has no such pin and was run whole (16 passed). The W23 plan's one Risk-notes sentence about
the setting's source was replaced by the one this plan's brief gave.

### Measured

- **Growth.** `ccd/ccrc` was +23 net code lines against the merge-base before fix round 1, of a limit of 40 (this wave's stop
  line is 39); every other counted file is +0. Task 5, Task 6 and the final fixes added none. The figure after fix round 1 is
  +26 (below).
- **Citation debt** is unchanged: `'ccd/ccrc': 5`. Its sentence "One hunk sits below line 11635 (`_models_advance_budget_secs`, one line
  for one)" described the hunks before base line 11635 wrongly; corrected by fix round 1 (F21, below): there are several, all netting to zero. No added line carries a `file:NNN` citation. The `ccd/ccrc` citation census is unmoved: session-hook's 13 citation
  rows (the compaction card's anchors, the corpus facts, the debt row, the README census row and the rest) passed unedited.
- **R7** (the 64 KiB line, `_ccrc_knob CCRC_BACKUP_KEEP 10` over a 65560-byte `ccrc.env`, fixture HOME, three runs each):
  worst 71 ms on a non-comment line (Linux 60, 63, 71; Darwin model 63, 60, 64), and worst 7 ms when the same line is a
  comment. Nothing near 5 s.
- **The gate's first run** (head `13de5f941`): every touched suite and guard was green on its first run except
  `ccrc-install.test.ts`, whose two `FLEET_BOX_CLASSES` rows were red, deterministically (red again alone). The fleet install's
  doctor now prints `box-settings: PASS`, which the pinned map did not list. Commit 16 added it with one doc-comment sentence,
  measured PASS at every stage the rows check (a fresh install, two installs, the doctor, and the provisioned spread); both
  rows and the describe then passed (4 passed). No other map of doctor classes in `server/test` lists checks by name and
  missed it: the other hits are positional or per-check rows, green in the gate.
- **Merge check** (`git merge-tree`, no merge, rc 0 and no conflicted path each): `origin/main` at the gate, the head of
  open PR #1127, and the head of #1220, which merged during the wave and touched a fixture block just above `healthy()`.
  The branch's merge-base with `main` is still the plan base.
- **Load-timeout re-runs**, each green alone: Task 2's citations count row needs a timeout above 20 s under load; Task 4's
  models-advance row, the release-source pair pin and the D-3443 arm-2 row (load average 50 to 97); Task 6's nine `ccrc-doctor`
  rows (`Test timed out in 20000ms`, none near `box-settings`; 9 passed in 26 s alone). The gate saw none. Its one call of
  `ccrc-install.test.ts` hit the 560 s wrapper (size, not a red), so the gate ran that file, `ccrc-update.test.ts` and
  `ccrc-doctor.test.ts` by describe; the passes added up to each file's `vitest list` total.
- **Not run.** A full typecheck of the test tree at Task 5 (no `pwa/node_modules` there, and the load); the gate ran
  `typecheck-tests` (12 passed). The Darwin-only describes (22 skipped in `ccrc-install`, 20 in `ccrc-doctor`, 11 in
  `macos-platform`) and the Darwin arms under a real `/bin/bash` 3.2: the Darwin rows here run on Linux with `CCD_OS=darwin`,
  and only `test-macos` runs the real thing. The sourced-shell timings above are Linux only.

### Deferred minors, still open

- A reader helper test does not assert empty stderr (Task 1), and W24-P4 does not assert it either (Task 2).
- W24-R9's U+0663 row runs under `LC_ALL=C`; a comment could point at the UTF-8 rows that cover the locale case (Task 1).
- The known-name check joins on `IFS`; theoretical (Task 1).
- The deadline WARN carries no file or line (Task 3); `box-settings` names the line.
- On macOS, M2's sentence doubles "so", which the plan's format mandates; K4's title says more than its tree-keep pin shows; U4's second case does not assert where Darwin `cmd_update` stopped (Task 4).
- The README's "the box's model of systemd" on macOS means the bash-sourcing model, and "the release base stops the update" omits the rollback and rollout pin (Task 5).
- `_models_advance_budget_secs`'s header lost "said on stderr without the value" and the digit-cap note (Task 5).
- C8(a) does not go red on a stale `VAR_KEY_BODIES` entry, and `ownerOf` has a one-line-function edge (Task 5).
- C4 does not count a quoted literal or partial-literal first argument such as `"CCRC_${x}_KEEP"` (final review).
- The whole-file WARN repeats its clause seven times (about 700 characters), and role independence is tested with `CCRC_ROLE=server` only (Task 6).
- A mirror base's query-string token prints in `box-settings`' PASS line: not taken, since the ruling allows values to print (final review).
- The doctor mask's `?` and `#` display edge (Ledger R23, above).

### Follow-ups for the coordinator

- **The sibling scripts' operator settings** (`CCRC_KEEPALIVE_MODEL`, `CCRC_KEEPALIVE_PROMPT`, `CCRC_USAGE_SWEEP_DAYS`,
  `CCRC_GRAPH_BUDGET`, `CCRC_GRAPH_MAX_WORKERS`): a ledger row for wave 29, with the shared reader file and the census
  extended to every helper (Reading 9).
- **`_upd_restore` arm 2's rc-3 line** (done by fix round 1, F10) and **`cmd_backup`'s header** (qualified by fix round 1, F13, and
  README's sentence under consent 8894): both were follow-ups here and are closed.
- **The macOS server job** appears to exec the server entry even for a fleet role (`_inst_plist_server`). A census scout
  flagged it, unconfirmed; it is outside this wave and was not changed.
- **The migration** (D-6600) asks no act of this wave: step 2 is the coordinator's reading of the update inventory, and
  steps 0, 3, 4 and 5 are the operator's and the soak's coordinator's.

### Fix round 1 (2026-10-24, mail 8892, review 891)

Review 891 read the wave at `0754e84e2` and found 21 findings (one important). The coordinator ruled in mail 8892 (recorded
verbatim above, one path shortened to its file name). The round's code is `ccd/ccrc`, the doctor check and tests; this
dispatch wrote its text.

#### Commits, in order

Base `0754e84e2`.

1. `abad872ff` test(ccrc-update): the three contained spawns go through the bash runner the raw-spawn census accepts (F1).
2. `1a8943400` test(census): namerefs, `[[ -v ]]` reads and sourcing ccrc.env are pinned, and the residuals named (F4, D-6746).
3. `9d682314c` test(ccrc-update): a CRLF comment naming a setting beside a model-fault line reads the default (F5).
4. `96dfc767b` fix(ccrc): the hard-cap term is the sum of the start chain's own ceilings, derived and pinned (F2, D-6744).
5. `7fd2c9a9e` docs(ccrc): the thinning bound's first-verification overrun and backup's refusal exit are stated where the code is (F3, F13, D-6745).
6. `71d8e5a7a` test(ccrc-update): W24-D3's hard-cap term follows D-6744's 63 (F2). W24-D3 is red at 4 and 5 alone, green from here.
7. `418968e2d` fix(ccrc): update's redaction masks a mirror's userinfo with or without a scheme (F7, D-6748).
8. `2c8e11a76` fix(ccrc): a health window too large for the shell to compare waits 90 like any unusable value (F6, D-6747).
9. `4edc62331` test(census): sourcing is caught in every command position, bindings are scoped, the residuals named (F4 review).
10. `b8b502f9b` fix(ccrc): a refused release base's report says why, as a node fault (F8, F9).
11. `b3bfa2fb2` fix(ccrc): restore arm 2 names an unreadable release base, not curl (F10).
12. `35a9f457a` fix(ccrc): rollout reports a box's refused check as the refusal it is (F11).
13. `4c7e942d4` fix(ccrc): a keep refused for its value names where the value came from (F12, D-6605).
14. `8bc1046b1` fix(ccrc): rollout's every check arm is pinned, and arm 2 says why the base was refused (B2 review).
15. `ffa40cf3f` fix(ccrc): an ordinary health window stays usable, pinned; the hard-cap and window comments say what they count (B1 review).
16. `67079345c` fix(doctor): `box-settings` gives the model's own remedy when one odd line stops the whole file (F15).
17. `819c24f37` docs(plan): review 891's rulings recorded, D-6744 to D-6749 and D-6605 defined, and every sentence the round changed made true.
18. `ce117fb1b` docs(readme,example): the model-wide causes, backup's refusal exit and the bound's one overrun are stated (F3, F13, F14).
19. `857832230` docs(plan): fix round 1 as built (run 855, wave 24); it also adds the four R29 survivors to the census header comment (comment lines only).
20. `cd50ab271` test(ccrc-update): the F12 row is W24-R16, so no two rows share a name; the recorded rulings name the review's report by file (the controller's; it also edited this section's text).
21. `docs(plan,readme): the round's last stale sentences made true (fix round 1, docs review)`: the review of dispatch D's ten minors, below.
22. `docs(readme,doctor): the settings paragraph and the box-settings header re-wrapped to their width (fix round 1)`: the two lines the docs review fix left long, re-wrapped in place; no word changed.
23. `65ed340e4` test(sweep): v0.0.84's `_upd_redact` is frozen beside the pre-wave-11 sweep (the coordinator's mail 8937, after CI at `e246b8938` went red on `ccrc-sweep-deliberate-stop` X0c). The guard's own rule — a tree helper the frozen sweep calls is frozen into its fixture before the tree changes it — made this the ordinary step for D-6748's change, so no reserve number is spent. The copy's bytes are read from the v0.0.84 tag and hash to X0c's pin; X0c now reads `_upd_redact` from the fixture, as it reads `_upd_phase`. Removing the copy or altering one byte reds X0c (scratch copy, restored by cmp). Claims 2377 (the fixture) and 2378 (the test file).
24. `docs(plan): the frozen _upd_redact recorded (wave 24)`: this note.

#### Claims and consents

- This run's claims were re-taken ahead of their caps at 01:22Z: 2359 became 2366, and 2363 became 2367 (same paths; a re-take
  mints a new id).
- README: the owner's claim on the regions is now 2372 (it replaced 2349, same paths and holder; the owner's notice is mail
  8906). The grants stand beside it: 8545 (the regions of Task 5) and 8894 (request 8891, forwarded in 8896), both freshly
  measured live when this round began. The F13 clause is 8894's one clause: inside the ccrc-backup sentence of
  `**The maintenance verbs.**`, "exit 0" became "exit 0 (1 after a setting refusal, D-6590)", no other change to that paragraph
  and no reflow. The F14 sentences sit in the `**ccrc's own settings.**` paragraph and the retention region, which 8545 grants.

#### Rulings of the round (the worker's ledger, each with its cost)

- **R29** (the census review's four new C11 survivors: a `case` arm, `time . …`, a sourcing in a callee by dynamic scope, a
  sourcing split across lines): named as residuals (census header, D-6746), not caught. Cost: a future sourcing in those forms
  passes the census silently.
- **R30** (the hard-cap term over-counts, since the parent's probe runs inside the spawn's 20 s): 63 kept, as the ruling's
  "counted twice" and the safe direction say; the comment accounts for all 23 added seconds. Cost: thinning stops up to 18 s early.
- **R31** (`_upd_redact` over-masks text glued before a credentialed URL): accepted, display only. Cost: a mangled error line.
- **R32** (a raw `?`, `#`, `/` or space inside a password still prints): recorded in D-6748 only. Cost: a malformed
  credential could print; curl refuses such hosts.
- **R33** (F12 would red two rows in `ccrc-uninstall.test.ts`): it goes ahead, since that file is under this run's claim 2367
  (the brief was narrow, not the claim); the two rows were updated, old → new, in D-6605. Cost: none.
- **R34** (W24-U6 carries a minimal copy of the rollout suite's ssh and curl stubs, since `ccrc-rollout.test.ts` is not this
  run's): accepted for this round. Cost: a second copy of a small stub to keep in step.
- **R35** (B2 review's Minors 2, 3 and 6): recorded, no change: the 200-character report cap truncates a long `KNOB_WHY`; a
  rollback prints its cause twice on stderr; F11's notes (an empty stderr file, a pre-`--check` ccrc now reading "refused", a
  trailing-newline environment base, `set -u` in the main shell, a comment wrap). Cost: a truncated console detail for the
  long shapes, and one duplicate stderr line.
- **R36, corrected** (a NUL byte in ccrc.env never reaches the model): the WARN's why says `could not be scanned` (the words an
  awk failure prints), not "NUL", and the remedy stays the generic "make the file itself readable when it cannot be read or
  scanned". Kept. An earlier version of this ruling said the why names the NUL; it does not. Cost: doctor does not tell the
  operator the cause is a NUL byte (the update path's own refusal names it).
- **R37** (doctor, Linux): a quote left open or a trailing backslash on an EARLIER unrelated line gets the plain-line remedy, and
  the model's per-key fix naming the line above is dropped. Accepted as a residual: ruling 11 asked only for the model-wide
  causes. Cost: a misdirected remedy for that shape (the why still names the line); macOS names the line correctly.
- **R38** (S12 is declared before S11 in the doctor describe): left. Cost: none.

#### Measured

- **Growth.** `ccd/ccrc` is +26 net code lines against the merge-base (11490 → 11516, `netGrowth` at this commit), of the stop
  line 39; `GROWTH_CHECK=1 growth-check` passes 45 of 45. Every other counted file is +0. The order the coordinator ruled
  (F7, F6, F8, F10, F11, F12) never reached the stop line, so nothing is carried for growth.
- **Citation debt** is unchanged (`'ccd/ccrc': 5`); `citations` passes (4); no added line carries a `file:NNN` citation.
- **raw-spawn-census 7 of 7** (it was 2 failed, 5 passed at `0754e84e2`; main reads 7 of 7).
- **The F2 chain** (fixture only, no row): 17.95-second asset shims and a five-second health shim, the review's setup. Parent
  18.016 s plus child 23.029 s = 41.045 s, below the term 63 by 21.955 s (the review's own measurement was 41.041 s).
- **Mutants per fix**, each on a scratch clone, one at a time, restored by cmp, every one measured red on the row named:
  F4 (C9 to C11) 10 at first and 22 after the census review, with three controls that stay green and three named residuals
  surviving; F5 1 (red: the two W24-R15 rows); F2 5 (W24-K6, and W24-D3 for the literal); F7 3; F6 1 for W24-H2 and 2 for W24-H3;
  F8/F9 5 (W24-U5, U2, U3); F10 2 (the arm deleted, the old sentence restored); F11 5 (`|| :`, the old question, and the
  `255)`, `0)` and `127)` arms; W24-U6); F12 1 (W24-R9, W24-R16, both uninstall rows); F15 3 by the implementer and six by the
  review (S8 to S12).
- **Suites, as each dispatch last measured them** (one file at a time, foreground; `ccrc-update` by describe: W23 99, W24 65
  before W24-H3's four rows and `W24-H` 9 of 9 after them, the automatic restore 25, restore arm 1 12, update.json at every phase
  28, rollback 140; the controller's gate re-runs them at the tip), `ccrc-uninstall -t 'ccrc backup'` 7, `ccrc-rollout` 41,
  `ccrc-versions-warn-arms` 5, `ccrc-settings-census` 11, `ccrc-doctor -t box-settings` 17 (the whole file outruns one call, so
  its `healthy` and check-list subsets ran too: 18), `single-definition` 848, `private-names` 47, `typecheck-tests` 12,
  `session-hook -t 'CITATION DEBT'` 1. This dispatch re-ran `docs-parity` 54, `readme-holds` 17, `citations` 4, `topology-clean` 60,
  `pools-prose` 27, `lifecycle` 83, `dtbd` 1, and `deviation-refs` 31 after `git fetch origin main`.
- **The gate at `cd50ab271`** (`fr1-gate-report.md`): every suite and guard was green on its first run, with no re-runs.
  `ccrc-update.test.ts` ran by its 40 describes: 707 passed plus 12 Darwin skips, 719 rows. Growth is +26 of 39. `git merge-tree`
  is clean (rc 0, no conflicted path) against `main` at `1e0e59174` and against #1245's head `4e8cf89f7`. The citation-debt net
  before base line 11635 is 0: four hunks there are compensating pairs, unequal individually (2499: 4 → 3, 2503: 0 → 1, 2670:
  12 → 11, 2682: 0 → 1), and session-hook's CITATION DEBT row is green.
- **Not run (before the gate):** the whole of `ccrc-doctor.test.ts` and of `ccrc-update.test.ts` in one call (each outruns a 600 s call; the
  gate runs them by describe); the Darwin arms under a real bash 3.2.

#### Recorded, no change (R35)

The 200-character cap on a failed report's detail truncates a long `KNOB_WHY` (the open-quote, backslash and non-ASCII shapes lose
their tails); a rollback names an unreadable base twice on stderr, once in the reader's line and once in its die; and F11's
notes above. Each stays as it is, by ruling.

#### F19: every README setting hit, at this commit

`git grep -n -E 'CCRC_(BACKUP_KEEP|BACKUP_DATA_KEEP|VERSIONS_KEEP|UPDATE_HEALTH_S|UPDATE_DEADLINE_MS|RELEASE_BASE_URL|MODELS_ADVANCE_BUDGET_S)' -- README.md`
gives 25 lines. Each was read in this round; "unchanged" means it still reads true.

| Line | Word | Why |
|---|---|---|
| 396 | unchanged | `CCRC_RELEASE_BASE_URL` points the release downloads elsewhere: true. |
| 421 | changed | the models-budget pointer, `where to set … (a ~/.ccrc/ccrc.env line)` (grant 8545). |
| 459 | unchanged | the override's existence, true. |
| 872, 873 | changed | the process-environment wording removed from the sweep's prune and thinning clause (grant 8545). |
| 958 | unchanged | the gate is bounded by `CCRC_UPDATE_HEALTH_S`, default 90: true. |
| 985 | unchanged | the watchdog's reports older than `CCRC_UPDATE_DEADLINE_MS`, default 15 minutes: true. |
| 1143 | unchanged | a lease fails `deadline` past the deadline and at four deadlines: true (the control plane's cap). |
| 1194 | unchanged | the newest `CCRC_VERSIONS_KEEP`, default 3, complete trees stay: true. |
| 1195 | changed | the unreadable-input parenthesis names a line `ccrc.env` holds that the reader cannot take (grant 8545). |
| 1220 | unchanged | `ccrc backup` prunes to the newest `CCRC_BACKUP_KEEP`, 0 to 9999, default 10: true. |
| 1227 | unchanged | the newest `CCRC_BACKUP_DATA_KEEP` keep the data set: true. |
| 1234, 1235 | unchanged | the data knob's line grammar, the reader's own: still true. |
| 1285, 1286, 1287 | changed | the new `**ccrc's own settings.**` paragraph: the seven names (grant 8545). |
| 1299, 1302 | changed | the same paragraph: the deadline's smallest and largest readings, the doctor check; the F14 sentence on the model-wide causes follows the whole-file sentence. |
| 1991 | unchanged | the models budget's default 250 seconds in "When the step runs": true. |
| 2001 | unchanged | `=0` turns the step off, and so does a value that is not a whole number: true. |
| 2005, 2007 | changed | "Turning the step off": the budget is read from the environment, else ccrc.env, a drop-in still overrides one unit, an unreadable line turns the step off (grant 8545). |
| 6645 | unchanged | deploy.sh's own prune, `CCRC_BACKUP_KEEP` default 10, environment-only, not this wave's: true. |
| 6683 | unchanged | retention thins every backup past the newest `CCRC_BACKUP_DATA_KEEP`, and restore refuses such a dir: true. |

Changed lines that name no setting, so they are not hits (examples, not a full list; the diff of README.md against `49e7f187a` is
the list): the F13 clause in the ccrc-backup sentence (grant 8894); the retention explanation "read as every ccrc setting is
(below)" and the keep and refusal sentences after it (1230 to 1232, grant 8545); ruling 16's comment-line wording and the macOS
"this knob alone" clause (1237 to 1241); the F14 clause in the model-wide parenthesis (the CR and non-ASCII causes "on any line of
the file"); and the other lines of the "Turning the step off" hunk (2003 to 2010).

Also grepped, per the plan: "process environment" and "does not set it" in the paragraphs of the hits, none left that says the
file does not set a setting.

#### F20: the example's actual wording changes, and their rulings

`git diff 49e7f187a..HEAD -- deploy/ccrc.env.example` shows more than a rewrap. The words that changed, against this plan's
mandated text (Task 5, Step 3):

- **The deadline block** (the final review's fix `fd32d90ae`) says what ccrc reads: the SMALLEST reading among the environment,
  this file and the exposure file bounds its thinning, the LARGEST it can decide serves the watchdog, and any other spelling
  starts no verification past "the keep-set's first full one". Rulings: plan rulings 3, 4 and 11 (D-6591, D-6592, D-6602).
  Fix round 1 adds that the first verification can run past the bound by one verification when the re-stamp is already late
  (ruling 3 of review 891, D-6745).
- **The unreadable-file clause** (`fd32d90ae`; Ledger R21) says "refuses, or falls back as its own text says (the health gate
  waits 90; the watchdog uses the largest reading it could decide)", where the plan said "stops every act". Fix round 1 adds the
  model-wide causes beside it (an unrelated non-ASCII line, a line with an inner CR: every setting the file names on an
  assignment-capable line; unnamed settings may still read their defaults), by ruling 11 of review 891 (F14).
- **The mirror sentence** (`fd32d90ae`) was narrowed from "It may carry user:password@, which ccrc never prints" to "Any
  user:password@ belongs after the scheme (https://user:password@host/...), where ccrc never prints it". Why: at that commit
  `_upd_redact` masked userinfo only after a scheme (review 891 F7 measured it). Ruling: D-6594 and plan reading ruling 7 (the doctor masks userinfo); no
  separate coordinator ruling. After D-6748 `_upd_redact` masks both forms, so the sentence is advice now, not a limit, and
  stays.
- **The header's first paragraph and the new heading** are as planned (Step 3.1), except that the heading drops its trailing
  ` ──` and the block is wrapped to 80 columns (Ledger R15).

The earlier as-built sentence "its deadline block is rewrapped, no word changed" is corrected above.

#### F21: the comment-only header changes, accepted (D-6749)

Each changed only comment lines (every changed line there starts with `#`), the platform block is untouched, and the citation
census is kept:

- `_models_advance_budget_secs`: its three-line header (in place, three lines for three), beside the planned one code line.
- `_upd_release_base`: its header (the reader's contract, and the in-shell calling pattern after F8).
- `_upd_gate`: its header (the health window, D-6747's length rule, and that ruling 6's zero and no range hold for what the
  shell can compare).
- `_upd_asset_listed`: its header (rc 3, and that `KNOB_WHY` holds the cause for the caller).
- `_ver_gc`: its two-line header (in place).

The hunks before base line 11635, which the earlier one-line description got wrong (it named only the models-budget line), are,
against `49e7f187a`, all netting to zero lines: the `update` usage paragraph (four lines became three, one added), the two
`backup` usage lines (in place); `_upd_redact`'s header line, comment block (12 lines became 11) and one added code line (F7);
`_models_advance_budget_secs`'s three header lines and its one code line (in place). Session-hook's citation-debt row passes.

#### Carried to wave 29, and not in this round

- `_inst_plist_server`'s fleet-role entry point (an older defect: the base and the tip generate the server entry beside a fleet
  agent label), and install describe 35's teardown leak (main shares it): both named by the coordinator as ledger items.
- The sibling scripts' operator settings (unchanged from the follow-ups above).
- The F12 row was first committed as a second W24-R10 (beside Ledger R8's KEEP_FROM row); renamed W24-R16 before the push.
