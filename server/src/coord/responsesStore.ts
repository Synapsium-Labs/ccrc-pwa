// L3 adapter: the response record's tables (Overlord spec §4.3 C66, C67, "Where it lives"; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md`, Task 2). Context C6. `operator_responses` holds one row
// per message ccrc put in front of the operator, `response_receipts` what a device reported of it, and `response_boots`
// one row per boot of this server (question 17). Each fact has ONE writer, named here and in `writers-map.test.ts`:
//   - a push row's insert: `insertPushResponseInTx`, the sender's, inside the claim's or the unbound insert's transaction;
//   - a push row's accepted subscriptions, `deliveredAt`, `sends`, and its removal when never delivered:
//     `landPushVerdictInTx`, the sender's, inside `markOutboxVerdict`'s transaction (the deleter by the push's verdict);
//   - a receipt: `insertReceipt`, the receipts door's, through `receiveReceipts`;
//   - a boot: `recordResponseBoot`, once a boot, from `index.ts`.
// Nothing here decides: `receiptVerdict` (`server/src/responses.ts`) does, handed in by the door. Every insert names its
// conflict (`INSERT … ON CONFLICT(<key>) DO NOTHING`), never `INSERT OR IGNORE`, so a repeat is nothing and a `CHECK`
// violation throws. SQL never reads the clock. A response is never an answer and never authority: nothing here touches
// another table.
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  PUSH_RESPONSE_DELIVERY, PUSH_WINDOW_MS, RECEIPT_KINDS, RESPONSE_KINDS, RESPONSE_ROW_STATES,
  type ReceiptDrop, type ReceiptIn, type ReceiptKind, type ResponseKind, type ResponseRef, type ResponseRowState, type ResponseStamp,
} from '../../../shared/responses.js';
import type { OutboxSource } from '../../../shared/push-outbox.js';
import type { ReceiptFacts, ReceiptVerdict } from '../responses.js';
import { tx } from './tx.js';

