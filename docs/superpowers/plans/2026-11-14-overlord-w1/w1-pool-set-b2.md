# The Overlord W1 pool set, PR B2 (Tasks 9 and 10): measurements and departures

This note belongs to `w1-pool-set.md` and sits beside `w1-pool-set-departures.md` (PR A1's), `w1-pool-set-a2.md`,
`w1-pool-set-a3.md` and `w1-pool-set-b1.md`, which a feature pull request may not edit. The coordinator folds it into the
ledger. A departure is named by a slug; no D-number is invented.

## What PR B2 adds

- **Task 9.** `--below-cap <word>` on `ccrc update`, `ccrc rollback` and `ccrc rollout`. The word is any word of the
  capability floor's table (`ccd/ccrc#CAP_FLOOR_ROWS`), checked by `_below_cap_arg` against the table; several words are
  comma-joined, and a repeated flag adds to the list. An unknown word, a capital, an empty value or no value is a usage
  error (exit 2) that changes nothing. `_upd_cap_floor_check` takes the list as its third argument and passes exactly the
  rows whose word it names, each with a `WARN` line (`--below-cap passed the capability floor for pool-set (<why>; a
  poolset stands for <ids>)`); every other standing row still refuses. The refusal now opens with the override:
  `pass --below-cap <words>, or <remedy>: <why>; a <fact> stands for <ids>`. `--force` still never crosses the floor.
  The three forwardings: the update's `--detach` argv (`dflags`, last in the fixed order), the rollback's `--detach`
  (`_upd_detach rollback … --below-cap <words>`), and the rollback's fall-through (`extra`). `below-cap` joins
  `CCRC_CAP_WORDS`, so `update --check` prints it in `caps=`. `ccrc rollout --below-cap` refuses before any box moves
  when a box's check line does not list `below-cap`, naming each such box; B1's later-box `needs=` refusal is lifted only
  when the flag names every word the box needs; and the flag reaches every box's update. A box's update that exits 2 now
  stops the rollout with its own sentence: a usage error, nothing changed, no backup taken.
- **Task 10.** `server/src/poolrule.ts#poolSetLoss` (L1, pure) decides, over every row of the floor, whether the box that
  places sessions has lost a word while a session carries the fact that needs it, an unreadable entry included, and keys
  the loss by the box's build and each lost word's sessions. `server/src/poolSetLossLane.ts` (L4, context C1) runs it on
  each watcher tick, on that tick's registry records and the caps the `caps` lane last recorded (`FleetState.ccdVerbs`),
  and pushes the operator once per loss through the notice funnel (`notify`, the push outbox's sender and
  `noticePayload`), session id `''`, tag `pool-set-lost`, opening Settings. It is push site #30 in
  `push-outbox-characterization.test.ts`. `watch.ts` gains the import, the field and the call.

## Step 1 of Task 9: the measured places

- **The three forwarding sites.** `cmd_update`'s `--detach` re-exec builds `dflags` (`--force`, `--downgrade`,
  `--allow-unsigned`, `--no-gate`) and calls `_upd_detach update "$to" "$UPD_FROM" "${dflags[@]}"`; `cmd_rollback`'s
  `--detach` called `_upd_detach rollback "$to" "$from"` with no flags; `cmd_rollback`'s fall-through runs
  `cmd_update --to "$to" --downgrade --from "$run_from" "${extra[@]}"`, `extra` holding only `--allow-unsigned` when
  `_upd_marker_unsigned` says so.
- **The rollout verb.** The preflight loop asks each box `--check`, keeping `states`, `capss`, `floors` and `needss`;
  the per-box loop then refuses an unreadable or malformed floor, a channel with no target, B1's later-box `needs=` and a
  floor above the target; the move loop builds each box's flags in a fixed order and reads three exit arms (3 relayed,
  4 stops naming the restore, anything else stops naming the backup).
- **Every `exit 2` `cmd_update` can reach** is an argument refusal in its own body, before `_upd_phase backing-up`
  (the `--to`, `--from` and `--channel` values, the `--check` exclusions, the `--from` caller words and the detach
  refusals); the functions it calls after the backup exit through `_ccrc_die` (exit 1). So the rc 2 arm says "it
  changed nothing and took no backup".

## Step 1 of Task 10: the measured places

- `server/src/refreshcaps.ts#makeRefreshCaps` is wired in `server/src/index.ts` in remote mode only (`refreshCaps`),
  and records the box's `ccd caps` into `FleetState.ccdVerbs` through `fleetstate.ts#recordCcdVerbs`. In local mode
  `index.ts` reads `readLocalCcdCaps(cfg.ccdBin)` once at boot, not awaited, into the same field: a ccd-only change on
  a local box is seen at the next server restart, as the plan says.
