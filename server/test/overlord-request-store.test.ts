// Overlord W2, request record A (plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-requests.md` Task A3): the request store, the
// one owner of the SQL of `overlord_requests`, `overlord_request_messages` and `overlord_request_moves`. Each writer is a read-only
// plan and an apply that cannot refuse. Fixture databases in temp dirs only, neutral names, never the live HOME.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { tx } from '../src/coord/tx.js';
import {
  applyRequestInsertInTx, applyRequestMoveInTx, highestRequestId, movesOf, openRequests, planRequestInsertInTx, planRequestMoveInTx,
  requestById, type RequestInsertInput, type RequestMoveInput,
} from '../src/coord/overlordRequestStore.js';
import { nextRequestId } from '../src/coord/overlordRequests.js';
import { REQUEST_ACTOR_SEQUENCE_KIND, REQUEST_BOUNDS, REQUEST_NEXT_MOVE_MS, type RequestActor, type RequestMove } from '../../shared/overlordRequests.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

let template = '';
const opened: DatabaseSync[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-request-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } } });
afterAll(() => removeTmpFixtures());

const openDb = (): DatabaseSync => {
  const dir = path.join(mkTmp('ccrc-request-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  return db;
};

const AT = 1_800_000_000_000;
const HOUR = REQUEST_NEXT_MOVE_MS;
const ACTOR_ID: Record<RequestActor, string> = { overlord: 'overlord-a', owner: 'lane-a-project-a', server: 'server', operator: 'acct:operator-a' };

// ---------------------------------------------------------------------------------------------------------------- helpers

type Refusal = { ok: false; why: string; detail?: string; row?: unknown; lastMove?: unknown };

const insertInput = (over: Partial<RequestInsertInput> = {}): RequestInsertInput => ({
  origin: 'overlord', summary: 'a summary', parentRequestId: null, consulted: [], expectedPaths: [], cites: [], journalHighest: null,
  actor: 'overlord', actorId: ACTOR_ID.overlord, at: AT, ...over,
});
/** Plan and apply one insert in one transaction; a refusal is returned, and nothing was written. */
const tryOpen = (db: DatabaseSync, over: Partial<RequestInsertInput> = {}) => tx(db, () => {
  const p = planRequestInsertInTx(db, insertInput(over));
  return p.ok ? { ok: true as const, ...applyRequestInsertInTx(db, p.plan) } : p as Refusal;
});
const open = (db: DatabaseSync, over: Partial<RequestInsertInput> = {}): number => {
  const r = tryOpen(db, over);
  if (!r.ok) throw new Error(`open refused: ${r.why}`);
  return r.row.id;
};
const root = (messageId: number, sha256 = 'a'.repeat(64)) => ({ messageId, sha256, root: true });

const moveInput = (id: number, move: RequestMove, over: Partial<RequestMoveInput> = {}): RequestMoveInput => {
  const actor = over.actor ?? ({
    open: 'overlord', route: 'overlord', 're-relay': 'overlord', 'route-elsewhere': 'overlord', drop: 'overlord', escalate: 'overlord',
    acknowledge: 'owner', counter: 'owner', decline: 'owner', block: 'owner', fail: 'owner',
  } as Partial<Record<RequestMove, RequestActor>>)[move] ?? (move.startsWith('hand-back') || ['answer', 'answer-recorded', 'take', 'confirm', 'withdraw'].includes(move)
    ? 'operator' : 'server');
  return { id, move, actor, actorId: ACTOR_ID[actor], at: AT + 10, expectRevision: null, reason: null, promiseAt: null, set: {}, ...over };
};
/** Plan and apply one move in one transaction; a refusal is returned, and nothing was written. */
const tryMove = (db: DatabaseSync, id: number, move: RequestMove, over: Partial<RequestMoveInput> = {}, actId: number | null = null) => tx(db, () => {
  const p = planRequestMoveInTx(db, moveInput(id, move, over));
  return p.ok ? { ok: true as const, ...applyRequestMoveInTx(db, p.plan, actId) } : p as Refusal;
});
const mv = (db: DatabaseSync, id: number, move: RequestMove, over: Partial<RequestMoveInput> = {}, actId: number | null = null) => {
  const r = tryMove(db, id, move, over, actId);
  if (!r.ok) throw new Error(`${move} refused: ${r.why}`);
  return r;
};

const REASON: Partial<Record<RequestMove, RequestMoveInput['reason']>> = {
  escalate: 'needs-start', drop: 'dropped', take: 'operator-took-it', 'needs-you': 'two-counters',
};
const CLOSE = { closeNote: 'a note' };
/** received -> routed -> in-progress, the owner having acknowledged. */
const toInProgress = (db: DatabaseSync, id: number): void => {
  mv(db, id, 'route', { set: { owner: 'project-a' } });
  mv(db, id, 'acknowledge');
};
const toNeedsYou = (db: DatabaseSync, id: number): void => { mv(db, id, 'escalate', { reason: 'needs-start' }); };

const count = (db: DatabaseSync, sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
const requestLines = (db: DatabaseSync) => db.prepare("SELECT * FROM overlord_sequence WHERE kind = 'request' ORDER BY seq").all() as
  { seq: number; kind: string; id: string; state: string; actor: string; actorKind: string; at: number }[];
/** Every row of the three tables and the sequence, for a before/after equality. */
const snap = (db: DatabaseSync): string => JSON.stringify(['overlord_requests', 'overlord_request_messages', 'overlord_request_moves', 'overlord_sequence']
  .map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()));

// ----------------------------------------------------------------------------------------------------------------- insert

describe('planRequestInsertInTx and applyRequestInsertInTx', () => {
  it('the apply writes a received request with its own clock an hour on, its citations and its open move (actId null), and one request line', () => {
    const db = openDb();
    const r = tryOpen(db, { origin: 'operator', cites: [root(7, 'b'.repeat(64)), root(8)], summary: 'one line', consulted: ['project-a'],
      expectedPaths: [{ project: 'project-a', path: 'src/x.ts' }] });
    if (!r.ok) throw new Error(r.why);
    expect(r.row).toMatchObject({ id: 1, origin: 'operator', summary: 'one line', state: 'received', owner: null, parentRequestId: null,
      consulted: ['project-a'], expectedPaths: [{ project: 'project-a', path: 'src/x.ts' }], openedAt: AT, followUpAt: AT + HOUR, revision: 0,
      closedAt: null, closeNote: null, takenFrom: null, nudges: 0 });
    expect(db.prepare('SELECT messageId, sha256, root, at, requestId FROM overlord_request_messages ORDER BY messageId').all()).toEqual([
      { messageId: 7, sha256: 'b'.repeat(64), root: 1, at: AT, requestId: 1 }, { messageId: 8, sha256: 'a'.repeat(64), root: 1, at: AT, requestId: 1 },
    ]);
    const moves = movesOf(db, 1);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ move: 'open', actorKind: 'overlord', actor: 'overlord-a', fromState: null, toState: 'received', reason: null,
      actId: null, revision: 0, at: AT });
    expect(requestLines(db)).toEqual([{ seq: r.seq, kind: 'request', id: '1', state: 'received', actor: 'overlord-a', actorKind: 'session', at: AT }]);
    expect(count(db, 'SELECT count(*) AS n FROM overlord_sequence')).toBe(1);
  });

  it('refuses a root citation another root request holds (root-taken), a closed parent, and a child of a child, and writes nothing', () => {
    const db = openDb();
    const a = open(db, { origin: 'operator', cites: [root(7)] });
    const closed = open(db);
    mv(db, closed, 'drop', { reason: 'dropped', set: CLOSE });
    const child = open(db, { parentRequestId: a, origin: 'operator' });
    const before = snap(db);
    expect(tryOpen(db, { origin: 'operator', cites: [root(7)] })).toMatchObject({ ok: false, why: 'root-taken' });
    expect(tryOpen(db, { parentRequestId: closed })).toMatchObject({ ok: false, why: 'parent-not-open' });
    expect(tryOpen(db, { parentRequestId: 999 })).toMatchObject({ ok: false, why: 'parent-not-open' });
    expect(tryOpen(db, { parentRequestId: child, origin: 'operator' })).toMatchObject({ ok: false, why: 'parent-is-child' });
    expect(snap(db)).toBe(before);
  });

  it('refuses a wrong actor, a bad field and a child that does not take its root\'s origin, each as a word', () => {
    const db = openDb();
    const p = open(db, { origin: 'operator', cites: [root(7)] });
    const before = snap(db);
    expect(tryOpen(db, { actor: 'owner' })).toMatchObject({ ok: false, why: 'wrong-actor' });
    expect(tryOpen(db, { actor: 'operator' })).toMatchObject({ ok: false, why: 'wrong-actor' });
    expect(tryOpen(db, { summary: 'x'.repeat(REQUEST_BOUNDS.summaryChars + 1) })).toMatchObject({ ok: false, why: 'bad-field' });
    expect(tryOpen(db, { consulted: Array.from({ length: REQUEST_BOUNDS.consulted + 1 }, (_, i) => `project-${i}`) })).toMatchObject({ ok: false, why: 'bad-field' });
    expect(tryOpen(db, { origin: 'operator', cites: [] })).toMatchObject({ ok: false, why: 'bad-field' });
    expect(tryOpen(db, { origin: 'overlord', cites: [root(9)] })).toMatchObject({ ok: false, why: 'bad-field' });
    expect(tryOpen(db, { parentRequestId: p, origin: 'overlord' })).toMatchObject({ ok: false, why: 'bad-field' });
    expect(snap(db)).toBe(before);
  });

  it('a child clears its parent\'s clock, leaves its revision alone, and takes its own clock; the sequence gains only the child\'s line', () => {
    const db = openDb();
    const parent = open(db);
    expect(requestById(db, parent)).toMatchObject({ followUpAt: AT + HOUR, revision: 0 });
    const child = open(db, { parentRequestId: parent, at: AT + 5 });
    expect(requestById(db, parent)).toMatchObject({ followUpAt: null, revision: 0 });
    expect(requestById(db, child)).toMatchObject({ parentRequestId: parent, followUpAt: AT + 5 + HOUR, origin: 'overlord' });
    expect(requestLines(db).map((l) => l.id)).toEqual([String(parent), String(child)]);
  });

  it('a child cites as a non-root: its citations never take the root slot', () => {
    const db = openDb();
    const parent = open(db, { origin: 'operator', cites: [root(7)] });
    expect(tryOpen(db, { parentRequestId: parent, origin: 'operator', cites: [root(7)] })).toMatchObject({ ok: false, why: 'bad-field' });
    const child = open(db, { parentRequestId: parent, origin: 'operator', cites: [{ messageId: 7, sha256: 'a'.repeat(64), root: false }] });
    expect(db.prepare('SELECT root FROM overlord_request_messages WHERE requestId = ?').all(child)).toEqual([{ root: 0 }]);
    // The slot is still the parent's: another root request cannot take message 7.
    expect(tryOpen(db, { origin: 'operator', cites: [root(7)] })).toMatchObject({ ok: false, why: 'root-taken' });
  });

  it('a repeated cited message is a bad field', () => {
    const db = openDb();
    expect(tryOpen(db, { origin: 'operator', cites: [root(7), root(7)] })).toMatchObject({ ok: false, why: 'bad-field' });
  });
});

