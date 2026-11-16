// The Overlord's designation row and its writers (Overlord spec §3.1, §3.2 C2, §3.4 C45, C46; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-designation.md` Task 1, questions 1 and 8, rulings X2, X3, X3b, X5, X7).
// Ring L3, context C5. ONE table, `overlord_designation` (migration 83), its ONE row (`id = 1`), and the only functions that
// write it: `designatePending`, `bindPendingGeneration`, `goLive`, `failPending`, `retire` and `stopDone`, plus the one reader,
// `designationRead`. Each writer is one `tx(db, …)`, synchronous, and never throws on a state it can name (it answers).
//
// THE AUTHORITY DUTIES (the journal's "THE CALLER'S DUTIES", `overlordAuthorityJournal.ts#OverlordAuthorityJournal`): a writer
// that records an authority move calls `appendInTx` BEFORE it writes the row, checks the answer, and on `{ok:false}` writes no
// row and answers `{ok:false, authority, detail}`; `row-only` (a narrowing the journal could not append) writes the row and
// appends nothing. Every `from` it states is the row's own value read in the same transaction. A refusal RETURNS from the
// transaction (it never throws), so a record already appended in it keeps its head row.
import type { DatabaseSync } from 'node:sqlite';
import { tx } from './tx.js';
import type { OverlordAuthorityJournal, AuthorityAppendError } from './overlordAuthorityJournal.js';
import type { OverlordAuthorityMove } from './overlordAuthority.js';
import { restampOverlordGeneration } from '../continuity/continuityStore.js';
import {
  ATTEMPT_OUTCOME_MAP, PENDING_KINDS, parseAccountPools, parseOverlordModel,
  type AttemptOutcome, type DesignationRead, type DesignationView, type OverlordModelClass, type PendingKind,
} from '../../../shared/overlord-designation.js';
import type { PoolSet } from '../../../shared/poolset.js';

/** What a writer needs of the journal: the one synchronous append (declared here by its consumer, so a test passes a fake). */
export type AuthorityAppender = Pick<OverlordAuthorityJournal, 'appendInTx'>;

/** The journal refused (or could not take) the record: no row was written. A door maps `authority` (X2's door mapping). */
export interface AuthorityRefused { readonly ok: false; readonly authority: AuthorityAppendError; readonly detail: string }
/** The row holds a value its writer would not write (a hand edit, a newer build): a writer refuses to build on it. */
export interface RowUnreadable { readonly ok: false; readonly reason: 'unmeasured'; readonly detail: string }

type Raw = Record<string, unknown>;
const ROW = 'SELECT * FROM overlord_designation WHERE id = 1';
/** The narrowest values: a first designate has no row, and journals its choice from them (`first-designate-journals-from-the-narrowest`). */
const NARROWEST_SET: PoolSet = { pools: [], untagged: false };
const NARROWEST_MODEL: OverlordModelClass = 'opus';

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);
function idList(v: unknown): string[] | null {
  if (typeof v !== 'string') return null;
  try {
    const j: unknown = JSON.parse(v);
    return Array.isArray(j) && j.every((x) => typeof x === 'string') ? (j as string[]) : null;
  } catch { return null; }
}
function poolsOf(v: unknown): PoolSet | null {
  if (typeof v !== 'string') return null;
  try { return parseAccountPools(JSON.parse(v)); } catch { return null; }
}

