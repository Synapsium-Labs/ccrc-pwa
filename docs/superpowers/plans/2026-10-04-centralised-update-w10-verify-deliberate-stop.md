# Centralised update management, wave 10: `verify-service.sh` tells a deliberate supervisor stop from a crash (R12, script half): Implementation Plan

The coordinator ruled wave 10 as R12's script half on 2026-10-04 22:56 UTC (workflow `wf_790a5b99-8ca`). The wave touches `deploy/verify-service.sh` and its tests, and nothing else.

- **Task 1.** When a `claude-session@<id>.service` unit fails a check while its last reading was `inactive`, `deactivating` or "no MainPID", `deploy/verify-service.sh` re-polls `is-active` until the unit settles, within a bound.
  - The unit passes if, and only if, it settled `inactive` and one of these holds:
    - ccd's stop stamp `~/.cc-sessions/<id>.stopped` exists;
    - its registry row is purged (there is no `<id>.uuid`).
  - A pass exits 0 and prints its own `stopped on purpose:` line.
  - Every other unit and every other state fails exactly as it does today. This includes a unit seen `activating` or `failed`, and a MainPID that changed (ruling 6).
  - Every case that executes `deploy/verify-service.sh` sets `HOME` to a `mkTmp` directory, the cases that exist today included; V20 runs with `HOME` unset on purpose, and the file's other spawns run other scripts (wave 11, R13e; the Global Constraint at `:134`).
- **Task 2.** A new server test file sources `main`'s current `ccd/ccrc` without editing it. It runs `_upd_sweep` against the new script, on a fixture HOME with `systemctl` stubbed.
  - A stamped, stopped unit returns 0, and so does a purged one.
  - An unstamped one dies exactly as it does today.
  - This proves that the move INTO wave 10 is protected.
- **Task 3.** The gate and the PR.

**THIS WAVE GOES LIVE ON MERGE.** Both boxes follow the `dev` channel with `auto=channel`. A merge to `main` becomes a prerelease in about a minute. Auto then installs it on both boxes, fleet box first. The bound is the catalogue's 30-minute poll plus both runs, so allow up to about 50 minutes (ledger, 2026-10-04 17:47). No one runs a rollout. Three facts make this wave unusual:
- **The move INTO this wave runs the OLD `_upd_sweep` with the NEW script.**
  - The detached update re-execs the launcher (`ccd/ccrc:18026`).
  - The launcher execs `~/ccrc/ccd/ccrc` before the flip: `exec "$CCRC_SHIPPED" "$@"` (`ccd/ccrc:13695`).
  - The old sweep resolves the script at the moment it calls it: `local verify="$BOX_TREE_DIR/deploy/verify-service.sh"` (`ccd/ccrc:20619`), with `BOX_TREE_DIR="$HOME/ccrc"` (`ccd/ccrc:1588`). By then the link names the new tree.
  - The old caller dies on any non-zero exit (`ccd/ccrc:20636-20637`), so only an exit 0 protects that move. Task 2 proves it does.
- **`deploy/deploy.sh` also calls the script, once per unit:** `bash ~/ccrc/deploy/verify-service.sh "$u" || exit 1; done'` (`deploy/deploy.sh:1109`). It gets the classifier with no edit. Task 1's case V16 runs that sweep against the real script.
- **The fleet is halted right now.** The v0.0.78 fleet row is `failed`, and the server (v0.0.76) waits until the operator acks it. Only `POST /api/updates/ack` (`server/src/update/routes.ts:689`) settles that row, so nothing in this wave reaches either box before someone acks it.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:** stop a deliberate supervisor stop from failing a healthy update or deploy, without letting a crash through.

How the incident happened:
- `_upd_sweep`'s Linux arm takes one listing, then verifies each unit in turn, about 8 s each. The first non-zero exit is a `_ccrc_die` (`ccd/ccrc:20634-20637`).
- That die writes phase `failed` (`ccd/ccrc:2351`), which halts every move until an ack.
- At v0.0.78, `ccrc-pwa-still-summit` was archived by hand in the middle of that loop. Its stamp was written at 22:10:50 and the unit stopped at 22:10:51, so the script failed a stop that was made on purpose.

Why the stamp and the unit state are enough to tell the two apart:
- Every stop verb stamps the session through ccd's single stop function, and does so before it runs the disable:
  - first `_reg_set "$id" stopped "$(date +%s) $surface"` (`ccd/ccd:4190`);
  - then `_svc_disable_now "claude-session@$id"` (`ccd/ccd:4202`).
- The verbs that reach it are ws-rm `:7867`, archive `:9861`, reap `:14727`, stop `:24607`, forget `:24697` and reclaim `:27661`.
- ws-rm, forget, reap and reclaim then purge the row, with `_reg_purge` at `:7935`, `:24709`, `:14887` and `:28085`. The purge keeps only `archived`, `reaping` and `generation` (`ccd/ccd:4044`).
- The unit runs with `Restart=always` (`ccd/claude-session@.service:24`). On systemd 255, which the coordinator measured on both boxes, a crash reads `activating`, then `failed`, or `active` behind a new MainPID. It never reads `inactive`.
- That premise covers what one sample shows, not what the whole window shows. A crash that has been *observed* is therefore never classified: a reading of `activating` or `failed`, or a changed MainPID, fails as it does today (ruling 6).

**Architecture:**
- No ring changes. No server, agent or PWA source changes. No change to `ccd/ccd`, `ccd/ccrc`, `deploy/deploy.sh` or any unit file.
- **`deploy/verify-service.sh`:**
  - its header paragraph (`:42-47`) is rewritten in place, with the same number of lines;
  - one new block goes between the knobs (`:62`) and `fail()` (`:64`): two knobs and the function `stopped_on_purpose`;
  - one gated call goes at the head of `fail()`;
  - three existing `fail` calls gain a second argument, each on its own line, so no line moves: the settle check (`:92`), the no-MainPID check (`:95`) and the window check (`:101`). That argument is the word the check observed. The crash-loop call (`:105`) is unchanged and passes nothing.

  The classifier runs only from inside `fail()`, and only for an observed `inactive`, `deactivating` or `nopid`. So every passing path, every observed crash and every unit that is not a session take exactly the code path they take today.
- **Tests:** `agent/test/deploy-verify.test.ts` (Task 1), and one new file, `server/test/ccrc-sweep-deliberate-stop.test.ts` (Task 2).

**Tech Stack:**
- bash `set -uo pipefail` in `deploy/verify-service.sh`.
- vitest in `agent/` and `server/`.
- TypeScript on node `>=22.13.0`.
- No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md`.
- No section of it changes. The design never says what a sweep verify failure should mean (R12 report 2, §0).
- Every departure from what the code documents is a numbered entry in `## Deviations found`.

