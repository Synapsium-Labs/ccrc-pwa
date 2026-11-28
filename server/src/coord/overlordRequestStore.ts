// The request record's store (Overlord spec §5.1, C9, H7, H22; plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-requests.md`
// Task A3). Ring L3, context C5: the one owner of the SQL of `overlord_requests`, `overlord_request_messages` and
// `overlord_request_moves`. It decides nothing: `./overlordRequests.ts` (L1) answers every rule, and this file reads the facts it
// asks for and writes what it answered.
//
// DECIDE BEFORE THE APPEND (RQ18, slug `decide-before-the-append`). Each writer is a read-only plan and an apply that cannot refuse.
// A door runs the plan inside its `tx()` and before the act journal's append; `DatabaseSync` is synchronous, so what the plan read
// is still true when the apply runs. The apply re-runs its plan against the rows and THROWS if the answer differs: inside the
// caller's transaction that rolls everything back, and it is a programming error, never a refusal word.
//
// ONE WRITER PER FACT. The insert writes the row, its citations and its `open` move. The move writer writes the state, raises
// `revision` by one (RQ7) and writes its move row with the act id it was given. `setParentClockInTx` is the one bookkeeping
// writer here: a parent's follow-up clock when a child opens or its last open child ends (F2). `appendMove` is the one writer of
// the moves table, private, for both appliers (F7). Every state change stamps one `request` line on the sequence, in the same
// transaction, through `stampRequestLine`; a self-loop changes no state word and stamps nothing.
//
// NO OPERATOR WORDS. Message ids and hashes only. The summary and the close note are the Overlord's words, masked at the door.
import type { DatabaseSync } from 'node:sqlite';
import {
  OPEN_REQUEST_STATES, REQUEST_ACTOR_SEQUENCE_KIND, REQUEST_BOUNDS, REQUEST_MOVE_FIELDS, isRequestState, isTerminalRequestState,
  type ExpectedPath, type RequestActor, type RequestColumn, type RequestMove, type RequestMoveReason, type RequestOrigin,
  type RequestState,
} from '../../../shared/overlordRequests.js';
import {
  answeredSinceNeedsYou, followUpAfterMove, nextRequestId, nextRequestState, openMoveVerdict, parentClockAfterChildMove,
  type RequestMoveRefusal,
} from './overlordRequests.js';
import { stampSequenceInTx, type SequenceLineInput } from './overlordSequenceStore.js';

/** One request as stored. `state` is the stored word: a word this build lacks is carried as it is, and no move leaves it. */
export interface RequestRow {
  readonly id: number; readonly origin: string; readonly summary: string; readonly owner: string | null;
  readonly parentRequestId: number | null; readonly consulted: readonly string[]; readonly state: string;
  /** Opaque JSON text, the relay's (index question 13). */
  readonly doneTest: string | null;
  readonly expectedPaths: readonly ExpectedPath[]; readonly dependsOn: string | null; readonly takenFrom: string | null;
  readonly openedAt: number; readonly lastNewsAt: number | null; readonly news: string | null; readonly followUpAt: number | null;
  readonly nudges: number;
  /** Opaque JSON text of the counter entries, appended by `counter` (coordinator doors RD6). */
  readonly counters: string;
  readonly closedAt: number | null; readonly closeNote: string | null; readonly revision: number;
}

/** One move as stored (RQ1): no text. `move` and the states are stored words, carried as they are. */
export interface RequestMoveRow {
  readonly id: number; readonly requestId: number; readonly move: string; readonly actorKind: string; readonly actor: string;
  readonly fromState: string | null; readonly toState: string; readonly reason: string | null; readonly actId: number | null;
  readonly revision: number; readonly at: number;
}

/** One cited message: its id, the hash the door verified, and whether this request founds on it (a root citation). */
export interface RequestCite { readonly messageId: number; readonly sha256: string; readonly root: boolean }

