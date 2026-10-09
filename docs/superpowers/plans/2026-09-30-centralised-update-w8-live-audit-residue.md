# Centralised update management, wave 8: the live audit's residue (A–G) — Implementation Plan

Wave 8 closes six of the live audit's seven items:
- each move's source goes on record;
- the backups are pruned;
- the PWA offers no one-tap rollback a node is known to refuse;
- doctor reads the armed gate;
- the Settings wording and two box lines are fixed.

The seventh, item E (a catalogue follow-up poll after boot), is DROPPED by the coordinator's ruling: its premise is refuted at main (Risk notes).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the verified live audit's defects (2026-09-30) under the coordinator's design decisions and rulings, before `stable` is promoted.

- **A. Each move's source is on record.** A move the node accepted or held, a move released `failed`, and a move whose release was refused each leave one durable audit row naming its SOURCE, `auto` or `requested`. An idle release (busy, not-queued, version skew, a link that never reached the node) leaves none: the node did not move, and the row's own `updateDetail` already says why. Today the argv says `--from pwa` for every move, and settle overwrites the only place the source was written.
- **B. The backups are pruned.** After a `ccrc update` or `ccrc rollback` that COMPLETED with its gate passed (exit 0 or 3), `~/ccrc-backups` is pruned to the newest `CCRC_BACKUP_KEEP` timestamped backups (default 10).
  - The prune never removes this run's own backup.
  - A failed, restored, `--no-gate` or refused run never prunes.
  - A prune failure only warns.
- **C. No one-tap rollback a node is known to refuse.** The server refuses such a rollback with a 409, before any lease or spawn, and with no halt. The PWA disables those rows and gives the reason.
  - A standing fleet rollback request the server refuses no longer holds the other nodes as `waiting-for-fleet`, whether the hold comes from that request or from that row's auto.
- **D. doctor reads the armed gate.** doctor's `auth` check reads `CCRC_AUTH` the way `ccrc.service` receives it: `ccrc.env` first, then the exposure file, with the later file winning by presence.
  - One shared reader does this, and `update-exposure` moves onto it too.
  - The verdict names the file that won.
- **E. Dropped by ruling.** Nothing is built. The measured fact is in Risk notes.
- **F. Settings wording:**
  - a node that is up to date reads as running the newest eligible release on its channel in the catalogue as last read;
  - the release every managed node runs reads as running, with no move button;
  - the rollback sheet says the node flips or downloads, and that either can be refused or can fail;
  - a finished move shows one line, with its time.
- **G. Two box lines:**
  - the sweep's success line is honest when no supervisor was active before the restart, and a supervisor that was active before the restart and is not active after it is named;
  - install's gate line follows the passphrase file (through the path the box actually uses) and the flag as the unit receives it.

**Architecture:** the server and PWA side (Tasks 1–3), then the box side (Tasks 4–5).

- **Server and PWA (Tasks 1–3).**
  - **L0, `shared/api.ts`:**
    - the twelfth refusal word, `'no-bundle'`;
    - the predicate `rollbackTargetRefusal`. It is the ONE spelling, called by the dispatcher (its move refusal and its two fleet holds) and by the PWA;
    - `settledDoneDetail`, which spells the settle's `done:` words once;
    - the additive NotifyKind `'update'`.
  - **L1, `server/src/update/dispatch.ts` and `resolve.ts`, pure additions only:**
    - `releaseRowFor`, the ONE lookup of a move target's catalogue row, used by `moveRefusal` and by the fleet holds;
    - `moveRefusal`'s rollback arm calls the L0 predicate;
    - `planDispatch`'s `fleetAsk` AND `fleetAuto` both exclude a fleet row whose standing request is a rollback the same predicate refuses, through one local test `knownRefusedAsk`;
    - `moveFeedRecord` builds a move's audit row from `move.source`, and answers `null` for an idle release;
    - `RESOLVE_DETAIL.atNewest` is the sentence for a node that is up to date.
  - **L3, `converge.ts`:** `runDispatch` calls a new port, `ConvergeDeps.recordMove`, which every caller must pass (it may be `null`). It is called at most once, after the answer's lease write and after `onAccepted`, in the same synchronous stretch.
  - **L4, `watch.ts`:** binds that port to `pushOne`'s existing record path (the ring, its flush, and the guarded `recordFeedEvent`), with `recordOnly`. It decides nothing.
  - **The PWA:** calls the L0 predicate for its disabled rows, and adds pure text helpers. `NodeList` and `NodeItem` gain a `catalogueLastOkAt` prop.
  - **Held constant:** no migration, no new store writer (so no `WRITER_GROUPS` change), no schema change, no route added, and `FLEET_PROTO` stays 1.
- **Box side (Tasks 4–5).** `ccd/ccrc`, `ccd/ccrc-doctor-checks` and one sentence of the stage-2 runbook change. There is no `ccd/ccd` edit, so there is no restamp.
  - **B:** `_bak_list`; a rewrite of `_bak_prune` over it, with byte-identical output; and `_bak_gc`, which never dies. `_bak_gc` re-takes the update lock with `_ver_lock_try` after the sweep. It is called from:
    - `cmd_update`, after `_upd_report`, only when the gate passed and the run is not a restore child;
    - `cmd_rollback`'s flip arm, after its sweep and its `doctor_rc` capture.

    `_upd_lock` records the second the run first held the lock, in `UPD_BAK_FLOOR`.
  - **D:** the shared reader `_box_unit_env`, beside `_box_env_value`.
  - **G:** the Linux sweep reads the supervisors that were active BEFORE `try-restart` from its own preflight listing's ACTIVE column (no systemctl call is added), prints a zero-supervisor line when there were none, and names each one not active after; install's gate line is resolved through `_box_auth_path` and `_box_unit_env`.

**Tech Stack:** TypeScript on node `>=22.13.0`; `node:sqlite` `DatabaseSync` through W2's `CoordStore` (the existing `recordFeedEvent` writer only); React and vitest (jsdom) in `pwa/`; bash `set -uo pipefail` in `ccd/ccrc` and `ccd/ccrc-doctor-checks`; vitest in `server/`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md`. Re-measure every section anchor in Task 1 Step 1. The spec itself is not edited; each departure from it is a `DEP-` entry below.

