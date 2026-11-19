# D-8126 wave A7: notes for the ledger

Wave A7 of `docs/superpowers/plans/2026-11-09-coordinator-autonomy-default.md` covers orphaned spawns, lanes that cannot
spawn and the self-install; fix round 1 (review run 2807) is folded in below. It was built for the Overlord programme (#2491), run 2785. This note lists what was ported
from the unreviewed handoff stack, what was rebuilt, and every departure from the plan, each under a slug. No D-number
was minted for any of them.

## Ported, and re-tested on today's main

The stack's range for this wave is `4e9a0b17a..f26eba187`, nine commits. Each test below was applied first, run red on
today's main (green for the characterization), then the source hunk was applied and the test run green.

| Task | What came over | Changed on the way |
|---|---|---|
| A7-1 | `decideBind`'s characterization; `DISPATCH_ORPHANED_EVENT`; the `orphanEvent` that `stopped()` writes last | none |
| A7-2 | the store's candidate arm; the verdict's `orphaned` fact; the mail body naming the refusal | the journal reader moved to L0 (`orphan-reader-in-l0`); the combined switch, pause and cap case split into three (`orphan-guards-split`) |
| A7-3 | `_ws_lane_cannot_spawn`, with the 6-hour expiry from the stack's last fix | the bash loop tightened (`ccd-growth-tightened`); the server twin decides over the registry's rows and reads no file of its own (`spawn-reader-follows-the-registry`) |
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
| `skill-install-window-30m` | Only a `skill-preflight:absent` row from the last 30 minutes is acted on, and only once: the first recorded outcome, `failed` included, is the one attempt for that dispatch (review 2807 F5). A later dispatch writes a fresh preflight row and makes the run due again. The window keeps a server starting after an upgrade from installing on every run an older build left `absent`. |
| `skill-install-active-runs` | Only runs in an active state (`dispatched`, `working`, `unknown`) are due: a run past `working` has no worker reading the skill. The rule is L1's (`skillInstallCandidate`, review 2807 F9), asked before a run's journal is read, so a closed run costs no read. |
| `skill-install-one-per-home` | Review 2807 F6: the lane keeps a per-account in-flight set across passes, owned by the watcher, and an entry leaves only when its runner call settles, not when the 60 s deadline gives up on it. Two due runs on one account never run two `skill-ensure` on one home at once: the second waits, unrecorded, and runs once the first settles. |
| `skill-install-caused-by-sweep` | The outcome row's `causedBy` is `sweep` (the server's lane), not `coordinator` as in the stack. |
| `mutants-in-the-lane-test` | The L1 deciders' `runMutants` set (ten mutants, all killed) lives in `skill-install-lane.test.ts`, not in `sim/mutation-floors.*`. Those files were held by another run while this wave built. A later pass can move the set to the floors. |
| `placement-parity-lives-in-projected-home` | The plan names `coord-placement.test.ts` for placement parity. On main that file tests board placement. The parity of `_ws_least_loaded` and `projectHome` is `projected-home.test.ts` (both sides over one seeded registry, with every edge on the shared fixture `fixtures/leastLoaded.ts`: the equal-epoch tie, a dotted id, a row with no account, garbage records, and the exact 21600 s boundary on one pinned clock) and `ccd-backend-vs-placement.test.ts` (the bash predicate's edges). |
| `spawn-refusal-expires-6h` | Not in the plan, and kept by the coordinator's ruling F8: a lane whose newest spawn read rc 2 or rc 5 is DEMOTED, not skipped (placed last, never refused), until any respawn on it succeeds or six hours pass, in both twins. A sign-in never touches the record, so without an expiry a recovered lane would stay demoted. Showing the demotion in the console (the accounts wire carries only `disabled` and `authDead` today) is a later carry. |
| `spawn-reader-follows-the-registry` | The coordinator's ruling F2 (a): the server twin has no reader of its own. `spawnBlockedLanesOf` (`server/src/limits.ts`) decides over the tick's registry rows, the strict `<digits> <digits>` grammar is the registry's one `.spawn` parser (`spawnRecordOf`), and the watcher hands `readLimits` its `records`, so the demotion adds no read to a tick. Two shapes differ from ccd, as `SessionRecord.child` already does: the registry follows a symlinked `.spawn` or `.wrapper`, which ccd refuses, and it yields only rows whose identity triple (`.uuid`, `.wrapper`, `.workdir`) reads, where ccd counts any `.spawn` beside a `.wrapper`. ccd writes neither shape, and the only effect is a forecast that can differ from ccd's placement. The shared fixture pins both as the known difference (`serverExpect`). A request-time `readLimits` with no records (the accounts view, the Overlord's facts, the served-limits fallbacks) carries no demotion: absence permits. |
| `orphan-needs-a-measured-ending` | The coordinator's ruling F1: the orphan row, and with it the dead-dispatch pass's skip of the in-flight bound, follows only a MEASURED `ws-add` ending (`ok`, or a failure ccd exited with: `cutShort === false`). A cut-short or unmeasured ending (a deadline, a signal, a dropped agent link) may leave `ws-add` running on the box, so that run journals no orphan and waits out the bound as before the wave. The plan's "with and without ccd's stderr" reads as ccd having exited. |
| `orphan-reader-in-l0` | `orphanedRefusalOf` (the run's newest journal row since its stamp) sits in `shared/dispatch-abandon.ts`, beside the prefix it reads. The stack had it in the act file, which decides nothing. |
| `orphan-guards-split` | The stack's case "the switch off, the pause and the per-pass cap still stop an orphaned run" tested only the pause. It is now three cases. |
| `ccd-growth-tightened` | The two new bash functions were rewritten in fewer lines, with the same behaviour and tests, so `ccd` grows by no more than 40 net code lines (no waiver). |
| `g31-not-g29` | The agent's bypass fixture is `g31-skill-ensure-without-wrapper.ts`. Main already has a `g29`. |
| `installers-write-backups` | `skill-ensure` writes into one home's `skills/ccrc-coordinator` and `skills/ccrc-worker`. The installers it runs also back up a replaced skill, and that backup lands OUTSIDE the named home: under the box-wide `$HOME/ccrc-backups/<ts>/`, the invoking user's backup root, as when the deploy runs them (review 2807 F7). A backup is written only when a differing skill is replaced. Its folder matches the backup pruner's pattern, so it counts toward the pruner's newest-N window, and an update's backup in the same second would refuse "already exists". Both are pre-existing with the deploy's own runs of these installers; this wave adds one more unattended caller. |
| `skill-ensure-not-a-safety-verb` | Legitimately different from the SAFETY list's verbs (the coordinator's ruling, confirming review 2807's Lens A): `skill-ensure` is not on CLAUDE.md's SAFETY list or the approval guard's forbidden verbs. Those verbs delete (`ws-shed-deps`), write a generation the server must journal first (`ws-lease-mark`), are the one writer of stamped markers (`keep-awake`), or are the operator's switch (`delegation-adopt`). `skill-ensure` converges one rostered home to the deployed sources: the caller never chooses the content, it is idempotent, it keeps a backup of what it replaces, and it keeps no server-side fact that must be written first. `ccrc doctor --fix` and the release updater already run the same installers into every home, and neither is forbidden to a session, so forbidding the narrower verb would remove no risk. The real control is the source tree in `~/.cc-sessions`, which the approval guard's registry-path row already covers. |
| `account-id-class-copied` | `CCD_ARGV.skillEnsure` checks the roster's id class (`/^[a-z][a-z0-9-]{0,31}$/`) with its own literal, because `shared/roster.ts` keeps `ID_RE` private. ccd checks the same class and then the roster file. `account-id-class-pin.test.ts` pins both copies to `ID_RE`'s spelling (review 2807 F9). A hostile-id sweep goes red if the builder's check goes (F4), and ccd's own check is asserted by its `bad wrapper id` refusal. |
| `skill-ensure-permits-without-evidence` | Review 2807 F9: `CCD_CAN.skillEnsure` is a `verbRow`, which permits when the box's verbs are unknown, so an older ccd records `failed`, not `unsupported`. It follows the precedent of `delegationAdopt`, `limitWait`, `projectAddClone` and `scopeSweepBusy`. |
| `last-act-counts-the-install-row` | A carry, not fixed (review 2807 F9): `CoordStore.lastActReader` counts the `sweep`-caused `skill-install:` row as an act, which nudges a run's last move by about one lane beat after its dispatch. It is cosmetic. The fix is in `lastActReader`, a part of `store.ts` this wave's licence (the one method `stalledDispatchRunIds`) does not cover; a later pass can exclude the prefix there. |
| `readme-follow-up` | README.md does not yet name the new verb: its ccd verb table row, and the whitelist section's two gated-verb sentences. README is held under another run's freeze, and its holder declined the edit. A follow-up adds the three lines after that release. |

## The stack's A1 to A3

A7 depends on nothing of A1 to A3. The one file both touch is `server/src/coord/store.ts`, where this wave changes
only `stalledDispatchRunIds`, a method A1 to A3 did not change. The stack's differing A1 to A3 are not built on here.

## For A5

The coordinator skill's `wave-lifecycle-2-dispatch.md` documents `skill-preflight:<state>`. The new
`skill-install:<outcome>` row (`installed`, `converged`, `failed`, `unsupported`) belongs beside it when A5 rewrites the
skill text.
