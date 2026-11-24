// The Overlord's designation row and its writers (Overlord spec §3.1, §3.2 C2, §3.4 C45, C46; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-designation.md` Task 1, questions 1 and 8, rulings X2, X3, X3b, X5, X7).
// Ring L3, context C5. ONE table, `overlord_designation` (migration 83), its ONE row (`id = 1`), and the only functions that
// write it: `designatePending`, `rebindPending` (designation B), `bindPendingGeneration`, `goLive`, `failPending`, `retire` and `stopDone`, the Settings doors'
// `setModelClass` and `setAccountSet` (designation C), plus the one reader,
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
import { endOverlordGeneration, restampOverlordGeneration } from '../continuity/continuityStore.js';
import {
  ATTEMPT_OUTCOME_MAP, PENDING_KINDS, parseAccountPools, parseOverlordModel,
  type AttemptOutcome, type DesignationRead, type DesignationView, type OverlordModelClass, type PendingKind,
} from '../../../shared/overlord-designation.js';
import type { PoolSet } from '../../../shared/poolset.js';
import { readActorColumns, type ActorWire } from '../../../shared/overlord-identity.js';
import type { RecordedActor } from '../auth/callerIdentity.js';
import { isAccountGateOperator } from '../auth/attributionIdentity.js';

/** What a writer needs of the journal: the one synchronous append (declared here by its consumer, so a test passes a fake). */
export type AuthorityAppender = Pick<OverlordAuthorityJournal, 'appendInTx'>;

/** The journal refused (or could not take) the record: no row was written. A door maps `authority` (X2's door mapping). */
export interface AuthorityRefused { readonly ok: false; readonly authority: AuthorityAppendError; readonly detail: string }
/** The row holds a value its writer would not write (a hand edit, a newer build): a writer refuses to build on it. */
export interface RowUnreadable { readonly ok: false; readonly reason: 'unmeasured'; readonly detail: string }
/** The actor is not one the attribution adapter minted for the operator at `operator` strength (gates A, review M6): no row. */
export interface ActorRefused { readonly ok: false; readonly reason: 'actor' }

/** The one actor check a designation writer makes: minted by the adapter (`isRecordedActor`), kind `operator`, issuer
 *  `account-gate` and strength `operator`: neither a forged object, a session actor nor a console-only actor may write. */
const actorRefused = (a: unknown): boolean => !isAccountGateOperator(a);
const ACTOR_REFUSED: ActorRefused = { ok: false, reason: 'actor' };
/** The actor's four values, in the column order every writer spells: subject, kind, issuer, strength. */
const actorCols = (a: ActorWire): [string, string, string, string] => [a.subject, a.kind, a.issuer, a.strength];

