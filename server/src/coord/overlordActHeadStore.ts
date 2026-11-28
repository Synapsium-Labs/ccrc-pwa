// The act journal's signed heads (Overlord spec §7.6 H27; plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-journal.md`
// Task A3). Ring L3, context C5: the one owner of the SQL of `overlord_act_heads`, one row a day: the day, the journal's head that
// day (sequence, journal id, digest), and either the server key's signature over the head's domain-tagged preimage or the word
// it was recorded unsigned with. It decides nothing: `overlordActHead.ts` (L1) answers whether to sign and whether a pass writes.
//
// A signed head that comes back with a restored `coord.db` still verifies against the key, so the table needs no journal of its
// own. Not pruned in W2. A read that cannot be made answers `unmeasured`, never an empty value.
import type { DatabaseSync } from 'node:sqlite';
import { isActHead, type ActHead, type ActHeadRecorded } from '../../../shared/actJournalHead.js';

/** One day's head, as stored: signed (`signature`) or unsigned (`unsigned`, its word), exactly one of the two. */
export interface ActHeadRow extends ActHead {
  readonly signature: string | null;
  readonly unsigned: string | null;
  readonly at: number;
}
export type ActHeadRead<T> = { readonly kind: 'measured'; readonly value: T } | { readonly kind: 'unmeasured'; readonly why: string };

const COLS = 'day, sequence, journalId, digest, signature, unsigned, at';
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A stored row read back, or `null` for one no writer of it would write (then the read is unmeasured). */
function rowOf(r: Record<string, unknown>): ActHeadRow | null {
  const head = { day: r.day, sequence: r.sequence, journalId: r.journalId, digest: r.digest };
  const sig = r.signature; const uns = r.unsigned; const at = r.at;
  if (!isActHead(head) || (sig === null) === (uns === null) || (sig !== null && typeof sig !== 'string')
    || (uns !== null && typeof uns !== 'string') || typeof at !== 'number') return null;
  return { ...head, signature: sig as string | null, unsigned: uns as string | null, at };
}

function readOne(db: DatabaseSync, sql: string, ...args: (string | number)[]): ActHeadRead<ActHeadRow | 'absent'> {
  try {
    const r = db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
    if (r === undefined) return { kind: 'measured', value: 'absent' };
    const row = rowOf(r);
    return row === null ? { kind: 'unmeasured', why: 'a stored head is out of shape' } : { kind: 'measured', value: row };
  } catch (e) {
    return { kind: 'unmeasured', why: errText(e) };
  }
}

/** A stored row as the head read and the digest carry it: the head, and its signature or unsigned word (no `at`). */
export const actHeadRecordedOf = (r: ActHeadRow): ActHeadRecorded => ({
  day: r.day, sequence: r.sequence, journalId: r.journalId, digest: r.digest, signature: r.signature, unsigned: r.unsigned,
});

/** The head recorded for `day`, or `absent`. */
export function actHeadForDay(db: DatabaseSync, day: string): ActHeadRead<ActHeadRow | 'absent'> {
  return readOne(db, `SELECT ${COLS} FROM overlord_act_heads WHERE day = ?`, day);
}

/** The newest head recorded at or before `day` (the digest's line, the head read), or `absent`. ISO days order as text. */
export function newestActHeadAtOrBefore(db: DatabaseSync, day: string): ActHeadRead<ActHeadRow | 'absent'> {
  return readOne(db, `SELECT ${COLS} FROM overlord_act_heads WHERE day <= ? ORDER BY day DESC LIMIT 1`, day);
}

/** The newest head recorded, or `absent`. */
export function newestActHead(db: DatabaseSync): ActHeadRead<ActHeadRow | 'absent'> {
  return readOne(db, `SELECT ${COLS} FROM overlord_act_heads ORDER BY day DESC LIMIT 1`);
}

/** THE ONE WRITER of `overlord_act_heads`: today's row, once. A row already standing for the day is kept (`ON CONFLICT DO
 *  NOTHING`), and the answer says whether this call wrote. Inside the caller's transaction or alone; it opens none. The CHECK
 *  holds exactly one of the signature and the unsigned word. */
export function recordActHeadInTx(db: DatabaseSync, row: ActHeadRow): { readonly written: boolean } {
  const r = db.prepare(`INSERT INTO overlord_act_heads (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(day) DO NOTHING`)
    .run(row.day, row.sequence, row.journalId, row.digest, row.signature, row.unsigned, row.at);
  return { written: Number(r.changes) === 1 };
}
