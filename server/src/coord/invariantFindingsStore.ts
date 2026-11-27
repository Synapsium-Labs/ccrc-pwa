// The invariant monitor's record of what it found (Overlord spec §10.4 "One findings table, one row per episode", §12 M24; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Task 6, question 12, slug `monitor-keeps-its-findings`).
// Ring L3, context C5: `overlord_invariant_findings`' SQL, in `ledgersStore.ts`' idiom (it names the handle by `import type`, and
// every function takes it as an argument).
//
// TWO WRITERS, ONE MODULE: `recordFinding` inserts a row, and `resolveFindings` stamps `resolvedAt`. At most one open row stands
// per invariant, subject and mode (the partial unique index), so a second open row of one key is refused by SQLite and writes
// nothing, its item included. Rows are never deleted in W1: the row is the deduplication and M24's count.
//
// A LIVE FINDING'S ITEM COMMITS WITH ITS ROW. `recordFinding` raises the item through the ledger's checked in-transaction raise
// (`raiseItemCheckedInTx`: programme `OVERLORD_ITEM_PROGRAMME`, raised by `ccrc`, kind `do`, needed `blocking`) and inserts the
// row with its id, in one `tx()`; a refused raise or a refused row writes neither. The latch is the caller's, raised before
// (`invariantLane.ts`): its answer is recorded here as `latched`.
import type { DatabaseSync } from 'node:sqlite';
import { tx } from './tx.js';
import { raiseItemCheckedInTx, type RaiseItemInput } from './ledgersStore.js';
import { reachInTx, type BoundOf } from './pushOutboxStore.js';
import type { SequenceRead } from './overlordSequenceStore.js';
import type { Finding, FindingLatched } from './invariants.js';
import { OVERLORD_ITEM_PROGRAMME } from '../../../shared/overlord-sequence.js';

export type FindingMode = 'shadow' | 'live';
export type { FindingLatched };
export interface OpenFindingRow { readonly id: number; readonly invariant: string; readonly subject: string }
/** One findings row as the operator's read serves it (`findingRows`): ids, words, times and the message, which names ids only. */
export interface FindingRow {
  readonly id: number; readonly invariant: string; readonly subject: string; readonly mode: string; readonly seq: number | null;
  readonly message: string; readonly foundAt: number; readonly resolvedAt: number | null; readonly latched: string | null;
  readonly itemId: number | null;
}
export interface FindingTally { readonly total: number; readonly open: number; readonly byInvariant: Readonly<Record<string, number>> }

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The item a live finding raises: its words name the invariant, the subject and the message, ids and states only (§10.4). */
export function invariantItemOf(f: Finding): RaiseItemInput {
  return {
    program: OVERLORD_ITEM_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'do',
    title: `Invariant ${f.invariant} violated: ${f.subject}`,
    why: `The invariant monitor measured ${f.invariant} violated for ${f.subject}: ${f.message}. The ladder's invariant-violation latch caps the Overlord at advise until you clear it.`,
    how: ['Read the finding and what it names.', 'Repair the cause, then clear the invariant-violation latch on the ladder.'],
    options: null, neededBy: 'blocking', soonLabel: null, secretSlot: null,
  };
}

/** In one `tx()`: for a live finding, the item (and its reach, when the caller passes one), then the row with the item's id and
 *  the latch answer; for a shadow finding, the row alone. A refused raise or row writes nothing. `item` is a test seam over the
 *  item's input (a level outside the vocabulary must be refused). Never throws. */
