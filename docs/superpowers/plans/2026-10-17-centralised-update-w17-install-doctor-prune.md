# Centralised update management, wave 17: the install spine places `ccrc-api`, the update records its sweep and doctor warns on it, and the backup pruner, the KEEP check and two test helpers close their residue: Implementation Plan

The coordinator cut wave 17 on 2026-10-15 at 22:11 UTC (programme ledger, "the cut to completion", the "Wave 17, behind run 360" bullet; row 17 of the waves table). It is the install spine's, the doctor's and the backup pruner's residue: `ccrc-api` placed and removed by `ccrc` itself, Reading 9's doctor half (warn only), R10k, R8f, R14(a), R10i, R34, R25(a)'s code-comment half and R35(b), with R32 put to the coordinator as a Reading. Run 564 carries it, with deviation block 5313 to 5332. A plan workflow drafted it on 2026-10-17 in a scratch worktree built by the coordinator: `origin/main` at `d48b7008f` (#501), merged with #448 at `a8c2cd90f` (where #448 conflicts with `main`, in `README.md`, `ccd/ccd`, `ccd/ccrc-doctor-checks`, a spec, `server/test/auth-gate.test.ts`, `server/test/ccd-archive.test.ts` and `shared/api.ts`, the projection took `main`'s side, so #448's hunks in those files were read from `a8c2cd90f` itself), then #444 at `eee9001f1`, #482 at `1065b9994` and #441 at `97493f9b2` (only `ccd/ccd`'s stamp line conflicts; its side taken). `ccd/ccrc` and `deploy/deploy.sh` merged clean, so their projected text is the text this wave edits. Two earlier drafters died with their session (the shared session slice sat at its cap and the out-of-memory killer took it). Their only surviving output was Task 1's prototype. The slice read above its 21 GB gate for the whole of this draft, so **no vitest ran**. Rows marked *(prototype)* were measured by a bash row against the projected files, or, for Task 1's census row only, by the first drafter through a vitest-free shim that ran `install-census.test.ts`'s describes under node. Every other red and green is marked *(unmeasured: the worker measures it)*, and the worker measures each before relying on it. A reviser then applied three attack lenses (install-doctor, prune-keep, process) the same day and revised the projection's prototype to match (a local commit in the scratch worktree, never pushed): a line it changed and measured again by a bash row is marked *(prototype, revised)*; one it changed and did not measure is marked *(revised, unmeasured)*. The row scripts are in the Appendix, so the worker re-runs the same scripts rather than reconstructing them. Since the draft, #444 landed on `main` as the squash commit `13f11b696` (2026-10-17 20:06 UTC); the projection carries its head `eee9001f1`, whose `ccd/ccrc` and `deploy/deploy.sh` text this plan quotes. Its file is `docs/superpowers/plans/2026-10-17-centralised-update-w17-install-doctor-prune.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a box moved only by `ccrc update` carries the `ccrc-api` its tree ships (a box that carries README's link already did, and keeps the link); the update's phase report records what its supervisor sweep did (no unit already down before the restart, which units were, refused, could not verify, or died partway), and `ccrc doctor` WARNs, and never FAILs, when that record says something is still wrong; the two backup pruners share one removal filter, and a link is never a backup; both KEEP spellings accept ASCII digits only; `pathWithout` carries `head`; the four spawns R35(b) names run contained.

**Architecture:** no new verb, no server change. `ccd/ccrc`: `_inst_bins` and `_uninst_tree_bins` gain one name; `_upd_sweep` sets a new global `UPD_SWEEP_WORD` at each of its return points, and `_upd_sweep_die` sets it before its die; `_upd_phase` writes it as an additive `sweep` key, only when it is set; `_bak_removable` becomes the one spelling of the filter; `_bak_list` skips links; `_keep_ok`'s class is enumerated. `ccd/ccrc-doctor-checks`: one new check, `update-sweep`. `deploy/deploy.sh`: one regex token and one comment. `deploy/gen-wrappers.mjs`: one name. Tests follow, one row per guard, each with its mutation row.

**Deploy class:** fleet-first. `ccd/ccrc` and `deploy/deploy.sh` change; `ccd/ccd` does NOT (it is generated, and five open PRs edit it). The first move INTO this wave is driven by the OLD `ccrc`, but its install spine is the STAGED tree's own `ccd/ccrc` (`cmd_update`'s `local -a spine=(bash "$UPD_TREE/ccd/ccrc" install)`, whose header says the staged verb ends with `cmd_doctor` from the NEW tree). So that move DOES place `ccrc-api` and DOES run the new `update-sweep` check, which SKIPs on its in-flight report. Only its sweep record is absent: the old process runs `_upd_sweep` and the closing `_upd_phase done`, so no `sweep` key is written, a bare doctor afterwards reads the missing key as "not measured" (Task 4), and the next move is the first that records a sweep. The coordinator's check after the fleet box's first move: `~/.local/bin/ccrc-api` exists and `cmp` finds it equal to `~/ccrc/ccd/ccrc-api` (a README-linked box shows the link still in place). *(revised, unmeasured: read from the code, not run.)*

**Landing order, as dependencies:** this wave lands after the PRs it builds on, and each task names only its own dependency. Tasks 6 and 7 need #448's `_bak_*` functions (run 360); Task 4 needs #448's doctor-table line and the end of claim 1557 (run 433); Task 11 needs #482 (wave 18, claim 1564); Tasks 2, 3, 8 and 9 needed #444, which is on `main` now (`13f11b696`); Task 9's premise was measured with #441 (wave 15 with 20) in the projection. Main SQUASH-merges, so a PR's head sha never becomes an ancestor of `origin/main`: the landed-check is `gh pr view <n> --json state,mergeCommit` (a read) or `git log origin/main --oneline --grep '(#<n>)'`, never `git merge-base --is-ancestor`. Before the first push, the worker may rebase its local commits onto `origin/main`; after the PR opens it merges `origin/main` into the workspace branch and never rebases or force-pushes (the programme's standing rule for a published branch). Every hunk is re-anchored by content (function names, unique strings) in the landed text, never by a PR head's text or by line number. Line numbers below are the projection's and are for finding, not for editing.

## Not in this wave

- **README's `ccrc-api` lines** (the install section and the uninstall paragraph). They go to the coordinator's docs PR, with README's Reading 9 clause (row "docs PR" of the waves table). Claim 1570 (run 468) holds `README.md` (re-read 2026-10-17 20:13 UTC). The docs PR is told that README's `ln -sfn ~/ccrc/ccd/ccrc-api ~/.local/bin/ccrc-api` line and the spine's copy now coexist: a linked box keeps its link (Task 1 Step 5 pins that), an unlinked one gets a byte copy at every install, so the line becomes optional rather than required.
- **A re-sweep.** A refused, unverified or died sweep is RECORDED, never retried: nothing in `ccrc update`, the watchdog, the timer or doctor restarts a supervisor because of the record. The WARN lasts until the next update or rollback writes a new report, and each such WARN's remedy says so ("this WARN clears at the next ccrc update or rollback"), so an operator who has followed it is not left chasing it. A live re-measure that would clear it sooner is Reading 13. This is a non-goal, not an omission (R10k's own text asks only for visibility).
- **The server's inventory.** `GET /api/updates` reads `update.json` by name (`reportFrom`: `phase`, `target`, `startedAt`, `updatedAt`, `detail`) and ignores every other key, so the new `sweep` key reaches no console in this wave. Whether it should is Reading 3.
- **`report.detail` stays as it is.** A clean or refused sweep keeps `detail: null` (review 196 item 1: "the refusal is the KillMode refusal's own exit code and update.json — never a new failure"; `ccrc-update.test.ts` pins `detail: null` at the LISTING-refusal case, `itLinux('(a) the unfiltered pre-sweep listing fails — the sweep is REFUSED, not the old zero line …'`, whose comment reads "The refusal is the KillMode refusal's own exit code and update.json —"). The record is a NEW key, so that pin holds unchanged. A die keeps its die sentence as `detail`, as today.
- **(Ruled IN, 2026-10-17: Reading 6 option 1 is Task 7 Step 5.) deploy.sh's remote prune counts links** unless the coordinator rules Reading 6's option 1 in. Its `ls -d [0-9]…` lists a timestamp-named link (or plain file), so a newer one holds a newest-N slot and the fallback prune removes a real backup in its place (measured, Appendix `row-pk2.sh`). Reading 6 offers the line-neutral fix and the leave-it option.
- **#444's all-zeros refusal** (D-5144, `! [[ "$keep" =~ ^0+$ ]]` on deploy.sh's KEEP line). Task 8 edits only the line's FIRST regex token and leaves that statement byte-identical. Whether `_keep_ok` should refuse `0` as deploy.sh now does is Reading 4 (wave 16's plan left it to this wave).
- **`update-semver.test.ts`'s `_ver_newer` slice** stays on the raw-spawn census's SLICED_ALLOWED list: R35(b) names only the ccrc-doctor and ccrc-install spawns.
- **(Ruled IN, 2026-10-17: Task 10 runs.) R32's naming half, unless ruled in.** The record half is IN this wave now: `_upd_sweep_die` sets `died: sweep`, so a died sweep's `failed` report carries a key the doctor WARNs on (D-5315, Task 2). Moving the stderr NAMING loops above the die is Task 10, which the coordinator rules in or out (Reading 5).
- **The plan halves of R25(a) and R25(b)** (the telemetry-keepalive plan and the wave-11 plan anchor): the coordinator's docs PR.

## Global Constraints

- **Files:** `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `deploy/deploy.sh`, `deploy/gen-wrappers.mjs`; tests `server/test/install-census.test.ts`, `server/test/installTreeFixture.ts`, `server/test/ccrc-install.test.ts`, `server/test/ccrc-uninstall.test.ts`, `server/test/ccrc-update.test.ts`, `server/test/ccrc-doctor.test.ts`, `server/test/raw-spawn-census.test.ts`, `server/test/ccrc-sweep-window.test.ts` and `server/test/sweepFixture.ts` (Task 2 Step 4 if the worker puts S1 to S4 there, and Task 10), `server/test/ccrc-darwin-job-helpers.test.ts` (Task 3's Darwin job-file row, if its harness can force the Darwin arm on Linux; otherwise no Darwin file is touched); `agent/test/deploy-verify.test.ts`; and this plan. `deploy/deploy.sh`'s remote prune line and a D3c row in `deploy-verify.test.ts` join only if the coordinator rules Reading 6's option 1 in. `ccd/ccd` is NOT touched (no restamp). `ccd/ccrc-api` is placed, never edited.
- **Claims, in groups, as each group frees.** The worker skill's clause 11 says to claim every path a wave touches, all-or-nothing; one claim over all of this wave's paths would 409 while claim 1557 or 1564 is live. This plan's reading of clause 11, deliberate: one claim per GROUP, all-or-nothing within it, each taken when its group frees, and every group named here. Group A, now: every path in Files except the two below. Group B: `ccd/ccrc-doctor-checks` (Task 4), when claim 1557 ends or run 433 consents through the coordinator. Group C: `server/test/raw-spawn-census.test.ts` (Task 11), when claim 1564 ends (#482 lands). Re-read the live claims before each with `ccrc-api claims list --project ccrc-pwa` (a read). Snapshot, re-read 2026-10-17 20:13 UTC: claim 1557 (run 433, path identity W1b) holds `ccd/ccrc-doctor-checks` and `ccd/ccd`; claim 1564 (run 517, wave 18) holds `server/test/raw-spawn-census.test.ts`; claim 1563 (wave 16) has ENDED (#444 landed), so `ccd/ccrc`, `deploy/deploy.sh`, `agent/test/deploy-verify.test.ts`, `server/test/sweepFixture.ts` and `server/test/ccrc-sweep-window.test.ts` are free; claim 1566 (run 300) holds `server/test/macos-platform.test.ts`, which this wave only RUNS (Task 12), never edits. No live claim then covered `deploy/gen-wrappers.mjs`, `install-census`, `installTreeFixture`, `ccrc-install`, `ccrc-uninstall`, `ccrc-update` or `ccrc-doctor` tests.
- **`ccd/ccrc-doctor-checks`' check table is cited by line number.** Its table entry goes on the existing LAST table line (the one ending `docs-sw`), before `docs-sw` (which stays last, M7.6), and the function at the END of the file (after #448's `_check_delegation-hooks`), so no other line of the file moves. Same rule as `server-caps`, `scope-sweep` and `docs-sw`.
- **Fixture HOMEs only:** every `ccd`/`ccrc` spawn and every sourced function runs under a fixture HOME (a `mkdtemp` directory, quoted). Never run `ccd` or `ccrc` against the live HOME; never touch real tmux, `systemctl --user` on the live manager, `launchctl` or `claude-session@` units; never run `ccrc update`, `rollback`, `rollout` or `install` outside a fixture.
- **Memory:** the shared session slice sits near its cap. Before any vitest run read `anon` in the slice's `memory.stat`, and run nothing while it reads above 21 GB. Then ONE file at a time, foreground, from inside `server/` or `agent/`: `./node_modules/.bin/vitest run test/<one>.test.ts --pool=forks --maxWorkers=1`, with `-t '<case>'` where a row names one case, and a short real TMPDIR (`mkdir -p ~/.cc-tmp/w17q`). `bash -n` and one-off rows that source one function into a fixture HOME are cheap and preferred.
- **The absorb step.** Before each task's first edit, `git fetch origin main` and check, by the landed-check in the header (`gh pr view <n> --json state,mergeCommit`, or `git log origin/main --grep '(#<n>)'`), whether that task's dependency has landed; before the first push rebase the local commits onto `origin/main`, after it merge `origin/main` (never rebase or force-push a published branch), and re-read every anchor this task names in the landed text. Until #448 lands, the backup tasks (6, 7) are written against `git show a8c2cd90f:ccd/ccrc`'s `_bak_*` functions, which the projection already carries (they merged clean); the doctor task (4) against `git show a8c2cd90f:ccd/ccrc-doctor-checks`' table and end of file.
- **Public repo:** noreply identity; no hosts, home paths, lane or account names in code, comments, commits or the PR body. Fixture unit ids are stand-ins (`acct-a-demo`, `acct-b-demo`).

## Review Focus

- **The doctor check never FAILs,** by the operator's ruling (2026-10-15, warn only). A FAIL would turn a state the update already recorded and reported into exit 1 for every bare `ccrc doctor` and `ccrc install`, and, through D-3114's `doctor_failed`, into exit 3 with a changed `done` detail for every later update. Is there no `_dr_fail` in `_check_update-sweep`, and does a structural row pin that (Task 4's D12)?
- **Absent is never "none".** A report with no `sweep` key (written by a build before this wave, by a converged no-op, by the gate-failure restore, or by a run that stopped before its sweep) must answer SKIP "not measured", never PASS. Does any arm read the absence as a clean sweep?
- **Three answers, never two.** `_svc_is_active` answers `active`, a manager word, or EMPTY when the manager did not answer. Does the doctor's re-measure keep empty as "not measured" (D13, D14), and does it set the bus defaults the `services` check sets?
- **The record is additive.** `update.json`'s seven keys keep their order and meaning; `sweep` is appended only when set; `detail` is unchanged on every path (the listing-refusal pin's `detail: null` holds). One existing row DOES compare every line's keys, `REPORT_KEYS` in `ccrc-update.test.ts`'s "seven keys in order" case, and it changes (Task 2 Step 4). Is that change named in the PR body?
- **One filter, one spelling.** After Task 6, does either pruner still carry a `[ "$d" = "$BAK_KEEP_` literal, and does the helper fail CLOSED on an unparsable floor?
- **A link is never a backup (a pin reversed).** P18 pinned the opposite (review 196 F10: "counted and removed as a link"). Is the reversal stated, and does the new row prove a link can no longer hold a keep slot?
- **`[0123456789]` in both spellings,** with D1c still holding them equal, and #444's all-zeros statement byte-identical.
- **Census lists both ways.** Task 1's new install-census row and Task 11's raw-spawn entries: a stale entry reds, a missing one reds.

## Risk notes

- **A WARN that must never FAIL.** The check runs in three places: a bare `ccrc doctor`, `ccrc doctor --fix`, and the install tail inside `ccrc update`/`rollback`. In the last, `update.json` is that run's own in-flight report, so the check SKIPs by construction (phase not terminal; in `restarting` its pid is the live parent updater's). Its only non-SKIP answers are PASS and WARN; `_dr_warn` returns 2, which `cmd_doctor` counts and never turns into a non-zero exit. The worker confirms which pid each non-terminal phase records before relying on the `restarting` arm (`queued` records the detaching parent's, which exits at once, so the dead-pid WARN is deliberately confined to `restarting`).
- **Darwin.** `_upd_sweep` has a wholly separate launchd arm: its refusal is the job file without `AbandonProcessGroup`, its failure naming is "is FAILED (start-limit stamp)", and it has no listing refusal and no KillMode preflight. Task 3 sets the word on that arm too (`refused: job-file`, and the start-limit units as `down`). The doctor's live re-measure uses `_svc_is_active` (the platform shim, which works on launchd) and its remedy is `ccd start <id>` there, with no `systemctl`. The sweep fixture's Darwin rows are `itLinux` by wave 16's ruling, so the Darwin-arm word is pinned on Linux by a fixture-only row that forces `CCD_OS=darwin` through the existing Darwin job helpers, or is left to the macOS leg *(unmeasured: the worker measures it)*. `ccrc-api` is portable (it sits in `macos-platform.test.ts`'s GNU-call corpus), so Task 1 places it on both arms. `head`, `[ -L ]` and the glob are BSD-safe. `[0123456789]` needs no locale on either platform; the non-ASCII row self-guards and skips where its premise does not reproduce.
- **The install census.** Forget one of the three id-shaped lists (`TOOLCHAIN_EXECUTABLES`, `_uninst_wrappers`' `case`, the placed set) and `install-census.test.ts` reds, which is the intended guard. `installTreeFixture.ts` must carry `ccd/ccrc-api` as a source, or every Linux install describe dies at `_inst_atomic` (the fixture file's own comment records 72 reds for the history sweep's equivalent). The line must stay OUTSIDE the one `if [ "$INST_ROLE" != server ]` block: `gptGateBlock()` demands exactly one and reserves every id-shaped name inside it as an account id.
- **The 200-character cap.** `_upd_json_str` cuts a value at 200 characters, which could split the last unit id into a fragment the doctor would re-measure as a unit of its own (measured on the first prototype: 12 long ids gave 264 characters and a stored last token `a`). So the writer appends WHOLE ids only while the word stays within 200, and puts the COUNT first: a long list loses names, never the number, and never stores a fragment; the doctor says "names k of n" *(prototype, revised: Appendix `row-cap2.sh`, CAP RED before, GREEN after)*.
- **A flip back to a kept version runs that version's own spine.** `_ver_flip_back` (and the gate-failure restore's arm 1) runs `bash "$BOX_TREE_DIR/ccd/ccrc" install` from the KEPT tree. Until every kept version is wave 17 or later, a flip back to an older one neither places nor removes `ccrc-api`: an unlinked box keeps the wave-17 byte copy on an older tree. That is harmless while the client stays backward-compatible with an older server's routes; if a later wave breaks that, the operator re-links per README or redeploys. A README-linked box follows the flip. No code change.
- **The README link survives only through `_inst_atomic`'s `cmp` branch.** `_inst_tree` flips `~/ccrc` before `_inst_bins`, so on a linked box the source is the link's own target, `cmp -s` finds them equal, and `_inst_atomic` chmods and returns without replacing the link. Task 1 Step 5 pins that, so a later change to `_inst_atomic` that replaces whatever is at the destination reds instead of silently turning the operator's link into a copy.
- **"The last update" is literal.** A later converged no-op (`already converged at …`) writes `done` with no `sweep` key, so an earlier WARN becomes "not measured". That is honest (the box was not swept again) and is stated in the SKIP text.
- **The first drafters' prototype for Task 1 is staged but not committed**, and was measured only by the shim. The worker re-measures it with vitest before building on it.

