// The SQL of `claude_build_frames`, the box frames recipe's results (Desktop polish wave 187; plan
// docs/superpowers/plans/2026-11-26-box-frames-recipe.md section 5.3). In `claudeBuildDeliveriesStore.ts`'s idiom: every function
// takes the store's `DatabaseSync` and is synchronous, and `CoordStore` keeps one-line delegates, so its methods are the
// table's only writers, and the capture lane (`buildCaptureLane.ts`) their only caller. What a row means is
// `shared/framesLane.ts`'s. NOTHING HERE TOUCHES `claude_builds` OR `claude_build_deliveries`.
//
// A row's `record` is the stored result with its frame text set to null; `text` holds that text apart, so the newest four
// framed builds keep their texts and an older build's are set aside (`framesTextToDrop` decides which) while its record
// stays. `checked` is the receiver's word at store time (the capture owner's condition 1): `clear`, or the rule word of a
// frame the server refused, whose text is then never stored.
import type { DatabaseSync } from 'node:sqlite';
import { compareClaudeVersions, isClaudeVersion } from '../../../shared/claudeVersion.js';
import { DELIVERY_NOT_SENT_MAP, type DeliveryNotSent } from '../../../shared/deliveryResult.js';
import type { FramesRow } from '../../../shared/framesLane.js';
import {
  FRAMES_REFUSAL_MAP, FRAMES_WORD_MAP, readFramesCaptureResult, type FramesCaptureResult, type FramesRefusal,
} from '../../../shared/framesResult.js';

interface Row {
  build: string; part: number; version: string | null; word: string | null; record: string | null; text: string | null; checked: string | null;
  at: number | null; attempts: number; lastAttemptAt: number | null; notSent: string | null;
}

const COLUMNS = 'build, part, version, word, record, text, checked, at, attempts, lastAttemptAt, notSent';

/** A word of a vocabulary map, by its own property only (the delivery store's rule). */
const ownWord = <T extends string>(map: Record<T, true>, v: string | null): v is T => v !== null && Object.prototype.hasOwnProperty.call(map, v);

function parsedRecord(r: Row): FramesCaptureResult | null {
  if (r.record === null) return null;
  try { return readFramesCaptureResult(JSON.parse(r.record), r.build, r.part, true); } catch { return null; }
}

/** The text read back only when the record and the text make a result the one reader accepts whole. */
function wholeText(record: FramesCaptureResult, text: string | null): string | null {
  if (text === null) return null;
  return readFramesCaptureResult({ ...record, frame: { ...record.frame, text } }, record.build, record.part) === null ? null : text;
}

/** Every row, newest build first, then by part. A row this build cannot read (a build off the grammar) is left out; a record
 *  the reader does not accept now reads with its version, word, record and time null (a part asked again, never an error).
 *  Throws when the table cannot be read: the caller says so. */
export function claudeBuildFrames(db: DatabaseSync): FramesRow[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM claude_build_frames`).all() as unknown as Row[];
  const out: FramesRow[] = [];
  for (const r of rows) {
    if (!isClaudeVersion(r.build)) continue;
    const record = parsedRecord(r);
    const whole = record !== null && r.version === record.version && r.word === record.word && ownWord(FRAMES_WORD_MAP, r.word);
    const checked = r.checked === 'clear' ? 'clear' : ownWord(FRAMES_REFUSAL_MAP, r.checked) ? r.checked as FramesRefusal : null;
    out.push({
      build: r.build, part: r.part, attempts: r.attempts, lastAttemptAt: r.lastAttemptAt,
      notSent: ownWord(DELIVERY_NOT_SENT_MAP, r.notSent) ? r.notSent as DeliveryNotSent : null,
      version: whole ? r.version : null, word: whole ? record.word : null, record: whole ? record : null, at: whole ? r.at : null,
      text: whole && checked === 'clear' ? wholeText(record, r.text) : null, checked: whole ? checked : null,
    });
  }
  return out.sort((a, b) => compareClaudeVersions(b.build, a.build) || a.part - b.part);
}

/** The lane tried one part at `now`: the retry clock is stamped either way; a job that went out is one more attempt and
 *  clears the why; a try that sent nothing counts none and records why. */
export function markFramesAttempt(db: DatabaseSync, build: string, part: number, now: number, tried: 'sent' | DeliveryNotSent): boolean {
  const sent = tried === 'sent';
  return Number(db.prepare(
    `INSERT INTO claude_build_frames (build, part, attempts, lastAttemptAt, notSent) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(build, part) DO UPDATE SET attempts = attempts + excluded.attempts, lastAttemptAt = excluded.lastAttemptAt, notSent = excluded.notSent`,
  ).run(build, part, sent ? 1 : 0, now, sent ? null : tried).changes) === 1;
}

/** One part's result, an upsert, and the texts of `drop` set aside, in ONE savepoint: the record (the result less its frame
 *  text), the text only when `checked` is `clear`, the receiver's word, and the time replace an older version's, while the
 *  attempts and the retry clock stay. The caller read the result, judged it current, ran the receiver's check and named the
 *  builds to drop (`framesTextToDrop`); nothing here decides any of that. */
export function recordFrames(db: DatabaseSync, r: FramesCaptureResult, checked: 'clear' | FramesRefusal, now: number, drop: readonly string[]): boolean {
  const record = JSON.stringify({ ...r, frame: { ...r.frame, text: null } });
  const text = checked === 'clear' ? r.frame.text : null;
  db.exec('SAVEPOINT claude_build_frames_record');
  try {
    const n = Number(db.prepare(
      `INSERT INTO claude_build_frames (build, part, version, word, record, text, checked, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(build, part) DO UPDATE SET version = excluded.version, word = excluded.word, record = excluded.record, text = excluded.text,
         checked = excluded.checked, at = excluded.at, notSent = NULL`,
    ).run(r.build, r.part, r.version, r.word, record, text, checked, now).changes);
    const setAside = db.prepare('UPDATE claude_build_frames SET text = NULL WHERE build = ?');
    for (const b of drop) setAside.run(b);
    db.exec('RELEASE claude_build_frames_record');
    return n === 1;
  } catch (e) {
    db.exec('ROLLBACK TO claude_build_frames_record');
    db.exec('RELEASE claude_build_frames_record');
    throw e;
  }
}
