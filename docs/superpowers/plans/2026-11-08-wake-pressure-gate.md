# Wake pressure gate: automatic cold starts and the update sweep wait on memory pressure

A fleet box that is already short of memory should not take a burst of cold starts on top. This change makes the
automatic wakes, the update sweep and the automatic update dispatch wait while the box is under memory pressure.
Everything the operator starts stays ungated.

## Deviations found

- **D-8122 (2026-11-08)** — automatic cold starts and the update sweep wait on memory pressure

## What was measured first

A read-only trace of `main` at c6f05621c (file and symbol for every claim) found:

- **A `ccrc update` restarts supervisors, not Claude.** Since the live-pane re-supervise path of 2026-08-14,
  `cmd_supervise` probes the session and calls `cmd_ensure` only when it is not live, and `cmd_ensure` on a live
  session runs `_resupervise_live` and spawns nothing. So the sweep's `try-restart` restarts the `ccd supervise` bash
  process of every live session. Claude Code, its MCP sidecars and its SessionStart hooks keep running.
- **The sweep was all at once.** `_upd_sweep` (ccd/ccrc) and `SWEEP_CMD` (deploy/deploy.sh) each ran one
  `systemctl --user try-restart "claude-session@*"`: every active unit in the same instant, no batching, no pacing,
  and no memory check. The KillMode preflight before it stays as it was.
- **The automatic roll is the one path that cold-starts Claude.** `ccd hibernate --roll` stops the unit and wakes it
  with `cmd_ensure`. It is paced at one roll per pass (`ROLL_PER_PASS`) every `HIBERNATE_SWEEP_MS`, and admitted
  through the fleet wake budget (`wakeAdmit`, `WAKE_BURST` per `WAKE_WINDOW_MS`). The mail lane's wake of a
  hibernated recipient is the other automatic wake, through the same budget.
- **No memory gate was in use.** `CLAUDE_HEADROOM_GATE_BYTES` (spec decision 6) was defined and read by nothing. PSI
  was measured (`measurePressure`, `pressureLevelOf`) and only shown in `FleetHealth.psi`.
- **Auto-mode update dispatch had no busy or pressure check.** `autoPermits` checks only the auto mode against the
  channel. The update-sync timer itself only writes `~/.ccrc/update-intent` and never runs an update.
- **Not found:** what started 29 to 50 Claude processes on 2026-10-27. The supervisor sweep's normal path does not.

## What ships

1. **One memory gate for automatic wakes.** `wakeMemoryGate` (server/src/coord/wakeBudget.ts) is asked inside
   `FleetWatcher.wakeVerdictAt` for every `auto` wake, before the budget's window. While the node's pressure level is
   at or above `CCRC_WAKE_PRESSURE_GATE` (warn, critical or off; default warn, PSI full at or above
   `PSI_WARN_FULL_PCT`), or the session slice's headroom is below `CCRC_WAKE_HEADROOM_MIN_GIB` (default 3, derived
   from `CLAUDE_HEADROOM_GATE_BYTES`), the wake is refused for this pass. Nothing is recorded, no slot is taken and
   nothing is parked, so the next pass asks again.
   - The roll's skip reads `memory-gate:pressure-warn`, `memory-gate:pressure-critical` or `memory-gate:headroom-low`
     in its `roll-skip` journal line, where the `wake-budget` skip already shows.
   - The mail lane's held delivery names the new `MailGate` `wake-pressure` instead of `hibernated`.
   - A reading that is missing (no fresh PSI, or an agent that sends no headroom) admits and journals
     `pressure-unmeasured` or `headroom-unmeasured` with "fail open", once per `WAKE_GATE_LINE_MS`.
   - Asked wakes (the operator's ensure, a dispatch resuming a worker) never read the gate.
2. **Headroom from the agent.** The `pressure` op's reply carries `headroomBytes` (`measureHeadroom`,
   agent/src/pressure.ts): the session slice's `memory.max` minus `memory.current`, no more than `MemAvailable`;
   `MemAvailable` alone when `memory.max` reads `max` or no slice is found. The slice is found beside an ancestor of
   the agent's own cgroup, never built from a user id. An older agent sends no field, which reads as unmeasured.
