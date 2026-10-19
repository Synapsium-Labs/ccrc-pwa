# Fleet operations: maintenance mode and programme-aware placement (design)

**Status:** approved by the coordinator under the operator's autonomous-backlog mandate of 2026-10-19; the operator may overrule any decision. Rev 1, 2026-10-20 (rev 1 applies the first review; the plan's review log lists each finding). No question in this design was left open for the operator: each one is answered with the safest option that needs no ruling, and §9 lists the decisions the operator is most likely to want to revisit.

**Issues:** #296 (fleet maintenance mode, and the nudge for sessions that restart idle over killed background work) and #749 (programme-aware account placement: spread a coordinator and its children across lanes).

**Plan:** `docs/superpowers/plans/2026-10-20-fleet-operations-maintenance-mode-and-programme-.md` (ten tasks, D-5950 to D-5959).

**Builds on:**
- `2026-10-18-claude-binary-lifecycle-design.md` and its W2 plan (`2026-10-19-claude-binary-lifecycle-w2-roll.md`): the roll's `recent-spawn` and `low-memory` holds, `roll-in-flight`, the spawn-start stamp (CB2b), `RestartPreventExitStatus` on the session unit (CB2b), and the `.swap-waiting` yield that keeps a roll from ever blocking a swap. #296 asked for maintenance to be designed after this roll lands; the design is written now and every task that needs the roll's pieces is gated on them (plan §Gates).
- `2026-10-16-working-state-and-interruptions-design.md` (hibernation, D-5242): a hibernated row is never woken or swapped behind the wake paths' budget, and its contract stands unchanged here.
- `2026-09-29-worker-stall-watch-design.md`: the `orphan-d` arm and its 15-minute idle clock.
- `2026-09-23-session-continuity-design.md` §5.3 (the "not-stalled restart") and #197.
- `2026-10-17-coordinator-first-routing-design.md`: a child's asks go to its coordinator first.
- `2026-10-19-ccrc-consolidation-wave-design.md` (on branch `docs/consolidation-wave-spec`, draft rev 1): contexts C1 and C2, clusters K11, K12, K15 and K16, and the waves. §7 fits this design into it.
- `2026-08-10-architecture-ddd-clean-solid.md` and the CLAUDE.md architecture aim (#816): one owner per job; consolidate into the existing owner, never add a parallel mechanism.

**Citations** are to `origin/main` `4bc6c756d`, written `≈:` with a function or constant name beside each line hint. **[I]** marks a fact taken from an issue's own evidence (measured on the fleet node by the session that filed it; this design took no measurement on any box). **[C]** marks a fact read from code.

---

## 1. The problem

### 1.1 Nobody owns "pause the whole fleet" (#296)

ccd can stop one session (`cmd_stop` ≈:28106) and raise single-purpose pauses: `ccd coord-pause` (`cmd_coord_pause` ≈:9002), `ccd reclaim-pause` (`cmd_reclaim_pause` ≈:28511) and the hand-touched `~/.ccrc/tmp-sweep-paused` (`ccd-tmp-sweep` ≈:92). Nothing pauses and resumes a fleet [C].

On 2026-10-05 a cutover moved Claude Code's scratch for 41 sessions onto a volume and rebuilt the quiesce by hand from ccd internals [I]. What the script had to own, and what went wrong:

1. It stopped every user timer except `ccd-cap-scopes`. They stayed off through the resume, so the pool-sync lease lapsed [I].
2. It stopped `ccrc-agent`, so the PWA was blind for about five minutes [I]. The agent's grant includes `start`, `ensure`, `swap` and `ws-add` (`agent/src/whitelist.ts` ≈:413), which is why the script stopped it; a fleet-wide refusal would have let it stay up.
3. It stopped `claude-session@*` by pattern, because a unit in its `Restart=` gap reads `activating` [I].
4. It had to cancel pending auto-swaps. `_dispatch_swap` (≈:17291) sleeps `SWAP_JITTER` (120 s, ≈:1346) inside a transient unit started by `_svc_run_detached` (≈:1051), which runs `systemd-run --user --collect --quiet` with **no unit name** [C]. The ExecStart text of a `run-*.service` was the only handle [I].
5. It held `~/.ccrc/update.lock`, which `_upd_lock_holder` (`ccd/ccrc` ≈:18806) then attributed to the last real update [I].
6. It kept the tmux server alive with a placeholder session, then killed the `cc-*` sessions [I].
7. It started one session every 25 s, mid-turn first. Nothing paces a fleet-wide start: `claude-session@.service` is `WantedBy=default.target` with `Restart=always` [C].

### 1.2 Sessions restart idle over killed background work (#296)

All 41 panes were back within about 18 minutes; ten sat idle under Claude Code's notice that background tasks had not finished before the previous session ended [I]. Each had ended its turn to wait on background agents, workflows or shells. A mail to each made all ten busy within a minute [I].

This is the continuity design's "not-stalled restart", working as designed:
- `RESUME_INTERRUPTED_TURN=1` (≈:1451) and `_redrive_after_spawn` (≈:23826) re-drive only an interrupted turn; an ended turn leaves no resume pair for `_transcript_stalled_pair` (≈:23551) to find [C].
- The wake-up is the stall watch's `orphan-d` arm (`stallOrphanDInner`, `server/src/coord/stall.ts` ≈:1694), fed by `lostBg` from the hook's turn marker (`ccd/session-hook.sh` ≈:3286-3294). It is a wave-2 arm (`stall.ts` ≈:76) that records shadow only until `stall-watch-w2-live` exists or Settings arms it, and armed it waits `ORPHAN_D_IDLE_MS` (15 min, `stall.ts` ≈:340) [C]. That 15 minutes was chosen on a measurement: 13 of 21 orphaned restarts healed themselves within 2.4 minutes [I].

For a restart the operator chose, the 15-minute wait buys nothing: the cut was deliberate, and nothing will heal it.

### 1.3 Placement does not know programmes (#749)

A session's lane is chosen per session [C]:
- **Placement** (`cmd_ws_add` ≈:6961 → `_place_for_class` ≈:19598 → `_ws_least_loaded` ≈:6648): the home-able account with the lowest `_limit_score` (≈:17630) that passes `_account_ok`, `_pool_ok` and the class gate.
- **Auto-swap** (`_auto_swap_check` ≈:18691): stay on home, leave only when home is at the ceiling, return home when it has room. The destination is `_swap_target` (≈:17788), whose candidate walk (≈:18005-18212) ranks by `_limit_score` within the home-able bracket, then the overflow bracket.
- **Billing groups** are account pools (`shared/roster.ts` ≈:214, "a billing or tenancy pool"): a candidate must pass `_pool_ok`, and a swap's candidates come from the session's rotation, `_pool_for` (≈:17289).

None of these know which programme a session belongs to. A coordinator and all its children can land on one account; one 5-hour or weekly limit then stalls the whole programme and sets off a cluster of swaps, which works against the no-herd rule. The operator, 2026-10-19: different workspaces "maybe they should PREFER to be on different accounts even" for resilience.

What ccd knows about a child today: `ws-add --child <runId>` writes `$REG/<id>.child` holding only the run id (`_reg_set "$id" child`, ≈:7421), validated as a bare positive integer by `_child_runid_valid` (≈:22883) [C]. ccd cannot map a run to its programme or its siblings. The server can: a run's `claimedBy` is the programme-ownership edge (`shared/api.ts` ≈:6405), and the run's `sessionId` is its worker.

---

## 2. Operator rulings that bind this design

- **Account switching and the auto-swap are never blocked** (2026-10-19). Neither maintenance nor the spread may refuse, cancel or delay a swap.
- **No herd restarts.** Nothing here restarts sessions in a burst; the resume is paced, and the spread never moves a running session on its own.
- **Hibernation's contract** (D-5242): a hibernated row is not woken or swapped by these features.
- **Coordinator-first routing**: the resume order puts coordinators before their children.
- **The SAFETY rules** in CLAUDE.md: `ccd maintenance` and `ccrc maintenance` are the operator's acts, never a session's (§3.8).
- **UI at 360, 390, 1280 and 1920 px, in the refined and instrument skins, dark and light.** A card is a glance and its header a superset.

---

## 3. Maintenance mode (#296)

### 3.1 The shape in one paragraph

`ccrc maintenance on [--reason <text>]` takes `~/.ccrc/update.lock` for the duration of the command (so it never starts during an update), stops the timers whose unit files declare `stop`, and calls `ccd maintenance on`. ccd writes the switch `$REG/maintenance`, records a manifest of every running session together with the pauses it is about to raise (write-ahead), raises them, waits for each session's in-flight swap or roll to finish, and stops each session through `cmd_stop` while keeping the tmux server. While the switch stands, `ccrc update` refuses `maintenance` by reading the switch. The agent never stops; the PWA shows a banner. `ccrc maintenance off` runs one detached unit that calls `ccd maintenance off --wait`, which starts the manifest's sessions one at a time through `cmd_start`'s own path, in a fixed order, paced by the roll's own spawn and memory measures, then lowers the pauses it raised, removes the switch and restarts the stopped timers. Sessions that had lost background work get the `orphan-d` mail as soon as their pane settles.

### 3.2 Who owns which half

**Question:** `ccrc maintenance` or ccd `fleet-pause`/`fleet-resume`?

- (a) Everything in `ccrc`. Rejected: stopping and starting supervisors and panes is ccd's job. ccd is the one component that names tmux and the session units (consolidation C2's anti-corruption layer), and the SAFETY rules forbid any other actor to touch them.
- (b) Everything in ccd. Rejected: the update lock, the timers and their install belong to `ccrc` (`_upd_lock` ≈:18855, the timers' installer).
- (c) **Chosen: two halves, one door.** `ccd maintenance on|off|status` owns the sessions (the switch, the refusals, the pauses, the manifest, the swap drain, the stops and the paced resume). `ccrc maintenance on|off|status` owns the box (the lock, the timers) and calls ccd. The operator's door is `ccrc maintenance`; ccd's verb is its session half and may be run alone on a box without `ccrc` timers.

Neither verb is granted to the agent. The PWA reads the state and cannot change it (§3.9); maintenance is a shell act by the operator, like `ccrc update`.

### 3.3 Which verbs refuse under `$REG/maintenance`

**Question:** which verbs refuse while the switch exists?

The rule: **a verb that would start a Claude Code process refuses, except a swap.** Everything else is unchanged.

| Verb | Under the switch | Why |
|---|---|---|
| `start`, `enable`, `ensure` | refuse `maintenance`, exit 4, nothing touched, unless the row holds a maintenance pass | they start a pane; `ensure` is also the mail lane's wake and the PWA's Restart |
| `ws-add` | refuse `maintenance` | it mints a session and starts it |
| `roll` (lifecycle CB2c) | hold `maintenance` at its gate | a roll is a restart |
| `supervise` (the unit's ExecStart) | exit with the maintenance status, never spawn, unless the row holds a maintenance pass | covers a reboot during maintenance, and a hand `systemctl --user start` |
| `swap`, `swap-self`, `prefer` | **unchanged** | the 2026-10-19 ruling; see below |
| `stop`, `hibernate` | unchanged | they start nothing |
| `coord-pause`, `reclaim-pause`, every read verb | unchanged | |
| `ws-reclaim`, `ws-expire`, `ws-collect` | unchanged in ccd | held by `reclaim-paused`, which maintenance raises (§3.4) |

**Swap is not refused, and that is a ruling, not an omission.** #296 proposed refusing `swap`; the later ruling forbids it. What keeps maintenance whole without a refusal:
- the auto-swap runs inside each supervisor's tick, and every supervisor is stopped, so no automatic swap is decided during maintenance;
- a swap already dispatched is waited for, never cancelled (§3.5);
- a swap the operator types during maintenance carries the conversation and starts that one session on its target, as it always does (`cmd_swap` ends in `_svc_start ... || cmd_ensure`, ≈:27966). It is the operator's explicit act. Because the unit's `ccd supervise` would otherwise read the switch and exit, `cmd_swap` writes the row's maintenance pass (below) before its start whenever the switch stands. The resume skips a manifest row that is already running.

**The supervise hold.** With `Restart=always` and `WantedBy=default.target`, a supervisor that exits non-zero is restarted every 3 s until the start limit marks it failed, and a failed unit reads `orphan`. So `cmd_supervise` (≈:24851) exits with a dedicated status that the unit lists in both `RestartPreventExitStatus=` and `SuccessExitStatus=`: the unit ends inactive, not failed, and is not restarted. The status is chosen beside the roll's spawn-cap status (lifecycle CB2b adds the unit's `RestartPreventExitStatus=` line); the two share that one line.

**The maintenance pass.** The hold must be readable by the unit itself: a variable set on the caller of `_svc_start` (a bare `systemctl --user start`, ≈:906) never reaches the unit's `ccd supervise %i`, and the unit file has no `PassEnvironment=`. So the exemption is a registry file, `$REG/<id>.maint-pass`, written by `_maint_pass <id>` before the start and read by `cmd_supervise`, `cmd_start` and `cmd_ensure`. Its writers are exactly the starts allowed while the switch stands: the resume pacer (§3.6), `cmd_swap` (every swap, automatic or typed, in every phase), and the roll's detached act and restore (lifecycle CB2d) for a roll already past its gate when the switch was written (§3.4 step 4). The pass is not consumed by a start: a resumed or swapped supervisor that restarts after a crash, or swaps again during `resuming`, still passes. Every pass is removed when the switch is removed, and a pass purges with its row (`_reg_purge`). Without the switch a pass means nothing.

Alternatives considered for the exemption: an environment variable on the caller (rejected: it does not reach the unit, which is the defect the pass fixes); holding only in phase `on` (rejected: a reboot during `resuming` would then start every unit at once, a herd).

Alternatives considered for the hold: (a) `systemctl --user disable` every unit at `on` and `enable` at `off`. Rejected: it rewrites the operator's install state, and a crash between the two leaves the fleet disabled at the next boot. (b) A drop-in written at `on` and removed at `off`. Rejected: the same crash window, plus a daemon-reload per toggle.

**The refusal word.** Each refusal prints the `refusal-v1` envelope when the consolidation's ARCH-14 helper exists (W5), and today's `die` text otherwise; the word is `maintenance` either way, so the server maps it once (§3.9).

### 3.4 `on`, step by step

`ccd maintenance on [--reason <text>] [--drain-wait <s>]` (default 300 s), refused inside a session (`CLAUDECODE` set, the history verbs' speed bump):

1. **A standing switch means "finish", never "start again".** In phase `on`, a second `on` never rebuilds the manifest (it would leave out every row the first `on` stopped, since those now carry `.stopped`, and `off` would never resume them). It re-runs steps 4 and 5 for the rows marked `skipped` in the existing manifest only, and answers `already` with its `since` and reason when none is left. In phase `resuming`, `on` refuses `resuming`: finish the resume with `off` first.
2. **Write the switch first**, `$REG/maintenance`: `<since> on <reason, base64>`, under the roll's node lock (`flock -x $REG/.claude-roll.lock`, lifecycle CB2c), so no roll can pass its gate between the switch and the drain. From this moment every start without a pass refuses, so nothing the next steps stop can come back.
3. **Write the manifest before anything changes (write-ahead)**, `$REG/.maintenance-manifest`, by one staged rename: a header with `since` and one `pause <name>` line per existing pause that is **lowered now** (`coord-pause`, `reclaim-pause`, `~/.ccrc/tmp-sweep-paused`), then one row per session whose unit is active or activating: id, role, the live status word (`busy`, `idle`, `shell`), the turn marker's `bg` count, and a state (`pending`). Hibernated rows and rows already `.stopped` are not recorded: they are not maintenance's to resume. The role comes from local files only, because the server's `claimedBy` is not ccd's to read: a row named as `coordinatorId` in any `.programme` marker (§4.2) is a `coordinator`, a row with `.child` is a `child`, and any other row is `plain`. A coordinator whose children predate the marker reads `plain` and resumes in its status tier, which costs order, not correctness.
4. **Raise the recorded pauses**, each through its own writer: `coord-pause --state on`, `reclaim-pause --state on`, and `~/.ccrc/tmp-sweep-paused`. No new pause is invented. Because the record was written first, a crash at any point leaves `off` lowering exactly the pauses that were lowered at `on`; lowering one that the crash left lowered is a no-op.
5. **Drain swaps and rolls, per session, never cancel.** For each `pending` row, wait until no `ccd-swap-<id>-*` unit is active (§3.5) and no live `$REG/<id>.rolling` exists (lifecycle CB2d's act; its start passes the hold through the pass, §3.3), up to `--drain-wait`. A row still swapping or rolling at the bound is **left running** and marked `skipped` (`swap-in-flight` or `roll-in-flight`) in the manifest and the output; the operator runs `on` again to finish it (step 1). A canary soaking after its act (`.claude-canary`) is stopped like any other row: lifecycle CB2e judges a stop during the soak `inconclusive`, which never halts a build.
6. **Stop each remaining row**, one at a time, through `cmd_stop`'s own path (journalled with `cause=maintenance`), after first creating a placeholder tmux session `ccd-maintenance` so the tmux server survives the last pane. Each stop rewrites its row's state to `stopped`. Stopping is not a herd: it frees memory and spawns nothing.
7. **Report**: counts by role and status, the skipped rows, and the pauses raised.

**Crash windows.** The switch alone (crash before step 3): `off` finds no manifest, so nothing was stopped and no pause was raised; it removes the switch and reports that. Switch and manifest (crash in steps 4 to 6): `off` lowers the recorded pauses and resumes the rows whose state is `stopped` or `skipped`, skipping any that are still active. The manifest is only ever replaced by a staged rename, so it is either absent or whole.

`ccrc maintenance on` runs, in order: take `~/.ccrc/update.lock` through `_upd_lock` for the duration of the command (refuse if an update holds it: maintenance never interrupts an update); stop every timer whose unit file declares `X-Ccrc-Maintenance=stop` (§3.7), recording which in `~/.ccrc/maintenance-timers`; call `ccd maintenance on`; release the lock as the process exits. If ccd's half fails, `ccrc` restarts the timers it stopped. The lock is an fd-held `flock` (`_upd_lock` ≈:18855), so it cannot outlive the command; what keeps an update out between `on` and `off` is the switch: `ccrc update` reads it through ccd (`ccd maintenance status`, the one reader) and refuses `maintenance`. `_upd_lock_holder` (≈:18806) is unchanged, because the lock is never held across maintenance.

### 3.5 Naming swap units

**Question:** how are swap units named so maintenance can find them?

- (a) #296's `--unit=ccd-swap-<id>`. Rejected as written: a transient unit's name must be unique while it is loaded, so a second swap dispatched for the same id before the first is collected would make `systemd-run` fail, and a failed dispatch is a blocked swap.
- (b) **Chosen: `--unit=ccd-swap-<id>-<epoch-ms>`**, through `_svc_run_detached`'s new optional name argument, used by both `_dispatch_swap` and `cmd_swap`'s detach arm (≈:27717). If the named start answers non-zero, the caller first asks whether the exact unit it named is loaded (`systemctl --user show -p LoadState`): when it is, the swap was dispatched (a reply lost after the unit was created, such as a D-Bus timeout) and is not dispatched again, because `cmd_swap` has no per-id lock and a second dispatch would run two swaps of one session. Only when it is not loaded is the call retried once **unnamed**, exactly as today: naming may never block a swap. On macOS (`nohup` arm) the name is ignored. Maintenance finds a session's swap with `systemctl --user list-units --state=active,activating 'ccd-swap-<id>-*'`.
- The id passes `_reg_id_ok` before it reaches a unit name; Step 0 of the task checks that the id grammar is a subset of systemd's unit-name characters, and escapes through `systemd-escape` if it is not.

Maintenance **waits for** these units and never stops them (§3.4 step 5). The name is a handle for measurement, not for a kill.

### 3.6 `off`: order, stagger and the shared pacing

**Question:** what are the resume stagger and order, shared with the lifecycle's roll?

`ccd maintenance off [--stagger <s>] [--wait]` writes `on` → `resuming` in the switch (starts without a pass still refuse), and starts the pacer in its own transient unit `ccd-maintenance-resume` (the roll's "always detached" rule: an ssh session that ends must not orphan a half-done resume; see the operator runbook's lesson on long remote operations). `--wait` blocks the caller until the pacer finishes; `ccrc maintenance off` uses it from inside its own detached unit.

**Order** (one list, stable within each tier by the manifest's order):
1. **Mid-turn** rows (status `busy` at `on`): their interrupted turn is re-driven by `RESUME_INTERRUPTED_TURN`, and every minute they wait is a turn in flight. Coordinators first within the tier.
2. **Rows with background work cut** (`bg > 0` at `on`): they will need the nudge (§3.10). Coordinators first.
3. **Coordinators** not already started.
4. **Everything else.**

Coordinators lead each tier because of coordinator-first routing: a child's first ask goes to its coordinator, and a coordinator that is not up yet turns that ask into a stall.

**Stagger.** A row is started only when all three hold:
- **spacing:** no spawn has **started** on the node in the last `--stagger` seconds (default **25 s**, minimum 10), measured by the roll's **spawn-start stamp** (lifecycle CB2b's stamp, read through CB2c's `recent-spawn` reader with the window as a parameter). A swap's spawn counts, so a swap during the resume pushes the next start back instead of stacking on it, and nothing holds the swap;
- **memory:** the roll's `low-memory` measure (`_mem_headroom`, lifecycle CB1c: the minimum over the slice and each ancestor of `memory.max` minus `anon`) reads at least 3 GiB; below it the pacer waits and re-measures every 10 s, and never skips a row;
- **no roll in flight** on the node (`roll-in-flight`). Rolls themselves hold `maintenance` while the switch stands, so in practice this only covers a roll that started before `on`.

25 s is #296's own measured cadence: 41 sessions resumed in about 18 minutes without an OOM kill [I]. The roll's 120 s `recent-spawn` window would make the same resume take 80 minutes, which the operator did not choose. In the W2 plan, `recent-spawn` and `low-memory` are holds written inline in `cmd_roll`'s gate, so FM4 first extracts them into two helpers that the roll gate and the pacer both call, with the window as a parameter (the roll keeps 120 s, pinned by the roll gate suite): the two callers share the measure without sharing the number.

**Alternatives considered:** a fixed sleep between starts (rejected: blind to swaps and to memory, a second pacing mechanism beside the roll's); starting by `systemctl start` of every unit at once (rejected: the herd); holding the auto-swap until the resume ends, as #296 proposed (rejected by the 2026-10-19 ruling; the shared spawn measure gives the same spacing without a hold).

**Each start** goes through the existing start owner, never a bare `_svc_start`: `on` stopped the row through `cmd_stop`, whose `_ws_unsupervise` disabled the unit, removed `.supervised` and wrote `.stopped`, so only `cmd_start`'s path (the `.stopped` removal, `_hib_wake_clear`, and `_supervised_start`'s enable, `reset-failed` and wait for a verdict) brings the row back supervised and able to survive the next reboot. For a row whose state is `stopped` or `skipped` and whose unit is not active (a row the operator swapped is skipped), the pacer writes the row's pass, journals `maintenance` phase `resume` **before** the start (so the hook's `restartAt` can never precede it, §3.10), then runs that path. A start that fails is marked `failed` in the manifest and in `status`, and the pacer goes on to the next row. When the last row has been tried, the pacer lowers the pauses the manifest records, removes the placeholder tmux session, removes every pass, deletes the manifest and then the switch, and journals `maintenance` phase `done`, listing any `failed` rows.

**`off` re-run.** In phase `resuming` with the pacer's unit no longer active (an OOM kill while the fleet restarts is plausible), `off` starts a new pacer, which continues from the manifest: rows already `started` or active are skipped. While the pacer's unit is active, a second `off` refuses `resuming`. With no manifest, `off` removes the switch and reports that nothing was stopped (§3.4, crash windows).

**Cold boot** could reuse the pacer, as #296 suggests. It is out of scope (§8): today's boot start is not maintenance's to change, and doing so changes every reboot.

### 3.7 Timers: declared in the unit file

**Question (implied by #296's step 1):** which timers stop?

- (a) A hand-kept list in `ccrc`. Rejected: a second enumeration of the timers beside their unit files, which consolidation K11 forbids ("the systemd `.timer` files are the one source").
- (b) **Chosen: each shipped `.timer` declares `X-Ccrc-Maintenance=keep|stop` in its `[Unit]` section** (systemd ignores `X-` keys). `ccrc maintenance` reads the declaration from the installed unit file. A test pins that every shipped timer declares exactly one value.

The initial declarations: **keep** `ccd-cap-scopes` (the OOM guardrail), `ccd-pool-sync` (the lease that lapsed in the incident), `ccd-account-health`, `ccrc-ddns`, `ccrc-update-watchdog`, `ccrc-codex-usage@`, `ccd-update-sync` (its update-intent projection is a leased cache, and letting that lease lapse is the incident's own failure class) and `ccd-telemetry-keepalive` (it measures accounts, not sessions; stopping it during a long maintenance would leave lanes unmeasured at resume, and an unmeasured lane makes `_swap_target` decline to choose, so the first auto-swaps after the resume would decide on stale data); **stop** `ccd-tmp-sweep`, `ccd-scope-sweep`, `ccd-usage-sweep`, `ccd-graph-sweep`, `ccd-history-sweep` and `ccrc-models`. The watchdog stays because it acts only on a self-update that died, and the switch refuses any new one.

### 3.8 Who may run it

`ccd maintenance` and `ccrc maintenance` refuse inside a session (`CLAUDECODE` set) and, for `on` and `off`, inside a `cc-*` pane: the history verbs' speed bumps, which are not walls. The plan's CLAUDE.md edit adds both to the SAFETY section as operator acts. No agent grant, no route that writes it.

### 3.9 What the server and the PWA do

- **One reader.** The switch is read once per tick at one site, beside `COORDINATOR_PAUSE_MARKER` (`server/src/coord/rundefs.ts` ≈:57, read in `watch.ts` from the registry listing). A name-only listing cannot carry `since`, the phase, the reason or the resume's progress, so the reader, at that one site and through the watcher's own io, reads the switch's content and the manifest when the listing names the switch, and returns `{ since, phase, reason, resumed, total } | null | 'unreadable'` (`resumed` counts manifest rows whose state is `started`; `total` counts the rows). When consolidation W1a's `SWITCHES` table has landed, the switch is a row there instead (storage: marker; writer: `ccd maintenance`; meaning: fleet maintenance; route: none). Either way there is one reader.
- **Holds, only where a lane would start a process.** The mail lane's wake, hibernation's wake paths, the PWA's Restart/ensure route, and the roll route and auto-roll read the switch first and hold quietly. Dispatch is already held by `coordinator-paused`, which maintenance raises. ccd's own refusal stays as the act-time guard (the consolidation's TOCTOU rule: the server re-measures, ccd re-decides).
- **No new hold where an owner already covers the case.** The stall watch already holds a stopped session (`if (lc === 'stopped') return holdVerdict('lifecycle-stopped')`, `stall.ts` ≈:1087, D-3610), and the dead-coordinator lane already treats a `stop` as deliberate (`DEAD_COORDINATOR_DELIBERATE_ACTS`, `server/src/deadCoordinator.ts` ≈:69). Maintenance stops through `cmd_stop`, so both apply unchanged, and a test proves it instead of a second hold. The gap is after the switch: a coordinator whose resume failed reads `orphan`, and its newest act is `maintenance`, which is not in the deliberate list, so the lane would fail its runs and clean up its workers. `maintenance` joins `DEAD_COORDINATOR_DELIBERATE_ACTS`, as `hibernate` did for the same case.
- **Wire.** `GET /api/fleet/health` gains an additive `maintenance: { since, phase, reason, resumed, total } | null`; absence (an older server) means nothing to show. The server maps ccd's `maintenance` refusal word to `409 { refused: 'maintenance' }`.
- **PWA.** A fleet banner: "Maintenance since 14:02 — moving scratch (resuming 12 of 41)". The banner is the glance; a stopped row's session header already reads stopped, and its Restart command shows "maintenance" as its hold. No per-row maintenance field is added to the session projection. Read-only: no PWA control turns maintenance on or off.

### 3.10 The nudge at `off`

**Question:** does `off` send `orphan-d` at once to sessions with `lostBg > 0`?

- (a) ccd mails each such session itself through `ccrc-api`. Rejected: a second writer of the same mail the stall watch owns.
- (b) Arm wave 2 for these sessions regardless of the operator's arming. Rejected: arming wave 2 is the operator's call (#296 says so), and an arm that sends while its level says shadow is a lie in the Settings control.
- (c) **Chosen: the `orphan-d` arm's idle clock depends on the restart's cause.** When the session's newest lifecycle row before `restartAt` is `maintenance` phase `resume`, the clock is `ORPHAN_D_DELIBERATE_IDLE_MS` (60 s: the pane settles, nothing heals a deliberate cut) instead of `ORPHAN_D_IDLE_MS`. Everything else about the arm is unchanged: its arming level, its holds, its two rungs, its subject and its key. Shadow stays shadow.

So `off` sends the mail at once **when the arm is armed**. When it is not, `ccd maintenance off` prints the `bg > 0` rows from its manifest, so the operator can mail them by hand, as on 2026-10-05.

Whether ccd's own swaps and revivals deserve a shorter clock is the stall-watch owners' question (#296 says so) and is not changed here: the deliberate clock keys on the `maintenance` cause only.

---

## 4. Programme-aware placement (#749)

### 4.1 The shape in one paragraph

When the server dispatches a child it passes `ws-add --programme <rootRunId> --coordinator <id>`, and ccd writes `$REG/<id>.programme`. ccd's two placement walks (`_ws_least_loaded` for a new child, `_swap_target` for a session leaving its lane) rank candidates by one more key, **how many of the session's programme members already sit on that lane**, inside the existing tiers and after every existing filter. The spread is a preference: it never removes a candidate. Home affinity is unchanged, because the spread only chooses which lane a session goes to when it is placed or must leave. The server computes each programme's spread and the run board shows "4 children on 3 lanes".

### 4.2 How ccd learns the programme and its siblings

**Question:** a registry marker at dispatch, or a server query on the tick?

- (a) **A server query on the tick.** Rejected: the auto-swap must decide with the server down (consolidation K15, the 2026-10-19 ruling), and a query on the 5 s tick costs a round trip per session.
- (b) The server passes an `--avoid <lanes>` list at dispatch. Rejected for swaps: the list is stale by the time a swap happens, and it puts placement decisions on the server, which never places a session (CLAUDE.md, account pools).
- (c) Extend `.child` with more fields. Rejected: `_child_runid_valid` accepts a bare integer only, so an older ccd would read the new content as "not a child" and its reclaim path would stop recognising the row.
- (d) **Chosen: a new marker `$REG/<id>.programme` written at dispatch.** Content: `<rootRunId> <coordinatorId>`, validated on read (a positive integer and an id that passes `_reg_id_ok`); anything else reads as no programme. `rootRunId` is the programme key, defined once on the server: `programmeKey(runs, coordinatorId)` (pure, L1, in `programmeSpread.ts`), the lowest run id, in any state, that the coordinator holds as `claimedBy`. Dispatch passes that value to ccd and `programmeSpread` groups by it, so the two sides cannot hold two definitions of "programme". Run ids survive a succession (the reclaim door moves `claimedBy` for every run, never ids), so when the successor held no runs of its own the key is unchanged across the replacement. When the successor already coordinated other runs, two programmes merge on the server, the key can drop to the successor's older run, and ccd sees children dispatched before and after as two groups until they leave their lanes: a weaker spread, never a wrong placement, since the spread only reorders. `coordinatorId` lets a child avoid its coordinator and a coordinator find its children. The marker purges with the row (`_reg_purge` ≈:3849) and its writer is `cmd_ws_add` alone.

**Members of a session's programme**, computed by ccd from local files only: the coordinator named in the session's marker, plus every row whose `.programme` names the same `rootRunId`; for a coordinator (a row named as `coordinatorId` in any marker), every row naming it. A member counts on lane L when its registry row exists (`.uuid`) and its `.wrapper` is L; a hibernated member counts, because it wakes on its home.

The server composes the new flags only when the node's `ccd caps` lists `programme-v1` (`capSupported`, absent refuses), so an older node sees exactly today's argv.

### 4.3 How the spread ranks, and how it fits affinity and billing groups

**Question:** how does the spread fit stay-home/return-home affinity and billing groups?

The ranking key becomes a triple, compared in order: **tier**, then **members on the lane** (fewest first), then the walk's existing order. The tiers are each walk's own order made explicit, because the two walks do not rank alike today:

- **`_ws_least_loaded`** (≈:6834-6890) keeps the lowest `_limit_score` among scored lanes, falls back to the first measured lane with no score (`firstm`), then to the first unmeasured lane (`first`), then to the first auth-dead lane (`condemned`), and has no ceiling filter. Its tiers: (1) scored ≤ `SPREAD_SCORE_MAX` (80); (2) scored above 80, the ceiling included; (3) measured with no score; (4) unmeasured; (5) auth-dead. Within tiers 1 and 2 the third key is the score; within 3 to 5 it is roster order. Ties keep roster order, as `sc < bs` does today.
- **`_swap_target`'s candidate walk** (≈:18005-18212) already scores an unmeasured lane 100 and an auth-dead one 101 and filters the ceiling through `_avail`. Its tiers: (1) scored ≤ 80; (2) scored above 80, to the ceiling; (3) unmeasured; (4) auth-dead; the third key is the score, ties in roster order. Its home-able and overflow brackets stay outside the triple.

With no `.programme` marker every count is 0, and within each walk the tiers reproduce its present order, so the order is today's. `projectHome`'s parity with `_ws_least_loaded` (`server/test/projected-home.test.ts`) is untouched (`projectHome` answers a new session in a project, which has no programme), and FP8 adds a parity fixture with the mixed cases (a measured lane with no score ahead of an unmeasured one in roster order, an auth-dead lane first, a lane above the ceiling) beside projected-home.

The tier boundary at 80 keeps the spread from sending a child to a lane nearly at its ceiling just to be alone: within the healthy tier the spread wins; above it, headroom wins. 80 is a named constant beside `SWAP_CEILING` (≈:1338), and the plan pins it.

- **Affinity:** unchanged. `_auto_swap_check`'s "stay home", "return home" and "rehome on pool mismatch" arms run first and untouched; the spread is consulted only in `_swap_target`'s candidate walk, which runs only when the session must leave, and in `_ws_least_loaded`, which seeds the home of a new child (`_ws_seed_home` ≈:4122). After that, the home is the home.
- **Billing groups:** the spread ranks only candidates that already passed `_account_ok`, `_pool_ok`, the class gate and the session's rotation (`_pool_for`). It never crosses a pool and never admits an overflow-only lane to the home-able bracket.
- **Kill switches** (`<w>-disabled`, auth-dead): filters run first, unchanged.
- **Coordinator apart:** a child counts its coordinator as a member, so the first child avoids the coordinator's lane whenever another eligible healthy lane exists; a coordinator that must swap counts its children.
- **Never blocking:** the spread only reorders. When every lane has members, the walk picks the fewest, then the lowest score; when only one lane is eligible, it is picked.
- **No re-spread:** nothing moves a running session to improve the spread. It applies to new placements and to swaps that are happening anyway.

### 4.4 Cost on the auto-swap hot path

**Question:** what does it cost on the hot path, given that swap must never be blocked and must work with the server down?

- **Server down:** the spread reads only `$REG` files. No network.
- **When it runs:** `_auto_swap_check` calls `_swap_target` every tick, but `_swap_target` returns at its "home is fine, stay" and "home recovered" arms (≈:17940-17960) before the candidate walk. The member count is computed only inside the walk, so the steady-state tick pays nothing. A walk happens when a session must leave, and `SWAP_COOLDOWN` (900 s) bounds it per session.
- **What it costs:** one glob of `$REG/*.programme` and one `read` per marker, with bash builtins only (no fork), memoised once per walk. With the fleet's 20 to 60 rows that is at most 60 small reads per walk. The tick-diet budget fixtures (`2026-10-13-supervisor-tick-diet-design.md`) are re-run and must stay within their budget; the plan's task adds a fixture that counts the reads in a no-marker tick (zero) and in a walk (bounded by the marker count).
- **Failure:** an unreadable or malformed marker counts as no programme. The spread degrades to today's ranking; it never refuses and never delays.

### 4.5 What the run board shows

**Question:** how does the run board show "N children on K lanes"?

- (a) The PWA joins runs to fleet sessions itself. Rejected: it would add a run↔session matcher in the PWA, which consolidation W7 is reducing to zero (K10, K14).
- (b) **Chosen: the server computes it.** One pure L1 function, `programmeSpread(runs, sessions)`, groups the active runs by `programmeKey` (§4.2, the same function dispatch uses), takes each run's worker `sessionId` through the store's existing binding reader (consolidation W6 later moves that input to `childrenOf`), and counts distinct current lanes. The runs projection gains an additive `spread: { children, lanes, coordinatorShares }` per programme; absence (an older server) shows nothing.
- **Where it shows:** the run board's programme group header ("4 children on 3 lanes"; "· coordinator shares a lane" when it does) and the coordinator session's header, which is the superset of its card. The card is unchanged: one context line, already full.

---

## 5. What this must not break

1. **No swap is refused, cancelled or delayed** by maintenance or by the spread. `cmd_swap` gains no refusal; `_dispatch_swap`'s naming falls back to today's unnamed start; maintenance waits for swap units and never stops them; the resume's spacing counts a swap's spawn but never holds one.
2. **No herd.** `on` stops one at a time; `off` starts one at a time behind the spawn and memory measures; a reboot during maintenance starts nothing.
3. **The tmux server survives** `on` (the placeholder session).
4. **Hibernated and already-stopped rows are untouched** by both `on` and `off`, and **every resumed session is supervised again** (its unit enabled, `.supervised` present), so the next reboot brings it back.
5. **An update is never interrupted, and none starts during maintenance:** `ccrc maintenance on` refuses while an update holds the lock, and `ccrc update` refuses `maintenance` while the switch stands.
6. **The agent stays up**, and the PWA keeps its view.
7. **Pauses the operator had raised stay raised** after `off`.
8. **Placement without a programme is byte-for-byte today's**, and `projected-home` parity holds.
9. **The `orphan-d` arm's arming is unchanged**; only its clock for a `maintenance`-caused restart.
10. **Wire changes are additive** (`maintenance` on health, `spread` on runs, the `maintenance` refusal code); `FLEET_PROTO` is not bumped.

**Rollback.** Every task is a plain revert. Rolling ccd back below the maintenance tasks while the switch stands leaves an older ccd that ignores `$REG/maintenance`: run `off` first. An older ccd ignores `.programme` markers and places as today; the markers purge with their rows.

---

## 6. Tests

Each task's red-first tests are in the plan. The behaviours they pin:

- **Refusals:** each of `start`, `enable`, `ensure`, `ws-add` refuses `maintenance` and touches nothing; `swap`, `prefer`, `stop` and every read verb behave exactly as without the switch; `supervise` exits with the maintenance status and never spawns, and passes when the row holds a pass; the unit file lists the status in both keys. Tests that run `cmd_supervise` itself (not only the systemctl stub) after a swap's start and after a pacer's start under the switch, and see it spawn.
- **Swap naming:** a dispatched swap runs as `ccd-swap-<id>-<ms>`; a non-zero answer whose named unit is loaded is not dispatched again; one whose unit is not loaded is dispatched unnamed; macOS ignores the name.
- **`on`:** the switch is written before any stop; the manifest, with its pause record, is written before any pause is raised and before any stop; only lowered pauses are raised; hibernated and stopped rows are not in the manifest; a row with an active swap unit or a live `.rolling` is waited for and, past the bound, skipped and left running; no build is halted by `on`; the placeholder keeps the tmux server; a second `on` finishes only the skipped rows and never rebuilds the manifest; crash-injection at each step leaves a state `off` recovers.
- **`off`:** the order is mid-turn, then `bg > 0`, then coordinators, then the rest, coordinators first within a tier; no start within the stagger of any spawn start, a swap's included; below the memory floor the pacer waits and skips nothing; a row already running is skipped; skipped rows that are inactive are resumed; every resumed unit is enabled and `.supervised` exists; a failed start is reported; the `resume` row is journalled before the start; only the recorded pauses are lowered; the switch is removed last; `off` re-run with a dead pacer continues from the manifest.
- **Timers and the update lock:** every shipped `.timer` declares exactly one `X-Ccrc-Maintenance` value; `on` stops exactly the `stop` ones and `off` restarts them; `on` refuses while an update holds the lock; `ccrc update` under the switch refuses `maintenance`.
- **Server:** each start-making lane and route holds under the switch; a test proves the stall watch (`lifecycle-stopped`) and the dead-coordinator lane (`stop`) already hold for a maintenance stop; a coordinator whose maintenance resume failed is not counted as a crash; the health wire carries `maintenance` with `resumed` and `total`; old-server/new-PWA and new-server/old-PWA skew tests.
- **Nudge:** `orphan-d` fires after 60 s idle for a `maintenance`-caused restart and after 15 minutes otherwise; shadow stays shadow at every level.
- **Spread** (#749's own tests): the programme key is one server function used by dispatch and the spread count, and is unchanged across a succession whose successor held no other runs; N children on a programme with K free healthy lanes use min(N, K) lanes before reusing one; the coordinator and its first child never share a lane when another eligible healthy lane exists; the auto-swap prefers a lane without members and still swaps when every lane has one; home affinity is unchanged after placement; no marker gives today's order exactly; a malformed marker gives today's order; pools and kill switches still filter first; a walk's read count is bounded and a stay tick reads no marker.
- **Display:** `programmeSpread` over fixtures; the run board line and the coordinator header at 360, 390, 1280 and 1920 px in both skins and both themes.

---

## 7. Fit with the consolidation contexts and waves

- **C2 Fleet Mutation** owns the acts: `ccd maintenance` stops and starts units through ccd's existing owners (`cmd_stop`'s path, `cmd_start`'s path, `_svc_run_detached`), so ccd stays the only component naming tmux and systemd. No `FleetGateway`, no new agent grant.
- **K12 switches:** `maintenance` is one switch with one reader. It lands beside `COORDINATOR_PAUSE_MARKER` in `rundefs.ts`, its existing owner, and becomes a `SWITCHES` row when W1a lands. Maintenance raises the existing pauses rather than adding a parallel pause. If W1a lands first, the server task writes the row directly.
- **K11 scheduling:** the timers' maintenance class lives in the `.timer` files, the one source; the generated launchd plists (ARCH-69) inherit it.
- **K15 placement:** the spread is a ranking input shared by ccd's existing walks, beside `_limit_score`, not a fourth walk. `projectHome` and its parity pin are untouched. The PWA's `accountPicker.leastLoaded` (SwapSheet) is untouched; a server swap suggestion stays §6 O12's question.
- **K10/K14 and W7:** the spread display is server-computed, so the PWA gains no run↔session matcher. The server's one new binding read is counted by W6's census and moves to `childrenOf` there.
- **K16 markers:** `.programme` has one writer (`cmd_ws_add`) and purges with the row.
- **Wave order:** the ccd tasks land as ordinary feature PRs after #435, #722 and #740 and the lifecycle W2 tasks they reuse; they do not touch `_auto_swap_check`'s decision arms, `_swap_idle_gate` or the pool grammar, which W5 also leaves alone. Consolidation rule 6 makes the consolidation wave rebase on these PRs, not the reverse.

---

## 8. Out of scope

- Pacing the cold-boot start of every unit through the resume pacer.
- A PWA control to turn maintenance on or off, and any agent grant for it.
- Arming stall-watch wave 2, and any change to the `orphan-d` clock for swaps and supervisor revivals.
- Waiting for turns to end before `on` stops a session (`on` cuts a mid-turn session, and the resume re-drives it).
- Moving running sessions to improve a programme's spread.
- A server-computed swap suggestion for the SwapSheet (consolidation §6 O12).
- macOS: `ccd maintenance` refuses `unsupported-platform` on darwin until a launchd half is designed.

---

## 9. Decisions the operator may want to revisit

None of these needed a ruling to proceed; each is the safest reading of the standing rulings.

1. **Swap is never refused in maintenance**, contrary to #296's proposal, because of the 2026-10-19 ruling. An operator's typed swap restarts that one session during maintenance.
2. **In-flight swaps and rolls are waited for, never cancelled**, with a 300 s bound after which the row is skipped and left running; a second `on` finishes it.
3. **The resume stagger is 25 s by default**, #296's measured cadence, sharing the roll's spawn and memory measures but not its 120 s window.
4. **The nudge fires at once only when `orphan-d` is armed**; otherwise `off` lists the rows for a manual mail.
5. **The spread yields to headroom above 80%**, so a child is not sent to a nearly full lane to be alone.
6. **The run board counts lanes, not names**: "4 children on 3 lanes".
