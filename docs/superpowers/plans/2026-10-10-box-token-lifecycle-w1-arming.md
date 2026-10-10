# Box token lifecycle, rows 2a and 2b: the pins and residue, then the arming: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Provenance: this is row 2a of the programme ledger `docs/superpowers/programs/box-token-lifecycle.md`, run 370. A workflow drafted it on 2026-10-10 from `main` at 995a05750, then revised it after an adversarial review. Every review finding was re-measured against `origin/main`. Part A (#330) and part B (#341, merged as 928f5938b, released as v0.0.140) are on `main`. The first live rotation ran on 2026-10-10 from 21:04 to 21:10 UTC with no 401, and the §10.3 proof passed. The proof's probe presented the retired value on `GET /api/ledger`, so D-4412 owed one forward rotation. It ran at 21:12 (generation 3). The server then restarted onto v0.0.142 at 21:35. At 21:42 its doctor read `PASS`, so the since-boot count is 0 today. The operator's ruling of 2026-10-10 20:40 puts review 365's R1 and R2 pins here, red-first, before the arming lands. Deviation numbers come from the coordinator's unspent block, 4552 to 4570. They stay bare (no `D-` prefix) until a merged branch defines them.

**Goal:** Turn on doctor's `box-token` FAIL and WARN arms (`_BT_ARMS_ON=0` to `1`). Do it only over a tree where these pins have been proven red under their mutants: R1, R2, a `retired-presented` rule that clears by itself with no restart and no hand step, and the row 2a residue.

## Two parts, two PRs

The coordinator split this plan on 2026-10-10 at 22:15 UTC, because only the flip waits on rulings.

- **Part 1 (ledger row 2a, run 370): Tasks 1, 2, 5, 6, 7, 8, 9 and 10.** These add pins and clear residue on free files. The arms stay off, and no operator decision is needed. Task 11 rides here too if claim 1141 has been released when the worker reaches it; otherwise it moves to part 2. Part 1 defines no deviation number.
- **Part 2 (ledger row 2b, a later run): Tasks 3, 4 and 12, plus Task 11 if part 1 did not take it.** Part 2 dispatches only after all of these:
  - part 1 has merged;
  - Decisions 1 and 2 are ruled;
  - the GPT-lane answer is recorded (see "Trigger and bound");
  - residue 8(a) and R-i are ruled;
  - claim 1141 is released or consented.

  Part 2 defines 4552, and 4553 if Decision 2 is ruled (a).

**Spec:** `docs/superpowers/specs/2026-10-07-box-token-lifecycle-design.html` (§4.8 doctor, §6, §7, §10.3). **Parent plan:** `docs/superpowers/plans/2026-10-07-box-token-lifecycle-w1.md`: its Global Constraints, Task B5, "After merge" item 2, and D-4391, D-4395, D-4412 and D-4551.

**Trigger and bound (ledger row 2a):** The trigger was the GPT-lane lane-1 B4 soak gate, which passed on 2026-10-08 at 11:20 UTC. The PR must merge before row 3's first PR (the weekly schedule). **Another soak is open now.** The GPT-lane programme's Plan 4 soak clock started on 2026-10-09 at 13:50 UTC and runs to about 2026-10-21. Its go needs both lanes' `b4-sample.sh` samples to exit 0. Criterion 4 of that sampler STOPs on any doctor FAIL, and on a WARN from a check that did not WARN in its baseline. The ledger's carried constraint forbids a new doctor WARN while a GPT-lane soak gate is open. **So Task 12 is dispatched only after a written answer from the GPT-lane coordinator or the operator.** The answer must say either that Plan 4's samples do not bind this arming, or that the operator amends the sampler's baseline by name for `box-token`, or that the merge waits for the Plan 4 window to close. Record the answer here, in place of this paragraph.

## Operator decision 1: how an armed `retired-presented` FAIL clears

**PENDING. Tasks 3 and 4 are written against Option A and wait for this ruling. Task 12 (the flip) waits for Tasks 3 and 4, or for their replacement under the option ruled.**

**The problem.** Today the finding is a pure function of `box-token.json`'s `counters.retiredPresented > 0`. Doctor reads it at `ccd/ccrc-doctor-checks:7531-7532` and classes it FAIL at `:7688`. The count lives in memory in `BoxTokenHolder`. The driver copies it to the file each tick (`server/src/token/driver.ts:670-683`). Only a new server process resets it, and a completed rotation does not touch `counters`. With the arms on, one presentation of a retired value holds doctor at FAIL until the next restart. That includes a §10.3 probe, or anyone on the internet who still has the leaked value. While doctor FAILs, every `ccrc update` of that box exits 3. The remedy text says "resync that box", which does not clear it.

**Measured fact 1: D-4412 does not answer every presentation.** `oweForRetiredPresentation` (`policy.ts:155-159`) returns null when the last owe is younger than `HOLD_REPROBE_MS` (60 min). That last-owe time, `retiredOwedAt`, is kept in memory (`driver.ts:84`). `noteRetiredPresentations` (`driver.ts:574-584`) moves `retiredSeen` past every presentation, including the ones it declines to owe for. So a presentation inside that hour is never weighed again. A rule that waits for "the next rotation" alone would wedge on it.

**Measured fact 2: the server cannot tell a fleet box that holds a retired value from an outsider who holds the leaked value** (spec §6 and §7, D-4412). A fleet box keeps presenting about once a minute until it is resynced. An outsider presents at will, and no rotation stops them.

| Option | Rule | What a box sees | Code | Cost |
|---|---|---|---|---|
| **A (recommended)** | FAIL while a retired presentation is **unanswered**, meaning it is newer than the last completed rotation. The driver stamps the time it saw the latest one, and the stamp survives a restart. D-4412 owes a rotation while the stamp is unanswered, not only when the count rises, still at most one per `HOLD_REPROBE_MS`. | FAIL from a presentation until a rotation completes after it. That takes at most about an hour after the last presentation, with no hand step. | `policy.ts`, `files.ts`, `driver.ts` (Task 3); doctor's python, parser and sentence (Task 4) | One new persisted field. D-4412's input widens, but its bound is unchanged. An outsider who presents at least once an hour keeps the line at FAIL and drives one rotation an hour, which today's bound already allows. |
| B | Demote `server:retired-presented` to WARN, still counted since boot. | WARN until the next restart. Doctor exits 0 for it. | One word in `_bt_find` (`:7688`) and one ROWS row | The line clears only on a restart, and anyone can raise it. A retired value written back by a fleet box is then never a FAIL by this word, though `file:retired` and `rotation-owed:retired-written-back` still are. |
| C | Keep FAIL. Say truthfully that a restart clears it, and zero `counters` at boot. | FAIL until the next restart or release. | The remedy text, and the boot-built literals at `policy.ts:97` and `:113` | A restart is a heavier remedy than a rotation. Each FAIL makes `ccrc update` exit 3 until the next release. |

**Safety argument for A.**
1. **It cannot hide a fleet box that is still uncured.** Such a box presents again within about a minute. The next tick stamps it, the stamp is newer than the last rotation, and the FAIL comes back.
2. **The stamp is on the driver's clock,** the same clock as `lastRotationAt` (set at promotion, `policy.ts:455`). A presentation that lands during a tick is stamped on the next tick, after the promotion, so it reads as unanswered. The race fails closed: a false FAIL and one extra bounded rotation, never a false clear.
3. **Absence is never an all-clear.** A state written before 4552 has a count and no stamp. On its first tick, the new driver stamps that count with `now`, so it reads as unanswered and owes one rotation. A `null` stamp means the driver has seen no presentation. Doctor reads a missing stamp with a count as unanswered too. (The live box read count 0 at 21:42, so it owes nothing at the arming release. Re-measure at dispatch.)
4. **It never wedges.** An unanswered stamp owes a rotation again once the hour has passed. A restart loses `retiredOwedAt`, so a restart over an unanswered stamp owes at once. When presentations stop, the line clears within about an hour.
5. **The rotation bound is unchanged:** at most one owed for this word per `HOLD_REPROBE_MS` in a process. The gate, the one-rotation-at-a-time rule and backoff apply as before.
6. **An armed FAIL never reverts a release.** `ccrc update` writes `_upd_phase done` with the doctor detail and exits 3 (`ccd/ccrc:17358-17360`). `ccrc rollout` relays the 3, continues, and exits 3. The health gate and the watchdog read `/health`, not doctor. **One side effect:** a plain `ccrc install` takes its exit code from doctor. With doctor failing, `_inst_doctor_tail` (`ccd/ccrc:13899-13912`) keeps `~/ccrc.migrating` and skips `_ver_gc`.

