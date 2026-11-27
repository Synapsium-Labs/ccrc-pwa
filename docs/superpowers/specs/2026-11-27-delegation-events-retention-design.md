# `delegation_events`: keep only the events something reads (design)

Date: 2026-11-27. Status: **ruled by the operator on 2026-11-27** (§0.1). Plan: `docs/superpowers/plans/2026-11-27-delegation-events-retention.md`,
which defines D-9165 to D-9170.
Read against `origin/main` at `f80f47760`. Context: C5, the delegation lane (broker spec
`docs/superpowers/specs/2026-10-04-delegation-broker-design.md`, wave-4 plan
`docs/superpowers/plans/2026-10-26-delegation-broker-wave4-project.md`, programme ledger
`docs/superpowers/programs/delegation-broker.md`). Deviation numbers: D-9165 (no reader), D-9166 (the swing),
D-9167 (the contract), D-9168 (the sequence-list delete), D-9169 (the broker spec's amendment) and D-9170 (live by default with an
automatic stop, no shadow phase), all issued and defined in the plan.

## 0. Summary

1. The `delegation_events` table is a **copy** of the delegation journal's evidence records. The journal and the
   checkpoint are the authority; the six `delegation_*` tables are repairable output (§2.1).
2. **Nothing reads the table's rows.** Its only readers are the projection's own consistency checks: a count, a maximum
   sequence, and a duplicate check on insert (§2.2).
3. An age bound already exists, and it works. The daily journal compaction keeps 10 days and cuts only when the cut frees
   25% of the journal, so the table holds between 10 and about 13.3 days of evidence, plus the carried records (§2.3).
   At about 140,000 rows a day, that bound is 1.4 to 1.9 million rows, or 2.4 to 3.2 GB. The table is large because the
   bound is large and every row is copied twice.
4. Most rows come from Bash calls. The hook writes a PreToolUse and a PostToolUse record for every Bash call. SQLite has
   no reader for these rows. The lane reads them from the journal, never from the table (§2.4).
5. The design: the table keeps only the event classes that something might read. Bash records stay in the journal and
   leave SQLite. One L1 decider sets the rule, and it covers both what the applier inserts and what the repair counts
   (§4.2).
6. A one-row contract in `coord.db` records which records SQLite holds. It is written in the same transaction as the rows
   it describes, so a crash, a restore or a rollback leaves the two consistent (§4.3).
7. No new timer. The existing applier and the existing 60-second lane pass do the work. The first pass over the existing
   ~1.25 million Bash rows deletes 1,000 rows per transaction and 20,000 per pass, so it takes about an hour (§4.5).
8. The journal, the checkpoint, the carried file, compaction and every carry rule stay unchanged (§4.6).
9. **Live when it ships, with an automatic stop (D-9170).** No shadow phase. A row on the existing Shadow lanes card,
   seeded Live, is the operator's Off switch. If the repair ever finds SQLite disagreeing with the kept-classes rule, the
   lane goes back to keeping every class by itself, records why once (one durable operator notice) and stays that way
   until the operator re-arms it with a tap. A daily counts line gives the measurement that a shadow phase would have
   given (§4.9).
10. Expected result (§5): the table goes from about 2.4 GB to about 0.25 to 0.9 GB, depending on the Bash share, which
    the daily line measures. A backup's coordination set goes from 4.6 GB to about 2.5 to 2.9 GB. The live file keeps
    its size, and its freed pages are reused (D3 (a)).

### 0.1 The operator's rulings of 2026-11-27

| Decision | Ruling |
|---|---|
| D1, what SQLite keeps | (a) Every class except the three Bash classes. |
| D2, how it goes live | No shadow phase: it is live when it ships. The Shadow lanes card row stays only as the operator's Off switch, Live by default. An automatic stop: when the per-pass repair finds SQLite disagreeing with the kept-classes rule (a mismatch it would fix by replay), the lane switches itself back to keeping every class, records why once (one operator notice, durable, so a restart does not repeat it) and does not re-arm by itself; the operator's tap re-arms it. The daily counts line stays (D-9170). |
| The first pass | Its batch cost limits itself: each batch is timed, and the batch is halved when one takes over 100 ms. |
| D3, space | (a) Leave the freed pages for reuse; no `VACUUM`. |
| D4, the journal | Unchanged. No separate design now. |

## 1. The problem, as measured

The operator's read-only measurement on the server box, 2026-11-25:

| Quantity | Value |
|---|---|
| `coord.db` | 3.4 GB, of which about 100k free pages (400 MB) are on the freelist |
| `delegation_events` | about 2.1 GB of rows and 270 MB of indexes: `sqlite_autoindex_delegation_events_1` (the `eventId` UNIQUE) 133 MB, `delegation_events_by_parent` 119 MB, `delegation_events_by_observed` 22 MB, `sqlite_autoindex_delegation_events_2` (the `journalSequence` UNIQUE) 18 MB |
| rows | 1,384,700, `observedAt` from 2026-10-17 to the day of measurement, 110k to 170k rows a day, `payloadJson` about 1 KB on average |
| one backup's coordination set | 4.6 GB (`coord.db`, `delegation-events.log`, `delegation-checkpoint.json`, `delegation-carried.log`, `operator-model.db`, `coordination-snapshot.json`) |
| all backups | 14 GB |
| a server update | about 14 to 16 minutes, most of it spent copying and pruning these files |
| next-largest table | `lifecycle_events`, 181 MB (out of scope) |

