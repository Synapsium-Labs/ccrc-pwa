# `delegation_events`: keep only the events something reads (design)

Date: 2026-11-27. Status: **draft for the operator**. Nothing is deleted anywhere before the operator approves this design.
Read against `origin/main` at `f80f47760`. Context: C5, the delegation lane (broker spec
`docs/superpowers/specs/2026-10-04-delegation-broker-design.md`, wave-4 plan
`docs/superpowers/plans/2026-10-26-delegation-broker-wave4-project.md`, programme ledger
`docs/superpowers/programs/delegation-broker.md`). Deviation numbers are `D-TBD-delegation-retention-<x>` until the
orchestrator mints them.

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
9. Shadow first: a new row on the existing Shadow lanes card counts what would be removed and removes nothing. Live
   removes the rows, and Shadow is also the off switch (§4.9).
10. Expected result (§5): the table goes from about 2.4 GB to about 0.25 to 0.9 GB, depending on the Bash share, which
    the shadow measures. A backup's coordination set goes from 4.6 GB to about 2.5 to 2.9 GB. The live file shrinks only
    if the operator chooses a one-time VACUUM (decision D3).

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

The code answers part of this, and the shadow measures the rest. In the hook's spool definition (`ccd/session-hook.sh`,
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
  follows the journal". **Both are amended** (§10): the table holds the accepted events of the projected classes, and
  it follows the journal for those classes.
- **One writer per fact.** Which evidence rows SQLite holds is one fact. Its one owner is the applier
  (`DelegationDurability`), which acts through the store. The operator's shadow or live choice is a second fact with its
  own owner: the lane-arm door, `POST /api/coord/lane-arm`.
- **`coord.db` rules (CLAUDE.md).** `DatabaseSync` stays synchronous, and no repository or async layer goes over
  `CoordStore`. Migrations refuse rather than open empty. The one migration here is additive, so an older build reads
  it under rule 3. A lost `coord.db` is re-measured from the files; here that means a full replay of the retained
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

The table becomes **a projection of the projected classes**, not of all evidence. Everything that keeps the table equal
to the journal, which is the index, the per-pass check, the replay, step 0 and the compaction delete, already turns on
one question: which sequences does SQLite hold? `DelegationEvidenceIndex` is the answer today, and it holds every
evidence sequence. The design changes **only that membership**, through one pure rule, and every existing check
follows. No second retention mechanism appears, and the age bound stays compaction's.

### 4.2 The L1 decider

A new pure module, `server/src/coord/delegation-event-projection.ts` (ring L1, context C5). It imports the envelope
type from `shared/api.ts` and nothing with I/O. Its vocabulary is declared once in `shared/api.ts`, beside
`DELEGATION_EVENT_KINDS`, and derived from there.

```ts
// shared/api.ts (L0): the record classes, closed.
export const DELEGATION_EVENT_CLASSES = ['bash-plain', 'bash-listed', 'bash-shed', 'agentic', 'subagent', 'session', 'prompt'] as const;

// delegation-event-projection.ts (L1)
export function delegationEventClassOf(e: DelegationEventEnvelopeV1): DelegationEventClass;
/** The one table: which classes SQLite holds while the row is live. Extending it is a row, never a branch. */
export const DELEGATION_EVENT_CLASS_PROJECTED: Readonly<Record<DelegationEventClass, boolean>>;
export type DelegationEventsContract =
  | { mode: 'all' }
  | { mode: 'thin'; legacyBelow: number; sweptBelow: number; projectedThrough: number | null };
/** Is this evidence record one SQLite must hold under `contract`? Used by recovery, the applier, the repair's replay and the sweep. */
export function delegationEventHeld(contract: DelegationEventsContract, sequence: number, cls: DelegationEventClass): boolean;
/** The contract's next value, given the operator's choice, the first sequence of the application about to project, and what SQLite reports. */
export function nextDelegationEventsContract(input: {...}): DelegationEventsContract;
/** At most `budget` legacy sequences to delete next, ascending, and the `sweptBelow` they reach. */
export function planDelegationEventSweep(contract: DelegationEventsContract, legacy: readonly number[], budget: number): { delete: readonly number[]; sweptBelow: number };
```

- **Classes**, decided from the envelope as the ingest validates it:
  - `bash-plain`: a Bash Pre or Post with no `listing` and no `truncated`;
  - `bash-listed`: a Bash record with a `listing`;
  - `bash-shed`: a Bash record with `truncated` and no `listing`;
  - `agentic`: an Agent, Task or Workflow Pre or Post;
  - `subagent`: `SubagentStart` or `SubagentStop`;
  - `session`: `SessionStart` or `SessionEnd`;
  - `prompt`: `UserPromptSubmit`.
