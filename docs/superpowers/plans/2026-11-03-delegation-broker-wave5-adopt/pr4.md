# PR4 notes: the orphan-tree lane skips a held tree

Run 1471, wave 5 PR4 (F4). Departures are defined in the plan's "Deviations found":

- D-8009 `orphan-rung-missing-index-with-carriers`: a missing by-tree index while a carrier stands refuses `unmeasured` (review
  1438 A-e, ruled in the brief).
- D-8010 `orphan-health-counts-lease-unready`: `DiskOrphanTrees.leaseUnready`, optional, written only above zero.
- D-8011 `orphan-beat-takes-the-checkpoint-read`: the beat's constructor order keeps #1565's "disk block last" pin.
- D-8012 `orphan-token-binds-the-read-carrier`: the token binds the carrier the index entry names, held or not.

## What changed against the plan's text, without a number

- `orphanLeaseHold`'s `checkpoint` is `DeepReadonly<DelegationCheckpointV1> | null`, the type the applier's `state()` returns;
  a mutable checkpoint is assignable to it.
- `checkpointWithLease(over, extra)` takes an optional second argument laid on the checkpoint (W5-O14's `leaseCarriers` row).
- W5-O14 drives the beat's own `beatLeaseHold` as well as the decision, so its mutant (W5-OM14, the beat back on
  `l.disposition`) is measured on the wiring itself.
- The verb's refusal document has `refused`, not `removed: false` and `refusal`; W5-O2 and W5-O2b assert `refused:
  'state-changed'` and no `removed`.
- New rows beyond the plan's list: W5-O3c (an empty `leases/` with no index is not held; an unlistable one is `unmeasured`),
  W5-V4 in `single-definition/vocabularies.test.ts` (the two new vocabularies, and the box's held set and margin equal the
  server's).
- `ccd-ws-orphan-verb.test.ts`, `ccd-orphan-audit.test.ts` and `ccd-orphan-argv.test.ts` needed no change: their rows pass
  with the rung in place. `orphan-tree-lane.test.ts`'s executor rows changed only by the new `cls` argument and a free
  `leaseHold` in their deps; no #1565 row changed.
- The mutation-run helper drives Python modules, so the mutants were run by hand, one at a time from a saved copy, each
  vitest call under `timeout -k` and a process cap measured from the user's live thread count.

## Mutation table, as measured

| Mutant | Edit | Went red |
|---|---|---|
| W5-OM1 | delete the rung's call | W5-O1 (and every rung row) |
| W5-OM2 | fold the index's rc 4 to not held | W5-O3 |
| W5-OM3 | fold a missing carrier behind an entry to not held | W5-O4, W5-O4b |
| W5-OM12 | the `canonicalPath` compare ahead of the state test | W5-O4c |
| W5-OM4 | drop the margin | W5-O5 |
| W5-OM5 | drop `transferring` from the box's held states | W5-O6, W5-O4 |
| W5-OM5s | drop `transferring` from `DELEGATION_ORPHAN_HELD_STATES` | W5-O14, the held-set row |
| W5-OM6 | drop `leasegen` from the token's inputs | W5-O2b, W5-O7 |
| W5-OM15 | read the index's rc 3 as not held whatever the carriers | W5-O3b, W5-O3c |
| W5-OM7 | `free` on a null checkpoint | W5-O9, W5-O13b |
| W5-OM8 | skip the `leaseHold` ask | W5-O13, W5-O13b |
| W5-OM13 | hand `leaseHold` `orphanPathOfHex(hex)` | W5-O13 (the long and tab paths) |
| W5-OM9 | `not-ready` for every class on a null checkpoint | W5-O12b, W5-O13b |
| W5-OM11 | `free` for `ccd-root` before the ready checkpoint | W5-O12c |
| W5-OM10 | drop `orphan-lease-v1` from `cmd_caps` | W5-O9b, `ccd-archive` (W5-G1) |
| W5-OM14 | the beat's `heldStateOf` back to `l.disposition` | W5-O14 |

## Growth

`ccd/ccd` +1 (the cap word). `server/src/watch.ts` +4 net (`delegationCheckpointIfReady` and the lane's `readyCheckpoint`,
the beat's construction changed in place).
