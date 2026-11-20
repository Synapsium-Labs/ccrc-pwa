// The park's record and its one writer (approvals plan 2026-11-18, §3.3.1; approvals PR 3). Ring L3, context C6 (operator
// questions). ONE table, `approval_parks`, keyed by the park key (`approvalPark.ts#parkKeyOf`): the slots a key's `live` rows
// reserve at mint (at most `APPROVAL_PARK_SLOTS`), its first park and horizon, a principal's ruling and its one use, the
// coordinator's verdicts on the key (F3: every decline and deny of a row of the key is written here in the row's own
// transaction) and whether a pane answer voided it (F4). Written ONLY through `CoordStore`'s approval methods, which the
// questions owner (`coord/questions.ts`) alone calls; every write here takes the database handle and runs inside the caller's
// transaction. Rows are never deleted by an approval-row purge (there is none, F8): `pruneParks` deletes a park at its horizon
// plus the approvals' input retention (T8-4).
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { APPROVAL_RULING_AUTHORITIES, type ApprovalParkWord, type ApprovalRulingAuthority } from '../../../shared/approval-park.js';
import { parkFactsOf, parkHorizonFrom, parkOpen, parkWordAt } from './approvalPark.js';

const STMTS = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
function stmt(db: DatabaseSync, sql: string): StatementSync {
  let m = STMTS.get(db);
  if (m === undefined) { m = new Map(); STMTS.set(db, m); }
  let s = m.get(sql);
  if (s === undefined) { s = db.prepare(sql); m.set(sql, s); }
  return s;
}

/** A park's ruling as stored: who gave it, what, against which row's class, and whether a retry spent it (or the signing
 *  site refused it, which spends it too, F5: a dead ruling never blocks a later one). */
export interface ParkRuling {
  readonly verdict: 'allow' | 'deny';
  readonly authority: ApprovalRulingAuthority;
  readonly by: string;
  readonly reason: string;
  readonly class: string;
  readonly rowId: number;
  readonly at: number;
  readonly spent: boolean;
}

/** One park as stored. `state` is `open` or `void` (a pane answer on a parked row voided it); a closed run's park is void
 *  too, but that is read from the run, never written here. */
export interface ParkRow {
  readonly key: string;
  readonly childId: string;
  readonly runId: number;
  readonly slots: number;
  readonly retries: number;
  readonly firstRowId: number | null;
  readonly parkedAt: number | null;
  readonly horizon: number | null;
  readonly voided: boolean;
  readonly ruling: ParkRuling | null;
  readonly coordDeclined: boolean;
  readonly coordDenied: boolean;
}

const PARK_COLS = 'parkKey, childId, runId, slots, retries, firstRowId, parkedAt, horizon, state, rulingVerdict, rulingAuthority, '
  + 'rulingBy, rulingReason, rulingClass, rulingRowId, rulingAt, rulingUses, coordDeclined, coordDenied';

interface ParkDb {
  parkKey: string; childId: string; runId: number; slots: number; retries: number; firstRowId: number | null;
  parkedAt: number | null; horizon: number | null; state: string; rulingVerdict: string | null; rulingAuthority: string | null;
  rulingBy: string | null; rulingReason: string | null; rulingClass: string | null; rulingRowId: number | null;
  rulingAt: number | null; rulingUses: number; coordDeclined: number; coordDenied: number;
}

const isAuthority = (v: unknown): v is ApprovalRulingAuthority =>
  typeof v === 'string' && (APPROVAL_RULING_AUTHORITIES as readonly string[]).includes(v);

/** A stored park, read back through the vocabularies: a ruling whose verdict or authority this build does not know reads
 *  as a SPENT ruling (it blocks nothing and is met by nothing), and a state other than `open` reads void. This FOLDS: an
 *  unknown authority reads `operator`, an unknown verdict `deny` and a missing class `forbidden`. That is safe only because
 *  such a ruling is also marked spent, so no reader acts on the folded words (review 2889 F11). */
