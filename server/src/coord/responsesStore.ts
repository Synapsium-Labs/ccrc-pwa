// L3 adapter: the response record's tables (Overlord spec §4.3 C66, C67, "Where it lives"; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md`, Task 2). Context C6. `operator_responses` holds one row
// per message ccrc put in front of the operator, `response_receipts` what a device reported of it, and `response_boots`
// one row per boot of this server (question 17). Each fact has ONE writer, named here and in `writers-map.test.ts`:
//   - a push row's insert: `insertPushResponseInTx`, the sender's, inside the claim's or the unbound insert's transaction;
//   - a push row's accepted subscriptions, `deliveredAt`, `sends`, and its removal when never delivered:
//     `landPushVerdictInTx`, the sender's, inside `markOutboxVerdict`'s transaction (the deleter by the push's verdict);
//   - a receipt: `insertReceipt`, the receipts door's, through `receiveReceipts`;
//   - a boot: `recordResponseBoot`, once a boot, from `index.ts`;
//   - a Waiting on you row's insert: `insertWaitingResponseInTx`, inside the move that stamps the reach (PR B);
//   - a digest line's insert: `insertDigestResponsesInTx`, inside the digest's claim (PR B);
//   - the seal (`shownAt`, `openedAt`, `actedAt`, `outcome`, `how`, `why`, `sealedAt`): `sealResponse`, the lane's (PR B);
//   - `handledAt`: `markResponseHandled`, the handled door's (PR B);
//   - the retention setting: `setResponseRetention`, the retention door's (PR B);
//   - deletes by time, of rows, receipts and older boots: `deleteResponsesThroughInTx` (PR B), the deleter by time.
// Nothing here decides: `receiptVerdict` and the seal's deciders (`server/src/responses.ts`) do, asked by the door and the
// lane. Every insert names its
// conflict (`INSERT … ON CONFLICT(<key>) DO NOTHING`), never `INSERT OR IGNORE`, so a repeat is nothing and a `CHECK`
// violation throws. SQL never reads the clock. A response is never an answer and never authority: nothing here touches
// another table.
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  PUSH_RESPONSE_DELIVERY, PUSH_WINDOW_MS, RECEIPT_KINDS, RECEIPT_SOURCES, RESPONSE_KINDS,
  RESPONSE_OUTCOMES, RESPONSE_RETENTION_MAX_DAYS, RESPONSE_RETENTION_MIN_DAYS, RESPONSE_ROW_STATES,
  WAITING_WINDOW_MS, digestLineKey,
  type ReceiptDrop, type ReceiptIn, type ReceiptKind, type ReceiptSource, type ResponseKind, type ResponseRef, type ResponseRowState,
  type ResponseRowBrief, type ResponseStamp,
} from '../../../shared/responses.js';
import type { DigestRowKind } from '../../../shared/api.js';
import type { OutboxSource } from '../../../shared/push-outbox.js';
import type { ReceiptFacts, ReceiptVerdict, SealOutcome, SealReceipt, SealRow } from '../responses.js';
import { tx } from './tx.js';
import { changeLatch } from '../changeLatch.js';

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
 *  (question 14): a row never delivered, with none accepted, on a move that is `terminal` and `answered`, is removed.
 *  Everything else removes nothing: a `retrying` move keeps the row `pending` for the retry; an `unknown` move keeps it
 *  `pending`; a delivered row is never removed; and a row that holds ANY receipt is never removed (review 2214 F2, slug
 *  a-receipt-keeps-its-row): a receipt is evidence the push reached a device (an `unknown` attempt the device showed,
 *  then a re-arm that failed), so the row takes the terminal move unchanged and keeps its receipts. The removal is one
 *  statement, so no receipt is ever gone while its row is kept (F5). A sealed row (a re-arm after its window): only
 *  `sends` moves. A row whose stored state or set this build cannot read throws, and the caller logs it. */
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
  const gone = stmt(db, "DELETE FROM operator_responses WHERE id = ? AND state = 'pending' "
    + 'AND NOT EXISTS (SELECT 1 FROM response_receipts WHERE responseId = ?)').run(row.id, row.id);
  return Number(gone.changes) > 0 ? { changed: true, removed: true } : { changed: false, removed: false };
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
  try { r = rowByRef(db, ref); } catch (e) {
    const detail = `operator_responses read failed: ${message(e)}`;
    console.warn(`ccrc-server: ${detail}`);
    return { ok: false, detail };
  }
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
    if (e instanceof ReceiptReadFailed) return { ok: false, detail: e.message };    // the read logged it already
    const detail = `response_receipts write failed: ${message(e)}`;
    console.warn(`ccrc-server: ${detail}`);
    return { ok: false, detail };
  }
}

