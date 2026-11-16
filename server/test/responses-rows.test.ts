// Overlord W1, the response record, Task 6 (plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md): a Waiting on
// you row is written in the transaction that stamps its source's reach, only when that stamp is new; a digest line is
// written per decision line in the digest claim's transaction, only when the claim won; and the lane reads each row's owner
// through the owners' existing reads. Neutral names (prog-a, lane-a).
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { tx } from '../src/coord/tx.js';
import { insertPushResponseInTx, insertWaitingResponseInTx, landPushVerdictInTx, openResponseRows, replacedOnOf, type OpenResponseRow } from '../src/coord/responsesStore.js';
import { insertUnboundRow, type BoundWrite } from '../src/coord/pushOutboxStore.js';
import { itemBoundOf, senderFor, type SenderDeps } from '../src/pushSender.js';
import { ownerFactsOf } from '../src/responses/lane.js';
import { WAITING_WINDOW_MS, type ResponseStamp } from '../../shared/responses.js';
import { fakeTime } from './fakeTime.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const T = 1_800_000_000_000;
const STAMP: ResponseStamp = { boot: { kind: 'measured', epoch: 3 }, restore: { kind: 'unmeasured' } };
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-responses-rows-'), '.ccrc', 'coord.db')));
const waiting = (c: CoordStore): Record<string, unknown>[] =>
  c.db.prepare("SELECT * FROM operator_responses WHERE kind = 'waiting' ORDER BY id").all() as Record<string, unknown>[];
const digestRows = (c: CoordStore): Record<string, unknown>[] =>
  c.db.prepare("SELECT * FROM operator_responses WHERE kind = 'digest' ORDER BY id").all() as Record<string, unknown>[];
const ITEM = { program: 'prog-a', runId: null, raisedBy: 'lane-a', kind: 'do' as const, title: 'Do it', why: 'because', how: ['step'],
  options: null, soonLabel: null, secretSlot: null };
/** The sender's deps for the item's bound write: no push service, the stamp given or not. */
const clocks = new WeakMap<CoordStore, ReturnType<typeof fakeTime>>();
const clockOf = (c: CoordStore): ReturnType<typeof fakeTime> => {
  let ft = clocks.get(c);
  if (ft === undefined) { ft = fakeTime({ wallMs: T }); clocks.set(c, ft); }
  return ft;
};
const sdeps = (c: CoordStore, stamp: ResponseStamp | null = STAMP): SenderDeps =>
  ({ coord: c, time: clockOf(c).ports, ...(stamp === null ? {} : { responseStamp: () => stamp }) }) as SenderDeps;
const reach = (c: CoordStore, stamp: ResponseStamp | null = STAMP, neededBy: 'soon' | 'blocking' = 'soon') =>
  itemBoundOf(sdeps(c, stamp), { title: 'Do it', neededBy }, 'reach');
const arm = (c: CoordStore, stamp: ResponseStamp | null = STAMP) => itemBoundOf(sdeps(c, stamp), { title: 'Do it', neededBy: 'blocking' }, 'arm');
let pushSeq = 0;
const askBound = (stamp: ResponseStamp | null = STAMP): BoundWrite => ({
  prepared: { payload: { title: 'Needs an answer', body: 'Proceed?', sessionId: 'lane-a-project-a', tag: 'ask-lane-a-project-a' },
    pushId: (++pushSeq).toString(16).padStart(32, 'f'), service: false },
  due: { due: 'silent', why: 'no-service' }, viewing: false, stamp: stamp ?? undefined,
} as BoundWrite);
const mintAsk = (c: CoordStore, n: number): number => c.insertAsk({ childId: 'lane-a-project-a', parentId: 'lane-b-project-a', runId: null,
  askKey: `key-${n}`, askAt: T, dialogId: `dialog-${n}`, question: 'Proceed?', options: ['Yes', 'No'], now: T });

