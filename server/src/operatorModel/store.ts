// `OperatorModelStore`: the one owner of the private store's SQL. Ring L3, context C11 (Overlord W1 private store plan, Tasks 2
// and 3; spec §3.8 H7, H10, §9.1 C29): it holds the database handle and binds the privacy journal's file. Every method is synchronous, never awaits, and catches nothing it cannot name.
//
// ONE WRITER PER FACT (`single-definition/writers-map.test.ts`, the private store's describe):
// - `operator_messages` rows are inserted only by `recordMessage`, and their state and stamps change only through
//   `moveMessage`, which asks `messageMove` (L1) first and refuses what it refuses;
// - read-ledger lines are written only by `recordRead`;
// - the private-name list (`private_name_list`, `private_name_entries`) is written only by `replacePrivateNames`;
// - the privacy journal is appended only through the issuer `recordMessage` calls inside its transaction (and, from
//   Task 3, by the store's open, which re-anchors it).
// No transaction spans `coord.db` and this file: a caller that also writes `coord.db` commits here first.
import type { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { isRecordedActor } from '../auth/attributionIdentity.js';
import type { RecordedActor } from '../auth/callerIdentity.js';
import { tx } from '../coord/tx.js';
import {
  MESSAGE_STATES, READ_OUTCOME_MAX_CHARS, READ_SCOPE_MAX_CHARS, isGenerationRead, isMessageState, isReadCaller, isReadDoor,
  isReadTurnState, isSettledBy,
  type MessageActor, type MessageEvent, type MessageState, type OperatorMessageRow, type ReadCaller, type ReadDoor, type ReadLine,
} from '../../../shared/operatorMessages.js';
import { capMessageText, messageMove, nextMessageId } from './messages.js';
import { READ_CEILING_OUTCOME, READ_SERVED_OUTCOME } from '../../../shared/overlordInbox.js';
import type { CeilingCount, MessageFacts } from '../coord/overlordInbox.js';
import { isNameListMode, type NameListMode } from '../../../shared/privateNames.js';
import { chainedTailHealPlan, type ChainedTail } from '../chainedJournal.js';
import { chainedJournalFileAt, type ChainedFileSeen, type ChainedJournalFile } from '../chainedJournalFile.js';
import { openOperatorModelDb } from './db.js';
import {
  PRIVACY_JOURNAL_BASENAME, PRIVACY_JOURNAL_FORMAT, PRIVACY_JOURNAL_TORN_DIR, privacyCoherence, privacyHighestId,
  type PrivacyCoherence, type PrivacyJournalEntry, type PrivacyJournalSeen,
} from './privacyJournal.js';

/** Why a write was refused, in one word: a move or a value the rules refuse, SQLite's own failure, the privacy journal
 *  that could not take the record or could not be read, or a store whose handle is not open. */
export type StoreWriteError = 'refused' | 'write-failed' | 'journal-unwritable' | 'journal-unreadable' | 'not-open';
export type StoreWrite<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: StoreWriteError; readonly detail: string };
/** A read: measured, or unmeasured with a reason. Absence, where it is a fact, is a measured value of its own. */
export type StoreRead<T> = { readonly kind: 'measured'; readonly value: T } | { readonly kind: 'unmeasured'; readonly why: string };

/** The privacy journal's answer to one issue: the id it recorded, or why it could not. */
export type PrivacyIssue =
  | { readonly ok: true; readonly id: number }
  | { readonly ok: false; readonly error: 'journal-unwritable' | 'journal-unreadable'; readonly detail: string };
/** The privacy journal as the store uses it: an issuer of message ids that appends the issued record and answers the id
 *  from the same verified read, or the refusal its open read. Task 3 binds the real journal; a test hands a double. */
export type PrivacyIssuer =
  | { readonly kind: 'ready'; issue(storeHighest: number | null, at: number): PrivacyIssue; head?(): StoreRead<PrivacyJournalHead>;
    /** The digest of the record at a sequence (`null`: none there), for the witness's heads check. */
    digestAt?(sequence: number): StoreRead<string | null> }
  | { readonly kind: 'refused'; readonly code: string; readonly detail: string };
/** The privacy journal's head, for authority journal B's witness epoch: the last record's digest and sequence, and the
 *  highest message id the journal names. `empty` when it holds no record. */
export type PrivacyJournalHead =
  | { readonly digest: string; readonly sequence: number; readonly highestId: number | null }
  | 'empty';

/** One message to record, as the route's act states it. */
export interface MessageRecordInput {
  readonly at: number;
  readonly sessionId: string;
  readonly term: number;
  /** The account gate's pass through the identity port (`identity.operator`); the row stores its `subject` (slug
   *  `message-actor-stores-the-subject`, the table's one `actor TEXT` column). */
  readonly actor: RecordedActor;
  /** Masked by the route's act; capped here. */
  readonly text: string;
  /** The settlement mark (`settlementMarkOf`): the row is recorded `settled` by `mark`. */
  readonly mark: boolean;
  /** The console's send key for one composed message, or null (open question 17). Not named `sendKey` in code: that is one of
   *  the pane typers' names, which `single-definition/injected-prompts.test.ts` reserves (slug `send-key-field-is-composed-key`). */
  readonly composedKey: string | null;
}
export interface MessageRecorded {
  readonly id: number;
  readonly cut: boolean;
  readonly state: MessageState | 'unknown';
  /** True when the send key named a message this session already recorded: that record is answered, and nothing is
   *  written. */
  readonly replay: boolean;
}