export interface RequestInsertInput {
  readonly origin: RequestOrigin; readonly summary: string; readonly parentRequestId: number | null;
  readonly consulted: readonly string[]; readonly expectedPaths: readonly ExpectedPath[]; readonly cites: readonly RequestCite[];
  /** The act journal's highest request id, or null until act journal B supplies it (RQ10). */
  readonly journalHighest: number | null;
  readonly actor: RequestActor; readonly actorId: string; readonly at: number;
}
export interface RequestInsertPlan {
  readonly input: RequestInsertInput; readonly id: number; readonly followUpAt: number | null;
}
export type RequestInsertRefusal = 'not-in-transaction' | 'wrong-actor' | 'bad-field' | 'root-taken' | 'parent-not-open' | 'parent-is-child';
const REQUEST_INSERT_REFUSAL_MAP: Record<RequestInsertRefusal, true> = {
  'not-in-transaction': true, 'wrong-actor': true, 'bad-field': true, 'root-taken': true, 'parent-not-open': true,
  'parent-is-child': true,
};

export interface RequestMoveInput {
  readonly id: number; readonly move: RequestMove; readonly actor: RequestActor; readonly actorId: string; readonly at: number;
  /** The revision the caller acted on; null for an operator's tap, which a stale revision never refuses (Q5). */
  readonly expectRevision: number | null;
  readonly reason: RequestMoveReason | null; readonly promiseAt: number | null;
  /** The columns this move sets (`REQUEST_MOVE_FIELDS`). `counters` is ONE entry, appended. */
  readonly set: Readonly<Partial<Record<RequestColumn, unknown>>>;
}
export interface RequestMovePlan {
  readonly input: RequestMoveInput; readonly from: RequestState; readonly to: RequestState; readonly revisionBefore: number;
  readonly followUpAt: number | null; readonly takenFrom: string | null;
}
export type RequestMovePlanRefusal = 'not-in-transaction' | 'not-found' | 'stale-revision' | 'bad-field' | RequestMoveRefusal;
/** The move plan's own refusals; the rest are the decider's (`RequestMoveRefusal`). */
const REQUEST_MOVE_PLAN_OWN_REFUSAL_MAP: Record<Exclude<RequestMovePlanRefusal, RequestMoveRefusal>, true> = {
  'not-in-transaction': true, 'not-found': true, 'stale-revision': true, 'bad-field': true,
};
/** The store's refusal words, from the two lists above: the coordination directory's kebab-token census admits them here. */
export const isRequestStoreKebab = (word: string): boolean =>
  Object.hasOwn(REQUEST_INSERT_REFUSAL_MAP, word) || Object.hasOwn(REQUEST_MOVE_PLAN_OWN_REFUSAL_MAP, word);

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const inTx = (db: DatabaseSync): boolean => { try { return db.isTransaction; } catch { return false; } };
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : typeof v === 'bigint' ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const json = <T>(v: unknown, fallback: T): T => { try { return typeof v === 'string' ? JSON.parse(v) as T : fallback; } catch { return fallback; } };

const ROW_COLS = 'id, origin, summary, owner, parentRequestId, consulted, state, doneTest, expectedPaths, dependsOn, takenFrom, '
  + 'openedAt, lastNewsAt, news, followUpAt, nudges, counters, closedAt, closeNote, revision';
const MOVE_COLS = 'id, requestId, move, actorKind, actor, fromState, toState, reason, actId, revision, at';

function rowOf(r: Record<string, unknown>): RequestRow {
  return {
    id: num(r.id) ?? 0, origin: str(r.origin) ?? '', summary: str(r.summary) ?? '', owner: str(r.owner),
    parentRequestId: num(r.parentRequestId), consulted: json<string[]>(r.consulted, []), state: str(r.state) ?? '',
    doneTest: str(r.doneTest), expectedPaths: json<ExpectedPath[]>(r.expectedPaths, []), dependsOn: str(r.dependsOn),
    takenFrom: str(r.takenFrom), openedAt: num(r.openedAt) ?? 0, lastNewsAt: num(r.lastNewsAt), news: str(r.news),
    followUpAt: num(r.followUpAt), nudges: num(r.nudges) ?? 0, counters: str(r.counters) ?? '[]', closedAt: num(r.closedAt),
    closeNote: str(r.closeNote), revision: num(r.revision) ?? 0,
  };
}
function moveOf(r: Record<string, unknown>): RequestMoveRow {
  return {
    id: num(r.id) ?? 0, requestId: num(r.requestId) ?? 0, move: str(r.move) ?? '', actorKind: str(r.actorKind) ?? '',
    actor: str(r.actor) ?? '', fromState: str(r.fromState), toState: str(r.toState) ?? '', reason: str(r.reason),
    actId: num(r.actId), revision: num(r.revision) ?? 0, at: num(r.at) ?? 0,
  };
}