type Raw = Record<string, unknown>;
const ROW = 'SELECT * FROM overlord_designation WHERE id = 1';
/** The pending actor's four columns: set together from one `RecordedActor`, and nulled together by every pending clear. */
const PENDING_ACTOR_COLUMNS = ['pendingActor', 'pendingActorKind', 'pendingActorIssuer', 'pendingActorStrength'] as const;
/** The pending slot's nine columns, emptied: spliced into each writer's own UPDATE, so the writers map sees the writer. */
const CLEAR_PENDING = 'pendingId = NULL, pendingGeneration = NULL, pendingKind = NULL, pendingSince = NULL, pendingDeadlineAt = NULL, '
  + PENDING_ACTOR_COLUMNS.map((c) => `${c} = NULL`).join(', ');
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
    const deadlineAt = intOrNull(r['pendingDeadlineAt']); const since = intOrNull(r['pendingSince']);
    if (typeof kind !== 'string' || !(PENDING_KINDS as readonly string[]).includes(kind)) return 'the pending kind is not a kind word';
    if (deadlineAt === null || since === null) return 'the pending attempt lacks its deadline or start';
    // The four pending actor columns read together, or the row is unmeasured: never a view with a half actor (gates A, F11).
    const pa = readActorColumns(r['pendingActor'], r['pendingActorKind'], r['pendingActorIssuer'], r['pendingActorStrength']);
    if (pa.kind === 'unreadable') return `the pending actor's ${pa.column} does not read`;
    pending = { sessionId: pendingId, kind: kind as PendingKind, deadlineAt, since, actor: pa.actor.subject, actorDetail: pa.actor,
      generation: strOrNull(r['pendingGeneration']) };
  } else if (r['pendingKind'] !== null && r['pendingKind'] !== undefined) return 'a pending kind stands with no pending id';
  // An older build clears the pending subject and id, but does not know the three additive metadata columns.
  // With no pending subject or id, those stale columns describe no actor and must not wedge the designation.
  else if (r['pendingActor'] !== null && r['pendingActor'] !== undefined) return 'a pending actor stands with no pending id';
  const term = intOrNull(r['term']); const designatedTerm = intOrNull(r['designatedTerm']);
  if (term === null || term < 0 || designatedTerm === null || designatedTerm < 0) return 'a term is not a count';
  const model = parseOverlordModel(r['model']);
  if (model === null) return 'the model class is not a class word';
  const accountPools = poolsOf(r['accountPools']);
  if (accountPools === null) return 'the account set is not {pools: string[], untagged: boolean}';
  const pastIds = idList(r['pastIds']); const stopsOwed = idList(r['stopsOwed']);
  if (pastIds === null) return 'pastIds is not a JSON array of strings';
  if (stopsOwed === null) return 'stopsOwed is not a JSON array of strings';
  const live = readActorColumns(r['actor'], r['actorKind'], r['actorIssuer'], r['actorStrength']);
  if (live.kind === 'unreadable') return `the actor's ${live.column} does not read`;
  const aId = strOrNull(r['attemptId']); const aOut = r['attemptOutcome']; const aAt = intOrNull(r['attemptAt']);
  let lastAttempt: DesignationView['lastAttempt'] = null;
  if (aId !== null || aOut !== null || aAt !== null) {
    if (aId === null || aAt === null || typeof aOut !== 'string' || !Object.hasOwn(ATTEMPT_OUTCOME_MAP, aOut)) return 'the last attempt is not an id, an outcome word and a time';
    lastAttempt = { sessionId: aId, outcome: aOut as AttemptOutcome, at: aAt };
  }
  return {
    bound: sessionId === null || generation === null ? null : { sessionId, generation }, pending, term, designatedTerm, model,
    accountPools, pastIds, actor: live.actor.subject, actorDetail: live.actor, lastAttempt, stopsOwed,
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

type Appended = { ok: true; journalled: boolean } | AuthorityRefused;
/** One record, BEFORE the row; the journal's answer checked (`row-only` goes on, `journalled: false`, a refusal stops). */
function append(db: DatabaseSync, journal: AuthorityAppender, entry: OverlordAuthorityMove): Appended {
  const a = journal.appendInTx(db, entry);
  return a.ok ? { ok: true, journalled: a.kind === 'appended' } : { ok: false, authority: a.error, detail: a.detail };
}

/** The live actor's four columns, set together from one `RecordedActor` (`actorCols`' order). */
const SET_ACTOR = 'actor = ?, actorKind = ?, actorIssuer = ?, actorStrength = ?';

const withId = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? [...ids] : [...ids, id]);

// ── designatePending ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface DesignateInput {
  sessionId: string; deadlineAt: number; model: OverlordModelClass; accountPools: PoolSet; actor: RecordedActor; at: number;
  /** The door's operation key (minted through `Entropy`); the model-class record's is this plus `-model`, the set's plus `-set`. */
  opKey: string;
}
export type DesignateResult = { ok: true; changed: true } | { ok: false; reason: 'exists' } | AuthorityRefused | RowUnreadable | ActorRefused;

/** Insert or update the row with a pending designate attempt. Refuses `exists` when a session is bound or pending, read in the
 *  same transaction, so two racing designates are safe. It records the account set and the model class (C46, X2) and no
 *  designate record: that is `goLive`'s. The term, past ids, owed stops and last attempt of an earlier row are kept. */
