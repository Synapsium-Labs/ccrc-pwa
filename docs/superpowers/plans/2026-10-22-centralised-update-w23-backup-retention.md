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
- **`CCRC_BACKUP_DATA_KEEP` is read from the process environment, else from `~/.ccrc/ccrc.env` alone** (D-6360), in the order `_upd_deadline_ms` reads its knob (ccd/ccrc:19280-19290). Since review 817 its value is read through `_box_unit_env`, the box's byte-wise model of systemd (D-6365), not through `_box_env_value` (:3161) as `_upd_deadline_ms` still reads its own. Since review 839 the model reads `ccrc.env` with the exposure file left out, and is asked only when `ccrc.env`'s bytes name the knob as a whole token; on Linux a file that never names it, and holds no NUL byte, reads 3 (D-6347, D-6365), while on macOS the model is asked whatever the scan says. So a console-driven move and the watchdog's unattended run honour an operator's setting in `ccrc.env`. An invalid value there is refused like an invalid value in the environment: nothing is pruned or thinned. `CCRC_BACKUP_KEEP` stays environment-only, as documented.
- **The deadline has two parsers (review 817 F4, a residual carried to wave 24).** `_upd_deadline_ms` takes `CCRC_UPDATE_DEADLINE_MS` from the environment, else from `ccrc.env` through two-argument `_box_env_value`, which does not trim, and reads only `^[1-9][0-9]{0,14}$`; anything else is 900000. The server takes `Number(…)` with `isSafeInteger && > 0` (`server/src/config.ts`), after systemd's `EnvironmentFile=` has trimmed the value. They agree on canonical digits only. A non-canonical spelling in `ccrc.env` (`6e5`, `0600000`, `600000.0`, `+600000`, a space before or after it, `0x927C0`) reads 900000 in the bash and 600000 in the server. So does a user-manager value larger than the file's, because the detached update reads its environment first and the server unit's file overrides it. Since D-6464 the bash reading sets `thin`'s bound, so in either case the bound lands past the server's deadline (T + 665 s against T + 600 s at those figures), and a `thin` that runs to it releases the lease `failed` and halts the fleet until ack. It needs one of those two shapes. Wave 24 makes every operator tunable read `ccrc.env` through one reader, and the coordinator carries this design input there: the bound uses the smaller of the readings the bash can make, and a non-canonical or undecidable reading starts no verification that run. `_upd_deadline_ms` is unchanged in this wave.
- **On macOS a knob in the exposure file arrives as the environment (review 839, a residual).** The server's launchd job sources both files (`_inst_plist_server`'s `set -a; [ -f … ] && . …` command), and a console-driven update inherits the server's process environment (`boundedUpdateSpawn`'s `opts.env ?? process.env`, `server/src/update/spawn.ts`), detached under `nohup`. So a `CCRC_BACKUP_DATA_KEEP` line in `~/.ccrc/exposure.env` reaches that update as its environment, which wins before `ccrc.env` is read, with no refusal. `ccrc expose` never writes that key, so it takes a hand edit. On Linux the exposure file reaches only `ccrc.service`. On the same arm the launchd job's bash can build the knob's name without spelling it (a backslash-newline inside the name, a quoted `declare`), so there the model is asked whatever the scan says, and a file it cannot decide refuses even when no line names the knob (the review of fix round 4). The cost is that a `ccrc.env` that is not plain assignments on macOS (a non-ASCII value, CRLF) still stops the prune, as it did before review 839. Whether any reader reads the exposure file is wave 24's.
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

These twenty numbers, starting at D-6346, were issued to run 775. This plan defines all twenty, D-6346 to D-6365: the first fifteen at the draft, D-6361 to D-6363 from the worker's reserve, and D-6364 and D-6365 by the coordinator's rulings on review 794. The block is spent; a further number is asked of the coordinator. Fix round 2 was issued two more, and this plan defines one of them, D-6464, by the coordinator's ruling on mail 8134 (F6b); the other is unused.

- **D-6346.** Past the newest `CCRC_BACKUP_DATA_KEEP` update backups that carry a valid coordination data set, a backup is **thinned**, not pruned: its `coord.db`, `delegation-events.log`, `delegation-checkpoint.json` and `coordination-snapshot.json` are deleted, and every other entry stays (its code, `memory/`, the units). Why:
  - No automatic arm reads an older backup's data set (the map in the header). `_upd_report` reads this run's own only. The keep-set's data keep (`BAK_KEEP_DATA`, D-4641) is the newest earlier valid data set, and at the knob's lowest value, 2, `thin` keeps exactly own plus that one, so both base guarantees survive at every allowed value.
  - The operator asked to keep the code of every kept backup, for quick flips and by-hand recovery.
  - Whole-dir pruning stays the newest-`CCRC_BACKUP_KEEP` rule it is today.