- **The projected table.** The recommendation is to project every class except the three Bash classes (decision D1).
  The rule is simple to state: Bash evidence belongs to the lane, and the lane reads it from the journal. The classes
  stay separate in the vocabulary anyway, so the shadow can report each one, and a later ruling can keep, say,
  `bash-shed` by changing a single row.
- **Membership.** `delegationEventHeld` is true when the mode is `all`, when the class is projected, or when
  `sweptBelow ≤ sequence < legacyBelow` (a legacy row still waiting for the sweep).
- **Contract moves** (`nextDelegationEventsContract`):
  - From `all` to live: `{ thin, legacyBelow: <first sequence of this application>, sweptBelow: <journal's first retained sequence>, projectedThrough }`.
  - From `thin` to shadow: `all`.
  - Thin, with SQLite's `MAX(journalSequence)` above `projectedThrough`: another writer projected after us, which means
    an older build ran (§4.10). The contract **re-baselines** to `legacyBelow = max + 1` and keeps `sweptBelow`. It
    never wipes.
- **The sweep plan.** It takes the lowest legacy sequences at or above `sweptBelow`, up to the budget. Its `sweptBelow`
  is the last one plus one, or `legacyBelow` when none are left.

### 4.3 The contract row: one durable fact, written with its rows

One additive migration (the next free `MIGRATIONS` slot, re-measured before the PR) adds:

```sql
CREATE TABLE delegation_events_projection (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  mode             TEXT NOT NULL CHECK (mode IN ('all', 'thin')),
  legacyBelow      INTEGER,          -- thin: rows below it were projected in full
  sweptBelow       INTEGER,          -- thin: excluded rows below it are gone
  projectedThrough INTEGER,          -- thin: the highest sequence this contract's writer projected
  updatedAt        INTEGER NOT NULL
);
INSERT INTO delegation_events_projection (id, mode, updatedAt) VALUES (1, 'all', 0);
-- plus the Shadow lanes card's seed row for the new lane (shadow), as every lane-arm lane gets one
```

- **Writers.** Only the store writes the contract, and only from three calls, each inside the same transaction as the
  rows that call touches:
  - `insertDelegationEvents` also writes `projectedThrough` and, on a contract move, `mode` and the bounds;
  - the sweep's delete writes `sweptBelow`;
  - the full projection's wipe arm writes `all`.
- **Readers.** The applier reads the contract once at `recover()`, through one new member of the projection port
  (`contract()`), before it builds the index.
- **Why a table and not the checkpoint.** The contract describes SQLite, which is repairable output. If it lived in
  the checkpoint, the authority would carry facts about its own copy, and a restore of `coord.db` alone could leave the
  two disagreeing. Inside `coord.db`, the contract and its rows commit together, so a crash between them is impossible.
- **The operator's choice is a different fact.** The lane-arm row (`lane_arm_settings`, written only by
  `POST /api/coord/lane-arm`) records what the operator wants. The contract records what SQLite holds. The applier
  moves the contract toward the choice at its next application.

### 4.4 Who acts: no new timer and no new writer

- **The applier** (`DelegationDurability`, L3, on its serialized queue). Its changes:
  - `recover()` reads the contract and builds the index from the retained set with `delegationEventHeld`. The index
    keeps one class byte per held sequence (about 1.4 MB at 1.4M records) and the ascending list of legacy sequences.
  - The application path filters `evidenceSequences` and the rows it hands to `projectLocked` through the same rule.
  - The repair's `replay` pushes only held records.
  - A new door, `sweepProjection(budget)`, is enqueued like `compactJournal`, so it is serialized with every
    application, repair and cut. It calls the planner, then `CoordStore.deleteDelegationEventsAt(sequences, sweptBelow)`
    (one transaction), then removes those sequences from the index. It removes them only after the commit, so the
    in-memory index never runs ahead of SQLite.
- **The lane** (`DelegationLane`, L4, on its existing 60-second pass, `DELEGATION_SWEEP_MS`). It reads the lane-arm row
  through the existing reader and passes the choice to the applier. Right after `compact`, it calls `sweepProjection`
  while legacy rows remain. It decides nothing itself.