// Residual (review 2349 F11): the set record is appended, then the model-class record. If the second refuses, the first record
// and its head row stay committed with no designation row, because `tx` commits on a normal return. That is reachable only when the
// guard is already damaged (`journal-append` or `diverged`, each calling `writerFailed`); a throw would be worse, the record being a file.
export function designatePending(db: DatabaseSync, journal: AuthorityAppender, i: DesignateInput): DesignateResult {
  if (actorRefused(i.actor)) return ACTOR_REFUSED;
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
      'INSERT INTO overlord_designation (id, pendingId, pendingKind, pendingSince, pendingDeadlineAt, pendingActor, pendingActorKind, '
      + 'pendingActorIssuer, pendingActorStrength, term, designatedTerm, model, accountPools, actor, actorKind, actorIssuer, actorStrength, updatedAt) '
      + "VALUES (1, ?, 'designate', ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?) "
      + 'ON CONFLICT(id) DO UPDATE SET pendingId = excluded.pendingId, pendingGeneration = NULL, pendingKind = excluded.pendingKind, '
      + 'pendingSince = excluded.pendingSince, pendingDeadlineAt = excluded.pendingDeadlineAt, pendingActor = excluded.pendingActor, '
      + 'pendingActorKind = excluded.pendingActorKind, pendingActorIssuer = excluded.pendingActorIssuer, pendingActorStrength = excluded.pendingActorStrength, '
      + 'model = excluded.model, accountPools = excluded.accountPools, actor = excluded.actor, actorKind = excluded.actorKind, '
      + 'actorIssuer = excluded.actorIssuer, actorStrength = excluded.actorStrength, updatedAt = excluded.updatedAt',
    ).run(i.sessionId, i.at, i.deadlineAt, ...actorCols(i.actor), i.model, JSON.stringify({ pools: i.accountPools.pools, untagged: i.accountPools.untagged }),
      ...actorCols(i.actor), i.at);
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

// ── rebindPending ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RebindInput { sessionId: string; deadlineAt: number; actor: RecordedActor; at: number }
export type RebindResult =
  | { ok: true; changed: true } | { ok: false; reason: 'not-found' | 'attempt-pending' } | RowUnreadable | ActorRefused;

/** Write a pending `rebind` attempt beside the live binding, which stands while the new body is checked (plan Task 6). The slot
 *  is read again in this transaction: no live binding is `not-found`, and an attempt already pending is `attempt-pending`, so
 *  two racing rebinds are safe (question 9). The class and the set are the row's (`rebind-keeps-the-class-and-set`), and it
 *  appends nothing: the rebind record is `goLive`'s (X2). */
export function rebindPending(db: DatabaseSync, i: RebindInput): RebindResult {
  if (actorRefused(i.actor)) return ACTOR_REFUSED;
  return tx(db, (): RebindResult => {
    const h = held(db);
    if ('ok' in h) return h;
    if (h.row === null || h.row.bound === null) return { ok: false, reason: 'not-found' };
    if (h.row.pending !== null) return { ok: false, reason: 'attempt-pending' };
    db.prepare("UPDATE overlord_designation SET pendingId = ?, pendingGeneration = NULL, pendingKind = 'rebind', pendingSince = ?, "
      + `pendingDeadlineAt = ?, ${PENDING_ACTOR_COLUMNS.map((c) => `${c} = ?`).join(', ')}, updatedAt = ? WHERE id = 1`)
      .run(i.sessionId, i.at, i.deadlineAt, ...actorCols(i.actor), i.at);
    return { ok: true, changed: true };
  });
}

// ── goLive ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type GoLiveResult =
  | { ok: true; changed: true; term: number; previous: string | null } | { ok: true; changed: false } | AuthorityRefused | RowUnreadable;

/** Moves the queued deliveries of `overlord` mail from the old body to the new one, inside `goLive`'s transaction (the store's
 *  private member, through its one delivery writer; question 7). Declared here by its consumer, so this module never reaches it. */
