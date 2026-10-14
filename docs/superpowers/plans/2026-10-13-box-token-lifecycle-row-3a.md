# Box token lifecycle, row 3a: the weekly schedule and row 2c's residue: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Provenance: this is row 3a of the programme ledger `docs/superpowers/programs/box-token-lifecycle.md`, run 410 (wave 6, the first of row 3's parts). A workflow drafted it on 2026-10-13 from `main` at `e4405056e`, which is #376 (row 2c) squash-merged. Every citation below is `path:line` at `e4405056e`. Row 2c has been live on both boxes as v0.0.164 since 07:35 UTC, and both boxes read `PASS`. The server reads "generation #3, rotated 2 d ago, fleet confirmed, retired value refused" (ledger, 2026-10-13 07:46 UTC). The coordinator ruled row 3a's shape in that entry; the operator's 08:19 UTC ruling reordered the later parts (3d is now pairing and repair, 3e the arming part with the console). The coordinator answered the draft's four questions at about 08:40 UTC (below). This plan's numbers are 4556 to 4560, from the coordinator's block, and the coordinator keeps 4561 to 4570. They are written bare (no `D-` prefix) until a merged branch defines them.

**Goal:** Add the spec's wave-2 weekly schedule (§5.1 "Schedule (wave 2)", the operator's R4) as a derived trigger. It is recomputed on every tick and never persisted, so a rollback reads `box-token.json` unchanged (4556). Give that trigger, and only it, a scheduled-miss backoff of its own, held in memory, which a fresh agent ready does not clear (4558). Make the schedule visible: doctor gets a `rotation-overdue` WARN, and the view gets an optional `nextRotationAt` (4557). Then close row 2c's residue: review 409's F1 sentence, the R18 reorder and the R19 word, which amend 4554 in prose. Throughout, both live boxes keep reading `PASS`. Every live rotation keeps running the same op, verb and claim door, byte for byte.

**Inputs:**
- the coordinator's read-only facts workflow at `e4405056e`: the schedule scout, the residue and coordination scout, the architect's 3a scope, readings R4 to R8 and R18 to R20, and the attack lenses' breaks against 3a, which are folded in below;
- the ledger's 2026-10-13 07:46 entry (the 3a rulings), its 08:19 entry (the operator's two row-3 rulings and the reordered split), and its 00:46 entry (row 2c's bar, the model for this one);
- the coordinator's answers to the draft's Q1 to Q4 (2026-10-13, about 08:40 UTC), stated in their own section below;
- review 409's report on row 2c at `faa0ef03e` (F1, and the refuted-but-kept R2/R3);
- the row 2c plan `docs/superpowers/plans/2026-10-12-box-token-lifecycle-row-2c.md` (4554 at `:555-588`, 4555 at `:589-602`).

**Spec:** `docs/superpowers/specs/2026-10-07-box-token-lifecycle-design.html`: §4.2 (the server's files and state), §4.8 (doctor), §5 (one rotation, step 1's hold rule), §5.1 (timings, the "Schedule (wave 2)" row, the backoff reset on a fresh ready), §6 (failures), §9.2 (the rotation gate), §10 (testing), and the Decisions table (R4 "Weekly (7 days), declared once in L0", R5 "Drop the marker"). This plan does not edit the spec. 4558 departs from §5.1's backoff reset for the scheduled trigger only, by the coordinator's answer to Q1. The spec's citation of the seven-day pin, `single-definition.test.ts:4774-4780`, has drifted to `server/test/single-definition.test.ts:4783-4797`. That pin scans `server/src` and `pwa/src` only, and it lets `604_800_000` and `7 * 86_400_000` through.

**Live effect (stated for the review and the coordinator):**
- **Server box.** The first tick whose gate is open stages a normal rotation only if `now - anchor >= 7 days`. The live server last rotated about two days before 2026-10-13 07:35 UTC (doctor read "rotated 2 d ago"). So the first scheduled rotation is expected about 2026-10-17 to 10-18 and not before.
  - A rotation is invisible by design: no 401 window, no restart, and the old value stays accepted until the fleet confirms the new one.
  - If 3a reaches the server after the schedule is due, the first ticks after the release's restart can hold by an existing word until the gate opens: `update-in-flight` until the inventory sees the update closed, or `fleet-rows`, `node-id-unmeasured` or `link-down` until the agent reconnects to the restarted server (§9.2; `server/src/token/policy.ts:247-252`; `linkUp` is the fleet client's `connected`, `server/src/index.ts:227`; every hold change is persisted, `server/src/token/driver.ts:703-716`). The update's own doctor tail can then read `WARN … held:<word>` for that minute. A WARN changes no exit code (`ccd/ccrc:3774` returns 1 only on a FAIL). Landing before the due instant keeps every doctor run `PASS`.
- **Fleet box.** Only the doctor file changes. A fleet-role box runs no server arm, so its output is byte-identical.
- **Both boxes** read `PASS` after the release. No `update`, `rollout` or `install` exit code changes for the live shapes.
  - A link that drops and reconnects inside every tick no longer stages a scheduled rotation every tick: the scheduled-miss backoff survives a fresh ready (4558), so such a link gets one scheduled attempt per ladder step, and writes and removes at most one pending file per step.
  - What remains true: a persistent real fault on a scheduled attempt (every answer lost, or every stage unwritable) still raises `failures` once per ladder step while the why stays `scheduled` (a lost answer that outlives the confirm window leaves it: see the limits under 4558), and so still reaches the banner and doctor's `failed:*` FAIL (rc 1, and an update run under that doctor exits 3 as for any failing doctor) across ladder steps. That is G4 (failures are visible), by design. An owed rotation or a press on such a link keeps today's rule (spec §5.1), unchanged.
- **Rollback.** Nothing new is persisted: the schedule is derived and the scheduled-miss backoff is memory only (4558). The previous build reads `box-token.json` after a scheduled rotation exactly as it reads one after a "Rotate now".
- **Boxes other than the two live ones (named, not a live effect).** A server whose gate never opens, such as a local-mode server not recorded as `both` (`role-unrecorded`, `server/src/token/policy.ts:240-241`) or a remote server with no or two fleet rows (`fleet-rows`) or a link that stays down, today answers `none` with nothing owed and clears its hold every tick (`server/src/token/driver.ts:255`). From one interval after its anchor, the schedule's why is `scheduled` on every tick, so its existing hold word (a `TOKEN_HOLDS` word only) is persisted and doctor reads `WARN … held:<word>` from then on, and the card's phase reads `held`. It stays so. The verdict is a WARN and no exit code moves. The coordinator accepted this as true (Q4); `nextAction`'s chain is unchanged for it.
- **The coordinator** proves the first scheduled rotation live and read-only (R20), as §10.3 proved the first rotation: generation, phase and fleet confirmation, never a value.

## The coordinator's rulings for row 3a (binding; ledger 2026-10-13 07:46 UTC, with the 08:40 answers marked)

1. **R4: a derived trigger.** The weekly schedule's why word is `scheduled`.
   - `nextAction` (`server/src/token/policy.ts:352-403`) computes it on every tick from the persisted state, and it is never persisted.
   - It sits after `rotate-now` in the why chain (`:395-396`).
   - Staging excludes it from `owe()` exactly as it excludes `rotate-now` (`server/src/token/driver.ts:343`). So these stay byte-unchanged: `OWED_REASONS`, `TOKEN_HOLDS`, the `box-token.json` format, the PWA's reader and doctor's `_BT_OWED`. An older build reads the state unchanged after a scheduled rotation.
   - It is subject to backoff, so a flapping link cannot stage and write a pending file every tick. **As answered at 08:40 (Q1, 4558):** besides the normal backoff, the scheduled trigger has its own scheduled-miss backoff, held in memory only, which a fresh agent ready does NOT clear. It is consulted only when the why is `scheduled`, uses the normal ladder's steps and bound, is reset by a successful promotion and cleared by a server restart. It is not a `GateInput` change and adds no hold or owed word. Owed rotations and "Rotate now" keep spec §5.1's rule unchanged.
   - It never routes through `rotateRequested`.
2. **R5, as amended by the attack: the anchor and the clock.**
   - The anchor is `lastRotationAt`, or `current.since` when that is null.
   - The schedule is due when `now - anchor >= the interval`.
   - An anchor in the FUTURE is due only when it is more than one interval ahead of now. Otherwise the schedule waits, and the view and doctor say the stamp is in the future. **As answered (Q3):** the view says so as `nextRotationAt` more than one interval after the server's `now` (V5); the view carries no server clock, which is a named limit, and 3e's console card may add it.
   - 4552's clamp rows stay green UNCHANGED, and are named below as must-stay-green: `token-rotation-e2e`'s 'no re-open' case and the clamp cases.
3. **The gate is unchanged.** The schedule rides the existing `rotationGate`: no gate input changes, and the GateInput exact-keys pin stays green. It also rides the same normal backoff, the pending cap and the learned holds, and (Q1, 4558) its own scheduled-miss backoff, which is read in `nextAction` after the gate, never in it.
4. **R6, as amended: the interval's home and its pins.**
   - The interval is declared ONCE in L0, in `shared/box-token.ts`, under a generic name (`TOKEN_ROTATION_INTERVAL_MS`) so the link token can reuse it. Its value is 7 days in ms.
   - It is pinned by NAME and by VALUE. A scan of the comment-stripped code of `server/src`, `pwa/src`, `agent/src` and `shared/` looks for a numeric expression equal to 604800000, in any spelling the scout found the existing seven-day pin lets through.
   - **As confirmed (Q2):** the allowed holders are exactly three separate quantities: `shared/box-token.ts`'s `TOKEN_ROTATION_INTERVAL_MS`, `shared/api.ts`'s `LEDGER_STALE_MS`, and `server/src/childReclaimSweep.ts`'s `CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS` (child reclamation's, untouched).
   - The pins go in `server/test/token-shared.test.ts`, NOT `single-definition.test.ts` (claim 1219 holds that file until 10:35 UTC).
5. **R7: the view.** `BoxTokenView` gains one OPTIONAL additive field, `nextRotationAt` (ms or null), computed in `view()`. There is no console card line in 3a; that is 3d. (3d in the 07:46 split; since the operator's 08:19 reorder the console sits in 3e, the arming part. Noted for the coordinator; the ruling's substance is unchanged.)
6. **R7: doctor.** Doctor's server arm gains a WARN word, `rotation-overdue`.
   - It fires when the anchor is older than the interval plus a slack declared in L0 (one day), and no hold word stands.
   - Doctor's shell copies of the interval and the slack are pinned to L0 the way `_BT_TICK_MS` is (`server/test/doctor-box-token.test.ts:1230-1233`).
   - It is computed, never persisted.
   - A box-token WARN cannot stop another programme's soak sample, which accepts box-token WARNs by name. Even so, both live boxes must read `PASS` after the release.
7. **Row 2c's residue.**
   - (a) **Review 409 F1.** The row 2c plan's purge limit says the box read "the never-minted PASS" before row 2c. It read WARN, rc 2: the server part was never-minted, beside the fleet part's `no-generation`. Fix that sentence.
   - (b) **R18.** In `_bt_server_trace` (`ccd/ccrc-doctor-checks:7818-7837`), move BOTH the named-trace loop and the own-write block BELOW the unlisted test, so an unlistable token directory always gets the `chmod u+r` remedy.
     - Every verdict and every existing row is kept.
     - Amend the comments that state the unlistable rule, in the doctor checks file and in `doctor-box-token.test.ts`.
     - Amend 4554's limit (a) and its own-write unlistable limit.
   - (c) **R19.** On an own-write box whose `~/.cc-secrets` cannot be searched, the server part gets a DISTINCT trace word, `unsearchable`, with its own sentence and a `chmod u+x` remedy. It is never folded into `unlisted`.
     - The verdict stays FAIL rc 1, through the fleet part.
     - No new FAIL class.
     - It is pinned with an `itNonRoot` row.
8. **Files.** `shared/box-token.ts`, `server/src/token/policy.ts`, `server/src/token/driver.ts` (only what staging, the scheduled-miss backoff and the view need), the file that computes `BoxTokenView` (that is `server/src/token/driver.ts:187-227`; the type is in `shared/box-token.ts:71-99`), `server/test/token-policy.test.ts`, `server/test/token-shared.test.ts`, `server/test/token-rotation-e2e.test.ts`, `server/test/update-routes.test.ts` (only if the view literal needs it), `ccd/ccrc-doctor-checks`, `server/test/doctor-box-token.test.ts`, `docs/superpowers/plans/2026-10-12-box-token-lifecycle-row-2c.md` (residue prose only), and this plan.
   - NOT `README.md` (claim 1222), NOT `shared/api.ts` (claim 1218), NOT `single-definition.test.ts` (claim 1219).
   - NOT `agent/`, `pwa/`, `ccd/ccd`, `ccd/ccrc`, `ccd/ccrc-token-sync`, `deploy/`, or the spec.
9. **Numbers.**
   - This part may define 4556 to 4560, in order, each in the commit that first cites it, written BARE until merged. One number goes to the derived schedule and its anchor rule (4556). One goes to the overdue WARN, with the view field (4557). **As answered (Q1):** 4558 goes to the scheduled-miss backoff. 4559 and 4560 stay spare.
   - The amendments to 4552 and 4554 are prose amendments, written bare.
10. **The plan rides in the worker's PR as its first commit,** at `docs/superpowers/plans/2026-10-13-box-token-lifecycle-row-3a.md`.
11. **Red-first.** Every behaviour change ships with a pin measured red before the fix, and red again when its guard is reverted or mutated (the mutation rows). Fixture HOMEs only. Never print a token value, a code or a digest.

## The coordinator's answers to the plan's questions (2026-10-13)

The draft put four questions to the coordinator before dispatch. The coordinator answered them at about 08:40 UTC. This plan implements each answer everywhere it reaches.

- **Q1 (ruling 1, the flapping link): TAKEN, as 4558.** The derived `scheduled` trigger gets its own scheduled-miss backoff.
  - It is held in memory only, never persisted, so `box-token.json` stays byte-compatible with the previous build.
  - A fresh agent ready does NOT clear it.
  - It is consulted only when the why is `scheduled`. Owed rotations and "Rotate now" keep spec §5.1's rule (reset on success and on a fresh ready), unchanged.
  - It uses the normal ladder's steps and bound (`backoffMs`, `server/src/token/policy.ts:345-348`).
  - A successful promotion resets it. A server restart clears it (it is in memory).
  - It is NOT a `GateInput` change, and it adds no hold or owed word.
  - Why: a weekly schedule is never urgent. Without it, a link that reconnects inside every tick (each reconnect sets `lastReadyAt`, `server/src/index.ts:221`; each fresh ready resets the normal backoff, `server/src/token/driver.ts:233-234`) stages and writes a pending file every tick and, on lost answers, climbs `failures` (`server/src/token/policy.ts:426-428`) to the banner and doctor's `failed:*` FAIL (`ccd/ccrc-doctor-checks:7737-7738`) unattended.
  - It departs from spec §5.1 for the scheduled trigger only, hence a number. 4558 is defined, bare, in the commit that first cites it (Task 1's, this plan). 4559 and 4560 stay spare.
  - In this plan: Task 3's interface and rows E8a to E8e with their mutants (14a, 14b, 15, 19, 20, 21), P8, and the 4558 entry under Deviations found.
- **Q2 (ruling 4, a third holder): CONFIRMED.** The value pin's allowed holders are exactly three separate quantities: `shared/box-token.ts` `TOKEN_ROTATION_INTERVAL_MS`, `shared/api.ts` `LEDGER_STALE_MS` and `server/src/childReclaimSweep.ts` `CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS` (child reclamation's, untouched). Task 2's holders row lists the three, with no stop-and-mail branch.
- **Q3 (ruling 2, the view's future-stamp signal): ACCEPTED for 3a.** The view's future-stamp signal is `nextRotationAt` more than one interval after the server's `now`, as V5 pins. The view carries no server clock, which is a named limit (4557). 3e's console card may add the server's clock: residue for 3e (Not in this PR).
- **Q4 (boxes whose gate never opens): ACCEPTED as true.** A box whose gate never opens persists its existing hold word (an existing `TOKEN_HOLDS` word only) and reads `WARN held:<word>` one interval after its anchor, and stays so. No exit code moves. `nextAction`'s chain is kept unchanged (Live effect; 4556's limits).

## Global Constraints

- **Scope.** Edit only the files in File Structure. If a fix needs any other file, stop the task and mail the coordinator. That covers above all anything under `agent/`, `pwa/`, `server/src/remote/`, `server/src/config.ts`, `server/src/index.ts`, `server/src/token/{boot,files,door,routes,link,ports}.ts`, `server/src/childReclaimSweep.ts`, `shared/agent-protocol.ts`, `shared/api.ts`, `ccd/ccd`, `ccd/ccrc`, `ccd/ccrc-token-sync`, `deploy/`, `README.md`, `server/test/single-definition.test.ts`, the arming plan, or the spec. Tests may READ any tree file and import its exports. They never edit one, except as a mutant restored within the same step (below).
- **The live-shape invariant, on both boxes, at every commit.**
  - **Server.** The live server is `mail.token` (0600), plus `box-token.json` at generation #3, plus `box-token-retired.json`. That state is current, fleet-confirmed, with counters 0 and 0, `retiredPresentedAt: null`, no hold, nothing owed, nothing pending, and `lastRotationAt` about two days old.
  - **Fleet.** The live fleet box holds its 0600 token file, a generation file, and a `synced`/`proved` report over https.
  - **Before each commit, run these, one call each, in the form under "Running tests":**
    - `doctor-box-token`'s PASS describe (`server/test/doctor-box-token.test.ts:152-243`, including the row 2c live rows `:223` and `:234`), and from Task 5 on its two new live-age rows (Task 5 Step 1);
    - `ccrc-token-sync`'s synced-path describe (`server/test/ccrc-token-sync.test.ts:163-247`), which this plan never edits;
    - `ccrc-install`: `-t 'live shape'`, then `-t 'fresh fleet box'`, then `-t 'a fresh box ends green'`;
    - from Task 3 on, `token-rotation-e2e`'s "not due" row (Task 3 Step 1, E3).

    If any of them reds, stop.
