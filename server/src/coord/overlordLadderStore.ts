// The Overlord's ladder rows and their writers (Overlord spec §7.5, §7.6, H25, H27; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-ladder.md` Task 2, questions 3, 4, 11, 13, 16, 20, 21 and 22).
// Ring L3, context C5. TWO tables (migration 93): `overlord_ladder`, the operator's rung (one row, `id = 1`, none seeded: an
// absent row reads `chat`), and `overlord_latches`, one row per latch with its cause and stored cap (a cleared row stays as
// history). The only functions that write them: `setRungInTx`, `raiseLatchInTx`, `clearLatchInTx`, `journalPendingInTx` and
// `applyRestoreInTx`; the readers are `ladderRows` (the composed read's rows, fail-closed) and `ladderRungRead` (the brakes' read,
// the rung alone). Every reader narrows EVERY column and answers `unmeasured` on a value no writer writes; none throws.
//
// EACH STATE MOVE STAMPS ITS LINE (Overlord §10.4; sequence plan Task 5, slug `ladder-stamps-ride-pr-b`), through
// `stampLadderLine`, inside the same transaction, after the row: `ladder-rung` (id `operator`, the new rung) when a writer writes
// the rung row, and `ladder-latch` (id the cause, `raised` or `cleared`) when a latch row is inserted or cleared. A write that
// changes only a cap or a sequence (the catch-up, Confirm's stamps and narrowed caps) moves no state word and stamps nothing. A
// refused stamp throws, so the row rolls back with its line.
//
// THE WRITERS ARE `*InTx`: each runs INSIDE the caller's `tx()` and opens none (the store's delegates and the doors open it), so
// the journal's own transaction check (`not-in-transaction`) is the proof that nothing writes outside one.
//
// THE AUTHORITY DUTIES (the journal's "THE CALLER'S DUTIES", `overlordAuthorityJournal.ts#OverlordAuthorityJournal`): a writer
// first runs `journalPendingInTx` (question 20), reads its own row FRESH, appends its record BEFORE it writes the row, and checks
// the answer: `appended` writes the row with `record.sequence`; `row-only` is a narrowing the journal could not append: it writes
// its row with a NULL sequence (the durable marker "taking effect, not recorded"); a widening that gets `row-only` writes nothing
// and answers `authority-rolled-back` (the journal never sends it, X3b; the arm is here so a later change to the journal cannot
// widen over an unrecorded row); `{ok:false}` writes nothing and answers the journal's error, for both directions. An ordinary
// move's `from` is the row's value read in the same transaction (review 2219 F2): its word, `chat` when absent, and `full` when
// unknown (question 21). ONLY catch-up states the retained `recordFrom`: it records an already-applied narrowing and stamps its
// sequence, without changing the rung. The retained value is the last journalled origin, not a new authority decision.
//
// `off`'s one transaction, W1's part (question 9): `setRungInTx` is the one writer of a rung change and a move to `off` runs in
// it; W1's part is the rung row and its record. Each later effect of `off` joins this transaction beside the rung write, never a
// transaction of its own: holds released (W3, Table 6.7c), undelivered `overlord` mail and kickoffs cancelled (W2, the relay and
// start doors), follow-up nudges stopped (W2, §5.4), open requests moved to `needs-you` (W2, §5.1), pending acts settled by
// measuring (W2, Table 10.1b).
import type { DatabaseSync } from 'node:sqlite';
import type { AuthorityAppend, AuthorityAppendError } from './overlordAuthorityJournal.js';
import type { ActorRefused, AuthorityAppender } from './overlordDesignationStore.js';
import type { ConsoleCaller, RecordedActor } from '../auth/callerIdentity.js';
import { consoleSubject, isAccountGateOperator, isRecordedActor } from '../auth/attributionIdentity.js';
import { stampSequenceInTx, type SequenceLineInput } from './overlordSequenceStore.js';
import type { ActorKind } from '../../../shared/overlord-identity.js';
import { authorityDirection, type OverlordAuthorityMove } from './overlordAuthority.js';
import { LANE_RAISER_MAP, type CurrentRung, type LadderWriterRefusal } from './overlordLadder.js';
import {
  LADDER_CAUSE_MAP, LADDER_DEFAULT_RUNG, isLadderCauseKey, isRung, rungRank,
  type LadderNotice, type Rung,
} from '../../../shared/overlord-ladder.js';