export type OverlordMailRepoint = (to: string, from: string) => void;

/** The pending attempt becomes the binding. Only for the pending id; anything else changes nothing. Appends the go-live record
 *  with the raised term first (its opKey is the term: `go-live-op-key-is-the-term`), then binds, clears the pending slot and the
 *  last attempt (`golive-clears-last-attempt`), and re-stamps the body's live generation (X5), all in this transaction.
 *  `designate`: `authority-designate`, and `designatedTerm` takes the term. `rebind` (plan Task 6): `authority-rebind` naming the
 *  old body, `designatedTerm` kept (§3.3.12), the old id onto `pastIds` and `stopsOwed`, its live generation ended before the new
 *  body's is re-stamped, and its queued `overlord` mail repointed; `previous` names it for the caller's drain. A refused append,
 *  or a step that throws, rolls the whole move back and the attempt stays pending (question 10). */
export function goLive(db: DatabaseSync, journal: AuthorityAppender, sessionId: string, generation: string, at: number,
  repoint?: OverlordMailRepoint): GoLiveResult {
  return tx(db, (): GoLiveResult => {
    const h = held(db);
    if ('ok' in h) return h;
    const p = h.row?.pending ?? null;
    if (h.row === null || p === null || p.sessionId !== sessionId) return { ok: true, changed: false };
    const term = h.row.term + 1;
    if (p.kind === 'rebind') return goLiveRebind(db, journal, h.row, sessionId, generation, term, at, repoint);
    const a = append(db, journal, { kind: 'authority-designate', opKey: `go-live-term-${term}`, term, sessionId, generation });
    if (!a.ok) return a;
    db.prepare(
      // The binding names the operator who started it (X2): the attempt's four actor columns, copied before the clear (the
      // right-hand sides read the row as it was).
      'UPDATE overlord_designation SET sessionId = ?, generation = ?, term = ?, designatedTerm = ?, actor = pendingActor, actorKind = pendingActorKind, '
      + `actorIssuer = pendingActorIssuer, actorStrength = pendingActorStrength, ${CLEAR_PENDING}, attemptId = NULL, attemptOutcome = NULL, `
      + 'attemptAt = NULL, updatedAt = ? WHERE id = 1',
    ).run(sessionId, generation, term, term, at);
    restampOverlordGeneration(db, sessionId, term);
    return { ok: true, changed: true, term, previous: null };
  });
}

/** `goLive`'s rebind arm, inside its transaction (the CHECK keeps a pending rebind beside a binding; a row without one changes
 *  nothing). A repoint that throws throws out of the transaction, which rolls the record and the row back together. */
function goLiveRebind(db: DatabaseSync, journal: AuthorityAppender, row: DesignationView, sessionId: string, generation: string,
  term: number, at: number, repoint: OverlordMailRepoint | undefined): GoLiveResult {
  const old = row.bound?.sessionId;
  if (old === undefined) return { ok: true, changed: false };
  const a = append(db, journal, { kind: 'authority-rebind', opKey: `go-live-term-${term}`, term, sessionId, generation, previousSessionId: old });
  if (!a.ok) return a;
  db.prepare(
    'UPDATE overlord_designation SET sessionId = ?, generation = ?, term = ?, pastIds = ?, stopsOwed = ?, actor = pendingActor, '
    + `actorKind = pendingActorKind, actorIssuer = pendingActorIssuer, actorStrength = pendingActorStrength, ${CLEAR_PENDING}, `
    + 'attemptId = NULL, attemptOutcome = NULL, attemptAt = NULL, updatedAt = ? WHERE id = 1',
  ).run(sessionId, generation, term, JSON.stringify(withId(row.pastIds, old)), JSON.stringify(withId(row.stopsOwed, old)), at);
  endOverlordGeneration(db, old); // first, so the new body's re-stamp finds no other live `overlord` row (X5)
  restampOverlordGeneration(db, sessionId, term);
  repoint?.(sessionId, old);
  return { ok: true, changed: true, term, previous: old };
}

