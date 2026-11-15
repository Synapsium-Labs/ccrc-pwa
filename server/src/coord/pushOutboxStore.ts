// L3 adapter: the push outbox's table and the reach stamps (Overlord spec §6.7, §6.1 C31, §4.3 C67; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md`, Task 3). `push_outbox` is written only through the
// functions below, each one move of `OUTBOX_TRANSITIONS` (`shared/push-outbox.ts`), checked by `outboxMoveAllowed` and
// written as a compare-and-set on its `from` state. `reachedOperatorAt` on `asks` and `operator_items` has ONE writer,
// `stampReach`. `CoordStore` keeps one-line delegates of the same names. Nothing here decides: the deciders are
// `server/src/pushOutbox.ts`'s, and this file records and measures. The store takes no entropy and no masker: a bound
// row's push id and payload reach it from the caller (slug bound-row-callback). SQL never reads the clock.
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  OUTBOX_SOURCES, OUTBOX_STATES, PUSH_SILENT_WHYS, TERMINAL_OUTBOX_STATES, outboxMoveAllowed,
  type OutboxActor, type OutboxSource, type OutboxState, type PushSendVerdict, type PushSilentWhy,
} from '../../../shared/push-outbox.js';
import { NEEDED_BY_LEVELS, type NeededBy } from '../../../shared/ledgers.js';
import type { PushPayload } from '../push.js';
import { asSendVerdict } from '../pushOutbox.js';
import { operatorWasShown } from './ledgersStore.js';
import { tx } from './tx.js';

/** The payload the outbox stores: a `PushPayload` with its collapse key, so every row written with a payload has a tag,
 *  and a NULL tag means exactly one thing: the row was written with no payload (slug tag-null-without-payload). */
export type OutboxPayload = PushPayload & { readonly tag: string };

/** One `push_outbox` row as the store holds it. `payload` is NULL once the row is terminal (slug
 *  payload-nulled-when-terminal), and for a row written with no payload. `tag` is NULL only for a row written with no
 *  payload, since a payload cannot be written without one (`OutboxPayload`; slug tag-null-without-payload). */
export interface OutboxRow {
  readonly id: number; readonly pushId: string; readonly sourceKind: OutboxSource | null; readonly sourceId: number | null;
  readonly payload: OutboxPayload | null; readonly tag: string | null; readonly state: OutboxState;
  readonly createdAt: number; readonly armedAt: number; readonly claimSeq: number; readonly attempts: number;
  readonly claimedAt: number | null; readonly nextAttemptAt: number | null; readonly pushedAt: number | null;
  readonly verdict: PushSendVerdict | null; readonly silentWhy: PushSilentWhy | null; readonly settledAt: number | null;
}
/** A row this build could not read, by its id, with why. Its detail never quotes the stored text. */
export interface UnreadableRow { readonly id: number; readonly detail: string }
/** A read of rows: the rows that parse, and beside them each row that does not, so one unreadable row never blinds the
 *  drain to the others (slug one-unreadable-row-never-blinds-the-drain). A failed query is `ok: false`, never an empty
 *  list. */
export type OutboxRead =
  | { readonly ok: true; readonly rows: readonly OutboxRow[]; readonly unreadable: readonly UnreadableRow[] }
  | { readonly ok: false; readonly detail: string };

/** A held item whose hold has passed and whose reach is not stamped yet: what the held drain stamps. */
export interface HeldItemReached { readonly id: number; readonly heldUntil: number; readonly neededBy: NeededBy }
export type ItemsRead =
  | { readonly ok: true; readonly rows: readonly HeldItemReached[]; readonly unreadable: readonly UnreadableRow[] }
  | { readonly ok: false; readonly detail: string };

const PREPARED = new WeakMap<DatabaseSync, Map<string, StatementSync>>();
function stmt(db: DatabaseSync, sql: string): StatementSync {
  let byText = PREPARED.get(db);
  if (byText === undefined) { byText = new Map(); PREPARED.set(db, byText); }
  let st = byText.get(sql);
  if (st === undefined) { st = db.prepare(sql); byText.set(sql, st); }
  return st;
}
const changedOf = (res: { changes: number | bigint }): { changed: boolean } => ({ changed: Number(res.changes) > 0 });
const TERMINAL: ReadonlySet<OutboxState> = new Set(TERMINAL_OUTBOX_STATES);
const isTerminal = (s: OutboxState): boolean => TERMINAL.has(s);
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function mustMove(from: OutboxState | null, to: OutboxState, actor: OutboxActor, fn: string): void {
  if (!outboxMoveAllowed(from, to, actor)) throw new Error(`${fn}: ${actor} may not move a row ${from ?? '(new)'} -> ${to}`);
}

