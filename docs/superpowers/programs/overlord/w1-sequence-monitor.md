# Overlord W1, the one sequence, PR A: task notes

Plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md`, PR A (Tasks 1 to 3); spec
`docs/superpowers/specs/2026-11-09-overlord-design.md` §10.4. This note records what the ledger should learn from this pull
request. The coordinator folds it into the programme ledger.

## What was built

- `shared/overlord-sequence.ts` (L0): the line's wire shape, `SEQUENCE_KIND_MAP` (generation, designation and message), the
  bounds, the 90-day keep, the prune batch, the page size and the cursor read's four-arm answer. It uses
  `DESIGNATION_SEQUENCE_STATES` from `shared/overlord-designation.ts`, the designation's one list.
- `server/src/coord/overlordSequence.ts` (L1): `sequenceLineVerdict`, `sequenceLineKnown`, `sequencePage`, `retentionCut` and
  `SEQUENCE_KEPT_KIND`. Each decider is on the mutation floors at 1.
- `server/src/coord/overlordSequenceStore.ts` (L3): the two tables' one writer (`stampSequenceInTx`), the one deleter and
  floor writer (`pruneSequenceThrough`), and the reads `sequenceAfter` and `sequenceOldest`.
- One migration with two tables, `overlord_sequence` (AUTOINCREMENT) and `overlord_sequence_pruned`. Review round 4 read
  it at slot 124; the second-lander merge puts it at 125, after Capture's migration at 124.
- The in-transaction stampers:
  - `continuityStore.ts#mintGeneration` stamps `ended` for the row it ends and the new row's state;
  - `#stepGeneration` stamps a live walk's entered state, in a `tx()` it now opens;
  - `#endOverlordGeneration` stamps `ended`, and it now takes `at`;
  - `overlordDesignationStore.ts#designatePending`, `#goLive`, `#failPending`, `#retire` and `#applyDesignationRestoreInTx`
    stamp designation state changes.
- The Inbox acknowledgement is the post-commit exception; it stamps a text-free message line in a separate transaction.
- `server/test/sequence-stamp-census.test.ts`: every writer of each stamped table, either a stamper or listed with the reason
  it stamps nothing, checked both ways against the writers scan.
- The retention lane, `sequenceRetention` (hourly, monotonic, `skip`), in `server/src/coord/sequenceRetentionLane.ts`, run by
  `FleetWatcher.sweepSequenceRetention`.

## Stamp ownership after integration

| Kind | Table | Stamped by this PR | Left to their piece |
|---|---|---|---|
| generation | `continuity_generations` | `mintGeneration`, `stepGeneration`, `endOverlordGeneration` | `restampOverlordGeneration` moves the identity only; designation B's rebind moves it to the stampers |
| designation | `overlord_designation` | `designatePending`, `goLive`, `failPending`, `retire`, clearing `applyDesignationRestoreInTx` | none |
| ladder | `overlord_ladder`, `overlord_latches` | none | PR B (slug `ladder-stamps-ride-pr-b`) |
| message | `operator_messages` | Inbox acknowledgement (post-commit) | PR B owns the queue, mail-lane delivery and settle, settlement mark and mover-caller census (slug `message-stamps-ride-pr-b`); other moves below |

## Departures, by slug

- `stamp-failure-is-a-row-write-failure`. Any throw after a durable append in a stamped designation transaction calls the
  append receipt after rollback is attempted and before the original error reaches the caller. The receipt delegates to
  `AuthorityGuardPort.writerFailed('trailing')`: the designation row, head row and sequence lines roll back, while durable
  records stand. A stamp insert failure throws `SequenceStampRefused`; verdict failures are checked before an append. No
  successful append means no receipt call, and a receipt that throws cannot replace the original failure. The immediate
  fence says `trailing` even when an independent remeasurement of a two-record file says `ahead`. No reader branches on that
  distinction; it differs in diagnostic text only. The guard, remeasurement and Confirm paths are unchanged.
- `ladder-stamps-ride-pr-b`. The ladder merged before sequence A. The index's "sequence writer" bullet gives its stamps to
  PR B ("if it merges after sequence A; otherwise PR B wires it"), and the plan's question 11 notes that the ladder's rows
  carry no actor kind yet. PR A therefore has no ladder stamps or kind rows. The ladder and decision-model writers do not
  take the ordinary append receipt; PR B's ticket carries that follow-up.
- `message-stamps-ride-pr-b`. Instead of wiring the message movers already on `main` in PR A, sequence PR B owns the queue
  move, mail-lane delivery and settle moves, the settlement mark, and the census of mover callers, alongside the ladder
  stamps (review round 4). PR A keeps the Inbox acknowledgement and its post-commit stamp path.
- `retire-lines-carry-the-retiring-actor`. A live retire that cancels a pending attempt writes `failed` for the pending id,
  then `retired` for the bound id (review F12). Both lines carry the retiring operator, the actor the retire writes to the
  row. `failPending` carries the attempt's own actor (`pendingActor`), because it writes no actor of its own.
- `generation-lines-are-the-servers`. The generation row records no actor, so every generation line takes `server` as its
  actor and kind. This includes the `ended` lines a retire writes through `endOverlordGeneration`. In the sequence, those
  lines come before the designation's lines of the same retire, because the generations end before the row is written.
- `sequence-line-known-is-a-decider`. Whether a stored line is named (`known`) is decided in L1 (`sequenceLineKnown`), not in
  the store. A stored actor kind outside gates A's words also makes the line opaque, with `actorKind: 'unknown'`.