describe('request ids', () => {
  it('come from nextRequestId: a journal highest above the store\'s gives it plus one, and the store\'s own highest otherwise', () => {
    const db = openDb();
    expect(open(db)).toBe(1);
    expect(open(db)).toBe(2);
    expect(open(db, { journalHighest: 40 })).toBe(41);
    expect(open(db, { journalHighest: 5 })).toBe(42);
    expect(highestRequestId(db)).toBe(42);
    expect(nextRequestId(highestRequestId(db), 99)).toBe(100);
  });

  it('are not reissued after a row below the highest is deleted by hand, and a journal highest keeps the top one safe too', () => {
    const db = openDb();
    const a = open(db); const b = open(db); const c = open(db);
    expect([a, b, c]).toEqual([1, 2, 3]);
    db.prepare('DELETE FROM overlord_requests WHERE id = ?').run(b);
    expect(open(db)).toBe(4);
    db.prepare('DELETE FROM overlord_requests WHERE id = ?').run(4);
    // The act journal's highest is what holds the top id out of reach once its row is gone.
    expect(open(db, { journalHighest: 4 })).toBe(5);
  });
});

// ------------------------------------------------------------------------------------------------------------------- move

describe('planRequestMoveInTx and applyRequestMoveInTx', () => {
  it('walks the owner\'s way: each apply raises the revision by one, writes its move row with the act id, and stamps a line only on a state change', () => {
    const db = openDb();
    const id = open(db);
    expect(requestLines(db)).toHaveLength(1);

    const route = mv(db, id, 'route', { set: { owner: 'project-a', doneTest: { kind: 'merged' } } }, 11);
    expect(route.row).toMatchObject({ state: 'routed', owner: 'project-a', revision: 1, followUpAt: AT + 10 + HOUR, closedAt: null });
    expect(JSON.parse(route.row.doneTest ?? 'null')).toEqual({ kind: 'merged' });
    expect(route.move).toMatchObject({ move: 'route', actorKind: 'overlord', actor: 'overlord-a', fromState: 'received', toState: 'routed', actId: 11, revision: 1 });
    expect(route.seq).toEqual(expect.any(Number));

    const re = mv(db, id, 're-relay', { set: { owner: 'project-b' }, at: AT + 20 }, 12);
    expect(re.row).toMatchObject({ state: 'routed', owner: 'project-b', revision: 2, followUpAt: AT + 20 + HOUR });
    expect(re.move).toMatchObject({ move: 're-relay', fromState: 'routed', toState: 'routed', revision: 2, actId: 12 });
    expect(re.seq).toBeNull();

    const counter = mv(db, id, 'counter', { set: { counters: { at: AT + 30, summary: 'try x' } } }, 13);
    expect(counter.row.revision).toBe(3);
    expect(counter.seq).toBeNull();

    const ack = mv(db, id, 'acknowledge', {}, 14);
    expect(ack.row).toMatchObject({ state: 'in-progress', revision: 4 });
    expect(ack.seq).toEqual(expect.any(Number));

    const block = mv(db, id, 'block', { set: { dependsOn: 'programme:project-c' } });
    expect(block.row).toMatchObject({ state: 'blocked', dependsOn: 'programme:project-c', followUpAt: null, revision: 5 });

    expect(mv(db, id, 'unblock').row).toMatchObject({ state: 'in-progress', revision: 6 });
    expect(mv(db, id, 'close-unverified').row).toMatchObject({ state: 'done-unverified', followUpAt: null, revision: 7 });
    const done = mv(db, id, 'confirm', { at: AT + 99, set: CLOSE });
    expect(done.row).toMatchObject({ state: 'done', closedAt: AT + 99, closeNote: 'a note', followUpAt: null, revision: 8 });

    expect(movesOf(db, id).map((m) => [m.move, m.revision, m.actId])).toEqual([
      ['open', 0, null], ['route', 1, 11], ['re-relay', 2, 12], ['counter', 3, 13], ['acknowledge', 4, 14], ['block', 5, null],
      ['unblock', 6, null], ['close-unverified', 7, null], ['confirm', 8, null],
    ]);
    // One line for the open and one for each state change: route, acknowledge, block, unblock, close-unverified, confirm.
    expect(requestLines(db).map((l) => l.state)).toEqual(['received', 'routed', 'in-progress', 'blocked', 'in-progress', 'done-unverified', 'done']);
  });

  it('a self-loop (re-relay, counter, answer-recorded) raises the revision and writes a move row but stamps NO line; a state change stamps exactly one', () => {
    const db = openDb();
    const id = open(db);
    mv(db, id, 'route', { set: { owner: 'project-a' } });
    const lines0 = count(db, 'SELECT count(*) AS n FROM overlord_sequence');
    const moves0 = movesOf(db, id).length;
    for (const [i, m] of (['re-relay', 'counter'] as const).entries()) {
      const set = m === 're-relay' ? { owner: 'project-a' } : { counters: { n: i } };
      const r = mv(db, id, m, { set });
      expect(r.seq, m).toBeNull();
      expect(r.row.revision, m).toBe(2 + i);
    }
    expect(count(db, 'SELECT count(*) AS n FROM overlord_sequence')).toBe(lines0);
    expect(movesOf(db, id)).toHaveLength(moves0 + 2);

    const other = open(db);
    toNeedsYou(db, other);
    const rev = requestById(db, other);
    if (rev === 'absent') throw new Error('absent');
    const n1 = count(db, 'SELECT count(*) AS n FROM overlord_sequence');
    const rec = mv(db, other, 'answer-recorded');
    expect(rec.seq).toBeNull();
    expect(rec.row.revision).toBe(rev.revision + 1);
    expect(count(db, 'SELECT count(*) AS n FROM overlord_sequence')).toBe(n1);
    expect(movesOf(db, other).at(-1)).toMatchObject({ move: 'answer-recorded', fromState: 'needs-you', toState: 'needs-you' });

    const n2 = count(db, 'SELECT count(*) AS n FROM overlord_sequence');
    const dropped = mv(db, other, 'drop', { reason: 'dropped', set: CLOSE });
    expect(dropped.seq).toEqual(expect.any(Number));
    expect(count(db, 'SELECT count(*) AS n FROM overlord_sequence')).toBe(n2 + 1);
  });

  it('each state-changing move stamps its line with the right state and the actor kind of its actor', () => {
    const db = openDb();
    const id = open(db);
    mv(db, id, 'route', { set: { owner: 'project-a' } });                        // overlord -> session
    mv(db, id, 'acknowledge');                                                   // owner    -> session
    mv(db, id, 'needs-you', { reason: 'two-counters' });                         // server   -> server
    mv(db, id, 'answer');                                                        // operator -> operator
    mv(db, id, 'take', { reason: 'operator-took-it' });                          // operator -> operator
    mv(db, id, 'hand-back-in-progress');                                         // operator -> operator
    mv(db, id, 'close', { set: CLOSE });                                         // server   -> server
    const lines = requestLines(db);
    expect(lines.map((l) => [l.state, l.actor, l.actorKind])).toEqual([
      ['received', 'overlord-a', REQUEST_ACTOR_SEQUENCE_KIND.overlord],
      ['routed', 'overlord-a', 'session'],
      ['in-progress', 'lane-a-project-a', REQUEST_ACTOR_SEQUENCE_KIND.owner],
      ['needs-you', 'server', 'server'],
      ['in-progress', 'acct:operator-a', 'operator'],
      ['needs-you', 'acct:operator-a', 'operator'],
      ['in-progress', 'acct:operator-a', 'operator'],
      ['done', 'server', 'server'],
    ]);
    expect(lines.every((l) => l.id === String(id) && l.kind === 'request')).toBe(true);
  });

  it('refuses a move the table or a guard refuses, with a word, and writes nothing (row, moves and sequence unchanged)', () => {
    const db = openDb();
    const id = open(db);
    const before = snap(db);
    const why = (m: RequestMove, over: Partial<RequestMoveInput> = {}): string => (tryMove(db, id, m, over) as Refusal).why;
    expect(why('acknowledge')).toBe('not-from');                                 // received is not routed
    expect(why('route', { actor: 'owner', actorId: ACTOR_ID.owner, set: { owner: 'project-a' } })).toBe('wrong-actor');
    expect(why('route', { set: { dependsOn: 'x' } })).toBe('field-not-allowed');
    expect(why('route', { reason: 'dropped', set: { owner: 'project-a' } })).toBe('reason-not-allowed');
    expect(why('escalate')).toBe('reason-required');
    expect(why('escalate', { reason: 'dropped' })).toBe('reason-not-allowed');
    expect(why('drop', { reason: 'dropped' })).toBe('field-required');
    expect(why('drop', { set: CLOSE })).toBe('reason-required');
    expect(why('route', { set: { owner: '' } })).toBe('bad-field');
    expect(why('drop', { reason: 'dropped', set: { closeNote: 'x'.repeat(REQUEST_BOUNDS.closeNoteChars + 1) } })).toBe('bad-field');
    expect(why('open')).toBe('not-from');
    expect((tryMove(db, 999, 'route', { set: { owner: 'project-a' } }) as Refusal)).toMatchObject({ ok: false, why: 'not-found', row: null, lastMove: null });
    expect(snap(db)).toBe(before);
  });

  it('a stored state word this build lacks is never left by any move, and it reads as open', () => {
    const db = openDb();
    const id = open(db);
    db.prepare("UPDATE overlord_requests SET state = 'from-a-later-build' WHERE id = ?").run(id);
    const before = snap(db);
    for (const m of ['route', 'drop', 'withdraw'] as const) {
      expect((tryMove(db, id, m, { set: m === 'route' ? { owner: 'project-a' } : CLOSE, reason: m === 'drop' ? 'dropped' : null }) as Refusal).why, m).toBe('not-from');
    }
    expect(snap(db)).toBe(before);
    expect(openRequests(db).map((r) => r.id)).toEqual([id]);
  });

  it('F5: an Overlord move on a row the operator holds is `taken`, and on a needs-you row before the answer `not-answered`, whatever its from', () => {
    const db = openDb();
    const held = open(db);
    toInProgress(db, held);
    mv(db, held, 'take', { reason: 'operator-took-it' });
    const before = snap(db);
    // `route` does not even start from needs-you: the guard answers before the `from` is read.
    expect((tryMove(db, held, 'route', { set: { owner: 'project-a' } }) as Refusal).why).toBe('taken');
    expect((tryMove(db, held, 'drop', { reason: 'dropped', set: CLOSE }) as Refusal).why).toBe('taken');
    expect(snap(db)).toBe(before);

    const waiting = open(db);
    toNeedsYou(db, waiting);
    expect((tryMove(db, waiting, 'drop', { reason: 'dropped', set: CLOSE }) as Refusal).why).toBe('not-answered');
    expect((tryMove(db, waiting, 'acknowledge', {}) as Refusal).why).toBe('not-from');
    mv(db, waiting, 'answer-recorded');
    // Answered since entering: the Overlord may now drop it.
    expect(mv(db, waiting, 'drop', { reason: 'dropped', set: CLOSE }).row.state).toBe('dropped');
  });

  it('an answer given before a later entry into needs-you does not count after it (F9)', () => {
    const db = openDb();
    const id = open(db);
    toInProgress(db, id);
    mv(db, id, 'needs-you', { reason: 'two-counters' });
    mv(db, id, 'answer-recorded');
    mv(db, id, 'answer');                                                         // acknowledged: back to in-progress
    mv(db, id, 'needs-you', { reason: 'two-silent-nudges' });
    expect((tryMove(db, id, 'drop', { reason: 'dropped', set: CLOSE }) as Refusal).why).toBe('not-answered');
  });

  it('answer needs an acknowledged owner (not-acknowledged); without one the operator\'s door picks answer-recorded', () => {
    const db = openDb();
    const id = open(db);
    toNeedsYou(db, id);
    expect((tryMove(db, id, 'answer') as Refusal).why).toBe('not-acknowledged');
    expect(mv(db, id, 'answer-recorded').row.state).toBe('needs-you');
  });

  it('takenFrom is set by take to the state it left, kept by an answer-recorded, and cleared on EVERY move out of needs-you', () => {
    const db = openDb();
    const out: [RequestMove, string][] = [['hand-back-in-progress', 'in-progress'], ['answer', 'in-progress'], ['resume-parent', 'in-progress'], ['withdraw', 'dropped']];
    for (const [leave, to] of out) {
      const id = open(db);
      toInProgress(db, id);
      const taken = mv(db, id, 'take', { reason: 'operator-took-it' });
      expect(taken.row, leave).toMatchObject({ state: 'needs-you', takenFrom: 'in-progress' });
      expect(mv(db, id, 'answer-recorded').row.takenFrom, leave).toBe('in-progress');
      const left = mv(db, id, leave, leave === 'withdraw' ? { set: CLOSE } : {});
      expect(left.row, leave).toMatchObject({ state: to, takenFrom: null });
    }
    // take from each of its three states records that state; hand back must name it.
    for (const from of ['routed', 'blocked'] as const) {
      const id = open(db);
      mv(db, id, 'route', { set: { owner: 'project-a' } });
      if (from === 'blocked') { mv(db, id, 'acknowledge'); mv(db, id, 'block', { set: { dependsOn: 'request:1' } }); }
      expect(mv(db, id, 'take', { reason: 'operator-took-it' }).row.takenFrom).toBe(from);
      const wrong = from === 'routed' ? 'hand-back-blocked' : 'hand-back-routed';
      expect((tryMove(db, id, wrong) as Refusal).why).toBe('not-taken-from');
      expect(mv(db, id, `hand-back-${from}` as RequestMove).row).toMatchObject({ state: from, takenFrom: null });
    }
  });

  it('the answer path: take, answer on an acknowledged request, in-progress again with no takenFrom', () => {
    const db = openDb();
    const id = open(db);
    toInProgress(db, id);
    mv(db, id, 'take', { reason: 'operator-took-it' });
    expect(mv(db, id, 'answer').row).toMatchObject({ state: 'in-progress', takenFrom: null });
  });

  it('the follow-up clock: the move\'s own an hour on, the read-back\'s promise when given, none for an unclocked or terminal state or a parent with an open child', () => {
    const db = openDb();
    const id = open(db);
    expect(mv(db, id, 'route', { set: { owner: 'project-a' }, promiseAt: AT + 5_000 }).row.followUpAt).toBe(AT + 5_000);
    expect(mv(db, id, 'acknowledge', { at: AT + 100 }).row.followUpAt).toBe(AT + 100 + HOUR);
    expect(mv(db, id, 'needs-you', { reason: 'two-counters' }).row.followUpAt).toBeNull();
    expect(mv(db, id, 'resume-parent').row.followUpAt).toBe(AT + 10 + HOUR);
    expect(mv(db, id, 'fail', { set: CLOSE }).row).toMatchObject({ state: 'failed', followUpAt: null, closeNote: 'a note', closedAt: AT + 10 });

    const parent = open(db);
    open(db, { parentRequestId: parent });
    expect(mv(db, parent, 'start-parent').row).toMatchObject({ state: 'in-progress', followUpAt: null });
  });

  it('expectRevision: a stale one answers stale-revision with the row and its last move; a matching one passes; an operator\'s null never refuses', () => {
    const db = openDb();
    const id = open(db);
    mv(db, id, 'route', { set: { owner: 'project-a' } });                        // revision 1
    mv(db, id, 're-relay', { set: { owner: 'project-b' } });                      // revision 2
    const before = snap(db);
    const stale = tryMove(db, id, 're-relay', { expectRevision: 1, set: { owner: 'project-c' } }) as Refusal;
    expect(stale).toMatchObject({ ok: false, why: 'stale-revision' });
    expect(stale.row).toEqual(requestById(db, id));
    expect(stale.lastMove).toEqual(movesOf(db, id).at(-1));
    expect(snap(db)).toBe(before);
    expect(mv(db, id, 're-relay', { expectRevision: 2, set: { owner: 'project-c' } }).row).toMatchObject({ owner: 'project-c', revision: 3 });
    // An operator's tap acts on whatever the row is now.
    expect(mv(db, id, 'take', { reason: 'operator-took-it', expectRevision: null }).row.revision).toBe(4);
    expect(mv(db, id, 'withdraw', { expectRevision: null, set: CLOSE }).row).toMatchObject({ state: 'dropped', revision: 5 });
  });

  it('drop without a close note refuses field-required; counter appends one entry each time', () => {
    const db = openDb();
    const id = open(db);
    expect((tryMove(db, id, 'drop', { reason: 'dropped' }) as Refusal).why).toBe('field-required');
    mv(db, id, 'route', { set: { owner: 'project-a' } });
    mv(db, id, 'counter', { set: { counters: { n: 1 } } });
    mv(db, id, 'counter', { set: { counters: { n: 2 } } });
    const row = requestById(db, id);
    if (row === 'absent') throw new Error('absent');
    expect(JSON.parse(row.counters)).toEqual([{ n: 1 }, { n: 2 }]);
    // A move that does not list counters may not set one.
    expect((tryMove(db, id, 're-relay', { set: { counters: { n: 3 } } }) as Refusal).why).toBe('field-not-allowed');
  });

  it('guard 8: route, re-relay and route-elsewhere refuse has-children on a request with ANY child, an ended one too', () => {
    const db = openDb();
    const id = open(db);
    mv(db, id, 'route', { set: { owner: 'project-a' } });
    // Before a child: a re-relay is fine.
    expect(mv(db, id, 're-relay', { set: { owner: 'project-b' } }).row.revision).toBe(2);
    const child = open(db, { parentRequestId: id });
    const before = snap(db);
    expect((tryMove(db, id, 're-relay', { set: { owner: 'project-c' } }) as Refusal).why).toBe('has-children');
    expect(snap(db)).toBe(before);
    mv(db, child, 'drop', { reason: 'dropped', set: CLOSE });
    expect((tryMove(db, id, 're-relay', { set: { owner: 'project-c' } }) as Refusal).why).toBe('has-children');

    const fresh = open(db);
    open(db, { parentRequestId: fresh });
    expect((tryMove(db, fresh, 'route', { set: { owner: 'project-a' } }) as Refusal).why).toBe('has-children');

    const declined = open(db);
    mv(db, declined, 'route', { set: { owner: 'project-a' } });
    mv(db, declined, 'decline', { reason: 'impossible' });
    const kid = open(db, { parentRequestId: declined });
    expect((tryMove(db, declined, 'route-elsewhere', { set: { owner: 'project-b' } }) as Refusal).why).toBe('has-children');
    mv(db, kid, 'close-unowned', { set: CLOSE });
    expect((tryMove(db, declined, 'route-elsewhere', { set: { owner: 'project-b' } }) as Refusal).why).toBe('has-children');
  });

  it('drop, close-unowned and escalate on a parent with an open child refuse has-open-children, and pass once it ended', () => {
    const db = openDb();
    const parent = open(db);
    const child = open(db, { parentRequestId: parent });
    const before = snap(db);
    expect((tryMove(db, parent, 'drop', { reason: 'dropped', set: CLOSE }) as Refusal).why).toBe('has-open-children');
    expect((tryMove(db, parent, 'close-unowned', { set: CLOSE }) as Refusal).why).toBe('has-open-children');
    expect((tryMove(db, parent, 'escalate', { reason: 'needs-start' }) as Refusal).why).toBe('has-open-children');
    expect(snap(db)).toBe(before);
    mv(db, child, 'drop', { reason: 'dropped', set: CLOSE });
    expect(mv(db, parent, 'drop', { reason: 'dropped', set: CLOSE }).row.state).toBe('dropped');
  });
});