const COLS = 'id, pushId, sourceKind, sourceId, payload, tag, state, createdAt, armedAt, claimSeq, attempts, claimedAt, '
  + 'nextAttemptAt, pushedAt, verdict, silentWhy, settledAt';

/** JSON text parsed, or a throw that names only the column: the parser's own message can quote the stored text. */
function parsed(text: unknown, column: string): unknown {
  try { return JSON.parse(String(text)) as unknown; } catch { throw new Error(`${column} is not JSON`); }
}
function payloadOf(text: unknown): OutboxPayload {
  const p = parsed(text, 'payload') as Partial<Record<keyof OutboxPayload, unknown>> | null;
  if (typeof p !== 'object' || p === null || typeof p.title !== 'string' || typeof p.body !== 'string' || typeof p.tag !== 'string') {
    throw new Error('payload is not a tagged PushPayload');
  }
  return p as OutboxPayload;
}

/** A stored row, read back strictly: a state, source, verdict or silence word this build does not know, or a payload that
 *  does not parse or has no tag, THROWS, and the read sets that row aside as unreadable rather than folding a corrupt or
 *  newer row into a known one. The detail names the column and the word, never the stored JSON. */
function rowOf(r: Record<string, unknown>): OutboxRow {
  const state = String(r.state) as OutboxState;
  if (!OUTBOX_STATES.includes(state)) throw new Error(`state ${String(r.state)} is not known`);
  const sourceKind = r.sourceKind === null ? null : String(r.sourceKind) as OutboxSource;
  if (sourceKind !== null && !OUTBOX_SOURCES.includes(sourceKind)) throw new Error(`source ${sourceKind} is not known`);
  const verdict = r.verdict === null ? null : asSendVerdict(parsed(r.verdict, 'verdict'));
  if (r.verdict !== null && verdict === null) throw new Error('verdict is not a PushSendVerdict');
  const silentWhy = r.silentWhy === null ? null : String(r.silentWhy) as PushSilentWhy;
  if (silentWhy !== null && !PUSH_SILENT_WHYS.includes(silentWhy)) throw new Error(`silentWhy ${silentWhy} is not known`);
  const int = (v: unknown): number | null => (v === null ? null : Number(v));
  return {
    id: Number(r.id), pushId: String(r.pushId), sourceKind, sourceId: int(r.sourceId),
    payload: r.payload === null ? null : payloadOf(r.payload), tag: r.tag === null ? null : String(r.tag),
    state, createdAt: Number(r.createdAt), armedAt: Number(r.armedAt), claimSeq: Number(r.claimSeq), attempts: Number(r.attempts),
    claimedAt: int(r.claimedAt), nextAttemptAt: int(r.nextAttemptAt), pushedAt: int(r.pushedAt), verdict, silentWhy,
    settledAt: int(r.settledAt),
  };
}

/** Each raw row through `read`: the ones that parse, and the ones that throw, each logged once for this read. */
function quarantine<T>(table: string, raw: readonly Record<string, unknown>[], read: (r: Record<string, unknown>) => T):
  { readonly rows: T[]; readonly unreadable: UnreadableRow[] } {
  const rows: T[] = [];
  const unreadable: UnreadableRow[] = [];
  for (const r of raw) {
    try { rows.push(read(r)); } catch (e) {
      const bad = { id: Number(r.id), detail: message(e) };
      unreadable.push(bad);
      console.warn(`ccrc-server: ${table} row ${bad.id} is unreadable by this build and is set aside: ${bad.detail}`);
    }
  }
  return { rows, unreadable };
}

function readRows(db: DatabaseSync, sql: string, ...args: number[]): OutboxRead {
  let raw: Record<string, unknown>[];
  try {
    raw = stmt(db, sql).all(...args) as Record<string, unknown>[];
  } catch (e) {
    return { ok: false, detail: `push_outbox read failed: ${message(e)}` };
  }
  return { ok: true, ...quarantine('push_outbox', raw, rowOf) };
}

