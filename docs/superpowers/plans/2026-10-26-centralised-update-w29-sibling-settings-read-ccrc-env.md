# Centralised update management, wave 29: the ccd-* sweeps read their settings from ccrc.env through ccrc's own reader, placed as one shared file: Implementation Plan

Wave 24 put ccrc's own settings on one reader, `_ccrc_knob`, so that a console update, the watchdog and a timer honour a line in `~/.ccrc/ccrc.env` and a setting survives a reboot without an `environment.d` fragment. It left one class out on purpose: the operator settings that the ccd-* sibling scripts read under their own timers. Those scripts never source `ccd/ccrc`, so sharing the reader needs a placed library file, a new install-census placement. Wave 24's Reading 9 put that to the coordinator, and ruling 9 carried it to "a later wave with a shared reader file" (wave-24 plan, `docs/superpowers/plans/2026-10-23-centralised-update-w24-settings-live-in-ccrc-config.md:79-92`, `:1118`, `:1172-1173`). This is that wave. It also takes three residue items the triage folded into it (R38, R45, R46); the coordinator's ruling 2 moved R48 and R50 (Tasks 8 and 9) out of the wave.

Every citation below is `path:line` at `origin/main` `ba36d7420`, read with `git show ba36d7420:<path>`. The worker re-reads each one in the landed text before the task that edits it (the absorb step). The wave's base is `ea1e84c09` (ruling 3): each citation is re-read there, and As built records any that moved.

**What was measured at `ba36d7420`.**

| Setting | Script | Read today | Used at | Unit |
|---|---|---|---|---|
| `CCRC_GRAPH_BUDGET` (8) | `ccd/ccd-graph-sweep:18` | `: "${X:=8}"`, environment only, never validated | `:1070-1071` (`[ "$BUILT" -ge … ]`, which a non-integer turns into a test error that never stops a build) | `ccd-graph-sweep.service`: oneshot, bare `ExecStart=%h/.local/bin/ccd-graph-sweep`, `TimeoutStartSec=5400` (8 builds × 600 s), `MemoryMax=6G`, no `EnvironmentFile=` |
| `CCRC_GRAPH_MAX_WORKERS` (4) | `ccd/ccd-graph-sweep:19` | the same | `:944` (`GRAPHIFY_MAX_WORKERS=`) | the same |
| `CCRC_KEEPALIVE_MODEL` (`haiku`) | `ccd/ccd-telemetry-keepalive:126` | the same | `:297`, `:605` (`--model`) | `ccd-telemetry-keepalive.service`: oneshot, bare `ExecStart`, `TimeoutStartSec=900` |
| `CCRC_KEEPALIVE_PROMPT` (`Reply with the single word: ok`) | `:127` | the same | `:604` (`-p "$CCRC_KEEPALIVE_PROMPT"`, one argv word) | the same |
| `CCRC_KEEPALIVE_FRESH` (1800) | `:125` | the same; validated by the loop at `:268-273` (exit 1, `must be a whole number`) | `:298`, `:687-710` | the same |
| `CCRC_USAGE_SWEEP_DAYS` (7) | `ccd/ccd-usage-sweep:22` | the same, never validated | `:65`, `:67` (`--days`) | `ccd-usage-sweep.service`: oneshot, bare `ExecStart`, `TimeoutStartSec=1800`, `MemoryMax=3G` |

None of the three units has a shell, an `EnvironmentFile=` or an `Environment=` line (`deploy/systemd/ccd-graph-sweep.service`, `ccd-telemetry-keepalive.service`, `ccd-usage-sweep.service`). So a line in `ccrc.env` never reaches these scripts today. Only the user manager's environment does, and a reboot loses it unless an `environment.d` file was written: the directive's own complaint. README documents the knobs at `README.md:530`, `:2988-2995` ("Raise `CCRC_KEEPALIVE_FRESH` in a drop-in"), `:3151` and `:5938`.

The keepalive header calls `CCRC_KEEPALIVE_FRESH` and `CCRC_KEEPALIVE_MODEL` "THE TWO KNOBS AN OPERATOR REACHES FOR" (`ccd/ccd-telemetry-keepalive:67-72`). That is why `CCRC_KEEPALIVE_FRESH` joins the five names the ledger row carries (Reading 5).

**The reader as it stands** (`ccd/ccrc`):
- `CCRC_SETTINGS=(…)` (:20569), seven names. `_ccrc_knob <KEY> <default> [file]` (:20613-20635) refuses any key outside that list.
- Precedence: a non-empty process environment wins; else `ccrc.env` through the whole-token awk scan and the byte-wise model `_box_unit_env`; else the default.
- Out-params: `KNOB`, `KNOB_FROM` (`environment|file|empty|default`) and `KNOB_WHY`. It never prints and never dies.
- Its closure is `_box_env_value` (:3191), `_box_env_shell_plain` (:3268), `_box_env_has_nul` (:3310), `_box_env_qopen`, `_box_env_unit_whole` (:3349), `_box_unit_env` (:3406) and `_box_unit_env_shell` (:3467), plus `BOX_ENV_FILE` (:1720).
- Those functions read `CCD_OS` and `CCRC_EXPOSURE_FILE` only through `${…:-}` guards. Measured: the code lines of :3191-3530 call no function outside this set.
- `ccd/ccrc` can be sourced. Its dispatch is guarded by `[[ "${BASH_SOURCE[0]}" == "${0}" ]]` (:27175), and `sourcedCcrc` (`server/test/ccrc-updateFixture.ts:1165`) relies on that.

**Why the reader cannot simply move out of `ccd/ccrc`.**
- Its closure sits at :3100-3530. Moving 430 lines there shifts every line below them.
- That moves the citation-debt map (`server/test/session-hook.test.ts:7763`, `'ccd/ccrc': 5` at :8636) and the `citations` ratchet.
- It also moves the slice rows that lift `_box_env_value` out of `ccd/ccrc` by name: `history-lib.test.ts:335` (O53), `deploy-env-guard.test.ts:262`, and the U rows of `ccrc-doctor-core.test.ts`.
- It moves wave 24's census too: its C8 reads those bodies in `ccd/ccrc`, and its C1 wants exactly one `CCRC_SETTINGS=` line there.
- So the shared file is a **generated copy**: derived from `ccd/ccrc` by one generator and held byte-equal to it by a test. It is never a second hand-kept copy (Reading 1).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. The dispatched worker runs it under the `ccrc-worker` skill. The brief carries only this wave's specifics: this plan's path, the task range, the claim groups and the wave's deviation block.

**Goal:** the ccd-* sweeps read six operator settings the way ccrc reads its own. The precedence is wave 24's: a set process environment wins, then `~/.ccrc/ccrc.env`, then the default. The sweeps read through `ccd/lib/ccrc-settings.sh`, ONE file generated from `ccd/ccrc`'s reader. The install spine places that file, its install census counts it, and uninstall removes it, on Linux and Darwin. So a value written only in `ccrc.env` reaches a sweep run by a unit with no shell and no `EnvironmentFile=`, and it survives a reboot. Each setting is documented in `deploy/ccrc.env.example`. Wave 24's census grows a sibling half that reds on any `CCRC_` read in a placed helper that is neither a setting read through the reader nor a reasoned exception.