- In `FleetWatcher`'s tick both facts are in scope after the registry read: `registryRead.records` (each
  `SessionRecord.route` carries `fields` and `unreadable`) and `this.deps.fleetState`. The call sits beside the build
  capture lane's sweep.
- `server/src/buildCaptureLane.ts#raiseFailure` reads `coord.hasNotice('coord', '', dedupeKey)` first (a throw sends),
  then `notify(d, {kind: 'coord', sessionId: '', runId: null, title, body}, 'push', {tag, dedupeKey, url: '/settings',
  lane, degraded})`. The lane copies that shape.

## Departures

- **`b2-notes-in-a-new-file`.** This PR's measurements are here, not in the earlier notes.
- **`below-cap-names-any-floor-word`.** The coordinator's ruling: the flag names any word of `CAP_FLOOR_ROWS`, not only
  `pool-set`, and refuses an unknown one. The plan's "any other word is a usage error" holds against the table. Words are
  comma-joined (`--below-cap pool-set,launch-surface-v1`), and a repeated flag adds to the list, so one move can pass two
  rows; each row passes only when the flag names its word.
- **`override-leads-the-refusal-once`.** The plan puts `pass --below-cap pool-set, or ` at the refusal's front. With the
  table the front names the words of every refused row once (`pass --below-cap pool-set,launch-surface-v1, or …`), so
  the 200-character cut keeps the override and the first remedy (pinned with ten 40-character ids). The `WARN` lines of
  the unattended paths (`--from watchdog`, `--from restore`) carry no override text: they pass anyway.
- **`below-cap-passes-unlistable-only-naming-every-word`.** Table 2's unmeasured row (a `~/.cc-sessions` that cannot be
  listed) is not tied to one row, so the flag passes it only when it names every row's word. The refusal for it names
  them all.
- **`one-rollout-gate`.** The coordinator's ruling: the rollout gate extends B1's (`rollout-floored-box-moves-first`).
  B1's later-box refusal is lifted by the flag when it names every word the box's `needs=` lists (`unmeasured` asks
  every word of this ccrc's table); the `below-cap` preflight sits beside it in the same loop's preamble, before any box
  moves. Measured against the plan's "the rollout gate about 6": the `below-cap` gate is 2 code lines, the lift 0 (one
  clause on B1's line), the forwarding 1, the rc 2 arm 0 net (the "not touched" sentence is computed once before the arms
  instead of in two of them, and the new arm takes the lines it frees).
- **`check-refuses-below-cap`.** Not in the plan: `--check` beside `--below-cap` is a usage error on `update` and
  `rollout`, the D-3139 shape every update-only flag already follows (`--force`, `--downgrade`, `--allow-unsigned`).
- **`push-reads-a-twin-of-the-floor-table`.** The server cannot read `ccd/ccrc`, so the lane carries the table's `fact`
  and `word` columns as `CAP_FLOOR_FACTS`, and `pool-set-loss-lane.test.ts` pins it equal to `CAP_FLOOR_ROWS`, row for
  row. A later floor row is added in both places (the sandbox piece's `launch-surface-v1` row: its fact
  `profiledigest` is a route field). The fact is typed `RouteField`, because the server sees a session's facts only
  through the registry's route read: a row whose fact is not a route field (the ccd arms piece's `keep-awake-v1`, "the
  Overlord's stamped markers") does not compile here, and that piece decides how the server sees it.
- **`pool-set-loss-takes-the-table`.** The plan's `poolSetLoss(caps, sets, unreadableSets, build)` reads one word. It is
  `poolSetLoss(rows, caps, sessions, build)`, `sessions` each `{id, fields, unreadable}` as the registry measured them,
  answering every lost row (`{word, fact, sessions, unreadable}`). The key is
  `pool-set-lost:<build or unmeasured>:<word>=<sorted ids>;…`.
- **`push-latched-in-process`.** The coordinator's ruling (an edge, not a level): besides the archived key
  (`hasNotice`), the lane keeps the last key it raised, so a failed archive write never re-sends the same loss on the next
  tick. Across a restart the archived key holds it; a restart after a failed archive sends once more.