// ── failPending ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type FailResult = { ok: true; changed: boolean } | { ok: false; reason: 'bad-outcome' } | RowUnreadable;

/** The pending attempt ended without going live: clear the slot, write its outcome, and owe its stop when asked. Only for the
 *  pending id. It never touches the term or a live binding, and appends nothing. A generation the pending body minted (it is
 *  `overlord` by `identityOf` from its start) ends `retired` in the same transaction (review 2366 N3). */
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
    endOverlordGeneration(db, sessionId); // the failed attempt's body never went live: its generation ends here (N3)
    return { ok: true, changed: true };
  });
}

// ── retire ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RetireInput { actor: RecordedActor; at: number; opKey: string }
export type RetireResult =
  | { ok: true; changed: false } | { ok: true; changed: true; term: number; owed: string[] } | AuthorityRefused | RowUnreadable | ActorRefused;

/** Question 8's three cases. Nothing live or pending: nothing written. A pending-only row: outcome `retired`, its id owed, its
 *  generation ended, no term raised, no append. A live row: appends `authority-retire` (raised term, `previousSessionId` the bound id) first, then
 *  unbinds, puts the bound id on `pastIds`, raises the term, cancels a pending attempt (`retired`) and owes both ids. A retire
 *  is a narrowing, so the journal answers `row-only` where it cannot append and the row is still written; any refusal
 *  (`not-in-transaction`) writes nothing. `owed` is the ids this call put on `stopsOwed`. The retiring actor is the row's. */
export function retire(db: DatabaseSync, journal: AuthorityAppender, i: RetireInput): RetireResult {
  if (actorRefused(i.actor)) return ACTOR_REFUSED;
  return tx(db, (): RetireResult => {
    const h = held(db);
    if ('ok' in h) return h;
    const row = h.row;
    if (row === null || (row.bound === null && row.pending === null)) return { ok: true, changed: false };
    const p = row.pending;
    if (row.bound === null) {
      const id = p!.sessionId;
      db.prepare(`UPDATE overlord_designation SET ${CLEAR_PENDING}, ${SET_ACTOR}, attemptId = ?, attemptOutcome = 'retired', attemptAt = ?, stopsOwed = ?, updatedAt = ? WHERE id = 1`)
        .run(...actorCols(i.actor), id, i.at, JSON.stringify(withId(row.stopsOwed, id)), i.at);
      endOverlordGeneration(db, id); // a cancelled pending body's generation ends `retired` too (review 2366 N3)
      return { ok: true, changed: true, term: row.term, owed: [id] };
    }
    const bound = row.bound.sessionId;
    const term = row.term + 1;
    const a = append(db, journal, { kind: 'authority-retire', opKey: i.opKey, term, previousSessionId: bound });
    if (!a.ok) return a;
    endOverlordGeneration(db, bound); // in this transaction: the retired body's live generation ends `retired` (review 2349 F4)
    if (p !== null) endOverlordGeneration(db, p.sessionId); // and the pending body's it cancels (review 2366 N3)
    const owed = p === null ? [bound] : withId([bound], p.sessionId);
    const stops = owed.reduce<readonly string[]>(withId, row.stopsOwed);
    const la = p === null ? row.lastAttempt : { sessionId: p.sessionId, outcome: 'retired' as const, at: i.at };
    db.prepare(`UPDATE overlord_designation SET ${CLEAR_PENDING}, sessionId = NULL, generation = NULL, term = ?, pastIds = ?, stopsOwed = ?, ${SET_ACTOR}, `
      + 'attemptId = ?, attemptOutcome = ?, attemptAt = ?, updatedAt = ? WHERE id = 1')
      .run(term, JSON.stringify(withId(row.pastIds, bound)), JSON.stringify(stops), ...actorCols(i.actor),
        la?.sessionId ?? null, la?.outcome ?? null, la?.at ?? null, i.at);
    return { ok: true, changed: true, term, owed };
  });
}

