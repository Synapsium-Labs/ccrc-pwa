# D-8126 wave A7: notes for the ledger

Wave A7 of `docs/superpowers/plans/2026-11-09-coordinator-autonomy-default.md` covers orphaned spawns, lanes that cannot
spawn and the self-install. It was built for the Overlord programme (#2491), run 2785. This note lists what was ported
from the unreviewed handoff stack, what was rebuilt, and every departure from the plan, each under a slug. No D-number
was minted for any of them.

## Ported, and re-tested on today's main

The stack's range for this wave is `4e9a0b17a..f26eba187`, nine commits. Each test below was applied first, run red on
today's main (green for the characterization), then the source hunk was applied and the test run green.

| Task | What came over | Changed on the way |
|---|---|---|
| A7-1 | `decideBind`'s characterization; `DISPATCH_ORPHANED_EVENT`; the `orphanEvent` that `stopped()` writes last | none |
| A7-2 | the store's candidate arm; the verdict's `orphaned` fact; the mail body naming the refusal | the journal reader moved to L0 (`orphan-reader-in-l0`); the combined switch, pause and cap case split into three (`orphan-guards-split`) |
| A7-3 | `_ws_lane_cannot_spawn` and `readSpawnBlockedLanes`, with the 6-hour expiry from the stack's last fix | the bash loop tightened (`ccd-growth-tightened`) |
| A7-4 | `cmd_skill_ensure`, the whitelist grant, `CCD_ARGV.skillEnsure` and the agent fixtures | bypass fixture renumbered (`g31-not-g29`); a conflict in `whitelist.test.ts` resolved by keeping both sides; a misplaced comment in `whitelist-subset.test.ts` restored; a test of the roster-file re-read added |

## Rebuilt

**A7-5, the self-install.** The stack ran the install in the dispatch route after the serialiser released, and added a
`skillInstall` field to the dispatch answer. The route file, `server/src/coord/routes.ts`, is held by another
programme's frozen run. The coordinator ruled (mail of 2026-11-19, run 2785) that the install runs on a lane instead:

- `server/src/coord/skillInstall.ts` (L1) holds `skillInstallDue` and `skillInstallOutcomeOf`.
- `server/src/coord/skillInstallLane.ts` (L4) holds `skillInstallPass`, run by the watcher on its own `LANE_SCHEDULE`
  row (`skillInstall`: monotonic, single flight, every 15 s, stale after five minutes).
- The dispatch only measures the skill, as before. `dispatch-skillstate.test.ts` pins that it runs no install.

## Departures

| Slug | What and why |
|---|---|
| `install-outcome-is-a-run-event` | The dispatch answer gains no `skillInstall` field (plan A7-5 asked for one). The route file is held, and the run event `skill-install:<outcome>` is the durable record that the coordinator reads on the run. The coordinator ruled this. |
| `install-latency-is-one-lane-beat` | The install follows its dispatch by up to one lane beat (15 s plus the tick), not at once. `dispatchRun`'s deps are built in the held route file, so nothing kicks the lane. |
| `skill-install-unsupported` | A fourth outcome word, `unsupported`, is recorded once when the box's ccd does not advertise `skill-ensure`. Without it, the run's trail would not say why nothing was installed. |
| `skill-install-review-runs-skip` | A review run is never due. The stack recorded `failed` for one; `skill-ensure` does not install the reviewer skill, so nothing is attempted and nothing is recorded. |
| `skill-install-window-30m` | Only a `skill-preflight:absent` row from the last 30 minutes is acted on. A server starting after an upgrade does not install on every run an older build left `absent`, and a failing box is not retried forever. |
| `skill-install-active-runs` | Only runs in an active state (`dispatched`, `working`, `unknown`) are read. Economy only: a run past `working` has no worker reading the skill. |
| `skill-install-caused-by-sweep` | The outcome row's `causedBy` is `sweep` (the server's lane), not `coordinator` as in the stack. |
| `mutants-in-the-lane-test` | The L1 deciders' `runMutants` set (ten mutants, all killed) lives in `skill-install-lane.test.ts`, not in `sim/mutation-floors.*`. Those files were held by another run while this wave built. A later pass can move the set to the floors. |
| `placement-parity-lives-in-projected-home` | The plan names `coord-placement.test.ts` for placement parity. On main that file tests board placement. The parity of `_ws_least_loaded` and `projectHome` is `projected-home.test.ts` (both sides over one seeded registry) and `ccd-backend-vs-placement.test.ts` (the predicate's edges). |
| `spawn-refusal-expires-6h` | Not in the plan: a rc 2 or rc 5 spawn record older than six hours is no verdict, in both twins. The skip stops the spawn that would clear the record, and a sign-in never touches it, so without an expiry a recovered lane would never get work again. Ported from the stack's last fix. |
| `orphan-reader-in-l0` | `orphanedRefusalOf` (the run's newest journal row since its stamp) sits in `shared/dispatch-abandon.ts`, beside the prefix it reads. The stack had it in the act file, which decides nothing. |
| `orphan-guards-split` | The stack's case "the switch off, the pause and the per-pass cap still stop an orphaned run" tested only the pause. It is now three cases. |
| `ccd-growth-tightened` | The two new bash functions were rewritten in fewer lines, with the same behaviour and tests, so `ccd` grows by no more than 40 net code lines (no waiver). |
| `g31-not-g29` | The agent's bypass fixture is `g31-skill-ensure-without-wrapper.ts`. Main already has a `g29`. |
| `installers-write-backups` | `skill-ensure` writes into one home's `skills/ccrc-coordinator` and `skills/ccrc-worker`. The installers it runs also back up a replaced skill under `~/ccrc-backups/<ts>/`, as they do when the deploy runs them. Nothing else is written. |
| `skill-ensure-not-a-safety-verb` | The verb is not on CLAUDE.md's SAFETY list or the approval guard's forbidden verbs. A session could run it, and it would only reinstall two skills into one rostered home from the deployed sources. The reviewers should rule whether it belongs there. |
| `account-id-class-copied` | `CCD_ARGV.skillEnsure` checks the roster's id class (`/^[a-z][a-z0-9-]{0,31}$/`) with its own literal, because `shared/roster.ts` keeps `ID_RE` private. ccd checks the same class and then the roster file. |
| `readme-follow-up` | README.md does not yet name the new verb: its ccd verb table row, and the whitelist section's two gated-verb sentences. README is held under another run's freeze, and its holder declined the edit. A follow-up adds the three lines after that release. |

## The stack's A1 to A3

A7 depends on nothing of A1 to A3. The one file both touch is `server/src/coord/store.ts`, where this wave changes
only `stalledDispatchRunIds`, a method A1 to A3 did not change. The stack's differing A1 to A3 are not built on here.

## For A5

The coordinator skill's `wave-lifecycle-2-dispatch.md` documents `skill-preflight:<state>`. The new
`skill-install:<outcome>` row (`installed`, `converged`, `failed`, `unsupported`) belongs beside it when A5 rewrites the
skill text.