The programme ledger measured the same growth on 2026-10-23: `delegation_events` grew 284 MB a day (about 5,720 rows an
hour) and the journal grew 221 MB a day (`docs/superpowers/programs/delegation-broker.md`, the 2026-10-23 entry, "the
soak's disk").

All-in cost per row: (2.1 GB + 0.27 GB) / 1,384,700 ≈ **1.71 KB**. At 140k rows a day, that is about 240 MB a day.

## 2. What `main` does today

### 2.1 The authority and its copy

- **The journal** `~/.ccrc/delegation-events.log` is the record. It is canonical, hash-chained and append-only. Its one
  writer is `DelegationJournalWriter` (`server/src/coord/delegation-journal.ts#DelegationJournalWriter`). Its one reader
  of the retained set is `readDelegationRetainedRecords`, which reads the carried file first, then the journal.
- **The checkpoint** `~/.ccrc/delegation-checkpoint.json` holds the applied state: sessions, attempts, activities, leases,
  lineage, observation intervals, bucket cursors, pruning holds and the applied anchor. **It holds no events.**
- **The carried file** `~/.ccrc/delegation-carried.log` holds the records below the cut that a carry rule still needs
  (K1 to K6, broker spec §5.12, "Retention").
- **`coord.db`'s six `delegation_*` tables** are "REPAIRABLE OUTPUT, NEVER AUTHORITY" (`server/src/coord/schema.ts#MIGRATIONS`,
  entry 22). `delegation_events` is "journal-derived". A lost or damaged events table is repaired by replaying the
  retained journal (`server/src/coord/delegation-db-projection.ts#repairDelegationProjection`), not by projecting the
  checkpoint.

### 2.2 Writers and readers of `delegation_events`

Measured by `grep` over `server/src`, `agent/src`, `ccd`, `shared`, `pwa/src` and `deploy`. The table is named only in
`server/src/coord/{schema,store,delegation-model,delegation-db-projection,delegation-durability,delegation-journal}.ts`.

| Role | Code | Called by | What it needs |
|---|---|---|---|
| **Writer (insert)**, the only one | `server/src/coord/store.ts#writeDelegationEventRow`, through `CoordStore.insertDelegationEvent` and its one-transaction batch `CoordStore.insertDelegationEvents` | the applier's `project` edge (`server/src/coord/delegation-durability.ts#DelegationDurability`, `projectLocked`), once per application; the repair's replay (`repairDelegationProjection`) | the record's row (`server/src/coord/delegation-journal.ts#delegationEventRowOfRecord`; `payloadJson` is the envelope's canonical JSON) |
| **Deleter: a leaving session** | `CoordStore.projectDelegationCheckpoint`, step 3: `DELETE … WHERE sessionId = ? AND parentIncarnation = ?` | a full projection, the repair's per-session heal (`checkpointWithoutSessions`) and its last-resort wipe (`emptyDelegationCheckpoint`) | sessions are never retired (spec §5.12, "Retirement behind the cut"), so in practice this runs only in the heal and the wipe |
| **Deleter: the cut** | `CoordStore.deleteDelegationEventsBetween` (a sequence range with `LIMIT`, one transaction), walked by `server/src/coord/delegation-db-projection.ts#deleteEventsInGaps` in chunks of `DELEGATION_EVENTS_DELETE_CHUNK` (5,000), yielding between chunks | compaction step 9 (`deleteCutEventsLocked` in `DelegationDurability.compactJournal`); the repair's step 0 (rows below the journal's first retained sequence that are not carried evidence) | the cut point and the carried evidence sequences |
| **Reader: count and maximum** | `CoordStore.delegationEventStats` (`COUNT(*)`, `MAX(journalSequence)`) | the per-pass repair check (`repairLocked`: `stats.count === this.evidence.total && stats.maxSequence === this.evidence.last`); the full repair | equality with the in-memory `DelegationEvidenceIndex` (`server/src/coord/delegation-recovery.ts#DelegationEvidenceIndex`) |
| **Reader: count below a cut** | `CoordStore.countDelegationEventsAtOrBelow` | repair step 0 | equality with `DelegationEvidenceIndex.countAtOrBelow` |
| **Reader: duplicate check** | `writeDelegationEventRow`'s read-back by `eventId`; `insertDelegationEvents`'s `SELECT eventId … WHERE journalSequence = ?` | the insert itself | to tell an identical replay (`duplicate`) from a conflict |
| **Not a reader** | `CoordStore.readDelegationProjection` | the drift check | reads the five other tables, never events |
| **Not a reader** | `deploy/coordination-snapshot.mjs`, `deploy/backup-coord.mjs` | backups | copy `coord.db` whole (`VACUUM INTO`); never query the table |

**There is no business reader.** No route, PWA view, correlation rung, fold, agent op or `ccd` verb reads a row of
`delegation_events`. Everything the lane decides from evidence comes from the journal:

- the fold and recovery read the retained set (`server/src/coord/delegation-durability.ts#recoverDelegationFromFiles`,
  `DelegationRecovery`);
- correlation reads the lane's in-memory evidence slice (`server/src/watch.ts#DelegationLane`, `noteEvidence`, capped at
  `DELEGATION_EVIDENCE_CAP` = 20,000), which is rebuilt from the journal at load;
- compaction plans from the retained set (`planCompactionLocked`).

The one exception to "no reader" is a person running SQL against `coord.db` to diagnose something. The journal holds
the same bytes.

### 2.3 What breaks if old rows vanish

