# Centralised update management — programme wave 6 (spec W5): versioned installs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A box keeps each release it installs as its own directory under `~/ccrc-versions/<tag>/` and runs the one `~/ccrc` points at, so an install never rewrites the tree that is running, a rollback to a kept version is a flip and a restart with no download, a crashed one-time migration completes itself on the next run, `ccrc versions` shows and prunes what is kept without ever removing a version something needs, and the whole path is rehearsed against a real published release before any live box moves.

**Architecture:** Everything here is bash in `ccd/ccrc` (plus one byte-identical platform helper in `ccd/ccd`), tested under the fixture HOMEs `ccrc-install.test.ts`, `ccrc-update.test.ts`, `ccrc-uninstall.test.ts` and `macos-platform.test.ts` already carry, plus one new audit suite. The flip is a new platform helper, `_plat_ln_swap` (GNU `ln -sfn` + `mv -fT` on Linux — the spec's own argv — and python3's `os.replace` on Darwin), inside the `# ── THE PLATFORM LAYER` sentinels of both files. `_inst_tree` names the SOURCE tree (`_inst_version_name`: the release tag, `untagged-<sha12>`, or `unstamped-<rand12>`), places it into `$BOX_VERSIONS_ROOT/<name>/` — never into the live name, voiding that directory's kept record first — runs `npm ci` there, and only then flips `~/ccrc`; a `~/ccrc` it did not make (a foreign link, a file) is refused; a real directory at `~/ccrc` is migrated once (`_inst_migrate`: place fully, move `~/ccrc` aside to `~/ccrc.migrating` through `_plat_mv_notdir`, `ln -sn`), a crash inside that two-syscall window is completed first — by the next run, and by `cmd_update` right after its own staged spine — from `~/.ccrc/migrating-to` (`_inst_migrate_resume`), and `~/ccrc.migrating` is removed only after a gate passes (`_inst_migrate_finish`; a plain install's doctor tail is its own gate only under a lock it took, `_inst_doctor_tail`). Each completed install keeps a copy of the box's stamp and install record inside its version directory (`_ver_keep_state`), which is what lets wave 4's `_upd_restore` gain its first arm (`_upd_restore_arm1` over `_ver_flip_back`, which points `~/ccrc` back and clears the record when it fails) and `cmd_rollback` prefer it. `cmd_versions` lists; `_ver_gc` prunes under the update lock — automatically only behind a passed gate, and reading its inputs only when something could be prunable — keeping the pointed-at, the previous, the projection's desired tags, every version a running unit resolves to, and the newest `CCRC_VERSIONS_KEEP` (3). `cmd_uninstall` sweeps the versions root. Nothing server-side or in the PWA changes.

**Tech Stack:** bash ≥ 4.4 (`set -uo pipefail`, no `-e`), GNU coreutils `ln -sfn`/`mv -fT` (the Linux arm), python3 `os.replace` (the Darwin arm; Homebrew's prerequisite, the Xcode Command Line Tools, ships it), `rsync -a --delete --checksum`, `flock`, `jq`, `systemctl --user show -p ExecStart` (Linux) / `plutil -convert json` (Darwin), `readlink` / `readlink -f`, vitest under `server/test`.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` — §11's "Versioned installs (W5)" paragraphs in full (the layout, `_inst_tree` targeting `~/ccrc-versions/<tag>/`, the flip, the one-time migration and its crash recovery, every row of the audit table, GC and `ccrc versions`, restore arm 1, the rehearsal) and §11's W5 Pins, the §15 W5 row, §2 decision 18, and the §18 rows "the flip is a rename", "the migration keeps the old tree until the gate", "a crashed migration is completed first", "GC never removes a needed version". The spec's `ccd/ccrc` line numbers are stale by 100–400 lines (measured at `d759c914`: the `_inst_tree` cluster by ~+100, `_inst_plist_server` by ~+120, `cmd_uninstall`'s `rm` by +400 and into `_uninst_tree_bins`); every anchor below was re-measured at `d759c914`, and wave 4 moves most of them again, so every task re-locates by identifier before editing.

**Producer (merged before this wave is dispatched):** wave 4's plan, `git show 4b361c00:docs/superpowers/plans/2026-09-22-centralised-update-w4a-node-side.md`. Every name this wave consumes is spelled as that plan spells it: `_upd_restore <role> <reason>` (arms 2 and 3, `_upd_restore_arm2`, `_upd_restore_arm3`, `_upd_restore_copy`), `cmd_rollback`, `_upd_rollback_no_restore`, `_upd_gate <role> <version>` and `UPD_GATE_WHY`, `_upd_lock` / `_upd_unlock` / `_upd_lock_probe` (rc 0 free, 1 held, 2 no `flock`, 3 unmeasured) and `UPD_LOCK_FD` / `UPD_LOCK_INHERITED`, `_upd_phase`, `UPD_FROM` / `UPD_REPORT_TARGET` / `UPD_REPORTING`, `CCRC_INST_SPINE` and `_inst_step`, `_inst_installed` / `_inst_floor`, `BOX_PREVIOUS_FILE` and `_upd_read_previous` (`UPD_PREV_TAG`, rc 0/1/2/3), `_upd_intent_state` (`UPD_INTENT_STATE`, `UPD_INTENT_DESIRED`, `UPD_INTENT_DESIRED_STABLE`, `UPD_INTENT_DESIRED_DEV`), `CCRC_CAP_WORDS=(verify node-id floor update-json update-gate rollback)` / `CCRC_CAP_WORDS_LINUX=(detach)` / `_ccrc_cap_words`, `_upd_sweep`, the watchdog's `ExecCondition=` grep of `%h/ccrc/ccd/ccrc`.

**Out of scope (said once):** anything server-side or in the PWA (the inventory, the resolver, the routes, the screens); `deploy/deploy.sh` and `deploy/build-release.sh` — `deploy.sh` writes THROUGH the link into the pointed-at version and the node reads `unversioned`, exactly as the spec's audit row says, and it is untouched by decision; the live-node half of the rehearsal, which is the coordinator's at rollout (Task 8 lists its commands); `KillMode` on the two main units (spec §17).

## Global Constraints

- **The canonical version is the tag** `vX.Y.Z`, tested by `cmd_update`'s inline shape `^v[0-9]+\.[0-9]+\.[0-9]+$` (`ccd/ccrc` has no `$SHAPE`); a version DIRECTORY name is the wider `VER_NAME_RE='^(v[0-9]+\.[0-9]+\.[0-9]+|untagged-[0-9a-f]{12}|unstamped-[0-9a-f]{12})$'`, declared once, and only a tag-shaped name is ever handed to `--to`, `previous` or the gate.
- **The layout:** `BOX_VERSIONS_ROOT="$HOME/ccrc-versions"`, a sibling of `BOX_BACKUP_ROOT="$HOME/ccrc-backups"` (`ccd/ccrc:1324`); `BOX_TREE_DIR="$HOME/ccrc"` (`:1282`) is unchanged and becomes the symlink `$HOME/ccrc -> $HOME/ccrc-versions/<name>` (an ABSOLUTE target, written verbatim by `_plat_ln_swap`); `BOX_MIGRATING_DIR="$HOME/ccrc.migrating"`; `BOX_MIGRATION_FILE="$HOME/.ccrc/migrating-to"`. Every existing path contract keeps resolving through `$HOME/ccrc`.
- **No new code resolves `~/ccrc` physically to decide anything** except `_inst_tree`'s self-copy guard (`pwd -P`, as today), `_ver_layout` (plain `readlink`, never `-f`) and GC's running-unit check (`readlink -f`, empty = unmeasured). `CCRC_HERE` (`:1098-1100`) and `_dr_pkg_candidates` (`ccd/ccrc-doctor-checks:292-296`) keep their plain `pwd` — adding `-P` to either breaks doctor under the link (spec §11's audit).
- **`ccd/ccrc` is `set -uo pipefail` (`:68`), never `-e`:** every new step captures its rc explicitly (`|| rc=$?`, `|| _ccrc_die …`); a step that omits it continues past its own failure.
- **Every GNU/BSD split goes through the platform layer.** The one new helper, `_plat_ln_swap`, lands above `# ── END PLATFORM LAYER` in BOTH `ccd/ccrc` (`:70`–`:1031` at `d759c914`) and `ccd/ccd` (`:11`–`:972`), byte-identical (`macos-platform.test.ts`'s block diff), and `ccd/ccd` is then re-stamped with `markGenerated` (`ownership.test.ts:131-135`'s command). No bare `mv -T` outside the block (`macos-platform.test.ts`'s `gnuOnly` sweep, `:117-135`).
- **Fixture HOMEs only** (`mkTmp`, `tmpHelpers.ts`, the update harness's `updateEnv`, the install harness's `ccrcEnv`) — never `ccd` or `ccrc` against the live `$HOME`, never a live `~/ccrc`, `~/ccrc-versions` or `~/ccrc.migrating`; `systemctl`, `systemd-run`, `launchctl`, `curl`, `ssh` stay recording stubs or poisons. The one real network act is Task 8's recorded rehearsal, in `$SCRATCHPAD`, never under the repo and never at the live `$HOME`.
- **The `pathWithout` allowlist rule** (`ccrc-install.test.ts:641`, the list at `:686-707`): the install path gains two tools, `ln` (the flip's staged link and the migration's `ln -s`) and `readlink` (`_ver_layout`), both added to that list in Task 2's commit; `python3` is already listed. GC on the install path uses no `sort` binary (a bash-only ordering), so nothing else joins.
- **Both harness `python3` stubs** (`ccrc-install.test.ts:529-541`, `ccrc-update.test.ts:263-275`) refuse every argv but `-m venv` with exit 90; the Darwin arm of the flip runs `python3 -c`, so Task 2 gives each stub one `-c` arm that `exec`s the real python3 resolved when planted — or every macOS leg dies at its first flip. The real python3 is resolved without a throw and the arm is spread in only when it resolved, so a Linux box with no python3 still runs both files.
- **The `single-definition.test.ts` censuses are exact lists:** the stamp census (`BOX_STAMP_FILE`, `:1389-1402` at `d759c914`) and the install-record census (`BOX_INSTALLED_FILE`, `:1497-1515`, as wave 4 grew it) gain exactly the lines Tasks 2 and 4 write, entered in document order; both sit below `:1303`, so the edit moves none of the three lines the session-hook audit cites there (`:32-37`, `:1274`, `:1303`, ruling R13).
- **The session-hook citation-corpus tax:** every line inserted into `ccd/ccrc` or `ccd/ccd` shifts the frozen anchors `session-hook.test.ts` audits (`byFile`, the `**Files:**`-pass and `|`-row sets, the site-level set, the headline total). Tasks 1–8 do not chase it; Task 9 re-measures it ONCE by S6-R11 (`session-hook.test.ts:8069-8074`) — failure sets DUMPED from `git archive` trees of the base and the tip and diffed, never retyped.
- **Deviation numbers are issued by the allocator** (`POST /api/ledger/deviations`) and defined in the same act. This plan's departures carry the numbers the coordinator minted for run 133 on 2026-09-23. A departure found while executing takes the next unspent number of the run's RESERVE block, named in the wave brief, and is defined in `## Deviations found` in the same commit that first cites it; an unspent reserve number is never written as a `D-` token anywhere (`deviation-refs.test.ts`), and a concrete `D-TBD-` spelling never lands (`dtbd.test.ts`).
- **Exit codes:** `ccrc update` and `ccrc rollback` keep wave 4's table (0 moved or already there; 1 refused or failed; 2 usage; 3 moved, doctor FAIL, gate passed; 4 gate failed and `_upd_restore` ran). `ccrc versions`: 0 listed or pruned; 1 a prune skipped on an unmeasurable input or a removal failed; 2 usage.
- **Commit on the workspace branch only**, at least one commit per task (`feat(ccrc): …` / `test(ccrc): …`); a separate feature branch wedges the done-fingerprint with `stale-tip`.
- **No residue classes in tracked text** — no hostnames, usernames, absolute home paths, docserver URLs or the org name (`topology-clean.test.ts`, the pre-push hook). The rehearsal record derives the release URL from `ccd/ccrc`'s own `CCRC_RELEASE_OWNER`/`CCRC_RELEASE_REPO` lines at run time and never spells it; transcripts are recorded with `$S` / `$H` in place of scratch paths.
- **Mutation-table discipline:** every guard ships with a test that goes red when the guard is removed or mutated, measured before and after; each task names its §18 row or its plan-level row.
- **Suites run in the foreground, one file at a time, from inside the package:** `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts` (timeout ≥ 600000 ms) — never bare `npx vitest`; the full sharded server suite and the agent and pwa suites run once, in Task 9.

## Review Focus

Five failure modes the spec implies and no existing pin exercises — most likely first. A reviewer reads these before the diff.

1. **Arm 1 flips the tree back but not the box's identity.** `/health`'s `version` is `deps.build`, read ONCE at boot from `~/.ccrc/build.json` (`server/src/server.ts:1073-1078`, `buildinfo.ts`), and the failed install already restamped that file; a flip-and-restart alone therefore brings the old code up answering the NEW version, arm 1's re-gate fails every time, and every restore silently degrades to arm 2's download — while a standalone rollback by flip leaves `~/.local/bin/ccd`, the units and the session hooks on the build it rolled away from, and then `_upd_sweep` moves the supervisors onto that newer `ccd`. Task 4 adds the tests: a FULL-flavour gate failure on a box with a kept previous version ends `reverted: arm1: …` with no release URL in `curl-argv`, and `~/.ccrc/build.json`, `~/.ccrc/installed` and `~/.local/bin/ccd` byte-equal the kept version's; `ccrc rollback` to a kept version does the same and then sweeps.
2. **The self-copy guard answering the wrong question.** Today one `pwd -P` comparison skips the rsync when source and `~/ccrc` are one tree. Against a versioned destination it can silently turn a NEW install into a skip (a run whose `CCRC_HERE/..` resolves under `~/ccrc-versions/`), or rsync `--delete` straight into the version `~/ccrc` points at (the audit's "must change"). Task 2 adds the tests: a staged tree for a new tag, installed while `~/ccrc` points at another version, rsyncs into `~/ccrc-versions/<new>/` and flips; the running version's directory is byte-unchanged (`treeDigest` before/after); a re-run of `ccrc install` from the pointed-at version prints the unchanged `install: tree: already running from $HOME/ccrc` and copies nothing; a run of a DIFFERENT placed version's own `ccd/ccrc install` flips to it without copying.
3. **A crash inside the migration's two-syscall window, and a gate nobody runs.** With `~/ccrc` gone the launcher cannot run at all (the shim refuses by name and must stay byte-equal with `deploy.sh`'s), so recovery comes from `install.sh`, a checkout, or a placed version's own `ccd/ccrc`; and the first move onto W6 is driven by a box's pre-W6 `ccrc update`, whose staged W6 spine runs a doctor tail that is NOT the gate. Task 3 adds the tests: an `ln` stub that SIGKILLs its parent at the migration's `ln -sn` leaves exactly `~/ccrc.migrating` + `~/.ccrc/migrating-to` and no `~/ccrc`; the next `ccrc install` (by explicit path) links it before `_inst_banner` prints; a spine run while a real holder keeps `~/.ccrc/update.lock` never removes `~/ccrc.migrating` even when its doctor passes; `cmd_update` removes it only after `_upd_gate` passes, and completes a crash its own staged spine left before the gate runs. The residual hole is named, not closed: an updater older than wave 4 holds no lock, so its W6 staged spine's doctor removes the directory (D-3435). Review added three more: a link the staged spine cannot place moves the tree BACK inside the spine, so only a kill inside the window leaves a crash pair (D-3436); `--detach` and a rollback's kept check complete a crash pair first (D-3437); and the first move's parent is wave 4's, which has neither the post-spine resume nor arm 3's void, so two shapes on that one move are named with by-hand remedies and checked in Task 8's live half (D-3438).
4. **GC reading the running unit's command and protecting nothing.** Real `systemctl --user show -p ExecStart` prints a struct whose `path=` is `/usr/bin/env` — the tree path is in `argv[]` — and `readlink -f` answers the link's CURRENT target (already protected) or, on an old BSD userland, nothing; a parser that reads `path=`, or treats an empty `readlink -f` as "not running", removes a version a unit is executing. Task 5 adds the tests: the stub emits the real struct form with the tree path inside `argv[]` and naming `~/ccrc-versions/<old>/…` directly → `<old>` is kept as `running`; a `readlink` stub that answers empty for `-f` → nothing is pruned and the prune says why; an unreadable or stale projection → nothing is pruned.
5. **A spine older than W6 writing through the link.** Arm 2's child, a `--to <old> --downgrade`, and a rollback with no kept directory all run the TARGET release's own `ccrc install`; before W6 that spine rsyncs `--delete` into `$HOME/ccrc` — through the link, into the directory named for the build it is replacing — and arm 3 copies old dists into the same place, so the version named `<new>` ends up holding `<old>` and a later flip or GC acts on the lie. Task 4 adds the tests: a staged tree whose `ccd/ccrc` has no `BOX_VERSIONS_ROOT=` line is handed a directory named for its own tag before its spine runs, and the previous version's directory is byte-unchanged afterwards; arm 3 removes the pointed-at version's kept install record so no flip ever returns to it.

## Deviations found

Plan-level departures from the spec's literal text, found while planning against the measured tree at `d759c914` and wave 4's committed plan. The first five were fixed by the coordinator's decisions; the rest were found while planning or writing the tasks, and each names the task that found it. Where a task's writing changed an earlier entry's text, the entry says "amended by Task N" and carries the corrected text; there is one entry per departure. Every one carries its placeholder until the coordinator's single numbering pass (ruling R12). A task that finds another adds a bullet here in the same form and names itself.

- **D-3419** — (Task 1) the flip is `_plat_ln_swap <target> <link>`, a helper inside the platform layer of both `ccd/ccrc` and `ccd/ccd`, not the spec's bare `ln -sfn <target> ~/ccrc.new && mv -T ~/ccrc.new ~/ccrc`. `mv -T` is GNU-only, and `ccd/ccrc`'s own header (`:70-75`) names it as an assumption the BSD userland it also runs on does not meet. The Linux arm IS the spec's argv, verbatim — `ln -sfn -- "$1" "$2.new"` then `mv -fT -- "$2.new" "$2"` — measured 2026-09-23 under `strace` (GNU coreutils 9.4) as one successful `renameat` over the old link, with no `unlink`. The Darwin arm hands the same rename to python3's `os.replace`, one rename(2) that replaces a symlink-to-directory rather than following it. The precedent is `ccd-pool-sync`'s `os.rename` install, whose header gives this reason; `_plat_mv_notdir`'s Darwin arm is not reused because it unlinks the destination first, which is a window. Cost if wrong: the Darwin arm needs python3, which Homebrew's own prerequisite ships and `cmd_install`'s Darwin preflight now names; the two flips that run in the `cmd_update`/`cmd_rollback` parent, where no spine preflight has run (`_ver_flip_back`'s and `_upd_legacy_target`'s), ask `_ver_can_flip` first and name it too (amended by Task 4).
- **D-3420** — (found by the coordinator's decisions; Task 5) spec §11 says GC keeps "any tag named in an intent's `pinnedTag` or a node's `requestedTag`". Both live in `coord.db`, which a fleet node cannot read. GC keeps what the node CAN read: every tag its projection (`~/.ccrc/update-intent`, through wave 4's `_upd_intent_state`) names on `desired`, `desired-stable` and `desired-dev`. So the protected set is what the projection can carry, and that is narrower than the spec's two columns in three named cases (amended in review of Task 5):
  - A pin the resolver refuses. Spec §9 resolves a pinned tag that is not eligible, or is at or below the node's floor, to NULL, and the line then reads `none`. The pin is on no `desired*` line, permanently, not just until the next sync.
  - A request waiting on a node that refused it or was not reached. Spec §10: "a refusal … does not consume the request". A `busy`, `disconnected` or timed-out dispatch leaves `requestedTag` set in `coord.db` with no lock held on the node. A PWA rollback whose `to` names an older KEPT version is one such request.
  - A pin set on the console but not yet pulled, for at most one sync interval (60 s).
  In each case the version is unprotected on the node. A GC that runs meanwhile (`ccrc versions --prune`, or the automatic run after another install or update) may prune it once it falls outside the newest `CCRC_VERSIONS_KEEP`. Its later apply is then a download, and its later rollback is `cmd_rollback`'s non-kept arm (the release-host question and a re-install by download, Task 4) instead of arm 1's flip. A request the node is actually executing is still covered: it holds `~/.ccrc/update.lock`, which GC takes. Cost if wrong: that download, and the time it takes. No kept tree that something points at, runs from, or last ran is lost.
- **D-3421** — (Task 8) spec §11's exit criterion, "the update harness pointed at the real newest release via `CCRC_RELEASE_BASE_URL`", is met by a RECORDED run in a scratch fixture HOME. It is not a committed test. A suite that reaches the network is not hermetic, and `ghContainedEnv`'s blanket containment (a poisoned `gh`, a contained `curl`) is what every other case in these files relies on. The commands, their exit codes and their deciding lines are recorded verbatim in this plan's `## Rehearsal record`. Cost if wrong: the rehearsal is not re-run automatically when a later wave changes the path it measured.
- **D-3422** — (Task 2) a source or `deploy.sh`-shaped install places into `untagged-<sha12>`: the first twelve hex digits of the commit its identity measures. The source is `git rev-parse HEAD` in a checkout with no release tag at `HEAD`, or the `sha` of a `build.json` carrying no `version`. The spec writes `untagged-<sha>` and gives no length. Twelve digits are enough to be unique across this repo's history, and they keep `VER_NAME_RE` a fixed shape. Cost if wrong: one width in one regex.
- **D-3423** — (found by the coordinator's decisions; Task 5) beyond the protected set, GC also keeps the newest `CCRC_VERSIONS_KEEP` complete versions (default 3, `^[0-9]+$`, the `CCRC_BACKUP_KEEP` idiom). "Newest" means ordered by the mtime of each version's kept install record, i.e. when it last completed an install on this box, because `untagged-`/`unstamped-` names have no version order. Spec §11 names only the protected set, which would prune every unprotected version on every install. Cost if wrong: three trees of disk (each with its `node_modules`) more than the spec's minimum.
- **D-3424** — (found reviewing Task 1; the call site is Task 2's `_inst_tree` step 5) nothing serializes `_plat_ln_swap`'s staged name `<link>.new`, which for the tree is the spec's own `$HOME/ccrc.new`. An update's flip runs in its staged spine while the parent holds `~/.ccrc/update.lock`, so two updates never interleave; a plain `ccrc install` takes no lock before its doctor tail (D-3431), so two concurrent plain installs, or one beside an update, can. A and B both `ln -sfn` onto `<link>.new` (B's value replaces A's); A's rename installs B's target and answers 0; B's rename finds no `<link>.new` and answers 1, and B dies `could not point $HOME/ccrc at …` while `~/ccrc` names B's version. Each step is one rename, so every reader resolves `~/ccrc` to a placed version at every instant: what is lost is the truth of the two exit codes, not the tree. No lock is taken around the flip, because none can serialize it. The staged spine is a new process (wave 4's `( exec {UPD_LOCK_FD}>&-; exec … )`) whose parent keeps the lock, so its `flock -n` answers "held" exactly as an unrelated holder's would. Proceeding on "held" leaves the install-beside-update case racing, refusing on it refuses every update's flip, and a blocking `flock` deadlocks the staged spine against its own parent. A per-call staged name (`<link>.new.$$`) would make each code true at the instant of its rename, but it departs from the spec's `$HOME/ccrc.new` and leaves stale names no later run recognises. Residual, named; `_plat_ln_swap`'s header says so.
- **D-3425** — (found planning Task 2) a source whose identity cannot be measured still needs a name: no `.git` that answers, no `build.json`, and not the live directory under a stamp that parses. Every fixture checkout in the install suite is such a source. It is placed into `unstamped-<rand12>`, twelve hex digits of `_plat_uuid`: a fresh name per placement, never reused. It is never shaped like a sha, because two unmeasured trees sharing a sha-shaped name would be two different trees behind one name, which is the overloaded value this repo refuses. Cost if wrong: repeated installs from such a tree accumulate directories until GC prunes the unprotected ones.
- **D-3426** — (found planning Task 2) a reinstall whose name equals the version `~/ccrc` already points at rsyncs IN PLACE, into that live directory: `ccrc update --to <current> --force` (the wave-4 remedy D-3240 names), or a dirty checkout re-installed at the same commit. This is the one case this wave does not make atomic. The rsync `--checksum` repairs drift; the name says the bytes are the same release. Building a sibling and swapping it in needs a second rename under a name the link does not hold, which opens a window of a dangling `~/ccrc`. Cost if wrong: a same-name reinstall keeps today's in-place behaviour.
- **D-3427** — (found planning Task 2) when the source tree IS a complete placed version (its physical path is `$BOX_VERSIONS_ROOT/<name>`, it carries `$VER_RECORD_COPY`, and on a `fleet` box its `agent/node_modules` is a directory — a version completed under another role never fetched the agent's deps), `_inst_tree` copies nothing and does NOT run `npm ci`. Today every install runs `npm ci`, which empties `node_modules` and fetches it again. This skip is what makes a flip back — a kept version's own spine re-run from itself, Task 4 — work without the registry. A placed version that is incomplete still runs `npm ci`. Cost if wrong: a hand re-run of `ccrc install` no longer repairs a damaged `node_modules` in the pointed-at version; `ccrc update --to <v> --force` still does.
- **D-3428** — (found planning Task 2; consumed by Task 4) every completed install copies the box's stamp (`~/.ccrc/build.json`) and install record (`~/.ccrc/installed`) into its own version directory, as `$VER_STAMP_COPY` (`.ccrc-stamp.json`) and `$VER_RECORD_COPY` (`.ccrc-installed`). The record copy is written last and is the version's completeness mark. `_inst_stamp_shipped` also accepts the kept stamp when the tree ships no `build.json`. Spec §11 says arm 1 is "flip the symlink back, restart the unit, run the gate once more". But `/health` answers the stamp the server read at boot, and the failed install already rewrote it. Without the kept copies, arm 1's gate can never pass and `~/.ccrc/installed` names a build the box no longer runs. The copies are dot-names, so no reader of a release tree's `build.json` mistakes one for an artifact's. Cost if wrong: two small files per version, rewritten on every completed install.
- **D-3429** — (found writing Task 2) `_inst_tree` refuses to place or flip when `~/ccrc` is something this ccrc did not make: a link whose value is not an absolute `$BOX_VERSIONS_ROOT/<name>` naming a real directory (relative, outside the root, dangling, a non-version name, or a target that is itself a link), a regular file, a real `~/ccrc` beside a `~/ccrc.migrating`, or a `~/ccrc.migrating` that is not a directory. The run dies before any copy and leaves both `~/ccrc` and `~/ccrc-versions` untouched, saying so (`$HOME/ccrc and $HOME/ccrc-versions were not touched` — not "nothing was changed", which is false by then: earlier spine steps have written `~/.ccrc`). Spec §11 is silent on these shapes; before W6, `_inst_tree` would rsync through a foreign directory link, and a regular file failed the rsync with no clear cause. `cmd_update` and `cmd_rollback` refuse the same `foreign`/`unreadable` shapes themselves (amended by Task 4): `cmd_update` on the line after its first `_inst_migrate_resume update`, before the old-identity read, the backup and any download; `cmd_rollback` in its kept check's layout `case`, before the release-host question, the lock and `--detach`. Left to the staged spine, the refusal dies at `_inst_tree`, which wave 4's `_upd_step_moved` reads as moved, so the gate and the restore arms would run over the foreign link (an older spine rsyncs `--delete` through it, arm 3 copies through it) and "not touched" would be false on the update path. Cost if wrong: an operator who hand-made such a link must remove it before `ccrc install` or `ccrc update` runs.
- **D-3430** — (found writing Task 2) before any rsync into a version directory — a new name, or the in-place reinstall of the same name (D-3426) — `_inst_tree` removes that directory's `$VER_RECORD_COPY`. From the first byte written until `_ver_keep_state` marks it again at the end of the spine, the version counts as incomplete. A re-placement that dies therefore never leaves a record saying the version holds a finished install, which would otherwise let a later flip back (Task 4) or the no-npm skip (D-3427) trust a half-written tree. This extends D-3428; Task 4's legacy target applies the same void to a kept directory handed to an older spine. Cost if wrong: if a same-name reinstall dies, its version can no longer be flipped back to by arm 1 (arm 2 still can) until an install completes again.
- **D-3431** — (found planning Task 3) spec §11 deletes `~/ccrc.migrating` "only after the gate passes" and says nothing of an install that is not an update. A plain `ccrc install` is its own gate, its doctor tail (`cmd_doctor` rc 0), but only when `~/.ccrc/update.lock` is FREE. A spine that runs while the lock is held is a staged spine, and its doctor is not the gate: the updater that holds the lock removes the directory after `_upd_gate` passes. The first move onto W6 is driven by a box's pre-W6 `ccrc update`, whose gate knows nothing of `~/ccrc.migrating`. When that updater is wave 4's or later it holds the lock, so on that move the directory survives the run, until the next W6 install, update or rollback whose gate passes; an updater older than wave 4 holds no lock, which is D-3435. A rollback by flip whose gate passes removes it too (`_inst_migrate_finish rollback`, Task 4): a rollback's passed gate is a passed gate. `_inst_doctor_tail` takes the lock only when `_ver_layout` reads `linked|migrated`, and releases it only when it took it itself. Cost if wrong: one extra tree of disk for one update cycle on each box.
- **D-3432** — (found planning Task 3) before the migration's `mv`, `~/.ccrc/migrating-to` records the name the new link will point at: one line, tmp-then-rename. `_inst_migrate_resume` completes a crashed migration only from that file. With the marker absent, or naming no placed version, it refuses and names both by-hand remedies (`mv $HOME/ccrc.migrating $HOME/ccrc` to go back; `ln -s $HOME/ccrc-versions/<name> $HOME/ccrc` to go forward). Spec §11 says the next run "completes the link" and does not say to what. A guess — the newest directory, say — could link a tree the crashed run never finished placing. Cost if wrong: one more file under `~/.ccrc`, removed with the directory.
- **D-3433** — (found writing Task 3) `cmd_update` runs `_inst_migrate_resume update` a second time, on the line after the staged spine returns. Spec §11 says the NEXT `ccrc install`/`update` completes a crashed migration; it says nothing of a staged W6 spine that dies inside the window during THIS update — since D-3436, only by being killed between the `mv` and the link (a failed `ln` moves the tree back inside the spine itself). This guard is PARENT code, so it runs only under a W6 updater; on a box's first move onto W6 the parent is wave 4's and has none of it (D-3438). Left alone, the parent's gate probes a unit whose tree is gone, arm 2's child `bash "$BOX_TREE_DIR/ccd/ccrc" update …` cannot even start, and arm 3's `_upd_restore_copy` runs `mkdir -p -- "${live%/*}"` — which creates a REAL `~/ccrc/server/` beside `~/ccrc.migrating`, a layout `_ver_layout` then reads `unreadable` and every later install refuses. Completing the link from the marker first puts the gate, the restore arms and the report in front of a linked tree. Cost if wrong: one layout read per update.
- **D-3434** — (found writing Task 3) the migration's link and the resume's are placed with `ln -sn`, followed by `[ -L "$BOX_TREE_DIR" ]`, not the spec's `ln -s`. Measured 2026-09-23 (GNU coreutils 9.4): `ln -s <t> <name>` where `<name>` is already a symlink to a directory creates a link INSIDE that directory and exits 0; `ln -sn` refuses with `File exists`, exit 1 (BSD `ln` takes `-n`, "same as -h"). A real directory at `<name>` still receives a nested link under either flag, and the `[ -L ]` after it is what refuses that shape. Two concurrent plain installs resuming one crash (neither takes the lock) are the case: without `-n` the second run would report success and leave `~/ccrc-versions/<name>/<name>`. The migration's move aside likewise goes through `_plat_mv_notdir`, not a plain `mv`, so a directory that appeared at `~/ccrc.migrating` is refused rather than nested into. Cost if wrong: none — one flag and one test.
- **D-3435** — (found writing Task 3) D-3431 holds only for an updater that takes `~/.ccrc/update.lock`, i.e. one from wave 4 on. A box moved straight from an older release to this wave's (v0.0.11 → W6, skipping wave 4) runs the W6 staged spine under an updater that holds no lock, so the spine's `_inst_doctor_tail` finds the lock free, takes its own doctor as the gate, and removes `~/ccrc.migrating` when that doctor passes — before any health gate, because that updater has none. Nothing on the node distinguishes that spine from a plain install: the stage is a `mktemp -d` path, and the one env marker older updaters pass (`CCRC_UPDATE_VERIFIED`) is set only on verified runs and unset otherwise. Spec §11's "deleted only after the gate passes" therefore reads, on such a box, "after the only gate that updater had, its doctor". Task 8's live half records which kind of updater each box had. Cost if wrong: on a box that skips wave 4, the pre-versioned tree goes on the doctor's word, which is all any pre-wave-4 update ever trusted.
- **D-3436** — (found reviewing Task 3) when the migration's link cannot be placed (`ln -sn` fails, or `[ -L ]` refuses what it made), `_inst_migrate` moves `~/ccrc.migrating` back to `~/ccrc` through `_plat_mv_notdir`, removes `~/.ccrc/migrating-to`, and dies "nothing moved". Spec §11 has a crashed migration completed by the next run; it does not say a failure the running spine can SEE must be left as a crash. Leaving it would put the box's recovery in the hands of the updater's parent, and on the one move that migrates, that parent is wave 4's, which has no resume: its gate fails on a tree that is gone, arm 2 refuses (`~/ccrc/ccd/ccrc is absent`), and arm 3's `_upd_restore_copy` `mkdir -p`s a REAL `~/ccrc/server/` beside `~/ccrc.migrating` — `unreadable`, refused by every later install. Moved back, the box is exactly the pre-W6 directory every wave-4 restore arm was written for (wave 4's FULL `a spine that DIED inside _inst_tree` case is that shape). `_inst_migrate` runs in the staged spine, i.e. in W6's own code, so this holds whoever drove the run. Only when the move back also fails is the crash-pair sentence kept. Cost if wrong: none on the success path; on a failed link, the next install re-runs the migration from the start (its version is already placed, so no second download).
- **D-3437** — (found reviewing Task 3) `_upd_detach` completes a crashed migration (`_inst_migrate_resume "$verb"`) after its lock probe answers 0 and before its `queued` write. Spec §10's re-exec hands the run to `$HOME/.local/bin/ccrc`, the shim, which execs `$HOME/ccrc/ccd/ccrc` and refuses when `~/ccrc` is absent. Without this, `bash <placed>/ccd/ccrc update --detach --to <v>` (the only way to reach the verb on a crashed box) would print `detached`, exit 0, and leave a `queued` report that no run ever advances. It runs unlocked, as a plain install's resume does (the parent must hold no lock at the spawn, wave 4 Task 3); a probe that answered 0 means no update owns the link, and a concurrent resume that wins the race leaves the loser's `ln -sn` refused with nothing changed. `cmd_rollback`'s kept check gets the same resume (Task 4). Cost if wrong: one layout read per `--detach`.
- **D-3438** — (found reviewing Task 3) every box's first move onto W6 — the one move that migrates a real `~/ccrc` — is driven by its wave-4 `ccrc update`. Only the staged spine is W6's; the parent (its gate, `_upd_restore` arms 2 and 3, its report) is wave 4's code, so two W6-parent protections do not exist on that move: the post-spine resume (D-3433) and arm 3's void of the kept record (D-3441, Task 4). Two holes remain there, named and not closed:
  1. The staged spine KILLED inside the two-syscall window (a failed `ln` no longer reaches this, D-3436): wave 4's arm 3 creates a real `~/ccrc/server/` beside `~/ccrc.migrating`, which `_ver_layout` reads `unreadable`. By hand, back to the pre-W6 box: `mv ~/ccrc ~/ccrc.restore-debris && mv ~/ccrc.migrating ~/ccrc && rm ~/.ccrc/migrating-to`, then the update again. It is not repaired automatically: a real `~/ccrc` beside `~/ccrc.migrating` is also what an operator's half-done repair or a hand-made tree looks like, nothing on the node records which one it is, and moving a real `~/ccrc` aside on that inference is the destructive guess `unreadable` exists to refuse (D-3429).
  2. A migration that SUCCEEDED, then a failed gate AND a failed arm 2: wave 4's arm 3 copies the pre-update dists through the link into `~/ccrc-versions/<W6_TAG>`, whose `.ccrc-installed` (the staged spine's `_ver_keep_state install`) still claims a complete install of what is now a MIXED tree; a later W6 flip to that tag would trust it. By hand: `rm ~/ccrc-versions/<W6_TAG>/.ccrc-installed` (the next completed install from that tag re-marks it, D-3430). It is not closed by having `_ver_keep_state install` skip the record under another process's lock: that would leave EVERY box's first W6 version unmarked on the success path too, blinding arm 1 and the no-npm skip for the very version the next rollback returns to, to close a hole that needs two failures in one run.
  Task 8's live half checks each box for both shapes after the first rollout. Cost if wrong: a box that meets either shape on its first move needs the by-hand remedy named here.
- **D-3439** — (found planning Task 4) arm 1 (and a rollback by flip) is `_ver_flip_back`: flip, restore the kept stamp, CLEAR `~/.ccrc/installed` and the caps file, run the kept version's OWN `ccrc install` from the flipped tree (`--role <role>` when a role is recorded, bare otherwise — `--role ""` is a usage error), let that spine's `_inst_installed` write the record back, and then run the gate. The record is cleared rather than restored before the spine because a record written first would make "the spine completed" true for a spine that never ran; the spine rewrites it byte-equal to the kept copy, since the verified flag below is derived from that copy (amended by Task 4). Spec §11 says flip, restart, gate. The spine re-places what the tree feeds outside itself: `~/.local/bin/ccd` and the other executables, the session hooks, the units. Without it a rollback sweeps the supervisors onto the `ccd` of the build it rolled away from. It is offline for any W6-placed version (D-3427). It passes `CCRC_UPDATE_VERIFIED=1` exactly when the kept record's line 2 is not `unsigned`, so a verified version stays verified and an unverified one is not promoted. Its `_inst_enable` is the restart. Cost if wrong: a flip back takes a spine's time (tens of seconds) instead of one restart; a step that converges a pinned third-party tool may still reach its own index.
- **D-3440** — (found planning Task 4) when the staged tree's `ccd/ccrc` has no `BOX_VERSIONS_ROOT=` line (a release older than this wave), `cmd_update` first flips `~/ccrc` to a directory named for the TARGET tag, then runs that tree's spine. It does so after the backup, `previous` and `UPD_PREV_UNSIGNED` are written and BEFORE it clears the record, the install-step marker and the caps, so a refusal leaves all three as they were and "nothing was installed" is true. The directory is the kept one — whose `$VER_RECORD_COPY` is removed first, since a spine that keeps nothing is about to rewrite it, until `_ver_keep_state update` re-marks it after that spine completes — or else a `cp -a` of the pointed-at version with its two kept copies removed (and removed again if the flip then fails). A symlink or non-directory at that name is refused (amended by Task 4). The old spine's rsync then writes through the link into a directory whose name is true. Reachable by arm 2's child, a `--to <old> --downgrade`, and a rollback with no kept directory. Spec §11 is silent on an older spine meeting the link; without this the directory named for the NEW build ends up holding the old one. Cost if wrong: one `cp -a` of a tree, a few seconds and its disk, before a downgrade.
- **D-3441** — (found planning Task 4) arm 3 copies the pre-update dists back through the link, into the directory named for the build it is backing out of, which then holds a MIXED tree. So on a versioned box arm 3 also removes that directory's `$VER_RECORD_COPY`, before it copies anything. That makes the version incomplete: no later flip returns to it, and GC treats it as prunable by hand. The void runs before arm 3's first copy, as D-3260's removal does. This extends wave 4's D-3260, which removes `~/.ccrc/installed` for the same reason. Cost if wrong: a later arm 1 finds no kept version and uses arm 2.
- **D-3442** — (found planning Task 4) wave 4's `cmd_rollback` asks the release host whether the tag exists (`_upd_asset_listed <tag> SHA256SUMS`, D-3244) before the lock. When `~/ccrc-versions/<tag>` is a complete kept version, the directory answers that question: the tag was installed and completed here. The rollback asks no network question and downloads nothing. Spec §11's "`rollback` refuses an unknown tag at exit 2" still holds for any tag that is neither kept nor published. When the flip then cannot reach the kept version (`_ver_flip_back` rc 1), the rollback falls back to wave 4's in-process re-install WITHOUT the existence question the kept arm skipped, so a tag that is not published dies in `_upd_resolve` at exit 1, not 2 (amended by Task 4). Cost if wrong: a kept version of a release later deleted from the host can still be flipped to — the bytes are the ones this box verified.
- **D-3443** — (found writing Task 4) spec §11 lists arm 1 → arm 2 → arm 3 as a fall-through and says nothing of what a failed arm 1 leaves behind. Arm 1 flips `~/ccrc` to the kept previous version, restores its stamp and re-runs its spine. A failure there (the spine did not complete, or the gate once more failed) leaves the box pointing at `<prev>`, with `<prev>`'s stamp and, when its spine completed, `<prev>`'s record. Arm 2's child would then be `<prev>`'s own ccrc, not the NEW tree's as wave 4's arm 2 assumes, and its `_upd_converged` would read the box as already on `<prev>` and install nothing. Arm 3 would copy the backup into `<prev>`'s directory and void a version that was never mixed. So a failed arm 1 points `~/ccrc` back at the version this run installed (`_plat_ln_swap` to the saved `VER_CURRENT`) and removes the completed-install record before arm 2 runs; a failed rename-back or removal is named in arm 1's failure line. Cost if wrong: one more rename, and a record that arm 2's child or arm 3 would rewrite or remove anyway.
- **D-3444** — (found reconciling Task 4 against wave 4's committed plan) spec §11's arm 1 "runs the gate once more", and `_upd_gate` is wave 4's one gate: it rewrites `UPD_GATE_WHY` on every probe. Wave 4 Task 5's exit-4 sentence, `<v> was installed, but the box did not come back healthy on it ($UPD_GATE_WHY) — exit 4`, is printed after `_upd_restore` returns (Task 6 left it there, "still true after a restore"), so a passing arm 1 would give its own PASS measurement as the reason the NEW build failed. Arm 1 therefore saves `UPD_GATE_WHY` on entry and restores it after the re-gate, on both results, and reads the re-gate's own answer into its failure line first. Cost if wrong: none — one local and two assignments; arm 2's child and arm 3 never gate in this process.
- **D-3445** — (found reviewing Task 4) spec §11's arm 1 is "a kept version directory for the previous tag → flip back". It says nothing of a box whose `~/ccrc` never left that version. Under W6 that is the shape a staged spine leaves when it dies inside `_inst_tree` before its flip, for instance `npm ci` in `~/ccrc-versions/<new>/server` on a registry hiccup. Wave 4's `_upd_step_moved` reads an `_inst_tree` death as moved, so the gate runs and fails on the version. The draft sent that to arm 2, whose child re-downloads `<prev>`; its W6 spine's same-name path (D-3426) voids the running version's kept record, rsyncs `--delete` into the directory the live units run from, and runs `npm ci` there, which empties `node_modules` before it fetches. With the registry still down, arm 3 then restarts a unit with no deps. So when `VER_CURRENT = <prev>` and `<prev>` is kept complete, arm 1 restores in place: `_ver_flip_back`'s rename is onto the same target, the kept stamp is restored, and the kept spine runs from that physical version, which is Task 2's `running` answer with its kept record present, so it copies nothing and runs no `npm ci`. Then the gate runs once more. Arm 2 runs only when that fails, and a failed in-place attempt still clears the record, so arm 2's child re-installs rather than reading the box converged. Cost if wrong: a spine's time spent re-running the version that was already running before arm 2 gets its turn.
- **D-3446** — (found planning Task 5) spec §11's running guard is "`systemctl --user show -p ExecStart` through `readlink -f`". That reads the unit's DEFINITION and resolves it through `~/ccrc` at the moment GC runs. A command naming `$HOME/ccrc/…` resolves to the pointed-at version, which is protected anyway. The guard's real subject is a command that names a versions path directly, or one this reader cannot resolve. A process started before the last flip is not seen, and does not need to be: every flip in this tree restarts the unit it moved (`_inst_enable`; arm 1's spine), and GC runs only after a passed gate (D-3451) or by hand. A unit counts as not running only when the service manager answers `inactive|failed`. The tree path is read from `argv[]`, never from `path=` (which is `/usr/bin/env`). The Darwin arm reads the job's generated plist (`_svc_plist`, `plutil -convert json`, `jq -e` over `ProgramArguments`, one surrounding quote and trailing `;` stripped per token). Cost if wrong: a unit hand-edited to run from a physical path is protected; one hand-restarted from a pruned version would already have failed at start.
- **D-3447** — (found planning Task 5) any GC input that cannot be measured stops the whole prune, and nothing is removed: a running unit whose command does not parse (or whose job file's `ProgramArguments` cannot be read), a version prefix `readlink -f` cannot resolve (BSD before macOS 12.3 answers empty; D-3449), a unit state the service manager did not answer or answered with an unrecognised word (`_svc_is_active`'s empty answer is, by its own contract, a question never asked), a kept install record whose mtime cannot be read (the keep-N order depends on it), a projection that reads `unreadable`, `stale` or `malformed`, or a `~/.ccrc/previous` that reads rc 3 (amended by Task 5). Spec §11 lists guards and says nothing of an input that cannot be read. Treating one as "no protection" prunes the version the guard exists for. The automatic GC prints one WARN line and the install goes on; `ccrc versions --prune` exits 1 naming the input. Cost if wrong: disk kept until the input reads again.
- **D-3448** — (found planning Task 5) a version directory with no kept install record is `incomplete` (a placement that died, or one arm 3 voided). The automatic GC never removes one, because a concurrent plain `ccrc install`, which takes no update lock, may be placing it at that moment. `ccrc versions --prune` does remove them, since it is an operator's act under the lock. Spec §11 does not distinguish the two. Cost if wrong: dead placements stay until someone prunes by hand. **Amended in review of Task 5:** the update lock does not exclude a plain install, so a `--prune` run beside one removes the directory that install is placing. That install then dies on its own rsync or `npm ci`, or at the flip's re-check (D-3456). `~/ccrc` stays on the version it named, and the install can be run again.
- **D-3449** — (found writing Task 5) spec §11's running guard reads each running unit's `ExecStart` "through `readlink -f`". GC calls `readlink -f` on the token's version PREFIX — `$HOME/ccrc`, or `$HOME/ccrc-versions/<seg>` — never on the whole token. Measured 2026-09-23 with GNU coreutils 9.4, `readlink -f` of a path whose parent directory is missing answers empty with rc 1. A server-role version has no `agent/dist/`, and a hand-edited unit can name a file that has since gone. In either case a whole-token read would be unmeasured on every run and would stop every prune on that box (D-3447). The prefix alone decides which version a command runs from. Cost if wrong: a token such as `$HOME/ccrc/../ccrc-versions/<x>/…` resolves by its first segment; no unit this tree writes spells one.
- **D-3450** — (found writing Task 5) the automatic GC and `ccrc versions --prune` read nothing at all — not previous, not the projection, not the service manager — while there are no more complete versions beside the pointed-at one than `CCRC_VERSIONS_KEEP` (and, for `--prune`, no incomplete one). A protection can only take a version out of the removal set, so it can never make one prunable, and in that state nothing is prunable whatever the inputs say. Without this, a first install on a `both` box would print a GC WARN about a box with one version, because W2's server has not yet written the projection there, and every install and update in the suites would gain `systemctl show` calls. Cost if wrong: none; an unmeasurable input is still reported the moment there is something it could protect.
- **D-3451** — (found writing Task 5) the automatic GC runs only where a gate is known to have passed. For a plain `ccrc install`, that is `cmd_doctor` rc 0 under a lock the install took itself, the same condition under which `~/ccrc.migrating` is removed (D-3431). For `cmd_update`, it is `_upd_gate` passing, D-3114's exit-3 arm included. It never runs after a failed gate or under `--no-gate`, and never inside arm 1, arm 2's child or a rollback by flip: their spines run under the parent's lock, so `_ver_lock_try` answers rc 1 there, and `cmd_rollback`'s kept path makes no GC call of its own (a rollback that falls through to the re-install prunes through `cmd_update`'s). Spec §11 does not say when GC runs, and the coordinator's decisions say "after every completed install"; a completed install whose doctor FAILed, or a restore in flight, is exactly the box that may need any kept version. Cost if wrong: after a failed install the extra versions stay until the next passing install or update, or `ccrc versions --prune`.
- **D-3452** — (found planning Task 6) spec §11's audit gives `cmd_uninstall` "a sweep of `~/ccrc-versions/`". It also removes a stray `~/ccrc.migrating` (the pre-versioned tree, kept until a gate that will now never run) and `~/.ccrc/migrating-to`. An uninstalled box that left either behind would hand a later install a migration pair it could only refuse. **Amended in Task 6's review:** it also removes a staged `~/ccrc.new`, but only when that is a symlink. Task 1's `_plat_ln_swap` leaves one when a process is killed between its `ln -sfn` and its rename, and by Task 1's contract only the next flip replaces it. An uninstalled box flips nothing, so the link would stay in `$HOME` pointing into the versions root the sweep just removed. Anything else at that name is left in place, and the transcript names it. Cost if wrong: none; all three are ccrc's own writes.
- **D-3453** — (found reviewing Task 6) spec §11's audit gives `cmd_uninstall` only "a sweep of `~/ccrc-versions/`", and wave 4's `_uninst_tree_bins` removes `~/.ccrc/update.lock` on the assumption that "an uninstalled box has no update in flight". This plan's other writers touch the versions root and `~/ccrc.migrating` only under that lock (Task 5's `--prune` takes `_upd_lock`; Task 3's migration finish takes `_ver_lock_try`). An update or rollback in flight could be placing into, or flipping to, a version the sweep removes. A `--detach` one runs in a transient unit that `_uninst_units` never stops. Its rename would then re-create `~/ccrc` pointing at nothing. So `cmd_uninstall` now probes the lock with wave 4's `_upd_lock_probe` after the live-session gate and BEFORE anything is removed. rc 1 (held) and rc 3 (unmeasured, never folded, following the rule ruling R16 sets for wave 4's callers) each refuse with their own sentence. rc 2 (no `flock`) proceeds: no updater that takes the lock runs without one. `--force` skips the probe, as it passes the live-session gate. Cost if wrong: an operator uninstalling beside a live update waits for it or passes `--force`. D-3251's window between a detaching parent's probe and its child's acquire stays open.
- **D-3454** — (found writing Task 7) spec §11's audit table covers two unit lines, `ccrc.service:19` and `ccrc-agent.service:7`, and was written before wave 4. Task 7's walk instead collects every non-comment `%h/ccrc/<path>` token in every tracked `.service`/`.timer`/`.conf` under `deploy/` and `ccd/`, and requires each to exist in the fixture version and resolve through the link into it. That covers wave 4's `ccrc-update-watchdog.service` `ExecCondition=` token `%h/ccrc/ccd/ccrc`, and reds on any future unit that names a tree file the fixture lacks. Cost if wrong: a unit that names a new tree file reds the audit until `installTreeFixture.ts` gains the file and the row is walked again.
- **D-3455** — (found writing Task 8) the fixture half of the rehearsal runs before this wave merges, so every published release predates W6. `N` and `N-1` are only ever SPINES there, each on D-3440's path, and the W6 code runs from the checkout and its placed copy `untagged-<sha12>`. Three paths are therefore first measured on real bytes by the live half, not by the rehearsal: a W6 artifact's own spine placing a tag-named directory from a staged tarball and flipping to it (Task 2's case (d) under `update`); arm 1 into a W6-placed version's offline spine (D-3427); and a W6 updater's legacy check answering "not legacy". The fixture suites of Tasks 2 and 4 carry those rows. Spec §11's exit criterion names "the real newest release" and assumes nothing about its age. Cost if wrong: a defect specific to W6 artifacts surfaces at the live half's `rollout --to <W6_TAG> --force`, on the fleet node first, with arm 2 as the restore.

## Rehearsal record (Task 8 fills this in; nothing below is assumed)

Spec §11's exit criterion, fixture half (D-3421). Task 8 records every command it ran, its exit code and the lines that decide it, verbatim (scratch paths as `$S`/`$H`), then lists the live half's commands for the coordinator, who runs them at rollout.

<!-- REHEARSAL RECORD: task 8 -->
- **D-3456** — (found reviewing Task 5) `_inst_tree`'s flip measures its target again, just before `_plat_ln_swap`: a real directory, not a link, that carries `ccd/ccrc`. If not, the install dies `the new tree at $HOME/ccrc-versions/<name> is gone before the flip — …` and `~/ccrc` is untouched. Spec §11 specifies the flip as the rename alone. Task 5 adds a remover that can run BESIDE a plain install, which takes no update lock. `ccrc versions --prune` removes the incomplete directory the install is placing (D-3448). Another run's automatic GC can remove a complete version this install is about to flip onto, which is neither pointed-at nor previous until the flip lands. `_plat_ln_swap` never checks its target, and a flip onto a directory that is gone leaves `~/ccrc` dangling. Every later install then refuses it as `foreign`, and `_inst_enable` restarts the units onto nothing. `_inst_migrate` already measures the layout again for the same reason. Not done: holding `~/.ccrc/update.lock` across a plain install's placement and flip. That would close the window instead of narrowing it, but it changes wave 4's lock contract (a `ccrc update` would refuse `another update holds …` for the length of every plain install), so it was the coordinator's to rule — RULED 2026-09-23 (R19): the re-measurement stands, the lock is not held across a plain install. Cost if wrong: a removal inside the instant between the check and the rename still leaves a dangling `~/ccrc`. It is then repaired by hand with `ln -sfn $HOME/ccrc-versions/<a kept version> $HOME/ccrc`, followed by an install.
- **D-3457** — (Task 2, found in review) `cmd_update` does not take wave 4's `_upd_step_moved` reading ("a marker of `_inst_tree` or later: the tree WAS replaced") as final for a death inside `_inst_tree`. It reads `_ver_layout` before the staged spine and again after the death. When the staged spine is W6's (it declares `BOX_VERSIONS_ROOT`), the release's name is not the pointed-at version, and `~/ccrc` still points at the version it pointed at — or a `foreign`/`unreadable` `~/ccrc` still reads the same word — the death is classified as nothing replaced: exit 1, `spine died at _inst_tree, before its flip: nothing was replaced (…)`, no gate, no restore. Spec §11 separates "nothing replaced" (exit 1) from "the tree is replaced" (gate, then restore), and since this task the tree is replaced at the flip, `_inst_tree`'s last act, not at its first byte. The marker cannot see inside the step, and `CCRC_INST_SPINE` gains no step. Left as moved, the commonest failure, `npm ci` against a registry that is down, is gated on the old build and fails. Arm 2's child then re-installs the running tag IN PLACE (case (c)), rewriting the running tree the wave exists to leave alone. Task 4's in-place arm 1 (D-3445) would intercept first and spare the tree, but it would still restore and restart a box nothing touched and exit 4 `reverted`, which halts a rollout. Cost if wrong: a W6 spine that dies before its flip is reported with exit 1 and not restored. That is correct only because nothing moved, and the rule is guarded on the three facts that make it so: the spine's version, the name, and the link, re-read.

## File structure

- `ccd/ccrc` — MODIFY. The platform layer's `_plat_ln_swap` (Task 1). Constants `BOX_VERSIONS_ROOT`, `BOX_MIGRATING_DIR`, `VER_NAME_RE`, `VER_STAMP_COPY`, `VER_RECORD_COPY` (Task 2) and `BOX_MIGRATION_FILE` (Task 3), after `BOX_BACKUP_ROOT="$HOME/ccrc-backups"` (`:1324` at `d759c914`). Globals `VER_LAYOUT`, `VER_CURRENT`, `VER_WHY` (Task 2, after `BOX_HEALTH_WHY=""`, `:1394`) and `VER_NAMES`, `VER_RUNNING`, and the `declare -gA` maps `VER_PROTECT`, `VER_VERDICT`, plus `VER_DOOMED`, `VER_DOOMED_WHY` (Task 5, after `VER_WHY`). New `_ver_layout`, `_inst_version_name`, `_ver_keep_state` (Task 2); `_inst_migrate`, `_inst_migrate_resume`, `_inst_migrate_finish`, `_ver_lock_try`, `_inst_doctor_tail` (Task 3); `_ver_kept`, `_ver_flip_back`, `_upd_restore_arm1`, `_upd_legacy_target` (Task 4); `_ver_list`, `_ver_running_names`, `_ver_protect_add`, `_ver_protect`, `_ver_verdicts`, `_ver_gc`, `cmd_versions` (Task 5). Changed: `_box_build_fields`' header comment (Task 2, its third caller), `_inst_tree` (`:9516-9638`; Tasks 2 and 3), `_inst_stamp_shipped` (`:9956-9981`), `_inst_installed` (wave 4's split), `cmd_install` (the Darwin preflight, the resume before the spine loop, both doctor tails), `cmd_update` (the resume twice — after `UPD_REPORTING=1` and after the staged spine — the legacy target above the record's removal, keep-state before the gate, the one post-gate finish and GC, the `--check` crashed line), `_upd_restore` and `_upd_restore_arm3` (wave 4's), `cmd_rollback` (wave 4's), `CCRC_CAP_WORDS` (`versions`, `:1144`), `_bak_prune`'s neighbourhood (Task 5's block after it, `:12270-12288`), `cmd_uninstall`'s update-lock gate and `_uninst_tree_bins` (`:12698`) (Task 6), the dispatch table (`:12908-12925`), `usage()` (`:1471-`).
- `ccd/ccd` — MODIFY (Task 1). `_plat_ln_swap` inside its platform layer, byte-identical to `ccd/ccrc`'s; line 2 re-stamped with `markGenerated`.
- `server/test/macos-platform.test.ts` — MODIFY (Task 1). Imports; the Linux-arm table gains `_plat_ln_swap`'s row; a new describe runs both arms (forced Darwin on both runners, the three GNU `mv -fT` cases `itLinux` with `PLATFORM-ONLY:` markers) and pins their argv; one case in the real-Darwin describe.
- `server/test/installTreeFixture.ts` — MODIFY (Task 2). `symlinkSync` import; new export `installVersionedTree`.
- `server/test/ccrc-install.test.ts` — MODIFY. The `python3` stub's `-c` arm (spread in only when python3 resolves), `pathWithout`'s `ln`/`readlink`, the destination assertions moved to the version directory, and the versioned `_inst_tree` describe (Task 2); the self-copy case (`:1044-1063`) becomes the migration's, wave 4's order pin (`:1907`) and its `ends with cmd_doctor` pin (`:2014`) move to `_inst_doctor_tail`, plus the migration and crash describe (Task 3); the caps cases (Task 4); the systemctl stub's `show -p ExecStart` arm, `ccrcEnv`'s `CCRC_VERSIONS_KEEP` delete, and the after-install GC case (Task 5).
- `server/test/runbook-holds.test.ts` — MODIFY (Task 3). FACT 1 searches `cmd_install` for `_inst_doctor_tail`, not a bare `cmd_doctor`.
- `server/test/ccrc-update.test.ts` — MODIFY. The `python3` stub's `-c` arm and a FULL versioned-box case after the happy path (Task 2); migration under an update, both resumes and the finish (Task 3); the `fixture-health-deny` knob, a file-scope fixture block, arm 1, rollback by flip, the legacy target, arm 3's void, `CAPS_NOW` (Task 4); the systemctl stub's `show -p ExecStart` arm, `updateEnv`'s `CCRC_VERSIONS_KEEP` delete, and `ccrc versions`/GC (Task 5); `homeSnapshot` records a link's target, the `--check` versioned twin and its harness self-test (Task 7).
- `server/test/ccrc-uninstall.test.ts` — MODIFY (Task 6). `plantInstalledBox` gains a versioned shape; wave 4's preserve-case transcript regex gains the `; no ~/ccrc-versions` suffix; the sweep's cases (a staged `~/ccrc.new` among them); two `itLinux` update-lock cases with a real holder.
- `server/test/ccrc-cli.test.ts` — MODIFY (Task 5). The usage verb-list pin (`:181`) gains `versions`, and an entry pin.
- `server/test/single-definition.test.ts` — MODIFY (Tasks 2, 4). The stamp census gains two lines (`_ver_keep_state`'s, `_ver_flip_back`'s) and the install-record census four (`_ver_keep_state`'s; `_ver_flip_back`'s, `_upd_restore_arm1`'s and `cmd_rollback`'s).
- `server/test/ccrc-versioned-audit.test.ts` — CREATE (Task 7). Spec §11's satisfied audit rows walked through a fixture symlinked `~/ccrc`, one fixture home per case.
- `server/test/session-hook.test.ts` — MODIFY (Task 9). The census literals, re-measured by S6-R11.
- `README.md`, `CLAUDE.md` — MODIFY (Task 9). A new "Versioned installs, and rollback by flip." paragraph, the two wave-4 paragraphs this wave falsifies, the uninstall sentence, the manual-rollback recipe, README's two `ccd/ccd` anchors re-anchored by content; the Deploy bullet and the README size claim.
- `docs/superpowers/plans/2026-09-23-centralised-update-w6-versioned-installs.md` — this plan; Task 8 fills its `## Rehearsal record`, and its Deviations list grows as reviews find departures.
- Built in the checkout, not tracked (Task 8): `server/dist/`, `server/dist-pwa/` and, when absent, `pwa/node_modules` — the rehearsal installs from the checkout.

---

## Tasks

### Task 1: The atomic symlink flip, portable

**Files:**
- Modify: `ccd/ccrc` — inside `# ── THE PLATFORM LAYER` (`:70`) … `# ── END PLATFORM LAYER` (`:1031` at `d759c914`): a new `_plat_ln_swap`, with its header comment, immediately after `_plat_mv_notdir` (`:211-219`) — between that function's closing `}` + blank line and the comment `` # `stat -c` -> `stat -f`. `` (`:221`). Re-locate by `grep -n '^_plat_mv_notdir() {' ccd/ccrc`; wave 4 does not edit the block (its plan's Global Constraints: "No new platform helper is expected"), so the spot is the same after it merges.
- Modify: `ccd/ccd` — the same bytes at the same place in its block (`_plat_mv_notdir` at `ccd/ccd:152-160`, the `` # `stat -c` `` comment at `:162`, block `:11`–`:972`), then line 2 re-stamped: `node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"` (`ownership.test.ts:131-135`), run from the repo root AFTER the last `ccd/ccd` edit.
- Test: `server/test/macos-platform.test.ts`:
  - imports (`:20`, `:21`, `:24`): `spawnSync`; `readlinkSync`, `statSync`; `itLinux` from `./platformFixtures.js`;
  - the `arms` table of `describe('the Linux arms are the original GNU commands'` (`:281`, the table `:286-299`) gains one row, directly after `_plat_mv_notdir`'s (`:287`);
  - a new describe `_plat_ln_swap: one rename, both arms (W6 Task 1)` directly after `describe('_plat_mv_notdir\'s Darwin arm, forced from Linux (D-2187)'` closes (`:420-601`), i.e. immediately above `// ── Everything below needs a real Darwin userland` (`:603`). It uses that describe's idiom (the platform block alone under `bash -c`, `CCD_OS` assigned after the source) plus recording wrappers. The forced-Darwin cases and every case that never reaches GNU `mv -fT` run on BOTH CI runners; the three that do reach it are `itLinux` with a `PLATFORM-ONLY:` marker (`macos-platform.test.ts`'s own D-2765 scan, `:779-826`), because BSD `mv` has no `-T`;
  - one case inside `describe.skipIf(!IS_DARWIN)('the Darwin arms, run for real'` (`:604`), directly above `it('_plat_uuid answers lowercase, like /proc does'` (`:645`): the same postcondition through the runner's real python3 on APFS.
- Run, not edited: `server/test/ownership.test.ts` (the marker matches the body); `macos-platform.test.ts`'s byte-identical case (`:53-61`), its every-definition-inside case (`:80-97`) and its `gnuOnly` sweep (`:117-135`: no `mv -T` may appear outside the block); the 31 suites that cite a `ccd/ccd:<n>`/`ccd/ccrc:<n>` line (measured green with this edit at `d759c914`, Step 6); `server/test/single-definition.test.ts`, `dtbd.test.ts`, `ccd-reg-set-atomic.test.ts` and `topology-clean.test.ts` (Step 6's second command — none reads the inserted lines, all green with this edit).
- Not chased here: `server/test/session-hook.test.ts` — both files' 64 inserted lines shift its frozen anchors, and exactly four of its cases red (measured at `d759c914`, Step 6); Task 9 re-measures them once (Global Constraints).

**Interfaces:**
- Produces `_plat_ln_swap <target> <link>` → rc 0 iff `<link>` is now a symbolic link whose value is exactly `<target>`, placed by ONE rename over the symlink that stood there, or over nothing. rc 1 otherwise, with nothing at `<link>` changed. The rc-1 cases: something that is not a symlink stands at `<link>` (a real directory or file — the migration's case, never this helper's; refused, never moved into); something that is not a symlink stands at `<link>.new` (a file or a directory: refused before `ln` runs, and left as it was); `ln` fails; or the rename fails, and the staged `<link>.new` is then removed. It prints nothing (the three tools' stderr is discarded) and never dies. `<target>` is written verbatim; every caller passes an absolute `$BOX_VERSIONS_ROOT/<name>`. The staged name is `<link>.new`, which for the tree is the spec's own `$HOME/ccrc.new`. **Nothing serializes that name** (D-3424): an update's flip runs in its staged spine while the parent holds `~/.ccrc/update.lock`, but a plain `ccrc install` takes no lock before its doctor tail (Task 3, D-3431), so two concurrent plain installs, or one beside an update, can interleave on `<link>.new` — both `ln -sfn` it, the first rename installs the SECOND caller's target and answers 0, and the second finds no `<link>.new`, answers 1 (its caller, Task 2's `_inst_tree` step 5, dies `could not point $HOME/ccrc at …`) while `~/ccrc` names its own target. Each step is one rename, so every reader resolves `~/ccrc` to a placed version at every instant; what the race costs is the truth of the two exit codes. The header says so; no lock is taken around the flip (the deviation says why none can be).
- Arms, in order: `if [ ! -L "$2" ] && [ -e "$2" ]; then return 1; fi`; `if [ ! -L "$2.new" ] && [ -e "$2.new" ]; then return 1; fi`; `ln -sfn -- "$1" "$2.new" 2>/dev/null || return 1`; then `if [ "$CCD_OS" = darwin ]; then python3 -c 'import os, sys; os.replace(sys.argv[1], sys.argv[2])' "$2.new" "$2" 2>/dev/null …; else mv -fT -- "$2.new" "$2" 2>/dev/null …; fi`, each followed by `|| { rm -f -- "$2.new"; return 1; }`. A STALE LINK at `<link>.new` gets no `rm` of its own: `ln -sfn` replaces it by itself (`-f`; `-n` so a link to a directory is replaced, not entered — measured under strace, GNU does it as `symlinkat` to a temp name + `renameat`), so the recorded argv of a stale-link flip is the same two calls as any other. The Linux arm is the spec's argv verbatim: measured 2026-09-23 under `strace`, GNU coreutils 9.4, as `renameat2(…, RENAME_NOREPLACE) = -1 EEXIST` then `renameat("<link>.new", "<link>") = 0`, with no `unlink`; python3 3.12's `os.replace` is one `rename("<link>.new", "<link>") = 0` (D-3419).
- The Linux-arm pin row, exactly: `['_plat_ln_swap', /else\s*\n\s*mv -fT -- "\$2\.new" "\$2"/]` (the body may reshape the arm's continuation only if it re-pins this row in the same commit).
- Tests (argv pinned, spec §11 Pins "the flip is `mv -T` (argv pinned)"): on each arm, recording `ln`/`mv`/`rm`/`python3` wrappers first on a scratch `PATH` that `exec` the real tools (resolved before the wrappers exist, with `spawnSync(…).stdout.trim()` — never `execFileSync`, whose throw on `command -v python3`'s rc 1 would red all fourteen cases on a runner with no python3, the Linux-arm ones included; there no python3 wrapper is planted unless the case makes it fail, and the three forced-Darwin cases that run the real `os.replace` — the argv case, the stale-link case and the absent-`<link>` case — are `itPy`, `it.skipIf(REAL.python3 === '')`, while every other case still runs). On Linux the recorded argv are exactly `ln -sfn -- <target> <link>.new` and `mv -fT -- <link>.new <link>`; on the forced-Darwin arm `ln` is the same and then `python3 -c <program> <link>.new <link>`, with no `mv` and no `rm`. The postconditions on both arms: `lstat(<link>)` is a symlink, `readlink(<link>) === <target>`, the OLD target directory's listing is unchanged, and no `<link>.new` name is left (checked with `lstat`, so a dangling one counts). A real directory at `<link>` → rc 1, no tool called, its listing and mtime unchanged. A file or a directory at `<link>.new` → rc 1, no tool called, it is untouched and `<link>` still names the old target. A failed rename (the tool's wrapper exits 1) → rc 1, `<link>` unchanged, `<link>.new` removed by the last call, `rm -f -- <link>.new`. A stale symlink at `<link>.new` is replaced with the plain two-call argv. A swap onto a `<link>` that does not exist → rc 0.
- Consumes: nothing new — `CCD_OS` (the block's own), `ln`, `mv`, `rm`, `python3`.
- Mutation rows (each measured at `d759c914`, Step 7): spec §18 "the flip is a rename" (`ln -sfn` onto `<link>` directly → both argv cases, both failed-rename cases and both stale-link cases red — 6); the Linux arm rewritten as `mv -f` (no `-T`) → the Linux-arm row, the Linux argv case and the Linux stale case red — 3 (the postcondition is false too: measured by hand, GNU `mv -f` moves `<link>.new` INSIDE the old version and `<link>` keeps its old value, the D-2187 shape; the argv assertion is simply the first to fire); the Darwin arm handed to `_plat_mv_notdir` (its `rm` of `<link>` is the window) → the Darwin argv, failed-rename and stale cases red — 3; the real-directory guard deleted → both real-directory cases red — 2; the staged-name guard deleted → all four staged-name cases red; either arm's `rm -f -- "$2.new"` clean-up dropped → that arm's failed-rename case reds; the block diff (edit only `ccd/ccrc`'s copy → the byte-identical case reds); the marker (skip the re-stamp → `ownership.test.ts` reds, Step 5).

- [ ] **Step 1: Write the failing tests**

In `server/test/macos-platform.test.ts`, three import lines change. `:20`:

```ts
import { execFileSync, spawnSync } from 'node:child_process';
```

`:21` gains `readlinkSync, statSync` at its end:

```ts
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, linkSync, symlinkSync, chmodSync, readdirSync, lstatSync, existsSync, readlinkSync, statSync } from 'node:fs';
```

and after `import { CCD } from './ccdWsHelpers.js';` (`:24`):

```ts
import { itLinux } from './platformFixtures.js';
```

In the `arms` table of `describe('the Linux arms are the original GNU commands'`, directly after the `_plat_mv_notdir` row (`:287`):

```ts
    ['_plat_ln_swap', /else\s*\n\s*mv -fT -- "\$2\.new" "\$2"/],
```

Directly above `// ── Everything below needs a real Darwin userland ────────────────────────` (`:603`, after the D-2187 describe's closing `});` at `:601`), the new describe:

```ts
// W6 Task 1 — `_plat_ln_swap`, the flip of `$HOME/ccrc` (spec 2026-09-20 §11
// Pins: "the flip is `mv -T` (argv pinned)"; §18 "the flip is a rename").
// Every case runs the REAL platform block, sliced out of ccd, under `bash -c`
// with `CCD_OS` assigned AFTER the source (the rule the describe above
// states), and with RECORDING `ln`/`mv`/`rm`/`python3` wrappers first on PATH
// that `exec` the real tool — so what is pinned is the argv the helper
// issued AND what the filesystem looks like afterwards, never one without
// the other. The argv alone would pass a wrapper that lied; the
// postcondition alone would pass a non-atomic unlink-then-symlink.
describe('_plat_ln_swap: one rename, both arms (W6 Task 1)', () => {
  type Os = 'linux' | 'darwin';
  const PY = 'import os, sys; os.replace(sys.argv[1], sys.argv[2])';

  interface Fx { d: string; bin: string; log: string; old: string; next: string; link: string }

  /** Whether a NAME exists — a dangling link included, which `existsSync`
   *  (it follows links) would call absent. */
  const lexists = (p: string): boolean => {
    try { lstatSync(p); return true; } catch { return false; }
  };

  // The real tools, resolved ONCE and BEFORE any wrapper is on PATH (a
  // wrapper that `exec`d the bare name would find itself) — and WITHOUT a
  // throw: `execFileSync` throws on `command -v`'s rc 1, so a runner with no
  // python3 would red all fourteen cases, the GNU-arm ones that never call it
  // included (the rule the Global Constraints set for the harness stubs).
  const REAL: Record<string, string> = Object.fromEntries(['ln', 'mv', 'rm', 'python3'].map((t) => [
    t, spawnSync('bash', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim(),
  ]));
  /** The forced-Darwin cases whose rename runs the REAL `os.replace` skip on
   *  a runner with no python3; every other case, on both arms, still runs. */
  const itPy = it.skipIf(REAL.python3 === '');

  /** A scratch dir holding two version-shaped directories (`old` carries a
   *  marker file, so "its listing is unchanged" has something to compare),
   *  `link` → `old` (absolute, as the tree's link is), and the recording
   *  wrappers. `fail` names tools whose wrapper exits 1 WITHOUT running the
   *  real one — how a failing rename is caused on either arm, so that case
   *  needs no real python3 either. */
  function fixture(fail: string[] = []): Fx {
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-ln-swap-'));
    const bin = path.join(d, 'bin');
    mkdirSync(bin);
    const log = path.join(d, 'calls.log');
    for (const tool of ['ln', 'mv', 'rm', 'python3']) {
      const real = REAL[tool]!;
      // Nothing to `exec`: plant no wrapper (only python3 can be missing).
      if (real === '' && !fail.includes(tool)) continue;
      writeFileSync(path.join(bin, tool), [
        '#!/bin/sh',
        // One line per call, argv TAB-separated: the python3 program text
        // has spaces in it, and no path here has a tab.
        `printf '%s' '${tool}' >> '${log}'`,
        `for a in "$@"; do printf '\\t%s' "$a" >> '${log}'; done`,
        `printf '\\n' >> '${log}'`,
        fail.includes(tool) ? 'exit 1' : `exec '${real}' "$@"`,
      ].join('\n') + '\n', { mode: 0o755 });
    }
    const old = path.join(d, 'versions', 'v0.0.1');
    const next = path.join(d, 'versions', 'v0.0.2');
    mkdirSync(old, { recursive: true });
    mkdirSync(next);
    writeFileSync(path.join(old, 'OLD-MARKER'), 'old');
    writeFileSync(path.join(next, 'NEW-MARKER'), 'new');
    const link = path.join(d, 'ccrc');
    symlinkSync(old, link);
    return { d, bin, log, old, next, link };
  }

  function swap(os: Os, f: Fx, target: string = f.next, link: string = f.link):
    { rc: number | null; out: string; calls: string[][] } {
    const script = `${platformBlock(ccd)}\nCCD_OS=${os}\nexport PATH='${f.bin}':"$PATH"\n`
      + `_plat_ln_swap '${target}' '${link}'\n`;
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    const calls = existsSync(f.log)
      ? readFileSync(f.log, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'))
      : [];
    return { rc: r.status, out: `${r.stdout}${r.stderr}`, calls };
  }

  /** The postcondition both arms owe on success. */
  function flipped(f: Fx, target: string = f.next): void {
    expect(lstatSync(f.link).isSymbolicLink(), 'the link must still be a symlink — never a copied tree').toBe(true);
    expect(readlinkSync(f.link), 'the link\'s value must be the target, verbatim').toBe(target);
    expect(readdirSync(f.old), 'nothing may be moved INSIDE the old version (D-2187\'s shape)').toEqual(['OLD-MARKER']);
    expect(lexists(`${f.link}.new`), 'the staged <link>.new must be gone').toBe(false);
  }

  // PLATFORM-ONLY: this arm's rename is GNU `mv -fT`, and BSD `mv` has no `-T`
  // — on the macOS runner there is no binary for it to run. Its pair is the
  // forced-Darwin case below, which runs on BOTH runners.
  itLinux('the Linux arm is the spec\'s argv — ln -sfn to <link>.new, then mv -fT over <link>', () => {
    const f = fixture();
    try {
      const r = swap('linux', f);
      expect(r.rc, r.out).toBe(0);
      expect(r.out, 'the helper prints nothing — the caller owns the sentence').toBe('');
      expect(r.calls).toEqual([
        ['ln', '-sfn', '--', f.next, `${f.link}.new`],
        ['mv', '-fT', '--', `${f.link}.new`, f.link],
      ]);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });

  itPy('the Darwin arm stages the same link and renames it with os.replace — no mv, no rm of <link>', () => {
    const f = fixture();
    try {
      const r = swap('darwin', f);
      expect(r.rc, r.out).toBe(0);
      expect(r.out).toBe('');
      // `_plat_mv_notdir`'s Darwin arm would show here as an `rm` of <link>
      // followed by a `mv -f` — the window this helper exists to close.
      expect(r.calls).toEqual([
        ['ln', '-sfn', '--', f.next, `${f.link}.new`],
        ['python3', '-c', PY, `${f.link}.new`, f.link],
      ]);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });

  for (const os of ['linux', 'darwin'] as const) {
    it(`refuses a real directory at <link> and touches nothing (${os} arm)`, () => {
      const f = fixture();
      try {
        rmSync(f.link);
        mkdirSync(f.link);
        writeFileSync(path.join(f.link, 'LIVE'), 'pre-versioned tree');
        const before = statSync(f.link).mtimeMs;
        const r = swap(os, f);
        expect(r.rc, 'a real directory is the migration\'s case, never the flip\'s').toBe(1);
        expect(r.out).toBe('');
        expect(r.calls, 'refused BEFORE anything is staged').toEqual([]);
        expect(lstatSync(f.link).isDirectory()).toBe(true);
        expect(readdirSync(f.link)).toEqual(['LIVE']);
        expect(statSync(f.link).mtimeMs).toBe(before);
        expect(lexists(`${f.link}.new`), 'nothing may be left staged').toBe(false);
      } finally {
        rmSync(f.d, { recursive: true, force: true });
      }
    });

    for (const kind of ['file', 'directory'] as const) {
      it(`refuses a ${kind} at <link>.new, and leaves both names alone (${os} arm)`, () => {
        // `ln -sfn`'s `-f` would delete a file here and a directory would take
        // the new link inside it — neither is this function's to touch.
        const f = fixture();
        try {
          const staged = `${f.link}.new`;
          if (kind === 'file') writeFileSync(staged, 'not ours');
          else { mkdirSync(staged); writeFileSync(path.join(staged, 'THEIRS'), 'not ours'); }
          const r = swap(os, f);
          expect(r.rc).toBe(1);
          expect(r.out).toBe('');
          expect(r.calls, 'refused BEFORE `ln` runs').toEqual([]);
          if (kind === 'file') expect(readFileSync(staged, 'utf8')).toBe('not ours');
          else expect(readdirSync(staged), 'nothing may be linked inside it').toEqual(['THEIRS']);
          expect(readlinkSync(f.link), 'the running version is still the one pointed at').toBe(f.old);
        } finally {
          rmSync(f.d, { recursive: true, force: true });
        }
      });
    }

    it(`a failed rename leaves <link> where it was and removes the staged name (${os} arm)`, () => {
      // The rename tool's wrapper exits 1 without running it, so this case
      // needs no GNU `mv` and runs on both runners for both arms.
      const f = fixture([os === 'darwin' ? 'python3' : 'mv']);
      try {
        const r = swap(os, f);
        expect(r.rc).toBe(1);
        expect(readlinkSync(f.link), 'the running version is still the one pointed at').toBe(f.old);
        expect(lexists(`${f.link}.new`), 'the staged link must be cleaned up').toBe(false);
        expect(r.calls.at(-1), 'the clean-up is the last act').toEqual(['rm', '-f', '--', `${f.link}.new`]);
      } finally {
        rmSync(f.d, { recursive: true, force: true });
      }
    });
  }

  itPy('replaces a stale symlink left at <link>.new (Darwin arm)', () => {
    const f = fixture();
    try {
      symlinkSync(f.old, `${f.link}.new`);
      const r = swap('darwin', f);
      expect(r.rc, r.out).toBe(0);
      // `ln -sfn` replaces the stale link itself; nothing else is called.
      expect(r.calls).toEqual([
        ['ln', '-sfn', '--', f.next, `${f.link}.new`],
        ['python3', '-c', PY, `${f.link}.new`, f.link],
      ]);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });

  // PLATFORM-ONLY: the rename is GNU `mv -fT` (see the first case's marker);
  // the Darwin twin is the case directly above.
  itLinux('replaces a stale symlink left at <link>.new (Linux arm)', () => {
    const f = fixture();
    try {
      symlinkSync(f.old, `${f.link}.new`);
      const r = swap('linux', f);
      expect(r.rc, r.out).toBe(0);
      expect(r.calls).toEqual([
        ['ln', '-sfn', '--', f.next, `${f.link}.new`],
        ['mv', '-fT', '--', `${f.link}.new`, f.link],
      ]);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });

  itPy('places the link when nothing stands at <link> yet (Darwin arm)', () => {
    const f = fixture();
    try {
      rmSync(f.link);
      const r = swap('darwin', f);
      expect(r.rc, r.out).toBe(0);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });

  // PLATFORM-ONLY: GNU `mv -fT`, as above; the Darwin twin is directly above.
  itLinux('places the link when nothing stands at <link> yet (Linux arm)', () => {
    const f = fixture();
    try {
      rmSync(f.link);
      const r = swap('linux', f);
      expect(r.rc, r.out).toBe(0);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });
});
```

Inside `describe.skipIf(!IS_DARWIN)('the Darwin arms, run for real'`, directly above `it('_plat_uuid answers lowercase, like /proc does'` (`:645`) — `inBlock` is that describe's own helper:

```ts
  it('_plat_ln_swap repoints a symlink-to-directory in one rename, with CCD_OS as the block computed it', () => {
    // The forced-Darwin cases above prove the argv and the postcondition on
    // Linux's rename(2); this is the same postcondition on APFS, through the
    // python3 the runner really has.
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-ln-swap-real-'));
    try {
      const old = path.join(d, 'v0.0.1');
      const next = path.join(d, 'v0.0.2');
      mkdirSync(old);
      mkdirSync(next);
      writeFileSync(path.join(old, 'OLD-MARKER'), 'old');
      const link = path.join(d, 'ccrc');
      symlinkSync(old, link);
      expect(inBlock(`_plat_ln_swap '${next}' '${link}'; echo $?`)).toBe('0');
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe(next);
      expect(readdirSync(old), 'nothing may be moved inside the old version').toEqual(['OLD-MARKER']);
      expect(readdirSync(d).sort(), 'no staged <link>.new may be left').toEqual(['ccrc', 'v0.0.1', 'v0.0.2']);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts`
Expected: FAIL — exactly 15 red (measured at `d759c914`: `15 failed | 58 passed | 11 skipped (84)`; wave 4's `ccd/ccd-update-sync` adds one derived passing case to the GNU-call sweep, so the pass count at dispatch is one higher and the red set is the same): `_plat_ln_swap still runs the GNU command on Linux` (`_plat_ln_swap's Linux arm changed: … to match /else\s*\n\s*mv -fT -- "\$2\.new" "\$2"/`) and all 14 cases of `_plat_ln_swap: one rename, both arms (W6 Task 1)`, each because the function does not exist (`bash: line …: _plat_ln_swap: command not found`, rc 127 where 0 or 1 is owed). The real-Darwin case is skipped on Linux (it is the eleventh skip). Every count in Steps 2 and 4 is on a runner WITH python3, as both CI runners are; on one without, the three `itPy` cases move to skipped (here three fewer red, in Step 4 three fewer passes, and three more skips in both).

- [ ] **Step 3: Implement `_plat_ln_swap` in both copies of the platform block**

In `ccd/ccrc`, after `_plat_mv_notdir`'s closing `}` and the blank line under it (`:219-220`), and immediately above the line `` # `stat -c` -> `stat -f`. Three format letters, three functions, because a `` (`:221`), insert (64 lines, the last one blank):

```bash
# `ln -sfn` + GNU `mv -fT`: repoint a symlink in ONE rename(2) — the flip.
#
# THE FLIP OF `$HOME/ccrc` (versioned installs, spec 2026-09-20 §11): the
# tree is a symlink `$HOME/ccrc -> $HOME/ccrc-versions/<name>`, and moving a
# box onto another version is repointing it. The spec spells that
# `ln -sfn <target> ~/ccrc.new && mv -T ~/ccrc.new ~/ccrc`, and THE LINUX ARM
# BELOW IS THAT ARGV, VERBATIM — measured 2026-09-23 under strace on GNU
# coreutils 9.4 as `renameat2(…, RENAME_NOREPLACE) = -1 EEXIST` and then
# `renameat("<link>.new", "<link>") = 0`, with no `unlink` anywhere. A reader
# that resolves `<link>` at any instant sees the old target or the new one,
# never nothing.
#
# THE TWO SHORTER SPELLINGS ARE WRONG, each measured on the same coreutils:
#   • `ln -sfn <target> <link>` straight onto the live name is unlink +
#     symlink, the window `_inst_graphify_engine`'s pip-shim swap names ("a
#     session that types `graphify` in that window gets ENOENT") — and this
#     name is every unit's ExecStart and the launcher's `exec`;
#   • `mv -f` without `-T` FOLLOWS a symlink-to-directory destination: it
#     moves `<link>.new` INSIDE the old version and answers 0 with `<link>`
#     unchanged — D-2187's shape, the one `_plat_mv_notdir` above exists for.
#
# THE DARWIN ARM IS python3's `os.replace`, NOT `_plat_mv_notdir`. BSD `mv`
# has no `-T`, and `_plat_mv_notdir`'s Darwin arm makes up for it by `rm`-ing
# a symlink-to-directory destination BEFORE its `mv` — a window in which
# `<link>` does not exist, which is the one thing this helper is for.
# `os.replace` is one rename(2) on every POSIX platform and replaces a symlink
# rather than following it; `ccd/ccd-pool-sync`'s header gives the same reason
# for its `os.rename` install. python3 comes with the Xcode Command Line
# Tools, Homebrew's own prerequisite (D-3419).
#
# THE CONTRACT: 0 iff `<link>` is now a symlink whose value is exactly
# `<target>`, placed by ONE rename over the symlink that stood there, or over
# nothing. 1 otherwise, with nothing at `<link>` changed:
#   • something that is not a symlink stands at `<link>`. A real directory
#     there is the one-time migration's case, never this helper's, and it is
#     refused rather than renamed into or over. One that appears after the
#     test is refused by the rename itself (`mv -T`: "cannot overwrite
#     directory"; `os.replace`: IsADirectoryError), so the test is not the
#     only thing standing between a flip and a real tree;
#   • something that is not a symlink stands at `<link>.new`. A stale LINK
#     under the staged name needs nothing from this function: `ln -sfn`
#     replaces it by itself (`-f`, and `-n` so a link to a directory is
#     replaced rather than entered — GNU does it as symlink-to-a-temp-name +
#     rename). But `-f` would DELETE a file there that this function did not
#     make, and a real directory there would take the new link INSIDE it, so
#     anything that is not a link is refused before `ln` runs;
#   • `ln` fails, or the rename fails, and the staged `<link>.new` is removed.
# `<target>` is written verbatim (callers pass an absolute path); it prints
# nothing, never dies, and the caller owns the sentence. NOTHING serializes
# the staged `<link>.new` (the spec's `$HOME/ccrc.new`): an update flips under
# its lock, a plain install under none, so two flips can interleave and each
# rc then describes the other's flip (D-3424).
_plat_ln_swap() {   # <target> <link> -> 0 iff <link> is now a symlink to <target>
  if [ ! -L "$2" ] && [ -e "$2" ]; then return 1; fi
  if [ ! -L "$2.new" ] && [ -e "$2.new" ]; then return 1; fi
  ln -sfn -- "$1" "$2.new" 2>/dev/null || return 1
  if [ "$CCD_OS" = darwin ]; then
    python3 -c 'import os, sys; os.replace(sys.argv[1], sys.argv[2])' "$2.new" "$2" 2>/dev/null \
      || { rm -f -- "$2.new"; return 1; }
  else
    mv -fT -- "$2.new" "$2" 2>/dev/null || { rm -f -- "$2.new"; return 1; }
  fi
}

```

Insert the SAME bytes at the same place in `ccd/ccd` (after `_plat_mv_notdir`'s `}` at `:160`, above `:162`). One way that cannot make the copies differ, from the repo root:

```bash
S="$(mktemp -d "${TMPDIR:-/tmp}/w6-t1.XXXXXX")"
# write the 64 lines above into "$S/helper.sh" (the Write tool, or a quoted heredoc), then:
python3 - "$S/helper.sh" <<'PY'
import sys
h = open(sys.argv[1]).read()
for f in ('ccd/ccrc', 'ccd/ccd'):
    s = open(f).read()
    anchor = '\n}\n\n# `stat -c` -> `stat -f`.'
    assert s.count(anchor) == 1, f
    open(f, 'w').write(s.replace(anchor, '\n}\n\n' + h + '# `stat -c` -> `stat -f`.'))
PY
grep -n '^_plat_ln_swap() {' ccd/ccrc ccd/ccd
```

Expected: `ccd/ccrc:273:` and `ccd/ccd:214:` (measured at `d759c914`); both inside their blocks (the END sentinels move to `ccd/ccrc:1095`, `ccd/ccd:1036`).

- [ ] **Step 4: Run to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts`
Expected: PASS — measured at `d759c914`: `73 passed | 11 skipped (84)` (one more pass at dispatch, as in Step 2), including `is byte-identical in ccd and ccrc`, `holds every _plat_/_svc_ definition INSIDE the sentinels, in both files`, `ccd/ccrc carries no un-shimmed GNU call` and `ccd/ccd carries no un-shimmed GNU call`.

- [ ] **Step 5: The marker — red first, then the re-stamp**

Run: `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts`
Expected: FAIL — `1 failed | 13 passed (14)`: `verifies as ccrc-unmodified — re-stamp ccd/ccd after editing it (see the note above)`. This is the mutation row "skip the re-stamp", measured.

Then, from the repo root:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
sed -n 2p ccd/ccd
```

Expected: one line matching `^# ccrc:generated 1 sha256=[0-9a-f]{64}$` (its digest differs from the committed one). Re-run: `cd server && ./node_modules/.bin/vitest run test/ownership.test.ts` → PASS, `14 passed (14)`. The re-stamp is the LAST `ccd/ccd` edit of this task; Step 7 restores byte-equal copies of the stamped file, so it stays valid.

- [ ] **Step 6: The repo-wide guards this edit reaches**

Run, from `server/`, one command at a time in the foreground:

```bash
./node_modules/.bin/vitest run $(grep -lE "ccd/(ccd|ccrc):[0-9]" test/*.test.ts | grep -vE 'session-hook|macos-platform|ownership')
./node_modules/.bin/vitest run test/single-definition.test.ts test/dtbd.test.ts test/ccd-reg-set-atomic.test.ts test/topology-clean.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected: the first — the 31 suites that cite a `ccd/ccd:<n>` or `ccd/ccrc:<n>` line — PASS (measured at `d759c914` with this edit: `31 passed`, `1979 passed | 22 skipped`; the grep derives the set, so at dispatch it is whatever wave 4 left — count it, and every file it names must pass); the second PASS; the third FAILS with exactly these four, measured at `d759c914` (green at the base, red with only this task's two files changed): `THE CITATION DEBT this task creates is measured, per cited file (Task 11 owns closing it)`, `README HAS ITS OWN CENSUS ENTRY, and it is EMPTY — every operator anchor resolves (wb2 B-I2)`, `THE **Files:** LISTS ARE LOCATION INDEXES — the exact stale set, exemption-free (D-2849)`, `` THE `|`-ROW PASS: the exact set a joined row still fails on (round 14, B-M2) ``. They are Task 9's to re-measure by S6-R11 (Global Constraints) and are NOT repaired here; any fifth red is this task's to explain before committing.

- [ ] **Step 7: Mutation measurement**

Every behavioural mutant is applied to BOTH copies, so the byte-identical case stays green and the red that answers is the behavioural one; M3 alone edits one copy. Copies are saved first and restored with `cp`, then compared — never `git checkout --`. From the repo root:

```bash
S="$(mktemp -d "${TMPDIR:-/tmp}/w6-t1-mut.XXXXXX")"
cp ccd/ccd "$S/ccd"; cp ccd/ccrc "$S/ccrc"
cat > "$S/mut.py" <<'PY'
import sys
files, old, new = sys.argv[1].split(','), sys.argv[2], sys.argv[3]
for f in files:
    s = open(f).read()
    assert s.count(old) == 1, (f, old)
    open(f, 'w').write(s.replace(old, new))
PY
m() {   # <label> <files> <old> <new>
  echo "== $1"
  python3 "$S/mut.py" "$2" "$3" "$4" || { echo "MUTANT DID NOT APPLY"; return 1; }
  (cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts 2>&1 | grep -E '^\s+×|Tests ')
  cp "$S/ccd" ccd/ccd; cp "$S/ccrc" ccd/ccrc
  if cmp -s "$S/ccd" ccd/ccd && cmp -s "$S/ccrc" ccd/ccrc; then echo restored; else echo "RESTORE FAILED"; fi
}
m M1 ccd/ccd,ccd/ccrc '  ln -sfn -- "$1" "$2.new" 2>/dev/null || return 1' '  ln -sfn -- "$1" "$2" 2>/dev/null && return 0 || return 1'
m M2 ccd/ccd,ccd/ccrc '    mv -fT -- "$2.new" "$2" 2>/dev/null' '    mv -f -- "$2.new" "$2" 2>/dev/null'
m M3 ccd/ccrc '_plat_ln_swap() {   # <target> <link> -> 0 iff <link> is now a symlink to <target>' '_plat_ln_swap() {   # <target> <link> -> 0 iff <link> now points at <target>'
m M4 ccd/ccd,ccd/ccrc "    python3 -c 'import os, sys; os.replace(sys.argv[1], sys.argv[2])' \"\$2.new\" \"\$2\" 2>/dev/null" '    _plat_mv_notdir "$2.new" "$2" 2>/dev/null'
m M5 ccd/ccd,ccd/ccrc '  if [ ! -L "$2" ] && [ -e "$2" ]; then return 1; fi
' ''
m M6 ccd/ccd,ccd/ccrc '  if [ ! -L "$2.new" ] && [ -e "$2.new" ]; then return 1; fi
' ''
m M7 ccd/ccd,ccd/ccrc '    mv -fT -- "$2.new" "$2" 2>/dev/null || { rm -f -- "$2.new"; return 1; }' '    mv -fT -- "$2.new" "$2" 2>/dev/null || return 1'
m M8 ccd/ccd,ccd/ccrc '      || { rm -f -- "$2.new"; return 1; }' '      || return 1'
git diff --stat -- ccd/ccd ccd/ccrc
```

Expected, each line `restored`, and each mutant red on exactly the cases named (measured at `d759c914`):

| Mutant | Row | Red (and nothing else) |
|---|---|---|
| M1 — `ln -sfn` straight onto `<link>` (the unlink+symlink idiom) | spec §18 "the flip is a rename" | 6: the Linux and Darwin argv cases (the recorded `ln`'s last argument is `<link>`, and no `mv`/`python3` is called), both `a failed rename …` cases (rc 0 where 1 is owed), both stale-link cases |
| M2 — Linux arm `mv -f`, no `-T` | spec §11 Pins "the flip is `mv -T` (argv pinned)" | 3: `_plat_ln_swap still runs the GNU command on Linux`, the Linux argv case, the Linux stale-link case |
| M3 — one copy only | the block diff | 1: `is byte-identical in ccd and ccrc` |
| M4 — Darwin arm through `_plat_mv_notdir` (its `rm` of `<link>` before `mv` is the window) | D-3419 | 3: the Darwin argv case, `a failed rename … (darwin arm)`, the Darwin stale-link case |
| M5 — the real-directory guard deleted | plan row: a real `<link>` is the migration's | 2: both `refuses a real directory at <link> …` cases (tools are called) |
| M6 — the staged-name guard deleted | plan row: never touch what stands at `<link>.new` | 4: both arms × `file`/`directory` |
| M7 — Linux arm's clean-up dropped | plan row: a failed flip leaves no staged name | 1: `a failed rename … (linux arm)` |
| M8 — Darwin arm's clean-up dropped | same | 1: `a failed rename … (darwin arm)` |
| the marker — `ccd/ccd` not re-stamped | `ownership.test.ts` | measured in Step 5 |

The final `git diff --stat` shows the same two-file stat as before Step 7 (`ccd/ccd | 66`, `ccd/ccrc | 64` at `d759c914`). Then re-run `cd server && ./node_modules/.bin/vitest run test/macos-platform.test.ts` and `test/ownership.test.ts` → both PASS as in Steps 4–5. `rm -rf "$S"`.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccrc ccd/ccd server/test/macos-platform.test.ts
git commit -m "feat(ccrc): _plat_ln_swap — the \$HOME/ccrc flip is one rename(2) on both userlands (ln -sfn + mv -fT on Linux, os.replace on Darwin)"
```

### Task 2: The layout and `_inst_tree`

**Files:**
- Modify: `ccd/ccrc` —
  - constants and their header comment immediately after `BOX_BACKUP_ROOT="$HOME/ccrc-backups"` (`:1324` at `d759c914`): `BOX_VERSIONS_ROOT`, `BOX_MIGRATING_DIR`, `VER_NAME_RE`, `VER_STAMP_COPY`, `VER_RECORD_COPY`;
  - the `BOX_TREE_DIR` header (`:1266-1281`) gains one paragraph, above `BOX_TREE_DIR="$HOME/ccrc"` (`:1282`);
  - globals `VER_LAYOUT=""`, `VER_CURRENT=""`, `VER_WHY=""` after `BOX_HEALTH_WHY=""` (`:1394`);
  - `_box_build_fields`' header comment (`:1724-1734`: "TWO callers pass one") names its third caller — **correction: not in the skeleton; that comment enumerates the callers that pass a stamp path, and `_inst_version_name` is one more**;
  - new `_ver_layout`, `_inst_version_name`, `_ver_keep_state` immediately above `_inst_tree() {` (`:9516`);
  - `_inst_tree` itself (`:9516-9638`): its four-line header, its `local` line (`:9536`), and everything from `  # THE SELF-COPY GUARD, ON PHYSICAL PATHS.` (`:9566`) to its closing `}` (`:9638`);
  - `_inst_stamp_shipped` (`:9956-9981`): one header paragraph and the kept-stamp fallback;
  - `_inst_installed` (as wave 4 split it): one `_ver_keep_state install` call on the line after `  _inst_floor`;
  - `cmd_install`'s Darwin preflight (`:9137-9163`): one `python3` probe after the `flock` probe (`:9160-9161`) — **correction (review):** a probe that RUNS the interpreter, not `command -v`, see Interfaces;
  - **added (review) — `cmd_update`, two places** (D-3457): the pre-spine layout read directly above wave 4 Task 6's `  # ARM 2'S PROVENANCE PRECONDITION, read NOW (design §11): whether the build` comment (`grep -n "^  # ARM 2'S PROVENANCE PRECONDITION" ccd/ccrc`), and a re-measurement in wave 4's installed-absent arm, between the `fi` that closes its `if [ "$step" = none ]; then … elif _upd_step_moved "$step"; then moved=1; fi` and its `      _upd_phase failed "spine died at $step_desc"`; new `_upd_tree_untouched` immediately after wave 4 Task 4's `_upd_stamp_moved` closing `}` (`grep -n '^_upd_stamp_moved() {' ccd/ccrc`).
- Modify: `server/test/installTreeFixture.ts` — `symlinkSync` joins the `node:fs` import (`:16-18`); new export `installVersionedTree` after `installFixtureTree` (`:215-231`)
- Modify: `server/test/platformFixtures.ts` — **added (review):** new exports `DARWIN_PYTHON3_PROGRAMS` (the two `python3 -c` programs the harnesses' `python3` stubs hand to the real interpreter) and `python3ProgramArm` (the stubs' one `-c` line built from them) after `itDarwin` (`:28`)
- Test: `server/test/ccrc-install.test.ts` —
  - `lstatSync`, `readlinkSync` join the `node:fs` import (`:49-52`) and `installVersionedTree` the fixture import (`:60`);
  - `const REAL_PYTHON3` after `const RSYNC = realPath('rsync');` (`:84`) — **correction: resolved WITHOUT a throw**, see Interfaces;
  - `const versionDir` after `const placed` (`:95`);
  - the `python3` stub (`:529-541`) gains its `-c` arm above the refusal line — **correction (review):** for exactly the two programs of `DARWIN_PYTHON3_PROGRAMS`, built by `python3ProgramArm`, which joins the `./platformFixtures.js` import (`:58`); every other `-c` still reaches the exit-90 refusal;
  - `pathWithout`'s list (`:686-707`) gains `'ln', 'readlink'` with a comment in the list's own style;
  - the existing assertions that named the live directory as the destination move to the version directory: the two `npm-cwd` lists (`:932-935`, `:947`), the placed sentence (`:966`), the server-deps `npm-cwd` (`:1008`), the npm die sentence (`:1038`); the rsync-absent case (`:1077`) also asserts no versions root; the same-size case (`:1089`) and the deps-survive case (`:1111`) `gitInit` their checkout so both runs name one version, and the first asserts the in-place sentence;
  - new describe `ccrc install: the versioned tree (W6 Task 2)` immediately after `describe('ccrc install: the order is stated in one place'` closes, i.e. directly above `describe('ccrc install: workspace build-artifact excludes (_inst_ws_build_excludes)', () => {` (`:2028`).
- Test: `server/test/ccrc-update.test.ts` — `readlinkSync` joins the `node:fs` import (`:39-43`); `import { installVersionedTree } from './installTreeFixture.js';` after the `platformFixtures.js` import (`:48`); `const REAL_PYTHON3` after `const REAL_NODE = realPath('node');` (`:60`; wave 4's `REAL_MV` sits beside it, either order); `python3ProgramArm` joins the `./platformFixtures.js` import (`grep -n "from './platformFixtures.js'" server/test/ccrc-update.test.ts` — wave 4 Task 8 widened it to `{ itLinux, itDarwin, platformContrast }`, so it is located by its module, not its old text); the `python3` stub (`:263-275`) gains the same `-c` arm; **correction:** a NEW FULL-flavour case directly after the happy path (`it('happy path: replaces ~/ccrc from the verified tree …'`, `:664`) instead of new assertions inside it — see Interfaces; **added (review):** two more cases after it, a FULL-flavour linked box whose staged `npm ci` fails (exit 1, nothing replaced, no gate, no restore) and a sourced table for `_upd_tree_untouched` through wave 4 Task 3's file-scope `sourcedCcrc`
- Test: `server/test/single-definition.test.ts` — the stamp census (`:1389-1402`) and the install-record census (`:1497-`, as wave 4 left it) each gain `_ver_keep_state`'s one line, in document order (both below `:1303`, ruling R13)
- Run, not edited: `server/test/macos-platform.test.ts` (the platform block is Task 1's and this task adds nothing inside it; the `gnuOnly` sweep sees only `_plat_mv_notdir`/`_plat_ln_swap` calls, a plain `readlink --`, `cp --`), `server/test/ccrc-install-graphify.test.ts` (runs the whole spine from an unstamped checkout, so every one of its installs now places an `unstamped-` version and flips), `server/test/ccrc-cli.test.ts`, `server/test/typecheck-tests.test.ts`
- Not chased here: `server/test/session-hook.test.ts` (Task 9). Ruling R13 is met by position, not by a run: both `single-definition.test.ts` insertions are appended below `:1303`, so they move none of the three lines that audit cites there (`:32-37`, `:1274`, `:1303`). Its reds at this commit are the `ccd/ccrc` anchor shifts every task's inserted lines cause (Global Constraints), and Task 9 re-measures them once by S6-R11.

**Interfaces:**
- Constants, declared once, after `BOX_BACKUP_ROOT`:
  - `BOX_VERSIONS_ROOT="$HOME/ccrc-versions"`
  - `BOX_MIGRATING_DIR="$HOME/ccrc.migrating"` (here, because `_ver_layout` reads it; Task 3 is its writer)
  - `VER_NAME_RE='^(v[0-9]+\.[0-9]+\.[0-9]+|untagged-[0-9a-f]{12}|unstamped-[0-9a-f]{12})$'`
  - `VER_STAMP_COPY=".ccrc-stamp.json"` and `VER_RECORD_COPY=".ccrc-installed"`: the two files a version directory keeps at its root.
- `_ver_layout` → rc 0 always; prints nothing; sets `VER_LAYOUT`, `VER_CURRENT` (the name on `linked|migrated` only, else `""`) and `VER_WHY` (built from its own words, never from the link's bytes). `VER_LAYOUT` is exactly one of `absent`, `crashed`, `directory`, `linked`, `migrated`, `foreign`, `unreadable`, with the skeleton's definitions. **Correction (wording only):** `VER_WHY` is a phrase that completes "`$HOME/ccrc is …`", because that is how `_inst_tree`'s refusal prints it; the skeleton's `its target is not a version directory under ~/ccrc-versions` read "`$HOME/ccrc is its target is …`". The phrases:
  - `foreign`: `a link whose target is not a version directory under $HOME/ccrc-versions` — a relative target, a path outside the root, a name outside `VER_NAME_RE`, a dangling target, or a target that is itself a link;
  - `unreadable`: `a link readlink could not read`; `neither a directory nor a link` (a regular file); `a directory beside a $HOME/ccrc.migrating — two trees, and which one runs is not known`; `absent beside a $HOME/ccrc.migrating that is not a directory`; `a version link beside a $HOME/ccrc.migrating that is not a directory`.
- `_inst_version_name <src>` (`<src>` physical) → stdout one name matching `VER_NAME_RE`, rc 0, never fails; the skeleton's five rules in order. **Corrections (mechanism, same contract):** rule 2 picks the tag with a bash `while read` over `git tag --points-at HEAD` (first line matching the release shape — `head -n1`'s answer) instead of `grep | head`, so the install path gains no tool beyond `ln` and `readlink`; rule 4 calls `_ver_layout` itself and saves and restores the three `VER_*` globals around it, as it saves and restores `BOX_BUILD`, so a caller that holds either keeps it; rule 5 falls back to three `$RANDOM` quads when `_plat_uuid` answers nothing, so "never fails" holds on a box whose uuid source is broken.
- `_inst_tree` (callable contract unchanged: no arguments, dies on failure; the three preflights unchanged). In order:
  1. `src` (unchanged); `_ver_layout`; `crashed` → die `a migration of $HOME/ccrc is incomplete — this run should have completed it first`; `foreign|unreadable` → die `$HOME/ccrc is <VER_WHY> — refusing to place or flip a tree over something this ccrc did not make; $HOME/ccrc and $HOME/ccrc-versions were not touched`. **Correction:** the skeleton's `nothing was changed` is false by the time `_inst_tree` runs — `_inst_roster`, `_inst_env`, `_inst_node_id` and the others before it have written `~/.ccrc` — so the sentence names what it did not touch. The refusal itself is this task's departure D-3429 (added to `## Deviations found`): spec §11 is silent on a `~/ccrc` that is neither a directory nor a version link. Then `name="$(_inst_version_name "$src")"`.
  2. **Correction — the `directory` arm is NOT a die in this task.** It keeps the pre-W6 behaviour byte for byte: `dest=$BOX_TREE_DIR`, the old physical self-copy guard, `install: tree: already running from $HOME/ccrc` / `install: tree: placed at $HOME/ccrc`, npm in `$HOME/ccrc`, no flip. Every FULL-flavour case in `ccrc-update.test.ts` (`plantOldBox` plants a real `~/ccrc`) and `ccrc-install.test.ts:1060` run on a real directory; a die there reds all of them at this task's commit. Task 3 replaces exactly this arm (the `if [ "$VER_LAYOUT" = directory ]` block and the `!= directory` guards on the void, the npm skip and the flip) with the versioned placement followed by `_inst_migrate "$name"`.
  3. THE GUARD, on versions (`absent|linked|migrated`), `dest="$BOX_VERSIONS_ROOT/$name"`, `vroot` = the physical root when it exists: (a) `src = $vroot/$name` and `name = VER_CURRENT` → `running`, the pre-W6 sentence; (b) `src = $vroot/$name`, another name → `placed`, `install: tree: <name> is already placed at $HOME/ccrc-versions/<name> — installing from it, no copy`; (c) same name, another source → in-place copy, `install: tree: reinstalled <name> in place at $HOME/ccrc-versions/<name> (the version $HOME/ccrc points at; same name, same release)`; (d) otherwise → copy, `install: tree: placed <name> at $HOME/ccrc-versions/<name>`. The rsync is today's argv with only the destination changed. **Corrections:** (i) `rsync` is probed, and the versions root created (by `mkdir -p "$dest"`, die `cannot create <dest>`), only on (c)/(d) and only after the layout refusals — the skeleton made the root in step 1, which left an empty `~/ccrc-versions` behind every refused or rsync-less run; (ii) on (c)/(d) the destination's `$VER_RECORD_COPY` is removed BEFORE the rsync (die `could not void the kept install record of <name> before placing over it (<path>) — nothing was copied`), so a re-placement that dies never leaves a directory whose record says it holds a finished install (D-3430, which this task adds to `## Deviations found`).
  4. Deps: skipped with `install: tree: <name> is complete (its kept install record is present) — no npm ci` exactly when the guard answered (a) or (b), the destination carries `$VER_RECORD_COPY`, and — **correction** — on a `fleet` box `$dest/agent/node_modules` is a directory too (a version completed under another role never fetched the agent's deps). Otherwise today's two `npm ci` runs in `$dest/server` and (fleet) `$dest/agent`; their die sentences name `$HOME/ccrc-versions/<name>/server` and `…/agent` (`$HOME/ccrc/…` on the `directory` arm); success lines unchanged.
  5. Flip, when not `directory` and `VER_CURRENT != name`: `_plat_ln_swap "$dest" "$BOX_TREE_DIR"`, die and success sentences as the skeleton spells them (`was nothing` on `absent`). The LAST act of `_inst_tree`. `CCRC_INST_SPINE` gains no step. **Correction (review) — the skeleton's "a death anywhere in `_inst_tree` is still at-or-after `_inst_tree` for wave 4's `_upd_step_moved` (moved), the safe direction" is false on a versioned box.** `_inst_step` writes the marker as it ENTERS a step, so every death inside `_inst_tree` reads `_inst_tree`, and since this task the tree is replaced only at the flip. The deaths before it (the layout refusals, the rsync, the void, `mkdir`, `npm ci` in the new version) leave the link and the running version as they were, and `_inst_stamp` never ran. Classified as moved, the parent gates a unit that is still on the old build, the gate fails, and the restore's arm 2 child runs `update --to <the running tag>`. The record was cleared, so that child is not converged, and its W6 spine takes case (c): an rsync `--delete` plus `npm ci` INSIDE the running version. A registry outage that killed the first `npm ci` kills this one too, with the running tree's `node_modules` emptied, and the run exits 4 `reverted`. W6 Task 4's arm 1 (D-3445) catches that shape before arm 2 and re-runs the kept spine in place, which spares the running tree the rsync. It still gates a box nothing touched, on the old build, restarts its units through that spine, and exits 4 `reverted`, which stops a rollout. Spec §11 keys its two answers on whether the tree was replaced: exit 1 with no restore for "nothing replaced". So `cmd_update` re-measures (next bullets, D-3457), and arm 1's in-place arm is left for the shapes `_upd_tree_untouched` cannot vouch for. `_upd_step_moved` itself is wave 4's and unchanged.
- `_inst_stamp_shipped`: the skeleton's fallback, with `local … from=…` carrying the transcript's last words (`shipped in the release artifact` / `kept with its version`). The census line `_inst_atomic "$shipped" "$BOX_STAMP_FILE" 644` is unchanged.
- `_ver_keep_state <prefix>` → rc 0 always, never dies (D-3428); silent unless `_ver_layout` reads `linked|migrated` and both files are regular files; stamp copy then record copy; sentences as the skeleton spells them. **Corrections (mechanism):** it writes to `$BOX_VERSIONS_ROOT/$VER_CURRENT/…` — the directory its sentence names, the same place `$BOX_TREE_DIR/…` resolves to at that moment — and each copy is `cp` to `<dest>.tmp.$$`, `chmod 644`, then `_plat_mv_notdir` (a directory standing at the name refuses instead of swallowing the file; a bare `mv -f` would move the temp inside it and answer 0). It names `BOX_STAMP_FILE` on one line (`local from_stamp="$BOX_STAMP_FILE"`) and `BOX_INSTALLED_FILE` on one line (`local from_record="$BOX_INSTALLED_FILE"`); both lines join their censuses.
- `_inst_installed`: `_ver_keep_state install` on the line after wave 4's `  _inst_floor`, before the `install-step` removal; it never dies, so the removal always follows.
- `cmd_install`'s Darwin preflight: the skeleton's `python3` probe and sentence. **Correction (review) — the probe RUNS the interpreter:** `python3 -c 'import os' >/dev/null 2>&1`, not `command -v python3`. Every macOS since 10.15 has `/usr/bin/python3` as an `xcode-select` stub, which `command -v` finds and which exits non-zero (`xcode-select: note: No developer tools were found, requesting install`) until the Command Line Tools are installed. The probe exists to stop exactly that box before a whole tree is placed and `npm ci` has run, and before `_plat_ln_swap`'s `os.replace` fails at the flip. The sentence gains one clause saying so. `ccd/ccd`'s `cmd_version` keeps its `command -v`: it uses python3 for the work itself and fails there, with nothing placed first.
- **Added (review) — `cmd_update` re-measures a death inside `_inst_tree`** (D-3457):
  - Before the staged spine, directly above wave 4 Task 6's `# ARM 2'S PROVENANCE PRECONDITION` comment: `_ver_layout`, then `local pre_layout="$VER_LAYOUT" pre_current="$VER_CURRENT"`. This is after Task 3's first `_inst_migrate_resume update`, which runs on the line after `UPD_REPORTING=1`. It is above everything that clears the record, the marker and the caps, and above the line W6 Task 4's `_upd_legacy_target` is placed on (after `_upd_marker_unsigned && UPD_PREV_UNSIGNED=1`). `_upd_legacy_target` acts only on a staged spine WITHOUT `BOX_VERSIONS_ROOT`, and `_upd_tree_untouched` answers rc 1 for every such spine, so the two never meet.
  - In the installed-absent arm, after `moved` is decided and before `_upd_phase failed`: when `moved` is 1, `step` is `_inst_tree`, and `untouched="$(_upd_tree_untouched "$pre_layout" "$pre_current")"` answers rc 0, then `moved=0` and `place="before its flip: nothing was replaced ($untouched)"`. The die is then wave 4's not-moved die, unchanged: exit 1 with `ccrc: the staged install (which ends with doctor) exited <rc> — spine died at _inst_tree, before its flip: nothing was replaced ($HOME/ccrc still points at $HOME/ccrc-versions/<cur>); read its lines above. The backup taken BEFORE it ran is complete at <dir>`, and `update.json` `failed` with detail `spine died at _inst_tree`. No gate runs and no `_upd_restore`.
- `_upd_tree_untouched <pre_layout> <pre_current>` → rc 0 only when it is PROVEN that a staged spine which died inside `_inst_tree` replaced nothing, and then stdout is one clause naming what was measured. Otherwise rc 1 and nothing is printed, and wave 4's reading (moved) stands. In order:
  1. The staged `$UPD_TREE/ccd/ccrc` has no `^BOX_VERSIONS_ROOT=` line → rc 1. A spine older than W6 writes THROUGH `~/ccrc`, so a link that stayed put proves nothing. This is the same measurement W6 Task 4's `_upd_legacy_target` condition makes.
  2. `_ver_layout`, then by `pre_layout`:
     - `linked|migrated`: rc 1 when `UPD_VERSION = pre_current`. That is the in-place reinstall, case (c), whose void, rsync and `npm ci` write into the running version (D-3426). `UPD_VERSION` is the staged directory's name because `_upd_fetch` refuses a staged `build.json` whose `version` is not `UPD_VERSION` (`:11647` at `d759c914`), and `_inst_version_name` rule 3 names the directory from that field. Otherwise rc 0 exactly when the layout still reads `linked|migrated` with `VER_CURRENT = pre_current`, with stdout `$HOME/ccrc still points at $HOME/ccrc-versions/<pre_current>`.
     - `foreign|unreadable`: rc 0 exactly when the layout still reads the same word, with stdout `$HOME/ccrc is still <VER_WHY>, which the spine refused to place over`. `_inst_tree` refuses both at its first step, before it writes a byte (D-3429), and gating or restoring THROUGH such a `~/ccrc` would write into a directory nobody named.
     - `directory`, `absent`, `crashed` → rc 1. A pre-versioned directory is still rsynced IN PLACE by this task's `directory` arm. When W6 Task 3 retires that arm, the `directory` row is Task 3's to revisit: after Task 3, a death before `_inst_migrate` moves the directory also replaced nothing.
  It only reads and never dies. The three `VER_*` globals are left as the second read set them: every later reader in `cmd_update` (W6 Task 4's `_ver_keep_state update`, arm 1) calls `_ver_layout` itself.
- `installVersionedTree(home, name, opts = {}): string` in `server/test/installTreeFixture.ts`, as the skeleton spells it (`installFixtureTree(home, join('ccrc-versions', name))`; `complete` default true writes `.ccrc-stamp.json` and `.ccrc-installed` = `<sha>\n`; `link` default true symlinks `<home>/ccrc` to the absolute root).
- The two `python3` stubs gain, above their refusal, a `-c` arm. **Correction (review):** the arm matches the PROGRAM, not every `-c`. It reads `if [ "$1" = "-c" ]; then case "$2" in '<program 1>'|'<program 2>') exec '<REAL_PYTHON3>' "$@" ;; esac; fi`, with the two programs of `DARWIN_PYTHON3_PROGRAMS`, built by `python3ProgramArm(REAL_PYTHON3)` (both in `platformFixtures.ts`, one definition both files import): `_plat_ln_swap`'s `import os, sys; os.replace(sys.argv[1], sys.argv[2])` and the preflight's `import os`. Any other `python3 -c` still hits the stubs' stated contract, the loud exit-90 refusal ("a future one deserves to be seen"). Today none is reachable from these two harnesses: `ccd/ccd`'s `python3 -c` sites are copied into place, never run, by install and update. Task 1's `PY` in `macos-platform.test.ts` stays its own local copy, because Task 1 lands first and this task does not edit that file. The copies cannot drift silently: Task 1 pins `PY` against `_plat_ln_swap`'s recorded argv, and a stub that no longer recognises the program refuses loudly on the macOS leg. **Correction:** `REAL_PYTHON3` is resolved by `command -v python3` WITHOUT `realPath`'s throw, and the arm is spread in only when it resolved: a module-scope throw would take down the whole file on a Linux box with no python3, where the flip is `mv -fT` and never reaches the arm.
- **Correction — the update-side pin.** The skeleton had the FULL happy path (`:664`) assert the placed version directory and the link. That case plants a REAL `~/ccrc` (`plantOldBox`), which is the `directory` arm, unmigrated until Task 3. So this task adds one FULL case that plants a VERSIONED box (`plantOldBox`, then `~/ccrc` replaced by `installVersionedTree(home, 'v1.0.0', …)`) and asserts the placement, the flip, the kept copies and a byte-unchanged `v1.0.0` (`treeDigest`); the `:664` case stays as it is and becomes the migration's in Task 3.
- Mutation rows (Step 5 runs each): spec §11 audit "must change — the rsync into the literal live name" (M1); spec §11 audit "must change — the self-copy guard", both directions (M2, M3); spec §18 "the flip is a rename", at the CALL SITE (M12 — Task 1 pins the helper, this pins that `_inst_tree` uses it); the flip before the deps (M4); the kept-state order and its cleanup (M5, M13); the npm skip, both directions (M6a, M6b — **correction:** the skeleton's single row "remove the `$VER_RECORD_COPY` test → the complete-placed case records an `npm ci`" names the wrong case: removing the test so the skip ignores the record reds the INCOMPLETE case; making the skip never fire reds the complete ones); the kept-stamp fallback (M7); `_ver_layout`'s foreign test (M8), and — **added (review)** — its link-to-a-link clause alone (M8b: M8 replaces the whole condition, so it cannot say whether `[ -L "$val" ]` is pinned; every other foreign row is caught by another clause); the namer's rule order and fresh unstamped names (M9, M10); the foreign/unreadable refusal (M11); the void before a re-placement (M14); **added (review)** D-3457 at its call site and at each of the helper's three rc-1 guards (M15–M18); and the Darwin preflight's probe (the macOS-leg row after the table).

**Departures this task found** (add each to the plan's *Deviations found* list, in this form; the other five this task names — D-3422, D-3425, D-3426, D-3427, D-3428 — are already there):
- **D-3429** — (Task 2) `_inst_tree` refuses before it places a byte when `~/ccrc` is neither a pre-versioned directory nor a link this ccrc wrote. That covers a link whose value is not an absolute `$BOX_VERSIONS_ROOT/<name>` directory, a link `readlink` cannot read, a regular file, and two trees (a real `~/ccrc` beside `~/ccrc.migrating`). The die names what it did not touch (`$HOME/ccrc and $HOME/ccrc-versions were not touched`), not "nothing was changed", because the spine steps before `_inst_tree` have already written `~/.ccrc`. Spec §11 is silent on a `~/ccrc` of any of these shapes. Placing through a foreign link writes into a directory nobody named, and flipping over it throws away a link an operator made. Cost if wrong: a box whose `~/ccrc` was linked by hand must have that link removed (or pointed into `~/ccrc-versions`) before `ccrc install` runs.
- **D-3457** — (Task 2, found in review) `cmd_update` does not take wave 4's `_upd_step_moved` reading ("a marker of `_inst_tree` or later: the tree WAS replaced") as final for a death inside `_inst_tree`. It reads `_ver_layout` before the staged spine and again after the death. When the staged spine is W6's (it declares `BOX_VERSIONS_ROOT`), the release's name is not the pointed-at version, and `~/ccrc` still points at the version it pointed at — or a `foreign`/`unreadable` `~/ccrc` still reads the same word — the death is classified as nothing replaced: exit 1, `spine died at _inst_tree, before its flip: nothing was replaced (…)`, no gate, no restore. Spec §11 separates "nothing replaced" (exit 1) from "the tree is replaced" (gate, then restore), and since this task the tree is replaced at the flip, `_inst_tree`'s last act, not at its first byte. The marker cannot see inside the step, and `CCRC_INST_SPINE` gains no step. Left as moved, the commonest failure, `npm ci` against a registry that is down, is gated on the old build and fails. Arm 2's child then re-installs the running tag IN PLACE (case (c)), rewriting the running tree the wave exists to leave alone. Task 4's in-place arm 1 (D-3445) would intercept first and spare the tree, but it would still restore and restart a box nothing touched and exit 4 `reverted`, which halts a rollout. Cost if wrong: a W6 spine that dies before its flip is reported with exit 1 and not restored. That is correct only because nothing moved, and the rule is guarded on the three facts that make it so: the spine's version, the name, and the link, re-read.
- **D-3430** — (Task 2) before its rsync writes into a version directory, `_inst_tree` removes that directory's kept install record (`$VER_RECORD_COPY`), and dies naming the path if the removal fails, with nothing copied. This covers the in-place same-name reinstall and a re-placement of a kept version that is not the pointed-at one. `_ver_keep_state` writes the record again when the spine completes. Spec §11 does not say what marks a version complete. Without the void, a placement that dies half-way leaves a directory whose record says it holds a finished install, and both the npm skip (D-3427) and arm 1 (Task 4) would trust it. Cost if wrong: a re-placement that dies leaves its version incomplete (never flipped back to, and pruned only by hand, D-3448) until the next completed install from it.

- [ ] **Step 1: Write the failing tests**

(a) `server/test/installTreeFixture.ts`. In the `node:fs` import (`:16-18`), replace

```ts
import {
  copyFileSync, cpSync, mkdirSync, statSync, chmodSync, writeFileSync,
} from 'node:fs';
```

with

```ts
import {
  copyFileSync, cpSync, mkdirSync, statSync, chmodSync, writeFileSync, symlinkSync,
} from 'node:fs';
```

and append at the end of the file, after `installFixtureTree`'s closing `}`:

```ts
/** A W6 box's version directory (W6 Task 2): the fixture tree placed at
 *  `<home>/ccrc-versions/<name>`, the shape `_inst_tree` leaves behind.
 *
 *  `complete` (default true) writes the two files a version keeps at its root
 *  once an install completed from it — `.ccrc-stamp.json`, a stamp
 *  `_box_build_fields` accepts (`sha` default forty `a`s, `ref` main, a fixed
 *  `builtAt`, `dirty: false`, and `version` only when given), and
 *  `.ccrc-installed`, one line naming that sha. Without them the version is
 *  incomplete, which is what a placement that died leaves.
 *
 *  `link` (default true) points `<home>/ccrc` at it with an ABSOLUTE target,
 *  the value `_plat_ln_swap` writes and `_ver_layout` reads back.
 *
 *  Returns the version root. The one helper later W6 tasks plant a
 *  versioned box with. */
export function installVersionedTree(
  home: string, name: string,
  opts: { link?: boolean; complete?: boolean; stamp?: { sha: string; version?: string } } = {},
): string {
  const root = installFixtureTree(home, join('ccrc-versions', name));
  if (opts.complete ?? true) {
    const sha = opts.stamp?.sha ?? 'a'.repeat(40);
    const version = opts.stamp?.version;
    const stamp = {
      sha, ref: 'main', builtAt: '2026-09-23T00:00:00Z', dirty: false,
      ...(version === undefined ? {} : { version }),
    };
    writeFileSync(join(root, '.ccrc-stamp.json'), `${JSON.stringify(stamp)}\n`);
    writeFileSync(join(root, '.ccrc-installed'), `${sha}\n`);
  }
  if (opts.link ?? true) symlinkSync(root, join(home, 'ccrc'));
  return root;
}
```

(a2) `server/test/platformFixtures.ts` (**added, review**). Directly after `export const itDarwin = it.skipIf(!IS_DARWIN);` (`:28`) add:

```ts

/** The two `python3 -c` programs `ccrc install` runs on macOS (W6 Task 2),
 *  in the bytes `ccd/ccrc` spells them: the Darwin arm of `_plat_ln_swap` —
 *  the `~/ccrc` flip, one `os.replace` — and `cmd_install`'s preflight
 *  probe, which proves an interpreter RUNS (macOS's `/usr/bin/python3` is an
 *  `xcode-select` stub until the Command Line Tools are installed). The
 *  `python3` stubs of `ccrc-install.test.ts` and `ccrc-update.test.ts` hand
 *  exactly these to the real interpreter and refuse every other `-c`, so a
 *  new `python3 -c` on the install path is seen, not silently run.
 *  `macos-platform.test.ts` pins the first against `_plat_ln_swap`'s argv
 *  with its own `PY` (W6 Task 1). */
export const DARWIN_PYTHON3_PROGRAMS = [
  'import os, sys; os.replace(sys.argv[1], sys.argv[2])',
  'import os',
] as const;

/** The stubs' `-c` arm: one sh line, empty when `real` (a resolved
 *  python3) is empty — a box with no python3 runs every Linux case, whose
 *  flip is `mv -fT` and whose preflight asks for no python3. */
export function python3ProgramArm(real: string): string[] {
  if (real === '') return [];
  const pats = DARWIN_PYTHON3_PROGRAMS.map((prog) => `'${prog}'`).join('|');
  return [`if [ "$1" = "-c" ]; then case "$2" in ${pats}) exec '${real}' "$@" ;; esac; fi`];
}
```

(No program contains a `'`, which is what lets each stand single-quoted as a literal `case` pattern.)

(b) `server/test/ccrc-install.test.ts`, the harness. In the `node:fs` import (`:49-52`), replace the line `  chmodSync, readdirSync, rmSync, symlinkSync, utimesSync,` with `  chmodSync, readdirSync, rmSync, symlinkSync, utimesSync, lstatSync, readlinkSync,`; replace `import { TREE_STUBS, installFixtureTree } from './installTreeFixture.js';` with `import { TREE_STUBS, installFixtureTree, installVersionedTree } from './installTreeFixture.js';`; replace `import { describeLinux, describeDarwin, itLinux, itDarwin } from './platformFixtures.js';` (`:58`) with `import { describeLinux, describeDarwin, itLinux, itDarwin, python3ProgramArm } from './platformFixtures.js';`. Directly after `const RSYNC = realPath('rsync');` (`:84`) add:

```ts

/** The real python3, resolved once and WITHOUT a throw (W6 Task 2). Only the
 *  two macOS programs of `DARWIN_PYTHON3_PROGRAMS` — the `~/ccrc` flip's
 *  `os.replace` and the preflight's probe — reach it, through the `python3`
 *  stub's `-c` arm below; a Linux box with no python3 still runs every case
 *  here, because its flip is `mv -fT`. */
const REAL_PYTHON3 = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
```

Directly after `const placed = (home: string, ...rel: string[]): string => join(home, 'ccrc', ...rel);` (`:95`) add:

```ts
/** The version directory `~/ccrc` points at (W6 Task 2), read from the link
 *  itself — since W6 `_inst_tree` places into `~/ccrc-versions/<name>/` and
 *  flips the link, so `placed()` reads through the link and this names the
 *  directory the verb really wrote (npm's cwd, rsync's destination). */
const versionDir = (home: string, ...rel: string[]): string =>
  join(readlinkSync(join(home, 'ccrc')), ...rel);
```

In the `python3` stub (`plant('python3', [` at `:529`), directly above its last array element `    'echo "fixture python3: unexpected argv: $*" >&2; exit 90',` add:

```ts
    // W6 Task 2: the Darwin flip (`_plat_ln_swap`) is `python3 -c` running
    // `os.replace` — a local rename, no index, no network — and the Darwin
    // preflight proves python3 runs with `python3 -c 'import os'`. Those two
    // programs, and ONLY those, go to the REAL interpreter (or every macOS
    // leg dies at its preflight); any other `-c` falls through to the
    // refusal below, which is this stub's contract.
    ...python3ProgramArm(REAL_PYTHON3),
```

In `pathWithout` (`:641`), replace the three lines that open the tool list

```ts
  for (const b of ['mkdir', 'cp', 'mv', 'rm', 'cat', 'chmod', 'cmp', 'date',
    'node', 'git', 'npm', 'rsync', 'bash', 'sleep', 'jq', 'mktemp', 'basename',
    'diff', 'tmux', 'python3', 'flock', 'timeout', 'stat', 'grep', 'awk', 'realpath',
```

with

```ts
  //
  // `ln` and `readlink` join it in W6 Task 2, the two tools the versioned tree
  // adds to the install path: `_plat_ln_swap` stages the `~/ccrc` flip with
  // `ln -sfn`, and `_ver_layout` reads the link back with plain `readlink`.
  // A PATH without them is a box that places a whole tree and then cannot
  // point at it — a second absence inside a fixture about one.
  for (const b of ['mkdir', 'cp', 'mv', 'rm', 'cat', 'chmod', 'cmp', 'date',
    'node', 'git', 'npm', 'rsync', 'bash', 'sleep', 'jq', 'mktemp', 'basename',
    'diff', 'tmux', 'python3', 'flock', 'timeout', 'stat', 'grep', 'awk', 'realpath',
    'ln', 'readlink',
```

(c) `server/test/ccrc-install.test.ts`, the existing assertions that named the live directory as the destination (all in `describe('ccrc install: the shipped tree lands at $HOME/ccrc'`):

- `it('installs the AGENT runtime deps too, on a fleet box (D-1161)'` (`:932-935`): the two list entries `      placed(home, 'server'),` / `      placed(home, 'agent'),` become `      versionDir(home, 'server'),` / `      versionDir(home, 'agent'),`.
- `it('does NOT run npm in the agent on a role that runs no agent (D-1161)'` (`:947`): `toEqual([placed(home, 'server')])` becomes `toEqual([versionDir(home, 'server')])`.
- `it('places the five directories a box runs out of, with the builds inside them'` (`:966`): replace `    expect(r.stdout).toMatch(/^install: tree: placed at \$HOME\/ccrc$/m);` with

```ts
    // W6 Task 2: placed into the version directory and flipped to; a
    // checkout nothing measures is `unstamped-<12 hex>`.
    expect(r.stdout).toMatch(/^install: tree: placed unstamped-[0-9a-f]{12} at \$HOME\/ccrc-versions\/unstamped-[0-9a-f]{12}$/m);
```

- `it('installs the server runtime deps INTO THE PLACED TREE, production only'` (`:1006-1008`): replace

```ts
    // In `$HOME/ccrc/server`, never in the checkout: a box whose service boots
    // out of `~/ccrc` needs the deps THERE.
    expect(read(join(home, 'npm-cwd')).trim()).toBe(placed(home, 'server'));
```

with

```ts
    // In the placed version's `server/`, never in the checkout: a box whose
    // service boots out of `~/ccrc` needs the deps in the tree it points at.
    expect(read(join(home, 'npm-cwd')).trim()).toBe(versionDir(home, 'server'));
```

  (The byte-identical line in the self-copy case, `:1064`, is NOT touched: that case runs on a real `~/ccrc`, the `directory` arm.)
- `it('lets npm SAY WHY when the dependency install fails'` (`:1038`): the regex line `      /^ccrc: npm ci in \$HOME\/ccrc\/server failed — the service cannot start without runtime deps$/m);` becomes `      /^ccrc: npm ci in \$HOME\/ccrc-versions\/unstamped-[0-9a-f]{12}\/server failed — the service cannot start without runtime deps$/m);`.
- `it('refuses BY NAME when rsync is not on this box'` (`:1077`): after `    expect(existsSync(placed(home)), 'a half-made $HOME/ccrc was left behind').toBe(false);` add `    expect(existsSync(join(home, 'ccrc-versions')), 'the versions root was made before rsync was known to be there').toBe(false);`.
- `it('replaces a file whose size and mtime are unchanged but whose content is not'` (`:1089`): replace

```ts
    const home = freshBox('ccrc-install-same-size-');
    expect(runInstall(home).code).toBe(0);
```

with

```ts
    const home = freshBox('ccrc-install-same-size-');
    // W6 Task 2: one commit, so both runs name the same version and the
    // second rsyncs IN PLACE — the only placement where a file of the same
    // size and mtime is already at the destination for the quick check to skip.
    gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
```

  and directly above its `    expect(read(placed(home, ...rel.split('/')))).toBe(after);` add

```ts
    expect(r.stdout).toMatch(/^install: tree: reinstalled untagged-[0-9a-f]{12} in place at \$HOME\/ccrc-versions\/untagged-[0-9a-f]{12} \(the version \$HOME\/ccrc points at; same name, same release\)$/m);
```

- `it('a second run keeps the runtime deps the first one installed'` (`:1111`): replace

```ts
    const home = freshBox('ccrc-install-deps-survive-');
    expect(runInstall(home).code).toBe(0);
```

with

```ts
    const home = freshBox('ccrc-install-deps-survive-');
    // W6 Task 2: one commit, so the second run is the same version, in place.
    gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
```

(d) `server/test/ccrc-install.test.ts`, the new describe, directly above `describe('ccrc install: workspace build-artifact excludes (_inst_ws_build_excludes)', () => {` (`:2028`):

```ts
// ── W6 Task 2: the versioned tree ─────────────────────────────────────────
// `_inst_tree` places into `~/ccrc-versions/<name>/` and flips `~/ccrc` (a
// symlink since W6) onto it with one rename, after the deps. The subjects,
// in order: the layout reader and the namer, measured by SOURCING the ccrc
// under test (its BASH_SOURCE guard keeps the verb table from dispatching);
// then the verb itself on every guard arm — a fresh box, a new name while
// another version runs, a re-run from the running version, a run of another
// placed version's own ccrc, an incomplete one, a failing npm, the refusals;
// then the kept stamp and record, and the Darwin preflight.
describe('ccrc install: the versioned tree (W6 Task 2)', () => {
  const REAL_MV = realPath('mv');
  const vroot = (home: string, ...rel: string[]): string => join(home, 'ccrc-versions', ...rel);

  /** Every file under `dir`, relative path -> bytes (base64), links as their
   *  value: the "byte-unchanged" measurement a running version is held to. */
  const treeBytes = (dir: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (d: string, prefix: string): void => {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e);
        const rel = prefix === '' ? e : `${prefix}/${e}`;
        const st = lstatSync(p);
        if (st.isSymbolicLink()) out[rel] = `link:${readlinkSync(p)}`;
        else if (st.isDirectory()) walk(p, rel);
        else out[rel] = readFileSync(p).toString('base64');
      }
    };
    walk(dir, '');
    return out;
  };

  /** Runs `snippet` in a bash that has sourced `ccrc`, HOME the fixture's,
   *  `gh` contained, every CCRC_* input deleted (`ccrcEnv`'s rule), and the
   *  tools a placement would reach — npm, rsync, curl, systemctl, launchctl —
   *  POISONED at the head of PATH: a snippet that got further than it should
   *  (the red run of the crashed-arm case, say) must fail loudly, never fetch
   *  or copy for real. */
  const sourced = (home: string, ccrc: string, snippet: string): Result => {
    const poison = join(home, 'sourced-poison');
    mkdirSync(poison, { recursive: true });
    for (const t of ['npm', 'rsync', 'curl', 'systemctl', 'launchctl']) {
      writeFileSync(join(poison, t), `#!/bin/sh\necho "sourced harness: ${t} must not run" >&2\nexit 97\n`, { mode: 0o755 });
    }
    const env = ghContainedEnv(home, { ...process.env, HOME: home });
    env['PATH'] = `${poison}:${env['PATH'] ?? ''}`;
    for (const k of Object.keys(env)) if (k.startsWith('CCRC_')) delete env[k];
    const r = spawnSync(BASH, ['-c', `source "$1" || exit 99\n${snippet}`, 'sourced', ccrc],
      { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const layout = (home: string): string =>
    sourced(home, join(REPO, 'ccd', 'ccrc'),
      '_ver_layout; printf \'%s|%s|%s\\n\' "$VER_LAYOUT" "$VER_CURRENT" "$VER_WHY"').stdout.trim();
  const nameOf = (home: string, src: string): string =>
    sourced(home, join(REPO, 'ccd', 'ccrc'), `_inst_version_name "$(cd '${src}' && pwd -P)"`).stdout.trim();

  /** A stamp in `build-release.sh`'s shape, written into a source tree. */
  const shipStamp = (root: string, sha: string, version?: string): void => {
    writeFileSync(join(root, 'build.json'), `${JSON.stringify({
      sha, ref: 'release', builtAt: '2026-09-23T00:00:00Z', dirty: false,
      ...(version === undefined ? {} : { version }),
    })}\n`);
  };

  /** `mv`, recorded by nothing and executed for real — except at the two
   *  kept-copy renames, where a knob file makes it SIGKILL the ccrc that ran
   *  it (the stamp copy) or refuse (the record copy). `_plat_mv_notdir` runs
   *  in ccrc's own shell, so `$PPID` is the run itself. */
  const mvKnobs = [
    '#!/bin/sh',
    'for last in "$@"; do :; done',
    'case "$last" in',
    '  */.ccrc-stamp.json) [ -f "$HOME/fixture-kill-at-stamp-copy" ] && { kill -KILL "$PPID"; exit 1; } ;;',
    '  */.ccrc-installed) [ -f "$HOME/fixture-fail-at-record-copy" ] && { echo "fixture mv: refusing $last" >&2; exit 1; } ;;',
    'esac',
    `exec ${REAL_MV} "$@"`,
  ].join('\n') + '\n';
  /** `ln`, recorded (argv, one line per call) and executed for real: the
   *  call-site half of spec §18's "the flip is a rename" — `_inst_tree` must
   *  stage `~/ccrc.new` and rename it, never `ln -sfn` onto `~/ccrc` itself. */
  const lnRecorder = `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/ln-argv"\nexec ${realPath('ln')} "$@"\n`;

  it('_ver_layout: seven words, one per shape of ~/ccrc — and a WHY built from its own words, never the link\'s', () => {
    const home = mkTmp('ccrc-ver-layout-');
    expect(layout(home)).toBe('absent||');
    mkdirSync(join(home, 'ccrc.migrating'));
    expect(layout(home)).toBe('crashed||');
    rmSync(join(home, 'ccrc.migrating'), { recursive: true });
    mkdirSync(join(home, 'ccrc'));
    expect(layout(home)).toBe('directory||');
    mkdirSync(join(home, 'ccrc.migrating'));
    expect(layout(home)).toMatch(/^unreadable\|\|a directory beside a \$HOME\/ccrc\.migrating — two trees/);
    rmSync(join(home, 'ccrc'), { recursive: true });
    rmSync(join(home, 'ccrc.migrating'), { recursive: true });
    installVersionedTree(home, 'v1.2.3');
    expect(layout(home)).toBe('linked|v1.2.3|');
    mkdirSync(join(home, 'ccrc.migrating'));
    expect(layout(home)).toBe('migrated|v1.2.3|');
    rmSync(join(home, 'ccrc.migrating'), { recursive: true });
    // FOREIGN: every link this ccrc would never have written — a RELATIVE
    // target, a path outside the versions root, a dangling version name, a
    // directory under the root whose name is not a version name, a version
    // name that is itself a link.
    const foreign = /^foreign\|\|a link whose target is not a version directory under \$HOME\/ccrc-versions$/;
    const relink = (target: string): void => {
      rmSync(join(home, 'ccrc'));
      symlinkSync(target, join(home, 'ccrc'));
    };
    relink(join('ccrc-versions', 'v1.2.3'));
    expect(layout(home)).toMatch(foreign);
    mkdirSync(join(home, 'elsewhere-9f3c'));
    relink(join(home, 'elsewhere-9f3c'));
    expect(layout(home)).toMatch(foreign);
    expect(layout(home), 'the link\'s bytes reached VER_WHY').not.toContain('elsewhere-9f3c');
    relink(vroot(home, 'v9.9.9'));
    expect(layout(home)).toMatch(foreign);
    mkdirSync(vroot(home, 'not-a-version'));
    relink(vroot(home, 'not-a-version'));
    expect(layout(home)).toMatch(foreign);
    // …and a version NAME under the root that is itself a link, to a real
    // directory elsewhere: `-d` follows it and the name and the prefix both
    // match, so only the `[ -L "$val" ]` clause sees it (mutation M8b).
    mkdirSync(join(home, 'elsewhere-2'));
    symlinkSync(join(home, 'elsewhere-2'), vroot(home, 'v1.2.4'));
    relink(vroot(home, 'v1.2.4'));
    expect(layout(home)).toMatch(foreign);
    // UNREADABLE: a regular file at the name; a .migrating that is not a dir.
    rmSync(join(home, 'ccrc'));
    writeFileSync(join(home, 'ccrc'), 'not a tree\n');
    expect(layout(home)).toBe('unreadable||neither a directory nor a link');
    rmSync(join(home, 'ccrc'));
    writeFileSync(join(home, 'ccrc.migrating'), 'not a tree\n');
    expect(layout(home)).toBe('unreadable||absent beside a $HOME/ccrc.migrating that is not a directory');
  });

  it('_inst_version_name: a placed version names itself; git beats a stray build.json; build.json names an artifact; a deploy.sh tree is named by the box stamp; nothing measured is unstamped, fresh each time', () => {
    const home = mkTmp('ccrc-ver-name-');
    // 1. a placed version — and a dot-named sibling under the root is NOT one
    installVersionedTree(home, 'v1.2.3', { link: false });
    expect(nameOf(home, vroot(home, 'v1.2.3'))).toBe('v1.2.3');
    const incoming = vroot(home, '.v4.5.6.incoming.1');
    mkdirSync(incoming, { recursive: true });
    shipStamp(incoming, 'd'.repeat(40), 'v4.5.6');
    expect(nameOf(home, incoming)).toBe('v4.5.6');
    // 2. git: untagged, then a non-release tag (still untagged), then a release tag;
    //    a stray build.json beside the repository never outvotes it
    const repo = join(home, 'repo');
    installFixtureTree(home, 'repo');
    const sha = gitInit(repo);
    shipStamp(repo, 'e'.repeat(40), 'v9.9.9');
    expect(nameOf(home, repo)).toBe(`untagged-${sha.slice(0, 12)}`);
    const tag = (t: string): void => {
      const r = spawnSync('git', ['-C', repo, 'tag', t],
        { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`fixture git tag failed: ${r.stderr}`);
    };
    tag('release-7');
    expect(nameOf(home, repo)).toBe(`untagged-${sha.slice(0, 12)}`);
    tag('v2.3.4');
    expect(nameOf(home, repo)).toBe('v2.3.4');
    // 3. an artifact's build.json: its version; no version -> untagged-<sha12>;
    //    a sha that is not hex names nothing and falls through
    const art = join(home, 'artifact');
    mkdirSync(art);
    shipStamp(art, 'f'.repeat(40), 'v3.0.1');
    expect(nameOf(home, art)).toBe('v3.0.1');
    shipStamp(art, '0123456789abcdef0123456789abcdef01234567');
    expect(nameOf(home, art)).toBe('untagged-0123456789ab');
    shipStamp(art, 'not-a-sha');
    expect(nameOf(home, art)).toMatch(/^unstamped-[0-9a-f]{12}$/);
    // 4. the live ~/ccrc of a pre-versioned box, named by the box's own stamp
    const deployed = mkTmp('ccrc-ver-name-deployed-');
    mkdirSync(join(deployed, 'ccrc'));
    mkdirSync(join(deployed, '.ccrc'));
    writeFileSync(join(deployed, '.ccrc', 'build.json'),
      '{"sha":"1111111111111111111111111111111111111111","ref":"main","builtAt":"2026-09-01T00:00:00Z","dirty":false,"version":"v0.0.7"}\n');
    expect(nameOf(deployed, join(deployed, 'ccrc'))).toBe('v0.0.7');
    // 5. nothing measures it: unstamped, and never the same name twice
    const bare = join(home, 'bare');
    mkdirSync(bare);
    const a = nameOf(home, bare);
    const b = nameOf(home, bare);
    expect(a).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(b).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it('a fresh box: the tree lands in ~/ccrc-versions/<name>/, never at the live name, and ~/ccrc becomes an absolute link to it — after the deps, by one rename', () => {
    const home = freshBox('ccrc-install-ver-fresh-');
    const sha = gitInit(treeRoot(home));
    const name = `untagged-${sha.slice(0, 12)}`;
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink(), '~/ccrc is not a link').toBe(true);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, name));
    // The rsync's destination is the version directory, never $HOME/ccrc.
    const argv = read(join(home, 'rsync-argv')).trim().split('\n');
    expect(argv).toHaveLength(1);
    expect(argv[0]!.split(' ').at(-1)).toBe(`${vroot(home, name)}/`);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([vroot(home, name, 'server')]);
    const lines = r.stdout.split('\n');
    const at = (re: RegExp): number => lines.findIndex((l) => re.test(l));
    const placedAt = at(new RegExp(`^install: tree: placed ${name} at \\$HOME/ccrc-versions/${name}$`));
    const depsAt = at(/^install: tree: server runtime deps in place$/);
    const flipAt = at(new RegExp(`^install: tree: \\$HOME/ccrc -> \\$HOME/ccrc-versions/${name} \\(was nothing\\) — one rename$`));
    expect(placedAt, r.stdout).toBeGreaterThanOrEqual(0);
    expect(depsAt).toBeGreaterThan(placedAt);
    expect(flipAt, 'the flip ran before the deps were in place').toBeGreaterThan(depsAt);
    expect(existsSync(join(home, 'ccrc.new')), 'the staged link was left behind').toBe(false);
    // The version keeps the box's stamp and record, written after the record.
    expect(read(vroot(home, name, '.ccrc-stamp.json'))).toBe(read(join(home, '.ccrc', 'build.json')));
    expect(read(vroot(home, name, '.ccrc-installed'))).toBe(read(join(home, '.ccrc', 'installed')));
    expect(statSync(vroot(home, name, '.ccrc-installed')).mode & 0o777).toBe(0o644);
    const keptAt = at(new RegExp(`^install: versions: kept ${name}'s stamp and install record in \\$HOME/ccrc-versions/${name} — what a flip back restores$`));
    expect(keptAt, r.stdout).toBeGreaterThan(at(/^install: installed: /));
    expect(strays(home)).toEqual([]);
  });

  it('a new name while ~/ccrc points at another version: rsync into ~/ccrc-versions/<new>/, flip, and the running version\'s directory is byte-unchanged', () => {
    const home = freshBox('ccrc-install-ver-new-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    shipStamp(treeRoot(home), 'b'.repeat(40), 'v9.9.1');
    const before = treeBytes(vroot(home, 'v9.9.0'));
    const r = runInstall(home, ['install'], {}, { stubs: { ln: lnRecorder } });
    expect(r.code, r.stderr).toBe(0);
    expect(treeBytes(vroot(home, 'v9.9.0')), 'the running version was written into').toEqual(before);
    // The flip went through the staged name: `ln` wrote `~/ccrc.new`, and no
    // `ln` in the whole run targeted `~/ccrc` itself (unlink + symlink).
    const lns = read(join(home, 'ln-argv')).trim().split('\n');
    expect(lns.filter((l) => l.endsWith(` ${join(home, 'ccrc.new')}`))).toEqual([
      `-sfn -- ${vroot(home, 'v9.9.1')} ${join(home, 'ccrc.new')}`,
    ]);
    expect(lns.filter((l) => l.endsWith(` ${join(home, 'ccrc')}`)), 'an ln targeted the live link').toEqual([]);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.1'));
    expect(read(join(home, 'rsync-argv')).trim().split(' ').at(-1)).toBe(`${vroot(home, 'v9.9.1')}/`);
    expect(r.stdout).toMatch(/^install: tree: placed v9\.9\.1 at \$HOME\/ccrc-versions\/v9\.9\.1$/m);
    expect(r.stdout).toMatch(/^install: tree: \$HOME\/ccrc -> \$HOME\/ccrc-versions\/v9\.9\.1 \(was \$HOME\/ccrc-versions\/v9\.9\.0\) — one rename$/m);
    expect(JSON.parse(read(vroot(home, 'v9.9.1', '.ccrc-stamp.json'))).version).toBe('v9.9.1');
  });

  it('a re-run from the version ~/ccrc points at: the pre-W6 sentence, no copy, no npm ci, no flip — and the stamp comes from the version\'s own kept copy', () => {
    const home = mkTmp('ccrc-install-ver-rerun-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    healthyDoctorBox(home);
    const r = runInstall(home, ['install'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    expect(existsSync(join(home, 'rsync-argv')), 'rsync ran against the running version').toBe(false);
    expect(r.stdout).toMatch(/^install: tree: v9\.9\.0 is complete \(its kept install record is present\) — no npm ci$/m);
    expect(existsSync(join(home, 'npm-argv')), 'npm ci emptied the running version\'s node_modules').toBe(false);
    expect(r.stdout).not.toMatch(/one rename$/m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.0'));
    expect(r.stdout).toMatch(/^install: stamp: 9{40} \(main, v9\.9\.0, kept with its version\)$/m);
    expect(JSON.parse(read(join(home, '.ccrc', 'build.json'))).version).toBe('v9.9.0');
  });

  it('a run of ANOTHER placed version\'s own ccrc flips to it without copying; a complete one fetches no deps, an incomplete one does', () => {
    const home = mkTmp('ccrc-install-ver-other-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    installVersionedTree(home, 'v9.9.1', { link: false, stamp: { sha: 'c'.repeat(40), version: 'v9.9.1' } });
    healthyDoctorBox(home);
    const before = treeBytes(vroot(home, 'v9.9.0'));
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: v9\.9\.1 is already placed at \$HOME\/ccrc-versions\/v9\.9\.1 — installing from it, no copy$/m);
    expect(existsSync(join(home, 'rsync-argv')), 'a placed version was copied onto itself').toBe(false);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(r.stdout).toMatch(/^install: tree: \$HOME\/ccrc -> \$HOME\/ccrc-versions\/v9\.9\.1 \(was \$HOME\/ccrc-versions\/v9\.9\.0\) — one rename$/m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.1'));
    expect(treeBytes(vroot(home, 'v9.9.0'))).toEqual(before);

    const inc = mkTmp('ccrc-install-ver-incomplete-');
    installVersionedTree(inc, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    installVersionedTree(inc, 'v9.9.1', { link: false, complete: false });
    healthyDoctorBox(inc);
    const ri = runInstall(inc, ['install'], {}, { from: vroot(inc, 'v9.9.1', 'ccd', 'ccrc') });
    expect(ri.code, ri.stderr).toBe(0);
    expect(read(join(inc, 'npm-cwd')).trim().split('\n')).toEqual([vroot(inc, 'v9.9.1', 'server')]);
    expect(readlinkSync(join(inc, 'ccrc'))).toBe(vroot(inc, 'v9.9.1'));
  });

  it('an npm ci that fails leaves ~/ccrc where it was — the flip is the LAST act of _inst_tree', () => {
    const home = freshBox('ccrc-install-ver-npmfail-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    shipStamp(treeRoot(home), 'b'.repeat(40), 'v9.9.1');
    const r = runInstall(home, ['install'], {}, {
      stubs: { npm: '#!/bin/sh\necho "npm ERR! code ENOTFOUND registry.npmjs.org" >&2\nexit 1\n' },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: npm ci in \$HOME\/ccrc-versions\/v9\.9\.1\/server failed — the service cannot start without runtime deps$/m);
    expect(readlinkSync(join(home, 'ccrc')), '~/ccrc was flipped onto a tree with no deps').toBe(vroot(home, 'v9.9.0'));
    expect(r.stdout).not.toMatch(/one rename$/m);
  });

  it('a re-placement that dies leaves its version INCOMPLETE — the kept record goes before the first byte is written', () => {
    const home = freshBox('ccrc-install-ver-void-');
    const sha = gitInit(treeRoot(home));
    const name = `untagged-${sha.slice(0, 12)}`;
    expect(runInstall(home).code).toBe(0);
    expect(existsSync(vroot(home, name, '.ccrc-installed')), 'the first run kept no record').toBe(true);
    const r = runInstall(home, ['install'], {}, {
      stubs: { npm: '#!/bin/sh\necho "npm ERR! fixture" >&2\nexit 1\n' },
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`^install: tree: reinstalled ${name} in place at `, 'm'));
    expect(existsSync(vroot(home, name, '.ccrc-installed')),
      'a version whose re-placement died still says it holds a finished install').toBe(false);
  });

  it('refuses to place or flip over a ~/ccrc this ccrc did not make — a foreign link, a regular file — and touches neither it nor the versions root', () => {
    const home = freshBox('ccrc-install-ver-foreign-');
    mkdirSync(join(home, 'elsewhere'));
    symlinkSync(join(home, 'elsewhere'), join(home, 'ccrc'));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: \$HOME\/ccrc is a link whose target is not a version directory under \$HOME\/ccrc-versions — refusing to place or flip a tree over something this ccrc did not make; \$HOME\/ccrc and \$HOME\/ccrc-versions were not touched$/m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'elsewhere'));
    expect(readdirSync(join(home, 'elsewhere'))).toEqual([]);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'rsync-argv'))).toBe(false);

    const file = freshBox('ccrc-install-ver-file-');
    writeFileSync(join(file, 'ccrc'), 'not a tree\n');
    const rf = runInstall(file);
    expect(rf.code).toBe(1);
    expect(rf.stderr).toMatch(/^ccrc: \$HOME\/ccrc is neither a directory nor a link — refusing to place or flip/m);
    expect(read(join(file, 'ccrc'))).toBe('not a tree\n');
    expect(existsSync(vroot(file))).toBe(false);
  });

  it('_inst_tree names a crashed migration a bug and places nothing (the resume that precedes it is W6 Task 3\'s)', () => {
    const home = freshBox('ccrc-install-ver-crashed-');
    mkdirSync(join(home, 'ccrc.migrating', 'server'), { recursive: true });
    const r = sourced(home, ccrcIn(treeRoot(home)), 'INST_ROLE=both; _inst_tree');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: a migration of \$HOME\/ccrc is incomplete — this run should have completed it first$/m);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });

  it('the kept record is written LAST: a run killed at the stamp copy leaves no record copy, and a refused record copy takes the stamp copy with it', () => {
    const killed = freshBox('ccrc-install-ver-kill-');
    const sha = gitInit(treeRoot(killed));
    const name = `untagged-${sha.slice(0, 12)}`;
    writeFileSync(join(killed, 'fixture-kill-at-stamp-copy'), '');
    const r = runInstall(killed, ['install'], {}, { stubs: { mv: mvKnobs } });
    expect(r.code, 'the run was not killed at the stamp copy').toBe(-1);
    expect(existsSync(join(killed, '.ccrc', 'installed')), 'the fixture killed the run before the record').toBe(true);
    expect(existsSync(vroot(killed, name, '.ccrc-installed')),
      'a version that never kept its stamp is marked complete').toBe(false);
    expect(existsSync(vroot(killed, name, '.ccrc-stamp.json'))).toBe(false);

    const refused = freshBox('ccrc-install-ver-refuse-');
    const rsha = gitInit(treeRoot(refused));
    const rname = `untagged-${rsha.slice(0, 12)}`;
    writeFileSync(join(refused, 'fixture-fail-at-record-copy'), '');
    const rr = runInstall(refused, ['install'], {}, { stubs: { mv: mvKnobs } });
    expect(rr.code, rr.stderr).toBe(0);
    expect(rr.stdout).toMatch(new RegExp(`^install: versions: WARN: could not keep ${rname}'s stamp and install record in its directory — no flip can return to it; arm 2 still can$`, 'm'));
    expect(existsSync(vroot(refused, rname, '.ccrc-stamp.json')), 'half a pair survived').toBe(false);
    expect(existsSync(vroot(refused, rname, '.ccrc-installed'))).toBe(false);
    expect(strays(refused)).toEqual([]);
  });

  itDarwin('refuses on macOS without python3, before anything is written — the flip is one rename through os.replace', () => {
    const home = freshBox('ccrc-install-ver-nopython-');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'python3') }, { omit: ['python3'] });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: python3 is required by 'ccrc install' on macOS — the \$HOME\/ccrc flip is one rename\(2\) through os\.replace/m);
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(false);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });

  itDarwin('refuses on macOS when the python3 on PATH does not RUN — /usr/bin/python3 is an xcode-select stub until the Command Line Tools are installed — before anything is written', () => {
    // The shape a real Mac without the Command Line Tools has: `command -v
    // python3` answers /usr/bin/python3, and running it prints the
    // xcode-select note and exits non-zero. The case above (no python3 on
    // PATH at all) cannot happen on macOS; this one is the one that does.
    const home = freshBox('ccrc-install-ver-stubpython-');
    const r = runInstall(home, ['install'], {}, {
      stubs: { python3: '#!/bin/sh\necho "xcode-select: note: No developer tools were found, requesting install." >&2\nexit 1\n' },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: python3 is required by 'ccrc install' on macOS — the \$HOME\/ccrc flip is one rename\(2\) through os\.replace/m);
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(false);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
    expect(existsSync(join(home, 'rsync-argv')), 'a tree was placed before the refusal').toBe(false);
  });
});
```

(e) `server/test/ccrc-update.test.ts`. In the `node:fs` import (`:39-43`), the line `  symlinkSync,` becomes `  symlinkSync, readlinkSync,`. Locate the `./platformFixtures.js` import by its module (`grep -n "from './platformFixtures.js'" server/test/ccrc-update.test.ts` — `:48`; **correction (review):** wave 4 Task 8 widened it to `import { itLinux, itDarwin, platformContrast } from './platformFixtures.js';`, so its old text no longer matches): add `python3ProgramArm` to the end of its list, and on the line after it add `import { installVersionedTree } from './installTreeFixture.js';` (that exact line — W6 Task 4's Step 1 counts it). After `const REAL_NODE = realPath('node');` (`:60`) add:

```ts
/** The real python3, resolved once and without a throw (W6 Task 2): only the
 *  two macOS programs of `DARWIN_PYTHON3_PROGRAMS` reach it, through the
 *  `python3` stub's `-c` arm. */
const REAL_PYTHON3 = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim();
```

In `updateEnv`'s `python3` stub (`:263-275`), directly above its last array element `    'echo "fixture python3: unexpected argv: $*" >&2; exit 90',` add:

```ts
    // W6 Task 2: the staged spine's Darwin flip (`os.replace`) and its
    // preflight probe (`import os`) go to the real interpreter; every other
    // `-c` is refused below, like any other unexpected argv.
    ...python3ProgramArm(REAL_PYTHON3),
```

In `describe('ccrc update: fetch + verify, then back up, then install, then report'`, directly above `  it('a spine that COMPLETED under a failing doctor exits 3, not 1: …` (`:696`), i.e. right after the happy path closes, add:

```ts
  it('happy path on a VERSIONED box (W6 Task 2): v2.0.0 is placed in ~/ccrc-versions/v2.0.0, ~/ccrc flips to it, and v1.0.0\'s directory is byte-unchanged', () => {
    // The staged spine is the real one (FULL flavour), so this is the
    // install path `ccrc update` really takes on a box that is already on the
    // W6 layout: the staged tree names itself from its shipped build.json
    // (`_inst_version_name` rule 3), is placed beside the running version,
    // and the link is renamed only after its deps are in place.
    const home = freshUpdateBox('ccrc-update-versioned-');
    plantOldBox(home, { version: 'v1.0.0' });
    rmSync(join(home, 'ccrc'), { recursive: true, force: true });
    installVersionedTree(home, 'v1.0.0', { stamp: { sha: '1'.repeat(40), version: 'v1.0.0' } });
    plantCoordDb(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc-versions', 'v1.0.0'));
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(treeDigest(join(home, 'ccrc-versions', 'v1.0.0')),
      'the update wrote into the version it was replacing').toEqual(before);
    expect(r.stdout).toMatch(/^install: tree: placed v2\.0\.0 at \$HOME\/ccrc-versions\/v2\.0\.0$/m);
    expect(r.stdout).toMatch(/^install: tree: \$HOME\/ccrc -> \$HOME\/ccrc-versions\/v2\.0\.0 \(was \$HOME\/ccrc-versions\/v1\.0\.0\) — one rename$/m);
    expect(readFileSync(join(home, 'npm-cwd'), 'utf8').trim().split('\n')[0])
      .toBe(join(home, 'ccrc-versions', 'v2.0.0', 'server'));
    // The new version keeps the stamp and record this update left on the box.
    expect(readFileSync(join(home, 'ccrc-versions', 'v2.0.0', '.ccrc-installed'), 'utf8'))
      .toBe(readFileSync(join(home, '.ccrc', 'installed'), 'utf8'));
    expect(readFileSync(join(home, 'ccrc-versions', 'v2.0.0', '.ccrc-stamp.json'), 'utf8'))
      .toBe(readFileSync(join(home, '.ccrc', 'build.json'), 'utf8'));
  });

  it('a VERSIONED box whose staged npm ci fails replaced nothing: exit 1 BEFORE the gate, no restore, and v1.0.0 — the running version — byte-unchanged (D-3457)', () => {
    // The commonest failure — the registry is down — kills the W6 spine
    // inside `_inst_tree` (marker `_inst_tree`), after the rsync into
    // ~/ccrc-versions/v2.0.0 and BEFORE the flip. Wave 4 alone reads that
    // marker as "the tree WAS replaced", gates a unit still on v1.0.0, fails,
    // and its arm-2 child re-installs v1.0.0 IN PLACE: rsync --delete and
    // npm ci inside the running version.
    const home = freshUpdateBox('ccrc-update-versioned-npmfail-');
    plantOldBox(home, { version: 'v1.0.0' });
    rmSync(join(home, 'ccrc'), { recursive: true, force: true });
    installVersionedTree(home, 'v1.0.0', { stamp: { sha: '1'.repeat(40), version: 'v1.0.0' } });
    plantCoordDb(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc-versions', 'v1.0.0'));
    // Ahead of the recorder npm that `runUpdate` re-plants on every call
    // (the `a spine that DIED …` case's idiom).
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'npm'),
      '#!/bin/sh\necho "npm ERR! code ENOTFOUND registry.npmjs.org" >&2\nexit 1\n', { mode: 0o755 });
    const r = runUpdate(home, [], { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: the staged install \(which ends with doctor\) exited 1 — spine died at _inst_tree, before its flip: nothing was replaced \(\$HOME\/ccrc still points at \$HOME\/ccrc-versions\/v1\.0\.0\); read its lines above\. The backup taken BEFORE it ran is complete at \S+\/ccrc-backups\/\S+$/m);
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_tree\n');
    expect(r.stdout, 'a death that replaced nothing was gated').not.toMatch(/^update: gate/m);
    expect(r.stdout, 'a death that replaced nothing was restored').not.toMatch(/^update: (arm|REVERTED)/m);
    const phases = reportWrites(home).map((w) => w['phase']);
    expect(phases, 'the report went through the gate').not.toContain('checking');
    expect(phases, 'the report went through a restore').not.toContain('restoring');
    expect(lastReport(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_tree', target: 'v2.0.0' });
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    expect(treeDigest(join(home, 'ccrc-versions', 'v1.0.0')),
      'the running version was written into').toEqual(before);
  });

  it('_upd_tree_untouched (VERSIONED layouts): nothing replaced only for a W6 spine, a new name, and a layout that still reads what it read before', () => {
    const home = freshUpdateBox('ccrc-update-untouched-');
    installVersionedTree(home, 'v1.0.0');
    // Two staged trees: one whose ccrc declares the versions root (a W6
    // spine) and one whose ccrc does not (a spine older than W6).
    mkdirSync(join(home, 'stage-w6', 'ccd'), { recursive: true });
    writeFileSync(join(home, 'stage-w6', 'ccd', 'ccrc'), 'BOX_VERSIONS_ROOT="$HOME/ccrc-versions"\n');
    mkdirSync(join(home, 'stage-old', 'ccd'), { recursive: true });
    writeFileSync(join(home, 'stage-old', 'ccd', 'ccrc'), 'BOX_TREE_DIR="$HOME/ccrc"\n');
    const ask = (h: string, tree: string, version: string, pl: string, pc: string): string =>
      sourcedCcrc(h, `UPD_TREE='${join(home, tree)}'; UPD_VERSION='${version}'; `
        + `_upd_tree_untouched '${pl}' '${pc}'; echo "rc=$?"`).stdout.trim();
    // A W6 spine, a new name, the link where it was: nothing replaced.
    expect(ask(home, 'stage-w6', 'v2.0.0', 'linked', 'v1.0.0'))
      .toBe('$HOME/ccrc still points at $HOME/ccrc-versions/v1.0.0\nrc=0');
    // The same name: the in-place reinstall wrote INTO the running version (M17).
    expect(ask(home, 'stage-w6', 'v1.0.0', 'linked', 'v1.0.0')).toBe('rc=1');
    // A spine older than W6 writes THROUGH ~/ccrc (M16).
    expect(ask(home, 'stage-old', 'v2.0.0', 'linked', 'v1.0.0')).toBe('rc=1');
    // The link points somewhere else than it did before the spine (M18).
    expect(ask(home, 'stage-w6', 'v2.0.0', 'linked', 'v0.9.0')).toBe('rc=1');
    // Was foreign, reads linked now: not the same word.
    expect(ask(home, 'stage-w6', 'v2.0.0', 'foreign', '')).toBe('rc=1');

    // A FOREIGN ~/ccrc still foreign: `_inst_tree` refused it before a byte.
    const alien = freshUpdateBox('ccrc-update-untouched-foreign-');
    mkdirSync(join(alien, 'elsewhere'));
    symlinkSync(join(alien, 'elsewhere'), join(alien, 'ccrc'));
    expect(ask(alien, 'stage-w6', 'v2.0.0', 'foreign', ''))
      .toBe('$HOME/ccrc is still a link whose target is not a version directory under $HOME/ccrc-versions, which the spine refused to place over\nrc=0');
    expect(ask(alien, 'stage-old', 'v2.0.0', 'foreign', '')).toBe('rc=1');

    // A pre-versioned DIRECTORY is still rsynced in place by `_inst_tree`'s
    // `directory` arm at this task's commit, so nothing is proven.
    const dir = freshUpdateBox('ccrc-update-untouched-dir-');
    mkdirSync(join(dir, 'ccrc', 'server'), { recursive: true });
    expect(ask(dir, 'stage-w6', 'v2.0.0', 'directory', '')).toBe('rc=1');
  });
```

(f) `server/test/single-definition.test.ts`. In `it('the ccrc CLI spells the path once and parses it once'`, in the `BOX_STAMP_FILE` list, between `      '*) printf \'build:     unreadable (%s does not parse as a build stamp)\\n\' "$BOX_STAMP_FILE" ;;',` (`:1399`, `cmd_status`) and `      'mkdir -p "${BOX_STAMP_FILE%/*}" || _ccrc_die "cannot create ${BOX_STAMP_FILE%/*}"',` (`:1400`, `_inst_stamp_shipped`) insert:

```ts
      // W6 Task 2: `_ver_keep_state` copies the stamp into the version
      // directory it describes — a reader, through one local.
      'local from_stamp="$BOX_STAMP_FILE"',
```

In `it('the ccrc CLI spells the path once, and every other site goes through BOX_INSTALLED_FILE'`, between `      '{ IFS= read -r rec || rec=""; IFS= read -r prov || prov=""; } < "$BOX_INSTALLED_FILE"',` (`:1503`, `cmd_version`) and `      'local rc=0 tmp dest="$BOX_INSTALLED_FILE"',` (`:1504`, `_inst_installed`) insert:

```ts
      // W6 Task 2: `_ver_keep_state` copies the record into the version
      // directory it describes, as that version's completeness mark.
      'local from_record="$BOX_INSTALLED_FILE"',
```

Both are document order: `_ver_keep_state` sits above `_inst_tree` (`:9516`), after `cmd_status` (`:2286-2289`) and `cmd_version` (`:1797-1798`) and before `_inst_stamp_shipped` (`:9974`) and `_inst_installed` (`:11177`). Wave 4 adds no `BOX_INSTALLED_FILE` line between `:1798` and `:11177` (its additions are `_upd_marker_unsigned`, arm 3, the watchdog and `_upd_write_previous`, all below `cmd_update`), so the neighbours above hold on its tree; if a later edit moved one, re-derive the order with `grep -n 'BOX_INSTALLED_FILE\|BOX_STAMP_FILE' ccd/ccrc | grep -v '^[0-9]*: *#'`.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'versioned tree|the shipped tree lands'`
Expected: FAIL — 17 cases (measured 2026-09-23 against `d759c914` plus Task 1's helper): the eleven Linux cases of the new describe (`_ver_layout` answers nothing: `expected '' to be 'absent||'`; `_inst_version_name` likewise `expected '' to be 'v1.2.3'`; the fresh box `~/ccrc is not a link`; the re-run and other-version cases miss their sentences; the crashed case runs the old `_inst_tree`, which reaches the sourced harness's poisoned `rsync` and dies `placing the tree at … failed`; the kill case `the run was not killed at the stamp copy`) and the six moved assertions of `the shipped tree lands at $HOME/ccrc` (the agent/server `npm-cwd` lists, the placed sentence, the npm die sentence, the in-place sentence — `readlinkSync` of a real directory is `EINVAL`). The two `itDarwin` cases are skipped on Linux (**review:** the second, the stub-python3 case, adds no Linux red; the `_ver_layout` case's new link-to-a-link row sits inside a case that is already red).

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'VERSIONED'`
Expected: FAIL — three cases. The happy path: `readlinkSync(~/ccrc)` still names `v1.0.0` (the old `_inst_tree` rsyncs through the link into it). The npm-fail case (**added, review**): `expected 4 to be 1`. The old `_inst_tree` rsyncs through the link INTO `v1.0.0`, so its digest has moved too, and wave 4 reads the `_inst_tree` marker as moved, gates, fails and restores. The `_upd_tree_untouched` table: its first row prints `rc=127` (`_upd_tree_untouched: command not found`).

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts`
Expected: FAIL — exactly two: `one bash reader of ~/.ccrc/build.json > the ccrc CLI spells the path once and parses it once` and `one bash spelling of ~/.ccrc/installed > the ccrc CLI spells the path once, and every other site goes through BOX_INSTALLED_FILE` (each list names a line `ccd/ccrc` does not have yet).

- [ ] **Step 3: Implement**

(a) In `ccd/ccrc`, directly after `BOX_BACKUP_ROOT="$HOME/ccrc-backups"` (`:1324`) add:

```bash
# ── WHERE A BOX KEEPS THE VERSIONS IT INSTALLED (W6 Task 2, spec §11) ─────
# `~/ccrc-versions/<name>/` holds one placed tree per release this box
# installed — a sibling of `~/ccrc-backups` above, for the reason that root is
# one directory: a rollback is a directory, not a hunt. `~/ccrc` (BOX_TREE_DIR)
# is a symlink to ONE of them, written with an ABSOLUTE target by
# `_plat_ln_swap`, so every contract that names `$HOME/ccrc` — the launcher,
# the units, the plist, doctor's `_dr_pkg_candidates` — keeps resolving
# through the link unchanged, and an install never rewrites the tree that is
# running: it places the next one beside it, then renames the link.
#
# A NAME is one of three shapes, and VER_NAME_RE is their one spelling: the
# release tag `vX.Y.Z`; `untagged-<sha12>` for a source or deploy.sh-shaped
# tree (D-3422); `unstamped-<12 hex>` for a tree whose
# identity nothing measures (D-3425). Only a tag-shaped
# name is ever handed to `--to`, `previous` or the gate. `~/ccrc.migrating`
# is the pre-versioned tree while the one-time migration waits for its gate
# (W6 Task 3 writes it; `_ver_layout` reads it from here).
#
# Each version directory keeps two files at its root, dot-named so no reader
# of a release tree's own `build.json` mistakes one for the artifact's: the
# box's stamp and its completed-install record as they stood when this version
# last completed an install here (D-3428). The record
# copy is written LAST and is the version's completeness mark.
BOX_VERSIONS_ROOT="$HOME/ccrc-versions"
BOX_MIGRATING_DIR="$HOME/ccrc.migrating"
VER_NAME_RE='^(v[0-9]+\.[0-9]+\.[0-9]+|untagged-[0-9a-f]{12}|unstamped-[0-9a-f]{12})$'
VER_STAMP_COPY=".ccrc-stamp.json"
VER_RECORD_COPY=".ccrc-installed"
```

(b) In the `BOX_TREE_DIR` header, between the comment line `# file resolves.` (`:1281`) and `BOX_TREE_DIR="$HOME/ccrc"` (`:1282`) add:

```bash
#
# SINCE W6 THE NAME IS A LINK, not a directory: `$HOME/ccrc ->
# $HOME/ccrc-versions/<name>` (BOX_VERSIONS_ROOT below). Every contract above
# keeps resolving through it unchanged; `_inst_tree` places into the versions
# root and renames the link, and only `_inst_tree`'s guard and `_ver_layout`
# ever look at where it points.
```

(c) Directly after `BOX_HEALTH_WHY=""` (`:1394`) add:

```bash
# `_ver_layout`'s out-parameters (W6 Task 2), declared at file scope for the
# `set -u` reason the arrays above are: every reader of the layout reads them
# whether or not the layout was measured in its own frame.
VER_LAYOUT=""
VER_CURRENT=""
VER_WHY=""
```

(d) In `_box_build_fields`' header comment, replace the three lines

```bash
  # TWO callers pass one, and each reads a RELEASE ARTIFACT'S OWN
  # `build.json`, never the box's:
  #   `_inst_stamp_shipped` — the stamp that came inside the artifact,
```

with

```bash
  # THREE callers pass one, and none of them reads the box's own stamp:
  #   `_inst_stamp_shipped` — the stamp that came inside the artifact (or,
  #     for a placed version run from itself, the copy that version kept,
  #     W6 Task 2),
```

and after the `_upd_converged` bullet's last line `  #     the caller holding the staged tree's fields.` add

```bash
  #   `_inst_version_name` (W6 Task 2) — a SOURCE tree's `build.json`, read
  #     only to name the version directory that tree is placed into; it
  #     saves and restores `BOX_BUILD` around the call, as `_upd_converged`
  #     does.
```

(e) Directly above `_inst_tree() {` (`:9516`) add the three helpers:

```bash
# ── _ver_layout — what $HOME/ccrc is, in one word (W6 Task 2) ─────────────
# The ONE reader of the versioned layout; every caller that must know whether
# `~/ccrc` is a version link, a pre-versioned directory, or the debris of a
# crashed migration asks here, and nobody else resolves the link to decide.
# Always rc 0 and silent; the answer is in three out-parameters:
#   VER_LAYOUT   absent | crashed | directory | linked | migrated | foreign | unreadable
#   VER_CURRENT  the version name `~/ccrc` points at (linked|migrated only, else "")
#   VER_WHY      for foreign|unreadable, a phrase that completes "$HOME/ccrc is …"
#
# PLAIN `readlink`, never `-f`: the question is what the LINK SAYS, and the
# only value this file writes there is the absolute `$BOX_VERSIONS_ROOT/<name>`
# (`_plat_ln_swap`'s target, verbatim). Any other value — a relative target,
# a path elsewhere, a name outside VER_NAME_RE, a dangling or non-directory
# target — is `foreign`: a link this ccrc did not make, which nothing here may
# flip over or place through. VER_WHY is built from this function's own words,
# never from the link's bytes, so a hostile target cannot reach a terminal.
#
# `unreadable` is everything that fits no other word: a regular file at the
# name, a link `readlink` cannot read, or TWO trees — a real `~/ccrc` beside a
# `~/ccrc.migrating`, where which one the units run is not known — and a
# `~/ccrc.migrating` that is not a directory.
_ver_layout() {
  local link="$BOX_TREE_DIR" mig="$BOX_MIGRATING_DIR" val="" name="" m=none
  VER_LAYOUT="" VER_CURRENT="" VER_WHY=""
  if [ -L "$mig" ]; then m=other
  elif [ -d "$mig" ]; then m=dir
  elif [ -e "$mig" ]; then m=other
  fi
  if [ -L "$link" ]; then
    if ! val="$(readlink -- "$link" 2>/dev/null)" || [ -z "$val" ]; then
      VER_LAYOUT=unreadable VER_WHY="a link readlink could not read"
      return 0
    fi
    name="${val#"$BOX_VERSIONS_ROOT"/}"
    if [ "$val" != "$BOX_VERSIONS_ROOT/$name" ] || [[ ! "$name" =~ $VER_NAME_RE ]] \
       || [ -L "$val" ] || [ ! -d "$val" ]; then
      VER_LAYOUT=foreign VER_WHY="a link whose target is not a version directory under \$HOME/ccrc-versions"
      return 0
    fi
    case "$m" in
      none) VER_LAYOUT=linked VER_CURRENT="$name" ;;
      dir)  VER_LAYOUT=migrated VER_CURRENT="$name" ;;
      *)    VER_LAYOUT=unreadable VER_WHY="a version link beside a \$HOME/ccrc.migrating that is not a directory" ;;
    esac
    return 0
  fi
  if [ ! -e "$link" ]; then
    case "$m" in
      none) VER_LAYOUT=absent ;;
      dir)  VER_LAYOUT=crashed ;;
      *)    VER_LAYOUT=unreadable VER_WHY="absent beside a \$HOME/ccrc.migrating that is not a directory" ;;
    esac
    return 0
  fi
  if [ -d "$link" ]; then
    if [ "$m" = none ]; then
      VER_LAYOUT=directory
    else
      VER_LAYOUT=unreadable VER_WHY="a directory beside a \$HOME/ccrc.migrating — two trees, and which one runs is not known"
    fi
    return 0
  fi
  VER_LAYOUT=unreadable VER_WHY="neither a directory nor a link"
  return 0
}

# ── _inst_version_name <src> — the directory a source tree is placed into ─
# (W6 Task 2). `<src>` is the PHYSICAL path of the tree this run installs from
# (`_inst_tree`'s `pwd -P`). Prints exactly one name matching VER_NAME_RE and
# never fails. First match wins:
#   1. `<src>` is a placed version — `<physical versions root>/<n>`, `<n>` a
#      version name — and names itself, so a run of a kept version's own
#      `ccd/ccrc` is recognised as that version and nothing is copied.
#   2. git answers for `<src>`: the release tag at HEAD, else
#      `untagged-<sha12>` (D-3422). The same precedence
#      `_inst_stamp` gives git — a checkout's own state is the truth about a
#      checkout, and a stray `build.json` beside it never outvotes it. The tag
#      is picked by bash rather than `grep | head`, which keeps this step's
#      tool list at the two `pathWithout` gains (`ln`, `readlink`).
#   3. `<src>/build.json` parses (`_box_build_fields`, the one stamp parser):
#      its `version`, else `untagged-<sha12>`. The release artifact's case.
#   4. `<src>` is the physical `~/ccrc` of a pre-versioned box (`directory`)
#      — a `deploy.sh`-shaped tree, which carries no `.git` and no
#      `build.json` — and the box's own stamp parses: the same rule on that
#      stamp.
#   5. Else `unstamped-<12 hex of _plat_uuid>` (D-3425): a
#      fresh name per placement, never sha-shaped, because two unmeasured
#      trees behind one sha-shaped name would be the overloaded value this
#      file refuses.
# A candidate that fails VER_NAME_RE (a sha that is not hex, say) falls
# through to the next rule. `BOX_BUILD` and the three `VER_*` out-parameters
# are saved and restored, so a caller that holds either keeps it.
_inst_version_name() {   # <src, physical> -> one VER_NAME_RE name on stdout
  local src="$1" vroot="" n="" sha="" t="" here=""
  local sl="$VER_LAYOUT" sc="$VER_CURRENT" sw="$VER_WHY"
  local -a saved=("${BOX_BUILD[@]}")
  if [ -d "$BOX_VERSIONS_ROOT" ] && vroot="$(cd "$BOX_VERSIONS_ROOT" 2>/dev/null && pwd -P)" \
     && [ "${src%/*}" = "$vroot" ] && [[ "${src##*/}" =~ $VER_NAME_RE ]]; then
    printf '%s\n' "${src##*/}"
    return 0
  fi
  if command -v git >/dev/null 2>&1 && sha="$(git -C "$src" rev-parse HEAD 2>/dev/null)" \
     && [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    while IFS= read -r t; do
      if [[ "$t" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then n="$t"; break; fi
    done < <(git -C "$src" tag --points-at HEAD 2>/dev/null)
    [ -n "$n" ] || n="untagged-${sha:0:12}"
    if [[ "$n" =~ $VER_NAME_RE ]]; then printf '%s\n' "$n"; return 0; fi
  fi
  n=""
  if [ -f "$src/build.json" ] && _box_build_fields "$src/build.json"; then
    n="${BOX_BUILD[4]:-untagged-${BOX_BUILD[0]:0:12}}"
  fi
  BOX_BUILD=("${saved[@]}")
  if [ -n "$n" ] && [[ "$n" =~ $VER_NAME_RE ]]; then printf '%s\n' "$n"; return 0; fi
  n=""
  _ver_layout
  if [ "$VER_LAYOUT" = directory ] && here="$(cd "$BOX_TREE_DIR" 2>/dev/null && pwd -P)" \
     && [ "$src" = "$here" ] && _box_build_fields; then
    n="${BOX_BUILD[4]:-untagged-${BOX_BUILD[0]:0:12}}"
  fi
  BOX_BUILD=("${saved[@]}")
  VER_LAYOUT="$sl" VER_CURRENT="$sc" VER_WHY="$sw"
  if [ -n "$n" ] && [[ "$n" =~ $VER_NAME_RE ]]; then printf '%s\n' "$n"; return 0; fi
  t="$(_plat_uuid 2>/dev/null)" || t=""
  t="${t//-/}"
  if [[ "${t:0:12}" =~ ^[0-9a-f]{12}$ ]]; then
    printf 'unstamped-%s\n' "${t:0:12}"
  else
    printf 'unstamped-%04x%04x%04x\n' "$RANDOM" "$RANDOM" "$RANDOM"
  fi
  return 0
}

# ── _ver_keep_state <prefix> — a version keeps what a flip back restores ──
# (W6 Task 2, D-3428). Copies the box's stamp and its
# completed-install record, as this completed install left them, into the
# root of the version `~/ccrc` points at: `$VER_STAMP_COPY`, then
# `$VER_RECORD_COPY`. A flip back to this version (W6 Task 4) restores both,
# because `/health` answers the stamp the server read at boot and the install
# that is being backed out of has already rewritten it — without a kept copy
# no flip back could pass its own gate.
#
# THE RECORD GOES LAST: it is the version's completeness mark, so a run that
# dies between the two copies leaves a version with a stamp and no record,
# which every reader treats as incomplete. Each copy is a temp beside its
# destination, chmod 644, then one rename (`_plat_mv_notdir`: a directory
# standing at the name refuses rather than swallowing the file). On any
# failure the record copy is removed first, then the stamp copy, so no half
# pair survives, and the line says what that costs.
#
# NEVER DIES and is silent unless `~/ccrc` is a version link (`linked` or
# `migrated`) and both files are regular files: a pre-versioned box keeps
# nothing, and a spine with no stamp has no record to keep.
_ver_keep_state() {   # <prefix>
  local prefix="$1" vdir s_dest r_dest s_tmp r_tmp
  local from_stamp="$BOX_STAMP_FILE"
  local from_record="$BOX_INSTALLED_FILE"
  _ver_layout
  case "$VER_LAYOUT" in linked|migrated) ;; *) return 0 ;; esac
  [ -f "$from_stamp" ] && [ -f "$from_record" ] || return 0
  vdir="$BOX_VERSIONS_ROOT/$VER_CURRENT"
  s_dest="$vdir/$VER_STAMP_COPY"
  r_dest="$vdir/$VER_RECORD_COPY"
  s_tmp="$s_dest.tmp.$$"
  r_tmp="$r_dest.tmp.$$"
  if cp -- "$from_stamp" "$s_tmp" 2>/dev/null && chmod 644 "$s_tmp" && _plat_mv_notdir "$s_tmp" "$s_dest" \
     && cp -- "$from_record" "$r_tmp" 2>/dev/null && chmod 644 "$r_tmp" && _plat_mv_notdir "$r_tmp" "$r_dest"; then
    echo "$prefix: versions: kept $VER_CURRENT's stamp and install record in \$HOME/ccrc-versions/$VER_CURRENT — what a flip back restores"
    return 0
  fi
  rm -f -- "$s_tmp" "$r_tmp" 2>/dev/null
  rm -f -- "$r_dest" 2>/dev/null
  rm -f -- "$s_dest" 2>/dev/null
  echo "$prefix: versions: WARN: could not keep $VER_CURRENT's stamp and install record in its directory — no flip can return to it; arm 2 still can"
  return 0
}
```

(f) `_inst_tree`. Replace its four header lines

```bash
_inst_tree() {   # place the shipped tree at ~/ccrc — the layout every sibling
  # contract assumes (shim target, _dr_pkg_candidates, BASH_SOURCE siblings; see
  # BOX_TREE_DIR's own header). Runs BEFORE the executables so the launcher's
  # target exists at the moment the launcher lands on PATH.
```

with

```bash
_inst_tree() {   # place the shipped tree at ~/ccrc-versions/<name>/ and point
  # ~/ccrc at it (W6 Task 2) — the link every sibling contract resolves through
  # (shim target, _dr_pkg_candidates, BASH_SOURCE siblings; see BOX_TREE_DIR's
  # and BOX_VERSIONS_ROOT's headers). Runs BEFORE the executables so the
  # launcher's target exists at the moment the launcher lands on PATH.
```

replace its `local` line `  local src dest="$BOX_TREE_DIR" at` (`:9536`) with `  local src name dest shown vroot="" how="" was="nothing" at`, and replace everything from the line `  # THE SELF-COPY GUARD, ON PHYSICAL PATHS.` (`:9566`) through the function's closing `}` (`:9638`) inclusive with:

```bash
  # ── (1) WHAT $HOME/ccrc IS, BEFORE ANYTHING IS WRITTEN (W6 Task 2) ─────
  # One reader decides (`_ver_layout`), and the three words this function
  # cannot build on refuse here, before a byte is placed. `crashed` never
  # reaches this line in a working tree: `cmd_install` and `cmd_update`
  # complete a crashed migration before their spines run (W6 Task 3), so
  # arriving here with the pair still on disk is a bug, and it is named as
  # one. `foreign`/`unreadable` are a `~/ccrc` this file did not make — a
  # link into somewhere else, a file, two trees — and neither a copy nor a
  # flip over it is safe to guess at.
  _ver_layout
  case "$VER_LAYOUT" in
    crashed)
      _ccrc_die "a migration of \$HOME/ccrc is incomplete — this run should have completed it first" ;;
    foreign|unreadable)
      _ccrc_die "\$HOME/ccrc is $VER_WHY — refusing to place or flip a tree over something this ccrc did not make; \$HOME/ccrc and \$HOME/ccrc-versions were not touched" ;;
  esac
  name="$(_inst_version_name "$src")"
  if [ "$VER_LAYOUT" = directory ]; then
    # ── (2) A PRE-VERSIONED BOX: THE TREE IN PLACE, AS BEFORE W6 ───────────
    # A real directory at `~/ccrc` is converged exactly as it was before
    # this wave — rsync into the live name, or the self-copy skip — until
    # the one-time migration (W6 Task 3) replaces this arm.
    #
    # THE SELF-COPY GUARD, ON PHYSICAL PATHS. On a box a deploy has already
    # touched — and on every re-run of this verb — `ccrc` IS `~/ccrc/ccd/ccrc`,
    # so source and destination are one directory. `rsync -a --delete X X/` is
    # not a no-op there: it copies the tree INTO ITSELF (`~/ccrc/ccrc/…`) and
    # then runs a `--delete` pass across the live tree it is reading from.
    # `pwd -P` on both sides because the two spellings arrive by different
    # routes ($HOME, and `$CCRC_HERE`'s parent from `${BASH_SOURCE[0]}`): a
    # symlinked component in either — /home -> /export/home is the classic —
    # makes a textual comparison answer "different" for one directory, which
    # is the exact case that must not reach rsync.
    dest="$BOX_TREE_DIR"
    shown="\$HOME/ccrc"
    at="$(cd "$dest" && pwd -P)" || _ccrc_die "cannot resolve $dest"
    if [ "$src" = "$at" ]; then how=running; else how=copy; fi
  else
    # ── (3) THE GUARD, RE-DERIVED AGAINST VERSIONS ─────────────────────────
    # The question is no longer "is the source the live tree" but "is the
    # source the version this run would place": `_inst_version_name` names a
    # placed version after its own directory, so a run of
    # `~/ccrc-versions/<n>/ccd/ccrc` has `src` = `<vroot>/<n>` exactly. Three
    # answers, and a fourth for everything else:
    #   running — the source IS the version `~/ccrc` points at (a re-run of
    #     `ccrc install` from the box's own launcher): nothing is copied, and
    #     the sentence is the pre-W6 one, byte for byte.
    #   placed  — the source IS a placed version, another one: installing
    #     from it copies nothing, and the flip below points `~/ccrc` at it
    #     (D-3427).
    #   copy, same name — the source is a checkout or a staged release
    #     whose name is the version `~/ccrc` points at: rsync IN PLACE into
    #     that directory, the one case this wave does not make atomic
    #     (D-3426).
    #   copy — a new name: rsync into `~/ccrc-versions/<name>/`, never into
    #     the live one, and flip after the deps.
    # `pwd -P` on the versions root for the self-copy guard's reason above;
    # `src` is already physical.
    dest="$BOX_VERSIONS_ROOT/$name"
    shown="\$HOME/ccrc-versions/$name"
    if [ -d "$BOX_VERSIONS_ROOT" ]; then
      vroot="$(cd "$BOX_VERSIONS_ROOT" && pwd -P)" || _ccrc_die "cannot resolve $BOX_VERSIONS_ROOT"
    fi
    if [ -n "$vroot" ] && [ "$src" = "$vroot/$name" ]; then
      if [ "$name" = "$VER_CURRENT" ]; then how=running; else how=placed; fi
    else
      how=copy
    fi
  fi
  case "$how" in
    running) echo "install: tree: already running from \$HOME/ccrc" ;;
    placed)  echo "install: tree: $name is already placed at \$HOME/ccrc-versions/$name — installing from it, no copy" ;;
    copy)
      command -v rsync >/dev/null 2>&1 || _ccrc_die "rsync is required to place the tree — sudo apt install rsync"
      # A version directory is INCOMPLETE from the first byte this run writes
      # into it until `_ver_keep_state` marks it again at the spine's end: its
      # kept install record goes first, so a run that dies half-way never
      # leaves a directory that says it holds a finished install
      # (D-3428).
      if [ "$VER_LAYOUT" != directory ]; then
        rm -f -- "$dest/$VER_RECORD_COPY" \
          || _ccrc_die "could not void the kept install record of $name before placing over it ($dest/$VER_RECORD_COPY) — nothing was copied"
      fi
      mkdir -p "$dest" || _ccrc_die "cannot create $dest"
      # The excludes are deploy.sh's (`:319-326`) minus `dist`, and they are not
      # tidiness: `*.env` and `ccrc-mail.token` are gitignored files holding LIVE
      # TOKENS, which `-a` would carry into a second, unmanaged copy at whatever
      # mode the checkout has. `node_modules` is excluded in both directions —
      # rsync does not delete what it was told to ignore, so the runtime deps
      # installed below survive every later `--delete` run instead of being
      # destroyed and refetched.
      #
      # `--checksum` is not optional either. The release tarball is reproducible
      # (`build-release.sh`: `--mtime=@0`), so `ccrc update` hands this rsync a
      # tree where every mtime is 0 — and the tree it placed last time has the
      # same. rsync's default quick check (size + mtime) then SKIPS any changed
      # file that kept its size. v0.0.11 shipped that way: dist-pwa/index.html
      # and sw.js wrap equal-length content hashes, so both were skipped while
      # the new bundle landed and `--delete` removed the old one — index.html
      # pointed at a file that no longer existed, and every load the service
      # worker did not answer was a black screen.
      #
      # The five sources carry no trailing slash, so `--delete` works inside
      # each of them and never at the destination's top level: a version
      # directory's two kept files (`$VER_STAMP_COPY`, `$VER_RECORD_COPY`)
      # are not the rsync's to remove.
      rsync -a --delete --checksum \
        --exclude node_modules --exclude .git --exclude '*.env' --exclude ccrc-mail.token \
        "$src/server" "$src/agent" "$src/shared" "$src/deploy" "$src/ccd" "$dest/" \
        || _ccrc_die "placing the tree at $dest failed"
      if [ "$VER_LAYOUT" = directory ]; then
        echo "install: tree: placed at \$HOME/ccrc"
      elif [ "$name" = "$VER_CURRENT" ]; then
        echo "install: tree: reinstalled $name in place at \$HOME/ccrc-versions/$name (the version \$HOME/ccrc points at; same name, same release)"
      else
        echo "install: tree: placed $name at \$HOME/ccrc-versions/$name"
      fi
      ;;
  esac
  # ── (4) THE DEPS ─────────────────────────────────────────────────────────
  # A placed version whose kept install record is present completed an
  # install on this box, runtime deps included, so a run FROM it — a re-run,
  # or a flip back to it (W6 Task 4) — fetches nothing: `npm ci` would empty
  # `node_modules` and reach the registry to rebuild what is already there
  # (D-3427). A fleet box also needs the agent's deps,
  # which a version completed under another role never fetched, so that one
  # directory is measured too. Every other case runs today's `npm ci`.
  #
  # `>&2` AND NOT `>/dev/null 2>&1` (fix round 1, Important 2). This is the
  # verb's most likely failure — a registry hiccup, no network, a lockfile out
  # of step with `package.json` — and swallowing npm's own error text left the
  # operator with the die below and no way to see which. That contradicts the
  # rule `_inst_accounts_sh` writes down 90 lines up ("stderr is deliberately
  # NOT captured … re-wording a fix into a shrug helps nobody") and diverges
  # from deploy, whose `npm ci` runs over ssh with both streams attached.
  # npm's STDOUT is redirected INTO stderr rather than kept, because an install
  # transcript is one `install: <step>: <result>` line per step on stdout and
  # "added 41 packages in 3s" is not this run's result — the file's two-register
  # split (results on stdout, everything else on stderr), applied to a child.
  if [ "$how" != copy ] && [ "$VER_LAYOUT" != directory ] && [ -f "$dest/$VER_RECORD_COPY" ] \
     && { [ "$INST_ROLE" != fleet ] || [ -d "$dest/agent/node_modules" ]; }; then
    echo "install: tree: $name is complete (its kept install record is present) — no npm ci"
  else
    ( cd "$dest/server" && npm ci --omit=dev --no-audit --no-fund >&2 ) \
      || _ccrc_die "npm ci in $shown/server failed — the service cannot start without runtime deps"
    echo "install: tree: server runtime deps in place"
    # D-1161 — THE AGENT NEEDS ITS DEPS TOO, and D-1159 stopped one import short.
    # That fix made the ENTRY POINT exist; it did not make the tree STARTABLE.
    # The rsync above excludes `node_modules` in both directions and this function
    # ran npm in `server/` only, so a fleet install placed `agent/dist` beside no
    # `agent/node_modules` — and `agent/src/server.ts` imports `ws` on line 6
    # (`agent/package.json` declares `ws` and `node-pty` as runtime deps).
    # `_inst_enable` then restarts `ccrc-agent.service` and node dies with the
    # same ERR_MODULE_NOT_FOUND, one import further in. The reference fleet only
    # escaped it because an earlier `deploy.sh agent` had left a `node_modules`
    # behind — which is why the postmortem saw the missing dist and stopped there.
    # `deploy/build-release.sh` has shipped `agent/package{,-lock}.json` "for
    # `npm ci --omit=dev` on the box" since it was written; this is the call that
    # was always meant to make.
    if [ "$INST_ROLE" = fleet ]; then
      ( cd "$dest/agent" && npm ci --omit=dev --no-audit --no-fund >&2 ) \
        || _ccrc_die "npm ci in $shown/agent failed — ccrc-agent.service cannot start without runtime deps"
      echo "install: tree: agent runtime deps in place"
    fi
  fi
  # ── (5) THE FLIP — the LAST act of this function ───────────────────────
  # After the deps, so `~/ccrc` never points at a tree whose `node_modules`
  # is not in place: a death anywhere above leaves the link where it was and
  # the running version untouched — which `cmd_update` re-measures rather
  # than assumes (`_upd_tree_untouched`). One rename (`_plat_ln_swap`, spec §11:
  # `ln -sfn <target> ~/ccrc.new && mv -T ~/ccrc.new ~/ccrc`), with the
  # absolute `$BOX_VERSIONS_ROOT/<name>` as the target, which is the value
  # `_ver_layout` reads back. No flip when `~/ccrc` already points at this
  # name (`running`, and the in-place reinstall), and none on a pre-versioned
  # box, whose one-time migration is W6 Task 3's.
  if [ "$VER_LAYOUT" != directory ] && [ "$name" != "$VER_CURRENT" ]; then
    [ -n "$VER_CURRENT" ] && was="\$HOME/ccrc-versions/$VER_CURRENT"
    _plat_ln_swap "$dest" "$BOX_TREE_DIR" \
      || _ccrc_die "could not point \$HOME/ccrc at \$HOME/ccrc-versions/$name (one rename) — the running tree is untouched; the new one is complete at $dest"
    echo "install: tree: \$HOME/ccrc -> \$HOME/ccrc-versions/$name (was $was) — one rename"
  fi
}
```

(The divergence comment, the two-preflights comment and the three preflights between the header and `:9566` are unchanged. The old self-copy guard's comment moves, verbatim, into the `directory` arm; the rsync's two comment paragraphs and D-1161's npm comment move verbatim into the new body.)

(g) `_inst_stamp_shipped` (`:9956-9981`): replace the whole block, from its header line `# ── _inst_stamp_shipped — the release-artifact arm (stage 4, Task 6) ──────` through its closing `}`, with:

```bash
# ── _inst_stamp_shipped — the release-artifact arm (stage 4, Task 6) ──────
# A box installing from an extracted release tarball has no repository to
# measure — `git rev-parse` fails there BY DESIGN — but the artifact carries
# its identity: `deploy/build-release.sh` writes `build.json` (sha, ref,
# builtAt, dirty:false, version) into the tree it tars, and the per-file
# MANIFEST covers it. When the git measurement is impossible and the tree
# ships that stamp, installing it IS a measurement — of the artifact, made on
# the release machine, verified file-by-file on this box before this step
# ran. It is validated through `_box_build_fields` (this file's ONE stamp
# parser — a second jq filter here is exactly what single-definition.test.ts
# forbids) and a stamp that does not parse is refused, falling through to the
# caller's ordinary skip line. The GIT measurement still wins whenever it is
# possible: a checkout's own state is the truth about a checkout, and a
# stray build.json beside a real repository must never outvote it.
#
# A PLACED VERSION'S OWN SPINE (W6 Task 2) finds no `build.json` beside it:
# `_inst_tree`'s rsync carries server/agent/shared/deploy/ccd and nothing at
# a tree's top level. So when the tree this script runs from has none, the
# stamp that version KEPT when it last completed an install here
# (`$VER_STAMP_COPY`, written by `_ver_keep_state`) is installed instead —
# the same parser, the same census line — and the transcript says which of
# the two it was (D-3428).
_inst_stamp_shipped() {
  local shipped="$CCRC_HERE/../build.json" from="shipped in the release artifact"
  if [ ! -f "$shipped" ]; then
    shipped="$CCRC_HERE/../$VER_STAMP_COPY"
    from="kept with its version"
  fi
  [ -f "$shipped" ] || return 1
  _box_build_fields "$shipped" || return 1
  mkdir -p "${BOX_STAMP_FILE%/*}" || _ccrc_die "cannot create ${BOX_STAMP_FILE%/*}"
  _inst_atomic "$shipped" "$BOX_STAMP_FILE" 644
  local said=""
  [ "${BOX_BUILD[3]}" = true ] && said=", dirty"
  [ -n "${BOX_BUILD[4]}" ] && said="$said, ${BOX_BUILD[4]}"
  echo "install: stamp: ${BOX_BUILD[0]} (${BOX_BUILD[1]}$said, $from)"
  return 0
}
```

(h) `_inst_installed` (wave 4's split): on the line directly after `  _inst_floor` (the call that follows `echo "install: installed: …"`), add

```bash
  # W6 Task 2: the version this spine completed keeps the stamp and record
  # a flip back restores (never dies; silent unless ~/ccrc is a version link).
  _ver_keep_state install
```

so the `install-step` removal (`rm -f -- "$BOX_INSTALL_STEP_FILE" \`) still follows it. Check it landed once: `grep -c '^  _ver_keep_state install$' ccd/ccrc` prints `1`.

(i) `cmd_install`'s Darwin preflight: directly after the `flock` probe (the two lines ending `… Install it: brew install flock. Nothing on this box was written or changed."`, `:9160-9161`) add:

```bash
    # python3: the `$HOME/ccrc` flip (`_plat_ln_swap`, W6) is ONE rename(2),
    # and macOS's mv cannot replace a symlink to a directory in one step —
    # its Darwin arm is python3's os.replace. The Xcode Command Line Tools,
    # Homebrew's own prerequisite, ship it; a box without them would place a
    # whole tree and then die at the flip.
    #
    # The probe RUNS the interpreter, because `command -v` cannot see that
    # box: every macOS since 10.15 has /usr/bin/python3 as an xcode-select
    # stub, found on PATH and failing when run until the tools are installed.
    # `import os` is the flip's own first word, and the harnesses' python3
    # stubs pass exactly it and the flip's program to the real interpreter
    # (`DARWIN_PYTHON3_PROGRAMS`, server/test/platformFixtures.ts).
    python3 -c 'import os' >/dev/null 2>&1 \
      || _ccrc_die "python3 is required by 'ccrc install' on macOS — the \$HOME/ccrc flip is one rename(2) through os.replace, and macOS's mv cannot replace a symlink to a directory in one step; no python3 on PATH runs (/usr/bin/python3 is only a stub until the Xcode Command Line Tools are installed). Install them: xcode-select --install. Nothing on this box was written or changed."
```

(j) `_upd_tree_untouched` (**added, review**, D-3457) — immediately after wave 4 Task 4's `_upd_stamp_moved` closing `}` (`grep -n '^_upd_stamp_moved() {' ccd/ccrc`):

```bash
# ── _upd_tree_untouched <pre_layout> <pre_current> — did a staged spine
# that died INSIDE `_inst_tree` replace anything? (W6 Task 2) ─────────────
# `_inst_step` writes the marker as the spine ENTERS a step, so a marker
# naming `_inst_tree` says only that the spine died somewhere in it, and
# wave 4's `_upd_step_moved` reads that as "the tree WAS replaced". Since
# W6, `_inst_tree` replaces the running tree at its LAST act, the flip
# (`_plat_ln_swap`), or not at all: every death before it — the layout
# refusals, the rsync, the void, `npm ci` in the new version — leaves the
# link and the running version as they were
# (D-3457). This asks the one layout reader
# again, against what it said before the staged spine ran (`cmd_update`'s
# `pre_layout`/`pre_current`).
#
# rc 0 ONLY when that is proven, with one clause on stdout naming what was
# measured (the caller's die prints it); rc 1, silent, otherwise — wave 4's
# reading stands:
#   - the staged `ccd/ccrc` declares no BOX_VERSIONS_ROOT: a spine older
#     than W6 writes THROUGH `~/ccrc`, so a link that stayed put proves
#     nothing (the measurement `_upd_legacy_target`'s condition makes, W6
#     Task 4);
#   - `linked|migrated`, and the release's name IS the pointed-at version:
#     the in-place reinstall (D-3426) writes
#     INTO the running version. UPD_VERSION is that name: `_upd_fetch`
#     refuses a staged build.json whose version is not UPD_VERSION, and
#     `_inst_version_name` names the directory from that field;
#   - the layout now reads another word, or points at another version;
#   - `directory`, `absent`, `crashed`: a pre-versioned directory is still
#     rsynced IN PLACE by `_inst_tree`'s `directory` arm.
# `foreign`/`unreadable` count as untouched while they read the same word:
# `_inst_tree` refuses both before it writes a byte
# (D-3429). Reads only; never dies.
_upd_tree_untouched() {   # <pre_layout> <pre_current>
  local pl="$1" pc="$2"
  grep -q '^BOX_VERSIONS_ROOT=' "$UPD_TREE/ccd/ccrc" 2>/dev/null || return 1
  _ver_layout
  case "$pl" in
    linked|migrated)
      [ "$UPD_VERSION" != "$pc" ] || return 1
      case "$VER_LAYOUT" in linked|migrated) ;; *) return 1 ;; esac
      [ "$VER_CURRENT" = "$pc" ] || return 1
      echo "\$HOME/ccrc still points at \$HOME/ccrc-versions/$pc"
      return 0 ;;
    foreign|unreadable)
      [ "$VER_LAYOUT" = "$pl" ] || return 1
      echo "\$HOME/ccrc is still $VER_WHY, which the spine refused to place over"
      return 0 ;;
  esac
  return 1
}
```

(k) `cmd_update`, two places (**added, review**).

1. Directly above wave 4 Task 6's comment line `  # ARM 2'S PROVENANCE PRECONDITION, read NOW (design §11): whether the build` (`grep -n "^  # ARM 2'S PROVENANCE PRECONDITION" ccd/ccrc` prints one line), i.e. before the record, the marker and the caps are cleared and before the staged spine:

```bash
  # W6 Task 2 (D-3457): what `~/ccrc` is
  # BEFORE the staged spine runs, so a spine that dies inside `_inst_tree`
  # can be measured against it afterwards (`_upd_tree_untouched`, in the
  # installed-absent arm below). Above everything this run clears and
  # above W6 Task 4's `_upd_legacy_target`, which acts only on a spine this
  # measurement never vouches for.
  _ver_layout
  local pre_layout="$VER_LAYOUT" pre_current="$VER_CURRENT"
```

2. In the inst_rc branch's installed-absent arm (`grep -n 'place="before _inst_tree: nothing was replaced"' ccd/ccrc` locates its `local` line), between the `      fi` that closes `if [ "$step" = none ]; then … elif _upd_step_moved "$step"; then` / `        moved=1` and the line `      _upd_phase failed "spine died at $step_desc"`:

```bash
      # W6 Task 2 (D-3457): the marker names
      # `_inst_tree` for ANY death inside it, and since W6 that function
      # replaces the running tree only at its last act, the flip. A death
      # before the flip is proven by re-reading the layout, and then it is
      # what spec §11 says a death before the tree is: nothing was replaced,
      # exit 1, no gate and no restore — never a gate on the old build whose
      # arm 2 would re-install the running tag IN PLACE.
      local untouched=""
      if [ "$moved" -eq 1 ] && [ "$step" = _inst_tree ] \
         && untouched="$(_upd_tree_untouched "$pre_layout" "$pre_current")"; then
        moved=0
        place="before its flip: nothing was replaced ($untouched)"
      fi
```

Wave 4 Task 5's `if [ "$moved" -eq 1 ]; then … else … fi` below it is unchanged, so its not-moved `_ccrc_die` prints this `place`, and `update.json`'s detail stays `spine died at _inst_tree` (spec §11's `failed: 'spine died at <step>'`). Check: `grep -c '_upd_tree_untouched "\$pre_layout" "\$pre_current"' ccd/ccrc` prints `1`, and `grep -c '^  local pre_layout="\$VER_LAYOUT" pre_current="\$VER_CURRENT"$' ccd/ccrc` prints `1`.

Then `bash -n ccd/ccrc` (no output).

- [ ] **Step 4: Run green**

Run, one file at a time, foreground (timeout ≥ 600000 ms):
- `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts` — Expected: PASS, every case. Measured 2026-09-23 on a prototype (`d759c914` plus Task 1's helper plus this step, the `_ver_keep_state install` call placed after the record's `echo` because that tree has no `_inst_floor` yet): the whole file green, 137 passed and 19 skipped, the new describe's `itDarwin` case among the skipped on Linux. The unchanged real-directory cases (`:1060`'s self-copy, the preflight refusals) still take the `directory` arm; every `freshBox` install now places an `unstamped-` version (or `untagged-`, where the case `gitInit`s) and flips; a second run from an unstamped checkout places a second `unstamped-` version, which moves nothing any case asserts (the `_inst_atomic` targets keep their bytes and mtimes, the units render `%h/ccrc/…` unchanged).
- `./node_modules/.bin/vitest run test/ccrc-update.test.ts` — Expected: PASS, the case count up by exactly 3 (count before and after). Every other FULL case plants a real `~/ccrc`, so it takes the `directory` arm, unchanged. **Review:** D-3457 moves none of wave 4's spine-death cases. The STUB shim's `ccd/ccrc` declares no `BOX_VERSIONS_ROOT`, so its `_inst_tree` row in the `reads AT OR AFTER` `it.each` stays moved (helper rule 1). Wave 4's FULL `a spine that DIED inside _inst_tree …` case plants a real `~/ccrc`, which this task's `directory` arm still rsyncs in place, so it stays moved too (the helper's `directory` row).
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — Expected: PASS.
- `./node_modules/.bin/vitest run test/macos-platform.test.ts`, then `test/ccrc-install-graphify.test.ts`, `test/ccrc-cli.test.ts`, `test/typecheck-tests.test.ts` — Expected: PASS.

On the macOS leg the new `itDarwin` case runs, and every install flips through the stub's `-c` arm; CI's `test-macos` is the arbiter for that half.

- [ ] **Step 5: Mutation measurement**

Every row edits `ccd/ccrc` in place from a saved copy and restores it from that copy — never `git checkout --`. Set up once, from the repository root:

```bash
M="$(mktemp -d)"
cp ccd/ccrc "$M/ccrc.good"
cat > "$M/mut.py" <<'PY'
import sys, pathlib, re
p = pathlib.Path(sys.argv[1]); s = p.read_text(); m = sys.argv[2]
def rep(old, new):
    global s
    assert s.count(old) == 1, (m, old[:80], s.count(old))
    s = s.replace(old, new)
if m == 'M1':
    rep('    dest="$BOX_VERSIONS_ROOT/$name"\n', '    dest="$BOX_TREE_DIR"\n')
elif m == 'M2':
    rep('    if [ -n "$vroot" ] && [ "$src" = "$vroot/$name" ]; then\n',
        '    if [ "$src" = "$(cd "$BOX_TREE_DIR" 2>/dev/null && pwd -P)" ]; then\n')
elif m == 'M3':
    rep('    if [ -n "$vroot" ] && [ "$src" = "$vroot/$name" ]; then\n',
        '    if { [ -n "$vroot" ] && [ "$src" = "$vroot/$name" ]; } || [ "$name" = "$VER_CURRENT" ]; then\n')
elif m == 'M4':
    i = s.index('  # ── (4) THE DEPS'); j = s.index('  # ── (5) THE FLIP'); k = s.index('\n}\n', j) + 1
    s = s[:i] + s[j:k] + s[i:j] + s[k:]
elif m == 'M5':
    rep('''  if cp -- "$from_stamp" "$s_tmp" 2>/dev/null && chmod 644 "$s_tmp" && _plat_mv_notdir "$s_tmp" "$s_dest" \\
     && cp -- "$from_record" "$r_tmp" 2>/dev/null && chmod 644 "$r_tmp" && _plat_mv_notdir "$r_tmp" "$r_dest"; then''',
        '''  if cp -- "$from_record" "$r_tmp" 2>/dev/null && chmod 644 "$r_tmp" && _plat_mv_notdir "$r_tmp" "$r_dest" \\
     && cp -- "$from_stamp" "$s_tmp" 2>/dev/null && chmod 644 "$s_tmp" && _plat_mv_notdir "$s_tmp" "$s_dest"; then''')
elif m == 'M6a':
    rep('[ "$VER_LAYOUT" != directory ] && [ -f "$dest/$VER_RECORD_COPY" ] \\', '[ "$VER_LAYOUT" != directory ] && false \\')
elif m == 'M6b':
    rep('[ "$VER_LAYOUT" != directory ] && [ -f "$dest/$VER_RECORD_COPY" ] \\', '[ "$VER_LAYOUT" != directory ] \\')
elif m == 'M7':
    rep('''  if [ ! -f "$shipped" ]; then
    shipped="$CCRC_HERE/../$VER_STAMP_COPY"
    from="kept with its version"
  fi
''', '')
elif m == 'M8':
    rep('''    if [ "$val" != "$BOX_VERSIONS_ROOT/$name" ] || [[ ! "$name" =~ $VER_NAME_RE ]] \\
       || [ -L "$val" ] || [ ! -d "$val" ]; then''', '''    if [ ! -e "$val" ]; then''')
elif m == 'M9':
    # build.json before git: move rule 3 block above rule 2
    a = s.index('  if command -v git >/dev/null 2>&1 && sha="$(git -C "$src" rev-parse HEAD 2>/dev/null)"')
    b = s.index('  n=""\n  if [ -f "$src/build.json" ] && _box_build_fields "$src/build.json"; then')
    c = s.index('  n=""\n  _ver_layout\n', b)
    s = s[:a] + s[b:c] + s[a:b] + s[c:]
elif m == 'M10':
    rep("    printf 'unstamped-%s\\n' \"${t:0:12}\"\n", "    printf 'unstamped-%s\\n' 000000000000\n")
elif m == 'M11':
    rep('''    foreign|unreadable)
      _ccrc_die''', '''    foreign-disabled)
      _ccrc_die''')
elif m == 'M12':
    rep('    _plat_ln_swap "$dest" "$BOX_TREE_DIR" \\\n', '    ln -sfn -- "$dest" "$BOX_TREE_DIR" \\\n')
elif m == 'M13':
    rep('  rm -f -- "$s_dest" 2>/dev/null\n', '')
elif m == 'M14':
    rep('''      if [ "$VER_LAYOUT" != directory ]; then
        rm -f -- "$dest/$VER_RECORD_COPY" \\
          || _ccrc_die "could not void the kept install record of $name before placing over it ($dest/$VER_RECORD_COPY) — nothing was copied"
      fi
''', '')
elif m == 'M8b':
    rep('       || [ -L "$val" ] || [ ! -d "$val" ]; then', '       || [ ! -d "$val" ]; then')
elif m == 'M15':
    rep('         && untouched="$(_upd_tree_untouched "$pre_layout" "$pre_current")"; then\n',
        '         && false; then\n')
elif m == 'M16':
    rep("  grep -q '^BOX_VERSIONS_ROOT=' \"$UPD_TREE/ccd/ccrc\" 2>/dev/null || return 1\n", '')
elif m == 'M17':
    rep('      [ "$UPD_VERSION" != "$pc" ] || return 1\n', '')
elif m == 'M18':
    rep('      [ "$VER_CURRENT" = "$pc" ] || return 1\n', '')
p.write_text(s)
PY
mut() {   # <row> <test file> <-t filter>
  python3 "$M/mut.py" ccd/ccrc "$1" && bash -n ccd/ccrc || { echo "row $1 did not apply"; return 1; }
  (cd server && ./node_modules/.bin/vitest run "test/$2" -t "$3")
  cp "$M/ccrc.good" ccd/ccrc && cmp "$M/ccrc.good" ccd/ccrc
}
```

Then run each row; every one must end `FAIL` naming the assertion in the last column, and the `cmp` after it prints nothing:

| Row | Guard (source) | Mutation | `mut` call | Red on (measured on the prototype) |
|---|---|---|---|---|
| M1 | §11 audit "must change — the rsync into the literal live name" | versioned `dest` back to `$BOX_TREE_DIR` | `mut M1 ccrc-install.test.ts 'a new name while'`, then `mut M1 ccrc-update.test.ts 'VERSIONED'` | `the running version was written into`; the update case fails its run |
| M2 | §11 audit "must change — the self-copy guard" | "is the source placed" asks the pre-W6 question (the source vs the pointed-at tree) | `mut M2 ccrc-install.test.ts 'ANOTHER placed version'` | `a placed version was copied onto itself` |
| M3 | the same row, other side | a same-name source is treated as running (no in-place copy) | `mut M3 ccrc-install.test.ts 'size and mtime are unchanged'` | the in-place sentence is absent |
| M4 | the flip is the last act | block (5) moved above block (4) | `mut M4 ccrc-install.test.ts 'npm ci that fails leaves'`, then `mut M4 ccrc-install.test.ts 'a fresh box: the tree lands'` | `~/ccrc was flipped onto a tree with no deps`; `the flip ran before the deps were in place` |
| M5 | D-3428: the record goes last | the two copies swapped | `mut M5 ccrc-install.test.ts 'kept record is written LAST'` | `a version that never kept its stamp is marked complete` |
| M6a | D-3427 | the skip never fires | `mut M6a ccrc-install.test.ts 'a re-run from the version'` | `npm ci emptied the running version's node_modules` |
| M6b | the same, other side | the skip ignores the record | `mut M6b ccrc-install.test.ts 'ANOTHER placed version'` | the incomplete half: no `npm-cwd` (ENOENT) |
| M7 | D-3428 at the stamp | the kept-stamp fallback deleted | `mut M7 ccrc-install.test.ts 'a re-run from the version'` | the `kept with its version` stamp line |
| M8 | `_ver_layout`'s foreign word | any existing target reads `linked` | `mut M8 ccrc-install.test.ts '_ver_layout: seven words'` | the `foreign` pattern (`expected 'linked…' to match …`) |
| M9 | the namer: git before `build.json` | rule 3 moved above rule 2 | `mut M9 ccrc-install.test.ts '_inst_version_name: a placed'` | `expected 'v9.9.9' to be 'untagged-…'` |
| M10 | D-3425: fresh each time | a constant unstamped name | `mut M10 ccrc-install.test.ts '_inst_version_name: a placed'` | `expected 'unstamped-000000000000' not to be …` |
| M11 | D-3429 | the refusal arm renamed away | `mut M11 ccrc-install.test.ts 'refuses to place or flip over'` | `expected +0 to be 1` |
| M12 | §18 "the flip is a rename", at the call site | `_plat_ln_swap "$dest" "$BOX_TREE_DIR"` → `ln -sfn -- "$dest" "$BOX_TREE_DIR"` | `mut M12 ccrc-install.test.ts 'a new name while'` | `expected [] to deeply equal [ … ccrc.new ]` |
| M13 | the kept pair's cleanup | the stamp copy's removal deleted | `mut M13 ccrc-install.test.ts 'kept record is written LAST'` | `half a pair survived` |
| M14 | D-3430 | the void before the rsync deleted | `mut M14 ccrc-install.test.ts 'a re-placement that dies'` | `a version whose re-placement died still says it holds a finished install` |
| M8b | `_ver_layout`'s link-to-a-link clause, alone (**added, review**) | `\|\| [ -L "$val" ]` deleted | `mut M8b ccrc-install.test.ts '_ver_layout: seven words'` | the `v1.2.4` row: `expected 'linked\|v1.2.4\|' to match …` (every other foreign row is caught by another clause, which is why M8 alone cannot pin this one) |
| M15 | D-3457, at the call site (**added, review**) | the re-measurement never answers | `mut M15 ccrc-update.test.ts 'staged npm ci fails'` | `expected 4 to be 1` (gated on the old build, arm 2 refused, arm 3) |
| M16 | the same, the older-spine guard | the `BOX_VERSIONS_ROOT` probe deleted | `mut M16 ccrc-update.test.ts '_upd_tree_untouched'` | the `stage-old` row reads `…still points at…\nrc=0`, not `rc=1` |
| M17 | the same, the in-place guard | `[ "$UPD_VERSION" != "$pc" ]` deleted | `mut M17 ccrc-update.test.ts '_upd_tree_untouched'` | the same-name row reads `…rc=0`, not `rc=1` |
| M18 | the same, the re-read | `[ "$VER_CURRENT" = "$pc" ]` deleted | `mut M18 ccrc-update.test.ts '_upd_tree_untouched'` | the `v0.9.0` row reads `…still points at $HOME/ccrc-versions/v0.9.0\nrc=0`, not `rc=1` |

The Darwin python3 preflight's rows are measurable only on the macOS leg; they are recorded here and checked on that leg's run. Deleting the probe turns both `itDarwin` refusal cases red. **Added (review):** replacing `python3 -c 'import os' >/dev/null 2>&1` with `command -v python3 >/dev/null 2>&1` turns the stub-python3 case red (the stub is found, so the spine starts and `~/.ccrc/accounts.json` is written). The no-python3-on-PATH case stays green under that mutation; it is the control that shows the new case measures the running probe and not mere presence. Finish with `cmp "$M/ccrc.good" ccd/ccrc && rm -rf "$M"`.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc server/test/installTreeFixture.ts server/test/platformFixtures.ts server/test/ccrc-install.test.ts \
  server/test/ccrc-update.test.ts server/test/single-definition.test.ts
git commit -m "feat(ccrc): _inst_tree places each release in ~/ccrc-versions/<name>/ and flips ~/ccrc onto it after the deps; a version keeps its stamp and install record; an update whose spine died before the flip replaced nothing"
```

### Task 3: The one-time migration and its crash recovery

**Files:**
- Modify: `ccd/ccrc` — `BOX_MIGRATION_FILE="$HOME/.ccrc/migrating-to"` after Task 2's constants (`grep -n '^VER_RECORD_COPY=' ccd/ccrc`). New `_inst_migrate`, `_inst_migrate_resume`, **(added, review of Task 5)** `_ver_crashed_remedy`, `_inst_migrate_finish`, `_ver_lock_try`, `_inst_doctor_tail` immediately after `_inst_tree`'s closing `}` (above `# ── _inst_atomic — the local \`install_atomic\``, `:9647` at `d759c914`). `_inst_tree` (**corrected** — Task 2 does NOT leave a placeholder die: it keeps a real `~/ccrc` on a pre-W6 arm of its own, byte for byte, and names Task 3 as the task that replaces "exactly this arm"): the `if [ "$VER_LAYOUT" = directory ]; then` block headed `# ── (2) A PRE-VERSIONED BOX: THE TREE IN PLACE, AS BEFORE W6` (`grep -n '(2) A PRE-VERSIONED BOX' ccd/ccrc`) is retired, its `else` body (Task 2's `(3) THE GUARD, RE-DERIVED AGAINST VERSIONS`) becomes unconditional, the four `directory` tests further down (the void before the rsync, the rsync's `placed at \$HOME/ccrc` line, the npm skip, the flip's condition) go, the `local` line drops ` at`, and a `directory` branch that calls `_inst_migrate` sits directly above the step-5 flip. `cmd_install` gets `_inst_migrate_resume install` between `  INST_DEGRADED=()` (`:9167`) and wave 4's `# The spine, one step at a time` comment above `for inst_fn in "${CCRC_INST_SPINE[@]}"; do`. Its two doctor tails become `_inst_doctor_tail`: the fleet arm's `cmd_doctor` + `return` (`:9239-9240` at `d759c914`; the skeleton's `:9222-9223` was stale) and the final `cmd_doctor` (`:9269`). `cmd_update` changes in **four** places (**corrected** — the skeleton names three):
  - `_inst_migrate_resume update` on the line after wave 4's `  UPD_REPORTING=1`;
  - **added:** `_inst_migrate_resume update` again on the line after the staged spine's `fi` (wave 4 Task 2's `if [ -n "$UPD_LOCK_FD" ]; then ( exec {UPD_LOCK_FD}>&-; … ) || inst_rc=$?; else …; fi`), before the D-3114 comment (D-3433);
  - `_inst_migrate_finish update "the health gate passed"` on the gate-pass path — ONE site, between the `fi` closing wave 4's D-3240 block and wave 4 Task 6's `  if [ "$UPD_FROM" = restore ]; then`, which every gate-passing run reaches (inst_rc 0 and D-3114's marker-present arm alike), inside an `if [ "$no_gate" -eq 1 ]` whose other arm prints the `--no-gate` keep line;
  - one stdout line in the `--check` arm when `_ver_layout` reads `crashed`, immediately above that arm's `    case "$state" in` (`:11366` at `d759c914`).
  **Added (review):** wave 4 Task 3's `_upd_detach` gains `_inst_migrate_resume "$verb"` directly after the `esac` that closes its `case "$prc" in`, before `  UPD_REPORT_TARGET="$tag"` (D-3437). Task 4's `cmd_rollback` kept check gains the same resume, guarded by the lock probe (Task 4's own edit).
- Test: `server/test/ccrc-install.test.ts`:
  - the imports (`:46-47`): `afterEach` and `spawn`, `type ChildProcess` (**corrected:** `lstatSync`, `readlinkSync` (`:49-52`) and `installVersionedTree` (`:60`) are Task 2's — its Step 1(b) adds all three — so this task adds none of them);
  - the case at `:1044-1065` (`it('does not copy the tree onto itself when it IS $HOME/ccrc'`, the verb run FROM `$HOME/ccrc`, `installFixtureTree(home, 'ccrc')`) becomes the migration's first case — its assertions move to the migration sentences;
  - **corrected (two pins the skeleton did not list):** wave 4 Task 4's order pin in `it('cmd_install is the sequence, and the roster precedes the ccd it installs'` (`:1907`) refuses every bare `_inst_*` line in `cmd_install` (`.toEqual([])`), and `_inst_doctor_tail` is one — it now names the two tails exactly; and `it('ends with cmd_doctor, and nothing runs after it'` (`:2014`) reads `cmd_install`'s last line, which becomes `_inst_doctor_tail`;
  - a `ln` crash stub and a real lock holder, planted by the new describe only;
  - new describe `ccrc install: the one-time migration and its crash recovery (W6 Task 3)`, after Task 2's describe.
- Test: `server/test/runbook-holds.test.ts` — **corrected (not in the skeleton):** FACT 1 of `it("Step 2's PASS rc line is the state right after install, not the absent-file default"` (as wave 4 Task 4 rewrote it, `:205-213` at `d759c914`) searches `cmd_install`'s body for a bare `cmd_doctor` line; it now searches for `_inst_doctor_tail`.
- Test: `server/test/ccrc-update.test.ts` — no import line changes (**corrected:** `readlinkSync` in the `node:fs` import and `import { installVersionedTree } from './installTreeFixture.js';` are Task 2's; `lstatSync` is there at `d759c914`; `spawn` is wave 4 Task 2's); the real-directory previous-install fixture (`plantOldBox`, `:342-372`) is the migration fixture as it stands; new describe `ccrc update: the migration keeps the old tree until the gate (W6 Task 3)`, appended at the end of the file.
- Run, not edited: `server/test/ccrc-install-graphify.test.ts` (it runs the whole spine; its `steps()` reads the array, which this task does not touch), `server/test/macos-platform.test.ts` (the `gnuOnly` corpus: nothing added here is GNU-only — `ln -sn`, `mv` through `_plat_mv_notdir`, `rm -rf --`, `flock -n`), `server/test/single-definition.test.ts` (no census line is written: nothing here names `BOX_STAMP_FILE` or `BOX_INSTALLED_FILE`).
- Not chased here: `server/test/session-hook.test.ts` (Task 9)

**Interfaces:**
- `BOX_MIGRATION_FILE` — one line, `<name>\n`, mode 0644, written by `<file>.tmp.$$` + `chmod 644` + **`_plat_mv_notdir`** BEFORE the migration's `mv`; removed only by `_inst_migrate_finish` and by uninstall (D-3432). **Corrected:** `_plat_mv_notdir`, not the skeleton's `mv -f --` — wave 4 Task 4 measured that `mv -f tmp <path>` with a directory standing at `<path>` moves the temp INSIDE it and answers 0 (D-3253's correction), and this file must not be placed by a write that can succeed while the path names something else.
- `_inst_migrate <name>` → rc 0, or dies; called by `_inst_tree` when its layout read `directory`, AFTER Task 2's steps 3–4 have placed `$BOX_VERSIONS_ROOT/<name>` fully (rsync and deps — the spec's "build the versioned tree fully"), in place of step 5's flip (`_plat_ln_swap` refuses a real directory at the link by contract). In order:
  0. **added:** `_ver_layout` again; anything but `directory` → die `\$HOME/ccrc changed while this run placed <name> (it now reads <layout>) — nothing moved; <name> is complete at \$HOME/ccrc-versions/<name>` (a plain install takes no lock, and the placement took the time of an rsync and an `npm ci`);
  1. stdout `install: tree: migrating — \$HOME/ccrc is a directory; <name> is complete at \$HOME/ccrc-versions/<name>`;
  2. write the marker (die `could not record the migration's target in ~/.ccrc/migrating-to — nothing moved; \$HOME/ccrc is still the directory it was`);
  3. `_plat_mv_notdir "$BOX_TREE_DIR" "$BOX_MIGRATING_DIR"` (**corrected** from plain `mv --`: the same one rename(2) onto the absent name `_ver_layout` just measured, but GNU's `mv -fT` refuses to move INTO a non-empty directory that appeared there and the Darwin arm refuses any real directory, where a plain `mv` would nest the tree inside it); die `could not move \$HOME/ccrc aside to \$HOME/ccrc.migrating — nothing moved; the new tree stays complete at \$HOME/ccrc-versions/<name>`;
  4. `{ ln -sn -- "$BOX_VERSIONS_ROOT/<name>" "$BOX_TREE_DIR" && [ -L "$BOX_TREE_DIR" ]; }` (**corrected** from `ln -s --`, D-3434). **Corrected (review) — a failed link moves the tree BACK** (D-3436): on failure, when nothing at all stands at `~/ccrc` (not even a link — `_plat_mv_notdir` replaces a link on both arms, and a link there is another run's resume), `_plat_mv_notdir "$BOX_MIGRATING_DIR" "$BOX_TREE_DIR"`; when that succeeds, `rm -f -- "$BOX_MIGRATION_FILE"` and die `\$HOME/ccrc could not be linked to \$HOME/ccrc-versions/<name>, so it was moved back — nothing moved; \$HOME/ccrc is still the directory it was, and <name> is complete at \$HOME/ccrc-versions/<name>`. Only when the move back ALSO fails (something now stands at `~/ccrc` — the nested-link shape `[ -L ]` catches, a non-empty directory `_plat_mv_notdir` will not replace) does it die the crash-pair sentence `\$HOME/ccrc was moved to \$HOME/ccrc.migrating but the link could not be placed — the next 'ccrc install' completes it from ~/.ccrc/migrating-to; until then run ccrc by its path: bash \$HOME/ccrc-versions/<name>/ccd/ccrc install`;
  5. stdout `install: tree: \$HOME/ccrc -> \$HOME/ccrc-versions/<name> (the pre-versioned tree is kept at \$HOME/ccrc.migrating until a health gate passes)`.
  Steps 3–4 are the spec's two-syscall window, once per node. `~/ccrc.migrating` is never removed here. After the move back, only a process that dies INSIDE the window (a SIGKILL, an OOM kill, a power cut) can leave the crash pair: `_inst_migrate` runs in the staged spine, i.e. in the NEW release's code, so this holds whichever updater — wave 4's included — drove the run.
- `_inst_migrate_resume <prefix>` → rc 0, or dies; silent unless `_ver_layout` reads `crashed`. Then: read the marker's one line (`IFS= read -r`, only when it is a regular readable file); it must match `VER_NAME_RE` and name a real directory (not a symlink) under `$BOX_VERSIONS_ROOT` that carries `ccd/ccrc`.
  - Valid → `{ ln -sn -- "$BOX_VERSIONS_ROOT/<name>" "$BOX_TREE_DIR" && [ -L "$BOX_TREE_DIR" ]; }` (die `a migration of \$HOME/ccrc crashed, and linking \$HOME/ccrc to \$HOME/ccrc-versions/<name> failed — nothing else was changed; link it by hand: ln -s \$HOME/ccrc-versions/<name> \$HOME/ccrc`), then stdout `<prefix>: tree: completed a crashed migration — \$HOME/ccrc was absent beside \$HOME/ccrc.migrating; linked to \$HOME/ccrc-versions/<name> (named by ~/.ccrc/migrating-to)`.
  - Invalid, absent or unreadable → `_ccrc_die "a migration of \$HOME/ccrc crashed and ~/.ccrc/migrating-to <is absent|does not name a placed version> — nothing was changed. To go back: mv \$HOME/ccrc.migrating \$HOME/ccrc — or, to go forward: ln -s \$HOME/ccrc-versions/<name> \$HOME/ccrc"` (`<name>` literal in the remedy). `is absent` exactly when nothing (not even a dangling link) stands at the marker's path.
  It runs BEFORE anything else each caller does to the box: `cmd_install` before its spine loop (so before `_inst_banner`, whose line 1 is `install: box: $HOME`); `cmd_update` after its lock and `UPD_REPORTING=1`, before the tool preflight and `_upd_phase resolving` (a die here is a `failed` report). **Added:** `cmd_update` runs it a second time right after the staged spine returns (D-3433). **Added (review):** `_upd_detach` runs it (prefix `$verb`) once its lock probe has answered 0, before the `queued` write and the hand-off, because the detached run execs `$HOME/.local/bin/ccrc`, the shim, which refuses with no `~/ccrc` (D-3437); and Task 4's `cmd_rollback` runs it (prefix `rollback`) before its kept check, only when `_upd_lock_probe` answers 0. Both run unlocked, as a plain install's does: `ln -sn` + `[ -L ]` is what keeps two concurrent resumes from nesting a link, and the loser dies with nothing changed (D-3434).
- `_inst_migrate_finish <prefix> <gate words>` → rc 0 always; silent unless `_ver_layout` reads `migrated`. Then `rm -rf -- "$BOX_MIGRATING_DIR"`, then `rm -f -- "$BOX_MIGRATION_FILE"`, and stdout `<prefix>: migration: \$HOME/ccrc.migrating removed — <gate words>`. On failure, stdout `<prefix>: migration: WARN: could not remove \$HOME/ccrc.migrating — remove it by hand; nothing else depends on it`. **Added:** on `linked`, a marker that outlived its migration (the directory removed by hand) is removed silently — it is ccrc's own write and names nothing.
- `_ver_lock_try` → takes `~/.ccrc/update.lock` WITHOUT dying, in wave 4's vocabulary.
  - rc 0: this process now holds it, in `UPD_LOCK_FD` (released by wave 4's `_upd_unlock`).
  - rc 1: another holds it; the fd is closed and `UPD_LOCK_FD=""`.
  - rc 2: `flock` is not on PATH.
  - rc 3: unmeasured — `~/.ccrc` could not be made, the file could not be opened, or `flock -n` answered anything but 0 or 1. Never folded into rc 1 or rc 0 (ruling R16's rule).
  It uses the compound open `{ exec {UPD_LOCK_FD}>>"$BOX_UPDATE_LOCK"; } 2>/dev/null` (D-3230's form), and makes `~/.ccrc` when absent. It is a no-op rc 0 when `UPD_LOCK_FD` is already set.
- `_inst_doctor_tail` → the function's rc is `cmd_doctor`'s. It captures that rc FIRST (`local drc=0 …; cmd_doctor || drc=$?`), then reads `_ver_layout`: anything but `linked|migrated` returns `drc` at once (**corrected:** the skeleton takes the lock unconditionally; a box that is not versioned has nothing to finish, and Task 5's GC is silent there too — so no `update.lock` is created on a box this function has no business with). Then it decides whether this install is its own gate (D-3431):
  - `_ver_lock_try` rc 0 → when `drc = 0`, `_inst_migrate_finish install "ccrc doctor passed; a plain install is its own gate"`; otherwise, when layout is `migrated`, stdout `install: migration: \$HOME/ccrc.migrating kept — ccrc doctor did not pass; the next install or update whose gate passes removes it`. Then `_upd_unlock` — **corrected:** only when THIS call took the lock (`UPD_LOCK_FD` was empty before `_ver_lock_try`), so a caller that already held it keeps it. (Task 5 adds its GC call inside this arm.)
  - rc 1 → when layout is `migrated`, stdout `install: migration: \$HOME/ccrc.migrating kept — an update holds ~/.ccrc/update.lock, and its health gate decides`.
  - rc 2|3 → when layout is `migrated`, stdout `install: migration: \$HOME/ccrc.migrating kept — ~/.ccrc/update.lock could not be taken or measured (<no flock|unmeasured>), so no gate is known to have passed`.
  Then `return "$drc"`, the function's last line. Both call sites keep their exit contract: the fleet arm still `return`s right after it, and the final line is `cmd_install`'s last command. **Corrected (the name against wave 4's pin):** `_inst_doctor_tail` is a bare `_inst_*` line in `cmd_install`, which wave 4 Task 4's order pin refuses as "a step outside `CCRC_INST_SPINE`"; it is not a step (it runs after `_inst_installed` removed the marker, where a death leaves the completed-install record — D-3114's reading, not the marker's), so the pin names the two tails exactly instead of being bypassed by an argument.
- `_inst_tree` (**corrected** against Task 2 as written: its `directory` layout is not a die but the pre-W6 in-place arm — `dest=$BOX_TREE_DIR`, the old self-copy skip, `install: tree: placed at $HOME/ccrc`, npm in `$HOME/ccrc`, no flip — and Task 2 names this task as the one that replaces exactly that arm): the `directory` arm is retired, so a `directory` layout is placed exactly as `absent` is — Task 2's guard (3) with `VER_CURRENT` empty, `dest=$BOX_VERSIONS_ROOT/$name`, the record voided before the rsync, `install: tree: placed <name> at $HOME/ccrc-versions/<name>` (or `<name> is already placed …` when the source IS a placed version), the deps (4) in the version — and immediately above the `(5) THE FLIP` comment that heads Task 2's step-5 `if` (the one holding `_plat_ln_swap "$dest" "$BOX_TREE_DIR"`, the last statement of `_inst_tree`) sits `if [ "$VER_LAYOUT" = directory ]; then _inst_migrate "$name"; return 0; fi`. Running FROM a real `~/ccrc/ccd/ccrc` is therefore a copy OUT of the directory into the version, never onto itself, which retires the old self-copy skip; Task 2's `pwd -P` comparisons stay. Task 2's `crashed` arm die (`a migration of $HOME/ccrc is incomplete — this run should have completed it first`) is unchanged: with both resume calls in place it is unreachable, and it is what the §18 mutation below reaches.
- `cmd_update` (wave 4's install path):
  - `_inst_migrate_resume update` on the line after `  UPD_REPORTING=1`, and again on the line after the staged spine's `fi`.
  - On the gate-pass path — the one point after wave 4's gate block and D-3240 block, reached by inst_rc 0 and D-3114's marker-present arm — `_inst_migrate_finish update "the health gate passed"` (Task 5 adds its GC after it, inside the same arm). A failed gate exits 4 inside the gate block (after `_upd_restore`) and never reaches it; a spine that died after the tree exits 1 in the D-3240 block and never reaches it.
  - Not called under `--no-gate`: nothing measured health, so `~/ccrc.migrating` is kept, and a `migrated` layout prints `update: migration: \$HOME/ccrc.migrating kept — --no-gate measured nothing`. That includes arm 2's restore child, which always passes `--no-gate`.
  - `--check` writes nothing. When the layout reads `crashed` it prints, after its machine line (and after wave 4's floor note and `UPD_TARGET_LINE`), `this box's migration crashed (\$HOME/ccrc is absent beside \$HOME/ccrc.migrating) — <_ver_crashed_remedy>`. The state word is unchanged. **(Corrected, review of Task 5: the skeleton's `'ccrc install' completes it` names a command that cannot run.)** In this layout the `ccrc` on PATH is the shim, which execs the missing `$HOME/ccrc/ccd/ccrc` and refuses. Its own refusal also offers `deploy.sh`, whose rsync would place a real `~/ccrc` beside `~/ccrc.migrating`, a layout `_ver_layout` reads `unreadable`.
- `_ver_crashed_remedy` **(added, review of Task 5)** → stdout one clause, rc 0. It reads only, and it is the ONE spelling of a crashed layout's remedy: this `--check` line and Task 5's `ccrc versions` line both print it.
  - It reads `$BOX_MIGRATION_FILE` and checks it exactly as `_inst_migrate_resume` does: a `VER_NAME_RE` name, a real directory that is not a link, and `ccd/ccrc` inside it.
  - Valid → `run bash \$HOME/ccrc-versions/<name>/ccd/ccrc install (or bash install.sh from a ccrc checkout) to complete it — the ccrc on PATH cannot run until then, and deploy.sh would place a second tree beside it`.
  - Absent, unreadable or naming no placed version → `~/.ccrc/migrating-to names no placed version, so no install can complete it — link it by hand (ln -s \$HOME/ccrc-versions/<name> \$HOME/ccrc) or move it back (mv \$HOME/ccrc.migrating \$HOME/ccrc); not deploy.sh, which would place a second tree beside it`. These are `_inst_migrate_resume`'s refusal's two by-hand remedies.
- Consumes `CCRC_INST_SPINE` and `_inst_step` unchanged. The resume runs outside the array, so an `install-step` marker never names it; a death there is D-3252's unmarked case, whose unmoved stamp reads "not known", the true answer. Consumes wave 4's `BOX_UPDATE_LOCK`, `UPD_LOCK_FD`, `_upd_unlock`, `UPD_REPORTING`, `no_gate`, and Task 2's `_ver_layout` / `VER_LAYOUT` / `VER_CURRENT` / `VER_NAME_RE` / `VER_RECORD_COPY` / `BOX_VERSIONS_ROOT` / `BOX_MIGRATING_DIR` / `installVersionedTree`, its `(2)`/`(3)`/`(5)` block headers in `_inst_tree`, and its unchanged sentence `install: tree: already running from \$HOME/ccrc` (case (a)).
- Harness: an `ln` stub that records its argv to `$HOME/ln-argv`, then `exec "$REAL_LN" "$@"` unless its last argument is `$HOME/ccrc` and `$HOME/fixture-ln-crash` exists; in that case it runs `kill -KILL "$PPID"` — the migration's `ln -sn` runs in `ccrc`'s own shell, so `$PPID` is the run itself. The killed run leaves exactly `~/ccrc.migrating/` (the old tree, byte-identical to before), `~/.ccrc/migrating-to` naming the new directory, `~/ccrc-versions/<name>/` complete (its `server/node_modules` in place), and no `~/ccrc`. **Corrected (review):** two more install-side stubs, each armed by its own file and disarming itself on first use — `fixture-ln-fail-once` fails ONE such `ln` with exit 1 (the move back), and `fixture-ln-nest-once` makes a real `~/ccrc` directory and then execs the real `ln`, which nests the link inside it and exits 0 (the `[ -L ]` guard). The update describe gets a PATH directory ahead of the harness's own holding one `ln` with two knobs: `fixture-ln-fail-once` (exit 1, the staged spine moves the tree back) and `fixture-ln-kill-once` (`kill -KILL "$PPID"`: the staged spine's `ln -sn` runs in the staged spine's own shell, so `$PPID` is that child, and the parent's `inst_rc` reads 137 — the crash pair D-3433 completes). A real lock holder for the staged-spine case: wave 4's `bash -c 'exec 9>>"$1" && flock 9 && exec sleep 30'` idiom, killed in `afterEach`. An UNMEASURABLE lock for the rc-3 case: a directory at `~/.ccrc/update.lock` (wave 4 Task 3's idiom: the open fails whatever the uid).
- Mutation rows: spec §18 "the migration keeps the old tree until the gate" — its literal "the `rm` moves above the gate" twice (install: `_inst_doctor_tail`'s doctor run moved below its decision → the doctor-FAIL case removes `.migrating`; update: the finish block moved above the gate block → the gate-FAIL case removes it; both red), and the `rm -rf` moved into `_inst_migrate` (the doctor-FAIL, lock-held, gate-FAIL and `--no-gate` cases lose it; red); "a crashed migration is completed first" (delete the resume call from `cmd_install` → the crash pair makes `_inst_tree`'s `crashed` arm die and nothing is linked; delete the first resume from `cmd_update` → the resume line follows `update: installing`; red); the marker (resume by the newest directory instead → a fixture holding a second, incomplete, newer directory links it; red); the lock's arm (the rc-1 arm folded into rc 0 → the lock-held case removes `.migrating`; red); the lock's UNMEASURED arm, ruling R16 (the `0)` label widened to `0|3)` → the unmeasurable-lock case removes `.migrating`; red); D-3433 (delete the post-spine resume → in the kill-once case arm 3 recreates a REAL `~/ccrc`; red); D-3434 (`ln -sn` → `ln -s` → the crash case's recorded argv; red; and `&& [ -L "$BOX_TREE_DIR" ]` deleted from `_inst_migrate` → the nest-once case reports a link it never placed; red); step 0's re-measure (deleted → the sourced changed-layout case moves a LINK aside and succeeds; red); D-3436 (the move back deleted → the install fail-once case reads `crashed`, and the update fail-once case ends on a link; red — with its CONTROL: the post-spine resume deleted, the update fail-once case stays GREEN, because it never leaned on the W6 parent a wave-4 parent is not); D-3437 (the resume in `_upd_detach` deleted → the `--detach` crash-pair case hands a run to a shim that cannot start; red); the tail's rc (`return "$drc"` → `return 0` → `a box doctor fails on exits 1` and the tail pin; red).

**Departures this task found** (add each to the plan's *Deviations found* list, in this form):
- **D-3433** — (Task 3) `cmd_update` runs `_inst_migrate_resume update` a second time, on the line after the staged spine returns. Spec §11 says the NEXT `ccrc install`/`update` completes a crashed migration; it says nothing of a staged W6 spine that dies inside the window during THIS update — since D-3436, only by being killed between the `mv` and the link (a failed `ln` moves the tree back inside the spine itself). This guard is PARENT code, so it runs only under a W6 updater; on a box's first move onto W6 the parent is wave 4's and has none of it (D-3438). Left alone, the parent's gate probes a unit whose tree is gone, arm 2's child `bash "$BOX_TREE_DIR/ccd/ccrc" update …` cannot even start, and arm 3's `_upd_restore_copy` runs `mkdir -p -- "${live%/*}"` — which creates a REAL `~/ccrc/server/` beside `~/ccrc.migrating`, a layout `_ver_layout` then reads `unreadable` and every later install refuses. Completing the link from the marker first puts the gate, the restore arms and the report in front of a linked tree. Cost if wrong: one layout read per update.
- **D-3434** — (Task 3) the migration's link and the resume's are placed with `ln -sn`, followed by `[ -L "$BOX_TREE_DIR" ]`, not the spec's `ln -s`. Measured 2026-09-23 (GNU coreutils 9.4): `ln -s <t> <name>` where `<name>` is already a symlink to a directory creates a link INSIDE that directory and exits 0; `ln -sn` refuses with `File exists`, exit 1 (BSD `ln` takes `-n`, "same as -h"). A real directory at `<name>` still receives a nested link under either flag, and the `[ -L ]` after it is what refuses that shape. Two concurrent plain installs resuming one crash (neither takes the lock) are the case: without `-n` the second run would report success and leave `~/ccrc-versions/<name>/<name>`. Cost if wrong: none — one flag and one test.
- **D-3435** — (Task 3) D-3431 holds only for an updater that takes `~/.ccrc/update.lock`, i.e. one from wave 4 on. A box moved straight from an older release to this wave's (v0.0.11 → W6, skipping wave 4) runs the W6 staged spine under an updater that holds no lock, so the spine's `_inst_doctor_tail` finds the lock free, takes its own doctor as the gate, and removes `~/ccrc.migrating` when that doctor passes — before any health gate, because that updater has none. Nothing on the node distinguishes that spine from a plain install: the stage is a `mktemp -d` path, and the one env marker older updaters pass (`CCRC_UPDATE_VERIFIED`) is set only on verified runs and unset otherwise. So the skeleton's sentence "on that move the directory survives the run" is true for a wave-4-or-later updater only. Cost if wrong: on a box that skips wave 4, the pre-versioned tree goes on the doctor's word, which is all any pre-wave-4 update ever trusted.
- **D-3436** — (Task 3, found in review) when the migration's link cannot be placed (`ln -sn` fails, or `[ -L ]` refuses what it made), `_inst_migrate` moves `~/ccrc.migrating` back to `~/ccrc` through `_plat_mv_notdir`, removes `~/.ccrc/migrating-to`, and dies "nothing moved". Spec §11 has a crashed migration completed by the next run; it does not say a failure the running spine can SEE must be left as a crash. Leaving it would put the box's recovery in the hands of the updater's parent, and on the one move that migrates, that parent is wave 4's, which has no resume: its gate fails on a tree that is gone, arm 2 refuses (`~/ccrc/ccd/ccrc is absent`), and arm 3's `_upd_restore_copy` `mkdir -p`s a REAL `~/ccrc/server/` beside `~/ccrc.migrating` — `unreadable`, refused by every later install. Moved back, the box is exactly the pre-W6 directory every wave-4 restore arm was written for (wave 4's FULL `a spine that DIED inside _inst_tree` case is that shape). `_inst_migrate` runs in the staged spine, i.e. in W6's own code, so this holds whoever drove the run. Only when the move back also fails is the crash-pair sentence kept. Cost if wrong: none on the success path; on a failed link, the next install re-runs the migration from the start (its version is already placed, so no second download).
- **D-3437** — (Task 3, found in review) `_upd_detach` completes a crashed migration (`_inst_migrate_resume "$verb"`) after its lock probe answers 0 and before its `queued` write. Spec §10's re-exec hands the run to `$HOME/.local/bin/ccrc`, the shim, which execs `$HOME/ccrc/ccd/ccrc` and refuses when `~/ccrc` is absent. Without this, `bash <placed>/ccd/ccrc update --detach --to <v>` (the only way to reach the verb on a crashed box) would print `detached`, exit 0, and leave a `queued` report that no run ever advances. It runs unlocked, as a plain install's resume does (the parent must hold no lock at the spawn, wave 4 Task 3); a probe that answered 0 means no update owns the link, and a concurrent resume that wins the race leaves the loser's `ln -sn` refused with nothing changed. `cmd_rollback`'s kept check gets the same resume (Task 4). Cost if wrong: one layout read per `--detach`.
- **D-3438** — (Task 3, found in review) every box's first move onto W6 — the one move that migrates a real `~/ccrc` — is driven by its wave-4 `ccrc update`. Only the staged spine is W6's; the parent (its gate, `_upd_restore` arms 2 and 3, its report) is wave 4's code, so two W6-parent protections do not exist on that move: the post-spine resume (D-3433) and arm 3's void of the kept record (D-3441, Task 4). Two holes remain there, named and not closed:
  1. The staged spine KILLED inside the two-syscall window (a failed `ln` no longer reaches this, D-3436): wave 4's arm 3 creates a real `~/ccrc/server/` beside `~/ccrc.migrating`, which `_ver_layout` reads `unreadable`. By hand, back to the pre-W6 box: `mv ~/ccrc ~/ccrc.restore-debris && mv ~/ccrc.migrating ~/ccrc && rm ~/.ccrc/migrating-to`, then the update again. It is not repaired automatically: a real `~/ccrc` beside `~/ccrc.migrating` is also what an operator's half-done repair or a hand-made tree looks like, nothing on the node records which one it is, and moving a real `~/ccrc` aside on that inference is the destructive guess `unreadable` exists to refuse (D-3429).
  2. A migration that SUCCEEDED, then a failed gate AND a failed arm 2: wave 4's arm 3 copies the pre-update dists through the link into `~/ccrc-versions/<W6_TAG>`, whose `.ccrc-installed` (the staged spine's `_ver_keep_state install`) still claims a complete install of what is now a MIXED tree; a later W6 flip to that tag would trust it. By hand: `rm ~/ccrc-versions/<W6_TAG>/.ccrc-installed` (the next completed install from that tag re-marks it, D-3430). It is not closed by having `_ver_keep_state install` skip the record under another process's lock: that would leave EVERY box's first W6 version unmarked on the success path too, blinding arm 1 and the no-npm skip for the very version the next rollback returns to, to close a hole that needs two failures in one run.
  Task 8's live half checks each box for both shapes after the first rollout. Cost if wrong: a box that meets either shape on its first move needs the by-hand remedy named here.

- [ ] **Step 1: The install-side harness and failing tests**

In `server/test/ccrc-install.test.ts`:

(a) The imports. The `vitest` line (`:46`) becomes `import { describe, it, expect, afterEach } from 'vitest';` and the `node:child_process` line (`:47`) becomes `import { spawn, spawnSync, type ChildProcess } from 'node:child_process';`. Nothing else: `lstatSync`, `readlinkSync` and `installVersionedTree` are already imported (Task 2 Step 1(b)); confirm with `grep -c 'utimesSync, lstatSync, readlinkSync,$' server/test/ccrc-install.test.ts` and `grep -c 'installFixtureTree, installVersionedTree }' server/test/ccrc-install.test.ts`, each `1`, and never add a second copy.

(b) Replace the whole case `it('does not copy the tree onto itself when it IS $HOME/ccrc', () => { … });` (`:1044-1063`) with:

```ts
  it('run FROM a real $HOME/ccrc, it MIGRATES rather than copying onto itself: the tree is placed as a version, $HOME/ccrc becomes the link, and the old directory goes only once the doctor gate has passed (W6 Task 3)', () => {
    // The box a deploy already touched, and the box a second pre-W6 `ccrc
    // install` ran on: `ccrc` is at `~/ccrc/ccd/ccrc`, a real directory. It
    // is no longer the destination — the tree goes to ~/ccrc-versions/<name>,
    // so there is nothing to copy onto itself — and the directory is moved
    // aside, not deleted, until this install's own gate (its doctor, with
    // the update lock free) has passed.
    const home = mkTmp('ccrc-install-selfcopy-');
    const root = installFixtureTree(home, 'ccrc');
    // The only fixture in this describe that does not come from `freshBox`
    // (its tree has to BE `~/ccrc`), so it asks for the doctor half by hand.
    healthyDoctorBox(home);
    const r = runInstall(home, ['install'], {}, { from: ccrcIn(root) });
    expect(r.code, r.stderr).toBe(0);
    // No git, no build.json and no box stamp: the source names itself
    // `unstamped-<12 hex>` (D-3425), read back off the link.
    const target = readlinkSync(placed(home));
    const name = path.basename(target);
    expect(name).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(target).toBe(join(home, 'ccrc-versions', name));
    // ONE rsync, from the directory INTO the version — never onto itself.
    const argv = read(join(home, 'rsync-argv')).trim().split('\n');
    expect(argv).toHaveLength(1);
    expect(argv[0]!.endsWith(` ${join(home, 'ccrc-versions', name)}/`), argv[0]).toBe(true);
    expect(existsSync(join(home, 'ccrc-versions', name, 'ccrc')), 'the tree was copied inside itself').toBe(false);
    const lines = r.stdout.split('\n');
    expect(lines).toContain(`install: tree: migrating — $HOME/ccrc is a directory; ${name} is complete at $HOME/ccrc-versions/${name}`);
    expect(lines).toContain(`install: tree: $HOME/ccrc -> $HOME/ccrc-versions/${name} (the pre-versioned tree is kept at $HOME/ccrc.migrating until a health gate passes)`);
    // The old tree went AFTER the doctor had measured the box — the removal
    // line follows doctor's summary — and the marker went with it.
    const summary = r.stdout.lastIndexOf('\nsummary: ');
    const removed = r.stdout.indexOf('install: migration: $HOME/ccrc.migrating removed — ccrc doctor passed; a plain install is its own gate');
    expect(summary, 'doctor printed no summary').toBeGreaterThan(-1);
    expect(removed, r.stdout).toBeGreaterThan(summary);
    expect(existsSync(join(home, 'ccrc.migrating'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'migrating-to'))).toBe(false);
    // …and the deps were installed in the VERSION, whose tree now runs.
    expect(read(join(home, 'npm-cwd')).trim()).toBe(join(home, 'ccrc-versions', name, 'server'));
  });
```

(c) In `it('cmd_install is the sequence, and the roster precedes the ccd it installs'`, replace wave 4 Task 4's assertion

```ts
    expect(body![1]!.split('\n').map((l) => l.trim()).filter((l) => /^_inst_[a-z_]+$/.test(l)),
      'cmd_install calls a step outside CCRC_INST_SPINE').toEqual([]);
```

with

```ts
    // W6 Task 3: the two doctor tails — the fleet arm's and the verb's last
    // line — are the ONLY bare `_inst_*` calls left. `_inst_doctor_tail` is
    // not a step: it runs after `_inst_installed` removed the marker, where
    // a death leaves the completed-install record (D-3114's reading), so no
    // marker has anything to name. Named exactly, so a real step called bare
    // still reds this line.
    expect(body![1]!.split('\n').map((l) => l.trim()).filter((l) => /^_inst_[a-z_]+$/.test(l)),
      'cmd_install calls a step outside CCRC_INST_SPINE').toEqual(['_inst_doctor_tail', '_inst_doctor_tail']);
```

(d) Replace the whole case `it('ends with cmd_doctor, and nothing runs after it', () => { … });` (`:2014-2025`) with:

```ts
  it('ends with _inst_doctor_tail, whose exit code is cmd_doctor\'s, and nothing runs after it (W6 Task 3)', () => {
    // THE VERB'S EXIT CODE IS DOCTOR'S, and that is only true while the tail
    // is the LAST command in the function AND the tail hands doctor's rc back
    // untouched: a line added after either — a summary, a tidy-up, one more
    // echo — silently replaces the verdict with that line's own status, and
    // every "a broken box exits 1" assertion in this file would go green
    // against an install that reported success on a failing box. The tail
    // runs doctor FIRST and captures its rc, because what it does next (the
    // migration's gate) must never become the verdict.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const body = /cmd_install\(\) \{([\s\S]*?)\n\}/.exec(src);
    const lines = body![1]!.split('\n').map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(lines[lines.length - 1]).toBe('_inst_doctor_tail');
    const tail = /^_inst_doctor_tail\(\) \{\n([\s\S]*?)\n\}/m.exec(src);
    expect(tail, 'ccd/ccrc has no _inst_doctor_tail').not.toBeNull();
    const t = tail![1]!.split('\n').map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(t[1], 'the tail does something before it runs doctor').toBe('cmd_doctor || drc=$?');
    expect(t[t.length - 1]).toBe('return "$drc"');
  });
```

(e) Immediately after Task 2's `describe('ccrc install: the versioned tree (W6 Task 2)', …)` block's closing `});`, add:

```ts
describe('ccrc install: the one-time migration and its crash recovery (W6 Task 3)', () => {
  // A box installed before versioned installs has a REAL directory at
  // `~/ccrc`. The first W6 install places the incoming tree FULLY at
  // `~/ccrc-versions/<name>`, moves the directory aside to `~/ccrc.migrating`
  // and links `~/ccrc` in its place — two syscalls, once per node (spec §11).
  // The old tree goes only after a gate has passed: a plain install's own
  // doctor while `~/.ccrc/update.lock` is FREE, an updater's `_upd_gate`
  // otherwise (D-3431). A crash inside the window is
  // completed FIRST by the next run, from `~/.ccrc/migrating-to` alone.
  const holders: ChildProcess[] = [];
  afterEach(() => {
    for (const h of holders.splice(0)) h.kill('SIGKILL');
  });
  const REAL_LN = realPath('ln');
  const lockPath = (home: string): string => dotCcrc(home, 'update.lock');
  /** A FRESH open and a non-blocking flock — wave 4's probe, from outside. */
  const lockFree = (home: string): boolean =>
    spawnSync(BASH, ['-c', 'exec 9>>"$1" && flock -n 9', '_', lockPath(home)]).status === 0;
  const waitUntil = (cond: () => boolean, what: string): void => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > 10_000) throw new Error(`timed out waiting for ${what}`);
      spawnSync('sleep', ['0.05']);
    }
  };
  /** Wave 4's real holder: ONE process takes the flock and then becomes
   *  `sleep` (exec keeps the pid and the descriptor), so the pid killed is
   *  the pid holding it. Returns once a fresh probe fails. */
  const holdLock = (home: string): ChildProcess => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const h = spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', lockPath(home)], { stdio: 'ignore' });
    holders.push(h);
    waitUntil(() => !lockFree(home), 'the fixture holder to take the lock');
    return h;
  };
  /** lstat, never stat: an absent or dangling `~/ccrc` must read `absent`,
   *  and a link must read as the link it is, not as its target. */
  const lkind = (p: string): 'absent' | 'link' | 'dir' | 'other' => {
    try {
      const st = lstatSync(p);
      return st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'other';
    } catch { return 'absent'; }
  };
  /** Every entry under `dir`, relative path → its bytes — "byte-identical"
   *  as a value two listings can be compared by. */
  const treeBytes = (dir: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (d: string, prefix: string): void => {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e);
        const rel = prefix === '' ? e : `${prefix}/${e}`;
        const st = lstatSync(p);
        if (st.isSymbolicLink()) out[rel] = `link:${readlinkSync(p)}`;
        else if (st.isDirectory()) { out[`${rel}/`] = 'dir'; walk(p, rel); }
        else out[rel] = readFileSync(p).toString('base64');
      }
    };
    walk(dir, '');
    return out;
  };
  /** Makes this box's doctor FAIL on a check no install step touches — the
   *  per-platform lever `a box doctor fails on exits 1` uses. */
  const failDoctor = (home: string): void => {
    if (process.platform === 'darwin') {
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'exposure.env'),
        'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=on\n', { mode: 0o644 });
    } else {
      writeFileSync(join(home, 'fixture-linger-refuse'), 'yes\n');
    }
  };
  const healDoctor = (home: string): void => {
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    rmSync(join(home, 'fixture-linger-refuse'), { force: true });
  };
  const migrating = (home: string): string => join(home, 'ccrc.migrating');
  /** A box with a PRE-W6 install: a real `~/ccrc` directory (with a marker
   *  file of its own), and a checkout that is a real one-commit repository,
   *  so the incoming tree's name is `untagged-<sha12>` — known in advance. */
  const preW6Box = (prefix: string): { home: string; name: string; before: Record<string, string> } => {
    const home = freshBox(prefix);
    const sha = gitInit(treeRoot(home));
    installFixtureTree(home, 'ccrc');
    writeFileSync(placed(home, 'OLD-MARKER'), 'the pre-versioned tree\n');
    return { home, name: `untagged-${sha.slice(0, 12)}`, before: treeBytes(placed(home)) };
  };
  const RESUMED = (name: string): string =>
    `install: tree: completed a crashed migration — $HOME/ccrc was absent beside $HOME/ccrc.migrating; linked to $HOME/ccrc-versions/${name} (named by ~/.ccrc/migrating-to)`;
  const REMOVED = 'install: migration: $HOME/ccrc.migrating removed — ccrc doctor passed; a plain install is its own gate';
  /** An `ln` that does `act` ONCE — to the first `ln` whose last argument is
   *  `~/ccrc`, the migration's link, while `$HOME/<knob>` exists, removing
   *  the knob first — and is the real `ln` for everything else. */
  const lnOnce = (knob: string, act: string): string => '#!/bin/sh\n'
    + 'for last in "$@"; do :; done\n'
    + `if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/${knob}" ]; then rm -f "$HOME/${knob}"; ${act}; fi\n`
    + `exec ${REAL_LN} "$@"\n`;

  it('a doctor that FAILS keeps ~/ccrc.migrating byte for byte, beside its marker — and the next install whose doctor passes removes both (§18 "the migration keeps the old tree until the gate")', () => {
    const { home, name, before } = preW6Box('ccrc-install-migrate-doctor-fail-');
    failDoctor(home);
    let r = runInstall(home);
    expect(r.code, 'the lever did not make doctor fail — the keep below would be vacuous').toBe(1);
    expect(readlinkSync(placed(home))).toBe(join(home, 'ccrc-versions', name));
    expect(treeBytes(migrating(home))).toEqual(before);
    expect(read(dotCcrc(home, 'migrating-to'))).toBe(`${name}\n`);
    expect(r.stdout).toMatch(/^install: migration: \$HOME\/ccrc\.migrating kept — ccrc doctor did not pass; the next install or update whose gate passes removes it$/m);
    expect(r.stdout.split('\n')).not.toContain(REMOVED);
    // THE CONTROL: the same box with its doctor healed — the directory goes.
    healDoctor(home);
    r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('absent');
    expect(existsSync(dotCcrc(home, 'migrating-to'))).toBe(false);
    expect(readlinkSync(placed(home))).toBe(join(home, 'ccrc-versions', name));
  });

  it('a spine run while ~/.ccrc/update.lock is held is a STAGED spine: its doctor passing is not the gate, so ~/ccrc.migrating stays for the updater\'s gate to decide (D-3431)', () => {
    const { home } = preW6Box('ccrc-install-migrate-lock-held-');
    const h = holdLock(home);
    let r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: migration: \$HOME\/ccrc\.migrating kept — an update holds ~\/\.ccrc\/update\.lock, and its health gate decides$/m);
    expect(lkind(migrating(home))).toBe('dir');
    expect(lockFree(home), 'the install took, or broke, a lock it did not hold').toBe(false);
    // THE CONTROL: the holder gone, the identical install is its own gate.
    h.kill('SIGKILL');
    waitUntil(() => lockFree(home), 'the fixture holder to release the lock');
    r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('absent');
    expect(lockFree(home), 'the install left ~/.ccrc/update.lock held').toBe(true);
  });

  it('a crash inside the two-syscall window leaves exactly ~/ccrc.migrating and ~/.ccrc/migrating-to; the next install, run by the placed version\'s own path, links it BEFORE its banner (§18 "a crashed migration is completed first")', () => {
    const { home, name, before } = preW6Box('ccrc-install-migrate-crash-');
    const vdir = join(home, 'ccrc-versions', name);
    writeFileSync(join(home, 'fixture-ln-crash'), 'yes\n');
    // The migration's `ln -sn` runs in ccrc's OWN shell, so $PPID is the run.
    const lnStub = '#!/bin/sh\n'
      + 'printf \'%s\\n\' "$*" >> "$HOME/ln-argv"\n'
      + 'for last in "$@"; do :; done\n'
      + 'if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/fixture-ln-crash" ]; then kill -KILL "$PPID"; exit 1; fi\n'
      + `exec ${REAL_LN} "$@"\n`;
    let r = runInstall(home, ['install'], {}, { stubs: { ln: lnStub } });
    expect(r.code, 'the run was not killed inside the window (-1 is the runner\'s null status)').toBe(-1);
    expect(r.stdout.split('\n')).toContain(`install: tree: migrating — $HOME/ccrc is a directory; ${name} is complete at $HOME/ccrc-versions/${name}`);
    // The link is placed with -n (D-3434).
    const lnCalls = read(join(home, 'ln-argv')).trim().split('\n');
    expect(lnCalls[lnCalls.length - 1]).toBe(`-sn -- ${vdir} ${placed(home)}`);
    // Exactly the crash pair: the old tree aside, the marker, the new version
    // FULLY placed before the window opened — and no ~/ccrc at all.
    expect(lkind(placed(home))).toBe('absent');
    expect(treeBytes(migrating(home))).toEqual(before);
    expect(read(dotCcrc(home, 'migrating-to'))).toBe(`${name}\n`);
    expect(existsSync(join(vdir, 'ccd', 'ccrc'))).toBe(true);
    expect(existsSync(join(vdir, 'server', 'node_modules')), 'the version was not placed FULLY before the window').toBe(true);
    // THE COMPLETION: disarmed, and run by the path the die sentence names
    // (the launcher shim cannot run with no ~/ccrc).
    rmSync(join(home, 'fixture-ln-crash'));
    r = runInstall(home, ['install'], {}, { from: join(vdir, 'ccd', 'ccrc') });
    expect(r.code, r.stderr).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines[0], 'the link was not completed FIRST').toBe(RESUMED(name));
    expect(lines[1]).toBe(`install: box: ${home}`);
    expect(readlinkSync(placed(home))).toBe(vdir);
    // A placed version installing from itself copies nothing (Task 2's (a)).
    expect(lines).toContain('install: tree: already running from $HOME/ccrc');
    expect(lines).toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('absent');
  });

  it('the resume links what ~/.ccrc/migrating-to names — never a guess such as the newest directory (D-3432)', () => {
    const home = freshBox('ccrc-install-migrate-marker-');
    installFixtureTree(home, 'ccrc.migrating');
    const kept = installVersionedTree(home, 'v1.0.0', { link: false });
    // NEWER and incomplete: the directory a crashed run could have been
    // half-way through placing when it died.
    const newer = installVersionedTree(home, 'v9.9.9', { link: false, complete: false });
    utimesSync(kept, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    utimesSync(newer, new Date(), new Date());
    preexisting(home, 'migrating-to', 'v1.0.0\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')[0]).toBe(RESUMED('v1.0.0'));
    expect(lkind(placed(home))).toBe('link');
  });

  const refusals: Array<[string, string | null, string]> = [
    ['is absent', null, 'is absent'],
    ['names a version nobody placed', 'v7.7.7\n', 'does not name a placed version'],
    ['is not a version name at all', '../../etc\n', 'does not name a placed version'],
  ];
  it.each(refusals)('a crash pair whose ~/.ccrc/migrating-to %s is REFUSED before the banner, with both by-hand remedies, and nothing is changed', (_label, marker, says) => {
    const home = freshBox('ccrc-install-migrate-refused-');
    installFixtureTree(home, 'ccrc.migrating');
    installVersionedTree(home, 'v1.0.0', { link: false });
    if (marker !== null) preexisting(home, 'migrating-to', marker);
    const before = treeBytes(migrating(home));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`ccrc: a migration of $HOME/ccrc crashed and ~/.ccrc/migrating-to ${says} — nothing was changed. To go back: mv $HOME/ccrc.migrating $HOME/ccrc — or, to go forward: ln -s $HOME/ccrc-versions/<name> $HOME/ccrc`);
    expect(r.stdout, 'a step ran past the refusal').not.toMatch(/^install: /m);
    expect(lkind(placed(home))).toBe('absent');
    expect(treeBytes(migrating(home))).toEqual(before);
  });

  it('a lock that cannot be MEASURED is neither free nor held: ~/ccrc.migrating is kept with its own sentence even though the doctor passed (ruling R16)', () => {
    const { home, name } = preW6Box('ccrc-install-migrate-lock-unmeasured-');
    // A DIRECTORY at the lock path: the open fails whatever the uid (wave 4
    // Task 3's idiom), so `_ver_lock_try` answers 3.
    mkdirSync(lockPath(home), { recursive: true });
    const r = runInstall(home);
    // Measured red first (Step 4): if the directory also moved the doctor's
    // verdict, the keep below would be the doctor's, not the lock arm's.
    expect(r.code, `the doctor must pass here — ${r.stderr}`).toBe(0);
    expect(readlinkSync(placed(home))).toBe(join(home, 'ccrc-versions', name));
    expect(r.stdout).toMatch(/^install: migration: \$HOME\/ccrc\.migrating kept — ~\/\.ccrc\/update\.lock could not be taken or measured \(unmeasured\), so no gate is known to have passed$/m);
    expect(r.stdout.split('\n')).not.toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('dir');
  });

  it('a link that cannot be placed moves ~/ccrc BACK: the pre-versioned directory byte for byte, no marker, the version complete — never a crash pair left for an updater to complete (D-3436)', () => {
    const { home, name, before } = preW6Box('ccrc-install-migrate-ln-fail-');
    const vdir = join(home, 'ccrc-versions', name);
    const stub = lnOnce('fixture-ln-fail-once', 'echo "ln: fixture refusal" >&2; exit 1');
    writeFileSync(join(home, 'fixture-ln-fail-once'), 'yes\n');
    let r = runInstall(home, ['install'], {}, { stubs: { ln: stub } });
    expect(existsSync(join(home, 'fixture-ln-fail-once')), 'the refusal never fired').toBe(false);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`ccrc: $HOME/ccrc could not be linked to $HOME/ccrc-versions/${name}, so it was moved back — nothing moved; $HOME/ccrc is still the directory it was, and ${name} is complete at $HOME/ccrc-versions/${name}`);
    expect(lkind(placed(home))).toBe('dir');
    expect(treeBytes(placed(home))).toEqual(before);
    expect(lkind(migrating(home))).toBe('absent');
    expect(lkind(dotCcrc(home, 'migrating-to'))).toBe('absent');
    expect(existsSync(join(vdir, 'ccd', 'ccrc'))).toBe(true);
    // THE CONTROL: the knob is spent, so the identical install migrates.
    r = runInstall(home, ['install'], {}, { stubs: { ln: stub } });
    expect(r.code, r.stderr).toBe(0);
    expect(readlinkSync(placed(home))).toBe(vdir);
    expect(r.stdout.split('\n')).toContain(REMOVED);
  });

  it('a link nested INSIDE a real directory that appeared at ~/ccrc is refused by the [ -L ] check, never reported as placed (D-3434)', () => {
    const { home, name } = preW6Box('ccrc-install-migrate-ln-nest-');
    writeFileSync(join(home, 'fixture-ln-nest-once'), 'yes\n');
    const r = runInstall(home, ['install'], {}, { stubs: { ln: lnOnce('fixture-ln-nest-once', 'mkdir -p "$HOME/ccrc"') } });
    expect(existsSync(join(home, 'fixture-ln-nest-once')), 'the stub never fired').toBe(false);
    // The real `ln -sn` nested the link and exited 0 — the shape `-n` cannot
    // refuse. Without it the case would be vacuous.
    expect(lkind(join(placed(home), name)), 'the real ln did not nest').toBe('link');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccrc: $HOME/ccrc was moved to $HOME/ccrc.migrating but the link could not be placed');
    expect(r.stdout.split('\n')).not.toContain(`install: tree: $HOME/ccrc -> $HOME/ccrc-versions/${name} (the pre-versioned tree is kept at $HOME/ccrc.migrating until a health gate passes)`);
    // The move back cannot replace the non-empty directory now standing at
    // ~/ccrc, so the old tree stays aside, whole.
    expect(lkind(migrating(home))).toBe('dir');
  });

  it('_inst_migrate re-measures the layout before it moves anything: a ~/ccrc that stopped being a directory while the version was placed is refused, and nothing moves (its step 0)', () => {
    const home = freshBox('ccrc-install-migrate-changed-');
    const v1 = installVersionedTree(home, 'v1.0.0');   // ~/ccrc is a LINK now
    installVersionedTree(home, 'v2.0.0', { link: false });
    const r = spawnSync(BASH, ['-c', '. "$1"; _inst_migrate v2.0.0', '_', ccrcIn(treeRoot(home))],
      { env: ccrcEnv(home), encoding: 'utf8' });
    expect(r.status, r.stdout).toBe(1);
    expect(r.stderr).toContain('ccrc: $HOME/ccrc changed while this run placed v2.0.0 (it now reads linked) — nothing moved; v2.0.0 is complete at $HOME/ccrc-versions/v2.0.0');
    expect(readlinkSync(placed(home))).toBe(v1);
    expect(lkind(migrating(home))).toBe('absent');
    expect(lkind(dotCcrc(home, 'migrating-to'))).toBe('absent');
  });
});
```

- [ ] **Step 2: The runbook pin reads the tail**

In `server/test/runbook-holds.test.ts`, in FACT 1 as wave 4 Task 4 left it, replace

```ts
    const doctorIdx = body.search(/^\s*cmd_doctor\s*$/m);
```

with

```ts
    // W6 Task 3: doctor runs inside `_inst_doctor_tail`, which runs it FIRST
    // and returns its rc (ccrc-install.test.ts pins both), so the tail's line
    // is where the spine hands over to doctor.
    const doctorIdx = body.search(/^\s*_inst_doctor_tail\s*$/m);
```

(the `loopIdx < doctorIdx` assertion below it is unchanged: the loop still precedes the tail).

- [ ] **Step 3: The update-side failing tests**

In `server/test/ccrc-update.test.ts`, the imports need no edit: `readlinkSync` (in `node:fs`) and `import { installVersionedTree } from './installTreeFixture.js';` are Task 2's, `lstatSync` is there at `d759c914`. Confirm with `grep -c "^import { installVersionedTree } from './installTreeFixture.js';$" server/test/ccrc-update.test.ts` → `1`. Then append at the end of the file:

```ts
describe('ccrc update: the migration keeps the old tree until the gate (W6 Task 3)', () => {
  // On a pre-W6 box the W6 staged spine migrates `~/ccrc` (Task 3's install
  // half), but it runs under THIS run's `~/.ccrc/update.lock`, so its doctor
  // is not the gate and it keeps `~/ccrc.migrating`; `cmd_update` removes it
  // only once `_upd_gate` has passed. A crash pair left by an earlier run is
  // completed before anything else this verb does.
  const OLD_SHA = 'oldsha0000000000000000000000000000000000';
  const NEW_SHA = 'newsha0000000000000000000000000000000000';
  const REAL_LN = realPath('ln');
  const migrating = (home: string): string => join(home, 'ccrc.migrating');
  const resumed = (name: string): string =>
    `update: tree: completed a crashed migration — $HOME/ccrc was absent beside $HOME/ccrc.migrating; linked to $HOME/ccrc-versions/${name} (named by ~/.ccrc/migrating-to)`;
  const REMOVED = 'update: migration: $HOME/ccrc.migrating removed — the health gate passed';
  /** The FULL flavour over plantOldBox's REAL ~/ccrc — the migration fixture
   *  as it stands. */
  const fullBox = (prefix: string): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: NEW_SHA }), { tag: 'v2.0.0' });
    return home;
  };
  /** A crash pair an earlier run left: the pre-versioned tree aside, a
   *  complete v1.0.0 placed, the marker naming it, and no ~/ccrc at all. */
  const crashedPair = (home: string): void => {
    mkdirSync(join(migrating(home), 'server'), { recursive: true });
    writeFileSync(join(migrating(home), 'server', 'OLD-MARKER'), 'the pre-versioned tree\n');
    installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: OLD_SHA, version: 'v1.0.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v1.0.0\n');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      `{"sha":"${OLD_SHA}","ref":"main","builtAt":"2026-08-20T00:00:00Z","dirty":false,"version":"v1.0.0"}\n`);
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
  };
  const at = (stdout: string, pred: (l: string) => boolean): number => stdout.split('\n').findIndex(pred);

  it('a pre-W6 box migrates inside the staged spine, which KEEPS ~/ccrc.migrating (this run holds the lock); cmd_update removes it only after _upd_gate passes (§18 "the migration keeps the old tree until the gate")', () => {
    const home = fullBox('ccrc-update-migrate-');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    const linked = at(r.stdout, (l) => l === 'install: tree: $HOME/ccrc -> $HOME/ccrc-versions/v2.0.0 (the pre-versioned tree is kept at $HOME/ccrc.migrating until a health gate passes)');
    const kept = at(r.stdout, (l) => l === 'install: migration: $HOME/ccrc.migrating kept — an update holds ~/.ccrc/update.lock, and its health gate decides');
    const gate = at(r.stdout, (l) => l.startsWith('update: gate: both answers on v2.0.0 '));
    const removed = at(r.stdout, (l) => l === REMOVED);
    expect(linked, r.stdout).toBeGreaterThan(-1);
    expect(kept, 'the staged spine took its own doctor as the gate').toBeGreaterThan(linked);
    expect(gate).toBeGreaterThan(kept);
    expect(removed, 'the old tree went before the gate, or never').toBeGreaterThan(gate);
    expect(existsSync(migrating(home))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'migrating-to'))).toBe(false);
  });

  it('a FAILED gate never removes ~/ccrc.migrating: the run exits 4, and the pre-versioned tree and its marker are still there, byte for byte', () => {
    const home = fullBox('ccrc-update-migrate-gate-fail-');
    const before = treeDigest(join(home, 'ccrc'));
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');   // /health keeps answering the OLD build
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(treeDigest(migrating(home))).toEqual(before);
    expect(readFileSync(join(home, '.ccrc', 'migrating-to'), 'utf8')).toBe('v2.0.0\n');
    expect(r.stdout.split('\n')).not.toContain(REMOVED);
  });

  it('--no-gate measured nothing, so ~/ccrc.migrating is kept and the run says why', () => {
    const home = fullBox('ccrc-update-migrate-nogate-');
    const r = runUpdate(home, ['--no-gate']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const skipped = at(r.stdout, (l) => l.startsWith('update: gate: skipped (--no-gate)'));
    const kept = at(r.stdout, (l) => l === 'update: migration: $HOME/ccrc.migrating kept — --no-gate measured nothing');
    expect(skipped, r.stdout).toBeGreaterThan(-1);
    expect(kept).toBeGreaterThan(skipped);
    expect(lstatSync(migrating(home)).isDirectory()).toBe(true);
  });

  it('a crash pair is completed FIRST by ccrc update — before its backup, its install and its gate — and its old tree goes only after the gate passes (§18 "a crashed migration is completed first")', () => {
    const home = freshUpdateBox('ccrc-update-migrate-resume-');
    crashedPair(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const resume = at(r.stdout, (l) => l === resumed('v1.0.0'));
    const backup = at(r.stdout, (l) => l.startsWith('update: backup: '));
    const installing = at(r.stdout, (l) => l.startsWith('update: installing v2.0.0'));
    const gate = at(r.stdout, (l) => l.startsWith('update: gate: '));
    const removed = at(r.stdout, (l) => l === REMOVED);
    expect(resume, r.stdout).toBeGreaterThan(-1);
    expect(backup, 'something ran before the link was completed').toBeGreaterThan(resume);
    expect(installing).toBeGreaterThan(backup);
    expect(gate).toBeGreaterThan(installing);
    expect(removed).toBeGreaterThan(gate);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(existsSync(migrating(home))).toBe(false);
  });

  it('--check on a crashed box says so after its machine line and repairs NOTHING — no link, no marker change', () => {
    const home = freshUpdateBox('ccrc-update-migrate-check-');
    crashedPair(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // runUpdate's own environment build, once, before the snapshot — the
    // `--check writes nothing` case's idiom, for the same reason.
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toMatch(/^check: box=v1\.0\.0 /);
    // The remedy names a command that can run: the ccrc on PATH is the shim,
    // which execs the missing $HOME/ccrc/ccd/ccrc (crashedPair's marker names
    // the placed v1.0.0).
    expect(lines).toContain('this box\'s migration crashed ($HOME/ccrc is absent beside $HOME/ccrc.migrating) — '
      + 'run bash $HOME/ccrc-versions/v1.0.0/ccd/ccrc install (or bash install.sh from a ccrc checkout) to complete it '
      + '— the ccrc on PATH cannot run until then, and deploy.sh would place a second tree beside it');
    expect(homeSnapshot(home)).toEqual(before);
  });

  /** ONE `ln` ahead of the harness's PATH with two knobs, each disarmed on
   *  first use and each biting only an `ln` whose last argument is ~/ccrc —
   *  the staged spine's migration link. `fail` refuses it (exit 1); `kill`
   *  SIGKILLs the shell that ran it, i.e. the staged spine itself, so the
   *  parent's `inst_rc` reads 137 with the crash pair left behind. */
  const armLn = (home: string, knob: 'fixture-ln-fail-once' | 'fixture-ln-kill-once'): NodeJS.ProcessEnv => {
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'ln'), '#!/bin/sh\n'
      + 'for last in "$@"; do :; done\n'
      + 'if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/fixture-ln-fail-once" ]; then\n'
      + '  rm -f "$HOME/fixture-ln-fail-once"; echo "ln: fixture refusal" >&2; exit 1\n'
      + 'fi\n'
      + 'if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/fixture-ln-kill-once" ]; then\n'
      + '  rm -f "$HOME/fixture-ln-kill-once"; kill -KILL "$PPID"; exit 1\n'
      + 'fi\n'
      + `exec ${REAL_LN} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(home, knob), 'yes\n');
    return { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` };
  };

  it('a staged spine whose link cannot be placed moves ~/ccrc BACK before it dies, so the gate and the restore arms meet the pre-W6 directory they were written for, whichever updater is the parent (D-3436)', () => {
    const home = fullBox('ccrc-update-migrate-spine-ln-fail-');
    const r = runUpdate(home, [], armLn(home, 'fixture-ln-fail-once'));
    expect(existsSync(join(home, 'fixture-ln-fail-once')), 'the refusal never fired').toBe(false);
    expect(r.stderr).toContain('ccrc: $HOME/ccrc could not be linked to $HOME/ccrc-versions/v2.0.0, so it was moved back — nothing moved');
    // Nothing for the post-spine resume to complete: the layout reads
    // `directory`, so this case reads the same under a wave-4 parent, which
    // has no resume at all (D-3438).
    expect(at(r.stdout, (l) => l === resumed('v2.0.0'))).toBe(-1);
    // The spine died at `_inst_tree` and the stamp never moved, so the gate
    // fails and the box restores (exit 4) INTO the real directory — wave 4's
    // `a spine that DIED inside _inst_tree` shape.
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    const st = lstatSync(join(home, 'ccrc'));
    expect(!st.isSymbolicLink() && st.isDirectory(), 'the tree was not moved back to a real ~/ccrc').toBe(true);
    expect(existsSync(migrating(home))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'migrating-to'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-versions', 'v2.0.0', 'ccd', 'ccrc'))).toBe(true);
  });

  it('a staged spine KILLED inside the window is completed by cmd_update itself, before its gate and its restore arms — so arm 3 writes through the link and never recreates a real ~/ccrc beside ~/ccrc.migrating (D-3433)', () => {
    const home = fullBox('ccrc-update-migrate-spine-window-');
    const r = runUpdate(home, [], armLn(home, 'fixture-ln-kill-once'));
    expect(existsSync(join(home, 'fixture-ln-kill-once')), 'the kill never fired').toBe(false);
    const resume = at(r.stdout, (l) => l === resumed('v2.0.0'));
    const gate = at(r.stdout, (l) => l.startsWith('update: gate'));
    expect(resume, r.stdout).toBeGreaterThan(-1);
    expect(gate, 'the gate ran before the link was completed').toBeGreaterThan(resume);
    // The tree died at or after _inst_tree and its stamp never moved, so the
    // gate fails honestly and the box restores (exit 4) — through the LINK.
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink(), 'a restore arm recreated a real ~/ccrc').toBe(true);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(lstatSync(migrating(home)).isDirectory()).toBe(true);
  });

  itLinux('--detach on a crash pair completes the link BEFORE it queues, because the run it hands off execs the launcher shim, which cannot start with no ~/ccrc (D-3437)', () => {
    const home = freshUpdateBox('ccrc-update-migrate-detach-');
    crashedPair(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const resume = at(r.stdout, (l) => l === resumed('v1.0.0'));
    const detached = at(r.stdout, (l) => l.startsWith('update: detached — \'update --to v2.0.0\''));
    expect(resume, r.stdout).toBeGreaterThan(-1);
    expect(detached, 'the run was handed off before the link was completed').toBeGreaterThan(resume);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    // wave 4 Task 3's recorder: exactly the spec argv, handed to a box whose
    // launcher can now run.
    expect(readFileSync(join(home, 'systemd-run-argv'), 'utf8').split('\n').filter((l) => l !== '')).toEqual([
      `--user --collect --quiet ${join(home, '.local', 'bin', 'ccrc')} update --to v2.0.0 --from cli`,
    ]);
  });
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'one-time migration|MIGRATES rather than copying|the order is stated in one place|ends with _inst_doctor_tail'` (foreground, timeout ≥ 600000 ms)
Expected: FAIL —
- **corrected** (Task 2 leaves no placeholder die: a real `~/ccrc` takes its in-place pre-W6 arm) — the migrate-from-`~/ccrc` case exits 0 on that arm (`install: tree: already running from $HOME/ccrc`, no rsync) and then `readlinkSync` of `~/ccrc` throws `EINVAL` (a real directory); the doctor-FAIL case exits 1 (the lever works) and throws the same `EINVAL`; the lock-held case exits 0 with no `install: migration: … kept — an update holds …` line; the crash case is never killed (`the run was not killed inside the window`: code 0, not -1 — the in-place arm runs no `ln` naming `$HOME/ccrc`);
- the marker case exits 1 at Task 2's `crashed` arm, `a migration of $HOME/ccrc is incomplete — this run should have completed it first`, with line 1 of stdout `install: box: …`;
- the three refusal rows print `install: box:` and the `crashed` arm's sentence instead of the marker refusal;
- **added (review):** the unmeasurable-lock case exits 0 and then `readlinkSync` throws `EINVAL` (the in-place arm; no lock is asked at all) — and it must NOT fail on its first assertion: a code of 1 there means the directory at the lock path moved the doctor's verdict, and the case needs another lever before it pins anything; the fail-once case exits 0 on the in-place arm (`the refusal never fired`: that arm runs no `ln` naming `$HOME/ccrc`); the nest-once case fails the same way (`the stub never fired`); the sourced step-0 case exits 127 (`_inst_migrate: command not found`);
- the order pin reads `[]` where the two tails are expected; the tail pin stops at its first assertion, the last line reading `cmd_doctor` instead of `_inst_doctor_tail`.

Run: `cd server && ./node_modules/.bin/vitest run test/runbook-holds.test.ts`
Expected: FAIL — FACT 1's `doctorIdx` is `-1` (no `_inst_doctor_tail` line in `cmd_install`).

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'migration keeps the old tree until the gate'`
Expected: FAIL —
- **corrected** (the same reason: Task 2's staged spine converges `plantOldBox`'s real `~/ccrc` in place) — the FULL migration case exits 0 and then `readlinkSync` of `~/ccrc` throws `EINVAL`;
- the gate-FAIL case exits 4 but `~/ccrc` is not a symlink;
- the `--no-gate` case exits 0 with no `update: migration: … kept — --no-gate measured nothing` line (`kept` is `-1`);
- the crash-pair case finds no resume line (`-1`);
- the `--check` case has no crashed line;
- the two staged-spine `ln` cases fail at their first assertion (`the refusal never fired`, `the kill never fired`): the in-place arm runs no `ln` naming `$HOME/ccrc`, so neither knob is spent;
- the `--detach` crash-pair case (Linux) finds no resume line (`-1`): `_upd_detach` queues and hands off with `~/ccrc` still absent.

- [ ] **Step 5: Implement**

All in `ccd/ccrc`; locate each spot by its grep.

(a) The constant — immediately after Task 2's `VER_RECORD_COPY=".ccrc-installed"` line (`grep -n '^VER_RECORD_COPY=' ccd/ccrc`):

```bash
# `~/.ccrc/migrating-to` (W6 Task 3, D-3432) — one
# line naming the version a one-time migration is linking `~/ccrc` to,
# written (tmp + one rename) BEFORE the migration's `mv`. It is the ONLY
# input `_inst_migrate_resume` completes a crashed migration from; removed
# by `_inst_migrate_finish` and by uninstall.
BOX_MIGRATION_FILE="$HOME/.ccrc/migrating-to"
```

(b) `_inst_tree` — **corrected: Task 2 leaves no placeholder die to replace.** Its `directory` layout is a pre-W6 arm of its own (`dest=$BOX_TREE_DIR`, the old physical self-copy skip, `install: tree: placed at $HOME/ccrc`, npm in `$HOME/ccrc`, no flip), and Task 2 names this task as the one that replaces "exactly this arm (the `if [ "$VER_LAYOUT" = directory ]` block and the `!= directory` guards on the void, the npm skip and the flip)". Six edits, each located by its grep inside `_inst_tree` (`awk '/^_inst_tree\(\) \{/{f=1} f&&/^\}/{exit} f' ccd/ccrc` prints the function):

1. The `local` line `  local src name dest shown vroot="" how="" was="nothing" at` becomes `  local src name dest shown vroot="" how="" was="nothing"` (`at` was the retired arm's only reader).

2. The arm itself (`grep -n '(2) A PRE-VERSIONED BOX: THE TREE IN PLACE, AS BEFORE W6' ccd/ccrc`). Replace from the line `  if [ "$VER_LAYOUT" = directory ]; then` directly after `  name="$(_inst_version_name "$src")"` through the `  fi` directly above `  case "$how" in` — the whole `if … else … fi`, Task 2's `(2)` comment included — with the following: a new `(2)` paragraph, then Task 2's `else` body unchanged except two spaces less indent (its `(3)` comment's "for the self-copy guard's reason above" now points at the paragraph's second half):

```bash
  # ── (2) A PRE-VERSIONED BOX IS PLACED LIKE ANY OTHER (W6 Task 3) ───────
  # A real directory at `~/ccrc` no longer has an arm of its own. The incoming
  # tree goes to `~/ccrc-versions/<name>` exactly as on an `absent` box —
  # VER_CURRENT is empty there, so the guard below answers `copy` unless the
  # source is itself a placed version — and (5) MIGRATES the directory
  # instead of flipping it. The live directory is never the rsync's
  # destination, so the old self-copy skip has nothing left to guard: run
  # FROM `~/ccrc/ccd/ccrc`, this is a copy OUT of the directory into the
  # version, never `rsync -a --delete X X/` onto itself.
  #
  # THE OLD GUARD'S REASON FOR PHYSICAL PATHS STILL HOLDS. The two spellings
  # arrive by different routes ($HOME, and `$CCRC_HERE`'s parent from
  # `${BASH_SOURCE[0]}`): a symlinked component in either — /home ->
  # /export/home is the classic — makes a textual comparison answer
  # "different" for one directory, which is the exact case that must not
  # reach rsync.
  #
  # ── (3) THE GUARD, RE-DERIVED AGAINST VERSIONS ─────────────────────────
  # The question is no longer "is the source the live tree" but "is the
  # source the version this run would place": `_inst_version_name` names a
  # placed version after its own directory, so a run of
  # `~/ccrc-versions/<n>/ccd/ccrc` has `src` = `<vroot>/<n>` exactly. Three
  # answers, and a fourth for everything else:
  #   running — the source IS the version `~/ccrc` points at (a re-run of
  #     `ccrc install` from the box's own launcher): nothing is copied, and
  #     the sentence is the pre-W6 one, byte for byte.
  #   placed  — the source IS a placed version, another one: installing
  #     from it copies nothing, and the flip below points `~/ccrc` at it
  #     (D-3427).
  #   copy, same name — the source is a checkout or a staged release
  #     whose name is the version `~/ccrc` points at: rsync IN PLACE into
  #     that directory, the one case this wave does not make atomic
  #     (D-3426).
  #   copy — a new name: rsync into `~/ccrc-versions/<name>/`, never into
  #     the live one, and flip after the deps.
  # `pwd -P` on the versions root for the self-copy guard's reason above;
  # `src` is already physical.
  dest="$BOX_VERSIONS_ROOT/$name"
  shown="\$HOME/ccrc-versions/$name"
  if [ -d "$BOX_VERSIONS_ROOT" ]; then
    vroot="$(cd "$BOX_VERSIONS_ROOT" && pwd -P)" || _ccrc_die "cannot resolve $BOX_VERSIONS_ROOT"
  fi
  if [ -n "$vroot" ] && [ "$src" = "$vroot/$name" ]; then
    if [ "$name" = "$VER_CURRENT" ]; then how=running; else how=placed; fi
  else
    how=copy
  fi
```

3. The void before the rsync (`grep -n 'could not void the kept install record of' ccd/ccrc`). Replace

```bash
      if [ "$VER_LAYOUT" != directory ]; then
        rm -f -- "$dest/$VER_RECORD_COPY" \
          || _ccrc_die "could not void the kept install record of $name before placing over it ($dest/$VER_RECORD_COPY) — nothing was copied"
      fi
```

with

```bash
      rm -f -- "$dest/$VER_RECORD_COPY" \
        || _ccrc_die "could not void the kept install record of $name before placing over it ($dest/$VER_RECORD_COPY) — nothing was copied"
```

4. The rsync's success line. Replace

```bash
      if [ "$VER_LAYOUT" = directory ]; then
        echo "install: tree: placed at \$HOME/ccrc"
      elif [ "$name" = "$VER_CURRENT" ]; then
```

with

```bash
      if [ "$name" = "$VER_CURRENT" ]; then
```

(so a migrating box prints `install: tree: placed <name> at $HOME/ccrc-versions/<name>`, the line Task 8's rehearsal record expects before `install: tree: migrating — …`).

5. The npm skip. Replace `  if [ "$how" != copy ] && [ "$VER_LAYOUT" != directory ] && [ -f "$dest/$VER_RECORD_COPY" ] \` with `  if [ "$how" != copy ] && [ -f "$dest/$VER_RECORD_COPY" ] \` (its continuation line is unchanged).

6. The flip. In the `(5) THE FLIP` comment, replace its last two lines

```bash
  # name (`running`, and the in-place reinstall), and none on a pre-versioned
  # box, whose one-time migration is W6 Task 3's.
```

with

```bash
  # name (`running`, and the in-place reinstall). A pre-versioned box never
  # reaches it: the block above migrates it instead (W6 Task 3).
```

replace `  if [ "$VER_LAYOUT" != directory ] && [ "$name" != "$VER_CURRENT" ]; then` with `  if [ "$name" != "$VER_CURRENT" ]; then`, and immediately above the `(5)` comment's header line (`grep -n '(5) THE FLIP' ccd/ccrc`) insert:

```bash
  # ── A REAL DIRECTORY AT ~/ccrc IS MIGRATED, NOT FLIPPED (W6 Task 3) ──────
  # Steps 3–4 above placed `$name` FULLY — the tree and its deps — while the
  # directory kept running (spec §11: "build the versioned tree fully").
  # `_plat_ln_swap` refuses a real directory at the link by contract, so the
  # one-time migration takes the flip's place, and is equally the last act.
  if [ "$VER_LAYOUT" = directory ]; then
    _inst_migrate "$name"
    return 0
  fi
```

Then `awk '/^_inst_tree\(\) \{/{f=1} f&&/^\}/{exit} f' ccd/ccrc | grep -c 'VER_LAYOUT" [!=]*= directory'` prints `1` (the migration branch), and `grep -c 'install: tree: placed at \\\$HOME/ccrc"' ccd/ccrc` prints `0`. Task 2's `(1)` block (the `crashed` and `foreign|unreadable` refusals) is untouched.

(c) The six functions — immediately after `_inst_tree`'s closing `}`, before the `# ── _inst_atomic — the local \`install_atomic\`` header:

```bash

# ── THE ONE-TIME MIGRATION (design 2026-09-20 §11; W6 Task 3) ─────────────
# A box installed before versioned installs has a REAL directory at ~/ccrc.
# `_inst_tree` has just placed the incoming tree FULLY at
# ~/ccrc-versions/<name> while that directory kept running; this moves it
# aside and puts the link in its place:
#
#   1. ~/.ccrc/migrating-to <- <name>          tmp + one rename (D-3432)
#   2. ~/ccrc -> ~/ccrc.migrating               rename(2)
#   3. ~/ccrc = link to ~/ccrc-versions/<name>  symlink(2)
#
# Steps 2–3 are the spec's two-syscall window, once per node: a crash between
# them leaves ~/ccrc.migrating and no ~/ccrc, which `_inst_migrate_resume`
# completes FIRST on the next install or update — from the marker written in
# step 1, never from a guess. Step 2 goes through `_plat_mv_notdir` (one
# rename; GNU `mv -fT` will not move INTO a non-empty directory standing at
# the name, the Darwin arm refuses any real one), and step 3 is `ln -sn`
# (D-3434): measured 2026-09-23 (GNU coreutils
# 9.4), `ln -s <t> <name>` where <name> is already a symlink to a directory
# makes a link INSIDE that directory and exits 0; `-n` refuses (BSD `ln` takes
# it too), and the `[ -L ]` after it catches the one shape `-n` does not
# cover, a real directory at the name. ~/ccrc.migrating is NOT removed here:
# only a gate that passed removes it (`_inst_migrate_finish`).
_inst_migrate() {   # <name>
  local name="$1" tmp="$BOX_MIGRATION_FILE.tmp.$$"
  # A plain install takes no lock, and placing <name> took an rsync and an
  # npm ci: the layout is measured again, here, not trusted from before.
  _ver_layout
  [ "$VER_LAYOUT" = directory ] \
    || _ccrc_die "\$HOME/ccrc changed while this run placed $name (it now reads $VER_LAYOUT) — nothing moved; $name is complete at \$HOME/ccrc-versions/$name"
  echo "install: tree: migrating — \$HOME/ccrc is a directory; $name is complete at \$HOME/ccrc-versions/$name"
  if ! { mkdir -p "${BOX_MIGRATION_FILE%/*}" && printf '%s\n' "$name" > "$tmp" && chmod 644 "$tmp" \
         && _plat_mv_notdir "$tmp" "$BOX_MIGRATION_FILE"; } 2>/dev/null; then
    rm -f -- "$tmp" 2>/dev/null
    _ccrc_die "could not record the migration's target in ~/.ccrc/migrating-to — nothing moved; \$HOME/ccrc is still the directory it was"
  fi
  _plat_mv_notdir "$BOX_TREE_DIR" "$BOX_MIGRATING_DIR" \
    || _ccrc_die "could not move \$HOME/ccrc aside to \$HOME/ccrc.migrating — nothing moved; the new tree stays complete at \$HOME/ccrc-versions/$name"
  if ! { ln -sn -- "$BOX_VERSIONS_ROOT/$name" "$BOX_TREE_DIR" && [ -L "$BOX_TREE_DIR" ]; }; then
    # D-3436: a failure THIS run can see is
    # undone HERE, in the staged spine — W6's own code, whichever updater is
    # the parent — so no crash pair is left for a parent that may have no
    # resume (wave 4's has none, and its arm 3 would `mkdir -p` a real
    # ~/ccrc beside ~/ccrc.migrating). Only onto an EMPTY name:
    # `_plat_mv_notdir` replaces a link standing there (both arms), and a
    # link there now is another run's resume, not ours to undo; a nested
    # link (`[ -L ]` refused it) left a real directory there. Either way the
    # tree stays aside and the crash-pair sentence below is the true one.
    if [ ! -e "$BOX_TREE_DIR" ] && [ ! -L "$BOX_TREE_DIR" ] \
       && _plat_mv_notdir "$BOX_MIGRATING_DIR" "$BOX_TREE_DIR" 2>/dev/null; then
      rm -f -- "$BOX_MIGRATION_FILE" 2>/dev/null
      _ccrc_die "\$HOME/ccrc could not be linked to \$HOME/ccrc-versions/$name, so it was moved back — nothing moved; \$HOME/ccrc is still the directory it was, and $name is complete at \$HOME/ccrc-versions/$name"
    fi
    _ccrc_die "\$HOME/ccrc was moved to \$HOME/ccrc.migrating but the link could not be placed — the next 'ccrc install' completes it from ~/.ccrc/migrating-to; until then run ccrc by its path: bash \$HOME/ccrc-versions/$name/ccd/ccrc install"
  fi
  echo "install: tree: \$HOME/ccrc -> \$HOME/ccrc-versions/$name (the pre-versioned tree is kept at \$HOME/ccrc.migrating until a health gate passes)"
}

# ── _inst_migrate_resume <prefix> — a crash inside the window, completed FIRST
# (design §11; W6 Task 3). Its one argument is the line prefix (`install`,
# `update`, …). `crashed` is ~/ccrc.migrating standing with no
# ~/ccrc. The launcher cannot run at all then (its shim execs
# $HOME/ccrc/ccd/ccrc), so this is reached from `install.sh`, a checkout, or
# a placed version's own ccd/ccrc run by its path. It links ONLY what
# ~/.ccrc/migrating-to names — a real directory under ~/ccrc-versions that
# carries ccd/ccrc — and refuses anything else with both by-hand remedies:
# a guess such as the newest directory could link a tree the crashed run
# never finished placing. Callers run it BEFORE anything else they do to the
# box: `cmd_install` before its spine (so before `_inst_banner`), and
# `cmd_update` after its lock and again after its staged spine
# (D-3433), `_upd_detach` before it queues
# (D-3437) and `cmd_rollback` before its
# kept check (W6 Task 4) — those two unlocked, behind a lock probe that
# answered free.
_inst_migrate_resume() {
  local prefix="$1" name="" what="is absent"
  _ver_layout
  [ "$VER_LAYOUT" = crashed ] || return 0
  if [ -e "$BOX_MIGRATION_FILE" ] || [ -L "$BOX_MIGRATION_FILE" ]; then
    what="does not name a placed version"
    if [ -f "$BOX_MIGRATION_FILE" ] && [ -r "$BOX_MIGRATION_FILE" ]; then
      IFS= read -r name < "$BOX_MIGRATION_FILE" || true
    fi
  fi
  if [[ "$name" =~ $VER_NAME_RE ]] && [ ! -L "$BOX_VERSIONS_ROOT/$name" ] \
     && [ -d "$BOX_VERSIONS_ROOT/$name" ] && [ -f "$BOX_VERSIONS_ROOT/$name/ccd/ccrc" ]; then
    { ln -sn -- "$BOX_VERSIONS_ROOT/$name" "$BOX_TREE_DIR" && [ -L "$BOX_TREE_DIR" ]; } \
      || _ccrc_die "a migration of \$HOME/ccrc crashed, and linking \$HOME/ccrc to \$HOME/ccrc-versions/$name failed — nothing else was changed; link it by hand: ln -s \$HOME/ccrc-versions/$name \$HOME/ccrc"
    echo "$prefix: tree: completed a crashed migration — \$HOME/ccrc was absent beside \$HOME/ccrc.migrating; linked to \$HOME/ccrc-versions/$name (named by ~/.ccrc/migrating-to)"
    return 0
  fi
  _ccrc_die "a migration of \$HOME/ccrc crashed and ~/.ccrc/migrating-to $what — nothing was changed. To go back: mv \$HOME/ccrc.migrating \$HOME/ccrc — or, to go forward: ln -s \$HOME/ccrc-versions/<name> \$HOME/ccrc"
}

# `_ver_crashed_remedy` — the remedy a READER of a crashed layout prints
# (`ccrc update --check`, `ccrc versions`), never a repair. The ccrc on PATH
# is the shim, which execs the missing $HOME/ccrc/ccd/ccrc and cannot run, so
# the command named is the placed version's own ccrc, run by its path — the
# one `_inst_migrate_resume` would link, checked the way it checks it. Never
# deploy.sh, which the shim's own refusal offers: its rsync would place a
# real ~/ccrc beside ~/ccrc.migrating, which `_ver_layout` reads
# `unreadable`. Reads only; stdout one clause; rc 0.
_ver_crashed_remedy() {
  local name=""
  if [ -f "$BOX_MIGRATION_FILE" ] && [ -r "$BOX_MIGRATION_FILE" ]; then
    IFS= read -r name < "$BOX_MIGRATION_FILE" || true
  fi
  if [[ "$name" =~ $VER_NAME_RE ]] && [ ! -L "$BOX_VERSIONS_ROOT/$name" ] \
     && [ -d "$BOX_VERSIONS_ROOT/$name" ] && [ -f "$BOX_VERSIONS_ROOT/$name/ccd/ccrc" ]; then
    echo "run bash \$HOME/ccrc-versions/$name/ccd/ccrc install (or bash install.sh from a ccrc checkout) to complete it — the ccrc on PATH cannot run until then, and deploy.sh would place a second tree beside it"
  else
    echo "~/.ccrc/migrating-to names no placed version, so no install can complete it — link it by hand (ln -s \$HOME/ccrc-versions/<name> \$HOME/ccrc) or move it back (mv \$HOME/ccrc.migrating \$HOME/ccrc); not deploy.sh, which would place a second tree beside it"
  fi
}

# ── _inst_migrate_finish <prefix> <gate words> — the old tree goes AFTER a gate
# (design §11: "delete ~/ccrc.migrating only after the gate passes"). Called
# only where a gate has just passed: `cmd_update` after `_upd_gate`, and
# `_inst_doctor_tail` when a plain install is its own gate. rc 0 always — a
# directory that cannot be removed is disk, not health.
_inst_migrate_finish() {   # <prefix> <gate words>
  _ver_layout
  if [ "$VER_LAYOUT" = linked ]; then
    # A marker that outlived its migration (the directory removed by hand)
    # names nothing, and it is ccrc's own write: it goes, silently.
    rm -f -- "$BOX_MIGRATION_FILE" 2>/dev/null
    return 0
  fi
  [ "$VER_LAYOUT" = migrated ] || return 0
  if rm -rf -- "$BOX_MIGRATING_DIR" && rm -f -- "$BOX_MIGRATION_FILE"; then
    echo "$1: migration: \$HOME/ccrc.migrating removed — $2"
  else
    echo "$1: migration: WARN: could not remove \$HOME/ccrc.migrating — remove it by hand; nothing else depends on it"
  fi
  return 0
}

# ── _ver_lock_try — ~/.ccrc/update.lock, taken WITHOUT dying (W6 Task 3) ──
# Wave 4's `_upd_lock` dies when the lock is held; a plain `ccrc install`
# must ASK instead, because the answer is what tells a plain install (its own
# gate) from a staged spine run under an updater that holds the lock
# (D-3431). Wave 4's words (`_upd_lock_probe`, ruling
# R16): rc 0 this process now holds it in UPD_LOCK_FD (`_upd_unlock`
# releases it); rc 1 another process holds it; rc 2 no `flock`; rc 3
# UNMEASURED — ~/.ccrc could not be made, the file could not be opened, or
# `flock -n` answered anything but 0 or 1. Never folded: a 3 read as 1 would
# keep the old tree for no reason, and read as 0 would remove it under a lock
# nobody could see.
_ver_lock_try() {
  [ -n "$UPD_LOCK_FD" ] && return 0
  command -v flock >/dev/null 2>&1 || return 2
  { [ -d "${BOX_UPDATE_LOCK%/*}" ] || mkdir -p "${BOX_UPDATE_LOCK%/*}"; } 2>/dev/null || return 3
  # The COMPOUND form (D-3230): a bare `exec {fd}>>… 2>/dev/null` leaks
  # bash's own open-failure diagnostic.
  { exec {UPD_LOCK_FD}>>"$BOX_UPDATE_LOCK"; } 2>/dev/null || { UPD_LOCK_FD=""; return 3; }
  local r=0
  flock -n "$UPD_LOCK_FD" || r=$?
  [ "$r" -eq 0 ] && return 0
  { exec {UPD_LOCK_FD}>&-; } 2>/dev/null
  UPD_LOCK_FD=""
  [ "$r" -eq 1 ] && return 1
  return 3
}

# ── _inst_doctor_tail — `cmd_install`'s last word, and whether it is a gate ─
# (W6 Task 3.) The verb's exit code is doctor's (the landing block's rule),
# so doctor runs FIRST and its rc is what this returns, untouched. Then, on
# a versioned box only, it decides whether this install is its own gate
# (D-3431). A plain `ccrc install` is — its doctor is
# the only measurement it has — but only while ~/.ccrc/update.lock is FREE.
# A spine run while an updater holds the lock is a staged spine, and the
# updater's `_upd_gate`, not this doctor, decides whether ~/ccrc.migrating
# goes. The lock is released again only when this call took it.
_inst_doctor_tail() {
  local drc=0 lrc=0 took=0 why=unmeasured
  cmd_doctor || drc=$?
  _ver_layout
  case "$VER_LAYOUT" in linked|migrated) ;; *) return "$drc" ;; esac
  [ -z "$UPD_LOCK_FD" ] && took=1
  _ver_lock_try || lrc=$?
  case "$lrc" in
    0)
      if [ "$drc" -eq 0 ]; then
        _inst_migrate_finish install "ccrc doctor passed; a plain install is its own gate"
      elif [ "$VER_LAYOUT" = migrated ]; then
        echo "install: migration: \$HOME/ccrc.migrating kept — ccrc doctor did not pass; the next install or update whose gate passes removes it"
      fi
      [ "$took" -eq 1 ] && _upd_unlock
      ;;
    1)
      [ "$VER_LAYOUT" = migrated ] \
        && echo "install: migration: \$HOME/ccrc.migrating kept — an update holds ~/.ccrc/update.lock, and its health gate decides"
      ;;
    *)
      [ "$lrc" -eq 2 ] && why="no flock"
      [ "$VER_LAYOUT" = migrated ] \
        && echo "install: migration: \$HOME/ccrc.migrating kept — ~/.ccrc/update.lock could not be taken or measured ($why), so no gate is known to have passed"
      ;;
  esac
  return "$drc"
}
```

(d) `cmd_install`. Between `  INST_DEGRADED=()` (`:9167` at `d759c914`) and wave 4's comment `  # The spine, one step at a time, each announced in ~/.ccrc/install-step` insert:

```bash
  # W6 Task 3: a crashed one-time migration (~/ccrc.migrating standing, no
  # ~/ccrc) is completed FIRST (design §11) — before the spine, so before
  # `_inst_banner` names the tree, and outside CCRC_INST_SPINE, so no
  # install-step marker ever names it (a death here moved nothing).
  _inst_migrate_resume install
```

In the fleet arm (`grep -n 'install: next: add your first session with: ccd menu' ccd/ccrc` — the first of the two hits is the fleet arm's; the lines after it read `    cmd_doctor` / `    return`), replace `    cmd_doctor` with `    _inst_doctor_tail` (the `    return` below it stays: it returns the tail's rc). Replace the function's final line `  cmd_doctor` (`:9269`) with `  _inst_doctor_tail`.

(e) `cmd_update`, four places (and, **added**, `_upd_detach` in (f)).

1. On the line after `  UPD_REPORTING=1` (`grep -n '^  UPD_REPORTING=1$' ccd/ccrc`):

```bash
  # W6 Task 3: a crashed one-time migration (`~/ccrc.migrating`, no `~/ccrc`)
  # is completed FIRST (design §11) — after the lock, so two runs never race
  # the link, and after UPD_REPORTING, so a refusal here is a `failed`
  # report; before the preflight, the old-identity read and `_upd_phase
  # resolving`, none of which needs the tree.
  _inst_migrate_resume update
```

2. On the line after the `fi` that closes the staged-spine invocation. **Corrected (review):** wave 4 Task 2 Step 3 (f) writes that block as five lines — `  if [ -n "$UPD_LOCK_FD" ]; then` / the subshell line / `  else` / the bare `    "${spine_env[@]}" "${spine[@]}" || inst_rc=$?` / `  fi` — so the `fi` is THREE lines below the subshell line, after `else` and the bare-spine line; one line short puts this resume inside the `else` arm, where only an inherited run (arm 2's child) reaches it. Locate it with `grep -n -A3 '( exec {UPD_LOCK_FD}>&-; exec "\${spine_env\[@\]}" "\${spine\[@\]}" ) || inst_rc=\$?' ccd/ccrc` and require the fourth line printed to be exactly `  fi` (the second `  else`, the third the bare-spine line); any other shape: stop, wave 4 did not land as written. Insert:

```bash
  # W6 Task 3 (D-3433): a staged spine that died
  # INSIDE the migration's window — killed between the `mv` and the link; a
  # failed `ln` moves the tree back inside the spine itself
  # (D-3436) — left `~/ccrc.migrating` and
  # no `~/ccrc`. This is parent code: a wave-4 parent, which drives every
  # box's FIRST move, has none of it (D-3438). Completed
  # here, from the marker, before anything below reads the tree: the gate
  # would probe a unit whose tree is gone, arm 2's child could not start, and
  # arm 3's `_upd_restore_copy` would `mkdir -p` a REAL `~/ccrc` beside the
  # pre-versioned one.
  _inst_migrate_resume update
```

3. Between the `fi` that closes wave 4's D-3240 block (the `if [ -n "$UPD_SPINE_DIED" ]; then … exit 1` / `fi`) and wave 4 Task 6's `  if [ "$UPD_FROM" = restore ]; then` (`grep -n '^  if \[ "\$UPD_FROM" = restore \]; then$' ccd/ccrc`):

```bash
  # ── THE MIGRATION'S GATE (design §11; W6 Task 3) ─────────────────────────
  # `~/ccrc.migrating` — the pre-versioned tree the staged spine moved aside —
  # goes only once a gate has PASSED, and this is the one point of this verb
  # that knows one has: a failed gate exited 4 above, after its restore; a
  # spine that died after the tree exited 1 (D-3240). The staged spine kept
  # the directory, because its doctor tail found this run's lock held
  # (D-3431). --no-gate measured nothing, so it keeps
  # it too — arm 2's restore child included, which always passes --no-gate.
  if [ "$no_gate" -eq 1 ]; then
    _ver_layout
    [ "$VER_LAYOUT" = migrated ] \
      && echo "update: migration: \$HOME/ccrc.migrating kept — --no-gate measured nothing"
  else
    _inst_migrate_finish update "the health gate passed"
  fi
```

4. In the `--check` arm, immediately above its `    case "$state" in` (`grep -n '^    case "\$state" in$' ccd/ccrc` prints exactly one line):

```bash
    # W6 Task 3: a crashed one-time migration is SAID here, never repaired —
    # --check writes nothing; an install run by the placed version's own path
    # (or the next update) completes it — `_ver_crashed_remedy` names which.
    _ver_layout
    [ "$VER_LAYOUT" != crashed ] \
      || echo "this box's migration crashed (\$HOME/ccrc is absent beside \$HOME/ccrc.migrating) — $(_ver_crashed_remedy)"
```

(f) **Added (review)** — wave 4 Task 3's `_upd_detach`, D-3437. Locate its probe's `case` with `awk '/^_upd_detach\(\) \{/{f=1} f&&/^\}/{exit} f' ccd/ccrc`; on the line after the `  esac` that closes `case "$prc" in` (the `*)` arm above it dies `could not be measured`), and above `  UPD_REPORT_TARGET="$tag"`, insert:

```bash
  # W6 Task 3 (D-3437): the run handed off
  # below execs $HOME/.local/bin/ccrc — the shim, which execs
  # $HOME/ccrc/ccd/ccrc and refuses when a crashed migration left no
  # ~/ccrc — so the crash is completed HERE, before the `queued` write, or
  # this parent would print `detached` over a report no run ever advances.
  # Every probe arm but a free lock has died above (ruling R16), so no update
  # owns the link; the parent must hold no lock at the spawn, so this runs
  # unlocked, as a plain install's resume does (`ln -sn` + `[ -L ]` refuse a
  # concurrent resume's second link, D-3434).
  _inst_migrate_resume "$verb"
```

Then: `bash -n ccd/ccrc` — expected: no output, exit 0. And `grep -c '^  _inst_migrate_resume "\$verb"$' ccd/ccrc` prints `1`, `grep -c '_inst_migrate_resume update' ccd/ccrc` prints `2`, `grep -c '^  _inst_doctor_tail$\|^    _inst_doctor_tail$' ccd/ccrc` prints `2`, and `awk '/^cmd_install\(\) \{/{f=1} f&&/^\}/{exit} f' ccd/ccrc | grep -c 'cmd_doctor'` prints `0`.

- [ ] **Step 6: Run green**

Run, each in the foreground (timeout ≥ 600000 ms), from `server/`:
- `./node_modules/.bin/vitest run test/ccrc-install.test.ts` — Expected: PASS, every case. The file's case count rises by exactly 11 (the new describe's eight `it` — **corrected (review):** the four written first plus the unmeasurable-lock, fail-once, nest-once and step-0 cases — plus three `it.each` rows, less nothing: the `:1044` case and the tail pin are rewritten in place). Count before and after.
- `./node_modules/.bin/vitest run test/runbook-holds.test.ts` — Expected: PASS, the same case count as before.
- `./node_modules/.bin/vitest run test/ccrc-update.test.ts` — Expected: PASS, every case, the count up by exactly 8 (**corrected (review):** the spine-window case became two — fail-once and kill-once — and the `--detach` crash-pair case is new; it is `itLinux`, so a Darwin run counts it skipped). The FULL happy path and D-3114 cases now migrate `plantOldBox`'s real `~/ccrc` and, their gate passing, print `update: migration: $HOME/ccrc.migrating removed — the health gate passed`, which none of their assertions reads. Wave 4's FULL `a spine that DIED inside _inst_tree (after the tree moved) …` case changes shape underneath its assertions: its `npm ci` now dies inside `~/ccrc-versions/v2.0.0/server`, BEFORE the migration, so `plantOldBox`'s real `~/ccrc` is never moved and arm 3 restores into it as before — its exit 4, its `update: gate FAILED after` line, its `arm2-refused` line and its no-record assertions all still hold (the case's name now overstates what moved; it is not renamed here).
- `./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts`, then `test/macos-platform.test.ts`, then `test/single-definition.test.ts` — Expected: PASS, counts unchanged.

Do NOT chase `session-hook.test.ts`; Task 9 re-measures it. A red in a file named as a known load flake (CLAUDE.md) is re-run alone before it is called a break.

- [ ] **Step 7: Mutation check**

Each edit applied alone, the named case run with `-t`, then reverted BY HAND (never `git checkout -- ccd/ccrc`, which would discard Step 5's uncommitted work); afterwards `bash -n ccd/ccrc` is clean and `git diff --stat` shows the same four files and line counts as before the row.

1. §18 "the migration keeps the old tree until the gate" — "the `rm` moves above the gate", install half: in `_inst_doctor_tail`, move the line `  cmd_doctor || drc=$?` to directly above its last line `  return "$drc"`. Run `ccrc-install.test.ts -t 'a doctor that FAILS keeps'` → RED (the tail decided with `drc` still 0: `.migrating` is gone and the `removed` line printed on a failing box). Restore.
2. Same row, update half (the spec's literal row): cut the whole `  if [ "$no_gate" -eq 1 ]; then … fi` block from 5(e)3, with its comment, and paste it directly above wave 4's `  # ── THE HEALTH GATE (design §11)` comment. Run `ccrc-update.test.ts -t 'FAILED gate never removes'` → RED (`.migrating` removed before the gate that then failed). Restore.
3. Same row, the `rm` inside the migration: add `  rm -rf -- "$BOX_MIGRATING_DIR"` as the last line of `_inst_migrate`. Run `ccrc-install.test.ts -t 'a doctor that FAILS keeps|is a STAGED spine'` and `ccrc-update.test.ts -t 'FAILED gate never removes|no-gate measured nothing'` → all four RED. Restore.
4. D-3431: in `_inst_doctor_tail`'s `case "$lrc" in`, change the arm label `    0)` to `    0|1)`. Run `ccrc-install.test.ts -t 'is a STAGED spine'` → RED (the held lock was ignored and the old tree removed). Restore.
5. §18 "a crashed migration is completed first", install half: delete the line `  _inst_migrate_resume install` in `cmd_install`. Run `ccrc-install.test.ts -t 'crash inside the two-syscall window|never a guess'` → both RED (exit 1 at `_inst_tree`'s `crashed` arm, `a migration of $HOME/ccrc is incomplete — this run should have completed it first`; nothing linked). Restore.
6. Same row, update half: delete the `  _inst_migrate_resume update` on the line after `  UPD_REPORTING=1` (the first of the two). Run `ccrc-update.test.ts -t 'completed FIRST by ccrc update'` → RED (the post-spine resume still links it, but its line now follows `update: installing v2.0.0` and `update: backup:`). Restore.
7. D-3433: delete the second `  _inst_migrate_resume update` (after the staged spine's `fi`). Run `ccrc-update.test.ts -t 'KILLED inside the window'` → RED (no resume line; arm 3's `_upd_restore_copy` made a real `~/ccrc/server/`, so `~/ccrc` is not a symlink). **Corrected (review):** the kill-once case, not the fail-once one — a failed `ln` now moves the tree back inside the spine (row 14), so only a kill leaves this resume anything to do. Restore.
8. D-3432: in `_inst_migrate_resume`, replace `      IFS= read -r name < "$BOX_MIGRATION_FILE" || true` with `      name="$(ls -t "$BOX_VERSIONS_ROOT" | head -n1)"`. Run `ccrc-install.test.ts -t 'never a guess'` → RED (line 1 names `v9.9.9`, the newer incomplete directory). Restore.
9. D-3434: in `_inst_migrate`, `ln -sn --` → `ln -s --`. Run `ccrc-install.test.ts -t 'crash inside the two-syscall window'` → RED (the recorded argv is `-s -- …`). Restore.
10. The verdict is doctor's: in `_inst_doctor_tail`, the last line `  return "$drc"` → `  return 0`. Run `ccrc-install.test.ts -t 'a box doctor fails on exits 1|ends with _inst_doctor_tail'` → both RED. Restore.
11. **Added (review)** — the lock's UNMEASURED arm (ruling R16): (a) in `_inst_doctor_tail`'s `case "$lrc" in`, change the arm label `    0)` to `    0|3)`. Run `ccrc-install.test.ts -t 'cannot be MEASURED'` → RED (the unmeasurable lock read as free: the `removed` line printed and `.migrating` gone). Restore. (b) In `_ver_lock_try`, `{ UPD_LOCK_FD=""; return 3; }` → `{ UPD_LOCK_FD=""; return 0; }` (a failed open answered as "taken"). Same case → RED, the same way. Restore.
12. **Added (review)** — D-3434's `[ -L ]`: in `_inst_migrate`, `if ! { ln -sn -- "$BOX_VERSIONS_ROOT/$name" "$BOX_TREE_DIR" && [ -L "$BOX_TREE_DIR" ]; }; then` → `if ! { ln -sn -- "$BOX_VERSIONS_ROOT/$name" "$BOX_TREE_DIR"; }; then`. Run `ccrc-install.test.ts -t 'nested INSIDE a real directory'` → RED (the nested `ln` exits 0, so the run prints `install: tree: $HOME/ccrc -> …` for a link it never placed and does not die with the refusal). Restore.
13. **Added (review)** — `_inst_migrate`'s step 0: delete its three lines `  _ver_layout` / `  [ "$VER_LAYOUT" = directory ] \` / `    || _ccrc_die "\$HOME/ccrc changed while this run placed …"`. Run `ccrc-install.test.ts -t 're-measures the layout'` → RED (exit 0: the v1.0.0 LINK is moved aside to `~/ccrc.migrating` and a v2.0.0 link placed). Restore.
14. **Added (review)** — D-3436: in `_inst_migrate`, replace the move-back condition's two lines `    if [ ! -e "$BOX_TREE_DIR" ] && [ ! -L "$BOX_TREE_DIR" ] \` / `       && _plat_mv_notdir "$BOX_MIGRATING_DIR" "$BOX_TREE_DIR" 2>/dev/null; then` with `    if false; then`. Run `ccrc-install.test.ts -t 'moves ~/ccrc BACK'` → RED (the crash-pair sentence; `~/ccrc` absent) and `ccrc-update.test.ts -t 'moves ~/ccrc BACK before it dies'` → RED (the W6 parent's post-spine resume links the crash pair, so `~/ccrc` ends a link). Restore. **Its control:** delete only the post-spine resume (row 7's edit) and run `ccrc-update.test.ts -t 'moves ~/ccrc BACK before it dies'` → GREEN: the case holds without the W6 parent's resume, i.e. in the position of a wave-4 parent, which has none. Restore.
15. **Added (review)** — D-3437: delete `  _inst_migrate_resume "$verb"` in `_upd_detach`. Run `ccrc-update.test.ts -t 'completes the link BEFORE it queues'` → RED on Linux (no resume line; `~/ccrc` still absent when the run is handed off). Restore.

Then re-run Step 6's first three files once more, green.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccrc server/test/ccrc-install.test.ts server/test/ccrc-update.test.ts server/test/runbook-holds.test.ts
git commit -m "feat(ccrc): the one-time migration of a real ~/ccrc — placed fully, moved aside, linked; a crash inside the window is completed first from ~/.ccrc/migrating-to; ~/ccrc.migrating goes only after a gate passes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Restore arm 1 and rollback by flip

**Files:**
- Modify: `ccd/ccrc` — `CCRC_CAP_WORDS` gains `versions`, and one line of its comment (re-locate by `grep -n '^CCRC_CAP_WORDS=(' ccd/ccrc`; `:1144` at `d759c914`, where wave 4's Task 13 wrote its nine-line comment above it). New `_ver_kept`, `_ver_can_flip`, `_ver_flip_back`, `_upd_restore_arm1`, `_upd_legacy_target` immediately after wave 4's `_upd_restore_arm3` closing `}` (`grep -n '^_upd_restore_arm3() {' ccd/ccrc`; wave 4 put it where `_upd_backup_copy` was, `:11768` at `d759c914`). Also modified:
  - `_upd_restore` (wave 4's): its arm order, and the three header-comment lines that said arm 1 was wave 6's;
  - `_upd_restore_arm3` (wave 4's): one void block after its record removal, above its line `  echo "update: arm 3: copying this run's pre-update backup …"`;
  - `cmd_update` (`:11305` at `d759c914`): `_upd_legacy_target` on the line after wave 4 Task 6's `  _upd_marker_unsigned && UPD_PREV_UNSIGNED=1`, i.e. ABOVE the `rm -f "$BOX_INSTALLED_FILE"` that precedes the staged spine (**corrected** — the skeleton put it immediately above the staged-spine invocation, below that removal, where its refusal would leave a box that reads `incomplete` while its die says nothing was installed); and `_ver_keep_state update` on the line above wave 4 Task 5's `  # ── THE HEALTH GATE (design §11)` header, i.e. after the `fi` closing `if [ "$inst_rc" -ne 0 ]`; and a layout refusal on the line after Task 3's FIRST `  _inst_migrate_resume update` (the one directly after `  UPD_REPORTING=1`), ahead of the old-identity read, `_upd_backup` and every download (**added**, D-3429 amended);
  - `cmd_rollback` (wave 4 Task 7's): the release-host question becomes the non-kept arm of a kept check, whose layout `case` also refuses a foreign or unreadable `~/ccrc` (**added**), and a flip path runs under the lock before its in-process `cmd_update`;
  - `usage()` (`:1471` at `d759c914`): one sentence at the end of wave 4's `rollback` entry.
- Test: `server/test/ccrc-update.test.ts`:
  - `healthyBox`'s combined curl (`:69-131` at `d759c914`): one knob line, `fixture-health-deny`, in wave 4 Task 5's `/health` block (**added** — the skeleton's "wrong `/health` version" is a pin, and a pin answers the same version whatever the box's stamp says, so it cannot measure the stamp restore);
  - no import is edited (**corrected**): Task 2 Step 3 (e) already made the `node:fs` import's `  symlinkSync,` line `  symlinkSync, readlinkSync,` and added `import { installVersionedTree } from './installTreeFixture.js';` after the `platformFixtures.js` import; Step 1 checks both;
  - no `sourcedCcrc` is declared (**corrected**): wave 4 Task 3 already declared the file-scope `function sourcedCcrc(home: string, script: string): Result` after `announcedBackupDir`, and a second file-scope `function sourcedCcrc` is a redeclaration — the module does not load and every case in the file reds. This task's sourced tables call wave 4's, with a one-string script;
  - wave 4 Task 13's `CAPS_NOW` (after `localUrls`, `:589-592` at `d759c914`);
  - a file-scope fixture block and four describes appended at the end of the file: `ccrc update: restore arm 1 — a flip back to the kept previous version (W6 Task 4)`, `ccrc rollback: by flip when the version is kept (W6 Task 4)`, `ccrc update: a spine older than W6 gets a directory named for its own tag (W6 Task 4)`, `ccrc update and rollback: refused before anything moves — a ~/ccrc this ccrc did not make, and a flip macOS cannot make (W6 Task 4)`. Wave 4's arm-2 and arm-3 cases keep their outcomes, unedited: they plant real-directory boxes (`plantRestoreBox` → `plantOldBox`), which have no arm 1, so their transcripts gain one line, `update: arm 1: … — arm 2`, which no `toContain` of theirs names.
- Test: `server/test/ccrc-install.test.ts` — wave 4 Task 13's caps cases in `describe('ccrc install: the node\'s three files (design 2026-09-20 §3, §9)'` (`:3898` at `d759c914`): its three constants, two case titles, the both-arms loop, and its presence pin's `BACKING` map.
- Test: `server/test/single-definition.test.ts` — the stamp census (`:1389-1402` at `d759c914`) gains ONE line, and the install-record census (as wave 4 left it, `:1497-`) gains THREE (**corrected** — the skeleton said one each). The stamp line is `_ver_flip_back`'s. The record lines are `_ver_flip_back`'s, `_upd_restore_arm1`'s (the record cleared on a failed arm 1, D-3443) and `cmd_rollback`'s (the "nothing to do" arm reads it). All sit below `:1303`, so no line the session-hook audit cites there (`:32-37`, `:1274`, `:1303`) moves (ruling R13).
- Run, not edited: `server/test/compact-card-ship.test.ts` (`_upd_backup_set`'s pinned line is not touched), `server/test/macos-platform.test.ts` (no GNU-only spelling added; every flip goes through `_plat_ln_swap`, every file placement through `_plat_mv_notdir`), `server/test/ccrc-cli.test.ts` (no verb added; the `rollback` entry's first line is unchanged), `server/test/typecheck-tests.test.ts`.
- Not chased here: `server/test/session-hook.test.ts` (Task 9).

**Interfaces** (corrected against wave 4's committed plan and the tree at `d759c914`; each correction is listed at the end of this task):
- `CCRC_CAP_WORDS=(verify node-id floor update-json update-gate rollback versions)`; `CCRC_CAP_WORDS_LINUX=(detach)` unchanged; `_ccrc_cap_words` and `_inst_caps` unchanged (data only).
  - `~/.ccrc/ccrc-caps` after a W6 install, Linux: `os linux\nverify\nnode-id\nfloor\nupdate-json\nupdate-gate\nrollback\nversions\ndetach\n`; Darwin: the same without `detach`.
  - The transcript line: `install: caps: verify node-id floor update-json update-gate rollback versions detach (os linux; …)`.
  - `--check` prints `caps=verify,node-id,floor,update-json,update-gate,rollback,versions,detach`.
  - Every word still matches W2's `CAP_WORD = /^[a-z][a-z0-9-]{0,31}$/`, and the list stays under `MAX_CAP_WORDS = 32`.
  - The presence pin's new row: `versions` → `_upd_restore_arm1() {` and `_ver_flip_back() {` both present.
- `_ver_kept <name> <role>` → rc 0 complete; rc 1 absent (no REAL directory `$BOX_VERSIONS_ROOT/<name>` — a symlink of that name is absent too), `VER_WHY` `no kept version <name> under $HOME/ccrc-versions`; rc 2 incomplete, `VER_WHY` the first missing piece, in this order:
  - `no ccd/ccrc`;
  - `no server build` (roles `server|both`; `server/dist/server/src/index.js`) or `no agent build` (role `fleet`; `agent/dist/agent/src/index.js`);
  - `no kept stamp`;
  - `no kept install record`;
  - `its kept stamp does not parse`;
  - `its kept stamp reads <v|an unversioned build>, not <name>` (tag-shaped names only; `_box_build_fields "$vdir/$VER_STAMP_COPY"`, saving and restoring `BOX_BUILD`).
  An empty role reads `both`, the staged spine's own default. Prints nothing.
- `_ver_can_flip` → rc 0 when this box can make the `~/ccrc` flip; rc 1 on Darwin with no `python3` on PATH, `VER_WHY` `python3 is not on PATH — on macOS the $HOME/ccrc flip is one rename(2) through os.replace; install the Xcode Command Line Tools: xcode-select --install` (**added**, D-3419 amended). Builtins only (`[`, `command -v`), so it answers on any PATH. Two flips run in the `cmd_update`/`cmd_rollback` PARENT, where no spine preflight has run: `_ver_flip_back`'s and `_upd_legacy_target`'s. Each asks it before anything moves, so a missing python3 is named instead of surfacing as `the one rename … failed` or a bare `could not give …`. Every other flip runs inside a W6 spine, whose `cmd_install` Darwin preflight names python3 first (Task 2). It is not a verb-level probe: that would refuse a Darwin `ccrc update` that makes no flip at all, such as a `directory` box moving to an older spine, or `--check`, which moves nothing.
- `_ver_flip_back <name> <role> <prefix>` → rc 0 when `~/ccrc` points at `<name>` and the kept version's own spine COMPLETED (the completed-install record present after it — a trailing doctor FAIL with the record written is a completed spine, D-3114's reading). rc 1 when nothing changed (`VER_WHY`). rc 2 when it flipped but the spine did not complete (`VER_WHY`; `~/ccrc` stays on `<name>`, and the box reads `incomplete`, which is true). Steps (D-3439):
  1. `_ver_can_flip`, first, before anything is read; rc 1 → rc 1 (its `VER_WHY`). Then `_ver_kept "$name" "$role"`; rc 1 → rc 1 (its `VER_WHY`); rc 2 → rc 1, `VER_WHY` `$HOME/ccrc-versions/<name> is incomplete (<why>)`.
  2. `_plat_ln_swap "$BOX_VERSIONS_ROOT/<name>" "$BOX_TREE_DIR"`; failure → rc 1, `VER_WHY` `the one rename that points $HOME/ccrc at $HOME/ccrc-versions/<name> failed`.
  3. Restore `$VER_STAMP_COPY` over `$BOX_STAMP_FILE` (tmp + `chmod 644` + `_plat_mv_notdir`; the stamp is named through ONE `local stamp="$BOX_STAMP_FILE"` line), for a spine too old to stamp from its kept copy itself. Then CLEAR the record and the caps file (`rm -f -- "$rec" "$BOX_CAPS_FILE"`, the record named through ONE `local rec="$BOX_INSTALLED_FILE"` line) — **corrected**: the skeleton restored the kept record here, but a record written before the spine makes "present after it" true for a spine that never ran. The kept record reaches `~/.ccrc/installed` through the spine's own `_inst_installed`, byte-equal to the kept copy, because the verified flag below is derived from that copy.
  4. The spine: `bash "$BOX_TREE_DIR/ccd/ccrc" install`, plus `--role <role>` when the role is non-empty (**corrected**: an empty role runs it bare, as `cmd_update`'s own spine array does — `--role ""` is a usage error). Env `(env -u CCRC_UPDATE_LOCK_HELD CCRC_UPDATE_VERIFIED=1)` when the kept record's line 2 is not `unsigned`, else `(env -u CCRC_UPDATE_LOCK_HELD -u CCRC_UPDATE_VERIFIED)`. The lock descriptor is closed exactly as wave 4's staged spine closes it: `( exec {UPD_LOCK_FD}>&-; exec "${spine_env[@]}" "${spine[@]}" ) || src=$?` when `UPD_LOCK_FD` is set, bare when it is not.
  5. stdout, before the spine: `<prefix>: flip: $HOME/ccrc -> $HOME/ccrc-versions/<name> (one rename); its kept stamp restored — running its own spine: bash $HOME/ccrc/ccd/ccrc install[ --role <role>]`; after a completed spine: `<prefix>: flip: $HOME/ccrc -> $HOME/ccrc-versions/<name>; its stamp and install record restored; its own spine re-placed the executables, hooks and units (no release download)`, preceded, when the spine exited non-zero with its record written, by `<prefix>: flip: <name>'s spine completed (its record is written) but its trailing doctor exited <rc> — the FAIL lines above are the box's health; the gate decides`. rc 2's `VER_WHY`: `its own spine exited <rc> without writing its completed-install record`.
  Called only from the main shell, never inside `$(…)`.
- `_upd_restore <role> <reason>` (wave 4's signature, unchanged) → `_upd_phase restoring "<reason>"`, then arm 1, falling to arm 2, falling to arm 3; returns 0 (the caller exits 4); still never calls `_upd_sweep`.
- `_upd_restore_arm1 <role> <reason>` → rc 0 restored, rc 1 fall to arm 2. In order:
  - Before any flip, each refusal is one stdout line, rc 1, nothing changed:
    - `_upd_read_previous`: rc 1 → `update: arm 1: no ~/.ccrc/previous — arm 2`; rc 2 → `update: arm 1: the previous build carried no tag — arm 2`; rc 3 → `update: arm 1: ~/.ccrc/previous is unreadable or malformed — arm 2`.
    - `_ver_layout` not `linked|migrated` → `update: arm 1: $HOME/ccrc is not versioned (<layout>) — arm 2`.
    - `_ver_kept` rc 1 → `update: arm 1: no kept version <prev> under $HOME/ccrc-versions — arm 2`; rc 2 → `update: arm 1: $HOME/ccrc-versions/<prev> is incomplete (<VER_WHY>) — arm 2`.
  - `VER_CURRENT = UPD_PREV_TAG` is NOT a refusal (D-3445; **corrected** — the draft sent it to arm 2). It is the shape a W6 staged spine leaves when it dies inside `_inst_tree` BEFORE its flip, for instance its `npm ci` in `~/ccrc-versions/<new>/server`, which is the verb's most likely failure. Wave 4's `_upd_step_moved` reads an `_inst_tree` death as moved, so the gate runs and fails on the version while `~/ccrc` never left `<prev>`. Arm 2 would then re-download `<prev>`, and that child's W6 spine takes Task 2's same-name path (D-3426): it voids the RUNNING version's kept record, rsyncs `--delete` into the directory the live units execute from, and runs `npm ci` there, which empties its `node_modules` before it fetches. With the registry still down, arm 3 then restarts a unit whose tree has no deps, so a harmless failed placement becomes a box that cannot start. In place, `_ver_flip_back`'s rename is onto the target the link already names (one idempotent rename), and the kept spine runs from that physical version, which is Task 2's `running` answer with its kept record present: no copy, no `npm ci` (D-3427). It still needs `_ver_kept` rc 0, and it falls to arm 2 only when it fails.
  - Then stdout `update: arm 1: <prev> is kept at $HOME/ccrc-versions/<prev> — flipping back to it (no download)`, or, in place, `update: arm 1: $HOME/ccrc still points at <prev>, which is kept complete — re-running its own spine in place (no download)`; then `_ver_flip_back "$UPD_PREV_TAG" "$role" update`, then `_upd_gate "$role" "$UPD_PREV_TAG"` ("run the gate once more" — `_upd_gate` is the one writer of `checking`, so the report reads `…, checking, restoring, checking, reverted`). **Added:** `_upd_gate` rewrites `UPD_GATE_WHY`, and `cmd_update`'s exit-4 sentence, printed AFTER `_upd_restore` returns (wave 4 Task 5/6: `… did not come back healthy on it ($UPD_GATE_WHY) — exit 4 …`), names the FIRST gate's failure. So arm 1 saves `UPD_GATE_WHY` on entry and puts it back after its re-gate, on both results (D-3444); the re-gate's own answer is read into `why` first.
  - `_ver_flip_back` rc 1 → `update: arm 1: could not flip to <prev> (<VER_WHY>) — nothing changed; arm 2`, rc 1.
  - Success → `_upd_phase reverted "arm1: flipped back to <prev>; <reason>"`, stdout `update: REVERTED (arm 1): this box runs <prev> again — $HOME/ccrc flipped back to $HOME/ccrc-versions/<prev>, no download — <reason>`, rc 0. In place: detail `arm1: restored <prev> in place; <reason>`, stdout `update: REVERTED (arm 1): this box runs <prev> again — $HOME/ccrc never left $HOME/ccrc-versions/<prev>; its own spine re-ran, no download — <reason>`.
  - `_ver_flip_back` rc 2, or a failed gate (D-3443) → `_plat_ln_swap` back to the saved `VER_CURRENT`, so arm 2's child is the NEW tree's `ccd/ccrc`, as wave 4's arm 2 assumes; then the completed-install record is REMOVED (**corrected**: the skeleton left the stamp and record "as arm 1 restored them", but a completed kept spine leaves `<prev>`'s stamp and `<prev>`'s record agreeing, and arm 2's child `update --to <prev>` then reads the box converged, `_upd_converged` rc 0, and installs nothing while `~/ccrc` names the new version). Stdout `update: arm 1 failed (<the spine did not complete: <why>|gate: <UPD_GATE_WHY>>) — $HOME/ccrc points at <new> again; falling to arm 2`, rc 1; a failed rename-back or `rm` is named in that same line. In place there is nothing to point back to: no rename, and the line reads `… — $HOME/ccrc stays on <prev>, which it never left; falling to arm 2`. The record is still removed, so arm 2's child re-installs `<prev>` rather than reading it converged.
- `_upd_restore_arm3` (wave 4's) gains one step after its record removal and before its first copy, only when `_ver_layout` reads `linked|migrated`: `rm -f -- "$BOX_TREE_DIR/$VER_RECORD_COPY"`, and stdout `update: arm 3: $HOME/ccrc-versions/<current> is where the copy lands, so it will hold a MIXED tree — its kept install record is removed first, so no flip returns to it` (D-3441; **corrected wording**: the void runs before the copy, as D-3260's removal does, so "now holds" would be said before it is true). A failed `rm` appends ` (the kept install record of <current> could not be removed)` to arm 3's `reverted` detail through its `unrec` note.
- `_upd_legacy_target <tag>` → rc 0 or dies (D-3440). `cmd_update` calls it after `_upd_backup`, `_upd_write_previous` and `UPD_PREV_UNSIGNED`'s capture, and BEFORE it clears the record, the install-step marker and the caps — so its refusal leaves all three as they were. It is called only when all of these hold:
  - `! grep -q '^BOX_VERSIONS_ROOT=' "$UPD_TREE/ccd/ccrc"`;
  - `_ver_layout` reads `linked|migrated`;
  - `VER_CURRENT != <tag>` (a same-name older spine writes in place, D-3426).
  Its steps:
  0. `_ver_can_flip`, before anything else; rc 1 → die (the refusal below, suffixed ` (<VER_WHY>)`) (**added**).
  1. A symlink, or a non-directory, at `$BOX_VERSIONS_ROOT/<tag>` → die (the refusal below, suffixed ` ($HOME/ccrc-versions/<tag> is not a directory ccrc placed)`). Measured by its own case, with a symlink into another directory and with a regular file (**added**).
  2. A real directory there (the kept one): remove its `$VER_RECORD_COPY` FIRST — its content is about to be rewritten by a spine that keeps nothing, so it stops claiming completeness until `_ver_keep_state update` re-marks it after that spine completes (**added**).
  3. Otherwise `cp -a -- "$BOX_VERSIONS_ROOT/$VER_CURRENT" "$BOX_VERSIONS_ROOT/.<tag>.incoming.$$"`, remove `$VER_STAMP_COPY` and `$VER_RECORD_COPY` inside it (they described the source), `mv -- …incoming… "$BOX_VERSIONS_ROOT/<tag>"`; the `.incoming` directory is removed on any failure.
  4. `_plat_ln_swap "$BOX_VERSIONS_ROOT/<tag>" "$BOX_TREE_DIR"`; on failure a directory step 3 made is removed.
  5. stdout `update: tree: <tag>'s spine predates versioned installs and writes through $HOME/ccrc — $HOME/ccrc now points at $HOME/ccrc-versions/<tag> (<kept|a copy of <cur>>) for it to write into`.
  6. Every failure dies `could not give <tag>'s older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at <cur>` (a `failed` report through `_ccrc_die`'s hook).
- `cmd_update`: `_ver_keep_state update` after the inst_rc branch, before the gate. It is silent unless the record is present (inst_rc 0, or D-3114's doctor-FAIL arm; a spine that died wrote none), idempotent after a W6 spine's own `_inst_installed` call, and the only writer of the kept copies for an older spine.
- `cmd_update`'s layout refusal (**added**, D-3429 amended), on the line after Task 3's first `_inst_migrate_resume update`: `_ver_layout`; `foreign|unreadable` → `_ccrc_die "update: \$HOME/ccrc is $VER_WHY — refusing to place or flip a tree over something this ccrc did not make; nothing was downloaded or installed, and \$HOME/ccrc and \$HOME/ccrc-versions were not touched"` (a `failed` report through the hook; the lock is released by the exit). Every other layout passes: `crashed` was completed by the resume on the line above, and `absent|directory|linked|migrated` are what the spine handles. Without it the refusal is left to the staged W6 spine's `_inst_tree`, which dies AT `_inst_tree`, and `_upd_step_moved` reads that as moved. The gate then fails on the version and the restore arms run over the foreign link. Arm 1 refuses (`not versioned (foreign)`). Arm 2's child is whatever `ccd/ccrc` the link names, or an older release's spine, which has no refusal and, because `_upd_legacy_target` is never called on a foreign layout, rsyncs `--delete` THROUGH the link. Arm 3 copies the backup through it as well. The refusal runs before the old-identity read, `_upd_backup` and every download, so Task 2's "not touched" holds on the update path, the one most boxes reach this code by.
- `cmd_rollback` (wave 4's argv, refusals, target resolution and `--detach` unchanged):
  - The existence check: wave 4's `curl` probe stays first (the gate needs `curl` on either arm). The role is read as `cmd_update` reads it (`CCRC_ROLE` from `ccrc.env`, `-f`/`-r` guarded, anything but `server|fleet|both` → `""`). The same `_ver_layout` `case` refuses `foreign|unreadable` with `_ccrc_die "rollback: \$HOME/ccrc is $VER_WHY — refusing to place or flip a tree over something this ccrc did not make; nothing on this box was changed"` (**added**). That is before the lock, so no report is written, before the release-host question, so nothing is asked, and before `--detach`, so the operator sees the refusal rather than a child they are not watching. `cmd_update`'s own refusal would also catch the re-install arm. When `_ver_layout` reads `linked|migrated` and `_ver_kept <tag> <role>` is rc 0, `_upd_asset_listed` is SKIPPED, with stdout `rollback: <tag> is kept at $HOME/ccrc-versions/<tag> — no release-host question and no download` (D-3442). Otherwise wave 4's existence question runs as written. **Added (Task 3's review, D-3437):** above that `_ver_layout`, a `crashed` layout is completed first — `_inst_migrate_resume rollback` when `_upd_lock_probe` answers 0 — then the layout is read again, so a crashed box's kept tag still reads kept and a `--detach` hands off to a launcher that can run. A held lock is left alone (the update holding it owns the link), and every other probe answer is refused later by `_upd_lock` or `_upd_detach` in its own words (ruling R16); nothing is folded.
  - `--detach` → wave 4's `_upd_detach rollback <tag> <from>`; the detached child re-enters this verb and takes the same arm.
  - The kept path, under `_upd_lock` and after `run_from` is chosen, in order:
    1. `VER_CURRENT = <tag>`, the stamp's version = `<tag>`, AND `cmp -s` finds `~/.ccrc/installed` byte-equal to the kept record (**corrected**: the skeleton's first two conditions alone answer "nothing to do" to D-3264's own rerun, `ccrc rollback --to <v>`, on a box whose kept spine died after `_inst_stamp`) → stdout `rollback: this box already runs <tag> ($HOME/ccrc points at $HOME/ccrc-versions/<tag> and its install completed) — nothing to do`; `_upd_unlock`; return 0; nothing written.
    2. Otherwise `UPD_FROM=<run_from>`, `UPD_VERSION=<tag>` (**added**: `_upd_rollback_no_restore` spells its detail and sentence from `UPD_VERSION`, which no `_upd_resolve` sets on this path), `UPD_REPORT_TARGET=<tag>`, `UPD_REPORTING=1`, `_inst_migrate_resume update`, `_upd_phase installing "rollback by flip to <tag>"`, and stdout `rollback: returning this box to <tag> (named by <via>; asked by --from <who>) — a flip of $HOME/ccrc to its kept version and its own spine, as --from <run_from>: below the floor if need be, and the floor itself is never lowered`.
    3. `_ver_flip_back <tag> <role> rollback`:
       - rc 1 → stdout `rollback: <tag> could not be flipped to (<VER_WHY>) — rolling back by re-install instead`, and wave 4's in-process `cmd_update --to <tag> --downgrade --from <run_from> [--allow-unsigned]` path runs as written — without the release-host existence question, which the kept arm skipped, so an unpublished tag there dies in `_upd_resolve` at exit 1, not 2.
       - rc 2 → `_upd_phase failed "rollback to <tag>: the kept spine did not complete; <VER_WHY>"`, `UPD_REPORTING=0`, then `_ccrc_die "rollback: $HOME/ccrc points at $HOME/ccrc-versions/<tag>, but its own spine did not complete (<VER_WHY>) — read its lines above; 'ccrc update --check' says where this box stands"`.
       - rc 0 → `_upd_gate "$role" "<tag>" || _upd_rollback_no_restore "gate: $UPD_GATE_WHY"` (D-3243: `failed: 'rollback to <tag>: gate: <why>'`, exit 1).
    4. A passed gate → `_inst_migrate_finish rollback "the health gate passed"` (**added**: a rollback's passed gate is a passed gate, D-3431), `_upd_phase restarting`, `_upd_unlock`, `_upd_sweep` (behind its `KillMode=process` preflight and DEGRADED sentences, never restated), `_upd_phase done "rolled back by flip to <tag>"`, and stdout `rollback: this box runs <tag> again — flipped back to $HOME/ccrc-versions/<tag>, no download`; return 0.
  - `previous` is never rewritten; the floor never lowers.
- `usage()`'s `rollback` entry ends: `[--from <who>] names the caller (${UPD_FROM_WORDS[*]}). A version kept under ~/ccrc-versions is rolled back to by a flip of ~/ccrc and its own spine, with no download.`
- Harness (`server/test/ccrc-update.test.ts`): `fixture-health-deny` — one version per line — makes the `/health` probe get no answer (curl exit 7) whenever the version the stub would answer (pin, else the STUB shim's version, else the box's stamp) is listed. `KEPT_SPINE` is a kept version's `ccd/ccrc` recorder: its argv, its `CCRC_UPDATE_VERIFIED`, `CCRC_UPDATE_LOCK_HELD` and whether it holds a descriptor on `~/.ccrc/update.lock` (Linux `/proc`; `unmeasured` elsewhere). It exits `fixture-kept-spine-exit` (default 0), and on 0 writes the kept record as `_inst_installed` would and loads the two main launchd jobs. `plantW6Box`, `keptVersion`, `onKeptV1` (one real FULL update onto v1.0.0, then a sentinel line appended to the kept `ccd/ccd`), `rollbackRun`, `linkOf`, `fileText`. The two sourced tables run through wave 4 Task 3's file-scope `sourcedCcrc(home, script)` (`. "$1"; <script>` with `$1` the checkout's `ccd/ccrc`, under `updateEnv(home)`), never a second declaration of it.
- Mutation rows (each measured in Step 7):
  - spec §18 "the gate restores" with arm 1 (arm 1 removed from `_upd_restore` → the kept-previous gate failure re-installs by arm 2; red).
  - D-3428 at the consumer (`_ver_flip_back`'s stamp restore neutered AND Task 2's `_inst_stamp_shipped` fallback deleted → the stamp stays the failed version's, `/health` stays denied, arm 1's gate fails; red — and the restore alone, neutered, reds the rollback-by-flip case, whose recorder spine stamps nothing, the pre-W6 shape).
  - D-3439 (the spine step deleted → no record is written after the flip, `_ver_flip_back` answers rc 2; the arm-1 case falls to arm 2 and the rollback case exits 1 with no `kept-spine-argv`; red).
  - D-3443, two rows: the flip-back deleted (the restore child reinstalls in place, and on the arm-3 box the void lands on the kept version; red), and the record clear deleted (the restore child reads the box converged on v1.0.0 and installs nothing; red).
  - D-3440, three rows: the call deleted (the older spine's write lands in the version it replaces, whose `treeDigest` changes; red); the kept-branch void deleted (the older spine is handed a directory that still claims completeness; red); the call moved below the record's removal (a refused legacy target leaves no record; red).
  - D-3441 (the `rm` neutered → the MIXED version keeps `.ccrc-installed`, and a following rollback to it flips instead of refusing; red).
  - D-3442 (the kept check neutered → the `fixture-release-http 404` box refuses a kept tag at exit 2; red).
  - D-3428 at the writer (`_ver_keep_state update` deleted → an older spine's directory is never re-marked complete; red).
  - The verified flag, both directions; the lock descriptor's closure; the already-there record check; D-3243 on the kept path and `UPD_VERSION` on it; the caps word; one row per arm-1 refusal guard and `_ver_kept`'s stamp-version check.
  - D-3444 (the restore after a passing re-gate neutered → `cmd_update`'s exit-4 sentence names arm 1's PASS measurement, `… answers v1.0.0`, as the reason v2.0.0 was unhealthy; red).
  - spec §18 "a standalone rollback sweeps behind the preflight" at the kept path's OWN `_upd_sweep` call (**added**: wave 4 measured its row where `cmd_rollback` reached the sweep only through `cmd_update`; the flip path is a second call site and needs its own row — deleted → `restartAt` -1 on Linux; red).
  - D-3445 (the in-place arm put back as the draft's refusal → the `_inst_tree` death re-downloads v1.0.0 through arm 2, whose in-place rsync strips the kept `ccd/ccd`'s sentinel; red).
  - D-3429 as amended, two rows: `cmd_update`'s refusal neutered (the run goes on past it, and the STUB spine writes through the link; red) and `cmd_rollback`'s (the rollback asks the release host and refuses at exit 2; red).
  - D-3419 as amended, three rows: `_ver_can_flip`'s Darwin test neutered, its call in `_ver_flip_back` deleted, its call in `_upd_legacy_target` deleted (each reds its own row of the sourced macOS case).
  - `_upd_legacy_target`'s symlink/non-directory refusal neutered (the symlinked case writes through into the other directory; the regular-file case dies without the suffix; red).

- [ ] **Step 1: Confirm the substrate, and a green baseline**

Wave 4 and Tasks 1–3 are this task's substrate. From the repo root:

```bash
grep -cE '^(_plat_ln_swap|_ver_layout|_inst_version_name|_ver_keep_state|_inst_migrate|_inst_migrate_resume|_inst_migrate_finish|_ver_lock_try|_inst_doctor_tail|_upd_restore|_upd_restore_arm2|_upd_restore_arm3|_upd_read_previous|_upd_gate|_upd_lock|_upd_unlock|_upd_marker_unsigned|_upd_asset_listed|_upd_rollback_no_restore|cmd_rollback|_ccrc_cap_words)\(\) \{' ccd/ccrc
grep -cE '^(BOX_VERSIONS_ROOT|BOX_MIGRATING_DIR|BOX_MIGRATION_FILE|VER_NAME_RE|VER_STAMP_COPY|VER_RECORD_COPY)=' ccd/ccrc
grep -c '^CCRC_CAP_WORDS=(verify node-id floor update-json update-gate rollback)$' ccd/ccrc
grep -c '^  _upd_restore_arm2 "\$reason" && return 0$' ccd/ccrc
grep -c "^  echo \"update: arm 3: copying this run's pre-update backup" ccd/ccrc
grep -c '^  _upd_marker_unsigned && UPD_PREV_UNSIGNED=1$' ccd/ccrc
grep -c '^  # ── THE HEALTH GATE (design §11)' ccd/ccrc
grep -c '^  _upd_asset_listed "\$to" SHA256SUMS || erc=\$?$' ccd/ccrc
grep -c '^  local run_from=rollback$' ccd/ccrc
grep -c 'names the caller (\${UPD_FROM_WORDS\[\*\]})$' ccd/ccrc
grep -c '^export function installVersionedTree' server/test/installTreeFixture.ts
grep -cE '^const (reportWrites|lastReport|CAPS_NOW) ' server/test/ccrc-update.test.ts
grep -c '  build="\$(jq -c . "\$HOME/.ccrc/build.json" 2>/dev/null)" || build=null' server/test/ccrc-update.test.ts
grep -c 'CAPS_W4_' server/test/ccrc-install.test.ts
grep -c '^  symlinkSync, readlinkSync,$' server/test/ccrc-update.test.ts
grep -c "^import { installVersionedTree } from './installTreeFixture.js';$" server/test/ccrc-update.test.ts
grep -c '^function sourcedCcrc(home: string, script: string): Result {$' server/test/ccrc-update.test.ts
```

Expected, in order: `21`, `6`, `1`, `1`, `1`, `1`, `1`, `1`, `1`, `1`, `1`, `3`, `1`, `5`, `1`, `1`, `1`. Any other count: stop. The task that line depends on has not landed in the shape this body was written against, and a body written against a guess is not this task. (The fourteenth is wave 4 Task 13's five lines: the two declarations, `CAPS_HERE`, the both-arms loop and the presence pin's `toEqual`. The last three are Task 2 Step 3 (e)'s two import edits and wave 4 Task 3's one `sourcedCcrc`, which this task calls and never redeclares.)

Then run the three files this task edits, each from inside `server/`, in the foreground (timeout ≥ 600000 ms), and write down each file's `passed | skipped` counts:

```bash
cd server
./node_modules/.bin/vitest run test/ccrc-update.test.ts
./node_modules/.bin/vitest run test/ccrc-install.test.ts
./node_modules/.bin/vitest run test/single-definition.test.ts
```

Expected: all three PASS. A red here is Tasks 1–3's, not this task's; stop and report it.

- [ ] **Step 2: The harness — a `/health` that follows the stamp, the imports, and the fixture block**

**(a) `fixture-health-deny`.** In `healthyBox`'s combined curl (`grep -n "THE COMBINED CURL" server/test/ccrc-update.test.ts`), wave 4 Task 5's `/health` block computes `v` and then builds the body. Immediately BEFORE its line

```ts
    '  build="$(jq -c . "$HOME/.ccrc/build.json" 2>/dev/null)" || build=null; [ -n "$build" ] || build=null',
```

insert:

```ts
    // W6 Task 4: `fixture-health-deny` (one version per line) is a server that
    // never comes up on THAT build — the probe gets no answer, curl's exit 7 —
    // whenever the version this stub would answer is listed. Unlike a pin it
    // FOLLOWS the box: with no pin it answers what the stamp says, so a flip
    // back that restores the kept stamp is what makes the next probe answer.
    '  if [ -n "$v" ] && [ -f "$HOME/fixture-health-deny" ] && grep -qxF -- "$v" "$HOME/fixture-health-deny"; then echo "curl: (7) Failed to connect to ${url#http://}" >&2; exit 7; fi',
```

Doctor's `_check_build` asks the same URL, and it SKIPs on a curl failure (`ccd/ccrc-doctor-checks:4155-4160` at `d759c914`: `no server answered /health … (curl exited <rc>)`, rc 3), so a denied version fails no spine's doctor tail.

**(b) The imports — nothing to add.** Task 2 Step 3 (e) already put `readlinkSync` in the `node:fs` import (`  symlinkSync, readlinkSync,`) and added `import { installVersionedTree } from './installTreeFixture.js';`; Step 1's fifteenth and sixteenth counts measured both. Every other name the block below uses (`appendFileSync`, `chmodSync`, `copyFileSync`, `existsSync`, `mkdirSync`, `readdirSync`, `readFileSync`, `rmSync`, `symlinkSync`, `writeFileSync`, `spawnSync`, `join`, the `Result` interface, `BASH`, `REPO`) is in the file at `d759c914`. Do not add a second import of any of them.

**(c) `CAPS_NOW`.** Replace wave 4 Task 13's constant and its docstring (`grep -n '^const CAPS_NOW' server/test/ccrc-update.test.ts`):

```ts
/** The words THIS ccrc can do (`_ccrc_cap_words`), as `--check` joins them:
 *  W1's three and W4's four, `detach` on Linux only (decision 17). A literal,
 *  not a read of ccd/ccrc — a pin derived from the list it pins cannot red. */
const CAPS_NOW = process.platform === 'darwin'
  ? 'verify,node-id,floor,update-json,update-gate,rollback'
  : 'verify,node-id,floor,update-json,update-gate,rollback,detach';
```

with:

```ts
/** The words THIS ccrc can do (`_ccrc_cap_words`), as `--check` joins them:
 *  W1's three, W4's four and W6's `versions`, `detach` on Linux only
 *  (decision 17). A literal, not a read of ccd/ccrc — a pin derived from the
 *  list it pins cannot red. */
const CAPS_NOW = process.platform === 'darwin'
  ? 'verify,node-id,floor,update-json,update-gate,rollback,versions'
  : 'verify,node-id,floor,update-json,update-gate,rollback,versions,detach';
```

Then sweep for any other literal this ccrc's words are compared against, in both spellings a suite uses (a joined `update-gate,rollback` and a quoted array `'update-gate', 'rollback'`, as wave 4 Task 13's own sweep spelled its pattern): `grep -rnE "update-gate[\"'\\\\n, ]+rollback" server/test agent/test pwa/src shared | grep -v versions`. Each hit that compares against what THIS ccrc's `_ccrc_cap_words` prints or `_inst_caps` writes moves in this commit (Step 3 (d) moves `ccrc-install.test.ts`'s). A hit that is a remote or server-side node's data stays: `ccrc-rollout.test.ts`'s stub boxes, and W2's inventory fixtures.

**(d) The fixture block.** Append at the end of `server/test/ccrc-update.test.ts`:

```ts
// ── W6 Task 4: kept versions, the flip back, and an older spine's directory ─
// Arm 1 and a rollback by flip act on a VERSIONED box: `~/ccrc` a link into
// `~/ccrc-versions/<tag>`, with the tag it returns to kept complete beside it.
// Two ways to plant one, deliberately. FULL (`onKeptV1`): a real first
// `ccrc update` onto v1.0.0, so the kept version is one THIS code placed and
// kept, and the spine a flip back runs is the real one. STUB: Task 2's
// `installVersionedTree`, with the kept version's own `ccd/ccrc` swapped for
// `KEPT_SPINE` — the flip's mechanics (argv, the verified flag, the lock
// descriptor) measured without re-running the spine `ccrc-install.test.ts`
// owns.
const V1_SHA = '1'.repeat(40);
const V2_SHA = '2'.repeat(40);
/** A line no release ships, appended to the KEPT v1.0.0's `ccd/ccd`: a
 *  `~/.local/bin/ccd` carrying it can only have come from that version's own
 *  spine — v2.0.0's spine and both restore arms place a release's ccd. */
const CCD_SENTINEL = "# fixture: v1.0.0's own ccd, as this box kept it\n";

/** A kept version's own `ccd/ccrc`, standing in for its spine. Records its
 *  argv; whether it was told the version is verified; whether it was handed
 *  the lock marker; and whether it holds a descriptor on
 *  `~/.ccrc/update.lock` — read off `/proc` on Linux, `unmeasured` elsewhere.
 *  Exits `fixture-kept-spine-exit` (default 0). On 0 it writes the
 *  completed-install record as `_inst_installed` would (the kept record, byte
 *  for byte) and loads the two main launchd jobs as `_inst_enable_darwin`
 *  would, so a Darwin gate has a job to sample. It stamps NOTHING — the shape
 *  of a spine older than W6, which cannot stamp from the kept copy. */
const KEPT_SPINE = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$0" "$@" > "$HOME/kept-spine-argv"',
  'fd=unmeasured',
  'if [ -d "/proc/$$/fd" ]; then',
  '  fd=closed; lock="$(cd "$HOME/.ccrc" && pwd -P)/update.lock"',
  '  for f in /proc/$$/fd/*; do [ "$(readlink "$f" 2>/dev/null)" = "$lock" ] && fd=inherited; done',
  'fi',
  'printf \'verified=%s held=%s lockfd=%s\\n\' "${CCRC_UPDATE_VERIFIED:-unset}" "${CCRC_UPDATE_LOCK_HELD:-unset}" "$fd" > "$HOME/kept-spine-env"',
  'printf \'app.ccrc.ccrc.plist\\napp.ccrc.ccrc-agent.plist\\n\' >> "$HOME/launchctl-loaded"',
  'code=0; [ -f "$HOME/fixture-kept-spine-exit" ] && IFS= read -r code < "$HOME/fixture-kept-spine-exit"',
  'if [ "$code" = 0 ]; then cp "$HOME/ccrc/.ccrc-installed" "$HOME/.ccrc/installed" || exit 1; fi',
  'exit "$code"',
].join('\n') + '\n';

const fileText = (p: string): string => readFileSync(p, 'utf8');
/** `~/ccrc`'s link value, or null when it is no link (or absent). */
const linkOf = (home: string): string | null => {
  try { return readlinkSync(join(home, 'ccrc')); } catch { return null; }
};

/** A W6 box on <name>: `~/ccrc -> ~/ccrc-versions/<name>` (Task 2's
 *  `installVersionedTree`, complete), the box's own stamp and record byte-equal
 *  to that version's kept copies, its floor at <name>, and — when a role is
 *  given — the `ccrc.env` `_inst_env` would have seeded. Returns the version. */
function plantW6Box(home: string, name: string, sha: string, role?: 'server' | 'fleet' | 'both'): string {
  const root = installVersionedTree(home, name, { stamp: { sha, version: name } });
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  copyFileSync(join(root, '.ccrc-stamp.json'), join(home, '.ccrc', 'build.json'));
  copyFileSync(join(root, '.ccrc-installed'), join(home, '.ccrc', 'installed'));
  writeFileSync(join(home, '.ccrc', 'floor'), `${name}\n`);
  if (role !== undefined) {
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), role === 'fleet'
      ? 'CCRC_ROLE=fleet\n'
      : `CCRC_ROLE=${role}\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n`);
  }
  return root;
}

/** A kept, complete, NOT linked version <name> whose own spine is
 *  `KEPT_SPINE`; `unsigned` makes its kept record the unverified two-line
 *  form. Returns the version root. */
function keptVersion(home: string, name: string, sha: string, opts: { unsigned?: boolean } = {}): string {
  const root = installVersionedTree(home, name, { link: false, stamp: { sha, version: name } });
  if (opts.unsigned === true) writeFileSync(join(root, '.ccrc-installed'), `${sha}\nunsigned\n`);
  writeFileSync(join(root, 'ccd', 'ccrc'), KEPT_SPINE, { mode: 0o755 });
  return root;
}

/** `ccrc rollback` from the CHECKOUT against the fixture box — wave 4's
 *  describe-local `runRollback`, at file scope because two of this task's
 *  describes need it. */
function rollbackRun(home: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Result {
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...updateEnv(home),
    TMPDIR: join(home, 'tmp'),
    CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
    CCRC_UPDATE_HEALTH_S: '0',
    ...extraEnv,
  };
  delete env['CCRC_UPDATE_LOCK_HELD'];
  replantDoctorStubs(home);
  const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', ...args], { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** One real (FULL) `ccrc update --to v1.0.0` on an old real-directory box —
 *  the migration (Task 3), the placement and the kept copies (Task 2) all
 *  THIS code's — then the sentinel appended to the kept `ccd/ccd`, and the
 *  recordings cleared so the case's own run is the only one they hold. */
function onKeptV1(prefix: string): string {
  const home = freshUpdateBox(prefix);
  plantOldBox(home, { version: 'v0.9.0' });
  packRelease(home, fullTree(home, { version: 'v1.0.0', sha: V1_SHA }), { tag: 'v1.0.0', latest: false });
  const r = runUpdate(home, ['--to', 'v1.0.0']);
  expect(r.code, `the first move onto v1.0.0 must complete — stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
  const v1 = join(home, 'ccrc-versions', 'v1.0.0');
  expect(linkOf(home), 'the first move did not leave ~/ccrc pointing at v1.0.0').toBe(v1);
  expect(existsSync(join(v1, '.ccrc-installed')), 'v1.0.0 was placed but not kept complete').toBe(true);
  appendFileSync(join(v1, 'ccd', 'ccd'), CCD_SENTINEL);
  for (const f of ['curl-argv', 'update-json-writes', 'systemctl-calls']) rmSync(join(home, f), { force: true });
  return home;
}
```

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts` → PASS, the same counts as Step 1. The block adds helpers and no case, and the deny knob is inert without its file.

- [ ] **Step 3: Write the failing tests**

**(a) Arm 1.** Append to `server/test/ccrc-update.test.ts`:

```ts
describe('ccrc update: restore arm 1 — a flip back to the kept previous version (W6 Task 4)', () => {
  const GATE_DENIED = 'gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)';
  const phasesOf = (home: string): string[] => reportWrites(home).map((w) => String(w['phase']));

  it('a FULL gate failure on a box whose previous version is kept restores by arm 1: ~/ccrc flipped back, that version\'s own spine re-run, the gate once more — no release URL of the previous tag, and the stamp, the record and ~/.local/bin/ccd are the kept version\'s (spec §11 arm 1; §18 "the gate restores", "the automatic restore does not sweep"; Review Focus 1)', () => {
    const home = onKeptV1('ccrc-update-arm1-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // The kept copies, measured BEFORE this case's run. The spine a flip
    // back runs is this checkout's own, and its `_inst_installed` ends in
    // `_ver_keep_state install`, which copies the box's stamp and record
    // over these two files: a box-vs-kept-copy comparison AFTER the run is
    // equal by construction, whatever the bytes (a verified version
    // re-recorded `unsigned` would pass it). The snapshot is the subject.
    const keptStamp = fileText(join(v1, '.ccrc-stamp.json'));
    const keptRec = fileText(join(v1, '.ccrc-installed'));
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    // v2.0.0's server never comes up; v1.0.0's does, once its stamp is back.
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\n');
    // A sweep that RAN would leave a try-restart: make one possible, so its
    // absence below is the restore's, not the preflight's.
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — GET http:\/\/127\.0\.0\.1:7788\/health got no answer \(curl exited 7\)$/m);
    expect(r.stdout).toContain('update: arm 1: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — flipping back to it (no download)');
    expect(r.stdout).toContain('update: flip: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.0; its stamp and install record restored; its own spine re-placed the executables, hooks and units (no release download)');
    expect(r.stdout).toMatch(/^update: gate: both answers on v1\.0\.0 /m);
    expect(r.stdout).toContain(`update: REVERTED (arm 1): this box runs v1.0.0 again — $HOME/ccrc flipped back to $HOME/ccrc-versions/v1.0.0, no download — ${GATE_DENIED}`);
    expect(r.stdout).not.toMatch(/^update: arm2|^update: arm 2|REVERTED \(arm [23]\)/m);
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(last['detail']).toBe(`arm1: flipped back to v1.0.0; ${GATE_DENIED}`);
    expect(last['target']).toBe('v2.0.0');
    // `_upd_gate` is the one writer of `checking`: "the gate once more" is a second one.
    expect(phasesOf(home).slice(-4)).toEqual(['checking', 'restoring', 'checking', 'reverted']);
    // No download of the tag it returned to: the run fetched v2.0.0 and nothing else.
    const urls = localUrls(home);
    expect(urls.length, 'the update fetched nothing at all — the control is broken').toBeGreaterThan(0);
    expect(urls.filter((u) => !u.startsWith(`local://${home}/releases/latest/download/`))).toEqual([]);
    // The flip, and the box's identity with it: the KEPT version's stamp
    // and record as they were before the run, and the kept copies unmoved.
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(keptStamp);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(keptRec);
    expect(fileText(join(v1, '.ccrc-stamp.json')), 'the kept stamp was rewritten').toBe(keptStamp);
    expect(fileText(join(v1, '.ccrc-installed')), 'the kept record was rewritten').toBe(keptRec);
    expect(fileText(join(home, '.local', 'bin', 'ccd'))).toBe(fileText(join(v1, 'ccd', 'ccd')));
    expect(fileText(join(home, '.local', 'bin', 'ccd'))).toContain(CCD_SENTINEL);
    // A return is not a new baseline, and the floor never lowers.
    expect(fileText(join(home, '.ccrc', 'previous'))).toBe(`v1.0.0\n${V1_SHA}\n`);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    if (process.platform !== 'darwin') {
      expect(fileText(join(home, 'systemctl-calls')), 'the automatic restore swept the supervisors').not.toMatch(/try-restart/);
    }
    // The exit-4 sentence names the FIRST gate's failure, not arm 1's passing
    // re-gate (D-3444).
    expect(r.stderr).toContain(`update: v2.0.0 was installed, but the box did not come back healthy on it (${GATE_DENIED.slice('gate: '.length)}) — exit 4.`);
  }, 60_000);

  it('a staged spine that dies inside _inst_tree BEFORE its flip leaves ~/ccrc on the previous version: arm 1 restores it IN PLACE — its kept stamp, its own spine, the gate once more — with no download, no npm ci in the running version, and that version byte-unchanged (D-3445)', () => {
    const home = onKeptV1('ccrc-update-arm1-in-place-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // A dependency the running version already holds. Arm 2's same-name
    // `npm ci` in v1.0.0 is what would empty this directory; the recorder npm
    // does not, so `npm-cwd` below is what measures that it never ran there.
    mkdirSync(join(v1, 'server', 'node_modules'), { recursive: true });
    writeFileSync(join(v1, 'server', 'node_modules', '.fixture-dep'), 'installed\n');
    const ccdBefore = treeDigest(join(v1, 'ccd'));
    const distBefore = treeDigest(join(v1, 'server', 'dist'));
    rmSync(join(home, 'npm-cwd'), { force: true });
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    // `npm ci` refuses in v2.0.0's new directory only (a registry hiccup,
    // the placement's likeliest failure); every other npm call records and
    // succeeds. Ahead of the recorder npm that `runUpdate` re-plants.
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'npm'), [
      '#!/bin/sh',
      'printf \'%s\\n\' "$PWD" >> "$HOME/npm-cwd"',
      'case "$PWD" in */ccrc-versions/v2.0.0/*) echo "fixture npm: registry unreachable" >&2; exit 1 ;; esac',
      'mkdir -p node_modules',
      'exit 0',
    ].join('\n') + '\n', { mode: 0o755 });
    const r = runUpdate(home, [], { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    // The spine died inside `_inst_tree`, before its flip: `~/ccrc` never moved.
    expect(r.stdout).not.toMatch(/^install: tree: \$HOME\/ccrc -> /m);
    expect(r.stdout).toContain('update: arm 1: $HOME/ccrc still points at v1.0.0, which is kept complete — re-running its own spine in place (no download)');
    // The kept spine ran FROM the running version: Task 2's `running` answer,
    // with its kept record present, so nothing was copied and no npm ci ran.
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    expect(r.stdout).toMatch(/^install: tree: v1\.0\.0 is complete \(its kept install record is present\) — no npm ci$/m);
    expect(r.stdout).toMatch(/^update: gate: both answers on v1\.0\.0 /m);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 1\): this box runs v1\.0\.0 again — \$HOME\/ccrc never left \$HOME\/ccrc-versions\/v1\.0\.0; its own spine re-ran, no download — spine died at _inst_tree; gate: /m);
    expect(r.stdout).not.toMatch(/^update: arm 2|REVERTED \(arm [23]\)/m);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm1: restored v1\.0\.0 in place; spine died at _inst_tree; gate: /);
    // No download of the tag it restored: the run fetched v2.0.0 and nothing else.
    const urls = localUrls(home);
    expect(urls.length, 'the update fetched nothing at all — the control is broken').toBeGreaterThan(0);
    expect(urls.filter((u) => !u.startsWith(`local://${home}/releases/latest/download/`))).toEqual([]);
    const npmDirs = fileText(join(home, 'npm-cwd')).split('\n').filter((l) => l !== '');
    expect(npmDirs.some((d) => d.includes('/ccrc-versions/v2.0.0/')), 'npm never ran in v2.0.0 — the control is broken').toBe(true);
    expect(npmDirs.filter((d) => d.includes('/ccrc-versions/v1.0.0')), 'npm ran in the running version').toEqual([]);
    // The running version is the one it was: its tree, its deps, its kept record.
    expect(linkOf(home)).toBe(v1);
    expect(treeDigest(join(v1, 'ccd')), 'an in-place rsync rewrote the running version').toEqual(ccdBefore);
    expect(treeDigest(join(v1, 'server', 'dist'))).toEqual(distBefore);
    expect(fileText(join(v1, 'server', 'node_modules', '.fixture-dep'))).toBe('installed\n');
    expect(existsSync(join(v1, '.ccrc-installed')), 'the running version stopped claiming completeness').toBe(true);
    expect(fileText(join(home, '.local', 'bin', 'ccd'))).toContain(CCD_SENTINEL);
  }, 60_000);

  it('arm 1 whose own gate fails points ~/ccrc back at the new version and clears the record; arm 3 then voids THAT version\'s kept record, so no later flip returns to its MIXED tree (D-3443, D-3441)', () => {
    const home = onKeptV1('ccrc-update-arm1-fails-arm3-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    const v2 = join(home, 'ccrc-versions', 'v2.0.0');
    // v1.0.0 is no longer published, so arm 2 refuses and arm 3 runs.
    rmSync(join(home, 'releases', 'download', 'v1.0.0'), { recursive: true, force: true });
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\nv1.0.0\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toContain('update: flip: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.0; its stamp and install record restored');
    expect(r.stdout).toContain(`update: arm 1 failed (${GATE_DENIED}) — $HOME/ccrc points at v2.0.0 again; falling to arm 2`);
    expect(r.stdout).toMatch(/^update: arm2-refused: v1\.0\.0 ships no bundle — /m);
    expect(r.stdout).toContain('update: arm 3: $HOME/ccrc-versions/v2.0.0 is where the copy lands, so it will hold a MIXED tree — its kept install record is removed first, so no flip returns to it');
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm3: tree MIXED, deploy\.sh is the remedy; gate: /);
    expect(linkOf(home)).toBe(v2);
    expect(existsSync(join(v2, '.ccrc-installed')), 'the MIXED version still claims completeness').toBe(false);
    expect(existsSync(join(v1, '.ccrc-installed')), 'the void landed on the kept version').toBe(true);
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    // …and no flip returns to it: v2.0.0 is no kept version now, so a rollback
    // to it asks the release host — which never published download/v2.0.0/ —
    // and refuses at exit 2, before anything moves.
    const rb = rollbackRun(home, ['--to', 'v2.0.0']);
    expect(rb.code, `stderr: ${rb.stderr}\nstdout: ${rb.stdout}`).toBe(2);
    expect(rb.stderr).toMatch(/^ccrc: rollback: v2\.0\.0 is not a published release \(its SHA256SUMS answered 404\)/m);
    expect(rb.stdout).not.toMatch(/is kept at/);
    expect(linkOf(home)).toBe(v2);
  }, 60_000);

  it('arm 1 whose own gate fails hands arm 2 the NEW tree and a box that reads incomplete: the restore child re-installs v1.0.0 and its spine flips ~/ccrc off v2.0.0 — it cannot no-op on the stamp and record arm 1 restored (D-3443)', () => {
    const home = onKeptV1('ccrc-update-arm1-fails-arm2-');
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\nv1.0.0\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toContain(`update: arm 1 failed (${GATE_DENIED}) — $HOME/ccrc points at v2.0.0 again; falling to arm 2`);
    expect(r.stdout).toMatch(/^update: arm 2: re-installing v1\.0\.0 \(the build this box ran before\)/m);
    // The child's staged spine found ~/ccrc on v2.0.0 and a v1.0.0 to place.
    expect(r.stdout).toContain('install: tree: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.0 (was $HOME/ccrc-versions/v2.0.0) — one rename');
    expect(r.stdout).not.toMatch(/^update: this box already runs v1\.0\.0/m);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 2\): this box runs v1\.0\.0 again, re-installed from its release — gate: /m);
    expect(lastReport(home)['phase']).toBe('reverted');
    expect(String(lastReport(home)['detail'])).toMatch(/^arm2: restored v1\.0\.0; gate: /);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
  }, 60_000);

  it('arm 1 refuses BEFORE any flip, naming why, and falls to arm 2: no previous, an untagged or malformed one, a box not versioned, one already on a previous tag that is not kept complete (on one that is, arm 1 restores in place — the FULL case above), a previous with no kept or an incomplete kept version (the arm, sourced)', () => {
    const prev = (h: string, body: string): void => writeFileSync(join(h, '.ccrc', 'previous'), body);
    const rows: Array<{ what: string; plant: (h: string) => void; says: string }> = [
      { what: 'no previous',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); keptVersion(h, 'v1.0.0', V1_SHA); },
        says: 'update: arm 1: no ~/.ccrc/previous — arm 2' },
      { what: 'untagged previous',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); keptVersion(h, 'v1.0.0', V1_SHA); prev(h, `untagged\n${V1_SHA}\n`); },
        says: 'update: arm 1: the previous build carried no tag — arm 2' },
      { what: 'malformed previous',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); keptVersion(h, 'v1.0.0', V1_SHA); prev(h, 'three\n'); },
        says: 'update: arm 1: ~/.ccrc/previous is unreadable or malformed — arm 2' },
      { what: 'a real-directory box',
        plant: (h) => { plantOldBox(h, { version: 'v2.0.0' }); prev(h, `v1.0.0\n${V1_SHA}\n`); },
        says: 'update: arm 1: $HOME/ccrc is not versioned (directory) — arm 2' },
      { what: 'already on a previous tag that is not kept complete',
        plant: (h) => {
          rmSync(join(plantW6Box(h, 'v1.0.0', V1_SHA), '.ccrc-installed'));
          prev(h, `v1.0.0\n${V1_SHA}\n`);
        },
        says: 'update: arm 1: $HOME/ccrc-versions/v1.0.0 is incomplete (no kept install record) — arm 2' },
      { what: 'no kept version',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); prev(h, `v1.0.0\n${V1_SHA}\n`); },
        says: 'update: arm 1: no kept version v1.0.0 under $HOME/ccrc-versions — arm 2' },
      { what: 'an incomplete kept version',
        plant: (h) => {
          plantW6Box(h, 'v2.0.0', V2_SHA);
          rmSync(join(keptVersion(h, 'v1.0.0', V1_SHA), '.ccrc-installed'));
          prev(h, `v1.0.0\n${V1_SHA}\n`);
        },
        says: 'update: arm 1: $HOME/ccrc-versions/v1.0.0 is incomplete (no kept install record) — arm 2' },
    ];
    for (const row of rows) {
      const home = freshUpdateBox('ccrc-update-arm1-refuse-');
      row.plant(home);
      const link = linkOf(home);
      // Wave 4 Task 3's file-scope `sourcedCcrc(home, script)`: one script string.
      const r = sourcedCcrc(home, 'rc=0; _upd_restore_arm1 both "gate: fixture" || rc=$?; echo "rc=$rc"');
      const said = r.stdout.split('\n').filter((l) => /^(update: |rc=)/.test(l));
      expect(said, `${row.what}: ${r.stderr}`).toEqual([row.says, 'rc=1']);
      expect(linkOf(home), `${row.what}: a refusal moved ~/ccrc`).toBe(link);
      expect(existsSync(join(home, 'kept-spine-argv')), `${row.what}: a refusal ran a spine`).toBe(false);
    }
  });

  it('_ver_kept: complete, absent, or incomplete with the first missing piece named — the role decides which build counts, and a tag-shaped name must be what its kept stamp says (the arms, sourced)', () => {
    const stampOf = (version: string | null): string => (version === null
      ? `{"sha":"${V1_SHA}","ref":"main","builtAt":"2026-09-23T00:00:00Z","dirty":false}\n`
      : `{"sha":"${V1_SHA}","ref":"main","builtAt":"2026-09-23T00:00:00Z","dirty":false,"version":"${version}"}\n`);
    const rows: Array<{ what: string; ask?: string; role: string; tree?: string;
      plant?: (root: string, home: string) => void; says: string }> = [
      { what: 'complete (both)', role: 'both', says: 'rc=0 why=' },
      { what: 'complete (an empty role reads both)', role: '', says: 'rc=0 why=' },
      { what: 'absent', ask: 'v0.9.0', role: 'both', says: 'rc=1 why=no kept version v0.9.0 under $HOME/ccrc-versions' },
      { what: 'a symlink is not a kept version', ask: 'v0.9.1', role: 'both',
        plant: (root, home) => symlinkSync(root, join(home, 'ccrc-versions', 'v0.9.1')),
        says: 'rc=1 why=no kept version v0.9.1 under $HOME/ccrc-versions' },
      { what: 'no ccd/ccrc', role: 'both', plant: (root) => rmSync(join(root, 'ccd', 'ccrc')), says: 'rc=2 why=no ccd/ccrc' },
      { what: 'no server build', role: 'server',
        plant: (root) => rmSync(join(root, 'server', 'dist', 'server', 'src', 'index.js')), says: 'rc=2 why=no server build' },
      { what: 'a fleet box needs no server build', role: 'fleet',
        plant: (root) => rmSync(join(root, 'server', 'dist', 'server', 'src', 'index.js')), says: 'rc=0 why=' },
      { what: 'no agent build', role: 'fleet',
        plant: (root) => rmSync(join(root, 'agent', 'dist', 'agent', 'src', 'index.js')), says: 'rc=2 why=no agent build' },
      { what: 'no kept stamp', role: 'both', plant: (root) => rmSync(join(root, '.ccrc-stamp.json')), says: 'rc=2 why=no kept stamp' },
      { what: 'no kept install record', role: 'both',
        plant: (root) => rmSync(join(root, '.ccrc-installed')), says: 'rc=2 why=no kept install record' },
      { what: 'a stamp that does not parse', role: 'both',
        plant: (root) => writeFileSync(join(root, '.ccrc-stamp.json'), '{not json\n'), says: 'rc=2 why=its kept stamp does not parse' },
      { what: 'a stamp naming another tag', role: 'both',
        plant: (root) => writeFileSync(join(root, '.ccrc-stamp.json'), stampOf('v1.0.1')),
        says: 'rc=2 why=its kept stamp reads v1.0.1, not v1.0.0' },
      { what: 'an unversioned stamp under a tag name', role: 'both',
        plant: (root) => writeFileSync(join(root, '.ccrc-stamp.json'), stampOf(null)),
        says: 'rc=2 why=its kept stamp reads an unversioned build, not v1.0.0' },
      { what: 'an untagged name is not held to a version', ask: 'untagged-0123456789ab', tree: 'untagged-0123456789ab',
        role: 'both', says: 'rc=0 why=' },
    ];
    for (const row of rows) {
      const home = freshUpdateBox('ccrc-update-ver-kept-');
      const tree = row.tree ?? 'v1.0.0';
      const root = installVersionedTree(home, tree, {
        link: false, stamp: tree.startsWith('v') ? { sha: V1_SHA, version: tree } : { sha: V1_SHA },
      });
      row.plant?.(root, home);
      // The name and the role are plain tokens (a tag, `untagged-<hex>`, a
      // role word or ''), so single quotes carry them into the script intact.
      const r = sourcedCcrc(home,
        `rc=0; _ver_kept '${row.ask ?? tree}' '${row.role}' || rc=$?; printf 'rc=%s why=%s\\n' "$rc" "$VER_WHY"`);
      const said = r.stdout.split('\n').filter((l) => l.startsWith('rc='));
      expect(said, `${row.what}: ${r.stderr}`).toEqual([row.says]);
    }
  });
});
```

**(b) Rollback by flip.** Append:

```ts
describe('ccrc rollback: by flip when the version is kept (W6 Task 4)', () => {
  const phasesOf = (home: string): string[] => reportWrites(home).map((w) => String(w['phase']));
  const calls = (home: string): string[] => (existsSync(join(home, 'systemctl-calls'))
    ? fileText(join(home, 'systemctl-calls')).split('\n').filter((l) => l !== '') : []);
  const withSweep = (home: string): void => {
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
  };
  /** A W6 server box on v2.0.0 with v1.0.0 kept beside it (its spine the
   *  recorder), and `previous` naming v1.0.0 — what the move onto v2.0.0 left. */
  const flipBox = (prefix: string, opts: { unsigned?: boolean } = {}): { home: string; kept: string } => {
    const home = freshUpdateBox(prefix);
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    const kept = keptVersion(home, 'v1.0.0', V1_SHA, { unsigned: opts.unsigned });
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    return { home, kept };
  };

  it('bare `ccrc rollback` to a kept version is a flip: no release-host question, no download; that version\'s own spine runs from the flipped tree — verified, no lock marker, no lock descriptor — then the gate, then the sweep behind its preflight (spec §11 "rollback after W5 is arm 1"; §18 "a standalone rollback sweeps behind the preflight"; D-3442)', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-');
    // Every release-host question would answer 404, so a rollback that asked
    // one would refuse at exit 2 (wave 4 Task 6's knob).
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(localUrls(home)).toEqual([]);
    expect(linkOf(home)).toBe(kept);
    expect(fileText(join(home, 'kept-spine-argv')).split('\n').filter((l) => l !== ''))
      .toEqual([join(home, 'ccrc', 'ccd', 'ccrc'), 'install', '--role', 'server']);
    expect(fileText(join(home, 'kept-spine-env')).trim())
      .toBe(`verified=1 held=unset lockfd=${process.platform === 'linux' ? 'closed' : 'unmeasured'}`);
    // The kept spine stamps nothing (a pre-W6 spine's shape): the stamp is the
    // flip's own restore, the record the spine's.
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(fileText(join(kept, '.ccrc-stamp.json')));
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(fileText(join(kept, '.ccrc-installed')));
    expect(fileText(join(home, '.ccrc', 'previous'))).toBe(`v1.0.0\n${V1_SHA}\n`);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    expect(r.stdout).toMatch(/^update: gate: server answers on v1\.0\.0 /m);
    expect(r.stdout).toContain('rollback: this box runs v1.0.0 again — flipped back to $HOME/ccrc-versions/v1.0.0, no download');
    // No resolving, fetching, verifying or backing-up: nothing was downloaded.
    expect(phasesOf(home)).toEqual(['installing', 'checking', 'restarting', 'done']);
    expect(lastReport(home)).toMatchObject({
      phase: 'done', detail: 'rolled back by flip to v1.0.0', target: 'v1.0.0', from: 'rollback',
    });
    if (process.platform === 'linux') {
      const c = calls(home);
      const gate = c.indexOf('--user is-active ccrc.service');
      const restartAt = c.indexOf('--user try-restart claude-session@*');
      expect(gate, c.join('\n')).toBeGreaterThan(-1);
      expect(restartAt, 'a rollback by flip must end in the supervisor sweep').toBeGreaterThan(gate);
      for (const u of ['alpha', 'beta']) {
        const at = c.indexOf(`--user show -p KillMode claude-session@${u}.service`);
        expect(at, `no KillMode preflight for ${u}`).toBeGreaterThan(-1);
        expect(at).toBeLessThan(restartAt);
      }
      expect(r.stdout).not.toMatch(/DEGRADED/);
    }
  });

  it('an unverified kept version stays unverified: its own spine runs WITHOUT CCRC_UPDATE_VERIFIED when its kept record says unsigned — a flip never promotes it (§18 "arm 2 never silently unsigns", applied to the flip; D-3439)', () => {
    const { home } = flipBox('ccrc-rollback-flip-unsigned-', { unsigned: true });
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(fileText(join(home, 'kept-spine-env'))).toMatch(/^verified=unset held=unset /);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(`${V1_SHA}\nunsigned\n`);
  });

  it('a box already on the kept tag with its install completed has nothing to do — exit 0, nothing written; one whose install did NOT complete re-runs the kept spine, so D-3264\'s rerun (`ccrc rollback --to <v>`) works on a versioned box', () => {
    const home = freshUpdateBox('ccrc-rollback-flip-already-');
    const root = plantW6Box(home, 'v1.0.0', V1_SHA, 'server');
    writeFileSync(join(root, 'ccd', 'ccrc'), KEPT_SPINE, { mode: 0o755 });
    let r = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('rollback: this box already runs v1.0.0 ($HOME/ccrc points at $HOME/ccrc-versions/v1.0.0 and its install completed) — nothing to do');
    expect(existsSync(join(home, 'kept-spine-argv'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
    expect(localUrls(home)).toEqual([]);
    // The same box after a kept spine died past `_inst_stamp`: the stamp
    // already on v1.0.0, and no completed-install record.
    rmSync(join(home, '.ccrc', 'installed'));
    r = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/nothing to do/);
    expect(fileText(join(home, 'kept-spine-argv')).split('\n')[1]).toBe('install');
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(fileText(join(root, '.ccrc-installed')));
    expect(lastReport(home)['phase']).toBe('done');
  });

  it('a kept directory whose install never completed is NOT kept: the release host is asked as before, and an unpublished tag is refused at exit 2 (the control on the skip; passes before this task too)', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-incomplete-');
    rmSync(join(kept, '.ccrc-installed'));
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stdout).not.toMatch(/is kept at/);
    expect(r.stderr).toMatch(/^ccrc: rollback: v1\.0\.0 is not a published release \(its SHA256SUMS answered 404\)/m);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v1.0.0/SHA256SUMS`]);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
  });

  it('a kept spine that does not complete: ~/ccrc stays on the kept version, the box reads incomplete, the report says why — exit 1, no gate, no sweep', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-spine-dies-');
    writeFileSync(join(home, 'fixture-kept-spine-exit'), '1\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain("ccrc: rollback: $HOME/ccrc points at $HOME/ccrc-versions/v1.0.0, but its own spine did not complete (its own spine exited 1 without writing its completed-install record) — read its lines above; 'ccrc update --check' says where this box stands");
    expect(linkOf(home)).toBe(kept);
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    expect(lastReport(home)).toMatchObject({
      phase: 'failed',
      detail: 'rollback to v1.0.0: the kept spine did not complete; its own spine exited 1 without writing its completed-install record',
    });
    expect(phasesOf(home)).not.toContain('checking');
    expect(calls(home).join('\n')).not.toMatch(/try-restart/);
  });

  it('a rollback by flip whose gate fails is not restored (D-3243): failed \'rollback to <tag>: gate: …\', exit 1, no restore phase, no sweep', () => {
    const { home } = flipBox('ccrc-rollback-flip-gate-');
    // /health keeps answering the version rolled away from.
    writeFileSync(join(home, 'fixture-health-pin'), 'v2.0.0\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — \/health at 127\.0\.0\.1:7788 answers v2\.0\.0, not v1\.0\.0$/m);
    expect(r.stderr).toMatch(/^ccrc: rollback: v1\.0\.0 was installed but failed its health gate \(gate: \/health at 127\.0\.0\.1:7788 answers v2\.0\.0, not v1\.0\.0\) — no automatic restore runs for a --from rollback run/m);
    expect(lastReport(home)).toMatchObject({
      phase: 'failed', detail: 'rollback to v1.0.0: gate: /health at 127.0.0.1:7788 answers v2.0.0, not v1.0.0', from: 'rollback',
    });
    expect(phasesOf(home)).not.toContain('restoring');
    expect(calls(home).join('\n')).not.toMatch(/try-restart/);
  });

  it('a kept version the flip cannot reach (the one rename refused) falls back to update\'s own re-install; that release\'s older spine gets no directory either, so it dies BEFORE anything is installed — the record as it was, no spine run', () => {
    const { home } = flipBox('ccrc-rollback-flip-rename-');
    // `_plat_ln_swap` refuses to clear a real directory at <link>.new (Task 1).
    mkdirSync(join(home, 'ccrc.new'));
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const recBefore = fileText(join(home, '.ccrc', 'installed'));
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toContain('rollback: v1.0.0 could not be flipped to (the one rename that points $HOME/ccrc at $HOME/ccrc-versions/v1.0.0 failed) — rolling back by re-install instead');
    expect(r.stderr).toContain("could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0");
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(recBefore);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    expect(existsSync(join(home, 'kept-spine-argv'))).toBe(false);
  });

  it('a FULL rollback by flip: the kept version\'s REAL spine re-places ~/.local/bin/ccd, the stamp and the record are the kept version\'s, then the sweep — and not one release URL is asked (Review Focus 1)', () => {
    const home = onKeptV1('ccrc-rollback-flip-full-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // The kept copies, measured BEFORE this case's run. The spine a flip
    // back runs is this checkout's own, and its `_inst_installed` ends in
    // `_ver_keep_state install`, which copies the box's stamp and record
    // over these two files: a box-vs-kept-copy comparison AFTER the run is
    // equal by construction, whatever the bytes (a verified version
    // re-recorded `unsigned` would pass it). The snapshot is the subject.
    const keptStamp = fileText(join(v1, '.ccrc-stamp.json'));
    const keptRec = fileText(join(v1, '.ccrc-installed'));
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    const up = runUpdate(home);
    expect(up.code, `the move onto v2.0.0 must complete — stderr: ${up.stderr}\nstdout: ${up.stdout}`).toBe(0);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(fileText(join(home, '.local', 'bin', 'ccd')), 'v2.0.0 carries the kept sentinel — the control is broken').not.toContain(CCD_SENTINEL);
    for (const f of ['curl-argv', 'update-json-writes', 'systemctl-calls']) rmSync(join(home, f), { force: true });
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(localUrls(home)).toEqual([]);
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, '.local', 'bin', 'ccd'))).toBe(fileText(join(v1, 'ccd', 'ccd')));
    expect(fileText(join(home, '.local', 'bin', 'ccd'))).toContain(CCD_SENTINEL);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(keptStamp);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(keptRec);
    expect(fileText(join(v1, '.ccrc-stamp.json')), 'the kept stamp was rewritten').toBe(keptStamp);
    expect(fileText(join(v1, '.ccrc-installed')), 'the kept record was rewritten').toBe(keptRec);
    expect(fileText(join(home, '.ccrc', 'previous'))).toBe(`v1.0.0\n${V1_SHA}\n`);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    expect(lastReport(home)).toMatchObject({ phase: 'done', detail: 'rolled back by flip to v1.0.0', from: 'rollback' });
    if (process.platform === 'linux') {
      const c = calls(home);
      const restartAt = c.indexOf('--user try-restart claude-session@*');
      expect(restartAt, 'a rollback by flip must end in the supervisor sweep').toBeGreaterThan(c.indexOf('--user is-active ccrc.service'));
    }
  }, 60_000);

  it('a crashed migration is completed BEFORE the kept check, so a kept tag still reads kept — no release-host question, no download — and the flip\'s passed gate then removes ~/ccrc.migrating (W6 Task 3, D-3437)', () => {
    const { home, kept } = flipBox('ccrc-rollback-crashed-');
    // flipBox's v2.0.0 link turned into the crash pair a killed migration
    // leaves: the pre-versioned tree aside, the marker naming v2.0.0, no ~/ccrc.
    rmSync(join(home, 'ccrc'));
    mkdirSync(join(home, 'ccrc.migrating', 'server'), { recursive: true });
    writeFileSync(join(home, 'ccrc.migrating', 'server', 'OLD-MARKER'), 'the pre-versioned tree\n');
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v2.0.0\n');
    // A rollback that asked the release host would refuse at exit 2.
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const lines = r.stdout.split('\n');
    const resumed = lines.indexOf('rollback: tree: completed a crashed migration — $HOME/ccrc was absent beside $HOME/ccrc.migrating; linked to $HOME/ccrc-versions/v2.0.0 (named by ~/.ccrc/migrating-to)');
    const keptAt = lines.indexOf('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(resumed, r.stdout).toBeGreaterThan(-1);
    expect(keptAt, 'the kept check read the crashed layout').toBeGreaterThan(resumed);
    expect(localUrls(home)).toEqual([]);
    expect(linkOf(home)).toBe(kept);
    expect(existsSync(join(home, 'ccrc.migrating')), 'the passed gate did not remove the old tree').toBe(false);
  }, 60_000);
});
```

**(c) The older spine's directory.** Append:

```ts
describe('ccrc update: a spine older than W6 gets a directory named for its own tag (W6 Task 4)', () => {
  const NEW_SHA = 'newsha0000000000000000000000000000000000';
  /** An older release's spine, as the STUB shim runs it (`fixture-on-install`,
   *  wave 4 Task 6): it records whether the directory it was handed still
   *  claimed completeness; writes THROUGH $HOME/ccrc, as its `_inst_tree`'s
   *  rsync does; stamps the box with its release's stamp (its `_inst_stamp`);
   *  and — `fixture-stub-installed`, wave 4 Task 5 — writes the record. */
  const oldSpine = (home: string): void => {
    writeFileSync(join(home, 'fixture-old-stamp.json'), shippedStamp('v1.0.0', NEW_SHA));
    writeFileSync(join(home, 'fixture-on-install'), [
      'if [ -f "$HOME/ccrc/.ccrc-installed" ]; then echo present; else echo absent; fi > "$HOME/old-spine-saw-record"',
      'mkdir -p "$HOME/ccrc/server" && printf \'written by the older spine\\n\' > "$HOME/ccrc/server/WROTE-BY-OLD-SPINE"',
      'cp "$HOME/fixture-old-stamp.json" "$HOME/.ccrc/build.json"',
    ].join('\n') + '\n');
    writeFileSync(join(home, 'fixture-stub-installed'), 'yes\n');
  };
  const dotEntries = (home: string): string[] =>
    readdirSync(join(home, 'ccrc-versions')).filter((n) => n.startsWith('.'));

  it('with no directory for the older tag, ~/ccrc is pointed at a COPY of the running version (its kept state removed) before that spine runs — every write lands there, the version it replaces is byte-unchanged, and the copy is kept complete once the spine completes (Review Focus 5; D-3440, D-3428)', () => {
    const home = freshUpdateBox('ccrc-update-legacy-copy-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    const before = treeDigest(cur);
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    oldSpine(home);
    const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    expect(r.stdout).toContain("update: tree: v1.0.0's spine predates versioned installs and writes through $HOME/ccrc — $HOME/ccrc now points at $HOME/ccrc-versions/v1.0.0 (a copy of v2.0.0) for it to write into");
    expect(linkOf(home)).toBe(v1);
    expect(treeDigest(cur), 'the older spine wrote into the version it replaced').toEqual(before);
    expect(existsSync(join(v1, 'server', 'WROTE-BY-OLD-SPINE'))).toBe(true);
    expect(fileText(join(home, 'old-spine-saw-record'))).toBe('absent\n');
    // The copy began as v2.0.0's tree…
    expect(fileText(join(v1, 'ccd', 'ccd'))).toBe(fileText(join(cur, 'ccd', 'ccd')));
    // …and is now v1.0.0's, kept complete by cmd_update after that spine.
    expect(fileText(join(v1, '.ccrc-stamp.json'))).toBe(fileText(join(home, '.ccrc', 'build.json')));
    expect(fileText(join(v1, '.ccrc-installed'))).toBe(`${NEW_SHA}\n`);
    expect(r.stdout).toMatch(/^update: versions: kept v1\.0\.0's stamp and install record in \$HOME\/ccrc-versions\/v1\.0\.0/m);
    expect(dotEntries(home)).toEqual([]);
    expect(lastReport(home)['phase']).toBe('done');
  });

  it('with a kept directory for the older tag, ~/ccrc is pointed at IT — which stops claiming completeness before that spine writes into it, and regains it only when the spine completes', () => {
    const home = freshUpdateBox('ccrc-update-legacy-kept-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    const v1 = installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: V1_SHA, version: 'v1.0.0' } });
    const before = treeDigest(cur);
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    oldSpine(home);
    const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain("update: tree: v1.0.0's spine predates versioned installs and writes through $HOME/ccrc — $HOME/ccrc now points at $HOME/ccrc-versions/v1.0.0 (kept) for it to write into");
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, 'old-spine-saw-record')), 'the older spine was handed a directory that still claimed completeness').toBe('absent\n');
    expect(existsSync(join(v1, 'server', 'WROTE-BY-OLD-SPINE'))).toBe(true);
    expect(treeDigest(cur)).toEqual(before);
    expect(fileText(join(v1, '.ccrc-installed'))).toBe(`${NEW_SHA}\n`);
    expect(dotEntries(home)).toEqual([]);
  });

  it('no directory is handed over when the staged ccrc IS versioned (it names BOX_VERSIONS_ROOT), nor for a same-tag reinstall, which writes in place (the controls; D-3426)', () => {
    const home = freshUpdateBox('ccrc-update-legacy-w6-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    const tree = stubTree(home, { version: 'v1.0.0' });
    // A W6-shaped staged ccrc: the one line the check reads. The MANIFEST is
    // re-made after the edit, or the per-file verification refuses the tree.
    rmSync(join(tree, 'MANIFEST'));
    writeFileSync(join(tree, 'ccd', 'ccrc'),
      fileText(join(tree, 'ccd', 'ccrc')).replace('#!/bin/sh\n', '#!/bin/sh\nBOX_VERSIONS_ROOT="$HOME/ccrc-versions"\n'),
      { mode: 0o755 });
    writeManifest(tree);
    packRelease(home, tree, { tag: 'v1.0.0', latest: false });
    let r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/predates versioned installs/);
    expect(linkOf(home)).toBe(cur);
    // The same tag, an older spine: in place, no directory handed over.
    const same = freshUpdateBox('ccrc-update-legacy-same-');
    const sameCur = plantW6Box(same, 'v2.0.0', V2_SHA);
    packRelease(same, stubTree(same, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    r = runUpdate(same, ['--to', 'v2.0.0', '--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/predates versioned installs/);
    expect(linkOf(same)).toBe(sameCur);
  });

  it('when that directory cannot be made the update dies BEFORE anything is installed — ~/ccrc, the record and the caps as they were, the staged spine never run, no staging directory left', () => {
    const home = freshUpdateBox('ccrc-update-legacy-refused-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os linux\nverify\n');
    const rec = fileText(join(home, '.ccrc', 'installed'));
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const root = join(home, 'ccrc-versions');
    chmodSync(root, 0o555);   // `cp -a` cannot create `.v1.0.0.incoming.<pid>` (the suite never runs as root)
    const r = ((): Result => {
      try { return runUpdate(home, ['--to', 'v1.0.0', '--downgrade']); } finally { chmodSync(root, 0o755); }
    })();
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain("ccrc: could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0");
    expect(linkOf(home)).toBe(cur);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(rec);
    expect(fileText(join(home, '.ccrc', 'ccrc-caps'))).toBe('os linux\nverify\n');
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    expect(dotEntries(home)).toEqual([]);
    expect(lastReport(home)['phase']).toBe('failed');
    expect(String(lastReport(home)['detail'])).toMatch(/^could not give v1\.0\.0's older spine a directory of its own/);
  });

  it('a symlink or a regular file at ~/ccrc-versions/<older tag> is not a directory ccrc placed: the update dies BEFORE anything is installed, and nothing is written through the link (the refusal the copy and kept cases never reach)', () => {
    for (const shape of ['symlink', 'file'] as const) {
      const home = freshUpdateBox(`ccrc-update-legacy-not-a-dir-${shape}-`);
      const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
      const rec = fileText(join(home, '.ccrc', 'installed'));
      const other = join(home, 'somewhere-else');
      mkdirSync(join(other, 'server'), { recursive: true });
      writeFileSync(join(other, 'server', 'THEIRS'), 'not a version\n');
      const otherBefore = treeDigest(other);
      if (shape === 'symlink') symlinkSync(other, join(home, 'ccrc-versions', 'v1.0.0'));
      else writeFileSync(join(home, 'ccrc-versions', 'v1.0.0'), 'a file\n');
      packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
      oldSpine(home);
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `${shape}: stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stderr).toContain("ccrc: could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0 ($HOME/ccrc-versions/v1.0.0 is not a directory ccrc placed)");
      expect(linkOf(home), shape).toBe(cur);
      expect(fileText(join(home, '.ccrc', 'installed')), shape).toBe(rec);
      expect(existsSync(join(home, 'staged-ccrc-argv')), `${shape}: the staged spine ran`).toBe(false);
      expect(treeDigest(other), `${shape}: something was written through the link`).toEqual(otherBefore);
      expect(dotEntries(home), shape).toEqual([]);
    }
  });
});
```

Then append the fourth describe. Both cases are refusals that must land before anything moves. The second forces `CCD_OS=darwin` in a sourced shell, as wave 4 Task 3's `_upd_detach` table does, so it measures the macOS arm on every leg:

```ts
describe('ccrc update and rollback: refused before anything moves — a ~/ccrc this ccrc did not make, and a flip macOS cannot make (W6 Task 4)', () => {
  it('a foreign ~/ccrc (a link into a directory ccrc did not place) is refused by update BEFORE the backup, any download or any spine, and by rollback before the release-host question — the link and what it names byte-unchanged (D-3429, amended by Task 4)', () => {
    const home = freshUpdateBox('ccrc-update-foreign-');
    const other = join(home, 'operators-tree');
    mkdirSync(join(other, 'server'), { recursive: true });
    writeFileSync(join(other, 'server', 'MINE'), "the operator's own tree\n");
    symlinkSync(other, join(home, 'ccrc'));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const before = treeDigest(other);
    // A published release whose spine writes THROUGH $HOME/ccrc — an older
    // spine, as the restore arms would have run it over the link.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-on-install'),
      'mkdir -p "$HOME/ccrc/server" && printf \'written through the link\\n\' > "$HOME/ccrc/server/WROTE-THROUGH"\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain('ccrc: update: $HOME/ccrc is a link whose target is not a version directory under $HOME/ccrc-versions — refusing to place or flip a tree over something this ccrc did not make; nothing was downloaded or installed, and $HOME/ccrc and $HOME/ccrc-versions were not touched');
    expect(localUrls(home), 'the refused update reached the release host').toEqual([]);
    expect(r.stdout).not.toMatch(/^update: backup: /m);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'a spine ran over the foreign link').toBe(false);
    expect(lastReport(home)['phase']).toBe('failed');
    const writes = reportWrites(home).length;
    // The same box, asked to roll back: refused before the release host is
    // asked (so no exit 2), and before the lock (so no report is written).
    const rb = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(rb.code, `stderr: ${rb.stderr}\nstdout: ${rb.stdout}`).toBe(1);
    expect(rb.stderr).toContain('ccrc: rollback: $HOME/ccrc is a link whose target is not a version directory under $HOME/ccrc-versions — refusing to place or flip a tree over something this ccrc did not make; nothing on this box was changed');
    expect(localUrls(home), 'the refused rollback asked the release host').toEqual([]);
    expect(reportWrites(home).length, 'the refused rollback wrote a report').toBe(writes);
    // Neither run touched the link, what it names, or the versions root.
    expect(readlinkSync(join(home, 'ccrc'))).toBe(other);
    expect(treeDigest(other)).toEqual(before);
    expect(existsSync(join(home, 'ccrc-versions'))).toBe(false);
  });

  it('on macOS without python3 the two flips this ccrc makes OUTSIDE a spine refuse before anything moves, naming python3 — never "the one rename failed" (_ver_can_flip, _ver_flip_back, _upd_legacy_target; CCD_OS forced, sourced; D-3419, amended by Task 4)', () => {
    // From this assignment on the sourced shell has builtins only.
    const NOPY = 'PATH="$HOME/no-such-bin"';
    const PY_WHY = 'python3 is not on PATH — on macOS the $HOME/ccrc flip is one rename(2) through os.replace; install the Xcode Command Line Tools: xcode-select --install';
    // The probe: Darwin only.
    let home = freshUpdateBox('ccrc-update-nopy-probe-');
    let r = sourcedCcrc(home,
      `for os in darwin linux; do ( CCD_OS=$os; ${NOPY}; rc=0; _ver_can_flip || rc=$?; printf '%s rc=%s why=%s\\n' "$os" "$rc" "$VER_WHY" ); done`);
    expect(r.stdout.split('\n').filter((l) => / rc=/.test(l)), r.stderr).toEqual([`darwin rc=1 why=${PY_WHY}`, 'linux rc=0 why=']);
    // `_ver_flip_back`: rc 1, nothing changed — which arm 1 reports as
    // `could not flip to <prev> (<why>)` and a rollback as `could not be
    // flipped to (<why>)`, python3 named in both.
    home = freshUpdateBox('ccrc-update-nopy-flip-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    keptVersion(home, 'v1.0.0', V1_SHA);
    const rec = fileText(join(home, '.ccrc', 'installed'));
    r = sourcedCcrc(home,
      `CCD_OS=darwin; ${NOPY}; rc=0; _ver_flip_back v1.0.0 server rollback || rc=$?; printf 'rc=%s why=%s\\n' "$rc" "$VER_WHY"`);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('rc=')), r.stderr).toEqual([`rc=1 why=${PY_WHY}`]);
    expect(linkOf(home)).toBe(cur);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(rec);
    expect(existsSync(join(home, 'kept-spine-argv'))).toBe(false);
    // `_upd_legacy_target`: dies with the refusal, python3 named, before any copy.
    home = freshUpdateBox('ccrc-update-nopy-legacy-');
    const cur2 = plantW6Box(home, 'v2.0.0', V2_SHA);
    r = sourcedCcrc(home, `_ver_layout; CCD_OS=darwin; ${NOPY}; _upd_legacy_target v1.0.0; echo survived`);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain(`ccrc: could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0 (${PY_WHY})`);
    expect(r.stdout).not.toContain('survived');
    expect(linkOf(home)).toBe(cur2);
    expect(readdirSync(join(home, 'ccrc-versions')).sort()).toEqual(['v2.0.0']);
  });
});
```

**(d) The caps words — `server/test/ccrc-install.test.ts`.** In `describe('ccrc install: the node\'s three files (design 2026-09-20 §3, §9)'` (`grep -n "^describe('ccrc install: the node" server/test/ccrc-install.test.ts`), replace wave 4 Task 13's comment and three constants

```ts
  // Each wave's spine ADDS its own words (design 2026-09-20 §9): W1's three,
  // then W4's four — `detach` on Linux only (decision 17: `--detach` refuses
  // on Darwin), so a Linux install writes seven words and a Darwin one six.
  // LITERALS, not a read of ccd/ccrc's arrays: a pin derived from the list
  // it pins could never red on the list being wrong.
  const CAPS_W4_ALL = ['verify', 'node-id', 'floor', 'update-json', 'update-gate', 'rollback'];
  const CAPS_W4_LINUX = [...CAPS_W4_ALL, 'detach'];
  const CAPS_HERE = process.platform === 'darwin' ? CAPS_W4_ALL : CAPS_W4_LINUX;
```

with

```ts
  // Each wave's spine ADDS its own words (design 2026-09-20 §9): W1's three,
  // W4's four — `detach` on Linux only (decision 17: `--detach` refuses on
  // Darwin) — and W6's `versions`, so a Linux install writes eight words and
  // a Darwin one seven. LITERALS, not a read of ccd/ccrc's arrays: a pin
  // derived from the list it pins could never red on the list being wrong.
  const CAPS_ALL = ['verify', 'node-id', 'floor', 'update-json', 'update-gate', 'rollback', 'versions'];
  const CAPS_LINUX = [...CAPS_ALL, 'detach'];
  const CAPS_HERE = process.platform === 'darwin' ? CAPS_ALL : CAPS_LINUX;
```

then, in the same describe, rename the remaining uses: `CAPS_W4_LINUX` → `CAPS_LINUX` and `CAPS_W4_ALL` → `CAPS_ALL` (the both-arms loop `for (const [os, words] of [['linux', CAPS_W4_LINUX], ['darwin', CAPS_W4_ALL]] as const)` and the presence pin's `expect(words).toEqual(CAPS_W4_LINUX);`); `grep -c 'CAPS_W4_' server/test/ccrc-install.test.ts` now prints `0`. Retitle the two cases whose titles count the words: `'ccrc-caps: line 1 is the os, then each wave\'s words — W1\'s three, W4\'s four, detach on Linux only (§18 "_inst_caps writes each wave\'s words")'` becomes `'ccrc-caps: line 1 is the os, then each wave\'s words — W1\'s three, W4\'s four, W6\'s versions, detach on Linux only (§18 "_inst_caps writes each wave\'s words")'`, and `'ccrc-caps: seven words on Linux, six on Darwin, whichever box runs this suite — both arms of the real _inst_caps'` becomes `'ccrc-caps: eight words on Linux, seven on Darwin, whichever box runs this suite — both arms of the real _inst_caps'`. In the presence pin's `BACKING` map, immediately after its `rollback: [/^cmd_rollback\(\) \{/m, /^\s*rollback\)\s+cmd_rollback "\$@" ;;$/m],` line, add:

```ts
      // W6 Task 4: a kept version is a flip — restore arm 1 and rollback by flip.
      versions: [/^_upd_restore_arm1\(\) \{/m, /^_ver_flip_back\(\) \{/m],
```

**(e) The censuses — `server/test/single-definition.test.ts`.** In `it('the ccrc CLI spells the path once and parses it once'`, at the END of the `BOX_STAMP_FILE` `toEqual([` list (after `'local src sha ref dirty version vfield tmp why rc=0 dest="$BOX_STAMP_FILE"',` and any line Tasks 2–3 entered after it), add:

```ts
      // W6 Task 4: `_ver_flip_back` restores a kept version's stamp over the
      // box's, through a local — `_inst_stamp`'s `dest=` idiom above.
      'local stamp="$BOX_STAMP_FILE"',
```

In `it('the ccrc CLI spells the path once, and every other site goes through BOX_INSTALLED_FILE'`, add these three entries in FILE ORDER. `cmd_rollback` sits after `cmd_update` and above `_upd_marker_unsigned`; the other two sit immediately after `_upd_restore_arm3`. So the first goes directly below the `'if [ -f "$BOX_INSTALLED_FILE" ]; then',` line (`cmd_update`'s D-3114 arm) and above `_upd_marker_unsigned`'s two entries, unless another function's entry falls between. The other two go directly below arm 3's `'if rm -f -- "$BOX_INSTALLED_FILE" 2>/dev/null; then',`. Step 5 checks every position against the file.

```ts
      // W6 Task 4, `cmd_rollback`: a box already on the kept tag has nothing
      // to do only when its record IS the kept version's (D-3264's rerun).
      'if [ "$VER_CURRENT" = "$to" ] && [ "$now" = "$to" ] && cmp -s -- "$BOX_INSTALLED_FILE" "$BOX_VERSIONS_ROOT/$to/$VER_RECORD_COPY"; then',
```

```ts
      // W6 Task 4, `_ver_flip_back`: the record, cleared before the kept
      // version's own spine so its presence afterwards means that spine wrote it.
      'local rec="$BOX_INSTALLED_FILE"',
      // W6 Task 4, `_upd_restore_arm1`: a failed arm 1 clears the record, so
      // arm 2's child cannot read the box as already on the previous tag.
      'if ! rm -f -- "$BOX_INSTALLED_FILE" 2>/dev/null; then',
```

- [ ] **Step 4: Run to verify they fail**

Run, from inside `server/`, foreground, timeout ≥ 600000 ms:

```bash
./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'W6 Task 4'
```

Expected: FAIL. Most cases fail on their first W6 assertion:
- the four FULL arm-1 cases: arm 1 does not exist, so the first reaches arm 2 (v1.0.0 is published; the real child re-installs it, and the `arm 1: v1.0.0 is kept` line is absent), the in-place case reaches arm 2 too (no `still points at v1.0.0` line; the child's in-place rsync strips the kept `ccd/ccd`'s sentinel), and the other two have no `flip:` or `arm 1 failed` line;
- the three sourced cases: every row `rc=127` (`_upd_restore_arm1: command not found`, `_ver_kept: command not found`, `_ver_can_flip: command not found`), and the macOS case's `_upd_legacy_target` row exits 127 without the refusal;
- the rollback cases: every kept box asks the release host. With `fixture-release-http` planted, or v1.0.0 unpublished, that is exit 2 `not a published release`, and the rename case exits 0 through a plain re-install;
- the older-spine cases: no `predates versioned installs` line, and `WROTE-BY-OLD-SPINE` lands in v2.0.0, whose digest moves. The refused case and the symlink/file case exit 0;
- the foreign-`~/ccrc` case: no refusal sentence — the update goes on past the point this task refuses at, and the rollback asks the release host.

Two cases PASS before and after, by design, and each says so in its title or comment: the incomplete-kept control, and the W6-shaped / same-tag controls. Count them.

```bash
./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'ccrc-caps|cap word'
./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'check'
./node_modules/.bin/vitest run test/single-definition.test.ts -t 'BOX_INSTALLED_FILE|parses it once'
```

Expected: FAIL. In `ccrc-install.test.ts`, 4 cases: the renamed caps case and the rewrite case (the file lacks `versions`), the both-arms case, and the presence pin (`toEqual(CAPS_LINUX)`; its `versions` machinery is absent). In `ccrc-update.test.ts`, every `--check` case that compares `caps=` against `CAPS_NOW`. In `single-definition.test.ts`, both censuses, because their `toEqual` lists name lines `ccd/ccrc` does not have yet.

- [ ] **Step 5: Implement — `ccd/ccrc`**

**(a) The cap word.** Replace the array line `CCRC_CAP_WORDS=(verify node-id floor update-json update-gate rollback)` with `CCRC_CAP_WORDS=(verify node-id floor update-json update-gate rollback versions)`, and in the comment above it (wave 4 Task 13's), immediately after its line `#        (\`ccrc rollback\`); and, Linux only, detach — below.`, add ONE line:

```bash
#   W6 — versions (a kept version is a flip: `_upd_restore_arm1`, `_ver_flip_back`).
```

**(b) The five new functions.** Immediately after `_upd_restore_arm3`'s closing `}` (its last body line is `  _upd_phase reverted "arm3: tree MIXED, deploy.sh is the remedy$note; $reason"`), after one blank line, insert:

```bash
# ── W6 Task 4: a kept version, and the flip back to it ─────────────────────
# `_ver_kept <name> <role>` — can a flip return to ~/ccrc-versions/<name>?
# rc 0 complete; rc 1 absent (no REAL directory of that name — a symlink
# there is nothing this ccrc placed); rc 2 incomplete, VER_WHY naming the
# first missing piece. "Complete" is the placement's own evidence, never a
# guess: the tree's `ccd/ccrc` (the spine a flip runs), the role's build
# (what its unit starts), and the two copies `_ver_keep_state` writes when
# an install of it COMPLETED — the record last, so its presence is the mark.
# A tag-shaped name must also be what its kept stamp says, or a flip would
# restore one build's stamp over another's tree. An empty role reads `both`,
# the staged spine's own default. Prints nothing.
_ver_kept() {   # <name> <role> -> 0 complete, 1 absent, 2 incomplete (VER_WHY)
  local name="$1" role="${2:-both}" vdir="$BOX_VERSIONS_ROOT/$1" v=""
  local -a saved=()
  VER_WHY=""
  if [ -L "$vdir" ] || [ ! -d "$vdir" ]; then
    VER_WHY="no kept version $name under \$HOME/ccrc-versions"
    return 1
  fi
  [ -f "$vdir/ccd/ccrc" ] || { VER_WHY="no ccd/ccrc"; return 2; }
  if [ "$role" = fleet ]; then
    [ -f "$vdir/agent/dist/agent/src/index.js" ] || { VER_WHY="no agent build"; return 2; }
  else
    [ -f "$vdir/server/dist/server/src/index.js" ] || { VER_WHY="no server build"; return 2; }
  fi
  [ -f "$vdir/$VER_STAMP_COPY" ] || { VER_WHY="no kept stamp"; return 2; }
  [ -f "$vdir/$VER_RECORD_COPY" ] || { VER_WHY="no kept install record"; return 2; }
  # The one stamp parser, pointed at the kept copy — `_upd_converged`'s
  # save-and-restore, so the caller keeps the box's own fields.
  saved=(${BOX_BUILD[@]+"${BOX_BUILD[@]}"})
  if ! _box_build_fields "$vdir/$VER_STAMP_COPY"; then
    BOX_BUILD=(${saved[@]+"${saved[@]}"})
    VER_WHY="its kept stamp does not parse"
    return 2
  fi
  v="${BOX_BUILD[4]}"
  BOX_BUILD=(${saved[@]+"${saved[@]}"})
  if [[ "$name" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] && [ "$v" != "$name" ]; then
    VER_WHY="its kept stamp reads ${v:-an unversioned build}, not $name"
    return 2
  fi
  return 0
}

# `_ver_can_flip` — can this box make the $HOME/ccrc flip? (W6 Task 4,
# D-3419 as amended). `_plat_ln_swap`'s Darwin arm is
# python3's os.replace, and `cmd_install`'s Darwin preflight names python3
# for every spine. Two flips run in the `cmd_update`/`cmd_rollback` PARENT,
# where no spine preflight has run — `_ver_flip_back`'s and
# `_upd_legacy_target`'s — and each asks this first, so a missing python3 is
# named before anything moves instead of surfacing as "the one rename
# failed". Not a verb-level probe: a Darwin `ccrc update` that flips nothing
# (a `directory` box moving to an older spine, or `--check`) needs no
# python3. Builtins only, so it answers on any PATH.
_ver_can_flip() {   # -> 0 can flip; 1 cannot (VER_WHY)
  VER_WHY=""
  if [ "$CCD_OS" = darwin ] && ! command -v python3 >/dev/null 2>&1; then
    VER_WHY="python3 is not on PATH — on macOS the \$HOME/ccrc flip is one rename(2) through os.replace; install the Xcode Command Line Tools: xcode-select --install"
    return 1
  fi
  return 0
}

# `_ver_flip_back <name> <role> <prefix>` (D-3439)
# — point ~/ccrc at the kept version (ONE rename, `_plat_ln_swap`), restore
# its kept stamp, clear the record, and run THAT version's own `ccrc
# install` from the flipped tree: it re-places what the tree feeds outside
# itself (`~/.local/bin/ccd` and the other executables, the session hooks,
# the units), and its `_inst_enable` is the restart. rc 0: flipped, and its
# spine COMPLETED — the record it writes last is present; a trailing doctor
# FAIL with the record written is a completed spine (D-3114's reading).
# rc 1: nothing changed (VER_WHY). rc 2: flipped, but the spine did not
# complete (VER_WHY) — ~/ccrc stays on <name> and the box reads
# `incomplete`, which is true.
#   The STAMP is restored for a spine too old to stamp from its kept copy
# (`_inst_stamp_shipped`'s fallback is this wave's). The RECORD is cleared,
# never restored: a record written before the spine would make "present
# afterwards" true for a spine that never ran — `cmd_update`'s own rule for
# its staged spine. The spine writes it back, byte-equal to the kept copy,
# because `CCRC_UPDATE_VERIFIED=1` is passed exactly when that copy says the
# version was verified: a verified version stays verified, an unverified
# one is never promoted. The caps file is cleared beside it (D-3147's
# reason). The lock descriptor is closed for the spine as `cmd_update`
# closes it for its staged one. Main shell only.
_ver_flip_back() {   # <name> <role> <prefix>
  local name="$1" role="$2" say="$3" vdir="$BOX_VERSIONS_ROOT/$1" krc=0 src=0 m1="" m2=""
  local stamp="$BOX_STAMP_FILE"
  local rec="$BOX_INSTALLED_FILE"
  local -a spine=(bash "$BOX_TREE_DIR/ccd/ccrc" install)
  local -a spine_env=(env -u CCRC_UPDATE_LOCK_HELD -u CCRC_UPDATE_VERIFIED)
  _ver_can_flip || return 1
  _ver_kept "$name" "$role" || krc=$?
  case "$krc" in
    0) ;;
    1) return 1 ;;
    *) VER_WHY="\$HOME/ccrc-versions/$name is incomplete ($VER_WHY)"; return 1 ;;
  esac
  { IFS= read -r m1; IFS= read -r m2; } < "$vdir/$VER_RECORD_COPY" 2>/dev/null || :
  [ "$m2" = unsigned ] || spine_env=(env -u CCRC_UPDATE_LOCK_HELD CCRC_UPDATE_VERIFIED=1)
  [ -n "$role" ] && spine+=(--role "$role")
  if ! _plat_ln_swap "$vdir" "$BOX_TREE_DIR"; then
    VER_WHY="the one rename that points \$HOME/ccrc at \$HOME/ccrc-versions/$name failed"
    return 1
  fi
  if ! { mkdir -p -- "${stamp%/*}" && cp -- "$vdir/$VER_STAMP_COPY" "$stamp.tmp.$$" \
           && chmod 644 "$stamp.tmp.$$" && _plat_mv_notdir "$stamp.tmp.$$" "$stamp"; }; then
    rm -f -- "$stamp.tmp.$$"
    VER_WHY="its kept stamp could not be put back as this box's stamp"
    return 2
  fi
  if ! rm -f -- "$rec" "$BOX_CAPS_FILE"; then
    VER_WHY="the completed-install record could not be cleared before its spine ran"
    return 2
  fi
  echo "$say: flip: \$HOME/ccrc -> \$HOME/ccrc-versions/$name (one rename); its kept stamp restored — running its own spine: bash \$HOME/ccrc/ccd/ccrc install${role:+ --role $role}"
  if [ -n "${UPD_LOCK_FD:-}" ]; then
    ( exec {UPD_LOCK_FD}>&-; exec "${spine_env[@]}" "${spine[@]}" ) || src=$?
  else
    "${spine_env[@]}" "${spine[@]}" || src=$?
  fi
  if [ ! -f "$rec" ]; then
    VER_WHY="its own spine exited $src without writing its completed-install record"
    return 2
  fi
  [ "$src" -eq 0 ] || echo "$say: flip: $name's spine completed (its record is written) but its trailing doctor exited $src — the FAIL lines above are the box's health; the gate decides"
  echo "$say: flip: \$HOME/ccrc -> \$HOME/ccrc-versions/$name; its stamp and install record restored; its own spine re-placed the executables, hooks and units (no release download)"
  return 0
}

# ── _upd_restore_arm1 <role> <reason> — a flip back to the kept previous ───
# version (design §11's arm 1, W6 Task 4). rc 0 restored; rc 1 fall to arm
# 2. Every refusal BEFORE a flip names its reason and changes nothing. After
# the flip, `_ver_flip_back` re-runs the kept version's own spine and the
# gate runs once more, on THAT tag. A ~/ccrc that never left <prev> is no
# refusal (D-3445): a W6 staged spine that died inside
# `_inst_tree` BEFORE its flip (its `npm ci` in the new directory, the
# verb's likeliest failure) reads as moved to wave 4's `_upd_step_moved`,
# so the gate ran and failed while the running version was untouched. Arm
# 2 would re-download <prev>, and that child's same-name path would rsync
# `--delete` and `npm ci` INTO the directory the live units run from. In
# place, the rename is onto the target the link already names, and the
# kept spine runs from that version with its kept record present: no copy,
# no `npm ci`. If either fails
# (D-3443), ~/ccrc is pointed back at the version
# this run installed and the completed-install record is cleared: arm 2's
# child is then the NEW tree's `ccd/ccrc` (wave 4's arm 2 assumes it), and
# it finds a box that reads `incomplete`. With arm 1's restored stamp and the
# kept spine's record left in place, that child's `_upd_converged` would
# answer "already runs <prev>" and install nothing while ~/ccrc names the new
# version. Main shell only (arm 2's `$PPID` rule is the caller's).
#   The re-gate rewrites UPD_GATE_WHY, and `cmd_update`'s exit-4 sentence,
# printed after `_upd_restore` returns, names the FIRST gate's failure from
# it — so the first gate's words are put back on both results
# (D-3444).
_upd_restore_arm1() {   # <role> <reason>
  local role="$1" reason="$2" prc=0 krc=0 frc=0 cur="" why="" back="" first_why="$UPD_GATE_WHY"
  local where="" done_as=""
  _upd_read_previous || prc=$?
  case "$prc" in
    0) ;;
    1) echo "update: arm 1: no ~/.ccrc/previous — arm 2"; return 1 ;;
    2) echo "update: arm 1: the previous build carried no tag — arm 2"; return 1 ;;
    *) echo "update: arm 1: ~/.ccrc/previous is unreadable or malformed — arm 2"; return 1 ;;
  esac
  _ver_layout
  case "$VER_LAYOUT" in
    linked|migrated) ;;
    *) echo "update: arm 1: \$HOME/ccrc is not versioned ($VER_LAYOUT) — arm 2"; return 1 ;;
  esac
  cur="$VER_CURRENT"
  _ver_kept "$UPD_PREV_TAG" "$role" || krc=$?
  case "$krc" in
    0) ;;
    1) echo "update: arm 1: no kept version $UPD_PREV_TAG under \$HOME/ccrc-versions — arm 2"; return 1 ;;
    *) echo "update: arm 1: \$HOME/ccrc-versions/$UPD_PREV_TAG is incomplete ($VER_WHY) — arm 2"; return 1 ;;
  esac
  if [ "$cur" = "$UPD_PREV_TAG" ]; then
    # D-3445 — see the header.
    where="\$HOME/ccrc never left \$HOME/ccrc-versions/$UPD_PREV_TAG; its own spine re-ran"
    done_as="restored $UPD_PREV_TAG in place"
    echo "update: arm 1: \$HOME/ccrc still points at $UPD_PREV_TAG, which is kept complete — re-running its own spine in place (no download)"
  else
    where="\$HOME/ccrc flipped back to \$HOME/ccrc-versions/$UPD_PREV_TAG"
    done_as="flipped back to $UPD_PREV_TAG"
    echo "update: arm 1: $UPD_PREV_TAG is kept at \$HOME/ccrc-versions/$UPD_PREV_TAG — flipping back to it (no download)"
  fi
  _ver_flip_back "$UPD_PREV_TAG" "$role" update || frc=$?
  case "$frc" in
    0)
      # "Run the gate once more" (design §11) — on the tag it returned to.
      if _upd_gate "$role" "$UPD_PREV_TAG"; then
        UPD_GATE_WHY="$first_why"
        _upd_phase reverted "arm1: $done_as; $reason"
        echo "update: REVERTED (arm 1): this box runs $UPD_PREV_TAG again — $where, no download — $reason"
        return 0
      fi
      why="gate: $UPD_GATE_WHY"
      UPD_GATE_WHY="$first_why" ;;
    1)
      echo "update: arm 1: could not flip to $UPD_PREV_TAG ($VER_WHY) — nothing changed; arm 2"
      return 1 ;;
    *)
      why="the spine did not complete: $VER_WHY" ;;
  esac
  if [ "$cur" = "$UPD_PREV_TAG" ]; then
    back="\$HOME/ccrc stays on $cur, which it never left"
  elif _plat_ln_swap "$BOX_VERSIONS_ROOT/$cur" "$BOX_TREE_DIR"; then
    back="\$HOME/ccrc points at $cur again"
  else
    back="\$HOME/ccrc could NOT be pointed back at $cur (the one rename failed), so arm 2's child is $UPD_PREV_TAG's own ccrc"
  fi
  if ! rm -f -- "$BOX_INSTALLED_FILE" 2>/dev/null; then
    back="$back; the completed-install record could not be cleared, so arm 2's child may read this box as already on $UPD_PREV_TAG"
  fi
  echo "update: arm 1 failed ($why) — $back; falling to arm 2"
  return 1
}

# `_upd_legacy_target <tag>` (D-3440) — a staged
# spine older than versioned installs rsyncs `--delete` into $HOME/ccrc,
# i.e. THROUGH the link into whichever version it names. So before that
# spine runs, ~/ccrc is pointed at a directory named for the tag it
# installs: the kept one, or a copy of the pointed-at version (its two kept
# copies removed — they described the source), which the old spine then
# rewrites. The directory's name stays true, and the version this run
# replaces is never written. A kept directory stops claiming completeness
# first (its record copy removed): its content is about to be rewritten by
# a spine that keeps nothing, and `_ver_keep_state update` re-marks it only
# after that spine completes. `cmd_update` calls this BEFORE it clears the
# record, the step marker and the caps, so a death here leaves them as they
# were; only the backup and `previous` this run wrote are new.
_upd_legacy_target() {   # <tag> -> 0, or dies before anything is installed
  local tag="$1" cur="$VER_CURRENT" dir="$BOX_VERSIONS_ROOT/$1" inc="$BOX_VERSIONS_ROOT/.$1.incoming.$$" how="kept" made=0
  local refuse="could not give $tag's older spine a directory of its own under \$HOME/ccrc-versions — nothing was installed; \$HOME/ccrc still points at $cur"
  _ver_can_flip || _ccrc_die "$refuse ($VER_WHY)"
  if [ -L "$dir" ] || { [ -e "$dir" ] && [ ! -d "$dir" ]; }; then
    _ccrc_die "$refuse (\$HOME/ccrc-versions/$tag is not a directory ccrc placed)"
  fi
  if [ -d "$dir" ]; then
    rm -f -- "$dir/$VER_RECORD_COPY" || _ccrc_die "$refuse"
  else
    how="a copy of $cur"
    rm -rf -- "$inc" 2>/dev/null
    if ! { cp -a -- "$BOX_VERSIONS_ROOT/$cur" "$inc" \
             && rm -f -- "$inc/$VER_STAMP_COPY" "$inc/$VER_RECORD_COPY" \
             && mv -- "$inc" "$dir"; }; then
      rm -rf -- "$inc" 2>/dev/null
      _ccrc_die "$refuse"
    fi
    made=1
  fi
  if ! _plat_ln_swap "$dir" "$BOX_TREE_DIR"; then
    [ "$made" -eq 1 ] && rm -rf -- "$dir" 2>/dev/null
    _ccrc_die "$refuse"
  fi
  echo "update: tree: $tag's spine predates versioned installs and writes through \$HOME/ccrc — \$HOME/ccrc now points at \$HOME/ccrc-versions/$tag ($how) for it to write into"
}
```

**(c) `_upd_restore`'s order.** In wave 4's `_upd_restore` (`grep -n '^_upd_restore() {' ccd/ccrc`), insert immediately BEFORE its line `  _upd_restore_arm2 "$reason" && return 0`:

```bash
  _upd_restore_arm1 "$role" "$reason" && return 0
```

and in its header comment replace the three lines

```bash
# (design 2026-09-20 §11). Arm 1 (a kept version directory) is wave 6's; this
# wave has arm 2 — re-install the release that was running, as a synchronous
# child under THIS run's lock — falling to arm 3 — copy this run's backup back.
```

with

```bash
# (design 2026-09-20 §11). Arm 1 — flip ~/ccrc back to the previous tag's
# kept version and re-run its own spine, no download (W6 Task 4) — falling
# to arm 2 — re-install the release that was running, as a synchronous child
# under THIS run's lock — falling to arm 3 — copy this run's backup back.
```

Then `grep -n '^  _upd_restore_arm[123] ' ccd/ccrc` prints exactly the three call lines inside `_upd_restore`, arm 1 first.

**(d) Arm 3's void.** In wave 4's `_upd_restore_arm3`, immediately BEFORE its line `  echo "update: arm 3: copying this run's pre-update backup ($UPD_BACKUP_DIR) back over the install"`, insert:

```bash
  # D-3441 (W6 Task 4): the copy below lands
  # through the link, in the version ~/ccrc points at — which then holds a
  # MIXED tree. Voided FIRST, as the record above is (D-3260): no later flip
  # returns to it, and GC reads it incomplete.
  _ver_layout
  case "$VER_LAYOUT" in
    linked|migrated)
      if rm -f -- "$BOX_TREE_DIR/$VER_RECORD_COPY" 2>/dev/null; then
        echo "update: arm 3: \$HOME/ccrc-versions/$VER_CURRENT is where the copy lands, so it will hold a MIXED tree — its kept install record is removed first, so no flip returns to it"
      else
        echo "update: arm 3: could not remove \$HOME/ccrc-versions/$VER_CURRENT's kept install record — a later flip could return to a MIXED tree"
        unrec="$unrec (the kept install record of $VER_CURRENT could not be removed)"
      fi ;;
  esac
```

(`unrec` is arm 3's own `local`, joined into its `reverted` detail by its existing `note="$note$unrec"` line.)

**(e) `cmd_update` — a foreign `~/ccrc`, the older spine's directory, and the kept copies.** First, immediately AFTER Task 3's FIRST `  _inst_migrate_resume update` (the one below `  UPD_REPORTING=1`; `grep -n -A8 '^  UPD_REPORTING=1$' ccd/ccrc` shows it, after Task 3's six-line comment), insert:

```bash
  # D-3429 (W6 Task 4, amending Task 2's): a $HOME/ccrc
  # this ccrc did not make is refused HERE — before the old-identity read,
  # the backup and any download — and not left to the staged spine. That
  # spine's own `_inst_tree` refusal dies AT `_inst_tree`, which
  # `_upd_step_moved` reads as moved: the gate would fail on the version and
  # the restore arms would run over the foreign link (arm 2's child is
  # whatever `ccd/ccrc` it names, an older spine rsyncs `--delete` through
  # it, arm 3 copies through it). `crashed` was completed on the line above.
  _ver_layout
  case "$VER_LAYOUT" in
    foreign|unreadable)
      _ccrc_die "update: \$HOME/ccrc is $VER_WHY — refusing to place or flip a tree over something this ccrc did not make; nothing was downloaded or installed, and \$HOME/ccrc and \$HOME/ccrc-versions were not touched" ;;
  esac
```

Then, immediately AFTER wave 4 Task 6's line `  _upd_marker_unsigned && UPD_PREV_UNSIGNED=1` (inside `cmd_update`), insert:

```bash
  # D-3440 (W6 Task 4): a staged spine older
  # than versioned installs rsyncs `--delete` into $HOME/ccrc — through the
  # link, into the version this run is replacing. Hand it a directory named
  # for its own tag first. A same-name reinstall writes in place
  # (D-3426). Here, BEFORE the record, the step
  # marker and the caps are cleared, so a refusal leaves all three as they were.
  _ver_layout
  if ! grep -q '^BOX_VERSIONS_ROOT=' "$UPD_TREE/ccd/ccrc" 2>/dev/null; then
    case "$VER_LAYOUT" in
      linked|migrated) [ "$VER_CURRENT" = "$UPD_VERSION" ] || _upd_legacy_target "$UPD_VERSION" ;;
    esac
  fi
```

and immediately BEFORE wave 4 Task 5's line `  # ── THE HEALTH GATE (design §11) ─────────…` insert:

```bash
  # D-3428 (W6 Task 4): the version $HOME/ccrc points
  # at keeps the stamp and record this spine wrote — idempotent after a W6
  # spine's own `_inst_installed`, and the ONLY writer of them for a spine
  # older than W6. Silent unless the record is present (a completed spine,
  # or D-3114's doctor-FAIL arm); a spine that died wrote none.
  _ver_keep_state update

```

**(f) `cmd_rollback` — the kept check.** In wave 4's `cmd_rollback`, replace the block from `  _upd_asset_listed "$to" SHA256SUMS || erc=$?` through the `  esac` that closes its `case "$erc" in` (the `command -v curl` probe above it stays exactly where it is) with:

```bash
  # D-3442 (W6 Task 4): a COMPLETE kept
  # version answers the existence question itself — the tag was installed,
  # and completed, on this box — so the release host is not asked and
  # nothing is downloaded. The role is read as `cmd_update` reads it. Any
  # other tag asks, exactly as before (D-3244). A $HOME/ccrc this ccrc did
  # not make is refused here, before the release host is asked, the lock is
  # taken or `--detach` hands the run on (D-3429 as
  # amended; `cmd_update` refuses it too, for the re-install arm).
  local role="" kept=0 frc=0 now=""
  if [ -f "$BOX_ENV_FILE" ] && [ -r "$BOX_ENV_FILE" ]; then
    role="$(_box_env_value "$BOX_ENV_FILE" CCRC_ROLE)"
  fi
  case "$role" in server|fleet|both) ;; *) role="" ;; esac
  # W6 Task 3 (D-3437, applied here): a
  # crashed migration reads `crashed` — neither `linked` nor `migrated` — so
  # a kept tag would read as NOT kept, and the rollback would ask the release
  # host and download. It is completed first, before the kept check and so
  # before `--detach`'s hand-off to the shim, which cannot run with no
  # ~/ccrc — but only while the lock probe answers FREE: a held lock is an
  # update that owns the link (its own resumes complete it), and every other
  # probe answer is refused below, in its own words, by `_upd_lock` or
  # `_upd_detach` (ruling R16), so nothing is folded here.
  _ver_layout
  if [ "$VER_LAYOUT" = crashed ] && _upd_lock_probe; then
    _inst_migrate_resume rollback
  fi
  _ver_layout
  case "$VER_LAYOUT" in
    linked|migrated) _ver_kept "$to" "$role" && kept=1 ;;
    foreign|unreadable) _ccrc_die "rollback: \$HOME/ccrc is $VER_WHY — refusing to place or flip a tree over something this ccrc did not make; nothing on this box was changed" ;;
  esac
  if [ "$kept" -eq 1 ]; then
    echo "rollback: $to is kept at \$HOME/ccrc-versions/$to — no release-host question and no download"
  else
    _upd_asset_listed "$to" SHA256SUMS || erc=$?
    case "$erc" in
      0) ;;
      1) echo "$PROG: rollback: $to is not a published release (its SHA256SUMS answered 404) — nothing on this box was changed" >&2
         exit 2 ;;
      *) _ccrc_die "rollback: could not ask the release host whether $to exists (curl failed, or the host answered neither 200 nor 404) — nothing on this box was changed" ;;
    esac
  fi
```

**(g) `cmd_rollback` — the flip path.** Immediately AFTER its two lines `  local run_from=rollback` / `  [ "$from" = watchdog ] && run_from=watchdog`, insert:

```bash
  if [ "$kept" -eq 1 ]; then
    # ROLLBACK BY FLIP (design §11: rollback "runs arm 1 or arm 2 above, then
    # the gate, then _upd_sweep"; "rollback after W5 is arm 1"). Re-measured
    # under this verb's own lock. A box already on the tag whose install
    # completed has nothing to do. Otherwise `_ver_flip_back` points ~/ccrc
    # at the kept version and runs its own spine, then the gate, then the
    # sweep behind its KillMode=process preflight: a PRIOR update's sweep
    # moved the supervisors onto the build this replaces. `previous` is never
    # rewritten; the floor never lowers. A flip that changed nothing falls
    # through to update's own re-install below.
    if _box_build_fields; then now="${BOX_BUILD[4]}"; fi
    _ver_layout
    if [ "$VER_CURRENT" = "$to" ] && [ "$now" = "$to" ] && cmp -s -- "$BOX_INSTALLED_FILE" "$BOX_VERSIONS_ROOT/$to/$VER_RECORD_COPY"; then
      echo "rollback: this box already runs $to (\$HOME/ccrc points at \$HOME/ccrc-versions/$to and its install completed) — nothing to do"
      _upd_unlock
      return 0
    fi
    UPD_FROM="$run_from"
    UPD_VERSION="$to"
    UPD_REPORT_TARGET="$to"
    UPD_REPORTING=1
    _inst_migrate_resume update
    _upd_phase installing "rollback by flip to $to"
    echo "rollback: returning this box to $to (named by $via; asked by --from $from) — a flip of \$HOME/ccrc to its kept version and its own spine, as --from $run_from: below the floor if need be, and the floor itself is never lowered"
    _ver_flip_back "$to" "$role" rollback || frc=$?
    case "$frc" in
      0)
        # D-3243 on this path too: a failed gate is not restored.
        _upd_gate "$role" "$to" || _upd_rollback_no_restore "gate: $UPD_GATE_WHY"
        _inst_migrate_finish rollback "the health gate passed"
        _upd_phase restarting
        _upd_unlock
        _upd_sweep
        _upd_phase done "rolled back by flip to $to"
        echo "rollback: this box runs $to again — flipped back to \$HOME/ccrc-versions/$to, no download"
        return 0 ;;
      1)
        echo "rollback: $to could not be flipped to ($VER_WHY) — rolling back by re-install instead" ;;
      *)
        _upd_phase failed "rollback to $to: the kept spine did not complete; $VER_WHY"
        UPD_REPORTING=0
        _ccrc_die "rollback: \$HOME/ccrc points at \$HOME/ccrc-versions/$to, but its own spine did not complete ($VER_WHY) — read its lines above; 'ccrc update --check' says where this box stands" ;;
    esac
  fi
```

**(h) `usage()`.** In wave 4's `rollback` entry, replace its last line `            [--from <who>] names the caller (${UPD_FROM_WORDS[*]})` with:

```
            [--from <who>] names the caller (${UPD_FROM_WORDS[*]}).
            A version kept under ~/ccrc-versions is rolled back to by a
            flip of ~/ccrc and its own spine, with no download.
```

Then, from the repo root:

```bash
bash -n ccd/ccrc
grep -n 'BOX_STAMP_FILE' ccd/ccrc | grep -v '^[0-9]*: *#'
grep -n 'BOX_INSTALLED_FILE' ccd/ccrc | grep -v '^[0-9]*: *#'
grep -n '\.ccrc/installed\|\$HOME/\.ccrc/build\.json' ccd/ccrc | grep -v '^[0-9]*: *#'
```

Expected: `bash -n` silent. The first listing ends with the `local stamp="$BOX_STAMP_FILE"` line, one more than before this step. The second holds exactly three new lines, and Step 3 (e)'s entries must sit where this listing puts them; move an entry if another function's line falls between. The third prints only the two definition lines, `BOX_STAMP_FILE="$HOME/.ccrc/build.json"` and `BOX_INSTALLED_FILE="$HOME/.ccrc/installed"`. Every sentence in this task spells the record as "the completed-install record" for exactly this reason: the first assertion of each census reds on any code line naming either path.

- [ ] **Step 6: Run to verify they pass**

Run, one file at a time from inside `server/`, foreground, timeout ≥ 600000 ms:

- `./node_modules/.bin/vitest run test/ccrc-update.test.ts` — Expected: PASS, the case count up by exactly 22 on the Step 1 baseline: six arm-1, nine rollback (the ninth, the crashed-migration case, added by Task 3's review), five older-spine and two refusal cases. A smaller green is still a claim to check. Wave 4's arm-2 and arm-3 cases keep their outcomes: their real-directory boxes print `update: arm 1: $HOME/ccrc is not versioned (directory) — arm 2`, or, where a FULL spine migrated the box, `update: arm 1: no kept version v1.0.0 under $HOME/ccrc-versions — arm 2`, and then run arm 2 exactly as before. A case that reds there is a finding to report, not a test to relax.
- `./node_modules/.bin/vitest run test/ccrc-install.test.ts` — Expected: PASS. The caps cases read eight words on Linux and seven on Darwin, and the presence pin finds `_upd_restore_arm1() {` and `_ver_flip_back() {`.
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — Expected: PASS, with both censuses exact.
- `./node_modules/.bin/vitest run test/macos-platform.test.ts` — Expected: PASS. `cp -a --`, `rm -f --`, `mv --`, `cmp -s --` and `grep -q` are BSD-clean; every flip is `_plat_ln_swap` and every file placement `_plat_mv_notdir`; no platform helper was added.
- `./node_modules/.bin/vitest run test/compact-card-ship.test.ts` — Expected: PASS (`_upd_backup_set` untouched).
- `./node_modules/.bin/vitest run test/ccrc-cli.test.ts` — Expected: PASS (no verb added; the `rollback` entry's first line is unchanged).
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — Expected: PASS.

`pathWithout`'s list (`ccrc-install.test.ts:686-707`) is untouched: nothing here runs on the install path. `_ver_flip_back`, `_upd_legacy_target`, `_ver_can_flip` and the kept arm run inside `ccrc update` and `ccrc rollback`, and `grep` and `cmp` are on their PATH (`_ver_can_flip` itself uses builtins only).

- [ ] **Step 7: Mutation measurements**

From the repository root. `mut` replaces EXACTLY one occurrence or refuses, so a mistyped anchor cannot measure green. `restore` puts the byte copy back and compares it. Never `git checkout --`, which would discard the uncommitted task:

```bash
KEEP="$(mktemp -d)"; cp ccd/ccrc "$KEEP/ccrc"
mut() { python3 -c 'import sys; p="ccd/ccrc"; s=open(p).read(); a,b=sys.argv[1],sys.argv[2]; n=s.count(a); assert n==1, f"{n} matches for {a!r}"; open(p,"w").write(s.replace(a,b))' "$1" "$2"; }
restore() { cp "$KEEP/ccrc" ccd/ccrc && cmp ccd/ccrc "$KEEP/ccrc" && echo restored; }
T() { (cd server && ./node_modules/.bin/vitest run "test/$1" -t "$2"); }
```

Each row: apply, run the named case, observe RED with the stated reason, `restore`.

1. **§18 "the gate restores" — arm 1 in the order:** `mut $'  _upd_restore_arm1 "$role" "$reason" && return 0\n' ''` → `T ccrc-update.test.ts 'restores by arm 1'` RED (`REVERTED (arm 2)`: the real child re-installed v1.0.0 from its release; the `v1.0.0 is kept` line absent).
2. **D-3428 at the consumer:** (a) `mut 'cp -- "$vdir/$VER_STAMP_COPY" "$stamp.tmp.$$"' 'cp -- "$stamp" "$stamp.tmp.$$"'` (the restore puts the box's own stamp back) → `T ccrc-update.test.ts 'bare .ccrc rollback. to a kept version'` RED (the recorder spine stamps nothing: `/health` answers v2.0.0, the gate on v1.0.0 fails, exit 1), while `'restores by arm 1'` stays GREEN, because Task 2's fallback restamps from the kept copy — the belt; (b) keep (a) and also `mut '    shipped="$CCRC_HERE/../$VER_STAMP_COPY"' '    :'` (Task 2 Step 3 (g) spells the fallback as an `if [ ! -f "$shipped" ]; then` block whose first body line is this one; neutered, `shipped` stays the absent `build.json` and `_inst_stamp_shipped` returns 1) → `'restores by arm 1'` RED (the stamp stays v2.0.0, `/health` stays denied, arm 1's gate fails, arm 2 runs). `restore`.
3. **D-3439:** `mut '    ( exec {UPD_LOCK_FD}>&-; exec "${spine_env[@]}" "${spine[@]}" ) || src=$?' '    :'` and `mut '    "${spine_env[@]}" "${spine[@]}" || src=$?' '    :'` → `'restores by arm 1'` RED (no record after the flip: rc 2, `arm 1 failed (the spine did not complete: …)`); `'bare .ccrc rollback. to a kept version'` RED (exit 1, no `kept-spine-argv`); `'a FULL rollback by flip'` RED. `restore`.
4. **D-3443 — the flip back:** `mut '  elif _plat_ln_swap "$BOX_VERSIONS_ROOT/$cur" "$BOX_TREE_DIR"; then' '  elif true; then'` → `T ccrc-update.test.ts 'hands arm 2 the NEW tree'` RED: the child's spine reads `install: tree: reinstalled v1.0.0 in place …`, so the `(was $HOME/ccrc-versions/v2.0.0)` line is absent. `T ccrc-update.test.ts 'voids THAT version'` RED: the link ends on v1.0.0, and the void lands on the kept v1.0.0. `restore`.
5. **D-3443 — the record cleared:** `mut '  if ! rm -f -- "$BOX_INSTALLED_FILE" 2>/dev/null; then' '  if false; then'` → `'hands arm 2 the NEW tree'` RED (the child prints `update: this box already runs v1.0.0 … nothing to do`, and the link ends on v2.0.0). `'voids THAT version'` stays GREEN, because arm 3 removes the record there anyway, which is why the arm-2 case exists. `restore`.
6. **D-3440 — the call:** `mut '      linked|migrated) [ "$VER_CURRENT" = "$UPD_VERSION" ] || _upd_legacy_target "$UPD_VERSION" ;;' '      linked|migrated) : ;;'` → `T ccrc-update.test.ts 'spine older than W6'` RED on the copy, kept and refused cases (no `predates` line; `WROTE-BY-OLD-SPINE` lands in v2.0.0 and its `treeDigest` moves; the refused case exits 0). `restore`.
7. **D-3440 — the kept directory stops claiming completeness:** `mut '    rm -f -- "$dir/$VER_RECORD_COPY" || _ccrc_die "$refuse"' '    :'` → `T ccrc-update.test.ts 'pointed at IT'` RED (`old-spine-saw-record` reads `present`). `restore`.
8. **The legacy target placed above the record's removal (this task's correction):** move the block instead of rewriting a line:
```bash
python3 - <<'PY'
p = "ccd/ccrc"; s = open(p).read()
i = s.index("  # than versioned installs rsyncs `--delete` into $HOME/ccrc — through the")
start = s.rindex("\n", 0, i - 1) + 1   # the block's first comment line
end = s.index("  fi\n", s.index("_upd_legacy_target \"$UPD_VERSION\"", start)) + len("  fi\n")
block = s[start:end]; s = s[:start] + s[end:]
anchor = '  rm -f "$BOX_INSTALLED_FILE"\n'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + block); open(p, "w").write(s)
PY
```
→ `T ccrc-update.test.ts 'cannot be made'` RED (the completed-install record is gone). `restore`.
9. **D-3441:** `mut '      if rm -f -- "$BOX_TREE_DIR/$VER_RECORD_COPY" 2>/dev/null; then' '      if true; then'` → `'voids THAT version'` RED (`v2.0.0/.ccrc-installed` survives; the follow-up `rollback --to v2.0.0` is kept, flips and fails its gate at exit 1 instead of refusing at 2). `restore`.
10. **D-3442:** `mut '    linked|migrated) _ver_kept "$to" "$role" && kept=1 ;;' '    linked|migrated) : ;;'` → `'bare .ccrc rollback. to a kept version'` and `'a FULL rollback by flip'` RED (exit 2: `fixture-release-http` answers 404). `restore`.
11. **D-3428 at the writer:** `mut $'  _ver_keep_state update\n' ''` → `'a COPY of the running version'` RED (no `versions: kept v1.0.0's …` line; `v1.0.0/.ccrc-stamp.json` absent). `restore`.
12. **The verified flag, both directions:** (a) `mut '  [ "$m2" = unsigned ] || spine_env=(env -u CCRC_UPDATE_LOCK_HELD CCRC_UPDATE_VERIFIED=1)' '  spine_env=(env -u CCRC_UPDATE_LOCK_HELD CCRC_UPDATE_VERIFIED=1)'` → `'stays unverified'` RED (`verified=1`). `restore`. (b) `mut '  [ "$m2" = unsigned ] || spine_env=(env -u CCRC_UPDATE_LOCK_HELD CCRC_UPDATE_VERIFIED=1)' '  :'` → `'bare .ccrc rollback. to a kept version'` RED (`verified=unset`). `restore`.
13. **The lock descriptor closed for the kept spine (Linux):** `mut '    ( exec {UPD_LOCK_FD}>&-; exec "${spine_env[@]}" "${spine[@]}" ) || src=$?' '    "${spine_env[@]}" "${spine[@]}" || src=$?'` → `'bare .ccrc rollback. to a kept version'` RED on Linux (`lockfd=inherited`). On macOS the row reads `unmeasured` either way, which the case states. `restore`.
14. **"Nothing to do" needs the record:** `mut ' && cmp -s -- "$BOX_INSTALLED_FILE" "$BOX_VERSIONS_ROOT/$to/$VER_RECORD_COPY"; then' '; then'` → `T ccrc-update.test.ts 'has nothing to do'` RED (the incomplete box answers `nothing to do`, and `kept-spine-argv` is absent). `restore`.
15. **D-3243 on the flip path, and its `UPD_VERSION`:** (a) `mut '        _upd_gate "$role" "$to" || _upd_rollback_no_restore "gate: $UPD_GATE_WHY"' '        _upd_gate "$role" "$to" || :'` → `T ccrc-update.test.ts 'whose gate fails is not restored'` RED (exit 0, `done`). `restore`. (b) `mut $'    UPD_VERSION="$to"\n' ''` → the same case RED (the detail reads `rollback to : gate: …`). `restore`.
16. **The kept spine that did not complete is not gated:** `mut $'        _upd_phase failed "rollback to $to: the kept spine did not complete; $VER_WHY"\n        UPD_REPORTING=0\n' ''` → `T ccrc-update.test.ts 'does not complete'` RED (the report's detail is the die's sentence, not `rollback to v1.0.0: the kept spine did not complete; …`). `restore`.
17. **The cap word:** `mut 'CCRC_CAP_WORDS=(verify node-id floor update-json update-gate rollback versions)' 'CCRC_CAP_WORDS=(verify node-id floor update-json update-gate rollback)'` → `T ccrc-install.test.ts 'ccrc-caps|cap word'` RED on 4 cases, and `T ccrc-update.test.ts 'check'` RED on every `caps=` case. `restore`.
18. **Arm 1's refusals and `_ver_kept`'s stamp check (sourced tables):** (a) `mut '    *) echo "update: arm 1: \$HOME/ccrc is not versioned ($VER_LAYOUT) — arm 2"; return 1 ;;' '    *) ;;'` → `T ccrc-update.test.ts 'arm 1 refuses BEFORE any flip'` RED on its `a real-directory box` row (the refusal line is `no kept version v1.0.0 under $HOME/ccrc-versions` instead). `restore`. (b) `mut '  if [[ "$name" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] && [ "$v" != "$name" ]; then' '  if false; then'` → `T ccrc-update.test.ts '_ver_kept: complete'` RED on its two stamp rows. `restore`. (c) `mut '    [ -f "$vdir/server/dist/server/src/index.js" ] || { VER_WHY="no server build"; return 2; }' '    :'` → the same case RED on `no server build`. `restore`.
19. **D-3444:** `mut $'      if _upd_gate "$role" "$UPD_PREV_TAG"; then\n        UPD_GATE_WHY="$first_why"\n' $'      if _upd_gate "$role" "$UPD_PREV_TAG"; then\n'` → `T ccrc-update.test.ts 'restores by arm 1'` RED (the exit-4 sentence reads `(ccrc.service up, /health at 127.0.0.1:7788 answers v1.0.0)` — the re-gate's PASS — where the first gate's `GET … got no answer (curl exited 7)` belongs). `restore`.
20. **The crashed layout is completed before the kept check (Task 3's review, D-3437):** `mut $'  if [ "$VER_LAYOUT" = crashed ] && _upd_lock_probe; then\n    _inst_migrate_resume rollback\n  fi\n' ''` → `T ccrc-update.test.ts 'completed BEFORE the kept check'` RED (the kept check reads `crashed`, so v1.0.0 reads not kept and the `fixture-release-http` 404 refuses at exit 2). `restore`.
21. **Spec §18 "a standalone rollback sweeps behind the preflight", at the flip path's own call site:** wave 4 measured this row where `cmd_rollback` reached `_upd_sweep` only through its in-process `cmd_update`; the kept path is a second call site. `mut $'        _upd_unlock\n        _upd_sweep\n        _upd_phase done "rolled back by flip' $'        _upd_unlock\n        _upd_phase done "rolled back by flip'` → `T ccrc-update.test.ts 'bare .ccrc rollback. to a kept version|a FULL rollback by flip'` RED on Linux, both cases, on `a rollback by flip must end in the supervisor sweep` (`restartAt` is -1). The assertion is Linux-gated, so on the macOS leg this row reads green by construction; it is measured on Linux. `restore`.
22. **D-3445:** put the draft's refusal back — `mut '    echo "update: arm 1: \$HOME/ccrc still points at $UPD_PREV_TAG, which is kept complete — re-running its own spine in place (no download)"' '    echo "update: arm 1: \$HOME/ccrc already points at $UPD_PREV_TAG — arm 2"; return 1'` → `T ccrc-update.test.ts 'restores it IN PLACE'` RED (no `still points at` line; arm 2's child re-downloads v1.0.0, so `curl-argv` names `download/v1.0.0/`, its same-name rsync strips `CCD_SENTINEL` from `v1.0.0/ccd/ccd`, and the report reads `arm2:`). `restore`.
23. **D-3429 as amended:** (a) `mut '      _ccrc_die "update: \$HOME/ccrc is $VER_WHY' '      : "update: \$HOME/ccrc is $VER_WHY'` → `T ccrc-update.test.ts 'a foreign ~/ccrc'` RED (no refusal sentence: the update goes on past it). `restore`. (b) `mut '    foreign|unreadable) _ccrc_die "rollback: \$HOME/ccrc is' '    foreign|unreadable) : "rollback: \$HOME/ccrc is'` → the same case RED (the rollback asks the release host for `download/v1.0.0/SHA256SUMS` and refuses at exit 2). `restore`.
24. **D-3419 as amended — the python3 probe:** (a) `mut '  if [ "$CCD_OS" = darwin ] && ! command -v python3 >/dev/null 2>&1; then' '  if false; then'` → `T ccrc-update.test.ts 'macOS without python3'` RED on its probe row (`darwin rc=0 why=`). `restore`. (b) `mut '  _ver_can_flip || return 1' '  :'` → the same case RED on its `_ver_flip_back` row (the bare PATH fails a later step, whose `VER_WHY` does not name python3). `restore`. (c) `mut '  _ver_can_flip || _ccrc_die "$refuse ($VER_WHY)"' '  :'` → the same case RED on its `_upd_legacy_target` row (`cp` is not on the bare PATH, so the die is the plain refusal with no python3 in it). `restore`.
25. **`_upd_legacy_target`'s symlink/non-directory refusal:** `mut '  if [ -L "$dir" ] || { [ -e "$dir" ] && [ ! -d "$dir" ]; }; then' '  if false; then'` → `T ccrc-update.test.ts 'not a directory ccrc placed'` RED: the symlink shape treats the link as a kept directory, points `~/ccrc` through it, and the older spine's `WROTE-BY-OLD-SPINE` lands in `somewhere-else` (exit 0); the file shape dies at the copy's `mv` with the plain refusal, without the suffix. `restore`.

Finish with `cmp ccd/ccrc "$KEEP/ccrc" && rm -rf "$KEEP"`, then re-run `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'W6 Task 4'` → PASS. A mutation that reds nothing is a finding, not a pass: stop and report it.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccrc server/test/ccrc-update.test.ts server/test/ccrc-install.test.ts server/test/single-definition.test.ts
git commit -m "feat(ccrc): restore arm 1 and rollback by flip — a kept version is a flip of ~/ccrc and a re-run of its own spine, with no download; a ~/ccrc that never left the previous version is restored in place; a failed arm 1 points back and clears the record; an older spine gets a directory named for its tag; arm 3 voids the MIXED version; update and rollback refuse a foreign ~/ccrc up front; the versions cap word"
```

**Interface corrections this task makes to the skeleton (each measured against wave 4's committed plan and the tree at `d759c914`):**
- `_ver_flip_back` step 3 restores the kept STAMP, and CLEARS the record and the caps file instead of copying the kept record. A record written before the spine makes "present after it" true for a spine that never ran, so the skeleton's own rc-0 test could not tell a completed spine from a skipped one. The record comes back through the spine's own `_inst_installed`, byte-equal to the kept copy, because the verified flag is derived from that copy. Its census line is `local rec="$BOX_INSTALLED_FILE"`, and the stamp's is `local stamp="$BOX_STAMP_FILE"`.
- An empty role runs the kept spine bare. `--role ""` is a usage error; `cmd_update`'s own spine array appends `--role` only when a role was recorded.
- A failed arm 1 also REMOVES the completed-install record after pointing `~/ccrc` back. Without that, a completed kept spine leaves `<prev>`'s stamp and record agreeing, and arm 2's child `update --to <prev>` reads the box converged and installs nothing while `~/ccrc` names the new version. This is one more census line (D-3443).
- `_upd_legacy_target` is called above the record's removal, after Task 6's `UPD_PREV_UNSIGNED` capture, not immediately above the staged-spine invocation: its refusal then leaves the record, the step marker and the caps as they were, so "nothing was installed" is true. It also refuses a symlink or non-directory at the name, voids a kept directory's record before handing it to the older spine, and removes a directory it made when the flip fails.
- `cmd_rollback`'s "already runs" arm also requires `~/.ccrc/installed` to be byte-equal to the kept record. Otherwise D-3264's rerun, `ccrc rollback --to <v>` after a kept spine died past `_inst_stamp`, is answered "nothing to do". This is one more census line.
- The kept path sets `UPD_VERSION=<tag>`: `_upd_rollback_no_restore` spells its detail from it, and nothing on this path runs `_upd_resolve`. On a passed gate it calls `_inst_migrate_finish rollback "the health gate passed"`, because a rollback's passed gate is a passed gate (D-3431). Wave 4's `curl` probe stays ahead of the kept/not-kept split, since the gate needs `curl` on both arms.
- On the kept path, `_ver_flip_back` rc 1 falls through to wave 4's re-install WITHOUT the release-host existence question, which the kept arm skipped. An unpublished tag there dies in `_upd_resolve` at exit 1, not 2.
- Arm 1's re-gate writes a second `checking` (`_upd_gate` is its one writer): the report sequence is `…, checking, restoring, checking, reverted`.
- Arm 3's void sentence is `… is where the copy lands, so it will hold a MIXED tree — its kept install record is removed first …`. The void runs before the copy, as D-3260's removal does, so "now holds" would be said before it is true.
- `_ver_kept` rc 1 sets `VER_WHY` too (`no kept version <name> under $HOME/ccrc-versions`), and a kept stamp with no version reads `its kept stamp reads an unversioned build, not <name>`.
- The mutation row "the flip-back on arm 1's failure deleted → arm 2's recorded child argv is the previous tree's `ccd/ccrc`" cannot red: the child's `$0` is `$HOME/ccrc/ccd/ccrc` whichever version the link names. It is measured instead by the child's own spine transcript (`(was $HOME/ccrc-versions/v2.0.0)` versus `reinstalled v1.0.0 in place`) and by where arm 3's void lands.
- The mutation row D-3428 at the consumer is measured through `fixture-health-deny` (a new harness knob), not through the skeleton's "wrong `/health` version". A pin answers the same version whatever the box's stamp says, so it cannot see whether the stamp was restored.
- Arm 1 saves `UPD_GATE_WHY` on entry and restores it after its re-gate, on both results (D-3444). `_upd_gate` writes that global on every probe, and `cmd_update`'s exit-4 sentence (wave 4 Task 5, kept by Task 6 after the `_upd_restore` call) prints it after the restore returns: unsaved, a passing arm 1 makes the sentence give the re-gate's `… answers v1.0.0` as the reason v2.0.0 was unhealthy. The arm-1 FULL case asserts the sentence exactly instead of `\(.*\)`.
- The harness reuses wave 4 Task 3's file-scope `sourcedCcrc(home, script: string)`. A second file-scope `function sourcedCcrc` (the draft's `(home, lines, args)` form) is a redeclaration in an ES module, so the file would not load at all. No import is added either: Task 2 Step 3 (e) already added `readlinkSync` and `installVersionedTree`.
- Mutation row 2 (b)'s anchor is Task 2's spelling of the kept-stamp fallback, `    shipped="$CCRC_HERE/../$VER_STAMP_COPY"` inside an `if [ ! -f "$shipped" ]` block; the draft's one-line `[ -f "$shipped" ] || shipped=…` is not in Task 2's code, so `mut` would have refused it (0 matches).
- Arm 1 no longer refuses when `~/ccrc` already points at `<prev>` (the draft's `already points at <prev> — arm 2`). A W6 staged spine that dies inside `_inst_tree` before its flip leaves exactly that, and arm 2 would then re-download `<prev>` and rsync and `npm ci` into the running version. Arm 1 restores in place instead, offline, and falls to arm 2 only when that fails (D-3445). The sourced refusal table's row for that shape now plants a previous tag that is not kept complete; the in-place path has its own FULL case.
- `cmd_update` and `cmd_rollback` refuse a foreign or unreadable `~/ccrc` themselves, before any download, backup, lock or release-host question. The staged spine's `_inst_tree` refusal (Task 2) dies at a step wave 4 reads as moved, so on the update path the restore arms ran over the foreign link.
- The two parent-shell flips (`_ver_flip_back`, `_upd_legacy_target`) ask a new `_ver_can_flip` first, so a macOS box without python3 is told so by name. `cmd_install`'s preflight covers only the flips a spine makes.
- The two FULL cases' stamp-and-record assertions compare against a snapshot taken right after `onKeptV1`. The kept spine is this checkout's own, and its `_ver_keep_state install` copies the box's stamp and record over the kept copies, so a box-vs-kept-copy comparison after the run was equal by construction. The STUB rollback cases keep theirs: `KEPT_SPINE` runs no `_ver_keep_state`.
- `_upd_legacy_target`'s symlink/non-directory refusal has its own case and mutation row; the chmod case only reaches the copy's failure.
- The kept path's `_upd_sweep` is a second call site of spec §18's standalone-rollback-sweep row and gets its own mutation row (21).
- Files: the `single-definition.test.ts` censuses gain one stamp line and three record lines, not one each. `ccrc-update.test.ts` gains the deny knob, possibly two imports, and a file-scope fixture block. There are nine rollback cases (the ninth added by Task 3's review), including one FULL case, so the rollback's real-spine claim is measured on the real spine.

**Departures found by this task** (placeholder form; the coordinator's pass numbers them, ruling R12):
- **D-3443** — (found writing Task 4) spec §11 lists arm 1 → arm 2 → arm 3 as a fall-through and says nothing of what a failed arm 1 leaves behind. Arm 1 flips `~/ccrc` to the kept previous version, restores its stamp and re-runs its spine. A failure there (the spine did not complete, or the gate once more failed) leaves the box pointing at `<prev>`, with `<prev>`'s stamp and, when its spine completed, `<prev>`'s record. Arm 2's child would then be `<prev>`'s own ccrc, not the NEW tree's as wave 4's arm 2 assumes, and its `_upd_converged` would read the box as already on `<prev>` and install nothing. Arm 3 would copy the backup into `<prev>`'s directory and void a version that was never mixed. So a failed arm 1 points `~/ccrc` back at the version this run installed and removes the completed-install record before arm 2 runs. Cost if wrong: one more rename, and a record that arm 2's child or arm 3 would rewrite or remove anyway.
- Amendment to **D-3439** (its text in `## Deviations found`, not a new slug): "restore the kept stamp and record" becomes "restore the kept stamp, clear the record (and the caps), and let the kept spine write the record back", and an empty role runs the spine bare. Reason: the first correction above.
- Amendment to **D-3440**: the call sits above the record's removal, and a kept directory handed to an older spine loses its record copy first. Reason: the fourth correction above.
- Amendment to **D-3442**: a kept version that the flip then cannot reach (rc 1) falls back to update's own re-install without the existence question, so an unpublished tag there exits 1, not 2.
- **D-3444** — (found reconciling Task 4 against wave 4's committed plan) spec §11's arm 1 "runs the gate once more", and `_upd_gate` is wave 4's one gate: it rewrites `UPD_GATE_WHY` on every probe. Wave 4 Task 5's exit-4 sentence, `<v> was installed, but the box did not come back healthy on it ($UPD_GATE_WHY) — exit 4`, is printed after `_upd_restore` returns (Task 6 left it there, "still true after a restore"), so a passing arm 1 would give its own PASS measurement as the reason the NEW build failed. Arm 1 therefore saves `UPD_GATE_WHY` on entry and restores it after the re-gate, on both results, and reads the re-gate's own answer into its failure line first. Cost if wrong: none — one local and two assignments; arm 2's child and arm 3 never gate in this process.
- **D-3445** — (found reviewing Task 4) spec §11's arm 1 is "a kept version directory for the previous tag → flip back". It says nothing of a box whose `~/ccrc` never left that version. Under W6 that is the shape a staged spine leaves when it dies inside `_inst_tree` before its flip, for instance `npm ci` in `~/ccrc-versions/<new>/server` on a registry hiccup. Wave 4's `_upd_step_moved` reads an `_inst_tree` death as moved, so the gate runs and fails on the version. The draft sent that to arm 2, whose child re-downloads `<prev>`; its W6 spine's same-name path (D-3426) voids the running version's kept record, rsyncs `--delete` into the directory the live units run from, and runs `npm ci` there, which empties `node_modules` before it fetches. With the registry still down, arm 3 then restarts a unit with no deps. So when `VER_CURRENT = <prev>` and `<prev>` is kept complete, arm 1 restores in place: `_ver_flip_back`'s rename is onto the same target, the kept stamp is restored, and the kept spine runs from that physical version, which is Task 2's `running` answer with its kept record present, so it copies nothing and runs no `npm ci`. Then the gate runs once more. Arm 2 runs only when that fails, and a failed in-place attempt still clears the record, so arm 2's child re-installs rather than reading the box converged. Cost if wrong: a spine's time spent re-running the version that was already running before arm 2 gets its turn.
- Amendment to **D-3429** (Task 2's): `cmd_update` refuses a `foreign` or `unreadable` `~/ccrc` itself, on the line after its first `_inst_migrate_resume update` and before the old-identity read, the backup and any download; `cmd_rollback` refuses it in its kept check's layout `case`, before the release-host question, the lock and `--detach`. Reason: the staged spine's own refusal dies at `_inst_tree`, which wave 4 reads as moved, so the gate and the restore arms ran over the foreign link (an older spine rsyncs `--delete` through it, and arm 3 copies through it), and "not touched" was false on the update path.
- Amendment to **D-3419** (Task 1's): python3 is also probed, by `_ver_can_flip`, before the two flips that run in the `cmd_update`/`cmd_rollback` parent (`_ver_flip_back`, `_upd_legacy_target`), where no spine preflight has run. A macOS box without it is then told `python3 is not on PATH …` instead of `the one rename … failed` or a bare `could not give …`. It is not a verb-level probe, because a Darwin update that flips nothing needs no python3.
- Note for **D-3431** (Task 3's): a rollback by flip whose gate passes also removes `~/ccrc.migrating`. That is the same rule applied to one more gate. Task 5 has since decided GC for this path: it never runs there (D-3451 — the kept spine runs under the rollback's lock, so its `_ver_lock_try` answers rc 1, and the kept path calls no `_ver_gc` of its own).

### Task 5: GC and `ccrc versions`

**Files:**
- Modify: `ccd/ccrc`:
  - globals `VER_NAMES=()`, `VER_RUNNING=()`, `VER_DOOMED=()`, `VER_DOOMED_WHY=()`, on the lines after Task 2's `VER_WHY=""` (re-locate by `grep -n '^VER_WHY=""' ccd/ccrc`). **(Corrected, review round: the two associative arrays are NOT declared at file scope.)** `VER_PROTECT` and `VER_VERDICT` are declared `declare -gA … =()` as the FIRST statement of each function that resets them (`_ver_protect`; `_ver_verdicts` and `cmd_versions`). `-g`, not a bare `declare -A`: a `declare -A` inside a function makes a local, and the `set -u` reads in the other functions would then meet an unbound name. Not at file scope, because `declare -g` arrived in bash 4.2: at file scope, macOS's stock `/bin/bash` 3.2 would print `declare: -g: invalid option` and its usage twice on EVERY `ccrc` invocation, ahead of `cmd_install`'s bash-floor refusal (`:9141-9149`). Inside a function it fails only when that function runs, as `local -A` (`:3054`) already does.
  - **(Corrected, review round: bash 3.2 must still be able to PARSE the file.)** No new line uses `[[ -v … ]]`. Bash 3.2's `[[` grammar has no `-v` (it arrived in 4.2), so it is a parse-time syntax error (`conditional binary operator expected`). A non-interactive bash stops there while it is still reading function definitions, long before the dispatch at the end of the file. `cmd_install`'s Darwin preflight, whose comment calls a clean refusal "the whole difference", would then never run. Every bash-4 spelling already in `ccd/ccrc` (`${x^^}`, `local -A`, `mapfile`, `exec {FD}>`) fails only when it runs. The membership test is `[ -n "${VER_PROTECT[$n]:-}" ]`, which is equivalent because `_ver_protect_add` only ever stores a non-empty word list.
  - new `_ver_list`, `_ver_running_names`, **(corrected: added)** `_ver_protect_add`, `_ver_protect`, **(corrected: added)** `_ver_verdicts`, `_ver_gc`, `cmd_versions`, as one block immediately after `_bak_prune`'s closing `}`. Re-locate with `grep -n '^_bak_prune() {' ccd/ccrc` (`:12270` at `d759c914`). The block goes on the blank line above `# ── cmd_logs — the journal, thin (stage 4, Task 8; spec §7) ───────────────` (`:12290`). `_bak_prune` is the sweep precedent these functions copy.
  - the dispatch table: `  versions) cmd_versions "$@" ;;` on the line after wave 4's `  rollback) cmd_rollback "$@" ;;`.
  - **(Added, review round)** consumes Task 3's `_ver_crashed_remedy` for the listing's `crashed` line. Step 1 checks it exists.
  - `usage()`: in the verb-list line (`grep -n '^usage: \$PROG {' ccd/ccrc`), `|rollback|channel|` becomes `|rollback|versions|channel|`. The `versions` entry goes immediately BEFORE wave 4's line `  channel   print this box's update channel as the control plane projects`, which places it right after the `rollback` entry, as Task 4 left that entry.
  - Task 3's `_inst_doctor_tail`: add `_ver_gc install auto || :` on the line after `_inst_migrate_finish install "ccrc doctor passed; a plain install is its own gate"`, inside the `drc = 0` branch of its lock-taken arm, before `_upd_unlock`. **(Corrected: the skeleton said only "inside the lock-taken arm". The call sits in the `drc = 0` branch because the automatic GC runs behind a passed gate, D-3451.)**
  - **(Added, review round)** `_inst_tree`'s block `(5) THE FLIP` (Task 2's, as Task 3 left it): the flip's target is measured again immediately before `_plat_ln_swap "$dest" "$BOX_TREE_DIR"`. See Step 3(g) and D-3456.
  - `cmd_update`: add `_ver_gc update auto || :` on the line after Task 3's ONE `_inst_migrate_finish update "the health gate passed"`, inside the `else` arm of its `if [ "$no_gate" -eq 1 ]` (so `--no-gate`, arm 2's restore child included, never prunes). That site is the gate-pass path above wave 4's `_upd_phase restarting`, and it still holds `cmd_update`'s lock.
- Test: `server/test/ccrc-update.test.ts`:
  - the `systemctl` stub's `show)` arm (`:219-231` at `d759c914`) gains `-p ExecStart <unit>`. It goes above the MainPID check line, after the `KillMode` block.
  - `updateEnv`'s `delete env[k]` list (`:313-314` at `d759c914`, the one ending `'CCRC_BACKUP_KEEP']) delete env[k];`) gains `'CCRC_VERSIONS_KEEP'`.
  - the `node:fs` import gains `utimesSync` (on the line Task 2 made `  symlinkSync, readlinkSync,`); the `./installTreeFixture.js` import Task 2 added already carries `installVersionedTree`.
  - new describe `ccrc versions, and the GC that never removes a needed version (W6 Task 5)`, appended at the end of the file. Its `readlink` knob (`$HOME/fixture-readlink-f-empty`) and every other helper live INSIDE the describe, so nothing collides with helpers Tasks 3 and 4 put at file scope.
  - **Corrected:** the stub's `is-active` arm is NOT edited. Wave 4's Task 5 already made it answer `$HOME/fixture-unit-state` for every unit (default `active`; an empty file answers empty), and that is the "stopped" knob and the "no answer" knob this task needs.
- Test: `server/test/ccrc-install.test.ts`:
  - the `systemctl` stub's `show)` arm (`:455-459` at `d759c914`) gains the same `-p ExecStart <unit>` arm, above its MainPID check.
  - `ccrcEnv`'s `delete env[k]` list (`:542`) gains `'CCRC_VERSIONS_KEEP'`.
  - `installVersionedTree` joins the `./installTreeFixture.js` import if Task 2 did not already add it.
  - one after-install GC case (`itLinux`) and **(added, review round)** one flip-recheck case (`it`), appended as the last two `it`s of Task 2's describe `ccrc install: the versioned tree (W6 Task 2)`.
- Test: `server/test/ccrc-cli.test.ts`, in `it('the usage line names every verb this CLI will have'`:
  - the verb-list regex (`:181`; after wave 4 it contains `\|update\|rollback\|channel\|rollout\|`) gains `\|versions` after `\|rollback`;
  - an entry pin after the `update` one (`:185`);
  - one paragraph appended to its comment block, above `const home = mkTmp('ccrc-cli-usage-verbs-');` (`:179`).
- Run, not edited:
  - `server/test/single-definition.test.ts`: no line this task writes names `BOX_STAMP_FILE` or `BOX_INSTALLED_FILE`. The listing reads the stamp through `_box_build_fields` with no argument, and a version's completeness through `$VER_RECORD_COPY`.
  - `server/test/macos-platform.test.ts`: no GNU-only spelling is added. `readlink -f` is deliberately outside its `gnuOnly` table (`:111-113`), and `_plat_mtime` carries the `stat` split.
  - `server/test/ccrc-install-graphify.test.ts`: its own `systemctl` stub has no ExecStart arm, and it never needs one. No case there runs more than two installs in one home (measured at `d759c914`), so at most one complete version stands beside the pointed-at one, within the default `CCRC_VERSIONS_KEEP` of 3, and the GC returns at its nothing-prunable step before it asks the service manager anything (below).
  - `server/test/typecheck-tests.test.ts` and `server/test/topology-clean.test.ts`.
- Not chased here: `server/test/session-hook.test.ts` (Task 9).

**Interfaces:**
- Env `CCRC_VERSIONS_KEEP` (default `3`, `^[0-9]+$`): how many complete, unprotected versions are kept beyond the protected set (D-3423). A non-numeric value behaves as follows:
  - `auto` prints `<prefix>: versions: WARN: CCRC_VERSIONS_KEEP is not a number — nothing pruned` and returns rc 1.
  - `ccrc versions`, with or without `--prune`, refuses at exit 1 BEFORE the lock with `ccrc: versions: CCRC_VERSIONS_KEEP must be a number (got a non-numeric value) — nothing was pruned`. **(Corrected: the listing refuses too, because it cannot compute a verdict without N.)**
- `_ver_list` sets `VER_NAMES` to every real directory (not a symlink) directly under `$BOX_VERSIONS_ROOT` whose basename matches `VER_NAME_RE`. Dot-names such as a legacy target's `.incoming`, and anything else, are never listed and never touched.
  - Order: complete versions first (`$VER_RECORD_COPY` present), by `_plat_mtime` of that record, newest first, ties in name order. Then the incomplete versions, in name order.
  - `nullglob` is saved and restored with `_bak_prune`'s `had_nullglob` idiom. The sort is a bash insertion sort, so no `sort` binary is used on the install path.
  - **Corrected:** rc 0, or rc 1 with `VER_WHY` `the kept install record of <n> has no readable mtime`. A `stat` that fails would otherwise order the list by accident. `VER_NAMES` is still filled on rc 1.
- `_ver_running_names` → rc 0 measured, with `VER_RUNNING` holding the names the running units resolve to, or rc 1 unmeasured (`VER_WHY`) (D-3446). It runs over `BOX_UNIT_NAMES` (`ccrc.service ccrc-agent.service`, `:2153`).
  - **Corrected: the unit's state.** `_svc_is_active` answering `active|activating|deactivating|reloading|refreshing` means running, and `inactive|failed` means not running. ANY other answer, the EMPTY one included, is rc 1: `the service manager did not say whether <unit> is running (<word|no answer|an unrecognised answer>)`. `_svc_is_active`'s own contract (`:925-969`) makes an empty answer "a question that was never asked". The skeleton's "any other word contributes nothing" would read that answer as "not running", which is the fold D-3447 exists to refuse.
  - Linux: `systemctl --user show -p ExecStart <unit>` must match `^ExecStart=\{ path=([^ ]*) ; argv\[\]=(.*) ; ignore_errors=`. This is the real struct, measured 2026-09-23 on a user unit: `ExecStart={ path=/usr/bin/dbus-daemon ; argv[]=/usr/bin/dbus-daemon --session … ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }`. The tokens come from group 2, `argv[]`, never from group 1, `path=`. A line that does not match is rc 1: `<unit>'s ExecStart did not parse as systemd's struct form`.
  - Darwin: `plutil -convert json -o - "$(_svc_plist <unit>)" | jq -er '.ProgramArguments | if type == "array" and length > 0 then map(tostring) | join(" ") else error("none") end'`. Each token has one leading `'`/`"` stripped, then one trailing `;`, then one trailing `'`/`"`: `_inst_plist_server` (`:10172-10203`) writes `exec /usr/bin/env node '$entry'`. **Corrected:** `jq -e` makes an empty or missing `ProgramArguments` rc 1, `<unit> is running and its job file's ProgramArguments could not be read (plutil -convert json)`. A plain `jq -r` answers an empty input with rc 0 and no output, which would read "names no tree token".
  - **Corrected: the prefix, not the token (D-3449).** A token that begins `$BOX_TREE_DIR/` resolves `readlink -f -- "$BOX_TREE_DIR"`. A token that begins `$BOX_VERSIONS_ROOT/<seg>/…` resolves `readlink -f -- "$BOX_VERSIONS_ROOT/<seg>"`.
    - An empty answer, or rc ≠ 0, is rc 1: `<unit>'s command names <token>, which readlink -f could not resolve`.
    - The physical root is `readlink -f -- "$BOX_VERSIONS_ROOT"`, resolved once. Empty is rc 1: `$HOME/ccrc-versions could not be resolved by readlink -f`.
    - A resolved path under `<root>/<name>` with `<name>` matching `VER_NAME_RE` adds `<name>` to `VER_RUNNING`.
    - A running unit whose command names no tree token contributes nothing.
- `_ver_protect_add <name> <word>` **(corrected: added)** records one reason once. A `<name>` that is not a `VER_NAME_RE` name (the projection's `none`) is dropped.
- `_ver_protect` → rc 0 measured, or rc 1 unmeasured (`VER_WHY`). It resets `VER_PROTECT` and fills it in this order:
  - `pointed-at`: `VER_CURRENT`.
  - `previous`: from `_upd_read_previous`. rc 0 adds `UPD_PREV_TAG`. rc 1 adds nothing. rc 3 is rc 1 with `~/.ccrc/previous is unreadable or malformed`.
    - **(Corrected, review round: rc 2 names a directory too.)** rc 2 adds `untagged-${UPD_PREV_SHA:0:12}`. Wave 4's `_upd_write_previous` writes an untagged build as line 1 `untagged` and line 2 the old stamp's sha (`BOX_BUILD[0]`). Task 2's `_inst_version_name` rules 2–4 name that same build's directory `untagged-${sha:0:12}`, from the same stamp sha. Task 8's R4 produces this case: `previous: untagged (<40 hex>)` for `$U` = `untagged-<sha12>`.
    - Line 2 `unstamped` (no stamp could be read) yields `untagged-unstamped`, which fails `VER_NAME_RE`, so `_ver_protect_add` drops it. Such a build's directory is `unstamped-<random>`, and nothing recorded names it.
    - The skeleton's "rc 2 adds nothing" left the version the box ran just before unprotected, against spec §11's "keep … the previous".
  - `desired` / `desired-stable` / `desired-dev`: from wave 4's `_upd_intent_state`, run in a SUBSHELL whose five values come back through `mapfile` **(corrected: the caller's `UPD_INTENT_*` are left untouched, since `cmd_update` read them for its own target)**. The state decides:
    - `ok|none` adds each tag.
    - `not-configured` adds nothing.
    - any other state is rc 1: `the control plane's projection is <state> (<UPD_INTENT_WHY>) — its desired tags cannot be read` (D-3420).
  - `running`: from `_ver_running_names`. rc 1 is rc 1.
- `_ver_verdicts <auto|prune> <keep>` **(corrected: added — the ONE place a verdict is decided, so the listing and the prune cannot disagree)**. It walks `VER_NAMES` in order and fills `VER_VERDICT[<name>]`:
  - protected → `kept: <words>`;
  - complete → the first `<keep>` get `kept: newest <keep>`, the rest `prunable` and doomed (`complete, not among the newest <keep>`);
  - incomplete → `prunable by --prune only`, doomed (`incomplete`) only when the mode is `prune` (D-3448).
  It returns `VER_DOOMED` / `VER_DOOMED_WHY` as parallel arrays.
- `_ver_gc <prefix> <auto|prune>` → rc 0 when it is done or has nothing to do; rc 1 when it skipped on an unmeasured input or a removal failed. The CALLER holds `~/.ccrc/update.lock`: `cmd_versions --prune` through wave 4's `_upd_lock`, `cmd_update` its own, and `_inst_doctor_tail` through Task 3's `_ver_lock_try`. **(Corrected:)** the line lead is `<prefix>: versions:`, or plain `versions:` when the prefix is `versions`; the skeleton's form printed `versions: versions: pruned …`. In order:
  1. KEEP validated (above).
  2. Layout not `linked|migrated`: `prune` prints `versions: nothing to prune — $HOME/ccrc is not versioned (<layout>)`; `auto` is silent. Both return rc 0.
  3. **Corrected: nothing prunable means nothing measured (D-3450).** The step counts the complete and the incomplete versions beside the pointed-at one. When `complete ≤ keep`, and either the mode is `auto` or there are no incomplete ones, it returns rc 0 before reading previous, the projection or the service manager. `prune` prints `versions: nothing to prune — <n> complete version(s) beside the pointed-at one, within CCRC_VERSIONS_KEEP=<keep>, and none incomplete`; `auto` is silent.
     - This is sound: a protection only takes a version OUT of the removal set, so it can never make a version prunable.
     - Without it, a first install on a `both` box, whose server has not yet written the projection, would print a WARN about pruning a box that has exactly one version.
     - Without it, every install and update suite case would grow `systemctl show` calls.
  4. `_ver_list` rc 1, or `_ver_protect` rc 1: `auto` prints `<prefix>: versions: WARN: nothing pruned — <VER_WHY>`, and `prune` prints `versions: prune skipped — <VER_WHY>; nothing was removed`. Both return rc 1, and nothing is removed (D-3447).
  5. `_ver_verdicts`. With nothing doomed, `prune` prints `versions: nothing to prune — every kept tree is protected or among the newest <keep>` and returns rc 0.
  6. Each doomed name gets the belt first: `readlink -- "$BOX_TREE_DIR"` is re-read. When it is empty or names `$BOX_VERSIONS_ROOT/<name>`, the line is `<lead> could not prune $HOME/ccrc-versions/<name> — $HOME/ccrc points at it or could not be read; every version above it is intact` and rc becomes 1. Otherwise `rm -rf --` runs and prints `<lead> pruned $HOME/ccrc-versions/<name> (<why>)`. A failed `rm` prints `<lead> could not prune $HOME/ccrc-versions/<name> — every version above it is intact` and sets rc 1. The loop continues after either failure.
- `cmd_versions [--prune] [-h|--help]`; any other argument → `_ccrc_usage_die` (exit 2).
  - `--prune` runs `_upd_lock` (a holder → wave 4's `ccrc: update: another update holds ~/.ccrc/update.lock (…)`, exit 1), then `_inst_migrate_resume versions`, then `_ver_gc versions prune`, then `_upd_unlock`, then the listing. The exit is `_ver_gc`'s rc.
  - The listing takes no lock and writes nothing. Line 1 is exactly the skeleton's, by layout. The stamp suffix is read through `_box_build_fields` with no argument and `BOX_BUILD[4]`, and is printed only when the pointed-at name is tag-shaped and the stamp parses. Then comes one line per `VER_NAMES` entry, `printf '  %s %s  %s  %s\n' <*| > <name> <complete|incomplete> <verdict>`:
    - an unmeasured `_ver_protect` first prints `versions: WARN: <VER_WHY> — nothing would be pruned`, and every entry then reads `kept: unmeasured`;
    - **(corrected: the skeleton gave no verdict here)** a non-versioned layout reads `kept: nothing is pruned while $HOME/ccrc reads <layout>`.
    - **(Corrected, review round: the `crashed` line's remedy.)** Line 1 for `crashed` is `versions: a migration crashed — $HOME/ccrc is absent beside $HOME/ccrc.migrating; <_ver_crashed_remedy>`, Task 3's one spelling of that remedy. The skeleton's `run ccrc install to complete it` names the `ccrc` on PATH. In this layout that is the shim, which execs the missing `$HOME/ccrc/ccd/ccrc` and cannot run. The shim's own refusal offers `deploy.sh`, whose rsync would place a real `~/ccrc` beside `~/ccrc.migrating`, which `_ver_layout` reads `unreadable`. The only reader who sees this line already ran a `ccrc` by its path.
  - The last line is the skeleton's `versions: <n> kept tree(s) under $HOME/ccrc-versions; CCRC_VERSIONS_KEEP=<N> plus the protected set (pointed-at, previous, the projection's desired tags, running units) — 'ccrc versions --prune' removes the prunable ones`.
- The automatic GC's call sites and their gate (D-3451):
  - `_inst_doctor_tail`: under a lock it took, when `cmd_doctor` returned 0.
  - `cmd_update`: after `_upd_gate` passed, which includes wave 4's D-3114 marker-present arm (a doctor FAIL with the gate passing, exit 3).
  - Never after a failed gate.
  - Never inside `_upd_restore`'s arm 1, `cmd_rollback`'s kept path or arm 2's child. Their spine is a child running under its parent's lock, so its `_ver_lock_try` answers rc 1 and it prunes nothing.
- The `usage()` entry's first line is exactly `  versions  list the kept release trees under ~/ccrc-versions (* marks the one ~/ccrc points at);`. It continues at the 12-space indent with `--prune`, the protected set, `CCRC_VERSIONS_KEEP` and the automatic run.
- Both harness `systemctl` stubs gain a `show -p ExecStart <unit>` arm:
  - It prints `ExecStart={ path=/usr/bin/env ; argv[]=<argv> ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }`.
  - `<argv>` is `$HOME/fixture-execstart-<unit>`'s one line when that file exists. Otherwise it is the shipped unit's ExecStart with `%h` → `$HOME`: `deploy/ccrc.service:19` and `deploy/ccrc-agent.service:7`.
  - `$HOME/fixture-execstart-raw` is printed verbatim.
  - A unit other than the two is exit 90. It never emits a bare path.
- Mutation rows. Spec §18 "GC never removes a needed version" gets one row per guard:
  - `pointed-at` (with the belt);
  - `previous`;
  - the projection's desired set;
  - `running`.

  The plan-level rows:
  - the parser reading `path=`;
  - an empty `readlink -f` read as "not running";
  - a stale projection read as not-configured;
  - an unanswered unit state read as stopped;
  - the Darwin quote strip;
  - `auto` removing an incomplete version;
  - the `nullglob` restore;
  - the nothing-prunable short-circuit;
  - `--prune` without the lock;
  - each automatic call site.

  Step 5 spells every edit.

- [ ] **Step 1: Confirm the producer and the earlier tasks, then write the failing tests**

From the repo root, run the command block below and compare its output with the expected output that follows it. If any line differs, STOP and report it. A missing name means an earlier task, or wave 4, spelled it differently, and this task's code must follow the spelling that actually shipped.

```bash
for pat in '^_ver_layout() {$' '^VER_WHY=""' '^VER_RECORD_COPY=' '^_inst_migrate_resume() {' \
  '^_inst_doctor_tail() {$' '^_upd_read_previous() {$' '^_upd_intent_state() {$' '^_upd_lock() {$' \
  '^_upd_unlock() {$' '^  rollback) cmd_rollback "\$@" ;;$' "^  channel   print this box's update channel" \
  '^_ver_crashed_remedy() {$'; do
  printf '%s  %s\n' "$(grep -c -- "$pat" ccd/ccrc)" "$pat"; done
grep -cF '_inst_migrate_finish install "ccrc doctor passed; a plain install is its own gate"' ccd/ccrc
grep -cF '_inst_migrate_finish update "the health gate passed"' ccd/ccrc
grep -c '_ver_gc\|cmd_versions' ccd/ccrc
grep -c '\[\[ -v' ccd/ccrc
grep -c 'BOX_STAMP_FILE' ccd/ccrc; grep -c 'BOX_INSTALLED_FILE' ccd/ccrc
grep -c '^export function installVersionedTree' server/test/installTreeFixture.ts
grep -c '^function sourcedCcrc\|^function plantIntent\|^function intentDoc\|^function plantRole\|^function plantSyncTimer\|^function plantClock' server/test/ccrc-update.test.ts
grep -c 'fixture-unit-state' server/test/ccrc-update.test.ts
grep -n "^import { spawn, spawnSync" server/test/ccrc-update.test.ts
```

Expected output:
- twelve lines, each starting `1`;
- then `1`;
- then `1` (Task 3 writes ONE gate-pass site, the `else` arm of its `if [ "$no_gate" -eq 1 ]`);
- then `0`;
- then `2`: the comment at `:9141` and the refusal sentence at `:9148` at `d759c914`, both inside `cmd_install`'s Darwin preflight and neither a live test. Record it; Step 3 checks this task adds none;
- then the two census counts (record them: Step 4 compares them);
- then `1`, `6`, a count ≥ 1, and one `import` line.

(a) `server/test/ccrc-update.test.ts`: the harness.

- In the `node:fs` import (`:39-43`), `grep -c 'utimesSync' server/test/ccrc-update.test.ts` prints `0` (no earlier task adds it to this file). Task 2 made the import's last name line `  symlinkSync, readlinkSync,`; it becomes `  symlinkSync, readlinkSync, utimesSync,`.
- Check `grep -n "from './installTreeFixture.js'" server/test/ccrc-update.test.ts`:
  - with one line, add `installVersionedTree` inside its braces if it is not already there;
  - with no line, add `import { installVersionedTree } from './installTreeFixture.js';` after the `./platformFixtures.js` import.
- In `updateEnv`, find the statement `for (const k of ['CCRC_ADDR', …, 'CCRC_BACKUP_KEEP']) delete env[k];` (`grep -n "'CCRC_BACKUP_KEEP'\]) delete env\[k\];" server/test/ccrc-update.test.ts`, one line, `:314` at `d759c914`). A bare `grep 'delete env\[k\]'` prints two lines once wave 4 has landed: its `runWatchdog` helper carries `if (v === undefined) delete env[k]; …`, which is not this list. Add `'CCRC_VERSIONS_KEEP'` as the last element of its array.
- In the `systemctl` stub, find the line `    '    [ "$2" = "-p" ] && [ "$3" = "MainPID" ] && [ "$4" = "--value" ] \\',`. It is the first line after the `KillMode` block's closing `'    fi',`. Immediately above it, insert:

```ts
    // W6 Task 5 — spec §11's GC reads `show -p ExecStart <unit>`, answered in
    // systemd's REAL struct form (measured on a user unit, 2026-09-23):
    // `path=` is `/usr/bin/env` and the tree path is inside `argv[]`, so a
    // reader of `path=` protects nothing. The argv is the shipped unit's
    // ExecStart with %h expanded (deploy/ccrc.service:19,
    // deploy/ccrc-agent.service:7), `fixture-execstart-<unit>`'s one line
    // when a test plants it; `fixture-execstart-raw` is printed VERBATIM
    // (the unparseable case). Never a bare path.
    '    if [ "$2" = "-p" ] && [ "$3" = "ExecStart" ] && [ -n "$4" ]; then',
    '      if [ -f "$HOME/fixture-execstart-raw" ]; then cat "$HOME/fixture-execstart-raw"; exit 0; fi',
    '      case "$4" in',
    '        ccrc.service) a="/usr/bin/env node $HOME/ccrc/server/dist/server/src/index.js" ;;',
    '        ccrc-agent.service) a="/usr/bin/env node $HOME/ccrc/agent/dist/agent/src/index.js" ;;',
    '        *) echo "fixture systemctl: unexpected argv: $*" >&2; exit 90 ;;',
    '      esac',
    '      if [ -f "$HOME/fixture-execstart-$4" ]; then IFS= read -r a < "$HOME/fixture-execstart-$4"; fi',
    '      echo "ExecStart={ path=/usr/bin/env ; argv[]=$a ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }"',
    '      exit 0',
    '    fi',
```

(b) `server/test/ccrc-install.test.ts`: the harness.

- In the `systemctl` stub (`plant('systemctl', [`, `:411`), insert the same nineteen lines (the eight comment lines included) immediately above its line `    '    [ "$2" = "-p" ] && [ "$3" = "MainPID" ] && [ "$4" = "--value" ] \\',`. That line directly follows `'  show)',` (`:455-456`).
- In `ccrcEnv`, the line `  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT']) delete env[k];` (`:542`; `grep -n "'CCRC_DOCTOR_GH_TIMEOUT'\]) delete env\[k\];" server/test/ccrc-install.test.ts`, one line — a bare `delete env\[k\]` grep also finds Task 2's `sourced` helper, `if (k.startsWith('CCRC_')) delete env[k];`) gains `'CCRC_VERSIONS_KEEP'` as the last element of its array.
- Check `grep -n "from './installTreeFixture.js'" server/test/ccrc-install.test.ts` (one line, `:60` at `d759c914`). If its braces lack `installVersionedTree`, add it after `installFixtureTree`.

(c) Append to `server/test/ccrc-update.test.ts`, at the end of the file:

```ts
// ── ccrc versions, and the GC (design 2026-09-20 §11 "GC"; W6 Task 5) ────
// Spec §18 "GC never removes a needed version", one case per guard, each with
// its CONTROL in the same run: CCRC_VERSIONS_KEEP=0 makes every complete,
// unprotected version prunable, so a planted version the guard does not
// cover is removed beside the one it does. The two units read STOPPED
// (`fixture-unit-state`, wave 4 Task 5's knob; on macOS the launchctl stub
// answers "no such job" for a job nobody bootstrapped) in every case but the
// running guard's, so no case is held green by a second guard.
describe('ccrc versions, and the GC that never removes a needed version (W6 Task 5)', () => {
  const REAL_READLINK = realPath('readlink');
  const REAL_STAT = realPath('stat');
  const lit = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionDirs = (home: string): string[] => readdirSync(join(home, 'ccrc-versions')).sort();
  const stopUnits = (home: string): void => writeFileSync(join(home, 'fixture-unit-state'), 'inactive\n');
  const plantPrevious = (home: string, text: string): void => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'previous'), text);
  };

  /** A W6 box: each of `names` placed COMPLETE under ~/ccrc-versions, the
   *  FIRST linked from ~/ccrc; each kept install record's mtime set so the
   *  order given IS the age order (`names[1]` the newest of the rest) —
   *  `_ver_list` orders by that mtime, never by name. `incomplete` adds
   *  directories with no kept record. The box stamp names the pointed-at
   *  version, as a completed install leaves it. */
  function versionedBox(prefix: string, names: string[], incomplete: string[] = []): string {
    const home = freshUpdateBox(prefix);
    names.forEach((n, i) => {
      const stamp = /^v\d/.test(n) ? { sha: 'b'.repeat(40), version: n } : { sha: 'b'.repeat(40) };
      const root = installVersionedTree(home, n, { link: i === 0, stamp });
      const t = 1_800_000_000 - i * 100;
      utimesSync(join(root, '.ccrc-installed'), t, t);
    });
    for (const n of incomplete) installVersionedTree(home, n, { link: false, complete: false });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp(names[0]!, 'b'.repeat(40)));
    return home;
  }

  /** `ccrc versions` against the fixture box, in `runUpdate`'s environment and
   *  order (env built, then the doctor stubs re-planted). */
  function runVersions(home: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Result {
    const env = { ...updateEnv(home), ...extraEnv };
    replantDoctorStubs(home);
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'versions', ...args], { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  /** `readlink -f` answering EMPTY, rc 0 — what BSD's readlink before macOS
   *  12.3 (no -f) leaves a caller holding. Planted in the replant directory;
   *  every other readlink argv is the real binary. */
  function plantReadlinkFEmpty(home: string): void {
    writeFileSync(join(home, 'doctor-stubs', 'readlink'),
      '#!/bin/sh\n'
      + 'if [ "$1" = "-f" ] && [ -f "$HOME/fixture-readlink-f-empty" ]; then exit 0; fi\n'
      + `exec ${REAL_READLINK} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(home, 'fixture-readlink-f-empty'), 'yes\n');
  }

  const LISTED = ['v1.0.4', 'v1.0.3', 'untagged-0123456789ab', 'v1.0.2', 'v1.0.1', 'v1.0.0'];
  const LAST_LINE = 'versions: 7 kept tree(s) under $HOME/ccrc-versions; CCRC_VERSIONS_KEEP=2 plus the protected set '
    + "(pointed-at, previous, the projection's desired tags, running units) — 'ccrc versions --prune' removes the prunable ones";

  it('lists every kept tree newest first, marks the pointed-at one, says why each is kept — and takes no lock', () => {
    // untagged-… sits BETWEEN v1.0.3 and v1.0.2 by age: neither name order puts it there.
    const home = versionedBox('ccrc-versions-list-', LISTED, ['unstamped-fedcba987654']);
    stopUnits(home);
    plantPrevious(home, `v1.0.1\n${'c'.repeat(40)}\n`);
    const before = versionDirs(home);
    const r = runVersions(home, [], { CCRC_VERSIONS_KEEP: '2' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout.split('\n')).toEqual([
      'versions: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.4',
      '  * v1.0.4  complete  kept: pointed-at',
      '    v1.0.3  complete  kept: newest 2',
      '    untagged-0123456789ab  complete  kept: newest 2',
      '    v1.0.2  complete  prunable',
      '    v1.0.1  complete  kept: previous',
      '    v1.0.0  complete  prunable',
      '    unstamped-fedcba987654  incomplete  prunable by --prune only',
      LAST_LINE,
      '',
    ]);
    expect(versionDirs(home)).toEqual(before);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
    // A stamp that disagrees with the pointed-at name is said, not hidden:
    // something (deploy.sh, a pre-W6 spine) wrote through the link.
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v1.0.3', 'b'.repeat(40)));
    const s = runVersions(home, [], { CCRC_VERSIONS_KEEP: '2' });
    expect(s.stdout.split('\n')[0]).toBe(
      'versions: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.4 (its stamp reads v1.0.3 — something wrote through $HOME/ccrc)');
  });

  it('--prune removes only what nothing needs — complete ones past the newest N, and the incomplete — then lists what is left', () => {
    const home = versionedBox('ccrc-versions-prune-', LISTED, ['unstamped-fedcba987654']);
    stopUnits(home);
    plantPrevious(home, `v1.0.1\n${'c'.repeat(40)}\n`);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '2' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.2 \(complete, not among the newest 2\)$/m);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 2\)$/m);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/unstamped-fedcba987654 \(incomplete\)$/m);
    expect(versionDirs(home)).toEqual(['untagged-0123456789ab', 'v1.0.1', 'v1.0.3', 'v1.0.4']);
    expect(r.stdout).toMatch(/^versions: 4 kept tree\(s\) under \$HOME\/ccrc-versions;/m);
    // Nothing left to remove: the second prune says so and removes nothing.
    const again = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '2' });
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/^versions: nothing to prune — every kept tree is protected or among the newest 2$/m);
    expect(versionDirs(home)).toEqual(['untagged-0123456789ab', 'v1.0.1', 'v1.0.3', 'v1.0.4']);
  });

  it('the argument surface: -h is usage at exit 0; anything else is exit 2; a non-numeric CCRC_VERSIONS_KEEP refuses at exit 1 before the lock', () => {
    const home = versionedBox('ccrc-versions-args-', ['v1.0.1', 'v1.0.0']);
    let r = runVersions(home, ['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^ {2}versions {2}list the kept release trees under ~\/ccrc-versions \(\* marks the one ~\/ccrc points at\);$/m);
    r = runVersions(home, ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --bogus/m);
    r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: 'three' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: versions: CCRC_VERSIONS_KEEP must be a number \(got a non-numeric value\) — nothing was pruned$/m);
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
  });

  it('a box whose ~/ccrc is still a directory: nothing is versioned, and --prune removes nothing', () => {
    const home = freshUpdateBox('ccrc-versions-dir-');
    plantOldBox(home, { version: 'v1.0.0' });
    let r = runVersions(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^versions: \$HOME\/ccrc is a directory — not versioned yet; the next ccrc install or update migrates it$/m);
    expect(r.stdout).toMatch(/^versions: 0 kept tree\(s\) under \$HOME\/ccrc-versions;/m);
    r = runVersions(home, ['--prune']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^versions: nothing to prune — \$HOME\/ccrc is not versioned \(directory\)$/m);
    expect(existsSync(join(home, 'ccrc', 'server', 'OLD-MARKER'))).toBe(true);
  });

  it('a crashed migration is said with a command that can complete it — the placed version\'s own ccrc by its path, never the shim on PATH, never deploy.sh', () => {
    const home = freshUpdateBox('ccrc-versions-crashed-');
    mkdirSync(join(home, 'ccrc.migrating', 'server'), { recursive: true });
    installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: 'b'.repeat(40), version: 'v1.0.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v1.0.0\n');
    let r = runVersions(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')[0]).toBe('versions: a migration crashed — $HOME/ccrc is absent beside $HOME/ccrc.migrating; '
      + 'run bash $HOME/ccrc-versions/v1.0.0/ccd/ccrc install (or bash install.sh from a ccrc checkout) to complete it '
      + '— the ccrc on PATH cannot run until then, and deploy.sh would place a second tree beside it');
    expect(r.stdout).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: nothing is pruned while \$HOME\/ccrc reads crashed$/m);
    // A marker that names no placed version: no install can complete it, and
    // the line says the by-hand remedies instead of a command that would die.
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v9.9.9\n');
    r = runVersions(home);
    expect(r.stdout.split('\n')[0]).toBe('versions: a migration crashed — $HOME/ccrc is absent beside $HOME/ccrc.migrating; '
      + '~/.ccrc/migrating-to names no placed version, so no install can complete it — link it by hand '
      + '(ln -s $HOME/ccrc-versions/<name> $HOME/ccrc) or move it back (mv $HOME/ccrc.migrating $HOME/ccrc); '
      + 'not deploy.sh, which would place a second tree beside it');
    // The listing reads; it repairs nothing.
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });

  it('guard — the pointed-at version is never pruned (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-current-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // the control: a complete version nothing protects IS removed
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {2}\* v1\.0\.1 {2}complete {2}kept: pointed-at$/m);
    expect(versionDirs(home)).toEqual(['v1.0.1']);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, 'ccrc', 'ccd', 'ccrc'))).toBe(true);
  });

  it('guard — the previous version (~/.ccrc/previous) is never pruned (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-prev-', ['v1.0.2', 'v1.0.1', 'v1.0.0']);
    stopUnits(home);
    plantPrevious(home, `v1.0.0\n${'c'.repeat(40)}\n`);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.1 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: previous$/m);
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.2']);
    // An UNTAGGED previous (wave 4's D-3231: line 1 `untagged`, line 2 the old
    // stamp's sha) names the directory `_inst_version_name` gave that build,
    // `untagged-<sha12>` (Task 8's R4 writes exactly this). It is kept too,
    // beside the same control.
    const u = versionedBox('ccrc-versions-g-prev-untagged-', ['v1.0.2', 'untagged-0123456789ab', 'v1.0.0']);
    stopUnits(u);
    plantPrevious(u, `untagged\n0123456789ab${'c'.repeat(28)}\n`);
    const s = runVersions(u, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(s.code, `stderr: ${s.stderr}\nstdout: ${s.stdout}`).toBe(0);
    expect(s.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(s.stdout).toMatch(/^ {4}untagged-0123456789ab {2}complete {2}kept: previous$/m);
    expect(versionDirs(u)).toEqual(['untagged-0123456789ab', 'v1.0.2']);
  });

  // PLATFORM-ONLY: a macOS box is never centrally managed (decision 17) —
  // `_upd_intent_state` answers not-configured there whatever the file says,
  // so its projection names no tag to protect. What macOS keeps is pinned by
  // the pointed-at and previous cases above, which run on both.
  itLinux('guard — every tag the control plane projection names is never pruned (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-desired-', ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0']);
    stopUnits(home);
    plantRole(home, 'fleet');
    plantSyncTimer(home);
    plantClock(home);
    plantIntent(home, intentDoc({ desired: 'v1.0.3', desiredStable: 'v1.0.2', desiredDev: 'v1.0.1' }));
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.3 {2}complete {2}kept: desired$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.2 {2}complete {2}kept: desired-stable$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.1 {2}complete {2}kept: desired-dev$/m);
    expect(versionDirs(home)).toEqual(['v1.0.1', 'v1.0.2', 'v1.0.3', 'v1.0.4']);
  });

  // PLATFORM-ONLY: this is systemd's `show -p ExecStart` struct. The macOS
  // arm reads the job's plist instead; the case after this one measures that
  // arm on either platform by forcing CCD_OS in a sourced shell.
  itLinux('guard — a version a running unit argv[] names directly is never pruned, and path= is never what is read (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-running-', ['v1.0.2', 'v1.0.1', 'v1.0.0']);
    // Both units RUN (the stub's default answer). The agent's command names
    // v1.0.1's own path — a unit hand-edited to run from a physical path.
    writeFileSync(join(home, 'fixture-execstart-ccrc-agent.service'),
      `/usr/bin/env node ${home}/ccrc-versions/v1.0.1/agent/dist/agent/src/index.js\n`);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.1 {2}complete {2}kept: running$/m);
    // ccrc.service's command names $HOME/ccrc/…, which resolves through the link
    expect(r.stdout).toMatch(/^ {2}\* v1\.0\.2 {2}complete {2}kept: pointed-at running$/m);
    expect(versionDirs(home)).toEqual(['v1.0.1', 'v1.0.2']);
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8').split('\n');
    expect(calls).toContain('--user show -p ExecStart ccrc.service');
    expect(calls).toContain('--user show -p ExecStart ccrc-agent.service');
  });

  it('the Darwin arm reads the job ProgramArguments through plutil, the quotes round the entry path stripped — and an empty answer is unmeasured', () => {
    const home = versionedBox('ccrc-versions-darwin-arm-', ['v1.0.2', 'v1.0.1']);
    const entry = `${home}/ccrc-versions/v1.0.1/server/dist/server/src/index.js`;
    // What `plutil -convert json` prints for `_inst_plist_server`'s job (its
    // `&amp;&amp;` is `&&` once parsed; the entry path single-quoted).
    writeFileSync(join(home, 'fixture-plist.json'), `${JSON.stringify({
      Label: 'app.ccrc.ccrc',
      ProgramArguments: ['/bin/bash', '-c',
        `set -a; [ -f '${home}/.ccrc/ccrc.env' ] && . '${home}/.ccrc/ccrc.env'; `
        + `[ -f '${home}/.ccrc/exposure.env' ] && . '${home}/.ccrc/exposure.env'; set +a; `
        + `exec /usr/bin/env node '${entry}'`],
    })}\n`);
    const probe = (plutil: string): Result => sourcedCcrc(home, [
      'CCD_OS=darwin',
      plutil,
      '_svc_is_active() { case "$1" in ccrc.service) printf active ;; *) printf inactive ;; esac; }',
      '_ver_running_names; rc=$?',
      'printf "rc=%s running=[%s] why=[%s]\\n" "$rc" "${VER_RUNNING[*]}" "$VER_WHY"',
    ].join('\n'));
    let r = probe('plutil() { [ "$1 $2 $3 $4" = "-convert json -o -" ] && cat "$HOME/fixture-plist.json"; }');
    expect(r.stdout, r.stderr).toBe('rc=0 running=[v1.0.1] why=[]\n');
    r = probe('plutil() { return 0; }');
    expect(r.stdout, r.stderr).toBe(
      "rc=1 running=[] why=[ccrc.service is running and its job file's ProgramArguments could not be read (plutil -convert json)]\n");
  });

  // PLATFORM-ONLY: every input here is one only a Linux box's reader asks —
  // systemd's is-active and ExecStart, `readlink -f` on the tokens those
  // yield, and a projection (macOS is never centrally managed, decision 17).
  // The input both platforms read, ~/.ccrc/previous, is the next case.
  itLinux('an input that cannot be measured prunes nothing, and the prune says which (unit state, ExecStart, readlink -f, the projection)', () => {
    const fixtures: Array<[string, (h: string) => void, (h: string) => string]> = [
      ['unit-state', (h) => writeFileSync(join(h, 'fixture-unit-state'), ''),
        () => 'the service manager did not say whether ccrc.service is running (no answer)'],
      ['execstart', (h) => writeFileSync(join(h, 'fixture-execstart-raw'),
        `ExecStart=/usr/bin/env node ${h}/ccrc/server/dist/server/src/index.js\n`),
      () => "ccrc.service's ExecStart did not parse as systemd's struct form"],
      ['readlink', (h) => plantReadlinkFEmpty(h),
        (h) => `ccrc.service's command names ${h}/ccrc/server/dist/server/src/index.js, which readlink -f could not resolve`],
      ['projection', (h) => {
        stopUnits(h); plantRole(h, 'fleet'); plantSyncTimer(h); plantClock(h);
        plantIntent(h, intentDoc({ issued: String(INTENT_NOW - 2000), lease: String(INTENT_NOW - 1000) }));
      }, () => "the control plane's projection is stale (its lease ended 1000s ago) — its desired tags cannot be read"],
    ];
    for (const [label, plant, why] of fixtures) {
      const home = versionedBox(`ccrc-versions-unmeasured-${label}-`, ['v1.0.1', 'v1.0.0']);
      plant(home);
      const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
      expect(r.code, `${label}: ${r.stdout}${r.stderr}`).toBe(1);
      expect(r.stdout, label).toMatch(new RegExp(`^versions: prune skipped — ${lit(why(home))}; nothing was removed$`, 'm'));
      expect(r.stdout, label).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: unmeasured$/m);
      expect(versionDirs(home), label).toEqual(['v1.0.0', 'v1.0.1']);
    }
  });

  // Both platforms: `_plat_mtime` is `stat -c %Y` or `stat -f %m`, and the
  // shim below fails either spelling the same way. It is not a fifth row of
  // the itLinux table above, so the macOS leg measures it too.
  it('a kept install record whose mtime cannot be read prunes nothing — the keep-N order would be a guess', () => {
    const home = versionedBox('ccrc-versions-unmeasured-mtime-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    // `stat` that fails for a kept install record, and only for one; every
    // other argv is the real binary (plantReadlinkFEmpty's idiom).
    writeFileSync(join(home, 'doctor-stubs', 'stat'),
      '#!/bin/sh\n'
      + 'for a in "$@"; do last="$a"; done\n'
      + 'if [ -f "$HOME/fixture-stat-record-fails" ]; then\n'
      + '  case "$last" in */.ccrc-installed) echo "stat: cannot statx \'$last\': Permission denied" >&2; exit 1 ;; esac\n'
      + 'fi\n'
      + `exec ${REAL_STAT} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(home, 'fixture-stat-record-fails'), 'yes\n');
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `${r.stdout}${r.stderr}`).toBe(1);
    // The glob runs in name order and VER_WHY keeps the LAST record that failed.
    expect(r.stdout).toMatch(/^versions: prune skipped — the kept install record of v1\.0\.1 has no readable mtime; nothing was removed$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: unmeasured$/m);
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  it('a malformed ~/.ccrc/previous prunes nothing — by hand or automatically', () => {
    const home = versionedBox('ccrc-versions-prev-bad-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    plantPrevious(home, 'garbage\n');
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).toMatch(/^versions: prune skipped — ~\/\.ccrc\/previous is unreadable or malformed; nothing was removed$/m);
    const a = sourcedCcrc(home, 'CCRC_VERSIONS_KEEP=0; _ver_gc update auto; echo "rc=$?"');
    expect(a.stdout, a.stderr).toBe('update: versions: WARN: nothing pruned — ~/.ccrc/previous is unreadable or malformed\nrc=1\n');
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  it('the automatic GC is silent, and measures nothing, when nothing is prunable whatever is protected', () => {
    const home = versionedBox('ccrc-versions-silent-', ['v1.0.1', 'v1.0.0']);
    // an input that WOULD stop a prune that measured it
    plantPrevious(home, 'garbage\n');
    const quiet = sourcedCcrc(home, '_ver_gc install auto; echo "rc=$?"');
    expect(quiet.stdout, quiet.stderr).toBe('rc=0\n');
    // the control: with one complete version more than CCRC_VERSIONS_KEEP, the
    // same box measures — and says why it stops
    const loud = sourcedCcrc(home, 'CCRC_VERSIONS_KEEP=0; _ver_gc install auto; echo "rc=$?"');
    expect(loud.stdout, loud.stderr).toBe('install: versions: WARN: nothing pruned — ~/.ccrc/previous is unreadable or malformed\nrc=1\n');
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  it('the automatic GC never removes an incomplete version — a plain install may be placing it; --prune does', () => {
    const home = versionedBox('ccrc-versions-incomplete-', ['v1.0.2', 'v1.0.1'], ['untagged-0123456789ab']);
    stopUnits(home);
    const a = sourcedCcrc(home, 'CCRC_VERSIONS_KEEP=0; _ver_gc install auto; echo "rc=$?"');
    expect(a.stdout, a.stderr).toBe('install: versions: pruned $HOME/ccrc-versions/v1.0.1 (complete, not among the newest 0)\nrc=0\n');
    expect(versionDirs(home)).toEqual(['untagged-0123456789ab', 'v1.0.2']);
    const p = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(p.code, p.stdout).toBe(0);
    expect(p.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/untagged-0123456789ab \(incomplete\)$/m);
    expect(versionDirs(home)).toEqual(['v1.0.2']);
  });

  it('--prune takes the update lock: a real holder refuses it at exit 1 and nothing is removed', () => {
    const home = versionedBox('ccrc-versions-lock-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    const lock = join(home, '.ccrc', 'update.lock');
    const holder = spawn('flock', [lock, 'sleep', '30'], { stdio: 'ignore', detached: true });
    try {
      // HELD is measured, never assumed from the spawn: a fresh flock -n fails.
      let held = false;
      for (let i = 0; i < 100 && !held; i++) {
        held = existsSync(lock) && spawnSync('flock', ['-n', lock, 'true']).status === 1;
        if (!held) spawnSync('sleep', ['0.05']);
      }
      expect(held).toBe(true);
      const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
      expect(r.code, r.stdout).toBe(1);
      expect(r.stderr).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(/m);
      expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
    } finally {
      if (holder.pid !== undefined) {
        try { process.kill(-holder.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
  });

  it('_ver_list restores the caller nullglob, whichever way it was set', () => {
    const home = versionedBox('ccrc-versions-nullglob-', ['v1.0.1', 'v1.0.0']);
    const r = sourcedCcrc(home, [
      'shopt -u nullglob; _ver_list; shopt -q nullglob && echo on || echo off',
      'shopt -s nullglob; _ver_list; shopt -q nullglob && echo on || echo off',
      'printf "%s\\n" "${VER_NAMES[*]}"',
    ].join('\n'));
    expect(r.stdout, r.stderr).toBe('off\non\nv1.0.1 v1.0.0\n');
  });

  // PLATFORM-ONLY: on macOS the running read is plutil over the job's plist,
  // which this harness's plutil stub answers with nothing — an unmeasured
  // read, so the automatic GC WARNs and prunes nothing there (the safe
  // direction). The Darwin read itself is measured by the sourced case above.
  itLinux('an update whose health gate passed prunes behind it and keeps the previous', () => {
    const home = versionedBox('ccrc-versions-update-gc-', ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0']);
    plantKillModeDropIn(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The STUB spine's ccd/ccrc carries no BOX_VERSIONS_ROOT= line, so Task 4's
    // `_upd_legacy_target` gave it v2.0.0 (a copy of v1.0.4, its kept record
    // removed): five complete versions stand beside the pointed-at one. v1.0.4
    // is this run's `previous` (the stamp it replaced) and is protected, so it
    // takes no keep slot: the newest three of the REST stay (v1.0.3, v1.0.2,
    // v1.0.1) and only v1.0.0 goes. v1.0.1 staying is what measures the
    // previous guard here — without it v1.0.4 would fill a slot and v1.0.1
    // would be pruned too.
    expect(r.stdout).toMatch(/^update: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 3\)$/m);
    expect(r.stdout).not.toMatch(/^update: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.1 /m);
    expect(versionDirs(home)).toEqual(['v1.0.1', 'v1.0.2', 'v1.0.3', 'v1.0.4', 'v2.0.0']);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8').split('\n')[0]).toBe('v1.0.4');
  });
});
```

(d) `server/test/ccrc-install.test.ts`. Append as the LAST `it` of Task 2's describe `ccrc install: the versioned tree (W6 Task 2)`, immediately before that describe's closing `});`:

```ts
  // PLATFORM-ONLY: the GC's running-unit read on macOS is plutil over the
  // job's plist, which this harness's plutil stub answers with nothing — an
  // unmeasured read, so a macOS install WARNs and prunes nothing (the safe
  // direction, pinned in ccrc-update.test.ts, where the Darwin read itself is
  // measured by forcing CCD_OS in a sourced shell).
  itLinux('after an install whose doctor passed, the GC keeps the newest CCRC_VERSIONS_KEEP beside the pointed-at one and prunes the rest (W6 Task 5)', () => {
    const home = freshBox('ccrc-install-w6-gc-');
    ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0'].forEach((n, i) => {
      const root = installVersionedTree(home, n, { link: i === 0, stamp: { sha: 'b'.repeat(40), version: n } });
      const t = 1_800_000_000 - i * 100;
      utimesSync(join(root, '.ccrc-installed'), t, t);
    });
    // The projection a `both` box reads (W2's server writes it): in force and
    // naming no tag, so every one of the GC's inputs measures.
    const now = Math.floor(Date.now() / 1000);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'update-intent'), [
      'epoch 1', `issued ${now - 60}`, `lease ${now + 86_400}`, 'channel stable',
      'desired none', 'desired-stable none', 'desired-dev none', 'auto off', 'end',
    ].join('\n') + '\n', { mode: 0o600 });
    const r = runInstall(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.1 \(complete, not among the newest 3\)$/m);
    expect(r.stdout).toMatch(/^install: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 3\)$/m);
    const left = readdirSync(join(home, 'ccrc-versions')).sort();
    const placedName = left.find((n) => n.startsWith('unstamped-'));
    expect(placedName, left.join(' ')).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(left).toEqual([placedName!, 'v1.0.2', 'v1.0.3', 'v1.0.4'].sort());
    // …and it ran BEHIND the gate: after doctor's summary, never before it.
    expect(r.stdout.indexOf('install: versions: pruned'))
      .toBeGreaterThan(r.stdout.search(/^summary: /m));
  });

  // W6 Task 5 introduces a remover that can run BESIDE a plain install, which
  // takes no lock: `ccrc versions --prune` removes an incomplete directory
  // (the one this run is placing), and another run's automatic GC removes a
  // complete one that nothing protects yet. `_plat_ln_swap` never checks its
  // target, so the flip measures it again (D-3456).
  it('a new version removed before the flip — a prune beside a plain install — is refused, and ~/ccrc keeps the version it names (W6 Task 5)', () => {
    const home = freshBox('ccrc-install-w6-vanished-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    shipStamp(treeRoot(home), 'b'.repeat(40), 'v9.9.1');
    // This run's last npm ci (the default role runs none in the agent)
    // succeeds and then stands in for the concurrent prune: the directory
    // it ran in is gone before the flip.
    const r = runInstall(home, ['install'], {}, {
      stubs: {
        npm: '#!/bin/sh\nmkdir -p node_modules\n'
          + 'case "$PWD" in */ccrc-versions/v9.9.1/server) rm -rf -- "${PWD%/server}" ;; esac\nexit 0\n',
      },
    });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: the new tree at \$HOME\/ccrc-versions\/v9\.9\.1 is gone before the flip — a prune may have run beside this install; \$HOME\/ccrc was not touched, and the install can be run again$/m);
    expect(readlinkSync(join(home, 'ccrc')), '~/ccrc was flipped onto a tree that is gone').toBe(vroot(home, 'v9.9.0'));
    expect(existsSync(join(home, 'ccrc', 'ccd', 'ccrc'))).toBe(true);
    expect(r.stdout).not.toMatch(/one rename$/m);
  });
```

(e) `server/test/ccrc-cli.test.ts`, in `it('the usage line names every verb this CLI will have'` (`:147`):

- In the verb-list regex (`:181`), replace `\|rollback\|channel\|` with `\|rollback\|versions\|channel\|`.
- On the line after `    expect(r.stdout).toMatch(/^ {2}update {4}fetch a published release/m);`, add:

```ts
    expect(r.stdout).toMatch(/^ {2}versions {2}list the kept release trees under ~\/ccrc-versions/m);
```

- Append to the comment block, as its last paragraph, above `const home = mkTmp('ccrc-cli-usage-verbs-');`:

```ts
    //
    // `versions` joined it in W6 Task 5 (design 2026-09-20 §11) — the kept
    // release trees under ~/ccrc-versions and the one hand-run prune, which
    // never removes a version the box needs. Same split:
    // `server/test/ccrc-update.test.ts` owns what it does, this line owns that
    // an operator can find it.
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'the GC that never removes a needed version'` (foreground, timeout ≥ 600000 ms)
Expected: FAIL. On Linux all eighteen cases fail; on macOS the four `itLinux` cases report as skipped. Each fails for its own reason:
- every `runVersions` case: exit 2, stderr `ccrc: unknown argument: versions`;
- the sourced cases: stderr `_ver_gc: command not found` or `_ver_list: command not found` / `_ver_running_names: command not found`, and stdout without the expected lines;
- the update case: exit 0, with no `update: versions: pruned` line and five version directories plus `v2.0.0` left.

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'the GC keeps the newest CCRC_VERSIONS_KEEP'`
Expected: FAIL. There is no `install: versions: pruned` line, and six directories remain under `~/ccrc-versions`.

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'removed before the flip'`
Expected: FAIL. The `is gone before the flip` refusal is absent, and `_plat_ln_swap` pointed `~/ccrc` at the removed `v9.9.1` (`~/ccrc was flipped onto a tree that is gone`). Whatever exit code the rest of that spine reaches over a dangling `~/ccrc` is not what reds it.

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-cli.test.ts -t 'the usage line names every verb'`
Expected: FAIL — the `{…}` list has no `versions`.

- [ ] **Step 3: Implement**

All edits are in `ccd/ccrc`. Locate each spot by its grep.

(a) Globals, on the lines after Task 2's `VER_WHY=""` (`grep -n '^VER_WHY=""' ccd/ccrc`):

```bash
# `ccrc versions` and the GC (W6 Task 5), declared at file scope for the
# `set -u` reason the arrays above are. The two ASSOCIATIVE arrays,
# VER_PROTECT (<name> -> the words that keep it) and VER_VERDICT (<name> ->
# the listing's verdict), are declared `declare -gA` inside the functions
# that reset them instead: `declare -g` is bash 4.2, and at file scope
# macOS's /bin/bash 3.2 would print an invalid-option error on every ccrc
# invocation, ahead of cmd_install's bash-floor refusal.
VER_NAMES=()                 # _ver_list: the version directories, complete ones newest first
VER_RUNNING=()               # _ver_running_names: the versions a running unit's command resolves to
VER_DOOMED=()                # _ver_verdicts: what a prune removes, in order …
VER_DOOMED_WHY=()            # … and why, index for index
```

(b) The block. `grep -n '^_bak_prune() {' ccd/ccrc` prints `_bak_prune`'s first line; its closing `}` is the first line after it that is exactly `}`. On the blank line between that `}` and `# ── cmd_logs — the journal, thin (stage 4, Task 8; spec §7) ───────────────`, insert:

```bash

# ── ccrc versions, and the GC that never removes a needed version ─────────
# (design 2026-09-20 §11 "GC"; W6 Task 5.) `_bak_prune` above is the sweep
# this copies — nullglob saved and restored, a fixed shape, newest-N — and
# the differences are the guards: a version directory is removed only when
# nothing on this box needs it. Needed means the version `~/ccrc` points at,
# the previous (`~/.ccrc/previous`), every tag the control plane's projection
# names (D-3420), and every version a running
# ccrc.service/ccrc-agent.service runs from (D-3446);
# beyond those, the newest CCRC_VERSIONS_KEEP complete ones
# (D-3423). An input that cannot be measured stops the whole
# prune (D-3447); the automatic GC never removes
# an incomplete version, which a concurrent plain install may be placing
# (D-3448). The CALLER holds ~/.ccrc/update.lock.

# `_ver_list` → VER_NAMES: every real directory directly under
# $BOX_VERSIONS_ROOT whose name is a version name — complete ones (their kept
# install record present) first, newest record first, then the incomplete
# ones by name. Dot-names (a legacy target's `.incoming`) and anything else
# are never listed, so never touched. The ordering is bash-only: no `sort`
# binary on the install path. rc 1 (VER_WHY) when a record's mtime cannot be
# read — the order is then unknown, and a prune that needs it is skipped;
# VER_NAMES is still filled.
_ver_list() {
  VER_NAMES=()
  local had_nullglob=0 d n t i j rc=0
  local -a cn=() ct=() part=()
  [ -d "$BOX_VERSIONS_ROOT" ] || return 0
  shopt -q nullglob && had_nullglob=1
  shopt -s nullglob
  for d in "$BOX_VERSIONS_ROOT"/*; do
    n="${d##*/}"
    [[ "$n" =~ $VER_NAME_RE ]] || continue
    { [ -d "$d" ] && [ ! -L "$d" ]; } || continue
    if [ -f "$d/$VER_RECORD_COPY" ]; then
      t="$(_plat_mtime "$d/$VER_RECORD_COPY" 2>/dev/null)" || t=""
      if [[ ! "$t" =~ ^[0-9]+$ ]]; then
        t=0; rc=1; VER_WHY="the kept install record of $n has no readable mtime"
      fi
      cn+=("$n"); ct+=("$t")
    else
      part+=("$n")
    fi
  done
  [ "$had_nullglob" -eq 1 ] || shopt -u nullglob   # the caller's nullglob, restored (_bak_prune's idiom)
  # Insertion sort, newest first. The glob expanded in name order and a tie
  # never moves an element, so equal mtimes keep that order.
  for ((i = 1; i < ${#cn[@]}; i++)); do
    n="${cn[$i]}"; t="${ct[$i]}"; j=$((i - 1))
    while [ "$j" -ge 0 ] && [ "${ct[$j]}" -lt "$t" ]; do
      cn[j + 1]="${cn[$j]}"; ct[j + 1]="${ct[$j]}"; j=$((j - 1))
    done
    cn[j + 1]="$n"; ct[j + 1]="$t"
  done
  VER_NAMES=("${cn[@]}" "${part[@]}")
  return "$rc"
}

# `_ver_running_names` → rc 0 with VER_RUNNING = the version names a RUNNING
# ccrc.service/ccrc-agent.service command resolves to; rc 1 (VER_WHY) when
# that cannot be measured. Spec §11 reads `systemctl --user show -p
# ExecStart` through `readlink -f`. Three things it takes care over:
#   - systemd prints a STRUCT, `ExecStart={ path=<p> ; argv[]=<argv> ;
#     ignore_errors=… ; … }`, and `path=` is `/usr/bin/env` for both units:
#     the tree path is inside argv[], which is what is read.
#   - `readlink -f` resolves the token's VERSION PREFIX (`$HOME/ccrc`, or
#     `$HOME/ccrc-versions/<seg>`), not the whole token: GNU `readlink -f`
#     answers empty, rc 1, when any directory above the last component is
#     missing (measured 2026-09-23, coreutils 9.4), and which version a
#     command runs from is decided by its prefix alone
#     (D-3449).
#   - an empty answer — from `_svc_is_active` (the manager did not answer),
#     from `readlink -f` (BSD before macOS 12.3 has no -f) — is UNMEASURED,
#     never "not running": reading it as "not running" prunes the version the
#     guard exists for.
# On macOS the job's own plist is read (`_svc_plist`, `plutil -convert
# json`), its ProgramArguments split on whitespace with the quotes
# `_inst_plist_server` puts round the entry path stripped.
_ver_running_names() {
  VER_RUNNING=()
  local unit st line argv tok pfx seg res vroot="" name json
  local re='^ExecStart=\{ path=([^ ]*) ; argv\[\]=(.*) ; ignore_errors='
  local -a toks=()
  for unit in "${BOX_UNIT_NAMES[@]}"; do
    st="$(_svc_is_active "$unit")"
    case "$st" in
      active|activating|deactivating|reloading|refreshing) ;;
      inactive|failed) continue ;;   # a stopped unit runs nothing
      *) [[ "$st" =~ ^[a-z-]{1,32}$ ]] || st="${st:+an unrecognised answer}"
         VER_WHY="the service manager did not say whether $unit is running (${st:-no answer})"
         return 1 ;;
    esac
    if [ "$CCD_OS" = darwin ]; then
      json="$(plutil -convert json -o - "$(_svc_plist "$unit")" 2>/dev/null)" || json=""
      argv="$(printf '%s' "$json" | jq -er '.ProgramArguments | if type == "array" and length > 0 then map(tostring) | join(" ") else error("none") end' 2>/dev/null)" \
        || { VER_WHY="$unit is running and its job file's ProgramArguments could not be read (plutil -convert json)"; return 1; }
    else
      line="$(systemctl --user show -p ExecStart "$unit" 2>/dev/null)" || line=""
      [[ "$line" =~ $re ]] || { VER_WHY="$unit's ExecStart did not parse as systemd's struct form"; return 1; }
      argv="${BASH_REMATCH[2]}"
    fi
    read -r -a toks <<<"$argv"
    for tok in "${toks[@]}"; do
      tok="${tok#\'}"; tok="${tok#\"}"; tok="${tok%;}"; tok="${tok%\'}"; tok="${tok%\"}"
      case "$tok" in
        "$BOX_TREE_DIR"/*) pfx="$BOX_TREE_DIR" ;;
        "$BOX_VERSIONS_ROOT"/*) seg="${tok#"$BOX_VERSIONS_ROOT"/}"; pfx="$BOX_VERSIONS_ROOT/${seg%%/*}" ;;
        *) continue ;;
      esac
      res="$(readlink -f -- "$pfx" 2>/dev/null)" || res=""
      [ -n "$res" ] || { VER_WHY="$unit's command names $tok, which readlink -f could not resolve"; return 1; }
      if [ -z "$vroot" ]; then
        vroot="$(readlink -f -- "$BOX_VERSIONS_ROOT" 2>/dev/null)" || vroot=""
        [ -n "$vroot" ] \
          || { VER_WHY="\$HOME/ccrc-versions could not be resolved by readlink -f"; return 1; }
      fi
      case "$res" in
        "$vroot"/*) name="${res#"$vroot"/}"; name="${name%%/*}"
                    [[ "$name" =~ $VER_NAME_RE ]] && VER_RUNNING+=("$name") ;;
      esac
    done
  done
  return 0
}

# `_ver_protect_add <name> <word>` — one reason a version is kept, once.
# Anything that is not a version name (the projection's `none`, an absent
# tag) protects nothing and is dropped here.
_ver_protect_add() {
  [[ "$1" =~ $VER_NAME_RE ]] || return 0
  case " ${VER_PROTECT[$1]:-} " in *" $2 "*) return 0 ;; esac
  VER_PROTECT[$1]="${VER_PROTECT[$1]:+${VER_PROTECT[$1]} }$2"
}

# `_ver_protect` → rc 0 with VER_PROTECT[<name>] = the words that keep it;
# rc 1 (VER_WHY) when an input cannot be measured. The projection is read in
# a subshell so the caller's UPD_INTENT_* (cmd_update's own read) is left as
# it found it. An UNTAGGED previous (wave 4's D-3231 lines `untagged` /
# <the stamp's sha>) still names a directory: `_inst_version_name` put that
# build at `untagged-<sha12>` from the same stamp sha, so that is the name
# kept. Line 2 `unstamped` makes `untagged-unstamped`, which is not a
# version name, and `_ver_protect_add` drops it.
_ver_protect() {
  declare -gA VER_PROTECT=()
  local prc=0 n
  local -a iv=()
  [ -n "$VER_CURRENT" ] && _ver_protect_add "$VER_CURRENT" pointed-at
  _upd_read_previous || prc=$?
  case "$prc" in
    0) _ver_protect_add "$UPD_PREV_TAG" previous ;;
    2) _ver_protect_add "untagged-${UPD_PREV_SHA:0:12}" previous ;;
    1) ;;   # no previous: nothing to keep for it
    *) VER_WHY="~/.ccrc/previous is unreadable or malformed"; return 1 ;;
  esac
  mapfile -t iv < <(_upd_intent_state
    printf '%s\n' "$UPD_INTENT_STATE" "$UPD_INTENT_WHY" "$UPD_INTENT_DESIRED" \
      "$UPD_INTENT_DESIRED_STABLE" "$UPD_INTENT_DESIRED_DEV")
  [ "${#iv[@]}" -eq 5 ] \
    || { VER_WHY="the control plane's projection could not be read"; return 1; }
  case "${iv[0]}" in
    ok|none)
      _ver_protect_add "${iv[2]}" desired
      _ver_protect_add "${iv[3]}" desired-stable
      _ver_protect_add "${iv[4]}" desired-dev ;;
    not-configured) ;;   # no control plane on this box: it names no tag
    *) VER_WHY="the control plane's projection is ${iv[0]} (${iv[1]}) — its desired tags cannot be read"
       return 1 ;;
  esac
  _ver_running_names || return 1
  for n in "${VER_RUNNING[@]}"; do _ver_protect_add "$n" running; done
  return 0
}

# `_ver_verdicts <auto|prune> <keep>` — the ONE place a version's fate is
# decided, for the listing and the prune alike, over VER_NAMES in
# `_ver_list`'s order: protected → kept; complete → the first <keep> kept,
# the rest doomed; incomplete → doomed by `prune` only. Fills VER_VERDICT
# and VER_DOOMED / VER_DOOMED_WHY. rc 0.
_ver_verdicts() {
  declare -gA VER_VERDICT=()
  local mode="$1" keep="$2" n slots=0
  VER_DOOMED=(); VER_DOOMED_WHY=()
  for n in "${VER_NAMES[@]}"; do
    # Not bash 4.2's `-v` variable test: bash 3.2 cannot PARSE it inside
    # `[[ ]]`, and a parse error here would stop the whole file before
    # cmd_install's bash-floor refusal. `_ver_protect_add` never stores an
    # empty value, so non-empty is the same question.
    if [ -n "${VER_PROTECT[$n]:-}" ]; then
      VER_VERDICT[$n]="kept: ${VER_PROTECT[$n]}"
    elif [ -f "$BOX_VERSIONS_ROOT/$n/$VER_RECORD_COPY" ]; then
      if [ "$slots" -lt "$keep" ]; then
        slots=$((slots + 1)); VER_VERDICT[$n]="kept: newest $keep"
      else
        VER_VERDICT[$n]="prunable"
        VER_DOOMED+=("$n"); VER_DOOMED_WHY+=("complete, not among the newest $keep")
      fi
    else
      VER_VERDICT[$n]="prunable by --prune only"
      if [ "$mode" = prune ]; then VER_DOOMED+=("$n"); VER_DOOMED_WHY+=("incomplete"); fi
    fi
  done
  return 0
}

# `_ver_gc <prefix> <auto|prune>` → rc 0 done (or nothing to do), rc 1
# skipped on an unmeasured input or a removal failed. `auto` is the call
# after a PASSED gate only — a plain install's doctor under a free lock, an
# update's `_upd_gate` — never after a failed one, and never inside a restore
# or a rollback, whose spine runs under its parent's lock
# (D-3451); it says nothing unless it removes
# something or skips. `prune` is `ccrc versions --prune`, which also removes
# incomplete versions.
_ver_gc() {
  local pfx="$1" mode="$2" keep="${CCRC_VERSIONS_KEEP:-3}" lead n i cur
  local rc=0 lrc=0 prc=0 ncomp=0 npart=0
  lead="$pfx: versions:"; [ "$pfx" = versions ] && lead="versions:"
  if [[ ! "$keep" =~ ^[0-9]+$ ]]; then
    if [ "$mode" = auto ]; then
      echo "$lead WARN: CCRC_VERSIONS_KEEP is not a number — nothing pruned"
    else
      echo "versions: CCRC_VERSIONS_KEEP must be a number (got a non-numeric value) — nothing was pruned"
    fi
    return 1
  fi
  _ver_layout
  case "$VER_LAYOUT" in
    linked|migrated) ;;
    *) [ "$mode" = auto ] || echo "versions: nothing to prune — \$HOME/ccrc is not versioned ($VER_LAYOUT)"
       return 0 ;;
  esac
  _ver_list || lrc=$?
  for n in "${VER_NAMES[@]}"; do
    [ "$n" = "$VER_CURRENT" ] && continue
    if [ -f "$BOX_VERSIONS_ROOT/$n/$VER_RECORD_COPY" ]; then ncomp=$((ncomp + 1)); else npart=$((npart + 1)); fi
  done
  # NOTHING IS PRUNABLE, WHATEVER IS PROTECTED (D-3450):
  # a protection can only take a version OUT of the removal set, so with no
  # more complete versions than <keep> beside the pointed-at one (and, for
  # `auto`, incomplete ones never counted) there is nothing to measure — and
  # no service manager, projection or previous is read.
  if [ "$ncomp" -le "$keep" ] && { [ "$mode" = auto ] || [ "$npart" -eq 0 ]; }; then
    [ "$mode" = auto ] || echo "versions: nothing to prune — $ncomp complete version(s) beside the pointed-at one, within CCRC_VERSIONS_KEEP=$keep, and none incomplete"
    return 0
  fi
  if [ "$lrc" -eq 0 ]; then _ver_protect || prc=$?; else prc=1; fi
  if [ "$prc" -ne 0 ]; then
    if [ "$mode" = auto ]; then
      echo "$lead WARN: nothing pruned — $VER_WHY"
    else
      echo "versions: prune skipped — $VER_WHY; nothing was removed"
    fi
    return 1
  fi
  _ver_verdicts "$mode" "$keep"
  if [ "${#VER_DOOMED[@]}" -eq 0 ]; then
    [ "$mode" = auto ] || echo "versions: nothing to prune — every kept tree is protected or among the newest $keep"
    return 0
  fi
  for i in "${!VER_DOOMED[@]}"; do
    n="${VER_DOOMED[$i]}"
    # A belt over `pointed-at`: the link is read again at the moment of the
    # removal, and a link that names this directory — or cannot be read —
    # stops it.
    cur="$(readlink -- "$BOX_TREE_DIR" 2>/dev/null)" || cur=""
    if [ -z "$cur" ] || [ "${cur%/}" = "$BOX_VERSIONS_ROOT/$n" ]; then
      echo "$lead could not prune \$HOME/ccrc-versions/$n — \$HOME/ccrc points at it or could not be read; every version above it is intact"
      rc=1; continue
    fi
    if rm -rf -- "$BOX_VERSIONS_ROOT/$n"; then
      echo "$lead pruned \$HOME/ccrc-versions/$n (${VER_DOOMED_WHY[$i]})"
    else
      echo "$lead could not prune \$HOME/ccrc-versions/$n — every version above it is intact"
      rc=1
    fi
  done
  return "$rc"
}

# `ccrc versions [--prune]` — the kept release trees, and the one hand-run
# prune (design §11 "GC and `ccrc versions`"). The listing takes no lock and
# writes nothing; `--prune` takes update's lock (a prune never races an
# update's flip), completes a crashed migration first, prunes, and then
# lists what is left. Exit 0 listed or pruned; 1 a prune skipped or a
# removal failed; 2 usage.
cmd_versions() {
  local prune=0 keep="${CCRC_VERSIONS_KEEP:-3}" grc=0 lrc=0 prc=0 n mark cpl line
  while [ $# -gt 0 ]; do
    case "$1" in
      --prune) prune=1 ;;
      -h|--help) usage; exit 0 ;;
      *) _ccrc_usage_die "$1" ;;
    esac
    shift
  done
  [[ "$keep" =~ ^[0-9]+$ ]] \
    || _ccrc_die "versions: CCRC_VERSIONS_KEEP must be a number (got a non-numeric value) — nothing was pruned"
  if [ "$prune" -eq 1 ]; then
    _upd_lock
    _inst_migrate_resume versions
    _ver_gc versions prune || grc=$?
    _upd_unlock
  fi
  _ver_layout
  case "$VER_LAYOUT" in
    linked|migrated)
      line="versions: \$HOME/ccrc -> \$HOME/ccrc-versions/$VER_CURRENT"
      if [[ "$VER_CURRENT" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] && _box_build_fields; then
        [ "${BOX_BUILD[4]}" = "$VER_CURRENT" ] \
          || line="$line (its stamp reads ${BOX_BUILD[4]:-an unversioned build} — something wrote through \$HOME/ccrc)"
      fi
      echo "$line"
      if [ "$VER_LAYOUT" = migrated ]; then
        echo "versions: \$HOME/ccrc.migrating (the pre-versioned tree) is kept until a health gate passes"
      fi ;;
    directory) echo "versions: \$HOME/ccrc is a directory — not versioned yet; the next ccrc install or update migrates it" ;;
    absent)    echo "versions: no \$HOME/ccrc on this box" ;;
    crashed)   echo "versions: a migration crashed — \$HOME/ccrc is absent beside \$HOME/ccrc.migrating; $(_ver_crashed_remedy)" ;;
    *)         echo "versions: \$HOME/ccrc is $VER_WHY — not touching it" ;;
  esac
  declare -gA VER_VERDICT=()
  _ver_list || lrc=$?
  case "$VER_LAYOUT" in
    linked|migrated)
      if [ "$lrc" -eq 0 ]; then _ver_protect || prc=$?; else prc=1; fi
      if [ "$prc" -ne 0 ]; then
        echo "versions: WARN: $VER_WHY — nothing would be pruned"
        for n in "${VER_NAMES[@]}"; do VER_VERDICT[$n]="kept: unmeasured"; done
      else
        _ver_verdicts prune "$keep"
      fi ;;
    *) for n in "${VER_NAMES[@]}"; do VER_VERDICT[$n]="kept: nothing is pruned while \$HOME/ccrc reads $VER_LAYOUT"; done ;;
  esac
  for n in "${VER_NAMES[@]}"; do
    mark=" "; [ "$n" = "$VER_CURRENT" ] && mark="*"
    cpl=incomplete; [ -f "$BOX_VERSIONS_ROOT/$n/$VER_RECORD_COPY" ] && cpl=complete
    printf '  %s %s  %s  %s\n' "$mark" "$n" "$cpl" "${VER_VERDICT[$n]}"
  done
  echo "versions: ${#VER_NAMES[@]} kept tree(s) under \$HOME/ccrc-versions; CCRC_VERSIONS_KEEP=$keep plus the protected set (pointed-at, previous, the projection's desired tags, running units) — 'ccrc versions --prune' removes the prunable ones"
  return "$grc"
}
```

(c) Dispatch. On the line after `  rollback) cmd_rollback "$@" ;;` (`grep -n '^  rollback) cmd_rollback' ccd/ccrc`), add:

```bash
  versions) cmd_versions "$@" ;;
```

(d) `usage()`. In the verb-list line (`grep -n '^usage: \$PROG {' ccd/ccrc`), replace `|rollback|channel|` with `|rollback|versions|channel|`. Then, immediately BEFORE the line `  channel   print this box's update channel as the control plane projects` (`grep -n "^  channel   print this box's update channel" ccd/ccrc`), insert these lines. The heredoc is unquoted, and the text carries no `$` and no backtick:

```
  versions  list the kept release trees under ~/ccrc-versions (* marks the one ~/ccrc points at);
            --prune removes the ones nothing needs, under update's lock, and
            lists what is left. Never pruned: the one ~/ccrc points at, the
            previous (~/.ccrc/previous), every tag the control plane's
            projection names (desired, desired-stable, desired-dev) and every
            version a running ccrc.service or ccrc-agent.service runs from;
            beyond those it keeps the newest CCRC_VERSIONS_KEEP (default 3)
            complete ones. An input it cannot measure prunes nothing (exit
            1). The same prune runs after every install or update whose
            health gate passed, and that one never removes an incomplete tree
```

(e) `_inst_doctor_tail` (Task 3). Run `grep -nF '_inst_migrate_finish install "ccrc doctor passed; a plain install is its own gate"' ccd/ccrc`; it prints one line, at an 8-space indent (inside `0)` → `if [ "$drc" -eq 0 ]; then`). On the line after it, at the same indent and above the `elif`, add:

```bash
        _ver_gc install auto || :   # W6 Task 5: behind the same gate as the migration's removal (D-3451); its WARN never changes the install's exit
```

Then `grep -c '_ver_gc install auto || :' ccd/ccrc` prints `1`.

(f) `cmd_update`. Run `grep -nF '_inst_migrate_finish update "the health gate passed"' ccd/ccrc`; it prints one line (Step 1), the `else` arm of Task 3's `if [ "$no_gate" -eq 1 ]`, at a 4-space indent. On the line after it, at the same indent, add:

```bash
    _ver_gc update auto || :   # W6 Task 5: under this run's lock, after the gate passed; a skipped prune never fails the update
```

Then `grep -c '_ver_gc update auto || :' ccd/ccrc` prints `1`.

(g) **(Added, review round)** `_inst_tree`'s flip (Task 2's block `(5) THE FLIP`, as Task 3 left it: `  if [ "$name" != "$VER_CURRENT" ]; then`). Run `grep -n '^    _plat_ln_swap "\$dest" "\$BOX_TREE_DIR" \\$' ccd/ccrc`. It prints one line. Task 2's mutation M12 anchors that line, and it stays byte-identical. Immediately ABOVE it, below the `was=` line, insert:

```bash
    # W6 Task 5 — THE TARGET IS MEASURED AGAIN AT THE FLIP (D-3456).
    # A plain install takes no lock, and the GC is a remover that can run
    # beside it: `ccrc versions --prune` removes an incomplete directory (the
    # one this run is placing: its record was voided before the rsync), and
    # another run's automatic GC removes a complete one nothing protects yet
    # (a version this run is about to flip onto is neither pointed-at nor
    # previous until it lands). `_plat_ln_swap` never checks its target, and
    # a flip onto a directory that is gone leaves ~/ccrc dangling, which every
    # later install refuses as `foreign`. `_inst_migrate` measures the layout
    # again for the same reason.
    { [ -d "$dest" ] && [ ! -L "$dest" ] && [ -f "$dest/ccd/ccrc" ]; } \
      || _ccrc_die "the new tree at \$HOME/ccrc-versions/$name is gone before the flip — a prune may have run beside this install; \$HOME/ccrc was not touched, and the install can be run again"
```

Then `awk '/^_inst_tree\(\) \{/{f=1} f&&/^\}/{exit} f' ccd/ccrc | grep -c 'is gone before the flip'` prints `1`.

Then `bash -n ccd/ccrc` — expected: no output, exit 0. And `grep -c '\[\[ -v' ccd/ccrc` prints the count Step 1 recorded (`2`), and `grep -c '^declare -g' ccd/ccrc` prints `0`. Both are reviewed-in guards against a file macOS's `/bin/bash` 3.2 cannot read: `[[ -v` is a parse error there, and a file-scope `declare -g` an error on every run. When a macOS box is at hand, `/bin/bash -n ccd/ccrc` there is the direct measurement. No suite runs it: CI's macOS leg puts Homebrew bash first on PATH.

- [ ] **Step 4: Run them to verify they pass**

Run (from `server/`, foreground, timeout ≥ 600000 ms, one file at a time):
- `./node_modules/.bin/vitest run test/ccrc-update.test.ts`
- `./node_modules/.bin/vitest run test/ccrc-install.test.ts`
- `./node_modules/.bin/vitest run test/ccrc-cli.test.ts`

Expected: PASS, each file whole.
- No earlier case changes, because no earlier case leaves more than three complete versions (the default `CCRC_VERSIONS_KEEP`) beside the pointed-at one: `ccrc-install.test.ts` runs at most three installs in one home, and Tasks 2–4's fixtures plant two or three versions. The automatic GC therefore returns at its nothing-prunable step before it reads anything. It prints no line and makes no `systemctl` call, so recorded `systemctl-calls` sequences, the "doctor's summary is the LAST line" pin (`ccrc-install.test.ts:3224-3227`) and every whole-transcript assertion stay as they are.
- The flip's re-check (Step 3(g)) changes no earlier case: every placement Tasks 2–4 test leaves its `$dest` a real directory carrying `ccd/ccrc` at the flip, so the check passes silently. Task 3's `--check` crashed case already expects `_ver_crashed_remedy`'s sentence, as Task 3 now spells it.
- On macOS, the five `itLinux` cases (four in the update file, one in the install file) report as skipped. The three cases added in review (the unreadable mtime, the crashed listing, the flip re-check) run on both platforms.

Run: `./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts`
Expected: PASS. Its own `systemctl` stub has no ExecStart arm, and it never needs one: no case runs more than two installs in one home, so no box there has more complete versions beside the pointed-at one than the default keep of 3, and the GC never measures.

Run: `./node_modules/.bin/vitest run test/single-definition.test.ts`, then `test/macos-platform.test.ts`, then `test/typecheck-tests.test.ts`, then `test/topology-clean.test.ts`
Expected: PASS each.
- From the repo root, `grep -c 'BOX_STAMP_FILE' ccd/ccrc` and `grep -c 'BOX_INSTALLED_FILE' ccd/ccrc` print the counts Step 1 recorded. No line this task writes names either variable, so neither census moves.
- `macos-platform.test.ts`'s `gnuOnly` sweep finds nothing new: `readlink -f` is outside its table by the table's own comment, and `stat` goes through `_plat_mtime`.
- The D-2765 title scan also finds nothing: every new title that runs on one platform carries a `PLATFORM-ONLY:` comment within 8 lines above it, and none names a userland followed by `:`, `—` or `-`.

Do NOT chase `session-hook.test.ts`: the lines inserted into `ccd/ccrc` shift its frozen anchors, and Task 9 re-measures that corpus once.

- [ ] **Step 5: Mutation measurement (spec §18 "GC never removes a needed version"; plan-level rows)**

Run this on Linux: the `itLinux` cases carry four of the rows. Every row edits `ccd/ccrc` in place through a literal-anchor script that refuses when its anchor does not match, runs the one case that must go red, and restores from a saved copy. It never uses `git checkout --`, and every restore is checked with `cmp`.

```bash
M="$(mktemp -d "${TMPDIR:-/tmp}/w6t5-mut.XXXXXX")"
cp ccd/ccrc "$M/ccrc.good"
cat > "$M/mut.py" <<'PY'
import sys
ROWS = {
  # spec §18 "GC never removes a needed version" — one row per guard
  'pointed-at': [
    (1, '  [ -n "$VER_CURRENT" ] && _ver_protect_add "$VER_CURRENT" pointed-at\n', '  :\n'),
    (1, '    if [ -z "$cur" ] || [ "${cur%/}" = "$BOX_VERSIONS_ROOT/$n" ]; then\n', '    if false; then\n')],
  'previous': [(1, '    0) _ver_protect_add "$UPD_PREV_TAG" previous ;;\n', '    0) ;;\n')],
  'previous-untagged': [(1, '    2) _ver_protect_add "untagged-${UPD_PREV_SHA:0:12}" previous ;;\n', '    2) ;;\n')],
  'desired': [(1, '      _ver_protect_add "${iv[2]}" desired\n      _ver_protect_add "${iv[3]}" desired-stable\n      _ver_protect_add "${iv[4]}" desired-dev ;;\n', '      : ;;\n')],
  'running': [(1, '  for n in "${VER_RUNNING[@]}"; do _ver_protect_add "$n" running; done\n', '  :\n')],
  # plan-level rows
  'path-parser': [(1, '      argv="${BASH_REMATCH[2]}"\n', '      argv="${BASH_REMATCH[1]}"\n')],
  'readlink-empty': [(1, '''{ VER_WHY="$unit's command names $tok, which readlink -f could not resolve"; return 1; }''', 'continue')],
  'stale-as-none': [(1, '    not-configured) ;;   # no control plane on this box: it names no tag\n', '    not-configured|stale) ;;\n')],
  'unanswered-as-stopped': [(1, "      inactive|failed) continue ;;   # a stopped unit runs nothing\n", "      inactive|failed|'') continue ;;\n")],
  'darwin-quotes': [(1, '''      tok="${tok#\\'}"; tok="${tok#\\"}"; tok="${tok%;}"; tok="${tok%\\'}"; tok="${tok%\\"}"\n''', '      :\n')],
  'incomplete-auto': [(1, '      if [ "$mode" = prune ]; then VER_DOOMED+=("$n"); VER_DOOMED_WHY+=("incomplete"); fi\n', '      VER_DOOMED+=("$n"); VER_DOOMED_WHY+=("incomplete")\n')],
  'mtime-unreadable': [(1, '        t=0; rc=1; VER_WHY="the kept install record of $n has no readable mtime"\n', '        t=0\n')],
  'flip-recheck': [(1, '    { [ -d "$dest" ] && [ ! -L "$dest" ] && [ -f "$dest/ccd/ccrc" ]; } \\\n', '    true \\\n')],
  'nullglob': [(1, "  [ \"$had_nullglob\" -eq 1 ] || shopt -u nullglob   # the caller's nullglob, restored (_bak_prune's idiom)\n", '  :\n')],
  'short-circuit': [(1, '  if [ "$ncomp" -le "$keep" ] && { [ "$mode" = auto ] || [ "$npart" -eq 0 ]; }; then\n', '  if false; then\n')],
  'prune-lock': [(1, '    _upd_lock\n    _inst_migrate_resume versions\n', '    _inst_migrate_resume versions\n')],
  'update-call': [(0, '_ver_gc update auto || :', ':')],
  'install-call': [(1, '_ver_gc install auto || :', ':')],
}
p = 'ccd/ccrc'; s = open(p).read()
for want, old, new in ROWS[sys.argv[1]]:
    n = s.count(old)
    if (want == 0 and n < 1) or (want and n != want):
        sys.exit(f'{sys.argv[1]}: anchor found {n} times, not {want or "one or more"}: {old!r}')
    s = s.replace(old, new)
open(p, 'w').write(s)
PY
row() {   # <row> <test file> <-t pattern>
  python3 "$M/mut.py" "$1" || { echo "$1: ANCHOR — fix the row, never the code"; return 1; }
  cmp -s "$M/ccrc.good" ccd/ccrc && { echo "$1: the edit changed nothing"; return 1; }
  ( cd server && ./node_modules/.bin/vitest run "test/$2" -t "$3" ) > "$M/$1.log" 2>&1; local rc=$?
  cp "$M/ccrc.good" ccd/ccrc && cmp -s "$M/ccrc.good" ccd/ccrc || { echo "$1: RESTORE FAILED — stop"; return 2; }
  if [ "$rc" -ne 0 ]; then echo "$1: RED (required)"; else echo "$1: GREEN — the guard is unpinned (see $M/$1.log)"; fi
}
row pointed-at            ccrc-update.test.ts  'guard — the pointed-at version'
row previous              ccrc-update.test.ts  'guard — the previous version'
row previous-untagged     ccrc-update.test.ts  'guard — the previous version'
row desired               ccrc-update.test.ts  'guard — every tag the control plane projection names'
row running               ccrc-update.test.ts  'guard — a version a running unit argv'
row path-parser           ccrc-update.test.ts  'guard — a version a running unit argv'
row readlink-empty        ccrc-update.test.ts  'an input that cannot be measured prunes nothing'
row stale-as-none         ccrc-update.test.ts  'an input that cannot be measured prunes nothing'
row unanswered-as-stopped ccrc-update.test.ts  'an input that cannot be measured prunes nothing'
row mtime-unreadable      ccrc-update.test.ts  'a kept install record whose mtime cannot be read'
row darwin-quotes         ccrc-update.test.ts  'the Darwin arm reads the job ProgramArguments'
row incomplete-auto       ccrc-update.test.ts  'the automatic GC never removes an incomplete version'
row nullglob              ccrc-update.test.ts  'restores the caller nullglob'
row short-circuit         ccrc-update.test.ts  'is silent, and measures nothing'
row prune-lock            ccrc-update.test.ts  'a real holder refuses it at exit 1'
row update-call           ccrc-update.test.ts  'an update whose health gate passed prunes behind it'
row install-call          ccrc-install.test.ts 'the GC keeps the newest CCRC_VERSIONS_KEEP'
row flip-recheck          ccrc-install.test.ts 'removed before the flip'
cmp "$M/ccrc.good" ccd/ccrc && echo "tree restored"
```

Expected: eighteen `RED (required)` lines, then `tree restored`. The reason each row reds (read its log):
- `pointed-at`: `v1.0.1`, the pointed-at version, is pruned, and its listing line is gone.
- `previous`: `v1.0.0` is pruned.
- `previous-untagged`: `untagged-0123456789ab` is pruned (the tagged half above stays green, so this row measures the rc-2 arm alone).
- `mtime-unreadable`: exit 0, and `v1.0.0` is pruned on an order nothing measured (both records sort as 0).
- `flip-recheck`: the refusal is absent, and `~/ccrc` points at the removed `v9.9.1`.
- `desired`: `v1.0.3`, `v1.0.2` and `v1.0.1` are pruned.
- `running` and `path-parser`: `v1.0.1` is pruned. With `path=` read, the only token is `/usr/bin/env`, and nothing is protected.
- `readlink-empty`, `stale-as-none` and `unanswered-as-stopped`: the `readlink`, `projection` and `unit-state` fixtures, respectively, exit 0 and prune `v1.0.0`.
- `darwin-quotes`: `running=[]` where `[v1.0.1]` was expected.
- `incomplete-auto`: `untagged-0123456789ab` is removed by the automatic GC.
- `nullglob`: the first probe answers `on`.
- `short-circuit`: the quiet run prints the WARN.
- `prune-lock`: exit 0, and `v1.0.0` is removed under a held lock.
- `update-call` and `install-call`: there are no `pruned` lines and six directories remain.

Any `GREEN` line is a finding: fix the test, not the row. After the fix, re-run that row and the control run below.

The control: re-run Step 4's three `vitest run` commands on the restored tree. Each must pass. This shows that the red rows came from the edits, and not from the tree.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc server/test/ccrc-update.test.ts server/test/ccrc-install.test.ts server/test/ccrc-cli.test.ts
git commit -m "feat(ccrc): ccrc versions and the GC that never removes a needed version (W6 Task 5)"
```

**Departures this task adds to the plan's Deviations list** (placeholder form; the coordinator issues the numbers):
- **D-3449** — (found planning Task 5) spec §11's running guard reads each running unit's `ExecStart` "through `readlink -f`". GC calls `readlink -f` on the token's version PREFIX — `$HOME/ccrc`, or `$HOME/ccrc-versions/<seg>` — never on the whole token. Measured 2026-09-23 with GNU coreutils 9.4, `readlink -f` of a path whose parent directory is missing answers empty with rc 1. A server-role version has no `agent/dist/`, and a hand-edited unit can name a file that has since gone. In either case a whole-token read would be unmeasured on every run and would stop every prune on that box. The prefix alone decides which version a command runs from. Cost if wrong: a token such as `$HOME/ccrc/../ccrc-versions/<x>/…` resolves by its first segment. No unit this tree writes spells one.
- **D-3450** — (found planning Task 5) the automatic GC and `ccrc versions --prune` read nothing at all — not previous, not the projection, not the service manager — while there are no more complete versions beside the pointed-at one than `CCRC_VERSIONS_KEEP` (and, for `--prune`, no incomplete one). A protection can only take a version out of the removal set, so it can never make one prunable, and in that state nothing is prunable whatever the inputs say. Without this, a first install on a `both` box would print a GC WARN about a box with one version, because W2's server has not yet written the projection there. Every install and update in the suites would also gain `systemctl show` calls. Cost if wrong: none. An unmeasurable input is still reported the moment there is something it could protect.
- **D-3451** — (found planning Task 5) the automatic GC runs only where a gate is known to have passed. For a plain `ccrc install`, that is `cmd_doctor` rc 0 under a lock it took itself, the same condition under which the migration's `~/ccrc.migrating` is removed (D-3431). For `cmd_update`, it is `_upd_gate` passing. It never runs after a failed gate, and never inside arm 1, arm 2's child or a rollback by flip. Their spines run under the parent's lock, so `_ver_lock_try` answers rc 1 there. Spec §11 does not say when GC runs, and the decisions file says "after every completed install". A completed install whose doctor FAILed, or a restore in flight, is exactly the box that may need any kept version. Cost if wrong: after a failed install the extra versions stay until the next passing install or update, or `ccrc versions --prune`.
- **D-3456** — (found reviewing Task 5) `_inst_tree`'s flip measures its target again, just before `_plat_ln_swap`: a real directory, not a link, that carries `ccd/ccrc`. If not, the install dies `the new tree at $HOME/ccrc-versions/<name> is gone before the flip — …` and `~/ccrc` is untouched. Spec §11 specifies the flip as the rename alone. Task 5 adds a remover that can run BESIDE a plain install, which takes no update lock. `ccrc versions --prune` removes the incomplete directory the install is placing (D-3448). Another run's automatic GC can remove a complete version this install is about to flip onto, which is neither pointed-at nor previous until the flip lands. `_plat_ln_swap` never checks its target, and a flip onto a directory that is gone leaves `~/ccrc` dangling. Every later install then refuses it as `foreign`, and `_inst_enable` restarts the units onto nothing. `_inst_migrate` already measures the layout again for the same reason. Not done: holding `~/.ccrc/update.lock` across a plain install's placement and flip. That would close the window instead of narrowing it, but it changes wave 4's lock contract (a `ccrc update` would refuse `another update holds …` for the length of every plain install), so it is the coordinator's to rule. Cost if wrong: a removal inside the instant between the check and the rename still leaves a dangling `~/ccrc`. It is then repaired by hand with `ln -sfn $HOME/ccrc-versions/<a kept version> $HOME/ccrc`, followed by an install.
- **Amendment to D-3447** — (found planning Task 5) the unmeasured inputs also include two cases the skeleton did not list. One is a unit state the service manager did not answer, or answered with an unrecognised word; `_svc_is_active`'s empty answer is "a question that was never asked", by that function's own contract. The other is a kept install record whose mtime cannot be read, because the keep-N order then depends on it. The skeleton's "any other word contributes nothing" would have read an unanswered manager as "not running".

### Task 6: Uninstall

**Files:**
- Modify: `ccd/ccrc` — **[added in review]** `cmd_uninstall` (re-locate by `grep -n '^cmd_uninstall() {' ccd/ccrc`): the update-lock gate, directly after the live-session gate's closing `fi` and above `  _uninst_units` (D-3453); **[added in review]** `usage()`'s `uninstall` entry (`grep -n 'worktrees and ~/ccrc-backups. Refuses while live sessions' ccd/ccrc`; `:1565-1566` at `d759c914`, moved by wave 4's `usage()` insertions): its refusal sentence names the lock.
- Modify: `ccd/ccrc` — `_uninst_tree_bins` (re-locate by `grep -n '^_uninst_tree_bins() {' ccd/ccrc`; `:12698` at `d759c914`, grown by wave 4's Tasks 4, 8 and 10):
  - its first statement keeps `rm -rf -- "$BOX_TREE_DIR"` and gains a comment that on a link this removes the link only;
  - new sweep lines after it, **[added in review]** the staged `~/ccrc.new` link included;
  - `"$BOX_MIGRATION_FILE"` joins wave 4's `rm -f -- "$BOX_PREVIOUS_FILE" "$BOX_INSTALL_STEP_FILE" "$BOX_UPDATE_JSON" "$BOX_UPDATE_LOCK" "$BOX_INTENT_FILE"` statement;
  - the `uninstall: tree:` transcript line gains its suffix, appended at the END so wave 4's mid-line insertions do not collide.
- Test: `server/test/ccrc-uninstall.test.ts`:
  - `plantInstalledBox` (`:108`) gains an options argument `{ versioned?: string[] }`, which plants each name through Task 2's `installVersionedTree` (the first one linked) instead of the real `~/ccrc` directory;
  - the fs import (`:28-31`) gains `unlinkSync`, and `import { installVersionedTree } from './installTreeFixture.js';` joins the imports below `./ccdWsHelpers.js`;
  - **[added in review]** the `vitest` import (`:25`) gains `afterEach`, and the `node:child_process` import (`:26`) becomes `import { spawn, spawnSync, type ChildProcess } from 'node:child_process';` — the lock cases' real holder, wave 4's `holdLock` shape. Both edits are line-neutral;
  - **[corrected]** the preserve case (`it('the tree and the executables go; ~/.ccrc, worktrees and backups are PRESERVED without --purge'`, `:527` at `d759c914`) keeps its loops unchanged, but its ONE transcript assertion is amended. Wave 4 wrote it as `/; the completed-install record and the node's update state \(~\/\.ccrc\/previous, install-step, update\.json, update\.lock, update-intent\) removed$/m`, and its `$` fails as soon as a suffix is appended at the end of the line. It becomes `… update-intent\) removed; no ~\/ccrc-versions$/m` (the default box is a real directory);
  - new describe `ccrc uninstall: the versions root and a stray migration (W6 Task 6)`, immediately above `describe('ccrc backup: update\'s step 2 standalone, with CCRC_BACKUP_KEEP pruning'` (`:771` at `d759c914`).
- Run, not edited: `server/test/single-definition.test.ts` (the install-record census's `'rm -f -- "$BOX_INSTALLED_FILE" \\',` line is untouched), `server/test/macos-platform.test.ts` (no GNU-only spelling added; five new cases are plain `it`, and the two lock cases are `itLinux` — as wave 4's own lock cases are, because they need a real `flock` holder — whose titles name no userland, so the D-2765 title scan's `ASSERTS_PLATFORM` matches neither), `server/test/typecheck-tests.test.ts` (the test file gains an import and an optional parameter; it spawns the agent and PWA compilers too, so it needs those packages' modules).
- Not chased here: `server/test/session-hook.test.ts` (Task 9)

**Interfaces:**
- **[added in review]** `cmd_uninstall`'s update-lock gate (D-3453). It runs after the live-session gate and before `_uninst_units`, so a refusal leaves the box exactly as it was. A die inside `_uninst_tree_bins` would come after the units, hooks and wrappers are already gone, which is the half-removed box the verb's `node`/`jq` probe exists to prevent. Without `--force`, it calls wave 4's `_upd_lock_probe` once, a PROBE and never an acquire (this run removes the lock file itself), and captures its rc:
  - 0 (free, or no lock file): proceed.
  - 2 (`flock` not on PATH): proceed. No updater that takes this lock runs without `flock` (wave 4's `_upd_lock` dies first, and so does Task 3's `_ver_lock_try`), so on such a box nothing can be holding it.
  - 1 (held): die `an update holds ~/.ccrc/update.lock (<_upd_lock_holder>) — uninstalling under it would remove the version it is placing or flipping to. Wait for it to finish, or run: ccrc uninstall --force — nothing on this box was removed`.
  - 3, or any rc the probe does not define (UNMEASURED): die `~/.ccrc/update.lock could not be measured (probe rc <rc>) — refusing to uninstall past a lock this box cannot see. Run ccrc uninstall --force to proceed anyway — nothing on this box was removed`. Never folded into "held", which would print a holder sentence about a holder nobody measured, nor into "free". This is the rule ruling R16 sets for wave 4's callers, applied here by this plan. R16 itself names only wave 4's Tasks 2, 3 and 9.
  With `--force` the probe is skipped: the flag already means "uninstall under whatever is running", as it does at the live-session gate.
  Why the gate exists: the sweep below removes `~/ccrc-versions` and `~/ccrc.migrating`, and this plan's other writers touch those only under this lock (Task 5's `--prune` takes `_upd_lock`; Task 3's migration finish takes `_ver_lock_try`). An update or rollback in flight could be placing into, or flipping to, a version directory the sweep is removing. A `--detach` one runs in a `systemd-run` transient unit, which `_uninst_units`' fixed unit list never stops. Its `mv -fT` needs only `~/ccrc.new`, so it would then re-create `~/ccrc` pointing at a directory that is gone. The gate does not close D-3251's window between a detaching parent's probe and its child's acquire: a child that has not yet taken the lock is not seen.
- `_uninst_tree_bins`, in order:
  1. `rm -rf -- "$BOX_TREE_DIR"` (unchanged; without a trailing slash `rm` never follows a symlink, so on a W6 box it removes the link only; die unchanged). Measured 2026-09-23 (GNU coreutils 9.4): `rm -rf -- "<link>/"` does something else. It empties the pointed-at directory THROUGH the link, answers 0, and leaves the link standing. That is the mutation this task's linked case must see.
  2. When `$BOX_VERSIONS_ROOT` is a real directory (`-d` and not `-L`): count its `VER_NAME_RE` entries (`_ver_list || :`, then `${#VER_NAMES[@]}` — the rc is captured and discarded on purpose: Task 5's rc 1 means only that the ORDER is unknown, and `VER_NAMES` is still filled, so the count stands), then `rm -rf -- "$BOX_VERSIONS_ROOT"` (die `removing $BOX_VERSIONS_ROOT failed`). Dot-names, such as Task 4's `.<tag>.incoming.<pid>`, go with the root and are never counted. **[added]** If something that is not a real directory stands at that name (a file, or a link), it is left in place and the transcript says so. It is not a root ccrc made.
  3. When `$BOX_MIGRATING_DIR` exists (`-e` or `-L`): `rm -rf -- "$BOX_MIGRATING_DIR"` (die `removing $BOX_MIGRATING_DIR failed`) (D-3452).
  4. **[added in review]** When `$BOX_TREE_DIR.new` is a symlink (`-L`): `rm -f -- "$BOX_TREE_DIR.new"` (die `removing $BOX_TREE_DIR.new failed`) (D-3452). This is Task 1's staged name: `_plat_ln_swap` writes `<link>.new` with `ln -sfn` and renames it over `<link>`. A process killed between those two calls leaves it standing, as a link into the versions root step 2 just removed. By Task 1's own contract only the NEXT flip's `ln -sfn` replaces it, and an uninstalled box flips nothing. It must be a link, the only shape that helper makes. Anything else at that name (a file, a directory) is left in place and named, as for the versions root; Task 1's second arm already refuses to flip over one.
  5. The node-file statements as wave 4 left them, plus `"$BOX_MIGRATION_FILE"`.
  Removing the tree the running `ccrc` executes from is safe, for the reason the function's own header already gives: the inode outlives the directory entry. No step after this one reads `$CCRC_HERE` or `$BOX_TREE_DIR` (measured: `_uninst_tree_bins`' graphify block, `_uninst_keep_asides` and `_uninst_purge` name neither). Step 4 names `$BOX_TREE_DIR.new`, a sibling path built from the string, and never resolves through the link.
- The transcript line (`echo "uninstall: tree: ~/ccrc removed; …"`) ends, after wave 4's last clause `update-intent) removed`, with one of three suffixes:
  - `; ~/ccrc-versions removed (<n> kept tree(s))`;
  - `; no ~/ccrc-versions` when there was none;
  - **[added]** `; ~/ccrc-versions left in place — it is not a directory ccrc made`.
  Then `; ~/ccrc.migrating removed` follows, only when there was one. **[added in review]** Last comes `; ~/ccrc.new removed` when step 4 removed a staged link, or `; ~/ccrc.new left in place — it is not a link ccrc made` when something else stands there, and nothing when the name is free. The three suffixes are built in locals `vsaid`/`msaid`/`nsaid`, each before its own removal, and the echo appends `$vsaid$msaid$nsaid`.
- Unchanged: the live-session gate, `--purge`, `--purge-memory`, the three closing `uninstall: done — …` sentences (`~/ccrc-backups` stays preserved without `--purge`). **[changed in review]** `--force` keeps its meaning at the live-session gate, and now also skips the update-lock gate. `usage()` says so.
- Consumes: `BOX_VERSIONS_ROOT`, `BOX_MIGRATING_DIR`, `VER_NAME_RE` (Task 2), `BOX_MIGRATION_FILE` (Task 3), `_ver_list`/`VER_NAMES` (Task 5), `installVersionedTree` (Task 2); **[added in review]** the staged name `<link>.new` (Task 1's `_plat_ln_swap`), and `_upd_lock_probe` and `_upd_lock_holder` (wave 4 Task 2, spelled as its plan spells them).
- Tests. Each asserts presence with `lstat`, never `existsSync`: a DANGLING `~/ccrc` answers `existsSync` false, and a surviving link is the defect step 1's mutation produces.
  - A W6 box with three versions, a link, a `.incoming` staging directory and **[added in review]** a staged `~/ccrc.new` link left by a killed flip → all removed; `~/ccrc-versions`, `~/ccrc` and `~/ccrc.new` absent; `~/ccrc-backups` and `~/.ccrc/memory` preserved; the line ends `(3 kept tree(s)); ~/ccrc.new removed`.
  - A `migrated` box → `.migrating` and `migrating-to` removed.
  - A pre-W6 real-directory box → today's removal, `; no ~/ccrc-versions`, and no `.migrating` or `.new` clause.
  - A crash-pair box (no `~/ccrc`) → the sweep still runs, and nothing dies.
  - A `~/ccrc-versions` regular file and **[added in review]** a real directory at `~/ccrc.new` → both unchanged, and both sentences printed.
  - **[added in review]** `itLinux`: an update holding `~/.ccrc/update.lock` (a real holder process) → exit 1, the holder sentence naming `pid 4242, target v1.0.0` from the planted `update.json`, and nothing removed: the link, the version, the unit file stay, and no `systemctl` call is made. THE CONTROL is the same box, the holder still holding, with `--force` → exit 0, the versions root gone.
  - **[added in review]** `itLinux`: a lock that cannot be MEASURED (a directory where the lock file goes, so the probe's open fails at every uid, wave 4's own rc-3 fixture) → exit 1, the unmeasured sentence with `probe rc 3` and never the holder sentence, and nothing removed.
- Mutation rows:
  - Spec §11 audit, "gains a sweep of `~/ccrc-versions/`": delete step 2 → the three-version case leaves the root; red.
  - D-3452: delete step 3 → the migrated case leaves `.migrating`; red.
  - The link-only removal: replace step 1's argument with `"$BOX_TREE_DIR/"` → on a linked box it empties the pointed-at version instead of removing the link, and `~/ccrc` survives as a dangling link; red, through `lstat`.
  - Plan-level, the marker: drop `"$BOX_MIGRATION_FILE"` from the node-file statement → the migrated case's `migrating-to` survives; red.
  - **[added in review]** D-3452, the staged link: delete step 4's removal → the versioned case's `~/ccrc.new` survives, dangling; red, through `lstat`.
  - **[added in review]** The staged link's shape guard: `-L` → `-e` → the not-a-directory case's real directory at `~/ccrc.new` meets `rm -f`, which fails on a directory, and the uninstall dies; red.
  - **[added in review]** D-3453: delete the probe call → the held case exits 0; red. Fold rc 3 into "free" → the unmeasured case runs on and dies later with another sentence; red. Fold rc 3 into "held" → the unmeasured case prints the holder sentence; red. Make the gate ignore `--force` → the held case's control exits 1; red.
  - Not pinned on Linux: the rc-2 arm (no `flock`, proceed). Modelling one absent tool across a whole uninstall needs a PATH allowlist that this suite does not have (`ccrc-install.test.ts`'s `pathWithout` lists that verb's tools, not this one's). On a runner with no `flock`, such as the macOS leg unless it carries brew's, every uninstall case in the file goes through that arm and would red if it refused. That is the only place it is measured.

- [ ] **Step 1: Write the failing tests — `server/test/ccrc-uninstall.test.ts`**

Before editing, run `cd server && ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts` once and record its `passed | skipped` line; Step 4 compares against it.

Change `import { describe, it, expect } from 'vitest';` (`:25`) to `import { describe, it, expect, afterEach } from 'vitest';`, and `import { spawnSync } from 'node:child_process';` (`:26`) to `import { spawn, spawnSync, type ChildProcess } from 'node:child_process';`. Wave 4 did not touch either line in this file; if either already reads so, leave it and do not add a second import. In the fs import (`import {` … `} from 'node:fs';`, `:28-31`), change the line `  symlinkSync, rmSync, lstatSync,` to `  symlinkSync, rmSync, lstatSync, unlinkSync,`. Directly below `import { ghContainedEnv } from './ccdWsHelpers.js';` (`:35`) add:

```ts
// W6 Task 2's one planter of a versioned box: `~/ccrc-versions/<name>/` built
// from the same fixture tree the install suites place, with its kept stamp and
// install record, and — for the first name — the `~/ccrc` link.
import { installVersionedTree } from './installTreeFixture.js';
```

Change `plantInstalledBox`'s signature and its first block. Replace:

```ts
function plantInstalledBox(home: string): void {
  // The shipped tree and the three executables.
  mkdirSync(join(home, 'ccrc', 'server', 'dist'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'server', 'dist', 'index.js'), '// the installed dist\n');
  mkdirSync(join(home, 'ccrc', 'ccd'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'ccd', 'ccrc'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  mkdirSync(join(home, 'ccrc', 'agent', 'dist'), { recursive: true });
  writeFileSync(join(home, 'ccrc', 'agent', 'dist', 'index.js'), '// agent dist\n');
  const bin = join(home, '.local', 'bin');
```

with:

```ts
function plantInstalledBox(home: string, opts: { versioned?: string[] } = {}): void {
  // The shipped tree. By default a REAL `~/ccrc` directory: a box installed
  // before W6, or by deploy.sh onto one. With `versioned`, W6's layout (spec
  // §11): each name a placed version under `~/ccrc-versions/`, the FIRST the
  // one `~/ccrc` links to — the shape `_uninst_tree_bins`' sweep exists for.
  const versioned = opts.versioned ?? [];
  if (versioned.length === 0) {
    mkdirSync(join(home, 'ccrc', 'server', 'dist'), { recursive: true });
    writeFileSync(join(home, 'ccrc', 'server', 'dist', 'index.js'), '// the installed dist\n');
    mkdirSync(join(home, 'ccrc', 'ccd'), { recursive: true });
    writeFileSync(join(home, 'ccrc', 'ccd', 'ccrc'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    mkdirSync(join(home, 'ccrc', 'agent', 'dist'), { recursive: true });
    writeFileSync(join(home, 'ccrc', 'agent', 'dist', 'index.js'), '// agent dist\n');
  } else {
    versioned.forEach((name, i) => { installVersionedTree(home, name, { link: i === 0 }); });
  }
  // The executables.
  const bin = join(home, '.local', 'bin');
```

In `it('the tree and the executables go; ~/.ccrc, worktrees and backups are PRESERVED without --purge'`, replace wave 4's assertion

```ts
    expect(r.stdout).toMatch(/; the completed-install record and the node's update state \(~\/\.ccrc\/previous, install-step, update\.json, update\.lock, update-intent\) removed$/m);
```

with

```ts
    // W6 Task 6: the line now ENDS with what the versions sweep found — on
    // this box, a real `~/ccrc` directory, nothing.
    expect(r.stdout).toMatch(/; the completed-install record and the node's update state \(~\/\.ccrc\/previous, install-step, update\.json, update\.lock, update-intent\) removed; no ~\/ccrc-versions$/m);
```

(If `grep -n "update-intent\\\\) removed\\$/m" server/test/ccrc-uninstall.test.ts` finds no line, wave 4 spelled the assertion differently. Re-locate it by `grep -n "the node's update state" server/test/ccrc-uninstall.test.ts`, and change only its ending in the same way.)

Immediately above `describe('ccrc backup: update\'s step 2 standalone, with CCRC_BACKUP_KEEP pruning', () => {`, add:

```ts
// ── W6 Task 6: the versions root and a stray migration ────────────────────
// Spec §11's audit gives `cmd_uninstall`'s `rm -rf -- "$BOX_TREE_DIR"` the
// verdict "removes only the link — gains a sweep of `~/ccrc-versions/`". The
// sweep takes the kept versions and, D-3452, the
// pre-versioned tree a one-time migration keeps until a gate that will now
// never run, with its `~/.ccrc/migrating-to` marker.
describe('ccrc uninstall: the versions root and a stray migration (W6 Task 6)', () => {
  // `lstat`, never `existsSync`: a DANGLING `~/ccrc` answers existsSync false,
  // and a link that survives with nothing behind it is exactly what the
  // trailing-slash spelling of step 1 leaves (GNU rm empties the version
  // THROUGH the link, answers 0, keeps the link — measured).
  const present = (p: string): boolean => {
    try { lstatSync(p); return true; } catch { return false; }
  };
  const plantMemory = (home: string): string => {
    const d = join(home, '.ccrc', 'memory', 'fixture-project');
    mkdirSync(d, { recursive: true });
    const f = join(d, 'MEMORY.md');
    writeFileSync(f, '# a project\'s durable memory\n');
    return f;
  };
  const plantMigration = (home: string, name: string): void => {
    mkdirSync(join(home, 'ccrc.migrating', 'server'), { recursive: true });
    writeFileSync(join(home, 'ccrc.migrating', 'server', 'OLD-MARKER'), 'the pre-versioned tree\n');
    writeFileSync(join(home, '.ccrc', 'migrating-to'), `${name}\n`);
  };

  it('a versioned box: the link, every kept version and the root go; backups and memory stay (spec §11 audit: "gains a sweep of ~/ccrc-versions/")', () => {
    const home = mkTmp('ccrc-uninst-versions-');
    plantInstalledBox(home, { versioned: ['v9.9.2', 'v9.9.1', 'v9.9.0'] });
    // A legacy target's staging directory (Task 4's `.<tag>.incoming.<pid>`):
    // removed WITH the root, never counted as a kept tree.
    mkdirSync(join(home, 'ccrc-versions', '.v9.9.3.incoming.4242', 'ccd'), { recursive: true });
    // A flip to v9.9.1 killed between `_plat_ln_swap`'s `ln -sfn` and its
    // rename (Task 1): the staged link stands beside `~/ccrc`, and only the
    // NEXT flip would ever replace it — an uninstalled box flips nothing.
    symlinkSync(join(home, 'ccrc-versions', 'v9.9.1'), join(home, 'ccrc.new'));
    const memory = plantMemory(home);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink(), 'the fixture is not a W6 box').toBe(true);
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(present(join(home, 'ccrc')), 'the ~/ccrc link survived').toBe(false);
    expect(present(join(home, 'ccrc-versions')), 'the versions root survived').toBe(false);
    // `lstat`: with the root gone the staged link DANGLES, and existsSync
    // would call a surviving one absent.
    expect(present(join(home, 'ccrc.new')), 'a staged ~/ccrc.new link survived').toBe(false);
    expect(readFileSync(memory, 'utf8'), '~/.ccrc/memory was touched').toBe('# a project\'s durable memory\n');
    expect(existsSync(join(home, 'ccrc-backups', '20250101-000000', 'ccd')), 'a backup was removed').toBe(true);
    expect(r.stdout).toMatch(/^uninstall: tree: ~\/ccrc removed; .*update-intent\) removed; ~\/ccrc-versions removed \(3 kept tree\(s\)\); ~\/ccrc\.new removed$/m);
    expect(r.stdout).not.toMatch(/ccrc\.migrating removed/);
  });

  it('a migrated box: ~/ccrc.migrating and ~/.ccrc/migrating-to go too — no gate will ever run to remove them', () => {
    const home = mkTmp('ccrc-uninst-migrated-');
    plantInstalledBox(home, { versioned: ['v9.9.1'] });
    plantMigration(home, 'v9.9.1');
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(present(join(home, 'ccrc.migrating')), '~/ccrc.migrating survived').toBe(false);
    expect(present(join(home, '.ccrc', 'migrating-to')), 'migrating-to survived').toBe(false);
    expect(present(join(home, 'ccrc')), 'the ~/ccrc link survived').toBe(false);
    expect(present(join(home, 'ccrc-versions')), 'the versions root survived').toBe(false);
    expect(r.stdout).toMatch(/; ~\/ccrc-versions removed \(1 kept tree\(s\)\); ~\/ccrc\.migrating removed$/m);
  });

  it('a box installed before W6 (a real ~/ccrc directory): today\'s removal, and the line says there was no versions root', () => {
    const home = mkTmp('ccrc-uninst-prew6-');
    plantInstalledBox(home);
    expect(lstatSync(join(home, 'ccrc')).isDirectory()).toBe(true);
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(present(join(home, 'ccrc'))).toBe(false);
    expect(r.stdout).toMatch(/update-intent\) removed; no ~\/ccrc-versions$/m);
    expect(r.stdout).not.toMatch(/ccrc\.migrating removed/);
    expect(r.stdout).not.toMatch(/ccrc\.new/);
  });

  it('a crashed migration (~/ccrc.migrating and no ~/ccrc): the sweep still runs and nothing dies', () => {
    const home = mkTmp('ccrc-uninst-crashpair-');
    plantInstalledBox(home, { versioned: ['v9.9.1'] });
    // The two-syscall window's crash shape (Task 3): the old tree moved aside,
    // the marker written, and the link never placed.
    unlinkSync(join(home, 'ccrc'));
    plantMigration(home, 'v9.9.1');
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    for (const p of ['ccrc', 'ccrc-versions', 'ccrc.migrating', join('.ccrc', 'migrating-to')]) {
      expect(present(join(home, p)), `${p} survived`).toBe(false);
    }
    expect(r.stdout).toMatch(/; ~\/ccrc-versions removed \(1 kept tree\(s\)\); ~\/ccrc\.migrating removed$/m);
  });

  it('a ~/ccrc-versions that is not a directory, and a ~/ccrc.new that is not a link, are left in place, and the line says so — ccrc made neither', () => {
    const home = mkTmp('ccrc-uninst-versions-notdir-');
    plantInstalledBox(home);
    writeFileSync(join(home, 'ccrc-versions'), 'not a versions root\n');
    // `_plat_ln_swap` only ever writes a LINK at `~/ccrc.new` (Task 1), and
    // refuses to flip over anything else; a directory there is someone else's.
    mkdirSync(join(home, 'ccrc.new'));
    writeFileSync(join(home, 'ccrc.new', 'MINE'), 'not ccrc\'s\n');
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'ccrc-versions'), 'utf8')).toBe('not a versions root\n');
    expect(readFileSync(join(home, 'ccrc.new', 'MINE'), 'utf8'), 'a ~/ccrc.new ccrc did not make was touched').toBe('not ccrc\'s\n');
    expect(r.stdout).toMatch(/update-intent\) removed; ~\/ccrc-versions left in place — it is not a directory ccrc made; ~\/ccrc\.new left in place — it is not a link ccrc made$/m);
  });

  // ── D-3453 ──────────────────────────────
  // The sweep above removes what every other writer touches only under
  // ~/.ccrc/update.lock, so an uninstall PROBES it before removing anything.
  // A real holder, wave 4's shape: ONE process takes flock and then becomes
  // `sleep` (exec keeps the pid and the descriptor), killed after each case.
  const holders: ChildProcess[] = [];
  afterEach(() => { for (const h of holders.splice(0)) h.kill('SIGKILL'); });
  const lockPath = (home: string): string => join(home, '.ccrc', 'update.lock');
  const lockFree = (home: string): boolean =>
    spawnSync(BASH, ['-c', 'exec 9>>"$1" && flock -n 9', '_', lockPath(home)]).status === 0;
  const holdLock = (home: string): void => {
    const h = spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', lockPath(home)], { stdio: 'ignore' });
    holders.push(h);
    const t0 = Date.now();
    while (lockFree(home)) {
      if (Date.now() - t0 > 10_000) throw new Error('timed out waiting for the fixture holder to take the lock');
      spawnSync('sleep', ['0.05']);
    }
  };
  // What a refusal must leave: the gate runs after the live-session gate and
  // BEFORE `_uninst_units`, so nothing at all was removed or stopped.
  const untouched = (home: string): void => {
    expect(present(join(home, 'ccrc')), 'the ~/ccrc link was removed').toBe(true);
    expect(present(join(home, 'ccrc-versions', 'v9.9.1')), 'a kept version was removed').toBe(true);
    expect(existsSync(join(home, '.config', 'systemd', 'user', 'ccrc.service')), 'a unit file was removed').toBe(true);
    expect(existsSync(join(home, 'systemctl-calls')), 'a unit was touched').toBe(false);
  };

  itLinux('an update holding ~/.ccrc/update.lock refuses the uninstall before anything is removed, naming the holder; --force proceeds past it', () => {
    const home = mkTmp('ccrc-uninst-lock-held-');
    plantInstalledBox(home, { versioned: ['v9.9.1'] });
    holdLock(home);
    let r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    // The holder's fields come from the `update.json` wave 4 plants in
    // `plantInstalledBox` (pid 4242, target v1.0.0).
    expect(r.stderr).toMatch(/^ccrc: an update holds ~\/\.ccrc\/update\.lock \(pid 4242, target v1\.0\.0\) — uninstalling under it would remove the version it is placing or flipping to\. Wait for it to finish, or run: ccrc uninstall --force — nothing on this box was removed$/m);
    untouched(home);
    // THE CONTROL: the same box, the holder STILL holding, and --force.
    r = runVerb(home, 'uninstall', ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(present(join(home, 'ccrc-versions')), 'the versions root survived --force').toBe(false);
  });

  itLinux('a ~/.ccrc/update.lock that cannot be MEASURED refuses with its own sentence — never the holder\'s, and nothing is removed', () => {
    const home = mkTmp('ccrc-uninst-lock-unmeasured-');
    plantInstalledBox(home, { versioned: ['v9.9.1'] });
    // A DIRECTORY where the lock file goes: it exists, and the probe's
    // `exec {p}>>` on it fails, so `_upd_lock_probe` answers 3 at every uid
    // (wave 4's own rc-3 fixture; a `chmod 000` file root opens anyway).
    rmSync(lockPath(home));
    mkdirSync(lockPath(home));
    const r = runVerb(home, 'uninstall');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: ~\/\.ccrc\/update\.lock could not be measured \(probe rc 3\) — refusing to uninstall past a lock this box cannot see\. Run ccrc uninstall --force to proceed anyway — nothing on this box was removed$/m);
    expect(r.stderr, 'rc 3 was folded into "held"').not.toMatch(/an update holds/);
    untouched(home);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run (from `server/`, foreground, timeout ≥ 600000 ms): `./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts -t 'versions root and a stray migration|PRESERVED without --purge'`
Expected: FAIL — eight cases on Linux (six on macOS, where the two `itLinux` lock cases skip).
- The versioned case: `the versions root survived`. The link itself IS already gone: today's `rm -rf` removes a link, and that half passes.
- The migrated case: `~/ccrc.migrating survived`.
- The pre-W6 case, the not-a-directory case and the preserve case: the transcript regex, because the line still ends `update-intent) removed` with no suffix.
- The crash-pair case: `ccrc-versions survived`.
- **[added in review]** The held-lock case: `expected 0 to be 1`, because today's uninstall never looks at the lock.
- **[added in review]** The unmeasured-lock case exits 1 already, but for another reason. Wave 4's `rm -f -- … "$BOX_UPDATE_LOCK"` meets the directory and dies with `removing the node's update state files failed`, after the units are gone. It reds on the stderr regex. Read that red as a second defect this gate removes: the uninstall got that far before dying.

- [ ] **Step 3: Implement — `ccd/ccrc`'s `_uninst_tree_bins`**

Locate it with `grep -n '^_uninst_tree_bins() {' ccd/ccrc`. Replace its first statement,

```bash
  rm -rf -- "$BOX_TREE_DIR" \
    || _ccrc_die "removing $BOX_TREE_DIR failed"
```

(the first two lines of the body; `:12699-12700` at `d759c914`) with:

```bash
  # On a versioned box (W6) `$BOX_TREE_DIR` is the LINK `~/ccrc ->
  # ~/ccrc-versions/<name>`, and `rm` handed a path with no trailing slash
  # never follows a symlink: this removes the link only, and the sweep below
  # takes the versions. With a trailing slash GNU rm empties the pointed-at
  # version THROUGH the link, answers 0 and leaves the link standing —
  # measured 2026-09-23 (coreutils 9.4); the uninstall suite's linked case
  # pins this spelling.
  rm -rf -- "$BOX_TREE_DIR" \
    || _ccrc_die "removing $BOX_TREE_DIR failed"
  # THE VERSIONS ROOT (spec §11's audit: `cmd_uninstall` "gains a sweep of
  # ~/ccrc-versions/"). Every kept version goes, the one the link named
  # included: an uninstalled box runs none of them, and GC is a verb of the
  # ccrc this step removes, so a tree left here is disk nothing reclaims.
  # Counted first, by `_ver_list`, so the line counts the names VER_NAME_RE
  # admits; a legacy target's `.<tag>.incoming.<pid>` staging directory goes
  # with the root and is never counted as a kept tree. Something at that name
  # that is not a real directory (a file, a link elsewhere) is not a root this
  # ccrc made: it is left where it is, and the line says so.
  local vsaid="; no ~/ccrc-versions" msaid="" nsaid=""
  if [ -d "$BOX_VERSIONS_ROOT" ] && [ ! -L "$BOX_VERSIONS_ROOT" ]; then
    _ver_list || :   # rc 1 = the ORDER is unknown (Task 5); VER_NAMES is still filled, and a count needs no order
    vsaid="; ~/ccrc-versions removed (${#VER_NAMES[@]} kept tree(s))"
    rm -rf -- "$BOX_VERSIONS_ROOT" \
      || _ccrc_die "removing $BOX_VERSIONS_ROOT failed"
  elif [ -e "$BOX_VERSIONS_ROOT" ] || [ -L "$BOX_VERSIONS_ROOT" ]; then
    vsaid="; ~/ccrc-versions left in place — it is not a directory ccrc made"
  fi
  # A STRAY PRE-VERSIONED TREE (D-3452). The
  # one-time migration keeps `~/ccrc.migrating` until a health gate passes,
  # and no gate runs on a box being uninstalled. Left behind, it and its
  # `~/.ccrc/migrating-to` marker (removed with the node files below) would
  # hand a later install a migration pair it could only refuse.
  if [ -e "$BOX_MIGRATING_DIR" ] || [ -L "$BOX_MIGRATING_DIR" ]; then
    rm -rf -- "$BOX_MIGRATING_DIR" \
      || _ccrc_die "removing $BOX_MIGRATING_DIR failed"
    msaid="; ~/ccrc.migrating removed"
  fi
  # A STAGED FLIP LEFT BEHIND (D-3452).
  # `_plat_ln_swap` (W6 Task 1) stages `~/ccrc.new` with `ln -sfn` and renames
  # it over `~/ccrc`; a process killed between the two leaves the staged
  # link, which only the NEXT flip replaces — and an uninstalled box flips
  # nothing, so it would stand in $HOME pointing into the root removed above.
  # A LINK only, the one shape that helper makes (its second arm refuses to
  # flip over anything else): something else at that name is not ccrc's, and
  # it is left where it is, named.
  if [ -L "$BOX_TREE_DIR.new" ]; then
    rm -f -- "$BOX_TREE_DIR.new" \
      || _ccrc_die "removing $BOX_TREE_DIR.new failed"
    nsaid="; ~/ccrc.new removed"
  elif [ -e "$BOX_TREE_DIR.new" ]; then
    nsaid="; ~/ccrc.new left in place — it is not a link ccrc made"
  fi
```

In wave 4's update-state statement (`grep -n 'rm -f -- "\$BOX_PREVIOUS_FILE" "\$BOX_INSTALL_STEP_FILE"' ccd/ccrc`), replace

```bash
  rm -f -- "$BOX_PREVIOUS_FILE" "$BOX_INSTALL_STEP_FILE" "$BOX_UPDATE_JSON" "$BOX_UPDATE_LOCK" "$BOX_INTENT_FILE" \
```

with

```bash
  # The migration's target marker goes with them (W6 Task 6): no migration
  # survives an uninstall, so nothing is left for it to name.
  rm -f -- "$BOX_PREVIOUS_FILE" "$BOX_INSTALL_STEP_FILE" "$BOX_UPDATE_JSON" "$BOX_UPDATE_LOCK" "$BOX_INTENT_FILE" "$BOX_MIGRATION_FILE" \
```

(its `|| _ccrc_die "removing the node's update state files failed"` line is unchanged).

In the transcript line (`grep -n 'echo "uninstall: tree: ~/ccrc removed;' ccd/ccrc`), replace its ending

```bash
update.json, update.lock, update-intent) removed"
```

with

```bash
update.json, update.lock, update-intent) removed$vsaid$msaid$nsaid"
```

**[added in review]** In `cmd_uninstall` (`grep -n '^cmd_uninstall() {' ccd/ccrc`), the live-session gate ends

```bash
  if [ "$count" != 0 ] && [ "$force" -eq 0 ]; then
    _ccrc_die "this box holds $count live ccd session(s) ($sessions) — uninstalling under them orphans every supervisor. Stop them first (ccd list, then ccd stop each), or run: ccrc uninstall --force"
  fi
```

and is followed by a blank line and `  _uninst_units`. Insert between that `fi` and the blank line:

```bash

  # ── THE UPDATE LOCK, SECOND (D-3453) ─────
  # The sweep in `_uninst_tree_bins` removes ~/ccrc-versions and
  # ~/ccrc.migrating, which every other writer touches only under
  # ~/.ccrc/update.lock (`ccrc versions --prune` takes `_upd_lock`, the
  # migration finish `_ver_lock_try`). An update or rollback in flight — a
  # `--detach` one runs in a transient unit `_uninst_units` never stops —
  # could be placing into, or flipping to, a version this removes, and its
  # rename would then re-create ~/ccrc pointing at nothing. So it is asked
  # HERE, before anything is removed: refusing halfway would leave a box
  # neither installed nor not. A PROBE, never an acquire (this run removes the
  # lock file itself), and its four answers are never folded (ruling R16's
  # rule for wave 4's callers, applied to this one): 0 free; 1 held; 3, or any
  # rc it does not define, UNMEASURED, refused with its own sentence; and 2,
  # no `flock`, proceeds, because no updater that takes this lock runs
  # without one (`_upd_lock` dies first). `--force` skips it, as it passes
  # the live-session gate. Not closed: D-3251's window between a detaching
  # parent's probe and its child's acquire.
  local lrc=0
  if [ "$force" -eq 0 ]; then
    _upd_lock_probe || lrc=$?
    case "$lrc" in
      0|2) : ;;
      1) _ccrc_die "an update holds ~/.ccrc/update.lock ($(_upd_lock_holder)) — uninstalling under it would remove the version it is placing or flipping to. Wait for it to finish, or run: ccrc uninstall --force — nothing on this box was removed" ;;
      *) _ccrc_die "~/.ccrc/update.lock could not be measured (probe rc $lrc) — refusing to uninstall past a lock this box cannot see. Run ccrc uninstall --force to proceed anyway — nothing on this box was removed" ;;
    esac
  fi
```

**[added in review]** In `usage()`'s `uninstall` entry (`grep -n 'worktrees and ~/ccrc-backups. Refuses while live sessions' ccd/ccrc`), replace the two lines

```
            worktrees and ~/ccrc-backups. Refuses while live sessions
            exist. [--force] proceeds anyway; [--purge] also removes
```

with

```
            worktrees and ~/ccrc-backups. Refuses while live sessions
            exist, or while an update holds ~/.ccrc/update.lock.
            [--force] proceeds anyway; [--purge] also removes
```

(+1 line. Measured at `d759c914`: no test pins either line's words, since `grep -rn 'Refuses while live\|proceeds anyway' server/test` prints nothing, and neither wave 4's plan nor any other W6 task edits them.)

- [ ] **Step 4: Run green**

Run (from `server/`, foreground, one at a time, timeout ≥ 600000 ms):
- `./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts` — Expected: PASS, the whole file. Record the `passed | skipped` count from a run of the file taken BEFORE Step 1 (wave 4's Task 13 recorded `29 passed | 4 skipped` on Linux). On Linux this run must read exactly seven more passed and the same skipped. On macOS it must read five more passed and two more skipped (the `itLinux` lock cases). A smaller green is not this green.
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — Expected: PASS. The install-record census names `_uninst_tree_bins`' `rm -f -- "$BOX_INSTALLED_FILE" \` line, which this task did not touch.
- `./node_modules/.bin/vitest run test/macos-platform.test.ts` — Expected: PASS. The new lines use `rm -rf --`, `rm -f --`, `[ -d ]`, `[ -L ]`, `[ -e ]` and a `case` only; the `gnuOnly` sweep finds nothing. The D-2765 title scan reads the two new `itLinux` titles and finds no `ASSERTS_PLATFORM` shape in either.
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — Expected: PASS (`unlinkSync` is used by the crash-pair case; `spawn`, `ChildProcess` and `afterEach` by the lock cases; `plantInstalledBox`'s new parameter is optional, so every existing call still type-checks).

- [ ] **Step 5: Mutation check (spec §11 audit row "gains a sweep of `~/ccrc-versions/`"; plan rows D-3452 (the migrating tree and the staged link), the link-only removal, the marker, D-3453)**

Each mutation is made alone, run, and restored from a saved copy (never `git checkout --`):

```bash
M="$(mktemp -d)"; cp ccd/ccrc "$M/ccrc"
mut() {   # <old> <new>: one literal replacement in ccd/ccrc; refuses unless <old> occurs exactly once
  python3 - "$1" "$2" <<'PY'
import pathlib, sys
p = pathlib.Path('ccd/ccrc'); s = p.read_text(); old, new = sys.argv[1], sys.argv[2]
n = s.count(old)
if n != 1: sys.exit(f'mutation target occurs {n} times, not once')
p.write_text(s.replace(old, new))
PY
}
restore() { cp "$M/ccrc" ccd/ccrc && cmp ccd/ccrc "$M/ccrc"; }
```

1. The sweep: `mut $'  if [ -d "$BOX_VERSIONS_ROOT" ] && [ ! -L "$BOX_VERSIONS_ROOT" ]; then\n    _ver_list || :' $'  if false; then\n    _ver_list || :'`. Run `(cd server && ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts -t 'a versioned box: the link')` → RED: `the versions root survived`. Then `restore`.
2. D-3452: `mut $'  if [ -e "$BOX_MIGRATING_DIR" ] || [ -L "$BOX_MIGRATING_DIR" ]; then\n' $'  if false; then\n'`. Run `-t 'a migrated box'` → RED: `~/ccrc.migrating survived`. Then `restore`.
3. The link-only removal: `mut $'  rm -rf -- "$BOX_TREE_DIR" \\\n' $'  rm -rf -- "$BOX_TREE_DIR/" \\\n'`. Run `-t 'a versioned box: the link'` → RED: `the ~/ccrc link survived`. GNU rm empties `v9.9.2` through the link and answers 0; the sweep then removes the root, so the link is left dangling. `existsSync` would read that as absent, and only `present`'s `lstat` sees it. Measured on Linux; BSD `rm`'s answer to a trailing slash on a link is not this row's subject. Then `restore`.
4. The marker: `mut ' "$BOX_INTENT_FILE" "$BOX_MIGRATION_FILE" \' ' "$BOX_INTENT_FILE" \'`. Run `-t 'a migrated box'` → RED: `migrating-to survived`. Then `restore`.
5. **[added in review]** The staged link: `mut $'  if [ -L "$BOX_TREE_DIR.new" ]; then\n    rm -f -- "$BOX_TREE_DIR.new" \\\n      || _ccrc_die "removing $BOX_TREE_DIR.new failed"\n' $'  if [ -L "$BOX_TREE_DIR.new" ]; then\n    :\n'`. Run `-t 'a versioned box: the link'` → RED: `a staged ~/ccrc.new link survived`. The link now dangles, so only `present`'s `lstat` sees it. Then `restore`.
6. **[added in review]** The staged link's shape guard: `mut 'if [ -L "$BOX_TREE_DIR.new" ]; then' 'if [ -e "$BOX_TREE_DIR.new" ]; then'`. The `elif`'s `[ -e … ]` is spelled `-e`, so the `-L` target occurs once. Run `-t 'is not a link'` → RED: exit 1, `removing …/ccrc.new failed`, because `rm -f` refuses a directory. Then `restore`.
7. **[added in review]** D-3453, the gate: `mut $'    _upd_lock_probe || lrc=$?\n    case "$lrc" in\n' $'    case "$lrc" in\n'`. Run `-t 'update holding'` → RED: `expected 0 to be 1`. Then `restore`.
8. **[added in review]** rc 3 is never "free": `mut $'      0|2) : ;;\n' $'      0|2|3) : ;;\n'`. Run `-t 'cannot be MEASURED'` → RED on the stderr regex: the run goes on and dies at wave 4's `rm -f` of the directory. Then `restore`.
9. **[added in review]** rc 3 is never "held": `mut $'      1) _ccrc_die "an update holds' $'      1|3) _ccrc_die "an update holds'`. Run `-t 'cannot be MEASURED'` → RED: the holder sentence prints, and `rc 3 was folded into "held"`. Then `restore`.
10. **[added in review]** `--force` passes the gate: `mut $'  if [ "$force" -eq 0 ]; then\n    _upd_lock_probe' $'  if :; then\n    _upd_lock_probe'`. Run `-t 'update holding'` → RED at the control: the `--force` run exits 1. Then `restore`.

Rows 7–10 need a real `flock` and run on Linux only; on macOS their cases skip.

Finish with `cmp ccd/ccrc "$M/ccrc" && rm -rf "$M"`, and `git diff --stat` shows only this task's intended edits.

Measured while planning (2026-09-23) on a scratch mirror of `d759c914`. The mirror carried stand-ins for the constants Tasks 2, 3 and 5 declare, a bash-only `_ver_list`, and wave 4's update-state `rm` and transcript ending. In it, the five new cases went red as Step 2 says and green with Step 3; the whole file read `34 passed | 4 skipped`; and each of the four mutations above went red with exactly the message given, then green on restore. The `|| :` on step 2's `_ver_list` call and mutation 1's target, which now includes it, were added after that measurement. They change no path the cases drive, but mutation 1's `mut` must still find its target exactly once. The amended preserve-case regex was NOT measured: its subject is wave 4's line, which the mirror only imitated. Run it red and green on the real wave-4 tree before counting Step 4 done. **[added in review]** Also NOT measured: everything added in review. That is the `~/ccrc.new` sweep and its two case changes, the update-lock gate, its two `itLinux` cases, the `usage()` line, and mutation rows 5–10. The gate's subject is wave 4's `_upd_lock_probe` and `_upd_lock_holder`, which exist only once wave 4 is merged. Run each red first, then green, and run each of rows 5–10 on the real tree.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc server/test/ccrc-uninstall.test.ts
git commit -m "feat(ccrc): uninstall refuses under a held or unmeasurable update lock, removes the ~/ccrc link (never through it), sweeps ~/ccrc-versions, a stray ~/ccrc.migrating with its marker and a staged ~/ccrc.new link, and says what it found (W6 Task 6)"
```

### Task 7: The audit, walked

**Files:**
- Create: `server/test/ccrc-versioned-audit.test.ts` — one describe, one case per satisfied row of spec §11's audit table, through a fixture HOME whose `~/ccrc` is a symlink into `~/ccrc-versions/<name>` (Task 2's `installVersionedTree`)
- Modify: `server/test/ccrc-update.test.ts`:
  - `homeSnapshot` (doc comment `:551-556`, body `:557-570` at `d759c914`) records a symlink as `<rel> -> <readlink value>` instead of `<rel>\t<lstat size>`;
  - the fs import (`:39-43` at `d759c914`) already carries `readlinkSync`: Task 2 Step 1(e) turned its line `  symlinkSync,` into `  symlinkSync, readlinkSync,`. This task adds it only if `grep -c 'readlinkSync' server/test/ccrc-update.test.ts` prints `0` — a second copy is a duplicate-declaration error in a file `typecheck-tests.test.ts` compiles;
  - the `--check` write-nothing case (`it('writes NOTHING under HOME (spec §11) …'`, `:1405`) gains a versioned-box twin.
  - **[added]** A harness self-test right after the twin: `homeSnapshot` sees a flip between two same-length names. It is the committed form of the "silently stops at the link" measurement.
  - `installVersionedTree` is imported from `./installTreeFixture.js`. Task 2 Step 1(e) adds that import (Tasks 3–5 each add it only if absent); if `grep -n "installVersionedTree } from './installTreeFixture.js'" server/test/ccrc-update.test.ts` prints nothing, add `import { installVersionedTree } from './installTreeFixture.js';` directly below `import { itLinux, itDarwin } from './platformFixtures.js';`.
- Run, not edited: `server/test/ccrc-install.test.ts`'s byte-equality pin `the launcher is BYTE FOR BYTE what deploy.sh generates` (`:1724-1741` — the two shim heredocs stay byte-equal; nothing in this wave touches either); `agent/test/whitelist-structural.test.ts`; `server/test/typecheck-tests.test.ts` (it compiles every file under `server/test`, the new one included)
- Not modified, and why: `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `server/src/server.ts`, `agent/src/whitelist.ts`, `agent/src/server.ts`, `ccd/ccd-usage-sweep`, the unit files — every row walked here is SATISFIED unchanged (spec §11); this task measures, it does not repair
- Not chased here: `server/test/session-hook.test.ts` (Task 9; this task edits no cited file)

**Interfaces:**
- `describe('spec §11 audit — the satisfied rows, walked through a symlinked ~/ccrc (W6 Task 7)')`. Each case runs over its OWN fixture HOME (`auditBox`), holding `installVersionedTree(home, 'v9.9.1')` (linked) and `installVersionedTree(home, 'v9.9.0', { link: false })`. **[corrected: one box per case, not one shared.]** Row 1 plants an `exit 0` sentinel in `v9.9.1`'s `ccd/ccrc`, so a shared box would end row 2's `source` at line 2. Each case asserts the row's verdict by running or reading the real file:
  1. **the launcher** — `_inst_shim`'s bytes (sourced `ccrc`, `_inst_shim > <home>/.local/bin/ccrc`), run with `version`. It `exec`s `$HOME/ccrc/ccd/ccrc` through the link. What runs is `v9.9.1`'s copy, measured by a sentinel planted in that copy only (line 2: `printf 'audit-sentinel v9.9.1 %s\n' "$0"; exit 0`). Stdout is exactly `audit-sentinel v9.9.1 <home>/ccrc/ccd/ccrc`, and `v9.9.0`'s copy is byte-equal to the repository's.
  2. **`CCRC_HERE`** — `$HOME/ccrc/ccd/ccrc` sourced with a probe that prints `CCRC_HERE` → `<home>/ccrc/ccd`, never `<home>/ccrc-versions/…` (plain `pwd`, `:1098-1100` at `d759c914`; Task 1's helper, inserted inside the platform layer above it, moves it down). Sourcing hands the three-line idiom the same `${BASH_SOURCE[0]}` that `bash $HOME/ccrc/ccd/ccrc` does, and the file's source guard (`:12883` at `d759c914`) keeps the dispatch from running.
  3. **`_dr_pkg_candidates`** — `ccd/ccrc-doctor-checks` sourced under `CCRC_HERE=<home>/ccrc/ccd` → `<home>/ccrc/server/package.json` and `<home>/ccrc/agent/package.json`, both resolving to `v9.9.1`'s files.
  4. **the units** — **[widened]** D-3454. Every non-comment `%h/ccrc/<path>` token in every `.service`/`.timer`/`.conf` under `deploy/` and `ccd/` is collected. The census must contain `deploy/ccrc.service`'s and `deploy/ccrc-agent.service`'s ExecStart entries (`:19`, `:7`: `ExecStart=/usr/bin/env node %h/ccrc/…`). Each token, with `%h` → `<home>`, exists in the fixture and `realpathSync`s into `v9.9.1`. After wave 4 the census also holds `deploy/systemd/ccrc-update-watchdog.service`'s `ExecCondition=` token `%h/ccrc/ccd/ccrc` (wave 4 Task 9: `ExecCondition=/bin/sh -c 'grep -q "^cmd_watchdog()" %h/ccrc/ccd/ccrc'`), which the spec's table predates; the case pins it in the census beside the two ExecStart entries. D-3454 is this task's departure and is added to `## Deviations found`: the spec's row names two ExecStart lines, the walk takes every tree token. `ccd/claude-session@.service`'s `ExecStart=%h/.local/bin/ccd supervise %i` (`:23`) names no tree.
  5. **the Darwin plist** — `_inst_plist_server` from the sourced `ccrc` with `CCD_OS=darwin` prints `$HOME/ccrc/server/dist/server/src/index.js` inside its `ProgramArguments`, unchanged. The plist names no `ccrc-versions`, and the path resolves into `v9.9.1`.
  6. **`findPwaRoot`** — `server/src/server.ts`'s function body (sliced by `function findPwaRoot(): string | null {` … its closing `}` at column 0; `:300-312` at `d759c914`) walks from `import.meta.url` and names no `ccrc` literal. Node's own behaviour, measured: a `.mjs` placed in `v9.9.1/server/dist/server/src/` and run as `node <home>/ccrc/server/dist/server/src/audit-probe.mjs` prints an `import.meta.url` under `<home>/ccrc-versions/v9.9.1/`, the real path. **[strengthened]** The probe also carries findPwaRoot's OWN body, with its one type annotation stripped, and prints what it returns: `<home>/ccrc-versions/v9.9.1/server/dist-pwa`. So the relative walk is run, not inferred. Measured 2026-09-23 on node v24.14.1. The probe's environment drops `NODE_OPTIONS`, `NODE_PRESERVE_SYMLINKS` and `NODE_PRESERVE_SYMLINKS_MAIN`, any of which would change the answer.
  7. **`ccd-usage-sweep`** — its line `: "${CCRC_TREE:=$HOME/ccrc}"` (`ccd/ccd-usage-sweep:19`) is present verbatim. `ccd/ccd` names neither `$HOME/ccrc` nor `ccrc-versions` on any line of CODE (zero references, measured at `d759c914`). **[corrected: non-comment lines]** Task 1's byte-identical `_plat_ln_swap` header comment names the spec's `$HOME/ccrc.new` ("which for the tree is the spec's own `$HOME/ccrc.new`"), which the tree pattern matches, and the audit's claim is about code. The tree pattern is `/(\$HOME|\$\{HOME\}|~|%h)\/ccrc(?![\w-])|ccrc-versions/`. Controls in the case check that it matches the sweep's own default line, and that it matches neither `$HOME/ccrc-backups` nor `$HOME/.ccrc/…`.
  8. **the agent whitelist (the audit's one OPEN row, settled)** — all of it read as text, never imported (the server suite does not import agent code):
     - `agent/src/whitelist.ts` declares `export interface WhitelistConfig { home: string; projectsRoot: string }` (`:9`) and no third field.
     - **[added — where they are canonicalised]** its `checkPath` canonicalises exactly `canonicalize(cfg.home),` and `canonicalize(cfg.projectsRoot),` (`:74-75`).
     - `agent/src/server.ts` builds the per-connection `cfg: { home: opts.home, projectsRoot: opts.projectsRoot },` (`:711`) from `startAgent`'s `home: rawOpts.home ?? os.homedir(),` and `projectsRoot: resolveProjectsRoot(rawOpts.projectsRoot),` (`:836-837`).
     - `resolveProjectsRoot` (`:131-143`) names no `ccrc`.
     The verdict line in the case title reads `canonicalised from $HOME and the projects root, never the tree — a flip does not move them`.
  9. **the rule "no code compares `import.meta.url` to `~/ccrc`"** — a scan of every non-test `.ts`/`.mjs`/`.js` under `server/src`, `agent/src`, `shared`, `ccd` (skipping `node_modules`, `test`, `dist`) for a line containing `import.meta.url` or `realpath` and also a tree literal. The expected set is `[]`. **[corrected literal class]** The literal is `/['"`/]ccrc['"`/]|ccrc-versions/`: a `ccrc` path segment delimited on both sides, or the versions root. The skeleton's bare `ccrc'` also matches `'.ccrc'`, the CONFIG directory, which is not the tree. The one known look-alike, `ccd/compact-card.mjs:749` (the is-main-module self-check), is named in a comment as the reason the scan requires the literal. The case also pins that the candidate set is not empty: `server/src/server.ts`, `ccd/compact-card.mjs` and `agent/src/whitelist.ts` are among the files with candidates.
- `homeSnapshot(home)`: `lstatSync(p).isSymbolicLink()` → push `${rel} -> ${readlinkSync(p)}`, and do not descend. The versions root is a real directory under `home` and is walked on its own. The `--check` twin plants a W6 box and asserts before/after equality. **[corrected]** It runs `--check --to v9.9.2`, so the case measures what `--check` writes and not wave 4's projection-driven target resolution (`--to` never reads the projection). Its "this is a W6 box" guard is an `lstat`, not a snapshot line, so the mutation control below can run with the old listing.
- Mutation rows:
  - add `-P` to `CCRC_HERE`'s `pwd` (row 2 reds, as spec §11 predicts) and to `_dr_pkg_candidates`' `pwd` (row 3 reds);
  - a flip injected between the twin's two snapshots (a control run that re-points `~/ccrc` at `v9.9.0`) → the new link line reds it, and with the link line reverted the same control stays GREEN — the measured "silently stops at the link" defect;
  - a `ccrc` literal planted beside an `import.meta.url` in `server/src/server.ts`, restored from a scratch copy → row 9 reds.

- [ ] **Step 1: Write the audit suite — `server/test/ccrc-versioned-audit.test.ts` (new)**

```ts
// Spec §11's audit table for versioned installs, WALKED — W6 Task 7.
//
// W6 turns `~/ccrc` from a directory into a LINK, `~/ccrc ->
// ~/ccrc-versions/<name>`, and spec §11 measured (2026-09-20) which of the
// tree's path contracts a link satisfies unchanged. This file turns each
// "satisfied" verdict into a case that runs or reads the real file through a
// fixture HOME laid out exactly as W6 leaves a box: `v9.9.1` placed and
// linked, `v9.9.0` placed beside it. A verdict that stops holding is a red
// here, not a sentence in a design nobody re-reads.
//
// The table's three "must change" rows are NOT here — they are W6's own
// tasks (the rsync target and the self-copy guard, Task 2; uninstall's sweep,
// Task 6). `deploy.sh`'s row is untouched by decision. The one row the spec
// left OPEN, the agent whitelist, is settled here (row 8).
//
// ONE BOX PER CASE. Row 1 plants an `exit 0` sentinel in `v9.9.1`'s own
// `ccd/ccrc`; a shared box would end every later `source` of that file at its
// second line.
//
// Containment: `ghContainedEnv`'s poisoned `gh` at the head of PATH, every
// `CCRC_*` input deleted by name, HOME a `mkTmp` fixture. Nothing here runs a
// verb that installs, updates or touches a unit.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { installVersionedTree } from './installTreeFixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC = join(REPO, 'ccd', 'ccrc');

function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}
const BASH = realPath('bash');

/** A W6 box: `v9.9.1` placed and LINKED, `v9.9.0` placed beside it. `mkTmp`
 *  resolves its directory, so `home` is already a physical path and a
 *  `realpathSync` through the link answers `<home>/ccrc-versions/…` exactly. */
function auditBox(prefix: string): { home: string; v1: string; v0: string } {
  const home = mkTmp(prefix);
  const v1 = installVersionedTree(home, 'v9.9.1');
  const v0 = installVersionedTree(home, 'v9.9.0', { link: false });
  return { home, v1, v0 };
}

function auditEnv(home: string): NodeJS.ProcessEnv {
  const env = ghContainedEnv(home, { ...process.env, HOME: home });
  for (const k of Object.keys(env)) if (k.startsWith('CCRC_')) delete env[k];
  // Each of these changes what Node reports as a module's own path — the
  // subject of row 6 — so none may leak in from the runner.
  for (const k of ['NODE_OPTIONS', 'NODE_PRESERVE_SYMLINKS', 'NODE_PRESERVE_SYMLINKS_MAIN']) delete env[k];
  return env;
}

/** A bash snippet; `$1`… are its arguments. `set --` before any `source`, so
 *  the sourced file never sees the snippet's own arguments as its `$@`. */
function sh(home: string, script: string, args: string[] = []) {
  const r = spawnSync(BASH, ['-c', script, '--', ...args], { env: auditEnv(home), encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Every file under `d` whose name `keep` admits, skipping the named
 *  directories. A function declaration, not a self-referencing const, so the
 *  recursion needs no inferred type (`typecheck-tests.test.ts` compiles this
 *  file under `strict`). */
function walk(d: string, keep: (name: string) => boolean, skip: string[]): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return skip.includes(e.name) ? [] : walk(p, keep, skip);
    return keep(e.name) ? [p] : [];
  });
}

describe('spec §11 audit — the satisfied rows, walked through a symlinked ~/ccrc (W6 Task 7)', () => {
  it('row 1, the launcher: _inst_shim\'s bytes exec $HOME/ccrc/ccd/ccrc through the link, and what runs is the pointed-at version\'s copy', () => {
    const { home, v1, v0 } = auditBox('ccrc-audit-shim-');
    // The sentinel, in v9.9.1's copy ONLY, as its second line: if the link
    // pointed anywhere else, the real `ccrc version` would run instead and
    // print no sentinel.
    const planted = join(v1, 'ccd', 'ccrc');
    const lines = readFileSync(planted, 'utf8').split('\n');
    lines.splice(1, 0, 'printf \'audit-sentinel v9.9.1 %s\\n\' "$0"; exit 0');
    writeFileSync(planted, lines.join('\n'));
    const shim = join(home, '.local', 'bin', 'ccrc');
    mkdirSync(dirname(shim), { recursive: true });
    const gen = sh(home, 'f=$1; out=$2; set --; source "$f"; _inst_shim > "$out"', [CCRC, shim]);
    expect(gen.code, gen.stderr).toBe(0);
    chmodSync(shim, 0o755);
    expect(readFileSync(shim, 'utf8')).toContain('CCRC_SHIPPED="$HOME/ccrc/ccd/ccrc"\n');
    const r = spawnSync(shim, ['version'], { env: auditEnv(home), encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`audit-sentinel v9.9.1 ${home}/ccrc/ccd/ccrc\n`);
    expect(readFileSync(join(v0, 'ccd', 'ccrc'), 'utf8'), 'v9.9.0\'s copy was touched').toBe(readFileSync(CCRC, 'utf8'));
  });

  it('row 2, CCRC_HERE: the plain pwd keeps the link — a ccrc reached through $HOME/ccrc answers $HOME/ccrc/ccd, never the version path', () => {
    const { home } = auditBox('ccrc-audit-here-');
    // Sourcing hands `CCRC_HERE`'s three-line idiom (`ccd/ccrc:1098-1100`)
    // exactly the `${BASH_SOURCE[0]}` that `bash $HOME/ccrc/ccd/ccrc` does;
    // the file's source guard keeps its dispatch from running.
    const r = sh(home, 'f=$1; set --; source "$f"; printf \'%s\\n\' "$CCRC_HERE"', [join(home, 'ccrc', 'ccd', 'ccrc')]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(`${join(home, 'ccrc', 'ccd')}\n`);
  });

  it('row 3, _dr_pkg_candidates: the plain pwd keeps the link — both package.json candidates are $HOME/ccrc paths, and they are v9.9.1\'s files', () => {
    const { home, v1 } = auditBox('ccrc-audit-pkg-');
    const r = sh(home,
      'CCRC_HERE=$1; set --; set -uo pipefail; . "$CCRC_HERE/ccrc-doctor-checks"; _dr_pkg_candidates',
      [join(home, 'ccrc', 'ccd')]);
    expect(r.code, r.stderr).toBe(0);
    const got = r.stdout.split('\n').filter((l) => l !== '');
    expect(got).toEqual([join(home, 'ccrc', 'server', 'package.json'), join(home, 'ccrc', 'agent', 'package.json')]);
    expect(got.map((p) => realpathSync(p))).toEqual([join(v1, 'server', 'package.json'), join(v1, 'agent', 'package.json')]);
  });

  it('row 4, the units: every %h/ccrc/… token a shipped unit names resolves through the link into v9.9.1; the session unit names no tree', () => {
    // D-3454: the table names two ExecStart
    // lines; the walk takes EVERY tree token in every unit and drop-in, so a
    // unit written after the table (wave 4's watchdog, whose ExecCondition=
    // greps %h/ccrc/ccd/ccrc) is walked too, and a future one cannot be
    // missed.
    const { home, v1 } = auditBox('ccrc-audit-units-');
    const units = [
      ...walk(join(REPO, 'deploy'), (n) => /\.(service|timer|conf)$/.test(n), ['node_modules']),
      ...walk(join(REPO, 'ccd'), (n) => /\.(service|timer|conf)$/.test(n), ['node_modules']),
    ];
    const tokens: Array<{ at: string; token: string }> = [];
    for (const f of units) {
      for (const l of readFileSync(f, 'utf8').split('\n')) {
        if (/^\s*#/.test(l)) continue;
        for (const m of l.matchAll(/%h\/ccrc\/[^\s'"]+/g)) tokens.push({ at: path.relative(REPO, f), token: m[0] });
      }
    }
    const named = tokens.map((t) => `${t.at}: ${t.token}`);
    expect(named).toContain('deploy/ccrc.service: %h/ccrc/server/dist/server/src/index.js');
    expect(named).toContain('deploy/ccrc-agent.service: %h/ccrc/agent/dist/agent/src/index.js');
    // Wave 4 Task 9's watchdog guard, the token the table predates.
    expect(named).toContain('deploy/systemd/ccrc-update-watchdog.service: %h/ccrc/ccd/ccrc');
    for (const { at, token } of tokens) {
      const onBox = token.replace('%h', home);
      expect(existsSync(onBox),
        `${at} names ${token}, which the fixture version lacks — add it to installTreeFixture.ts and re-walk this row`).toBe(true);
      expect(realpathSync(onBox), `${at}: ${token}`).toBe(join(v1, token.slice('%h/ccrc/'.length)));
    }
    const read = (rel: string): string[] => readFileSync(join(REPO, rel), 'utf8').split('\n');
    expect(read('deploy/ccrc.service')).toContain('ExecStart=/usr/bin/env node %h/ccrc/server/dist/server/src/index.js');
    expect(read('deploy/ccrc-agent.service')).toContain('ExecStart=/usr/bin/env node %h/ccrc/agent/dist/agent/src/index.js');
    const session = read('ccd/claude-session@.service');
    expect(session).toContain('ExecStart=%h/.local/bin/ccd supervise %i');
    expect(session.filter((l) => /%h\/ccrc(?![\w-])/.test(l))).toEqual([]);
  });

  it('row 5, the Darwin plist: _inst_plist_server bakes $HOME/ccrc/server/dist/… into ProgramArguments, unchanged, and it resolves into v9.9.1', () => {
    const { home, v1 } = auditBox('ccrc-audit-plist-');
    const r = sh(home,
      'f=$1; set --; source "$f"; CCD_OS=darwin; _inst_plist_server app.ccrc.ccrc "$HOME/.ccrc/logs/app.ccrc.ccrc.log"',
      [CCRC]);
    expect(r.code, r.stderr).toBe(0);
    const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(r.stdout);
    expect(args, 'the plist has no ProgramArguments array').not.toBeNull();
    const entry = `${home}/ccrc/server/dist/server/src/index.js`;
    expect(args![1]).toContain(`exec /usr/bin/env node '${entry}'`);
    expect(r.stdout).not.toContain('ccrc-versions');
    expect(realpathSync(entry)).toBe(join(v1, 'server', 'dist', 'server', 'src', 'index.js'));
  });

  it('row 6, findPwaRoot: its body names no ccrc literal, and Node hands it the REAL path — the walk lands in v9.9.1\'s dist-pwa', () => {
    const { home, v1 } = auditBox('ccrc-audit-pwa-');
    const src = readFileSync(join(REPO, 'server', 'src', 'server.ts'), 'utf8');
    const m = /^function findPwaRoot\(\): string \| null \{\n[\s\S]*?\n\}\n/m.exec(src);
    expect(m, 'server.ts has no findPwaRoot() in the shape this row read — re-measure the row').not.toBeNull();
    const body = m![0];
    expect(body).toContain('path.dirname(fileURLToPath(import.meta.url))');
    expect(body).not.toMatch(/ccrc/);
    // The walk itself, run where the built server runs (beside
    // dist/server/src/index.js), reached through the link. Its ONE type
    // annotation is stripped; nothing else in the body is TypeScript.
    const probe = join(v1, 'server', 'dist', 'server', 'src', 'audit-probe.mjs');
    writeFileSync(probe, [
      "import path from 'node:path';",
      "import { existsSync } from 'node:fs';",
      "import { fileURLToPath } from 'node:url';",
      body.replace('function findPwaRoot(): string | null {', 'function findPwaRoot() {'),
      'console.log(fileURLToPath(import.meta.url));',
      'console.log(findPwaRoot());',
      '',
    ].join('\n'));
    const r = spawnSync(process.execPath, [join(home, 'ccrc', 'server', 'dist', 'server', 'src', 'audit-probe.mjs')],
      { env: auditEnv(home), encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`${probe}\n${join(v1, 'server', 'dist-pwa')}\n`);
  });

  it('row 7, ccd-usage-sweep defaults CCRC_TREE to the plain $HOME/ccrc, and ccd/ccd names the tree on no line of code', () => {
    const TREE_REF = /(\$HOME|\$\{HOME\}|~|%h)\/ccrc(?![\w-])|ccrc-versions/;
    // Controls: the pattern sees the one reference it must, and neither
    // sibling that is not the tree.
    expect(TREE_REF.test(': "${CCRC_TREE:=$HOME/ccrc}"')).toBe(true);
    expect(TREE_REF.test('BOX_BACKUP_ROOT="$HOME/ccrc-backups"')).toBe(false);
    expect(TREE_REF.test('ACCOUNTS_SH="$HOME/.ccrc/accounts.sh"')).toBe(false);
    const sweep = readFileSync(join(REPO, 'ccd', 'ccd-usage-sweep'), 'utf8').split('\n');
    expect(sweep).toContain(': "${CCRC_TREE:=$HOME/ccrc}"');
    // CODE lines only: W6 Task 1's platform helper is byte-identical in both
    // files, and its header comment names the spec's own `$HOME/ccrc.new`.
    const code = readFileSync(join(REPO, 'ccd', 'ccd'), 'utf8').split('\n')
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => !/^\s*#/.test(l));
    expect(code.length).toBeGreaterThan(1000);
    expect(code.filter(({ l }) => TREE_REF.test(l)).map(({ n, l }) => `ccd/ccd:${n}: ${l.trim()}`)).toEqual([]);
  });

  it('row 8, the agent whitelist (the audit\'s OPEN row, settled): canonicalised from $HOME and the projects root, never the tree — a flip does not move them', () => {
    const wl = readFileSync(join(REPO, 'agent', 'src', 'whitelist.ts'), 'utf8');
    const iface = /^export interface WhitelistConfig \{([^}]*)\}$/m.exec(wl);
    expect(iface, 'whitelist.ts no longer declares WhitelistConfig on one line — re-measure this row').not.toBeNull();
    expect(iface![1]!.trim()).toBe('home: string; projectsRoot: string');
    // WHERE they are canonicalised — the question the spec left open.
    expect(wl).toContain('    canonicalize(cfg.home),\n    canonicalize(cfg.projectsRoot),\n');
    const agent = readFileSync(join(REPO, 'agent', 'src', 'server.ts'), 'utf8');
    expect(agent).toContain('cfg: { home: opts.home, projectsRoot: opts.projectsRoot },');
    expect(agent).toContain('    home: rawOpts.home ?? os.homedir(),\n    projectsRoot: resolveProjectsRoot(rawOpts.projectsRoot),\n');
    const rp = /^export function resolveProjectsRoot\([\s\S]*?\n\}\n/m.exec(agent);
    expect(rp, 'agent/src/server.ts has no resolveProjectsRoot — re-measure this row').not.toBeNull();
    expect(rp![0]).toContain("path.join(os.homedir(), 'projects')");
    expect(rp![0]).not.toMatch(/ccrc/);
  });

  it('row 9, the rule for W6: no shipped code compares import.meta.url (or a realpath) with the tree\'s own name', () => {
    // A line is a CANDIDATE when it touches either mechanism, and an OFFENDER
    // when it also carries a tree literal: a `ccrc` path segment delimited
    // on both sides, or the versions root. The literal is required because
    // of the one look-alike, `ccd/compact-card.mjs:749`: it compares
    // `import.meta.url` with a realpath, but that realpath is its own
    // `process.argv[1]` (the is-main-module check), never the tree. `'.ccrc'`
    // is the config directory, which is why the segment must be delimited.
    const TREE_LITERAL = /['"`/]ccrc['"`/]|ccrc-versions/;
    const CANDIDATE = /import\.meta\.url|realpath/;
    const files = ['server/src', 'agent/src', 'shared', 'ccd'].flatMap((r) => walk(join(REPO, r),
      (n) => /\.(ts|mjs|js)$/.test(n) && !n.endsWith('.test.ts'), ['node_modules', 'test', 'dist']));
    const candidates = new Set<string>();
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (!CANDIDATE.test(l)) return;
        candidates.add(path.relative(REPO, f));
        if (TREE_LITERAL.test(l)) offenders.push(`${path.relative(REPO, f)}:${i + 1}: ${l.trim()}`);
      });
    }
    // A scan over nothing passes everything.
    expect([...candidates]).toEqual(expect.arrayContaining(['server/src/server.ts', 'ccd/compact-card.mjs', 'agent/src/whitelist.ts']));
    expect(offenders).toEqual([]);
  });

  it('the fixture is the W6 layout the rows claim — ~/ccrc is a link, both versions are real directories', () => {
    const { home, v1, v0 } = auditBox('ccrc-audit-layout-');
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(realpathSync(join(home, 'ccrc'))).toBe(v1);
    for (const v of [v1, v0]) expect(lstatSync(v).isDirectory(), v).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — the audit's verdict**

Run (from `server/`, foreground, timeout ≥ 600000 ms): `./node_modules/.bin/vitest run test/ccrc-versioned-audit.test.ts`
Expected: PASS, ten cases. Every row is SATISFIED unchanged, which is spec §11's verdict and this task's claim; the red half of each row is the mutation in Step 7. If a row reds here, the audit has a finding and nothing in this task repairs it. Record the row, its failure text and the file it read. Add a departure bullet to `## Deviations found` naming Task 7 and the row (named by a slug, minted when it fires — never a placeholder token written ahead of time), and stop this task for a ruling. Never edit the case to fit.

- [ ] **Step 3: Write the failing harness tests — `server/test/ccrc-update.test.ts`**

Confirm both imports Task 2 Step 1(e) added (see **Files**): `grep -c 'readlinkSync' server/test/ccrc-update.test.ts` prints at least `1` (the fs import `import {` … `} from 'node:fs';`, `:39-43` at `d759c914`, reads `  symlinkSync, readlinkSync,`), and `grep -n "installVersionedTree } from './installTreeFixture.js'" server/test/ccrc-update.test.ts` prints one line. Add either only if it is absent — never a second copy.

Immediately after the closing `});` of `it('writes NOTHING under HOME (spec §11) — the whole home is byte-identical, not just the three places we thought to look'`, add:

```ts
  it('writes NOTHING on a versioned box either — the ~/ccrc link, both kept versions and the stamp are unchanged (W6 Task 7)', () => {
    // The case above, on the layout W6 leaves a box in: `~/ccrc` a LINK into
    // `~/ccrc-versions/v9.9.1`, a second kept version beside it. `--to`, so
    // the target is named rather than resolved: this case measures what
    // `--check` WRITES, and `--to` never reads the projection. The W6 guard
    // is an lstat, not a snapshot line, so the listing itself stays the only
    // thing under test.
    const home = freshUpdateBox('ccrc-update-check-writes-nothing-w6-');
    installVersionedTree(home, 'v9.9.1', { stamp: { sha: 'oldsha0000000000000000000000000000000000', version: 'v9.9.1' } });
    installVersionedTree(home, 'v9.9.0', { link: false, stamp: { sha: 'b'.repeat(40), version: 'v9.9.0' } });
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink(), 'the fixture is not a W6 box').toBe(true);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v9.9.1', 'oldsha0000000000000000000000000000000000'));
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    packRelease(home, stubTree(home, { version: 'v9.9.2' }), { tag: 'v9.9.2', latest: false });
    // `runUpdate`'s own environment plants, once, in its own order — the
    // reason is the case above's.
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runUpdate(home, ['--check', '--to', 'v9.9.2']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stdout.split('\n')[0]).toMatch(/^check: box=v9\.9\.1 sha=\S+ target=v9\.9\.2 (.* )?state=behind$/);
    expect(homeSnapshot(home)).toEqual(before);
  });

  it('homeSnapshot records a link by its target: a flip between two same-length version names is a difference (W6 Task 7)', () => {
    // The harness's own pin. A symlink used to be a leaf recorded as
    // `<rel>\t<lstat size>`, and a link's lstat size is the LENGTH of its
    // target: `~/ccrc -> …/v9.9.1` and `~/ccrc -> …/v9.9.0` recorded the
    // SAME line, so a `--check` that flipped the box passed the case above.
    const home = mkTmp('ccrc-update-snapshot-link-');
    installVersionedTree(home, 'v9.9.1');
    installVersionedTree(home, 'v9.9.0', { link: false });
    const before = homeSnapshot(home);
    // The flip as `_plat_ln_swap` performs it: a staged link renamed over the old one.
    symlinkSync(join(home, 'ccrc-versions', 'v9.9.0'), join(home, 'ccrc.new'));
    renameSync(join(home, 'ccrc.new'), join(home, 'ccrc'));
    const after = homeSnapshot(home);
    expect(after).not.toEqual(before);
    expect(after).toContain(`ccrc -> ${join(home, 'ccrc-versions', 'v9.9.0')}`);
    expect(after.filter((l) => l.startsWith('ccrc-versions/v9.9.1/')).length,
      'the versions root was not walked on its own').toBeGreaterThan(0);
  });
```

- [ ] **Step 4: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'W6 Task 7'`
Expected: FAIL in ONE case: `homeSnapshot records a link by its target`, with `expected [ …(n) ] to not deeply equal [ …(n) ]`. The old listing records `ccrc\t<len>`, and both targets have the same length. The versioned twin PASSES here: `--check` writes nothing, and the old listing can still see every write other than a flip. That is exactly why the self-test, and not the twin, carries this step's red.

- [ ] **Step 5: Implement — `homeSnapshot`**

In `server/test/ccrc-update.test.ts`, replace `homeSnapshot`'s doc comment first line and its loop body. Replace:

```ts
/** A sorted recursive listing of `<home>` as `<relpath>\t<size>` lines —
 *  the before/after snapshot the `--check` write-nothing case compares.
```

with:

```ts
/** A sorted recursive listing of `<home>` as `<relpath>\t<size>` lines —
 *  the before/after snapshot the `--check` write-nothing case compares.
 *  A SYMLINK is recorded as `<relpath> -> <its value>` and not descended
 *  (W6 Task 7): on a versioned box `~/ccrc` is a link, and `lstat`'s size of
 *  a link is the length of its target, so a flip between two same-length
 *  names (`v9.9.1` → `v9.9.0`) left the old `<relpath>\t<size>` line
 *  byte-identical — measured. `~/ccrc-versions/` is a real directory under
 *  `<home>` and is walked on its own.
```

and replace the line

```ts
      if (st.isDirectory()) { out.push(`${rel}/`); walk(p, rel); } else out.push(`${rel}\t${st.size}`);
```

with

```ts
      if (st.isSymbolicLink()) out.push(`${rel} -> ${readlinkSync(p)}`);
      else if (st.isDirectory()) { out.push(`${rel}/`); walk(p, rel); } else out.push(`${rel}\t${st.size}`);
```

- [ ] **Step 6: Run green**

Run (from `server/`, foreground, one at a time, timeout ≥ 600000 ms):
- `./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'W6 Task 7|writes NOTHING'` — Expected: PASS, `3 passed`: both new cases and the original write-nothing case.
- `./node_modules/.bin/vitest run test/ccrc-update.test.ts` — Expected: PASS, the whole file. This is the run that covers the file's other `homeSnapshot` callers: wave 4's `--check with no --to reports what update WOULD install …` and its `ccrc channel` case (`an in-force projection: … nothing written`), and Task 3's `--check on a crashed box says so after its machine line and repairs NOTHING …`. None of them plants a link (real-directory boxes; Task 3's crashed box has no `~/ccrc` at all), so their listings are unchanged.
- `./node_modules/.bin/vitest run test/ccrc-versioned-audit.test.ts` — Expected: PASS (ten).

- [ ] **Step 7: Mutation check (spec §11 W5 Pins "a test walks the audit table's satisfied rows through a fixture symlink"; the audit's `-P` warning; the rule row; the harness control)**

Each mutation is made alone, run, and restored from a saved copy (never `git checkout --`):

```bash
M="$(mktemp -d)"
cp ccd/ccrc "$M/ccrc"; cp ccd/ccrc-doctor-checks "$M/ccrc-doctor-checks"
cp server/src/server.ts "$M/server.ts"; cp server/test/ccrc-update.test.ts "$M/ccrc-update.test.ts"
mutf() {   # <file> <old> <new>: one literal replacement; refuses unless <old> occurs exactly once
  python3 - "$1" "$2" "$3" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); s = p.read_text(); old, new = sys.argv[2], sys.argv[3]
n = s.count(old)
if n != 1: sys.exit(f'mutation target occurs {n} times in {p}, not once')
p.write_text(s.replace(old, new))
PY
}
```

1. `CCRC_HERE` gains `-P`: `mutf ccd/ccrc 'CCRC_HERE="$(cd "${CCRC_HERE%/*}" && pwd)"' 'CCRC_HERE="$(cd "${CCRC_HERE%/*}" && pwd -P)"'`. Run `(cd server && ./node_modules/.bin/vitest run test/ccrc-versioned-audit.test.ts -t 'row 2')` → RED: `expected '<home>/ccrc-versions/v9.9.1/ccd\n' to be '<home>/ccrc/ccd\n'`. This is spec §11's prediction, measured. Restore: `cp "$M/ccrc" ccd/ccrc && cmp ccd/ccrc "$M/ccrc"`.
2. `_dr_pkg_candidates` gains `-P`: `mutf ccd/ccrc-doctor-checks 'root="$(cd "$CCRC_HERE/.." 2>/dev/null && pwd)"' 'root="$(cd "$CCRC_HERE/.." 2>/dev/null && pwd -P)"'`. Run `-t 'row 3'` → RED: the first candidate reads `<home>/ccrc-versions/v9.9.1/server/package.json`. Restore: `cp "$M/ccrc-doctor-checks" ccd/ccrc-doctor-checks && cmp ccd/ccrc-doctor-checks "$M/ccrc-doctor-checks"`.
3. The rule: `printf '%s\n' "const auditProbe = new URL('/ccrc/', import.meta.url);" >> server/src/server.ts`. Run `-t 'row 9'` → RED: `offenders` holds `server/src/server.ts:<last line>: const auditProbe = new URL('/ccrc/', import.meta.url);`. Restore: `cp "$M/server.ts" server/src/server.ts && cmp server/src/server.ts "$M/server.ts"`.
4. The harness control, in two halves. (a) Inject a flip into the twin, between its `runUpdate` and its second snapshot: `mutf server/test/ccrc-update.test.ts $'    const r = runUpdate(home, [\'--check\', \'--to\', \'v9.9.2\']);\n' $'    const r = runUpdate(home, [\'--check\', \'--to\', \'v9.9.2\']);\n    symlinkSync(join(home, \'ccrc-versions\', \'v9.9.0\'), join(home, \'ccrc.new\'));\n    renameSync(join(home, \'ccrc.new\'), join(home, \'ccrc\'));\n'`. Run `(cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t 'writes NOTHING on a versioned box')` → RED: the two listings differ on `ccrc -> …/v9.9.1` vs `ccrc -> …/v9.9.0`. (b) With (a) still in place, revert the link line: `mutf server/test/ccrc-update.test.ts $'      if (st.isSymbolicLink()) out.push(`${rel} -> ${readlinkSync(p)}`);\n      else if (st.isDirectory())' $'      if (st.isDirectory())'`. Run the same command → GREEN. That is the measured "silently stops at the link" defect: the old listing passes a `--check` that flipped the box. Restore: `cp "$M/ccrc-update.test.ts" server/test/ccrc-update.test.ts && cmp server/test/ccrc-update.test.ts "$M/ccrc-update.test.ts"`.

Finish with `rm -rf "$M"`; `git diff --stat` shows only this task's files (the new suite and `ccrc-update.test.ts`).

Measured while planning (2026-09-23) on a scratch mirror of `d759c914`, with a stand-in `installVersionedTree` built to the Task 2 interface. The audit suite read `10 passed`. Mutations 1–3 each red exactly one row with the message given (row 9's offender was `server/src/server.ts:3298: const auditProbe = …`), and each went green on restore. In `ccrc-update.test.ts`, Step 4 red only the self-test (`expected [ Array(204) ] to not deeply equal [ Array(204) ]`), and Step 6's filter read `3 passed`. Mutation 4(a) red the twin on the `ccrc -> …/v9.9.0` line, and 4(b) turned the same run green. Row 4's watchdog-token assertion was added after that run: it needs wave 4 Task 9's `deploy/systemd/ccrc-update-watchdog.service`, which `d759c914` lacks, so it holds only on a tree with wave 4 merged — the tree this wave is dispatched on.

- [ ] **Step 8: Run the files this task reads but does not edit**

- `cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'BYTE FOR BYTE'` — Expected: PASS. The two shim heredocs stay byte-equal (spec §11 W5 Pins); this wave touches neither.
- `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — Expected: PASS. The new suite compiles under `server/test/tsconfig.tests.json`.
- `cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts` — Expected: PASS (row 8 reads `whitelist.ts` as text; this pins its structure from the agent's own side). A worktree built with server modules only has no `agent/node_modules`; run `npm ci` in `agent/` first in that case.

- [ ] **Step 9: Commit**

```bash
git add server/test/ccrc-versioned-audit.test.ts server/test/ccrc-update.test.ts
git commit -m "test(ccrc): walk spec §11's satisfied audit rows through a symlinked ~/ccrc — launcher, CCRC_HERE, doctor's candidates, every unit tree token, the plist, findPwaRoot, the sweep default, the agent whitelist (settled), the import.meta.url rule; homeSnapshot records a link by its target (W6 Task 7)"
```

### Task 8: The rehearsal (fixture half) and its record

**Files:**
- Modify: this plan's `## Rehearsal record` section — its one `<!-- REHEARSAL RECORD: task 8 -->` line is replaced by the record (the one tracked output)
- Scratch: `$SCRATCHPAD/w6-rehearsal/` — `home/` (the fixture `$HOME`, `$H`), `bin/` (the stub `systemctl`, the crash `ln`, and — *correction: the skeleton named two* — a stub `loginctl` and `journalctl`, a recording `curl`, and poisoned `tmux`, `ssh`, `gh`, `systemd-run`, `launchctl`), `logs/`, `run/`, `tmp/`, `tmux/`, and the five helpers `env.sh`, `run.sh`, `state.sh`, `scrub.sh`, `live-probe.sh`; beside it `$SCRATCHPAD/w6-plant.sh`, `$SCRATCHPAD/w6-record.py` and `$SCRATCHPAD/w6-probe/` (the two artifacts' pre-measurement); never under the repo, never the live `$HOME`
- Built, not edited (*correction: not in the skeleton*): this checkout's `server/dist/` and `server/dist-pwa/` (gitignored), and `server/node_modules` and `pwa/node_modules` when absent (Step 2's `npm ci`) — R2 and R3 install FROM this checkout, and `_inst_tree`'s preflights refuse a source with no server build or PWA bundle
- Run, not edited: nothing in the repo is changed but the plan; no test file is created (D-3421); `server/test/topology-clean.test.ts` and `server/test/dtbd.test.ts` read the edited plan (Step 13). `server/test/deviation-refs.test.ts` reads every plan too, but only its `### D-<n>`/`- **D-<n>` entry lines; the record writes none (its headings are `### R<k>:`, `### Controls` and `### The live half`, its bullets `- yes —`/`- NO —`), so it stays Task 9's gate

**Interfaces:**
- Consumes: this branch's `ccd/ccrc` with Tasks 1–7 committed, and the real newest published release `N` and the one before it `N-1` (`gh release list --limit 2`, recorded by tag), each measured in Step 1 to ship `SHA256SUMS`, its tarball and its `.sigstore.json` bundle, and to PREDATE W6 (its `ccd/ccrc` carries no `BOX_VERSIONS_ROOT=` line). Every command runs by explicit path, never through a shim that could reach the live `~/.local/bin`:
  - R1 is `N-1`'s own first install: `bash $REPO/install.sh --release <N-1> --role server` (its tarball fetched and verified by `install.sh`, then its own `ccd/ccrc install`);
  - R2 and R3 are this checkout's `bash $REPO/ccd/ccrc install --role server`;
  - R2v and R4–R6 are this branch's ccrc AS PLACED, `bash $H/ccrc-versions/$U/ccd/ccrc …`. *Correction: the skeleton allowed either form for every step.* From R4 on `$H/ccrc` points at a pre-W6 release, whose own `ccd/ccrc` knows no versions; run through the link, R5 and R6 would be that release's updater and rollback, and neither W6 path would run;
  - R7 runs `bash $REPO/ccd/ccrc …` (the checkout): R7c prunes `$U`, and a prune must not delete the tree of the ccrc running it.
- `U` is `untagged-<the checkout's HEAD sha, first 12 hex>`, the name `_inst_version_name`'s rule 2 gives this checkout (D-3422); HEAD carries no release tag.
- The environment for every command, set by `run.sh` under `env -i`, so no `TMUX`, no live `PATH` and no live `HOME` leak in:
  - `HOME=$H`, `PATH=$S/bin:$H/.local/bin:<node's directory>:/usr/local/bin:/usr/bin:/bin` — `plant.sh` refuses a `node` that resolves from the live `~/.local/bin`;
  - `TMPDIR=$S/tmp`, and `TMUX_TMPDIR=$S/tmux` for the fixture server as well;
  - `CCRC_RELEASE_BASE_URL` set to the product's own default. It is computed at run time from `ccd/ccrc`'s `CCRC_RELEASE_OWNER=`/`CCRC_RELEASE_REPO=` lines and never spelled in this plan (`topology-clean`);
  - `CCRC_UPDATE_HEALTH_S=30`;
  - role `server`: `$H/.ccrc/ccrc.env` is SEEDED before R1 with `CCRC_HOST=127.0.0.1`, `CCRC_PORT=<a free loopback port>`, `CCRC_FLEET=local`, `CCRC_PROJECTS_ROOT=$H/projects` and `CCRC_ROLE=server`. Seed-once keeps it through every install, and `--role server` is passed to every install, so no agent or session machinery runs.
- The stub `systemctl` (the spec's "stub `systemctl`"):
  - `start|restart ccrc.service`, and `enable --now` of a stopped one, stop the recorded pid and start the placed unit's OWN `ExecStart=` line (`$H/.config/systemd/user/ccrc.service`, `%h` expanded) in a session of its own. It runs with `HOME=$H`, the fixture `ccrc.env` read as systemd's `EnvironmentFile=` reads it, and the harness `PATH`, so `/health` really answers the stamp the box holds;
  - `is-active ccrc.service` answers from that pid; `is-active ccrc-agent.service` is `inactive` (a server box has none); any other unit is `active`;
  - `show -p MainPID --value` answers the pid; `show -p ExecStart ccrc.service` answers systemd's struct form, `path=` the interpreter and the tree path inside `argv[]`; `show -p KillMode` answers `KillMode=process`;
  - `stop` stops it; system scope (`systemctl is-active caddy`) answers `inactive`; everything else is recorded and answers 0.
- *Correction (added):* `loginctl` answers `Linger=yes` to `show-user` and records `enable-linger`, which `_inst_linger` would otherwise run against the live user. `journalctl` answers a fixture line rather than the live user's journal. The recording `curl` execs the real one and logs every argv under the step that ran it: that is what measures R6's "no download" — and R4's positive count is its control. `tmux`, `ssh`, `gh`, `systemd-run` and `launchctl` are poisoned: the rehearsal runs on a box whose tmux server holds the live fleet.
- The crash `ln` is Task 3's stub, armed by `$H/fixture-ln-crash`: the real `ln` unless its last argument is `$HOME/ccrc`, and then `kill -KILL "$PPID"`. `_plat_ln_swap`'s `ln -sfn -- … $HOME/ccrc.new` passes through it.
- The record's format, one `### R<k>: <step>` per step, in this order:
  - R1: place `N-1` as a real directory by its own spine;
  - R2: a crash inside the window (this checkout's `ccrc install` with the crash `ln` armed);
  - R2v (*added*): `versions` from the placed `$U` while crashed;
  - R3: the completion (the same command, unarmed — the resume line before the banner, then the doctor tail's verdict on `.migrating`);
  - R4: one flip — `update --to N`, whose spine predates W6: the legacy-target line, the gate, and `update: previous: untagged (<sha>) — …`. *Correction: the skeleton wrote `previous: untagged-…`.* `~/.ccrc/previous` records wave 4's D-3231 line `untagged`/`<sha>`, never the version directory's name;
  - R5: a second flip — `update --to N-1 --downgrade`, making `previous` = `N`, which is kept;
  - R6: one rollback by arm 1 — `rollback`, bare. No release URL in its `curl` log; `$H/ccrc` → `N`; `/health`'s version = `N`;
  - R7: `versions` (R7a), `channel` (R7ch), `versions --prune` (R7b), and `CCRC_VERSIONS_KEEP=1 versions --prune` (R7c). *Added:* a server-role fixture box has a projection only if its own server writes one, and `_ver_protect` reads an absent one as `unreadable (absent)` and prunes nothing (D-3447). *Corrected against Task 5's `_ver_gc`:* R7b cannot record that refusal. Its default keep of 3 is above the 2 complete versions beside the pointed-at one, so step 3 (D-3450) returns rc 0 with `versions: nothing to prune — 2 complete version(s) …` before it reads `previous`, the projection or the service manager. R7c's keep of 1 is the first prune that measures its inputs, and with no projection it would be skipped. So when R7ch reads no in-force projection, the fixture plants an in-force one, and R7ch2 reads it before R7c prunes. The absent projection is still recorded, in R7a's `versions: WARN: … — nothing would be pruned` line and in R7ch.
  Each step records the exact command (scrubbed to `$S`/`$H`/`$REPO`), its exit code, the transcript lines that decide it (verbatim), and the measured state after. The state is the `ccrc*` entries of `$H` with their types and link targets, each version directory's kept copies, `previous`, `migrating-to`, the stamp, the install record, the unit's state, `/health` and `update.json`. *Correction: the skeleton's `ls -la $H` prints the owner and group columns, which are the operator's username, a residue class; `find -printf '%y %f %l'` says the same without them.* A step whose outcome differs from its expectation is recorded as it happened, and the plan gains a finding before this task closes (Step 14).
- The environment's own doctor verdict is measured, not assumed. R1's doctor FAIL checks come from `N-1`'s doctor, before any W6 code has run, and they are the fixture environment's baseline. A later FAIL outside that set is named per step and judged in Step 14.
- The live half is listed for the coordinator, who runs it at rollout, fleet node first. Each command is spelled with the roles `<fleet-box>`/`<server-box>`, never a real host: `ccrc rollout --check` before; `ccrc rollout --to <W6_TAG>`; `ccrc rollout --check` after; `ssh <fleet-box> ccrc versions`, then `ssh <server-box> ccrc versions`. Each is expected to read `$HOME/ccrc -> $HOME/ccrc-versions/<W6_TAG>` and `~/ccrc.migrating … kept until a health gate passes` (D-3431: the first move is driven by each box's pre-W6 updater). *Added (Task 3's review):* before that next move, each box's `~/ccrc` and `~/ccrc.migrating` are read with `find -maxdepth 0 -printf '%y %p -> %l'`, because the first move's parent is wave 4's and cannot repair the two shapes D-3438 names. *Added:* then `ccrc rollout --to <W6_TAG> --force`, the first move a W6 updater makes, whose gate removes `~/ccrc.migrating` on each box. No live rollback is part of the rehearsal unless the operator rules one.
- No §18 row: the fixture suites of Tasks 1–7 carry every row. This task's controls are measurements whose failure would make a green record vacuous:
  - the crash stub bites only when armed (Step 4);
  - the `curl` recorder is live (R4's release fetches counted beside R6's zero);
  - the live box is byte-for-byte what it was (Steps 4 and 12).

- What this rehearsal cannot measure (D-3455, found planning this task — the coordinator adds it to *Deviations found* and numbers it): the fixture half runs before this wave merges, so every published release predates W6. `N` and `N-1` are only ever SPINES here, each on D-3440's path, and the W6 code runs from this checkout and its placed copy `$U`. What a W6 release artifact's own spine does on a real box is first measured on real bytes by the live half:
  - `_inst_tree` placing a tag-named directory from a staged tarball and flipping to it (Task 2's case (d) under `update`);
  - arm 1 into a W6-placed version's offline spine (D-3427);
  - a W6 updater's legacy check answering "not legacy".
  The fixture suites of Tasks 2 and 4 carry those rows.

Every command block below is one foreground call (timeout ≥ 600000 ms). `SCRATCHPAD` is this session's scratchpad directory, the one the system prompt names; export it at the top of each call (`export SCRATCHPAD=<that path>`), and run from the repo root. A step that exits outside its expected set stops the run. Record it (Steps 12–13) before deciding whether to go on.

- [ ] **Step 1: Preconditions — this branch, and the two real artifacts**

```bash
git status --porcelain
git log --oneline -12
grep -c '^BOX_VERSIONS_ROOT=' ccd/ccrc
grep -c '^_plat_ln_swap() {' ccd/ccrc ccd/ccd
grep -c '<!-- REHEARSAL RECORD: task 8 -->' docs/superpowers/plans/2026-09-23-centralised-update-w6-versioned-installs.md
gh release list --limit 2 --json tagName,isPrerelease,publishedAt --jq '.[] | "\(.tagName) \(.isPrerelease) \(.publishedAt)"'
```
Expected: no `git status` output; Tasks 1–7's commits in the log; `1`; `ccd/ccrc:1` and `ccd/ccd:1`; `1`; two lines, newest first. `gh release list` only reads. The first line's tag is `N`, the second's `N-1`.

Then measure both artifacts (the worker's own shell, real `curl`, into scratch):
```bash
N=<the first tag above>; N1=<the second>
printf '%s\n%s\n' "$N1" "$N" | sort -V -C && [ "$N" != "$N1" ] && echo "N-1 < N"
OWNER="$(sed -n 's/^CCRC_RELEASE_OWNER="\([^"]*\)"$/\1/p' ccd/ccrc)"; REPONAME="$(sed -n 's/^CCRC_RELEASE_REPO="\([^"]*\)"$/\1/p' ccd/ccrc)"
BASE="https://github.com/$OWNER/$REPONAME/releases"
P="$SCRATCHPAD/w6-probe"; rm -rf "$P"
for t in "$N1" "$N"; do
  mkdir -p "$P/$t/tree"
  curl -fsSL -o "$P/$t/SHA256SUMS" "$BASE/download/$t/SHA256SUMS" \
    && curl -fsSL -o "$P/$t/ccrc-$t.tar.gz" "$BASE/download/$t/ccrc-$t.tar.gz" \
    && curl -fsSL -o "$P/$t/ccrc-$t.tar.gz.sigstore.json" "$BASE/download/$t/ccrc-$t.tar.gz.sigstore.json" \
    && (cd "$P/$t" && sha256sum -c SHA256SUMS) \
    && tar -xzf "$P/$t/ccrc-$t.tar.gz" -C "$P/$t/tree" \
    && printf '%s: BOX_VERSIONS_ROOT= lines in its ccd/ccrc: %s\n' "$t" "$(grep -c '^BOX_VERSIONS_ROOT=' "$P/$t/tree/ccd/ccrc")" \
    || echo "$t: NOT USABLE — read the lines above"
done
```
Expected: `N-1 < N`; for each tag, `ccrc-<tag>.tar.gz: OK`, then `<tag>: BOX_VERSIONS_ROOT= lines in its ccd/ccrc: 0`. A `1` means that release already carries W6: the legacy-target lines R4 and R5 expect cannot print, so stop and report. A missing bundle means `update --to` would need `--allow-unsigned`, so stop and report: this rehearsal does not pass it. The probe is not the harness; R1 fetches `N-1` again through `install.sh`.

- [ ] **Step 2: Build this checkout — R2's and R3's source**

```bash
(cd server && { test -d node_modules || npm ci --no-audit --no-fund; } && npm run build)
(cd pwa && { test -d node_modules || npm ci --no-audit --no-fund; } && npm run build)
test -f server/dist/server/src/index.js && test -f server/dist-pwa/index.html && echo built
git status --porcelain
```
Expected: `built`, and no `git status` output (`server/dist/`, `server/dist-pwa/` and `node_modules` are gitignored). A dirty tree would stamp R3's install `dirty`, and `_inst_version_name` would still name it `U`, so the record would not say what was installed: stop and clean it first.

- [ ] **Step 3: Plant the harness**

Write the planter and the record assembler into the scratchpad. The planter writes only under `$SCRATCHPAD/w6-rehearsal` and refuses when that already exists:

```bash
cat > "$SCRATCHPAD/w6-plant.sh" <<'PLANT'
#!/usr/bin/env bash
# plant.sh <repo> <N> <N-1> — plant the W6 rehearsal's scratch harness (plan Task 8, Step 3).
# Writes ONLY under $SCRATCHPAD/w6-rehearsal: the fixture HOME, the stubs, the recorder, the logs.
set -uo pipefail
: "${SCRATCHPAD:?export SCRATCHPAD=<the scratchpad directory of this session> first}"
[ "$#" -eq 3 ] || { echo "usage: plant.sh <repo> <N> <N-1>" >&2; exit 2; }
REPO="$(cd "$1" && pwd -P)" || exit 1
N="$2"; N1="$3"
S="$(cd "$SCRATCHPAD" && pwd -P)/w6-rehearsal" || exit 1
[ ! -e "$S" ] || { echo "plant: $S already exists — a rehearsal is recorded once; move it aside first" >&2; exit 1; }
H="$S/home"
case "$H/" in "$HOME/"*) echo "plant: the fixture HOME would sit under the live \$HOME — refusing" >&2; exit 1 ;; esac
mkdir -p "$S/bin" "$S/logs" "$S/run" "$S/tmp" "$S/tmux" "$H/.ccrc" "$H/projects" || exit 1
chmod 700 "$S/tmux" || exit 1

# The release base the PRODUCT derives (ccd/ccrc's own two lines), never spelled in the plan.
OWNER="$(sed -n 's/^CCRC_RELEASE_OWNER="\([^"]*\)"$/\1/p' "$REPO/ccd/ccrc")"
REPONAME="$(sed -n 's/^CCRC_RELEASE_REPO="\([^"]*\)"$/\1/p' "$REPO/ccd/ccrc")"
case "$OWNER|$REPONAME" in
  *$'\n'*|'|'*|*'|') echo "plant: ccd/ccrc's CCRC_RELEASE_OWNER=/CCRC_RELEASE_REPO= lines did not read as exactly one each" >&2; exit 1 ;;
esac
REPO_URL="https://github.com/$OWNER/$REPONAME"
BASE="$REPO_URL/releases"

# node/npm from wherever this shell finds them — but never from the live ~/.local/bin, whose ccd and
# ccrc a fixture call by name could then reach.
NODE="$(command -v node)" || { echo "plant: no node on PATH" >&2; exit 1; }
NODE_DIR="$(cd "${NODE%/*}" && pwd -P)" || exit 1
case "$NODE_DIR/" in "$HOME/.local/bin/"*) echo "plant: node resolves from the live ~/.local/bin — refusing" >&2; exit 1 ;; esac
SYS_PATH="$NODE_DIR:/usr/local/bin:/usr/bin:/bin"
REAL_LN="$(command -v ln)" && REAL_CURL="$(command -v curl)" || { echo "plant: ln or curl not on PATH" >&2; exit 1; }
PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')" \
  || { echo "plant: could not pick a free loopback port" >&2; exit 1; }
U="untagged-$(git -C "$REPO" rev-parse HEAD | cut -c1-12)"
[[ "$U" =~ ^untagged-[0-9a-f]{12}$ ]] || { echo "plant: could not read the checkout's sha" >&2; exit 1; }

{
  echo '# W6 rehearsal environment — written once by plant.sh; every rehearsal call sources it.'
  for v in S H REPO N N1 U PORT OWNER REPO_URL BASE NODE_DIR SYS_PATH REAL_LN REAL_CURL; do
    printf '%s=%q\n' "$v" "${!v}"
  done
  printf 'REAL_HOME=%q\n' "$HOME"
  printf 'REAL_USER=%q\n' "$(id -un)"
} > "$S/env.sh" || exit 1

# The fixture box's config, seeded BEFORE the first install so seed-once keeps it: role server, loopback,
# a free port, local fleet mode, a projects root inside the fixture.
cat > "$H/.ccrc/ccrc.env" <<EOF || exit 1
# W6 rehearsal fixture — seeded before the first install; ccrc install keeps it (seed-once).
CCRC_HOST=127.0.0.1
CCRC_PORT=$PORT
CCRC_FLEET=local
CCRC_PROJECTS_ROOT=$H/projects
CCRC_ROLE=server
EOF

stub() {   # stub <name>: stdin is the body, @S@ / @REAL_LN@ / @REAL_CURL@ filled in, made executable
  sed -e "s|@S@|$S|g" -e "s|@REAL_LN@|$REAL_LN|g" -e "s|@REAL_CURL@|$REAL_CURL|g" > "$S/bin/$1" \
    && chmod 755 "$S/bin/$1"
}

stub systemctl <<'EOF'
#!/usr/bin/env bash
# The rehearsal's systemctl (spec §11: "a fixture HOME with stub systemctl"). It RUNS ccrc.service —
# the placed unit's own ExecStart, %h expanded, under the fixture HOME and its ccrc.env — so /health
# answers the stamp the box really holds. Everything else answers from this script. Every call is logged.
. "@S@/env.sh"
printf '%s\t%s\n' "$(cat "$S/logs/current-step" 2>/dev/null)" "$*" >> "$S/logs/systemctl-argv"
PIDF="$S/run/ccrc.pid"
UNIT="$H/.config/systemd/user/ccrc.service"
alive() { [ -s "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; }
execstart() {
  local l
  [ -f "$UNIT" ] || return 1
  l="$(grep -m1 '^ExecStart=' "$UNIT")" || return 1
  l="${l#ExecStart=}"
  printf '%s\n' "${l//%h/$H}"
}
stop_main() {
  local p i
  if alive; then
    p="$(cat "$PIDF")"
    kill "$p" 2>/dev/null
    for i in $(seq 1 50); do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done
    kill -0 "$p" 2>/dev/null && kill -KILL "$p" 2>/dev/null
  fi
  rm -f "$PIDF"
  return 0
}
start_main() {
  local cmd l f i
  local -a argv=() envs=()
  cmd="$(execstart)" || { echo "fixture systemctl: no ccrc.service unit at $UNIT" >&2; return 1; }
  stop_main
  read -r -a argv <<< "$cmd"
  for f in "$H/.ccrc/ccrc.env" "$H/.ccrc/exposure.env"; do
    [ -f "$f" ] || continue
    while IFS= read -r l; do
      case "$l" in [A-Za-z_]*=*) envs+=("$l") ;; esac
    done < "$f"
  done
  # Its own session, so nothing that reaps this call's process group reaps the server; the pid is
  # written by the process that then becomes node (exec, same pid), whether or not setsid forked.
  setsid bash -c 'printf "%s\n" "$$" > "$1"; shift; exec "$@"' _ "$PIDF" \
    env -i HOME="$H" USER="$REAL_USER" LOGNAME="$REAL_USER" LANG=C.UTF-8 \
    PATH="$S/bin:$H/.local/bin:$SYS_PATH" TMUX_TMPDIR="$S/tmux" "${envs[@]}" "${argv[@]}" \
    >> "$S/logs/ccrc-service.log" 2>&1 < /dev/null &
  for i in $(seq 1 50); do [ -s "$PIDF" ] && break; sleep 0.1; done
  alive
}
if [ "${1:-}" != --user ]; then   # system scope: this box runs no system units (caddy included)
  case "${1:-}" in is-active) echo inactive; exit 3 ;; *) exit 0 ;; esac
fi
shift
verb="${1:-}"; [ "$#" -gt 0 ] && shift
case "$verb" in
  enable|disable)
    now=0; units=()
    for a in "$@"; do case "$a" in --now) now=1 ;; -*) ;; *) units+=("$a") ;; esac; done
    for u in "${units[@]}"; do
      [ "$u" = ccrc.service ] && [ "$now" = 1 ] || continue
      if [ "$verb" = enable ]; then alive || start_main || exit 1; else stop_main; fi
    done
    exit 0 ;;
  start)       [ "${1:-}" = ccrc.service ] || exit 0; alive || start_main; exit $? ;;
  restart)     [ "${1:-}" = ccrc.service ] || exit 0; start_main; exit $? ;;
  try-restart) for u in "$@"; do [ "$u" = ccrc.service ] && alive && { start_main || exit 1; }; done; exit 0 ;;
  stop)        [ "${1:-}" = ccrc.service ] && stop_main; exit 0 ;;
  is-active)
    case "${1:-}" in
      ccrc.service) if alive; then echo active; exit 0; fi; echo inactive; exit 3 ;;
      ccrc-agent.service) echo inactive; exit 3 ;;   # a server box has no agent
      *) echo active; exit 0 ;;                      # every other unit: up (no real systemd here)
    esac ;;
  is-enabled) echo enabled; exit 0 ;;
  show)
    prop=""; value=0; unit=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -p) prop="${2:-}"; shift; [ "$#" -gt 0 ] && shift ;;
        --property=*) prop="${1#--property=}"; shift ;;
        --value) value=1; shift ;;
        *) unit="$1"; shift ;;
      esac
    done
    case "$prop" in
      MainPID)
        p=0; [ "$unit" = ccrc.service ] && alive && p="$(cat "$PIDF")"
        if [ "$value" = 1 ]; then echo "$p"; else echo "MainPID=$p"; fi ;;
      ExecStart)   # systemd's struct form; the tree path is in argv[], path= is the interpreter
        if [ "$unit" = ccrc.service ] && cmd="$(execstart)"; then
          echo "ExecStart={ path=${cmd%% *} ; argv[]=$cmd ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }"
        else
          echo "ExecStart="
        fi ;;
      KillMode) if [ "$value" = 1 ]; then echo process; else echo KillMode=process; fi ;;
    esac
    exit 0 ;;
  *) exit 0 ;;   # daemon-reload, reset-failed, list-units (empty: no claude-session@ here), status, …
esac
EOF

stub loginctl <<'EOF'
#!/usr/bin/env bash
# The rehearsal's loginctl: linger reads as enabled, and nothing reaches the live user's logind.
printf '%s\t%s\n' "$(cat "@S@/logs/current-step" 2>/dev/null)" "$*" >> "@S@/logs/loginctl-argv"
case "${1:-}" in show-user) echo "Linger=yes" ;; esac
exit 0
EOF

stub journalctl <<'EOF'
#!/usr/bin/env bash
# The rehearsal's journalctl: never the live user's journal.
printf '%s\t%s\n' "$(cat "@S@/logs/current-step" 2>/dev/null)" "$*" >> "@S@/logs/journalctl-argv"
echo "-- fixture: no journal (the service's output is in the rehearsal's logs/ccrc-service.log) --"
exit 0
EOF

stub ln <<'EOF'
#!/usr/bin/env bash
# Task 3's crash stub: the real ln, unless its last argument is $HOME/ccrc and $HOME/fixture-ln-crash
# exists — then it SIGKILLs the ccrc that ran it (the migration's `ln -sn` runs in ccrc's own shell, so
# that is $PPID), inside the migration's two-syscall window, and places no link.
if [ "$#" -gt 0 ] && [ "${!#}" = "$HOME/ccrc" ] && [ -e "$HOME/fixture-ln-crash" ]; then
  printf '%s\tln %s (SIGKILL to pid %s)\n' "$(cat "@S@/logs/current-step" 2>/dev/null)" "$*" "$PPID" >> "@S@/logs/ln-crash"
  kill -KILL "$PPID"
  exit 137
fi
exec "@REAL_LN@" "$@"
EOF

stub curl <<'EOF'
#!/usr/bin/env bash
# The rehearsal's curl: the real one, every argv recorded under the step that ran it — what measures
# "no download" (a step whose lines name no release URL) against the steps that did download.
printf '%s\t%s\n' "$(cat "@S@/logs/current-step" 2>/dev/null)" "$*" >> "@S@/logs/curl-argv"
exec "@REAL_CURL@" "$@"
EOF

for p in tmux ssh gh systemd-run launchctl; do
  stub "$p" <<'EOF'
#!/usr/bin/env bash
# Poisoned in the rehearsal: nothing here may reach the live fleet, its tmux server or a real host.
printf '%s\t%s %s\n' "$(cat "@S@/logs/current-step" 2>/dev/null)" "${0##*/}" "$*" >> "@S@/logs/poison"
echo "rehearsal: ${0##*/} is poisoned here" >&2
exit 90
EOF
done

cat > "$S/scrub.sh" <<'EOF' && chmod 755 "$S/scrub.sh" || exit 1
#!/usr/bin/env bash
# scrub.sh — stdin to stdout with every scratch path, the live home, the operator's name, the release
# host's URL and the fixture port replaced by a name, longest first. What reaches the plan passes this.
. "${BASH_SOURCE[0]%/*}/env.sh"
export S H REPO BASE REPO_URL OWNER PORT REAL_HOME REAL_USER
exec python3 -c '
import os, sys
e = os.environ
pairs = [(e["BASE"], "$BASE"), (e["REPO_URL"], "$REPO_URL"), (e["H"], "$H"), (e["S"], "$S"),
         (e["REPO"], "$REPO"), (e["REAL_HOME"], "$REAL_HOME"), (e["OWNER"], "$OWNER"),
         (e["REAL_USER"], "$REAL_USER"), (":" + e["PORT"], ":$PORT")]
pairs.sort(key=lambda p: -len(p[0]))
t = sys.stdin.read()
for a, b in pairs:
    t = t.replace(a, b)
sys.stdout.write(t)'
EOF

cat > "$S/run.sh" <<'EOF' && chmod 755 "$S/run.sh" || exit 1
#!/usr/bin/env bash
# run.sh <label> <command…> — one rehearsal command, under the fixture environment ONLY (env -i: no
# TMUX, no live PATH, no live HOME), its output kept raw and scrubbed, its exit code kept.
set -uo pipefail
. "${BASH_SOURCE[0]%/*}/env.sh"
label="$1"; shift
printf '%s\n' "$label" > "$S/logs/current-step"
printf '%s\n' "$*" | "$S/scrub.sh" > "$S/logs/$label.cmd"
rc=0
env -i HOME="$H" USER="$REAL_USER" LOGNAME="$REAL_USER" LANG=C.UTF-8 TERM=dumb \
  PATH="$S/bin:$H/.local/bin:$SYS_PATH" TMPDIR="$S/tmp" TMUX_TMPDIR="$S/tmux" \
  CCRC_RELEASE_BASE_URL="$BASE" CCRC_UPDATE_HEALTH_S=30 \
  "$@" > "$S/logs/$label.raw" 2>&1 < /dev/null || rc=$?
printf '%s\n' "$rc" > "$S/logs/$label.rc"
"$S/scrub.sh" < "$S/logs/$label.raw" > "$S/logs/$label.log"
echo "== $label: exit $rc"
cat "$S/logs/$label.log"
EOF

cat > "$S/state.sh" <<'EOF' && chmod 755 "$S/state.sh" || exit 1
#!/usr/bin/env bash
# state.sh <label> — the fixture box as measured after a step, scrubbed, into logs/<label>.state.
set -uo pipefail
. "${BASH_SOURCE[0]%/*}/env.sh"
label="$1"
{
  echo "entries of \$H named ccrc* (type name link-target):"
  find "$H" -maxdepth 1 -name 'ccrc*' -printf '  %y %f %l\n' | LC_ALL=C sort
  printf 'ccrc-versions:'; for d in "$H"/ccrc-versions/*/; do
    [ -d "$d" ] || continue; v="${d%/}"; v="${v##*/}"
    printf ' %s[%s]' "$v" "$( { [ -f "$d/.ccrc-stamp.json" ] && printf 'stamp'; [ -f "$d/.ccrc-installed" ] && printf ',record'; } )"
  done; echo
  printf 'previous: %s\n' "$(tr '\n' ' ' 2>/dev/null < "$H/.ccrc/previous" || echo '(none)')"
  printf 'migrating-to: %s\n' "$(cat "$H/.ccrc/migrating-to" 2>/dev/null || echo '(none)')"
  printf 'stamp: %s\n' "$(jq -c '{version, sha}' "$H/.ccrc/build.json" 2>/dev/null || echo '(none)')"
  printf 'installed: %s\n' "$(tr '\n' ' ' 2>/dev/null < "$H/.ccrc/installed" || echo '(none)')"
  printf 'ccrc.service: %s\n' "$("$S/bin/systemctl" --user is-active ccrc.service)"
  printf 'health: %s\n' "$("$REAL_CURL" -s -m 5 "http://127.0.0.1:$PORT/health" | jq -c '{version, sha: .build.sha}' 2>/dev/null || echo '(no answer)')"
  printf 'update.json: %s\n' "$(jq -c '{phase, target, from, detail}' "$H/.ccrc/update.json" 2>/dev/null || echo '(none)')"
} 2>&1 | "$S/scrub.sh" | tee "$S/logs/$label.state"
EOF

cat > "$S/live-probe.sh" <<'EOF' && chmod 755 "$S/live-probe.sh" || exit 1
#!/usr/bin/env bash
# live-probe.sh — the LIVE box's tree and install state, READ-ONLY: what the rehearsal must leave exactly
# as it found it. Its output stays in the scratch logs (it names the live home); only its equality is recorded.
. "${BASH_SOURCE[0]%/*}/env.sh"
h="$REAL_HOME"
if [ -L "$h/ccrc" ]; then printf 'ccrc: link %s\n' "$(readlink "$h/ccrc")"
elif [ -d "$h/ccrc" ]; then printf 'ccrc: directory, inode+mtime %s\n' "$(stat -c '%i %Y' "$h/ccrc")"
else echo 'ccrc: absent'; fi
for n in ccrc-versions ccrc.migrating; do
  if [ -e "$h/$n" ] || [ -L "$h/$n" ]; then echo "$n: present"; else echo "$n: absent"; fi
done
for f in .ccrc/build.json .ccrc/installed .ccrc/previous; do
  if [ -f "$h/$f" ]; then printf '%s: %s\n' "$f" "$(sha256sum < "$h/$f" | cut -c1-64)"; else echo "$f: absent"; fi
done
EOF

echo "planted $S: N=$N N-1=$N1 U=$U port=$PORT"
PLANT
```

````bash
cat > "$SCRATCHPAD/w6-record.py" <<'PY'
#!/usr/bin/env python3
"""record.py <plan.md> — assemble the W6 rehearsal record from $S/logs and put it in the plan.

Run with env.sh's variables exported (`set -a; . "$S/env.sh"; set +a`). Reads only what run.sh and
state.sh wrote — every transcript line it quotes is a scrubbed line the run printed, matched by the
expectations below, never retyped — and replaces the plan's one `<!-- REHEARSAL RECORD: task 8 -->` line
with $S/logs/header.md followed by the record. Refuses, editing nothing, when the marker is not there exactly once, when a step the
record needs was never run, or when the finished text still carries a scratch path, the live home, the
operator's name or the release host's owner."""
import os, re, sys, pathlib

E = os.environ
S, N, N1, U = E['S'], E['N'], E['N1'], E['U']
LOGS = pathlib.Path(S) / 'logs'
q = re.escape
MARK = '<!-- REHEARSAL RECORD: task 8 -->'

# (label, title, exit codes the step may end with, checks). A check is (what, kind, pattern[, pattern2]):
# 'line' a transcript line must match; 'no-line' none may; 'before' a line matching the first precedes
# one matching the second; 'state' a line of the measured state must match; 'no-state' none may.
STEPS = [
  ('R1', f'`{N1}` placed as a real directory by its own spine', {0, 1}, [
    ('install.sh verified the artifact and handed off', 'line', rf"^install\.sh: verified ccrc-{q(N1)}\.tar\.gz — handing off to the staged 'ccrc install'$"),
    ('the pre-W6 spine placed the tree at the live name', 'line', r'^install: tree: placed at \$HOME/ccrc$'),
    ('the spine reached its landing line', 'line', r'^install: done — '),
    ('~/ccrc is a real directory', 'state', r'^  d ccrc $'),
    (f'/health answers {N1}', 'state', rf'^health: .*"version":"{q(N1)}"'),
  ]),
  ('R2', 'a crash inside the migration window', {137}, [
    (f'{U} was placed beside the running tree', 'line', rf'^install: tree: placed {q(U)} at \$HOME/ccrc-versions/{q(U)}$'),
    ('the migration began', 'line', rf'^install: tree: migrating — \$HOME/ccrc is a directory; {q(U)} is complete at \$HOME/ccrc-versions/{q(U)}$'),
    ('the link was never announced', 'no-line', r'the pre-versioned tree is kept at \$HOME/ccrc\.migrating'),
    ('no ~/ccrc at all', 'no-state', r'^  [dlf] ccrc $|^  l ccrc '),
    ('the old tree is at ~/ccrc.migrating', 'state', r'^  d ccrc\.migrating $'),
    (f'~/.ccrc/migrating-to names {U}', 'state', rf'^migrating-to: {q(U)}$'),
    (f'the old server still answers {N1} from the moved tree', 'state', rf'^health: .*"version":"{q(N1)}"'),
  ]),
  ('R2v', '`versions` from the placed version, while the migration is crashed', {0}, [
    # Task 5 (review round): the remedy names the placed version's own ccrc by its path — the shim on PATH cannot run here, and deploy.sh would place a second tree.
    ('the listing names the crash and a remedy that can run', 'line', rf'^versions: a migration crashed — \$HOME/ccrc is absent beside \$HOME/ccrc\.migrating; run bash \$HOME/ccrc-versions/{q(U)}/ccd/ccrc install \(or bash install\.sh from a ccrc checkout\) to complete it — the ccrc on PATH cannot run until then, and deploy\.sh would place a second tree beside it$'),
    (f'{U} is listed, incomplete (its record is written by the install that completes it)', 'line', rf'^    {q(U)}  incomplete  '),
  ]),
  ('R3', 'the completion', {0, 1}, [
    ('the crashed migration was completed from the marker', 'line', rf'^install: tree: completed a crashed migration — \$HOME/ccrc was absent beside \$HOME/ccrc\.migrating; linked to \$HOME/ccrc-versions/{q(U)} \(named by ~/\.ccrc/migrating-to\)$'),
    ('…before the banner, i.e. before anything else', 'before', r'^install: tree: completed a crashed migration', r'^install: box: '),
    ('the tree was reinstalled in place', 'line', rf'^install: tree: reinstalled {q(U)} in place at \$HOME/ccrc-versions/{q(U)} '),
    ('the version kept its stamp and record', 'line', rf"^install: versions: kept {q(U)}'s stamp and install record in \$HOME/ccrc-versions/{q(U)} — what a flip back restores$"),
    ('the doctor tail decided ~/ccrc.migrating', 'line', r'^install: migration: \$HOME/ccrc\.migrating (removed — ccrc doctor passed; a plain install is its own gate|kept — ccrc doctor did not pass; the next install or update whose gate passes removes it)$'),
    (f'~/ccrc -> {U}', 'state', rf'^  l ccrc .*/ccrc-versions/{q(U)}$'),
  ]),
  ('R4', f'one flip — `update --to {N}`, whose spine predates W6', {0, 3}, [
    ('previous records the untagged build it replaces', 'line', r"^update: previous: untagged \([0-9a-f]{40}\) — this build carries no release tag, so an automatic restore of it is arm 3 and a bare 'ccrc rollback' refuses \(name one with --to\)$"),
    ('the older spine got a directory named for its own tag', 'line', rf"^update: tree: {q(N)}'s spine predates versioned installs and writes through \$HOME/ccrc — \$HOME/ccrc now points at \$HOME/ccrc-versions/{q(N)} \(a copy of {q(U)}\) for it to write into$"),
    (f"{N}'s own spine wrote through the link", 'line', r'^install: tree: placed at \$HOME/ccrc$'),
    (f'{N} kept its stamp and record', 'line', rf"^update: versions: kept {q(N)}'s stamp and install record in \$HOME/ccrc-versions/{q(N)} — what a flip back restores$"),
    (f'the health gate passed on {N}', 'line', rf'^update: gate: server answers on {q(N)} \('),
    (f'~/ccrc -> {N}', 'state', rf'^  l ccrc .*/ccrc-versions/{q(N)}$'),
    (f'/health answers {N}', 'state', rf'^health: .*"version":"{q(N)}"'),
    ('no ~/ccrc.migrating once a gate has passed', 'no-state', r'^  d ccrc\.migrating $'),
  ]),
  ('R5', f'a second flip — `update --to {N1} --downgrade`', {0, 3}, [
    (f'previous records {N}', 'line', rf"^update: previous: {q(N)} \([0-9a-f]{{40}}\) — the tag a restore or a bare 'ccrc rollback' returns to$"),
    ('the older spine got a directory named for its own tag', 'line', rf"^update: tree: {q(N1)}'s spine predates versioned installs and writes through \$HOME/ccrc — \$HOME/ccrc now points at \$HOME/ccrc-versions/{q(N1)} \(a copy of {q(N)}\) for it to write into$"),
    (f'{N1} kept its stamp and record', 'line', rf"^update: versions: kept {q(N1)}'s stamp and install record in \$HOME/ccrc-versions/{q(N1)} — what a flip back restores$"),
    (f'the health gate passed on {N1}', 'line', rf'^update: gate: server answers on {q(N1)} \('),
    (f'~/ccrc -> {N1}', 'state', rf'^  l ccrc .*/ccrc-versions/{q(N1)}$'),
    (f'/health answers {N1}', 'state', rf'^health: .*"version":"{q(N1)}"'),
    (f'previous is {N}', 'state', rf'^previous: {q(N)} '),
  ]),
  ('R6', f'one rollback by arm 1 — bare `rollback`, back to the kept `{N}`', {0}, [
    ('the kept version answered the existence question', 'line', rf'^rollback: {q(N)} is kept at \$HOME/ccrc-versions/{q(N)} — no release-host question and no download$'),
    ('the flip restored the stamp and record and re-ran the kept spine', 'line', rf'^rollback: flip: \$HOME/ccrc -> \$HOME/ccrc-versions/{q(N)}; its stamp and install record restored; its own spine re-placed the executables, hooks and units \(no release download\)$'),
    (f'the gate ran once more, on {N}', 'line', rf'^update: gate: server answers on {q(N)} \('),
    ('the rollback closed by flip', 'line', rf'^rollback: this box runs {q(N)} again — flipped back to \$HOME/ccrc-versions/{q(N)}, no download$'),
    (f'~/ccrc -> {N}', 'state', rf'^  l ccrc .*/ccrc-versions/{q(N)}$'),
    (f'/health answers {N}', 'state', rf'^health: .*"version":"{q(N)}"'),
    ('update.json closed done, from rollback', 'state', rf'^update\.json: .*"phase":"done".*"target":"{q(N)}".*"from":"rollback"'),
  ]),
  ('R7a', '`versions`, the listing', {0}, [
    (f'line 1 names the pointed-at {N}', 'line', rf'^versions: \$HOME/ccrc -> \$HOME/ccrc-versions/{q(N)}$'),
    (f'{N} is marked and kept', 'line', rf'^  \* {q(N)}  complete  kept: '),
    (f'{N1} is listed', 'line', rf'^    {q(N1)}  complete  '),
    (f'{U} is listed', 'line', rf'^    {q(U)}  complete  '),
    ('the closing count', 'line', r'^versions: 3 kept tree\(s\) under \$HOME/ccrc-versions; CCRC_VERSIONS_KEEP=3 '),
  ]),
  ('R7ch', '`channel` — what the projection reads before the prune', {0, 1}, [
    ('the reader answered', 'line', r'^channel: state='),
  ]),
  ('R7b', '`versions --prune`, the default keep', {0}, [
    ('nothing is prunable within the keep, so nothing was measured', 'line', r'^versions: nothing to prune — 2 complete version\(s\) beside the pointed-at one, within CCRC_VERSIONS_KEEP=3, and none incomplete$'),
    ('nothing was pruned', 'no-line', r'pruned \$HOME/ccrc-versions/'),
    *[(f'{v} remains', 'state', rf'^ccrc-versions:.* {q(v)}\[') for v in (N, N1, U)],
  ]),
  ('R7ch2', "`channel` after the fixture planted an in-force projection (the stand-in for W2's server-role writer)", {0}, [
    ('the planted projection reads ok', 'line', rf'^channel: state=ok channel=stable desired={q(N)} '),
  ]),
  ('R7c', '`CCRC_VERSIONS_KEEP=1 versions --prune`', {0}, [
    (f'{U} — complete, unprotected, older — was pruned', 'line', rf'^versions: pruned \$HOME/ccrc-versions/{q(U)} \(complete, not among the newest 1\)$'),
    (f'{N} (protected) was not', 'no-line', rf'pruned \$HOME/ccrc-versions/{q(N)} '),
    (f'{N1} (the newest unprotected) was not', 'no-line', rf'pruned \$HOME/ccrc-versions/{q(N1)} '),
    *[(f'{v} remains, complete', 'state', rf'^ccrc-versions:.* {q(v)}\[stamp,record\]') for v in (N, N1)],
    (f'{U} is gone', 'no-state', rf'^ccrc-versions:.* {q(U)}\['),
  ]),
]

LIVE = """### The live half — the coordinator's, at rollout (not run here)

Fleet node first, from a machine holding `~/.ccrc/deploy.env`, each box named by its role. The merge cuts a
PRERELEASE, so a bare `rollout` would not reach it:

```bash
W6_TAG="$(gh release list --limit 1 --json tagName --jq '.[0].tagName')"; echo "$W6_TAG"
ccrc rollout --check
ccrc rollout --to "$W6_TAG"
ccrc rollout --check
ssh <fleet-box> ccrc versions
ssh <server-box> ccrc versions
```

Expected: the second `--check` shows both boxes on `W6_TAG` with `versions` in their `caps=`; each box's
`versions` reads `versions: $HOME/ccrc -> $HOME/ccrc-versions/<W6_TAG>` and then
`versions: $HOME/ccrc.migrating (the pre-versioned tree) is kept until a health gate passes` — this first move is
made by each box's pre-W6 updater, which holds `~/.ccrc/update.lock` while the staged W6 spine runs and whose gate
knows nothing of the migration (D-3431). That parent is also why each box's shape is read
here, before anything else moves it: a wave-4 parent cannot repair the two shapes D-3438
names (added by Task 3's review):

```bash
ssh <fleet-box> "find ~/ccrc ~/ccrc.migrating -maxdepth 0 -printf '%y %p -> %l\\n'; cat ~/.ccrc/migrating-to"
ssh <server-box> "find ~/ccrc ~/ccrc.migrating -maxdepth 0 -printf '%y %p -> %l\\n'; cat ~/.ccrc/migrating-to"
```

Expected: `l <home>/ccrc -> <home>/ccrc-versions/<W6_TAG>` and `d <home>/ccrc.migrating -> `, then `<W6_TAG>`. A `d`
at `~/ccrc` beside `~/ccrc.migrating` is that departure's first hole (the staged spine killed inside the window,
then wave 4's arm 3); a box whose `rollout` transcript shows its gate failing and arm 3 running after the
`install: tree: $HOME/ccrc -> …` line is its second. Either takes the departure's by-hand remedy before the next
move. The next move, made by the W6 updater, removes `~/ccrc.migrating`:

```bash
ccrc rollout --to "$W6_TAG" --force
ssh <fleet-box> ccrc versions
ssh <server-box> ccrc versions
```

Expected: each box's transcript carries `update: migration: $HOME/ccrc.migrating removed — the health gate passed`,
and neither `versions` names `~/ccrc.migrating` any more. No live rollback is part of this unless the operator
rules one.
"""

def read(name):
    p = LOGS / name
    if not p.exists():
        sys.exit(f'REFUSED: {p} is missing — run that step (or its state.sh) first')
    return p.read_text()

def fence(body):
    return '```text\n' + body.rstrip('\n') + '\n```'

out, differs, baseline = [], [], set()
OPTIONAL = {'R7ch2'}   # run only when R7ch read no in-force projection
for label, title, rcs, checks in STEPS:
    if label in OPTIONAL and not (LOGS / f'{label}.rc').exists():
        out += [f'### {label}: {title}', '', 'Not run: R7ch already read an in-force projection, so nothing was planted.', '']
        continue
    log = read(f'{label}.log').split('\n')
    state = read(f'{label}.state').split('\n')
    rc = int(read(f'{label}.rc').strip())
    shown, verdicts = [], []
    for what, kind, pat, *rest in checks:
        rx = re.compile(pat)
        src = state if kind in ('state', 'no-state') else log
        hits = [l for l in src if rx.search(l)]
        if kind == 'before':
            rx2 = re.compile(rest[0])
            i = next((n for n, l in enumerate(log) if rx.search(l)), None)
            j = next((n for n, l in enumerate(log) if rx2.search(l)), None)
            ok = i is not None and j is not None and i < j
        elif kind.startswith('no-'):
            ok = not hits
        else:
            ok = bool(hits)
            if kind == 'line':
                shown += [l for l in hits[:2] if l not in shown]
        verdicts.append(f'- {"yes" if ok else "NO"} — {what}')
        if not ok:
            differs.append(f'{label}: {what}')
    if rc not in rcs:
        differs.append(f'{label}: exit {rc}, expected one of {sorted(rcs)}')
    fails = sorted({m.group(1) for l in log for m in [re.match(r'^FAIL ([a-z0-9-]+):', l)] if m})
    if label == 'R1':
        baseline = set(fails)
    newfails = [f for f in fails if f not in baseline]
    out += [f'### {label}: {title}', '',
            f'Command: `{read(f"{label}.cmd").strip()}` — exit `{rc}` (expected {" or ".join(map(str, sorted(rcs)))}).', '',
            'Deciding lines, verbatim:', '', fence('\n'.join(shown) or '(none of the expected lines printed)'), '',
            *verdicts, f'- doctor FAIL checks in this transcript: {", ".join(fails) or "none"}'
            + ('' if label == 'R1' else f' (not in R1\'s environment baseline: {", ".join(newfails) or "none"})'), '',
            'State after:', '', fence('\n'.join(state)), '']

def curl_lines(label):
    return [l for l in (LOGS / 'curl-argv').read_text().split('\n') if l.startswith(label + '\t')]
base = E['BASE']
r4 = sum(base in l for l in curl_lines('R4')); r6 = sum(base in l for l in curl_lines('R6'))
live = (LOGS / 'live-before').read_bytes() == (LOGS / 'live-after').read_bytes()
poison = (LOGS / 'poison').read_text().count('\n') if (LOGS / 'poison').exists() else 0
if r4 < 1: differs.append('control: the curl recorder saw no release URL in R4, so R6 zero is vacuous')
if r6 != 0: differs.append(f'control: R6 asked the release host {r6} time(s)')
if not live: differs.append('control: the live box probe differs before and after')
out += ['### Controls', '',
        f'- the curl recorder is live: R4 fetched from the release host {r4} time(s) (a zero here would make the next line vacuous);',
        f'- R6, the rollback by arm 1, asked the release host {r6} time(s);',
        f'- the live box (its `~/ccrc`, `~/ccrc-versions`, `~/ccrc.migrating`, `~/.ccrc/build.json`, `~/.ccrc/installed`, `~/.ccrc/previous`) measured {"identical" if live else "DIFFERENT"} before R1 and after R7c;',
        f'- poisoned tools (`tmux`, `ssh`, `gh`, `systemd-run`, `launchctl`) were reached {poison} time(s), each refused.', '',
        '**Outcome:** ' + ('every expectation above held.' if not differs else
                           'DIFFERS — ' + '; '.join(differs) + '. Each is a finding this task records under Deviations found or as a Task-N fix before it closes.'), '']
out += [LIVE]
text = '\n'.join(out)
for k in ('S', 'H', 'REAL_HOME', 'REAL_USER', 'OWNER', 'REPO'):
    if E[k] and E[k] in text:
        sys.exit(f'REFUSED: the record still carries ${k} verbatim — scrub.sh missed it; nothing written')
plan = pathlib.Path(sys.argv[1])
body = plan.read_text()
if body.count(MARK) != 1:
    sys.exit(f'REFUSED: {plan} carries the marker {body.count(MARK)} times, want exactly 1')
header = read('header.md').rstrip('\n') + '\n\n'
plan.write_text(body.replace(MARK, header + text.rstrip('\n')))
print(f'wrote the record into {plan}: {len(STEPS)} steps, {len(differs)} difference(s)')
for d in differs:
    print('  DIFFERS:', d)
PY
````

Then plant, with `N` and `N1` from Step 1:
```bash
bash "$SCRATCHPAD/w6-plant.sh" "$PWD" "$N" "$N1"
. "$SCRATCHPAD/w6-rehearsal/env.sh"; ls "$S/bin"; for f in "$S"/bin/* "$S"/*.sh; do bash -n "$f" || echo "SYNTAX: $f"; done
```
Expected: `planted $SCRATCHPAD/…/w6-rehearsal: N=<N> N-1=<N-1> U=untagged-<12 hex> port=<port>`, then the ten stubs `curl gh journalctl launchctl ln loginctl ssh systemctl systemd-run tmux`, and no `SYNTAX:` line.

- [ ] **Step 4: The controls before anything runs, and the record's header**

The live box's state first, read-only, kept in scratch only:
```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
bash "$S/live-probe.sh" > "$S/logs/live-before"; wc -l < "$S/logs/live-before"
```
Expected: `6`.

The crash stub bites only when armed, and the harness reaches no live tmux:
```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
bash "$S/run.sh" C1 bash -c 'mkdir -p "$HOME/x"; ln -s "$HOME/x" "$HOME/ccrc"; echo "unarmed: linked to $(readlink "$HOME/ccrc")"; rm "$HOME/ccrc"; rmdir "$HOME/x"'
touch "$H/fixture-ln-crash"
bash "$S/run.sh" C2 bash -c 'ln -sfn -- "$HOME/y" "$HOME/ccrc.new"; echo "the swap name passes: $(readlink "$HOME/ccrc.new")"; rm -f "$HOME/ccrc.new"; ln -sn -- "$HOME/y" "$HOME/ccrc"; echo "ARMED STUB DID NOT BITE"'
rm -f "$H/fixture-ln-crash"; { test -e "$H/ccrc" || test -L "$H/ccrc"; } && echo "A LINK WAS LEFT" || echo "no link left"
bash "$S/run.sh" C3 bash -c 'echo "TMUX=${TMUX:-unset} tmux=$(command -v tmux)"; tmux ls; echo "tmux exited $?"'
rm -f "$S/logs/poison" "$S/logs/ln-crash" "$S/logs/curl-argv"
```
Expected, in order: `== C1: exit 0` and `unarmed: linked to $H/x`; `== C2: exit 137` with `the swap name passes: $H/y` and NO `ARMED STUB DID NOT BITE`; `no link left`; `== C3: exit 0` with `TMUX=unset tmux=$S/bin/tmux`, `rehearsal: tmux is poisoned here`, `tmux exited 90`. The last line clears the control's own traffic, so the record counts only the rehearsal's.

Then the header the record opens with (measured now, scrubbed):
```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
{
  printf '**Run:** %s, on this branch at `%s` (Tasks 1–7 committed). `N` = `%s` and `N-1` = `%s`, both measured (Step 1) to ship a verified tarball and bundle and to predate W6; `U` = `%s`.\n\n' \
    "$(date -u +%Y-%m-%dT%H:%MZ)" "$(git rev-parse --short=12 HEAD)" "$N" "$N1" "$U"
  printf '**Environment:** %s; node %s; %s; %s. Fixture HOME `$H`, role `server`, loopback port `$PORT`; every command under `env -i` with `PATH=$S/bin:$H/.local/bin:<node>:/usr/local/bin:/usr/bin:/bin`. The stub `systemctl` runs the placed unit'"'"'s own `ExecStart=`; `loginctl`/`journalctl` are stubs, `curl` is recorded, `tmux`/`ssh`/`gh`/`systemd-run`/`launchctl` are poisoned (Task 8'"'"'s Interfaces).\n\n' \
    "$(uname -sr)" "$(node -v)" "$(mv --version | head -n1)" "$(rsync --version | head -n1)"
  printf '**Order of commands:** R1 is `N-1`'"'"'s own `install.sh --release`; R2 and R3 this checkout'"'"'s `ccd/ccrc install`; R2v and R4–R6 this branch'"'"'s ccrc as placed at `$H/ccrc-versions/$U` (from R4 on, `$H/ccrc` points at a pre-W6 release); R7 the checkout'"'"'s ccrc (R7c prunes `$U`).\n'
} | "$S/scrub.sh" > "$S/logs/header.md"; cat "$S/logs/header.md"
```
Expected: three paragraphs, with no absolute path in them.

- [ ] **Step 5: R1 — `N-1` as a real directory, by its own spine**

```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
bash "$S/run.sh" R1 bash "$REPO/install.sh" --release "$N1" --role server; bash "$S/state.sh" R1
```
Expected: exit `0`, or `1` when `N-1`'s doctor FAILs a check the fixture environment cannot pass; those checks are the baseline. The transcript carries `install.sh: verified ccrc-<N-1>.tar.gz — handing off to the staged 'ccrc install'`, `install: tree: placed at $HOME/ccrc` and `install: done — …`. The state has `  d ccrc ` (a real directory) and `health: {"version":"<N-1>",…}`. An exit of `1` from anything BUT the doctor tail (an `_inst_*` die, for instance the service not staying up) is not a baseline: stop, and report the line.

- [ ] **Step 6: R2 — a crash inside the migration's two-syscall window**

```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
touch "$H/fixture-ln-crash"
bash "$S/run.sh" R2 bash "$REPO/ccd/ccrc" install --role server; bash "$S/state.sh" R2
bash "$S/run.sh" R2v bash "$H/ccrc-versions/$U/ccd/ccrc" versions; bash "$S/state.sh" R2v
cat "$S/logs/ln-crash" | "$S/scrub.sh"
```
Expected: `== R2: exit 137`. Its transcript ends after `install: tree: placed <U> at $HOME/ccrc-versions/<U>`, the `npm ci` lines and `install: tree: migrating — $HOME/ccrc is a directory; <U> is complete at $HOME/ccrc-versions/<U>`, with no `(the pre-versioned tree is kept at …)` line. The state holds no `ccrc` entry at all, `  d ccrc.migrating `, `migrating-to: <U>`, and `health` still `<N-1>`: the old server runs from the moved tree's inodes. R2v exits `0` with `versions: a migration crashed — $HOME/ccrc is absent beside $HOME/ccrc.migrating; run bash $HOME/ccrc-versions/<U>/ccd/ccrc install (or bash install.sh from a ccrc checkout) to complete it — the ccrc on PATH cannot run until then, and deploy.sh would place a second tree beside it` (Task 3's `_ver_crashed_remedy`, reading R2's `migrating-to: <U>`) and `<U>` listed `incomplete` (its record is written by the install that completes it). The `ln-crash` line names `ln -sn -- $H/ccrc-versions/<U> $H/ccrc` (Task 3's `-n`, D-3434).

- [ ] **Step 7: R3 — the completion, first**

```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
rm -f "$H/fixture-ln-crash"
bash "$S/run.sh" R3 bash "$REPO/ccd/ccrc" install --role server; bash "$S/state.sh" R3
```
Expected: exit `0` or `1` (the doctor tail, as R1). The transcript carries `install: tree: completed a crashed migration — $HOME/ccrc was absent beside $HOME/ccrc.migrating; linked to $HOME/ccrc-versions/<U> (named by ~/.ccrc/migrating-to)` ABOVE `install: box: $H` — the banner, the spine's first step, so the link is completed before anything else runs. Later come `install: tree: reinstalled <U> in place at $HOME/ccrc-versions/<U> (…)` and `install: versions: kept <U>'s stamp and install record in $HOME/ccrc-versions/<U> — what a flip back restores`. The doctor tail's verdict is one of two lines:
- `install: migration: $HOME/ccrc.migrating removed — ccrc doctor passed; a plain install is its own gate` (doctor rc 0);
- `install: migration: $HOME/ccrc.migrating kept — ccrc doctor did not pass; the next install or update whose gate passes removes it`.
The state: `  l ccrc $H/ccrc-versions/<U>`, `<U>[stamp,record]`.

- [ ] **Step 8: R4 — one flip, to `N`, whose spine predates W6**

```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
bash "$S/run.sh" R4 bash "$H/ccrc-versions/$U/ccd/ccrc" update --to "$N"; bash "$S/state.sh" R4
```
Expected: exit `0`, or `3` when the staged spine's doctor FAILs only baseline checks and the gate passes. In order:
- `update: previous: untagged (<40 hex>) — this build carries no release tag, so an automatic restore of it is arm 3 and a bare 'ccrc rollback' refuses (name one with --to)`;
- `update: tree: <N>'s spine predates versioned installs and writes through $HOME/ccrc — $HOME/ccrc now points at $HOME/ccrc-versions/<N> (a copy of <U>) for it to write into`;
- `N`'s own `install: tree: placed at $HOME/ccrc`;
- `update: versions: kept <N>'s stamp and install record in $HOME/ccrc-versions/<N> — …`;
- an `update: gate: …` pass line;
- when R3 kept `~/ccrc.migrating`: `update: migration: $HOME/ccrc.migrating removed — the health gate passed`;
- the automatic GC: nothing. One complete version (`<U>`) sits beside the pointed-at one, within the keep of 3, so `_ver_gc update auto` returns at its step 3 before it reads the projection, and prints no WARN even on a box with none.
The state: `  l ccrc $H/ccrc-versions/<N>`, no `ccrc.migrating`, `health` `<N>`, `update.json` `done`.

- [ ] **Step 9: R5 — a second flip, down to `N-1`**

```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
bash "$S/run.sh" R5 bash "$H/ccrc-versions/$U/ccd/ccrc" update --to "$N1" --downgrade; bash "$S/state.sh" R5
```
Expected: exit `0` or `3` (as R4). The lines:
- `update: previous: <N> (<40 hex>) — the tag a restore or a bare 'ccrc rollback' returns to`;
- `update: tree: <N-1>'s spine predates versioned installs and writes through $HOME/ccrc — $HOME/ccrc now points at $HOME/ccrc-versions/<N-1> (a copy of <N>) for it to write into` — R1's `N-1` tree went to `~/ccrc.migrating`, never into the versions root, so there is no kept `N-1` to flip to;
- the coord.db restore commands a downgrade prints;
- `update: versions: kept <N-1>'s stamp …`;
- the gate's pass line.
The state: `  l ccrc $H/ccrc-versions/<N-1>`, `previous: <N> <sha>`, `health` `<N-1>`, and `<N>[stamp,record]` still kept.

- [ ] **Step 10: R6 — one rollback by arm 1**

```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
bash "$S/run.sh" R6 bash "$H/ccrc-versions/$U/ccd/ccrc" rollback; bash "$S/state.sh" R6
grep -c '^R6	' "$S/logs/curl-argv"; grep '^R6	' "$S/logs/curl-argv" | grep -cF "$BASE"
```
Expected: `== R6: exit 0` with, in order:
- `rollback: <N> is kept at $HOME/ccrc-versions/<N> — no release-host question and no download`;
- `N`'s own spine lines (its pre-W6 `install: tree: already running from $HOME/ccrc`, its `npm ci`, and `install: stamp: skipped (…) — ccrc version will say unstamped`, which a pre-W6 spine prints over the stamp `_ver_flip_back` restored — expected, not a finding, D-3439);
- `rollback: flip: $HOME/ccrc -> $HOME/ccrc-versions/<N>; its stamp and install record restored; its own spine re-placed the executables, hooks and units (no release download)`;
- the gate's pass line;
- `rollback: this box runs <N> again — flipped back to $HOME/ccrc-versions/<N>, no download`.
The state: `  l ccrc $H/ccrc-versions/<N>`, `health` `<N>`, `update.json` `{"phase":"done","target":"<N>","from":"rollback",…}`. The two counts: the R6 `curl` calls (the gate's and doctor's loopback probes, at least one), then `0` of them naming the release host.

- [ ] **Step 11: R7 — `versions`, and the GC that never removes a needed version**

```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
bash "$S/run.sh" R7a bash "$REPO/ccd/ccrc" versions; bash "$S/state.sh" R7a
bash "$S/run.sh" R7ch bash "$REPO/ccd/ccrc" channel; bash "$S/state.sh" R7ch
bash "$S/run.sh" R7b bash "$REPO/ccd/ccrc" versions --prune; bash "$S/state.sh" R7b
```
Expected:
- R7a exits `0` with `versions: $HOME/ccrc -> $HOME/ccrc-versions/<N>` (no `(its stamp reads …)` suffix: the stamp `_ver_flip_back` restored reads `<N>`). When this box has no projection, one `versions: WARN: the control plane's projection is unreadable (absent) — its desired tags cannot be read — nothing would be pruned` line follows, and EVERY entry reads `kept: unmeasured`, the pointed-at one included: `  * <N>  complete  kept: unmeasured`, then `<N-1>` and `<U>` listed `complete`. With an in-force projection there is no WARN; `<N>` reads `kept: pointed-at previous …` (the words `_ver_protect` gave it) and `<N-1>` and `<U>` read `kept: newest 3`. Last, `versions: 3 kept tree(s) under $HOME/ccrc-versions; CCRC_VERSIONS_KEEP=3 plus the protected set (…) — …`.
- R7ch's first line is `channel: state=<word> …`.
- R7b prunes nothing and exits `0` with `versions: nothing to prune — 2 complete version(s) beside the pointed-at one, within CCRC_VERSIONS_KEEP=3, and none incomplete`, whatever R7ch read. This is Task 5's step 3 (D-3450): it returns before `_ver_protect`, so this prune reads no protection input. Its listing then repeats R7a's.

R7c's keep of 1 is below those 2 complete versions, so R7c is the prune that reads the protected set. With no projection it would stop at `versions: prune skipped — the control plane's projection is unreadable (absent) — its desired tags cannot be read; nothing was removed` (exit 1, D-3447), and the one removal this step exists to show would never run. So when R7ch read anything but `ok` or `none`, plant the in-force projection (spec §9's nine lines, unix seconds, mode 0600, placed by rename), the fixture's stand-in for W2's server-role writer:
```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
if ! grep -qE '^channel: state=(ok|none) ' "$S/logs/R7ch.log"; then
  now="$(date +%s)"
  printf '%s\n' "epoch 1" "issued $now" "lease $((now + 900))" "channel stable" "desired $N" "desired-stable $N" "desired-dev $N" "auto off" "end" \
    > "$H/.ccrc/update-intent.tmp" && chmod 600 "$H/.ccrc/update-intent.tmp" && mv -f "$H/.ccrc/update-intent.tmp" "$H/.ccrc/update-intent" \
    && echo "planted" && bash "$S/run.sh" R7ch2 bash "$REPO/ccd/ccrc" channel && bash "$S/state.sh" R7ch2
fi
```
Expected: `planted` and R7ch2's `channel: state=ok channel=stable desired=<N> …`, or nothing at all when R7ch already read `ok|none`.

Then the prune that removes one:
```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
bash "$S/run.sh" R7c env CCRC_VERSIONS_KEEP=1 bash "$REPO/ccd/ccrc" versions --prune; bash "$S/state.sh" R7c
```
Expected: exit `0` with the line `versions: pruned $HOME/ccrc-versions/<U> (complete, not among the newest 1)`. That is Task 5's `<lead> pruned …`, and the lead is plain `versions:` when the prefix is `versions`. `<N>` is protected (pointed-at, previous, desired, running). `<N-1>` is the newest unprotected complete tree, by its kept record's mtime (R5's, later than R3's `<U>`), so it stays. The state: `<N>[stamp,record]` and `<N-1>[stamp,record]`, no `<U>`.

- [ ] **Step 12: Teardown, and the controls after**

```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
echo teardown > "$S/logs/current-step"; "$S/bin/systemctl" --user stop ccrc.service; "$S/bin/systemctl" --user is-active ccrc.service
bash "$S/live-probe.sh" > "$S/logs/live-after"; cmp "$S/logs/live-before" "$S/logs/live-after" && echo "live box untouched"
cut -f1 "$S/logs/curl-argv" | sort | uniq -c
for l in R4 R5 R6; do printf '%s release-host fetches: %s\n' "$l" "$(grep "^$l	" "$S/logs/curl-argv" | grep -cF "$BASE")"; done
cat "$S/logs/poison" 2>/dev/null | "$S/scrub.sh"
```
Expected: `inactive`; `live box untouched`; the per-step `curl` counts; `R4 release-host fetches: <n ≥ 3>` (SHA256SUMS, the tarball, the bundle), `R5 …: <n ≥ 3>`, `R6 …: 0`. Then the poison log — each line a tool the fixture reached and was refused, typically `ccd`'s `tmux` probes from the fixture server; none is a failure. A `cmp` difference is a finding of the first order — the rehearsal touched the live box. Stop, and report it to the coordinator with both files before anything else. Leave `$S` in place until the wave-done is accepted; it is the evidence.

- [ ] **Step 13: Write the record into the plan, then check it for residue**

```bash
. "$SCRATCHPAD/w6-rehearsal/env.sh"
PLAN=docs/superpowers/plans/2026-09-23-centralised-update-w6-versioned-installs.md
(set -a; . "$S/env.sh"; set +a; python3 "$SCRATCHPAD/w6-record.py" "$PLAN")
grep -c '<!-- REHEARSAL RECORD: task 8 -->' "$PLAN"
git diff --stat
```
Expected: `wrote the record into …: 12 steps, <k> difference(s)`, with each `DIFFERS:` line printed under it; `0`; one file changed, whose one deletion is the marker line and whose insertions are the record. The script refuses, writing nothing, when any scratch path, the live home, the operator's name or the release owner survives the scrub.

Then, from inside `server/`, one call each:
```bash
./node_modules/.bin/vitest run test/topology-clean.test.ts
./node_modules/.bin/vitest run test/dtbd.test.ts
```
Expected: PASS. Both read the working tree, so they run before the commit: a residue committed and then removed would still be a blob in the range `topology-clean`'s history scan reads.

- [ ] **Step 14: Findings, then commit**

Read the record's `**Outcome:**` line.
- `every expectation above held.` → commit.
- `DIFFERS — …` → each difference gets a finding before this task closes:
  - A W6 defect (a sentence or state this wave's code gets wrong) is a Task-N fix. It lands in its own commit, with that task's red-first test, and the affected steps are re-run from a fresh plant (move `$S` aside; Steps 3–13).
  - A spec departure the run exposed is a new bullet in `## Deviations found`, numbered with the next unspent reserve number of run 133 and naming Task 8.
  - A difference that is the fixture environment's (a doctor check R1's baseline already FAILs, a network refusal) is named as such in one sentence under the record's `**Outcome:**` line. It is not a finding.
  The record itself is never edited to agree with an expectation.
```bash
git add docs/superpowers/plans/2026-09-23-centralised-update-w6-versioned-installs.md
git commit -m "docs(plan): the W6 rehearsal record — migration, a crash in the window and its completion, two flips, rollback by arm 1, versions and prune, against the real N-1 and N"
```

### Task 8A: W4's carried residue — restore onto an older release, a stale `previous`, and the floor's refusal

Programme wave 4 (PR #181) merged with three node-side items carried, by the rule its coordinator announced before its review results existed: the round after the full fix round sent back only a narrow class of behaviour defect, and everything else carried to the next wave that edits `ccd/ccrc`. That wave is this one. Two of the three are answered structurally by this wave's versioned installs and arm 1.

**First step, before any item:** re-measure each item on `main`, anchored by symbol, never by line. W4's fix round changed `previous` (a same-tag reinstall no longer rewrites it) and put the converged check before the floor check. An item closed on arrival is reported as such in the wave-done mail, and gets no commit.

**Items** (the C-numbers are W4's review run 155's):

- **C26 (BEHAVIOUR).** Arm 2 runs its restore child from the tree just installed. After `ccrc update --to <pre-W4 tag> --downgrade` whose gate fails, that tree's `ccrc` does not know `--no-gate` or `--from`, so the child exits 2, and arm 3 leaves a MIXED tree. This wave keeps the pre-update version directory, so arm 1 (the flip back) answers the case before arm 2 is reached.
  - Pin: a gate-failed downgrade onto a pre-W4 release fixture ends on arm 1, with the previous version directory active and no mixed tree.
- **C27 (BEHAVIOUR).** `~/.ccrc/previous` goes stale when a box rolls back to a pre-W4 release and that release's own `ccrc`, which never writes `previous`, moves it forward. A bare `ccrc rollback` then targets a tag that was not the build before the last update.
  - Ruling: the bare-rollback target is checked against what this wave's layout records as having run. When `previous` disagrees with that record, `ccrc rollback` refuses, naming both, instead of guessing.
  - Pin the detour.
- **The floor's refusal after a restore (C28's root).** `_inst_installed` raises `~/.ccrc/floor` inside the staged spine, before the health gate, and spec §9 says a restore never lowers it. So a failed update that restored leaves the floor above the running release. W4 made a converged box ignore the floor, so nothing is stuck.
  - Ruling: spec §9's placement stays; there is no departure here. The refusal a later move meets names the floor AND the update that raised it (the tag, and that its gate failed and was restored), so the operator can see why `--downgrade` is being asked for.
  - Pin that sentence.

**Steps:**

- [ ] **Step 1: Re-measure.** On `main`, decide for each item whether it is open. Write the list (open or closed-on-arrival, with a one-line reason) to `$SCRATCH/w6-t8a-remeasure.md`.
- [ ] **Step 2: Pins first, red first.** For each open item, write the case, see it green on the unmutated tree, then revert the item's fix on a scratch copy (`cp`, never `git checkout --`) and see it red. Restore with `cp` and `cmp` it byte-identical.
- [ ] **Step 3: Suites.** `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts test/ccrc-rollout.test.ts`. Expected: PASS. Task 9's full gate follows.
- [ ] **Step 4: Commit.** `git add` the files you touched, then `git commit -m "test(update): W4's carried residue — arm 1 onto an older release, a stale previous, the floor's refusal"`.

**Mutation table** (filled in by Step 2 with measured results; a row without a measured red is not done):

| Item | Mutation | Expected red |
|---|---|---|
| C26 | arm 1 skipped for a pre-W4 target | the gate-failed downgrade onto a pre-W4 release |
| C27 | `ccrc rollback` trusts `previous` without the layout check | the pre-W4 detour |
| floor | the refusal drops the raising update's tag | the post-restore move below the floor |

### Task 9: Docs, the citation corpus, the gate, the PR

**Files:**
- Modify: `README.md`:
  - the "**Update and rollout.**" paragraph (`:467-` at `d759c914`): one clause in its spine sentence, pointing at the new paragraph below;
  - a NEW paragraph, "**Versioned installs, and rollback by flip.**", directly above `**The maintenance verbs.**` (after wave 4's four paragraphs). It covers the layout, the flip, the one-time migration and `~/ccrc.migrating`, its crash completion, arm 1, `ccrc rollback` by flip, the legacy target, `ccrc versions [--prune]` and `CCRC_VERSIONS_KEEP`, and `deploy.sh` through the link. *Correction: the skeleton put all of this into the "Update and rollout" paragraph, which after wave 4 already carries the spine, the gate's pointer and rollout; 30 more lines there would bury the spine sentence it exists for;*
  - *correction (added): two of wave 4's paragraphs, which this wave makes false.* "**One update at a time, reported, gated, and undone.**" says a failed gate's restore IS arm 2 (arm 1 now comes first). "**Rolling back, and the watchdog.**" says a rollback target "must be a published release", which a kept version no longer needs (D-3442);
  - the uninstall sentence (`:499-500` at `d759c914`, as wave 4's Task 16 Step 4(d) rewrote it): `~/ccrc-versions` and `~/ccrc.migrating` are removed, and `migrating-to` joins the node-file list;
  - the manual-rollback recipe (`:3158-3164`): `ccrc rollback` to a kept version is the first remedy, and the `cp -a` lines write through `~/ccrc` into the version it points at (whose kept record the operator then removes, as arm 3 does — D-3441);
  - *correction (added): README's EXISTING anchors into `ccd/ccd`* — `ccd/ccd:20970` and `ccd/ccd:19758-19760` at `d759c914` (`README.md:2599-2600`). Task 1 inserts `_plat_ln_swap` into `ccd/ccd`'s platform layer, above both, so both rot, and README's census entry is an equality with empty (`session-hook.test.ts:8486`, `a README anchor stopped naming what its own sentence quotes`). They are re-anchored BY CONTENT (Step 6), in a commit of their own, before the census is re-measured. The skeleton's "no corpus anchor enters README" holds for the new text only.
- Modify: `CLAUDE.md` — the Deploy bullet (`:94-`), one clause located by content after wave 4's `` `ccrc rollback` is the typed way back.`` (a box's tree is `~/ccrc -> ~/ccrc-versions/<tag>`; a rollback to a kept version is a flip with no download; `ccrc versions` lists and prunes); the README size claim (`:10`) re-measured in the same commit (`pools-prose.test.ts:868-883` reds beyond 100 lines of drift, `oss-metadata.test.ts:89-100` beyond 10%).
- Modify: `server/test/session-hook.test.ts` — the census literals, and a note above each literal that moved; every edit at or below `:8000`, after `:7056`, the last line of this file the corpus cites (ruling R13's "appended after them").
- NOT edited by this task: this plan's «dev:…» placeholders (ruling R12 — the coordinator's pass; this task only verifies it happened and never types a number).
- Guard files read by these edits, run and not edited: `pools-prose.test.ts`, `oss-metadata.test.ts`, `readme-holds.test.ts`, `readme-roster-mirror.test.ts`, `crossrepo-prose.test.ts`, `box-token-census.test.ts`, `coord-pause-route.test.ts`, `ccrc-update.test.ts` (README's bash-floor pin), `ccrc-install-graphify.test.ts` (README's graphify step count), `coordinator-skill.test.ts`, `worker-skill.test.ts`, `reviewer-skill.test.ts`, `license.test.ts`, `ledger-instruction.test.ts`, `mail-hardening.test.ts`, `topology-clean.test.ts`; `session-hook.test.ts` in Step 8.

**Interfaces:**
- README's new text carries no `:<digits>` token (no corpus anchor enters README; `session-hook.test.ts`'s `REF_RE`, `:7080`, reads any `:N` in README as a citation to resolve). It splits no code span across a line, and it carries none of the passage markers other suites slice README by (Step 4's check). It is line-neutral wherever `pools-prose.test.ts` holds a count: it holds only the whole-file size claim, re-measured in Step 3. The text states the producers' facts, checked against their tasks (reword one and it must still match the task that ships it):
  - the three name shapes (Task 2, D-3422, D-3425);
  - place, `npm ci`, then one rename, and python3 on macOS (Tasks 1 and 2, D-3419);
  - the in-place same-name reinstall and the no-copy, no-`npm ci` complete placed version (Task 2, D-3426, D-3427);
  - the kept stamp and record (Task 2, D-3428);
  - the migration's gate by lock (a rollback's passed gate included, Task 4 Step 4's `_inst_migrate_finish rollback`), the older updater's first move — kept past a lock-holding updater, decided by the staged spine's own doctor under one older than the lock — and `--no-gate` (Task 3, D-3431, D-3435). *Correction: the text said the old tree always outlives the first move; Task 3's D-3435 measures that true only for an updater that takes `~/.ccrc/update.lock`;*
  - the crash completion from `~/.ccrc/migrating-to` and its refusal when the marker is absent OR names no placed version (Task 3's `_inst_migrate_resume`, D-3432);
  - arm 1 re-running the kept spine and gating once more, and a kept rollback making the same flip, spine and gate (Task 4, D-3439);
  - rollback asking the host nothing (Task 4, D-3442);
  - the legacy target and arm 3's void (Task 4, D-3440, D-3441);
  - the protected set, the keep count, the unmeasured and incomplete rules, and the automatic run only behind a passed gate — an update's health gate, or a plain install's doctor under a lock it took; never after a failed gate, never on a kept rollback (Task 5, D-3420, D-3423, D-3446, D-3447, D-3448, D-3451). *Correction: the text said "after every completed install", which Task 5's call sites contradict;*
  - the uninstall sweep, a staged `~/ccrc.new` link included, and the uninstall's update-lock gate (Task 6, D-3452, D-3453).
- README's two `ccd/ccd` anchors: re-anchored by CONTENT. The bytes the base cited are found in the tip's `ccd/ccd`, widened by neighbouring lines until unique, and README's numbers are moved to where those bytes now stand — never a number obtained by adding Task 1's delta. Digits only, so README's line count does not change.
- `session-hook.test.ts`: the corpus is re-measured by S6-R11 (`:8069-8074`). Both `ccd/ccrc` and `ccd/ccd` grew. The base is `git merge-base HEAD origin/main` after Step 1's merge; the tip is `HEAD` after Step 6's README commit. A scratch copy of the file is patched IN PLACE with its line count unchanged, so that each of its ten census sites dumps its subject to JSON (`dump(…); expect.soft(…)`), and it is run in `git archive` trees of both. The sites are `byFile` (`:8089`), the headline `total` (`:8400`), `TOUCHED` (`:8429`), README's equality with empty (`:8486`), the `**Files:**` set (`:8545`) and its only-this-pass subset (`:8625`), the `|`-row set (`:8942`), the site-level set (`:9099`), and the range bound's live equality and ledger ratchet (`:9189`, `:9195`), all at `d759c914`. The anchors the patch keys on are the `expect(` lines themselves, which wave 4's Task 16 notes sit above and never edit; the patch refuses unless each occurs exactly once. A script diffs the two dump sets and prints, per literal, what entered (with the entry it follows), what left, and the composition note. Each moved literal's composition is stated above it; no new deviation number for a pure re-measurement.
- The gate, in order:
  1. `git fetch origin main` and merge it if it moved (keep both sides' hunks — never take-theirs on a deletion hunk), then the census LAST;
  2. the full server suite, sharded (`./node_modules/.bin/vitest run --shard=<i>/4` for every `i`, foreground, each timeout ≥ 600000 ms), and the agent and pwa suites;
  3. `test/deviation-refs.test.ts` after the fetch, `test/dtbd.test.ts`, `test/topology-clean.test.ts`;
  4. every `«dev:…»` verified replaced by an issued number (`git grep -nE '«dev:[a-z0-9-]+»' -- .` prints nothing — the coordinator's pass, ruling R12). *Correction: the skeleton's `grep -c '«dev:' <plan>` = 0 can never hold, because this plan's own Global Constraints keep the forms `«dev:<slug>»` and `«dev:…»`, and wave 4's and W2's committed plans carry them too; the pattern needs a real slug between the guillemets, as W2's committed Task 15 Step 5 spells it;*
  5. then the PR from the workspace branch, its body ending with the attribution line.
- No §18 row: this task ships no guard. Its control is that each re-measured literal is exact: deleting one entry it now carries reds the real file (Step 8).

- [ ] **Step 1: Start from a merged, clean tree**

From the repo root:
```bash
git status --porcelain
git fetch origin main
git log --oneline -1 origin/main
git merge-base --is-ancestor origin/main HEAD && echo "origin/main is in HEAD" || echo "MAIN MOVED"
```
Expected: no `git status` output (Tasks 1–8 committed), then `origin/main is in HEAD`. On `MAIN MOVED`: `git merge --no-edit origin/main`. Then rerun, from inside `server/`, one call each, the suites this wave edits:
```bash
for t in macos-platform ownership ccrc-install ccrc-update ccrc-uninstall ccrc-cli single-definition runbook-holds ccrc-versioned-audit; do
  ./node_modules/.bin/vitest run "test/$t.test.ts" || { echo "RED: $t"; break; }
done
```
A red is the merge's: fix it and commit it on its own before this task goes on. Keep both sides' hunks, and never take-theirs on a deletion hunk. A merge that touched `ccd/ccd` restamps it with `node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"` (`ownership.test.ts:131-135`). The census in Steps 5–8 is a function of BRANCH × MAIN, so this merge comes first and the census last.

- [ ] **Step 2: README — the spine clause, wave 4's two sentences, the new paragraph, the uninstall sentence, the recipe**

Each `old` below occurs exactly once once wave 4 has merged. Confirm each before editing with `grep -cF -- '<its first line>' README.md` → `1`. A `0` means wave 4 merged other words: make the same change to the sentence that says it, keeping the added line count, and name it in the wave-done.

(a) In "**Update and rollout.**" (the spine sentence), replace
```markdown
the staged tree (role-aware, atomic, seed-once files untouched, every rostered home's skills converged; it
```
with
```markdown
the staged tree (role-aware, atomic, seed-once files untouched, every rostered home's skills converged; it
places the tree in a version directory of its own and flips `~/ccrc` to it — Versioned installs, below; it
```
(+1). The next line (`mints …`) continues the sentence unchanged.

(b) In wave 4's "**One update at a time, reported, gated, and undone.**", replace
```markdown
gate that passes under a failing doctor is still exit 3. A gate that fails restores the box, and the run exits **4**:
arm 2 re-installs `previous`'s tag through a child `ccrc update --to <previous> --no-gate --from restore` that runs
```
with
```markdown
gate that passes under a failing doctor is still exit 3. A gate that fails restores the box, and the run exits **4**:
arm 1 flips `~/ccrc` back to a kept previous version (Versioned installs, below); failing that, arm 2 re-installs
`previous`'s tag through a child `ccrc update --to <previous> --no-gate --from restore` that runs
```
(+1). The next line, `under the parent's lock, …`, continues unchanged, and wave 4's later "arm 3, when arm 2 cannot run or fails" stays true.

(c) In wave 4's "**Rolling back, and the watchdog.**", replace
```markdown
re-installs `previous`'s tag, or the one named — which must be a published release (a `SHA256SUMS` that answers
404 is exit 2) — as a downgrade that leaves the floor where it is, then runs the gate, then the supervisor
```
with
```markdown
re-installs `previous`'s tag, or the one named — a version kept under `~/ccrc-versions` is flipped back to with no
download (Versioned installs, below); any other must be a published release (a `SHA256SUMS` that answers
404 is exit 2) — as a downgrade that leaves the floor where it is, then runs the gate, then the supervisor
```
(+1).

(d) Directly above the line beginning `**The maintenance verbs.**` (`grep -n '^\*\*The maintenance verbs\.\*\*' README.md` prints one line), insert this paragraph and one blank line after it:
```markdown
**Versioned installs, and rollback by flip.** A box keeps each release it installs as a tree of its own under
`~/ccrc-versions/<name>/` — the release tag; `untagged-<the first twelve hex digits of its sha>` for a checkout or
an unversioned build; `unstamped-<twelve random hex digits>` for a tree whose identity cannot be measured — and
`~/ccrc` is a symlink to the one that runs, so the launcher, the units, the plist and doctor all resolve through it
unchanged. An install places the new tree beside the running one, runs `npm ci` there, and only then points
`~/ccrc` at it in one rename (GNU `ln -sfn` then `mv -fT`; on macOS python3's `os.replace`, so `ccrc install` there
needs the Xcode Command Line Tools). A reinstall of the name already running writes in place, and a complete kept
version run from its own directory copies nothing and runs no `npm ci`. Every completed install keeps a copy of the
box's stamp and install record inside its version directory; a flip back restores both. A box whose `~/ccrc` is a
real directory is migrated once: the new tree is placed fully, the old one is moved to `~/ccrc.migrating`, the link
is placed, and `~/ccrc.migrating` is removed only after a gate passes — `ccrc update`'s or `ccrc rollback`'s health
gate, or a plain `ccrc install`'s own doctor when that install can take `~/.ccrc/update.lock` itself (an update's
staged install cannot, and leaves it to the update's gate). The first move onto this layout is made by a box's
older updater: one that holds that lock has a gate that knows nothing of the migration, so the old tree outlives
that run and goes at the next one, while one older than the lock leaves it to the staged install's own doctor;
`--no-gate` keeps it too. A crash between the move and the link leaves `~/ccrc.migrating` and no `~/ccrc`, where
the launcher cannot run: the placed version's own `bash ~/ccrc-versions/<name>/ccd/ccrc install` completes the
link from `~/.ccrc/migrating-to` before it does anything else, and refuses, naming both by-hand remedies, when
that record is missing or names no placed version. With the previous version kept, a failed gate's restore tries
arm 1 first: it flips `~/ccrc` back, restores that version's stamp and record, re-runs its own install spine (the
executables, hooks and units, with no download) and runs the gate once more, falling to arm 2 only when there is
no kept version or that fails. `ccrc rollback` to a kept version makes the same flip, spine and gate, and asks the
release host nothing. A staged release older than this layout is first given a directory named for its own tag to
write into, and arm 3's MIXED tree loses its kept record, so no flip returns to it. `ccrc versions` lists the kept
trees (`*` marks the one `~/ccrc` points at). After an install or update whose gate passes, and by
`ccrc versions --prune`, the trees nothing needs are removed: never the one `~/ccrc` points at, `previous`, a tag
this node's projection names, or a version a running unit's command resolves to, and beyond those the newest
`CCRC_VERSIONS_KEEP` (default 3) complete trees stay. An input that cannot be read prunes nothing, and only
`--prune` removes an incomplete tree. `deploy.sh` still pushes its tree through `~/ccrc`, into whichever version
directory that points at.
```
(+31: 30 text lines and the blank.)

(e) The uninstall sentence ("**The maintenance verbs.**"), replace
```markdown
inside `~/.cc-sessions` file-by-file, `~/ccrc` and the installed executables — and preserves
```
with
```markdown
inside `~/.cc-sessions` file-by-file, `~/ccrc`, every kept tree under `~/ccrc-versions` and a leftover
`~/ccrc.migrating`, and the installed executables — and preserves
```
and, two lines below it (wave 4's rewritten list), replace
```markdown
`previous`, `install-step`, `update.json`, `update.lock`, `update-intent` — which leave with the
```
with
```markdown
`previous`, `install-step`, `update.json`, `update.lock`, `update-intent`, `migrating-to` — which leave with the
```
(+1 and 0). The list is `_uninst_tree_bins`' own after Task 6: `$BOX_MIGRATION_FILE` joins wave 4's `rm -f -- "$BOX_PREVIOUS_FILE" …` statement, and the versions root and `~/ccrc.migrating` are swept after the link.

(f) The manual-rollback recipe, replace
```markdown
**Restore** (manual, from the target box — pick the `<ts>` to roll back to):
```
with
```markdown
**Restore** (manual, from the target box — pick the `<ts>` to roll back to). The first remedy is `ccrc rollback`:
to a version still kept under `~/ccrc-versions` it is a flip with no download. The `cp -a` lines below write
THROUGH `~/ccrc` into the version directory it points at, which then holds a MIXED tree under its release's name —
remove that directory's `.ccrc-installed` afterwards, as arm 3 does, so no flip ever returns to it:
```
(+3). The fenced `cp -a` block below it is unchanged: it now writes through the link, which is the sentence's point.

- [ ] **Step 3: CLAUDE.md — the Deploy bullet's clause, and the README size claim**

In `CLAUDE.md`'s Deploy bullet, locate wave 4's line by content: `grep -nF '`ccrc rollback` is the typed way back.' CLAUDE.md` prints one line. Replace
```markdown
  box at a time (`~/.ccrc/update.lock`); `ccrc rollback` is the typed way back. A `server`/`both` box's `ccrc-update-watchdog.timer`
```
with
```markdown
  box at a time (`~/.ccrc/update.lock`); `ccrc rollback` is the typed way back. A box's tree is the symlink
  `~/ccrc -> ~/ccrc-versions/<tag>` (a real `~/ccrc` is migrated once and kept as `~/ccrc.migrating` until a gate
  passes), so a rollback to a kept version — and the gate-failure restore's arm 1 — is a flip with no download, and
  `ccrc versions` lists and prunes the kept trees. A `server`/`both` box's `ccrc-update-watchdog.timer`
```
(+3). No suite slices the Deploy bullet (the CLAUDE.md passages the suites read are the box-token, account-pools and ledger bullets, and the void-writer sentence), the text carries no `- **` bullet start and no passage marker, and every line keeps an even backtick count.

Then re-measure README's size claim in this commit:
```bash
wc -l < README.md
grep -o 'README.md` (~[0-9,]* lines)' CLAUDE.md
echo $(( ($(wc -l < README.md) + 50) / 100 * 100 ))
```
Expected, if W2 and wave 4 merged as their committed plans say: `3418` — wave 4's `3380` plus this task's 38 (Step 2's +1, +1, +1, +31, +1, +3) — and wave 4's claim of `~3400`, so the last number printed is `3400` and `:10` stays as it is. A different `wc -l` means README moved elsewhere: name it in the wave-done. Set `CLAUDE.md:10`'s figure to the last number printed whenever it differs from the claimed one.

- [ ] **Step 4: The prose guards, then commit the docs**

The new text carries no citation, splits no code span, and moves no passage marker:
```bash
git diff -U0 README.md CLAUDE.md | grep '^+[^+]' | grep -nE ':[0-9]'
git diff -U0 README.md CLAUDE.md | grep '^+[^+]' | awk '{ n = gsub(/`/, "`"); if (n % 2) print "SPLIT CODE SPAN: " $0 }'
for m in 'What is gated, and what is not:' '**Caps and pause.**' 'Pause is a' '**Run lifecycle**' \
         '**The mail bus and its token.**' 'An account entry is' '`accounts.sh` is a pure projection' \
         'It compares the **projections**' 'The file holds one token' '### Placement honors the disabled marker' \
         '### Account pools: tagging a project to a set of accounts' '**The maintenance verbs.**' '**Update and rollout.**' \
         '**Ordering between the two targets.**' '**Restore** (manual, from the target box'; do
  printf '%s  %s -> %s\n' "$m" "$(git show HEAD:README.md | grep -cF -- "$m")" "$(grep -cF -- "$m" README.md)"
done
```
Expected: the first two print nothing; every marker's count is unchanged (`a -> a`). *Correction (added): the last two markers are `pools-prose.test.ts`'s deploy-ordering passage (`:773-774`, `'**Ordering between the two targets.**'` to `'**Restore** (manual, from the target box'`), whose END marker Step 2(f) rewrites the line of; the rewritten line keeps that prefix, and this check is what shows it.*

Then, from inside `server/`, foreground, one file per call, timeout ≥ 600000 ms:
```bash
cd server
for t in pools-prose oss-metadata box-token-census coord-pause-route crossrepo-prose readme-holds readme-roster-mirror ccrc-update \
         ccrc-install-graphify coordinator-skill worker-skill reviewer-skill license ledger-instruction mail-hardening topology-clean; do
  ./node_modules/.bin/vitest run "test/$t.test.ts" || { echo "RED: $t"; break; }
done
```
Expected: all green. The list is every suite that reads `README.md` or `CLAUDE.md` whole or by passage (`git grep -nE "README\.md'|'CLAUDE\.md'" -- server/test agent/test pwa/test`, less the fixtures that only write a file of that name). `session-hook` reads README too; it runs in Step 8, after the census, because until then its census literals are red by design: Tasks 1–8 grew `ccd/ccrc` and `ccd/ccd` under frozen anchors.

```bash
git add README.md CLAUDE.md
git commit -m "docs(update): versioned installs — ~/ccrc-versions and the flip, the one-time migration, rollback by flip, ccrc versions; wave 4's restore and rollback sentences follow"
```

- [ ] **Step 5: S6-R11 — dump the census at the base and at the tip**

`$SCRATCHPAD` is the session scratchpad directory (the system prompt names it; export it in each call). From the repo root:
```bash
S="$SCRATCHPAD/s6r11-w6"; rm -rf "$S"; mkdir -p "$S/base" "$S/tip" "$S/dump-base" "$S/dump-tip"
BASE="$(git merge-base HEAD origin/main)"; TIP="$(git rev-parse HEAD)"; echo "base $BASE tip $TIP"
git archive "$BASE" | tar -x -C "$S/base"
git archive "$TIP" | tar -x -C "$S/tip"
cmp "$S/base/server/test/session-hook.test.ts" "$S/tip/server/test/session-hook.test.ts" && echo "same census file"
for t in base tip; do ln -s "$PWD/server/node_modules" "$S/$t/server/node_modules"; done
```
Expected: `same census file` — Tasks 1–8 never edit `session-hook.test.ts` (Global Constraints). A `cmp` difference means a task edited it: stop, find the commit (`git log --oneline "$BASE"..HEAD -- server/test/session-hook.test.ts`), and treat its hunk as part of this re-measurement's composition.

Write the patch (scratch only; it is never applied to the repo's file):
```bash
cat > "$S/s6r11-patch.py" <<'PY'
#!/usr/bin/env python3
"""Make ONE scratch copy of server/test/session-hook.test.ts dump what its citation census measures.

Usage: s6r11-patch.py <path to a scratch copy of session-hook.test.ts>

Every edit is IN PLACE ON AN EXISTING LINE — the file's line count does not change — because the corpus
cites session-hook.test.ts by line (plan-a cites :2319 through :7043-7056), and a copy that grew would
move those anchors and put its own shift into the dump. Each census `expect(` becomes
`dump(<name>, <its subject>); expect.soft(`, so one run writes every dump even while a literal is red.
Refuses unless every anchor occurs exactly once and the line count is unchanged. Never run on the repo's
own file."""
import pathlib, sys

p = pathlib.Path(sys.argv[1])
src = p.read_text()
before = src.count('\n')

DUMP_DEF = ("import { itLinux, IS_DARWIN } from './platformFixtures.js';",
            " const CITE_DUMP = process.env['CITE_DUMP']; const dump = (name: string, v: unknown): void => { "
            "if (CITE_DUMP) fs.writeFileSync(path.join(CITE_DUMP, `${name}.json`), `${JSON.stringify(v, null, 1)}\\n`); };")
KEY = "`${f.doc}:${f.line} ${refKey(f)}`"
SITES = [
    ("    expect(byFile, 'the citation debt moved",
     f"dump('line', r.failures.map((f) => {KEY})); dump('byfile', byFile); "),
    ("    expect(total, 'the narrated headline", "dump('total', total); "),
    ("    expect([...new Set(r.failures.map((f) => f.file))].filter((f) => !TOUCHED.includes(f)),",
     "dump('untouched', [...new Set(r.failures.map((f) => f.file))].filter((f) => !TOUCHED.includes(f))); "),
    ("    expect(r.failures.filter((f) => f.doc === 'readme').map(refKey),",
     "dump('readme', r.failures.filter((f) => f.doc === 'readme').map(refKey)); "),
    ("    expect(set, 'a **Files:** reference stopped", "dump('files', set); "),
    ("    expect(set.filter((k) => !census.has(k)),", "dump('files-only', set.filter((k) => !census.has(k))); "),
    ("    expect(r.failures.map(refKey), 'a `|` row stopped", "dump('rows', r.failures.map(refKey)); "),
    ("    expect(r.failures.map(site).filter((k) => seen.has(k)),",
     "dump('sites', r.failures.map(site).filter((k) => seen.has(k))); "),
    ("    expect(r.failures.filter((f) => !(f.doc === 'plan' && f.line >= ledgerLine)),",
     "dump('eof-live', r.failures.filter((f) => !(f.doc === 'plan' && f.line >= ledgerLine)).map(refKey)); "),
    ("    expect(r.failures.map(refKey), 'the ledger", "dump('eof', r.failures.map(refKey)); "),
]

def once(anchor: str) -> None:
    n = src.count(anchor)
    if n != 1:
        sys.exit(f'anchor occurs {n} times, want exactly 1: {anchor!r}')

once(DUMP_DEF[0])
src = src.replace(DUMP_DEF[0], DUMP_DEF[0] + DUMP_DEF[1])
for anchor, dump in SITES:
    once(anchor)
    src = src.replace(anchor, '    ' + dump + 'expect.soft(' + anchor[len('    expect('):])
if src.count('\n') != before:
    sys.exit('the patch changed the line count — it would move the corpus\'s own anchors into this file')
p.write_text(src)
print(f'patched {p}: {len(SITES) + 1} lines rewritten in place, {before} lines before and after')
PY
python3 "$S/s6r11-patch.py" "$S/base/server/test/session-hook.test.ts"
python3 "$S/s6r11-patch.py" "$S/tip/server/test/session-hook.test.ts"
```
Expected: two `patched … 11 lines rewritten in place, N lines before and after` lines with the same N. Validated while planning: the patch applied to `d759c914`'s file rewrites 11 lines and leaves its 9562 lines at 9562.

Run each tree's audit, only the corpus describe, foreground, one call each:
```bash
(cd "$S/base/server" && CITE_DUMP="$S/dump-base" ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored')
(cd "$S/tip/server" && CITE_DUMP="$S/dump-tip" ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored')
ls "$S/dump-base" "$S/dump-tip"
cat "$S/dump-tip/readme.json"
```
Expected: the base run PASSES (its literals are the base's truth). The tip run fails softly on the literals that moved and never on anything else; a thrown error or a non-census case is a real red, so stop and read it. Each directory holds the same eleven files, `byfile eof eof-live files files-only line readme rows sites total untouched` (`.json`). The tip's `readme.json` is NOT `[]`: it lists README's `ccd/ccd` anchors that Task 1's insertion moved (expected: the two from `README.md:2599-2600`), which Step 6 repairs.

- [ ] **Step 6: README's rotted anchors, re-anchored by content — then the tip again**

Write the re-anchor script (each call below re-derives `S` and `BASE`; shell state does not carry between calls):
```bash
S="$SCRATCHPAD/s6r11-w6"
cat > "$S/readme-reanchor.py" <<'PY'
#!/usr/bin/env python3
"""S6-R11's README step: re-anchor each failing README citation BY CONTENT, never by a delta.

Usage (from the repo root): readme-reanchor.py <base-sha> <entry>...
Each <entry> is one string from the tip dump's readme.json — `<file>:<from>` or `<file>:<from>-<to>`, the
census's own refKey. For each: the bytes <file> held at <from>..<to> in <base-sha> are found in the WORKING
TREE's <file>, widening the block by one neighbouring line on each side until exactly one place matches;
the new numbers are where those bytes stand. README.md's one token spelling the old numbers is then
rewritten in place — digits only, so no line moves. Refuses, editing nothing, when a block matches nowhere,
never becomes unique, or README carries the old token zero or several times."""
import re, subprocess, sys, pathlib

base, entries = sys.argv[1], sys.argv[2:]
readme = pathlib.Path('README.md')
text = readme.read_text()
edits = []
for e in entries:
    m = re.fullmatch(r'(.+):(\d+)(?:-(\d+))?', e)
    if not m:
        sys.exit(f'REFUSED: {e!r} is not a <file>:<from>[-<to>] refKey')
    f, a = m.group(1), int(m.group(2))
    b = int(m.group(3) or a)
    old = subprocess.run(['git', 'show', f'{base}:{f}'], check=True, capture_output=True, text=True).stdout.split('\n')
    new = pathlib.Path(f).read_text().split('\n')
    found = None
    for k in range(0, 41):
        lo, hi = a - 1 - k, b + k
        if lo < 0 or hi > len(old):
            break
        block = old[lo:hi]
        hits = [i for i in range(len(new) - len(block) + 1) if new[i:i + len(block)] == block]
        if len(hits) == 1:
            found = hits[0] + k + 1
            break
        if not hits:
            sys.exit(f'REFUSED: {e}: the base bytes (widened by {k}) occur nowhere in the working tree\'s {f} — '
                     'the cited text changed; that is a re-point for the coordinator, not a re-anchor')
    if found is None:
        sys.exit(f'REFUSED: {e}: the base bytes never became unique within 40 lines of context')
    na, nb = found, found + (b - a)
    old_tok = re.compile(r'(?<![0-9A-Za-z_./-])((?:' + re.escape(f) + r')?:)' + str(a)
                         + (r'([-–])' + str(b) if b != a else '') + r'(?![0-9])')
    spots = list(old_tok.finditer(text))
    if len(spots) != 1:
        sys.exit(f'REFUSED: {e}: README spells the old anchor {len(spots)} times, want exactly 1 — '
                 'repair it by hand, reading each clause')
    edits.append((spots[0], na, nb, e))
for s, na, nb, e in sorted(edits, key=lambda t: -t[0].start()):
    rep = s.group(1) + str(na) + ((s.group(2) + str(nb)) if s.lastindex and s.lastindex >= 2 else '')
    text = text[:s.start()] + rep + text[s.end():]
    print(f'{e} -> {rep}   (README line {readme.read_text()[:s.start()].count(chr(10)) + 1})')
before = readme.read_text().count('\n')
if text.count('\n') != before:
    sys.exit('REFUSED: the rewrite changed README\'s line count')
readme.write_text(text)
PY
```
Run it with every entry of the tip's `readme.json`, copied by the shell, never retyped:
```bash
S="$SCRATCHPAD/s6r11-w6"; BASE="$(git merge-base HEAD origin/main)"
mapfile -t ENTRIES < <(python3 -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))))' "$S/dump-tip/readme.json")
python3 "$S/readme-reanchor.py" "$BASE" "${ENTRIES[@]}"
git diff --stat README.md; git diff README.md | grep -c '^[-+][^-+]'
```
Expected: one `<file>:<old> -> <file>:<new>   (README line <n>)` line per entry — for the two expected ones, both into `ccd/ccd`, the new numbers shifted by exactly the line count Task 1 inserted there (a check, never the method); `README.md | 4 ++--` (two lines changed, no line added); `4`. A `REFUSED:` line edits nothing. If it says the bytes occur nowhere, the cited text itself changed, which is a re-point: report it to the coordinator. If README spells the old anchor more than once, repair that one by hand, reading each clause. Task 1 inserts 64 lines into `ccd/ccd` (its Step 3), so from `d759c914` the two land at `ccd/ccd:21034` and `ccd/ccd:19822-19824` (a check, never the method). Validated while planning: this script, run on `d759c914`'s README against a `ccd/ccd` carrying a 63-line draft of Task 1's helper after `:160`, moved `ccd/ccd:20970` to `:21033` and `ccd/ccd:19758-19760` to `:19821-19823`, changed two lines, and nothing else.

```bash
S="$SCRATCHPAD/s6r11-w6"
git add README.md
git commit -m "docs: re-anchor README's ccd/ccd citations by content after _plat_ln_swap (S6-R11)"
TIP="$(git rev-parse HEAD)"; rm -rf "$S/tip" "$S/dump-tip"; mkdir -p "$S/tip" "$S/dump-tip"
git archive "$TIP" | tar -x -C "$S/tip"; ln -s "$PWD/server/node_modules" "$S/tip/server/node_modules"
python3 "$S/s6r11-patch.py" "$S/tip/server/test/session-hook.test.ts"
(cd "$S/tip/server" && CITE_DUMP="$S/dump-tip" ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored')
cat "$S/dump-tip/readme.json"
```
Expected: `[]`. README is repaired before the census is re-measured, never counted.

- [ ] **Step 7: S6-R11 — derive the literals, and edit**

Write the report script:
```bash
S="$SCRATCHPAD/s6r11-w6"; BASE="$(git merge-base HEAD origin/main)"; TIP="$(git rev-parse HEAD)"; echo "base $BASE tip $TIP"
cat > "$S/s6r11.py" <<'PY'
#!/usr/bin/env python3
"""S6-R11, derived: what each session-hook census literal must become, and the note that says why.

Usage (from the repo root): s6r11.py <scratch> <base-sha> <tip-sha>
Reads <scratch>/dump-base/*.json and <scratch>/dump-tip/*.json (written by s6r11-patch.py'd scratch
copies of session-hook.test.ts run over `git archive` trees of the two commits) and git. Prints, per
literal: what ENTERED (with the tip entry it follows, which is where it goes — the arrays are asserted in
document order) and what LEFT; then the note to paste above each literal that moved. Refuses when S6-R11
does not apply: a compaction-card corpus document changed (that is a re-point, not a re-measurement), or
an equality-with-empty is no longer empty (README's is repaired BY CONTENT first — Step 6 — never
counted). Edits nothing."""
import json, pathlib, subprocess, sys, textwrap
from collections import Counter

scr, base, tip = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
WAVE = 'the centralised-update W6 versioned-installs wave'

def load(side, name):
    return json.loads((scr / f'dump-{side}' / f'{name}.json').read_text())

def git(*a):
    return subprocess.run(['git', *a], check=True, capture_output=True, text=True).stdout

def lines_at(rev, f):
    r = subprocess.run(['git', 'show', f'{rev}:{f}'], capture_output=True, text=True)
    return r.stdout.count('\n') if r.returncode == 0 else None

SPEC = 'docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md'
PLAN = 'docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md'
for d in (SPEC, PLAN):
    if subprocess.run(['git', 'diff', '--quiet', base, tip, '--', d]).returncode != 0:
        sys.exit(f'REFUSED: {d} differs between {base[:8]} and {tip[:8]} — a re-point, not a re-measurement')
for name in ('readme', 'eof-live'):
    v = load('tip', name)
    if v:
        sys.exit(f'REFUSED: {name} is an equality with empty and is not empty at the tip: {v} — repair by content')
untouched = load('tip', 'untouched')
if untouched:
    print(f'!! failing citations point into files TOUCHED does not name: {untouched}')
    for f in untouched:
        stat = git('diff', '--shortstat', f'{base}..{tip}', '--', f).strip()
        print(f'   {f}: this range changed it: {stat or "NO — a document defect: report it, never add it to TOUCHED"}')

changed = set(git('diff', '--name-only', f'{base}..{tip}').split())
def file_of(key):  # 'doc:line file:from-to' or 'file:from-to'
    return key.split(' ', 1)[-1].rsplit(':', 1)[0]
cited = sorted({file_of(k) for k in load('base', 'line') + load('tip', 'line') + load('base', 'files') + load('tip', 'files')
                + load('base', 'rows') + load('tip', 'rows')})
grew = [f'`{f}` {lines_at(base, f)} -> {lines_at(tip, f)} lines' for f in cited if f in changed]
readme_moved = 'README.md' in changed

def note(entered, left, extra=''):
    body = (f'RE-MEASURED at {WAVE}, S6-R11 (base {base[:8]}, tip {tip[:8]}). '
            'The compaction-card spec and plan are byte-identical at both, checked; '
            + ('README changed in prose that cites nothing and in the anchors re-anchored BY CONTENT beside it '
               '(its own entry is empty at the tip); ' if readme_moved else '')
            + 'so nothing was re-pointed and no rule changed. What moved is this range\'s growth under frozen anchors: '
            + ('; '.join(grew) if grew else 'no cited file changed') + '. '
            + extra
            + (f'Entered: {", ".join(f"`{e}`" for e in entered)}. ' if entered else 'Nothing entered. ')
            + (f'Left: {", ".join(f"`{e}`" for e in left)}. ' if left else 'Nothing left. ')
            + 'Measured by diffing the dumped failure sets of the two trees, never retyped. No D-number.')
    return '\n'.join('    // ' + l for l in textwrap.wrap(body, 104))

moved = False
b, t = load('base', 'byfile'), load('tip', 'byfile')
bt, tt = load('base', 'total'), load('tip', 'total')
diff = {k: (b.get(k, 0), t.get(k, 0)) for k in sorted(set(b) | set(t)) if b.get(k, 0) != t.get(k, 0)}
print(f'== byfile / total: {bt} -> {tt}')
if diff:
    moved = True
    for k, (x, y) in diff.items():
        print(f'   {k!r}: {x} -> {y}')
    lb, lt = Counter(load('base', 'line')), Counter(load('tip', 'line'))
    ent, lft = sorted((lt - lb).elements()), sorted((lb - lt).elements())
    print(note(ent, lft, f'Headline {bt} -> {tt}. '))
    print(f'   and above `expect(total, …).toBe({tt})`, appended to its narration:')
    print(f'    // -> {tt} at {WAVE} (S6-R11: the note above the map names what moved).')
else:
    print('   unchanged')

for name in ('files', 'files-only', 'rows', 'sites', 'eof'):
    bl, tl = load('base', name), load('tip', name)
    cb, ct = Counter(bl), Counter(tl)
    ent, lft = list((ct - cb).elements()), list((cb - ct).elements())
    print(f'== {name}: {len(bl)} -> {len(tl)}')
    if bl == tl:
        print('   unchanged')
        continue
    moved = True
    if not ent and not lft:
        print('   SAME ENTRIES, NEW ORDER — rewrite the literal in tip order:')
        for e in tl:
            print(f"      '{e}',")
    for e in ent:
        i = tl.index(e)
        where = 'FIRST in the literal' if i == 0 else f"directly after '{tl[i - 1]}'"
        print(f"   ENTERS: '{e}' — insert {where}")
    for e in lft:
        print(f"   LEAVES: '{e}' — delete its line")
    print(note(ent, lft))
print('\nnothing moved — no literal edit, no note' if not moved else '\nedit each moved literal as listed, paste its note above it, then run the real file')
PY
python3 "$S/s6r11.py" "$S" "$BASE" "$TIP"
```

Read what it prints, in this order:

1. **`REFUSED: readme …`** — Step 6 did not empty it: rerun Step 6 against the entries it names.
2. **`REFUSED: eof-live …`** — a citation now names a line past its file's end. This wave only grows the files the corpus cites, so this is a finding: stop and report it to the coordinator with the entry.
3. **`REFUSED: … differs between …`** — a compaction-card corpus document changed in this range. That is a re-point, not a re-measurement, and S6-R11 does not cover it: stop and report.
4. **`!! failing citations point into files TOUCHED does not name`** — for each file the script says this range changed, add it to `TOUCHED` (`session-hook.test.ts:8405-8428`) with a comment in that list's own shape: ``// `<file>`, MEASURED rather than assumed: the centralised-update W6 versioned-installs wave rewrote it, <the --shortstat the script printed> over <BASE>..<TIP>.`` For a file the script says this range did NOT change, do not add it: it is a document defect — report it to the coordinator as a finding.
5. **Every `== <literal>` block.** `unchanged` → leave that literal alone. Otherwise edit it in `server/test/session-hook.test.ts` exactly as listed, copying every entry string from the script's output (select and paste; never retype one):
   - `byfile`: each `'<file>': x -> y` line changes that key's number on its line in the `byFile` map (`:8089`); a key the tip no longer has is deleted, a new key is added as its own line. Paste the printed note directly above `expect(byFile, …)`. Change `toBe(<old>)` in `expect(total, …)` (`:8400`) to the printed headline, and append the printed `// -> …` line to the narration directly above that `expect`.
   - `files`, `files-only`, `rows`, `sites`, `eof`: delete each `LEAVES` entry's line (the entry string is unique inside its literal — check with `grep -cF` over the literal's line range); insert each `ENTERS` entry on its own line exactly where the script says (`FIRST in the literal`, or `directly after '<entry>'`). A comment block in the literal that introduced ONLY an entry that now leaves stays — it is history — with one line appended to it: ``// LEFT at the centralised-update W6 versioned-installs wave (S6-R11).`` Paste the printed note directly above the literal's `expect(`.
   - `SAME ENTRIES, NEW ORDER` → rewrite that literal's entries in the printed order, keeping its comments with the entries they introduce.

   Every pasted note goes at or below `:8000` — they all do, being above literals at `:8089` and after — and none above `:7056`.

- [ ] **Step 8: The real file, green — and the control that it bites**

From inside `server/`, foreground:
```bash
./node_modules/.bin/vitest run test/session-hook.test.ts
```
Expected: PASS. A census literal that is still red names the entry that was mis-pasted — compare it with the script's output, never with a hand count. `session-hook` is a known load flake (CLAUDE.md): a red in a NON-census case is rerun in isolation before it is read as this task's.

The control: for one literal the script moved (if none moved, for `files`), delete one entry line and rerun `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'`. Expected: that literal's case reds. Restore the deleted line by re-pasting it from the script's output, not with `git checkout`, which would discard the uncommitted re-measurement. Rerun the same command: green. Then:
```bash
git add server/test/session-hook.test.ts
git commit -m "test(session-hook): re-measure the citation census over the W6 versioned-installs wave (S6-R11, derived from dumped failure sets)"
```
If nothing moved, there is nothing to commit; say so in the wave-done, with the script's `nothing moved` line.

- [ ] **Step 9: Every suite, the server's sharded**

CI's server leg installs `agent/` and `pwa/` modules too, because `typecheck-tests.test.ts` spawns their compilers; a workspace with only `server/node_modules` fails that one file rather than skipping it:
```bash
test -d agent/node_modules || (cd agent && npm ci --no-audit --no-fund)
test -d pwa/node_modules || (cd pwa && npm ci --no-audit --no-fund)
```
Then each in the FOREGROUND at the tool's maximum timeout (600000 ms), one command per call:
```bash
cd server && ./node_modules/.bin/vitest run --shard=1/4
cd server && ./node_modules/.bin/vitest run --shard=2/4
cd server && ./node_modules/.bin/vitest run --shard=3/4
cd server && ./node_modules/.bin/vitest run --shard=4/4
cd agent && ./node_modules/.bin/vitest run
cd pwa && ./node_modules/.bin/vitest run
```
Expected: all green. Record each summary line's file and case counts for the wave-done. Compare the sum of the four server shards with the latest `ci` run on `main` (`gh run list -b main -w ci --limit 1`, then `gh run view <id> --log | grep -E 'Test Files|Tests '`): this wave ADDS cases, so a server total at or below main's is a suite that ran less, not a green. A red in a known load flake (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) is rerun in isolation before it is called a break; a red anywhere else is this wave's until shown otherwise.

- [ ] **Step 10: The ledger guards**

```bash
git fetch origin main
cd server
./node_modules/.bin/vitest run test/deviation-refs.test.ts
./node_modules/.bin/vitest run test/dtbd.test.ts
./node_modules/.bin/vitest run test/topology-clean.test.ts
```
Expected: PASS, one call each. `deviation-refs` compares this branch's plan entries against `origin/main`'s without merging; a red names a number defined in two plans, which is the coordinator's to re-mint, not this task's to edit. `topology-clean`'s history-range scan reads every blob this branch introduces, Task 8's rehearsal record included.

- [ ] **Step 11: Every placeholder is an issued number**

```bash
git grep -nE '«dev:[a-z0-9-]+»' -- .
git grep -nE 'D-TBD-[a-z0-9]' -- docs/ server/ shared/ agent/ ccd/ README.md CLAUDE.md
```
Expected: both print nothing. The first pattern needs a real slug between the guillemets, so it matches neither its own command nor the `«dev:<slug>»` / `«dev:…»` forms this plan's prose keeps after the replacement. The second is `dtbd.test.ts`'s `PATTERN`, whose own `[` keeps it from matching itself. Ruling R12 has every planning-time placeholder in this plan, and in any `ccd/ccrc`, `ccd/ccd` or test comment copied from it, carry its issued number before Task 1 runs; this step verifies that. A departure Task 8 or a review added during execution was put to the coordinator for its number when it was written (Task 8, Step 14). If one remains, STOP and put it to the coordinator as a structured ask (worker skill), naming the slug and every file that carries it. Never allocate or type a `D-` number here: `POST /api/ledger/deviations` issues numbers, and a number written without being issued seals its band for good.

- [ ] **Step 12: Push and open the PR**

Check the commit identity first (the pre-push hook refuses identity residue, and a workspace can carry a placeholder identity):
```bash
git log --format='%an <%ae>' origin/main..HEAD | sort -u
git config user.name; git config user.email
```
Expected: one author line, equal to the configured identity, and that identity the operator's intended one. If not, STOP and ask — rewriting authorship is not this task's call.

```bash
git push
REPO_URL="$(gh repo view --json url --jq .url)"
PLAN=docs/superpowers/plans/2026-09-23-centralised-update-w6-versioned-installs.md
SPEC=docs/superpowers/specs/2026-09-20-centralised-update-management-design.md
{
  echo "Programme wave 6 (spec W5) of the centralised update management design: versioned installs."
  echo
  echo "- Spec: $REPO_URL/blob/main/$SPEC (section 11's Versioned installs paragraphs, its audit table and W5 pins; the W5 row of section 15; decision 18)"
  echo "- Plan: $REPO_URL/blob/main/$PLAN"
  echo
  echo "Delivers: each release installed as its own tree under ~/ccrc-versions/<name>/ with ~/ccrc a symlink flipped in one rename (_plat_ln_swap, both platforms); the one-time migration from a real ~/ccrc, kept as ~/ccrc.migrating until a gate passes, and its crash completion from ~/.ccrc/migrating-to; restore arm 1 and ccrc rollback by flip, with no download; a directory of its own for a staged release older than this layout; ccrc versions [--prune] and the GC that never removes the pointed-at, previous, projected, running or newest-N versions; uninstall's sweep; the audit table's satisfied rows walked through a symlinked fixture; the versions cap word."
  echo
  echo "Rehearsal (fixture half, against the real newest release and the one before it): $(grep -m1 '^\*\*Outcome:\*\*' "$PLAN" | sed 's/^\*\*Outcome:\*\* //') The live half is the coordinator's at rollout; its commands are in the plan's Rehearsal record."
  echo
  echo "Deviations defined in the plan:"
  grep -oE '^- \*\*D-[0-9]+\*\*[^.]*' "$PLAN" | sed 's/^- //'
  echo
  echo "Out of scope: server and PWA; deploy/deploy.sh and deploy/build-release.sh (deploy.sh writes through the link into the version it points at)."
  echo
  echo "Test plan: server suite (four shards), agent and pwa suites green locally (counts in the wave-done report); CI is the arbiter."
} > "$SCRATCHPAD/w6-pr-body.md"
```
Append the session's attribution line (from the system reminder) as the body's last line, then:
```bash
gh pr create --base main \
  --title "update: versioned installs — ~/ccrc-versions and the flip, the migration and its crash recovery, rollback by flip, ccrc versions (W6)" \
  --body-file "$SCRATCHPAD/w6-pr-body.md"
```
The body carries `blob/main` links only — never a docserver link.

- [ ] **Step 13: CI, and the wave-done**

```bash
PR="$(gh pr view --json number --jq .number)"
gh pr checks "$PR" --watch --fail-fast
```
Run it in the foreground and reissue it until it returns. Its exit is an answer, not an error: `0` is all green, `1` a failure (read the failing leg's log first — `gh run view --log-failed`), `8` still pending. Never end the turn to wait for CI; a session that does is not woken by the result. The macOS leg runs the server suite again, `_plat_ln_swap`'s Darwin arm included, and can take half an hour — reissue the watch; do not merge around it. If `main` moves before the merge, Steps 1 and 5–8 are rerun on the new merge: the census is BRANCH × MAIN and is only true on the tree it was derived on.

When green, report the wave-done per the `ccrc-worker` skill:
- the measured fingerprint (`git rev-parse HEAD` equal to `git ls-remote origin "refs/heads/$(git branch --show-current)"`);
- the PR number, and Step 9's counts;
- Step 8's census outcome (the literals that moved, or `nothing moved`) and Step 6's README re-anchors (old -> new, as printed);
- the rehearsal record's `**Outcome:**` line, verbatim.
The worker does not merge: `main`'s ruleset wants an approval nobody can give, so the operator merges with `--admin`. After the merge, the live half is the coordinator's. Its commands are the plan's `### The live half` block, which Task 8's record ends with: `rollout --check`, `rollout --to <W6_TAG>`, `rollout --check`, `ccrc versions` on each box, then the `--force` move that removes each box's `~/ccrc.migrating`.

