// L3 adapter: the start report's table (Overlord spec §3.3.11, H12, W1a). `continuity_starts` has one writer,
// `insertStart`, and one read, `startsSince` (the generations lane's); `CoordStore` keeps one-line delegates of the same
// names. Nothing here decides: the door (`routes.ts`) validates, this file records and measures.
import type { DatabaseSync } from 'node:sqlite';
import { startSourceOf, type StartRow } from '../../../shared/continuity.js';

/** What the door hands the writer: `source` is the payload's word as it came. */
export interface StartInsert {
  sessionId: string;
  reportId: string;
  uuid: string;
  source: string;
  model: string | null;
  /** The registry row's incarnation (`CCRC_SESSION_GENERATION`, a lowercase UUID), or null. */
  rowIncarnation: string | null;
  reportedAt: number;
  receivedAt: number;
}

/** `fresh: false` is a resend that met the unique key: the first report's row stands and its id is answered. */
export type StartInsertResult = { ok: true; id: number; fresh: boolean } | { ok: false; kind: 'write-failed' };
export type StartsRead = { ok: true; rows: StartRow[] } | { ok: false; detail: string };

/** The table's one writer. A resend (the same `sessionId` and `reportId`) writes nothing and answers the stored row's
 *  id with `fresh: false`; a statement that fails answers `write-failed`, never a throw. */
export function insertStart(db: DatabaseSync, row: StartInsert): StartInsertResult {
  try {
    const res = db.prepare(
      'INSERT INTO continuity_starts (sessionId, reportId, uuid, source, model, rowIncarnation, reportedAt, receivedAt) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sessionId, reportId) DO NOTHING',
    ).run(row.sessionId, row.reportId, row.uuid, startSourceOf(row.source), row.model, row.rowIncarnation, row.reportedAt, row.receivedAt);
    if (Number(res.changes) === 1) return { ok: true, id: Number(res.lastInsertRowid), fresh: true };
    const held = db.prepare('SELECT id FROM continuity_starts WHERE sessionId = ? AND reportId = ?')
      .get(row.sessionId, row.reportId) as { id: number } | undefined;
    return held === undefined ? { ok: false, kind: 'write-failed' } : { ok: true, id: held.id, fresh: false };
  } catch {
    return { ok: false, kind: 'write-failed' };
  }
}

/** Every recorded start after `sinceId`, in id order: the generations lane's read. A failed read answers ok: false. */
export function startsSince(db: DatabaseSync, sinceId: number): StartsRead {
  try {
    const rows = db.prepare(
      'SELECT id, sessionId, reportId, uuid, source, model, rowIncarnation, reportedAt, receivedAt FROM continuity_starts WHERE id > ? ORDER BY id',
    ).all(sinceId) as unknown as (Omit<StartRow, 'source'> & { source: string })[];
    // The table has no CHECK, so a word a newer build wrote reads through the same rule as the writer (review 1911, F10).
    return { ok: true, rows: rows.map((r) => ({ ...r, source: startSourceOf(r.source) })) };
  } catch (e) {
    return { ok: false, detail: `continuity_starts read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