- **The live rotation path.** Every live rotation runs `ccrc token sync --from agent` through the agent's `token-sync` op and the claim door. This plan changes none of it.
  - These diffs must be empty at every commit: `agent/`, `ccd/ccrc-token-sync`, `shared/agent-protocol.ts`, `server/src/token/{door,routes,link,boot,files,ports}.ts`.
  - The `rotationGate` body (`server/src/token/policy.ts:235-263`) and `GateInput` (`:195-208`) stay byte-identical.
  - Only these change: `nextAction`'s why chain and its one new OPTIONAL input, `scheduleBackoffUntil`, read only on the `scheduled` why (4558); the stage's owe exclusion; the driver's scheduled-miss bookkeeping (4558: three in-memory fields, one private method, its calls in `stage`, `send` and `promote`, and the one field passed in `runTick`'s `nextAction` call); and `view()`.
  - `runTick`'s fresh-ready reset (`server/src/token/driver.ts:233-234`) stays byte-identical: it clears the normal backoff only, as spec §5.1 says, for owed rotations and presses.
- **Byte compatibility of the state.** A scheduled rotation writes no new key and no new word into `box-token.json`, and the scheduled-miss backoff is memory only (4558). `OWED_REASONS` and `TOKEN_HOLDS` (`shared/box-token.ts:32-38`) are byte-unchanged, and so is `isBoxTokenState` (`server/src/token/files.ts:118-158`, `:122`, `:140`). The pin is the exact lists at `server/test/token-shared.test.ts:198-201`, which stay green unchanged.
- **Wire is additive only.** `nextRotationAt` is optional on `BoxTokenView`. An older server omits it, and the PWA's single reader (`pwa/src/lib/api.ts:493-515`) keeps an extra key without reading it. No exact-keys pin covers the view: `server/test/update-routes.test.ts:317-323` is a literal, and an optional field still compiles.
- **No overloaded null.** `nextRotationAt` null means only "this server holds no current value" (the `holds` rule of review 362 F1, `server/src/token/driver.ts:191-195`). A due schedule reads the view's own `now`, never null. An absent field means "an older server" and is the reader's to tell apart. `nextAction`'s `scheduleBackoffUntil` absent and null mean the same one thing, "no scheduled-miss backoff stands" (an older caller passes none).
- **Three holders (Q2, confirmed by the coordinator).** A measured scan of `main` at `e4405056e` finds two seven-day ms definitions today:
  - `shared/api.ts:8490`, `LEDGER_STALE_MS = 7 * 24 * 60 * 60_000`;
  - `server/src/childReclaimSweep.ts:1536`, `CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS = 7 * 24 * 3_600_000`, child reclamation's retention horizon. The facts workflow missed it, and the existing seven-day regex lets it through.

  The value pin lists exactly three holders: the new home and those two, each a separate quantity. This plan does not edit `childReclaimSweep.ts` or `shared/api.ts`.
- **No single quote inside the doctor's Python programs.** `_BT_PY_STATE` (`ccd/ccrc-doctor-checks:7465-7573`) and `_BT_PY_FLEET` (`:7578-`) are single-quoted bash strings. Any `'` added inside them (an apostrophe in a comment counts) ends the string: the file then runs the rest as shell when it is sourced, every box-token doctor run reads `state-unreadable`, and the exact-text extractors (`^_BT_PY_STATE='([^']*)'$`, `server/test/ccrc-install.test.ts:158-161`, `server/test/ccrc-update.test.ts:98-101`, `server/test/ccrc-doctor.test.ts:1045-1048`) throw. Write Python comments and strings there with no apostrophe and double quotes only, and never escape a quote (`'\''` breaks the same extractors). This plan adds nothing to `_BT_PY_FLEET`. Before Task 5's commit, check that `grep -c "^_BT_PY_STATE='$" ccd/ccrc-doctor-checks` is 1, that the program's closing `'` line is unchanged, and that the diff adds no `'` between those two lines.
- **Never a value.** Doctor tests the fleet file and `mail-previous.token` by existence and by name only, and never opens them. Every fixture value is minted at runtime: `randomBytes` in the doctor tests, the rig's planted values in the e2e. `runCheck`'s leak scan (`server/test/doctor-box-token.test.ts:69-89`) covers every doctor row, and the e2e "nothing printed" row (`server/test/token-rotation-e2e.test.ts:157-175`) stays green. The new warn line (4558) prints an answer's kind and an attempt count only.
- **Fixture HOMEs only** (`mkTmp`, `box(…)`, `rig(…)`, `bothAt(…)`).
  - Never run `ccrc`, `ccd`, `ccrc-token-sync`, `deploy.sh`, `notify.sh` or the server against the live `$HOME`.
  - Every test run forces `HOME` to an empty fixture directory in the same command (the form under "Running tests"). The harnesses themselves (`runCheck`, `box(…)`, `rig(…)`, `bothAt(…)`) force a fixture `HOME` on everything they spawn.
  - Any ad-hoc run of the doctor checks outside the test harness (Task 6 Step 6) forces `HOME` and `BOX_ENV_FILE` on EVERY invocation, as absolute, quoted fixture paths under the scratchpad, from an empty environment (`env -i`), and aborts first when the resolved `HOME` is the real home. Never write `~` in an argument.
  - Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*`.
  - Never call the live server, and never read `~/.cc-secrets`, `~/.ccrc` or `deploy/ccrc-mail.token` on a real box.