**Known limit of A (recorded in 4552).** A rollback to a build before 4552 (v0.0.140 to the arming release's predecessor) rewrites `counters` as two keys whenever the count changes, so it drops the stamp. Suppose the stamp was unanswered at the rollback and nothing is presented afterwards. Then the roll-forward finds no key and a count of 0, and the unanswered presentation is forgotten. That is fail-open, but it needs a rollback during an unanswered window and silence after it.

**Rejected.** An operator acknowledgement: a flag that nobody writes is a hand step (spec §4.8), and the ledger forbids hand rotation. A per-rotation baseline inside the count: it would give `counters.retiredPresented` a second meaning beside `BoxTokenView.retiredPresented`. A time window alone: it lapses while a held rotation has not cured the fleet.

## Operator decision 2: fresh boxes once armed (asked after Task 12 Step 0 measures it)

**The problem, measured in the code.** `ccrc install`'s exit code is doctor's (`_inst_doctor_tail`, `ccd/ccrc:13899-13901`). `_inst_env` always records `CCRC_ROLE` (`ccd/ccrc:12909`), and no install step writes `~/.ccrc/mail.token` or `~/.cc-secrets/ccrc-mail.token`. Armed, `server:token-absent` and `fleet:fleet-token-absent` are FAIL (`ccd/ccrc-doctor-checks:7640`, `:7700`). So a fresh `install --role fleet` exits non-zero until the server's first rotation hands it a value. A server or both install whose server has not booted on this build exits non-zero too. Both keep `~/ccrc.migrating` and skip `_ver_gc`. Most install and update fixtures that expect exit 0 are expected to red as well.

| Option | Rule | Cost |
|---|---|---|
| **(a) recommended** | Class by history. `fleet-token-absent` is WARN when the box also has no generation file and no `token-sync.json`, meaning it has never been handed a value. It stays FAIL otherwise, because the box once held a value and lost it. `token-absent` is WARN when `box-token.json` is also absent, meaning the server has never run the lifecycle. It stays FAIL otherwise. | Two doctor-local class rules and their ROWS. Needs a deviation number. |
| (b) | Keep both FAIL. | A fresh install exits non-zero until its first rotation. Task 12 makes every fixture that expects exit 0 plant tokens. |
| (c) | Arm everything except these two words, which stay SKIP behind their own switch. | A second switch, which nobody may write by hand. |

The coordinator puts this to the operator with Task 12 Step 0's measured list of reds.

## Global Constraints

- Node floor `>=22.16.0` in every package's `engines`. Never lower it (`server/test/node-floor.test.ts`).
- Rings by imports. L0 `shared/*.ts` imports nothing but `shared/*.ts`. L1 `server/src/token/policy.ts` decides. L3 `files.ts` never narrows a distinction it received. L4 `driver.ts` owns timers and decides nothing.
- No overloaded null at a seam. In this PR, an absent `retiredPresentedAt` means a state written before 4552, and `null` means no presentation recorded. Every reader branches on presence first (`'retiredPresentedAt' in counters`, python `"retiredPresentedAt" in k`), then on null.
- Wire and state are additive only. The new `box-token.json` field is optional when read, by `isBoxTokenState` and by doctor's python alike. An older build reading a newer file ignores the key. A newer build reading an older file treats a count with no key as unanswered, never as clear. (The rollback limit above is the one exception, and it is recorded.)
- Tests use fixture HOMEs only (`mkTmp`, `makeCcdHarness`). Never run `ccrc`, `ccd`, `deploy.sh` or the server against the live `$HOME`. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*`. Never call the live server.
- Never print a token value, a claim code, or a sha256 of either. Fixture values are minted at runtime or built from pieces. Reuse `ccrc-token-sync.test.ts`'s own `OLD`, `VALUE` and `GEN`.
- Run one test file per call, in the foreground, with a timeout of at most 600000 ms. Never use bare `npx vitest`. The form is `mkdir -p .tmp-<task> && (cd server && TMPDIR="$PWD/../.tmp-<task>" ./node_modules/.bin/vitest run test/<f>.test.ts)` from the repo root (or `cd pwa`), then `rm -rf .tmp-<task>` before the commit. Never use `pkill`, `pgrep -f` or `killall`. Kill only a PID you recorded. A row that can block a child process gives `spawnSync` a `timeout` and releases what it blocked on.
- TDD red-first, with mutation discipline. Each pin is run RED before its guard exists, or RED under its named mutant, and then GREEN. Apply each mutant in the working tree and run the file. Record the failed and passed counts in the commit message. Restore from a copy saved before the mutation, and check with `cmp` that the file is byte-identical. Never restore with `git checkout`, because the file may carry this task's uncommitted edit. A mutant that cannot red is not listed as a pin. It is named in the commit as a limit no test can see.
- One commit per task, on the workspace branch the brief names, never a separate feature branch. Commit only after a separately measured green run of the task's files.
- The repo is public. Keep hostnames, IPs, home paths, account and pool names, emails and docserver URLs out of code, tests, comments and commit messages.
- Deviation numbers: this plan defines 4552, and 4553 only if Decision 2 is ruled (a). Both are written bare. A worker who needs another writes `D-TBD-<slug>` and reports it, and the coordinator issues it from 4554 to 4570. Before a commit that defines a number, run `git fetch origin main`, then `test/deviation-refs.test.ts` and `test/dtbd.test.ts`, one call each.
- **Claims.** Re-read `GET /api/claims?project=ccrc-pwa` before each dispatch.
  - **1141** (run 354, `ccrc-history` B2) holds `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `deploy/deploy.sh`, `README.md`, `CLAUDE.md`, `server/test/ccrc-doctor.test.ts`, `server/test/ccrc-install.test.ts`, `server/test/ccrc-account.test.ts`, `server/test/ccrc-uninstall.test.ts` and `agent/test/deploy-verify.test.ts`. That was measured on 2026-10-10 at 21:22 UTC, and its hard expiry is 2026-10-11 at 04:34 UTC. **Tasks 4, 11 and 12 wait for 1141's release, or for its holder's consent.**
  - **1142** (`ccd/ccd`, `server/test/macos-platform.test.ts`) was listed by the centralised-update ledger at 21:42 UTC. This plan edits neither file. Claims 1129 and 1132 were no longer listed there.
  - Every other task is on free files and can start now.
- **Order.**
  - Part 1 runs Tasks 1, 2, 5, 6, 7, 8, 9 and 10, in that order. It then runs Task 11 if claim 1141 is gone.
  - Part 2 runs Tasks 3, 4, 11 (if still owed) and 12, in that order. Task 12, the flip, is always the last commit. It is dispatched only when Decisions 1 and 2 are ruled, the GPT-lane answer is recorded, and the coordinator has ruled residue 8(a) (see "Not in this PR").

## File Structure

| File | Change | Task | Live claim / open PR (2026-10-10, 21:22 to 21:42 UTC) |
|---|---|---|---|
| `server/test/ccrc-token-sync.test.ts` | R1's existing-destination row; the temp-elsewhere row; R-f's eight verb pins; a `timeout` for `runToken` | 1, 7 | free; no PR |
| `ccd/ccrc-token-sync` | `_TS_WRITE_PY` refuses a temp that is not beside the destination. R-f's mutants are applied only to measure. | 1 | free; no PR |
| `server/test/token-rotation-e2e.test.ts` | R2's both-role F1 row; the stamp, re-owe, restart and legacy rows | 2, 3 | free; no PR |
| `server/src/token/driver.ts` | `noteCounters` stamps `retiredPresentedAt`; `noteRetiredPresentations` logs the re-owe. M6 is applied only to measure. | 3 (2 mutant only) | free; no PR |
| `server/src/token/policy.ts` | `counters.retiredPresentedAt?`; `retiredUnanswered`; `oweForRetiredPresentation`'s input; the two boot-built literals; the `STALL_ALERT_MS` comment | 3, 12 | free; no PR |
| `server/src/token/files.ts` | `isBoxTokenState` reads the optional stamp | 3 | free; no PR |
| `server/test/token-files.test.ts`, `server/test/token-policy.test.ts` | Validator rows; owe-rule rows | 3 | free; no PR |
| `server/test/token-boot.test.ts`, `server/test/coord-token.test.ts` | Re-runs (Task 3); the placeholder literal pin (Task 9) | 3, 9 | free; no PR |
| `ccd/ccrc-doctor-checks` | `retired-presented` reads the stamp (Task 4); the flip, its header, the SKIP tail, and Decision 2's classes if ruled (Task 12) | 4, 12 | **claim 1141**; stale PR #189 |
| `server/test/doctor-box-token.test.ts` | Clearing rows; R3 scanner; the armed pins on the shipped file; the disarmed kill-switch copy | 4, 5, 12 | free; no PR |
| `server/test/install-worker-skill.test.ts` | R4 citation | 6 | free; no PR |
| `server/test/install-coordinator-skill.test.ts` | The token-line stripper carries quote state across lines | 6 | free; no PR |
| `pwa/test/box-token-card.test.tsx` | R-g inherited-key rows | 8 | free; no PR (open #322 touches `pwa/src/lib/api.ts`, which this plan does not edit) |
| `deploy/notify.sh` | No POST of the unedited placeholder | 9 | free; no PR |
| `server/test/notify-addr.test.ts` | The placeholder row | 9 | free; no PR |
| `server/src/server.ts` | `/api/notify`'s wrong-token log advice (`:1593-1594`) | 10 | free; stale PRs #190, #152, #40 touch the file, not this line |
| `server/test/notify-token.test.ts` | Pins the new advice (its wrong-token case at `:31`) | 10 | free; no PR |
| `ccd/ccrc` | `cmd_token`'s missing-script refusal (residue 2) | 11 | **claim 1141** |
| `server/test/ccrc-cli.test.ts` | Pins residue 2's prefix | 11 | free; no PR |
| `agent/test/deploy-verify.test.ts` | `ship_secret` prose (residue 4) | 11 | **claim 1141** |
| `README.md` | `node-id-unmeasured` remedy (residue 6(a), Task 11); the `box-token` doctor row (`:589`, Task 12) | 11, 12 | **claim 1141**; open #344, #322; stale #189, #152, #107 |
| `server/test/ccrc-doctor.test.ts` | The token-absent case becomes armed (`:13692-13710`) | 12 | **claim 1141**; stale PR #189 |
| `server/test/ccrc-install.test.ts` | `liveBox()` gets the fleet files; `BASE_LIVE_SHAPE` re-measured; fresh-box rows if Decision 2 (a) | 12 | **claim 1141**; stale PR #40 |
| `server/test/ccrc-update.test.ts`, `ccrc-account`, `ccrc-uninstall`, `install-census`, `ccrc-doctor-graphify` | Fixture fallout, scoped only after Task 12 Step 0 lists it | 12 | `ccrc-account` and `ccrc-uninstall` are under **1141**; re-read for the others |
| `docs/superpowers/plans/2026-10-10-box-token-lifecycle-w1-arming.md` | This plan's Deviations found | all | free; it reaches `main` with the ledger's docs PR before part 1 dispatches |

## Tasks

### Task 1 (part 1): R1, an existing destination is replaced by rename, never rewritten in place

**Files:** `server/test/ccrc-token-sync.test.ts` (the module's `OLD` at `:45`, the F2 describe at `:621`, `runWriter` at `:663`, `violations` at `:680`, the real-body row at `:702`, `MUTATIONS` at `:713`), and `ccd/ccrc-token-sync` (`_TS_WRITE_PY` at `:255-314`, its existing-destination branch at `:283-291`).

**Why:** `runWriter` creates the temp but never the destination. So the writer's existing-destination branch, which keeps the preamble, never runs under the recording wrapper. Under review 365's N1c the file reads 51 passed and 1 failed, and the 1 is only the ruled CONTROL-noise `m1` row. An existing destination is exactly the live box's path.

- [ ] **Step 1: Extend `runWriter`.** Give it a second parameter, `o: { existing?: string; tmpDir?: string } = {}`. When `existing` is set, write it to `dest` with mode 0600 before the spawn, and return the destination's `ino` as it was before the run (`preIno`). When `tmpDir` is set, create that directory and put the temp there instead of in `secrets`.
- [ ] **Step 2: Add the R1 row**, judged by the same `violations()`:
  `it('an existing destination (a preamble plus the old value) is replaced by rename, never rewritten in place (R1, review 365)')`
  - `existing = '# a note kept from the operator\n' + FLEET_TOKEN_FILE_COMMENT + '\n' + OLD + '\n'`. Use the module's piece-built `OLD`. Do not import `randomBytes`, and do not shadow `OLD`.
  - `expect(w.stdout, w.stderr).toBe(\`ok ${GEN}\n\`)`.
  - `expect.soft(violations(w)).toEqual([])`.
  - `expect.soft(statSync(w.dest).ino).not.toBe(w.preIno)`, because a rename gives a new inode.
  - `expect(readFileSync(w.dest, 'utf8')).toBe('# a note kept from the operator\n' + FLEET_TOKEN_FILE_COMMENT + '\n' + VALUE + '\n')`, and the content does not contain `OLD`.
  - `expect.soft` lets the violations red and the inode red both show in one run.
- [ ] **Step 3: Measure red under N1c.** Apply it to `_TS_WRITE_PY`: `inplace = os.path.lexists(dest)`; `fd = os.open(dest if inplace else tmp, os.O_WRONLY | os.O_TRUNC)`; when `inplace`, skip `os.rename(tmp, dest)` and `os.unlink(tmp)` instead. Run `cd server && ./node_modules/.bin/vitest run test/ccrc-token-sync.test.ts`. The R1 row must red with `the destination is opened for writing in place`, and on the inode check. Restore, then `cmp`.
- [ ] **Step 4: The in-verb guard (R1's option; it also closes review 365's S1).** First add the row `it('a temp that is not beside the destination is refused, and the destination is unchanged')`: call `runWriter(writerBody(), { existing, tmpDir: join(<the run's dir>, 'elsewhere') })`. Expect stdout `fail the temp file is not beside the token file\n`, and expect the destination to be byte-identical to `existing`. Run it: RED. Then add to `_TS_WRITE_PY`, after the shape checks and before `preamble = …`: `if os.path.dirname(os.path.abspath(tmp)) != os.path.dirname(os.path.abspath(dest)): out("fail", "the temp file is not beside the token file")`. Run it: GREEN. (Both paths in the verb are fixed under `$SECRETS`, `ccd/ccrc-token-sync:104-105` and `:363`, so no live path changes.)
- [ ] **Step 5: Run** `test/ccrc-token-sync.test.ts`, then `test/token-rotation-real-verb.test.ts`, one call each. Both green.
- [ ] **Step 6: Commit** (`test(token-sync): R1, an existing destination is renamed over, never rewritten in place`).

| Mutation | Must red |
|---|---|
| Review 365's N1c (above) | The R1 row (violations and inode) |
| Delete the Step 4 `if … out("fail", …)` line | The temp-elsewhere row |
| Review 365's S1: in `cmd_sync`, `T_TOKEN="$(mktemp "$CCRC_DIR/${TMP_PREFIX}XXXXXX" …)"` | Every synced-path row (`write-failed`) |

### Task 2 (part 1): R2, F1's sequence on the both-role rig

**Files:** `server/test/token-rotation-e2e.test.ts` (the F1 describe at `:347-366`, `bothAt` at `:1704`, D-4414 F2's plant-first idiom at `:1733-1739`). `server/src/token/driver.ts` `view()` (the gate at `:192-194`) is a mutation target only.

**Why:** F1's pin runs on a server-role rig (`bothWriter: null`, `:115`), so its `not.toContain(['current', 'own-write'])` can only see the `current` arm. Under review 365's M6 the file stays 96 of 96 green.

**Why the plant:** on an empty both home, boot's first mint owes nothing. `bothAt` passes `generation: null`, so `nextAction` returns `none` and no own-write promotion ever happens. The first `bothAt` therefore starts from a hand-made value, as D-4414 F2 does. Its first tick adopts and promotes by own-write.

- [ ] **Step 1: Add the row** to the F1 describe:
  `it.skipIf(isRoot)('a both box with history whose boot mint fails: no own-write confirmation of a value the holder does not hold (R2, review 365)')`
  - `home = mkTmp('ccrc-token-e2e-r2-')`, then `mkdirSync(path.join(home, '.ccrc'), { recursive: true })`, then `writeFileSync(path.join(home, '.ccrc', 'mail.token'), \`${'e'.repeat(64)}\n\`, { mode: 0o600 })`.
  - `ctl = { off: 0, writerFails: false }`. `const b = await bothAt(home, ctl); await b.driver.tick();`
  - Precondition: `expect(b.driver.view()).toMatchObject({ fleetConfirmed: 'own-write' })`, with `currentSeq` not null. This proves the arm is live before the fault. Run the file now, and this assertion must be GREEN at `origin/main`.
  - `rmSync(b.paths.current)` and `rmSync(b.paths.previous, { force: true })`.
  - `const r = await bothAt(home, { ...ctl, lockDirForBoot: true })`.
  - Expect `r.boot.mintFailed` to be true and `r.boot.holder.hasCurrent()` to be false.
  - Expect `r.driver.view()` to match `{ phase: 'unconfigured', currentSeq: null, fleetConfirmed: 'unknown' }`, and `['current', 'own-write']` to not contain `v.fleetConfirmed`.
- [ ] **Step 2: Measure red under M6.** In `view()`, apply `s !== null && s.current.id !== null && s.fleetConfirmed === s.current.id ? (this.deps.bothWriter !== null ? 'own-write' : holds ? 'current' : 'unknown') : …`, so the own-write arm loses `holds &&`. Run `cd server && ./node_modules/.bin/vitest run test/token-rotation-e2e.test.ts`. The new row must red, and the server-role F1 row must stay green. Restore, then `cmp`.
- [ ] **Step 3: Run** the file again. Green.
- [ ] **Step 4: Commit** (`test(token): R2, F1 on the both-role rig reds the ungated own-write arm`).

| Mutation | Must red |
|---|---|
| Review 365's M6 (above) | The R2 row only |
| `holds &&` dropped from the whole condition | The R2 row and the server-role F1 row |

### Task 3 (part 2): `retired-presented` is answered by a rotation, the server half (PENDING Decision 1, Option A)

**Files:** `server/src/token/policy.ts` (`:71`, `:97`, `:113`, `oweForRetiredPresentation` at `:155-159`), `server/src/token/files.ts` (`isBoxTokenState`, `:142`), `server/src/token/driver.ts` (`retiredSeen`/`retiredOwedAt` at `:83-84`, `noteCounters` at `:670-683`, `noteRetiredPresentations` at `:574-584`, both called at `:237-238`), `server/test/token-files.test.ts`, `server/test/token-policy.test.ts`, and `server/test/token-rotation-e2e.test.ts` (the D-4412 describe at `:1614`, `idleAfterRetirement` at `:1616`). Re-run `server/test/token-boot.test.ts` and `server/test/coord-token.test.ts`.

**Interface:**
- `BoxTokenState.counters` becomes `{ previousPresented: number; retiredPresented: number; retiredPresentedAt?: number | null }`. Absent means a state written before 4552. `null` means no retired presentation recorded. A number is the driver's `now()` on the tick that first saw the latest presentation. The stamp survives a restart. The count stays "since the server started".
- `export function retiredUnanswered(s: BoxTokenState): boolean` in `policy.ts`. It is true iff `retiredPresentedAt` is a number and either `lastRotationAt` is null or the stamp is greater than `lastRotationAt`.
- `oweForRetiredPresentation`'s first guard becomes `if ((i.fresh <= 0 && !retiredUnanswered(s)) || s.rotationOwed || s.pending.length > 0 || s.promoting !== null) return null`. The `HOLD_REPROBE_MS` bound line is unchanged and applies to both arms.
- The holder (`coord/token.ts`) and the PWA view are unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `token-files.test.ts`: a state reads as a state when `counters.retiredPresentedAt` is absent, `null`, or a number. It reads unusable when the value is `'1'`, `{}` or `-1`.
  - `token-policy.test.ts`, on `oweForRetiredPresentation` with `fresh: 0`:
    - An unanswered stamp with `lastOwedAt: null` owes `retired-presented`.
    - An unanswered stamp with `lastOwedAt` 10 min before `now` gives null (the bound).
    - An answered stamp gives null. So does a `null` stamp, and so does an absent key.
  - `token-rotation-e2e.test.ts`, inside the D-4412 describe:
    - `it('a retired presentation is stamped, answered by the rotation it owes, and the stamp outlives a restart (4552)')`
      - `idleAfterRetirement()`, then `r.rows.linkUp = false`, then `r.lane(L)` (expect 401), then `tick`.
      - Parse `<home>/.ccrc/box-token.json`. Expect `counters.retiredPresentedAt` to be a number greater than `lastRotationAt`.
      - `r.rows.linkUp = true`, then `tick`. Expect the owed rotation to complete and `lastRotationAt >= counters.retiredPresentedAt`.
      - Close the app, then `rig({ home: r.home, fleetHome: r.fleetHome })` and one `tick`. Expect `counters.retiredPresented` to be `0`, `counters.retiredPresentedAt` unchanged, and no rotation owed.
    - `it('a presentation inside the re-probe hour is not lost: it owes once the hour has passed, with no further presentation (4552)')`
      - `idleAfterRetirement()`, then `r.lane(L)` and `tick`, so one rotation is owed and completes. Record `r.agent.calls` as `c0`.
      - Set `r.clock.offset += 10 * 60_000`, then `r.lane(L)` and `tick`. Expect `r.agent.calls` to equal `c0`, because of the bound, and the stamp to be greater than `lastRotationAt`.
      - Set `r.clock.offset += HOLD_REPROBE_MS`, then `tick` with no presentation. Expect `r.agent.calls` to be `c0 + 1`, and `lastRotationAt >= stamp`.
      - Run two more ticks. Expect `r.agent.calls` to stay at `c0 + 1`.
    - `it('a restart over an unanswered stamp owes one rotation on its first tick (4552)')`. Present inside the hour as above, close, re-`rig`, `tick`. Expect exactly one rotation.
    - `it('a state from before 4552 with a count is stamped as unanswered, never cleared (4552)')`. Plant a legacy `counters` with no key and `retiredPresented: 1`, boot, then `tick`. Expect `retiredPresented: 0`, `retiredPresentedAt` to be a number, and one rotation owed for `retired-presented`. A second plant with no key and count `0` gives `retiredPresentedAt: null` and owes nothing.
- [ ] **Step 2: Run them RED,** one call each: `cd server && ./node_modules/.bin/vitest run test/token-files.test.ts`, then `test/token-policy.test.ts`, then `test/token-rotation-e2e.test.ts`.
- [ ] **Step 3: Implement.**
  - `policy.ts:71`: add the optional field with a docstring for its three readings. In the literals at `:97` and `:113`, the `counters` default becomes `{ previousPresented: 0, retiredPresented: 0, retiredPresentedAt: null }`. Add `retiredUnanswered`, and change `oweForRetiredPresentation` as the Interface says. Update its docstring: the input is "new presentations, or a presentation still unanswered".
  - `files.ts`: refuse a present field that fails `isNumOrNull`.
  - `driver.ts`: add `private retiredStampSeen = 0`, and pass `now` into `noteCounters`. There:
    ```ts
    const known = 'retiredPresentedAt' in s.counters;
    const at = c.retired > this.retiredStampSeen ? now
      : known ? (s.counters.retiredPresentedAt ?? null)
      : s.counters.retiredPresented > 0 ? now : null;   // 4552: a pre-4552 count is unanswered, never clear
    this.retiredStampSeen = c.retired;
    ```
    Write `counters: { previousPresented, retiredPresented: c.retired, retiredPresentedAt: at }` whenever any of the three differ or the key is absent. In `noteRetiredPresentations`, replace `if (this.state === null || fresh <= 0) return` with `if (this.state === null) return`. When the owe came from an unanswered stamp with `fresh` at 0, log `'ccrc-server: box token: a retired presentation is still unanswered; a forward rotation is owed (retired-presented)'`.
- [ ] **Step 4: Run GREEN,** one call each: `test/token-files.test.ts`, `test/token-policy.test.ts`, `test/token-rotation-e2e.test.ts`, `test/token-boot.test.ts`, `test/coord-token.test.ts`.
- [ ] **Step 5: Commit** (`feat(token): a retired presentation is stamped and owes a rotation until one answers it (4552)`).

| Mutation | Must red |
|---|---|
| `oweForRetiredPresentation`'s guard back to `i.fresh <= 0` alone | The re-probe-hour row (no rotation after the hour), the restart-owes row, and the policy unanswered row |
| The bound applies only when `fresh > 0` | The re-probe-hour row (a rotation inside the hour) and the policy bound row |
| `at = now` on every tick where the stored count differs from `c.retired` (a restart's 1 to 0 counts as a presentation) | The restart half of the stamp row |
| `at = c.retired > this.retiredStampSeen ? now : null` (a restart forgets the stamp) | The restart half of the stamp row |
| The legacy arm gives `null` (absence read as clear) | The legacy row |
| The stamp never written (the `counters` literal keeps two fields) | The stamp row and the legacy row |
| `files.ts` stops checking the field | The `'1'`, `{}` and `-1` validator rows |

### Task 4 (part 2): `retired-presented` is answered by a rotation, the doctor half (PENDING Decision 1, Option A; waits on claim 1141)

**Files:** `ccd/ccrc-doctor-checks` (the state validator at `:7488`, the finding at `:7531-7532`, the parser at `:7748`, `_bt_find`'s arm at `:7688-7690`), and `server/test/doctor-box-token.test.ts` (ROWS at `:212-262`, the `retired-presented` row at `:246`, `healthyState` at `:88`).

- [ ] **Step 1: Write the failing rows.** Replace the single row at `:246` with four ROWS entries. Each still SKIPs on the shipped file and FAILs on `armed()`:
  - `'retired-presented (unanswered: newer than the last rotation)'`: `counters = { previousPresented: 0, retiredPresented: 2, retiredPresentedAt: lastRotationAt + MIN }`.
  - `'retired-presented (a state from before 4552: a count, no stamp)'`: `retiredPresented: 2`, no key.
  - `'retired-presented (after a restart: count 0, the stamp unanswered)'`: `{ retiredPresented: 0, retiredPresentedAt: lastRotationAt + MIN }`.
  - `'retired-presented (a count with a null stamp)'`: `{ retiredPresented: 1, retiredPresentedAt: null }`. It is unreachable by construction, and it reads unanswered (fail closed).

  Then add a describe `doctor box-token: a rotation answers a retired presentation (4552)`. It loops over `[CHECKS_SRC, armed()]`:
  - A stamp older than `lastRotationAt`, with count 2, gives `PASS box-token: ${SERVER_PASS}\n`.
  - `retiredPresentedAt: null` with count 0 gives the same PASS. So does an absent key with count 0.
  - Edge: a stamp 30 s before `lastRotationAt` gives PASS. A stamp 30 s after it is a finding (SKIP on the shipped file, FAIL on `armed()`).
  - `retiredPresentedAt: 'x'` gives `server: state-unreadable`.
  - The armed sentence for the stamped row contains `ago and no rotation has completed since`. The legacy row's and the null row's contain `records no time for it`.
- [ ] **Step 2: Run them RED:** `cd server && ./node_modules/.bin/vitest run test/doctor-box-token.test.ts`.
- [ ] **Step 3: Implement.**
  - Validator (`:7488`): add `and ("retiredPresentedAt" not in k or on(k["retiredPresentedAt"]))`.
  - Finding (`:7531`), branching on presence first:
    ```python
    if "retiredPresentedAt" in k:
        rp = k["retiredPresentedAt"]
        if rp is not None and (lr is None or rp > lr):
            say("finding", "retired-presented", k["retiredPresented"], age(rp))
        elif rp is None and k["retiredPresented"] > 0:
            say("finding", "retired-presented", k["retiredPresented"], "-")
    elif k["retiredPresented"] > 0:
        say("finding", "retired-presented", k["retiredPresented"], "-")
    ```
  - Parser (`:7748`): take `retired-presented` out of the grouped arm and give it its own arm: `retired-presented) if _bt_num "$n" && { [ "$node" = - ] || _bt_num "$node"; }; then _bt_find server "$w" "$n" "$node"; else bad=1; fi ;;`.
  - `_bt_find` (`:7688`) stays `cls=FAIL`:
    - When `$b` is `-`: `say="a retired value was presented $a time(s) since the server started, and this state records no time for it"`.
    - Otherwise: `say="a retired value was presented $(_bt_age "$b") ago and no rotation has completed since ($a since the server started)"`.
    - `fix="the server owes a forward rotation for it, at most one an hour, and this line clears when that rotation completes; if it stays past an hour, read the server's log for the lane that presented it"`. The fix names no hand rotation.
- [ ] **Step 4: Run GREEN:** `test/doctor-box-token.test.ts`, then `test/ccrc-doctor.test.ts`, one call each.
- [ ] **Step 5: Commit** (`feat(doctor): retired-presented clears when a rotation answers it (4552)`).

| Mutation in `ccd/ccrc-doctor-checks` | Must red |
|---|---|
| `if rp is not None and (lr is None or rp > lr):` becomes `if rp is not None:` | The answered-PASS case |
| The final `elif k["retiredPresented"] > 0` branch deleted (absence read as clear) | The legacy ROWS row |
| `rp > lr` becomes `rp > lr + 60000` (a tick of slack toward clear) | The 30-s-after edge row |
| The presence branch collapsed to `rp = k.get("retiredPresentedAt")` / `if rp is not None` (overloaded null) | The null-stamp ROWS row |
| The validator clause deleted | The `'x'` case |

### Task 5 (part 1): R3, the hex-shape scanner sees every spelling

**Files:** `server/test/doctor-box-token.test.ts` (the `genShapes` docstring at `:494-495`, the regex at `:498`, the CONTROL row at `:521-529`).

**Why:** Review 365 measured that the scanner misses `[\da-f]{16}`, `[a-f\d]{16}`, `[0-9abcdef]{16}` and `(?:[0-9a-f]){16}`.

- [ ] **Step 1: Add CONTROL lines first.** Use `String.raw` for every backslash spelling, because an untagged template literal turns `\d` into a bare `d` (`[da-f]{16}`, which the old scanner already finds). For each spelling: `const planted = String.raw\`x = re.compile(r"[\da-f]{16}")\``, then `expect(planted).toContain(String.raw\`[\da-f]\`)`, then `expect(genShapes(\`${src}\n    ${planted}\n\`)).not.toEqual(want)`. Do the same for `[a-f\d]{16}`, `[0-9abcdef]{16}` and `(?:[0-9a-f]){16}`. Add two more lines:
  - `[[ "$x" =~ ^[0-9a-f]{16}$ ]]` planted must stay `not.toEqual(want)`. It is the natural bash spelling, and a class body that admits `[` would swallow it.
  - `x = re.compile(r"[A-Za-z0-9._:-]{8}")` planted must stay `toEqual(want)`, because a class wider than hex is not a hex shape.

  Run: the four new spellings red, and the other two lines stay green.
- [ ] **Step 2: Rewrite `genShapes`** to judge a class by the set it admits:
  - Match `/(?:\(\?:)?\[((?:\[:[a-z]+:\]|\\.|[^\]\\\[])*)\]\)?\{\d+(?:,\d*)?\}/g`. The body admits `[` only as a `[:name:]` class. (Measured in node: this finds `[0-9a-f]{16}` inside `[[ "$g" =~ ^[0-9a-f]{16}$ ]]`. A body that admits `[` finds `[[ "$g" =~ ^[0-9a-f]{16}` instead, and drops it.)
  - Expand the body: ranges; `\d` becomes 0-9; `[:xdigit:]` becomes 0-9a-fA-F; letters as written.
  - Keep a match when the expanded set is a subset of `0-9a-fA-F-` and contains at least one of `a-fA-F`.
  - Exclude only the exact `[0-9a-f]{64}`, as today.
- [ ] **Step 3: Narrow the docstring to the truth:** "every bracket class whose admitted set is hex digits (and `-`), in any spelling: ranges, listed letters, `\d`, `[:xdigit:]`, bare or inside `(?:…)`".
- [ ] **Step 4: Run** `cd server && ./node_modules/.bin/vitest run test/doctor-box-token.test.ts`. Green, and the three real sites are still found.
- [ ] **Step 5: Commit** (`test(doctor): R3, the generation-shape scanner judges a class by what it admits`).

| Mutation | Must red |
|---|---|
| Restore the old regex at `:498` | The four new spelling lines |
| The body's last alternative becomes `[^\]\\]` (admits `[`) | The `[[ "$x" =~ … ]]` line |
| Drop the subset test (keep any class with a hex letter) | The `[A-Za-z0-9._:-]{8}` line |

### Task 6 (part 1): R4 citation, and the token-line stripper carries quote state (run 350 fix 1's accepted ruling)

**Files:** `server/test/install-worker-skill.test.ts` (`:151`), and `server/test/install-coordinator-skill.test.ts` (`stripShellComment` at `:206-217`, `tokenNamingLines` at `:222-228`, self-tests at `:286-309`).

- [ ] **Step 1 (R4):** At `:151`, replace `install-coordinator-skill.test.ts:207-233's idiom` with a pointer by name that survives line drift: `the idiom of install-coordinator-skill.test.ts's describe "the deploy ships the skill, agent-side — and no longer ships the token"`. This is prose only. Run `test/install-worker-skill.test.ts`.
- [ ] **Step 2 (the stripper), red first.** Add a self-test row: `` expect(tokenNamingLines(`${base}bash -c "echo start\n  # not a comment inside the quote; scp deploy/ccrc-mail.token \\"$BOX:.ccrc/mail.token\\""\n`)).toHaveLength(1) ``. Run it: red, because each line resets the quote state.
- [ ] **Step 3:** Replace the per-line `stripShellComment` with `stripShellComments(text: string): string[]`. It keeps `q` across `\n`. A `#` comment ends at its newline, with `q` still `null`. `tokenNamingLines` uses it. Run `test/install-coordinator-skill.test.ts`. Every existing row must stay green, **and so must the real `deploy/deploy.sh`.** If the real file reds (for example, an apostrophe in a heredoc body flips the state), stop and take the other ruled option: document the limit in the docstring and drop the row. Record which option was taken in the commit.
- [ ] **Step 4: Commit** (`test(deploy): R4 citation by name; the token-line stripper carries quote state across lines`).

| Mutation | Must red |
|---|---|
| `q = null` at each newline in `stripShellComments` | The Step 2 row |

### Task 7 (part 1): R-f, the verb's proof, probe, shape and file guards are pinned

**Files:** `server/test/ccrc-token-sync.test.ts` (the recording curl at `:59-77`, `claimAnswers`/`proofAnswers` at `:101-107`, `runToken` at `:114`, the existing proof-words row at `:378`). `ccd/ccrc-token-sync` is a mutation target only. The code is correct today, and these are coverage pins.

- [ ] **Step 1: Add `timeout` to `runToken`'s options** (default unchanged). Row 6 passes 10000 ms.
- [ ] **Step 2: For each pin below,** add it, measure it red under its mutant, then restore and `cmp`. Run `cd server && ./node_modules/.bin/vitest run test/ccrc-token-sync.test.ts` after each.

| # | Mutation in `ccd/ccrc-token-sync` (line at 995a05750) | Pin to add |
|---|---|---|
| 1a | Proof `[ "$status" = 400 ]` (`:413`) becomes `[[ "$status" =~ ^(400\|50[02-9]\|5[1-9][0-9])$ ]]` | `it.each([500, 502, 503])`: `proofAnswers(home, s)` gives `expectRefusal(r, 'proof-unmeasured')`, and the report's `proof` is `proof-unmeasured`. Confirm that the existing 501 row at `:378` stays green under this mutant, so the new rows are what red. |
| 1b | The same line becomes `[[ "$status" =~ ^(400\|40[2-9]\|4[1-9][0-9])$ ]]` | `it.each([403, 404, 429])`, the same expectation. Confirm that the 401 and 501 rows stay green. |
| 2 | Probe `400) word=accepted` / `401) word=refused` (`:454-455`) widened to `4*) word=refused`, or `404` added to `accepted` | Probe table: 400 gives `probe: 400 accepted`, 401 gives `probe: 401 refused`, and each of 403, 404, 429 and 500 gives `unmeasured` with a non-zero exit |
| 3 | `[[ "$code" =~ $CODE_RE ]]` (`:343`) given a widened literal; `re.fullmatch` becomes `re.match` (`:277`, `:279`) | A 44-character code and a code with `=` give `bad-code` with no curl call. A claim answer whose value or generation ends in `\n` gives `claim-refused`, with nothing written. |
| 4 | `--max-time "$CALL_MAX_TIME"` dropped from the proof (`:411`) or the probe (`:450`) | The proof's argv and the probe's argv each contain `--max-time 15`, as `:182` pins for the claim |
| 5 | `if len(raw) > cap: out("bad", …)` (`:268-269`) deleted | A valid answer (`ok`, `VALUE`, `GEN`) padded with trailing spaces to 4200 bytes gives `claim-refused` and `over 4096 bytes`, with nothing written. Under the mutant, the 4097-byte read still parses, so the answer is accepted and the row reds. (`f.read(cap + 1)` becoming `f.read()` changes only memory. No test can see it, and the commit names it as such.) |
| 6 | `or not os.path.isfile(dest)` (`:284`) dropped, or `lexists` (`:283`) becomes `exists` | A dangling symlink at the token path gives `write-failed`, with `lstat` and `readlink` unchanged. A FIFO at the path (made with `mkfifo` through `spawnSync`) gives `write-failed`, and the FIFO is unchanged. The FIFO row passes `timeout: 10000` to `runToken`. In a `finally` it opens the FIFO with `fs.openSync(fifo, fs.constants.O_WRONLY \| fs.constants.O_NONBLOCK)` and closes it, so a reader blocked under the mutant is released and no python process is orphaned. (`O_NONBLOCK` on a FIFO with no reader throws `ENXIO`; catch and ignore it.) |
| 7 | `[ "$status" = 410 ] &&` (`:380`) dropped | `claimAnswers(home, 409, '{"ok":false,"error":"code-used"}')` gives `claim-refused`, not `code-used` |
| 8 | `[ "$1" = --from ]` (`:331`) dropped | `sync --form agent` gives the usage exit with no curl call |

- [ ] **Step 3: Commit** (`test(token-sync): R-f, the verb's guards each pinned by the mutation that removes it`).

### Task 8 (part 1): R-g, the card reader refuses inherited-key words

**Files:** `pwa/test/box-token-card.test.tsx` (its `it.each` of unreadable views at `:68-86`). `pwa/src/lib/api.ts` is a mutation target only (its `Object.hasOwn` sites at `:502`, `:507`, `:509`, `:511`). Open PR #322 touches `api.ts`, and this task does not edit it.

- [ ] **Step 1: Add these rows to the table:**
  - `['an inherited key as the fleet word', { ...BT(), fleetConfirmed: 'toString' }]`
  - `['__proto__ as the fleet word', { ...BT(), fleetConfirmed: '__proto__' }]`
  - `['an inherited key as a recovery source', { ...BT(), lastBootRecovery: { at: 5, source: 'constructor' } }]`
  - `['an inherited key as a stall reason', { ...BT(), stalled: { why: 'toString', since: 5 } }]`
  - `['an inherited key as a file slot', { ...BT(), fileProblem: { at: 5, file: 'hasOwnProperty', word: 'changed' } }]`

  Then add one mounted case: a `toString` fleet word renders the literal text `Box-token state: not reported (the server's answer could not be read).`, and not `function toString`. Assert the literal. `BOX_TOKEN_UNREADABLE_TEXT` is module-local in `pwa/src/screens/SettingsScreen.tsx:732` and is not exported, and this task does not edit that file.
- [ ] **Step 2: Measure.** Change each of the four `Object.hasOwn(X, v)` calls to `v in X`, one at a time. Run `cd pwa && ./node_modules/.bin/vitest run test/box-token-card.test.tsx` and see that site's row red. Restore, then `cmp`.
- [ ] **Step 3: Commit** (`test(pwa): R-g, the box-token reader refuses inherited-key words`).

### Task 9 (part 1): notify.sh never posts the unedited placeholder (ledger 12:00 residue 5)

**Files:** `deploy/notify.sh` (the token read at `:37-39`, the address guard at `:84`, the token guard at `:102`), `server/test/notify-addr.test.ts` (`runNotify` at `:133`, `recordingCurl`, the no-token rows at `:355-367`), and `server/test/coord-token.test.ts` (the D-4393 text pin at `:180`).

- [ ] **Step 1: Red first.**
  - In `notify-addr.test.ts`, beside the no-token rows, add `it('sends nothing when the token file still holds the shipped placeholder')`. It calls `recordingCurl(home)`, plants a token file with `deploy/ccrc-mail.token.example`'s own bytes, and calls `runNotify(home, { CCRC_ADDR: 'http://127.0.0.1:9', CCRC_MAIL_TOKEN_FILE: f })`. Expect exit 0 and no `curl.argv` file. `CCRC_ADDR` is required: without it, the script exits at the address guard (`:84`) before the token guard, and the row is green at `main`.
  - In `coord-token.test.ts`, add a text pin: notify.sh's placeholder literal equals `PLACEHOLDER_TOKEN`.
  - Run both, one call each: red.
- [ ] **Step 2:** Insert `[ "$tok" != 'REPLACE-THIS-LINE-WITH-THE-OUTPUT-OF-openssl-rand--hex-32' ] || exit 0` on its own line **directly above** `[ -n "$tok" ] || exit 0`, so `:180`'s three-line pin stays whole. Add one comment line naming `PLACEHOLDER_TOKEN` (`server/src/coord/token.ts:69`) as the authority. (Measured: `single-definition.test.ts` does not scan for this literal. The coord-token pin holds the copy to the authority.)
- [ ] **Step 3: Run** `test/notify-addr.test.ts`, `test/coord-token.test.ts`, `test/ccrc-containment.test.ts` and `test/single-definition.test.ts`, one call each. Green.
- [ ] **Step 4: Commit** (`fix(notify): no POST of the unedited placeholder, a guaranteed 401`).

| Mutation | Must red |
|---|---|
| Delete the placeholder line | The notify-addr row and the coord-token literal pin |
| One character changed in notify.sh's literal | The coord-token literal pin |

### Task 10 (part 1): `/api/notify`'s wrong-token advice names today's tools (ledger 12:00 residue 3)

**Files:** `server/src/server.ts` (`:1593-1594`) and `server/test/notify-token.test.ts` (its wrong-token case at `:31-42`).

- [ ] **Step 1: Red first.** In the `:31` case, add `expect(warn.mock.calls.flat().join(' ')).toContain('ccrc token probe')` and `.not.toContain('deploy/ccrc-mail.token')`. Run `cd server && ./node_modules/.bin/vitest run test/notify-token.test.ts`: red.
- [ ] **Step 2:** Change the advice to `'— run ccrc doctor on both boxes (its box-token line), and ccrc token probe --file ~/.cc-secrets/ccrc-mail.token on the fleet box'`. Never log the presented value. Run the file: green.
- [ ] **Step 3: Commit** (`fix(server): /api/notify's wrong-token advice names doctor and the probe`).

### Task 11 (part 1 or 2): The residue on claim 1141's files: items 2, 4 and 6(a) (waits on claim 1141)

**Why here:** the ledger sends each residue item to row 2a unless its file is under another claim. Tasks 4 and 12 already wait for 1141, so this PR cannot merge while it stands. If 1141 is released, these items ride here. If the holder consents only to Tasks 4 and 12, this task goes to wave 2 and the coordinator records that.

**Files:** `ccd/ccrc` (`cmd_token` at `:5271-5275`), `server/test/ccrc-cli.test.ts` (beside the adopt case at `:396`), `agent/test/deploy-verify.test.ts` (`:1531-1540`), `README.md`.

- [ ] **Step 1 (residue 2), red first.** In `ccrc-cli.test.ts`, add a row: a fixture tree with `ccrc-token-sync` removed, then `ccrc token sync --from agent`. Expect a non-zero exit, and expect the first stderr line to start with one of `TOKEN_VERB_MISSING_PREFIXES` (`shared/agent-protocol.ts:717`), imported, not copied. Run `cd server && ./node_modules/.bin/vitest run test/ccrc-cli.test.ts`: red.
- [ ] **Step 2:** In `cmd_token`, change the refusal to `_ccrc_die "unknown argument: token — its script is missing: $body; is this a complete ccrc install?"`, which prints `ccrc: unknown argument: token — …`. D-4395 classes that line as `verb-missing`, and its remedy (install a release that has the verb) is the right one for a missing script. Run the file: green.
- [ ] **Step 3 (residue 4):** Rewrite the `ship_secret` prose at `agent/test/deploy-verify.test.ts:1531-1540` as history. `deploy.sh` no longer ships the token, and the rsync exclude still keeps a stray `deploy/ccrc-mail.token` off both boxes. This is prose only. Run `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts`.
- [ ] **Step 4 (residue 6(a)):** Add a README sentence where the box-token holds are described: a two-box fleet placed by `deploy.sh` alone has no `~/.ccrc/node-id`, so the rotation gate holds `node-id-unmeasured`, and `ccrc install` (or `ccrc update`) mints the node id. Run `test/readme-*.test.ts` and any README citation scan the worker finds with `git grep -ln README.md server/test`, one call each.
- [ ] **Step 5: Commit** (`fix(ccrc): residue 2, 4 and 6(a) on the files claim 1141 held`).

| Mutation | Must red |
|---|---|
| The old `token's script is missing: …` refusal restored | The ccrc-cli row |

### Task 12 (part 2): The flip, `_BT_ARMS_ON=0` to `1` (LAST; waits on claim 1141, both decisions, the GPT-lane answer, residue 8(a)'s ruling, and Tasks 1 to 11 committed green)

**Files:** `ccd/ccrc-doctor-checks` (`:7397-7403` header, `:7420` constant, `:7431` tail, the branch at `:7868`, and `_bt_find` at `:7640`/`:7700` if Decision 2 (a)), `server/test/doctor-box-token.test.ts`, `server/test/ccrc-doctor.test.ts` (`:13692-13710`), `server/test/ccrc-install.test.ts` (the `BASE_LIVE_SHAPE` comment at `:8283-8296`, its maps at `:8309`, `:8360` and `:8481`, `liveBox()` at `:8568`, the live-shape case at `:8652`), the fallout files Step 0 names, `README.md` (`:589`), and `server/src/token/policy.ts` (`:43-44`).

The constant and the SKIP branch stay as a one-line kill switch. A disarmed copy of the file keeps the branch pinned.

- [ ] **Step 0: Measure the blast radius before writing anything.** Apply `_BT_ARMS_ON=1` in the working tree (save a copy first). Run each of these, one call each: `ccrc-install`, `ccrc-update`, `ccrc-account`, `ccrc-uninstall`, `install-census`, `ccrc-doctor-graphify`, `ccrc-doctor`, `doctor-box-token`, `token-rotation-real-verb`. Restore, then `cmp`. List every red with its armed class and word. Send the list to the coordinator, who puts Decision 2 to the operator and scopes the fixture files the reds name into this table (re-reading claims). Nothing in this task proceeds until both are back.
- [ ] **Step 1: Write the armed pins on the shipped file (red now).** In `doctor-box-token.test.ts`:
  - Replace `armedCopy()`/`armed()` (`:52-60`) with `disarmedCopy()`/`disarmed()`. It flips `^_BT_ARMS_ON=1$` to `0` in a copy, and throws if no such line exists.
  - The describe at `:264` runs ROWS against `disarmed()` and keeps every SKIP assertion. Retitle it `disarmed in a copy, every armed state is SKIP with its word (the kill switch)`.
  - The describe at `:283` runs against `CHECKS_SRC`.
  - `:300` becomes `toEqual(['_BT_ARMS_ON=1'])`.
  - `:201`, `:333` and Task 4's describe loop over `[CHECKS_SRC, disarmed()]`.
  - In `:314-322`, the shipped file gives WARN with rc 2 and no tail, and `disarmed()` gives SKIP with rc 3.
  - `:354` and `:364` become `^WARN box-token: server: pending-overdue` and `^FAIL box-token: server: state-unreadable`.
  - Retitle `:392` "the FAIL line" and add `toMatch(/^FAIL box-token: server: retire-overdue:30 — /)`.
  - `SKIP_TAIL` (`:43`) becomes `'; the FAIL and WARN arms are switched off (_BT_ARMS_ON=0)'`.
  - Rewrite the header at `:1-9`.

  In `ccrc-doctor.test.ts`, `:13705`/`:13709` become the armed class of `token-absent` (FAIL, or WARN under Decision 2 (a) when the state is also absent), followed by a `remedy:` line. Rewrite `:13692-13694`'s "counted as a skip". The no-role case at `:13696-13703` is unchanged.

  Run `test/doctor-box-token.test.ts` and `test/ccrc-doctor.test.ts`, one call each: red.
- [ ] **Step 2: Flip.** Set `_BT_ARMS_ON=1` at `:7420`. Rewrite the header at `:7397-7403`: the arms are on (row 2a), and the constant is a kill switch whose SKIP branch `doctor-box-token.test.ts` pins in a disarmed copy. `_BT_SKIP_TAIL` becomes `'; the FAIL and WARN arms are switched off (_BT_ARMS_ON=0)'`. Rewrite `README.md:589`: the FAIL and WARN arms are on, and a FAIL counts in doctor's exit code. Rewrite `policy.ts:43-44`'s "wave 1's doctor reports the state as SKIP" to say the alert backs doctor's WARN. Run the two files from Step 1: green.
- [ ] **Step 3 (only if Decision 2 is ruled (a)): the fresh-box classes.** Red first: add four ROWS rows.
  - Fleet with no token, no generation file and no `token-sync.json`: WARN.
  - Fleet with no token but a `token-sync.json`: FAIL.
  - Server with no token and no state: WARN.
  - Server with no token and a state: FAIL.

  Then make `_bt_find`'s two arms take their class from that history. The arms read the presence of the generation file and the report, or of the state file, through the arm's existing reads. Run `test/doctor-box-token.test.ts`: green. Define 4553 in Deviations found.
- [ ] **Step 4: The live-shape golden.** Run `test/ccrc-install.test.ts`. The case that reds is the live-shape case at `:8652` (`doctorClasses(r.stdout)` against `base.classes`, plus the install and doctor codes). `:8629` reads only the constant, and it reds only if the re-measured golden still holds a FAIL.
  - Give `liveBox()` the fleet side that part B leaves on every live fleet box:
    - `~/.cc-secrets/ccrc-mail.token`, mode 0600, holding `FLEET_TOKEN_FILE_COMMENT` and then a runtime-random 64-hex value;
    - `~/.ccrc/box-token-generation` (16 hex);
    - `~/.ccrc/token-sync.json` in the shape of `doctor-box-token.test.ts`'s `plantReport` (`synced`, https, `proved`).
  - Re-measure `BASE_LIVE_SHAPE` by the procedure its comment names (its Step 3, on a disposable copy of the new base, never by hand). The three maps' `box-token` should read `PASS`.
  - Re-check the live-shape case's uninstall assertions. Uninstall removes `token-sync.json` and `box-token-generation` as node records, so their lists may move.
  - Add one row that keeps a fresh box measured, not hidden: a `liveBox()` without the fleet files gives `box-token`'s class as ruled in Decision 2 (WARN under (a), FAIL under (b)), with the matching install exit code.
  - Update the comment at `:8283-8296` to say what moved and why.
- [ ] **Step 5: Every doctor-running suite on the armed tree,** one call each: the Step 0 list. Fix only fixture fallout in files this task's table lists after Step 0. Fallout anywhere else stops the task and goes to the coordinator.
- [ ] **Step 6: Mutation checks.** Apply each mutant, run `test/doctor-box-token.test.ts` (and `test/ccrc-doctor.test.ts` for the first), see red, then restore and `cmp`:

| Mutation in `ccd/ccrc-doctor-checks` | Must red |
|---|---|
| `_BT_ARMS_ON=1` becomes `0` | `:300`'s pin, every ROWS row of the armed describe, and `ccrc-doctor.test.ts`'s token-absent case |
| `if [ "$worst" = FAIL ]; then _dr_fail …` becomes `_dr_warn …; return 2` | Every FAIL row |
| `_dr_skip box-token "$detail$_BT_SKIP_TAIL"; return 3` becomes `_dr_pass box-token "$detail"; return 0` | The disarmed-copy describe (the kill switch never prints PASS) |
| (Decision 2 (a) only) the history test dropped, so both words are always WARN | The two "with history" FAIL rows |

- [ ] **Step 7: Commit** (`feat(doctor): arm box-token's FAIL and WARN (row 2a)`). Before committing, run `git fetch origin main`, then `test/deviation-refs.test.ts` and `test/dtbd.test.ts`, because this plan defines 4552 (and 4553 under (a)).

## Not in this PR (owner, why)

- **Residue 6(b)** (`owedSince` restarts with the process, `driver.ts:72`, `:749-750`). This is a known limit already recorded in the 2026-10-08 rulings. Owner: wave 2's schedule.
- **Residue 7** (`deploy.sh` never rewrites `ccrc-caps`, and `ccrc-api` is placed only by `deploy.sh`). Centralised-update wave 16's `_inst_bins ccrc-api` decides it. Owner: that programme.
- **Residue 8(a)** (no doctor word for a set-aside `box-token.json.unusable-*`). The wave-done that raised it marked it "for the arming PR". It needs a word and a class, and a WARN that only a human's file removal clears would be a hand step. **The coordinator rules it before Task 12 is dispatched.** If ruled, it rides Task 12, because it is the same file. Otherwise it goes to wave 2 by that ruling.
- **Residue 8(b)** (a dangling `agent.env` symlink: doctor and server disagree, in the safe direction) and **8(c)** (an unusable state plus an absent `mail.token` mints and owes nothing; it needs two faults). They need a ruling. Owner: the coordinator.
- **R-a** (a slim in-repo copy of review 362's live-topology simulation). It needs a ruling. The live first rotation has already passed, so it is a regression guard only. Owner: the coordinator.
- **R-i** (should the fleet PASS line print the proved sync's age, `ccd/ccrc-doctor-checks:7809`?). It is a ruling on a doctor sentence. Owner: the coordinator. If ruled before Task 12, it rides Task 12.
- **R-j** (does D-4410's "never adopt a value it cannot match to its own write record" extend to `mail-pending-<id>.token`, `mail-previous.token` and the promote rename at `driver.ts:377`?). It needs a ruling. If yes, it is a fix in `boot.ts` and `driver.ts` with pins. Owner: the coordinator, then wave 2.
- **Review 365's V3 and V15** (an extra in-place rewrite after the rename, through `io.open` or `os.open(dir_fd=…)`, which the recording wrapper does not see). Both are contrived, and pinning them means widening `WRAPPER`. Owner: the coordinator, as a ruling on whether wave 2 widens the wrapper.
- **The ruled CONTROL-noise row** (the `m1` CONTROL row reds as noise under any verb mutant). Task 1's rows do not rely on it. Cleaning it up is optional.
- **Accepted limits** (D-4414's G3 cost; ruling 1's `pending-cap`; D-4412's in-memory re-probe clock, which Task 3 now leans on for its bound). Already ruled. No work owed.

## Review Focus

1. **The clearing rule hides no uncured fleet and never wedges** (Option A). A fleet box that still holds a retired value presents again within a tick, so the line goes back to FAIL. A presentation inside the re-probe hour still owes a rotation once the hour has passed, with no hand step. Pinning tests: Task 3's stamp row and re-probe-hour row; Task 4's ROWS rows and its answered-PASS and edge cases.
2. **A restart neither clears nor raises the finding.** The count is since boot and the stamp is lifetime. A restart's 1-to-0 count change is never stamped. A restart over an unanswered stamp owes one rotation at once. A pre-4552 state with a count is stamped as unanswered (fail closed), and that costs one rotation. Pinning tests: Task 3's restart half, restart-owes row and legacy row; Task 4's legacy, after-restart and null-stamp rows.
3. **What the live boxes see at the arming release.** At 21:42 the server's doctor read `PASS` after its 21:35 restart, so its count was 0, and the legacy arm owes nothing there. Every unrelated merge to `main` restarts the server, so re-measure `box-token.json`'s `counters` (read-only, never printing a value) at dispatch and again before the merge. A plain `ccrc install` on a failing box keeps `~/ccrc.migrating` and skips `_ver_gc`. `ccrc update` and `rollout` exit 3 but never revert.
4. **`retire-overdue` across a restart.** D-4551, confirmed in the ledger's 2026-10-09 12:00 rulings, already makes `retire-overdue:<min>` and `retiring-unlanded:<min>` FAIL when armed. A server that is down across a previous value's `hardUntil` can show `retire-overdue` until its first tick retires the value. The driver's `start()` ticks at once, so the window is from boot to the first tick. The reviewer checks that the update's trailing doctor runs after `/health` answers, and so cannot normally land in that window.
5. **R1 and R2 were red under N1c and M6 before anything else landed.** Their commit messages carry the measured counts. Neither pin leans on the CONTROL-noise row. R2's precondition was green at `main` before M6.
6. **The ccrc-install golden** moves only because `liveBox()` gains the fleet files that part B leaves on every live fleet box. It was re-measured, never hand-edited. A separate row keeps the fresh-box class measured, under Decision 2's ruling.
7. **The outsider cost** of Option A. A party with the leaked value who presents at least once an hour keeps the server's doctor at FAIL, `ccrc update` at exit 3, and the server rotating once an hour, which is today's D-4412 bound. The reviewer confirms that nothing in the update control plane halts on that exit (phase `done`).
8. **The GPT-lane answer** is recorded under "Trigger and bound" before Task 12 merges.

## Deviations found

- **4552** (PENDING Decision 1; written for Option A). An armed `retired-presented` FAIL stands only while a retired presentation is unanswered, meaning it is newer than the last completed rotation. It is not "a retired value presented since the server started". The driver records when it first saw the latest presentation, in `box-token.json`'s optional `counters.retiredPresentedAt`. An absent key means a state from before this number, and `null` means none recorded. The stamp survives a restart. D-4412's `oweForRetiredPresentation` owes a rotation while the stamp is unanswered, as well as on a fresh count. Its `HOLD_REPROBE_MS` bound is unchanged, so a presentation inside the hour is answered once the hour has passed instead of being forgotten. A state from before this number with a non-zero count is stamped at the new build's first tick, so it reads as unanswered, never as clear. Doctor reads an absent key with a count, or a null stamp with a count, as unanswered. Why: the parent plan's Task B5 makes the finding a pure function of the since-boot count. Armed, that count clears only on a restart, and a completed rotation, which D-4412 owes for exactly this case, would never clear it. D-4412 as merged also lets a presentation inside its hour go unanswered for good. The spec's §4.8 lists "the count of retired values presented" and assigns it no class. The count stays on the console card and in the state file unchanged. Known limit: a rollback to a build before this number drops the key when its count changes, and if the stamp was unanswered at the rollback and nothing is presented afterwards, the roll-forward forgets it. If the operator rules B, this entry instead records `retired-presented` as a WARN. If C, it records the restart-only remedy and the boot-time zeroing.
- **4553** (only if Decision 2 is ruled (a)). `fleet-token-absent` and `token-absent` take their armed class from the box's history: WARN on a box never handed a value (no generation file and no sync report), or on a server that has never run the lifecycle (no state file); FAIL otherwise. The spec arms both as FAIL. Why: `ccrc install`'s exit code is doctor's, so a FAIL there makes every fresh install exit non-zero until its first rotation, and keeps `~/ccrc.migrating`. If Decision 2 is ruled (b) or (c), this number is not spent.