- **D-6347.** The knob is `CCRC_BACKUP_DATA_KEEP`, default **3**, a whole number from **2** to 9999, validated by `_bak_data_keep` through `_keep_ok` plus a lower bound of 2. `0` and `1` are refused, never clamped. An invalid value stops the prune and the thinning alike: `_bak_gc` WARNs `… — nothing pruned or thinned` and returns 1; `_bak_prune` dies `… — nothing was pruned or thinned`, after the backup was taken, as an invalid `CCRC_BACKUP_KEEP` does. So does a `ccrc.env` refused as unmeasured (D-6365), but the unit model's undecidable answer (its rc 3) refuses only a `ccrc.env` whose bytes hold `CCRC_BACKUP_DATA_KEEP` as a whole token (no `[A-Za-z0-9_]` byte on either side), anywhere, a comment included. A file that never names the knob cannot set it, so its keep is 3 whatever systemd does with the file, but a NUL byte, which the scan refuses first (D-6365; amended on review 847), and the prune and the thinning run (amended on review 839: as first built in fix round 3, any file the model could not decide stopped the prune, where `main` pruned). That premise is systemd's. On macOS the model is asked whatever the scan says, because the launchd job sources `ccrc.env` with bash, which can build the name without spelling it (the review of fix round 4). `_keep_why` takes an optional third argument, the lowest allowed value (default 0), so the refusal says "from 2 to 9999". Why 2 is the floor:
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
- **D-6350.** The count and the thinning live in the helper's `thin` verb, not in bash, and verification is bounded: `thin` verifies a dir in full only when it is about to be counted, and only once per run. It is not the run's only verifier. Before it, under the same lock, `_bak_keepset` verifies each earlier dir newest first until one holds a valid data set; `thin` counts that one as `--verified` without a second read, but verifies again any `invalid` dir newer than it (review 794 F5, not fixed). So in steady state at the default a run makes two full verifications: `_bak_keepset`'s, and `thin`'s of the third set it counts (review 806 F6).
  - `_bak_thin` passes `--own <this run's backup>` (when there is one), `--verified <BAK_KEEP_DATA>` (when `_bak_keepset` chose one in this same run, under this same lock), and `--dir` for every listed dir that `_bak_ours` does not claim and that holds `coordination-snapshot.json`, `coord.db` or `coordination-thinned.json`, newest name first. A sidecar without a manifest is `invalid` and is never thinned, so the journal's name is never needed.
  - Own is counted first when `quickState` reads it `full`, and is never thinned or re-verified: `capture` measured every member as it wrote the manifest, seconds earlier.
  - Then the walk. For each dir: a record → the D-6348 three-way read first. Then `quickState` (presence and size). Not `full` → left as it is. `full` while the count is below N → counted, on `--verified`'s verdict for that dir, else on a full `classify` (v1 with data, or legacy; anything else is left as it is and not counted). `full` past the count → the pre-migration check (D-6358), else thinned on `quickState`'s reading, with the record's figures taken from the manifest.
  - A budget of `keep + 2` full verifications per run. When it is spent, the walk stops: nothing older is touched, one line says so, and the exit is 3. A stop can never leave fewer than N verified data sets, because nothing is thinned until N are counted.
  - Each dir is handled inside its own try: a `SnapError`, or an error carrying a string `code`, is one `WARN: could not thin …` line and a refusal, and the walk goes on (exit 3). Anything else is a helper failure (exit 70).

  Why the helper:
  - The one-classifier-call pin (`_bak_snap_class "$d"`, once) stays true, and the journal-name pin holds, because the bash never names the journal.
  - The crash order sits beside `writeAtomic` and the `fs` seam the helper's tests already inject faults through.

  Dirs that `_bak_ours` claims (this run's own, and every dir named at or after the floor, which belongs to a concurrent or later run) are never passed as `--dir`. Own is passed separately because a stepped-back clock can name it below an earlier dir.

  **Amended by the coordinator's ruling on review 794 (F6).** When the dirs that can be counted number at most `keep`, nothing can be thinned, so no dir is verified in full. Those dirs are the walked dirs that `quickState` reads `full` or `stale`, plus own when it reads `full`. In that case each is counted on its presence and size, no `user_version` is read, and the budget is not spent. A dir that still reaches past the count is left as it is, never thinned unverified. Such a dir is one the pass could not read, because its quick reading threw or its `lstat` did not show a directory: the walk reads again only those, and a stale dir once its record goes, which can only lower the count (review 806 F8). Outside sparse mode, a dir past the count is thinned on the reading the pass took, before the count's verifications ran (minutes, under the lock). That is harmless, because nothing else of ccrc's writes a backup dir while the lock is held. An interrupted thinning is still finished, and the summary's `kept` then counts sets that were not verified. Why: the budget is `keep + 2`, so it grows with the knob. An operator who sets the keep at or above the number of kept backups, to stop thinning, would otherwise pay for a full verification of every set on every completed update, past the deadline.
- **D-6351.** The operator-facing listing (a `list` verb, a `ccrc versions` listing and a doctor check) moves to a follow-up wave. This wave's visibility is what `thin` prints as it acts (one line per dir it thins, finishes, keeps from before a migration or refuses, and one summary line), `validate --from <dir>`, and `restore`'s `source-thinned`. Why: the cut that frees about 11G on a box under its line should not wait on a second classifier vocabulary, a doctor table entry and their pins, and the ruling asks for the cut.
- **D-6352.** The usage heredoc is edited in place: each paragraph keeps its line count, so the line count above base line 11635 is unchanged and the citation-debt ratchet (session-hook.test.ts:7682) stays put. The exact lines are given in this plan, measured. README is edited freely, because it carries no line citation of `ccd/ccrc`.
- **D-6353.** `install-census.test.ts`'s helper-caller census (`callers`, :1977) is widened: `_bak_thin` joins the callers that name the helper in a `helper=` variable and run `node --no-warnings "$helper"`. Why: a widening, not a softening. The new caller is pinned to the same installed-tree path, and the named-helper set stays exactly `['deploy/backup-coord.mjs','deploy/coordination-snapshot.mjs']`.
- **D-6354.** `deploy/deploy.sh` is untouched. Its server-lane dirs are full `v1` snapshots, which the next `ccrc` run counts and thins like any other. Its plain newest-N `prune_backups` keeps its own rule (D-5142, D-5144), as before.
- **D-6355.** Only an update and `ccrc backup` thin. `_bak_gc` calls `_bak_thin` only when its lead is `update`; `cmd_rollback`'s flip arm (`_bak_gc rollback`, ccd/ccrc:19170) prunes as before and thins nothing. Why: a flip takes no backup (`UPD_BACKUP_DIR` stays empty), so it adds no data set to thin; after the flip `$CCRC_HERE/../deploy/coordination-snapshot.mjs` is the older tree's helper, which has no `thin`, and a WARN there would tell an operator reading an incident's rollback output that the backup tooling failed. A rollback by re-install runs `cmd_update`, whether it comes from `ccrc rollback` or, unattended, from the watchdog. It thins there, and its records say `by: update`, so D-6359's "by which verb" names an update for a rollback's thinning. For the same mixed tree reached by `ccrc update --to <older>`, `_bak_thin` reads the helper for the text `thin --keep` before it calls it: absent, it prints `thinning skipped — this tree's coordination-snapshot helper predates it; nothing was thinned` and returns 0. A helper missing from the tree is a different condition and keeps its own WARN.
- **D-6356.** `cmd_update` re-stamps its report right before `_bak_gc update`: `_upd_phase restarting "pruning and thinning ~/ccrc-backups"`, only when `_upd_report_is_mine`. Why: `restarting` was stamped before the sweep (ccd/ccrc:18638) and nothing refreshes it, while `_bak_gc` holds the lock; the control plane's deadline (dispatch.ts:243-249) and the watchdog's wedged arm (ccd/ccrc:19542) both measure from `updatedAt`. `_bak_gc` itself still never writes `update.json` (its header's contract). The edit is in place on the one call line (:18653), so it costs no line. No key is added.
- **D-6357.** The own-dir and floor filter is spelled once, in `_bak_ours <dir>` (rc 0 when <dir> is this run's own or named at or after `UPD_BAK_FLOOR`; an unparsable floor makes every dir "ours", so every caller keeps it). `_bak_keepset`, `_bak_removable` and `_bak_thin` each call it. Why: R14(a) (D-5318) made the removal filter one spelling; `_bak_thin` would otherwise have been a third copy of the pair, and a later floor fix (the DST fall-back `_bak_list` names) could reach two copies and miss the third. `_bak_removable` keeps its own fail-closed floor line, which a pin reads.
- **D-6358.** The pre-migration keep. Past the count, `thin` keeps the newest data set whose `coord.db` `user_version` is lower than that of the newest counted set that has a `coord.db`. It is read from the database header (bytes 60 to 63, big-endian, after the SQLite magic), through the `fs` seam's `openRead`, with no open of the database; then the candidate is verified in full, within the budget, like a counted set. One such keep per run, never more; a candidate that does not verify is left as it is and the search goes on. Why: after a build that migrated `coord.db` fails its gate and arm 2 runs, the only snapshot an older build's by-hand restore can use is the one from before the migration, and every later attempt adds two post-migration data sets ahead of it. The base keeps it only by the accident of the count window; this keeps it by rule, at any `CCRC_BACKUP_DATA_KEEP`.
- **D-6359.** `_upd_report`'s downgrade branch tells a thinned own backup from one that never held a `coord.db`. When `$UPD_BACKUP_DIR/coord.db` is absent and `$UPD_BACKUP_DIR/coordination-thinned.json` is present, it prints `update: rollback:   (this run's backup no longer holds coord.db: a later ccrc run thinned it; 'ccrc coordination-snapshot validate --from <dir>' says when and by which verb — restore from a backup that still carries one)`, never "(no coord.db existed before this run …)". Why: no overloaded absence at a seam. The case is narrow (a keep of at least 2 and D-6358 both have to be beaten by concurrent backups inside one sweep window), but the old line would then be false.
- **D-6360.** `_bak_data_keep` reads `CCRC_BACKUP_DATA_KEEP` from the process environment, else from `~/.ccrc/ccrc.env` alone through `_box_unit_env`, else defaults to 3 (amended on review 839: the reader was `_box_env_value` until review 817, and the exposure file is never read for this knob). Why: thinning cannot be undone, and a console-driven move (`--detach --from pwa`) or the watchdog runs under the user manager's environment, so an operator's shell setting would not reach it; `ccrc.env` is where a box's own facts live, and `_upd_deadline_ms` already reads its knob this way.
- **D-6361.** `quickState`'s legacy arm (no manifest, a regular `coord.db`) reads the file's first 16 bytes through the `fs` seam's `openRead` and requires the SQLite magic. A `coord.db` shorter than that, or without the magic, is `damaged` and left as it is, never thinned and recorded as `source: 'legacy'`. Why: thinning cannot be undone and a damaged dir is never thinned (Risk notes); a record of `source: 'legacy'` over damage would relabel it as dropped by design. This errs toward keeping, at the cost of one 16-byte read of a legacy `coord.db`; a v1 dir's header read (D-6358) and T12's accounting of it are unchanged. D-6364 replaces this read: its `inspectDb` read decides the header and the table list together.
- **D-6362.** `thinBackups` never thins the `--verified` dir: wherever it falls in the walk it is counted while the count is below the keep, and otherwise left as it is, except that a verified dir past the count whose `coord.db` predates a schema migration may be the one pre-migration keep (D-6358), which is kept, not merely left. A verified dir that reads as anything but whole, stale or empty, an interrupted thinning above all, is refused with the walk's WARN (`thin-verified-not-whole`) and never finished: the only thing `thin` removes from it is a stale thinning record. It also refuses a `dirs` list whose basenames are not strictly descending (newest first), as `thin-usage` (exit 70 through `main`), since the count means "the newest N" only in that order. Why: D-6346's guarantee that the keep-set's data keep survives must not rest on the caller's ordering.
- **D-6363.** The `thin` summary's `left` counts only dirs that still hold a data set and were left as they are: a damaged or invalid dir, a dir refused with a WARN, and every dir untouched past a stop that still holds one. A dir already thinned and a dir with no data set (`none`, an empty v1) are not counted, nor is a path that is not a directory. A dir is counted only after everything its count reads has been read (its `user_version` included), so no dir is both counted and left (review 794, F8). Own counts the same way. A refused own (a WARN on its quick reading or on its `user_version` read) is left, never kept, and so is an own that reads as anything but `full` while it still holds a data set (review 806, F2). An own whose `lstat` fails ends the run before the walk; own (unless it is not a directory) and every walked dir that still holds a data set are then left, as past a stop (fix round 2's own review). So own is counted once, kept or left. Why: this line is the wave's only visibility (D-6351) and must not read as data sets still on disk.
- **D-6364.** `quickState`'s legacy arm reads `coord.db` the way `classify`'s legacy arm does, through `inspectDb`, with the header check and the table list but not `quick_check`. A manifest-less dir whose `coord.db` is not SQLite, cannot be opened read-only, or holds a `delegation_*` table is `damaged` and is kept, never thinned as `legacy`. This replaces D-6361's separate 16-byte read: one read now decides both questions. Why: by the coordinator's ruling on review 794 (F2), a damaged dir is never recorded as thinned by design. The commonest real `invalid` backup is a refused capture, which leaves `<ts>/coord.db` beside no manifest, and thinning it would drop the evidence and relabel the damage. `quick_check` stays out because it scans the whole database, and past the count presence and size decide (D-6350). The table list costs one read-only open of a rare legacy-shaped dir.
- **D-6365.** Unmeasured is not unset. The rule applies when `CCRC_BACKUP_DATA_KEEP` is not in the process environment and `~/.ccrc/ccrc.env` exists. If the file cannot be read, or names `CCRC_BACKUP_DATA_KEEP` on a line this reader does not take, `_bak_data_keep` refuses exactly as it does for an invalid value. A dangling link or a directory at that path counts as a file that cannot be read. The knob's value is read through `_box_unit_env CCRC_BACKUP_DATA_KEEP`, the tree's byte-wise model of systemd's `EnvironmentFile=` (D-3979, `local LC_ALL=C`), no longer through two-argument `_box_env_value`, whose `read` runs in the caller's locale (amended by the coordinator's ruling on review 817, F1, F2 and F8). Its answers map so: rc 0 with the knob named gives that value, trimmed as systemd trims it, to `_keep_ok`; rc 0 without it gives 3; rc 3, a shape the model does not decide (a value a quote or a backslash carries across lines, a CR inside a line, a CR lead included, a non-ASCII byte in an assignment), refuses as unmeasured with the model's own clause (`BUE_WHY`), which names the file and never its bytes, but only when `ccrc.env`'s bytes hold the knob as a whole token, a comment included; a file that never names it is not put to the model at all and reads 3 (D-6347; amended on review 839), on Linux; on macOS the model is asked whatever the scan says (D-6347). Precedence is literal (amended on review 839): the process environment, else `ccrc.env` alone, else 3. The model is called with `CCRC_EXPOSURE_FILE="$f/."` beside the call, a path that cannot exist, so nothing in the exposure file is read for the knob, whether it names it, names it empty, cannot be read or cannot be decided: on Linux no process that thins receives that file, whose one consumer is `ccrc.service`. Never the empty spelling `CCRC_EXPOSURE_FILE=`: the model's own refusal of an undecidable `ccrc.env` compares its source with that path, and with both empty it answers rc 0 with nothing named (the review's measurement: a quoted span reads 3 against the unit's 9). `_box_unit_env` itself is unchanged, since install's gate line and doctor's auth check read through it. A scan runs before the model and refuses what the model does not. Which lines it takes is one positive rule, amended by the coordinator's ruling on review 806 (F1, F4a), and it replaces the list of refused shapes this entry gave before. The scan reads bytes, under `LC_ALL=C` (D-3833), and so does the model, so the box's locale cannot change an answer. Each line is first trimmed of its leading spaces, tabs and CRs, the set `_box_env_value` trims. Then: (a) a line that begins with `#` or `;` is a comment and is skipped (the set `_box_env_unit_whole` skips); (b) a line that begins, optionally after `export` and spaces or tabs, with an identifier `[A-Za-z_][A-Za-z0-9_]*` followed at once by `=`, where the identifier is not the knob, is another key's line and is skipped (D-3823 reads `export OLD_KEY=…` and `export NOTE=KEY=…` the same way); a line that begins with exactly `CCRC_BACKUP_DATA_KEEP=` is the one the model reads; (c) any other line that names the knob as a whole token (no `[A-Za-z0-9_]` byte on either side) refuses, `export CCRC_BACKUP_DATA_KEEP=` included. The scan reads every line, so an odd line beside a plain one still refuses. A line that holds a CR past its lead is never skipped by (a) or (b): systemd ends a line at a bare CR and reads what follows as a line of its own, so such a line refuses when it names the knob. A file that holds a NUL byte, which bash's `read` drops and systemd cannot read at all (`_box_env_has_nul`, D-3832), could not be scanned, whether or not it names the knob, and neither could a scan that answers anything but 0, 1 or 4 (an awk that cannot run, or is killed); both refuse (fix round 2's own review). The scan's exit 4 says that no line holds the knob as a whole token (amended on review 839). Nothing is pruned or thinned, and the refusal names the knob and the file, never the file's bytes. Why: by the coordinator's ruling on review 794 (F3), thinning cannot be undone. An operator who set a high keep in `ccrc.env` to stop thinning would otherwise get the default of 3 silently, and every data set past the third would be deleted on the next completed update, `ccrc backup`, console move or watchdog run. The same fallback is harmless in `_upd_deadline_ms`, because there the default deletes nothing.
- **D-6464.** On the update path the thinning has a time budget, on the control plane's own clock (the coordinator's ruling F6b on mail 8134, recorded in the addendum to the rulings on review 806).
  - **The bound.** `_bak_gc update` passes `thin --until <unix seconds>`: the instant of D-6356's re-stamp, plus `_upd_deadline_ms`, less a margin of 235 s. The control plane's deadline runs from the last `updatedAt` it read, and the re-stamp is the last one this run writes before `_bak_gc`. `cmd_update` reads that `updatedAt` back from the report it wrote. When the read fails or is not whole seconds, it falls back to the second it read just before the write, which is never later. Seconds throughout; no `date +%N`.
  - **The margin, 235 s**, derived:
    - 150 s for one full verification that `thin` starts just before the bound: Step 7's largest per-set figure, the same estimate `thin` uses until it has timed one;
    - 75 s for the control plane to read the final report. Its deadline runs on what its inventory last read. The inventory runs once a minute (`UPDATE_INVENTORY_MS`), gated on a 2 s tick and stamped as it starts, and a read can take its 10 s budget (`INVENTORY_BUDGET_MS`): 72 s, rounded up;
    - 10 s for what follows `thin`: the unlock, and `cmd_update`'s final report.

    The count prune runs before `thin`, inside the window, so the absolute bound already accounts for it. Two boxes' clocks never meet here: the box that thins is the server box (a fleet box's backups hold no `coord.db`), whose `_upd_deadline_ms` reads the same `ccrc.env` as the server's own deadline, though by its own parse: the two agree on canonical digits only (Risk notes, review 817 F4).
  - **`thin` never starts a full verification it cannot expect to finish by the bound.** Before each one, at the count and at the pre-migration keep, it compares now plus V with the bound. V is the longest verification this run has timed, or 150 s until one has run.
    - When the check fails, the walk ends there. Every dir it did not reach that still holds a data set is left (D-6363).
    - One line says so: `thinning stopped at its time budget; N left as they are; the next update continues`. The summary line follows.
    - The exit is 0. This is not a refusal and not the verification budget's exit 3, so neither the update's exit nor `ccrc backup`'s changes. A refusal still exits 3, one behind the stop included (review 817 F7).
    - A dir behind the stop is read as the walk reads it, through the walk's own first step (review 817 F6). What the walk refuses there is refused there too, with its WARN, counted in `refused` and, unless it is no directory, as left: a `--verified` dir that is not whole (an interrupted one included, which is never finished, D-6362), a quick reading that carries an error, and a path that is no directory.
  - **What the budget never gates.** An interrupted thinning is finished whatever the budget, because finishing it verifies nothing. That includes one past a time stop, which the stop's own pass finishes (the second review of fix round 2). The record-first order is unchanged, and the walk never stops between a record and its deletes.
  - **Who passes a bound.** `ccrc backup` passes none: it holds no lease, and the operator is waiting on it. CLI and rollout updates take the same bound as a console update: one path, and harmless where there is no lease.
  - **An absent or bad bound.** No `--until` means no budget (an older caller, or a direct call). An `--until` that is not a whole number of seconds is a usage error (exit 70), as any bad argument is.
  - **Not covered.** D-3407's hard cap fails a busy lease once four deadlines have passed since its start (`updateStartedAt`, the server's clock at dispatch), and the re-stamp does not move that. Reaching it needs the update before the re-stamp to have taken three deadlines, 45 minutes at the default. The ruling's bound runs from the re-stamp alone.
  - **Why.** D-6350 and D-6356 already intend thinning to fit inside the control plane's deadline, and F6's reading showed the worst case does not. The budget restores that intent in the safe direction: a run that stops early thins less, and the next run continues.

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
| `_bak_gc`'s lead test deleted (a rollback by flip thins) | B13 |
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
  - After `git fetch origin main`, `deviation-refs`. Check directly that each of D-6346 to D-6365 is defined exactly once, in this plan (`grep -cE '^- \*\*D-(634[6-9]|635[0-9]|636[0-5]|6464)\.\*\*'` reads 21; the worker defined D-6361 to D-6363 from its reserve, D-6364 and D-6365 by the rulings on review 794, and D-6464 by the ruling on mail 8134), and nowhere on `origin/main`. Any reserve number the worker defines is added to that pattern and that count.
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
- **Step 7, measured** (a scratch fixture, deleted after; box load 58 to 68 on 16 cores). One full verification of a 1001 MiB `coord.db`, a 500 MiB journal and a 40 MiB checkpoint took 65, 111 and 79 s wall, at a steady 31 s of user CPU. Thinning past the count costs about 0.2 s a dir. At the default, `thin`'s own worst case is five full verifications: scaled by bytes to the server box's sizes, about 505 s at the mean, 659 s at the slowest, and 750 s weighted by the journal's record count, against the 900 s deadline, which the re-stamp restarts before `_bak_gc` (the rolling deadline; D-3407's hard cap, four deadlines from the lease's start, is not restarted). That leaves out `_bak_keepset`, whose verifications fall in the same window (review 806 F6). In steady state at the default a run makes two full verifications: `_bak_keepset`'s of the newest earlier data set, which `thin` then counts as `--verified` without a re-read, and `thin`'s of the third set it counts (own is never re-read). The worst case the ruling names, argued and not measured, is six full verifications. When `thin` spends its whole budget, at least three of its five fail, and each failing dir newer than the keep-set's data keep was verified by `_bak_keepset` first. At Step 7's per-set figures six cost about 606 s at the mean, 791 s at the slowest and 900 s weighted, so the weighted case reaches the 900 s deadline. Six is that case's floor, not a bound on a run: each further `invalid` dir among the newest sets adds one keep-set verification (F5). Since fix round 2, D-6464's budget ends `thin`'s walk before any verification that could pass its bound; `_bak_keepset`'s own verifications are not bounded by it (carried, below).
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
- **Fix round 2 (review 806), as built.**
  - **F1 and F4a (D-6365, amended in place).**
    - `_bak_data_keep`'s scan is now one `LC_ALL=C awk` program that states the positive rule. It replaces the `grep` of refused shapes and adds no code line, so `ccd/ccrc` stays at +37.
    - The comment set is `#` and `;`, the set `_box_env_unit_whole` skips.
    - A line that names another key (`OLD_CCRC_BACKUP_DATA_KEEP=9`, `NOTE=see CCRC_BACKUP_DATA_KEEP=4`) reads as before again; review 806 measured both refused at 28df42ded.
    - W23-B17 gains twelve refusal rows and eleven must-not-refuse rows, each run under `LC_ALL=C`. The ruling's lists account for twelve and nine of them. The other two are a `;` comment and a CR lead, so the comment set and the trimmed CR are pinned as well.
    - One more row runs every shape again under a UTF-8 locale. It uses C.UTF-8 or en_US.UTF-8, the first of the two that `locale -a` lists. It first checks that `locale charmap` says UTF-8 there, and it is skipped by name when neither locale is listed. The end-to-end B17 row stays.
    - `LC_ALL=C` matters on gawk, this box's awk. Under a UTF-8 locale, gawk's bracket expression matches no byte that is not valid UTF-8, so the Latin-1 0xA0 and 0xFF leads would read as before. mawk reads bytes in every locale, so there the prefix changes nothing and the UTF-8 row passes either way.
  - **F2 (D-6363, amended in place).** Both of own's catches now add `left++`.
    - I extended this to the same measured shape: an own that reads as anything but `full` and still holds a data set (one that reads `damaged`, say) also counts as left. Without that, the summary undercounts the same way. The row's third case measured red when the arm was deleted.
    - W23-T24-own pins all three cases: the quick reading throws, the `user_version` read fails, and own reads damaged. Each is at keep 2 with three more legacy dirs, and the summary adds up to the four dirs on disk.
  - **F3.** The README says "A data set that reads as damaged is never thinned", with the past-the-count clause (D-6350, D-6364), inside the consented paragraph.
  - **F5.** Two W23-B18 rows plant a dangling link and a directory at `ccrc.env`. Each reds under a single mutation of its arm (the table below), so no "cannot red" note is owed. Round 1's F3 note said "each guard, deleted, turns its row red"; for the dangling-link clause that holds only from this round.
  - **F6.** D-6350's opening and the Step 7 bullet now name `_bak_keepset`'s verification beside `thin`'s.
    - In steady state at the default a run makes two full verifications.
    - The worst case the ruling names, six, is stated as ruled. It is also qualified as that case's floor, not a bound on a run.
  - **The deadline, read in the code (F6).** All citations are a snapshot at 28df42ded. F6b's three comment lines above `cmd_update`'s `_bak_gc` line later move each `ccd/ccrc` citation below it down by three (18657 to 18660, 19284 to 19287):
    - Nothing is reverted when `_bak_gc` after D-6356's re-stamp (`ccd/ccrc:18657`) runs past the deadline (`_upd_deadline_ms`, `ccd/ccrc:19284`, 900 s by default). While the updater holds `update.lock`, the watchdog stands down. Only past twice the deadline does it record `failed` "wedged", and it records that with the updater's pid, which the updater's own `done` then overwrites (`ccd/ccrc:19543-19550`).
    - On a console-driven update of a box whose role is `server` or `both`, though, the control plane releases the lease `failed`, detail `deadline` (`deadlineExpired`, `server/src/update/dispatch.ts:243`; `runDispatch`, `server/src/update/converge.ts:292`). The same function also fails a busy lease once four deadlines have passed since its start (D-3407's hard cap, `server/src/update/dispatch.ts:245`), which the re-stamp does not move.
    - The box's later `done` cannot settle that release (`not-busy`, `server/src/update/inventory.ts:388`), and the release halts every further move until the operator acks (`isHalting`, `server/src/update/dispatch.ts:99`).

    So the ruling's stop condition held: reaching the deadline can fail a healthy box, though it cannot revert one. The worker reported it (mail 8134) without fixing it. The coordinator's ruling on that mail (F6b, the addendum below) made it a fix in this round: D-6464.
  - **F7.** W23-H2b cites D-6349.
  - **F8.** The three slips are fixed:
    - Task 3's mutation row now says "a rollback by flip thins".
    - The README's D-6365 sentence is rewritten under F1, and the trimmed CR is in it.
    - D-6350's amendment and the helper's comment say which dir the walk reads again, and they name the side effect outside sparse mode.
  - **The recorded rulings.** They carry two substitutions: the report's path, and the round's two reserve numbers. A tracked file may not name an issued number before a plan defines it, and deviation-refs measured red with them spelled. D-6363 and D-6365 are amended in place. D-6464 is defined by the addendum's ruling, and the other number is unused.
  - **F6b (D-6464), as built.**
    - **Bash: one code line**, the bound in `_bak_gc`. `cmd_update`'s one `_bak_gc update` line takes the instant and checks that the read-back is whole seconds, and `_bak_thin` passes `--until` when it is given one. `_upd_phase` is outside this wave's consent, which is why the instant is read back from the report rather than handed out by the writer.
    - **The helper.** It gains `--until` and a check before each of the two verification sites. `stop` and the new time stop share one count of the dirs left behind (`leaveRest`).
    - **Rows.**
      - W23-T27: a bound already past starts no verification, leaves every candidate, prints the line, and exits 0.
      - W23-T28: a bound that admits exactly one verification starts one, on a clock each verification moves by 100 s. One second less starts none, which pins the 150 s estimate. With 10 s verifications at keep 4, all three the count needs fit, which pins V as the longest measured.
      - W23-T29: an interrupted thinning is finished with a past bound, both ahead of the first verification and behind the time stop.
      - W23-T31: the pre-migration keep's verification waits on the budget too.
      - W23-T30: a bad `--until` is exit 70 and touches nothing.
      - W23-B20: through the node shim, an update passes exactly the re-stamp's `updatedAt` plus 900, less 235. A jq shim that answers the read-back with another second shows the bound follows the read-back. One that answers a fraction shows the fall-back to the second before the re-stamp. `ccrc backup` passes no bound.
    - **`_bak_keepset` alone (carried to wave 24, as the ruling says).** Argued from Step 7's figures, not measured.
      - It classifies each earlier dir that `_bak_ours` does not claim, newest first, until one holds a valid data set. A thinned dir, or one with no data set, costs no node at all.
      - After earlier runs' prunes it can list up to `CCRC_BACKUP_KEEP` earlier dirs (ten at the default) before this run's count prune, and more when those prunes did not run. Full-size `invalid` sets whose defect shows only at the end of a full read then cost one verification each: up to ten, about 1010 s at the mean, 1320 s at the slowest and 1500 s weighted.
      - Six reach 900 s at the weighted figure (seven at the slowest, nine at the mean). So `_bak_keepset` alone can pass the deadline.
      - That is a carried constraint for wave 24, not a fix here. D-6464's bound is absolute, so after a slow keep-set `thin` starts fewer verifications, never more.
  - **This round's own review** (Opus, on the four commits before F6b) found no blocker or major. Its five minors and the cheap nits are fixed:
    - a bare CR inside another key's line, or inside a comment, let the knob through, because systemd reads what follows the CR as a line of its own (D-6365 amended; two B17 rows);
    - the scan's status mapping was negative, so an awk that could not run, or was killed, read as clean; only 1 is clean now (one B17 row);
    - a NUL byte, which bash's `read` drops, made the two readers see different lines; such a file now could not be scanned (the same row);
    - D-6363's amendment overclaimed: an own whose `lstat` fails ended the run with nothing counted, and now own and the walk's data sets are left (a T24-own row);
    - the deadline sentence above lacked the hard cap and called `_bak_gc` a sweep;
    - the helper's comment now names a dir the pass saw as no directory;
    - README says "as a whole word" and that a manifest-less `coord.db` past the count is opened for its header and tables.

    Two nits are left as they are:
    - the `LC_ALL=C` row can red only where awk is gawk, as noted above;
    - an own whose thinning record cannot be read counts as left with no WARN, where the walk WARNs.
  - **The second review of fix round 2** (Opus, on the three F6b commits) found one major and four minors, all fixed:
    - the major: W23-T8 was red at 4f574e635, because it still expected the usage line without `[--until <unix seconds>]`. The filtered runs never reached it; the whole file now passes;
    - an interrupted dir behind a time stop was never finished. The stop's own pass now finishes it, in one `finish` shared with the walk (T29's second case);
    - B20 could not tell the read-back from the second before it. The jq shim now answers both ways;
    - nothing pinned V as the longest measured (T28's 10 s case);
    - a non-integer read-back dropped the bound. It now falls back to the second before the re-stamp.

    Its nits were fixed in text, except three:
    - the margin's inventory term is 75 s, not 70;
    - the citation note, the `_bak_thin` header ("unless something was refused"), `_bak_data_keep`'s empty-value fallback and the keep-set's "up to ten" are now stated exactly;
    - README says `thin` works to the budget; the keep-set's own verifications are carried.

    The three it left as they are:
    - an elapsed time from a wall clock stepped back counts as zero;
    - a `classify` that throws records no time;
    - `KEEP=4\r\r` refuses where systemd reads 4, the safe direction.
  - **Growth.** `ccd/ccrc` grew by 38 net code lines against `origin/main` (F6b's one line), against the stop line of 39.
  - **Mutation rows of fix round 2**, each measured red and then restored byte-identical:

    | Guard | Mutation | Red |
    |---|---|---|
    | D-6365: the scan reads bytes | `LC_ALL=C` dropped | B17 under C.UTF-8 (the 0xA0 and 0xFF leads) |
    | D-6365 (b): only another key's line is skipped | (b) takes the knob too | B17: an export of the knob, an odd line beside a plain one, the end-to-end row, the UTF-8 row |
    | D-6365 (c): the knob as a whole token anywhere | (c) narrowed to the start of the line | B17: the NBSP, 0xA0, 0xFF and vertical-tab leads, an export of the knob, an odd line, a bare CR inside another key's line and inside a comment, the end-to-end row, the UTF-8 row (ten rows; review 817 F9) |
    | D-6365 (a): a comment is skipped | (a) dropped | B17: the two comment rows, the UTF-8 row |
    | D-6365: a dangling link cannot be read | `\|\| [ -L "$f" ]` deleted | B18: a dangling link |
    | D-6365: a directory cannot be read | `[ -f "$f" ] &&` deleted | B18: a directory |
    | D-6365: what cannot be read refuses | `else g=3` made `g=1` | B18: all three rows |
    | D-6363: a refused own, at its quick reading | its `left++` deleted | T24-own: the quick reading throws |
    | D-6363: a refused own, at its `user_version` | its `left++` deleted | T24-own: the `user_version` read fails |
    | D-6363: an own that holds a data set but is not `full` | the arm deleted | T24-own: own reads damaged |
    | D-6365: a CR past the lead is never skipped | the inner-CR test dropped | B17: a bare CR inside another key's line, and inside a comment; the UTF-8 row |
    | D-6365: a file holding a NUL could not be scanned | the NUL check made false | B17: the NUL and scan-status row |
    | D-6365: only 1 is a clean scan | the old mapping (2 alone could not be scanned) | B17: the NUL and scan-status row (the killed awk) |
    | D-6363: own's `lstat` refusal leaves the walk | its `leaveRest(walk)` deleted | T24-own: own's `lstat` fails |
    | D-6363: own's `lstat` refusal leaves own | its `left++` deleted | T24-own: own's `lstat` fails |
    | D-6464: no verification past the bound, at the count | the check deleted | T27, T28, T29 |
    | D-6464: the estimate V is in the check | the bound compared with now alone | T28, T31 |
    | D-6464: the finish arm waits on nothing | the budget applied to both of its spellings (the walk's, and the time stop's pass) | T29 |
    | D-6464: past a time stop an interrupted dir is still finished | the stop's pass only leaves it | T29 (its second case) |
    | D-6464: V is the longest measured | `longest` never set | T28 (its 10 s case) |
    | D-6464: the instant is read back from the report | the read-back deleted | B20 |
    | D-6464: a read-back that is not whole seconds falls back | taken unvalidated | B20 |
    | D-6464: no verification past the bound, at the pre-migration keep | the check deleted | T31 |
    | D-6464: a bad `--until` is a usage error | its parse check deleted | T30 |
    | D-6464: an update passes the bound | `_bak_gc` drops the argument | B20 |

    The B17 and B18 rows above were measured again at the final tree, all of them red as listed, and so were the D-6464 rows after the second review. The budget applied to the walk's finish arm alone no longer reds anything: the time stop's pass finishes the same dir. So the ruled mutation is measured on both spellings together.
- **Fix round 3 (review 817), as built.** The coordinator's rulings are recorded verbatim at the end of this plan.
  - **F1, F2 and F8 (D-6365 amended): the value is read through the unit model.** `_bak_data_keep` calls `_box_unit_env CCRC_BACKUP_DATA_KEEP` where it called two-argument `_box_env_value`.
    - rc 0 with the knob named takes `BUE_VAL`, and rc 0 without it falls to 3.
    - rc 2, an exposure file that is there but cannot be read, refuses and names that file.
    - Any other answer refuses with `BUE_WHY`, or with "could not be scanned" if that is empty.
    - The scan still runs first, so each refusal it makes keeps its wording. `why` now carries the file's path, because the model's clause names its own file.
    - One code line is replaced by one, so the count is unchanged.
  - **Two rows the ruling lists answer otherwise under the ruled reader.** The ruling's mechanism was obeyed over these two row expectations. Both err toward refusing, and the coordinator may rule otherwise.
    - `FOO=\xc3` above `CCRC_BACKUP_DATA_KEEP=9` refuses, under C and under C.UTF-8, where the mail lists it to read 9. The model calls any byte of 0x80 or more in an assignment undecidable (`_box_env_unit_whole`'s `utf8`), because it does not check UTF-8 validity. systemd itself rejects a file whose values are not valid UTF-8, and a lone 0xC3 is not valid, so the unit would receive neither 9 nor anything else from that file. The Latin-1 é in a comment reads 9 in both locales, as ruled.
    - Fix round 2's READ row "a CR lead" (`\rCCRC_BACKUP_DATA_KEEP=4`) now refuses, because the model calls a CR inside a line undecidable (`cr`), though systemd would read 4. The row moved to B17's undecided table. Every other B17 row reads or refuses as before, and the scan keeps CR in its trim set.
  - **What else the model refuses**, the same shape, measured in the prototype: a bare CR inside any line, and a byte of 0x80 or more in any assignment line, now refuse the knob even when that line never names it (`FOO=a\rb` above a plain knob line refuses). A non-ASCII comment still reads, unless any value in the file spans lines.
  - **The rows.**
    - B17 gains four READ rows: the é comment (9), and a trailing space, a trailing tab and a space before CRLF (4 each).
    - It gains an undecided table of seven: the five F2 files and the two above. Each row checks the opening of the model's clause, and that no digit follows an `=` in the refusal.
    - It gains four exposure-file rows: one that cannot be read, one that names the knob, one that names it with an empty value, and one with a non-ASCII byte in an assignment.
    - Each row runs under LC_ALL=C. The READ, refused and undecided rows run again in the UTF-8 row, which is skipped by name where `locale -a` lists neither UTF-8 locale; the four exposure rows ran under C only, until fix round 4 (review 839 F4).
    - `dataKeep` sets `CCD_OS=linux`. A macOS box models its launchd job's bash instead (`_box_unit_env_shell`), which refuses a CR anywhere, so B17 pins the Linux arm on every runner.
  - **The exposure file never carries this knob.** `ccrc expose` writes only its own keys (`_exp_env_write`: the sign-in keys, the DuckDNS ones, `CCRC_EXPOSE_MODE`, `CCRC_EXPOSE_ADDR` and `CCRC_CADDY_BIND`).
    - The model reads it after `ccrc.env`, and a line there wins by presence, as the unit's second `EnvironmentFile=` does. So as first built, an exposure line `CCRC_BACKUP_DATA_KEEP=2` beside `ccrc.env`'s 9 read 2, and an empty one read 3, with no refusal. The round's own review found it (major).
    - The ruled precedence (the environment, else `ccrc.env`, else 3) and the ruled mapping (a named value goes to `_keep_ok`) cannot both hold there. The precedence was obeyed, because the other way can delete data sets: a value the model takes from the exposure file refuses, naming that file. B17 has a row for each, and the same code line holds the check, so the count is unchanged.
    - An exposure file the model cannot decide refuses too, by the ruled rc 3 mapping: a CR or a NUL in it, or a non-ASCII byte in an assignment. `ccrc expose byo` writes an internationalised origin verbatim, so a box exposed that way stops pruning and thinning until the origin is written in its punycode `xn--` form, which the model's own remedy clause names. That errs toward keeping, and it is a cost: the prune stops too. B17 has a row for it. For the coordinator: whether wave 24's one reader should read the exposure file at all.
  - **F4 is a residual (Risk notes), not a fix.** `_upd_deadline_ms` is unchanged.
    - The claim in `_bak_gc`'s header, and D-6464's sentence that the bash reads "the same `ccrc.env` as the server's own deadline", now say the two parses agree on canonical digits only.
    - The other site is outside this wave's consent. `_upd_deadline_ms`'s own header (ccd/ccrc:19284 at 65d5daa83) still says `updateDeadlineMs` "reads the same value from the same key", and it is left for wave 24.
  - **F3.** T28 has a fourth case: a 100 s verification, then a 10 s one, at keep 4 and a bound of T0 + 200. V stays 100 s, so the third verification is not started. The round's own review then measured V frozen at the first time it took, which that case cannot tell from the longest, so a fifth case runs 10 s and then 100 s: V rises to 100 s and the third is not started.
  - **F5.** T27 has a `--verified` case for each arm.
    - Under `--until 1`, the verified newest dir is counted without a verification, and the two dirs past the count thin.
    - In process, a verified pre-migration candidate is kept after the count's one verification has taken the clock past the bound.
  - **F6 (D-6464 amended).** The walk's first step is now one function, `enter`. A path that is not a directory, a quick reading that carries an error, and a verified dir that is not whole each refuse there.
    - The time stop reads every dir through `enter`. So an interrupted `--verified` dir behind the stop refuses `thin-verified-not-whole`, with a WARN and exit 3, and is never finished.
    - So does a dir whose thinning record cannot be read (the review's residual).
    - So does a path that is no directory, which the time stop used to skip with no WARN. That is the same shape, extended.
    - T29 has a case for the three.
    - The ruled mutation's text, `&& d !== verP` in `timeUp`, is gone with the fix. Three mutations were measured instead (below): its analogue (the time stop passing the verified dir around `enter`), the time stop's pre-fix reading, and `enter`'s verified clause deleted.
    - `stop`'s pass, the verification budget's (D-6350), still reads quietly: it skips a path that is no directory and leaves a failed reading with no WARN. It exits 3 anyway. That was not ruled, so it stays.
  - **F7.** T29's F7 case: an interrupted dir behind `--until 1`, whose leftover journal is byte-flipped at the same length, is refused with a WARN and left byte-identical, and the exit is 3.
  - **F9.** The (c) row above now lists the ten rows that red.
  - **This round's own review** (Opus, on the three commits before the fold) found one major, two minors and two nits:
    - the major: the exposure file decided the knob by presence (above), now refused;
    - an exposure file the model cannot decide stops the prune and the thinning, now documented, with a row;
    - T28 could not tell V frozen at its first time from the longest, now a fifth case;
    - the comment exemption's wording ("any value in the file") and the list of keys `ccrc expose` writes, both corrected.

    It reproduced the mutation table, found the `enter` refactor identical to the walk's old first step, and found both departures from the ruling's rows right on the code's own terms.
  - **Growth.** `ccd/ccrc` is still 38 net code lines over `origin/main`, 0 of them this round, against the stop line of 39.
  - **Mutation rows of fix round 3**, each measured red and then restored byte-identical. The bash rows ran `-t 'W23-B1[78]'` in `ccrc-update.test.ts`, and the helper rows `-t 'W23-'` in `coordination-snapshot.test.ts`. Each row lists every row in its filter that reds. The reader's four rows and T28's three were measured again after the review's fold.

    | Guard | Mutation | Red |
    |---|---|---|
    | D-6365: the value through the unit model | the two-argument reader swapped back | B17: the three trailing-blank READ rows, the seven undecided rows, the four exposure rows, the UTF-8 row (fifteen) |
    | D-6365: what the model does not decide refuses | rc 3's refusal dropped, so it falls to 3 | B17: the seven undecided rows, the exposure row with a non-ASCII byte, the UTF-8 row (nine) |
    | D-6365: an unreadable exposure file refuses | rc 2 takes `ccrc.env`'s value | B17: the unreadable exposure row |
    | D-6365: the exposure file never sets the knob | the model's value taken from whichever file named it | B17: the exposure rows that name the knob, with a value and empty |
    | D-6464: V is the longest measured | V is the latest time measured | T28 |
    | D-6464: V is the longest measured | V is the shortest time measured | T28 |
    | D-6464: V is the longest measured | V frozen at the first time measured (the round's own review) | T28 |
    | D-6464: the verified dir costs no verification, at the count | `dir !== verP &&` deleted from the count's budget check | T27 (its F5 case) |
    | D-6464: the verified dir costs no verification, at the pre-migration keep | `dir !== verP &&` deleted from the pre-migration keep's budget check | T27 (its F5 case) |
    | D-6464: behind a time stop the verified dir is read as the walk reads it | the time stop passes the verified dir around `enter` (the ruled mutation's analogue) | T29 (its F6 case) |
    | D-6464: behind a time stop every dir is read as the walk reads it | the time stop's reading before the fix | T29 (its F6 case) |
    | D-6362: a verified dir that is not whole refuses | `enter`'s verified clause deleted | T21, T29 (its F6 case) |
    | D-6464: a failed quick reading refuses | `enter`'s error check deleted | T9 (malformed, version 2), T29 (its F6 case) |
    | D-6363: a path that is no directory refuses | `enter` lets it through | T20, T29 (its F6 case) |
    | D-6464: a refusal behind a time stop is a WARN | `timeUp`'s `warn` made `void 0` | T29 (its F6 and F7 cases) |
    | D-6464: a refusal behind a time stop exits 3 | `refused = 0` in `timeUp` | T29 (its F6 and F7 cases) |
    | D-6464: past a time stop an interrupted dir is still finished | the stop's pass only leaves it | T29, and its F7 case |
    | D-6464: the finish arm waits on nothing | the shared `finish` waits on the budget (review 817's single spelling) | T29, and its F7 case |

    Fix round 2's ten B17 and B18 rows were measured again at this tree, and each reds as its row lists.
- **Fix round 4 (review 839), as built.** The coordinator's rulings are recorded verbatim at the end of this plan. The review found no defect in what was ruled; its four findings and the ruled text fixes are below.
  - **Ruling 1 (ratified).** `FOO=\xc3` above the knob and the CR lead still refuse, as fix round 3 built them. The rows are amended to the measured answers: both stay in B17's undecided table, and the departure note above stands as the record.
  - **Ruling 2 (D-6360 and D-6365 amended): `ccrc.env` alone.** `_bak_data_keep` calls `CCRC_EXPOSURE_FILE="$f/." _box_unit_env CCRC_BACKUP_DATA_KEEP`, with a comment saying why and why never the empty spelling. `$f` is `ccrc.env`, which the gate before the call has found to be a regular file, so `$f/.` cannot exist and both arms of the model (`_box_unit_env` and `_box_unit_env_shell`) skip the exposure file. `_box_unit_env` itself is unchanged.
    - The exposure-source check, the `2)` arm and `BUE_SRC`'s use are gone. rc 0 takes `BUE_VAL` (empty falls to 3); anything else refuses with `BUE_WHY`, or "could not be scanned" if that is empty.
    - Fix round 3's departures 2 and 3 are superseded: an exposure file no longer refuses anything here, so a box with an internationalised origin prunes again.
  - **Ruling 3 (D-6347 amended): the model's refusal needs the knob.** The awk scan now also counts the lines that hold the knob as a whole token, before its skip rules, so a comment counts, and exits 4 when none does. On 4 the model is not asked and the keep is 3, on Linux. On 1 (named, no line the scan refuses) the model is asked as before.
    - **On macOS the model is asked whatever the scan says** (this round's own review, minor 1, folded). The ruling's premise, "a file that never names the knob cannot set it, whatever systemd does with the file", is systemd's. The launchd job sources `ccrc.env` with bash, which can build the name without spelling it as one token: `CCRC_BACKUP_DATA_KEE\` then `P=50` on the next line, or `declare CCRC_BACKUP_DATA_"KEEP"=50`, each set to 50. As first built this round they read 3 on `CCD_OS=darwin`, so an ssh update or a `ccrc backup` there would thin to 3, where d9dc8891d refused both. Thinning cannot be undone, so the narrowing is scoped to Linux (`[ "$g" = 4 ] && [ "${CCD_OS:-linux}" = darwin ]` on the model's guard, the same code line), and the Darwin model's refusal of a file that is not plain assignments stands. The cost is that a macOS `ccrc.env` that is not plain (a non-ASCII value, CRLF) still stops the prune there, as before the ruling. Reported for the coordinator's ruling.
    - Unchanged: a NUL byte still refuses ("could not be scanned") whether or not the file names the knob. That is the scan's own refusal, not the model's rc 3, which is all the ruling narrows. A scan answering 4 for any other reason would read 3; an awk that cannot run or is killed answers 126, 127 or 128 and more, which still refuse.
    - The token check reads no more of the file than the scan did, and the code is in the scan's line and the model's guard.
  - **Ruling 4.**
    - **F1.** B18's `it.each` gains a FIFO at `ccrc.env`. `sourced` takes an optional bound (ms), and B18's rows run under 60 s, so a hang fails the row instead of the run. `[ -f "$f" ]` mutated to `[ ! -d "$f" ]` reds it after about 61 s, with no process left behind. The bound kills bash, not a grandchild blocked opening the FIFO, so the row's `finally` opens the FIFO `O_RDWR | O_NONBLOCK` and closes it, which gives such a reader a writer and then EOF (this round's own review, a nit).
    - **F2.** An `it.each` over the eight undecided files, each with `CCRC_BACKUP_DATA_KEEP=5` in the environment, reads rc 0 keep 5.
    - **F3.** README's sentence is "exits 0 unless a dir was refused (D-6464)".
    - **F4.** Every exposure row runs in the UTF-8 row too. The locales, row by row: under `LC_ALL=C`, B17's refused, READ and undecided tables, the four exposure rows, the no-`ccrc.env` row, the pinned undecided row, the eight environment rows and the NUL and scan rows; under the UTF-8 locale (C.UTF-8, else en_US.UTF-8, skipped by name when `locale -a` lists neither), the refused, READ and undecided tables, the eight environment rows, the four exposure rows and the no-`ccrc.env` row, in one `it`. The macOS row runs its three files under C and again under the UTF-8 locale, in its own `it`. The end-to-end prune row and B18 run in the runner's own locale. Fix round 3's sentence that said otherwise is corrected in place.
    - **The two refuted texts.** D-6360 says `_box_unit_env`. README says the scan reads a line "after its leading spaces and tabs", and that a CR leading a line refuses.
    - **The thin spot.** T29 gains a case: a dir whose thinning record cannot be read, refused by the walk, then a time stop at the next full dir. The exit is 3. `refused = 0` placed first in `timeUp` reds it, and only it. Tests only.
  - **The rows.**
    - B17's READ table gains the six knob-less files, each reading 3: `NOTE=café`, `FOO=\xc3`, `# a\rb`, `# note\r\r\n`, `FOO=a\rb`, and a quoted value spanning lines over a UTF-8 comment.
    - The four exposure rows invert into READ rows: a knob line (`K=2`), an empty `K=`, mode 000, and an internationalised origin, each beside `ccrc.env`'s 9, read 9. Mode 000 needs no root skip now: nothing reads the file.
    - With no `ccrc.env`, an exposure file naming the knob reads 3.
    - The pinned undecided row: the first undecided file refuses with the model's clause, alone and beside an exposure file.
    - End to end: 12 code-only backups and a `ccrc.env` of `CCRC_ROLE=server` and `NOTE=café`; `_bak_gc update` at `CCRC_BACKUP_KEEP=10` prunes the two oldest, leaves the newest ten, and prints no WARN.
    - The token rules, beside a value the model refuses (this round's own review, minor 2): an `_OLD` suffix key and an `OLD_` prefix key each read 3 (READ), and a comment that names the knob refuses with the model's clause (undecided, so it also has an environment row).
    - macOS (`CCD_OS=darwin`): the name split by a backslash-newline and a quoted `declare` each refuse with the Darwin model's clause, and a plain file that never names the knob reads 3.
  - **This round's own review** (Opus, on the three commits before the fold, with 900 generated files fuzzed against the systemd 255 oracle under gawk, mawk and busybox) found no blocker or major on the Linux arm, and no rc 0 keep there that differs from the oracle. Its two minors and its nit are folded above: the macOS arm, the two token pins and the FIFO's blocked grandchild. It found no awk that exits 4 on a failure (out of memory, gawk and mawk exit 2 and busybox exits 1), the `$f/.` stand-in skipped by both arms, and `CCRC_EXPOSURE_FILE` restored after the call.
  - **Growth.** `ccd/ccrc` is still 38 net code lines over the merge base with `origin/main`, 0 of them this round: the changed code stays on its three lines, and the rest is comment.
  - **Mutation rows of fix round 4**, each measured red and then restored byte-identical (`cmp`), the bash rows again after the review's fold. The bash rows ran `-t 'W23-B1[278]'` in `ccrc-update.test.ts`, the helper row `-t 'W23-'` in `coordination-snapshot.test.ts`. Each row lists every row in its filter that reds.

    | Guard | Mutation | Red |
    |---|---|---|
    | D-6365: `ccrc.env` alone | the `CCRC_EXPOSURE_FILE="$f/."` prefix dropped, so the model reads the exposure file | B17: the four exposure rows, the UTF-8 row (five) |
    | D-6365: the stand-in is a path that cannot exist | the empty spelling, `CCRC_EXPOSURE_FILE=` | B17: the eight undecided rows, the pinned undecided row, the UTF-8 row (ten) |
    | D-6347: the model's refusal needs the knob | the scan's END back to `exit !f`, so no exit 4 | B17: the eight knob-less READ rows (the two token rows among them), the UTF-8 row, the end-to-end prune row (ten) |
    | D-6347: the model's refusal needs the knob | the model's guard back to `[ -z "$why" ]` | the same ten |
    | D-6347: only a whole token counts | the counter takes any substring, `n += (index($0, k) > 0)` (this round's own review) | B17: the `_OLD` and `OLD_` rows, the UTF-8 row (three) |
    | D-6347: a token in a comment counts | the counter takes only a line that begins `CCRC_BACKUP_DATA_KEEP=` (this round's own review) | B17: the comment-token undecided row, the UTF-8 row (two) |
    | D-6347: on macOS the model is asked whatever the scan says | the Darwin clause dropped from the model's guard | B17: the macOS row |
    | D-6360: the environment wins | the environment check dropped and `${CCRC_BACKUP_DATA_KEEP:-$BUE_VAL}` taken (the review's mutant) | B17: the eight environment rows, the UTF-8 row (nine) |
    | D-6365: a FIFO is not read | `[ -f "$f" ]` made `[ ! -d "$f" ]` | B18: the FIFO row, by its bound |
    | D-6464: a refusal before a time stop exits 3 | `refused = 0` placed first in `timeUp` | T29 (its review 839 case) |
- **Fix round 5 (review 847), as built.** The coordinator's rulings are recorded verbatim at the end of this plan. The review found nothing wrong in the reader, so this round is test rows and two text lines; no code line changes.
  - **F1: the end-to-end prune row pins its OS.** Its script ran `. ccd/ccrc` with no `CCD_OS`, so on a macOS runner the Darwin model would refuse `NOTE=café` and the row would red on test-macos, and with it the daily full suite and the stable gate. A shared `pruneTwelve(os)` now prefixes the script with `CCD_OS=<os>;`, as `dataKeep` does.
    - The Linux row is unchanged otherwise: 12 pruned to 10, rc 0, no WARN.
    - Its Darwin twin, beside the same `ccrc.env`, expects the WARN with the Darwin model's clause (`line 2 is not a plain NAME=value line`), rc 1, no prune line and all 12 left. That pins ratified departure 1 end to end.
  - **F2: a NUL refuses in a file that never names the knob.** B17's NUL row gains `NOTE=x\0y\n`, expecting "could not be scanned".
  - **R8: every position is tested.** B17's refused table gains `${K}_OLD=1\r${K}=9999`, expecting the untaken refusal. systemd ends a line at the bare CR and reads `${K}=9999` as a line of its own; a counter that tests only the first occurrence would read 3. It runs under C and in the UTF-8 row.
  - **F3: two text lines.** README's "whatever else it holds" is "whatever else it holds but a NUL byte", and the function header's "its keep is 3 whatever the model or systemd makes of the rest of it" gains "but a NUL byte, which the scan refuses first". D-6347's sentence had the same overstatement and gains the same exception (amended on review 847). D-6365 already said it, so it is unchanged.
  - **Not changed:** CI's red `server 4/11` row (the trickle row, F4/F4b of reviews 167 and 173), which this wave does not touch; the uninstall suite's process-leak exit; and the model's quadratic cost on a long knob-bearing comment line (R7). The coordinator carries the last two.
  - **Growth.** `ccd/ccrc` is still 38 net code lines over the merge base with `origin/main`, 0 this round: the one changed line is a comment.
  - **Mutation rows of fix round 5**, each measured red and then restored byte-identical (`cmp`), on `-t 'W23-B1[278]'` in `ccrc-update.test.ts`:

    | Guard | Mutation | Red |
    |---|---|---|
    | the Linux row runs the Linux arm | the Darwin term on the model's guard always true (the review's M3) | B17: the Linux end-to-end row, the eight knob-less READ rows, the UTF-8 row (ten); the Darwin twin stays green |
    | the Darwin twin runs the Darwin arm | the twin's `CCD_OS=darwin` dropped from its script, on a Linux runner (a test mutation) | B17: the Darwin twin |
    | D-6365: a NUL refuses, knob or none | the NUL refusal gated on a `CCRC_BACKUP` substring (the review's M2) | B17: the NUL row |
    | D-6365: every position is tested | a first-occurrence counter, `index()` plus a neighbour check (the review's M6) | B17: the `_OLD`-then-knob CR row, the UTF-8 row (two) |

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

## Coordinator rulings on review 806 (2026-10-22)

Recorded verbatim from the coordinator's second fix-round mail, with two substitutions. As before, the review report's path is written as "the review's report", because this repository is public. The round's two reserve numbers are written as "the two numbers the mail names": a tracked file may not name an issued number before a plan defines it, and deviation-refs reds on one above the high-water. The round amends D-6363 and D-6365 in place, and defines one of the two numbers, D-6464, by the addendum below.

> Run 775, wave 23: fix round 2. Review 806 read 28df42ded. Its report is the review's report; read it whole before you start. These are my rulings on its eight findings.
>
> Record them in the plan, verbatim, as "Coordinator rulings on review 806 (2026-10-22)". Make the same substitution as last time: write the report's path as "the review's report".
>
> Reserve for this round: the two numbers the mail names, issued to this wave. Prefer amending D-6363 and D-6365 in place. Define a reserve number only for a departure that no existing entry covers, and name it in the wave-done.
>
> F1 and F4a, ruled together: D-6365's shape scan becomes one positive rule, under LC_ALL=C. This replaces the list of refused shapes. F4a is ruled NOT intended: a line that names a different key is not this knob's line. That follows the tree's own rule at ccd/ccrc:3181-3182, where `export OLD_KEY=…` and `export NOTE=KEY=…` name another key.
> - Trim a line's leading spaces, tabs and CRs, the set `_box_env_value` trims. Then:
>   - (a) The line is a comment if it now begins with `#`. Use the comment set the tree's env readers already use; if `_box_env_unit_whole` also takes `;`, follow it, and say which in the as-built note.
>   - (b) The line is a plain assignment if it now begins, optionally after `export` plus spaces or tabs, with an identifier `[A-Za-z_][A-Za-z0-9_]*` immediately followed by `=`, and that identifier is NOT the knob. This is another key's line. A line that begins with exactly `CCRC_BACKUP_DATA_KEEP=` is the line `_box_env_value` takes.
>   - (c) Any other line that names CCRC_BACKUP_DATA_KEEP as a whole token refuses, as unmeasured. A whole token has no `[A-Za-z0-9_]` byte on either side. An `export` of the knob itself is case (c): `export CCRC_BACKUP_DATA_KEEP=9` refuses.
> - The scan runs whether or not a plain line is also present, as it does today. An odd line beside a plain one still refuses.
> - Byte semantics everywhere (LC_ALL=C, the tree's precedent D-3833), so the box's locale cannot change an answer.
> - Must refuse: `+=`, `:=`, a space or tab before `=`, a UTF-8 NBSP before `=`, a UTF-8 NBSP lead, a Latin-1 0xA0 lead, a 0xFF lead, a vertical-tab lead, `export` of the knob, and a line holding the bare name with no `=`.
> - Must read as before (not refuse): a comment naming the knob, the `_OLD` suffix key, an `OLD_` prefix key, `NOTE=see CCRC_BACKUP_DATA_KEEP=4`, `export NOTE=CCRC_BACKUP_DATA_KEEP=4`, CRLF, a tab lead, a quoted value, and an absent key.
> - Pin both sides: one B17 row per refusal shape and one must-not-refuse row per accepted shape (this also closes F4b). Run the byte-shape cases under LC_ALL=C and under a UTF-8 locale. Use C.UTF-8, or en_US.UTF-8 when `locale -a` lists it. If neither exists on the runner, skip that half visibly; never pass it silently.
> - Mutation rows:
>   - drop LC_ALL=C, and the UTF-8 lead case reds;
>   - let (b) take the knob too, and the `export` case reds;
>   - narrow (c) to start-of-line, and the NBSP-lead case reds;
>   - drop (a), so comments are scanned, and the comment row reds.
>   Measure each one red, then restore it byte-identical.
> - What a refusal does stays as built. It is D-6347's invalid-value arm: `_bak_gc` returns before the count prune, and `ccrc backup` exits 1 after its backup. An unreadable setting changes nothing irreversible. Whether an unmeasurable knob should stop only its own act or the whole gc is carried to wave 24, which makes every operator tunable read ccrc.env. Do not change it here.
> - Amend D-6365's text, `_bak_data_keep`'s comment and the README sentence to say the positive rule, not a list.
>
> F2 (minor): fix it.
> - Add `left++` in own's catch, and in own's earlier `quickState` catch, so a refused own counts as left (D-6363).
> - Add a T24 case on own: own's coord.db read fails at keep 2 with three more legacy dirs, and the summary's counts add up to the dirs on disk.
> - Mutation row: delete the new `left++`, and T24-own reds.
>
> F3 (minor, text): fix the README. "A data set that reads as damaged is never thinned." Add one clause for the ruled exception: past the count a dir is read on presence and size, so damage of the same length there is not seen (D-6350, D-6364). Stay inside the consented README lines (mail 7950).
>
> F5 (minor): fix it. Add B18 cases for a dangling symlink at ccrc.env and for a directory there. Mutation row: delete `|| [ -L "$f" ]`, and the dangling case reds. If the directory case cannot red under any single mutation of the same arm, say so in the as-built note.
>
> F6 (minor, text): amend D-6350's opening and Step 7. Name `_bak_keepset`'s verification beside `thin`'s: two verifications in steady state at the default. State the worst case plainly, as argued and not measured: six full verifications, which reaches the 900 s deadline at Step 7's weighted figure.
> - Then read, in the code, what the 900 s deadline does to a run that reaches it: the deadline's reader, D-6356's re-stamp, and the watchdog. Write that in one sentence of the as-built note, with its path:line.
> - If reaching the deadline can make the watchdog or the control plane revert or fail a box that is healthy, STOP and report it in the wave-done before you land anything. Do not fix it in this round.
>
> F7 (minor, text): H2b's title cites D-6349, not D-6363.
>
> F8 (minor, text): fix all three slips.
> - plan:600: "a rollback by flip thins".
> - README:1205-1206: the CR is accepted too. This sentence is rewritten under F1 anyway.
> - plan:234 and the comment at deploy/coordination-snapshot.mjs:1279-1280: say which dir is read again (only one whose quick read threw, or a stale dir after its record goes). State the side effect the reviewer names: outside sparse mode, a dir past the count is thinned on a reading taken before the count's verifications. It is harmless under the lock, because nothing else of ccrc's writes a backup dir.
>
> Routing is unchanged: class opus, effort xhigh. Round 1's first full run was unrun, not red, so there is no shallow signal to raise on.
>
> Growth: ccd/ccrc stands at +37 net against the stop line of 39. If F1's rule cannot fit under it, stop and report the measured count before landing. Do not compress unrelated code to make room.
>
> The gate is unchanged: the brief's suites, ccrc-update.test.ts by the touched describes, and PR #1137's CI test (server) as the arbiter for the whole file.
>
> Landing is still first-ready against runs 722 and 774. Measure `git merge-tree` against origin/main before pushing. Absorb only on a conflict or a red.
>
> Claim 2215 holds. Mail wave-done with the fingerprint when done.

### Addendum: the coordinator's ruling on mail 8134 (2026-10-22)

Recorded verbatim from the coordinator's reply to the worker's mail 8134, which reported F6's stop condition. It needed no substitution.

> Run 775, fix round 2: my ruling on 8134. Thanks for stopping exactly where the ruling said to.
>
> F6 becomes F6b, fixed in THIS round; do not stop the round. It goes in the plan's "Coordinator rulings on review 806" section as an addendum, verbatim, dated, and cites mail 8134.
>
> Why this is mine to rule: D-6350 and D-6356 already state the plan's intent, that thinning fits inside the control plane's deadline. Your reading shows the worst case does not. The fix restores that intent, and it errs in the safe direction: a run that stops early thins less, and the next run continues.
>
> The rule, a time budget for thinning on the update path:
> - The clock is the control plane's own. `deadlineExpired` (server/src/update/dispatch.ts) measures now − max(updateStartedAt, reportedUpdatedAt) against the deadline, plus a hard cap of 4 × deadline from updateStartedAt. D-6356's re-stamp just before `_bak_gc update` is the last `reportedUpdatedAt` this run writes. Take the instant from that same re-stamp.
> - `_bak_gc update` passes the helper one absolute bound: that re-stamp instant plus `_upd_deadline_ms`, less a margin. Seconds are enough. Do not use `date +%N`, because Darwin's date has none.
> - The margin must cover:
>   - what `_bak_gc` still does after thin returns (the count prune, the unlock);
>   - one verification that thin starts just before the bound.
>   Derive it, state the derivation in the as-built note, and pin it.
> - `thin` never STARTS a full verification it cannot expect to finish by the bound. Before each one it checks now + V against the bound, where V is the longest verification this run has measured, or Step 7's largest per-set figure until one has run.
>   - When the check fails, thin stops starting work. Every dir it did not reach counts as left (D-6363).
>   - It prints one line: thinning stopped at its time budget; N left as they are; the next update continues.
>   - It exits 0. This is not a refusal and not the helper's exit 3, so the update's exit and `ccrc backup`'s exit are unchanged.
> - An interrupted thinning (a record beside leftovers) is still finished whatever the budget, because it verifies nothing.
> - Never stop between a record write and its deletes. The record-first order is unchanged.
> - `ccrc backup` passes no bound: it holds no lease, and the operator is waiting on it. The CLI and rollout updates take the same bound as a console update; one path, harmless there.
> - An absent bound means unbounded (an older bash caller). An unparsable bound refuses like any bad argument.
>
> Pins (each measured red, then restored byte-identical):
> - A row whose bound is already past: thin starts no verification, every candidate is left, the line prints, and the exit is 0. Mutation: delete the budget check, and it reds.
> - A row whose bound admits exactly one verification. Mutation: compare against the bound without V, and it reds.
> - An interrupted thinning is finished with a past bound. Mutation: apply the budget to the finish arm, and it reds.
> - A B-row: the node shim captures the args, and `_bak_gc update` passes a bound equal to the re-stamp plus the deadline, less the margin. `ccrc backup` passes none. Mutation: drop the arg, and it reds.
>
> Deviation: define this as D-6464, from the reserve.
>
> Carried, not this round: `_bak_keepset`'s own verifications have run inside this same window since wave 9 (00f8a193a), bounded by the backups listed rather than by the keep. Measure in the as-built note whether `_bak_keepset` ALONE can pass the deadline at Step 7's figures. Say so either way. If it can, that goes to wave 24 as a carried constraint, not a fix here.
>
> Landing: with F6b in, the stop condition is answered by the fix, so the round lands normally. Repeat the 8134 reading and F6b's measurements in the wave-done. A review run follows the wave-done.
>
> Growth: the same stop line, 39. The bash side should be one or two lines; most of the budget lives in the helper. If F1 plus F6b cannot fit, stop and report the count. Do not compress unrelated code.

## Coordinator rulings on review 817 (2026-10-22)

Recorded verbatim from the coordinator's third fix-round mail, with one substitution: as before, the review report's path is written as "the review's report", because this repository is public. The mail names no deviation number, and the one reserve number left from fix round 2 stays unnamed here until a plan line defines it. The round defines none: it amends D-6365 and D-6464 in place.

> Run 775, wave 23: fix round 3. Review 817 read 65d5daa83. Its report is the review's report; read it whole, including its whole-branch section on F1, F2 and F8's shared root.
>
> Record these rulings verbatim in the plan as "Coordinator rulings on review 817 (2026-10-22)". Write the report's path as "the review's report", as before. The one remaining reserve number stays unnamed in tracked text until a plan line defines it.
>
> F1, F2 and F8, ruled together: the knob's VALUE is read through `_box_unit_env CCRC_BACKUP_DATA_KEEP`, the tree's byte-wise model of systemd's EnvironmentFile= (D-3979, `local LC_ALL=C`), no longer through two-argument `_box_env_value`.
> - Why: D-6365's own sentence is "the box's locale cannot change an answer", and the 806 ruling said "byte semantics everywhere". The two-argument reader is neither byte-wise nor a model of systemd. The unit model is both, and it refuses what it cannot decide. That closes F1 (the locale), F2 (multi-line context) and F8 (trailing whitespace, which systemd trims) in one move.
> - Precedence is unchanged: the process environment, else ccrc.env, else 3.
> - Its answers map like this:
>   - rc 0 with the key named: that value goes to `_keep_ok`, as today.
>   - rc 0 with the key not named: 3.
>   - rc 3 (undecidable): refuse, as unmeasured, with BUE_WHY's clause. It names the file and never its bytes.
>   - An unreadable ccrc.env still refuses, exactly as B18 pins.
>   - The exposure file's rc 2 refuses too (unmeasured). Say in the as-built note that the exposure file never carries this knob.
> - The awk scan stays. Its job narrows to the lines the unit model does not refuse: an `export` of the knob, a knob token on a line that assigns nothing, and the rest of the positive rule. Keep B17 whole.
> - Add READ and refuse rows, each under C and under a UTF-8 locale (skipped by name when neither exists):
>   - the two F1 files (a Latin-1 é in a comment, and `FOO=\xc3`, each above `CCRC_BACKUP_DATA_KEEP=9`) read 9;
>   - the five F2 multi-line files refuse;
>   - F8's trailing space, tab and space-CRLF read 4.
> - Mutation rows:
>   - swap back to the two-argument reader: the F1 and F2 rows red;
>   - drop rc 3's refusal: the F2 rows red.
> - Amend D-6365's text in place, plus the function header and README's retention sentence if it names the reader.
> - Growth: this swaps a call, so it should be about zero net lines. Stay at or under the stop line of 39. If you cannot, stop and report the count before pushing.
>
> F4, carried to wave 24 (it plans and opens after this wave lands). The deadline knob's parse and precedence differ between the bash and the server. Wave 24 makes every operator tunable read ccrc.env through one reader, so that is where the two meet.
> - The design input I am carrying there: thin's bound uses the smaller of the readings the bash can make, and any non-canonical or undecidable reading means thin starts no verification that run.
> - In this round:
>   - record F4 in the plan's Risk notes as a residual: it needs a non-canonical spelling, or a user-manager value larger than the file's;
>   - correct the stale "the same value from the same key" comment wherever it sits in your consented lines; name the other site in the as-built note if it is outside them;
>   - do not change `_upd_deadline_ms`.
>
> F3 (important, fix): add a T28 case with unequal steps, one long verification and then a short one, so that it reds under BOTH mutants: V as the latest time measured, and V as the shortest. Measure both red, then restore.
>
> F5 (fix): add a T27 or T28 case with `--verified` under a past bound. It reds when `dir !== verP &&` is deleted, from each arm separately (two mutation rows).
>
> F6 (fix): a time stop must not treat an interrupted `--verified` dir differently from the walk. It refuses, as the walk does: `thin-verified-not-whole`, a WARN, refused++, exit 3 (D-6362).
> - Add a T29 case.
> - Mutation: delete `&& d !== verP` from timeUp, and it reds.
> - Amend D-6464's text.
> - The residual the review notes takes the same rule: a dir behind a time stop whose quick reading carries `.error` WARNs and counts as refused, as the walk does. Add a row.
>
> F7 (fix): pin "a time stop plus a refusal still exits 3" with the review's probe as a T29 case: an interrupted dir, its journal byte-flipped at the same length, behind `--until 1`. Two mutations each red: replace timeUp's warn with `void 0`, and add `refused = 0`.
>
> F9 (text): the D-6365 (c) row lists every row that reds, including B17's two bare-CR rows.
>
> Not ruled, so they stay as they are:
> - the hard cap (plan "Not covered");
> - the untimed hashing after the bound (ruled ungated, inside the 150 s slack);
> - B20's "not mine" arm.
>
> Routing: unchanged, class opus, effort xhigh. This round's findings concentrate in one reader, and the ruling replaces that reader instead of patching it. If the next review still finds the knob reading wrong, I raise the effort then.
>
> Gate: as before. The whole of ccrc-update.test.ts is the arbiter on CI. Locally, the describes you touch, coordination-snapshot whole, and the guards.
>
> Landing: first-ready against runs 793 (PR #1149, in review), 722 and 774. Measure merge-tree against origin/main and #1149's head before pushing. Absorb only on a conflict or a red, with git merge.
>
> Claim 2215 holds. Mail wave-done with the fingerprint when done.

## Coordinator rulings on review 839 (2026-10-23)

Recorded verbatim from the coordinator's fourth fix-round mail, with one substitution: as before, the review report's path is written as "the review's report", because this repository is public. The mail names no new deviation number, and the round defines none: it amends D-6347, D-6360 and D-6365 in place, and the one reserve number left from fix round 2 stays unnamed here.

> Run 775, wave 23: fix round 4, ruled on review 839 (the review's report; read it whole). Record this verbatim in the plan as "Coordinator rulings on review 839 (2026-10-23)", and write the report's path as "the review's report".
> No new deviation numbers: amend D-6347, D-6360 and D-6365 in place, each saying "amended on review 839". If a genuinely new departure appears, spend your one remaining reserve number.
>
> The review found no defect in what was ruled and four small gaps, and it answered my three questions with the systemd oracle. Its one important point: this round made a ccrc.env or exposure file that never names the knob stop the count prune, where main pruned (bisected to ef567a87e), and nothing surfaces it. That is fixed now, not carried.
>
> 1. Your departures 1 and 4 are ratified.
> - FOO=\xc3 above the knob refuses: systemd 255 skips that whole file, so the ruled 9 was wrong.
> - The CR lead refuses. That is conservative; splitting a line at a bare CR, as systemd does, is wave 24's one reader.
> - Amend the ruled rows in the plan to the measured answers.
> - The F6 analogue and the new thin-not-a-dir WARN stand as built.
>
> 2. Precedence becomes literal: the environment, else ccrc.env alone, else 3 (amends D-6365). Your departures 2 and 3 are superseded by it.
> - Why: on Linux no process that thins receives the exposure file. Its one consumer is ccrc.service. Console and watchdog runs take the user manager's environment, and an ssh rollout takes none. Refusing over that file judged a file the reader never gets, and it cost a byo box with an internationalised origin its prune.
> - How: read ccrc.env through _box_unit_env with the exposure file excluded, by passing a path that cannot exist beside the call (for example CCRC_EXPOSURE_FILE="$f/."), with a comment saying why.
>   - Never the empty spelling CCRC_EXPOSURE_FILE=. The review measured that it disables ccrc.env's own rc 3 refusal: an F2 span file reads 3 against the unit's 9, which deletes data sets.
>   - Do not edit _box_unit_env itself: install's gate line and doctor's auth check read through it too.
> - Remove the exposure-source check, the 2) arm and BUE_SRC's use here.
> - Rows:
>   - the four exposure rows invert into READ rows: K=2, an empty K=, mode 000 and an internationalised origin in the exposure file, each beside ccrc.env's 9, read 9;
>   - add a row with no ccrc.env and an exposure file naming the knob, reading 3;
>   - pin one UNDECIDED ccrc.env row under the chosen spelling. Mutation: the empty spelling must red it.
> - Text: D-6365, the function header and README's retention paragraph say ccrc.env alone.
> - Name the Darwin residual in Risk notes: the launchd job sources both files, and a console update inherits its process environment. So an exposure-file K there arrives as the environment, and wins.
>
> 3. The rc 3 refusal applies only to a ccrc.env whose bytes hold CCRC_BACKUP_DATA_KEEP as a whole token (amends D-6347). A file that never names the knob cannot set it, so the faithful keep there is 3, whatever systemd does with the file.
> - Whole token: the name not preceded or followed by [A-Za-z0-9_]. A token anywhere, a comment included, still refuses as now.
> - Rows, under C and C.UTF-8:
>   - knob-less READ rows reading 3: NOTE=café, FOO=\xc3, # a\rb, # note\r\r\n, FOO=a\rb, and a span file with a UTF-8 comment;
>   - one end-to-end row: _bak_gc update prunes 12 backups to 10 at CCRC_BACKUP_KEEP=10 beside such a file.
> - Mutation: delete the token check. The knob-less rows and the end-to-end row red.
> - Growth: ruling 2 frees lines before this one spends about one. ccd/ccrc stays under the stop line of 39.
>
> 4. The findings, all fixed:
> - F1: a FIFO at ccrc.env in B18's it.each, under a bounded timeout so a hang fails the row. The mutation [ -f ] to [ ! -d ] reds it.
> - F2: B17 rows with CCRC_BACKUP_DATA_KEEP=5 in the environment beside an undecidable ccrc.env, reading rc 0 keep 5. The review's mutant (drop the environment check) reds them.
> - F3: README's "still exits 0 (D-6464)" becomes "exits 0 unless a dir was refused (D-6464)".
> - F4: every exposure row, new and inverted, also runs in the UTF-8 loop. The as-built note says exactly which rows run under which locale.
> - Two texts the panel refuted on scope only, fixed anyway:
>   - D-6360's "through _box_env_value" becomes "through _box_unit_env";
>   - README's "after its leading spaces, tabs and CRs" says a CR lead refuses.
> - The thin spot: a row that reds `refused = 0` placed first in timeUp. Tests only.
>
> 5. Not this wave:
> - ccrc-uninstall's rc 1 from the process-leak check, which main shares. I carry it.
> - The model's CR rule, and whether any reader reads the exposure file at all: both wave 24's.
>
> Gates as before, one file at a time. Measure every new row red, then green.
> Landing as before: first-ready, with merge-tree measured against main and against #1149's head.
> Send wave-done in the same turn as the push.

## Coordinator rulings on review 847 (2026-10-23)

Recorded verbatim from the coordinator's fifth fix-round mail, with one substitution: as before, the review report's path is written as "the review's report", because this repository is public. The mail names no new deviation number, and the round defines none: it amends D-6347 in place, whose text had F3's overstatement too, and the one reserve number left from fix round 2 stays unnamed here.

> Run 775, wave 23: fix round 5, ruled on review 847 (the review's report; read it whole). Record this verbatim in the plan as "Coordinator rulings on review 847 (2026-10-23)", and write the report's path as "the review's report".
> No new deviation numbers. Amend D-6347 and D-6365 in place only if their text changes.
>
> The review found nothing wrong in the reader. A 400-file fuzz and 33 named fixtures, under three awks and two locales, found no file where systemd sets the knob and the tip reads 3. Stale out-params are never read. Both ratified departures hold. This round is tests and two text lines, and nothing else changes.
>
> 1. F1 (important): the end-to-end prune row is not pinned to an OS, so on test-macos the Darwin model refuses NOTE=café and the row reds. That would turn main's daily full-suite red, and with it the stable gate.
> - Prefix that row's script with CCD_OS=linux, as dataKeep does.
> - Add a Darwin twin with CCD_OS=darwin, beside the same NOTE=café ccrc.env. It expects the WARN with the Darwin clause, rc 1, and 12 left. That pins ratified departure 1 end to end.
> - Measure: the review's mutant M3 (the Darwin term always true) still reds the Linux row, and dropping the twin's CCD_OS=darwin reds the twin on a Linux runner.
> 2. F2: a knob-less NUL row. Add `NOTE=x\0y\n` to B17's NUL rows, expecting "could not be scanned". The review's mutant M2 (the NUL refusal gated on a CCRC_BACKUP substring) must red it.
> 3. R8, refuted as a defect, but its mutant deletes data sets, so pin it: a row `${K}_OLD=1\r${K}=9999` expecting the refusal (UNTAKEN). Measure M6 (a first-occurrence counter) red on it.
> 4. F3: README:1212-1213's "whatever else it holds" becomes "whatever else it holds but a NUL byte". The function header's "its keep is 3 whatever the model or systemd makes of the rest of it" gains the same exception. Both stay inside the consented lines.
>
> 5. CI's red server 4/11 is the trickle row (ccrc-update.test.ts, F4/F4b of reviews 167 and 173). The wave does not touch it, main's Linux legs are green on it, and it passed twice locally. Your push gives a fresh run. If that row reds again on the new head, put the job log's assertion line in the wave-done, and I decide. Do not re-run a job by hand.
>
> Not this wave, carried:
> - the uninstall suite's process-leak exit, which main shares;
> - the model's quadratic cost on a long knob-bearing comment line (R7), which predates the wave and is wave 24's one reader.
>
> Gates as before, one file at a time. Measure every new row red under its mutant, then green. Landing as before: first-ready, measuring merge-tree against main and against #1149's head. Send wave-done in the same turn as the push.
