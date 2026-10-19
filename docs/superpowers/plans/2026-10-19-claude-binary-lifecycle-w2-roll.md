# Claude Code binary lifecycle, wave 2: the roll — strict resume, the spawn carrier, `ccd roll`'s gate and act, the canary's health, the server's holds and route, the Restart command, and the first manual canary — Implementation Plan

> **For agentic workers:** one PR per task, in the order of §Landing order, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. **Every fleet task in this wave restarts sessions in its tests and is band 3, written and reviewed natively, never handed off.** Workers do not edit §Deviations and decisions; a departure is named by slug in the report and numbered by the coordinator through the allocator.

**Spec:** `docs/superpowers/specs/2026-10-18-claude-binary-lifecycle-design.md` (rev 3, approved by the operator 2026-10-19: "all cards accepted/answered"). §7 binds this plan in full; §9's traps 2, 3, 6 and 7; §10.1's canary health; §12's numbers.

**Status:** rev 1 (2026-10-19): rev 0 with two reviews applied (§Review log); written with the spec's rev 3, the other wave plans and the ledger. Tasks dispatch as their gates open. **No task in this wave rolls a live session**; the one live roll is the operator's act OA-3 (W2a).

**Inputs.** The spec's §7.1 to §7.6, §10.1, §11 (W2 and W2a), §11.1 (M2); the operator's rulings 4, 7, 8 and 13 and the 2026-10-19 swap ruling (spec §3); the hibernation plan (`2026-10-16-working-state-and-interruptions.md`: Task 15b's stop-finished-workers lane, Task 16's `cmd_hibernate`, Task 17a's `hibernateVerdict`, Task 17b's wake budget); swap's act order (`cmd_swap`, `ccd/ccd` ≈:27522); W1's plan (`2026-10-19-claude-binary-lifecycle-w1-observe.md`), whose §Global constraints bind here in full.