- **From SQLite alone, outside the contract:** no decision changes, because nothing reads the rows. The per-pass repair
  does notice: `stats.count` stops equalling `evidence.total`, the next pass runs the full repair, and the repair
  **replays the missing rows from the journal**. If the counts still disagree after that, it **wipes every session's
  events and replays them all**, which costs O(all events) on the event loop (R20: "about 3 s per 100K rows",
  `store.ts`'s projection header). So a separate age sweep in SQL would be undone within one pass, and could set off
  the most expensive repair there is. **Any retention of the table has to change what the index expects. It cannot
  delete rows behind the index's back.**
- **From the journal, outside compaction's rules:** recovery refuses. A cut `lease-created` refuses with `lease-proof`,
  a cut identity-candidate hold refuses with `held-evidence-missing`, and a cut anchor refuses with `anchor-missing`.
  Correlation also loses listing windows, so rung 4 loses its overlap and loss vetoes and could link a tree it should
  not. This is why the carry rules exist. This design does not touch the journal.

### 2.4 The existing bound, and why the table is still large

Compaction exists and is armed (D-7021, D-7022). Once a UTC day, `server/src/watch.ts#DelegationLane` (`compact`) calls
`DelegationDurability.compactJournal(now, DELEGATION_RETENTION_FLOOR_MS)`, where the floor is 10 days
(`server/src/coord/delegation-journal.ts#DELEGATION_RETENTION_FLOOR_MS`, D-7000). The planner
(`server/src/coord/delegation-compaction.ts#DelegationCompactionPlanner`) cuts through S = min(F − 1, applied − 1). It
carries what K1 to K6 need, and it cuts only when `worthwhile`: the net bytes freed must be at least
`DELEGATION_COMPACTION_MIN_SHARE` (0.25) of the journal. `delegation_events` follows: its cut rows are deleted in the gaps
between the carried evidence.

**Why it does not bound the table lower.** With evidence arriving at a steady rate, a cut frees (age − 10) / age of the
journal. That share reaches 25% only when the journal is 13.3 days old. So the journal, and the table with it, swings
between 10 and 13.3 days. The cut usually skips with `below-share`, then cuts about 3.3 days at once. At 140k rows a day,
that is **1.40M to 1.87M rows, or 2.4 to 3.2 GB**, plus the carried rows. The measured 1,384,700 rows sits near the
bottom of that range, which suggests a cut happened shortly before the measurement. The freelist fits the same story: a
cut of about 3 days frees roughly 0.7 GB of pages, and new inserts reuse them.

Rows with `observedAt` as old as 2026-10-17, well past 13.3 days, are what the carry rules keep. K1 keeps the records of
open leases and lineage, K3 the identity records of activities that have not ended, and K5 every record within ±20
minutes of a raw lease, on every repository. The daily line (`delegationCompactionLine`) reports the carried file's
bytes and lines.

**Not verified here.** The live server log is the proof that compaction runs: one `ccrc-server: delegation compaction:`
line a day. The lines read `skipped (below-share …%)` on most days and `cut … records` about every third day. If no such
line appears, or the lines say `not-ready` or `failed`, then compaction is not running, the table is unbounded, and that
is a separate defect to fix first. §11 has the read-only queries that tell the two cases apart.

### 2.5 Which records dominate

The code answers part of this, and the daily counts line (§4.9) measures the rest. In the hook's spool definition (`ccd/session-hook.sh`,
`DSP_DEFS`, its `spool` def), a line is written for:

- `PreToolUse` and `PostToolUse` of **Agent, Task, Workflow and Bash**;
- `SubagentStart` and `SubagentStop` with an agent id;
- `SessionStart` and `SessionEnd`;
- `UserPromptSubmit` only when it carries a task notification.

**Every Bash call writes two records**, whether or not its command names `worktree`. The `worktree` token decides only
whether a listing is taken (`$wt`, `$trig`). Bash is by far the most frequent of those four tools, and subagents' own
Bash calls are spooled too. The ledger measured 90.4% of activities as `bash-worktree` on 2026-10-21, before rule A.
That suggests the Bash share of records is about 90% or more. **The exact split is inferred, not measured.**

What reads the Bash records, and from where:

| Bash record | Fold (`server/src/coord/delegation-checkpoint.ts`, `foldBashCall`) | Rung 4 (`server/src/watch.ts#delegationListingWindowsOf`) | Rung 3 (`noteEvidence`) | SQLite |
|---|---|---|---|---|
| no `listing`, no `truncated` ("plain") | "nothing known on either side": opens nothing | makes no window | one event per (session, incarnation, agent, cwd) tuple, and the tuple's latest time | nothing |
| with `listing` | pending Pre, rule A, D-6267, D-6268 | a listing window: the overlap and loss vetoes | kept | nothing |
| `truncated`, no `listing` ("shed") | — | a **lost** window: a veto | kept | nothing |

All three Bash classes are read from the journal. None is read from SQLite. Stopping the needless write therefore means
**stopping the write into SQLite**, not into the journal. Reducing the journal itself is a different change with a
different hazard (§6, alternative F).

### 2.6 Space, and the backups

- **`auto_vacuum` is never set for `coord.db`.** `server/src/sqliteFile.ts` sets `journal_mode = WAL`,
  `foreign_keys = ON` and `busy_timeout = 5000`, and `server/src/coord/db.ts` sets nothing more, so the mode is SQLite's
  default, NONE. Deleted pages go to the freelist, later inserts reuse them, and the file never shrinks. Only a full
  `VACUUM` gives the space back to the disk. (Not read on the live file: §11, query 3.)
- **Backups are already compact.** `deploy/backup-coord.mjs` snapshots with `VACUUM INTO`, which copies only live pages.
  The 400 MB freelist is not in any backup. **A backup's `coord.db` therefore shrinks as soon as rows are deleted**,
  with no `VACUUM` on the live file.
- The journal is copied verbatim (`deploy/coordination-snapshot.mjs#SNAPSHOT_NAMES`). By subtraction it is about 1.5 GB
  of the 4.6 GB set (not measured). This design does not change it.
- There is a precedent in the tree for incremental space reclaim: the history store is created with
  `auto_vacuum = INCREMENTAL` and returns at most `PRUNE_VACUUM_PAGES` (65,536 pages, 256 MiB) per batch
  (`ccd/history/store.mjs`, `ccd/history/sweep.mjs#PRUNE_VACUUM_PAGES`).