// ── applyDesignationRestoreInTx ──────────────────────────────────────────────────────────────────────────────────────

/** The stricter designation values Confirm writes (`overlordRestore.ts#restoreStricter`'s binding, term, account set and class). */
export interface DesignationRestore {
  readonly binding: { readonly kind: 'kept'; readonly sessionId: string } | { readonly kind: 'cleared' };
  readonly pastIdsJoin: readonly string[];
  readonly term: number;
  readonly model: OverlordModelClass;
  readonly accountPools: PoolSet;
}

/** Confirm the restore's writer of this row (authority journal C, ruling X3; Table 11.1a names Confirm among the row's
 *  writers): called ONLY in Confirm's transaction, AFTER `appendConfirmInTx`, and it appends nothing (the Confirm record carries
 *  these values). It writes the raised term (never `designatedTerm`), the stricter account set and class, and the binding:
 *  kept, the row's own session and generation stay (§3.1: a renewal is then due, `termRaised`); cleared, the row binds no
 *  session, both sides' ids join `pastIds`, and every body either side binds (the row's bound and pending sessions, and the
 *  session the journal's verified fold binds, which `pastIdsJoin` carries) is ended and owed its stop once, as a retire does (its
 *  pending attempt `retired`), so the operator starts the Overlord again (review 3334 F4). With no row, it inserts one holding
 *  the term, owing the stop of a body only the journal binds. A row it cannot read throws, so the caller's transaction rolls
 *  back. `owed` is the ids this call put on `stopsOwed`. */
