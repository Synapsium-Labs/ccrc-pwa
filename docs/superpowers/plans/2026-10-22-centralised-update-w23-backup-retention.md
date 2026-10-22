# Centralised update management, wave 23: ten kept backups stop costing ten copies of the coordination data set: Implementation Plan

On 2026-10-22 the operator ruled that a wave should cut what the update backups keep. The coordinator cut wave 23 the same day as run 775 and issued a block of twenty deviation numbers starting at D-6346 (see the programme ledger's wave-23 bullets). Every citation below is `path:line` at the pinned base `e990cc46d`, read with `git show e990cc46d:<path>`. The worker re-reads each one in the text that has landed (see the absorb step). This is revision 2, after fix round 1 (the review notes at the end say what changed and why).

**What was measured.** The server box is under the operator's 15G free line. Its `~/ccrc-backups` holds 10 timestamped backups (the pruner keeps the newest 10), 16763M in all. The table below gives the size of each part of one backup, newest backup first and oldest second:

| Member | Newest | Oldest |
|---|---|---|
| `coord.db` | 1079M | 850M |
| `delegation-events.log` | 674M | 513M |
| `delegation-checkpoint.json` | 78M | 68M |
| Code (`server-dist` 7M, `dist-pwa` 3M, `ccd-body` 3M, `agent-dist` 2M, the units, `ccd`, `coordination-snapshot.json`) | about 15M | about 15M |

The live checkpoint is now 12.6 MB, since a broker fix. So nearly all of a backup is the **coordination data set**: `coord.db`, the delegation journal and its checkpoint, and `coordination-snapshot.json`. Every update copies it in full. The fleet box's backups total 230M and hold no `coord.db`.

**What already holds.**
- An older build does not refuse a newer database. `openCoordDb` reads a higher `user_version` and migrates nothing (rule 3, server/src/coord/db.ts:119). So a backup's data set is never needed just to BOOT an older build.
- No automatic arm restores the data set from any backup. These all restore code only, or nothing:
  - gate-failure arms 1 to 3 (`_upd_restore_arm1` ccd/ccrc:22143, `_upd_restore_arm2` :21647, `_upd_restore_arm3` :21786);
  - `ccrc rollback` by flip or by re-install (`cmd_rollback` :18898);
  - the watchdog (`cmd_watchdog` :19382);
  - `cmd_versions` (:24140);
  - deploy.sh.
- Exactly three things read a backup's data set:
  - `_upd_report` (:22892) reads **this run's own** `coord.db` at :22907 to print the by-hand downgrade recipe;
  - the operator-only `ccrc coordination-snapshot restore --from <dir>` reads any directory it is given (`restore`, deploy/coordination-snapshot.mjs:1045);
  - the pruners' classifier `_bak_snap_class` (ccd/ccrc:23675) reads one to decide what a prune keeps.
- **Where the prune runs, in time.** `cmd_update` writes `restarting` (`_upd_phase restarting`, ccd/ccrc:18638), releases `update.lock` (`_upd_unlock`, :18640), sweeps the supervisors (`_upd_sweep`, :18641), prints `_upd_report` (:18648), and only then runs `_bak_gc update` (:18653), which takes the lock again. Nothing refreshes `update.json` in between. The control plane fails a busy row once now − max(updateStartedAt, reportedUpdatedAt) passes the deadline (`deadlineExpired`, server/src/update/dispatch.ts:243; `DEFAULT_UPDATE_DEADLINE_MS` is 15 minutes, server/src/config.ts:53; the hard cap is 4× from the start, dispatch.ts:49). Past twice the deadline the watchdog records a live lock holder as wedged (`cmd_watchdog`, ccd/ccrc:19542). So whatever this wave adds under that lock is bounded in time, and the report is re-stamped before it starts (D-6356).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. The dispatched worker runs it under the `ccrc-worker` skill. The brief carries only this wave's specifics: this plan's path, the task range, the claim groups and the deviation block.

**Goal:** after every completed update and every `ccrc backup`, ten kept backups hold the coordination data set in only the newest `CCRC_BACKUP_DATA_KEEP` (default 3, at least 2) that carry a valid one, plus the newest one from before a schema migration when there is one. The others keep their code and a small record, `coordination-thinned.json`, that says the data set was thinned, when, and by which rule. Every reader of a snapshot tells "thinned by design" from "damaged" and from "never held one": `validate` answers `thinned`, `restore` refuses it by its own code, and `_upd_report` never calls a thinned backup one that never held a `coord.db`.

**Architecture:** no server, agent or PWA change, and no new `ccrc` verb.
- `deploy/coordination-snapshot.mjs`, the self-contained helper, does the work:
  - a fifth classifier word, `thinned` (exit 1);
  - a `thin` verb. It counts the newest N valid data sets (verifying in full only what it counts), keeps the newest one from before a schema migration, and thins the rest on a presence-and-size reading, writing the record first and deleting the four snapshot files after it;
  - `restore` refuses a thinned source by name (`source-thinned`).
- `ccd/ccrc` gains:
  - `_bak_data_keep`, the knob's one validator (the environment, else `~/.ccrc/ccrc.env`);
  - `_bak_ours`, the ONE spelling of "this run's own, or named at or after its floor", now called by `_bak_keepset`, `_bak_removable` and `_bak_thin`;
  - `_bak_thin`, which passes this run's own backup, the keep-set's already-verified data keep, and the snapshot-bearing dirs below the floor to `thin`;
  - one call to `_bak_thin` at the end of `_bak_prune` (:23566) and of `_bak_gc` (:23725) for an update only, under the lock each already holds;
  - a re-stamp of the report before `cmd_update`'s `_bak_gc`, and one line in `_upd_report` for a thinned own backup.
- `_bak_snap_class` does not change: a thinned dir holds none of the four names its pre-filter looks for, so a prune sees it exactly as it sees a code-only backup.

**Deploy class:** box tooling only (`ccd/ccrc`, `deploy/coordination-snapshot.mjs`). The change rides `ccrc update` and `ccrc rollout` to each box. No order is needed: nothing on the wire changes, and the fleet box's backups carry no data set. **The update that installs this wave cannot thin** (Risk notes): the first thinning on a box is its next completed update or `ccrc backup`.

**Landing order, as dependencies:**
- Tasks 1 and 2 (the helper) depend on nothing.
- Task 3 needs Task 2's `thin`, and the Group B claim.
- Task 4 is the gate and the PR.

One PR, from this workspace's own branch.

## Not in this wave

- **Which backups carry the data set, as a listing** (revision 1's Tasks 3 and 5: a `list` verb, a `ccrc versions` listing and a doctor check `update-backups`). Moved to a follow-up wave (D-6351). This wave's visibility is `thin`'s own lines, its summary line and `validate --from <dir>`. The follow-up carries what fix round 1 found in that design: answer PASS for an absent or empty `~/ccrc-backups` before the helper is needed; copy the helper into `ccrc-doctor.test.ts`'s `installCcrc` tree; a row for the unmeasured arm (the helper exiting non-zero or missing while backups exist must WARN, never PASS); a leftover whose size differs from its record lists `damaged`, not `interrupted`; the PASS line says "by presence and size" and names `validate --from`; the newest name pinned exactly; `ccrc-install.test.ts` and `ccrc-doctor-graphify.test.ts` in its claims.
- **`deploy/deploy.sh`'s own backup and `prune_backups`** (deploy/deploy.sh:241-246, :1234-1247). deploy.sh is the fallback path. Its remote prune already has no keeps (D-5144). The next `ccrc update` or `ccrc backup` thins the dirs deploy.sh writes, like any other dir (D-6354). `agent/test/deploy-verify.test.ts` is run, never edited.
- **Arm 2's child writing a second full backup** (`_upd_restore_arm2`'s child at ccd/ccrc:21730 runs `cmd_update`, whose `_upd_backup` runs at :18317). Changing the child is a change to a restore arm, with a hazard of its own. The pre-migration keep (D-6358) and the default of 3 (D-6347) say what survives instead.
- **`_upd_report`'s downgrade recipe** (:22906-22914), which names `coord.db` alone, without its sidecars. Printing the set-wise restore instead is a separate change. This wave adds only the thinned line (D-6359).
- **The text pointers to `~/ccrc-backups/<ts>/coord.db`**:
  - the boot refusals, server/src/coord/db.ts:158 and :235, with their test pins at coord-db.test.ts:121 and collect-lane-restore-wording.test.ts:61;
  - `_check_disk`'s advice, ccd/ccrc-doctor-checks:2334 and :2339;
  - ccd/coordinator-skill/references/resume.md:138.

  Each still names a path that the newest backups carry. In an older dir, `coordination-thinned.json` says why the file is gone.
- **Deduplication** by hardlink or reflink (scout open question 7). It depends on the filesystem, which the code cannot settle.
- **The other timestamped writers counting against `CCRC_BACKUP_KEEP`** (Caddyfile, settings merges, the skill installers; scout open question 8). They carry no data set, so thinning is indifferent to them.
- **A CLI door for `thin`** (`ccrc coordination-snapshot thin`). It would add a usage line above ccd/ccrc's line 11635 and move the `ccrc-cli.test.ts:228` and `install-census` verb pins.
- **Thinning on a rollback** (D-6355). A rollback by flip takes no backup, so it adds no data set to thin; a rollback by re-install runs through `cmd_update` and thins there as an update.
- **`CCRC_BACKUP_KEEP` read from `~/.ccrc/ccrc.env`.** Only the new knob gains the fallback (D-6360); the old one keeps its documented environment-only rule.
- **The update-management design spec's retention prose** (docs/superpowers/specs/2026-09-20-centralised-update-management-design.md:883-899, :1302-1305). Whether to amend it is the coordinator's call. This plan and README carry the rule.
- **`GET /api/updates` and the PWA.** Nothing on the server reads `~/ccrc-backups`.

## Global Constraints

- **Files:**
  - Source: `deploy/coordination-snapshot.mjs`, `ccd/ccrc`, `README.md`.
  - Tests: `server/test/coordination-snapshot.test.ts`, `server/test/ccrc-update.test.ts`, `server/test/install-census.test.ts`, `server/test/ccrc-uninstall.test.ts`.
  - This plan.
  - `ccd/ccd` is NOT touched, so there is no restamp. `ccd/ccrc` is hand-written and unstamped (ccd/ccrc:63-67). `ccd/ccrc-doctor-checks` is NOT touched. `deploy/backup-coord.mjs` is NOT touched: it is sha256-pinned by the `'8B: backup-coord.mjs stays the SQLite-only snapshot …'` describe (coordination-snapshot.test.ts:1881).
- **Functions this wave edits** (the consent list, by file):
  - `ccd/ccrc`:
    - `_keep_why` (:23528), which gains an optional third argument;
    - `_bak_keepset` (:23619) and `_bak_removable` (:23652): their own-dir and floor clauses (:23626-23627, :23655-23657) become one call to `_bak_ours`;
    - `_bak_prune` (:23566);
    - `_bak_gc` (:23725);
    - `_upd_report` (:22892), one `elif` before its "(no coord.db existed …)" line (:22912-22913);
    - `cmd_update`, the one line that calls `_bak_gc update` (:18653) and the comment above it (:18649-18652);
    - new `_bak_ours`, `_bak_data_keep` and `_bak_thin`, placed between `_bak_removable` (:23652) and `_bak_snap_class` (:23675);
    - in-place text edits to the `usage()` heredoc's `update` paragraph (:2498-2503), `backup` paragraph (:2583-2590) and `coordination-snapshot` lines (:2592-2594);
    - comment-only edits to the headers of `_bak_keepset`, `_bak_removable`, `_bak_snap_class`, `_bak_gc` and `cmd_coordination_snapshot`.

    None of these is in run 722's only `ccd/ccrc` hunk (`@@ -423,7 +423,7 @@`, the one-line `_plat_workdirid_pane` beside `_plat_epoch_ms` at :426).
  - `deploy/coordination-snapshot.mjs`:
    - `classifyRaw` (:870), `classify`'s JSDoc (:858-864), `restore` (:1045), `USAGE` (:1206), `main` (:1215; its exit at :1225 and its catch at :1254), and the header's WHAT IT NEVER DOES paragraph (:29-33) and VERBS paragraph (:35-40);
    - new `THINNED_FILE`, `SNAPSHOT_NAMES`, `readThinned`, `quickState`, `dbUserVersion`, `thinOne` and `thinBackups`.
- **Claims, in groups, each taken all-or-nothing when its group frees.** Re-read the live claims before each group with `ccrc-api claims list --project ccrc-pwa` (a read).
  - Group A, now: `deploy/coordination-snapshot.mjs`, `server/test/coordination-snapshot.test.ts`, `README.md`.
  - Group B: `ccd/ccrc`, `server/test/ccrc-update.test.ts`, `server/test/install-census.test.ts`, `server/test/ccrc-uninstall.test.ts`.

  If a live claim (run 722's, path identity wave 3) covers `ccd/ccrc`, Group B waits for that claim to end or for that run's consent through the coordinator. The function list above is what the coordinator asks consent for.
- **The growth cap is armed** (`server/test/growth-check.test.ts:53`, `GROWTH_LIMIT = 40` in server/test/growthCheck.ts:46).
  - `ccd/ccrc` may grow by at most 40 net code lines (bash `#` comments and blank lines are not counted; heredoc lines are). This plan's estimate is about 32: `_bak_data_keep` 7, `_bak_ours` 5, `_bak_keepset` −1, `_bak_removable` −2, `_bak_thin` about 18, `_bak_prune` +2, `_bak_gc` +2, `_upd_report` +1 (the `elif` and its `echo` on one line), `cmd_update` 0 (one line edited in place), usage 0.
  - Measure it with `GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts`. No waiver is planned. If the measured count passes 39 with run 722's line, stop and report to the coordinator before trimming anything that a row pins.
  - Run 722's `+1` lands on whichever branch lands second. Re-measure after the absorb.
  - The helper is not a growth file.
- **Citation debt (session-hook.test.ts:7682, map entry `'ccd/ccrc': 5`).** The net line count of `ccd/ccrc` ABOVE base line 11635 must not change.
  - The usage edits are in-place rewraps with the exact lines given in Task 1 Step 5 and Task 3 Step 5, measured: same number of lines per paragraph. Every new function sits below line 23500. The `cmd_update` edit (:18653) and the `_upd_report` edit (:22912) are below 11635 too.
  - Verify with `git diff -U0 origin/main -- ccd/ccrc | grep '^@@'`: every hunk above 11635 has equal old and new counts.
  - Then run session-hook.test.ts `-t 'CITATION DEBT'`.
  - README carries no `ccd/ccrc:NNN` citation, and none may be added.
- **No numeric citation in any added code or test line** (citations.test.ts, `BASELINE = 1584`; its corpus is every code file outside `docs/`, test files included). No line this wave adds to `ccd/ccrc`, the helper, or any `server/test/*.ts` file may carry `ccd:NNN` or `<file>.{ts,tsx,mjs,sh}:NNN`. Cite a function, a `file#symbol` or a describe name instead. This plan's own `path:line` anchors are for the worker's reading, never for copying into a comment. Run `citations` after each task, not only in Task 4.
- **Pins this wave must keep green as they are:**
  - delegation-wave3.integration.test.ts:1461. The only non-comment line of `ccd/ccrc` that names `delegation-events.log` stays the `_bak_snap_class` pre-filter loop, so the bash side never names the journal. `_bak_thin`'s own pre-filter names `coordination-snapshot.json`, `coord.db` and `coordination-thinned.json`, never the journal.
  - The structural pins in ccrc-update.test.ts:
    - `_bak_snap_class "$d"` appears exactly once (:13125), so `_bak_thin` never calls the classifier itself;
    - `[ -f "$d/coord.db" ]` appears 0 times (:13124), so `_bak_thin`'s pre-filter uses `-e`;
    - `[ "$d" = "$BAK_KEEP_` appears 3 times, all in `_bak_removable` (:13139);
    - `_bak_removable`'s body keeps `[[ "$UPD_BAK_FLOOR" =~ ^[0-9]{8}-[0-9]{6}$ ]] || return 1` (:13140), so that line stays in `_bak_removable` beside its new `_bak_ours` call.
  - `REPORT_KEYS` (ccrc-update.test.ts:4073): no `update.json` key is added. The re-stamp uses the existing `phase` and `detail`.
  - README `**Restore** (manual, from the target box` is the end marker of a passage `pools-prose.test.ts` reads (:779). Keep that sentence's opening verbatim; add the thinned guidance after it.
  - The usage phrases other suites pin survive whole: `coordination-snapshot.json` and `delegation journal and checkpoint` in the `backup` paragraph (install-census.test.ts, `'the backup prose names the manifest and both sidecars …'`), and `(never ~/.ccrc/collect-lane-generation.log: a restore leaves it in place)` (collect-lane-restore-wording.test.ts, `'the update and backup usage say so'`; it reads the paragraph with its line breaks folded).
  - The helper imports only `node:` modules (the coordination-snapshot.test.ts describe at :1881).
- **Fixture HOMEs only.** Every `ccrc`, `ccd` and helper spawn and every sourced function runs under a `mkdtemp` HOME, quoted. Never run `ccrc` or `ccd` against the live HOME. Never touch tmux, `systemctl --user` on the live manager, `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or `~/.cc-secrets`. Never run `ccrc update`, `rollback`, `rollout`, `backup` or `install` outside a fixture.
- **Hermetic env.** `CCRC_BACKUP_DATA_KEEP` joins the inherited-env scrub lists in `ccrc-update.test.ts`'s `updateEnv` (:707-708) and `ccrc-uninstall.test.ts`'s harness (:148-149), beside `CCRC_BACKUP_KEEP`, so a shell that exports it cannot move any row.
- **Memory and vitest.** Before any vitest run, read `anon` in the session slice's `memory.stat`, and run nothing while it reads above the programme's gate (21 GB in wave 17).
  - Run ONE file at a time, in the foreground, from inside `server/`: `./node_modules/.bin/vitest run test/<one>.test.ts --pool=forks --maxWorkers=1`, with `-t '<case>'` where a row names one case.
  - Use a short real TMPDIR (`mkdir -p ~/.cc-tmp/w23`) and wrap the call in `timeout -s INT 560`.
  - Never use bare `npx vitest`.
  - `bash -n` and one-off rows that source a few functions into a fixture HOME are cheap and preferred.
- **Disk.** Every fixture in this wave is small (kilobytes to a few megabytes), except Task 3 Step 7's one-off measurement, which has its own bounds.
- **The absorb step.** Before each task's first edit, run `git fetch origin main`, and re-read in the landed text every anchor this task names.
  - Before the first push, rebase the local commits onto `origin/main`.
  - After the first push, merge `origin/main`. Never rebase or force-push a published branch.
  - Check whether a PR has landed with `gh pr view <n> --json state,mergeCommit`, never by sha ancestry.
  - Land through the merge queue: `gh pr merge <n> --match-head-commit <sha>`.
- **Public repo:** commits use the noreply identity. No hosts, IPs, home paths, lane, account or session names in code, comments, commits or the PR body. Write `<home>`, "the server box" and "the fleet box". Fixture unit ids are `acct-a-demo` and `acct-b-demo`.
- **Routing.** Execute natively, inside the subscription, with no handoff. Pass the model explicitly on every subagent:
  - implementer subagents run on `sonnet`, one per task;
  - the per-task reviewer and the whole-branch reviewer run on `opus`;
  - scouts and transcription-grade edits run on `haiku`.

  The orchestrator reviews every diff. The wave-done fingerprint is this workspace branch's tip. The `suite:` line is one word.

## Review Focus

- **A rollback to a tree older than this wave, on a box that holds thinned dirs.** An older `_bak_snap_class` pre-filter finds none of its four names, so it answers rc 1 without starting node. An older `validate` answers `none`, and an older `restore` refuses (`source-invalid`). An older prune removes a thinned dir only by count, as it removes a code-only one. Does any older reader delete or overwrite live data because of a thinned dir? (Task 1's H6 pins the older-shape answer.)
- **A move onto an older tree by `ccrc update --to <older>`.** The running bash is this wave's, the helper it finds after the install is the older tree's, which has no `thin`. `_bak_thin` reads that by name and says "thinning skipped", never a WARN (D-6355, Task 3's B13).
- **A crash inside a thinning.** Record written and no member deleted yet: every name the record lists is still there, so the record is stale and the dir is still whole (`classify` says `v1`, the next `thin` removes the record). Some member deleted: the dir is interrupted (`classify` says `invalid`, "a thinning did not finish"), `restore` refuses it, and the next `thin` finishes it only by exact match. Can a half-thinned dir ever be counted as one of the N, or have a foreign file deleted? (Task 2's T5, T6, T11; Task 1's H7.)
- **A clock stepped back,** so this run's own backup is named below an earlier one. Own must still be counted first and never thinned. (Task 2's T2, Task 3's B6.)
- **Time under the lock.** `thin` verifies in full only what it counts that was not verified already in this run (at the default, one set), plus at most one pre-migration candidate, within a budget of `keep + 2` full verifications. Past the count it reads presence and size and the manifest's own figures, with no rehash. The report is re-stamped before `_bak_gc` starts. Is that bounded enough against the 15-minute deadline? (Task 3 Step 7 measures it; Reading 3.)
- **A `ccrc backup` inside an update's unlocked sweep window.** The update's pre-update backup U is named below the backup's floor. At a keep of at least 2 it is the newest earlier data set, so it is counted; it can be thinned only by two newer data sets of the same schema, and then `_upd_report` says it was thinned (D-6347, D-6358, D-6359, Task 3's B11, B14).
- **Disk at the peak.** The next update still writes one more full data set before its thinning runs, so the box holds N+1 data sets (N+2 while a pre-migration keep stands) for the length of that run. Is the default still right for a box near its line? (Reading 1, Risk notes.)

## Risk notes

- **The update that installs this wave cannot thin.** `cmd_update` runs as the process that started it: its `_bak_gc` (called at ccd/ccrc:18653) is the old tree's function text, which has no `_bak_thin` call, while `$CCRC_HERE/../deploy/...` already resolves to the new tree (`CCRC_HERE` is the logical `$HOME/ccrc/ccd`, ccd/ccrc:1670-1672). So the first thinning on a box is its next completed update or `ccrc backup`. For the server box, the PR body names one `ccrc backup` on that box, run by the operator right after the rollout, as the documented first thinning: it runs outside `update.json` and the control plane's deadline, and it needs about 2G free for that backup's own copy.
- **Mixed trees.** An old `_bak_gc` with the new helper never calls `thin`. The new helper's `classify` answers exactly as before for a dir that has no record. A new `_bak_gc` with an old helper (a move to an older tree by update) skips thinning by name. A rollback by flip never thins (D-6355); a rollback by re-install thins as the update it runs.
- **A damaged dir is never thinned.** A dir `quickState` calls damaged, and a counted candidate `classify` calls `invalid`, keeps its bytes as evidence and leaves only by the newest-`CCRC_BACKUP_KEEP` count. A same-length corruption past the count is invisible to `quickState` and is thinned like any full dir: the N counted sets are verified, so nothing that a restore could use is lost.
- **`CCRC_BACKUP_DATA_KEEP` is read from the process environment, else from `~/.ccrc/ccrc.env`** (D-6360), as `_upd_deadline_ms` reads its knob (ccd/ccrc:19280-19290, through `_box_env_value`, :3161). So a console-driven move and the watchdog's unattended run honour an operator's setting in `ccrc.env`. An invalid value there is refused like an invalid value in the environment: nothing is pruned or thinned. `CCRC_BACKUP_KEEP` stays environment-only, as documented.
- **Thinning cannot be undone.** Every guard below errs toward keeping: an unparsable floor, a classifier failure, an invalid knob, a helper that is missing, older or failing, an update in a failed gate, a restore child, and a spent verification budget all thin nothing.

## Saving, from the measured sizes

The newest backup's data set (1079M + 674M + 78M = 1831M) is the upper bound per data set below. The older ones are smaller (1431M for the oldest). Code is about 15M per backup, and every row keeps all 10 backups' code.

| `CCRC_BACKUP_DATA_KEEP` | Full data sets | On disk after a thinned run | Freed against 16763M |
|---|---|---|---|
| base (no thinning) | 10 | 16763M | 0 |
| 1 | refused (D-6347) | — | — |
| 2 | 2 | ≤ 3662 + 150 = 3812M | ≥ 12951M |
| **3 (default)** | 3 | ≤ 5493 + 150 = 5643M | **≥ 11120M** |

Steady state is N data sets plus `CCRC_BACKUP_KEEP` code sets, plus one data set while a schema migration lies inside the kept window (the pre-migration keep, D-6358). During a run it is one more, until the run's own thinning. With the 12.6 MB checkpoint, a new data set is about 1766M at today's DB and journal sizes. The fleet box frees nothing: its backups hold no data set.

## Deviations found

These twenty numbers, starting at D-6346, were issued to run 775. This plan defines all twenty, D-6346 to D-6365: the first fifteen at the draft, D-6361 to D-6363 from the worker's reserve, and D-6364 and D-6365 by the coordinator's rulings on review 794. The block is spent; a further number is asked of the coordinator.

- **D-6346.** Past the newest `CCRC_BACKUP_DATA_KEEP` update backups that carry a valid coordination data set, a backup is **thinned**, not pruned: its `coord.db`, `delegation-events.log`, `delegation-checkpoint.json` and `coordination-snapshot.json` are deleted, and every other entry stays (its code, `memory/`, the units). Why:
  - No automatic arm reads an older backup's data set (the map in the header). `_upd_report` reads this run's own only. The keep-set's data keep (`BAK_KEEP_DATA`, D-4641) is the newest earlier valid data set, and at the knob's lowest value, 2, `thin` keeps exactly own plus that one, so both base guarantees survive at every allowed value.
  - The operator asked to keep the code of every kept backup, for quick flips and by-hand recovery.
  - Whole-dir pruning stays the newest-`CCRC_BACKUP_KEEP` rule it is today.
- **D-6347.** The knob is `CCRC_BACKUP_DATA_KEEP`, default **3**, a whole number from **2** to 9999, validated by `_bak_data_keep` through `_keep_ok` plus a lower bound of 2. `0` and `1` are refused, never clamped. An invalid value stops the prune and the thinning alike: `_bak_gc` WARNs `… — nothing pruned or thinned` and returns 1; `_bak_prune` dies `… — nothing was pruned or thinned`, after the backup was taken, as an invalid `CCRC_BACKUP_KEEP` does. `_keep_why` takes an optional third argument, the lowest allowed value (default 0), so the refusal says "from 2 to 9999". Why 2 is the floor:
  - 2 is exactly what the base guarantees: own plus `_bak_keepset`'s `BAK_KEEP_DATA`, the newest earlier one.
  - At 1, a `ccrc backup` run inside an update's unlocked sweep window (`cmd_update`, ccd/ccrc:18638-18653) counts its own backup as the one and thins the update's pre-update backup, which the update still owns and which `_upd_report` is about to read. At 2 that backup is the newest earlier data set and is counted.

  Why 3 is the default: it keeps the pre-failure snapshot of a failed update whose arm 2 wrote a second full backup (`_upd_restore_arm2`'s child), through the next completed update, when the failed build changed the data without a schema migration. The guarantee is exactly that: one failed attempt, and no `ccrc backup` in between. Two failed attempts in a row, or a backup between, can thin it at 3 (Task 2's T10 pins that outcome). A failed build that MIGRATED the schema is covered at any count by D-6358. The cost of 3 over 2 is one data set, about 1.8G (the saving table).
- **D-6348.** A thinned dir carries `coordination-thinned.json`, one line of canonical JSON plus LF, written through `writeAtomic` BEFORE any member is deleted. Its shape is exactly:

  ```
  {format: 'ccrc-coordination-thinned', version: 1, thinnedAt, by, rule: {knob: 'CCRC_BACKUP_DATA_KEEP', keep}, source, capturedAt, dropped}
  ```

  - `thinnedAt` is a canonical instant.
  - `by` is `update` or `backup` (D-6355: a rollback by flip never thins, and a rollback by re-install runs `cmd_update`, so its records say `update`).
  - `keep` is 2 to 9999.
  - `source` is `v1` or `legacy`.
  - `capturedAt` is the manifest's value, or null for `legacy`.
  - `dropped` is a non-empty array of `{filename, bytes, sha256}`, one per deleted file. For `v1` it lists every `present:true` member plus the manifest itself, always in the order `coord.db`, `delegation-events.log`, `delegation-checkpoint.json`, `coordination-snapshot.json`, with absent ones skipped. For `legacy` it lists `coord.db` alone. For a member, `bytes` and `sha256` are the manifest's own figures, not a rehash (D-6350); for the manifest file and a legacy `coord.db` they are measured.

  The manifest goes WITH the members, recorded in `dropped`. Why:
  - A kept manifest with its members gone is `member-missing` (`invalid`) to every older helper, the word for damage.
  - With all four names gone, an older tree's `_bak_snap_class` pre-filter never starts node, and an older `validate` answers `none`. That is a narrower word, but never a false "damaged", and never a restore.
  - No old manifest is ever rewritten, so `present:false`'s "remove the live member" meaning in `restore` can never be reached through a thinned dir.

  Order: record first, then the files in `dropped` order (`coord.db`, the journal, the checkpoint, the manifest), then `fsyncDir`. So the first delete always removes `dropped[0]`, and a dir with the record reads three ways:
  - **stale record** — every name in `dropped` is still present: no delete happened, the data set is whole. Readers ignore the record and classify the rest; the next `thin` removes the record and treats the dir as an ordinary candidate.
  - **interrupted** — the record, some names in `dropped` gone and some present. The next `thin` finishes it, deleting a leftover only when it measures equal (bytes and SHA-256) to its `dropped` entry. Any other leftover is refused and left in place.
  - **thinned** — the record and none of the four names.
- **D-6349.** `classify` gains a fifth word, `thinned`, which exits 1, like `none`: there is no snapshot here, by design. `invalid` (damage) stays 2.
  - The record is examined BEFORE the manifest. An unreadable or malformed record is `invalid`, with `the thinning record is unreadable: <why>`.
  - A stale record (every `dropped` name present) changes nothing: the dir classifies as it would without it, and the reason gains ` (coordination-thinned.json beside it is a thinning that never started; the next thin removes it)`.
  - An interrupted dir is `invalid`, with the reason `a thinning did not finish: <name> is still beside coordination-thinned.json (the next completed update or ccrc backup finishes it)`, naming the first present name in `SNAPSHOT_NAMES` order.
  - A valid record with none of the four names is `thinned`, with `data: no`.
  - `restore` refuses `thinned` as `source-thinned` (exit 2) before any live change, a code of its own rather than `source-invalid`.

  `_bak_snap_class` is unchanged, and why: its pre-filter never shows a fully thinned dir to the helper, and its strict answer table (ccd/ccrc:23695-23697) can never receive `1 thinned`. If it ever did, that answer would fail closed (rc 2, prune nothing). An interrupted dir keeps a manifest or member, so the pre-filter shows it, and it answers `2 invalid`, which the table already holds. Adding an arm it cannot reach would be dead code, and the journal-name pin forbids changing its pre-filter line.
- **D-6350.** The count and the thinning live in the helper's `thin` verb, not in bash, and verification is bounded: a dir is verified in full only when it is about to be counted, and only once per run.
  - `_bak_thin` passes `--own <this run's backup>` (when there is one), `--verified <BAK_KEEP_DATA>` (when `_bak_keepset` chose one in this same run, under this same lock), and `--dir` for every listed dir that `_bak_ours` does not claim and that holds `coordination-snapshot.json`, `coord.db` or `coordination-thinned.json`, newest name first. A sidecar without a manifest is `invalid` and is never thinned, so the journal's name is never needed.
  - Own is counted first when `quickState` reads it `full`, and is never thinned or re-verified: `capture` measured every member as it wrote the manifest, seconds earlier.
  - Then the walk. For each dir: a record → the D-6348 three-way read first. Then `quickState` (presence and size). Not `full` → left as it is. `full` while the count is below N → counted, on `--verified`'s verdict for that dir, else on a full `classify` (v1 with data, or legacy; anything else is left as it is and not counted). `full` past the count → the pre-migration check (D-6358), else thinned on `quickState`'s reading, with the record's figures taken from the manifest.
  - A budget of `keep + 2` full verifications per run. When it is spent, the walk stops: nothing older is touched, one line says so, and the exit is 3. A stop can never leave fewer than N verified data sets, because nothing is thinned until N are counted.
  - Each dir is handled inside its own try: a `SnapError`, or an error carrying a string `code`, is one `WARN: could not thin …` line and a refusal, and the walk goes on (exit 3). Anything else is a helper failure (exit 70).

  Why the helper:
  - The one-classifier-call pin (`_bak_snap_class "$d"`, once) stays true, and the journal-name pin holds, because the bash never names the journal.
  - The crash order sits beside `writeAtomic` and the `fs` seam the helper's tests already inject faults through.

  Dirs that `_bak_ours` claims (this run's own, and every dir named at or after the floor, which belongs to a concurrent or later run) are never passed as `--dir`. Own is passed separately because a stepped-back clock can name it below an earlier dir.

  **Amended by the coordinator's ruling on review 794 (F6).** When the dirs that can be counted number at most `keep`, nothing can be thinned, so no dir is verified in full. Those dirs are the walked dirs that `quickState` reads `full` or `stale`, plus own when it reads `full`. In that case each is counted on its presence and size, no `user_version` is read, and the budget is not spent. A dir that still reaches past the count is left as it is, never thinned unverified; such a dir is one the quick pass could not read, or one that reads differently in the walk. An interrupted thinning is still finished, and the summary's `kept` then counts sets that were not verified. Why: the budget is `keep + 2`, so it grows with the knob. An operator who sets the keep at or above the number of kept backups, to stop thinning, would otherwise pay for a full verification of every set on every completed update, past the deadline.
- **D-6351.** The operator-facing listing (a `list` verb, a `ccrc versions` listing and a doctor check) moves to a follow-up wave. This wave's visibility is what `thin` prints as it acts (one line per dir it thins, finishes, keeps from before a migration or refuses, and one summary line), `validate --from <dir>`, and `restore`'s `source-thinned`. Why: the cut that frees about 11G on a box under its line should not wait on a second classifier vocabulary, a doctor table entry and their pins, and the ruling asks for the cut.
- **D-6352.** The usage heredoc is edited in place: each paragraph keeps its line count, so the line count above base line 11635 is unchanged and the citation-debt ratchet (session-hook.test.ts:7682) stays put. The exact lines are given in this plan, measured. README is edited freely, because it carries no line citation of `ccd/ccrc`.
- **D-6353.** `install-census.test.ts`'s helper-caller census (`callers`, :1977) is widened: `_bak_thin` joins the callers that name the helper in a `helper=` variable and run `node --no-warnings "$helper"`. Why: a widening, not a softening. The new caller is pinned to the same installed-tree path, and the named-helper set stays exactly `['deploy/backup-coord.mjs','deploy/coordination-snapshot.mjs']`.
- **D-6354.** `deploy/deploy.sh` is untouched. Its server-lane dirs are full `v1` snapshots, which the next `ccrc` run counts and thins like any other. Its plain newest-N `prune_backups` keeps its own rule (D-5142, D-5144), as before.
- **D-6355.** Only an update and `ccrc backup` thin. `_bak_gc` calls `_bak_thin` only when its lead is `update`; `cmd_rollback`'s flip arm (`_bak_gc rollback`, ccd/ccrc:19170) prunes as before and thins nothing. Why: a flip takes no backup (`UPD_BACKUP_DIR` stays empty), so it adds no data set to thin; after the flip `$CCRC_HERE/../deploy/coordination-snapshot.mjs` is the older tree's helper, which has no `thin`, and a WARN there would tell an operator reading an incident's rollback output that the backup tooling failed. A rollback by re-install runs `cmd_update`, whether it comes from `ccrc rollback` or, unattended, from the watchdog. It thins there, and its records say `by: update`, so D-6359's "by which verb" names an update for a rollback's thinning. For the same mixed tree reached by `ccrc update --to <older>`, `_bak_thin` reads the helper for the text `thin --keep` before it calls it: absent, it prints `thinning skipped — this tree's coordination-snapshot helper predates it; nothing was thinned` and returns 0. A helper missing from the tree is a different condition and keeps its own WARN.
- **D-6356.** `cmd_update` re-stamps its report right before `_bak_gc update`: `_upd_phase restarting "pruning and thinning ~/ccrc-backups"`, only when `_upd_report_is_mine`. Why: `restarting` was stamped before the sweep (ccd/ccrc:18638) and nothing refreshes it, while `_bak_gc` holds the lock; the control plane's deadline (dispatch.ts:243-249) and the watchdog's wedged arm (ccd/ccrc:19542) both measure from `updatedAt`. `_bak_gc` itself still never writes `update.json` (its header's contract). The edit is in place on the one call line (:18653), so it costs no line. No key is added.
- **D-6357.** The own-dir and floor filter is spelled once, in `_bak_ours <dir>` (rc 0 when <dir> is this run's own or named at or after `UPD_BAK_FLOOR`; an unparsable floor makes every dir "ours", so every caller keeps it). `_bak_keepset`, `_bak_removable` and `_bak_thin` each call it. Why: R14(a) (D-5318) made the removal filter one spelling; `_bak_thin` would otherwise have been a third copy of the pair, and a later floor fix (the DST fall-back `_bak_list` names) could reach two copies and miss the third. `_bak_removable` keeps its own fail-closed floor line, which a pin reads.
- **D-6358.** The pre-migration keep. Past the count, `thin` keeps the newest data set whose `coord.db` `user_version` is lower than that of the newest counted set that has a `coord.db`. It is read from the database header (bytes 60 to 63, big-endian, after the SQLite magic), through the `fs` seam's `openRead`, with no open of the database; then the candidate is verified in full, within the budget, like a counted set. One such keep per run, never more; a candidate that does not verify is left as it is and the search goes on. Why: after a build that migrated `coord.db` fails its gate and arm 2 runs, the only snapshot an older build's by-hand restore can use is the one from before the migration, and every later attempt adds two post-migration data sets ahead of it. The base keeps it only by the accident of the count window; this keeps it by rule, at any `CCRC_BACKUP_DATA_KEEP`.
- **D-6359.** `_upd_report`'s downgrade branch tells a thinned own backup from one that never held a `coord.db`. When `$UPD_BACKUP_DIR/coord.db` is absent and `$UPD_BACKUP_DIR/coordination-thinned.json` is present, it prints `update: rollback:   (this run's backup no longer holds coord.db: a later ccrc run thinned it; 'ccrc coordination-snapshot validate --from <dir>' says when and by which verb — restore from a backup that still carries one)`, never "(no coord.db existed before this run …)". Why: no overloaded absence at a seam. The case is narrow (a keep of at least 2 and D-6358 both have to be beaten by concurrent backups inside one sweep window), but the old line would then be false.
- **D-6360.** `_bak_data_keep` reads `CCRC_BACKUP_DATA_KEEP` from the process environment, else from `~/.ccrc/ccrc.env` through `_box_env_value`, else defaults to 3. Why: thinning cannot be undone, and a console-driven move (`--detach --from pwa`) or the watchdog runs under the user manager's environment, so an operator's shell setting would not reach it; `ccrc.env` is where a box's own facts live, and `_upd_deadline_ms` already reads its knob this way.
- **D-6361.** `quickState`'s legacy arm (no manifest, a regular `coord.db`) reads the file's first 16 bytes through the `fs` seam's `openRead` and requires the SQLite magic. A `coord.db` shorter than that, or without the magic, is `damaged` and left as it is, never thinned and recorded as `source: 'legacy'`. Why: thinning cannot be undone and a damaged dir is never thinned (Risk notes); a record of `source: 'legacy'` over damage would relabel it as dropped by design. This errs toward keeping, at the cost of one 16-byte read of a legacy `coord.db`; a v1 dir's header read (D-6358) and T12's accounting of it are unchanged. D-6364 replaces this read: its `inspectDb` read decides the header and the table list together.
- **D-6362.** `thinBackups` never thins the `--verified` dir: wherever it falls in the walk it is counted while the count is below the keep, and otherwise left as it is, except that a verified dir past the count whose `coord.db` predates a schema migration may be the one pre-migration keep (D-6358), which is kept, not merely left. A verified dir that reads as anything but whole, stale or empty, an interrupted thinning above all, is refused with the walk's WARN (`thin-verified-not-whole`) and never finished: the only thing `thin` removes from it is a stale thinning record. It also refuses a `dirs` list whose basenames are not strictly descending (newest first), as `thin-usage` (exit 70 through `main`), since the count means "the newest N" only in that order. Why: D-6346's guarantee that the keep-set's data keep survives must not rest on the caller's ordering.
- **D-6363.** The `thin` summary's `left` counts only dirs that still hold a data set and were left as they are: a damaged or invalid dir, a dir refused with a WARN, and every dir untouched past a stop that still holds one. A dir already thinned and a dir with no data set (`none`, an empty v1) are not counted, nor is a path that is not a directory. A dir is counted only after everything its count reads has been read (its `user_version` included), so no dir is both counted and left (review 794, F8). Why: this line is the wave's only visibility (D-6351) and must not read as data sets still on disk.
- **D-6364.** `quickState`'s legacy arm reads `coord.db` the way `classify`'s legacy arm does, through `inspectDb`, with the header check and the table list but not `quick_check`. A manifest-less dir whose `coord.db` is not SQLite, cannot be opened read-only, or holds a `delegation_*` table is `damaged` and is kept, never thinned as `legacy`. This replaces D-6361's separate 16-byte read: one read now decides both questions. Why: by the coordinator's ruling on review 794 (F2), a damaged dir is never recorded as thinned by design. The commonest real `invalid` backup is a refused capture, which leaves `<ts>/coord.db` beside no manifest, and thinning it would drop the evidence and relabel the damage. `quick_check` stays out because it scans the whole database, and past the count presence and size decide (D-6350). The table list costs one read-only open of a rare legacy-shaped dir.
- **D-6365.** Unmeasured is not unset. The rule applies when `CCRC_BACKUP_DATA_KEEP` is not in the process environment and `~/.ccrc/ccrc.env` exists. If the file cannot be read, or names `CCRC_BACKUP_DATA_KEEP` with an `=` on a non-comment line that `_box_env_value` cannot match, `_bak_data_keep` refuses exactly as it does for an invalid value. The unmatched lines are the `export` form, a spaced `=`, and anything before the name other than spaces, tabs and CRs, such as a vertical tab or a non-breaking space. A dangling link or a directory at that path counts as a file that cannot be read. Nothing is pruned or thinned, and the refusal names the knob and the file, never the file's bytes. Why: by the coordinator's ruling on review 794 (F3), thinning cannot be undone. An operator who set a high keep in `ccrc.env` to stop thinning would otherwise get the default of 3 silently, and every data set past the third would be deleted on the next completed update, `ccrc backup`, console move or watchdog run. The same fallback is harmless in `_upd_deadline_ms`, because there the default deletes nothing.

## File structure

- `deploy/coordination-snapshot.mjs`:
  - Task 1: `THINNED_FILE`, `SNAPSHOT_NAMES`, `readThinned`, the record branch in `classifyRaw`, `restore`'s `source-thinned`, `main`'s exit for `thinned`, `USAGE`, and the header's WHAT IT NEVER DOES and VERBS paragraphs.
  - Task 2: `quickState`, `dbUserVersion`, `thinOne`, `thinBackups`, and `main`'s `thin` arm with its catch.
- `server/test/coordination-snapshot.test.ts`: new describes, W23-H (Task 1) and W23-T (Task 2), appended after the last describe.
- `ccd/ccrc`:
  - Task 3: `_keep_why`, `_bak_ours`, `_bak_keepset`, `_bak_removable`, `_bak_data_keep`, `_bak_thin`, `_bak_prune`, `_bak_gc`, `_upd_report`, the `cmd_update` call line, the usage `update` and `backup` paragraphs, and comment headers.
  - Task 1: the usage `coordination-snapshot` lines (in the same Group B claim; done in Task 3's commit if Group B is not yet free when Task 1 lands).
- `server/test/ccrc-update.test.ts`: Task 3, a new describe nested in `'ccrc backup and update: the coordination snapshot callers …'` (:13260), after the D-4641 describe (:13652), reusing its `plantDir`, `runBackup`, `helper` and `withShim`; and `CCRC_BACKUP_DATA_KEEP` in `updateEnv`'s scrub list.
- `server/test/install-census.test.ts`: the `callers` census (Task 3).
- `server/test/ccrc-uninstall.test.ts`: the scrub list (Task 3).
- `README.md`:
  - Task 1: the verb table row (:1179) and the exits sentence (:1203).
  - Task 3: :846, the maintenance paragraph (:1190-1196), the deploy backup paragraph (:6539) and the Restore block (:6574-6600).

## Tasks

Tasks 1 and 2 are claim group A and can start now. Task 3 is group B. Every bash row is a one-off script in the worker's scratch directory. It extracts the named functions from the file under test with `sed -n '/^<fn>() [{(]/,/^[})]$/p'`, `eval`s them under a `mktemp -d` HOME, and never runs `ccrc` or `ccd` as a command (Appendix); a vitest row that needs the whole file uses `sourcedCcrc`. Every red and green below is *(unmeasured: the worker measures each)*, because no vitest ran for this draft. (Revision 1's Tasks 3 and 5 are gone, D-6351; its Task 4 is now Task 3 and its Task 6 is Task 4.)

### Task 1: a thinned backup is its own word (W23-a; D-6348, D-6349)

**Files:**
- Modify: `deploy/coordination-snapshot.mjs`:
  - names block (:50-62);
  - `classifyRaw` (:870);
  - `classify`'s JSDoc (:858-864);
  - `restore` (:1051-1052);
  - `USAGE` (:1206);
  - `main` (:1225);
  - the header's WHAT IT NEVER DOES paragraph (:29-33): it now also deletes the four snapshot files inside a backup dir it is told to thin, after writing that dir's record, and never anything else there;
  - the header's VERBS paragraph (:35-40).
- Modify: `ccd/ccrc` usage lines :2592-2594 (in place; Group B).
- Modify: `README.md` :1179 and :1203.
- Test: `server/test/coordination-snapshot.test.ts`.

**Interfaces:**
- Produces:
  - `export const THINNED_FILE = 'coordination-thinned.json'`.
  - `export const SNAPSHOT_NAMES = Object.freeze([MANIFEST_FILE, JOURNAL_FILE, CHECKPOINT_FILE, DB_FILE])`.
  - `function readThinned(fs, p): ThinnedRecord`, which throws `SnapError('thinned-invalid', …)` on any defect.
  - `classify(opts)`, whose `kind` now includes `'thinned'`, with `data: false` and `thinned: ThinnedRecord` on that kind.
  - `ThinnedRecord` is exactly the D-6348 shape.

- [ ] **Step 1: Write the failing rows.** Add a new describe, `'W23: a thinned backup is its own word (D-6348, D-6349)'`. Build a full snapshot with this file's `mkHome`, `setLive` and `snapshotOf`. Make a record by hand: `H.canonicalJson` of a D-6348 value whose `dropped` is the manifest's present members plus the manifest's own bytes and SHA-256. Write it with a trailing LF, then delete the four names.
  - `it('W23-H1: a dir holding the record and none of the four names classifies thinned, exit 1, data: no, and the reason says when, by which verb and the knob')`:

    ```ts
    expect(classifyCli(dir)).toMatchObject({ status: 1, stdout: 'thinned\n' });
    expect(classifyCli(dir, 'validate').stdout).toBe(
      'thinned: thinned 2026-10-22T00:00:00.000Z by ccrc update (CCRC_BACKUP_DATA_KEEP=3): its coordination data set was dropped by design\ndata: no\n');
    expect(H.classify({ from: dir })).toMatchObject({ kind: 'thinned', data: false });
    ```

  - `it('W23-H2: the record beside some but not all of the names it lists is invalid, and says a thinning did not finish')`: for each name in the four, a copy holding the record (listing all four) plus that one file:

    ```ts
    expect(H.classify({ from: copy })).toMatchObject({ kind: 'invalid' });
    expect(H.classify({ from: copy }).reason).toBe(`a thinning did not finish: ${name} is still beside coordination-thinned.json (the next completed update or ccrc backup finishes it)`);
    ```

  - `it('W23-H3: a record that is not one is invalid, never thinned')`. One case per defect: not JSON; no LF; non-canonical key order (valid JSON, same keys, re-ordered); an unknown key; `format` wrong; `version: 2`; `keep: 1`; `keep: 10000`; `by: 'deploy'`; `by: 'rollback'`; `source: 'legacy'` with a `dropped` naming more than `coord.db`; `source: 'v1'` with `capturedAt: null`; an empty `dropped`; a `dropped` filename outside the four; a duplicate filename; a symlink at `coordination-thinned.json`. Each expects `kind: 'invalid'` with a reason starting `the thinning record is unreadable: `.
  - `it('W23-H4: restore refuses a thinned source as source-thinned, exit 2, and the live set is byte-identical')`. Plant a live journal, checkpoint and `coord.db`, then run the `restore` CLI with a probe stub that answers inactive (as the W3-M33 rows do). Expect `status: 2`, stderr matching `/^coordination snapshot: source-thinned: /`, and every live file's bytes unchanged.
  - `it('W23-H5: the four words keep their exits beside the fifth')`: `v1` 0, `legacy` 0, `none` 1, `thinned` 1, `invalid` 2, through `classify` and `validate`.
  - `it('W23-H6: with the record removed again, a thinned dir is exactly what an older helper sees: none, exit 1, and the pre-filter names are all absent')`. Delete only `coordination-thinned.json`. Expect `kind: 'none'`, and none of the four names present: what a pre-wave tree reads (Review Focus 1).
  - `it('W23-H7: a record beside the whole set it lists is stale: the dir classifies v1, exit 0, data: yes, and the reason names the thinning that never started')`. Keep every file and add the record. Expect `kind: 'v1'`, `data: true`, and the reason ending ` (coordination-thinned.json beside it is a thinning that never started; the next thin removes it)`. The same for a legacy dir (record listing `coord.db` alone, `coord.db` present) → `legacy`.
- [ ] **Step 2: Run them red.** `./node_modules/.bin/vitest run test/coordination-snapshot.test.ts -t 'W23: a thinned' --pool=forks --maxWorkers=1`. Expected: H1, H2, H3, H4 and H7 fail (`none`, or a `source-invalid`, or no stale-record reason). H5 fails on the `thinned` row. H6 may pass already: it is the anchor.
- [ ] **Step 3: Implement.**
  - In `classifyRaw`, before the manifest test at :873, if `fs.lstat(join(from, THINNED_FILE)) !== null`:
    1. `readThinned` (a `SnapError` → `invalid`, `the thinning record is unreadable: <message>`; an `err.code` → `invalid`, `unreadable (<code>)`, as :881 does).
    2. If every `dropped` filename is present (`lstat` not null): fall through to the existing classification of the dir, and append the stale-record clause to whatever reason it returns.
    3. Else, if any of `SNAPSHOT_NAMES` is present: `invalid` with the H2 reason, naming the first present one in that order.
    4. Else `{kind: 'thinned', reason: \`thinned ${t.thinnedAt} by ccrc ${t.by} (CCRC_BACKUP_DATA_KEEP=${t.rule.keep}): its coordination data set was dropped by design\`, manifest: null, data: false, thinned: t}`.
  - `readThinned` mirrors `readManifest` (:773): UTF-8 fatal, one line plus LF, `findJsonDefect`, `exactKeys2` at every level (with the code `thinned-invalid`, not `manifest-invalid`: give `exactKeys2` the code as a parameter, or a sibling), the canonical re-encoding equal to the body, `isInstant` for `thinnedAt`, `by` in `update|backup`, and `Number.isSafeInteger` with a range check for `keep` (2 to 9999) and `bytes` (≥ 0), and `isHex64` for every `sha256`.
  - In `restore`, before :1052: `if (verdict.kind === 'thinned') refuse('source-thinned', \`the snapshot was thinned by design: ${verdict.reason}\`, { exit: 2 });`.
  - In `main` :1225, the exit becomes `v1 || legacy ? 0 : none || thinned ? 1 : 2`.
  - Add `thin --keep <n> --by <update|backup> …` to `USAGE` (Task 2 fills it in; `_bak_thin` reads the text `thin --keep`, D-6355), and add the verb and `thinned` to the VERBS paragraph. Amend WHAT IT NEVER DOES as listed above.
- [ ] **Step 4: Run them green**, and run the whole file. The existing `'each member is required …'` (:648) and `'The four words and their exits are what they were'` (:986) stay green unchanged: neither plants a record. Run `citations`.
- [ ] **Step 5: Documentation.**
  - `ccd/ccrc` usage :2592-2594, the same three lines, rewrapped:

    ```
                validate --from <timestamp-directory>   classify a backup's coordination
                snapshot (v1, legacy, none, thinned, invalid; exit 0, 0, 1, 1, 2; thinned:
                its data set was dropped by design; a helper that cannot run: 70)
    ```

    "usage or" leaves this sentence. The paragraph's 70 still covers usage, and README states it in full.
  - README :1179's row: `exits 0 (\`v1\`, \`legacy\`), 1 (\`none\`, \`thinned\`), 2 (\`invalid\`), 70 …`.
  - README :1203: `validate 0 for v1 and legacy, 1 for none and for thinned (a backup whose data set the retention dropped, D-6346), 2 for invalid`. Add that `restore` refuses a thinned source as `source-thinned`.
- [ ] **Step 6: Mutation rows** (each measured red, then restored):

| Mutation | Expected red |
|---|---|
| Delete the record branch in `classifyRaw` | H1 (`none`), H2, H3 |
| Delete the leftover loop (record plus a name reads `thinned`) | H2 |
| The stale-record test deleted (any present name reads interrupted) | H7 (`invalid`) |
| Drop `exactKeys2` on the record's top level | H3 (unknown key) |
| Delete `readThinned`'s canonical re-encoding check | H3 (non-canonical key order) |
| `readThinned`'s `keep` range check deleted, or its lower bound set to 1 | H3 (`keep: 1`, `keep: 10000`) |
| `readThinned` accepts `by: 'rollback'` | H3 |
| Delete `restore`'s `source-thinned` line | H4 (`source-invalid`) |
| Map `thinned` to exit 2 in `main` | H1, H5 |

- [ ] **Step 7: Commit.** `feat(snapshot): a thinned backup is its own word, and restore refuses it by name (wave 23, D-6348, D-6349)`.

### Task 2: `thin` keeps the newest N verified data sets and drops the rest, record first (W23-b; D-6346, D-6348, D-6350, D-6358)

**Files:**
- Modify: `deploy/coordination-snapshot.mjs` (new `quickState`, `dbUserVersion`, `thinOne` and `thinBackups` after `classifyRaw`; a `thin` arm in `main`; `main`'s catch at :1254).
- Test: `server/test/coordination-snapshot.test.ts`.

**Interfaces:**
- Consumes: Task 1's `classify`, `readThinned`, `THINNED_FILE` and `SNAPSHOT_NAMES`.
- Produces:
  - `export function quickState(fs, dir): { word: 'full' | 'none' | 'thinned' | 'interrupted' | 'stale' | 'damaged', source?: 'v1' | 'legacy', manifest?: object, detail: string }`. Presence and size only: the record (read, not hashed), the manifest (`readManifest`), each member's `lstat` and length. No hashing, no `quick_check`, no journal read.
    1. A record → `thinned`, `stale` or `interrupted` by D-6348's three-way read; an unreadable record → `damaged`.
    2. A manifest → `readManifest` (a defect → `damaged`). Each member: `present:true` needs `lstat` to be a regular file with `size === bytes`; `present:false` needs `lstat` to be null. Otherwise `damaged`, with the member and what was found. Then `full` (source `v1`) if any member is present, else `none`.
    3. No manifest → a sidecar present is `damaged`; a regular `coord.db` is `full` (source `legacy`, not inspected); else `none`.
  - `function dbUserVersion(fs, p): number | null`: the header's `user_version` through `fs.openRead(p)` (100 bytes: the SQLite magic, then bytes 60 to 63, big-endian). `null` when the file is absent, shorter than 100 bytes or not SQLite: its one caller treats all three alike (not a candidate), so the null is not overloaded at a seam.
  - `export function thinBackups({ own, verified, dirs, keep, by, fs = realFs, now = () => new Date(), out }): { kept: number, thinned: number, left: number, refused: number, stopped: boolean }`.
    - `own` and `verified` are paths or `null`; `dirs` are paths, newest first; `keep` is 2 to 9999; `by` is `'update' | 'backup'`; `out(line)` is called once per line, as it happens.
    - It throws only on a helper failure (an error that is neither a `SnapError` nor carries a string `code`), which `main` turns into 70.
  - CLI: `thin --keep <n> --by <update|backup> [--prefix <text>] [--own <dir>] [--verified <dir>] --dir <dir> [--dir <dir> …]`. Exit 0 when every dir was handled, 3 when one or more was refused or the budget stopped the walk (the rest were still handled), 70 on usage or a helper failure, including any `SnapError` that escapes the walk. 3, not 1, because node itself exits 1 when it cannot load the file. `--verified` must equal one of the `--dir` values, or the act is a usage error.
  - Lines, each led by `<prefix> ` when a prefix is given:
    - `thinned <name>: dropped its coordination data set (<MiB>M: <filenames joined ', '>); its code is kept, and coordination-thinned.json records when and why (CCRC_BACKUP_DATA_KEEP=<n>)`
    - `thinned <name>: finished an interrupted thinning (<MiB>M); coordination-thinned.json records when and why`
    - `kept <name>: its coord.db predates a schema migration (user_version <a> < <b>), so it is the one data set kept from before it`
    - `<name>: removed a thinning record that never started; the backup is whole`
    - `WARN: could not thin <name>: <code>: <detail> — it is left as it is`
    - `thinning stopped: <k> full verifications spent before the walk ended — every older backup is untouched until a later run`
    - the summary, printed only when this run thinned, finished, refused or stopped at least once: `coordination data sets: <kept> kept, <thinned> thinned this run, <left> left as they are`

    Here `<name>` is the dir's basename and `<MiB>` is `Math.floor(sum of dropped bytes / 1048576)`.

- [ ] **Step 1: Write the failing rows.** Add a describe, `'W23: thin keeps the newest N verified data sets and drops the rest, record first (D-6346, D-6348, D-6350, D-6358)'`.
  - Build data-bearing dirs with real captures (`setLive` with a journal, checkpoint and DB, then `snapshotOf`). Add `agent-dist/` and `memory/x.md` to each, as code and memory. Where a row needs a schema version, set `PRAGMA user_version = <n>` on the live DB before the capture.
  - Write a local `thinCli(home, args)` like `captureCli`.
  - Write a local `countingFs()`: a spread of `H.realFs` whose `openRead` records each path it opens, so a row can assert which files a run read.
  - Each row names its dirs by timestamp (`20261001-000000` …).
  - Rows:
    - `it('W23-T1: keep 2 of five data-bearing dirs, own first: the three oldest are thinned, each left holding exactly agent-dist, memory and the record, and the record describes what went')`. Asserts:
      - own and the newest earlier dir classify `v1`;
      - each of the three thinned dirs has `dirListing === ['agent-dist', 'coordination-thinned.json', 'memory']`;
      - its record has `source: 'v1'`, `by: 'update'`, `rule: {knob: 'CCRC_BACKUP_DATA_KEEP', keep: 2}`, and `capturedAt` equal to the old manifest's;
      - `dropped` deep-equals, in D-6348's order, the old manifest's present members as `{filename, bytes, sha256}` followed by `{filename: 'coordination-snapshot.json', bytes, sha256}` of the old manifest file;
      - stdout has three `thinned …` lines, oldest last, then the summary `coordination data sets: 2 kept, 3 thinned this run, 0 left as they are`, exit 0.
    - `it('W23-T2: own is counted first whatever its name, and never thinned')`: own is `20261001-000000` and the three others are later names. With `--keep 2`, own and the newest other stay `v1`; the two others are thinned.
    - `it('W23-T3: only valid data-bearing dirs count, and nothing else is touched: an empty v1, a code-only dir, an invalid dir and an already thinned dir')`. With `--keep 2`, own data-bearing and one valid full dir newer than the four, each of these four keeps a byte-identical listing and file contents (an `invalid` dir keeps its `coord.db`). A full dir older than all of them is thinned.
    - `it('W23-T4: a legacy coord.db past the count is thinned with source legacy, capturedAt null and coord.db as its one dropped member, measured')`.
    - `it('W23-T5: a crash after the first member delete leaves an interrupted dir; classify calls it invalid and the next thin finishes it')`:
      1. Call `H.thinBackups` with an `fs` that is a spread of `H.realFs` whose `unlink` throws an error with `code: 'EIO'` when its path is `join(dir, JOURNAL_FILE)` (the crash point named by path, never by a count of calls, so `writeAtomic`'s own cleanup `unlink` cannot move it). Expect the dir's `WARN: could not thin …: EIO: …` line and `refused: 1`. A second case throws an error with no `code` at the same point: `thinBackups` throws (the helper-failure path, 70 through `main`).
      2. Check the dir holds the record and the journal, checkpoint and manifest, with `coord.db` gone, and `H.classify(...).reason` starts `a thinning did not finish:`.
      3. Call `thinBackups` again with `realFs`, and expect a `finished an interrupted thinning` line and the T1 end state.
    - `it('W23-T6: a leftover whose bytes differ from its dropped entry is refused (exit 3) and kept; the other dirs are still thinned')`.
    - `it('W23-T7: own that is not a directory refuses the whole act: exit 3, one WARN line, nothing thinned')`.
    - `it('W23-T8: the command line: no --dir, a --keep of 0, 1, 10000 or x, a --by outside update and backup (rollback included), a --verified that is not a --dir, or an unknown flag exits 70 and changes nothing; --prefix leads every line; USAGE carries thin --keep')`.
    - `it('W23-T9: a dir whose record is malformed, or is a later version 2, between full dirs past the count is refused by name and left byte-identical, and the older dir is still thinned')`. Expect `WARN: could not thin <name>: thinned-invalid: …`, exit 3.
    - `it('W23-T10: two failed migrating attempts: the one data set from before the migration is kept, at the default, and only that one')`. Dirs, newest first after own (`user_version` 6): C2 6, P2 6, C1 6, P1 5, P0 4. `--keep 3`: own, C2 and P2 counted; C1 thinned; P1 kept with the `kept … (user_version 5 < 6)` line; P0 thinned. Exit 0. And with every `user_version` equal, P1 is thinned: that pins D-6347's stated limit.
    - `it('W23-T11: a record beside the whole set it lists (a crash before the first delete) is removed, and the dir is counted as an ordinary candidate')`. Plant the record beside a full set that the count reaches. Expect the `removed a thinning record that never started` line, no record left, the dir `v1`, and the count unchanged by it.
    - `it('W23-T12: past the count a dir is thinned on presence and size alone: no member of it is read')`. With `countingFs`, no past-count dir's journal or checkpoint is opened, and its `coord.db` only for the header read.
    - `it('W23-T13: own and the --verified dir are counted without a re-read, and only the dirs still to count are verified in full')`. With `countingFs`, own's and the `--verified` dir's journals are never opened; the third counted dir's is.
    - `it('W23-T14: a spent verification budget stops the walk before anything is thinned: exit 3, the stop line, every dir byte-identical')`. `--keep 2`, own not data-bearing, then five dirs that `quickState` reads full and `classify` calls invalid (a same-length change to each journal), then two valid ones.
- [ ] **Step 2: Run them red** (`-t 'W23: thin keeps'`). Expected: every row fails (the verb is unknown, so exit 70 and no lines).
- [ ] **Step 3: Implement `quickState`, `dbUserVersion`, `thinBackups` and `thinOne(fs, dir, q, {keep, by, now})`.**
  - The walk is D-6350's; the pre-migration check is D-6358's; the record read is D-6348's three ways (a stale record: `unlink` it, `fsyncDir`, and go on with the dir; an interrupted one: for each leftover name in `SNAPSHOT_NAMES` with an equal `dropped` entry by `measureFile` bytes and SHA-256, `unlink`; any other leftover → refused with `thin-foreign`).
  - Each dir's handling is inside its own `try`; a `SnapError` or an error with a string `code` → the WARN line and `refused++`. A dir that is not a directory, or a symlink, is refused (`thin-not-a-dir`).
  - `thinOne`:
    1. Build the record from `q.manifest` (v1: each present member's manifest figures, then the manifest file measured) or from `measureFile(coord.db)` (legacy).
    2. `writeAtomic(fs, join(dir, THINNED_FILE), …)`.
    3. Then `unlink` each `dropped` filename in order.
    4. Then `fs.fsyncDir(dir)`.
  - It never `rmdir`s and never touches any other name.
  - `main`'s `thin` arm parses repeatable `--dir` and single `--own`, `--verified`, `--keep`, `--by` and `--prefix`. `--keep` must match `/^[0123456789]{1,4}$/` and be ≥ 2. Out of range → 70.
  - `main`'s catch (:1254) returns 70 for an escaping `SnapError` when the verb is `thin`, as it does for `classify` and `validate`.
- [ ] **Step 4: Run them green**, then the whole file, then `citations`.
- [ ] **Step 5: Mutation rows:**

| Mutation | Expected red |
|---|---|
| `kept < keep` becomes `kept <= keep` | T1 (only two thinned) |
| Own walked in name order with the dirs instead of first | T2 (own thinned) |
| The kind guard drops `invalid` (an invalid dir with a `coord.db` is thinned) | T3 |
| The record written after the unlinks | T5 (no record after the crash; reason `member-missing`) |
| The finish path drops the hash comparison | T6 (the foreign leftover deleted) |
| `thinOne` deletes every entry but the record | T1 (listing) |
| The own-not-a-directory guard deleted | T7 |
| The `--keep` lower bound set to 1 | T8 |
| The per-dir `try` removed | T9 (exit 70, the older dir untouched) |
| `main`'s `thin` catch back to `err.exit` | T8 (`--verified` not a `--dir`) and T17, which expect 70 and get 1. T9 cannot see it: its per-dir `try` catches every `SnapError` (review 794, F12) |
| The pre-migration check deleted | T10 (P1 thinned) |
| The "one pre-migration keep" limit removed | T10 (P0 kept) |
| The stale-record branch deleted (a stale record read as interrupted) | T11 (the whole set deleted) |
| Past the count, `classify` instead of `quickState` | T12 (journals read) |
| `--verified` ignored | T13 (its journal read) |
| The budget check deleted | T14 (dirs thinned after the invalid run) |

- [ ] **Step 6: Commit.** `feat(snapshot): thin keeps the newest N verified data sets and drops the rest, record first (wave 23, D-6346, D-6350, D-6358)`.

### Task 3: update and `ccrc backup` thin after their prune (W23-c; D-6346, D-6347, D-6350, D-6352, D-6353, D-6355, D-6356, D-6357, D-6359, D-6360)

**Files:**
- Modify `ccd/ccrc`:
  - `_keep_why` (:23528-23532);
  - `_bak_keepset` (:23619; its own-dir and floor lines :23626-23627 and its `floor` assignment :23622);
  - `_bak_removable` (:23652; its floor and own-dir lines :23655-23657);
  - new `_bak_ours`, `_bak_data_keep` and `_bak_thin` after `_bak_removable` (:23662);
  - `_bak_prune` (:23566);
  - `_bak_gc` (:23725);
  - `_upd_report` (:22912-22913);
  - `cmd_update`'s `_bak_gc update` line (:18653) and its comment (:18649-18652);
  - the usage `update` (:2498-2503) and `backup` (:2583-2590) paragraphs, in place;
  - the comment headers of `_bak_keepset` (:23603-23618), `_bak_removable` (:23645-23651), `_bak_gc` (:23709-23724) and `_bak_snap_class` (:23664-23674).
- Modify `README.md`: :846, :1190-1196, :6539, :6574-6600.
- Test: `server/test/ccrc-update.test.ts`, `server/test/install-census.test.ts`, `server/test/ccrc-uninstall.test.ts`.

**Interfaces:**
- Consumes: Task 2's `thin` CLI and its exits (0 / 3 / 70).
- Produces:
  - `_bak_ours <dir>`: rc 0 when <dir> is this run's own or named at or after `UPD_BAK_FLOOR`, or when the floor is unparsable; rc 1 otherwise.
  - `_bak_data_keep`: rc 0 sets `BAK_DATA_KEEP` (decimal 2 to 9999); rc 1 sets `BAK_DATA_KEEP_WHY` to the refusal sentence.
  - `_bak_thin <verb: update|backup> <line prefix>`: rc 0 nothing refused (including "nothing to pass" and "the helper predates thinning"); rc 1 refused, stopped, an unparsable floor, or the helper missing or failed. It never dies. Its caller holds `update.lock` and has run `_bak_list` and `_bak_keepset`.

- [ ] **Step 1: Write the failing rows.** Add a describe nested in `'ccrc backup and update: the coordination snapshot callers …'` after the D-4641 describe: `'W23: update and ccrc backup thin the data set past CCRC_BACKUP_DATA_KEEP (D-6346, D-6347, D-6350)'`.
  - Extend `plantDir`'s `Kind` with `'tree+v1-full'`: a real capture of a live journal, checkpoint and DB, plus `agent-dist`.
  - Add `'CCRC_BACKUP_DATA_KEEP'` to `updateEnv`'s scrub list (ccrc-update.test.ts:707-708) and to ccrc-uninstall.test.ts's (:148-149).
  - Rows:
    - `it('W23-B1: ccrc backup with five earlier full dirs and the default keeps three data sets (its own and the two newest earlier) and thins the other three, code kept, one line each, by backup')`.
      - Exit 0.
      - The three oldest each list exactly `['agent-dist', 'coordination-thinned.json']`, and each record says `by: 'backup'`.
      - stdout matches `/^backup: thinned 20250103-000000: dropped its coordination data set \(\d+M: coord\.db, delegation-events\.log, delegation-checkpoint\.json, coordination-snapshot\.json\); its code is kept, and coordination-thinned\.json records when and why \(CCRC_BACKUP_DATA_KEEP=3\)$/m`, and likewise for `…02` and `…01`, then `backup: coordination data sets: 3 kept, 3 thinned this run, 0 left as they are`.
      - `20250105-000000` and `20250104-000000` stay `v1` (through `helper(home, ['validate', '--from', d])`).
    - `it('W23-B2: an update whose gate passes thins the same way, after its prune, under update: backups:, and its records say by update')`.
    - `it('W23-B3: a CCRC_BACKUP_DATA_KEEP of 0, 1, 00, 10000, x or ٣ refuses: an update WARNs and prunes and thins nothing; ccrc backup dies after its backup')`.
      - The update's stdout matches `/^update: backups: WARN: CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999 — nothing pruned or thinned$/m`, and every planted dir is byte-identical.
      - `ccrc backup` exits 1 with `CCRC_BACKUP_DATA_KEEP='0' is not a whole number from 2 to 9999 — nothing was pruned or thinned` in `_ccrc_die`'s own form.
    - `it('W23-B4: a failed gate (exit 4), --no-gate, a --from restore child and another holder of update.lock thin nothing')`. Reuse P5, P6 and P12's setups with full dirs planted.
    - `it('W23-B5: a dir named at or after this run\'s lock second is neither counted nor thinned')`. Source `_bak_list`, `_bak_ours`, `_bak_data_keep` and `_bak_thin` with `UPD_BAK_FLOOR='20250110-000000'`, `UPD_BACKUP_DIR="$R/20250110-000001"`, a full `29991231-000000` and three earlier full dirs, at `CCRC_BACKUP_DATA_KEEP=2`. `29991231-000000`, own and the newest earlier dir stay `v1`; the two older earlier dirs are thinned.
    - `it('W23-B6: own named below an earlier full dir (a clock stepped back) is still counted first')`. The same harness with own `20250101-000000` and earlier full dirs `20250105-…`, `20250106-…` and `20250107-…` below a floor of `20250110-000000`, at keep 2. Own and `20250107-…` stay `v1`; the two others are thinned.
    - `it('W23-B7: the classifier failing stops the prune and the thinning alike')`. `withShim(home, { FX_CLASSIFY_FAIL: '1' })`: every full dir is unchanged.
    - `it('W23-B8: a thinned dir is never a snapshot keep: the next prune treats it as a code-only dir')`. At KEEP=0, a thinned dir that is not the tree keep is removed. One that is the newest earlier tree is kept by `BAK_KEEP_TREE`.
    - `it('W23-B9: the helper failing (exit 70) or missing from the tree is one WARN line each, worded apart, and the run\'s exit is unchanged')`. Shim `thin` to exit 70: `/^update: backups: WARN: the coordination data set could not be thinned \(the helper exited 70\) — every backup it had not reached is untouched$/m`. Remove the helper from the fixture tree, with only thinned dirs below the floor (a full dir there would stop `_bak_keepset`'s classifier first, which is B7's arm): the missing-helper WARN. The update exits 0 both times.
    - `it('W23-B10: thin refusing (exit 3) makes _bak_gc return 1 with no WARN of its own, and the prune lines are unchanged')`. Source `_bak_list`, `_bak_keepset`, `_bak_removable`, `_bak_ours`, `_bak_data_keep`, `_bak_thin` and `_bak_gc` (or `sourcedCcrc`) into a fixture HOME with the node shim answering `thin` with exit 3. Assert `_bak_gc update`'s rc is 1, no `could not be thinned` line, and the `pruned …` lines equal those of the same fixture with `thin` answering 0.
    - `it('W23-B11: a ccrc backup inside an update\'s unlocked sweep keeps that update\'s pre-update backup at the lowest keep')`. Plant U (a full dir) named below the backup's floor and an `update.json` reading `restarting` under another pid, plus older full dirs; run `ccrc backup` at `CCRC_BACKUP_DATA_KEEP=2`. U stays `v1`.
    - `it('W23-B12: the knob set only in ~/.ccrc/ccrc.env is honoured: 9999 thins nothing, and 1 there is refused like 1 in the environment')`.
    - `it('W23-B13: a rollback by flip never thins, and _bak_thin reads a helper that predates thinning by name: one skipped line, rc 0, no WARN')`. A sourced `_bak_gc rollback` with full dirs past the count prints no `thinned` and no `thinning` line. A sourced `_bak_thin update` against a fixture helper whose text lacks `thin --keep` prints `update: backups: thinning skipped — this tree's coordination-snapshot helper predates it; nothing was thinned` and returns 0.
    - `it('W23-B14: on a downgrade, a thinned own backup is reported as thinned, never as one that held no coord.db')`. A sourced `_upd_report` with a downgrade version pair and `UPD_BACKUP_DIR` holding only the record and `agent-dist`: the D-6359 line, and not `(no coord.db existed before this run`. With neither file: the old line, unchanged.
    - `it('W23-B15: a completed update re-stamps its report as restarting, pruning and thinning, before _bak_gc runs')`. The node shim copies `~/.ccrc/update.json` aside when it is asked `thin`. The copy reads `phase: restarting`, `detail: pruning and thinning ~/ccrc-backups`, and an `updatedAt` no older than the sweep's report. A report another pid wrote is not re-stamped.
    - `it('W23-B16: _bak_thin with an empty or unparsable floor returns 1 and passes nothing')`.
    - `it('W23-S1: the own-dir and floor filter is spelled once, in _bak_ours, and _bak_keepset, _bak_removable and _bak_thin each call it')`: `src.split('= "$UPD_BACKUP_DIR" ]').length - 1` is 1, the floor comparison on `${UPD_BAK_FLOOR//-/}` appears once outside the floor regex checks, and each of the three bodies matches `/^ +.*_bak_ours "\$d"/m`.
  - In install-census.test.ts's `callers` describe (:1975), apply D-6353's widening.
- [ ] **Step 2: Run them red** (`-t 'W23: update and ccrc backup'`; install-census whole). Expected:
  - B1, B2, B3, B5, B6, B9's missing-helper half, B10 to B16 and S1 fail (no `_bak_thin`, `_bak_data_keep` or `_bak_ours`, no re-stamp, no thinned line).
  - B4, B7 and B8 pass vacuously: they are anchors, and must stay green after Step 3.
  - B9's shim half fails.
  - The census fails on `_bak_thin`.
- [ ] **Step 3: Implement** *(prototype text; the worker measures it)*.

  ```bash
  _keep_why() { # <knob> <value> [<lowest allowed>, default 0]
    local val="$2"
    [ "${#val}" -le 32 ] || val="${val:0:32}..."
    printf "%s='%s' is not a whole number from %s to 9999" "$1" "${val//[![:print:]]/?}" "${3:-0}"
  }

  _bak_ours() {   # <dir> — rc 0: this run's own, or named at or after UPD_BAK_FLOOR (an unparsable floor: every dir)
    local name="${1##*/}"
    [[ "$UPD_BAK_FLOOR" =~ ^[0-9]{8}-[0-9]{6}$ ]] || return 0
    [ "$1" = "$UPD_BACKUP_DIR" ] || [ "$((10#${name//-/}))" -ge "$((10#${UPD_BAK_FLOOR//-/}))" ]
  }

  _bak_data_keep() {
    BAK_DATA_KEEP="${CCRC_BACKUP_DATA_KEEP:-}"; BAK_DATA_KEEP_WHY=""
    [ -n "$BAK_DATA_KEEP" ] || { [ -f "$BOX_ENV_FILE" ] && [ -r "$BOX_ENV_FILE" ] && BAK_DATA_KEEP="$(_box_env_value "$BOX_ENV_FILE" CCRC_BACKUP_DATA_KEEP)"; }
    BAK_DATA_KEEP="${BAK_DATA_KEEP:-3}"
    if _keep_ok "$BAK_DATA_KEEP" && [ "$((10#$BAK_DATA_KEEP))" -ge 2 ]; then BAK_DATA_KEEP=$((10#$BAK_DATA_KEEP)); return 0; fi
    BAK_DATA_KEEP_WHY="$(_keep_why CCRC_BACKUP_DATA_KEEP "$BAK_DATA_KEEP" 2)"; return 1
  }

  _bak_thin() { # <verb: update|backup> <line prefix>
    local i d rc=0 helper="$CCRC_HERE/../deploy/coordination-snapshot.mjs"
    local -a own=() ver=() dirs=()
    [[ "$UPD_BAK_FLOOR" =~ ^[0-9]{8}-[0-9]{6}$ ]] || return 1
    [ -z "$UPD_BACKUP_DIR" ] || own=(--own "$UPD_BACKUP_DIR")
    [ -z "$BAK_KEEP_DATA" ] || ver=(--verified "$BAK_KEEP_DATA")
    for ((i = ${#BAK_DIRS[@]} - 1; i >= 0; i--)); do
      d="${BAK_DIRS[$i]}"; _bak_ours "$d" && continue
      { [ -e "$d/coordination-snapshot.json" ] || [ -e "$d/coord.db" ] || [ -e "$d/coordination-thinned.json" ]; } && dirs+=(--dir "$d")
    done
    [ "${#dirs[@]}" -gt 0 ] || return 0
    [ -f "$helper" ] || { echo "$2 WARN: deploy/coordination-snapshot.mjs is missing from this tree, so nothing was thinned"; return 1; }
    grep -qF -- 'thin --keep' "$helper" || { echo "$2 thinning skipped — this tree's coordination-snapshot helper predates it; nothing was thinned"; return 0; }
    node --no-warnings "$helper" thin --keep "$BAK_DATA_KEEP" --by "$1" --prefix "$2" "${own[@]}" "${ver[@]}" "${dirs[@]}" || rc=$?
    case "$rc" in 0) return 0 ;; 3) return 1 ;; esac
    echo "$2 WARN: the coordination data set could not be thinned (the helper exited $rc) — every backup it had not reached is untouched"; return 1
  }
  ```

  - `_bak_keepset`: `[ "$d" = "$UPD_BACKUP_DIR" ] && continue` and the floor line (:23626-23627) become `_bak_ours "$d" && continue`; drop the now-unused `floor` and `name` locals and the `floor=` assignment (:23622 keeps `n=${#BAK_DIRS[@]}`).
  - `_bak_removable`: keep `local d="$1"` and the floor regex line (:23654, pinned); the `floor=` line and the own-dir and floor clauses (:23655-23657) become `_bak_ours "$d" && return 1`.
  - `_bak_prune`: right after the KEEP refusal (:23568-23569), add `_bak_data_keep || _ccrc_die "$BAK_DATA_KEEP_WHY — nothing was pruned or thinned"`. After the removal loop, before the unlock (:23599), add `_bak_thin backup "backup:" || :`.
  - `_bak_gc`: after `keep=$((10#$keep))` (:23731), add `_bak_data_keep || { echo "$lead: backups: WARN: $BAK_DATA_KEEP_WHY — nothing pruned or thinned"; return 1; }`. After the loop, before the unlock (:23765), add `[ "$lead" != update ] || _bak_thin update "$lead: backups:" || rc=1`.
  - `_upd_report`: before the `else` at :22912, add the D-6359 `elif [ -e "$UPD_BACKUP_DIR/coordination-thinned.json" ]; then echo "…"`, on one line, with the path through `_upd_redact`, as :22909 does.
  - `cmd_update` :18653 becomes, on its one line: `if [ "$gate_passed" -eq 1 ] && [ "$UPD_FROM" != restore ]; then _upd_report_is_mine && _upd_phase restarting "pruning and thinning ~/ccrc-backups"; _bak_gc update || :; fi`. Its comment (:18649-18652) says why (D-6356), with no line numbers.

  The KEEP refusal's own text (`… — nothing pruned`) is unchanged: the ccrc-uninstall describe `'ccrc backup: CCRC_BACKUP_KEEP is one bounded number …'` (:1446) pins it. The headers of `_bak_keepset`, `_bak_removable`, `_bak_gc` and `_bak_snap_class` gain a sentence each, naming D-6346, D-6350, D-6355 and D-6357 and saying why the classifier never sees a thinned dir, with no line numbers.
- [ ] **Step 4: Run them green.** Then run the pruner describe (`-t 'is pruned after a completed run'`), the snapshot-callers describe (`-t 'the coordination snapshot callers'`), the E2/E3 `_bak_removable` row (`-t '_bak_removable answers removable'`), install-census whole, ccrc-uninstall `-t 'ccrc backup'`, and `citations`.
  - Any existing row that now prints a `thinned` or summary line, or whose planted dir is now thinned, is one that planted more than three data-bearing dirs. Name each such row in the as-built note, and either assert the new line, or set `CCRC_BACKUP_DATA_KEEP` in that row's env where the row is about something else. Never loosen its assertions.
  - Any existing row that reads `update.json`'s detail after `_bak_gc` now sees the re-stamp. Name it the same way.
- [ ] **Step 5: Usage and README** (D-6352: each usage paragraph keeps its line count; the lines below are measured).
  - Usage `update` (:2498-2503), exactly these six lines in place of the six there:

    ```
                After a passed gate and a finished sweep, ~/ccrc-backups is pruned
                to the newest CCRC_BACKUP_KEEP (default 10, read from the process
                environment only) timestamped backups, never this run's own; then
                every backup past the newest CCRC_BACKUP_DATA_KEEP (default 3; the
                environment, else ~/.ccrc/ccrc.env) that carry the coordination
                data set is thinned to its code and coordination-thinned.json.
    ```

  - Usage `backup`: lines :2580-2582 unchanged; :2583-2590, exactly these eight lines in place of the eight there (the paragraph stays at eleven):

    ```
                ~/ccrc-backups/<ts>/ (never ~/.ccrc/collect-lane-generation.log: a
                restore leaves it in place), then prune to the newest \$CCRC_BACKUP_KEEP
                (default 10) timestamped backups — never this run's own or one named
                after it began, nor the newest earlier tree backup, valid coordination
                snapshot and valid one that holds data — then thin the data set from
                each past the newest \$CCRC_BACKUP_DATA_KEEP (default 3) that carry one;
                skipped while another ccrc run holds ~/.ccrc/update.lock — hand-made
                siblings are never touched
    ```

    The pinned phrases survive whole (Global Constraints). Measure with `git diff -U0` that both hunks have equal old and new counts.
  - README edits:
    - :846: add "and the coordination data set thinned out of every backup past the newest `CCRC_BACKUP_DATA_KEEP` (default 3, at least 2; the environment, else `~/.ccrc/ccrc.env`) that carry one, by an update or `ccrc backup`, never a rollback by flip".
    - :1190-1196: add a sentence giving the D-6346 rule, the D-6358 pre-migration keep, the D-6348 record, the 2-to-9999 range and the refusal of `0` and `1`.
    - :6539: add that deploy's dirs are thinned by the next `ccrc` run, never by deploy.sh.
    - The Restore block (:6574-6600): after its opening sentence, which stays verbatim (pools-prose.test.ts:779 ends a passage there), add that a restore is from a dir that `ccrc coordination-snapshot validate --from <dir>` calls `v1`, that a `thinned` one is refused as `source-thinned`, and that the newest backups and the one kept from before a schema migration are the ones that carry a data set.
- [ ] **Step 6: Mutation rows:**

| Mutation | Expected red |
|---|---|
| `_bak_data_keep` loses `-ge 2` | B3 (the `1` row thins past own and one) |
| `_bak_data_keep` loses its `ccrc.env` read | B12 |
| `_bak_gc`'s `_bak_data_keep` line deleted | B3 (the update prunes) |
| `_bak_prune`'s `_bak_data_keep` line deleted | B3 (`ccrc backup` exits 0) |
| `_bak_gc`'s `_bak_thin` call deleted | B2 |
| `_bak_gc`'s lead test deleted (a rollback thins) | B13 |
| `_bak_prune`'s `_bak_thin` call deleted | B1 |
| `_bak_thin` passes a literal `--by update` | B1 (records say update) |
| `_bak_thin` moved before `_ver_lock_try` in `_bak_gc` | B2. `BAK_DIRS` is empty until `_bak_list`, so the moved call thins nothing; B4 cannot see it (review 794, F11). The lock is pinned on its own by B19 (fix round 1): `thin` runs while `update.lock` is held, for an update and for `ccrc backup`, and releasing the lock before either call turns B19 red |
| `_bak_thin` moved before the classifier-failure return | B7 |
| `_bak_thin`'s `_bak_ours` call deleted | B5 (`29991231-000000` counted, own passed as a dir) |
| Own passed as a `--dir` in name order instead of `--own` | B6 (own thinned) |
| `_bak_thin`'s floor regex line deleted | B16 |
| The `3) return 1` arm folded into `0) return 0` | B10 (rc 0) |
| The predates check deleted | B13 (a WARN with exit 70) |
| The missing-helper line deleted | B9 (the missing half: the "predates" skip line, rc 0, instead of the WARN) |
| `_upd_report`'s thinned `elif` deleted | B14 |
| `cmd_update`'s re-stamp deleted | B15 |
| `_bak_keepset` or `_bak_removable` spells its own own-dir clause again | S1 |

  - Also confirm, without editing, that these stay green:
    - `delegation-wave3.integration.test.ts -t 'no physical journal compaction'`;
    - the structural pins at ccrc-update.test.ts:13114 and :13128;
    - `collect-lane-restore-wording.test.ts`;
    - `pools-prose.test.ts`;
    - `ccrc-cli.test.ts`.
- [ ] **Step 7: Measure the time under the lock** (one-off, in the scratch directory, never a suite row: a full-size fixture would break the disk rule on a CI runner). Start only when `df` reports at least 20G free on the scratch volume; stop and delete the dir the moment it drops under 10G.
  1. Build one capture with a `coord.db` of about 1G (a table of random blobs), and a journal as large as the fixture generator makes in reasonable time (record its size). Time `validate --from` on it: that is one full verification.
  2. Copy its manifest-and-member layout into seven more dirs (`cp --reflink=auto` where it works, else accept the disk cost of one more set at a time, thinning between copies) and time `thin --keep 2` over them: that is the unlink-only cost past the count.
  3. In the PR body, state the worst case at the default as (keep − 1 + 1 pre-migration + 2 spare) full verifications, scaled from 1. to the server box's 1079M DB and 674M journal, plus 2., against `CCRC_UPDATE_DEADLINE_MS` (15 minutes), and note that the re-stamp restarts that clock after the sweep. Delete every file of the measurement.
- [ ] **Step 8: Commit.** `feat(ccrc): update and backup thin the coordination data set past CCRC_BACKUP_DATA_KEEP (wave 23, D-6346, D-6347, D-6350, D-6355 to D-6360)`.

### Task 4: The gate and the PR

- [ ] **Step 1: Landing tip.** Run `git fetch origin main`, merge it (after the first push; rebase before it), and re-read every anchor named above in the landed text. Run the Appendix row against the tip.
- [ ] **Step 2: Touched suites, one file at a time, behind the memory gate.**
  - Whole: `coordination-snapshot`, `install-census`, `collect-lane-restore-wording`, `pools-prose`, `ccrc-cli`, `coord-db`, and `agent/test/deploy-verify.test.ts` (unchanged, run to confirm).
  - By describe or case:
    - `ccrc-update`: the pruner describe; the snapshot-callers describe, including W23; `REPORT_KEYS`; the arm-3 hazard describe at :5706.
    - `ccrc-uninstall`: `-t 'ccrc backup'`.
    - `delegation-wave3.integration`: `-t 'no physical journal compaction'`.
    - `session-hook`: `-t 'CITATION DEBT'`.
  - **Unmeasured, and so listed:** every file run only by describe. CI is the arbiter. Push, read the PR's `select tests` summary, and confirm it lists each touched file (a `ccd/ccrc` change selects widely). For a file it does not list, ask the coordinator for a full run (`gh workflow run ci.yml --ref <branch> -f mode=full`).
- [ ] **Step 3: Repo guards.**
  - `GROWTH_CHECK=1 … test/growth-check.test.ts`: record the measured net line count of `ccd/ccrc`.
  - `citations`, `docs-parity`, `single-definition`, `topology-clean`, `private-names`, `dtbd`, `typecheck-tests`.
  - After `git fetch origin main`, `deviation-refs`. Check directly that each of D-6346 to D-6365 is defined exactly once, in this plan (`grep -cE '^- \*\*D-(634[6-9]|635[0-9]|636[0-5])\.\*\*'` reads 20; the worker defined D-6361 to D-6363 from its reserve, and D-6364 and D-6365 by the rulings on review 794), and nowhere on `origin/main`. Any reserve number the worker defines is added to that pattern and that count.
- [ ] **Step 4: The wave-done fingerprint.** The `suite:` line is one word: `green` only when every touched file ran whole and green locally, `red` when any ran red, otherwise `unrun`. List every file run only by describe in the as-built note.
- [ ] **Step 5: The PR body.**
  - The D-6346 rule, the knob, its range and default with D-6347's argument and its stated limit, the D-6358 pre-migration keep, and the saving table above.
  - The install-path fact (Risk notes): the installing update cannot thin, and the first thinning on the server box is one `ccrc backup` the operator runs after the rollout.
  - Task 3 Step 7's measured times against the deadline.
  - Every pin it changed, named: the install-census `callers` widening (D-6353), the two scrub lists, and any existing pruner row that now sets `CCRC_BACKUP_DATA_KEEP` or asserts a new line.
  - The function list of Global Constraints.
  - The PR body ends with the attribution line this session's reminder gives.

## Readings (for the coordinator to rule; each chosen where no ruling decided it)

1. **The default and the floor.** Chosen: default 3, lowest 2 (D-6347). 2 is what the base guarantees and frees about 1.8G more, but loses a failed update's pre-failure snapshot at the next completed update when the failed build changed data without a migration. A floor of 1 was revision 1's; it let a concurrent `ccrc backup` thin an in-flight update's own pre-update backup.
2. **The manifest goes with the members.** Chosen: dropped, and recorded in `dropped` (D-6348). The alternative keeps it and marks the dir with the record only. That gives richer context for a reader, but every pre-wave helper then calls the dir `invalid` (damage), and its pre-filter starts node for it.
3. **The count verifies in full, past the count reads presence and size.** Chosen (D-6350): full `classify` only for a set about to be counted that this run has not verified already, a budget of `keep + 2`, and a presence-and-size reading past the count, with the record's member figures from the manifest. The alternatives: revision 1's full verification of every walked dir (about ten data sets on the first run, under the lock and past the deadline's reach), or presence and size for the count too (a corrupt newest data set would count as one of the N).
4. **The pre-migration keep.** Chosen: one, by `user_version` from the header (D-6358). The alternative is none, with D-6347's guarantee stated as "one failed attempt": cheaper by one data set while a migration lies inside the window, and a two-failure sequence then loses the only snapshot an older build's by-hand restore could use.
5. **An invalid `CCRC_BACKUP_DATA_KEEP` stops the count prune too.** Chosen: one refusal, nothing pruned or thinned, the house rule for a bad knob, on a rollback too. The alternative prunes by count and skips only the thinning.
6. **The listing waits for a follow-up.** Chosen (D-6351). The alternative lands `list`, a `ccrc versions` listing and a doctor check in this wave, behind their own pins and the follow-up fixes listed under Not in this wave.
7. **A rollback by flip does not thin.** Chosen (D-6355). The alternative thins on a flip too, with the helper's stderr in the WARN; a flip adds no data set, so it would only ever finish work another run left.
8. **The new knob also reads `ccrc.env`.** Chosen (D-6360), an asymmetry with `CCRC_BACKUP_KEEP`, which stays environment-only. The alternative reads both from `ccrc.env`, which changes a documented knob outside this wave's ruling.

## Appendix: the row script

### `w23-thin-row.sh`

```bash
#!/usr/bin/env bash
# Prototype row for Task 3 (B5 and B6 in one): sources _bak_list, _bak_ours, _keep_ok, _keep_why, _bak_data_keep and
# _bak_thin from the ccrc file given as $1 into a fresh mktemp -d HOME; plants five LEGACY snapshots (a bare, valid coord.db
# with no delegation table, which classify calls legacy and data-bearing) beside an agent-dist; runs _bak_thin at keep 2
# with a floor and an own dir named below three earlier ones; prints what each dir classifies as.
set -uo pipefail
src="$1"; repo="$(cd "$(dirname "$src")/.." && pwd)"
HOME="$(mktemp -d)"; export HOME
R="$HOME/ccrc-backups"; mkdir -p "$R"
H="$repo/deploy/coordination-snapshot.mjs"
for n in 20250101-000000 20250105-000000 20250106-000000 20250107-000000 29991231-000000; do
  mkdir -p "$R/$n/agent-dist"
  node --no-warnings -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec("CREATE TABLE fixture (x INTEGER)");d.close();' "$R/$n/coord.db" \
    || { echo "plant failed for $n"; exit 1; }
done
for fn in _bak_list _bak_ours _keep_ok _keep_why _bak_data_keep _bak_thin; do
  eval "$(sed -n "/^$fn() [{(]/,/^[})]\$/p" "$src")"
done
BOX_BACKUP_ROOT="$R"; BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"; BAK_KEEP_DATA=""
BAK_TS_PAT='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'
CCRC_HERE="$repo/ccd"; UPD_BAK_FLOOR='20250110-000000'; UPD_BACKUP_DIR="$R/20250101-000000"
CCRC_BACKUP_DATA_KEEP=2; _bak_data_keep || { echo "knob: $BAK_DATA_KEEP_WHY"; exit 1; }
_bak_list
_bak_thin backup "row:"; echo "rc $?"
for d in "$R"/*; do printf '%s ' "${d##*/}"; node --no-warnings "$H" classify --from "$d"; done
rm -rf -- "$HOME"
```

Expected:
- two `row: thinned 2025010[56]-000000: dropped its coordination data set (0M: coord.db); …` lines, then `row: coordination data sets: 2 kept, 2 thinned this run, 0 left as they are`, then `rc 0`;
- `20250101-000000` (own, named below the others), `20250107-000000` (the newest earlier) and `29991231-000000` (named after the floor) classify `legacy`;
- `20250105-000000` and `20250106-000000` classify `thinned`, and each still holds `agent-dist`.

Run the row against the base file, where `_bak_thin` does not exist, and it stops at the `eval` with nothing thinned: that is the red.

## Review notes (fix round 1, 2026-10-22)

Three lenses (restore safety, tests and guards, scope and landing) read revision 1. Every blocker and major finding is fixed; the table gives each finding's disposition. Task numbers in the first column are revision 1's.

| Lens, finding | Disposition |
|---|---|
| restore-safety, major: a `ccrc backup` in an update's sweep window thins that update's own backup at keep 1 | Fixed: floor raised to 2 (D-6347), pre-migration keep (D-6358), `_upd_report`'s thinned line (D-6359), B11, B14. Partly differently: the thinned line points at `validate --from` for "when and by which verb" rather than reading the record in bash, so `_upd_report` gains no helper call or census entry. The in-flight-report guard was not added: at keep ≥ 2 with D-6358 it guards a case that needs two concurrent backups inside one sweep window, and it would cost about eight lines of the growth cap. |
| restore-safety, major: full verification of every dir under the lock, past the deadline | Fixed: D-6350's bounded walk (own and `--verified` not re-verified, a `keep + 2` budget, presence and size past the count, figures from the manifest), the re-stamp (D-6356), T12 to T14, B15. The per-run cap on dirs thinned was not added: past the count a thinning is a record write and four unlinks, so the cap would only slow the drain the operator asked for; the verification budget is the bound that matters. |
| restore-safety, major: two failed attempts lose the clean pre-migration set | Fixed: D-6358, and D-6347's guarantee restated with its limit; T10 pins both outcomes. |
| restore-safety, minor: a crash before the first unlink reads as damage | Fixed: the stale-record read (D-6348, D-6349), H7, T11. |
| restore-safety, minor: the knob is environment-only | Fixed: D-6360, B12. |
| tests-guards, major: doctor's fixture has no helper, so healthy WARNs | Moot here: the doctor check moved to a follow-up (D-6351); the fix is carried in Not in this wave. |
| tests-guards, major: no row for doctor's unmeasured arm | Moot here, carried the same way. |
| tests-guards, major: a SnapError escaping `thin` exits 1 | Fixed: `main`'s catch returns 70 for `thin`, the per-dir `try` (D-6350), T9 and two mutation rows. |
| tests-guards, major: D-6346 false at keep 1 | Fixed: floor 2 (D-6347); D-6346 now holds at every allowed value; B3 adds `1`; B5, B6 at keep 2. |
| tests-guards, major: the `3) return 1` mutation has no row | Fixed: B10. |
| tests-guards, minor: scrub lists | Fixed: both lists, and ccrc-uninstall.test.ts joins the files and Group B. |
| tests-guards, minor: mutation rows missing | Fixed: canonical text, keep range, `--keep` bound, `by` (B1 asserts `backup`, B2 `update`; a rollback by flip no longer thins). The DB1 pin is moot with the doctor check. |
| tests-guards, minor: `_bak_thin`'s unguarded floor and third copy | Fixed: the regex line, `_bak_ours` (D-6357), B16, S1. |
| tests-guards, minor: the pools-prose marker | Fixed: listed in the pins; pools-prose runs in Task 3 and Task 4. |
| tests-guards, minor: the usage sentence does not fit six lines | Fixed: exact lines given and measured (six at most 78 columns; the backup paragraph's eight at most 84, the base's own last line being 85). |
| tests-guards, minor: T5's fault by call count; WHAT IT NEVER DOES | Fixed: fault by path; the paragraph is in Task 1's edit list. |
| scope-landing, major: verification cost; the installing update; wall time | Fixed: as the restore-safety major; the Risk note now says "cannot thin" and names the first `ccrc backup`; the measurement is Task 3 Step 7, a one-off with disk bounds rather than a suite row, because a full-size fixture breaks the disk rule on a runner. |
| scope-landing, minor: rollback with an older helper | Fixed: a rollback by flip never thins, and a helper that predates thinning is skipped by name (D-6355), B13. |
| scope-landing, minor: no per-dir catch | Fixed, with the tests-guards finding; T9 covers `version: 2`. |
| scope-landing, minor: what doctor says can be wrong | Moot here with the doctor check; the leftover-size rule and the PASS wording are carried to the follow-up. The interrupted remedy in `classify`'s reason is reworded (D-6349). |
| scope-landing, minor: Tasks 3 and 5 on the critical path | Accepted: moved to a follow-up (D-6351); the Goal no longer names `ccrc versions` or `ccrc doctor`. `thin` prints a summary line instead. |
| scope-landing, minor: D-6346 and the floor | Fixed with the floor of 2. |
| scope-landing, minor: citations in test files | Fixed: the constraint covers every added code and test line, and `citations` runs after each task. |
| scope-landing, minor: a third spelling of the own-dir and floor filter | Fixed: `_bak_ours` (D-6357), S1. |

## Coordinator rulings on this plan's readings (2026-10-22)

- **Readings 1 to 8: as chosen.**
  - The default is 3 and the lowest value 2 (D-6347).
  - The manifest goes with the members (D-6348).
  - The count verifies in full within its budget, and past the count presence and size decide (D-6350).
  - There is one pre-migration keep (D-6358).
  - An invalid knob stops the count prune too.
  - The listing waits for a follow-up (D-6351).
  - A rollback by flip does not thin (D-6355).
  - The new knob also reads `ccrc.env` (D-6360).
- **The spec's retention prose is not amended in this wave.** This plan and README carry the rule, and the follow-up that lands the listing (D-6351) amends the spec with it.
- **Context, not scope.** On 2026-10-22 the operator also set the server box's `CCRC_BACKUP_KEEP` to 5 for the delegation broker's soak, in the user manager's environment. That changes no task here: `CCRC_BACKUP_KEEP` keeps its documented environment-only rule.
  - With 5 kept and the default of 3, thinning frees two data sets on the server box, about 3.5G at today's sizes.
  - Without that setting it frees seven, as the table above says.
- **Live claims at dispatch.** Claim 2212 (run 774) holds `README.md`, and claim 2210 (run 722) holds `ccd/ccrc`. The coordinator has asked both coordinators for consent to this plan's hunks. Until the coordinator mails a consent, or the claim ends:
  - Group A is taken without `README.md`; the README edits wait.
  - Group B waits.

## As built (worker, 2026-10-22)

- **Claims.** The uncontested paths were claimed together; `README.md` (claim 2212) and `ccd/ccrc` (claim 2210) were edited under the two coordinators' consents (mails 7946/7949 and 7947/7950), only in the hunks this plan lists, because a claim is all-or-nothing and the store refuses an overlap.
- **Task 3's prototype, as measured.** The four new functions are the prototype text, except that `_bak_thin` expands `--own` and `--verified` with the tree's empty-array idiom. The `backup` usage paragraph keeps its eight lines but is wrapped differently from Step 5's text: the journal-name line must not carry `<ts>/` (a `single-definition` rule reads `>` on that line). `_upd_report`'s thinned line prints the redacted path itself where Step 5 wrote `<dir>`. README's Restore block says `v1` only, because `restore` refuses anything else.
- **Existing rows changed: two**, both in `ccrc-update.test.ts`'s `'… update.json at every phase, and --from (design §10)'` describe: the moving run's phase list and the fields row's. Each pinned the exact sequence of report writes, and D-6356's re-stamp adds a second `restarting`, which comes after the sweep and so carries the `sweep` key. Each now asserts the new write, its detail and its keys; neither was loosened. Task 3's implementer missed them, and the Task 4 gate found them. The other edits to existing test code are the two scrub lists, the `callers` widening (D-6353), two additive node-shim lines, a `plantDir` kind and one journal constant.
- **Reviews.** Each task was read by its own reviewer, and the fix-ups were reviewed again; no blocker or major was found. What the minors changed is D-6361 to D-6363, `readThinned`'s drop-order check (D-6348's shape, now enforced), README's "never a rollback by flip", and `cmd_update`'s comment on the re-stamp's unlocked window. Carried, not done: B15 checks `updatedAt` against `startedAt`, not against the sweep's own stamp; a missing `node` is worded as "the helper exited 127".
- **Step 7, measured** (a scratch fixture, deleted after; box load 58 to 68 on 16 cores). One full verification of a 1001 MiB `coord.db`, a 500 MiB journal and a 40 MiB checkpoint took 65, 111 and 79 s wall, at a steady 31 s of user CPU. Thinning past the count costs about 0.2 s a dir. At the default, the worst case is five full verifications: scaled by bytes to the server box's sizes, about 505 s at the mean, 659 s at the slowest, and 750 s weighted by the journal's record count, all against the 900 s deadline, which the re-stamp restarts before `_bak_gc`. In steady state a run verifies one set, because own and `--verified` are not read again.
- **`ccrc-update.test.ts` ran whole** at the gate: 564 passed, and 12 skipped by platform. **Run by describe only, not whole:** `ccrc-uninstall.test.ts` (`ccrc backup`), `delegation-wave3.integration.test.ts` (`no physical journal compaction`) and `session-hook.test.ts` (`CITATION DEBT`). What was measured for `ccd/ccrc`'s citation debt:
  - the three hunks above line 11635 are balanced (`-2498,6 +2498,6`, `-2584,6 +2584,6`, `-2593,2 +2593,2`);
  - `session-hook -t 'CITATION DEBT'` is green, and its `'ccd/ccrc': 5` map entry is unchanged.

  Separately, the brief's MAXREF read 19162 before and after. MAXREF is the highest `:N` anchor in the compaction-card corpus at or below `ccd/ccd`'s length, measured with the path-identity wave-3 plan's own pipeline. This range never touches `ccd/ccd`, so it could not move that figure. Measured against `origin/main`, `ccd/ccrc` grew by 31 net code lines at the first wave-done.
- **Fix round 1 (review 794), as built.**
  - **F1.** The `update` usage line says "the box's ccrc.env". `BOX_ENV_FILE` is again the only non-comment line that names `.ccrc/ccrc.env` (ccrc-install, D-88), and the paragraph keeps its six lines. Neither the plan's suite list nor the first gate ran `ccrc-install.test.ts`; this round's gate does.
  - **F2 (D-6364).** `inspectDb` gains a `quickCheck` option, so there is one spelling of the table check. `quickBody`'s legacy arm calls it without `quick_check`, and that replaces D-6361's separate read. W23-T22 pins a manifest-less `coord.db` that holds `delegation_sessions`: it is never thinned and stays `invalid`.
  - **F3 (D-6365).** `_bak_data_keep` refuses an unreadable `ccrc.env` (a dangling link or a directory there included). It also refuses one that names the knob in an `export` line, before a spaced `=`, or after any character other than a space, tab or CR. W23-B17 and B18 pin it, and each guard, deleted, turns its row red. A line that names a longer key, such as `CCRC_BACKUP_DATA_KEEP_OLD`, does not refuse.
  - **F4.** W23-H8 builds its duplicate key without `.replace`.
  - **F6 (D-6350, amended).** W23-T23 pins that with `keep` at or above the countable dirs, no member is opened and nothing is thinned.
  - **F7.** `isDroppedLeftover` is the one test of a leftover, used by both `finishOne` and `classify`. A leftover that does not match its entry gets a reason that promises nothing (W23-H2b). Classifying an interrupted dir now hashes its leftovers.
  - **F8.** A dir is counted after `noteCounted` (W23-T24).
  - **F9.** "A rollback by flip never thins", in the plan, README and `_bak_gc`'s header. D-6355 says that a rollback by re-install thins as an update.
  - **F11.** The lock got its own pin (B19, through the node shim's `flock -n`).
  - **F12, F13, F14.** Text only: the two mutation rows above, the B9 note below, and the citation-debt bullet above.
  - **F5, not fixed.** The Step 7 worst case leaves out `_bak_keepset`. After the re-stamp, under the same lock, it verifies each earlier dir in full, newest first, until it finds a valid data set. That costs at least one verification, the one `thin` then takes as `--verified`, plus one per `invalid` dir newer than it. `thin` verifies each such `invalid` dir again, within its own budget. Removing the duplicate is not cheap: it needs a list in `_bak_keepset`, a new `thin` flag and pins for both, past the growth cap's margin (`ccd/ccrc` is at +37). So the worst case at the default is one keep-set verification per `invalid` dir, plus one, plus D-6350's `keep + 2`. When nothing can be thinned, D-6350's amendment removes the second half.
  - **F13.** W23-B9's missing-helper half sources `_bak_gc update` and asserts its rc and its WARN. "The update exits 0" is measured for the shim half only.
  - **Growth.** Measured against `origin/main`, `ccd/ccrc` grew by 37 net code lines after this round (38 with run 722's line), against the stop line of 39.
  - **This round's review** (Opus, on the four fix commits) found no blocker or major. Its minors:
    - sparse mode could thin a dir the quick pass had missed, now guarded (T26);
    - the `stale` clause was unpinned (T25);
    - a key led by a vertical tab neither refused nor was read (B17);
    - the S1 title had lost a space;
    - the mutation table below was missing.
  - **Mutation rows of fix round 1**, each measured red and then restored:

    | Guard | Mutation | Red |
    |---|---|---|
    | D-6364: the legacy arm's table list | the `delegation_` check removed | T22 |
    | D-6350's amendment: nothing is verified when nothing can be thinned | `sparse` forced false | T23 |
    | Sparse mode never thins | the guard after the count removed | T26 |
    | A stale record is a dir that can be counted | `stale` dropped from the quick pass's count | T25 |
    | D-6363: counted after `noteCounted` | `counted++` moved first | T24 |
    | F7: `classify` promises only what `finishOne` does | the old reason always | H2b |
    | D-6365: an unreadable file refuses | its arm made a pass | B18 |
    | D-6365: a line the reader does not take refuses | the shape scan removed | B17 |
    | D-6365: any leading character but space, tab or CR | the scan back to `export` and a spaced `=` only | B17 (the vertical-tab case) |
    | F11: an update thins under the lock | `_upd_unlock` moved before `_bak_thin` in `_bak_gc` | B19 |
    | F11: `ccrc backup` thins under the lock | `_upd_unlock` moved before `_bak_thin` in `_bak_prune` | B19 |

    F1 has no guard of its own. Its pin is ccrc-install's existing D-88 row, which the review measured red at bedc992c3; it is green now.

## Coordinator rulings on review 794 (2026-10-22)

Recorded verbatim from the coordinator's fix-round mail, with one substitution: the review report's absolute path is written as "the review's report", because this repository is public.

> Wave 23, fix round 1 (run 775 is back at working). Review 794 (the review's report, at bedc992c3) found 14 findings. My rulings are below. Record them verbatim in the plan as a new closing subsection, "Coordinator rulings on review 794 (2026-10-22)", in your first fix commit.
> Routing: your effort is raised to xhigh (shallow: the gate's suite list missed ccrc-install.test.ts). Class unchanged.
>
> FIX (each with its row, and its mutation row where it is a guard):
> - F1 (blocks landing): reword the `update` usage line so no non-comment line but BOX_ENV_FILE names `.ccrc/ccrc.env` (ccrc-install.test.ts, D-88). For example: "environment, else the box's ccrc.env". Keep the paragraph's six lines and the wrap (D-6352). Re-run ccrc-install, session-hook -t 'CITATION DEBT' and collect-lane-restore-wording.
> - F2 (ruled: a damaged dir is never recorded as thinned by design): the legacy arm reads the table list (inspectDb, or the same check classify uses). A manifest-less dir whose coord.db holds delegation_ tables is damaged and is kept, never thinned as legacy. Add a T-row for that shape. Define this as D-6364.
> - F3 (ruled: unmeasured is not unset): when ~/.ccrc/ccrc.env exists but cannot be read, or names CCRC_BACKUP_DATA_KEEP on a non-comment line `_box_env_value` cannot match (the `export` form, a spaced `=`), the knob refuses exactly as an invalid value does: nothing pruned or thinned, and the refusal names the knob and the file (never its bytes). Add rows for all three shapes. Define this as D-6365.
> - F4: spell W23-H8's planted duplicate key without `.replace` (for example `'{"by":"update",' + text.slice(1)`), so CodeQL's alert clears. Never dismiss an alert by hand.
> - F6: the helper skips every verification when the count of full dirs (own included) is at most keep, since nothing can be thinned then. Add a row with keep at least the count, asserting no classify runs. Record it as an amendment paragraph of D-6350 (no new number).
> - F8: count after noteCounted, so one dir is never both counted and left (D-6363).
> TEXT and LEDGER ONLY:
> - F5: the as-built worst case adds `_bak_keepset`'s verification after the re-stamp, and notes a keepset-invalid dir that thin verifies again. Fix the duplicate only if it is cheap; otherwise say so.
> - F7: classify's reason for a dir refused thin-foreign must not promise that the next run finishes it.
> - F9: "a rollback by flip never thins", everywhere (plan, README, the `_bak_gc` header). Say in D-6355's text that a rollback by re-install runs `cmd_update` and thins there, recorded as `by: update`.
> - F11: the "moved before _ver_lock_try" mutation row names B2, not B4. Add a direct under-lock pin only if it is cheap.
> - F12: the `err.exit` mutation row names T8 and T17, not T9.
> - F13: As built records that B9's missing-helper half measures `_bak_gc`'s rc only.
> - F14: state exactly what was measured: the three usage hunks above 11635 balanced, CITATION DEBT green, and the session-hook 'ccd/ccrc': 5 entry held. Drop the unqualified "MAXREF 19162" sentence unless you measured that census.
> - F10: your D-6361 to D-6363 stand. My conflicting commit 7cc778a68 is reverted on my branch (40697111b), and the CCRC_BACKUP_KEEP ruling is wave 24's. Nothing renumbers.
> Your reserve after F2 and F3 is spent. If a further deviation is needed, ask me for numbers.
>
> Gate: everything this round touches, plus ccrc-install.test.ts and the suites of your first gate. Run ccrc-update.test.ts's touched describes locally; PR #1137's `test (server)` is the arbiter for the whole file. Name in the wave-done what ran where.
> Landing unchanged: first-ready against runs 722 and 774, with merge-tree measured before any absorb. Push, then send wave-done in the same turn.