## 3. What must not be lost, and what binds the design

- **The journal and the checkpoint are the delegation authority** (schema entry 22; the journal header in
  `delegation-journal.ts`). This design never writes, truncates or renames either one. Compaction stays their only
  rewriter, besides the torn-tail heal.
- **Broker spec §5.12.** The journal keeps 10 days (D-7000) and never drops an event that an open lease or lineage edge
  references. K1 to K6 carry what is needed. Pruning never passes an event before a durable checkpoint covers it. An
  activity id survives pruning in the checkpoint. **Unchanged.**
- **Broker spec §5.2** lists `delegation_events` as "append-only accepted events", and §5.12 says "`delegation_events`
  follows the journal". **Both are amended** (§10): the table holds the accepted events of the kept classes, and
  it follows the journal for those classes.
- **One writer per fact.** Which evidence rows SQLite holds is one fact. Its one owner is the applier
  (`DelegationDurability`), which acts through the store. The operator's Live or Off choice is a second fact with its
  own owner: the lane-arm door, `POST /api/coord/lane-arm`.
- **`coord.db` rules (CLAUDE.md).** `DatabaseSync` stays synchronous, and no repository or async layer goes over
  `CoordStore`. Migrations refuse rather than open empty. The two migrations here are additive, so an older build
  reads them under rule 3. A lost `coord.db` is re-measured from the files; here that means a full replay of the retained
  journal, which is what happens today.
- **Snapshot and restore rules.** The coordination set (journal, checkpoint, carried file, `coord.db`,
  `operator-model.db`, manifest) is restored as one set. The landing log and the privacy journal are never copied or
  restored. **Unchanged.** The contract row lives inside `coord.db`, so it always travels with the rows it describes.
- **Decide in L1, act in L4.** The class rule, the membership rule, the contract's moves and the sweep plan are pure.
  The store is L3. The lane pass is L4.
- **Wire discipline.** The new lane-arm row and any new health field are additive, absence permits them, and
  `FLEET_PROTO` is not bumped.

## 4. Design

### 4.1 The idea

The table becomes **a projection of the kept classes**, not of all evidence. Everything that keeps the table equal
to the journal, which is the index, the per-pass check, the replay, step 0 and the compaction delete, already turns on
one question: which sequences does SQLite hold? `DelegationEvidenceIndex` is the answer today, and it holds every
evidence sequence. The design changes **only that membership**, through one pure rule, and every existing check
follows. No second retention mechanism appears, and the age bound stays compaction's.

### 4.2 The L1 decider

A new pure module, `server/src/coord/delegation-event-projection.ts` (ring L1, context C5). It imports the envelope type
and nothing with I/O. The class vocabulary is the lane's own, declared once in that module with an exported kebab guard
for `mail-routes.test.ts`'s scan, as `delegation-compaction.ts#DELEGATION_CARRY_REASONS` is. It never goes on the wire.

```ts
export const DELEGATION_EVENT_CLASSES = ['bash-plain', 'bash-listed', 'bash-shed', 'agentic', 'subagent', 'session', 'prompt'] as const;
export function delegationEventClassOf(e: DelegationEventEnvelopeV1): DelegationEventClass;
/** The one table: which classes SQLite keeps while the lane is armed (D1 (a): every class but the three Bash ones). */
export const DELEGATION_EVENT_CLASS_KEPT: Readonly<Record<DelegationEventClass, boolean>>;
export type DelegationEventsContract = { mode: 'all' } | { mode: 'thin'; legacyBelow: number; sweptBelow: number };
export interface DelegationEventsStop { at: number; reason: DelegationEventsStopReason; choiceAt: number | null; noticedAt: number | null }
export interface DelegationEventsRow { contract: DelegationEventsContract; stop: DelegationEventsStop | null }
export function delegationEventHeld(contract: DelegationEventsContract, sequence: number, cls: DelegationEventClass): boolean;
export function delegationEventsWant(choice: { live: boolean; updatedAt: number | null }, stop: DelegationEventsStop | null): 'thin' | 'all';
export function alignDelegationEvents(row: DelegationEventsRow, want: 'thin' | 'all', at: { lastSequence: number | null; firstRetained: number | null }): DelegationEventsRow | null;
export function stopDelegationEvents(row: DelegationEventsRow, reason: DelegationEventsStopReason, at: number, choiceAt: number | null): DelegationEventsRow;
export function nextDelegationSweepBatch(size: number, elapsedMs: number): number;
```

- **Classes**, decided from the envelope as the ingest validates it:
  - `bash-plain`: a Bash Pre or Post with no `listing` and no `truncated`;
  - `bash-listed`: a Bash record with a `listing`;
  - `bash-shed`: a Bash record with `truncated` and no `listing`;
  - `agentic`: an Agent, Task or Workflow Pre or Post;
  - `subagent`: `SubagentStart` or `SubagentStop`;
  - `session`: `SessionStart` or `SessionEnd`;
  - `prompt`: `UserPromptSubmit`.
- **The kept table** (D1 (a)): every class except the three Bash ones. The classes stay separate in the vocabulary so the
  daily line can report each one, and a later ruling can keep, say, `bash-shed` by changing a single row.
- **Membership.** `delegationEventHeld` is true when the mode is `all`, when the class is kept, or when
  `sweptBelow ≤ sequence < legacyBelow` (a legacy row the sweep has not reached yet).