**Base:** `origin/main` `f82d0c015` (#701). Anchors at that sha: `_svc_reset_failed` ≈:1007, `_svc_run_detached` ≈:1051, `_ws_unsupervise` ≈:4156, `_LC_ACTS` ≈:4368, `_lc_done` ≈:5020, `_lc_fail` ≈:5023, `cmd_caps` ≈:8487, `_idle_for_keystroke` ≈:19847, `_operator_choice_keep` ≈:21202, `_resume_env` ≈:22536, `_spawn_start` ≈:22885 (its `--resume` / `--session-id` choice ≈:22956, the spawn line ≈:23299, the one retry ≈:23336-23360), `_spawn_settle` ≈:23380, `_supervised_start` ≈:23969, `cmd_ensure` ≈:24508, `cmd_supervise` ≈:24851, `_transcript_matches` ≈:25095, `cmd_swap` ≈:27522 (`CCD_SWAP_DETACHED` ≈:27685), `cmd_stop` ≈:28106, `cmd_hibernate` ≈:28204 (its `.no-hibernate` refusal ≈:28243); `ccd/claude-session@.service` (`StartLimitBurst=5` :19, `Restart=always` :24); `server/src/ccdargv.ts` (`CCD_ARGV` ≈:251, `hibernate` ≈:323, `verbSupported` ≈:705); `agent/src/whitelist.ts` (`EXEC_WHITELIST` ≈:396, `['hibernate']` ≈:426); `server/src/coord/hibernate.ts` (`hibernateVerdict` ≈:186); `server/src/deadCoordinator.ts` (`DEAD_COORDINATOR_DELIBERATE_ACTS` ≈:69); `server/src/server.ts` (`POST /api/sessions/:id/ensure` ≈:2861).

**Deploy class.** CB2a to CB2e are **AGENT-FIRST, FLEET** (`ccd`, the unit drop-in): deployed to the fleet node first. CB2f is AGENT-FIRST (the agent's whitelist), then server. CB2g is server. CB2h is PWA. `ccd caps` lists `roll` only from CB2d; until then no server can compose the verb (`verbSupported`).

**Names.** Tasks **CB2a** to **CB2h**; W2a is the operator act **OA-3**, after **OA-2** (M2).

**Goal, PR by PR.**

| After | What changes for a session | Underneath |
|---|---|---|
| CB2a | a wake after a hibernation resumes strictly: a missing transcript fails visibly instead of starting a fresh conversation | `_hib_gate` factored; `cmd_hibernate`'s transcript pre-flight; `.resume-strict` |
| CB2b | nothing until a roll writes a record | `_spawn_start` reads `.rolling`, `.claude-build`, `.claude-canary`; the spawn cap; `RestartPreventExitStatus` |
| CB2c | nothing (the verb is not in `ccd caps`) | `ccd roll`'s synchronous gate: arity, token, `--to`, the ccd-side holds, the kill switch |
| CB2d | a roll is possible from the node's own CLI with a token | the detached act, the restore, the outcome rows, `cause=roll`; `ccd caps` lists `roll` |
| CB2e | a canary is judged | the 120 s health check, the soak record, the local halt file |
| CB2f | nothing visible | `CCD_ARGV.roll`, the agent grant, the `roll` lifecycle act on the server |
| CB2g | nothing visible | the server's holds, the action token, `POST /api/sessions/:id/roll` (the canary only) |
| CB2h | **Restart onto 2.1.x** in the session's commands, for the canary only | none |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-19 at `f82d0c015` (26 open PRs).

- **#435** (session continuity wave 4b) holds `ccd/ccd`, `server/test/ccd-resume-flag.test.ts`, `server/test/ccd-route-spawn.test.ts`, `server/test/ccd-spawn-split.test.ts`, `server/test/ccd-operator-choice.test.ts` and `server/test/ccdWsHelpers.ts`: the spawn line, the resume flag and the operator-choice keep this wave edits. **CB2a to CB2e wait for #435.** It is the critical path of the fleet half.
- **#397** (path identity W1a) holds `server/src/ccdargv.ts`, `server/src/server.ts`, `server/src/lifecycle.ts`, `server/src/fleet.ts`, `shared/api.ts`, `server/test/whitelist-subset.test.ts`, `server/test/dead-coordinator-lane.test.ts` and `server/test/single-definition.test.ts`. **#700** holds `server/src/ccdargv.ts`, `server/src/coord/routes.ts` and `shared/api.ts`. **CB2f and CB2g wait for both.**
- **Skins W2 S2d** (the session's ⋯ items as commands in `pwa/src/command/commands.ts`) gates **CB2h**.
- **W1** (all of it) gates this wave: CB1b's deny rules before any verb exists, CB1c's switches, CB1d's candidate (the only build a W2 roll may name), CB1f's `FleetSession.claude`.
- **OA-2** (M2: how many behind sessions carry `crons` in their turn marker) gates **OA-3**, not any PR.
- **Hibernation:** Tasks 16 to 18 have merged (#593 to #598); CB2a edits `cmd_hibernate` and its tests, so it re-reads them at Step 0. Task 19 (the shadow week) is an operator act; CB2d tags every roll restart `cause=roll` so Task 19's instrument excludes them (decision 13), and nothing in this wave rolls automatically.

| Task | #435 | #397 / #700 | Skins W2 | W1 | Other |
|---|---|---|---|---|---|
| CB2a strict resume, pre-flight | **yes** | no | — | CB1c | — |
| CB2b spawn carrier | **yes** | no | — | — | CB2a |
| CB2c `ccd roll` gate | **yes** | no | — | CB1b, CB1c, CB1d | CB2b |
| CB2d the act, restore, caps | **yes** | no | — | — | CB2c |
| CB2e canary health | **yes** | no | — | — | CB2d |
| CB2f argv, grant, lifecycle act | no | **yes** | — | — | CB2d (the word in `ccd caps`) |
| CB2g holds, token, route | no | **yes** | — | CB1f | CB2f |
| CB2h Restart command | no | no | **S2d** | CB1g | CB2g |

## In flight, and what it fences off

| In flight | Files it changes that this plan would otherwise touch | Tasks it gates |
|---|---|---|
| #435 | `ccd/ccd`, `server/test/ccdWsHelpers.ts`, `ccd-resume-flag`, `ccd-route-spawn`, `ccd-spawn-split`, `ccd-operator-choice` tests | CB2a to CB2e |
| #397 | `server/src/ccdargv.ts`, `server/src/server.ts`, `server/src/lifecycle.ts`, `shared/api.ts`, `whitelist-subset`, `dead-coordinator-lane`, `single-definition` tests | CB2f, CB2g |
| #700 | `server/src/ccdargv.ts`, `server/src/coord/routes.ts`, `shared/api.ts` | CB2f, CB2g |

No open PR holds `ccd/claude-session@.service`, `agent/src/whitelist.ts`, `server/src/coord/hibernate.ts`, `server/src/hibernateSweep.ts`, `server/src/deadCoordinator.ts`, `server/src/stopDone.ts` or `server/test/hibernate-census.test.ts`.

## Landing order

```
--- after #435 (fleet lane; AGENT-FIRST) ---
CB2a (strict resume) ── CB2b (carrier) ── CB2c (gate) ── CB2d (act; caps lists roll) ── CB2e (canary health)
--- after #397 and #700 (server lane) ---
CB2f (argv, grant, act) ── CB2g (holds, token, route)
--- after S2d ---
CB2h (Restart onto)
--- operator ---
OA-2 (M2) ── OA-3 (W2a: the first manual canary, per (node, kind))
```

The fleet half is deployed before the server half; a server without CB2f sees no `roll` in its argv table, and a node without CB2d answers `404` on the route (`verbSupported`), so either order is safe, but the deploy order is AGENT-FIRST.

## Global constraints

W1's §Global constraints bind here in full. In addition, for this wave:

- **Fixture HOMEs only, and the unit stubbed.** Every `ccd roll` test runs under `makeCcdHarness`, with `systemctl`, `systemd-run` and `tmux` stubbed through the harness's existing fakes; a test that would reach a real unit or pane is a STOP.
- **The act is always detached.** No caller holds anything past the dispatch: no test may pass with the act run inline.
- **No swap is ever refused by a roll, and its synchronous answer never waits** (spec §3 ruling 4, §7.1, invariant 13). `cmd_swap` gains no `rolling` refusal; only its detached re-run waits, at most 270 s, after writing `.swap-waiting`, which makes the roll's act yield before any start; a roll refuses `swapping`. A test pins each.
- **No herd from manual rolls either.** `roll-in-flight` is checked under a node-level lock for every roll, manual included, and `recent-spawn` counts a spawn from its start, not from its settle.
- **Strict resume is for ccrc-initiated resumes only.** The operator's `ccd start` keeps today's `--session-id` fallback.
- **Two reviewers for CB2b to CB2e**, one reading only the work-loss lens (Review focus 1 to 4).

## Review focus (the failure modes most likely to bite)

1. **A fresh conversation in place of a resume.** Every ccrc-initiated resume (a roll, a wake after a hibernation) fails with rc 3 instead of retrying with `--session-id` (CB2a, CB2b).
2. **A half-done roll.** The act runs in its own transient unit; the caller gets a tx id; the deliberate row is written first; `_ws_unsupervise` runs before the kill so `Restart=always` cannot resurrect the old process; a stale `.rolling` is recovered by a strict resume, never honoured as a build carrier (CB2b, CB2d).
3. **Two acceptors in one pane.** The roll never calls `_spawn_settle`; the unit's own settle is the only one (CB2d).
4. **A crash loop on a bad build.** At most 2 spawns per tx, then `RestartPreventExitStatus`; the restore goes back to `from`, or the pair's target when `from` is unsmoked or halted (CB2b, CB2d).
5. **A gate that drifts from hibernation's.** `_hib_gate` is the one re-measure both verbs call, with the opt-out suffix as a parameter; the server's verdict is `hibernateVerdict` with a window and a suffix, never a copy (CB2a, CB2g).
6. **A roll a session or a stale server can aim.** `--to` is re-validated on the node against node-local files; the token binds `(id, uuid, from, to)` and is re-proved at the act; `self-roll` refuses (CB2c).
7. **A swap blocked by a roll.** `cmd_swap` has no `rolling` refusal; its synchronous arm answers at once; its detached re-run waits at most 270 s and the act yields to it before any start; the soak record refuses nothing (CB2b, CB2d, CB2e).
9. **A roll that herds or outlives its lock.** `roll-in-flight` under the node lock; the install lock taken inside the detached act, not by the exiting caller (CB2c, CB2d).
8. **A canary judged by the new build's own status.** Health is ccd's `_idle_for_keystroke`, the `exe` build, the uuid and the transcript size, at 120 s, then the 15 min soak with the RSS check (CB2e).

## Tasks

### Task CB2a: strict resume, and hibernation's transcript pre-flight (D-5703; spec §7.3, §7.2's `_hib_gate`, §9 trap 3) — GATED: after #435 and CB1c

**Routing:** band 3, **two reviewers** (changes how every hibernated session wakes). **Lane:** AGENT-FIRST (FLEET: `ccd`). **Needs:** #435 merged; CB1c.

**Files:**
- Modify `ccd/ccd`:
  - factor `cmd_hibernate`'s re-measure (≈:28204 to its act) into `_hib_gate <id> <optout-suffix> <quiet-seconds>`, which `cmd_hibernate` calls with `no-hibernate` and its own quiet window; the refusal reasons are unchanged (`busy`, `draft`, `marker`, `background`, `scheduled`, `held`, `opted-out`, `recent-swap`, `attached`);
  - `cmd_hibernate` gains swap's `_transcript_matches` pre-flight (≈:25095) before its kill, refusing `no-transcript` with exit 3, and writes `$REG/<id>.resume-strict` with its `.hibernated` marker;
  - `_spawn_start` (≈:22885): while `$REG/<id>.resume-strict` exists, the resume does **not** take the one `--session-id` retry (≈:23336-23360); it ends rc 3, and the row reads `orphan`; `_spawn_start` removes `.resume-strict` once the resumed session's `sessions/<pid>.json` names the same uuid;
  - `.resume-strict` joins `ccd-lifecycle-purge`'s suffix list (≈:3954) and is validated on read (an empty file, nothing else).
- Modify `server/test/ccd-hibernate.test.ts`, `server/test/ccd-resume-flag.test.ts`; create `server/test/ccd-strict-resume.test.ts`; modify `server/test/hibernate-census.test.ts` (a stance for `.resume-strict` in every lifecycle reader) and `server/test/single-definition.test.ts` (`.resume-strict`'s writers: `cmd_hibernate`, `ccd roll`'s act (CB2d), and `_spawn_start`'s removal).

- [ ] **Step 0: Re-ground.** Read #435's merged spawn line and resume flag; read `cmd_hibernate` whole and Task 16's tests.
- [ ] **Step 1: Red.** "a hibernate whose transcript is missing refuses `no-transcript` and stops nothing"; "a wake after a hibernation whose `--resume` leaves no session ends rc 3 and never runs `--session-id`"; "the operator's `ccd start` with a missing session still retries once with `--session-id`" (today's fallback kept); "`.resume-strict` is removed once the session file names the uuid"; "`_hib_gate` with `no-roll` refuses `opted-out` on `.no-roll` and ignores `.no-hibernate`, and the reverse"; every existing `ccd-hibernate` case green.
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the strict check removed from `_spawn_start` | ccd-strict-resume | "never runs `--session-id`" |
  | the strict check applied to `ccd start` too | ccd-strict-resume | "`ccd start` … still retries once" |
  | the pre-flight moved after the kill | ccd-hibernate | "refuses `no-transcript` and stops nothing" |
  | `_hib_gate` ignores its suffix parameter | ccd-strict-resume | "refuses `opted-out` on `.no-roll`" |
  | `.resume-strict` never removed | ccd-strict-resume | "removed once the session file names the uuid" |
  | the purge list loses `.resume-strict` | the purge suite Step 0 names | its census |

- [ ] **Step 4: Verify.** Each suite of Step 3 alone, then `bash -n ccd/ccd`.

**Not in this task:** `.rolling` and `.claude-build` (CB2b).

### Task CB2b: the spawn carrier (D-5704; spec §7.1 "The spawn runs inside the unit", §7.4 "Starts") — GATED: after CB2a

**Routing:** band 3, **two reviewers** (every spawn of every unit reads it). **Lane:** AGENT-FIRST (FLEET: `ccd`, the unit). **Needs:** CB2a.

**Files:**
- Modify `ccd/ccd` `_spawn_start`: on **every** spawn, in this order: a live `$REG/<id>.rolling` (`<tx> <from> <to> <attempt> <spawns> <holder-unit> <startedAt>`, validated; its holder unit active) renders `CCRC_CLAUDE_VERSION=<to>` into the `exec env` line (≈:23299), behaves as strict, increments `spawns`, and past 2 spawns refuses: `_lc_fail roll` cause `spawn-cap`, the record marked `phase=failed`, exit with the status the unit lists in `RestartPreventExitStatus=`; a **stale** `.rolling` (holder unit gone, **at any age**; 30 min only when the holder's liveness cannot be read) is recovered at once: a strict resume on `from`, attempt 2, subject to `recent-spawn` and `low-memory`, `_lc_done roll` phase `recovered`, never honoured as a carrier; with no `.rolling`, a valid `$REG/<id>.claude-build` renders `CCRC_CLAUDE_VERSION=<build>` while no target file exists or the pair target is older, and is dropped (rendering nothing) when the target is equal or newer, the build is absent, or it is listed in `~/.ccrc/claude-halted` or the projected halts. At its very top, `_spawn_start` writes the node's spawn-start stamp (`$REG/<id>` key `spawnstart`), which CB2c's `recent-spawn` reads, because the existing `spawn` stamp is written by `_spawn_settle` only after `_accept_first_run_prompts` returns (≈:23409).
- Modify `ccd/claude-session@.service`: `RestartPreventExitStatus=` gains the spawn-cap status.
- Modify `ccd/ccd`: every reader of `.stopped` takes `.rolling` over it (Step 0 lists them from `hibernate-census.test.ts`'s reader census); `.rolling`, `.claude-build` and `.claude-canary` join the purge suffix list.
- Create `server/test/ccd-roll-carrier.test.ts`; modify `server/test/hibernate-census.test.ts`, `server/test/single-definition.test.ts` (the three records' writers: `ccd roll`'s act and `_spawn_start` only).

- [ ] **Step 0: Re-ground.** Read the reader census; read how D-5237's `_resume_env "$id"` reaches the spawn line, the model for this carrier.
- [ ] **Step 1: Red.** "a live `.rolling` puts `CCRC_CLAUDE_VERSION=<to>` on the spawn line"; "a systemd restart of the same tx counts a spawn"; "the third spawn exits with the prevent status and writes `spawn-cap`"; "a stale `.rolling` is recovered on `from`, strictly, and its `to` is never rendered"; "`.claude-build` 2.1.302 with no target file is rendered"; "with a target 2.1.303, `.claude-build` 2.1.302 is dropped"; "`.claude-build` naming a halted build is dropped and the spawn takes the target"; "a `.rolling` whose holder unit is gone at 2 min is recovered at the next sweep, not after 30 min"; "the spawn-start stamp is written before the pane is created"; "a malformed record is ignored and logged"; "every `.stopped` reader reads `rolling`"; "the unit lists the prevent status".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the cap compared with `>` 3 | ccd-roll-carrier | "the third spawn exits" |
  | a stale record honoured as a carrier | ccd-roll-carrier | "its `to` is never rendered" |
  | `.claude-build` kept when the target is newer | ccd-roll-carrier | "… is dropped" |
  | `.claude-build` kept when halted | ccd-roll-carrier | "naming a halted build is dropped" |
  | stale only after 30 min | ccd-roll-carrier | "recovered at the next sweep, not after 30 min" |
  | the version regex dropped on read | ccd-roll-carrier | "a malformed record is ignored" |
  | one `.stopped` reader left unchanged | hibernate-census | its reader |
  | `RestartPreventExitStatus` line removed | ccd-roll-carrier | "the unit lists the prevent status" |

- [ ] **Step 4: Verify.** Each suite alone; `bash -n ccd/ccd`; `systemd-analyze verify` on the unit where available (otherwise the PR says not run).

**Not in this task:** who writes `.rolling` (CB2d).

### Task CB2c: `ccd roll`, its gate (D-5705; spec §7.1 "Arity and the token", "No self-roll", "Exit codes", §7.2's ccd-side holds) — GATED: after CB2b, CB1b, CB1c and CB1d

**Routing:** band 3, **two reviewers** (the door every roll passes; one reviewer reads only the security lens, Review focus 6). **Lane:** AGENT-FIRST (FLEET). **Needs:** CB2b; CB1b (denied to sessions), CB1c (the switches, `_mem_headroom`), CB1d (`claude-smoked`, `claude-candidate`).

**Files:**
- Modify `ccd/ccd`: `cmd_roll <id> --to <x.y.z> --expect <token> [--auto]`, exactly that arity (`--auto` is set only by the server's sweep, CB5a). Synchronous, in this order: `$REG/claude-roll-disabled` → exit 4 `disabled`; `--to` grammar; `self-roll` (the caller's own session) exit 4; a live `.rolling` exit 4 `rolling`; a swap holding the session (a fresh `lastswap` within `SWAP_JITTER` + 60 s, ≈:1346, a live swap unit, or `$REG/<id>.swap-waiting`) exit 3 `swapping`; under `flock -x $REG/.claude-roll.lock` (held from here through CB2d's `.rolling` write) any `$REG/*.rolling` on the node or any unjudged `$REG/*.claude-canary` exit 3 `roll-in-flight`; with `--auto`, `$REG/hibernate-shadow-week` younger than 8 days or `$REG/hibernate-live` younger than 24 h exit 3 `hibernation-arming` (decision 13); `versions/<to>` non-empty and executable, listed in `~/.ccrc/claude-smoked`, absent from `~/.ccrc/claude-halted` and the projected halts, and equal to the node's target for the session's kind, the pin, or (a canary) `~/.ccrc/claude-candidate`, else exit 4; the token re-proved: `_roll_fingerprint id=<id> uuid=<uuid> from=<v> to=<v>` (new, the shape of `_ws_reclaim_fingerprint` ≈:28718, every input named) recomputed from the node's view must equal `--expect` (spec §7.1; its TypeScript twin is CB2g's); `_hib_gate <id> no-roll 60`; then the ccd-side holds: `low-memory` (`_mem_headroom` below 3 GiB, decision 6; swap is never consulted), `recent-spawn` (any pane on the node spawned in the last 120 s, from CB2b's spawn-start stamps, the units' `spawn` stamps, any `.rolling` `startedAt` and the turn markers' `restartAt`), `compacting` (the transcript modified in the last 10 min); each exit 3 with its hold name. On a pass, in this task, it prints `gate-ok` and exits 0 without acting (CB2d adds the act). It is **not** in `cmd_caps` yet.
- Create `server/test/ccd-roll-gate.test.ts`.

- [ ] **Step 0: Re-ground.** Read `ws-reclaim`'s token re-proof and `REQUIRED_VERB_FLAG`; read `cmd_swap`'s live-unit test.
- [ ] **Step 1: Red.** One case per refusal above, each asserting nothing was written to `$REG` and no unit or pane was touched (the harness's fakes record no call); "two ids exit 2"; "an extra flag exits 2"; "a token for another `to` refuses"; "a `--to` equal to a lane's old `version_to` but not the target refuses"; "headroom 2.9 GiB holds `low-memory`, 3.1 GiB passes, full swap does not hold"; "a spawn 119 s ago holds `recent-spawn`, 121 s passes"; "`.no-roll` holds `opted-out`; `.no-hibernate` alone does not"; "a swap in flight holds `swapping`, and the swap itself is untouched"; "a second manual roll on the node while the first is mid-act holds `roll-in-flight`"; "a spawn whose settle has not finished holds `recent-spawn`" (spawn-start stamp 30 s old, no `spawn` stamp); "`--auto` with `hibernate-live` 1 h old holds `hibernation-arming`; without `--auto` it does not"; "`_roll_fingerprint` over the shared fixtures equals the fixture tokens" (CB2g's parity file).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the smoked-list check dropped | ccd-roll-gate | its case |
  | the candidate admitted for a non-canary | ccd-roll-gate | "… not the target refuses" |
  | the token re-proof skipped | ccd-roll-gate | "a token for another `to`" |
  | `low-memory` reads swap | ccd-roll-gate | "full swap does not hold" |
  | `recent-spawn` window 60 s | ccd-roll-gate | "119 s ago holds" |
  | `_hib_gate` called with `no-hibernate` | ccd-roll-gate | "`.no-roll` holds" |
  | the `swapping` hold removed | ccd-roll-gate | "a swap in flight" |
  | the kill switch checked after the gate | ccd-roll-gate | "disabled … nothing written" |
  | `roll-in-flight` checked outside the lock | ccd-roll-gate | "a second manual roll … holds" |
  | `recent-spawn` reads only the `spawn` stamp | ccd-roll-gate | "a spawn whose settle has not finished" |
  | `hibernation-arming` ignored with `--auto` | ccd-roll-gate | "`--auto` with `hibernate-live` 1 h old" |

- [ ] **Step 4: Verify.** The suite alone; `bash -n ccd/ccd`.

**Not in this task:** the act (CB2d); the server's token mint (CB2g).

### Task CB2d: `ccd roll`, its act and its restore (D-5706; spec §7.1 "The act, always detached", "Concurrency", §7.4 "The restore", "Task 19") — GATED: after CB2c

**Routing:** band 3, **two reviewers** (restarts sessions; one reviewer reads only the work-loss lens). **Lane:** AGENT-FIRST (FLEET). **Needs:** CB2c.

**Files:**
- Modify `ccd/ccd` `cmd_roll`: after the gate, still under CB2c's node lock, write `.rolling` with `_reg_set`, release the node lock, start the act through `_svc_run_detached` (≈:1051) with `CCD_ROLL_DETACHED=1` (swap's pattern, `CCD_SWAP_DETACHED` ≈:27685), print the tx id, exit 0. The synchronous caller takes **no** install lock: `systemd-run` passes no descriptor to the unit, and the caller exits at dispatch. The detached act, in spec §7.1's order: `flock -s ~/.ccrc/claude-install.lock` **inside the act's unit**, held until the outcome row, so no prune runs while the roll needs its `from`; `_lc_done roll` phase `kill` with `cause=roll` (first); `_operator_choice_keep`; `_transcript_matches` with path, uuid and size recorded in `.rolling`; `_ws_unsupervise` and the `.stopped` stamp it writes removed in the same step; `tmux kill-session`; `sleep 1`; the uuid re-read; the second `_transcript_matches`; `_supervised_start` (never `_spawn_settle`); wait for a spawn stamp newer than `startedAt`; judge at the deadline (spawn rc 0, `_idle_for_keystroke`, the new pid's `exe` build and `sessions/<pid>.json` version both `to`, the same uuid, the transcript not shrunk); `_lc_done roll` phase `outcome` with `meas.from`, `meas.to`, `meas.ran`, `meas.uuid`, `meas.rc` and `cause=roll`, or `_lc_fail roll` with the cause; `.claude-build` on success; `.rolling` removed. **The restore** on **any** failed judgement criterion after the kill (spawn rc 3, 4 or 6, the settle unfinished at the deadline, `_idle_for_keystroke` failing, `meas.ran` not `to`, a changed uuid, a shrunk transcript), the failing criterion named in the row: unsupervise and kill first, rewrite `.rolling` to `to = from`, attempt 2, `_supervised_start`, strict, judged against a 120 s restore deadline; `from` unsmoked or halted → the pair's target; rc 5 is `limit-blocked`, never a build failure. **The yield:** before the restore and before each `_supervised_start`, the act checks `$REG/<id>.swap-waiting`; if present it aborts, journals `_lc_done roll` phase `yielded` (`meas.outcome=yielded-to-swap`), removes `.rolling`, releases the lock and exits, leaving the session to the swap.
- Modify `ccd/ccd`: `cmd_ensure`, `cmd_start`, `cmd_hibernate`, `cmd_stop` and the mail lane's wake refuse `rolling` while a live `.rolling` exists (a quiet skip for automatic callers); **`cmd_swap` does not**: its synchronous arm answers `dispatched` at once as today (the PWA's swap route runs it through `deps.runCcd` under the agent's 10 s `DEFAULT_EXEC_TIMEOUT_MS`), and only its detached re-run (`CCD_SWAP_DETACHED`), on meeting a live `.rolling`, writes `$REG/<id>.swap-waiting`, polls for `.rolling` to go for at most 270 s (spec §12), then runs and removes the marker (the 2026-10-19 ruling). `.swap-waiting` joins the purge list; its one writer is `cmd_swap`. `_LC_ACTS` (≈:4368) gains `roll`; `cmd_caps` (≈:8487) lists `roll`.
- Modify `deploy/measure-working-state.py` (hibernation Task 19's instrument): its restart and memory baseline skips lifecycle rows tagged `cause=roll` (decision 13's "numbers stay clean"); a fixture test with one roll row and one crash row in `server/test/measure-working-state.test.ts`.
- Create `server/test/ccd-roll-act.test.ts`; modify `server/test/ccd-swap-guards.test.ts` (a swap is never refused for a roll) and `server/test/lifecycle-vocabulary.test.ts`.

- [ ] **Step 0: Re-ground.** Read `cmd_swap`'s detached path and `cmd_hibernate`'s act whole; read `_supervised_start`'s poll and the spawn stamp.
- [ ] **Step 1: Red.** "the caller returns a tx before any kill" (the act is a detached unit; the harness records the `systemd-run` call); "the deliberate row precedes the kill"; "unsupervise precedes the kill"; "the roll never calls `_spawn_settle`"; "a second `_transcript_matches` after the uuid re-read; a missing transcript then refuses and restores"; "success writes `.claude-build` and removes `.rolling`"; "a new build that fails restores onto `from`, strictly, attempt 2"; "an unsmoked `from` restores onto the target"; "rc 5 is `limit-blocked`, not a build failure"; "every journal row carries `cause=roll`"; "`ccd ensure` refuses `rolling` during the act"; "**`ccd swap` during the act answers within the synchronous timeout, its detached re-run waits and then runs; it is never refused**"; "a swap arriving during the restore: the act yields, one start only"; "at 270 s the swap runs"; "an `_idle_for_keystroke` failure after the kill restores onto `from`"; "a changed uuid restores onto `from`"; "`ccd caps` lists `roll`"; "the install lock is held by the act unit's process while the act runs, after the caller has exited, and released after the outcome row"; "the instrument counts the crash row and skips the roll row".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the act run inline (no `_svc_run_detached`) | ccd-roll-act | "returns a tx before any kill" |
  | the deliberate row written after the kill | ccd-roll-act | "precedes the kill" |
  | `_spawn_settle` called by the act | ccd-roll-act | "never calls `_spawn_settle`" |
  | the second transcript check removed | ccd-roll-act | its case |
  | the restore resumes non-strictly | ccd-roll-act | "restores onto `from`, strictly" |
  | `cmd_swap` refuses `rolling` | ccd-swap-guards | "never refused" |
  | `cause=roll` dropped from the outcome row | ccd-roll-act | "carries `cause=roll`" |
  | the shared lock taken in the caller only | ccd-roll-act | "held by the act unit's process" |
  | the yield check removed | ccd-roll-act | "the act yields, one start only" |
  | the swap's synchronous arm waits | ccd-swap-guards | "answers within the synchronous timeout" |
  | the restore fires on rc only | ccd-roll-act | "an `_idle_for_keystroke` failure … restores" |
  | the instrument's `cause=roll` filter dropped | measure-working-state | "skips the roll row" |

- [ ] **Step 4: Verify.** Each suite alone; `bash -n ccd/ccd`.

**Not in this task:** the canary's judgement and soak (CB2e).

### Task CB2e: the canary's health, its soak and the node's own halt (D-5707; spec §10.1, §10.2's local halt) — GATED: after CB2d

**Routing:** band 3, **two reviewers**. **Lane:** AGENT-FIRST (FLEET). **Needs:** CB2d.

**Files:**
- Modify `ccd/ccd`: a roll whose `to` is the node's candidate is a canary (`canary=1` in `.rolling` and the outcome row). At 120 s after the start, the act judges spec §10.1's health; healthy → `.rolling` removed and `$REG/<id>.claude-canary` (`<tx> <node-kind> <to> <startedAt> <oldRssKiB>`) written; the record also carries the pid the roll started; the soak is judged by the box sweep (or the next `ccd roll`'s gate, whichever runs first) at 15 min: no restart whose recorded cause is not an OOM kill of **another** process; an OOM kill whose victim is the canary's own pid → `failed`; that pid gone before 15 min for any other reason → `inconclusive`; peak RSS (`VmHWM` of that pid, from `/proc/<pid>/status`) at most 30% over `oldRssKiB` (the old build's peak); then `_lc_done roll` phase `canary` with `meas.canary=passed|failed|inconclusive`. A swap, hibernation or stop during the soak → `inconclusive`. A failed canary, and a failed restore, append `to` to `~/.ccrc/claude-halted` at once. **A failed soak** removes `.claude-build` and dispatches a strict restore onto `from` (or the pair's target) through CB2d's gated, detached act, subject to `roll-in-flight`, `recent-spawn` and `low-memory`. `.claude-canary` refuses no verb as a lock; only CB2c's `roll-in-flight` reads it, so no second roll starts on the node while a canary soaks.
- Create `server/test/ccd-roll-canary.test.ts`.

- [ ] **Step 0: Re-ground.** Read the box sweep's hook point; confirm `/proc/<pid>/status` is read for no other field than `VmHWM`; read how the lifecycle journal records an OOM victim's pid.
- [ ] **Step 1: Red.** "a canary at an idle prompt on the candidate with the same uuid is healthy at 120 s"; "a settle unfinished at 120 s fails"; "an `exe` build not the candidate fails"; "a shrunk transcript fails"; "a non-OOM restart in the soak fails"; "an OOM restart in the soak does not fail"; "peak RSS 31% over fails, 29% passes"; "an OOM kill of the canary's own pid in the soak fails"; "RSS is judged on the roll's own pid (`VmHWM`), not on a pid restarted later"; "a failed soak restores onto `from` and leaves no `.claude-build`"; "a swap during the soak is `inconclusive` and the swap runs"; "a failed canary appends to `claude-halted`"; "a non-canary roll writes no `.claude-canary`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | health judged by the session's `status` word | ccd-roll-canary | "a settle unfinished at 120 s fails" |
  | OOM restarts counted | ccd-roll-canary | "an OOM restart … does not fail" |
  | the own-pid OOM excused | ccd-roll-canary | "an OOM kill of the canary's own pid" |
  | `VmRSS` of the current pid | ccd-roll-canary | "judged on the roll's own pid" |
  | a failed soak leaves `.claude-build` | ccd-roll-canary | "leaves no `.claude-build`" |
  | the RSS bound 50% | ccd-roll-canary | "31% over fails" |
  | a swap during the soak counted as failed | ccd-roll-canary | "`inconclusive`" |
  | the local halt not written | ccd-roll-canary | "appends to `claude-halted`" |
  | `.claude-canary` read as a lock by `cmd_swap` | ccd-roll-canary | "the swap runs" |

- [ ] **Step 4: Verify.** The suite alone; `bash -n ccd/ccd`.

**Not in this task:** the server's record of a passed canary and `approvedTarget` (CB3d).

### Task CB2f: the roll on the server's vocabulary (D-5708; spec §7.1's agent grant, `CCD_ARGV`, lifecycle act) — GATED: after CB2d, #397 and #700

**Routing:** band 3 (an exec grant). **Lane:** AGENT-FIRST (the agent's whitelist), then server. **Needs:** CB2d; #397 and #700 merged.

**Files:**
- Modify `agent/src/whitelist.ts`: `EXEC_WHITELIST` (≈:396) gains `['roll', '--expect']` beside `['hibernate']` (≈:426), with a 30 s exec timeout for the verb.
- Modify `server/src/ccdargv.ts`: `CCD_ARGV.roll(id, to, token)` beside `hibernate` (≈:323), `REQUIRED_VERB_FLAG` enrolment.
- Modify `shared/api.ts`: `LifecycleAct` (≈:7598) gains `roll` (with `claude`, if CB1c's server half has not added it).
- Modify `server/src/deadCoordinator.ts`: `DEAD_COORDINATOR_DELIBERATE_ACTS` (≈:69) gains `roll`, except a failed roll row (`_lc_fail roll`, or an outcome with `meas.rc` ≠ 0), which is not deliberate.
- Modify `server/test/whitelist-subset.test.ts`, `server/test/ccdargv-brand.test.ts`, `server/test/unattended-actor.test.ts`, `server/test/lifecycle-vocabulary.test.ts`, `server/test/dead-coordinator-policy.test.ts`.

- [ ] **Step 0: Re-ground.** Read how `hibernate` was enrolled (its PR, #594 and #595).
- [ ] **Step 1: Red.** "`CCD_ARGV.roll` is a whitelist subset"; "its brand case"; "a successful roll row is deliberate"; "a failed roll row is not, so the dead-coordinator lane handles the orphan"; "an older server parses `roll` as `unknown`, deliberate"; "the exec timeout is 30 s".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | `--expect` dropped from the grant | whitelist-subset | its case |
  | a failed roll counted deliberate | dead-coordinator-policy | "a failed roll row is not" |
  | the timeout left at 10 s | the whitelist suite | "30 s" |

- [ ] **Step 4: Verify.** Each suite alone; `cd agent && ./node_modules/.bin/tsc --noEmit`; `cd server && ./node_modules/.bin/tsc --noEmit`.

### Task CB2g: the server's roll holds, the action token and the roll route (D-5709; spec §7.2, §7.5, decision 7) — GATED: after CB2f and CB1f

**Routing:** band 3 (mints the token that authorises a restart). **Lane:** server. **Needs:** CB2f; CB1f.

**Files:**
- Modify `server/src/coord/hibernate.ts`: `hibernateVerdict(i, now, afterMs)` (≈:186) takes the opt-out suffix through its input (`optOut: 'no-hibernate' | 'no-roll'`), so the roll and hibernation share one verdict. A new `rollVerdict(i, now, opts)` composes it with the window (`rollAfterMinutes` from the node file, default 90, decision 2; a manual roll passes `manual: true`, which skips only the window, decision 7) and adds the server-side holds: `version-unmeasured`, `version-untrusted` (below `CLAUDE_MIN_BUILD`), `limit-blocked` (the lane's `AccountLimits`, `server/src/limits.ts` ≈:12, at its cap; a lane with no limits source does not hold), `no-roll`, `roll-failed` (a `claude_roll_failures` row exists from CB5b on; absent table, no hold), `swapping` (from the fleet mirror's `lastswap` and swap-unit state for the session), and `roll-in-flight` (a `rolling` or unjudged canary row on the node in the lifecycle mirror).
- Modify `shared/claudeVersion.ts`: `rollFingerprint({ id, uuid, from, to })`, the TypeScript twin of CB2c's `_roll_fingerprint`; create `server/test/fixtures/roll-fingerprint.json` (inputs and tokens) and `server/test/roll-fingerprint-parity.test.ts`, which runs both twins over it (the bash one through the harness).
- Modify `server/src/server.ts`: `POST /api/sessions/:id/roll` beside `/ensure` (≈:2861), operator-cookie gated, body `{ to }`: `404` when `verbSupported(state, CCD_ARGV.roll(...))` is false; `to` = the node's candidate is admitted as a canary **in every wave** whenever `FleetSession.claude.candidate` names it (no passed or failed canary for (node, kind, candidate), newer than the pair's target, not halted); before W3 that is the only roll admitted, otherwise `409 not-yet`; `409 { hold }` for the server's holds and for ccd's exit 3 with its hold name; `409 { refused, reason }` for ccd's exit 4; `409 mode-off` once CB3a's intent exists and the node's mode is `off`; `409 hibernated`, `409 rolling`, `409 not-behind`; on a pass, call `wakeAdmit` as `asked` (counted, never refused: spec §7.4), compute `rollFingerprint` from the server's view, compose the argv through the agent, answer `202 { tx }`. On a `_lc_fail roll` row from the mirror (restore failed, spawn cap, stale recovery failed), notify once through `server/src/update/notify.ts` (kind `update`, opening Settings). `FleetSession.claude.roll` reads `rolling` from a live `.rolling` through the lifecycle mirror.
- Modify `server/src/auth/gate.ts`'s test (`server/test/auth-gate.test.ts`): the route is non-exempt in both directions.
- Create `server/test/roll-verdict.test.ts`, `server/test/roll-route.test.ts`; modify `server/test/hibernate-verdict.test.ts` (every existing case passes `no-hibernate`).

- [ ] **Step 0: Re-ground.** Read `hibernateVerdict`'s input and `HibernateSweepDeps`; read `ws-reclaim`'s token mint.
- [ ] **Step 1: Red.** Each hold by name; "a manual roll skips the window and nothing else" (a `compacting`-free, `crons`-0 session idle 2 min passes manual, holds automatic); "`.no-hibernate` alone does not hold a roll"; "the route answers 404 without the cap"; "a non-canary `to` before W3 answers `not-yet`"; "the canary answers 202 with a tx"; "the route refuses the box token" (operator cookie only); "a swap in flight answers `409 { hold: 'swapping' }` and nothing is sent"; "ccd's exit 3 `low-memory` answers `409 { hold: 'low-memory' }`"; "exit 4 answers `409 { refused }` with the reason"; "a second roll on the node while one is in flight answers `409 { hold: 'roll-in-flight' }`"; "with a target 2.1.302 and an un-canaried candidate 2.1.303, the route admits 2.1.303 as a canary and answers 202; after its canary row, 2.1.303 is refused as a canary"; "a manual roll is counted in `wakeAdmit`"; "a `_lc_fail roll` row notifies once"; "the two fingerprint twins agree on every fixture".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | manual skips the `compacting` hold too | roll-verdict | "skips the window and nothing else" |
  | the opt-out suffix ignored | roll-verdict | "`.no-hibernate` alone does not hold" |
  | the floor dropped | roll-verdict | `version-untrusted` |
  | `not-yet` removed | roll-route | "a non-canary `to` before W3" |
  | the route exempted from the gate | auth-gate | its case |
  | the candidate refused once a target exists | roll-route | "admits 2.1.303 as a canary" |
  | exit 3 mapped to `refused` | roll-route | "`409 { hold: 'low-memory' }`" |
  | `rollFingerprint` drops `uuid` | roll-fingerprint-parity | "agree on every fixture" |
  | the manual roll not counted | roll-route | "counted in `wakeAdmit`" |

- [ ] **Step 4: Verify.** Each suite alone; `tsc --noEmit`.

### Task CB2h: Restart onto 2.1.x, the session command (D-5710; spec §6.3 "The action", §7.5) — GATED: after CB2g, CB1g and S2d

**Routing:** band 2. **Lane:** PWA. **Needs:** CB2g; CB1g; skins W2 **S2d** (`pwa/src/command/commands.ts`'s session commands).

**Files:**
- Modify `pwa/src/command/commands.ts`: a `restart-onto` session command, available while `claude.state` is `behind`, `on-halted` or `ahead`, worded `Restart onto 2.1.302` (or the pinned-back build); and `Restart onto 2.1.303 (canary)` whenever `claude.candidate` is present, in every wave (before W3 it is the only form offered).
- Modify `pwa/src/session/sessionFacts.ts`: the roll phase words (`rolling`, `held: <hold>`, `roll failed, back on 2.1.296`).
- Create `pwa/test/restart-onto.test.tsx`.

- [ ] **Step 1: Red.** "offered for behind, not for current"; "the canary form is offered on a current session whose pair has a `candidate`, and not when it is absent"; "a `409 { hold }` shows the hold's sentence and no override"; "`202` shows `rolling`"; "the command never posts `/ensure`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | offered for `current` | restart-onto | its case |
  | an override button on a hold | restart-onto | "no override" |
  | posts `/ensure` | restart-onto | "never posts `/ensure`" |

- [ ] **Step 4: Per width × skin × mode** (16 cells, W1's §Global constraints): the command in the ⋯ menu and the palette at 360, 390, 1280, 1920, both skins, both modes; the hold sentence wraps inside its sheet.
- [ ] **Step 5: Verify.** `cd pwa && ./node_modules/.bin/tsc --noEmit`; the suite alone.

## Operator acts in this wave

- **OA-2 (before OA-3): M2, read-only, on the fleet node.** How many behind sessions carry `crons` in their turn marker (spec §2.4, §7.2). The ask names the SAFETY rule; nothing is touched. Entered in the ledger.
- **OA-3 (W2a): the first manual canary, per (node, lane kind)** (decisions 3 and 8). With CB2a to CB2h deployed AGENT-FIRST, the operator names one idle behind session of the kind on the node and taps **Restart onto <candidate>**. The ask names the SAFETY rule it is the exception to: no roll of a live session during development; this is the one allowed live action. The coordinator watches, read-only, the outcome row, the canary row at 15 min, and the node's slice and user-tree `anon`, `oom_kill` and pressure in the 2 minutes after (hibernation Task 19's figures). A failed canary halts the build on that node (`claude-halted`); the operator decides the next step. The `anthropic` kind goes first; the `codex` kind is its own OA-3 run on a Codex lane.

## Rollback

The risky wave: rolling the fleet's `ccd` back below CB2a-CB2d while any `.rolling`, `.resume-strict`, `.claude-build`, `.claude-canary` or `.swap-waiting` exists leaves an older `ccd` that ignores them: a session mid-roll has had its `.stopped` removed and is unsupervised, and a rolled session falls back to a lower build (invariant 12). So, in order: (1) `ccd claude roll-disable` on the node; (2) wait until no `$REG/*.rolling` and no unjudged `$REG/*.claude-canary` remains, recovering any stale `.rolling` through the next sweep; (3) roll the server lane back first (CB2g, CB2h: the route then answers `404`), then the fleet lane; (4) keep the unit's `RestartPreventExitStatus` drop-in until no `.rolling` exists; (5) remove leftover `.claude-build` and `.resume-strict` records only through the purge, never by hand. `ccd claude roll-enable` after a fixed `ccd` is redeployed.

## Deviations and decisions

### Issued for this work and defined here

From this programme's block, D-5695 to D-5724, this plan defines D-5703 to D-5710. The spec's §14 cites D-5703, D-5704, D-5705 and D-5709.

- **D-5703** — `strict-resume-and-transcript-preflight` (Task CB2a; spec slug): a ccrc-initiated resume (a roll, a wake after a hibernation) never falls back to `--session-id`: `$REG/<id>.resume-strict`, read inside the unit, makes a failed resume end rc 3 and the row read `orphan`; `cmd_hibernate` gains swap's `_transcript_matches` pre-flight and refuses `no-transcript`; the operator's `ccd start` keeps the fallback; `cmd_hibernate`'s re-measure is factored into `_hib_gate`, which takes the opt-out suffix, so hibernation and the roll share one gate (spec §7.3, §7.2).
- **D-5704** — `roll-spawn-carrier` (Task CB2b; spec slug): `$REG/<id>.rolling`, `.resume-strict` and `.claude-build` are read by `_spawn_start` on every spawn of the unit, systemd's restarts included; at most 2 spawns per roll, then `RestartPreventExitStatus`; a stale `.rolling` is recovered by a strict resume on `from`, never honoured as a carrier; every reader takes `.rolling` over `.stopped` (spec §7.1).
  - **As planned (rev 3):** the canary's soak record `.claude-canary` joins the purge list and the writers' census here, and is read by no verb as a lock.
- **D-5705** — `ccd-roll-verb` (Tasks CB2c, CB2d; spec slug): `ccd roll <id> --to <x.y.z> --expect <token>` is a dedicated same-account restart in place that shares hibernation's gate and act order, with exactly that arity, `--to` re-validated on the node, the token binding `(id, uuid, from, to)` re-proved at the act, `self-roll` refused, the kill switch first, the node-level `roll-in-flight` lock for manual and automatic rolls alike, `hibernation-arming` for `--auto`, the token defined once as `_roll_fingerprint` and its TypeScript twin, the `roll` lifecycle act, and who may roll closed to sessions (D-5696). Its synchronous answer is the gate only (0 dispatched with a tx, 3 a hold, 4 refused) (spec §7.1, §7.6).
  - **As planned (rev 3):** the gate adds the `swapping` hold and never refuses or delays a swap (the 2026-10-19 ruling).
- **D-5706** — `roll-act-detached-and-restore` (Task CB2d): the roll's act always runs in its own transient unit and takes the install lock shared inside that unit, to its outcome; the deliberate row first, unsupervise before the kill, never `_spawn_settle`; the restore onto `from` (or the pair's target) strictly, at most once, on any failed judgement criterion; rc 5 is a limit, not a build fault; every row tagged `cause=roll`, and Task 19's instrument skips those rows (decision 13); `ensure`, `start`, `hibernate`, `stop` and the mail wake refuse `rolling`, while a swap's synchronous answer never waits and its detached re-run waits at most 270 s behind `.swap-waiting`, to which the act yields before any start (spec §7.1, §7.4).
- **D-5707** — `canary-judged-by-ccd` (Task CB2e): a canary is judged by ccd at 120 s (spawn rc 0, `_idle_for_keystroke`, the `exe` build and session file both the candidate, the same uuid, the transcript not shrunk) and then over a 15 min soak, recorded in `$REG/<id>.claude-canary` after `.rolling` is removed (no restart whose cause is not an OOM kill; RSS at most 30% over the old build's); a swap, hibernation or stop during the soak makes it `inconclusive`; an OOM kill of the canary's own pid fails it, and peak RSS is `VmHWM` of the roll's pid; a failed canary or restore halts the build on the node at once in `~/.ccrc/claude-halted`, and a failed soak restores the session (spec §10.1, §10.2; decision 8).
- **D-5708** — `roll-on-the-server-vocabulary` (Task CB2f): `CCD_ARGV.roll`, the agent grant `['roll', '--expect']` with a 30 s timeout (the act is detached), and `roll` in `LifecycleAct` and `DEAD_COORDINATOR_DELIBERATE_ACTS` except a failed roll row, which the dead-coordinator lane handles (spec §7.1).
- **D-5709** — `roll-holds` (Task CB2g; spec slug): the roll's verdict is hibernation's with two parameters changed, the quiet window (90 min by default, decision 2; skipped only by the operator's manual Restart, decision 7) and the opt-out suffix (`.no-roll`, decision 4), plus the named holds `version-unmeasured`, `version-untrusted`, `limit-blocked`, `no-roll`, `roll-failed`, `swapping`, `roll-in-flight` on the server and `low-memory`, `recent-spawn`, `compacting`, `roll-in-flight`, `hibernation-arming` in ccd; `POST /api/sessions/:id/roll` computes the fingerprint, admits a manual canary onto an un-canaried newer candidate in every wave (before W3 the only roll), maps ccd's exit codes to `409 { hold }` and `409 { refused }`, counts the roll in `wakeAdmit`, and notifies once on a failed roll (spec §7.2, §7.5).
- **D-5710** — `restart-onto-command` (Task CB2h): **Restart onto 2.1.x** is a session command posting `/roll`, never `/ensure`, offered for `behind`, `on-halted` and `ahead`, and as **Restart onto 2.1.x (canary)** whenever the pair has an un-canaried newer candidate; a hold is named with no override; the roll's phases are words in `sessionFacts` (spec §6.3, §7.5).

## Out of scope

Automatic rolls (W5); promotion and the target (W3); the server's record of a passed canary (CB3d); any change to `cmd_swap` other than its wait on a live roll; per-session pins chosen by the operator; rolling processes ccrc does not supervise.

## Review log

**rev 0 → rev 1 (2026-10-19).** Two reviews of the spec's rev 3 and the five plans, both NEEDS REVISION. Each finding was checked against `origin/main` `bd363a76b` (the swap route's synchronous `runCcd` under the agent's 10 s timeout, `_svc_run_detached` as `systemd-run --user`, `_spawn_settle` writing the `spawn` stamp after `_accept_first_run_prompts`, `_ws_reclaim_fingerprint` computed by ccd, the instrument with no cause filter). The rows below touch this plan; the spec's §17 carries all of them.

| Finding | Verdict | What changed here |
|---|---|---|
| A newer candidate could never be canaried once a target existed | applied | CB2g admits it as a canary in every wave; CB2h offers the canary form |
| The shared install lock was taken by the exiting caller | applied (both reviews) | CB2d takes it inside the act's unit; the test asserts the holder |
| The action token had no shared definition | applied | CB2c `_roll_fingerprint`, CB2g `rollFingerprint`, a parity test |
| The swap wait's place and bound were undefined | applied (both reviews) | CB2d: the synchronous arm answers at once; the detached re-run waits 270 s behind `.swap-waiting`; the act yields |
| Task 19's instrument did not exclude `cause=roll` | applied | CB2d modifies `measure-working-state.py` and its test |
| Manual rolls had no node-wide serialisation; `recent-spawn` missed settling spawns | applied | CB2b's spawn-start stamp; CB2c's `roll-in-flight` under a node lock; CB2g maps it to `409` and counts `wakeAdmit` |
| `.claude-build` naming a halted build kept; a failed soak never restored | applied | CB2b drops it; CB2e restores on a failed soak |
| U13 enforced only at `roll-live on` | applied | CB2c holds `hibernation-arming` for `--auto` |
| A `.rolling` whose act was killed waited 30 min | applied | CB2b: stale at any age once the holder is gone |
| A canary could pass after OOM-killing itself | applied | CB2e: own-pid OOM fails; `VmHWM` of the roll's pid |
| The restore fired on only some failures | applied | CB2d: any criterion |
| Failed rolls invisible until W5; exit codes and mode `off` unmapped | applied | CB2g: notify once, `409 { hold }`, `409 { refused }`, `409 mode-off` |
| No wave stated its rollback | applied | §Rollback |