/** The row narrowed, or why it cannot be. The one narrowing, read by the reader and by every writer (never a second one). */
function narrow(r: Raw): DesignationView | string {
  const sessionId = strOrNull(r['sessionId']); const generation = strOrNull(r['generation']);
  if ((sessionId === null) !== (generation === null)) return 'the binding holds one of its two columns';
  const pendingId = strOrNull(r['pendingId']);
  let pending: DesignationView['pending'] = null;
  if (pendingId !== null) {
    const kind = r['pendingKind'];
    const deadlineAt = intOrNull(r['pendingDeadlineAt']); const since = intOrNull(r['pendingSince']); const actor = strOrNull(r['pendingActor']);
    if (typeof kind !== 'string' || !(PENDING_KINDS as readonly string[]).includes(kind)) return 'the pending kind is not a kind word';
    if (deadlineAt === null || since === null || actor === null) return 'the pending attempt lacks its deadline, start or actor';
    pending = { sessionId: pendingId, kind: kind as PendingKind, deadlineAt, since, actor, generation: strOrNull(r['pendingGeneration']) };
  } else if (r['pendingKind'] !== null && r['pendingKind'] !== undefined) return 'a pending kind stands with no pending id';
  const term = intOrNull(r['term']); const designatedTerm = intOrNull(r['designatedTerm']);
  if (term === null || term < 0 || designatedTerm === null || designatedTerm < 0) return 'a term is not a count';
  const model = parseOverlordModel(r['model']);
  if (model === null) return 'the model class is not a class word';
  const accountPools = poolsOf(r['accountPools']);
  if (accountPools === null) return 'the account set is not {pools: string[], untagged: boolean}';
  const pastIds = idList(r['pastIds']); const stopsOwed = idList(r['stopsOwed']);
  if (pastIds === null) return 'pastIds is not a JSON array of strings';
  if (stopsOwed === null) return 'stopsOwed is not a JSON array of strings';
  const actor = strOrNull(r['actor']);
  if (actor === null) return 'the actor is missing';
  const aId = strOrNull(r['attemptId']); const aOut = r['attemptOutcome']; const aAt = intOrNull(r['attemptAt']);
  let lastAttempt: DesignationView['lastAttempt'] = null;
  if (aId !== null || aOut !== null || aAt !== null) {
    if (aId === null || aAt === null || typeof aOut !== 'string' || !Object.hasOwn(ATTEMPT_OUTCOME_MAP, aOut)) return 'the last attempt is not an id, an outcome word and a time';
    lastAttempt = { sessionId: aId, outcome: aOut as AttemptOutcome, at: aAt };
  }
  return {
    bound: sessionId === null || generation === null ? null : { sessionId, generation }, pending, term, designatedTerm, model,
    accountPools, pastIds, actor, lastAttempt, stopsOwed,
  };
}

