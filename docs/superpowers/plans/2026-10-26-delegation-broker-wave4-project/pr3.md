# Wave 4, PR3: journal compaction (task note)

This note is PR3's record for the wave's ledger pull request (Global Constraints, "Ledger edits"). The coordinator folds it into the
plan and the programme ledger; this PR edits neither.

## Status

- **Phase A** (no edit to `watch.ts`, `store.ts`, `mail-routes.test.ts`, `delegation-wave3.integration.test.ts` or
  `delegation-watch.test.ts`): Task 3.2 (the planner), Task 3.3 (`compactJournal`, the carried file, recovery's carried rules),
  Task 3.4's checkpoint half (the delete walk, the repair's step 0, the retained reader in the repair), Task 3.5 (C1) and Task 3.1's
  builder door (`upkeepIntervals`, `DelegationDurability.upkeep`, `rowsChanged`).
- **Phase B** (released by coordinator mail 10575): Task 3.1's unified lane call, Task 3.4's two store methods and required
  projection-port members, Task 3.7's daily trigger and diagnostics, the kebab arm W4-K2 in `mail-routes.test.ts`, and the closed
  retained-set census in `delegation-wave3.integration.test.ts` are committed at `15a4d0246`. Phase-B verification is recorded below;
  this is not a final handoff. Task 3.6 still waits for the coordinator's explicit release after #1578; neither snapshot file is edited.
