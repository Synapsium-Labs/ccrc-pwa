# Overlord W1, the one sequence, PR A: task notes

Plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md`, PR A (Tasks 1 to 3); spec
`docs/superpowers/specs/2026-11-09-overlord-design.md` §10.4. This note records what the ledger should learn from this pull
request. The coordinator folds it into the programme ledger.

## What was built

- `shared/overlord-sequence.ts` (L0): the line's wire shape, `SEQUENCE_KIND_MAP` (the generation and the designation), the
  bounds, the 90-day keep, the prune batch, the page size and the cursor read's four-arm answer. It also holds
  `DESIGNATION_SEQUENCE_STATES` in `shared/overlord-designation.ts`, the designation's one list.
- `server/src/coord/overlordSequence.ts` (L1): `sequenceLineVerdict`, `sequenceLineKnown`, `sequencePage`, `retentionCut` and
  `SEQUENCE_KEPT_KIND`. Each decider is on the mutation floors at 1.
- `server/src/coord/overlordSequenceStore.ts` (L3): the two tables' one writer (`stampSequenceInTx`), the one deleter and
  floor writer (`pruneSequenceThrough`), and the reads `sequenceAfter` and `sequenceOldest`.
- One migration with two tables, `overlord_sequence` (AUTOINCREMENT) and `overlord_sequence_pruned`. It took slot 121, the next
  free slot on `main` at build.
- The stamped writers on `main` call the writer inside their own transaction:
  - `continuityStore.ts#mintGeneration` stamps `ended` for the row it ends and the new row's state;
  - `#stepGeneration` stamps a live walk's entered state, in a `tx()` it now opens;
  - `#endOverlordGeneration` stamps `ended`, and it now takes `at`;
  - `overlordDesignationStore.ts#designatePending`, `#goLive`, `#failPending` and `#retire` stamp the designation's line.
- `server/test/sequence-stamp-census.test.ts`: every writer of each stamped table, either a stamper or listed with the reason
  it stamps nothing, checked both ways against the writers scan.
- The retention lane, `sequenceRetention` (hourly, monotonic, `skip`), in `server/src/coord/sequenceRetentionLane.ts`, run by
  `FleetWatcher.sweepSequenceRetention`.

## The stamped writers on `main`, re-measured at b33a9ae137

| Kind | Table | Stamped by this PR | Left to their piece |
|---|---|---|---|
| generation | `continuity_generations` | `mintGeneration`, `stepGeneration`, `endOverlordGeneration` | `restampOverlordGeneration` moves the identity only; designation B's rebind moves it to the stampers |
| designation | `overlord_designation` | `designatePending`, `goLive`, `failPending`, `retire` | none |
| ladder | `overlord_ladder`, `overlord_latches` | none | PR B (slug `ladder-stamps-ride-pr-b`) |
| message | the private store's moves through the mail lane (`settleOperatorNudge`) and the prompt route | none | the inbox piece and private store B's follow-up (the index's "sequence writer" bullet) |

## Departures, by slug

- `stamp-failure-is-a-row-write-failure`. The designation writer checks its lines' verdict before any append. If a stamp
  insert still fails, `SequenceStampRefused` rolls back the designation row, the head row and the sequence lines, while the
  durable records stand. Fix round F1 closes the original next-append gap: the journal's successful append receipt delegates
  to the existing `AuthorityGuardPort.writerFailed('trailing')`, and the stamped writer calls it before propagating the
  transaction failure. No successful append means no such call. The guard, remeasurement and Confirm paths are unchanged.
- `ladder-stamps-ride-pr-b`. The ladder merged before sequence A. The index's "sequence writer" bullet gives its stamps to
  PR B ("if it merges after sequence A; otherwise PR B wires it"), and the plan's question 11 notes that the ladder's rows
  carry no actor kind yet. PR A therefore stamps the generation and the designation only. Its kind table has no ladder rows.
- `retire-lines-carry-the-retiring-actor`. A live retire that cancels a pending attempt writes `failed` for the pending id,
  then `retired` for the bound id (review F12). Both lines carry the retiring operator, the actor the retire writes to the
  row. `failPending` carries the attempt's own actor (`pendingActor`), because it writes no actor of its own.
- `generation-lines-are-the-servers`. The generation row records no actor, so every generation line takes `server` as its
  actor and kind. This includes the `ended` lines a retire writes through `endOverlordGeneration`. In the sequence, those
  lines come before the designation's lines of the same retire, because the generations end before the row is written.
- `sequence-line-known-is-a-decider`. Whether a stored line is named (`known`) is decided in L1 (`sequenceLineKnown`), not in
  the store. A stored actor kind outside gates A's words also makes the line opaque, with `actorKind: 'unknown'`.
- `step-refusal-logged-through-one-wrapper`. The generations lane logs a step that the sequence refused (review F11) through
  one wrapper around `stepGeneration`, which every step of the pass uses. `renewalActs.ts` keeps its own "not written" line.

## For the pieces that follow

- **Confirm the restore** (authority journal C) adds `applyDesignationRestoreInTx`, a new writer of `overlord_designation`
  that ends generations through `endOverlordGeneration`. Whichever lands second passes `at` there, and puts the writer in
  the stamp census, stamping a Confirm that clears the binding as `retired` the way `retire` does. Authority journal C also
  switches the cursor read's `restoreGeneration` from `unmeasured` to its counter.
- **The inbox acknowledgement** gets its `message` line and matching census entry together in the second lander of Sequence A
  and Inbox (plan question 17). The existing message queue, delivery and settlement writers remain unstamped and outstanding.
- **Migration 121** is provisional: a later lander renumbers by position and re-pins `coord-db` and `run-close-switch`.