/** The one reader (X7): three arms, and it never throws. A row it cannot narrow, or a database that throws, is `unmeasured`. */
export function designationRead(db: DatabaseSync): DesignationRead {
  try {
    const raw = db.prepare(ROW).get() as Raw | undefined;
    if (raw === undefined) return { kind: 'not-designated', row: null };
    const row = narrow(raw);
    if (typeof row === 'string') return { kind: 'unmeasured', why: row };
    return row.bound === null ? { kind: 'not-designated', row } : { kind: 'designated', sessionId: row.bound.sessionId, term: row.term, row };
  } catch (e) {
    return { kind: 'unmeasured', why: `the designation row could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The row as a writer builds on it, inside its transaction: `null` for none, a view, or the unreadable answer. */
function held(db: DatabaseSync): { row: DesignationView | null } | RowUnreadable {
  const raw = db.prepare(ROW).get() as Raw | undefined;
  if (raw === undefined) return { row: null };
  const row = narrow(raw);
  return typeof row === 'string' ? { ok: false, reason: 'unmeasured', detail: row } : { row };
}

type Appended = { ok: true } | AuthorityRefused;
/** One record, BEFORE the row; the journal's answer checked (`row-only` goes on, a refusal stops). */
function append(db: DatabaseSync, journal: AuthorityAppender, entry: OverlordAuthorityMove): Appended {
  const a = journal.appendInTx(db, entry);
  return a.ok ? { ok: true } : { ok: false, authority: a.error, detail: a.detail };
}

const withId = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? [...ids] : [...ids, id]);

// ── designatePending ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface DesignateInput {
  sessionId: string; deadlineAt: number; model: OverlordModelClass; accountPools: PoolSet; actor: string; at: number;
  /** The door's operation key (minted through `Entropy`); the model-class record's is this plus `-model`, the set's plus `-set`. */
  opKey: string;
}
export type DesignateResult = { ok: true; changed: true } | { ok: false; reason: 'exists' } | AuthorityRefused | RowUnreadable;

/** Insert or update the row with a pending designate attempt. Refuses `exists` when a session is bound or pending, read in the
 *  same transaction, so two racing designates are safe. It records the account set and the model class (C46, X2) and no
 *  designate record: that is `goLive`'s. The term, past ids, owed stops and last attempt of an earlier row are kept. */
export function designatePending(db: DatabaseSync, journal: AuthorityAppender, i: DesignateInput): DesignateResult {
  return tx(db, (): DesignateResult => {
    const h = held(db);
    if ('ok' in h) return h;
    const row = h.row;
    if (row !== null && (row.bound !== null || row.pending !== null)) return { ok: false, reason: 'exists' };
    const set = append(db, journal, { kind: 'authority-account-set', opKey: `${i.opKey}-set`,
      from: row === null ? NARROWEST_SET : row.accountPools, to: i.accountPools });
    if (!set.ok) return set;
    const model = append(db, journal, { kind: 'authority-model-class', opKey: `${i.opKey}-model`,
      from: row === null ? NARROWEST_MODEL : row.model, to: i.model });
    if (!model.ok) return model;
    db.prepare(
      'INSERT INTO overlord_designation (id, pendingId, pendingKind, pendingSince, pendingDeadlineAt, pendingActor, term, designatedTerm, '
      + "model, accountPools, actor, updatedAt) VALUES (1, ?, 'designate', ?, ?, ?, 0, 0, ?, ?, ?, ?) "
      + 'ON CONFLICT(id) DO UPDATE SET pendingId = excluded.pendingId, pendingGeneration = NULL, pendingKind = excluded.pendingKind, '
      + 'pendingSince = excluded.pendingSince, pendingDeadlineAt = excluded.pendingDeadlineAt, pendingActor = excluded.pendingActor, '
      + 'model = excluded.model, accountPools = excluded.accountPools, actor = excluded.actor, updatedAt = excluded.updatedAt',
    ).run(i.sessionId, i.at, i.deadlineAt, i.actor, i.model, JSON.stringify({ pools: i.accountPools.pools, untagged: i.accountPools.untagged }), i.actor, i.at);
    return { ok: true, changed: true };
  });
}

// ── bindPendingGeneration ─────────────────────────────────────────────────────────────────────────────────────────────

export type BindResult = { ok: true; changed: boolean } | { ok: false; reason: 'not-pending' | 'generation-set' } | RowUnreadable;

/** Record the incarnation the create answered, once. Another id, or an attempt no longer pending (a retire got there
 *  first), is `not-pending`; a different generation over a recorded one is `generation-set` (never overwritten). No append. */
export function bindPendingGeneration(db: DatabaseSync, sessionId: string, generation: string, at: number): BindResult {
  return tx(db, (): BindResult => {
    const h = held(db);
    if ('ok' in h) return h;
    const p = h.row?.pending ?? null;
    if (p === null || p.sessionId !== sessionId) return { ok: false, reason: 'not-pending' };
    if (p.generation !== null) return p.generation === generation ? { ok: true, changed: false } : { ok: false, reason: 'generation-set' };
    db.prepare('UPDATE overlord_designation SET pendingGeneration = ?, updatedAt = ? WHERE id = 1').run(generation, at);
    return { ok: true, changed: true };
  });
}

// ── goLive ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type GoLiveResult = { ok: true; changed: true; term: number } | { ok: true; changed: false } | AuthorityRefused | RowUnreadable;

/** The pending designate attempt becomes the binding. Only for the pending id; anything else changes nothing. Appends
 *  `authority-designate` with the raised term first (its opKey is the term: `go-live-op-key-is-the-term`), then binds, sets
 *  `designatedTerm`, clears the pending slot and the last attempt (`golive-clears-last-attempt`), and re-stamps the body's live
 *  generation (X5) inside this transaction. PR B adds the rebind arm; until then a pending `rebind` is left untouched. */
export function goLive(db: DatabaseSync, journal: AuthorityAppender, sessionId: string, generation: string, at: number): GoLiveResult {
  return tx(db, (): GoLiveResult => {
    const h = held(db);
    if ('ok' in h) return h;
    const p = h.row?.pending ?? null;
    if (h.row === null || p === null || p.sessionId !== sessionId || p.kind !== 'designate') return { ok: true, changed: false };
    const term = h.row.term + 1;
    const a = append(db, journal, { kind: 'authority-designate', opKey: `go-live-term-${term}`, term, sessionId, generation });
    if (!a.ok) return a;
    db.prepare(
      'UPDATE overlord_designation SET sessionId = ?, generation = ?, term = ?, designatedTerm = ?, pendingId = NULL, pendingGeneration = NULL, '
      + 'pendingKind = NULL, pendingSince = NULL, pendingDeadlineAt = NULL, pendingActor = NULL, attemptId = NULL, attemptOutcome = NULL, '
      + 'attemptAt = NULL, updatedAt = ? WHERE id = 1',
    ).run(sessionId, generation, term, term, at);
    restampOverlordGeneration(db, sessionId, term);
    return { ok: true, changed: true, term };
  });
}

// ── failPending ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type FailResult = { ok: true; changed: boolean } | { ok: false; reason: 'bad-outcome' } | RowUnreadable;

/** The pending attempt ended without going live: clear the slot, write its outcome, and owe its stop when asked. Only for the
 *  pending id. It never touches the term or a live binding, and appends nothing. */
export function failPending(db: DatabaseSync, sessionId: string, outcome: AttemptOutcome, at: number, owesStop: boolean): FailResult {
  if (!Object.hasOwn(ATTEMPT_OUTCOME_MAP, outcome)) return { ok: false, reason: 'bad-outcome' };
  return tx(db, (): FailResult => {
    const h = held(db);
    if ('ok' in h) return h;
    const p = h.row?.pending ?? null;
    if (h.row === null || p === null || p.sessionId !== sessionId) return { ok: true, changed: false };
    const owed = owesStop ? withId(h.row.stopsOwed, sessionId) : h.row.stopsOwed;
    db.prepare(`UPDATE overlord_designation SET ${CLEAR_PENDING}, attemptId = ?, attemptOutcome = ?, attemptAt = ?, stopsOwed = ?, updatedAt = ? WHERE id = 1`)
      .run(sessionId, outcome, at, JSON.stringify(owed), at);
    return { ok: true, changed: true };
  });
}
/** The pending slot's six columns, emptied: spliced into each writer's own UPDATE, so the writers map sees the writer. */
const CLEAR_PENDING = 'pendingId = NULL, pendingGeneration = NULL, pendingKind = NULL, pendingSince = NULL, pendingDeadlineAt = NULL, pendingActor = NULL';

// ── retire ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RetireInput { actor: string; at: number; opKey: string }
export type RetireResult = { ok: true; changed: false } | { ok: true; changed: true; term: number; owed: string[] } | AuthorityRefused | RowUnreadable;

/** Question 8's three cases. Nothing live or pending: nothing written. A pending-only row: outcome `retired`, its id owed, no
 *  term raised, no append. A live row: appends `authority-retire` (raised term, `previousSessionId` the bound id) first, then
 *  unbinds, puts the bound id on `pastIds`, raises the term, cancels a pending attempt (`retired`) and owes both ids. A retire
 *  is a narrowing, so the journal answers `row-only` where it cannot append and the row is still written; any refusal
 *  (`not-in-transaction`) writes nothing. `owed` is the ids this call put on `stopsOwed`. The retiring actor is the row's. */
export function retire(db: DatabaseSync, journal: AuthorityAppender, i: RetireInput): RetireResult {
  return tx(db, (): RetireResult => {
    const h = held(db);
    if ('ok' in h) return h;
    const row = h.row;
    if (row === null || (row.bound === null && row.pending === null)) return { ok: true, changed: false };
    const p = row.pending;
    if (row.bound === null) {
      const id = p!.sessionId;
      db.prepare(`UPDATE overlord_designation SET ${CLEAR_PENDING}, actor = ?, attemptId = ?, attemptOutcome = 'retired', attemptAt = ?, stopsOwed = ?, updatedAt = ? WHERE id = 1`)
        .run(i.actor, id, i.at, JSON.stringify(withId(row.stopsOwed, id)), i.at);
      return { ok: true, changed: true, term: row.term, owed: [id] };
    }
    const bound = row.bound.sessionId;
    const term = row.term + 1;
    const a = append(db, journal, { kind: 'authority-retire', opKey: i.opKey, term, previousSessionId: bound });
    if (!a.ok) return a;
    const owed = p === null ? [bound] : withId([bound], p.sessionId);
    const stops = owed.reduce<readonly string[]>(withId, row.stopsOwed);
    const la = p === null ? row.lastAttempt : { sessionId: p.sessionId, outcome: 'retired' as const, at: i.at };
    db.prepare(`UPDATE overlord_designation SET ${CLEAR_PENDING}, sessionId = NULL, generation = NULL, term = ?, pastIds = ?, stopsOwed = ?, actor = ?, `
      + 'attemptId = ?, attemptOutcome = ?, attemptAt = ?, updatedAt = ? WHERE id = 1')
      .run(term, JSON.stringify(withId(row.pastIds, bound)), JSON.stringify(stops), i.actor,
        la?.sessionId ?? null, la?.outcome ?? null, la?.at ?? null, i.at);
    return { ok: true, changed: true, term, owed };
  });
}

// ── stopDone ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type StopDoneResult = { ok: true; changed: boolean } | RowUnreadable;

/** One owed stop is done: remove its id from `stopsOwed`. No append. */
export function stopDone(db: DatabaseSync, sessionId: string): StopDoneResult {
  return tx(db, (): StopDoneResult => {
    const h = held(db);
    if ('ok' in h) return h;
    if (h.row === null || !h.row.stopsOwed.includes(sessionId)) return { ok: true, changed: false };
    db.prepare('UPDATE overlord_designation SET stopsOwed = ? WHERE id = 1').run(JSON.stringify(h.row.stopsOwed.filter((x) => x !== sessionId)));
    return { ok: true, changed: true };
  });
}