| Spec section | What it fixes | Anchors at `a742eb6a` |
|---|---|---|
| §9 | the resolver's sentences | `:619-623`, `:434-435` |
| §9/§10 | the rollback rule that keeps yanked releases permitted | `:738-739`, `:1042` |
| §10 | the dispatcher, the `--detach --from pwa` argv, "A refusal is an answer", the lock released before the sweep | `:320` (the parent's SHA256SUMS 404 on a draft or delisted row) |
| §11 | update, rollback and the backup set | |
| §12 | the move routes' 409 words | |
| §13 | Settings | `:1117` ("**Install** (or **Roll back** when every live node runs a newer one)"), `:1121` (the state line), `:1144` (unreachable, and `lastOkAt` null, are not current) |

**Producers:** everything here is merged on `main` at `a742eb6a` (v0.0.49, which both live boxes run): waves 1–7 of the programme and the residue round.

- **W2's store:** `recordFeedEvent`, `settleNode`, `releaseLease`, `noteDispatchRefusal`.
- **W3's Settings screen:** `releaseDirection`, `ReleaseItem`, `NodeItem`, `NodeList`, `nodeStateLine`, `dayClock`, `isPlaceableInstant`.
- **W4's box verbs:** `cmd_update`, `cmd_rollback`, `_upd_lock`, `_upd_unlock`, `_upd_backup`, `_upd_sweep`.
- **W5's dispatcher:** `moveRefusal`, `planDispatch` (`fleetAsk`, `fleetAuto`, D-3409), `intendedMove`, `runDispatch`, `classifyOpAnswer`, `leaseHolder` (R5), and the halting semantics of a spawn-failed. Those semantics are unchanged here.
- **W6:**
  - `_keep_ok` and `_keep_why` (D-3423), `_ver_gc`, `_ver_lock_try` (D-3431), `_ver_keep_state`, `_ver_flip_back`;
  - the provenance inventory: `inventory.ts`'s `provenance`, read from `~/.ccrc/installed`. It is a required field on `NodeWire` (`shared/api.ts:8573`) and on `NodeRow` (`store.ts:326`), so v0.0.49 already sends it;
  - `_upd_marker_unsigned`, and `_upd_fetch`'s `--allow-unsigned` refusal.
- **W7:** `movePlan` and `UpdateMoveSheet`.
- **D-refs this plan leans on,** cited as they are: D-3182 (the first tick polls), D-3263, D-3375, D-3377, D-3381, D-3390, D-3405, D-3409, D-3410, D-3461, D-3466, D-3555.

**Out of scope (said once):**

- `commitSha` is always null; fixing that needs `deploy/`.
- The fleet box's `ccrc.env` names the fleet box itself as the server. That is box config.
- The W5 live rehearsal.
- The 9 macOS reds.
- Any edit to `agent/`, `deploy/`, `ccd/ccd`, a systemd unit, `MIGRATIONS`, or the `--from pwa` argv. Per decision A, `shared/agent-protocol.ts`'s `UPDATE_OP_FROM` and `updateSpawnArgv` stay byte-identical.
- **Item E,** dropped by ruling. A shorter `CATALOGUE_POLL_INTERVAL_MS` is the lever the observed 0–35 min latency actually needs; it is the coordinator's to decide, and it is not planned.
- **`ccrc backup` racing an in-flight update.** `cmd_backup`'s `_bak_prune` takes no lock. At a small KEEP it can remove an in-flight update's own backup, which the update's restore arm 3 reads. That race is pre-existing and not a defect of this audit; this wave only makes `_bak_prune` share `_bak_list`. The other writers the floor does not cover are listed in Risk notes. Open question for the coordinator.
- **The sentence for a pinned node that is up to date.** A node on its own pin at its floor still reads `pinned vX is at or below this node's floor vX — …`. It is the same class as F1, but outside decision F's words. Open question for the coordinator.
- **A per-node "flip or download" claim in the rollback sheet.** The kept state is not inventoried, and decision F forbids a new field.
- **`cmd_passwd`'s closing line** (`ccd/ccrc:4894`, "the gate is still OFF until CCRC_AUTH=on is set in $BOX_ENV_FILE") is printed unconditionally, and is false on a box armed through the exposure file. It is the same class as item D, but not item D's check. Open question for the coordinator; it could be worded through `_box_unit_env` in a later round.
- **main's refused-by-node twin of the `fleetAuto` hold.** At main, a fleet row with a standing request it has itself refused (D-3409) still holds every server AUTO move through `fleetAuto`, which tests only that row's `desiredTag`, although the request outranks that auto. This wave excludes only the predicate-refused class from `fleetAuto`. Open question for the coordinator.

## Global Constraints

- **Anchors.**
  - Anchors are measured at `a742eb6a`, quoted, and given as `file:line`.
  - Task 1 Step 1 re-measures every anchor this plan cites, by its quoted text, on the tip being built. Do it after `git fetch origin main`, and after a merge if main moved. The quote wins over the number.
  - Where a quoted line occurs more than once, the plan names the unique neighbour to anchor on instead.
  - Locate code with graphify first (`graphify query` or `explain` over `graphify-out/`), then confirm with `grep -n` of the quoted text.
- **Scope.**
  - Tasks 1–3 edit `server/`, `shared/api.ts`, `pwa/`, `README.md` and `docs/`.
  - Tasks 4–5 edit `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `README.md`, `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md` (one sentence, Task 5) and tests.
  - Nothing under `agent/`, `deploy/`, `*.service` or `*.timer`, and never `ccd/ccd`. The whole-branch check is `git diff --stat origin/main...HEAD -- agent deploy ccd/ccd '*.service' '*.timer'`, which must print nothing.
  - If a step finds it must edit `ccd/ccd`, stop and report. That file is generated (line 2 carries the `# ccrc:generated 1 sha256=` marker) and must be restamped with the shipped marker function, after which `ownership.test.ts` runs.
- **Rings are a property of imports.**
  - **L0 (`shared/api.ts`)** imports nothing. Everything this wave adds there is APPENDED after `PROVENANCE_DETAIL_PREFIX` (the file's last declaration, `:8851`, inside R13's end-of-file block). There are three in-place exceptions: `DISPATCH_REFUSALS`, `MoveSkipWhy`, and the NotifyEvent kind union with `NOTIFY_KINDS` (`:4024`, `:4063`).
  - **L1 (`dispatch.ts`, `resolve.ts`)** gains pure functions only. Its new names ride the EXISTING `shared/api.js` import specifier, so `update-dispatch.test.ts`'s import-block pin (four modules) stays green.
  - **L3 (`runDispatch`)** calls a port. L3 adapters never narrow: the record is built from `move` and the outcome whole.
  - **L4 (`watch.ts`)** owns the feed write, and decides nothing.
- **`coord.db` stays synchronous, and nothing yields between the acquire and the send.**
  - Nothing is added between `store.dispatchNode(…)` (`converge.ts:316`) and the op's await.
  - The record is written AFTER the answer's lease write and AFTER `deps.onAccepted()` (`converge.ts:334`). It runs in the same synchronous stretch as R5's `leaseHolder` read and write.
  - `update-converge.test.ts`'s D-3377 scan stays green unedited.
- **No new store writer, no migration.**
  - `recordFeedEvent` (`store.ts:4445`) already exists, and `feed_events.kind` is TEXT with no CHECK (`schema.ts:219`).
  - Do NOT edit the `-- ask|done|merged|mail|run` comment inside `MIGRATIONS[0]`'s SQL. Migration text is frozen and a cross-branch namespace.
  - Run `update-writer-groups` unedited.
- **Wire discipline.** Every wire change is additive: a NotifyKind value, a 409 word, a `resolveDetail` sentence, a new PWA state. `FLEET_PROTO` stays 1.
  - An older client degrades an `update` feed row to `unknown` (`reviveNotifyEvent`, `isNotifyKind`), and a `no-bundle` 409 to `updateErrorText`'s fallback.
  - `NodeWire.provenance` is already required at v0.0.49 (`shared/api.ts:8573`). So the W8 PWA also disables rows against a v0.0.49 server. That is correct for the download path: a verified node refuses those rollbacks without `--allow-unsigned`.
  - A server older than W6 omits `provenance`. The predicate reads `undefined` as not verified, so the PWA disables nothing there, and a W8 server 409s anyway.
- **Single-definition.**
  - `DISPATCH_REFUSALS`, `single-definition.test.ts`'s `WORDS` literal (`:3913-3915`) and `update-dispatch.test.ts`'s eleven-word array (`:62-67`) move together. After this wave they hold twelve words, with `'no-bundle'` last.
  - The rollback-refusal predicate has ONE L0 spelling. The target's catalogue-row lookup has ONE L1 spelling (`releaseRowFor`), and the known-refused standing request has ONE L1 test (`knownRefusedAsk`), asked by both fleet holds.
  - The no-bundle PWA sentence has ONE spelling (`noBundleRollbackText`, `pwa/src/lib/api.ts`), which `UPDATE_ERROR_TEXT['no-bundle']` also uses.
  - The settle's `done:` words have ONE L0 spelling. Task 3 Step 1 greps `server/src` for a leftover `` `done: ${ `` literal.
  - The backup glob has ONE `ccd/ccrc` spelling, `BAK_TS_PAT`. `deploy/deploy.sh`'s `prune_backups` keeps its own box-side copy, which is named in the comment and not edited.
  - The unit-env precedence has ONE copy, `_box_unit_env` (`_check_exposure`'s own `CCRC_HOST` read is the stated exception, D-3597).
- **Fixture HOMEs only.**
  - Every case that runs the real `ccd/ccrc` runs it under a fixture HOME with, first on PATH, a poisoned recording `systemd-run`, `tmux`, `gh` and `curl`, plus `systemctl` and `launchctl` stubs.
  - The existing harnesses already do this: `updateEnv` (`ccrc-update.test.ts:278`), `ccrcEnv` (`ccrc-install.test.ts`) and doctor's `containedPath` (`ccrc-doctor.test.ts:892`).
  - Step 1 of Tasks 4–5 re-measures that each harness resolves all four to a recorder. Use `command -v` under the case's env; never execute through PATH.
  - A harness missing one gets it planted, with an assertion that its recording file is absent after the case. `ghContainedEnv` stays in place.
  - No case runs `ccd` against the live `$HOME`. No case touches a real `tmux`, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` unit.
  - Any process a case spawns in the background has its stdio redirected (`</dev/null >/dev/null 2>&1`), so `spawnSync` never waits on a pipe it holds open.
  - Every wait loop a stub runs is BOUNDED, and exits non-zero with a message on stderr when its bound is spent, so a stuck condition fails the case loudly instead of hanging the suite.
- **Mutation-table discipline.** Every new guard ships with a case that reds when the guard is removed or mutated, measured red-first.
  - Before each mutation, `cp <file> "$SCRATCH/<name>.orig"` (never `git checkout --`). Run, restore with `cp`, and check with `cmp` that the restore is byte-identical.
  - Every mutation body must compile. Name the literal it inserts, and never reference a binding declared later in the same scope (the TDZ, and bash's `set -u` twin: a variable declared later in the function).
  - A row without a measured red count is not done. Record WHY each red fired (the assertion that failed), so a crash is never counted as a pin.
  - A green mutation needs a control. Where a row is defence in depth that cannot red, the table says so and claims no pin.
- **D-numbers.** This plan writes none. Every departure is a `DEP-<slug>` defined in `## Deviations found`. The coordinator mints the numbers and swaps them in before this plan is cherry-picked to the worker, so each definition is in the tree before any code cites it.
  - Code comments cite the item (`wave 8 item C`) and, where a departure applies, the number minted for its slug.
  - The run's reserve for departures found while executing is named in the wave brief, never here. Take its numbers in order, and define each in `## Deviations found` in the commit that first cites it.
  - Never call the allocator, and never write an unspent number. A `D-TBD-` spelling never lands (`dtbd.test.ts`).
- **README moves no line.**
  - `wc -l README.md` reads the same before and after (3601 at `a742eb6a`), and `git diff --numstat -- README.md` shows equal insertions and deletions. Each README edit reflows only its own paragraph. README is session-hook's citation corpus, cited by line.
  - The same rule holds for `shared/api.ts` above `:7672` (R13). The `:4009-4024` docstring edit and the `:4063` edit are in place and line-neutral.
  - The same rule holds for the stage-2 runbook's one edited paragraph (Task 5): reflow within it, line-neutral.
  - Task 1 Step 1 greps the citation corpus for any citation that quotes either `shared/api.ts` line. If one quotes the TEXT at `:4024` or `:4063`, Task 2 takes the fallback, DEP-move-record-kind.
  - The same Step 1 greps the corpus for line citations into `ccd/ccrc`, `ccd/ccrc-doctor-checks` and the stage-2 runbook past the first line Tasks 4–5 edit. If any exist, those tasks keep their edits line-neutral above the cited lines, or repoint each citation in the same commit, proving each shift.
- **Suites.** Run them in the foreground, one command per call, inside the package, with timeout ≥ 600000 ms: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`.
  - Run `npm ci` first where `node_modules` is absent, in `pwa/` and `agent/` too, because `typecheck-tests.test.ts` spawns their compilers.
  - `typecheck-tests` is the ONLY net for a `ConvergeDeps` literal missing `recordMove`. Under vitest, `undefined !== null` calls `undefined`, and the new catch swallows the throw as a warning, so vitest alone does not surface a missed harness.
- **No residue in tracked text:** no hostname, username, absolute home path, `/mnt` path, docserver URL or org name. The shards' `TMPDIR` is a shell variable (`$SHARD_TMP`), never a committed value. `topology-clean.test.ts` runs after `git add` of any new file.
- **Commits.** Commit on the workspace branch only, at least once per task, as `feat(update): …`, `fix(update): …`, `test(update): …` or `docs(update): …`. Never use a separate feature branch. Wave-done goes in the same turn as the push; never end a turn to wait on CI.

## Review Focus

1. **A refusal that releases a node it should not, or stalls a node it should not.**
   - C's refusal must come BEFORE the acquire.
   - A standing pre-W8 rollback request to a refused tag must be noted non-halting (D-3375) and never sent.
   - A standing fleet request of that kind must not hold any server-role move as `waiting-for-fleet`, neither through `fleetAsk` nor through `fleetAuto`.
   - W5's halting spawn-failed must be unchanged for every refusal the inventory cannot decide: the parent's SHA256SUMS 404 on a yanked (draft or delisted) row, `unknown` provenance, a foreign or unreadable layout, and a killed flip.
2. **The record must never change the run, and must stay bounded.**
   - A's port runs after the lease write and after `onAccepted`, never between the acquire and the send.
   - A port that throws must leave the outcome, the lease row and `sent` exactly as they were.
   - The source must come from `move.source`, never parsed back out of `move.detail`. The unversioned detail carries no source word.
   - An idle release records nothing, so a node answering `busy` every minute writes no feed rows.
   - A release-refused row never says "released".
3. **A prune that removes something a run still needs, or that fires on a run that did not complete.**
   - Only a passed gate followed by a finished sweep reaches `_bak_gc`.
   - It removes none of these:
     - this run's own backup (by exact path, even under a clock step);
     - anything named at or after the run's lock second;
     - the newest earlier tree backup (another run's, a deploy's, or the previous update's);
     - the newest coord.db snapshot the run did not take.
   - It never dies, and it never prunes while another holder has the lock.
   - KEEP is a count: exactly the newest KEEP timestamped dirs survive by count.
4. **doctor's precedence.**
   - Presence in the exposure file wins, even when the value is empty.
   - An unreadable exposure file is UNMEASURED, never absent. It is a WARN only for the arms whose verdict depends on the flag, and every flag-independent FAIL stays a FAIL.
   - The shell's own `CCRC_AUTH` is never read.
   - Every `update-exposure` sentence stays byte-identical; its describe runs unedited.
   - The arming words name the file that won.
   - The existing gate-OFF auth cases are re-based, not weakened: each keeps its assertions, on a box that really is unexposed.
5. **Premise versus decision.**
   - For C, the premise that the node's refusal is a halting spawn-failed is measured false for the no-bundle class (Risk notes). Decision C's refusal is kept for what it does save.
   - For E, the premise is refuted at main and nothing is built (Risk notes).
6. **Wording that claims more than was measured.**
   - F1 names the channel and the catalogue as last read, and no "nothing newer" claim. The PWA qualifies any `resolveDetail` while `lastOkAt` is null (or unplaceable) or the node is unreachable.
   - F2 names the set it measured.
   - F3 makes no per-node flip claim, and says a rollback can be refused or can fail, and where the reason is shown.
   - F4 merges the two lines only when `update.detail` is EXACTLY what settle wrote for that report.
   - G1 claims no restart only when no supervisor was active before the restart, and names every one that was active before and is not after.
   - G2 claims nothing about a passphrase file at a path the box does not use, and never says "armed" on the flag alone.
   - Every no-bundle sentence names commands that the box's own `cmd_rollback` header and kept arm give, and uses no literal placeholder.

## Risk notes

These are measured facts that narrow a premise, and attack findings kept as risks rather than applied, where a coordinator decision or ruling stands over them.

- **C's value is narrower than the decision's premise.** Decision C says the node's refusal "becomes a HALTING spawn-failed". Measured at `a742eb6a`, a one-tap to an unbundled tag on a verified node does not halt:
  - v0.0.1–v0.0.8 list `ccrc-vX.tar.gz` and `SHA256SUMS`, so the `--detach` parent's SHA256SUMS probe passes, the parent detaches and exits 0, and the op is accepted;
  - the child's `_upd_fetch` then dies with the `provenance: ` prefix (`ccd/ccrc:15830-15832`);
  - settle writes `failed`, `isHalting` returns false (`dispatch.ts:93-97`; pinned by `update-dispatch.test.ts:104`), and the tag is recorded as this node's refusal.

  The decision's refusal is kept. What it saves is a wasted detached run, a `failed` row and a lasting refusal record. The refusals that DO halt stay permitted, because the inventory cannot decide them: the parent's exit-2 SHA256SUMS 404 on a yanked (draft or delisted) row (spec `:320`), and a foreign or unreadable layout. Task 1 Step 1 re-measures these facts before building.
- **E is dropped; no change is made.** Measured at `a742eb6a`, main polls the catalogue on the FIRST tick after start: `watch.ts:545-549` (`private lastCatalogueAt = 0;`, "the first tick after a start polls", D-3182), `start()` ends with `void this.tick();` (`:827`), the catalogue gate runs first in `tick()` (`:1290`), and `update-catalogue.test.ts:3053` pins it. The observed 0–35 min latency is the scheduled 30-minute interval's phase: a release published about a minute after its merge waits for the next scheduled poll. `REFRESH_MIN_INTERVAL_MS`'s derivation is untouched.
- **F1 does not use the literal phrase "up to date"** (ruled accepted). Decision F says the row "should read as up to date". Spec `:434-435` and `:1144`, and three PWA pins, forbid that phrase where the resolver cannot see `lastOkAt`. The row says the node runs the newest eligible release on its channel in the catalogue as last read, which is the measured fact.
- **B re-takes the lock after the sweep.** For the prune's duration, a `ccrc update` or `rollback` started on that box dies with `_upd_busy_die`. The first prune on each live box removes about 250–600 MB and takes seconds, not milliseconds. The report reads `restarting` throughout, so the console dispatches nothing to that node meanwhile.
- **B's first effect is one release late** (the protections and this risk stand as written, by ruling). The update INTO W8 is run by v0.0.49's `ccd/ccrc`: the running bash keeps reading the old script while `~/ccrc` flips, and that script has no `_bak_gc`. The backlog goes on the first update or rollback run BY a W8+ ccrc, which may be a flip rollback.
- **B's `CCRC_BACKUP_KEEP` is read from the process environment only,** like `CCRC_VERSIONS_KEEP`. A console-driven move runs under `systemd-run --user`, in the user manager's environment, which carries no `CCRC_BACKUP_KEEP` unless it was set there (`~/.config/environment.d/`, or `systemctl --user set-environment`). So in the ordinary case a console move prunes at the default 10, whatever the operator's shell exports.
- **B's KEEP counts every timestamped dir of any origin** (kept by ruling; the reduced history is accepted). That includes this run's spine installer dirs (`install-*-skill.sh` and `install-session-hooks.sh` each mint their own) and deploy.sh's. On a multi-home fleet box, KEEP=10 may keep only one or two updates of history. Task 4 Step 1 measures dirs-per-update, and the commit body states the effective history.
- **B's floor covers only writers that start at or after this run's lock second, on this box's clock and TZ.** Three writers it does not cover:
  - (a) a `ccrc backup`, a plain `ccrc install` spine or a deploy.sh that STARTED before the lock second and is still copying: its dir is below the floor and can be removed mid-copy at a small KEEP;
  - (b) deploy.sh, whose `TS` is computed on the operator's machine (`deploy/deploy.sh:191`), in that machine's clock and TZ, so its box-side name may sort hours before or after this box's floor;
  - (c) a `ccrc backup` or deploy.sh that lands between run X's backup and run Y's floor while X still sweeps: the newest-tree pick becomes that dir, X's backup becomes prunable, and X's sweep-death lines can name a deleted directory.

  These sit beside the `ccrc backup` race in Out of scope, as one open question for the coordinator. The stronger alternative, protecting every tree dir below the floor that is newer than the previous completed update, needs a record of that update's time that the box does not keep today.
- **C's fleet-hold exclusion keys on the whole predicate** (ruled accepted). So it also releases the pre-existing stall in which a standing fleet rollback to an unlisted tag holds every other node: a behaviour change on main's `unknown-tag` path. It also opens one window: for up to one poll after a bundle is attached to a release, the node would accept the fleet request (its `sigstore.json` answers 200) while the server still refuses it `no-bundle` and lets server moves go ahead of it. Refresh closes the window. It is the only way the exclusion inverts the fleet-first order; the one-lease rule still holds.
- **C's no-bundle refusal ignores a kept copy** (ruled accepted, D-3589). A verified node that keeps an unsigned copy of the tag would have flipped to it. Every no-bundle sentence therefore names `ccrc rollback --to <tag>` on that box first.
- **A's audit is bounded by the feed, not forever.** `FEED_RETENTION` is 2000 rows across ALL kinds (`store.ts:4428`), and the NotifyLog ring is 200 events (`notifylog.ts:6`). Because an idle release records nothing, the audit writes about one row per real move attempt, so the window is days of ordinary moves. It is stated, not raised.
- **D's shared reader is new.** Decision D says "through one shared reader if one exists". None exists at main: `git grep` finds `_check_update-exposure`'s two inline later-wins reads and `_check_exposure`'s non-empty-wins variant. So one is made, `_box_unit_env`, beside `_box_env_value` in `ccd/ccrc`, and `_check_update-exposure` moves onto it.
- **D leaves the secret and sessions paths read from `ccrc.env` alone.** `_box_auth_path` and `_box_sessions_path` still read `CCRC_AUTH_SECRET_PATH` and `CCRC_SESSIONS_PATH` from `ccrc.env` only. A hand-edit that put either key into the exposure file would be honoured by the server but not by doctor, `passwd` or install's gate line. `ccrc expose` never writes either key, and its shadow-key refusal (`ccd/ccrc:4986`) guards the other direction.
- **D corrects six existing doctor cases.** `healthy()` (`ccrc-doctor.test.ts:1142`) writes an exposure file carrying `CCRC_AUTH=on` (`:769-790`), so every auth case built on it that expects the gate OFF passed at main only on the live defect's premise. Task 5 re-bases them on a box that is really unexposed. D-M1 cannot red them (with the exposure read deleted they still read OFF), so they are controls, not pins.
- **G1's success line is unchanged when some supervisors vanish.** When some units were active before `try-restart` and are not active after it, each is named on stderr, and the existing success line still prints, byte-identical, as main prints it. Rewording that line in the mixed case is outside decision G.
- **G2 keeps main's absent-arm line when the exposure file cannot be read.** With no passphrase file and an unreadable exposure file, install prints the fresh-box line (whose "to arm the gate" may be moot). doctor's WARN names the file.

## Deviations found

These are plan-level departures from the spec's literal text, a coordinator decision's literal words, or an earlier plan's text. Each carries the number the coordinator minted for this wave's run. The contingent entry keeps its slug: if it fires, it takes the next reserve number the brief names, and it is defined in the commit that first cites it.

### Item A

- **D-3586** — Decision A asks for each move's source on a durable record. The spec defines no move audit, and §10's `--detach --from pwa` argv stays byte-identical. So the record is a new NotifyKind `update` feed row (`sessionId ''`, `runId null`, recorded and never pushed), a wire addition the spec's NotifyEvent kinds do not list. A row is written only for a move the node accepted or held, one released `failed`, or one whose release was refused. An idle release writes none, because the node did not move and the same answer repeats every dispatch run, which would evict the 2000-row feed in about a day and a half.
- **DEP-move-record-kind** (contingent). It fires ONLY if Task 1 Step 1's citation grep finds a session-hook citation that quotes the text of `shared/api.ts:4024` or `:4063`. If it fires, the row is written with the existing kind `coord` and a title prefixed `update:`, against `coord`'s docstring (a caps change), and no NotifyKind is added. If it does not fire, this slug is withdrawn unminted, and the wave-done report says so.

### Item C

- **D-3587** — Spec §9/§10 and wave 5 fix eleven refusal words. This adds a twelfth, `no-bundle`, and §12's 409 words grow by one. `moveRefusal` answers it for a ROLLBACK whose catalogue row does not list a provenance bundle while the node's `provenance` is `verified`: that node's ccrc refuses the download without `--allow-unsigned`, which a one-tap never passes. A tag already in `node_release_refusals` now reads `no-bundle` before `refused-by-node`, so its sentence moves from "ack to clear" to the by-hand remedy, and an ack no longer changes the verdict.
- **D-3588** — D-3381 and D-3409 hold every server-role move while a live fleet row has a standing request it has not itself refused. This wave also excludes a standing fleet rollback that `rollbackTargetRefusal` refuses, from `fleetAsk` and from `fleetAuto`: while it stands, the request outranks that row's auto, so its auto cannot land either. Such a request is never sent, so it never becomes a `refusedByNode` record, and without the exclusion every server move would wait for an ack. It also releases main's standing `unknown-tag` stall and opens the one-poll bundle-late window (both in Risk notes, ruled accepted).
- **D-3589** — (conservative, ruled accepted). Spec §9/§10 keep a rollback permitted where the node can flip a kept copy, but the inventory has no kept fact and decision F forbids a new field, so `no-bundle` is refused whether or not the node keeps the tag. Measured from the code at `a742eb6a`: `_ver_keep_state` keeps any completed install's record, unsigned included, and `cmd_rollback`'s kept arm flips with no provenance question. So a verified node that once ran the tag through the by-hand `--allow-unsigned` remedy, and still keeps it (`_ver_gc` keeps 3 by default), would have flipped, most likely on the node row's own Roll back to `previousVersion`. Every no-bundle sentence therefore names `ccrc rollback --to <tag>` on that box, which flips a kept copy, before `ccrc update --to <tag> --downgrade --allow-unsigned`.

### Item F

- **D-3590** — (F1). Spec §9 `:619-623` gives a NULL `desiredTag` two sentences for "nothing above the floor". This adds a third, `RESOLVE_DETAIL.atNewest`, for a node that runs the newest eligible tag at its own floor, and §9's sentences are unchanged. It reads "runs vX, the newest eligible release on <channel> in the catalogue as last read", and avoids decision F's literal "up to date" (ruled accepted) because spec `:434-435` and `:1144` forbid that phrase where the resolver cannot see `lastOkAt`. The PWA qualifies any `resolveDetail` while `lastOkAt` is null or the node is unreachable.
- **D-3591** — (F2). §13 `:1117` gives a release row two labels, Install and Roll back. This adds a third, non-actionable state with no button, for a release every managed node runs by last measurement (macOS left out, D-3410). Its words name the measured set: "Running on every managed node", then how many of those are unreachable, and that macOS nodes are not moved from here when one runs another version.

### Item B

- **D-3592** — Design §10 releases the update lock before the sweep and takes it no more. The prune runs after the sweep under the lock RE-TAKEN without dying (`_ver_lock_try`, `_inst_doctor_tail`'s shape), because the sweep can still exit 1 after `_ver_gc` and the decision says a failed run never prunes. If another holder has the lock then, nothing is pruned and the run says so. While the prune holds the lock, a `ccrc update` or `rollback` started on the box dies with `_upd_busy_die`.
- **D-3593** — Decision B's "keep the newest N, never the run's own backup" is implemented with two protections that only remove dirs from the removal set: `$UPD_BACKUP_DIR` by exact path, and every timestamped dir named at or after `UPD_BAK_FLOOR`, the second this run first held the lock. So a dir can survive beyond N: this run's spine-installer dirs, anything a writer on this box's clock and TZ started at or after that second, and a future-dated dir, which stays protected for good.
- **D-3594** — Beyond N, the newest dir named below the floor, other than `$UPD_BACKUP_DIR`, that holds a `server-dist` or `agent-dist` entry is kept. Those entries are written by `_upd_backup` (`ccd/ccrc:16545`, `:16547`) and by deploy.sh's backup (`deploy/deploy.sh:566`), and by no spine installer. A hand-run update Y can take the lock that X released before its multi-minute sweep, and prune while X sweeps; without the rule, X's backup could fall below Y's floor and X's sweep-death lines would name a deleted directory. The same rule keeps the previous update's tree backup.
- **D-3595** — Beyond N, the newest dir named below the floor, other than `$UPD_BACKUP_DIR`, that holds a regular `coord.db` is kept, so at `CCRC_BACKUP_KEEP=0` one earlier snapshot survives. `_upd_report`'s printed restore recipe names only this run's own backup, so the rule is not for it. It is for the runs that take no backup (a flip rollback) and for the operator paths that point at "the newest `~/ccrc-backups/<ts>/coord.db`" (`ccd/coordinator-skill/references/resume.md:129`, `server/src/coord/db.ts:144`, `:221`).

### Item D

- **D-3596** — Decision D says doctor reads `CCRC_AUTH` the way `ccrc.service` receives it. For an exposure file that is there and unreadable, doctor does not decide what the service receives: it reports the flag UNMEASURED. Every flag-independent FAIL stays a FAIL (the relative secret path, the missing helper, node, the helper's unrecognised state line, rc 4); only rc 0's two PASSes and rc 3's PASS/FAIL become one WARN. **Corrected in fix round 1 (item 3 / review 196 F4):** the tip's words at 1eb9b011 said an unreadable exposure file stops the server job because sourcing it is a special-builtin error that exits `/bin/sh`, which assumed a POSIX shell the macOS job does not use. What is actually known: the macOS job is `/bin/bash -c "set -a; [ -f f ] && . f; …"` (`ccd/ccrc:14104`, `:14113-14115`, both at 1eb9b011) — non-POSIX bash prints `Permission denied` and CONTINUES past an unreadable file, while POSIX-mode bash and dash exit (measured with GNU bash 5.2.21 on Linux; macOS's `/bin/bash` 3.2 was not executed). On Linux, systemd's man page documents the `-` prefix for a MISSING file only; that an unreadable `-` file is skipped too comes from systemd's source, and was not executed either. "Unreadable" here also covers a path that is not a regular file at all, such as a directory, which `[ -f ]` skips silently (an unreadable regular file is not silent: bash prints `Permission denied`) (wave 9, R11-F4) — the suite pins that case. So what either service manager does with an unreadable exposure file is not measured, which is why the WARN says "not measured" rather than naming a winner — conservative, and never a false ARMED. The WARN itself stays; only this entry's premise for it was wrong.
- **D-3597** — Decision D's one reader leaves one other precedence copy. `_check_exposure`'s own `CCRC_HOST` read (`ccrc-doctor-checks:1663-1673`), where a non-empty value wins, is left unchanged. Moving it onto `_box_unit_env` would change that check's verdict on a bare `CCRC_HOST=`, which is not item D.

### Item G

- **D-3598** — (G2). Decision G says to condition install's gate line on the passphrase file's absence. The line also reads the file through `_box_auth_path` (a relative override is said to be undecidable) and the flag through `_box_unit_env`. With the file present, it says `CCRC_AUTH=on in <file>`, or gives the OFF remedy naming the file that decides; with the file absent and the flag on, it says the gate is failing shut. The fresh-box line (file absent, flag off) stays byte-identical.
- **D-3599** — (fix round 1, item 1 / review 196 F1). Task 5's code writes `listing=… || :` and keys the zero line on `before` alone (at 1eb9b011: `:1382`, `:1399-1402`): an unmeasured listing left `before` empty and the zero line claimed no supervisor was active even when every one of them was, and the symmetric verify-side listing left its per-unit warnings and success line firing over units nobody re-listed. Both are now measured: an unmeasured pre-sweep listing is a failed preflight — the sweep refuses and restarts nothing, prints the REFUSED stderr line and the DEGRADED stdout line, and returns rc 0 exactly as the KillMode refusal does; an unmeasured verify listing verifies nothing — when something was restarted, its per-unit "not active after it" warnings and the success line are replaced by one warning naming the listing's rc and one DEGRADED line, rc still 0. The accepted trade-off: the refusal is visible only in that run's own stdout and stderr — `update.json`, the inventory and doctor do not record it — and nothing re-sweeps, so a converged box's next update leaves it alone (residue R10k).

## File structure

**New**
- `docs/superpowers/plans/2026-09-30-centralised-update-w8-live-audit-residue.md`: this plan, added in Task 1's commit with the minted numbers in place of the slugs.

**Changed**
- `shared/api.ts` (L0).
  - In place: the NotifyEvent kind union and its docstring (`:4009-4024`), `NOTIFY_KINDS` (`:4063`), `DISPATCH_REFUSALS` (`:8788-8791`), `MoveSkipWhy` (`:8840`).
  - Appended after `PROVENANCE_DETAIL_PREFIX`: `rollbackTargetRefusal`, `settledDoneDetail`.
- `server/src/update/dispatch.ts` (L1).
  - In place: the import, `DispatchRow` (`:49-57`), `moveRefusal`'s docstring (`:148-157`), its `known` lookup and its rollback arm (`:180-182`), `planDispatch`'s docstring and its `fleetAsk`/`fleetAuto` (`:251-270`), and `REFUSAL_SENTENCE`.
  - New, directly above `moveRefusal`: `releaseRowFor`.
  - Appended after `leaseHolder`: `LeasedMoveResult`, `MoveFeedRecord`, `moveFeedRecord`.
- `server/src/update/converge.ts` (L3): its `./dispatch.js` import, `ConvergeDeps.recordMove` (`ConvergeDeps` at `:67`), and `runDispatch`'s three returns after the answer.
- `server/src/update/routes.ts` (L4): `skipWord` (`:330`) and `SKIP_SENTENCE` (`:344`).
- `server/src/update/resolve.ts` (L1): `RESOLVE_DETAIL.atNewest` and one branch in the unpinned path, placed before the `rolledBack` return (Task 3).
- `server/src/update/inventory.ts`: the settle at `:423` calls `settledDoneDetail` (Task 3).
- `server/src/watch.ts` (L4): `dispatchOnce` (`:954`) and a private `recordMoveFeed` (Task 2).
- `pwa/src/lib/api.ts`: `noBundleRollbackText` and `UPDATE_ERROR_TEXT['no-bundle']` (Task 1).
- `pwa/src/fleet/movePlan.ts`: `rollbackBlockers` (Task 1) and `rollbackHowText` (Task 3).
- `pwa/src/fleet/UpdateMoveSheet.tsx`: the rollback consequence line (Task 3).
- `pwa/src/screens/SettingsScreen.tsx`:
  - Task 1: `ReleaseItem`, `NodeItem`, `rollbackBlockedText`.
  - Task 3: `releaseDirection`, `releaseRunningText`, `resolveDetailLine`, `finishedLine`, the `catalogueLastOkAt` prop through `NodeList` (`:457`) and `NodeItem` (`:365`), and the comment at `:281-282`.
- `pwa/src/screens/MailScreen.tsx`: `KIND_WORD` and `KIND_GLYPH` (`:51-57`) (Task 2).
- `pwa/src/fleet/fleet.css`: `.settings-release-running`, only if the existing classes do not already cover it (Task 3).
- `ccd/ccrc`:
  - **Task 4:**
    - `BAK_TS_PAT`, `BAK_DIRS` and `UPD_BAK_FLOOR`;
    - `_upd_lock` (`:15198`);
    - `cmd_update`: around `_ver_gc update auto || :` at `:13811`, and after `_upd_report` at `:13832`;
    - `cmd_rollback`'s flip arm (`:14305-14311`);
    - `cmd_backup`'s header (`:18128-18134`);
    - `_bak_list`, `_bak_prune` (`:18178`) and `_bak_gc`;
    - the usage text of update and rollback.
  - **Task 5:**
    - `_box_unit_env` and its out-params, after `_box_env_value` (`:2547`);
    - `_upd_sweep`: the Darwin success line (`:17521`), and the Linux preflight listing, verify loop and success line (`:17529-17559`);
    - install's gate line (`:9948`).
- `ccd/ccrc-doctor-checks` (Task 5):
  - `_check_auth`: its header (`:1244-1250`), preflight (`:1275-1283`), flag read (`:1304-1309`), `$where`/`$gate`, the rc 0/3/4 arms, and the rc-3 PASS detail's arming words;
  - `_check_update-exposure`: the header sentence (`:1716-1731`) and the reads at `:1784-1812`.
- `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md`: step 12's sentence after `:723` ("The same line closes the sweep on a box with no live sessions — …"), line-neutral (Task 5).
- `README.md`, each edit line-neutral:
  - `:639`, the one-tap 409 list, in the paragraph that opens at `:633` ("Moving a node from the console") (Task 1);
  - `:488-492`, the update step list (Task 4);
  - `:716-718`, `ccrc backup` (Task 4);
  - `:833-838`, doctor's auth paragraph (Task 5).
- Tests: named per task. `update-projection.test.ts` (`:200`) and `runbook-holds.test.ts` are edited this wave (Tasks 3 and 5).
- **Run, not edited:**
  - `update-killed-arms`, `update-lease-holder`, `update-local-spawn-throw`, `update-op-answer`, `update-inventory`, `update-writer-groups`, `update-store-*`, `update-spawn-twin-bodies`, `update-catalogue`;
  - `push-copy`, `coord-caps-route`, `box-token-census`, `single-definition` (except its `WORDS` literal, Task 1), `session-hook`, `deviation-refs`, `dtbd`, `typecheck-tests`, `topology-clean`, `ownership`;
  - `ccrc-versioned-audit`, `deploy-verify`, `ccrc-uninstall`, `ccrc-cli`;
  - the pwa suites not named per task.

## Tasks

### Task 1: No one-tap rollback a node is known to refuse (item C)

**Files:**
- **Modify `shared/api.ts`:**
  - `DISPATCH_REFUSALS` (`:8788-8791`, in place): `'no-bundle'` is appended as the LAST element, reflowed within the literal's two lines. Its docstring (`:8783-8787`) is unchanged and still reads true.
  - `MoveSkipWhy` (`:8840`, in place): becomes `Exclude<DispatchRefusal, 'no-update-gate' | 'no-rollback-cap' | 'no-bundle'>`. `{all: true}` asks for update moves only, so `no-bundle` is never a skip.
  - `rollbackTargetRefusal`, APPENDED after `PROVENANCE_DETAIL_PREFIX`.
- **Modify `server/src/update/dispatch.ts`:**
  - the `shared/api.js` import gains `rollbackTargetRefusal` and `type ProvenanceState`, in place;
  - `DispatchRow` gains `provenance: ProvenanceState;` on its `stampRead` line. `NodeRow` (`store.ts:326`) satisfies it structurally;
  - `releaseRowFor`, directly above `moveRefusal`'s docstring, and `moveRefusal`'s `known` lookup moved onto it;
  - `moveRefusal`'s docstring: "for a rollback, no releases row at all (yanked PERMITTED …)" gains "; and — wave 8 item C — a rollback the node is known to refuse, `rollbackTargetRefusal` (L0)";
  - the rollback arm;
  - `planDispatch`'s `knownRefusedAsk`, the `fleetAsk` and `fleetAuto` conjuncts, and one docstring clause;
  - `REFUSAL_SENTENCE['no-bundle']`.
- **Modify `server/src/update/routes.ts`:** `skipWord`'s throw list (`:330`) gains `r === 'no-bundle'`, and `SKIP_SENTENCE` gains `'no-bundle'`.
- **Modify `pwa/src/lib/api.ts`:** `noBundleRollbackText`, directly above `UPDATE_ERROR_TEXT`, and `UPDATE_ERROR_TEXT['no-bundle']`, after `'no-rollback-cap'`.
- **Modify `pwa/src/fleet/movePlan.ts`:** the value import gains `rollbackTargetRefusal`, the type import gains `ReleaseWire`, and `RollbackBlocker` and `rollbackBlockers` are appended after `runsNewer`.
- **Modify `pwa/src/screens/SettingsScreen.tsx`:**
  - the imports gain `rollbackTargetRefusal`, `rollbackBlockers`, `type RollbackBlocker`, `moveSkipText` and `noBundleRollbackText`;
  - `rollbackBlockedText` goes after `releaseDate`;
  - `ReleaseItem` and `NodeItem`.
- **Modify `README.md` `:639`:** in the 409 list, "an unknown or refused tag" becomes "an unknown or refused tag, a rollback to a release the catalogue lists no provenance bundle for on a verified node". Reflow within the paragraph, line-neutral.
- **Modify:** this plan (added).
- **Test `server/test/update-dispatch.test.ts`:**
  - "the eleven words" at `:62-67` becomes twelve, with `'no-bundle'` last;
  - every `DispatchRow` and `NodeRow` literal helper gains `provenance`, defaulting to `'verified'` (the live boxes' state);
  - a new describe beside the rollback cases (`:374`);
  - a `planDispatch` describe for the fleet holds;
  - the `reach` Record at `:420-431` (typed `Record<Exclude<DispatchRefusal, 'waiting-for-fleet'>, …>`, so a missing key is a tsc error) gains `'no-bundle': refusalOf(view(fleet()), 'rollback', 'v0.0.12')` (the file's `RELEASES` lists `v0.0.12` with `bundleListed: false`, `:52`);
  - the premise pin already exists: `a failed row whose detail BEGINS provenance: does not halt` (`:104`). Cite it; add nothing.
- **Test `server/test/single-definition.test.ts` `:3913-3915`:** the `WORDS` literal gains `'no-bundle'`, and the header prose's "eleven" becomes "twelve", both in place and line-neutral.
- **Test `server/test/update-apply-routes.test.ts`:** one case beside `:662`, and the word table at `:724`.
- **Test `server/test/update-converge.test.ts`:** two cases, a standing pre-W8 request and the fleet-hold release.
- **Test the pwa:** `pwa/test/api.test.ts` `:1235` (the copy table), `pwa/test/settings-screen.test.tsx`, `pwa/test/move-plan.test.ts`.

**Interfaces and code:**
```ts
// shared/api.ts, in place:
export const DISPATCH_REFUSALS = [
  'unknown-tag', 'not-newer', 'refused-by-node', 'stamp-unread', 'floor-unread', 'no-detach-cap', 'no-update-gate',
  'no-rollback-cap', 'agent-predates-update-op', 'halted', 'waiting-for-fleet', 'no-bundle',
] as const;

// shared/api.ts, appended after PROVENANCE_DETAIL_PREFIX:
/** Wave 8 item C: a ROLLBACK the node is known to refuse, decidable from the inventory alone, or null. THE one
 *  spelling: the dispatcher's `moveRefusal` and `planDispatch`'s fleet holds (server/src/update/dispatch.ts) and the
 *  PWA's release and node rows (pwa/src/fleet/movePlan.ts, pwa/src/screens/SettingsScreen.tsx) all call it.
 *  `unknown-tag`: no catalogue row, the inventory's one proxy for `cmd_rollback`'s "not a published release" (404).
 *  `no-bundle`: the catalogue lists no provenance bundle for the tag and the node's install is VERIFIED, so its ccrc
 *  refuses to DOWNLOAD the tag without --allow-unsigned, which the one-tap never passes. A kept copy of the tag would
 *  flip with no such question, but the inventory has no kept fact, so this refuses anyway (conservative; the no-bundle
 *  sentences name `ccrc rollback --to <tag>` on that box). Everything else is undecidable here and stays permitted:
 *  an `unverified` node passes --allow-unsigned itself, an `unknown` one reads only its own marker, a yanked release
 *  may be a kept copy. `provenance` is required on NodeWire since W6; `undefined` (a pre-W6 server) reads as not
 *  verified. */
export function rollbackTargetRefusal(
  release: { bundleListed: boolean } | undefined, provenance: ProvenanceState | undefined,
): 'unknown-tag' | 'no-bundle' | null {
  if (release === undefined) return 'unknown-tag';
  return release.bundleListed !== true && provenance === 'verified' ? 'no-bundle' : null;
}
```
```ts
// dispatch.ts, directly above moveRefusal's docstring:
/** Wave 8 item C: THE lookup of a move target's catalogue row — moveRefusal's and the fleet holds' — so the two can
 *  never read different rows. A non-tag target has no row. */
const releaseRowFor = (releases: readonly EligibilityRow[], tag: string): EligibilityRow | undefined =>
  isReleaseTag(tag) ? releases.find((r) => r.tag === tag) : undefined;

// moveRefusal: `const known = tagOk ? releases.find((r) => r.tag === move.target) : undefined;` becomes
//   `const known = releaseRowFor(releases, move.target);` (`tagOk` stays: the floor test reads it).
// …and the rollback arm, replacing `} else if (known === undefined) {\n    return 'unknown-tag';\n  }`:
  } else {
    // Wave 8 item C: a rollback the node is KNOWN to refuse is refused here, before any lease or spawn, with
    // L0's predicate (the PWA calls the same one). A non-tag target leaves `known` undefined: 'unknown-tag', as
    // before. Before refused-by-node, as unknown-tag already was: the target's own fact comes first.
    const rb = rollbackTargetRefusal(known, row.provenance);
    if (rb !== null) return rb;
  }

// planDispatch, directly before `const fleetAsk`:
  // Wave 8 item C: a fleet row whose standing request is a rollback the server refuses before any spawn
  // (rollbackTargetRefusal, L0). It is never sent, so it never becomes a refusedByNode record; and while it stands it
  // outranks that row's auto (intendedMove), so that auto cannot land either. Neither hold may wait on it — without
  // this, every server-role move would wait for an ack. ONE test, asked by both holds.
  const knownRefusedAsk = (v: DispatchNodeView): boolean =>
    v.row.requestedTag !== null && v.row.requestedKind === 'rollback'
    && rollbackTargetRefusal(releaseRowFor(input.releases, v.row.requestedTag), v.row.provenance) !== null;
  const fleetAsk = ordered.find((v) =>
    dispatchRank(v.row.role) === 0 && v.row.requestedTag !== null && !refusedByNode(v, v.row.requestedTag)
    && !knownRefusedAsk(v)) ?? null;
  const fleetAuto = ordered.find((v) =>
    dispatchRank(v.row.role) === 0 && autoPermits(v.auto, v.row.channel) && v.row.desiredTag !== null
    && !refusedByNode(v, v.row.desiredTag) && !knownRefusedAsk(v)) ?? null;

// REFUSAL_SENTENCE, after 'no-rollback-cap':
  'no-bundle': (r, t) =>
    `the catalogue lists no provenance bundle for ${t} and ${r.label}'s install is verified, so the one-tap is not sent — its ccrc refuses to download ${t} without --allow-unsigned, which a one-tap never passes; on that box, ccrc rollback --to ${t} flips to a kept copy if it keeps one, and otherwise ccrc update --to ${t} --downgrade --allow-unsigned installs it; or Refresh if a bundle was published since the last poll, or pick a newer release`,
```
```ts
// routes.ts SKIP_SENTENCE, after 'no-rollback-cap' (the Record forces a key; skipWord throws before it is read):
  'no-bundle': (v, t) => `the catalogue listed no provenance bundle for ${t} and ${v.row.label}'s install was verified`,
```
```ts
// pwa/src/lib/api.ts, directly above UPDATE_ERROR_TEXT:
/** Wave 8 item C: the no-bundle refusal's words, with the tag when the caller knows it (a release or node row) and
 *  without a literal placeholder when it does not (a 409 answered to a sheet or a toast). ONE spelling:
 *  UPDATE_ERROR_TEXT['no-bundle'] is this with `null`. */
export function noBundleRollbackText(tag: string | null): string {
  const how = tag === null
    ? 'On the node itself, ccrc rollback --to with that tag flips to a kept copy if the node keeps one; otherwise ccrc update --to with that tag, plus --downgrade --allow-unsigned, installs it.'
    : `On the node itself, ccrc rollback --to ${tag} flips to a kept copy if the node keeps one; otherwise ccrc update --to ${tag} --downgrade --allow-unsigned installs it.`;
  return `The catalogue lists no provenance bundle for ${tag ?? 'that release'} and the node’s install is verified, so it is not sent from here: a verified node refuses to download a release without --allow-unsigned, which a one-tap never passes. ${how} Tap Refresh if a bundle was published since the last poll, or pick a newer release.`;
}
// UPDATE_ERROR_TEXT, after 'no-rollback-cap':
  'no-bundle': noBundleRollbackText(null),
```
```ts
// pwa/src/fleet/movePlan.ts, appended after runsNewer:
/** Wave 8 item C: one node a fleet rollback would name that the server refuses before any spawn, and why. */
export interface RollbackBlocker { label: string; word: 'unknown-tag' | 'no-bundle' }
/** The managed nodes a fleet rollback to `to` names (planMove's own set: isManagedNode and runsNewer), in dispatch
 *  order, whose rollback the L0 predicate refuses — never a copy of it. ANY one blocks the row: D-3390's per-node
 *  sequence would move the nodes before it and stop at the refused one, splitting the fleet. */
export function rollbackBlockers(nodes: readonly NodeWire[], release: ReleaseWire | undefined, to: string): RollbackBlocker[] {
  if (!isReleaseTag(to)) return [];
  const out: RollbackBlocker[] = [];
  for (const n of nodes.filter((x) => isManagedNode(x) && runsNewer(x, to)).sort(compareDispatchOrder)) {
    const word = rollbackTargetRefusal(release, n.provenance);
    if (word !== null) out.push({ label: n.label, word });
  }
  return out;
}
```
```tsx
// SettingsScreen.tsx, after releaseDate:
/** Wave 8 item C: the reason a Roll back to `tag` is not offered, grouped by word. `no-bundle` is said with the tag
 *  (noBundleRollbackText); any other word through the route's own copy (`moveSkipText` reads `UPDATE_ERROR_TEXT`,
 *  and has a fallback for a word it does not know). */
export function rollbackBlockedText(blockers: readonly RollbackBlocker[], tag: string): string | null {
  if (blockers.length === 0) return null;
  const words = [...new Set(blockers.map((b) => b.word))];
  return words.map((w) => {
    const who = blockers.filter((b) => b.word === w).map((b) => b.label).join(', ');
    return `Roll back not offered for ${who}: ${w === 'no-bundle' ? noBundleRollbackText(tag) : moveSkipText(w)}`;
  }).join(' ');
}

// ReleaseItem: after `const direction = …`
  const blockers = direction === 'rollback' ? rollbackBlockers(nodes, r, r.tag) : [];
  const blocked = rollbackBlockedText(blockers, r.tag);
// …and in the JSX, before settings-release-actions:
      {blocked !== null && <p className="settings-release-refused" data-testid="settings-release-blocked">{blocked}</p>}
// …and the button gains `disabled={blockers.length > 0}`.

// NodeItem: after `const previous = …` — computed for a managed row only: a Darwin row offers no Roll back at all
// (decision 17), so a reason line there would imply a one-tap exists for it.
  const previousRefusal = darwin || previous === null
    ? null : rollbackTargetRefusal(releases.find((r) => r.tag === previous), n.provenance);
  const previousBlocked = previousRefusal === null || previous === null
    ? null : rollbackBlockedText([{ label: n.label, word: previousRefusal }], previous);
// …the Roll back button's `disabled={previous === null}` becomes `disabled={previous === null || previousRefusal !== null}`,
// its onClick guard gains `&& previousRefusal === null`, and after the detail line:
      {previousBlocked !== null && <p className="settings-node-detail">{previousBlocked}</p>}
```
Check that `moveSkipText`'s parameter (`MoveSkipWhy | (string & {})`) accepts `'unknown-tag'`. It does, by its `string & {}` arm, and its lookup is `Object.hasOwn`-guarded (`pwa/src/lib/api.ts:411-415`).

- [ ] **Step 1: Re-measure the base for the whole wave,** on the tip being built, after `git fetch origin main` (and a merge if main moved):
  ```bash
  git rev-parse --short HEAD origin/main
  grep -n "'no-update-gate', 'no-rollback-cap', 'agent-predates-update-op', 'halted', 'waiting-for-fleet'" shared/api.ts server/test/*.test.ts
  grep -n "export type MoveSkipWhy\|export const PROVENANCE_DETAIL_PREFIX\|kind: 'ask' | 'done'\|const NOTIFY_KINDS\|reachable: boolean\|export type ProvenanceState\|export const DISPATCH_REFUSALS" shared/api.ts
  grep -n "} else if (known === undefined) {\|export interface DispatchRow\|export function leaseHolder\|const fleetAsk = ordered.find\|const fleetAuto = ordered.find\|export function isHalting\|const known = tagOk" server/src/update/dispatch.ts
  grep -n "const holder = leaseHolder\|export interface ConvergeDeps\|const got = store.dispatchNode\|deps.onAccepted()" server/src/update/converge.ts
  grep -n "if (r === 'halted' || r === 'no-update-gate'\|const SKIP_SENTENCE" server/src/update/routes.ts
  grep -n "private async dispatchOnce\|private pushOne(\|private lastCatalogueAt = 0" server/src/watch.ts
  grep -n "notNewerThanFloor: (newest\|resolveDetail: RESOLVE_DETAIL.notNewerThanFloor\|RESOLVE_DETAIL.rolledBack" server/src/update/resolve.ts
  grep -n "kind: 'settle', detail: \`done: " server/src/update/inventory.ts
  grep -n "export function releaseDirection\|export function nodeStateLine\|function ReleaseItem\|function NodeItem\|function NodeList\|const lastOkAt = c.lastOkAt" pwa/src/screens/SettingsScreen.tsx
  grep -n "^_bak_prune()\|^_keep_ok()\|^_ver_lock_try()\|^_upd_lock()\|^_upd_backup()\|    _ver_gc update auto || :\|  _upd_report \"\$old_desc\" \"\$old_version\"\|^_box_env_value()\|^_box_auth_path()\|this box has NO PWA passphrase\|update: sweep: every live\|_upd_marker_unsigned && extra+=\|^_upd_marker_unsigned()\|^UPD_FROM=\|^_ver_keep_state()\|^_ver_flip_back()" ccd/ccrc
  grep -nF 'if [ "$no_gate" -eq 1 ]; then' ccd/ccrc
  grep -nF 'local doctor_rc="$VER_SPINE_RC"' ccd/ccrc
  grep -n "^_check_auth()\|^_check_update-exposure()\|THE FLAG IS READ FROM ccrc.env" ccd/ccrc-doctor-checks
  wc -l README.md shared/api.ts server/test/ccrc-update.test.ts
  ```
  **Expected at `a742eb6a`:**

  | File | Lines |
  |---|---|
  | `shared/api.ts` | `:8790` (the one line the refusal grep matches; the export is `:8788`, its literal `:8789-8791`), `:8840`, `:8851`, `:4024`, `:4063`, `:8576` (`reachable`), `:8415` (`ProvenanceState`), `:8788` |
  | `dispatch.ts` | `:180` (the rollback arm), `:49` (`DispatchRow`), `:488` (`leaseHolder`), `:266` (`fleetAsk`), `:268` (`fleetAuto`), `:93` (`isHalting`, `:93-97`), `:162` (`const known = tagOk`) |
  | `converge.ts` | `:326` (`holder`), `:67` (`ConvergeDeps`), `:316` (`dispatchNode`), `:334` (`deps.onAccepted()`) |
  | `routes.ts` | `:330` (`skipWord`'s throw list), `:344` (`SKIP_SENTENCE`) |
  | `watch.ts` | `:954` (`dispatchOnce`), `:1974` (`pushOne`), `:549` (`lastCatalogueAt`, the E fact) |
  | `resolve.ts` | `:69` (the `notNewerThanFloor` definition), `:189` (the `rolledBack` return), `:191` (the `notNewerThanFloor` return) |
  | `inventory.ts` | `:423` |
  | `SettingsScreen.tsx` | `:199`, `:338`, `:227`, `:365`, `:457` (`NodeList`), `:136` |
  | `ccd/ccrc` | `_bak_prune` `:18178`, `_keep_ok` `:18164`, `_ver_lock_try` `:11022`, `_upd_lock` `:15198`, `_upd_backup` `:16504`, `_ver_gc update auto` `:13811`, `_upd_report` `:13832`, `_box_env_value` `:2547`, `_box_auth_path` `:2634`, gate line `:9948`, sweep lines `:17521` and `:17559`, `_upd_marker_unsigned` defined `:15614` (its `cmd_rollback` call `_upd_marker_unsigned && extra+=` is `:14351`), `UPD_FROM=` `:1687`, `_ver_keep_state` `:10559`, `_ver_flip_back` `:17157`, `no_gate` at `:13761` and `:13805`, `doctor_rc` `:14311` |
  | `ccrc-doctor-checks` | `:1270`, `:1755`, `:1244` |
  | line counts | README 3601, `api.ts` 8851, `ccrc-update.test.ts` 11525 |

  Also in this step:
  - **The citation corpus.**
    - Grep `session-hook.test.ts`'s corpus for any citation that QUOTES `shared/api.ts:4024` or `:4063`. The spec cites the range `api.ts:4017-4035` (spec `:299`), which is a range, not a quote. If a quote is found, Task 2 takes DEP-move-record-kind.
    - Grep the same corpus for line citations into `ccd/ccrc`, `ccd/ccrc-doctor-checks` and `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md` (see Global Constraints).
  - **C's premise.** Re-measure the Risk note's facts at the tip:
    - the v0.0.1–v0.0.8 release rows list `SHA256SUMS` (from the catalogue fixture or the public listing);
    - `_upd_fetch`'s `UPD_FAIL_PREFIX='provenance: '` (`:15830-15832`);
    - `isHalting` (`dispatch.ts:93-97`) and its existing pin (`update-dispatch.test.ts:104`).
  - **The kept copy.** Measure from `_ver_keep_state` (`:10559`) and `_ver_flip_back` (`:17157`) that a completed unsigned install is kept, and that `cmd_rollback`'s kept arm flips it with no provenance question. Record the answer in the wave-done report; D-3589 states it.
  - Record what the tip reads. Every later step anchors by the quoted text.
- [ ] **Step 2: Write the failing tests.**
  1. **`update-dispatch.test.ts`,** a describe titled `a rollback the node is known to refuse is refused before any lease (wave 8 item C)`. Each case is a `moveRefusal(view, { kind: 'rollback', target, source: 'request' }, releases, NO_HALT)` call:
     - (a) a `bundleListed: false` row, provenance `'verified'` → `'no-bundle'`;
     - (b) the same, `'unverified'` → `null` (the control that the word keys on provenance);
     - (c) the same, `'unknown'` → `null`;
     - (d) `bundleListed: true`, `'verified'` → `null`;
     - (e) no row → `'unknown-tag'`;
     - (f) `yanked: true, bundleListed: true`, `'verified'` → `null` (yanked stays permitted);
     - (g) an UPDATE to a `bundleListed: false` row → unchanged from main (its own arm; re-measure the expected word);
     - (h) a direct table over `rollbackTargetRefusal` for all 2×3 combinations, plus `undefined` provenance;
     - (i) `dispatchRefusalDetail('no-bundle', view, 'v0.0.8')` starts `no-bundle — the catalogue lists no provenance bundle for v0.0.8`, contains `ccrc rollback --to v0.0.8 flips to a kept copy if it keeps one` and `ccrc update --to v0.0.8 --downgrade --allow-unsigned`, and does NOT contain `ccrc rollback --to v0.0.8 --allow-unsigned`;
     - (j) the premise pin: cite `update-dispatch.test.ts:104`; nothing is added;
     - (k) the `reach` Record's new `'no-bundle'` row (Files above).

     The eleven-word array becomes twelve.
  2. **`update-dispatch.test.ts`, `planDispatch`'s fleet holds,** a describe titled `a standing fleet rollback the server refuses holds no server move (wave 8 item C)`. The views set `auto` directly:
     - (a) a fleet-role verified row with `requestedTag: 'v0.0.8', requestedKind: 'rollback'` over an unbundled v0.0.8 row, with `auto: 'channel'`, a resolved channel and a `desiredTag` of `v0.0.10` (auto ON for the fleet row too, as a fleet-wide intent gives it); and a server-role row with auto on and a `desiredTag` of `v0.0.10`. `plan.move?.nodeId` is the server node, and no `waiting-for-fleet` refusal is planned;
     - (b) the control: the same fleet request over a bundled row holds the server as `waiting-for-fleet`, exactly as main does, and the move is the fleet row's;
     - (c) the fleet row itself gets a planned `no-bundle` refusal (non-halting);
     - (d) the same fleet row with auto OFF, and a server row with a REQUESTED update (no auto): the server's request is the move. This isolates `fleetAsk`.
  3. **`single-definition.test.ts`:** `WORDS` gains `'no-bundle'`. It reds until Step 3, by the scan's own comparison.
  4. **`update-apply-routes.test.ts`:** `POST /api/updates/rollback {nodeId, to: 'v0.0.8'}` over a `bundleListed: false` catalogue row, for a node whose stored `provenance` is `'verified'`:
     - it answers `409 {ok: false, error: 'no-bundle', detail: /^no-bundle — /}`;
     - `coord.node(id).requestedTag` is null;
     - no op was sent (the harness's recorder is empty);
     - no row is halting.

     The route table at `:724` gains the word.
  5. **`update-converge.test.ts`:**
     - (a) a `requestNode(id, 'v0.0.8', 'rollback')` planted BEFORE the run (a pre-W8 standing request), over the same row and catalogue. `runDispatch` returns `outcome: null`, and `sent` has length 0. The row stays `idle`, with `updateDetail` starting `no-bundle — `. `plan.gate.haltedBy` is `[]`, and the request still stands (decision 7);
     - (b) that request on the FLEET row, plus a server row with an AUTO move: the server's op is sent in the same run. The harness's `fleetMeas` caps lack `UPDATE_GATE_CAP` and it sets no auto intent, so this case adds the cap to both rows and a FLEET-WIDE auto intent (auto on for both rows, so `fleetAuto` is exercised). Re-measure how the harness gives each row its `desiredTag`.
  6. **pwa `move-plan.test.ts`,** for `rollbackBlockers`:
     - two managed nodes on v0.0.10, one verified and one unverified, with a `bundleListed: false` v0.0.8 → one blocker, the verified node's label;
     - both unverified → `[]`;
     - a Mac on v0.0.10, verified → not named;
     - a non-tag `to` → `[]`.
  7. **pwa `settings-screen.test.tsx`:**
     - (a) a release row that reads Roll back, whose tag is unbundled, with a verified node: its button is `disabled`, and `getByTestId('settings-release-blocked')` names the node, contains `ccrc rollback --to v0.0.8` and `ccrc update --to v0.0.8 --downgrade --allow-unsigned`, and contains no `<`;
     - (b) the same with every node `'unverified'`: enabled, with no reason line;
     - (c) a node row whose `previousVersion` is that unbundled tag, on a verified node: Roll back is `disabled`, with the reason line;
     - (d) a bundled previous: enabled;
     - (e) a verified Mac (`os: 'darwin'`) whose `previousVersion` is the unbundled tag: no reason line, and no Roll back button (as main).
  8. **pwa `api.test.ts` `:1235`:** `updateErrorText(new ApiError(409, {error: 'no-bundle'}))` equals `noBundleRollbackText(null)`, which names `that release` and contains no `<`. The table is keyed, so a missing key is also a tsc error.

  Run:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/update-dispatch.test.ts test/update-apply-routes.test.ts test/update-converge.test.ts test/single-definition.test.ts
  cd pwa && ./node_modules/.bin/vitest run test/move-plan.test.ts test/settings-screen.test.tsx test/api.test.ts
  ```
  Expected: FAIL on the missing exports, word and props. 2(b) is green (it pins main). Record the counts.
- [ ] **Step 3: Implement,** as in Interfaces and code above. The tsc runs then surface every `DispatchRow` literal now missing `provenance` (the test helpers in `update-dispatch.test.ts`). Fix each in place, defaulting to `'verified'`.
- [ ] **Step 4: Run to verify they pass,** one command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/update-dispatch.test.ts test/update-apply-routes.test.ts test/update-converge.test.ts test/single-definition.test.ts
  cd server && ./node_modules/.bin/vitest run test/update-routes.test.ts test/update-auto-dispatch.test.ts test/update-killed-arms.test.ts test/box-token-census.test.ts
  cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
  cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
  cd pwa && ./node_modules/.bin/vitest run test/move-plan.test.ts test/settings-screen.test.tsx test/api.test.ts test/update-move-sheet.test.tsx
  cd pwa && ./node_modules/.bin/tsc --noEmit -p .; echo "exit $?"
  cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
  ```
  Expected: PASS, and `exit 0`. `wc -l README.md` still reads 3601.
- [ ] **Step 5: Mutation measurement,** per the table below. For each row: `cp` the file to `$SCRATCH`, mutate, run the named files, `cp` back, `cmp`. Record the counts and the assertion that fired.
- [ ] **Step 6: Commit.** `git add` the Files above and this plan, then `git commit -m "feat(update): a rollback a node is known to refuse is a 409 before any lease, holds no fleet move, and its row is not offered (wave 8 item C)"`.
  - This commit carries every minted definition of this plan.
  - The commit body states:
    - the precedence change (a recorded `refused-by-node` tag now reads `no-bundle`, and an ack no longer clears it);
    - the measured premise (the no-bundle class was non-halting at main);
    - the widened fleet holds (`fleetAsk` and `fleetAuto`, and main's `unknown-tag` stall released, ruled accepted);
    - the kept-copy measurement, and that the refusal is kept by ruling.

**Mutation table (Task 1):**

| # | Guard | Mutation | Must red | Run | Measured |
|---|---|---|---|---|---|
| M-C1 | the predicate's no-bundle arm | `shared/api.ts`: `rollbackTargetRefusal` returns `null` after the `undefined` check | 1(a)(h)(i)(k), 2(a)(c)(d), 4, 5(a)(b), 6, 7(a)(c) | server four + pwa three | pending |
| M-C2 | only a VERIFIED node is refused | `=== 'verified'` → `!== 'unverified'` | 1(c) and the `undefined` row of 1(h) | `update-dispatch` | pending |
| M-C3 | only an UNBUNDLED release is refused | drop `release.bundleListed !== true &&` | 1(d), 1(f), 2(b), and the existing rollback dispatch cases | `update-dispatch`, `update-converge` | pending |
| M-C4 | moveRefusal calls the predicate | the rollback arm reverted to `} else if (known === undefined) { return 'unknown-tag'; }` | 1(a)(k), 4, 5(a) | server three | pending |
| M-C5 | the release row obeys the blockers | `ReleaseItem`: `const blockers: RollbackBlocker[] = []` | 7(a) | `settings-screen` | pending |
| M-C6 | the node row obeys the predicate | `NodeItem`: `const previousRefusal: 'unknown-tag' \| 'no-bundle' \| null = null` | 7(c) | `settings-screen` | pending |
| M-C7 | ANY blocking node disables the fleet row | `rollbackBlockers` returns `[]` unless every named node blocks | 6's two-node case, and 7(a) with a mixed fleet | `move-plan`, `settings-screen` | pending |
| M-C8 | `fleetAsk` excludes a known-refused rollback | drop `fleetAsk`'s `&& !knownRefusedAsk(v)` | 2(a), 2(d), 5(b) | `update-dispatch`, `update-converge` | pending |
| M-C8b | `fleetAuto` excludes a known-refused rollback | drop `fleetAuto`'s `&& !knownRefusedAsk(v)` | 2(a), 5(b) (2(d) stays green: it has no auto; that is its control) | `update-dispatch`, `update-converge` | pending |
| M-C9 | the remedy names commands that exist | `REFUSAL_SENTENCE['no-bundle']`'s remedy → `ccrc rollback --to ${t} --allow-unsigned` | 1(i) | `update-dispatch` | pending |
| M-C10 | `skipWord` refuses `no-bundle` | drop the `r === 'no-bundle'` clause | pin: `tsc TS2322` against `MoveSkipWhy`; red (fix round 1 item 8 / review 196 F9, measured): `src/update/routes.ts(334,3): error TS2322: Type '"agent-predates-update-op" \| "floor-unread" \| "no-bundle" \| "no-detach-cap" \| "not-newer" \| "refused-by-node" \| "stamp-unread" \| "unknown-tag"' is not assignable to type 'MoveSkipWhy'.` | `tsc --noEmit` (CI's typecheck job) | measured |
| M-C11 | no reason line on a Darwin row | `NodeItem`: drop `darwin \|\|` from `previousRefusal` | 7(e) | `settings-screen` | pending |
| M-C12 | the PWA's no-bundle words carry the tag | `rollbackBlockedText` uses `moveSkipText(w)` for every word | 7(a)'s command and no-`<` assertions | `settings-screen` | pending |

### Task 2: Each move's source on record (item A)

**Files:**
- **Modify `shared/api.ts`:**
  - `:4024` becomes `kind: 'ask' | 'done' | 'merged' | 'mail' | 'run' | 'coord' | 'update' | 'unknown';`;
  - `:4063` gains `'update'` before `'unknown'`;
  - the docstring's `coord` paragraph (`:4016-4023`) gains one sentence, reflowed in place with no line added: "`update` is a move the update dispatcher leased (wave 8 item A) — about no session and no run, recorded and never pushed."
  - If Step 1 found a quoted citation, none of this is edited (DEP-move-record-kind).
- **Modify `server/src/update/dispatch.ts`:** `LeasedMoveResult`, `MoveFeedRecord` and `moveFeedRecord`, appended after `leaseHolder`.
- **Modify `server/src/update/converge.ts`:**
  - the `./dispatch.js` import gains `moveFeedRecord` and `type MoveFeedRecord`, in place;
  - `ConvergeDeps` gains `recordMove`;
  - `runDispatch`'s three returns after `const holder = …` go through one local `recorded`.
- **Modify `server/src/watch.ts`:**
  - `dispatchOnce` (`:954`) passes `recordMove`;
  - a private `recordMoveFeed` goes directly after `dispatchOnce`;
  - the import from `./update/dispatch.js` (or `converge.js`) gains `type MoveFeedRecord`.
- **Modify `pwa/src/screens/MailScreen.tsx` `:51-57`:** `KIND_WORD` gains `update: 'update'` and `KIND_GLYPH` gains `update: '⇡'`. Their `Record` types force both. They are the only other `Record` over NotifyKind.
- **Test harnesses.** Each `ConvergeDeps` literal gains `recordMove`:
  - `server/test/update-converge.test.ts` (`:126`): records into an array the case can read;
  - `update-auto-dispatch.test.ts` (`:120`): `null`;
  - `update-watchdog-revert.test.ts` (`:361`): `null`;
  - `updateKilledHarness.ts` (`:59`): `null`.

  `typecheck-tests` is the net for any this list misses (see Global Constraints).
- **Tests:** `update-dispatch.test.ts` (the `moveFeedRecord` table); `coord-store.test.ts` beside `:2794`; `pwa/test/mail-screen.test.tsx` beside `:226`; `update-auto-dispatch.test.ts`, a `FleetWatcher.dispatchNow` case beside `:350`.

**Code:**
```ts
// dispatch.ts, appended after leaseHolder:
// ── each move's own record (wave 8 item A) ─────────────────────────────────────────────────────────────────────

/** What a move that TOOK A LEASE got back, as `runDispatch` returns it: converge.ts's MoveOutcome arms after the
 *  answer satisfy this structurally (L1 never imports L3). */
export type LeasedMoveResult =
  | { result: 'accepted' | 'held'; detail: string }
  | { result: 'released'; to: 'idle' | 'failed'; detail: string }
  | { result: 'release-refused'; to: 'idle' | 'failed'; detail: string; why: string };
/** The audit row `watch.ts` writes as a `kind: 'update'` feed event. Every move's argv says `--from pwa` whatever
 *  asked for it (spec §10, unchanged), and settle, ack and later notes overwrite `updateDetail`, so this row is where
 *  an auto move stays told from a requested one. The SOURCE comes from `move.source`, never from `move.detail`:
 *  `UNVERSIONED_DETAIL` carries no source word. */
export interface MoveFeedRecord { title: string; body: string }
/** `null` for an idle release (busy, not-queued, version skew, a link that never reached the node): the node did not
 *  move, the row's own updateDetail says why, and the same answer repeats every dispatch run while the condition
 *  stands — a row per run would evict the whole feed. A refused release is recorded, and never worded "released". */
export function moveFeedRecord(move: DispatchMove, label: string, r: LeasedMoveResult): MoveFeedRecord | null {
  if (r.result === 'released' && r.to === 'idle') return null;
  const title = `update ${label}: ${move.source === 'auto' ? 'auto' : 'requested'} ${move.kind} to ${move.target}`;
  const what = r.result === 'accepted' || r.result === 'held' ? 'lease held'
    : r.result === 'released' ? `released ${r.to}`
    : `release refused (${r.why}) — the answer was`;
  return { title, body: `${move.detail} — ${what}: ${r.detail}`.slice(0, UPDATE_OP_DETAIL_MAX) };
}
```
```ts
// converge.ts ConvergeDeps, after onAccepted:
  /** Wave 8 item A: writes a move's audit row (`moveFeedRecord`) where the operator reads it; `watch.ts` binds the
   *  feed. REQUIRED and nullable, `runLocal`'s idiom, so every caller decides; `null` records nothing. Called at most
   *  once per move that took a lease, AFTER the answer's lease write and after `onAccepted`, synchronously; a throw
   *  is caught here. */
  recordMove: ((r: MoveFeedRecord) => void) | null;

// runDispatch, directly after `const holder = leaseHolder(…) ?? move.nodeId;`:
  // Wave 8 item A: the move's audit row, AFTER the answer's lease write below (and after onAccepted's inventory
  // trigger in the hold arm), in this same synchronous stretch — nothing is added between the acquire and the send
  // (D-3377). It can never change the run: a port that throws is warned about, and the outcome stands.
  const recorded = (outcome: Extract<MoveOutcome, { result: 'accepted' | 'held' | 'released' | 'release-refused' }>): DispatchRunResult => {
    if (deps.recordMove !== null) {
      try {
        const rec = moveFeedRecord(move, view.row.label, outcome);
        if (rec !== null) deps.recordMove(rec);
      } catch (e) {
        console.warn(`ccrc-server: the update move's feed record was not written (${e instanceof Error ? e.message : String(e)}) — the move stands; its audit row is lost`);
      }
    }
    return done(outcome);
  };
// …and the three returns that follow become `return recorded({ … });` (the hold return, the release-refused
// return, the released return). The not-sent and acquire-refused returns above are untouched.
```
```ts
// watch.ts dispatchOnce's runDispatch literal, after onAccepted:
      recordMove: (r) => { this.recordMoveFeed(r); },

// watch.ts, directly after dispatchOnce:
  /** Wave 8 item A: a move's audit row, through pushOne's own record path (the ring, its flush, and the durable feed
   *  archive behind its guarded `recordFeedEvent`). Never a push (`recordOnly`), never gated on presence
   *  (`recordAlways`); about no session and no run. It decides nothing. */
  private recordMoveFeed(r: MoveFeedRecord): void {
    this.pushOne({
      kind: 'update', sessionId: '', project: '', title: r.title, body: r.body, runId: null,
      recordAlways: true, recordOnly: true,
    }, this.activeProjects);
  }
```
Measure two facts and state both in the wave-done report:
- `pushOne`'s record path writes nothing when no `notifyLog` is configured. The archive is written only when `log && recorded` (`watch.ts:2031-2043`), since the feed mirrors the ring by design.
- Production wires a `notifyLog` (`index.ts`).

- [ ] **Step 1: Write the failing tests.**
  1. **`update-converge.test.ts`,** a describe titled `a move the node took leaves one feed record naming its source (wave 8 item A)`. The harness's `recordMove` pushes into `records`. The harness's `fleetMeas` caps lack `UPDATE_GATE_CAP` and it sets no auto intent, so the AUTO cases add the cap and a NODE-scoped auto intent for the fleet node (a fleet-wide intent would also turn on the server's auto). Cases:
     - (a) an auto link update, accepted: exactly one record, whose title starts `update fleet: auto update to v0.0.10` (the harness's labels);
     - (b) a requested rollback: `requested rollback`;
     - (c) an AUTO update from an UNVERSIONED node, whose `move.detail` is `UNVERSIONED_DETAIL`: the title says `auto`;
     - (d) a not-sent move (`LINK_DOWN_DETAIL`), and an acquire-refused one: zero records each. The real store cannot refuse the acquire in the synchronous stretch, so the acquire-refused case uses a `ConvergeStore` whose `dispatchNode` answers `{ ok: false, why: 'busy', heldBy: 'other' }`;
     - (e) a D-3555 transport hold: the body contains `lease held: link failed mid-op`;
     - (f) a spawn-failed release: the body contains `released failed: spawn-failed`;
     - (g) a `recordMove` that throws: `runDispatch` resolves with the same `outcome` as the null-port run over the same fixture, the lease row's columns are equal, `sent` has length 1, and one `ccrc-server:` warning is logged (spy on `console.warn`);
     - (h) in the hold arm, a recording `onAccepted` and `recordMove` into one shared log: `onAccepted` comes first;
     - (i) a node answering `busy` on every run: five `runDispatch` runs write ZERO records, each run's `sent` has length 1, and the row's `updateDetail` starts `busy — `;
     - (j) a release refused: a `ConvergeStore` whose `releaseLease` answers `{ ok: false, why: 'not-busy', state: 'idle' }`, over a spawn-failed answer: one record whose body contains `release refused (not-busy) — the answer was: spawn-failed` and does not contain `released `.
  2. **`update-auto-dispatch.test.ts`:** `FleetWatcher.dispatchNow()` over a real `CoordStore` and `NotifyLog`, with a recording `push` dep, on an auto move that is accepted:
     - `coord.feedEvents(10)` holds exactly one `kind: 'update'` row, with `sessionId: ''`, `runId: null`, and a title containing `auto`;
     - the recording `push.notify` was never called.

     A second case replaces the coord's `recordFeedEvent` with one that throws. The run still returns its result, and `recordFeedEvent failed` is warned once (`pushOne`'s existing guard).
  3. **`coord-store.test.ts`:** `recordFeedEvent('epoch-1', {…, kind: 'update', …})` reads back through `feedEvents` as `kind: 'update'`, not `'unknown'`.
  4. **`update-dispatch.test.ts`,** the `moveFeedRecord` table:
     - auto and request titles;
     - the unversioned row;
     - accepted, held, released-failed and release-refused bodies;
     - a released-idle result → `null`;
     - a 500-character `detail`: the body is at most `UPDATE_OP_DETAIL_MAX` long and starts with the full head.
  5. **pwa `mail-screen.test.tsx`:** an `update` event renders the word `update` and the glyph `⇡`.

  Run each file. Expected: FAIL (a missing export, a missing field, kind `unknown`). Record the counts.
- [ ] **Step 2: Implement,** as above. Every `ConvergeDeps` literal found by `tsc --noEmit` and `typecheck-tests` gains `recordMove`.
- [ ] **Step 3: Run,** one command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/update-converge.test.ts test/update-auto-dispatch.test.ts test/update-dispatch.test.ts test/coord-store.test.ts
  cd server && ./node_modules/.bin/vitest run test/update-killed-arms.test.ts test/update-lease-holder.test.ts test/update-local-spawn-throw.test.ts test/update-op-answer.test.ts test/update-watchdog-revert.test.ts
  cd server && ./node_modules/.bin/vitest run test/coord-caps-route.test.ts test/push-copy.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts
  cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
  cd pwa && ./node_modules/.bin/vitest run test/mail-screen.test.tsx test/feed.test.ts
  cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
  ```
- [ ] **Step 4: Mutation measurement,** per the table.
- [ ] **Step 5: Commit.** `git add` the Files above, then `git commit -m "feat(update): each move the node took leaves one feed row naming its source (wave 8 item A)"`. The commit body states that an idle release records nothing, and why.

**Mutation table (Task 2):**

| # | Guard | Mutation | Must red | Run | Measured |
|---|---|---|---|---|---|
| M-A1 | runDispatch records | `recorded` never calls `deps.recordMove` | A1 (a)(b)(c)(e)(f)(h)(j), A2 | `update-converge`, `update-auto-dispatch` | pending |
| M-A2 | only moves that took a lease record | directly before the not-sent return, insert `deps.recordMove?.({ title: 'update mutant', body: '' });` (a literal; `action` is not yet declared there) | A1 (d) | `update-converge` | pending |
| M-A3 | the source is `move.source` | `move.source === 'auto'` → `move.detail.startsWith('auto')` | A1 (c), A4's unversioned row | `update-converge`, `update-dispatch` | pending |
| M-A4 | a throwing port never changes the run | drop the L3 `try`/`catch` (call bare) | A1 (g) | `update-converge` | pending |
| M-A5 | watch.ts binds the port | `recordMove: null` in `dispatchOnce` | A2 | `update-auto-dispatch` | pending |
| M-A6 | the row is never a push | drop `recordOnly: true` in `recordMoveFeed` | A2 (`push.notify` called) | `update-auto-dispatch` | pending |
| M-A7 | the kind reads back | drop `'update'` from `NOTIFY_KINDS` only | A3 | `coord-store` | pending |
| M-A8 | the record comes after the send | directly after `const got = store.dispatchNode(…)`, insert `if (deps.recordMove !== null) deps.recordMove({ title: 'update mutant', body: '' });` with no try | A1 (g): `runDispatch` REJECTS (the throw escapes before the send) and `sent` has length 0. Assert both | `update-converge` | pending |
| M-A9 | an idle release records nothing | drop `moveFeedRecord`'s `if (r.result === 'released' && r.to === 'idle') return null;` | A1 (i), A4's released-idle row | `update-converge`, `update-dispatch` | pending |
| M-A10 | a refused release is never worded "released" | the `release-refused` arm's words → `` `released ${r.to}` `` | A1 (j), A4's release-refused row | `update-converge`, `update-dispatch` | pending |

### Task 3: The Settings wording (item F)

**Files:**
- **Modify `server/src/update/resolve.ts`:**
  - `RESOLVE_DETAIL` gains `atNewest`, after `notNewerThanFloor`;
  - `:65`'s docstring "The first four are §9's text verbatim." gains "; `atNewest` is wave 8's (item F1)";
  - one branch in the unpinned path, placed directly BEFORE the `rolledBack` return (re-measure that `floor` and `newest` are in scope there).
- **Modify `shared/api.ts`:** `settledDoneDetail`, appended after `rollbackTargetRefusal`.
- **Modify `server/src/update/inventory.ts` `:423`:** `` detail: `done: ${r.target}` `` → `detail: settledDoneDetail(r.target)`, with the `shared/api.js` import gaining it in place.
- **Modify `pwa/src/fleet/movePlan.ts`:** `rollbackHowText`, after `moveHeadline`.
- **Modify `pwa/src/fleet/UpdateMoveSheet.tsx`:** the import gains `rollbackHowText`, and one `<p>` goes after the list.
- **Modify `pwa/src/screens/SettingsScreen.tsx`:**
  - `releaseDirection` gains its `'running'` arm;
  - `releaseRunningText`;
  - `ReleaseItem`'s running render;
  - `resolveDetailLine`, where `NodeItem` shows `resolveDetail`;
  - `NodeList` (`:457`) and `NodeItem` (`:365`) gain a `catalogueLastOkAt: number | null` prop. The screen computes it once where it renders `NodeList` (`:792`), from `view.catalogue.lastOkAt`, as `catalogueLine` does at `:136`: an unplaceable instant (`isPlaceableInstant`) reads as `null`;
  - `finishedLine`, and `NodeItem`'s two state lines;
  - the imports gain `settledDoneDetail`;
  - the block comment's "Nothing here says "up to date": a node on its desired tag simply shows no desired." (`:281-282`) becomes "Nothing here says "up to date": a node on the newest eligible tag shows the resolver's own `atNewest` sentence.", in place and line-neutral.
- **Test `server/test/update-resolve.test.ts`:**
  - `:228-230` rewritten, so `at` now expects `RESOLVE_DETAIL.atNewest('v0.0.10', 'stable')`;
  - cases added;
  - `:37-38`'s verbatim case stays green, unedited.
- **Test `server/test/update-projection.test.ts` `:200`:** the fleet node runs v0.0.10 at floor v0.0.10, and v0.0.11 is refused by this node, so its newest eligible tag is v0.0.10. The expectation `RESOLVE_DETAIL.notNewerThanFloor('v0.0.10', 'v0.0.10')` becomes `RESOLVE_DETAIL.atNewest('v0.0.10', <that fixture's channel>)` (re-measure the channel; `stable` expected). Named in the commit body.
- **Test `pwa/test/settings-screen.test.tsx`:**
  - `:655`: `releaseDirection('v0.0.10', both10)` → `'running'`;
  - `:775-792`'s button lists re-measured;
  - `:1021-1032` (`nodeStateLine`) unedited;
  - new cases beside the three existing "up to date" pins.
- **Test:** `pwa/test/update-move-sheet.test.tsx`, `pwa/test/move-plan.test.ts`.
- **Run unedited:** `server/test/update-inventory.test.ts`. Its `done: v…` assertions must stay byte-identical.

**Code:**
```ts
// resolve.ts RESOLVE_DETAIL, after notNewerThanFloor:
  // Wave 8 item F1: the converged node, as measured facts. Not the phrase "up to date": §9 forbids it for a NULL
  // desiredTag, and this function cannot see whether the catalogue has answered since start — so it names the
  // channel and the catalogue "as last read", and the PWA qualifies it while lastOkAt is null or the node is
  // unreachable. No "nothing newer" clause: a newer release this node refused, or one on another channel, may exist.
  atNewest: (current: string, channel: UpdateChannel): string =>
    `runs ${current}, the newest eligible release on ${channel} in the catalogue as last read`,

// resolveOnChannel, directly BEFORE the rolledBack return (so `floor === current` is load-bearing: a node rolled
// back onto the newest after a yank has floor > current and must still read rolledBack):
  if (current !== null && current === newest && floor === current) {
    return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.atNewest(current, channel) };
  }
```
- `rolledBack` still answers whenever the floor is newer than current.
- `notNewerThanFloor` stays for a demoted, yanked or above-catalogue node.
- The pinned path is untouched.
- Confirm `UpdateChannel` is already imported (`resolve.ts:14`), so no new import specifier is needed.

```ts
// shared/api.ts, appended after rollbackTargetRefusal:
/** Wave 8 item F4: the words a lease settles with when its node reports `done` of the tag and runs it. Spelled
 *  ONCE: the inventory sweep writes them (server/src/update/inventory.ts) and the PWA recognises them to show a
 *  finished move as one line (pwa/src/screens/SettingsScreen.tsx). */
export function settledDoneDetail(tag: string): string {
  return `done: ${tag}`;
}
```
```ts
// movePlan.ts, after moveHeadline:
/** Wave 8 item F3: how a rollback happens, said on every rollback sheet with a node in it. True on every
 *  cmd_rollback path: an intact kept copy flips; otherwise a re-install downloads the tag. Either can be refused
 *  (by the server before any spawn — a 409 shown in this sheet or a notice — or by the node, on its row) or can fail
 *  (a gate that fails is not restored, `_upd_rollback_no_restore`; a kept spine that does not complete). It makes no
 *  per-node claim: the kept state is not inventoried. */
export function rollbackHowText(to: string): string {
  return `A rollback flips each node to its kept copy of ${to} when that copy is intact; otherwise the node downloads ${to} and re-installs it. Either way it can be refused or can fail, and the reason is shown: here or in a notice when the server refuses the move, and on the node's row when the node does.`;
}
```
```tsx
// UpdateMoveSheet.tsx, directly after the list/empty conditional:
        {plan.intent.direction === 'rollback' && lines.length > 0 && (
          <p className="qc-consequence">{rollbackHowText(plan.intent.to)}</p>
        )}
