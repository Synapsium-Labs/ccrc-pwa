// D-8955: the disk cleanup lanes' recent journal rows, the one read the disk-lane stall alert takes of `lifecycle_events`
// (`diskLaneStall.ts` decides from them). It sits beside `store.ts` in the same ring and context, because it is that
// file's body moved out (`reviewCapStore.ts`'s idiom): the function takes the store's `DatabaseSync` and is synchronous, and
// `CoordStore` keeps a one-line delegate of the same name. Nothing here decides anything: which row is a candidate, a
// wait or a finished act is L1's.
import type { DatabaseSync } from 'node:sqlite';

/** One journal row as the stall decider reads it: ccd's act and outcome words, the subject, ccd's clock and the token. */
export interface LifecycleLaneRow {
  readonly act: string;
  readonly outcome: string;
  readonly sessionId: string;
  readonly at: number;
  readonly refusal: string | null;
}

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(',');

/** THE ONE SPELLING of the statement, public so its test runs EXPLAIN over the text the read runs. `INDEXED BY
 *  lifecycle_by_at` (`recentProvenance`'s idiom and reason: the table is NEVER PRUNED, and the planner prefers a scan
 *  that orders by `id` for free over a seek plus a sort). `at >= ?` also leaves out an undated row, which no window can
 *  place. The newest `limit` rows by the table's own id, so the cost is bounded by the window and the cap. */
export function lifecycleLaneRowsSinceSql(acts: number): string {
  return 'SELECT act, outcome, sessionId, at, refusal FROM lifecycle_events INDEXED BY lifecycle_by_at '
    + `WHERE at >= ? AND act IN (${placeholders(acts)}) AND sessionId IS NOT NULL `
    + 'ORDER BY lifecycle_events.id DESC LIMIT ?';
}

/** The rows of `acts` ccd dated at or after `atMs`, at most `limit` of the newest, returned OLDEST FIRST (by the table's
 *  own id, which is arrival order). An empty `acts` asks nothing. Throws what `node:sqlite` throws: the caller's read
 *  then answers unread, never an empty journal. */
export function lifecycleLaneRowsSince(db: DatabaseSync, atMs: number, acts: readonly string[], limit: number): LifecycleLaneRow[] {
  if (acts.length === 0) return [];
  const rows = db.prepare(lifecycleLaneRowsSinceSql(acts.length)).all(atMs, ...acts, limit) as unknown as
    { act: string; outcome: string; sessionId: string | null; at: number | null; refusal: string | null }[];
  return rows.reverse().flatMap((r) => (r.sessionId === null || r.at === null ? [] // the WHERE excludes both; the row type cannot know it
    : [{ act: r.act, outcome: r.outcome, sessionId: r.sessionId, at: r.at, refusal: r.refusal }]));
}
