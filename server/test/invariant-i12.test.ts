// Overlord W2, request record A (plan `w2-requests.md` Task A4 and Table 9): I12, "every open request has a follow-up time or an open
// child that does". The predicate cases run over plain facts; the store cases build the requests through the real request store on a
// real coord.db and gather with `gatherInvariantInput`. Fixture databases in temp dirs only, neutral names.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { tx } from '../src/coord/tx.js';
import { gatherInvariantInput, type InvariantFactsDeps } from '../src/coord/invariantFacts.js';
import {
  INVARIANT_MAP, i12FollowUpClock, invariantVerdict, type FactsRead, type I12Facts, type InvariantInput, type InvariantVerdict,
} from '../src/coord/invariants.js';
import {
  applyRequestInsertInTx, applyRequestMoveInTx, planRequestInsertInTx, planRequestMoveInTx, requestById, type RequestInsertInput, type RequestMoveInput,
} from '../src/coord/overlordRequestStore.js';
import { REQUEST_NEXT_MOVE_MS, UNCLOCKED_REQUEST_STATES, OPEN_REQUEST_STATES, type RequestMove } from '../../shared/overlordRequests.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

type Req = I12Facts['requests'][number];
const req = (id: number, state: string, followUpAt: number | null, parentRequestId: number | null = null): Req => ({ id, state, followUpAt, parentRequestId });
const measured = <F>(value: F): FactsRead<F> => ({ kind: 'measured', value });
const inputOf = (requests: readonly Req[]): InvariantInput => ({ lines: measured([]), facts: { I12: measured({ requests }) } });
const verdictOf = (requests: readonly Req[]): InvariantVerdict => invariantVerdict('I12', inputOf(requests));
const subjects = (v: InvariantVerdict): string[] => (v.kind === 'violated' ? v.findings.map((f) => f.subject) : []);
const T = 1_800_000_000_000;

// ------------------------------------------------------------------------------------------------------ Table 9, row by row