export type { AuthorityAppender };

export interface LadderRow {
  readonly operatorRung: Rung; readonly actor: string; readonly updatedAt: number;
  readonly recordSequence: number | null; readonly journalled: boolean; readonly narrowedAt: number | null;
}
export interface LatchRow {
  readonly id: number; readonly cause: string; readonly cap: Rung; readonly detail: string; readonly raisedAt: number;
  readonly raisedBy: string; readonly raiseSequence: number | null; readonly journalled: boolean;
}
/** The composed read's rows: fail-closed on any row it cannot narrow (question 17). `rung: null` is no row. */
export type LadderRowsRead =
  | { readonly kind: 'measured'; readonly rung: LadderRow | null; readonly standing: readonly LatchRow[] }
  | { readonly kind: 'unmeasured'; readonly why: string };
/** The brakes' read (question 21): the rung row alone. An unknown word is `unreadable`, never `unmeasured`. */
export type LadderRungRead =
  | { readonly kind: 'current'; readonly current: CurrentRung } | { readonly kind: 'unmeasured'; readonly why: string };

export type LadderWrite =
  | { readonly ok: true; readonly changed: false }
  | { readonly ok: true; readonly changed: true; readonly journalled: boolean; readonly recordSequence: number | null }
  | { readonly ok: false; readonly error: AuthorityAppendError | LadderWriterRefusal }
  | ActorRefused;

/** The server's own lanes that raise a latch (Table 7.5a's "raised by", for a row a lane raises). A lane is no caller: it has
 *  no strength, so it is never an `ActorWire`, and it only ever brakes (renewal readings PR C, slug
 *  lane-raises-the-latch-as-a-lane). Only `laneRaiser` makes one, frozen and remembered, so a structurally equal literal is
 *  refused as a copy of a minted actor is. The row records the lane's name in `raisedBy`. The names are the ladder's
 *  vocabulary (`overlordLadder.ts#LANE_RAISER_MAP`). */
export type LaneRaiserName = keyof typeof LANE_RAISER_MAP;
export interface LaneRaiser { readonly kind: 'lane'; readonly lane: LaneRaiserName }
const LANE_RAISERS = new WeakSet<object>();
export function laneRaiser(lane: LaneRaiserName): LaneRaiser {
  if (!Object.hasOwn(LANE_RAISER_MAP, lane)) throw new Error('laneRaiser: not a lane that raises a latch');
  const r: LaneRaiser = Object.freeze({ kind: 'lane', lane });
  LANE_RAISERS.add(r);
  return r;
}
const isLaneRaiser = (a: unknown): a is LaneRaiser => typeof a === 'object' && a !== null && LANE_RAISERS.has(a);

export type BrakeActor = RecordedActor | ConsoleCaller | LaneRaiser;
export interface RungMoveInput { from: Rung; to: Rung; actor: BrakeActor; at: number; opKey: string }
export interface LatchRaiseInput { cause: string; cap: Rung; detail: string; raisedBy: BrakeActor; at: number; opKey: string }
export interface LatchClearInput { cause: string; actor: RecordedActor; at: number; opKey: string }

/** One actor validation owner for both the pre-transaction and the in-transaction checks.
 * Brakes accept a minted actor or the console's full result; widening requires the account gate. */
export function ladderActor(actor: unknown, direction: 'brake' | 'widen'): { ok: true; subject: string } | ActorRefused {
  if (direction === 'widen') {
    return isAccountGateOperator(actor) ? { ok: true, subject: actor.subject } : { ok: false, reason: 'actor' };
  }
  if (isRecordedActor(actor)) return { ok: true, subject: actor.subject };
  if (isLaneRaiser(actor)) return { ok: true, subject: actor.lane };
  // A brake takes the console's answer through its one mapping (`consoleSubject`, gates B): an answer the port did not make,
  // or a kind it does not know, refuses.
  const subject = consoleSubject(actor);
  return subject === null ? { ok: false, reason: 'actor' } : { ok: true, subject };
}
/** The kind of a ladder writer's actor, taken from the actor the writer already accepted: a minted actor's own kind, the console's
 *  signed-in actor's kind, `operator` for the console's dark and unmeasured answers (the console is the operator's), and `server`
 *  for a lane. Plan question 6 takes a line's kind from the row being written; the ladder's rows have no kind column, so the kind
 *  is the writer's input actor's and exists only on the line (a departure, slug `ladder-line-kind-from-the-writers-actor`; every
 *  latch raise is the server's, `latch-lines-are-the-servers`, call 1220). */
