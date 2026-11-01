import type { DatabaseSync } from 'node:sqlite';
import { ROUTE_REFUSALS, type RouteRefusal } from '../../../shared/refusal.js';
import { isMintedActor, type AccountActor } from '../accounts/audit.js';

/**
 * THE LINEAR WRITE JOURNAL (#1444, spec §7, D-7671): the `linear_events` table in coord.db (`coord/schema.ts`,
 * migration 36) and its ONE writer, modelled on the account audit (`accounts/audit.ts`).
 *
 * A row is one Linear write a session sent through the server (`create`, `update`, `comment`) or one Settings act on
 * a workspace key (`key-add`, `key-replace`, `key-remove`, `key-check`). It is inserted `pending` before the write or
 * the act touches Linear or a file ({@link LinearJournal.pending}), and its outcome replaces `pending` when the route
 * answers ({@link LinearJournal.settle}). A server that dies in between leaves `pending`, which reads as "outcome
 * unknown", the truth. A refused insert is the caller's cue to refuse the write (`journal-unavailable`): "every
 * write is journaled" is a precondition, not a best effort (spec §7).
 *
 * NO FREE TEXT. Every value is checked here at run time, as well as by the types, against its grammar: `op`,
 * `outcome` and `code` are closed words; `sessionId` and `sessionUuid` SAFE_RE; `workspaceId` a slot id (a
 * lowercase UUID); `teamKey` a team key; `target` an issue identifier; `result` the created issue's identifier or
 * the created comment's UUID; `fields` names from the operation's closed list; `masked` a count; `decisionId`
 * SAFE_RE; `actor` minted by `actorOf` only. So no title, body, name, key, key tail or digest can be written: no
 * field takes free text.
 *
 * WHO. A session write carries the attributed pair (`sessionId`, `sessionUuid`) and no actor; a key act carries the
 * account gate's actor and no pair. Both are attribution, never a grant (spec §8).
 *
 * Rows are kept {@link LINEAR_JOURNAL_RETENTION_DAYS} days ({@link LinearJournal.sweep}, on `index.ts`'s daily beat
 * beside the account audit's). Reads are not journaled. v1 ships no screen; the box run reads it with `sqlite3`.
 *
 * L3 adapter over the coord.db handle. A refused or failed write is an answer, never a throw. Logs name the reason
 * word only, never a value.
 */

/** Every op a row records: the three session writes, then the four Settings key acts. */
export const LINEAR_JOURNAL_OPS = ['create', 'update', 'comment', 'key-add', 'key-replace', 'key-remove', 'key-check'] as const;
export type LinearJournalOp = (typeof LINEAR_JOURNAL_OPS)[number];
export type LinearWriteOp = Extract<LinearJournalOp, 'create' | 'update' | 'comment'>;

/** `pending` until the route answers; then exactly one of the others. */
export const LINEAR_JOURNAL_OUTCOMES = ['pending', 'ok', 'refused', 'denied', 'failed', 'unknown'] as const;
export type LinearJournalOutcome = (typeof LINEAR_JOURNAL_OUTCOMES)[number];
export type LinearSettledOutcome = Exclude<LinearJournalOutcome, 'pending'>;

/** Each write op's closed list of field names (spec §5.3's bodies, less `requestId`, which changes nothing). A row's
 *  `fields` is the changed names, comma-separated, in this list's order. A key act changes no field. */
export const LINEAR_JOURNAL_FIELDS: Readonly<Record<LinearWriteOp, readonly string[]>> = {
  create: ['team', 'title', 'description', 'state', 'priority', 'assignee', 'labels', 'project', 'parent'],
  update: ['title', 'description', 'state', 'priority', 'assignee', 'labels', 'addLabels', 'removeLabels', 'project', 'parent'],
  comment: ['body'],
};

export const LINEAR_JOURNAL_RETENTION_DAYS = 365;
/** The most items one `viaFleet` read takes: a page of any list the proxy answers is well under it. */
export const LINEAR_VIA_FLEET_MAX_ITEMS = 250;

/** One pending row, as a caller states it. */
export interface LinearPendingInput {
  op: LinearJournalOp;
  /** The attributed pair on a session write; null on a key act. */
  sessionId: string | null;
  sessionUuid: string | null;
  /** The account gate's actor on a key act; null on a session write. */
  actor: AccountActor | null;
  /** The slot the write routed to, or null when none was chosen (a key add before its check has learned it). */
  workspaceId: string | null;
  /** The team the resolve found (spec §4.5), never the reference's prefix; null on a key act. */
  teamKey: string | null;
  /** The issue's current identifier from the resolve, the parent's on a create with `parent`, or null. */
  target: string | null;
  /** The changed fields' names, from the op's closed list; empty on a key act. */
  fields: readonly string[];
}