// ------------------------------------------------------------------------------------------------------ the parent's clock (F2)

describe('the parent\'s clock when its last open child ends (F2)', () => {
  const ending: [string, string, (db: DatabaseSync, child: number) => void][] = [
    ['dropped', 'dropped', (db, c) => { mv(db, c, 'drop', { reason: 'dropped', set: CLOSE, at: AT + 500 }); }],
    ['closed unowned', 'done', (db, c) => { mv(db, c, 'close-unowned', { set: CLOSE, at: AT + 500 }); }],
  ];
  for (const [name, childState, end] of ending) {
    it(`a child ${name}, when it is the last open one, stamps the parent's followUpAt an hour on, raises no revision and adds no parent line`, () => {
      const db = openDb();
      const parent = open(db);
      const first = open(db, { parentRequestId: parent });
      const second = open(db, { parentRequestId: parent });
      expect(requestById(db, parent)).toMatchObject({ followUpAt: null, revision: 0 });
      end(db, first);
      expect(requestById(db, parent)).toMatchObject({ followUpAt: null, revision: 0 });         // one open child is left
      const linesBefore = requestLines(db).length;
      end(db, second);
      expect(requestById(db, parent)).toMatchObject({ followUpAt: AT + 500 + HOUR, revision: 0, state: 'received' });
      expect(movesOf(db, parent)).toHaveLength(1);
      expect(requestLines(db).length).toBe(linesBefore + 1);                                      // the child's line only
      expect(requestLines(db).at(-1)).toMatchObject({ id: String(second), state: childState });
    });
  }

  it('a parent in in-progress is stamped too; a parent in needs-you (unclocked) is not, and a still-open child leaves the clock null', () => {
    const db = openDb();
    const p1 = open(db);
    const c1 = open(db, { parentRequestId: p1 });
    mv(db, p1, 'start-parent');
    mv(db, c1, 'close-unowned', { set: CLOSE, at: AT + 700 });
    expect(requestById(db, p1)).toMatchObject({ state: 'in-progress', followUpAt: AT + 700 + HOUR });

    const p2 = open(db);
    const c2 = open(db, { parentRequestId: p2 });
    mv(db, p2, 'start-parent');
    mv(db, p2, 'needs-you', { reason: 'child-ended' });
    mv(db, c2, 'drop', { reason: 'dropped', set: CLOSE, at: AT + 800 });
    expect(requestById(db, p2)).toMatchObject({ state: 'needs-you', followUpAt: null });
  });

  it('a self-loop of a child ends nothing: the parent\'s clock is untouched', () => {
    const db = openDb();
    const parent = open(db);
    const child = open(db, { parentRequestId: parent });
    mv(db, child, 'route', { set: { owner: 'project-a' } });
    mv(db, child, 're-relay', { set: { owner: 'project-b' } });
    expect(requestById(db, parent)).toMatchObject({ followUpAt: null, revision: 0 });
  });
});

