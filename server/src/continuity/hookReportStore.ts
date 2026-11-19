// L3 adapter, context C3 (Session Conversation): `continuity_hook_reports`, the session hook's reports (Overlord spec §3.6 H1,
// Table 11.1e; plan `w1-door-process.md` Task 7). ONE WRITER: `insertHookReport` (the report door), which also deletes this
// table's rows past their keep, in the same transaction (witness rows past `WITNESS_KEEP_MS`, every other kind past
// `REPORT_KEEP_MS`, each by the server's `receivedAt`). `picked-up` is never a row: it is a move of the operator's message
// through the private store's one writer. Reads keep "unmeasured" apart from "none": a missing table or a stored value that
// does not narrow answers `ok: false` with its detail, never an empty list. Nothing here decides; the reads are
// the readers' of Task 9 (gates B's witness check) and the card's. The witness key is a call digest, never logged here.
import type { DatabaseSync } from 'node:sqlite';
import {
  REPORT_KEEP_MS, WITNESS_KEEP_MS, isModelSwitchHow, type HookReport, type ModelSwitchHow,
} from '../../../shared/continuity-reports.js';

/** A write's answer: the row's value, or why not. Never a throw. */
export type HookStoreWrite<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: 'write-failed'; readonly detail: string };
/** A read's answer: the value, or the read's failure. An empty list is a measured value; a failure is never one. */
export type HookStoreRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const readFailed = (e: unknown): { ok: false; detail: string } => ({ ok: false, detail: `continuity_hook_reports read failed: ${msg(e)}` });

/** The report's columns: key, agentId, detail. */
function columnsOf(r: HookReport): readonly [string | null, string | null, string | null] | null {
  switch (r.kind) {
    case 'witness': return [r.key, r.agentId, r.tool];
    case 'reader-start': return [r.agentId, null, r.agentType];
    case 'reader-stop': return [r.agentId, null, null];
    case 'readers-clear': return [null, null, null];
    case 'model-switch': return [null, null, JSON.stringify({ how: r.how, from: r.from, to: r.to })];
    case 'picked-up': return null;
  }
}

/** THE TABLE'S ONE WRITER (the report door). Inserts one row (never a `picked-up`) and, in the same transaction, deletes the rows past their keep. */
export function insertHookReport(db: DatabaseSync, sessionId: string, report: HookReport, receivedAt: number): HookStoreWrite<{ id: number }> {
  const cols = columnsOf(report);
  if (cols === null) return { ok: false, error: 'write-failed', detail: 'a picked-up report is a move of the message, never a row' };
  const [key, agentId, detail] = cols;
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("DELETE FROM continuity_hook_reports WHERE receivedAt < CASE kind WHEN 'witness' THEN ? ELSE ? END")
        .run(receivedAt - WITNESS_KEEP_MS, receivedAt - REPORT_KEEP_MS);
      const res = db.prepare('INSERT INTO continuity_hook_reports (sessionId, kind, key, agentId, detail, at, receivedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(sessionId, report.kind, key, agentId, detail, report.at, receivedAt);
      db.exec('COMMIT');
      return { ok: true, value: { id: Number(res.lastInsertRowid) } };
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* the original failure is the answer */ }
      throw e;
    }
  } catch (e) {
    return { ok: false, error: 'write-failed', detail: `continuity_hook_reports write failed: ${msg(e)}` };
  }
}

export interface WitnessRow { readonly id: number; readonly agentId: string | null; readonly at: number; readonly receivedAt: number }
export type ReaderEvent =
  | { readonly id: number; readonly kind: 'reader-start'; readonly agentId: string; readonly agentType: string | null; readonly at: number; readonly receivedAt: number }
  | { readonly id: number; readonly kind: 'reader-stop'; readonly agentId: string; readonly at: number; readonly receivedAt: number }
  | { readonly id: number; readonly kind: 'readers-clear'; readonly at: number; readonly receivedAt: number };