export function ladderActorKind(actor: BrakeActor): ActorKind {
  if (isRecordedActor(actor)) return actor.kind;
  if (isLaneRaiser(actor)) return 'server';
  return actor.kind === 'signed-in' && isRecordedActor(actor.actor) ? actor.actor.kind : 'operator';
}

/** A ladder line that could not be stamped, thrown inside the writer's transaction so the row rolls back with it. */
export class LadderStampRefused extends Error {}
/** The ladder's one call of the sequence writer: the answer read, a refusal thrown. */
function stampLadderLine(db: DatabaseSync, line: SequenceLineInput): void {
  const s = stampSequenceInTx(db, line);
  if (!s.ok) throw new LadderStampRefused(`ladder line refused: ${s.error}: ${s.detail}`);
}
const RUNG_LINE_ID = 'operator';
/** Confirm the restore's actor, the same text its rows record. */
const RESTORE_ACTOR = 'restore';

export interface StricterLadder { operatorRung: Rung; latches: readonly { cause: string; cap: Rung }[] }

export function rungActorBefore(move: RungMoveInput): { ok: true; subject: string } | ActorRefused {
  const direction = isRung(move.from) && isRung(move.to) && rungRank(move.to) > rungRank(move.from) ? 'widen' : 'brake';
  return ladderActor(move.actor, direction);
}

type Raw = Record<string, unknown>;
const isSafeInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isNullOrInt = (v: unknown): v is number | null => v === null || isSafeInt(v);

// SQLite integers can exceed JavaScript's safe range. Preserve those as bigint so narrowing rejects them,
// rather than letting the driver's default decoder throw before a brake can skip an invalid row.
function safeIntegers(row: Raw): Raw {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    typeof value === 'bigint' && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value) : value]));
}

const RUNG_SQL = 'SELECT operatorRung, actor, updatedAt, recordSequence, recordFrom, narrowedAt FROM overlord_ladder WHERE id = 1';
const STANDING_SQL = `SELECT id, cause, cap, detail, raisedAt, raisedBy, raiseSequence, clearedAt, clearedBy, clearSequence
  FROM overlord_latches WHERE clearedAt IS NULL ORDER BY id`;

/** The rung row narrowed, or why it cannot be. The one narrowing of this row, read by the reader. */
function narrowRung(r: Raw): LadderRow | string {
  if (!isRung(r['operatorRung'])) return 'the operator\'s rung is not a rung word';
  if (typeof r['actor'] !== 'string') return 'the rung row\'s actor is not text';
  if (!isSafeInt(r['updatedAt'])) return 'the rung row\'s updatedAt is not an integer';
  if (!isNullOrInt(r['recordSequence'])) return 'the rung row\'s recordSequence is not an integer';
  if (!(r['recordFrom'] === null || isRung(r['recordFrom']))) return 'the rung row\'s recordFrom is not a rung word';
  if (!isNullOrInt(r['narrowedAt'])) return 'the rung row\'s narrowedAt is not an integer';
  return {
    operatorRung: r['operatorRung'], actor: r['actor'], updatedAt: r['updatedAt'], recordSequence: r['recordSequence'],
    journalled: r['recordSequence'] !== null, narrowedAt: r['narrowedAt'],
  };
}

