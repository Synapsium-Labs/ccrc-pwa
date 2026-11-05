# PR4 notes: the orphan-tree lane skips a held tree

Run 1471, wave 5 PR4 (F4). Departures are defined in the plan's "Deviations found":

- D-8009 `orphan-rung-missing-index-with-carriers`: the rung measures `leases/` before it derives the tree key, so it stays
  inert on a box with only wave 3's spool; a missing by-tree index while a carrier stands refuses `unmeasured` (review 1438
  A-e, ruled in the brief; review 1475 F3, ruled in fix round 1).
- D-8010 `orphan-health-counts-lease-unready`: `DiskOrphanTrees.leaseUnready`, optional, written only above zero.
- D-8011 `orphan-beat-takes-the-checkpoint-read`: the beat's constructor order keeps #1565's "disk block last" pin.
- D-8012 `orphan-token-binds-the-read-carrier`: the token binds the carrier the index entry names, held or not.
- D-8013 `orphan-beat-carrier-state-in-pr4`: W5-O14 and the beat's carrier-state `heldStateOf` land in PR4, so the PR5
  file-list line on `orphanTreeBeat.ts` no longer applies to PR5b.
- D-8014 `orphan-hold-unparseable-expiry-not-ready`: an unparseable `cleanupDueAt` answers `not-ready`, as a null one does.

## What changed against the plan's text, without a number

- `ORPHAN_LEASE_STOPS` (`orphanTreeLane.ts`): the `stopped` word for each hold answer that composes nothing (`held` is
  `leased`, `not-ready` is `lease-unready`), read by the executor and the sweep, so neither word is spelled in `server/src/coord`
  (the mail-routes kebab census) and the sweep's test is `'why' in out`, not a lifecycle compare (hibernate-census).
- `orphanLeaseHold`'s `checkpoint` is `DeepReadonly<DelegationCheckpointV1> | null`, the type the applier's `state()` returns;
  a mutable checkpoint is assignable to it.
- `checkpointWithLease(over, extra)` takes an optional second argument laid on the checkpoint (W5-O14's `leaseCarriers` row).
- `orphanLeaseHold`'s `orphanClass` may be null, for a tree the lane holds no row for (review 1475 F5): on no checkpoint it
  answers `not-ready`, so the act stops with the existing word `lease-unready`; a ready checkpoint reads it like any class.
- The box's `leased` detail says the expiry as an ISO instant (`until 2026-11-12T10:00:00.000Z`), never epoch milliseconds, and
  `ORPHAN_LEFT_SENTENCE` says the word as "a delegation lease holds it" (review 1475 F7).
- W5-O14 drives the beat's own `beatLeaseHold` as well as the decision, so its mutant (W5-OM14, the beat back on
  `l.disposition`) is measured on the wiring itself.