/** One entry of the uploaded name list as the store holds it: the shape `entryOf` makes (`shared/private-names.mjs`), keyed
 *  hashes and a token count, never a name. */
export interface NameListEntryRow { readonly h: string; readonly f: string; readonly n: number; readonly mode: NameListMode }
/** The name list as the store holds it: never uploaded, or the list with its time, its rows, its generation and its entries. */
export type PrivateNamesRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'list'; readonly uploadedAt: number; readonly rows: number; readonly generation: number; readonly entries: readonly NameListEntryRow[] };
const HASH32 = /^[0-9a-f]{32}$/;
const isEntryRow = (e: NameListEntryRow): boolean => typeof e === 'object' && e !== null && typeof e.h === 'string' && HASH32.test(e.h)
  && typeof e.f === 'string' && HASH32.test(e.f) && Number.isSafeInteger(e.n) && e.n >= 1 && isNameListMode(e.mode);

/** The column list every row read names: `SELECT *` is banned, so an unknown column a later build adds is ignored. */
const ROW_COLUMNS = 'id, at, term, state, text, cut, sha256, queuedAt, deliveredAt, pickedUpAt, settledAt, settledBy, spentAt';
interface RawRow {
  id: number; at: number; term: number; state: string; text: string; cut: number; sha256: string;
  queuedAt: number | null; deliveredAt: number | null; pickedUpAt: number | null;
  settledAt: number | null; settledBy: string | null; spentAt: number | null;
}
/** A row as a reader answers it: an unknown state or settlement word is revived as `unknown`, never thrown. */
const revive = (r: RawRow): OperatorMessageRow => ({
  id: r.id, at: r.at, term: r.term, state: isMessageState(r.state) ? r.state : 'unknown', text: r.text, cut: r.cut === 1,
  sha256: r.sha256, queuedAt: r.queuedAt, deliveredAt: r.deliveredAt, pickedUpAt: r.pickedUpAt, settledAt: r.settledAt,
  settledBy: r.settledBy === null ? null : isSettledBy(r.settledBy) ? r.settledBy : 'unknown', spentAt: r.spentAt,
});

/** The facts readers' columns: the ones the inbox needs, never `text` or `sha256` (the inbox plan, question 20). */
const FACT_COLUMNS = 'id, at, term, state, cut';
interface RawFacts { id: number; at: number; term: number; state: string; cut: number }
const factsOf = (r: RawFacts): MessageFacts => ({ id: r.id, at: r.at, term: r.term, state: isMessageState(r.state) ? r.state : 'unknown', cut: r.cut === 1 });

/** Every state before `settled`, in the vocabulary's order: what the card and the inbox list as unsettled. */
const UNSETTLED_STATES = MESSAGE_STATES.slice(0, MESSAGE_STATES.indexOf('settled'));
const UNSETTLED_SQL = UNSETTLED_STATES.map((s) => `'${s}'`).join(', ');
/** The states from `settled` on: every row NOT in one of them is unsettled to the inbox, a state this build does not know included
 *  (review 3389 F5). */
const SETTLED_SQL = MESSAGE_STATES.slice(MESSAGE_STATES.indexOf('settled')).map((s) => `'${s}'`).join(', ');

const OUTCOME_WORD = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Thrown inside a transaction to roll it back with a named answer. Never escapes the store. */
class StoreStop extends Error {
  constructor(readonly answer: { error: StoreWriteError; detail: string }) { super(answer.detail); }
}

/** An independently held lower bound on id issuance; absent or unmeasured contributes no id. */
export interface WitnessedMessageIds {
  witnessHighestIds(): { message: number | null } | 'unmeasured';
}

export class OperatorModelStore {
  constructor(private readonly db: DatabaseSync, private readonly privacy: PrivacyIssuer, private readonly witnessedIds?: WitnessedMessageIds) {}