**Producers:** `main` at `b40f4145e918994054a080106a223d47e55f94c7` (#215, child reclamation wave 4), and the five reports of the R12 investigation.

**D-refs this plan cites as they stand:**
- D-2605: `_reg_purge` keeps `generation`.
- D-3599: an unmeasured listing degrades the sweep rather than failing it.

## Not in this wave

Reviewers: do not raise these.

- **Wave 11 (R12's sweep half, in `ccd/ccrc`, after wave 9 merges).** Wave 9 (run 223) and claim 955 hold `ccd/ccrc`. Wave 11 covers:
  - one shared verify window, made by concurrent per-unit calls, with no new multi-unit argument. The reason is the critic's B2: an older script, reached by a rollback flip, would verify only the first unit;
  - the report-ownership guard on the sweep's die (it writes after `_upd_unlock`, `ccd/ccrc:16843`);
  - no `_ccrc_die` inside a pipeline subshell (I8);
  - the die's wording, which names a backup that no code path restores;
  - the 200-character report cap (M1);
  - the Darwin arm (`ccd/ccrc:20550-20553`), which still dies on a deliberate stop.
- **Revisited in wave 11, with measurement:**
  - whether an UNSTAMPED `inactive` unit should still fail (ruling 3, and the swap rate inside a window);
  - whether one pane death inside the window should halt the fleet. That question goes to the operator after wave 11 (ruling 6).
- **Wave 12** takes the deferrals that the 10-02 entry listed for "wave 10" (ledger, 2026-10-02 entry):
  - R2 (the lease group);
  - R3 (hung or pid-reused updaters, and the probe-to-acquire window);
  - R4-1 and R4-3;
  - R8a–h;
  - R9-R1;
  - R10c, R10f, R10i, R10j and R10k;
  - the `ccd/ccd` harness containment;
  - the dotted-id reverse maps.
- **Not added, by ruling:**
  - a freshness clause on the stamp (ruling 4; critic I1, accepted);
  - an `ActiveEnterTimestamp` read (it is empty once a stopped unit is unloaded, measured on systemd 255);
  - a cap on bulk stops (ruling 5; critic I9).
- **Raised by the investigation, scheduled by no ledger entry:**
  - a second update's try-restart during the first update's verify (critic M4);
  - a deliberate stop that never reaches the console or `update.json` (critic M8).
- **`deploy/deploy.sh`'s loop** stays exactly as it is (ruling 1). It gets the classifier through the script.

## Global Constraints

- **Anchors.**
  - Every anchor is measured at `b40f4145`, quoted, and given as `file:line`.
  - Step 1 of each task re-measures its anchors by their quoted text on the tip being built, after `git fetch origin main` (and a merge if main moved). If the quote and the number disagree, the quote wins.
  - Find code with graphify first where `graphify-out/` exists, then confirm it with `grep -nF` of the quoted text.
- **Scope.**
  - This wave edits only `deploy/verify-service.sh`, `agent/test/deploy-verify.test.ts` and the new `server/test/ccrc-sweep-deliberate-stop.test.ts`.
  - The whole-branch check prints nothing:

        git diff --stat origin/main...HEAD -- ccd deploy/deploy.sh '*.service' '*.timer' agent/src server/src pwa shared server/test/ccdWsHelpers.ts server/test/codexLaneFixture.ts server/test/ccrc-update.test.ts README.md CLAUDE.md agent/CLAUDE.md

  - Task 2's mutation row T2 never writes `ccd/ccrc`. It mutates a scratch copy and points the test file's `CCRC_SRC` at it with a transient edit of the test file, which is restored with `cp` and checked with `cmp`. Confirm that `git status --porcelain ccd/ccrc` prints nothing before the next step.
- **Lines 48–62 of `deploy/verify-service.sh` do not move, and the header edit keeps the line count.**
  - These files cite the script by line number, and this wave may not edit any of them:
    - `ccd/ccrc:25` cites `deploy/verify-service.sh:50-54`;
    - `ccd/ccrc:1693` cites `deploy/verify-service.sh:56-62`;
    - `ccd/ccrc-doctor-checks:153` cites `deploy/verify-service.sh:56-62`;
    - `server/test/ccrc-cli.test.ts:124` cites `verify-service.sh (:50-54)`.
  - So the header rewrite replaces `:42-47` with exactly six lines, and every new line goes below `:62`. The second-argument edits to the three `fail` calls change those lines in place and add none.
  - Case V15 pins this.
  - The check is `diff <(git show origin/main:deploy/verify-service.sh | sed -n '1,41p;48,62p') <(sed -n '1,41p;48,62p' deploy/verify-service.sh)`, and it prints nothing.
- **The script stays Linux-only, measured.** Every caller reaches it only from a Linux arm:
  - `_inst_enable` returns from its Darwin arm first (`ccd/ccrc:14830`);
  - the gate's fleet arm runs in the `else` of the Darwin branch (`ccd/ccrc:19365-19366`);
  - the sweep's Darwin arm runs in-process (`ccd/ccrc:20550-20553`);
  - `deploy.sh` drives `systemctl` on a Linux box.

  So the new server file uses `itLinux`, and nothing here is macOS acceptance.
- **Fixture HOMEs only.**
  - Every case that executes `deploy/verify-service.sh` sets `HOME` to a `mkTmp` directory. The one exception is V20, which runs with `HOME` unset on purpose and with no registry anywhere. Today `runVerify` spreads `process.env` (`agent/test/deploy-verify.test.ts:101-103`), so the real HOME reaches the script (critic I7).
  - The stub records the `HOME` it saw, and `runVerify` asserts that it is the fixture's.
  - Before any spawn that runs the real script or a real `SWEEP_CMD`/`_upd_sweep`, the case proves that `command -v systemctl` and `command -v journalctl` under that spawn's env resolve inside the case's stub bin. This is `runVerify`'s own discipline (`agent/test/deploy-verify.test.ts:89-97`). It matters because `journalctl` is not in the package-wide net (`agent/test/contain-path.setup.ts:89` covers `tmux`, `gh` and `systemctl` only).
  - No case runs `ccd`, `ccrc`, `systemctl`, `tmux`, `gh` or `ssh` against the live box.
  - No case reads or writes a real `~/.cc-sessions`, `~/.ccrc` or `~/.cc-limits`, or touches a `claude-session@*` unit.
  - No mutation row lets the real HOME reach the script either (M13 swaps one fixture HOME for another).
  - Task 2's spawn resolves `bash` once from the parent's PATH, following the `BASH` idiom of `server/test/ccrc-update.test.ts:63-68`.
  - Every spawn carries a `timeout`, set below the timeout of its own `it` (see Suites).
- **The script stays read-only.**
  - It never starts, stops, restarts or resets a unit.
  - It never writes, renames or removes a file in the registry. ccd is the only writer.
  - It reads a registry file only after the test `[ -f ] && [ ! -L ]`. That is ccd's own guard in `_reg_get` (`ccd/ccd:3133`), because a FIFO would block the read forever.
  - The test harness obeys the same rule: `regSnapshot` reads only regular files (V12).
- **Mutation-table discipline.** Every guard ships with a case that goes red when the guard is removed or mutated, and the red is measured.
  - Before each mutation, copy the file to scratch with `cp` (never `git checkout --`). Run the case, restore with `cp`, and check with `cmp` that the restore is byte-identical.
  - Each mutated script must pass `bash -n`.
  - A row is done only when it records a measured red count and the assertion that fired. A crash or a timeout is named as such.
  - Each row lists its full expected red set. A measured set that differs from it is reported, not silently accepted.
- **D-numbers.**
  - This plan defines the departures it makes in `## Deviations found`, under numbers the allocator issued to run 261.
  - A code comment that a departure applies to names that departure's number from `## Deviations found`.
  - A departure the worker finds takes the next number of the reserve the brief names, and is defined in this plan in the commit that first cites it.
  - Never write a number that is neither defined here nor issued to you. Never call the allocator. Never land a `D-TBD-` spelling.
- **Suites.**
  - Run in the foreground, one command per call, inside the package, with a timeout of at least 600000 ms. Use `./node_modules/.bin/vitest run test/<file>.test.ts`, never bare `npx vitest`.
  - Run `npm ci` first wherever `node_modules` is absent (`agent/`, `server/`).
  - **Per-case timeouts.**
    - `agent/vitest.config.ts` sets no `testTimeout`, so the default is 5000 ms. The server's is 20 s on Linux (`server/vitest.config.ts:87`).
    - Every new agent case is declared `it(…, () => {…}, 30_000)`, the idiom of `agent/test/update-spawn.test.ts:117`. Its spawns time out at 15 s at most. V4 and V11, whose mutation rows red by timeout, pass `timeout: 5_000`.
    - Every Task 2 case is `itLinux(…, …, 60_000)`, with spawns at 45 s.
    - So a red always lands on a `code` assertion and never on a runner timeout.
- **No residue in tracked text.** No hostname, username, absolute home path, mount path, docserver URL or org name. Fixture ids are `demo-good`, `demo-gone` and `demo-other`. Run `topology-clean.test.ts` after `git add` of the new file.
- **Commits.**
  - Commit on the workspace branch only, at least once per task, as `fix(update): …` or `test(update): …`. Never use a separate feature branch.
  - Send the wave-done in the same turn as the push, and never end a turn to wait on CI.

## Review Focus

1. **The PASS predicate is exactly the ruling's, and no wider.** A unit passes only when all of these hold:
   - its name is `claude-session@<id>.service`;
   - the check that failed observed `inactive`, `deactivating` or no MainPID. An observed `activating`, `failed` or MainPID change never reaches the classifier (ruling 6, and Reading 5);
   - its `is-active` answer, re-read after the failure, is exactly `inactive`. It is polled again only while it reads `deactivating`, at most `CCRC_VERIFY_STOP_POLLS` times;
   - and either `~/.cc-sessions/<id>.stopped` exists, or `~/.cc-sessions/<id>.uuid` does not.

   Two narrowings sit inside "everything else fails", and neither widens a pass (Reading 1):
   - an ABSENT registry directory or an unset HOME is "not measured", not "purged";
   - an id containing `/` is refused.
2. **Every other outcome is byte-identical to today.**
   - The failure banner, the `status` call and the journal dump stay as they are. Exit 1 stays exit 1.
   - The three `fail` calls that gain an argument keep their message text unchanged.
   - For a unit that is not a session, the `systemctl` query sequence is identical (V13).
   - The pass line `verified: … stable` is unchanged; `ccrc-install.test.ts:4511` pins it for `ccrc.service`.
3. **The move INTO wave 10 is protected.**
   - Task 2 runs `main`'s `_upd_sweep`, sourced without edits, against the new script.
   - A stamped stop caught in the window returns 0, and so does a reclaimed unit that already reads `inactive` at its first read.
   - Its precondition case fails on purpose once `_upd_sweep` stops being the serial shape that the move into wave 10 runs.
4. **The script reads, and never writes.**
   - V12 snapshots the registry before and after, and scans the call log for any verb that changes state.
   - V11 shows that a FIFO stamp is classified without being read.
5. **Fixture HOME everywhere.** `runVerify` asserts the HOME the stub saw, so dropping it fails every case. Every real-script spawn proves where its stubs resolve before it runs.
6. **Line-neutral where other files cite the script by line.** V15 pins the cited lines.

## Risk notes

Each premise below is measured against `b40f4145`. Where a risk is kept on purpose, that is said.

- **The halt and the ack.**
  - Nothing settles the failed fleet row except an ack.
  - After the ack, auto resolves the newest eligible tag: `const newest = eligibleTags(…)[0]; … if (isNewerTag(newest, floor)) return { desiredTag: newest …}` (`server/src/update/resolve.ts:189-191`).
  - If wave 10's prerelease exists by the time of the ack, the fleet box moves from v0.0.78 straight to it. That move runs v0.0.78's sweep with wave 10's script, and it is protected.
  - If the ack comes first, the move to v0.0.79 runs unfixed code on both sides, and a stop during that window can fail it again. That costs one more ack, and the box stays healthy. The coordinator advised the operator to ack.
- **v0.0.79 makes the hazard automatic.**
  - #215's child-reclaim sweep stamps the row and then purges it: `_ws_unsupervise "$id" "$stamp" "$declared"` (`ccd/ccd:27661`), then `_reg_purge "$id"` (`:28085`).
  - The serial loop can reach a unit up to about 11 minutes after the listing, so by then a reclaimed unit usually reads `inactive` at its very first read, with its row purged.
  - The purged arm covers that (critic B1), through the settle check (`:92`, case V17, and Task 2's X4).
- **A rollback by flip to a version older than this wave reads that version's script**, because `~/ccrc` points at the kept tree. That move is unprotected, and this cannot be avoided: the old bytes are what run.
- **The failure path of a session unit gets longer, by at most `CCRC_VERIFY_STOP_POLLS × CCRC_VERIFY_STOP_INTERVAL` (10 × 1 s, pinned by V22).**
  - It gets longer only while the unit reads `deactivating`.
  - A deliberate stop that already reads `inactive` costs one extra `is-active` call.
  - An observed crash, and a unit that is not a session, never reach the re-poll.
  - The deadline exposure of the serial sweep (about 8 s per unit, against the server's 15-minute deadline) is wave 11's to remove.
- **Kept as risks, by ruling:**
  - **A stale stamp can pass a later stop of the same unit** (critic I1).
    - For example: a stop whose `tmux kill-session` failed leaves `.stopped` on a live pane. `_resupervise_live` re-enables the unit without clearing the stamp, and a later swap stops it.
    - Under `Restart=always` on systemd 255, `inactive` is always somebody's stop, so this can never pass a crash on its own (ruling 4).
  - **A swap caught mid-carry and a hand `systemctl stop` still fail the update.** The swap writes no stamp: "Note the swap does NOT write `.stopped`" (`ccd/ccd:24268-24269`). This is ruling 3.
  - **One pane death inside the window still fails as `CRASH-LOOPING`** (`deploy/verify-service.sh:104-105`). It still fails when a stop follows it before the re-read (V7b), because the gate in `fail()` never classifies the crash-loop call. This is ruling 6.
  - **A ccd verb that stops many sessions is passed one unit at a time** (ruling 5).
- **A pane death that the window cannot see, kept by measurement.**
  - The window has only two samples, one at each end.
  - Suppose a pane dies after `:94`, systemd restarts it within `RestartSec=3` (`ccd/claude-session@.service:25`), and then a stamped stop lands before `:99`. Then `:99` reads `inactive` and the unit passes.
  - The same holds for a pane death between `:91` and `:94` followed by a stop: it reaches `:95` as "no MainPID".
  - The script cannot see the churn in either case, because `p2` is never read and `NRestarts` is deliberately not read (`deploy/verify-service.sh:37-40`). Today's script fails these cases only because the stop makes them fail.
  - This needs a pane death and a stop of the same unit inside one 5-second window. Wave 11's single window is where it can be measured.
- **A check that lands mid-purge still fails a deliberate stop, and this is kept, measured.**
  - `_reg_purge` unlinks one file per `rm -f` fork, in glob order: `for f in "$REG/$id".*; do … rm -f "$f"` (`ccd/ccd:4035-4055`). `.stopped` sorts before `.uuid`.
  - So a check that lands between those two unlinks sees neither the stamp nor a purged row, and fails.
  - That window is a few process forks long, against an 8 s check per unit. It fails closed, exactly as today, at the cost of one ack.
  - A second registry measurement after a sleep could be pinned only through a stub `sleep`. It is rejected because it widens ruling 2's single settle-and-test and fails closed as today (critic review live-safety 4).
- **The no-crash-reads-`inactive` premise follows from `Restart=always`'s documented semantics, and is measured on systemd 255.**
  - Both live boxes run 255.4, measured by the coordinator.
  - The tree measures this nowhere. Its only basis is `Restart=always` (`ccd/claude-session@.service:24`): systemd restarts the unit after every exit except an explicit stop, and a burst past `StartLimitBurst` ends `failed`. Nothing in that is specific to v255.
  - The repo is public and the script ships to every installer, so the WHY comment cites both the documented semantics and the systemd 255 measurement. No version check is added, and wave 11 adds no doctor check (Reading 6).
- **The gate and `_inst_enable` are unchanged.**
  - They verify only `ccrc-agent.service` and `ccrc.service` (`ccd/ccrc:19366`, `:14942-14945`).
  - The classifier's scope check returns before any query or registry read for those units.
- **No parser reads the script's output.**
  - All four callers use only its exit code:
    - `_upd_sweep`: `bash "$verify" "$u" || _ccrc_die`;
    - the gate: `>/dev/null 2>&1 || vrc=$?`;
    - `_inst_enable`: `|| _ccrc_die`;
    - `deploy.sh`: `|| exit 1`.
  - The only test that pins an output line pins the non-session pass line (`server/test/ccrc-install.test.ts:4511`).
  - The new line goes to stdout, where today's pass line goes.
- **`deploy.sh`'s `SWEEP_CMD`, run by V16, also reads `/proc` and calls the real `pgrep -x "tmux: server"`** (`deploy/deploy.sh:1104`). It writes the answer to stderr. That call is read-only, and the existing `SWEEP_CMD` cases already make it (`agent/test/deploy-verify.test.ts:1243`). `systemctl` and `journalctl` are proven to be stubs first.
- **Two citations into `agent/test/deploy-verify.test.ts` are already wrong at main, and this wave shifts them further.**
  - `ccd/ccrc:13644` cites `:1758-1791`, and `server/test/ccrc-install.test.ts:2103` cites `:1750-1776`.
  - At `b40f4145` those lines hold the remote-control seed case (`:1745`). The shim cases they mean sit at `:2102-2140`.
  - Neither file may be edited here: `ccd/ccrc` by ruling 1, and `ccrc-install.test.ts` because wave 9 holds it.
  - Nothing counts these citations. `session-hook.test.ts`'s census corpus (the 2026-09-09 spec, the 2026-09-10 plan-a, `README.md`) holds no citation into either edited file (measured with `grep -c`).
  - Two more are correct at `b40f4145` and will drift with the harness edits: `docs/superpowers/specs/2026-08-14-fleet-robustness-design.md:1595` cites `:393`, and `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md:49` cites `:579-584`. Both are snapshots, out of scope, and are not edited.
- **Docs: none edited, measured.**
  - No sentence in `README.md` or `CLAUDE.md` states the verify's pass/fail rule. `README.md:4883` names the script only, and `README.md:875` describes the sweep's KillMode preflight.
  - `agent/CLAUDE.md:65` describes the agent unit's check, which is unchanged.
  - `README.md` is claimed by another run, so this wave leaves it untouched.

## Deviations found

These are departures from what the code at `b40f4145` documents.

- **D-3946** — *The registry read.*
  - `deploy/verify-service.sh`'s header promises "Read-only throughout: `is-active`, `show`, `status`, `journalctl`. It never starts, stops, restarts or resets anything" (`:42-43`). `ccd/ccrc`'s comment calls the script the Linux twin "which reads systemd's vocabulary" (`ccd/ccrc:20463`).
  - It now also reads ccd's registry under `$HOME/.cc-sessions`, for a `claude-session@<id>.service` unit that fails a check after it observed `inactive`, `deactivating` or no MainPID. The read is one directory test, `-e <id>.stopped`, `-e <id>.uuid`, and one guarded one-line read of `<id>.stopped` to name the evidence.
  - It writes nothing there, and ccd stays the only writer.
  - The header paragraph says so, rewritten in place in six lines.
- **D-3947** — *An exit 0 that does not mean "stayed up".*
  - The script's contract, in its header and in every caller's comment, is that exit 0 means the restarted process stayed up across the window. Two examples:
    - deploy.sh's sweep "is then held to the same standard as the agent itself: verify-service.sh, per unit" (`deploy/deploy.sh:985-986`);
    - `_upd_sweep`'s "Each restarted supervisor is held to the same standard as the services the staged install just verified" (`ccd/ccrc:20614-20615`).
  - For a session unit, exit 0 now also means it settled `inactive` and was stopped on purpose. That reaches both sweeps through the script, with no edit to either caller.
  - It does not reach the gate or `_inst_enable`, because their units are never sessions.
  - The new line names the case, so the transcript never reads it as "stayed up".
- **D-3948** — *A third name for the registry root.*
  - Today `$HOME/.cc-sessions` is spelled under two names by design:
    - `_SVC_REG=`, the same bytes in ccd's and ccrc's shared block (`ccd/ccd:67`, `ccd/ccrc:96`, "one path with two names by necessity");
    - `REG=` (`ccd/ccd:1229`). The comment at `ccd/ccd:1231` reads "Derived from HOME with no env override".
  - `server/test/macos-platform.test.ts:93-94` pins the two spellings in `ccd/ccd` as equal.
  - The script cannot source either file, because it runs from the new tree in a fresh `bash`. So it spells the root a third time, as `reg`, derived from HOME with no env override, exactly as ccd does.
  - Case V14 pins it against ccd/ccd's `REG=` line.
- **D-3949** — *The Darwin arm, and the prose this wave may not edit.*
  - The macOS sweep still dies on a deliberate stop, because `_ccrc_job_stayed_up` has no classifier (`ccd/ccrc:20550-20553`).
  - So the two arms no longer hold "the same standard", which `_upd_sweep`'s Darwin header claims ("Same job, same guard, different observable", `ccd/ccrc:20486`).
  - These comments now overstate the contract. Each sits in a file that ruling 1 (`ccd/ccrc`) or the scope (`deploy/deploy.sh`) keeps out of this wave:
    - `ccd/ccrc:20460-20466` (the twin "stays the one implementation there");
    - `ccd/ccrc:20542-20546`;
    - `ccd/ccrc:20614-20615`;
    - `deploy/deploy.sh:985-986`.
  - Wave 11 rewords them together with the Darwin arm.
  - macOS boxes are not centrally managed, so no control-plane halt follows from this.
- **D-3950** — *X0's die-line quote is the Linux arm's, not the plan's prefix* (found by the worker, Task 2).
  - The X0 row asks `_upd_sweep`'s body to hold `|| _ccrc_die "$u was restarted and did not stay up`. The Darwin arm carries the same prefix (`ccd/ccrc:20552`), so T2, which mutates only the Linux arm's die (`ccd/ccrc:20637`), could not turn that substring red.
  - X0 asserts the Linux arm's longer quote instead, through `— read: systemctl --user status $u.`. That is the text Task 2 Step 1 already anchors at `:20637`.
  - With it, T2 reds X0 and X3 as the T2 row lists. The plan's X0 row is left as written; this entry governs it.

## File structure

**New**
- `docs/superpowers/plans/2026-10-04-centralised-update-w10-verify-deliberate-stop.md` (this plan).
- `server/test/ccrc-sweep-deliberate-stop.test.ts` (Task 2): the cross-version case.

**Changed**
- **`deploy/verify-service.sh` (Task 1):**
  - `:42-47`, rewritten in place with six lines;
  - a new block inserted after `:62` (`LOG_LINES="${CCRC_VERIFY_LOG_LINES:-60}"`). It holds `STOP_POLLS`, `STOP_INTERVAL`, the WHY comment and `stopped_on_purpose()`;
  - the head of `fail()` (`:64`), which gains one gated call;
  - the `fail` calls at `:92`, `:95` and `:101`, each of which gains a second argument on the same line.
- **`agent/test/deploy-verify.test.ts` (Task 1):**
  - `stubs()` (`:54-84`) records `$HOME`, and its sequence builder moves to module scope as `seqArm`;
  - `runVerify()` (`:86-109`) takes a fixture HOME, the stop knobs and a spawn timeout, and asserts the HOME it saw;
  - the no-unit case (`:153-160`) gets a fixture HOME;
  - new helpers `plantReg`, `regSnapshot`, `sweepStubs` and `assertStubsResolve`;
  - a new top-level describe, appended at the end of the file.

**Run, not edited:**
- the agent suite in full;
- the `server/test/` files that name `verify-service` or import `installTreeFixture`:
  - `ccrc-install`, `ccrc-update`, `ccrc-doctor`, `ccrc-cli`, `build-release`;
  - `single-definition`, `ccrc-uninstall`, `ccrc-install-graphify`, `ccrc-versioned-audit`;
- `macos-platform`, `typecheck-tests` (the type gate for `agent/test/`), `topology-clean`, `deviation-refs` and `dtbd`.

## Tasks

### Task 1: `verify-service.sh`'s deliberate-stop classifier, on fixture HOMEs

**Files:**
- **Modify `deploy/verify-service.sh`:** the header `:42-47` in place; a new block after `:62`; the head of `fail()`; the second argument at `:92`, `:95` and `:101`.
- **Modify `agent/test/deploy-verify.test.ts`:** as listed in File structure.

**Interfaces and code**

The header. These six lines replace `:42-47` exactly:
```bash
# Read-only throughout: `is-active`, `show`, `status`, `journalctl` — and, for a
# claude-session@<id> unit that fails a check, a read of ccd's registry (below;
# ccd is its only writer). It never starts, stops, restarts or resets anything,
# and writes nothing. Pinned by agent/test/deploy-verify.test.ts against a stubbed
# `systemctl`: healthy, crash-looping, inactive, never-started, and the
# deliberate-stop classifier's cases.
```

The new block goes after `:62`. `:63` stays blank, and one blank line separates the block from `fail() {`:
```bash
# The deliberate-stop re-poll's bound (wave 10, R12): at most STOP_POLLS more
# `is-active` reads, STOP_INTERVAL seconds apart, while a claude-session@ unit
# reads `deactivating`. Overridable for the reason SETTLE and WINDOW are; the
# DEFAULTS bound the extra wait at ~10s, and only a FAILING session unit pays it.
STOP_POLLS="${CCRC_VERIFY_STOP_POLLS:-10}"
STOP_INTERVAL="${CCRC_VERIFY_STOP_INTERVAL:-1}"

# ── A DELIBERATE SUPERVISOR STOP IS NOT A CRASH (wave 10, R12) ─────────────
# `ccrc update`'s sweep and deploy.sh's SWEEP_CMD list the active supervisors
# ONCE, then run this script per unit, serially, ~8s each, and the first
# non-zero exit fails the run. A session stopped on purpose while that loop is
# still walking — an archive, `ccd stop`, ws-rm, forget, reap, a child reclaim —
# read as a crash: R12, a hand archive inside v0.0.78's fleet sweep, which
# failed a healthy update and halted every move until an operator acked it.
#
# Every one of those verbs goes through ccd's one stop function,
# `_ws_unsupervise`, which stamps `<id>.stopped` BEFORE it runs `systemctl
# --user disable --now`; ws-rm, forget, reap and reclaim then purge the row
# (`_reg_purge` takes `.stopped` and `.uuid`). And under the unit's
# Restart=always a crash never reads `inactive`: systemd restarts the unit
# after every exit except an explicit stop, and a burst past StartLimitBurst
# ends `failed` (systemd.service(5); measured on systemd 255). A crash
# reads `activating`, then `failed` once the start limit is spent, or `active`
# behind a new MainPID. So a session unit that SETTLES `inactive` with the stamp
# present, or with its row gone, was stopped on purpose: it gets its own line
# and exit 0. Everything else fails exactly as before.
#
# ONLY A STOP-SHAPED FAILURE IS CLASSIFIED. `fail` is told the word its check
# observed: `inactive`, `deactivating`, or `nopid` (active, then no MainPID — a
# stop that finished between the two reads). A check that SAW a crash —
# `activating`, `failed`, or a MainPID that changed — never reaches the
# classifier, so one pane death followed by a stop still fails.
#
# Deliberately NOT here (coordinator rulings, wave 10): an unstamped `inactive`
# unit (a hand stop, a swap caught mid-carry — the swap writes no stamp) still
# fails; no freshness test on the stamp (`inactive` under Restart=always is
# always somebody's stop, so a stale stamp can only pass a deliberate stop;
# ActiveEnterTimestamp is empty once a stopped unit is unloaded, systemd 255);
# no cap on how many units may be stopped (this script asks whether the NEW
# supervisor stays up); one pane death inside the window still fails.
#
# REG is ccd's own root, derived from HOME with no env override exactly as
# ccd/ccd's `REG=` is (pinned by deploy-verify.test.ts). An ABSENT registry, or
# no HOME, is not a purged row — nothing was measured — so it fails. The scope
# is the unit's NAME: ccrc.service and ccrc-agent.service never reach the
# registry, and never cost a query.
stopped_on_purpose() {   # -> 0, and one stdout line, iff $UNIT is a session stopped on purpose
  local id reg st n=0 s evidence
  case "$UNIT" in claude-session@?*.service) ;; *) return 1 ;; esac
  id="${UNIT#claude-session@}"; id="${id%.service}"
  case "$id" in */*) return 1 ;; esac
  [ -n "${HOME:-}" ] || return 1
  reg="$HOME/.cc-sessions"
  [ -d "$reg" ] || return 1
  st=$(systemctl --user is-active "$UNIT" 2>&1)
  while [ "$st" = deactivating ] && [ "$n" -lt "$STOP_POLLS" ]; do
    sleep "$STOP_INTERVAL"
    n=$((n + 1))
    st=$(systemctl --user is-active "$UNIT" 2>&1)
  done
  [ "$st" = inactive ] || return 1
  if [ -e "$reg/$id.stopped" ]; then
    # `-f` and not a symlink BEFORE the read, as ccd's `_reg_get` does: a FIFO
    # here would block the read for ever. Present is enough; the read only
    # names the evidence.
    s="not read: not a plain file"
    if [ -f "$reg/$id.stopped" ] && [ ! -L "$reg/$id.stopped" ]; then
      s=""; IFS= read -r s < "$reg/$id.stopped" || :
      s="reads '${s:0:64}'"
    fi
    evidence="ccd's stop stamp ~/.cc-sessions/$id.stopped is present ($s)"
  elif [ ! -e "$reg/$id.uuid" ]; then
    evidence="its registry row is purged (no ~/.cc-sessions/$id.uuid)"
  else
    return 1
  fi
  echo "stopped on purpose: $UNIT settled 'inactive', and $evidence — a deliberate stop, not a crash"
}
```
The WHY comment above `stopped_on_purpose` names D-3946, D-3947 and D-3948 from `## Deviations found`, each at the sentence it governs.

The head of `fail()`:
```bash
fail() {
  # A deliberate supervisor stop is not a failure (wave 10, R12): see
  # stopped_on_purpose above. Only a stop-shaped observation ($2) is classified.
  case "${2:-}" in inactive|deactivating|nopid) stopped_on_purpose && exit 0 ;; esac
  echo "" >&2
  …   # the rest of fail() byte-identical
```

The three calls. Each stays on its own line, and each message is byte-identical:
```bash
[ "$active_now" = "active" ] || fail "unit is '$active_now', not 'active', ${SETTLE}s after the restart" "$active_now"
{ [ -n "$p1" ] && [ "$p1" != "0" ]; } || fail "unit reports no MainPID ${SETTLE}s after the restart — nothing is running" nopid
  || fail "unit was 'active' then became '$active_after' during the ${WINDOW}s observation window" "$active_after"
```
The crash-loop call (`[ "$p1" = "$p2" ] || fail "MainPID changed …"`) is unchanged and passes no second argument.

**The exact lines the new cases assert:**
- **stamped:** `stopped on purpose: claude-session@demo-gone.service settled 'inactive', and ccd's stop stamp ~/.cc-sessions/demo-gone.stopped is present (reads '1791151850 ccd') — a deliberate stop, not a crash`;
- **purged:** `stopped on purpose: claude-session@demo-gone.service settled 'inactive', and its registry row is purged (no ~/.cc-sessions/demo-gone.uuid) — a deliberate stop, not a crash`;
- **FIFO:** `… ccd's stop stamp ~/.cc-sessions/demo-gone.stopped is present (not read: not a plain file) — a deliberate stop, not a crash`.

**Test harness** (`agent/test/deploy-verify.test.ts`):
```ts
/** One unit's answers, consumed one per call and the last one repeated — the
 *  sequence `stubs()` has always built, hoisted so `sweepStubs` shares it. */
const seqArm = (counter: string, values: string[]): string => /* stubs()'s `seq` body, verbatim, keyed on `counter` */;

// stubs(): one added line after `echo "systemctl $*" >> "$D/calls"`:
//   'printf \'%s\\n\' "$HOME" > "$D/home-seen"\n'

function runVerify(dir: string, unit = 'ccrc-agent.service',
  opts: { home?: string; env?: Record<string, string>; timeout?: number } = {},
): { code: number; stdout: string; stderr: string; calls: string; home: string } {
  const home = opts.home ?? mkTmp('ccrc-agent-verifyhome-');
  // … the existing PATH proof, unchanged …
  const r = spawnSync('bash', [VERIFY, unit], {
    encoding: 'utf8', timeout: opts.timeout ?? 15_000,
    env: {
      ...process.env, PATH, HOME: home,
      CCRC_VERIFY_SETTLE: '0', CCRC_VERIFY_WINDOW: '0', CCRC_VERIFY_LOG_LINES: '5',
      CCRC_VERIFY_STOP_INTERVAL: '0', ...opts.env,
    },
  });
  // … calls read as today …
  // FIXTURE HOME, PROVEN (wave 10, critic I7): the script now reads $HOME/.cc-sessions for a session unit,
  // so the HOME it ran under is asserted, never assumed.
  const seen = existsSync(path.join(dir, 'home-seen')) ? readFileSync(path.join(dir, 'home-seen'), 'utf8').trim() : '';
  expect(seen, 'verify-service.sh ran under a HOME that is not the fixture\'s').toBe(home);
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', calls, home };
}

/** `<home>/.cc-sessions/<name>` = content, for each entry. An empty map makes the dir and nothing in it. */
function plantReg(home: string, files: Record<string, string>): void;
/** [name, entry] for every entry under <home>/.cc-sessions, sorted — the before/after of V12. Each entry is
 *  `lstatSync`'d FIRST and read ONLY when `isFile()`: a FIFO is recorded as '<fifo>', a symlink as '<symlink>',
 *  anything else as '<other>', never opened. A sync read of V11's FIFO would block the vitest worker in
 *  `open()` for ever, beyond the reach of any `it` timeout — the hazard the script's own guard exists for. */
function regSnapshot(home: string): Array<[string, string]>;
/** Before a spawn that runs the REAL script: `command -v systemctl` and `command -v journalctl`, run through
 *  `sh -c` under exactly the env the spawn will use, must each resolve inside `bin`; REFUSES otherwise. */
function assertStubsResolve(env: NodeJS.ProcessEnv, bin: string): void;
/** deploy.sh's SWEEP_CMD over several units with the REAL script, planted in `<home>/stubbin` (the existing
 *  sweep cases' bin): SHOW_KILLMODE first, then list-units (unfiltered and --state=active list every unit;
 *  --state=failed lists none), try-restart exit 0, `status` recorded, and `is-active` / `show -p MainPID --value`
 *  answered PER UNIT (the unit is the last argv word) from `seqArm` counters keyed by the unit's index. A stub
 *  `journalctl` records its argv. Anything else: "stub systemctl: unexpected argv", exit 64. Returns the bin. */
function sweepStubs(home: string, units: Array<{ unit: string; isActive: string[]; mainPid: string[] }>): string;
```
The no-unit case (`:153-160`) becomes `env: { ...process.env, HOME: mkTmp('ccrc-agent-verifyhome-'), PATH: … }`.

**The new describe: `'verify-service.sh tells a deliberate supervisor stop from a crash (wave 10, R12)'`, appended at the end of the file.**

- `U` is `claude-session@demo-gone.service`.
- "stamp" means `plantReg(home, { 'demo-gone.uuid': 'u', 'demo-gone.stopped': '1791151850 ccd' })`, the live content measured at 22:10:50.
- Every case uses `runVerify` unless it says otherwise, and every case is declared with a timeout of `30_000`.
- A row that gives no `mainPid` uses `['4242']`.
- "N `is-active`" means the number of `calls` lines that contain ` is-active `.

| # | Case | Stubs (`isActive` / `mainPid`) and plant | Expected |
|---|---|---|---|
| V1 | stopped on purpose, stamped (window path) | `['active','inactive','inactive']` / `['4242']`; stamp | exit 0. stdout is the stamped line. stderr has no `DEPLOY FAILED`. `calls` is exactly: is-active U, `show -p MainPID --value` U, is-active U, is-active U. No `status`, no `journalctl` |
| V2 | row purged | the same; `plantReg(home, { 'demo-gone.generation': '7' })` (the purge keeps `generation`, D-2605) | exit 0, the purged line |
| V3 | caught `deactivating` | `['active','deactivating','deactivating','deactivating','inactive']`; stamp | exit 0, the stamped line, 5 `is-active` |
| V4 | the bound | `['active','deactivating']` (repeats); stamp; `env: { CCRC_VERIFY_STOP_POLLS: '3' }`, `timeout: 5_000` | exit 1 (not -1). stderr has `became 'deactivating'`. Exactly 6 `is-active` (settle, window, the first re-read, 3 polls) |
| V5 | unstamped, row kept | `['active','inactive','inactive']`; `{ 'demo-gone.uuid': 'u' }` | exit 1. stderr has `became 'inactive'` and `DEPLOY FAILED`; `calls` has `journalctl` |
| V6 | `it.each` `failed`, `activating` seen in the window, with a stamp: never classified | `['active', X, 'inactive']`; stamp | exit 1, `became 'X'`, exactly 2 `is-active` |
| V6b | `activating` at the settle read, with a stamp: never classified | `['activating','inactive']` / `['0']`; stamp | exit 1, `unit is 'activating', not 'active'`, exactly 1 `is-active` |
| V6c | `it.each` `active`, `failed`, `activating` as the classifier's re-read, with a stamp | `['active','inactive', X]`; stamp | exit 1, `became 'inactive'`, exactly 3 `is-active` |
| V7 | MainPID churn, with a stamp (ruling 6) | `['active','active','active']` / `['111','222']`; stamp | exit 1, `CRASH-LOOPING`, exactly 2 `is-active` |
| V7b | MainPID churn, then a stamped stop before any re-read (ruling 6) | `['active','active','inactive']` / `['111','222']`; stamp | exit 1, `CRASH-LOOPING`, exactly 2 `is-active` |
| V8 | scope (critic I5) | unit `ccrc-agent.service`; `['active','inactive','inactive']`; `{ 'ccrc-agent.stopped': '1 ccd' }` and NO `ccrc-agent.uuid` | exit 1; exactly 2 `is-active`. Without the scope check, the id would strip to `ccrc-agent` and match both arms |
| V9 | another session's stamp | `['active','inactive','inactive']`; `{ 'demo-gone.uuid': 'u', 'demo-other.stopped': '1 ccd' }` | exit 1 |
| V10 | absent registry | `['active','inactive','inactive']`; no `.cc-sessions` dir | exit 1; exactly 2 `is-active` |
| V11 | FIFO stamp | `['active','inactive','inactive']`; `demo-gone.uuid`, plus `spawnSync('mkfifo', [<reg>/demo-gone.stopped])`; `timeout: 5_000` | exit 0 (not -1), the FIFO line |
| V12 | read-only | `regSnapshot` before and after V1, V2 and V11's shapes, run in this case. V11's entry reads `'<fifo>'` | each snapshot is unchanged. No `calls` line matches `/ (start\|stop\|restart\|try-restart\|reset-failed\|enable\|disable\|kill\|daemon-reload) /` |
| V13 | non-session sequence (lands FIRST, green on main) | `ccrc-agent.service`; `['active','inactive']` / `['4242']`; no registry | exit 1. `calls.trim().split('\n')` equals exactly: `systemctl --user is-active ccrc-agent.service`, `systemctl --user show -p MainPID --value ccrc-agent.service`, `systemctl --user is-active ccrc-agent.service`, `systemctl --user status --no-pager --lines=0 ccrc-agent.service`, `journalctl --user -u ccrc-agent.service -n 5 --no-pager` |
| V14 | the registry root (D-3948) | reads `ccd/ccd` and `VERIFY` | `ccd/ccd` matches `/^REG="\$HOME\/\.cc-sessions"$/m`, and the script holds the line `  reg="$HOME/.cc-sessions"` |
| V15 | cited lines (lands FIRST, green on main) | reads `VERIFY` | `:50` `UNIT="${1:-}"`, `:53` `  exit 2`, `:54` `fi`, `:56` starts `# Overridable so the test does not have to wait 8 seconds per case.`, `:60` `SETTLE="${CCRC_VERIFY_SETTLE:-3}"`, `:61` `WINDOW="${CCRC_VERIFY_WINDOW:-5}"`, `:62` `LOG_LINES="${CCRC_VERIFY_LOG_LINES:-60}"`. The comment names the four citing sites |
| V16 | deploy.sh's sweep, REAL script | `/SWEEP_CMD='([\s\S]*?)'\n/` (as `:393`); `plantUnit(home, true)`; the real `VERIFY` copied to `<home>/ccrc/deploy/`; `sweepStubs` with `claude-session@demo-good.service` `['active','active']`/`['4242','4242']` and then U `['active','inactive','inactive']`/`['5151']`. `assertStubsResolve(env, bin)` runs first. Spawn `bash -c` with `HOME: home`, the knobs and `timeout: 15_000` | (a) stamp: exit 0; stdout has `verified: claude-session@demo-good.service active, MainPID 4242 stable across 0s` and the stamped line. (b) `{ 'demo-gone.uuid': 'u' }` only: exit 1; stderr has `DEPLOY FAILED — claude-session@demo-gone.service` |
| V17 | inactive at the settle read: a reclaimed unit the loop reaches late | `['inactive','inactive']`; `plantReg(home, { 'demo-gone.generation': '7' })` | exit 0, the purged line. `calls` is exactly is-active U, is-active U (no `show`, no `status`) |
| V18 | no MainPID: a stop that finished between the settle read and the MainPID read | `['active','inactive']` / `['0']`; stamp | exit 0, the stamped line. `calls` is exactly is-active U, `show -p MainPID --value` U, is-active U |
| V19 | an id with `/` is refused | unit `claude-session@../outside.service`; `['active','inactive','inactive']`; `plantReg(home, {})` plus `<home>/outside.stopped` = `1 ccd` | exit 1; exactly 2 `is-active` |
| V20 | HOME unset | a direct spawn (not `runVerify`): env is `process.env` without `HOME`, plus PATH and the knobs. `assertStubsResolve` first. `['active','inactive','inactive']`; no registry anywhere | exit 1. stderr has `DEPLOY FAILED` and no `unbound variable` |
| V21 | the evidence cap | `['active','inactive','inactive']`; `{ 'demo-gone.uuid': 'u', 'demo-gone.stopped': 'x'.repeat(100) }` | exit 0. stdout holds `(reads '${'x'.repeat(64)}')` and not 65 `x` |
| V22 | the default bound | reads `VERIFY` | it holds the lines `STOP_POLLS="${CCRC_VERIFY_STOP_POLLS:-10}"` and `STOP_INTERVAL="${CCRC_VERIFY_STOP_INTERVAL:-1}"`. The comment names the Risk note's "10 × 1 s" |

- [ ] **Step 1: Re-measure the base,** on the tip being built, after `git fetch origin main`:
  ```bash
  git rev-parse --short HEAD origin/main
  grep -n '^REG="\$HOME/\.cc-sessions"$' ccd/ccd                     # :1229
  grep -nF '_SVC_REG="$HOME/.cc-sessions"' ccd/ccd ccd/ccrc          # ccd :67, ccrc :96
  grep -nF 'Derived from HOME with no env override' ccd/ccd          # :1231
  grep -nF '_reg_set "$id" stopped "$(date +%s) $surface"' ccd/ccd   # :4190
  grep -nF '_svc_disable_now "claude-session@$id" 2>/dev/null' ccd/ccd   # :4202
  grep -nF '[[ "$suffix" == archived || "$suffix" == reaping || "$suffix" == generation ]] && continue' ccd/ccd   # :4044
  grep -nF 'rm -f "$f" || _reg_purge_unremoved "$f"' ccd/ccd         # inside _reg_purge, ~:4054
  grep -nF '[[ -e "$REG/$id.stopped" ]] && { echo stopped; return 0; }' ccd/ccd   # :4244
  grep -nF "_reg_get() { [[ -f \"\$REG/\$1.\$2\" && ! -L" ccd/ccd     # :3133
  grep -nF "die \"no registry for '\$id' (run ccd start first)\"" ccd/ccd   # :21744
  grep -n '_ws_unsupervise "\$id"\|_reg_purge "\$id" ||' ccd/ccd    # :7867 :7935 :9861 :14727 :14887 :24607 :24697 :24709 :27661 :28085
  grep -nF 'Note the swap does' ccd/ccd                              # :24268
  grep -n 'verify-service' ccd/ccrc deploy/deploy.sh | grep -v ':[0-9]*:\s*#'   # ccrc :14942 :19365 :19366 :19368 :20619; deploy.sh :973 :1109 :1259
  grep -n 'verify-service.sh:[0-9]\|verify-service.sh (:' ccd/ccrc ccd/ccrc-doctor-checks server/test/ccrc-cli.test.ts   # :25 :1693 / :153 / :124
  grep -nF 'if [ "$CCD_OS" = darwin ]; then _inst_enable_darwin' ccd/ccrc   # :14830
  grep -rn 'stable across \${WINDOW}\|MainPID [0-9]* stable\|stopped on purpose' ccd deploy server/src agent/src server/test agent/test   # verify-service.sh:107, ccrc-install.test.ts:4511, deploy-verify.test.ts:115
  grep -n 'Restart=\|StartLimit\|KillMode' ccd/claude-session@.service   # :14 :15 :18 :19 :24 :29 (RestartSec=3 is :25, not matched)
  grep -n '^function stubs\|^function runVerify\|refuses to run without a unit name\|^const SHOW_KILLMODE\|^const plantUnit' agent/test/deploy-verify.test.ts   # :54 :86 :153 :230 :187
  grep -n 'SWEEP_CMD=' agent/test/deploy-verify.test.ts              # :393 :1060 :1130 :1182 :1243 (V16 copies :393's regex)
  grep -n "for (const name of \['tmux', 'gh', 'systemctl'\]" agent/test/contain-path.setup.ts   # :89
  grep -n '"include"' agent/tsconfig.json agent/test/tsconfig.tests.json   # src only / tests-inclusive
  wc -l deploy/verify-service.sh agent/test/deploy-verify.test.ts   # 107, 2219
  ```
  Every quote must match. Where only a line number disagrees, the quote wins: record the new number and go on. If a quote is missing, stop and report it.
- [ ] **Step 2: The harness, green on main's script.**
  - Edit `stubs()` (the `home-seen` line and `seqArm`), `runVerify()` and the no-unit case.
  - Add `plantReg`, `regSnapshot` (lstat-typed), `assertStubsResolve` and `sweepStubs`.
  - Run `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts`. **Expected:** every existing case passes, each now under a fixture HOME.
  - Commit: `test(update): every deploy-verify case runs verify-service.sh on a fixture HOME (wave 10)`.
- [ ] **Step 3: Pin first, on main's script.**
  - Add V13 and V15, run the file, and expect both green.
  - Mutation check: transiently insert one comment line above `:50` of the script. V15 must go red. Then restore it (`cp` + `cmp`).
  - Commit.
- [ ] **Step 4: Write the cases that must fail on main's script,** and measure them:
  - Add V1–V12, V14, V16 and V17–V22, with the variants V6, V6b, V6c and V7b.
  - Run the file.
  - **Expected red:**
    - V1, V2, V3, V11, V17, V18 and V21 fail on `toBe(0)` (they get 1);
    - V16(a) fails on its exit code;
    - V4 fails on its `is-active` count (2, not 6);
    - V6c ×3 fail on their `is-active` count (2, not 3);
    - V14 fails, because the script has no `reg=` line;
    - V22 fails, because the script has no `STOP_POLLS=` line.
  - **Expected green, because these cases fail today too:** V5, V6 ×2, V6b, V7, V7b, V8, V9, V10, V12, V16(b), V19 and V20.
  - Record each red's assertion. Commit the reds only if the workspace convention allows it; otherwise go straight to Step 5 and commit both together.
- [ ] **Step 5: Implement.**
  - Edit the header in place. Add the block after `:62`, the gated call at the head of `fail()`, and the second argument at the three `fail` calls.
  - `bash -n deploy/verify-service.sh` must print nothing.
  - `diff <(git show origin/main:deploy/verify-service.sh | sed -n '1,41p;48,62p') <(sed -n '1,41p;48,62p' deploy/verify-service.sh)` must print nothing.
  - `wc -l deploy/verify-service.sh` must equal 107 plus the lines of the new block plus the three lines added at the head of `fail()`, which are two comment lines and the `case`.
  - Run `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts`. **Expected:** every case passes.
- [ ] **Step 6: The mutation table, measured.** Do one row at a time: `cp` to scratch, apply the mutation, `bash -n`, run the file, then `cp` back and `cmp`. Rows marked (T2) are measured again by Task 2's own file, in its Step 5.

  | # | Guard (quoted) | Mutation | Goes red (full expected set) | Assertion that fires |
  |---|---|---|---|---|
  | M1 | `case "${2:-}" in inactive\|deactivating\|nopid) stopped_on_purpose && exit 0 ;; esac` | delete the line | V1, V2, V3, V4, V6c ×3, V11, V17, V18, V21, V16(a); (T2) X2, X3b, X4 | `expect(r.code).toBe(0)`; V4 and V6c ×3: the `is-active` count (2, not 6; 2, not 3); X3b: the log (15 lines, not 16) |
  | Mgate | the same `case` gate | replace it with `stopped_on_purpose && exit 0` | V6 ×2, V6b, V7, V7b | V6 ×2, V6b, V7b: `toBe(1)` (they get 0); V7: the `is-active` count (3, not 2) |
  | Mword | the second argument at `:92` and `:95` | drop `"$active_now"` and `nopid` from those two calls | V17, V18; (T2) X4 | `toBe(0)` |
  | M2 | `case "$UNIT" in claude-session@?*.service) ;; *) return 1 ;; esac` | delete it | V8 | `toBe(1)` and the `is-active` count of 2 |
  | M3 | `if [ -e "$reg/$id.stopped" ]` | `if compgen -G "$reg/*.stopped" >/dev/null` | V9 | `toBe(1)` |
  | M4 | `[ -d "$reg" ] \|\| return 1` | delete it | V10 | `toBe(1)` (the purged arm passes) |
  | M5 | the `while [ "$st" = deactivating ] && …` loop | delete the loop | V3, V4 | V3: `toBe(0)`; V4: the `is-active` count (3, not 6) |
  | M6 | `&& [ "$n" -lt "$STOP_POLLS" ]` | delete it | V4 | spawn timeout at 5 s, so `code` is -1, not 1 |
  | M7a | `[ "$st" = inactive ] \|\| return 1` | delete it | V6c ×3, V4 | `toBe(1)` |
  | M7b | the same | `[ "$st" != active ] \|\| return 1` | V6c `failed`, V6c `activating`, V4 (V6c `active` stays green) | `toBe(1)` |
  | M8 | the `.stopped` arm | delete the `if` arm (`elif` becomes `if`) | V1, V3, V11, V18, V21, V16(a); (T2) X2 | `toBe(0)` |
  | M9 | the `elif [ ! -e "$reg/$id.uuid" ]` arm | delete it | V2, V17; (T2) X4 | `toBe(0)` |
  | M10 | `else return 1` | `else evidence="unstamped"` | V5, V9, V16(b); (T2) X3, X3b | `toBe(1)` (they get 0); X3b: the log (no `status` line) |
  | M11 | read-only | add `rm -f "$reg/$id.stopped"` after the read | V12 | the snapshot equality |
  | M12 | `[ -f … ] && [ ! -L … ]` before the read | drop the guard | V11, V12 | spawn timeout at 5 s (the read blocks on the FIFO), so `code` is -1 |
  | M13 | `runVerify`'s `HOME: home` | replace it with `HOME: mkTmp('ccrc-agent-otherhome-')`, another fixture and never the real HOME | every `runVerify` case | the `home-seen` `toBe(home)` |
  | M14 | the classifier issues no query before its scope, slash and registry checks | move `st=$(… is-active …)` and the loop above the first `case` | V13, V8, V10, V19 | the exact `calls` list or the `is-active` count |
  | M15 | `reg="$HOME/.cc-sessions"` | `reg="$HOME/.cc-session"` | V14, and M1's agent set (V1, V2, V3, V4, V6c ×3, V11, V17, V18, V21, V16(a)) | the line match, `toBe(0)`, and V4 and V6c ×3's `is-active` count (2, not 6; 2, not 3) |
  | M16 | the line-neutral header | add one line inside `:42-47` | V15 | the `:50` line equality |
  | M17 | `case "$id" in */*) return 1 ;; esac` | delete it | V19 | `toBe(1)` (it gets 0 through `$HOME/outside.stopped`) |
  | M18 | `[ -n "${HOME:-}" ] \|\| return 1` | delete it | V20 | stderr has no `DEPLOY FAILED` (`HOME: unbound variable`, exit 127) |
  | M19 | `${s:0:64}` | `${s}` | V21 | the 64-character evidence |
  | M20 | the default bound | `:-10` becomes `:-100` | V22 | the line match |
  | M21 | `regSnapshot`'s `isFile()` guard (harness) | read every entry | V12 | a hang. Measure it with `timeout -k 5 60 ./node_modules/.bin/vitest run test/deploy-verify.test.ts -t 'read-only'`, which exits 124. `timeout(1)` skips `afterAll`, so this run's `mkTmp` dirs survive, V11's FIFO included: afterwards, remove only this run's `ccrc-agent-deployverify-*`, `ccrc-agent-verifyhome-*` and `ccrc-agent-otherhome-*` dirs under `os.tmpdir()` created after the step's start time. Then check `pgrep -af vitest` and confirm nothing of yours remains |

  M6 and M12 go red by spawn timeout. Record them as "spawn timeout at 5 s, code -1", never as a crash. M21 goes red by hang. Record it as "suite hang, killed by timeout(1) at 60 s".
- [ ] **Step 7: Commit:** `fix(update): verify-service.sh passes a session stopped on purpose (settled inactive + ccd's stamp or a purged row) and fails everything else as before (wave 10, R12)`.

### Task 2: The cross-version case: `main`'s `_upd_sweep`, unedited, with the new script

**Files:** create `server/test/ccrc-sweep-deliberate-stop.test.ts`.

**The precedent:** `sourcedCcrc` (`server/test/ccrc-update.test.ts:1062-1066`):

    spawnSync(BASH, ['-c', `. "$1"; ${script}`, 'ccrc-under-test', join(REPO, 'ccd', 'ccrc')], …)

G1c-direct (`:2891-2893`) uses it on `_upd_sweep` itself: `sourcedCcrc(home, 'CCD_OS=darwin; UPD_BACKUP_DIR="$HOME/ccrc-backups/fixture"; _upd_sweep')`.
- `ccd/ccrc`'s dispatch is guarded by `if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then` (`ccd/ccrc:22916`), so sourcing the file defines functions and runs no verb.
- That test file is wave 9's, so the technique is copied here, not imported. Importing a test file would register its cases a second time.

**What the extracted code can reach, and how each is handled:**
- **At source time:** builtins only. That is `case "${OSTYPE:-}"` (`:110`), `cd`/`pwd` (`:1330`), and plain assignments.
- **In `_upd_sweep`'s Linux arm:**
  - `systemctl`, a stub;
  - `awk` and `printf`, both real and harmless;
  - `bash`, real, which runs the fixture's copy of the script;
  - `_ccrc_die`, builtins only, because `UPD_REPORTING` and `UPD_REDACT_ACTIVE` are left unset.
- **In the script:** `systemctl` (stub), `journalctl` (stub) and `sleep` (real, 0 s).
- **Poisoned** (each records to `$HOME/<name>-poison`, then exits 97), so that nothing real can run: `tmux`, `ccd`, `launchctl`, `loginctl`, `systemd-run`, `ssh`, `scp`, `curl` and `npm`. `gh` is poisoned through `ghContainedEnv` (`server/test/ccdWsHelpers.ts:344`, called with no systemd opts), whose bin is `harnessBin(home)` = `<home>/.local/bin` (`:294-297`).
- **The env is built from scratch,** never as `...process.env`:
  - `HOME`;
  - `PATH` = `<home>/.local/bin:` plus the parent's PATH;
  - `LANG=C`;
  - `XDG_RUNTIME_DIR=<home>/run`;
  - `DBUS_SESSION_BUS_ADDRESS=unix:path=<home>/run/bus`;
  - `CCRC_VERIFY_SETTLE=0`, `CCRC_VERIFY_WINDOW=0`, `CCRC_VERIFY_LOG_LINES=5`, `CCRC_VERIFY_STOP_INTERVAL=0`.

**Fixture:**
- `<home>/ccrc/deploy/verify-service.sh` is `cpSync(VERIFY_SRC)`, where `const VERIFY_SRC = join(REPO, 'deploy', 'verify-service.sh')`. That is the path the old sweep resolves at call time, through `BOX_TREE_DIR`.
- `const CCRC_SRC = join(REPO, 'ccd', 'ccrc')` is the file's one name for the sourced `ccd/ccrc`. X0 reads it, and the spawn passes it as `$1`.
- `<home>/.cc-sessions/` holds what the case plants.
- **The stub `systemctl`** follows the shape of `server/test/ccrc-update.test.ts:391-392` and `:460`:
  - It records `$*` to `$HOME/systemctl-calls`, before any shift.
  - It requires `$1 = --user` and exits 90 otherwise, then **shifts it off**.
  - After the shift, `list-units` requires `$2 = claude-session@*`. Unfiltered and `--state=active` listings both print `claude-session@demo-good.service loaded active running x`, then the same line for `demo-gone`. `--state=failed` prints nothing.
  - `show -p KillMode <u>` answers `KillMode=process`.
  - `try-restart` exits 0, and `status` is recorded.
  - `is-active` and `show -p MainPID --value` are answered per unit (the unit is the last argv word), generated at plant time:
    - `demo-good` answers `active`/`active` and `4242`/`4242`;
    - `demo-gone` answers what the case gives.
  - Anything else prints `fixture systemctl: unexpected argv`, exit 90.
- **`assertContained(env, home)`:** before every spawn in X2–X4, one `BASH -c 'command -v systemctl journalctl tmux ccd launchctl loginctl systemd-run ssh scp curl npm gh'` under the case's env must resolve every name to `<home>/.local/bin/<name>`. Otherwise it refuses to spawn. X1 is the same check as a case of its own.
- **The spawn:** `spawnSync(BASH, ['-c', '. "$1"; CCD_OS=linux; UPD_BACKUP_DIR="$HOME/ccrc-backups/fixture"; _upd_sweep', 'ccrc-under-test', CCRC_SRC], { env, encoding: 'utf8', timeout: 45_000 })`.

**Cases.** All sit in `describe('the move INTO wave 10: main\'s _upd_sweep, sourced unedited, with the new verify-service.sh')`. Every case is `itLinux(…, …, 60_000)`, because the script is Linux-only (measured in Global Constraints).

| # | Case | Plant (`demo-gone`'s `is-active` / MainPID) | Expected |
|---|---|---|---|
| X0 | precondition: still the serial shape | reads `CCRC_SRC` | `/_upd_sweep\(\) \{([\s\S]*?)\n\}/` (single-definition's own regex, `server/test/single-definition.test.ts:2785`) matches. Its body holds `local verify="$BOX_TREE_DIR/deploy/verify-service.sh"`, `bash "$verify" "$u" \` and `\|\| _ccrc_die "$u was restarted and did not stay up`, and `CCRC_SRC` holds `BOX_TREE_DIR="$HOME/ccrc"`. The message says: this case proves the move INTO wave 10 only while the sweep has this shape, so re-home it on a frozen copy (Reading 2) |
| X1 | containment | none | `assertContained` as a case: every name resolves to `<home>/.local/bin/<name>`, and `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` start with `home` |
| X2 | stamped stop caught in the window: the sweep returns 0 | `['active','inactive','inactive']` / `['5151']`; `demo-good.uuid`, `demo-gone.uuid`, `demo-gone.stopped` = `1791151850 ccd` | rc 0. stdout holds `verified: claude-session@demo-good.service active, MainPID 4242 stable across 0s`, the stamped `stopped on purpose:` line for `demo-gone`, and `update: sweep: every live claude-session@ supervisor now runs the ccd this update installed (KillMode=process verified per unit before any restart; panes untouched)`. stderr has no `did not stay up` and no `DEPLOY FAILED`. `systemctl-calls` is exactly the 15 lines below |
| X3 | unstamped stop: dies as today (characterisation) | `['active','inactive','inactive']` / `['5151']`; `demo-good.uuid`, `demo-gone.uuid` | rc 1. stderr holds `ccrc: claude-session@demo-gone.service was restarted and did not stay up — read: systemctl --user status claude-session@demo-gone.service. The pre-update backup is complete at <home>/ccrc-backups/fixture` and `DEPLOY FAILED — claude-session@demo-gone.service`. stdout has no `update: sweep: every live`. The last line of `systemctl-calls` is `--user status --no-pager --lines=0 claude-session@demo-gone.service`. Green on main's script and on the new one |
| X3b | the unstamped stop's exact call log under the new script | as X3 | `systemctl-calls` is exactly X2's 15 lines followed by the `status` line. Red on main's script by design: 14 lines plus `status`, because there is no classifier re-read |
| X4 | reclaimed and purged before the loop reaches it (v0.0.79's shape): returns 0 | `['inactive','inactive']` / none; `demo-good.uuid`, `demo-gone.generation` | rc 0, with the purged `stopped on purpose:` line. `systemctl-calls` is X2's first 11 lines followed by `--user is-active claude-session@demo-gone.service` twice (13 lines) |

After X2, X3, X3b and X4, no `*-poison` file exists in `home`.

**X2's call log, expected exactly:**
```
--user list-units claude-session@* --plain --no-legend
--user show -p KillMode claude-session@demo-good.service
--user show -p KillMode claude-session@demo-gone.service
--user show -p KillMode claude-session@ccrc-update-preflight.service
--user try-restart claude-session@*
--user list-units claude-session@* --state=failed --plain --no-legend
--user list-units claude-session@* --state=active --plain --no-legend
--user is-active claude-session@demo-good.service
--user show -p MainPID --value claude-session@demo-good.service
--user is-active claude-session@demo-good.service
--user show -p MainPID --value claude-session@demo-good.service
--user is-active claude-session@demo-gone.service
--user show -p MainPID --value claude-session@demo-gone.service
--user is-active claude-session@demo-gone.service
--user is-active claude-session@demo-gone.service
```

- [ ] **Step 1: Re-measure:**
  ```bash
  grep -n '^function sourcedCcrc\|G1c-direct' server/test/ccrc-update.test.ts   # :1062 :2891
  grep -nF '[ "$1" = "--user" ]' server/test/ccrc-update.test.ts             # :391
  grep -nF "    'shift'," server/test/ccrc-update.test.ts                    # :392
  grep -nF '[ "$2" = "claude-session@*" ]' server/test/ccrc-update.test.ts   # :460
  grep -nF 'if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then' ccd/ccrc          # :22916
  grep -n '^_upd_sweep() {\|^PROG=ccrc\|^BOX_TREE_DIR=\|^_ccrc_die()' ccd/ccrc  # :20484 :1311 :1588 :2351
  grep -nF '|| _ccrc_die "$u was restarted and did not stay up — read: systemctl --user status $u.' ccd/ccrc   # :20637
  grep -nF 'claude-session@ccrc-update-preflight.service' ccd/ccrc          # :20592
  grep -n '_upd_sweep\\(\\)' server/test/single-definition.test.ts         # :2785
  grep -n '^export function ghContainedEnv\|^export function harnessBin' server/test/ccdWsHelpers.ts   # :344 :294
  grep -n '^export const itLinux' server/test/platformFixtures.ts           # :27
  grep -n 'testTimeout' server/vitest.config.ts                             # :87 (20s on Linux)
  ```
- [ ] **Step 2: Write the file,** with a header that says WHY: the move INTO wave 10 runs the old sweep with the new script. Cite `ccd/ccrc:18026`, `:13695`, `:1588` and `:20619`. Then write the cases above.
- [ ] **Step 3: Measure red-first against main's script.**
  - Run `git show origin/main:deploy/verify-service.sh > "$SCRATCH/verify-main.sh"`.
  - Make the fixture copy that file: a transient edit of `VERIFY_SRC` to `"$SCRATCH/verify-main.sh"`.
  - Run `cd server && ./node_modules/.bin/vitest run test/ccrc-sweep-deliberate-stop.test.ts`.
  - **Expected red:**
    - X2 and X4 on `toBe(0)` (rc 1, the die sentence);
    - X3b on the call log (15 lines, not 16).
  - **Expected green:** X0, X1 and X3.
  - Restore the constant with `cp` + `cmp`.
- [ ] **Step 4: Run green:** the same command. **Expected:** X0–X4 and X3b pass.
- [ ] **Step 5: Mutation rows.**

  | # | Guard | Mutation | Goes red (full expected set) | Assertion |
  |---|---|---|---|---|
  | T1 | Task 1's classifier, end to end | M1 applied to `deploy/verify-service.sh` | X2, X3b (log 15, not 16), X4 | `toBe(0)`; X3b: the log |
  | T2 | X0's precondition | a mutated scratch copy of `ccd/ccrc`: `cp ccd/ccrc "$SCRATCH/ccrc-mut"`, and in the copy the loop's `\|\| _ccrc_die "$u was restarted…` becomes `\|\| :`. `CCRC_SRC` points at the copy through a transient edit of the test file only (Step 3's `VERIFY_SRC` technique), restored with `cp` + `cmp`. `ccd/ccrc` is never written, and `git status --porcelain ccd/ccrc` prints nothing | X0, X3 | X0: the body `toContain`; X3: `toBe(1)` |
  | T3 | containment | drop `tmux` from the poison list | X1, X2, X3, X3b, X4 (`assertContained` refuses) | the `command -v` resolution |
  | T4 | the settle-path word | Mword applied to `deploy/verify-service.sh` | X4 | `toBe(0)` |
  | T5 | the `.stopped` arm, end to end | M8 applied to `deploy/verify-service.sh` | X2 | `toBe(0)` |
  | T6 | the purged arm, end to end | M9 applied to `deploy/verify-service.sh` | X4 | `toBe(0)` |
  | T7 | `else return 1`, end to end | M10 applied to `deploy/verify-service.sh` | X3, X3b | X3: `toBe(1)` (it gets 0); X3b: the log (no `status` line) |
- [ ] **Step 6: Commit:** `test(update): main's _upd_sweep, sourced unedited, passes a stamped or purged stop through the new verify-service.sh and dies on an unstamped one (wave 10)`. Then run `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts`.

### Task 3: The gate and the PR

- [ ] **Step 1: Start from a merged, clean tree.**
  ```bash
  git status --porcelain
  git fetch origin main
  git merge-base --is-ancestor origin/main HEAD && echo "origin/main is in HEAD" || echo "MAIN MOVED"
  ```
  - On `MAIN MOVED`, run `git merge --no-edit origin/main`, keep both sides of every hunk, and record `git show --remerge-diff HEAD`.
  - If wave 9 (run 223) has merged, re-run Task 2 Step 1's greps. X0 must still hold. If wave 9 changed `_upd_sweep`'s verify loop, stop and report it.
- [ ] **Step 2: Dependencies:** `cd agent && npm ci` and `cd server && npm ci`, wherever `node_modules` is absent.
- [ ] **Step 3: The agent suite in full,** because CI runs `test (agent)` in full on a PR:
  ```bash
  cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts
  cd agent && ./node_modules/.bin/vitest run
  cd agent && ./node_modules/.bin/tsc --noEmit; echo "exit $?"
  ```
  `agent/tsconfig.json`'s `include` covers `src/**/*.ts` and `shared`, not `test/`. So this `tsc` line does not type-check `deploy-verify.test.ts`. That file's type gate is `typecheck-tests` in Step 4, which compiles `agent/test/tsconfig.tests.json` (`server/test/typecheck-tests.test.ts:79-83`). Never report the agent `tsc` line as covering the test edits.
- [ ] **Step 4: The server files this change reaches,** one per call, in the foreground, with a timeout of at least 600000 ms:
  - `ccrc-sweep-deliberate-stop`;
  - `ccrc-install`, `ccrc-update`, `ccrc-doctor`, `ccrc-cli`, `build-release`;
  - `single-definition`, `ccrc-uninstall`, `ccrc-install-graphify`, `ccrc-versioned-audit`, `macos-platform`;
  - `typecheck-tests` (the type gate for `agent/test/` and for the new server file), `topology-clean` and `dtbd`.

  Each one is `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. Then run `cd server && ./node_modules/.bin/tsc --noEmit; echo "exit $?"`.
  - If the 1-minute load (`cat /proc/loadavg`) is under 20, also run the six shards in sequence (`--shard=1/6` … `6/6`) with `TMPDIR="$SHARD_TMP"`. The sum of their `Test Files` must equal `find server/test -name '*.test.ts' | wc -l`. Otherwise, say in the wave-done that the shards were not run, and give the load.
  - A red in a known load flake (`typecheck-tests` and the others CLAUDE.md names) is re-run IN ISOLATION before it is called a break.
- [ ] **Step 5: The ledger and scope guards, last:**
  ```bash
  git fetch origin main
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
  git diff --stat origin/main...HEAD -- ccd deploy/deploy.sh '*.service' '*.timer' agent/src server/src pwa shared server/test/ccdWsHelpers.ts server/test/codexLaneFixture.ts server/test/ccrc-update.test.ts README.md CLAUDE.md agent/CLAUDE.md   # prints nothing
  git diff --stat origin/main...HEAD        # deploy/verify-service.sh, agent/test/deploy-verify.test.ts, server/test/ccrc-sweep-deliberate-stop.test.ts, this plan
  diff <(git show origin/main:deploy/verify-service.sh | sed -n '1,41p;48,62p') <(sed -n '1,41p;48,62p' deploy/verify-service.sh)   # prints nothing
  bash -n deploy/verify-service.sh; echo "exit $?"
  ```
- [ ] **Step 6: The PR,** from the workspace branch.
  - Its first paragraph says:
    - the merge goes live on both boxes by auto (dev, `auto=channel`), fleet box first;
    - the move INTO it runs the old `_upd_sweep` with this script, and Task 2 proves that move is protected;
    - `deploy.sh`'s sweep is covered with no edit;
    - nothing reaches either box until the operator acks the failed v0.0.78 fleet row.
  - One section per task, carrying D-3946, D-3947, D-3948 and D-3949 by number.
  - Links to the plan and the files are GitHub `blob/main` URLs built from the repository's own remote, with the PR's `/files` view beside each until merge. Never a docserver URL.
  - Every commit's author and committer are the noreply identity: `git log --format='%an <%ae> | %cn <%ce>' origin/main..HEAD`.
  - The body ends with the attribution line the session's instructions give.
  - After CI starts, read the PR's `select tests` summary. It must list `ccrc-sweep-deliberate-stop.test.ts` (rule NEW) and the files that read `deploy/verify-service.sh` (rule READ). If one of Step 4's server files is missing from it, run `gh workflow run ci.yml --ref <branch> -f mode=full` and name that run in the wave-done.
- [ ] **Step 7: The wave-done, in the same turn as the push.** It carries:
  - the tip sha, the PR number, and the remerge-diff result;
  - each suite's result, the shards or the reduced list, and the load;
  - the red-first counts of Task 1 Step 4 and Task 2 Step 3;
  - every mutation row (M1–M21, Mgate, Mword, T1–T7) with its measured red set against the listed set, and the assertion that fired. Timeouts and hangs are named as such;
  - any reserve number spent, each defined in this plan in the commit that cites it;
  - anything the work found that bears on a ruled reading below.

## Coordinator rulings on this plan's readings (2026-10-04)

1. Reading 1 stands: "the row is purged" means the registry directory exists and holds no `<id>.uuid`; an absent registry or an unset HOME is "not measured" and fails (V10, V20, M4, M18); an id containing `/` is refused (V19, M17). Each only narrows a pass.
2. Reading 2 stands: Task 2 sources the checkout's `ccd/ccrc`, which is `main`'s current sweep while this wave leaves the file untouched. Wave 11's plan re-homes the case on a frozen copy of the pre-wave-11 sweep, or retires it once no box can run one; that is wave 11's to rule.
3. Reading 3 stands: Task 2 builds its own minimal contained env; whether it moves onto wave 9's `ccrcContainedEnv` is wave 11's choice.
4. Reading 4 stands: the pass line reaches stdout only; lifting it into the sweep's warning or `update.json` is wave 11's `ccd/ccrc` work.
5. Reading 5 stands IN FULL, both halves: only a stop-shaped failure (`inactive`, `deactivating`, no MainPID) is ever classified. MainPID churn is never classified (ruling 6, V7b), and an observed `activating` or `failed` is not classified either (V6, V6b): no deliberate stop reads either word, and under `Restart=always` either word is a pane death that was seen.
6. No version check is added. That a crash never reads `inactive` follows from systemd's documented `Restart=always` semantics (a unit restarts after every exit except an explicit stop, and a burst past `StartLimitBurst` ends `failed`), not from anything specific to v255. The WHY comment cites both the documented semantics and the systemd 255 measurement. No doctor check in wave 11.

No question is open.