// ── PR B: the Waiting on you rows and the digest lines (Task 6) ───────────────────────────────────────────────────────────

const stampCols = (stamp: ResponseStamp): [number, number | null, number, number | null] => [
  stamp.boot.kind === 'measured' ? 1 : 0, stamp.boot.kind === 'measured' ? stamp.boot.epoch : null,
  stamp.restore.kind === 'measured' ? 1 : 0, stamp.restore.kind === 'measured' ? stamp.restore.n : null,
];

/** A Waiting on you row (Table 4.3a), inside the move that stamped its source's reach and only when that stamp is new,
 *  so a source has at most one; the partial unique index holds that too, by `INSERT … ON CONFLICT(refKind, refId) WHERE
 *  kind = 'waiting' DO NOTHING`, and a broken row throws. It is `delivered` at once, at the reach, with its window
 *  seven days on and its source as its label. */
export function insertWaitingResponseInTx(db: DatabaseSync, w: {
  readonly source: OutboxSource; readonly id: number; readonly stamp: ResponseStamp; readonly at: number;
}): { readonly inserted: boolean } {
  const res = stmt(db, 'INSERT INTO operator_responses (kind, label, refKind, refId, delivery, state, bootMeasured, bootEpoch, '
    + "restoreMeasured, restoreGeneration, insertedAt, admittedAt, deliveredAt, windowCapAt) VALUES ('waiting', ?, ?, ?, ?, "
    + "'delivered', ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(refKind, refId) WHERE kind = 'waiting' DO NOTHING")
    .run(w.source, w.source, w.id, PUSH_RESPONSE_DELIVERY, ...stampCols(w.stamp), w.at, w.at, w.at, w.at + WAITING_WINDOW_MS);
  return { inserted: Number(res.changes) > 0 };
}

/** The digest's decision lines (question 8), inside the claim's transaction, only when the claim won: one row each,
 *  keyed `<day>:<rowKind>:<id>`, labelled by its row kind, `delivered` at the claim, its window ending at the next
 *  digest. By `INSERT … ON CONFLICT(refKey) WHERE kind = 'digest' DO NOTHING`. Answers how many it wrote. */
export function insertDigestResponsesInTx(db: DatabaseSync, d: {
  readonly day: string; readonly lines: readonly { readonly rowKind: DigestRowKind; readonly id: number }[];
  readonly stamp: ResponseStamp; readonly at: number; readonly windowCapAt: number;
}): { readonly inserted: number } {
  const st = stmt(db, 'INSERT INTO operator_responses (kind, label, refKey, delivery, state, bootMeasured, bootEpoch, restoreMeasured, '
    + "restoreGeneration, insertedAt, admittedAt, deliveredAt, windowCapAt) VALUES ('digest', ?, ?, ?, 'delivered', ?, ?, ?, ?, ?, ?, "
    + "?, ?) ON CONFLICT(refKey) WHERE kind = 'digest' DO NOTHING");
  let inserted = 0;
  for (const l of d.lines) {
    const res = st.run(l.rowKind, digestLineKey(d.day, l.rowKind, l.id), PUSH_RESPONSE_DELIVERY, ...stampCols(d.stamp), d.at, d.at, d.at, d.windowCapAt);
    inserted += Number(res.changes);
  }
  return { inserted };
}

/** Logs a response write that failed inside a move it must never cost, once per cause through a change latch (the cause
 *  names no id), so a standing failure logs once, not once per move. */
const writeLatch = changeLatch();
export function warnResponseWrite(cause: string, line: string): void {
  if (writeLatch.changed(cause)) console.warn(`ccrc-server: response record: ${line}`);
}