/** A standing latch row narrowed, or why it cannot be. */
function narrowLatch(r: Raw): LatchRow | string {
  if (!isSafeInt(r['id'])) return 'a latch row\'s id is not an integer';
  if (!isLadderCauseKey(r['cause'])) return 'a latch row\'s cause is not a cause key';
  if (!isRung(r['cap'])) return `the latch ${r['cause']}'s cap is not a rung word`;
  if (typeof r['detail'] !== 'string') return 'a latch row\'s detail is not text';
  if (!isSafeInt(r['raisedAt'])) return 'a latch row\'s raisedAt is not an integer';
  if (typeof r['raisedBy'] !== 'string') return 'a latch row\'s raisedBy is not text';
  if (!isNullOrInt(r['raiseSequence'])) return 'a latch row\'s raiseSequence is not an integer';
  if (r['clearedAt'] !== null || r['clearedBy'] !== null || r['clearSequence'] !== null) return 'a standing latch row carries a clear';
  return {
    id: r['id'], cause: r['cause'], cap: r['cap'], detail: r['detail'], raisedAt: r['raisedAt'], raisedBy: r['raisedBy'],
    raiseSequence: r['raiseSequence'], journalled: r['raiseSequence'] !== null,
  };
}

const whyOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The composed read's rows (question 17): the rung row and the standing latches, every column narrowed; a bad value or a throw is
 *  `unmeasured`, never a partial read and never the default. */
export function ladderRows(db: DatabaseSync): LadderRowsRead {
  try {
    const raw = db.prepare(RUNG_SQL).get() as Raw | undefined;
    let rung: LadderRow | null = null;
    if (raw !== undefined) {
      const n = narrowRung(raw);
      if (typeof n === 'string') return { kind: 'unmeasured', why: n };
      rung = n;
    }
    const standing: LatchRow[] = [];
    for (const r of db.prepare(STANDING_SQL).all() as Raw[]) {
      const n = narrowLatch(r);
      if (typeof n === 'string') return { kind: 'unmeasured', why: n };
      standing.push(n);
    }
    return { kind: 'measured', rung, standing };
  } catch (err) {
    return { kind: 'unmeasured', why: whyOf(err) };
  }
}

/** The brakes' read (question 21): the rung word alone. No row is the default, a rung word is a rung, any other value is
 *  `unreadable` (a newer build's word), and only a database that cannot be read is `unmeasured`. */
export function ladderRungRead(db: DatabaseSync): LadderRungRead {
  try {
    const raw = db.prepare('SELECT operatorRung FROM overlord_ladder WHERE id = 1').get() as Raw | undefined;
    if (raw === undefined) return { kind: 'current', current: { kind: 'default' } };
    const word = raw['operatorRung'];
    return { kind: 'current', current: isRung(word) ? { kind: 'rung', rung: word } : { kind: 'unreadable' } };
  } catch (err) {
    return { kind: 'unmeasured', why: whyOf(err) };
  }
}

/** The rung row as a writer builds on it, inside its transaction: the raw columns, unnarrowed. */
interface HeldRung { operatorRung: unknown; recordSequence: unknown; recordFrom: unknown }
function heldRung(db: DatabaseSync): HeldRung | null {
  const statement = db.prepare('SELECT operatorRung, recordSequence, recordFrom FROM overlord_ladder WHERE id = 1');
  statement.setReadBigInts(true);
  const r = statement.get() as Raw | undefined;
  if (r === undefined) return null;
  const row = safeIntegers(r);
  return { operatorRung: row['operatorRung'], recordSequence: row['recordSequence'], recordFrom: row['recordFrom'] };
}

const narrows = (entry: OverlordAuthorityMove): boolean => authorityDirection(entry) === 'narrows';

// ── journalPendingInTx ────────────────────────────────────────────────────────────────────────────────────────────────

/** Question 20: inside a writer's `tx()`, appends a record for the rung row and each standing latch whose sequence is NULL, and
 *  stamps each one `appended`; any other answer leaves the row for the next write. All records of the act share its original
 *  opKey; the journal validates it but never deduplicates on it. A row whose stored word cannot be read is skipped, never thrown
 *  on. Called first by every writer; never on its own. */