export function applyDesignationRestoreInTx(db: DatabaseSync, r: DesignationRestore, actor: RecordedActor, at: number): { owed: string[] } {
  if (actorRefused(actor)) throw new Error('Confirm the restore writes the designation only as the account-gate operator');
  const h = held(db);
  if ('ok' in h) throw new Error(`the designation row could not be read: ${h.detail}`);
  const row = h.row;
  const pools = JSON.stringify({ pools: r.accountPools.pools, untagged: r.accountPools.untagged });
  if (row === null) {
    const journalOnly = r.binding.kind === 'cleared' ? r.pastIdsJoin.reduce<string[]>(withId, []) : [];
    for (const bodyId of journalOnly) endOverlordGeneration(db, bodyId);
    db.prepare('INSERT INTO overlord_designation (id, term, designatedTerm, model, accountPools, pastIds, stopsOwed, actor, actorKind, '
      + 'actorIssuer, actorStrength, updatedAt) VALUES (1, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.term, r.model, pools, JSON.stringify(r.pastIdsJoin.reduce<string[]>(withId, [])), JSON.stringify(journalOnly),
        ...actorCols(actor), at);
    return { owed: journalOnly };
  }
  if (r.binding.kind === 'kept') {
    if (row.bound === null || row.bound.sessionId !== r.binding.sessionId) throw new Error('Confirm keeps a binding the row does not hold');
    db.prepare(`UPDATE overlord_designation SET term = ?, model = ?, accountPools = ?, ${SET_ACTOR}, updatedAt = ? WHERE id = 1`)
      .run(r.term, r.model, pools, ...actorCols(actor), at);
    return { owed: [] };
  }
  const p = row.pending;
  const owed: string[] = [];
  for (const id of [row.bound?.sessionId, p?.sessionId, ...r.pastIdsJoin]) if (id !== undefined && !owed.includes(id)) owed.push(id);
  for (const owedId of owed) endOverlordGeneration(db, owedId);
  const la = p === null ? row.lastAttempt : { sessionId: p.sessionId, outcome: 'retired' as const, at };
  db.prepare(`UPDATE overlord_designation SET ${CLEAR_PENDING}, sessionId = NULL, generation = NULL, term = ?, model = ?, accountPools = ?, `
    + `pastIds = ?, stopsOwed = ?, ${SET_ACTOR}, attemptId = ?, attemptOutcome = ?, attemptAt = ?, updatedAt = ? WHERE id = 1`)
    .run(r.term, r.model, pools, JSON.stringify(r.pastIdsJoin.reduce<readonly string[]>(withId, row.pastIds)),
      JSON.stringify(owed.reduce<readonly string[]>(withId, row.stopsOwed)), ...actorCols(actor),
      la?.sessionId ?? null, la?.outcome ?? null, la?.at ?? null, at);
  return { owed };
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

// ── the Settings doors' writers (designation C, plan Tasks 8 and 9) ─────────────────────────────────────────────────────

export interface SettingInput { actor: RecordedActor; at: number; opKey: string }
export type SettingResult =
  | { ok: true; changed: false } | { ok: true; changed: true; journalled: boolean }
  | { ok: false; reason: 'not-found' } | AuthorityRefused | RowUnreadable | ActorRefused;

/** One Settings move, before its writer's own UPDATE (so the writers map sees each writer): the row read in this transaction,
 *  `changed: false` when the value is the row's own (an exact compare, so a reorder of the set is a change), else the authority
 *  record appended FIRST with the row's own value as its `from` (the duty, authority A review 2219 F2: a `from` stated wider than
 *  the row would read a widening as a narrowing, the journal's documented residual, so it is always this row's). `row-only`
 *  goes on with `journalled: false` (X3, X3b); a refusal answers and the writer writes nothing. */
function settingFirst<T>(db: DatabaseSync, journal: AuthorityAppender, pick: (r: DesignationView) => T, same: (v: T) => boolean,
  record: (from: T) => OverlordAuthorityMove): { done: SettingResult } | { journalled: boolean } {
  const h = held(db);
  if ('ok' in h) return { done: h };
  if (h.row === null) return { done: { ok: false, reason: 'not-found' } };
  const from = pick(h.row);
  if (same(from)) return { done: { ok: true, changed: false } };
  const a = append(db, journal, record(from));
  return a.ok ? { journalled: a.journalled } : { done: a };
}

/** C45: the model class, journalled as `authority-model-class` (`fable` widens, `opus` narrows: the journal's direction). */
export function setModelClass(db: DatabaseSync, journal: AuthorityAppender, i: SettingInput & { model: OverlordModelClass }): SettingResult {
  if (actorRefused(i.actor)) return ACTOR_REFUSED;
  return tx(db, (): SettingResult => {
    const first = settingFirst(db, journal, (r) => r.model, (m) => m === i.model,
      (from) => ({ kind: 'authority-model-class', opKey: i.opKey, from, to: i.model }));
    if ('done' in first) return first.done;
    db.prepare(`UPDATE overlord_designation SET model = ?, ${SET_ACTOR}, updatedAt = ? WHERE id = 1`).run(i.model, ...actorCols(i.actor), i.at);
    return { ok: true, changed: true, journalled: first.journalled };
  });
}

/** C46: the account set, journalled as `authority-account-set`. The journal canonicalises both lists, so a pure reorder is no
 *  change of membership there; the order lives in this row only. */
export function setAccountSet(db: DatabaseSync, journal: AuthorityAppender, i: SettingInput & { accountPools: PoolSet }): SettingResult {
  if (actorRefused(i.actor)) return ACTOR_REFUSED;
  const next = i.accountPools;
  return tx(db, (): SettingResult => {
    const first = settingFirst(db, journal, (r) => r.accountPools,
      (p) => p.untagged === next.untagged && p.pools.length === next.pools.length && p.pools.every((x, n) => x === next.pools[n]),
      (from) => ({ kind: 'authority-account-set', opKey: i.opKey, from, to: next }));
    if ('done' in first) return first.done;
    db.prepare(`UPDATE overlord_designation SET accountPools = ?, ${SET_ACTOR}, updatedAt = ? WHERE id = 1`)
      .run(JSON.stringify({ pools: next.pools, untagged: next.untagged }), ...actorCols(i.actor), i.at);
    return { ok: true, changed: true, journalled: first.journalled };
  });
}
