# Centralised update management, wave 9: stable readiness (this programme's macOS reds, test containment, doctor's auth reader, `ccrc backup`'s prune, and a prose batch) — Implementation Plan

Wave 9 clears what this programme owes before `stable` can be promoted, as the coordinator ruled it on 2026-10-02:
- this programme's share of the macOS reds of main's daily full run: eleven harness and platform-scoping defects (Task 1) and one tmux-version product bug (Task 2);
- two test-containment holes, made structural (Task 3);
- doctor's auth reader, which can read an armed gate as off and an unarmed one as armed on hand-written shapes (Task 4);
- `ccrc backup`'s prune, which takes no lock and, at `CCRC_BACKUP_KEEP=0`, deletes the backup it has just made (Task 5);
- a batch of prose findings (Task 6).

**THIS WAVE GOES LIVE ON MERGE.** Both boxes follow the `dev` channel with `auto=channel`. A merge to `main` becomes a prerelease in about a minute, and auto installs it on both boxes within about 35 minutes, fleet box first. No one runs a rollout. So:
- **Task 2 is live code.** Its `ccd/ccd` edit reaches every supervisor through the update's supervisor sweep. It is written to rename no session that exists today. Measured live by the coordinator: both boxes run tmux 3.4, and no live session id contains `.` or `:`. Its one-line `ccd/ccrc` edit (`_acct_live`'s match) takes effect from the first ccrc run after the move.
- Tasks 4–6 change `ccd/ccrc` and `ccd/ccrc-doctor-checks`. Those changes take effect from the first ccrc run after the move. The updater that makes the move is the old script, which keeps running from its own bytes.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:** Clear the work the operator ruled on 2026-10-02 must come before `stable`:
- this programme's macOS reds of main's daily full run. They are measured at `0db98707` (run 36960555979), with the same cases in run 36811322444;
- the residue the coordinator chose from R7–R11.

None of this changes the dispatcher, the store, the wire or the PWA.

- **Task 1 — the macOS harness (test-only):**
  - **M1–M3.** Five `spawnSync('bash', …, { env: { HOME } })` sites in `server/test/ccrc-update.test.ts` hand the child no PATH. libuv then resolves `bash` through the default `/usr/bin:/bin`, which on macOS is `/bin/bash` 3.2.57. The fix spawns the interpreter the file already resolved, `BASH`.
  - **M4.** A `--detach` control that only Linux can run becomes `itLinux`.
  - **M5.** The update-spawn escapee leaves its process group by a portable mechanism, in both twin test files, and (by ruling, for parity) in the agent's `update-killed-arms` case that also uses `setsid`.
  - **M6.** The rsync recorder logs only the call ccrc made, not openrsync's own `--server` re-exec. There is one spelling of the recorder, and a Linux twin models openrsync.
  - **M7.** The `describeDarwin` missing-dependency cases declare that no service manager is reachable.
- **Task 2 — M8, live:** `ccd` names a tmux session already sanitised (`.` and `:` become `_`) when it creates it: `_tmux` in `ccd/ccd`, and `tmuxName` in `shared/tmux-target.ts`. Every target then matches on tmux 3.4 and 3.7c alike.
  - The THIRD forward copy of the mapping, `ccd/ccrc`'s `_acct_live` (an exact match of `cc-<sid>` against `tmux list-sessions`), matches the sanitised name too. Without that, `ccrc account remove`'s `refuse-live` passes a live dotted lane on every tmux version.
  - Of the readers that turn a session name back into a registry id, `_inject_spawn_effort` is handed the id instead. The other five (`session-hook.sh`, `statusline-command.sh`, `cmd_swap_self`, `cmd_clip`, `ccrc-api`) stay lossy for a dotted id, a stated limitation deferred to wave 10 by ruling (D-3816).
- **Task 3 — containment (R10d, R9-F8):**
  - The ccrc test env builders, and the raw spawns of the real `ccd/ccrc` in the same five files, stop inheriting the real `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`, and stop leaving a real `ssh`, `scp`, `curl` or `tmux` reachable.
  - A spine builder (one that fronts its own `systemctl`/`systemd-run` and adopts a planted pair as delegates) is never handed `ghContainedEnv`'s systemd poisons, which its adopter would move aside and forward to.
  - The real-curl cases in `updateEnv` keep the real curl through a loopback front that passes only the port each case names.
  - `keepDigest` stops running the real `ccd/ccrc` with the real PATH, and writes nothing into the test HOME's `~/.local/bin`.
  - One checker, `assertNoRealTool`, makes this structural. It throws if a real `ssh`, `scp`, `systemctl`, `systemd-run`, `launchctl`, `tmux`, `gh` or `curl` can run under an env, or if that env points the user bus outside the fixture HOME.
- **Task 4 — doctor's auth reader (R10a, R10e):** `_box_unit_env` reads `CCRC_AUTH` and `CCRC_HOST` the way the unit's feeder hands them to the server, for the shapes this reader can decide.
  - On Linux the feeder is systemd's `EnvironmentFile=` parser. A shape this reader cannot decide answers "not measured" for that key.
  - On macOS the launchd job sources both files with bash under `set -a`. By round-2 ruling R-A, the reader decides there ONLY when every non-blank, non-comment line of BOTH files is a plain assignment and neither file holds a carriage return. Otherwise every key answers "not measured", naming the first offending line by number, never its content.
  - It never answers a false ARMED and avoids a false OFF. `CCRC_AUTH=on ` (trailing whitespace) reads ARMED, and the test that pins it as off is corrected.
- **Task 5 — R10g:** `ccrc backup`'s prune takes `~/.ccrc/update.lock` the way `_bak_gc` does, and gets `_bak_gc`'s protections through one shared selection helper. It never removes the backup it just made, a dir named after it began, or the newest earlier tree backup and coord.db snapshot. The backup's copy itself is not locked, by ruling (Risk notes).
- **Task 6 — prose:** R7, R11 (F1–F5), R8i, R4-2, R9-F1, R10b and R9-F6. Each change states what the code does.
- **Task 7 — the gate, the PR, and the macOS evidence.**

**Acceptance for Tasks 1 and 2 is on macOS, and only there.** The twelve cases below must be green on this PR's `test-macos` legs. On a pull request those legs run the SELECTION, which includes every touched test file, and they are advisory. A Linux run cannot prove any of them. The wave-done names each case's macOS result.

| # | file | case (title, as it stands at `6ca3d163`) |
|---|---|---|
| 1 | `ccrc-update` | `_upd_redact: a normal URL passes through unchanged, a credentialed one loses only the userinfo, and HOME becomes a literal ~ (fix round 1 item 11 / review 155 C17)` |
| 2 | `ccrc-update` | the long-HOME floor case whose harness ends `'_upd_floor_check --to 0 cli'` (`:4371`) |
| 3 | `ccrc-update` | `_upd_phase redacts its OWN detail argument, independent of any caller (review fix round 1 M1)` |
| 4 | `ccrc-update` | ``control (the detached child): `rollback --to v1.0.0 --detach --from pwa` in the killed-flip state …`` (`:11773`); on macOS it must SKIP |
| 5–6 | `update-spawn` | `a grandchild that left the group and holds the pipes does not stop the answer: …` and `a KILLED parent whose grandchild left the group and holds the pipes answers promptly too` |
| 7 | `ccrc-install` | `run FROM a real $HOME/ccrc, it MIGRATES rather than copying onto itself: …` (`:1221`) |
| 8 | `ccrc-install` | `a fresh box: the tree lands in ~/ccrc-versions/<name>/, never at the live name, …` (`:2678`) |
| 9–11 | `ccrc-install` | `describeDarwin('ccrc install: a macOS box missing what ccd needs')`: tmux, flock, launchctl |
| 12 | `ccd-tmux-anchor` | `a DOTTED id, created through _tmux_new_session, probes live — tmux renamed it and the target follows` (`:219`). Its title stays byte-identical: it is the macOS acceptance identifier |

**The count is twelve, by the coordinator's ruling of 2026-10-02.** The ledger's 11:25 entry said fourteen; its own breakdown is 4 + 2 + 5 + 1 = 12, and the scouts measured the same twelve in both daily runs.

**Wave 9's done-state is these twelve green on the PR's `test-macos` legs (case 4 skipped), by ruling.** It does not wait on the GPT lane's reds or on `probe-macos`.

**This wave does not open the stable gate.** The GPT lane's 45 macOS reds are that programme's, by ruling: `ccrc-codex` ×39, `ccrc-account` ×4, `ccgpt-runtime` ×1, `ccd-account-auth` ×1. They keep `test-macos`, and so `full-suite`, red (`ci.yml:864`).

**Architecture:** no ring changes, and no server or PWA code.
- **Task 1** edits test files only. One new export goes in `server/test/installTreeFixture.ts`: `rsyncRecorder`, the one spelling of the rsync recorder that three files carry today.
- **Task 2** edits `ccd/ccd`, L0's `shared/tmux-target.ts`, and one match in `ccd/ccrc`:
  - `_tmux`'s body (one line, in place);
  - `_inject_spawn_effort`'s id read (one line, in place);
  - its one caller (one line, in place);
  - the comment blocks, reworded in place with no line moved;
  - then the restamp of line 2;
  - `_acct_live`'s `case` line and its comment in `ccd/ccrc` (in place, line-neutral; `ccd/ccrc` is not generated).

  `tmuxTarget`'s OUTPUT is byte-identical for every id, so the server's and the agent's tmux argv do not change.
- **Task 3** adds two NEW modules, so that this wave stays out of `ccdWsHelpers.ts`, which the concurrent PR #222 edits at its head:
  - `server/test/containedTools.ts` — `CONTAINED_TOOLS`, `plantPoison`, `loopbackCurlFront`, `assertNoRealTool`. It imports only `node:*`, so the vitest-free `installTreeFixture.ts` can import it without breaking its own header's contract;
  - `server/test/ccrcContainment.ts` — `ccrcContainedEnv`, which also imports `ghContainedEnv` and `harnessBin` from `ccdWsHelpers.ts`.

  `ccdWsHelpers.ts`, `ghContainedEnv` and `codexLaneFixture.ts` are not edited.
- **Tasks 4–6** edit `ccd/ccrc` and `ccd/ccrc-doctor-checks`. `_box_env_value` gains a `unit` mode (Linux) and a `shell` mode (Darwin, behind the new whole-file check `_box_env_shell_plain`). Its 43 two-argument callers (21 in `ccd/ccrc`, 22 in `ccd/ccrc-doctor-checks`) keep their exact behaviour. The two calls inside `_box_unit_env` move to `unit` mode, and its Darwin arm `_box_unit_env_shell` reads in `shell` mode.

**Tech Stack:** bash `set -uo pipefail` in `ccd/ccd`, `ccd/ccrc` and `ccd/ccrc-doctor-checks`. vitest in `server/` and `agent/`. TypeScript on node `>=22.13.0`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md`. No section of it changes. Every departure from an earlier plan's text, or from code's documented behaviour, is a numbered entry in `## Deviations found` below.

**Producers:** everything this wave builds on is merged on `main` at `6ca3d163754d7ac121d45998d42c69efc1fab331`:
- waves 1–8 of the programme;
- D-3525, every tmux target exact (`docs/superpowers/plans/2026-09-28-every-tmux-target-is-exact.md`);
- the GPT lane's #217, which added `assertSpineFrontContained` and `adoptPlantedSystemd`;
- wave 8's `_box_unit_env` (D-3596, D-3597, D-3598) and `_bak_gc` (D-3592–D-3595).

D-refs this plan cites as they stand: D-3215, D-3423, D-3427, D-3465, D-3466, D-3525, D-3592, D-3593, D-3594, D-3595, D-3596, D-3598, D-3599.

## Not in this wave