// ── Readers ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function requestById(db: DatabaseSync, id: number): RequestRow | 'absent' {
  const r = db.prepare(`SELECT ${ROW_COLS} FROM overlord_requests WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r === undefined ? 'absent' : rowOf(r);
}

/** Every move of one request, oldest first. */
export function movesOf(db: DatabaseSync, id: number): readonly RequestMoveRow[] {
  return (db.prepare(`SELECT ${MOVE_COLS} FROM overlord_request_moves WHERE requestId = ? ORDER BY id`).all(id) as Record<string, unknown>[])
    .map(moveOf);
}

/** Every request whose stored state is not terminal (a word this build lacks counts as open: it is never dropped from view). */
export function openRequests(db: DatabaseSync): readonly RequestRow[] {
  return (db.prepare(`SELECT ${ROW_COLS} FROM overlord_requests ORDER BY id`).all() as Record<string, unknown>[])
    .map(rowOf).filter((r) => !(isRequestState(r.state) && isTerminalRequestState(r.state)));
}

export function highestRequestId(db: DatabaseSync): number | null {
  return num((db.prepare('SELECT max(id) AS m FROM overlord_requests').get() as { m: unknown }).m);
}

/** One citation row's two ids, for the boot pass's line naming citations that meet no message row (review 4190 F4). */
export interface CitationPair { readonly requestId: number; readonly messageId: number }
/** The citations the private store's boot pass reads (Task A4): every cited message id, the root-cited ones, and each row's
 *  request and message ids, by request then message. `absent` when the migration that creates the table is not applied,
 *  `unmeasured` when the read throws: three answers, never folded. */
export type CitedMessagesRead =
  | { readonly kind: 'measured'; readonly cited: ReadonlySet<number>; readonly rootCited: ReadonlySet<number>; readonly citing: readonly CitationPair[] }
  | { readonly kind: 'absent' } | { readonly kind: 'unmeasured'; readonly why: string };
export function citedMessagesForBoot(db: DatabaseSync): CitedMessagesRead {
  try {
    const t = db.prepare("SELECT 1 AS one FROM sqlite_master WHERE type = 'table' AND name = 'overlord_request_messages'").get();
    if (t === undefined) return { kind: 'absent' };
    const rows = db.prepare('SELECT requestId, messageId, root FROM overlord_request_messages ORDER BY requestId, messageId').all() as
      { requestId: unknown; messageId: unknown; root: unknown }[];
    const cited = new Set<number>();
    const rootCited = new Set<number>();
    const citing: CitationPair[] = [];
    for (const r of rows) {
      const id = num(r.messageId);
      if (id === null) return { kind: 'unmeasured', why: 'a citation row holds no integer message id' };
      const requestId = num(r.requestId);
      if (requestId === null) return { kind: 'unmeasured', why: 'a citation row holds no integer request id' };
      cited.add(id);
      if (num(r.root) === 1) rootCited.add(id);
      citing.push({ requestId, messageId: id });
    }
    return { kind: 'measured', cited, rootCited, citing };
  } catch (e) {
    return { kind: 'unmeasured', why: errText(e) };
  }
}

// ── The insert ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const isStrList = (v: readonly unknown[]): boolean => v.every((s) => typeof s === 'string' && s !== '');

function insertInputFault(r: RequestInsertInput): string | null {
  if (typeof r.summary !== 'string' || r.summary.length > REQUEST_BOUNDS.summaryChars) return 'summary';
  if (!Array.isArray(r.consulted) || r.consulted.length > REQUEST_BOUNDS.consulted || !isStrList(r.consulted)) return 'consulted';
  if (!Array.isArray(r.expectedPaths) || r.expectedPaths.length > REQUEST_BOUNDS.expectedPaths
    || !r.expectedPaths.every((p) => typeof p?.project === 'string' && typeof p.path === 'string')) return 'expectedPaths';
  if (!Array.isArray(r.cites) || r.cites.length > REQUEST_BOUNDS.cites) return 'cites';
  if (new Set(r.cites.map((c) => c.messageId)).size !== r.cites.length) return 'cites: a repeated message';
  const isRoot = r.parentRequestId === null;
  if (r.cites.some((c) => c.root !== isRoot)) return 'cites: a root request cites as root, a child never does';
  if (isRoot && (r.origin === 'operator') !== (r.cites.length > 0)) return 'origin: operator exactly when the root cites a message';
  return null;
}

/** Read-only, inside the caller's `tx()`: everything that can refuse an insert (RQ18, F1). */
export function planRequestInsertInTx(db: DatabaseSync, r: RequestInsertInput):
  { readonly ok: true; readonly plan: RequestInsertPlan } | { readonly ok: false; readonly why: RequestInsertRefusal; readonly detail: string } {
  if (!inTx(db)) return { ok: false, why: 'not-in-transaction', detail: 'a request is planned only inside the transaction that writes it' };
  const actor = openMoveVerdict(r.actor);
  if (!actor.ok) return { ok: false, why: 'wrong-actor', detail: r.actor };
  const fault = insertInputFault(r);
  if (fault !== null) return { ok: false, why: 'bad-field', detail: fault };
  const taken = db.prepare('SELECT requestId FROM overlord_request_messages WHERE messageId = ? AND root = 1');
  for (const c of r.cites.filter((x) => x.root)) {
    if (taken.get(c.messageId) !== undefined) return { ok: false, why: 'root-taken', detail: `message ${c.messageId}` };
  }
  if (r.parentRequestId !== null) {
    const parent = requestById(db, r.parentRequestId);
    if (parent === 'absent' || !(isRequestState(parent.state) && OPEN_REQUEST_STATES.includes(parent.state))) {
      return { ok: false, why: 'parent-not-open', detail: `request ${r.parentRequestId}` };
    }
    if (parent.parentRequestId !== null) return { ok: false, why: 'parent-is-child', detail: `request ${r.parentRequestId}` };
    if (parent.origin !== r.origin) return { ok: false, why: 'bad-field', detail: "origin: a child takes its root's" };
  }
  const id = nextRequestId(highestRequestId(db), r.journalHighest);
  const followUpAt = followUpAfterMove({ to: actor.to, openChildren: 0, at: r.at, promiseAt: null });
  return { ok: true, plan: { input: r, id, followUpAt } };
}

/** Applies a plan made in the same `tx()`: the row, its citations, its `open` move (actId null: the act links back through its
 *  `opens`, RQ18), a parent's cleared clock, and the stamp. Throws when the plan no longer holds. */
export function applyRequestInsertInTx(db: DatabaseSync, plan: RequestInsertPlan): { readonly row: RequestRow; readonly seq: number } {
  const again = planRequestInsertInTx(db, plan.input);
  if (!again.ok || again.plan.id !== plan.id || again.plan.followUpAt !== plan.followUpAt) {
    throw new Error(`request insert apply disagrees with its plan (${again.ok ? 'id or clock' : again.why})`);
  }
  const r = plan.input;
  db.prepare('INSERT INTO overlord_requests (id, origin, summary, parentRequestId, consulted, state, expectedPaths, openedAt, followUpAt) '
    + "VALUES (?, ?, ?, ?, ?, 'received', ?, ?, ?)")
    .run(plan.id, r.origin, r.summary, r.parentRequestId, JSON.stringify(r.consulted), JSON.stringify(r.expectedPaths), r.at, plan.followUpAt);
  const cite = db.prepare('INSERT INTO overlord_request_messages (requestId, messageId, sha256, root, at) VALUES (?, ?, ?, ?, ?)');
  for (const c of r.cites) cite.run(plan.id, c.messageId, c.sha256, c.root ? 1 : 0, r.at);
  appendMove(db, { requestId: plan.id, move: 'open', actorKind: r.actor, actor: r.actorId, fromState: null, toState: 'received',
    reason: null, actId: null, revision: 0, at: r.at });
  if (r.parentRequestId !== null) setParentClockInTx(db, r.parentRequestId, null);
  const seq = stampRequestLine(db, { kind: 'request', id: String(plan.id), state: 'received', actor: r.actorId,
    actorKind: REQUEST_ACTOR_SEQUENCE_KIND[r.actor], at: r.at });
  const row = requestById(db, plan.id);
  if (row === 'absent') throw new Error(`request ${plan.id} not read back after its insert`);
  return { row, seq };
}

// ── The move ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function fieldFault(set: RequestMoveInput['set']): string | null {
  for (const [k, v] of Object.entries(set)) {
    if (k === 'owner' && !(typeof v === 'string' && v !== '')) return 'owner';
    if (k === 'dependsOn' && !(typeof v === 'string' && v !== '')) return 'dependsOn';
    if (k === 'closeNote' && !(typeof v === 'string' && v !== '' && v.length <= REQUEST_BOUNDS.closeNoteChars)) return 'closeNote';
    if (k === 'expectedPaths' && !(Array.isArray(v) && v.length <= REQUEST_BOUNDS.expectedPaths
      && v.every((p: { project?: unknown; path?: unknown }) => typeof p?.project === 'string' && typeof p.path === 'string'))) return 'expectedPaths';
    if ((k === 'doneTest' || k === 'counters') && v === undefined) return k;
  }
  return null;
}

type MovePlanAnswer =
  | { readonly ok: true; readonly plan: RequestMovePlan }
  | { readonly ok: false; readonly why: RequestMovePlanRefusal; readonly row: RequestRow | null; readonly lastMove: RequestMoveRow | null };

/** Read-only, inside the caller's `tx()`: the row, its revision, `nextRequestState` with its guards, and the fields (RQ18, F1). */
export function planRequestMoveInTx(db: DatabaseSync, m: RequestMoveInput): MovePlanAnswer {
  if (!inTx(db)) return { ok: false, why: 'not-in-transaction', row: null, lastMove: null };
  const row = requestById(db, m.id);
  if (row === 'absent') return { ok: false, why: 'not-found', row: null, lastMove: null };
  const moves = movesOf(db, m.id);
  const lastMove = moves.at(-1) ?? null;
  const refuse = (why: RequestMovePlanRefusal): MovePlanAnswer => ({ ok: false, why, row, lastMove });
  if (m.expectRevision !== null && m.expectRevision !== row.revision) return refuse('stale-revision');
  if (!isRequestState(row.state)) return refuse('not-from');
  const children = (db.prepare('SELECT state FROM overlord_requests WHERE parentRequestId = ?').all(m.id) as { state: unknown }[])
    .map((c) => str(c.state) ?? '');
  const openChildren = children.filter((s) => !(isRequestState(s) && isTerminalRequestState(s))).length;
  const takenFrom = row.takenFrom !== null && isRequestState(row.takenFrom) ? row.takenFrom : row.takenFrom === null ? null : 'needs-you';
  const verdict = nextRequestState(row.state, m.move, m.actor, {
    answered: answeredSinceNeedsYou(moves), takenFrom, ownerAcknowledged: moves.some((x) => x.move === 'acknowledge'),
    openChildren, hasChildren: children.length > 0, fields: Object.keys(m.set) as RequestColumn[], reason: m.reason,
  });
  if (!verdict.ok) return refuse(verdict.why);
  if (fieldFault(m.set) !== null) return refuse('bad-field');
  const leavesNeedsYou = row.state === 'needs-you' && verdict.to !== 'needs-you';
  return {
    ok: true,
    plan: {
      input: m, from: row.state, to: verdict.to, revisionBefore: row.revision,
      followUpAt: followUpAfterMove({ to: verdict.to, openChildren, at: m.at, promiseAt: m.promiseAt }),
      takenFrom: m.move === 'take' ? row.state : leavesNeedsYou ? null : row.takenFrom,
    },
  };
}

/** Applies a plan made in the same `tx()`: the row (with its one revision raise), the move row with the act id, a parent's clock
 *  when this move ends its last open child (F2), and the stamp when the state word changed. Throws when the plan no longer holds. */
export function applyRequestMoveInTx(db: DatabaseSync, plan: RequestMovePlan, actId: number | null):
  { readonly row: RequestRow; readonly move: RequestMoveRow; readonly seq: number | null } {
  const again = planRequestMoveInTx(db, plan.input);
  if (!again.ok || again.plan.to !== plan.to || again.plan.revisionBefore !== plan.revisionBefore
    || again.plan.followUpAt !== plan.followUpAt || again.plan.takenFrom !== plan.takenFrom) {
    throw new Error(`request move apply disagrees with its plan (${again.ok ? 'the row changed' : again.why})`);
  }
  const m = plan.input;
  const before = requestById(db, m.id);
  if (before === 'absent') throw new Error(`request ${m.id} vanished between its plan and its apply`);
  const set = m.set;
  const allowed = REQUEST_MOVE_FIELDS[m.move];
  const pick = <T>(col: RequestColumn, mine: T, value: () => T): T => (allowed.includes(col) && Object.hasOwn(set, col) ? value() : mine);
  const counters = pick('counters', before.counters, () => JSON.stringify([...json<unknown[]>(before.counters, []), set.counters]));
  const ended = isTerminalRequestState(plan.to);
  const w = db.prepare('UPDATE overlord_requests SET state = ?, owner = ?, doneTest = ?, expectedPaths = ?, dependsOn = ?, '
    + 'takenFrom = ?, counters = ?, followUpAt = ?, closedAt = ?, closeNote = ?, revision = revision + 1 WHERE id = ? AND revision = ?')
    .run(plan.to, pick('owner', before.owner, () => set.owner as string),
      pick('doneTest', before.doneTest, () => JSON.stringify(set.doneTest)),
      JSON.stringify(pick('expectedPaths', before.expectedPaths, () => set.expectedPaths as ExpectedPath[])),
      pick('dependsOn', before.dependsOn, () => set.dependsOn as string), plan.takenFrom, counters, plan.followUpAt,
      ended ? m.at : before.closedAt, pick('closeNote', before.closeNote, () => set.closeNote as string), m.id, plan.revisionBefore);
  if (Number(w.changes) !== 1) throw new Error(`request ${m.id} not moved: its revision moved under the apply`);
  const move = appendMove(db, { requestId: m.id, move: m.move, actorKind: m.actor, actor: m.actorId, fromState: plan.from,
    toState: plan.to, reason: m.reason, actId, revision: plan.revisionBefore + 1, at: m.at });
  if (ended && before.parentRequestId !== null) {
    const parent = requestById(db, before.parentRequestId);
    if (parent !== 'absent' && isRequestState(parent.state)) {
      const open = (db.prepare('SELECT state FROM overlord_requests WHERE parentRequestId = ?').all(parent.id) as { state: unknown }[])
        .filter((c) => { const s = str(c.state) ?? ''; return !(isRequestState(s) && isTerminalRequestState(s)); }).length;
      const clock = parentClockAfterChildMove({ parentState: parent.state, openChildrenAfter: open, at: m.at });
      if (clock !== null) setParentClockInTx(db, parent.id, clock);
    }
  }
  const seq = plan.to === plan.from ? null : stampRequestLine(db, { kind: 'request', id: String(m.id), state: plan.to,
    actor: m.actorId, actorKind: REQUEST_ACTOR_SEQUENCE_KIND[m.actor], at: m.at });
  const row = requestById(db, m.id);
  if (row === 'absent') throw new Error(`request ${m.id} not read back after its move`);
  return { row, move, seq };
}

// ── The private writers ────────────────────────────────────────────────────────────────────────────────────────────────

/** The one bookkeeping writer of a parent's follow-up clock: cleared when a child opens, an hour on when its last open child ends
 *  (F2). It raises no revision (RQ7). */
function setParentClockInTx(db: DatabaseSync, parentId: number, followUpAt: number | null): void {
  db.prepare('UPDATE overlord_requests SET followUpAt = ? WHERE id = ?').run(followUpAt, parentId);
}

/** The one writer of `overlord_request_moves` (F7), for both appliers. Nothing updates or deletes a move row. */
function appendMove(db: DatabaseSync, m: Omit<RequestMoveRow, 'id'>): RequestMoveRow {
  const r = db.prepare('INSERT INTO overlord_request_moves (requestId, move, actorKind, actor, fromState, toState, reason, actId, revision, at) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(m.requestId, m.move, m.actorKind, m.actor, m.fromState, m.toState, m.reason, m.actId, m.revision, m.at);
  return { id: Number(r.lastInsertRowid), ...m };
}

/** The `request` kind's stamp: the writer's answer checked, and a refusal thrown so the row rolls back with the line. */
function stampRequestLine(db: DatabaseSync, line: SequenceLineInput): number {
  const s = stampSequenceInTx(db, line);
  if (!s.ok) throw new Error(`request line refused: ${s.error}: ${s.detail}`);
  return s.seq;
}
