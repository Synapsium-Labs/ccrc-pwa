// Delegation projection to coord.db (C5). Ring L3 adapter: the projection port and its repair (large-file pilot, D-8641).
/** Moved out of `server/src/coord/delegation-checkpoint.ts` by `.github/ci/file-split.mjs`: a pure move (D-8636). */

import {
  emptyDelegationCheckpoint,
  type DelegationCheckpointV1,
  type DelegationEventRow,
  type DelegationInsertEventsResult,
  type DelegationProjectChangesResult,
  type DelegationJournalRecordV1,
} from './delegation-model.js';
import {
  delegationEventRowOfRecord,
} from './delegation-journal.js';
import { sessionKeyOf, type DelegationEvidenceCounts } from './delegation-checkpoint.js';

// ── The SQLite projection port and its repair (ruling R20) ───────────────────────────────────────────────────────────

/**
 * What the applier needs of `coord.db`, as a port. Every call is the synchronous store; nothing is awaited inside one.
 *
 * The PRODUCTION port is six `CoordStore` methods, one per member (this module may not reach around the store for its handle:
 * the coord ring, pinned by `single-definition.test.ts`, so the store is the only thing that holds it):
 *   - `project(cp)`        is `store.projectDelegationCheckpoint(cp)` (the five non-event tables, one transaction);
 *   - `projectChanged(prior, next)` is `store.projectDelegationCheckpointChanges(prior, next)`: the rows that changed between the two
 *                           checkpoints, written by compare-and-swap in one transaction, or the FULL projection inside the same call
 *                           when the pure diff does not apply (it answers which, as `{ mode: 'delta', rows }` or `{ mode: 'full' }`).
 *                           The applier calls it only while its witness holds (see `projectLocked`); every repair keeps `project`;
 *   - `insertEvents(rows)` is `store.insertDelegationEvents(rows)` (ONE transaction; a conflict is reported, never thrown, and
 *                           does not stop the rows after it);
 *   - `eventStats()`       is `store.delegationEventStats()` (`COUNT(*)` and `MAX(journalSequence)` of `delegation_events`);
 *   - `countEventsAtOrBelow` and `deleteEventsBetween` delegate to the store's indexed retention methods below.
 * The wiring is six one-line adapters, which `delegation-recovery.test.ts` builds and runs against the real store.
 */
export interface DelegationProjectionPort {
  project(checkpoint: DelegationCheckpointV1): void;
  /** The rows of `next` that differ from `prior`, written in one transaction (or the full projection, answered as `mode: 'full'`). A refusal
   *  throws, as `project` does; the applier then marks the projection stale and the next application repairs it in full. REQUIRED, so a
   *  port that forgets it is a compile error rather than a silent fall back to the full write. */
  projectChanged(prior: DelegationCheckpointV1, next: DelegationCheckpointV1): DelegationProjectChangesResult;
  /** ONE transaction for the whole list. A conflict is reported, not thrown, and does not abort the others. */
  insertEvents(rows: readonly DelegationEventRow[]): DelegationInsertEventsResult;
  eventStats(): { count: number; maxSequence: number | null };
  /** D-7021: `delegation_events` rows at or below a journal sequence (`CoordStore.countDelegationEventsAtOrBelow`). Throws on a failed read. */
  countEventsAtOrBelow(sequence: number): number;
  /** D-7021: deletes at most `limit` rows with `afterExclusive < journalSequence <= throughInclusive`, in one statement and one transaction,
   *  and answers how many it deleted (`CoordStore.deleteDelegationEventsBetween`). Throws on failure; that statement is rolled back. */
  deleteEventsBetween(afterExclusive: number, throughInclusive: number, limit: number): number;
}

export interface DelegationProjectionRepairReport {
  /** The highest journalSequence SQLite held when the replay began. */
  resumedAfter: number;
  inserted: number;
  duplicate: number;
  /** Sessions whose SQLite events disagreed with the journal and were deleted and replayed from it. */
  healedSessions: number;
  /** True when SQLite's event count disagreed with the journal's below the resume point, so every event was replayed. */
  fullReplay: boolean;
  /** True when SQLite held events the journal does not (stray rows), or a conflict was still outstanding after the sessions that
   *  held one were healed: every session's events were deleted and replayed. The last resort, and the only repair that costs
   *  O(all events); it is drift, never a normal path. */
  wipedAll: boolean;
  /** How many times the repair read the journal from its start. 0 when SQLite's (count, max) already matched recovery's counts. */
  journalPasses: number;
  /** D-5836: true only for the lane's per-pass repair that found the projection known current and did nothing (no `project()`, no replay;
   *  every count is then 0, and `resumedAfter` is SQLite's max). Every full repair carries false: a reader tells the two apart by this,
   *  never by the zeros. */
  skipped: boolean;
  /** D-7021: the rows step 0 deleted below the journal's first retained sequence (a compaction that died between its journal rename and its
   *  SQLite delete, or whose delete failed): deleted in the gaps between the carried evidence, never a wipe. */
  prunedBelow: number;
}