export interface ModelSwitchRow {
  readonly id: number; readonly how: ModelSwitchHow; readonly from: string | null; readonly to: string | null; readonly at: number; readonly receivedAt: number;
}

interface Raw { id: number; kind: string; key: string | null; agentId: string | null; detail: string | null; at: number; receivedAt: number }
const COLS = 'id, kind, key, agentId, detail, at, receivedAt';

/** Every witness row of the session for this key within the keep, newest first. */
export function witnessesFor(db: DatabaseSync, sessionId: string, key: string, now?: number): HookStoreRead<WitnessRow[]> {
  try {
    const floor = now === undefined ? 0 : now - WITNESS_KEEP_MS;
    const rows = db.prepare(`SELECT ${COLS} FROM continuity_hook_reports WHERE sessionId = ? AND kind = 'witness' AND key = ? AND receivedAt >= ? ORDER BY receivedAt DESC, id DESC`)
      .all(sessionId, key, floor) as unknown as Raw[];
    return { ok: true, value: rows.map((r) => ({ id: r.id, agentId: r.agentId, at: r.at, receivedAt: r.receivedAt })) };
  } catch (e) {
    return readFailed(e);
  }
}

/** The session's reader-start, reader-stop and readers-clear rows received at or after `since`, oldest first. A row whose
 *  kind or whose agent id does not narrow makes the whole read unmeasured. */
export function readerEventsSince(db: DatabaseSync, sessionId: string, since: number): HookStoreRead<ReaderEvent[]> {
  try {
    const rows = db.prepare(`SELECT ${COLS} FROM continuity_hook_reports WHERE sessionId = ? AND kind NOT IN ('witness', 'model-switch') AND receivedAt >= ? ORDER BY receivedAt, id`)
      .all(sessionId, since) as unknown as Raw[];
    const out: ReaderEvent[] = [];
    for (const r of rows) {
      const base = { id: r.id, at: r.at, receivedAt: r.receivedAt };
      if (r.kind === 'readers-clear') out.push({ ...base, kind: 'readers-clear' });
      else if (r.kind === 'reader-stop' && r.key !== null) out.push({ ...base, kind: 'reader-stop', agentId: r.key });
      else if (r.kind === 'reader-start' && r.key !== null) out.push({ ...base, kind: 'reader-start', agentId: r.key, agentType: r.detail });
      else return { ok: false, detail: `continuity_hook_reports row ${r.id} (${r.kind}) does not narrow` };
    }
    return { ok: true, value: out };
  } catch (e) {
    return readFailed(e);
  }
}

/** The session's model-switch rows received at or after `since`, oldest first; a detail that does not narrow is unmeasured. */
export function modelSwitchesSince(db: DatabaseSync, sessionId: string, since: number): HookStoreRead<ModelSwitchRow[]> {
  try {
    const rows = db.prepare(`SELECT ${COLS} FROM continuity_hook_reports WHERE sessionId = ? AND kind = 'model-switch' AND receivedAt >= ? ORDER BY receivedAt, id`)
      .all(sessionId, since) as unknown as Raw[];
    const out: ModelSwitchRow[] = [];
    for (const r of rows) {
      let d: unknown;
      try { d = JSON.parse(r.detail ?? ''); } catch { d = null; }
      const o = (typeof d === 'object' && d !== null ? d : {}) as Record<string, unknown>;
      const s = (v: unknown): string | null | undefined => (v === null ? null : typeof v === 'string' ? v : undefined);
      if (!isModelSwitchHow(o['how']) || s(o['from']) === undefined || s(o['to']) === undefined) {
        return { ok: false, detail: `continuity_hook_reports row ${r.id} (model-switch) does not narrow` };
      }
      out.push({ id: r.id, how: o['how'], from: s(o['from'])!, to: s(o['to'])!, at: r.at, receivedAt: r.receivedAt });
    }
    return { ok: true, value: out };
  } catch (e) {
    return readFailed(e);
  }
}