**Architecture:**
- `ccd/lib/ccrc-settings.sh` (new, generated, 0644): the `BOX_ENV_FILE=` line, the `CCRC_SETTINGS=` line and the eight function bodies above, copied whole out of `ccd/ccrc` by `deploy/gen-settings-lib.mjs` (new). `server/test/ccrc-settings-lib.test.ts` (new) reds when the two differ. `ccd/ccrc` never sources it, and keeps its reader exactly where it is.
- Installed at `~/.local/libexec/ccrc/ccrc-settings.sh`, beside ccd's body (D-3696), by `_inst_bins` on every OS and role, and by `deploy/deploy.sh`'s agent arm. Removed by `_uninst_tree_bins`.
- Each sweep finds it beside itself first (`ccd/lib/…`, which is how the repository's suites run it), then in `~/.local/libexec/ccrc/`: the `transcript.jq` precedent (`ccd/ccd:17180-17185`). The two-line loader is spelled identically in each sweep. A missing or broken library stops the pass, exit 1.
- `ccd/ccrc`'s `CCRC_SETTINGS` gains the six names. Each sweep reads its settings with `_ccrc_knob NAME <default> && NAME="$KNOB"`, so every later use and message in the script is unchanged. A refused or invalid value stops the pass before its lock, exit 1, and never runs a default. The refusal line on stderr names the setting, where it came from (the environment or `~/.ccrc/ccrc.env`) and what was refused, so the unit's journal says why it failed (ruling 1).
- Wave 24's census (`server/test/ccrc-settings-census.test.ts`) reads the sweeps' calls for C2 and C4. A new describe extends C5, C6 and C8 to every bash executable `_inst_bins` places and to every node helper (`deploy/*.mjs`, `ccd/*.mjs`, `shared/*.mjs`). That is the extension wave 24 carried (its `:91`, `:1135`).
- **Why not `EnvironmentFile=%h/.ccrc/ccrc.env` on the three units:** wave 24 refused it for its timers: systemd's parse instead of the one reader, every secret in `ccrc.env` exported into the sweep and every child it starts (the keepalive runs `claude`), and a set environment could no longer win.

**Deploy class:**
- Box tooling only: `ccd/ccrc`, `ccd/ccrc-doctor-checks`, three sweeps, a new library file, `deploy/coordination-snapshot.mjs`, `ccd/ccd-update-sync`. Nothing on the wire changes, and nothing in the server, agent or PWA.
- It rides `ccrc update` to each box, and `_inst_bins` places the library BEFORE the sweeps it serves. So a new sweep never runs without its library, except on a box whose `_inst_bins` died between the two placements. That box refuses one pass loudly, exit 1, and the next `ccrc update --force` places both.
- An old sweep never sources anything. A downgrade below this wave leaves the library behind, unused. Only a wave-29-or-newer uninstall knows to remove it; an older build's uninstall leaves it and its directory behind.

**Landing order, as dependencies:**
- Task 1 (the library) depends on nothing.
- Task 2 (placement) needs Task 1's file.
- Task 3 (the sweeps) needs Tasks 1 and 2.
- Task 4 (the sibling census) needs Task 3.
- Tasks 5 to 7 (the folded residue) are independent of 1 to 4 and of each other. Task 5 shares `ccd/ccrc` with Tasks 1 to 3, so it runs after them. (Tasks 8 and 9 left the wave, ruling 2.)
- Task 10 is the gate and the PR.

One PR, from this workspace's own branch.

## PR #1404 (the ccd disk-retention library): not reused, not waited for

#1404 (OPEN, BLOCKED and conflicting with main at the time of writing; plan `docs/superpowers/plans/2026-10-25-ccd-disk-retention-library.md`) pins its one library's SHA-256 into ccd's body at install, through `ccd/ccd-entry-install.py`. Its runtime check, `_ccd_lib_load`, belongs to ccd's body alone. That mechanism fits a fixed library pinned to one stamped body. It does not fit three unstamped Linux timers. Reusing it would also tie this wave to an entry installer that #1404 is still rewriting. So this wave **does not reuse it and does not depend on it**. It lands on its own, in either order, and never edits `ccd/ccd`, `ccd/ccd-entry*.py` or `ccd/contexts.tsv`. To avoid conflicts:
- **Directory.** The installed path is `~/.local/libexec/ccrc/ccrc-settings.sh`, never #1404's `~/.local/libexec/ccrc/lib/`. #1404's `rmdir …/lib` and the existing `rmdir …/libexec/ccrc` (`ccd/ccrc:26824`) are untouched. This wave's `rm` runs before both, so each still removes only an empty directory.
- **Uninstall.** Its `rm -f` is a statement of its own, placed before the `~/.local/bin` `rm -f` block of `_uninst_tree_bins` (:26807-26820). It is never an operand added to the ccd-body `rm -f` (:26822-26823) or to the closing echo (:26825), which #1404 rewrites.
- **Backups.** No `_upd_backup_set` row (#1404 adds one beside :22870), and no `deploy.sh` backup line (#1404 rewrites :574).
- **Repository path.** `ccd/lib/ccrc-settings.sh` sits beside #1404's `ccd/lib/disk-retention.sh` under a different name.
- **README.** This wave's edits are the settings paragraph (:1282ff) and the four sweep paragraphs named in Task 3. If #1404 lands first, the absorb step re-reads its README hunks before Task 3.
- An integrity pin for this library (the `_plat_sha256` pattern) is a follow-up that can start once #1404 has merged (Reading 16).

## Not in this wave

Residue the triage did not fold, with its disposition:
- **R36** (deploy.sh `prune_backups` and the deploying machine's clock): closed. `deploy/deploy.sh:241-246` already protects the run's own directory by name (`grep -vxF -- "$TS"`).
- **R37** (`GET /api/updates` does not read the wave-17 `sweep` key): carried. It is a server inventory addition, and this wave changes no server code. It is an issue for a later server wave.
- **R39** (three CodeQL test-file alerts): closed. `server/test/raw-spawn-census.test.ts:138-139`'s `pat()` escapes the backslash, and the residue records the other two as fixed in wave 18.
- **R40** (`complete_inactive()` write order): closed. `server/test/codexLaneFixture.ts:795-799` writes the pid first.
- **R41** (`_inst_plist_server` for the fleet role): carried to a macOS install wave, unverified (`ccd/ccrc:17102`, :17152).
- **R42** (install describe 35 and ccrc-uninstall's codex row leave a fixture process alive at teardown) and **R50's fifth bullet** (ccrc-uninstall exits 1 on a leaked fake supervisor): carried as one test-teardown issue. This wave edits `ccrc-uninstall.test.ts` only in the rows Task 2 names. Its whole-file process-leak exit is main's, run by describe (Task 10).
- **R43** (five helpers resolve on `exit`): carried as one test-hygiene issue (`on('exit')` → `close`).
- **R44** (wave-31 text and pin nits): carried as stale history, for a small docs-and-test follow-up.
- **R47** (review-cap console control): closed. It shipped in #1524.
- **R49** (wave-24 record and comment nits): closed as accepted stale history. Task 3 rewrites the README settings paragraph, so its blank-budget sentence is re-read there and corrected only if that paragraph still carries it.
- **R48 and R50's first and fourth bullets (Tasks 8 and 9, with Readings 12 and 14 and every row those tasks own): not in this wave** (ruling 2). Both change behaviour outside the settings directive: the bootstrap's release-host defences and SHA256SUMS's one line, and the watchdog's wedged judgement (the critique notes that Task 9 trades judging too soon for never judging while the deadline reads undecided). Carried past closure to an issue the coordinator files.
- **R50, second bullet** (a console parent reads settings from the manager's environment while the detached child reads the file): not folded. The `--detach` parent's one release-host read is its asset probe, and the child repeats that probe on its own reading (wave-24 plan `:435`, "the parent's probe and the detached child's repeat"), so the child decides. Making the two read alike means the server spawning ccrc with a scrubbed environment (`server/src/update/spawn.ts`), which is a server change. Reading 12.
- **R50, third bullet** (the hard-cap term's 63 s also applies to a rollback by flip): no code change. The 63 s is the start chain's ceiling (wave-24 plan `:435`). On a flip it is at worst an earlier bound, so the bound errs early, never past the server's cap. Task 9 records that in `_bak_gc`'s header, comment only. Reading 13.

Other things this wave leaves out:
- **The other `CCRC_` reads in the sweeps and helpers** (call bounds, fixture paths, internal tuning: `CCRC_GRAPH_BUILD_TIMEOUT`, `CCRC_GRAPH_STALE_ESCAPE_COMMITS`, `CCRC_GRAPH_STALE_ESCAPE_SECS`, `CCRC_GRAPH_HOOKSTATE_FRESH_SECS`, `CCRC_KEEPALIVE_TURN_TIMEOUT`, `CCRC_KEEPALIVE_BACKOFF_AFTER`, `CCRC_KEEPALIVE_BACKOFF_BASE`, `CCRC_KEEPALIVE_BACKOFF_MAX`, `CCRC_UPDATE_SYNC_TIMEOUT`, `CCRC_POOL_SYNC_TIMEOUT`, `CCRC_HEALTH_URL`, `CCRC_HEALTH_TIMEOUT`, `CCRC_AUTH_*`, `CCRC_PROC_ROOT`, `CCRC_CGROUP_ROOT`, `CCRC_TREE`, `CCRC_RUNTIME_PIP_S`, `CCRC_RUNTIME_PROBE_S`, `CCRC_CODEX_PYTHON`, `CCRC_MODELS_PROBE_FIXTURE`, `CCRC_UPSTREAM`): they stay environment-only. Task 4's census classes each one with a reason, under wave 24's ruling 1, plus one new class, `tuning` (Reading 5).
- **`install.sh`'s `CCRC_RELEASE_BASE_URL`**: it stays environment-only, because the bootstrap runs before any `ccrc.env` exists. How it fetches is R48's, carried with Task 8.
- **A unit timeout derived from a raised budget.** `TimeoutStartSec` stays as shipped. The example says what raising `CCRC_GRAPH_BUDGET` or `CCRC_USAGE_SWEEP_DAYS` costs (Task 3, W29-S8). Reading 10.
- **Darwin sweeps.** The three sweeps stay unplaced on Darwin (the non-Darwin arm, `ccd/ccrc:16561`). The library is placed there all the same (Reading 3).
- **R38 beyond the named sites.** About 74 further `[[ =~ ]]` digit ranges in `ccd/ccrc` and 19 in `ccd/ccrc-doctor-checks` check internal formats (tags, pids, hashes), not operator values. They are carried as one issue (Reading 15).

## Global Constraints

- **Files:**
  - Source:
    - `ccd/ccrc`, `ccd/ccrc-doctor-checks` (the `box-settings` check's server-role line, ruling 4);
    - `ccd/lib/ccrc-settings.sh` (new, generated);
    - `deploy/gen-settings-lib.mjs` (new);
    - `ccd/ccd-graph-sweep`, `ccd/ccd-telemetry-keepalive`, `ccd/ccd-usage-sweep`, `ccd/ccd-update-sync`;
    - `deploy/deploy.sh`, `deploy/coordination-snapshot.mjs`, `deploy/ccrc.env.example`;
    - `README.md`, and this plan.
  - Tests:
    - new: `server/test/ccrc-settings-lib.test.ts`;
    - `server/test/ccrc-settings-census.test.ts`, `server/test/install-census.test.ts`, `server/test/ccrc-install-tree.test.ts`, `server/test/installTreeFixture.ts`, `server/test/ccrc-uninstall.test.ts`;
    - `server/test/graph-sweep.test.ts`, `server/test/telemetry-keepalive.test.ts`, `server/test/keepalive-freshness-parity.test.ts`, `server/test/usage-sweep-runner.test.ts`, `server/test/ccrc-doctor-codex.test.ts` (its box-settings describe, only where a row pins the full list of settings);
    - `server/test/ccd-update-sync.test.ts`, `server/test/coordination-snapshot.test.ts`, `server/test/ccrc-update-phases.test.ts`;
    - the inherited-env scrub lists: `server/test/ccrc-updateFixture.ts` (`updateEnv`), `server/test/ccrc-installFixture.ts` (`ccrcEnv`), `server/test/updateIntentFixtures.ts` (`nodeEnv`), and the ccrc-uninstall harness.
  - Never edited: `ccd/ccd`, `ccd/ccd-entry*.py`, `ccd/contexts.tsv`, anything under `server/src`, `agent/src` or `pwa/`. No restamp.
- **Functions this wave edits in `ccd/ccrc`** (the consent list):
  - the `CCRC_SETTINGS` line (:20569), in place, and its header (:20563-20568): Task 3;
  - `_inst_bins` (:16478): one `mkdir -p`, one `_inst_atomic` and one echo, placed immediately above the `if [ "$CCD_OS" != darwin ]; then` that opens the `ccd-cap-scopes` arm (:16561): Task 2;
  - `_uninst_tree_bins` (:26683): one `rm -f` statement and one echo, as described above: Task 2;
  - in place, one line for one line (Task 5, R38):
    - `cmd_wrappers` (:4507, :4660);
    - `_acct_candidates` (:6762);
    - `_codex_port_ok` (:12282);
    - `_upd_deadline_ms` (:20667);
    - `_upd_watchdog_probe_gap_s` (:20686);
    - `_upd_sweep` (:24124);
    - and every other `=~` digit range inside those seven bodies;
  - (`_upd_resolve`, `cmd_watchdog` and `_bak_gc`'s header left the list with Tasks 8 and 9, ruling 2.)

  No line is added or removed above `:16000`. The R38 edits at :4507, :4660, :6762 and :12282 are in place. No edit touches `_box_*` or `_ccrc_knob`, so the library is regenerated only for the `CCRC_SETTINGS` line (Task 3).
- **Claims, in groups, each taken whole when its group frees.** Re-read the live claims before each group with `ccrc-api claims list --project ccrc-pwa` (a read).
  - Group A (Tasks 1, 2, 3's `ccd/ccrc` line, 5): `ccd/ccrc`, `ccd/lib/ccrc-settings.sh`, `deploy/gen-settings-lib.mjs`, `deploy/deploy.sh`, `server/test/ccrc-settings-lib.test.ts`, `server/test/install-census.test.ts`, `server/test/ccrc-install-tree.test.ts`, `server/test/installTreeFixture.ts`, `server/test/ccrc-uninstall.test.ts`, `server/test/ccrc-update-phases.test.ts`, and the four scrub-list files.
  - Group B (Tasks 3, 4): the three sweeps, their four suites, `ccd/ccrc-doctor-checks`, `server/test/ccrc-doctor-codex.test.ts`, `server/test/ccrc-settings-census.test.ts`, `deploy/ccrc.env.example`, `README.md`.
  - Group C (Task 6): `ccd/ccd-update-sync`, `server/test/ccd-update-sync.test.ts`.
  - Group D (Task 7): `deploy/coordination-snapshot.mjs`, `server/test/coordination-snapshot.test.ts`.

  At the time of writing no open PR but #1404 touches a file in groups A to D. #1404 overlaps group A in `ccd/ccrc` and `deploy/deploy.sh`, and group B in `README.md`, at lines this plan avoids (above).
- **Growth.** `server/test/growthCheck.ts:48`, `GROWTH_LIMIT = 40`, measured from the merge-base with `origin/main`.
  - `ccd/ccrc` is a listed file. This plan's estimate is about +5 net code lines: Task 2 +5, Tasks 3 and 5 zero (in place); Tasks 8 and 9 left the wave.
  - Read `server/test/growth-check.test.ts`'s list. If a sweep or `ccd/ccrc-doctor-checks` is listed, the same limit applies to it.
  - Measure with `GROWTH_CHECK=1 ./node_modules/.bin/vitest run test/growth-check.test.ts` after each task that edits a listed file.
  - No waiver is planned. Past 39, stop and report. The open route is the reviewed waiver ledger (D-6223), as its own commit, with a number from the wave's deviation block.
- **Citation debt and numeric citations.**
  - `session-hook.test.ts -t 'CITATION DEBT'` stays green. Since #1521 (ruling 3) it reads the two frozen documents against each cited file as it stood at the document's freeze commit, so an edit to `ccd/ccrc` no longer moves the debt map; README's own census is still read live and must stay empty, so no README line citation into a file this wave edits may stop resolving.
  - No line this wave adds to a source or test file carries `<file>:NNN` (`citations`). Cite a function, a `file#symbol` or a describe name.
  - The anchors in this plan are for reading, never for copying into a comment.
- **Pins this wave keeps green as they are:**
  - The path pin: `ccrc-install-tree.test.ts`, the describe `ccrc install: the env file is named once in the whole CLI`. The only non-`#` line of `ccd/ccrc` naming `.ccrc/ccrc.env` stays `BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"`. The library's copy of that line is not in `ccd/ccrc`, and that test reads `ccd/ccrc` alone.
  - The slices of `_box_env_value` (O53, deploy-env-guard, the doctor U rows), unchanged, because the function is unchanged.
  - Wave 24's C1 (exactly one `CCRC_SETTINGS=` code line in its `FILES`) and C8 (the awk fragment and the `${!` indirection only inside `_ccrc_knob`, in `FILES`). The library is never added to `FILES`. W29-L1 holds it equal instead.
  - The keepalive's first code line, `set +x` (its SECRETS control). Its loader and its knob lines come after it.
  - `graph-noise-ship.test.ts`'s window beside `deploy.sh`'s `ccd-graph-sweep` line. `deploy.sh`'s new placement is never inside it (Task 2).
  - The two `install: bins:` closing lines of `_inst_bins` (:16649, :16651), unchanged. The library gets a line of its own.
  - `deploy/ccrc.env.example:19` stays `CCRC_FLEET=local` (`lifecycle.test.ts:405`). The example only gains lines at its end.
  - `agent/test/deploy-verify.test.ts`'s `toContain` reads of the example.
- **Pins this wave changes on purpose:**
  - `keepalive-freshness-parity.test.ts`: `KEEPALIVE_BROAD` and `KEEPALIVE_NARROW` move from the `: "${CCRC_KEEPALIVE_FRESH:=N}"` spelling to `_ccrc_knob CCRC_KEEPALIVE_FRESH N && …` (Task 3). The two-tier rule (exactly one broad match, then the narrow shape) is kept, and the default still ends where its digits end.
  - Wave 24's census header SCOPE paragraph, and its C2 and C4, which read the sweeps' `_ccrc_knob` calls (Task 3).
  - Any box-settings row of `ccrc-doctor-codex.test.ts` that pins the whole unset list, which gains the six names.
  - Any `ccrc-uninstall.test.ts` row that pins `_uninst_tree_bins`' exact output, which gains the library's line.
  - The as-built note lists every row so changed, with its old and new assertion.
- **Fixture HOMEs only.**
  - Every `ccrc`, sweep or sourced-function spawn runs under a `mkdtemp` HOME, quoted.
  - Never run `ccrc`, `ccd` or a sweep against the live HOME.
  - Never touch tmux, the live `systemctl --user` manager, `~/.ccrc`, `~/.cc-sessions`, `~/.cc-limits` or `~/.cc-secrets`.
  - Never read the live user manager's environment.
  - The sweeps' suites already spawn `bash <repo>/ccd/<sweep>` with `HOME` set to a fixture. That is how each finds `ccd/lib/ccrc-settings.sh` beside itself.
- **Hermetic env.**
  - The six names join every inherited-env scrub list where they are absent: `updateEnv`, `ccrcEnv`, `nodeEnv`, the ccrc-uninstall harness, and the three sweep harnesses (`runSweep` in graph-sweep.test.ts, `run` in telemetry-keepalive.test.ts, the runner spawn in usage-sweep-runner.test.ts). Those spread `process.env` today, so a shell export of one would move a row.
  - Every reboot row spawns with `env -i HOME=<home> PATH=<the row's PATH> TMPDIR=<home>/tmp`, plus the shims the row needs and never a `CCRC_` name.
- **Memory and vitest.**
  - Before any vitest run, read `anon` in the session slice's `memory.stat`, and run nothing while it reads above the programme's gate.
  - One file at a time, in the foreground, from inside `server/`: `./node_modules/.bin/vitest run test/<one>.test.ts --pool=forks --maxWorkers=1`, with `-t '<case>'` where a step names one.
  - A short real TMPDIR (`mkdir -p ~/.cc-tmp/w29`), and `timeout -s INT 560` around each run. Never bare `npx vitest`.
- **Disk.** Every fixture is kilobytes. Task 7's thinning fixtures use the coordination-snapshot suite's existing small `coord.db` builders, never a copied real database.
- **The absorb step.**
  - Before each task's first edit: `git fetch origin main`, then re-read in the landed text every anchor the task names.
  - Rebase before the first push, merge after it. Never force-push a published branch.
  - Check whether a PR has landed with `gh pr view <n> --json state,mergeCommit`.
  - Land through the merge queue: `gh pr merge <n> --match-head-commit <sha>`.
- **Public repo.** Commits use the noreply identity. No hosts, IPs, home paths, lane, account or session names in code, comments, commits, the example or the PR body. Write `~`, `<home>`, "the server box", "the fleet box". Fixture accounts are `acct-a-demo` and `acct-b-demo`. A fixture mirror is `127.0.0.1` or `mirror.example`.
- **Deviations.** The wave's deviation block, issued at run open and named in the brief, is the only source of numbers. This plan defines none, and a departure the worker finds is recorded with a number from that block, in a `## Deviations found` section the worker adds.
- **Routing.** Execute natively, inside the subscription.
  - Implementer subagents run on `sonnet`, one per task.
  - The per-task reviewer and the whole-branch reviewer run on `opus`.
  - Scouts run on `haiku`.
  - The orchestrator reviews every diff. The wave-done fingerprint is this workspace branch's tip.

## Review Focus

- **A `ccrc.env` line written for systemd but not for the reader** (`export CCRC_GRAPH_BUDGET=4`, `CCRC_KEEPALIVE_PROMPT=say "ok"`). Until now the sweep ignored the file, so the line was harmless. From this wave the sweep refuses its pass, exit 1, and its unit shows failed. The doctor's `box-settings` (D-6599) names the line. Expected: both say why, and no pass runs a default. Tests: W29-G3 and W29-K6 (Task 3), and the doctor row W29-D1.
- **A stale `environment.d` file or drop-in shadowing a new `ccrc.env` line.** The environment wins (wave 24's order), so the sweep follows the stale value, while the doctor shows the file's. Expected: precedence exactly as ccrc's, never a merge. Tests: W29-G2 and W29-K3's environment case.
- **The library missing, or older than its sweep** (a half-finished install, or a downgrade followed by an upgrade of the sweeps alone). Expected: the pass refuses, naming `~/.local/libexec/ccrc/ccrc-settings.sh`, and does nothing. Tests: W29-G6, and the loader's single spelling (W29-S5), so every sweep behaves alike.
- **A prompt with spaces, a colon or quotes.** The default holds both a space and a colon. Expected: an unquoted value or one whole quote pair reaches `-p` as one argv word, exactly. A backslash or an inner quote refuses. Tests: W29-K1, K2, K6.
- **A budget raised past what its unit allows.** `CCRC_GRAPH_BUDGET=20` with `TimeoutStartSec=5400` gets a pass killed mid-build. Expected: the example says so, with the unit's own number. Test: W29-S8 derives 5400 from the unit file and reds when the example's block does not name it.

---

## File structure

- `deploy/gen-settings-lib.mjs` (new): the one generator; `settingsLibText()` and its CLI. Task 1.
- `ccd/lib/ccrc-settings.sh` (new): its output, committed. Task 1, and regenerated in Task 3.
- `ccd/ccrc`:
  - Task 2: `_inst_bins`, `_uninst_tree_bins`.
  - Task 3: `CCRC_SETTINGS` and its header.
  - Task 5: the seven validator bodies.
- `deploy/deploy.sh`: one `install_atomic` (Task 2).
- The three sweeps: the loader and the knob lines (Task 3), their validators (Tasks 3 and 5).
- `ccd/ccd-update-sync`: `redact()` and its header (Task 6).
- `deploy/coordination-snapshot.mjs`: `thinBackups`' pre-migration keep (Task 7).
- `ccd/ccrc-doctor-checks`: `_check_box-settings`, its server-role line (Task 3, ruling 4).
- `deploy/ccrc.env.example`, `README.md`: Task 3.
- Tests: as each task names.

## Tasks

A bash row sources a script into a fixture HOME through its suite's own helper. Every red and green below is *(unmeasured: the worker measures each)*, since no suite ran for this draft. Rows write fixture files with `writeFileSync`, using a `Buffer` where a byte matters.

### Task 1: the shared reader file, generated from `ccd/ccrc` (W29-a)

**Files:**
- Create: `deploy/gen-settings-lib.mjs`, `ccd/lib/ccrc-settings.sh` (its output), `server/test/ccrc-settings-lib.test.ts`.

**Interfaces:**
- Produces:
  - `export const SETTINGS_LIB_FUNCTIONS: readonly string[]`: `['_box_env_value', '_box_env_shell_plain', '_box_env_has_nul', '_box_env_qopen', '_box_env_unit_whole', '_box_unit_env', '_box_unit_env_shell', '_ccrc_knob']`, in `ccd/ccrc`'s order.
  - `export function settingsLibText(ccrcText: string): string`. The output is:
    - the fixed header (below);
    - the one column-0 line matching `/^BOX_ENV_FILE=/`;
    - a blank line;
    - the one column-0 line matching `/^CCRC_SETTINGS=\(/`;
    - a blank line;
    - each function's body, sliced `^name() {` through the first line that is exactly `}`, joined by one blank line, with a final newline.

    It throws `gen-settings-lib: ccd/ccrc defines <name> <0|2+> times` or `… <name>() never closes`, and the same for either line. It reads no environment.
  - CLI: `node deploy/gen-settings-lib.mjs [--check] [--ccrc <path>] [--out <path>]`. The defaults are `ccd/ccrc` and `ccd/lib/ccrc-settings.sh`, resolved from the script's own directory. Writing is atomic (a temp file, then a rename). `--check` exits 0 when the two are equal. Otherwise it exits 1, printing `gen-settings-lib: ccd/lib/ccrc-settings.sh is not ccd/ccrc's reader (first difference at line <n>) — run: node deploy/gen-settings-lib.mjs`.
  - The header is exactly these five lines:

```
# ccd/lib/ccrc-settings.sh — GENERATED from ccd/ccrc by deploy/gen-settings-lib.mjs; never edit it by hand.
# ccrc's one reader of its settings (`_ccrc_knob`) and the byte-wise model it reads through, copied whole out of
# ccd/ccrc, so the ccd-* sweeps, which never source ccd/ccrc, read ~/.ccrc/ccrc.env exactly as ccrc does. The argument
# for every rule is in ccd/ccrc, above each function. server/test/ccrc-settings-lib.test.ts reds when the two differ.
# Installed 0644 at ~/.local/libexec/ccrc/ccrc-settings.sh: sourced, never executed, and sourcing it runs nothing.
```

- [x] **Step 1: Write the failing rows** in `describe('W29: ccd/lib/ccrc-settings.sh is ccd/ccrc\'s reader, generated, never a second copy')`:
  - `it('W29-L1: the committed file is settingsLibText(ccd/ccrc), byte for byte')`: `readFileSync('ccd/lib/ccrc-settings.sh','utf8') === settingsLibText(read('ccd/ccrc'))`. The failure message names the generator command.
  - `it('W29-L2: the slice is closed')`. Every `_[a-z_]+` word in command position inside a sliced body is either a member of `SETTINGS_LIB_FUNCTIONS` or a bash builtin. Every member is defined exactly once in `ccd/ccrc`. This reds when `_ccrc_knob` starts calling a helper the slice does not carry.
  - `it('W29-L3: sourcing it alone under set -u defines the eight functions and the two names, and runs nothing')`. Spawn `bash --noprofile --norc -c 'set -u; . "$1"; compgen -A function; printf "%s|%s\n" "$BOX_ENV_FILE" "${CCRC_SETTINGS[*]}"' _ <lib>` with `HOME=<fixture>`. The functions printed equal `SETTINGS_LIB_FUNCTIONS` as a set, the last line is `<fixture>/.ccrc/ccrc.env|<ccd/ccrc's list>`, and stderr is empty.
  - `it.each(CASES)('W29-L4: the library and ccd/ccrc answer alike: %s')`. For each fixture `ccrc.env`, print `rc|KNOB|KNOB_FROM|KNOB_WHY` for `_ccrc_knob CCRC_BACKUP_KEEP 10` twice: once sourced from `ccd/ccrc` (the `sourcedCcrc` idiom) and once from the library. The two lines must be equal. `CASES`:
    - absent;
    - `CCRC_BACKUP_KEEP=5`;
    - `CCRC_BACKUP_KEEP=`;
    - `export CCRC_BACKUP_KEEP=5`;
    - `CCRC_BACKUP_KEEP="5"`;
    - `CCRC_BACKUP_KEEP=5\`;
    - CRLF;
    - a NUL byte;
    - mode 000;
    - a dangling link;
    - a directory;
    - `# CCRC_BACKUP_KEEP=5` alone;
    - `OTHER=1` alone;
    - an environment value of 7 over a file value of 5;
    - and the key `CCRC_NOT_A_SETTING`.
  - `it('W29-L5: --check names the first differing line')`. On a temp copy with line 9 changed, `--check --out <copy>` exits 1 and stdout matches `/first difference at line 9/`. On an untouched copy it exits 0.
- [x] **Step 2: Run them red.** `./node_modules/.bin/vitest run test/ccrc-settings-lib.test.ts`. Expected: all red, because the module and the file are missing.
- [x] **Step 3: Implement** `deploy/gen-settings-lib.mjs`, then run `node deploy/gen-settings-lib.mjs` to write `ccd/lib/ccrc-settings.sh`. Before writing, run `git grep -n 'ccd/lib' -- server/test agent/test .github`. If a suite lists the files under `ccd/lib`, it gains the new file in this commit (`installTreeFixture.ts` waits for Task 2).
- [x] **Step 4: Run them green**, then `ccrc-settings-census.test.ts`, `history-lib.test.ts -t O53` and `deploy-env-guard.test.ts` (nothing in them moved), `raw-spawn-census`, `private-names` and `topology-clean`.
- [x] **Step 5: Mutation rows.**

  | Mutation | Expected red |
  |---|---|
  | change one byte of a body in `ccd/lib/ccrc-settings.sh` | W29-L1 |
  | drop `_box_env_qopen` from `SETTINGS_LIB_FUNCTIONS` | W29-L2 (a called function not sliced) and W29-L4 |
  | add `echo hi` as a top-level line of the library (and regenerate nothing) | W29-L1 and W29-L3 |
  | slice to the first `}` that is indented, not to `^}$` | W29-L1 or W29-L4 |
  | make `--check` always exit 0 | W29-L5 |
- [x] **Step 6: Commit.** `feat(ccrc): ccd/lib/ccrc-settings.sh, ccrc's settings reader generated whole from ccd/ccrc for the sweeps (wave 29)`.

### Task 2: the install spine places it, the census counts it, uninstall removes it (W29-b)

**Files:**
- Modify:
  - `ccd/ccrc`: `_inst_bins`, `_uninst_tree_bins`;
  - `deploy/deploy.sh`: one `install_atomic` line in its agent arm. It goes beside its ccd-pair placement, after the step that creates `~/.local/libexec/ccrc` (re-read which), and never inside `graph-noise-ship.test.ts`'s window beside the `ccd-graph-sweep` line (:677).
- Test: `server/test/installTreeFixture.ts` (its file list gains `'ccd/lib/ccrc-settings.sh'` beside `'ccd/lib/transcript.jq'`, :217), `server/test/ccrc-install-tree.test.ts`, `server/test/ccrc-uninstall.test.ts`, `server/test/install-census.test.ts`.

**Interfaces:**
- Consumes: Task 1's file.
- Produces: `~/.local/libexec/ccrc/ccrc-settings.sh`, mode 0644, on every OS and role. Install prints one line, exactly `install: lib: ccrc-settings.sh (the settings reader the ccd-* sweeps source) in $HOME/.local/libexec/ccrc`, with `$HOME` literal, as the `install: bins:` lines print it. Uninstall prints `uninstall: tree: ccrc-settings.sh removed from $HOME/.local/libexec/ccrc`.

- [x] **Step 1: Write the failing rows.**
  - `ccrc-install-tree.test.ts`, in the describe `ccrc install: the executables and files it installs`: `it.each(['linux','darwin'])('W29-I1: %s places the settings reader beside ccd\'s body, 0644, with its own line')`. The bytes equal the repository file, `statSync(...).mode & 0o777` is `0o644`, and the install line appears once. Also `it('W29-I2: a server-role box places it too')`.
  - `ccrc-uninstall.test.ts`:
    - `it('W29-I3: uninstall removes the reader, and ~/.local/libexec/ccrc with it only when that leaves it empty')`: with an operator's `~/.local/libexec/ccrc/mine` present, the file is gone, the directory and `mine` stay, and the uninstall line appears;
    - without `mine`, the directory is gone too.
  - `install-census.test.ts`: `describe('the libexec census: what _inst_bins places under ~/.local/libexec/ccrc, _uninst_tree_bins removes and deploy.sh places')`, with `it('W29-I4: the three sets are equal, ccd\'s body apart')`. Derive:
    - the `_inst_atomic` destinations in `_inst_bins` whose path is under `$HOME/.local/libexec/ccrc/`;
    - the `rm -f` operands in `_uninst_tree_bins` under the same directory;
    - and `deploy.sh`'s `install_atomic` destinations under `.local/libexec/ccrc/`.

    Compare the three sets by basename, excluding `ccd` (the body has its own census, D-3696, placed by the entry installer). Each difference is printed. No `TOOLCHAIN_EXECUTABLES` entry is needed: `gen-wrappers.mjs`'s orphan scan reads `~/.local/bin` alone (D-93). Re-read that before relying on it.
- [x] **Step 2: Run them red** (`-t 'W29-I'` in each file).
- [x] **Step 3: Implement.**
  - `_inst_bins`: `mkdir -p "$HOME/.local/libexec/ccrc" || _ccrc_die "cannot create \$HOME/.local/libexec/ccrc"`, then `_inst_atomic "$tree/ccd/lib/ccrc-settings.sh" "$HOME/.local/libexec/ccrc/ccrc-settings.sh" 644`, then the echo. All three go above the Darwin test, so they run on both platforms and before any sweep is placed.
  - `_uninst_tree_bins`: `rm -f -- "$HOME/.local/libexec/ccrc/ccrc-settings.sh" || _ccrc_die "removing the settings reader from \$HOME/.local/libexec/ccrc failed"`, then its echo. Place them before the `.local/bin` block's comment paragraph, so they run before `rmdir … libexec/ccrc` (:26824).
  - `deploy.sh`: `install_atomic ccd/lib/ccrc-settings.sh .local/libexec/ccrc/ccrc-settings.sh 644`.
  - No `_upd_backup_set` row (Reading 4).
  - **Why `_inst_bins` and not `_inst_files`** (ruling 4): `_inst_files` returns at once on a server-role box ("a server-role box hosts no sessions"), and W29-I2 places the library there too; and `_inst_bins` is where the sweeps the library serves are placed, so placing it there, above them, is what puts it on the box before any sweep that sources it.
- [x] **Step 4: Run them green**, then whole:
  - `install-census.test.ts`, `ccrc-install-tree.test.ts`, `ccrc-install-landing.test.ts`, `ccrc-install-units.test.ts`, `ccrc-install-role.test.ts`, `ccrc-versioned-audit.test.ts`, `gen-wrappers.test.ts`, `graph-noise-ship.test.ts`, `usage-sweep-deploy-ship.test.ts`, `transcript-jq-ship.test.ts`;
  - by describe: `ccrc-uninstall.test.ts -t 'W29-I3'`, and the describes naming `_uninst_tree_bins`;
  - from `agent/`: `test/deploy-verify.test.ts`;
  - then `growth-check` and `session-hook -t 'CITATION DEBT'`.
- [x] **Step 5: Mutation rows.**

  | Mutation | Expected red |
  |---|---|
  | drop the uninstall `rm -f` | W29-I3 and W29-I4 |
  | drop `deploy.sh`'s line | W29-I4 |
  | move the placement inside the non-Darwin arm | W29-I1 (darwin) |
  | mode 755 | W29-I1 |

  The reviewer also checks by eye that the removal is its own statement, not an operand of the ccd-body `rm -f` (#1404's line). No row can tell the two apart.
- [x] **Step 6: Commit.** `feat(install): place the settings reader at ~/.local/libexec/ccrc on every box, counted and removed (wave 29)`.

### Task 3: the sweeps read their six settings through it; the settings documented (W29-c)

**Files:**
- Modify:
  - `ccd/ccrc`: the `CCRC_SETTINGS` line, in place, now thirteen names: wave 24's seven, then `CCRC_GRAPH_BUDGET CCRC_GRAPH_MAX_WORKERS CCRC_KEEPALIVE_MODEL CCRC_KEEPALIVE_PROMPT CCRC_KEEPALIVE_FRESH CCRC_USAGE_SWEEP_DAYS`. Its header gains one sentence: the fleet box's sweeps read these names too, through `ccd/lib/ccrc-settings.sh`, which `node deploy/gen-settings-lib.mjs` regenerates after any edit to this line, to `_ccrc_knob` or to the `_box_*` model. That edit is comment-only above `_ccrc_knob`, at :20563, which is below :16000.
  - `ccd/lib/ccrc-settings.sh`, regenerated.
  - The three sweeps.
  - `deploy/ccrc.env.example`: a new block at the end of the own-settings section (after :322).
  - `README.md`:
    - the `**ccrc's own settings.**` paragraph (:1282ff), so it names all thirteen and the sweeps, with no count word;
    - :530 and :2988-2995: "Raise `CCRC_KEEPALIVE_FRESH` in a drop-in" becomes a `~/.ccrc/ccrc.env` line;
    - :3151 and :5938, each with "(a `~/.ccrc/ccrc.env` line, or the environment)".
  - `server/test/ccrc-settings-census.test.ts`:
    - a `SIBLING_FILES` constant (Task 4 defines its derivation; this task adds it with the three sweeps listed by hand, and Task 4 replaces the list);
    - `defaultsOf()` and C4's call scan read `FILES` and `SIBLING_FILES`;
    - the header's SCOPE paragraph says so.
- Test: `graph-sweep.test.ts`, `telemetry-keepalive.test.ts`, `usage-sweep-runner.test.ts`, `keepalive-freshness-parity.test.ts`, `ccrc-doctor-codex.test.ts`.

**Interfaces:**
- Consumes: Task 1's library, Task 2's placement.
- Produces, in each sweep:
  - **The loader.** These exact two code lines, placed after `set -uo pipefail` (in the keepalive, after line 2's `set +x` too) and before the first knob line:

```
_settings_lib="${BASH_SOURCE[0]%/*}/lib/ccrc-settings.sh"; [ -f "$_settings_lib" ] || _settings_lib="$HOME/.local/libexec/ccrc/ccrc-settings.sh"
. "$_settings_lib" 2>/dev/null && declare -F _ccrc_knob >/dev/null 2>&1 || { echo "${0##*/}: the settings reader is missing or broken (~/.local/libexec/ccrc/ccrc-settings.sh) — this pass did nothing; 'ccrc update --force' places it" >&2; exit 1; }
```

  - **Each knob line**, in place of its `: "${X:=d}"` line, exactly `_ccrc_knob NAME <default> && NAME="$KNOB" || { <refusal> }`, where the refusal prints `<prefix>: $KNOB_WHY — <suffix>` on stderr and exits 1. The prefix and suffix are each script's own:
    - `graph-sweep:` / `nothing was swept`;
    - `keepalive:` / `nothing was measured`, using `printf`, since `_ka_say` is defined only at :155;
    - `usage-sweep:` / `nothing was swept`.

    `$KNOB_WHY` already names the setting and the file (`<KEY> cannot be measured: ~/.ccrc/ccrc.env …`), which is ruling 1's source for a refusal of the reader.

    Defaults: 8, 4, `haiku`, `"Reply with the single word: ok"`, 1800, 7. The prompt's is double-quoted, which is how wave 24's `defaultsOf` reads a quoted default.
  - **New validation** (fail-closed, before the lock, explicit digits as R34 spelled `_keep_ok`):
    - `CCRC_GRAPH_BUDGET` matches `^[0123456789]{1,3}$` (0 rebuilds none);
    - `CCRC_GRAPH_MAX_WORKERS` matches `^[123456789][0123456789]?$`;
    - `CCRC_USAGE_SWEEP_DAYS` matches `^[123456789][0123456789]{0,2}$`.

    The refusal reads `<prefix>: NAME must be a whole number from <lo> to <hi> — got '<value, at most 32 bytes, each non-printable byte as ?>', as set in <the environment | ~/.ccrc/ccrc.env>; <suffix>` (ruling 1: the source is `KNOB_FROM`'s, in `_keep_knob`'s words), and the script exits 1. The keepalive's existing loop (:268-273) keeps validating `CCRC_KEEPALIVE_FRESH`; its digits are NOT already explicit (`^[0-9]+$` at :271, ruling 3), so Task 5 spells them, and for `CCRC_KEEPALIVE_FRESH` its sentence gains the same `, as set in …` source clause. Fix round 1 also proves FRESH representable with the freshness gates' own decimal `[ value -ge 0 ]` comparison, before the real work lock or any turn; overflow refuses with `must be a representable whole number` and that source clause. Zero and decimal leading zeros remain valid; no operational duration cap is added. The model and the prompt stay unvalidated, as today (Reading 7).
  - **The pause check comes first** (ruling 4). The usage sweep's setting reads go after its pause-file check (`[ -e "$PAUSE" ] && { echo "usage-sweep: paused …"; exit 0; }`), so a paused sweep stays paused, exit 0, even when `ccrc.env` is faulted. The same order holds for any sweep that checks a pause file before its work.
  - **Sweep headers** (ruling 4). Each sweep header that advises a drop-in for one of these settings is corrected to name a `~/.ccrc/ccrc.env` line (the keepalive's "CCRC_KEEPALIVE_FRESH=7200 in a drop-in", and its loop's "writing CCRC_KEEPALIVE_FRESH=30m in a drop-in").
  - **The doctor's `box-settings`** (D-6599) keeps its every-role rule and reports the six too. On a server-role box (ccrc.env's `CCRC_ROLE=server`), a sweep setting's part of its line says the sweeps do not run there (ruling 4).

- [x] **Step 1: Write the failing rows.** Each reboot row spawns under `env -i` (Global Constraints). Its fixture `~/.ccrc/ccrc.env` holds only the named line and is mode 0600.
  - `graph-sweep.test.ts`, `describe('W29: the sweep reads its settings from ~/.ccrc/ccrc.env through ccrc\'s reader')`:
    - `W29-G1` (the reboot case): two stale trees, the file says `CCRC_GRAPH_BUDGET=1` and the environment names no `CCRC_`. Then `outcomeOf(second)` is `skipped-budget` and its detail is `pass budget 1 reached`.
    - `W29-G2`: environment `CCRC_GRAPH_BUDGET=2` over a file value of 1 → both trees build.
    - `W29-G3`: file `export CCRC_GRAPH_BUDGET=1` → exit 1, and stderr matches `/^graph-sweep: CCRC_GRAPH_BUDGET cannot be measured: ~\/\.ccrc\/ccrc\.env names it on a line this reader does not take .* — nothing was swept$/m`. No `~/.ccrc/graph-sweep.json` is written and no engine runs.
    - `W29-G4`: file `CCRC_GRAPH_BUDGET=8x` → exit 1, with `CCRC_GRAPH_BUDGET must be a whole number from 0 to 999 — got '8x', as set in ~/.ccrc/ccrc.env; nothing was swept`.
    - `W29-G5`: file `CCRC_GRAPH_MAX_WORKERS=2` → the engine shim records `GRAPHIFY_MAX_WORKERS=2`.
    - `W29-G6`: the sweep copied to `<home>/.local/bin/` with no library under `<home>/.local/libexec/ccrc/` → exit 1, with the loader's line naming `~/.local/libexec/ccrc/ccrc-settings.sh`, and no census written.
  - `telemetry-keepalive.test.ts`, the same describe title with "keepalive":
    - `W29-K1` (reboot): the file holds `CCRC_KEEPALIVE_MODEL=sonnet` and `CCRC_KEEPALIVE_PROMPT=Say ok please`. The wrapper shim's argv has `--model` then `sonnet`, and `-p` then exactly `Say ok please`, one word.
    - `W29-K2`: `CCRC_KEEPALIVE_PROMPT="Reply: ok"` → `-p` `Reply: ok`.
    - `W29-K3`: `CCRC_KEEPALIVE_FRESH=7200` and an account reported 3600 s ago → no turn, with the skip detail `under CCRC_KEEPALIVE_FRESH=7200`. With the environment `CCRC_KEEPALIVE_FRESH=1800` too → a turn.
    - `W29-K4`: a mode-000 `ccrc.env` → exit 1, stderr names `~/.ccrc/ccrc.env is there but cannot be read`, `turns()` is `[]`, and there is no `keepalive.json`.
    - `W29-K5`: file `CCRC_KEEPALIVE_FRESH=30m` → the existing sentence `CCRC_KEEPALIVE_FRESH must be a whole number — got '30m'`, followed by `, as set in ~/.ccrc/ccrc.env`, exit 1.
    - `W29-K6`: `CCRC_KEEPALIVE_PROMPT=say "ok"` → exit 1, with stderr's `cannot be measured` clause, and no turn.
  - `usage-sweep-runner.test.ts`:
    - `W29-U1` (reboot): `CCRC_USAGE_SWEEP_DAYS=3` → the scanner shim receives `--days 3`, and stdout says `in the last 3 days`.
    - `W29-U2`: no `ccrc.env` → `--days 7`.
    - `W29-U3`: a dangling-link `ccrc.env` → exit 1, and the scanner never runs.
    - `W29-U4` (ruling 4): the pause file present and a dangling-link `ccrc.env` → exit 0, the paused line, and the scanner never runs.
  - `ccrc-doctor-codex.test.ts`, in wave 24's box-settings describe: `W29-D1: a sweep's setting is reported like ccrc's`. The file holds `CCRC_GRAPH_BUDGET=4`, so the result is PASS matching `/CCRC_GRAPH_BUDGET=4/`. With `export CCRC_GRAPH_BUDGET=4` instead, it is WARN, naming the line. `W29-D2` (ruling 4): with `CCRC_ROLE=server` and `CCRC_GRAPH_BUDGET=4` in the file, the line still reports the setting and says the sweeps do not run on a server-role box.
  - `keepalive-freshness-parity.test.ts`: the two regexes move to `/^[ \t]*_ccrc_knob[ \t]+CCRC_KEEPALIVE_FRESH[ \t]+[^ \t]+.*$/` (broad) and `/^_ccrc_knob CCRC_KEEPALIVE_FRESH ([0-9]+) && /` (narrow). The test's prose drops "in a systemd drop-in" for "a `~/.ccrc/ccrc.env` line". Its assertion against `SWAP_FRESH` is unchanged.
- [x] **Step 2: Run them red**, one file at a time (`-t 'W29'`). Then run wave 24's census whole. Once the list grows it is red at C4 (six settings that nothing in `FILES` takes) and at C2 (six settings with no example block and no README mention), and green again after Step 3's census and documentation edits. Record each row's measured state.
- [x] **Step 3: Implement.** In order:
  1. Edit the `CCRC_SETTINGS` line and its header, then run `node deploy/gen-settings-lib.mjs`.
  2. Edit the three sweeps.
  3. Make the census edits.
  4. Write the example's block. One `# KEY=` block per setting, each bounded as C2 bounds it:
     - `CCRC_GRAPH_BUDGET`: "How many graphs one ccd-graph-sweep pass rebuilds. Default 8; a whole number from 0 to 999 (0 rebuilds none). Its unit allows 5400 s, eight builds of the 600 s build bound: a budget past 8 needs that unit's TimeoutStartSec raised too. A value the sweep cannot use stops the pass."
     - `CCRC_GRAPH_MAX_WORKERS` (Default 4; 1 to 99).
     - `CCRC_KEEPALIVE_MODEL` (Default haiku).
     - `CCRC_KEEPALIVE_PROMPT`: "Default Reply with the single word: ok. Written plain or in one whole pair of quotes; a backslash, or a quote inside the value, stops the pass."
     - `CCRC_KEEPALIVE_FRESH` (Default 1800 seconds; "the keepalive's interval and its spend").
     - `CCRC_USAGE_SWEEP_DAYS` (Default 7; 1 to 999; "the scan's time and memory grow with it, inside its unit's 1800 s and 3G").

     The block's lead says that these are read by the fleet box's sweeps, under timers with no shell of yours, so a lasting setting belongs here.
  5. Edit the README. The settings paragraph names the thirteen and says the sweeps read them through `ccd/lib/ccrc-settings.sh`, ccrc's own reader generated from `ccd/ccrc`. Re-read every other README line naming one of the six (`git grep -nE 'CCRC_(GRAPH_BUDGET|GRAPH_MAX_WORKERS|KEEPALIVE_(MODEL|PROMPT|FRESH)|USAGE_SWEEP_DAYS)' -- README.md`) and record each as checked or changed.
  6. Add the six names to every scrub list (Global Constraints).
- [x] **Step 4: Run them green**, then whole:
  - the three sweep suites, `telemetry-keepalive.test.ts`, `keepalive-freshness-parity.test.ts`, `graph-sweep.test.ts`, `usage-sweep.test.ts`, `usage-sweep-runner.test.ts`;
  - `ccrc-settings-census.test.ts`, `ccrc-settings-lib.test.ts`, `ccrc-doctor-codex.test.ts`, `ccrc-doctor-core.test.ts`;
  - `lifecycle.test.ts`, then `sed -n 19p deploy/ccrc.env.example`, which must still print `CCRC_FLEET=local`;
  - from `agent/`: `test/deploy-verify.test.ts -t 'ccrc.service reads'`;
  - `docs-parity`, `pools-prose`, `citations`, `private-names` and `topology-clean`.
- [x] **Step 5: Mutation rows.**

  | Mutation | Expected red |
  |---|---|
  | restore `: "${CCRC_GRAPH_BUDGET:=8}"` above the knob line | W29-G1 (the default then reads as the environment, so the file's 1 never counts); placed below it instead, Task 4's W29-S1 and W29-S2 red it |
  | drop `&& CCRC_GRAPH_BUDGET="$KNOB"` | W29-G1 |
  | `_ccrc_knob … file` in the keepalive | W29-K3's environment case |
  | treat the knob's rc 1 as the default | W29-G3, W29-K4, W29-U3 |
  | drop the budget validation | W29-G4 |
  | loader: drop the beside-itself lookup | every sweep row (the suites run the repository copy) |
  | loader: drop `declare -F _ccrc_knob` | W29-G6 with an empty library file planted |
  | regenerate nothing after the list edit | W29-L1 |
  | drop `CCRC_KEEPALIVE_PROMPT` from the example | C2 |
  | drop `CCRC_GRAPH_BUDGET` from `CCRC_SETTINGS` | W29-G1 (`_ccrc_knob` refuses a name outside the list) and C4 |
- [x] **Step 6: Commit.** `feat(sweeps): graph, keepalive and usage sweeps read their settings from ccrc.env through ccrc's reader (wave 29)`.

### Task 4: the census sees the sweeps and the helpers (W29-d)

**Files:**
- Modify: `server/test/ccrc-settings-census.test.ts`.

**Interfaces:**
- Consumes: Task 3's tree.
- Produces: `describe('W29: the ccd-* sweeps read their settings through the shared reader file, and every other CCRC_ name a placed helper reads is a reasoned exception')`.

- [x] **Step 1: Write the rows.**
  - **Inputs.**
    - `SIBLING_FILES`, derived (replacing Task 3's hand list):
      - every source `ccd/<name>` of an `_inst_atomic "$tree/ccd/<name>"` call in `_inst_bins` whose first line is a bash shebang;
      - plus `ccd/ccrc-models-probe` by name, which ccrc runs from its tree, never placed.

      Its code is `codeOf()` of each file.
    - `HELPER_FILES` (ruling 3: `ccd/*.mjs` matches only two files): the tracked `.mjs` files `ccd/ccrc` invokes, derived from its code lines (every `<dir>/<name>.mjs` path it names, resolved against the tree), so `ccd/history/cli.mjs` (named as `$CCRC_HERE/history/cli.mjs`) is in it. The worker measures the set at the base and lists it in As built.
    - `SIBLING_ENV_ONLY: Record<string, { cls: EnvOnlyClass; why: string }>`. If the census finds `CCRC_MODELS_AUTH_LIB` and `CCRC_AUTH_NO_MAIN` at the base, each is listed with its reason (ruling 4). `EnvOnlyClass` gains `'tuning'`, a sweep's internal policy number its header does not offer an operator, overridable for tests. It holds every name `envReads()` finds in `SIBLING_FILES` outside `SETTINGS` and outside `ENV_ONLY`, each with a one-sentence reason naming the header or function. The worker measures the set at the absorbed tip. At `ba36d7420` it includes the names in "Not in this wave".
    - `HELPER_ENV_ONLY` gains the helper names a scan finds (`/process\.env(?:\.|\[['"])(CCRC_[A-Z0-9_]+)/g`), each with a reason. At `ba36d7420` these are `CCRC_SIGSTORE_TRUSTED_ROOT` (kept, `deploy/verify-provenance.mjs`) and `CCRC_RECALL_ARM`, `CCRC_RECALL_ASOF`, `CCRC_RECALL_SESSION` and `CCRC_SESSION_GENERATION` (class: per-run), all four in `ccd/history/cli.mjs` (ruling 3).
    - `LOADER`: the two lines of Task 3, as a constant.
  - **Rows.**
    - `it('W29-S1: every setting a sweep reads is taken once, as _ccrc_knob NAME <default> && NAME="$KNOB", and never expanded with a default')`:
      - for each `S` of `SETTINGS` named by a literal `_ccrc_knob` call in `SIBLING_FILES`, exactly one code line across those files matches `^_ccrc_knob S ("[^"]*"|\S+) && S="\$KNOB" \|\| \{`;
      - no line matches `\$\{S:?[-=+?]`;
      - no line above that one in its file expands `$S` or `${S`.
    - `it('W29-S2: every CCRC_ name a sweep reads from the environment is a setting or a reasoned exception, and every exception is still read')`:
      - `envReads()` over `SIBLING_FILES` is a subset of `SIBLING_ENV_ONLY ∪ ENV_ONLY`, and it never contains a member of `SETTINGS`;
      - every `SIBLING_ENV_ONLY` key is read in some sibling file;
      - no key is in both `SIBLING_ENV_ONLY` and `ENV_ONLY`.

      Both differences are printed.
    - `it('W29-S3: every CCRC_ name a node helper reads is in HELPER_ENV_ONLY, and no exception is documented as a ccrc.env line')`:
      - the scan over `HELPER_FILES` equals `HELPER_ENV_ONLY`'s keys, in both directions;
      - no `SIBLING_ENV_ONLY` or `HELPER_ENV_ONLY` name has a `^(# )?NAME=` line in the example.

      This extends C6.
    - `it('W29-S4: no sweep or helper reads ccrc.env but through the shared reader file')`. No code line of `SIBLING_FILES`:
      - names `ccrc.env` or `BOX_ENV_FILE`;
      - calls `_box_env_value`, `_box_unit_env`, `_box_unit_env_shell` or `_box_env_has_nul`;
      - defines `_ccrc_knob()` or a `_box_*()` function;
      - holds the fragment `index(t, k "=") != 1`;
      - or sources (`.` or `source`, in command position) a path that names `ccrc.env`, `BOX_ENV_FILE` or `.ccrc/`, other than `accounts.sh` (spelled `accounts.sh`, `ACCOUNTS_SH` or `cx_roster`), with `"$_settings_lib"` the one new entry.

      The sweeps already source things this row does not touch, and the wave edits none of them. At `ea1e84c09` these are the roster (`accounts.sh`) in `ccd-graph-sweep`, `ccd-usage-sweep`, `ccd-history-sweep`, `ccd-tmp-sweep`, `ccrc-codex` (`cx_roster`) and the account-auth and account-health helpers, and `$SECRETS_DIR/$acct-oauth.env` in `ccd-telemetry-keepalive`. They are out of scope: neither reads `ccrc.env`, and the row guards only that path.

      No `HELPER_FILES` line names `ccrc.env` beside a read call (`readFileSync`, `createReadStream`, `openSync`).
    - `it('W29-S5: the loader is one spelling, and comes before the first knob')`. Each sibling file holding a `_ccrc_knob` call holds `LOADER`'s two lines, byte for byte, once, above its first `_ccrc_knob`. A file with none holds no `_settings_lib`.
    - `it('W29-S6: a unit that runs a sweep reading a setting gives it no shell, no EnvironmentFile= and no CCRC_ environment')`. For each such sweep `<n>`, the code lines of `deploy/systemd/<n>.service`:
      - hold no `EnvironmentFile=`;
      - hold no `Environment=` naming `CCRC_`;
      - and hold exactly one `ExecStart=`, which is `ExecStart=%h/.local/bin/<n>`.

      With W29-G1, K1 and U1, this is the reboot proof. The unit hands the process only what the user manager holds, `env -i` models a manager holding no `CCRC_` name, and the value still arrives, from the file.
    - `it('W29-S7: a sweep assigns none of the reader\'s names')`. No sibling code line assigns `KNOB`, `KNOB_FROM`, `KNOB_WHY`, `BOX_ENV_FILE`, `CCRC_SETTINGS`, or a `BUE_*` or `BEW_*` name.
    - `it('W29-S8: the example\'s CCRC_GRAPH_BUDGET block names its unit\'s TimeoutStartSec')`. The number is read from `deploy/systemd/ccd-graph-sweep.service`'s `TimeoutStartSec=`, and the block must contain it followed by ` s`.
- [x] **Step 2: Run it.** Expected: green on Task 3's tree, except where a name is still unclassified. Record every row.
- [x] **Step 3: Mutation rows** (each measured red, then restored from a saved copy):

  | Mutation | Expected red |
  |---|---|
  | add `: "${CCRC_NEW_KNOB:=5}"` to `ccd/ccd-graph-sweep` | W29-S2 |
  | add `n="${CCRC_USAGE_SWEEP_DAYS:-7}"` to `ccd/ccd-usage-sweep` | W29-S1 and W29-S2 |
  | add `grep '^CCRC_GRAPH_BUDGET=' "$HOME/.ccrc/ccrc.env"` to the graph sweep | W29-S4 |
  | add `. "$HOME/.ccrc/ccrc.env"` to `ccd/ccd-usage-sweep` | W29-S4 |
  | add `process.env.CCRC_NEW_HELPER` to a `deploy/*.mjs` | W29-S3 |
  | add `# CCRC_GRAPH_BUILD_TIMEOUT=` to the example | W29-S3 |
  | change one character of one sweep's loader | W29-S5 |
  | add `EnvironmentFile=%h/.ccrc/ccrc.env` to `ccd-usage-sweep.service` | W29-S6 |
  | `ExecStart=/bin/sh -c '…'` in the keepalive's unit | W29-S6 |
  | add a fictitious `CCRC_GONE` to `SIBLING_ENV_ONLY` | W29-S2 (a stale exception) |
  | change the unit's `TimeoutStartSec=5400` to 6000 | W29-S8 |
- [x] **Step 4: Commit.** `test(ccrc): the settings census reads the sweeps and the node helpers (wave 29)`.

### Task 5: explicit digits in the validators of values ccrc reads from outside (R38, W29-e)

**Files:**
- Modify: `ccd/ccrc`, the seven bodies in the consent list, in place; and the keepalive's knob loop (`ccd/ccd-telemetry-keepalive:271`, `^[0-9]+$`), which is NOT already explicit (ruling 3). Task 3's three new sweep validators are written explicit.
- Test: `server/test/ccrc-settings-census.test.ts`, and `server/test/ccrc-update-phases.test.ts` (the watchdog describe, for the probe gap).

**Interfaces:**
- Produces: in those bodies, every `[[ … =~ … ]]` bracket range holding a digit range is spelled by enumeration (`[0-9]` → `[0123456789]`, `[1-9]` → `[123456789]`, `[0-9a-f]` → `[0123456789abcdef]`), the form R34 gave `_keep_ok` (:24962).

- [x] **Step 0: Measure the claim.** In a fixture, under `LC_ALL=C.UTF-8` (and `en_US.UTF-8` if the box has it), measure `[[ "$v" =~ ^[0-9]+$ ]]` for `v` in `²`, `٣` and `５`. Record each answer. If none is accepted, R38 is a text guard here, not a behaviour fix: W29-A2 is then a regression row that is green on both spellings, and the mutation discipline rests on W29-A1. Say so in the wave-done.
- [x] **Step 1: Write the rows.**
  - Census: `it('W29-A1: the validators of outside values spell their digits')`. In `ccd/ccrc`'s bodies `cmd_wrappers`, `_acct_candidates`, `_codex_port_ok`, `_upd_deadline_ms`, `_upd_watchdog_probe_gap_s`, `_upd_sweep` and `_keep_ok`, and in each sibling file's lines from its first `_ccrc_knob` through its last knob validation, no `=~` line matches `/=~[^\n]*\[[^\]\n]*[0-9]-[0-9]/`.
  - `ccrc-update-phases.test.ts`: `it.each(['²','٣','５'])('W29-A2: a non-ASCII digit is not a probe gap: %s')`. `_upd_watchdog_probe_gap_s` with `CCRC_WATCHDOG_PROBE_GAP_S=<it>` under `LC_ALL=C.UTF-8` prints `5` and the `is not digits-only — using 5` line.
- [x] **Step 2: Run them red**: W29-A1 red, and W29-A2 as Step 0 measured.
- [x] **Step 3: Implement**, in place, one line for one line. Then grep the suites for each old pattern's text (`git grep -nF '^[0-9]+$' -- server/test agent/test`, and the same for each other edited pattern), and re-run any suite that pins one.
- [x] **Step 4: Run green**, then `ccrc-wrappers*`, the account suites that drive `_acct_candidates`, the codex lane suites that drive `_codex_port_ok`, `ccrc-update-phases.test.ts`, `ccrc-update-flip-backups.test.ts`, `update-watchdog-revert.test.ts`, and `session-hook -t 'CITATION DEBT'`.
- [x] **Step 5: Mutation.** Restore `[0-9]` in `_upd_sweep`'s `vjobs` test: W29-A1 goes red.
- [x] **Step 6: Commit.** `fix(ccrc): enumerate the digits in the validators of values read from outside (wave 29, R38)`.

### Task 6: ccd-update-sync's mask covers a one-slash base, and its header says what it does (R45, W29-f)

**Files:**
- Modify: `ccd/ccd-update-sync`, `redact()` (:145) and its header (:131-144).
- Test: `server/test/ccd-update-sync.test.ts`.

**Interfaces:**
- Produces: `redact <text>` strips the userinfo of a URL whose scheme is followed by one slash or two (`scheme:/u:p@h` → `scheme:/h`, `scheme://u:p@h` → `scheme://h`), with the same authority class as today (never `/`, `?`, `#` or whitespace before the `@`). The header no longer says "the same two rules ccd/ccrc's `_upd_redact` applies". It says the script applies two of them, the home rule and the scheme rule, now for one slash or two, and never `_upd_redact`'s rule for a base with no scheme, because no base it prints lacks one.

- [x] **Step 1: Write the rows** in a new describe, `'W29: the sync never prints a URL\'s userinfo'`:
  - `W29-Y1`: `agent.env`'s server URL is `https:/u:hunter2@127.0.0.1:9/` (an unreachable port) → no stderr line contains `hunter2`, and the failure line contains `https:/127.0.0.1:9/`.
  - `W29-Y2`: the `://` case still masks (the existing shape, as a control).
  - `W29-Y3` (text): the header comment above `redact()` does not contain `the same two rules`.
- [x] **Step 2: Red**, then **Step 3: implement** (one more substitution, or one widened pattern, under the existing `extglob` guard), then **Step 4: green** and the whole file.
- [x] **Step 5: Mutation.** Drop the one-slash arm: W29-Y1 goes red.
- [x] **Step 6: Commit.** `fix(update-sync): mask userinfo after a one-slash scheme too, and say which rules apply (wave 29, R45)`.

### Task 7: the pre-migration keep is credited when a counted set already predates the migration (R46, W29-g)

This task changes backup retention, which the daily disk soak measures. The brief marks it, and the coordinator relays it to the soak before the PR enters the queue.

**Files:**
- Modify: `deploy/coordination-snapshot.mjs`, `thinBackups` (:1160): its `noteCounted` (:1188) and the pre-migration arm (:1338-1348).
- Test: `server/test/coordination-snapshot.test.ts`, beside W23-T27 and W23-T31.

**Interfaces:**
- Produces: `thinBackups` records the lowest `user_version` among the counted sets that have a `coord.db` (a header read through the `fs` seam, as `refUv` is read: no database open, no verification). The pre-migration keep (D-6358) runs only when that lowest value is not below `refUv`. When a counted set already predates the migration, the keep's purpose is met, so no fourth set is kept and no `kept <dir>: its coord.db predates a schema migration` line prints. The result's `kept` stays `counted + preMigration`.

- [x] **Step 1: Write the rows.**
  - `it('W29-T1: a counted set from before the migration is the pre-migration keep, so no fourth is kept')`. Four data sets, newest first, with `user_version` 5, 5, 4, 4, and keep 3. The result is `kept: 3`, the oldest is thinned, and no `predates a schema migration` line prints.
  - `it('W29-T2: with every counted set after the migration, the newest one before it is still kept')`. Versions 5, 5, 5, 4 and keep 3 give `kept: 4` and the existing line. This is D-6358's shape, unchanged.
  - `it('W29-T3: a counted set whose header cannot be read gives no credit')`. Versions 5, 5, an unreadable header, then 4, with keep 3. The pre-migration keep still keeps the 4.
- [x] **Step 2: Red** (W29-T1 only), then **Step 3: implement**, then **Step 4: green** and the whole file.
- [x] **Step 5: Mutation.** Drop the credit test: W29-T1 goes red.
- [x] **Step 6: Commit.** `fix(backups): a counted pre-migration data set is the pre-migration keep (wave 29, R46)`.

### Task 8: moved out of this wave (ruling 2)

R48 and R50's fourth bullet (the bootstrap's release-host defences, and SHA256SUMS held to one line on both paths), with Reading 14 and rows W29-H1 to W29-H6. Carried past closure to an issue the coordinator files. Its text stands in this plan's first commit.

### Task 9: moved out of this wave (ruling 2)

R50's first bullet (the watchdog and an undecided deadline) and its third bullet's `_bak_gc` header note, with Reading 13's comment and row W29-W1. Carried past closure with Task 8. Its text stands in this plan's first commit.

### Task 10: the gate and the PR

- [x] **Step 1: The landing tip.** `git fetch origin main`, then rebase (before the first push) or merge (after it). If #1404 has landed:
  - re-read its `_uninst_tree_bins`, `_upd_backup_set`, `deploy.sh` and README hunks;
  - re-run Task 2's rows and W29-I4;
  - and confirm that its `rmdir …/lib` still runs after this wave's `rm` and before `rmdir …/libexec/ccrc`.
- [x] **Step 2: The touched suites, one file at a time:**
  - every suite named in Tasks 1 to 7's Step 4;
  - `ccrc-update-flip-backups.test.ts`, `ccrc-update-kept.test.ts`, `update-intent-cross-side.test.ts` and `update-projection.test.ts` (users of `nodeEnv`);
  - `ccrc-doctor-fleet.test.ts` and `ccrc-doctor-exposure.test.ts`;
  - by describe: `ccrc-uninstall.test.ts`, the describes Task 2 touched (its whole-file process-leak exit is R42's, carried);
  - from `agent/`: `test/deploy-verify.test.ts`.
- [x] **Step 3: The repo guards.**
  - `GROWTH_CHECK=1 growth-check`, `citations`, `docs-parity`, the `single-definition/` suites, `topology-clean`, `private-names`, `dtbd`, `typecheck-tests`, `session-hook -t 'CITATION DEBT'`;
  - then `git fetch origin main` and `deviation-refs`.
  - Then `node deploy/gen-settings-lib.mjs --check`, which must exit 0.
- [ ] **Step 4: CI's reach.** The PR's `select tests` summary must list `ccrc-settings-lib.test.ts`, the four sweep suites and `install-census.test.ts`. If one is missing, ask for a `workflow_dispatch` full run (`gh workflow run ci.yml --ref <branch> -f mode=full`).
- [ ] **Step 5: The wave-done.** The fingerprint is this branch's tip. The PR body says:
  - the rule, and the six sweep settings;
  - the shared file: generated, where it is placed, and why it is not a move (citations and slices) and not #1404's mechanism;
  - the refusal behaviour (a refused or invalid setting stops the pass, exit 1, before the lock);
  - the census's sibling half and its classes;
  - each folded residue item with its row (R38, R45, R46);
  - the residue it did not fold, with dispositions (R48 and R50 carried by ruling 2, and the triage's others);
  - growth measured;
  - every pin changed on purpose;
  - and the operator's migration. On the fleet box, write each sweep setting as a `~/.ccrc/ccrc.env` line, read `ccrc doctor`'s `box-settings`, then remove any drop-in or `environment.d` line for these names, because a set environment still wins. This wave asks no act on a box.
- [x] **Step 6: Commit** the as-built note in this plan: `docs(plan): wave 29 as built`.

## Readings (for the coordinator to rule)

1. **The shared file is a generated copy, not a move.** Chosen: `ccd/lib/ccrc-settings.sh`, derived whole from `ccd/ccrc` by `deploy/gen-settings-lib.mjs` and held byte-equal by W29-L1. This meets "uses or matches exactly" without a hand-kept copy. The alternatives:
   - Move the reader into the library and have ccrc source it. That shifts about 430 lines above the citation-debt anchors, and breaks the O53, deploy-env-guard and doctor U slices and wave 24's C1 and C8.
   - Have each sweep source the tree's whole `ccd/ccrc`. That is 27,000 lines per pass, with its top-level side effects and its global names inside the sweep.
   - Slice at install time. The fallback installer, `deploy.sh`, would then need a second slicer.
2. **Where it lives.** Chosen: `~/.local/libexec/ccrc/ccrc-settings.sh`, beside ccd's body and outside #1404's `lib/`. A sweep finds it beside itself first, which is how the repository's suites run, the `transcript.jq` precedent. The alternatives: `~/.local/bin` (on PATH, and an orphan-scan entry), or the tree at `~/ccrc/ccd/lib/` (read across a symlink flip mid-update, at a version the placed sweep may not share).
3. **Placed on Darwin too**, as the brief requires, though no Darwin sweep reads it. `_inst_bins`' own rule against a no-op file (above `ccd-cap-scopes`) is about PATH, and this file is not on PATH. The alternative is Linux only, inside the non-Darwin arm.
4. **Not in the update backup set.** No sweep is in it. The library travels with the sweeps in `_inst_bins`, so whatever re-places a sweep re-places it. The alternative is a `_upd_backup_set` row (and, after #1404, a neighbour of its row).
5. **Which names are settings.** Chosen: the ledger row's five, plus `CCRC_KEEPALIVE_FRESH`, which the keepalive's header names as one of "the two knobs an operator reaches for" (as wave 24's ruling 8 took the models budget by its header). The keepalive's backoff numbers and the graph sweep's escape and freshness numbers become environment-only `tuning`, a new class, and the timeouts `call-bound`. The alternatives: the five alone, or the tuning numbers as settings too.
6. **A refused or invalid setting stops the whole pass**, exit 1, before the lock. That is the keepalive's own rule for a bad spend knob (`:262-273`), and it is never a default. The alternative is wave 24's per-act fallback (warn and use the default). It keeps a timer running, but it can spend or build on a value the operator did not set.
7. **New validation for the budget, the workers and the days**, which fail open today. Chosen: 0 to 999, 1 to 99 and 1 to 999. The model and the prompt stay unvalidated, as today. The alternative is to keep today's acceptance of any value.
8. **Write-back to the setting's own name** (`NAME="$KNOB"`), so every later use and message, and the rows that pin them, stay as they are. The alternative is a script-local name per setting, a wider diff.
9. **No per-pass line naming each setting's source.** The doctor's `box-settings` is the read-only door (D-6599). The alternative is one stderr line per pass, which costs exact-output rows in three suites.
10. **Unit timeouts stay fixed.** The example names the cost, and W29-S8 ties the budget block to the unit's number. The alternative derives `TimeoutStartSec` at install from the setting, which means a unit template.
11. **`install.sh` keeps reading `CCRC_RELEASE_BASE_URL` from the environment alone**, because it runs before `ccrc.env` exists. Its copied curl bounds are pinned by W29-H2. The alternative is a bootstrap that reads an existing `ccrc.env` when re-run on an installed box.
12. *(Moved out of this wave with Tasks 8 and 9, ruling 2.)* **R50's parent-versus-child reading is not folded.** The child's repeated probe decides, and equal readings need the server to spawn ccrc with a scrubbed environment. The alternative is a server wave that scrubs `CCRC_SETTINGS` names from the update spawn's environment.
13. **The 63 s hard-cap term stays on a rollback by flip.** It errs early. The alternative is a smaller term for a flip, measured from the flip's own start chain.
14. *(Moved out of this wave with Task 8, ruling 2.)* **SHA256SUMS must be one line**, refused otherwise, rather than checked through a filtered one-line copy. The release writes one line. The alternative tolerates extra lines and verifies only the tarball's.
15. **R38's scope.** Chosen: the seven named bodies, plus the sweeps' settings validators, guarded by W29-A1. About 93 internal-format ranges are carried. The alternative is a mechanical sweep of every `=~` range in `ccd/ccrc` and `ccd/ccrc-doctor-checks`, with a census over both files.
16. **No integrity pin on the library in this wave.** A digest pin like #1404's is a follow-up after #1404 merges. The alternative is to wait for #1404 and pin now.
17. **`keepalive-freshness-parity.test.ts` is rewritten to the new spelling**, keeping its two-tier count. The alternative leaves `CCRC_KEEPALIVE_FRESH` environment-only, which Reading 5 rejects.

## Coordinator rulings on this plan's readings (2026-10-26)

The coordinator read the readings, the critique and the task list, and rules as follows. The worker applies these rulings to this plan as its first edit after copying it, and records each change in As built.

1. **Readings 1 to 11, 13 and 15 to 17: as chosen.** Reading 6 also gets one requirement: the refusal line on stderr names the setting, where it came from (environment or file) and what was refused, so the unit's journal says why it failed.
2. **Tasks 8 and 9 (R48, R50) are not in this wave.** Both change behaviour outside the settings directive: the bootstrap's release-host defences, and the watchdog's wedged judgement. The critique notes that Task 9 trades judging too soon for never judging while the deadline reads undecided. Move both to "Not in this wave", carried past closure to an issue the coordinator files. Readings 12 and 14 go with them, and so do the rows those two tasks own. Task 10 keeps its number.
3. **The critique's corrections, applied:**
   - **The keepalive's knob loop is not already explicit.** At `ccd/ccd-telemetry-keepalive:271` it reads `[[ "${!knob}" =~ ^[0-9]+$ ]]`. Task 5 spells its digits too, and Task 3's "unchanged" sentence says so.
   - **Task 4's `HELPER_FILES`.** `ccd/*.mjs` matches only two files. Name the helper set the census reads by the scout's derivation (the `.mjs` files `ccd/ccrc` invokes), and say which files hold the `CCRC_RECALL_*` and `CCRC_SESSION_GENERATION` reads.
   - **The base.** This plan was written at `ba36d7420`, and main has moved since, through `ea1e84c09` and later. #1521 rewrote the citation-debt row: it now measures the frozen documents at their freeze commit. Re-read every cited line at your base, and correct the Global Constraints' citation-debt bullet to #1521's rule.
4. **The critique's notes, adopted:**
   - **The pause check comes first.** The usage sweep's setting reads go after its pause-file check (`ccd/ccd-usage-sweep`, about :38), so a paused sweep stays paused, exit 0, even when `ccrc.env` is faulted. The same order holds for any sweep that checks a pause file before its work.
   - **Sweep headers.** Each sweep header that advises a drop-in for a setting is corrected to name `ccrc.env`. For example, the keepalive's "CCRC_KEEPALIVE_FRESH=7200 in a drop-in".
   - **Environment-only names.** The list adds `CCRC_MODELS_AUTH_LIB` and `CCRC_AUTH_NO_MAIN`, each with its reason, if the census finds them at your base.
   - **Doctor's `box-settings` (D-6599)** keeps its every-role rule. On a server-role box, a sweep setting's line says the sweeps do not run there.
   - **Task 2's placement.** Task 2 states why `_inst_bins` places the library rather than `_inst_files`.
5. **#1404, as Reading 16 chose: no pin in this wave.** If #1404 merges before this PR, merge main, keep this wave's directory separate from #1404's `lib/`, and say so in As built.
6. **Load.** The fleet box is under the delegation broker's soak, with a tight budget for unmeasured hours. Run every suite one file at a time, at idle priority (`nice -n 19 ionice -c3`), and keep any subagent fan-out to two at once.

## Deviations found

Issued to this wave: D-6979 to D-6986. Each is defined below as the decision it names is made; an unused one is recorded as spare.

- **D-6979 — the settings reader the sweeps source is a generated copy of ccrc's, never a move and never a second hand-kept reader** (Task 1, Reading 1). `deploy/gen-settings-lib.mjs` slices the `BOX_ENV_FILE=` line, the `CCRC_SETTINGS=` line and the eight functions of `_ccrc_knob`'s closure whole out of `ccd/ccrc` into `ccd/lib/ccrc-settings.sh`; `ccd/ccrc` keeps its reader where it is and never sources the file. `server/test/ccrc-settings-lib.test.ts` holds the committed file byte-equal to the generator's output (W29-L1), the slice closed over what it calls (W29-L2), the file inert when sourced (W29-L3) and the two readers' answers equal over sixteen fixture cases (W29-L4), including a setting inside an unrelated multi-line quoted value (fix round 1, A2). Fix round 2 keeps the test programs on stdin with reader paths in positional argv (`bash -s --`); W29-L6 reads both real reader copies from filenames containing shell punctuation and requires the same file-sourced answer.
- **D-6980 — the reader is placed at `~/.local/libexec/ccrc/ccrc-settings.sh`, 0644, by `_inst_bins` on every OS and role and by `deploy.sh`'s agent arm, and removed by `_uninst_tree_bins`** (Task 2, Readings 2 to 4). `_inst_bins` places it above its Darwin test, so before any sweep it serves; not `_inst_files`, which skips a server-role box whole. Its removal is a statement of its own before the libexec `rmdir`, and there is no `_upd_backup_set` row. `deploy.sh` places it right after `install_ccd_pair`, whose installer creates the directory. Held by W29-I1 to W29-I4. The D-6051 describe's spine reader now also reads `_inst_bins`' placements outside `~/.local/bin` (a pin changed on purpose: without it, `deploy.sh`'s new line reds "the two installers place one set of paths").
- **D-6981 — the three sweeps read their six settings through the generated reader, and a refused or invalid one stops the pass** (Task 3, Readings 5 to 9, rulings 1 and 4). `CCRC_SETTINGS` gains `CCRC_GRAPH_BUDGET`, `CCRC_GRAPH_MAX_WORKERS`, `CCRC_KEEPALIVE_MODEL`, `CCRC_KEEPALIVE_PROMPT`, `CCRC_KEEPALIVE_FRESH` and `CCRC_USAGE_SWEEP_DAYS`. Each sweep sources the reader with the two-line loader (beside itself, else `~/.local/libexec/ccrc`) and reads each setting as `_ccrc_knob NAME <default> && NAME="$KNOB" || { refusal }`. A reader refusal prints its `KNOB_WHY`, which names the file; a validation refusal (budget 0 to 999, workers 1 to 99, days 1 to 999; the keepalive's freshness by its explicit-digit loop and its own decimal comparison's representability check, before any turn or work lock) names the setting, the value and `as set in <the environment | ~/.ccrc/ccrc.env>`. The graph sweep and the keepalive read before their lock; the usage sweep reads after its pause check and before its lock (the coordinator's answer to the worker's question: pause-first applies to the usage sweep only, whose pause check precedes its lock). The doctor's `box-settings` reports the six on every role, and on a server-role box a sweep setting the file sets, even an empty/default value, says the sweeps do not run there. Held by W29-G1 to G6, K1 to K9, U1 to U5, D1 to D3, the census's C2 and C4, and the parity pin's new spelling.
- **D-6982 — wave 24's census grows a sibling half, and its classes gain `tuning`** (Task 4, Reading 5, ruling 3). `SIBLING_FILES` is derived: the bash executables `_inst_bins` places, plus `ccd/ccrc-models-probe`. `HELPER_FILES` is the tracked `.mjs` files `ccd/ccrc` names in its code (fourteen at this tip; `ccd/history/cli.mjs` holds the `CCRC_RECALL_*` and `CCRC_SESSION_GENERATION` reads). `SIBLING_ENV_ONLY` classes the 23 names the siblings read outside the reader, `CCRC_MODELS_AUTH_LIB` and `CCRC_AUTH_NO_MAIN` among them, each with a reason; `HELPER_ENV_ONLY` adds `CCRC_MODELS_NOW` (read by `deploy/models-op.mjs` in the bracket form, which the plan's list missed) to the five the plan named. Rows W29-S1 to S9: S4 lets `ccrc.env` appear in a sibling only as the quoted tilde spelling, which bash never expands, because ruling 1's refusals name the file; its helper scan sees only a literal `ccrc.env` and a direct fs opener on the same line, not indirect reads (fix round 1, A3); S9 (new) holds the doctor's list of the sweeps' settings equal to what the sweeps take.
- **D-6983 — R38: the validators of values read from outside spell their digits** (Task 5, Reading 15, ruling 3). The seven `=~` lines of `cmd_wrappers` (two), `_acct_candidates`, `_codex_port_ok`, `_upd_deadline_ms`, `_upd_watchdog_probe_gap_s` and `_upd_sweep`, and the keepalive's knob loop (`^[0-9]+$`, which ruling 3 found not already explicit), are spelled by enumeration, in place. Step 0 measured that under `C.UTF-8` `[0-9]` refuses `²`, `٣` and `５`, while under `en_US.UTF-8` on Linux it takes all three, so this is a behaviour fix there: W29-A2 runs under `en_US.UTF-8` (skipped where `locale -a` lacks it), not `C.UTF-8` as the plan wrote, where it would be green on both spellings. W29-A1's scope is the seven bodies plus every sweep `=~` that tests a setting or the loop's `${!knob}`, rather than every line from the first knob to the last validation, which would sweep in the keepalive's internal `date` probe.
- **D-6984 — R45: ccd-update-sync's mask applies all three of `_upd_redact`'s rules** (Task 6). The plan kept it to two, "because no base it prints lacks a scheme"; the worker measured that false (agent.env's `CCRC_SERVER_URL` has no scheme check, curl takes `u:pass@host` as http, and the exit-6 line printed `u:hunter2@127.0.0.1:9` whole) and asked; the coordinator ruled to mask the scheme-less form too. So `redact` masks userinfo after a scheme and one or more slashes, under local `LC_ALL=C` so an invalid UTF-8 byte stays inside the authority class, and at a scheme-less token's start; that last rule's host may also end at `)` or the text's end, because this script strips the base's trailing `/` and closes its exit-6 clause with `)`, where `_upd_redact` wants `/`, `?` or `#`. The header says so, and the comment above `_upd_redact` in `ccd/ccrc` that said the sync applies two rules is corrected in place. Held by W29-Y1 (one slash), Y2 (the two-slash control), Y3 (the header), Y4 (no scheme), Y5 (three and four slashes) and Y6 (actual invalid-byte, scheme-less userinfo under an available UTF-8 locale); repeated-`@` and authority-boundary controls also remain (fix round 1, F1). Fix round 2 extracts that same real redactor into a fixture script, sources its positional path from a static stdin program, and passes the invalid-byte fixture path separately, never as command text; Y6 keeps its byte-exact output assertion and UTF-8 locale.
- **D-6985 — R46: a counted pre-migration data set is the pre-migration keep** (Task 7). `thinBackups`' `noteCounted` now reads every counted set's `coord.db` header through the file port (as `refUv` is read: no database open, no verification) and keeps the lowest `user_version`; the pre-migration keep (D-6358) runs only when no counted set already predates `refUv`. A header that does not read gives no credit. `kept` stays `counted + preMigration`. Held by W29-T1 (credited: no fourth set kept), W29-T2 (D-6358's shape, unchanged) and W29-T3 (no credit for an unreadable header). This changes backup retention, which the daily disk soak measures: the coordinator relays it to the soak before the PR enters the queue.
- **D-6986 — spare, unused.**
- **D-7500 (2026-10-29)** — the graph sweep leaves this wave: `ccd/ccd-graph-sweep` keeps reading `CCRC_GRAPH_BUDGET` and `CCRC_GRAPH_MAX_WORKERS` from its environment, as on `main`, because the ruled graphify r2 spec changes the budget's meaning (repository builds) and keeps a default on a bad value, and its GR2/GR4 read both through ccrc's reader (that plan's D-7358). `CCRC_SETTINGS` gains four names, not six; the doctor's `sweeps` line, the example, README and the scrub lists name four; rows W29-G1 to G6 and W29-S8 are gone, and W29-S2 classes the two graph names in `SIBLING_ENV_ONLY`.

## As built

**The coordinator's rulings, applied (second commit).** The first commit is the plan as the coordinator wrote it, byte for byte. The second applied the rulings section above:
- Ruling 1: the Goal's refusal sentence and Task 3's refusal text name the setting's source (`KNOB_WHY` for a reader refusal, `, as set in <the environment | ~/.ccrc/ccrc.env>` for a validation refusal); W29-G4 and W29-K5 changed to match.
- Ruling 2: Tasks 8 and 9 are stubs; R48 and R50 (first and fourth bullets), Readings 12 and 14, and rows W29-H1 to H6 and W29-W1 left the wave. `install.sh`, `install-sh.test.ts`, `ccrc-update-fetch.test.ts`, Group E, and the consent entries for `_upd_resolve`, `cmd_watchdog` and `_bak_gc` left the Global Constraints; the growth estimate fell to about +5; Task 10 reads Tasks 1 to 7.
- Ruling 3: Task 5 spells the keepalive loop's digits; `HELPER_FILES` is the `.mjs` set `ccd/ccrc` invokes, and the `CCRC_RECALL_*` and `CCRC_SESSION_GENERATION` reads are named as `ccd/history/cli.mjs`'s; the base is `ea1e84c09`, and the citation-debt bullet states #1521's rule.
- Ruling 4: the pause-first order (new row W29-U4), the sweep headers' drop-in advice, the two environment-only names, the doctor's server-role line (new row W29-D2, and `ccd/ccrc-doctor-checks` joins the files and Group B), and Task 2's reason for `_inst_bins`.
- Rulings 5 and 6: no pin (Reading 16 as written); the load rule is the brief's.
- The brief and the worker skill (clause 16) govern the absorb step: no rebase at any point, a merge only on a measured trigger, so the Global Constraints' "Rebase before the first push" does not apply.


**Wave 29 as built (Tasks 1 to 7 and 10), base `ea1e84c09`.** Commits on `ws/cu-w29-settings`, one per task, each with its D-number above. What differs from the plan's text, and why:
- **The pause check (ruling 4) holds for the usage sweep only.** The graph sweep and the keepalive check their pause file after their lock and write their census there, so their setting reads stay before the lock (Reading 6). The worker asked; the coordinator ruled "usage sweep only". New row W29-U4.
- **Task 3's refusals name their source (ruling 1)** as `, as set in <the environment | ~/.ccrc/ccrc.env>`, so W29-G4's and W29-K5's expected sentences carry that clause. New row W29-U5 (the days' new validation); W29-K4 now names `CCRC_KEEPALIVE_FRESH` and W29-G6 requires the loader's line for an empty library (each strengthened after a measured surviving mutant).
- **The doctor's `box-settings`** names the sweeps' six in one `local sweeps=" … "` line in `ccd/ccrc-doctor-checks`, which new census row W29-S9 holds equal to the settings the sweeps take. New rows W29-D1 and W29-D2.
- **Task 4.** W29-S4 lets `ccrc.env` appear in a sibling only as the quoted tilde spelling (never expanded), because ruling 1's refusals name the file; the plan's "never names `ccrc.env`" would have refused them. The helper half catches only same-line literal `ccrc.env`/fs-open calls; it does not trace history's `readRole` -> `readBounded(P.ccrcEnv)` -> `readBoxEnvValue(..., 'CCRC_ROLE')` seam, whose path and parser live in `ccd/history/lib.mjs`. This is a role read, not one of the six settings, and A3 changes only the guard's description, not its coverage. `HELPER_ENV_ONLY` gained `CCRC_MODELS_NOW`, which the plan's scan missed (`process.env['…']` in `deploy/models-op.mjs`).
- **Task 5.** Step 0 measured `[0-9]` taking `²`, `٣` and `５` under `en_US.UTF-8` and refusing them under `C.UTF-8`, so W29-A2 runs under `en_US.UTF-8` (skipped where the locale is absent). W29-A1 reads every `=~` testing a setting or the loop's `${!knob}`, not every line from the first knob to the last validation.
- **Task 6 (ruling on the worker's question).** The plan kept the sync's mask to two rules because "no base it prints lacks a scheme"; measured false, and the coordinator ruled the scheme-less form masked too. New row W29-Y4; `ccd/ccrc`'s comment above `_upd_redact` that described the sync's mask is corrected in place.
- **Task 2.** The D-6051 describe's spine reader reads `_inst_bins`' placements outside `~/.local/bin`, so `deploy.sh`'s new line has its counterpart there.
- **Task 1, initial handoff.** Mutant "drop `_box_env_qopen` from the list" (library regenerated) initially redded W29-L2 only: no W29-L4 case reached that function. Fix round 1 adds the missing unrelated multi-line quoted-value case and measures L4 red on an isolated library copy with only qopen removed, plus L1/L2 red; see its record below.

**Pins changed on purpose** (old → new):
- `keepalive-freshness-parity.test.ts`: `KEEPALIVE_BROAD` `/^[ \t]*:[ \t]+(["'])\$\{CCRC_KEEPALIVE_FRESH:=[^}]*\}\1$/` → `/^[ \t]*_ccrc_knob[ \t]+CCRC_KEEPALIVE_FRESH[ \t]+[^ \t]+.*$/`; `KEEPALIVE_NARROW` `/^: "\$\{CCRC_KEEPALIVE_FRESH:=([0-9]+)\}"/` → `/^_ccrc_knob CCRC_KEEPALIVE_FRESH ([0-9]+) && /`; its prose names a `~/.ccrc/ccrc.env` line, not a drop-in.
- `ccrc-settings-census.test.ts`: the header's SCOPE paragraph; C2's `defaultsOf()` and C4's literal-call scan read `SIBLING_FILES` too (`KNOB_CODE`); `HELPER_ENV_ONLY` became `{cls, why}` records; `EnvOnlyClass` gained `tuning`.
- `install-census.test.ts`: `spineFilePaths` reads `_inst_bins`' non-PATH placements; `OTHER_INST_ATOMIC_FNS._inst_bins`' reason says so.
- The inherited-env scrub lists (`updateEnv`, `ccrcEnv`, `nodeEnv`, the ccrc-uninstall harness's `verbEnv`) and the three sweep harnesses (`inherited()`) drop the six names.
- No `ccrc-doctor-codex.test.ts` or `ccrc-uninstall.test.ts` row pinned the whole settings list or `_uninst_tree_bins`' exact output, so none changed.

**README** (consent of the holder of its claim, by mail): the settings paragraph (no count word, the sweeps' six and the reader); the keepalive line near its timer list; the keepalive section's "Raise … in a drop-in" (now a `ccrc.env` line, a drop-in still winning); the usage sweep's and the graph pin's budget mentions. Its two other mentions of the six (the keepalive's model and freshness defaults) were checked and left.

**Growth.** `ccd/ccrc` +5 net code lines (Task 2's placement and removal; Tasks 3, 5 and 6 in place). No other listed file changed.

**Residue.** Folded: R38 (D-6983), R45 (D-6984), R46 (D-6985). Carried: R48 and R50's first and fourth bullets (ruling 2), and the triage's others as "Not in this wave" lists them.

**Deviations.** D-6979 to D-6985 are defined above. **D-6986: spare, unused.**

### Verification record

All local test commands ran one file at a time, in the foreground, under `nice -n 19 ionice -c3`, with one vitest worker and fixture HOMEs. The whole suite was **not run**, as the brief requires: the wave-done signal is `suite: unrun`. The table records individual files, not a claim that the whole suite is green. A skip count is shown where relevant.

| Area | Files and measured result |
|---|---|
| Generated reader and census | `ccrc-settings-lib`: 19 passed; `ccrc-settings-census`: 22 passed; `keepalive-freshness-parity`: 11 passed; generator `--check`: exit 0 |
| Sweeps | `telemetry-keepalive`: 43 passed; `usage-sweep-runner`: 10 passed; `usage-sweep`: 17 passed; `graph-sweep`: 93 passed, 2 skipped, then exit 1 on process-leak teardown (see below); its W29 describe alone: 6 passed, exit 0 |
| Install and removal | `install-census`: 34 passed; `ccrc-install-tree`: 67 passed, 3 skipped; `ccrc-install-landing`: 36 passed, 1 skipped; `ccrc-install-units`: 45 passed, 16 skipped; `ccrc-install-role`: 36 passed; `ccrc-versioned-audit`: 10 passed; `ccrc-uninstall` by describe: remove set 27 passed, versions root 7 passed |
| Install shipping | `gen-wrappers`: 31 passed; `graph-noise-ship`: 4 passed; `usage-sweep-deploy-ship`: 10 passed; `transcript-jq-ship`: 6 passed; agent `deploy-verify`: 120 passed |
| Doctor and lifecycle | `ccrc-doctor-codex`: 568 passed, 5 skipped; `ccrc-doctor-core`: 233 passed, 11 skipped; `ccrc-doctor-fleet`: 258 passed; `ccrc-doctor-exposure`: 173 passed, 4 skipped; `lifecycle`: 88 passed; `pools-prose`: 27 passed |
| R38 consumers | `ccrc-wrappers`: 62 passed; `ccrc-account`: 369 passed; `codex-lane-ports`: 10 passed; `ccrc-codex-lifecycle`: 107 passed; `ccrc-update-phases`: 249 passed, 6 skipped; `ccrc-update-flip-backups`: 258 passed; `update-watchdog-revert`: 16 passed; `ccrc-sweep-window`: 99 passed; `ccrc-sweep-deliberate-stop`: 8 passed |
| R45 and R46 | `ccd-update-sync`: 62 passed; `coordination-snapshot`: 1003 passed |
| Other update consumers | `ccrc-update-kept`: 120 passed; `update-intent-cross-side`: 9 passed; `update-projection`: 21 passed |
| Reader slices and portability | `history-lib -t O53`: 21 passed; `deploy-env-guard`: 27 passed; `raw-spawn-census`: 7 passed; `platform-hazards`: 6 passed, 6 skipped |
| Repo guards | `typecheck-tests`: 12 passed; `citations`: 4 passed; `docs-parity`: 54 passed; `topology-clean`: 60 passed; `private-names`: 47 passed; armed `growth-check`: 47 passed; `dtbd`: 1 passed; `deviation-refs`: 31 passed after fetch; `session-hook -t CITATION DEBT`: 1 passed |
| Single-definition, each file separately | advance-switches 47; ask-digest 147; child-reclaim 23; core-vocab 36; docs-l0 126; docs-ring 75; late-census 48; roster-bash 52; switches-history 118; update-stall 122; vocabularies 111; all passed |

**Two non-green process outcomes, disclosed.** `ccrc-install-units` first had one 20-second timeout in its worktree build-excludes row under load; the file rerun alone passed all 45 rows (16 skipped). A final whole-file `graph-sweep` run passed all 93 rows (2 skipped) but exited 1 because teardown found a surviving fixture `sleep 30`; a second isolated run did the same. A clean scratch checkout of fetched main `ccba6f9b6448db1b13c1be68f634650769788199` passed its 87 rows (2 skipped) and exited 1 on the same surviving `sleep 30`. Reported once to the coordinator as `main-red` (mail 10212), with no teardown change in this wave. The W29 graph rows pass alone with exit 0. The final handoff reports this check failure separately; it does not turn the unrun whole-suite signal green.

**Mutation outcomes.** Every row below was measured red, then its source was restored byte-identical from a saved copy and checked with `cmp`. The runs used the measured thread count plus 1500 for the process cap and `timeout -k 10 600`; no mutant survives in the tree.

| Task | Mutation and observed red |
|---|---|
| 1 | Change a library byte: L1 (also L4 and L5); drop `_box_env_qopen` and regenerate: L2 only; top-level echo: L1 and L3 (also L4 and L5); slice at an indented brace: L1 and L5; always-success `--check`: L5 |
| 2 | Drop uninstall removal: I3 and I4; drop fallback-deploy placement: I4; place only on non-Darwin: I1 Darwin; mode 755: I1 on both OSes and I2; drop the D-6051 spine-reader extension: its installer-set equality row |
| 3 | Restore a default above the knob: G1; drop write-back: G1; force file mode: K3; treat reader refusal as a default: G3, U3 and K4; drop budget validation: G4; drop beside-itself lookup: graph rows; drop `declare -F`: G6; stale generated settings list: L1; omit prompt from example: C2; omit budget from settings and regenerate: G1 and C4; drop doctor note: D2; move usage read above pause: U4 |
| 4 | New sibling knob: S2; direct days fallback: S1 and S2; grep or source config: S4; new helper knob or documenting an environment-only name as a setting: S3; change loader whitespace: S5; unit EnvironmentFile or shell ExecStart: S6; stale exception: S2; change unit timeout: S8; assign KNOB_FROM: S7; omit doctor's days entry: S9; unquoted tilde or expanded HOME read: S4 |
| 5 | Restore a digit range in vjobs: A1; probe gap: A2's three locale cases and A1; keepalive loop: A1 |
| 6 | Drop one-slash mask: Y1; drop scheme-less mask: Y4 |
| 7 | Drop counted-set credit test: T1; give credit to an unreadable header: T3 |

K4 and G6 initially let their individual mutants survive for a different refusal later in the script; their assertions were strengthened, then the same mutants were killed (details above). The initial helper closure mutant's L2-only result was disclosed rather than the plan's predicted L4 failure; fix round 1 adds and measures that missing L4 protection below.

**Final branch review.** One read-only Sonnet reviewer at high effort inspected Tasks 1 to 7, the rulings and As built at `fe606e832`. It found no correctness, regression or safety defect; it found extra EOF blank lines in four tests and the plan. Those were verified with the base-to-head whitespace check and removed in the final documentation commit. The census, W29 graph rows, full keepalive, usage runner and install census passed again after that whitespace-only cleanup. This is not the coordinator's held-out review.

**Landing and remaining gates.** Main was fetched and the merge-tree probe was clean against `ccba6f9b6`; #1404 was still open, unmerged, so no absorption was licensed or done. No source under `server/src`, `agent/src` or `pwa/`, no ccd body, bootstrap, watchdog command or delegation lane changed. CI reach can only be measured after opening the PR: Task 10 Step 4 remains pending in this frozen note, as does sending the fingerprint. If CI's selection misses a required file, the coordinator is asked for the full manual CI run. The coordinator also received the R46 backup-retention warning before any queue entry (mail 10212); no merge or rollout is this worker's act.

### Fix round 1 — review 1002, coordinator ruling 10244

The held-out review of `9d2666123` confirmed F1/F2 and four advisory corrections. Delivery 10244 returned run 985 to working and ruled all six corrections in scope. This round extends D-6979, D-6981, D-6982 and D-6984; no new number was allocated, and D-6986 remains spare. Tasks 8/9, bootstrap, watchdog commands, ccd's body and delegation files remain untouched.

- **F1, D-6984:** `ccd-update-sync` now uses `_upd_redact`'s `:(/+)` authority pattern in a loop under function-local `LC_ALL=C`. Three- and four-slash bases retain their slashes and lose userinfo. The independent invalid-byte case writes a real `0xff` in scheme-less userinfo and runs under an available `en_US.UTF-8` locale; it is skipped where that locale is unavailable, not silently measured in C. It ran here. One/two/no-scheme controls, repeated `@` runs and `/`, `?`, `#` authority boundaries remain covered. No new URL refusal or weakened header.
- **F2, D-6981:** the explicit-digit check remains; FRESH alone then must pass `[ "$CCRC_KEEPALIVE_FRESH" -ge 0 ]` with stderr suppressed, the same decimal numeric implementation its freshness gates use. This refuses arithmetic overflow rather than imposing a duration policy. `0`, `00`, `08`, `01800`, an overlong string representing 8, signed-64 maximum `9223372036854775807` and that maximum with a leading zero remain valid. `9223372036854775808` and `99999999999999999999` refuse from both file and environment, exit 1 with the source-aware `must be a representable whole number` line, before any turn, census or real work-lock open. K8 fixes its comparison clock so load cannot age its 8-second control out. K9 covers the maximum at the separate previous-attempt gate. The example documents representability and zero/leading-zero semantics. BACKOFF and TURN_TIMEOUT retain their pre-existing validation; no new policy or bound for them is claimed.
- **A1, D-6981:** the doctor's server-role sweep note applies to empty/default file values as well as nonempty file values. W29-D3 sits beside D2 and pins the empty arm.
- **A2, D-6979:** W29-L4 adds `OTHER="a` / `CCRC_BACKUP_KEEP=5` / `b"` as one multi-line quoted value. Both real readers must explicitly refuse the setting inside it, not only agree with each other. Removing qopen only from an isolated owned library copy makes this row fail open (`0|5|file|`) against the intact reader's quote-left-open refusal; L4 now reds. L1/L2 stay intact and also red on the omission. The production reader and generated file are unchanged.
- **A3, D-6982 (text only):** W29-S4's helper title/comment and this As built describe the actual same-line literal/fs-open scan. It does not follow the history role-reader seam through `P.ccrcEnv` and its own parser. No helper parser extraction or census rewrite.
- **A4 (text only):** a downgrade leaves the library unused, but only a wave-29-or-newer uninstall knows to remove it. An older build's uninstall leaves it and its containing directory behind. No old-build removal change.

**Red/green and bounded mutations.** Before either production fix, Y5 failed for both three/four slashes and Y6 failed independently on scheme-less invalid-byte userinfo; the three failures became seven passing W29 sync rows after the fix. F2's four overflow/source rows first returned 0 with `integer expression expected`; all now refuse before the work lock. D3 first lacked the server-role note, then passed. Separately, isolated owned copies measured these mutants serially, with a process cap of measured threads +1500 and `timeout -k 10 600` under idle CPU/IO priority: narrow the slash pattern to two slashes -> both Y5 rows red; remove local C locale -> Y6 red; bypass FRESH representability -> all four K7 rows red; remove qopen -> L4 red, plus L1/L2 red. Each copy was restored from its saved bytes and checked with `cmp` exit 0, then its selected restored rows passed. No shared production source was mutated. The Python-only generic mutation helper cannot execute these bash/TypeScript modules; the isolated-copy runs use the real vitest file instead. The qopen proof was first made before adding its independent refusal assertion, then repeated on the final test: L4 and L1/L2 red on removal, saved-copy/cmp restore, all 18 selected L1/L2/L4 rows passing again.

**Corrections during verification.** An added repeated-`@` control initially expected only the first run removed; the full sync file correctly returned `https://host` like `_upd_redact`, so that erroneous expectation was corrected to every run removed and the full file rerun. The read-only subagent initially alleged the quote case defaulted; the exact mutation logs disproved it and the allegation was withdrawn. It reported no remaining defect. These are verification corrections, not product changes.

All commands below ran serially, one file at a time, in the foreground, with `nice -n 19 ionice -c3`, a 600-second process bound, one worker and fixture HOMEs. No whole local suite ran: `suite: unrun`. The earlier graph-sweep process-teardown main-red remains the disclosed exit-1 result; this round does not rerun or repair its unchanged file and never claims it green.

| Fix-round file or gate | Result |
|---|---|
| `ccd-update-sync` | 65 passed, exit 0; invalid-byte locale row ran |
| `telemetry-keepalive` | 55 passed, exit 0 |
| `ccrc-doctor-codex` | 569 passed, 5 skipped, exit 0 |
| `ccrc-settings-lib` | 20 passed, exit 0 |
| `ccrc-settings-census` | 22 passed, exit 0 |
| `keepalive-freshness-parity` | 11 passed, exit 0 |
| `install-census` | 34 passed, exit 0 |
| `typecheck-tests` | 12 passed, exit 0 |
| `citations`, `docs-parity` | 4 and 54 passed respectively |
| `private-names`, `topology-clean`, armed `growth-check` | 47, 60 and 47 passed respectively |
| `dtbd`, `deviation-refs`, `session-hook -t CITATION DEBT` | 1, 31 and 1 passed respectively; deviation check after fetch |
| Single-definition files, separately | advance-switches 47, ask-digest 147, child-reclaim 23, core-vocab 36, docs-l0 126, docs-ring 75, late-census 48, roster-bash 52, switches-history 118, update-stall 122, vocabularies 111; all exit 0 |
| Generator `--check`, changed bash files `bash -n` | exit 0 |

**Handoff boundary.** The original handoff was mail 10216 for PR #1578; the original branch is no longer the review fingerprint after this authorized round. The parent reports full CI run 40342231699 belongs to the old tip; its result is not evidence on this new tip. New-tip CI reach and the next separate review remain coordinator gates after the one fix-round push. Claims 2586/2587 are retained. A fetch measured `origin/HEAD` at `865e1833ba7023a31b2f6c3205d7bd6b4ee112cc`; merge-tree exit 0, so no absorption is licensed or done. R46's retention warning remains sent before any queue entry; this round changes no retention logic. No queue, merge or deployment is claimed.

### Fix round 2 - CodeQL test-helper constructions, coordinator ruling 10315

The coordinator accepted review 1005 at `8511d56ed`: F1/F2 and A1-A4 addressed, with N1-N4 carried. The coordinator also reports that the required checks passed after the one retry and full run 40354385997 ran all six required files on that fingerprint. Those are prior-tip results, not evidence for this round's new fingerprint. The fresh landing check found two open `js/shell-command-injection-from-environment` alerts (202 and 203), with unresolved review threads, even though the CodeQL check was green. Delivery 10315 returned run 985 to working for the two named test constructions only; no product source change, alert dismissal, suppression or thread resolution is authorized.

**Measured paths and bounded change.** The actual SARIF data flows from JavaScript/TypeScript analysis 2028969029 are `REPO` -> `CCRC`/`LIB` -> helper args -> spread positional argv at the settings-library spawn, and `mkTmp` -> `home` -> `join(home, 'url')` -> positional argv at Y6's spawn. Both prior programs already used quoted positional expansion: neither reported path was interpolated into the shell program. No pre-fix path-injection exploit is claimed. This round changes the construction to make the program/data separation explicit without a shared helper rewrite:

- **D-6979:** the local settings-test helper runs `bash --noprofile --norc -s --`, supplies each existing literal probe through stdin and keeps source paths/settings keys in positional argv. L1-L5 and all sixteen L4 cases remain. New L6 copies each real reader to a fixture filename containing spaces, both quote characters, literal command-substitution spelling and a glob, then requires `5|file` with no stderr.
- **D-6984:** Y6 writes the extracted real `redact()` body to a fixture script, supplies a static stdin program that sources its quoted first argument, and reads the invalid-byte URL from its quoted second argument. Both filenames contain the same shell punctuation. The real `0xff`, selected `en_US.UTF-8` locale, fixture HOME and byte-exact `127.0.0.1:9` assertion remain. The nearby `ghContainedEnv` call retains all three poisons. N1-N4 and R51 remain carried; no fallback locale, extra scheme-arm row or product cleanup is folded in.

**What red/green proves.** The added filename controls pass on the old quoted `-c` construction; that is a measured characterization, not a claimed old-code red. Before changing the construction, isolated owned copies deliberately removed quotes from the reader source path and the Y6 file-read argument: L6 and Y6 each failed their behavior assertions, then passed after saved-copy restoration and `cmp` exit 0. The stdin-fed construction passes those same controls. Final isolated-copy checks repeat these path mutants and verify that removing the redactor's local C locale still makes Y6 fail on actual invalid-byte userinfo. Each mutant is serial, bounded at 600 seconds and measured same-UID threads +1500, never applied to the worktree; every restore uses saved bytes and `cmp` rather than git checkout. A load-gate refusal above 30 started no suite and is not a mutant-red result; the runner distinguishes it with exit 75 before further measurement.

**Local verification and its boundary.** Whole touched files and relevant guards run one file at a time, foreground, `nice -n 19 ionice -c3`, timeout 600 seconds, first decimal load average at most 30 and session anonymous memory below 8 GiB, fixture HOMEs only. The final results are recorded below; each vitest command uses `./node_modules/.bin/vitest run test/<file> --pool=forks --maxWorkers=1`, with only the containment guard filtered by its existing test title. The next new-tip CodeQL analysis alone can prove whether alerts 202/203 are closed: no local behavior test or old-tip green check is an alert-green claim. No CodeQL CLI was available locally. The unavailable automated security-review result stays unavailable, not green. Whole local suite remains `suite: unrun`; the earlier graph-sweep assertion-green/process-teardown exit-1 main-red is retained and its unchanged file is not repaired in this round.

| Fix-round-2 file or gate | Result |
|---|---|
| `ccrc-settings-lib.test.ts`, whole | 21 passed, exit 0; all sixteen L4 cases retained |
| `ccd-update-sync.test.ts`, whole | 65 passed, exit 0; Y6 locale row ran |
| `ccrc-settings-census.test.ts` | 22 passed, exit 0 |
| `ccd-workspaces.test.ts -t 'routes EVERY bash call site'` | 1 passed, 123 filtered out, exit 0; all three containment poisons retained |
| `typecheck-tests.test.ts` | 12 passed, exit 0, repeated after final test edit |
| `citations.test.ts`, `docs-parity.test.ts` | 4 and 54 passed respectively, exit 0 |
| `private-names.test.ts`, `topology-clean.test.ts` | 47 and 60 passed respectively, exit 0 |
| `dtbd.test.ts`, `deviation-refs.test.ts` | 1 and 31 passed respectively, exit 0; deviations after fetch |
| Generator `--check`, whitespace/privacy scan | exit 0; zero private-name/deployment-path hits |

The final isolated mutants each produced an actual assertion failure: unquote the library source path -> L6 stderr/output assertion red; unquote Y6's file-read path -> byte-output assertion red; unquote Y6's redactor-script path -> exit-status assertion red; remove the copied redactor's C locale -> byte-output assertion red with `0xff` userinfo still present. Every saved-copy restore passed `cmp` and its selected row. A scratch-runner mistake initially passed the product-source path as vitest's test filter, giving `No test files found` at its baseline; no mutation was applied and it is not evidence. Correcting that scratch argument produced the measured locale baseline/red/restore sequence above. The earlier load-gate stop is likewise excluded from the red results. No guard or assertion was weakened to obtain green.

**Handoff boundary.** Claims 2586/2587 remain retained. Only the two named test files and this plan change. Existing D-6979/D-6984 are extended; D-6986 remains spare, unused. Fetch and merge-tree are measured before the one push; conflicts would be reported, not absorbed. No rebase, update-branch, force push, queue act, live update, rollback, service/registry act or deployment. The coordinator owns new-tip CI reach, CodeQL measurement and queue, then independent review round 3 of 3; no extra worker review panel or cap lift.