Reviewers: do not raise these. Each one was deferred to wave 10 by the coordinator.
- **`ccd/ccd` harness containment** — `makeCcdHarness`/`ghContainedEnv` (`ccdWsHelpers.ts`) still inherit the real `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`, `ssh`, `scp` and `curl`; this wave contains the `ccd/ccrc` builders only (PR #222 edits that helper).
- **R2a–R2d** — the lease group in `rekeyNode`/`handOffLease`/`settleNode` (`store.ts`).
- **R3a** — rollback asks the release host before the lock probe.
- **R3b** — a hung live updater answers `busy` on every sweep.
- **R3c** — W4's D-3251 probe-to-acquire window.
- **R3-pid** — a reused pid reads as alive.
- **R4-1** — `cmd_watchdog` rewrites an out-of-vocabulary `from` to `watchdog`.
- **R4-3** — a SIGKILLed `_upd_phase` leaves an orphan `update.json.tmp.<pid>`.
- **R8a** — N2: refuse a cli rollback on an unstamped box whose link and units disagree.
- **R8b** — the first killed update onto the digest build (moot live).
- **R8c** — `deploy.sh`'s `prune_backups` reads `CCRC_BACKUP_KEEP` unvalidated.
- **R8d** — a launcher install over a written-through version records a complete install.
- **R8e** — a source with no git and no `build.json` keeps the old stamp. Task 6's R8i line says so; it does not fix it.
- **R8f** — `pathWithout` lacks `head`.
- **R8g** — `_ver_verdicts`' caller arms are unreached.
- **R8h** — FX-B M9 cannot red.
- **R9-R1** — adopt a digestless version whose bytes equal the release's.
- **R9-F2** — every rollback to a digestless version needs the release host.
- **R9-F3** — the not-kept sentence promises a digest.
- **R9-F4** — `_ver_keep_state`'s copy into another version.
- **R9-F5** — a transcript promise.
- **R9-F7** — the W6 amendment list names D-3438 but not D-3427 or D-3430.
- **R9-F9, R9-F10** — a stale mutation row; the bare-form `--to` pin.
- **R10c** — the kill window between the sweep and `done`, including `deploy.sh`'s unread listing.
- **R10f** — mixed-TZ backup names at KEEP≤1.
- **R10i** — a timestamp-named link is a backup and can hold a protection. Task 5 moves `_bak_gc`'s selection loop into a helper unchanged, so the link behaviour R10i names is unchanged too.
- **R10j** — the Darwin sweep cannot tell a failed `launchctl print` from an unloaded job.
- **R10k** — a refused sweep is invisible to `update.json`, the inventory and doctor.
- **Dotted-id reverse maps and twin-id name collisions** (ruling 4) — a registry lookup by sanitised name for `session-hook.sh`, `statusline-command.sh`, `cmd_swap_self`, `cmd_clip` and `ccrc-api`, and any refusal at `ws-add` of an id whose sanitised name collides. No `ws-add` refusal ships now.
- **`ccrc backup`'s copy racing an update's prune** (ruling 3) — accepted residue, see Risk notes.
- **`_upd_lock_holder` naming `ccrc backup`** (round-2 ruling R-B) — while `ccrc backup`'s prune holds `~/.ccrc/update.lock`, a concurrent update's busy line names the last update's pid and target from `update.json`. Accepted residue, see Risk notes. The busy line is not changed.
- **`server/test/update-killed-arms.test.ts:471`'s `setsid` escapee** (round-2 ruling R-C) — `itLinux`, not one of the twelve, unchanged.
- **A repair for the killed-flip state when the target is not kept complete** (round-2 ruling R-D) — the R9-F1 line names no command there and points at no recipe (README's Restore recipe writes through `~/ccrc`, which in that state points at the version the units do NOT run). The design of a safe repair, and any README sentence for this state, are later work.
- **The GPT lane's 45 macOS reds**, and `probe-macos`'s `/bin/true` red (`ccd-account-auth.test.ts:1434`).

## Global Constraints

- **Anchors.**
  - Anchors are measured at `6ca3d163`, quoted, and given as `file:line`.
  - Step 1 of every task re-measures each anchor it uses, by its quoted text, on the tip being built, after `git fetch origin main` (and a merge if main moved). The quote wins over the number.
  - Locate code with graphify first (`graphify query` or `explain` over `graphify-out/`), then confirm with `grep -n` (or `grep -nF` for a quoted literal) of the quoted text.
- **Scope.**
  - The files each task names, and nothing else.
  - Nothing under `agent/src`, `deploy/`, `pwa/`, `server/src`, `*.service` or `*.timer`. A mutation applied transiently to a file under `server/src` (Task 6's R4-2) is restored with `cp` and checked with `cmp` before the next step, and is never committed.
  - Nothing in `server/test/codexLaneFixture.ts` or `server/test/ccdWsHelpers.ts`.
  - The whole-branch check must print nothing: `git diff --stat origin/main...HEAD -- agent/src deploy pwa server/src '*.service' '*.timer' server/test/codexLaneFixture.ts server/test/ccdWsHelpers.ts`.
  - `agent/test/update-spawn.test.ts` and `agent/test/update-killed-arms.test.ts` are the two `agent/` files edited (Task 1, M5).
- **`ccd/ccd` is generated** (line 2 is `# ccrc:generated 1 sha256=c9de9f70…`). Only Task 2 edits it. After that task's last `ccd/ccd` edit, and after every merge that touches the file, restamp it with the shipped marker function FROM THE REPOSITORY ROOT (every neighbouring step runs inside `server/`, where the relative paths would miss), then run `ownership.test.ts`:

      (cd "$(git rev-parse --show-toplevel)" && node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))")

  **A restamp conflict is resolved by recomputing, never by picking.** Three concurrent PRs edit `ccd/ccd`: child-reclamation W4 (#215) and the reclaim PRs #222 and #226. When `git merge origin/main` conflicts on line 2:
  1. resolve every OTHER hunk first, keeping both sides;
  2. set line 2 to either side's marker line;
  3. run the restamp above, which recomputes the digest over the merged bytes;
  4. `git add ccd/ccd`;
  5. run `ownership.test.ts`, `ccd-tmux-anchor.test.ts` and `keepalive-freshness-parity.test.ts`.

  Never hand-type a digest, and never take one side's whole file. If a concurrent PR has changed `_tmux`, `_inject_spawn_effort` or the `_spawn_settle` call this wave edits, keep both intents and re-run Task 2's suites. If the two intents cannot both hold, stop and report.
- **`ccd/ccd` edits are line-neutral.** Every Task 2 change replaces lines in place. The file's line count is the same before and after, so no citation into `ccd/ccd` moves: the frozen corpus's highest `ccd/ccd` anchor, README's anchors, and `session-hook.test.ts`'s census. Task 2 Step 4 shows this with `wc -l ccd/ccd`. Task 2's `ccd/ccrc` edit (`_acct_live`) is line-neutral too.
- **`ccd/ccrc` grows in Tasks 4 and 5.** It is a cited file: `session-hook.test.ts`'s census carries a `'ccd/ccrc': 5` entry, a count of frozen-corpus citations that already fail. Growth can move that count by coincidence, as it did at review 179.
  - After each task that grows `ccd/ccrc`, run `session-hook.test.ts`.
  - If `byFile` moved, re-measure it by S6-R11: dump the failure sets of the merge base and the tip, diff them, and state the composition in a comment beside the entry. Never adjust a number to make it green. No D-number.
  - Task 6's `ccd/ccrc` edits are rewordings, line-neutral where the item allows. R9-F1 and R10b add lines; Task 6 pays the same tax.
- **README moves no line.** `wc -l README.md` reads 3813 before and after, and every README edit reflows its own paragraph only.
- **Rings are a property of imports.** `shared/tmux-target.ts` is L0 and imports nothing, before and after. `server/test/installTreeFixture.ts` imports nothing from vitest, before and after (its header says so): it may import `containedTools.ts`, never `ccrcContainment.ts`.
- **Single-definition.**
  - The rsync recorder has ONE spelling, `rsyncRecorder` (`installTreeFixture.ts`), imported by `ccrc-install`, `ccrc-update` and `ccrc-install-graphify`.
  - The containment set has ONE spelling, `CONTAINED_TOOLS` (`containedTools.ts`). `ccrc-install.test.ts`'s `FIXTURE_BINS` derives its new names from it.
  - `_bak_gc`'s protected-dir choice has ONE spelling, `_bak_keepset` (Task 5), called by both pruners.
  - The tmux name sanitisation is spelled once per language for NAMES (`_tmux`, `tmuxName`), plus `_acct_live`'s match in `ccd/ccrc`, which cannot source `ccd/ccd`. `keepalive-freshness-parity.test.ts`'s canonical-spelling regex pins `_tmux`'s exact body. `_tmux_at` and the keepalive keep their target-side rewrite byte-identical: `ccd-tmux-anchor.test.ts:442-447` pins both texts, and on an already-clean name the rewrite is a no-op.
- **Fixture HOMEs only.** Every case that runs the real `ccd/ccrc` or `ccd/ccd` runs it under a fixture HOME.
  - From Task 3 on, every env BUILDER and every spawn that runs or sources the WHOLE `ccd/ccrc` script IN THE ccrc TEST FILES Task 3's Files list modifies (`ccrc-update`, `ccrc-install`, `ccrc-cli`, `ccrc-install-graphify`, and the new `ccrc-containment`), plus `keepDigest` and Task 2's case 1(e), passes `assertNoRealTool` on its final env.
  - OUT of this wave's containment (coordinator, after the verify pass): the `ccd/ccd` harnesses built on `makeCcdHarness`/`ghContainedEnv` in `ccdWsHelpers.ts`, which this wave does not edit (PR #222 does). They inherit the real `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`, `ssh`, `scp` and `curl` exactly as at main; Task 2's cases that run through them are not held to `assertNoRealTool`. Listed in Not in this wave.
  - EXEMPT: extracted-function harnesses — a `-c` script built from function bodies sliced out of `ccd/ccrc` (the five D-3808 sites, `:4127`'s `_upd_redact`/`_ccrc_die` hook), which call only builtins plus `date`, `mkdir`, `chmod`, `mv` and `rm`. They run under `{ HOME: <fixture> }` and bash's own default command path, on purpose (D-3808). `:4127` hands no env at all at `6ca3d163`, so it inherits the real HOME: Task 3 gives it `env: { HOME: home }`, with the `home` it already makes (`:4124`).
  - Use `command -v` under the case's env, and never execute through PATH to "check".
  - No case runs `ccd`, `ccrc`, `systemctl`, `tmux`, `gh` or `ssh` against the live `$HOME`, or touches a real `tmux`, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` unit.
  - `ccd-tmux-anchor.test.ts`'s real tmux runs only on its private socket, as it does today.
  - Never spawn a bare `'bash'` under a narrowed PATH (M1's lesson): on macOS it resolves `/bin/bash` 3.2. Resolve bash through the parent's PATH once (`ccrc-update.test.ts:63-68`'s `BASH` idiom) and spawn that.
  - Every process a case spawns in the background has its stdio redirected (`</dev/null >/dev/null 2>&1`), or it is an escapee whose pipes ARE the subject (M5).
  - Every wait loop a fixture runs is BOUNDED, and exits non-zero with a message on stderr when its bound is spent.
- **Mutation-table discipline.** Every new guard ships with a case that reds when the guard is removed or mutated, measured red-first.
  - Before each mutation, `cp <file> "$SCRATCH/<name>.orig"` (never `git checkout --`). Run, restore with `cp`, and check with `cmp` that the restore is byte-identical.
  - Every mutation body must parse (bash `-n`, tsc), and must not reference a binding declared later in its scope (the TDZ, and bash's `set -u` twin).
  - A row is not done without a measured red count and the assertion that fired, so a crash is never counted as a pin.
  - Where a row cannot red on Linux, because only macOS reaches it, the table says so, claims no Linux pin, and names the macOS case that proves it.
- **D-numbers.** Every departure is defined in `## Deviations found` under a number the allocator issued to this wave (23 numbers, minted by the coordinator before this plan was committed). A departure the worker finds takes the next number of the reserve the brief names, and is defined in the commit that first cites it. Never write an unspent reserve number anywhere tracked, and never call the allocator.
  - Code comments cite the item (`wave 9 M8`, `wave 9 R10g`) and, where a departure applies, the number minted for its slug.
  - The run's reserve for departures found while executing is named in the wave brief. Take its numbers in order, and define each in `## Deviations found` in the commit that first cites it. Never call the allocator, never write an unspent number, and never land a `D-TBD-` spelling.
- **Suites.** Run them in the foreground, one command per call, inside the package, with timeout ≥ 600000 ms: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. Never use bare `npx vitest`. Run `npm ci` first where `node_modules` is absent, in `server/`, `agent/` and `pwa/`, because `typecheck-tests` spawns their compilers.
- **No residue in tracked text:** no hostname, username, absolute home path, mount path, docserver URL or org name. The shards' `TMPDIR` is the shell variable `$SHARD_TMP`, whose value the brief names, never a committed path. Run `topology-clean.test.ts` after `git add` of any new file.
- **Commits.** Commit on the workspace branch only, at least once per task, as `test(update): …`, `fix(update): …` or `docs(update): …`. Never use a separate feature branch. Send the wave-done in the same turn as the push, and never end a turn to wait on CI.

## Review Focus

1. **Task 2 is live, and must rename nothing that runs.**
   - For every id in the live alphabet (`[A-Za-z0-9_-]`, no `.` or `:`), `_tmux`, `tmuxName` and `_acct_live`'s match must produce byte-identically what main produces.
   - `tmuxTarget` must return byte-identically what main returns, for every id.
   - The only ids whose created name changes are dotted or colon ids, and tmux 3.4 already gave those exactly the new name.
   - Every forward copy of the id→name mapping (`_tmux`, `tmuxName`, `_acct_live`) must sanitise. Every reverse map from a name to a registry id must be found by Step 1's widened greps: Task 2 handles `_inject_spawn_effort`; the other five are D-3816.
   - The restamp must be recomputed, not picked. Both literal pins on `_tmux`'s body (`ccd-tmux-anchor.test.ts:404` and `keepalive-freshness-parity.test.ts:192`) move together.
2. **Containment that is real, not declared.**
   - `assertNoRealTool` must resolve through `realpath`, so a symlink from the fixture HOME to a real binary fails it.
   - It must require `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` to be SET under the fixture HOME. Merely deleting them would let ccrc's own `: "${XDG_RUNTIME_DIR:=/run/user/$UID}"` default reach the real bus (seven default pairs in `ccd/ccrc`, `:3034-3035` first; one in `ccd/ccrc-doctor-checks:873-874`).
   - The poisons are create-if-absent, so every functional stub a builder plants afterwards still wins.
   - A spine builder is never handed `ghContainedEnv`'s systemd poisons: `adoptPlantedSystemd` would rename them to `.codex-*` delegates, and the fronts would forward to a poison (rc 97) or fall back to `nohup`.
   - The loopback curl front passes only the ports a case names, never `127.0.0.1:7788`/`:7789` by default.
   - Any case that newly reds under the containment relied on a real tool. That is a finding to report, never a reason to weaken the checker.
3. **No false ARMED, and as few false OFFs as can be avoided.**
   - Every shape the reader cannot decide answers `not measured`, never a value — including a quote that opens on one line and may close on a later one.
   - On macOS (round-2 ruling R-A), a file that is not plain from its first line to its last — any line that is not blank, a comment or a plain assignment, or any carriage return — makes EVERY key of BOTH files `not measured`, wherever that line sits and whichever file it is in. The reason names the line by number and never quotes it (`ccrc.env` holds tokens).
   - On Linux, a canonical decided line in the exposure file still wins over an undecidable `ccrc.env`, by presence, as the second `EnvironmentFile=` does.
   - Canonical files (`KEY=value` lines and comments only) answer exactly what main answers, on both platforms.
   - The 43 two-argument `_box_env_value` callers are byte-for-byte unchanged, CR handling included.
   - Every rc-2 (unreadable exposure file) sentence of D-3596 stays byte-identical, rc 4's tense included.
4. **`ccrc backup`'s prune keeps what it must and says what it skipped.**
   - At KEEP=0 it never removes its own backup, a dir named after it began, or the newest earlier tree backup and coord.db snapshot.
   - It never prunes while another holder has the lock, or when the lock cannot be taken or measured.
   - Its pinned prune echo (P17) and its invalid-KEEP refusal (the F6 describe) stay byte-identical, exit codes included.
5. **macOS acceptance is reported, not inferred.** Every one of the twelve cases has a named macOS result in the wave-done, from the PR's own `test-macos` legs. "Green on Linux" proves none of them.
6. **Prose says what the code does** (Task 6).
   - The killed-flip remedy never advises an in-place write. It names `bash ~/ccrc-versions/<tag>/ccd/ccrc install --role <role>` only where the box's role is known and a measurement taken WHEN THE LINE IS PRINTED, under that same role, shows that version kept complete, its own `ccd/ccrc` versioned, and (on a fleet box) its agent deps present. Otherwise it names no command and no recipe, and says that no safe one-line repair is known for this state and nothing on the box was changed (round-2 ruling R-D).
   - The stamp-skip lines stop promising `unstamped` when a stamp stays.
   - Every count in a corrected comment is one this wave measured.

## Risk notes

Measured facts that narrow a premise, and risks kept as risks rather than applied.

- **M8's premise: the tmux version, not macOS.**
  - On tmux 3.4 (both Linux CI and both live boxes), `new-session -s cc-w-my.site` creates `cc-w-my_site`.
  - On Homebrew tmux 3.7c (the macOS runner's log, `Pouring tmux--3.7c`), the dot is kept.
  - main's targets predict 3.4's rewrite (`ccd/ccd:23970` `_tmux_at() { local n="${1//[.:]/_}"; echo "=$n:"; }`, `shared/tmux-target.ts:32`), so on 3.7c a live dotted session reads `can't find session`, i.e. `gone`, which is destroy-eligible (`ccd-tmux-anchor.test.ts:20-23`).
  - A Linux box that upgrades tmux would meet the same bug. That is why the fix ships now and not as a macOS-only patch.
- **M8 changes nothing live today.**
  - Both boxes run tmux 3.4, and no live id contains `.` or `:`. So `_tmux "$id"` is byte-identical for every live id, and the sweep's supervisor restart re-attaches to the same names (`cmd_ensure` attaches to a live session).
  - A future dotted project on a 3.4 box gets the same name tmux would have given it anyway.
- **`_acct_live` was already fail-open for a dotted lane on tmux 3.4** (`ccd/ccrc:7853` matches the raw `cc-$sid`, while 3.4 created `cc-<sanitised>`), and main matched only on 3.7c. After this wave it matches on both. Unreachable live: no live id carries `.` or `:`.
- **The reverse maps stay lossy for dotted ids** (D-3816, a stated limitation, wave 10 by ruling). Five readers turn a LIVE session name back into an id by stripping `cc-`:
  - `ccd/session-hook.sh:2762` (`id="${tname#cc-}"`);
  - `ccd/statusline-command.sh:305`;
  - `cmd_swap_self` (`ccd/ccd:23559`);
  - `cmd_clip` (`ccd/ccd:24020-24021`, the attached client's session through `sed 's/^cc-//'`). For a dotted session `ccd clip` with no id derives `w-my_site`. `_alive` (`:24024`) probes only tmux, through `_tmux_t`, so it answers live and the path is typed into the right pane — but the image is filed under `~/.cc-clips/w-my_site` (`:24025`), a dir no registry id owns, so the reap and reclaim paths (keyed on `w-my.site`) never clean it. That was already so on 3.4; on 3.7c at main the verb died `session not alive: w-my.site` instead. (The round-2 attack read `_alive` as failing; it does not — `_session_probe` asks `tmux has-session` only.) An explicit id files it correctly;
  - `ccd/ccrc-api:273` (`DERIVED_ID="${tname#cc-}"`, then `[[ -r "$REG/$DERIVED_ID.uuid" ]] || refuse 'no-uuid'`): a dotted session gets `no-uuid` on `whoami` and on every attributed call. It fails closed.

  On tmux 3.4 each already yields `w-my_site` for the id `w-my.site`, which is not its registry key. After this wave, 3.7c behaves the same. No live id is affected.
- **Two ids that differ only by `.`/`:` versus `_` share one tmux name, on every tmux version** (`w-my.site` and `w-my_site` both become `cc-w-my_site`). Both pass the workspace alphabet `^[A-Za-z0-9._-]+$`. The second spawn fails `duplicate session`; `_spawn_start`'s has-session check then reads the twin as live, and the settle and redrive type into the twin's pane; `cmd_stop` and the reclaim paths of one would kill the other. This is not new: on main the targets collide the same way on 3.4 and 3.7c. Unreachable live (no live id has `.` or `:`). No `ws-add` refusal ships now (ruling 4).
- **The keepalive's operator line** (`ccd/ccd-telemetry-keepalive:540`, `"$KA_TMUX_PREFIX$sid"`) still prints the raw `cc-<sid>` for a dotted id. It is display text; its probe target (`:489`) is exact and unchanged.
- **Self-swap detection changes for dotted ids** (D-3817). `ccd/ccd:23344` compares `tmux display-message -p '#S'` with `$(_tmux "$id")`. On 3.4, a dotted id's live name never equalled main's unsanitised prediction, so a swap run from inside a dotted session killed its own caller instead of detaching. After this wave, it detaches, as for every other id. That is a fix, and it is unreachable live.
- **M5's mechanism.** The escapee is spawned by the test's own node (`process.execPath`) with `detached: true`. On POSIX, libuv calls `setsid()` for a detached child, which is the same mechanism the product spawner relies on (`server/src/update/spawn.ts:42`). It needs no binary the macOS runner lacks.
  - That macOS has no `setsid(1)` is inferred: `escapee.pid` is never written, and the server-deps action installs only `bash tmux flock jq coreutils`. It was not executed on the runner.
  - The agent twin, `agent/test/update-spawn.test.ts`, changes identically, and so does `agent/test/update-killed-arms.test.ts:332` (ruling 8). `test-macos` runs the server package only (`ci.yml`: "Server package only"), so the agent files are proved on Linux alone.
  - `server/test/update-killed-arms.test.ts:471` also uses `setsid`, under `itLinux`. It is not one of the twelve and is not changed (round-2 ruling R-C, Not in this wave).
  - **A new load window in the agent's arm-D case.** Its launcher now runs node in the FOREGROUND before `exec sleep 300`, where main backgrounded `setsid … &`, and node must start the escapee before the group kill. Node's spawn path measured 0.05–0.08 s at load ~57 (five runs), against a 300 ms bound. So this case's `BOUND_MS` rises to 2000 (Task 1). Its assertions are relative to it (`>= BOUND_MS`, `< BOUND_MS + UPDATE_SPAWN_DRAIN_MS + 4000` = 8000, `< UPDATE_OP_TIMEOUT_MS` = 30000), so they keep their meaning. A runner where node needs more than 2 s to spawn would still red it, on `gc-pid`'s existence.
- **M6's premise is inferred, not measured.** The second line in `rsync-argv` is attributed to openrsync's local copy re-executing `rsync --server` by PATH lookup, which hits the recorder a second time. The macOS log elides that line.
  - If the PR's macOS leg still shows a second line, the worker reports it verbatim in the wave-done and the coordinator rules then (ruling 5). It is never a reason to loosen the `toHaveLength(1)` assertions.
  - Unmeasured: whether openrsync interoperates with a Homebrew rsync 3.x ahead of it on PATH.
- **Task 3 may red cases.** A case that passed only because it reached a real tool (an `ssh`, a `tmux`, the real user bus, a real `systemctl` in one of the raw spawns) reds under the containment.
  - Each such case is listed in the wave-done, with what it reached.
  - Repairing one by stubbing the shape it asks is in scope. Changing what it asserts is not: stop and report.
  - `ghContainedEnv`'s own header records the precedent: a default-on poison took `ccrc-doctor` from 170/170 to 165/170.
- **The parsers were not executed** (systemd's) **or were executed off-platform** (bash's). No `systemctl` or `systemd-run` is allowed against a real manager, and no launchd on a Mac was driven; the Darwin rule was checked against bash 5.2's `set -a; . f` on Linux, not `/bin/bash` 3.2.
  - R10a's premise rests on the run-182 ruling and `systemd.exec(5)`: "Leading and trailing whitespace (space, tab, carriage return) is discarded". That is the one shape MODELLED on Linux.
  - Everything else Task 4 cannot be sure of on Linux answers "not measured", by ruling (never model unexecuted systemd behaviour): a spaced key, a backslash continuation, an escape, a quote that is not one whole pair on one line (including `"on"x`), a quote that opens and may span lines, an `export ` prefix.
  - **A comment line ending in `\`.** systemd before v254 continued such a line into the next; v254 and later do not (`/usr/share/doc/systemd/NEWS.gz`, CHANGES WITH 254: "EnvironmentFile= now treats the line following a comment line trailing with escape as a non comment line"). This reader does not know which version the box runs, so a key line after one is not measured.
  - **On macOS the server's env is not systemd's.** The launchd job SOURCES both files with `/bin/bash` under `set -a` (`ccd/ccrc:14088-14112`; the line is `local cmd="set -a; [ -f '$env1' ] &amp;&amp; . '$env1'; …"` — `&amp;&amp;` because it lands in the plist's XML, which launchd unescapes to `&&`). There, measured with bash 5.2's `set -a; . f`:
    - `CCRC_AUTH= on` sets nothing (bash runs `on` as a command);
    - one plain-looking line can carry a second assignment (`FOO=1 CCRC_AUTH=off` gives `off`), an `unset` (`FOO=a unset CCRC_AUTH`) or a `;` command (`FOO=1;unset CCRC_AUTH`), and leaves the key UNSET;
    - `readonly CCRC_AUTH` in `ccrc.env` stops the exposure file's `CCRC_AUTH=on` from landing (bash prints `readonly variable` and keeps `off`);
    - a CR stays in the value: `CCRC_AUTH=on\r` gives `$'on\r'`, which `config.ts`'s `=== 'on'` reads as OFF.

    So, by round-2 ruling R-A, on Darwin the reader decides only when every non-blank, non-comment line of BOTH files is `[export<ws>]NAME=` followed by a shell-inert value (`[A-Za-z0-9_./:@%+,=-]*`), one whole `'…'` pair, or one whole `"…"` pair with no `$`, backtick, `\` or `"` inside, then only optional spaces or tabs — and neither file holds a CR anywhere. Otherwise every key is not measured. **Trailing space and tab are dropped on both feeders; a CR only under systemd.** A plain file was checked against real bash 5.2 for 37 shapes: every value this rule decides equals bash's. Unmeasured: `/bin/bash` 3.2 itself (the shapes the rule admits are plain assignments, which 3.2 parses the same way — inferred); a plain assignment to a readonly name (`UID=5`), which bash 5.2 refuses with a message and then carries on (measured); and an exposure file holding an IPv6 origin (`https://[…]`, `[` is not inert), which reads not measured on macOS — a cost, never a false answer.
- **Task 5 locks the prune, not the backup — accepted residue, by ruling 3.** `ccrc backup` takes `~/.ccrc/update.lock` for its prune only. A `ccrc update` started while the backup copies is not refused, and an update's `_bak_gc` can still prune a `ccrc backup` dir that is still being copied when that dir was named before the update took its lock: it sits below that update's floor (wave 8's Risk (a), unchanged). Holding the lock across the whole backup would make a console move answer `busy` for the length of a coord.db `VACUUM INTO`.
- **While `ccrc backup`'s prune holds the lock, other lock users answer as if an update held it.** The window is the prune's `rm -rf` loop only.
  - A concurrent `ccrc update` (an auto move, or a PWA apply's detached parent) is refused `busy` with `update: another update holds ~/.ccrc/update.lock (pid …, target …)` — `_upd_busy_die` (`ccd/ccrc:17860`), whose holder line `_upd_lock_holder` (`:17823`) reads the pid and target from `update.json`, so it names the LAST update's, not `ccrc backup`.
  - `ccrc uninstall` refuses with its "an update holds" wording (`ccrc-uninstall.test.ts:1155`).
  - The watchdog's lock probe reads a live holder (`lrc` 1) for that tick.

  Accepted residue, by round-2 ruling R-B. The busy line is not changed this wave (Not in this wave).
- **Task 5's first effect on a box is the first `ccrc backup` run by a W9+ ccrc.** Nothing runs `ccrc backup` on either live box on a schedule today (deploy.sh's own prune is R8c's, deferred).

## Deviations found

Plan-level departures from an earlier plan's text, from a spec sentence, or from code's documented behaviour. Each is a slug. The coordinator mints a number for each and replaces the slug before this plan reaches the worker.

### Task 1 — the macOS harness

- **D-3808** — M1–M3. Five harness spawns in `ccrc-update.test.ts` (`:4162`, `:4195`, `:4233`, `:4371`, `:4421`) move from bare `'bash'` to the file's resolved `BASH` (`:68`), and their envs stay PATH-less.
  - The scouts offered "or add `PATH: process.env.PATH`". It is not taken: it would hand each harness the host's whole PATH, and so every real tool on it, for no gain. These harnesses run extracted functions under bash's own default command path.
  - The file's own source scan (Task 1 Step 2, case 1d) pins it, by an exact count.
  - Product behaviour is untouched: ccrc refuses bash < 4.4 at install (`ccd/ccrc:12121-12130`).
- **D-3809** — M4. Wave 6 fix round 1 (`a742eb6a`, #214) added the killed-flip `--detach` control as a plain `it(`. It is now `itLinux`, because `--detach` is Linux-only by decision 17 (`ccd/ccrc:17611`). The macOS answer is the existing `itDarwin('--detach refuses on macOS by name before anything runs (decision 17)')` (`:6891`), which is unchanged.
- **D-3810** — M5. Both update-spawn test files' headers and the `ESCAPEE` constant say the escapee is a `setsid` grandchild, and `agent/test/update-killed-arms.test.ts:332`'s launcher runs `setsid sh -c …`.
  - Each becomes a grandchild started by the test's own node with `detached: true` (libuv's `setsid()`). In the update-spawn twins its pid-file wait becomes bounded BY TIME (bash's `SECONDS`, not an iteration count: each `sleep` is a fork, and 500 × `sleep 0.01` measured 6.6–6.8 s at load 45–57) and is pinned by its own case.
  - The agent's arm-D case raises its `BOUND_MS` from 300 to 2000, because node now starts the escapee in the foreground before the group kill can land (Risk notes).
  - Each update-spawn twin gains one assertion: the escapee's process group is not the parent's.
  - The two update-spawn files stay identical in the lines they share. The killed-arms case's title (which says "a setsid grandchild") stays: node's `detached` IS a `setsid()`.
- **D-3811** — M6. The rsync recorder's comment says it "logs its argv and then EXECS THE REAL BINARY" (`ccrc-install.test.ts:607-614`), on every call. It now logs only a call whose `$1` is not `--server`. A `--server` call is the rsync implementation's own re-exec, not a call ccrc made, and it is passed straight to the real binary.
  - The three copies (`ccrc-install:614`, `ccrc-update:540`, `ccrc-install-graphify:298`) become one exported `rsyncRecorder`.
- **D-3812** — M7. `runInstall`'s comment says `opts.omit`'s manager entries are "the ONLY legitimate 'this call reaches no manager at all' case in this file" (`ccrc-install.test.ts:757-761`). The `describeDarwin` missing-dependency block is a second such case: its PATH deliberately drops `~/.local/bin`, so neither `systemctl` nor `systemd-run` resolves.
  - `runInstall` gains `opts.noManager`, which makes `expectAbsent` both manager names. The darwin block passes it.
  - `assertSpineFrontContained` itself (`codexLaneFixture.ts:1335`) is not edited.

### Task 2 — M8

- **D-3813** — D-3525's design names a session raw and predicts tmux's rewrite at the target (`_tmux_at`, `tmuxTarget`, the keepalive). Its plan says `_tmux() { echo "cc-$1"; }` "is the session NAME". `_tmux` and `tmuxName` now return the name already sanitised (`.` and `:` become `_`).
  - `_tmux_at`, `tmuxTarget`'s output, and the keepalive's target are byte-identical: their rewrite is now a no-op on every name `ccd` creates.
  - The two literal pins on `_tmux`'s body change to the new body: `ccd-tmux-anchor.test.ts:404` and `keepalive-freshness-parity.test.ts:192`'s `CCD_TMUX_NARROW` (whose `exactlyOne` asserts the canonical spelling, `:67-72`).
- **D-3814** — `_acct_live`'s comment says "The pane's tmux session name is `cc-<id>` — `ccd`'s `_tmux()` (ccd/ccd:1114) is the one place that mapping is spelled, and this is its second reader" (`ccd/ccrc:7848-7851`), and its match is the raw `cc-$sid` (`:7853`). It now matches `cc-$sid` with `.` and `:` as `_`, the name `_tmux` creates. The comment is reworded in place (and its stale `ccd/ccd:1114` anchor dropped). A live-alphabet id matches exactly as before.
- **D-3815** — `_inject_spawn_effort`'s header says "The id is the tmux name with `cc-` stripped (`_tmux`)" (`ccd/ccd:20637-20638`). Once names are sanitised, that strip is not the registry id for a dotted id, and `$REG/<id>.effort` would be missed: the settle would type `SPAWN_EFFORT` over an operator's choice.
  - It now takes the id as an optional second argument, `local t id="${2:-${1#cc-}}" level`.
  - Its one caller, `_spawn_settle` (`:20603`), passes `"$id"`.
  - The one-argument form, which `ccd-route-settle.test.ts` uses, keeps today's meaning.
- **D-3816** — A stated limitation, deferred to wave 10 by ruling 4. The readers that recover an id from a LIVE name (`session-hook.sh:2762`, `statusline-command.sh:305`, `cmd_swap_self` at `ccd/ccd:23559`, `cmd_clip` at `ccd/ccd:24021`, `ccrc-api:273`) are not changed. For a dotted id they were already lossy on tmux 3.4. After this wave they are lossy on 3.7c too, where they happened to work while every target failed: `ccrc-api` then answers `no-uuid` for a dotted session's `whoami` and attributed calls on every tmux version, failing closed. Twin ids (`.`/`:` versus `_`) colliding on one name are the same limitation (Risk notes). No live id is affected, and no `ws-add` refusal ships now.
- **D-3817** — `ccd/ccd:23344`'s self-swap test now matches a dotted id's live session on tmux 3.4. On main it never matched, and a self-swap from such a session killed its own caller. Behaviour change, a fix, unreachable live.

### Task 3 — containment

- **D-3818** — Six builders stop calling `ghContainedEnv(home, { ...process.env, HOME: home })`, and the raw spawns of the real `ccd/ccrc` in the same files stop handing `{ ...process.env, HOME: home }` bare:
  - builders: `updateEnv` (`ccrc-update.test.ts:332`), `chainEnv` (`:11058`), the two `ccrcEnv`s (`ccrc-install.test.ts:350`, `ccrc-cli.test.ts:74`), `ccrc-install-graphify.test.ts`'s copy (`:129`), and `ccrc-install.test.ts`'s `sourced` harness (`:2457`);
  - raw spawns: `ccrc-update.test.ts:4299`, `:6785`, `:6818`, `:6854`; `ccrc-cli.test.ts:632`, `:660`; `ccrc-install.test.ts:6131` (the `_inst_caps` harness).

  They call `ccrcContainedEnv(home, base, { managers, curl })`, which:
  - sets `XDG_RUNTIME_DIR` to `<home>/no-runtime-dir` and `DBUS_SESSION_BUS_ADDRESS` to `unix:path=<home>/no-bus` (both absent; the shape `macos-platform.test.ts:961-962` already uses);
  - plants create-if-absent recording poisons for `ssh`, `scp` and `launchctl`, and either a curl poison or the loopback curl front;
  - asks `ghContainedEnv` for `{ tmux: true }`, and for `{ systemd: true }` ONLY when `managers` is true. The two spine builders (`updateEnv`, `ccrc-install`'s `ccrcEnv`) pass `managers: false`: each fronts its own `systemctl`/`systemd-run` after `adoptPlantedSystemd` (`ccrc-update.test.ts:385`, `ccrc-install.test.ts:491`), which renames any unmarked pair to `.codex-*` delegates that the fronts forward to (`codexLaneFixture.ts:1281-1290`, `:1404-1406`, `:1443-1444`). Handed the poisons, every `--detach` `systemd-run` would answer 97 and `_svc_have_user_manager` would fall back to `nohup` — the opposite of containment. `assertSpineFrontContained`, which both already call, is what pins their manager names.

  `updateEnv`'s doc comment ("`ccrcEnv` … trimmed: the poisoned gh from `ghContainedEnv`…") is updated to say so. The three spawns that run `ccd/ccgpt-runtime` (`ccrc-install.test.ts:4169`, `:6554`, `:7345`) are the GPT lane's binary, not `ccd/ccrc`, and are left as they are, named in the census's allowlist. `ccrc-install.test.ts`'s `FIXTURE_BINS` (`:283-297`) gains `ssh` and `scp`, derived from `CONTAINED_TOOLS`, so the exact-listing readers (`:2030-2033`, `:4765-4767`, `:4824-4826`) do not read the poisons as the verb's.
- **D-3819** — `ccrc-update.test.ts`'s real-curl pins say "A real `net.createServer`, NEVER a stubbed curl … `updateEnv` alone" (`:1335-1341`) and "NEVER a stubbed curl, so the REAL curl's own `--max-time` bound is what is measured" (`:6735-6737`). `updateEnv`'s curl is now the loopback front: it execs the REAL curl only when every URL it is handed is `http://127.0.0.1:<port>/…` with `<port>` listed in `$HOME/curl-allow-ports`, which each real-curl case writes for its own listener (or, for M4, its refused port 9). Anything else is recorded and refused, 97. The real curl's own bounds are still what those cases measure.
- **D-3820** — R9-F8. `keepDigest` (`installTreeFixture.ts:260-265`) hands the real PATH bare. It now spawns under `keepDigestEnv(home)`: HOME the fixture, XDG and DBUS under it, and PATH = `<home>/.keep-digest-poison-bin` (create-if-absent, planted on each call with a poison for every `CONTAINED_TOOLS` name) prepended to the parent's PATH.
  - The poison dir is INSIDE the fixture HOME and OUTSIDE `<home>/.local/bin`. Inside HOME, because `assertNoRealTool` passes only a resolution whose realpath is under the fixture HOME, and because it then goes when the `mkTmp` home goes — no process-exit cleanup, which the agent suite measured as insufficient under vitest's forks pool (`agent/test/contain-path.setup.ts`). Outside `~/.local/bin`, because `adoptPlantedSystemd` reads only that dir (`codexLaneFixture.ts:1281-1282`) and so do the exact-listing readers.
  - The only top-level `readdirSync(home)` readers in the files that reach `keepDigest` filter by prefix (`ccrc-install.test.ts:2221`, `:2238`; `ccrc-update.test.ts:5998-6028`), so none reads the new dir.
  - `installTreeFixture.ts` imports only `containedTools.ts` and stays vitest-free, as its header says.
- **D-3821** — The darwin missing-dependency block's comment says dropping `~/.local/bin` "costs nothing HERE" (`ccrc-install.test.ts:1763-1766`). On the macOS runner it does cost something: `pathMissing` keeps only `<home>/no-<tool>-bin`, which symlinks real binaries (`:860-881`), always `tmux` and, on darwin, `launchctl`. So with `~/.local/bin` gone, a real tmux and a real launchctl resolve (gh, curl and ssh resolve nowhere).
  - `pathMissing` now prepends `<home>/no-<tool>-poison-bin`, holding recording poisons for every `CONTAINED_TOOLS` name except the omitted tool and the two manager names. Each case therefore still reaches no manager, and the tool it is about is still absent.
  - The probes only ask `command -v` (`ccd/ccrc:12126-12142`), so a poison satisfies a probe it is not the subject of.

### Task 4 — doctor's auth reader

- **D-3822** — `_box_env_value`'s header says the shape it reads is "a SUBSET of what systemd's own `EnvironmentFile=` parser accepts", with continuations and escapes "deliberately NOT supported" (`ccd/ccrc:2707-2711`), and `_box_unit_env`'s header says it reads "ONE KEY AS ccrc.service RECEIVES IT". `_box_env_value` gains a third argument, `unit` or `shell`, and only `_box_unit_env` passes one. `_box_unit_env` picks by `${CCD_OS:-linux}`, and its header names both feeders.
  - **Linux, `unit` (systemd's `EnvironmentFile=`).** Whitespace (space, tab, CR) around an UNQUOTED value is discarded, as the run-182 ruling and `systemd.exec(5)` say systemd does: `CCRC_AUTH=on ` and `CCRC_AUTH= on` both read `on`. A shape this reader cannot decide answers rc 2 with nothing on stdout (D-3823). Round-2 ruling R-A leaves this mode as it was.
  - **Darwin (the launchd job's `set -a; . file` with `/bin/bash`), by round-2 ruling R-A.** `_box_unit_env` first runs a new whole-file check, `_box_env_shell_plain`, on each READABLE file, called directly (never in `$(…)`, so its out-params survive). It passes a file only when every line is blank (spaces and tabs only), a comment (spaces or tabs, then `#`), or `[export<ws>]NAME=` followed by a shell-inert value (`[A-Za-z0-9_./:@%+,=-]*`), one whole `'…'` pair, or one whole `"…"` pair with no `$`, backtick, `\` or `"` inside, then only optional spaces or tabs; `NAME` is `[A-Za-z_][A-Za-z0-9_]*` and starts the line; and no line holds a CR. When either file fails, EVERY key answers rc 3 (not measured), and `BUE_WHY` names that file and the first failing line BY NUMBER, never its content. There is no per-key taint and no precedence over a failing file: bash runs `ccrc.env` before the exposure file, so a line in it can change how the exposure file's assignments land (`readonly CCRC_AUTH`). When both pass, each file is read in `shell` mode: an `export<ws>` prefix is dropped, trailing spaces and tabs are dropped, one whole quote pair is stripped, the last assignment wins, and the exposure file wins by presence. A canonical file (only `KEY=value` lines and comments) answers exactly what main answers.
  - The 43 two-argument callers are unchanged, CR handling included: the per-line CR strip is `unit`-mode only.
- **D-3823** — D-3596 gave `_box_unit_env` one unmeasured state, rc 2, an exposure file there and unreadable. Every `_check_auth` WARN names that cause literally (`ccd/ccrc-doctor-checks`: "`$CCRC_EXPOSURE_FILE is there and cannot be read`"). A SECOND unmeasured state is added: rc 3, with two new out-params, `BUE_WHY` (a clause naming the file and the cause) and `BUE_FIX` (the remedy clause for that cause).
  - **On Linux,** rc 3 means a readable file names the key in a shape this reader does not decide: a space or tab before `=`; a physical line ending in `\` directly before the key's line (a comment's included, for the v254 reason in Risk notes); a backslash in the value; a quote in the value that is not one whole pair (`"on"x`, `on"`); a quote that opened on an EARLIER line and was not shown closed (any non-comment line before the key whose value carries a quote that is not one whole pair on that line taints every later key line); an `export ` prefix (`export KEY=` or `export KEY =`, never a longer key that begins with KEY). Precedence by presence is kept: an exposure file that decides the key wins over an undecidable `ccrc.env`, as the second `EnvironmentFile=` does.
  - **On Darwin,** rc 3 means either file failed `_box_env_shell_plain` (D-3822), for every key. Its `BUE_WHY` names the line number and which of two causes fired (a carriage return; a line that is not a plain assignment), and never the line's bytes.
  - The rc-2 arm (the exposure file there and unreadable) is checked first on both platforms, unchanged.
  - `_check_auth`, `_check_update-exposure` and install's gate line word rc 3 from `BUE_WHY` and `BUE_FIX`, captured right after each read. Their rc-2 sentences stay byte-identical.
- **D-3824** — `ccrc-doctor.test.ts:2941` (`reads a value systemd would not set as OFF, exactly as config.ts does`) pins `'on '` and `'"on"x'` as OFF.
  - `'on '`'s premise was wrong: systemd hands `on` to the server for `CCRC_AUTH=on `. It leaves that case's list and becomes a case of its own that expects ARMED. A quoted `"on "` stays OFF, as a control.
  - `'"on"x'` leaves the list too and becomes case E8, not measured: this reader does not model what either parser does after a closing quote (ruling 2).

### Task 5 — `ccrc backup`

- **D-3825** — `cmd_backup`'s header and usage say it prunes "to the newest `$CCRC_BACKUP_KEEP` … timestamped backups" (`ccd/ccrc:2201-2204`, `:20871-20878`), and `_bak_prune` keeps by count alone. It now gets `_bak_gc`'s protections through one shared helper, `_bak_keepset`.
  - The protections are: this run's own dir by exact path; every dir named at or after the second `cmd_backup` began (`UPD_BAK_FLOOR`, set there); and the newest earlier tree backup and coord.db snapshot.
  - So at `CCRC_BACKUP_KEEP=0` the backup just taken survives, and more than KEEP dirs can survive.
  - The prune echo, the invalid-KEEP refusal and their exit codes stay byte-identical.
  - **Why the shared helper, not a call to `_bak_gc` itself:** `_bak_gc` never dies and words every line `<lead>: backups: …`. P17 pins `ccrc backup`'s echo byte-identical (`ccrc-update.test.ts:12267-12274`), and the F6 describe pins its refusal as exit 1 with `ccrc: … — nothing was pruned` (`ccrc-uninstall.test.ts:1231-1280`). Routing through `_bak_gc` would break both pinned contracts. The helper gives one spelling of WHAT is protected, under each verb's own words.
- **D-3826** — Wave 8's Out of scope recorded that `cmd_backup`'s prune "takes no lock". It now takes `~/.ccrc/update.lock` with `_ver_lock_try` for the prune only, and releases it if it took it.
  - When another holder has the lock, when `flock` is absent, or when the lock cannot be measured, it prunes nothing and says so in one line, and `ccrc backup` exits 0: the backup itself was taken.
  - On main, the same states pruned.
  - The copy is not locked, by ruling 3 (Risk notes).

### Task 6 — prose

- **D-3827** — R-B1's working remedy, carried by D-3466's reason line, is `ccrc update --to $stamp_name --downgrade` (`ccd/ccrc:16596`), printed for every `KF_WHY`. In the killed-flip state that is an in-place write into the tree the units run (rsync `--delete` at `:13106`, `npm ci` at `:13149`). By ruling 6 the line now never advises an in-place write. Its tail comes from a new `_kf_remedy`, which RE-MEASURES when it prints rather than trusting which condition failed earlier — two reachable cases showed an earlier answer is not enough:
  - `_rollback_killed_flip_state` returns at condition 5 before it checks condition 6 (`ccd/ccrc:16654-16662`), so a kept pre-W6 target whose kept stamp has another sha reads as a condition-5 failure, and its hand install would run that pre-W6 spine's `npm ci` in `~/ccrc`;
  - at the flip-failed caller (`:17004`) the state was measured before `_ver_flip_back`, which returns 1 when `_ver_kept` NOW answers 3 or any other non-zero (`:19843-19849`); the hand install from a written-through dir takes `_inst_tree`'s placed arm with `kept_rc` non-zero and runs `npm ci` in the old version's tree, which the still-running units loaded from (`:13144-13149`).

  `_kf_remedy` names `bash ~/ccrc-versions/$stamp_name/ccd/ccrc install --role $role`, with a parenthesis saying what it does (it installs from that version's own kept directory: no download, no tree copy, no npm ci), only when `role` is non-empty and all three hold at print time, measured under that same role. The role is always named: a bare `ccrc install` defaults to role `both` and never reads the recorded `CCRC_ROLE` (`cmd_install`'s `local role=both`, `ccd/ccrc:12048-12067`), so on a fleet box it would check and install the server build and could run `npm ci` in `$dest/server` in place — the write ruling R-D forbids. When `role` is empty it names no command. The three conditions: `_ver_kept "$stamp_name" "$role"` answers 0; that dir's `ccd/ccrc` carries `^BOX_VERSIONS_ROOT=`; and the role is not `fleet` or the dir holds `agent/node_modules` (`_inst_tree`'s own kept condition, `:13145-13146`). In every other case, by round-2 ruling R-D, it names NO command and points at NO recipe — README's Restore recipe writes through `~/ccrc`, which in this state points at the version the units do not run — and says that no safe one-line repair is known for this state and nothing on this box was changed. The `KF_ARM` out-param of the earlier draft is dropped: one measurement, at print time, decides.
- **D-3828** — The four `install: stamp: skipped (…) — ccrc version will say unstamped` lines (`ccd/ccrc:13943`, `:13949`, `:13957`, `:13975`) are false whenever a box stamp still exists after the skip: a running launcher keeps it (`_inst_stamp_unname` returns 1 for `running` before it touches the stamp, `:13820`), and so does R8e's no-source path. The tail becomes "the box's existing stamp (~/.ccrc/build.json) stays — ccrc version reports what it says" when that path still exists (`[ -e ] || [ -L ]`, which admits a dangling link, so nothing is promised about what `ccrc version` can read), and is unchanged when it does not.
  - `_inst_stamp`'s own header (`:13904-13907`) says the skip "writes NOTHING rather than carrying a previous stamp forward: a stamp that outlives the tree it described is a lie with a timestamp on it" — the very stay the new line reports. It is reworded in place, four lines for four: the skip writes nothing; it neither rewrites nor removes an existing stamp (only `_inst_stamp_unname` removes one, for a placed or copied tree), and its line says which is the case.
- **D-3829** — D-3598 kept install's no-passphrase line byte-identical in every case but a measured `on`. Two cases now print their own line:
  - the exposure file there and unreadable (rc 2), which gets a "not measured" line;
  - the exposure file deciding the flag (`BUE_SRC` is the exposure file), whose arming remedy names that file, as the present-passphrase arm's `gate_how` already does.

  The fresh-box line is byte-identical in every other case. The comment that says otherwise is corrected in both copies: `ccd/ccrc:12246-12261` and the G2 block's comment in `ccrc-install.test.ts` (`:5291-5303`).
- **D-3830** — Committed plans are snapshots. Three are amended in place, with no new number, each amendment marked "(wave 9, R…)":
  - the residue plan (R7b: `:40`, `:719`, and `:381`/`:398` only if re-measured off);
  - wave 8's plan (R11-F4, D-3596's entry);
  - W2's plan (R4-2, D-3215's mutation count at `:139`).

## File structure

**New**
- `docs/superpowers/plans/2026-10-02-centralised-update-w9-stable-readiness.md` — this plan, added in Task 1's commit with the minted numbers in place of the slugs.
- `server/test/containedTools.ts` (Task 3) — `CONTAINED_TOOLS`, `plantPoison`, `loopbackCurlFront`, `assertNoRealTool`. Imports only `node:*`.
- `server/test/ccrcContainment.ts` (Task 3) — `ccrcContainedEnv`. It imports `containedTools.ts`, and `ghContainedEnv` and `harnessBin` from `ccdWsHelpers.ts`, and edits neither.
- `server/test/ccrc-containment.test.ts` (Task 3) — the checker's self-tests and the census.

**Changed**
- **Task 1:**
  - `server/test/ccrc-update.test.ts` — five spawn sites, one `it` → `itLinux`, the recorder import, and the source-scan case;
  - `server/test/update-spawn.test.ts` and `agent/test/update-spawn.test.ts` — `ESCAPEE_WAIT`/`ESCAPEE`, the header sentence, one pgid assertion in each of the two escapee cases, and the bounded-wait case;
  - `agent/test/update-killed-arms.test.ts` — the launcher at `:332`, its comment, and the arm-D case's `BOUND_MS` (`:335`);
  - `server/test/installTreeFixture.ts` — `rsyncRecorder`, appended at the end of the file (PR #222 edits its `TREE_FILES` near `:116`);
  - `server/test/ccrc-install.test.ts` — the recorder import at `:614`, `runInstall`'s `noManager` and its comment, the darwin block's three calls, and the openrsync twin;
  - `server/test/ccrc-install-graphify.test.ts` — the recorder import at `:298`.
- **Task 2:**
  - `ccd/ccd` — `:2`, `:2853`, `:19626-19628` (the `${1#cc-}` comment, reworded in place), `:20603`, `:20637-20638`, `:20669`, and `:23959-23963` (the D-3525 sentence, reworded in place);
  - `ccd/ccrc` — `_acct_live`'s locals (`:7756`), its comment (`:7848-7851`) and its match (`:7853`), all in place;
  - `shared/tmux-target.ts`;
  - `ccd/ccd-telemetry-keepalive` — the comment at `:485-488`, line-neutral, no code;
  - `server/test/ccd-tmux-anchor.test.ts` — `:404`, the header (`:20-23`) and the dotted case's comment (`:220-223`) reworded in place (case 12's title byte-identical), the new describe and the census case;
  - `server/test/keepalive-freshness-parity.test.ts` — `CCD_TMUX_NARROW` (`:192`) and the header bullet (`:169-174`);
  - `server/test/ccd-route-settle.test.ts`;
  - `server/test/exec.test.ts` (one table, and the comment at `:66-67` reworded in place).
- **Task 3:**
  - `server/test/ccrc-update.test.ts` — `updateEnv`, `chainEnv`, `runUpdate`, the four raw spawns, the real-curl cases' allow-port lines, and `:4127`'s missing `env` (`{ HOME: home }`);
  - `server/test/ccrc-install.test.ts` — `ccrcEnv`, `FIXTURE_BINS`, `runInstall`, the `sourced` harness (`:2457`), the `_inst_caps` spawn (`:6131`), `pathMissing`;
  - `server/test/ccrc-cli.test.ts` — `ccrcEnv`, `:632`, `:660`;
  - `server/test/ccrc-install-graphify.test.ts` — `ccrcEnv`;
  - `server/test/installTreeFixture.ts` — `keepDigest`, the new `keepDigestEnv`, and the header line naming the one non-node import;
  - `server/test/ccd-tmux-anchor.test.ts` — Task 2's case 1(e): the remaining `CONTAINED_TOOLS` poisons and one `assertNoRealTool` call.
- **Task 4:**
  - `ccd/ccrc` — `_box_env_value` and its header, the new `_box_env_shell_plain` (directly below it), `BUE_WHY`/`BUE_FIX` and `BEP_LINE`/`BEP_CAUSE`, `_box_unit_env` and its header, and install's gate line, both arms (`:12266-12283`) and its comment (`:12246-12261`), for rc 3;
  - `ccd/ccrc-doctor-checks` — `_check_auth` (`:1310-1311`, the helper's rc 0 and rc 3 WARN arms and rc 4's tense) and `_check_update-exposure` (`:1834-1845` and the verdict arms `:1871-1885`);
  - `server/test/ccrc-doctor.test.ts`;
  - `server/test/ccrc-install.test.ts` (gate-line cases);
  - `README.md` — doctor's auth paragraph, line-neutral.
- **Task 5:**
  - `ccd/ccrc` — `cmd_backup` and its header, `_bak_prune`, `_bak_gc`'s selection loop moved into `_bak_keepset`, and the `backup` usage text (`:2201-2204`), line-neutral;
  - `server/test/ccrc-update.test.ts` (beside P17);
  - `server/test/ccrc-uninstall.test.ts` (run; edited only if a case's premise changed, named);
  - `README.md` `:716-718`, line-neutral.
- **Task 6:**
  - `ccd/ccrc` — `:12246-12261` and `:12278-12283` (R10b), `:13904-13907` and `:13943`/`:13949`/`:13957`/`:13975` (R8i), the new `_kf_remedy` and `:16578-16596` (R9-F1), `:20083` (R11-F5);
  - `README.md` `:653-654` (R7a) and `:709` (R9-F6);
  - `server/test/ccrc-update.test.ts` — F1's title (`:2785`), P18's comment (`:12286`), `expectRefused`'s remedy assertion (`:11537`) and the flip-only pin (`:11805`);
  - `server/test/ccrc-doctor.test.ts` (F2, `:3349-3367`);
  - `server/test/ccrc-install.test.ts` (R8i, R10b pins, the G2 comment `:5291-5303`);
  - `server/test/update-local-spawn-throw.test.ts` (R7b, `:75-80`);
  - `server/test/update-catalogue.test.ts` (R4-2, `:1442-1474`);
  - `docs/superpowers/plans/2026-09-29-centralised-update-residue-before-stable.md` (R7b);
  - `docs/superpowers/plans/2026-09-30-centralised-update-w8-live-audit-residue.md` (R11-F4);
  - `docs/superpowers/plans/2026-09-22-centralised-update-w2-control-plane.md` (R4-2, `:139`).
- **Run, not edited:**
  - `ownership`, `session-hook`, `single-definition`, `topology-clean`, `deviation-refs`, `dtbd`, `typecheck-tests`;
  - `ccd-backend-vs-placement`, `ccd-harness-containment`, `ccd-workspaces`, `stall-sweep`, `ccrc-account`;
  - `ccrc-uninstall`, `ccrc-versioned-audit`, `ccrc-rollout`, `macos-platform`, `runbook-holds`, `readme-holds`, `pools-prose`;
  - the agent suite.

## Tasks

### Task 1: The macOS harness — M1–M7 (test-only)

**Files:**
- **Modify `server/test/ccrc-update.test.ts`:**
  - `:4162`, `:4195`, `:4233`: `spawnSync('bash', ['-c', [redactBlock![0], '_upd_redact "$1"'].join('\n'), '_', text],` → `spawnSync(BASH, …`. Each `env` object stays exactly as it is.
  - `:4371`: `const p = spawnSync('bash', ['-c', harness],` → `spawnSync(BASH, …`.
  - `:4421`: `const r = spawnSync('bash', ['-c', harness], { env: { HOME: home }, encoding: 'utf8' });` → `spawnSync(BASH, …`.
  - `:11773`: `it('control (the detached child): …` → `itLinux(`, preceded by the file's own two-line form `// PLATFORM-ONLY: --detach is Linux-only (decision 17) — the macOS answer is` / `// \`itDarwin('--detach refuses on macOS by name …')\` above.`
  - `:539-540`: `plant('rsync', rsyncRecorder(RSYNC));`, with the import.
  - One new case at the end of the file's first top-level describe that holds the redact cases (1d below).
- **Modify `server/test/update-spawn.test.ts` (`:56`) and `agent/test/update-spawn.test.ts` (`:55`):** `ESCAPEE_WAIT` and `ESCAPEE`; the header sentence that says "a grandchild that left the group"; a `pgidOf` helper beside `alive`; one assertion in each of the two escapee cases; the bounded-wait case (1g).
- **Modify `agent/test/update-killed-arms.test.ts` `:332`:** the launcher's `setsid sh -c 'echo $$ > "$HOME/gc-pid"; exec sleep 300' &` becomes the node-detached start below, writing `$HOME/gc-pid`; its comment (`:330-331`) names the mechanism; the title is unchanged (ruling 8). `const BOUND_MS = 300;` (`:335`) becomes `2000`, with a comment: node now starts the escapee in the FOREGROUND before the parent hangs, and must have done so before the group kill lands (node's spawn measured 50–80 ms at load ~57); every assertion is relative to `BOUND_MS`, so none changes meaning (Risk notes).
- **Modify `server/test/installTreeFixture.ts`:** append `rsyncRecorder` at the end of the file.
- **Modify `server/test/ccrc-install.test.ts`:**
  - `:613-614` → `plant('rsync', rsyncRecorder(RSYNC));`, with its comment kept;
  - `runInstall` (`:745-768`): `opts.noManager?: true`, and `expectAbsent` becomes `opts.noManager ? ['systemd-run', 'systemctl'] : (opts.omit ?? []).filter(…)`. Its comment's "the ONLY legitimate" sentence names the second case;
  - the darwin block's three `runInstall` calls pass `noManager: true`;
  - the openrsync twin (1f).
- **Modify `server/test/ccrc-install-graphify.test.ts` `:297-298`:** the recorder import.

**Interfaces and code:**
```ts
// installTreeFixture.ts, appended:
/** THE rsync recorder (wave 9 M6): logs the argv of every call ccrc MAKES, then execs the real binary. A call whose
 *  first argument is `--server` is the rsync implementation's OWN re-exec — openrsync, macOS's /usr/bin/rsync,
 *  forks `rsync --server …` by PATH lookup for a local copy and so reaches this file a second time; samba rsync on
 *  Linux copies in-process and never does — so it is handed straight on and not logged. One spelling, imported by
 *  ccrc-install, ccrc-update and ccrc-install-graphify. */
export function rsyncRecorder(realRsync: string): string {
  return `#!/bin/sh\ncase "$1" in --server) exec ${realRsync} "$@" ;; esac\n`
    + `printf '%s\\n' "$*" >> "$HOME/rsync-argv"\nexec ${realRsync} "$@"\n`;
}
```
```ts
// update-spawn.test.ts (both twins), replacing ESCAPEE. The node that runs this suite starts the grandchild with
// `detached: true` — libuv calls setsid() — and `stdio: 'inherit'` hands it the launcher's stdout and stderr, the
// pipes under test. `process.execPath` is absolute because ENV's PATH (`/usr/bin:/bin`) holds no node on a runner.
// The wait is BOUNDED BY TIME, not by a count of `sleep` forks (500 × `sleep 0.01` measured 6.6–6.8 s at load 45–57):
// bash's own `SECONDS` (whole seconds, so the bound is 2–3 s of wall time — measured 2.7–3.0 s at load 22–56; a builtin in bash 3.2 too, and the launcher
// is `#!/bin/bash`). It says why it stopped — pinned by (1g).
const ESCAPEE_WAIT = 'w=$((SECONDS + 3)); while [ ! -s "$DIR/escapee.pid" ] && [ "$SECONDS" -lt "$w" ]; do sleep 0.05; done\n'
  + '[ -s "$DIR/escapee.pid" ] || { echo "fixture: the escapee never wrote its pid" >&2; exit 91; }';
const ESCAPEE = `'${process.execPath}' -e 'require("child_process").spawn("bash", ["-c", "echo $$ > \\"$DIR/escapee.pid\\"; exec sleep 300"], { detached: true, stdio: "inherit" }).unref()'\n`
  + ESCAPEE_WAIT;
/** The process group `pid` is in, by `ps` (procps and BSD ps both answer `-o pgid=`). */
const pgidOf = (pid: number): number => Number(spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim());
// In each escapee case, after the escapee's pid is read:
//   const escapee = await pidFrom(path.join(dir, 'escapee.pid')); pids.push(escapee);
//   expect(pgidOf(escapee), 'the escapee did not leave the parent\'s group — the case would not test a pipe holder outside it').not.toBe(parent);
// (the spawner makes the parent its own group leader — `detached: true`, pgid = pid — so its pgid IS `parent`).
```
```ts
// agent/test/update-killed-arms.test.ts:332, the launcher (a `#!/bin/sh` script; `$HOME` is the fixture's):
writeFileSync(launcher, `#!/bin/sh\n'${process.execPath}' -e 'require("child_process").spawn("sh", ["-c", "echo $$ > \\"$HOME/gc-pid\\"; exec sleep 300"], { detached: true, stdio: "inherit" }).unref()'\nexec sleep 300\n`);
```
Re-measure the JS quoting. Before running any suite, run each planted launcher once by hand in a scratch dir (`DIR` or `HOME` set to it), and check that the pid file holds a live pid whose pgid differs from the launcher's. Kill it by that pid.

- [ ] **Step 1: Re-measure the base for the whole wave,** on the tip being built, after `git fetch origin main` (and a merge if main moved):
  ```bash
  git rev-parse --short HEAD origin/main
  grep -n "spawnSync('bash'" server/test/ccrc-update.test.ts
  grep -n "^const BASH = realPath('bash');\|it('control (the detached child)\|itDarwin('--detach refuses on macOS by name\|^function updateEnv\|  const chainEnv = \|^  assertSpineFrontContained(env, home);" server/test/ccrc-update.test.ts
  grep -n "^const ESCAPEE\|^const ENV = \|for (let i = 0; i < 200; i += 1)" server/test/update-spawn.test.ts agent/test/update-spawn.test.ts
  grep -n "setsid" agent/test/update-killed-arms.test.ts server/test/update-killed-arms.test.ts
  grep -nF '"$*" >> "$HOME/rsync-argv"' server/test/ccrc-install.test.ts server/test/ccrc-update.test.ts server/test/ccrc-install-graphify.test.ts
  grep -n "const expectAbsent = (opts.omit\|describeDarwin('ccrc install: a macOS box missing what ccd needs'\|const pathMissing = \|expect(argv).toHaveLength(1);" server/test/ccrc-install.test.ts
  grep -n "^export function assertSpineFrontContained\|^const MANAGER_NAMES" server/test/codexLaneFixture.ts
  grep -n "^export function keepDigest" server/test/installTreeFixture.ts
  wc -l README.md ccd/ccd ccd/ccrc
  ```
  **Expected at `6ca3d163`:**

  | File | Lines |
  |---|---|
  | `ccrc-update.test.ts` | bare-bash spawns `:64`, `:75`, `:736`, `:895`, `:4162`, `:4195`, `:4233`, `:4371`, `:4421`, `:11271`, `:11274` — eleven, and only the five from `:4162` carry `env:`; `BASH` `:68`; the control `:11773`; the darwin twin `:6891`; `updateEnv` `:331`; `chainEnv` `:11057`; the two final-env calls `:655`, `:928` |
  | update-spawn | server `ENV` `:33`, `ESCAPEE` `:56`, `pidFrom`'s 200 × 10 ms loop `:38`; agent `ENV` `:32`, `ESCAPEE` `:55` |
  | setsid | `agent/test/update-killed-arms.test.ts:332` (under `describe.skipIf(!linux)` `:304`); `server/test/update-killed-arms.test.ts:471` (under `itLinux`, not edited) |
  | recorder | `ccrc-install:614`, `ccrc-update:540`, `ccrc-install-graphify:298` (the `grep -nF` above; a BRE spelling of `"$*"` matches nothing) |
  | `ccrc-install.test.ts` | `expectAbsent` `:762`, the darwin block `:1747`, `pathMissing` `:1767`, the two `toHaveLength(1)` at `:1243` and `:2688` |
  | `codexLaneFixture.ts` | `assertSpineFrontContained` `:1335`, `MANAGER_NAMES` `:1257` |
  | `installTreeFixture.ts` | `keepDigest` `:260` |
  | line counts | README 3813; `ccd/ccd` 27408; `ccd/ccrc` as measured (record it) |

  Also, before writing any test:
  - **The macOS facts.** Read the latest daily full run's `test-macos` legs (the brief names it). For each of the twelve cases, record its failure message, so that the PR's green is compared against a known red.
  - **Dependencies.** Confirm that `ps -o pgid= -p $$` answers on this box. Confirm that no file other than the three recorder sites plants an rsync recorder (`git grep -n 'rsync-argv' -- server/test`).
  - **Concurrent edits.** For `ccrc-install.test.ts`, `ccrc-update.test.ts` and `installTreeFixture.ts`, record which hunks of open PRs #222 and #226 and the GPT lane touch the same regions: `git fetch origin` then `git diff origin/main...origin/<branch> -- <file>` for each branch the brief names. This is read-only. Any later merge keeps both sides.
- [ ] **Step 2: Write the failing tests.**
  1. **`ccrc-update.test.ts`, case (1d):** `no bare-\`bash\` spawn in this file hands its child an env — a PATH-less env resolves macOS's /bin/bash 3.2 (wave 9 M1–M3)`.
     - It reads its own file. For every index of `NEEDLE` (built as `['spawnSync(', "'bash'"].join('')`, so the case never matches itself), it slices the text up to the first `encoding:` after it.
     - It asserts that no slice contains `env:` (failure message: `ccrc-update.test.ts spawns bare bash with an env at offset <n> — use BASH`), and that the number of NEEDLE hits is EXACTLY 6 (the env-less sites `:64`, `:75`, `:736`, `:895`, `:11271`, `:11274`; failure message names the count and says a new bare-bash spawn must use `BASH` or be counted here). The count is what makes a self-match (T1-M2) red.
     - It reds at main: five hits with `env:`, and eleven hits in all.
  2. **The openrsync twin (1f), `ccrc-install.test.ts`,** a top-level `describe('the rsync recorder logs only the call ccrc made (wave 9 M6)')`. It runs on every platform, so it is plain `it`:
     - **(a)** In a `mkTmp` dir, write, each with mode `0o755`:
       - `bin/rsync` = `rsyncRecorder(<dir>/fake-openrsync)`;
       - `fake-openrsync` = `#!/bin/sh\nif [ "$1" = --server ]; then touch "$HOME/server-ran"; exit 0; fi\nrsync --server --sender -logDtpre.iLsfxC . "$2"\nexit 0\n`;
       - `poison/rsync` = a recording poison (`printf '%s\n' "$*" >> "$HOME/rsync-poison"; exit 97`).

       Run `sh <dir>/bin/rsync -a src/ dst/` with `env: { HOME: <dir>, PATH: \`${<dir>}/bin:${<dir>}/poison:/usr/bin:/bin\` }`. Assert that `rsync-argv` is exactly `'-a src/ dst/\n'`, that `<dir>/server-ran` exists (the fake's `--server` arm ran, through the recorder), and that `rsync-poison` does not exist (a recorder that was not executable would have fallen through to it, never to the real rsync).
     - **(b)** The control: the same with a fake that never re-execs gives one line too.
     - (a) reds at main's recorder body. Measure that by temporarily pointing (a) at a copy of main's body: two lines. Record it.
  3. **`runInstall`'s new option, `ccrc-install.test.ts`:** `itLinux('noManager makes the final-env check require BOTH manager names absent — under ccrcEnv they resolve to the fixture front, so it refuses (wave 9 M7)')`. It asserts `expect(() => runInstall(freshBox('ccrc-install-nomgr-'), ['install'], {}, { noManager: true })).toThrow(/systemd-run was expected absent/)`. At main the option is ignored, `runInstall` spawns, and the `toThrow` reds.
  4. **update-spawn (both twins):** the pgid assertion, in the two escapee cases.
  5. **update-spawn (both twins), case (1g):** `the escapee's pid wait is bounded: with no escapee it stops at its own bound and says why (wave 9 M5)`. `const file = script(dir, ESCAPEE_WAIT)` (no escapee is started, so nothing leaks); `const t0 = Date.now(); const r = spawnSync(file, [], { env: ENV, encoding: 'utf8', timeout: 10_000 })`. Assert `r.status` is 91, `r.stderr` contains `fixture: the escapee never wrote its pid`, and `Date.now() - t0` is under 6000. The case passes an explicit per-case timeout, `, 20_000)`, in BOTH twins: `agent/` runs on vitest's default 5000 ms `testTimeout` (`agent/vitest.config.ts` sets none), and vitest fails a synchronous test that overruns its budget after it returns. At main there is no `ESCAPEE_WAIT`: record the red as the import failing, then the assertion red under T1-M5b.

  Run:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "no bare-"
  cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts -t "rsync recorder logs only|noManager makes"
  ```
  Expected: (1d) FAIL (5 env hits, 11 hits), (1f-a) FAIL, the `noManager` case FAIL. (1f-b) passes. Record the counts.
- [ ] **Step 3: Implement,** as in Interfaces and code above, and the M4 `itLinux`.
- [ ] **Step 4: Run,** one command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-install-graphify.test.ts test/update-spawn.test.ts test/update-spawn-deadline.test.ts test/update-spawn-twin-bodies.test.ts
  cd agent && ./node_modules/.bin/vitest run test/update-spawn.test.ts test/update-spawn-deadline.test.ts test/update-killed-arms.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts
  ```
  Expected: PASS. On Linux, the five moved spawns, the redact cases, the two escapee cases and the killed-arms arm-D case are green exactly as before.
- [ ] **Step 5: Mutation measurement,** per the table.
- [ ] **Step 6: Commit.** `git add` the Files above and this plan, then `git commit -m "test(update): the macOS harness — resolved bash, a Linux-only detach control, a portable escapee, a top-level rsync recorder, and a darwin block that reaches no manager (wave 9 M1–M7)"`. This commit carries every minted definition of this plan. The body names each of the eleven macOS cases this task should turn green, and says that only the PR's `test-macos` legs can show it.

**Mutation table (Task 1):**

| # | Guard | Mutation | Must red | Run | Measured |
|---|---|---|---|---|---|
| T1-M1 | M1–M3 use the resolved bash | `:4421` back to `spawnSync('bash', …)` | (1d): the `env:` assertion names one offset, and the count reads 7 | `ccrc-update -t "no bare-"` | 1 red, the `env:` assertion at one offset (`… spawns bare bash with an env at offset 275075 — use BASH`); the file then holds 7 bare-bash hits |
| T1-M2 | the scan cannot match itself | `NEEDLE` written as the plain literal | (1d)'s exact count (7, its own line counted); the `env:` assertion may stay green, which is why the count exists | same | 1 red, the exact count (`has 7 bare-bash spawns, expected exactly 6`); the `env:` assertion stayed green on the self-slice, as the row says |
| T1-M4 | M4 is Linux-only | `itLinux` → `it` at `:11773` | none on Linux (no pin claimed); macOS case 4 SKIPS only with it | macOS leg | macOS |
| T1-M5a | the escapee leaves the group | `ESCAPEE`'s node spawn with `detached: false` | both escapee cases, on the pgid assertion | `update-spawn` (server and agent) | 2 red per package (server 2 of 15, agent 2 of 12), both escapee cases, on the pgid assertion (`the escapee did not leave the parent's group …`) |
| T1-M5b | the wait is bounded | drop `&& [ "$SECONDS" -lt "$w" ]` from `ESCAPEE_WAIT` | (1g): `spawnSync` ends at its 10 s timeout (`r.signal` `SIGTERM`, `r.status` null) inside the case's 20 s budget, so the status-91 assertion reds — never the case timeout | `update-spawn -t "is bounded"` (server and agent) | 1 red per package, (1g): `r.status` null, `r.signal` SIGTERM after 10.0 s (`signal SIGTERM — the wait did not stop at its bound: expected null to be 91`), inside the case's 20 s budget |
| T1-M6 | the recorder skips `--server` | drop the `case` line from `rsyncRecorder` | (1f-a) | `ccrc-install -t "rsync recorder"` | 1 red, (1f-a): `rsync-argv` held `-a src/ dst/` plus the `--server --sender …` line; (1f-b) stayed green |
| T1-M6b | one spelling | re-inline the old body at `ccrc-update:540` | none by behaviour on Linux; `git grep -c 'rsync-argv"\\nexec' -- server/test` reads 1 only with the import (Step 4 checks; no pin claimed) | grep | `git grep -c` read `installTreeFixture.ts:1` only with the import, and `ccrc-update.test.ts:1` + `installTreeFixture.ts:1` with the body re-inlined; no behavioural red (none claimed) |
| T1-M7 | `noManager` reaches `expectAbsent` | `runInstall` ignores `opts.noManager` | the `noManager` case | `ccrc-install -t "noManager"` | 1 red, the `noManager` case: `expected [Function] to throw an error` (runInstall spawned) |

### Task 2: M8 — `ccd` names a tmux session already sanitised (LIVE)

**Files:**
- **Modify `ccd/ccd`, every edit in place and line-neutral:**
  - `:2853`: `_tmux()  { echo "cc-$1"; }                                  # id -> tmux NAME, for \`new-session -s\` only; a -t target is \`_tmux_t\` (D-3525)` becomes `_tmux()  { local n="cc-$1"; echo "${n//[.:]/_}"; }             # id -> tmux NAME, sanitised as tmux 3.4 renames it (wave 9 M8); a -t target is \`_tmux_t\` (D-3525)`.
  - `:20603`: `_inject_spawn_effort "$tname"` becomes `_inject_spawn_effort "$tname" "$id"`. The rest of the line, with its `_is_anthropic_backend` gate, is unchanged.
  - `:20637-20638`: the two header lines "The id is the tmux name with `cc-` stripped (`_tmux`), so the signature the / settle calls with stays (`ccd-backend-vs-placement.test.ts` pins the call)." are reworded in place, two lines for two: the id is the second argument; the one-argument form strips `cc-`, which is the id only for a name with no `.` or `:` (wave 9 M8).
  - `:20669`: `local t id="${1#cc-}" level; t=$(_tmux_at "$1")` becomes `local t id="${2:-${1#cc-}}" level; t=$(_tmux_at "$1")`.
  - `:19626-19628`, the comment "`${1#cc-}` because / this function knows the tmux NAME and `_pane_measurable` takes the id / `_tmux` built it from.", reworded in place, three lines for three: for a dotted id the strip gives the sanitised id, which `_tmux` maps to the same name, so the target `_pane_measurable` builds is the same session (wave 9 M8). `:19629`'s code is unchanged.
  - `:23959-23963`, the D-3525 sentence "So `=` + name + `:` — … — and the / name REWRITTEN the way tmux rewrites it: … which `_session_probe` reads as `gone` — destroy-eligible." is reworded in place, five lines for five. The separate "NEVER anchor an `-s`" paragraph (`:23965-23969`) is untouched. The new text says:
    - `_tmux` hands tmux an already-sanitised name, because tmux 3.4 rewrites `.` and `:` in a session name to `_` and tmux 3.7c keeps them (measured on the macOS runner);
    - `_tmux_at`'s rewrite is kept, and is a no-op on every name `ccd` creates;
    - it still matters for a hand-built name such as `cc-auth-$id`, whose roster id cannot carry a `.`.
  - `:2`: restamped (Global Constraints).
- **Modify `ccd/ccrc`, `_acct_live`, in place and line-neutral:**
  - `:7756`: the `local` line gains `n=""` (one line for one).
  - `:7853`: `case $'\n'"$names"$'\n' in *$'\n'"cc-$sid"$'\n'*) ACCT_LIVE_IDS+=("$sid") ;; esac` becomes `n="cc-$sid"; n="${n//[.:]/_}"; case $'\n'"$names"$'\n' in *$'\n'"$n"$'\n'*) ACCT_LIVE_IDS+=("$sid") ;; esac`.
  - `:7848-7851`, the comment, four lines for four: the pane's session name is `cc-<id>` with `.` and `:` as `_` — what `ccd`'s `_tmux()` creates (wave 9 M8; tmux 3.4 renamed a dot itself, 3.7c does not) — and this is an exact match rather than a substring for the reason it already gives (`cc-orchard` vs `cc-orchard-api`). The stale `ccd/ccd:1114` anchor is dropped.
- **Modify `shared/tmux-target.ts`:** `tmuxName` returns `` `cc-${id}`.replace(/[.:]/g, '_') ``; `tmuxTarget` returns `` `=${tmuxName(id)}:` ``. The docstring's third bullet is reworded: the NAME is created sanitised, so the target is exact on any tmux version. The file still imports nothing.
- **Modify `ccd/ccd-telemetry-keepalive` `:485-488`** (comment only, line-neutral): its target is exact "as ccd's `_tmux_at` spells it", and ccd now creates every session under the already-sanitised name. `:489`'s code is unchanged.
- **Test `server/test/ccd-tmux-anchor.test.ts`:**
  - `:404` → `expect(CCD_SRC).toMatch(/^_tmux\(\)\s+\{ local n="cc-\$1"; echo "\$\{n\/\/\[\.:\]\/_\}"; \}/m);`, with the title unchanged;
  - the header (`:20-23`) and the dotted case's comment (`:220-223`), reworded in place to say ccd creates the sanitised name (tmux 3.4 would have renamed it the same way; 3.7c would not). Case 12's TITLE (`:219`) stays byte-identical: it is the macOS acceptance identifier;
  - one new top-level describe with five cases (a–e), and one census case. `tmuxName` joins the `tmux-target.js` import.
- **Test `server/test/keepalive-freshness-parity.test.ts`:**
  - `:192` `CCD_TMUX_NARROW` → `/^_tmux\(\)[ \t]+\{ local n="([a-z][a-z0-9-]*)\$1"; echo "\$\{n\/\/\[\.:\]\/_\}"; \}/`. It keeps the prefix capture, so 'and the two are the same prefix' (`:224-233`) still compares `cc-` with `KA_TMUX_PREFIX`. Measured against the new line: it captures `cc-`, and `CCD_TMUX_BROAD` still counts exactly one.
  - The header bullet (`:169-174`, "THE SESSION NAME (`_tmux()`, `id -> tmux name`)"), reworded in place: the name is created already sanitised (wave 9 M8).
- **Test `server/test/ccd-route-settle.test.ts`:** one case.
- **Test `server/test/exec.test.ts`:** one table case beside `:68`. The dotted case's comment (`:66-67`, "`-s cc-w-my.site` creates `cc-w-my_site` (measured): the unrewritten anchor answers `can't find session`…") is reworded in place, two lines for two: `tmuxName` now creates the sanitised name and `tmuxTarget` anchors it, so the rewrite happens once, at creation. Its title (`:65`, "tmuxTarget applies tmux's own `.`/`:` -> `_` rewrite, …") stays: `tmuxTarget`'s output still carries that rewrite, through `tmuxName`, and T2-M3 names the case by that title.

**Interfaces and code:** as in Files. Nothing else in `ccd/ccd` changes: no other `_tmux` caller, no `-t` site, and no `_tmux_at`/`_tmux_t` body.

- [ ] **Step 1: Re-measure.**
  - Every anchor above, by its quoted text.
  - **Every copy of the mapping, in either direction:** `git grep -n -E '#cc-|"cc-\$|cc-\$\{|\^cc-//' -- ccd shared agent/src server/src`. Expected at `6ca3d163`: `ccd/ccd:2853` (`_tmux`), `:19629`, `:20669`, `:23559`, `:24021` (`cmd_clip`'s `sed 's/^cc-//'`), `ccd/ccrc:7853` (`_acct_live`), `ccd/ccrc-api:273`, `ccd/session-hook.sh:2762`, `ccd/statusline-command.sh:305`, `shared/tmux-target.ts:28`, plus the comment at `ccd/ccd:19626` — eleven lines.
  - **Every reader of a live session NAME, whatever spelling strips the prefix:** `git grep -n -E "'#S'|#\{client_session\}|#\{session_name\}" -- ccd shared agent/src server/src`. Expected at `6ca3d163`: `ccd/ccd:4493` (`_lc_obs`, which records the name as an observation and maps no id), `:20517` (`set-titles-string`, display), `:23344` (self-swap, a comparison), `:23559`, `:24020`, `ccd/ccrc:7838` (`_acct_live`'s listing), `ccd/ccrc-api:228` (a comment) and `:270`, `ccd/session-hook.sh:2760`, `ccd/statusline-command.sh:304`, and the `shared/api.ts:7176` docstring — eleven lines. Each one that turns a name into an id must be among the reverse maps above; a new one is reported, never silently classified. Then `git grep -n 'KA_TMUX_PREFIX' -- ccd`: `:448` (the declaration), `:489` (the target), `:540` (display text only).
  - For each hit, record whether it is a forward copy (id → name) or a reverse map (name → id), and whether the value reaches a REGISTRY read or only a target builder:
    - `:2853`, `tmux-target.ts:28`, `ccrc:7853` are forward copies, all sanitised by this task;
    - `:19629` passes the stripped name to `_pane_measurable`, whose only use is `_tmux_t "$1"` (`:16809`), so it is target-only and idempotent;
    - `:20669` reaches `$REG/$id.effort` and `_route_get`, which this task fixes;
    - `:23559`, `:24021`, `ccrc-api:273`, `session-hook.sh:2762` and `statusline-command.sh:305` derive from a LIVE name (D-3816).
  - `grep -n '\$(_tmux "\|_tmux_new_session ' ccd/ccd`. Expected: every `_tmux` caller (`:9060`, `:20120`, `:20537`, `:23344`, `:23971` — `_tmux_t`'s own body —, `:24884-24887`, `:26537-26541`), every creator (`:9152` `cc-auth-$id`, `:20452`, `:20510`), and the comment at `:8959`. Record that the auth pane's id is a roster id (`shared/roster.ts:331` `/^[a-z][a-z0-9-]{0,31}$/`, no `.` or `:`).
  - `wc -l ccd/ccd ccd/ccrc`, and the `tmux -V` the suite's REAL_TMUX reports.
- [ ] **Step 2: Write the failing tests.**
  1. **`ccd-tmux-anchor.test.ts`, a new top-level describe** that runs WITHOUT real tmux, `describe('wave 9 M8 — ccd creates the NAME already sanitised, so the target matches on any tmux version')`. It has its OWN harness: `let m: CcdHarness;` with `beforeAll(() => { m = makeCcdHarness('ccrc-ccd-tmux-name-'); })` and `afterAll(() => { m?.cleanup(); })`, and runs snippets through `m.sh(…)`. It never touches the module's `h`/`sh` (those belong to the `describe.skipIf(NO_TMUX)` block, whose `beforeAll` displaces the harness's tmux poison with a shim that execs REAL_TMUX), and it plants no shim, so the harness's create-if-absent tmux and systemd-run poisons stay in place behind the function stub.
     - **(a)** `_tmux w-my.site; _tmux w-a:b; _tmux demo; _tmux w-x_y-z` prints `cc-w-my_site`, `cc-w-a_b`, `cc-demo`, `cc-w-x_y-z`. The last two are the live-alphabet controls: unchanged.
     - **(b)** With a FUNCTION stub `tmux() { printf '%s\n' "$*" >> "$HOME/tmux-argv"; return 1; }` (a function wins over PATH, and nothing real runs), `_tmux_new_session -d -s "$(_tmux w-my.site)" -x 200 -y 50 'exec cat' >/dev/null 2>&1; true`. Some recorded line starts with `new-session -d -s cc-w-my_site `, and none contains `cc-w-my.site`. This models tmux 3.7c: whatever tmux does with a dot, it is never handed one.
     - **(c)** `tmuxName('w-my.site')` is `'cc-w-my_site'`, `tmuxName('demo')` is `'cc-demo'`, and for every id in `['demo', 'w-my.site', 'a:b', 'x.y:z', 'w-x_y-z']`, `tmuxTarget(id) === \`=${tmuxName(id)}:\``. That identity pins only that `tmuxTarget` keeps no spelling of its own; it is tautological under a `tmuxName` mutation (T2-M3).
     - **(d)** For the live-alphabet ids `['demo', 'claude-a-proj', 'w-x_y-z', 'A1-b2_C3']`, `tmuxName(id) === \`cc-${id}\`` and `tmuxTarget(id) === \`=cc-${id}:\``. This is main's output, byte for byte.
     - **(e)** `ccrc`'s `_acct_live` finds a live DOTTED lane. In a `mkTmp` HOME: registry rows `.cc-sessions/w-my.site.uuid` and `.cc-sessions/w-my.site.wrapper` = `acct-a` (no trailing newline, `_reg_set`'s shape), and `.cc-sessions/demo.uuid` + `.wrapper` = `acct-a`.
       - Env, within 12 lines of the spawn (`ccd-workspaces.test.ts:1443-1450`'s source scan covers every `ccd*.ts` bash spawn, `SCAN_LOOKBACK_LINES` = 12): `const env = ghContainedEnv(home, { HOME: home, PATH: '/usr/bin:/bin', XDG_RUNTIME_DIR: join(home, 'no-runtime-dir'), DBUS_SESSION_BUS_ADDRESS: \`unix:path=${join(home, 'no-bus')}\` }, { systemd: true, tmux: true });` — the shape this file's own `kaProbe` uses (`:309`).
       - The spawn is `spawnSync(BASH, …)`, where `BASH` is resolved ONCE through the parent's PATH at module scope (`ccrc-update.test.ts:63-68`'s idiom), and is NAMED `BASH` so that scan sees it. Never a bare `'bash'` under this PATH: on macOS that is 3.2.
       - The script: `-c '. "$1"; _plat_timeout() { shift; "$@"; }; tmux() { printf "cc-w-my_site\ncc-demo\n"; }; _acct_live acct-a; printf "%s|%s\n" "$ACCT_LIVE_MEASURED" "${ACCT_LIVE_IDS[*]}"' _ <repo>/ccd/ccrc`.
       - Assert: the part before `|` is `true`, and the ids after it, split on spaces and SORTED, equal `['demo', 'w-my.site']` (a set: the registry glob lists `demo` first, and the case must not depend on glob collation); and `<home>/tmux-calls` (the harness tmux poison's log) does not exist.
       - A control in the same case: list-sessions answering only `cc-demo` gives `true` and the ids `['demo']`.
       - At main the dotted row is missed: red (`true|demo`, measured). It sources `ccd/ccrc` here, in Task 2's own file, rather than in the GPT lane's `ccrc-account.test.ts`. Task 3 adds the remaining `CONTAINED_TOOLS` poisons and an `assertNoRealTool(env, home)` line to this case, because it sources the whole `ccd/ccrc` (Global Constraints).
  2. **The census describe, a new case:** `_spawn_settle` hands `_inject_spawn_effort` the id. Through `functions(CCD_SRC)`, `_spawn_settle`'s body contains `_inject_spawn_effort "$tname" "$id"`.
  3. **The existing dotted case (`:219`)** keeps its title and assertions. Its `sessions()` must equal `['cc-w-my_site']` on both tmux versions, and it is macOS case 12.
  4. **`ccd-route-settle.test.ts`:** `a DOTTED id's effort record is read by its id, not by its sanitised name (wave 9 M8)`. Seed `w-my.site` (`_reg_set w-my.site wrapper claude; _reg_set w-my.site uuid deadbeef-0000-4000-8000-000000000000; _reg_set w-my.site class opus; _reg_set w-my.site effort high`), then `${STUBS} _inject_spawn_effort cc-w-my_site w-my.site` with `PANE_TEXT: READY`. Expect `typed()` to equal `[]`. At main the second argument is ignored, the id read is `w-my_site`, no record is found, and `/effort ultracode` is typed: red.
  5. **`exec.test.ts`:** beside `:68`, `tmuxTarget('a:b')` is `'=cc-a_b:'` and `tmuxTarget('demo')` is `'=cc-demo:'`. Green at main: these are the target controls.

  Run:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccd-tmux-anchor.test.ts test/ccd-route-settle.test.ts test/exec.test.ts test/keepalive-freshness-parity.test.ts
  ```
  Expected: FAIL on 1(a), 1(b), 1(c)'s `tmuxName` assertions, 1(e), 2, and 4. Once `:404` and `CCD_TMUX_NARROW` are edited (before Step 3), those two literal pins red too: `:404`'s case and `keepalive-freshness-parity`'s two `_tmux` cases. 1(d), 5 and every other existing case are green. Record the counts.
- [ ] **Step 3: Implement,** as in Files, then restamp `ccd/ccd` (from the repository root).
- [ ] **Step 4: Run,** one command per call:
  ```bash
  wc -l ccd/ccd ccd/ccrc    # both equal Step 1's counts
  cd server && ./node_modules/.bin/vitest run test/ccd-tmux-anchor.test.ts test/ccd-route-settle.test.ts test/exec.test.ts test/ownership.test.ts test/keepalive-freshness-parity.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccd-backend-vs-placement.test.ts test/ccd-authdead.test.ts test/ccd-lifecycle-sites.test.ts test/stall-sweep.test.ts test/ccd-login-screen.test.ts test/ccd-pane-box-draft.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts test/ccd-harness-containment.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-account.test.ts
  cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/single-definition.test.ts
  cd agent && ./node_modules/.bin/vitest run
  ```
  Expected: PASS. `session-hook`'s census is unmoved, because both edits are line-neutral. `ccd-backend-vs-placement.test.ts:126`'s substring `_inject_spawn_effort "$tname"` still matches the edited line. `ccrc-account` is the GPT lane's file, run unedited: its live-lane cases use clean ids.
- [ ] **Step 5: Mutation measurement,** per the table.
- [ ] **Step 6: Commit.** `git commit -m "fix(ccd): name a tmux session already sanitised, so its exact target matches on tmux 3.4 and 3.7c alike; the settle reads effort by id, and account removal sees a dotted lane (wave 9 M8)"`. The body states:
  - that it is live on merge;
  - that tmux 3.4 already created these names, so no live session is renamed;
  - that no live id carries `.` or `:` (the coordinator's measurement);
  - the restamp;
  - `_acct_live`'s fix (D-3814), which also closes a 3.4 fail-open;
  - D-3816, with all five readers.

**Mutation table (Task 2):**

| # | Guard | Mutation | Must red | Run | Measured |
|---|---|---|---|---|---|
| T2-M1 | the name is sanitised in bash | `_tmux` back to `{ echo "cc-$1"; }` | 1(a), 1(b), `:404`, `keepalive-freshness-parity`'s 'ccd still derives the tmux name by one prefix, in exactly one spelling'; macOS case 12 | `ccd-tmux-anchor`, `keepalive-freshness-parity` | 5 red: ccd-tmux-anchor 1(a) (`cc-w-my.site` for `cc-w-my_site`), 1(b) (no `new-session -d -s cc-w-my_site ` line) and the `:404` literal pin; keepalive-freshness-parity's two `_tmux` cases (canonical spelling `+0 to be 1`, and the same-prefix case on that same assertion). MacOS case 12 not measurable on Linux (tmux 3.4 renames the dot itself, so it stays green here) |
| T2-M2 | `:` too, not only `.` | `_tmux`'s class `[.:]` → `[.]` | 1(a)'s `cc-w-a_b` | `ccd-tmux-anchor` | 2 red: 1(a) (`cc-w-a:b` for `cc-w-a_b`) and the `:404` literal pin |
| T2-M3 | the name is sanitised in TS | `tmuxName` back to `` `cc-${id}` `` | 1(c)'s `tmuxName` assertions; `ccd-tmux-anchor`'s 'tmuxTarget is the anchored, sanitised form' (`:475`, `=cc-w-my_site:`); `exec.test.ts`'s 'tmuxTarget applies tmux's own … rewrite' (`:68`). 1(c)'s target identity stays GREEN: it is tautological under this mutation | `ccd-tmux-anchor`, `exec` | 4 red: 1(c)'s `tmuxName` assertions (`cc-w-my.site` for `cc-w-my_site`); the census's 'tmuxTarget is the anchored, sanitised form' (`=cc-w-my.site:`); exec.test.ts's 'tmuxTarget applies tmux's own … rewrite' and the new colon-id control (`=cc-a:b:`). 1(c)'s target identity stayed green, as predicted |
| T2-M4 | live ids are unchanged | `tmuxName` also maps `-` to `_` | 1(d) | `ccd-tmux-anchor` | 4 red: 1(d) (`cc_demo` for `cc-demo`), 1(c), the census's sanitised-target case, and the real-tmux 'control: a live cc-demo reads as itself' (`gone` for `live`); the mutation also rewrites the prefix hyphen |
| T2-M5 | effort reads the id | `:20669` back to `id="${1#cc-}"` | 4 | `ccd-route-settle` | 1 red: ccd-route-settle's DOTTED-id case (`[ Array(1) ]` typed, expected `[]`); 15 others green |
| T2-M6 | the settle passes the id | `:20603` drops `"$id"` | 2 | `ccd-tmux-anchor -t "hands _inject_spawn_effort"` | 1 red: 'hands _inject_spawn_effort the id' (`_spawn_settle`'s body lacks `_inject_spawn_effort "$tname" "$id"`) |
| T2-M7 | the restamp is real | edit one comment byte in `ccd/ccd` without restamping | `ownership` | `ownership` | 1 red: ownership 'verifies as ccrc-unmodified' (`ccrc-edited`); the 13 others green |
| T2-M8 | the parity pin still reads one prefix | `_tmux`'s prefix `cc-` → `cx-` | `keepalive-freshness-parity`'s 'and the two are the same prefix' (`cx-` ≠ `KA_TMUX_PREFIX`'s `cc-`) | `keepalive-freshness-parity` | 1 red: 'and the two are the same prefix' (`expected 'cc-' to be 'cx-'`); 'one prefix, in exactly one spelling' stayed green |
| T2-M9 | account removal sees a dotted lane | `ccrc:7853` back to the raw `"cc-$sid"` | 1(e): the sorted ids are `['demo']`, not `['demo', 'w-my.site']` | `ccd-tmux-anchor -t "_acct_live"` | 1 red: 1(e) (`{measured:'true', ids:['demo']}` for `['demo','w-my.site']`); 33 others skipped by `-t` |

### Task 3: Containment is structural — R10d, R9-F8

**Files:**
- **Create `server/test/containedTools.ts`** (imports only `node:*`):
  - `CONTAINED_TOOLS`;
  - `plantPoison(bin, name)`;
  - `loopbackCurlFront(realCurl)`;
  - `assertNoRealTool(env, home)`, with a long header saying why each piece exists.
- **Create `server/test/ccrcContainment.ts`:** `ccrcContainedEnv(home, base, opts)`.
- **Create `server/test/ccrc-containment.test.ts`:** the checker's self-tests (3a), and the census (3c).
- **Modify `server/test/ccrc-update.test.ts`:**
  - `updateEnv` (`:332`): `const env = ccrcContainedEnv(home, process.env, { managers: false, curl: 'loopback' });`, with its doc comment updated (D-3818);
  - `assertNoRealTool(env, home)` beside `:655` (builder) and `:928` (`runUpdate`'s final env), after each `assertSpineFrontContained`;
  - `chainEnv` (`:11058`) on `ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' })`;
  - the four raw spawns (`:4299`, `:6785`, `:6818`, `:6854`): `const env = { ...ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' }), …the case's own CCRC_* keys }`, with the case's own curl stub written BEFORE the call (create-if-absent keeps it), then `assertNoRealTool(env, home)`;
  - each real-curl case (`describe` at `:1335-1341`'s cases from `:1386`, `:6700`, `:6741`): one line writing its listener's port (M4: port 9) to `$HOME/curl-allow-ports`, and one assertion that `$HOME/curl-front-passed` is non-empty after the run (so a case that silently stopped reaching the real curl reds);
  - `:4127`, the extracted `_upd_redact`/`_ccrc_die` hook harness, which hands no `env` and so inherits the real HOME: `{ env: { HOME: home }, encoding: 'utf8' }`, with the `home` the case already makes (`:4124`). It is an extracted-function harness, exempt from `assertNoRealTool` (Global Constraints).
- **Modify `server/test/ccrc-install.test.ts`:**
  - `FIXTURE_BINS` (`:283-297`) → `[...new Set([...<today's list>, ...CONTAINED_TOOLS])]`, which adds `ssh` and `scp`;
  - `ccrcEnv` (`:350`) on `ccrcContainedEnv(home, process.env, { managers: false, curl: 'poison' })`;
  - `runInstall` calls `assertNoRealTool(env, home)` after `assertSpineFrontContained` (`:763`), and so do the runners at `:784`, `:5623` and `:6009`;
  - the `sourced` harness (`:2452-2459`): its env becomes a named `sourcedEnv(home)` on `ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' })`, with its own `sourced-poison` dir still prepended;
  - the `_inst_caps` harness spawn (`:6131`) on `ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' })`;
  - `pathMissing` (`:1767-1770`) prepends `<home>/no-<tool>-poison-bin` (D-3821).
- **Modify `server/test/ccrc-cli.test.ts`:** `ccrcEnv` (`:74`) and the spawns at `:632` and `:660` on `ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' })` (`:632`'s inner `PATH=/nonexistent-…` override stays: it is the case's subject); `runCcrcRaw` (`:58`) calls `assertNoRealTool` on its env.
- **Modify `server/test/ccrc-install-graphify.test.ts` `:129`:** `ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' })`, and its runner calls `assertNoRealTool` on its final env (as found).
- **Modify `server/test/installTreeFixture.ts`:** a new `keepDigestEnv(home)`, which `keepDigest` (`:260`) spawns under; the header names `containedTools.ts` as its one non-`node:` import, which keeps it vitest-free.
- **Modify `server/test/ccd-tmux-anchor.test.ts`, Task 2's case 1(e):** after its `ghContainedEnv(…)` line, `for (const n of CONTAINED_TOOLS) plantPoison(harnessBin(home), n);` (create-if-absent, so a no-op for what `ghContainedEnv` already planted; it adds `ssh`, `scp` and `curl`), then `assertNoRealTool(env, home)` before the spawn. The `ghContainedEnv(` text and both options stay within the source scan's 12 lines.

**Interfaces and code:**
```ts
// server/test/containedTools.ts — node:* only, so the vitest-free installTreeFixture.ts can import it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** THE names a ccrc test env may never let resolve outside its fixture HOME (wave 9 R10d). The two managers and their
 *  macOS twin, tmux (the live fleet server), gh (a repo-WRITE token), curl (a live server), ssh and scp (a live box).
 *  ONE spelling: the poisons, the checker, FIXTURE_BINS and the darwin probe bin all read this list. */
export const CONTAINED_TOOLS = ['ssh', 'scp', 'systemctl', 'systemd-run', 'launchctl', 'tmux', 'gh', 'curl'] as const;

/** A recording poison at `<bin>/<name>`, CREATE-IF-ABSENT — `ghContainedEnv`'s systemd/tmux rule, for its reason: a
 *  builder plants its functional stub AFTER this runs, and must win; a stub planted BEFORE it is kept. Records argv to
 *  `$HOME/<name>-poison`, exit 97. */
export function plantPoison(bin: string, name: string): void { /* existsSync → return; else write, mode 0o755 */ }

/** A curl that execs `realCurl` ONLY when every URL it is handed (any argument containing `://`, and the argument after
 *  `--url`) is `http://127.0.0.1:<port>/…` with `<port>` a line of `$HOME/curl-allow-ports`; it appends each passed
 *  URL to `$HOME/curl-front-passed`. Anything else — another host, an unlisted loopback port (the live server's 7788
 *  and the agent's 7789 included), `-K`/`--config` — is appended to `$HOME/curl-poison` and refused, exit 97. */
export function loopbackCurlFront(realCurl: string): string { /* #!/bin/sh … */ }

/** THROWS unless, under `env`, every CONTAINED_TOOLS name resolves to NOTHING or to a file whose REALPATH is inside
 *  realpath(home) — a symlink from the fixture to a real binary fails — and unless XDG_RUNTIME_DIR and
 *  DBUS_SESSION_BUS_ADDRESS are both SET and name a path inside home. One `/bin/sh -c 'command -v …'` per name; the
 *  resolved file is never executed. It reads RESOLUTION: a stub under home that itself execs a real binary is that
 *  stub's own contract (the rsync recorder's and the loopback curl front's are two), not this check's. */
export function assertNoRealTool(env: NodeJS.ProcessEnv, home: string): void { /* … */ }
```
```ts
// server/test/ccrcContainment.ts
import path from 'node:path';
import { ghContainedEnv, harnessBin } from './ccdWsHelpers.js';
import { plantPoison, loopbackCurlFront } from './containedTools.js';

/** The env every ccrc test builder, and every raw spawn of the real ccd/ccrc, starts from (wave 9 R10d): `base` with
 *  HOME the fixture, the user bus pointed at two paths under HOME that do not exist — SET, never deleted: ccrc's
 *  `: "${XDG_RUNTIME_DIR:=/run/user/$UID}"` (seven pairs in ccd/ccrc, :3034 first) would otherwise default to the REAL
 *  bus — then gh and tmux poisons from `ghContainedEnv`, and ssh, scp and launchctl poisons and the curl rule beside
 *  them, all create-if-absent in `harnessBin(home)`, first on PATH.
 *  `managers: true` also asks `ghContainedEnv` for its systemctl/systemd-run/launchctl poisons. A SPINE builder passes
 *  false: it fronts its own pair after `adoptPlantedSystemd`, which would rename an unmarked poison to a `.codex-*`
 *  delegate its fronts forward to (codexLaneFixture.ts:1281-1290) — every `--detach` systemd-run would answer 97 and
 *  `_svc_have_user_manager` would fall back to nohup. `assertSpineFrontContained` pins those builders' managers. */
export function ccrcContainedEnv(home: string, base: NodeJS.ProcessEnv,
  opts: { managers: boolean; curl: 'poison' | 'loopback' }): NodeJS.ProcessEnv {
  const env = ghContainedEnv(home, {
    ...base, HOME: home,
    XDG_RUNTIME_DIR: path.join(home, 'no-runtime-dir'),
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(home, 'no-bus')}`,
  }, opts.managers ? { systemd: true, tmux: true } : { tmux: true });
  const bin = harnessBin(home);
  for (const n of ['ssh', 'scp', 'launchctl']) plantPoison(bin, n);
  if (opts.curl === 'poison') plantPoison(bin, 'curl');
  else /* create-if-absent */ writeIfAbsent(path.join(bin, 'curl'), loopbackCurlFront(/* the real curl, resolved once through process.env's PATH */));
  return env;
}
```
```ts
// installTreeFixture.ts
import { mkdirSync } from 'node:fs';
import { CONTAINED_TOOLS, plantPoison } from './containedTools.js';
/** keepDigest's env (wave 9 R9-F8): the real `ccd/ccrc` is sourced here, so nothing real may resolve. Its poisons live
 *  in `<home>/.keep-digest-poison-bin` — INSIDE the fixture HOME, so `assertNoRealTool` (which passes only a realpath
 *  under home) passes and the dir goes when the mkTmp home goes; OUTSIDE `~/.local/bin`, so `adoptPlantedSystemd` and
 *  the exact listings of that dir never read it. Create-if-absent, on every call. PATH keeps the parent's PATH after
 *  it, so `bash`, `sha256sum`/`shasum` and `find` resolve as they do today (a narrowed PATH would hand macOS's
 *  /bin/bash 3.2 — M1's lesson). */
export function keepDigestEnv(home: string): NodeJS.ProcessEnv {
  const bin = join(home, '.keep-digest-poison-bin');
  mkdirSync(bin, { recursive: true });
  for (const n of CONTAINED_TOOLS) plantPoison(bin, n);
  return {
    HOME: home, PATH: `${bin}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
    XDG_RUNTIME_DIR: join(home, 'no-runtime-dir'), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(home, 'no-bus')}`,
  };
}
// keepDigest: `{ env: keepDigestEnv(home), encoding: 'utf8' }`. No process-exit cleanup: the agent suite measured
// `process.on('exit')` as insufficient under vitest's forks pool (agent/test/contain-path.setup.ts).
```
```ts
// ccrc-install.test.ts, the darwin block:
const pathMissing = (home: string, tool: string): string => {
  const full = pathWithout(home, tool);
  // Wave 9 (D-3821): with ~/.local/bin dropped, PATH is only no-<tool>-bin, which symlinks the
  // REAL tmux and, on darwin, the real launchctl (pathWithout's list). A poison bin of its own, FIRST: every contained
  // name but the tool this case removes and the two managers (the case reaches no manager — `noManager`). The probes
  // ask `command -v` only (ccd/ccrc:12126-12142).
  const poison = join(home, `no-${tool}-poison-bin`);
  mkdirSync(poison, { recursive: true });
  for (const n of CONTAINED_TOOLS) if (n !== tool && n !== 'systemctl' && n !== 'systemd-run') plantPoison(poison, n);
  return [poison, ...full.split(':').slice(1)].join(':');
};
```

- [ ] **Step 1: Re-measure.**
  - **Every `ghContainedEnv(` call in the five files, by grep, not a hand list:** `grep -n 'ghContainedEnv(' server/test/ccrc-update.test.ts server/test/ccrc-install.test.ts server/test/ccrc-cli.test.ts server/test/ccrc-install-graphify.test.ts server/test/installTreeFixture.ts`. Expected at `6ca3d163`: `ccrc-update:332`, `:11058`; `ccrc-install:350`, `:2457`; `ccrc-cli:74`; `ccrc-install-graphify:129` — each `const env = ghContainedEnv(home, { ...process.env, HOME: home });`.
  - **Every raw spread:** `grep -n '\.\.\.process\.env, HOME: home' <the same five files>`. Expected: the six above, plus `ccrc-update:4299`, `:6785`, `:6818`, `:6854`; `ccrc-cli:632`, `:660`; `ccrc-install:4169`, `:6131`, `:6554`, `:7345`. Of the last four, `:4169`, `:6554` and `:7345` run `ccd/ccgpt-runtime` (the GPT lane's binary) — the census's allowlist — and `:6131` runs extracted `ccd/ccrc` functions (`_inst_caps`).
  - `keepDigest`'s `{ env: { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin' }, encoding: 'utf8' }` (`installTreeFixture.ts:262`).
  - **The adopters:** `adoptPlantedSystemd(home)` at `ccrc-update.test.ts:385` and `ccrc-install.test.ts:491`; `SPINE_DELEGATES` (`codexLaneFixture.ts:1259-1261`, systemctl and systemd-run only).
  - **The real-curl cases** in `ccrc-update.test.ts`: the describe at `:1335-1345` (its cases from `:1386`), `:6700` (M4, `http://127.0.0.1:9`), `:6741` (`net.createServer` on port 0). For each, record which curl resolves at main under its env (`command -v curl`), and its URL.
  - **The exact-listing readers** of `~/.local/bin`: `ccrc-install.test.ts:2030-2033`, `:4765-4767`, `:4824-4826` (all subtract `FIXTURE_BINS`); `ccrc-install-graphify.test.ts:1865`, `:1882`, `:1911` (prefix filters, unaffected).
  - **What each builder leaves real today.** For each builder and raw spawn, under its env at main, `command -v` every `CONTAINED_TOOLS` name, plus `echo "$XDG_RUNTIME_DIR $DBUS_SESSION_BUS_ADDRESS"`. Do it in a scratch case, never committed. Record the table in the wave-done.
  - **What reads the bus.** `grep -n 'XDG_RUNTIME_DIR\|DBUS_SESSION' ccd/ccrc ccd/ccrc-doctor-checks`. Expected: defaults only — seven pairs in `ccd/ccrc` (`:3034-3035`, `:5477-5478`, `:10411-10412`, `:14483-14484`, `:19665-19666`, `:20212-20213`, `:21708-21709`) and one in `ccd/ccrc-doctor-checks:873-874` — so setting both to absent paths changes no branch that reads them.
  - Whether any case in the five files runs a functional `ssh`. `ccrc-rollout.test.ts` plants its own, and is not one of these five.
- [ ] **Step 2: Write the failing tests.**
  1. **`ccrc-containment.test.ts` (3a), the checker's self-tests.** Write `assertNoRealTool` FIRST as a stub that returns, and confirm (a)–(d) red against it. Each case builds its env by hand:
     - **(a)** A decoy dir OUTSIDE home holding an executable `ssh`, first on PATH, with XDG and DBUS set under home: throws `/ssh resolved to .*decoy/`.
     - **(b)** `<home>/bin/gh` is a SYMLINK to a decoy outside home: throws `/gh/`, by realpath.
     - **(c)** `XDG_RUNTIME_DIR` unset: throws `/XDG_RUNTIME_DIR/`.
     - **(d)** `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1/bus`: throws `/DBUS_SESSION_BUS_ADDRESS/`.
     - **(e)** A clean env (PATH = `<home>/bin` holding nothing, XDG and DBUS under home): no throw.
     - **(f)** Create-if-absent: in `harnessBin(home)` plant a functional `ssh` and a functional `systemctl`, each carrying a unique marker line, BEFORE `ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' })`. The env passes `assertNoRealTool`; `scp` and `curl` resolve to `<home>/.local/bin/<name>`; and both planted files' CONTENT still holds its marker.
     - **(g)** A spine builder's start: `ccrcContainedEnv(home, process.env, { managers: false, curl: 'poison' })` leaves `<home>/.local/bin` with no `systemctl`, `systemd-run`, `.codex-systemctl` or `.codex-systemd-run`. And after `installVersionedTree(home, …)` (which runs `keepDigest`), `<home>/.local/bin` holds none of those either (it may not exist at all).
     - **(h)** The loopback front, in a fixture HOME with `curl-allow-ports` = one closed port `P`: `curl -sS http://127.0.0.1:P/` reaches the REAL curl (exit 7, connection refused — never 97) and appends to `curl-front-passed`; `curl http://127.0.0.1:7788/health`, `curl https://example.invalid/` and `curl -K x http://127.0.0.1:P/` each exit 97 and append to `curl-poison`.
  2. **(3b) Per-builder pins,** one case in each builder's own file (for `chainEnv` and `sourcedEnv`, inside their describes), titled `<builder> hands out no env under which a real ssh, scp, systemctl, systemd-run, launchctl, tmux, gh or curl can run, and no real user bus (wave 9 R10d)`. Each asserts `expect(() => assertNoRealTool(<builder>(home), home)).not.toThrow()`. All red at main once the checker exists (XDG inherited or unset, `ssh` resolving to the host's): record each thrown message.
     - For `keepDigest`, the case lives in `ccrc-containment.test.ts` (`installTreeFixture.ts` registers no tests). Its red-first is measured against MAIN's literal env shape, which exists at main: `expect(() => assertNoRealTool({ HOME: home, PATH: process.env['PATH'] }, home)).toThrow()` records what main hands out (an assertion red, never a missing-export crash). The 3b case itself asserts `keepDigestEnv(home)` passes, once it exists, and that `<home>/.local/bin` was not created by it.
  3. **(3c) The census,** in `ccrc-containment.test.ts`:
     - every `ghContainedEnv(` call in the five files, found by scanning, passes no `{ ...process.env` (the scan lists each call; a literal-absence pin with no hand list);
     - the text `...process.env, HOME: home` appears in the five files only at the allowlisted `ccd/ccgpt-runtime` spawns: exactly 3 in `ccrc-install.test.ts` and 0 elsewhere, the failure message naming each offender's line;
     - `installTreeFixture.ts`'s `keepDigest` body names `keepDigestEnv(`, and the file imports nothing from `vitest` or `./ccrcContainment`;
     - each of `runInstall` and `runUpdate`'s bodies calls `assertNoRealTool(env, home)` after `assertSpineFrontContained(env, home`. Slice by function, as `ccrc-uninstall.test.ts:1447-1512` does for `assertSpineFrontContained`.

  Run:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-containment.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "hands out no env"
  cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts test/ccrc-cli.test.ts test/ccrc-install-graphify.test.ts -t "hands out no env"
  ```
  Expected: 3a's (a)–(d) red against the stub, then green once the checker is written; (f)–(h) red until `ccrcContainedEnv` and the front exist (record them as such, not as pins). 3b and 3c red at main. Record each red's thrown message.
- [ ] **Step 3: Implement,** as in Interfaces and code: the two modules, the six builders, the raw spawns, `FIXTURE_BINS`, the real-curl allow-port lines, `keepDigestEnv`, the runner calls, `pathMissing`.
- [ ] **Step 4: Run,** one command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-containment.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-cli.test.ts test/ccrc-install-graphify.test.ts test/ccrc-uninstall.test.ts test/ccrc-versioned-audit.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccd-harness-containment.test.ts test/ccd-workspaces.test.ts test/ccd-tmux-anchor.test.ts test/topology-clean.test.ts test/typecheck-tests.test.ts
  ```
  Expected: PASS, the `--detach` cases included (their `systemd-run` is still the update front, never a poison). Any case that newly reds is listed with what it reached (Risk notes): stub the shape it asks, or stop and report. After the run, check `ls <a fixture home>/*-poison` on one case of each file to confirm that no poison recorded a call, and that each real-curl case's `curl-front-passed` is non-empty.
- [ ] **Step 5: Mutation measurement,** per the table.
- [ ] **Step 6: Commit.** `git add server/test/containedTools.ts server/test/ccrcContainment.ts server/test/ccrc-containment.test.ts` and the edited files, run `topology-clean`, then `git commit -m "test(update): every ccrc test env is contained — no real ssh, manager, tmux, gh or curl, and no real user bus; spine builders keep their own fronts, real-curl cases pass a loopback front, keepDigest writes nothing into ~/.local/bin (wave 9 R10d, R9-F8)"`. The body carries Step 1's at-main table and names every repaired case.

**Mutation table (Task 3):**

| # | Guard | Mutation | Must red | Run | Measured |
|---|---|---|---|---|---|
| T3-M1 | the checker resolves through realpath | `assertNoRealTool` compares the resolved path, not its realpath | 3a(b) | `ccrc-containment` | pending |
| T3-M2 | the bus must be SET | the XDG check accepts unset | 3a(c) | same | pending |
| T3-M3 | ssh is poisoned | drop `'ssh'` from `ccrcContainedEnv`'s plant loop | every 3b on a box with an `ssh` (CI's Ubuntu has one; record the box's `command -v ssh`) | one 3b per file | pending |
| T3-M4 | the bus is pointed under HOME | drop the `XDG_RUNTIME_DIR` override | every 3b | one 3b per file | pending |
| T3-M5 | `DBUS` too | drop the `DBUS_SESSION_BUS_ADDRESS` override | every 3b | same | pending |
| T3-M6 | poisons never displace a stub | `plantPoison` overwrites | 3a(f)'s marker-content assertion on `ssh` (and on `systemctl`, through `ghContainedEnv`'s own create-if-absent — record whether that half stays green, since it is not this module's code) | `ccrc-containment` | pending |
| T3-M7 | `updateEnv` is contained | `:332` back to `ghContainedEnv(home, { ...process.env, HOME: home })` | `updateEnv`'s 3b; 3c's `ghContainedEnv(` scan | `ccrc-update -t "hands out"`, `ccrc-containment` | pending |
| T3-M8 | `keepDigest` is contained | `keepDigest` back to the bare-PATH env | 3c's `keepDigestEnv(` assertion; `keepDigest`'s 3b stays green, because it tests `keepDigestEnv`: its control | `ccrc-containment` | pending |
| T3-M9 | the runners check their final env | drop `runInstall`'s `assertNoRealTool` call | 3c | `ccrc-containment` | pending |
| T3-M10 | the darwin probe bin | `pathMissing` without the poison dir | none on Linux (`describeDarwin`); macOS cases 9–11 red on `assertNoRealTool`, naming `launchctl` (the tmux and flock cases, whose `no-<tool>-bin` symlinks the real launchctl) or `tmux` (the launchctl case) | macOS leg | macOS |
| T3-M11 | a spine builder gets no manager poisons | `updateEnv`'s call with `managers: true` | 3a(g)'s twin for `updateEnv` (record), and the `--detach` cases (their `systemd-run` forwards to the adopted poison, 97) — record which and how many | `ccrc-update` | pending |
| T3-M12 | the real-curl cases keep the real curl | `updateEnv`'s `curl: 'poison'` | the SUMS trickle pins (`:1386` family) on their bound assertions, and every real-curl case's `curl-front-passed` assertion | `ccrc-update`, with the `-t` pattern in the note below | pending |
| T3-M13 | the front passes listed ports only | `loopbackCurlFront` passes every `127.0.0.1` port | 3a(h)'s `:7788` assertion | `ccrc-containment` | pending |
| T3-M14 | the raw spawns are contained | `:6785`'s env back to `{ ...process.env, HOME: home, … }` | 3c's raw-spread count (1 in `ccrc-update.test.ts`) | `ccrc-containment` | pending |

T3-M12's run is `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "trickle|never answers|M4: a real curl"`. The `|` is unescaped: vitest compiles `-t` into a JavaScript RegExp, where `\|` is a literal pipe and would match no case. The row records how many cases ran, which must be more than zero (the titles at `:1386`, `:6700`, `:6741` at `6ca3d163`).

### Task 4: doctor's auth reader models the unit's feeder, and says "not measured" where it cannot — R10a, R10e

**Files:**
- **Modify `ccd/ccrc`:**
  - `_box_env_value` (`:2738`) and its header (`:2700-2737`), D-3822: modes `unit` (Linux) and `shell` (Darwin). Its two-argument path is byte-identical, CR handling included.
  - `_box_env_shell_plain` (new, directly below `_box_env_value`), with its two file-scope out-params `BEP_LINE` and `BEP_CAUSE`.
  - `BUE_WHY=""` and `BUE_FIX=""` with the other out-params (`:2768-2772`).
  - `_box_unit_env` (`:2782-2805`) and its header (`:2774-2781`), which names both feeders: systemd's `EnvironmentFile=` on Linux, the launchd job's `set -a; . file` on Darwin (`:14088-14112`). Its Darwin arm is a new `_box_unit_env_shell`, directly below it.
  - Install's gate line: the present-passphrase arm's `if [ "$urc" -ne 0 ]` (`:12268`) splits rc 2 (its line byte-identical) from rc 3. The absent-passphrase arm (`:12278-12283`) gains an rc-3 arm before its else; R10b's rc-2 and exposure-source arms are Task 6's. The comment above both (`:12246-12261`) names rc 3. Both rc-3 lines read `install: gate: …, and $BUE_WHY, so whether CCRC_AUTH is on was not measured — ccrc doctor's auth check says what to do` (the present arm's lead is `a PWA passphrase file is at $gsec`; the absent arm's is `this box has NO PWA passphrase`).
- **Modify `ccd/ccrc-doctor-checks`:**
  - `_check_auth`: `_box_unit_env CCRC_AUTH || unmeasured=1` (`:1311`) → `_box_unit_env CCRC_AUTH || unmeasured=$?`, and `authwhy="$BUE_WHY"; authfix="$BUE_FIX"` on the next line. Every `[ "$unmeasured" -eq 1 ]` → `-ne 0`. Two locals are set from the rc:
    - `unwhy`: 2 → `$CCRC_EXPOSURE_FILE is there and cannot be read`, byte-identical to today's clause; 3 → `$authwhy`; any other non-zero → `its env-file reader answered rc $unmeasured`;
    - `unfix`: 2 → today's remedy, byte-identical; 3 → `$authfix — then re-run ccrc doctor`; any other non-zero → `re-run ccrc doctor; if this repeats it is a bug in ccrc — see _box_unit_env in $CCRC_HERE/ccrc`.

    The passphrase helper's rc 0 (usable passphrase) and rc 3 (no passphrase file) WARN arms use `$unwhy` and `$unfix`; every rc-2 line stays byte-identical. The helper's rc-4 arm keeps its literal `when="if CCRC_AUTH is on (whether it is was not measured: $CCRC_EXPOSURE_FILE cannot be read), …"` when `unmeasured` is 2, and uses `(whether it is was not measured: $unwhy)` for EVERY other non-zero value, so an rc the reader was never meant to answer (127, a not-loaded reader) still prints its own cause rather than an empty one.
  - `_check_update-exposure`: `_box_unit_env CCRC_AUTH || :` (`:1835`) becomes `authrc=0; _box_unit_env CCRC_AUTH || authrc=$?`, with `authwhy="$BUE_WHY"; authfix="$BUE_FIX"` captured on the next line; `_box_unit_env CCRC_HOST || :` (`:1844`) likewise into `hostrc`/`hostwhy`/`hostfix` (each read resets both out-params, so they are captured before the next one). The verdict arms are, in order:
    1. the `expunread` WARN (unchanged);
    2. `authrc` 3 AND (`reach` non-empty OR `hostrc` 3) → WARN `"$authwhy, so whether CCRC_AUTH is on — and so whether the update routes are gated — was not measured"`, remedy `"$authfix — then re-run ccrc doctor"`;
    3. the `auth = on` PASS (unchanged);
    4. `hostrc` 3 and `reach` empty → WARN `"$hostwhy, so whether this box is reachable — and so whether its ungated update routes answer anyone — was not measured"`, remedy `"$hostfix — then re-run ccrc doctor"`;
    5. the reachable FAIL and the loopback PASS (unchanged).

    Arm 2's reach term is the round-2 attack's: a box PROVABLY loopback-only (CCRC_HOST measured loopback, and no exposure file, Caddyfile or ddns unit) gets main's loopback PASS whatever CCRC_AUTH is, because neither non-FAIL exit of main's tail (`ccd/ccrc-doctor-checks:1871-1885`) depends on it — armed is a PASS and unarmed-and-unreachable is a PASS. With `authrc` 3 its `auth` is empty, so it falls through arms 3 and 4 to that PASS.
- **Modify `README.md`, doctor's auth paragraph** (located by content: grep the paragraph that names `_check_auth`'s "as `ccrc.service` gets it"). One clause: surrounding whitespace on an unquoted value is read as the unit's feeder reads it (systemd on Linux; on macOS the launchd job's shell, where a file that is not plain assignments throughout is not measured), and a shape the reader cannot decide is reported as not measured. Line-neutral.
- **Test `server/test/ccrc-doctor.test.ts`:**
  - the auth describe (`:2825-`): `:2941`'s list loses `'on '` and `'"on"x'` (D-3824), and new cases are added;
  - the `update-exposure` describe gains four cases (three, plus the loopback control) and their Darwin twins, and its existing cases run UNEDITED.
- **Test `server/test/ccrc-install.test.ts`:** two gate-line cases beside wave 8's G2 family.

**Interfaces and code:**
```bash
# _box_env_value — the loop, with two new modes (third arg `unit` or `shell`). The two-argument path is byte-identical
# in effect: no per-line CR strip, no export handling, one trailing CR stripped at the end, exactly main's.
_box_env_value() {   # <file> <key> [unit|shell]
  local file="$1" key="$2" mode="${3:-}" line raw v="" found=0 und=0 prevcont=0 qtaint=0 rest
  local ws=$' \t\r'
  while IFS= read -r raw || [ -n "$raw" ]; do
    line="$raw"
    [ "$mode" = unit ] && line="${line%$'\r'}"
    line="${line#"${line%%[!$ws]*}"}"
    if [ "$mode" = unit ]; then
      # Wave 9 R10e (D-3823): shapes systemd may read and this reader cannot decide.
      # systemd before v254 continued a comment line that ends in `\`, v254+ does not; this reader does not know which
      # version the box runs, so a key line after ANY line ending in `\` is not measured.
      case "$line" in
        "$key"[$' \t']*=*|"export"[$' \t']*"$key"[$' \t']*=*|"export"[$' \t']*"$key="*) und=1 ;;
        "$key="*) { [ "$prevcont" -eq 1 ] || [ "$qtaint" -eq 1 ]; } && und=1 ;;
      esac
      # A QUOTE THAT MAY SPAN LINES: systemd's '-quoted and "-quoted values can span lines, so a non-comment line
      # whose value carries a quote that is not ONE WHOLE PAIR on that line taints every later key line (never
      # cleared — conservative: it can only cost a "not measured").
      case "$line" in
        ''|'#'*|';'*) ;;
        *\"*|*\'*)
          rest="${line#*=}"; rest="${rest#"${rest%%[!$ws]*}"}"; rest="${rest%"${rest##*[!$ws]}"}"
          case "$line" in *=*) ;; *) qtaint=1 ;; esac
          case "$rest" in
            \"*\") case "${rest:1:${#rest}-2}" in *\"*|*\\*) qtaint=1 ;; esac ;;
            \'*\') case "${rest:1:${#rest}-2}" in *\'*) qtaint=1 ;; esac ;;
            *) qtaint=1 ;;
          esac ;;
      esac
      case "$line" in *\\) prevcont=1 ;; *) prevcont=0 ;; esac
    elif [ "$mode" = shell ]; then
      # Wave 9 R10a, Darwin (round-2 ruling R-A): ONLY ever called on a file `_box_env_shell_plain` passed, so every
      # assignment line is `[export<ws>]NAME=<plain value>`. bash drops the export word and trailing spaces/tabs.
      case "$line" in export[$' \t']*) line="${line#export}"; line="${line#"${line%%[!$' \t']*}"}" ;; esac
      line="${line%"${line##*[!$' \t']}"}"
    fi
    case "$line" in
      "$key="*) v="${line#"$key="}"; found=1 ;;
      *) continue ;;
    esac
  done < "$file"
  v="${v%$'\r'}"
  if [ "$mode" = unit ] && [ "$found" -eq 1 ]; then
    # Wave 9 R10a (D-3822): whitespace (space, tab, CR) around an UNQUOTED value goes, as systemd
    # discards it (the run-182 ruling; systemd.exec(5)).
    v="${v#"${v%%[!$ws]*}"}"; v="${v%"${v##*[!$ws]}"}"
    case "$v" in
      *\\*) und=1 ;;                                   # an escape, quoted or not
      \"*\") case "${v:1:${#v}-2}" in *\"*) und=1 ;; esac ;;
      \'*\') case "${v:1:${#v}-2}" in *\'*) und=1 ;; esac ;;
      *\"*|*\'*) und=1 ;;                              # a quote that is not one whole pair ("on"x, on")
    esac
  fi
  if [ "$und" -eq 1 ]; then return 2; fi
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  printf '%s' "$v"
  [ "$found" -eq 1 ]
}

# _box_env_shell_plain <file> — Darwin only (wave 9 R10a, round-2 ruling R-A). rc 0 when every line is blank, a
# comment, or `[export<ws>]NAME=` + a shell-inert value / one whole '…' pair / one whole "…" pair with no $, backtick,
# \ or " inside, then only spaces/tabs; and no line holds a CR. rc 1 otherwise: BEP_LINE is the first failing line's
# NUMBER and BEP_CAUSE is `cr` or `shape`. It never records the line's bytes — ccrc.env holds tokens. Called
# directly, never in `$(…)`, so the out-params reach the caller.
_box_env_shell_plain() {   # <file>
  local file="$1" raw rest name val inner n=0
  BEP_LINE=0; BEP_CAUSE=""
  while IFS= read -r raw || [ -n "$raw" ]; do
    n=$((n + 1))
    case "$raw" in *$'\r'*) BEP_LINE=$n; BEP_CAUSE=cr; return 1 ;; esac
    rest="${raw#"${raw%%[!$' \t']*}"}"
    case "$rest" in ''|'#'*) continue ;; esac
    rest="$raw"
    case "$rest" in export[$' \t']*) rest="${rest#export}"; rest="${rest#"${rest%%[!$' \t']*}"}" ;; esac
    case "$rest" in *=*) ;; *) BEP_LINE=$n; BEP_CAUSE=shape; return 1 ;; esac
    name="${rest%%=*}"
    case "$name" in ''|[0-9]*|*[!A-Za-z0-9_]*) BEP_LINE=$n; BEP_CAUSE=shape; return 1 ;; esac
    val="${rest#*=}"; val="${val%"${val##*[!$' \t']}"}"
    case "$val" in *[!A-Za-z0-9_./:@%+,=-]*) ;; *) continue ;; esac
    case "$val" in
      \'*\') inner="${val:1:${#val}-2}"; case "$inner" in *\'*) ;; *) continue ;; esac ;;
      \"*\") inner="${val:1:${#val}-2}"; case "$inner" in *[\$\`\\\"]*) ;; *) continue ;; esac ;;
    esac
    BEP_LINE=$n; BEP_CAUSE=shape; return 1
  done < "$file"
  return 0
}
```
```bash
# _box_unit_env — Linux keeps main's two reads, in `unit` mode; Darwin goes to its own arm, before any read.
_box_unit_env() {   # <KEY>
  local key="$1" v rc envund=0 expund=0 f
  BUE_VAL=""; BUE_SRC=""; BUE_NAMED=0; BUE_ENV=absent; BUE_EXP=absent; BUE_WHY=""; BUE_FIX=""
  if [ "${CCD_OS:-linux}" = darwin ]; then _box_unit_env_shell "$key"; return; fi
  # …main's ccrc.env read, with `unit` and `case "$rc" in 0) …main's three assignments… ;; 2) envund=1 ;; esac`;
  # …main's exposure read likewise (expund=1), and its unreadable arm's `return 2`, unchanged. Then:
  if [ "$expund" -eq 1 ] || { [ "$envund" -eq 1 ] && [ "$BUE_SRC" != "$CCRC_EXPOSURE_FILE" ]; }; then
    f="$BOX_ENV_FILE"; [ "$expund" -eq 1 ] && f="$CCRC_EXPOSURE_FILE"
    BUE_VAL=""; BUE_SRC=""
    BUE_WHY="$f names $key in a shape this reader does not decide (a space around '=', an export prefix, a backslash, a quote that is not one whole pair, a quote left open on an earlier line, or a line after one ending in a backslash)"
    BUE_FIX="rewrite the line naming $key in $f, or the line above it when that one ends in a backslash, as KEY=value: no space before or after '=', no export, no backslash, no quote except one whole pair around the value, and no quote left open on an earlier line (ccrc expose rewrites the exposure file)"
    return 3
  fi
  return 0
}
# _box_unit_env_shell — the Darwin arm (round-2 ruling R-A): BOTH readable files must pass `_box_env_shell_plain`
# before either is read; one that fails makes every key rc 3. ccrc.env is checked first, as bash sources it first.
_box_unit_env_shell() {   # <KEY>
  local key="$1" v bad=""
  # ccrc.env: if readable — BUE_ENV=ok; `_box_env_shell_plain` passes → read it with `shell` (main's three
  #   assignments on rc 0), fails → bad="$BOX_ENV_FILE". Unreadable → BUE_ENV=unreadable, as main.
  # exposure file: if there and readable — BUE_EXP=readable; only when `bad` is still empty, the same check and read
  #   (bad="$CCRC_EXPOSURE_FILE" on a fail). There and unreadable → BUE_EXP=unreadable; `return 2`, exactly main's arm.
  [ -z "$bad" ] && return 0
  BUE_VAL=""; BUE_SRC=""; BUE_NAMED=0
  case "$BEP_CAUSE" in
    cr) BUE_WHY="$bad line $BEP_LINE carries a carriage return, which bash keeps in the value — on macOS the launchd job sources both env files with bash"
        BUE_FIX="save $bad without carriage returns (ccrc expose rewrites the exposure file)" ;;
    *)  BUE_WHY="$bad line $BEP_LINE is not a plain NAME=value line, and on macOS the launchd job sources both env files with bash, so that line can change what they set"
        BUE_FIX="rewrite line $BEP_LINE of $bad as NAME=value, with a value of letters, digits and _./:@%+,=- only, or one whole '…' pair, or one whole \"…\" pair with no \$, backtick, backslash or \" inside — or delete it (ccrc expose rewrites the exposure file)" ;;
  esac
  return 3
}
# The header's rc list gains: rc 3 UNMEASURED — on Linux a readable file names the key in a shape this reader does not
# decide (an exposure file that DECIDES the key still wins over an undecidable ccrc.env, by presence); on Darwin
# either readable file is not plain assignments throughout. BUE_WHY is the cause as a clause, naming the file (and, on
# Darwin, the line NUMBER, never its bytes); BUE_FIX is its remedy clause.
```
The blocks above show the INTENT. They were run in a scratch HOME against a copy of `ccd/ccrc` at `6ca3d163` (main's file sourced, these functions sourced over it, both `CCD_OS` values): every attack-round shape below gave the row U3 expects, and on Darwin no `BUE_WHY` carried a planted canary from the failing line. The implementer keeps main's loop structure and variable names where it can, so the two-argument path is visibly unchanged. Its control is case U1. Measure the bash 4.4+ substring forms (`${v:1:${#v}-2}`) on a one-character value (`"`) before relying on them, and guard the length. Every new local is declared with the others.

- [ ] **Step 1: Re-measure.**
  - Every anchor above, by its quoted text: `v="${v%$'\r'}"` (`:2756`); `_box_unit_env CCRC_AUTH || unmeasured=1` (`ccrc-doctor-checks:1311`); `_box_unit_env CCRC_AUTH || :` (`:1835`); `_box_unit_env CCRC_HOST || :` (`:1844`); the rc-4 `when="if CCRC_AUTH is on (whether it is was not measured: $CCRC_EXPOSURE_FILE cannot be read), the server refuses to boot on it"`; `_box_unit_env CCRC_AUTH || urc=$?` (`ccd/ccrc:12267`, `:12278`); the launchd job's line by its PREFIX, `grep -nF "local cmd=\"set -a; [ -f '\$env1' ]" ccd/ccrc` (`:14112`; the rest of the line reads `&amp;&amp;`, because it lands in the plist's XML and launchd unescapes it, so a quote of it with `&&` matches nothing).
  - **The callers that must not change:** `git grep -n '_box_env_value "' -- ccd/ | grep -v ' unit)\| shell)'`. Expected: 43 (21 in `ccd/ccrc`, 22 in `ccd/ccrc-doctor-checks`), none passing a third argument. At `6ca3d163` the same grep without the filter reads 45: the other two are `_box_unit_env`'s own reads (`ccd/ccrc:2788`, `:2797`), which move to `unit` mode (and gain two `shell` twins in `_box_unit_env_shell`).
  - **The rc-2 pins that must stay byte-identical:** D-3596's cases D4–D6 and the G2 family's unreadable-exposure case. Record their titles.
  - **The macOS fixtures stay plain.** Every line the auth describe, the `update-exposure` describe and the G2 family write into `ccrc.env` or the exposure file, outside this task's new cases, must pass `_box_env_shell_plain`: otherwise the Darwin rule turns an existing case's verdict into a WARN on the macOS legs. Measured at `6ca3d163` by reading: `healthy()`'s `ccrc.env` (`ccrc-doctor.test.ts:1088-1098`), `writeExposureEnv` (`:767-797`), `unexposedBox` (`:2843`) and every `armGate`/`writeCcrcEnv`/`appendFileSync` line in those describes write `KEY=value` lines with inert values, comments and blank lines only; the real `_exp_env_write` (`ccd/ccrc:5492-`) writes the same shapes. Re-measure it by running `_box_env_shell_plain` (sourced) over the files one case of each describe leaves, and record any that fails. A path value (`CCRC_AUTH_SECRET_PATH=${elsewhere}`) is inert on both runners only while the temp dir's path is; record each runner's `os.tmpdir()`.
  - **The citation corpus:** `ccd/ccrc:2768` is cited in `ccrc-doctor.test.ts` comments (`:3354`, `:7590`). Inserting lines above it moves that line. Repoint each comment by content in this task's commit, and record each move. Measure whether any guard reads those comment citations. If one does, the move is pinned by it.
  - `wc -l ccd/ccrc`, for the session-hook tax.
- [ ] **Step 2: Write the failing tests.** Each E-case that runs on both platforms asserts the platform-neutral core — `WARN auth`, the file's path, `was not measured`, and NOT `cannot be read` — plus, through one helper `expectUndecided(detail, file)`, the platform's clause: `in a shape this reader does not decide` on Linux, `${file} line ` on macOS. A case whose VERDICT differs by platform is split into an `itLinux` case and an `itDarwin` twin, and each twin is named in Task 7's wave-done with its macOS result.
  0. **The correction.** `:2941`'s value list becomes `['ON', 'true', 'yes']`, and its comment names D-3824 for the two values that left it.
  1. **`ccrc-doctor.test.ts`, the auth describe, `describe('wave 9 R10a/R10e — the flag as the unit\'s feeder hands it, and not measured where that cannot be decided')`:**
     - **A1** (`itLinux`). `unexposedBox`, no passphrase, `armGate(home, v)` for each `v` of `['on ', 'on\t', ' on', '\ton ']`: `FAIL auth: CCRC_AUTH=on in …` with "failing SHUT", exit 1. At main: PASS OFF.
     - **A1d** (`itDarwin`). The same box, `'on '` and `'on\t'`: FAIL ARMED, as A1 (a plain line; bash drops the trailing space). `' on'` and `'\ton '`: one `WARN auth`, not measured, naming `ccrc.env` and its line number (bash runs `on` as a command; nothing is set).
     - **A2.** The control: `armGate(home, '"on "')` gives PASS, gate OFF (a quoted inner space stays). Green at main, on both platforms.
     - **E1.** `healthy()`, a usable passphrase, `ccrc.env` `CCRC_AUTH=on`, and the exposure file's `CCRC_AUTH=on` line replaced by `CCRC_AUTH = off`: one `WARN auth`, rc 3, `expectUndecided` on the exposure file. At main: `PASS … logins are gated`, a false ARMED.
     - **E2.** The same box, the exposure file `FOO=bar \` then `CCRC_AUTH=on`, `ccrc.env` `CCRC_AUTH=off`: WARN, not measured. At main: PASS gated, a false ARMED.
     - **E3** (`itLinux`). `comment: a key line after a comment ending in \ is not measured — systemd before v254 continued it, v254+ does not, and the reader does not know which runs`: a comment line ending in `\` directly above `CCRC_AUTH=on` in the exposure file: WARN, not measured. **E3d** (`itDarwin`): the same files read gated (PASS): bash ends a comment at the newline, backslash or not (measured, bash 5.2).
     - **E4.** `unexposedBox`, no passphrase, `ccrc.env` `CCRC_AUTH = on`: WARN, not measured, naming `ccrc.env`. At main: PASS OFF, a false OFF.
     - **E5** (`itLinux`). The control for precedence by presence: `ccrc.env` `CCRC_AUTH = on` (undecidable) and the exposure file canonical `CCRC_AUTH=off` give a measured OFF from the exposure file: PASS, `$where` names the exposure file. Green at main by accident (main never sees the spaced line). **E5d** (`itDarwin`): WARN, not measured, naming `ccrc.env` line 1 — the whole-file rule, with no precedence over a failing file.
     - **E6** (`itLinux`). `export CCRC_AUTH=on` in `ccrc.env` with no exposure file: WARN, not measured. **E6d** (`itDarwin`): FAIL ARMED, no passphrase (bash's `export NAME=value` is a plain assignment under R-A).
     - **E6b.** The export arm's control: `export CCRC_AUTH_SECRET_PATH=<an absolute path to a missing file>` then `CCRC_AUTH=off` in `ccrc.env`: the auth read is MEASURED (OFF; the secret-path line is that check's own concern), on both platforms. A longer key that begins with `CCRC_AUTH` is not this key, and `export NAME=` of another name with an inert value is plain on Darwin.
     - **E7.** `CCRC_AUTH="o\"n"` in `ccrc.env`: WARN, not measured.
     - **E8.** `CCRC_AUTH="on"x` in `ccrc.env` (the value that left `:2941`'s list): WARN, not measured. At main: PASS OFF.
     - **E9.** An unclosed double quote that may swallow the key: the exposure file `CCRC_ORIGIN="https://x`, then `CCRC_AUTH=on`, then `CCRC_RP_ID=x`; `ccrc.env` `CCRC_AUTH=off`: WARN, not measured, naming the exposure file. At main: a false ARMED (the box reads gated).
     - **E10.** A single-quoted value spanning lines: the exposure file `FOO='a`, then `CCRC_AUTH=on`, then `'`; `ccrc.env` `CCRC_AUTH=off`: WARN, not measured. At main: a false ARMED.
     - **E11.** An unquoted escape: `ccrc.env` `CCRC_AUTH=o\n` (a literal backslash, then `n`; systemd reads `on`): WARN, not measured. At main: PASS OFF, a false OFF.
     - **E12.** A trailing unpaired quote: `ccrc.env` `CCRC_AUTH=on"`: WARN, not measured.
     - **E13** (`itDarwin`). The round-2 attack's readonly shape: `ccrc.env` `CCRC_AUTH=off` then `readonly CCRC_AUTH`, the exposure file `CCRC_AUTH=on`, a usable passphrase: one `WARN auth`, not measured, naming `ccrc.env` line 2 — never the exposure file's PASS (bash keeps `off`). **E13l** (`itLinux`), the control: the same files read gated, PASS (systemd ignores a line with no `=`, and the exposure file wins by presence).
     - **E14.** A CR in the OTHER file: `ccrc.env` `CCRC_AUTH=on`, the exposure file `CCRC_RP_ID=x\r` with no CCRC_AUTH line. Linux (`itLinux`): FAIL ARMED, no passphrase, as main (systemd discards the CR). Darwin (`itDarwin`, **E14d**): WARN, not measured, naming the exposure file line 1.
     - **U1.** The plain-mode control, a sourced table: `. ccd/ccrc; _box_env_value f K` over the line shapes of A1–E14, plus `K=v\r\r` and `K=v\r`, for stdout and rc, equals main's output byte for byte. Capture main's output first, in a scratch tree, and paste it as the expected literal.
     - **U2.** The `unit`-mode table (Linux's): the same shapes with `unit` give A1's `on` rc 0 (all four), A2's `on ` rc 0 (inner space kept), `K=v\r\r` → `v` rc 0, E6b's `CCRC_AUTH=off` → `off` rc 0, and rc 2 with empty stdout for E1–E4, E6, E7 and E8–E12. It does not depend on `CCD_OS`.
     - **U3.** The Darwin table, through `_box_unit_env CCRC_AUTH` with `CCD_OS=darwin` set AFTER sourcing (so it runs on every platform), `BOX_ENV_FILE` and `CCRC_EXPOSURE_FILE` pointed at fixture files. Each row asserts rc, `BUE_VAL`, `BUE_SRC`, and `BUE_WHY`'s file and `line <n>`:
       - rc 3, naming the file and line: `CCRC_AUTH=on\r` (line 1, the carriage-return cause); `CCRC_AUTH=on` / `FOO=1 CCRC_AUTH=off` (line 2); `CCRC_AUTH=on` / `FOO=a unset CCRC_AUTH` (line 2); `CCRC_AUTH=on` / `FOO=1;unset CCRC_AUTH` (line 2); `X=1` / `CCRC_AUTH=on` / `FOO=$(echo) CCRC_AUTH=off` (line 3); `CCRC_AUTH= on` (line 1); `declare CCRC_AUTH=off` (line 1); `; c` / `CCRC_AUTH=on` (line 1); `CCRC_AUTH=on # c` (line 1); `CCRC_AUTH+=x` (line 1); `  CCRC_AUTH=on` (an indented assignment, line 1 — see Open questions);
       - rc 3 across files: `ccrc.env` `CCRC_AUTH=off` / `readonly CCRC_AUTH` with the exposure file `CCRC_AUTH=on` (ccrc.env, line 2); `ccrc.env` `CCRC_AUTH=on` with the exposure file `X=1\r` (the exposure file, line 1);
       - the no-content row: `ccrc.env` `CCRC_AUTH=on` / `FOO=canary-9f2 x`: rc 3, and `BUE_WHY` and `BUE_FIX` do not contain `canary-9f2`;
       - every key: the readonly row's files read through `_box_unit_env CCRC_HOST` also answer rc 3;
       - the controls, rc 0: `CCRC_AUTH=on ` → `on`; `CCRC_AUTH=on\t` → `on`; `export CCRC_AUTH=on` → `on`; `export FOO=1` / `CCRC_AUTH=on` → `on`; `# comment` / `CCRC_AUTH=on` → `on`; `# x \` / `CCRC_AUTH=on` → `on`; `CCRC_AUTH='on'` → `on`; `CCRC_AUTH="o n"` → `o n`; `ccrc.env` `CCRC_AUTH=off` with the exposure file `CCRC_AUTH=on` → `on` from the exposure file; with the exposure file `CCRC_AUTH=` → `` from the exposure file (main's D2 precedence); an exposure file there and unreadable → rc 2 (D-3596's arm, unchanged).
     - **U3l.** The same rows with `CCD_OS=linux` give `unit` mode's answers, captured once from the implementation and asserted literally. At least: the carriage-return, `FOO=1 CCRC_AUTH=off`, `unset`, `;`, readonly and other-file-CR rows read `on` rc 0 (systemd discards a CR, ignores a line with no `=`, and reads `FOO=1 CCRC_AUTH=off` as one assignment to FOO); `CCRC_AUTH= on` and the indented row read `on`; `export CCRC_AUTH=on` answers rc 3. This is the platform split stated as data: the same bytes, two feeders.
  2. **`ccrc-doctor.test.ts`, `update-exposure`:**
     - **X1.** A reachable box (the describe's own reachable fixture) whose exposure file carries `CCRC_AUTH = on`: `WARN update-exposure`, not measured, `expectUndecided` on the exposure file, and the detail is not empty before its comma. At main: FAIL "CCRC_AUTH is not on". (On macOS the whole-file rule gives the same WARN, through the same arm: platform-neutral.)
     - **X2** (`itLinux`). A box whose exposure file decides `CCRC_AUTH=on` canonically and carries `CCRC_HOST = 0.0.0.0`: `PASS update-exposure` (the routes ARE gated; an undecidable bind does not WARN a gated box). **X2d** (`itDarwin`): WARN, not measured, naming the exposure file and the spaced line's number — the measured macOS answer, by the whole-file rule.
     - **X3** (`itLinux`). A box with no exposure file, no Caddyfile, no ddns unit, `CCRC_AUTH` absent and `ccrc.env` `CCRC_HOST = 0.0.0.0`: `WARN update-exposure`, "whether this box is reachable … was not measured", naming `ccrc.env` and CCRC_HOST. At main: the loopback PASS (the spaced line is invisible), a false PASS. **X3d** (`itDarwin`): arm 2's WARN, "whether CCRC_AUTH is on … was not measured", naming `ccrc.env` line 1 (both reads answer rc 3).
     - **X4** (`itLinux`), the loopback control for arm 2's reach term: no exposure file, no Caddyfile, no ddns unit, `ccrc.env` `CCRC_AUTH = on` and `CCRC_HOST=127.0.0.1`: `PASS update-exposure: loopback only — no exposure artifact and CCRC_HOST=127.0.0.1`. Green at main (it reads the spaced line as absent). **X4d** (`itDarwin`): arm 2's WARN, naming `ccrc.env` line 1 (the whole-file rule makes CCRC_HOST rc 3 too).

     The describe's existing cases run unedited.
  3. **`ccrc-install.test.ts`, the gate line:**
     - **I1.** A passphrase present, and the exposure file `CCRC_AUTH = on`: a line starting `install: gate: a PWA passphrase file is at …, and <exposure file>` and containing `so whether CCRC_AUTH is on was not measured`, with `expectUndecided`'s platform clause. It does not contain `cannot be read`.
     - **I2.** No passphrase, and `ccrc.env` `CCRC_AUTH = on`: the rc-3 line naming `ccrc.env`. It is not the fresh-box line.

  Run each file with `-t` on the new describes. Expected on Linux: A1, E1–E4, E6, E7, E8–E12, U2, U3, U3l's `CCRC_AUTH= on` and `export` rows, X1, X3, I1 and I2 FAIL. A2, E5, E6b, E13l, E14, U1, X2 and X4 are green at main (controls). The `itDarwin` twins (A1d, E3d, E5d, E6d, E13, E14d, X2d, X3d, X4d) run on macOS only: record each in the wave-done. Record the counts.
- [ ] **Step 3: Implement,** as above, plus the README clause.
- [ ] **Step 4: Run,** one command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts test/ccrc-cli.test.ts test/ccrc-uninstall.test.ts
  cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/readme-holds.test.ts test/pools-prose.test.ts test/single-definition.test.ts test/topology-clean.test.ts
  wc -l README.md    # 3813
  ```
  Expected: PASS. If `session-hook`'s `byFile` moved, re-measure it by S6-R11 (Global Constraints).
- [ ] **Step 5: Mutation measurement,** per the table.
- [ ] **Step 6: Commit.** `git commit -m "fix(update): doctor reads CCRC_AUTH as the unit's feeder hands it — surrounding whitespace dropped under systemd; on macOS decided only when both env files are plain assignments — and says not measured for a shape it cannot decide (wave 9 R10a, R10e)"`. The body names the corrected `'on '` and `'"on"x'` premises, round-2 ruling R-A, the 43 unchanged callers, and any `byFile` re-measure.

**Mutation table (Task 4):**

| # | Guard | Mutation | Must red | Run | Measured |
|---|---|---|---|---|---|
| T4-M1 | unquoted whitespace is dropped (systemd) | drop `unit` mode's trailing-whitespace trim | A1 (`'on '`, `'\ton '`), U2 | `ccrc-doctor -t "wave 9 R10a"` | pending |
| T4-M1b | trailing space/tab is dropped (bash) | drop `shell` mode's trailing trim | U3's `CCRC_AUTH=on ` and `on\t` rows; macOS A1d | same, macOS leg | pending |
| T4-M2 | quoted whitespace is kept | trim inside the quotes too | A2, U2, U3's `"o n"` row | same | pending |
| T4-M3 | a spaced key is undecidable | drop the `"$key"[$' \t']*=*` arm | E1, E4, U2, X1, I1, I2 | `ccrc-doctor`, `ccrc-install` | pending |
| T4-M4 | a continuation is undecidable | drop the `prevcont` check | E2, E3, U2 | `ccrc-doctor` | pending |
| T4-M5a | an undecidable exposure file is never a value | `_box_unit_env`'s `expund` `return 3` → `return 0` | E1, E2, E3, E9, E10 — each now a false OFF PASS (`BUE_VAL` is empty on that path) | `ccrc-doctor` | pending |
| T4-M5b | an undecidable ccrc.env is never a value | the `envund` `return 3` → `return 0` | E4, E6, E7, E8, E11, E12 — each a false OFF PASS | `ccrc-doctor` | pending |
| T4-M5c | a non-plain Darwin file is never a value | `_box_unit_env_shell`'s `return 3` → `return 0` | every U3 rc-3 row; macOS E5d, E13, E14d | `ccrc-doctor -t "wave 9 R10a"`, macOS leg | pending |
| T4-M6 | a deciding exposure file wins (Linux) | the `envund` arm drops its `"$BUE_SRC" != "$CCRC_EXPOSURE_FILE"` test | E5 | `ccrc-doctor` | pending |
| T4-M7 | plain mode is untouched | apply the `unit` shaping (per-line CR strip included) when `mode` is empty | U1 (its `K=v\r\r` row at least), and the existing role, port and `CCRC_FLEET` cases Step 4 runs (record which) | `ccrc-doctor`, `ccrc-update` | pending |
| T4-M8 | rc 3 is not worded as rc 2 | `_check_auth`'s rc-3 `unwhy` uses the rc-2 clause | E1's `not.toContain('cannot be read')` | `ccrc-doctor` | pending |
| T4-M9 | update-exposure takes rc 3 | drop its `authrc` 3 WARN arm | X1 | `ccrc-doctor -t "update-exposure"` | pending |
| T4-M9b | a provably loopback box needs no flag | arm 2 drops its `reach`/`hostrc` term | X4 (WARN instead of the loopback PASS) | same | pending |
| T4-M10 | a quote left open taints later keys | drop `qtaint` from the `"$key="*` arm | E9, E10, U2 | `ccrc-doctor` | pending |
| T4-M11 | the export arm names this key only | the export arm back to `"export"[$' \t']*"$key"*=*` | E6b (not measured instead of OFF), U2's E6b row | `ccrc-doctor` | pending |
| T4-M12 | an escape is undecidable | drop the `*\\*` value arm | E11 (PASS OFF returns) | `ccrc-doctor` | pending |
| T4-M13 | an unpaired quote is undecidable | drop the value arm that matches a lone quote of either kind | E8, E12 | `ccrc-doctor` | pending |
| T4-M14 | the WHOLE file is checked, not the key's lines | `_box_env_shell_plain` checks only lines that start `[export<ws>]$key=` | U3's `FOO=1 CCRC_AUTH=off`, `unset`, `;`, `$(echo)` and readonly rows | `ccrc-doctor -t "wave 9 R10a"` | pending |
| T4-M15 | a plain line's VALUE is checked, not only its name (the round-2 attack's hole) | `_box_env_shell_plain` passes any line whose text before the first `=` is a valid name | U3's `FOO=1 CCRC_AUTH=off`, `FOO=a unset CCRC_AUTH`, `FOO=1;unset CCRC_AUTH`, `$(echo)` and `CCRC_AUTH= on` rows | same | pending |
| T4-M15b | a CR anywhere is not measured on Darwin | drop `_box_env_shell_plain`'s CR test | U3's two carriage-return rows (rc 0 with `on\r`, or `on` — record which) | same | pending |
| T4-M15c | a failing ccrc.env is not outranked | `_box_unit_env_shell` skips the ccrc.env check when the exposure file names the key | U3's readonly row; macOS E13 | same, macOS leg | pending |
| T4-M15d | the reason never quotes the file | `BUE_WHY` carries the failing line's text | U3's no-content row | same | pending |
| T4-M16 | each read keeps its own why | `_check_update-exposure` reads `$BUE_WHY` at the arm instead of `authwhy` | X1's non-empty-detail assertion (the later CCRC_HOST read reset it) | `ccrc-doctor -t "update-exposure"` | pending |
| T4-M17 | an undecidable bind is not a PASS | drop the `hostrc` 3 WARN arm | X3 | same | pending |
| T4-M18 | rc 4's tense names every cause | the rc-4 arm uses `$authwhy` instead of `$unwhy` | none by behaviour on a reader that answers 0, 2 or 3; measure it under R11-F2's not-loaded shape (Task 6), where the sentence must not read `not measured: )` — record whether it reds, claim no pin otherwise | `ccrc-doctor`, with the `-t` pattern in the note below | pending |

T4-M18's run is `cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t "D8|not loaded"`, with the `|` unescaped: vitest compiles `-t` into a JavaScript RegExp, where `\|` is a literal pipe. The row records how many cases ran, which must be more than zero.

### Task 5: `ccrc backup`'s prune takes the update lock and keeps what an update's prune keeps — R10g

**Files:**
- **Modify `ccd/ccrc`:**
  - **`cmd_backup` (`:20879-20894`):**
    - `[ -n "$UPD_BAK_FLOOR" ] || UPD_BAK_FLOOR="$(date +%Y%m%d-%H%M%S)"` before `_upd_backup backup`, which is `_upd_lock`'s own line at `:17922`;
    - `_bak_prune` stays the last call;
    - its header (`:20871-20878`) names the shared protections, the lock, and that the copy itself is not locked (ruling 3).
  - **`_bak_keepset` (new, directly above `_bak_gc`)** — the selection loop moved out of `_bak_gc` (`:20988-20996`, from `for ((i = n - 1; i >= 0; i--)); do` through its `done`), its body unchanged. The loop reads `_bak_gc`'s locals `floor` and `n` (declared at `:20985`), which `_bak_prune` does not have, so the helper declares its OWN `local floor n i d name`. It first checks `UPD_BAK_FLOOR` against `^[0-9]{8}-[0-9]{6}$` and returns 1 WITHOUT touching its out-params when it fails; then computes `floor=$((10#${UPD_BAK_FLOOR//-/}))` and `n=${#BAK_DIRS[@]}`, resets `BAK_KEEP_SNAP=""` and `BAK_KEEP_TREE=""`, and runs the loop into them. It reads `BAK_DIRS`, `UPD_BACKUP_DIR` and `UPD_BAK_FLOOR`; `BAK_KEEP_SNAP` and `BAK_KEEP_TREE` are two new file-scope out-params beside `BAK_DIRS` (`:1845`). Behaviour is unchanged, including for links (R10i is deferred). `_bak_gc` keeps its own `local floor=…` line for its removal loop, and has already refused an unparsed floor before it calls the helper.
  - **`_bak_gc`:** calls `_bak_keepset`, then reads `$BAK_KEEP_SNAP`/`$BAK_KEEP_TREE` where it read `$snap`/`$tree`.
  - **`_bak_prune` (`:20938-20949`)** keeps its two `_ccrc_die`s and its echo byte-identical. After `_keep_ok`, it checks the floor FIRST: when `UPD_BAK_FLOOR` fails `^[0-9]{8}-[0-9]{6}$`, `echo "backup: prune skipped — this run's start time was not recorded, so nothing can say which backups are its own; nothing was pruned"; return 0`, before any lock or listing (the floor is set by `cmd_backup` itself, so this arm is reached only by a direct call). Then, before the listing, it takes the lock the way `_bak_gc` does: `took` when `UPD_LOCK_FD` is empty, then `_ver_lock_try || lrc=$?`. It then has four arms:
    - 1 → `echo "backup: prune skipped — another ccrc run holds ~/.ccrc/update.lock; nothing was pruned"; return 0`;
    - 2 → `echo "backup: prune skipped — flock is not on PATH, so ~/.ccrc/update.lock cannot be taken; nothing was pruned"; return 0`;
    - any other non-zero → `echo "backup: prune skipped — ~/.ccrc/update.lock could not be measured; nothing was pruned"; return 0`;
    - 0 → continue.

    Then `local floor=$((10#${UPD_BAK_FLOOR//-/}))` (its own, for the removal loop), `_bak_list; _bak_keepset` (which cannot fail here: the floor was checked above). The removal loop skips `$UPD_BACKUP_DIR`, every name `>=` the floor, `$BAK_KEEP_SNAP` and `$BAK_KEEP_TREE`. It releases the lock if it took it.
  - **The `backup` usage text (`:2201-2204`), line-neutral:** "…then prune to the newest $CCRC_BACKUP_KEEP (default 10) timestamped backups — never this run's own or one named after it began, nor the newest earlier tree backup and coord.db snapshot; skipped while another ccrc run holds ~/.ccrc/update.lock — hand-made siblings …". Reflow within the four lines. If it cannot fit, add the fewest lines and pay the session-hook tax.
- **Modify `README.md` `:716-718`, line-neutral:** the `ccrc backup` clause says the same.
- **Test `server/test/ccrc-update.test.ts`:** a describe NESTED inside wave 8's item B describe (`describe('ccrc update and rollback: ~/ccrc-backups is pruned after a completed run, never its own (wave 8 item B)'`, `:11815`), beside P17 (`:12267`), so that its locals `runBackup`, `plantDir`, `backupRoot` and `assertNoExtras` are in scope. That describe deliberately has no `holders` array (`:11816-11821`), so the nested describe declares its own (B3).

- [ ] **Step 1: Re-measure.**
  - Every anchor above, by its quoted text: `  _upd_backup backup` / `  _bak_prune` (`:20892-20893`), `_bak_gc`'s `for ((i = n - 1; i >= 0; i--)); do`, `_ver_lock_try`'s four answers (`:13347-13372`), `[ -n "$UPD_BAK_FLOOR" ] || UPD_BAK_FLOOR=` (`:17922`), `_upd_busy_die` (`:17860`) and `_upd_lock_holder` (`:17823`).
  - **R10g's own measurement, repeated.** In a scratch HOME, source `ccd/ccrc`, plant two timestamped dirs, set `CCRC_BACKUP_KEEP=0` and run `_bak_prune`. Both are removed, the newest included, and a hand-named sibling survives. Record it.
  - **The pins this task must keep byte-identical:** P17 (`ccrc-update.test.ts:12267-12276`), and the two `ccrc backup` describes in `ccrc-uninstall.test.ts` (`:1161-1229`, `:1231-1280`). Run all three at the base.
  - `runBackup`'s env, which must still pass `assertNoRealTool` after Task 3.
- [ ] **Step 2: Write the failing tests,** in `describe('ccrc backup: the prune keeps what _bak_gc keeps, and takes the lock (wave 9 R10g)')`:
  - **B1.** `CCRC_BACKUP_KEEP=0` with two planted dirs (`20250101-000000`, `20250102-000000`): exit 0. This run's own dir (from the `backup: <dir>` line) still exists, and both planted dirs are gone. At main: its own dir is removed (R10g, measured).
  - **B2.** KEEP=0, with `20250101-000000/server-dist/` (a tree backup), `20250102-000000/coord.db` (a regular file, a snapshot) and `20250103-000000` (empty): exit 0. The first two survive (the newest earlier tree and snapshot), and the third is removed. At main all three go.
  - **B3.** The lock held: a child process holds `flock` on `~/.ccrc/update.lock`, by the lock describe's `holdLock` (`:4457-4463`) copied as a pattern: `spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', <lock>], { stdio: 'ignore' })`, then a bounded wait (10 s, the copied `waitUntil`, `:4447`) until a fresh non-blocking probe fails. The nested describe declares `const holders: ChildProcess[] = []` and an `afterEach` that SIGKILLs `holders.splice(0)` — the lock describe's own shape (`:4430-4433`). KEEP=0 gives exit 0, stdout contains `backup: prune skipped — another ccrc run holds ~/.ccrc/update.lock; nothing was pruned`, and every planted dir is intact. At main: pruned.
  - **B4.** The floor, ALONE: KEEP=0 with a planted `20991231-235959` holding no `coord.db` and no tree entry. It survives, and so does this run's own. In this case only the floor protects the planted dir: it is not this run's own path, and with no snapshot or tree it can be neither keep. At main (KEEP=0) both are removed.
  - **B5.** `flock` absent. `ccrc-update.test.ts` has no general `pathWithout` (only `pathWithoutJq`, `pathWithoutFlock` and `pathWithoutCurl`), and `pathWithoutFlock`'s farm (`:1203-1214`) links only nine tools, which `ccrc backup` outruns before its prune (`cmd_backup` probes `node`; `_upd_backup` runs `mkdir`, node's `backup-coord.mjs` and `_upd_backup_set`'s copies). So the nested describe builds its own PATH by `ccrc-uninstall.test.ts:369`'s `pathWithout` idiom: `$HOME/.local/bin`, then ONE link farm of every command on the parent's PATH except `flock` and the `CONTAINED_TOOLS` names. Assert the `backup: <dir>` line BEFORE the skip line (so a backup that died cannot pass as a prune that skipped), then exit 0, the `flock is not on PATH` skip line, and nothing pruned. Before writing it, confirm that `updateEnv` plants no `flock` in `~/.local/bin` (at `6ca3d163` it plants none).
  - **B6.** P17 and the two `ccrc-uninstall` describes run unedited and green: byte-identical echo, exit 1 with `ccrc: CCRC_BACKUP_KEEP='…' is not a whole number from 0 to 9999 — nothing was pruned` on stderr, and `prunes to the newest CCRC_BACKUP_KEEP timestamped dirs`.
  - **B7.** `_bak_gc`'s own pins (the wave 8 item B describe, P1–P18) run unedited and green.
  - **B8.** The floor-parse guard, sourced (`set -uo pipefail; . ccd/ccrc`) in a fixture HOME under `updateEnv`: `UPD_BAK_FLOOR=""`, `CCRC_BACKUP_KEEP=0`, two planted timestamped dirs, then `_bak_prune`. It prints `backup: prune skipped — this run's start time was not recorded, so nothing can say which backups are its own; nothing was pruned`, exits 0, and both dirs survive. At main: both removed (record it).

  Expected: B1–B5 and B8 FAIL at main, and B6 and B7 green. Record the counts.
- [ ] **Step 3: Implement,** as above, plus the usage and README prose.
- [ ] **Step 4: Run,** one command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts test/ccrc-cli.test.ts
  cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/readme-holds.test.ts test/pools-prose.test.ts test/single-definition.test.ts
  wc -l README.md
  ```
  Expected: PASS. If `byFile` moved, re-measure it by S6-R11.
- [ ] **Step 5: Mutation measurement,** per the table.
- [ ] **Step 6: Commit.** `git commit -m "fix(update): ccrc backup's prune takes the update lock and keeps what an update's prune keeps — never the backup it just made (wave 9 R10g)"`. The body states:
  - why the shared helper and not `_bak_gc` itself (D-3825);
  - the exit-0 skips;
  - that the backup's copy itself is not locked, by ruling, and the lock-holder wording other callers then show (Risk notes).

**Mutation table (Task 5):**

| # | Guard | Mutation | Must red | Run | Measured |
|---|---|---|---|---|---|
| T5-M1 | the floor protects | drop the floor skip in `_bak_prune` | B4 (the future-dated dir is removed at KEEP=0; only the floor protected it) | `ccrc-update -t "wave 9 R10g"` | pending |
| T5-M2 | its own dir by exact path | drop the `$UPD_BACKUP_DIR` skip | none expected: the floor also covers its own dir (named after the floor was set). Defence in depth, no pin claimed, record green | same | pending |
| T5-M3 | the newest earlier tree | drop the `$BAK_KEEP_TREE` skip | B2 | same | pending |
| T5-M4 | the newest earlier snapshot | drop the `$BAK_KEEP_SNAP` skip | B2 | same | pending |
| T5-M5 | the lock is taken | delete the `_ver_lock_try` call and its case | B3 | same | pending |
| T5-M6 | no flock prunes nothing | the rc-2 arm falls through to prune | B5 | same | pending |
| T5-M7 | one selection | `_bak_gc` re-inlines its loop and ignores `_bak_keepset` | none by behaviour; a source pin in the same describe, "`_bak_gc` and `_bak_prune` each call `_bak_keepset`, and `[ -f "$d/coord.db" ]` appears once in ccd/ccrc", reds | same | pending |
| T5-M8 | an unparsed floor prunes nothing | drop `_bak_prune`'s floor check | B8: record the assertion that fired. If the mutant only dies on `$((10#))` before any assertion, that is a crash, not a pin: say so and claim none | same | pending |

### Task 6: The prose batch — R7, R11 F1–F5, R8i, R4-2, R9-F1, R10b, R9-F6

Each item is one change. Each says what the code does, and each is checked against that code in this task.

**Files and changes:**
- **R7a, `README.md:653-654`:** "it settles on the node's own report naming the tag, not a sweep measuring the target," becomes "it settles on the node's own report naming the tag, confirmed by a sweep that measures the target,". Before editing, re-read `leaseActionFor`'s done-settle (`server/src/update/inventory.ts`, "report AND a sweep's stamp at the target", wave 7's measurement) and `git grep -n "not a sweep" -- server/test` for a README-quoting pin. Line-neutral.
- **R7b:**
  - **`docs/superpowers/plans/2026-09-29-centralised-update-residue-before-stable.md:40`:** the code span `` `a FAILED revert (its own gate fails, \`_upd_rollback_no_restore\`)…` `` becomes a double-backtick span, `` `` a FAILED revert (its own gate fails, `_upd_rollback_no_restore`)… `` ``.
  - **`:719`:** the gitignored `.superpowers/sdd/…/fix1-rulings.md` path is dropped. The sentence names "the coordinator's rulings on review run 178", whose summary is in the programme ledger's wave 7 row (the ledger is on the coordinator's branch, not `main`, so no path is cited).
  - **`:381`/`:398`:** re-measure the review's claim against the base review 180 used (the ledger's wave 7 row names it). Edit only if measured off, and record the measurement either way.
  - **`server/test/update-local-spawn-throw.test.ts:75-80`:** the PLATFORM-ONLY note keeps only what was measured: on macOS the promise resolved `{ code: 1, stderr: 'could not start the launcher (ENOENT)' }` (run 36552172708). The `/usr/bin/true` hypothesis is dropped. The case stays `itLinux`.
- **R11-F1, `ccrc-update.test.ts:2785`:** "two DEGRADED lines replace" becomes "a warning and a DEGRADED line replace". Re-read the case's own assertions first.
- **R11-F2, `ccrc-doctor.test.ts:3349-3367`:** with `_check_auth`'s not-loaded guard term `|| ! declare -F _box_unit_env` dropped, run the case and record exactly which line `_check_auth` prints and why. Task 4 made the read `|| unmeasured=$?`, so the candidates are the node-check FAIL or the not-measured WARN. Then rewrite the comment and title to name that measured mechanism. The assertions stay.
- **R11-F3, `ccrc-update.test.ts:12286`:** "put all three squarely in the removal set" becomes "put both links squarely in the removal set; the plain file is never listed (`_bak_list` admits directories only)".
- **R11-F4, the wave 8 plan's D-3596 entry (`docs/superpowers/plans/2026-09-30-centralised-update-w8-live-audit-residue.md:269`):** "a directory, which `[ -f ]` skips silently the same way" becomes "a directory, which `[ -f ]` skips silently (an unreadable regular file is not silent: bash prints `Permission denied`)", marked "(wave 9, R11-F4)". The number is unchanged.
- **R11-F5, `_upd_sweep`'s header (`ccd/ccrc:20083-20084`):** "(stderr names the resolved value and the drop-in that fixes it)" becomes the per-refusal truth, reflowed within the header's lines:
  - the KillMode refusal names the resolved value and the drop-in;
  - the listing refusal names the failed command and its rc;
  - the Darwin refusal names the plist and the re-enable step.

  Re-read each refusal's echo first.
- **R8i, the four skip lines (`ccd/ccrc:13943`, `:13949`, `:13957`, `:13975`):** each line's tail `— ccrc version will say unstamped` becomes `— $(_inst_stamp_left)`, where `_inst_stamp_left` (new, directly above `_inst_stamp`) prints:
  - `the box's existing stamp (~/.ccrc/build.json) stays — ccrc version reports what it says` when `[ -e "$BOX_STAMP_FILE" ] || [ -L "$BOX_STAMP_FILE" ]` (a dangling or unreadable stamp included: the line promises nothing about what `ccrc version` can read);
  - `ccrc version will say unstamped` otherwise.

  `_inst_stamp`'s header sentence (`:13904-13907`, "Same reason the / skipped case below writes NOTHING rather than carrying a previous stamp / forward: a stamp that outlives the tree it described is a lie with a / timestamp on it.") is reworded in place, four lines for four (D-3828): the skipped case writes nothing — it neither rewrites nor removes an existing stamp (only `_inst_stamp_unname` removes one, for a placed or copied tree) — and its line says whether one stays. Line-neutral, so no session-hook tax.

  `:13843`'s "removed the box's stamp … — ccrc version will say unstamped" is true as written and unchanged. The pins at `ccrc-install.test.ts:3834`, `:3865` and `:3879` run on boxes with no stamp: re-measure that, and they stay unedited. Add one case: a box with a stamp at `~/.ccrc/build.json`, the install run FROM the version `~/ccrc` points at (so `_inst_tree` itself answers `running`; `INST_TREE_HOW` is set in-process by `_inst_tree`, never read from the environment), with no `build.json` in that tree, that version not kept, and git off PATH (`pathWithout(home, 'git')`). Its stamp line ends `the box's existing stamp (~/.ccrc/build.json) stays — ccrc version reports what it says`. Re-measure the fixture against `_inst_stamp_shipped` (`:13846-13893`) before writing it.
- **R4-2:**
  - Apply the reorder mutant IN PLACE to `server/src/update/catalogue.ts` (`pollListing` before `pollLatest`): `cp` the file to `$SCRATCH` first, run `update-catalogue.test.ts` in full, record the red count and every red case's title, then restore with `cp` and check with `cmp` (the test imports the real file; a scratch copy would measure nothing).
  - Rewrite the count and list in the test comment (`update-catalogue.test.ts:1442-1474`: "reds three OTHER, pre-existing cases instead" at `:1449` and "C5 … CORRECTS this list: it is FOUR reds, not three" at `:1469`) to what was measured, marked "(re-measured, wave 9, at <sha>)".
  - Correct the matching sentence in W2's plan (`docs/superpowers/plans/2026-09-22-centralised-update-w2-control-plane.md:139`, D-3215's amendment: "R15/C5, fix round 2, review 143, found it instead reds four OTHER, pre-existing cases — …, each named by the test's own comment") in place, the same way.
  - The worker reports the measured count in the wave-done, whatever it is. No ledger text changes in the PR: the coordinator updates the ledger (ruling 7).
- **R9-F1, the killed-flip remedy (`ccd/ccrc:16578-16596`; D-3827):**
  - A new `_kf_remedy <stamp_name> <role>` (directly above `_rollback_refuse_layout`) prints the reason line's tail. It reads only, and decides from a measurement it takes ITSELF, when it prints — never from which condition of `_rollback_killed_flip_state` failed, and never from the measurement `cmd_rollback` took before `_ver_flip_back`:
    - when `role` is non-empty, AND `_ver_kept "$stamp_name" "$role"` answers 0, AND `grep -q '^BOX_VERSIONS_ROOT=' "$BOX_VERSIONS_ROOT/$stamp_name/ccd/ccrc"` succeeds, AND (`role` is not `fleet` or `$BOX_VERSIONS_ROOT/$stamp_name/agent/node_modules` is a directory — `_inst_tree`'s own kept condition, `:13145-13146`): `re-installing $stamp_name is a typed act, not a rollback's: bash ~/ccrc-versions/$stamp_name/ccd/ccrc install --role $role (it installs from that version's own kept directory: no download, no tree copy, no npm ci)`;
    - otherwise (round-2 ruling R-D), including an empty `role`: `no safe one-line repair is known for this state, so this line names no command — nothing on this box was changed`. It names no command and no README recipe.
    - **Role pins (coordinator, after the verify pass):** a `_kf_remedy` table case per role — a fleet-role fixture's printed command carries `--role fleet`, a server-role fixture's `--role server` — and an empty-role row that names no command. Mutation row T6-M1g: drop `--role $role` from the printed command → the fleet and server rows red.
  - `:16596` becomes `[ -z "$why" ] || echo "$PROG: rollback: $(_upd_redact "$why") — $(_kf_remedy "$stamp_name" "${role:-}")" >&2` (re-measure how `role` reaches `_rollback_refuse_layout`; pass it as a fourth argument if it does not). `_rollback_killed_flip_state` is not changed: no `KF_ARM`.
  - `_rollback_refuse_layout`'s header (`:16578-16585`) names `_kf_remedy` and says why it re-measures: the two reachable cases in D-3827.
  - Pins:
    - `expectRefused` (`:11528-11545`) takes the expected tail: the hand install for the condition-5 case (`:11718`, its fixture kept complete with a versioned `ccd/ccrc` — re-measure the role and the spine), the no-command tail for the condition-4 cases (`:11672`, `:11706`) and the condition-6 case (`:11729`); its `:11537` assertion and its `not.toContain('ccrc update --to')` line follow. Every no-command expectation also asserts the tail contains neither `README` nor `bash ~/ccrc-versions`;
    - one new case beside them, `control (conditions 5 and 6 together): a kept pre-W6 target whose kept stamp has another sha — refused with condition 5's reason, and the tail names no command (wave 9 R9-F1)`: `killedFlipBox(…, { oldSpine: KEPT_SPINE })` plus the condition-5 case's other-sha stamp, with the two controls' own `expect(verKeptAnswer(home)).toBe('rc=0 why=')` first. An implementation that trusted the failed condition would print the hand install here;
    - the flip-only pin (`:11805`) expects the hand-install tail (the rename is what fails; the version is kept complete);
    - a new sourced table, `_kf_remedy`, over fixture version dirs: kept complete with a versioned `ccd/ccrc` (role `server`) → hand install; the same under role `fleet` with `agent/node_modules` → hand install, and without it → no command; kept complete with a pre-W6 `ccd/ccrc` → no command; WRITTEN THROUGH since it was kept (a byte appended after the digest, `_ver_kept` rc 3), with a versioned `ccd/ccrc` → no command; not kept (no dir) → no command; incomplete (no install record) → no command. No row prints `ccrc update --to … --downgrade`, `README` or a recipe.
  - Before editing, re-read `_inst_tree`'s `placed`/`running` arms (`:13049-13058`) and the kept arm (`:13144-13149`) to confirm the parenthesis, and confirm that `_ver_kept` writes nothing to stdout (it runs inside `$(…)` here).
- **R10b, install's no-passphrase arm (`ccd/ccrc:12278-12283`), after Task 4's rc-3 arm:**
  - an `elif [ "$urc" -eq 2 ]` arm: `install: gate: this box has NO PWA passphrase, and $CCRC_EXPOSURE_FILE is there and cannot be read, so whether CCRC_AUTH is on (and the gate failing shut) was not measured — ccrc doctor's auth check says what to do`;
  - an `elif [ "$BUE_SRC" = "$CCRC_EXPOSURE_FILE" ]` arm: `install: gate: this box has NO PWA passphrase — install never writes one. To arm the gate: ccrc passwd, then set CCRC_AUTH=on in $CCRC_EXPOSURE_FILE, which overrides $BOX_ENV_FILE (ccrc expose writes it with CCRC_RP_ID and CCRC_ORIGIN), then: $(_svc_restart_hint ccrc.service)`;
  - the else arm, the fresh-box line, byte-identical.

  The comment block (`ccd/ccrc:12246-12261`) and its word-for-word twin above the G2 family's `const gateLine` (`ccrc-install.test.ts:5291-5303`, "every other case — including an exposure file that sets CCRC_AUTH to anything but on, or one that cannot be read — prints main's else-arm line unchanged, naming ccrc.env") both say what the arms now do. Two cases beside the G2 family: an unreadable exposure file (`itLinux`, skipped under uid 0), and an exposure file with `CCRC_AUTH=off`. The existing fresh-box pin stays green unedited.
- **R9-F6, `README.md:709`:** "and `unmeasured` one kept before digests existed or whose tree cannot be measured" becomes "and `unmeasured` one `ccrc` cannot show to be complete — for example kept before digests existed, its tree or digest unmeasurable, its `ccd/ccrc` or its role's build missing, or its kept stamp missing, unparseable or naming another tag". This is the code's `*) cpl=unmeasured ;;` over every other `_ver_kept` answer (`ccd/ccrc:21466-21471`, `:19741-19780`). Line-neutral.

- [ ] **Step 1: Re-measure** every anchor above by its quoted text. For each item, record the code line its new prose is checked against.
- [ ] **Step 2: Write the failing tests:**
  - R9-F1: `expectRefused`'s per-case tail, the conditions-5-and-6 case, the flip-only pin's new text, and the `_kf_remedy` table;
  - R8i's stamp-stays case;
  - R10b's two cases;
  - R7a, if a pin quotes the sentence.

  Expected: FAIL until Step 3. Record the counts.
- [ ] **Step 3: Implement** each item.
- [ ] **Step 4: Run,** one command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts test/update-catalogue.test.ts test/update-local-spawn-throw.test.ts
  cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/readme-holds.test.ts test/pools-prose.test.ts test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts
  wc -l README.md
  git diff --stat -- server/src    # prints nothing: R4-2's mutant was restored
  ```
  Expected: PASS, and README reads 3813. `deviation-refs` is green, because D-3596 and D-3215 were amended in place, not renumbered.
- [ ] **Step 5: Mutation measurement** for the behaviour-bearing items, per the table.
- [ ] **Step 6: Commit,** one per group: `docs(update): …` for README and the plans; `fix(update): …` for R8i, R9-F1 and R10b; `test(update): …` for titles and comments. Each body names its items.

**Mutation table (Task 6):**

| # | Guard | Mutation | Must red | Run | Measured |
|---|---|---|---|---|---|
| T6-M1 | the remedy never advises the in-place write | `_kf_remedy` prints `ccrc update --to $stamp_name --downgrade` | every `expectRefused` reason case, the flip-only pin, the `_kf_remedy` table | `ccrc-update`, pattern A below | pending |
| T6-M1b | the remedy is measured when printed | `_kf_remedy` names the hand install whenever the version dir exists (no `_ver_kept`, no grep, no deps test) | the table's pre-W6, written-through, incomplete and fleet-without-deps rows; the conditions-5-and-6 case; the condition-6 case (`:11729`) and the written-through condition-4 case (`:11706`) | `ccrc-update`, pattern A | pending |
| T6-M1c | a fleet box without agent deps names no command | drop the fleet `agent/node_modules` term | the table's fleet-without-deps row | `ccrc-update -t "_kf_remedy"` | pending |
| T6-M1d | a written-through kept dir names no command | drop the `_ver_kept` term only | the table's written-through row; `:11706` | `ccrc-update`, pattern A | pending |
| T6-M1e | a pre-W6 spine names no command | drop the `^BOX_VERSIONS_ROOT=` term only | the table's pre-W6 row; the conditions-5-and-6 case; `:11729` | `ccrc-update`, pattern A | pending |
| T6-M1f | the no-command tail points at no recipe | the no-command tail gains `see README.md's Restore recipe` | every no-command `expectRefused` case and table row, on `not.toContain('README')` | `ccrc-update`, pattern A | pending |
| T6-M2 | the skip line follows the stamp | `_inst_stamp_left` always prints `ccrc version will say unstamped` | R8i's stamp-stays case | `ccrc-install` | pending |
| T6-M3 | unreadable is not measured | drop R10b's `urc -eq 2` arm | the unreadable case (the fresh-box line appears) | `ccrc-install` | pending |
| T6-M4 | the arming remedy names the file that decides | drop R10b's `BUE_SRC` arm | the `CCRC_AUTH=off`-in-exposure case | `ccrc-install` | pending |

Pattern A is `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "killed-flip|_kf_remedy"`, the `|` unescaped (vitest's `-t` is a JavaScript RegExp, where `\|` is a literal pipe). Each row records how many cases ran, which must be more than zero.

### Task 7: The gate, the PR, and the macOS evidence

- [ ] **Step 1: Start from a merged, clean tree.**
  ```bash
  git status --porcelain
  git fetch origin main
  git merge-base --is-ancestor origin/main HEAD && echo "origin/main is in HEAD" || echo "MAIN MOVED"
  ```
  - On `MAIN MOVED`, run `git merge --no-edit origin/main`. Keep both sides' hunks, never take-theirs on a deletion hunk, and resolve a `ccd/ccd` line-2 conflict by recomputing (Global Constraints).
  - Record the remerge-diff (`git show --remerge-diff HEAD`) in the wave-done.
  - Re-run Tasks 1–6's Step 4 file lists on the merged tree. A red is the merge's: fix it and commit it on its own.
- [ ] **Step 2: Install dependencies:** `cd server && npm ci`, `cd agent && npm ci`, `cd pwa && npm ci`, each where `node_modules` is absent or stale.
- [ ] **Step 3: The server suite.**
  - Read the load (`cat /proc/loadavg`).
  - **When the 1-minute load is under 20:** run the six shards IN SEQUENCE, foreground, one call each, timeout ≥ 600000 ms, with `TMPDIR` on the box's large data volume through the shell variable the brief names:
    ```bash
    cd server && TMPDIR="$SHARD_TMP" ./node_modules/.bin/vitest run --shard=1/6
    # … through --shard=6/6, never mixing denominators
    ```
    The sum of the shards' `Test Files` must equal `find server/test -name '*.test.ts' | wc -l`.
  - **When the load is 20 or more:** run every file this wave touched, plus the guards: `ownership`, `session-hook`, `single-definition`, `topology-clean`, `deviation-refs`, `dtbd`, `typecheck-tests`, `ccd-harness-containment`, `ccd-workspaces`, `readme-holds`, `ccrc-uninstall`, `ccrc-versioned-audit`, `stall-sweep`, `exec`, `keepalive-freshness-parity`, `ccrc-containment`, `ccrc-account`, `macos-platform`, `runbook-holds`, `pools-prose`, `ccrc-rollout`, `ccd-backend-vs-placement` (the File structure's whole "Run, not edited" list is in it). Say in the wave-done that the shards were not run, and give the load.
  - A red in a known load flake (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) is re-run IN ISOLATION before it is called a break.
- [ ] **Step 4: `session-hook` once under the default TMPDIR:** `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts`, with no `TMPDIR` override.
- [ ] **Step 5: The agent and pwa suites, and tsc:**
  ```bash
  cd agent && ./node_modules/.bin/vitest run
  cd pwa && ./node_modules/.bin/vitest run
  cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
  cd agent && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
  cd pwa && ./node_modules/.bin/tsc --noEmit -p .; echo "exit $?"
  ```
- [ ] **Step 6: The ledger guards, last:**
  ```bash
  git fetch origin main
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
  cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts test/topology-clean.test.ts
  git diff --stat origin/main...HEAD -- agent/src deploy pwa server/src '*.service' '*.timer' server/test/codexLaneFixture.ts server/test/ccdWsHelpers.ts   # prints nothing
  wc -l README.md   # 3813
  ```
- [ ] **Step 7: The PR,** from the workspace branch.
  - The body is hand-written. It has one section per task, each naming the items it closes and the departures it carries (by minted number).
  - It says, in its first paragraph, that the merge goes live on both boxes by auto within about 35 minutes, and that Task 2 is live `ccd` code that renames no running session.
  - Links to the plan and to files are GitHub `blob/main` URLs built from the repository's own remote, never a docserver URL. Until merge, the PR's own `/files` view stands beside each one.
  - Every commit's author and committer are the noreply identity (`git log --format='%an <%ae> | %cn <%ce>' origin/main..HEAD`).
  - The body ends with the attribution line the session's instructions give.
- [ ] **Step 8: The wave-done, in the same turn as the push.** It carries:
  - the tip sha, the PR number, and the remerge-diff result;
  - the gate: shards or the reduced list, with the load; each suite's result; tsc; the three guards;
  - **the macOS evidence, case by case.** For each of the twelve cases in the header table:
    - its result on this PR's `test-macos` legs (passed, failed with its message, or skipped for case 4);
    - the leg and job;
    - the full list of OTHER failures those legs show, each classified as the GPT lane's (one of the 45, by file: `ccrc-codex`, `ccrc-account`, `ccgpt-runtime`, `ccd-account-auth`) or new. Any new red is this wave's to explain;
    - the macOS result of each of Task 4's `itDarwin` twins — A1d, E3d, E5d, E6d, E13, E14d, X2d, X3d and X4d — each a new case of this wave on that leg, so a red there is this wave's, never the GPT lane's; and, if cases 7–8 still show a second `rsync-argv` line, that line verbatim (the coordinator rules on it then).

    The done-state is the twelve green (case 4 skipped); it does not wait on the GPT lane's 45 or on `probe-macos`. If the legs have not finished when the wave-done is sent, it says so and names the run. The coordinator reads them. The worker never ends a turn to wait.
  - Task 3's at-main reachability table, and every case Task 3 repaired.
  - Every mutation row with its measured count and the assertion that fired.
  - R4-2's measured count and red titles.
  - The reserve numbers spent, if any, each defined in this plan in the commit that cites it.
  - Every Open question below that the work answered, with the answer.

## Open questions for the coordinator

None open. The last one was ruled after the verify pass:
- **An indented assignment on Darwin stays "not measured"** (ruling R-A as written). It costs only a WARN, never a false answer, and no shipped writer indents a line. U3 keeps pinning the indented row as rc 3.