## Deviations found

Block 5313 to 5332, issued to run 564. This plan defines 5313 to 5327, in order: 5313 to 5323 by the drafters, and 5324 to 5327 by the coordinator's rulings of 2026-10-17 (Tasks 13 to 16). The last five, 5328 to 5332, are the worker's reserve, spent in order, each defined here before use.

- **D-5313.** `_inst_bins` places `ccd/ccrc-api` at `$HOME/.local/bin/ccrc-api`, mode 755, on both platform arms and every role except server, through a ONE-LINE `[ "$INST_ROLE" = server ] ||` gate (the history sweep's shape, never a second `!= server` block), and names it in both closing `install: bins:` lines; `_uninst_tree_bins` removes it on every role; `deploy/gen-wrappers.mjs`' `TOOLCHAIN_EXECUTABLES` and `_uninst_wrappers`' `case` line know it; `install-census.test.ts` gains the other direction of the deploy.sh census for binaries (deploy ⊆ install). Why: until this wave the install spine placed nothing at that path. README documents a link, `ln -sfn ~/ccrc/ccd/ccrc-api ~/.local/bin/ccrc-api` ("a link follows every update"), which the wave-13 plan asked the operator to put on each fleet box, and a box carrying it already followed every update; the spine now covers an unlinked box too, which otherwise kept whatever copy the last fallback `deploy/deploy.sh` left, or none. On a linked box the spine keeps the link (its source is the link's own target, so `_inst_atomic`'s `cmp` branch returns), and Task 1 Step 5 pins that. Uninstall removes whatever is at the path, link or copy. Limit, stated: a flip back to a kept version older than this wave runs that version's spine, which does not touch `ccrc-api` (Risk notes). Server is gated off because the client's callers are sessions and their role skills, which a server-role box does not host (D-3111), and `deploy.sh` places it in the agent lane only (Reading 1).
- **D-5314.** `update.json` gains an additive eighth key, `sweep`, written by `_upd_phase` only while the new global `UPD_SWEEP_WORD` is set; `_upd_sweep` resets it on entry and sets it at each return: `ok` when NO unit was already `activating` or `failed` before the restart, or `down: <n>: <id> …` naming EVERY such unit, read from the pre-restart listing (`prior`) whatever it reads after (on Darwin, the start-limit units the sweep skipped). The ids are whole, as many as fit in 200 characters, the count first. Why the whole class and not only those still down after: the sweep never verifies one of them, and its own comment says a crash-looping Type=simple unit usually reads `active` the moment try-restart forks it, so recording only the not-active ones made `ok` claim a clean sweep over a crash-looping unit; and a class read from the pre-restart listing needs no post-restart one, so a sweep that restarted nothing and could not re-list records the truth rather than `unverified`. Why a record at all: wave 16 (#444) names those units only on stderr, which for a detached run is a transient unit's journal; nothing durable said the box carries a supervisor that the update could not bring back. A new key, not a `detail` word: an absent key then means "not measured" for every older build and every path that never swept, with no reading of a missing word as "none", and `detail`'s pinned `null` on clean and refused runs holds.
- **D-5315.** R10k: the sweep's three refusals, its unverified arm and its one die set the same word: `refused: listing`, `refused: killmode`, `refused: job-file` (Darwin), `unverified: relist` (something was restarted and the post-restart listing was unread), and `died: sweep`, set by `_upd_sweep_die` before its `_ccrc_die`, so the `failed` report a died sweep writes carries it beside the die sentence in `detail`. The update still exits as it does today and still writes `done` (or `failed`) with `detail` unchanged. Why: a refused sweep left every live supervisor on the previous `ccd`, and a died one left them on mixed builds, and each said so only on stdout and stderr; the record makes it visible to doctor. The die word is R32's record half, which fits cheaply here (one line in the one die), so Reading 5 now covers only the naming half. Nothing re-sweeps (Not in this wave).
- **D-5316.** A new doctor check, `update-sweep`, reads the last report's `sweep` key: SKIP when the report is absent, unreadable, at a non-final phase, or carries no key, except that a report stuck at `restarting` whose updater pid is gone WARNs (an updater killed mid-sweep leaves that phase for good on a box with no watchdog); PASS on `ok`; for `down`, it sets the bus defaults the `services` check sets and re-measures each named unit with `_svc_is_active`, keeping its THREE answers apart: `active` is back (PASS words it "active at this read"), EMPTY is not measured (SKIP when no unit is down, named as unmeasured in a WARN otherwise), any other word is still down and is quoted back; WARN on `refused`, `unverified` and `died`, each remedy ending "this WARN clears at the next ccrc update or rollback"; SKIP on a word it does not know. It has no FAIL arm, and a structural row pins that. Why: Reading 9 was ruled "warn only" (2026-10-15), and a FAIL would turn a state the update already recorded into exit 1 for every bare doctor or install and exit 3 with a changed detail for every later update. Why three answers: CLAUDE.md's L3 rule, an adapter may not narrow a distinction it received; folding EMPTY into "still not active" made a doctor run from a context with no bus WARN that every recorded unit was down when nothing was measured. Amended by the coordinator's ruling 12 (2026-10-17): on Linux the `down` arm's PASS also needs `NRestarts` 0 from `systemctl --user show`; `active` with restarts WARNs, and a `show` that does not answer is not measured.
- **D-5317.** R8f: `ccrc-install.test.ts`' `pathWithout` adds `head` to its farm. Why: `ccd/ccrc` calls `head` on the install path (`_inst_stamp_shipped`'s `git tag --points-at HEAD | … | head -n1`), so under every `pathWithout` PATH the stamp silently loses its `version` field (measured by a bash row at planning).
- **D-5318.** R14(a): `_bak_removable <dir>` is the one spelling of the removal filter (this run's own directory, at or after the floor, the snapshot keep, the data keep, the tree keep), and both `_bak_prune` and `_bak_gc` call it. It reads the floor from `UPD_BAK_FLOOR` itself and fails CLOSED (not removable) when that is unparsable. Why: `_bak_keepset`'s own header says the filter "is written twice, once in each pruner's loop, and nothing pins the two copies to each other", and #448 grew both copies from four clauses to five.
- **D-5319.** R10i: a link is never a backup. `_bak_list` skips a timestamp-named symlink, so it is not counted, not pruned and never holds a newest-N slot or a keep. P18 is REVERSED (it pinned "pruned as a link"; review 196 F10). Why: `[ -d ]` follows the link, so a link was counted in the newest-N window and could be chosen as the tree, snapshot or data keep through its target, evicting a real backup's protection. The cost, stated: a stray timestamp-named link is now left in place, never pruned (it leaks one link, never a target). `_ver_list` in the same file already applies this rule to versions. `deploy/deploy.sh`'s remote prune is a separate lister and keeps counting links unless Reading 6's option 1 is ruled in.
- **D-5320.** R34: both KEEP spellings, `ccd/ccrc`'s `_keep_ok` and `deploy/deploy.sh`'s `prune_backups` first test, spell the class `[0123456789]`, not `[0-9]`. Why: under a UTF-8 locale bash's `=~` range `[0-9]` accepts non-ASCII decimal digits (measured at planning: U+0663 and U+FF15 under `en_US.UTF-8`), which then fail later as an arithmetic error instead of the KEEP sentence. The enumerated class needs no locale and no scope that could leak, and it keeps both spellings a single literal that D1c can compare. (`local LC_ALL=C` inside a function works too, and `ccd/ccrc`'s D-3833 readers rely on it; it was not chosen only for those two reasons.)
- **D-5321.** R25(a)'s code-comment half: the comments in `deploy/deploy.sh` and `agent/test/deploy-verify.test.ts` that say `_svc_enable`/`_svc_disable_now` "reload on the next session start or stop" name `_svc_enable_now` instead. Why: since wave 15 (#441) `_svc_enable` is `systemctl --user enable --no-reload`; the sentence's conclusion stands, and only the function it names was wrong. #441 does not carry this (measured: the projection, which includes #441, still has both lines).
- **D-5322.** R35(b): the `_box_role` spawn in `ccrc-doctor.test.ts`, its `_exp_env_write` slice, and `ccrc-install.test.ts`' `_ver_newer` and `_inst_installed` slices run under `ccrcContainedEnv`, and their raw-spawn census entries are removed in the same commit, with the census case that pinned the `_inst_installed` harness as "no env" rewritten to pin it CONTAINED. Why: they were the census's named exceptions, and each now has the builder the census asks for.
- **D-5323.** R32 (ruled in by the coordinator, 2026-10-17, ruling 5): `_upd_sweep`'s two stderr naming loops (item G's and Reading 9's) move above the `_upd_sweep_die` block, unchanged. Why: on a failed update the die exited before either loop, so a unit already down before the restart went unnamed exactly when the update failed. If the coordinator rules it out, this entry is amended to say so and the number is not reused.
- **D-5324.** Review 568's F1: a `ccrc-sweep-window.test.ts` row pins that a unit absent from the pre-restart listing and listed active after it is VERIFIED, and that no D-5136 line names it (Task 13). Why: wave 16's corrected warnings and comment state that behaviour as shipped, and review 568 measured that a mutation verifying only units in `before` left the file 89 of 89 green.
- **D-5325.** Review 568's F2: `dispatch-live-gate.test.ts`' `REAL_BOUND_MS` drops to 10 000 ms, below the Linux `testTimeout` of 20 000 ms, so `untilParked`'s and the lock row's named errors surface before vitest's own timeout (Task 14). Every assertion stays byte-unchanged. Why: at 20 000 ms a regression reds only as `Test timed out in 20000ms`, and the body keeps running after `afterEach` restores real timers.
- **D-5326.** R36 (review 568 F4): `deploy/deploy.sh`'s `prune_backups` never removes this run's own `$TS` directory, by path: `grep -vxF -- '$TS'` between `head` and `xargs` on its remote command (Task 15). Why: `$TS` comes from the deploying machine's clock and `ccrc update`/`ccrc backup` name directories by the box's, so with the deploying machine behind and KEEP=1 the deploy's own directory sorted first and was pruned, and under #448 it holds the coordination snapshot. A by-path rule holds under any clock, as `_bak_gc`'s own-directory protection does; taking `TS` from the box was not chosen because it still trusts two clocks to agree. D1b's pinned substring changes, and the PR names it.
- **D-5327.** R35(d): `ccrc-darwin-job-helpers.test.ts`' J1 to J5, and any `itLinux.each` row that needs only bash and the shadowed `_svc_*` functions, become plain `it`, so the macOS leg runs them; J6 stays `itLinux` (it reads `/proc`) (Task 16). Why: wave 16's Reading 9 found that the helper cases gave the macOS leg nothing, and R35(d) was due once #444 landed.

## File structure

- `ccd/ccrc`:
  - `_inst_bins`: one placement line, one `api_bin` twin of `hist_bin`, the name in both closing echoes (Task 1, prototype applied).
  - `_uninst_tree_bins`: one `rm -f` operand, one prose paragraph, the name in the closing echo; `_uninst_wrappers`: the name in its one `case` line (Task 1, prototype applied).
  - The globals block beside `UPD_FAIL_PREFIX=""`: `UPD_SWEEP_WORD=""` (Task 2).
  - `_upd_phase`: the optional `sweep` key (Task 2).
  - `_upd_sweep_set_down` (new, before `_upd_sweep`); `_upd_sweep`: reset on entry; the word at each return, both arms, the Linux record read from `prior` (Tasks 2, 3); Task 10's hoist if ruled in.
  - `_upd_sweep_die`: `died: sweep` before its die (Task 2).
  - `_bak_removable` (new, beside `_bak_keepset`); `_bak_prune` and `_bak_gc` loops; `_bak_keepset`'s header (Task 6).
  - `_bak_list`: `[ ! -L "$d" ]`; its header, `_bak_keepset`'s "Links are counted" sentence and `_bak_gc`'s "count them" sentence (Task 7).
  - `_keep_ok`: the class, and its header's "the ONE validator" sentence (Task 8).
- `ccd/ccrc-doctor-checks`: `update-sweep` on the table's last line, before `docs-sw`; `_check_update-sweep` at the end (Task 4).
- `deploy/deploy.sh`: `prune_backups`' first regex token (Task 8); the `_svc_enable` comment (Task 9).
- `deploy/gen-wrappers.mjs`: `'ccrc-api'` in `TOOLCHAIN_EXECUTABLES` (Task 1, prototype applied).
- `server/test/install-census.test.ts`: one row in the deploy.sh describe (Task 1, prototype applied).
- `server/test/installTreeFixture.ts`: `'ccd/ccrc-api'` among the fixture sources (Task 1).
- `server/test/ccrc-install.test.ts`: the exact `.local/bin` sets, a byte-copy case, a server-role absence case (Task 1); `update-sweep` in the three `BASE_LIVE_SHAPE` blocks (Task 4); `head` in `pathWithout` and its rows (Task 5); two contained slices (Task 11).
- `server/test/ccrc-uninstall.test.ts`: the plant and the removal loop (Task 1).
- `server/test/ccrc-update.test.ts`: `REPORT_KEYS`' "seven keys in order" case and the `sweep` key rows (Tasks 2, 3); the pruner rows (Task 6); P18 reversed and the link rows (Task 7); the non-ASCII KEEP row (Task 8).
- `server/test/ccrc-doctor.test.ts`: one describe for `update-sweep` (Task 4); the contained `_box_role` and `_exp_env_write` spawns (Task 11).
- `server/test/raw-spawn-census.test.ts`: three entries removed, and the `_inst_installed` "no env" case rewritten (Task 11).
- `server/test/ccrc-sweep-window.test.ts` / `server/test/sweepFixture.ts`: Task 2's S rows if the worker puts them there; one describe (Task 10, if ruled in).
- `agent/test/deploy-verify.test.ts`: D1c's literal and a new D1d (Task 8); one comment (Task 9).

## Tasks

Task order follows the claims: Tasks 1, 2, 3, 5, 8 and 9 are claim group A and can start now (#444 has landed); Tasks 6 and 7 are group A too but wait for #448's `_bak_*`; Task 4 waits for claim 1557; Task 11 waits for #482. Every bash row below is a one-off script, copied from the Appendix into the worker's own scratch directory; each extracts the named functions from the file under test with `sed -n '/^<fn>() [{(]/,/^[})]$/p'` and `eval`s them under a `mktemp -d` HOME. None runs `ccrc` or `ccd` as a command.

### Task 1: `ccrc-api` placed by the install spine and removed by uninstall (W17-a; D-5313)

The prototype is applied in the projection (staged). Its four hunks are reproduced here so the worker can apply them to its own branch.

- [x] **Step 1: the red row.** In `server/test/install-census.test.ts`, inside the describe `deploy/deploy.sh, the fallback installer, places everything \`ccrc install\` places`, immediately BEFORE `it('every systemd unit file _inst_units places, deploy.sh places too (except DEPLOY_SH_WITHHOLDS.units)'` (never at the end of the file: #448 appends a describe after the "rides the release tarball" describe), add:

```ts
  // THE OTHER WAY, for binaries only (wave 17, D-5313): a name the fallback
  // deploy puts on PATH and the install spine does not is a file a box moved
  // only by `ccrc update` keeps at whatever version the last fallback deploy
  // left (`ccrc-api` was that name until wave 17). No exemption list: deploy.sh
  // places nothing under .local/bin that the spine should not.
  it('every binary deploy.sh places under .local/bin, _inst_bins places too (wave 17)', () => {
    const placed = placedBins();
    const deployed = deployPlacedBins();
    expect(deployed.size,
      'the deploy.sh `install_atomic` extractor found too few binaries under .local/bin — it has gone stale, unless deploy.sh really lost most of them')
      .toBeGreaterThan(BIN_FLOOR);
    expect([...deployed].filter((n) => !placed.has(n)).sort(),
      `these are placed under .local/bin by an \`install_atomic\` in ${DEPLOY_WHERE} and by no \`_inst_atomic\` `
      + `destination in _inst_bins, so a box moved only by \`ccrc update\` keeps whatever copy the last fallback deploy `
      + 'left, or none. Place them in _inst_bins (and remove them in _uninst_tree_bins).')
      .toEqual([]);
    expect(deployed, 'this reader no longer sees `ccrc-api` in deploy.sh — the row checks a set that lost its reason')
      .toContain('ccrc-api');
  });