function hydrate(r: ParkDb): ParkRow {
  const verdict = r.rulingVerdict === 'allow' || r.rulingVerdict === 'deny' ? r.rulingVerdict : null;
  const known = verdict !== null && isAuthority(r.rulingAuthority);
  const ruling: ParkRuling | null = r.rulingAt === null || r.rulingVerdict === null ? null : {
    verdict: verdict ?? 'deny', authority: isAuthority(r.rulingAuthority) ? r.rulingAuthority : 'operator',
    by: r.rulingBy ?? '', reason: r.rulingReason ?? '', class: r.rulingClass ?? 'forbidden',
    rowId: Number(r.rulingRowId ?? 0), at: Number(r.rulingAt), spent: !known || r.rulingUses !== 0,
  };
  return {
    key: r.parkKey, childId: r.childId, runId: Number(r.runId), slots: Number(r.slots), retries: Number(r.retries),
    firstRowId: r.firstRowId === null ? null : Number(r.firstRowId), parkedAt: r.parkedAt === null ? null : Number(r.parkedAt),
    horizon: r.horizon === null ? null : Number(r.horizon), voided: r.state !== 'open', ruling,
    coordDeclined: r.coordDeclined === 1, coordDenied: r.coordDenied === 1,
  };
}

/** One park by key, or null. */
export function parkByKey(db: DatabaseSync, key: string): ParkRow | null {
  const r = stmt(db, `SELECT ${PARK_COLS} FROM approval_parks WHERE parkKey = ?`).get(key) as ParkDb | undefined;
  return r === undefined ? null : hydrate(r);
}

/** The mint's park step, INSIDE the mint's transaction (F1, the cap race): the word `parkWordAt` gives for the key's park
 *  as read here, its slots and whether it is still open (`parkOpen`, the one void rule; the key names the child's live
 *  binding run, which the raise read open). A `live` word reserves one slot and creates the park on its first mint; any
 *  mint on a key that already has a park counts a retry. A `shadow` or `capped` mint reserves nothing and creates nothing. */
export function reserveParkAtMint(
  db: DatabaseSync, p: { key: string; childId: string; runId: number; laneLive: boolean; signedIn: boolean; now: number },
): ApprovalParkWord {
  const existing = parkByKey(db, p.key);
  const keyOpen = existing === null || parkOpen(parkFactsOf(existing, false), p.now);
  const word = parkWordAt(p.laneLive, p.signedIn, existing?.slots ?? 0, keyOpen);
  if (existing !== null) stmt(db, 'UPDATE approval_parks SET retries = retries + 1 WHERE parkKey = ?').run(p.key);
  if (word !== 'live') return word;
  if (existing === null) {
    stmt(db, 'INSERT INTO approval_parks (parkKey, childId, runId, slots, retries, state, rulingUses, coordDeclined, coordDenied, createdAt) '
      + "VALUES (?, ?, ?, 1, 0, 'open', 0, 0, 0, ?)").run(p.key, p.childId, p.runId, p.now);
  } else {
    stmt(db, 'UPDATE approval_parks SET slots = slots + 1 WHERE parkKey = ?').run(p.key);
  }
  return word;
}

/** A `live` row ruled inside its window releases its slot (§3.3.1). Called in the ruling's own transaction. */
export function releaseParkSlotOfRow(db: DatabaseSync, rowId: number): void {
  stmt(db, "UPDATE approval_parks SET slots = slots - 1 WHERE slots > 0 AND parkKey = (SELECT parkKey FROM approvals WHERE id = ? AND parkWord = 'live')")
    .run(rowId);
}

/** The coordinator's verdict on a row of the key (F3), written in the row's own transaction: `declined` or `denied`. */
export function noteCoordinatorVerdictOfRow(db: DatabaseSync, rowId: number, verdict: 'declined' | 'denied'): void {
  const col = verdict === 'denied' ? 'coordDenied' : 'coordDeclined';
  stmt(db, `UPDATE approval_parks SET ${col} = 1 WHERE parkKey = (SELECT parkKey FROM approvals WHERE id = ?)`).run(rowId);
}

/** The park's first park (`parkApproval`'s act, inside its transaction): the first row and its horizon, set once. */
export function markFirstPark(db: DatabaseSync, key: string, rowId: number, now: number): void {
  stmt(db, 'UPDATE approval_parks SET firstRowId = ?, parkedAt = ?, horizon = ? WHERE parkKey = ? AND parkedAt IS NULL')
    .run(rowId, now, parkHorizonFrom(now), key);
}

/** A principal's ruling on the park, recorded only when the park holds no unspent ruling (the first unspent ruling wins,
 *  T8-4): answers whether it was written. The caller decided the refusals before; this is the compare-and-set. A
 *  coordinator's deny also marks the key denied in the same write (F3: a deny is final for every authority). */