// ------------------------------------------------------------------------------------------------- apply agrees with its plan

describe('an apply re-decides with its plan and throws, rolling the transaction back, when the row changed under it', () => {
  it('a move: the revision, the state, or the parent\'s children changing between plan and apply', () => {
    const db = openDb();
    const id = open(db);
    const before = snap(db);
    const planned = (): ReturnType<typeof planRequestMoveInTx> => planRequestMoveInTx(db, moveInput(id, 'route', { set: { owner: 'project-a' } }));
    const edits: [string, string][] = [
      ['revision', 'UPDATE overlord_requests SET revision = revision + 5'],
      ['state', "UPDATE overlord_requests SET state = 'dropped'"],
      ['taken', "UPDATE overlord_requests SET takenFrom = 'routed'"],
      ['child', "INSERT INTO overlord_requests (id, origin, summary, parentRequestId, state, openedAt) VALUES (77, 'overlord', 's', 1, 'received', 1)"],
    ];
    for (const [name, sql] of edits) {
      expect(() => tx(db, () => {
        const p = planned();
        if (!p.ok) throw new Error('plan refused');
        db.exec(sql);
        applyRequestMoveInTx(db, p.plan, null);
      }), name).toThrow(/disagrees with its plan/);
      expect(snap(db), name).toBe(before);
    }
  });

  it('a move whose tip moved under an apply through the revision guard: the row is untouched after the throw', () => {
    const db = openDb();
    const id = open(db);
    mv(db, id, 'route', { set: { owner: 'project-a' } });
    expect(() => tx(db, () => {
      const p = planRequestMoveInTx(db, moveInput(id, 're-relay', { expectRevision: 1, set: { owner: 'project-b' } }));
      if (!p.ok) throw new Error('plan refused');
      db.prepare('UPDATE overlord_requests SET revision = 9 WHERE id = ?').run(id);
      applyRequestMoveInTx(db, p.plan, null);
    })).toThrow(/disagrees|stale-revision/);
    expect(requestById(db, id)).toMatchObject({ revision: 1, owner: 'project-a' });
  });

  it('an insert: a taken id, a root citation taken meanwhile, or a parent closed meanwhile', () => {
    const db = openDb();
    const parent = open(db);
    const before = snap(db);
    const cases: [string, Partial<RequestInsertInput>, string][] = [
      ['id', {}, "INSERT INTO overlord_requests (id, origin, summary, state, openedAt) VALUES (2, 'overlord', 's', 'received', 1)"],
      ['root', { origin: 'operator', cites: [root(7)] }, "INSERT INTO overlord_request_messages (requestId, messageId, sha256, root, at) VALUES (1, 7, 'h', 1, 1)"],
      ['parent', { parentRequestId: parent }, "UPDATE overlord_requests SET state = 'dropped' WHERE id = 1"],
    ];
    for (const [name, over, sql] of cases) {
      expect(() => tx(db, () => {
        const p = planRequestInsertInTx(db, insertInput(over));
        if (!p.ok) throw new Error('plan refused');
        db.exec(sql);
        applyRequestInsertInTx(db, p.plan);
      }), name).toThrow(/disagrees with its plan/);
      expect(snap(db), name).toBe(before);
    }
  });

  it('the unique index backstop: a second root citation planted past the plan is refused by overlord_request_messages_one_root', () => {
    const db = openDb();
    open(db, { origin: 'operator', cites: [root(7)] });
    const second = open(db);
    expect(() => db.prepare("INSERT INTO overlord_request_messages (requestId, messageId, sha256, root, at) VALUES (?, 7, 'h', 1, 1)").run(second))
      .toThrow(/UNIQUE|constraint/i);
    // A non-root citation of the same message is allowed.
    expect(() => db.prepare("INSERT INTO overlord_request_messages (requestId, messageId, sha256, root, at) VALUES (?, 7, 'h', 0, 1)").run(second)).not.toThrow();
  });
});

