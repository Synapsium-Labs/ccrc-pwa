# Overlord W1a: the weekly quiz's trigger repaired, and a starved trigger said in words (run 3508)

The note of run 3508 (programme `overlord`, issue #2491), for the coordinator to fold into the programme ledger. No
D-number was issued: departures are named by slug. It records what changed, why, what was measured and what was not, and
the finding that withdrew the brief's second half.

## In short

- **Fault 1, the timer never fired.** `ccd-quiz-weekly.timer` now fires on the wall clock, at 00:17, 06:17, 12:17 and 18:17
  UTC (`OnCalendar=*-*-* 00/6:17:00 UTC`), with no `Persistent=` and with `DeferReactivation=yes`. No number of reloads of
  the user manager or restarts of the timer can move a calendar elapse.
- **Ruling (e), a starved trigger is visible.** Doctor's `quiz-weekly` line now warns, in words, when no tick has happened
  for two of the timer's periods (12 h) and no run is in flight, and when an installed timer unit has never ticked in that
  time.
- **Fault 2, the pilot.** The fallback path of rulings (a) and (c) was **not built**: the finding below showed a fallback
  pilot fails two checks by construction, and the coordinator withdrew (a) and (c) (ruling of run 3508, answer to the
  finding). Ruling (d) stands and needs no code. Nothing in this change makes the pilot pass.

## 1. Fault 1: why the timer never fired, and what is confirmed

The coordinator measured on the fleet box (read-only): the timer active for half a day with no last trigger, its next
elapse always about thirty minutes after the newest reload of the user manager, and hundreds of reloads in eleven hours,
the longest gap about fourteen minutes.

**Confirmed from systemd's source** (v259, `src/core/timer.c`, the version the fleet box runs), not measured on the box:

| Question | What the code says |
|---|---|
| The base of `OnActiveSec=` | `timer_enter_waiting`: the activation time only when the timer's own state is already active, else now. |
| What a daemon-reload does | `timer_coldplug` runs with the timer's state still dead (deserialisation keeps the saved state aside) and calls `timer_enter_waiting`, so the base is the reload's moment: every reload re-bases `OnActiveSec=` to now plus thirty minutes. |
| The base of `OnUnitInactiveSec=` | The later of the service's last deactivation and the timer's last trigger; with neither set, that value is never armed. The coordinator read no inactive timestamp on the service and no last trigger on the timer, so on the box it had no base. |
| The base of `OnCalendar=` | The timer's last trigger, else the time the timer was activated, else now. The last trigger is serialised across a reload and is not cleared by a stop and start. |
| A slot that falls during a run | The timer stays `running` while the service runs, so no second start; when the run ends, a slot already passed fires at once, unless `DeferReactivation=yes` (systemd 257 and later) counts the next slot from the run's end. |
| `Persistent=true` | A slot missed while the timer was not active fires at once when the timer is activated. |

**Still a reading, not measured:** that the fleet's reloads are what held this box's timer, rather than restarts of the
timer itself. Both re-base `OnActiveSec=` the same way in the code, and neither moves a calendar elapse, so the repair does
not depend on which it was.

### The new trigger, and the three properties the old unit argued for

| Property | How the calendar unit keeps it |
|---|---|
| No run at once on top of a deploy's sweep (D-1981) | No `Persistent=`. A first activation bases the next slot on the activation time, so an install's `enable --now` waits for the next slot. |
| No second run stacked behind a long one | The timer stays `running` while a run lasts; `DeferReactivation=yes` counts the next slot from the run's end. The runner's own lock still refuses a second runner. |
| A stopped week resumed within about six hours | Four slots a day, so the next slot is at most six hours away; no catch-up is needed, which is why `Persistent=` stays off. |

Other choices: UTC, because the runner's weeks are ISO weeks in UTC (Monday's 00:17 slot opens the new week at once);
minute 17, off the top of the hour; no `RandomizedDelaySec=`, because systemd re-rolls it at every re-arm, which a reload is;
`AccuracySec=1min`.

### Changed files