```

Measured *(prototype, by the first drafter's vitest-free shim, at the projection without #441)*: this case FAILED naming `ccrc-api` before Step 2, and the five census describes (`id-shaped`, `install census and the uninstall`, `deploy.sh, the fallback`, `tracked in this repository`, `release tarball`) ran 17 passed, 0 failed after it. `deployPlacedBins`, `BIN_FLOOR` and `DEPLOY_WHERE` already exist in the file. Re-measure with vitest: `./node_modules/.bin/vitest run test/install-census.test.ts --pool=forks --maxWorkers=1` *(unmeasured: the worker measures it)*.
  - As built: `./node_modules/.bin/vitest run test/install-census.test.ts --pool=forks --maxWorkers=1` RED before Step 2: 1 failed (the new case), 25 passed, `expected [ 'ccrc-api' ] to deeply equal []`; GREEN after Steps 2-3: 26 passed. Inserted before the `every systemd unit file _inst_units places` case, as briefed.

- [x] **Step 2: the placement.** In `ccd/ccrc` `_inst_bins`, immediately after `_inst_atomic "$tree/ccd/ccd-account-auth" "$bin/ccd-account-auth" 755` (outside the one `if [ "$INST_ROLE" != server ]` block and outside the non-Darwin arm):

```bash
  # `ccrc-api`, the closed client every coordinator, worker and reviewer skill
  # calls for its mail, runs, claims and ledger (wave 17, D-5313), on BOTH arms
  # (it is portable: macos-platform.test.ts reads it in the GNU-call corpus)
  # and ROLE-gated by a ONE-LINE `||` test, the history sweep's shape below,
  # never a second `!= server` block (install-census.test.ts's gptGateBlock()
  # requires exactly one): its callers are sessions, and a server-role box
  # hosts none (D-3111). Until wave 17 the spine placed nothing here: a box
  # carrying README's link to the tree followed every update, an unlinked one
  # kept whatever copy the last fallback deploy left. On a linked box the source
  # IS the link's target, so `_inst_atomic`'s `cmp` branch keeps the link.
  # `_uninst_tree_bins` removes it on every role, as it does every name here.
  local api_bin=""
  [ "$INST_ROLE" = server ] || _inst_atomic "$tree/ccd/ccrc-api" "$bin/ccrc-api" 755
  [ "$INST_ROLE" = server ] || api_bin=", ccrc-api"
```

and in the two closing echoes, `ccd, ccd-account-auth${lane_bins}` (Darwin) becomes `ccd, ccd-account-auth${api_bin}${lane_bins}`, and `ccd-update-sync${hist_bin}${lane_bins}` (Linux) becomes `ccd-update-sync${hist_bin}${api_bin}${lane_bins}`.
  - As built: applied at base `d656d022a`'s `_inst_bins` as briefed; `bash -n ccd/ccrc` green. The closing echoes carry `${api_bin}` on both arms.

- [x] **Step 3: the removal and the id-shaped lists.** In `_uninst_tree_bins`: the `rm -f --` operand line `"$HOME/.local/bin/ccgpt-runtime" "$HOME/.local/bin/ccrc-codex" \` gains `"$HOME/.local/bin/ccrc-api"` before its `\`; the closing echo's `ccgpt-runtime, ccrc-codex and the ccrc launcher` becomes `ccgpt-runtime, ccrc-codex, ccrc-api and the ccrc launcher`; and after the paragraph that ends "so it is removed here on every role." (the history sweep's), add:

```bash
  #
  # `ccrc-api` (wave 17, D-5313), the closed client the role skills call, joins
  # on `ccd-history-sweep`'s terms: `_inst_bins` places it on both platform
  # arms and every role but server, so it is removed here on every role (a
  # no-op on a server box). Whatever is at the path goes, README's link to the
  # tree or a copy deploy.sh or the spine placed: each is ccrc's own file.
```

In `_uninst_wrappers`, the one `case "$name" in ccd|ccrc|…|ccgpt-runtime|ccrc-codex) continue ;; esac` line ends `|ccrc-codex|ccrc-api) continue ;; esac`. In `deploy/gen-wrappers.mjs`, `TOOLCHAIN_EXECUTABLES`' last line `'ccrc-codex', 'ccgpt-runtime']);` becomes:

```js
  'ccrc-codex', 'ccgpt-runtime',
  // The closed client the role skills call, placed by _inst_bins since wave 17 (D-5313).
  'ccrc-api']);
```
  - As built: applied as briefed. Deviation from the brief's anchor, not a ledger entry: this tree's `_uninst_tree_bins` has no paragraph ending "so it is removed here on every role." for the history sweep, so the new `ccrc-api` paragraph sits after the update-sync paragraph (the one ending "on every role."), before "THE ORDINALS ARE GONE".

- [x] **Step 4: the fixture source.** In `server/test/installTreeFixture.ts`, after `'ccd/history',`:

```ts
  // `ccrc-api` (wave 17, D-5313), placed by `_inst_bins` on both arms for every
  // role but server; without it `_inst_atomic` dies naming a source the tree
  // does not carry.
  'ccd/ccrc-api',
