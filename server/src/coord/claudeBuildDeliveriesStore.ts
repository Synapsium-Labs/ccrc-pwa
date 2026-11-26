// The SQL of `claude_build_deliveries` (migration 130), the paste delivery recipe's results (Desktop polish wave 178; task note
// docs/superpowers/programs/desktop-polish/paste-delivery.md section 7). In `claudeBuildsStore.ts`'s idiom: every function takes
// the store's `DatabaseSync` and is synchronous, and `CoordStore` keeps one-line delegates, so its methods are the table's
// only writers, and the capture lane (`buildCaptureLane.ts`) their only caller. What a row means is `shared/deliveryLane.ts`'s.
// NOTHING HERE TOUCHES `claude_builds`: a delivery result is never a trust verdict.
import type { DatabaseSync } from 'node:sqlite';
import { compareClaudeVersions, isClaudeVersion } from '../../../shared/claudeVersion.js';
import type { DeliveryRow } from '../../../shared/deliveryLane.js';
import { DELIVERY_NOT_SENT_MAP, DELIVERY_WORD_MAP, readDeliveryCaptureResult, type DeliveryCaptureResult, type DeliveryNotSent } from '../../../shared/deliveryResult.js';

interface Row {
  build: string; part: number; version: string | null; release: string | null; word: string | null; result: string | null; at: number | null;
  attempts: number; lastAttemptAt: number | null; notSent: string | null;
}

const COLUMNS = 'build, part, version, release, word, result, at, attempts, lastAttemptAt, notSent';

/** A word of a vocabulary map, by its own property only: a stored `toString` or `constructor` is no word (review 3882 A8). */
const ownWord = <T extends string>(map: Record<T, true>, v: string | null): v is T => v !== null && Object.prototype.hasOwnProperty.call(map, v);

function parsed(r: Row): DeliveryCaptureResult | null {
  if (r.result === null) return null;
  try { return readDeliveryCaptureResult(JSON.parse(r.result), r.build, r.part); } catch { return null; }
}

/** Every row, newest build first, then by part. A row the table's CHECKs let through but this build cannot read (a build off
 *  the grammar) is left out. A row whose stored result is not one the reader accepts now (a vocabulary this build does not
 *  know) reads with its version, word, result and time null: a part with no current result, asked again, never an error.
 *  Throws when the table cannot be read: the caller says so. */
export function claudeBuildDeliveries(db: DatabaseSync): DeliveryRow[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM claude_build_deliveries`).all() as unknown as Row[];
  const out: DeliveryRow[] = [];
  for (const r of rows) {
    if (!isClaudeVersion(r.build)) continue;
    const result = parsed(r);
    // Read whole or not at all: the version, word and release columns must each be the stored result's own.
    const whole = result !== null && r.version === result.version && r.word === result.word && ownWord(DELIVERY_WORD_MAP, r.word) && r.release === result.release;
    const notSent = ownWord(DELIVERY_NOT_SENT_MAP, r.notSent) ? r.notSent as DeliveryNotSent : null;
    out.push({
      build: r.build, part: r.part, attempts: r.attempts, lastAttemptAt: r.lastAttemptAt, notSent,
      version: whole ? r.version : null, release: whole ? result.release : null, word: whole ? result.word : null, result: whole ? result : null, at: whole ? r.at : null,
    });
  }
  return out.sort((a, b) => compareClaudeVersions(b.build, a.build) || a.part - b.part);
}

/** The lane tried one part at `now`: the retry clock is stamped either way. A job that went out (`sent`) is one more attempt
 *  and clears the why; a try that sent nothing counts no attempt and records why. A row is made for a part with none. A
 *  recorded result is left as it is. */
export function markDeliveryAttempt(db: DatabaseSync, build: string, part: number, now: number, tried: 'sent' | DeliveryNotSent): boolean {
  const sent = tried === 'sent';
  return Number(db.prepare(
    `INSERT INTO claude_build_deliveries (build, part, attempts, lastAttemptAt, notSent) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(build, part) DO UPDATE SET attempts = attempts + excluded.attempts, lastAttemptAt = excluded.lastAttemptAt, notSent = excluded.notSent`,
  ).run(build, part, sent ? 1 : 0, now, sent ? null : tried).changes) === 1;
}

/** One part's current result, an upsert: the version, the box's release, word, result and time replace an older version's, and the attempts
 *  and the retry clock stay. The caller has read the result (`readDeliveryCaptureResult`) and judged it current
 *  (`deliveryResultCurrency`); nothing here decides that. */
export function recordDelivery(db: DatabaseSync, r: DeliveryCaptureResult, now: number): boolean {
  return Number(db.prepare(
    `INSERT INTO claude_build_deliveries (build, part, version, release, word, result, at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(build, part) DO UPDATE SET version = excluded.version, release = excluded.release, word = excluded.word, result = excluded.result, at = excluded.at, notSent = NULL`,
  ).run(r.build, r.part, r.version, r.release, r.word, JSON.stringify(r), now).changes) === 1;
}