| Piece | Where |
|---|---|
| The calendar unit and the argument at its keys | `deploy/systemd/ccd-quiz-weekly.timer` |
| The one period reader learns `OnCalendar=*-*-* 00/<h>:<mm>:<ss> UTC`, `<h>` dividing 24 (otherwise doctor's bound would read the timer as unreadable) | `ccd/ccrc#_timer_period_s` |
| Doctor's `quiz-weekly` line | `ccd/ccrc-doctor-checks` |
| The runner's header sentence on the cadence | `deploy/history-quiz-unattended.mjs` |
| The pins | `server/test/timer-first-run.test.ts` (the quiz case, and the quiz timer joins the calendar abstainers of the anchor census), `server/test/timer-period.test.ts`, `server/test/census-w8/cadence.test.ts`, `server/test/ccrc-doctor-quiz.test.ts` |

Run 3212's note (`quiz-unattended.md`, section 1) still describes the old `OnActiveSec=30min` and `OnUnitInactiveSec=6h`
pair; it is not edited here, by the rule that a wave adds a note and never edits a ledger file. This note supersedes that
line.

## 2. Ruling (e): what doctor says now

The runner rewrites its record at the end of every tick, including a tick with nothing to do, so a firing timer refreshes
`last.at_ms` once a period. Doctor reads the runner's lock (`unattended.lock`, its pid) to tell a run in flight from none.

| State | Line |
|---|---|
| A record, no run in flight, last tick older than two periods (12 h) | WARN: no unattended quiz tick for N h and no run is in flight, more than two of the timer's periods, so the timer is not firing: starved, stopped, or the box was down |
| A record, a run in flight, last tick older than a run plus two periods (24 h) | WARN: the run is stuck (the old bound, now kept for a run in flight only) |
| No record, the installed timer unit older than two periods, no run in flight | WARN: the quiz timer's unit was placed N h ago and no unattended tick is recorded, so the timer is not firing |
| No record otherwise, or on macOS (no unit) | PASS, as before |

The period is read from the shipped timer (D-7054); nothing restates 6 h.

## 3. The finding that withdrew rulings (a) and (c)

Ruling (b) asked, before (a) was built, whether the fallback settings mode changes what each failing step 0b check
measures. It was read from the driver (`deploy/history-replay.mjs`: `SETTINGS_ARGV`, `spawnArgv`, `initChecksOf`,
`persistenceLeft`, `armToolsOf`), the build's own help text (Claude Code 2.1.330), and the retained week-47 result's check
states and its runs' init event field values. Nothing was spawned or written.

The two modes differ only in their settings arguments. `restricted` passes `--restricted`, which per the help text ignores
the user, project and local settings files, among its other limits. `fallback` passes `--setting-sources project,local`
and `--settings '{"disableAllHooks":true}'`: it reads no user settings either, and the project and local sources are empty
in each run's fresh temporary working directory outside any git tree. Every other flag is the same in both. So anything step
0b saw under `restricted` that does not come from a settings file, `fallback` sees too.

| Check | What the build reported (2.1.330) | Does the fallback mode change it? |
|---|---|---|
| tools | The init event lists `Task` and `Bash`; the driver compares the literal set `armToolsOf(argv)`, `Agent` and `Bash`. | **No: fails by construction.** The build reports the Agent tool by its wire name `Task`; both modes pass the same `--tools Bash,Agent`. |
| plugins | Six plugins are listed with every settings file ignored: five built into the build, and one plugin installed from a marketplace into the account's config folder. | **No: fails by construction.** None of the six comes from a settings file the modes differ on, and the fallback arguments disable none; the check wants an empty list. |
| persistence | Seven runs left nothing; the Agent probe left a directory named by its session id under the run's project folder, despite `--no-session-persistence`. | **Almost certainly no.** The flag is the same in both modes; the one fallback difference that could touch it, hooks off, does not apply, since `restricted` already loads no settings hooks. Unmeasured. |
| skill | The init event lists only the build's own skills; `ccrc-history`, a skill in the account's skills folder, is absent. | **Unknown.** This is the case the fallback mode was designed for (Q26), but it also drops the user setting source, which may be what loads that folder. |

A correction to the finding as first mailed: it called all six plugins built in. Five are; the sixth is a marketplace
plugin, so even a plugins check that admits the build's own would still refuse it.

### The coordinator's three readings for the next piece (read-only)

1. **One plugins entry, by field names.** The fields are `name`, `path` and `source`, plus `version` on the marketplace
   entry. Five entries say of themselves that they ship with the build: their `source` ends in `@builtin` and their `path`
   is the word `builtin`. The sixth has a `source` naming its marketplace, a `version`, and a path under the account's
   config folder's plugins directory. **Yes**, an entry says so, by those two fields; there is no boolean field.
2. **Switches in the build's help text.** None turns off the plugins that ship with the build: `--safe-mode` disables
   installed plugins, skills and hooks but says built-in tools and plugins "work normally" (and it would drop the skill
   the skill check needs); `--bare` skips hooks and plugin sync and says nothing of built-in plugins. None stops a
   subagent's transcript being kept: `--no-session-persistence` says only "Don't save sessions to disk", and
   `--forward-subagent-text` changes what the stream carries, not what is kept. Whether a `--settings` value such as
   `enabledPlugins` can switch a built-in plugin off is not stated there: **unmeasured** without a spawn.
3. **Where the persistence check looks.** `persistenceLeft` reads the account's config folder: the project folder named by
   the run's working directory under `projects/`, and any entry under `projects/` named by the run's session id. The Agent
   probe left `projects/<the run's folder>/<session id>/`, a session directory with no `.jsonl`. That is the shape the
   history sweep's subagent walk enters (`walkAgentProject`, `ccd/history/sweep.mjs`: a session directory with no `.jsonl`,
   of which only `subagents/` is read), and the account's config folder is a rostered home, so the leftover **is inside
   the tree the sweep reads**. Whether it held a `subagents/` transcript is **unmeasured**: the directory no longer exists
   on the box.