- **Recorded reason for a second delete statement** (CLAUDE.md, "legitimately different"). `deleteDelegationEventsBetween`
  deletes a contiguous sequence range, and that suits the compaction's sparse carried set. The legacy set is the
  opposite shape: about 90% of the rows, scattered among the kept 10%. Walking it with `deleteEventsInGaps` would make
  one transaction, and one WAL fsync, per gap of about 10 rows, roughly 125,000 commits. `deleteDelegationEventsAt`
  deletes a list of up to 1,000 sequences with `journalSequence IN (…)`, through the UNIQUE index, in one transaction.
  Both statements belong to the store, and the applier is the only caller of either.

### 4.5 The one-time first pass over the existing rows

When the row goes live, the legacy set is every excluded record below `legacyBelow`: about 0.9 × 1.38M ≈ **1.25M rows**,
and up to about 1.7M if the flip happens at the top of the 13.3-day swing.

- **Batch.** 1,000 rows per transaction (`DELEGATION_EVENTS_SWEEP_CHUNK`), with the loop yielded between transactions,
  and at most 20 transactions (20,000 rows) per lane pass (`DELEGATION_EVENTS_SWEEP_PASS_ROWS`).
- **Cost.** At the 70 to 85 µs per deleted row that `repairDelegationProjection`'s header gives for event deletes (not
  measured on this box at this size), one transaction holds the loop for 70 to 85 ms, which is the longest stall. A pass
  spends 1.4 to 1.7 s, spread over 20 turns, inside its 45 s budget (`DELEGATION_PASS_BUDGET_MS`). The whole first pass
  takes 1.25M / 20k ≈ 63 passes, or **about an hour**. The existing stall sampler (`stallMax`, `stallP99` on the slow
  line) measures the real figure.
- **WAL.** Each transaction touches about 1,000 × 1.7 KB of table and index pages, a few MB of WAL frames. SQLite's
  default checkpoint threshold (1,000 pages), which `sqliteFile.ts` does not change, keeps the WAL at a few MB. A
  `VACUUM INTO` backup during the sweep reads one consistent snapshot, as it does today.
- **Crash.** Rows, `sweptBelow` and their removal from the index move together: the first two in one transaction, the
  index after the commit. After a restart, recovery rebuilds the legacy list from `sweptBelow`, and the sweep resumes.
  Nothing is replayed.
- **Compaction meanwhile.** Compaction cuts from the bottom: a cut removes legacy sequences from the index, and the
  sweep treats `sweptBelow` as at least the journal's first retained sequence. They never race, because both run on
  the applier's queue.
- **Doing nothing is also safe.** Compaction would remove every legacy row by itself within 10 to 13.3 days, through
  the existing delete walk. The sweep only brings that forward.

### 4.6 The journal, the checkpoint and compaction stay consistent

- The journal, the checkpoint and the carried file are not touched. Compaction's plan, its carry rules, its renames
  and its retirement work exactly as before.
- Compaction's `events-delete` and repair step 0 call `deleteEventsInGaps` with the carried evidence sequences. When a
  carried record is not held, its row is not in SQLite, and the range delete around it removes nothing extra. The
  index's `dropThrough` keeps only held sequences, so its counts stay right.
- The per-pass check (`stats.count === evidence.total`, `stats.maxSequence === evidence.last`) and the full repair
  compare SQLite with the new membership, which holds fewer rows, and they compare the same way as before.
- The repair's last-resort wipe, if it ever runs, writes the contract `all` in its own transaction and then replays in
  full under that contract. The next application moves the contract back to thin, and the sweep runs again. The wipe
  stays correct, and it stays what it is today: drift handling, not a normal path.

### 4.7 Reclaiming the space

- **Default: no `VACUUM`.** The freed pages, about 2.1 GB plus the 400 MB already free, stay in the file and are reused
  by later inserts into every table. The live file stays at 3.4 GB. Backups shrink at once, because `VACUUM INTO`
  copies only live pages (§2.6).
- **Option (decision D3): one `VACUUM` that also switches the file to incremental auto-vacuum**
  (`PRAGMA auto_vacuum = INCREMENTAL; VACUUM;`).
  - A plain `VACUUM` on the live server would hold the event loop for minutes, because `DatabaseSync` is synchronous.
    It would also need about the live content's size (about 0.9 GB after the sweep) in temporary disk and an exclusive
    lock. So it can run **only while the server is stopped**, as one step of `ccrc update` after its backup, and only
    when the freelist is more than half the file. Where that step sits relative to the unit's stop is not verified.
  - From then on, the lane's daily `compact` call ends with a bounded `PRAGMA incremental_vacuum(N)`, on the history
    store's precedent (`PRUNE_VACUUM_PAGES`).
  - The cost is one longer update and a small permanent pointer-map overhead.
  - The recommendation is not now. The disk had enough room when last measured, the backups (the real cost) shrink
    without it, and the freed pages will be reused.