describe('a Waiting on you row rides the reach (Table 4.3a)', () => {
  it('an item raised to the operator writes one delivered row in the raise\'s transaction, its window seven days on', () => {
    const c = store();
    const { id } = c.raiseItemReached({ ...ITEM, neededBy: 'soon', heldUntil: null }, T, 'coordinator', reach(c));
    expect(waiting(c)).toEqual([expect.objectContaining({ refKind: 'item', refId: id, label: 'item', state: 'delivered', delivery: 'at-once',
      insertedAt: T, admittedAt: T, deliveredAt: T, windowCapAt: T + WAITING_WINDOW_MS, bootMeasured: 1, bootEpoch: 3, restoreMeasured: 0,
      restoreGeneration: null, pushId: null, sealedAt: null })]);
  });

  it('a raise that rolls back writes none', () => {
    const c = store();
    const throwing = (id: number): BoundWrite => { const b = reach(c)(id); return { ...b, prepared: { ...b.prepared, payload: { title: 'x', body: 'y' } } }; };
    // A due push with no tag throws inside the raise's transaction (reachInTx), so the raise and its row roll back.
    expect(() => c.raiseItemReached({ ...ITEM, neededBy: 'blocking', heldUntil: null }, T, 'coordinator', (id) =>
      ({ ...throwing(id), due: { due: 'now' } }))).toThrow();
    expect(waiting(c)).toEqual([]);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM operator_items').get()).toEqual({ n: 0 });
  });

  it('a blocking toggle on a reached item (an arm, no new stamp) writes none', () => {
    const c = store();
    const { id } = c.raiseItemReached({ ...ITEM, neededBy: 'soon', heldUntil: null }, T, 'coordinator', reach(c));
    c.setBlocking(id, true, T + 5, arm(c));
    expect(waiting(c)).toHaveLength(1);
  });

  it('an item reached with no stamp source gets no row from a later arm: only a new reach writes one', () => {
    const c = store();
    const { id } = c.raiseItemReached({ ...ITEM, neededBy: 'soon', heldUntil: null }, T, 'coordinator', reach(c, null));
    c.setBlocking(id, true, T + 5, arm(c));
    expect(waiting(c)).toEqual([]);
  });

  it('a blocking toggle on a held item (an arm, a new stamp) writes one, and the held drain later writes no second (review 2184 F7)', async () => {
    const c = store();
    const id = c.raiseItem({ ...ITEM, neededBy: 'soon', heldUntil: T + 60_000 }, T);
    c.setBlocking(id, true, T + 5, arm(c));
    expect(waiting(c)).toEqual([expect.objectContaining({ refId: id, insertedAt: T + 5 })]);
    c.markFirstBoot(T - 1);
    await senderFor(sdeps(c)).drain(T + 120_000, () => null);
    expect(waiting(c)).toHaveLength(1);
  });

  it('a held item stamped by the held drain writes one at its heldUntil', async () => {
    const c = store();
    c.markFirstBoot(T - 1);
    const id = c.raiseItem({ ...ITEM, neededBy: 'soon', heldUntil: T + 60_000 }, T);
    await senderFor(sdeps(c)).drain(T + 120_000, () => null);
    expect(waiting(c)).toEqual([expect.objectContaining({ refKind: 'item', refId: id, insertedAt: T + 60_000, windowCapAt: T + 60_000 + WAITING_WINDOW_MS })]);
    await senderFor(sdeps(c)).drain(T + 180_000, () => null);
    expect(waiting(c)).toHaveLength(1);
  });

  it('an ask released by the lapse and one declined by its parent each write one', () => {
    const c = store();
    const a = mintAsk(c, 1), b = mintAsk(c, 2);
    expect(c.releaseAsk(a, T + 1, askBound())).not.toBe(false);
    expect(c.declineAsk(b, T + 2, askBound())).not.toBe(false);
    expect(waiting(c).map((r) => [r.refKind, r.refId, r.label, r.insertedAt])).toEqual([['ask', a, 'ask', T + 1], ['ask', b, 'ask', T + 2]]);
  });

  it('a box with no push service still writes it; no stamp in the deps writes none', () => {
    const c = store();
    c.raiseItemReached({ ...ITEM, neededBy: 'soon', heldUntil: null }, T, 'coordinator', reach(c));
    c.raiseItemReached({ ...ITEM, neededBy: 'soon', heldUntil: null }, T, 'coordinator', reach(c, null));
    expect(waiting(c)).toHaveLength(1);
    const ask = mintAsk(c, 3);
    c.releaseAsk(ask, T + 1, askBound(null));
    expect(waiting(c)).toHaveLength(1);
  });

  it('the store called twice for one source gives one row (review 2184 F1)', () => {
    const c = store();
    const ask = mintAsk(c, 4);
    tx(c.db, () => { insertWaitingResponseInTx(c.db, { source: 'ask', id: ask, stamp: STAMP, at: T }); });
    tx(c.db, () => { expect(insertWaitingResponseInTx(c.db, { source: 'ask', id: ask, stamp: STAMP, at: T + 9 })).toEqual({ inserted: false }); });
    expect(waiting(c)).toEqual([expect.objectContaining({ refId: ask, insertedAt: T })]);
  });

  it('a throwing response insert never rolls back the move it rides, and logs once per cause', () => {
    const c = store();
    c.db.exec("CREATE TRIGGER no_waiting BEFORE INSERT ON operator_responses WHEN NEW.kind = 'waiting' BEGIN SELECT RAISE(ABORT, 'no waiting rows'); END");
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const one = c.raiseItemReached({ ...ITEM, neededBy: 'soon', heldUntil: null }, T, 'coordinator', reach(c));
    const two = c.raiseItemReached({ ...ITEM, neededBy: 'soon', heldUntil: null }, T, 'coordinator', reach(c));
    expect(c.itemById(one.id)).not.toBeNull();
    expect(c.itemById(two.id)).not.toBeNull();
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM operator_items WHERE reachedOperatorAt IS NOT NULL').get()).toEqual({ n: 2 });
    expect(waiting(c)).toEqual([]);
    expect(warn.mock.calls.filter(([l]) => String(l).includes('a Waiting on you row was not written'))).toHaveLength(1);
  });

  it('an insert SQLite answers by rolling back the whole transaction fails the move whole, never half-committed (review 2260 F5)', () => {
    const c = store();
    // RAISE(ROLLBACK) stands in for SQLITE_FULL or IOERR: the whole transaction is gone, not just the statement.
    c.db.exec("CREATE TRIGGER gone BEFORE INSERT ON operator_responses WHEN NEW.kind = 'waiting' BEGIN SELECT RAISE(ROLLBACK, 'disk full'); END");
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => c.raiseItemReached({ ...ITEM, neededBy: 'soon', heldUntil: null }, T, 'coordinator', reach(c))).toThrow(/disk full/);
    expect(c.db.isTransaction).toBe(false);
    // Nothing the move would have written after the response insert (the item's outbox row) ran in autocommit.
    for (const t of ['operator_items', 'push_outbox', 'operator_responses']) expect(c.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get(), t).toEqual({ n: 0 });
    expect(warn.mock.calls.filter(([l]) => String(l).includes('a Waiting on you row was not written'))).toEqual([]);
  });
  it("a push's response insert that takes the whole transaction: the unbound insert answers ok: false and keeps no row (review 2260 F5)", () => {
    const c = store();
    c.db.exec("CREATE TRIGGER gone BEFORE INSERT ON operator_responses WHEN NEW.kind = 'push' BEGIN SELECT RAISE(ROLLBACK, 'disk full'); END");
    const out = insertUnboundRow(c.db, { pushId: 'a'.repeat(32), payload: { title: 'T', body: 'B', tag: 'x' }, at: T }, { label: 'coord', carries: null, stamp: STAMP });
    expect(out).toMatchObject({ ok: false, detail: expect.stringContaining('disk full') });
    expect(c.db.isTransaction).toBe(false);
    expect(c.db.prepare('SELECT COUNT(*) AS n FROM push_outbox').get()).toEqual({ n: 0 });
  });
});

