# The automatic coordinator roll, release half, ruled

- **D-7452 (2026-10-29)** — idle coordinators are rolled onto the current ccrc release by the sleep executor's third row, `ccd hibernate` then `ccd ensure`, one a pass
- **D-7453 (2026-10-29)** — Settings › Automation › Roll idle sessions, `coordinators` (default, ON) or `off`, stored in `roll_settings`
- **D-7454 (2026-10-29)** — a coordinator is behind on release when its Claude Code process started before the node's current ccrc install completed
- **D-7458 (2026-10-29)** — the roll's act is ONE ccd verb, `ccd hibernate --roll <id>`: every hibernate refusal kept, `.no-roll` refuses and `.no-hibernate` does not, and the wake runs inside ccd (exit 4 `roll-wake-failed` when it fails), behind the `hibernate-roll` caps token

**Revised the same day (D-7458, the coordinator's review ruling).** The first build ran two server calls, `ccd hibernate` then `ccd ensure`, so the executor ran ccd twice and the journal held two acts the server chose. The ruling: the roll is one ccd act. `cmd_hibernate` gains `--roll`, which keeps every refusal of a plain hibernate (busy, a draft, an attached terminal, the turn marker, `bg`, `crons`, a hold, a fresh swap), refuses `$REG/<id>.no-roll` as `opted-out` and not `.no-hibernate`, and does not take a standing `.hibernated` as done. After the act it runs `cmd_ensure` in a subshell, so the session resumes at once. The deliberate act is one `hibernate` journal row whose declared actor is `sweep:roll` and whose declared reason defaults to `roll`; the wake's `ensure` rows are the unit's own, as on every wake. A failed wake exits 4 with `ccd: roll-wake-failed`, which the lane reads as `woke-failed`; the row stays hibernated, the sanctioned state. `ccd caps` prints `hibernate-roll`, and the server arms the lane only on it (`HIBERNATE_ROLL_CAP`, `capSupported`, false on no evidence), so the ccd half deploys first (agent lane) and the server half rolls nothing until it has. `.no-hibernate` no longer skips the roll (`hibernate-opted-out` is gone); it only stops `hibernation-due` from holding a session that hibernation will never take. The Settings card moved to a stacked pull request (`feat/roll-idle-card`), because the consolidation path guard's rule 8 keeps `pwa/` out of a diff that touches a W1a-owned file (`shared/switches.ts`). Where the text below says `ccd hibernate` then `ccd ensure`, read `ccd hibernate --roll`.

**The rulings (the operator, 2026-10-29).** They extend D-7443 (`2026-10-29-roll-coordinators-only-ruled.md`):

1. Every coordinator (`FleetSession.role === 'coordinator'`, `sessionRoleOf`; a `.child` marker that cannot be read counts as a child) is rolled automatically once it has been idle for 90 minutes: the binary-lifecycle spec's U2 quiet window and its §7.2 idle gate.
2. A non-coordinator is never rolled automatically. It picks up the new release when it next starts for another reason (an ensure, a wake, a swap).
3. Hibernation counts as the roll. When hibernation will take a coordinator within 30 minutes, the roll skips it, because the wake brings the new release.
4. Build the release half now. A coordinator is behind when its pane started before the node's current ccrc install, so a new ccrc release or new skill text reaches it. The Claude Code binary trigger is added when binary-lifecycle wave 2 (`ccd roll` and the canary) lands.
5. A Settings › Automation row, "Roll idle sessions: coordinators | off", defaults to coordinators. It has no `all`. U4's `.no-roll` opt-out still applies, manual restarts are unaffected, and every skip is journalled with its reason. The supervisor sweep in `ccrc update` stays fleet-wide, because it restarts supervisors, not Claude Code.

## Measured before building (2026-10-29, `origin/main` `d32509009`)

- **No roll verb exists.** `ccd roll` is binary-lifecycle wave 2, which is not started (the programme ledger). `ccd caps` lists `hibernate`, `ensure`, `stop`, `start` and `swap`. `cmd_swap` refuses a same-account target.
- **The in-place resume the code has** is hibernate-then-wake. `cmd_hibernate` re-measures the box-local half before anything stops: a hold, `.no-hibernate`, a swap landing, a turn marker that is not `done`, or `bg` or `crons` that are not exactly 0. It also refuses `esc to interrupt`, a draft in the input box (`_idle_for_keystroke`'s empty-box check, refused as `draft`) and an attached terminal, each as `ccd: session-busy: <reason>` at exit 3. Then it journals a deliberate `hibernate` row, writes `.hibernated`, unsupervises and kills the pane. `cmd_ensure` on that row clears the marker and runs `_supervised_start`, and the unit's spawn resumes the conversation (`mode=resume`). Mail, an open screen and a re-dispatch already wake sessions this way, so a session woken this way runs whatever the node now has installed.
- **The spec's §7.1 rejected composing hibernate and ensure** for the *binary* roll, for four reasons. Two do not bind the release half. It cannot name a build (the release half names none), and the window between the two calls reads hibernated (mail may wake it, which is the same act). The other two stand as residuals, below.
- **The pane's start** is the live file's `startedAt` (`sessions/<pid>.json`), already read for the turn marker's staleness (`turnMarkFor`). **The install's completion** is the modification time of `~/.ccrc/installed`. `ccrc install` writes that record as its last step (`_inst_installed`, tmp and rename, so every completed install moves it), and the node inventory already stats and reads it over the agent's node-file grant. `build.json`'s `builtAt` is the build's time, not the install's, so it is not used.
- **The switch conventions do not require a shadow pass.** Arming is per lane. Stop-done is live under its kill switches with no arming marker (`RUN_DONE_LANE.arming: null`). Hibernation, expiry and the disk lanes arm by a hand marker, and the collector by a Settings choice. The operator ruled that this row ships ON, so it ships live with no shadow. The executor's own unarmed arm stays: with no serialiser handed over, or no `hibernate` in the box's caps, the lane journals `roll-skip <id>: unarmed` and acts on nothing.
- **One executor.** `late-census.test.ts` pins one `ccd hibernate` act site (`sleepAct`), which may only shrink. So the roll is a row of that executor (`then: 'wake'`), not a second act.

## What ships (D-7452, D-7453, D-7454)

- `server/src/coord/rollTarget.ts` (L1): `autoRollVerdict` checks, cheapest first: the setting; the role (a child is never measured); the install time; `measure`; behind (`startedAt < installedAt`, otherwise `current`, which writes nothing); `.no-roll`; hibernation's gate at the 90 min window (`hibernateVerdict(i, now, ROLL_QUIET_MS)`, each hold named as `idle-gate:<hold>`); `hibernation-due` (armed, no `.no-hibernate`, and `idleMs + 30 min >= N`); and `compacting` (the live status moved in the last 10 minutes, or carries no time). Skips are named in `AUTO_ROLL_SKIPS`. `rollTargetVerdict` is the setting-and-role filter, and `rollTargetsOf` reads the stored setting. A lost row is the default, and an unknown word or a failed read rolls nothing.
- `server/src/rollLane.ts` (L4): `ROLL_LANE` is a row of the sleep executor. It has hibernation's policy row, kill switch `hibernate-disabled`, every recorded row in frame order, one act a pass, `then: 'wake'` and actor `sweep:roll`. `rollPass` journals one pass-level line for `hibernate-disabled` or the setting being off or unreadable, and otherwise one line per skip (`roll-skip <id>: <reason>`, at most hourly per id unless the reason changes) and one per roll.
- `server/src/sleepLane.ts`: the executor gains `then: 'stay-asleep' | 'wake'` (both sleep lanes are `stay-asleep`) and the port's optional `admitWake`. A `wake` row asks the fleet-wide wake budget as an automatic wake before the act (`wake-budget` holds it), and its act is `CCD_ARGV.hibernate(…, roll = true)`, `ccd hibernate --roll` (D-7458): the executor still runs ccd once. A ccd refusal wakes nothing; `roll-wake-failed` is `woke-failed`; a call that never ran is a failure whatever its stderr says (D-6840).
- `server/src/watch.ts#sweepRoll` on the `rollIdle` row (`laneSchedule.ts`, derived from `sleepIdleHours`' 5 min). `turnverdict.ts#processStartedAtFor` reads the pane's start.
- `roll_settings` (`schema.ts` entry 33, seeded `coordinators`), `CoordStore.rollSettings` and `setRollTargets`, and `GET`/`POST /api/coord/roll-idle`. The door is session-gated when sign-in is armed, open while it is dark, and has no box token. A change is a record-only feed row naming the actor. The switchboard row is `roll-idle-targets`.
- `shared/claudeVersion.ts`: `CLAUDE_ROLL_TARGETS` is `coordinators | off`, with `isClaudeRollTargets` (D-7443's `all` is removed).
- PWA: `pwa/src/fleet/RollIdleSection.tsx`, the fourth Automation card, lands in the stacked pull request `feat/roll-idle-card` after this one (D-7458's revision; consolidation path guard rule 8).

## Red rows (measured red against the mutants, then green)

| Mutant | Red rows |
|---|---|
| the role check removed | 5 |
| an unknown role passes | 2 |
| the setting ignored by the verdict | 3 |
| the behind check removed | 2 |
| the quiet window at 60 min | 1 |
| `hibernation-due` removed | 2 |
| `compacting` removed | 3 |
| `.no-roll` ignored | 1 |
| a lost row reads `off` | 1 |
| the default `off` | 34 |
| no wake after the sleep | 3 |
| three rolls a pass | 1 |
| the pass-level setting gate removed | 2 |
| the wake budget ignored | 2 |
| the setting not re-read at the act | 1 |

The rows: an idle coordinator behind on release is rolled after 90 minutes (hibernate, then ensure); an idle child is never rolled and never measured; an unreadable `.child` counts as a child; a busy, drafting (ccd's `draft` refusal, no ensure) or compacting coordinator is not rolled; one due for hibernation within 30 minutes is not rolled; the setting off rolls nothing and reads nothing; the default is coordinators and there is no `all`.

## Residuals, named

- **Not strict.** A wake's `_spawn_start resume` still falls back once to `--session-id` when `--resume` leaves no session (spec §7.3, trap 3), as every hibernation wake does today. The release half adds no ccrc-initiated restart that hibernation does not already make. Strict resume lands with wave 2's `.resume-strict`.
- **Not detached.** One ccd call makes both halves now (D-7458), but it runs inside the agent's exec, not as a detached unit. A ccd killed between them leaves the coordinator hibernated, which is a sanctioned state that mail, an open screen or a re-dispatch wakes. `ccd roll`'s detached act replaces it in wave 2.
- **`compacting` is the live status, not the transcript's modification time** (spec §7.2's measure, which needs the transcript resolver's ladder). Measurement M3 (does an idle compaction show `esc to interrupt`) is still open. ccd's `esc to interrupt` refusal at the act is the second guard.
- **No memory gate.** `low-memory` and `recent-spawn` are ccd holds that come with `ccd roll`. Until then the bound is one roll a pass fleet-wide, at hibernation's 5 min clock, behind the shared wake budget (`WAKE_BURST`).
