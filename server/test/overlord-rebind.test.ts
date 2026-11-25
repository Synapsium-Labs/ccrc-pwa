// Overlord W1, designation B, plan Task 6: Rebind's decider (`overlordDesignation.ts#rebindVerdict`) and its writers
// (`overlordDesignationStore.ts#rebindPending`, `goLive`'s rebind arm, `failPending` of a rebind attempt), over a coord db opened
// through the real migrations and a FAKE authority appender, plus a real `CoordStore` for the mail repoint. The decider's cases
// live in `sim/designationSets.ts`, written once for this file and for the every-run mutation floors.
import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as m from '../src/coord/overlordDesignation.js';
import {
  designationRead, failPending, goLive, rebindPending, retire, SequenceStampRefused, type AuthorityAppender,
} from '../src/coord/overlordDesignationStore.js';
import type { AuthorityAppend } from '../src/coord/overlordAuthorityJournal.js';
import type { OverlordAuthorityMove } from '../src/coord/overlordAuthority.js';
import { insertStart, mintGeneration } from '../src/continuity/continuityStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { rebindVerdictCases } from './sim/designationSets.js';
import { pruneSequenceThrough, sequenceOldest } from '../src/coord/overlordSequenceStore.js';
import { retentionCut } from '../src/coord/overlordSequence.js';

/** The operator's actor as a designation writer takes it: the account gate's actor minted through the identity port (gates A). */
const OPERATOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('operator-a', '0123456789abcdef'));

// Opening a coord db replays every migration, which is slow under load: migrate ONE template, and copy it for each test.
let template = '';
const opened: DatabaseSync[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-rebind-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } } });
afterAll(() => removeTmpFixtures());