/** What a bound insert writes: a `pending` row carries its payload; a `silent` row carries its why, and its payload only
 *  for the tag (none when there was no payload to build). */
export type BoundRowWrite = { readonly source: OutboxSource; readonly sourceId: number; readonly pushId: string; readonly at: number } & (
  | { readonly state: 'pending'; readonly payload: OutboxPayload }
  | { readonly state: 'silent'; readonly silentWhy: PushSilentWhy; readonly payload: OutboxPayload | null });

/** A bound row, written by the move that raised or released its source, INSIDE that move's transaction: it opens none
 *  of its own, so a throw here rolls the move back (slug a-failed-bound-write-rolls-back). `push_outbox_one_per_source`
 *  refuses a second row for one source (I2). A terminal (`silent`) row stores no payload. Answers the row's id. */
export function insertBoundRowInTx(db: DatabaseSync, row: BoundRowWrite): number {
  mustMove(null, row.state, 'raise', 'insertBoundRowInTx');
  const silent = row.state === 'silent';
  const res = stmt(db, 'INSERT INTO push_outbox (pushId, sourceKind, sourceId, payload, tag, state, createdAt, armedAt, silentWhy, '
    + 'settledAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(row.pushId, row.source, row.sourceId,
    silent ? null : JSON.stringify(row.payload), row.payload?.tag ?? null, row.state, row.at, row.at,
    silent ? row.silentWhy : null, silent ? row.at : null);
  return Number(res.lastInsertRowid);
}

/** THE ONE WRITER of `reachedOperatorAt` (C31): a row is stamped at most once (`WHERE reachedOperatorAt IS NULL`). It
 *  opens no transaction and is called inside the move's. One literal statement per table, so the writers census sees
 *  both. */
export function stampReach(db: DatabaseSync, source: OutboxSource, id: number, at: number): { changed: boolean } {
  if (source === 'ask') {
    return changedOf(stmt(db, 'UPDATE asks SET reachedOperatorAt = ? WHERE id = ? AND reachedOperatorAt IS NULL').run(at, id));
  }
  return changedOf(stmt(db, 'UPDATE operator_items SET reachedOperatorAt = ? WHERE id = ? AND reachedOperatorAt IS NULL').run(at, id));
}

/** A bound row armed again (a toggle to blocking), inside the caller's transaction: the upsert (slug rearm-is-an-upsert).
 *  An existing row moves to `pending` from any state, keeps its push id and `claimSeq`, takes the new payload, resets
 *  `attempts` and `nextAttemptAt`, and starts the horizon again at `armedAt` (slug horizon-from-armed-at); with no row, one
 *  is inserted with the given push id. */
export function armBoundRowInTx(db: DatabaseSync, source: OutboxSource, sourceId: number, row: {
  readonly pushId: string; readonly payload: OutboxPayload; readonly at: number;
}): { inserted: boolean } {
  const held = stmt(db, 'SELECT id, state FROM push_outbox WHERE sourceKind = ? AND sourceId = ?').get(source, sourceId) as
    { id: number; state: string } | undefined;
  if (held === undefined) {
    mustMove(null, 'pending', 'arm', 'armBoundRowInTx');
    stmt(db, "INSERT INTO push_outbox (pushId, sourceKind, sourceId, payload, tag, state, createdAt, armedAt) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)")
      .run(row.pushId, source, sourceId, JSON.stringify(row.payload), row.payload.tag, row.at, row.at);
    return { inserted: true };
  }
  const from = held.state as OutboxState;
  if (!OUTBOX_STATES.includes(from)) throw new Error(`armBoundRowInTx: push_outbox ${held.id} has state ${held.state}`);
  mustMove(from, 'pending', 'arm', 'armBoundRowInTx');
  const res = stmt(db, "UPDATE push_outbox SET state = 'pending', payload = ?, tag = ?, armedAt = ?, attempts = 0, nextAttemptAt = NULL, "
    + 'claimedAt = NULL, silentWhy = NULL, settledAt = NULL WHERE id = ? AND state = ?')
    .run(JSON.stringify(row.payload), row.payload.tag, row.at, held.id, held.state);
  if (Number(res.changes) !== 1) throw new Error(`armBoundRowInTx: push_outbox ${held.id} moved under the arm`);
  return { inserted: false };
}