- **What the lane wants** (`delegationEventsWant`): `thin` when the card row reads Live and no stop stands against that
  choice. A stop stands while its `choiceAt` equals the row's `updatedAt`. Every tap on the row
  (`CoordStore.setLaneArm`) writes a new `updatedAt`, so the operator's tap re-arms the lane, and nothing else does. A row
  that is unreadable or absent reads as not live, the card's rule (`server/src/coord/laneArm.ts#laneArmRowViewOf`), so
  doubt keeps every class.
- **Contract moves** (`alignDelegationEvents`; null when nothing changes):
  - From `all` to `thin`: `legacyBelow` = the last evidence sequence plus one, so everything SQLite holds now is legacy,
    and `sweptBelow` = the journal's first retained sequence. A standing stop is cleared on this move.
  - From `thin` to `all`: the Off tap, or a stop.
- **The stop** (`stopDelegationEvents`): mode `all`, with the reason, the time and the choice it stopped under.
  `noticedAt` is null until the notice is raised.
- **The batch** (`nextDelegationSweepBatch`): it starts at `DELEGATION_EVENTS_SWEEP_FIRST_BATCH` (1,000) and halves, down
  to a floor of 1, whenever a batch took more than `DELEGATION_EVENTS_SWEEP_SLOW_MS` (100 ms). It never grows back in that
  process.

### 4.3 The contract row: one durable fact, written with its rows

One additive migration (the next free `MIGRATIONS` slot, re-measured before the PR) adds:

```sql
CREATE TABLE delegation_events_projection (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  mode          TEXT NOT NULL,     -- 'all' | 'thin'; no CHECK, so a newer build's word reads as unknown, which keeps every class
  legacyBelow   INTEGER,           -- thin: rows below it were projected in full
  sweptBelow    INTEGER,           -- thin: excluded rows below it are gone
  stoppedAt     INTEGER,           -- the automatic stop (D-9170), null when none stands
  stopReason    TEXT,
  stopChoiceAt  INTEGER,           -- the card row's updatedAt the stop was made under
  stopNoticedAt INTEGER,           -- when the one notice was raised
  updatedAt     INTEGER NOT NULL
);
INSERT INTO delegation_events_projection (id, mode, updatedAt) VALUES (1, 'all', 0);
```

A later migration, in the PR that turns the lane on, seeds the card row as `('delegation-events', 'live', 0)`.

- **Writers.** Only the store writes the contract row, and only through two methods:
  - `setDelegationEventsRow` writes the whole row: a contract move, a stop, the notice mark;
  - `deleteDelegationEventsAt` deletes a batch of legacy rows and writes `sweptBelow` in the same transaction.
  Both are called only by the applier (`DelegationDurability`).
- **Readers.** The applier reads the row at `recover()`, through the projection port, before it builds the index. The
  row is decoded in L1, never in the store.
- **Why a table and not the checkpoint.** The contract describes SQLite, which is repairable output. If it lived in the
  checkpoint, the authority would carry facts about its own copy, and a restore of `coord.db` alone could leave the two
  disagreeing. Inside `coord.db`, the contract and its rows commit together.
- **The operator's choice is a different fact.** The card row (`lane_arm_settings`, written only by
  `POST /api/coord/lane-arm`) records what the operator wants. The contract row records what SQLite holds and whether
  the lane stopped itself. The applier moves the contract toward the choice on every lane pass.

### 4.4 Who acts: no new timer and no new writer

- **The applier** (`DelegationDurability`, L3, on its serialized queue). Its changes:
  - `recover()` reads the row and sets the index's contract. The index keeps every evidence sequence with one class byte,
    and derives from them the held sequences its counts answer and the legacy sequences the sweep takes.
  - The application path classifies its records and hands `projectLocked` only the held rows.
  - The repair's replay pushes only held records. In `thin` mode, the per-pass repair runs with `stopOnMismatch`
    (§4.6). A mismatch stops the lane, the repair then runs under `all`, and its report carries `stopped`.
  - A door `alignEvents(choice)`, enqueued, moves the contract toward the card row's choice. It writes nothing when the
    two already agree.
  - A door `sweepEvents()`, enqueued like `compactJournal`, so it is serialized with every application, repair and cut.
    It takes at most `DELEGATION_EVENTS_SWEEP_BATCHES_PER_PASS` (20) batches. It times each `deleteDelegationEventsAt`
    on the applier's monotonic clock and sizes the next batch with `nextDelegationSweepBatch`. It removes a batch's
    sequences from the index only after the commit, so the index never runs ahead of SQLite.
  - A door `noteEventsStopNoticed(at)` writes `stopNoticedAt`.
- **The lane** (`DelegationLane`, L4, on its existing 60-second pass, `DELEGATION_SWEEP_MS`). A small step module,
  `server/src/coord/delegation-events-step.ts` (L4), does each pass:
  1. hands the card row's choice to `alignEvents`;
  2. after `compact`, calls `sweepEvents`;
  3. when a stop stands with no `stopNoticedAt`, raises the one notice through the existing funnel
     (`server/src/notice.ts#notify`, with the once-only feed key `delegation-events-stopped:<stoppedAt>`), then marks it;
  4. once a UTC day, under the compaction's day guard, writes the counts line.
  The step takes its reads and acts as arguments, so it decides nothing about the store, and `watch.ts` only wires it.
- **Recorded reason for a second delete statement** (D-9168, CLAUDE.md "legitimately different").
  `deleteDelegationEventsBetween` deletes a contiguous sequence range, and that suits the compaction's sparse carried
  set. The legacy set is the opposite shape: about 90% of the rows, scattered among the kept 10%. Walking it with
  `deleteEventsInGaps` would make one transaction, and one WAL fsync, per gap of about 10 rows, roughly 125,000 commits.
  `deleteDelegationEventsAt` deletes a list of sequences with `journalSequence IN (…)`, through the UNIQUE index, in one
  transaction. Both statements belong to the store, and the applier is the only caller of either.

