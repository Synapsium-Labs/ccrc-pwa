// Overlord W1, designation plan Task 1 (PR A): the designation row, its six writers and its one reader
// (`overlordDesignationStore.ts`), over a coord db opened through the real migrations and a FAKE authority appender, so
// each writer's record, its order against the row write and its `from` are pinned without a journal file.
import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb, tx } from '../src/coord/db.js';
import {
  bindPendingGeneration, designatePending, designationRead, failPending, goLive, retire, stopDone,
  type AuthorityAppender,
} from '../src/coord/overlordDesignationStore.js';
import type { AuthorityAppend } from '../src/coord/overlordAuthorityJournal.js';
import { authorityEntry, type OverlordAuthorityMove } from '../src/coord/overlordAuthority.js';
import { insertStart, mintGeneration } from '../src/continuity/continuityStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';

/** The operator's actor as a designation writer takes it: the account gate's actor minted through the identity port (gates A). */
const OPERATOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('operator-a', '0123456789abcdef'));

// Opening a coord db replays every migration, which is slow under load: migrate ONE template, and copy it for each test.
let template = '';
const opened: DatabaseSync[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-designation-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } } });
afterAll(() => removeTmpFixtures());

const NOW = 1_800_000_000_000;
const A = 'overlord-quiet-otter';
const B = 'overlord-brisk-heron';
const GEN = '11111111-2222-3333-4444-555555555555';
const SET_X = { pools: ['pool-b', 'pool-a'], untagged: true };
const SET_Y = { pools: ['pool-a'], untagged: false };
const openDb = (): DatabaseSync => {
  const dir = path.join(mkTmp('ccrc-designation-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  return db;
};

interface Seen { entry: OverlordAuthorityMove; rowAtAppend: Record<string, unknown> | undefined }
interface Fake extends AuthorityAppender { seen: Seen[]; answer: () => AuthorityAppend }
const APPENDED = { ok: true, kind: 'appended', record: {} } as unknown as AuthorityAppend;
function fake(db: DatabaseSync): Fake {
  const f: Fake = {
    seen: [], answer: () => APPENDED,
    appendInTx(_db, entry) {
      f.seen.push({ entry, rowAtAppend: db.prepare('SELECT * FROM overlord_designation').get() as Record<string, unknown> | undefined });
      return f.answer();
    },
  };
  return f;
}
const refuse = (error: 'authority-rolled-back' | 'journal-append' = 'authority-rolled-back'): AuthorityAppend =>
  ({ ok: false, error, detail: 'refused for the test' });
const rowOnly = (): AuthorityAppend => ({ ok: true, kind: 'row-only', state: { kind: 'unmeasured', why: 'journal' } });
const kinds = (f: Fake): string[] => f.seen.map((s) => s.entry.kind);
const rowOf = (db: DatabaseSync): Record<string, unknown> | undefined =>
  db.prepare('SELECT * FROM overlord_designation').get() as Record<string, unknown> | undefined;

const des = (db: DatabaseSync, f: Fake, over: Partial<Parameters<typeof designatePending>[2]> = {}): ReturnType<typeof designatePending> =>
  designatePending(db, f, { sessionId: A, deadlineAt: NOW + 60_000, model: 'opus', accountPools: SET_X, actor: OPERATOR, at: NOW,
    opKey: 'op-designate-1', ...over });
const live = (db: DatabaseSync, f: Fake, id = A): void => {
  expect(des(db, f, { sessionId: id }).ok).toBe(true);
  expect(goLive(db, f, id, GEN, NOW + 1)).toMatchObject({ ok: true, changed: true });
};

describe('the table\'s CHECKs', () => {
  const ins = (db: DatabaseSync, cols: string, vals: string): unknown =>
    db.exec(`INSERT INTO overlord_designation (${cols}, term, designatedTerm, model, accountPools, actor, updatedAt) VALUES (${vals}, 0, 0, 'opus', '{}', 'a', 1)`);
  it('refuses a second row, a pending row without a deadline or an actor, and a rebind pending row with no binding', () => {
    const db = openDb();
    ins(db, 'id', '1');
    expect(() => ins(db, 'id', '2')).toThrow();
    db.exec('DELETE FROM overlord_designation');
    expect(() => ins(db, 'id, pendingId, pendingKind, pendingSince, pendingActor', "1, 'x', 'designate', 1, 'a'")).toThrow();
    expect(() => ins(db, 'id, pendingId, pendingKind, pendingSince, pendingDeadlineAt', "1, 'x', 'designate', 1, 2")).toThrow();
    expect(() => ins(db, 'id, pendingId, pendingKind, pendingSince, pendingDeadlineAt, pendingActor', "1, 'x', 'rebind', 1, 2, 'a'")).toThrow();
    expect(() => ins(db, 'id, sessionId', "1, 'x'")).toThrow();
  });
});

describe('designatePending', () => {
  it('appends the account set and the model class, no designate record, each BEFORE the row is written', () => {
    const db = openDb(); const f = fake(db);
    expect(des(db, f)).toEqual({ ok: true, changed: true });
    expect(kinds(f)).toEqual(['authority-account-set', 'authority-model-class']);
    expect(f.seen.every((s) => s.rowAtAppend === undefined)).toBe(true);
    expect(rowOf(db)).toMatchObject({ pendingId: A, pendingKind: 'designate', pendingGeneration: null, pendingActor: 'operator-a 01234567',
      pendingSince: NOW, pendingDeadlineAt: NOW + 60_000, term: 0, designatedTerm: 0, model: 'opus', sessionId: null });
    // The row keeps the operator's order; the journal canonicalises on its own side.
    expect(JSON.parse(rowOf(db)!['accountPools'] as string)).toEqual(SET_X);
  });
  it('journals a first designate from the narrowest values', () => {
    const db = openDb(); const f = fake(db);
    des(db, f, { model: 'fable' });
    expect(f.seen[0]!.entry).toMatchObject({ kind: 'authority-account-set', from: { pools: [], untagged: false }, to: SET_X });
    expect(f.seen[1]!.entry).toMatchObject({ kind: 'authority-model-class', from: 'opus', to: 'fable' });
  });
  it('refuses when a session is bound or pending, and writes nothing then', () => {
    const db = openDb(); const f = fake(db);
    des(db, f);
    const before = rowOf(db); const n = f.seen.length;
    expect(des(db, f, { sessionId: B })).toEqual({ ok: false, reason: 'exists' });
    expect(goLive(db, f, A, GEN, NOW + 1)).toMatchObject({ ok: true, changed: true });
    expect(des(db, f, { sessionId: B })).toEqual({ ok: false, reason: 'exists' });
    expect(f.seen.length).toBe(n + 1); // only goLive's record
    expect(rowOf(db)).not.toEqual(before);
    expect(rowOf(db)).toMatchObject({ sessionId: A, pendingId: null });
  });
  it('answers the journal\'s refusal and writes no row', () => {
    const db = openDb(); const f = fake(db);
    f.answer = () => refuse();
    expect(des(db, f)).toEqual({ ok: false, authority: 'authority-rolled-back', detail: 'refused for the test' });
    expect(rowOf(db)).toBeUndefined();
  });
  it('a refusal at the second record writes no row either', () => {
    const db = openDb(); const f = fake(db);
    let n = 0; f.answer = () => (++n === 2 ? refuse('journal-append') : APPENDED);
    expect(des(db, f)).toMatchObject({ ok: false, authority: 'journal-append' });
    expect(rowOf(db)).toBeUndefined();
  });
  it('passes as from the ROW\'s own value, read in the same transaction (authority A review F2)', () => {
    const db = openDb(); const f = fake(db);
    live(db, f);
    expect(retire(db, f, { actor: OPERATOR, at: NOW + 2, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true });
    db.prepare("UPDATE overlord_designation SET model = 'fable'").run();
    f.seen.length = 0;
    expect(des(db, f, { sessionId: B, model: 'opus', accountPools: SET_Y, opKey: 'op-designate-2', at: NOW + 3 }).ok).toBe(true);
    expect(f.seen[0]!.entry).toMatchObject({ kind: 'authority-account-set', from: SET_X, to: SET_Y });
    expect(f.seen[1]!.entry).toMatchObject({ kind: 'authority-model-class', from: 'fable', to: 'opus' });
  });
  it('a designate over a retired row keeps its term, past ids and owed stops', () => {
    const db = openDb(); const f = fake(db);
    live(db, f);
    retire(db, f, { actor: OPERATOR, at: NOW + 2, opKey: 'op-retire-1' });
    des(db, f, { sessionId: B, opKey: 'op-designate-2', at: NOW + 3 });
    expect(rowOf(db)).toMatchObject({ term: 2, designatedTerm: 1, sessionId: null, pendingId: B });
    const r = designationRead(db);
    expect(r).toMatchObject({ kind: 'not-designated', row: { pastIds: [A], stopsOwed: [A] } });
  });
});

describe('the records the writers append are in the authority grammar', () => {
  it('every entry the fake saw is one `authorityEntry` accepts (a first designate included, from equal to to)', () => {
    const db = openDb(); const f = fake(db);
    des(db, f, { accountPools: { pools: [], untagged: false } });
    goLive(db, f, A, GEN, NOW + 1);
    retire(db, f, { actor: OPERATOR, at: NOW + 2, opKey: 'op-retire-1' });
    expect(f.seen).toHaveLength(4);
    for (const s of f.seen) expect(() => authorityEntry(s.entry)).not.toThrow();
  });
});

describe('bindPendingGeneration', () => {
  it('sets the generation once, appends nothing, and refuses another id', () => {
    const db = openDb(); const f = fake(db);
    des(db, f); f.seen.length = 0;
    expect(bindPendingGeneration(db, A, GEN, NOW + 1)).toEqual({ ok: true, changed: true });
    expect(bindPendingGeneration(db, A, GEN, NOW + 2)).toEqual({ ok: true, changed: false });
    expect(bindPendingGeneration(db, A, 'another', NOW + 2)).toEqual({ ok: false, reason: 'generation-set' });
    expect(bindPendingGeneration(db, B, GEN, NOW + 2)).toEqual({ ok: false, reason: 'not-pending' });
    expect(rowOf(db)).toMatchObject({ pendingGeneration: GEN });
    expect(f.seen).toEqual([]);
  });
  it('refuses after a retire got there first', () => {
    const db = openDb(); const f = fake(db);
    des(db, f);
    expect(retire(db, f, { actor: OPERATOR, at: NOW + 1, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true });
    expect(bindPendingGeneration(db, A, GEN, NOW + 2)).toEqual({ ok: false, reason: 'not-pending' });
    expect(rowOf(db)).toMatchObject({ pendingGeneration: null });
  });
});

describe('goLive', () => {
  it('appends the designate record with the raised term, the id and the string generation, BEFORE the row', () => {
    const db = openDb(); const f = fake(db);
    des(db, f); f.seen.length = 0;
    expect(goLive(db, f, A, GEN, NOW + 1)).toEqual({ ok: true, changed: true, term: 1, previous: null });
    expect(f.seen).toHaveLength(1);
    expect(f.seen[0]!.entry).toEqual({ kind: 'authority-designate', opKey: 'go-live-term-1', term: 1, sessionId: A, generation: GEN });
    expect(f.seen[0]!.rowAtAppend).toMatchObject({ sessionId: null, term: 0 });
    expect(rowOf(db)).toMatchObject({ sessionId: A, generation: GEN, term: 1, designatedTerm: 1, pendingId: null, pendingKind: null,
      pendingGeneration: null, pendingSince: null, pendingDeadlineAt: null, pendingActor: null });
    expect(designationRead(db)).toMatchObject({ kind: 'designated', sessionId: A, term: 1 });
  });
  it('re-stamps the body\'s live generation: identity overlord, the raised term', () => {
    const db = openDb(); const f = fake(db);
    const start = insertStart(db, { sessionId: A, reportId: 'r-1', uuid: GEN, source: 'startup', model: 'claude-opus-5-5',
      rowIncarnation: null, reportedAt: NOW, receivedAt: NOW });
    if (!start.ok) throw new Error('start not recorded');
    expect(mintGeneration(db, { identity: A, sessionId: A, role: 'overlord', term: 1, rowIncarnation: null, startId: start.id,
      startReportedAt: NOW, resumed: false, model: 'claude-opus-5-5', lane: null, host: null, outcome: 'crashed', mono: 1, proc: 'p', now: NOW },
    null, true).ok).toBe(true);
    live(db, f);
    const g = db.prepare("SELECT identity, term FROM continuity_generations WHERE state <> 'ended'").all();
    expect(g).toEqual([{ identity: 'overlord', term: 1 }]);
  });
  it('a resent goLive for a session that is no longer pending changes nothing', () => {
    const db = openDb(); const f = fake(db);
    live(db, f); const before = rowOf(db); const n = f.seen.length;
    expect(goLive(db, f, A, GEN, NOW + 9)).toEqual({ ok: true, changed: false });
    expect(goLive(db, f, B, GEN, NOW + 9)).toEqual({ ok: true, changed: false });
    expect(rowOf(db)).toEqual(before);
    expect(f.seen.length).toBe(n);
  });
  it('answers the journal\'s refusal and leaves the attempt pending', () => {
    const db = openDb(); const f = fake(db);
    des(db, f);
    f.answer = () => refuse('journal-append');
    expect(goLive(db, f, A, GEN, NOW + 1)).toMatchObject({ ok: false, authority: 'journal-append' });
    expect(rowOf(db)).toMatchObject({ pendingId: A, sessionId: null, term: 0 });
  });
  it('clears the last attempt: designate, fail, designate, go live, then a live retire leaves lastAttempt null', () => {
    const db = openDb(); const f = fake(db);
    des(db, f);
    expect(failPending(db, A, 'deadline-passed', NOW + 1, false)).toEqual({ ok: true, changed: true });
    expect(designationRead(db)).toMatchObject({ kind: 'not-designated', row: { lastAttempt: { sessionId: A, outcome: 'deadline-passed', at: NOW + 1 } } });
    live(db, f, B);
    retire(db, f, { actor: OPERATOR, at: NOW + 5, opKey: 'op-retire-1' });
    expect(designationRead(db)).toMatchObject({ kind: 'not-designated', row: { lastAttempt: null } });
  });
});

describe('failPending', () => {
  it('keeps the term and the binding, and owes the stop only when asked', () => {
    const db = openDb(); const f = fake(db);
    des(db, f); f.seen.length = 0;
    expect(failPending(db, A, 'create-failed', NOW + 1, false)).toEqual({ ok: true, changed: true });
    expect(rowOf(db)).toMatchObject({ term: 0, sessionId: null, pendingId: null, attemptId: A, attemptOutcome: 'create-failed', stopsOwed: '[]' });
    des(db, f, { sessionId: B, opKey: 'op-designate-2' });
    expect(failPending(db, B, 'overlord-sandbox-unmet', NOW + 2, true)).toEqual({ ok: true, changed: true });
    expect(rowOf(db)).toMatchObject({ stopsOwed: JSON.stringify([B]), attemptId: B });
    expect(kinds(f)).not.toContain('authority-designate');
  });
  it('touches only the pending id, appends nothing, and a later failure never drops an owed id', () => {
    const db = openDb(); const f = fake(db);
    des(db, f);
    expect(failPending(db, B, 'create-failed', NOW + 1, true)).toEqual({ ok: true, changed: false });
    expect(failPending(db, A, 'create-failed', NOW + 1, true).ok).toBe(true);
    const n = f.seen.length;
    des(db, f, { sessionId: B, opKey: 'op-designate-2' });
    failPending(db, B, 'deadline-passed', NOW + 2, true);
    expect(JSON.parse(rowOf(db)!['stopsOwed'] as string)).toEqual([A, B]);
    expect(f.seen.length).toBe(n + 2); // the second designate's two records only
  });
  it('refuses an outcome word the vocabulary does not hold', () => {
    const db = openDb(); const f = fake(db);
    des(db, f);
    expect(failPending(db, A, 'made-up' as never, NOW, false)).toEqual({ ok: false, reason: 'bad-outcome' });
    expect(rowOf(db)).toMatchObject({ pendingId: A });
  });
  it('keeps a live binding while a rebind-less pending fails (the term stays)', () => {
    const db = openDb(); const f = fake(db);
    live(db, f);
    expect(failPending(db, A, 'create-failed', NOW + 3, false)).toEqual({ ok: true, changed: false });
    expect(rowOf(db)).toMatchObject({ sessionId: A, term: 1 });
  });
});

describe('retire', () => {
  it('nothing live or pending: nothing written', () => {
    const db = openDb(); const f = fake(db);
    expect(retire(db, f, { actor: OPERATOR, at: NOW, opKey: 'k' })).toEqual({ ok: true, changed: false });
    expect(rowOf(db)).toBeUndefined();
    des(db, f); failPending(db, A, 'create-failed', NOW, false);
    const before = rowOf(db); const n = f.seen.length;
    expect(retire(db, f, { actor: OPERATOR, at: NOW + 1, opKey: 'k' })).toEqual({ ok: true, changed: false });
    expect(rowOf(db)).toEqual(before);
    expect(f.seen.length).toBe(n);
  });
  it('a pending-only row: outcome retired, the id owed, no term raised, no append', () => {
    const db = openDb(); const f = fake(db);
    des(db, f); f.seen.length = 0;
    expect(retire(db, f, { actor: OPERATOR, at: NOW + 1, opKey: 'k' })).toEqual({ ok: true, changed: true, term: 0, owed: [A] });
    expect(f.seen).toEqual([]);
    expect(rowOf(db)).toMatchObject({ term: 0, pendingId: null, attemptId: A, attemptOutcome: 'retired', attemptAt: NOW + 1, stopsOwed: JSON.stringify([A]) });
  });
  it('a live row: appends authority-retire with previousSessionId, unbinds, raises the term, owes the body', () => {
    const db = openDb(); const f = fake(db);
    live(db, f); f.seen.length = 0;
    expect(retire(db, f, { actor: OPERATOR, at: NOW + 2, opKey: 'op-retire-1' })).toEqual({ ok: true, changed: true, term: 2, owed: [A] });
    expect(f.seen).toHaveLength(1);
    expect(f.seen[0]!.entry).toEqual({ kind: 'authority-retire', opKey: 'op-retire-1', term: 2, previousSessionId: A });
    expect(f.seen[0]!.rowAtAppend).toMatchObject({ sessionId: A, term: 1 });
    expect(rowOf(db)).toMatchObject({ sessionId: null, generation: null, term: 2, designatedTerm: 1, pastIds: JSON.stringify([A]), stopsOwed: JSON.stringify([A]) });
    expect(designationRead(db)).toMatchObject({ kind: 'not-designated', row: { bound: null, term: 2 } });
  });
  describe('the retired body\'s live generation (review 2349 F4)', () => {
    // `identity` is `overlord` for a pending body (the lane mints through `identityOf`); a bound body's row is restamped by goLive.
    const mintLive = (db: DatabaseSync, id = A, uuid = GEN, identity = id): void => {
      const start = insertStart(db, { sessionId: id, reportId: `r-${id}`, uuid, source: 'startup', model: 'claude-opus-5-5',
        rowIncarnation: null, reportedAt: NOW, receivedAt: NOW });
      if (!start.ok) throw new Error('start not recorded');
      expect(mintGeneration(db, { identity, sessionId: id, role: 'overlord', term: 1, rowIncarnation: null, startId: start.id,
        startReportedAt: NOW, resumed: false, model: 'claude-opus-5-5', lane: null, host: null, outcome: 'crashed', mono: 1, proc: 'p', now: NOW },
      null, true).ok).toBe(true);
    };
    const gens = (db: DatabaseSync): unknown[] => db.prepare('SELECT identity, state, outcome, walk, deadlineAt FROM continuity_generations').all();
    it('a live retire ends the live overlord generation with outcome retired, so no live overlord row remains', () => {
      const db = openDb(); const f = fake(db);
      mintLive(db); live(db, f);
      expect(retire(db, f, { actor: OPERATOR, at: NOW + 2, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true });
      expect(gens(db)).toEqual([{ identity: 'overlord', state: 'ended', outcome: 'retired', walk: null, deadlineAt: null }]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM continuity_generations WHERE identity = 'overlord' AND state <> 'ended'").get()).toEqual({ n: 0 });
    });
    const liveCount = (db: DatabaseSync): unknown =>
      db.prepare("SELECT COUNT(*) AS n FROM continuity_generations WHERE identity = 'overlord' AND state <> 'ended'").get();
    it('a pending-only retire ends the cancelled body\'s generation with outcome retired (review 2366 N3)', () => {
      const db = openDb(); const f = fake(db);
      mintLive(db, A, GEN, 'overlord'); des(db, f);
      expect(retire(db, f, { actor: OPERATOR, at: NOW + 1, opKey: 'k' })).toMatchObject({ ok: true, changed: true, owed: [A] });
      expect(gens(db)).toEqual([{ identity: 'overlord', state: 'ended', outcome: 'retired', walk: null, deadlineAt: null }]);
    });
    it('a live retire with a pending attempt ends the pending body\'s generation too (review 2366 N3)', () => {
      const db = openDb(); const f = fake(db);
      live(db, f);
      mintLive(db, B, '66666666-7777-8888-9999-000000000000', 'overlord');
      db.prepare("UPDATE overlord_designation SET pendingId = ?, pendingKind = 'rebind', pendingSince = 1, pendingDeadlineAt = 2, pendingActor = 'o', "
      + "pendingActorKind = 'operator', pendingActorIssuer = 'account-gate', pendingActorStrength = 'operator'").run(B);
      expect(retire(db, f, { actor: OPERATOR, at: NOW + 2, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true, owed: [A, B] });
      expect(liveCount(db)).toEqual({ n: 0 });
    });
    it('failPending ends the failed attempt\'s generation with outcome retired (review 2366 N3)', () => {
      const db = openDb(); const f = fake(db);
      mintLive(db, A, GEN, 'overlord'); des(db, f);
      expect(failPending(db, A, 'create-failed', NOW + 1, true)).toEqual({ ok: true, changed: true });
      expect(gens(db)).toEqual([{ identity: 'overlord', state: 'ended', outcome: 'retired', walk: null, deadlineAt: null }]);
    });
    it('failPending of an id the row does not hold pending ends nothing', () => {
      const db = openDb(); const f = fake(db);
      mintLive(db, A, GEN, 'overlord'); des(db, f, { sessionId: B });
      expect(failPending(db, A, 'create-failed', NOW + 1, true)).toEqual({ ok: true, changed: false });
      expect(liveCount(db)).toEqual({ n: 1 });
    });
    it('a refused journal append leaves the generation live', () => {
      const db = openDb(); const f = fake(db);
      mintLive(db); live(db, f);
      f.answer = () => refuse();
      expect(retire(db, f, { actor: OPERATOR, at: NOW + 2, opKey: 'op-retire-1' })).toMatchObject({ ok: false });
      expect(gens(db)).toMatchObject([{ identity: 'overlord', state: expect.not.stringMatching(/^ended$/), outcome: null }]);
    });
  });
  it('a live row with a pending rebind-shaped attempt cancels it as retired and owes both ids', () => {
    const db = openDb(); const f = fake(db);
    live(db, f);
    db.prepare("UPDATE overlord_designation SET pendingId = ?, pendingKind = 'rebind', pendingSince = 1, pendingDeadlineAt = 2, pendingActor = 'o', "
      + "pendingActorKind = 'operator', pendingActorIssuer = 'account-gate', pendingActorStrength = 'operator'").run(B);
    expect(retire(db, f, { actor: OPERATOR, at: NOW + 2, opKey: 'op-retire-1' })).toEqual({ ok: true, changed: true, term: 2, owed: [A, B] });
    expect(rowOf(db)).toMatchObject({ pendingId: null, attemptId: B, attemptOutcome: 'retired', stopsOwed: JSON.stringify([A, B]) });
  });
  it('writes its row only when the journal answers row-only, and writes nothing on any refusal', () => {
    for (const state of ['rolled-back', 'unmeasured', 'head-mismatch', 'unreadable', 'append-failed']) {
      const db = openDb(); const f = fake(db);
      live(db, f);
      f.answer = () => ({ ...rowOnly(), state } as unknown as AuthorityAppend);
      f.seen.length = 0;
      expect(retire(db, f, { actor: OPERATOR, at: NOW + 2, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true, term: 2 });
      expect(rowOf(db)).toMatchObject({ sessionId: null, term: 2 });
      expect(f.seen).toHaveLength(1);
    }
    const db = openDb(); const f = fake(db);
    live(db, f);
    f.answer = () => ({ ok: false, error: 'not-in-transaction', detail: 'x' });
    expect(retire(db, f, { actor: OPERATOR, at: NOW + 2, opKey: 'k' })).toMatchObject({ ok: false, authority: 'not-in-transaction' });
    expect(rowOf(db)).toMatchObject({ sessionId: A, term: 1 });
  });
});

describe('stopDone', () => {
  it('removes one id, appends nothing, and leaves the others', () => {
    const db = openDb(); const f = fake(db);
    des(db, f); failPending(db, A, 'create-failed', NOW, true);
    des(db, f, { sessionId: B, opKey: 'op-designate-2' }); failPending(db, B, 'create-failed', NOW, true);
    const n = f.seen.length;
    expect(stopDone(db, A)).toEqual({ ok: true, changed: true });
    expect(rowOf(db)).toMatchObject({ stopsOwed: JSON.stringify([B]) });
    expect(stopDone(db, A)).toEqual({ ok: true, changed: false });
    expect(f.seen.length).toBe(n);
    expect(stopDone(openDb(), A)).toEqual({ ok: true, changed: false });
  });
});

describe('designationRead', () => {
  it('answers the three arms', () => {
    const db = openDb(); const f = fake(db);
    expect(designationRead(db)).toEqual({ kind: 'not-designated', row: null });
    des(db, f);
    const p = designationRead(db);
    expect(p).toMatchObject({ kind: 'not-designated', row: { bound: null, pending: { sessionId: A, kind: 'designate', deadlineAt: NOW + 60_000,
      since: NOW, actor: 'operator-a 01234567', generation: null }, model: 'opus', accountPools: SET_X, actor: 'operator-a 01234567' } });
    goLive(db, f, A, GEN, NOW + 1);
    expect(designationRead(db)).toMatchObject({ kind: 'designated', sessionId: A, term: 1,
      row: { bound: { sessionId: A, generation: GEN }, pending: null, designatedTerm: 1, lastAttempt: null, stopsOwed: [] } });
  });
  it('is unmeasured, with a why, for a row it cannot narrow', () => {
    const cases: Record<string, string> = {
      accountPools: "UPDATE overlord_designation SET accountPools = '{\"pools\":[1],\"untagged\":true}'",
      accountPoolsText: "UPDATE overlord_designation SET accountPools = 'nope'",
      stopsOwed: "UPDATE overlord_designation SET stopsOwed = '{\"a\":1}'",
      pastIds: "UPDATE overlord_designation SET pastIds = '[1]'",
      outcome: "UPDATE overlord_designation SET attemptId = 'x', attemptOutcome = 'who-knows', attemptAt = 1",
      halfAttempt: "UPDATE overlord_designation SET attemptId = 'x'",
    };
    for (const [name, sql] of Object.entries(cases)) {
      const db = openDb(); const f = fake(db);
      live(db, f);
      db.exec(sql);
      expect(designationRead(db), name).toMatchObject({ kind: 'unmeasured' });
      expect((designationRead(db) as { why: string }).why.length).toBeGreaterThan(0);
    }
  });
  it('is unmeasured for a bad model word (CHECK dropped), a bad pending kind, and a closed database; never throws', () => {
    const db = openDb();
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.exec(`INSERT INTO overlord_designation (id, pendingId, pendingKind, pendingSince, pendingDeadlineAt, pendingActor, pendingActorKind,
      pendingActorIssuer, pendingActorStrength, term, designatedTerm, model, accountPools, actor, updatedAt)
      VALUES (1, 'x', 'designate', 1, 2, 'a', 'operator', 'account-gate', 'operator', 0, 0, 'sonnet', '{"pools":[],"untagged":false}', 'a', 1)`);
    expect(designationRead(db)).toMatchObject({ kind: 'unmeasured' });
    db.exec("UPDATE overlord_designation SET model = 'opus', pendingKind = 'resume'");
    expect(designationRead(db)).toMatchObject({ kind: 'unmeasured' });
    db.close();
    expect(designationRead(db)).toMatchObject({ kind: 'unmeasured' });
  });
  it('a writer on an unreadable row writes nothing and says so', () => {
    const db = openDb(); const f = fake(db);
    des(db, f);
    db.exec("UPDATE overlord_designation SET accountPools = 'nope'");
    expect(des(db, f, { sessionId: B })).toMatchObject({ ok: false });
    expect(tx(db, () => 1)).toBe(1);
  });
});