describe('outside a transaction', () => {
  it('every plan refuses not-in-transaction, and an apply throws and writes nothing', () => {
    const db = openDb();
    const id = open(db);
    // Plans made inside a transaction, applied outside it.
    const ip = tx(db, () => planRequestInsertInTx(db, insertInput()));
    const mp = tx(db, () => planRequestMoveInTx(db, moveInput(id, 'route', { set: { owner: 'project-a' } })));
    if (!ip.ok || !mp.ok) throw new Error('plan refused');
    const before = snap(db);
    expect(db.isTransaction).toBe(false);
    expect(planRequestInsertInTx(db, insertInput())).toMatchObject({ ok: false, why: 'not-in-transaction' });
    expect(planRequestMoveInTx(db, moveInput(id, 'route', { set: { owner: 'project-a' } }))).toMatchObject({ ok: false, why: 'not-in-transaction', row: null, lastMove: null });
    expect(() => applyRequestInsertInTx(db, ip.plan)).toThrow(/not-in-transaction/);
    expect(() => applyRequestMoveInTx(db, mp.plan, null)).toThrow(/not-in-transaction/);
    expect(snap(db)).toBe(before);
  });
});

// ------------------------------------------------------------------------------------------------------ no operator words

describe('no operator text', () => {
  it('no column of the three tables can hold a message\'s words, and what a row holds is only what the caller passed', () => {
    const db = openDb();
    const cols = (t: string): string[] => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    for (const t of ['overlord_requests', 'overlord_request_messages', 'overlord_request_moves']) {
      expect(cols(t).filter((c) => /^(text|body|message|content|words)$/i.test(c)), t).toEqual([]);
    }
    const id = open(db, { origin: 'operator', cites: [root(7, 'c'.repeat(64))], summary: 'the overlord line' });
    mv(db, id, 'drop', { reason: 'dropped', set: { closeNote: 'the overlord note' } });
    const strings = new Set<string>();
    for (const t of ['overlord_requests', 'overlord_request_messages', 'overlord_request_moves']) {
      for (const row of db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]) {
        for (const v of Object.values(row)) if (typeof v === 'string') strings.add(v);
      }
    }
    // Every string is a word, a slug, an id, a hash, a JSON list or one of the two strings passed in.
    const known = /^(\[\]|[a-z-]+|[a-z-]+:[a-z-]+|acct:operator-a|overlord-a|c{64}|the overlord (line|note))$/;
    expect([...strings].filter((s) => !known.test(s))).toEqual([]);
  });
});