/** Why a write was refused: one word per field, `row` for a row that is not pending, or the store's own failure. */
export type LinearJournalRefusal =
  | 'op' | 'session' | 'actor' | 'workspace' | 'team' | 'target' | 'fields'
  | 'outcome' | 'code' | 'result' | 'masked' | 'decision' | 'row' | 'unwritable';

export type LinearJournalWrite = { ok: true; id: number } | { ok: false; why: LinearJournalRefusal };
export type LinearJournalSettle = { ok: true } | { ok: false; why: LinearJournalRefusal };

/** The refusal words a row may carry in `code`. */
export type LinearJournalCode = RouteRefusal;

const OPS: ReadonlySet<string> = new Set(LINEAR_JOURNAL_OPS);
const WRITE_OPS: ReadonlySet<string> = new Set(['create', 'update', 'comment']);
const SETTLED: ReadonlySet<string> = new Set(LINEAR_JOURNAL_OUTCOMES.filter((o) => o !== 'pending'));
const CODES: ReadonlySet<string> = new Set<string>(ROUTE_REFUSALS);
/** The client's SAFE_RE (`ccd/ccrc-api`), bounded as the mail path bounds a session id. */
const SAFE_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** A Linear id: a slot's workspace id, a created comment's id. Lowercase, as Linear sends it. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A team key, compared uppercased. */
const TEAM_KEY_RE = /^[A-Z][A-Z0-9_]{0,15}$/;
/** An issue identifier: a team key, a hyphen and the issue's number (spec §5.1's grammar, the key bounded). */
const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]{0,15}-[0-9]{1,9}$/;
const DAY_MS = 86_400_000;

const isSafe = (v: unknown): v is string => typeof v === 'string' && SAFE_RE.test(v);
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const isTeamKey = (v: unknown): v is string => typeof v === 'string' && TEAM_KEY_RE.test(v.toUpperCase());
const isIdentifier = (v: unknown): v is string => typeof v === 'string' && IDENTIFIER_RE.test(v);

/** The stored `fields` text, or null for a list that breaks the op's closed list (an unknown name, a repeat). */
function fieldsText(op: LinearJournalOp, fields: unknown): string | null | 'refused' {
  if (!Array.isArray(fields)) return 'refused';
  const allowed: readonly string[] = WRITE_OPS.has(op) ? LINEAR_JOURNAL_FIELDS[op as LinearWriteOp] : [];
  const seen = new Set<string>();
  for (const f of fields) {
    if (typeof f !== 'string' || !allowed.includes(f) || seen.has(f)) return 'refused';
    seen.add(f);
  }
  const text = allowed.filter((f) => seen.has(f)).join(',');
  return text === '' ? null : text;
}

/** The first rule a pending row breaks, or `null` for a row that may be written. */
function pendingRefusal(e: LinearPendingInput): LinearJournalRefusal | null {
  if (typeof e.op !== 'string' || !OPS.has(e.op)) return 'op';
  const write = WRITE_OPS.has(e.op);
  if (write ? !(isSafe(e.sessionId) && isSafe(e.sessionUuid)) : (e.sessionId !== null || e.sessionUuid !== null)) return 'session';
  if (write ? e.actor !== null : !isMintedActor(e.actor)) return 'actor';
  if (e.workspaceId !== null && !isUuid(e.workspaceId)) return 'workspace';
  if (write ? (e.teamKey !== null && !isTeamKey(e.teamKey)) : e.teamKey !== null) return 'team';
  if (e.target !== null && !isIdentifier(e.target)) return 'target';
  if ((e.op === 'update' || e.op === 'comment') && e.target === null) return 'target';
  if (!write && e.target !== null) return 'target';
  if (fieldsText(e.op, e.fields) === 'refused') return 'fields';
  return null;
}

/** The first rule a settle of a known outcome breaks against the row's op, or `null`. `result` rides only an `ok` create (an
 *  identifier) or an `ok` comment (a UUID); `code` only a row that did not end `ok`. */
function settleRefusal(op: string, outcome: LinearSettledOutcome, code: unknown, result: unknown, masked: unknown,
  decisionId: unknown): LinearJournalRefusal | null {
  if (code !== undefined && (typeof code !== 'string' || !CODES.has(code) || outcome === 'ok')) return 'code';
  if (result !== null && result !== undefined) {
    const fits = outcome === 'ok' && ((op === 'create' && isIdentifier(result)) || (op === 'comment' && isUuid(result)));
    if (!fits) return 'result';
  }
  if (masked !== null && masked !== undefined && !(Number.isSafeInteger(masked) && (masked as number) >= 0)) return 'masked';
  if (decisionId !== null && decisionId !== undefined && !isSafe(decisionId)) return 'decision';
  return null;
}

const failName = (err: unknown): string => (err instanceof Error ? err.name : 'error');