```

The first drafters' prototype missed this line *(prototype: applied in the projection by this draft)*. Without it every Linux install describe dies at `_inst_atomic` *(unmeasured: the worker measures it, by running `ccrc-install.test.ts -t 'ccd-history-sweep lands too'` with and without the line)*.
  - As built: measured. With the `'ccd/ccrc-api',` line removed, `ccrc-install.test.ts -t 'ccd-history-sweep lands too'` FAILED (`ENOENT … .local/bin/ccd-history-sweep`, the install died at `_inst_atomic`); with it, GREEN.

- [x] **Step 5: the rows a census cannot see** *(unmeasured: the worker measures each)*. In `server/test/ccrc-install.test.ts`:
  - the exact `.local/bin` sets (the Darwin list and the Linux list, beside the `history spec §9.5` comment): add `'ccrc-api'` in sorted position to both;
  - after `itLinux('ccd-history-sweep lands too (history spec §9.5) …'`, a case `it('ccrc-api lands too, a byte copy at 0755 on both arms (wave 17, D-5313)'` that installs into a fresh fixture HOME and asserts `readFileSync(join(home, '.local', 'bin', 'ccrc-api'))` equals `readFileSync(placed(home, 'ccd', 'ccrc-api'))`, `statSync(…).mode & 0o777` is `0o755`, and the closing line matches `/^install: bins: .*(?<![\w-])ccrc-api(?![\w-])/m`. It is `it`, not `itLinux`, because the placement is on both arms;
  - in the `--role server` case that asserts `--role server placed ccd-history-sweep` is false, add `expect(existsSync(join(home, '.local', 'bin', 'ccrc-api')), '--role server placed ccrc-api').toBe(false)` and, beside the server closing-line assertion, `.not.toContain('ccrc-api')`.
  - after the byte-copy case, `itLinux('ccrc-api: README\'s link to the tree survives an install, still a link to the tree file (wave 17, D-5313)'`: plant `symlinkSync(join(home, 'ccrc', 'ccd', 'ccrc-api'), join(home, '.local', 'bin', 'ccrc-api'))` (README's `ln -sfn` shape) in a fixture HOME whose `~/ccrc` the install places, run the install, and assert `lstatSync(…).isSymbolicLink()` is still true and `realpathSync(…)` equals `realpathSync(placed(home, 'ccd', 'ccrc-api'))` *(revised, unmeasured)*.
  In `server/test/ccrc-uninstall.test.ts`: `plantInstalledBox` plants `join(bin, 'ccrc-api')` as it plants the history sweep, the removal loop's name list gains `'ccrc-api'`, and one case plants it as a LINK into the fixture tree instead and asserts the link is gone and its target is untouched *(revised, unmeasured)*.
  - As built: all rows measured green. `ccrc-install.test.ts -t 'ccrc-api|ccd-history-sweep lands too|closing line names every executable'` 4 passed (byte copy at 0755 under umask 077, the link case, the history shim, the closing-line census); `-t 'role server is today|runs the wrapper converger'` 2 passed (the server-role absence, both exact `.local/bin` sets with `'ccrc-api'`). `ccrc-uninstall.test.ts` whole: 99 passed, 1 timeout under load (`every ENABLED instance of ccrc's usage template…`, 20000ms), green alone. The uninstall link case plants the link into the fixture tree as briefed; the verb removes `~/ccrc` first, so the link dangles when the census `rm -f` runs, and the case asserts it is gone and the closing line names `ccrc-api`. `gen-wrappers.test.ts` whole: 31 passed.

- [x] **Step 6: mutation rows** *(Step 1's row: prototype; the rest unmeasured: the worker measures them)*:

| Mutation | Expected red |
|---|---|
| delete the `_inst_atomic … ccrc-api` line | Step 1's row; the census "every binary the install spine places is removed" stays green (the uninstall side still names it, so `uninstall ⊆ install` reds instead); Step 5's byte-copy case |
| delete `"$HOME/.local/bin/ccrc-api"` from the `rm -f` list | install-census "every binary the install spine places is removed by the uninstall census"; the uninstall removal loop |
| delete `'ccrc-api'` from `TOOLCHAIN_EXECUTABLES` | install-census "the id-shaped executables" describe |
| delete `ccrc-api` from `_uninst_wrappers`' `case` | the same describe |
| drop the `[ "$INST_ROLE" = server ] \|\|` gate | Step 5's server-role case |
| move the line inside the `!= server` block | `gptGateBlock()`'s reservation case |
| replace `_inst_atomic`'s `cmp -s` branch by an unconditional copy (`cp`, `chmod`, `mv -f`) | Step 5's link case (the link becomes a regular file); every other row stays green, which is why the link case exists *(revised, unmeasured)* |
  - As built: every row measured RED then restored (`cmp` clean). M1 delete the `_inst_atomic` line: census 4 failed (`uninstall census removes nothing the install spine does not place`, the new deploy-vs-spine case, and both id-shaped cases), `every binary the install spine places is removed` stays green as predicted; install byte-copy case RED. M2 delete the `rm -f` operand: census `every binary the install spine places is removed by the uninstall census` RED; uninstall `the tree and the executables go…` RED. M3 delete the `TOOLCHAIN_EXECUTABLES` entry: census id-shaped case RED. M4 delete from `_uninst_wrappers`' `case`: census exclusion-case RED. M5 drop the `[ "$INST_ROLE" = server ] ||` gate: `--role server is today's spine…` RED. M6 move the line into the `!= server` block: census `both GPT_TOOLCHAIN_ACCOUNT_IDS mirrors…` RED and the `--role server` case RED (`gptGateBlock()`'s reservation case is that census row). M7 `_inst_atomic` without its `cmp` branch: the link case RED, `ccd-history-sweep lands too` stays green.

### Task 2: the update records its sweep (Reading 9's record half; W17-b; D-5314)

- [x] **Step 1: the red row** *(prototype)*. A bash row (B1) extracts `_upd_phase`, `_upd_redact`, `_upd_json_str`, `_tmp_guard` and `_upd_sweep_set_down` from `ccd/ccrc` (stubbing `_exit_add() { :; }`), sets `BOX_UPDATE_JSON` under a `mktemp -d` HOME, writes `_upd_phase restarting`, then `_upd_sweep_set_down claude-session@acct-a-demo.service claude-session@acct-b-demo.service` and `_upd_phase done`, and checks with `jq` that `.sweep == "down: 2: acct-a-demo acct-b-demo" and .detail == null` and that the first seven keys keep their order. Measured: RED before Step 2 (no `sweep` key), GREEN after; the restarting write carries no key. Output after:

```
unset: {"target":"v1.2.3","phase":"restarting","startedAt":…,"updatedAt":…,"detail":null,"from":"cli","pid":4242}
set:   {"target":"v1.2.3","phase":"done","startedAt":…,"updatedAt":…,"detail":null,"from":"cli","pid":4242,"sweep":"down: 2: acct-a-demo acct-b-demo"}
B1 GREEN
B1 order GREEN
```

  - As built: B1 (`b1.sh`, copied to the scratchpad, `TMPDIR=$HOME/.cc-tmp/w17q`) against the base `ccd/ccrc`: `set:` line carries no `sweep`, `B1 RED`, `B1 order GREEN`.

- [x] **Step 2: the global and the writer.** In `ccd/ccrc`'s globals, immediately after `UPD_FAIL_PREFIX=""      # "provenance: " …` (NOT beside `BAK_KEEP_SNAP`, which #448 edits):

```bash
UPD_SWEEP_WORD=""       # what `_upd_sweep` did, one word; `_upd_phase` writes it as update.json's `sweep` key while set (wave 17, D-5314)
```

In `_upd_phase`, the `local` line gains ` sw=""`; after `det="$(_upd_json_str "$detail")"`:

```bash
  # The sweep's record (wave 17, D-5314, D-5315): an ADDITIVE eighth key, written
  # only while `_upd_sweep` has set UPD_SWEEP_WORD, so it is absent on every
  # phase before the sweep, on every path that never swept, and in every report
  # an older build wrote. Absent means NOT MEASURED, never "nothing was down";
  # `ccrc doctor`'s update-sweep check reads it that way. The server's
  # `reportFrom` reads keys by name and ignores this one.
  [ -z "$UPD_SWEEP_WORD" ] || sw=",\"sweep\":$(_upd_json_str "$(_upd_redact "$UPD_SWEEP_WORD")")"
```

and the `printf` format's `"pid":%s}\n` becomes `"pid":%s%s}\n`, with `"$sw"` appended after `"${UPD_REPORT_PID:-$$}"`.

  - As built: applied as written, anchored by content (the global after `UPD_FAIL_PREFIX=""`, `_upd_phase`'s `sw` local, the `sw` build and the `%s` before `}` in its printf). Against the new file `b1.sh` prints `"sweep":"down: 2: acct-a-demo acct-b-demo"`, `B1 GREEN`, `B1 order GREEN`.

- [x] **Step 3: the word helper, the record and the die** *(prototype, revised: `bash -n ccd/ccrc` green; Appendix `b1.sh` B1 GREEN, `row-cap2.sh` CAP GREEN and `row-die.sh` DIE GREEN against the revised projection, CAP RED and DIE RED against the first prototype)*. Immediately before `_upd_sweep() {`:

```bash
# `_upd_sweep_set_down [<unit>...]` — sets UPD_SWEEP_WORD from the units the
# sweep found already `activating` or `failed` before its restart, whatever
# they read after it (Reading 9's doctor half, wave 17, D-5314): the sweep
# never verifies one of them, and one that reads `active` after try-restart is
# usually a crash-looping Type=simple unit caught between restarts. `ok` when
# there are none, else `down: <n>: <id> ...`, the COUNT first and WHOLE ids
# only, as many as fit in `_upd_json_str`'s 200 characters, so the report never
# carries a cut id that would read as a unit of its own. Ids are the unit names
# without `claude-session@` and `.service`.
_upd_sweep_set_down() {
  local u id word
  if [ "$#" -eq 0 ]; then UPD_SWEEP_WORD="ok"; return 0; fi
  word="down: $#:"
  for u in "$@"; do
    id="${u#claude-session@}"; id="${id%.service}"
    [ $(( ${#word} + 1 + ${#id} )) -le 200 ] || break
    word="$word $id"
  done
  UPD_SWEEP_WORD="$word"
}
```

and the first lines of `_upd_sweep`'s body:

```bash
  UPD_SWEEP_WORD=""   # wave 17, D-5314: set at each return below, and by `_upd_sweep_die` (`died: sweep`, D-5315)
  local -a down=()    # Darwin: the start-limit units the sweep skipped (Linux records `prior` itself)
```

Linux arm: wave 16's Reading 9 naming loop (`for ((pi = 0; arc == 0 && pi < ${#prior[@]}; pi++))`) stays BYTE-IDENTICAL to #444's (measured: `diff` of the loop against `git show eee9001f1:ccd/ccrc` is empty), because the record no longer depends on it. Immediately before `if [ "${#before[@]}" -eq 0 ]; then` (the zero line):

```bash
  # The record (wave 17, D-5314): every unit already `activating` or `failed`
  # before the restart, read from the PRE-restart listing, so it needs no
  # post-restart one (with `before` non-empty an unread one returned above).
  _upd_sweep_set_down ${prior[@]+"${prior[@]}"}
```

So a sweep with `before` empty and an unread post-restart listing records `ok` (nothing was live, nothing already down) or the `prior` units, never `unverified` over a box where nothing was restarted; the early DEGRADED fork (`[ "$arc" -ne 0 ] && [ "${#before[@]}" -gt 0 ]`) keeps `unverified: relist` (Task 3) for the case where something WAS restarted.

Darwin arm: in the `[ "$(_svc_is_active "$u")" = failed ]` loop, after the `is FAILED (start-limit stamp)` echo, `down+=("$u")` before `continue`; and before the arm's final `return 0` (after the `every live claude-session@ supervisor now runs …` / `no loaded claude-session@ supervisor` fork), `_upd_sweep_set_down ${down[@]+"${down[@]}"}`.

`_upd_sweep_die`, as its first line:

```bash
  UPD_SWEEP_WORD="died: sweep"   # R10k's record of a die (wave 17, D-5315): the failed report carries it; the detail says where
```

It is set before the report-ownership check, so a die whose report another run now owns writes nothing, as today.

  - As built: applied as written, `bash -n ccd/ccrc` green; the Reading 9 naming loop is untouched. `row-cap2.sh`: RED on the base (`_upd_sweep_set_down: command not found`, `CAP RED`), GREEN after (`len=198 stored-last=acct-9-project-alpha`, `CAP GREEN`); `row-die.sh`: base `DIE RED`, after `DIE GREEN` (`"sweep":"died: sweep"`). The Darwin arm records `down+=("$u")` and calls `_upd_sweep_set_down` before its final `return 0`.

- [x] **Step 4: the rows through a real update** *(unmeasured: the worker measures each)*. First the pin that CHANGES: `ccrc-update.test.ts`' `const REPORT_KEYS = ['target', 'phase', 'startedAt', 'updatedAt', 'detail', 'from', 'pid']` and the case `it('a moving run, a converged no-op and a refusal together write every wired phase, each by rename, seven keys in order …'`, which asserts `for (const l of raw) expect(Object.keys(JSON.parse(l) as object)).toEqual(REPORT_KEYS)` over every write of the `moved` box. That box sweeps (`restarting`, then `done`), so after this task its `done` line carries `sweep`. The case becomes: every write before the sweep keeps exactly `REPORT_KEYS`; every write after it is exactly `[...REPORT_KEYS, 'sweep']`, order asserted; the converged no-op and the refusal keep `REPORT_KEYS`. Its title's "seven keys in order", `REPORT_KEYS`' doc comment ("The seven keys, in the writer's order (D-3237 adds `pid`)") and that note gain "and an eighth, `sweep`, after a sweep (wave 17, D-5314)". The PR body names this pin beside P18 and D1c. Before that, widen the search for other whole-key pins: `grep -n "Object.keys(\|REPORT_KEYS\|toEqual({ target\|JSON.parse(readFileSync(.*update.json" server/test/*.test.ts`; the other two found by the reviser (`ccrc-update.test.ts`' watchdog rewrite in a fresh process, and `update-intent-cross-side.test.ts`' bare `_upd_phase`) never sweep and hold. Then, in `server/test/ccrc-sweep-window.test.ts` (with `sweepFixture.ts`) or `ccrc-update.test.ts` (the worker picks the file whose sweep fixture already plants a pre-restart `failed` unit: wave 16's Reading 9 rows do), on the Linux arm:
  - S1: a clean sweep's `done` report carries `sweep: 'ok'` and `detail: null`;
  - S2: wave 16's plant (one unit `failed` before and after) yields `sweep: 'down: 1: <id>'`, exit and stderr exactly as wave 16 pins them;
  - S2b: one unit `activating` before the restart and `active` after (wave 16's `pback` plant) yields `sweep: 'down: 1: <id>'`, not `ok`;
  - S3: a converged no-op (`already converged at …`) and the gate-failure restore write no `sweep` key (`expect(Object.keys(report)).not.toContain('sweep')`);
  - S4: a sweep whose verify fails its re-check (an existing die row's plant) writes `phase: 'failed'`, the die sentence as `detail`, and `sweep: 'died: sweep'`;
  - S5: `before` empty, one `prior` unit, and the post-restart listing failing: `sweep: 'down: 1: <id>'`; `before` and `prior` both empty with the same failure: `sweep: 'ok'`.

  - As built: the rows are in `server/test/ccrc-sweep-window.test.ts` (new describe `the sweep records what it did in update.json`, S1, S2, S2b, S2c, S4 as W5's extra assertion plus its own case, S5, S5b, S6; the shell writes `_upd_phase done` after the sweep via `tail`) and `ccrc-update.test.ts` (the `REPORT_KEYS` case now asserts seven keys on every write but the moved box's `done`, which is `[...REPORT_KEYS, 'sweep']`, exactly one write carries it, the converged no-op has no `sweep`; the restore and the refusal keep seven; the moved box's `sweep` is `refused: killmode` on Linux, its stub systemd answering no KillMode). RED on the base: all 9 new/changed sweep-window cases and the 7 update cases fail on `sweep` undefined; GREEN: 9 of 9 (`-t 'records what it did|W5 the die'`), ccrc-sweep-window whole 97 of 97 (42 s), ccrc-update `-t 'sweep|update.json|rollback'` 191 passed plus 2 failures: `_upd_phase redacts its OWN detail argument` (its extracted-function harness runs `set -u` and needs `UPD_SWEEP_WORD=""`, fixed in the harness) and one load flake (`killed-flip … control (condition 3)`, green on re-run alone). S3's no-op row is in the `REPORT_KEYS` case; the gate-failure restore is covered by the same loop (seven keys exactly).

- [x] **Step 5: mutation rows.** Drop `"$sw"` from the printf (prototype: B1 RED). Make `_upd_sweep_set_down` write `ok` for a non-empty list (S2 reds; unmeasured). Restore the unbounded append (prototype: `row-cap2.sh` CAP RED). Drop the `died: sweep` line (prototype: `row-die.sh` DIE RED; S4 reds, unmeasured). Feed the record from the not-active-after set instead of `prior` (S2b reds; unmeasured). Drop the `UPD_SWEEP_WORD=""` reset at the top of `_upd_sweep` (a rollback after a refused update in one shell would carry the old word; unmeasured, and only a row that runs two sweeps in one shell can see it, so the worker states whether such a row is cheap or records the reset as unpinned).

  - As built: measured on the sweep-window rows (describe plus W5): drop `"$sw"` from the printf, B1 RED and 9 of 9 rows red; `_upd_sweep_set_down` writing `ok` for a non-empty list, `b1.sh` B1 RED and rows S2, S2b, S2c, S5 red; unbounded append restored, `row-cap2.sh` `CAP RED` (`len=264 stored-last=a`); fix round 1 adds the shipped row, `ccrc-update.test.ts`'s `_upd_sweep_set_down keeps the recorded word within 200 characters …` (twelve long ids through the real `_upd_phase`; asserts `down: 12:`, length <= 200, every named id whole and in input order): green, and RED with the cap line deleted (`-t '_upd_sweep_set_down keeps the recorded word'`, 1 failed, the stored word carrying all twelve ids), `ccd/ccrc` restored and `cmp` clean; `died: sweep` line dropped, `DIE RED` and rows W5, S4 red; the record fed from the `failed` set instead of `prior`, rows S2b, S2c, S5 red. **The reset row is UNPINNED:** dropping `UPD_SWEEP_WORD=""` at the top of `_upd_sweep` leaves all 9 rows green, because every return path of `_upd_sweep` (four refusals/unverified, the Linux final `_upd_sweep_set_down`, the Darwin arm's refusal and final call) sets the word and the die exits, so no row can see a stale word; the reset is defence for a future return path that forgets to set one.

### Task 3: a refused or unverified sweep is recorded (R10k; W17-c; D-5315)

- [x] **Step 1: the change** *(prototype; `bash -n` green)*. Immediately before the `return 0` that follows each DEGRADED line in `_upd_sweep`, anchored by that line's text:

| DEGRADED line's text (anchor) | Added line |
|---|---|
| `Fix the job files above (ccd start <id> rewrites each)` (Darwin) | `      UPD_SWEEP_WORD="refused: job-file"   # R10k, D-5315` |
| `Once systemctl --user list-units 'claude-session@*' answers, confirm KillMode` | `    UPD_SWEEP_WORD="refused: listing"   # R10k, D-5315` |
| `Fix the KillMode above, then: systemctl --user try-restart` | `      UPD_SWEEP_WORD="refused: killmode"   # R10k, D-5315` |
| `every live claude-session@ supervisor was restarted, and none of them was verified by this sweep.` | `    UPD_SWEEP_WORD="unverified: relist"   # R10k, D-5315` |

The exit code, stdout, stderr and `phase: done`/`detail: null` stay exactly as pinned (review 196 item 1 holds).

  - As built: the four lines applied by anchor; `bash -n` green.

- [x] **Step 2: rows** *(revised, unmeasured: the worker measures each)*. In `server/test/ccrc-update.test.ts`, find each case by its stderr or stdout text, never by line number:
  - `refused: listing`: the case `itLinux('(a) the unfiltered pre-sweep listing fails — the sweep is REFUSED, not the old zero line …'` (the one whose comment reads "The refusal is the KillMode refusal's own exit code and update.json —"; it asserts the `list-units … failed (rc 93)` stderr and the "Once systemctl --user list-units … answers" DEGRADED line). Its `toMatchObject({ phase: 'done', detail: null, from: 'cli' })` stays and a second assertion adds `expect(report.sweep).toBe('refused: listing')`. The same on `itLinux('(a) on a rollback BY FLIP: the unfiltered pre-sweep listing fails …'`.
  - `refused: killmode`: the cases whose stderr matches `sweep REFUSED — claude-session@alpha\.service resolves to KillMode=control-group` (`'with KillMode not process, the rollback\'s sweep is REFUSED …'` and `'a rollback BY FLIP\'s sweep is behind its own KillMode=process preflight …'`; both are rollbacks). Add one on the UPDATE path if the worker finds none.
  - `unverified: relist`: the case asserting `update: DEGRADED: every live claude-session@ supervisor was restarted, and none of them was verified by this sweep.`
  - The Darwin job-file refusal is pinned by a fixture-only row if `ccrc-darwin-job-helpers.test.ts`' harness can force the Darwin arm on Linux; otherwise it is the macOS leg's, and the plan's as-built note says which.

  - As built: `ccrc-update.test.ts`: `refused: listing` asserted in both (a) cases (update and rollback by flip; `phase: done`, `detail: null` kept); `refused: killmode` in both rollback cases, in a NEW update-path case (no drop-in; `the update's sweep REFUSED over KillMode is recorded`) and in the `REPORT_KEYS` case; `unverified: relist` in case (b) and in sweep-window S6. The Darwin job-file row is a fixture-only row after all: `ccrc-darwin-job-helpers.test.ts` forces `CCD_OS=darwin` on Linux with the job lookups shadowed (new describe D1 `refused: job-file`, D2 `down: 1: acct-b-demo`, D3 `ok`; base RED 3 of 3, GREEN 3 of 3). Side fix the plan did not name: `ccrc-sweep-deliberate-stop.test.ts` X0c pinned the tree's `_upd_phase` as v0.0.84's, so v0.0.84's copy is now frozen below the sweep in `fixtures/upd-sweep-pre-wave11.bash` (that fixture's own instruction) and X0c reads it from there; 8 of 8 green.

- [x] **Step 3: mutation rows** *(unmeasured)*: delete each added line in turn; its row reds, the others stay green.

  - As built: each added line deleted in turn, `ccrc-update` six-case group plus S6: `refused: listing` red in 2 (both (a) cases); `refused: killmode` red in 4 (update-path case, `REPORT_KEYS` case, both rollback cases); `unverified: relist` red in case (b) and S6; `refused: job-file` red in D1 only; the Darwin `down+=("$u")` line red in D2 only, and the Darwin final `_upd_sweep_set_down` red in D2 and D3. The others stayed green each time.

### Task 4: `ccrc doctor` WARNs on the record, and never FAILs (Reading 9's doctor half, R10k's reader; W17-b, W17-c; D-5316)

**Waits for claim 1557 (run 433) to end, or for its consent through the coordinator.** Rebase onto #448's `ccd/ccrc-doctor-checks` first: #448 adds `_check_delegation-hooks` and puts `delegation-hooks` on the same table line.

- [ ] **Step 1: the red rows** *(prototype, revised)*. The Appendix's `dr2.sh <file carrying the function> <ccrc>` defines printing `_dr_*` stubs, sources the file, extracts `_upd_report_readable` and `_plat_size` from `ccd/ccrc`, stubs `_svc_is_active` (`acct-b-demo` answers `failed`, `acct-c-demo` answers EMPTY, the manager not answering; `acct-d-demo` answers `activating`; every other id `active`), and runs `_check_update-sweep` over planted reports:

| Row | Planted `update.json` | Expected |
|---|---|---|
| D1 | absent | SKIP, rc 3 |
| D2 | phase `installing` | SKIP "not a final one" |
| D2b | phase `restarting`, pid `999999999` (no such process) | WARN, rc 2, "is gone" |
| D2c | phase `restarting`, pid of the live row script | SKIP "restarting its supervisors now" |
| D3 | phase `done`, no `sweep` key | SKIP "not measured" |
| D4 | `sweep: "ok"` | PASS |
| D5 | `down: 2: acct-a-demo acct-b-demo` | WARN, rc 2, "still not active: acct-b-demo (failed) —" |
| D6 | `down: 1: acct-a-demo` | PASS "at this read" |
| D7 | `down: 3: acct-a-demo acct-b-demo` (an older or hand-cut word) | WARN "names 2 of 3" |
| D8 | `refused: killmode` | WARN "REFUSED (killmode)" |
| D8b | `refused: listing` | WARN, remedy "clears at the next ccrc update or rollback" |
| D9 | `unverified: relist` | WARN "no supervisor", and never "restarted every" |
| D10 | `later-word` | SKIP "not one this build knows" |
| D11 | not JSON | SKIP "does not parse" |
| D12 | (structural) the function body | no `_dr_fail`, no `return 1` |
| D13 | `down: 1: acct-c-demo` (the manager does not answer) | SKIP "did not answer"; never WARN |
| D14 | `down: 2: acct-b-demo acct-c-demo` | WARN on acct-b-demo, acct-c-demo named only as "not measured (the service manager did not answer)", never as still down |
| D15 | `down: 1: acct-d-demo` | WARN "acct-d-demo (activating)", the manager's word quoted |
| D16 | phase `failed`, `sweep: "died: sweep"` | WARN "died partway" |

Measured against the revised function: all nineteen GREEN (`fails=0`), in the projection's `ccd/ccrc-doctor-checks` with its real `_dr_*` and in the extracted function with stubs. Against the FIRST prototype's function (`git show 3317a7f1b:ccd/ccrc-doctor-checks`): D2, D2b, D2c, D5, D6, D8b, D9, D13, D14, D15 and D16 RED (eleven), which is what this revision changed; D2, D5, D6 and D9 red there on reworded text, the other seven on behaviour.

- [ ] **Step 2: the table entry.** The table's last line (`models codex docs history docs-sw   # five entries …` on `main`; `models codex docs history delegation-hooks docs-sw   # six entries …` on #448) gains `update-sweep` BEFORE `docs-sw`, which stays last, and its comment counts one more entry and adds `_check_update-sweep is at the END of this file`. No line is added or removed. On the projection (`main`'s side) it reads:

```bash
  models codex docs history update-sweep docs-sw   # six entries on one line: every line below is cited by number elsewhere; docs-sw stays LAST (M7.6); _check_update-sweep is at the END of this file
```

- [ ] **Step 3: the check** *(prototype, revised: applied in the projection; `bash -n` green; Step 1's rows)*, appended at the END of `ccd/ccrc-doctor-checks` (after #448's `_check_delegation-hooks` once it lands):

```bash
# ── update-sweep: the last update's supervisor sweep, as its report recorded it ──
# Reading 9's doctor half (the operator, 2026-10-15: warn only) and R10k (wave 17,
# D-5316). `ccrc update` and `ccrc rollback` record what their supervisor sweep did
# as update.json's `sweep` key (D-5314, D-5315): `ok`, `down: <n>: <id> ...`,
# `refused: <why>`, `unverified: <why>` or `died: <why>`. This check reads that
# record and NEVER FAILS, by the operator's ruling (warn only): a FAIL would turn a
# state the update already recorded and reported into exit 1 for every bare
# `ccrc doctor` and `ccrc install`, and into exit 3 with a changed detail for every
# later update. Inside an update's own install tail the report is that run's
# in-flight one, so this check SKIPs there. An ABSENT key is NOT MEASURED (a build
# before wave 17 wrote the report, a converged no-op wrote it, or the run stopped
# before its sweep), never "nothing was down". Nothing here, or anywhere, re-sweeps:
# a recorded refusal is reported until the next update or rollback writes a new report.
_check_update-sweep() {
  if ! declare -F _upd_report_readable >/dev/null 2>&1 || ! declare -F _svc_is_active >/dev/null 2>&1 \
     || [ -z "${BOX_UPDATE_JSON:-}" ]; then
    _dr_skip update-sweep "ccrc's own report reader is not loaded, so the last update's sweep was not read (a bug in ccrc: this table was sourced by something that is not ccrc)"
    return 3
  fi
  local rrc=0 line phase pid word rest n id ans cut="" fix clears
  local -a ids=() still=() unasked=()
  clears="; this WARN clears at the next ccrc update or rollback, which writes a new report"
  _upd_report_readable || rrc=$?
  case "$rrc" in
    0) ;;
    1) _dr_skip update-sweep "no update report on this box (~/.ccrc/update.json is absent), so there is no sweep to read"; return 3 ;;
    *) _dr_skip update-sweep "~/.ccrc/update.json is not a readable regular file under its size cap, so the last sweep was not read"; return 3 ;;
  esac
  if ! command -v jq >/dev/null 2>&1; then
    _dr_skip update-sweep "jq is not on PATH, so ~/.ccrc/update.json was not read"; return 3
  fi
  line="$(jq -r 'if type != "object" then "?" else "\(.phase // "")\t\(.pid // "")\t\(.sweep // "")" end' "$BOX_UPDATE_JSON" 2>/dev/null)" || line="?"
  if [[ "$line" != *$'\t'*$'\t'* ]]; then
    _dr_skip update-sweep "~/.ccrc/update.json does not parse as one report, so the last sweep was not read"; return 3
  fi
  phase="${line%%$'\t'*}"; rest="${line#*$'\t'}"; pid="${rest%%$'\t'*}"; word="${rest#*$'\t'}"
  case "$phase" in
    done|failed|reverted) ;;
    restarting)
      # The one phase the sweep runs in. Its updater released the lock before it,
      # so an updater killed here (OOM, SIGKILL) leaves `restarting` for good on a
      # box with no watchdog. A live pid is a sweep in flight; a dead one is not.
      if [[ "$pid" =~ ^[123456789][0123456789]{0,9}$ ]] && ! kill -0 "$pid" 2>/dev/null; then
        _dr_warn update-sweep "the last update's report stopped at phase 'restarting' and its updater (pid $pid) is gone, so its supervisor sweep's outcome was never recorded: some supervisors may run the previous ccd" \
          "ccrc status lists each session's state; restart any that is not running with ccd start <id>${clears}"
        return 2
      fi
      _dr_skip update-sweep "the last update is restarting its supervisors now (updater pid ${pid//[![:print:]]/?}), so its sweep has not been recorded yet"; return 3 ;;
    *) _dr_skip update-sweep "the last update's report is at phase '${phase//[![:print:]]/?}', not a final one, so no sweep has been recorded"; return 3 ;;
  esac
  if [ -z "$word" ]; then
    _dr_skip update-sweep "the last update's report (phase $phase) records no sweep: an older build wrote it, it moved nothing, or it stopped before its sweep — not measured"
    return 3
  fi
  case "$word" in
    ok)
      _dr_pass update-sweep "the last update's sweep found no supervisor already activating or failed before its restart"
      return 0 ;;
    'down: '*)
      rest="${word#down: }"; n="${rest%%:*}"; rest="${rest#*:}"
      [[ "$n" =~ ^[0123456789]{1,4}$ ]] || { _dr_skip update-sweep "the last report's sweep word does not parse ('${word:0:60}'), so it was not read"; return 3; }
      for id in $rest; do
        [[ "$id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] && ids+=("$id")
      done
      [ "${#ids[@]}" -ge "$((10#$n))" ] || cut=" (the report names ${#ids[@]} of $((10#$n)); the rest did not fit in it)"
      # The bus defaults the `services` check sets, for the same reason: each check
      # runs in its own `$( )`, so that check's exports never reach this one, and
      # without them every unit answers EMPTY from a non-interactive context.
      if [ "${CCD_OS:-linux}" != darwin ]; then
        : "${XDG_RUNTIME_DIR:=/run/user/$UID}"; export XDG_RUNTIME_DIR
        : "${DBUS_SESSION_BUS_ADDRESS:=unix:path=${XDG_RUNTIME_DIR}/bus}"; export DBUS_SESSION_BUS_ADDRESS
      fi
      # THREE answers, never two (`_svc_is_active`'s own header): `active`; EMPTY,
      # the manager did not answer, which is NOT the unit is down; or the manager's
      # own word, quoted back, because `failed` and `inactive` send an operator to
      # two different places.
      for id in ${ids[@]+"${ids[@]}"}; do
        ans="$(_svc_is_active "claude-session@$id.service")"
        case "$ans" in
          active) ;;
          '') unasked+=("$id") ;;
          *) still+=("$id (${ans//[![:print:]]/?})") ;;
        esac
      done
      if [ "${#still[@]}" -eq 0 ] && [ "${#unasked[@]}" -gt 0 ]; then
        _dr_skip update-sweep "the service manager did not answer for ${unasked[*]}, one of the ${#ids[@]} supervisor(s) the last update found already down before its restart${cut} — not measured"
        return 3
      fi
      if [ "${#still[@]}" -eq 0 ]; then
        _dr_pass update-sweep "the ${#ids[@]} supervisor(s) the last update found already down before its restart read active at this read${cut} (one read: a unit that crash-loops can read active between its restarts)"
        return 0
      fi
      if [ "${CCD_OS:-}" = darwin ]; then fix="ccd start <id> for each (it clears the start-limit stamp and re-bootstraps the job)"
      else fix="systemctl --user reset-failed claude-session@<id>.service, then ccd start <id>; read: systemctl --user status claude-session@<id>.service"; fi
      [ "${#unasked[@]}" -eq 0 ] || cut="$cut; not measured (the service manager did not answer): ${unasked[*]}"
      _dr_warn update-sweep "${#still[@]} supervisor(s) were already down before the last update's restart and are still not active: ${still[*]}${cut} — the update did not verify them and did not fail for them" "$fix"
      return 2 ;;
    'refused: '*)
      case "${word#refused: }" in
        listing) fix="once systemctl --user list-units 'claude-session@*' answers, confirm KillMode=process on each unit, then: systemctl --user try-restart 'claude-session@*'" ;;
        killmode) fix="set KillMode=process (a drop-in under the unit directory's claude-session@.service.d/ can), then: systemctl --user try-restart 'claude-session@*'" ;;
        job-file) fix="ccd start <id> rewrites each session's job file; then restart each: launchctl kickstart -k <domain>/<label>" ;;
        *) fix="read the update's own output for the refusal, fix what it names, then restart the supervisors" ;;
      esac
      _dr_warn update-sweep "the last update's supervisor sweep was REFUSED (${word#refused: }), so every live claude-session@ supervisor still ran the ccd it ran before that update; nothing re-sweeps" "${fix}${clears}"
      return 2 ;;
    'unverified: '*)
      _dr_warn update-sweep "the last update's post-restart listing was not read (${word#unverified: }), so no supervisor's state after its restart is known" \
        "ccrc status lists each session's state; restart any that is not running with ccd start <id>${clears}"
      return 2 ;;
    'died: '*)
      _dr_warn update-sweep "the last update's supervisor sweep died partway (${word#died: }; the report's detail says where), so some supervisors may run the previous ccd and the rest the new one" \
        "read the detail in ~/.ccrc/update.json and follow its read: line; ccrc status lists each session's state${clears}"
      return 2 ;;
    *)
      _dr_skip update-sweep "the last report's sweep word is not one this build knows ('${word:0:60}'), so it was not read"
      return 3 ;;
  esac
}
```

The guard SKIPs where `_check_build`'s FAILs: this check may never FAIL, whatever loaded it.

- [ ] **Step 4: the suite rows** *(unmeasured: the worker measures each)*. In `server/test/ccrc-doctor.test.ts`, one describe `update-sweep: the last update's sweep, read from its report, WARN never FAIL (wave 17, D-5316)` carrying D1 to D16 against the real `cmd_doctor` through `healthy()` and `runDoctor` (planting `$HOME/.ccrc/update.json`; the `down` rows plant a fixture `systemctl` that answers `is-active` per unit, or the file's existing unit-state fixture), plus: `cmd_doctor` exits 0 with a WARN on D5 (a WARN never changes doctor's exit). The table-vs-function parity case and the docs-sw-last case pass unchanged. In `server/test/ccrc-install.test.ts`, the three `BASE_LIVE_SHAPE` maps are a MEASURED golden, "never hand-edited" (its own header): the worker RE-MEASURES them through that header's Step 3 MEASURE procedure on a disposable `git archive` copy of the landing tip, expects `"update-sweep": "SKIP"` in each (an install has no `update.json`, so the install-tail doctor SKIPs) and nothing else to move, and appends the matching paragraph, "RE-MEASURED again when doctor gained its `update-sweep` check (wave 17, D-5316): nothing else moved", beside the `docs-sw`, `server-caps` and earlier ones *(revised, unmeasured)*. The `down` rows' fixture `systemctl` answers `is-active` per unit and answers EMPTY for one unit (D13).

- [ ] **Step 5: mutation rows** *(prototype, revised: by `dr2.sh` over a `sed`-mutated copy of the revised function)*:

| Mutation | Measured red |
|---|---|
| the EMPTY answer is counted as still down (`'') still+=` ) | D13, D14 |
| the dead-pid arm is dropped (`&& false`) | D2b |
| the `died:` arm is dropped | D16 |
| a non-`active` word is read as back | D5, D7, D14, D15 |
| one `_dr_warn` becomes `_dr_fail` | D8, D8b, D12 |
| the absent-key arm answers PASS | D3 *(first prototype's measurement; the arm is unchanged)* |
| the phase gate accepts every phase | D2 *(first prototype's measurement; the arm is unchanged)* |

The bus-default lines cannot red under the `_svc_is_active` stub; the worker's suite row with a fixture `systemctl` that answers only when `XDG_RUNTIME_DIR` is set measures them, or records them as unpinned *(unmeasured)*.

### Task 5: `pathWithout` carries `head` (R8f; W17-d; D-5317)

- [x] **Step 1: the red row** *(unmeasured: the worker measures it)*. The helper is `server/test/ccrc-install.test.ts`' `function pathWithout(home, missing)`; the two other helpers of that name (`ccrc-uninstall.test.ts`, `ccrc-codex.test.ts`) link the whole parent PATH and already have `head`. Add, beside the existing `pathWithout` cases:
  - H1: `pathWithout(home, 'git')` returns a PATH whose first directory holds a `head` that resolves to an executable, and `pathWithout(home, 'head')`'s does not;
  - H2: an install from a fixture git checkout tagged `v9.9.9`, run with `PATH: pathWithout(home, 'rsync')` or the least-disruptive missing tool the existing cases use, writes a stamp whose `version` is `v9.9.9`.
  The defect itself was measured at planning by a bash row: a PATH of `git` and `grep` only, no `head`, over a repository tagged `v1.2.3` gave `version=[]` and `head: command not found`; with `head` linked, `version=[v1.2.3]`.
  - As built: H1 and H2 are in `describe('ccrc install: the build stamp')`, before `says dirty`. H1 reads the farm directory (the second PATH entry; the first is `~/.local/bin`) and checks `head` resolves to an executable. H2 uses `pathWithout(home, 'nothing-is-missing')` (a name no farm entry carries, so the whole farm is linked; `rsync` would refuse the install) over a fixture checkout tagged `v9.9.9`. Note: the stamp's tag read is `_inst_stamp`'s, not `_inst_stamp_shipped`'s.

- [x] **Step 2: the change** *(prototype: applied in the projection)*. In the list `for (const b of ['mkdir', 'cp', …`, after `'ln', 'readlink', SHA256_TOOL,`:

```ts
    // `head` (wave 17 R8f, D-5317): `_inst_stamp_shipped` reads the release tag
    // as `git tag --points-at HEAD | grep -E … | head -n1`, so a farm without it
    // stamps no `version` at all, silently, in every case built on this list.
    'head',
```

- [x] **Step 3: mutation row** *(unmeasured)*: delete `'head'`; H1 and H2 red.
  - As built: with the `'head',` line deleted, `ccrc-install.test.ts -t 'H1:|H2:'` 2 failed (321 skipped; H2 at the stamp-line assertion); restored with `cp`, `cmp` clean; `-t 'H1:|H2:|the build stamp'` 12 passed.

### Task 6: one spelling of the removal filter (R14(a); W17-e; D-5318)

Written against #448's `_bak_prune` and `_bak_gc` (five clauses each, `BAK_KEEP_DATA` included), which the projection carries.

- [ ] **Step 1: the red rows** *(prototype)*. A bash row `e1.sh <ccrc>`: E1 (structural) both `_bak_prune` and `_bak_gc` contain `_bak_removable "$d" || continue` and neither contains `[ "$d" = "$BAK_KEEP_`; E2 (behavioural) `_bak_removable` over eight names with `UPD_BAK_FLOOR=20250110-000000`, the own dir `20250109`, the snapshot keep `20250102`, the data keep `20250103` and the tree keep `20250104` answers removable for exactly `20250101 20250105`; E3 an unparsable floor answers not removable. Measured: E1 RED (four lines) and E2 RED (no function) before Step 2; E1, E2, E3 GREEN after.

- [ ] **Step 2: the change** *(prototype)*. After `_bak_keepset`'s closing brace:

```bash
# `_bak_removable <dir>` — rc 0 when a pruner may remove <dir>, rc 1 when it
# must keep it (R14(a), D-5318): the ONE spelling of the removal filter that
# `_bak_prune` and `_bak_gc` apply after `_bak_keepset` has chosen the keeps.
# Kept: this run's own backup dir, every dir named at or after this run's
# lock time, and the three keeps. It reads UPD_BAK_FLOOR itself (the callers'
# locals are not its to read) and fails CLOSED: an unparsable floor keeps
# everything, though both callers refuse before their loop anyway.
_bak_removable() {
  local d="$1" name="${1##*/}" floor
  [[ "$UPD_BAK_FLOOR" =~ ^[0-9]{8}-[0-9]{6}$ ]] || return 1
  floor=$((10#${UPD_BAK_FLOOR//-/}))
  [ "$d" = "$UPD_BACKUP_DIR" ] && return 1
  [ "$((10#${name//-/}))" -ge "$floor" ] && return 1
  [ "$d" = "$BAK_KEEP_SNAP" ] && return 1
  [ "$d" = "$BAK_KEEP_DATA" ] && return 1
  [ "$d" = "$BAK_KEEP_TREE" ] && return 1
  return 0
}
```

In `_bak_prune`'s loop, `d="${BAK_DIRS[$i]}"; name="${d##*/}"` and the five `[ … ] && continue` lines become `d="${BAK_DIRS[$i]}"` and `_bak_removable "$d" || continue`; its `local floor=$((10#${UPD_BAK_FLOOR//-/})) n=${#BAK_DIRS[@]} i d name` becomes `local n=${#BAK_DIRS[@]} i d`. In `_bak_gc`'s loop the same, with the call carrying `# D-3593's own-dir and floor clauses live there now`, and its `local` line becomes `local n=${#BAK_DIRS[@]} i d shown rc=0`. `_bak_keepset`'s header sentence "is written twice, once in each pruner's loop, and nothing pins the two copies to each other." becomes "is spelled ONCE, in `_bak_removable` below (R14(a), D-5318), and both pruners' loops call it." `bash -n` green.

- [ ] **Step 3: the suite rows** *(unmeasured: the worker measures each)*. In `ccrc-update.test.ts`, beside `it('_bak_gc and _bak_prune each call _bak_keepset, …'`, E1 as a source-reading case; and a differential case: one fixture backups root with own, floor, snapshot, data and tree keeps, pruned once by `ccrc backup --prune` and once by an update's `_bak_gc` (fresh copies), leaves the identical set. #448's existing data-snapshot keep rows run unchanged in both pruners.

- [ ] **Step 4: mutation rows** *(prototype, by `e1.sh`)*: delete the `BAK_KEEP_DATA` clause: E2 RED; delete the floor clause: E2 RED; delete the own-dir clause: E2 RED; replace the floor guard by `floor=0`: E2 RED. With the helper in place one deletion reds BOTH pruners' rows at once, which the two copies could not.

### Task 7: a link is never a backup (R10i; W17-f; D-5319)

- [ ] **Step 1: the red row** *(prototype)*. A bash row `f1.sh <ccrc>` evals `BAK_TS_PAT` and `_bak_list`, plants under a fixture `ccrc-backups/` a real `20250101-000000/server-dist`, a link `20250102-000000` to a directory outside it that holds `server-dist`, and a plain file `20250103-000000`, and runs `_bak_list`. Measured before: `listed: 20250101-000000 20250102-000000` (RED: the link is listed); after Step 2: `listed: 20250101-000000` (GREEN).

- [ ] **Step 2: the change** *(prototype)*. In `_bak_list`, `[ -d "$d" ] && BAK_DIRS+=("$d")` becomes:

```bash
    # A link is never a backup (R10i, D-5319): `[ -d ]` follows one, so a
    # timestamp-named link was counted in the newest-N window and could hold a
    # keep through its target. `_ver_list` applies the same rule to versions.
    { [ -d "$d" ] && [ ! -L "$d" ]; } && BAK_DIRS+=("$d")
```

and `_bak_keepset`'s header "Links are counted as `_bak_list` counts them (R10i, deferred)." becomes "A link is never a backup: `_bak_list` lists none (R10i, D-5319)." `_bak_gc`'s header, whose newest-N clause reads "counted as `ccrc backup` and deploy.sh count them", becomes "counted as `ccrc backup` counts them (a link is never a backup, D-5319; deploy.sh's remote prune still counts links and plain files, Reading 6)" *(revised, unmeasured; a comment, re-wrapped to the file's width)*; if the coordinator rules Reading 6's option 1 in, the clause reads "counted as `ccrc backup` and deploy.sh count them (neither counts a link, D-5319)" instead.

- [ ] **Step 3: P18 reversed, and two rows** *(unmeasured: the worker measures each)*. `it('P18: a timestamp-named symlink is pruned as a link, its target untouched; …'` becomes `it('P18: a timestamp-named symlink is not a backup: never listed, never pruned, its target untouched; a timestamp-named plain file is not a backup and survives (R10i reversed, D-5319)'`: the link and the file both survive, the target is untouched. P18b: a PLAIN real backup (no `server-dist`, no `agent-dist`, none of the four snapshot names) OLDER than a timestamp-named link to a plain target, pruned at `CCRC_BACKUP_KEEP=1` through the sourced harness `ccrc-update.test.ts` already uses (`. "$1"; UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; CCRC_BACKUP_KEEP=1; _bak_prune`), so no other dir is listed: the real one is kept, the link and its target stay. A real TREE backup would not do: `_bak_keepset` would pick it as `BAK_KEEP_TREE` whatever the newest-N slot does, so that shape is green before the change and cannot red (PK1). Through a full update or rollback instead, KEEP must be the number of real dirs newer than the link plus one, since the run's own backup and the prior move's hold slots too. *(prototype, revised: Appendix `row-p18b.sh`, P18b GREEN on the projection, RED with `[ ! -L "$d" ]` dropped: `_bak_prune` removed `20250101-000000` and left only the link.)* P18c: a link whose target holds `server-dist`, newer than a real tree backup outside the newest-N window: the real one stays protected as the tree keep.

- [ ] **Step 4: mutation row** *(prototype)*: drop `[ ! -L "$d" ]`: F1 RED, and `row-p18b.sh` RED *(prototype, revised)*. P18 and P18c red, and P18b's suite form *(unmeasured)*; the worker measures each red before Step 2, as well as under the dropped test.

### Task 8: both KEEP spellings accept ASCII digits only (R34; W17-g; D-5320)

Rebase onto #444's final head first: `deploy/deploy.sh`'s KEEP test exists only there (D-5142), and its all-zeros refusal (D-5144) shares the line.

- [x] **Step 1: the red rows** *(prototype)*. G1, a bash row: under `LC_ALL=en_US.UTF-8`, first measure the premise (`[[ $'\xd9\xa3' =~ ^[0-9]{1,4}$ ]]` accepts, else SKIP), then `_keep_ok` must refuse `U+0663`, `7U+0663` and `U+FF15`, accept `0 7 0002 9999`, refuse `10000`. Measured before: `G1 RED: [٣] [7٣] [５]`; after: `G1 GREEN`. D1d's bash prototype, `prune_backups` extracted from `deploy/deploy.sh` with an `ssh_stub` recorder, `CCRC_BACKUP_KEEP=U+0663` under `en_US.UTF-8`. Measured before: `rc=0`, and the remote command it SENT carried `head -n -٣`; after: `rc=1`, nothing sent, `deploy: warning: CCRC_BACKUP_KEEP='٣' is not a whole number from 0 to 9999 — nothing pruned`.
  - As built: premise measured first, `locale -a` lists `en_US.utf8`, and `[[ $'\xd9\xa3' =~ ^[0-9]{1,4}$ ]]` accepts under `LC_ALL=en_US.UTF-8` here, so G1/D1d/D1d-suite/P11b all RAN (none skipped on this box). Scripts copied from the Appendix to the scratchpad. RED before: `bash g1.sh ccd/ccrc` gave `G1 RED: [٣] [7٣] [５]`; `bash d1d.sh deploy/deploy.sh` gave `rc=0` with the sent remote command carrying `head -n -٣`. The suite RED (tests written first, code untouched): `vitest run test/deploy-verify.test.ts` 10 failed, 103 passed; D1c `expected '^[0-9]{1,4}$' to be '^[0123456789]{1,4}$'`, D1d x3 `expected +0 to be 1`, D3d `the deploy's own backup was pruned`, D1b x4 and D3b on the changed pin.

- [x] **Step 2: the change** *(prototype)*. `ccd/ccrc`: `_keep_ok() { [[ "$1" =~ ^[0-9]{1,4}$ ]]; }` becomes `_keep_ok() { [[ "$1" =~ ^[0123456789]{1,4}$ ]]; }`; its header's first sentence becomes "the ONE validator for every KEEP knob in this file (review 179 F6; D-3423; `deploy/deploy.sh`'s `prune_backups` spells the same DIGIT test a second time on purpose, held equal by deploy-verify's D1c, D-5142; deploy.sh alone also refuses an all-zeros KEEP, because its remote prune has no keeps, D-5144, wave 17's Reading 4)" *(revised, unmeasured: a comment; "held equal" names the digit class only, so no reader "fixes" one side's zero rule to match the other)*, and after "no value that long can overflow anything." it adds:

```bash
# The class is ENUMERATED, `[0123456789]`, never
# the range `[0-9]`: under a UTF-8 locale bash's `=~` range accepts non-ASCII
# decimal digits (U+0663, U+FF15), which then fail as an arithmetic error
# instead of this sentence (R34, D-5320); the enumeration needs no locale.
```

`deploy/deploy.sh` `prune_backups`' first statement: ONLY the first token changes, `[[ "$keep" =~ ^[0-9]{1,4}$ ]] ||` becomes `[[ "$keep" =~ ^[0123456789]{1,4}$ ]] ||`; `! [[ "$keep" =~ ^0+$ ]]` and the trailing comment stay byte-identical, and the line keeps its place. `bash -n` green on both.
  - As built: applied as briefed; deploy.sh's first token only (`! [[ "$keep" =~ ^0+$ ]]` and the trailing comment byte-identical, line 242 keeps its place); `bash -n` green on both. GREEN after: `G1 GREEN`; `d1d.sh` gave `rc=1 sent=[]` and `deploy: warning: CCRC_BACKUP_KEEP='٣' is not a whole number from 0 to 9999 — nothing pruned`. The header comment adds 6 lines to `ccd/ccrc` (comment lines only).

- [x] **Step 3: the suite rows** *(unmeasured: the worker measures each)*. `agent/test/deploy-verify.test.ts`: D1c's literal `expect(ours![1]).toBe('^[0-9]{1,4}$')` becomes `'^[0123456789]{1,4}$'` (its first regex still finds the first test on the line, not the all-zeros one); `runPrune` takes an optional second argument `locale: NodeJS.ProcessEnv = { LANG: 'C' }` spread into its env in place of `LANG: 'C'`; and after D1c:

```ts
  // R34 (wave 17, D-5320): under a UTF-8 locale bash's `=~` RANGE `[0-9]` accepts non-ASCII decimal digits, and
  // deploy.sh then SENT `head -n -<U+0663>` to the box (measured at planning: rc 0, the remote command carried it).
  // The class is enumerated now. The row measures its own premise first: where this bash and locale do not
  // reproduce the range (C.UTF-8, a box without en_US.UTF-8, BSD regcomp), it skips with the reason, never passes.
  const UTF8 = { LC_ALL: 'en_US.UTF-8' };
  const rangeAccepts = spawnSync('bash', ['-c', `[[ $'\\xd9\\xa3' =~ ^[0-9]{1,4}$ ]]`], { env: { ...UTF8, PATH: process.env.PATH ?? '' } }).status === 0;
  it.skipIf(!rangeAccepts).each([['٣'], ['7٣'], ['５']])(
    'D1d: CCRC_BACKUP_KEEP=%j (a non-ASCII digit) is refused under en_US.UTF-8: one warning, rc 1, nothing sent (D-5320)', (keep) => {
      const r = runPrune(keep, UTF8);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/^deploy: warning: CCRC_BACKUP_KEEP='.*' is not a whole number from 0 to 9999 — nothing pruned\n$/);
      expect(r.remote, 'the prune reached the box').toBeNull();
      expect(r.poison, 'a real ssh or scp was reached').toBe('');
    }, 30_000);
```

The worker checks that the CI image has `en_US.UTF-8` (if not, the row skips there and the plan's as-built note says so; the bash prototype is then its only measurement on Linux). `server/test/ccrc-update.test.ts`, beside `P11: a bad CCRC_BACKUP_KEEP (%s) only WARNs and prunes nothing`: P11b, the same assertion for `U+0663` under `LC_ALL: 'en_US.UTF-8'`, with the same premise guard.
  - As built: applied as briefed (`runPrune`'s second argument, D1c literal, D1d, P11b beside P11 with the same premise guard, `spawnSync(BASH, …)` in `server/test/ccrc-update.test.ts`). Pins changed: D1c's literal is now `'^[0123456789]{1,4}$'`; D1b's substring (and D3b's, which pinned the same line) is now `| sort | head -n -<n> | grep -vxF -- '<TS>' | xargs -r rm -rf --` (Task 15), so `runPrune` and `runPruneOnDisk` set `TS=` in the extracted script (a fixed stand-in, as `deploy.sh` sets it before `prune_backups`). GREEN: `deploy-verify.test.ts` whole 113 passed; `ccrc-update.test.ts -t P11` 3 passed (P11 x2, P11b). The CI image's locale was not measured from here: where `en_US.UTF-8` is absent D1d and P11b skip on their own premise guard, and G1/d1d.sh are then the only measurement.

- [x] **Step 4: mutation rows.** Restore `[0-9]` in `_keep_ok` (prototype: G1 RED; D1c RED on the token mismatch, unmeasured). Restore it in deploy.sh (D1c and D1d RED, unmeasured).
  - As built: `_keep_ok` back to `[0-9]`: `deploy-verify -t 'D1|D3'` 1 failed (D1c), and `ccrc-update -t P11` 1 failed (P11b: the run went past the refusal and stopped at the sweep's KillMode refusal, rc != 0). deploy.sh's token back to `[0-9]`: 4 failed (D1c, D1d x3). Each restored with `cp` from a saved copy, `cmp` clean.

### Task 9: R25(a)'s code-comment half (W17-h; D-5321)

Measured at planning: the projection, which includes #441 (`97493f9b2`), still carries both stale lines, so #441 does not carry this, and it stays in this wave.

- [x] **Step 1: the change** *(prototype)*. `deploy/deploy.sh`: `# sounds like containment and is not: \`ccd\`'s own \`_svc_enable\`/` becomes `… \`ccd\`'s own \`_svc_enable_now\`/` (the next line, `# \`_svc_disable_now\` reload on the next session start or stop, …`, is unchanged). `agent/test/deploy-verify.test.ts`: `// \`_svc_enable\`/\`_svc_disable_now\` reload on the next session start or` becomes `// \`_svc_enable_now\`/\`_svc_disable_now\` reload on the next session start or`. Since #441, `_svc_enable` is `systemctl --user enable --no-reload`; `_svc_enable_now` and `_svc_disable_now` still reload.
  - As built: both comment lines changed as briefed.

- [x] **Step 2: the check.** No row can red: these are comments. `git diff` shows two comment lines only; `bash -n deploy/deploy.sh` green *(prototype)*.
  - As built: `git diff` shows the two comment lines; `bash -n deploy/deploy.sh` green.

### Task 10 (only if the coordinator rules Reading 5 in): the naming loops run before a die (R32; W17-j; D-5323)

- [x] **Step 1: the red row** *(unmeasured: the worker measures it)*. In `server/test/ccrc-sweep-window.test.ts`, a new `itLinux` case: one unit fails its verify and its re-check, AND another was `failed` before the restart and is still failed; stderr names BOTH (wave 16's "was already 'failed' before try-restart" line or item 3's FAILED line for the second) BEFORE the die line, exit 1. Before the change only the die line names a unit. First `grep` the die rows for any whole-stderr `toBe` (extra lines before a die would red them) and for `.not.toMatch(/was already/)`.
  - As built: row `W24h` (describe wave 16's, beside W24a to W24f): `churn(B)` dies; a unit `failed` before and gone after (Reading 9's line); a unit active before and in neither post-restart listing (item G's line); both lines asserted BEFORE the die line, die line whole via `dieOf`. Item 3's FAILED line was not usable: it already prints before the die. RED before the move (`expected -1 to be greater than -1`, Reading 9's line absent from stderr), GREEN after. Pin audit: no die row pins a whole stderr or `.not.toMatch(/was already/)`; the `ccrc-update.test.ts` `was active before try-restart` negatives are all exit-0 rows; no pin changed.

- [x] **Step 2: the change** *(unmeasured)*. Move item G's loop (`local b a seen` / `for b in ${before[@]+…}`) and wave 16's Reading 9 loop (`for ((pi = 0; arc == 0 …`), byte-unchanged, from below the `if [ -n "$rfail" ]; then _upd_sweep_die …` block to just above it (after `after=(${units[@]+"${units[@]}"})`). Both read only state computed before the die. Since the revision, Task 2 leaves the Reading 9 loop byte-identical to #444's (the record reads `prior` directly), so nothing of Task 2 moves with it; Task 2's record line stays below the die block, and a die records `died: sweep` through `_upd_sweep_die` (D-5315). Net lines 0.
  - As built: both loops moved byte-identical (extracted loop text `cmp` clean before and after) to just above the `if [ -n "$rfail" ]` die block, after `after=(...)`; the record line and the zero line stay below it. `bash -n` green, `ccd/ccrc` 24145 lines before and after.

- [x] **Step 3: mutation row** *(unmeasured)*: move the loops back; Step 1's row reds.
  - As built: the pre-move file restored over `ccd/ccrc`: `W24h` RED (`expected -1 to be greater than -1`), `W24g` green; restored, `cmp` clean.

### Task 11: the four spawns R35(b) names run contained (W17-i; D-5322)

**Waits for #482** (`server/test/raw-spawn-census.test.ts`, claim 1564). Re-read #482's landed `ALLOWED` and `SLICED_ALLOWED` first.

- [ ] **Step 1: the changes** *(unmeasured: the worker measures them)*. Import `ccrcContainedEnv` from `./ccrcContainment.js` in `ccrc-doctor.test.ts` and `ccrc-install.test.ts` where it is not yet imported.
  - `ccrc-doctor.test.ts`, describe `_box_role never asserts a state it did not measure`: one EMPTY `mkTmp('ccrc-doctor-boxrole-')` home for the describe (`_box_role` reads only the preset `BOX_UNITS` array, so keep it empty), and `roleFor`'s env becomes `ccrcContainedEnv(roleHome, process.env, { managers: true, curl: 'poison' })`.
  - `ccrc-doctor.test.ts`, the `_exp_env_write` slice run once per exposure arm (`it("the fixture's exposure.env carries CCRC_AUTH=on on every arm, …"`): its spawn's env becomes `ccrcContainedEnv(<its fixture HOME>, process.env, { managers: true, curl: 'poison' })`.
  - `ccrc-install.test.ts`, `it('_ver_newer agrees with sort -V on a fixture list, …'`: the `_ver_newer` spawn (not the `sort -V` reference spawn, which runs no slice) gets `env: ccrcContainedEnv(mkTmp('ccrc-install-vernewer-'), process.env, { managers: true, curl: 'poison' })`.
  - `ccrc-install.test.ts`, `it('_inst_installed: a write that fails right after creating the temp file …'`: the harness spawn gets `env: { ...ccrcContainedEnv(<its fixture HOME>, process.env, { managers: true, curl: 'poison' }), CCRC_UPDATE_VERIFIED: process.env.CCRC_UPDATE_VERIFIED, CCRC_UPDATE_SPINE: process.env.CCRC_UPDATE_SPINE }` only if the case relies on them; the worker reads the harness and passes exactly what it reads (an `undefined` value must be omitted, not passed).
  - `raw-spawn-census.test.ts`: delete the `ALLOWED` entry for `server/test/ccrc-doctor.test.ts`, and the `SLICED_ALLOWED` entries for `server/test/ccrc-doctor.test.ts` and `server/test/ccrc-install.test.ts`, in the same commit (the census pins both lists both ways, so a stale entry reds). If `ALLOWED` becomes empty, keep the `Map` and whatever non-empty floor or anti-vacuity row the file carries for it; the worker reads #482's text for that.
  - `raw-spawn-census.test.ts`, the case `it('decides the function-extraction spawn R14(b) named by rule: no env, and it runs sliced text, not the script'`: it finds the `_inst_installed` harness spawn (`/\['-c', harness\]/` within 30 lines of `/^_inst_installed\(\) \{`) and asserts `expect(inst[0]!.shape, 'it has no env').toBe('no env')`, so it reds once that spawn carries `ccrcContainedEnv` (the census's `BUILDER` regex makes a builder env not bare). In the SAME commit, rewrite it to pin the harness as CONTAINED: still found (`inst.length === 1`, the anti-vacuity), its kind still `'sliced'`, its shape `null` (contained), and absent from `c.slicedHits`; retitle it accordingly ("… by rule: contained (ccrcContainedEnv), and it runs sliced text, not the script (wave 17, D-5322)").
  `managers: true` because none of the four is a spine builder (the header's reason for `false` does not apply), and a stray `systemctl` must hit a poison.

- [ ] **Step 2: rows.** `raw-spawn-census.test.ts` green with the entries gone; each of the four cases green under the builder *(unmeasured)*.

- [ ] **Step 3: mutation rows** *(unmeasured)*: revert one spawn to its bare env; the census reds naming the file and count. Revert the `_inst_installed` harness to no env: the rewritten R14(b) case AND the `SLICED_ALLOWED` pin both red.

### Task 13: a unit absent before the restart is verified, pinned (review 568 F1; D-5324)

Group A. The behaviour is shipped (#444); this task adds the pin, so its red is the mutation's.

- [x] **Step 1: the row** *(unmeasured: the worker measures it)*. In `server/test/ccrc-sweep-window.test.ts`, a new `itLinux` row beside W24a to W24f (`W24g`): the pre-restart listing (`fixture-sweep-active`) does NOT list unit X and the post-restart one lists X active. Assert that X was verified (the file's own count of verify calls for X, as review 568 phrased it, `count(box, act(X)) >= 1`) and that no stderr line names X with "was already" or "was active before".
  - As built: `W24g` added before W24d (`preRestart: null`, `listed: 'active'`): `count(box, act(X)) >= 1`, and no stderr line naming X carries `was already` or `was active before`. GREEN as is.
- [x] **Step 2: the mutation row** *(unmeasured)*. In `_upd_sweep`, restrict the line that adds post-restart units to `units` (the `units+=` beside the comment "absent from that listing, or shown in any other state, is still verified") to units found in `before`: W24g reds, and the rest of the file stays green. Restore with `cp`, `cmp` clean.
  - As built: `else units+=("$u")` replaced by a loop that adds `$u` only when it is in `before`: whole `ccrc-sweep-window.test.ts` 1 failed (`W24g`), 98 passed; restored, `cmp` clean. Whole file on the restored tree: 99 passed.

### Task 14: `dispatch-live-gate`'s real bound sits below the test timeout (review 568 F2; D-5325)

Group A. Test-only; `server/test/dispatch-live-gate.test.ts` joins this wave's files.

- [ ] **Step 1: the change** *(unmeasured)*. `const REAL_BOUND_MS = 20_000;` becomes `10_000`, with a one-line comment: below `server/vitest.config.ts`' Linux `testTimeout` (20 000 ms), so a named error surfaces before vitest's timeout. Every assertion stays byte-unchanged. If a row legitimately needs more real time (the slow-io row carries its own 60 000 ms timeout), give that row its own bound argument; never raise the shared one back.
- [ ] **Step 2: the check** *(unmeasured)*. Plant a wedge once (the smallest temporary edit that keeps the route from parking, for example `untilParked`'s predicate never true) and record that the run reds with the named error ("neither parked on a timer nor settled") rather than `Test timed out in 20000ms`; restore and `cmp`. Then the file green three times running, one run at a time, with the load recorded.

### Task 15: `deploy.sh`'s prune keeps this run's own directory (R36; D-5326)

Group A. Shares `prune_backups`' two remote lines with Task 7 Step 5; both stay line-neutral, and #444's line 242 stays byte-identical.

- [x] **Step 1: the red row** *(unmeasured: the worker measures it)*. In `agent/test/deploy-verify.test.ts`, beside D3 and D3b, a row D3d: the fixture backups directory holds a box-clock directory `20250102-000000` and the deploy's own `$TS` directory `20250101-230000` (the deploying machine's clock behind the box's), with KEEP=1. Before the change the deploy's own directory is removed: RED.
  - As built: D3d added after D3b (box-clock directory `20250102-000000`, own `$TS` `20250101-230000`, KEEP=1); `runPruneOnDisk` takes optional `dirs` and `ts`. RED before the change: `the deploy's own backup was pruned: expected [ '20250102-000000', …(1) ] to deeply equal [ '20250101-230000', …(2) ]`.
- [x] **Step 2: the change** *(unmeasured)*. On the remote command's last line, `| sort | head -n -$keep | xargs -r rm -rf --"` becomes `| sort | head -n -$keep | grep -vxF -- '$TS' | xargs -r rm -rf --"`. `$TS` expands on the deploying machine (digits and one dash), inside single quotes on the box. With no candidates left, `grep` exits 1 and `xargs -r` runs nothing, so the pipeline's status stays `xargs`'s 0. D3d goes green; D3 x3 and D3b stay green (in the ordinary case `$TS` is the newest and is never among `head`'s output); D1b's pinned substring changes, and the PR names that pin.
  - As built: last remote line only; the lister line is untouched and the change is line-neutral. `TS` is set once, at the top level, by `TS="$(date +%Y%m%d-%H%M%S)"` (digits and one dash), so it is safe inside single quotes on the box. GREEN: deploy-verify whole, 113 passed. D1b's pinned substring changed (see Task 8 Step 3); the PR names that pin and D1c's literal.
- [x] **Step 3: the mutation row** *(unmeasured)*: remove the `grep`; D3d reds and nothing else.
  - As built: with the `grep` removed, `-t 'D1|D3'` failed 6: D3d, and also D1b x4 and D3b, because their pins now name the `grep`, so the brief's "D3d reds and nothing else" holds only for the on-disk behaviour: D3d is the only row that reds on behaviour, the other five on the pinned text. Restored, `cmp` clean.

### Task 16: the Darwin job helpers' bash-only cases run on macOS (R35(d); D-5327)

Group A. `server/test/ccrc-darwin-job-helpers.test.ts` joins this wave's files.

- [ ] **Step 1: the read** *(unmeasured)*. For each of J1 to J5 and the `itLinux.each` table, read what it reaches in `sweepFixture.ts` and `ccd/ccrc`; a case that reaches `/proc`, a GNU-only option (`macos-platform.test.ts`' GNU-call corpus is the reference) or `setsid` stays `itLinux`, with the reason in its comment.
- [ ] **Step 2: the change** *(unmeasured)*. The rest become plain `it`; J6 stays `itLinux`. The file's header comment, which says `sweepFixture.ts` has never run on the macOS leg, is updated to say which cases now do.
- [ ] **Step 3: the proof.** Linux green, one run. The macOS proof is a dispatched full run: name it in the wave-done; the coordinator triggers it (`gh workflow run ci.yml --ref <branch> -f mode=full`) and reads `test-macos`. The worker runs no `gh` writes.

### Task 12: The gate and the PR

- [ ] **Step 1: the landing tip.** `git fetch origin main`; confirm by the landed-check (`gh pr view <n> --json state,mergeCommit`, or `git log origin/main --grep '(#<n>)'`; never sha ancestry, since main squash-merges) which of #448, #482 and #441 have landed (#444 is `13f11b696`), and wait for any a task depends on; absorb `origin/main` (rebase local commits before the first push, merge after it), re-anchor every hunk by content in the landed text, and re-run `bash -n ccd/ccrc ccd/ccrc-doctor-checks deploy/deploy.sh`.

- [ ] **Step 2: the bash rows**, the Appendix's scripts as written (`b1.sh`, `row-cap2.sh`, `row-die.sh`, `dr2.sh`, `e1.sh`, `f1.sh`, `row-p18b.sh`, `g1.sh`, `d1d.sh`, and `row-pk2.sh` if Reading 6's option 1 is ruled in), against the landing tip, each with its mutation rows; paste their output into this plan's as-built note.

- [ ] **Step 3: the touched suites, ONE file at a time,** foreground, under the memory rule (Global Constraints), from `server/`: `install-census`, `ccrc-install`, `ccrc-uninstall`, `gen-wrappers`, `ccrc-api-ship`, `macos-platform`, `ccrc-update`, `ccrc-sweep-window`, `ccrc-darwin-job-helpers`, `ccrc-doctor`, `raw-spawn-census`, `ccrc-containment`, `update-inventory`, `dispatch-live-gate` (Task 14), `ccrc-darwin-job-helpers` (Task 16); from `agent/`: `deploy-verify`. Each as `./node_modules/.bin/vitest run test/<one>.test.ts --pool=forks --maxWorkers=1`. A red in a known load-flake file is re-run in isolation before it is called a break.
  **When the memory gate or the 600-second call cap stops a file** (the three largest, `ccrc-doctor`, `ccrc-update` and `ccrc-install`, run to thousands of lines each; a foreground call past its timeout keeps running and overlaps the next): run that file per touched describe instead, `-t '<describe>'`, naming each describe in the as-built note (Task 1's three `ccrc-install` describes and the `ccrc-uninstall` removal describe; Task 2's `REPORT_KEYS` case and S rows; Task 3's refusal cases; Task 4's `update-sweep` describe, the table-parity and docs-sw-last cases and the `BASE_LIVE_SHAPE` case; Task 5's `pathWithout` cases; Tasks 6 to 8's pruner and KEEP cases; Task 11's four cases). The arbiter for every file not run whole is CI: push, read the PR's `select tests` summary, and confirm it lists each touched file (a `ccd/ccrc` change selects widely); for one it does not list, ask the coordinator for a full run (`workflow_dispatch`, `mode=full`). The wave-done's `suite:` line is ONE word: `green` only when every touched file ran whole and green locally, `red` when any ran red, otherwise `unrun`, never omitted; every row left unmeasured, and every file run only by describe, is listed in the as-built note.

- [ ] **Step 4: the ledger and repo guards** at the landing tip: `topology-clean`, `deviation-refs` (after `git fetch origin main`), `dtbd`, `single-definition` and `typecheck-tests`, one file at a time. `deviation-refs` must show every number this plan defines, 5313 to 5323 and any reserve number (5328 to 5332) the worker spent, defined once, here, and no other plan defining them; 5324 to 5327 stay undefined unless the coordinator defines them.

- [ ] **Step 5: the PR.** One PR from the workspace branch. Its body: what each task changed and why, the pins that change, named as such (P18, reversed; D1c's literal; `REPORT_KEYS`' "seven keys in order" case; the raw-spawn census's R14(b) "no env" case; `BASE_LIVE_SHAPE`, re-measured), and the one that holds (review 196's `detail: null` on a refused sweep), the claims waited on, the measured rows, and the Readings' rulings. Public repo: noreply identity, no hosts, home paths, lane or account names, no private repo, ticket or Linear references; GitHub `#n` only. Ends with the attribution line the session's instructions give.

## Readings (for the coordinator to rule; each was chosen where no ruling decided it)

1. **`ccrc-api` off server-role boxes (Task 1).** Chosen: every role but server, by the history sweep's one-line gate. Its callers are sessions and their role skills, which a server-role box does not host (D-3111: a server-role box converges nothing per account), `deploy.sh` places it in the agent lane only, and `_inst_files` and `_inst_skills` already skip server. The alternative is every role; `_uninst_tree_bins` removes it on every role either way.
2. **`unverified: relist` joins R10k (Task 3).** Chosen: yes. R10k names the refusals; the post-restart listing left unread is the same invisibility (every supervisor restarted, none verified) and costs one line.
3. **The server's inventory and `sweep` (Not in this wave).** Chosen: leave `GET /api/updates` as it is in this wave. `reportFrom` reads keys by name and ignores `sweep`, so nothing breaks and nothing shows. Carrying it later is a server wave: one reader in `inventory.ts`, an optional wire field (additive, absence-permits, no `FLEET_PROTO` bump), and an absent key read as "not measured" there too. The coordinator may instead rule it into this wave, which would add `server/src/update/` files and their tests.
4. **`_keep_ok` and `KEEP=0` (wave 16's plan left it to this wave).** Chosen: NO, `_keep_ok` keeps accepting `0`. deploy.sh refuses an all-zeros KEEP because its remote prune has no protections, so `0` would remove every backup. `ccrc`'s pruners always keep this run's own backup, everything at or after the floor and the three keeps, and `_ver_gc` keeps the live and the previous tree (the worker re-reads `_ver_gc` and confirms before relying on this), so `0` there means "keep only what is protected". The two spellings stay equal in their digit class (D1c), not in their zero rule, and D1c compares only the first regex token.
5. **R32: the naming loops before a die (Task 10).** Chosen: include, for the stderr NAMING. It is a pure move of two loops (net lines 0) that read only state computed before the die, with one new row. The RECORD half did fit cheaply after all and is in Task 2, not here: `_upd_sweep_die` sets `died: sweep` before its die, the `failed` report carries it, and the doctor's phase gate already reads `failed` reports, so one arm (D16) WARNs on it. The units a died sweep found already down are not recorded beside the die word (the word is one class); the coordinator may rule a `died: <n>: <ids>` shape in. The coordinator rules Task 10 in or out; D-5323 is defined either way and says which.
6. **deploy.sh's remote prune counts links (R10i's shape).** The harm, measured (Appendix `row-pk2.sh`): its `ls -d [0-9]… | sort | head -n -$keep | xargs -r rm -rf --` lists a timestamp-named link (or plain file), so a NEWER one holds a newest-N slot and a real backup is removed in its place (a real `20250101-000000` and a link `20250102-000000` at KEEP=1 left only the link; the link's target was untouched). It has no keeps, but the newest-N window is exactly D-5319's first harm. Option 1, line-neutral, inside the quoted remote command: replace `ls -d <pattern> 2>/dev/null \` by `for d in <pattern>; do [ -d \"\$d\" ] && [ ! -L \"\$d\" ] && printf '%s\n' \"\$d\"; done \` (the `\$d` escapes keep the variable for the box). It keeps D1b's `| sort | head -n -N | xargs -r rm -rf --` substring and D3's on-disk rows, measured: the same plant at KEEP=1 left both, and three real dirs at KEEP=2 still removed the oldest. It adds a D3c row (a newer link at KEEP=1) that reds before the change, and `deploy-verify.test.ts` and `deploy.sh` join this wave's files. Option 2: leave it, for the honest reason (it is the fallback installer only, and this wave's scope is `ccrc`'s own pruners), kept as residue with this harm named. Chosen: option 2, so this wave's files stay as listed; option 1 is measured and costs one line and one row, and the coordinator may rule it in, which adds `deploy/deploy.sh`'s remote prune line and D3c to Task 7.
7. **Other `[0-9]` validators in `ccd/ccrc`.** `_upd_sweep`'s `CCRC_SWEEP_VERIFY_JOBS` test (`^[1-9][0-9]{0,3}$`) shares R34's class, as do many `=~ ^[0-9]+$` tests elsewhere in the file. Chosen: leave them to a residue item. R34 names the KEEP check, which is pinned equal across two files; a sweep of every range in the file is a separate, larger change, and most of those values come from the box's own files, not from an operator's environment.
8. **Item G's units in the record.** A unit that was ACTIVE before the restart and is neither active nor failed after it is named on stderr ("this sweep did not verify it") but is not Reading 9's class. Chosen: not recorded in this wave. The coordinator may rule a third word class (`unverified: <n>: <ids>`) in; it would be one more `down`-shaped array and one doctor arm.
9. **`_bak_removable` and `_bak_keepset`'s own-dir and floor pair.** Chosen: not shared. `_bak_keepset` skips the same pair in its selection loop; folding it into a `_bak_protected` would edit #448's larger rewrite for no behaviour change.
10. **"The last update" is literal.** A converged no-op after a WARN-worthy update writes `done` with no `sweep` key, and the check then SKIPs. Chosen: accept it and say so in the SKIP text. The alternative, carrying the last swept word across later reports, makes `update.json` a history, which it is not.
11. **The ledger's row 17** says wave 15 "adds R25(a)'s code-comment half". Measured: #441 does not carry it (Task 9). The coordinator may correct the row; this plan keeps the item.
12. **One `active` read as "back" (Task 4's `down` arm).** A crash-looping unit can read `active` between restarts, and the sweep itself refuses to trust one read. Chosen: the PASS says "read active at this read (one read: …)" and stays a PASS. The alternative is a stability test on Linux, `systemctl --user show -p ActiveState -p NRestarts --value claude-session@<id>.service`, PASSing only on `active` with `NRestarts` 0 (systemd counts automatic restarts since the last explicit start, which the update's try-restart was) and WARNing "active at this read, but restarted <n> times by its manager since"; Darwin keeps the one read. It costs one `show` per recorded unit and a fixture answer; the coordinator may rule it in.
13. **A refused or unverified WARN that cannot clear before the next update (Task 4).** Chosen: the remedy says "this WARN clears at the next ccrc update or rollback". The alternative re-measures: read each live `claude-session@` unit's start time (`systemctl --user show -p ActiveEnterTimestamp --timestamp=unix`, which needs systemd 248 or later), and PASS when every one started after the report's `updatedAt`, meaning each now runs the new `ccd`; Darwin keeps the WARN. The coordinator may rule it in; it adds a systemd-version arm and fixture answers.
14. **A dead updater at `restarting` WARNs (Task 4's D2b).** Chosen: WARN, confined to `restarting`, the one phase the sweep runs in (the lock is already released there, and a fleet-role box has no watchdog to close the report). Every other non-final phase SKIPs, because `queued` records the detaching parent's pid, which exits at once. A recycled pid reads as alive, so the arm can only under-report. The alternative is SKIP with the same true text.

## Coordinator rulings on this plan's readings (2026-10-17 20:40 UTC)

The coordinator read each Reading against the ledger, review 568's report and the plan's own measurements. These rulings bind the worker; where a ruling and a step above disagree, the ruling wins.

1. **Accepted:** `ccrc-api` on every role but server, by the one-line gate.
2. **Accepted:** `unverified: relist` joins R10k.
3. **Accepted:** `GET /api/updates` does not carry `sweep` in this wave. The inventory's reader (one reader, an optional wire field, absent read as "not measured") is residue R37, for a later server wave.
4. **Accepted:** `_keep_ok` keeps accepting `0`. The worker re-reads `_ver_gc`'s protections and records in the as-built note that they hold, before relying on this.
5. **Ruled IN:** Task 10 runs and D-5323 stands. The `died` word stays one class; no `died: <n>: <ids>` shape.
6. **Ruled IN, option 1:** Task 7 gains **Step 5**: `deploy/deploy.sh`'s remote lister becomes `for d in <pattern>; do [ -d \"\$d\" ] && [ ! -L \"\$d\" ] && printf '%s\n' \"\$d\"; done \` exactly as Reading 6 gives it (Appendix `row-pk2.sh`), with the D3c row (a newer link at KEEP=1) red before the change and green after, and its mutation row. It shares the prune's two lines with Task 15; both stay line-neutral. Why: the harm is measured, the fix costs one line and one row, and the newest-N window it protects is the one #448's snapshot sits in.
7. **Accepted:** the other `[0-9]` validators in `ccd/ccrc` go to residue R38.
8. **Accepted:** item G's units are not recorded in this wave; they stay named on stderr. R37 records the option of a third word class.
9. **Accepted.**
10. **Accepted,** and the SKIP text says so.
11. **Accepted.** The coordinator corrects the ledger: #441 does not carry R25(a)'s code-comment half, and Task 9 keeps it.
12. **Ruled IN, on Linux:** the `down` arm PASSes a recorded unit only when `systemctl --user show -p ActiveState -p NRestarts --value claude-session@<id>.service` reads `active` and `NRestarts` 0; `active` with `NRestarts` above 0 WARNs "active at this read, but restarted <n> times by its manager since"; a `show` that does not answer is "not measured" under the three-answers rule (D-5316). Darwin keeps the one `_svc_is_active` read. D-5316's entry is amended to say so, and the doctor describe gains a row for each answer, with a fixture answer for `show`. Why: the operator's Reading 9 case is a unit that was crash-looping before the update, and one `active` read is what such a unit shows between restarts; the sweep itself refuses to trust it.
13. **Accepted:** the remedy text only, "this WARN clears at the next ccrc update or rollback".
14. **Accepted.**

**Added by the coordinator:** Tasks 13 to 16 (D-5324 to D-5327): review 568's F1 and F2, R36 and R35(d). **Groups and dependencies, ruled:** Group A (start at dispatch) is Tasks 1, 2, 3, 5, 8, 9, 10, 13, 14, 15 and 16. Tasks 6 and 7 wait for #448 (its `_bak_*` rewrite); Task 4 waits for #448 (its doctor-table line and `_check_delegation-hooks`) and for claim 1557 to end (#410) or its holder's consent through the coordinator; Task 11 waits for #482. Task 12 runs once every task is done. Until a dependency lands, the worker does not edit that task's region, and says in its mail which task waits on which PR.

## Appendix: the row scripts

Each script takes the file(s) under test as arguments, works under a `mktemp -d` HOME, sources or extracts only the named functions, and runs no `ccrc` or `ccd` command, no real `systemctl`, `tmux` or `launchctl`. Copy each into a scratch directory of the worker's own and run it with `bash <script> <args>` from the repository root. Measured at the reviser's projection (`ccd/ccrc` and `ccd/ccrc-doctor-checks` as revised there).

### `b1.sh`

Task 2 Step 1 (B1): the `sweep` key is written only while set, after the seven keys.

```bash
#!/usr/bin/env bash
# B1: _upd_phase writes `sweep` only while UPD_SWEEP_WORD is set; B2: _upd_sweep_set_down's word. $1 = ccd/ccrc
set -u; src="$1"; fx="$(mktemp -d "${TMPDIR:-/tmp}/w17b1.XXXXXX")"; export HOME="$fx"
_exit_add() { :; }
for f in _upd_phase _upd_redact _upd_json_str _tmp_guard _upd_sweep_set_down _ccrc_ascii_fold; do eval "$(sed -n "/^$f() [{(]/,/^[})]\$/p" "$src")"; done
for f in _upd_phase _upd_redact _upd_json_str _tmp_guard; do declare -F $f >/dev/null || echo "missing $f"; done
BOX_UPDATE_JSON="$fx/.ccrc/update.json"; UPD_REPORT_STARTED=""; UPD_REPORT_TARGET=v1.2.3; UPD_FROM=cli; UPD_REPORT_PID=4242; UPD_SWEEP_WORD=""
_upd_phase restarting >/dev/null; echo "unset: $(cat "$BOX_UPDATE_JSON")"
if declare -F _upd_sweep_set_down >/dev/null; then _upd_sweep_set_down claude-session@acct-a-demo.service claude-session@acct-b-demo.service; else UPD_SWEEP_WORD="down: 2: acct-a-demo acct-b-demo"; fi
_upd_phase done >/dev/null; echo "set:   $(cat "$BOX_UPDATE_JSON")"
jq -e '.sweep == "down: 2: acct-a-demo acct-b-demo" and .detail == null' "$BOX_UPDATE_JSON" >/dev/null && echo "B1 GREEN" || echo "B1 RED"
jq -e '(keys_unsorted|.[0:7]) == ["target","phase","startedAt","updatedAt","detail","from","pid"]' "$BOX_UPDATE_JSON" >/dev/null && echo "B1 order GREEN" || echo "B1 order RED"
```

### `row-cap2.sh`

Task 2 Step 3 (CAP): twelve long ids are recorded as whole ids within 200 characters, the count first.

```bash
eval "$(sed -n '/^_upd_json_str() [{(]/,/^[})]$/p;/^_upd_sweep_set_down() [{(]/,/^[})]$/p' "$1")"
args=(); for i in $(seq 1 12); do args+=("claude-session@acct-$i-project-alpha.service"); done
_upd_sweep_set_down "${args[@]}"; s="$(_upd_json_str "$UPD_SWEEP_WORD")"; s="${s%\"}"
echo "len=${#UPD_SWEEP_WORD} stored-last=${s##* }"
[ "${#UPD_SWEEP_WORD}" -le 200 ] && [ "${s##* }" = acct-9-project-alpha ] && [ "${UPD_SWEEP_WORD:0:10}" = "down: 12: " ] && echo "CAP GREEN" || echo "CAP RED"
```

### `row-die.sh`

Task 2 Step 3 (DIE): `_upd_sweep_die` leaves `died: sweep` in the failed report.

```bash
# DIE: _upd_sweep_die leaves `died: sweep` in the failed report. $1 = ccd/ccrc
set -u; src="$1"; fx="$(mktemp -d "${TMPDIR:-/tmp}/w17die.XXXXXX")"; export HOME="$fx"
_exit_add() { :; }
for f in _upd_phase _upd_redact _upd_json_str _tmp_guard _upd_sweep_die _ccrc_ascii_fold; do eval "$(sed -n "/^$f() [{(]/,/^[})]\$/p" "$src")"; done
_upd_report_is_mine() { return 0; }
_ccrc_die() { _upd_phase failed "$1" >/dev/null; exit 1; }
BOX_UPDATE_JSON="$fx/.ccrc/update.json"; UPD_REPORT_STARTED=""; UPD_REPORT_TARGET=v1.2.3; UPD_FROM=cli; UPD_REPORT_PID=4242; UPD_REPORTING=1; UPD_SWEEP_WORD=""
( _upd_sweep_die "sweep: 1 of 2 supervisors did not stay up" )
cat "$BOX_UPDATE_JSON"
jq -e '.phase == "failed" and .sweep == "died: sweep"' "$BOX_UPDATE_JSON" >/dev/null && echo "DIE GREEN" || echo "DIE RED"
```

### `dr2.sh`

Task 4 Steps 1 and 5 (D1 to D16): run as `bash dr2.sh ccd/ccrc-doctor-checks ccd/ccrc`; a mutation row runs it over a `sed`-mutated copy of the file.

```bash
#!/usr/bin/env bash
# D-rows for the REVISED _check_update-sweep (D-5316). $1 = file carrying the function, $2 = ccd/ccrc
set -u; chk="$1"; src="$2"; fx="$(mktemp -d "${TMPDIR:-/tmp}/w17dr.XXXXXX")"; export HOME="$fx"
fails=0
row() { # <name> <json or -> <want word> <want rc> [<grep>] [<must-not-grep>]
  local name="$1" json="$2" want="$3" wrc="$4" pat="${5:-}" nopat="${6:-}" out rc
  rm -f "$fx/update.json"; [ "$json" = - ] || printf '%s\n' "$json" > "$fx/update.json"
  out="$(bash -c '
    _dr_pass() { printf "PASS %s: %s\n" "$1" "$2"; }; _dr_warn() { printf "WARN %s: %s | fix: %s\n" "$1" "$2" "${3:-}"; }
    _dr_skip() { printf "SKIP %s: %s\n" "$1" "$2"; }; _dr_fail() { printf "FAIL %s: %s\n" "$1" "$2"; }
    source "$1"; for f in _upd_report_readable _plat_size; do eval "$(sed -n "/^$f() [{(]/,/^[})]\$/p" "$2")"; done
    _svc_is_active() { case "$1" in *acct-b-demo*) printf failed ;; *acct-c-demo*) : ;; *acct-d-demo*) printf activating ;; *) printf active ;; esac; }
    BOX_UPDATE_JSON="$3"; UPD_REPORT_CAP=65536; CCD_OS=linux
    _check_update-sweep' _ "$chk" "$src" "$fx/update.json")"; rc=$?
  if [[ "$out" == "$want update-sweep:"* ]] && [ "$rc" = "$wrc" ] && { [ -z "$pat" ] || grep -qF -- "$pat" <<<"$out"; } \
     && { [ -z "$nopat" ] || ! grep -qF -- "$nopat" <<<"$out"; }; then echo "$name GREEN"; else echo "$name RED (rc $rc): ${out:0:220}"; fails=$((fails+1)); fi
}
R='"target":"v1.2.3","startedAt":1,"updatedAt":2,"detail":null,"from":"cli"'
row D1-absent - SKIP 3
row D2-inflight "{$R,\"pid\":7,\"phase\":\"installing\"}" SKIP 3 'not a final one'
row D2b-restarting-dead "{$R,\"pid\":999999999,\"phase\":\"restarting\"}" WARN 2 'is gone'
row D2c-restarting-live "{$R,\"pid\":$$,\"phase\":\"restarting\"}" SKIP 3 'restarting its supervisors now'
row D3-nokey "{$R,\"pid\":7,\"phase\":\"done\"}" SKIP 3 'not measured'
row D4-ok "{$R,\"pid\":7,\"phase\":\"done\",\"sweep\":\"ok\"}" PASS 0
row D5-down "{$R,\"pid\":7,\"phase\":\"done\",\"sweep\":\"down: 2: acct-a-demo acct-b-demo\"}" WARN 2 'still not active: acct-b-demo (failed) —'
row D6-backup "{$R,\"pid\":7,\"phase\":\"done\",\"sweep\":\"down: 1: acct-a-demo\"}" PASS 0 'at this read'
row D7-short "{$R,\"pid\":7,\"phase\":\"done\",\"sweep\":\"down: 3: acct-a-demo acct-b-demo\"}" WARN 2 'names 2 of 3'
row D8-refused "{$R,\"pid\":7,\"phase\":\"done\",\"sweep\":\"refused: killmode\"}" WARN 2 'REFUSED (killmode)' 
row D8b-clears "{$R,\"pid\":7,\"phase\":\"done\",\"sweep\":\"refused: listing\"}" WARN 2 'clears at the next ccrc update or rollback'
row D9-unverified "{$R,\"pid\":7,\"phase\":\"done\",\"sweep\":\"unverified: relist\"}" WARN 2 'no supervisor' 'restarted every'
row D10-unknown "{$R,\"pid\":7,\"phase\":\"done\",\"sweep\":\"later-word\"}" SKIP 3 'not one this build knows'
row D11-garbage 'not json' SKIP 3 'does not parse'
row D13-unasked "{$R,\"pid\":7,\"phase\":\"done\",\"sweep\":\"down: 1: acct-c-demo\"}" SKIP 3 'did not answer'
row D14-mixed "{$R,\"pid\":7,\"phase\":\"done\",\"sweep\":\"down: 2: acct-b-demo acct-c-demo\"}" WARN 2 'not measured (the service manager did not answer): acct-c-demo' 'acct-c-demo ('
row D15-activating "{$R,\"pid\":7,\"phase\":\"done\",\"sweep\":\"down: 1: acct-d-demo\"}" WARN 2 'acct-d-demo (activating)'
row D16-died "{$R,\"pid\":7,\"phase\":\"failed\",\"sweep\":\"died: sweep\"}" WARN 2 'died partway'
body="$(sed -n '/^_check_update-sweep() {/,/^}/p' "$chk")"
if [ -n "$body" ] && ! grep -q '_dr_fail' <<<"$body" && ! grep -qE 'return 1([^0-9]|$)' <<<"$body"; then echo "D12-neverfail GREEN"; else echo "D12-neverfail RED"; fails=$((fails+1)); fi
echo "fails=$fails"
```

### `e1.sh`

Task 6 Steps 1 and 4 (E1 to E3).

```bash
#!/usr/bin/env bash
# E1 structural + E2 differential for _bak_removable (D-5318). $1 = ccd/ccrc.
set -u
src="$1"; ok=1
for fn in _bak_prune _bak_gc; do
  body="$(sed -n "/^$fn() {/,/^}/p" "$src")"
  grep -q '_bak_removable "$d" || continue' <<<"$body" || { echo "E1 RED: $fn does not call _bak_removable"; ok=0; }
  grep -q '\[ "$d" = "$BAK_KEEP_' <<<"$body" && { echo "E1 RED: $fn still spells a keep clause"; ok=0; }
done
[ "$ok" = 1 ] && echo "E1 GREEN"
eval "$(sed -n '/^_bak_removable() {/,/^}/p' "$src")"
declare -F _bak_removable >/dev/null || { echo "E2 RED: no _bak_removable"; exit 0; }
R=/fx/ccrc-backups; UPD_BAK_FLOOR=20250110-000000; UPD_BACKUP_DIR=$R/20250109-000000
BAK_KEEP_SNAP=$R/20250102-000000; BAK_KEEP_DATA=$R/20250103-000000; BAK_KEEP_TREE=$R/20250104-000000
got=""; for n in 20250101 20250102 20250103 20250104 20250105 20250109 20250110 20250111; do
  _bak_removable "$R/$n-000000" && got="$got $n"; done
echo "removable:$got"; [ "$got" = " 20250101 20250105" ] && echo "E2 GREEN" || echo "E2 RED"
UPD_BAK_FLOOR=garbage; _bak_removable "$R/20250101-000000" && echo "E3 RED: open on a bad floor" || echo "E3 GREEN (closed on a bad floor)"
```

### `f1.sh`

Task 7 Step 1 (F1).

```bash
#!/usr/bin/env bash
# F1: _bak_list never lists a link (D-5319). $1 = ccd/ccrc to read.
set -u
src="$1"; fx="$(mktemp -d "${TMPDIR:-/tmp}/w17f1.XXXXXX")"
eval "$(grep '^BAK_TS_PAT=' "$src")"
eval "$(sed -n '/^_bak_list() {/,/^}/p' "$src")"
BOX_BACKUP_ROOT="$fx/ccrc-backups"; mkdir -p "$BOX_BACKUP_ROOT/20250101-000000/server-dist" "$fx/elsewhere/server-dist"
ln -s "$fx/elsewhere" "$BOX_BACKUP_ROOT/20250102-000000"
: > "$BOX_BACKUP_ROOT/20250103-000000"
_bak_list
got="$(printf '%s\n' "${BAK_DIRS[@]##*/}" | tr '\n' ' ')"
echo "listed: $got"
[ "$got" = "20250101-000000 " ] && echo "F1 GREEN" || echo "F1 RED"
```

### `row-p18b.sh`

Task 7 Step 3 (P18b, respecified): a plain real backup older than a link, at KEEP=1, through the sourced `_bak_prune`.

```bash
# P18b (respec, PK1): a PLAIN real backup, older than a timestamp-named link to a plain target, at KEEP=1, through the
# sourced _bak_prune with no other dir listed. $1 = ccd/ccrc
src="$1"; fx="$(mktemp -d "${TMPDIR:-/tmp}/w17p18b.XXXXXX")"; export HOME="$fx"
eval "$(grep '^BAK_TS_PAT=' "$src")"
for f in _bak_list _bak_keepset _bak_snap_class _bak_removable _bak_prune _keep_ok; do eval "$(sed -n "/^$f() [{(]/,/^[})]\$/p" "$src")"; declare -F $f >/dev/null || echo "missing $f"; done
CCRC_HERE=/nonexistent; _ver_lock_try() { return 0; }; _upd_unlock() { :; }; _ccrc_die() { echo "DIE: $*"; exit 1; }
BOX_BACKUP_ROOT="$fx/ccrc-backups"; mkdir -p "$BOX_BACKUP_ROOT/20250101-000000" "$fx/plain-target"
: > "$BOX_BACKUP_ROOT/20250101-000000/some-file"
ln -s "$fx/plain-target" "$BOX_BACKUP_ROOT/20250102-000000"
UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; UPD_LOCK_FD=9; CCRC_BACKUP_KEEP=1
_bak_prune
[ -d "$BOX_BACKUP_ROOT/20250101-000000" ] && [ ! -L "$BOX_BACKUP_ROOT/20250101-000000" ] && [ -L "$BOX_BACKUP_ROOT/20250102-000000" ] && [ -d "$fx/plain-target" ] \
  && echo "P18b GREEN" || echo "P18b RED: left $(ls "$BOX_BACKUP_ROOT" | tr '\n' ' ')"
```

### `g1.sh`

Task 8 Step 1 (G1).

```bash
#!/usr/bin/env bash
# G1: _keep_ok refuses non-ASCII decimal digits under a UTF-8 locale (D-5320). $1 = ccd/ccrc
export LC_ALL=en_US.UTF-8
# premise: the [0-9] range really accepts U+0663 here, else the row proves nothing
if ! [[ $'\xd9\xa3' =~ ^[0-9]{1,4}$ ]]; then echo "G1 SKIP: this bash/locale does not reproduce the range"; exit 0; fi
eval "$(grep '^_keep_ok() {' "$1")"
bad=""; for v in $'\xd9\xa3' $'7\xd9\xa3' $'\xef\xbc\x95'; do _keep_ok "$v" && bad="$bad [$v]"; done
for v in 0 7 0002 9999; do _keep_ok "$v" || bad="$bad refused:$v"; done
_keep_ok 10000 && bad="$bad accepted:10000"
[ -z "$bad" ] && echo "G1 GREEN" || echo "G1 RED:$bad"
```

### `d1d.sh`

Task 8 Step 1 (D1d's bash prototype).

```bash
#!/usr/bin/env bash
# D1d prototype: deploy.sh's prune refuses a non-ASCII KEEP with the one warning, rc 1, nothing sent. $1 = deploy.sh
fn="$(python3 -I -c 'import re,sys;print(re.search(r"prune_backups\(\) \{([\s\S]*?)\n\}",open(sys.argv[1]).read()).group(1))' "$1")"
rec="$(mktemp)"; export LC_ALL=en_US.UTF-8 CCRC_BACKUP_KEEP=$'\xd9\xa3'
out="$(bash -c "ssh_stub() { printf '%s' \"\$2\" > '$rec'; }; SSH=(ssh_stub); BOX=box.invalid; prune_backups() {$fn
}; prune_backups" 2>&1)"; rc=$?
echo "rc=$rc sent=[$(cat "$rec")] out=[$out]"
```

### `row-pk2.sh`

Reading 6: deploy.sh's remote prune, as it is and under option 1, in a fixture backups dir.

```bash
# PK2 option 1: deploy.sh's remote prune lists real directories only. Builds the remote command the way deploy.sh's
# double-quoted string does (keep expanded locally, \$d left for the box), and runs it in a fixture backups dir.
set -u
run() { # <variant old|new> <keep> <names...>: a name ending in @ is a link to ../outside
  local v="$1" keep="$2"; shift 2; local fx; fx="$(mktemp -d "${TMPDIR:-/tmp}/w17pk2.XXXXXX")"
  mkdir -p "$fx/ccrc-backups" "$fx/outside"
  for n in "$@"; do case "$n" in *@) ln -s ../outside "$fx/ccrc-backups/${n%@}" ;; *) mkdir "$fx/ccrc-backups/$n" ;; esac; done
  local P='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]' cmd
  if [ "$v" = old ]; then cmd="cd $fx/ccrc-backups 2>/dev/null || exit 0
    ls -d $P 2>/dev/null \
      | sort | head -n -$keep | xargs -r rm -rf --"
  else cmd="cd $fx/ccrc-backups 2>/dev/null || exit 0
    for d in $P; do [ -d \"\$d\" ] && [ ! -L \"\$d\" ] && printf '%s\n' \"\$d\"; done \
      | sort | head -n -$keep | xargs -r rm -rf --"; fi
  bash -c "$cmd"
  echo "$v keep=$keep [$*] -> left: $(cd "$fx/ccrc-backups" && ls | tr '\n' ' ')outside=$( [ -d "$fx/outside" ] && echo kept || echo GONE)"
}
run old 1 20250101-000000 20250102-000000@
run new 1 20250101-000000 20250102-000000@
run new 1 20250101-000000 20250102-000000@ 20250103-000000
run new 2 20250101-000000 20250102-000000 20250103-000000
```