- **`push-names-five`.** The body names at most five sessions per lost word and counts the rest, so a push stays short.
- **`lane-in-context-c1`.** The ring-context map (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`)
  names `poolSetLossLane.ts` on the C1 row beside `poolrule.ts`, under the authority journal A0 worker's grant (its PR
  edits the K row only).
- **`push-site-30`.** The push site row #30 and its drive helper in `push-outbox-characterization.test.ts`, under the
  responses A worker's grant (additive lines only).
- **`watch-ts-plus-three`.** The brief's "about +2": the import, the field and the call are 3 code lines.
- **`below-cap-is-every-os`.** `below-cap` joins `CCRC_CAP_WORDS` (every os), not the Linux-only list: the flag needs no
  detached unit. `ccrc-install-role.test.ts` pins eleven words on Linux, nine on Darwin, and the word's machinery.
- **`guards-proved-by-mutation`.** The tests in this PR were written beside the code, not run red first; each guard's
  red is measured by mutation instead (below), every mutant restored from a saved copy and compared byte for byte.
- **`b2-cases-hold-any-table`.** The sandbox piece adds a floor row beside this PR (its PR A2). B2's cases read the
  table's words from `ccd/ccrc` where a row count matters (an unlistable registry, rollout's `unmeasured`), match the
  usage sentence by its prefix, and use a fictional demo row (`tablefact|table-word-v1`; `acctorder` on the server), so
  that row lands without editing them. Measured with its exact row added to copies of `ccd/ccrc` and the lane: every B2
  case stays green; only B1's TABLE describe reds on its "unpatched ignores a profiledigest entry" case, which the
  sandbox piece rewrites under my grant (and it adds its twin row to `CAP_FLOOR_FACTS`).
- **`remedy-rewrite-comment`.** The comment above `CAP_FLOOR_ROWS` now says the override exists and that the designation
  piece rewrites the `poolset` remedy when its Settings doors land.

## Tests and measurements

| Suite | Result |
|---|---|
| `ccrc-update-cap-floor` | 44 passed (11 new) |
| `ccrc-rollout` | 47 passed (5 new) |
| `pool-set-loss` (new) | 7 passed |
| `pool-set-loss-lane` (new) | 12 passed |
| `sim/mutation-floors` (`poolSetLoss`) | 10 mutants, all killed, floor 1 |
| `ccrc-install-role` | 39 passed |
| `ccrc-doctor-cap-floor`, `ccrc-box-build-caps`, `update-watchdog-revert`, `ccrc-update-kept` | 15, 16, 16, 120 |
| `ccrc-update-phases`, `ccrc-update-flip-backups` | 256 (8 skipped), 351 |
| `ccrc-install-units`, `ccrc-settings-census`, `ccd-split-pin`, `ccd-contexts` | 48 (17 skipped), 22, 17, 15 |
| `push-composition-pin`, `push-copy`, `push-masker-pin`, `push-outbox-asks` | 5, 89, 3, 18 |
| `rings/*` (12 files), `consolidation-census`, `single-definition/advance-switches` | all green; 33, 53 |
| `watcher-quiet-census`, `lane-schedule`, `pools` | 4, 64, 34 |
| `growth-check` (`GROWTH_CHECK=1`) | 95 passed |
| `tsc` (server, its tests project) | clean |

### Growth, net code lines against the merge-base (`growthCheck.ts#codeLines`)

| File | Delta |
|---|---|
| `ccd/ccrc` | +28 |
| `server/src/watch.ts` | +3 |
| `server/src/poolrule.ts` | +18 (not a listed file) |
| `server/src/poolSetLossLane.ts` | new, not a listed file |

No waiver.

### Mutations

`poolSetLoss` joins `POOL_SET_MUTANT_SETS` (`server/test/sim/poolSetSets.ts`) with 10 mutants (L1 to L10), all killed,
floor 1. A planted survivor (L2 made a no-op) was reported `survived`, so the run bites.

| Mutation (by hand, restored from a saved copy) | Result |
|---|---|
| Task 9: the flag dropped from `dflags` | `ccrc-update-cap-floor`: 1 failed (the detached update) |
| Task 9: the flag dropped from `extra` | `ccrc-update-cap-floor`: 1 failed (the fall-through) |
| Task 9: the rollout's `below-cap` gate dropped | `ccrc-rollout`: 1 failed (the older box) |
| Task 9: the flag never lifts a row | `ccrc-update-cap-floor`: 6 failed |
| Task 9: the rollback's detach drops the flag | `ccrc-update-cap-floor`: 1 failed |
| Task 9: any word passes the argument check | `ccrc-update-cap-floor`: 2 failed |
| Task 9: B1's gate not lifted by the flag | `ccrc-rollout`: 1 failed |
| Task 9: the rollout's forwarding dropped | `ccrc-rollout`: 2 failed |
| Task 9: the rc 2 arm dropped | `ccrc-rollout`: 1 failed |
| Task 9: `unmeasured` lifted by any flag | `ccrc-update-cap-floor`: 2 failed |
| Task 10: the in-process latch dropped | `pool-set-loss-lane`: 1 failed (the failed archive) |
| Task 10: `hasNotice` not read | `pool-set-loss-lane`: 1 failed (the restart) |
| Task 10: the unreadable route fields dropped | `pool-set-loss-lane`: 1 failed (the unreadable set) |