### 4.5 The one-time first pass over the existing rows

When the lane first arms, the legacy set is every excluded record below `legacyBelow`: about 0.9 × 1.38M ≈ **1.25M rows**,
and up to about 1.7M if the arming lands at the top of the 13.3-day swing.

- **Batch.** It starts at 1,000 rows per transaction, with the loop yielded between transactions, and runs at most 20
  transactions per lane pass. Each batch is timed, and the next one is halved whenever a batch took over 100 ms, so the
  longest stall limits itself on any box.
- **Cost.** At the 70 to 85 µs per deleted row that `repairDelegationProjection`'s header gives for event deletes (not
  measured on this box at this size), a 1,000-row transaction holds the loop for 70 to 85 ms, under the halving bound.
  A pass then spends 1.4 to 1.7 s, spread over 20 turns, inside its 45 s budget (`DELEGATION_PASS_BUDGET_MS`). The whole
  first pass takes 1.25M / 20k ≈ 63 passes, or **about an hour**, and longer if the batch halves. The existing stall
  sampler (`stallMax`, `stallP99` on the slow line) measures the real figure.
- **WAL.** Each transaction touches a few MB of table and index pages. SQLite's default checkpoint threshold (1,000
  pages), which `sqliteFile.ts` does not change, keeps the WAL at a few MB. A `VACUUM INTO` backup during the sweep reads
  one consistent snapshot, as it does today.
- **Crash.** Rows and `sweptBelow` commit in one transaction, and the index follows after the commit. After a restart,
  recovery rebuilds the legacy list from `sweptBelow`, and the sweep resumes. Nothing is replayed.
- **Compaction meanwhile.** Compaction cuts from the bottom: a cut removes legacy sequences from the index, and the
  sweep starts at least at the journal's first retained sequence. They never race, because both run on the applier's
  queue.
- **Doing nothing is also safe.** Compaction would remove every legacy row by itself within 10 to 13.3 days, through
  the existing delete walk. The sweep only brings that forward.

### 4.6 The journal, the checkpoint and compaction stay consistent, and what counts as a mismatch

- The journal, the checkpoint and the carried file are not touched. Compaction's plan, its carry rules, its renames
  and its retirement work exactly as before.
- Compaction's `events-delete` and repair step 0 call `deleteEventsInGaps` with the carried evidence sequences. When a
  carried record is not held, its row is not in SQLite, and the range delete around it removes nothing extra. The
  index's `dropThrough` drops cut sequences from both its lists, so its counts stay right.
- The per-pass check (`stats.count === evidence.total`, `stats.maxSequence === evidence.last`) and the full repair
  compare SQLite with the held set.