describe('I12 (Table 9)', () => {
  it('the row runs: it waits on nothing, and its table is the request table', () => {
    expect(INVARIANT_MAP.I12).toMatchObject({ w1: 'runs', waitsOn: null });
    expect(i12FollowUpClock([], { requests: [] })).toEqual({ kind: 'holds' });
  });

  it('row 1, the table is absent: not-applicable, naming it, never holds', () => {
    const v = invariantVerdict('I12', { lines: measured([]), facts: { I12: { kind: 'absent', what: 'overlord_requests' } } });
    expect(v).toEqual({ kind: 'not-applicable', waitsOn: 'overlord_requests', why: 'tables-absent' });
  });

  it('no facts, or an unmeasured read, is unmeasured and never folded into holds', () => {
    expect(invariantVerdict('I12', { lines: measured([]), facts: {} })).toMatchObject({ kind: 'unmeasured' });
    expect(invariantVerdict('I12', { lines: measured([]), facts: { I12: { kind: 'unmeasured', why: 'boom' } } })).toEqual({ kind: 'unmeasured', why: 'boom' });
  });

  it('no open request holds', () => {
    expect(verdictOf([])).toEqual({ kind: 'holds' });
  });

  it('row 2, a needs-you, done-unverified or blocked request holds with no clock and no child', () => {
    expect(UNCLOCKED_REQUEST_STATES.slice().sort()).toEqual(['blocked', 'done-unverified', 'needs-you']);
    for (const state of UNCLOCKED_REQUEST_STATES) expect(verdictOf([req(1, state, null)]), state).toEqual({ kind: 'holds' });
  });

  it('row 3, a set followUpAt holds, in every open state', () => {
    for (const state of OPEN_REQUEST_STATES) expect(verdictOf([req(1, state, T)]), state).toEqual({ kind: 'holds' });
    // Even a clock in the past holds: I12 asks that a clock EXISTS, the follow-up lane acts on a due one.
    expect(verdictOf([req(1, 'received', 0)])).toEqual({ kind: 'holds' });
  });

  it('row 4, a parent with an open child, every open child holding, holds without a clock of its own', () => {
    expect(verdictOf([req(1, 'received', null), req(2, 'received', T, 1)])).toEqual({ kind: 'holds' });
    expect(verdictOf([req(1, 'in-progress', null), req(2, 'received', T, 1), req(3, 'routed', T, 1), req(4, 'needs-you', null, 1)])).toEqual({ kind: 'holds' });
  });

  it('row 5, otherwise a finding, subject request:<id>, in every clocked open state, with no seq', () => {
    for (const state of OPEN_REQUEST_STATES.filter((s) => !UNCLOCKED_REQUEST_STATES.includes(s))) {
      const v = verdictOf([req(7, state, null)]);
      expect(v, state).toMatchObject({ kind: 'violated', unmeasured: [], findings: [{ invariant: 'I12', subject: 'request:7', seq: null }] });
      expect(v.kind === 'violated' && v.findings[0]!.message, state).toContain(state);
    }
  });

  it('a parent with one child that fails: both are findings', () => {
    expect(subjects(verdictOf([req(1, 'received', null), req(2, 'received', null, 1)]))).toEqual(['request:1', 'request:2']);
  });

  it('a parent with one child that holds and one that fails: the parent and the failing child are findings, the holding child is not', () => {
    expect(subjects(verdictOf([req(1, 'received', null), req(2, 'received', T, 1), req(3, 'routed', null, 1)]))).toEqual(['request:1', 'request:3']);
  });

  it('an ended child is no open child: a parent with no clock and only terminal children is a finding', () => {
    const v = verdictOf([req(1, 'received', null), req(2, 'dropped', null, 1), req(3, 'done', null, 1), req(4, 'failed', null, 1)]);
    expect(subjects(v)).toEqual(['request:1']);
  });

  it('a state word this build cannot name is judged as a clocked open state: it needs a clock', () => {
    expect(subjects(verdictOf([req(1, 'from-a-later-build', null)]))).toEqual(['request:1']);
    expect(verdictOf([req(1, 'from-a-later-build', T)])).toEqual({ kind: 'holds' });
  });

  it('findings come in request-id order whatever the order of the facts', () => {
    expect(subjects(verdictOf([req(9, 'received', null), req(3, 'routed', null), req(5, 'in-progress', null)]))).toEqual(['request:3', 'request:5', 'request:9']);
  });

  it('a planted cycle (two requests naming each other as parent, no clocks) is a finding for each and returns', () => {
    expect(subjects(verdictOf([req(1, 'received', null, 2), req(2, 'received', null, 1)]))).toEqual(['request:1', 'request:2']);
    // A self-parent, and a three-cycle, in the same breath.
    expect(subjects(verdictOf([req(3, 'received', null, 3)]))).toEqual(['request:3']);
    expect(subjects(verdictOf([req(4, 'routed', null, 6), req(5, 'routed', null, 4), req(6, 'routed', null, 5)]))).toEqual(['request:4', 'request:5', 'request:6']);
  });

  it('a clocked cycle holds, and in a cycle where one member holds by its clock the other holds through it as its child', () => {
    expect(verdictOf([req(1, 'received', T, 2), req(2, 'received', T, 1)])).toEqual({ kind: 'holds' });
    expect(verdictOf([req(1, 'received', T, 2), req(2, 'received', null, 1)])).toEqual({ kind: 'holds' });
  });

  it('a request whose parent is not among the open ones is judged on its own', () => {
    expect(subjects(verdictOf([req(2, 'received', null, 1)]))).toEqual(['request:2']);
    expect(verdictOf([req(2, 'received', T, 1)])).toEqual({ kind: 'holds' });
  });

  it('monotonicity: an open clocked child added to request X never removes a finding of another request Y (the one-level shape the insert allows)', () => {
    const bases: Req[][] = [
      [req(1, 'received', null), req(2, 'routed', null), req(3, 'in-progress', T)],
      [req(1, 'received', null), req(2, 'received', null, 1), req(3, 'received', T), req(4, 'received', null)],
      [req(1, 'blocked', null), req(2, 'received', null, 1), req(3, 'declined', null)],
      [req(1, 'received', T), req(2, 'received', null), req(3, 'received', null, 2), req(4, 'received', null, 2)],
    ];
    for (const base of bases) {
      const before = subjects(verdictOf(base));
      for (const x of base.filter((r) => r.parentRequestId === null)) {
        const more = [...base, req(100, 'received', T, x.id)];
        const after = subjects(verdictOf(more));
        for (const s of before) if (s !== `request:${x.id}`) expect(after, `${s} after a child on ${x.id}`).toContain(s);
        expect(verdictOf(more).kind === 'holds' && before.length > 0, 'a violated base never turns into holds by a child on one request alone').toBe(false);
        // The child itself holds, and a base that held still holds.
        expect(after).not.toContain('request:100');
      }
    }
  });
});