export class LinearJournal {
  /** @param db the process's one coord.db handle (`CoordStore.db`), already migrated. @param now the clock. */
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {}

  /** Inserts one `pending` row, or refuses it with the first rule it breaks. Never throws. */
  pending(e: LinearPendingInput): LinearJournalWrite {
    const why = pendingRefusal(e);
    if (why !== null) {
      console.warn(`ccrc-server: linear journal refused a row (${why})`);
      return { ok: false, why };
    }
    const fields = fieldsText(e.op, e.fields) as string | null;
    try {
      const res = this.db.prepare(
        'INSERT INTO linear_events (at, sessionId, sessionUuid, actor, workspaceId, teamKey, op, target, fields, outcome) ' +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
      ).run(this.now(), e.sessionId, e.sessionUuid, e.actor === null ? null : e.actor.toString(), e.workspaceId,
        e.teamKey, e.op, e.target, fields);
      return { ok: true, id: Number(res.lastInsertRowid) };
    } catch (err) {
      console.warn(`ccrc-server: linear journal write failed (${failName(err)})`);
      return { ok: false, why: 'unwritable' };
    }
  }

  /** Replaces a pending row's `pending` with its outcome, once. A row that is not pending, or a value that breaks
   *  its grammar, is refused. Never throws. */
  settle(id: number, outcome: LinearSettledOutcome, code?: LinearJournalCode, result?: string | null,
    masked?: number | null, decisionId?: string | null): LinearJournalSettle {
    if (typeof outcome !== 'string' || !SETTLED.has(outcome)) {
      console.warn('ccrc-server: linear journal refused a settle (outcome)');
      return { ok: false, why: 'outcome' };
    }
    let op: string;
    try {
      const row = this.db.prepare("SELECT op FROM linear_events WHERE id = ? AND outcome = 'pending'")
        .get(Number.isSafeInteger(id) ? id : -1) as { op: string } | undefined;
      if (row === undefined) {
        console.warn('ccrc-server: linear journal refused a settle (row)');
        return { ok: false, why: 'row' };
      }
      op = row.op;
    } catch (err) {
      console.warn(`ccrc-server: linear journal write failed (${failName(err)})`);
      return { ok: false, why: 'unwritable' };
    }
    const why = settleRefusal(op, outcome, code, result, masked, decisionId);
    if (why !== null) {
      console.warn(`ccrc-server: linear journal refused a settle (${why})`);
      return { ok: false, why };
    }
    try {
      const res = this.db.prepare(
        "UPDATE linear_events SET outcome = ?, code = ?, result = ?, masked = ?, decisionId = ? WHERE id = ? AND outcome = 'pending'",
      ).run(outcome, code ?? null, result ?? null, masked ?? null, decisionId ?? null, id);
      if (Number(res.changes) !== 1) return { ok: false, why: 'row' };
      return { ok: true };
    } catch (err) {
      console.warn(`ccrc-server: linear journal write failed (${failName(err)})`);
      return { ok: false, why: 'unwritable' };
    }
  }

  /** Which of `items` (issue identifiers, comment UUIDs) a fleet write created: those an `ok` row holds in `result`
   *  (spec §5.4). One query on the `result` index. An item outside both grammars never matches; a read that fails,
   *  or more than {@link LINEAR_VIA_FLEET_MAX_ITEMS} items, answers the empty set (every item reads `false`). */
  viaFleet(items: readonly string[]): ReadonlySet<string> {
    const asked = [...new Set(items.filter((i) => isIdentifier(i) || isUuid(i)))];
    if (asked.length === 0) return new Set();
    if (asked.length > LINEAR_VIA_FLEET_MAX_ITEMS) {
      console.warn('ccrc-server: linear journal read refused (too-many)');
      return new Set();
    }
    try {
      const rows = this.db.prepare(
        `SELECT DISTINCT result FROM linear_events WHERE result IN (${asked.map(() => '?').join(', ')}) AND outcome = 'ok'`,
      ).all(...asked) as { result: string }[];
      return new Set(rows.map((r) => r.result));
    } catch (err) {
      console.warn(`ccrc-server: linear journal read failed (${failName(err)})`);
      return new Set();
    }
  }

  /** The retention: every row older than {@link LINEAR_JOURNAL_RETENTION_DAYS} days at `now` is deleted. Returns the
   *  count, or 0 when the delete failed (said in one line). */
  sweep(now: number): number {
    try {
      const res = this.db.prepare('DELETE FROM linear_events WHERE at < ?').run(now - LINEAR_JOURNAL_RETENTION_DAYS * DAY_MS);
      return Number(res.changes);
    } catch (err) {
      console.warn(`ccrc-server: linear journal sweep failed (${failName(err)}) — the next sweep retries`);
      return 0;
    }
  }
}