### 4.8 What backups then contain

The set is unchanged: `coord.db` (via `VACUUM INTO`, now without the Bash rows), the journal (unchanged), the checkpoint,
the carried file, `operator-model.db` and the manifest. The snapshot helper's validation needs no change, because it
never reads `delegation_events`. A restored `coord.db` carries its contract row, so the restored server rebuilds its
index under the restored contract.

### 4.9 Shadow, then live, and what the operator sees

- **The switch.** One new row on the existing Shadow lanes card (`shared/lane-arm.ts#LANE_ARM_LANES`, for example
  `delegation-events-thin`, seeded `shadow` by the migration). This adds a row to an existing table, not a new setting:
  it is the shadow gate the brief asks for, and it is also the off switch (decision D2).
- **Shadow (the default; deletes nothing).** The applier projects every record, as today. It also classifies every
  record at recovery and at each application, and it runs the sweep planner without deleting. Once a day, beside the
  compaction line and under the same day guard, it writes one line:

  `ccrc-server: delegation events: rows <n> by class bash-plain=<a>,bash-listed=<b>,bash-shed=<c>,agentic=<d>,subagent=<e>,session=<f>,prompt=<g>; would keep <k>; would remove <r> (<bytes>); freelist <p> of <q> pages`

  The same counts go to the lane's slow line as size keys (`evClassBashPlain`, …, `evWouldRemove`), and the card's row
  shows "would remove <r> rows (<size>) of Bash evidence that nothing reads; removes nothing".
- **Live.** The next application moves the contract to thin, and new Bash records stop reaching SQLite. The sweep
  removes the legacy rows. The card shows "<n> old rows left to remove", then "done". The daily line reports `kept` and
  `removed`.
- **Back to Shadow.** The contract goes back to `all`. The next repair replays the excluded records from the journal
  through the existing chunked replay (500 rows per chunk, with yields). That is a few minutes of background work and
  about 2 GB of pages back in use. The card warns about this before the tap.
- **Nothing else.** No feed rows, no mail, no pushes, no attention items. The size facts are diagnostics, not work for
  anyone.

### 4.10 Rollback, a lost `coord.db`, and restore

- **Rolling back to a build without this design.** The older build ignores the contract and the lane-arm row. Its
  repair expects every evidence record, so it replays the excluded ones, in chunks with yields, which costs minutes and
  disk. When this build returns, it reads `MAX(journalSequence)` above `projectedThrough`, re-baselines (§4.2), and
  sweeps again. Nothing refuses and nothing wipes. The rollback-floor reasoning in the broker spec (§5.13) is
  untouched, because the journal format does not change.
- **A lost `coord.db`.** The migration seeds `all` and `shadow`, and the repair replays every retained record. That is
  today's behaviour. The operator re-arms the row, as with every lane-arm row.
- **A coordination restore.** The contract comes back with its rows (§4.8).

## 5. Expected size afterwards