export function recordFinding(
  db: DatabaseSync, f: Finding, mode: FindingMode, live: { readonly latched: FindingLatched; readonly reach?: BoundOf } | null, at: number,
  item: (f: Finding) => RaiseItemInput = invariantItemOf,
): { ok: true; id: number; itemId: number | null } | { ok: false; error: string } {
  if ((mode === 'live') !== (live !== null)) return { ok: false, error: 'a live finding carries its latch answer, a shadow one none' };
  try {
    return tx(db, () => {
      const itemId = live === null ? null
        : raiseItemCheckedInTx(db, item(f), at, 'ccrc', live.reach && ((id) => { reachInTx(db, 'item', id, live.reach!(id), at); }));
      const res = db.prepare('INSERT INTO overlord_invariant_findings (invariant, subject, mode, seq, message, foundAt, itemId, latched) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(f.invariant, f.subject, mode, f.seq, f.message, at, itemId, live?.latched ?? null);
      return { ok: true as const, id: Number(res.lastInsertRowid), itemId };
    });
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/** In one `tx()`: stamps `resolvedAt` on each named row that is still open. Never throws. */
export function resolveFindings(db: DatabaseSync, ids: readonly number[], at: number): { resolved: number } | { error: string } {
  if (ids.length === 0) return { resolved: 0 };
  try {
    return tx(db, () => {
      const r = db.prepare('UPDATE overlord_invariant_findings SET resolvedAt = ? WHERE resolvedAt IS NULL AND id IN (SELECT value FROM json_each(?))')
        .run(at, JSON.stringify(ids));
      return { resolved: Number(r.changes) };
    });
  } catch (e) {
    return { error: errText(e) };
  }
}

/** The open rows of one mode. */
export function openFindings(db: DatabaseSync, mode: FindingMode): SequenceRead<readonly OpenFindingRow[]> {
  try {
    const rows = db.prepare('SELECT id, invariant, subject FROM overlord_invariant_findings WHERE mode = ? AND resolvedAt IS NULL ORDER BY id')
      .all(mode) as { id: number; invariant: string; subject: string }[];
    return { kind: 'measured', value: rows.map((r) => ({ id: Number(r.id), invariant: String(r.invariant), subject: String(r.subject) })) };
  } catch (e) {
    return { kind: 'unmeasured', why: errText(e) };
  }
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The open or the resolved rows of both modes, newest first, at most `limit` (the operator's invariants read asks one more than
 *  it serves, to tell a cut). */
export function findingRows(db: DatabaseSync, which: 'open' | 'resolved', limit: number): SequenceRead<readonly FindingRow[]> {
  try {
    const rows = db.prepare('SELECT id, invariant, subject, mode, seq, message, foundAt, resolvedAt, latched, itemId FROM overlord_invariant_findings '
      + `WHERE resolvedAt IS ${which === 'open' ? '' : 'NOT '}NULL ORDER BY id DESC LIMIT ?`).all(Math.max(0, Math.trunc(limit))) as Record<string, unknown>[];
    return {
      kind: 'measured', value: rows.map((r) => ({
        id: Number(r['id']), invariant: String(r['invariant']), subject: String(r['subject']), mode: String(r['mode']), seq: numOrNull(r['seq']),
        message: String(r['message']), foundAt: Number(r['foundAt']), resolvedAt: numOrNull(r['resolvedAt']),
        latched: r['latched'] === null || r['latched'] === undefined ? null : String(r['latched']), itemId: numOrNull(r['itemId']),
      })),
    };
  } catch (e) {
    return { kind: 'unmeasured', why: errText(e) };
  }
}

/** M24: live findings in all, open and per invariant; shadow findings the same, apart. */
export function findingCounts(db: DatabaseSync): SequenceRead<{ live: FindingTally; shadow: FindingTally }> {
  try {
    const rows = db.prepare('SELECT mode, invariant, COUNT(*) AS n, SUM(resolvedAt IS NULL) AS open FROM overlord_invariant_findings GROUP BY mode, invariant')
      .all() as { mode: string; invariant: string; n: number; open: number }[];
    const tally = (mode: FindingMode): FindingTally => {
      const mine = rows.filter((r) => r.mode === mode);
      return {
        total: mine.reduce((s, r) => s + Number(r.n), 0), open: mine.reduce((s, r) => s + Number(r.open), 0),
        byInvariant: Object.fromEntries(mine.map((r) => [String(r.invariant), Number(r.n)])),
      };
    };
    return { kind: 'measured', value: { live: tally('live'), shadow: tally('shadow') } };
  } catch (e) {
    return { kind: 'unmeasured', why: errText(e) };
  }
}
