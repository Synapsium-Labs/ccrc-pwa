# Fleet operations: maintenance mode and programme-aware placement — Implementation Plan

> **For agentic workers:** one PR per task, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. **Every ccd task here stops, starts or places sessions in its tests and is band 3, written natively, with the orchestrator reviewing every diff.**

**Spec:** `docs/superpowers/specs/2026-10-20-fleet-operations-maintenance-mode-and-programme--design.md` (rev 0, approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision). It binds this plan in full.

**Issues:** #296 (Tasks FM1 to FM7, FM10's banner half) and #749 (Tasks FP8, FP9, FM10's spread half).

**Status:** rev 0 (2026-10-20). No task has started. No operator act is needed before any task.

**Base:** `origin/main` `4bc6c756d`. Anchors at that sha: `_svc_run_detached` ≈:1051, `SWAP_JITTER` ≈:1346, `RESUME_INTERRUPTED_TURN` ≈:1451, `_reg_purge` ≈:3849, `_ws_seed_home` ≈:4122, `_LC_ACTS` ≈:4368, `_ws_least_loaded` ≈:6648, `cmd_ws_add` ≈:6961 (its `.child` write ≈:7421), `cmd_caps` ≈:8487, `cmd_coord_pause` ≈:9002, `_pool_for` ≈:17289, `_dispatch_swap` ≈:17291, `_limit_score` ≈:17630, `_swap_target` ≈:17788 (its candidate walk ≈:18005-18212), `_auto_swap_check` ≈:18691, `_place_for_class` ≈:19598, `cmd_start` ≈:24121, `cmd_ensure` ≈:24508, `cmd_supervise` ≈:24851, `cmd_swap` ≈:27522 (its detach arm ≈:27717), `cmd_enable` ≈:28054, `cmd_stop` ≈:28106, `cmd_reclaim_pause` ≈:28511 (all `ccd/ccd`); `_upd_lock_holder` ≈:18806 and `_upd_lock` ≈:18855 (`ccd/ccrc`); `COORDINATOR_PAUSE_MARKER` (`server/src/coord/rundefs.ts` ≈:57); `ORPHAN_D_IDLE_MS` and `stallOrphanDInner` (`server/src/coord/stall.ts` ≈:340, ≈:1694); `projectHome` (`server/src/limits.ts` ≈:309); `CCD_ARGV.wsAddWorker` (`server/src/ccdargv.ts` ≈:473).

**Deploy class.** FM1 to FM4 and FP8 are **AGENT-FIRST, FLEET** (`ccd`, the unit file). FM5 is **AGENT-FIRST, FLEET** (`ccrc`, the timer files). FM6, FM7 and FP9 are server. FM10 is PWA. No task needs a supervisor restart of its own: each rides the next ordinary release (no herd).