- **Running tests.**
  - One test file per call, in the foreground, from inside the package, with the tool timeout at 600000 ms (`CLAUDE.md` asks for at least that, and it is the tool's maximum). Never bare `npx vitest`, never in the background.
  - The form, from the repo root, is `mkdir -p .tmp-<task>/home && (cd server && HOME="$PWD/../.tmp-<task>/home" TMPDIR="$PWD/../.tmp-<task>" ./node_modules/.bin/vitest run test/<f>.test.ts)`, with `-t '<name>'` appended where a file is split. The agent's file uses the same form with `cd agent`. Remove `.tmp-<task>` before the commit.
  - Split `ccrc-install`, `ccrc-doctor` and `ccrc-update` by `-t`, one `-t` per call.
  - `git fetch origin main` runs as its own call before the tests that need it, never inside the forced-`HOME` form.
  - Never use `pkill`, `pgrep -f` or `killall`. Kill only a PID you recorded.
  - Known load flakes are re-run alone before they are called a break (`CLAUDE.md`'s list).
- **TDD red-first, with mutation discipline (row 2c's rule, unchanged).**
  - Run each pin RED before its guard exists, then GREEN.
  - Apply each mutant in the working tree, run the file, and record the failed and passed counts in the commit message.
  - Before each mutation, save a copy of the file. Restore from that copy and check with `cmp` that it is byte-identical. Never restore with `git checkout`.
  - A mutant that cannot red is not listed as a pin. Name it in the commit as a limit no test can see.
  - A row that holds behaviour that does not change is green before the fix. Its red is measured under its mutant, and the commit says so.
  - A mutant planted in a scanned root (Task 2) goes into an existing file. It never goes into a new `__`-prefixed file, because the scans skip those, as `single-definition.test.ts:47-55` does.
  - A row that could pass with nothing tested (a count bounded above, a "nothing happened" row) carries a precondition assertion that the fixture is in the state the row names (for example, due or not due), so a fixture that drifted reds instead of passing vacuously.
- **Commits.** One commit per task, on the workspace branch the brief names, never on a separate feature branch. Commit only after a separately measured green run of the task's files.
- **The repo is public.** Keep hostnames, IPs, home paths, account, lane and pool names, other projects and programmes, emails and docserver URLs out of code, tests, comments, commit messages, the PR body and this plan.
- **Numbers.**
  - This plan defines 4556, 4557 and 4558. Task 1's commit is the first to cite them, so it defines all three; Task 7 settles their final text.
  - A worker who needs another number mails the coordinator, then takes the next spare in order (4559, 4560). Define it in the commit that first cites it, and report it in the wave-done. Past 4560, write `D-TBD-<slug>` and report it.
  - Never write 4552 to 4570 with the `D-` prefix, in the diff, a commit message or the PR body.
  - Before any commit that defines or amends a number, run `git fetch origin main`, then `test/deviation-refs.test.ts` and `test/dtbd.test.ts`, one call each.
  - 4552 and 4554 are amended in prose only (Task 7).
- **Claims, open PRs and co-edits.**
  - Re-read `GET /api/claims?project=ccrc-pwa` (or `claims list --project ccrc-pwa`) before you start, before each task that edits a file new to the branch, and before you push.
  - At plan time, claim 1218 (`shared/api.ts`) and claim 1219 (`server/test/single-definition.test.ts`) ran until 10:35 UTC, and claim 1222 held `README.md`. This plan needs none of those files.
  - Open #381 touches `ccd/ccrc-doctor-checks` under the co-edit terms. If it merges first, this branch is the second lander for that file: merge `main`, keep both sides, re-derive every count and line, and re-run the touched suites.
  - A live claim on any file in File Structure stops that task until the coordinator mails consent.
- **`main`.** It was `e4405056e` at plan time. Before you push, probe `git merge-tree origin/main HEAD`. Merge only on a conflict, on a red on `main`'s side, or on a named ejection, and keep both sides. The plan stays the first commit.
- **Order.** Tasks 1 to 7, then 8 (verification, no commit): the plan; the L0 interval and its pins; the derived schedule, its staging exclusion and its scheduled-miss backoff; the view field; doctor's overdue WARN; the residue; the prose and the deviation texts.

## File Structure

| File | Change | Task | Sites at `e4405056e` |
|---|---|---|---|
| `docs/superpowers/plans/2026-10-13-box-token-lifecycle-row-3a.md` | This plan: it defines 4556, 4557 and 4558, and Task 7 settles their text and the 4552/4554 amendments | 1, 7 | new |
| `shared/box-token.ts` | `TOKEN_ROTATION_INTERVAL_MS` and `TOKEN_ROTATION_OVERDUE_SLACK_MS` (Task 2); `BoxTokenView.nextRotationAt?` (Task 4) | 2, 4 | vocabularies `:30-41`; `BoxTokenView` `:71-99` |
| `server/test/token-shared.test.ts` | The name pins, the by-value pins and the value scan, with its controls | 2 | imports `:13-35`; the box-token describe `:160-229` (the vocabularies `:195-205`, L0 `:223-229`) |
| `server/src/token/policy.ts` | `StageWhy`; `scheduleAnchor`, `scheduleDue`, `nextScheduledAt`; the `scheduled` arm of the why chain; `nextAction`'s optional `scheduleBackoffUntil` input and its one check (4558) | 3 | imports `:15-17`; `DriverAction` `:320-329` (stage `:324`); `backoffMs` `:345-348`; `nextAction` `:352-403` (input type `:352-358`, why `:395-396`, backoff `:401`, stage `:402`) |
| `server/src/token/driver.ts` | `stage` excludes `scheduled` from `owe()`; the scheduled-miss fields `scheduledGen`, `scheduleMisses`, `scheduleBackoffUntil` and `noteScheduleMiss` (4558), called from `stage`'s catch and from `send`, passed in `runTick`'s `nextAction` call, reset in `promote`; `nextRotationAt` in `view()` | 3, 4 | imports `:13-17`, `:22`; fields `:46-94` (`rotateRequested` `:52`); `view` `:187-227` (`now` `:199`); `runTick`'s fresh-ready reset `:233-234` (unchanged), its `nextAction` call `:253-254`; `stage` `:323-352` (catch `:331-342`, backoff `:338`, owe `:343`, log `:350`); `send` `:354-377` (backoff `:370-374`, commit `:375`, promote `:376`); `promote` `:380-` (`promoting` commit `:420`, `this.state = next` `:458`) |
| `server/test/token-policy.test.ts` | Module-scope `WEEK` and `rotatedAt`; the schedule's pure rows, including the scheduled-miss backoff's (P8); the hold-rule row extended | 3 | `base()` `:42`; the hold rule `:122-141`; fresh-mint rows `:228-241`; backoff `:367-386`; restart phases `:420-441` (`:428`); ring L1 `:483-490`; F7 `:619-623`; clamp `:717` |
| `server/test/token-rotation-e2e.test.ts` | One new describe at the end: the schedule through the real driver, the files and the fake agent, including the flapping-link rows E8a to E8e (4558); the view rows | 3, 4 | `rig` `:84-125` (`opts.link` `:85`, `opts.wrap` `:111`, clock `:94`, `rows` `:105`); failed-mint arrangement `:348-364`; the F3 backoff describe `:1250-` (`LADDER_MAX` `:1261-1262`, the `enospc` wrap `:1259`, `:1266-1269`); `stateOf` `:1425-1429`; `idleAfterRetirement` `:1641-1651`; `plantState`/`driverNow` `:1735-1740` (describe-scoped); the 4552 rows `:1852`, `:1870`, `:1888`; `bothAt` `:1916-1937`; file end `:2263` |
| `ccd/ccrc-doctor-checks` | `_BT_INTERVAL_MS`, `_BT_OVERDUE_SLACK_MS`; `_BT_PY_STATE`'s `ahead` and `rotation-overdue`; their parser arms, sentence and PASS words (Task 5). `_bt_server_trace`'s order and `unsearchable`; the server arm's sentence; comments (Task 6) | 5, 6 | header `:7398-7427` (L0 words `:7413-7423`); constants `:7445-7455`; `_BT_PY_STATE` `:7457-7573` (argv `:7459-7460`, `:7472-7474`; `age` clamps at 0; `refused` `:7530`; owed `:7550-7551`); `_bt_age` `:7651-7656`; `_bt_find` `:7702-7790` (`:7744-7746`); `_bt_fleet_paths` `:7804-7807`; `_bt_server_trace` `:7810-7837`; `_bt_server_arm` `:7839-7926` (locals `:7840`, python call `:7852-7854`, comment `:7856-7868`, absent branch `:7869-7884`, parser `:7888-7915`, PASS `:7919-7925`) |
| `server/test/doctor-box-token.test.ts` | The live-age rows; the `rotation-overdue` ROWS entry and its describe; the L0 pins (Task 5). The R18 and R19 rows; the missing-`~/.cc-secrets` own-write row; the comment (Task 6) | 5, 6 | imports `:28-33`; PASS describe `:152-243`; ROWS `:249-` (owed rows `:286-293`); kill switch `:386-403`; armed `:599-619`; never-handed `:777-1097` (`:916`); unsearchable describe `:1098-1191` (`:1105`, `:1153-1155`, `:1167`, `:1179`); L0 pins `:1205-` (`:1230-1233`) |
| `docs/superpowers/plans/2026-10-12-box-token-lifecycle-row-2c.md` | Review 409 F1's sentence (Task 6); 4554's limits (a), unsearchable and own-write unlistable, closed by row 3a (Task 7) | 6, 7 | `:573`, `:585`, `:586`, `:587` |

These are only read or run, never edited: `server/test/update-routes.test.ts` (the optional field needs no literal change: run it in Task 4), `server/test/single-definition.test.ts`, `server/test/token-rotation-real-verb.test.ts`, `server/test/ccrc-token-sync.test.ts`, `server/test/ccrc-doctor.test.ts`, `server/test/ccrc-install.test.ts`, `server/test/ccrc-update.test.ts`, `server/test/macos-platform.test.ts`, `server/test/typecheck-tests.test.ts`, `server/test/topology-clean.test.ts`, `server/test/deviation-refs.test.ts`, `server/test/dtbd.test.ts`, `server/test/box-token-census.test.ts`, `server/test/token-files.test.ts`, `server/test/token-boot.test.ts`, `server/test/token-claim-route.test.ts`, `agent/test/token-sync-op.test.ts`, `server/src/childReclaimSweep.ts` and `shared/api.ts` (read by Task 2's scan), and `pwa/test/box-token-card.test.tsx` (CI's `test (pwa)` runs it in full).

## Tasks

### Task 1: Commit this plan (it defines 4556, 4557 and 4558)

- [ ] **Step 1:** Place this file at `docs/superpowers/plans/2026-10-13-box-token-lifecycle-row-3a.md`, byte for byte as the brief carries it. Re-read claims.
- [ ] **Step 2:** Run `git fetch origin main`, then `test/deviation-refs.test.ts` and `test/dtbd.test.ts`, one call each, in the form under "Running tests". Both must be green.
- [ ] **Step 3:** Commit (`docs(plan): box-token row 3a, the weekly schedule and row 2c's residue (4556, 4557, 4558)`). Nothing else rides in this commit.

### Task 2: The interval and the slack, declared once in L0 and pinned by name and by value (4556)

**Files:** `shared/box-token.ts` and `server/test/token-shared.test.ts`.

**Interface:** after `BOX_TOKEN_PHASES` (`shared/box-token.ts:40-41`):

```ts
/** Spec §5.1 "Schedule (wave 2)", the operator's R4: a rotation is due this long after the last confirmed promotion
 *  (or, with none yet, after the current value was minted or adopted; 4556). Declared once, generically named, so the
 *  agent link token's rotation reuses it. `token-shared.test.ts` pins it by name and by value. A separate quantity from
 *  `LEDGER_STALE_MS` (`shared/api.ts`) and `CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS` (`server/src/childReclaimSweep.ts`),
 *  which are also seven days. */
export const TOKEN_ROTATION_INTERVAL_MS = 7 * 24 * 60 * 60_000;
/** 4557: doctor's `rotation-overdue` waits this long past the interval before it WARNs, so a rotation still on its
 *  backoff ladder (at most an hour a step) is not called overdue. A separate quantity from `STALL_ALERT_MS`. */
export const TOKEN_ROTATION_OVERDUE_SLACK_MS = 24 * 60 * 60_000;
```

- [ ] **Step 1: Write the rows.** Add a new describe after the box-token describe (`server/test/token-shared.test.ts:229`), named `describe('the rotation interval: declared once in L0, pinned by name and by value (4556, 4557)')`. Add `statSync` to the `node:fs` import (`:16`), and the two names to the `shared/box-token.js` import (`:26-29`). Inside the describe, define:
  - `ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src']`, resolved from the repo root.
  - `sourcesUnder(dir)`: every `.ts`/`.tsx` file, skipping `__`-prefixed entries (the same guard and reason as `single-definition.test.ts:47-55`). `rel(f)` is the repo-relative path.
  - `codeLines(text)`: comment lines become empty (lines matching `/^\s*(\*|\/\/|\/\*)/`, as `single-definition.test.ts:4094-4095` filters them), and a trailing comment after whitespace (`/\s\/\/.*$/`) is cut. Line numbers are kept.
  - `FACTOR = String.raw\`(?:\d[\d_]*|[A-Z][A-Z0-9_]*)\``; `PRODUCT = new RegExp(String.raw\`(?<![\w.$])${FACTOR}(?:\s*\*\s*${FACTOR})*(?![\w.])\`, 'g')`; `DEFINE = /\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::\s*number\s*)?=\s*([^;]+);/`.
  - `sevenDayHolders(files: { rel: string; text: string }[]): string[]`:
    - First, three passes collect `NAME -> value` for every `DEFINE` whose right side is a pure product of factors that all resolve: a literal is read with `_` removed, and a name is read from the table. The table is built from the files handed in, only.
    - Then every `PRODUCT` match on every code line counts when it holds at least one numeric literal, or at least two factors. A lone name is a reference, never a holder. A match counts only if every factor resolves and the product is exactly `604800000`.
    - Each hit is named `${rel}:${NAME}` when its line is a `DEFINE`, else `${rel}:line ${n}`. The list is de-duplicated and sorted.
  - Five rows:
    - `it('TOKEN_ROTATION_INTERVAL_MS is seven days and the slack one day, by value')`: `expect(TOKEN_ROTATION_INTERVAL_MS).toBe(604_800_000)`; `expect(TOKEN_ROTATION_OVERDUE_SLACK_MS).toBe(86_400_000)`.
    - `it('each is defined in exactly one file, shared/box-token.ts')`: for each name, `DEFINES = new RegExp(\`^\\s*(?:export\\s+)?const\\s+${name}\\s*=\`, 'm')` over every root file, with holders `toEqual(['shared/box-token.ts'])` (the shape of `single-definition.test.ts:3110-3114`).
    - `it('the scan sees every seven-day ms spelling the seven-day regex lets through (CONTROLS)')`: one `it.each` row per spelling. Each is fed as `{ rel: 'x.ts', text: \`const A = ${spelling};\` }` and expects `['x.ts:A']`. The spellings are `604_800_000`, `604800000`, `7 * 86_400_000`, `7 * 86400000`, `7 * 24 * 3_600_000`, `7 * 24 * 3600 * 1000`, `168 * 60 * 60_000`, `10_080 * 60_000`, `7 * 24 * 60 * 60_000` and `7*24*60*60*1000`. Also `7 * DAY_MS` with `const DAY_MS = 86_400_000;` on the line above (expects `['x.ts:A']`, and `DAY_MS` itself is no holder), and the same expression on a line with no `const` (expects `['x.ts:line 1']`).
    - `it('the scan does not count a reference, a comment, or another number (CONTROLS)')`:
      - a lone reference to a resolvable name: `const W = 604_800_000;` then `const B = W;` on the next line yields `['x.ts:W']` (never `x.ts:B`);
      - comments `// 7 * 24 * 3_600_000` and `x(); // 604_800_000` yield `[]`;
      - `const C = 7 * 24 * 60 * 60_001;` and `const D = 604800;` (seconds: the seven-day regex's own job) yield `[]`.
    - `it('the holders across shared, server/src, pwa/src and agent/src are exactly the three separate seven-day quantities')`: `expect(sevenDayHolders(ALL)).toEqual(['server/src/childReclaimSweep.ts:CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS', 'shared/api.ts:LEDGER_STALE_MS', 'shared/box-token.ts:TOKEN_ROTATION_INTERVAL_MS'])`. Its message names the rule: a weekly interval anywhere else must import the one in `shared/box-token.ts`, and the three listed are separate quantities, confirmed by the coordinator (Q2). A new, unrelated seven-day quantity needs the coordinator's ruling to join this list.
  - Comment the describe's limits: a sum (`6 * DAY + DAY`), a division, a float or exponent literal (`6.048e8`), a lower-case or imported-alias name, and a value built at run time are not seen.
- [ ] **Step 2: Run RED** `test/token-shared.test.ts`. The by-value row, the name row and the holders row red: the names do not exist, and the holders list lacks the new home. The CONTROL rows are green before the constants exist (the scanner is new); their red is measured under mutants 4 and 5 below.
- [ ] **Step 3: Implement** the two constants above. Run GREEN, one call each:
  - `test/token-shared.test.ts`
  - `test/single-definition.test.ts` (green: `shared/` is not in the seven-day regex's lane)
  - `test/typecheck-tests.test.ts`
  - `test/topology-clean.test.ts` (after `git fetch origin main`, its own call)
  - the live-shape set
- [ ] **Step 4: Commit** (`feat(token): the rotation interval and the overdue slack, declared once in L0 and pinned by name and value (4556)`), with the measured counts.

| Mutation | Must red |
|---|---|
| 1. `const WEEK_MS = 604_800_000;` appended to `server/src/token/policy.ts` | the holders row |
| 2. `const DAY_MS = 86_400_000;` and `const WEEK_MS = 7 * DAY_MS;` appended to `agent/src/index.ts` | the holders row (the agent root is scanned) |
| 3. `TOKEN_ROTATION_INTERVAL_MS = 6 * 24 * 60 * 60_000` | the by-value row and the holders row |
| 4. The name table removed (names never resolve) | the `7 * DAY_MS` CONTROL |
| 5. The "two factors or a literal" rule dropped (a lone name counts) | the lone-reference CONTROL (`['x.ts:B', 'x.ts:W']`), and the holders row (lone references in `server/src/coord/routes.ts`, `watch.ts`, `coord/schema.ts` and `childReclaimSweep.ts` appear) |
| 6. A second `export const TOKEN_ROTATION_INTERVAL_MS = …` in `pwa/src/lib/api.ts` | the name row |

### Task 3: The derived schedule in policy, staging that owes nothing for it, and its scheduled-miss backoff (4556, 4558)

**Files:** `server/src/token/policy.ts`, `server/src/token/driver.ts`, `server/test/token-policy.test.ts` and `server/test/token-rotation-e2e.test.ts`.

**Interface (4556):**
- In `policy.ts`, import `TOKEN_ROTATION_INTERVAL_MS` from `'../../../shared/box-token.js'` (`:15-17`; the ring pin `server/test/token-policy.test.ts:483-490` admits it). Add `export type StageWhy = OwedReason | 'rotate-now' | 'scheduled';`. `DriverAction`'s stage becomes `{ kind: 'stage'; why: StageWhy }` (`:324`).
- A new section after `backoffMs` (`:348`) and before `nextAction`. It sits outside the gate-scan slice of `server/test/token-policy.test.ts:125`, which runs from `export function rotationGate(` to `// ── the claim door`:

  ```ts
  // ── the weekly schedule (spec §5.1 "Schedule (wave 2)"; 4556) ────────────────
  /** What the schedule counts from: the last confirmed promotion, else when the current value was minted or adopted
   *  (a both box that never promoted would otherwise never rotate). */
  export function scheduleAnchor(s: BoxTokenState): number { return s.lastRotationAt ?? s.current.since; }
  /** Due a full interval after the anchor. An anchor AHEAD of the clock waits (bounded by the skew, so 4552's clamp rows
   *  hold), unless it is more than one interval ahead: no clock step explains that, and waiting it out would hold the
   *  schedule past two intervals. Derived on every call, never persisted (R4). */
  export function scheduleDue(s: BoxTokenState, now: number): boolean {
    const a = scheduleAnchor(s);
    return now - a >= TOKEN_ROTATION_INTERVAL_MS || a - now > TOKEN_ROTATION_INTERVAL_MS;
  }
  /** When the schedule is next due: `now` when it is due already, else the anchor plus the interval. */
  export function nextScheduledAt(s: BoxTokenState, now: number): number {
    return scheduleDue(s, now) ? now : scheduleAnchor(s) + TOKEN_ROTATION_INTERVAL_MS;
  }
  ```
- The why chain (`:395-396`) becomes: `const why: StageWhy | null = state.rotationOwed ? (state.owedWhy ?? 'adopted') : overdue ? 'confirm-deadline' : behind ? 'fleet-behind' : i.rotateRequested ? 'rotate-now' : scheduleDue(state, now) ? 'scheduled' : null;`. The normal backoff at `:401` bypasses only `rotateRequested`, so `scheduled` waits it out, and the gate (`:398`) and the pending cap (`:400`) apply as to every reason.

**Interface (4558, the coordinator's answer to Q1):**
- `nextAction`'s input type (`:352-358`) gains one optional field, after `retireHeld`:

  ```ts
  /** 4558: the weekly schedule's own backoff, after a scheduled attempt that did not complete. Read for the
   *  `scheduled` why ONLY: an owed rotation and a press keep spec §5.1's rule. Absent or null: none stands. */
  scheduleBackoffUntil?: number | null;
  ```
- After the normal backoff line (`:401`) and before `return { kind: 'stage', why }` (`:402`), one line:

  ```ts
  if (why === 'scheduled' && i.scheduleBackoffUntil != null && now < i.scheduleBackoffUntil) return { kind: 'backoff', until: i.scheduleBackoffUntil };
  ```

  It sits after the gate and the pending cap, so a closed gate still says its hold word first (Q4: the chain is unchanged) and a full cap still holds `pending-cap`. Nothing else in `nextAction` changes. `rotationGate` and `GateInput` are untouched.
- In `driver.ts`:
  - import `type StageWhy` (`:13-17`; `backoffMs` is already imported at `:15`);
  - three fields beside `rotateRequested` (`:52`):

    ```ts
    // 4558: the weekly schedule's own backoff, memory only like every in-flight fact here (never persisted, so
    // box-token.json stays byte-compatible with the previous build). A fresh agent ready does NOT clear it (runTick's
    // reset clears the normal backoff only); any promotion does, and a restart starts it again.
    private scheduledGen: string | null = null;           // the generation a `scheduled` stage wrote, until its send answers
    private scheduleMisses = 0;                           // scheduled attempts in a row that did not complete
    private scheduleBackoffUntil: number | null = null;
    ```
  - one private method:

    ```ts
    /** 4558: a scheduled attempt did not complete; the schedule waits the normal ladder's next step (never an owed
     *  rotation or a press, which never reach this). Prints the answer's kind and the attempt, never a value. */
    private noteScheduleMiss(word: string): void {
      this.scheduleMisses++;
      this.scheduleBackoffUntil = this.now() + backoffMs(this.scheduleMisses);
      this.warn(`ccrc-server: box token: the scheduled rotation did not complete (${word}); the schedule retries with backoff (attempt ${this.scheduleMisses})`);
    }
    ```
  - `runTick`'s `nextAction` call (`:253-254`) passes `scheduleBackoffUntil: this.scheduleBackoffUntil`. `runTick`'s fresh-ready reset (`:233-234`) is NOT changed.
  - `stage(why: StageWhy, …)` (`:323`):
    - in the catch (`:331-342`), right after `:338`'s backoff and before the commit (F3(b)'s order: the commit can throw on the same fault): `if (why === 'scheduled') this.noteScheduleMiss('not staged');`;
    - `:343` becomes `if (why !== 'rotate-now' && why !== 'scheduled') s = owe(s, why);   // 4556: a derived trigger owes nothing; an older build reads the state unchanged`. After it, in the same synchronous step as `this.state = s` and before the commit, `if (why === 'scheduled') this.scheduledGen = id;`;
    - the log line at `:350` already prints `why`, so it reads `rotation started (generation #n, scheduled)`.
  - in `send` (`:354-377`), between the commit (`:375`) and the promote call (`:376`):

    ```ts
    if (id === this.scheduledGen) {
      this.scheduledGen = null;
      if (out.promote === null) this.noteScheduleMiss(r.kind);   // 4558: any answer that promotes nothing is a miss
    }
    ```
  - in `promote`, beside `this.state = next` (`:458`): `this.scheduledGen = null; this.scheduleMisses = 0; this.scheduleBackoffUntil = null;   // 4558: a promotion by any route (op result, generation read, own-write) ends the schedule's miss run`.
  - Nothing else changes: `rotateNow`, `runTick`'s fresh-ready reset (`:233-234`), the normal `backoffUntil` writes (`:338`, `:370-374`, `:398`), `setHold`, and the gate's inputs.

- [ ] **Step 1: Write the rows.**
  - **`token-policy.test.ts`.** Import `TOKEN_ROTATION_INTERVAL_MS` from `'../../shared/box-token.js'`, and `scheduleAnchor`, `scheduleDue` and `nextScheduledAt` from the policy. At MODULE scope, right after `base()` (`:42`), declare `const WEEK = TOKEN_ROTATION_INTERVAL_MS;` and `const rotatedAt = (t: number): BoxTokenState => ({ ...base(), lastRotationAt: t });`, so the hold-rule row (`:122-141`, an earlier describe) can use them. Add a new describe after F7 (`:623`), named `describe('the weekly schedule: a derived trigger (4556) with its own miss backoff (4558)')`:
    - P1 `it('due one interval after the last promotion, never before')`. With `ask(s, now, extra = {}) = nextAction({ state: s, gate: OPEN, generation: null, rotateRequested: false, backoffUntil: null, now, ...extra })`:
      - `rotatedAt(5000)` at `now = 5000 + WEEK - 1` gives `{ kind: 'none' }`;
      - at `now = 5000 + WEEK` it gives `{ kind: 'stage', why: 'scheduled' }`.
    - P2 `it('a null lastRotationAt counts from current.since (a both box that never promoted still rotates)')`: `base()` (since 1000, lastRotationAt null) gives none at `1000 + WEEK - 1` and `scheduled` at `1000 + WEEK`; `scheduleAnchor(base())` is 1000.
    - P3 `it('an anchor ahead of the clock waits, unless it is more than one interval ahead')`. At `now = 10_000_000`:
      - `rotatedAt(now + 10 * 60_000)` gives none;
      - `rotatedAt(now + WEEK)` gives none (exactly one interval ahead waits);
      - `rotatedAt(now + WEEK + 1)` gives `scheduled`;
      - `rotatedAt(now + 10 * 60_000)` at `now + 10 * 60_000 + WEEK` gives `scheduled` (the wait is the skew).
    - P4 `it('scheduled is last in the why chain: an owed word, a lost hand-out, a behind fleet and a press each name themselves')`, on states that are also due (`lastRotationAt: 0`, `now = WEEK + 5000`):
      - owed `recovered` gives `why: 'recovered'`;
      - `rotateRequested: true` gives `why: 'rotate-now'` (a press is logged and spent as the operator's act);
      - a generation read `{ read: { kind: 'absent' }, measuredAt: now }` gives `fleet-behind`;
      - one handed-out value past `confirmBy` gives `confirm-deadline`.
    - P5 `it('scheduled waits out the normal backoff; only a press bypasses it')`: a due `rotatedAt(0)` with `backoffUntil: now + 1000` gives `{ kind: 'backoff', until: now + 1000 }`, and with `rotateRequested: true` gives `{ kind: 'stage', why: 'rotate-now' }`.
    - P6 `it('one at a time: a due schedule joins a rotation in flight')`:
      - a due state with one handed-out value inside `confirmBy` gives none;
      - a due state with a staged value on `OPEN` gives `send`;
      - the same on `rotationGate(bothLocal())` gives the own-write promote.
    - P6b `it('a due schedule over a full pending cap holds pending-cap (no-change row: the cap returns before the chain reaches scheduled)')`: `PENDING_HARD_CAP` handed-out values all past `confirmBy`, due, on `OPEN`, give the `pending-cap` hold. It is green before and after the fix and no mutant reds it; it is named as a no-change row, not a pin.
    - P7 `it('nextScheduledAt: the anchor plus the interval, or now when due')`: `nextScheduledAt(rotatedAt(5000), 6000)` is `5000 + WEEK`; `nextScheduledAt(rotatedAt(0), WEEK + 7)` is `WEEK + 7`; `nextScheduledAt(base(), 2000)` is `1000 + WEEK`.
    - P8 `it('the scheduled-miss backoff holds the scheduled why only; owed rotations, presses and a closed gate are as before (4558)')`, on a due `rotatedAt(0)` at `now = WEEK + 5000`:
      - `scheduleBackoffUntil: now + 1000` gives `{ kind: 'backoff', until: now + 1000 }`;
      - `scheduleBackoffUntil: now` gives `{ kind: 'stage', why: 'scheduled' }` (the instant ends it, as for the normal backoff);
      - no `scheduleBackoffUntil` (an older caller) gives `{ kind: 'stage', why: 'scheduled' }`;
      - `scheduleBackoffUntil: now + 1000` with `rotateRequested: true` gives `{ kind: 'stage', why: 'rotate-now' }`;
      - `scheduleBackoffUntil: now + 1000` on `{ ...rotatedAt(0), rotationOwed: true, owedWhy: 'recovered' }` gives `{ kind: 'stage', why: 'recovered' }`;
      - `scheduleBackoffUntil: now + 1000` on the hold-rule row's closed gate (`update-in-flight`) gives that hold, not `backoff`;
      - `scheduleBackoffUntil: now + 1000` on a not-due `rotatedAt(now)` gives none.
    - Extend the hold-rule row (`:132-141`): add `[rotatedAt(0), false]` to its loop at `now: WEEK + 2000`. Change its `now: 2000` to a per-row `now` so the two existing rows keep `2000`: they stage on `OPEN` and hold `update-in-flight` on the closed gate. The row's title and the `GateInput` keys pin (`:123-130`) are unchanged.
  - **`token-rotation-e2e.test.ts`.** Add a new describe at the end (after `:2263`), named `describe('the weekly schedule through the real driver (4556, 4558)')`. Import `TOKEN_ROTATION_INTERVAL_MS`, `OWED_REASONS` and `TOKEN_HOLDS` from `'../../shared/box-token.js'`. Do NOT import the new policy functions here: the rows that are green before the fix (E3, E8c, E8d) must run before the policy exports exist. Define the describe's own helpers (the 4552 describe's `plantState` and `driverNow`, `:1735-1740`, are scoped to that describe):
    - `WEEK = TOKEN_ROTATION_INTERVAL_MS`; `LADDER_MAX = 4` (the backoff ladder's most attempts in ten one-minute ticks: 60 s, 120 s, 240 s, 480 s, attempts at minutes 0, 1, 3 and 7, as `:1260-1262`), and `enospc` (as `:1259`);
    - `dueByL0(s, now)`: the precondition's own reading of ruling 2 (`lastRotationAt ?? current.since` against `WEEK`, the future-anchor clause included), used only to assert a fixture's due or not-due state;
    - `idleRotated()`: the body of `idleAfterRetirement` (`:1641-1651`). L is adopted, rotated, presented and retired, and the box is idle. Assert there, as a precondition, `counters.retiredPresentedAt` null and `rotationOwed` false;
    - `plantTop(r, fields)` (the body of `:1735-1739`), and `driverNow(r) = Date.now() + r.clock.offset`;
    - `ALLOWED`: the 21 required `BoxTokenState` keys plus `fileProblem` and `retiring`;
    - `countingLink(answer)`: `{ sends: 0, send: async () => { link.sends++; return answer; } }`, never claiming, so a `{ kind: 'lost', why: 'timeout' }` answer is lost before the claim (`handedOutAt` stays null, so the value is dropped and `failures` rises, `server/src/token/policy.ts:426-428`);
    - `noPending(r)`: no `mail-pending-*` entry in the server's token directory;
    - `restartDue(offsetFromNow, opts: { link?: TokenSyncLink; wrap?: (s: TokenStore) => TokenStore; plant?: Record<string, unknown> } = {})`: `idleRotated()`, then `app.close()`, then `const t = Date.now() - offsetFromNow;` and `plantTop(r, { lastRotationAt: t, current: { …current, since: t }, ...opts.plant })`, then `rig({ link: opts.link, home, fleetHome, wrap: (st) => capture(opts.wrap ? opts.wrap(st) : st) })`. The plant is on the NEW rig's clock: a new rig starts at `clock.offset = 0` (`:94`) and nothing carries the old rig's `GRACE_MS + 1000` across, so the helper never reads `r.clock.offset` and never sets the new rig's offset. `capture` records a deep copy of every `writeState` argument before passing it on (the idiom of `:284` and `:707`). It returns the new rig, the planted `t` and the writes.
    - `flapTicks(r2, minutes, before?)`: for `m` from 0 to `minutes - 1`: `r2.rows.readyAt += 1` (a fresh ready before every tick), `r2.clock.offset = m * 60_000`, then `before?.(m)`, then `await r2.driver.tick()`, then `expect(noPending(r2)).toBe(true)`.

    The rows. Each due row asserts `dueByL0(await stateOf(r2), driverNow(r2))` before its first tick; each not-due row asserts the opposite.
    - E1 `it('a box last rotated more than an interval ago stages ONE scheduled rotation on its first tick, and no persisted write owes anything')`: `restartDue(WEEK + 60_000)`, then one `tick()`. Expect:
      - `agent.calls` 1;
      - exactly one printed line matching `/rotation started \(generation #\d+, scheduled\)$/`;
      - `writes.length >= 3`, and every write has `rotationOwed: false`, `owedWhy: null`, and keys ⊆ `ALLOWED`;
      - `readState(paths.state)` is kind `state`, with `owedWhy` null and `lastRotationAt` within the tick;
      - `view()` matches `{ phase: 'grace', rotationOwed: false, owedWhy: null, fleetConfirmed: 'current' }`.
    - E2 `it('once per interval: an idle hour adds nothing, and the next comes one interval after the last')`: after E1's tick, 60 one-minute ticks leave `calls` at 1. Then `clock.offset` moves to one interval minus two minutes after the promotion's `lastRotationAt`, and a tick leaves 1. Then plus three minutes, and a tick gives 2.
    - E3 `it('the live shape: last rotated two days ago, an hour of ticks stages nothing')`: `restartDue(2 * 24 * 3_600_000)`, then 60 one-minute ticks. Expect `calls` 0, no `rotation started` line, and no write with a changed `lastRotationAt`.
    - E4 `it('an unsent answer to a scheduled stage backs off on the ladder with no fresh ready: no failure, no pending file left, at most LADDER_MAX sends in ten minutes (4558)')`:
      - `restartDue(WEEK + 60_000, { link: countingLink({ kind: 'unsent' }) })`, with the fleet row and `linkUp` as the rig sets them. No fresh ready: `rows.readyAt` stays fixed;
      - tick at minutes 0 to 9;
      - expect `sends >= 2` (the schedule fired and fired again after a backoff) and `sends <= LADDER_MAX`, `view().failures` 0 and `banner` false;
      - after each tick, `noPending` is true.
    - E5 `it('a due schedule on a closed gate holds by an existing word, and stages once the gate opens')`: `restartDue(WEEK + 60_000)`, `rows.linkUp = false`, then a tick. Expect `calls` 0, and the state's `hold` is `'link-down'`, which is in `TOKEN_HOLDS`, with `owedWhy` null. Then `linkUp = true` and a tick give `calls` 1.
    - E6 `it('a fresh both box that never promoted rotates one interval after its mint (the current.since anchor)')`: `bothAt(mkTmp('ccrc-token-e2e-sched-both-'), { off: 0, writerFails: false })` with no `mail.token`, so boot mints and its step 7 marks the fleet confirmed with no promotion (`server/src/token/boot.ts:232-239`), leaving `lastRotationAt` null. Ticks at `off` = 0 and `WEEK - 60_000` print no `and promoted`. A tick at `WEEK + 60_000` prints exactly one `rotation started (generation #2, scheduled)` and one `and promoted`.
    - E7 `it('an anchor more than one interval ahead rotates once, and the next is a full interval away')`: `restartDue(-(WEEK + 3_600_000))`, so the stamp is ahead. One tick gives `calls` 1. 60 more one-minute ticks leave 1.
    - E8a `it('a link fresh-ready before every tick that answers unsent: scheduled stages follow the ladder, not the ticks (4558)')`: `restartDue(WEEK + 60_000, { link: countingLink({ kind: 'unsent' }) })`, then `flapTicks(r2, 10)`. Expect `sends >= 2` and `sends <= LADDER_MAX` (main's rule, with the backoff reset by every fresh ready, would give 10), `view().failures` 0, `banner` false, and `noPending` after every tick (checked inside `flapTicks`).
    - E8b `it('a link fresh-ready before every tick whose answers are lost before the claim raises failures once per ladder step, not once per tick, and still reaches the banner (4558; G4)')`: `restartDue(WEEK + 60_000, { link: countingLink({ kind: 'lost', why: 'timeout' }) })`, then `flapTicks(r2, 10, (m) => { if (m === 3) failuresAfterMinute2 = r2.driver.view().failures; })`. Expect:
      - `failuresAfterMinute2 <= 2` (main's rule gives 3 there, and the banner);
      - `sends >= 3` and `sends <= LADDER_MAX`;
      - `view().failures === sends` (each lost answer raised one);
      - at the end `banner` true: a persistent real fault still reaches the banner and doctor's `failed:*` FAIL, across ladder steps (G4).
    - E8c `it('an owed rotation on the same flapping link keeps spec §5.1: a fresh ready resets its backoff, one stage per tick, as on main (4558: no-change row)')`: `restartDue(2 * 24 * 3_600_000, { link: countingLink({ kind: 'lost', why: 'timeout' }), plant: { rotationOwed: true, owedWhy: 'recovered' } })`. Preconditions: not due by `dueByL0`, and the state's `owedWhy` is `'recovered'`. `flapTicks(r2, 10)`. Expect `sends` 10 and `view().failures` 10: byte-identical to main's behaviour (measured green before the fix in Step 2).
    - E8d `it('a press on the same flapping link is never held by the scheduled-miss backoff: one send per press, as on main (4558: no-change row)')`: `restartDue(2 * 24 * 3_600_000, { link: countingLink({ kind: 'lost', why: 'timeout' }) })`. Precondition: not due by `dueByL0`. `flapTicks(r2, 10, async () => { expect(await r2.driver.rotateNow(driverNow(r2))).toMatchObject({ ok: true, outcome: 'started' }); })` (one press a minute, past `ROTATE_NOW_MIN_INTERVAL_MS`). Expect `sends` 10: byte-identical to main's behaviour (measured green before the fix in Step 2).
    - E8e `it('a scheduled stage that cannot write its pending file, fresh-ready before every tick, fails once per ladder step (4558; G4)')`: `restartDue(WEEK + 60_000, { wrap: (st) => ({ ...st, writeValue: async (p, v) => { if (p.includes('mail-pending-')) { attempts++; throw enospc(); } return st.writeValue(p, v); } }) })`, then `flapTicks(r2, 10)`. Expect `attempts >= 3` and `attempts <= LADDER_MAX`, `view().failures === attempts`, `agent.calls` 0.
    - E9 `it('a scheduled rotation completed by a generation read ends the miss run: the next week backs off from the first step (4558)')`: `restartDue(WEEK + 60_000, { link })` with `let mode: 'unsent' | 'agent' = 'unsent'` and `link = { send: async (c) => { sends++; return mode === 'unsent' ? { kind: 'unsent' } : r2.agent.send(c); } }` (late-bound to the new rig's fake agent). Tick at minute 0 (one miss). Set `mode = 'agent'` and `r2.agent.mode = 'lose-result'`; tick at minute 1 (the second scheduled stage is handed out and its result is lost: a second miss); tick at minute 2, so the generation read promotes (`and promoted (generation-read)` printed once). Then set `mode = 'unsent'`, move the clock one interval and one minute past the new `lastRotationAt`, tick once (a send), and tick at +1 and +2 minutes: the second scheduled send must have happened by the +2 minute tick (one 60 s step, plus the few ms a tick takes).
  - **Must stay green UNCHANGED** (named here; never edited): `token-rotation-e2e`'s 4552 rows at `:1852` ("clamped to now"), `:1870` ("never cleared") and `:1888` ("no re-open"), and its F3 backoff describe (`:1250-`: a press's and an owed rotation's backoff, spec §5.1's rule); `token-policy`'s `:717` (`clampRetiredStamp`), `:228-241`, `:420-441`, `:367-386` and the gate rows `:44-120`; the `GateInput` keys pin `:123-130`; `token-shared`'s vocabularies `:195-205`.
- [ ] **Step 2: Run RED,** one call each: `test/token-policy.test.ts` and `test/token-rotation-e2e.test.ts`.
  - Red: P1 to P3, P7 and P8 (the functions do not exist, or `nextAction` never says `scheduled`); P5's backoff case; the extended hold-rule row; E1, E2, E4, E5, E6, E7, E8a, E8b, E8e and E9 (nothing fires).
  - Green before the fix: P4 (all four cases name an earlier reason), P6, P6b, E3, E8c and E8d. E8c's and E8d's counts are main's behaviour, measured here. Their reds are measured under mutants 7, 8, 16, 18 and 14b below (P6b: none, a no-change row).
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run GREEN,** one call each, in the form under "Running tests":
  - `test/token-policy.test.ts`
  - `test/token-rotation-e2e.test.ts`
  - `test/token-rotation-real-verb.test.ts` (the live path with the real verb)
  - `(cd agent && HOME="$PWD/../.tmp-3/home" TMPDIR="$PWD/../.tmp-3" ./node_modules/.bin/vitest run test/token-sync-op.test.ts)`
  - `test/token-boot.test.ts`
  - `test/token-files.test.ts`
  - `test/box-token-census.test.ts`
  - `test/single-definition.test.ts`
  - `test/typecheck-tests.test.ts`
  - the live-shape set
- [ ] **Step 5: Commit** (`feat(token): the weekly schedule, a derived trigger that owes nothing, with a scheduled-miss backoff a fresh ready does not clear (4556, 4558)`), with the measured counts.

| Mutation | Must red |
|---|---|
| 1. `now - a >= …` becomes `now - a > …` | P1 |
| 2. A null `lastRotationAt` is never due (`s.lastRotationAt === null ? false : …`, no `current.since`) | P2, P7's third case, E6 |
| 3. A null `lastRotationAt` is due at once | `token-policy.test.ts:238-241` (an unreadable read on `base()` expects none), `:420-441` (`[base(), 'idle', 'none']` at `:428`), P2's "never before" |
| 4. The `a - now > …` clause deleted | P3's last-but-one case, E7 |
| 5. Any future anchor is due (`a > now \|\| …`) | P3's first case, and `:1888` (`calls` 1 then 2) |
| 6. `a - now > …` becomes `>=` | P3's "exactly one interval ahead" case |
| 7. `scheduled` placed before `rotate-now` | P4's press row |
| 8. `scheduled` placed first in the chain | P4's owed, behind and confirm-deadline rows |
| 9. The normal backoff bypassed for `scheduled` at `:401` | P5 |
| 10. `&& why !== 'scheduled'` dropped from `driver.ts:343` | E1, through the captured-writes assertion (a write carries `rotationOwed: true, owedWhy: 'scheduled'`); the final `readState` reads `state`, because the same tick's promotion clears both (`policy.ts:474`). `typecheck-tests` reds too |
| 11. The miss block deleted from `send` | E4 (unsent sets no normal backoff: a send every tick), E8a, E8b |
| 12. The miss backoff does not climb (`backoffMs(1)` for every miss) | E4, E8a, E8b (a send every minute) |
| 13. `scheduledGen` never set | E4, E8a, E8b |
| 14a. The miss backoff read for every why in `nextAction` (`why === 'scheduled' &&` dropped) | P8's press and owed cases |
| 14b. As 14a, and the miss counted on every stage (`this.scheduledGen = id` for every why) | E8c and E8d (sends at most `LADDER_MAX`, not 10) |
| 15. The "survives a fresh ready" half dropped (`this.scheduleBackoffUntil = null` added beside `runTick`'s reset at `:233-234`) | E8a, E8b and E8e (one stage per tick, as main's rule); E4 stays green (no fresh ready), and the commit says so |
| 16. A due schedule answers `stage` before the `staged` and `waiting` arms (an early `if (gate.open && scheduleDue(state, now)) return { kind: 'stage', why: 'scheduled' }` after the promote arms) | P6's three cases, E2 |
| 17. The reset in `promote` deleted (all three fields) | E9 (the second send comes at +4 minutes, not by +2) |
| 18. `now - a >= TOKEN_ROTATION_INTERVAL_MS / 7` (a one-day schedule) | E3, P1 |
| 19. The `noteScheduleMiss('not staged')` line deleted from `stage`'s catch | E8e (a failure every tick) |
| 20. A miss counted only on `unsent` and `predates-op` (`out.promote === null` becomes `r.kind === 'unsent' \|\| r.kind === 'predates-op'`, the draft's rule) | E8b (a lost answer every tick, the banner at minute 2) |
| 21. `now < i.scheduleBackoffUntil` becomes `<=` | P8's "the instant ends it" case |

Limits no test can see, named in the commit:
- A promotion that is selected but then abandoned (`promote`'s no-value branch) or held (the previous value's file would not read) resets nothing and counts no miss; the next scheduled stage follows whatever miss backoff stands. By reading.
- A both-local own-write failure is not a miss: its staged value stays pending and the own-write promote retries on the normal backoff, so no new scheduled stage is asked for meanwhile.
- The miss backoff is memory only: neither the view (`nextRotationAt` reads `now` while due) nor doctor shows its instant, and a server restart starts the ladder again from its first step, as ruled.

### Task 4: The view's optional `nextRotationAt` (4557)

**Files:** `shared/box-token.ts`, `server/src/token/driver.ts` and `server/test/token-rotation-e2e.test.ts`.

**Interface (4557):**
- In `BoxTokenView` (`shared/box-token.ts:71-99`), after `role`:

  ```ts
  /** 4557: when the weekly schedule is next due (ms): the anchor (the last promotion, else when the current value was
   *  minted) plus TOKEN_ROTATION_INTERVAL_MS, or the view's own `now` when it is due already. More than one interval
   *  after the server's own `now` means the anchor is ahead of the server's clock; the view carries no server clock, so a
   *  reader compares against its own. Null only when this server holds no current value. Optional and additive: an
   *  older server omits it; the console reads it in a later part. */
  nextRotationAt?: number | null;
  ```
- In `view()` (`server/src/token/driver.ts:203-226`), with `nextScheduledAt` imported: `nextRotationAt: holds && s !== null ? nextScheduledAt(s, now) : null,`, using the `now` at `:199`. The scheduled-miss backoff (4558) is not reflected: a due schedule reads `now` while it backs off.

- [ ] **Step 1: Write the rows** in Task 3's describe:
  - V1 `it('the view names the next due instant: the last promotion plus the interval')`: in E3's restarted box, `view().nextRotationAt` equals the planted `t + WEEK`.
  - V2 `it('a fresh box counts from its mint')`: `rig()` before its first tick gives `view().nextRotationAt === view().currentSince! + WEEK`.
  - V3 `it('a due schedule held on a closed gate reads now, never null')`: E5's held box gives `nextRotationAt` between `driverNow` read before and after the `view()` call.
  - V4 `it.skipIf(isRoot)('a box with history whose boot mint fails reads null: no current value, no schedule to name')`: the arrangement of `:348-364`. Rotate once on `rig({ handMade })`, close, remove `mail.token` and `mail-previous.token`, then reboot with `lockDirForBoot: true`. Precondition: `boot.holder.hasCurrent()` false and the state non-null (`view().origin` not null). Expect `nextRotationAt` null.
  - V5 `it('a stamp ahead of the clock by less than an interval names the stamp plus the interval, more than one interval after the server now')`: `restartDue(-10 * 60_000)` gives `nextRotationAt === t + WEEK`, and `nextRotationAt - driverNow(r2) > WEEK`. This is the view's whole future-stamp signal for 3a, as the coordinator accepted (Q3).
- [ ] **Step 2: Run RED** `test/token-rotation-e2e.test.ts`. V1 to V5 all red (the field is undefined; `toBe(null)` on undefined is red too).
- [ ] **Step 3: Implement.** Run GREEN, one call each, in the form under "Running tests":
  - `test/token-rotation-e2e.test.ts`
  - `test/update-routes.test.ts` (its `BT_VIEW` literal at `:317-323` compiles without the optional field, and `:342`'s `toEqual(BT_VIEW)` passes through the fake driver unchanged)
  - `test/typecheck-tests.test.ts`
  - `test/token-claim-route.test.ts`
  - the live-shape set

  `pwa/test/box-token-card.test.tsx` is CI's (`test (pwa)` runs in full). If `pwa/node_modules` is installed here, run it once too, in the same form with `cd pwa`.
- [ ] **Step 4: Commit** (`feat(token): the view names when the weekly schedule is next due (4557)`).

| Mutation in `driver.ts` / `policy.ts` | Must red |
|---|---|
| The `holds &&` guard dropped | V4 (the state survives the failed mint, so only `holds` makes it null) |
| `nextScheduledAt` returns `anchor + interval` even when due | V3 |
| `nextScheduledAt` reads `lastRotationAt` only | V2 |

### Task 5: Doctor's `rotation-overdue` WARN, and a stamp ahead of the clock said on the PASS line (4557)

**Files:** `ccd/ccrc-doctor-checks` and `server/test/doctor-box-token.test.ts`.

**Interface (4557):**
- **Constants**, after `_BT_TICK_MS` (`:7454`): `_BT_INTERVAL_MS=604800000` and `_BT_OVERDUE_SLACK_MS=86400000`. In the L0 comment (`:7413-7417`), add: `_BT_INTERVAL_MS` is `TOKEN_ROTATION_INTERVAL_MS` and `_BT_OVERDUE_SLACK_MS` is `TOKEN_ROTATION_OVERDUE_SLACK_MS` (`shared/box-token.ts`). In the doctor-local words paragraph (`:7421-7423`), add `rotation-overdue:` (4557), computed from the state and never persisted, like `pending-overdue`.
- **`_BT_PY_STATE`** (inside the single-quoted program: no `'` anywhere, Global Constraints).
  - argv gains two values: `:7459-7460`'s comment gains "the rotation interval and the overdue slack in ms", and after `:7474` add `interval, slack = int(sys.argv[10]), int(sys.argv[11])`.
  - After `say("refused", …)` (`:7530`):

    ```python
    # 4556/4557: the anchor of the schedule is the last promotion, else the mint of the current value. A stamp ahead of
    # this clock is said (the schedule waits for it, or rotates at once when it is more than one interval ahead).
    anchor = lr if lr is not None else c["since"]
    if anchor > now:
        say("ahead", (anchor - now) // 1000, 1 if anchor - now > interval else 0)
    ```
  - After the owed finding (`:7550-7551`):

    ```python
    # 4557: no rotation for longer than the interval plus its slack, with no hold standing and nothing pending (a
    # rotation in flight, staged, handed out or promoting, always has its id pending, so it is not overdue).
    if now - anchor > interval + slack and s["hold"] is None and not s["pending"]:
        say("finding", "rotation-overdue", (now - anchor) // 1000)
    ```
- **The call** at `:7852-7854` appends `"$_BT_INTERVAL_MS" "$_BT_OVERDUE_SLACK_MS"`.
- **`_bt_server_arm`.**
  - Locals (`:7840`) gain `ahead="" aheaddue=0`.
  - The parser gains `ahead) if _bt_num "$w" && [[ "$n" =~ ^[01]$ ]]; then ahead="$w"; aheaddue="$n"; else bad=1; fi ;;` beside `since)` (`:7892`).
  - `rotation-overdue` joins the `mint-failed|pending-overdue|proof-unmeasured|recovered)` arm (`:7900`).
  - On the PASS line, after `:7924`:

    ```bash
    if [ -n "$ahead" ]; then
      if [ "$aheaddue" = 1 ]; then extra="$extra, its schedule stamp $(_bt_age "$ahead") ahead of this clock (more than the interval, so the server rotates now)"
      else extra="$extra, its schedule stamp $(_bt_age "$ahead") ahead of this clock (the weekly schedule waits for the clock to pass it)"; fi
    fi
    ```
- **`_bt_find`**, after `server:rotation-owed:*)` (`:7744-7746`):

  ```bash
  server:rotation-overdue)   # 4557: doctor-local, computed from the state, never persisted
    say="no rotation has completed for $(_bt_age "$a"), past the $(_bt_age "$((_BT_INTERVAL_MS / 1000))") schedule and its $(_bt_age "$((_BT_OVERDUE_SLACK_MS / 1000))") slack, with no hold standing and nothing in flight"
    fix="a running server starts the scheduled rotation on its next tick unless a backoff stands: read the console's Box token card and the server's log; if the server is not running, start it (ccrc.service)" ;;
  ```

  The default class is WARN (`:7703`).
- **Plan addition, beside ruling 6** (the attack's minor break 6): "nothing pending" is part of the rule. Without it, a release that lands after the due instant can show a rotation in flight to its own doctor tail as `rotation-overdue`. It only narrows the WARN. A `promoting` clause is not written: promote step (a) records `promoting` while its id is still pending (`server/src/token/driver.ts:420`), and `promotedState` clears both in one step (`server/src/token/policy.ts:474-481`), so such a clause could not change any reachable verdict.

- [ ] **Step 1: The live-age guard first.** It is green at `e4405056e`, and every later commit keeps it green. In the PASS describe, after `:242`, add two rows, each with the server live plant (`:216-222`) and `lastRotationAt` and `current.since` set to the age:
  - `it('the live server two days after its rotation reads the live line, PASS (row 3a invariant)')`: age `2 * 24 * 60 * MIN + 5 * MIN`. Expect `PASS box-token: server: generation #3, rotated 2 d ago, fleet confirmed, retired value refused\n`, rc 0, empty stderr, on `CHECKS_SRC` and `disarmed()`.
  - `it('seven days and twenty-three hours after the last rotation is still PASS: the overdue WARN waits for the slack (row 3a invariant)')`: age `(7 * 24 + 23) * 60 * MIN`. Expect `… rotated 7 d ago, fleet confirmed, retired value refused\n`, rc 0.

  Run the file: green.
- [ ] **Step 2: Write the failing rows.** Import `TOKEN_ROTATION_INTERVAL_MS` and `TOKEN_ROTATION_OVERDUE_SLACK_MS` (`:28`). Let `OVER = TOKEN_ROTATION_INTERVAL_MS + TOKEN_ROTATION_OVERDUE_SLACK_MS`.
  - A ROWS entry after `:293`: `{ arm: 'server', word: 'rotation-overdue', armedClass: 'WARN', plant: (b) => editState(b, (s) => { s.lastRotationAt = now() - OVER - 60 * MIN; }) }`. It runs armed (WARN, two lines, rc 2, `:599-613`) and disarmed (SKIP, rc 3, `:386-403`).
  - A new describe after the 4552 describe (`:407-490`), named `describe('doctor box-token: the weekly schedule, overdue and ahead (4557)')`:
    - `it('a null lastRotationAt counts from current.since: a minted value never rotated for eight days is overdue')`: origin `minted`, `lastRotationAt: null`, `retiredRefusedAt: null`, `current.since = now() - OVER - 60 * MIN`. Expect `^WARN box-token: server: rotation-overdue — no rotation has completed for 8 d`, a remedy line and rc 2.
    - `it('a standing hold is the finding, not the schedule')`: an old anchor plus `hold: 'link-down'`. Expect the line to contain `server: held:link-down — ` and `not.toContain('rotation-overdue')`. This is also Q4's box: a gate that never opens reads its existing hold word, never `rotation-overdue`.
    - `it('a rotation in flight is not overdue: a staged value, then a promotion recorded')`. Use an old anchor plus `pending = [{ id: ID_OLD, seq: 3, stagedAt: now() - MIN, handedOutAt: null, confirmBy: null, write: { dev: 1, ino: 3, writtenAtMs: now() - MIN } }]`. Expect `^PASS box-token: server: generation #2, rotated 8 d ago, fleet confirmed, retired value refused, a rotation in progress\n$`. Then the same with `promoting: { id: ID_OLD }` (with that pending entry kept, the only reachable shape): the same line.
    - `it('an owed rotation that is also overdue names both')`: `rotationOwed: true, owedWhy: 'recovered'` and an old anchor. Expect the line to contain `server: rotation-owed:recovered — ` and `server: rotation-overdue — `, rc 2.
    - `it('a stamp ahead of the clock says so on the PASS line, and the schedule waits')`: `lastRotationAt = now() + 2 * 60 * MIN + 5 * MIN` (a margin off `_bt_age`'s 7200 s boundary, `ccd/ccrc-doctor-checks:7651-7656`: Python reads its clock a few ms after the test's `now()`). Expect `PASS box-token: server: generation #2, rotated 0 s ago, fleet confirmed, retired value refused, its schedule stamp 2 h ahead of this clock (the weekly schedule waits for the clock to pass it)\n` (`age` clamps a future stamp to 0).
    - `it('a stamp more than one interval ahead says the server rotates now')`: `lastRotationAt = now() + TOKEN_ROTATION_INTERVAL_MS + 60 * MIN`. Expect the line to contain `its schedule stamp 7 d ahead of this clock (more than the interval, so the server rotates now)`.
  - In the L0 pins describe, after `:1233`: `it('the interval and its overdue slack are L0\'s (4557)')`: `expect(arr('_BT_INTERVAL_MS')).toEqual([String(TOKEN_ROTATION_INTERVAL_MS)])` and `expect(arr('_BT_OVERDUE_SLACK_MS')).toEqual([String(TOKEN_ROTATION_OVERDUE_SLACK_MS)])`.
- [ ] **Step 3: Run RED** `test/doctor-box-token.test.ts`.
  - Red: the ROWS row (armed: PASS, not WARN; disarmed: PASS, not SKIP), the null-anchor row, the owed-and-overdue row, both ahead rows, and the L0 row.
  - Green before the fix: the hold row, both in-flight rows and Step 1's two rows. Their reds are measured under mutants 1, 2 and 4 below.
- [ ] **Step 4: Implement** the interface above. Check the quote rule (Global Constraints) before running.
- [ ] **Step 5: Run GREEN,** one call each, in the form under "Running tests":
  - `test/doctor-box-token.test.ts`
  - `test/ccrc-doctor.test.ts` with `-t 'box-token'`
  - `test/ccrc-install.test.ts` split by `-t`, one per call. The fresh-install goldens (`-t 'a fresh box ends green'`, `-t 'fresh fleet box'`) and `-t 'live shape'` must not move: a fresh state is minted now, and a fleet role has no server arm. Its `_BT_PY_STATE` shim (`:158-161`) proves the program is still one single-quoted string.
  - `test/ccrc-update.test.ts` split by `-t`, one per call
  - `test/macos-platform.test.ts` (`$(( ))`, `[[ =~ ]]` and `_bt_age` are bash 3.2)
  - `test/typecheck-tests.test.ts`
  - the live-shape set

  If any install, update or doctor fixture moves, stop. Report it with its fixture's files, never by editing an expectation by hand.
- [ ] **Step 6: Commit** (`feat(doctor): rotation-overdue, and a schedule stamp ahead of the clock said on the PASS line (4557)`).

| Mutation in `ccd/ccrc-doctor-checks` | Must red |
|---|---|
| 1. `and s["hold"] is None` dropped | the hold row |
| 2. `and not s["pending"]` dropped | both in-flight rows (staged, and promoting with its id pending) |
| 3. (not written: a `promoting` clause would be an equivalent mutant in every reachable state; named in the commit) | — |
| 4. `interval + slack` becomes `interval` | Step 1's seven-days-and-twenty-three-hours row |
| 5. `anchor = lr` (no `current.since` fallback; `None` skips the finding) | the null-anchor row |
| 6. `rotation-overdue` left out of the parser's arm | the ROWS row (`state-unreadable` FAIL) |
| 7. `_BT_INTERVAL_MS=691200000` | the L0 row, and the ROWS row (8 d + 1 h against an eight-day schedule plus a day of slack reads PASS) |
| 8. The `ahead` words deleted | both ahead rows |
| 9. The ahead due flag inverted | both ahead rows |

### Task 6: Row 2c's residue: F1's sentence, the R18 reorder and the R19 word (4554 amended)

**Files:** `docs/superpowers/plans/2026-10-12-box-token-lifecycle-row-2c.md` (`:585` only in this task), `ccd/ccrc-doctor-checks` (`_bt_server_trace` `:7810-7837`; the server arm's comment `:7862-7868` and its absent branch `:7869-7884`; locals `:7840`) and `server/test/doctor-box-token.test.ts` (the unsearchable describe `:1098-1191`, the never-handed describe's `:916`).

- [ ] **Step 1 (review 409 F1, prose).** In the row 2c plan at `:585`, replace "(before this round it read the never-minted PASS)" with "(before this round it read WARN, rc 2: its server part was the never-minted PASS, beside the fleet part's `no-generation`, because a purge removes the generation file with `~/.ccrc`; a WARN does not count toward doctor's exit, so the install then exited 0)". Nothing else on that line changes. (The ledger's own 05:36 line is the coordinator's, in its own ledger commit.)
- [ ] **Step 2: Write the failing rows,** in the unsearchable describe after `:1190`, using its `itNonRoot`, `unlistable`, `listless` and `unsearchable` helpers:
  - R18a `itNonRoot('server: an unlistable token directory that also holds a named trace gets the chmod u+r remedy, never the restart remedy (row 3a, R18; 4554 limit (a) closed)')`. Use `box({ role: 'server' })` and `alt = unlistable(b, 'server')`. Plant `writeFileSync(join(alt, 'box-token-retired.json'), RETIRED, { mode: 0o600 })` before `listless(alt, …)`. Expect:
    - `^FAIL box-token: server: token-absent — .* cannot be listed`;
    - the remedy line contains `chmod u+r ` and not `restart the server`;
    - `not.toContain(SERVER_NEVER)`;
    - rc 1.
  - R18b `itNonRoot('both role, local, own-write: an unlistable token directory with the fleet file and the generation file surviving gets the chmod u+r remedy (row 3a, R18)')`. Use `box({ role: 'both' })` and `alt = unlistable(b, 'both')`, keeping `fleetFile(b)` and the generation file and removing `token-sync.json`. Expect:
    - `^FAIL box-token: server: token-absent — .* cannot be listed`;
    - the remedy contains `chmod u+r `, and the remedy line does not contain `restart the server (ccrc.service)`;
    - rc 1.
  - R19 `itNonRoot('both role, local, own-write: ~/.cc-secrets that cannot be searched is its own word on the server part, unsearchable, with a chmod u+x remedy; the line stays FAIL rc 1 (row 3a, R19)')`. Use `box({ role: 'both' })`; `rmSync` `mail.token`, `box-token.json`, the generation file and `token-sync.json`; then `unsearchable(join(b.home, '.cc-secrets'), …)`. Expect:
    - `^FAIL box-token: server: token-absent — .* cannot be searched, so whether this box's server wrote the fleet token file there cannot be told`;
    - the line contains `fleet: fleet-token-unusable — `;
    - a remedy line contains `chmod u+x ` followed by the `.cc-secrets` path;
    - `not.toContain(SERVER_NEVER)` and `not.toContain('cannot be listed')`;
    - rc 1;
    - disarmed: `^SKIP box-token: `, rc 3.
  - R19g `itNonRoot('both role, local, own-write: with ~/.cc-secrets unsearchable but the generation file present, the generation file is the named trace (row 3a, R19)')`. As R19, but keep the generation file (`~/.ccrc/box-token-generation`, outside `.cc-secrets`, `ccd/ccrc-doctor-checks:7804-7807`). Expect the server part to name the generation file's path with "this server held a value once", `not.toContain('cannot be searched')`, the line FAIL, rc 1.
  - R19d `it('both role, local, own-write, fresh, with no ~/.cc-secrets at all: the fresh PASS on both parts (row 3a, R19: a missing directory is not unsearchable)')`. In the never-handed describe after `:924`: `box({ role: 'both' })`, `dropServer(b); dropFleet(b); rmSync(join(b.home, '.cc-secrets'), { recursive: true })`. Expect `^PASS box-token: ${never('server')}; ${never('fleet')}\n$` and rc 0.
  - The existing rows stay unchanged and green: `:1105` (the fleet role, unsearchable), `:1137`, `:1167` and `:1179` (the unlistable rows), `:738`, `:916`, the review 405 F1 rows (`:951-1035`), and the trace rows (`:801-838`, `:937-950`).
- [ ] **Step 3: Run RED** `test/doctor-box-token.test.ts`.
  - Red: R18a and R18b (the restart remedy), and R19 (the never-minted server part).
  - Green before the fix: R19g (the generation file is already a trace) and R19d. Their reds are measured under mutants 7 and 6 below.
- [ ] **Step 4: Implement.**
  - `_bt_server_trace` becomes:

    ```bash
    _bt_server_trace() {
      local d="$1" own="${2:-0}" n f BT_FLEET_FILE BT_GEN_FILE
      BT_TRACE=""; BT_TRACE_DIR=""
      # Row 3a (R18): the unlisted test comes FIRST, whatever the directory or the fleet side holds: boot refuses to start
      # on a directory it cannot list, so `chmod u+r` is the remedy there, never "restart the server".
      if [ -d "$d" ] && [ ! -r "$d" ]; then BT_TRACE=unlisted; return 0; fi
      for n in "${_BT_TRACES[@]}"; do
        if [ -e "$d/$n" ] || [ -L "$d/$n" ]; then BT_TRACE="$d/$n"; return 0; fi
      done
      if [ "$own" = 1 ]; then
        _bt_fleet_paths
        # The generation file lives outside the fleet token file's directory, so it is tested first: when it stands, the
        # history is told whatever that directory's mode.
        if [ -e "$BT_GEN_FILE" ] || [ -L "$BT_GEN_FILE" ]; then BT_TRACE="$BT_GEN_FILE"; return 0; fi
        # Row 3a (R19): a fleet-side directory that exists and cannot be searched hides the fleet file from `-e`; it is its
        # own word, never `unlisted`: two conditions, two remedies (u+x, u+r).
        f="${BT_FLEET_FILE%/*}"
        if [ -d "$f" ] && [ ! -x "$f" ]; then BT_TRACE=unsearchable; BT_TRACE_DIR="$f"; return 0; fi
        if [ -e "$BT_FLEET_FILE" ] || [ -L "$BT_FLEET_FILE" ]; then BT_TRACE="$BT_FLEET_FILE"; return 0; fi
      fi
      for n in "${_BT_ASIDE[@]}"; do
        for f in "$d/$n"*; do
          if [ -e "$f" ] || [ -L "$f" ]; then BT_TRACE="$f"; return 0; fi
        done
      done
      return 0
    }
    ```
  - `_bt_server_arm`'s locals (`:7840`) gain `BT_TRACE_DIR=""`. In the absent branch, after the `unlisted` arm (`:7876-7879`), add:

    ```bash
    elif [ "$BT_TRACE" = unsearchable ]; then
      BT_PART[tai]="server: token-absent — $tok does not exist, and neither does the server's state file, and $BT_TRACE_DIR cannot be searched, so whether this box's server wrote the fleet token file there cannot be told"
      BT_FIX[tai]="give $BT_TRACE_DIR its search bit (chmod u+x $BT_TRACE_DIR); doctor can then tell whether this box's server held a value"
    ```

    The class stays `token-absent`'s FAIL, as for `unlisted` (an undecidable history fails closed). `BT_SERVER_STATE=trace` is set as for every trace. No new FAIL class or word joins `_bt_find`.
  - **Comments.**
    - `:7810-7817`: the order (unlisted first, then the named traces, then on an own-write box the generation file, `unsearchable` and the fleet file, then the set-aside copies), and the three words `BT_TRACE` can hold besides a path (`unlisted`, `unsearchable`, empty), with `BT_TRACE_DIR` set for `unsearchable`.
    - `:7865-7868`: "A token directory that exists and cannot be listed … fails closed with a sentence and remedy of its own, whatever else it or the fleet side holds (row 3a); on an own-write box with no generation file, a `~/.cc-secrets` that cannot be searched does too (`unsearchable`, remedy `chmod u+x`)".
    - In the test, `:1153-1155`: add "whatever the directory or the fleet side also holds (row 3a, R18)".
- [ ] **Step 5: Run GREEN,** one call each, in the form under "Running tests":
  - `test/doctor-box-token.test.ts`
  - `test/ccrc-doctor.test.ts` by `-t 'box-token'`
  - `test/ccrc-install.test.ts` by `-t` (as Task 5), one per call
  - `test/ccrc-update.test.ts` by `-t`, one per call
  - `test/macos-platform.test.ts`
  - `test/typecheck-tests.test.ts`
  - the live-shape set
- [ ] **Step 6: The verdict grid.** Rebuild review 409's grid (role × fleet mode × agent.env × the server's token, state and each trace × the fleet file, generation file and report × the token directory's mode × `~/.cc-secrets`' mode) on fixture HOMEs under the scratchpad. Copy the two trees with `git archive e4405056e | tar -x -C "<scratch>/grid-base"` and `git archive HEAD | tar -x -C "<scratch>/grid-tip"`. Run each cell from an empty environment, with `HOME` forced to that cell's fixture in the same command, absolute quoted paths and never `~`:

  ```bash
  case "$fixture" in "$REAL_HOME"|"$REAL_HOME"/*) echo "refusing: fixture under the real home" >&2; exit 2 ;; esac
  env -i HOME="$fixture" BOX_ENV_FILE="$fixture/.ccrc/ccrc.env" PATH="/usr/bin:/bin" \
    bash -c 'source "$1/ccd/ccrc-doctor-checks"; _check_box-token' _ "$tree"
  ```

  where `REAL_HOME` is captured once with `getent passwd "$(id -un)" | cut -d: -f6`, `$fixture` and `$tree` are absolute paths under the scratchpad, and the guard aborts the whole grid on the first match. Record:
  - every row's verdict and rc, which must be identical;
  - the rows whose text moves, which must be own-write, unlistable or unsearchable rows only.

  Write the counts in the commit message, never any output line that could hold a value. Root runners skip the mode rows.
- [ ] **Step 7: Commit** (`fix(doctor): an unlistable token directory always gets chmod u+r, and an unsearchable fleet directory its own word (row 3a; review 409 F1; 4554 amended)`).

| Mutation in `ccd/ccrc-doctor-checks` | Must red |
|---|---|
| 1. The unlisted test moved back below the named-trace loop | R18a |
| 2. The unlisted test moved back below the own-write block (above the set-aside glob) | R18b |
| 3. The `unsearchable` test deleted | R19 (the never-minted sentence returns) |
| 4. `BT_TRACE=unsearchable` written as `BT_TRACE=unlisted` | R19 (`cannot be listed`, `chmod u+r`) |
| 5. The remedy's `u+x` written as `u+r` | R19 |
| 6. `[ -d "$f" ]` dropped from the unsearchable test | R19d |
| 7. The generation-file test moved below the unsearchable test | R19g |

### Task 7: The prose and the deviation texts: 4556, 4557 and 4558 settled; 4552 and 4554 amended

**Files:** this plan and `docs/superpowers/plans/2026-10-12-box-token-lifecycle-row-2c.md` (`:573`, `:586`, `:587`). Every correction states the measured truth. A count the worker cannot re-measure on this branch is quoted from review 409 and attributed to it.

- [ ] **Step 1 (4554's limits in the row 2c plan).** Append to each a closing sentence; nothing else changes:
  - `:573` (limit (a)): "Closed by row 3a (R18): the unlisted test now runs first, so this directory reads the unlisted sentence and the `chmod u+r` remedy; the verdict is unchanged."
  - `:586` (an unsearchable `~/.cc-secrets`): "Closed by row 3a (R19): with no generation file standing, the server part now reads its own word, `unsearchable`, with a `chmod u+x` remedy; the line stays FAIL rc 1 through the fleet part's `fleet-token-unusable`, and a missing `~/.cc-secrets` is not unsearchable."
  - `:587` (an unlistable token directory beside a surviving own-write file): "Closed by row 3a (R18): the unlisted test now runs before the own-write traces, so the remedy is `chmod u+r`; the verdict is unchanged."

  `:323` and `:566` state the unlistable rule flat. After R18 they are true as written, so they stay as they are.
- [ ] **Step 2: Settle 4556, 4557 and 4558** in this plan's Deviations found, to what Tasks 2 to 6 measured. That means the exact names, the sentences and words (4558's warn line included), the counts (E4, E8a to E8e and E9 as measured), the coordinator's answers to Q1 to Q4 as stated above, and any limit found on the way. Keep each entry's number.
- [ ] **Step 3: The amendments.** Settle the 4552 and 4554 prose amendments below, to what Tasks 3 and 6 measured.
- [ ] **Step 4:** Run `git fetch origin main` (its own call), then `test/deviation-refs.test.ts`, `test/dtbd.test.ts` and `test/topology-clean.test.ts`, one call each, in the form under "Running tests". Commit (`docs(plan): 4556, 4557 and 4558 settled; 4552 and 4554 amended; row 2c's limits closed`).

### Task 8: Verification and hand-off (no commit)

- [ ] **Step 1:** Re-read claims. Probe `git merge-tree origin/main HEAD`, and merge only on a ruled trigger (Global Constraints). If #381 landed first, this branch is the second lander for `ccd/ccrc-doctor-checks`: keep both sides, re-derive every count and line, and re-run the touched suites.
- [ ] **Step 2: Every touched suite on the tip,** one file per call, in the foreground, in the form under "Running tests" (`HOME` and `TMPDIR` forced to fixture directories in the same command, from inside the package):
  - `token-shared`
  - `token-policy`
  - `token-rotation-e2e`
  - `token-rotation-real-verb`
  - `(agent) token-sync-op`
  - `token-boot`
  - `token-files`
  - `token-claim-route`
  - `update-routes`
  - `doctor-box-token`
  - `ccrc-doctor` (by `-t`, one per call)
  - `ccrc-install` (by `-t`, one per call), including `-t 'live shape'`: re-measured, never hand-edited
  - `ccrc-update` (by `-t`, one per call)
  - `ccrc-token-sync`
  - `box-token-census`
  - `macos-platform`
  - `single-definition`
  - `typecheck-tests`
  - `topology-clean`
  - `deviation-refs`
  - `dtbd`
- [ ] **Step 3: The per-commit invariant.** For each commit of the branch, make a copy with `git archive <sha> | tar -x -C "<scratchpad>/c-<sha>"`. Never use `git worktree add`, which registers in the shared worktree list, and never `git checkout` in this one. Symlink `server/node_modules` and `agent/node_modules` into the copy from this worktree. There, run the live-shape set one file (or one `-t`) per call, in the foreground, from inside the copy's `server/`, with `HOME` and `TMPDIR` forced to fixture directories under the scratchpad in the same command. Record one line per commit, and remove each copy afterwards.
- [ ] **Step 4: CI.**
  - Run the PR. Check that its `select tests` summary lists `token-shared`, `token-policy`, `token-rotation-e2e`, `doctor-box-token`, `ccrc-doctor` and `ccrc-install`.
  - Then run `gh workflow run ci.yml --ref <branch> -f mode=full` on the tip. macOS legs are advisory. `test (pwa)` must be green: it type-checks the PWA against the new optional field.
- [ ] **Step 5: Wave-done,** as before:
  - the fingerprint (the workspace branch tip);
  - both CI runs;
  - each task's red and green;
  - every mutation row's counts, and the named limits no test can see;
  - Step 3's per-commit lines;
  - Task 6's grid counts;
  - the re-measured fresh-install and live-shape results;
  - 4556, 4557 and 4558 defined, 4552 and 4554 amended, no other number;
  - anything dropped under the claims rule.

  List mail before sending it. The squash body at merge is written by hand, with numbers bare (row 2c's review 405 F2).
- [ ] **Step 6 (the coordinator's, not the worker's).** After the release reaches both boxes, re-measure both doctors read-only: both must read `PASS`, and no update may exit 3. Then prove the first scheduled rotation live and read-only, on or after its due instant (R20): the server's generation moves by one, the phase returns to idle through grace, and the fleet confirms. Never print a value, a code or a digest.

## Not in this PR (owner, why)

- **The console card's "next rotation" line.** The view carries `nextRotationAt`; the card reads it in a later part. Ruling 5 named 3d; since the operator's 08:19 reorder the console sits in 3e, the arming part (`pwa/` is outside 3a). Owner: the coordinator, per the 08:19 order.
- **The server's clock on the view (Q3, residue for 3e).** In 3a the view's future-stamp signal is `nextRotationAt` more than one interval after the server's `now`, and the view carries no server clock, so a reader compares against its own (4557's limit). 3e's console card may add the server's clock. Owner: 3e.
- **The agent link token, parts 3b to 3e:** 3b the dormant readers with the generation marker, 3c rotation dormant behind its cap word, 3d the pairing and repair door, 3e the arming part. The operator ruled both row-3 questions at 08:19 UTC ("accept, guard it"; "console code, before arming"). The interval's generic name is the only thing 3a leaves for them. Owner: the coordinator, then 3b to 3e.
- **`README.md`'s `box-token` row** (one sentence naming `rotation-overdue`). Claim 1222 holds the file, and no test reads doctor's words from it. Owner: the coordinator, under that claim's consent, in a later part.
- **`server/test/single-definition.test.ts`.** Claim 1219 holds it, so the interval's pins live in `token-shared.test.ts` (ruling 4). The seven-day regex's gaps there (`:4784`: ms spellings, no `shared/` or `agent/src`) stay, because the value scan here covers this constant. Owner: the coordinator, if that pin itself is to widen.
- **`shared/api.ts`'s `LEDGER_STALE_MS` and `server/src/childReclaimSweep.ts`'s horizon.** These are separate seven-day quantities, listed as holders (confirmed, Q2) and not moved. Owner: their programmes.
- **The schedule on a box with no fleet to hand a value to** (Q4). Accepted as true: it persists its existing hold word and reads `WARN held:<word>`; `nextAction`'s chain is unchanged. Owner: none, by the answer.
- **4552's F4 limit: a retired presentation is lost while the clock is behind `lastRotationAt`** (`server/src/token/driver.ts:686-691`, pre-existing). 3a's rules do not touch it: the schedule waits within one interval of a future stamp, which keeps the clamp rows green, as ruled. Owner: the coordinator, for a later part.
- **Boot's own history judgement** (row 2c: a disk with only traces boots as a first install, `server/src/token/boot.ts:165-167`), **`mail-pending-<id>.token` as a trace**, **an unreadable trace's sentence**, and **4554 limit (b)** (`[ -r ]` stands in for listability). They are unchanged. Owner: the coordinator.
- **A stall alert for a held schedule.** The 24 h alert keys on the persisted owed flag (`server/src/token/driver.ts:200-202`, `:763-766`), and the schedule is never persisted (R4). A held schedule shows its persisted hold word (`held:<word>` WARN, and the card's `held:` line); a silent one shows `rotation-overdue`. Owner: none, by the ruling.
- **An unsearchable `~/.ccrc` (the generation file's directory).** On such a box `ccrc.env` cannot be read either, so doctor takes the no-role path. Unchanged. Owner: none.
- **The ledger's 05:36 correction** (review 409 F1's ledger half), **the note to the history store's coordinator** (each weekly rotation adds a retired value), **the macOS fleet-role finding** (the scout's, filed separately in neutral words), and **the other programme's soak note**. These are the coordinator's, in its own ledger commit and mail.
- **`agent/CLAUDE.md:76`'s read half.** Owner: 3b.

## Review Focus

1. **The live rotation path (bar class 1).** Confirm, by reading the diff at the tip:
   - These are empty: `agent/`, `ccd/ccrc-token-sync`, `shared/agent-protocol.ts`, and `server/src/token/{door,routes,link,boot,files,ports}.ts`.
   - `rotationGate`'s body and `GateInput` are byte-identical (`:122-141` green unchanged, apart from the hold-rule row's added scheduled case).
   - The schedule is only a new last arm of `nextAction`'s why chain, plus one optional input read on that arm alone (4558). It never sets `rotateRequested`, never bypasses the normal backoff (P5), and never sits before a press (P4).
   - One rotation runs at a time (P6, E2). "Rotate now" is unchanged.
   - `runTick`'s fresh-ready reset (`:233-234`) is byte-identical.
   - `token-rotation-real-verb` and `token-sync-op` are green.
2. **`box-token.json` byte compatibility with the previous build (class 3).**
   - No new key, owed word or hold word is persisted by a scheduled stage, hand-out or promotion. E1 checks every captured write, and E5 shows a hold by an existing word.
   - The scheduled-miss backoff (4558) is three in-memory fields; nothing of it reaches `commit`.
   - `OWED_REASONS`, `TOKEN_HOLDS`, `isBoxTokenState`, the PWA reader and doctor's validator are unchanged, so the previous build, its PWA and its doctor read the state exactly as after a "Rotate now".
   - Mutant 10 shows what a persisted word would cost, through the captured writes.
3. **The anchor and clock rules (class 4).**
   - The null anchor is `current.since` (P2, E6), and `token-policy.test.ts:238-241` and `:420-441` (`:428`) stay green.
   - A future anchor within one interval waits, and one beyond it is due (P3, E7).
   - The boundaries are `>=` and `>` (mutants 1 and 6).
   - 4552's clamp rows `:1852`, `:1870`, `:1888` and `:717` are green UNCHANGED.
   - The e2e plants are on the new rig's clock (`restartDue`), and every due or not-due row asserts its precondition through the describe's own `dueByL0`, not the policy under test.
4. **The scheduled-miss backoff (class 1/4; 4558, the coordinator's answer to Q1).**
   - A scheduled attempt that does not complete (its pending file could not be written, or its send's answer promoted nothing) sets the schedule's own backoff on the normal ladder's steps and bound.
   - A fresh ready does not clear it: E8a, E8b and E8e red under mutant 15. With no fresh ready it climbs too (E4).
   - It is read for the `scheduled` why only. An owed rotation and a press keep spec §5.1's rule, byte-identical to main: E8c and E8d were green before the fix and red under 14b; P8 and E8g red under 14a (E8g holds a press while a scheduled miss stands; E8c and E8d stay green under 14a); the F3 describe is green unchanged.
   - It is memory only, any promotion resets it (E9, mutant 17), and a restart clears it.
   - It is not a `GateInput` change and adds no hold or owed word; a closed gate still says its hold first (P8).
   - G4 still holds: a persistent real fault reaches the banner and doctor's `failed:*` FAIL across ladder steps (E8b's end state), and no faster than one failure per step (E8b's minute-2 count).
5. **The interval, pinned by value (class 6).**
   - It has one home.
   - The value scan covers every scout spelling (the CONTROLS) across `shared/`, `server/src`, `pwa/src` and `agent/src`, with exactly three holders, each a separate quantity, as the coordinator confirmed (Q2).
   - Doctor's shell copies of the interval and the slack are pinned to L0.
6. **Doctor's live PASS (class 2).**
   - Both live shapes read `PASS`: the row 2c rows, Task 5 Step 1's "rotated 2 d ago" (the live line, byte for byte) and the 7 d 23 h row.
   - The overdue WARN needs no hold, nothing pending and nothing promoting (Task 5's rows; the plan addition beside ruling 6; the promoting term and its row are group G's, G1).
   - `_BT_PY_STATE` is still one single-quoted string with no added `'` (the install, update and doctor shims are green), and `_BT_PY_FLEET` is untouched.
   - No `update`, `rollout` or `install` exit code changes for the live shapes: the install and update suites are re-measured, and a WARN never counts (`ccd/ccrc:3774`).
   - The live effect's post-release hold transient is an existing word, reachable only if the release lands after the due instant.
7. **The view (class 3).**
   - `nextRotationAt` is optional and additive. It is null only without a current value (V4, on a box with history), and `now` when due (V3). A stamp ahead reads more than one interval after the server's `now` (V5), which the coordinator accepted as 3a's whole future-stamp signal (Q3); the missing server clock is named as residue for 3e.
   - `update-routes` is green unedited. The PWA reader is untouched, and `test (pwa)` is green.
8. **The residue's verdicts unchanged (class 5).**
   - R18 and R19 move sentences and remedies only, on unlistable token directories and, on own-write boxes with no generation file, unsearchable `~/.cc-secrets`.
   - Task 6's grid shows every verdict and rc identical to `e4405056e`, and was run with `HOME` forced per cell. It was re-run after the set-aside move: 0 of 1173 differ, and only the both-local set-aside cells moved.
   - Every existing row is green unedited, apart from the one comment.
   - `unsearchable` is not folded into `unlisted` (mutant 4), and the remedies name the right bit.
   - A missing `~/.cc-secrets` stays the fresh PASS (R19d); a standing generation file is still the named trace (R19g).
   - The kill switch prints SKIP for the new rows: R18a, R18b, R19, R19g and the set-aside row each also run the disarmed copy (group G, G4).
   - The verdict grid (Task 6 and group C) and the prose pin (group E) are evidence scripts kept outside the tree, under the gitignored evidence directory. Their counts are records of measured runs, and the tree alone cannot reproduce them (group G, G14).
9. **Every new pin reds under its mutant,** with the counts its commit records. Each "green before the fix" row is named, with its mutant's red; each no-change row (P6b) is named as one.
10. **Secrets (class 8).** No value, code or sha256 in any output, log, test output or report (`runCheck`'s scan, `:157-175`). Doctor opens neither the fleet file nor `mail-previous.token`. 4558's warn line names an answer's kind and an attempt count only.
11. **Scope (class 9).** Only the File Structure's files are edited. Only one line of the row 2c plan changes in Task 6, plus three appended sentences in Task 7, and this group's one amended line (4554: the R19 closing sentence at `:586` gains the set-aside order).
12. **Numbers (class 10).**
    - Only 4556, 4557 and 4558 are defined, bare, each first cited in Task 1's commit and settled in Task 7. 4559 and 4560 are unused.
    - 4552 and 4554 are amended in prose only.
    - `git grep -nE 'D-45(5[2-9]|6[0-9]|70)'` at the tip, in the commit messages and in the PR body is empty.
    - `deviation-refs` is green against `origin/main`.
13. **The public repo (class 11).** No private host, path, lane, account, project, programme or ticket in the diff, the commit messages or the PR body.

## Deviations found

- **4556** (row 3a; the operator's R4 interval, and the coordinator's R4, R5 as amended, R6 and R8 of 2026-10-13 07:46 UTC). Settled by Task 7, to what Tasks 2 and 3 measured.
  - **The rule.** The weekly schedule is a derived trigger with the why word `scheduled`.
    - `nextAction` computes it on every step from the persisted state, and it is never persisted.
    - It is the last arm of the why chain, after `rotate-now`, so an owed word, a lost hand-out, a behind fleet and a press each name and spend their own rotation.
    - The anchor is `lastRotationAt`, or `current.since` when that is null. The schedule is due when `now - anchor >= TOKEN_ROTATION_INTERVAL_MS` (7 days), or when the anchor is more than one interval ahead of now. An anchor ahead by one interval or less waits, bounded by the skew.
  - **The names.** `shared/box-token.ts` declares `TOKEN_ROTATION_INTERVAL_MS` (7 days) and `TOKEN_ROTATION_OVERDUE_SLACK_MS` (1 day). `server/src/token/policy.ts` exports `scheduleAnchor`, `scheduleDue` and `nextScheduledAt`, and `nextAction`'s why chain ends `... rotateRequested ? 'rotate-now' : scheduleDue(state, now) ? 'scheduled' : null`.
  - **Staging.** `stage()` owes nothing for `scheduled`, as for `rotate-now`, so `rotationOwed`, `owedWhy` and `box-token.json` gain no word and no key. The log line is `rotation started (generation #n, scheduled)`.
  - **What it rides unchanged:** `rotationGate` with no new input, the normal backoff (only a press bypasses it), the pending cap, the learned holds, the one-rotation-at-a-time rule, and the persisted hold words. Its own scheduled-miss backoff is 4558.
  - **The interval.** `TOKEN_ROTATION_INTERVAL_MS` is declared once in `shared/box-token.ts`. It is pinned by name, by value, and by a scan of `shared/`, `server/src`, `pwa/src` and `agent/src` for any numeric expression equal to 604800000. The allowed holders are exactly the new home, `LEDGER_STALE_MS` and `CHILD_RECLAIM_LEAF_KEPT_HORIZON_MS`, three separate quantities, as the coordinator confirmed (Q2).
  - **Why:** spec §5.1 "Schedule (wave 2)" and R4. A persisted owed word would make a rollback set the state aside: an older `isBoxTokenState` rejects an unknown `owedWhy` (`server/src/token/files.ts:122`), boot mints, and the fleet answers 401 until a forward rotation. A null anchor that never fires would leave a both box that never promotes unrotated forever. A future anchor read as due would undo 4552's no-re-open rule (`server/test/token-rotation-e2e.test.ts:1888`).
  - **Measured.**
    - Task 2, `token-shared` (37 tests): RED 3 failed, 34 passed (the by-value row, the one-definition row, the holders row); the 14 scanner CONTROL rows are green before the fix, so their red is the mutants'. GREEN 37 passed (the minors round added two rows, so the file is now 39 tests; the 37 stays Task 2's own record). Six mutation rows: planted 604_800_000 in `policy.ts` 1 failed; `7 * DAY_MS` in `agent/src` 1 failed; the constant written as 6 days 2 failed; the name table never filled 3 failed; the lone-name rule dropped 2 failed; a second definition in `pwa/src` 2 failed.
    - The minors round on `token-shared` (39 tests): the holders row's failure message is one constant that names both directions (a new holder must import `TOKEN_ROTATION_INTERVAL_MS` or be ruled in as a separate quantity; a missing one means the L0 home moved or changed value), and the three name CONTROLS rows have short names (`name, line above`, `name, other file`, `name, no const`) because vitest clips a title at about 37 characters. Two new rows pin both: the message names each direction, and every CONTROLS name is 32 characters or fewer and unique. RED 2 failed, 37 passed (those two rows); GREEN 39 passed; three mutants (a long name back on a CONTROLS row; the old one-direction message; a message without the missing-holder words), each 1 failed, 38 passed. The scan itself is unchanged.
    - Task 3, `token-policy` (112 tests): RED 7 failed, 105 passed (the hold-rule row, P1, P2, P3, P5, P7, P8); P4, P6 and P6b were green before the fix (no-change rows). A first RED run read 9 failed and 103 passed, because P4's and P6's preconditions read `scheduleDue` then; they were changed to read the anchor directly, as P8's were later, and the 7 failed above is the run after that. GREEN 112 passed.
    - Task 3, `token-rotation-e2e` new describe: RED 10 failed, 3 passed (E3, E8c and E8d green before the fix, as predicted: they hold behaviour that does not change; the red of E8c and E8d is mutant 14b's, and E3's is mutant 18's). GREEN 117 passed over the file.
    - The minors round on these rows (all in the test files; the driver's two moves are 4558's):
      - E1 checks every captured write's recursive key paths (an array written as `[]`) against a fixed list of 63 key paths, 23 top-level and 40 nested, so a key added inside `current`, `pending[]`, `previous`, `lastSync` or `counters` reds it. The list is the key paths of the previous build's `BoxTokenState` at `300aedf88`, which lives in `server/src/token/policy.ts` (`shared/box-token.ts` holds the view type), and its comment says so. Mutant: a stage commit that writes `current.extra` reds E1 (1 failed); the previous top-level E1 stayed green.
      - E2 and E6 assert their due and not-due premises through the describe's own `dueByL0`, never the policy under test, and E6 that boot left `lastRotationAt` null. Mutants: a minted state that stamps `lastRotationAt = now` reds E6 (1 failed; the previous E6 stayed green); E2's not-due tick moved past the interval reds E2 at its premise. Group F strengthened E6's premise: the `WEEK + 60 s` due premise is read from the state re-read from its file after the `WEEK - 60 s` tick, not from the boot state. F2's mutant (a not-due tick stamps `lastRotationAt = now`) reds E6 at the premise itself (1 failed, 122 skipped); with the old premise it reddened only later, at the `rotation started ... scheduled` length assertion (1 failed, 122 skipped), the premise having passed on the stale state.
      - E9 asserts the two sends and the two `the scheduled rotation did not complete` lines before its promotion tick; with a lost answer not counted as a miss it reds at the two-miss premise (the previous E9 stayed green). E9 also pins exactly 2 sends over minutes 0 to 2, which is why mutation 12 reds it.
      - P8's preconditions read the anchor directly, as P4's and P6's do. With `scheduleDue` always true, P8 reds at its own subject; the whole `token-policy` file then reds seven rows (7 failed, 105 passed), and P8's is the one this mutant is about. Group F made P8's precondition two-sided, so its comment is true: `now - a < WEEK` plus `a - now <= WEEK`, both read from the fixture. F3's mutant (P8's anchor at `now + WEEK + 60 s`) was passed by the old precondition and reddened P8 only later, at the ask assertion (expected backoff to equal none); the new half reds at the precondition (604860000 against 604800000), with `token-policy` at 112 passed.
      - The weekly describe checks pending files with the file's `pendingFiles` helper. Mutant: a discard that never deletes the pending file reds six rows (E4, E8a, E8b, E8c, E8d, E8f; 6 failed, 13 passed in the describe).
    - The review round (group G, G2): the one-definition row's pattern admits an optional `: number`, as the value scan's DEFINE already did. Before, a typed second definition (`export const TOKEN_ROTATION_OVERDUE_SLACK_MS: number = 24 * 60 * 60_000;` appended to `pwa/src/lib/api.ts` in a scratch edit, restored by `cmp`) left the row green (1 passed, 38 skipped); the untyped form reds it (1 failed). After: both forms red it (1 failed each). `token-shared` is still 39 tests. The slack has no value scan, so this row is the only one that sees a second definition of it.
    - Mutation rows 1 to 21 are recorded, with counts, in that task's commit message (for example `>=` to `>` reds P1, P2, P3; the `a - now >` clause deleted reds P3 and E7; any future anchor due reds P3 and the 4552 'no re-open' row; `&& why !== 'scheduled'` dropped from `stage` reds E1 and `typecheck-tests`).
  - **Limits:**
    - A held schedule shows its persisted hold word only. The 24 h stall alert keys on the owed flag, which the schedule never sets.
    - A box whose gate never opens (a local-mode server not recorded as `both`, a remote server with no or two fleet rows, or a link that stays down) begins to persist its existing hold word (a `TOKEN_HOLDS` word only) and to WARN `held:<word>` one interval after its anchor, and stays so. No exit code moves. The coordinator accepted this as true (Q4), and the chain is unchanged.
    - The clock is the wall clock. A forward step makes the schedule due early: one extra, invisible rotation. A restored older `box-token.json` does the same.
    - With a stamp more than one interval ahead, the scheduled promotion stamps `lastRotationAt` with the behind clock. An unanswered retired-presented stamp then stays unanswered under 4552's clamp, and owes its one bounded rotation. This is by reading; E7 measures only the case with no presentation.
    - A press during a scheduled rotation's confirm wait answers `started` and stages one more rotation once the wait ends: the operator's act, unchanged.
    - The value scan does not see a sum, a division, a float or exponent literal, a hex, octal or binary literal (`0x...`, `0o...`, `0b...`: a factor reads decimal digits only), a lower-case or aliased name, a value built at run time, or a product with parenthesised grouping (`(7 * 24) * 60 * 60_000`). Its name table is built from `const NAME = <product>;` on one line, with anything before `const` (an `export`, say) and an optional `: number` (the pattern is unanchored on the left), so a name defined by `let`, with `as const` or across lines is no entry, and a chain of names ordered against the file walk and deeper than the table's three passes stays unresolved. The table is one for all files and the last definition wins: two files that define one name with different values make a product of it resolve to the later one (today `CLEAR_POLL_MS` and `POLL_MS` are each defined twice with different values; neither reaches seven days). The roots are read for `.ts` and `.tsx` only, so the deploy-side `shared/*.mjs` and the `*.d.mts` files are outside the scan (none holds a seven-day value today). The describe's comment names all of these.
    - The slack has no value scan. `TOKEN_ROTATION_OVERDUE_SLACK_MS` is pinned by name and by value in L0 and in doctor's copy, but a second one-day spelling under another name is not seen (a one-day `STALL_ALERT_MS` is a legitimate quantity of the same size).
    - The holders row's message pin holds the constant, not the call that passes it, so a holders row that stopped passing the constant would not be seen. The 32 character bound on the CONTROLS names is conservative against the clip near 37 that vitest was seen to apply; it was not read from vitest's source.
    - Mutation 2 has two forms. The guard form (a null `lastRotationAt` never due, written as a guard in `scheduleDue`) reds P2 (policy 1 failed, 111 passed) and E6 (the e2e describe, 1 failed), and P7's third case stays green, because `nextScheduledAt` on a not-yet-due box reads the anchor and not the guard. The anchor form (mutation 2b, `?? NaN`) reds P2 and P7 (policy 2 failed, 110 passed) and E6 as well.
    - P6b is a no-change row; it reds only under mutation 16 (an early stage arm that returns before the pending-cap hold), which reds P4, P5, P6, P6b and P8 (policy 5 failed, 107 passed).
- **4557** (row 3a; the coordinator's R7, with ruling 2's "the view and doctor say the stamp is in the future"). Settled by Task 7, to what Tasks 4 and 5 measured.
  - **Doctor.** The server arm gains a doctor-local WARN, `rotation-overdue`.
    - It fires when `now - anchor > TOKEN_ROTATION_INTERVAL_MS + TOKEN_ROTATION_OVERDUE_SLACK_MS` (one day, declared in `shared/box-token.ts`), with the same anchor as 4556, no hold standing, and nothing in flight: nothing pending and nothing promoting (staged and handed-out values stay in `pending`, but a crash between promote's `discard` write and its `commit` leaves `promoting` set with `pending` empty, so the promoting test is its own term; group G, below). The last clause is a plan addition beside the ruling, which only narrows it.
    - It is computed from `box-token.json` and never persisted.
    - Its sentence is `no rotation has completed for <age>, past the 7 d schedule and its 24 h slack, with no hold standing and nothing in flight`.
    - Doctor's `_BT_INTERVAL_MS` and `_BT_OVERDUE_SLACK_MS` are pinned to L0.
    - A stamp ahead of the clock is said on the PASS line: `its schedule stamp <age> ahead of this clock (the weekly schedule counts its interval from that stamp)`, or `(more than the interval, so the server rotates now)`. The first words were amended by the coordinator's ruling on the Task 5 review: Task 5's text above (the interface block and the ahead row) still carries the planned words, `the weekly schedule waits for the clock to pass it`, as a snapshot, because once the clock passes the stamp the schedule still waits a full interval, so those words overstated how close the rotation was. The shipped words are the ones in this entry.
  - **The view.** `BoxTokenView` gains the optional `nextRotationAt`: the anchor plus the interval, or the view's `now` when due, or null when the server holds no current value. The anchor stamps a minted or adopted value, and the field's doc says so. A stamp ahead of the server's clock reads as `nextRotationAt` more than one interval after the server's `now` (V5), which the coordinator accepted as 3a's future-stamp signal (Q3).
  - **Why:** G4 (failures are visible). Without it, a schedule that never fires reads `PASS` "rotated 9 d ago".
  - **The names.** In `ccd/ccrc-doctor-checks`: `_BT_INTERVAL_MS` and `_BT_OVERDUE_SLACK_MS`, the `rotation-overdue` finding printed by `_BT_PY_STATE` and read by the server arm's parser (`server:rotation-overdue`), and the PASS line's ahead words. `_BT_PY_STATE` is still one single-quoted string with no added quote, and `_BT_PY_FLEET` is untouched.
  - **Measured.**
    - Task 4, `token-rotation-e2e` rows V1 to V5: RED 5 failed, 117 passed (the field was undefined); GREEN 122 passed. `update-routes` 41, `token-claim-route` 48 and the PWA card test 61 stay green unedited. Three mutation rows: the `holds &&` guard dropped from `view()` 1 failed (V4); `nextScheduledAt` returning the anchor plus the interval even when due 1 failed (V3); reading `lastRotationAt` only 1 failed (V2, alone: V1 and V5 plant a stamp). The view's mutations 2 and 3 were measured on `token-rotation-e2e`; the policy's P7 reds under each as well (1 failed, 111 passed each).
    - The minors round on the view rows: V1 plants a `current.since` four days old beside a promotion two days old (`restartDue`'s `plant` option now merges a planted `current` over its default one), so the row pins the last-promotion preference end to end. Mutant: `nextScheduledAt` reading `current.since` when not due reds V1 (V1 to V5 1 failed, 4 passed; the previous V1 to V5 passed all five) and P7 (policy 1 failed, 111 passed).
    - Task 5, `doctor-box-token`: before any change 266 passed (the two live-age rows, "rotated 2 d ago" and 7 d 23 h, are green at the parent, as planned). RED 7 failed, 268 passed of 275 (the ROWS entry armed and disarmed, the null-anchor row, the owed-and-overdue row, both ahead rows, the L0 row); the hold row, the in-flight rows and the two live-age rows were green before the fix. GREEN 276 passed after the in-flight row was split in two.
    - The minors round on `doctor-box-token` (282 tests with the set-aside row of 4554): the null-anchor row now matches the whole overdue sentence (`for 8 d, past the 7 d schedule and its 24 h slack, with no hold standing and nothing in flight`); it was green before (the code was right) and its red is a new mutant, the slack term of the overdue sentence spelled with the interval (1 failed, 281 passed). The ahead row's expected line follows the new ahead words; RED before the code change 2 failed, 280 passed (the ahead row and the set-aside row of 4554), and the old words put back reds the ahead row (1 failed, 281 passed). `plantLiveServer` overrides `lastRotationAt` and `current.since` only when a row passes an age, so row 2c's two live rows plant what they did at `300aedf88`.
    - Ten mutation rows (of 276): 1. hold clause dropped 1 failed; 2. pending clause dropped 2; 3. a promoting clause, not written at Task 5: this record called it an equivalent mutant (promote records `promoting` while its id is pending), which was wrong, and group G wrote the clause and its row (below); 4. interval plus slack written as the interval 1; 5. no `current.since` fallback 1; 6. the parser arm left out 4; 7. `_BT_INTERVAL_MS` changed 6; 8. the ahead words deleted 2; 9. the ahead due flag inverted 2; 10. `_BT_OVERDUE_SLACK_MS` changed 1.
    - The review round (group G, G1): a new row, `a rotation in flight is not overdue: a promotion recorded with nothing pending (the crash window)`: an anchor 8 d 1 h old, `promoting` set to `{ id }`, `pending` empty, no hold, expecting the in-progress PASS line and rc 0. RED before the fix: 1 failed (it read the `rotation-overdue` WARN). GREEN after: `doctor-box-token` is now 283 tests, 283 passed. Mutant: the new `and s["promoting"] is None` term dropped from the overdue clause reds exactly that row (1 failed, 282 passed of 283); the older row (a promotion recorded with its id still pending) stays green under it, which is why the new row is needed. `_BT_PY_STATE` gains no `'` (the count of `^_BT_PY_STATE='$` lines is still 1). The grid (Task 6) is below, in the 4554 record.
  - **Limits:**
    - Corrected by the review (group G, G1, 4557): the Task 5 record that a promoting clause is an equivalent mutant was wrong. A crash between promote's `discard` write and its `commit` leaves `promoting` set with `pending` empty, and the PASS arm's `rotating` word already counted that state as a rotation in progress, so the base printed `PASS ... a rotation in progress` rc 0 and the tip printed `WARN rotation-overdue ... nothing in flight` rc 2. The overdue clause now also requires `promoting` to be null (the same test as `rotating`), so the words "nothing in flight" are true and the verdict is the base's PASS again. Task 5's text above stays as the record of that task.
    - The ahead rows keep a five minute margin off `_bt_age`'s 7200 s boundary, because Python reads its clock a few ms after the test's.
    - The boundary operators are unpinned at millisecond resolution: overdue is a strict greater-than of the interval plus the slack, and ahead-due a strict greater-than of the interval, every row sits at least an hour from a boundary, and a row exactly on one would race the clock Python reads. Changing either operator to a greater-or-equal reds nothing.
    - A stamp more than one interval ahead that never rotates stays PASS with its `rotates now` words and never reads `rotation-overdue`, because overdue counts only from a past anchor (the difference is negative). The policy treats such a stamp as due now; if that due schedule stalls, doctor's PASS line keeps saying so. This is the ruled interface; changing the rule is not 3a's.
    - No row combines an ahead stamp with a finding (a hold, an owed word, a pending value), so the PASS line's ahead words and a finding's line are never measured together.
    - The mutants run only the `doctor-box-token` file; the install, update and doctor suites run the shipped file unmutated.
    - The slack has no value scan (see 4556).
    - Doctor cannot see the driver's in-memory backoffs (the normal one, or 4558's), so a schedule backing off for over a day reads overdue. That is true, and it is the point.
    - A server that is stopped for eight days reads overdue. That is true as well.
    - An owed rotation that is also overdue names both.
    - The ahead words appear only on the PASS line.
    - The view carries no server clock, so a reader tells a stamp ahead only against its own clock. Accepted for 3a (Q3); 3e's console card may add the server's clock (residue for 3e).
    - The view does not show 4558's backoff instant: a due schedule that backs off reads `now`.
    - The card shows nothing until the console part. An older PWA ignores the field.
- **4558** (row 3a; the coordinator's answer to Q1, 2026-10-13 about 08:40 UTC). Settled by Task 7, to what Task 3 measured.
  - **The rule.** The derived `scheduled` trigger has its own scheduled-miss backoff.
    - A scheduled attempt that does not complete counts one miss: its stage could not write the pending file, or its send's answer promoted nothing (`unsent`, `predates-op`, `lost`, a refusal, or a `synced` naming another generation). After `n` misses in a row the schedule waits `backoffMs(n)` from that instant: the normal ladder's steps (60 s, doubling) and its bound (one hour).
    - The miss is counted before any commit that could throw on the same fault: `send()` counts it above its commit, and `stage()`'s catch counts it after its `could not stage a generation` warn and before its commit (spec F3(b)). So a commit that fails (ENOSPC or EIO on `box-token.json` while the pending file writes) cannot lose the miss, and a fresh ready cannot stage a second scheduled rotation on the next tick. Nothing persisted changes: the block touches memory and a warn line only.
    - It is held in memory only (`scheduledGen`, `scheduleMisses`, `scheduleBackoffUntil` in the driver) and never persisted, so `box-token.json` stays byte-compatible with the previous build.
    - A fresh agent ready does NOT clear it. Any successful promotion (op result, generation read, own-write) resets it. A server restart clears it.
    - It is consulted only when the why is `scheduled`, through `nextAction`'s optional `scheduleBackoffUntil`, after the gate, the pending cap and the normal backoff. Owed rotations and "Rotate now" keep spec §5.1's rule (reset on success and on a fresh ready), unchanged and byte-identical to main (E8c, E8d).
    - It is not a `GateInput` change, and it adds no hold or owed word.
    - Its warn line is `ccrc-server: box token: the scheduled rotation did not complete (<kind>); the schedule retries with backoff (attempt <n>)`, naming an answer's kind and an attempt count only.
  - **Why:** a weekly schedule is never urgent. Without it, a link that reconnects inside every tick (each reconnect is a fresh ready, which resets the normal backoff) stages and writes a pending file every tick and, on lost answers, climbs `failures` to the banner and doctor's `failed:*` FAIL unattended. It departs from spec §5.1 for the scheduled trigger only, hence a number.
  - **Measured by** (the counts as the rows pin them; `LADDER_MAX` is 4, the attempts at minutes 0, 1, 3 and 7 of ten one-minute ticks):
    - E4 (no fresh ready, `unsent`): between 2 and `LADDER_MAX` sends, no pending file left after any minute, `failures` 0, no banner.
    - E8a (a fresh ready before every tick, `unsent`): the same bounds. Main with the reset on every fresh ready would send ten.
    - E8b (a fresh ready before every tick, answers lost before the claim): at most 2 failures after the third tick, where main would have raised three and shown the banner; between 3 and `LADDER_MAX` sends over ten ticks; `failures` equals the sends; the banner is up at the end (G4).
    - E8e (a fresh ready before every tick, an unwritable pending file): between 3 and `LADDER_MAX` attempts, `failures` equals the attempts, the agent is never called.
    - E8c (an owed rotation on the flapping link) and E8d (a press on it, with no schedule due): exactly 10 sends in ten ticks, and for E8c 10 failures, as on main. Both were green before the fix. E8d's title no longer claims a scheduled miss (none stands in it); its body is unchanged.
    - E8g (group G, G3; a press while a scheduled miss stands): a box due at `WEEK + 60 s`, its scheduled send answering `unsent`. Minutes 0, 1 and 3 are the schedule's own attempts (3 sends, 3 `the scheduled rotation did not complete (unsent)` lines, no promotion: `lastRotationAt` unchanged); from minute 4 a press lands before each of four ticks, inside the third miss's backoff, which stands until minute 7. Every press stages and sends: the sends counted before each of the eight ticks read 0, 1, 2, 2, 3, 4, 5, 6, and 7 in total, with no further miss line, `failures` 0 and no banner. A first draft pressed from minute 1, where the first miss's 60 s step is already spent, and stayed green under the widened mutant; the row now takes three misses first. It is a no-change row (green before any fix); its red is the mutant's below.
    - E9 (a generation read promotes after two misses): the next week's first miss waits one 60 s step, so exactly 2 sends by the +2 minute tick, and the two sends and two miss lines are asserted before the promotion tick.
    - E8e's order: the cause line (`could not stage a generation`) prints before the miss line.
    - E8f (a fresh ready before every tick, answers that never claim, and a state store whose writes throw the first two times after the first send's answer: the discard's record, warned and swallowed, then the send path's commit): the miss is still counted, so the ladder stays at or under `LADDER_MAX` sends over ten ticks and the miss line prints before the `a driver tick failed` line. Before the move of the miss block it ran five sends in ten minutes. Its title (group G, G7) used to say it "does not stage again on the next tick"; measured, the sends before each of the ten ticks read 0, 1, 2, 2, 3, 3, 3, 3, 4, 4, so the tick after the throwing one does send again (the ladder's first step is 60 s, one tick), and the pin of "exactly one send after minute 1" the review asked for would have been false. The title now says what the row pins: the miss still counts, and the schedule follows the ladder.
    - P8 (policy): the miss instant is read for the `scheduled` why only, with `<` and not `<=`, and a closed gate says its hold first.
  - **Red and green.** Task 3's `token-rotation-e2e` describe: RED 10 failed, 3 passed (E1, E2, E4, E5, E6, E7, E8a, E8b, E8e, E9 red). Mutation rows 11 to 15, 17 and 19 to 21 pin it (row 16, the early stage arm, also reds E8a, E8b, E8e and E9; rows 14a and 21 are policy rows; row 18, `interval / 7`, pins 4556's interval and not this backoff): the miss block deleted from `send` 4 failed (E4, E8a, E8b, E9); the backoff not climbing 5 (E4, E8a, E8b, E8e, E9); `scheduledGen` never set 4; the backoff read for every why 2 (P8, and since group G E8g; E8c and E8d stay green under it); that and the miss counted on every stage 2 (E8c, E8d); the backoff cleared by a fresh ready 3 (E8a, E8b, E8e; E4 stays green, it has no fresh ready); the reset in `promote` deleted 1 (E9); `noteScheduleMiss('not staged')` deleted 1 (E8e); a miss only on `unsent` and `predates-op` 1 (E8b); `<` to `<=` 1 (P8). Two more mutants, from the minors round: the send path's miss block put back below its commit reds E8f (token-rotation-e2e 1 failed, 122 passed), and `stage()`'s `noteScheduleMiss('not staged')` put back above the warn reds E8e (1 failed, 122 passed). `token-rotation-e2e` is 123 tests, and 124 with E8g (group G, G3: GREEN 124 passed over the file; the widened-scope mutant reds E8g alone among E8a to E8g, 1 failed, 6 passed of 7).
  - **The long rows (group F, F1).** E8a, E8b, E8d, E8e and E8f carry an explicit `120_000` timeout (the trailing-number idiom of `token-rotation-real-verb.test.ts`, and its value), above both platform defaults in `server/vitest.config.ts` (20 s on Linux, 90 s on darwin), so no platform's budget of these five rows drops. The first minors round wrote 60 s, which was below the darwin default; it is not a limit any more.
  - **Limits:**
    - E8f follows the driver's write order: it throws the first two state writes after the first send's answer, so a new state write between the discard's record and the send path's commit would move the pin.
    - A persistent real fault still reaches the banner and doctor's `failed:*` FAIL, across ladder steps (E8b): that is G4, by design.
    - A promotion that is selected but then abandoned or held resets nothing and counts no miss.
    - A both-local own-write failure is not a miss; its staged value retries on the normal backoff.
    - A scheduled value that was handed out and whose answer was lost is no longer a scheduled attempt once the confirm window passes: it becomes an owed `confirm-deadline` rotation, and from then on it follows spec §5.1's rule for owed rotations, unchanged as Q1 ruled (a fresh ready resets its backoff). That path stays bounded by the confirm window and the pending cap (measured: 3 sends in 7 minutes, then the pending-cap hold). So the line above, that a persistent real fault on a scheduled attempt raises `failures` once per ladder step, holds while the why is `scheduled`.
    - The scheduled-miss instant is not bounded against a backward clock step. After a miss, a step back of more than two intervals delays the early fire by about the step, until a restart or a promotion.
    - A press that arrives while a scheduled stage awaits its pending-file write answers `started`, and that one rotation's log line says `(scheduled)`.
    - The backoff's instant is visible nowhere (not the view, not doctor), and a restart starts the ladder again from its first step.
- **4559, 4560:** spare.
- **4552, amended by row 3a (prose; its definition stays in the arming plan).** 4556's future-anchor rule keeps 4552's clamp rows green unchanged: within one interval of a future `lastRotationAt` the schedule waits, so no scheduled promotion lowers `lastRotationAt` below an answered stamp before the clock catches up. Beyond one interval, the limit named under 4556 applies. 4552's F4 limit (a presentation lost while the clock is behind `lastRotationAt`, `server/src/token/driver.ts:686-691`) is unchanged and still open. Measured: the 4552 clamp rows (`a stamp planted ahead of the clock`, `never cleared`, `no re-open`) and `token-policy`'s clamp row are green unedited on the tip, and the 'no re-open' row reds under mutation 5 (any future anchor due: policy 1 failed, e2e 1 failed over that row and its neighbours).
- **4554, amended by row 3a (prose; its definition stays in the row 2c plan).**
  - **R18.** `_bt_server_trace` tests the unlisted directory first, so an unlistable token directory always reads the unlisted sentence and the `chmod u+r` remedy, whatever it or the fleet side holds. Limit (a) and the own-write unlistable limit are closed, and every verdict is unchanged.
  - **R19.** On an own-write box with no generation file standing, a `~/.cc-secrets` that exists and cannot be searched is its own trace word, `unsearchable`, with its own sentence and the remedy `give <dir> its search bit (chmod u+x <dir>); doctor can then tell whether this box's server held a value`. It is never folded into `unlisted`. The fleet file is tested first, as before; the generation file, outside that directory, is tested next and stays a named trace; then the set-aside copies; only then, last, is an unsearchable directory its own word, so a set-aside copy in the token directory, a definite trace, is named and outranks `unsearchable`, which says only that the history cannot be told. (The plan's draft put the generation file before the fleet file; that reorders which trace is named when both stand and reds two review 405 F1 rows, so Task 6 kept the fleet file first. It also tested the unsearchable directory before the set-aside copies; the Task 6 review found that hid a set-aside copy, and the coordinator ruled the move: a new row pins it, red before the move.) The server part keeps `token-absent`'s FAIL (an undecidable history fails closed), the line stays FAIL rc 1 through the fleet part's `fleet-token-unusable`, and no FAIL class or word is added. The shipped remedy is the one quoted above, and the sentence's own words are `<dir> cannot be searched, so whether this box's server wrote the fleet token file there cannot be told`. A missing `~/.cc-secrets` is not unsearchable.
  - **Review 409 F1.** The purge limit's "before" reading is corrected: WARN rc 2, its server part the never-minted PASS beside `no-generation`.
  - **Measured (Task 6, `doctor-box-token`).** RED 3 failed, 278 passed of 281 (R18a, R18b, R19; R19g and R19d were green before the fix, as predicted); GREEN 281 passed. Seven mutation rows, each 1 or 2 failed of 281 and each naming its R-row (the unlisted test moved back below the named traces 1 (R18a); below the own-write block 2 (R18a, R18b); the `unsearchable` test deleted 1 (R19); the word written as `unlisted` 1 (R19); the remedy's `u+x` written as `u+r` 1 (R19); `[ -d ]` dropped 1 (R19d); the generation test moved below the unsearchable test 1 (R19g)). The verdict grid (5 roles by 7 server sides by 6 fleet sides by 3 token directories by 3 modes of `~/.cc-secrets`, less the cells that do not apply to a role: 1173 cells, each run on `e4405056e`, on the parent commit and on the tip): 0 verdict or rc differences; 144 text differences, 136 the unlisted sentence (token directory 0300, `chmod u+r`) and 8 the unsearchable sentence (both-local, `~/.cc-secrets` 0600, `chmod u+x`).
  - **Measured after the set-aside move (the minors round).** `doctor-box-token` is 282 tests. RED with the new set-aside row and the ahead row's new words written first: 2 failed, 280 passed (those two rows). GREEN 282 passed. The grid was rebuilt and re-run (1173 cells, each on `e4405056e`, on the commit before the move and on the tip, env cleared, `HOME` forced per cell, fixtures under the gitignored evidence directory): 0 verdict or rc differences against both, and 140 text differences against `e4405056e` (136 the unlisted sentence and 4 the unsearchable sentence, both-local, `~/.cc-secrets` 0600, with no set-aside copy; it was 144, with 8 unsearchable cells). Against the commit before the move the difference is 4 cells, exactly the both-local set-aside cells with `~/.cc-secrets` 0600, which now read the set-aside sentence `e4405056e` read; no other class. Task 6's mutants 3 to 7 re-ran on the new order, each 1 failed, 281 passed, each naming the same R-row as before (a commit message numbers them 4 to 8; they are Task 6's 3 to 7), and the move's own mutant (the unsearchable test put back above the set-aside copies) reds the new row (1 failed, 281 passed).
  - **Measured after the review (group G, G4 and the grid).** R18a, R18b, R19g and the set-aside row each also run `runCheck(b, disarmed())` and expect `SKIP box-token: ` and rc 3, in R19's own idiom, so the Review Focus's "the kill switch prints SKIP for the new rows" holds for all five. `doctor-box-token` is 283 tests (with the G1 row), GREEN 283 passed. The kill switch is one gate after the verdict (`_BT_ARMS_ON`), so no per-row mutant is named; with that gate removed in a scratch copy the file reds 82 rows (82 failed, 201 passed), including R18a, R18b, R19, R19g and the set-aside row. The grid was re-run for group G (1173 cells, each on `e4405056e`, on the parent `d1b35d82d` and on the tree, env cleared, `HOME` forced per cell): 0 verdict or rc differences against both, and 140 text differences against `e4405056e` (the same 136 unlisted-sentence and 4 unsearchable-sentence cells) and 0 against the parent. The grid plants a fresh rotation, so two more runs of it plant an anchor 8 d 1 h old. With `promoting` set and nothing pending (G1's state): 0 verdict or rc differences against `e4405056e` (its PASS again) and 33 against the parent (its WARN, the cells that carry a passing server part). With nothing promoting and nothing pending: 33 against `e4405056e` (PASS to the new overdue WARN, 4557 by design) and 0 against the parent.
  - **Limits found.** The R18 and R19 mode rows are `itNonRoot`, so they skip under a root runner. A directory that is both unsearchable and unlistable (mode 0000) on the token side is unlisted first; on the fleet side with no generation file it is unsearchable. The unsearchable arm tests only the fleet token file's directory on an own-write box. The new set-aside row is `itNonRoot` like the R18 and R19 rows.
  - **Coverage of `ccrc-install`, `ccrc-update` and `ccrc-doctor`: the Tasks 5 and 6 record, then Task 8's reconciliation.** Tasks 5 and 6 did not reconcile either file; Task 8 did, below. What the two tasks' `-t` groups summed to, as their commit messages state it: for `ccrc-install`, 300 in each task (Task 5: 29, 13, 20, 62, 36, 32, 79 and 29; Task 6: 42, 82, 36, 37, 75 and 28) of the file's 319 tests; for `ccrc-update`, 515 in Task 5 (60, 68, 72, 70, 100, 56 and 89) and 506 in Task 6 (60, 72, 86, 100, 57, 65 and 66), against 514 tests in the file and 502 that `vitest list` named, so Task 5's groups overlap (they sum to more than the file holds) and neither task's sum is a count of distinct tests. The tests that no group named are not measured to be Darwin-skipped or covered by the live-shape runs, and this plan does not say so. For `ccrc-install`, the Task 5 review ran ten Linux tests that no group named (the linger and account-dirs tests, 8; the env file named once, 1; the bootstrap that hands off, 1), all passed; the other nine of the 19 left over by the groups are not identified; Task 8's patterns leave no listed test uncovered. The commit messages' counts of `-t` calls are off (Task 5's says 10 `-t` calls where 11 ran, three live-shape calls and eight groups; Task 6's says 7 groups and lists nine) and are not amended. Task 8's reconciliation, measured at the tip before group F (the files group F does not touch): `ccrc-install` 299 tests listed by `vitest list`, every one covered by 8 `-t` patterns, 304 selections because 4 tests sit under two or three patterns; `ccrc-update` 502 listed, every one covered by 7 patterns, 504 selections from 2 overlapping tests; `ccrc-doctor` 898 listed, every one covered by 12 patterns, no overlap. 0 failed in all 27 pattern runs. The registered totals (319, 514 and 913) exceed the listed ones by the macOS-only tests `vitest list` omits on Linux (20, 12 and 15), which every run skips.
  - **Still open:** limit (b), the unreadable trace, the pending file as a trace, and boot's own judgement.
