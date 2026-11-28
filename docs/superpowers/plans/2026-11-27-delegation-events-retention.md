# `delegation_events` keeps only the events something reads — implementation plan

**Spec:** `docs/superpowers/specs/2026-11-27-delegation-events-retention-design.md` (ruled by the operator on 2026-11-27).
**Goal:** SQLite's `delegation_events` keeps every class of evidence except the three Bash classes. The journal, the checkpoint,
the carried file and compaction stay unchanged. The table is live when it ships, the Shadow lanes card row is the operator's
Off switch, and the lane stops itself on a mismatch and stays stopped until the operator re-arms it with a tap.
**Context:** C5 (the delegation lane). **Numbers issued:** D-9165 to D-9170, defined below.

## Rulings this plan builds (2026-11-27)

- D1 (a): every class except `bash-plain`, `bash-listed` and `bash-shed`.
- D2: no shadow phase. The card row is seeded Live and is the Off switch. The automatic stop: when the per-pass repair finds
  SQLite disagreeing with the kept-classes rule (a mismatch it would fix by replay), the lane keeps every class again by
  itself, records why once (one durable operator notice) and does not re-arm itself; the operator's tap re-arms it. The daily
  counts line stays (D-9170).
- The first pass's batch cost limits itself: each batch is timed, and the next is halved when one takes over 100 ms.
- D3 (a): no `VACUUM`. D4: the journal is unchanged.

## Global constraints (each PR)

- **Rings.** L1 decides with no I/O, L3 adapters keep every distinction they receive, L4 delivers and never decides, and only
  `index.ts` is L5. A new `coord/` file is context C5 by the context table's directory row.
- **`coord.db`.** `DatabaseSync` stays synchronous, with no repository or async layer over `CoordStore`. Migrations are
  additive, each a new `MIGRATIONS` entry; re-measure the slot before the PR and before merge.
- **One writer per fact.** The contract row is written only by the store's two methods, called only by the applier. The card
  row is written only by `POST /api/coord/lane-arm`.
- **No new timer.** The applier's serialized queue and the lane's existing 60-second pass do every act.
- **Growth.** Each growth-listed file (`server/test/growthCheck.ts#GROWTH_FILES`: `store.ts`, `schema.ts`, `watch.ts`,
  `shared/api.ts`) grows by at most `GROWTH_LIMIT` (40) net code lines. The stack is measured against `main`, so the plan touches
  each listed file in one PR only, except `schema.ts`, whose two entries together stay under the limit. `shared/api.ts` is not
  touched. `delegation-checkpoint.ts` is frozen and is not touched.
- **Tests.** Characterization first, green on `main` against today's code. Red first for every new behaviour. Every guard ships
  with a test that goes red when the guard is removed, and the red is measured. Fixture HOMEs and fixture directories only.
  Single suites run as `./node_modules/.bin/vitest run test/<file>` from `server/`, in the foreground.
- **Public repo.** Fixtures use neutral names (`lane-a`, `project-a`). No hosts, accounts or projects.
- **Push once per round.**

## The PRs, in merge order

Each PR is safe alone: until the last one, no production path changes what SQLite holds.

### PR-1: the kept-classes rule, pure, and the characterization

- **New file** `server/src/coord/delegation-event-projection.ts` (L1, C5). It holds:
  - `DELEGATION_EVENT_CLASSES` and `delegationEventClassOf`;
  - the kept table `DELEGATION_EVENT_CLASS_KEPT`;
  - the contract and stop types, and `decodeDelegationEventsRow` (raw row to typed row, or why not);
  - `delegationEventHeld`, `delegationEventsWant`, `alignDelegationEvents` and `stopDelegationEvents`;
  - the stop reasons, and `delegationEventsStopOf`, which maps a repair's mismatch to a reason;
  - the sweep constants and `nextDelegationSweepBatch`;
  - `delegationEventsLine`, the daily line;
  - `isDelegationEventProjectionKebab`.
- **Tests:**
  - new `server/test/delegation-event-projection.test.ts`: every class from a fixture envelope; the table is total;
    membership in both modes and across the legacy window; want against the choice and the stop; every contract move; the
    stop; the halving and its floor; the line's exact text; the codec's refusals.
  - new `server/test/delegation-events-characterization.test.ts`, green on `main`: the index's counts, `last` and
    `dropThrough`; the per-pass skip when the counts match; the full repair re-inserting missing rows; step 0's clean-up
    below the first retained sequence; the full replay when the count disagrees; the wipe when SQLite holds rows the journal
    does not. Every case runs against the real store.
  - `server/test/mail-routes.test.ts`: the kebab guard is wired into the scan.
- **Mutation rows:**
  - PR1-M1: `bash-plain` kept, so the table row goes red;
  - PR1-M2: the legacy window's lower bound dropped, so the membership row goes red;
  - PR1-M3: `delegationEventsWant` ignores the stop (spec M7);
  - PR1-M4: no halving (spec M10);
  - PR1-M5: an unknown mode decodes as `thin` (doubt must keep every class).

### PR-2: the contract row and the store's two writers

- **`schema.ts`:** a new migration adds `delegation_events_projection` (one row, `id = 1`, seeded `all`).
- **`store.ts`:**
  - `delegationEventsRow()`: the raw row, `absent` or `unreadable`;
  - `setDelegationEventsRow(row, at)`;
  - `deleteDelegationEventsAt(sequences, sweptBelow, at)`: one transaction, deletes by `journalSequence IN (…)` and writes
    `sweptBelow`, and answers the rows deleted;
  - `coordPageStats()`: `page_count`, `freelist_count` and `page_size`.