- **The mismatch that stops the lane** (D-9170). In `thin` mode, the repair runs with `stopOnMismatch`, and it returns
  before acting in exactly two cases: it would replay from the start (its `behind`: SQLite's count below its own maximum
  differs from the held count), or it would wipe (SQLite holds rows the journal's held set does not). Both say that
  SQLite and the kept-classes rule disagree. The applier then stops the lane (`stopDelegationEvents`, one transaction),
  moves the index to `all`, and runs the repair under `all`, which replays what the rule had excluded.
- **Not a mismatch:** a stale projection's catch-up from SQLite's maximum (an application whose SQLite step failed),
  step 0's clean-up below the journal's first retained sequence (a compaction that died between its rename and its
  delete), and a per-session conflict heal. These are repaired as today, with no stop.

### 4.7 Reclaiming the space

Ruled D3 (a): no `VACUUM`. The freed pages, about 2.1 GB plus the 400 MB already free, stay in the file and are reused by
later inserts into every table. The live file stays at 3.4 GB. Backups shrink at once, because `VACUUM INTO` copies only
live pages (§2.6). A live `VACUUM` stays rejected (§6 G). Switching the file to incremental auto-vacuum is left for a
later decision, with the history store's bounded reclaim (`PRUNE_VACUUM_PAGES`) as its precedent.

### 4.8 What backups then contain

The set is unchanged: `coord.db` (via `VACUUM INTO`, now without the Bash rows), the journal (unchanged), the checkpoint,
the carried file, `operator-model.db` and the manifest. The snapshot helper's validation needs no change, because it
never reads `delegation_events`. A restored `coord.db` carries its contract row, so the restored server rebuilds its
index under the restored contract.

### 4.9 Live by default, the automatic stop, and what the operator sees

- **The switch.** One new row on the existing Shadow lanes card (`shared/lane-arm.ts#LANE_ARM_LANES`,
  `delegation-events`), seeded Live by its migration. It is the operator's Off switch, not a shadow gate: there is no
  shadow phase (D-9170). Live means SQLite keeps only the kept classes. Off means SQLite keeps every class, which is
  what `main` does today. Setting it Live asks for sign-in and the confirm key, as every row does.
- **On the first pass after the release,** the contract moves from `all` to `thin`, new Bash records stop reaching
  SQLite, and the sweep removes the legacy rows over about an hour.
- **The automatic stop.** On a mismatch (§4.6) the lane keeps every class again, by itself. It records the reason and
  the time in the contract row, raises **one** operator notice through the existing funnel (feed row and push, with a
  once-only feed key), and marks the notice in the row, so a restart does not raise it again. If the server dies
  between the notice and the mark, the next pass raises it once more, and the feed key keeps a single feed row. The lane
  does not re-arm by itself. The operator re-arms it with a tap on the card row (Off, then Live), because the stop stands
  only while the row's `updatedAt` is the one it was made under.
- **The daily counts line,** once a UTC day, beside the compaction line and under the same day guard. It is the
  measurement a shadow phase would have given:

  `ccrc-server: delegation events: mode <all|thin>[ stopped <reason> at <iso>]; held <h> of <n> evidence records; by class bash-plain=<a>,bash-listed=<b>,bash-shed=<c>,agentic=<d>,subagent=<e>,session=<f>,prompt=<g>; legacy left <l>; freelist <p> of <q> pages of <s> bytes`

- **Back to Off.** The contract goes to `all`. The next repair replays the excluded records from the journal through the
  existing chunked replay (500 rows per chunk, with yields). That is a few minutes of background work and about 2 GB of
  pages back in use. The card's words say so.
- **Nothing else.** No mail, no attention items. The notice is the one exception, and it is raised once per stop.

### 4.10 Rollback, a lost `coord.db`, and restore

- **Rolling back to a build without this design.** The older build ignores the contract row and the card row. Its repair
  expects every evidence record, so it replays the excluded ones, in chunks with yields, which costs minutes and disk.
  When this build returns, its first repair finds SQLite holding rows the rule excludes, which is a mismatch. It stops
  itself with one notice, and nothing refuses and nothing wipes. The operator's tap re-arms it, and the sweep runs
  again. The broker spec's rollback-floor reasoning (§5.13) is untouched, because the journal format does not change.
- **A lost `coord.db`.** The migrations seed `all` and Live, the repair replays every retained record (today's
  behaviour), and the next pass arms the lane and sweeps.
- **A coordination restore.** The contract row comes back with its rows (§4.8).

## 5. Expected size afterwards

Let s be the Bash share of rows (inferred at about 0.9 or more in §2.5; the daily counts line measures it).

| | Today | After, s = 0.9 | After, s = 0.7 |
|---|---|---|---|
| table rows (bottom of the 10-to-13.3-day swing) | 1.38M | 0.14M | 0.42M |
| table rows (top of the swing) | ~1.87M | ~0.19M | ~0.56M |
| table and indexes, at 1.71 KB per row | 2.37 GB (up to ~3.2 GB at the top) | ~0.24 GB (~0.32 GB) | ~0.71 GB (~0.95 GB) |
| live content of `coord.db` (3.4 − 0.4 freelist) | ~3.0 GB | ~0.87 GB | ~1.34 GB |
| `coord.db` file, no `VACUUM` | 3.4 GB | 3.4 GB (~2.5 GB free inside) | 3.4 GB |
| `coord.db` file, with D3 | — | ~0.9 GB | ~1.4 GB |
| a backup's coordination set | 4.6 GB | ~2.5 GB | ~2.9 GB |
| the three backups that carry a data set | ~14 GB | ~7.5 GB | ~8.8 GB |
| the daily compaction delete | ~460k rows per cut, at 5,000 rows a statement | ~46k | ~140k |

The arithmetic: after = today − s × 2.37 GB, and the set = 4.6 − (3.0 − live content after). An update spends most of
its time copying these files, so its copy phase should shrink in proportion, by about 40 to 45% of the coordination
bytes. That has not been measured. Once SQLite is thin, the journal (about 1.5 GB) is the largest part of the set, and
reducing it is alternative F.

## 6. Alternatives considered and rejected

- **A. An age sweep on the table, independent of the journal.** The per-pass repair undoes it, and in the worst case it
  sets off a full wipe and replay (§2.3). It would also run a second retention mechanism beside compaction, its owner.
- **B. Lowering the 10-day floor.** The floor has to exceed the evidence horizon: 192 hours of interval retention plus
  the 20-minute margin (`DELEGATION_INTERVAL_RETENTION_HOURS`, `DELEGATION_EVIDENCE_MARGIN_MS`; a row in
  `delegation-compaction.test.ts` pins this). It could go down to about 8 days, which saves about 20%, and it would
  relitigate D-7000.
- **C. Lowering `DELEGATION_COMPACTION_MIN_SHARE`** so that cuts happen daily (10 to 11.1 days instead of 10 to 13.3).
  This trims the peak by about 17%, but it costs a copy of the journal's suffix (about 1.5 GB) every day, and it does
  not touch the bulk. It could be revisited once SQLite is thin.
- **D. Thinning the rows, keeping every row with a small `payloadJson` (the digest already binds the record).** This
  saves about 60%, but it keeps the 270 MB of indexes and every row. It also changes the meaning of the duplicate check
  for an older build, which would read a thin row as a conflict and heal it session by session.
- **E. No events in SQLite at all.** This is the strongest form of the chosen design: the same machinery with an empty
  projected table. It is offered as D1(c). It loses ad hoc SQL over joins and session events, which cost little to keep.
- **F. Reducing the journal: not journalling a plain Bash record whose (session, incarnation, agent, cwd) tuple was
  journalled in the last hour.** This would cut the journal, the backups and boot recovery time. But rung 3's
  eviction horizon uses the latest time of each tuple (`noteEvidence`, `tupleLatest`). A coalesced tuple's latest time
  would be up to an hour early, so the horizon would be earlier, which makes a link **less** guarded. That is the unsafe
  direction. It needs its own design and a broker review (decision D4).
- **G. A live `VACUUM`.** It blocks the synchronous loop for minutes, and it needs a second copy's worth of disk (§4.7).
- **H. A new table under a new name, dropping the old one.** That is two tables, a migration that drops data, and a
  rollback that finds its table gone.

## 7. Risks

1. **The Bash share is inferred, and there is no shadow phase to measure it first** (D-9170). If it is well below 90%,
   the gain is smaller, though never negative. The first daily counts line measures it.
2. **A reader outside the tree.** A private tool or an operator's habit could read `delegation_events` by SQL. Nothing in
   this repository does. The journal keeps every byte, and the card row's Off brings the rows back.
3. **A membership bug causes replay storms.** If recovery, the applier and the repair disagree about membership, every
   pass would replay. The automatic stop bounds this: the first such mismatch stops the lane and keeps every class, which
   is `main`'s behaviour. Mitigations before that: one function used at all four sites, a characterization test pinned
   first, and mutation rows that must go red.
4. **A false stop.** A mismatch with another cause (an operator's hand edit of the table, a disk fault) also stops the
   lane. That is the safe direction, and the notice names the reason.
5. **Stalls.** About 80 ms per 1,000-row transaction is an estimate from a figure measured elsewhere. The batch
   halves itself whenever one takes over 100 ms, and the stall sampler reports the real value.
6. **The cost of a rollback.** An older build replays about 1.25M records back into SQLite. That is minutes of
   background work and about 2 GB of pages. When this build returns, it stops itself with one notice, and the operator
   re-arms it with a tap.
7. **The live file does not shrink** (D3 (a)). The freed pages are reused, but the disk does not get them back.
8. **The journal stays large** (D4). About 1.5 GB of every backup set remains.
9. **Compaction might not be running.** If the daily line shows it skipping for a reason other than `below-share`, this
   design helps, but the real defect is elsewhere and has to be fixed first (§2.4).

## 8. Not verified

- The live class split, and the bytes of each class (§11, query 1).
- That compaction runs every day, and its last `cut` line (the server log).
- `PRAGMA auto_vacuum`, `freelist_count`, `page_count` and `page_size` on the live file (§11, query 3).
- The journal's and the carried file's sizes on the server box. The journal's ~1.5 GB is a subtraction.
- The per-row delete cost on the server box at this table size.
- Whether any tool outside this repository reads `delegation_events`.
- That `delegation_events_by_observed` (22 MB) has no reader: no statement in the tree filters or orders on
  `observedAt`. Dropping it is a small, separate change, not part of this design.

## 9. Decisions, as ruled on 2026-11-27

- **D1:** (a) every class except the three Bash classes.
- **D2:** no shadow phase; live when it ships, with the card row as the Off switch and the automatic stop (D-9170).
- **D3:** (a) leave the freed pages for reuse.
- **D4:** the journal stays unchanged, with no separate design now.

## 10. Tests the plan must carry, and amendments to other documents

**Characterization first** (green on `main`): the per-pass check, the full repair, compaction's `events-delete` and
step 0, all against today's behaviour, where membership is "every evidence record".

**Mutation rows** (each must go red when the guard is deleted or mutated):

| Row | Mutation | Must go red |
|---|---|---|
| M1 | `delegationEventHeld` returns true for `bash-plain` in thin mode | the applier inserts a Bash row live |
| M2 | recovery builds the index without the contract (mode `all`) | the per-pass check goes full after a restart in thin mode |
| M3 | the sweep commits rows without `sweptBelow` | a restart after the sweep's first transaction replays rows |
| M4 | the index drops swept sequences before the commit | a failed delete leaves the index ahead of SQLite |
| M5 | the stop is removed | the full repair wipes after a simulated older-build replay, instead of stopping |
| M6 | the sweep's batches per pass are unbounded | a pass runs more than `DELEGATION_EVENTS_SWEEP_BATCHES_PER_PASS` batches |
| M7 | the stop is ignored by `delegationEventsWant` | after a stop the next pass moves the contract back to `thin` with no tap |
| M7b | the stop's notice is raised again after a restart | a second notice for one `stoppedAt` |
| M7c | `stopOnMismatch` is not passed in thin mode | a mismatch replays or wipes under `thin` instead of stopping |
| M10 | the batch never halves | a batch slower than 100 ms leaves the next at the same size |
| M8 | compaction's delete ignores the contract | the counts disagree after a cut in thin mode |
| M9 | a class is added without a kept-table row | a type error or a red row in the `single-definition` area file |

**Amendments.**
- Broker spec §5.2, the `delegation_events` row: "the accepted events of the kept classes
  (`DELEGATION_EVENT_CLASS_KEPT`)".
- Broker spec §5.12, "Retention": "`delegation_events` follows the journal for the kept classes; its contract row
  says which records it holds (D-9169)".
- The projection header in `store.ts` and the new migration's comment: "journal-derived, of the kept classes" (entry 22 is
  frozen, so the new entry says it).

## 11. Measurement queries (read-only, by the operator, on a backup copy of `coord.db`)

1. The class split and its bytes:
   `SELECT eventKind, json_extract(payloadJson,'$.toolName') AS tool, json_type(payloadJson,'$.listing') IS NOT NULL AS listed, coalesce(json_extract(payloadJson,'$.truncated'),0) AS shed, COUNT(*) AS n, SUM(length(payloadJson)) AS bytes FROM delegation_events GROUP BY 1,2,3,4 ORDER BY n DESC;`
2. The age profile, which shows the swing and the carried tail:
   `SELECT date(observedAt/1000,'unixepoch') AS day, COUNT(*) FROM delegation_events GROUP BY day ORDER BY day;`
3. The file: `PRAGMA auto_vacuum; PRAGMA freelist_count; PRAGMA page_count; PRAGMA page_size;`
4. In the server's log: the `ccrc-server: delegation compaction:` lines of the last two weeks.

## Deviation numbers

Issued by the orchestrator and defined in the plan, `docs/superpowers/plans/2026-11-27-delegation-events-retention.md`:
D-9165 (`delegation_events` has no business reader, §2.2), D-9166 (the 25% share rule makes the 10-day floor hold 10 to
13.3 days, §2.4), D-9167 (the table holds the kept classes under a contract row written with its rows, §4.2 and §4.3),
D-9168 (a sequence-list delete beside the range delete, §4.4), D-9169 (the broker spec's §5.2 and §5.12 amended, §10) and
D-9170 (live by default with an automatic stop, no shadow phase, the operator's ruling of 2026-11-27, §4.9).