const PREPARED = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
function stmt(db: DatabaseSync, sql: string): StatementSync {
  let byText = PREPARED.get(db);
  if (byText === undefined) { byText = new Map(); PREPARED.set(db, byText); }
  let st = byText.get(sql);
  if (st === undefined) { st = db.prepare(sql); byText.set(sql, st); }
  return st;
}
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What the sender writes for one push: its id, its label (the notifier kind, or a bound push's source, question 18),
 *  the row it carries (a bound push's source, question 3), whether it has actions, its tag, the stamp and the time. */
export interface PushResponseInsert {
  readonly pushId: string; readonly label: string; readonly carries: { readonly kind: OutboxSource; readonly id: number } | null;
  readonly hasActions: boolean; readonly tag: string; readonly stamp: ResponseStamp; readonly at: number;
}
/** What the outbox hands the store for a push it claims or inserts: the payload's tag and actions are read from the
 *  payload the outbox holds at that moment (slug tag-and-actions-from-the-claimed-payload). */
export type PushResponseOf = Pick<PushResponseInsert, 'label' | 'carries' | 'stamp'>;

/** The sender's insert, inside the claim's or the unbound insert's transaction: a `pending` push row, by `INSERT … ON
 *  CONFLICT(pushId) DO NOTHING`, so a row with this push id already there (a retry or a re-arm of the same outbox row)
 *  makes it answer `inserted: false`, and a `CHECK` violation throws. */
export function insertPushResponseInTx(db: DatabaseSync, r: PushResponseInsert): { readonly inserted: boolean } {
  // Each half is two columns, measured or not, so `unmeasured` is never a number and a measured stamp without its value
  // reaches the CHECK and throws, never folds to unmeasured.
  const boot = r.stamp.boot.kind === 'measured' ? { m: 1, v: r.stamp.boot.epoch } : { m: 0, v: null };
  const restore = r.stamp.restore.kind === 'measured' ? { m: 1, v: r.stamp.restore.n } : { m: 0, v: null };
  const res = stmt(db, 'INSERT INTO operator_responses (kind, label, pushId, carriesKind, carriesId, hasActions, tag, delivery, '
    + "state, bootMeasured, bootEpoch, restoreMeasured, restoreGeneration, insertedAt) VALUES ('push', ?, ?, ?, ?, ?, ?, "
    + "?, 'pending', ?, ?, ?, ?, ?) ON CONFLICT(pushId) DO NOTHING")
    .run(r.label, r.pushId, r.carries?.kind ?? null, r.carries?.id ?? null, r.hasActions ? 1 : 0, r.tag,
      PUSH_RESPONSE_DELIVERY, boot.m, boot.v, restore.m, restore.v, r.at);
  return { inserted: Number(res.changes) > 0 };
}

/** What the outbox move a verdict rode says to the response row. `markOutboxVerdict` fills it at the move it already
 *  makes: `terminal` is that function's own `isTerminal(to)`, and `answered` is false for `to === 'unknown'` (no verdict,
 *  or a `no-answer` subscription: the push service may have taken it). */
export interface PushVerdictLanding {
  readonly accepted: readonly string[]; readonly terminal: boolean; readonly answered: boolean;
}

/** A stored accepted set, read strictly: a JSON array of strings, or a throw that names only the column. */
function subsOf(text: unknown): string[] {
  let v: unknown;
  try { v = JSON.parse(String(text)); } catch { throw new Error('acceptedSubs is not JSON'); }
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error('acceptedSubs is not a list of hashes');
  return v as string[];
}
function stateOf(text: unknown): ResponseRowState {
  const state = String(text) as ResponseRowState;
  if (!RESPONSE_ROW_STATES.includes(state)) throw new Error(`state ${String(text)} is not known`);
  return state;
}

/** The sender's verdict, inside `markOutboxVerdict`'s transaction, after the outbox move it rides and only when that move
 *  changed. `accepted` hashes join the row's set (sorted, unique) and `sends` adds one per accepted landing;
 *  `deliveredAt`, `admittedAt` and `windowCapAt` are set at the first acceptance. THE DELETER BY THE PUSH'S VERDICT
 *  (question 14): a row never delivered, with none accepted, on a move that is `terminal` and `answered`, is removed with
 *  its receipts. Everything else removes nothing: a `retrying` move keeps the row `pending` for the retry; an `unknown`
 *  move keeps it `pending`; a delivered row is never removed. A sealed row (a re-arm after its window): only `sends`
 *  moves. A row whose stored state or set this build cannot read throws, and the caller logs it. */
export function landPushVerdictInTx(db: DatabaseSync, pushId: string, v: PushVerdictLanding, at: number):
  { readonly changed: boolean; readonly removed: boolean } {
  const row = stmt(db, "SELECT id, state, acceptedSubs FROM operator_responses WHERE kind = 'push' AND pushId = ?").get(pushId) as
    { id: number; state: unknown; acceptedSubs: unknown } | undefined;
  if (row === undefined) return { changed: false, removed: false };
  const state = stateOf(row.state);
  if (v.accepted.length > 0) {
    if (state === 'sealed') {
      stmt(db, 'UPDATE operator_responses SET sends = sends + 1 WHERE id = ?').run(row.id);
      return { changed: true, removed: false };
    }
    const subs = [...new Set([...subsOf(row.acceptedSubs), ...v.accepted])].sort();
    stmt(db, "UPDATE operator_responses SET state = 'delivered', acceptedSubs = ?, sends = sends + 1, "
      + 'deliveredAt = COALESCE(deliveredAt, ?), admittedAt = COALESCE(admittedAt, ?), windowCapAt = COALESCE(windowCapAt, ?) '
      + 'WHERE id = ?').run(JSON.stringify(subs), at, at, at + PUSH_WINDOW_MS, row.id);
    return { changed: true, removed: false };
  }
  if (state !== 'pending' || !v.terminal || !v.answered) return { changed: false, removed: false };
  stmt(db, 'DELETE FROM response_receipts WHERE responseId = ?').run(row.id);
  stmt(db, "DELETE FROM operator_responses WHERE id = ? AND state = 'pending'").run(row.id);
  return { changed: true, removed: true };
}

/** One boot of this server (question 17), from `index.ts` once, right after the store opens: `{ ok: true, epoch }`, or
 *  `{ ok: false, detail }` on a failed write, which makes this process's stamp `unmeasured`. Never a throw. */
export function recordResponseBoot(db: DatabaseSync, buildSha: string | null, at: number):
  { readonly ok: true; readonly epoch: number } | { readonly ok: false; readonly detail: string } {
  try {
    const res = stmt(db, 'INSERT INTO response_boots (bootedAt, buildSha) VALUES (?, ?)').run(at, buildSha);
    return { ok: true, epoch: Number(res.lastInsertRowid) };
  } catch (e) {
    return { ok: false, detail: `response_boots insert failed: ${message(e)}` };
  }
}

/** A row a receipt names, as `receiptVerdict`'s facts: its id, kind, state, accepted set, and its stored worker receipts
 *  of each kind. `row: null` when no row names the ref. A row this build cannot read, or a failed query, is `ok: false`
 *  with a detail that names the row's id and the column, never folded into a known row. */
export type ResponseRowRead =
  | { readonly ok: true; readonly row: {
      readonly id: number; readonly kind: ResponseKind; readonly state: ResponseRowState; readonly acceptedSubs: readonly string[];
      readonly workerReceipts: Readonly<Record<ReceiptKind, number>>; } | null }
  | { readonly ok: false; readonly detail: string };

const ROW_COLS = 'SELECT id, kind, state, acceptedSubs FROM operator_responses WHERE ';
function rowByRef(db: DatabaseSync, ref: ResponseRef): Record<string, unknown> | undefined {
  switch (ref.kind) {
    case 'push': return stmt(db, `${ROW_COLS}kind = 'push' AND pushId = ?`).get(ref.pushId) as Record<string, unknown> | undefined;
    case 'item':
    case 'ask': return stmt(db, `${ROW_COLS}kind = 'waiting' AND refKind = ? AND refId = ?`).get(ref.kind, ref.id) as Record<string, unknown> | undefined;
    case 'digest': return stmt(db, `${ROW_COLS}kind = 'digest' AND refKey = ?`).get(ref.key) as Record<string, unknown> | undefined;
    case 'reply': return stmt(db, `${ROW_COLS}kind = 'reply' AND refId = ?`).get(ref.id) as Record<string, unknown> | undefined;
    default: { const unknown: never = ref; throw new Error(`ref ${String(unknown)} is not known`); }
  }
}

export function responseRowForRef(db: DatabaseSync, ref: ResponseRef): ResponseRowRead {
  let r: Record<string, unknown> | undefined;
  try { r = rowByRef(db, ref); } catch (e) { return { ok: false, detail: `operator_responses read failed: ${message(e)}` }; }
  if (r === undefined) return { ok: true, row: null };
  const id = Number(r.id);
  try {
    const kind = String(r.kind) as ResponseKind;
    if (!RESPONSE_KINDS.includes(kind)) throw new Error(`kind ${String(r.kind)} is not known`);
    const counts = stmt(db, "SELECT receipt, COUNT(*) AS n FROM response_receipts WHERE responseId = ? AND source = 'worker' "
      + 'GROUP BY receipt').all(id) as { receipt: string; n: number }[];
    const workerReceipts = Object.fromEntries(RECEIPT_KINDS.map((k) => [k, 0])) as Record<ReceiptKind, number>;
    for (const c of counts) if ((RECEIPT_KINDS as readonly string[]).includes(c.receipt)) workerReceipts[c.receipt as ReceiptKind] = Number(c.n);
    return { ok: true, row: { id, kind, state: stateOf(r.state), acceptedSubs: subsOf(r.acceptedSubs), workerReceipts } };
  } catch (e) {
    const detail = `operator_responses row ${id} is unreadable by this build: ${message(e)}`;
    console.warn(`ccrc-server: ${detail}`);
    return { ok: false, detail };
  }
}

/** The receipts door's write: one receipt, by `INSERT … ON CONFLICT(responseId, receipt, source, endpointHash) DO
 *  NOTHING`, so the same receipt twice keeps one. Called only by `receiveReceipts`, after `receiptVerdict` said keep. */
export function insertReceipt(db: DatabaseSync, responseId: number, r: ReceiptIn, at: number): { readonly kept: boolean } {
  const worker = r.from.source === 'worker' ? r.from : null;
  const res = stmt(db, 'INSERT INTO response_receipts (responseId, receipt, source, version, endpointHash, at) VALUES (?, ?, ?, ?, ?, ?) '
    + 'ON CONFLICT(responseId, receipt, source, endpointHash) DO NOTHING')
    .run(responseId, r.receipt, r.from.source, worker?.version ?? null, worker?.endpointHash ?? '', at);
  return { kept: Number(res.changes) > 0 };
}

/** What the door's write answers for one receipt: kept, or dropped by the verdict (`why`) or as a repeat of a receipt
 *  already kept (`repeat`). */
export type ReceiptAnswer =
  | { readonly kept: true }
  | { readonly kept: false; readonly why: ReceiptDrop };

/** A read inside the door's transaction that failed: thrown to roll the whole body back. */
class ReceiptReadFailed extends Error {}

/** The receipts door's one transaction for one body: for each receipt, the row it names is read, `verdictOf` (the door's
 *  `receiptVerdict`) decides over it, and a kept receipt is written, so the facts a verdict was decided on are the facts
 *  it writes under. A row this build cannot read, or a failed write, rolls the whole body back and answers `ok: false`,
 *  with nothing written. */
export function receiveReceipts(db: DatabaseSync, receipts: readonly ReceiptIn[], at: number,
  verdictOf: (r: ReceiptIn, f: ReceiptFacts) => ReceiptVerdict):
  { readonly ok: true; readonly answers: readonly ReceiptAnswer[] } | { readonly ok: false; readonly detail: string } {
  const one = (r: ReceiptIn): ReceiptAnswer => {
    const read = responseRowForRef(db, r.ref);
    if (!read.ok) throw new ReceiptReadFailed(read.detail);
    const row = read.row;
    const facts: ReceiptFacts = {
      row: row === null ? null : { kind: row.kind, state: row.state, acceptedSubs: row.acceptedSubs },
      workerReceipts: row === null ? 0 : row.workerReceipts[r.receipt],
    };
    const v = verdictOf(r, facts);
    if (!v.keep) return { kept: false, why: v.why };
    if (row === null) return { kept: false, why: 'no-row' };   // a verdict that keeps a receipt with no row writes nothing
    return insertReceipt(db, row.id, r, at).kept ? { kept: true } : { kept: false, why: 'repeat' };
  };
  try {
    return { ok: true, answers: tx(db, () => receipts.map(one)) };
  } catch (e) {
    return { ok: false, detail: e instanceof ReceiptReadFailed ? e.message : `response_receipts write failed: ${message(e)}` };
  }
}