**Names.** Tasks **FM1** to **FM7** (maintenance), **FP8** and **FP9** (placement), **FM10** (the PWA's two read-only displays).

**Goal, PR by PR.**

| After | What changes for the operator | Underneath |
|---|---|---|
| FM1 | nothing until the switch exists | `$REG/maintenance` read by `start`, `enable`, `ensure`, `ws-add` and `supervise`; the unit's exit status |
| FM2 | nothing visible | swap units named `ccd-swap-<id>-<ms>`, unnamed fallback |
| FM3 | `ccd maintenance on` quiesces the fleet | pauses, manifest, swap drain, stops, tmux placeholder |
| FM4 | `ccd maintenance off` resumes it, paced | the pacer unit, order, shared spawn and memory measures |
| FM5 | `ccrc maintenance` on, off and status: the operator's door | update lock holder, timers by declaration |
| FM6 | the server holds its lanes and shows the state | one switch reader, lane holds, health wire, `409 maintenance` |
| FM7 | idle-over-killed-work sessions are mailed within a minute of resume | `orphan-d`'s deliberate clock |
| FP8 | a programme's children spread over lanes | `.programme` marker, spread rank in both walks, `programme-v1` cap |
| FP9 | the server tells ccd the programme, and counts the spread | dispatch flags, `programmeSpread` on the runs wire |
| FM10 | a maintenance banner, and "N children on K lanes" | PWA renders two server fields |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-20 at `4bc6c756d` (24 open PRs; `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files`).

| Task | Open PRs it waits for | Unlanded plan work it waits for | Gate |
|---|---|---|---|
| FM1 | #435, #722, #740 (all edit `ccd/ccd`) | lifecycle W2 CB2b (adds the unit's `RestartPreventExitStatus=` line this task extends) | after #435, #722, #740 and CB2b |
| FM2 | #435, #722, #740 | none | after #435, #722, #740 |
| FM3 | FM1, FM2 | none | after FM1 and FM2 |
| FM4 | FM3 | lifecycle CB2b (spawn-start stamp) and CB2c (`recent-spawn` and `low-memory` readers, `roll-in-flight`) | after FM3, CB2c |
| FM5 | #722, #740 (both edit `ccd/ccrc`) | FM3 and FM4 (it calls them) | after FM4, #722, #740 |
| FM6 | none (no open PR edits `rundefs.ts`, `stall.ts` or the health route) | FM1 (the refusal word); lifecycle CB2g if the roll route exists by then (its hold list gains `maintenance`); consolidation W1a if landed (the switch becomes a `SWITCHES` row) | after FM1 |
| FM7 | none | FM4 (the `maintenance` phase `resume` lifecycle row) and FM6 (the hold it sits beside) | after FM4 and FM6 |
| FP8 | #435, #722, #740 | none | after #435, #722, #740; independent of FM1 to FM7 |
| FP9 | none (no open PR edits `ccdargv.ts`, `dispatch.ts` or the runs route) | FP8 (`programme-v1` in `ccd caps`) | after FP8 |
| FM10 | #766 (edits `SettingsScreen.tsx`, not ours; listed so the reviewer checks) | FM6, FP9; skins W3 screens' run board (P5) and session header | after FM6, FP9 and skins W3 P5 |

**In flight, and what it fences off.**

| In flight | Files it changes that this plan would otherwise touch | Tasks it gates |
|---|---|---|
| #435 | `ccd/ccd`, `server/test/ccdWsHelpers.ts` | FM1, FM2, FP8 (and FM3 to FM4 through them) |
| #722 | `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh` | FM1, FM2, FM5, FP8 |
| #740 | `ccd/ccd`, `ccd/ccrc` | FM1, FM2, FM5, FP8 |
| #813 | `server/src/coord/openRun.ts` and a tracked-files test refusing private tracker ids | none; every PR here must pass its test |
| #816 | `CLAUDE.md` (the architecture aim) | FM5's CLAUDE.md SAFETY edit rebases on it |

No open PR holds `ccd/claude-session@.service`, `deploy/systemd/*.timer`, `server/src/coord/rundefs.ts`, `server/src/coord/stall.ts`, `server/src/coord/dispatch.ts`, `server/src/ccdargv.ts`, `server/src/limits.ts` or `pwa/src/screens/RunsScreen.tsx`.

## Landing order

```
--- fleet lane, after #435, #722, #740 (AGENT-FIRST) ---
FM2 (swap unit names) ─┐
CB2b ── FM1 (switch, refusals, supervise hold) ─┴─ FM3 (on) ── CB2c ── FM4 (off, paced) ── FM5 (ccrc door, timers)
FP8 (programme marker, spread rank)
--- server lane ---
FM1 ── FM6 (switch reader, holds, wire) ── FM7 (deliberate orphan-d clock, after FM4)
FP8 ── FP9 (dispatch flags, programmeSpread)
--- PWA, after skins W3 P5 ---
FM6 + FP9 ── FM10 (banner, spread line)
```

The fleet half deploys before the server half. A server without FP9 never composes `--programme`; a node without FP8 does not list `programme-v1`, so FP9 composes today's argv (`capSupported`, absent refuses). A server without FM6 sees ccd's `maintenance` refusal as an ordinary refusal; that is noisy but safe, and FM6 closes it.

## Global constraints

- **Fixture HOMEs only, units and panes stubbed.** Every ccd test runs under `makeCcdHarness`, with `systemctl`, `systemd-run` and `tmux` stubbed through the harness's fakes. A test that would reach a real unit, pane or `$HOME` is a STOP. Nobody runs `ccd maintenance` or `ccrc maintenance` against a live box during this programme.
- **No swap is ever refused, cancelled or delayed** (2026-10-19 ruling; spec §5.1). `cmd_swap` gains no refusal; a failed named dispatch retries unnamed; maintenance never stops a `ccd-swap-*` unit; the resume's spacing counts a swap's spawn and never holds one. A test pins each.
- **No herd.** `on` stops one at a time; `off` starts one at a time behind the spawn and memory measures; the supervise hold makes a reboot during maintenance start nothing.
- **One owner per job.** The switch has one reader on each side; the pauses are raised through their own writers; the timers' class lives in the `.timer` files; the spread is a ranking input of ccd's existing walks; the nudge is `orphan-d`'s own arm. A task that adds a second mechanism for any of these is refused in review.
- **Placement without a programme is today's**, byte for byte; `projected-home.test.ts` stays green unchanged.
- **Wire changes are additive** (`maintenance` on health, `spread` on runs, the `maintenance` refusal code). `FLEET_PROTO` is not bumped. Each wire change carries an old/new skew test.
- **Public-repo rule** for every word written: neutral fixtures (`lane-a`, `project-a`), no hosts, accounts, paths under a real home, or private tracker ids.
- **vitest:** one suite at a time, `./node_modules/.bin/vitest run test/<file> --maxWorkers=2`, in the foreground.
- **D-numbers:** this plan was issued D-5950 to D-5959; each task defines exactly one, below. No other number may be defined.

## Review focus (the failure modes most likely to bite)

1. **A swap blocked or cut.** A refusal in `cmd_swap`, a cancelled `ccd-swap-*` unit, a pacer that holds a swap, or a named dispatch that fails without its unnamed retry (FM2, FM3, FM4).
2. **A herd.** Starts not spaced by the spawn-start stamp, a memory floor that skips instead of waits, or a supervisor that restarts in a loop under the switch (FM1, FM4).
3. **A fleet left down.** A crash between `on`'s steps that leaves the switch with nothing to lower it; a pause maintenance did not raise but `off` lowers; a switch removed before the last start (FM3, FM4, FM5).
4. **Hibernation's contract broken.** A hibernated row recorded, woken or stopped by maintenance (FM3, FM4).
5. **A dead verdict on a paused fleet.** The stall watch or the dead-coordinator lane acting on a session maintenance stopped (FM6).
6. **Placement drift.** The spread changing the order when there is no programme, crossing a pool, admitting an overflow lane to the home-able bracket, or running on a stay tick (FP8).
7. **A PWA matcher.** The spread computed in the PWA instead of read from the server (FM10).

---

## Tasks

### Task FM1: the maintenance switch, its refusals and the supervise hold (D-5950; spec §3.3) — GATED: after #435, #722, #740 and CB2b

**Routing:** band 3, native. **Lane:** AGENT-FIRST (FLEET: `ccd`, the unit file).

**Files:**
- Modify `ccd/ccd`:
  - a reader `_maint_state` → `off | on | resuming | unreadable` over `$REG/maintenance` (`<since> <phase> <reason-b64>`), validated; `unreadable` refuses like `on` (fail closed for starts, never for swaps);
  - `cmd_start` (≈:24121), `cmd_enable` (≈:28054), `cmd_ensure` (≈:24508) and `cmd_ws_add` (≈:6961) refuse `maintenance` with exit 4 before anything is journaled, unless `CCD_MAINT_RESUME=1` is set by FM4's pacer (the `CCD_SWAP_DETACHED` pattern; a speed bump, stated as one);
  - `cmd_supervise` (≈:24851) exits with `CCD_MAINT_EXIT` before its ensure when `_maint_state` is not `off` and `CCD_MAINT_RESUME` is unset, journalling `_lc_done maintenance <id>` phase `hold`;
  - `maintenance` joins `_LC_ACTS` (≈:4368).
- Modify `ccd/claude-session@.service`: `CCD_MAINT_EXIT` joins CB2b's `RestartPreventExitStatus=` line and a new `SuccessExitStatus=` line.
- Modify `shared/api.ts`: `maintenance` in `LifecycleAct` and `LIFECYCLE_ACTS`.
- Create `server/test/ccd-maintenance-refuse.test.ts`; modify `server/test/ccd-lifecycle-sites.test.ts` (the new act) and `server/test/ccd-lifecycle-purge.test.ts` if Step 0 finds the unit file pinned there.

- [ ] **Step 0: Re-ground.** Read CB2b's merged unit line and its exit status; choose `CCD_MAINT_EXIT` distinct from it and from every `die` code ccd uses; read `cmd_supervise`, `cmd_ensure` and `cmd_ws_add` whole; read `cmd_swap`, `cmd_prefer` and `cmd_stop` to confirm none calls a refused verb on its own path (swap ends in `_svc_start`, ≈:27966, not `cmd_start`; if its fallback `cmd_ensure` would refuse, it must pass `CCD_MAINT_RESUME` or the fallback is reordered so a swap still starts).
- [ ] **Step 1: Red.** "each of start, enable, ensure and ws-add refuses `maintenance` with exit 4 and touches no unit, pane or registry file"; "an unreadable switch refuses those four too"; "swap, swap-self, prefer, stop, hibernate, coord-pause, reclaim-pause and caps behave identically with and without the switch" (a table over the verbs, output and stub calls compared); "a swap of a stopped row under the switch still starts its unit"; "supervise under the switch exits `CCD_MAINT_EXIT` and never spawns"; "the unit lists `CCD_MAINT_EXIT` in both keys"; "`CCD_MAINT_RESUME=1` lets ensure and supervise through".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the check removed from `cmd_ensure` | ccd-maintenance-refuse | "ensure … refuses `maintenance`" |
  | the check added to `cmd_swap` | ccd-maintenance-refuse | "swap … behave identically" |
  | `unreadable` folded into `off` | ccd-maintenance-refuse | "an unreadable switch refuses" |
  | the supervise check after the ensure | ccd-maintenance-refuse | "never spawns" |
  | `SuccessExitStatus=` line dropped | ccd-maintenance-refuse | "both keys" |
  | the check placed after the first journal row | ccd-maintenance-refuse | "touches no … registry file" |

- [ ] **Step 4: Verify.** Each suite of Step 3 alone, then `ccd-swap.test.ts`, `ccd-supervised-start.test.ts`, `ccd-ws-add-child.test.ts` alone, then `bash -n ccd/ccd` and `ccrc restamp` after the rebase.

**Review focus:** 1, 2. **Not in this task:** `on` and `off` (FM3, FM4).

### Task FM2: named swap units, never a blocked swap (D-5951; spec §3.5) — GATED: after #435, #722, #740

**Routing:** band 3, native (the swap path). **Lane:** AGENT-FIRST (FLEET: `ccd`).

**Files:**
- Modify `ccd/ccd`: `_svc_run_detached` (≈:1051) takes an optional leading `--name <unit>`; on Linux it runs `systemd-run --user --collect --quiet --unit=<unit>`, and on a non-zero answer retries once without `--unit`; on darwin the name is ignored. `_dispatch_swap` (≈:17291) and `cmd_swap`'s detach arm (≈:27717) pass `--name ccd-swap-<id>-<epoch-ms>`. A helper `_swap_units_active <id>` lists that id's active or activating swap units.
- Create `server/test/ccd-swap-unit-name.test.ts`.

- [ ] **Step 0: Re-ground.** Read `_reg_id_ok` and confirm the id grammar is inside systemd's unit-name characters; if not, build the name through `systemd-escape`. Read the harness's `systemd-run` stub.
- [ ] **Step 1: Red.** "a dispatched swap passes `--unit=ccd-swap-<id>-<ms>`"; "when the named start fails, the swap is dispatched again unnamed and its log line says so"; "when both fail, the existing `systemd-run failed. Nothing was moved` refusal fires"; "darwin ignores the name"; "`_swap_units_active` lists only that id's units"; every case of `ccd-swap.test.ts` green.
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the unnamed retry removed | ccd-swap-unit-name | "dispatched again unnamed" |
  | the name without the `-<ms>` suffix | ccd-swap-unit-name | "passes `--unit=ccd-swap-<id>-<ms>`" |
  | the prefix match widened to all swaps | ccd-swap-unit-name | "only that id's units" |

- [ ] **Step 4: Verify.** The suite alone, then `ccd-swap.test.ts`, `ccd-swap-refuse.test.ts`, `ccd-auto-swap-hold.test.ts` alone; `bash -n ccd/ccd`.

**Review focus:** 1.

### Task FM3: `ccd maintenance on` (D-5952; spec §3.4) — GATED: after FM1 and FM2

**Routing:** band 3, native, **two reviewers** (stops every session). **Lane:** AGENT-FIRST (FLEET: `ccd`).

**Files:**
- Modify `ccd/ccd`: `cmd_maintenance on [--reason <text>] [--swap-wait <s>]` and `status`; refuses with `CLAUDECODE` set, inside a `cc-*` pane, and on darwin (`unsupported-platform`). In order: refuse a second `on` as `already` (exit 0); write `$REG/maintenance` through `_reg`-style staged rename; raise each lowered pause through its own writer (`cmd_coord_pause --state on`, `cmd_reclaim_pause --state on`, `~/.ccrc/tmp-sweep-paused`), recording which; write `$REG/.maintenance-manifest` (id, role, status, `bg`) for active or activating units, excluding `.hibernated` and `.stopped` rows; for each row wait on `_swap_units_active` up to `--swap-wait` (default 300), marking a row still swapping `skipped: swap-in-flight`; create the placeholder tmux session `ccd-maintenance`; stop each remaining row through `cmd_stop`'s path with `cause=maintenance`; report.
- Modify `ccd/ccd` `cmd_caps` (≈:8487): lists `maintenance`.
- Create `server/test/ccd-maintenance-on.test.ts`.

- [ ] **Step 0: Re-ground.** Read `cmd_stop` whole and how it journals its cause; read the pause writers; read how the hook writes `bg` in the turn marker (`session-hook.sh` ≈:3286-3294) and the reader ccd already has for it.
- [ ] **Step 1: Red.** "the switch exists before the first stop"; "a pause already raised is not recorded as maintenance's"; "hibernated and stopped rows are not in the manifest and are not touched"; "a row whose swap unit is active is waited for, then stopped"; "a row still swapping at the bound is skipped and left running"; "the placeholder exists before the first pane is killed"; "a second `on` changes nothing"; "inside a session it refuses"; "the manifest records role from `.programme` and `.child` (FP8 absent: every row reads `plain` or `child`)".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the switch written after the stops | ccd-maintenance-on | "exists before the first stop" |
  | every pause recorded as raised | ccd-maintenance-on | "not recorded as maintenance's" |
  | the hibernated filter removed | ccd-maintenance-on | "hibernated … not touched" |
  | the swap wait replaced by a unit stop | ccd-maintenance-on | "waited for, then stopped" |
  | the bound stops the swapping row | ccd-maintenance-on | "skipped and left running" |
  | the placeholder created last | ccd-maintenance-on | "before the first pane is killed" |

- [ ] **Step 4: Verify.** The suite alone, then `ccd-coord-pause.test.ts` and `ccd-child-reclaim-pause.test.ts` alone; `bash -n ccd/ccd`.

**Review focus:** 1, 3, 4.

### Task FM4: `ccd maintenance off`, paced (D-5953; spec §3.6) — GATED: after FM3 and CB2c

**Routing:** band 3, native, **two reviewers** (starts every session). **Lane:** AGENT-FIRST (FLEET: `ccd`).

**Files:**
- Modify `ccd/ccd`: `cmd_maintenance off [--stagger <s>] [--wait]`: set the switch's phase to `resuming`; start the pacer `ccd maintenance _resume` in its own unit through `_svc_run_detached --name ccd-maintenance-resume` (refuse a second pacer while that unit is active); `--wait` follows the unit to its end. The pacer orders the manifest (mid-turn, `bg > 0`, coordinators, rest; coordinators first within a tier; stable), and before each start waits for CB2c's `recent-spawn` reader with the window `--stagger` (default 25, minimum 10), its `low-memory` measure (3 GiB, re-measure every 10 s, never skip), and no `roll-in-flight`. Each start is `CCD_MAINT_RESUME=1 _svc_start claude-session@<id>` for a row not already active, journalled `_lc_done maintenance <id>` phase `resume`. After the last: lower only the recorded pauses, kill the placeholder, remove the manifest and then the switch, journal phase `done`, print the `bg > 0` rows.
- Modify CB2c's `recent-spawn` reader to take its window as a parameter (the roll keeps 120); do not copy it.
- Modify CB2c's roll gate: a `maintenance` hold while the switch stands.
- Create `server/test/ccd-maintenance-off.test.ts`.

- [ ] **Step 0: Re-ground.** Read CB2b's spawn-start stamp, CB2c's `recent-spawn`, `low-memory` and `roll-in-flight` as merged.
- [ ] **Step 1: Red.** "the start order is mid-turn, `bg > 0`, coordinators, rest, coordinators first within a tier"; "no start within `--stagger` of any spawn start, a swap's included"; "below the memory floor the pacer waits and then starts the same row"; "a row already active is skipped"; "only recorded pauses are lowered"; "the switch is removed after the last start"; "a roll holds `maintenance` while the switch stands"; "the roll's own `recent-spawn` still uses 120 s"; "a second `off` while the pacer runs refuses"; "the pacer runs in its own unit".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | tiers reversed | ccd-maintenance-off | "the start order" |
  | the spacing reads the settle stamp, not the start stamp | ccd-maintenance-off | "a swap's included" |
  | the memory wait skips the row | ccd-maintenance-off | "starts the same row" |
  | every pause lowered | ccd-maintenance-off | "only recorded pauses" |
  | the switch removed before the starts | ccd-maintenance-off | "after the last start" |
  | the roll window replaced by the stagger | the roll's gate suite | "still uses 120 s" |

- [ ] **Step 4: Verify.** The suite alone, then the roll gate suite CB2c created, alone; `bash -n ccd/ccd`.

**Review focus:** 1, 2, 3, 4.

### Task FM5: `ccrc maintenance`, the operator's door (D-5954; spec §3.4, §3.7, §3.8) — GATED: after FM4, #722 and #740

**Routing:** band 3, native. **Lane:** AGENT-FIRST (FLEET: `ccrc`, timers).

**Files:**
- Modify `ccd/ccrc`: `cmd_maintenance on|off|status`. `on`: take `~/.ccrc/update.lock` through `_upd_lock` with a holder record `maintenance <since> <reason>` (refuse while an update holds it); stop each installed timer whose unit file declares `X-Ccrc-Maintenance=stop`, recording which; call `ccd maintenance on`; on failure restart the recorded timers and release the lock. `off`: run one detached unit `ccrc-maintenance-off` that calls `ccd maintenance off --wait`, restarts the recorded timers and releases the lock. `_upd_lock_holder` (≈:18806) names a maintenance holder as such. Refused inside a session and a `cc-*` pane.
- Modify every `deploy/systemd/*.timer` (14 files): one `X-Ccrc-Maintenance=keep|stop` line in `[Unit]`, as spec §3.7 lists.
- Modify `CLAUDE.md` SAFETY: `ccd maintenance` and `ccrc maintenance` are the operator's acts, never a session's.
- Create `server/test/ccrc-maintenance.test.ts`; modify `server/test/ccrc-update.test.ts` (the lock holder reads `maintenance`).

- [ ] **Step 0: Re-ground.** Read `_upd_lock`, `_upd_lock_holder` and the timer installer; read #816's CLAUDE.md as merged.
- [ ] **Step 1: Red.** "every shipped timer declares exactly one `X-Ccrc-Maintenance` value, and `ccd-pool-sync` and `ccd-cap-scopes` declare `keep`"; "`on` stops exactly the `stop` timers and `off` restarts exactly those"; "`on` refuses while an update holds the lock"; "`ccrc update` under maintenance refuses naming maintenance as the holder"; "a failed ccd half restarts the timers and releases the lock"; "`off` runs in its own unit".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | a timer file's declaration removed | ccrc-maintenance | "exactly one … value" |
  | the pool-sync timer declared `stop` | ccrc-maintenance | "`ccd-pool-sync` … `keep`" |
  | the lock taken over an update | ccrc-maintenance | "refuses while an update holds the lock" |
  | the failure path leaves timers stopped | ccrc-maintenance | "restarts the timers" |

- [ ] **Step 4: Verify.** The suite alone, then `ccrc-update.test.ts`, `ccrc-install.test.ts` and `ccrc-doctor.test.ts` alone; `bash -n ccd/ccrc`.

**Review focus:** 3.

### Task FM6: the server's switch reader, lane holds and wire (D-5955; spec §3.9) — GATED: after FM1

**Routing:** band 3, native (holds on destructive and wake lanes). **Lane:** server.

**Files:**
- Modify `server/src/coord/rundefs.ts`: `MAINTENANCE_MARKER` beside `COORDINATOR_PAUSE_MARKER` and one reader `maintenanceState(listing)` → `{ since, phase, reason } | null | 'unreadable'` (or, if consolidation W1a has merged, a `SWITCHES` row and its reader instead; record which in §Deviations).
- Modify the tick (`server/src/watch.ts`) to read it once and pass it to: the mail lane's wake, the hibernation and stop-done lanes, the stall sweep (`stallSessionHold` gains `maintenance` for manifest rows, `server/src/coord/stall.ts`), the dead-coordinator lane, and the roll route and auto-roll if present. Each holds quietly; none notifies.
- Modify the Restart/ensure route and the roll route: `409 { refused: 'maintenance' }`, both pre-checked and mapped from ccd's word.
- Modify `shared/api.ts`: `maintenance` on the fleet-health wire (additive, absent = none); `'maintenance'` in the refusal vocabulary.
- Create `server/test/maintenance-holds.test.ts`; modify `server/test/fleet-health.test.ts`, `server/test/stall-session.test.ts`, `server/test/dead-coordinator-lane.test.ts`, `server/test/single-definition.test.ts` (one marker definition, one reader).

- [ ] **Step 0: Re-ground.** Census every lane and route that composes `ensure`, `start`, `ws-add` or `roll`, and every lane that judges a session dead or stalled; the census is the test's table. Check whether consolidation W1a has merged.
- [ ] **Step 1: Red.** "each censused lane holds under the switch and acts without it"; "the stall watch records no rung for a manifest row while the switch stands"; "the dead-coordinator lane takes no step for a stopped coordinator under the switch"; "the routes answer `409 { refused: 'maintenance' }`"; "health carries `maintenance`"; skew: "an old PWA ignores the field; a new PWA reads its absence as none".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the wake lane ignores the switch | maintenance-holds | its row |
  | the stall hold removed | stall-session | "no rung for a manifest row" |
  | a second marker literal in `watch.ts` | single-definition | its scan |
  | `unreadable` folded into `null` | maintenance-holds | "unreadable holds" |

- [ ] **Step 4: Verify.** Each suite alone.

**Review focus:** 5.

### Task FM7: `orphan-d`'s deliberate clock (D-5956; spec §3.10) — GATED: after FM4 and FM6

**Routing:** band 3, native (stall verdicts). **Lane:** server.

**Files:**
- Modify `server/src/coord/stall.ts`: `ORPHAN_D_DELIBERATE_IDLE_MS = 60_000` beside `ORPHAN_D_IDLE_MS`; `StallSessionInput` gains the restart's cause (the newest lifecycle row for the session at or before `restartAt`, read through the lifecycle mirror); `stallOrphanDInner` (≈:1694) uses the deliberate clock when that row is `maintenance` phase `resume`. Arming, holds, rungs, subject and key unchanged.
- Modify the stall sweep's input builder to supply the cause.
- Modify `server/test/stall-verdict.test.ts`, `server/test/stall-session.test.ts`.

- [ ] **Step 0: Re-ground.** Read how `restartAt` is written and which lifecycle rows the mirror carries.
- [ ] **Step 1: Red.** "a `maintenance`-caused restart with `lostBg > 0` notifies after 60 s idle"; "any other restart still waits 15 minutes"; "shadow stays shadow at every arming level"; "`mail-disabled` still holds".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the deliberate clock for every cause | stall-verdict | "any other restart still waits" |
  | the deliberate clock bypassing the arming | stall-verdict | "shadow stays shadow" |
  | the cause read after `restartAt` | stall-verdict | "notifies after 60 s" |

- [ ] **Step 4: Verify.** Each suite alone.

**Review focus:** 5.

### Task FP8: the programme marker and the spread rank (D-5957; spec §4.2 to §4.4) — GATED: after #435, #722, #740

**Routing:** band 3, native (placement and the swap walk). **Lane:** AGENT-FIRST (FLEET: `ccd`).

**Files:**
- Modify `ccd/ccd`:
  - `cmd_ws_add` (≈:6961): `--programme <rootRunId>` and `--coordinator <id>`, stripped with the other flags, both required together, validated (`_child_runid_valid`, `_reg_id_ok`); written as `$REG/<id>.programme` by `_reg_set` beside the `.child` write (≈:7421);
  - `_programme_members_on <id>` → one assoc array lane → count, from one glob of `$REG/*.programme` with builtins only, memoised per walk; malformed markers ignored;
  - `_spread_key <lane> <score>` → the composite rank (tier, members, score), `SPREAD_SCORE_MAX=80` beside `SWAP_CEILING` (≈:1338);
  - `_ws_least_loaded` (≈:6648) takes an optional programme id and ranks by `_spread_key`; `_place_for_class` passes it; `_swap_target`'s candidate walk (≈:18005-18212) ranks by `_spread_key` within each bracket. No other arm of `_swap_target` or `_auto_swap_check` changes;
  - `cmd_caps` lists `programme-v1`.
- Create `server/test/ccd-programme-spread.test.ts`; modify `server/test/ccd-ws-add-child.test.ts`, `server/test/ccd-tick-budget.test.ts` (a stay tick reads no marker; a walk reads at most the marker count), `server/test/ccd-lifecycle-purge.test.ts` (`.programme` purges with the row).

- [ ] **Step 0: Re-ground.** Read both walks whole; read `projected-home.test.ts` and `fixtures/leastLoaded.ts`; read the tick-budget fixture.
- [ ] **Step 1: Red.** "N children with K free healthy lanes use min(N, K) lanes before reusing one"; "the first child avoids the coordinator's lane when another eligible healthy lane exists"; "a swap prefers a lane without members and still swaps when every lane has one"; "home affinity is unchanged after placement (stay, return, rehome)"; "no marker: the order equals today's on the projected-home fixture"; "a malformed marker: today's order"; "pools, kill switches and the class gate filter first; an overflow lane never enters the home-able bracket"; "a lane above 80% loses to a fuller-of-members lane below it"; "a stay tick reads no marker".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | members ranked before tier | ccd-programme-spread | "above 80% loses" |
  | the coordinator not counted | ccd-programme-spread | "avoids the coordinator's lane" |
  | the spread drops a full lane | ccd-programme-spread | "still swaps when every lane has one" |
  | the member scan before the stay arms | ccd-tick-budget | "a stay tick reads no marker" |
  | `.programme` left out of the purge | ccd-lifecycle-purge | its row |
  | the spread applied with no programme given | projected-home | its parity |

- [ ] **Step 4: Verify.** Each suite alone, then `projected-home.test.ts`, `ccd-swap-target-class.test.ts`, `ccd-auto-swap-pool.test.ts` alone; `bash -n ccd/ccd`.

**Review focus:** 1, 6.

### Task FP9: dispatch passes the programme; the server counts the spread (D-5958; spec §4.2, §4.5) — GATED: after FP8

**Routing:** band 2 (spec-able; review native). **Lane:** server.

**Files:**
- Modify `server/src/ccdargv.ts`: `wsAddWorker` takes an optional `programme: { rootRunId, coordinatorId } | null` and composes `--programme`/`--coordinator` only when non-null.
- Modify `server/src/coord/dispatch.ts`: passes it when the node's caps list `programme-v1` (`capSupported`), with `rootRunId` the lowest run id the dispatching coordinator holds as `claimedBy`.
- Create `server/src/coord/programmeSpread.ts` (L1, pure): `programmeSpread(runs, sessions)` → per `claimedBy`: `{ children, lanes, coordinatorShares }`.
- Modify the runs route and `shared/api.ts`: additive `spread` on the runs projection.
- Create `server/test/programme-spread.test.ts`; modify `server/test/dispatch-child-argv.test.ts`, `server/test/ccdargv-brand.test.ts`.

- [ ] **Step 0: Re-ground.** Read the store's binding reader for a run's worker, and the runs route's projection.
- [ ] **Step 1: Red.** "a programme of four children on three lanes reads `{children: 4, lanes: 3}`"; "`coordinatorShares` is true when a child shares the coordinator's lane"; "a node without `programme-v1` gets today's argv exactly"; "a node with it gets both flags"; skew: "an old PWA ignores `spread`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | flags composed without the cap | dispatch-child-argv | "today's argv exactly" |
  | lanes counted per run, not distinct | programme-spread | "three lanes" |
  | `rootRunId` the newest run | dispatch-child-argv | its row |

- [ ] **Step 4: Verify.** Each suite alone.

**Review focus:** 6, 7.

### Task FM10: the maintenance banner and the spread line (D-5959; spec §3.9, §4.5) — GATED: after FM6, FP9 and skins W3 P5

**Routing:** band 2 (literal render of two fields; review native). **Lane:** PWA.

**Files:**
- Create `pwa/src/fleet/MaintenanceBanner.tsx` beside the other banners (`HaltBanner.tsx`, `CoordBanner.tsx`), mounted where they mount; it renders `health.maintenance` (since, phase, reason, resumed count) and nothing on absence.
- Modify the run board's programme group header (`pwa/src/screens/RunsScreen.tsx` or the component skins W3 P5 lands) to render `spread`: "4 children on 3 lanes", "· coordinator shares a lane".
- Modify the session header: a manifest row shows "stopped for maintenance since T"; a coordinator shows its programme's spread. Cards unchanged.
- Create `pwa/test/maintenance-banner.test.tsx`; modify `pwa/test/runs-screen.test.tsx`.

- [ ] **Step 0: Re-ground.** Read skins W3 P5's board and header as merged.
- [ ] **Step 1: Red.** "no field, no banner"; "the banner shows since, reason and `resuming 12 of 41`"; "the programme header shows the spread line"; "the coordinator header shows it and the card does not"; the width-and-skin matrix: 360, 390, 1280, 1920 × refined, instrument × dark, light, no overflow, no truncation.
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | banner shown on absence | maintenance-banner | "no field, no banner" |
  | spread computed in the PWA from runs and sessions | runs-screen | the "reads `spread` only" row |
  | header drops the spread | runs-screen | "the coordinator header shows it" |

- [ ] **Step 4: Verify.** Each suite alone; `cd pwa && npm run test` typecheck leg.

**Review focus:** 7.

---

## Operator acts in this programme

None is required to build or merge any task. Using maintenance on the fleet is the operator's own act, by `ccrc maintenance on|off` from a shell, after FM5 deploys AGENT-FIRST.

## Rollback

Each task is a plain revert. Before rolling the fleet's ccd back below FM1 to FM4, run `ccrc maintenance off` (or `ccd maintenance off --wait`) and confirm `ccd maintenance status` reads `off`: an older ccd ignores `$REG/maintenance` and a stopped fleet would stay stopped with nothing paced to start it. An older ccd ignores `.programme` markers and places as today.

## Deviations and decisions

### Issued for this work and defined here

This programme was issued D-5950 to D-5959; this plan defines all ten, one per task.

- **D-5950** — `maintenance-switch-and-refusals` (Task FM1; spec §3.3): `$REG/maintenance` makes `start`, `enable`, `ensure` and `ws-add` refuse `maintenance` and `supervise` exit with a status the unit neither restarts nor marks failed; `swap`, `swap-self` and `prefer` are never refused (the 2026-10-19 ruling), and an unreadable switch refuses starts only.
- **D-5951** — `swap-unit-names` (Task FM2; spec §3.5): swap units are named `ccd-swap-<id>-<epoch-ms>` so maintenance can wait for them, and a failed named start retries unnamed, so naming never blocks a swap.
- **D-5952** — `maintenance-on` (Task FM3; spec §3.4): the switch first, only lowered pauses raised and recorded, a manifest of active rows excluding hibernated and stopped ones, swaps waited for and never cancelled (a row still swapping at the bound is skipped and left running), a tmux placeholder, then stops one at a time.
- **D-5953** — `maintenance-off-paced` (Task FM4; spec §3.6): a detached pacer starts the manifest mid-turn first, then `bg > 0`, coordinators, the rest, behind the roll's spawn-start spacing (window 25 s, a parameter of the one reader), its memory floor and `roll-in-flight`, never holding a swap; only maintenance's own pauses are lowered and the switch goes last.
- **D-5954** — `ccrc-maintenance-door` (Task FM5; spec §3.4, §3.7, §3.8): `ccrc maintenance` holds the update lock with a named holder, stops the timers whose unit file declares `X-Ccrc-Maintenance=stop`, and calls ccd; it is the operator's act, never a session's.
- **D-5955** — `maintenance-server-holds` (Task FM6; spec §3.9): one server reader of the switch beside `COORDINATOR_PAUSE_MARKER` (or a `SWITCHES` row once that exists); every wake, restart and dead-or-stalled lane holds quietly under it; health carries it additively.
- **D-5956** — `orphan-d-deliberate-clock` (Task FM7; spec §3.10): `orphan-d` waits 60 s instead of 15 minutes when the restart's lifecycle cause is `maintenance` phase `resume`; its arming and everything else are unchanged.
- **D-5957** — `programme-spread-rank` (Task FP8; spec §4.2 to §4.4): `$REG/<id>.programme` (`<rootRunId> <coordinatorId>`) written by `ws-add`; both placement walks rank by (tier, members on the lane, score) with a tier boundary at 80, a preference that never removes a candidate and runs only inside the walk.
- **D-5958** — `programme-dispatch-and-spread-count` (Task FP9; spec §4.2, §4.5): dispatch passes the programme behind `programme-v1`; the server's pure `programmeSpread` counts each programme's children and distinct lanes on the runs wire.
- **D-5959** — `maintenance-and-spread-display` (Task FM10; spec §3.9, §4.5): a read-only maintenance banner and the "N children on K lanes" line, both rendered from server fields, cards unchanged and headers the superset.

## Out of scope

Pacing the cold-boot start; a PWA or agent control for maintenance; arming stall-watch wave 2 or changing `orphan-d` for swaps and revivals; waiting for turns to end before `on`; moving running sessions to improve a spread; a server swap suggestion for the SwapSheet; maintenance on macOS nodes.
