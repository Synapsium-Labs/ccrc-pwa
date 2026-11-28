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
//
// `shape` (Desktop polish wave 198, the new-form alarm; plan docs/superpowers/plans/2026-11-28-box-frames-alarm.md section 4)
// is the frame's shape version and hash with the row's `at`, as JSON, never its tokens (the capture owner's change A, call
// 1963). It is read only when its `at` is the row's, so a part an older build re-records (its upsert does not name the
// column) reads unshaped, never as the old shape. `claudeBuildFrameShapes` is the status read's text-free read, bounded by the
// builds it is given (change B): a second read of the table, legitimately different, because the status read runs every 30
// seconds and the table holds up to 14 MiB of frame text.
import type { DatabaseSync } from 'node:sqlite';
import { compareClaudeVersions, isClaudeVersion } from '../../../shared/claudeVersion.js';
import { DELIVERY_NOT_SENT_MAP, type DeliveryNotSent } from '../../../shared/deliveryResult.js';
import type { FramesRow } from '../../../shared/framesLane.js';
import {
  FRAMES_REFUSAL_MAP, FRAMES_WORD_MAP, readFramesCaptureResult, type FramesCaptureResult, type FramesRefusal,
} from '../../../shared/framesResult.js';
import { isFramesStoredShape, type FramesShapeRow, type FramesStoredShape } from '../../../shared/framesStanding.js';

interface Row {
  build: string; part: number; version: string | null; word: string | null; record: string | null; text: string | null; checked: string | null;
  at: number | null; attempts: number; lastAttemptAt: number | null; notSent: string | null;
}

const COLUMNS = 'build, part, version, word, record, text, checked, at, attempts, lastAttemptAt, notSent';

/** A word of a vocabulary map, by its own property only (the delivery store's rule). */
const ownWord = <T extends string>(map: Record<T, true>, v: string | null): v is T => v !== null && Object.prototype.hasOwnProperty.call(map, v);

function parsedRecord(r: Pick<Row, 'build' | 'part' | 'record'>): FramesCaptureResult | null {
  if (r.record === null) return null;
  try { return readFramesCaptureResult(JSON.parse(r.record), r.build, r.part, true); } catch { return null; }
}

/** What both reads take from a row the same way: the record by the one reader, and its version, word, time and receiver's
 *  word only when they make one whole result with it (the rest null: a part asked again, never an error). */
function wholeOf(r: Pick<Row, 'build' | 'part' | 'version' | 'word' | 'record' | 'checked' | 'at'>):
  { version: string | null; word: FramesRow['word']; record: FramesCaptureResult | null; at: number | null; checked: FramesRow['checked'] } {
  const record = parsedRecord(r);
  const whole = record !== null && r.version === record.version && r.word === record.word && ownWord(FRAMES_WORD_MAP, r.word);
  const checked = r.checked === 'clear' ? 'clear' : ownWord(FRAMES_REFUSAL_MAP, r.checked) ? r.checked as FramesRefusal : null;
  return whole
    ? { version: r.version, word: record.word, record, at: r.at, checked }
    : { version: null, word: null, record: null, at: null, checked: null };
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
    const w = wholeOf(r);
    out.push({
      build: r.build, part: r.part, attempts: r.attempts, lastAttemptAt: r.lastAttemptAt,
      notSent: ownWord(DELIVERY_NOT_SENT_MAP, r.notSent) ? r.notSent as DeliveryNotSent : null,
      ...w, text: w.record !== null && w.checked === 'clear' ? wholeText(w.record, r.text) : null,
    });
  }
  return out.sort((a, b) => compareClaudeVersions(b.build, a.build) || a.part - b.part);
}

/** A stored shape, read whole and bound to the row's `at`, or null: a shape whose JSON does not read, or whose `at` is not
 *  the row's (written for an earlier record of the part), is no shape. */
function shapeOf(text: string | null, at: number | null): FramesStoredShape | null {
  if (text === null || at === null) return null;
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (typeof v !== 'object' || v === null || Array.isArray(v) || (v as { at?: unknown }).at !== at) return null;
  const { at: _at, ...shape } = v as Record<string, unknown>;
  return isFramesStoredShape(shape) ? { version: shape.version, hash: shape.hash } : null;
}

/** THE STATUS READ'S ROWS (wave 198): the rows of `builds` only, never `text`, each read as `claudeBuildFrames` reads it, with
 *  its shape. Newest build first, then by part. No build named, no row. Throws when the table cannot be read: the caller says
 *  so. */
export function claudeBuildFrameShapes(db: DatabaseSync, builds: readonly string[]): FramesShapeRow[] {
  const named = builds.filter(isClaudeVersion);
  if (named.length === 0) return [];
  const rows = db.prepare(`SELECT build, part, version, word, record, checked, at, shape FROM claude_build_frames WHERE build IN (${named.map(() => '?').join(', ')})`)
    .all(...named) as unknown as (Omit<Row, 'text' | 'attempts' | 'lastAttemptAt' | 'notSent'> & { shape: string | null })[];
  return rows.map((r): FramesShapeRow => {
    const w = wholeOf(r);
    return { build: r.build, part: r.part, ...w, shape: w.record === null ? null : shapeOf(r.shape, r.at) };
  }).sort((a, b) => compareClaudeVersions(b.build, a.build) || a.part - b.part);
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
 *  text), the text only when `checked` is `clear`, the receiver's word, the shape (wave 198) bound to the time, and the time
 *  replace an older version's, while the attempts and the retry clock stay. The caller read the result, judged it current,
 *  ran the receiver's check, asked whether to shape it (`framesStanding.ts#framesShapeToStore`) and named the builds to drop
 *  (`framesTextToDrop`); nothing here decides any of that. */
export function recordFrames(
  db: DatabaseSync, r: FramesCaptureResult, checked: 'clear' | FramesRefusal, now: number, drop: readonly string[], shape: FramesStoredShape | null,
): boolean {
  const record = JSON.stringify({ ...r, frame: { ...r.frame, text: null } });
  const text = checked === 'clear' ? r.frame.text : null;
  const stored = shape === null ? null : JSON.stringify({ version: shape.version, hash: shape.hash, at: now });
  db.exec('SAVEPOINT claude_build_frames_record');
  try {
    const n = Number(db.prepare(
      `INSERT INTO claude_build_frames (build, part, version, word, record, text, checked, at, shape) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(build, part) DO UPDATE SET version = excluded.version, word = excluded.word, record = excluded.record, text = excluded.text,
         checked = excluded.checked, at = excluded.at, shape = excluded.shape, notSent = NULL`,
    ).run(r.build, r.part, r.version, r.word, record, text, checked, now, stored).changes);
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