- The lane rows the plan places in `delegation-watch.test.ts` go into a NEW file, `server/test/delegation-compaction-lane.test.ts`,
  because PR4 holds the old one (the coordinator's brief).

## Deviations found

- **D-7011** — `k6-keeps-a-whole-call-and-its-ager`: K6 is wider than the plan's "pair" in two ways, both found by reading the fold
  against the plan's text.
  - A call is every record on its key from the first listing-carrying PreToolUse up to and including the first PostToolUse. The plan
    says the next Bash record closes the pair, but the fold folds a second PreToolUse into the first call (it compares the latest
    listing), so a PostToolUse kept with only one of two PreToolUses could open, or compare, differently.
  - A carried call that the fold AGED (no PostToolUse within `DELEGATION_BASH_PENDING_MS`) carries the record that aged it. Without it,
    a recovery over the compacted set ages the call later, and a PostToolUse with no listing that the original fold read as unpaired is
    read as the call's PostToolUse instead, which opens an activity on a covered record and refuses `fold-refused`.
  Rows: `D-7011 (a)` and `D-7011 (b)` in `delegation-compaction.test.ts`; mutants D7011a and D7011b red them.
- **D-7012** — `k6-keeps-a-call-split-across-the-previous-cut`: a Bash call with a record in the current carried file and a record in the
  journal is carried whole, even when this cut removes the journal's record. The plan's Task 3.3 argument ("old carried lines that no
  rule selects any more are gone already, which is safe because nothing holds them") misses this case: after a crash between a SECOND
  compaction's two renames, the new carried file sits beside the UNCUT journal, and a PreToolUse carried last time for its straddling
  PostToolUse, dropped now because this cut also removes the PostToolUse, leaves that PostToolUse in the uncut journal without its
  PreToolUse, and recovery refuses `fold-refused`. Found by W4-C13b on the first implementation. Rows: `D-7012` (the planner) and
  W4-C13b; mutant D7012 reds both.
- **D-7013** — `mutation-table-as-measured`: the plan's mutation pins measure differently in the following cases.
  - W4-CM13 (skip the writer reopen) is EQUIVALENT: `writer-close` already drops the descriptor, and the writer reopens lazily by path,
    so it cannot write into the unlinked inode. The variant that also skips the close (W4-CM13v) is killed by W4-C14.
  - W4-CM22 (keep the launch-index entry) is not seen by W4-C22, because `memory-prune` drops a cut launch's entry before the
    retirement runs (and a retired run's launch is always cut). A new builder row, W4-C22b, kills it; CM22 with CM36 together red W4-C22.
  - W4-CM20 (retire an activity a record above S names) reds W4-C21, not W4-C20: in the fixture the record above S is a SubagentStop,
    which recovery reads as a stop-only candidate that ages out, so recovery stays ready.
  - Phase B: W4-CM1 survives W4-C2, because the same-hour pass never enters the upkeep door. Added W4-C2b, a new-hour pass
    that enters the real door with no work due; CM1 reds its `applied: null` assertion. The measured encode/write/revision deltas
    are zero without the mutation. No independent clone counter is claimed.
  - Phase B: startup reconstruction returns before the compaction-local readiness guard. W4-CM28 leaves that startup row green;
    a new real-lane row recovers into reconstruction during upkeep, at the compaction boundary, and reds the forbidden call.
- **D-7014** — `planner-and-applier-interface-details`: small departures from the plan's interface text.
  - The planner imports VALUES from `delegation-model.ts` as well as types (`parseDelegationInstant`, `encodeDelegationNaturalKey`,
    `DELEGATION_BASH_PENDING_MS`, and `isDelegationWorkerIndex`, moved into the model from the checkpoint so the planner's
    run-with-its-workers rule and the fold read one definition). No new outward edge: the checkpoint already imports the model.
  - `compactJournal` answers `{ kind: 'skipped', reason: 'not-ready' }` on an applier that is not ready, instead of throwing through
    `requireReady()`.
  - The builder keeps a private `equalPreSequence` map (the sequence of the PreToolUse behind each 'equal' Bash-call fact), because the
    fact itself carries only the PreToolUse's journalId and `memory-prune` needs its position. The clone census becomes 18 collections.
  - `DelegationDurabilityDeps.eventsDeleteChunk` and `repairDelegationProjection`'s `deleteChunk` are test seams for
    `DELEGATION_EVENTS_DELETE_CHUNK`.
  - Phase A only: the projection port's `countEventsAtOrBelow` and `deleteEventsBetween` are optional, because the production port
    (`watch.ts`) and the store methods are phase B's; phase B makes them required (now implemented).
  - The retained reader supplies validated physical carried-file byte and line totals through an optional callback, and the planner's
    `finish` accepts those totals. Counting only yielded carried records misses journal copies after a crash between the two renames.
    W4-C29's crash-window regression first measured 0 bytes/0 lines instead of 9,270 bytes/12 lines, then passed with the same-stream
    measurement. There is no second file read, no changed retained-set membership, and no weakening of byte-for-byte validation.
- **D-7015** — `unused`
- **D-7016** — `unused`

## Phase B verification

All measurements below are fixture-only. Scratch mutations run sequentially in one root-disk source copy, with a measured process
cap, `timeout -k`, saved-copy restoration and SHA checks; tracked production source is never mutated.

| Measurement | Result |
| --- | --- |
| W4-CM1 against W4-C2 | Survived; same-hour pass never enters the door |
| W4-CM1 against added W4-C2b | Red; a no-op hourly door committed |
| W4-CM2 against W4-C1 | Red; 3 encodes instead of 1, with 1 write and 1 revision |
| W4-CM3 against W4-C3 | Red; the mid-hour interval never entered upkeep |
| W4-CM16 against the closed source census | Red; `removeTemp(this.journalPath)` is an unlisted act |
| W4-CM27 against W4-C28 | Red; two same-day attempts instead of one |
| W4-CM28 against startup and boundary reconstruction rows | Startup passed, new boundary row red |
| N6 hour-spending mutation against new N6/RB22 row | Red; a rejected hourly upkeep retried in the same hour |
| Compaction suite, including the crash-window diagnostic | 64 passed |
| Real-lane compaction/upkeep suite | 12 passed |
| Recovery suite | 448 passed |
| Pass-timing suite | 88 passed |
| Wave-3 integration / closed retained-reader census | 34 passed |
| Kebab / mail-route census | 59 passed |
| Required-port adapters: delta applier / coordinator intent / health | 26 / 64 / 52 passed |
| Update flip / backups | 252 passed |
| Update phases | 246 passed, 6 skipped |
| Single-definition directory | 908 passed across 12 files |
| Full ring directory | 62 passed across 10 files |
| Anchors / citations / coordination-policy rings | 26 passed across 3 files |
| Untouched PWA suite | 10,242 passed, 1 skipped across 314 files; no type errors; jsdom printed its canvas `getContext` not-implemented notices |
| Untouched PR4-held watch suite | 8 failed, 272 passed; exact re-points below, not a green-suite claim |
| Tests-inclusive TypeScript | Passed after installing the declared agent dependencies; the earlier missing-`ws` failure was environmental |
| Armed growth check (`GROWTH_CHECK=1`) | 47 passed on committed implementation `15a4d0246` |
| Full server suite | Unrun while Task 3.6 and the complete deliverable are pending; no final suite claim |

The final pre-commit recheck on 2026-10-27 passed tests-inclusive TypeScript and, each alone, compaction (64), pass timing (88),
wave-3 integration (34) and real-lane compaction/upkeep (12). The complete PR3 deliverable is not done: Task 3.6 remains blocked,
the held watch suite remains red and the full server suite is unrun. The HEAD-based growth check passed all 47 rows after the
phase-B implementation commit. The diff from the branch base touches no reserved #1558 watch hunk. No PR or final wave-done
is issued; the next implementation wake is the coordinator's explicit Task 3.6 release.

The dependency installs reported audit findings: agent 6 (3 moderate, 3 high), UI 9 (5 moderate, 3 high, 1 critical), and PWA 12
(1 low, 4 moderate, 7 high). No dependency versions or lockfiles were changed; no audit repair was attempted in this work.

### Owned timing rows re-pointed or amended

- `D-5835 R1 (ii)`: the same-hour no-write/yield row now spies on `upkeep`, keeps the attempt-collapse
  `applyCheckpointChange` assertion, and measures encode/write/revision at upkeep start through compact start. The earlier flush
  phase is outside the claim and may legitimately write.
- `D-5692 R1`: the exact phase set includes `compact`.
- `D-5832 R1`: blocking CPU includes the compact phase; the fixture's expected sum rises by its 47 ms.
- `RE2`: 117 formatter inputs, 2,038 bytes at seven digits (114 kept, 3 dropped), and 77 kept / 40 dropped at the largest safe
  values. The six compaction sizes survive; the omitted fields are exactly the list's suffix. The 2,048-byte production bound is unchanged.

### Blocked re-points in the PR4-held watch test

No edit to `server/test/delegation-watch.test.ts` is made. The following are the precise handover, preserving each behavior:

| Row / group | Required re-point |
| --- | --- |
| Cursors (hand-off 4), checkpoint-only-change invariant | Keep the `applyCheckpointChange` observer for attempt filing and its unchanged-cursor assertions. Observe real `upkeep` separately, forwarding its request, and compare durable cursor rows before/after it. Require interval removal through that door, not an interval decrease in `applyCheckpointChange`; keep nonempty disk cursors and the lane source prohibition on direct cursor assignments |
| N6, failed prune | Spy on `upkeep`; expect `delegation upkeep failed:` once, reconcile continues, and no same-hour retry |
| R58, aged cursor dropped once per hour | Spy on `upkeep`; keep disk cursor and `cursorsPruned` assertions; the later-hour no-op enters the door but must not encode, write or move revision |
| R58, droppable cursor reappears | Spy on `upkeep`; first-hour call count 1, same hour still 1, next hour 2; keep disk cursor assertions |
| R58, young cursors | Hourly upkeep entry is legitimate; assert no cursor drop or durable mutation, not zero door entries |
| R58, source pin | Name `upkeep(` instead of `pruneBucketCursors(`; keep the readable-bucket and cursor-policy pins |
| RB21 / `watchDoor` | Forward `DelegationUpkeepRequest` to real `upkeep`; keep retired-row/mapping and per-hour/revision assertions; account for the expanded outcome shape |
| RB22 | Reject unified `upkeep`; expect its unified warning; keep reconcile continuation and spent-hour assertions |
| RE9 | Inspect `DelegationLane.upkeep`, require its call to `upkeep`, and forbid `applyCheckpointChange` within that method |

Other `applyCheckpointChange` spies cover real attempt/lease/setup behavior and are not blanket-replaced. Added real-lane rows cover
C1-C3, hourly no-op and rejected upkeep while those historical rows remain held. Task 3.6 and a final PR/wave-done remain blocked.

## W3-M38, amended (for the wave-3 plan, plan :991)

W3-M38 is to read: "Add a journal rewrite, truncate, rename or remove caller other than the tail heal and `compactJournal`, or drop a
carry rule", with its rows `delegation-wave3.integration.test.ts`'s closed list and W4-C6..C8.