- `step-refusal-logged-through-one-wrapper`. The generations lane logs a step that the sequence refused (review F11) through
  one wrapper around `stepGeneration`, reached by the card, probe and due feeds. The merge keeps the store's `StepResult`
  delegate and all three calls. A real SQLite refusal rolls each feed's live step back and logs the refusal; bypassing the
  wrapper leaves the corresponding case without its log. `renewalActs.ts` keeps its own "not written" line.

## Fix round 3: measured rollback controls

| Control | What goes red |
|---|---|
| Replace the wrapper with a plain transaction in `designatePending`, `goLive`, or `retire`, one at a time | The corresponding real-journal writer case sees `coherent` instead of `rolled-back: trailing`. Retire is exercised with and without a pending attempt. |
| Remove the receipt call from the wrapper | A durable append followed by rollback no longer fences immediately. |
| Retain and call the previous receipt on a throw with no new append | A pending-only retire leaves the records unchanged but incorrectly fences the real guard. |
| Make the successful journal receipt a no-op | The journal's own suite sees the guard stay `coherent` after the receipt is called. |
| Fence only on `SequenceStampRefused` | A designation row-write error after the append leaves the guard unfenced. |
| Let the receipt exception escape | The caller sees the receipt error instead of the original stamp refusal. |
| Stamp only a journalled live retire | The row-only retire loses its `failed` and `retired` sequence lines. |

The designation controls are in the mutation floor at 1; the journal receipt control runs in the journal's own suite. The
unmutated cases verify the original database snapshot is restored after rollback while the durable records stand.

## Fix round 4: measured wiring controls

Each control ran separately through the test wrapper. Direct source edits were restored byte for byte after each run;
for the receipt, the journal case checked a passing baseline and a killed scratch-module mutant.

| Control | Observed failure |
|---|---|
| Remove Confirm's designation stamp | Five cases fail: the three clearing cases lose their designation lines, and the two refused-stamp cases instead report success. |
| Revert Confirm to stamping only the bound session | Both pending cases fail: the bound-plus-pending row lacks `failed` and the pending-only row lacks `retired`. |
| Remove the Inbox stamp call | Two cases fail: a new settlement has no line, and the refused-stamp fixture answers 200 rather than 503. |
| Keep the stamp call but ignore its refusal | The refused-stamp case answers 200 rather than the partial 503. |
| Check for no coordination store after settling | The route still refuses, but the private row has already changed. |
| Make the successful journal receipt a no-op | The guard stays `coherent` rather than fencing `rolled-back: trailing`; the journal case reports the mutant killed. |
| Bypass the wrapper at the card feed | The card step still rolls back, but its refusal log is missing. |
| Bypass the wrapper at the probe feed | The probe step still rolls back, but its refusal log is missing. |
| Bypass the wrapper at the due feed | The due step still rolls back, but its refusal log is missing. |

## Second-lander work and remaining duties

- **Confirm the restore** (authority journal C) landed first. `applyDesignationRestoreInTx` passes Confirm's `at` to
  `endOverlordGeneration` before stamping designation lines with the same `at`. When clearing a binding, it stamps `failed`
  for a cancelled pending attempt before `retired` for the bound session. A pending-only cancellation stamps `retired`.
  A kept binding, or a row with neither a binding nor a pending attempt, emits no designation line. Confirm's own catch in
  `OverlordRestoreState.confirm` calls `guard.writerFailed('trailing')` after rollback when the Confirm append succeeded;
  it does not use the ordinary receipt. The real-journal proof leaves the Confirm record durable while the head, designation,
  generation and sequence rows roll back on a refused retirement stamp, with and without a pending attempt.
  The cursor's page decider already accepts a restore generation;
  there is no page caller in PR A. PR C's cursor door should pass the already-landed `OverlordRestoreState.restoreGeneration()`
  reading, keeping an unmeasured result distinct from generation zero.
- **The inbox acknowledgement** now stamps a `message` line only when it settles a message, in a `coord.db` transaction
  after the private commit (sequence plan question 17, Inbox plan question 19). It stamps the id, `settled`, actor
  `acknowledge` of kind `server`, and the move's `at`, never message text. Clarifying the plan's question 17: a crash or a
  refused stamp between the two commits can leave a settled message without a line. On refusal, the sequence transaction
  rolls back, the server logs the refusal and the route reports the partial outcome; it cannot undo the private move.
  Repeats, spent messages and already-settled races stamp nothing. A missing line remains unmeasured for that message,
  not a violation. The census pins the SQL writers separately from the route's post-commit call through the delegate.
- **Migration position.** The original slot 121 moves after the base's last migration, with `coord-db` and `run-close-switch`
  re-pinned together.

### Message moves after Inbox landed

| Mover | What it moves | Sequence ownership |
|---|---|---|
| `promptRecord.ts` through `OperatorModelStore.recordMessage` and `moveMessage` | creates, may settle by an operator mark, and queues a nudge | unstamped here; PR B owns the settlement mark and queue |
| `nudgeLane.ts#settleOperatorNudge` | records delivery after the lane delivers, then acks the nudge | unstamped here; PR B |
| `nudgeLane.ts#settleAckedOperatorNudge` | settles a self-acked nudge by moving the private message to `delivered` if not there yet | unstamped here; PR B |
| `bootPass.ts` | clears an unsupported settlement, queues a missing nudge, or records one already delivered | unstamped here; PR B owns the queue arm, remaining arms are boot follow-up |
| Hook pick-up report (`continuity/routes.ts`, store port in `server.ts`) | marks the message as picked up | unstamped; door-process follow-up |
| Inbox acknowledge route | settles a message not settled or spent | stamped here |
| Citing doors | settle or spend after their own commit; vocabulary only on this base | not yet wired; W2 citing-door work |