```
```tsx
// SettingsScreen.tsx:
export function releaseDirection(tag: string, nodes: readonly NodeWire[]): 'install' | 'rollback' | 'running' {
  // D-3410: over the nodes a move can name — planMove's own filter (isManagedNode), so a Mac lagging behind
  // never turns a Roll back row into Install while the sheet would move the Linux nodes.
  const managed = nodes.filter(isManagedNode);
  if (!isReleaseTag(tag) || managed.length === 0) return 'install';
  // Wave 8 item F2: the release every managed node runs (by last measurement) is a state, not a move.
  if (managed.every((n) => nodeVersion(n) === tag)) return 'running';
  return managed.every((n) => {
    const v = nodeVersion(n);
    return v !== null && isNewerTag(v, tag);
  }) ? 'rollback' : 'install';
}

/** Wave 8 item F2: the running row's words, naming the set they measured: the managed nodes, how many of those are
 *  unreachable (their version is the last measurement), and a macOS node on another version (not moved from here). */
export function releaseRunningText(tag: string, nodes: readonly NodeWire[]): string {
  const managed = nodes.filter(isManagedNode);
  const away = managed.filter((n) => n.reachable === false).length;
  const macOther = nodes.some((n) => !isManagedNode(n) && nodeVersion(n) !== tag);
  let s = 'Running on every managed node';
  if (away > 0) s += ` — ${away} of them not reachable, as last measured`;
  if (macOther) s += ' · macOS nodes are not moved from here';
  return s;
}
// ReleaseItem: `intent` and the blockers are built only when direction !== 'running'; the actions div renders
//   {direction === 'running'
//     ? <span className="settings-release-running">{releaseRunningText(r.tag, nodes)}</span>
//     : <button …>{direction === 'rollback' ? 'Roll back' : 'Install'}</button>}

