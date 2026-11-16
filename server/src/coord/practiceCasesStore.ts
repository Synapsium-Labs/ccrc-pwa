// L3 adapter: the case lane's table (Overlord spec §10.5, W1a). `practice_cases` has one writer, `openPracticeCase`, and
// one read, `practiceCaseNewest`; `CoordStore` keeps one-line delegates of the same names. The decisions are
// `practiceCases.ts`'s (`casesDue`) and nothing here: this file only records and measures.
import type { DatabaseSync } from 'node:sqlite';
import { isPositiveDecimalSafeInteger } from '../../../shared/api.js';
import { CASE_MODE, type CaseDue } from './practiceCases.js';

export type PracticeCaseNewestRead = { ok: true; newest: Map<string, number> } | { ok: false; detail: string };
export type PracticeCaseOpen = { opened: true; id: number } | { opened: false; why: 'superseded' };

/** Each signature's newest openedAt, whatever its state: a later build's state word still consumes evidence. The
 *  instants are read as text and proven, all or nothing, so a value this process cannot represent fails the read. */
export function practiceCaseNewest(db: DatabaseSync): PracticeCaseNewestRead {
  try {
    const rows = db.prepare('SELECT signature, CAST(MAX(openedAt) AS TEXT) AS newestText FROM practice_cases GROUP BY signature')
      .all() as { signature: string; newestText: string }[];
    const newest = new Map<string, number>();
    for (const r of rows) {
      const at = Number(r.newestText);
      if (!isPositiveDecimalSafeInteger(at)) return { ok: false, detail: 'practice_cases openedAt is not a positive safe integer' };
      newest.set(r.signature, at);
    }
    return { ok: true, newest };
  } catch (e) {
    return { ok: false, detail: `practice_cases read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The table's one writer. Refuses, writing nothing, when a case for the signature is newer than `seenNewest`: the
 *  compare-and-set is the statement's own `WHERE`, so no read-then-write gap exists. A thrown statement throws. */
export function openPracticeCase(db: DatabaseSync, due: CaseDue, seenNewest: number | null, at: number): PracticeCaseOpen {
  const res = db.prepare(
    'INSERT INTO practice_cases (signature, state, mode, cause, occurrences, programmes, evidence, windowFrom, openedAt) '
    + "SELECT ?, 'open', ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM practice_cases WHERE signature = ? AND openedAt > ?)",
  ).run(due.signature, CASE_MODE, due.cause, due.occurrences, JSON.stringify(due.programmes), JSON.stringify(due.evidence),
    due.windowFrom, at, due.signature, seenNewest ?? -1);
  if (Number(res.changes) === 0) return { opened: false, why: 'superseded' };
  return { opened: true, id: Number(res.lastInsertRowid) };
}