// ── PR B: the lane's reads and writes (Task 7) ───────────────────────────────────────────────────────────────────────────

/** An open row as the lane reads it: the seal's columns, and what it is about. */
export interface OpenResponseRow extends SealRow {
  readonly refKind: OutboxSource | null; readonly refId: number | null; readonly refKey: string | null; readonly tag: string | null;
}
export type OpenRowsRead =
  | { readonly ok: true; readonly rows: readonly OpenResponseRow[]; readonly unreadable: readonly { readonly id: number; readonly detail: string }[] }
  | { readonly ok: false; readonly detail: string };

const OPEN_COLS = 'id, kind, label, state, carriesKind, carriesId, hasActions, acceptedSubs, bootMeasured, bootEpoch, restoreMeasured, '
  + 'restoreGeneration, insertedAt, deliveredAt, windowCapAt, refKind, refId, refKey, tag';
const sourceOf = (x: unknown, col: string): OutboxSource | null => {
  if (x === null) return null;
  if (x === 'ask' || x === 'item') return x;
  throw new Error(`${col} ${String(x)} is not known`);
};
const numOrNull = (x: unknown): number | null => (x === null ? null : Number(x));

function openRowOf(r: Record<string, unknown>): OpenResponseRow {
  const kind = String(r.kind) as ResponseKind;
  if (!RESPONSE_KINDS.includes(kind)) throw new Error(`kind ${String(r.kind)} is not known`);
  const carriesKind = sourceOf(r.carriesKind, 'carriesKind');
  return {
    id: Number(r.id), kind, label: String(r.label), state: stateOf(r.state),
    carries: carriesKind === null ? null : { kind: carriesKind, id: Number(r.carriesId) },
    hasActions: Number(r.hasActions) === 1, acceptedSubs: subsOf(r.acceptedSubs),
    boot: Number(r.bootMeasured) === 1 ? { kind: 'measured', epoch: Number(r.bootEpoch) } : { kind: 'unmeasured' },
    restore: Number(r.restoreMeasured) === 1 ? { kind: 'measured', n: Number(r.restoreGeneration) } : { kind: 'unmeasured' },
    insertedAt: Number(r.insertedAt), deliveredAt: numOrNull(r.deliveredAt), windowCapAt: numOrNull(r.windowCapAt),
    refKind: sourceOf(r.refKind, 'refKind'), refId: numOrNull(r.refId), refKey: r.refKey === null ? null : String(r.refKey),
    tag: r.tag === null ? null : String(r.tag),
  };
}

/** Every row not yet sealed, oldest first. A row this build cannot read is answered beside the rest, never folded into a
 *  known row and never hiding them (the push outbox's one-unreadable-row-never-blinds-the-drain). */
export function openResponseRows(db: DatabaseSync): OpenRowsRead {
  let raw: Record<string, unknown>[];
  try {
    raw = stmt(db, `SELECT ${OPEN_COLS} FROM operator_responses WHERE sealedAt IS NULL ORDER BY id`).all() as Record<string, unknown>[];
  } catch (e) {
    return { ok: false, detail: `operator_responses read failed: ${message(e)}` };
  }
  const rows: OpenResponseRow[] = [];
  const unreadable: { id: number; detail: string }[] = [];
  for (const r of raw) {
    try { rows.push(openRowOf(r)); } catch (e) { unreadable.push({ id: Number(r.id), detail: message(e) }); }
  }
  return { ok: true, rows, unreadable };
}

/** A row's receipts, as the seal reads them. A stored word this build does not know throws, and the lane defers. */
export function receiptsOf(db: DatabaseSync, responseId: number): SealReceipt[] {
  const raw = stmt(db, 'SELECT receipt, source, endpointHash, at FROM response_receipts WHERE responseId = ? ORDER BY id').all(responseId) as
    { receipt: string; source: string; endpointHash: string; at: number }[];
  return raw.map((r) => {
    if (!(RECEIPT_KINDS as readonly string[]).includes(r.receipt)) throw new Error(`receipt ${r.receipt} is not known`);
    if (!(RECEIPT_SOURCES as readonly string[]).includes(r.source)) throw new Error(`source ${r.source} is not known`);
    return { receipt: r.receipt as ReceiptKind, source: r.source as ReceiptSource, endpointHash: String(r.endpointHash), at: Number(r.at) };
  });
}