- The verb's refusal document has `refused`, not `removed: false` and `refusal`; W5-O2 and W5-O2b assert `refused:
  'state-changed'` and no `removed`.
- The six W5-O0 trees and their reader moved from the characterisation suite to `server/test/orphanLadderFixture.ts`, in a
  commit that changed nothing they produce, so W5-O7 and W5-O7b compare all six documents with the fixture.
- New rows beyond the plan's list:
  - W5-O3c: an empty `leases/` with no index is not held; an unlistable one is `unmeasured`.
  - W5-O4d: a clock answer that is not a whole number of seconds is `unmeasured` (review 1475 F4).
  - W5-O6b: `adopted` or `retained` at this tree with no expiry is `unmeasured` (review 1475 F1).
  - W5-O7b: with only the spool, the six documents equal the fixture, and a leaseless tree whose gitfile is unreadable, or
    names no admin record of this repository, answers what it answers with no `$REG/delegation` (review 1475 F3).
  - W5-O12d and W5-O13c: the unknown class (F5).
  - W5-O13d: the `lease-unready` count clears on a later outcome and when the census drops the tree, and a returning tree is
    counted once (F6).
  - W5-O13e: the `leased` sentence (F7). W5-O13f: `leaseUnready` through `readDiskHealth` (F8).
  - W5-O13g (`orphan-tree-beat-ready.test.ts`): the real `FleetWatcher.delegationCheckpointIfReady()` is null before the
    applier opens and while it is `reconstructing`, and the checkpoint once `ready`; the beat the watcher builds reads it (F2).
  - W5-V4 in `single-definition/vocabularies.test.ts`: the two new vocabularies, and the box's held set and margin equal the
    server's.
- W5-O7 compares all six W5-O0 documents (with no `$REG/delegation`, and under an `ephemeral`, `promoted` and `released`
  carrier at each tree); W5-O13 compares the whole composed argv (review 1475 F10).
- `ccd-ws-orphan-verb.test.ts`, `ccd-orphan-audit.test.ts` and `ccd-orphan-argv.test.ts` needed no change: their rows pass
  with the rung in place. `orphan-tree-lane.test.ts`'s executor rows changed only by the new `cls` argument and a free
  `leaseHold` in their deps; no #1565 row changed.
- The mutation-run helper drives Python modules, so the mutants were run by hand, one at a time from a saved copy, each
  vitest call under `timeout -k` and a process cap measured from the user's live thread count.

## Mutation table, as measured (at the fix round's tip, every mutant re-run)

| Mutant | Edit | Went red |
|---|---|---|
| W5-OM1 | delete the rung's call | W5-O1 (and every rung row) |
| W5-OM2 | fold the index's rc 4 to not held | W5-O3 |
| W5-OM3 | fold a missing carrier behind an entry to not held | W5-O4, W5-O4b |
| W5-OM12 | the `canonicalPath` compare ahead of the state test | W5-O4c |
| W5-OM4 | drop the margin | W5-O5 |
| W5-OM5 | drop `transferring` from the box's held states | W5-O6, W5-O4 |
| W5-OM5s | drop `transferring` from `DELEGATION_ORPHAN_HELD_STATES` | W5-O14, the held-set row |
| W5-OM6 | drop `leasegen` from the token's inputs | W5-O2b, W5-O7, W5-O7b |
| W5-OM15 | a missing index reads not held whatever the carriers | W5-O3b |
| W5-OM7 | `free` on a null checkpoint | W5-O9, W5-O13b, W5-O13d |
| W5-OM8 | skip the `leaseHold` ask | W5-O13, W5-O13b, W5-O13c, W5-O13d |
| W5-OM13 | hand `leaseHold` `orphanPathOfHex(hex)` | W5-O13 (the long and tab paths) |
| W5-OM9 | `not-ready` for every class on a null checkpoint | W5-O12b, W5-O13b |
| W5-OM11 | `free` for `ccd-root` before the ready checkpoint | W5-O12c |
| W5-OM10 | drop `orphan-lease-v1` from `cmd_caps` | W5-O9b, `ccd-archive` (W5-G1) |
| W5-OM14 | the beat's `heldStateOf` back to `l.disposition` | W5-O14 |
| W5-OM16 | the no-expiry refusal replaced with `:` (F1) | W5-O6b |
| W5-OM17 | `readyCheckpoint` drops `phase === 'ready'` (F2) | W5-O13g |
| W5-OM18 | the beat's checkpoint read wired to `() => null` (F2) | W5-O13g |
| W5-OM19 | the tree key derived before `leases/` is measured (F3) | W5-O7b |
| W5-OM20 | drop the clock's digits check (F4) | W5-O4d |
| W5-OM21 | an unknown class reads `free` on no checkpoint (F5) | W5-O12d, W5-O13c |
| W5-OM22 | the learning audit leaves the `lease-unready` count alone (F6) | W5-O13d |
| W5-OM23 | the census does not prune the `lease-unready` count (F6) | W5-O13d |
| W5-OM24 | drop the `leased` sentence (F7) | W5-O13e |
| W5-OM25 | the box says the expiry in epoch ms again (F7) | W5-O1 |
| W5-OM26 | `readOrphanTrees` drops `leaseUnready` (F8) | W5-O13f |

## Growth

`ccd/ccd` +1 (the cap word). `server/src/watch.ts` +4 net (`delegationCheckpointIfReady` and the lane's `readyCheckpoint`,
the beat's construction changed in place).