/** Wave 8 item F1: a node's resolveDetail, qualified when it cannot be read as current (spec :1144): the catalogue
 *  has not answered since the server started (or its instant cannot be placed — the caller passes null then), or
 *  the node is unreachable. */
export function resolveDetailLine(detail: string, n: NodeWire, catalogueLastOkAt: number | null): string {
  if (catalogueLastOkAt === null) return `${detail} (the catalogue has not answered since the server started)`;
  if (n.reachable === false) return `${detail} (this node is not reachable; last measured)`;
  return detail;
}

/** Wave 8 item F4: ONE dated line for a finished move, or null (the row then keeps its two lines). Only when the
 *  lease is settled, the report is a finished phase of a tag that IS the lease's target (identity by tag, D-3405),
 *  and `update.detail` is exactly what the settle wrote for that report: settledDoneDetail(tag) for done,
 *  `report.detail ?? report.phase` for failed/reverted (inventory.ts). Anything else (an ack, a later refusal
 *  note, `met:`, a deadline) keeps its own line. The time is the NODE's clock (report.updatedAt). */
export function finishedLine(n: NodeWire, now: number): string | null {
  const state = n.update?.state;
  if (typeof state !== 'string' || !(SETTLED_UPDATE_STATES as readonly string[]).includes(state)) return null;
  const r: unknown = n.report;
  if (typeof r !== 'object' || r === null) return null;
  const { phase, target, detail, updatedAt } = r as { phase?: unknown; target?: unknown; detail?: unknown; updatedAt?: unknown };
  if (phase !== 'done' && phase !== 'failed' && phase !== 'reverted') return null;
  if (!isReleaseTag(target) || target !== n.update.target) return null;
  const settled = phase === 'done' ? settledDoneDetail(target) : (typeof detail === 'string' ? detail : phase);
  if (n.update.detail !== settled) return null;
  const when = typeof updatedAt === 'number' ? dayClock(updatedAt, now) : '—';
  const said = typeof detail === 'string' && detail !== '' ? ` — ${detail}` : '';
  const lead = state === phase ? '' : `${state} — `;
  return `${lead}${phase} ${target} · ${when}${said}`;
}
// NodeItem: `const finished = finishedLine(n, now);` then
//   {finished !== null
//     ? <p className="settings-node-detail" data-testid="settings-node-finished">{finished}</p>
//     : <>{/* the two existing lines, unchanged */}</>}
// and wherever it renders resolveDetail: resolveDetailLine(n.resolveDetail, n, catalogueLastOkAt).
// The screen, where it renders NodeList (`:792`):
//   const catalogueLastOkAt = view.catalogue.lastOkAt !== null && isPlaceableInstant(view.catalogue.lastOkAt)
//     ? view.catalogue.lastOkAt : null;
```

- [ ] **Step 1: Re-measure.**
  - `grep -rn "\`done: \${" server/src` must find only `inventory.ts:423` (and none after Step 3).
  - Re-grep every suite (`server/test`, `pwa/test`) for `notNewerThanFloor(` where current, floor and newest are equal; each becomes `atNewest` and is named in the commit body. At `a742eb6a` these are `update-resolve.test.ts:230` and `update-projection.test.ts:200`.
  - Grep README and the spec for any quote of `newest eligible` or `Nothing to move — ` wording, and keep any README edit line-neutral.
  - Measure where `SettingsScreen` reads `catalogue.lastOkAt` (`:136`, `:704`) and renders `resolveDetail`, and that `NodeList`/`NodeItem` take no catalogue prop at main (`:365`, `:457`).
- [ ] **Step 2: Write the failing tests.**
  1. **`update-resolve.test.ts`:**
     - `at` (`:228-230`) expects `atNewest('v0.0.10', 'stable')`;
     - controls keep `notNewerThanFloor`: `above` (`:231-233`), demoted (`:236-243`), yanked (`:245-250`);
     - NEW: rolled back onto the newest after a yank (current v0.0.9 = newest, floor v0.0.10) keeps `rolledBack`;
     - NEW: on `dev`, the sentence names `dev` and not `stable`, and on `stable` it names `stable` and not `dev`;
     - NEW: `atNewest`'s text does not match `/up to date/i` or `/nothing newer/i`, and contains `as last read`.
  2. **`update-projection.test.ts` `:200`:** re-based to `atNewest` (Files above).
  3. **pwa `settings-screen.test.tsx`:**
     - **`releaseDirection`:**
       - all managed nodes on v0.0.10 → `'running'`;
       - v0.0.10 and v0.0.9 → `'install'`;
       - v0.0.10 with a Mac on v0.0.9 → `'running'`;
       - none managed → `'install'`;
       - a non-tag → `'install'`.
     - **`releaseRunningText`:**
       - all reachable, no Mac → exactly `Running on every managed node`;
       - one unreachable → contains `1 of them not reachable, as last measured`;
       - a Mac on another version → contains `macOS nodes are not moved from here`.
     - **The running release row:**
       - it renders the running text and no Install or Roll back button, and the other rows are unchanged;
       - with the lagging Mac, the render names macOS;
       - a running row whose tag is unbundled, on a verified node, shows neither a button nor a `settings-release-blocked` line.
     - **`finishedLine`:**
       - a `done` report of the lease's target, with `update.detail` `done: v0.0.49`, gives one line containing `done v0.0.49` and `dayClock(T, now)`;
       - a `failed` report whose detail equals `update.detail` gives one line with the detail, and not `failed — failed`;
       - each control is `null`: `update.detail` holds the ack's words; a FAILED report whose detail equals `update.detail` but whose target differs from `update.target`; a busy lease; an in-flight phase; no report.
     - **The render:** exactly one `settings-node-detail` state line for a finished row, and two for the ack case.
     - **The node row that is up to date:**
       - with `lastOkAt` set and placeable and the node reachable, it shows the `atNewest` sentence unqualified;
       - with `lastOkAt` null, the line ends `(the catalogue has not answered since the server started)`;
       - with an unplaceable `lastOkAt`, the same qualified line;
       - unreachable, it ends `(this node is not reachable; last measured)`;
       - in every case `queryByText(/up to date/i)` is null.
  4. **pwa `update-move-sheet.test.tsx`:**
     - a node rollback and a fleet rollback render `rollbackHowText(to)`;
     - an update plan does not;
     - an empty rollback plan does not.
  5. **pwa `move-plan.test.ts`:** `rollbackHowText('v0.0.8')` equals the exact sentence, which contains `kept copy of v0.0.8`, `downloads v0.0.8 and re-installs it` and `it can be refused or can fail`.

  Run. Expected: FAIL. Record the counts.
- [ ] **Step 3: Implement,** as above.
- [ ] **Step 4: Run,** one command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/update-resolve.test.ts test/update-inventory.test.ts test/update-converge.test.ts test/update-apply-routes.test.ts test/update-projection.test.ts test/update-auto-dispatch.test.ts
  cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
  cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
  cd pwa && ./node_modules/.bin/vitest run test/settings-screen.test.tsx test/update-move-sheet.test.tsx test/move-plan.test.ts
  cd pwa && ./node_modules/.bin/tsc --noEmit -p .; echo "exit $?"
  ```
  `update-apply-routes` may assert the no-desired 409's old detail for a node that is up to date. If it does, re-measure that assertion to `atNewest` and name the change in the commit body.
- [ ] **Step 5: Mutation measurement,** per the table.
- [ ] **Step 6: Commit.** `git commit -m "feat(update): a converged node, the running release, the rollback's flip-or-download and one dated finished line (wave 8 item F)"`. The commit body names each re-based `notNewerThanFloor` expectation.

**Mutation table (Task 3):**

| # | Guard | Mutation | Must red | Run | Measured |
|---|---|---|---|---|---|
| M-F1a | the branch for a node that is up to date | delete it | 1 `at`, 2 | `update-resolve`, `update-projection` | pending |
| M-F1b | only at its own floor | drop `&& floor === current` (the branch sits before `rolledBack`, so this is load-bearing) | the rolled-back-onto-newest case | `update-resolve` | pending |
| M-F1c | only the newest itself | `current === newest` → `!isNewerTag(newest, current)` | `above` | `update-resolve` | pending |
| M-F1d | never "up to date" | `atNewest` text → `` `${current} is up to date on ${channel}` `` | 1's `/up to date/i` case (the pwa row's text is a hand copy, so no pwa pin is claimed) | `update-resolve` | pending |
| M-F1e | the PWA qualifies an unmeasured basis | `resolveDetailLine` returns `detail` always | 3's `lastOkAt`-null, unplaceable and unreachable rows | `settings-screen` | pending |
| M-F1f | an unplaceable `lastOkAt` is null | pass `view.catalogue.lastOkAt` raw as `catalogueLastOkAt` | 3's unplaceable row | `settings-screen` | pending |
| M-F1g | the sentence is channel-scoped | `atNewest` text → `` `runs ${current}, the newest eligible release in the catalogue as last read` `` | 1's `dev`/`stable` case | `update-resolve` | pending |
| M-F2a | the running arm | delete it | `releaseDirection` all-on-v0.0.10, the running row | `settings-screen` | pending |
| M-F2b | EVERY node runs it | `managed.every(… === tag)` → `managed.some(…)` | the v0.0.10/v0.0.9 case | `settings-screen` | pending |
| M-F2c | no button on the running row | render the button when `'running'` too | the running-row case | `settings-screen` | pending |
| M-F2d | macOS left out of the direction | `managed` → `nodes` in the running test | the Mac case | `settings-screen` | pending |
| M-F2e | the words name what they measured | `releaseRunningText` returns `'Running on every node'` | the unreachable and Mac text cases | `settings-screen` | pending |
| M-F3a | the sentence renders | delete the `<p>` | 4's two rollback cases | `update-move-sheet` | pending |
| M-F3b | rollback only | drop `plan.intent.direction === 'rollback' &&` (render with `moveTarget`) | 4's update case | `update-move-sheet` | pending |
| M-F3c | not on an empty plan | drop `lines.length > 0 &&` | 4's empty case | `update-move-sheet` | pending |
| M-F3d | refusal and failure are named | drop the sentence `Either way it can be refused or can fail, …` | 5 | `move-plan` | pending |
| M-F4a | the finished line | `finishedLine` returns `null` always | the done and failed rows, the one-line render | `settings-screen` | pending |
| M-F4b | identity by tag | drop `target !== n.update.target` | the failed-report target-mismatch control (its detail equals `update.detail`, so only the target test refuses it) | `settings-screen` | pending |
| M-F4c | exactly the settle's words | drop the `n.update.detail !== settled` return | the ack control, the two-line render | `settings-screen` | pending |
| M-F4d | dated | drop `· ${when}` | the done row's `dayClock` assertion | `settings-screen` | pending |
| M-F4e | one spelling of the settle | `settledDoneDetail` returns `` `done ${tag}` `` | `update-inventory`'s and `update-converge`'s `done: v…` assertions | `update-inventory`, `update-converge` | pending |
| M-F4f | no doubled word | `lead` always `` `${state} — ` `` | the `not failed — failed` assertion only (a done settle leaves state `idle`, so the done line's lead is `idle — ` either way) | `settings-screen` | pending |

### Task 4: `ccrc update` and `ccrc rollback` prune `~/ccrc-backups` after a completed run (item B)

**Files:**
- **Modify `ccd/ccrc`:**
  - `BAK_TS_PAT`, at file scope directly after `BOX_BACKUP_ROOT="$HOME/ccrc-backups"` (`:1464`).
  - `BAK_DIRS=()` and `UPD_BAK_FLOOR=""`, at file scope directly after `UPD_BACKUP_DIR=""` (`:1675`), each with a one-line comment.
  - `_upd_lock`: one line directly before its FINAL `  return 0` (`:15245`), NOT on any of its three early returns (`[ -n "$UPD_LOCK_FD" ] && return 0`, `[ "$UPD_LOCK_INHERITED" -eq 1 ] && return 0`, and the restore-child probe arm's `UPD_LOCK_INHERITED=1; return 0`).
  - **`cmd_update`.** The quoted line `  if [ "$no_gate" -eq 1 ]; then` occurs TWICE in `cmd_update` (at `:13761`, the gate-skip block, and at `:13805`, the migration block). Do not anchor on it. Anchor on the unique `    _ver_gc update auto || :   # W6 Task 5: …` (`:13811`):
    - `gate_passed=1` goes directly after that line;
    - `local gate_passed=0` goes directly above the `if` that encloses that line (the one at `:13805`), verified by reading the enclosing block;
    - the call goes directly after `  _upd_report "$old_desc" "$old_version"` (`:13832`).
  - **`cmd_rollback`'s flip arm:** `        _bak_gc rollback || :` directly AFTER `        local doctor_rc="$VER_SPINE_RC"` (`:14311`), so nothing `_bak_gc` calls can clobber `VER_SPINE_RC` before the exit-3 decision reads it.
  - **`cmd_backup`'s header** (`:18128-18134`): "What this verb adds is the pruning `cmd_update` deliberately does not do: …" becomes "What this verb adds is a prune on EVERY run: `cmd_update` and `cmd_rollback` prune too, but only after a run that completed with its gate passed (`_bak_gc`, wave 8 item B) — …", keeping the rest of the sentence. Its body is unchanged.
  - `_bak_list`, new, and `_bak_prune` (`:18178`) rewritten onto it, with its output and die sentences byte-identical.
  - `_bak_gc`, new, directly after `_bak_prune`.
  - **Usage.** The `update` paragraph (`:1894-1941`; `3; --no-gate skips it.` is at `:1934`, and the paragraph runs to `:1941`) gains one sentence, and the `rollback` paragraph (`:1942-1954`) gains one clause, both reflowed. The update sentence: "After a passed gate and a finished sweep, ~/ccrc-backups is pruned to the newest CCRC_BACKUP_KEEP (default 10) timestamped backups, never this run's own. CCRC_BACKUP_KEEP is read from the process environment only: a console-driven move runs under the user manager's environment, which carries none unless it was set there, so the default 10 applies." The rollback clause: "a flip prunes the same way after its sweep".
- **Modify `README.md`, line-neutral:**
  - `:491-492`: "the supervisor sweep behind its mandatory `KillMode=process` preflight; then the from→to report." becomes "…preflight; then the from→to report, and, after a passed gate and a finished sweep, the `~/ccrc-backups` prune (`CCRC_BACKUP_KEEP` from the process environment, default 10).", reflowed across `:488-492`;
  - `:716-718`: `ccrc backup`'s sentence gains ", as update and rollback do after a passed gate", reflowed.
- **Test `server/test/ccrc-update.test.ts`:**
  - a new describe appended after the file's LAST `});`. At `a742eb6a` the file is 11525 lines and its last describe is the killed-flip one at `:11198`.
  - one file knob in `updateEnv`'s `systemctl` stub `try-restart)` arm (`:361-376`), beside `fixture-sweep-linger`: `fixture-sweep-hold-lock` spawns `flock "$HOME/.ccrc/update.lock" sleep 30 </dev/null >/dev/null 2>&1 &`, writes the holder's pid to `$HOME/sweep-lock-holder-pid`, and waits AT MOST 50 × 0.1 s until `flock -n` on the lock answers 1. If the bound is spent, it prints `fixture systemctl: the lock holder never took ~/.ccrc/update.lock` on stderr and exits 1, which fails the case loudly. `fixture-try-restart-fail` (exit 1) is added beside it.
  - a `date` stub, planted only by the ONE case that needs it (P3).
  - The new describe gets its OWN `holders`/`lingerers` array and `afterEach` kill. The lock describe's `holdLock`, `holders` and `lingerers` (`:4141`, `:4165-4167`) are describe-local and are copied as a pattern, not referenced.
- **Run, not edited:**
  - `ccrc-uninstall.test.ts`: its `ccrc backup` cases (`:1045`, `:1115`) pin `_bak_prune`'s die sentence (`— nothing was pruned`, `:1129`, `:1144`, `:1149`) and directory survival. No test at `a742eb6a` pins its `backup: pruned …` echo; P17 below does;
  - `ccrc-cli.test.ts`: it pins the rollback usage paragraph's first line (`:212`), which this task reflows (`ccrc-update.test.ts:5903` pins it too);
  - `ccrc-versioned-audit.test.ts`, `deploy-verify.test.ts`, `runbook-holds.test.ts`, `ccrc-install.test.ts`, `single-definition.test.ts`, `ownership.test.ts`.

**Code:**
```bash
# beside BOX_BACKUP_ROOT:
# The ONE shape of a timestamped backup directory's name: `_upd_backup`'s `date +%Y%m%d-%H%M%S`. A GLOB, expanded
# unquoted by `_bak_list` alone (deploy.sh's `prune_backups` keeps its own box-side copy of the same glob).
BAK_TS_PAT='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'

# beside UPD_BACKUP_DIR:
BAK_DIRS=()        # `_bak_list`'s out-param: the timestamped backup dirs, oldest first
UPD_BAK_FLOOR=""   # the second this run first held ~/.ccrc/update.lock (`_upd_lock`); `_bak_gc` keeps every dir named at or after it
```
```bash
# _upd_lock, directly before its final `  return 0`:
  # Wave 8 item B: the second this run first held the lock. `_bak_gc` never prunes a backup named at or after it:
  # this run's own, its spine installers', and anything a writer on this box's clock started since. Set once per
  # process (cmd_rollback's earlier lock wins over cmd_update's in-process re-entry, which returns above).
  [ -n "$UPD_BAK_FLOOR" ] || UPD_BAK_FLOOR="$(date +%Y%m%d-%H%M%S)"
```
```bash
# ── _bak_list — the timestamped backup dirs, oldest first (wave 8 item B) ──
# One listing for both pruners. Lexical glob order IS chronological for this fixed-width shape (a DST fall-back on
# a local-time box is the stated exception). nullglob is saved and restored exactly as `_bak_prune` always did;
# hand-made siblings never match.
_bak_list() {
  BAK_DIRS=()
  local had_nullglob=0 d
  shopt -q nullglob && had_nullglob=1
  shopt -s nullglob
  for d in "$BOX_BACKUP_ROOT"/$BAK_TS_PAT; do   # $BAK_TS_PAT unquoted: it is the glob
    [ -d "$d" ] && BAK_DIRS+=("$d")
  done
  [ "$had_nullglob" -eq 1 ] || shopt -u nullglob
  return 0
}

_bak_prune() {
  local keep="${CCRC_BACKUP_KEEP:-10}"
  _keep_ok "$keep" || _ccrc_die "$(_keep_why CCRC_BACKUP_KEEP "$keep") — nothing was pruned"
  keep=$((10#$keep))   # `0002` is two: the loop below is ARITHMETIC, where a leading 0 is octal (or an error)
  _bak_list
  local n=${#BAK_DIRS[@]} i
  for ((i = 0; i < n - keep; i++)); do
    rm -rf -- "${BAK_DIRS[$i]}" \
      || _ccrc_die "could not prune ${BAK_DIRS[$i]} — the newer backups above it are all intact"
    echo "backup: pruned ${BAK_DIRS[$i]} (keeping the newest $keep timestamped backups; hand-made siblings are never touched)"
  done
}

# ── _bak_gc — update's and rollback's own prune of ~/ccrc-backups (wave 8 item B) ──
# Reached ONLY after a run that COMPLETED with its gate passed and its sweep finished (exit 0 or 3 follows):
# cmd_update after `_upd_report` when `gate_passed` and not a restore child, and cmd_rollback's flip arm after its
# sweep. A failed gate (exit 4, restored), --no-gate, every --from restore child, a sweep that died, and a refused
# rollback never get here. It NEVER DIES and never writes update.json: a `_ccrc_die` here would turn a completed
# update into a `failed` report. rc 0 done or nothing to do; rc 1 skipped or a removal failed; every caller writes
# `|| :`. It keeps the newest $CCRC_BACKUP_KEEP timestamped dirs of any origin (the ONE bounded validator,
# `_keep_ok`, D-3423; counted as `ccrc backup` and deploy.sh count them; read from the process env only), and four
# more that can only LEAVE the removal set: this run's own backup by its exact path; every dir named at or after
# this run's lock second (UPD_BAK_FLOOR); and, among the dirs neither of those protects, the newest tree backup (a
# `server-dist` or `agent-dist` entry: another run's, a deploy's, or the previous update's) and the newest coord.db
# snapshot. The lock was released before the sweep (design §10), so it is RE-TAKEN without dying: any other holder
# means nothing is pruned.
_bak_gc() {   # <lead word: update|rollback>
  local lead="$1" keep="${CCRC_BACKUP_KEEP:-10}"
  if ! _keep_ok "$keep"; then
    echo "$lead: backups: WARN: $(_keep_why CCRC_BACKUP_KEEP "$keep") — nothing pruned"
    return 1
  fi
  keep=$((10#$keep))
  if ! [[ "$UPD_BAK_FLOOR" =~ ^[0-9]{8}-[0-9]{6}$ ]]; then
    echo "$lead: backups: WARN: this run's lock time was not recorded, so nothing can say which backups are its own — nothing pruned"
    return 1
  fi
  local took=0 lrc=0
  [ -n "$UPD_LOCK_FD" ] || took=1
  _ver_lock_try || lrc=$?
  case "$lrc" in
    0) ;;
    1) echo "$lead: backups: skipped — another ccrc run holds ~/.ccrc/update.lock; nothing was pruned"; return 1 ;;
    2) echo "$lead: backups: WARN: flock is not on PATH, so ~/.ccrc/update.lock cannot be taken — nothing pruned"; return 1 ;;
    *) echo "$lead: backups: WARN: ~/.ccrc/update.lock could not be measured — nothing pruned"; return 1 ;;
  esac
  _bak_list
  local floor=$((10#${UPD_BAK_FLOOR//-/})) n=${#BAK_DIRS[@]} i d name shown snap="" tree="" rc=0
  # The two extra keeps are chosen among dirs NOT already protected (below the floor, not this run's own):
  # the protected ones are kept anyway, so picking one of them would protect nothing.
  for ((i = n - 1; i >= 0; i--)); do
    d="${BAK_DIRS[$i]}"; name="${d##*/}"
    [ "$d" = "$UPD_BACKUP_DIR" ] && continue
    [ "$((10#${name//-/}))" -ge "$floor" ] && continue
    if [ -z "$snap" ] && [ -f "$d/coord.db" ]; then snap="$d"; fi
    if [ -z "$tree" ] && { [ -e "$d/server-dist" ] || [ -e "$d/agent-dist" ]; }; then tree="$d"; fi
    [ -n "$snap" ] && [ -n "$tree" ] && break
  done
  for ((i = 0; i < n - keep; i++)); do
    d="${BAK_DIRS[$i]}"; name="${d##*/}"
    [ "$d" = "$UPD_BACKUP_DIR" ] && continue
    [ "$((10#${name//-/}))" -ge "$floor" ] && continue
    [ "$d" = "$snap" ] && continue
    [ "$d" = "$tree" ] && continue
    shown="$d"; case "$d" in "$HOME"/*) shown="\$HOME${d#"$HOME"}" ;; esac
    if rm -rf -- "$d" 2>/dev/null; then
      echo "$lead: backups: pruned $shown (kept: the newest $keep timestamped backups, every one named at or after this run took its lock, this run's own, the newest earlier tree backup and the newest earlier coord.db snapshot; hand-made siblings are never touched)"
    else
      echo "$lead: backups: WARN: could not prune $shown — every newer backup is intact"
      rc=1
    fi
  done
  if [ "$took" -eq 1 ]; then _upd_unlock; fi
  return "$rc"
}
```
```bash
# cmd_update, directly after `  _upd_report "$old_desc" "$old_version"`:
  # Wave 8 item B: reached only past the sweep, so the exit that follows is 0 or 3; the report still reads
  # `restarting`, so the console dispatches nothing here while the prune holds the lock (seconds on a first prune
  # of a large backlog). The restore child is excluded by `gate_passed` already; the UPD_FROM test is a belt with
  # no pin claimed (its inherited-lock early return leaves UPD_BAK_FLOOR empty, which would only WARN).
  if [ "$gate_passed" -eq 1 ] && [ "$UPD_FROM" != restore ]; then _bak_gc update || :; fi
```
- The re-install rollback (`cmd_update --to "$to" --downgrade --from "$run_from"`, in-process, `:14378`) rides `cmd_update`'s site.
- `_bak_gc` does not call `_upd_redact`; it prints `$HOME`-relative paths itself.
- Confirm `UPD_FROM` is the run's `--from` word (`:1687`, set at `:13103` and `:14175`).

- [ ] **Step 1: Re-measure** every anchor above by its quoted text, including the two `if [ "$no_gate" -eq 1 ]; then` occurrences, which one encloses `_ver_gc update auto`, and `_upd_lock`'s three early returns.
  - **The harness.** Confirm `updateEnv` puts first on PATH a recording `systemd-run` (`:344`), the `systemctl` and `launchctl` stubs, a tmux recorder, `ghContainedEnv`'s poisoned `gh`, and the local-release `curl` recorder. Check each with `command -v` under `updateEnv(home)`; never execute through PATH.
  - **The sweep's reach in the fixture.** Without `plantKillModeDropIn`, the stub answers `show -p KillMode` with `control-group` (`:405-414`), and `_upd_sweep` prints REFUSED and DEGRADED and returns before `try-restart`. Every case below that must reach `try-restart` (P12) plants the drop-in; P7 also plants `UNIT_LINES`.
  - **The KEEP env.** Confirm `CCRC_BACKUP_KEEP` is deleted from the env at `:558` and reaches a case only as `extraEnv`.
  - **The audit.** Confirm that nothing in `ccrc-versioned-audit.test.ts`'s `TREE_REF` matches the new `$HOME`-relative `pruned` line.
  - **Tree entries.** Confirm no `install-*.sh` spine installer writes a `server-dist` or `agent-dist` entry into its backup dir (`git grep -n "server-dist\|agent-dist" ccd deploy`). At `a742eb6a`, `_upd_backup` writes both (`ccd/ccrc:16545`, `:16547`) and deploy.sh's backup writes `agent-dist` (`deploy/deploy.sh:566`).
  - **Dirs per update.** Measure how many timestamped dirs one `ccrc update` mints, for a fleet-role fixture install (with the fixture's homes) and for a server-role one. Record both numbers for P16 and the commit body.
  - **The date calls.** Measure, in call order, every `date +%Y%m%d-%H%M%S` a `ccrc update` makes (`_upd_lock`'s floor is expected first, `_upd_backup`'s name second). P3's stub depends on it.
  - **The fixtures' setup runs.** Measure which fixtures run real `ccrc update`s during setup (`onKeptV1`, `flipBox`, the D-3114 fixture, `plantRestoreBox`), and what timestamped dirs each setup leaves.
- [ ] **Step 2: Write the failing tests,** in a describe titled `ccrc update and rollback: ~/ccrc-backups is pruned after a completed run, never its own (wave 8 item B)`.
  - **Helpers:** `freshUpdateBox`, `plantOldBox`, `plantCoordDb`, `packRelease(stubTree(…))`, `runUpdate`, `announcedBackupDir`, `plantRestoreBox`, `plantKillModeDropIn`, `UNIT_LINES`, and `onKeptV1` with `rollbackRun`. The lock holder follows the lock describe's pattern (`:4165`), with its own arrays.
  - **Setup order, for every case whose fixture runs real updates during setup:**
    - plant the timestamped dirs AFTER the setup's updates;
    - then wait (bounded at 3 s, polling `date +%Y%m%d-%H%M%S` every 100 ms) until the box clock's name is strictly past the newest setup dir's name, so no setup dir can share the measured run's lock second;
    - list each setup backup dir the case leaves among the expected survivors or removals, by the paths the setup's own announcements name;
    - keep the fixture free of a live `coord.db` unless the case is about one.
  - **Planted dirs:** `20250101-000000` through `20250112-000000` (old), `20991231-235959` (after any floor), and `pre-flip-agent-dist` (hand-made).
  - **Every case asserts:** `systemd-run-argv` shows only what the case drove, and the tmux and gh recorders are absent.
  - **Cases:**
    - **P1 (the happy prune).** Update v1→v2 with 12 old dirs and `CCRC_BACKUP_KEEP=3`; exits 0.
      - Left: this run's own backup, `20991231-235959`, `pre-flip-agent-dist`, the spine's own dirs from this run, and exactly the newest old dirs KEEP leaves once all of those are counted.
      - Each removal line matches `^update: backups: pruned \$HOME/ccrc-backups/2025`.
      - `update.json`'s phase is `done`.
    - **P2 (`KEEP=0`, no live coord.db).** The fixture box has no `~/.ccrc/coord.db`, and the case says so. This run's own backup (`announcedBackupDir`) and `20991231-235959` survive. Every 2025 dir is gone, except the newest one holding a planted `coord.db`. The sibling survives.
    - **P2b (`KEEP=0`, with a live coord.db).** `plantCoordDb` is given a live `~/.ccrc/coord.db`, so this run's own backup carries one. Planted: `20250105-000000/coord.db`, `20250110-000000/coord.db`, and `20250111-000000` (no coord.db). Afterwards this run's own backup AND `20250110-000000` survive, while `20250105-000000` and `20250111-000000` are gone.
    - **P3 (own backup under a clock step).** A `date` stub, first on PATH, answers `+%Y%m%d-%H%M%S` from a planted list, one line per call (`20200101-000005`, then `20200101-000000`), and appends each format it was asked for to `$HOME/date-calls`. For every other format, and once the list is spent, it `exec`s the real `date`, resolved by `command -v` BEFORE planting and called by absolute path. Old dirs are planted as `20190101-000000` through `20190103-000000`, with no coord.db and no tree entry. With `KEEP=0`: this run's own backup (named `20200101-000000`, below the floor `20200101-000005`) survives, and every `2019…` dir is GONE. The announced backup dir is `…/20200101-000000`, which proves the planted answers reached `_upd_lock` and `_upd_backup` in that order.
    - **P4 (a FLIP rollback, which takes no backup of its own).** Using `onKeptV1` with `KEEP=0`, and no live coord.db. Planted after setup, and after the wait: `20250101-000000/coord.db` and `20250102-000000` (no coord.db). Afterwards `20250101-000000` survives and `20250102-000000` is gone. The setup's own backup dirs are listed by path: the newest one holding `server-dist` or `agent-dist` survives as the earlier tree backup, and the rest are gone. The line prefix is `rollback: backups:`.
    - **P5 (no prune on a failed gate).** `plantRestoreBox` (exit 4), with planted dirs and `KEEP=0`. Every planted dir and the parent's own backup survive, and there is no `backups:` line.
    - **P6 (no prune on `--no-gate`).** `runUpdate(['--no-gate'])` exits 0, and the planted dirs survive at `KEEP=0`.
    - **P7 (no prune on a sweep death).** `fixture-try-restart-fail` plus `plantKillModeDropIn` plus `UNIT_LINES` exits 1, naming the backup. The planted dirs survive.
    - **P8 (exit 3 prunes).** The D-3114 fixture (`:1578`, "a spine that COMPLETED under a failing doctor exits 3") with `KEEP=1` exits 3 and prunes. The same holds for the flip exit-3 case (`:9262`). Dirs are planted after setup and after the wait, and the setup's own dirs are listed.
    - **P9 (a failed flip gate).** `fixture-health-pin` on the flip (`_upd_rollback_no_restore`): exit 1, nothing pruned. Dirs are planted after setup.
    - **P10 (a prune failure only warns).** Planted `20250101-000000/ro/f`, with `ro` chmod 0500, and `KEEP=0`, plus a newer 2025 tree backup so that `20250101-000000` is in the removal set. Exit 0, one `WARN: could not prune` line, and `update.json` reads `done`. The mode is restored in `finally`. `itLinux`; skipped with a stated reason under uid 0.
    - **P11 (a bad KEEP).** `abc` and `10000` each exit 0 with `^update: backups: WARN: CCRC_BACKUP_KEEP='abc' is not a whole number from 0 to 9999 — nothing pruned$` (and the matching line for `10000`). Nothing is removed.
    - **P12 (another holder at prune time).** `plantKillModeDropIn` plus `fixture-sweep-hold-lock`: exits 0 with `update: backups: skipped — another ccrc run holds ~/.ccrc/update.lock; nothing was pruned`. Nothing is removed. The holder (redirected stdio) is killed in this describe's own `afterEach`.
    - **P13 (the refused rollback).** The existing 404 rollback fixture prunes nothing.
    - **P14 (the floor inside the removal set).** `KEEP=1`, with planted `20991231-235958`, `20991231-235959` and `20250101-000000` (no coord.db, no tree entry). Both 2099 dirs are after the floor, and only the newer is kept by count. Afterwards both 2099 dirs survive, and `20250101-000000` is GONE.
    - **P15 (another run's tree backup).** `KEEP=0`, with planted `20250103-000000/server-dist/` (a stand-in for another run's `_upd_backup`) and a newer `20250104-000000/skill/` (an installer dir). Afterwards `20250103-000000` survives and `20250104-000000` is gone.
    - **P16 (KEEP is a count).** Planted `20250101-000000` through `20250112-000000` (no coord.db, no tree entry) and `20991231-235959`. Before the run, count S, the setup's own timestamped dirs (all dated today, so all newer than 2025). Set `KEEP = S + m + 1 + 2`, where m is Step 1's dirs-per-update for this fixture's role. Afterwards `20250112-000000` and `20250111-000000` survive BY COUNT, `20250110-000000` is gone, and the number of surviving timestamped dirs equals KEEP. A wrong m reds this case with the listing in its message.
    - **P17 (`ccrc backup`'s echo, byte-identical).** `ccrc backup` with `KEEP=1` over two planted dirs prints exactly `backup: pruned <home>/ccrc-backups/20250101-000000 (keeping the newest 1 timestamped backups; hand-made siblings are never touched)` (the absolute path, as main prints it).
  - **Run:** `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "wave 8 item B"`.
  - **Expected:** P1, P2, P2b, P3, P4, P8, P10, P11, P12, P14, P15 and P16 FAIL. P5, P6, P7, P9, P13 and P17 are green at main; their reds are the mutation rows. Record the counts.
- [ ] **Step 3: Implement,** as above, plus the usage and README prose.
- [ ] **Step 4: Run,** one command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "wave 8 item B"
  cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts test/ccrc-cli.test.ts test/ccrc-versioned-audit.test.ts test/deploy-verify.test.ts test/runbook-holds.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts
  cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/ownership.test.ts test/session-hook.test.ts
  git diff --stat origin/main...HEAD -- ccd/ccd; wc -l README.md
  ```
  Expected: PASS. The `ccd/ccd` diff is empty, and README reads 3601.
  - The full `ccrc-update.test.ts` run is the check that no existing case asserted a backup dir that a setup update now prunes. Any such case is re-measured (plant after setup, or `extraEnv` KEEP) and named in the commit body.
- [ ] **Step 5: Mutation measurement.** For each row: `cp ccd/ccrc "$SCRATCH/ccrc.orig"`, mutate, run `cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts -t "wave 8 item B"` (and the row's other named file), `cp` back, `cmp`.
- [ ] **Step 6: Commit.** `git commit -m "feat(update): update and rollback prune ~/ccrc-backups after a completed run, never their own (wave 8 item B)"`. The commit body states:
  - **When the backlog goes.** The first update or rollback run BY a W8+ ccrc on each live box removes the backlog beyond the newest 10 timestamped dirs, including old skill, settings, hooks and edited-Caddyfile backups. The update INTO W8 is run by v0.0.49's script and prunes nothing. That first prune removes about 250–600 MB and takes seconds.
  - **Effective history.** Using the dirs-per-update measured in Step 1, state how many updates of history KEEP=10 keeps on a fleet-role box and on a server-role box.
  - **Console moves.** A console-driven move runs under the user manager's environment, which carries no `CCRC_BACKUP_KEEP` unless it was set there (`environment.d`, or `systemctl --user set-environment`), so in the ordinary case it prunes at the default 10.
  - **The new window.** For the prune's duration, a `ccrc update` or `rollback` started on the box dies with `_upd_busy_die`.

**Mutation table (Task 4):**

| # | Guard | Mutation | Must red | Measured |
|---|---|---|---|---|
| B-M1 | only a passed gate prunes | `local gate_passed=1` | P6 (P5 cannot reach the call, because it exits 4 first; that is the control) | pending |
| B-M2 | after the sweep | move the `cmd_update` call to directly above `_upd_phase restarting` | P7 | pending |
| B-M3 | the floor | drop the `-ge "$floor"` skip in the removal loop | P2 (`20991231-235959` gone), P14 (`20991231-235958` gone) | pending |
| B-M4 | this run's own backup, by path | drop the removal loop's `[ "$d" = "$UPD_BACKUP_DIR" ]` skip | P3 | pending |
| B-M5 | the floor is set only if empty | `UPD_BAK_FLOOR="$(date …)"` unconditionally in `_upd_lock` | none expected: re-entry returns early above it (`[ -n "$UPD_LOCK_FD" ] && return 0`). Measure P4 and P1; if green, record as defence in depth, no pin claimed | pending |
| B-M6 | the newest earlier coord.db snapshot | drop the `snap` skip | P2, P2b, P4 | pending |
| B-M6b | the snapshot is chosen among the unprotected | let the selection loop consider protected dirs (drop its two `continue`s) | P2b (`20250110-000000` gone) | pending |
| B-M7 | the newest earlier tree backup | drop the `tree` skip | P15, and P4's setup-dir assertion | pending |
| B-M8 | never dies on a removal failure | the `else` arm → `_ccrc_die "could not prune $shown"` | P10 (exit changes, `update.json` reads `failed`) | pending |
| B-M9 | the bounded validator | drop the `_keep_ok` check (use `keep` raw) | P11 (`abc`: an arithmetic error or wrong removals; `10000` accepted) | pending |
| B-M10 | the lock is re-taken | replace `_ver_lock_try \|\| lrc=$?` with `lrc=0` | P12 (dirs removed while another holds the lock) | pending |
| B-M11 | the flip arm prunes | delete `_bak_gc rollback \|\| :` | P4, P8's flip case | pending |
| B-M12 | the flip arm prunes after the gate | move the flip call above `_upd_gate` | P9 | pending |
| B-M13 | the lock is released when taken here | drop `_upd_unlock` in `_bak_gc` | a follow-on `ccrc update` in P1's box refuses busy. Add the assertion to P1; if the process exit releases the flock anyway, record as defence in depth, no pin claimed | pending |
| B-M14 | `_bak_prune`'s die sentence is unchanged | change its `— nothing was pruned` die tail | `ccrc-uninstall.test.ts` `:1129`, `:1144`, `:1149` (run that file for this row) | pending |
| B-M14b | `_bak_prune`'s echo is unchanged | change its `echo "backup: pruned …"` wording | P17 | pending |
| B-M15 | the restore-child belt | drop `&& [ "$UPD_FROM" != restore ]` | none: `gate_passed` already excludes the restore child. Defence in depth, no pin claimed | not run |
| B-M16 | KEEP is honoured as a count | `i < n - keep` → `i < n` in `_bak_gc`'s removal loop | P16 (`20250112-000000` and `20250111-000000` gone) | pending |

### Task 5: doctor reads the armed gate (item D), and the two box lines (item G)

**Files:**
- **Modify `ccd/ccrc`:**
  - `_box_unit_env` and its file-scope out-params (`BUE_VAL`, `BUE_SRC`, `BUE_NAMED`, `BUE_ENV`, `BUE_EXP`), directly after `_box_env_value` (`:2547`, which ends at the `[ "$found" -eq 1 ]` line). The header gets a paragraph beside `_box_env_value`'s own, which already argues why presence must be told from empty.
  - `_upd_sweep`:
    - the Darwin success line (`:17521`) is wrapped in `if [ "${#kicked[@]}" -eq 0 ]; then <new line>; else <existing line, byte-identical>; fi`. `kicked` is already the set `_svc_try_restart` touched;
    - Linux: the preflight enumeration is captured once into a local and the pre-restart ACTIVE set is read from its ACTIVE column (no systemctl call is added, so the argv-order pin at `ccrc-update.test.ts:2470-2502` stays green unedited); the verify loop collects the units it saw; a unit active before and not after is named on stderr; the zero line keys on the pre-restart set; the existing success line (`:17559`) stays byte-identical.
  - Install's gate line (`:9948`) and its comment block (`:9935-9947`).
- **Modify `ccd/ccrc-doctor-checks`:**
  - **`_check_auth`:**
    - the header block "THE FLAG IS READ FROM ccrc.env, NEVER FROM THIS SHELL" (`:1244-1250`) is re-titled "THE FLAG IS READ AS ccrc.service GETS IT, NEVER FROM THIS SHELL", naming both files, the later winning by presence, and the unmeasured state;
    - the preflight (`:1275-1283`) also requires a non-empty `CCRC_EXPOSURE_FILE` and a declared `_box_unit_env`;
    - the flag read (`:1304-1309`) moves onto the reader;
    - `$where`/`$gate` name the file that won;
    - the rc 0 and rc 3 arms gain their unmeasured WARN;
    - rc 4's `when` gains an unmeasured tense;
    - rc 3's PASS DETAIL (its arming words; a PASS prints no remedy line) names the exposure file when that file named `CCRC_AUTH`.
  - **`_check_update-exposure`:** the header sentence (`:1716-1731`) names the reader, and the ARMED and REACHABLE reads (`:1784-1812`) move onto it. Its two "printed-source" lines (`[ -z "$auth" ] || authsrc=…` and the `CCRC_HOST` twin) are dropped as unobservable: `authsrc` is printed only in the PASS arm, where the value is `on`, and `bindsrc` only for a non-empty, non-loopback bind, so in every printed case the reader's `BUE_SRC` is the file main named.
- **Modify `docs/superpowers/specs/2026-08-19-stage2-vm-gate-runbook.md`,** step 12's sentence after `:723`: "The same line closes the sweep on a box with no live sessions — the `KillMode=process` preflight still ran, against an uninstantiated instance of the template, and `try-restart` simply matched nothing." becomes "On a box with no live sessions the sweep closes instead with `update: sweep: no claude-session@ supervisor was active when the sweep began, so try-restart had nothing running to restart (KillMode=process verified before the restart; panes untouched)` — the `KillMode=process` preflight still ran, against an uninstantiated instance of the template." Reflow within the paragraph, line-neutral.
- **Modify `README.md` `:833-838`:** doctor's auth paragraph says the flag is read as `ccrc.service` gets it (`ccrc.env`, then the exposure file). Reflow within the paragraph, line-neutral.
- **Tests:**
  - `server/test/ccrc-doctor.test.ts`: the auth describe's gate-OFF cases are re-based (Step 2 item 0), the describe gains cases, and the `update-exposure` describe runs UNEDITED;
  - `server/test/ccrc-update.test.ts`: sweep cases beside `:2470` (Linux) and `:2596`/`:2658` (Darwin);
  - `server/test/ccrc-install.test.ts`: gate-line cases beside `:5054`, whose fresh-box assertions stay green unedited;
  - `server/test/runbook-holds.test.ts`: one case beside `:429-433` (the zero line, quoted in `ccrc` and in step 12). The `:429-433` case stays green unedited.

**Interfaces and code:**
```bash
# beside _box_env_value — its out-params, at file scope:
BUE_VAL=""     # _box_unit_env: the value ccrc.service receives for the key ("" when neither file names it)
BUE_SRC=""     # the file whose line decided ("" when neither readable file names the key)
BUE_NAMED=0    # 1 iff either READABLE file named the key at all (presence, not a non-empty value)
BUE_ENV=""     # ccrc.env's state: ok | unreadable | absent
BUE_EXP=""     # the exposure file's state: absent | readable | unreadable

# ── _box_unit_env — ONE KEY AS ccrc.service RECEIVES IT (wave 8 item D) ────
# The unit carries two EnvironmentFile lines, ccrc.env then $CCRC_EXPOSURE_FILE, and the later wins by PRESENCE: a
# bare `KEY=` in the exposure file overrides ccrc.env's value, exactly as systemd's second EnvironmentFile does
# (`_box_env_value`'s rc tells that apart). THE one copy of that precedence: `_check_auth`, `_check_update-exposure`
# and install's gate line read through it. It never reads this shell's environment. It narrows nothing: an
# exposure file that is THERE AND UNREADABLE answers rc 2 (UNMEASURED — its value would have won), never absent;
# BUE_VAL/BUE_SRC then carry what ccrc.env alone says, for a caller that must word that. rc 0 measured.
_box_unit_env() {   # <KEY>
  local key="$1" v rc
  BUE_VAL=""; BUE_SRC=""; BUE_NAMED=0; BUE_ENV=absent; BUE_EXP=absent
  if [ -e "$BOX_ENV_FILE" ]; then
    if [ -f "$BOX_ENV_FILE" ] && [ -r "$BOX_ENV_FILE" ]; then
      BUE_ENV=ok
      v="$(_box_env_value "$BOX_ENV_FILE" "$key")"; rc=$?
      if [ "$rc" -eq 0 ]; then BUE_VAL="$v"; BUE_SRC="$BOX_ENV_FILE"; BUE_NAMED=1; fi
    else
      BUE_ENV=unreadable
    fi
  fi
  if [ -n "${CCRC_EXPOSURE_FILE:-}" ] && [ -e "$CCRC_EXPOSURE_FILE" ]; then
    if [ -f "$CCRC_EXPOSURE_FILE" ] && [ -r "$CCRC_EXPOSURE_FILE" ]; then
      BUE_EXP=readable
      v="$(_box_env_value "$CCRC_EXPOSURE_FILE" "$key")"; rc=$?
      if [ "$rc" -eq 0 ]; then BUE_VAL="$v"; BUE_SRC="$CCRC_EXPOSURE_FILE"; BUE_NAMED=1; fi
    else
      BUE_EXP=unreadable
      return 2
    fi
  fi
  return 0
}
```
```bash
# _check_update-exposure ARMED, replacing its two inline reads (the three-state expok/expunread above is kept, and so
# is envok, which the role read uses):
  local auth="" authsrc=""
  _box_unit_env CCRC_AUTH || :
  auth="$BUE_VAL"; authsrc="$BUE_SRC"
# …REACHABLE likewise with CCRC_HOST into bindhost/bindsrc. No printed-source rule is kept: a source is printed only
# where its value is `on` (authsrc) or a non-empty non-loopback bind (bindsrc), and there BUE_SRC is the file main
# named. Re-measure that each verdict branch reads the same inputs it did (the describe running unedited is the proof).
```
```bash
# _check_auth, the flag read (replacing `local flag="" where="$BOX_ENV_FILE"` and its if/else):
  local flag="" where="$BOX_ENV_FILE" unmeasured=0 expnamed=0
  _box_unit_env CCRC_AUTH || unmeasured=1
  flag="$BUE_VAL"
  if [ "$BUE_SRC" = "$CCRC_EXPOSURE_FILE" ]; then
    where="$CCRC_EXPOSURE_FILE (it overrides $BOX_ENV_FILE)"; expnamed=1
  elif [ "$BUE_ENV" != ok ]; then
    where="no readable $BOX_ENV_FILE"
  fi
# `gate`/`armed` stay as they are, over `$flag` and `$where`. The relative-secret FAIL, the helper FAIL, the node
# FAIL and the helper's unrecognised-state FAIL keep their places and words — none depends on the flag.
# In the `case "$rc"`:
#   0) after the shape check, before the armed test:
#        if [ "$unmeasured" -eq 1 ]; then
#          _dr_warn auth "$secret$via holds a usable passphrase ($detail), but $CCRC_EXPOSURE_FILE is there and cannot be read, and its CCRC_AUTH would win over $BOX_ENV_FILE's — whether logins are gated was not measured" \
#            "look at what is really there (ls -ld $CCRC_EXPOSURE_FILE) — on macOS an unreadable one also stops the server job — then re-run: ccrc expose duckdns (or: ccrc expose byo); it rewrites the file 0600"
#          return 2
#        fi
#   3) first:
#        if [ "$unmeasured" -eq 1 ]; then
#          _dr_warn auth "there is no passphrase file at $secret$via, and $CCRC_EXPOSURE_FILE is there and cannot be read, so whether the gate is armed (and failing shut) was not measured" \
#            "look at what is really there (ls -ld $CCRC_EXPOSURE_FILE) and re-run ccrc expose; if the gate is meant to be armed, run: ccrc passwd"
#          return 2
#        fi
#      and the PASS DETAIL's arming words "…set CCRC_AUTH=on together with CCRC_RP_ID and CCRC_ORIGIN in $BOX_ENV_FILE
#      and restart ccrc.service" read, when expnamed=1, "…set CCRC_AUTH=on in $CCRC_EXPOSURE_FILE, which overrides
#      $BOX_ENV_FILE, together with CCRC_RP_ID and CCRC_ORIGIN (ccrc expose writes all three), and restart ccrc.service"
#      — the words for expnamed=0 stay byte-identical.
#   4) FAIL in every flag state, as before; `when` gains a third tense for unmeasured=1:
#      "if CCRC_AUTH is on ($CCRC_EXPOSURE_FILE, which decides it, cannot be read), the server refuses to boot on it".
```
```bash
# _upd_sweep, Darwin, replacing the one success echo:
    if [ "${#kicked[@]}" -eq 0 ]; then
      echo "update: sweep: no loaded claude-session@ supervisor on this box, so nothing was restarted (AbandonProcessGroup is checked per job file when there is one)"
    else
      echo "update: sweep: every live claude-session@ supervisor now runs the ccd this update installed (AbandonProcessGroup verified in every job file; ${#kicked[@]} restarted and re-measured still up)"
    fi

# _upd_sweep, Linux: the preflight enumeration, captured once (the SAME one call main makes, same argv):
  local u km listing lu _ll la _lr
  local -a before=() after=() failed=()
  listing="$(systemctl --user list-units "claude-session@*" --plain --no-legend)" || :
  # Wave 8 item G: the supervisors try-restart can touch are the ones ACTIVE before it runs — read from this
  # listing's ACTIVE column (`--plain --no-legend`: UNIT LOAD ACTIVE SUB DESCRIPTION), so no call is added.
  while read -r lu _ll la _lr; do
    [ "$la" = active ] && before+=("$lu")
  done <<< "$listing"
  for u in $(printf '%s\n' "$listing" | awk '{print $1}') claude-session@ccrc-update-preflight.service; do
    # …the preflight body, unchanged…
  done
# …try-restart unchanged; the failed loop also does `failed+=("$u")`; the verify loop also does `after+=("$u")`.
# Then, before the existing echo, which stays byte-identical:
  local b a seen
  for b in ${before[@]+"${before[@]}"}; do
    seen=0
    for a in ${after[@]+"${after[@]}"} ${failed[@]+"${failed[@]}"}; do [ "$a" = "$b" ] && { seen=1; break; }; done
    [ "$seen" -eq 1 ] || echo "update: warning: $b was active before try-restart and is not active after it — this sweep did not verify it. On the box: systemctl --user status $b" >&2
  done
  if [ "${#before[@]}" -eq 0 ]; then
    echo "update: sweep: no claude-session@ supervisor was active when the sweep began, so try-restart had nothing running to restart (KillMode=process verified before the restart; panes untouched)"
    return 0
  fi
```
```bash
# install's gate line (replacing the one echo at :9948; the fresh-box line byte-identical):
  local gsec grc urc=0
  gsec="$(_box_auth_path)"; grc=$?
  if [ "$grc" -eq 3 ]; then
    echo "install: gate: CCRC_AUTH_SECRET_PATH in $BOX_ENV_FILE is RELATIVE ($gsec), so install cannot say whether this box has a PWA passphrase — make it absolute (or remove the line); ccrc doctor's auth check says the rest"
  elif [ -e "$gsec" ]; then
    _box_unit_env CCRC_AUTH || urc=$?
    if [ "$urc" -ne 0 ]; then
      echo "install: gate: a PWA passphrase file is at $gsec, and $CCRC_EXPOSURE_FILE is there and cannot be read, so whether CCRC_AUTH is on was not measured — ccrc doctor's auth check says what to do"
    elif [ "$BUE_VAL" = on ]; then
      echo "install: gate: CCRC_AUTH=on in $BUE_SRC, and a PWA passphrase file is at $gsec (arming also needs CCRC_RP_ID and CCRC_ORIGIN beside the flag; ccrc doctor's auth check measures whether the file is usable)"
    else
      echo "install: gate: a PWA passphrase file is at $gsec, but the gate is OFF. To arm it: $gate_how, then: $(_svc_restart_hint ccrc.service)"
    fi
  else
    _box_unit_env CCRC_AUTH || urc=$?
    if [ "$urc" -eq 0 ] && [ "$BUE_VAL" = on ]; then
      echo "install: gate: CCRC_AUTH=on in $BUE_SRC and this box has NO PWA passphrase — the gate is failing SHUT: every route answers 401 until: ccrc passwd"
    else
      echo "install: gate: this box has NO PWA passphrase — install never writes one. To arm the gate: ccrc passwd, then set CCRC_AUTH=on together with CCRC_RP_ID and CCRC_ORIGIN in $BOX_ENV_FILE, then: $(_svc_restart_hint ccrc.service)"
    fi
  fi
```
In the OFF arm, `gate_how` is a local built before the echo: "set CCRC_AUTH=on together with CCRC_RP_ID and CCRC_ORIGIN in $BOX_ENV_FILE (or run ccrc expose)" when `BUE_SRC` is not the exposure file, and "set CCRC_AUTH=on in $CCRC_EXPOSURE_FILE, which overrides $BOX_ENV_FILE (ccrc expose writes it with CCRC_RP_ID and CCRC_ORIGIN)" when it is. One echo per arm.

- [ ] **Step 1: Re-measure.**
  - Every anchor above, by its quoted text.
  - That doctor's `containedPath` (`ccrc-doctor.test.ts:892`), `updateEnv` and `ccrcEnv` each resolve a recording `systemd-run`, `tmux`, `gh` and `curl`, via `command -v` under the case's env.
  - **The auth describe's fixtures.** `healthy()` calls `writeExposureEnv(home)` (`:1142`), which writes `CCRC_AUTH=on` (`:769-790`). Every case in the auth describe (`:2825-3186`) that expects the gate OFF is therefore armed under item D. At `a742eb6a` these are `:2835` (the D-139 pin, "a fresh install ends GREEN"), `:2857`, `:2898`, `:2911`, `:2924` and `:3005`; re-measure the list.
  - **The unexposed box.** Build a box with `unexposed()`'s recipe (`:7145`: `healthy()`, then remove `exposure.env`, the Caddyfile and the system Caddyfile, and write a loopback `ccrc.env`), and measure that `runDoctor` on it exits 0 at main. If it does not, stop and report: the D-139 pin's exit-0 assertion cannot be re-based as planned.
  - That `_dr_warn` exists and returns rc 2 in `_check_auth`'s table (`update-exposure`'s early WARN is the model), and which existing case sources the check table without ccrc's constants (the model for D8).
  - The Darwin sweep harness: whether a case can plant zero loaded session jobs.
  - The Linux sweep cases that plant `fixture-sweep-units` without the same units in `fixture-sweep-active`, and what each asserts about stderr: the new warning lands there. The argv-order pin (`ccrc-update.test.ts:2470-2502`) must stay green unedited: no systemctl call is added.
  - `runbook-holds.test.ts:429-433` and `ccrc-update.test.ts:2596`/`:2658`, the byte-identical pins this task must keep.
  - The citation-corpus result from Task 1 Step 1 for `ccd/ccrc`, `ccrc-doctor-checks` and runbook line citations.
- [ ] **Step 2: Write the failing tests.**
  0. **`ccrc-doctor.test.ts`, the re-base (a correction, not a weakening).** Add a describe-local `unexposedBox(prefix)` to the auth describe, copying `unexposed()`'s recipe (that helper is local to the `update-exposure` describe). Every gate-OFF case from Step 1 builds on it instead of `healthy()`, with its assertions unchanged. `:2911`'s title "reads the flag from ccrc.env and NOT from the shell" becomes "reads the flag from the unit's env files and NOT from the shell". Name each edited case in the commit body: at main these cases passed on the live defect's premise, that the exposure file's `CCRC_AUTH=on` does not arm the gate. Any other case Step 4 reds for the same reason is re-based and named the same way.
  1. **`ccrc-doctor.test.ts`, the auth describe:**
     - **D1.** `healthy()` (the exposure file carries `CCRC_AUTH=on`) with `ccrc.env` `CCRC_AUTH=off` and a usable passphrase: `PASS auth`, naming the exposure file as the flag's source, and "logins are gated". This is the live defect.
     - **D2.** An unexposed box with `ccrc.env` `CCRC_AUTH=on`, an exposure file holding only a bare `CCRC_AUTH=` line, and no passphrase file: `PASS auth`, gate OFF, `$where` names the exposure file, and the PASS DETAIL's arming words read `set CCRC_AUTH=on in <exposure file>, which overrides <ccrc.env>`. `remedyFor(r.stdout, 'auth')` is `''` (a PASS prints no remedy).
     - **D3.** An unexposed box (no exposure file) with `ccrc.env` `CCRC_AUTH=on` and no passphrase: the FAIL line main prints for that box, byte-identical (capture it at main first).
     - **D4.** `healthy()` with the exposure file made unreadable (mode 000; `itLinux`, skipped under uid 0) and a usable passphrase: one `WARN auth`, rc 2, naming the file.
     - **D5.** The same unreadable exposure file with a garbled `auth.scrypt`: `FAIL auth` (rc 4's arm), and no `WARN auth:` line.
     - **D6.** The same unreadable exposure file with the helper missing: the helper FAIL, and no `WARN auth:` line.
     - **D7.** An unexposed box whose `ccrc.env` says `CCRC_AUTH=off`, run with `CCRC_AUTH=on` exported in the doctor's own environment: the gate is OFF.
     - **D8.** The table is sourced with the `ccrc` functions but no `CCRC_EXPOSURE_FILE`: the "config reader is not loaded" FAIL.
     - **D9.** The whole `update-exposure` describe runs UNEDITED and green.
  2. **`ccrc-update.test.ts`, the sweep (Linux cases plant `plantKillModeDropIn`, or the sweep refuses before `try-restart`):**
     - **G1a.** A server-role fixture with NO `fixture-sweep-units` and no `fixture-sweep-active`: the pre-restart set is truly empty. The zero line appears, and the old success line is absent.
     - **G1b.** `UNIT_LINES` in both `fixture-sweep-units` and `fixture-sweep-active`: the old line appears byte-identically; the zero line and the new warning are absent.
     - **G1d.** `UNIT_LINES` in `fixture-sweep-units`, and `fixture-sweep-active` absent (units active before the restart, none after): no zero line; stderr names `claude-session@alpha.service` and `claude-session@beta.service` with `was active before try-restart and is not active after it`; the old success line still prints, as main prints it.
     - **G1c (Darwin, only if Step 1 found the harness can do it).** Zero loaded jobs give the Darwin zero line, and the `restarted and re-measured still up` substring is absent. `:2596` and `:2658` stay green.
  3. **`runbook-holds.test.ts`, R1:** the zero line is quoted verbatim in `ccrc` (as `echo "<line>"`) and in `step12Section()`.
  4. **`ccrc-install.test.ts`, the gate line:**
     - **G2a.** A fresh box (`:5054`): the existing line, byte-identical.
     - **G2b.** A passphrase file at the default path with the flag off: `a PWA passphrase file is at`, the OFF remedy naming `ccrc.env`, and no `NO PWA passphrase`.
     - **G2c.** An absolute `CCRC_AUTH_SECRET_PATH` with the file present there, and absent at the default path: the present arm, naming the redirected path.
     - **G2d.** A relative `CCRC_AUTH_SECRET_PATH`: the relative line.
     - **G2e.** A passphrase present and the exposure file `CCRC_AUTH=on`: `CCRC_AUTH=on in <exposure file>, and a PWA passphrase file is at`, and the line does not contain `armed`.
     - **G2f.** No passphrase file and the exposure file `CCRC_AUTH=on`: `the gate is failing SHUT`, and no `To arm the gate`.

  Run each file with `-t` on its new describe. Expected: D1, D2, D4, D8, G1a, G1d, R1, G2b, G2c, G2d, G2e and G2f FAIL. D3, D5, D6, D7, D9, G1b, G2a and the re-based cases are green at main; their reds are the mutation rows (the re-based cases are controls). Record the counts.
- [ ] **Step 3: Implement,** as above, plus the README paragraph and the runbook sentence.
- [ ] **Step 4: Run,** one command per call:
  ```bash
  cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-update.test.ts
  cd server && ./node_modules/.bin/vitest run test/ccrc-install.test.ts
  cd server && ./node_modules/.bin/vitest run test/runbook-holds.test.ts test/ccrc-versioned-audit.test.ts test/deploy-verify.test.ts
  cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/ownership.test.ts test/session-hook.test.ts test/topology-clean.test.ts
  git diff --stat origin/main...HEAD -- agent deploy ccd/ccd '*.service' '*.timer'; wc -l README.md
  ```
  Expected: PASS. The diff is empty, and README reads 3601.
- [ ] **Step 5: Mutation measurement.** For each row: `cp` the file to `$SCRATCH`, mutate, run the named file with `-t` on the new describe, `cp` back, `cmp`.
- [ ] **Step 6: Commit.** `git commit -m "fix(update): doctor reads the gate as ccrc.service gets it; the sweep and install gate lines say only what was measured (wave 8 items D, G)"`. The commit body names each re-based auth case as a correction, and the runbook sentence.

**Mutation table (Task 5):**

| # | Guard | Mutation | Must red | Run | Measured |
|---|---|---|---|---|---|
| D-M1 | the exposure file is read | `_box_unit_env`: drop the exposure-file block | D1, D2, G2e, G2f (the re-based cases stay green: they are controls, no pin claimed) | `ccrc-doctor`, `ccrc-install` | pending |
| D-M2 | presence wins, not a non-empty value | the exposure arm: `[ "$rc" -eq 0 ]` → `[ -n "$v" ]` | D2 | `ccrc-doctor` | pending |
| D-M3 | unreadable is unmeasured | the unreadable arm: `return 2` → `:` (treated as absent) | D4 | `ccrc-doctor` | pending |
| D-M4 | the WARN comes after the flag-independent FAILs | move the rc-3 unmeasured WARN block (it references only `$secret`, `$via`, `$CCRC_EXPOSURE_FILE` and `$unmeasured`, all declared above the helper check) to directly above the helper check | D5, D6: each reds on its "no `WARN auth:` line" assertion; record that the mutated run printed `^WARN auth:` (not a crash) | `ccrc-doctor` | pending |
| D-M5 | `$where` names the file that won | drop the `BUE_SRC = CCRC_EXPOSURE_FILE` arm | D1's source assertion, D2 | `ccrc-doctor` | pending |
| D-M6 | the arming words name the file that won | the rc-3 PASS detail always names `$BOX_ENV_FILE` | D2's detail assertion | `ccrc-doctor` | pending |
| D-M7 | the preflight needs the exposure path | drop the `-z "${CCRC_EXPOSURE_FILE:-}"` preflight clause | D8 | `ccrc-doctor` | pending |
| D-M8 | the shell's flag is never read | `_box_unit_env`: `BUE_VAL="${!key:-$BUE_VAL}"` before `return 0` | D7, and the re-based `:2911` case | `ccrc-doctor` | pending |
| G-M1 | the Linux zero line | drop the zero branch | G1a (the old line appears) | `ccrc-update` | pending |
| G-M2 | key on the set active BEFORE the restart | the zero branch tests `${#after[@]}` instead of `${#before[@]}` | G1d (the zero line appears) | `ccrc-update` | pending |
| G-M3 | the Darwin zero branch | always take the existing echo | G1c, if built; else no pin claimed, and the table says so | `ccrc-update` | pending |
| G-M7 | a unit that vanished is named | drop the `was active before try-restart` warning | G1d | `ccrc-update` | pending |
| G-M8 | the pre-restart set is read from ACTIVE | `[ "$la" = active ]` → `[ -n "$lu" ]` (count every listed unit) | none expected with the fixture's `UNIT_LINES` (all read `active`); add a G1b variant whose listing has one `failed` row and assert it is not warned about; if still green, no pin claimed | `ccrc-update` | pending |
| R-M1 | the runbook quotes the zero line | revert the runbook sentence | R1 | `runbook-holds` | pending |
| G-M4 | install follows the file | always take the absent arm | G2b, G2c, G2e | `ccrc-install` | pending |
| G-M5 | install follows the redirect | `gsec="$BOX_AUTH_FILE"; grc=0` | G2c, G2d | `ccrc-install` | pending |
| G-M6 | install says `CCRC_AUTH=on` only when it is | the present arm always prints the OFF words | G2e | `ccrc-install` | pending |
| G-M9 | the fail-shut arm | drop the absent arm's `CCRC_AUTH=on` branch | G2f | `ccrc-install` | pending |

## Design

**Posture:** none

Residue on screens that already exist — the move sheet, Settings and Mail keep their shapes. Nothing new to look at.

Declared retrospectively: this plan shipped before the posture convention
reached its programme (`server/test/design-declaration.test.ts`). The guard
asks that the question be answered, never which answer is given.