/** An unbound push, in its own transaction (or the caller's, when one is open: `tx` does not nest), written straight to
 *  `sending`: claimed at its insert, so a crash right after it is `unknown` at boot, as today's lost push (slug
 *  unbound-push-claimed-at-insert). A failed write answers `ok: false` with its detail, never a throw, so the caller can
 *  still send (C67). */
export function insertUnboundRow(db: DatabaseSync, row: { readonly pushId: string; readonly payload: OutboxPayload; readonly at: number }):
  { readonly ok: true; readonly id: number; readonly claimSeq: number } | { readonly ok: false; readonly detail: string } {
  try {
    mustMove(null, 'sending', 'sender', 'insertUnboundRow');
    const insert = stmt(db, 'INSERT INTO push_outbox (pushId, payload, tag, state, createdAt, armedAt, claimSeq, attempts, claimedAt) '
      + "VALUES (?, ?, ?, 'sending', ?, ?, 1, 1, ?)");
    const write = (): number => Number(insert.run(row.pushId, JSON.stringify(row.payload), row.payload.tag, row.at, row.at, row.at).lastInsertRowid);
    const id = db.isTransaction ? write() : tx(db, write);
    return { ok: true, id, claimSeq: 1 };
  } catch (e) {
    return { ok: false, detail: `push_outbox insert failed: ${message(e)}` };
  }
}

/** One attempt's claim: `pending` (whatever the clock) or a `retrying` row whose `nextAttemptAt` has come to `sending`,
 *  `attempts + 1` and `claimSeq + 1`, in one statement. A row in any other state is not claimed (a drain or a boot won
 *  it), nor a retry before its time, and either answers `changed: false` with no claim number. */
export function claimOutboxRow(db: DatabaseSync, id: number, at: number):
  { readonly changed: true; readonly claimSeq: number } | { readonly changed: false } {
  mustMove('pending', 'sending', 'sender', 'claimOutboxRow');
  mustMove('retrying', 'sending', 'sender', 'claimOutboxRow');
  const r = stmt(db, "UPDATE push_outbox SET state = 'sending', attempts = attempts + 1, claimSeq = claimSeq + 1, claimedAt = ? "
    + "WHERE id = ? AND (state = 'pending' OR (state = 'retrying' AND nextAttemptAt <= ?)) RETURNING claimSeq").get(at, id, at) as
    { claimSeq: number } | undefined;
  return r === undefined ? { changed: false } : { changed: true, claimSeq: Number(r.claimSeq) };
}

/** A bound row its source re-read settled, or `pushDue` silenced: `pending` or `retrying` to `silent`, its payload nulled. */
export function silenceOutboxRow(db: DatabaseSync, id: number, why: PushSilentWhy, at: number): { changed: boolean } {
  mustMove('pending', 'silent', 'sender', 'silenceOutboxRow');
  mustMove('retrying', 'silent', 'sender', 'silenceOutboxRow');
  return changedOf(stmt(db, "UPDATE push_outbox SET state = 'silent', silentWhy = ?, payload = NULL, settledAt = ? "
    + "WHERE id = ? AND state IN ('pending', 'retrying')").run(why, at, id));
}

/** Where one attempt's verdict moves its row: `sent` and `retrying` always carry the verdict that decided them, and a
 *  retry its time; `unsent`, `failed` and `unknown` may have none (a deadline, a dead claim). */
export type OutboxVerdictMove =
  | { readonly to: 'sent'; readonly verdict: PushSendVerdict }
  | { readonly to: 'retrying'; readonly verdict: PushSendVerdict; readonly nextAttemptAt: number }
  | { readonly to: 'unsent' | 'failed' | 'unknown'; readonly verdict: PushSendVerdict | null };

/** One attempt's verdict, landing only on the claim it answers (`claimSeq`), so a late answer from an older attempt
 *  changes nothing (slug claim-seq-ties-the-verdict). The one writer of `pushedAt`, at the first `sent` only; a terminal
 *  move nulls the payload and sets `settledAt`. */