/** D-5836: a full repair runs at least this often (one hour) even when the per-pass repair finds the projection known current, so
 *  out-of-band damage to the five non-event tables heals within about an hour. Measured on `monotonicMs`, else on `now`. */
export const DELEGATION_REPAIR_FULL_MS = 60 * 60_000;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

/** D-7021: how many `delegation_events` rows one delete statement takes; the loop gets a turn between two. */
export const DELEGATION_EVENTS_DELETE_CHUNK = 5000;

/**
 * D-7021: deletes SQLite's evidence rows at or below `through` in the gaps between the carried evidence sequences (which are kept), in chunks of
 * `chunk` rows with the loop yielded after each. The ONE walk, used by the compaction's `events-delete` and the repair's step 0. Answers how
 * many rows it deleted. A store failure throws; the caller decides what it means.
 */
export async function deleteEventsInGaps(projection: DelegationProjectionPort, through: number, carried: readonly number[], chunk: number): Promise<number> {
  const remove = projection.deleteEventsBetween;
  let deleted = 0;
  let after = 0;
  for (const bound of [...carried.filter((c) => c <= through), through + 1]) {
    if (bound - 1 > after) {
      for (;;) {
        const n = remove.call(projection, after, bound - 1, chunk);
        deleted += n;
        await yieldToEventLoop();
        if (n < chunk) break;
      }
    }
    after = Math.max(after, bound);
  }
  return deleted;
}

/** The checkpoint without some sessions and everything that names them: projecting it deletes those sessions' events (the
 *  projection deletes the events of a LEAVING session), and projecting the whole checkpoint again re-adds the sessions. */
function checkpointWithoutSessions(cp: DelegationCheckpointV1, drifted: readonly { sessionId: string; incarnation: string }[]): DelegationCheckpointV1 {
  const gone = new Set(drifted.map((k) => sessionKeyOf(k.sessionId, k.incarnation)));
  const keep = (r: { parentId: string; parentIncarnation: string }): boolean => !gone.has(sessionKeyOf(r.parentId, r.parentIncarnation));
  const leases = cp.leases.filter(keep);
  const kept = new Set(leases.map((l) => l.leaseId));
  const carriers = (cp.leaseCarriers ?? []).filter((c) => kept.has(c.leaseId));
  const { leaseCarriers: _dropped, ...rest } = cp;
  return {
    ...rest,
    sessions: cp.sessions.filter((s) => !gone.has(sessionKeyOf(s.sessionId, s.parentIncarnation))),
    attempts: cp.attempts.filter(keep), activities: cp.activities.filter(keep), leases, lineage: cp.lineage.filter(keep),
    // A carrier row leaves with its lease (wave 5): one left behind would be a row with no lease, which `assertLeases` refuses.
    ...(carriers.length === 0 ? {} : { leaseCarriers: carriers }),
  };
}

/**
 * Makes SQLite say what the checkpoint and the journal say (ruling R20):
 *   1. project the checkpoint (the five non-event tables);
 *   2. replay the retained journal's evidence through `insertEvents`, in bounded chunks that YIELD THE EVENT LOOP, resuming from
 *      SQLite's `MAX(journalSequence)`; when SQLite's count disagrees with the journal's below that point, replay everything;
 *   3. a conflict is SQLite drift and SQLite loses: delete those sessions' events (by projecting the checkpoint without a session and
 *      then with it, ONE session at a time with the loop yielded between them) and replay their events from the journal, ALL of them
 *      in ONE pass. A conflict still outstanding after that, or
 *      rows SQLite holds that the journal does not, are cleared by deleting every session's events and replaying (the last resort):
 *      the repair never reports success with a conflict outstanding. The cost of deleting is the sessions' events (about 70 to 85 µs
 *      each), paid only on drift.
 * With `evidence` (recovery's per-sequence count) the repair knows BEFORE reading whether the journal has anything to tell SQLite: a
 * matching `(count, max)` and nothing past it skips the read entirely, and a count that disagrees, or a max the journal holds no evidence
 * at (D-5836, review 705 F1), goes straight to the one full pass instead of a counting pass followed by a full one. Without it, the
 * repair counts as it reads (two passes when the counts disagree, or when the counting pass meets no evidence record at SQLite's max).
 * The journal is read as a stream through `journal()`, a fresh async iterable per pass.
 */