  /** Records one message: its text capped, its id issued by the privacy journal inside this transaction, before the
   *  row. A send key this session already recorded answers that record (`replay`), and writes nothing; the same key with
   *  other text refuses `send-key-reused`. */
  recordMessage(m: MessageRecordInput): StoreWrite<MessageRecorded> {
    if (!isRecordedActor(m.actor)) return { ok: false, error: 'refused', detail: 'actor: not one the identity port minted' };
    if (typeof m.sessionId !== 'string' || !m.sessionId) return { ok: false, error: 'refused', detail: 'sessionId: empty' };
    if (!isCount(m.term)) return { ok: false, error: 'refused', detail: 'term: not a non-negative safe integer' };
    if (!isCount(m.at)) return { ok: false, error: 'refused', detail: 'at: not a non-negative safe integer' };
    if (!this.db.isOpen) return { ok: false, error: 'not-open', detail: 'the private store is not open' };
    const capped = capMessageText(m.text);
    try {
      return tx(this.db, (): StoreWrite<MessageRecorded> => {
        if (m.composedKey !== null) {
          const prior = this.db.prepare('SELECT id, cut, state, sha256 FROM operator_messages WHERE sessionId = ? AND sendKey = ?')
            .get(m.sessionId, m.composedKey) as { id: number; cut: number; state: string; sha256: string } | undefined;
          if (prior !== undefined) {
            if (prior.sha256 !== capped.sha256) throw new StoreStop({ error: 'refused', detail: 'send-key-reused' });
            return { ok: true, value: { id: prior.id, cut: prior.cut === 1, state: isMessageState(prior.state) ? prior.state : 'unknown', replay: true } };
          }
        }
        if (this.privacy.kind === 'refused') {
          throw new StoreStop({ error: 'journal-unreadable', detail: `${this.privacy.code}: ${this.privacy.detail}` });
        }
        if (!this.db.isTransaction) throw new Error('OperatorModelStore: the privacy record must be appended inside the insert\'s transaction');
        const highest = (this.db.prepare('SELECT max(id) AS m FROM operator_messages').get() as { m: number | null }).m;
        const witnessed = this.witnessedIds?.witnessHighestIds();
        const floor = witnessed === undefined || witnessed === 'unmeasured' || witnessed.message === null
          ? highest : Math.max(highest ?? 0, witnessed.message);
        const issued = this.privacy.issue(floor, m.at);
        if (!issued.ok) throw new StoreStop({ error: issued.error, detail: issued.detail });
        const state: MessageState = m.mark ? 'settled' : 'recorded';
        this.db.prepare(
          'INSERT INTO operator_messages (id, at, sessionId, term, actor, sha256, sendKey, text, cut, state, settledAt, settledBy) '
          + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(issued.id, m.at, m.sessionId, m.term, m.actor.subject, capped.sha256, m.composedKey, capped.text, capped.cut ? 1 : 0,
          state, m.mark ? m.at : null, m.mark ? 'mark' : null);
        return { ok: true, value: { id: issued.id, cut: capped.cut, state, replay: false } };
      });
    } catch (err) {
      if (err instanceof StoreStop) return { ok: false, ...err.answer };
      return { ok: false, error: 'write-failed', detail: message(err) };
    }
  }

  /** The one writer of a message's state and stamps: asks `messageMove`, and writes the next state, the event's stamp
   *  when it is null, and the settlement pair, in one statement. A refused move changes nothing and says why; an absent
   *  id is refused. `changed` is false when the move was accepted and wrote no new value; `from` is the state it moved from, so a
   *  caller can tell a moved state word from a stamp (the sequence's message line, `messageLine.ts`). */
  moveMessage(id: number, event: MessageEvent, actor: MessageActor, at: number):
    StoreWrite<{ readonly changed: boolean; readonly state: MessageState; readonly from: MessageState }> {
    if (!isCount(at)) return { ok: false, error: 'refused', detail: 'at: not a non-negative safe integer' };
    if (!this.db.isOpen) return { ok: false, error: 'not-open', detail: 'the private store is not open' };
    try {
      return tx(this.db, () => {
        const raw = this.db.prepare(`SELECT ${ROW_COLUMNS} FROM operator_messages WHERE id = ?`).get(id) as RawRow | undefined;
        if (raw === undefined) throw new StoreStop({ error: 'refused', detail: `absent: no message ${id}` });
        const row = revive(raw);
        const v = messageMove(row, event, actor);
        if (!v.ok) throw new StoreStop({ error: 'refused', detail: `${v.why}: ${event} by ${actor} on ${row.state}` });
        const next = {
          queuedAt: row.queuedAt, deliveredAt: row.deliveredAt, pickedUpAt: row.pickedUpAt,
          settledAt: row.settledAt, settledBy: raw.settledBy, spentAt: row.spentAt,
        };
        if (v.stamp !== null && next[v.stamp] === null) next[v.stamp] = at;
        if (v.settledBy !== null && next.settledBy === null) next.settledBy = v.settledBy;
        if (v.clearSettlement) { next.settledAt = null; next.settledBy = null; }
        const changed = v.next !== row.state || (Object.keys(next) as (keyof typeof next)[])
          .some((k) => next[k] !== (k === 'settledBy' ? raw.settledBy : row[k]));
        if (changed) {
          this.db.prepare('UPDATE operator_messages SET state = ?, queuedAt = ?, deliveredAt = ?, pickedUpAt = ?, '
            + 'settledAt = ?, settledBy = ?, spentAt = ? WHERE id = ?')
            .run(v.next, next.queuedAt, next.deliveredAt, next.pickedUpAt, next.settledAt, next.settledBy, next.spentAt, id);
        }
        return { ok: true as const, value: { changed, state: v.next, from: row.state } };
      });
    } catch (err) {
      if (err instanceof StoreStop) return { ok: false, ...err.answer };
      return { ok: false, error: 'write-failed', detail: message(err) };
    }
  }

  /** The one writer of the read ledger: the line is checked against the L0 lists and the table's `CHECK`s before it is
   *  written, and a line that does not fit is refused, naming the field. */
  recordRead(l: ReadLine): StoreWrite<{ readonly id: number }> {
    const bad = readLineFault(l);
    if (bad !== null) return { ok: false, error: 'refused', detail: bad };
    if (!this.db.isOpen) return { ok: false, error: 'not-open', detail: 'the private store is not open' };
    try {
      const r = this.db.prepare('INSERT INTO read_ledger (at, door, caller, scope, count, outcome, generation, generationRead, turnState) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(l.at, l.door, l.caller, l.scope, l.count, l.outcome, l.generation, l.generationRead, l.turnState);
      return { ok: true, value: { id: Number(r.lastInsertRowid) } };
    } catch (err) {
      return { ok: false, error: 'write-failed', detail: message(err) };
    }
  }

  /** How many SERVED ledger lines of these callers fall at or after `from` and at or before `to` (closed-book's
   *  `ReadLedgerCount` port). The ledger names a caller by role, never a session, so `['overlord', 'reader']` is the designated
   *  session's and its readers' reads, whoever held the designation then; an empty list or an unknown word is unmeasured, never
   *  zero. A line whose door is `inbox` is left out, and so is a line whose outcome is not the served one (a refused or
   *  unmeasured read served nothing): the inbox read that tells the Overlord a round is open must not open its book (the inbox
   *  plan, question 6). The `messages`, `board`, `history` and `sequence` lines still open it. */
  readsBetween(callers: readonly ReadCaller[], from: number, to: number): StoreRead<number> {
    if (callers.length === 0 || !callers.every(isReadCaller)) return { kind: 'unmeasured', why: 'callers: a non-empty list of ledger caller words' };
    if (!isCount(from) || !isCount(to)) return { kind: 'unmeasured', why: 'from and to: non-negative safe integers' };
    return this.read(() => (this.db.prepare(`SELECT count(*) AS c FROM read_ledger WHERE caller IN (${callers.map(() => '?').join(', ')}) AND at >= ? AND at <= ? `
      + 'AND door <> ? AND outcome = ?')
      .get(...callers, from, to, 'inbox', READ_SERVED_OUTCOME) as { c: number }).c);
  }

  /** The read ceiling's counter (the inbox plan, Task 2): a door's served lines after `sinceMs` by any caller but the console,
   *  the oldest one's time, and the newest `read-ceiling` line's time of the door. Two statements over `read_ledger_door_at`. An
   *  oldest time that is null beside a count above zero cannot be (the same rows) and reads `unmeasured`, never a number. */
  servedReadsSince(door: ReadDoor, sinceMs: number): StoreRead<CeilingCount> {
    if (!isReadDoor(door)) return { kind: 'unmeasured', why: 'door: not a read door' };
    if (!isCount(sinceMs)) return { kind: 'unmeasured', why: 'sinceMs: a non-negative safe integer' };
    return this.read((): CeilingCount => {
      const served = this.db.prepare("SELECT count(*) AS c, min(at) AS oldest FROM read_ledger WHERE door = ? AND at > ? AND outcome = ? AND caller <> 'operator'")
        .get(door, sinceMs, READ_SERVED_OUTCOME) as { c: number; oldest: number | null };
      const refused = this.db.prepare('SELECT max(at) AS last FROM read_ledger WHERE door = ? AND outcome = ?')
        .get(door, READ_CEILING_OUTCOME) as { last: number | null };
      if (served.oldest === null && served.c > 0) throw new Error('the counter has lines and no oldest time');
      return { count: served.c, oldestAt: served.oldest ?? 'none', lastRefusalAt: refused.last ?? 'none' };
    });
  }

  /** The one writer of the uploaded name list (Overlord W2, private names B): deletes every entry, inserts `entries` in their
   *  order, and writes the list row with its generation raised, in one transaction, so a failure leaves the previous list and
   *  generation whole. `entries` is what the upload door built under the server's key, the canary first; never a name. */
  replacePrivateNames(entries: readonly NameListEntryRow[], rows: number, at: number): StoreWrite<{ readonly generation: number }> {
    if (!Array.isArray(entries) || entries.length === 0) return { ok: false, error: 'refused', detail: 'entries: the canary at least' };
    const bad = entries.findIndex((e) => !isEntryRow(e));
    if (bad >= 0) return { ok: false, error: 'refused', detail: `entries[${bad}]: not an entry of the matcher's shape` };
    if (!isCount(rows)) return { ok: false, error: 'refused', detail: 'rows: not a non-negative safe integer' };
    if (!isCount(at)) return { ok: false, error: 'refused', detail: 'at: not a non-negative safe integer' };
    if (!this.db.isOpen) return { ok: false, error: 'not-open', detail: 'the private store is not open' };
    try {
      return tx(this.db, () => {
        const prior = this.db.prepare('SELECT generation FROM private_name_list WHERE id = 1').get() as { generation: number } | undefined;
        const generation = (prior?.generation ?? 0) + 1;
        this.db.prepare('DELETE FROM private_name_entries').run();
        const put = this.db.prepare('INSERT INTO private_name_entries (pos, h, f, n, mode) VALUES (?, ?, ?, ?, ?)');
        entries.forEach((e, pos) => { put.run(pos, e.h, e.f, e.n, e.mode); });
        this.db.prepare('INSERT INTO private_name_list (id, uploadedAt, rows, generation) VALUES (1, ?, ?, ?) '
          + 'ON CONFLICT (id) DO UPDATE SET uploadedAt = excluded.uploadedAt, rows = excluded.rows, generation = excluded.generation')
          .run(at, rows, generation);
        return { ok: true as const, value: { generation } };
      });
    } catch (err) {
      return { ok: false, error: 'write-failed', detail: message(err) };
    }
  }

  /** The name list: `none` when never uploaded, or the list with its entries in order. A list row with no entries cannot be
   *  written (the canary is always first), and an entry of another shape or mode is one this build cannot read, so either
   *  reads `unmeasured`, never a list a check would trust. */
  privateNamesRead(): StoreRead<PrivateNamesRead> {
    return this.read((): PrivateNamesRead => {
      const l = this.db.prepare('SELECT uploadedAt, rows, generation FROM private_name_list WHERE id = 1').get() as
        { uploadedAt: number; rows: number; generation: number } | undefined;
      if (l === undefined) return { kind: 'none' };
      const entries = this.db.prepare('SELECT h, f, n, mode FROM private_name_entries ORDER BY pos').all() as unknown as NameListEntryRow[];
      if (entries.length === 0) throw new Error('the name list has a row and no entries');
      if (!entries.every(isEntryRow)) throw new Error('the name list holds an entry this build cannot read');
      return { kind: 'list', uploadedAt: l.uploadedAt, rows: l.rows, generation: l.generation, entries: entries.map((e) => ({ h: e.h, f: e.f, n: e.n, mode: e.mode })) };
    });
  }

  /** The list's generation alone (one row), or `none` when never uploaded: the reader's cache key. */
  privateNamesGeneration(): StoreRead<number | 'none'> {
    return this.read(() => (this.db.prepare('SELECT generation FROM private_name_list WHERE id = 1').get() as { generation: number } | undefined)?.generation ?? 'none');
  }

  messageById(id: number): StoreRead<OperatorMessageRow | 'absent'> {
    return this.read(() => {
      const r = this.db.prepare(`SELECT ${ROW_COLUMNS} FROM operator_messages WHERE id = ?`).get(id) as RawRow | undefined;
      return r === undefined ? 'absent' : revive(r);
    });
  }

  /** The row's session, never its text: the note-key reader's port (C3). */
  messageSessionOf(id: number): StoreRead<{ readonly sessionId: string } | 'absent'> {
    return this.read(() => {
      const r = this.db.prepare('SELECT sessionId FROM operator_messages WHERE id = ?').get(id) as { sessionId: string } | undefined;
      return r === undefined ? 'absent' : { sessionId: r.sessionId };
    });
  }

  /** The row's state, never its text: the mail lane's ack reads it to move `deliver` while the row is still before `delivered`. */
  messageStateOf(id: number): StoreRead<MessageState | 'absent'> {
    return this.read(() => {
      const r = this.db.prepare('SELECT state FROM operator_messages WHERE id = ?').get(id) as { state: MessageState } | undefined;
      return r === undefined ? 'absent' : r.state;
    });
  }

  /** The ids of the rows still `queued`, in id order, no text: the boot pass checks each against an acked nudge (F3). */
  queuedIds(): StoreRead<readonly number[]> {
    return this.read(() => (this.db.prepare("SELECT id FROM operator_messages WHERE state = 'queued' ORDER BY id").all() as { id: number }[]).map((r) => r.id));
  }

  /** Every row before `settled`, in id order, never trimmed: the card's and the inbox's unsettled list (I8). */
  unsettledMessages(): StoreRead<readonly OperatorMessageRow[]> {
    return this.read(() => (this.db.prepare(`SELECT ${ROW_COLUMNS} FROM operator_messages WHERE state IN (${UNSETTLED_SQL}) ORDER BY id`)
      .all() as unknown as RawRow[]).map(revive));
  }

  /** Every unsettled message as facts, never its text or hash: id order, never trimmed (the inbox plan, question 20). A row whose
   *  state this build does not know is kept, as an `unknown` fact, never dropped (review 3389 F5). */
  unsettledFacts(): StoreRead<readonly MessageFacts[]> {
    return this.read(() => (this.db.prepare(`SELECT ${FACT_COLUMNS} FROM operator_messages WHERE state NOT IN (${SETTLED_SQL}) ORDER BY id`)
      .all() as unknown as RawFacts[]).map(factsOf));
  }

  /** One message's facts, never its text or hash, or `absent`. */
  messageFactsById(id: number): StoreRead<MessageFacts | 'absent'> {
    return this.read(() => {
      const r = this.db.prepare(`SELECT ${FACT_COLUMNS} FROM operator_messages WHERE id = ?`).get(id) as RawFacts | undefined;
      return r === undefined ? 'absent' : factsOf(r);
    });
  }

  /** How many messages were recorded at or after `sinceMs`: the `turns` reading's count. */
  messagesSince(sinceMs: number): StoreRead<number> {
    return this.read(() => (this.db.prepare('SELECT count(*) AS c FROM operator_messages WHERE at >= ?').get(sinceMs) as { c: number }).c);
  }

  /** The newest row's id and time, or `none` when no message was ever recorded. */
  lastOperatorMessage(): StoreRead<{ readonly id: number; readonly at: number } | 'none'> {
    return this.read(() => {
      const r = this.db.prepare('SELECT id, at FROM operator_messages ORDER BY id DESC LIMIT 1').get() as { id: number; at: number } | undefined;
      return r === undefined ? 'none' : { id: r.id, at: r.at };
    });
  }

  highestMessageId(): StoreRead<number | 'none'> {
    return this.read(() => (this.db.prepare('SELECT max(id) AS m FROM operator_messages').get() as { m: number | null }).m ?? 'none');
  }

  /** Every `settled` row, for the boot pass's re-derivation (I8). */
  settledRows(): StoreRead<readonly OperatorMessageRow[]> {
    return this.read(() => (this.db.prepare(`SELECT ${ROW_COLUMNS} FROM operator_messages WHERE state = 'settled' ORDER BY id`)
      .all() as unknown as RawRow[]).map(revive));
  }

  /** The rows the route can leave without a nudge: no `queuedAt`, no `deliveredAt` and no `pickedUpAt` (all three,
   *  because `deliver` may skip `queue`), and `recorded`, or `settled` by `mark`. */
  unnudged(): StoreRead<readonly OperatorMessageRow[]> {
    return this.read(() => (this.db.prepare(`SELECT ${ROW_COLUMNS} FROM operator_messages `
      + 'WHERE queuedAt IS NULL AND deliveredAt IS NULL AND pickedUpAt IS NULL '
      + "AND (state = 'recorded' OR (state = 'settled' AND settledBy = 'mark')) ORDER BY id")
      .all() as unknown as RawRow[]).map(revive));
  }

  /** The privacy journal's head, read fresh, or `unmeasured` when the journal was refused at the open. */
  privacyJournalHead(): StoreRead<PrivacyJournalHead> {
    if (this.privacy.kind === 'refused') return { kind: 'unmeasured', why: `${this.privacy.code}: ${this.privacy.detail}` };
    return this.privacy.head?.() ?? { kind: 'unmeasured', why: 'this issuer reads no head' };
  }

  /** The digest of the privacy journal's record at `sequence`, `null` when none is there; `unmeasured` for a refused issuer, one
   *  that reads no digest, or a journal that could not be read. */
  privacyJournalDigestAt(sequence: number): StoreRead<string | null> {
    if (this.privacy.kind === 'refused') return { kind: 'unmeasured', why: `${this.privacy.code}: ${this.privacy.detail}` };
    return this.privacy.digestAt?.(sequence) ?? { kind: 'unmeasured', why: 'this issuer reads no digest' };
  }

  private read<T>(fn: () => T): StoreRead<T> {
    if (!this.db.isOpen) return { kind: 'unmeasured', why: 'the private store is not open' };
    try {
      return { kind: 'measured', value: fn() };
    } catch (err) {
      return { kind: 'unmeasured', why: message(err) };
    }
  }
}

/** The first field of a read line the ledger refuses, in words, or null when the line fits. */
export function readLineFault(l: ReadLine): string | null {
  if (!isCount(l.at)) return 'at: not a non-negative safe integer';
  if (!isReadDoor(l.door)) return `door: ${String(l.door)} is not a read door`;
  if (!isReadCaller(l.caller)) return `caller: ${String(l.caller)} is not a read caller`;
  if (typeof l.scope !== 'string' || l.scope === '' || l.scope.length > READ_SCOPE_MAX_CHARS) {
    return `scope: 1 to ${READ_SCOPE_MAX_CHARS} characters`;
  }
  if (!isCount(l.count)) return 'count: not a non-negative safe integer';
  if (typeof l.outcome !== 'string' || l.outcome.length > READ_OUTCOME_MAX_CHARS || !OUTCOME_WORD.test(l.outcome)) {
    return `outcome: one kebab word of at most ${READ_OUTCOME_MAX_CHARS} characters`;
  }
  if (!isGenerationRead(l.generationRead)) return `generationRead: ${String(l.generationRead)} is not a word`;
  if (l.generation !== null && !isCount(l.generation)) return 'generation: not a non-negative safe integer';
  if ((l.generationRead === 'measured') !== (l.generation !== null)) return 'generation: present exactly when measured';
  if (l.turnState !== null && !isReadTurnState(l.turnState)) return `turnState: ${String(l.turnState)} is not a turn word`;
  if ((l.caller === 'operator') !== (l.turnState === null)) return 'turnState: null exactly for the operator\'s console';
  if ((l.caller === 'operator') !== (l.generationRead === 'not-a-session')) return 'generationRead: not-a-session exactly for the operator\'s console';
  return null;
}

// ── The open: the store, its privacy journal and their boot coherence (Task 3) ────────────────────────────────────────

/** What the open did with the privacy journal, for the composition root's one boot line. */
export type PrivacyOpenReport =
  | { readonly verdict: Exclude<PrivacyCoherence['verdict'], 're-anchor' | 'refuse'> }
  | { readonly verdict: 're-anchor'; readonly reason: 'missing' | 'behind'; readonly highestId: number; readonly appended: boolean; readonly detail: string }
  | { readonly verdict: 'refuse'; readonly code: string; readonly detail: string };

export interface OperatorModelOpen {
  readonly store: OperatorModelStore;
  readonly db: DatabaseSync;
  readonly journalPath: string;
  /** A torn tail the open cut aside before it read the journal, by its kept name. */
  readonly healed: string | null;
  readonly privacy: PrivacyOpenReport;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** What a verified read of the journal says, as the coherence reads it: a malformed file and an unmeasured read are each
 *  `refused` with their own code. */
const seenOf = (r: ReturnType<ChainedJournalFile<PrivacyJournalEntry>['read']>): PrivacyJournalSeen => {
  if (r.kind === 'absent') return { kind: 'absent' };
  if (r.kind === 'unmeasured') return { kind: 'refused', code: 'unmeasured', detail: `the journal could not be read (${r.why})` };
  if (r.kind === 'malformed') return { kind: 'refused', code: r.code, detail: r.detail };
  if (r.tail !== null) return { kind: 'refused', code: r.tail.code, detail: `a torn tail of ${r.tail.bytes.length} bytes at ${r.tail.offset}` };
  return { kind: 'read', highestId: privacyHighestId(r.records) };
};
const highestSeen = (seen: ChainedFileSeen<PrivacyJournalEntry>): number | null =>
  seen.kind === 'records' ? privacyHighestId(seen.records) : null;

const tornOf = (t: ChainedTail): string => `the privacy journal ends in a torn tail of ${t.bytes.length} bytes at ${t.offset}`;

/** The issuer over the bound journal: each issue re-reads and verifies the whole file (`appendNext`), takes the journal's
 *  highest from THAT read, asks `nextMessageId` with the store's highest, and appends the `privacy-message-issued` record,
 *  so the id and the append come from one read and no snapshot is held across records. A torn tail a failed append left
 *  while the server runs is healed here as the open heals it (the authority journal's `healTornTail`): cut aside through
 *  the adapter's one cut, its bytes kept under `privacy-journal.torn/`, and the append retried once. The tail's record
 *  failed, so its insert rolled back and no row holds its id. A tail that cannot be cut answers as torn, never malformed. */
export function privacyIssuerOf(file: ChainedJournalFile<PrivacyJournalEntry>): PrivacyIssuer {
  const once = (storeHighest: number | null, at: number) => file.appendNext<'malformed' | ChainedTail>((seen) => {
    if (seen.kind === 'malformed') return { stop: 'malformed' };
    if (seen.kind === 'records' && seen.tail !== null) return { stop: seen.tail };
    const id = nextMessageId(storeHighest, highestSeen(seen));
    return { go: { entry: { kind: 'privacy-message-issued', id, at }, acceptedAt: iso(at) } };
  });
  return {
    kind: 'ready',
    issue(storeHighest, at) {
      let r = once(storeHighest, at);
      if (!r.ok && 'stopped' in r && r.stopped !== 'malformed') {
        const plan = chainedTailHealPlan(r.stopped, true);
        const cut = plan === null ? null : file.cutAside({ kind: 'tail', plan }, PRIVACY_JOURNAL_TORN_DIR);
        if (plan === null || cut === null || !cut.ok) {
          const why = cut === null || cut.ok ? 'no plan' : cut.error;
          return { ok: false, error: 'journal-unreadable', detail: `${tornOf(r.stopped)}; cutting it aside answered ${why}` };
        }
        console.warn(`ccrc-server: the privacy journal's torn tail was cut aside while the server ran, kept as ${plan.name}`);
        r = once(storeHighest, at);
      }
      if (r.ok) {
        const e = r.record.entry;
        return e.kind === 'privacy-message-issued' ? { ok: true, id: e.id } : { ok: false, error: 'journal-unwritable', detail: 'not an issued record' };
      }
      if ('stopped' in r) {
        return { ok: false, error: 'journal-unreadable', detail: r.stopped === 'malformed' ? 'the privacy journal is malformed' : `${tornOf(r.stopped)} after one cut` };
      }
      if (r.error === 'malformed' || r.error === 'unreadable') {
        return { ok: false, error: 'journal-unreadable', detail: `the privacy journal is ${r.error}` };
      }
      return { ok: false, error: 'journal-unwritable', detail: `the privacy journal append answered ${r.error}${r.mayApply ? ' (it may have applied)' : ''}` };
    },
    head() {
      const r = file.read();
      if (r.kind === 'unmeasured') return { kind: 'unmeasured', why: r.why };
      if (r.kind === 'malformed') return { kind: 'unmeasured', why: `${r.code}: ${r.detail}` };
      if (r.kind === 'absent' || r.records.length === 0) return { kind: 'measured', value: 'empty' };
      const last = r.records[r.records.length - 1]!;
      return { kind: 'measured', value: { digest: last.digest, sequence: last.sequence, highestId: privacyHighestId(r.records) } };
    },
    digestAt(sequence) {
      const r = file.read();
      if (r.kind === 'unmeasured') return { kind: 'unmeasured', why: r.why };
      if (r.kind === 'malformed') return { kind: 'unmeasured', why: `${r.code}: ${r.detail}` };
      if (r.kind === 'absent') return { kind: 'measured', value: null };
      return { kind: 'measured', value: r.records.find((x) => x.sequence === sequence)?.digest ?? null };
    },
  };
}

/**
 * Opens the private store and its privacy journal (Task 3). The store's open throws as the shared opener throws
 * (`PrivateStoreUnmigratable`); the journal's defects never stop the process, because the rest of the server does not
 * depend on it: the open reads and verifies the whole journal, heals a torn tail by the adapter's one cut (its bytes kept
 * under `privacy-journal.torn/`), asks `privacyCoherence`, and acts:
 *   - `coherent` and `fresh`: the issuer is ready;
 *   - `re-anchor`: appends a `privacy-anchor` record carrying the store's highest id, so the next id is above it;
 *   - `refuse`: every record of a message answers `journal-unreadable`, and reads and the read ledger still work.
 * `at` is the composition root's clock reading, for the anchor's time; this module reads no clock.
 */
export function openOperatorModelStore(dbPath: string, journalDir: string, at: number, witnessedIds?: WitnessedMessageIds): OperatorModelOpen {
  const db = openOperatorModelDb(dbPath);
  const file = chainedJournalFileAt(PRIVACY_JOURNAL_FORMAT, journalDir, PRIVACY_JOURNAL_BASENAME);
  const journalPath = path.join(journalDir, PRIVACY_JOURNAL_BASENAME);
  let healed: string | null = null;
  let cutFailed = '';
  let first = file.read();
  if (first.kind === 'records' && first.tail !== null) {
    const plan = chainedTailHealPlan(first.tail, true);
    if (plan !== null) {
      const cut = file.cutAside({ kind: 'tail', plan }, PRIVACY_JOURNAL_TORN_DIR);
      if (cut.ok) { healed = plan.name; first = file.read(); } else cutFailed = `; cutting it aside answered ${cut.error}`;
    }
  }
  const storeHighest = (db.prepare('SELECT max(id) AS m FROM operator_messages').get() as { m: number | null }).m;
  const seen = seenOf(first);
  const verdict = privacyCoherence(seen.kind === 'refused' ? { ...seen, detail: seen.detail + cutFailed } : seen, storeHighest);
  const done = (privacy: PrivacyOpenReport, issuer: PrivacyIssuer): OperatorModelOpen =>
    ({ store: new OperatorModelStore(db, issuer, witnessedIds), db, journalPath, healed, privacy });
  if (verdict.verdict === 'refuse') {
    return done({ verdict: 'refuse', code: verdict.code, detail: verdict.detail }, { kind: 'refused', code: verdict.code, detail: verdict.detail });
  }
  if (verdict.verdict !== 're-anchor') return done({ verdict: verdict.verdict }, privacyIssuerOf(file));
  const anchored = file.appendNext<'malformed'>((seen) => (seen.kind === 'malformed'
    ? { stop: 'malformed' }
    : { go: { entry: { kind: 'privacy-anchor', highestId: verdict.highestId, reason: verdict.reason, at }, acceptedAt: iso(at) } }));
  const appended = anchored.ok;
  const detail = anchored.ok ? 'appended' : 'stopped' in anchored ? 'the journal is malformed' : `the append answered ${anchored.error}`;
  const report: PrivacyOpenReport = { verdict: 're-anchor', reason: verdict.reason, highestId: verdict.highestId, appended, detail };
  return done(report, appended ? privacyIssuerOf(file) : { kind: 'refused', code: 'anchor-failed', detail });
}

/**
 * The open's boot lines, for the composition root to print one by one (each after `ccrc-server: `): a torn tail cut aside,
 * a re-anchor, a refusal by its cause, and a home that is not the process's own. An `unmeasured` read is the one refusal
 * whose remedy is not a move: the journal may hold a lead the store needs, so it is fixed in place and the server
 * restarted. `CCRC_HOME` moves the store and its journal off the `~`-anchored deny rules, which name the process home.
 */
export function operatorModelBootLines(o: Pick<OperatorModelOpen, 'healed' | 'privacy' | 'journalPath'>, home: string,
  processHome: string = os.homedir()): string[] {
  const lines: string[] = [];
  if (o.healed !== null) lines.push(`the privacy journal's torn tail was cut aside, kept as ${o.healed}`);
  const p = o.privacy;
  if (p.verdict === 're-anchor') {
    lines.push(`the privacy journal was ${p.reason === 'missing' ? 'missing' : 'behind the private store'}; `
      + `re-anchored at message ${p.highestId} (${p.detail}), so no id at or below it is issued again`);
  } else if (p.verdict === 'refuse' && p.code === 'unmeasured') {
    lines.push(`${o.journalPath} could not be read (${p.detail}): no operator message is recorded until it can be. Fix its `
      + 'access and restart the server; do not move it aside, which would lose a lead the store may need.');
  } else if (p.verdict === 'refuse') {
    lines.push(`${o.journalPath} cannot be trusted (${p.code}: ${p.detail}): no operator message is recorded until it is moved `
      + 'aside and the server restarted, which re-anchors it. Keep the moved file until the boot after that reads clean: a '
      + 'journal that was ahead of the store loses its lead when it is moved.');
  }
  if (path.resolve(home) !== path.resolve(processHome)) {
    lines.push(`the private store and its privacy journal live under ${home}, not the process's home: the sessions' deny `
      + 'rules name ~/.ccrc, so they do not cover them there');
  }
  return lines;
}