/** The accepted subscriptions of `row` on which a later push under the same tag, another push id, was delivered inside
 *  its window: there a `shown` could have been replaced, so its absence proves nothing (§4.3, I18). */
export function replacedOnOf(db: DatabaseSync, row: { readonly id: number; readonly tag: string | null; readonly deliveredAt: number | null;
  readonly acceptedSubs: readonly string[] }, windowEnd: number): string[] {
  if (row.tag === null || row.deliveredAt === null || row.acceptedSubs.length === 0) return [];
  const later = stmt(db, "SELECT acceptedSubs FROM operator_responses WHERE kind = 'push' AND tag = ? AND id != ? "
    + 'AND deliveredAt > ? AND deliveredAt <= ?').all(row.tag, row.id, row.deliveredAt, windowEnd) as { acceptedSubs: unknown }[];
  const mine = new Set(row.acceptedSubs);
  const out = new Set<string>();
  for (const l of later) for (const s of subsOf(l.acceptedSubs)) if (mine.has(s)) out.add(s);
  return [...out].sort();
}

/** How many boots of this server fell after `after` and at or before `through` (question 17). */
export function bootsInWindowOf(db: DatabaseSync, after: number, through: number): number {
  const r = stmt(db, 'SELECT COUNT(*) AS n FROM response_boots WHERE bootedAt > ? AND bootedAt <= ?').get(after, through) as { n: number };
  return Number(r.n);
}

/** THE SEAL, the lane's one write of a row's outcome: once (`WHERE sealedAt IS NULL`), with what `responseSealDue`
 *  answered. A second seal changes nothing. */
export function sealResponse(db: DatabaseSync, id: number, d: SealOutcome, at: number): { readonly changed: boolean } {
  const res = stmt(db, "UPDATE operator_responses SET state = 'sealed', outcome = ?, how = ?, why = ?, actedAt = ?, shownAt = ?, "
    + 'openedAt = ?, sealedAt = ? WHERE id = ? AND sealedAt IS NULL')
    .run(d.outcome, d.how, d.why, d.actedAt, d.shownAt, d.openedAt, at, id);
  return { changed: Number(res.changes) > 0 };
}

/** THE DELETER BY TIME (question 14): inside its caller's transaction, every receipt of a row inserted at or before `at`,
 *  then those rows, then every `response_boots` row booted at or before `at` except the newest. Its callers: the
 *  retention pass, through `deleteResponsesThrough`; later W4's wipe and its replay, which call this form inside their own
 *  transactions. The other deleter is the sender's removal of a never-delivered push in `landPushVerdictInTx`. */
export function deleteResponsesThroughInTx(db: DatabaseSync, at: number):
  { readonly rows: number; readonly receipts: number; readonly boots: number } {
  const receipts = stmt(db, 'DELETE FROM response_receipts WHERE responseId IN (SELECT id FROM operator_responses WHERE insertedAt <= ?)').run(at);
  const rows = stmt(db, 'DELETE FROM operator_responses WHERE insertedAt <= ?').run(at);
  const boots = stmt(db, 'DELETE FROM response_boots WHERE bootedAt <= ? AND epoch < (SELECT MAX(epoch) FROM response_boots)').run(at);
  return { rows: Number(rows.changes), receipts: Number(receipts.changes), boots: Number(boots.changes) };
}
/** `deleteResponsesThroughInTx` in a transaction of its own (`coord/tx.ts#tx` does not nest), for the retention pass. */
export function deleteResponsesThrough(db: DatabaseSync, at: number): ReturnType<typeof deleteResponsesThroughInTx> {
  return tx(db, () => deleteResponsesThroughInTx(db, at));
}

// ── PR B: the retention setting and the doors' reads and writes (Task 8) ───────────────────────────────────────────────