export function markOutboxVerdict(db: DatabaseSync, id: number, claimSeq: number, move: OutboxVerdictMove, at: number): { changed: boolean } {
  const { to, verdict } = move;
  mustMove('sending', to, 'sender', 'markOutboxVerdict');
  const nextAttemptAt = move.to === 'retrying' ? move.nextAttemptAt : null;
  const terminal = isTerminal(to) ? 1 : 0;
  return changedOf(stmt(db, 'UPDATE push_outbox SET state = ?, verdict = ?, nextAttemptAt = ?, '
    + "pushedAt = CASE WHEN ? = 'sent' AND pushedAt IS NULL THEN ? ELSE pushedAt END, "
    + 'payload = CASE WHEN ? = 1 THEN NULL ELSE payload END, settledAt = CASE WHEN ? = 1 THEN ? ELSE settledAt END '
    + "WHERE id = ? AND state = 'sending' AND claimSeq = ?")
    .run(to, verdict === null ? null : JSON.stringify(verdict), nextAttemptAt, to, at, terminal, terminal, at, id, claimSeq));
}

/** The rows due now: every `pending` row, and every `retrying` row whose `nextAttemptAt` has passed, oldest first. */
export function dueOutboxRows(db: DatabaseSync, now: number): OutboxRead {
  return readRows(db, `SELECT ${COLS} FROM push_outbox WHERE state = 'pending' OR (state = 'retrying' AND nextAttemptAt <= ?) ORDER BY id`, now);
}

/** Every row that is not terminal, for the boot pass. */
export function openOutboxRows(db: DatabaseSync): OutboxRead {
  return readRows(db, `SELECT ${COLS} FROM push_outbox WHERE state IN ('pending', 'sending', 'retrying') ORDER BY id`);
}

/** The boot pass's seal: a `sending` row (an attempt a dead process claimed) to `unknown`, or a stale `pending` or
 *  `retrying` row to `failed`. */
export function sealAtBoot(db: DatabaseSync, id: number, to: 'unknown' | 'failed', at: number): { changed: boolean } {
  if (to === 'unknown') {
    mustMove('sending', 'unknown', 'boot', 'sealAtBoot');
    return changedOf(stmt(db, "UPDATE push_outbox SET state = 'unknown', payload = NULL, settledAt = ? WHERE id = ? AND state = 'sending'")
      .run(at, id));
  }
  mustMove('pending', 'failed', 'boot', 'sealAtBoot');
  mustMove('retrying', 'failed', 'boot', 'sealAtBoot');
  return changedOf(stmt(db, "UPDATE push_outbox SET state = 'failed', payload = NULL, settledAt = ? "
    + "WHERE id = ? AND state IN ('pending', 'retrying')").run(at, id));
}

/** The held items whose reach the drain stamps: `heldUntil` in `[firstBootAt, now]`, no stamp yet, and shown to the
 *  operator at `now` by the hold's one rule (`operatorWasShown`), whether still open or closed after `heldUntil` (slug
 *  item-held-until-is-a-hold). An item held from before the first boot of this build is left out (no backfill). A row
 *  whose `neededBy` this build does not know is set aside as unreadable, as the outbox reads do. */
export function heldItemsReached(db: DatabaseSync, now: number, firstBootAt: number): ItemsRead {
  let raw: { id: number; heldUntil: number; closedAt: number | null; neededBy: string }[];
  try {
    raw = stmt(db, 'SELECT id, heldUntil, closedAt, neededBy FROM operator_items WHERE heldUntil IS NOT NULL '
      + 'AND heldUntil >= ? AND heldUntil <= ? AND reachedOperatorAt IS NULL ORDER BY id').all(firstBootAt, now) as typeof raw;
  } catch (e) {
    return { ok: false, detail: `operator_items read failed: ${message(e)}` };
  }
  const read = quarantine('operator_items', raw.filter((r) => operatorWasShown(r, now)), (r): HeldItemReached => {
    const neededBy = String(r.neededBy) as NeededBy;
    if (!NEEDED_BY_LEVELS.includes(neededBy)) throw new Error(`neededBy ${neededBy} is not known`);
    return { id: Number(r.id), heldUntil: Number(r.heldUntil), neededBy };
  });
  return { ok: true, ...read };
}

/** Terminal unbound rows settled before `before` (the caller passes `now - OUTBOX_KEEP_MS`). A bound row stays: no
 *  source row is ever deleted, so it stays while its source does. */
export function purgeOutbox(db: DatabaseSync, before: number): { removed: number } {
  const states = TERMINAL_OUTBOX_STATES.map(() => '?').join(', ');
  const res = stmt(db, `DELETE FROM push_outbox WHERE sourceKind IS NULL AND state IN (${states}) AND settledAt < ?`)
    .run(...TERMINAL_OUTBOX_STATES, before);
  return { removed: Number(res.changes) };
}