const NOW = 1_800_000_000_000;
const A = 'overlord-quiet-otter';
const B = 'overlord-brisk-heron';
const C = 'overlord-calm-owl';
const GEN_A = '11111111-2222-3333-4444-555555555555';
const GEN_B = '66666666-7777-8888-9999-000000000000';
const SET_X = { pools: ['pool-b', 'pool-a'], untagged: true };
const openDb = (): DatabaseSync => {
  const dir = path.join(mkTmp('ccrc-rebind-'), '.ccrc');
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
const refuse = (): AuthorityAppend => ({ ok: false, error: 'authority-rolled-back', detail: 'refused for the test' });
const rowOf = (db: DatabaseSync): Record<string, unknown> | undefined =>
  db.prepare('SELECT * FROM overlord_designation').get() as Record<string, unknown> | undefined;

type Designate = Parameters<CoordStore['designatePending']>[1];
const desInput = (over: Partial<Designate> = {}): Designate =>
  ({ sessionId: A, deadlineAt: NOW + 60_000, model: 'fable', accountPools: SET_X, actor: OPERATOR, at: NOW, opKey: 'op-designate-1', ...over });
/** A live binding of A (designate, then go-live at term 1), through the module's own writers. */
function liveA(db: DatabaseSync, f: Fake): void {
  const c = new CoordStore(db);
  expect(c.designatePending(f, desInput()).ok).toBe(true);
  expect(c.goLive(f, A, GEN_A, NOW + 1)).toMatchObject({ ok: true, changed: true, term: 1 });
}
const rebind = (db: DatabaseSync, over: Partial<Parameters<typeof rebindPending>[1]> = {}): ReturnType<typeof rebindPending> =>
  rebindPending(db, { sessionId: B, deadlineAt: NOW + 90_000, actor: OPERATOR, at: NOW + 2, ...over });

/** A start and a live generation of `id` under `identity` (a body's own id until a go-live re-stamps it `overlord`). */
function mint(db: DatabaseSync, id: string, uuid: string, identity: string, term: number): void {
  const start = insertStart(db, { sessionId: id, reportId: `r-${id}`, uuid, source: 'startup', model: 'claude-opus-5-5',
    rowIncarnation: null, reportedAt: NOW, receivedAt: NOW });
  if (!start.ok) throw new Error('start not recorded');
  expect(mintGeneration(db, { identity, sessionId: id, role: 'overlord', term, rowIncarnation: null, startId: start.id,
    startReportedAt: NOW, resumed: false, model: 'claude-opus-5-5', lane: null, host: null, outcome: 'crashed', mono: 1, proc: 'p', now: NOW },
  null, true).ok).toBe(true);
}
const gens = (db: DatabaseSync): unknown[] =>
  db.prepare('SELECT sessionId, identity, state, outcome, term FROM continuity_generations ORDER BY id').all();

describe('rebindVerdict', () => {
  for (const [name, fn] of Object.entries(rebindVerdictCases(m))) it(name, fn);
});

describe('rebindPending', () => {
  it('with no row, or a row with no live binding (a pending-only row), is not-found and writes nothing', () => {
    const db = openDb(); const f = fake(db);
    expect(rebind(db)).toEqual({ ok: false, reason: 'not-found' });
    expect(rowOf(db)).toBeUndefined();
    expect(new CoordStore(db).designatePending(f, desInput()).ok).toBe(true);
    const before = rowOf(db);
    expect(rebind(db)).toEqual({ ok: false, reason: 'not-found' });
    expect(rowOf(db)).toEqual(before);
  });
  it('writes a pending rebind beside the binding: kind, deadline, since and actor; class, set, term and binding kept; no append', () => {
    const db = openDb(); const f = fake(db);
    liveA(db, f); const n = f.seen.length; const before = rowOf(db)!;
    expect(rebind(db)).toEqual({ ok: true, changed: true });
    expect(f.seen).toHaveLength(n);
    expect(rowOf(db)).toMatchObject({ pendingId: B, pendingKind: 'rebind', pendingGeneration: null, pendingSince: NOW + 2,
      pendingDeadlineAt: NOW + 90_000, pendingActor: 'operator-a 01234567', sessionId: A, generation: GEN_A, term: 1, designatedTerm: 1,
      model: before['model'], accountPools: before['accountPools'], pastIds: before['pastIds'], stopsOwed: before['stopsOwed'] });
    expect(designationRead(db)).toMatchObject({ kind: 'designated', sessionId: A, row: { model: 'fable', accountPools: SET_X,
      pending: { sessionId: B, kind: 'rebind', deadlineAt: NOW + 90_000, generation: null } } });
  });
  it('re-reads the slot in its own transaction: a second call is attempt-pending and changes nothing', () => {
    const db = openDb(); const f = fake(db);
    liveA(db, f);
    expect(rebind(db)).toEqual({ ok: true, changed: true });
    const before = rowOf(db);
    expect(rebind(db, { sessionId: C, deadlineAt: NOW + 1, at: NOW + 5 })).toEqual({ ok: false, reason: 'attempt-pending' });
    expect(rowOf(db)).toEqual(before);
    expect(rowOf(db)).toMatchObject({ pendingId: B });
  });
  it('refuses an actor the attribution adapter did not mint for the operator, and writes nothing', () => {
    const db = openDb(); const f = fake(db);
    liveA(db, f); const before = rowOf(db);
    const forged = { subject: 'operator-a', kind: 'operator', issuer: 'account-gate', strength: 'operator' } as unknown as typeof OPERATOR;
    expect(rebind(db, { actor: forged })).toEqual({ ok: false, reason: 'actor' });
    expect(rowOf(db)).toEqual(before);
  });
});

describe('goLive of a rebind attempt', () => {
  const pendingRebind = (db: DatabaseSync, f: Fake): void => { liveA(db, f); expect(rebind(db).ok).toBe(true); f.seen.length = 0; };
  it('appends one authority-rebind with the raised term, the new id, its generation and the old id, BEFORE the row changes', () => {
    const db = openDb(); const f = fake(db);
    pendingRebind(db, f);
    expect(goLive(db, f, B, GEN_B, NOW + 3)).toEqual({ ok: true, changed: true, term: 2, previous: A });
    expect(f.seen).toHaveLength(1);
    expect(f.seen[0]!.entry).toEqual({ kind: 'authority-rebind', opKey: 'go-live-term-2', term: 2, sessionId: B, generation: GEN_B, previousSessionId: A });
    expect(f.seen[0]!.rowAtAppend).toMatchObject({ sessionId: A, generation: GEN_A, term: 1, pendingId: B });
  });
  it('binds the new body, raises the term, keeps designatedTerm, owes the old id its stop, and clears the slot and the last attempt', () => {
    const db = openDb(); const f = fake(db);
    pendingRebind(db, f);
    goLive(db, f, B, GEN_B, NOW + 3);
    expect(rowOf(db)).toMatchObject({ sessionId: B, generation: GEN_B, term: 2, designatedTerm: 1, pastIds: JSON.stringify([A]),
      stopsOwed: JSON.stringify([A]), pendingId: null, pendingKind: null, pendingGeneration: null, pendingSince: null,
      pendingDeadlineAt: null, pendingActor: null, attemptId: null, attemptOutcome: null, attemptAt: null, model: 'fable' });
    expect(designationRead(db)).toMatchObject({ kind: 'designated', sessionId: B, term: 2, row: { pastIds: [A], stopsOwed: [A], pending: null } });
  });
  it('clears a last attempt left by an earlier failed one', () => {
    const db = openDb(); const f = fake(db);
    liveA(db, f);
    expect(rebind(db, { sessionId: C }).ok).toBe(true);
    expect(failPending(db, C, 'deadline-passed', NOW + 3, false)).toEqual({ ok: true, changed: true });
    expect(rowOf(db)).toMatchObject({ attemptId: C, attemptOutcome: 'deadline-passed' });
    expect(rebind(db, { at: NOW + 4 }).ok).toBe(true);
    expect(goLive(db, f, B, GEN_B, NOW + 5)).toMatchObject({ ok: true, changed: true, previous: A });
    expect(rowOf(db)).toMatchObject({ attemptId: null, attemptOutcome: null, attemptAt: null });
  });
  it('a refused append leaves the old binding, its live overlord generation, the term and the pending attempt untouched', () => {
    const db = openDb(); const f = fake(db);
    mint(db, A, GEN_A, A, 1); liveA(db, f);
    expect(rebind(db).ok).toBe(true);
    const row = rowOf(db); const g = gens(db);
    f.answer = () => refuse();
    expect(goLive(db, f, B, GEN_B, NOW + 3)).toEqual({ ok: false, authority: 'authority-rolled-back', detail: 'refused for the test' });
    expect(rowOf(db)).toEqual(row);
    expect(gens(db)).toEqual(g);
    expect(rowOf(db)).toMatchObject({ sessionId: A, generation: GEN_A, term: 1, pendingId: B });
    expect(g).toEqual([{ sessionId: A, identity: 'overlord', state: expect.not.stringMatching(/^ended$/), outcome: null, term: 1 }]);
  });
  it('a repoint that throws rolls the record\'s row, the binding, the ended generation and the term back together', () => {
    const db = openDb(); const f = fake(db);
    mint(db, A, GEN_A, A, 1); liveA(db, f);
    expect(rebind(db).ok).toBe(true);
    mint(db, B, GEN_B, B, 2);
    const row = rowOf(db); const g = gens(db);
    expect(() => goLive(db, f, B, GEN_B, NOW + 3, () => { throw new Error('repoint failed for the test'); })).toThrow('repoint failed for the test');
    expect(rowOf(db)).toEqual(row);
    expect(gens(db)).toEqual(g);
    expect(rowOf(db)).toMatchObject({ sessionId: A, generation: GEN_A, term: 1, pendingId: B });
    expect(designationRead(db)).toMatchObject({ kind: 'designated', sessionId: A, term: 1 });
  });
  it('X5: the old body\'s live overlord generation ends, and the new body\'s, minted under its own id, becomes overlord at the raised term', () => {
    const db = openDb(); const f = fake(db);
    mint(db, A, GEN_A, A, 1); liveA(db, f);
    expect(gens(db)).toEqual([{ sessionId: A, identity: 'overlord', state: expect.not.stringMatching(/^ended$/), outcome: null, term: 1 }]);
    expect(rebind(db).ok).toBe(true);
    mint(db, B, GEN_B, B, 1);
    goLive(db, f, B, GEN_B, NOW + 3);
    expect(gens(db)).toEqual([
      { sessionId: A, identity: 'overlord', state: 'ended', outcome: 'retired', term: 1 },
      { sessionId: B, identity: 'overlord', state: expect.not.stringMatching(/^ended$/), outcome: null, term: 2 },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM continuity_generations WHERE identity = 'overlord' AND state <> 'ended'").get()).toEqual({ n: 1 });
  });
  it('a resent go-live for the new body changes nothing and appends nothing', () => {
    const db = openDb(); const f = fake(db);
    pendingRebind(db, f);
    goLive(db, f, B, GEN_B, NOW + 3); const row = rowOf(db); const n = f.seen.length;
    expect(goLive(db, f, B, GEN_B, NOW + 4)).toEqual({ ok: true, changed: false });
    expect(rowOf(db)).toEqual(row);
    expect(f.seen).toHaveLength(n);
  });
});

describe('the mail repoint, through CoordStore.goLive', () => {
  const T = 'type="status"';
  function rig() {
    const db = openDb(); const f = fake(db); const c = new CoordStore(db);
    liveA(db, f);
    const mail = (toId: string, subject: string): number =>
      c.insertMail({ fromId: 'lane-a-project-a', fromUuid: 'u', toId, runId: null, kind: 'status', subject, body: `body of ${subject}`, artifacts: [] }).id;
    const envelope = (id: string, subject: string): string => `<mail ${T} to="${id}" subject="${subject}"/>`;
    const queue = (mailId: number, to: string, subject: string): number => c.queueDelivery(mailId, to, envelope(to, subject)).id;
    const of = (delivery: number) => db.prepare('SELECT toId, state, envelope FROM mail_deliveries WHERE id = ?').get(delivery) as
      { toId: string; state: string; envelope: string };
    return { db, f, c, mail, queue, of };
  }
  it('moves only the OUTSTANDING deliveries of mail to the role overlord that name the old id, and leaves a parked one, other mail and other ids', () => {
    const { db, f, c, mail, queue, of } = rig();
    const queued = queue(mail('overlord', 'queued'), A, 'queued');
    const delivered = queue(mail('overlord', 'delivered'), A, 'delivered');
    db.prepare("UPDATE mail_deliveries SET state = 'delivered' WHERE id = ?").run(delivered);
    const parked = queue(mail('overlord', 'parked'), A, 'parked');
    db.prepare("UPDATE mail_deliveries SET state = 'rejected' WHERE id = ?").run(parked);
    const acked = queue(mail('overlord', 'acked'), A, 'acked');
    db.prepare("UPDATE mail_deliveries SET state = 'acked' WHERE id = ?").run(acked);
    const otherRole = queue(mail('lane-a-project-a', 'other role'), A, 'other role');
    const otherId = queue(mail('overlord', 'other id'), C, 'other id');
    const before = new Map([queued, delivered, parked, acked, otherRole, otherId].map((id) => [id, of(id)]));
    expect(c.rebindPending({ sessionId: B, deadlineAt: NOW + 90_000, actor: OPERATOR, at: NOW + 2 })).toEqual({ ok: true, changed: true });
    expect(c.goLive(f, B, GEN_B, NOW + 3)).toMatchObject({ ok: true, changed: true, term: 2, previous: A });
    expect(of(queued).toId).toBe(B);
    expect(of(delivered).toId).toBe(B);
    expect(of(parked).toId).toBe(A);
    expect(of(acked).toId).toBe(A);
    expect(of(otherRole).toId).toBe(A);
    expect(of(otherId).toId).toBe(C);
    // the stored envelope is never re-rendered, and no state changes
    for (const [id, was] of before) expect({ state: of(id).state, envelope: of(id).envelope }).toEqual({ state: was.state, envelope: was.envelope });
    expect(of(queued).envelope).toBe(`<mail ${T} to="${A}" subject="queued"/>`);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_deliveries').get()).toEqual({ n: 6 });
  });
  it('a first designate\'s go-live repoints nothing', () => {
    const db = openDb(); const f = fake(db); const c = new CoordStore(db);
    const id = c.insertMail({ fromId: 'lane-a-project-a', fromUuid: 'u', toId: 'overlord', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] }).id;
    const d = c.queueDelivery(id, C, '<mail/>').id;
    expect(c.designatePending(f, desInput()).ok).toBe(true);
    expect(c.goLive(f, A, GEN_A, NOW + 1)).toMatchObject({ ok: true, changed: true, term: 1 });
    expect(db.prepare('SELECT toId FROM mail_deliveries WHERE id = ?').get(d)).toEqual({ toId: C });
  });
});

describe('failPending of a rebind attempt', () => {
  it('keeps the old binding, its generation and the term, clears the slot, and owes only the new body', () => {
    const db = openDb(); const f = fake(db);
    mint(db, A, GEN_A, A, 1); liveA(db, f);
    expect(rebind(db).ok).toBe(true);
    const n = f.seen.length;
    expect(failPending(db, B, 'deadline-passed', NOW + 3, true)).toEqual({ ok: true, changed: true });
    expect(f.seen).toHaveLength(n);
    expect(rowOf(db)).toMatchObject({ sessionId: A, generation: GEN_A, term: 1, designatedTerm: 1, pendingId: null, pendingKind: null,
      pendingDeadlineAt: null, attemptId: B, attemptOutcome: 'deadline-passed', attemptAt: NOW + 3,
      stopsOwed: JSON.stringify([B]), pastIds: JSON.stringify([]) });
    expect(designationRead(db)).toMatchObject({ kind: 'designated', sessionId: A, term: 1, row: { stopsOwed: [B], pending: null,
      lastAttempt: { sessionId: B, outcome: 'deadline-passed' } } });
    expect(gens(db)).toEqual([{ sessionId: A, identity: 'overlord', state: expect.not.stringMatching(/^ended$/), outcome: null, term: 1 }]);
  });
  it('ends the failed body\'s own generation, minted under its own id, and leaves the bound body\'s live (endOverlordGeneration)', () => {
    const db = openDb(); const f = fake(db);
    mint(db, A, GEN_A, A, 1); liveA(db, f);
    expect(rebind(db).ok).toBe(true);
    mint(db, B, GEN_B, B, 1); // a pending rebind body mints under its own id (`roleOf.ts#identityOf`)
    expect(failPending(db, B, 'overlord-sandbox-unmet', NOW + 3, true)).toEqual({ ok: true, changed: true });
    expect(gens(db)).toEqual([
      { sessionId: A, identity: 'overlord', state: expect.not.stringMatching(/^ended$/), outcome: null, term: 1 },
      { sessionId: B, identity: B, state: 'ended', outcome: 'retired', term: 1 },
    ]);
  });
  it('a retire that cancels a pending rebind ends that body\'s own generation too', () => {
    const db = openDb(); const f = fake(db);
    mint(db, A, GEN_A, A, 1); liveA(db, f);
    expect(rebind(db).ok).toBe(true);
    mint(db, B, GEN_B, B, 1);
    expect(retire(db, f, { actor: OPERATOR, at: NOW + 3, opKey: 'op-retire-1' })).toMatchObject({ ok: true, changed: true });
    expect(gens(db)).toEqual([
      { sessionId: A, identity: 'overlord', state: 'ended', outcome: 'retired', term: 1 },
      { sessionId: B, identity: B, state: 'ended', outcome: 'retired', term: 1 },
    ]);
  });
  it('owes nothing when the stop is not owed, and a failed attempt lets a later rebind be written', () => {
    const db = openDb(); const f = fake(db);
    liveA(db, f);
    expect(rebind(db).ok).toBe(true);
    expect(failPending(db, B, 'create-failed', NOW + 3, false)).toEqual({ ok: true, changed: true });
    expect(rowOf(db)).toMatchObject({ stopsOwed: JSON.stringify([]), sessionId: A });
    expect(rebind(db, { sessionId: C, at: NOW + 4 })).toEqual({ ok: true, changed: true });
  });
});

describe('the one sequence (Overlord §10.4): a rebind\'s designation lines', () => {
  const lines = (db: DatabaseSync): unknown[] =>
    db.prepare("SELECT id, state, actor, actorKind, at FROM overlord_sequence WHERE kind = 'designation' ORDER BY seq").all();
  const OP = { actor: 'operator-a 01234567', actorKind: 'operator' };
  const AS_LIVE = [{ id: A, state: 'pending', ...OP, at: NOW }, { id: A, state: 'live', ...OP, at: NOW + 1 }];
  it('rebindPending stamps the new body pending; its go-live stamps the old body retired, then the new one live (the newest line is the binding\'s)', () => {
    const db = openDb(); const f = fake(db);
    liveA(db, f);
    expect(rebind(db).ok).toBe(true);
    expect(lines(db)).toEqual([...AS_LIVE, { id: B, state: 'pending', ...OP, at: NOW + 2 }]);
    expect(goLive(db, f, B, GEN_B, NOW + 3)).toMatchObject({ ok: true, changed: true, previous: A });
    expect(lines(db)).toEqual([...AS_LIVE, { id: B, state: 'pending', ...OP, at: NOW + 2 },
      { id: A, state: 'retired', ...OP, at: NOW + 3 }, { id: B, state: 'live', ...OP, at: NOW + 3 }]);
  });
  it('a refused rebind and a refused go-live stamp nothing; a failed rebind stamps its body failed', () => {
    const db = openDb(); const f = fake(db);
    liveA(db, f);
    expect(rebind(db).ok).toBe(true);
    const before = lines(db);
    expect(rebind(db, { sessionId: C }).ok).toBe(false);
    expect(lines(db)).toEqual(before);
    f.answer = () => refuse();
    expect(goLive(db, f, B, GEN_B, NOW + 3)).toMatchObject({ ok: false });
    expect(lines(db)).toEqual(before);
    expect(failPending(db, B, 'deadline-passed', NOW + 4, true)).toEqual({ ok: true, changed: true });
    expect(lines(db)).toEqual([...before, { id: B, state: 'failed', ...OP, at: NOW + 4 }]);
  });
  it('a failed rebind followed by a prune keeps only the standing binding\'s live line (review 3740 F2, call 1077)', () => {
    const db = openDb(); const f = fake(db);
    liveA(db, f);
    expect(rebind(db).ok).toBe(true);
    expect(failPending(db, B, 'deadline-passed', NOW + 3, true)).toEqual({ ok: true, changed: true });
    const oldest = sequenceOldest(db, 100);
    if (oldest.kind !== 'measured') throw new Error(oldest.why);
    const cut = retentionCut(NOW + 10 * 365 * 86_400_000, oldest.value);
    if (cut.through === null) throw new Error('nothing to prune');
    expect(pruneSequenceThrough(db, cut.through, cut.keep)).toMatchObject({ pruned: expect.any(Number) });
    expect(lines(db)).toEqual([{ id: A, state: 'live', ...OP, at: NOW + 1 }]);
  });
  it('a rebind go-live whose line the verdict refuses throws before the append: no record, no row change, no line', () => {
    const db = openDb(); const f = fake(db);
    liveA(db, f);
    expect(rebind(db).ok).toBe(true);
    f.seen.length = 0;
    const row = rowOf(db); const before = lines(db);
    expect(() => goLive(db, f, B, GEN_B, -1)).toThrow(SequenceStampRefused);
    expect(f.seen).toEqual([]);
    expect(rowOf(db)).toEqual(row);
    expect(lines(db)).toEqual(before);
  });
});