describe('a digest line rides the digest claim (question 8)', () => {
  const LINES = [{ rowKind: 'ask' as const, id: 4 }, { rowKind: 'approval' as const, id: 9 }, { rowKind: 'call' as const, id: 2 }];
  it('a claim that wins writes one row per decision line, keyed, labelled by its row kind, its window the next digest', () => {
    const c = store();
    expect(c.claimDigestDay('2026-11-16', T, 3, () => c.insertDigestResponses({ day: '2026-11-16', lines: LINES, stamp: STAMP, at: T, windowCapAt: T + 99 }))).toBe(true);
    expect(digestRows(c).map((r) => [r.refKey, r.label, r.state, r.windowCapAt, r.refId])).toEqual([
      ['2026-11-16:ask:4', 'ask', 'delivered', T + 99, null], ['2026-11-16:approval:9', 'approval', 'delivered', T + 99, null],
      ['2026-11-16:call:2', 'call', 'delivered', T + 99, null]]);
  });
  it('a claim that loses writes none, and its callback is never called', () => {
    const c = store();
    c.claimDigestDay('2026-11-16', T, 0);
    const cb = vi.fn(() => c.insertDigestResponses({ day: '2026-11-16', lines: LINES, stamp: STAMP, at: T, windowCapAt: T + 99 }));
    expect(c.claimDigestDay('2026-11-16', T + 1, 3, cb)).toBe(false);
    expect(cb).not.toHaveBeenCalled();
    expect(digestRows(c)).toEqual([]);
  });
  it('the store called twice for one key gives one row, and a throwing callback never costs the claim', () => {
    const c = store();
    c.claimDigestDay('2026-11-15', T, 1, () => c.insertDigestResponses({ day: '2026-11-16', lines: LINES.slice(0, 1), stamp: STAMP, at: T, windowCapAt: T + 99 }));
    c.claimDigestDay('2026-11-16', T, 1, () => c.insertDigestResponses({ day: '2026-11-16', lines: LINES.slice(0, 1), stamp: STAMP, at: T, windowCapAt: T + 99 }));
    expect(digestRows(c)).toHaveLength(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(c.claimDigestDay('2026-11-17', T, 1, () => { throw new Error('boom'); })).toBe(true);
    expect(c.digestDay('2026-11-17')).toMatchObject({ day: '2026-11-17', count: 1 });
    expect(warn).toHaveBeenCalled();
  });
  it('a line that fails takes back every line of its digest, and the claim stands (review 2260 F5)', () => {
    const c = store();
    c.db.exec("CREATE TRIGGER no_calls BEFORE INSERT ON operator_responses WHEN NEW.label = 'call' BEGIN SELECT RAISE(ABORT, 'no call lines'); END");
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(c.claimDigestDay('2026-11-18', T, 3, () => c.insertDigestResponses({ day: '2026-11-18', lines: LINES, stamp: STAMP, at: T, windowCapAt: T + 99 }))).toBe(true);
    expect(c.digestDay('2026-11-18')).toMatchObject({ day: '2026-11-18', count: 3 });
    expect(digestRows(c)).toEqual([]);
    expect(warn.mock.calls.filter(([l]) => String(l).includes('no call lines'))).toHaveLength(1);
  });
  it('a line SQLite answers by rolling back the whole transaction fails the claim too, so the next beat claims again (review 2260 F5)', () => {
    const c = store();
    c.db.exec("CREATE TRIGGER gone BEFORE INSERT ON operator_responses WHEN NEW.kind = 'digest' BEGIN SELECT RAISE(ROLLBACK, 'disk full'); END");
    expect(() => c.claimDigestDay('2026-11-19', T, 3, () => c.insertDigestResponses({ day: '2026-11-19', lines: LINES, stamp: STAMP, at: T, windowCapAt: T + 99 }))).toThrow(/disk full/);
    expect(c.db.isTransaction).toBe(false);
    expect(c.digestDay('2026-11-19')).toBeNull();
    expect(digestRows(c)).toEqual([]);
  });
});

describe('the owners\' reader (ownerFactsOf)', () => {
  const rowOf = (c: CoordStore, kind: string): OpenResponseRow => {
    const open = openResponseRows(c.db);
    if (!open.ok) throw new Error(open.detail);
    return open.rows.find((r) => r.kind === kind)!;
  };
  it('an item\'s events, an ask\'s answer, a digest line\'s correction, and none for an unbound push', () => {
    const c = store();
    const { id } = c.raiseItemReached({ ...ITEM, neededBy: 'soon', heldUntil: null }, T, 'coordinator', reach(c));
    const facts = ownerFactsOf(c, rowOf(c, 'waiting'));
    expect(facts).toEqual({ ok: true, owner: { kind: 'item', acts: [{ act: 'raise', actor: 'coordinator', at: T }] } });
    const ask = mintAsk(c, 5);
    c.releaseAsk(ask, T + 1, askBound());
    c.db.prepare("UPDATE asks SET state = 'answered', answeredBy = 'operator', answeredAt = ? WHERE id = ?").run(T + 50, ask);
    const askRow = openResponseRows(c.db);
    if (!askRow.ok) throw new Error(askRow.detail);
    expect(ownerFactsOf(c, askRow.rows.find((r) => r.refKind === 'ask')!)).toEqual({ ok: true,
      owner: { kind: 'ask', state: 'answered', answeredBy: 'operator', answeredAt: T + 50, endedAt: T + 50 } });
    c.claimDigestDay('2026-11-16', T, 1, () => c.insertDigestResponses({ day: '2026-11-16', lines: [{ rowKind: 'ask', id: ask }], stamp: STAMP, at: T, windowCapAt: T + 99 }));
    c.db.prepare('UPDATE asks SET corrected = 1 WHERE id = ?').run(ask);
    expect(ownerFactsOf(c, rowOf(c, 'digest'))).toEqual({ ok: true, owner: { kind: 'digest', corrected: true, overturnedAt: null } });
    tx(c.db, () => { insertPushResponseInTx(c.db, { pushId: 'c'.repeat(32), label: 'disk', carries: null, hasActions: false, tag: 'disk', stamp: STAMP, at: T }); });
    expect(ownerFactsOf(c, rowOf(c, 'push'))).toEqual({ ok: true, owner: { kind: 'none' } });
    void id;
  });
  it('a row about something gone is gone; a throwing read is { ok: false }, never a default', () => {
    const c = store();
    const ask = mintAsk(c, 6);
    c.releaseAsk(ask, T + 1, askBound());
    const row = rowOf(c, 'waiting');
    c.db.prepare('DELETE FROM asks WHERE id = ?').run(ask);
    expect(ownerFactsOf(c, row)).toEqual({ ok: true, owner: { kind: 'gone' } });
    vi.spyOn(c, 'askById').mockImplementation(() => { throw new Error('disk gone'); });
    expect(ownerFactsOf(c, row)).toMatchObject({ ok: false });
  });
});

describe('replacedOnOf', () => {
  it('names the accepted subscriptions a later same-tag push shares with the row, inside its window', () => {
    const c = store();
    const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
    const put = (pushId: string, tag: string, accepted: string[], at: number): void => tx(c.db, () => {
      insertPushResponseInTx(c.db, { pushId, label: 'coord', carries: null, hasActions: false, tag, stamp: STAMP, at });
      landPushVerdictInTx(c.db, pushId, { accepted, terminal: true, answered: true }, at);
    });
    put('1'.repeat(32), 't', [A, B], T);
    put('2'.repeat(32), 't', [B, C], T + 10);         // shares B
    put('3'.repeat(32), 't', [A], T + 99_999_999);    // after the window
    put('4'.repeat(32), 'u', [A], T + 20);            // another tag
    const open = openResponseRows(c.db);
    if (!open.ok) throw new Error(open.detail);
    const first = open.rows.find((r) => r.tag === 't' && r.deliveredAt === T)!;
    expect(replacedOnOf(c.db, first, T + 1_000)).toEqual([B]);
    put('5'.repeat(32), 't', [C], T + 30);            // a disjoint subscription
    expect(replacedOnOf(c.db, first, T + 1_000)).toEqual([B]);
  });
});