- **Tests:** new `server/test/delegation-events-store.test.ts`:
  - the seed row reads `all`;
  - set, then read, round-trips through the L1 codec;
  - `deleteDelegationEventsAt` deletes exactly the named sequences and moves `sweptBelow`;
  - a failing statement rolls back both, measured with a CHECK-violating write in the same transaction;
  - page stats are integers.
  - The schema and migration suites stay green.
- **Mutation rows:** PR2-M1: `sweptBelow` written outside the delete's transaction (spec M3, the rollback row goes red); PR2-M2:
  `delegationEventsRow` folds `unreadable` into `absent`.
- **Safe alone:** nothing calls the new methods.

### PR-3: the applier holds only what the contract keeps

- **`delegation-recovery.ts#DelegationEvidenceIndex`:**
  - it keeps every evidence sequence with its class;
  - `setContract` derives the held list, and the counts the repair reads answer for held sequences only;
  - `legacy(limit)`, `swept(sequences)` and `classCounts()`.
  - `DelegationRecovery` classifies as it accepts.
- **`delegation-db-projection.ts`:**
  - an optional sub-port `events?: DelegationEventsPort` (the row read, set, sequence-list delete and page stats). With it
    absent, the contract is `all` for good, which is today's behaviour, and that is what the test doubles get;
  - `repairDelegationProjection` takes `held` (the membership predicate) and `stopOnMismatch`, and returns `mismatch` before it
    replays from the start or wipes.
- **`delegation-durability.ts#DelegationDurability`:**
  - `recover()` reads the row (an unreadable row warns and keeps every class);
  - `commitLocked` hands only held rows to `projectLocked`;
  - `repairLocked` stops the lane on a mismatch in `thin` mode and repairs under `all`; its report carries `stopped`;
  - new doors `alignEvents(choice)`, `sweepEvents()` (timed batches, halving, at most 20 per call) and
    `noteEventsStopNoticed(at)`, and `eventsStats()` for the line.
- **Tests:** new `server/test/delegation-events-applier.test.ts`, against the real store:
  - armed, a Bash record reaches the journal and not SQLite;
  - the sweep removes the legacy rows and resumes after a restart without a replay;
  - a batch slower than 100 ms halves the next (an injected monotonic clock);
  - Off re-inserts through the repair;
  - an older-build replay stops the lane, with no wipe, and the report says `stopped`;
  - a stop survives a restart;
  - compaction in `thin` mode leaves the counts equal;
  - a port without `events` behaves exactly as `main` (the characterization file stays green).
- **Mutation rows:** spec M1, M2, M4, M5, M6, M7c and M8, each measured red.
- **Safe alone:** the production port in `watch.ts` passes no `events`, so the contract stays `all`.

### PR-4: the lane arms it, live by default

- **`shared/lane-arm.ts`:**
  - `DELEGATION_EVENTS_LANE` (`delegation-events`) joins `LANE_ARM_LANES`;
  - its words: Off keeps every class, Live keeps all but Bash, and it stops itself on a mismatch until you set it Off, then
    Live.
- **`schema.ts`:** a new migration seeds the card row `('delegation-events', 'live', 0)`.
- **New file** `server/src/coord/delegation-events-step.ts` (L4, C5): one pass's acts, taking its reads and acts as arguments:
  1. align to the card row's choice;
  2. after compact, sweep;
  3. when a stop stands with no notice, raise the one notice (`server/src/notice.ts#notify`, feed key
     `delegation-events-stopped:<stoppedAt>`), then mark it;
  4. once a UTC day, the counts line.
- **`watch.ts`:** wires the `events` sub-port in `DelegationLane`'s open and `timedPort`, and calls the step from the pass.
  `server/src/coord/ports.ts#WatcherCoordMember` gains the four store members.
- **Docs:** broker spec §5.2 and §5.12 amended (D-9169), and `store.ts`'s projection header.
- **Tests:**
  - new `server/test/delegation-events-step.test.ts`: the choice moves the contract; the notice is raised once and not after
    a restart; the line comes once a day;
  - `lane-arm-route.test.ts` and the card's words test take the new row;
  - a wiring pin that `watch.ts`'s production port passes `events`;
  - `rings/watcher-store-port.test.ts` stays exact.
- **Mutation rows:** spec M7 and M7b, and PR4-M1: the production port loses `events` (the wiring pin goes red).
- **Live:** from this PR's release, the first lane pass arms the lane, and the sweep runs.

## Deviations found

- **D-9165** — `delegation-events-no-reader`: `delegation_events` has no business reader. Its readers are the projection's own
  count, maximum and duplicate checks; the lane reads all its evidence from the journal (spec §2.2).
- **D-9166** — `delegation-events-swing`: `DELEGATION_COMPACTION_MIN_SHARE` (0.25) makes the 10-day floor hold 10 to 13.3 days
  of evidence, and the table follows; compaction runs and bounds it, and the bound is large (spec §2.4).
- **D-9167** — `delegation-events-contract`: SQLite holds the kept classes, under a one-row contract in `coord.db` written in
  the same transaction as its rows, and one L1 rule drives recovery, the applier, the repair and the sweep (spec §4.2, §4.3).
- **D-9168** — `delegation-events-sequence-delete`: `CoordStore.deleteDelegationEventsAt` deletes a list of sequences beside
  the range delete, because the legacy set is dense and scattered; a gap walk would commit about 125,000 times (spec §4.4).
- **D-9169** — `delegation-events-spec-amend`: broker spec §5.2's `delegation_events` row and §5.12's "follows the journal"
  are amended to the kept classes and the contract row.
- **D-9170** — `delegation-events-live-with-stop`: no shadow phase (the operator's ruling of 2026-11-27). The card row is
  seeded Live and is the Off switch. A mismatch the repair would fix by replay stops the lane, keeps every class, raises one
  durable notice and waits for the operator's tap.
