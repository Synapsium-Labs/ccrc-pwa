# Fleet operations: maintenance mode and programme-aware placement — Implementation Plan

> **For agentic workers:** one PR per task, each dispatched only when its row in §Gates is all green. To execute a task, REQUIRED SUB-SKILL: superpowers:subagent-driven-development, with superpowers:test-driven-development for every red-first step. Steps use checkbox (`- [ ]`) syntax. **Every ccd task here stops, starts or places sessions in its tests and is band 3, written natively, with the orchestrator reviewing every diff.**

**Spec:** `docs/superpowers/specs/2026-10-20-fleet-operations-maintenance-mode-and-programme--design.md` (rev 2, approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision). It binds this plan in full.

**Issues:** #296 (Tasks FM1 to FM7, FM10's banner half) and #749 (Tasks FP8, FP9, FM10's spread half).

**Status:** rev 2 (2026-10-20): the first review's seventeen findings (rev 1) and the second review's seventeen (rev 2) applied (§Review log). No task has started. No operator act is needed before any task.

**Base:** `origin/main` `4bc6c756d`. Anchors at that sha: `_svc_run_detached` ≈:1051, `SWAP_JITTER` ≈:1346, `RESUME_INTERRUPTED_TURN` ≈:1451, `_reg_purge` ≈:3849, `_ws_seed_home` ≈:4122, `_ws_unsupervise` ≈:4156, `_svc_start` ≈:906, `_LC_ACTS` ≈:4368, `_ws_least_loaded` ≈:6648, `cmd_ws_add` ≈:6961 (its `.child` write ≈:7421), `cmd_caps` ≈:8487, `cmd_coord_pause` ≈:9002, `_pool_for` ≈:17289, `_dispatch_swap` ≈:17291, `_limit_score` ≈:17630, `_swap_target` ≈:17788 (its candidate walk ≈:18005-18212), `_auto_swap_check` ≈:18691, `_place_for_class` ≈:19598, `_supervised_start` ≈:23969, `cmd_start` ≈:24121, `cmd_ensure` ≈:24508, `cmd_supervise` ≈:24851, `cmd_swap` ≈:27522 (its detach arm ≈:27717), `cmd_enable` ≈:28054, `cmd_stop` ≈:28106, `cmd_reclaim_pause` ≈:28511 (all `ccd/ccd`); `_upd_lock_holder` ≈:18806 and `_upd_lock` ≈:18855 (`ccd/ccrc`); `COORDINATOR_PAUSE_MARKER` (`server/src/coord/rundefs.ts` ≈:57); `DEAD_COORDINATOR_DELIBERATE_ACTS` (`server/src/deadCoordinator.ts` ≈:69); the `lifecycle-stopped` hold (`server/src/coord/stall.ts` ≈:1087); `ORPHAN_D_IDLE_MS` and `stallOrphanDInner` (`server/src/coord/stall.ts` ≈:340, ≈:1694); `projectHome` (`server/src/limits.ts` ≈:309); `CCD_ARGV.wsAddWorker` (`server/src/ccdargv.ts` ≈:473).

**Deploy class.** FM1 to FM4 and FP8 are **AGENT-FIRST, FLEET** (`ccd`, the unit file). FM5 is **AGENT-FIRST, FLEET** (`ccrc`, the timer files). FM6, FM7 and FP9 are server. FM10 is PWA. No task needs a supervisor restart of its own: each rides the next ordinary release (no herd). **FM3 and FM4 land as one PR** (two commits, two D-numbers), so no release ever carries `ccd maintenance on` without its `off`; `maintenance` joins `cmd_caps` in FM4's commit, and a test pins that `cmd_caps` lists it only beside a working `off`.

**Names.** Tasks **FM1** to **FM7** (maintenance), **FP8** and **FP9** (placement), **FM10** (the PWA's two read-only displays).

**Goal, PR by PR.**

| After | What changes for the operator | Underneath |
|---|---|---|
| FM1 | nothing until the switch exists | `$REG/maintenance` read by `start`, `enable`, `ensure`, `ws-add` and `supervise`; the unit's exit status |
| FM2 | nothing visible | swap units named `ccd-swap-<id>-<ms>`, unnamed fallback |
| FM3 + FM4 (one PR) | `ccd maintenance on` quiesces the fleet and `ccd maintenance off` resumes it, paced | write-ahead manifest, pauses, swap and roll drain, stops, tmux placeholder; the pacer unit, order, `cmd_start`'s path, shared spawn and memory measures |
| FM5 | `ccrc maintenance` on, off and status: the operator's door | update lock for each command, `ccrc update` refuses under the switch, timers by declaration |
| FM6 | the server holds its start lanes and shows the state | a `SWITCHES` row and one content reader (switch and manifest), start-lane holds, `maintenance` a deliberate act, health wire, `409 maintenance` |
| FM7 | idle-over-killed-work sessions are mailed within a minute of resume | `orphan-d`'s deliberate clock |
| FP8 | a programme's children spread over lanes | `.programme` marker, spread rank in both walks, `programme-v1` cap |
| FP9 | the server tells ccd the programme, and counts the spread | dispatch flags, `programmeSpread` on the runs wire |
| FM10 | a maintenance banner, and "N children on K lanes" | PWA renders two server fields |

---

## Gates: what each task waits for, stated honestly

Measured on 2026-10-20 at `4bc6c756d` (27 open PRs; `gh pr list -R Synapsium-Labs/ccrc-pwa --state open --json number,title,files`). Re-run the census at each task's Step 0.

| Task | Open PRs it waits for | Unlanded plan work it waits for | Gate |
|---|---|---|---|
| FM1 | #435, #722, #740 (all edit `ccd/ccd`); #821 (edits `shared/api.ts`: rebase on it, or a line-disjointness check) | lifecycle W2 CB2b (adds the unit's `RestartPreventExitStatus=` line this task extends) | after #435, #722, #740 and CB2b; #821 checked |
| FM2 | #435, #722, #740 | none | after #435, #722, #740 |
| FM3 + FM4 (one PR) | none beyond FM1's | FM1, FM2; lifecycle CB2b (spawn-start stamp), CB2c (`recent-spawn`, `low-memory`, `roll-in-flight`, the roll node lock) and CB2d (`.rolling` and the roll's act, which FM3 waits for and which writes the pass) | after FM1, FM2, CB2c and CB2d |
| FM5 | #722, #740 (both edit `ccd/ccrc`); #434 and #830 (both edit `CLAUDE.md`) | FM3 + FM4 (it calls them) | after FM3 + FM4, #722, #740; #434 and #830 checked for the SAFETY edit (rebased on, or line-disjoint) |
| FM6 | #821 (edits `server/src/watch.ts` and `shared/api.ts`; consolidation rule 6: one `watch.ts` series at a time); #737 (edits `server/test/single-definition.test.ts`) | FM1 (the refusal word, the `maintenance` act); FM3 + FM4 (they define the manifest grammar FM6 parses); consolidation W1a C1a and C1b (D-5855, D-5856: `shared/switches.ts`, `readSwitches`, and their rewrite of `rundefs.ts` and `watch.ts`); lifecycle CB2g if the roll route exists by then (its hold list gains `maintenance`) | after FM1, FM3 + FM4, C1b and #821; #737 checked |
| FM7 | none | FM4 (the `maintenance` phase `resume` lifecycle row) and FM6 | after FM3 + FM4 and FM6 |
| FP8 | #435, #722, #740 | none | after #435, #722, #740; independent of FM1 to FM7 (if FM3 + FM4 landed first, FP8 also switches FM3's manifest role to its `_programme_read`) |
| FP9 | #821 (edits `shared/api.ts`) | FP8 (`programme-v1` in `ccd caps`) | after FP8; #821 checked |
| FM10 | none | FM6, FP9; skins W3 screens' run board (P5) and session header | after FM6, FP9 and skins W3 P5 |

**In flight, and what it fences off.**

| In flight | Files it changes that this plan would otherwise touch | Tasks it gates |
|---|---|---|
| #435 | `ccd/ccd`, `server/test/ccdWsHelpers.ts` | FM1, FM2, FP8 (and FM3 + FM4 through them) |
| #722 | `ccd/ccd`, `ccd/ccrc`, `ccd/session-hook.sh` | FM1, FM2, FM5, FP8 |
| #740 | `ccd/ccd`, `ccd/ccrc` | FM1, FM2, FM5, FP8 |
| #821 | `server/src/watch.ts`, `shared/api.ts`, `server/src/hibernateSweep.ts`, `server/src/stopDoneSweep.ts`, `server/src/coord/store.ts` | FM6 (gate); FM1, FP9 (`shared/api.ts`, checked) |
| #737 | `server/test/single-definition.test.ts` | FM6 (checked) |
| #434, #830 | `CLAUDE.md` | FM5's SAFETY edit (checked) |