3. **The update sweep batches.** `_upd_sweep` and `SWEEP_CMD` list the units once, keep the KillMode preflight over
   the full list, then `try-restart` the units that were running (the listing's `active`, `activating` and
   `reloading` rows) by name, never with the glob, in chunks of `CCRC_SWEEP_BATCH` (default 5), and verify each
   chunk before the next. In `_upd_sweep` each chunk is listed, verified and re-checked by the wave 11 rules
   (`_upd_sweep_of_batch` picks its units; a unit in no chunk is judged with the last). A chunk whose verify fails
   stops the sweep: the remaining supervisors are not restarted, the sweep names how many, and the update fails as
   before. Between chunks the sweep waits while `/proc/pressure/memory` `full
   avg10` is at or above the gate level, polling, for at most `CCRC_SWEEP_PRESSURE_WAIT_S` seconds over the whole
   sweep (default 300). After that bound it warns once and never waits again, so an update never hangs. No PSI
   file, or the gate set to `off`, means no wait. `deploy.sh` reads the three settings on the box through
   `~/.local/libexec/ccrc/ccrc-settings.sh`, and the single-definition pin holds the two copies to the same
   batching, reads, defaults and order.
4. **Auto updates wait out a critical host.** `runDispatch` (server/src/update/converge.ts) notes an automatic move
   to the box the pressure reading is of as `AUTO_PRESSURE_HELD_DETAIL` while `FleetHealth.psi` reads critical: no
   lease, no op, and the update view shows the row's detail. A requested update is never held.
5. **Settings.** The four keys are box settings (`CCRC_SETTINGS`, `BOX_SETTINGS_TABLE`, `BOX_SETTING_TABLE`, family
   `memory-gate`), shown in the console's box settings card, and documented in README's configuration table and
   deploy/ccrc.env.example.

## Tests

- `ccrc-sweep-batches.test.ts`: a 30-unit fixture fleet (`sweepFixture.ts`, new `batch` and `psi` options) for six
  batches of five in listing order, verify inside each batch, the setting's sizes and its refused value, the pressure
  wait and its bound, `critical`, `off` and no PSI file, and a failing batch that stops the sweep.
- `wake-budget.test.ts`, `roll-wake-admission.test.ts`, `roll-lane.test.ts`, `mail-sweep.test.ts`: gated, ungated
  (asked) and fail-open wakes, the skip word and the `wake-pressure` gate.
- `update-auto-dispatch.test.ts`: the held automatic move, the unheld requested one, warn holding nothing.
- `host-pressure.test.ts`, `agent/test/pressure-op.test.ts`: the headroom reading and its reader.
- The settings table, census, verb and corpus pins, and the console card's families.

## Known limits

- Box settings are shown in the console but written in `~/.ccrc/ccrc.env`, as every box setting is today.
- The wake gate is read by the server and the sweep's pressure wait by the fleet box. On a two-box install each box
  reads `CCRC_WAKE_PRESSURE_GATE` from its own `ccrc.env`, so the two can differ.
- The sweep reads `full avg10` alone; the wake gate reads the worst `full` share over both windows and both
  resources (`worstFull`), as `FleetHealth.psi` does. The sweep's wait is a pacing aid, not the same judge.
- `WAKE_BURST` and `WAKE_WINDOW_MS` stay PR-only figures (open question 4 of the trace).
- The macOS arm of `_upd_sweep` is unchanged: it already kicks one job at a time.
- The future binary trigger (`ccd roll`, wave 2) does not exist yet. When it does, it should be admitted through the
  same `wakeVerdictAt` so the gate covers it.
- The 2026-10-27 burst's cause is still unknown.
- The box-settings corpus (`server/test/fixtures/box-settings/ok--*.json`) gained the four rows by hand, in the verb's
  row shape, on a macOS box; its regeneration case is Linux-only and re-checks them there. The `ccrc update` fixture
  cases that pin the named restart (`UNIT_RESTART`) are Linux-only too.
- `deploy.sh` reads the settings only when the box's login shell is bash and ccrc's reader is installed; otherwise it
  uses the defaults.