Let s be the Bash share of rows (inferred at about 0.9 or more in §2.5; the shadow measures it, and D1's answer moves it).

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

1. **The Bash share is inferred.** If it is well below 90%, the gain is smaller, though never negative. The shadow
   measures it before any deletion.
2. **A reader outside the tree.** A private tool or an operator's habit could read `delegation_events` by SQL. Nothing in
   this repository does. The journal keeps every byte, and the Shadow row brings the rows back.
3. **A membership bug causes replay storms.** If recovery, the applier and the repair disagree about membership, every
   pass would run a full replay. Mitigations: one function used at all four sites; a characterization test pinned
   first; a mutation row that reverses membership must go red; and the shadow phase compares the would-keep count with
   the count the index would hold.
4. **Stalls.** About 80 ms per 1,000-row transaction is an estimate from a figure measured elsewhere. The stall sampler
   measures the real value, and a single constant halves it if needed.
5. **The cost of a rollback.** An older build replays about 1.25M records back into SQLite. That is minutes of
   background work, about 2 GB of pages and a larger backup until this build returns and sweeps again.
6. **The live file does not shrink without D3.** The freed pages are reused, but the disk does not get them back.
7. **The journal stays large.** About 1.5 GB of every backup set remains until alternative F is decided.
8. **Compaction might not be running.** If the daily line shows it skipping for a reason other than `below-share`, this
   design helps, but the real defect is elsewhere and has to be fixed first (§2.4).

## 8. Not verified

- The live class split, and the bytes of each class (§11, query 1).
- That compaction runs every day, and its last `cut` line (the server log).
- `PRAGMA auto_vacuum`, `freelist_count`, `page_count` and `page_size` on the live file (§11, query 3).
- The journal's and the carried file's sizes on the server box. The journal's ~1.5 GB is a subtraction.
- The per-row delete cost on the server box at this table size.
- Whether `ccrc update` has a window with the server stopped and after its backup, where D3's `VACUUM` could run.
- Whether any tool outside this repository reads `delegation_events`.
- That `delegation_events_by_observed` (22 MB) has no reader: no statement in the tree filters or orders on
  `observedAt`. Dropping it is a small, separate change, not part of this design.

## 9. Decisions for the operator

- **D1. What SQLite keeps.**
  - (a) Every class except the three Bash classes. **Recommended.**
  - (b) Every class except `bash-plain`.
  - (c) Nothing, so the journal alone holds the evidence.
- **D2. How it goes live.**
  - (a) A row on the existing Shadow lanes card: shadow at first, live with one tap after the daily line has shown the
    counts, and Shadow is the off switch. **Recommended.**
  - (b) Live in the release after the shadow release, with no card row.
- **D3. Space.**
  - (a) Leave the freed pages for reuse. **Recommended now.**
  - (b) One `VACUUM`, switching the file to incremental auto-vacuum, in an update's stopped-server window, then bounded
    incremental reclaim on the daily compaction.
- **D4. The journal.** Whether to open a separate design for reducing plain Bash records in the journal itself
  (alternative F). It changes rung 3's evidence and needs the broker's review.

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
| M5 | the contract's re-baseline is removed | the full repair wipes after a simulated older-build replay |
| M6 | the sweep's chunk is unbounded | a pass deletes more than `DELEGATION_EVENTS_SWEEP_PASS_ROWS` rows |
| M7 | shadow deletes | any row is removed while the lane-arm row reads `shadow` |
| M8 | compaction's delete ignores the contract | the counts disagree after a cut in thin mode |
| M9 | a class is added without a projected-table row | a type error or a red row in the `single-definition` area file |

**Amendments.**
- Broker spec §5.2, the `delegation_events` row: "the accepted events of the projected classes
  (`DELEGATION_EVENT_CLASS_PROJECTED`)".
- Broker spec §5.12, "Retention": "`delegation_events` follows the journal for the projected classes; its contract row
  says which records it holds".
- The schema entry-22 comment and the projection header in `store.ts`: "journal-derived, of the projected classes".

## 11. Measurement queries (read-only, by the operator, on a backup copy of `coord.db`)

1. The class split and its bytes:
   `SELECT eventKind, json_extract(payloadJson,'$.toolName') AS tool, json_type(payloadJson,'$.listing') IS NOT NULL AS listed, coalesce(json_extract(payloadJson,'$.truncated'),0) AS shed, COUNT(*) AS n, SUM(length(payloadJson)) AS bytes FROM delegation_events GROUP BY 1,2,3,4 ORDER BY n DESC;`
2. The age profile, which shows the swing and the carried tail:
   `SELECT date(observedAt/1000,'unixepoch') AS day, COUNT(*) FROM delegation_events GROUP BY day ORDER BY day;`
3. The file: `PRAGMA auto_vacuum; PRAGMA freelist_count; PRAGMA page_count; PRAGMA page_size;`
4. In the server's log: the `ccrc-server: delegation compaction:` lines of the last two weeks.

## Deviations found

- **D-TBD-delegation-retention-no-reader**: `delegation_events` has no business reader. Its only readers are the
  projection's own consistency checks (§2.2).
- **D-TBD-delegation-retention-swing**: the 25% share rule makes the 10-day floor hold 10 to 13.3 days, and the table
  follows (§2.4).
- **D-TBD-delegation-retention-contract**: the table holds the projected classes, under a contract row in `coord.db`
  written with its rows (§4.2, §4.3).
- **D-TBD-delegation-retention-sweep-delete**: a sequence-list delete beside the range delete, for the reason recorded in
  §4.4.
- **D-TBD-delegation-retention-spec-amend**: broker spec §5.2 and §5.12 amended (§10).