#813 (the tracked-files test refusing private tracker ids) and #766 have merged since rev 1; every PR here must pass #813's test. Consolidation W1a's C1a and C1b are planned, not open; FM6 waits for them.

The architecture aim (#816) and the architecture direction (#818) have merged; FM5's CLAUDE.md edit builds on them and on #830 if it lands first. No open PR holds `ccd/claude-session@.service`, `deploy/systemd/*.timer`, `server/src/coord/rundefs.ts`, `server/src/coord/stall.ts`, `server/src/deadCoordinator.ts`, `server/src/coord/dispatch.ts`, `server/src/ccdargv.ts`, `server/src/limits.ts` or `pwa/src/screens/RunsScreen.tsx`.

## Landing order

```
--- fleet lane, after #435, #722, #740 (AGENT-FIRST) ---
FM2 (swap unit names) ─┐
CB2b ── FM1 (switch, refusals, pass, supervise hold) ─┴─ (CB2c, CB2d) ── FM3 + FM4 (on and off, one PR) ── FM5 (ccrc door, timers)
FP8 (programme marker, spread rank)
--- server lane ---
FM1, FM3 + FM4, W1a C1b, #821 ── FM6 (switches row, start-lane holds, wire) ── FM7 (deliberate orphan-d clock)
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
3. **A fleet left down or unsupervised.** A crash between `on`'s steps that leaves the switch with nothing to lower it; a pause maintenance did not raise but `off` lowers; a switch removed before the last start; a start that does not reach the unit's own `ccd supervise` (an exemption the unit cannot read); a resumed unit left disabled (FM1, FM3, FM4, FM5).
4. **Hibernation's contract broken.** A hibernated row recorded, woken or stopped by maintenance (FM3, FM4).
5. **A dead verdict on a paused or resumed fleet.** The stall watch or the dead-coordinator lane acting on a session maintenance stopped, or a coordinator whose maintenance resume failed counted as a crash; and the opposite fault, a second hold added where `lifecycle-stopped` or the `stop` act already owns the case (FM6).
6. **Placement drift.** The spread changing the order when there is no programme, crossing a pool, admitting an overflow lane to the home-able bracket, or running on a stay tick (FP8).
7. **A PWA matcher.** The spread computed in the PWA instead of read from the server (FM10).

---

## Tasks

### Task FM1: the maintenance switch, its refusals, the pass and the supervise hold (D-5950; spec §3.3) — GATED: after #435, #722, #740 and CB2b

**Routing:** band 3, native. **Lane:** AGENT-FIRST (FLEET: `ccd`, the unit file).

**Files:**
- Modify `ccd/ccd`:
  - a reader `_maint_state` → `off | on | resuming | unreadable` over `$REG/maintenance` (`<since> <phase> <reason-b64>`), validated; `unreadable` refuses like `on` (fail closed for starts, never for swaps);
  - the pass: `_maint_pass <id>` writes `$REG/<id>.maint-pass` (through `_reg_set`), `_maint_passed <id>` reads it, and `_reg_purge` (≈:3849) purges it with the row. A pass means something only while the switch stands;
  - `cmd_start` (≈:24121), `cmd_enable` (≈:28054), `cmd_ensure` (≈:24508) and `cmd_ws_add` (≈:6961) refuse `maintenance` with exit 4 before anything is journaled, unless the row holds a pass (`ws-add` never does: a new row has none);
  - `cmd_supervise` (≈:24851) exits with `CCD_MAINT_EXIT` before its ensure when `_maint_state` is not `off` and the row holds no pass, journalling `_lc_done maintenance <id>` phase `hold`;
  - `cmd_swap` (≈:27522) writes the row's pass **at its entry, before any kill**, whenever `_maint_state` is not `off`, in both its inline and detached forms. Every restart inside the swap then passes: the final `_svc_start ... || cmd_ensure` (≈:27966), and `_swap_refuse`'s restart arm (≈:26078, called with restart 1 at ≈:27870 and ≈:27908 after the kill), whose `_svc_start` would otherwise return 0 while the unit's supervise exited, so its `|| cmd_ensure` fallback would never run;
  - `maintenance` joins `_LC_ACTS` (≈:4368).
- Modify `ccd/claude-session@.service`: `CCD_MAINT_EXIT` joins CB2b's `RestartPreventExitStatus=` line and a new `SuccessExitStatus=` line.
- Modify `shared/api.ts`: `maintenance` in `LifecycleAct` and `LIFECYCLE_ACTS` (rebased on #821 or checked line-disjoint from it).
- Create `server/test/ccd-maintenance-refuse.test.ts`; modify `server/test/ccd-lifecycle-sites.test.ts` (the new act), `server/test/ccd-lifecycle-purge.test.ts` (`.maint-pass` purges with the row, and the unit file if Step 0 finds it pinned there).

- [ ] **Step 0: Re-ground.** Read CB2b's merged unit line and its exit status; choose `CCD_MAINT_EXIT` distinct from it and from every `die` code ccd uses; read `cmd_supervise`, `cmd_ensure`, `cmd_start` and `cmd_ws_add` whole; read `cmd_swap` (every arm that restarts the session, `_swap_refuse` included), `cmd_prefer` and `cmd_stop` to confirm none calls a refused verb on its own path other than `cmd_swap`'s `cmd_ensure` fallbacks, which the entry pass covers. Confirm `_svc_start` (≈:906) is a bare `systemctl --user start` and the unit has no `PassEnvironment=`: an exemption must be a file the unit can read, never a caller's variable.
- [ ] **Step 1: Red.** "each of start, enable, ensure and ws-add refuses `maintenance` with exit 4 and touches no unit, pane or registry file"; "an unreadable switch refuses those four too"; "swap, swap-self, prefer, stop, hibernate, coord-pause, reclaim-pause and caps behave identically with and without the switch, apart from the swap's pass file" (a table over the verbs, output and stub calls compared); "**running `cmd_supervise` itself** after a swap of a stopped row under the switch, it spawns" (the supervise run directly, not only the systemctl stub, in phases `on` and `resuming`); "**running `cmd_supervise` itself** after a swap refused after its kill (`_swap_refuse` with restart 1) under the switch, it spawns"; "**running `cmd_supervise` itself** for a row holding a pass under the switch, it spawns"; "supervise under the switch without a pass exits `CCD_MAINT_EXIT` and never spawns"; "a pass without the switch changes nothing"; "the unit lists `CCD_MAINT_EXIT` in both keys"; "an environment variable on the caller does not pass" (pins the wrong design out).
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the check removed from `cmd_ensure` | ccd-maintenance-refuse | "ensure … refuses `maintenance`" |
  | the check added to `cmd_swap` | ccd-maintenance-refuse | "swap … behave identically" |
  | `cmd_swap` writes no pass | ccd-maintenance-refuse | "after a swap … it spawns" |
  | the pass written before the final start only, not at entry | ccd-maintenance-refuse | "after a swap refused after its kill … it spawns" |
  | the pass read from an environment variable | ccd-maintenance-refuse | "an environment variable on the caller does not pass" |
  | `unreadable` folded into `off` | ccd-maintenance-refuse | "an unreadable switch refuses" |
  | the supervise check after the ensure | ccd-maintenance-refuse | "never spawns" |
  | `SuccessExitStatus=` line dropped | ccd-maintenance-refuse | "both keys" |
  | the check placed after the first journal row | ccd-maintenance-refuse | "touches no … registry file" |

- [ ] **Step 4: Verify.** Each suite of Step 3 alone, then `ccd-swap.test.ts`, `ccd-supervised-start.test.ts`, `ccd-ws-add-child.test.ts` alone, then `bash -n ccd/ccd` and `ccrc restamp` after the rebase.

**Review focus:** 1, 2, 3. **Not in this task:** `on` and `off` (FM3, FM4).

### Task FM2: named swap units, never a blocked swap (D-5951; spec §3.5) — GATED: after #435, #722, #740

**Routing:** band 3, native (the swap path). **Lane:** AGENT-FIRST (FLEET: `ccd`).

**Files:**
- Modify `ccd/ccd`: `_svc_run_detached` (≈:1051) takes an optional leading `--name <unit>` and an opt-in `--retry-unnamed`; on Linux it runs `systemd-run --user --collect --quiet --unit=<unit>`; on a non-zero answer it asks whether that exact unit is loaded (`systemctl --user show -p LoadState <unit>`): loaded means the act was dispatched and is not dispatched again (`cmd_swap` has no per-id lock); not loaded means it retries once without `--unit` **only when `--retry-unnamed` was passed**, and otherwise fails loudly (FM4's pacer relies on this: an unnamed pacer would escape its single-instance check); on darwin the name is ignored. `_dispatch_swap` (≈:17291) and `cmd_swap`'s detach arm (≈:27717) pass `--name ccd-swap-<id>-<epoch-ms> --retry-unnamed`; no other caller passes `--retry-unnamed`. A helper `_swap_units_active <id>` lists that id's active or activating swap units.
- Create `server/test/ccd-swap-unit-name.test.ts`.

- [ ] **Step 0: Re-ground.** Read `_reg_id_ok` and confirm the id grammar is inside systemd's unit-name characters; if not, build the name through `systemd-escape`. Read the harness's `systemd-run` stub.
- [ ] **Step 1: Red.** "a dispatched swap passes `--unit=ccd-swap-<id>-<ms>`"; "when the named start fails and its unit is not loaded, the swap is dispatched again unnamed and its log line says so"; "when the named start answers non-zero but its unit is loaded, no second dispatch runs"; "when both fail, each call site keeps its own message: `_dispatch_swap` logs `dispatch FAILED` to `swap.log`, and `cmd_swap`'s detach arm prints `systemd-run failed. Nothing was moved`"; "darwin ignores the name"; "a named start without `--retry-unnamed` whose unit is not loaded fails and is not retried"; "`_swap_units_active` lists only that id's units"; every case of `ccd-swap.test.ts` green.
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the unnamed retry removed | ccd-swap-unit-name | "dispatched again unnamed" |
  | the retry made without the loaded check | ccd-swap-unit-name | "no second dispatch runs" |
  | the name without the `-<ms>` suffix | ccd-swap-unit-name | "passes `--unit=ccd-swap-<id>-<ms>`" |
  | the prefix match widened to all swaps | ccd-swap-unit-name | "only that id's units" |
  | the unnamed retry made the default | ccd-swap-unit-name | "without `--retry-unnamed` … is not retried" |

- [ ] **Step 4: Verify.** The suite alone, then `ccd-swap.test.ts`, `ccd-swap-refuse.test.ts`, `ccd-auto-swap-hold.test.ts` alone; `bash -n ccd/ccd`.

**Review focus:** 1.

### Task FM3: `ccd maintenance on` (D-5952; spec §3.4) — GATED: after FM1, FM2, CB2c and CB2d; lands in one PR with FM4

**Routing:** band 3, native, **two reviewers** (stops every session). **Lane:** AGENT-FIRST (FLEET: `ccd`).

**Files:**
- Modify `ccd/ccd`: `cmd_maintenance on [--reason <text>] [--drain-wait <s>]` and `status`; refuses with `CLAUDECODE` set, inside a `cc-*` pane, and on darwin (`unsupported-platform`). In order (spec §3.4): a standing switch in phase `on` means "finish" (step 5, drain and stop, for the manifest's `skipped` rows only, never a rebuilt manifest; `already` when none is left), in phase `resuming` refuses `resuming`; under the roll node lock (`flock -x $REG/.claude-roll.lock`, CB2c) write `$REG/maintenance` through a staged rename; write `$REG/.maintenance-manifest` by one staged rename, holding the header, a `pause <name>` line for each pause lowered now, and one row per active or activating unit (id, role, status, `bg`, state `pending`), excluding `.hibernated` and `.stopped` rows; raise each recorded pause through its own writer (`cmd_coord_pause --state on`, `cmd_reclaim_pause --state on`, `~/.ccrc/tmp-sweep-paused`); create the placeholder tmux session `ccd-maintenance`; then, **per row and back to back** (spec §3.4 step 5): if `.hibernated` exists now, record the row `hibernated` and never stop it; wait on `_swap_units_active` and on a live `$REG/<id>.rolling` up to `--drain-wait` (default 300, per row), marking a row still swapping or rolling `skipped` with its reason and leaving it running; stop it through `cmd_stop --cause maintenance` and remove its pass; read `_swap_units_active` again, and if a swap appeared between the drain and the stop, wait for it (never cancel) within the same bound, then stop the row again if it is active (or mark it `skipped` at the bound); rewrite its state to `stopped` only when no swap unit is active and the unit is not active; report. Every manifest rewrite is a staged rename.
  - the role column reads `.programme` through FP8's `_programme_read` when FP8 has merged; before it, FM3 records `child` and `plain` only, and FP8 adds the `coordinator` clause to the manifest builder (one reader of the marker either way).
- Modify `ccd/ccd` `cmd_stop`: `--cause <word>`, accepted only from ccd's own callers (an internal flag, refused from the command line like the history verbs' internal flags), writes the `cause` field CB2d adds to lifecycle rows on its `stop` row, beside `dec.surface` (whose closed set, `_lc_surface_norm` ≈:5085, is unchanged). FM3 adds `maintenance` to that field's vocabulary: ccd's word list, the `shared/api.ts` parse CB2d adds, and CB2d's lifecycle-vocabulary test.
- Modify CB2d's detached act and restore: when `_maint_state` is not `off`, write the row's pass (FM1) before the act's start, so a roll already past its gate when the switch was written completes, and never fails on the hold (a failed act or restore would append the build to `~/.ccrc/claude-halted`).
- Modify CB2c's roll gate: a `maintenance` hold while the switch stands, checked under the same node lock.
- Create `server/test/ccd-maintenance-on.test.ts`.

- [ ] **Step 0: Re-ground.** Read `cmd_stop` and `_ws_unsupervise` whole, and CB2d's `cause` field as merged (its writer, its `shared/api.ts` parse, its vocabulary test); read the pause writers; read how the hook writes `bg` in the turn marker (`session-hook.sh` ≈:3286-3294) and the reader ccd already has for it; read CB2c's node lock and CB2d's `.rolling` life cycle, and CB2e's verdict for a stop during a soak, as merged.
- [ ] **Step 1: Red.** "the switch exists before the first stop"; "the manifest and its pause record exist before the first pause is raised and before the first stop"; "a pause already raised is not recorded as maintenance's"; "hibernated and stopped rows are not in the manifest and are not touched"; "a row whose swap unit is active is waited for, then stopped"; "**a swap dispatched between a row's drain and its stop does not leave the row running at the end of `on`**, and its unit is never stopped"; "a row hibernated between the manifest and its stop is recorded `hibernated`, keeps `.hibernated`, and is never stopped"; "a stopped row holds no pass"; "the `stop` row carries `cause=maintenance` and `dec.surface` unchanged"; "`--cause` from the command line is refused"; "a row with a live `.rolling` is waited for, never cut, then stopped, and no line is appended to `claude-halted`"; "a roll's act started after the switch passes the supervise hold and completes"; "a roll gated after the switch holds `maintenance`"; "a row still swapping at the bound is skipped and left running"; "the placeholder exists before the first pane is killed"; "a second `on` re-waits and stops only the skipped rows, and the manifest still lists every row the first `on` stopped"; "a second `on` with nothing skipped changes nothing"; crash injection: "killed after the switch: `off` removes the switch and starts nothing"; "killed after the manifest, before any pause: `off` lowers the recorded pauses (a no-op) and resumes nothing it did not stop"; "killed mid-stops: `off` resumes exactly the stopped rows"; "inside a session it refuses"; "the manifest records role from `.programme` and `.child` (FP8 absent: every row reads `plain` or `child`)".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the switch written after the stops | ccd-maintenance-on | "exists before the first stop" |
  | the manifest written after the pauses are raised | ccd-maintenance-on | "before the first pause is raised" |
  | every pause recorded as raised | ccd-maintenance-on | "not recorded as maintenance's" |
  | the hibernated filter removed | ccd-maintenance-on | "hibernated … not touched" |
  | the swap wait replaced by a unit stop | ccd-maintenance-on | "waited for, then stopped" |
  | the `.rolling` wait removed | ccd-maintenance-on | "never cut … `claude-halted`" |
  | the bound stops the swapping row | ccd-maintenance-on | "skipped and left running" |
  | a second `on` rebuilds the manifest | ccd-maintenance-on | "still lists every row the first `on` stopped" |
  | the placeholder created last | ccd-maintenance-on | "before the first pane is killed" |
  | the post-stop swap re-check removed | ccd-maintenance-on | "a swap dispatched between a row's drain and its stop" |
  | the `.hibernated` re-check at the stop removed | ccd-maintenance-on | "hibernated between the manifest and its stop" |
  | the pass kept after the stop | ccd-maintenance-on | "a stopped row holds no pass" |

- [ ] **Step 4: Verify.** The suite alone, then `ccd-coord-pause.test.ts`, `ccd-child-reclaim-pause.test.ts` and CB2c's and CB2d's roll suites alone; `bash -n ccd/ccd`.

**Review focus:** 1, 3, 4.

### Task FM4: `ccd maintenance off`, paced (D-5953; spec §3.6) — GATED: after FM3, CB2c and CB2d; lands in one PR with FM3

**Routing:** band 3, native, **two reviewers** (starts every session). **Lane:** AGENT-FIRST (FLEET: `ccd`).

**Files:**
- Modify `ccd/ccd`: `cmd_maintenance off [--stagger <s>] [--wait]`: an unreadable switch is treated as phase `on`; with no manifest, remove the switch and report that nothing was stopped; otherwise set the switch's phase to `resuming` and start the pacer `ccd maintenance _resume` in its own unit through `_svc_run_detached --name ccd-maintenance-resume` (no `--retry-unnamed`: a failed named start fails `off` loudly); refuse `resuming` while that unit is active, and continue from the manifest when it is not (a dead pacer); `--wait` follows the unit to its end. The pacer orders the manifest's rows in state `stopped`, `skipped` or `pending` (an inactive `pending` row was stopped by a crash before its state rewrite, or held by a reboot under the switch), in the order mid-turn, `bg > 0`, coordinators, rest; coordinators first within a tier; stable), and before each start waits for the extracted `recent-spawn` helper with the window `--stagger` (default 25, minimum 10), the extracted `low-memory` helper (`_mem_headroom`, CB1c; 3 GiB, re-measure every 10 s, never skip), and no `roll-in-flight`. For a row whose unit is not active and which is not `.hibernated` at this moment (re-checked before each start; a row hibernated since is recorded `hibernated` and never woken) it writes the row's pass, journals `_lc_done maintenance <id>` phase `resume` with `cause=maintenance` **before** the start, then starts through `cmd_start`'s path (the `.stopped` removal, `_hib_wake_clear`, `_supervised_start`'s enable, `reset-failed` and verdict wait), never a bare `_svc_start`; it rewrites the row's state to `started`, or `failed` when the verdict fails, and goes on. After the last row: lower only the recorded pauses, kill the placeholder, remove every pass, remove the manifest and then the switch, journal phase `done` with any `failed` rows, print the `bg > 0` rows.
- Modify `ccd/ccd` `cmd_caps` (≈:8487): lists `maintenance` (in this commit, not FM3's).
- Modify CB2c's roll gate: extract its inline `recent-spawn` and `low-memory` holds into two helpers the roll gate and the pacer both call, `recent-spawn` taking its window as a parameter (the roll passes 120); do not copy them.
- Create `server/test/ccd-maintenance-off.test.ts`.

- [ ] **Step 0: Re-ground.** Read CB2b's spawn-start stamp, CB2c's gate holds (`recent-spawn`, `low-memory`, `roll-in-flight`) and CB1c's `_mem_headroom` as merged; read `cmd_start` whole.
- [ ] **Step 1: Red.** "the start order is mid-turn, `bg > 0`, coordinators, rest, coordinators first within a tier"; "no start within `--stagger` of any spawn start, a swap's included"; "below the memory floor the pacer waits and then starts the same row"; "a row already active is skipped"; "a skipped row that is inactive is resumed"; "an inactive `pending` row is resumed"; "a row hibernated after `on` is not woken"; "`off` on an unreadable switch resumes from the manifest, or removes the switch when there is none"; "a failed named start of the pacer fails `off` and starts no unnamed pacer"; "after `off`, every resumed unit is enabled and `.supervised` exists, and `.stopped` is gone"; "a start whose verdict fails is marked `failed` and reported, and the next row still starts"; "the `resume` row is journalled before the start"; "only recorded pauses are lowered"; "the switch is removed after the last start, and every pass with it"; "a second `off` while the pacer runs refuses"; "`off` with the pacer's unit dead continues from the manifest and starts no row twice"; "`off` with no manifest removes the switch and starts nothing"; "the pacer runs in its own unit"; "`cmd_caps` lists `maintenance`"; and in the roll gate suite: "the roll's own `recent-spawn` still uses 120 s".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | tiers reversed | ccd-maintenance-off | "the start order" |
  | the spacing reads the settle stamp, not the start stamp | ccd-maintenance-off | "a swap's included" |
  | the memory wait skips the row | ccd-maintenance-off | "starts the same row" |
  | the start is a bare `_svc_start` | ccd-maintenance-off | "every resumed unit is enabled" |
  | a failed start stops the pacer | ccd-maintenance-off | "the next row still starts" |
  | the hibernate re-check before a start removed | ccd-maintenance-off | "hibernated after `on` is not woken" |
  | `pending` rows left out of the resume | ccd-maintenance-off | "an inactive `pending` row is resumed" |
  | the pacer started with `--retry-unnamed` | ccd-maintenance-off | "starts no unnamed pacer" |
  | the `resume` row journalled after the start | ccd-maintenance-off | "journalled before the start" |
  | every pause lowered | ccd-maintenance-off | "only recorded pauses" |
  | the switch removed before the starts | ccd-maintenance-off | "after the last start" |
  | the roll window replaced by the stagger | the roll's gate suite | "still uses 120 s" |

- [ ] **Step 4: Verify.** The suite alone, then the roll gate suite CB2c created, alone; `bash -n ccd/ccd`.

**Review focus:** 1, 2, 3, 4.

### Task FM5: `ccrc maintenance`, the operator's door (D-5954; spec §3.4, §3.7, §3.8) — GATED: after FM3 + FM4, #722 and #740

**Routing:** band 3, native. **Lane:** AGENT-FIRST (FLEET: `ccrc`, timers).

**Files:**
- Modify `ccd/ccrc`: `cmd_maintenance on|off|status`. `on`: take `~/.ccrc/update.lock` through `_upd_lock` (≈:18855) for the duration of the command only (it is an fd-held `flock -n`, released when the process exits; refuse while an update holds it); stop each installed timer whose unit file declares `X-Ccrc-Maintenance=stop`, recording which in `~/.ccrc/maintenance-timers`; call `ccd maintenance on`; on failure restart the recorded timers. `off`: run one detached unit `ccrc-maintenance-off` that takes the lock, calls `ccd maintenance off --wait` and restarts the recorded timers. `cmd_update` (and every watchdog path that would start an update) refuses `maintenance` while `ccd maintenance status` reads anything but `off`, the one reader, checked after `_upd_lock` is taken. `_upd_lock_holder` (≈:18806) is unchanged. Refused inside a session and a `cc-*` pane.
- Modify every `deploy/systemd/*.timer` (14 files): one `X-Ccrc-Maintenance=keep|stop` line in `[Unit]`, as spec §3.7 lists.
- Modify `CLAUDE.md` SAFETY: `ccd maintenance` and `ccrc maintenance` are the operator's acts, never a session's.
- Create `server/test/ccrc-maintenance.test.ts`; modify `server/test/ccrc-update.test.ts` (an update under the switch refuses `maintenance`).

- [ ] **Step 0: Re-ground.** Read `_upd_lock`, `_upd_lock_holder`, the update watchdog and the timer installer; read CLAUDE.md as merged (#816, #818), and #434 and #830 if still open.
- [ ] **Step 1: Red.** "every shipped timer declares exactly one `X-Ccrc-Maintenance` value, and `ccd-pool-sync`, `ccd-cap-scopes`, `ccd-update-sync` and `ccd-telemetry-keepalive` declare `keep`"; "`on` stops exactly the `stop` timers and `off` restarts exactly those"; "`on` refuses while an update holds the lock"; "after `on` returns the lock is free, and `ccrc update` under the switch refuses `maintenance`"; "`ccrc update` with the switch absent behaves as today"; "a failed ccd half restarts the timers"; "`off` runs in its own unit".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | a timer file's declaration removed | ccrc-maintenance | "exactly one … value" |
  | the pool-sync timer declared `stop` | ccrc-maintenance | "`ccd-pool-sync` … `keep`" |
  | the lock taken over an update | ccrc-maintenance | "refuses while an update holds the lock" |
  | the switch check removed from `cmd_update` | ccrc-maintenance | "`ccrc update` under the switch refuses" |
  | the failure path leaves timers stopped | ccrc-maintenance | "restarts the timers" |

- [ ] **Step 4: Verify.** The suite alone, then `ccrc-update.test.ts`, `ccrc-install.test.ts` and `ccrc-doctor.test.ts` alone; `bash -n ccd/ccrc`.

**Review focus:** 3.

### Task FM6: the server's switch reader, start-lane holds and wire (D-5955; spec §3.9) — GATED: after FM1, FM3 + FM4, consolidation W1a C1b and #821

**Routing:** band 3, native (holds on wake and restart lanes; the dead-coordinator lane's deliberate list). **Lane:** server.

**Files:**
- Modify `shared/switches.ts` (created by W1a C1a): a `maintenance` row in `SWITCHES` (storage marker `maintenance`, writer `ccd maintenance`, meaning "fleet maintenance", route none). Its presence is read by `readSwitches(listing)` as `MarkerState`; no new vocabulary.
- Create, beside that row, one content reader `maintenanceDetail(state, io)` → `{ since, phase, reason, resumed, total }`. It reads the switch's content and the manifest through the watcher's io when the state is `set` (`resumed` = rows in state `started`, `total` = rows, in the grammar FM3 + FM4 define), returns `null` for `clear`, and maps `unmeasurable` and an unparseable content explicitly to `phase: 'unmeasurable'` with the other fields `null`, **fail shut** (every hold holds).
- Modify the tick (`server/src/watch.ts`, as rewritten by C1b, rebased on #821) to read it once and pass it to the start-making lanes only: the mail lane's wake, hibernation's wake paths, and the roll route and auto-roll if present. Each holds quietly; none notifies. Executors re-read through `readSwitches` at the act (K12). No hold is added to the stall sweep, the stop-done lane or the dead-coordinator lane.
- Modify `server/src/deadCoordinator.ts`: `maintenance` joins `DEAD_COORDINATOR_DELIBERATE_ACTS` (≈:69), for the hold-without-stop case (spec §3.9): a coordinator that `on` never stopped, held by the supervise hold after a reboot (newest row `maintenance` phase `hold`, no `stop`, reads `orphan`). The docstring states that case; the failed-resume case is already deliberate through `stop`.
- Modify the Restart/ensure route and the roll route: `409 { refused: 'maintenance' }`, both pre-checked and mapped from ccd's word.
- Modify `shared/api.ts`: `maintenance` on the fleet-health wire (additive, absent = none; `phase` is `on`, `resuming` or `unmeasurable`); `'maintenance'` in the refusal vocabulary.
- Create `server/test/maintenance-holds.test.ts`; modify `server/test/fleet-health.test.ts`, `server/test/stall-session.test.ts` (a proof, not a new hold), `server/test/dead-coordinator-lane.test.ts`, `server/test/single-definition.test.ts` (one row, one reader; checked against #737), and C1a's switches test (the new row).

- [ ] **Step 0: Re-ground.** Census every lane and route that composes `ensure`, `start`, `ws-add` or `roll`; the census is the test's table. Re-read the `lifecycle-stopped` hold (`stall.ts` ≈:1087), `DEAD_COORDINATOR_DELIBERATE_ACTS` and `deadCoordinatorJournal` (≈:207-215). Read `shared/switches.ts` and `readSwitches` as C1a and C1b merged them, and the manifest grammar as FM3 + FM4 merged it. If C1b has not merged, stop: this task does not write an interim constant in `rundefs.ts`.
- [ ] **Step 1: Red.** "each censused start lane holds under the switch and acts without it"; "a session stopped by `on` (its journal `stop` with `cause=maintenance`) gets the stall watch's `lifecycle-stopped` hold with no maintenance-specific code"; "the dead-coordinator lane takes no step for a coordinator stopped by `on`"; "a coordinator stopped by `on` whose resume failed is already deliberate through `stop`, with `maintenance` absent from the list" (a proof); "**a coordinator held by the supervise hold with no `stop`** (rows: successful spawn, `maintenance` phase `hold`; reads `orphan`) is not counted as a crash"; "a coordinator with a `maintenance` row before a later successful spawn, which then crashed, is counted as a crash"; "the routes answer `409 { refused: 'maintenance' }`"; "health carries `maintenance` with `resumed` and `total` read from the manifest" (fixture: the manifest FM3 + FM4's suites write); "an unmeasurable registry listing or an unparseable switch reads `phase: 'unmeasurable'` and every lane holds"; skew: "an old PWA ignores the field; a new PWA reads its absence as none".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the wake lane ignores the switch | maintenance-holds | its row |
  | `maintenance` left out of the deliberate acts | dead-coordinator-lane | "held by the supervise hold with no `stop`" |
  | the deliberate scan widened past the newest successful spawn | dead-coordinator-lane | "then crashed, is counted as a crash" |
  | `resumed` counted from the listing, not the manifest | fleet-health | "`resumed` and `total`" |
  | a marker literal for `maintenance` outside `SWITCHES` | single-definition | its scan |
  | `unmeasurable` mapped to `null` (fail open) | maintenance-holds | "every lane holds" |

- [ ] **Step 4: Verify.** Each suite alone.

**Review focus:** 5.

### Task FM7: `orphan-d`'s deliberate clock (D-5956; spec §3.10) — GATED: after FM3 + FM4 and FM6

**Routing:** band 3, native (stall verdicts). **Lane:** server.

**Files:**
- Modify `server/src/coord/stall.ts`: `ORPHAN_D_DELIBERATE_IDLE_MS = 60_000` beside `ORPHAN_D_IDLE_MS`; `StallSessionInput` gains `deliberateRestart: boolean`, computed by one pure selector over the session's lifecycle rows (journal order, as `deadCoordinatorJournal` sorts them): **true when a `maintenance` phase `resume` row lies at or before `restartAt` and exactly one successful `spawn` lies between that row and `restartAt`**. `stallOrphanDInner` (≈:1694) uses the deliberate clock when it is true. Arming, holds, rungs, subject and key unchanged.
- Modify the stall sweep's input builder to supply it from the lifecycle mirror.
- Modify `server/test/stall-verdict.test.ts`, `server/test/stall-session.test.ts`.

- [ ] **Step 0: Re-ground.** Read how `restartAt` is written and which lifecycle rows the mirror carries. List the rows that fall between the pacer's `maintenance` row and `restartAt` on the merged code: on `4bc6c756d` they are `cmd_start`'s `start` (≈:24472), `cmd_ensure`'s `ensure` (≈:24624) and `_spawn_settle`'s `spawn` (≈:23409). If the merged code journals more rows between them, the selector still holds (it counts spawns, not rows); record the list in §Deviations.
- [ ] **Step 1: Red.** "**the real row sequence** (`maintenance` resume, `start`, `ensure`, `spawn`, then `restartAt`) with `lostBg > 0` notifies after 60 s idle"; "a later crash restart of a resumed session (a second successful spawn after the resume row) still waits 15 minutes"; "a resume whose first spawn failed and whose second succeeded is deliberate" (a failed spawn is not a successful one); "any other restart still waits 15 minutes"; "shadow stays shadow at every arming level"; "`mail-disabled` still holds".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | the deliberate clock for every cause | stall-verdict | "any other restart still waits" |
  | the deliberate clock bypassing the arming | stall-verdict | "shadow stays shadow" |
  | the selector reads only the newest row before `restartAt` | stall-verdict | "the real row sequence … notifies after 60 s" |
  | the spawn bound dropped (any earlier `maintenance` row) | stall-verdict | "a later crash restart … still waits 15 minutes" |

- [ ] **Step 4: Verify.** Each suite alone.

**Review focus:** 5.

### Task FP8: the programme marker and the spread rank (D-5957; spec §4.2 to §4.4) — GATED: after #435, #722, #740

**Routing:** band 3, native (placement and the swap walk). **Lane:** AGENT-FIRST (FLEET: `ccd`).

**Files:**
- Modify `ccd/ccd`:
  - `cmd_ws_add` (≈:6961): `--programme <program>` and `--coordinator <id>`, stripped with the other flags, both required together, validated (`_program_slug_valid`, new, restating `shapeProgramSlug`'s grammar from `shared/api.ts` ≈:5104; `_reg_id_ok`); written as `$REG/<id>.programme` (`<program> <coordinatorId>`) by `_reg_set` beside the `.child` write (≈:7421);
  - `_programme_read <id>` → `program` and `coordinatorId`, or nothing for a missing or malformed marker: **the one reader** of the marker (grammar and validation), used by `_programme_members_on` and by FM3's manifest role (if FM3 + FM4 merged first, this task switches its role clause to `_programme_read` and adds the `coordinator` role);
  - `_programme_members_on <id>` → one assoc array lane → count, from one glob of `$REG/*.programme` read through `_programme_read`'s parse with builtins only, memoised per walk; malformed markers ignored;
  - `SPREAD_SCORE_MAX=80` beside `SWAP_CEILING` (≈:1338), and the rank (tier, members, the walk's existing order) **per walk**, as spec §4.3 states: `_ws_least_loaded` (≈:6648) with five tiers (scored ≤80; scored >80, the ceiling included; measured with no score; unmeasured; auth-dead; score within the first two, roster order within the rest), and `_swap_target`'s candidate walk (≈:18005-18212) with four (scored ≤80; scored >80 to the ceiling; unmeasured, 100; auth-dead, 101; score, then roster order), inside each of its brackets. Ties keep roster order. `_place_for_class` passes the programme to `_ws_least_loaded`. No other arm of `_swap_target` or `_auto_swap_check` changes;
  - `cmd_caps` lists `programme-v1`.
- Create `server/test/ccd-programme-spread.test.ts` and `server/test/program-slug-grammar.test.ts` (ccd's `_program_slug_valid` and `shapeProgramSlug` accept and refuse the same table, as `workspace-slug-grammar.test.ts` does for workspace slugs); modify `server/test/ccd-ws-add-child.test.ts`, `server/test/ccd-tick-budget.test.ts` (a stay tick reads no marker; a walk reads at most the marker count), `server/test/ccd-lifecycle-purge.test.ts` (`.programme` purges with the row).

- [ ] **Step 0: Re-ground.** Read both walks whole; read `projected-home.test.ts` and `fixtures/leastLoaded.ts`; read the tick-budget fixture.
- [ ] **Step 1: Red.** "N children with K free healthy lanes use min(N, K) lanes before reusing one"; "the first child avoids the coordinator's lane when another eligible healthy lane exists"; "a swap prefers a lane without members and still swaps when every lane has one"; "home affinity is unchanged after placement (stay, return, rehome)"; "no marker: the order equals today's on the projected-home fixture"; "no marker: the order equals today's on the mixed-tier parity fixture for each walk (a measured lane with no score ahead of an unmeasured one in roster order, an auth-dead lane first in roster order, a lane above the ceiling, equal scores)"; "no programme given while other rows carry markers: today's order"; "a malformed marker: today's order"; "one marker reader: no other function in `ccd/ccd` parses `.programme`" (a source scan); "pools, kill switches and the class gate filter first; an overflow lane never enters the home-able bracket"; "a lane above 80% loses to a fuller-of-members lane below it"; "a stay tick reads no marker".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | members ranked before tier | ccd-programme-spread | "above 80% loses" |
  | the coordinator not counted | ccd-programme-spread | "avoids the coordinator's lane" |
  | the spread drops a full lane | ccd-programme-spread | "still swaps when every lane has one" |
  | the member scan before the stay arms | ccd-tick-budget | "a stay tick reads no marker" |
  | `.programme` left out of the purge | ccd-lifecycle-purge | its row |
  | the slug grammar widened in ccd only | program-slug-grammar | its table |
  | members counted across all programmes when none is given | ccd-programme-spread | "no programme given while other rows carry markers" |
  | `_ws_least_loaded`'s measured-no-score tier folded into unmeasured | ccd-programme-spread | "the mixed-tier parity fixture" |

- [ ] **Step 4: Verify.** Each suite alone, then `projected-home.test.ts`, `ccd-swap-target-class.test.ts`, `ccd-auto-swap-pool.test.ts` alone; `bash -n ccd/ccd`.

**Review focus:** 1, 6.

### Task FP9: dispatch passes the programme; the server counts the spread (D-5958; spec §4.2, §4.5) — GATED: after FP8

**Routing:** band 2 (spec-able; review native). **Lane:** server.

**Files:**
- Modify `server/src/ccdargv.ts`: `wsAddWorker` takes an optional `programme: { program, coordinatorId } | null` and composes `--programme`/`--coordinator` only when non-null.
- Modify `server/src/coord/dispatch.ts`: passes it when the node's caps list `programme-v1` (`capSupported`), with `program` = the dispatched run's own `program` field (already shaped by `shapeProgramSlug` at every programme ingress) and `coordinatorId` = its `claimedBy`. No new definition of a programme: the field is the `programs` table's primary key.
- Create `server/src/coord/programmeSpread.ts` (L1, pure): `programmeSpread(runs, sessions)` → per `program`: `{ children, lanes, coordinatorShares }`, grouping by the run's `program` field, the same key dispatch passes and the run board groups by. It derives no key of its own.
- Modify the runs route and `shared/api.ts` (checked against #821): additive `spread` on the runs projection, keyed by `program`.
- Create `server/test/programme-spread.test.ts`; modify `server/test/dispatch-child-argv.test.ts`, `server/test/ccdargv-brand.test.ts`.

- [ ] **Step 0: Re-ground.** Read the store's binding reader for a run's worker, the runs route's projection, and how the run board groups runs by `run.program`.
- [ ] **Step 1: Red.** "a programme of four children on three lanes reads `{children: 4, lanes: 3}`"; "`coordinatorShares` is true when a child shares the coordinator's lane"; "a node without `programme-v1` gets today's argv exactly"; "a node with it gets both flags"; "dispatch's `--programme` equals the run's `program`, and `spread` is keyed by the same value"; "two programmes of one coordinator are two keys"; "after a succession the key is unchanged"; skew: "an old PWA ignores `spread`".
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | flags composed without the cap | dispatch-child-argv | "today's argv exactly" |
  | lanes counted per run, not distinct | programme-spread | "three lanes" |
  | `--programme` from the coordinator's id instead of the run's `program` | dispatch-child-argv | "equals the run's `program`" |
  | `programmeSpread` grouped by `claimedBy` | programme-spread | "two programmes of one coordinator are two keys" |

- [ ] **Step 4: Verify.** Each suite alone.

**Review focus:** 6, 7.

### Task FM10: the maintenance banner and the spread line (D-5959; spec §3.9, §4.5) — GATED: after FM6, FP9 and skins W3 P5

**Routing:** band 2 (literal render of two fields; review native). **Lane:** PWA.

**Files:**
- Create `pwa/src/fleet/MaintenanceBanner.tsx` beside the other banners (`HaltBanner.tsx`, `CoordBanner.tsx`), mounted where they mount; it renders `health.maintenance` (since, phase, reason, `resumed` of `total`) and nothing on absence.
- Modify the run board's programme group header (`pwa/src/screens/RunsScreen.tsx` or the component skins W3 P5 lands; keyed by `run.program`, which is `spread`'s key, so no join) to render `spread`: "4 children on 3 lanes", "· coordinator shares a lane".
- Modify the session header: a coordinator shows its programme's spread. A row maintenance stopped already reads stopped; no per-row maintenance field exists (spec §3.9). Cards unchanged.
- Create `pwa/test/maintenance-banner.test.tsx`; modify `pwa/test/runs-screen.test.tsx`.

- [ ] **Step 0: Re-ground.** Read skins W3 P5's board and header as merged.
- [ ] **Step 1: Red.** "no field, no banner"; "the banner shows since, reason and `resuming 12 of 41`"; "the programme header shows the spread line"; "given runs and sessions with no `spread` field, the board shows no spread line, and with the field it shows exactly the field" (the reads-`spread`-only row); "the coordinator header shows it and the card does not"; the width-and-skin matrix: 360, 390, 1280, 1920 × refined, instrument × dark, light, no overflow, no truncation.
- [ ] **Step 2: Green.**
- [ ] **Step 3: Mutation table, RUN.**

  | Mutant | Suite | Expected red |
  |---|---|---|
  | banner shown on absence | maintenance-banner | "no field, no banner" |
  | spread computed in the PWA from runs and sessions | runs-screen | "with no `spread` field, the board shows no spread line" |
  | header drops the spread | runs-screen | "the coordinator header shows it" |

- [ ] **Step 4: Verify.** Each suite alone; `cd pwa && npm run test` typecheck leg.

**Review focus:** 7.

---

## Operator acts in this programme

None is required to build or merge any task. Using maintenance on the fleet is the operator's own act, by `ccrc maintenance on|off` from a shell, after FM5 deploys AGENT-FIRST.

## Rollback

Each task is a plain revert. Before rolling the fleet's ccd back below FM1 to FM4, run `ccrc maintenance off` (or `ccd maintenance off --wait`) and confirm `ccd maintenance status` reads `off`: an older ccd ignores `$REG/maintenance` and a stopped fleet would stay stopped with nothing paced to start it. An older ccd ignores `.programme` markers and places as today.

## Review log

Rev 1 applies the first review of rev 0. Each finding was checked against the code at `4bc6c756d` (and the open-PR census of 2026-10-20) before it was applied.

| # | Severity | Finding | Checked | Outcome |
|---|---|---|---|---|
| 1 | high | The supervise bypass was a caller's environment variable, which never reaches the unit's `ccd supervise`, so the resume started nothing and swaps under the switch took sessions down | `_svc_start` ≈:906 is a bare `systemctl --user start`; the unit file has no `PassEnvironment=` | Applied: the per-id pass `$REG/<id>.maint-pass`, written by the pacer, every swap and an in-flight roll's act; tests run `cmd_supervise` itself (FM1, spec §3.3) |
| 2 | high | The pacer's bare `_svc_start` left resumed units disabled and unsupervised | `cmd_stop` → `_ws_unsupervise` ≈:4156 disables the unit and drops `.supervised`; `_supervised_start` ≈:23969 re-enables | Applied: each start goes through `cmd_start`'s path; failed starts recorded and reported (FM4, spec §3.6) |
| 3 | high | `update.lock` cannot be held from `on` to `off`; no place for a holder record | `_upd_lock` ≈:18855 is an fd-held `flock -n`; `_upd_lock_holder` ≈:18806 reads the update report | Applied, option B: the lock for each command only; `ccrc update` refuses `maintenance` by reading the switch through ccd (FM5, spec §3.4) |
| 4 | medium | A second `on` both no-op and "re-run to finish"; a rebuilt manifest would lose stopped rows | spec §3.4 steps 1 and 5 contradicted | Applied: a standing switch means "finish" the `skipped` rows only; `off` resumes inactive skipped rows (FM3, FM4) |
| 5 | medium | Crash windows lose the pause record; `off` undefined after a partial `on` or a dead pacer | pauses were raised before the manifest was written | Applied: write-ahead manifest by staged rename before any pause or stop; `off` with no manifest, and `off` continuing a dead pacer, defined; crash-injection tests (FM3, FM4) |
| 6 | medium | A roll in flight at `on` could be cut and halt a build | CB2d's act calls `_supervised_start`; CB2e appends failed builds to `claude-halted` | Applied: the switch is written under the roll node lock, live `.rolling` rows are waited for, the roll's act writes the pass, FM3 gated on CB2d; a no-halt test (FM3) |
| 7 | medium | The server cannot read since, phase, progress or per-row membership from a name-only listing | `watch.ts` reads `names.includes(COORDINATOR_PAUSE_MARKER)` | Applied: the one reader reads the switch and manifest through the watcher's io; `resumed` and `total` on the wire; the per-row header claim dropped (FM6, FM10) |
| 8 | medium | New stall and dead-coordinator holds duplicate existing owners; the real gap is a failed resume reading `orphan` | `stall.ts` ≈:1087 `lifecycle-stopped`; `DEAD_COORDINATOR_DELIBERATE_ACTS` ≈:69 includes `stop`, not `maintenance` | Applied: the duplicate holds dropped and proved by tests instead; `maintenance` added to the deliberate acts (FM6) |
| 9 | medium | Stale census: #821, #737, #818 missing | 27 open PRs; #821 edits `watch.ts` and `shared/api.ts`, #737 the single-definition test, #818 and #434 `CLAUDE.md`; #816 and #818 have merged | Applied: FM6 gated on #821; #821 checked for FM1 and FP9; #737 for FM6; #434 for FM5 |
| 10 | medium | FM3 could deploy before FM4: an `on` with no `off` | separate releases in rev 0 | Applied: FM3 and FM4 land in one PR; `maintenance` joins `cmd_caps` in FM4's commit |
| 11 | medium | One tier triple does not reproduce `_ws_least_loaded`'s order | `_ws_least_loaded` ≈:6834-6890 falls back `firstm`, then `first`, then `condemned`, with no ceiling filter | Applied: per-walk tiers in spec §4.3 and FP8, and a mixed-tier parity fixture |
| 12 | low | `ccd-update-sync` declared `stop` lets its lease lapse; telemetry staleness unmentioned | the unit describes a leased cache; the keepalive measures accounts | Applied: both declared `keep`, with reasons (spec §3.7, FM5) |
| 13 | low | An unnamed retry after a lost reply could run two swaps of one session; wrong failure message cited | `cmd_swap` has no per-id lock; `_dispatch_swap` logs `dispatch FAILED` ≈:17355 | Applied: retry only when the named unit is not loaded; each call site's own message (FM2, spec §3.5) |
| 14 | low | The `resume` row's order relative to the start was unspecified | FM7 reads the newest row at or before `restartAt` | Applied: journalled before the start, pinned in FM4 and checked in FM7's Step 0 |
| 15 | low | Mis-citations: Task 19 for the memory measure; `recent-spawn` as a standalone reader | the W2 plan's CB2c writes both holds inline; `_mem_headroom` is CB1c's | Applied: `_mem_headroom` (CB1c) cited; FM4 extracts the two holds into shared helpers |
| 16 | low | An equivalent mutant in FP8 | with no programme every count is 0 | Applied: replaced by "members counted across all programmes when none is given" and a tier-folding mutant |
| 17 | low | `rootRunId` could change across a succession; the server grouped by `claimedBy`: two definitions of "programme" | no run parent chain exists on the wire | Applied: one pure `programmeKey` used by dispatch and `programmeSpread`; the merge case degrades the spread, never placement (spec §4.2, FP9) |

### Rev 2: the second review

The second review of rev 1 (not ready: three high, six medium and eight low findings). Each finding was checked against `origin/main` (the cited lines have not moved since `4bc6c756d`) before it was applied. None was rejected.

| # | Severity | Finding | Checked | Outcome |
|---|---|---|---|---|
| 1 | high | FM7's clock keyed on the newest row before `restartAt` can never fire | `_lc_done start` ≈:24472, `_lc_done ensure` ≈:24624 and `_lc_done spawn` ≈:23409 all fall between the pacer's row and `restartAt` | Applied: the selector counts spawns ("a `maintenance` resume row with exactly one successful spawn between it and `restartAt`"); Step 0 lists the rows between; a red test built from the real row sequence, and a later-crash test (spec §3.10, FM7) |
| 2 | high | An auto-swap dispatched between a row's drain and its stop brings the row back during maintenance | the supervisor ticks until `cmd_stop`; `cmd_swap` never checks `.stopped` and ends in `_svc_start ... \|\| cmd_ensure` ≈:27966 | Applied: drain and stop back to back per row, `_swap_units_active` re-read after the stop, a found swap waited for and the row stopped again, the pass removed at the stop; the §3.3 claim corrected; a red test (spec §3.3, §3.4 step 5, FM3) |
| 3 | high | FP9's `programmeKey` is a second definition of "programme" beside the runs wire's `program` | `RunSummary.program` ≈:6331 is the `programs` primary key (`schema.ts` ≈:66), and the board reads runs by `run.program` | Applied: the programme is the `program` slug; the marker is `<program> <coordinatorId>`, validated by `shapeProgramSlug`'s grammar restated in ccd with an equality test; `programmeSpread` groups by `program`; `programmeKey` removed (spec §4.2, §4.5, FP8, FP9, FM10) |
| 4 | medium | A swap refused after its kill leaves the session down under the switch | `_swap_refuse` ≈:26078 called with restart 1 at ≈:27870 and ≈:27908 restarts through `_svc_start \|\| cmd_ensure` | Applied: the pass is written at `cmd_swap`'s entry, before any kill; a red test that runs `cmd_supervise` after a refused swap (spec §3.3, FM1) |
| 5 | medium | A row hibernated between the manifest and its stop is woken by the resume, breaking D-5242 | `cmd_stop` removes `.hibernated` ≈:28174 | Applied: the stop step re-checks `.hibernated` and records the row `hibernated`; the pacer re-checks before each start; ccd-side only, so no new server hold (spec §3.4, §3.6, FM3, FM4) |
| 6 | medium | The dead-coordinator rationale was wrong and its mutant equivalent | `deadCoordinatorJournal` scans rows since the newest successful spawn (≈:207-215), so a failed resume after a `stop` already reads deliberate | Applied: the rationale is the hold-without-stop case (a coordinator held by the supervise hold after a reboot); the red fixture is built from it; a proof test for the stop-then-failed-resume case; a mutant that widens the scan (spec §3.9, FM6) |
| 7 | medium | FM6's `unreadable` is a second vocabulary, and FM6 was not gated on W1a's C1a and C1b (rule 6) | consolidation rev 2.1 K12: `readSwitches` answers `MarkerState`; W1a C1a/C1b (D-5855, D-5856) create `shared/switches.ts` and rewrite `rundefs.ts` and `watch.ts`; `shared/switches.ts` absent on main | Applied: FM6 gated after C1b; maintenance is a `SWITCHES` row; one content reader maps `unmeasurable` explicitly and fails shut; "unreadable" dropped from the server side (spec §3.9, §7, FM6) |
| 8 | medium | FM6 parses a manifest grammar that FM3 + FM4 define | `resumed` and `total` come from `.maintenance-manifest` | Applied: FM6 gated on FM3 + FM4; its fixture is the manifest their suites write |
| 9 | medium | `cause=maintenance` has no carrier | `cmd_stop` journals only `dec.surface` ≈:28173, a closed set (`_lc_surface_norm` ≈:5085); CB2d adds `cause=` | Applied: FM3 adds `cmd_stop --cause` (internal) writing CB2d's `cause` field, and `maintenance` to its vocabulary (ccd, `shared/api.ts`, CB2d's test); FM3 already depends on CB2d (spec §3.4, FM3) |
| 10 | low | The unnamed retry in the shared helper lets the pacer start unnamed, escaping its single-instance check | `_svc_run_detached` ≈:1051 is shared | Applied: `--retry-unnamed` is opt-in, passed by the two swap call sites only; the pacer fails loudly; tests and mutants (spec §3.5, §3.6, FM2, FM4) |
| 11 | low | §3.4 step 1 named the wrong steps | steps 4 and 5 were raise-pauses and drain | Applied: drain and stop are now one step 5, and step 1 names it |
| 12 | low | The consolidation spec was cited as a branch draft | merged at rev 2.1 (#819, `8bc8f0e17`) | Applied: re-cited on `origin/main` with the W1a plan; K12 wording re-checked (finding 7) |
| 13 | low | #830 missing from the census | open, edits `CLAUDE.md` | Applied: in the in-flight table and FM5's gate and Step 0; #813 and #766 noted as merged |
| 14 | low | Two readers of `.programme` (FM3 and FP8) | no landing order between them | Applied: FP8 owns `_programme_read`; FM3 calls it, or records `child`/`plain` only until FP8 adds the coordinator clause; a source-scan test (FP8) |
| 15 | low | FM10's PWA-matcher mutant had no named test | Step 1 listed no "reads `spread` only" row | Applied: the test added to Step 1 and named in the mutant row |
| 16 | low | `off` undefined on an unreadable switch | FM1 fails closed for starts | Applied: `off` treats it as phase `on` (resume from the manifest, or remove the switch); a red test (spec §3.6, FM4) |
| 17 | low | After a succession, markers name the predecessor | `coordinatorId` is written once at dispatch | Applied: stated as a known weakening (the spread stays a preference, the role degrades to `plain`); no second writer, so K16 holds (spec §4.2) |

Found while applying: an inactive `pending` row (stopped by a crash before its state rewrite, or held by a reboot under the switch) was not resumed by `off`. The pacer now resumes `pending` rows too (spec §3.4 crash windows, §3.6, FM4).

## Deviations and decisions

### Issued for this work and defined here

This programme was issued D-5950 to D-5959; this plan defines all ten, one per task.

- **D-5950** — `maintenance-switch-and-refusals` (Task FM1; spec §3.3): `$REG/maintenance` makes `start`, `enable`, `ensure` and `ws-add` refuse `maintenance` and `supervise` exit with a status the unit neither restarts nor marks failed, unless the row holds a maintenance pass (`$REG/<id>.maint-pass`, a file the unit can read, written by the pacer, every swap at its entry and an in-flight roll's act); `swap`, `swap-self` and `prefer` are never refused (the 2026-10-19 ruling), and an unreadable switch refuses starts only.
- **D-5951** — `swap-unit-names` (Task FM2; spec §3.5): swap units are named `ccd-swap-<id>-<epoch-ms>` so maintenance can wait for them, and a failed named start retries unnamed, so naming never blocks a swap.
- **D-5952** — `maintenance-on` (Task FM3; spec §3.4): the switch first (under the roll node lock), then a write-ahead manifest of active rows (hibernated and stopped ones excluded) with the lowered pauses it will raise, then the pauses, a tmux placeholder, then each row drained and stopped back to back: swaps and rolls waited for and never cancelled (a row still busy at the bound is skipped and left running, and a second `on` finishes it without rebuilding the manifest), a row hibernated since the manifest left alone, a swap dispatched between drain and stop waited for and the row stopped again, each stop journalled with `cause=maintenance`.
- **D-5953** — `maintenance-off-paced` (Task FM4; spec §3.6): a detached pacer starts the manifest through `cmd_start`'s path, mid-turn first, then `bg > 0`, coordinators, the rest, behind the roll's spawn-start spacing (window 25 s, a parameter of the extracted helper), its memory floor and `roll-in-flight`, never holding a swap; failed starts are reported, a dead pacer is continued by a second `off`, only maintenance's own pauses are lowered and the switch goes last.
- **D-5954** — `ccrc-maintenance-door` (Task FM5; spec §3.4, §3.7, §3.8): `ccrc maintenance` takes the update lock for each command, `ccrc update` refuses `maintenance` while the switch stands, the timers whose unit file declares `X-Ccrc-Maintenance=stop` are stopped, and ccd is called; it is the operator's act, never a session's.
- **D-5955** — `maintenance-server-holds` (Task FM6; spec §3.9): the switch is a `SWITCHES` row read by `readSwitches` as `MarkerState`, with one content reader of the switch and its manifest that fails shut on `unmeasurable`; every start-making lane holds quietly under it, the stall and dead-coordinator lanes keep their existing owners, and `maintenance` joins the dead-coordinator lane's deliberate acts for the hold-without-stop case; health carries it additively with `resumed` and `total`.
- **D-5956** — `orphan-d-deliberate-clock` (Task FM7; spec §3.10): `orphan-d` waits 60 s instead of 15 minutes when a `maintenance` phase `resume` row precedes `restartAt` with exactly one successful spawn between them; its arming and everything else are unchanged.
- **D-5957** — `programme-spread-rank` (Task FP8; spec §4.2 to §4.4): `$REG/<id>.programme` (`<program> <coordinatorId>`, the run's existing programme slug) written by `ws-add` and read by one `_programme_read`; each placement walk ranks by (its own tier, members on the lane, its existing order) with a tier boundary at 80, a preference that never removes a candidate and runs only inside the walk.
- **D-5958** — `programme-dispatch-and-spread-count` (Task FP9; spec §4.2, §4.5): the programme is the run's existing `program` field; dispatch passes it behind `programme-v1`, and the server's pure `programmeSpread` groups by the same field and counts each programme's children and distinct lanes on the runs wire.
- **D-5959** — `maintenance-and-spread-display` (Task FM10; spec §3.9, §4.5): a read-only maintenance banner and the "N children on K lanes" line, both rendered from server fields, cards unchanged and headers the superset.

## Out of scope

Pacing the cold-boot start; a PWA or agent control for maintenance; arming stall-watch wave 2 or changing `orphan-d` for swaps and revivals; waiting for turns to end before `on`; moving running sessions to improve a spread; a server swap suggestion for the SwapSheet; maintenance on macOS nodes.