// -------------------------------------------------------------------------------------------------------- the real store

let template = '';
const opened: DatabaseSync[] = [];
beforeAll(() => { template = path.join(mkTmp('ccrc-i12-template-'), 'coord.db'); openCoordDb(template).close(); });
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } } });
afterAll(() => removeTmpFixtures());

const openDb = (): DatabaseSync => {
  const dir = path.join(mkTmp('ccrc-i12-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  return db;
};
const depsOf = (db: DatabaseSync): InvariantFactsDeps => ({
  db, readJournal: () => ({ kind: 'absent' }), guardState: () => ({ kind: 'coherent' }), designationBaseline: () => ({ kind: 'measured', value: null }),
});
const i12 = (db: DatabaseSync): InvariantVerdict => invariantVerdict('I12', gatherInvariantInput(depsOf(db)));

const open = (db: DatabaseSync, over: Partial<RequestInsertInput> = {}): number => tx(db, () => {
  const p = planRequestInsertInTx(db, { origin: 'overlord', summary: 's', parentRequestId: null, consulted: [], expectedPaths: [], cites: [], journalHighest: null,
    actor: 'overlord', actorId: 'overlord-a', at: T, ...over });
  if (!p.ok) throw new Error(`insert refused: ${p.why}`);
  return applyRequestInsertInTx(db, p.plan).row.id;
});
const mv = (db: DatabaseSync, id: number, move: RequestMove, over: Partial<RequestMoveInput> = {}): void => {
  const actor = over.actor ?? (['drop', 'route', 'escalate'].includes(move) ? 'overlord' : 'server');
  tx(db, () => {
    const p = planRequestMoveInTx(db, { id, move, actor, actorId: actor === 'overlord' ? 'overlord-a' : 'server', at: T + 1_000, expectRevision: null, reason: null,
      promiseAt: null, set: {}, ...over });
    if (!p.ok) throw new Error(`${move} refused: ${p.why}`);
    applyRequestMoveInTx(db, p.plan, null);
  });
};
const dropIt = (db: DatabaseSync, id: number): void => { mv(db, id, 'drop', { reason: 'dropped', set: { closeNote: 'n' } }); };
const closeIt = (db: DatabaseSync, id: number): void => { mv(db, id, 'close-unowned', { set: { closeNote: 'n' } }); };

describe('I12 over the real request store', () => {
  it('an empty migrated database holds, and a freshly opened request holds through its own clock', () => {
    const db = openDb();
    expect(gatherInvariantInput(depsOf(db)).facts.I12).toEqual({ kind: 'measured', value: { requests: [] } });
    expect(i12(db)).toEqual({ kind: 'holds' });
    const id = open(db);
    expect(requestById(db, id)).toMatchObject({ followUpAt: T + REQUEST_NEXT_MOVE_MS });
    expect(i12(db)).toEqual({ kind: 'holds' });
  });

  it('a parent whose open children hold holds with no clock of its own (opening a child clears the parent\'s)', () => {
    const db = openDb();
    const parent = open(db);
    open(db, { parentRequestId: parent });
    open(db, { parentRequestId: parent });
    expect(requestById(db, parent)).toMatchObject({ followUpAt: null });
    expect(i12(db)).toEqual({ kind: 'holds' });
  });

  it('a parent with one child that fails (its clock removed behind the store) reports both', () => {
    const db = openDb();
    const parent = open(db);
    const good = open(db, { parentRequestId: parent });
    const bad = open(db, { parentRequestId: parent });
    db.prepare('UPDATE overlord_requests SET followUpAt = NULL WHERE id = ?').run(bad);
    const v = i12(db);
    expect(subjects(v)).toEqual([`request:${parent}`, `request:${bad}`]);
    expect(subjects(v)).not.toContain(`request:${good}`);
  });

  for (const [name, end] of [['dropped', dropIt], ['closed unowned', closeIt]] as const) {
    it(`a parent whose last child was ${name} holds through the parent's restamped clock (F2); without that stamp it is a finding`, () => {
      const db = openDb();
      const parent = open(db);
      const first = open(db, { parentRequestId: parent });
      const second = open(db, { parentRequestId: parent });
      end(db, first);
      expect(requestById(db, parent)).toMatchObject({ followUpAt: null });
      expect(i12(db)).toEqual({ kind: 'holds' });                                   // the second child still holds it
      end(db, second);
      expect(requestById(db, parent)).toMatchObject({ followUpAt: T + 1_000 + REQUEST_NEXT_MOVE_MS, revision: 0 });
      expect(i12(db)).toEqual({ kind: 'holds' });
      // The ended children are not open requests, and the parent now holds on its own clock alone.
      db.prepare('UPDATE overlord_requests SET followUpAt = NULL WHERE id = ?').run(parent);
      expect(subjects(i12(db))).toEqual([`request:${parent}`]);
    });
  }

  it('a parent in needs-you with no clock holds, and a request whose move left it in an unclocked state holds', () => {
    const db = openDb();
    const id = open(db);
    mv(db, id, 'escalate', { reason: 'needs-start' });
    expect(requestById(db, id)).toMatchObject({ state: 'needs-you', followUpAt: null });
    expect(i12(db)).toEqual({ kind: 'holds' });
  });

  it('ended requests are never judged: a dropped request with no clock is not a finding', () => {
    const db = openDb();
    const id = open(db);
    dropIt(db, id);
    expect(requestById(db, id)).toMatchObject({ state: 'dropped', followUpAt: null });
    expect(i12(db)).toEqual({ kind: 'holds' });
  });

  it('a planted cycle on the table is a finding for each member, and the gather and the verdict return', () => {
    const db = openDb();
    const ins = db.prepare("INSERT INTO overlord_requests (id, origin, summary, parentRequestId, state, openedAt) VALUES (?, 'overlord', 's', ?, 'received', 1)");
    ins.run(1, 2);
    ins.run(2, 1);
    expect(subjects(i12(db))).toEqual(['request:1', 'request:2']);
  });

  it('the table absent answers not-applicable, naming it (tables-absent)', () => {
    const db = openDb();
    db.exec('DROP TABLE overlord_requests');
    const input = gatherInvariantInput(depsOf(db));
    expect(input.facts.I12).toEqual({ kind: 'absent', what: 'overlord_requests' });
    expect(invariantVerdict('I12', input)).toEqual({ kind: 'not-applicable', waitsOn: 'overlord_requests', why: 'tables-absent' });
  });

  it('a closed database reads the I12 arm unmeasured and does not throw', () => {
    const db = openDb();
    db.close();
    let input: InvariantInput | undefined;
    expect(() => { input = gatherInvariantInput(depsOf(db)); }).not.toThrow();
    expect(input!.facts.I12?.kind).toBe('unmeasured');
    expect(invariantVerdict('I12', input!).kind).toBe('unmeasured');
  });
});
