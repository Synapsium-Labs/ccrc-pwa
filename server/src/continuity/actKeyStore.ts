// L3 adapter, context C3 (Session Conversation): `continuity_act_keys`, the door process's act key (Overlord spec §3.3.11 H12
// "The fence", Table 11.1a's row `continuity_generations`, "the act key, bound at the mint"; plan `w1-door-process.md` Task 1).
// One row per generation, ever. THREE FACTS, THREE WRITERS, ONE ROW: `issueActKey` (the claim door) writes the row,
// `noteRefusedClaim` (the claim door) raises `claimsRefused`, and `advanceActCounter` raises the counter, reached only through
// gates B's guarded adapter. The key itself is never stored: the row keeps its sha256. Reads keep "unmeasured" apart from
// "none": a failed read answers `ok: false` with its detail, never an empty answer. Nothing here decides.
import type { DatabaseSync } from 'node:sqlite';
import type { ClaimRead } from './actKey.js';

/** What the claim door hands the writer: the generation, the presented nonce's sha256 and the minted key's sha256. */
export interface ActKeyIssue {
  readonly generationId: number;
  readonly nonceSha256: string;
  readonly keySha256: string;
  readonly issuedAt: number;
}

/** One row, as read. */
export interface ActKeyRow {
  readonly generationId: number;
  readonly nonceSha256: string;
  readonly keySha256: string;
  readonly issuedAt: number;
  readonly counter: number;
  readonly claimsRefused: number;
  readonly lastRefusedAt: number | null;
}

/** `refused`: a row already holds this generation or this nonce (two claims raced), so no key is issued. `write-failed`: the
 *  statement failed. Never a throw. */
export type ActKeyIssueResult = { ok: true } | { ok: false; error: 'refused' | 'write-failed' };

const COLS = 'generationId, nonceSha256, keySha256, issuedAt, counter, claimsRefused, lastRefusedAt';
const failed = (e: unknown): { ok: false; detail: string } =>
  ({ ok: false, detail: `continuity_act_keys read failed: ${e instanceof Error ? e.message : String(e)}` });

/** THE ROW'S ONE WRITER (the claim door). Inserts once: a second insert for the same generation or the same nonce meets a
 *  unique key and answers `refused`. */
export function issueActKey(db: DatabaseSync, row: ActKeyIssue): ActKeyIssueResult {
  try {
    const res = db.prepare(
      'INSERT INTO continuity_act_keys (generationId, nonceSha256, keySha256, issuedAt) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    ).run(row.generationId, row.nonceSha256, row.keySha256, row.issuedAt);
    return Number(res.changes) === 1 ? { ok: true } : { ok: false, error: 'refused' };
  } catch {
    return { ok: false, error: 'write-failed' };
  }
}

/** `claimsRefused`'s ONE WRITER (the claim door): a spent nonce presented again. Changes the row holding the hash only when
 *  its generation is the claiming session's own (review 2636 F2), so no session raises another's count. */
export function noteRefusedClaim(db: DatabaseSync, nonceSha256: string, sessionId: string, at: number): { changed: boolean } {
  try {
    const res = db.prepare('UPDATE continuity_act_keys SET claimsRefused = claimsRefused + 1, lastRefusedAt = ? WHERE nonceSha256 = ? '
      + 'AND generationId IN (SELECT id FROM continuity_generations WHERE sessionId = ?)').run(at, nonceSha256, sessionId);
    return { changed: Number(res.changes) === 1 };
  } catch {
    return { changed: false };
  }
}

/** THE COUNTER'S ONE WRITER, reached only through gates B's `advanceCounterGuarded` (ruled, F7), which wraps it in one
 *  transaction with the generation's `state <> 'ended'` check. Changes the row only when `counter` is above the stored one:
 *  a gap (a counter the server never consumed) is accepted, a value at or below the stored one is not. */
export function advanceActCounter(db: DatabaseSync, generationId: number, counter: number): { changed: boolean } {
  const res = db.prepare('UPDATE continuity_act_keys SET counter = ? WHERE generationId = ? AND counter < ?')
    .run(counter, generationId, counter);
  return { changed: Number(res.changes) === 1 };
}

/** The generation's row, `'none'` when no key was issued for it, or the read's failure. */
export function actKeyOf(db: DatabaseSync, generationId: number): ClaimRead<ActKeyRow | 'none'> {
  try {
    const r = db.prepare(`SELECT ${COLS} FROM continuity_act_keys WHERE generationId = ?`).get(generationId) as ActKeyRow | undefined;
    return { ok: true, value: r === undefined ? 'none' : { ...r } };
  } catch (e) {
    return failed(e);
  }
}

/** The row already holding this nonce's hash (a spent nonce), `'none'`, or the read's failure. */
export function actKeyByNonce(db: DatabaseSync, nonceSha256: string): ClaimRead<{ generationId: number } | 'none'> {
  try {
    const r = db.prepare('SELECT generationId FROM continuity_act_keys WHERE nonceSha256 = ?').get(nonceSha256) as
      { generationId: number } | undefined;
    return { ok: true, value: r === undefined ? 'none' : { generationId: r.generationId } };
  } catch (e) {
    return failed(e);
  }
}