export async function repairDelegationProjection(input: {
  projection: DelegationProjectionPort;
  checkpoint: DelegationCheckpointV1;
  journal: () => AsyncIterable<DelegationJournalRecordV1>;
  chunkSize?: number;
  /** Sessions already known to have drifted (an application met a conflicting row): healed whatever the counts say. */
  heal?: readonly { sessionId: string; incarnation: string }[];
  /** Recovery's count of the journal's evidence records, to skip or shorten the passes. */
  evidence?: DelegationEvidenceCounts;
  /** D-7021: the journal's first sequence (null: no journal). Rows below it that are not carried evidence are deleted first (step 0). */
  retainedFrom?: number | null;
  /** D-7021: the rows one step-0 delete statement takes (`DELEGATION_EVENTS_DELETE_CHUNK`). */
  deleteChunk?: number;
}): Promise<DelegationProjectionRepairReport> {
  const { projection, checkpoint } = input;
  const chunkSize = input.chunkSize ?? 500;
  // STEP 0 (D-7021): SQLite's rows below the journal's first retained sequence that are not carried evidence are what a compaction cut and did
  // not get to delete (it died between its journal rename and its delete, or the delete failed). They are deleted in the gaps between the
  // carried evidence, as the compaction would have; today's steps then run unchanged, and the wipe stays the last resort for a real conflict.
  let prunedBelow = 0;
  const retainedFrom = input.retainedFrom ?? null;
  if (retainedFrom !== null && input.evidence !== undefined
    && projection.countEventsAtOrBelow(retainedFrom - 1) !== input.evidence.countAtOrBelow(retainedFrom - 1)) {
    prunedBelow = await deleteEventsInGaps(projection, retainedFrom - 1, input.evidence.sequencesAtOrBelow(retainedFrom - 1), input.deleteChunk ?? DELEGATION_EVENTS_DELETE_CHUNK);
  }
  projection.project(checkpoint);
  const stats = projection.eventStats();
  const resume = stats.maxSequence ?? 0;
  const report: DelegationProjectionRepairReport = {
    resumedAfter: resume, inserted: 0, duplicate: 0, healedSessions: 0, fullReplay: false, wipedAll: false, journalPasses: 0, skipped: false, prunedBelow,
  };
  const conflicted = new Map<string, { sessionId: string; incarnation: string }>();
  for (const k of input.heal ?? []) conflicted.set(sessionKeyOf(k.sessionId, k.incarnation), k);

  /** One pass over the journal. `from`: rows at or below it are only counted. `only`: just these sessions' events. */
  const replay = async (from: number, only: ReadonlySet<string> | null): Promise<{ evidenceBelow: number; total: number; heldAt: boolean }> => {
    report.journalPasses++;
    let chunk: DelegationEventRow[] = [];
    let evidenceBelow = 0;
    let total = 0;
    let heldAt = false;
    const flush = async (): Promise<void> => {
      if (chunk.length === 0) return;
      const r = projection.insertEvents(chunk);
      report.inserted += r.inserted;
      report.duplicate += r.duplicate;
      for (const c of r.conflicts) conflicted.set(sessionKeyOf(c.sessionId, c.parentIncarnation), { sessionId: c.sessionId, incarnation: c.parentIncarnation });
      chunk = [];
      await yieldToEventLoop();
    };
    for await (const record of input.journal()) {
      if (record.entry.kind !== 'evidence-accepted') continue;
      const e = record.entry.event;
      if (only !== null && !only.has(sessionKeyOf(e.sessionId, e.parentIncarnation))) continue;
      total++;
      if (record.sequence <= from) { evidenceBelow++; if (only === null && record.sequence === from) heldAt = true; continue; }
      chunk.push(delegationEventRowOfRecord(record));
      if (chunk.length >= chunkSize) await flush();
    }
    await flush();
    return { evidenceBelow, total, heldAt };
  };

  let total: number;
  const known = input.evidence;
  if (known !== undefined) {
    total = known.total;
    const below = known.countAtOrBelow(resume);
    // sequences are integers that only increase, so equal counts up to `max - 1` and up to `max` mean no evidence AT `max` (D-5836, review 705 F1)
    const foreign = stats.maxSequence !== null && known.countAtOrBelow(stats.maxSequence - 1) === below;
    const behind = below !== stats.count || foreign;
    if (behind) report.fullReplay = true;
    if (behind || total > below) await replay(behind ? 0 : resume, null);
  } else {
    const first = await replay(resume, null);
    total = first.total;
    if (first.evidenceBelow !== stats.count || (stats.maxSequence !== null && !first.heldAt)) {     // the max is a sequence the journal holds no evidence at (D-5836)
      report.fullReplay = true;
      await replay(0, null);
    }
  }

  if (conflicted.size > 0) {
    const drifted = [...conflicted.values()];
    conflicted.clear();
    // Each drifted session leaves for a moment, which deletes its SQLite events on the loop (about 70 to 85 µs each): ONE session at
    // a time, the loop yielded between them, so no stall is longer than one session's events. The journal is then read ONCE for all.
    for (const k of drifted) {
      projection.project(checkpointWithoutSessions(checkpoint, [k]));
      projection.project(checkpoint);
      await yieldToEventLoop();
    }
    report.healedSessions += drifted.length;
    await replay(0, new Set(drifted.map((k) => sessionKeyOf(k.sessionId, k.incarnation))));
  }
  if (conflicted.size > 0 || projection.eventStats().count !== total) {
    report.wipedAll = true;
    conflicted.clear();
    projection.project(emptyDelegationCheckpoint());
    projection.project(checkpoint);
    await yieldToEventLoop();
    await replay(0, null);
    if (conflicted.size > 0) throw new Error('SQLite still conflicts with the journal after every session\'s events were deleted and replayed');
  }
  return report;
}