## 4. Measurements

- **Suites, through `ccrc test`, all green:** `timer-first-run`, `timer-period`, `census-w8/cadence`, `ccrc-doctor-quiz`,
  `doctor-cadence`, `single-definition/kernel-tail-cadence`, `ccrc-doctor-core-state`, `ccrc-install-units`,
  `ccrc-install-role`, `ccrc-uninstall`, `continuity-quiz-lane`.
- **The unit pair** passes `systemd-analyze --user verify` (systemd 259) with no warning, and `systemd-analyze calendar`
  gives the four slots six hours apart.
- **Mutants**, each applied to the committed file, its named test run, the file restored from git; all nine killed:

| Mutant | Killed by |
|---|---|
| M1 the trigger put back to `OnActiveSec=30min` plus `OnUnitInactiveSec=6h` (the brief's first) | `timer-first-run`: the quiz case and the anchor census |
| M2 the starved reading removed: no warning past two periods with no run in flight (the brief's second) | `ccrc-doctor-quiz`: WARN starved |
| M3 the never-ticked reading removed | `ccrc-doctor-quiz`: no record and an old unit |
| M4 the in-flight read removed | `ccrc-doctor-quiz`: a run in flight, and the first run in flight |
| M5 `Persistent=true` added | `timer-first-run`: the quiz case |
| M6 `DeferReactivation=yes` dropped | `timer-first-run`: the quiz case |
| M7 the reader loses the hourly UTC spelling | `timer-period`: the rows and the shipped quiz timer |
| M8 the reader admits a step that does not divide the day | `timer-period`: `00/5` refused |
| M9 the reader admits local time (no ` UTC`) | `timer-period`: the local spelling refused |

The brief's other two mutants (the fallback path removed, and the one-budget bound loosened) have nothing to mutate: their
code was not built, by the coordinator's ruling.

## 5. Departures, by slug

- **fallback-path-withdrawn**: rulings (a) and (c) were not built; the coordinator withdrew both on the finding in section 3.
  The driver and its checks are unchanged.
- **calendar-quiz-timer**: the quiz timer is the second calendar timer, after `ccrc-ddns.timer`, and joins it in the anchor
  census's abstainers.
- **period-reader-hourly-utc**: `_timer_period_s` reads one more spelling, the only one the quiz timer uses, and refuses a
  local-time one, another start hour or a step that does not divide the day.
- **doctor-reads-the-runner-lock**: doctor reads the runner's lock file to tell a run in flight, by its pid, as the runner's
  own stale-lock rule does. It never takes or removes the lock.
- **doctor-unit-age-as-armed-since**: with no record, the installed unit file's age stands for how long the timer has been
  armed.

## 6. Known limits

- **Nothing here proves on the fleet box** that the real timer fires or that a real pilot passes. The coordinator reads the
  box once the release carrying this change reaches it.
- **Each week's pilot still stops** with `pilot-failed` on the current build, once a week, and the status reading shows that
  word. A week still spends at most one budget, because a week closed on that word is not retried, as today.
- A systemd older than 257 ignores `DeferReactivation=` with a warning, and starts one run at once behind a run that
  spanned a slot. The fleet box runs 259.
- A timer stopped across a slot and started again fires that slot at once, because systemd keeps the last trigger across a
  stop. An install's `enable --now` on an active timer and a reload do not stop it.
- Every `ccrc update` re-places the unit file, so the never-ticked warning's clock restarts at each update.
- A lock whose pid was recycled by another process reads as a run in flight; the 24 h stuck bound then applies.