export function journalPendingInTx(db: DatabaseSync, journal: AuthorityAppender, opKey: string): void {
  const rung = heldRung(db);
  if (rung !== null && rung.recordSequence === null && isRung(rung.operatorRung) && isRung(rung.recordFrom)) {
    const a: AuthorityAppend = journal.appendInTx(db, {
      kind: 'authority-rung', opKey, from: rung.recordFrom, to: rung.operatorRung,
    });
    if (a.ok && a.kind === 'appended') {
      db.prepare('UPDATE overlord_ladder SET recordSequence = ?, recordFrom = NULL WHERE id = 1 AND recordSequence IS NULL')
        .run(a.record.sequence);
    }
  }
  const standing = db.prepare(STANDING_SQL);
  standing.setReadBigInts(true);
  for (const raw of standing.all() as Raw[]) {
    const l = narrowLatch(safeIntegers(raw));
    if (typeof l === 'string' || l.raiseSequence !== null) continue;
    const a = journal.appendInTx(db, { kind: 'authority-latch-raise', opKey, cause: l.cause, cap: l.cap });
    if (a.ok && a.kind === 'appended') {
      db.prepare('UPDATE overlord_latches SET raiseSequence = ? WHERE id = ? AND raiseSequence IS NULL').run(a.record.sequence, l.id);
    }
  }
}

// ── setRungInTx ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The operator's doors' writer of `operatorRung` (and, with `applyRestoreInTx`, its only one). In the caller's tx:
 *  `journalPendingInTx`, then re-reads the rung, appends `authority-rung {from, to}`, and reacts to the answer (question 3).
 *  Writes nothing (answers `changed: false`) when the row already holds `to`; over an absent row `chat` is the rung held. */
export function setRungInTx(db: DatabaseSync, journal: AuthorityAppender, move: RungMoveInput): LadderWrite {
  if (!isRung(move.to)) return { ok: false, error: 'bad-entry' };
  const before = heldRung(db);
  const wordBefore = before === null ? LADDER_DEFAULT_RUNG : before.operatorRung;
  // An unknown word normalizes to full for the journal, but may only be braked to off.
  if (!isRung(wordBefore) && move.to !== 'off') return { ok: false, error: 'row-changed' };
  const origin = isRung(wordBefore) ? wordBefore : 'full';
  if (origin !== move.from) return { ok: false, error: 'row-changed' };
  const actor = ladderActor(move.actor, rungRank(move.to) > rungRank(origin) ? 'widen' : 'brake');
  if (!actor.ok) return actor;
  journalPendingInTx(db, journal, move.opKey);
  const held = heldRung(db);
  const word = held === null ? LADDER_DEFAULT_RUNG : held.operatorRung;
  if (isRung(word) && word === move.to) return { ok: true, changed: false };
  const from: Rung = isRung(word) ? word : 'full';
  const entry: OverlordAuthorityMove = { kind: 'authority-rung', opKey: move.opKey, from, to: move.to };
  const narrowing = narrows(entry);
  const a = journal.appendInTx(db, entry);
  if (!a.ok) return { ok: false, error: a.error };
  let sequence: number | null;
  if (a.kind === 'appended') sequence = a.record.sequence;
  else if (narrowing) sequence = null;
  else return { ok: false, error: 'authority-rolled-back' };
  // A row still unjournalled keeps the rung its FIRST unjournalled change moved from (question 20).
  const recordFrom = sequence !== null ? null : held !== null && held.recordSequence === null
    && (held.recordFrom === null || typeof held.recordFrom === 'string') ? held.recordFrom : from;
  db.prepare(`INSERT INTO overlord_ladder (id, operatorRung, actor, updatedAt, recordSequence, recordFrom, narrowedAt)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET operatorRung = excluded.operatorRung, actor = excluded.actor, updatedAt = excluded.updatedAt,
      recordSequence = excluded.recordSequence, recordFrom = excluded.recordFrom, narrowedAt = excluded.narrowedAt`)
    .run(move.to, actor.subject, move.at, sequence, recordFrom, narrowing ? move.at : null);
  stampLadderLine(db, { kind: 'ladder-rung', id: RUNG_LINE_ID, state: move.to, actor: actor.subject, actorKind: ladderActorKind(move.actor), at: move.at });
  return { ok: true, changed: true, journalled: sequence !== null, recordSequence: sequence };
}