export function recordParkRuling(
  db: DatabaseSync, key: string,
  r: { verdict: 'allow' | 'deny'; authority: ApprovalRulingAuthority; by: string; reason: string; class: string; rowId: number; now: number },
): boolean {
  const res = stmt(db, 'UPDATE approval_parks SET rulingVerdict = ?, rulingAuthority = ?, rulingBy = ?, rulingReason = ?, rulingClass = ?, '
    + "rulingRowId = ?, rulingAt = ?, rulingUses = 0, coordDenied = CASE WHEN ? = 1 THEN 1 ELSE coordDenied END "
    + "WHERE parkKey = ? AND state = 'open' AND (rulingAt IS NULL OR rulingUses <> 0)")
    .run(r.verdict, r.authority, r.by, r.reason, r.class, r.rowId, r.now, r.verdict === 'deny' && r.authority === 'coordinator' ? 1 : 0, key);
  return Number(res.changes) === 1;
}

/** The spend (F6): the park's ruling given at `rulingAt` goes from unused to used, or nothing changes (a concurrent retry
 *  spent it first, or another ruling replaced it). Called in the signing site's one synchronous transaction, with the
 *  retry row's own ruling write. A refusal at signing spends it too (F5). */
export function spendParkRuling(db: DatabaseSync, key: string, rulingAt: number): boolean {
  const res = stmt(db, "UPDATE approval_parks SET rulingUses = 1 WHERE parkKey = ? AND rulingAt = ? AND rulingUses = 0 AND state = 'open'")
    .run(key, rulingAt);
  return Number(res.changes) === 1;
}

/** A pane answer on parked rows voids their parks (F4): a later ruling on them can never allow the next identical command.
 *  Only the rows the cleared dialog covered (`CoordStore#markApprovalOperatorRows`, BEFORE its rows move, with the same
 *  ids), never every parked row of the child: a press on another prompt voids no park (review 2889 F3). */
export function voidParksOfParkedRows(db: DatabaseSync, ids: readonly number[]): void {
  const s = stmt(db, "UPDATE approval_parks SET state = 'void' WHERE parkKey = (SELECT parkKey FROM approvals WHERE id = ? AND state = 'parked')");
  for (const id of ids) s.run(id);
}

/** The retention (T8-4): a park is deleted once its horizon is `before` (the horizon plus the approvals' input retention,
 *  the caller's arithmetic), and a park nothing ever parked on, once it was created before `before`. Returns the count. */
export function pruneParks(db: DatabaseSync, before: number): number {
  return Number(stmt(db, 'DELETE FROM approval_parks WHERE (horizon IS NOT NULL AND horizon < ?) OR (horizon IS NULL AND createdAt < ?)')
    .run(before, before).changes);
}

/** What the one write of `parked` did (approvals PR 3c, F-B): `parked` (the row moved; a moved ruling the park did not take,
 *  because an unspent one stands, is not recorded), `parked-ruled` (moved, and its ruling recorded on the park as the
 *  coordinator's), `closed` (the key's park is no longer open: nothing parked, and a `held` row was staled), `unmoved`. */
export type ParkMove = 'parked' | 'parked-ruled' | 'closed' | 'unmoved';

/** THE ONE WRITE of `parked` (approvals PR 3, F8-a), inside the caller's transaction, reached only through the questions
 *  owner's `parkApproval`: a `held` row whose stored word is `live` (its window ended unruled), or an `allowed`/`denied` row
 *  the hook never fetched (the last-poll move, F2), moves to `parked`, and its park records its first park. A moved ruling is
 *  recorded on the park as the coordinator's, unless the park already holds an unspent ruling (the first wins).
 *  First it asks whether the key's park is still open (approvals PR 3c, F-B): `parkOpen`, the one void rule, over the park
 *  as read here with its own run's closure (`runClosed`, the caller's read of the park's run; doubt answers closed). A park
 *  that went void, passed its horizon or lost its run takes no row: a `held` row is staled in the same write (the key can
 *  never meet a ruling, and the hook's next poll stops on `stale`), and a ruled row keeps its state. */