export type RetentionRead = { readonly ok: true; readonly days: number } | { readonly ok: false; readonly detail: string };
/** The operator's retention, in days. A missing row, a failed read, or a value outside the bounds is `ok: false`, never
 *  the default (slug retention-unreadable-deletes-nothing). */
export function responseRetention(db: DatabaseSync): RetentionRead {
  try {
    const r = stmt(db, 'SELECT retentionDays FROM response_settings WHERE id = 1').get() as { retentionDays: unknown } | undefined;
    if (r === undefined) return { ok: false, detail: 'response_settings has no row' };
    const days = r.retentionDays;
    if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < RESPONSE_RETENTION_MIN_DAYS || days > RESPONSE_RETENTION_MAX_DAYS) {
      return { ok: false, detail: 'response_settings.retentionDays is outside its bounds' };
    }
    return { ok: true, days };
  } catch (e) {
    return { ok: false, detail: `response_settings read failed: ${message(e)}` };
  }
}
/** The retention door's one write. The door has bounded `days` and asked its gate. */
export function setResponseRetention(db: DatabaseSync, days: number, at: number): { readonly changed: boolean } {
  const res = stmt(db, 'UPDATE response_settings SET retentionDays = ?, updatedAt = ? WHERE id = 1 AND retentionDays IS NOT ?').run(days, at, days);
  return { changed: Number(res.changes) > 0 };
}

/** "I handled this elsewhere" (C69), the handled door's one write: `handledAt` once (`WHERE handledAt IS NULL`), and
 *  nothing else: no seal, no item, ask, mail or outbox row. Answers the row's stored `handledAt`, or null for no row. */
export function markResponseHandled(db: DatabaseSync, id: number, at: number):
  { readonly row: { readonly id: number; readonly handledAt: number } | null; readonly changed: boolean } {
  return tx(db, () => {
    const res = stmt(db, 'UPDATE operator_responses SET handledAt = ? WHERE id = ? AND handledAt IS NULL').run(at, id);
    const r = stmt(db, 'SELECT id, handledAt FROM operator_responses WHERE id = ?').get(id) as { id: number; handledAt: number | null } | undefined;
    return { row: r === undefined || r.handledAt === null ? null : { id: Number(r.id), handledAt: Number(r.handledAt) }, changed: Number(res.changes) > 0 };
  });
}

export type ResponseRowsRead = { readonly ok: true; readonly rows: readonly ResponseRowBrief[] } | { readonly ok: false; readonly detail: string };

/** The rows about one item (its Waiting on you row and every push that carried it) or one digest line. A stored word this
 *  build cannot read makes the whole read `ok: false`, never a shorter list. */
export function responsesForRef(db: DatabaseSync, ref: { readonly kind: 'item'; readonly id: number } | { readonly kind: 'digest'; readonly key: string }): ResponseRowsRead {
  try {
    const raw = (ref.kind === 'item'
      ? stmt(db, "SELECT id, kind, label, state, outcome, handledAt FROM operator_responses WHERE (kind = 'waiting' AND refKind = 'item' AND refId = ?) "
        + "OR (kind = 'push' AND carriesKind = 'item' AND carriesId = ?) ORDER BY id").all(ref.id, ref.id)
      : stmt(db, "SELECT id, kind, label, state, outcome, handledAt FROM operator_responses WHERE kind = 'digest' AND refKey = ? ORDER BY id").all(ref.key)
    ) as Record<string, unknown>[];
    return { ok: true, rows: raw.map((r) => {
      const kind = String(r.kind) as ResponseKind;
      if (!RESPONSE_KINDS.includes(kind)) throw new Error(`row ${String(r.id)} kind is not known`);
      const outcome = r.outcome === null ? null : String(r.outcome) as ResponseRowBrief['outcome'];
      if (outcome !== null && !RESPONSE_OUTCOMES.includes(outcome)) throw new Error(`row ${String(r.id)} outcome is not known`);
      return { id: Number(r.id), kind, label: String(r.label), state: stateOf(r.state), outcome, handledAt: numOrNull(r.handledAt) };
    }) };
  } catch (e) {
    const detail = `operator_responses read failed: ${message(e)}`;
    console.warn(`ccrc-server: ${detail}`);
    return { ok: false, detail };
  }
}