// ── raiseLatchInTx ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The server's raise of a latch, a narrowing. A cause that is not a cause key or a cap that is not a rung answers `bad-entry`
 *  with nothing appended or written. A standing latch of the cause answers `changed: false` (a second raise never moves the
 *  stored cap). Echoes the cause table's notice for its raiser (`none` for a cause this build does not know). */
export function raiseLatchInTx(db: DatabaseSync, journal: AuthorityAppender, latch: LatchRaiseInput): LadderWrite & { notice?: LadderNotice } {
  const actor = ladderActor(latch.raisedBy, 'brake');
  if (!actor.ok) return actor;
  if (!isLadderCauseKey(latch.cause) || !isRung(latch.cap)) return { ok: false, error: 'bad-entry' };
  journalPendingInTx(db, journal, latch.opKey);
  const standing = db.prepare('SELECT 1 AS one FROM overlord_latches WHERE cause = ? AND clearedAt IS NULL').get(latch.cause);
  if (standing !== undefined) return { ok: true, changed: false };
  const entry: OverlordAuthorityMove = { kind: 'authority-latch-raise', opKey: latch.opKey, cause: latch.cause, cap: latch.cap };
  const a = journal.appendInTx(db, entry);
  if (!a.ok) return { ok: false, error: a.error };
  // The journal does not send row-only for a widening; refuse if a future change ever does.
  if (a.kind === 'row-only' && !narrows(entry)) return { ok: false, error: 'authority-rolled-back' };
  const sequence = a.kind === 'appended' ? a.record.sequence : null;
  db.prepare(`INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy, raiseSequence) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(latch.cause, latch.cap, latch.detail, latch.at, actor.subject, sequence);
  // The server's kind for every raise, whoever tripped it (call 1220, slug `latch-lines-are-the-servers`): a check raises a latch,
  // never a session's ask, so the term check never reads one as a session's act. The row keeps its raiser; so does the line's text.
  stampLadderLine(db, { kind: 'ladder-latch', id: latch.cause, state: 'raised', actor: actor.subject, actorKind: 'server', at: latch.at });
  const notice = Object.hasOwn(LADDER_CAUSE_MAP, latch.cause) ? LADDER_CAUSE_MAP[latch.cause as keyof typeof LADDER_CAUSE_MAP].notice : 'none';
  return { ok: true, changed: true, journalled: sequence !== null, recordSequence: sequence, notice };
}

// ── clearLatchInTx ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The operator's clear of one cause, a widening: no row is written unless the record is `appended`. No standing row answers
 *  `changed: false` and appends nothing. */
export function clearLatchInTx(db: DatabaseSync, journal: AuthorityAppender, clear: LatchClearInput): LadderWrite {
  const actor = ladderActor(clear.actor, 'widen');
  if (!actor.ok) return actor;
  journalPendingInTx(db, journal, clear.opKey);
  const standing = db.prepare('SELECT id FROM overlord_latches WHERE cause = ? AND clearedAt IS NULL').get(clear.cause) as
    { id: number } | undefined;
  if (standing === undefined) return { ok: true, changed: false };
  const a = journal.appendInTx(db, { kind: 'authority-latch-clear', opKey: clear.opKey, cause: clear.cause });
  if (!a.ok) return { ok: false, error: a.error };
  if (a.kind !== 'appended') return { ok: false, error: 'authority-rolled-back' };
  db.prepare('UPDATE overlord_latches SET clearedAt = ?, clearedBy = ?, clearSequence = ? WHERE id = ? AND clearedAt IS NULL')
    .run(clear.at, actor.subject, a.record.sequence, standing.id);
  stampLadderLine(db, { kind: 'ladder-latch', id: clear.cause, state: 'cleared', actor: actor.subject, actorKind: ladderActorKind(clear.actor), at: clear.at });
  return { ok: true, changed: true, journalled: true, recordSequence: a.record.sequence };
}

// ── applyRestoreInTx ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Confirm the restore's writer (authority journal C), called in Confirm's transaction AFTER `appendConfirmInTx`, with the
 *  sequence it answered (question 22). Writes the stricter rung (and stamps a row-only one), inserts each journal-only latch with
 *  its cap and `raisedBy: 'restore'`, narrows an existing latch when the Confirm record's cap is stricter, stamping that change,
 *  stamps every standing latch whose `raiseSequence` is NULL, keeps a standing latch the stricter side lacks, leaves an unchanged
 *  already-journalled row with its own sequence, and appends nothing. It may throw on a database
 *  error: the caller's transaction rolls back. */
export function applyRestoreInTx(db: DatabaseSync, stricter: StricterLadder, confirmSequence: number, at: number): void {
  const held = heldRung(db);
  const was = held === null ? LADDER_DEFAULT_RUNG : held.operatorRung;
  const selected = held !== null && isRung(was) && rungRank(was) < rungRank(stricter.operatorRung) ? was : stricter.operatorRung;
  const same = held !== null && was === selected;
  if (held === null || !same) {
    const down = !isRung(was) || rungRank(selected) < rungRank(was);
    db.prepare(`INSERT INTO overlord_ladder (id, operatorRung, actor, updatedAt, recordSequence, recordFrom, narrowedAt)
      VALUES (1, ?, 'restore', ?, ?, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET operatorRung = excluded.operatorRung, actor = excluded.actor, updatedAt = excluded.updatedAt,
        recordSequence = excluded.recordSequence, recordFrom = NULL, narrowedAt = excluded.narrowedAt`)
      .run(selected, at, confirmSequence, down ? at : null);
    stampLadderLine(db, { kind: 'ladder-rung', id: RUNG_LINE_ID, state: selected, actor: RESTORE_ACTOR, actorKind: 'server', at });
  } else if (held.recordSequence === null) {
    db.prepare("UPDATE overlord_ladder SET actor = 'restore', updatedAt = ?, recordSequence = ?, recordFrom = NULL WHERE id = 1 AND recordSequence IS NULL")
      .run(at, confirmSequence);
  }
  for (const l of stricter.latches) {
    if (!isLadderCauseKey(l.cause) || !isRung(l.cap)) throw new Error('invalid restored latch');
    const has = db.prepare('SELECT id, cap FROM overlord_latches WHERE cause = ? AND clearedAt IS NULL').get(l.cause) as
      { id: number; cap: unknown } | undefined;
    if (has !== undefined) {
      if (!isRung(has.cap)) throw new Error('invalid stored latch cap');
      if (rungRank(l.cap) < rungRank(has.cap)) {
        db.prepare('UPDATE overlord_latches SET cap = ?, raiseSequence = ? WHERE id = ? AND clearedAt IS NULL')
          .run(l.cap, confirmSequence, has.id);
      }
      continue;
    }
    db.prepare(`INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy, raiseSequence) VALUES (?, ?, ?, ?, 'restore', ?)`)
      .run(l.cause, l.cap, 'restored by Confirm the restore', at, confirmSequence);
    stampLadderLine(db, { kind: 'ladder-latch', id: l.cause, state: 'raised', actor: RESTORE_ACTOR, actorKind: 'server', at });
  }
  db.prepare('UPDATE overlord_latches SET raiseSequence = ? WHERE clearedAt IS NULL AND raiseSequence IS NULL').run(confirmSequence);
}

// ── latchLastClearedAt ────────────────────────────────────────────────────────────────────────────────────────────────

/** The operator's newest clear of one cause (the newest `clearedAt` among its cleared rows): `at: null` is a measured "never
 *  cleared"; a database that cannot be read is `unmeasured`, never `null`. Door process B's unwitnessed latch counts from it. */
export type LatchClearedRead = { readonly kind: 'measured'; readonly at: number | null } | { readonly kind: 'unmeasured'; readonly why: string };
export function latchLastClearedAt(db: DatabaseSync, cause: string): LatchClearedRead {
  try {
    const row = db.prepare('SELECT MAX(clearedAt) AS at FROM overlord_latches WHERE cause = ? AND clearedAt IS NOT NULL').get(cause) as { at: number | bigint | null };
    if (row.at !== null && (typeof row.at !== 'number' || !Number.isSafeInteger(row.at))) return { kind: 'unmeasured', why: 'a clear time that is not a safe integer' };
    return { kind: 'measured', at: row.at };
  } catch (err) {
    return { kind: 'unmeasured', why: whyOf(err) };
  }
}