export function parkApprovalRow(db: DatabaseSync, id: number, now: number, runClosed: (runId: number) => boolean): ParkMove {
  const row = stmt(db, 'SELECT state, parkKey, verdict, reason, answeredBy, parentId, class FROM approvals WHERE id = ? AND parkWord = \'live\'')
    .get(id) as { state: string; parkKey: string | null; verdict: string | null; reason: string | null; answeredBy: string | null; parentId: string; class: string } | undefined;
  if (row === undefined || row.parkKey === null) return 'unmoved';
  const park = parkByKey(db, row.parkKey);
  if (park === null || !parkOpen(parkFactsOf(park, runClosed(park.runId)), now)) {
    stmt(db, "UPDATE approvals SET state = 'stale' WHERE id = ? AND state = 'held'").run(id);
    return 'closed';
  }
  const res = stmt(db, "UPDATE approvals SET state = 'parked' WHERE id = ? AND parkWord = 'live' AND (state = 'held' OR (state IN ('allowed','denied') AND fetchedAt IS NULL))")
    .run(id);
  if (Number(res.changes) === 0) return 'unmoved';
  markFirstPark(db, row.parkKey, id, now);
  if ((row.state === 'allowed' || row.state === 'denied') && (row.verdict === 'allow' || row.verdict === 'deny')) {
    return recordParkRuling(db, row.parkKey, {
      verdict: row.verdict, authority: 'coordinator', by: row.answeredBy ?? row.parentId, reason: row.reason ?? '', class: row.class, rowId: id, now,
    }) ? 'parked-ruled' : 'parked';
  }
  return 'parked';
}

/** The ruling read's first serve of a ruling (F8-c): `fetchedAt`, written once. */
export function markApprovalFetched(db: DatabaseSync, id: number, now: number): boolean {
  return Number(stmt(db, 'UPDATE approvals SET fetchedAt = ? WHERE id = ? AND fetchedAt IS NULL').run(now, id).changes) > 0;
}

/** THE SPEND (F6), inside the caller's one synchronous transaction: the park is read again, and its ruling given at
 *  `rulingAt` must still be unspent and inside its horizon; `sign` (synchronous) answers the signed ruling for the retry row,
 *  or null for a refusal at signing; the ruling's use goes 0 -> 1 and, signed, the retry row takes it, releases its slot, and
 *  the key's parked rows are settled (slug met-ruling-settles-the-key: they leave Waiting on you, and a later identical prompt
 *  is held fresh and may park again on the key). A refusal at signing spends it too (F5). Answers `met`, `refused` (spent,
 *  the row held fresh) or `lost` (nothing changed: another retry spent it, or the park moved). */
export function meetParkRuling(
  db: DatabaseSync, key: string, rulingAt: number, rowId: number,
  sign: (p: ParkRow) => { by: string; verdict: 'allow' | 'deny'; reason: string; ruling: string } | null, now: number,
): 'met' | 'refused' | 'lost' {
  const p = parkByKey(db, key);
  if (p === null || p.voided || p.ruling === null || p.ruling.spent || p.ruling.at !== rulingAt) return 'lost';
  if (p.horizon !== null && now >= p.horizon) return 'lost';
  const signed = sign(p);
  if (!spendParkRuling(db, key, rulingAt)) return 'lost';
  if (signed === null) return 'refused';
  const res = stmt(db, 'UPDATE approvals SET state = ?, verdict = ?, reason = ?, ruling = ?, ruledAt = ?, answeredBy = ? '
    + "WHERE id = ? AND state = 'held' AND releaseReason IS NULL")
    .run(signed.verdict === 'allow' ? 'allowed' : 'denied', signed.verdict, signed.reason, signed.ruling, now, signed.by, rowId);
  if (Number(res.changes) === 0) throw new Error('meetParkRuling: the retry row is no longer held');
  releaseParkSlotOfRow(db, rowId);
  stmt(db, "UPDATE approvals SET state = 'stale' WHERE parkKey = ? AND state = 'parked'").run(key);
  return 'met';
}

/** After a ruling inside the window (`CoordStore#takeApprovalForRule`'s won compare-and-set, in its transaction): the row's
 *  slot is released, and a coordinator's deny is recorded on the key (F3). Answers the take's success. */
export function afterRulingOfRow(db: DatabaseSync, rowId: number, coordinatorDeny: boolean): { ok: true } {
  releaseParkSlotOfRow(db, rowId);
  if (coordinatorDeny) noteCoordinatorVerdictOfRow(db, rowId, 'denied');
  return { ok: true };
}

/** After a decline's row write (`CoordStore#declineApproval`, in its transaction): when it moved the row, the coordinator's
 *  decline is recorded on the key (F3). Answers whether the row moved. */
export function noteDeclinedIf(db: DatabaseSync, rowId: number, moved: boolean): boolean {
  if (moved) noteCoordinatorVerdictOfRow(db, rowId, 'declined');
  return moved;
}
